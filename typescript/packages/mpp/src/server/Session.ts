import { Errors, Method, Receipt } from "mppx";
import { Store } from "mppx/server";
import { getAddress, type Account, type Address, type Hex } from "viem";
import {
  getTransaction,
  getTransactionReceipt,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";

import * as Methods from "../Methods.js";
import { SESSION_ESCROW_ABI } from "../session/abi.js";
import {
  computeSessionChannelId,
  decodeSessionEscrowCall,
  isZeroAddress,
  readSessionChannel,
  type SessionOnChainChannel,
} from "../session/channel.js";
import {
  createSessionChannelStore,
  getSessionChannelKey,
  type SessionChannelState,
} from "../session/store.js";
import { recoverSessionVoucherSigner } from "../session/voucher.js";
import {
  resolveAccount,
  resolveChainId,
  resolvePublicClient,
  resolveWalletClient,
  type WalletClientResolver,
} from "../utils/clients.js";
import { parseDidPkhSource } from "../utils/source.js";

export function session(
  parameters: session.Parameters,
): Method.Server<typeof Methods.session> {
  const { account, store = Store.memory() } = parameters;

  if (!parameters.settlement) {
    throw badRequest(
      "Provide settlement.periodic and settlement.close configuration so the MegaETH session server can verify and settle accepted vouchers.",
    );
  }

  if (!parameters.settlement.close.enabled) {
    throw badRequest(
      "Enable settlement.close before creating the MegaETH session server because cooperative close is part of the v1 session flow.",
    );
  }

  const channelStore = createSessionChannelStore(store);

  return Method.toServer(Methods.session, {
    async request({ credential, request }) {
      if (credential) {
        return credential.challenge.request as typeof request;
      }

      const chainId = resolveChainId({
        chainId: request.methodDetails.chainId ?? parameters.chainId,
        testnet: parameters.testnet,
      });
      const recipient = resolveRequestAddress({
        configured: parameters.recipient,
        label: "a recipient address",
        value: request.recipient as Address | undefined,
      });
      const currency = resolveRequestAddress({
        configured: parameters.currency,
        label: "a currency address",
        value: request.currency as Address | undefined,
      });
      const escrowContract = resolveRequestAddress({
        configured: parameters.escrowContract,
        label: "an escrow contract address",
        value: request.methodDetails.escrowContract as Address | undefined,
      });

      return {
        ...request,
        currency,
        recipient,
        ...(request.suggestedDeposit
          ? {}
          : parameters.suggestedDeposit
            ? { suggestedDeposit: parameters.suggestedDeposit }
            : {}),
        ...(request.unitType
          ? {}
          : parameters.unitType
            ? { unitType: parameters.unitType }
            : {}),
        methodDetails: {
          ...request.methodDetails,
          chainId,
          escrowContract,
          ...(request.methodDetails.minVoucherDelta
            ? {}
            : parameters.verifier?.minVoucherDelta
              ? { minVoucherDelta: parameters.verifier.minVoucherDelta }
              : {}),
        },
      };
    },

    async verify({ credential }) {
      const challenge = credential.challenge.request;
      const chainId = resolveSessionChallengeChainId(challenge);
      const publicClient = await resolvePublicClient(parameters, chainId);
      const challengeId = credential.challenge.id;

      if (
        credential.challenge.expires &&
        new Date(credential.challenge.expires) < new Date()
      ) {
        throw new Errors.PaymentExpiredError({
          expires: credential.challenge.expires,
        });
      }

      await assertChallengeAvailable(store, challengeId);

      switch (credential.payload.action) {
        case "open":
          return verifyOpenAction({
            account,
            challenge,
            challengeId,
            channelStore,
            parameters,
            payload: credential.payload,
            publicClient,
            source: credential.source,
            store,
          });
        case "topUp":
          return verifyTopUpAction({
            account,
            challenge,
            challengeId,
            channelStore,
            parameters,
            payload: credential.payload,
            publicClient,
            source: credential.source,
            store,
          });
        case "voucher":
          return verifyVoucherAction({
            challenge,
            challengeId,
            channelStore,
            parameters,
            payload: credential.payload,
            publicClient,
            source: credential.source,
            store,
          });
        case "close":
          return verifyCloseAction({
            account,
            challenge,
            challengeId,
            channelStore,
            parameters,
            payload: credential.payload,
            publicClient,
            source: credential.source,
            store,
          });
      }
    },

    respond({ credential }) {
      if (credential.payload.action === "close") {
        return new Response(null, { status: 204 });
      }

      if (
        credential.payload.action === "topUp" &&
        (!credential.payload.cumulativeAmount || !credential.payload.signature)
      ) {
        return new Response(null, { status: 204 });
      }

      return undefined;
    },
  });
}

async function verifyOpenAction(parameters: {
  account?: Account | Address | undefined;
  challenge: Methods.SessionRequest;
  challengeId: string;
  channelStore: ReturnType<typeof createSessionChannelStore>;
  parameters: session.Parameters;
  payload: Methods.SessionOpenPayload;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  source?: string | undefined;
  store: Store.Store;
}) {
  const { challenge, challengeId, payload, publicClient, source, store } =
    parameters;
  const challengeChainId = resolveSessionChallengeChainId(challenge);
  const transactionHash = payload.hash as Hex;
  await assertHashAvailable(store, transactionHash);

  const receipt = await getTransactionReceipt(publicClient, {
    hash: transactionHash,
  });
  if (receipt.status !== "success") {
    throw verificationFailed(
      "Broadcast a successful MegaETH session open transaction before retrying the session request.",
    );
  }

  const transaction = await getTransaction(publicClient, {
    hash: transactionHash,
  });
  if (
    !transaction.to ||
    getAddress(transaction.to) !==
      getAddress(challenge.methodDetails.escrowContract as Address)
  ) {
    throw verificationFailed(
      "Broadcast the session open transaction to the configured MegaETH escrow contract before retrying.",
    );
  }

  const decoded = decodeSessionEscrowCall(transaction.input);
  if (decoded.functionName !== "open") {
    throw invalidPayload(
      "Use a MegaETH session escrow open transaction before retrying the first session request.",
    );
  }

  if (decoded.args.payee !== getAddress(challenge.recipient as Address)) {
    throw verificationFailed(
      "Open the session channel for the configured recipient before retrying the request.",
    );
  }
  if (decoded.args.token !== getAddress(challenge.currency as Address)) {
    throw verificationFailed(
      "Open the session channel for the configured token before retrying the request.",
    );
  }
  if (decoded.args.deposit.toString() !== payload.deposit) {
    throw invalidPayload(
      "Use an open payload whose declared deposit matches the on-chain transaction amount before retrying.",
    );
  }

  const channelId = computeSessionChannelId({
    ...(isZeroAddress(decoded.args.authorizedSigner)
      ? {}
      : { authorizedSigner: decoded.args.authorizedSigner }),
    chainId: challengeChainId,
    escrowContract: challenge.methodDetails.escrowContract as Address,
    payee: challenge.recipient as Address,
    payer: getAddress(transaction.from),
    salt: decoded.args.salt,
    token: challenge.currency as Address,
  });
  if (channelId !== payload.channelId) {
    throw verificationFailed(
      "Retry with a channelId that matches the on-chain open transaction parameters exactly.",
    );
  }

  if (BigInt(payload.cumulativeAmount) !== BigInt(challenge.amount)) {
    throw verificationFailed(
      `Use an initial voucher amount of ${challenge.amount} base units for the first paid request before retrying.`,
    );
  }

  const onChain = await readSessionChannel({
    channelId,
    escrowContract: challenge.methodDetails.escrowContract as Address,
    publicClient,
  });
  validateOnChainChannel(onChain, challenge);
  assertDelegatedSignerAllowed(parameters.parameters, onChain);

  const expectedSigner = getExpectedSigner(onChain);
  const recoveredSigner = await recoverSessionVoucherSigner({
    chainId: challengeChainId,
    channelId,
    cumulativeAmount: BigInt(payload.cumulativeAmount),
    escrowContract: challenge.methodDetails.escrowContract as Address,
    signature: payload.signature as Hex,
  });
  if (recoveredSigner !== expectedSigner) {
    throw verificationFailed(
      "Sign the session voucher with the payer or configured authorized signer before retrying the session request.",
    );
  }

  validateSource(source, challengeChainId, recoveredSigner);

  let state: SessionChannelState = {
    acceptedCumulative: payload.cumulativeAmount,
    ...(isZeroAddress(onChain.authorizedSigner)
      ? {}
      : { authorizedSigner: onChain.authorizedSigner }),
    chainId: challengeChainId,
    channelId,
    ...(onChain.closeRequestedAt > 0n
      ? { closeRequestedAt: onChain.closeRequestedAt.toString() }
      : {}),
    currency: challenge.currency as Address,
    deposit: onChain.deposit.toString(),
    escrowContract: challenge.methodDetails.escrowContract as Address,
    lastChallengeId: challengeId,
    lastOnChainVerifiedAt: new Date().toISOString(),
    lastVoucherSignature: payload.signature as Hex,
    payer: onChain.payer,
    recipient: challenge.recipient as Address,
    settled: onChain.settled.toString(),
    status: onChain.closeRequestedAt > 0n ? "close_requested" : "open",
    ...(challenge.unitType ? { unitType: challenge.unitType } : {}),
  };

  state = await maybeSettleChannel({
    account: parameters.account,
    channelStore: parameters.channelStore,
    parameters: parameters.parameters,
    publicClient,
    state,
  });

  await parameters.channelStore.updateChannel(
    getSessionChannelKey({
      chainId: challengeChainId,
      channelId,
      escrowContract: challenge.methodDetails.escrowContract as Address,
    }),
    () => state,
  );

  await markChallengeAndHashConsumed({
    challengeId,
    hash: transactionHash,
    store,
  });

  return createSessionReceipt({
    channelId,
    externalId: challenge.externalId,
  });
}

async function verifyVoucherAction(parameters: {
  challenge: Methods.SessionRequest;
  challengeId: string;
  channelStore: ReturnType<typeof createSessionChannelStore>;
  parameters: session.Parameters;
  payload: Methods.SessionVoucherPayload;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  source?: string | undefined;
  store: Store.Store;
}) {
  const { challenge, challengeId, payload, publicClient, source, store } =
    parameters;
  const challengeChainId = resolveSessionChallengeChainId(challenge);
  const state = await loadOrRecoverState({
    challenge,
    channelId: payload.channelId as Hex,
    channelStore: parameters.channelStore,
    publicClient,
  });
  const onChain = await refreshOnChainStateIfNeeded({
    challenge,
    parameters: parameters.parameters,
    publicClient,
    state,
  });

  validateOnChainChannel(onChain, challenge);
  assertDelegatedSignerAllowed(parameters.parameters, onChain);

  const expectedCumulative =
    BigInt(state.acceptedCumulative) + BigInt(challenge.amount);
  if (BigInt(payload.cumulativeAmount) !== expectedCumulative) {
    throw verificationFailed(
      `Use a cumulative voucher amount of ${expectedCumulative.toString()} base units before retrying the session request.`,
    );
  }

  const delta = expectedCumulative - BigInt(state.acceptedCumulative);
  const minVoucherDelta = BigInt(
    challenge.methodDetails.minVoucherDelta ??
      parameters.parameters.verifier?.minVoucherDelta ??
      "0",
  );
  if (delta < minVoucherDelta) {
    throw verificationFailed(
      `Increase the voucher delta to at least ${minVoucherDelta.toString()} base units before retrying the session request.`,
    );
  }

  if (expectedCumulative > onChain.deposit) {
    throw insufficient(
      `Top up the MegaETH session channel so the deposit covers ${expectedCumulative.toString()} base units before retrying the session request.`,
    );
  }

  const expectedSigner = getExpectedSigner(onChain);
  const recoveredSigner = await recoverSessionVoucherSigner({
    chainId: challengeChainId,
    channelId: payload.channelId as Hex,
    cumulativeAmount: expectedCumulative,
    escrowContract: challenge.methodDetails.escrowContract as Address,
    signature: payload.signature as Hex,
  });
  if (recoveredSigner !== expectedSigner) {
    throw verificationFailed(
      "Sign the session voucher with the payer or configured authorized signer before retrying the request.",
    );
  }

  validateSource(source, challengeChainId, recoveredSigner);

  let nextState: SessionChannelState = {
    ...state,
    acceptedCumulative: payload.cumulativeAmount,
    ...(onChain.closeRequestedAt > 0n
      ? { closeRequestedAt: onChain.closeRequestedAt.toString() }
      : { closeRequestedAt: undefined }),
    deposit: onChain.deposit.toString(),
    lastChallengeId: challengeId,
    lastOnChainVerifiedAt: new Date().toISOString(),
    lastVoucherSignature: payload.signature as Hex,
    status: onChain.closeRequestedAt > 0n ? "close_requested" : "open",
  };

  nextState = await maybeSettleChannel({
    channelStore: parameters.channelStore,
    parameters: parameters.parameters,
    publicClient,
    state: nextState,
  });

  await parameters.channelStore.updateChannel(
    getSessionChannelKey({
      chainId: challengeChainId,
      channelId: payload.channelId as Hex,
      escrowContract: challenge.methodDetails.escrowContract as Address,
    }),
    () => nextState,
  );
  await store.put(getChallengeStoreKey(challengeId), payload.channelId);

  return createSessionReceipt({
    channelId: payload.channelId as Hex,
    externalId: challenge.externalId,
  });
}

async function verifyTopUpAction(parameters: {
  account?: Account | Address | undefined;
  challenge: Methods.SessionRequest;
  challengeId: string;
  channelStore: ReturnType<typeof createSessionChannelStore>;
  parameters: session.Parameters;
  payload: Methods.SessionTopUpPayload;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  source?: string | undefined;
  store: Store.Store;
}) {
  const { challenge, challengeId, payload, publicClient, source, store } =
    parameters;
  const challengeChainId = resolveSessionChallengeChainId(challenge);
  await assertHashAvailable(store, payload.hash as Hex);

  const state = await loadOrRecoverState({
    challenge,
    channelId: payload.channelId as Hex,
    channelStore: parameters.channelStore,
    publicClient,
  });

  const receipt = await getTransactionReceipt(publicClient, {
    hash: payload.hash as Hex,
  });
  if (receipt.status !== "success") {
    throw verificationFailed(
      "Broadcast a successful MegaETH session top-up transaction before retrying.",
    );
  }

  const transaction = await getTransaction(publicClient, {
    hash: payload.hash as Hex,
  });
  if (
    !transaction.to ||
    getAddress(transaction.to) !==
      getAddress(challenge.methodDetails.escrowContract as Address)
  ) {
    throw verificationFailed(
      "Broadcast the top-up transaction to the configured MegaETH escrow contract before retrying.",
    );
  }

  const decoded = decodeSessionEscrowCall(transaction.input);
  if (decoded.functionName !== "topUp") {
    throw invalidPayload(
      "Use a MegaETH session escrow topUp transaction before retrying the top-up request.",
    );
  }
  if (decoded.args.channelId !== payload.channelId) {
    throw verificationFailed(
      "Retry with a top-up payload whose channelId matches the on-chain transaction exactly.",
    );
  }
  if (decoded.args.additionalDeposit.toString() !== payload.additionalDeposit) {
    throw invalidPayload(
      "Use a top-up payload whose declared additionalDeposit matches the on-chain transaction amount before retrying.",
    );
  }

  const onChain = await readSessionChannel({
    channelId: payload.channelId as Hex,
    escrowContract: challenge.methodDetails.escrowContract as Address,
    publicClient,
  });
  validateOnChainChannel(onChain, challenge);
  if (onChain.deposit <= BigInt(state.deposit)) {
    throw verificationFailed(
      "Increase the escrow deposit on-chain before retrying. The session top-up transaction did not raise the channel balance.",
    );
  }

  let acceptedCumulative = state.acceptedCumulative;
  let lastVoucherSignature = state.lastVoucherSignature;

  if (payload.cumulativeAmount || payload.signature) {
    if (!payload.cumulativeAmount || !payload.signature) {
      throw invalidPayload(
        "Provide both cumulativeAmount and signature when using a top-up payload that should also authorize the current paid request.",
      );
    }

    const expectedCumulative =
      BigInt(state.acceptedCumulative) + BigInt(challenge.amount);
    if (BigInt(payload.cumulativeAmount) !== expectedCumulative) {
      throw verificationFailed(
        `Use a cumulative voucher amount of ${expectedCumulative.toString()} base units when combining top-up with the current paid request.`,
      );
    }

    const expectedSigner = getExpectedSigner(onChain);
    const recoveredSigner = await recoverSessionVoucherSigner({
      chainId: challengeChainId,
      channelId: payload.channelId as Hex,
      cumulativeAmount: expectedCumulative,
      escrowContract: challenge.methodDetails.escrowContract as Address,
      signature: payload.signature as Hex,
    });
    if (recoveredSigner !== expectedSigner) {
      throw verificationFailed(
        "Sign the top-up voucher with the payer or configured authorized signer before retrying the session request.",
      );
    }

    validateSource(source, challengeChainId, recoveredSigner);
    acceptedCumulative = payload.cumulativeAmount;
    lastVoucherSignature = payload.signature as Hex;
  }

  let nextState: SessionChannelState = {
    ...state,
    acceptedCumulative,
    closeRequestedAt: undefined,
    deposit: onChain.deposit.toString(),
    lastChallengeId: challengeId,
    lastOnChainVerifiedAt: new Date().toISOString(),
    ...(lastVoucherSignature ? { lastVoucherSignature } : {}),
    status: "open",
  };

  if (payload.cumulativeAmount && payload.signature) {
    nextState = await maybeSettleChannel({
      account: parameters.account,
      channelStore: parameters.channelStore,
      parameters: parameters.parameters,
      publicClient,
      state: nextState,
    });
  }

  await parameters.channelStore.updateChannel(
    getSessionChannelKey({
      chainId: challengeChainId,
      channelId: payload.channelId as Hex,
      escrowContract: challenge.methodDetails.escrowContract as Address,
    }),
    () => nextState,
  );

  await markChallengeAndHashConsumed({
    challengeId,
    hash: payload.hash as Hex,
    store,
  });

  return createSessionReceipt({
    channelId: payload.channelId as Hex,
    externalId: challenge.externalId,
  });
}

async function verifyCloseAction(parameters: {
  account?: Account | Address | undefined;
  challenge: Methods.SessionRequest;
  challengeId: string;
  channelStore: ReturnType<typeof createSessionChannelStore>;
  parameters: session.Parameters;
  payload: Methods.SessionClosePayload;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  source?: string | undefined;
  store: Store.Store;
}) {
  const { challenge, challengeId, payload, publicClient, source, store } =
    parameters;
  const challengeChainId = resolveSessionChallengeChainId(challenge);
  const state = await loadOrRecoverState({
    challenge,
    channelId: payload.channelId as Hex,
    channelStore: parameters.channelStore,
    publicClient,
  });
  const onChain = await readSessionChannel({
    channelId: payload.channelId as Hex,
    escrowContract: challenge.methodDetails.escrowContract as Address,
    publicClient,
  });
  validateOnChainChannel(onChain, challenge);
  if (payload.cumulativeAmount !== state.acceptedCumulative) {
    throw verificationFailed(
      `Use the highest accepted cumulative amount (${state.acceptedCumulative}) when closing the session before retrying.`,
    );
  }

  const expectedSigner = getExpectedSigner(onChain);
  const recoveredSigner = await recoverSessionVoucherSigner({
    chainId: challengeChainId,
    channelId: payload.channelId as Hex,
    cumulativeAmount: BigInt(payload.cumulativeAmount),
    escrowContract: challenge.methodDetails.escrowContract as Address,
    signature: payload.signature as Hex,
  });
  if (recoveredSigner !== expectedSigner) {
    throw verificationFailed(
      "Sign the closing voucher with the payer or configured authorized signer before retrying the cooperative close.",
    );
  }

  validateSource(source, challengeChainId, recoveredSigner);

  const walletClient = await resolveWalletClient(
    parameters.parameters,
    challengeChainId,
  );
  const settlementAccount = resolveAccount(walletClient, parameters.account);
  if (
    getAddress(settlementAccount.address) !==
    getAddress(challenge.recipient as Address)
  ) {
    throw verificationFailed(
      "Use a settlement wallet that matches the configured session recipient before retrying the cooperative close.",
    );
  }

  const transactionHash = await writeContract(walletClient, {
    account: settlementAccount,
    address: challenge.methodDetails.escrowContract as Address,
    abi: SESSION_ESCROW_ABI,
    functionName: "close",
    args: [
      payload.channelId as Hex,
      BigInt(payload.cumulativeAmount),
      payload.signature as Hex,
    ],
    chain: walletClient.chain,
  });

  const receipt = await waitForTransactionReceipt(publicClient, {
    hash: transactionHash,
  });
  if (receipt.status !== "success") {
    throw verificationFailed(
      "Broadcast a successful MegaETH session close transaction before retrying the close request.",
    );
  }

  await parameters.channelStore.updateChannel(
    getSessionChannelKey({
      chainId: challengeChainId,
      channelId: payload.channelId as Hex,
      escrowContract: challenge.methodDetails.escrowContract as Address,
    }),
    (current) => ({
      ...(current ?? state),
      acceptedCumulative: payload.cumulativeAmount,
      lastChallengeId: challengeId,
      lastOnChainVerifiedAt: new Date().toISOString(),
      lastSettlementAt: new Date().toISOString(),
      lastSettlementReference: transactionHash,
      lastVoucherSignature: payload.signature as Hex,
      settled: payload.cumulativeAmount,
      status: "closed",
    }),
  );
  await store.put(getChallengeStoreKey(challengeId), payload.channelId);

  return createSessionReceipt({
    channelId: payload.channelId as Hex,
    externalId: challenge.externalId,
  });
}

async function loadOrRecoverState(parameters: {
  challenge: Methods.SessionRequest;
  channelId: Hex;
  channelStore: ReturnType<typeof createSessionChannelStore>;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
}): Promise<SessionChannelState> {
  const challengeChainId = resolveSessionChallengeChainId(parameters.challenge);
  const key = getSessionChannelKey({
    chainId: challengeChainId,
    channelId: parameters.channelId,
    escrowContract: parameters.challenge.methodDetails
      .escrowContract as Address,
  });
  const existing = await parameters.channelStore.getChannel(key);
  if (existing) {
    if (existing.status === "closed") {
      throw verificationFailed(
        "Request a fresh session channel before retrying. This MegaETH session has already been closed.",
      );
    }

    return existing;
  }

  const onChain = await readSessionChannel({
    channelId: parameters.channelId,
    escrowContract: parameters.challenge.methodDetails
      .escrowContract as Address,
    publicClient: parameters.publicClient,
  });
  validateOnChainChannel(onChain, parameters.challenge);

  const recovered: SessionChannelState = {
    acceptedCumulative: onChain.settled.toString(),
    ...(isZeroAddress(onChain.authorizedSigner)
      ? {}
      : { authorizedSigner: onChain.authorizedSigner }),
    chainId: challengeChainId,
    channelId: parameters.channelId,
    ...(onChain.closeRequestedAt > 0n
      ? { closeRequestedAt: onChain.closeRequestedAt.toString() }
      : {}),
    currency: parameters.challenge.currency as Address,
    deposit: onChain.deposit.toString(),
    escrowContract: parameters.challenge.methodDetails
      .escrowContract as Address,
    lastOnChainVerifiedAt: new Date().toISOString(),
    payer: onChain.payer,
    recipient: parameters.challenge.recipient as Address,
    settled: onChain.settled.toString(),
    status: onChain.closeRequestedAt > 0n ? "close_requested" : "open",
    ...(parameters.challenge.unitType
      ? { unitType: parameters.challenge.unitType }
      : {}),
  };

  await parameters.channelStore.updateChannel(key, () => recovered);
  return recovered;
}

async function refreshOnChainStateIfNeeded(parameters: {
  challenge: Methods.SessionRequest;
  parameters: session.Parameters;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  state: SessionChannelState;
}): Promise<SessionOnChainChannel> {
  const revalidateAfterMs =
    parameters.parameters.verifier?.onChainRevalidationMs;
  const shouldRefresh =
    !parameters.state.lastOnChainVerifiedAt ||
    revalidateAfterMs === undefined ||
    Date.now() - new Date(parameters.state.lastOnChainVerifiedAt).getTime() >=
      revalidateAfterMs;

  if (!shouldRefresh) {
    return {
      authorizedSigner:
        parameters.state.authorizedSigner ??
        "0x0000000000000000000000000000000000000000",
      closeRequestedAt: BigInt(parameters.state.closeRequestedAt ?? "0"),
      deposit: BigInt(parameters.state.deposit),
      finalized: parameters.state.status === "closed",
      openedAt: 0n,
      payee: parameters.state.recipient,
      payer: parameters.state.payer,
      settled: BigInt(parameters.state.settled),
      token: parameters.state.currency,
    };
  }

  return readSessionChannel({
    channelId: parameters.state.channelId,
    escrowContract: parameters.challenge.methodDetails
      .escrowContract as Address,
    publicClient: parameters.publicClient,
  });
}

async function maybeSettleChannel(parameters: {
  account?: Account | Address | undefined;
  channelStore: ReturnType<typeof createSessionChannelStore>;
  parameters: session.Parameters;
  publicClient: Awaited<ReturnType<typeof resolvePublicClient>>;
  state: SessionChannelState;
}): Promise<SessionChannelState> {
  const unsettled =
    BigInt(parameters.state.acceptedCumulative) -
    BigInt(parameters.state.settled);
  if (unsettled <= 0n) {
    return parameters.state;
  }

  const byAmount =
    unsettled >=
    BigInt(parameters.parameters.settlement.periodic.minUnsettledAmount);
  const lastSettlementAt = parameters.state.lastSettlementAt;
  const byTime =
    parameters.parameters.settlement.periodic.intervalSeconds > 0 &&
    Boolean(lastSettlementAt) &&
    Date.now() - new Date(lastSettlementAt as string).getTime() >=
      parameters.parameters.settlement.periodic.intervalSeconds * 1_000;

  if (!byAmount && !byTime) {
    return parameters.state;
  }

  if (!parameters.state.lastVoucherSignature) {
    throw verificationFailed(
      "Sign and submit a session voucher before retrying. The server cannot settle this MegaETH session without the latest voucher signature.",
    );
  }

  const walletClient = await resolveWalletClient(
    parameters.parameters,
    parameters.state.chainId,
  );
  const settlementAccount = resolveAccount(walletClient, parameters.account);
  if (
    getAddress(settlementAccount.address) !==
    getAddress(parameters.state.recipient)
  ) {
    throw verificationFailed(
      "Use a settlement wallet that matches the configured session recipient before retrying the settled session request.",
    );
  }

  const transactionHash = await writeContract(walletClient, {
    account: settlementAccount,
    address: parameters.state.escrowContract,
    abi: SESSION_ESCROW_ABI,
    functionName: "settle",
    args: [
      parameters.state.channelId,
      BigInt(parameters.state.acceptedCumulative),
      parameters.state.lastVoucherSignature,
    ],
    chain: walletClient.chain,
  });

  const receipt = await waitForTransactionReceipt(parameters.publicClient, {
    hash: transactionHash,
  });
  if (receipt.status !== "success") {
    throw verificationFailed(
      "Broadcast a successful MegaETH session settle transaction before retrying the paid request.",
    );
  }

  return {
    ...parameters.state,
    lastSettlementAt: new Date().toISOString(),
    lastSettlementReference: transactionHash,
    settled: parameters.state.acceptedCumulative,
  };
}

function validateOnChainChannel(
  onChain: SessionOnChainChannel,
  challenge: Methods.SessionRequest,
): void {
  if (onChain.deposit === 0n || onChain.finalized) {
    throw verificationFailed(
      "Open a live MegaETH session channel before retrying. The configured channel is missing or already finalized on-chain.",
    );
  }

  if (
    getAddress(onChain.payee) !== getAddress(challenge.recipient as Address)
  ) {
    throw verificationFailed(
      "Use a session channel whose payee matches the configured recipient before retrying.",
    );
  }

  if (getAddress(onChain.token) !== getAddress(challenge.currency as Address)) {
    throw verificationFailed(
      "Use a session channel whose token matches the configured currency before retrying.",
    );
  }
}

function getExpectedSigner(onChain: SessionOnChainChannel): Address {
  return isZeroAddress(onChain.authorizedSigner)
    ? getAddress(onChain.payer)
    : getAddress(onChain.authorizedSigner);
}

function assertDelegatedSignerAllowed(
  parameters: session.Parameters,
  onChain: SessionOnChainChannel,
): void {
  if (parameters.verifier?.allowDelegatedSigner === false) {
    if (
      !isZeroAddress(onChain.authorizedSigner) &&
      getAddress(onChain.authorizedSigner) !== getAddress(onChain.payer)
    ) {
      throw verificationFailed(
        "Use a payer-signed session channel or enable delegated signer verification before retrying this session request.",
      );
    }
  }
}

function createSessionReceipt(parameters: {
  channelId: Hex;
  externalId?: string | undefined;
}) {
  return Receipt.from({
    method: "megaeth",
    reference: parameters.channelId,
    status: "success",
    timestamp: new Date().toISOString(),
    ...(parameters.externalId ? { externalId: parameters.externalId } : {}),
  });
}

async function assertChallengeAvailable(
  store: Store.Store,
  challengeId: string,
): Promise<void> {
  if (await store.get(getChallengeStoreKey(challengeId))) {
    throw invalidChallenge(
      challengeId,
      "Request a fresh session challenge before retrying because this challenge has already been consumed.",
    );
  }
}

async function assertHashAvailable(
  store: Store.Store,
  hash: Hex,
): Promise<void> {
  if (await store.get(getHashStoreKey(hash))) {
    throw invalidPayload(
      "Use a fresh transaction hash before retrying because this MegaETH session transaction was already consumed.",
    );
  }
}

async function markChallengeAndHashConsumed(parameters: {
  challengeId: string;
  hash: Hex;
  store: Store.Store;
}): Promise<void> {
  await parameters.store.put(
    getChallengeStoreKey(parameters.challengeId),
    parameters.hash,
  );
  await parameters.store.put(
    getHashStoreKey(parameters.hash),
    parameters.challengeId,
  );
}

function getChallengeStoreKey(challengeId: string): string {
  return `megaeth:session:challenge:${challengeId}`;
}

function getHashStoreKey(hash: Hex): string {
  return `megaeth:session:hash:${hash.toLowerCase()}`;
}

function validateSource(
  source: string | undefined,
  chainId: number,
  signer: Address,
): void {
  if (!source) return;

  const parsed = parseDidPkhSource(source);
  if (!parsed) {
    throw invalidPayload(
      "Use a did:pkh source identifier when supplying the optional session source field.",
    );
  }

  if (parsed.chainId !== chainId || getAddress(parsed.address) !== signer) {
    throw verificationFailed(
      "Use a session source DID that matches the recovered voucher signer before retrying.",
    );
  }
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

function resolveRequestAddress(parameters: {
  configured?: Address | undefined;
  label: string;
  value?: Address | undefined;
}): Address {
  const resolved = parameters.value ?? parameters.configured;
  if (!resolved) {
    throw badRequest(
      `Provide ${parameters.label} so the server can issue MegaETH session challenges.`,
    );
  }

  return getAddress(resolved);
}

function resolveSessionChallengeChainId(
  request: Methods.SessionRequest,
): number {
  const chainId = request.methodDetails.chainId;
  if (chainId === undefined) {
    throw badRequest(
      "Issue session challenges with methodDetails.chainId before retrying because the MegaETH session server must know which network to verify.",
    );
  }

  return chainId;
}

export declare namespace session {
  type Parameters = WalletClientResolver & {
    account?: Account | Address | undefined;
    chainId?: number | undefined;
    currency?: Address | undefined;
    escrowContract?: Address | undefined;
    recipient?: Address | undefined;
    settlement: {
      close: {
        enabled: boolean;
      };
      periodic: {
        intervalSeconds: number;
        minUnsettledAmount: string;
      };
    };
    store?: Store.Store | undefined;
    suggestedDeposit?: string | undefined;
    testnet?: boolean | undefined;
    unitType?: string | undefined;
    verifier?: {
      allowDelegatedSigner?: boolean | undefined;
      minVoucherDelta?: string | undefined;
      onChainRevalidationMs?: number | undefined;
    };
  };
}
