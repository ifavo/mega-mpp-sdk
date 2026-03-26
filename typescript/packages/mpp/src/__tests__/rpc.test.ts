import {
  custom,
  createPublicClient,
  keccak256,
  MethodNotFoundRpcError,
} from "viem";
import type * as ViemActionsModule from "viem/actions";
import {
  prepareTransactionRequest,
  sendRawTransaction,
  sendTransaction,
  signTransaction,
  waitForTransactionReceipt,
} from "viem/actions";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { megaethTestnet } from "../constants.js";
import { sendSignedTransaction, submitTransaction } from "../utils/rpc.js";
import {
  createLocalWalletClient,
  createTransactionReceipt,
} from "./fixtures/chargeTestkit.js";

vi.mock("viem/actions", async () => {
  const actual =
    await vi.importActual<typeof ViemActionsModule>("viem/actions");

  return {
    ...actual,
    prepareTransactionRequest: vi.fn(),
    sendRawTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    signTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  };
});

const mockedPrepareTransactionRequest = vi.mocked(prepareTransactionRequest);
const mockedSendRawTransaction = vi.mocked(sendRawTransaction);
const mockedSendTransaction = vi.mocked(sendTransaction);
const mockedSignTransaction = vi.mocked(signTransaction);
const mockedWaitForTransactionReceipt = vi.mocked(waitForTransactionReceipt);

describe("rpc submission", () => {
  beforeEach(() => {
    mockedPrepareTransactionRequest.mockReset();
    mockedSendRawTransaction.mockReset();
    mockedSendTransaction.mockReset();
    mockedSignTransaction.mockReset();
    mockedWaitForTransactionReceipt.mockReset();
  });

  it("submits sync transactions explicitly when the caller configures sync mode", async () => {
    const hash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const publicClient = createRequestDrivenPublicClient(async ({ method }) => {
      if (method === "eth_sendRawTransactionSync") {
        return hash;
      }

      throw new Error(`Unexpected request method: ${method}`);
    });
    mockedWaitForTransactionReceipt.mockResolvedValueOnce(
      createTransactionReceipt(hash),
    );

    const receipt = await sendSignedTransaction(publicClient, "0x1234", "sync");

    expect(receipt.transactionHash).toBe(hash);
    expect(mockedWaitForTransactionReceipt).toHaveBeenCalledWith(publicClient, {
      hash,
    });
  });

  it("returns an instructive error when sync submission is unsupported", async () => {
    const publicClient = createRequestDrivenPublicClient(async ({ method }) => {
      if (method === "eth_sendRawTransactionSync") {
        throw new MethodNotFoundRpcError(new Error("missing method"));
      }

      throw new Error(`Unexpected request method: ${method}`);
    });

    await expect(
      sendSignedTransaction(publicClient, "0x1234", "sync"),
    ).rejects.toThrowError(
      /Set submissionMode to realtime or sendAndWait before retrying/i,
    );
  });

  it("propagates explicit sync submission errors instead of downgrading them", async () => {
    const publicClient = createRequestDrivenPublicClient(async ({ method }) => {
      if (method === "eth_sendRawTransactionSync") {
        throw new Error("MegaETH sync submission failed.");
      }

      return undefined;
    });

    await expect(
      sendSignedTransaction(publicClient, "0x1234", "sync"),
    ).rejects.toThrowError("MegaETH sync submission failed.");
  });

  it("uses sendAndWait submission directly when the caller configures that mode", async () => {
    const hash =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const publicClient = createRequestDrivenPublicClient(async () => {
      throw new Error(
        "sendAndWait mode should not issue MegaETH RPC submission requests.",
      );
    });
    mockedSendRawTransaction.mockResolvedValueOnce(hash);
    mockedWaitForTransactionReceipt.mockResolvedValueOnce(
      createTransactionReceipt(hash),
    );

    const receipt = await sendSignedTransaction(
      publicClient,
      "0x1234",
      "sendAndWait",
    );

    expect(receipt.transactionHash).toBe(hash);
    expect(mockedSendRawTransaction).toHaveBeenCalledWith(publicClient, {
      serializedTransaction: "0x1234",
    });
  });

  it("normalizes realtime receipt payloads without waiting for a second receipt lookup", async () => {
    const hash =
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const publicClient = createRequestDrivenPublicClient(async ({ method }) => {
      if (method === "realtime_sendRawTransaction") {
        return {
          blockHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
          blockNumber: "0x10",
          contractAddress: null,
          cumulativeGasUsed: "0x11dde",
          effectiveGasPrice: "0x23ebdf",
          from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          gasUsed: "0x5208",
          logs: [],
          logsBloom: "0x0",
          status: "0x1",
          to: "0xa7b8c275b3dde39e69a5c0ffd9f34f974364941a",
          transactionHash: hash,
          transactionIndex: "0x1",
          type: "0x0",
        };
      }

      throw new Error(`Unexpected request method: ${method}`);
    });

    const receipt = await sendSignedTransaction(
      publicClient,
      "0x1234",
      "realtime",
    );

    expect(receipt.transactionHash).toBe(hash);
    expect(receipt.status).toBe("success");
    expect(mockedWaitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("waits for the derived transaction hash when realtime submission expires", async () => {
    const publicClient = createRequestDrivenPublicClient(async ({ method }) => {
      if (method === "realtime_sendRawTransaction") {
        throw new Error("realtime transaction expired");
      }

      throw new Error(`Unexpected request method: ${method}`);
    });
    const expectedHash = keccak256("0x1234");
    mockedWaitForTransactionReceipt.mockResolvedValueOnce(
      createTransactionReceipt(expectedHash),
    );

    const receipt = await sendSignedTransaction(
      publicClient,
      "0x1234",
      "realtime",
    );

    expect(receipt.transactionHash).toBe(expectedHash);
    expect(mockedWaitForTransactionReceipt).toHaveBeenCalledWith(publicClient, {
      hash: expectedHash,
    });
    expect(mockedSendRawTransaction).not.toHaveBeenCalled();
  });

  it("uses wallet sendTransaction within sendAndWait mode when raw signing is unsupported", async () => {
    const hash =
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const publicClient = createRequestDrivenPublicClient(async () => {
      throw new Error(
        "sendAndWait mode should not issue MegaETH RPC submission requests.",
      );
    });
    const walletClient = createLocalWalletClient();
    mockedPrepareTransactionRequest.mockResolvedValueOnce({
      account: walletClient.account,
      chain: megaethTestnet,
      data: "0x1234",
      to: "0x1111111111111111111111111111111111111111",
    } as Awaited<ReturnType<typeof prepareTransactionRequest>>);
    mockedSignTransaction.mockRejectedValueOnce({
      code: 4200,
      message: "signTransaction is not supported by this wallet.",
    });
    mockedSendTransaction.mockResolvedValueOnce(hash);
    mockedWaitForTransactionReceipt.mockResolvedValueOnce(
      createTransactionReceipt(hash),
    );

    const receipt = await submitTransaction({
      account: walletClient.account,
      chainId: megaethTestnet.id,
      data: "0x1234",
      publicClient,
      submissionMode: "sendAndWait",
      to: "0x1111111111111111111111111111111111111111",
      walletClient,
    });

    expect(receipt.transactionHash).toBe(hash);
    expect(mockedSendTransaction).toHaveBeenCalledOnce();
  });

  it("returns an instructive error when sync submission requires raw signing support", async () => {
    const publicClient = createRequestDrivenPublicClient(async () => "0x");
    const walletClient = createLocalWalletClient();
    mockedPrepareTransactionRequest.mockResolvedValueOnce({
      account: walletClient.account,
      chain: megaethTestnet,
      data: "0x1234",
      to: "0x1111111111111111111111111111111111111111",
    } as Awaited<ReturnType<typeof prepareTransactionRequest>>);
    mockedSignTransaction.mockRejectedValueOnce({
      code: 4200,
      message: "signTransaction is not supported by this wallet.",
    });

    await expect(
      submitTransaction({
        account: walletClient.account,
        chainId: megaethTestnet.id,
        data: "0x1234",
        publicClient,
        submissionMode: "sync",
        to: "0x1111111111111111111111111111111111111111",
        walletClient,
      }),
    ).rejects.toThrowError(
      /Set submissionMode to sendAndWait before retrying/i,
    );
  });

  it("propagates signing errors when the wallet actually supports raw signing", async () => {
    const publicClient = createRequestDrivenPublicClient(async () => "0x");
    const walletClient = createLocalWalletClient();
    mockedPrepareTransactionRequest.mockResolvedValueOnce({
      account: walletClient.account,
      chain: megaethTestnet,
      data: "0x1234",
      to: "0x1111111111111111111111111111111111111111",
    } as Awaited<ReturnType<typeof prepareTransactionRequest>>);
    mockedSignTransaction.mockRejectedValueOnce(
      new Error("The raw transaction is invalid."),
    );

    await expect(
      submitTransaction({
        account: walletClient.account,
        chainId: megaethTestnet.id,
        data: "0x1234",
        publicClient,
        submissionMode: "sync",
        to: "0x1111111111111111111111111111111111111111",
        walletClient,
      }),
    ).rejects.toThrowError("The raw transaction is invalid.");
  });
});

function createRequestDrivenPublicClient(
  request: (parameters: {
    method: string;
    params?: readonly unknown[] | undefined;
  }) => Promise<unknown>,
) {
  return createPublicClient({
    chain: megaethTestnet,
    transport: custom({
      request,
    }),
  });
}
