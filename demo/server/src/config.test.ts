import { describe, expect, it } from "vitest";

import { TESTNET_USDC } from "../../../typescript/packages/mpp/src/constants.js";
import { createDemoBindingsFixture } from "../../shared/testFixtures.js";

import {
  createModeStatuses,
  createSessionConfig,
  getWarnings,
  loadNodeDemoEnvironment,
  loadWorkerDemoEnvironment,
  resolveDemoStatus,
} from "./config.js";

describe("demo server config", () => {
  it("createModeStatuses reports missing recipient and settlement blockers independently", () => {
    const modes = createModeStatuses({
      feePayer: true,
      secretKey: "demo-secret",
    });

    expect(modes.permit2.ready).toBe(false);
    expect(modes.hash.ready).toBe(false);
    expect(modes.permit2.blockers[0]).toMatch(/MEGAETH_SETTLEMENT_PRIVATE_KEY/);
    expect(modes.hash.blockers[0]).toMatch(/MEGAETH_RECIPIENT_ADDRESS/);
  });

  it("loadNodeDemoEnvironment resolves known testnet token metadata without booting the server", () => {
    const runtime = loadNodeDemoEnvironment(
      createDemoBindingsFixture({
        MEGAETH_TOKEN_ADDRESS: TESTNET_USDC.address,
        PORT: "3001",
      }),
    );

    expect(runtime.environment.tokenMetadata.symbol).toBe("USDC");
    expect(runtime.environment.tokenMetadata.decimals).toBe(6);
    expect(runtime.environment.submissionMode).toBe("realtime");
    expect(runtime.port).toBe(3001);
  });

  it("loadNodeDemoEnvironment accepts explicit submission mode overrides", () => {
    const runtime = loadNodeDemoEnvironment(
      createDemoBindingsFixture({
        MEGAETH_SUBMISSION_MODE: "sendAndWait",
      }),
    );

    expect(runtime.environment.submissionMode).toBe("sendAndWait");
  });

  it("loadNodeDemoEnvironment rejects invalid submission modes with an instructive error", () => {
    expect(() =>
      loadNodeDemoEnvironment(
        createDemoBindingsFixture({
          MEGAETH_SUBMISSION_MODE: "fast",
        }),
      ),
    ).toThrow(/MEGAETH_SUBMISSION_MODE/);
  });

  it("loadWorkerDemoEnvironment derives the API origin from the request URL", () => {
    const environment = loadWorkerDemoEnvironment(
      createDemoBindingsFixture({
        MEGAETH_TOKEN_ADDRESS: TESTNET_USDC.address,
      }),
      new Request("https://demo.example/api/v1/health"),
    );

    expect(environment.apiOrigin).toBe("https://demo.example");
    expect(environment.tokenMetadata.symbol).toBe("USDC");
  });

  it("getWarnings and resolveDemoStatus summarize partial demo configuration", () => {
    const modes = createModeStatuses({
      feePayer: false,
      recipientAddress: "0x2222222222222222222222222222222222222222",
      secretKey: "demo-secret",
    });
    const session = createSessionConfig({
      allowDelegatedSigner: true,
      minVoucherDelta: "100000",
      recipientAddress: "0x2222222222222222222222222222222222222222",
      secretKey: "demo-secret",
      settlementIntervalSeconds: 3600,
      settlementMinUnsettledAmount: "200000",
      suggestedDeposit: "500000",
    });
    const warnings = getWarnings({
      modeStatuses: modes,
      session,
      splitRecipient: undefined,
      submissionMode: "realtime",
    });

    expect(resolveDemoStatus(modes)).toBe("partial-configuration");
    expect(warnings[0]).toMatch(/MEGAETH_SETTLEMENT_PRIVATE_KEY/);
    expect(
      warnings.some((warning) => /MEGAETH_SESSION_ESCROW_ADDRESS/.test(warning)),
    ).toBe(true);
    expect(
      warnings.some((warning) => /MEGAETH_SPLIT_RECIPIENT/.test(warning)),
    ).toBe(true);
  });
});
