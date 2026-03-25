import assert from "node:assert/strict";
import test from "node:test";

import { TESTNET_USDC } from "../../../typescript/packages/mpp/src/constants.js";

import { createDemoApi } from "./api.js";
import { createDemoEnvironment } from "./config.js";

test("health and config routes preserve the demo contract without secrets", async () => {
  const api = createDemoApi({
    environment: createDemoEnvironment({
      apiOrigin: "https://demo.example",
      bindings: {
        MEGAETH_TESTNET: "true",
        MEGAETH_TOKEN_ADDRESS: TESTNET_USDC.address,
      },
    }),
  });

  const healthResponse = await api.handleRequest(
    new Request("https://demo.example/api/v1/health"),
  );
  const configResponse = await api.handleRequest(
    new Request("https://demo.example/api/v1/config"),
  );

  assert.ok(healthResponse);
  assert.ok(configResponse);
  assert.equal(healthResponse.status, 200);
  assert.equal(configResponse.status, 200);

  const health = await healthResponse.json();
  const config = await configResponse.json();

  assert.equal(health.status, "configuration-required");
  assert.equal(health.submissionMode, "realtime");
  assert.equal(config.submissionMode, "realtime");
  assert.equal(config.tokenSymbol, "USDC");
  assert.equal(config.endpoints.length, 2);
  assert.equal(config.endpoints[0].id, "basic");
  assert.equal(config.endpoints[1].id, "splits");
});

test("paid routes return an instructive error when mode is missing", async () => {
  const api = createDemoApi({
    environment: createDemoEnvironment({
      apiOrigin: "https://demo.example",
    }),
  });

  const response = await api.handleRequest(
    new Request("https://demo.example/api/v1/charge/basic"),
  );

  assert.ok(response);
  assert.equal(response.status, 400);

  const body = await response.json();
  assert.match(body.detail, /\?mode=permit2/);
});

test("paid routes return instructive setup blockers when secrets are missing", async () => {
  const api = createDemoApi({
    environment: createDemoEnvironment({
      apiOrigin: "https://demo.example",
      bindings: {
        MEGAETH_TESTNET: "true",
      },
    }),
  });

  const response = await api.handleRequest(
    new Request("https://demo.example/api/v1/charge/basic?mode=permit2"),
  );

  assert.ok(response);
  assert.equal(response.status, 503);

  const body = await response.json();
  assert.match(body.detail, /MPP_SECRET_KEY/);
  assert.match(body.detail, /MEGAETH_SETTLEMENT_PRIVATE_KEY/);
});
