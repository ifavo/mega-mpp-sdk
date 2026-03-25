import assert from "node:assert/strict";
import test from "node:test";

import { TESTNET_USDC } from "../../../typescript/packages/mpp/src/constants.js";

import {
  createModeStatuses,
  getWarnings,
  loadNodeDemoEnvironment,
  loadWorkerDemoEnvironment,
  resolveDemoStatus,
} from "./config.js";

test("createModeStatuses reports missing recipient and settlement blockers independently", () => {
  const modes = createModeStatuses({
    feePayer: true,
    secretKey: "demo-secret",
  });

  assert.equal(modes.permit2.ready, false);
  assert.equal(modes.hash.ready, false);
  assert.match(modes.permit2.blockers[0]!, /MEGAETH_SETTLEMENT_PRIVATE_KEY/);
  assert.match(modes.hash.blockers[0]!, /MEGAETH_RECIPIENT_ADDRESS/);
});

test("loadNodeDemoEnvironment resolves known testnet token metadata without booting the server", () => {
  const runtime = loadNodeDemoEnvironment({
    DEMO_PUBLIC_ORIGIN: "http://localhost:3001",
    MEGAETH_TESTNET: "true",
    MEGAETH_TOKEN_ADDRESS: TESTNET_USDC.address,
    PORT: "3001",
  });

  assert.equal(runtime.environment.tokenMetadata.symbol, "USDC");
  assert.equal(runtime.environment.tokenMetadata.decimals, 6);
  assert.equal(runtime.environment.submissionMode, "realtime");
  assert.equal(runtime.port, 3001);
});

test("loadNodeDemoEnvironment accepts explicit submission mode overrides", () => {
  const runtime = loadNodeDemoEnvironment({
    DEMO_PUBLIC_ORIGIN: "http://localhost:3001",
    MEGAETH_SUBMISSION_MODE: "sendAndWait",
  });

  assert.equal(runtime.environment.submissionMode, "sendAndWait");
});

test("loadNodeDemoEnvironment rejects invalid submission modes with an instructive error", () => {
  assert.throws(
    () =>
      loadNodeDemoEnvironment({
        DEMO_PUBLIC_ORIGIN: "http://localhost:3001",
        MEGAETH_SUBMISSION_MODE: "fast",
      }),
    /MEGAETH_SUBMISSION_MODE/,
  );
});

test("loadWorkerDemoEnvironment derives the API origin from the request URL", () => {
  const environment = loadWorkerDemoEnvironment(
    {
      MEGAETH_TESTNET: "true",
      MEGAETH_TOKEN_ADDRESS: TESTNET_USDC.address,
    },
    new Request("https://demo.example/api/v1/health"),
  );

  assert.equal(environment.apiOrigin, "https://demo.example");
  assert.equal(environment.tokenMetadata.symbol, "USDC");
});

test("getWarnings and resolveDemoStatus summarize partial demo configuration", () => {
  const modes = createModeStatuses({
    feePayer: false,
    recipientAddress: "0x2222222222222222222222222222222222222222",
    secretKey: "demo-secret",
  });

  assert.equal(resolveDemoStatus(modes), "partial-configuration");
  assert.deepEqual(
    getWarnings({
      modeStatuses: modes,
      submissionMode: "realtime",
      splitRecipient: undefined,
    }),
    [
      "Set MEGAETH_SETTLEMENT_PRIVATE_KEY before retrying. Server-broadcast Permit2 settlement requires a funded settlement wallet.",
      "Set MEGAETH_SPLIT_RECIPIENT if you want the split-payment demo route to fan out a second transfer.",
    ],
  );
});
