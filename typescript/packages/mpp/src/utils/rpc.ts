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
  hexToBigInt,
  hexToNumber,
  keccak256,
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
import type { SubmissionMode } from "./submissionMode.js";

const UNSUPPORTED_METHOD_CODES = new Set([-32601, 4200]);
const REALTIME_TRANSACTION_EXPIRED_PATTERN = /realtime transaction expired/i;

type SubmitParameters = {
  account: Account;
  chainId: number;
  data: Hex;
  publicClient: PublicClient;
  submissionMode: SubmissionMode;
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
    submissionMode,
    to,
    walletClient,
  } = parameters;

  const prepared = await prepareTransactionRequest(publicClient, {
    account,
    chain: resolveChain(chainId),
    data,
    to,
  });

  if (submissionMode === "sendAndWait") {
    return await sendAndWaitWithExplicitMode({
      account,
      chainId,
      data,
      prepared,
      publicClient,
      to,
      walletClient,
    });
  }

  const signedTransaction = await signRawTransactionForMegaethMode({
    prepared,
    submissionMode,
    walletClient,
  });
  return await sendSignedTransaction(
    publicClient,
    signedTransaction,
    submissionMode,
  );
}

export async function sendSignedTransaction(
  publicClient: PublicClient,
  signedTransaction: Hex,
  submissionMode: SubmissionMode,
): Promise<TransactionReceipt> {
  switch (submissionMode) {
    case "sync":
      return await submitWithRpcMethod(
        publicClient,
        signedTransaction,
        "eth_sendRawTransactionSync",
      );
    case "realtime":
      return await submitWithRpcMethod(
        publicClient,
        signedTransaction,
        "realtime_sendRawTransaction",
      );
    case "sendAndWait":
      return await sendRawTransactionAndWait(publicClient, signedTransaction);
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

  const receipt = normalizeTransactionReceipt(result);
  if (receipt) {
    return receipt;
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

function normalizeTransactionReceipt(
  result: unknown,
): TransactionReceipt | undefined {
  if (isViemTransactionReceipt(result)) {
    return result;
  }

  if (!result || typeof result !== "object") {
    return undefined;
  }

  const transactionHash = getHexField(result, "transactionHash");
  const status = normalizeReceiptStatus(Reflect.get(result, "status"));
  if (!transactionHash || !status) {
    return undefined;
  }

  const from = getAddressField(result, "from");
  const blockHash = getHexField(result, "blockHash");
  const blockNumber = getHexBigIntField(result, "blockNumber");
  const cumulativeGasUsed = getHexBigIntField(result, "cumulativeGasUsed");
  const effectiveGasPrice = getHexBigIntField(result, "effectiveGasPrice");
  const gasUsed = getHexBigIntField(result, "gasUsed");
  const logsBloom = getHexField(result, "logsBloom");
  const transactionIndex = getHexNumberField(result, "transactionIndex");
  const type = normalizeTransactionType(Reflect.get(result, "type"));

  if (
    !from ||
    !blockHash ||
    blockNumber === undefined ||
    cumulativeGasUsed === undefined ||
    effectiveGasPrice === undefined ||
    gasUsed === undefined ||
    !logsBloom ||
    transactionIndex === undefined ||
    !type
  ) {
    return undefined;
  }

  const logs = Reflect.get(result, "logs");
  const contractAddress = getNullableAddressField(result, "contractAddress");
  const to = getNullableAddressField(result, "to");

  return {
    blockHash,
    blockNumber,
    contractAddress,
    cumulativeGasUsed,
    effectiveGasPrice,
    from,
    gasUsed,
    logs: Array.isArray(logs) ? (logs as TransactionReceipt["logs"]) : [],
    logsBloom,
    status,
    to,
    transactionHash,
    transactionIndex,
    type,
  } as TransactionReceipt;
}

function isViemTransactionReceipt(
  result: unknown,
): result is TransactionReceipt {
  if (!result || typeof result !== "object") {
    return false;
  }

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

  try {
    return await normalizeSubmissionResult(
      publicClient,
      await request({
        method,
        params: [signedTransaction],
      }),
    );
  } catch (error) {
    if (
      method === "realtime_sendRawTransaction" &&
      isRealtimeTransactionExpiredError(error)
    ) {
      return await waitForTransactionReceipt(publicClient, {
        hash: deriveTransactionHash(signedTransaction),
      });
    }

    if (isUnsupportedMethodError(error)) {
      throw new Error(
        method === "eth_sendRawTransactionSync"
          ? "Set submissionMode to realtime or sendAndWait before retrying because the current RPC does not support eth_sendRawTransactionSync."
          : "Set submissionMode to sync or sendAndWait before retrying because the current RPC does not support realtime_sendRawTransaction.",
        { cause: error },
      );
    }

    throw error;
  }
}

async function signRawTransactionForMegaethMode(parameters: {
  prepared: Awaited<ReturnType<typeof prepareTransactionRequest>>;
  submissionMode: "realtime" | "sync";
  walletClient: WalletClient;
}): Promise<Hex> {
  try {
    return await signTransaction(parameters.walletClient, parameters.prepared);
  } catch (error) {
    if (isUnsupportedMethodError(error)) {
      throw new Error(
        `Set submissionMode to sendAndWait before retrying because the current wallet does not support raw transaction signing required for ${parameters.submissionMode} submission.`,
        { cause: error },
      );
    }

    throw error;
  }
}

async function sendAndWaitWithExplicitMode(parameters: {
  account: Account;
  chainId: number;
  data: Hex;
  prepared: Awaited<ReturnType<typeof prepareTransactionRequest>>;
  publicClient: PublicClient;
  to: Address;
  walletClient: WalletClient;
}): Promise<TransactionReceipt> {
  try {
    const signedTransaction = await signTransaction(
      parameters.walletClient,
      parameters.prepared,
    );
    return await sendRawTransactionAndWait(
      parameters.publicClient,
      signedTransaction,
    );
  } catch (error) {
    if (!isUnsupportedMethodError(error)) {
      throw error;
    }
  }

  const hash = await sendTransaction(parameters.walletClient, {
    account: parameters.account,
    chain: resolveChain(parameters.chainId),
    data: parameters.data,
    to: parameters.to,
  });
  return await waitForTransactionReceipt(parameters.publicClient, { hash });
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

function isRealtimeTransactionExpiredError(error: unknown): boolean {
  return getErrorMessages(error).some((message) =>
    REALTIME_TRANSACTION_EXPIRED_PATTERN.test(message),
  );
}

function deriveTransactionHash(signedTransaction: Hex): Hex {
  return keccak256(signedTransaction);
}

function getAddressField(result: object, key: "from"): Address | undefined {
  const value = Reflect.get(result, key);
  return typeof value === "string" ? (value as Address) : undefined;
}

function getNullableAddressField(
  result: object,
  key: "contractAddress" | "to",
): Address | null {
  const value = Reflect.get(result, key);
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? (value as Address) : null;
}

function getHexField(result: object, key: string): Hex | undefined {
  const value = Reflect.get(result, key);
  return typeof value === "string" ? (value as Hex) : undefined;
}

function getHexBigIntField(result: object, key: string): bigint | undefined {
  const value = getHexField(result, key);
  if (!value) {
    return undefined;
  }

  return hexToBigInt(value);
}

function getHexNumberField(result: object, key: string): number | undefined {
  const value = getHexField(result, key);
  if (!value) {
    return undefined;
  }

  return hexToNumber(value);
}

function normalizeReceiptStatus(
  status: unknown,
): TransactionReceipt["status"] | undefined {
  if (status === "success" || status === "reverted") {
    return status;
  }

  if (status === "0x1") {
    return "success";
  }

  if (status === "0x0") {
    return "reverted";
  }

  return undefined;
}

function normalizeTransactionType(
  value: unknown,
): TransactionReceipt["type"] | undefined {
  if (
    value === "legacy" ||
    value === "eip2930" ||
    value === "eip1559" ||
    value === "eip4844" ||
    value === "eip7702"
  ) {
    return value;
  }

  if (value === "0x0") return "legacy";
  if (value === "0x1") return "eip2930";
  if (value === "0x2") return "eip1559";
  if (value === "0x3") return "eip4844";
  if (value === "0x4") return "eip7702";

  return undefined;
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
