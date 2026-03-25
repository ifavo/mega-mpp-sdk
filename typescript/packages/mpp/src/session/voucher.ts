import {
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { getAddress } from "viem";

export const SESSION_VOUCHER_DOMAIN_NAME = "MegaETH MPP Session Escrow";
export const SESSION_VOUCHER_DOMAIN_VERSION = "1";

export const sessionVoucherTypes = {
  Voucher: [
    { name: "channelId", type: "bytes32" },
    { name: "cumulativeAmount", type: "uint256" },
  ],
} as const;

export function buildSessionVoucherTypedData(parameters: {
  chainId: number;
  channelId: Hex;
  cumulativeAmount: bigint;
  escrowContract: Address;
}) {
  return {
    domain: {
      chainId: parameters.chainId,
      name: SESSION_VOUCHER_DOMAIN_NAME,
      verifyingContract: parameters.escrowContract,
      version: SESSION_VOUCHER_DOMAIN_VERSION,
    },
    message: {
      channelId: parameters.channelId,
      cumulativeAmount: parameters.cumulativeAmount,
    },
    primaryType: "Voucher" as const,
    types: sessionVoucherTypes,
  };
}

export async function signSessionVoucher(parameters: {
  account: Address;
  chainId: number;
  channelId: Hex;
  cumulativeAmount: bigint;
  escrowContract: Address;
  walletClient: WalletClient;
}): Promise<Hex> {
  const typedData = buildSessionVoucherTypedData(parameters);
  return parameters.walletClient.signTypedData({
    account: parameters.account,
    domain: typedData.domain,
    message: typedData.message,
    primaryType: typedData.primaryType,
    types: typedData.types,
  });
}

export async function recoverSessionVoucherSigner(parameters: {
  chainId: number;
  channelId: Hex;
  cumulativeAmount: bigint;
  escrowContract: Address;
  signature: Hex;
}): Promise<Address> {
  const typedData = buildSessionVoucherTypedData(parameters);
  return getAddress(
    await recoverTypedDataAddress({
      domain: typedData.domain,
      message: typedData.message,
      primaryType: typedData.primaryType,
      signature: parameters.signature,
      types: typedData.types,
    }),
  );
}
