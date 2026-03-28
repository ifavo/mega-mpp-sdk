import type { Method } from "mppx";
import { Mppx as BaseMppx } from "mppx/server";
import type { Address } from "viem";

import type { ChargeSplit } from "../Methods.js";
import type { WalletClientResolver } from "../utils/clients.js";
import type { SubmissionMode } from "../utils/submissionMode.js";
import { charge, type charge as ChargeFactory } from "./Charge.js";
import { getMegaethServerMethodMetadata } from "./methodMetadata.js";
import { session, type session as SessionFactory } from "./Session.js";

type MegaethCreateDefaults = WalletClientResolver & {
  chainId?: number | undefined;
  currency?: Address | undefined;
  feePayer?: boolean | undefined;
  permit2Address?: Address | undefined;
  recipient?: Address | undefined;
  submissionMode?: SubmissionMode | undefined;
};

export function create<const methods extends BaseMppx.Methods>(
  config: create.Config<methods>,
): BaseMppx.Mppx<ApplyMegaethMethodDefaults<methods>> {
  const {
    account,
    chainId,
    currency,
    feePayer,
    getPublicClient,
    getWalletClient,
    permit2Address,
    publicClient,
    recipient,
    rpcUrls,
    submissionMode,
    walletClient,
    methods,
    ...baseConfig
  } = config;

  return BaseMppx.create({
    ...baseConfig,
    methods: applyMegaethCreateDefaults(methods, {
      account,
      chainId,
      currency,
      feePayer,
      getPublicClient,
      getWalletClient,
      permit2Address,
      publicClient,
      recipient,
      rpcUrls,
      submissionMode,
      walletClient,
    }),
  } as BaseMppx.create.Config<methods>) as unknown as BaseMppx.Mppx<
    ApplyMegaethMethodDefaults<methods>
  >;
}

export declare namespace create {
  type Config<methods extends BaseMppx.Methods = BaseMppx.Methods> =
    BaseMppx.create.Config<methods> & MegaethCreateDefaults;
}

type MppxNamespace = {
  compose: typeof BaseMppx.compose;
  create: typeof create;
  toNodeListener: typeof BaseMppx.toNodeListener;
};

export const Mppx: MppxNamespace = {
  compose: BaseMppx.compose,
  create,
  toNodeListener: BaseMppx.toNodeListener,
};

type ChargeHandlerDefaults = {
  currency: Address;
  methodDetails: {
    chainId?: number | undefined;
    feePayer?: boolean | undefined;
    permit2Address?: Address | undefined;
    splits?: ChargeSplit[] | undefined;
  };
  recipient?: Address | undefined;
};

type SessionHandlerDefaults = {
  currency: Address;
  methodDetails: {
    chainId?: number | undefined;
    channelId?: `0x${string}` | undefined;
    escrowContract?: Address | undefined;
    minVoucherDelta?: string | undefined;
  };
  recipient?: Address | undefined;
  suggestedDeposit?: string | undefined;
  unitType?: string | undefined;
};

type ApplyMegaethMethodDefaults<methods extends BaseMppx.Methods> =
  methods extends readonly [infer head, ...infer tail extends BaseMppx.Methods]
    ? head extends readonly Method.AnyServer[]
      ? readonly [
          ApplyMegaethMethodDefaults<head>,
          ...ApplyMegaethMethodDefaults<tail>,
        ]
      : head extends Method.AnyServer
        ? readonly [
            ApplyMegaethMethodDefaultsToMethod<head>,
            ...ApplyMegaethMethodDefaults<tail>,
          ]
        : never
    : readonly [];

type ApplyMegaethMethodDefaultsToMethod<method> =
  method extends Method.Server<
    infer schema,
    infer defaults,
    infer transportOverride
  >
    ? schema["name"] extends "megaeth"
      ? schema["intent"] extends "charge"
        ? Method.Server<
            schema,
            defaults & ChargeHandlerDefaults,
            transportOverride
          >
        : schema["intent"] extends "session"
          ? Method.Server<
              schema,
              defaults & SessionHandlerDefaults,
              transportOverride
            >
          : method
      : method
    : method;

function applyMegaethCreateDefaults<methods extends BaseMppx.Methods>(
  methods: methods,
  defaults: MegaethCreateDefaults,
): methods {
  return methods.map((entry) => {
    if (Array.isArray(entry)) {
      return applyMegaethCreateDefaults(entry, defaults);
    }

    const metadata = getMegaethServerMethodMetadata(entry);
    if (!metadata) {
      return entry;
    }

    if (metadata.intent === "charge") {
      return charge(applyChargeDefaults(metadata.parameters, defaults));
    }

    return session(applySessionDefaults(metadata.parameters, defaults));
  }) as unknown as methods;
}

function applyChargeDefaults(
  parameters: ChargeFactory.Parameters,
  defaults: MegaethCreateDefaults,
): ChargeFactory.Parameters {
  return {
    ...applyCommonDefaults(parameters, defaults),
    ...(parameters.feePayer === undefined && defaults.feePayer !== undefined
      ? { feePayer: defaults.feePayer }
      : {}),
    ...(parameters.permit2Address === undefined &&
    defaults.permit2Address !== undefined
      ? { permit2Address: defaults.permit2Address }
      : {}),
    ...(parameters.submissionMode === undefined &&
    defaults.submissionMode !== undefined
      ? { submissionMode: defaults.submissionMode }
      : {}),
  };
}

function applySessionDefaults(
  parameters: SessionFactory.Parameters,
  defaults: MegaethCreateDefaults,
): SessionFactory.Parameters {
  return applyCommonDefaults(parameters, defaults);
}

function applyCommonDefaults<
  parameters extends WalletClientResolver & {
    chainId?: number | undefined;
    currency?: Address | undefined;
    recipient?: Address | undefined;
  },
>(parameters: parameters, defaults: MegaethCreateDefaults): parameters {
  const mergedRpcUrls =
    defaults.rpcUrls || parameters.rpcUrls
      ? {
          ...(defaults.rpcUrls ?? {}),
          ...(parameters.rpcUrls ?? {}),
        }
      : undefined;

  return {
    ...parameters,
    ...(parameters.account === undefined && defaults.account !== undefined
      ? { account: defaults.account }
      : {}),
    ...(parameters.chainId === undefined && defaults.chainId !== undefined
      ? { chainId: defaults.chainId }
      : {}),
    ...(parameters.currency === undefined && defaults.currency !== undefined
      ? { currency: defaults.currency }
      : {}),
    ...(parameters.getPublicClient === undefined &&
    defaults.getPublicClient !== undefined
      ? { getPublicClient: defaults.getPublicClient }
      : {}),
    ...(parameters.getWalletClient === undefined &&
    defaults.getWalletClient !== undefined
      ? { getWalletClient: defaults.getWalletClient }
      : {}),
    ...(parameters.publicClient === undefined &&
    defaults.publicClient !== undefined
      ? { publicClient: defaults.publicClient }
      : {}),
    ...(parameters.recipient === undefined && defaults.recipient !== undefined
      ? { recipient: defaults.recipient }
      : {}),
    ...(mergedRpcUrls ? { rpcUrls: mergedRpcUrls } : {}),
    ...(parameters.walletClient === undefined &&
    defaults.walletClient !== undefined
      ? { walletClient: defaults.walletClient }
      : {}),
  };
}
