import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { z } from "mppx";

import { PERMIT2_ABI } from "../abi.js";
import type {
  ChargePermit2Payload,
  ChargePermitAuthorization,
  ChargeRequest,
  ChargeSplit,
  PermitSinglePayload,
  TransferSingleWitness,
} from "../Methods.js";
import { MAX_SPLITS, PERMIT2_ADDRESS } from "../constants.js";

const TOKEN_PERMISSIONS_TYPE = "TokenPermissions(address token,uint256 amount)";
const TRANSFER_DETAIL_TYPE =
  "TransferDetails(address to,uint256 requestedAmount)";
const WITNESS_TYPE_NAME = "ChargeWitness";
const WITNESS_STRUCT = `${WITNESS_TYPE_NAME}(TransferDetails transferDetails)`;
const WITNESS_TYPE = `${WITNESS_STRUCT}${TRANSFER_DETAIL_TYPE}`;
const WITNESS_TYPEHASH = keccak256(stringToHex(WITNESS_TYPE));
const TRANSFER_DETAIL_TYPEHASH = keccak256(stringToHex(TRANSFER_DETAIL_TYPE));
const BASE_UNIT_INTEGER_PATTERN = /^\d+$/;
const HEX_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

type PermitTypedData = TypedDataDefinition<
  Record<string, Array<{ name: string; type: string }>>,
  string
>;

type PermitTypedDataTypes = PermitTypedData["types"];

type TransferPlan = {
  primaryAmount: bigint;
  splitTotal: bigint;
  totalAmount: bigint;
  transfers: TransferLeg[];
};

type TransferLeg = {
  amount: bigint;
  amountString: string;
  recipient: Address;
  token: Address;
};

type DecodedTransfer = {
  permit: {
    permitted: { token: Address; amount: bigint };
    nonce: bigint;
    deadline: bigint;
  };
  transferDetails: { to: Address; requestedAmount: bigint };
  owner: Address;
  signature: Hex;
};

type UnsignedChargeAuthorization = Omit<ChargePermitAuthorization, "signature">;

type UnsignedChargePermit2Payload = {
  type: "permit2";
  authorizations: UnsignedChargeAuthorization[];
};

const decodedTokenPermissionSchema = z.object({
  token: z.address(),
  amount: z.bigint(),
});

const decodedTransferDetailSchema = z.object({
  to: z.address(),
  requestedAmount: z.bigint(),
});

const hexBytesSchema = z
  .string()
  .check(
    z.regex(
      HEX_BYTES_PATTERN,
      "Use a hex-encoded Permit2 signature before retrying the MegaETH payment.",
    ),
  );

const decodedSingleTransferArgumentsSchema = z.tuple([
  z.object({
    permitted: decodedTokenPermissionSchema,
    nonce: z.bigint(),
    deadline: z.bigint(),
  }),
  decodedTransferDetailSchema,
  z.address(),
  z.hash(),
  z.string(),
  hexBytesSchema,
]);

export class Permit2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Permit2ValidationError";
  }
}

export class Permit2PayloadError extends Error {
  constructor(message: string, options?: { cause?: unknown | undefined }) {
    super(message, options);
    this.name = "Permit2PayloadError";
  }
}

export class Permit2VerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown | undefined }) {
    super(message, options);
    this.name = "Permit2VerificationError";
  }
}

export function createTransferPlan(request: ChargeRequest): TransferPlan {
  const totalAmount = parseBaseUnitInteger(request.amount, "amount");
  if (totalAmount <= 0n) {
    throw new Permit2ValidationError(
      "Use an amount greater than zero before retrying the payment.",
    );
  }

  const splits = request.methodDetails.splits;
  if (splits && splits.length === 0) {
    throw new Permit2ValidationError(
      "Use at least one split recipient before retrying the payment.",
    );
  }

  const normalizedSplits = splits ?? [];
  if (normalizedSplits.length > MAX_SPLITS) {
    throw new Permit2ValidationError(
      `Use at most ${MAX_SPLITS} split recipients in one payment request.`,
    );
  }

  for (const split of normalizedSplits) {
    if (split.memo && split.memo.length > 256) {
      throw new Permit2ValidationError(
        "Use a split memo no longer than 256 characters before retrying the payment.",
      );
    }
  }

  const splitTotal = normalizedSplits.reduce(
    (sum, split) => sum + parseBaseUnitInteger(split.amount, "split amount"),
    0n,
  );
  if (splitTotal >= totalAmount) {
    throw new Permit2ValidationError(
      "Use split amounts that leave a positive remainder for the primary recipient before retrying the payment.",
    );
  }

  const token = getAddress(request.currency) as Address;
  const primaryAmount = totalAmount - splitTotal;
  const transfers: TransferLeg[] = [
    {
      amount: primaryAmount,
      amountString: primaryAmount.toString(),
      recipient: getAddress(request.recipient) as Address,
      token,
    },
    ...normalizedSplits.map((split) => {
      const amount = parseBaseUnitInteger(split.amount, "split amount");
      return {
        amount,
        amountString: amount.toString(),
        recipient: getAddress(split.recipient) as Address,
        token,
      };
    }),
  ];

  return {
    primaryAmount,
    splitTotal,
    totalAmount,
    transfers,
  };
}

export function createPermitPayload(parameters: {
  deadline: bigint;
  nonce: bigint;
  request: ChargeRequest;
}): UnsignedChargePermit2Payload {
  const plan = createTransferPlan(parameters.request);

  return {
    type: "permit2",
    authorizations: plan.transfers.map((transfer, index) => ({
      permit: {
        permitted: {
          token: transfer.token,
          amount: transfer.amountString,
        },
        nonce: (parameters.nonce + BigInt(index)).toString(),
        deadline: parameters.deadline.toString(),
      },
      witness: {
        transferDetails: {
          to: transfer.recipient,
          requestedAmount: transfer.amountString,
        },
      },
    })),
  };
}

export function getPermit2Address(request: ChargeRequest): Address {
  return getAddress(
    request.methodDetails.permit2Address ?? PERMIT2_ADDRESS,
  ) as Address;
}

export function assertPermitPayloadMatchesRequest(
  payload: ChargePermit2Payload,
  request: ChargeRequest,
): TransferPlan {
  const plan = createTransferPlan(request);

  if (payload.authorizations.length !== plan.transfers.length) {
    throw new Permit2VerificationError(
      "Use the exact transfer count from the payment challenge before retrying. The current payload does not match the requested split layout.",
    );
  }

  for (let index = 0; index < plan.transfers.length; index += 1) {
    const authorization = payload.authorizations[index]!;
    const transfer = plan.transfers[index]!;
    assertAuthorizationMatchesTransfer({
      authorization,
      index,
      transfer,
    });
  }

  return plan;
}

export function buildTypedData(parameters: {
  authorization: ChargePermitAuthorization | UnsignedChargeAuthorization;
  chainId: number;
  permit2Address: Address;
  spender: Address;
}): PermitTypedData {
  const permit = normalizePermit(parameters.authorization.permit);
  const transferDetails = normalizeTransferDetails(
    parameters.authorization.witness.transferDetails,
  );

  return {
    domain: permit2Domain(parameters.chainId, parameters.permit2Address),
    primaryType: "PermitWitnessTransferFrom",
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: WITNESS_TYPE_NAME },
      ],
      ...tokenPermissionTypes(),
      [WITNESS_TYPE_NAME]: [
        { name: "transferDetails", type: "TransferDetails" },
      ],
      ...transferDetailsTypes(),
    },
    message: {
      permitted: {
        token: permit.token,
        amount: BigInt(permit.amount),
      },
      spender: parameters.spender,
      nonce: BigInt(parameters.authorization.permit.nonce),
      deadline: BigInt(parameters.authorization.permit.deadline),
      witness: {
        transferDetails: {
          to: transferDetails.to,
          requestedAmount: BigInt(transferDetails.requestedAmount),
        },
      },
    },
  };
}

export async function recoverPermitOwner(parameters: {
  authorization: ChargePermitAuthorization;
  chainId: number;
  permit2Address: Address;
  spender: Address;
}): Promise<Address> {
  const typedData = buildTypedData(parameters);
  try {
    return (await recoverTypedDataAddress({
      domain: typedData.domain,
      message: typedData.message,
      primaryType: typedData.primaryType,
      signature: parameters.authorization.signature as Hex,
      types: typedData.types,
    } as PermitTypedData & { signature: Hex })) as Address;
  } catch (error) {
    throw new Permit2VerificationError(
      normalizeErrorMessage(
        error,
        "Retry after correcting the MegaETH Permit2 signature.",
      ),
      { cause: error },
    );
  }
}

export function encodePermit2Calldata(parameters: {
  authorization: ChargePermitAuthorization;
  owner: Address;
}): Hex {
  const permit = normalizePermit(parameters.authorization.permit);
  const transferDetail = normalizeTransferDetails(
    parameters.authorization.witness.transferDetails,
  );

  return encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "permitWitnessTransferFrom",
    args: [
      {
        permitted: {
          token: permit.token,
          amount: BigInt(permit.amount),
        },
        nonce: BigInt(parameters.authorization.permit.nonce),
        deadline: BigInt(parameters.authorization.permit.deadline),
      },
      {
        to: transferDetail.to,
        requestedAmount: BigInt(transferDetail.requestedAmount),
      },
      parameters.owner,
      hashWitness(parameters.authorization),
      getWitnessTypeString(),
      parameters.authorization.signature,
    ],
  } as Parameters<typeof encodeFunctionData>[0]);
}

export function decodePermit2Transaction(input: Hex): {
  authorization: ChargePermitAuthorization;
  owner: Address;
} {
  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({
      abi: PERMIT2_ABI,
      data: input,
    });
  } catch (error) {
    throw new Permit2PayloadError(
      "Use a Permit2 witness transfer transaction before retrying the MegaETH payment.",
      { cause: error },
    );
  }

  if (decoded.functionName !== "permitWitnessTransferFrom") {
    throw new Permit2PayloadError(
      "Use a Permit2 witness transfer transaction before retrying the MegaETH payment.",
    );
  }

  const normalizedTransfer = parseDecodedTransferArguments(decoded.args);
  const authorization: ChargePermitAuthorization = {
    permit: {
      permitted: {
        token: getAddress(normalizedTransfer.permit.permitted.token) as Address,
        amount: normalizedTransfer.permit.permitted.amount.toString(),
      },
      nonce: normalizedTransfer.permit.nonce.toString(),
      deadline: normalizedTransfer.permit.deadline.toString(),
    },
    witness: {
      transferDetails: {
        to: getAddress(normalizedTransfer.transferDetails.to) as Address,
        requestedAmount:
          normalizedTransfer.transferDetails.requestedAmount.toString(),
      },
    },
    signature: normalizedTransfer.signature,
  };

  return {
    authorization,
    owner: normalizedTransfer.owner,
  };
}

export function getWitnessTypeString(): string {
  return `${WITNESS_TYPE_NAME} witness)${WITNESS_STRUCT}${TOKEN_PERMISSIONS_TYPE}${TRANSFER_DETAIL_TYPE}`;
}

export function hashWitness(
  authorization: ChargePermitAuthorization | UnsignedChargeAuthorization,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [
        WITNESS_TYPEHASH,
        hashTransferDetail(
          normalizeTransferDetails(authorization.witness.transferDetails),
        ),
      ],
    ),
  );
}

export function splitSummary(splits?: ChargeSplit[] | undefined): string {
  if (!splits?.length) return "no splits";
  return `${splits.length} split${splits.length === 1 ? "" : "s"}`;
}

export function parseDecodedTransferArguments(
  args: readonly unknown[] | undefined,
): DecodedTransfer {
  if (!Array.isArray(args)) {
    throw new Permit2PayloadError(
      "Use a Permit2 witness transfer transaction before retrying the MegaETH payment.",
    );
  }

  const result = decodedSingleTransferArgumentsSchema.safeParse(args);
  if (!result.success) {
    throw new Permit2PayloadError(
      "Use a Permit2 witness transfer transaction before retrying the MegaETH payment.",
      {
        cause: result.error,
      },
    );
  }

  const [permit, transferDetails, owner, , , signature] = result.data;
  return {
    permit: {
      permitted: {
        amount: permit.permitted.amount,
        token: getAddress(permit.permitted.token) as Address,
      },
      nonce: permit.nonce,
      deadline: permit.deadline,
    },
    transferDetails: {
      requestedAmount: transferDetails.requestedAmount,
      to: getAddress(transferDetails.to) as Address,
    },
    owner: getAddress(owner) as Address,
    signature: signature as Hex,
  };
}

function assertAuthorizationMatchesTransfer(parameters: {
  authorization: ChargePermitAuthorization;
  index: number;
  transfer: TransferLeg;
}): void {
  const permit = normalizePermit(parameters.authorization.permit);
  const transferDetails = normalizeTransferDetails(
    parameters.authorization.witness.transferDetails,
  );

  if (
    getAddress(permit.token) !== getAddress(parameters.transfer.token) ||
    permit.amount !== parameters.transfer.amountString
  ) {
    throw new Permit2VerificationError(
      `Use the requested token and amount for transfer ${parameters.index + 1} before retrying. The signed Permit2 payload changed those values.`,
    );
  }

  if (
    getAddress(transferDetails.to) !==
      getAddress(parameters.transfer.recipient) ||
    transferDetails.requestedAmount !== parameters.transfer.amountString
  ) {
    throw new Permit2VerificationError(
      `Use the requested recipient and amount ordering for transfer ${parameters.index + 1} before retrying. The signed Permit2 payload changed those details.`,
    );
  }
}

function normalizePermit(permit: PermitSinglePayload): {
  amount: string;
  token: Address;
} {
  return {
    amount: parseBaseUnitInteger(
      permit.permitted.amount,
      "permitted amount",
    ).toString(),
    token: getAddress(permit.permitted.token) as Address,
  };
}

function normalizeTransferDetails(
  transferDetails: TransferSingleWitness["transferDetails"],
): TransferSingleWitness["transferDetails"] {
  return {
    to: getAddress(transferDetails.to) as Address,
    requestedAmount: parseBaseUnitInteger(
      transferDetails.requestedAmount,
      "requested amount",
    ).toString(),
  };
}

function permit2Domain(chainId: number, permit2Address: Address) {
  return {
    name: "Permit2",
    chainId,
    verifyingContract: permit2Address,
  } as const;
}

function tokenPermissionTypes(): PermitTypedDataTypes {
  return {
    TokenPermissions: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  };
}

function transferDetailsTypes(): PermitTypedDataTypes {
  return {
    TransferDetails: [
      { name: "to", type: "address" },
      { name: "requestedAmount", type: "uint256" },
    ],
  };
}

function hashTransferDetail(
  detail: TransferSingleWitness["transferDetails"],
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [
        TRANSFER_DETAIL_TYPEHASH,
        detail.to as Address,
        BigInt(detail.requestedAmount),
      ],
    ),
  );
}

function parseBaseUnitInteger(value: string, label: string): bigint {
  if (!BASE_UNIT_INTEGER_PATTERN.test(value)) {
    throw new Permit2ValidationError(
      `Use a base-unit integer string for ${label} before retrying the payment.`,
    );
  }

  return BigInt(value);
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
