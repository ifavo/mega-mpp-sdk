import { Errors, Receipt, Method } from "mppx";
import { Store } from "mppx/server";
import {
  call,
  getTransaction,
  getTransactionReceipt,
  readContract,
} from "viem/actions";
import {
  getAddress,
  type Account,
  type Address,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";

import { ERC20_ABI } from "../abi.js";
import { DEFAULT_USDM, PERMIT2_ADDRESS } from "../constants.js";
import * as Methods from "../Methods.js";
import {
  resolveAccount,
  resolveChargeChainId,
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
  defaultChargeSubmissionMode,
  parseSubmissionMode,
  type SubmissionMode,
} from "../utils/submissionMode.js";
import { attachMegaethServerMethodMetadata } from "./methodMetadata.js";
import { withVerificationLocks } from "./verificationLocks.js";

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
          testnet: request.methodDetails.testnet,
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
            ...(request.methodDetails.testnet ? { testnet: true } : {}),
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
        const chainId = resolveCredentialChainId(
          challenge.methodDetails,
          challengeId,
        );
        const publicClient = await resolvePublicClient(
          normalizedParameters,
          chainId,
        );

        if (
          credential.challenge.expires &&
          new Date(credential.challenge.expires) < new Date()
        ) {
          throw invalidChallenge(
            challengeId,
            "Request a fresh payment challenge before retrying because this challenge has expired",
          );
        }

        try {
          return await withVerificationLocks({
            keys: getVerificationLockKeys({
              challengeId,
              payload: credential.payload,
            }),
            store,
            task: async () => {
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
            },
          });
        } catch (error) {
          if (error instanceof Errors.PaymentError) {
            throw error;
          }

          if (
            error instanceof Permit2PayloadError ||
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
    throw verificationFailed(
      "Use a Permit2 credential instead of a hash credential for this challenge because the server asked to sponsor gas",
    );
  }
  if (challenge.methodDetails.splits?.length) {
    throw verificationFailed(
      'Use credentialMode "permit2" for split payments because PR 205 does not define a split transaction-hash credential flow.',
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
  assertPermitPayloadMatchesRequest(
    {
      type: "permit2",
      authorizations: [decoded.authorization],
    },
    challenge,
  );

  const owner = await recoverPermitOwner({
    authorization: decoded.authorization,
    chainId,
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
  assertFutureDeadlines(payload);
  const owner = await recoverAuthorizationOwner({
    authorizations: payload.authorizations,
    chainId,
    permit2Address,
    spender: challenge.recipient as Address,
  });

  validateSource(source, chainId, owner);
  await assertAllowanceAndBalance({
    owner,
    permit2Address,
    publicClient,
    requiredAmount: plan.totalAmount,
    token: challenge.currency as Address,
  });

  await simulateAuthorizations({
    account: settlementAccount,
    authorizations: payload.authorizations,
    owner,
    permit2Address,
    publicClient,
  });

  const primaryReceipt = await settleAuthorizations({
    account: settlementAccount,
    authorizations: payload.authorizations,
    challengeId,
    chainId,
    owner,
    permit2Address,
    publicClient,
    submissionMode: resolvedSubmissionMode,
    store,
    walletClient,
  });
  await store.put(
    getChallengeStoreKey(challengeId),
    primaryReceipt.transactionHash,
  );

  return Receipt.from({
    method: "megaeth",
    reference: primaryReceipt.transactionHash,
    status: "success",
    timestamp: new Date().toISOString(),
    ...(challenge.externalId ? { externalId: challenge.externalId } : {}),
  });
}

function assertFutureDeadlines(payload: Methods.ChargePermit2Payload): void {
  const now = BigInt(Math.floor(Date.now() / 1_000));

  for (const [index, authorization] of payload.authorizations.entries()) {
    const deadline = BigInt(authorization.permit.deadline);
    if (deadline <= now) {
      throw new Permit2VerificationError(
        `Use a Permit2 payload with a future deadline for ${describeAuthorization(index)} before retrying the payment.`,
      );
    }
  }
}

async function recoverAuthorizationOwner(parameters: {
  authorizations: Methods.ChargePermitAuthorization[];
  chainId: number;
  permit2Address: Address;
  spender: Address;
}): Promise<Address> {
  const [firstAuthorization, ...restAuthorizations] = parameters.authorizations;
  if (!firstAuthorization) {
    throw new Permit2VerificationError(
      "Use at least one signed Permit2 authorization before retrying the payment.",
    );
  }

  const owner = await recoverPermitOwner({
    authorization: firstAuthorization,
    chainId: parameters.chainId,
    permit2Address: parameters.permit2Address,
    spender: parameters.spender,
  });

  for (const [offset, authorization] of restAuthorizations.entries()) {
    const recovered = await recoverPermitOwner({
      authorization,
      chainId: parameters.chainId,
      permit2Address: parameters.permit2Address,
      spender: parameters.spender,
    });

    if (getAddress(recovered) !== getAddress(owner)) {
      throw new Permit2VerificationError(
        `Sign every Permit2 authorization with the same owner wallet before retrying the payment. ${describeAuthorization(offset + 1)} was signed by a different address.`,
      );
    }
  }

  return owner;
}

async function simulateAuthorizations(parameters: {
  account: Account;
  authorizations: Methods.ChargePermitAuthorization[];
  owner: Address;
  permit2Address: Address;
  publicClient: PublicClient;
}): Promise<void> {
  for (const [index, authorization] of parameters.authorizations.entries()) {
    const data = encodePermit2Calldata({
      authorization,
      owner: parameters.owner,
    });

    try {
      await call(parameters.publicClient, {
        account: parameters.account,
        data,
        to: parameters.permit2Address,
      });
    } catch (error) {
      throw new Permit2VerificationError(
        `Correct ${describeAuthorization(index)} before retrying because the Permit2 settlement simulation failed: ${toReason(error)}.`,
        { cause: error },
      );
    }
  }
}

async function settleAuthorizations(parameters: {
  account: Account;
  authorizations: Methods.ChargePermitAuthorization[];
  challengeId: string;
  chainId: number;
  owner: Address;
  permit2Address: Address;
  publicClient: PublicClient;
  store: Store.Store;
  submissionMode: SubmissionMode;
  walletClient: WalletClient;
}): Promise<TransactionReceipt> {
  let primaryReceipt: TransactionReceipt | undefined;

  for (const [index, authorization] of parameters.authorizations.entries()) {
    const data = encodePermit2Calldata({
      authorization,
      owner: parameters.owner,
    });

    try {
      const receipt = await submitTransaction({
        account: parameters.account,
        chainId: parameters.chainId,
        data,
        publicClient: parameters.publicClient,
        submissionMode: parameters.submissionMode,
        to: parameters.permit2Address,
        walletClient: parameters.walletClient,
      });

      if (receipt.status !== "success") {
        throw new Permit2VerificationError(
          `Retry after ${describeAuthorization(index)} settles successfully on-chain.`,
        );
      }

      if (!primaryReceipt) {
        primaryReceipt = receipt;
      }
    } catch (error) {
      if (index === 0) {
        throw new Permit2VerificationError(
          `Retry after the primary transfer settles successfully on-chain: ${toReason(error)}.`,
          { cause: error },
        );
      }

      await recordSplitFailure({
        authorization,
        challengeId: parameters.challengeId,
        index,
        reason: toReason(error),
        store: parameters.store,
      });
    }
  }

  if (!primaryReceipt) {
    throw new Permit2VerificationError(
      "Retry after the primary transfer settles successfully on-chain.",
    );
  }

  return primaryReceipt;
}

async function recordSplitFailure(parameters: {
  authorization: Methods.ChargePermitAuthorization;
  challengeId: string;
  index: number;
  reason: string;
  store: Store.Store;
}): Promise<void> {
  const key = getSplitFailureStoreKey(parameters.challengeId);
  const currentValue = await parameters.store.get(key);
  const failures = parseSplitFailureDiagnostics(currentValue);
  const diagnostic = {
    reason: normalizeReason(parameters.reason),
    recipient: getAddress(parameters.authorization.witness.transferDetails.to),
    requestedAmount:
      parameters.authorization.witness.transferDetails.requestedAmount,
    transferIndex: parameters.index,
  };

  failures.push(diagnostic);
  await parameters.store.put(key, JSON.stringify(failures));
  console.error(
    "[megaeth/charge] Split settlement failed after primary success",
    {
      ...diagnostic,
      challengeId: parameters.challengeId,
    },
  );
}

function parseSplitFailureDiagnostics(value: unknown): Array<{
  reason: string;
  recipient: Address;
  requestedAmount: string;
  transferIndex: number;
}> {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? (parsed as Array<{
          reason: string;
          recipient: Address;
          requestedAmount: string;
          transferIndex: number;
        }>)
      : [];
  } catch {
    return [];
  }
}

function describeAuthorization(index: number): string {
  if (index === 0) {
    return "the primary transfer";
  }

  return `split transfer ${index}`;
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
    throw verificationFailed(
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

function getSplitFailureStoreKey(challengeId: string): string {
  return `megaeth:charge:split-failure:${challengeId}`;
}

function getVerificationLockKeys(parameters: {
  challengeId: string;
  payload: Methods.ChargeCredentialPayload;
}): string[] {
  const keys = [
    `megaeth:charge:verification:challenge:${parameters.challengeId}`,
  ];

  if (parameters.payload.type === "hash") {
    keys.push(
      `megaeth:charge:verification:hash:${parameters.payload.hash.toLowerCase()}`,
    );
  }

  return keys;
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
  testnet?: boolean | undefined;
}): number {
  try {
    return resolveChargeChainId(parameters);
  } catch (error) {
    throw badRequest(toReason(error));
  }
}

function resolveCredentialChainId(
  parameters: {
    chainId?: number | undefined;
    testnet?: boolean | undefined;
  },
  challengeId: string,
): number {
  try {
    return resolveChargeChainId(parameters);
  } catch (error) {
    throw invalidChallenge(challengeId, toReason(error));
  }
}

function requireSubmissionMode(
  submissionMode: SubmissionMode | undefined,
  variableName: string,
): SubmissionMode {
  return parseSubmissionMode(submissionMode, {
    defaultMode: defaultChargeSubmissionMode,
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
