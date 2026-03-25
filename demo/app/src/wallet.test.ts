import { describe, expect, it, vi } from "vitest";

import type { DemoConfig } from "./types.js";
import { connectWalletForDemoChain } from "./wallet.js";

const config: DemoConfig = {
  apiOrigin: "http://localhost:3001",
  canSettle: true,
  chainId: 6343,
  feePayer: false,
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
      feePayer: false,
      label: "Server broadcasts Permit2 transaction",
      ready: true,
      transactionSender: "server",
    },
  },
  permit2Address: "0x3333333333333333333333333333333333333333",
  rpcUrl: "https://carrot.megaeth.com/rpc",
  splitAmount: "50000",
  testnet: true,
  tokenAddress: "0x1111111111111111111111111111111111111111",
  tokenDecimals: 6,
  tokenSymbol: "USDC",
};

describe("connectWalletForDemoChain", () => {
  it("guides the user to install a wallet when none is available", async () => {
    await expect(
      connectWalletForDemoChain(config, undefined),
    ).rejects.toThrowError(/Install an EIP-1193 wallet/i);
  });

  it("adds the MegaETH chain only when the switch error indicates an unknown chain", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce({ code: 4902, message: "Unknown chain." })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(["0x2222222222222222222222222222222222222222"]);

    const account = await connectWalletForDemoChain(config, { request });

    expect(account).toBe("0x2222222222222222222222222222222222222222");
    expect(request).toHaveBeenNthCalledWith(1, {
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x18c7" }],
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x18c7",
          chainName: "MegaETH Testnet",
          nativeCurrency: {
            decimals: 18,
            name: "Ether",
            symbol: "ETH",
          },
          rpcUrls: ["https://carrot.megaeth.com/rpc"],
        },
      ],
    });
  });

  it("surfaces user-rejected network switch errors without attempting to add the chain", async () => {
    const request = vi.fn().mockRejectedValueOnce({
      code: 4001,
      message: "User rejected the request.",
    });

    await expect(
      connectWalletForDemoChain(config, { request }),
    ).rejects.toThrowError(/Approve the wallet network switch/i);
    expect(request).toHaveBeenCalledOnce();
  });
});
