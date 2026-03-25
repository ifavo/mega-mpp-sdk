import {
  concatHex,
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

import { PERMIT2_ABI } from "../abi.js";
import type {
  ChargePermit2Payload,
  ChargeRequest,
  ChargeSplit,
  PermitBatchPayload,
  PermitSinglePayload,
  TransferBatchWitness,
  TransferDetail,
  TransferSingleWitness,
} from "../Methods.js";
import { MAX_SPLITS, PERMIT2_ADDRESS } from "../constants.js";

const TOKEN_PERMISSIONS_TYPE = "TokenPermissions(address token,uint256 amount)";
const TRANSFER_DETAIL_TYPE =
  "TransferDetails(address to,uint256 requestedAmount)";
const SINGLE_WITNESS_TYPE_NAME = "ChargeWitness";
const BATCH_WITNESS_TYPE_NAME = "ChargeBatchWitness";
const SINGLE_WITNESS_STRUCT = `${SINGLE_WITNESS_TYPE_NAME}(TransferDetails transferDetails)`;
const BATCH_WITNESS_STRUCT = `${BATCH_WITNESS_TYPE_NAME}(TransferDetails[] transferDetails)`;
const SINGLE_WITNESS_TYPE = `${SINGLE_WITNESS_STRUCT}${TRANSFER_DETAIL_TYPE}`;
const BATCH_WITNESS_TYPE = `${BATCH_WITNESS_STRUCT}${TRANSFER_DETAIL_TYPE}`;
const SINGLE_WITNESS_TYPEHASH = keccak256(stringToHex(SINGLE_WITNESS_TYPE));
const BATCH_WITNESS_TYPEHASH = keccak256(stringToHex(BATCH_WITNESS_TYPE));
const TRANSFER_DETAIL_TYPEHASH = keccak256(stringToHex(TRANSFER_DETAIL_TYPE));

type PermitTypedData = TypedDataDefinition<
  Record<string, Array<{ name: string; type: string }>>,
  string
>;

type PermitTypedDataTypes = PermitTypedData["types"];

type TransferPlan = {
  isBatch: boolean;
  permitted: Array<{ token: Address; amount: string }>;
  transferDetails: TransferDetail[];
  primaryAmount: bigint;
  splitTotal: bigint;
};

export function createTransferPlan(request: ChargeRequest): TransferPlan {
  const totalAmount = parseBigInt(request.amount, "amount");
  if (totalAmount <= 0n) {
    throw new Error(
      "Use an amount greater than zero before retrying the payment.",
    );
  }

  const splits = request.methodDetails.splits ?? [];
  if (splits.length > MAX_SPLITS) {
    throw new Error(
      `Use at most ${MAX_SPLITS} split recipients in one payment request.`,
    );
  }

  const splitTotal = splits.reduce(
    (sum, split) => sum + parseBigInt(split.amount, "split amount"),
    0n,
  );
  if (splitTotal >= totalAmount) {
    throw new Error(
      "Use split amounts that leave a positive remainder for the primary recipient before retrying the payment.",
    );
  }

  const primaryAmount = totalAmount - splitTotal;
  const permitted = [
    {
      token: getAddress(request.currency) as Address,
      amount: primaryAmount.toString(),
    },
    ...splits.map((split) => ({
      token: getAddress(request.currency) as Address,
      amount: parseBigInt(split.amount, "split amount").toString(),
    })),
  ];

  const transferDetails = [
    {
      to: getAddress(request.recipient) as Address,
      requestedAmount: primaryAmount.toString(),
    },
    ...splits.map((split) => ({
      to: getAddress(split.recipient) as Address,
      requestedAmount: parseBigInt(split.amount, "split amount").toString(),
    })),
  ];

  return {
    isBatch: transferDetails.length > 1,
    permitted,
    transferDetails,
    primaryAmount,
    splitTotal,
  };
}

export function createPermitPayload(parameters: {
  deadline: bigint;
  nonce: bigint;
  request: ChargeRequest;
}): Omit<ChargePermit2Payload, "signature"> {
  const plan = createTransferPlan(parameters.request);

  if (plan.isBatch) {
    const permit: PermitBatchPayload = {
      permitted: plan.permitted,
      nonce: parameters.nonce.toString(),
      deadline: parameters.deadline.toString(),
    };
    const witness: TransferBatchWitness = {
      transferDetails: plan.transferDetails,
    };
    return {
      type: "permit2",
      permit,
      witness,
    };
  }

  const permit: PermitSinglePayload = {
    permitted: plan.permitted[0]!,
    nonce: parameters.nonce.toString(),
    deadline: parameters.deadline.toString(),
  };
  const witness: TransferSingleWitness = {
    transferDetails: plan.transferDetails[0]!,
  };
  return {
    type: "permit2",
    permit,
    witness,
  };
}

export function normalizePermitted(
  permitted: PermitSinglePayload["permitted"] | PermitBatchPayload["permitted"],
): Array<{ token: Address; amount: string }> {
  return Array.isArray(permitted)
    ? permitted.map((entry) => ({
        token: getAddress(entry.token) as Address,
        amount: parseBigInt(entry.amount, "permitted amount").toString(),
      }))
    : [
        {
          token: getAddress(permitted.token) as Address,
          amount: parseBigInt(permitted.amount, "permitted amount").toString(),
        },
      ];
}

export function normalizeTransferDetails(
  transferDetails:
    | TransferSingleWitness["transferDetails"]
    | TransferBatchWitness["transferDetails"],
): TransferDetail[] {
  return Array.isArray(transferDetails)
    ? transferDetails.map((entry) => ({
        to: getAddress(entry.to) as Address,
        requestedAmount: parseBigInt(
          entry.requestedAmount,
          "requested amount",
        ).toString(),
      }))
    : [
        {
          to: getAddress(transferDetails.to) as Address,
          requestedAmount: parseBigInt(
            transferDetails.requestedAmount,
            "requested amount",
          ).toString(),
        },
      ];
}

export function isBatchPayload(payload: ChargePermit2Payload): boolean {
  return Array.isArray(payload.permit.permitted);
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
  const permitted = normalizePermitted(payload.permit.permitted);
  const transferDetails = normalizeTransferDetails(
    payload.witness.transferDetails,
  );

  if (
    permitted.length !== plan.permitted.length ||
    transferDetails.length !== plan.transferDetails.length
  ) {
    throw new Error(
      "Use the exact transfer count from the payment challenge before retrying. The current payload does not match the requested split layout.",
    );
  }

  for (let index = 0; index < plan.permitted.length; index += 1) {
    const expectedPermit = plan.permitted[index]!;
    const actualPermit = permitted[index]!;
    if (
      getAddress(actualPermit.token) !== getAddress(expectedPermit.token) ||
      actualPermit.amount !== expectedPermit.amount
    ) {
      throw new Error(
        `Use the requested token and amount for transfer ${index + 1} before retrying. The signed Permit2 payload changed those values.`,
      );
    }
  }

  for (let index = 0; index < plan.transferDetails.length; index += 1) {
    const expectedTransfer = plan.transferDetails[index]!;
    const actualTransfer = transferDetails[index]!;
    if (
      getAddress(actualTransfer.to) !== getAddress(expectedTransfer.to) ||
      actualTransfer.requestedAmount !== expectedTransfer.requestedAmount
    ) {
      throw new Error(
        `Use the requested recipient and amount ordering for transfer ${index + 1} before retrying. The signed Permit2 payload changed those details.`,
      );
    }
  }

  return plan;
}

export function buildTypedData(parameters: {
  chainId: number;
  payload: ChargePermit2Payload;
  permit2Address: Address;
  spender: Address;
}): PermitTypedData {
  const isBatch = isBatchPayload(parameters.payload);
  const permitted = normalizePermitted(parameters.payload.permit.permitted);
  const nonce = BigInt(parameters.payload.permit.nonce);
  const deadline = BigInt(parameters.payload.permit.deadline);

  return isBatch
    ? buildBatchTypedData({
        chainId: parameters.chainId,
        deadline,
        nonce,
        payload: parameters.payload,
        permit2Address: parameters.permit2Address,
        permitted,
        spender: parameters.spender,
      })
    : buildSingleTypedData({
        chainId: parameters.chainId,
        deadline,
        nonce,
        payload: parameters.payload,
        permit2Address: parameters.permit2Address,
        permitted,
        spender: parameters.spender,
      });
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

function buildSingleTypedData(parameters: {
  chainId: number;
  deadline: bigint;
  nonce: bigint;
  payload: ChargePermit2Payload;
  permit2Address: Address;
  permitted: Array<{ token: Address; amount: string }>;
  spender: Address;
}): PermitTypedData {
  const transferDetails = normalizeTransferDetails(
    parameters.payload.witness.transferDetails,
  )[0]!;

  return {
    domain: permit2Domain(parameters.chainId, parameters.permit2Address),
    primaryType: "PermitWitnessTransferFrom",
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: SINGLE_WITNESS_TYPE_NAME },
      ],
      ...tokenPermissionTypes(),
      [SINGLE_WITNESS_TYPE_NAME]: [
        { name: "transferDetails", type: "TransferDetails" },
      ],
      ...transferDetailsTypes(),
    },
    message: {
      permitted: {
        token: parameters.permitted[0]!.token,
        amount: BigInt(parameters.permitted[0]!.amount),
      },
      spender: parameters.spender,
      nonce: parameters.nonce,
      deadline: parameters.deadline,
      witness: {
        transferDetails: {
          to: transferDetails.to,
          requestedAmount: BigInt(transferDetails.requestedAmount),
        },
      },
    },
  };
}

function buildBatchTypedData(parameters: {
  chainId: number;
  deadline: bigint;
  nonce: bigint;
  payload: ChargePermit2Payload;
  permit2Address: Address;
  permitted: Array<{ token: Address; amount: string }>;
  spender: Address;
}): PermitTypedData {
  const transferDetails = normalizeTransferDetails(
    parameters.payload.witness.transferDetails,
  );

  return {
    domain: permit2Domain(parameters.chainId, parameters.permit2Address),
    primaryType: "PermitBatchWitnessTransferFrom",
    types: {
      PermitBatchWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions[]" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: BATCH_WITNESS_TYPE_NAME },
      ],
      ...tokenPermissionTypes(),
      [BATCH_WITNESS_TYPE_NAME]: [
        { name: "transferDetails", type: "TransferDetails[]" },
      ],
      ...transferDetailsTypes(),
    },
    message: {
      permitted: parameters.permitted.map((entry) => ({
        token: entry.token,
        amount: BigInt(entry.amount),
      })),
      spender: parameters.spender,
      nonce: parameters.nonce,
      deadline: parameters.deadline,
      witness: {
        transferDetails: transferDetails.map((entry) => ({
          to: entry.to,
          requestedAmount: BigInt(entry.requestedAmount),
        })),
      },
    },
  };
}

export async function recoverPermitOwner(parameters: {
  chainId: number;
  payload: ChargePermit2Payload;
  permit2Address: Address;
  spender: Address;
}): Promise<Address> {
  const typedData = buildTypedData(parameters);
  return (await recoverTypedDataAddress({
    domain: typedData.domain,
    message: typedData.message,
    primaryType: typedData.primaryType,
    signature: parameters.payload.signature as Hex,
    types: typedData.types,
  } as PermitTypedData & { signature: Hex })) as Address;
}

export function encodePermit2Calldata(parameters: {
  owner: Address;
  payload: ChargePermit2Payload;
}): Hex {
  const witnessHash = hashWitness(parameters.payload);
  const witnessTypeString = getWitnessTypeString(parameters.payload);

  if (isBatchPayload(parameters.payload)) {
    return encodeFunctionData({
      abi: PERMIT2_ABI,
      functionName: "permitWitnessTransferFrom",
      args: [
        {
          permitted: normalizePermitted(
            parameters.payload.permit.permitted,
          ).map((entry) => ({
            token: entry.token,
            amount: BigInt(entry.amount),
          })),
          nonce: BigInt(parameters.payload.permit.nonce),
          deadline: BigInt(parameters.payload.permit.deadline),
        },
        normalizeTransferDetails(
          parameters.payload.witness.transferDetails,
        ).map((entry) => ({
          to: entry.to,
          requestedAmount: BigInt(entry.requestedAmount),
        })),
        parameters.owner,
        witnessHash,
        witnessTypeString,
        parameters.payload.signature,
      ],
    } as Parameters<typeof encodeFunctionData>[0]);
  }

  const transferDetail = normalizeTransferDetails(
    parameters.payload.witness.transferDetails,
  )[0]!;
  return encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "permitWitnessTransferFrom",
    args: [
      {
        permitted: {
          token: normalizePermitted(parameters.payload.permit.permitted)[0]!
            .token,
          amount: BigInt(
            normalizePermitted(parameters.payload.permit.permitted)[0]!.amount,
          ),
        },
        nonce: BigInt(parameters.payload.permit.nonce),
        deadline: BigInt(parameters.payload.permit.deadline),
      },
      {
        to: transferDetail.to,
        requestedAmount: BigInt(transferDetail.requestedAmount),
      },
      parameters.owner,
      witnessHash,
      witnessTypeString,
      parameters.payload.signature,
    ],
  } as Parameters<typeof encodeFunctionData>[0]);
}

export function decodePermit2Transaction(input: Hex): {
  owner: Address;
  payload: ChargePermit2Payload;
} {
  const decoded = decodeFunctionData({
    abi: PERMIT2_ABI,
    data: input,
  });

  if (decoded.functionName !== "permitWitnessTransferFrom") {
    throw new Error(
      "Use a Permit2 witness transfer transaction before retrying the MegaETH payment.",
    );
  }

  const args = decoded.args as unknown as unknown[];
  const permit = args[0] as {
    permitted:
      | Array<{ token: Address; amount: bigint }>
      | { token: Address; amount: bigint };
    nonce: bigint;
    deadline: bigint;
  };
  if (Array.isArray(permit.permitted)) {
    const transferDetails = (
      args[1] as Array<{ to: Address; requestedAmount: bigint }>
    ).map((entry) => ({
      to: getAddress(entry.to) as Address,
      requestedAmount: entry.requestedAmount.toString(),
    }));
    const owner = getAddress(args[2] as Address) as Address;
    const payload: ChargePermit2Payload = {
      type: "permit2",
      permit: {
        permitted: permit.permitted.map((entry) => ({
          token: getAddress(entry.token) as Address,
          amount: entry.amount.toString(),
        })),
        nonce: permit.nonce.toString(),
        deadline: permit.deadline.toString(),
      },
      witness: {
        transferDetails,
      },
      signature: args[5] as Hex,
    };
    return { owner, payload };
  }

  const transferDetail = args[1] as {
    to: Address;
    requestedAmount: bigint;
  };
  const owner = getAddress(args[2] as Address) as Address;
  const payload: ChargePermit2Payload = {
    type: "permit2",
    permit: {
      permitted: {
        token: getAddress(permit.permitted.token) as Address,
        amount: permit.permitted.amount.toString(),
      },
      nonce: permit.nonce.toString(),
      deadline: permit.deadline.toString(),
    },
    witness: {
      transferDetails: {
        to: getAddress(transferDetail.to) as Address,
        requestedAmount: transferDetail.requestedAmount.toString(),
      },
    },
    signature: args[5] as Hex,
  };
  return { owner, payload };
}

export function getWitnessTypeString(payload: ChargePermit2Payload): string {
  return `${isBatchPayload(payload) ? BATCH_WITNESS_TYPE_NAME : SINGLE_WITNESS_TYPE_NAME} witness)${isBatchPayload(payload) ? BATCH_WITNESS_STRUCT : SINGLE_WITNESS_STRUCT}${TOKEN_PERMISSIONS_TYPE}${TRANSFER_DETAIL_TYPE}`;
}

export function hashWitness(payload: ChargePermit2Payload): Hex {
  if (isBatchPayload(payload)) {
    const transferDetails = normalizeTransferDetails(
      payload.witness.transferDetails,
    );
    const itemHashes = transferDetails.map(hashTransferDetail);
    const arrayHash = keccak256(concatHex(itemHashes));
    return keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [BATCH_WITNESS_TYPEHASH, arrayHash],
      ),
    );
  }

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [
        SINGLE_WITNESS_TYPEHASH,
        hashTransferDetail(
          normalizeTransferDetails(payload.witness.transferDetails)[0]!,
        ),
      ],
    ),
  );
}

function hashTransferDetail(detail: TransferDetail): Hex {
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

export function splitSummary(splits?: ChargeSplit[] | undefined): string {
  if (!splits?.length) return "no splits";
  return `${splits.length} split${splits.length === 1 ? "" : "s"}`;
}

function parseBigInt(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(
      `Use a base-unit integer string for ${label} before retrying the payment.`,
    );
  }
}
