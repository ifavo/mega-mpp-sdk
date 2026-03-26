import { Challenge } from "mppx";
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

  it("keeps instructive errors when charge defaults cannot resolve a chain id", async () => {
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
    ).rejects.toThrowError(/Provide chainId/i);
  });
});
