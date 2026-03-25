import { Challenge, Credential, Errors } from "mppx";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import * as SharedMethods from "../../Methods.js";
import { megaethTestnet } from "../../constants.js";

export type ChargeChallenge = Challenge.Challenge<
  SharedMethods.ChargeRequest,
  typeof SharedMethods.charge.intent,
  typeof SharedMethods.charge.name
>;

export type ChargeCredential = Credential.Credential<
  SharedMethods.ChargeCredentialPayload,
  ChargeChallenge
>;

export const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f094538c5f1d2c75e7d70ce2f3fba8c8a55f5d42",
);
export const tokenAddress =
  "0x1111111111111111111111111111111111111111" as const;
export const recipientAddress =
  "0x2222222222222222222222222222222222222222" as const;
export const permit2Address =
  "0x3333333333333333333333333333333333333333" as const;

export function createChallenge(
  overrides?: Partial<{
    expires: string;
    request: SharedMethods.ChargeRequest;
    secretKey: string;
  }>,
): ChargeChallenge {
  return Challenge.fromMethod(SharedMethods.charge, {
    expires: overrides?.expires ?? new Date(Date.now() + 60_000).toISOString(),
    realm: "tests.megaeth.local",
    request:
      overrides?.request ??
      ({
        amount: "1000",
        currency: tokenAddress,
        methodDetails: {
          chainId: megaethTestnet.id,
          permit2Address,
        },
        recipient: recipientAddress,
      } satisfies SharedMethods.ChargeRequest),
    secretKey: overrides?.secretKey ?? "test-secret",
  }) as ChargeChallenge;
}

export function createHashCredential(
  challenge: ChargeChallenge,
  account: PrivateKeyAccount = payer,
): ChargeCredential {
  return Credential.from({
    challenge,
    payload: {
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      type: "hash",
    },
    source: `did:pkh:eip155:${megaethTestnet.id}:${account.address}`,
  }) as ChargeCredential;
}

export function deserializeChargeCredential(
  serialized: string,
): ChargeCredential {
  return Credential.deserialize<SharedMethods.ChargeCredentialPayload>(
    serialized,
  ) as ChargeCredential;
}

export async function capturePaymentError(
  promise: Promise<unknown>,
): Promise<Errors.PaymentError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Errors.PaymentError) {
      return error;
    }

    throw error;
  }

  throw new Error(
    "Reject the MegaETH payment request before asserting its structured error.",
  );
}

export function createStaticPublicClient(
  chainId: number = megaethTestnet.id,
): PublicClient {
  return createPublicClient({
    chain:
      chainId === megaethTestnet.id
        ? megaethTestnet
        : {
            ...megaethTestnet,
            id: chainId,
          },
    transport: http("http://127.0.0.1:8545"),
  });
}

export function createLocalWalletClient(account: PrivateKeyAccount = payer) {
  return createWalletClient({
    account,
    chain: megaethTestnet,
    transport: http("http://127.0.0.1:8545"),
  });
}

export function createTransactionReceipt(hash: Hex): TransactionReceipt {
  return {
    blockHash: hash,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 1n,
    effectiveGasPrice: 1n,
    from: payer.address,
    gasUsed: 1n,
    logs: [],
    logsBloom: "0x0",
    status: "success",
    to: permit2Address as Address,
    transactionHash: hash,
    transactionIndex: 0,
    type: "legacy",
  } as TransactionReceipt;
}
