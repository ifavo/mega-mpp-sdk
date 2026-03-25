import { describe, expect, it, vi } from "vitest";

import { createDemoConfigFixture } from "../../shared/testFixtures.js";
import {
  createDemoChargeMethodParameters,
  toProgressState,
} from "./usePaidResource.js";

const config = createDemoConfigFixture({
  chainId: 6342,
});

describe("usePaidResource helpers", () => {
  it("forwards the configured submission mode into the client charge method", () => {
    const onProgress = vi.fn();
    const parameters = createDemoChargeMethodParameters({
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      config,
      credentialMode: "hash",
      onProgress,
      publicClient: {} as Parameters<
        typeof createDemoChargeMethodParameters
      >[0]["publicClient"],
      walletClient: {} as Parameters<
        typeof createDemoChargeMethodParameters
      >[0]["walletClient"],
    });

    expect(parameters.submissionMode).toBe("realtime");
  });

  it("explains realtime mini-block confirmation in hash-mode progress", () => {
    const progress = toProgressState({ type: "confirming" }, config, "hash");

    expect(progress.type).toBe("confirming");
    expect("detail" in progress ? progress.detail : "").toMatch(/mini block/i);
  });
});
