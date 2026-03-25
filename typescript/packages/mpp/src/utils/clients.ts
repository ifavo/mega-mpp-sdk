import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { parseAccount } from "viem/accounts";

import {
  DEFAULT_CHAINS,
  DEFAULT_RPC_URLS,
  MEGAETH_MAINNET_CHAIN_ID,
  MEGAETH_TESTNET_CHAIN_ID,
} from "../constants.js";

export type PublicClientResolver = {
  getPublicClient?:
    | ((parameters: {
        chainId: number;
      }) => Promise<PublicClient> | PublicClient)
    | undefined;
  publicClient?: PublicClient | undefined;
  rpcUrls?: Partial<Record<number, string>> | undefined;
};

export type WalletClientResolver = PublicClientResolver & {
  getWalletClient?:
    | ((parameters: {
        chainId: number;
      }) => Promise<WalletClient> | WalletClient)
    | undefined;
  walletClient?: WalletClient | undefined;
  account?: Account | Address | undefined;
};

export function resolveChainId(parameters: {
  chainId?: number | undefined;
  testnet?: boolean | undefined;
}): number {
  if (parameters.testnet) return MEGAETH_TESTNET_CHAIN_ID;
  return parameters.chainId ?? MEGAETH_MAINNET_CHAIN_ID;
}

export function resolveChain(chainId: number): Chain {
  const chain = DEFAULT_CHAINS[chainId as keyof typeof DEFAULT_CHAINS];
  if (!chain) {
    throw new Error(
      `Unsupported chainId "${chainId}". Use ${MEGAETH_MAINNET_CHAIN_ID} for mainnet or ${MEGAETH_TESTNET_CHAIN_ID} for testnet.`,
    );
  }

  return chain;
}

export async function resolvePublicClient(
  parameters: PublicClientResolver,
  chainId: number,
): Promise<PublicClient> {
  if (parameters.getPublicClient) {
    return await parameters.getPublicClient({ chainId });
  }

  if (parameters.publicClient) {
    return parameters.publicClient;
  }

  const rpcUrl =
    parameters.rpcUrls?.[chainId] ??
    DEFAULT_RPC_URLS[chainId as keyof typeof DEFAULT_RPC_URLS];
  if (!rpcUrl) {
    throw new Error(
      `No RPC URL is configured for chainId "${chainId}". Provide rpcUrls, getPublicClient, or publicClient.`,
    );
  }

  return createPublicClient({
    chain: resolveChain(chainId),
    transport: http(rpcUrl),
  });
}

export async function resolveWalletClient(
  parameters: WalletClientResolver,
  chainId: number,
): Promise<WalletClient> {
  if (parameters.getWalletClient) {
    return await parameters.getWalletClient({ chainId });
  }

  if (parameters.walletClient) {
    return parameters.walletClient;
  }

  if (!parameters.account || typeof parameters.account === "string") {
    throw new Error(
      "Provide a walletClient or a local viem account object so the SDK can sign MegaETH transactions and typed data.",
    );
  }

  const rpcUrl =
    parameters.rpcUrls?.[chainId] ??
    DEFAULT_RPC_URLS[chainId as keyof typeof DEFAULT_RPC_URLS];
  if (!rpcUrl) {
    throw new Error(
      `No RPC URL is configured for chainId "${chainId}". Provide rpcUrls, getWalletClient, or walletClient.`,
    );
  }

  return createWalletClient({
    account: parameters.account,
    chain: resolveChain(chainId),
    transport: http(rpcUrl),
  });
}

export function resolveAccount(
  walletClient: WalletClient,
  accountOverride?: Account | Address | undefined,
): Account {
  const account = accountOverride ?? walletClient.account;
  if (!account) {
    throw new Error(
      "Provide an account or a walletClient with an attached account so the MegaETH charge method can sign permit payloads.",
    );
  }

  if (typeof account === "string") {
    if (!walletClient.account) {
      throw new Error(
        "A plain address is only valid when walletClient.account is available and matches it. Provide a local viem account instead.",
      );
    }

    const normalized = getAddress(account);
    if (getAddress(walletClient.account.address) !== normalized) {
      throw new Error(
        `The provided account address "${normalized}" does not match walletClient.account "${walletClient.account.address}". Use the same signer for both.`,
      );
    }
  }

  return parseAccount(account);
}
