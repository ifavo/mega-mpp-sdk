import {
  createExecutionContext,
  env,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type {
  DemoConfigResponse,
  DemoHealthResponse,
} from "../../shared/types.js";
import worker, { type DemoWorkerEnv } from "./index.js";
import { createDurableObjectStore } from "./store.js";

type WorkerFetch = NonNullable<typeof worker.fetch>;
type WorkerRequest = Parameters<WorkerFetch>[0];
type WorkerExecutionContext = Parameters<WorkerFetch>[2];

function createWorkerEnv(
  overrides: Partial<DemoWorkerEnv> = {},
): DemoWorkerEnv {
  return {
    ...(env as DemoWorkerEnv),
    ...overrides,
  };
}

async function dispatch(
  url: string,
  overrides: Partial<DemoWorkerEnv> = {},
): Promise<Response> {
  const fetchHandler = worker.fetch;
  if (!fetchHandler) {
    throw new Error(
      "Export a fetch handler before running the Worker integration tests.",
    );
  }

  const ctx = createExecutionContext();
  const response = await fetchHandler(
    new Request(url) as WorkerRequest,
    createWorkerEnv(overrides),
    ctx as WorkerExecutionContext,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Cloudflare worker demo", () => {
  it("returns health payloads with instructive configuration blockers", async () => {
    const response = await dispatch("https://demo.example/api/v1/health", {
      MEGAETH_RECIPIENT_ADDRESS: undefined,
      MEGAETH_SETTLEMENT_PRIVATE_KEY: undefined,
      MPP_SECRET_KEY: undefined,
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as DemoHealthResponse;
    expect(body.status).toBe("configuration-required");
    expect(body.submissionMode).toBe("realtime");
    expect(body.warnings[0]).toMatch(/MPP_SECRET_KEY/);
  });

  it("returns config payloads with all demo endpoints and testnet token metadata", async () => {
    const response = await dispatch("https://demo.example/api/v1/config");

    expect(response.status).toBe(200);

    const body = (await response.json()) as DemoConfigResponse;
    expect(body.submissionMode).toBe("realtime");
    expect(body.tokenSymbol).toBe("USDC");
    expect(body.endpoints).toHaveLength(3);
    expect(body.endpoints.map(({ id }) => id)).toEqual([
      "basic",
      "splits",
      "session",
    ]);
    expect(body.session.ready).toBe(false);
  });

  it("returns an instructive 400 when the credential mode query is missing", async () => {
    const response = await dispatch("https://demo.example/api/v1/charge/basic");

    expect(response.status).toBe(400);

    const body = (await response.json()) as { detail: string };
    expect(body.detail).toMatch(/\?mode=permit2/);
  });

  it("returns an instructive 503 when settlement configuration is missing", async () => {
    const response = await dispatch(
      "https://demo.example/api/v1/charge/basic?mode=permit2",
      {
        MEGAETH_SETTLEMENT_PRIVATE_KEY: undefined,
        MPP_SECRET_KEY: undefined,
      },
    );

    expect(response.status).toBe(503);

    const body = (await response.json()) as { detail: string };
    expect(body.detail).toMatch(/MPP_SECRET_KEY/);
    expect(body.detail).toMatch(/MEGAETH_SETTLEMENT_PRIVATE_KEY/);
  });

  it("returns an instructive 503 when session escrow configuration is missing", async () => {
    const response = await dispatch("https://demo.example/api/v1/session/basic", {
      MEGAETH_SESSION_ESCROW_ADDRESS: undefined,
      MEGAETH_SETTLEMENT_PRIVATE_KEY: undefined,
      MPP_SECRET_KEY: undefined,
    });

    expect(response.status).toBe(503);

    const body = (await response.json()) as { detail: string };
    expect(body.detail).toMatch(/MEGAETH_SESSION_ESCROW_ADDRESS/);
    expect(body.detail).toMatch(/MPP_SECRET_KEY/);
  });

  it("returns an instructive 400 when the session state channel id is missing", async () => {
    const response = await dispatch("https://demo.example/api/v1/session/state");

    expect(response.status).toBe(400);

    const body = (await response.json()) as { detail: string };
    expect(body.detail).toMatch(/channelId/);
  });

  it("serves the SPA shell for non-API navigation requests", async () => {
    const response = await dispatch("https://demo.example/demo/route");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("MPP Playground");
  });

  it("persists challenge and transaction replay markers through the Durable Object store", async () => {
    const challengeKey = "megaeth:charge:challenge:demo-1";
    const hashKey = "megaeth:charge:hash:0xabc";
    const challengeStore = createDurableObjectStore(env.DEMO_STORE);
    await challengeStore.put(challengeKey, true);

    const hashStore = createDurableObjectStore(env.DEMO_STORE);
    await hashStore.put(hashKey, true);

    await expect(challengeStore.get(challengeKey)).resolves.toBe(true);
    await expect(hashStore.get(hashKey)).resolves.toBe(true);

    const storeId = env.DEMO_STORE.idFromName("mega-mpp-demo-store");
    const stub = env.DEMO_STORE.get(storeId);

    await runInDurableObject(
      stub,
      async (_instance, state: DurableObjectState) => {
        await expect(state.storage.get<string>(challengeKey)).resolves.toBe(
          "true",
        );
        await expect(state.storage.get<string>(hashKey)).resolves.toBe("true");
      },
    );
  });
});
