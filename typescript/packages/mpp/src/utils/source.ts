import { getAddress, type Address } from "viem";

const DID_PKH_PREFIX = "did:pkh:eip155:";

export function createDidPkhSource(chainId: number, address: Address): string {
  return `${DID_PKH_PREFIX}${chainId}:${getAddress(address)}`;
}

export function parseDidPkhSource(
  source: string,
): { chainId: number; address: Address } | null {
  const match = /^did:pkh:eip155:(\d+):(0x[0-9a-fA-F]{40})$/.exec(source);
  if (!match) return null;
  const chainId = match[1];
  const address = match[2];
  if (!chainId || !address) return null;

  return {
    chainId: Number(chainId),
    address: getAddress(address) as Address,
  };
}
