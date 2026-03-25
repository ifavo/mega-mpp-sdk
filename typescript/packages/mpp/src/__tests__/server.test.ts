import { Challenge, Credential, Errors } from "mppx";
import { Store } from "mppx/server";
import type { Address, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import * as SharedMethods from "../Methods.js";
import { megaethTestnet } from "../constants.js";
import { charge as serverCharge } from "../server/Charge.js";
import { createDidPkhSource } from "../utils/source.js";

type ChargeChallenge = Challenge.Challenge<
  SharedMethods.ChargeRequest,
  typeof SharedMethods.charge.intent,
  typeof SharedMethods.charge.name
>;

type ChargeCredential = Credential.Credential<
  SharedMethods.ChargeCredentialPayload,
  ChargeChallenge
>;

const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f094538c5f1d2c75e7d70ce2f3fba8c8a55f5d42",
);
const tokenAddress = "0x1111111111111111111111111111111111111111";
const recipientAddress = "0x2222222222222222222222222222222222222222";
const permit2Address = "0x3333333333333333333333333333333333333333";

describe("megaeth charge server errors", () => {
  it("returns RFC 9457 problem details for expired challenges", async () => {
    const challenge = createChallenge({
      expires: new Date(Date.now() - 1_000).toISOString(),
    });
    const error = await capturePaymentError(
      createServerMethod(Store.memory()).verify({
        credential: createHashCredential(challenge),
        request: challenge.request,
      }),
    );

    expect(error).toBeInstanceOf(Errors.PaymentExpiredError);
    expect(error.toProblemDetails(challenge.id)).toMatchObject({
      challengeId: challenge.id,
      status: 402,
      title: "Payment Expired",
      type: "https://paymentauth.org/problems/payment-expired",
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

  it("returns RFC 9457 problem details for hash payloads on fee-sponsored challenges", async () => {
    const challenge = createChallenge({
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

    expect(error).toBeInstanceOf(Errors.InvalidPayloadError);
    expect(error.toProblemDetails(challenge.id)).toMatchObject({
      challengeId: challenge.id,
      status: 402,
      title: "Invalid Payload",
      type: "https://paymentauth.org/problems/invalid-payload",
    });
    expect(error.message).toMatch(
      /Permit2 credential instead of a hash credential/i,
    );
  });
});

function createServerMethod(store: Store.Store) {
  return serverCharge({
    currency: tokenAddress as Address,
    publicClient: {} as PublicClient,
    recipient: recipientAddress as Address,
    store,
    testnet: true,
  });
}

function createChallenge(
  overrides?: Partial<{
    expires: string;
    request: SharedMethods.ChargeRequest;
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
    secretKey: "server-test-secret",
  }) as ChargeChallenge;
}

function createHashCredential(challenge: ChargeChallenge): ChargeCredential {
  return Credential.from({
    challenge,
    payload: {
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      type: "hash",
    },
    source: createDidPkhSource(megaethTestnet.id, payer.address),
  }) as ChargeCredential;
}

async function capturePaymentError(
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
    "Reject the MegaETH payment request before asserting its problem details.",
  );
}
