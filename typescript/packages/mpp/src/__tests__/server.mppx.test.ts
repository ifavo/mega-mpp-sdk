import { Challenge, Receipt } from "mppx";
import { Transport } from "mppx/server";
import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { megaethTestnet } from "../constants.js";
import { Mppx, megaeth } from "../server/index.js";
import {
  permit2Address,
  recipientAddress,
  tokenAddress,
} from "./fixtures/chargeTestkit.js";

const settlementAccount = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d6cbf7642df0f4632ae8da86f7a5376a3f1f9a1",
);
const alternateRecipient =
  "0x4444444444444444444444444444444444444444" as const;
const alternateToken = "0x5555555555555555555555555555555555555555" as const;
const escrowAddress = "0x6666666666666666666666666666666666666666" as const;

describe("server Mppx defaults", () => {
  it("inherits create-level charge defaults so request handlers only need amount", async () => {
    const mppx = Mppx.create({
      account: settlementAccount,
      chainId: megaethTestnet.id,
      currency: tokenAddress as Address,
      methods: [megaeth.charge()],
      permit2Address: permit2Address as Address,
      recipient: settlementAccount.address,
      realm: "tests.megaeth.local",
      secretKey: "server-test-secret",
    });

    const result = await mppx.megaeth.charge({
      amount: "1000",
    })(new Request("https://tests.megaeth.local/charge"));

    expect(result.status).toBe(402);
    if (result.status !== 402) {
      throw new Error(
        "Issue a payment challenge before asserting charge defaults.",
      );
    }
    const challenge = Challenge.fromResponse(result.challenge, {
      methods: mppx.methods,
    });

    expect(challenge.request.currency).toBe(getAddress(tokenAddress));
    expect(challenge.request.recipient).toBe(settlementAccount.address);
    expect(challenge.request.methodDetails.chainId).toBe(megaethTestnet.id);
    expect(challenge.request.methodDetails.permit2Address).toBe(
      getAddress(permit2Address),
    );
  });

  it("lets method-level charge defaults override create-level defaults", async () => {
    const mppx = Mppx.create({
      chainId: megaethTestnet.id,
      currency: tokenAddress as Address,
      methods: [
        megaeth.charge({
          currency: alternateToken as Address,
          permit2Address: permit2Address as Address,
          recipient: alternateRecipient as Address,
        }),
      ],
      recipient: recipientAddress as Address,
      realm: "tests.megaeth.local",
      secretKey: "server-test-secret",
    });

    const result = await mppx.megaeth.charge({
      amount: "1000",
    })(new Request("https://tests.megaeth.local/charge"));

    expect(result.status).toBe(402);
    if (result.status !== 402) {
      throw new Error(
        "Issue a payment challenge before asserting charge override defaults.",
      );
    }
    const challenge = Challenge.fromResponse(result.challenge, {
      methods: mppx.methods,
    });

    expect(challenge.request.currency).toBe(getAddress(alternateToken));
    expect(challenge.request.recipient).toBe(getAddress(alternateRecipient));
  });

  it("inherits create-level account and chain defaults for session challenges", async () => {
    const mppx = Mppx.create({
      account: settlementAccount,
      chainId: megaethTestnet.id,
      currency: tokenAddress as Address,
      recipient: settlementAccount.address,
      methods: [
        megaeth.session({
          escrowContract: escrowAddress as Address,
          settlement: {
            close: { enabled: true },
            periodic: {
              intervalSeconds: 3600,
              minUnsettledAmount: "200000",
            },
          },
          suggestedDeposit: "500000",
          unitType: "request",
        }),
      ],
      realm: "tests.megaeth.local",
      secretKey: "server-test-secret",
    });

    const result = await mppx.megaeth.session({
      amount: "100000",
    })(new Request("https://tests.megaeth.local/session"));

    expect(result.status).toBe(402);
    if (result.status !== 402) {
      throw new Error(
        "Issue a payment challenge before asserting session defaults.",
      );
    }
    const challenge = Challenge.fromResponse(result.challenge, {
      methods: mppx.methods,
    });

    expect(challenge.request.currency).toBe(getAddress(tokenAddress));
    expect(challenge.request.recipient).toBe(settlementAccount.address);
    expect(challenge.request.methodDetails.chainId).toBe(megaethTestnet.id);
    expect(challenge.request.methodDetails.escrowContract).toBe(
      getAddress(escrowAddress),
    );
  });

  it("keeps instructive errors when charge defaults cannot resolve a recipient", async () => {
    const method = megaeth.charge({
      chainId: megaethTestnet.id,
    });

    await expect(
      method.request?.({
        credential: undefined,
        request: {
          amount: "1000",
          currency: tokenAddress,
          methodDetails: {},
          recipient: undefined as never,
        },
      }),
    ).rejects.toThrowError(/Provide a recipient address/i);
  });

  it("defaults charge requests to MegaETH mainnet when no chain selector is supplied", async () => {
    const method = megaeth.charge({
      recipient: recipientAddress as Address,
    });

    await expect(
      method.request?.({
        credential: undefined,
        request: {
          amount: "1000",
          currency: tokenAddress,
          methodDetails: {},
          recipient: undefined as never,
        },
      }),
    ).resolves.toMatchObject({
      methodDetails: {
        chainId: 4326,
      },
    });
  });

  it("prefers the testnet flag over an explicit chain id for charge requests", async () => {
    const method = megaeth.charge({
      recipient: recipientAddress as Address,
    });

    await expect(
      method.request?.({
        credential: undefined,
        request: {
          amount: "1000",
          currency: tokenAddress,
          methodDetails: {
            chainId: 4326,
            testnet: true,
          },
          recipient: undefined as never,
        },
      }),
    ).resolves.toMatchObject({
      methodDetails: {
        chainId: megaethTestnet.id,
        testnet: true,
      },
    });
  });

  it("serializes the raw Payment-Receipt header with challengeId on the default HTTP transport", async () => {
    const mppx = Mppx.create({
      methods: [
        megaeth.charge({
          currency: tokenAddress as Address,
          recipient: recipientAddress as Address,
        }),
      ],
      realm: "tests.megaeth.local",
      secretKey: "server-test-secret",
    });
    const response = mppx.transport.respondReceipt({
      challengeId: "challenge-123",
      receipt: Receipt.from({
        method: "megaeth",
        reference:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "success",
        timestamp: "2026-03-28T09:00:00.000Z",
      }),
      response: new Response("ok"),
    });
    const encodedReceipt = response.headers.get("Payment-Receipt");
    if (!encodedReceipt) {
      throw new Error(
        "Attach a Payment-Receipt header before asserting challengeId serialization.",
      );
    }

    const rawReceipt = JSON.parse(
      Buffer.from(encodedReceipt, "base64url").toString("utf8"),
    ) as {
      challengeId: string;
      method: string;
      reference: string;
    };

    expect(rawReceipt).toMatchObject({
      challengeId: "challenge-123",
      method: "megaeth",
      reference:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("preserves user-supplied transports instead of forcing the local HTTP override", async () => {
    const transport = Transport.from({
      name: "custom-test",
      getCredential() {
        return null;
      },
      respondChallenge() {
        return { kind: "challenge" as const };
      },
      respondReceipt() {
        return { kind: "receipt" as const };
      },
    });
    const mppx = Mppx.create({
      methods: [
        megaeth.charge({
          currency: tokenAddress as Address,
          recipient: recipientAddress as Address,
        }),
      ],
      realm: "tests.megaeth.local",
      secretKey: "server-test-secret",
      transport,
    });

    const result = await mppx.megaeth.charge({
      amount: "1000",
      methodDetails: {
        chainId: megaethTestnet.id,
      },
    })({});

    expect(result).toEqual({
      challenge: { kind: "challenge" },
      status: 402,
    });
  });
});
