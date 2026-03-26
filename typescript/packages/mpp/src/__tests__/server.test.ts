import { Errors } from "mppx";
import { Store } from "mppx/server";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import { megaethTestnet } from "../constants.js";
import { charge as clientCharge } from "../client/Charge.js";
import { charge as serverCharge } from "../server/Charge.js";
import {
  capturePaymentError,
  createChallenge,
  createHashCredential,
  createLocalWalletClient,
  createStaticPublicClient,
  deserializeChargeCredential,
  payer,
  permit2Address,
  recipientAddress,
  tokenAddress,
} from "./fixtures/chargeTestkit.js";

describe("megaeth charge server errors", () => {
  it("returns RFC 9457 problem details for expired challenges", async () => {
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

  it("requires an explicit submission mode for server-broadcast Permit2 settlement", async () => {
    const challenge = createChallenge({
      secretKey: "server-test-secret",
    });
    const clientMethod = clientCharge({
      account: payer,
      walletClient: createLocalWalletClient(),
    });
    const credential = deserializeChargeCredential(
      await clientMethod.createCredential({ challenge }),
    );

    await expect(
      createServerMethod(Store.memory()).verify({
        credential,
        request: challenge.request,
      }),
    ).rejects.toThrowError(
      /Set submissionMode for the server-broadcast Permit2 flow to sync, realtime, or sendAndWait/i,
    );
  });
});

function createServerMethod(store: Store.Store) {
  return serverCharge({
    currency: tokenAddress as Address,
    publicClient: createStaticPublicClient(),
    recipient: recipientAddress as Address,
    store,
  });
}
