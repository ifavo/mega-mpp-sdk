import {
  DEFAULT_USDM,
  PERMIT2_ADDRESS,
  TESTNET_USDC,
  megaeth as megaethChain,
  megaethTestnet,
} from "../../../typescript/packages/mpp/src/constants.js";
import type {
  DemoAddress,
  DemoConfig,
  DemoHealthStatus,
  DemoMode,
  ModeStatus,
} from "../../shared/types.js";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type DemoEnvironmentBindings = {
  DEMO_PUBLIC_ORIGIN?: string | undefined;
  MEGAETH_FEE_PAYER?: string | undefined;
  MEGAETH_PERMIT2_ADDRESS?: DemoAddress | undefined;
  MEGAETH_RECIPIENT_ADDRESS?: DemoAddress | undefined;
  MEGAETH_RPC_URL?: string | undefined;
  MEGAETH_SETTLEMENT_PRIVATE_KEY?: DemoAddress | undefined;
  MEGAETH_SPLIT_AMOUNT?: string | undefined;
  MEGAETH_SPLIT_RECIPIENT?: DemoAddress | undefined;
  MEGAETH_TESTNET?: string | undefined;
  MEGAETH_TOKEN_ADDRESS?: DemoAddress | undefined;
  MEGAETH_TOKEN_DECIMALS?: string | undefined;
  MEGAETH_TOKEN_SYMBOL?: string | undefined;
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
  secretKey?: string | undefined;
  settlementAccount?: ReturnType<typeof privateKeyToAccount> | undefined;
  splitAmount: string;
  splitRecipient?: `0x${string}` | undefined;
  testnet: boolean;
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
  const testnet = bindings.MEGAETH_TESTNET !== "false";
  const chain = testnet ? megaethTestnet : megaethChain;
  const rpcUrl = bindings.MEGAETH_RPC_URL ?? chain.rpcUrls.default.http[0]!;
  const tokenAddress = (bindings.MEGAETH_TOKEN_ADDRESS ??
    DEFAULT_USDM.address) as `0x${string}`;
  const permit2Address = (bindings.MEGAETH_PERMIT2_ADDRESS ??
    PERMIT2_ADDRESS) as `0x${string}`;
  const splitRecipient = bindings.MEGAETH_SPLIT_RECIPIENT as
    | `0x${string}`
    | undefined;
  const splitAmount = bindings.MEGAETH_SPLIT_AMOUNT ?? "50000";
  const feePayer = bindings.MEGAETH_FEE_PAYER !== "false";
  const secretKey = bindings.MPP_SECRET_KEY;
  const settlementKey = bindings.MEGAETH_SETTLEMENT_PRIVATE_KEY as
    | `0x${string}`
    | undefined;
  const settlementAccount = settlementKey
    ? privateKeyToAccount(settlementKey)
    : undefined;
  const recipientAddress = (bindings.MEGAETH_RECIPIENT_ADDRESS ??
    settlementAccount?.address) as `0x${string}` | undefined;

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
    ...(secretKey ? { secretKey } : {}),
    ...(settlementAccount ? { settlementAccount } : {}),
    splitAmount,
    ...(splitRecipient ? { splitRecipient } : {}),
    testnet,
    tokenAddress,
    tokenMetadata: resolveTokenMetadata({
      configuredDecimals: bindings.MEGAETH_TOKEN_DECIMALS,
      configuredSymbol: bindings.MEGAETH_TOKEN_SYMBOL,
      testnet,
      tokenAddress,
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
    feePayer: environment.feePayer,
    modes: environment.modeStatuses,
    permit2Address: environment.permit2Address,
    ...(environment.recipientAddress
      ? { recipient: environment.recipientAddress }
      : {}),
    rpcUrl: environment.rpcUrl,
    splitAmount: environment.splitAmount,
    ...(environment.splitRecipient
      ? { splitRecipient: environment.splitRecipient }
      : {}),
    testnet: environment.testnet,
    tokenAddress: environment.tokenAddress,
    tokenDecimals: environment.tokenMetadata.decimals,
    tokenSymbol: environment.tokenMetadata.symbol,
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
    hashBlockers.push(
      "Set MEGAETH_RECIPIENT_ADDRESS or MEGAETH_SETTLEMENT_PRIVATE_KEY before retrying. Transaction-hash credential verification needs a configured recipient address.",
    );
  }

  return {
    hash: {
      blockers: hashBlockers,
      feePayer: false,
      label: "Client broadcasts Permit2 transaction",
      ready: hashBlockers.length === 0,
      ...(parameters.recipientAddress
        ? { recipient: parameters.recipientAddress }
        : {}),
      transactionSender: "client",
    },
    permit2: {
      blockers: permit2Blockers,
      feePayer: parameters.feePayer,
      label: "Server broadcasts Permit2 transaction",
      ready: permit2Blockers.length === 0,
      ...(parameters.settlementAccount
        ? { recipient: parameters.settlementAccount.address }
        : {}),
      transactionSender: "server",
    },
  };
}

export function resolveTokenMetadata(parameters: {
  configuredDecimals?: string | undefined;
  configuredSymbol?: string | undefined;
  testnet: boolean;
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
    parameters.testnet &&
    parameters.tokenAddress.toLowerCase() === TESTNET_USDC.address
  ) {
    return TESTNET_USDC;
  }

  return DEFAULT_USDM;
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
  splitRecipient?: `0x${string}` | undefined;
}): string[] {
  const warnings = Array.from(
    new Set([
      ...parameters.modeStatuses.permit2.blockers,
      ...parameters.modeStatuses.hash.blockers,
      ...(!parameters.splitRecipient
        ? [
            "Set MEGAETH_SPLIT_RECIPIENT if you want the split-payment demo route to fan out a second transfer.",
          ]
        : []),
    ]),
  );

  if (!warnings.length) {
    return [
      "The demo server is configured for both server-broadcast Permit2 requests and client-broadcast transaction-hash credentials.",
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
