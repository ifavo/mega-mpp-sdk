import type { DemoEndpoint, DemoMode } from "./types.js";

export const PLAYGROUND_TITLE = "MPP Playground";
export const PLAYGROUND_HTML_TITLE = PLAYGROUND_TITLE;

export const demoModeLabels: Record<DemoMode, string> = {
  hash: "Payer submits Permit2 transaction",
  permit2: "Server submits Permit2 transaction",
};

export const demoEndpoints: DemoEndpoint[] = [
  {
    amount: "100000",
    description: "Direct charge resource",
    id: "basic",
    kind: "charge",
    path: "/api/v1/charge/basic",
  },
  {
    amount: "250000",
    description: "Split charge resource",
    id: "splits",
    kind: "charge",
    path: "/api/v1/charge/splits",
  },
  {
    amount: "100000",
    description: "Reusable session resource",
    id: "session",
    kind: "session",
    path: "/api/v1/session/basic",
  },
] as const;

export const demoDescriptions = {
  chargeBasic: "MegaETH direct charge resource",
  chargeSplits: "MegaETH split charge resource",
  session: "MegaETH reusable session resource",
  sessionLabel: "Reusable session vouchers with escrow settlement",
} as const;

export const demoDraftCaveats = [
  "Direct settlement signs the recipient as the spender because the draft spec does not yet expose a dedicated spender field.",
  'Split payments use ordered Permit2 "authorizations[]" and settle sequentially. Hash mode stays disabled for split charges because PR 205 still lacks a multi-hash split flow.',
] as const;
