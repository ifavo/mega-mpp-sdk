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
}): number {
  if (parameters.chainId === undefined) {
    throw new Error(
      "Provide chainId before retrying so the SDK uses the intended MegaETH network, RPC, and contract addresses.",
    );
  }

  return parameters.chainId;
}

export function resolveChargeChainId(parameters: {
  chainId?: number | undefined;
  testnet?: boolean | undefined;
}): number {
  if (parameters.testnet) {
    return MEGAETH_TESTNET_CHAIN_ID;
  }

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
    const publicClient = await parameters.getPublicClient({ chainId });
    assertClientChain(publicClient, chainId, "publicClient");
    return publicClient;
  }

  if (parameters.publicClient) {
    assertClientChain(parameters.publicClient, chainId, "publicClient");
    return parameters.publicClient;
  }

  const rpcUrl = resolveRpcUrl(parameters.rpcUrls, chainId);

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
    const walletClient = await parameters.getWalletClient({ chainId });
    assertClientChain(walletClient, chainId, "walletClient");
    return walletClient;
  }

  if (parameters.walletClient) {
    assertClientChain(parameters.walletClient, chainId, "walletClient");
    return parameters.walletClient;
  }

  if (!parameters.account || typeof parameters.account === "string") {
    throw new Error(
      "Provide a walletClient or a local viem account object so the SDK can sign MegaETH transactions and typed data.",
    );
  }

  const rpcUrl = resolveRpcUrl(parameters.rpcUrls, chainId);

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

function resolveRpcUrl(
  rpcUrls: Partial<Record<number, string>> | undefined,
  chainId: number,
): string {
  const rpcUrl =
    rpcUrls?.[chainId] ??
    DEFAULT_RPC_URLS[chainId as keyof typeof DEFAULT_RPC_URLS];
  if (!rpcUrl) {
    throw new Error(
      `No RPC URL is configured for chainId "${chainId}". Provide rpcUrls, getPublicClient, publicClient, getWalletClient, or walletClient.`,
    );
  }

  return rpcUrl;
}

function assertClientChain(
  client: { chain?: Chain | undefined },
  chainId: number,
  label: "publicClient" | "walletClient",
): void {
  if (!client.chain) {
    throw new Error(
      `Provide a ${label} configured for chainId "${chainId}". The current client does not expose chain metadata.`,
    );
  }

  if (client.chain.id !== chainId) {
    throw new Error(
      `Provide a ${label} configured for chainId "${chainId}" instead of "${client.chain.id}".`,
    );
  }
}
