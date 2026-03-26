import type { SubmissionMode } from "../../typescript/packages/mpp/src/utils/submissionMode.js";

export type DemoAddress = `0x${string}`;
export type DemoChannelId = `0x${string}`;

export type DemoMode = "permit2" | "hash";
export type DemoSubmissionMode = SubmissionMode;

export type DemoEndpointId = "basic" | "session" | "splits";
export type DemoEndpointKind = "charge" | "session";

export type DemoEndpoint = {
  amount: string;
  description: string;
  id: DemoEndpointId;
  kind: DemoEndpointKind;
  path: string;
};

export type ModeStatus = {
  blockers: string[];
  feePayer: boolean;
  label: string;
  ready: boolean;
  recipient?: DemoAddress | undefined;
  transactionSender: "client" | "server";
};

export type DemoConfig = {
  apiOrigin: string;
  canSettle: boolean;
  chainId: number;
  chainName: string;
  feePayer: boolean;
  modes: Record<DemoMode, ModeStatus>;
  session: DemoSessionConfig;
  permit2Address: DemoAddress;
  recipient?: DemoAddress | undefined;
  rpcUrl: string;
  submissionMode: DemoSubmissionMode;
  splitAmount: string;
  splitRecipient?: DemoAddress | undefined;
  tokenAddress: DemoAddress;
  tokenDecimals: number;
  tokenSymbol: string;
};

export type DemoHealthStatus =
  | "ready"
  | "partial-configuration"
  | "configuration-required";

export type DemoHealthResponse = DemoConfig & {
  status: DemoHealthStatus;
  warnings: string[];
};

export type DemoConfigResponse = DemoConfig & {
  draftCaveats: string[];
  endpoints: DemoEndpoint[];
};

export type DemoSessionConfig = {
  allowDelegatedSigner: boolean;
  blockers: string[];
  closeEnabled: boolean;
  endpoint: DemoEndpoint;
  escrowContract?: DemoAddress | undefined;
  label: string;
  minVoucherDelta: string;
  ready: boolean;
  settlementIntervalSeconds: number;
  settlementMinUnsettledAmount: string;
  statePath: string;
  suggestedDeposit: string;
};

export type DemoSessionState = {
  acceptedCumulative: string;
  authorizedSigner?: DemoAddress | undefined;
  channelId: DemoChannelId;
  closeRequestedAt?: string | undefined;
  deposit: string;
  lastSettlementAt?: string | undefined;
  payer: DemoAddress;
  recipient: DemoAddress;
  settled: string;
  signerMode: "delegated" | "wallet";
  status: "close_requested" | "closed" | "open";
  unsettled: string;
};

export type DemoPaidResourceResponse = {
  amount: string;
  description: string;
  feePayer: boolean;
  mode: DemoMode;
  recipient: DemoAddress;
  splitCount: number;
  status: "paid";
  tokenAddress: DemoAddress;
};

export type DemoSessionResourceResponse = {
  amount: string;
  description: string;
  method: "session";
  session: DemoSessionState;
  status: "paid";
  tokenAddress: DemoAddress;
};
