import {
  DEFAULT_USDM,
  MEGAETH_TESTNET_CHAIN_ID,
  PERMIT2_ADDRESS,
  TESTNET_USDC,
  megaeth as megaethChain,
  megaethTestnet,
} from "../../../typescript/packages/mpp/src/constants.js";
import { resolveChain } from "../../../typescript/packages/mpp/src/utils/clients.js";
import {
  describeSubmissionMode,
  parseSubmissionMode,
  type SubmissionMode,
} from "../../../typescript/packages/mpp/src/utils/submissionMode.js";
import {
  demoDescriptions,
  demoModeLabels,
} from "../../shared/descriptors.js";
import type {
  DemoAddress,
  DemoConfig,
  DemoHealthStatus,
  DemoMode,
  DemoSessionConfig,
  ModeStatus,
} from "../../shared/types.js";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type DemoEnvironmentBindings = {
  DEMO_PUBLIC_ORIGIN?: string | undefined;
  MEGAETH_FEE_PAYER?: string | undefined;
  MEGAETH_CHAIN_ID?: string | undefined;
  MEGAETH_PAYMENT_TOKEN_ADDRESS?: DemoAddress | undefined;
  MEGAETH_PAYMENT_TOKEN_DECIMALS?: string | undefined;
  MEGAETH_PAYMENT_TOKEN_SYMBOL?: string | undefined;
  MEGAETH_PERMIT2_ADDRESS?: DemoAddress | undefined;
  MEGAETH_RECIPIENT_ADDRESS?: DemoAddress | undefined;
  MEGAETH_RPC_URL?: string | undefined;
  MEGAETH_SUBMISSION_MODE?: string | undefined;
  MEGAETH_SESSION_ALLOW_DELEGATED_SIGNER?: string | undefined;
  MEGAETH_SESSION_ESCROW_ADDRESS?: DemoAddress | undefined;
  MEGAETH_SESSION_MIN_VOUCHER_DELTA?: string | undefined;
  MEGAETH_SESSION_SETTLE_INTERVAL_SECONDS?: string | undefined;
  MEGAETH_SESSION_SETTLE_MIN_UNSETTLED_AMOUNT?: string | undefined;
  MEGAETH_SESSION_SUGGESTED_DEPOSIT?: string | undefined;
  MEGAETH_SETTLEMENT_PRIVATE_KEY?: DemoAddress | undefined;
  MEGAETH_SPLIT_AMOUNT?: string | undefined;
  MEGAETH_SPLIT_RECIPIENT?: DemoAddress | undefined;
  MPP_SECRET_KEY?: string | undefined;
  PORT?: string | undefined;
};

export type DemoEnvironment = {
  apiOrigin: string;
  chain: typeof megaethChain | typeof megaethTestnet;
  feePayer: boolean;
  modeStatuses: Record<DemoMode, ModeStatus>;
  permit2Address: `0x${string}`;
  recipientAddress?: `0x${string}` | undefined;
  rpcUrl: string;
  session: DemoSessionConfig;
  secretKey?: string | undefined;
  settlementAccount?: ReturnType<typeof privateKeyToAccount> | undefined;
  submissionMode: SubmissionMode;
  splitAmount: string;
  splitRecipient?: `0x${string}` | undefined;
  tokenAddress: `0x${string}`;
  tokenMetadata: {
    decimals: number;
    symbol: string;
  };
};

export type NodeDemoRuntime = {
  environment: DemoEnvironment;
  port: number;
};

export function createDemoEnvironment(parameters: {
  apiOrigin: string;
  bindings?: DemoEnvironmentBindings | undefined;
}): DemoEnvironment {
  const bindings = parameters.bindings ?? {};
  const chainId = resolveDemoChainId(bindings.MEGAETH_CHAIN_ID);
  const chain = resolveChain(chainId) as typeof megaethChain | typeof megaethTestnet;
  const rpcUrl = bindings.MEGAETH_RPC_URL ?? chain.rpcUrls.default.http[0]!;
  const paymentTokenAddress = (bindings.MEGAETH_PAYMENT_TOKEN_ADDRESS ??
    DEFAULT_USDM.address) as `0x${string}`;
  const permit2Address = (bindings.MEGAETH_PERMIT2_ADDRESS ??
    PERMIT2_ADDRESS) as `0x${string}`;
  const splitRecipient = bindings.MEGAETH_SPLIT_RECIPIENT as
    | `0x${string}`
    | undefined;
  const splitAmount = bindings.MEGAETH_SPLIT_AMOUNT ?? "50000";
  const feePayer = bindings.MEGAETH_FEE_PAYER !== "false";
  const secretKey = bindings.MPP_SECRET_KEY;
  const submissionMode = parseSubmissionMode(bindings.MEGAETH_SUBMISSION_MODE, {
    defaultMode: "realtime",
    variableName: "MEGAETH_SUBMISSION_MODE",
  });
  const sessionEscrowAddress = bindings.MEGAETH_SESSION_ESCROW_ADDRESS as
    | `0x${string}`
    | undefined;
  const sessionSuggestedDeposit =
    bindings.MEGAETH_SESSION_SUGGESTED_DEPOSIT ?? "500000";
  const sessionMinVoucherDelta =
    bindings.MEGAETH_SESSION_MIN_VOUCHER_DELTA ?? "100000";
  const sessionSettlementMinUnsettledAmount =
    bindings.MEGAETH_SESSION_SETTLE_MIN_UNSETTLED_AMOUNT ?? "200000";
  const sessionSettlementIntervalSeconds = Number(
    bindings.MEGAETH_SESSION_SETTLE_INTERVAL_SECONDS ?? 3600,
  );
  const sessionAllowDelegatedSigner =
    bindings.MEGAETH_SESSION_ALLOW_DELEGATED_SIGNER !== "false";
  const settlementKey = bindings.MEGAETH_SETTLEMENT_PRIVATE_KEY as
    | `0x${string}`
    | undefined;
  const settlementAccount = settlementKey
    ? privateKeyToAccount(settlementKey)
    : undefined;
  const recipientAddress = bindings.MEGAETH_RECIPIENT_ADDRESS as
    | `0x${string}`
    | undefined;

  return {
    apiOrigin: parameters.apiOrigin,
    chain,
    feePayer,
    modeStatuses: createModeStatuses({
      feePayer,
      recipientAddress,
      secretKey,
      settlementAccount,
    }),
    permit2Address,
    ...(recipientAddress ? { recipientAddress } : {}),
    rpcUrl,
    session: createSessionConfig({
      allowDelegatedSigner: sessionAllowDelegatedSigner,
      escrowContract: sessionEscrowAddress,
      recipientAddress,
      secretKey,
      settlementAccount,
      settlementIntervalSeconds: sessionSettlementIntervalSeconds,
      settlementMinUnsettledAmount: sessionSettlementMinUnsettledAmount,
      suggestedDeposit: sessionSuggestedDeposit,
      minVoucherDelta: sessionMinVoucherDelta,
    }),
    ...(secretKey ? { secretKey } : {}),
    ...(settlementAccount ? { settlementAccount } : {}),
    submissionMode,
    splitAmount,
    ...(splitRecipient ? { splitRecipient } : {}),
    tokenAddress: paymentTokenAddress,
    tokenMetadata: resolveTokenMetadata({
      configuredDecimals: bindings.MEGAETH_PAYMENT_TOKEN_DECIMALS,
      configuredSymbol: bindings.MEGAETH_PAYMENT_TOKEN_SYMBOL,
      chainId: chain.id,
      tokenAddress: paymentTokenAddress,
    }),
  };
}

export function loadNodeDemoEnvironment(
  bindings: DemoEnvironmentBindings = getProcessBindings(),
): NodeDemoRuntime {
  const port = Number(bindings.PORT ?? 3001);
  return {
    environment: createDemoEnvironment({
      apiOrigin: bindings.DEMO_PUBLIC_ORIGIN ?? `http://localhost:${port}`,
      bindings,
    }),
    port,
  };
}

export function loadWorkerDemoEnvironment(
  bindings: DemoEnvironmentBindings,
  request: Request,
): DemoEnvironment {
  return createDemoEnvironment({
    apiOrigin: new URL(request.url).origin,
    bindings,
  });
}

export function createDemoConfig(environment: DemoEnvironment): DemoConfig {
  return {
    apiOrigin: environment.apiOrigin,
    canSettle: environment.modeStatuses.permit2.ready,
    chainId: environment.chain.id,
    chainName: environment.chain.name,
    feePayer: environment.feePayer,
    modes: environment.modeStatuses,
    permit2Address: environment.permit2Address,
    ...(environment.recipientAddress
      ? { recipient: environment.recipientAddress }
      : {}),
    rpcUrl: environment.rpcUrl,
    session: environment.session,
    submissionMode: environment.submissionMode,
    splitAmount: environment.splitAmount,
    ...(environment.splitRecipient
      ? { splitRecipient: environment.splitRecipient }
      : {}),
    tokenAddress: environment.tokenAddress,
    tokenDecimals: environment.tokenMetadata.decimals,
    tokenSymbol: environment.tokenMetadata.symbol,
  };
}

export function createSessionConfig(parameters: {
  allowDelegatedSigner: boolean;
  escrowContract?: Address | undefined;
  minVoucherDelta: string;
  recipientAddress?: Address | undefined;
  secretKey?: string | undefined;
  settlementAccount?: { address: Address } | undefined;
  settlementIntervalSeconds: number;
  settlementMinUnsettledAmount: string;
  suggestedDeposit: string;
}): DemoSessionConfig {
  const blockers: string[] = [];

  if (!parameters.secretKey) {
    blockers.push(
      "Set MPP_SECRET_KEY before retrying. Session challenges require a stable secret key.",
    );
  }

  if (!parameters.escrowContract) {
    blockers.push(
      "Set MEGAETH_SESSION_ESCROW_ADDRESS before retrying. Session verification needs a deployed MegaETH escrow contract.",
    );
  }

  if (!parameters.settlementAccount) {
    blockers.push(
      "Set MEGAETH_SETTLEMENT_PRIVATE_KEY before retrying. Session settle and close transactions require a funded server wallet.",
    );
  }

  if (!parameters.recipientAddress) {
    blockers.push(
      "Set MEGAETH_RECIPIENT_ADDRESS before retrying. The session demo needs an explicit payee address and does not infer it from the settlement wallet.",
    );
  }

  if (
    parameters.recipientAddress &&
    parameters.settlementAccount &&
    parameters.recipientAddress.toLowerCase() !==
      parameters.settlementAccount.address.toLowerCase()
  ) {
    blockers.push(
      "Set MEGAETH_RECIPIENT_ADDRESS to the settlement wallet address, or use the settlement wallet as the recipient before retrying. Session settle and close actions must run as the configured payee.",
    );
  }

  return {
    allowDelegatedSigner: parameters.allowDelegatedSigner,
    blockers,
    closeEnabled: true,
    endpoint: {
      amount: "100000",
      description: "Reusable session resource",
      id: "session",
      kind: "session",
      path: "/api/v1/session/basic",
    },
    ...(parameters.escrowContract
      ? { escrowContract: parameters.escrowContract }
      : {}),
    label: demoDescriptions.sessionLabel,
    minVoucherDelta: parameters.minVoucherDelta,
    ready: blockers.length === 0,
    settlementIntervalSeconds: parameters.settlementIntervalSeconds,
    settlementMinUnsettledAmount: parameters.settlementMinUnsettledAmount,
    statePath: "/api/v1/session/state",
    suggestedDeposit: parameters.suggestedDeposit,
  };
}

export function createModeStatuses(parameters: {
  feePayer: boolean;
  recipientAddress?: Address | undefined;
  secretKey?: string | undefined;
  settlementAccount?: { address: Address } | undefined;
}): Record<DemoMode, ModeStatus> {
  const permit2Blockers: string[] = [];
  const hashBlockers: string[] = [];

  if (!parameters.secretKey) {
    const message =
      "Set MPP_SECRET_KEY before retrying. Challenge issuance requires a stable secret key for both demo modes.";
    permit2Blockers.push(message);
    hashBlockers.push(message);
  }

  if (!parameters.settlementAccount) {
    permit2Blockers.push(
      "Set MEGAETH_SETTLEMENT_PRIVATE_KEY before retrying. Server-broadcast Permit2 settlement requires a funded settlement wallet.",
    );
  }

  if (!parameters.recipientAddress) {
    permit2Blockers.push(
      "Set MEGAETH_RECIPIENT_ADDRESS before retrying. Server-broadcast Permit2 settlement needs an explicit payee address and does not infer it from the settlement wallet.",
    );
    hashBlockers.push(
      "Set MEGAETH_RECIPIENT_ADDRESS before retrying. Transaction-hash credential verification needs an explicit payee address.",
    );
  }

  if (
    parameters.recipientAddress &&
    parameters.settlementAccount &&
    parameters.recipientAddress.toLowerCase() !==
      parameters.settlementAccount.address.toLowerCase()
  ) {
    permit2Blockers.push(
      "Set MEGAETH_RECIPIENT_ADDRESS to the settlement wallet address before retrying. Server-broadcast Permit2 settlement currently uses the configured payee as the spender.",
    );
  }

  return {
    hash: {
      blockers: hashBlockers,
      feePayer: false,
      label: demoModeLabels.hash,
      ready: hashBlockers.length === 0,
      ...(parameters.recipientAddress
        ? { recipient: parameters.recipientAddress }
        : {}),
      transactionSender: "client",
    },
    permit2: {
      blockers: permit2Blockers,
      feePayer: parameters.feePayer,
      label: demoModeLabels.permit2,
      ready: permit2Blockers.length === 0,
      ...(parameters.recipientAddress
        ? { recipient: parameters.recipientAddress }
        : {}),
      transactionSender: "server",
    },
  };
}

export function resolveTokenMetadata(parameters: {
  configuredDecimals?: string | undefined;
  configuredSymbol?: string | undefined;
  chainId: number;
  tokenAddress: `0x${string}`;
}): {
  decimals: number;
  symbol: string;
} {
  if (parameters.configuredDecimals && parameters.configuredSymbol) {
    return {
      decimals: Number(parameters.configuredDecimals),
      symbol: parameters.configuredSymbol,
    };
  }

  if (
    parameters.chainId === MEGAETH_TESTNET_CHAIN_ID &&
    parameters.tokenAddress.toLowerCase() === TESTNET_USDC.address
  ) {
    return TESTNET_USDC;
  }

  return DEFAULT_USDM;
}

function resolveDemoChainId(value: string | undefined): number {
  if (!value) {
    throw new Error(
      "Set MEGAETH_CHAIN_ID before retrying the demo startup. Network selection is required so the demo uses the intended MegaETH RPC and contracts.",
    );
  }

  const chainId = Number(value);
  if (!Number.isInteger(chainId)) {
    throw new Error(
      "Set MEGAETH_CHAIN_ID to a numeric MegaETH chain id before retrying the demo startup.",
    );
  }

  return chainId;
}

export function resolveDemoStatus(
  modes: Record<DemoMode, ModeStatus>,
): DemoHealthStatus {
  if (modes.permit2.ready && modes.hash.ready) {
    return "ready";
  }

  if (modes.permit2.ready || modes.hash.ready) {
    return "partial-configuration";
  }

  return "configuration-required";
}

export function resolveMode(value: unknown): DemoMode | undefined {
  if (value === "permit2" || value === "hash") {
    return value;
  }

  return undefined;
}

export function getWarnings(parameters: {
  modeStatuses: Record<DemoMode, ModeStatus>;
  session: DemoSessionConfig;
  submissionMode: SubmissionMode;
  splitRecipient?: `0x${string}` | undefined;
}): string[] {
  const warnings = Array.from(
    new Set([
      ...parameters.modeStatuses.permit2.blockers,
      ...parameters.modeStatuses.hash.blockers,
      ...parameters.session.blockers,
      ...(!parameters.splitRecipient
        ? [
            "Set MEGAETH_SPLIT_RECIPIENT if you want the split-payment demo route to fan out a second transfer.",
          ]
        : []),
    ]),
  );

  if (!warnings.length) {
    return [
      `The demo server is configured for charge and session flows with ${describeSubmissionMode(parameters.submissionMode)}.`,
    ];
  }

  return warnings;
}

function getProcessBindings(): DemoEnvironmentBindings {
  const processValue = Reflect.get(globalThis, "process");
  if (typeof processValue !== "object" || processValue === null) {
    return {};
  }

  const env = Reflect.get(processValue, "env");
  if (typeof env !== "object" || env === null) {
    return {};
  }

  return env as DemoEnvironmentBindings;
}
