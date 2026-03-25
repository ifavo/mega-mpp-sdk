export type DemoAddress = `0x${string}`;

export type DemoMode = "permit2" | "hash";

export type DemoEndpointId = "basic" | "splits";

export type DemoEndpoint = {
  amount: string;
  description: string;
  id: DemoEndpointId;
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
  feePayer: boolean;
  modes: Record<DemoMode, ModeStatus>;
  permit2Address: DemoAddress;
  recipient?: DemoAddress | undefined;
  rpcUrl: string;
  splitAmount: string;
  splitRecipient?: DemoAddress | undefined;
  testnet: boolean;
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
