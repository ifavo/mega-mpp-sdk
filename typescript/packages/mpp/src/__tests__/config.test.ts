import { createPublicClient, createWalletClient, http } from "viem";
import { describe, expect, it } from "vitest";

import { megaeth, megaethTestnet } from "../constants.js";
import {
  resolveChainId,
  resolvePublicClient,
  resolveWalletClient,
} from "../utils/clients.js";
import { createLocalWalletClient, payer } from "./fixtures/chargeTestkit.js";

describe("client configuration", () => {
  it("requires an explicit chain selection", () => {
    expect(() => resolveChainId({})).toThrowError(
      /Provide chainId or testnet/i,
    );
  });

  it("rejects conflicting chainId and testnet values", () => {
    expect(() =>
      resolveChainId({
        chainId: megaeth.id,
        testnet: true,
      }),
    ).toThrowError(/Use chainId "6343" when testnet is set to "true"/i);
  });

  it("rejects a public client configured for a different chain", async () => {
    const publicClient = createPublicClient({
      chain: megaeth,
      transport: http("http://127.0.0.1:8545"),
    });

    await expect(
      resolvePublicClient({ publicClient }, megaethTestnet.id),
    ).rejects.toThrowError(
      /Provide a publicClient configured for chainId "6343"/i,
    );
  });

  it("rejects a wallet client configured for a different chain", async () => {
    const walletClient = createWalletClient({
      account: payer,
      chain: megaeth,
      transport: http("http://127.0.0.1:8545"),
    });

    await expect(
      resolveWalletClient({ walletClient }, megaethTestnet.id),
    ).rejects.toThrowError(
      /Provide a walletClient configured for chainId "6343"/i,
    );
  });

  it("accepts a wallet client when the chain matches", async () => {
    const walletClient = createLocalWalletClient();

    await expect(
      resolveWalletClient({ walletClient }, megaethTestnet.id),
    ).resolves.toBe(walletClient);
  });
});
