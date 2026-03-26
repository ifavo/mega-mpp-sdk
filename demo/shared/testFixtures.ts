import type {
  DemoConfig,
  DemoMode,
  DemoSessionConfig,
  ModeStatus,
} from "./types.js";
import type { DemoEnvironmentBindings } from "../server/src/config.js";
import { demoDescriptions, demoModeLabels } from "./descriptors.js";

export function createModeStatusFixture(
  overrides: Partial<ModeStatus> = {},
): ModeStatus {
  const mode = (overrides.transactionSender === "server"
    ? "permit2"
    : "hash") as DemoMode;

  return {
    blockers: [],
    feePayer: mode === "permit2",
    label: demoModeLabels[mode],
    ready: true,
    transactionSender: mode === "permit2" ? "server" : "client",
    ...overrides,
  };
}

export function createSessionConfigFixture(
  overrides: Partial<DemoSessionConfig> = {},
): DemoSessionConfig {
  return {
    allowDelegatedSigner: true,
    blockers: [],
    closeEnabled: true,
    endpoint: {
      amount: "100000",
      description: "Reusable session resource",
      id: "session",
      kind: "session",
      path: "/api/v1/session/basic",
    },
    escrowContract: "0x4444444444444444444444444444444444444444",
    label: demoDescriptions.sessionLabel,
    minVoucherDelta: "100000",
    ready: true,
    settlementIntervalSeconds: 3600,
    settlementMinUnsettledAmount: "200000",
    statePath: "/api/v1/session/state",
    suggestedDeposit: "500000",
    ...overrides,
  };
}

export function createDemoConfigFixture(
  overrides: Partial<DemoConfig> = {},
): DemoConfig {
  return {
    apiOrigin: "http://localhost:3001",
    canSettle: true,
    chainId: 6343,
    chainName: "MegaETH Testnet",
    feePayer: true,
    modes: {
      hash: createModeStatusFixture({
        feePayer: false,
        transactionSender: "client",
      }),
      permit2: createModeStatusFixture({
        feePayer: true,
        recipient: "0x2222222222222222222222222222222222222222",
        transactionSender: "server",
      }),
    },
    permit2Address: "0x3333333333333333333333333333333333333333",
    recipient: "0x2222222222222222222222222222222222222222",
    rpcUrl: "https://carrot.megaeth.com/rpc",
    session: createSessionConfigFixture(),
    submissionMode: "realtime",
    splitAmount: "50000",
    tokenAddress: "0x1111111111111111111111111111111111111111",
    tokenDecimals: 6,
    tokenSymbol: "USDC",
    ...overrides,
  };
}

export function createDemoBindingsFixture(
  overrides: Partial<DemoEnvironmentBindings> = {},
): DemoEnvironmentBindings {
  return {
    DEMO_PUBLIC_ORIGIN: "http://localhost:3001",
    MEGAETH_CHAIN_ID: "6343",
    MEGAETH_PAYMENT_TOKEN_ADDRESS:
      "0x75139a9559c9cd1ad69b7e239c216151d2c81e6f",
    ...overrides,
  };
}
