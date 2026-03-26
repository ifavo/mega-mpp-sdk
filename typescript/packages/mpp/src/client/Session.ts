import { Credential, Method, z } from "mppx";
import { toHex, type Account, type Address, type Hex } from "viem";
import { waitForTransactionReceipt } from "viem/actions";

import * as Methods from "../Methods.js";
import {
  DelegatedSessionAuthorizer,
  WalletSessionAuthorizer,
  type SessionAuthorizer,
} from "../session/authorizers.js";
import {
  computeSessionChannelId,
  isZeroAddress,
  readSessionChannel,
} from "../session/channel.js";
import {
  createMemorySessionClientStore,
  getSessionClientScopeKey,
  type SessionClientState,
  type SessionClientStateStore,
} from "../session/store.js";
import {
  SessionClientConfigurationError,
  SessionClientStateError,
  SessionClientTransactionError,
} from "../session/errors.js";
import { createDidPkhSource } from "../utils/source.js";
import {
  resolveAccount,
  resolvePublicClient,
  resolveWalletClient,
  type WalletClientResolver,
} from "../utils/clients.js";
import { baseUnitIntegerString } from "../utils/baseUnit.js";

export const sessionContextSchema = z.object({
  action: z.optional(z.enum(["close", "open", "topUp", "voucher"])),
  additionalDepositRaw: z.optional(
    baseUnitIntegerString("session additional deposit override"),
  ),
  authorizeCurrentRequest: z.optional(z.boolean()),
  channelId: z.optional(z.hash()),
  cumulativeAmountRaw: z.optional(
    baseUnitIntegerString("session cumulative amount override"),
  ),
  depositRaw: z.optional(baseUnitIntegerString("session deposit override")),
});

export function session(
  parameters: session.Parameters,
): Method.Client<typeof Methods.session, typeof sessionContextSchema> {
  const authorizer = parameters.authorizer ?? new WalletSessionAuthorizer();
  const autoOpen = parameters.autoOpen ?? true;
  const autoTopUp = parameters.autoTopUp ?? false;
  const clientStore = parameters.store ?? createMemorySessionClientStore();

  return Method.toClient(Methods.session, {
    context: sessionContextSchema,
    async createCredential({ challenge, context }) {
      const request = challenge.request;
      const chainId = resolveSessionChallengeChainId(request);
      const validatedContext = validateSessionContext(context);
      const walletClient = await resolveWalletClient(parameters, chainId);
      const publicClient = await resolvePublicClient(parameters, chainId);
      const payer = resolveAccount(walletClient, parameters.account);
      const scopeKey = getSessionClientScopeKey({
        chainId,
        currency: request.currency as Address,
        escrowContract: request.methodDetails.escrowContract as Address,
        recipient: request.recipient as Address,
        ...(request.unitType ? { unitType: request.unitType } : {}),
      });

      parameters.onProgress?.({
        amount: request.amount,
        chainId,
        ...(validatedContext.channelId
          ? { channelId: validatedContext.channelId as Hex }
          : {}),
        currency: request.currency as Address,
        recipient: request.recipient as Address,
        type: "challenge",
      });

      let state = await resolveClientState({
        chainId,
        channelId: (validatedContext.channelId ??
          request.methodDetails.channelId) as Hex | undefined,
        payer: payer.address,
        publicClient,
        request,
        scopeKey,
        store: clientStore,
      });

      const action = resolveAction({
        autoOpen,
        autoTopUp,
        context: validatedContext,
        request,
        state,
      });

      switch (action) {
        case "open":
          return createOpenCredential({
            authorizer,
            challenge,
            chainId,
            clientStore,
            context: validatedContext,
            deposit: parameters.deposit,
            onProgress: parameters.onProgress,
            payer,
            publicClient,
            request,
            scopeKey,
            walletClient,
          });
        case "topUp":
          if (!state) {
            throw new SessionClientStateError(
              "Open a session channel before retrying a top-up. The SDK could not find an active MegaETH session for this scope.",
            );
          }

          return createTopUpCredential({
            authorizer,
            challenge,
            chainId,
            clientStore,
            context: validatedContext,
            onProgress: parameters.onProgress,
            payer,
            publicClient,
            request,
            scopeKey,
            state,
            walletClient,
          });
        case "voucher":
          if (!state) {
            throw new SessionClientStateError(
              "Open a session channel before retrying the session request. No active MegaETH channel is available for this scope.",
            );
          }

          return createVoucherCredential({
            authorizer,
            challenge,
            chainId,
            clientStore,
            context: validatedContext,
            onProgress: parameters.onProgress,
            payer,
            request,
            scopeKey,
            state,
            walletClient,
          });
        case "close":
          if (!state) {
            throw new SessionClientStateError(
              "Open a session channel before retrying the close request. No active MegaETH channel is available for this scope.",
            );
          }

          return createCloseCredential({
            authorizer,
            challenge,
            chainId,
            clientStore,
            onProgress: parameters.onProgress,
            payer,
            request,
            scopeKey,
            state,
            walletClient,
          });
      }
    },
  });
}

async function createOpenCredential(parameters: {
  authorizer: SessionAuthorizer;
  challenge: SerializedChallenge;
  chainId: number;
  clientStore: SessionClientStateStore;
  context: z.output<typeof sessionContextSchema>;
  deposit?: string | undefined;
  onProgress?: ((progress: session.Progress) => void) | undefined;
  payer: Account;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  request: Methods.SessionRequest;
  scopeKey: string;
  walletClient: Awaited<ReturnType<typeof resolveWalletClient>>;
}): Promise<string> {
  const {
    authorizer,
    challenge,
    chainId,
    context,
    payer,
    publicClient,
    request,
  } = parameters;
  const depositRaw = resolveOpenDeposit(parameters);
  const deposit = BigInt(depositRaw);
  if (deposit < BigInt(request.amount)) {
    throw new SessionClientConfigurationError(
      `Use a session deposit of at least ${request.amount} base units before retrying. The configured deposit ${depositRaw} is too small for the first request.`,
    );
  }

  const authorizedSigner = await authorizer.getAuthorizedSigner({
    chainId,
    walletAccount: payer,
    walletClient: parameters.walletClient,
  });
  const salt = makeSalt();
  const channelId = computeSessionChannelId({
    ...(authorizedSigner ? { authorizedSigner } : {}),
    chainId,
    escrowContract: request.methodDetails.escrowContract as Address,
    payee: request.recipient as Address,
    payer: payer.address,
    salt,
    token: request.currency as Address,
  });
  const cumulativeAmount = BigInt(
    context.cumulativeAmountRaw ?? request.amount,
  );

  parameters.onProgress?.({
    deposit: depositRaw,
    type: "opening",
  });

  const hash = await authorizer.openChannel({
    ...(authorizedSigner ? { authorizedSigner } : {}),
    deposit,
    escrowContract: request.methodDetails.escrowContract as Address,
    payerAccount: payer,
    payee: request.recipient as Address,
    salt,
    token: request.currency as Address,
    walletClient: parameters.walletClient,
  });

  const receipt = await waitForTransactionReceipt(publicClient, { hash });
  if (receipt.status !== "success") {
    throw new SessionClientTransactionError(
      "Broadcast a successful MegaETH session open transaction before retrying. The escrow open transaction reverted.",
    );
  }

  const signature = await authorizer.signVoucher({
    chainId,
    channelId,
    cumulativeAmount,
    escrowContract: request.methodDetails.escrowContract as Address,
    walletAccount: payer,
    walletClient: parameters.walletClient,
  });

  const nextState: SessionClientState = {
    acceptedCumulative: cumulativeAmount.toString(),
    ...(authorizedSigner ? { authorizedSigner } : {}),
    chainId,
    channelId,
    currency: request.currency as Address,
    deposit: depositRaw,
    escrowContract: request.methodDetails.escrowContract as Address,
    payer: payer.address,
    recipient: request.recipient as Address,
    signerMode: authorizer.mode,
    status: "open",
    ...(request.unitType ? { unitType: request.unitType } : {}),
    unsettledCumulative: cumulativeAmount.toString(),
  };

  await parameters.clientStore.put(parameters.scopeKey, nextState);

  parameters.onProgress?.({
    channelId,
    deposit: depositRaw,
    transactionHash: hash,
    type: "opened",
  });

  return Credential.serialize({
    challenge,
    payload: {
      action: "open",
      ...(authorizedSigner ? { authorizedSigner } : {}),
      channelId,
      cumulativeAmount: cumulativeAmount.toString(),
      deposit: depositRaw,
      hash,
      signature,
    },
    source: createDidPkhSource(
      chainId,
      await authorizer.getVoucherSourceAddress({
        chainId,
        walletAccount: payer,
        walletClient: parameters.walletClient,
      }),
    ),
  });
}

async function createVoucherCredential(parameters: {
  authorizer: SessionAuthorizer;
  challenge: SerializedChallenge;
  chainId: number;
  clientStore: SessionClientStateStore;
  context: z.output<typeof sessionContextSchema>;
  onProgress?: ((progress: session.Progress) => void) | undefined;
  payer: Account;
  request: Methods.SessionRequest;
  scopeKey: string;
  state: SessionClientState;
  walletClient: Awaited<ReturnType<typeof resolveWalletClient>>;
}): Promise<string> {
  const cumulativeAmount = resolveNextCumulative({
    currentAcceptedCumulative: parameters.state.acceptedCumulative,
    requestAmount: parameters.request.amount,
    requestedCumulativeRaw: parameters.context.cumulativeAmountRaw,
  });

  parameters.onProgress?.({
    channelId: parameters.state.channelId,
    cumulativeAmount: cumulativeAmount.toString(),
    type: "updating",
  });

  const signature = await parameters.authorizer.signVoucher({
    chainId: parameters.chainId,
    channelId: parameters.state.channelId,
    cumulativeAmount,
    escrowContract: parameters.request.methodDetails.escrowContract as Address,
    walletAccount: parameters.payer,
    walletClient: parameters.walletClient,
  });

  const nextState: SessionClientState = {
    ...parameters.state,
    acceptedCumulative: cumulativeAmount.toString(),
    unsettledCumulative: cumulativeAmount.toString(),
  };
  await parameters.clientStore.put(parameters.scopeKey, nextState);

  parameters.onProgress?.({
    channelId: parameters.state.channelId,
    cumulativeAmount: cumulativeAmount.toString(),
    type: "updated",
  });

  return Credential.serialize({
    challenge: parameters.challenge,
    payload: {
      action: "voucher",
      channelId: parameters.state.channelId,
      cumulativeAmount: cumulativeAmount.toString(),
      signature,
    },
    source: createDidPkhSource(
      parameters.chainId,
      await parameters.authorizer.getVoucherSourceAddress({
        chainId: parameters.chainId,
        walletAccount: parameters.payer,
        walletClient: parameters.walletClient,
      }),
    ),
  });
}

async function createTopUpCredential(parameters: {
  authorizer: SessionAuthorizer;
  challenge: SerializedChallenge;
  chainId: number;
  clientStore: SessionClientStateStore;
  context: z.output<typeof sessionContextSchema>;
  onProgress?: ((progress: session.Progress) => void) | undefined;
  payer: Account;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  request: Methods.SessionRequest;
  scopeKey: string;
  state: SessionClientState;
  walletClient: Awaited<ReturnType<typeof resolveWalletClient>>;
}): Promise<string> {
  const additionalDepositRaw = resolveAdditionalDeposit(parameters);
  const additionalDeposit = BigInt(additionalDepositRaw);
  if (additionalDeposit === 0n) {
    throw new SessionClientConfigurationError(
      "Use a positive additional deposit before retrying the session top-up.",
    );
  }

  parameters.onProgress?.({
    additionalDeposit: additionalDepositRaw,
    channelId: parameters.state.channelId,
    type: "toppingUp",
  });

  const hash = await parameters.authorizer.topUpChannel({
    additionalDeposit,
    channelId: parameters.state.channelId,
    escrowContract: parameters.request.methodDetails.escrowContract as Address,
    payerAccount: parameters.payer,
    walletClient: parameters.walletClient,
  });

  const receipt = await waitForTransactionReceipt(parameters.publicClient, {
    hash,
  });
  if (receipt.status !== "success") {
    throw new SessionClientTransactionError(
      "Broadcast a successful MegaETH session top-up transaction before retrying. The escrow top-up transaction reverted.",
    );
  }

  const nextDeposit = (
    BigInt(parameters.state.deposit) + additionalDeposit
  ).toString();
  const shouldAuthorizeCurrentRequest =
    parameters.context.authorizeCurrentRequest ?? true;
  let cumulativeAmount: bigint | undefined;
  let signature: Hex | undefined;

  if (shouldAuthorizeCurrentRequest) {
    cumulativeAmount = resolveNextCumulative({
      currentAcceptedCumulative: parameters.state.acceptedCumulative,
      requestAmount: parameters.request.amount,
      requestedCumulativeRaw: parameters.context.cumulativeAmountRaw,
    });

    signature = await parameters.authorizer.signVoucher({
      chainId: parameters.chainId,
      channelId: parameters.state.channelId,
      cumulativeAmount,
      escrowContract: parameters.request.methodDetails
        .escrowContract as Address,
      walletAccount: parameters.payer,
      walletClient: parameters.walletClient,
    });
  }

  const nextState: SessionClientState = {
    ...parameters.state,
    acceptedCumulative: cumulativeAmount
      ? cumulativeAmount.toString()
      : parameters.state.acceptedCumulative,
    deposit: nextDeposit,
    unsettledCumulative: cumulativeAmount
      ? cumulativeAmount.toString()
      : parameters.state.unsettledCumulative,
  };
  await parameters.clientStore.put(parameters.scopeKey, nextState);

  parameters.onProgress?.({
    channelId: parameters.state.channelId,
    deposit: nextDeposit,
    transactionHash: hash,
    type: "toppedUp",
  });

  return Credential.serialize({
    challenge: parameters.challenge,
    payload: {
      action: "topUp",
      additionalDeposit: additionalDepositRaw,
      channelId: parameters.state.channelId,
      ...(cumulativeAmount
        ? { cumulativeAmount: cumulativeAmount.toString() }
        : {}),
      hash,
      ...(signature ? { signature } : {}),
    },
    source: createDidPkhSource(
      parameters.chainId,
      cumulativeAmount
        ? await parameters.authorizer.getVoucherSourceAddress({
            chainId: parameters.chainId,
            walletAccount: parameters.payer,
            walletClient: parameters.walletClient,
          })
        : parameters.payer.address,
    ),
  });
}

async function createCloseCredential(parameters: {
  authorizer: SessionAuthorizer;
  challenge: SerializedChallenge;
  chainId: number;
  clientStore: SessionClientStateStore;
  onProgress?: ((progress: session.Progress) => void) | undefined;
  payer: Account;
  request: Methods.SessionRequest;
  scopeKey: string;
  state: SessionClientState;
  walletClient: Awaited<ReturnType<typeof resolveWalletClient>>;
}): Promise<string> {
  parameters.onProgress?.({
    channelId: parameters.state.channelId,
    cumulativeAmount: parameters.state.acceptedCumulative,
    type: "closing",
  });

  const signature = await parameters.authorizer.signVoucher({
    chainId: parameters.chainId,
    channelId: parameters.state.channelId,
    cumulativeAmount: BigInt(parameters.state.acceptedCumulative),
    escrowContract: parameters.request.methodDetails.escrowContract as Address,
    walletAccount: parameters.payer,
    walletClient: parameters.walletClient,
  });

  await parameters.clientStore.put(parameters.scopeKey, {
    ...parameters.state,
    status: "closing",
  });

  parameters.onProgress?.({
    channelId: parameters.state.channelId,
    cumulativeAmount: parameters.state.acceptedCumulative,
    type: "closed",
  });

  return Credential.serialize({
    challenge: parameters.challenge,
    payload: {
      action: "close",
      channelId: parameters.state.channelId,
      cumulativeAmount: parameters.state.acceptedCumulative,
      signature,
    },
    source: createDidPkhSource(
      parameters.chainId,
      await parameters.authorizer.getVoucherSourceAddress({
        chainId: parameters.chainId,
        walletAccount: parameters.payer,
        walletClient: parameters.walletClient,
      }),
    ),
  });
}

async function resolveClientState(parameters: {
  chainId: number;
  channelId?: Hex | undefined;
  payer: Address;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  request: Methods.SessionRequest;
  scopeKey: string;
  store: SessionClientStateStore;
}): Promise<SessionClientState | undefined> {
  const existing = await parameters.store.get(parameters.scopeKey);
  if (existing) return existing;
  if (!parameters.channelId) return undefined;

  const onChain = await readSessionChannel({
    channelId: parameters.channelId,
    escrowContract: parameters.request.methodDetails.escrowContract as Address,
    publicClient: parameters.publicClient,
  });
  if (onChain.finalized || onChain.deposit === 0n) {
    return undefined;
  }

  const state: SessionClientState = {
    acceptedCumulative: onChain.settled.toString(),
    ...(isZeroAddress(onChain.authorizedSigner)
      ? {}
      : { authorizedSigner: onChain.authorizedSigner }),
    chainId: parameters.chainId,
    channelId: parameters.channelId,
    currency: parameters.request.currency as Address,
    deposit: onChain.deposit.toString(),
    escrowContract: parameters.request.methodDetails.escrowContract as Address,
    payer: parameters.payer,
    recipient: parameters.request.recipient as Address,
    signerMode: isZeroAddress(onChain.authorizedSigner)
      ? "wallet"
      : "delegated",
    status: "open",
    ...(parameters.request.unitType
      ? { unitType: parameters.request.unitType }
      : {}),
    unsettledCumulative: onChain.settled.toString(),
  };

  await parameters.store.put(parameters.scopeKey, state);
  return state;
}

function resolveAction(parameters: {
  autoOpen: boolean;
  autoTopUp: session.Parameters["autoTopUp"];
  context: z.output<typeof sessionContextSchema>;
  request: Methods.SessionRequest;
  state?: SessionClientState | undefined;
}): "close" | "open" | "topUp" | "voucher" {
  if (parameters.context.action) {
    return parameters.context.action;
  }

  if (!parameters.state) {
    if (!parameters.autoOpen) {
      throw new SessionClientStateError(
        'Set autoOpen to true or pass context.action="open" before retrying. The SDK could not find an active MegaETH session for this scope.',
      );
    }

    return "open";
  }

  const remainingBalance =
    BigInt(parameters.state.deposit) -
    BigInt(parameters.state.acceptedCumulative);
  if (
    parameters.autoTopUp &&
    remainingBalance < BigInt(parameters.request.amount)
  ) {
    return "topUp";
  }

  return "voucher";
}

function resolveOpenDeposit(
  parameters: {
    context: z.output<typeof sessionContextSchema>;
    request: Methods.SessionRequest;
  } & Pick<session.Parameters, "deposit">,
): string {
  const depositRaw =
    parameters.context.depositRaw ??
    parameters.request.suggestedDeposit ??
    parameters.deposit;

  if (!depositRaw) {
    throw new SessionClientConfigurationError(
      'Provide session({ deposit: "..." }) or ensure the server challenge includes suggestedDeposit before retrying the first session request.',
    );
  }

  return depositRaw;
}

function resolveAdditionalDeposit(
  parameters: {
    context: z.output<typeof sessionContextSchema>;
    request: Methods.SessionRequest;
    state: SessionClientState;
  } & Pick<session.Parameters, "autoTopUp">,
): string {
  if (parameters.context.additionalDepositRaw) {
    return parameters.context.additionalDepositRaw;
  }

  if (typeof parameters.autoTopUp === "object" && parameters.autoTopUp.amount) {
    return parameters.autoTopUp.amount;
  }

  if (parameters.request.suggestedDeposit) {
    return parameters.request.suggestedDeposit;
  }

  return parameters.request.amount;
}

function resolveNextCumulative(parameters: {
  currentAcceptedCumulative: string;
  requestAmount: string;
  requestedCumulativeRaw?: string | undefined;
}): bigint {
  if (parameters.requestedCumulativeRaw) {
    return BigInt(parameters.requestedCumulativeRaw);
  }

  return (
    BigInt(parameters.currentAcceptedCumulative) +
    BigInt(parameters.requestAmount)
  );
}

function makeSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

type SerializedChallenge = Parameters<
  typeof Credential.serialize
>[0]["challenge"];

function resolveSessionChallengeChainId(
  request: Methods.SessionRequest,
): number {
  const chainId = request.methodDetails.chainId;
  if (chainId === undefined) {
    throw new SessionClientConfigurationError(
      "Use a session challenge that includes methodDetails.chainId before retrying the MegaETH session request.",
    );
  }

  return chainId;
}

function validateSessionContext(
  context: z.output<typeof sessionContextSchema>,
): z.output<typeof sessionContextSchema> {
  if (
    context.authorizeCurrentRequest !== undefined &&
    context.action !== "topUp"
  ) {
    throw new SessionClientConfigurationError(
      'Use authorizeCurrentRequest only with context.action="topUp" before retrying the session request.',
    );
  }

  if (
    context.authorizeCurrentRequest === false &&
    context.cumulativeAmountRaw !== undefined
  ) {
    throw new SessionClientConfigurationError(
      "Remove cumulativeAmountRaw or set authorizeCurrentRequest to true before retrying the session top-up.",
    );
  }

  return context;
}

export declare namespace session {
  type Progress =
    | {
        amount: string;
        chainId: number;
        channelId?: Hex | undefined;
        currency: Address;
        recipient: Address;
        type: "challenge";
      }
    | {
        deposit: string;
        type: "opening";
      }
    | {
        channelId: Hex;
        deposit: string;
        transactionHash: Hex;
        type: "opened";
      }
    | {
        channelId: Hex;
        cumulativeAmount: string;
        type: "updating";
      }
    | {
        channelId: Hex;
        cumulativeAmount: string;
        type: "updated";
      }
    | {
        additionalDeposit: string;
        channelId: Hex;
        type: "toppingUp";
      }
    | {
        channelId: Hex;
        deposit: string;
        transactionHash: Hex;
        type: "toppedUp";
      }
    | {
        channelId: Hex;
        cumulativeAmount: string;
        type: "closing";
      }
    | {
        channelId: Hex;
        cumulativeAmount: string;
        type: "closed";
      };

  type Parameters = WalletClientResolver & {
    account?: Account | Address | undefined;
    authorizer?: SessionAuthorizer | undefined;
    autoOpen?: boolean | undefined;
    autoTopUp?:
      | boolean
      | {
          amount?: string | undefined;
        }
      | undefined;
    deposit?: string | undefined;
    onProgress?: ((progress: Progress) => void) | undefined;
    store?: SessionClientStateStore | undefined;
  };
}

export {
  DelegatedSessionAuthorizer,
  SessionClientConfigurationError,
  SessionClientStateError,
  SessionClientTransactionError,
  WalletSessionAuthorizer,
  type SessionAuthorizer,
};
