import { Credential } from "mppx";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as SharedMethods from "../Methods.js";
import { charge as clientCharge } from "../client/Charge.js";
import {
  createChallenge,
  createLocalWalletClient,
  createStaticPublicClient,
  createTransactionReceipt,
  payer,
} from "./fixtures/chargeTestkit.js";
import { submitTransaction } from "../utils/rpc.js";

vi.mock("../utils/rpc.js", () => ({
  submitTransaction: vi.fn(),
}));

const mockedSubmitTransaction = vi.mocked(submitTransaction);

describe("megaeth charge client progress", () => {
  beforeEach(() => {
    mockedSubmitTransaction.mockReset();
  });

  it("emits a stable progress sequence for direct Permit2 credentials", async () => {
    const progress: Array<string> = [];
    const method = clientCharge({
      account: payer,
      onProgress(event) {
        progress.push(event.type);
      },
      walletClient: createLocalWalletClient(),
    });

    const serialized = await method.createCredential({
      challenge: createChallenge(),
    });
    const credential =
      Credential.deserialize<SharedMethods.ChargeCredentialPayload>(serialized);

    expect(progress).toEqual([
      "challenge",
      "signing",
      "signed",
      "paying",
      "confirming",
      "paid",
    ]);
    expect(credential.payload.type).toBe("permit2");
  });

  it("emits the same stable sequence for transaction-hash credentials", async () => {
    const progress: Array<{ transactionHash?: Hex | undefined; type: string }> =
      [];
    const hash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    mockedSubmitTransaction.mockResolvedValueOnce(
      createTransactionReceipt(hash),
    );

    const method = clientCharge({
      account: payer,
      credentialMode: "hash",
      onProgress(event) {
        progress.push(
          event.type === "paid"
            ? { transactionHash: event.transactionHash, type: event.type }
            : { type: event.type },
        );
      },
      publicClient: createStaticPublicClient(),
      submissionMode: "sendAndWait",
      walletClient: createLocalWalletClient(),
    });

    const serialized = await method.createCredential({
      challenge: createChallenge(),
    });
    const credential =
      Credential.deserialize<SharedMethods.ChargeCredentialPayload>(serialized);

    expect(progress).toEqual([
      { type: "challenge" },
      { type: "signing" },
      { type: "paying" },
      { type: "confirming" },
      { transactionHash: hash, type: "paid" },
    ]);
    expect(credential.payload).toEqual({
      hash,
      type: "hash",
    });
    expect(mockedSubmitTransaction).toHaveBeenCalledOnce();
  });

  it("defaults transaction-hash credentials to realtime submission", async () => {
    const hash =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    mockedSubmitTransaction.mockResolvedValueOnce(
      createTransactionReceipt(hash),
    );
    const method = clientCharge({
      account: payer,
      credentialMode: "hash",
      publicClient: createStaticPublicClient(),
      walletClient: createLocalWalletClient(),
    });

    await method.createCredential({
      challenge: createChallenge(),
    });

    expect(mockedSubmitTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionMode: "realtime",
      }),
    );
  });
});
