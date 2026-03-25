import { Credential, Receipt } from "mppx";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import type {
  ChargePermit2Payload,
  ChargeReceipt,
  ChargeRequest,
} from "../Methods.js";
import {
  assertPermitPayloadMatchesRequest,
  buildTypedData,
  createPermitPayload,
  createTransferPlan,
  decodePermit2Transaction,
  encodePermit2Calldata,
  getWitnessTypeString,
  recoverPermitOwner,
  splitSummary,
} from "../utils/permit2.js";
import { createDidPkhSource, parseDidPkhSource } from "../utils/source.js";

const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f094538c5f1d2c75e7d70ce2f3fba8c8a55f5d42",
);

function createRequest(overrides?: Partial<ChargeRequest>): ChargeRequest {
  return {
    amount: "1000",
    currency: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    methodDetails: {
      chainId: 6343,
      permit2Address: "0x3333333333333333333333333333333333333333",
      ...overrides?.methodDetails,
    },
    ...(overrides?.description ? { description: overrides.description } : {}),
    ...(overrides?.externalId ? { externalId: overrides.externalId } : {}),
    ...overrides,
  };
}

describe("permit2 utilities", () => {
  it("creates a single-transfer permit payload that round-trips through owner recovery", async () => {
    const request = createRequest();
    const unsignedPayload = createPermitPayload({
      deadline: 1_900_000_000n,
      nonce: 7n,
      request,
    });

    const typedData = buildTypedData({
      chainId: 6343,
      payload: {
        ...unsignedPayload,
        signature: "0x" as Hex,
      },
      permit2Address: "0x3333333333333333333333333333333333333333",
      spender: request.recipient as Address,
    });

    const signature = await payer.signTypedData(typedData);
    const payload: ChargePermit2Payload = {
      ...unsignedPayload,
      signature,
    };

    const recovered = await recoverPermitOwner({
      chainId: 6343,
      payload,
      permit2Address: "0x3333333333333333333333333333333333333333",
      spender: request.recipient as Address,
    });

    expect(recovered).toBe(payer.address);
    expect(splitSummary()).toBe("no splits");
  });

  it("creates a batch transfer plan when splits are present", () => {
    const request = createRequest({
      methodDetails: {
        chainId: 6343,
        permit2Address: "0x3333333333333333333333333333333333333333",
        splits: [
          {
            amount: "125",
            memo: "platform fee",
            recipient: "0x4444444444444444444444444444444444444444",
          },
          {
            amount: "25",
            recipient: "0x5555555555555555555555555555555555555555",
          },
        ],
      },
    });

    const plan = createTransferPlan(request);
    const payload = createPermitPayload({
      deadline: 1_900_000_000n,
      nonce: 8n,
      request,
    });

    expect(plan.isBatch).toBe(true);
    expect(plan.primaryAmount).toBe(850n);
    expect(plan.splitTotal).toBe(150n);
    expect(Array.isArray(payload.permit.permitted)).toBe(true);
    expect(splitSummary(request.methodDetails.splits)).toBe("2 splits");
  });

  it("encodes single-transfer calldata with the canonical Permit2 selector", () => {
    const request = createRequest();
    const unsignedPayload = createPermitPayload({
      deadline: 1_900_000_000n,
      nonce: 7n,
      request,
    });
    const payload: ChargePermit2Payload = {
      ...unsignedPayload,
      signature: "0x1234",
    };

    const calldata = encodePermit2Calldata({
      owner: payer.address,
      payload,
    });
    const decoded = decodePermit2Transaction(calldata);

    expect(calldata.slice(0, 10)).toBe("0x137c29fe");
    expect(decoded).toEqual({
      owner: payer.address,
      payload,
    });
  });

  it("encodes batch-transfer calldata with the canonical Permit2 selector", () => {
    const request = createRequest({
      methodDetails: {
        chainId: 6343,
        permit2Address: "0x3333333333333333333333333333333333333333",
        splits: [
          {
            amount: "125",
            recipient: "0x4444444444444444444444444444444444444444",
          },
        ],
      },
    });
    const unsignedPayload = createPermitPayload({
      deadline: 1_900_000_000n,
      nonce: 8n,
      request,
    });
    const payload: ChargePermit2Payload = {
      ...unsignedPayload,
      signature: "0x1234",
    };

    const calldata = encodePermit2Calldata({
      owner: payer.address,
      payload,
    });
    const decoded = decodePermit2Transaction(calldata);

    expect(calldata.slice(0, 10)).toBe("0xfe8ec1a7");
    expect(decoded).toEqual({
      owner: payer.address,
      payload,
    });
  });

  it("builds the canonical Permit2 witness type string stub", () => {
    const singlePayload = createPermitPayload({
      deadline: 1_900_000_000n,
      nonce: 9n,
      request: createRequest(),
    });
    const batchPayload = createPermitPayload({
      deadline: 1_900_000_000n,
      nonce: 10n,
      request: createRequest({
        methodDetails: {
          chainId: 6343,
          permit2Address: "0x3333333333333333333333333333333333333333",
          splits: [
            {
              amount: "100",
              recipient: "0x4444444444444444444444444444444444444444",
            },
          ],
        },
      }),
    });

    expect(
      getWitnessTypeString({ ...singlePayload, signature: "0x1234" }),
    ).toBe(
      "ChargeWitness witness)ChargeWitness(TransferDetails transferDetails)TokenPermissions(address token,uint256 amount)TransferDetails(address to,uint256 requestedAmount)",
    );
    expect(getWitnessTypeString({ ...batchPayload, signature: "0x1234" })).toBe(
      "ChargeBatchWitness witness)ChargeBatchWitness(TransferDetails[] transferDetails)TokenPermissions(address token,uint256 amount)TransferDetails(address to,uint256 requestedAmount)",
    );
  });

  it("rejects a mutated payload that changes the requested transfer ordering", () => {
    const request = createRequest({
      methodDetails: {
        chainId: 6343,
        permit2Address: "0x3333333333333333333333333333333333333333",
        splits: [
          {
            amount: "100",
            recipient: "0x4444444444444444444444444444444444444444",
          },
        ],
      },
    });

    const payload = createPermitPayload({
      deadline: 1_900_000_000n,
      nonce: 9n,
      request,
    });

    expect(() =>
      assertPermitPayloadMatchesRequest(
        {
          ...payload,
          signature: "0x1234",
          witness: {
            transferDetails: [
              {
                requestedAmount: "900",
                to: "0x4444444444444444444444444444444444444444",
              },
              {
                requestedAmount: "100",
                to: request.recipient,
              },
            ],
          },
        },
        request,
      ),
    ).toThrowError(/requested recipient and amount ordering/i);
  });

  it("creates and parses did:pkh sources", () => {
    const source = createDidPkhSource(6343, payer.address);
    expect(source).toBe(`did:pkh:eip155:6343:${payer.address}`);
    expect(parseDidPkhSource(source)).toEqual({
      address: payer.address,
      chainId: 6343,
    });
    expect(parseDidPkhSource("did:pkh:eip155:6343:not-an-address")).toBeNull();
  });

  it("keeps serialized credentials compatible with mppx", () => {
    const request = createRequest();
    const challenge = {
      id: "challenge-1",
      intent: "charge",
      method: "megaeth",
      realm: "tests.local",
      request,
    };

    const credential = Credential.serialize({
      challenge,
      payload: {
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        type: "hash",
      },
      source: createDidPkhSource(6343, payer.address),
    });

    const parsed = Credential.deserialize(credential);
    expect(parsed.challenge.id).toBe("challenge-1");
    expect(parsed.source).toBe(createDidPkhSource(6343, payer.address));
  });

  it("keeps serialized receipts compatible with the shared mppx header format", () => {
    const receipt: ChargeReceipt = {
      externalId: "ext-1",
      method: "megaeth",
      reference:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      status: "success",
      timestamp: "2026-03-25T10:15:00.000Z",
    };

    const encoded = Receipt.serialize(Receipt.from(receipt));
    const parsed = Receipt.deserialize(encoded) as ChargeReceipt;

    expect(parsed).toEqual(receipt);
  });
});
