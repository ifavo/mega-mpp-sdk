import { describe, expect, it, vi } from "vitest";

import type { DemoConfig } from "./types.js";
import {
  createDemoChargeMethodParameters,
  toProgressState,
} from "./usePaidResource.js";

const config: DemoConfig = {
  apiOrigin: "http://localhost:3001",
  canSettle: true,
  chainId: 6342,
  feePayer: true,
  modes: {
    hash: {
      blockers: [],
      feePayer: false,
      label: "Client broadcasts Permit2 transaction",
      ready: true,
      transactionSender: "client",
    },
    permit2: {
      blockers: [],
      feePayer: true,
      label: "Server broadcasts Permit2 transaction",
      ready: true,
      transactionSender: "server",
    },
  },
  permit2Address: "0x3333333333333333333333333333333333333333",
  recipient: "0x2222222222222222222222222222222222222222",
  rpcUrl: "https://carrot.megaeth.com/rpc",
  submissionMode: "realtime",
  splitAmount: "50000",
  testnet: true,
  tokenAddress: "0x1111111111111111111111111111111111111111",
  tokenDecimals: 6,
  tokenSymbol: "USDC",
};

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
