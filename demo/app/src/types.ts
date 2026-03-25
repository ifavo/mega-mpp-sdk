import type { Address } from "viem";

export type DemoMode = "permit2" | "hash";

export type ModeStatus = {
  blockers: string[];
  feePayer: boolean;
  label: string;
  ready: boolean;
  recipient?: Address | undefined;
  transactionSender: "client" | "server";
};

export type DemoConfig = {
  apiOrigin: string;
  canSettle: boolean;
  chainId: number;
  draftCaveats?: string[];
  endpoints?: Array<{
    amount: string;
    description: string;
    id: "basic" | "splits";
    path: string;
  }>;
  feePayer: boolean;
  modes: Record<DemoMode, ModeStatus>;
  permit2Address: Address;
  recipient?: Address | undefined;
  rpcUrl: string;
  splitAmount: string;
  splitRecipient?: Address | undefined;
  status?: string;
  testnet: boolean;
  tokenAddress: Address;
  tokenDecimals: number;
  tokenSymbol: string;
  warnings?: string[];
};

export type ChargeProgress =
  | {
      type: "idle";
    }
  | {
      detail?: string;
      type:
        | "challenge"
        | "signing"
        | "signed"
        | "paying"
        | "confirming"
        | "paid"
        | "error";
    };

export type ChargeResult = {
  receipt: string | null;
  resource: unknown;
};
