import {
  prepareTransactionRequest,
  sendRawTransaction,
  sendTransaction,
  signTransaction,
  waitForTransactionReceipt,
} from "viem/actions";
import type {
  Account,
  Address,
  Hex,
  PublicClient,
  TransactionReceipt,
  WalletClient,
} from "viem";

import { resolveChain } from "./clients.js";

type SubmitParameters = {
  account: Account;
  chainId: number;
  data: Hex;
  publicClient: PublicClient;
  to: Address;
  walletClient: WalletClient;
};

export async function submitTransaction(
  parameters: SubmitParameters,
): Promise<TransactionReceipt> {
  const { account, chainId, data, publicClient, to, walletClient } = parameters;

  const prepared = await prepareTransactionRequest(publicClient, {
    account,
    chain: resolveChain(chainId),
    data,
    to,
  });

  try {
    const signedTransaction = await signTransaction(walletClient, prepared);
    return await sendSignedTransaction(publicClient, signedTransaction);
  } catch {
    const hash = await sendTransaction(walletClient, {
      account,
      chain: resolveChain(chainId),
      data,
      to,
    });
    return await waitForTransactionReceipt(publicClient, { hash });
  }
}

export async function sendSignedTransaction(
  publicClient: PublicClient,
  signedTransaction: Hex,
): Promise<TransactionReceipt> {
  const request = publicClient.request as (parameters: {
    method: string;
    params?: readonly unknown[] | undefined;
  }) => Promise<unknown>;

  try {
    return await normalizeSubmissionResult(
      publicClient,
      await request({
        method: "eth_sendRawTransactionSync",
        params: [signedTransaction],
      }),
    );
  } catch {
    try {
      return await normalizeSubmissionResult(
        publicClient,
        await request({
          method: "realtime_sendRawTransaction",
          params: [signedTransaction],
        }),
      );
    } catch {
      const hash = await sendRawTransaction(publicClient, {
        serializedTransaction: signedTransaction,
      });
      return await waitForTransactionReceipt(publicClient, { hash });
    }
  }
}

async function normalizeSubmissionResult(
  publicClient: PublicClient,
  result: unknown,
): Promise<TransactionReceipt> {
  if (typeof result === "string") {
    return await waitForTransactionReceipt(publicClient, {
      hash: result as Hex,
    });
  }

  if (isTransactionReceipt(result)) {
    return result;
  }

  const hash = getSubmissionHash(result);
  if (hash) {
    return await waitForTransactionReceipt(publicClient, { hash });
  }

  throw new Error(
    "Use a MegaETH RPC that returns either a transaction receipt or a transaction hash after submission.",
  );
}

function getSubmissionHash(result: unknown): Hex | undefined {
  if (!result || typeof result !== "object") return undefined;
  const candidate =
    Reflect.get(result, "transactionHash") ?? Reflect.get(result, "hash");
  if (typeof candidate !== "string") return undefined;
  return candidate as Hex;
}

function isTransactionReceipt(result: unknown): result is TransactionReceipt {
  if (!result || typeof result !== "object") return false;

  const transactionHash = Reflect.get(result, "transactionHash");
  const status = Reflect.get(result, "status");
  return (
    typeof transactionHash === "string" &&
    (status === "success" || status === "reverted")
  );
}
