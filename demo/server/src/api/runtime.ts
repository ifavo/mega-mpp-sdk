import {
  Mppx,
  Store,
  megaeth as megaethMethod,
} from "../../../../typescript/packages/mpp/src/server/index.js";
import {
  asSingleProcessSessionStore,
  createSessionChannelStore,
  type SessionChannelStore,
} from "../../../../typescript/packages/mpp/src/index.js";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";

import type { DemoMode, ModeStatus } from "../../../shared/types.js";
import { createDemoConfig, type DemoEnvironment } from "../config.js";

type HashChargeMppx = ReturnType<typeof createHashChargeMppx>;
type Permit2ChargeMppx = ReturnType<typeof createPermit2ChargeMppx>;
type SessionMppx = ReturnType<typeof createSessionMppx>;
type DemoChargeMppx = HashChargeMppx | Permit2ChargeMppx;

export type DemoChargeRuntime = ModeStatus & {
  mppx?: DemoChargeMppx | undefined;
};

export type DemoRuntimeSet = {
  config: ReturnType<typeof createDemoConfig>;
  sessionMppx?: SessionMppx | undefined;
  sessionStore: SessionChannelStore;
  chargeRuntimes: Record<DemoMode, DemoChargeRuntime>;
};

export function createDemoRuntimeSet(parameters: {
  environment: DemoEnvironment;
  store: Store.Store;
}): DemoRuntimeSet {
  const { environment, store } = parameters;
  const publicClient = createPublicClient({
    chain: environment.chain,
    transport: http(environment.rpcUrl),
  });
  const walletClient = environment.settlementAccount
    ? createWalletClient({
        account: environment.settlementAccount,
        chain: environment.chain,
        transport: http(environment.rpcUrl),
      })
    : undefined;

  const chargeRuntimes: Record<DemoMode, DemoChargeRuntime> = {
    hash: {
      ...environment.modeStatuses.hash,
      mppx:
        environment.modeStatuses.hash.ready &&
        environment.secretKey &&
        environment.recipientAddress
          ? createHashChargeMppx({
              environment,
              publicClient,
              recipient: environment.recipientAddress,
              store,
            })
          : undefined,
    },
    permit2: {
      ...environment.modeStatuses.permit2,
      mppx:
        environment.modeStatuses.permit2.ready &&
        environment.secretKey &&
        environment.recipientAddress &&
        environment.settlementAccount &&
        walletClient
          ? createPermit2ChargeMppx({
              environment,
              publicClient,
              recipient: environment.recipientAddress,
              store,
              walletClient,
            })
          : undefined,
    },
  };

  const sessionMppx =
    environment.secretKey &&
    environment.session.ready &&
    environment.session.escrowContract &&
    environment.recipientAddress &&
    environment.settlementAccount &&
    walletClient
      ? createSessionMppx({
          environment,
          publicClient,
          recipient: environment.recipientAddress,
          store,
          walletClient,
        })
      : undefined;

  return {
    chargeRuntimes,
    config: createDemoConfig(environment),
    sessionMppx,
    sessionStore: createSessionChannelStore(asSingleProcessSessionStore(store)),
  };
}

function createHashChargeMppx(parameters: {
  environment: DemoEnvironment;
  publicClient: PublicClient;
  recipient: `0x${string}`;
  store: Store.Store;
}) {
  return Mppx.create({
    chainId: parameters.environment.chain.id,
    currency: parameters.environment.tokenAddress,
    permit2Address: parameters.environment.permit2Address,
    publicClient: parameters.publicClient,
    recipient: parameters.recipient,
    rpcUrls: {
      [parameters.environment.chain.id]: parameters.environment.rpcUrl,
    },
    methods: [
      megaethMethod.charge({
        feePayer: false,
        store: parameters.store,
      }),
    ],
    realm: new URL(parameters.environment.apiOrigin).host,
    secretKey: parameters.environment.secretKey!,
  });
}

function createPermit2ChargeMppx(parameters: {
  environment: DemoEnvironment;
  publicClient: PublicClient;
  recipient: `0x${string}`;
  store: Store.Store;
  walletClient: WalletClient;
}) {
  return Mppx.create({
    account: parameters.environment.settlementAccount!,
    chainId: parameters.environment.chain.id,
    currency: parameters.environment.tokenAddress,
    feePayer: parameters.environment.feePayer,
    permit2Address: parameters.environment.permit2Address,
    publicClient: parameters.publicClient,
    recipient: parameters.recipient,
    rpcUrls: {
      [parameters.environment.chain.id]: parameters.environment.rpcUrl,
    },
    submissionMode: parameters.environment.submissionMode,
    walletClient: parameters.walletClient,
    methods: [
      megaethMethod.charge({
        store: parameters.store,
      }),
    ],
    realm: new URL(parameters.environment.apiOrigin).host,
    secretKey: parameters.environment.secretKey!,
  });
}

function createSessionMppx(parameters: {
  environment: DemoEnvironment;
  publicClient: PublicClient;
  recipient: `0x${string}`;
  store: Store.Store;
  walletClient: WalletClient;
}) {
  return Mppx.create({
    account: parameters.environment.settlementAccount!,
    chainId: parameters.environment.chain.id,
    currency: parameters.environment.tokenAddress,
    publicClient: parameters.publicClient,
    recipient: parameters.recipient,
    rpcUrls: {
      [parameters.environment.chain.id]: parameters.environment.rpcUrl,
    },
    walletClient: parameters.walletClient,
    methods: [
      megaethMethod.session({
        escrowContract: parameters.environment.session.escrowContract!,
        settlement: {
          close: { enabled: parameters.environment.session.closeEnabled },
          periodic: {
            intervalSeconds:
              parameters.environment.session.settlementIntervalSeconds,
            minUnsettledAmount:
              parameters.environment.session.settlementMinUnsettledAmount,
          },
        },
        store: parameters.store,
        suggestedDeposit: parameters.environment.session.suggestedDeposit,
        unitType: "request",
        verifier: {
          allowDelegatedSigner:
            parameters.environment.session.allowDelegatedSigner,
          minVoucherDelta: parameters.environment.session.minVoucherDelta,
        },
      }),
    ],
    realm: new URL(parameters.environment.apiOrigin).host,
    secretKey: parameters.environment.secretKey!,
  });
}
