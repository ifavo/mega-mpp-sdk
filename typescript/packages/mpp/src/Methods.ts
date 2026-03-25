import { Method, z } from "mppx";

const tokenPermissionSchema = z.object({
  token: z.address(),
  amount: z.string(),
});

const transferDetailSchema = z.object({
  to: z.address(),
  requestedAmount: z.string(),
});

export const splitSchema = z.object({
  recipient: z.address(),
  amount: z.string(),
  memo: z.optional(z.string()),
});

const permitSingleSchema = z.object({
  permitted: tokenPermissionSchema,
  nonce: z.string(),
  deadline: z.string(),
});

const permitBatchSchema = z.object({
  permitted: z.array(tokenPermissionSchema),
  nonce: z.string(),
  deadline: z.string(),
});

const witnessSingleSchema = z.object({
  transferDetails: transferDetailSchema,
});

const witnessBatchSchema = z.object({
  transferDetails: z.array(transferDetailSchema),
});

export const charge = Method.from({
  name: "megaeth",
  intent: "charge",
  schema: {
    credential: {
      payload: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("permit2"),
          permit: z.union([permitSingleSchema, permitBatchSchema]),
          witness: z.union([witnessSingleSchema, witnessBatchSchema]),
          signature: z.signature(),
        }),
        z.object({
          type: z.literal("hash"),
          hash: z.hash(),
        }),
      ]),
    },
    request: z.object({
      amount: z.string(),
      currency: z.address(),
      description: z.optional(z.string()),
      externalId: z.optional(z.string()),
      recipient: z.address(),
      methodDetails: z.object({
        chainId: z.optional(z.number()),
        testnet: z.optional(z.boolean()),
        feePayer: z.optional(z.boolean()),
        permit2Address: z.optional(z.address()),
        splits: z.optional(z.array(splitSchema)),
      }),
    }),
  },
});

export const megaeth = {
  charge,
};

export type ChargeRequest = z.output<typeof charge.schema.request>;
export type ChargeSplit = z.output<typeof splitSchema>;
export type TransferDetail = z.output<typeof transferDetailSchema>;
export type PermitSinglePayload = z.output<typeof permitSingleSchema>;
export type PermitBatchPayload = z.output<typeof permitBatchSchema>;
export type TransferSingleWitness = z.output<typeof witnessSingleSchema>;
export type TransferBatchWitness = z.output<typeof witnessBatchSchema>;
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
  method: "megaeth";
  reference: string;
  status: "success";
  timestamp: string;
  externalId?: string;
};
