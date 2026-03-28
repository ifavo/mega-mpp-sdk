import { Challenge, Credential, Errors } from "mppx";
import { Store } from "mppx/server";
import { createPublicClient, custom, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import * as Methods from "../Methods.js";
import { megaethTestnet } from "../constants.js";
import { charge as serverCharge } from "../server/Charge.js";
import { session as serverSession } from "../server/Session.js";
import type {
  SessionChannelState,
  SessionChannelStore,
} from "../session/store.js";
import { getSessionChannelKey } from "../session/store.js";
import { buildSessionVoucherTypedData } from "../session/voucher.js";
import {
  buildTypedData,
  createPermitPayload,
  encodePermit2Calldata,
} from "../utils/permit2.js";
import {
  createChallenge,
  createHashCredential,
  payer,
  permit2Address,
  recipientAddress,
  tokenAddress,
} from "./fixtures/chargeTestkit.js";

type SessionChallenge = Challenge.Challenge<
  Methods.SessionRequest,
  typeof Methods.session.intent,
  typeof Methods.session.name
>;

type SessionCredential = Credential.Credential<
  Methods.SessionCredentialPayload,
  SessionChallenge
>;

describe("concurrent replay protection", () => {
  it("rejects concurrent hash verification for the same charge challenge", async () => {
    const challenge = createChallenge();
    const credential = createHashCredential(challenge);
    const method = serverCharge({
      currency: tokenAddress as Address,
      publicClient: createHashVerificationPublicClient({
        challenge: challenge.request,
        hash: (credential.payload as Methods.ChargeHashPayload).hash as Hex,
      }),
      recipient: recipientAddress as Address,
      store: Store.memory(),
    });

    const results = await Promise.allSettled([
      method.verify({
        credential,
        request: challenge.request,
      }),
      method.verify({
        credential,
        request: challenge.request,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    expect(rejection?.reason).toBeInstanceOf(Errors.InvalidChallengeError);
  });

  it("rejects concurrent voucher verification for the same session challenge", async () => {
    const chainId = megaethTestnet.id;
    const escrowContract =
      "0x4444444444444444444444444444444444444444" as Address;
    const channelId =
      "0x9003bffb64c050b9ff9aeb03d4f5e4b42643606b8ba0f00ce408e7423eb9dbf4" as Hex;
    const challenge = Challenge.fromMethod(Methods.session, {
      expires: new Date(Date.now() + 60_000).toISOString(),
      realm: "tests.megaeth.local",
      request: {
        amount: "1000",
        currency: tokenAddress,
        methodDetails: {
          chainId,
          escrowContract,
          minVoucherDelta: "0",
        },
        recipient: recipientAddress,
      },
      secretKey: "test-secret",
    }) as SessionChallenge;
    const credential = Credential.from({
      challenge,
      payload: {
        action: "voucher",
        channelId,
        cumulativeAmount: "2000",
        signature: await payer.signTypedData(
          buildSessionVoucherTypedData({
            chainId,
            channelId,
            cumulativeAmount: 2000n,
            escrowContract,
          }),
        ),
      },
      source: `did:pkh:eip155:${chainId}:${payer.address}`,
    }) as SessionCredential;

    let state: SessionChannelState | undefined = {
      acceptedCumulative: "1000",
      chainId,
      channelId,
      currency: tokenAddress,
      deposit: "5000",
      escrowContract,
      lastOnChainVerifiedAt: new Date().toISOString(),
      payer: payer.address,
      recipient: recipientAddress,
      settled: "0",
      status: "open",
    };
    const store = Store.memory();
    const sessionStore: SessionChannelStore = {
      async deleteChannel() {
        state = undefined;
      },
      async getChannel(key) {
        expect(key).toBe(
          getSessionChannelKey({
            chainId,
            channelId,
            escrowContract,
          }),
        );
        await delay(30);
        return state;
      },
      async updateChannel(key, updater) {
        expect(key).toBe(
          getSessionChannelKey({
            chainId,
            channelId,
            escrowContract,
          }),
        );
        await delay(15);
        state = updater(state) ?? undefined;
        return state;
      },
    };

    const method = serverSession({
      chainId,
      channelStore: sessionStore,
      currency: tokenAddress,
      escrowContract,
      publicClient: createNoopPublicClient(),
      recipient: recipientAddress,
      settlement: {
        close: { enabled: true },
        periodic: {
          intervalSeconds: 0,
          minUnsettledAmount: "999999999",
        },
      },
      store,
      verifier: {
        minVoucherDelta: "0",
        onChainRevalidationMs: 60_000,
      },
    });

    const results = await Promise.allSettled([
      method.verify({
        credential,
        request: challenge.request,
      }),
      method.verify({
        credential,
        request: challenge.request,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    expect(rejection?.reason).toBeInstanceOf(Errors.InvalidChallengeError);
    expect(state?.acceptedCumulative).toBe("2000");
  });
});

function createHashVerificationPublicClient(parameters: {
  challenge: Methods.ChargeRequest;
  hash: Hex;
}) {
  const unsignedPayload = createPermitPayload({
    deadline: 1_900_000_000n,
    nonce: 7n,
    request: parameters.challenge,
  });
  const typedData = buildTypedData({
    chainId: megaethTestnet.id,
    payload: {
      ...unsignedPayload,
      signature: "0x" as Hex,
    },
    permit2Address,
    spender: payer.address,
  });

  return createPublicClient({
    chain: megaethTestnet,
    transport: custom({
      async request({ method }) {
        const signature = await payer.signTypedData(typedData);
        const calldata = encodePermit2Calldata({
          owner: payer.address,
          payload: {
            ...unsignedPayload,
            signature,
          },
        });

        if (method === "eth_getTransactionReceipt") {
          await delay(25);
          return {
            blockHash: parameters.hash,
            blockNumber: "0x1",
            contractAddress: null,
            cumulativeGasUsed: "0x1",
            effectiveGasPrice: "0x1",
            from: payer.address,
            gasUsed: "0x1",
            logs: [],
            logsBloom: `0x${"0".repeat(512)}`,
            status: "0x1",
            to: permit2Address,
            transactionHash: parameters.hash,
            transactionIndex: "0x0",
            type: "0x0",
          };
        }

        if (method === "eth_getTransactionByHash") {
          await delay(25);
          return {
            blockHash: parameters.hash,
            blockNumber: "0x1",
            from: payer.address,
            gas: "0x1",
            gasPrice: "0x1",
            hash: parameters.hash,
            input: calldata,
            nonce: "0x0",
            to: permit2Address,
            transactionIndex: "0x0",
            type: "0x0",
            value: "0x0",
            v: "0x1b",
            r: "0x1",
            s: "0x2",
          };
        }

        throw new Error(`Unexpected RPC method: ${String(method)}`);
      },
    }),
  });
}

function createNoopPublicClient() {
  return createPublicClient({
    chain: megaethTestnet,
    transport: custom({
      async request({ method }) {
        throw new Error(`Unexpected RPC method: ${String(method)}`);
      },
    }),
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
