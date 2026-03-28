import { Errors } from "mppx";
import { Store } from "mppx/server";
import type { Address } from "viem";
import type * as ViemActionsModule from "viem/actions";
import { call, readContract } from "viem/actions";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { megaethTestnet } from "../constants.js";
import { charge as clientCharge } from "../client/Charge.js";
import { charge as serverCharge } from "../server/Charge.js";
import { submitTransaction } from "../utils/rpc.js";
import {
  capturePaymentError,
  createChallenge,
  createHashCredential,
  createLocalWalletClient,
  createStaticPublicClient,
  createTransactionReceipt,
  deserializeChargeCredential,
  payer,
  permit2Address,
  recipientAddress,
  tokenAddress,
} from "./fixtures/chargeTestkit.js";

vi.mock("../utils/rpc.js", () => ({
  submitTransaction: vi.fn(),
}));

vi.mock("viem/actions", async () => {
  const actual =
    await vi.importActual<typeof ViemActionsModule>("viem/actions");

  return {
    ...actual,
    call: vi.fn(),
    readContract: vi.fn(),
  };
});

const mockedCall = vi.mocked(call);
const mockedReadContract = vi.mocked(readContract);
const mockedSubmitTransaction = vi.mocked(submitTransaction);

describe("megaeth charge server errors", () => {
  beforeEach(() => {
    mockedCall.mockReset();
    mockedReadContract.mockReset();
    mockedSubmitTransaction.mockReset();
  });

  it("defaults server-broadcast Permit2 settlement to realtime submission", async () => {
    const hash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const challenge = createChallenge({
      secretKey: "server-test-secret",
      request: {
        amount: "1000",
        currency: tokenAddress,
        methodDetails: {
          chainId: megaethTestnet.id,
          permit2Address,
        },
        recipient: payer.address,
      },
    });
    const clientMethod = clientCharge({
      account: payer,
      walletClient: createLocalWalletClient(),
    });
    const credential = deserializeChargeCredential(
      await clientMethod.createCredential({ challenge }),
    );

    mockedReadContract
      .mockResolvedValueOnce(1_000n)
      .mockResolvedValueOnce(1_000n);
    mockedCall.mockResolvedValue({ data: "0x" } as Awaited<
      ReturnType<typeof call>
    >);
    mockedSubmitTransaction.mockResolvedValueOnce(
      createTransactionReceipt(hash),
    );

    const receipt = await createServerMethod(Store.memory(), {
      recipient: payer.address,
      walletClient: createLocalWalletClient(),
    }).verify({
      credential,
      request: challenge.request,
    });

    expect(receipt.reference).toBe(hash);
    expect(mockedSubmitTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionMode: "realtime",
      }),
    );
    expect(mockedCall).toHaveBeenCalledOnce();
  });

  it("returns RFC 9457 invalid-challenge problem details for expired challenges", async () => {
    const challenge = createChallenge({
      expires: new Date(Date.now() - 1_000).toISOString(),
      secretKey: "server-test-secret",
    });
    const error = await capturePaymentError(
      createServerMethod(Store.memory()).verify({
        credential: createHashCredential(challenge),
        request: challenge.request,
      }),
    );

    expect(error).toBeInstanceOf(Errors.InvalidChallengeError);
    expect(error.toProblemDetails(challenge.id)).toMatchObject({
      challengeId: challenge.id,
      status: 402,
      title: "Invalid Challenge",
      type: "https://paymentauth.org/problems/invalid-challenge",
    });
  });

  it("returns RFC 9457 problem details for replayed challenges", async () => {
    const store = Store.memory();
    const challenge = createChallenge();
    await store.put(`megaeth:charge:challenge:${challenge.id}`, "0xused");

    const error = await capturePaymentError(
      createServerMethod(store).verify({
        credential: createHashCredential(challenge),
        request: challenge.request,
      }),
    );

    expect(error).toBeInstanceOf(Errors.InvalidChallengeError);
    expect(error.toProblemDetails(challenge.id)).toMatchObject({
      challengeId: challenge.id,
      status: 402,
      title: "Invalid Challenge",
      type: "https://paymentauth.org/problems/invalid-challenge",
    });
    expect(error.message).toMatch(/fresh payment challenge/i);
  });

  it("returns RFC 9457 verification-failed problem details for hash payloads on fee-sponsored challenges", async () => {
    const challenge = createChallenge({
      secretKey: "server-test-secret",
      request: {
        amount: "1000",
        currency: tokenAddress,
        methodDetails: {
          chainId: megaethTestnet.id,
          feePayer: true,
          permit2Address,
        },
        recipient: recipientAddress,
      },
    });

    const error = await capturePaymentError(
      createServerMethod(Store.memory()).verify({
        credential: createHashCredential(challenge),
        request: challenge.request,
      }),
    );

    expect(error).toBeInstanceOf(Errors.VerificationFailedError);
    expect(error.toProblemDetails(challenge.id)).toMatchObject({
      challengeId: challenge.id,
      status: 402,
      title: "Verification Failed",
      type: "https://paymentauth.org/problems/verification-failed",
    });
    expect(error.message).toMatch(
      /Permit2 credential instead of a hash credential/i,
    );
  });
});

function createServerMethod(
  store: Store.Store,
  overrides: Partial<Parameters<typeof serverCharge>[0]> = {},
) {
  return serverCharge({
    currency: tokenAddress as Address,
    publicClient: createStaticPublicClient(),
    recipient: recipientAddress as Address,
    store,
    ...overrides,
  });
}
