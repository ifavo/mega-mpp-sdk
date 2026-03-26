import { Errors, Receipt, Method } from "mppx";
import { Store } from "mppx/server";
import {
  getTransaction,
  getTransactionReceipt,
  readContract,
} from "viem/actions";
import {
  getAddress,
  type Account,
  type Address,
  type PublicClient,
} from "viem";

import { ERC20_ABI } from "../abi.js";
import { DEFAULT_USDM, PERMIT2_ADDRESS } from "../constants.js";
import * as Methods from "../Methods.js";
import {
  resolveAccount,
  resolveChainId,
  resolvePublicClient,
  resolveWalletClient,
  type WalletClientResolver,
} from "../utils/clients.js";
import {
  assertPermitPayloadMatchesRequest,
  decodePermit2Transaction,
  encodePermit2Calldata,
  getPermit2Address,
  Permit2PayloadError,
  Permit2ValidationError,
  Permit2VerificationError,
  recoverPermitOwner,
} from "../utils/permit2.js";
import { submitTransaction } from "../utils/rpc.js";
import { parseDidPkhSource } from "../utils/source.js";
import {
  parseSubmissionMode,
  type SubmissionMode,
} from "../utils/submissionMode.js";
import { attachMegaethServerMethodMetadata } from "./methodMetadata.js";

export function charge(
  parameters: charge.Parameters = {},
): Method.Server<typeof Methods.charge> {
  const normalizedParameters = parameters;
  const { account, store = Store.memory() } = normalizedParameters;
  const configuredCurrency = getAddress(
    normalizedParameters.currency ?? DEFAULT_USDM.address,
  );
  const configuredRecipient = resolveConfiguredRecipient(normalizedParameters);
  const configuredAccountAddress = resolveConfiguredAccountAddress(account);

  if (
    configuredAccountAddress &&
    configuredRecipient &&
    configuredAccountAddress !== configuredRecipient
  ) {
    throw badRequest(
      "Set recipient to the settlement wallet address before using direct Permit2 mode because PR 205 does not currently expose a separate spender field",
    );
  }

  return attachMegaethServerMethodMetadata(
    Method.toServer(Methods.charge, {
      defaults: {
        currency: configuredCurrency,
        ...(configuredRecipient ? { recipient: configuredRecipient } : {}),
        methodDetails: {},
      },

      async request({ credential, request }) {
        if (credential) {
          return credential.challenge.request as typeof request;
        }

        const chainId = resolveRequestChainId({
          chainId:
            request.methodDetails.chainId ?? normalizedParameters.chainId,
        });
        const resolvedCurrency = resolveRequestAddress({
          configured: configuredCurrency,
          label: "a currency address",
          value: request.currency as Address | undefined,
        });
        const resolvedRecipient = resolveRequestAddress({
          configured: configuredRecipient,
          label: "a recipient address",
          value: request.recipient as Address | undefined,
        });

        return {
          ...request,
          currency: resolvedCurrency,
          recipient: resolvedRecipient,
          methodDetails: {
            ...request.methodDetails,
            chainId,
            ...(normalizedParameters.feePayer !== undefined
              ? { feePayer: normalizedParameters.feePayer }
              : {}),
            permit2Address: (normalizedParameters.permit2Address ??
              PERMIT2_ADDRESS) as Address,
            ...(normalizedParameters.splits?.length
              ? { splits: normalizedParameters.splits }
              : {}),
          },
        };
      },

      async verify({ credential }) {
        const challenge = credential.challenge.request;
        const challengeId = credential.challenge.id;
        const chainId = resolveCredentialChainId(challenge.methodDetails);
        const publicClient = await resolvePublicClient(
          normalizedParameters,
          chainId,
        );

        if (
          credential.challenge.expires &&
          new Date(credential.challenge.expires) < new Date()
        ) {
          throw new Errors.PaymentExpiredError({
            expires: credential.challenge.expires,
          });
        }

        try {
          if (credential.payload.type === "hash") {
            return await verifyHashCredential({
              chainId,
              challenge,
              challengeId,
              hash: credential.payload.hash as `0x${string}`,
              publicClient,
              source: credential.source,
              store,
            });
          }

          return await verifyPermitCredential({
            account,
            chainId,
            challenge,
            challengeId,
            payload: credential.payload,
            publicClient,
            source: credential.source,
            store,
            submissionMode: normalizedParameters.submissionMode,
            walletClientResolver: normalizedParameters,
          });
        } catch (error) {
          if (error instanceof Errors.PaymentError) {
            throw error;
          }

          if (error instanceof Permit2PayloadError) {
            throw invalidPayload(error.message);
          }

          if (
            error instanceof Permit2ValidationError ||
            error instanceof Permit2VerificationError
          ) {
            throw verificationFailed(error.message);
          }

          throw error;
        }
      },
    }),
    {
      intent: "charge",
      parameters: normalizedParameters,
    },
  );
}

async function verifyHashCredential(parameters: {
  chainId: number;
  challenge: Methods.ChargeRequest;
  challengeId: string;
  hash: `0x${string}`;
  publicClient: PublicClient;
  source?: string | undefined;
  store: Store.Store;
}) {
  const { chainId, challenge, challengeId, hash, publicClient, source, store } =
    parameters;
  await assertChallengeAvailable(store, challengeId);

  const consumedKey = `megaeth:charge:hash:${hash.toLowerCase()}`;
  if (await store.get(consumedKey)) {
    throw invalidChallenge(
      challengeId,
      "Use a fresh transaction hash before retrying the payment because this transaction was already consumed",
    );
  }

  if (challenge.methodDetails.feePayer) {
    throw invalidPayload(
      "Use a Permit2 credential instead of a hash credential for this challenge because the server asked to sponsor gas",
    );
  }

  const receipt = await getTransactionReceipt(publicClient, { hash });
  if (receipt.status !== "success") {
    throw verificationFailed(
      "Broadcast a successful MegaETH transaction before retrying the payment",
    );
  }

  const transaction = await getTransaction(publicClient, { hash });
  if (
    !transaction.to ||
    getAddress(transaction.to) !== getPermit2Address(challenge)
  ) {
    throw verificationFailed(
      "Broadcast the payment through the Permit2 contract address from the challenge before retrying",
    );
  }

  const decoded = decodePermit2Transaction(transaction.input);
  assertPermitPayloadMatchesRequest(decoded.payload, challenge);

  const owner = await recoverPermitOwner({
    chainId,
    payload: decoded.payload,
    permit2Address: getPermit2Address(challenge),
    spender: transaction.from,
  });
  if (getAddress(owner) !== getAddress(decoded.owner)) {
    throw verificationFailed(
      "Sign the Permit2 payload with the same owner address that is encoded in the transaction",
    );
  }

  validateSource(source, chainId, owner);
  await store.put(consumedKey, true);
  await store.put(getChallengeStoreKey(challengeId), hash);

  return Receipt.from({
    method: "megaeth",
    reference: hash,
    status: "success",
    timestamp: new Date().toISOString(),
    ...(challenge.externalId ? { externalId: challenge.externalId } : {}),
  });
}

async function verifyPermitCredential(parameters: {
  account?: Account | Address | undefined;
  chainId: number;
  challenge: Methods.ChargeRequest;
  challengeId: string;
  payload: Methods.ChargePermit2Payload;
  publicClient: PublicClient;
  source?: string | undefined;
  store: Store.Store;
  walletClientResolver: WalletClientResolver;
  submissionMode?: SubmissionMode | undefined;
}) {
  const {
    account,
    chainId,
    challenge,
    challengeId,
    payload,
    publicClient,
    source,
    store,
    submissionMode,
    walletClientResolver,
  } = parameters;
  await assertChallengeAvailable(store, challengeId);
  const resolvedSubmissionMode = requireSubmissionMode(
    submissionMode,
    "submissionMode for the server-broadcast Permit2 flow",
  );

  const walletClient = await resolveWalletClient(walletClientResolver, chainId);
  const settlementAccount = resolveAccount(walletClient, account);
  if (
    getAddress(settlementAccount.address) !== getAddress(challenge.recipient)
  ) {
    throw verificationFailed(
      "Use a settlement wallet that matches the challenge recipient before retrying because PR 205-compatible direct settlement signs the recipient as the spender",
    );
  }

  const permit2Address = getPermit2Address(challenge);
  const plan = assertPermitPayloadMatchesRequest(payload, challenge);

  if (BigInt(payload.permit.deadline) < BigInt(Math.floor(Date.now() / 1000))) {
    throw verificationFailed(
      "Use a Permit2 signature with a future deadline before retrying the payment",
    );
  }

  const owner = await recoverPermitOwner({
    chainId,
    payload,
    permit2Address,
    spender: challenge.recipient as Address,
  });

  validateSource(source, chainId, owner);
  await assertAllowanceAndBalance({
    owner,
    permit2Address,
    publicClient,
    requiredAmount: plan.primaryAmount + plan.splitTotal,
    token: challenge.currency as Address,
  });

  const calldata = encodePermit2Calldata({
    owner,
    payload,
  });

  const receipt = await submitTransaction({
    account: settlementAccount,
    chainId,
    data: calldata,
    publicClient,
    submissionMode: resolvedSubmissionMode,
    to: permit2Address,
    walletClient,
  });

  if (receipt.status !== "success") {
    throw verificationFailed(
      "Retry with a Permit2 payload that simulates successfully on MegaETH before requesting the resource again",
    );
  }

  await store.put(getChallengeStoreKey(challengeId), receipt.transactionHash);

  return Receipt.from({
    method: "megaeth",
    reference: receipt.transactionHash,
    status: "success",
    timestamp: new Date().toISOString(),
    ...(challenge.externalId ? { externalId: challenge.externalId } : {}),
  });
}

async function assertAllowanceAndBalance(parameters: {
  owner: Address;
  permit2Address: Address;
  publicClient: PublicClient;
  requiredAmount: bigint;
  token: Address;
}) {
  const { owner, permit2Address, publicClient, requiredAmount, token } =
    parameters;

  const [balance, allowance] = await Promise.all([
    readContract(publicClient, {
      abi: ERC20_ABI,
      address: token,
      functionName: "balanceOf",
      args: [owner],
    }),
    readContract(publicClient, {
      abi: ERC20_ABI,
      address: token,
      functionName: "allowance",
      args: [owner, permit2Address],
    }),
  ]);

  if (balance < requiredAmount) {
    throw insufficient(
      `Fund the payer wallet with at least ${requiredAmount.toString()} base units of the payment token before retrying the payment`,
    );
  }

  if (allowance < requiredAmount) {
    throw insufficient(
      `Approve Permit2 (${permit2Address}) for at least ${requiredAmount.toString()} base units before retrying the payment`,
    );
  }
}

function validateSource(
  source: string | undefined,
  chainId: number,
  owner: Address,
): void {
  if (!source) return;

  const parsed = parseDidPkhSource(source);
  if (!parsed) {
    throw invalidPayload(
      "Use a did:pkh source identifier when supplying the optional source field",
    );
  }

  if (
    parsed.chainId !== chainId ||
    getAddress(parsed.address) !== getAddress(owner)
  ) {
    throw verificationFailed(
      "Use a source DID that matches the chainId and recovered owner address before retrying the payment",
    );
  }
}

async function assertChallengeAvailable(
  store: Store.Store,
  challengeId: string,
): Promise<void> {
  if (await store.get(getChallengeStoreKey(challengeId))) {
    throw invalidChallenge(
      challengeId,
      "Request a fresh payment challenge before retrying because this challenge has already been consumed",
    );
  }
}

function getChallengeStoreKey(challengeId: string): string {
  return `megaeth:charge:challenge:${challengeId}`;
}

function badRequest(reason: string): Errors.BadRequestError {
  return new Errors.BadRequestError({
    reason: normalizeReason(reason),
  });
}

function insufficient(reason: string): Errors.PaymentInsufficientError {
  return new Errors.PaymentInsufficientError({
    reason: normalizeReason(reason),
  });
}

function invalidChallenge(
  challengeId: string,
  reason: string,
): Errors.InvalidChallengeError {
  return new Errors.InvalidChallengeError({
    id: challengeId,
    reason: normalizeReason(reason),
  });
}

function invalidPayload(reason: string): Errors.InvalidPayloadError {
  return new Errors.InvalidPayloadError({
    reason: normalizeReason(reason),
  });
}

function verificationFailed(reason: string): Errors.VerificationFailedError {
  return new Errors.VerificationFailedError({
    reason: normalizeReason(reason),
  });
}

function normalizeReason(reason: string): string {
  return reason.trim().replace(/\.+$/, "");
}

function toReason(error: unknown): string {
  if (error instanceof Error) return normalizeReason(error.message);
  return "Retry after correcting the MegaETH payment payload";
}

function resolveConfiguredAccountAddress(
  account?: Account | Address | undefined,
): Address | undefined {
  if (!account) {
    return undefined;
  }

  return getAddress(typeof account === "string" ? account : account.address);
}

function resolveConfiguredRecipient(parameters: {
  account?: Account | Address | undefined;
  recipient?: Address | undefined;
}): Address | undefined {
  return parameters.recipient ? getAddress(parameters.recipient) : undefined;
}

function resolveRequestAddress(parameters: {
  configured?: Address | undefined;
  label: string;
  value?: Address | undefined;
}): Address {
  const resolved = parameters.value ?? parameters.configured;
  if (!resolved) {
    throw badRequest(
      `Provide ${parameters.label} so the server can issue MegaETH payment challenges`,
    );
  }

  return getAddress(resolved);
}

function resolveRequestChainId(parameters: {
  chainId?: number | undefined;
}): number {
  try {
    return resolveChainId(parameters);
  } catch (error) {
    throw badRequest(toReason(error));
  }
}

function resolveCredentialChainId(parameters: {
  chainId?: number | undefined;
}): number {
  try {
    return resolveChainId(parameters);
  } catch (error) {
    throw invalidPayload(toReason(error));
  }
}

function requireSubmissionMode(
  submissionMode: SubmissionMode | undefined,
  variableName: string,
): SubmissionMode {
  return parseSubmissionMode(submissionMode, {
    variableName,
  });
}

export declare namespace charge {
  type Parameters = WalletClientResolver & {
    account?: Account | Address | undefined;
    chainId?: number | undefined;
    currency?: Address | undefined;
    feePayer?: boolean | undefined;
    permit2Address?: Address | undefined;
    recipient?: Address | undefined;
    submissionMode?: SubmissionMode | undefined;
    splits?: Methods.ChargeSplit[] | undefined;
    store?: Store.Store | undefined;
  };
}
