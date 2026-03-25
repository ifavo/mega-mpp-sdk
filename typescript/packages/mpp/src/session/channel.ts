import { SESSION_ESCROW_ABI } from "./abi.js";
import {
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { readContract } from "viem/actions";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type SessionChannelIdParameters = {
  authorizedSigner?: Address | undefined;
  chainId: number;
  escrowContract: Address;
  payee: Address;
  payer: Address;
  salt: Hex;
  token: Address;
};

export type SessionOnChainChannel = {
  authorizedSigner: Address;
  closeRequestedAt: bigint;
  deposit: bigint;
  finalized: boolean;
  openedAt: bigint;
  payee: Address;
  payer: Address;
  settled: bigint;
  token: Address;
};

export type SessionDecodedOpenCall = {
  args: {
    authorizedSigner: Address;
    deposit: bigint;
    payee: Address;
    salt: Hex;
    token: Address;
  };
  functionName: "open";
};

export type SessionDecodedTopUpCall = {
  args: {
    additionalDeposit: bigint;
    channelId: Hex;
  };
  functionName: "topUp";
};

export function computeSessionChannelId(
  parameters: SessionChannelIdParameters,
): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 chainId, address escrowContract, address payer, address payee, address token, address authorizedSigner, bytes32 salt",
      ),
      [
        BigInt(parameters.chainId),
        getAddress(parameters.escrowContract),
        getAddress(parameters.payer),
        getAddress(parameters.payee),
        getAddress(parameters.token),
        getAddress(parameters.authorizedSigner ?? ZERO_ADDRESS),
        parameters.salt,
      ],
    ),
  );
}

export async function readSessionChannel(parameters: {
  channelId: Hex;
  escrowContract: Address;
  publicClient: PublicClient;
}): Promise<SessionOnChainChannel> {
  const channel = await readContract(parameters.publicClient, {
    abi: SESSION_ESCROW_ABI,
    address: parameters.escrowContract,
    functionName: "getChannel",
    args: [parameters.channelId],
  });

  const resolved = channel as SessionOnChainChannel;
  return {
    authorizedSigner: getAddress(resolved.authorizedSigner),
    closeRequestedAt: BigInt(resolved.closeRequestedAt),
    deposit: BigInt(resolved.deposit),
    finalized: Boolean(resolved.finalized),
    openedAt: BigInt(resolved.openedAt),
    payee: getAddress(resolved.payee),
    payer: getAddress(resolved.payer),
    settled: BigInt(resolved.settled),
    token: getAddress(resolved.token),
  };
}

export function decodeSessionEscrowCall(
  data: Hex,
): SessionDecodedOpenCall | SessionDecodedTopUpCall {
  const decoded = decodeFunctionData({
    abi: SESSION_ESCROW_ABI,
    data,
  });

  if (decoded.functionName === "open") {
    const [payee, token, deposit, salt, authorizedSigner] = decoded.args;
    return {
      args: {
        authorizedSigner: getAddress(authorizedSigner),
        deposit,
        payee: getAddress(payee),
        salt,
        token: getAddress(token),
      },
      functionName: "open",
    };
  }

  if (decoded.functionName === "topUp") {
    const [channelId, additionalDeposit] = decoded.args;
    return {
      args: {
        additionalDeposit,
        channelId,
      },
      functionName: "topUp",
    };
  }

  throw new Error(
    "Use a MegaETH session escrow open or topUp transaction before retrying the session request.",
  );
}

export function isZeroAddress(value: Address): boolean {
  return getAddress(value) === ZERO_ADDRESS;
}
