import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
} from "viem";

import type { DemoConfig } from "./types.js";
import { createDemoChain, type EthereumProvider } from "./wallet.js";

export function requireDemoProvider(
  provider: EthereumProvider | undefined = window.ethereum,
): EthereumProvider {
  if (!provider) {
    throw new Error(
      "Install an EIP-1193 wallet before retrying the MegaETH demo.",
    );
  }

  return provider;
}

export function createDemoClients(parameters: {
  account: Address;
  config: DemoConfig;
  provider?: EthereumProvider | undefined;
}) {
  const provider = requireDemoProvider(parameters.provider);
  const chain = createDemoChain(parameters.config);

  return {
    chain,
    provider,
    publicClient: createPublicClient({
      chain,
      transport: http(parameters.config.rpcUrl),
    }),
    walletClient: createWalletClient({
      account: parameters.account,
      chain,
      transport: custom(provider),
    }),
  };
}
