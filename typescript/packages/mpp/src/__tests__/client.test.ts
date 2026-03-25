import { Challenge, Credential } from "mppx";
import type {
  Address,
  Hex,
  PublicClient,
  TransactionReceipt,
  WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as SharedMethods from "../Methods.js";
import { megaethTestnet } from "../constants.js";
import { charge as clientCharge } from "../client/Charge.js";
import { submitTransaction } from "../utils/rpc.js";

vi.mock("../utils/rpc.js", () => ({
  submitTransaction: vi.fn(),
}));

type ChargeChallenge = Challenge.Challenge<
  SharedMethods.ChargeRequest,
  typeof SharedMethods.charge.intent,
  typeof SharedMethods.charge.name
>;

const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f094538c5f1d2c75e7d70ce2f3fba8c8a55f5d42",
);
const permit2Address = "0x3333333333333333333333333333333333333333";
const tokenAddress = "0x1111111111111111111111111111111111111111";
const recipientAddress = "0x2222222222222222222222222222222222222222";
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
      walletClient: createWalletClientStub(),
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

  it("emits the same stable sequence for broadcast hash credentials", async () => {
    const progress: Array<{ signature?: Hex | undefined; type: string }> = [];
    const hash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    mockedSubmitTransaction.mockResolvedValueOnce(
      createTransactionReceipt(hash),
    );

    const method = clientCharge({
      account: payer,
      broadcast: true,
      onProgress(event) {
        progress.push(
          event.type === "paid"
            ? { signature: event.signature, type: event.type }
            : { type: event.type },
        );
      },
      publicClient: {} as PublicClient,
      walletClient: createWalletClientStub(),
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
      { signature: hash, type: "paid" },
    ]);
    expect(credential.payload).toEqual({
      hash,
      type: "hash",
    });
    expect(mockedSubmitTransaction).toHaveBeenCalledOnce();
  });
});

function createChallenge(): ChargeChallenge {
  return Challenge.fromMethod(SharedMethods.charge, {
    expires: new Date(Date.now() + 60_000).toISOString(),
    realm: "tests.megaeth.local",
    request: {
      amount: "1000",
      currency: tokenAddress,
      methodDetails: {
        chainId: megaethTestnet.id,
        permit2Address,
      },
      recipient: recipientAddress,
    },
    secretKey: "client-test-secret",
  }) as ChargeChallenge;
}

function createWalletClientStub(): WalletClient {
  return {
    account: payer,
    async signTypedData(parameters: {
      domain: Record<string, unknown>;
      message: Record<string, unknown>;
      primaryType: string;
      types: Record<string, Array<{ name: string; type: string }>>;
    }) {
      return await payer.signTypedData(parameters);
    },
  } as unknown as WalletClient;
}

function createTransactionReceipt(hash: Hex): TransactionReceipt {
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
  } as unknown as TransactionReceipt;
}
