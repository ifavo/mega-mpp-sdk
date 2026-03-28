import { Credential } from "mppx";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import type { ChargePermit2Payload, ChargeRequest } from "../Methods.js";
import {
  assertPermitPayloadMatchesRequest,
  buildTypedData,
  createPermitPayload,
  createTransferPlan,
  decodePermit2Transaction,
  encodePermit2Calldata,
  getWitnessTypeString,
  parseDecodedTransferArguments,
  Permit2PayloadError,
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

async function signPermitPayload(
  request: ChargeRequest,
  spender: Address,
): Promise<ChargePermit2Payload> {
  const unsignedPayload = createPermitPayload({
    deadline: 1_900_000_000n,
    nonce: 7n,
    request,
  });

  return {
    ...unsignedPayload,
    authorizations: await Promise.all(
      unsignedPayload.authorizations.map(async (authorization) => ({
        ...authorization,
        signature: await payer.signTypedData(
          buildTypedData({
            authorization,
            chainId: 6343,
            permit2Address: "0x3333333333333333333333333333333333333333",
            spender,
          }),
        ),
      })),
    ),
  };
}

describe("permit2 utilities", () => {
  it("creates a single-transfer permit payload that round-trips through owner recovery", async () => {
    const request = createRequest();
    const payload = await signPermitPayload(
      request,
      request.recipient as Address,
    );

    const recovered = await recoverPermitOwner({
      authorization: payload.authorizations[0]!,
      chainId: 6343,
      permit2Address: "0x3333333333333333333333333333333333333333",
      spender: request.recipient as Address,
    });

    expect(recovered).toBe(payer.address);
    expect(payload.authorizations).toHaveLength(1);
    expect(splitSummary()).toBe("no splits");
  });

  it("creates ordered single-transfer authorizations when splits are present", () => {
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

    expect(plan.primaryAmount).toBe(850n);
    expect(plan.splitTotal).toBe(150n);
    expect(payload.authorizations).toHaveLength(3);
    expect(
      payload.authorizations.map((authorization) => authorization.permit.nonce),
    ).toEqual(["8", "9", "10"]);
    expect(
      payload.authorizations.map(
        (authorization) => authorization.witness.transferDetails.to,
      ),
    ).toEqual([
      request.recipient,
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
    ]);
    expect(splitSummary(request.methodDetails.splits)).toBe("2 splits");
  });

  it("encodes single-transfer calldata with the canonical Permit2 selector", async () => {
    const request = createRequest();
    const payload = await signPermitPayload(
      request,
      request.recipient as Address,
    );

    const calldata = encodePermit2Calldata({
      authorization: payload.authorizations[0]!,
      owner: payer.address,
    });
    const decoded = decodePermit2Transaction(calldata);

    expect(calldata.slice(0, 10)).toBe("0x137c29fe");
    expect(decoded).toEqual({
      authorization: payload.authorizations[0],
      owner: payer.address,
    });
  });

  it("uses the same single-transfer selector for split authorizations", async () => {
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
    const payload = await signPermitPayload(
      request,
      request.recipient as Address,
    );

    const primaryCalldata = encodePermit2Calldata({
      authorization: payload.authorizations[0]!,
      owner: payer.address,
    });
    const splitCalldata = encodePermit2Calldata({
      authorization: payload.authorizations[1]!,
      owner: payer.address,
    });

    expect(primaryCalldata.slice(0, 10)).toBe("0x137c29fe");
    expect(splitCalldata.slice(0, 10)).toBe("0x137c29fe");
  });

  it("rejects non-Permit2 calldata with a stable payload error", () => {
    expect(() => decodePermit2Transaction("0xdeadbeef")).toThrowError(
      Permit2PayloadError,
    );
    expect(() => decodePermit2Transaction("0xdeadbeef")).toThrowError(
      /Permit2 witness transfer transaction/i,
    );
  });

  it("rejects decoded Permit2 arguments that do not match the supported single-transfer shape", () => {
    expect(() =>
      parseDecodedTransferArguments([
        {
          deadline: 2n,
          nonce: 1n,
          permitted: {
            amount: 1n,
            token: "0x1111111111111111111111111111111111111111",
          },
        },
        {
          requestedAmount: "1",
          to: "0x2222222222222222222222222222222222222222",
        },
        payer.address,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "ChargeWitness(TransferDetails transferDetails)",
        "0x1234",
      ]),
    ).toThrowError(Permit2PayloadError);
    expect(() =>
      parseDecodedTransferArguments([
        {
          deadline: 2n,
          nonce: 1n,
          permitted: {
            amount: 1n,
            token: "0x1111111111111111111111111111111111111111",
          },
        },
        {
          requestedAmount: "1",
          to: "0x2222222222222222222222222222222222222222",
        },
        payer.address,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "ChargeWitness(TransferDetails transferDetails)",
        "0x1234",
      ]),
    ).toThrowError(/Permit2 witness transfer transaction/i);
  });

  it("builds the canonical Permit2 witness type string stub", () => {
    expect(getWitnessTypeString()).toBe(
      "ChargeWitness witness)ChargeWitness(TransferDetails transferDetails)TokenPermissions(address token,uint256 amount)TransferDetails(address to,uint256 requestedAmount)",
    );
  });

  it("rejects a mutated payload that changes the requested transfer ordering", async () => {
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
    const payload = await signPermitPayload(
      request,
      request.recipient as Address,
    );

    expect(() =>
      assertPermitPayloadMatchesRequest(
        {
          ...payload,
          authorizations: [
            payload.authorizations[0]!,
            {
              ...payload.authorizations[1]!,
              witness: {
                transferDetails: {
                  requestedAmount: "100",
                  to: request.recipient,
                },
              },
            },
          ],
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
});
