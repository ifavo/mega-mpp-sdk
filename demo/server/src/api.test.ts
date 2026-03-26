import { describe, expect, it } from "vitest";

import { TESTNET_USDC } from "../../../typescript/packages/mpp/src/constants.js";
import { Store } from "../../../typescript/packages/mpp/src/server/index.js";
import { createDemoBindingsFixture } from "../../shared/testFixtures.js";

import { createDemoApi } from "./api.js";
import { createDemoEnvironment } from "./config.js";

describe("demo server API", () => {
  it("health and config routes preserve the demo contract without secrets", async () => {
    const api = createDemoApi({
      environment: createDemoEnvironment({
        apiOrigin: "https://demo.example",
        bindings: createDemoBindingsFixture({
          MEGAETH_PAYMENT_TOKEN_ADDRESS: TESTNET_USDC.address,
        }),
      }),
      store: Store.memory(),
    });

    const healthResponse = await api.handleRequest(
      new Request("https://demo.example/api/v1/health"),
    );
    const configResponse = await api.handleRequest(
      new Request("https://demo.example/api/v1/config"),
    );

    expect(healthResponse).toBeTruthy();
    expect(configResponse).toBeTruthy();
    expect(healthResponse?.status).toBe(200);
    expect(configResponse?.status).toBe(200);

    const health = await healthResponse?.json();
    const config = await configResponse?.json();

    expect(health.status).toBe("configuration-required");
    expect(health.submissionMode).toBe("realtime");
    expect(config.submissionMode).toBe("realtime");
    expect(config.tokenSymbol).toBe("USDC");
    expect(config.endpoints.length).toBe(3);
    expect(config.endpoints[0].id).toBe("basic");
    expect(config.endpoints[1].id).toBe("splits");
    expect(config.endpoints[2].id).toBe("session");
    expect(config.endpoints[2].description).toBe("Reusable session resource");
    expect(config.session.ready).toBe(false);
  });

  it("paid routes return an instructive error when mode is missing", async () => {
    const api = createDemoApi({
      environment: createDemoEnvironment({
        apiOrigin: "https://demo.example",
        bindings: createDemoBindingsFixture(),
      }),
      store: Store.memory(),
    });

    const response = await api.handleRequest(
      new Request("https://demo.example/api/v1/charge/basic"),
    );

    expect(response).toBeTruthy();
    expect(response?.status).toBe(400);

    const body = await response?.json();
    expect(body.detail).toMatch(/\?mode=permit2/);
  });

  it("paid routes return instructive setup blockers when secrets are missing", async () => {
    const api = createDemoApi({
      environment: createDemoEnvironment({
        apiOrigin: "https://demo.example",
        bindings: createDemoBindingsFixture(),
      }),
      store: Store.memory(),
    });

    const response = await api.handleRequest(
      new Request("https://demo.example/api/v1/charge/basic?mode=permit2"),
    );

    expect(response).toBeTruthy();
    expect(response?.status).toBe(503);

    const body = await response?.json();
    expect(body.detail).toMatch(/MPP_SECRET_KEY/);
    expect(body.detail).toMatch(/MEGAETH_SETTLEMENT_PRIVATE_KEY/);
  });

  it("session route returns instructive setup blockers when escrow configuration is missing", async () => {
    const api = createDemoApi({
      environment: createDemoEnvironment({
        apiOrigin: "https://demo.example",
        bindings: createDemoBindingsFixture(),
      }),
      store: Store.memory(),
    });

    const response = await api.handleRequest(
      new Request("https://demo.example/api/v1/session/basic"),
    );

    expect(response).toBeTruthy();
    expect(response?.status).toBe(503);

    const body = await response?.json();
    expect(body.detail).toMatch(/MEGAETH_SESSION_ESCROW_ADDRESS/);
    expect(body.detail).toMatch(/MPP_SECRET_KEY/);
  });

  it("session state route requires a channel id query parameter", async () => {
    const api = createDemoApi({
      environment: createDemoEnvironment({
        apiOrigin: "https://demo.example",
        bindings: createDemoBindingsFixture(),
      }),
      store: Store.memory(),
    });

    const response = await api.handleRequest(
      new Request("https://demo.example/api/v1/session/state"),
    );

    expect(response).toBeTruthy();
    expect(response?.status).toBe(400);

    const body = await response?.json();
    expect(body.detail).toMatch(/channelId/);
  });
});
