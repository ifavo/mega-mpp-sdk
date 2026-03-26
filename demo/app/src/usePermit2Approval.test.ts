import { beforeEach, describe, expect, it, vi } from "vitest";
import { maxUint256 } from "viem";
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";

vi.mock("./demoClients.js", () => ({
  createDemoClients: vi.fn(),
}));

vi.mock("viem/actions", () => ({
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

import { createDemoConfigFixture } from "../../shared/testFixtures.js";
import { createDemoClients } from "./demoClients.js";
import {
  approvePermit2InfiniteAllowance,
  getPermit2ApprovalState,
  readPermit2Allowance,
} from "./usePermit2Approval.js";

const config = createDemoConfigFixture();
const account = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("usePermit2Approval helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the charge flow as blocked when the current allowance is too low", () => {
    const state = getPermit2ApprovalState({
      account,
      allowance: 99n,
      isLoading: false,
      requiredAmount: 100n,
    });

    expect(state.type).toBe("required");
    expect(state.hasRequiredAllowance).toBe(false);
  });

  it("recommends infinite approval when the allowance covers the charge but is finite", () => {
    const state = getPermit2ApprovalState({
      account,
      allowance: 100n,
      isLoading: false,
      requiredAmount: 100n,
    });

    expect(state.type).toBe("recommended");
    expect(state.hasRequiredAllowance).toBe(true);
    expect(state.hasInfiniteApproval).toBe(false);
  });

  it("treats max uint allowance as ready for repeat charge flows", () => {
    const state = getPermit2ApprovalState({
      account,
      allowance: maxUint256,
      isLoading: false,
      requiredAmount: 100n,
    });

    expect(state.type).toBe("ready");
    expect(state.hasInfiniteApproval).toBe(true);
  });

  it("loads the current Permit2 allowance for the connected wallet", async () => {
    const publicClient = {};
    const walletClient = {};
    vi.mocked(createDemoClients).mockReturnValue({
      chain: {} as ReturnType<typeof createDemoClients>["chain"],
      provider: { request: vi.fn() },
      publicClient:
        publicClient as ReturnType<typeof createDemoClients>["publicClient"],
      walletClient:
        walletClient as ReturnType<typeof createDemoClients>["walletClient"],
    });
    vi.mocked(readContract).mockResolvedValueOnce(123n);

    const allowance = await readPermit2Allowance({
      account,
      config,
    });

    expect(allowance).toBe(123n);
    expect(readContract).toHaveBeenCalledWith(
      publicClient,
      expect.objectContaining({
        address: config.tokenAddress,
        args: [account, config.permit2Address],
        functionName: "allowance",
      }),
    );
  });

  it("writes an infinite Permit2 approval and waits for the receipt", async () => {
    const publicClient = {};
    const walletClient = {};
    const hash =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    vi.mocked(createDemoClients).mockReturnValue({
      chain: {} as ReturnType<typeof createDemoClients>["chain"],
      provider: { request: vi.fn() },
      publicClient:
        publicClient as ReturnType<typeof createDemoClients>["publicClient"],
      walletClient:
        walletClient as ReturnType<typeof createDemoClients>["walletClient"],
    });
    vi.mocked(writeContract).mockResolvedValueOnce(hash);
    vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({
      transactionHash: hash,
    } as unknown as Awaited<ReturnType<typeof waitForTransactionReceipt>>);

    const transactionHash = await approvePermit2InfiniteAllowance({
      account,
      config,
    });

    expect(transactionHash).toBe(hash);
    expect(writeContract).toHaveBeenCalledWith(
      walletClient,
      expect.objectContaining({
        account,
        address: config.tokenAddress,
        args: [config.permit2Address, maxUint256],
        functionName: "approve",
      }),
    );
    expect(waitForTransactionReceipt).toHaveBeenCalledWith(publicClient, {
      hash,
    });
  });

  it("surfaces a wallet-confirmation message when approval is rejected", async () => {
    vi.mocked(createDemoClients).mockReturnValue({
      chain: {} as ReturnType<typeof createDemoClients>["chain"],
      provider: { request: vi.fn() },
      publicClient: {} as ReturnType<typeof createDemoClients>["publicClient"],
      walletClient: {} as ReturnType<typeof createDemoClients>["walletClient"],
    });
    vi.mocked(writeContract).mockRejectedValueOnce({
      code: 4001,
      message: "User rejected the request.",
    });

    await expect(
      approvePermit2InfiniteAllowance({
        account,
        config,
      }),
    ).rejects.toThrowError(/Approve the Permit2 token allowance/i);
  });
});
