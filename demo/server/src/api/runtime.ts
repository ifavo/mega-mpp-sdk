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
  store?: Store.Store | undefined;
}): DemoRuntimeSet {
  const { environment, store = Store.memory() } = parameters;
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
        environment.secretKey && environment.recipientAddress
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
        environment.secretKey && environment.settlementAccount && walletClient
          ? createPermit2ChargeMppx({
              environment,
              publicClient,
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
    methods: [
      megaethMethod.charge({
        chainId: parameters.environment.chain.id,
        currency: parameters.environment.tokenAddress,
        feePayer: false,
        permit2Address: parameters.environment.permit2Address,
        publicClient: parameters.publicClient,
        recipient: parameters.recipient,
        rpcUrls: { [parameters.environment.chain.id]: parameters.environment.rpcUrl },
        store: parameters.store,
        testnet: parameters.environment.testnet,
      }),
    ],
    realm: new URL(parameters.environment.apiOrigin).host,
    secretKey: parameters.environment.secretKey!,
  });
}

function createPermit2ChargeMppx(parameters: {
  environment: DemoEnvironment;
  publicClient: PublicClient;
  store: Store.Store;
  walletClient: WalletClient;
}) {
  return Mppx.create({
    methods: [
      megaethMethod.charge({
        account: parameters.environment.settlementAccount!,
        chainId: parameters.environment.chain.id,
        currency: parameters.environment.tokenAddress,
        feePayer: parameters.environment.feePayer,
        permit2Address: parameters.environment.permit2Address,
        publicClient: parameters.publicClient,
        recipient: parameters.environment.settlementAccount!.address,
        rpcUrls: { [parameters.environment.chain.id]: parameters.environment.rpcUrl },
        store: parameters.store,
        submissionMode: parameters.environment.submissionMode,
        testnet: parameters.environment.testnet,
        walletClient: parameters.walletClient,
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
    methods: [
      megaethMethod.session({
        account: parameters.environment.settlementAccount!,
        chainId: parameters.environment.chain.id,
        currency: parameters.environment.tokenAddress,
        escrowContract: parameters.environment.session.escrowContract!,
        publicClient: parameters.publicClient,
        recipient: parameters.recipient,
        rpcUrls: { [parameters.environment.chain.id]: parameters.environment.rpcUrl },
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
        testnet: parameters.environment.testnet,
        unitType: "request",
        verifier: {
          allowDelegatedSigner:
            parameters.environment.session.allowDelegatedSigner,
          minVoucherDelta: parameters.environment.session.minVoucherDelta,
        },
        walletClient: parameters.walletClient,
      }),
    ],
    realm: new URL(parameters.environment.apiOrigin).host,
    secretKey: parameters.environment.secretKey!,
  });
}
