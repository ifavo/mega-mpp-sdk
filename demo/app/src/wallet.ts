import { defineChain, numberToHex, type Address } from "viem";

import type { DemoConfig } from "./types.js";

const USER_REJECTED_REQUEST_CODE = 4001;
const UNKNOWN_CHAIN_CODE = 4902;

export type EthereumProvider = {
  request: (parameters: {
    method: string;
    params?: unknown[] | undefined;
  }) => Promise<unknown>;
};

export async function connectWalletForDemoChain(
  config: DemoConfig,
  provider: EthereumProvider | undefined,
): Promise<Address | null> {
  if (!provider) {
    throw new Error(
      "Install an EIP-1193 wallet before retrying the MegaETH demo.",
    );
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: numberToHex(config.chainId) }],
    });
  } catch (error) {
    if (isUserRejectedRequest(error)) {
      throw new Error(
        "Approve the wallet network switch before retrying the MegaETH demo.",
      );
    }

    if (!isUnknownChainError(error)) {
      throw new Error(getNetworkSwitchErrorMessage(error));
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: numberToHex(config.chainId),
          chainName: config.chainName,
          nativeCurrency: {
            decimals: 18,
            name: "Ether",
            symbol: "ETH",
          },
          rpcUrls: [config.rpcUrl],
        },
      ],
    });
  }

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const nextAccount = accounts[0] as Address | undefined;
  return nextAccount ?? null;
}

export function createDemoChain(config: DemoConfig) {
  return defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: {
      decimals: 18,
      name: "Ether",
      symbol: "ETH",
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
      },
    },
  });
}

function isUserRejectedRequest(error: unknown): boolean {
  return getErrorCode(error) === USER_REJECTED_REQUEST_CODE;
}

function isUnknownChainError(error: unknown): boolean {
  if (getErrorCode(error) === UNKNOWN_CHAIN_CODE) {
    return true;
  }

  return /unknown chain|unrecognized chain|wallet_addEthereumChain/i.test(
    getErrorMessage(error),
  );
}

function getNetworkSwitchErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);
  if (message) {
    return `${message} Retry after switching the wallet to the configured MegaETH network.`;
  }

  return "Switch the wallet to the configured MegaETH network before retrying the demo.";
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const code = Reflect.get(error, "code");
  return typeof code === "number" ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
