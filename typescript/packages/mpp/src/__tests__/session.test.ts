import { Credential, Receipt } from "mppx";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import type { SessionReceipt } from "../Methods.js";
import { computeSessionChannelId, ZERO_ADDRESS } from "../session/channel.js";
import {
  createMemorySessionClientStore,
  createSessionChannelStore,
  getSessionChannelKey,
  getSessionClientScopeKey,
} from "../session/store.js";
import {
  buildSessionVoucherTypedData,
  recoverSessionVoucherSigner,
} from "../session/voucher.js";

const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f094538c5f1d2c75e7d70ce2f3fba8c8a55f5d42",
);

describe("session helpers", () => {
  it("computes deterministic channel identifiers", () => {
    const channelId = computeSessionChannelId({
      authorizedSigner: ZERO_ADDRESS,
      chainId: 6343,
      escrowContract: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222",
      payer: "0x3333333333333333333333333333333333333333",
      salt: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      token: "0x4444444444444444444444444444444444444444",
    });

    expect(channelId).toBe(
      "0x5b0f03aabe23f00ef2eb64139326eefb6b8f3ac01555c353915d7b0924b92bd0",
    );
  });

  it("signs and recovers vouchers with the contract domain", async () => {
    const typedData = buildSessionVoucherTypedData({
      chainId: 6343,
      channelId:
        "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4",
      cumulativeAmount: 2_000n,
      escrowContract: "0x1111111111111111111111111111111111111111",
    });
    const signature = await payer.signTypedData(typedData);

    const recovered = await recoverSessionVoucherSigner({
      chainId: 6343,
      channelId: typedData.message.channelId,
      cumulativeAmount: typedData.message.cumulativeAmount,
      escrowContract: typedData.domain.verifyingContract,
      signature,
    });

    expect(recovered).toBe(payer.address);
  });

  it("keeps session receipts compatible with mppx payment receipts", () => {
    const serialized = Receipt.serialize(
      Receipt.from({
        externalId: "session-demo",
        method: "megaeth",
        reference:
          "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4",
        status: "success",
        timestamp: "2026-03-25T18:00:00.000Z",
      }),
    );
    const roundTrip = Receipt.deserialize(serialized) as SessionReceipt;

    expect(roundTrip).toEqual({
      externalId: "session-demo",
      method: "megaeth",
      reference:
        "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4",
      status: "success",
      timestamp: "2026-03-25T18:00:00.000Z",
    });
  });

  it("stores client and server session state under deterministic keys", async () => {
    const clientStore = createMemorySessionClientStore();
    const rawStore = new Map<string, unknown>();
    const channelStore = createSessionChannelStore({
      delete(key) {
        rawStore.delete(key);
      },
      get(key) {
        return rawStore.get(key);
      },
      put(key, value) {
        rawStore.set(key, value);
      },
    });

    const scopeKey = getSessionClientScopeKey({
      chainId: 6343,
      currency: "0x1111111111111111111111111111111111111111",
      escrowContract: "0x2222222222222222222222222222222222222222",
      recipient: "0x3333333333333333333333333333333333333333",
      unitType: "request",
    });
    const channelKey = getSessionChannelKey({
      chainId: 6343,
      channelId:
        "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4",
      escrowContract: "0x2222222222222222222222222222222222222222",
    });

    await clientStore.put(scopeKey, {
      acceptedCumulative: "1000",
      chainId: 6343,
      channelId:
        "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4",
      currency: "0x1111111111111111111111111111111111111111",
      deposit: "3000",
      escrowContract: "0x2222222222222222222222222222222222222222",
      payer: payer.address,
      recipient: "0x3333333333333333333333333333333333333333",
      signerMode: "wallet",
      status: "open",
      unitType: "request",
      unsettledCumulative: "1000",
    });

    await channelStore.updateChannel(channelKey, () => ({
      acceptedCumulative: "1000",
      chainId: 6343,
      channelId:
        "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4",
      currency: "0x1111111111111111111111111111111111111111",
      deposit: "3000",
      escrowContract: "0x2222222222222222222222222222222222222222",
      payer: payer.address,
      recipient: "0x3333333333333333333333333333333333333333",
      settled: "0",
      status: "open",
      unitType: "request",
    }));

    expect(await clientStore.get(scopeKey)).toMatchObject({
      acceptedCumulative: "1000",
      deposit: "3000",
    });
    expect(await channelStore.getChannel(channelKey)).toMatchObject({
      acceptedCumulative: "1000",
      settled: "0",
    });
  });

  it("serializes session credentials with the same authorization wrapper as other mppx methods", () => {
    const credential = Credential.serialize({
      challenge: {
        id: "session-challenge",
        intent: "session",
        method: "megaeth",
        realm: "tests.megaeth.local",
        request: {
          amount: "1000",
          currency: "0x1111111111111111111111111111111111111111",
          methodDetails: {
            chainId: 6343,
            escrowContract: "0x2222222222222222222222222222222222222222",
          },
          recipient: "0x3333333333333333333333333333333333333333",
        },
      },
      payload: {
        action: "voucher",
        channelId:
          "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4",
        cumulativeAmount: "1000",
        signature: "0x1234",
      },
      source: `did:pkh:eip155:6343:${payer.address}`,
    });

    expect(credential.startsWith("Payment ")).toBe(true);
  });
});
