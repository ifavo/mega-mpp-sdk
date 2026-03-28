import { Method, z } from "mppx";

import { baseUnitIntegerString } from "./utils/baseUnit.js";
import { MAX_SPLITS } from "./constants.js";

const tokenPermissionSchema = z.object({
  token: z.address(),
  amount: baseUnitIntegerString("permitted amount"),
});

const transferDetailSchema = z.object({
  to: z.address(),
  requestedAmount: baseUnitIntegerString("requested amount"),
});

export const splitSchema = z.object({
  recipient: z.address(),
  amount: baseUnitIntegerString("split amount"),
  memo: z.optional(
    z
      .string()
      .check(
        z.maxLength(
          256,
          "Use a split memo no longer than 256 characters before retrying the payment.",
        ),
      ),
  ),
});

const permitSingleSchema = z.object({
  permitted: tokenPermissionSchema,
  nonce: baseUnitIntegerString("nonce"),
  deadline: baseUnitIntegerString("deadline"),
});

const witnessSingleSchema = z.object({
  transferDetails: transferDetailSchema,
});

const permitAuthorizationSchema = z.object({
  permit: permitSingleSchema,
  witness: witnessSingleSchema,
  signature: z.signature(),
});

export const sessionOpenPayloadSchema = z.object({
  action: z.literal("open"),
  authorizedSigner: z.optional(z.address()),
  channelId: z.hash(),
  cumulativeAmount: baseUnitIntegerString("session cumulative amount"),
  deposit: baseUnitIntegerString("session deposit"),
  hash: z.hash(),
  signature: z.signature(),
});

export const sessionTopUpPayloadSchema = z.object({
  action: z.literal("topUp"),
  additionalDeposit: baseUnitIntegerString("additional session deposit"),
  channelId: z.hash(),
  cumulativeAmount: z.optional(
    baseUnitIntegerString("session cumulative amount"),
  ),
  hash: z.hash(),
  signature: z.optional(z.signature()),
});

export const sessionVoucherPayloadSchema = z.object({
  action: z.literal("voucher"),
  channelId: z.hash(),
  cumulativeAmount: baseUnitIntegerString("session cumulative amount"),
  signature: z.signature(),
});

export const sessionClosePayloadSchema = z.object({
  action: z.literal("close"),
  channelId: z.hash(),
  cumulativeAmount: baseUnitIntegerString("session cumulative amount"),
  signature: z.signature(),
});

export const charge = Method.from({
  name: "megaeth",
  intent: "charge",
  schema: {
    credential: {
      payload: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("permit2"),
          authorizations: z
            .array(permitAuthorizationSchema)
            .check(
              z.minLength(
                1,
                "Use at least one signed Permit2 authorization before retrying the payment.",
              ),
            ),
        }),
        z.object({
          type: z.literal("hash"),
          hash: z.hash(),
        }),
      ]),
    },
    request: z.object({
      amount: baseUnitIntegerString("amount"),
      currency: z.address(),
      description: z.optional(z.string()),
      externalId: z.optional(z.string()),
      recipient: z.address(),
      methodDetails: z.object({
        chainId: z.optional(z.number()),
        testnet: z.optional(z.boolean()),
        feePayer: z.optional(z.boolean()),
        permit2Address: z.optional(z.address()),
        splits: z.optional(
          z
            .array(splitSchema)
            .check(
              z.minLength(
                1,
                "Use at least one split recipient before retrying the payment.",
              ),
            )
            .check(
              z.maxLength(
                MAX_SPLITS,
                `Use at most ${MAX_SPLITS} split recipients in one payment request.`,
              ),
            ),
        ),
      }),
    }),
  },
});

export const session = Method.from({
  name: "megaeth",
  intent: "session",
  schema: {
    credential: {
      payload: z.discriminatedUnion("action", [
        sessionOpenPayloadSchema,
        sessionTopUpPayloadSchema,
        sessionVoucherPayloadSchema,
        sessionClosePayloadSchema,
      ]),
    },
    request: z.object({
      amount: baseUnitIntegerString("session unit amount"),
      currency: z.address(),
      description: z.optional(z.string()),
      externalId: z.optional(z.string()),
      recipient: z.address(),
      suggestedDeposit: z.optional(
        baseUnitIntegerString("suggested session deposit"),
      ),
      unitType: z.optional(z.string()),
      methodDetails: z.object({
        chainId: z.optional(z.number()),
        channelId: z.optional(z.hash()),
        escrowContract: z.address(),
        minVoucherDelta: z.optional(
          baseUnitIntegerString("minimum voucher delta"),
        ),
      }),
    }),
  },
});

export const megaeth = {
  charge,
  session,
};

export type ChargeRequest = z.output<typeof charge.schema.request>;
export type ChargeSplit = z.output<typeof splitSchema>;
export type TransferDetail = z.output<typeof transferDetailSchema>;
export type PermitSinglePayload = z.output<typeof permitSingleSchema>;
export type TransferSingleWitness = z.output<typeof witnessSingleSchema>;
export type ChargePermitAuthorization = z.output<
  typeof permitAuthorizationSchema
>;
export type ChargePermit2Payload = Extract<
  z.output<typeof charge.schema.credential.payload>,
  { type: "permit2" }
>;
export type ChargeHashPayload = Extract<
  z.output<typeof charge.schema.credential.payload>,
  { type: "hash" }
>;
export type ChargeCredentialPayload = z.output<
  typeof charge.schema.credential.payload
>;
export type ChargeReceipt = {
  challengeId: string;
  method: "megaeth";
  reference: string;
  status: "success";
  timestamp: string;
  externalId?: string;
};

export type SessionRequest = z.output<typeof session.schema.request>;
export type SessionOpenPayload = z.output<typeof sessionOpenPayloadSchema>;
export type SessionTopUpPayload = z.output<typeof sessionTopUpPayloadSchema>;
export type SessionVoucherPayload = z.output<
  typeof sessionVoucherPayloadSchema
>;
export type SessionClosePayload = z.output<typeof sessionClosePayloadSchema>;
export type SessionCredentialPayload = z.output<
  typeof session.schema.credential.payload
>;
export type SessionReceipt = ChargeReceipt;
