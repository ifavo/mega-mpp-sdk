import {
  prepareTransactionRequest,
  sendRawTransaction,
  sendTransaction,
  signTransaction,
  waitForTransactionReceipt,
} from "viem/actions";
import {
  BaseError,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  UnsupportedProviderMethodError,
} from "viem";
import type {
  Account,
  Address,
  Hex,
  PublicClient,
  TransactionReceipt,
  WalletClient,
} from "viem";

import { resolveChain } from "./clients.js";

export type SubmissionMode = "auto" | "sync" | "realtime" | "sendAndWait";

const UNSUPPORTED_METHOD_CODES = new Set([-32601, 4200]);

type SubmitParameters = {
  account: Account;
  chainId: number;
  data: Hex;
  publicClient: PublicClient;
  submissionMode?: SubmissionMode | undefined;
  to: Address;
  walletClient: WalletClient;
};

export async function submitTransaction(
  parameters: SubmitParameters,
): Promise<TransactionReceipt> {
  const {
    account,
    chainId,
    data,
    publicClient,
    submissionMode = "auto",
    to,
    walletClient,
  } = parameters;

  const prepared = await prepareTransactionRequest(publicClient, {
    account,
    chain: resolveChain(chainId),
    data,
    to,
  });

  try {
    const signedTransaction = await signTransaction(walletClient, prepared);
    return await sendSignedTransaction(
      publicClient,
      signedTransaction,
      submissionMode,
    );
  } catch (error) {
    if (!isUnsupportedMethodError(error)) {
      throw error;
    }
  }

  const hash = await sendTransaction(walletClient, {
    account,
    chain: resolveChain(chainId),
    data,
    to,
  });
  return await waitForTransactionReceipt(publicClient, { hash });
}

export async function sendSignedTransaction(
  publicClient: PublicClient,
  signedTransaction: Hex,
  submissionMode: SubmissionMode = "auto",
): Promise<TransactionReceipt> {
  if (submissionMode === "sync") {
    return await submitWithRpcMethod(
      publicClient,
      signedTransaction,
      "eth_sendRawTransactionSync",
    );
  }

  if (submissionMode === "realtime") {
    return await submitWithRpcMethod(
      publicClient,
      signedTransaction,
      "realtime_sendRawTransaction",
    );
  }

  if (submissionMode === "sendAndWait") {
    return await sendRawTransactionAndWait(publicClient, signedTransaction);
  }

  for (const method of [
    "eth_sendRawTransactionSync",
    "realtime_sendRawTransaction",
  ] as const) {
    try {
      return await submitWithRpcMethod(publicClient, signedTransaction, method);
    } catch (error) {
      if (!isUnsupportedMethodError(error)) {
        throw error;
      }
    }
  }

  return await sendRawTransactionAndWait(publicClient, signedTransaction);
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

async function submitWithRpcMethod(
  publicClient: PublicClient,
  signedTransaction: Hex,
  method: "eth_sendRawTransactionSync" | "realtime_sendRawTransaction",
): Promise<TransactionReceipt> {
  const request = publicClient.request as (parameters: {
    method: string;
    params?: readonly unknown[] | undefined;
  }) => Promise<unknown>;

  return await normalizeSubmissionResult(
    publicClient,
    await request({
      method,
      params: [signedTransaction],
    }),
  );
}

async function sendRawTransactionAndWait(
  publicClient: PublicClient,
  signedTransaction: Hex,
): Promise<TransactionReceipt> {
  const hash = await sendRawTransaction(publicClient, {
    serializedTransaction: signedTransaction,
  });
  return await waitForTransactionReceipt(publicClient, { hash });
}

function isUnsupportedMethodError(error: unknown): boolean {
  if (
    error instanceof MethodNotFoundRpcError ||
    error instanceof MethodNotSupportedRpcError ||
    error instanceof UnsupportedProviderMethodError
  ) {
    return true;
  }

  const code = getErrorCode(error);
  if (code !== undefined && UNSUPPORTED_METHOD_CODES.has(code)) {
    return true;
  }

  return getErrorMessages(error).some((message) =>
    /(method not found|does not exist|unsupported|not supported|not implemented)/i.test(
      message,
    ),
  );
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const code = Reflect.get(error, "code");
  return typeof code === "number" ? code : undefined;
}

function getErrorMessages(error: unknown): string[] {
  if (error instanceof BaseError) {
    return [error.shortMessage, error.details, error.message].filter(
      (message): message is string => Boolean(message),
    );
  }

  if (error instanceof Error) {
    return [error.message];
  }

  return [String(error)];
}
