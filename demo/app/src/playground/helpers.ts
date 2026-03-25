import { formatChargeCost } from "../cost.js";
import type {
  ChargeProgress,
  DemoConfigResponse,
  DemoEndpointKind,
  DemoHealthResponse,
  DemoMode,
  DemoSessionState,
  SessionProgress,
} from "../types.js";

export function getReadyModeCopy(mode: DemoMode): string {
  if (mode === "hash") {
    return "The payer wallet is ready to submit the Permit2 transaction and return a transaction-hash credential.";
  }

  return "The server wallet is ready to verify the signed Permit2 credential and submit the settlement transaction.";
}

export function getBlockedModeCopy(mode: DemoMode): string {
  if (mode === "hash") {
    return "Complete the payer-submitted transaction setup before retrying this flow.";
  }

  return "Complete the server-submitted transaction setup before retrying this flow.";
}

export function getSelectedStatus(parameters: {
  config: DemoConfigResponse;
  credentialMode: DemoMode;
  endpointKind: DemoEndpointKind;
  health: DemoHealthResponse;
}): string {
  if (parameters.endpointKind === "session") {
    return parameters.config.session.ready ? "ready" : "setup required";
  }

  return parameters.config.modes[parameters.credentialMode].ready
    ? parameters.health.status
    : "setup required";
}

export function getPrimaryActionLabel(parameters: {
  endpointKind: DemoEndpointKind;
  isPending: boolean;
}): string {
  if (parameters.endpointKind === "session") {
    return parameters.isPending ? "Processing Session Flow" : "Run Session Flow";
  }

  return parameters.isPending ? "Processing Charge Flow" : "Run Charge Flow";
}

export function getProgressDetail(
  progress: ChargeProgress | SessionProgress,
  endpointKind: DemoEndpointKind,
): string {
  if ("detail" in progress && progress.detail) {
    return progress.detail;
  }

  return endpointKind === "session"
    ? "Progress appears here while the challenge is issued, the session channel is opened or updated, and the voucher is verified."
    : "Progress appears here while the challenge is issued, signed, submitted, and verified.";
}

export function getSessionNotes(config: DemoConfigResponse): string[] {
  return [
    `The payer wallet opens and tops up the session escrow with ${config.tokenSymbol}.`,
    "The server wallet pays gas for periodic settle and cooperative close transactions.",
    `The minimum voucher delta is ${formatTokenValue(config.session.minVoucherDelta, config)}.`,
    `Periodic settlement runs when unsettled value reaches ${formatTokenValue(config.session.settlementMinUnsettledAmount, config)} or ${config.session.settlementIntervalSeconds} seconds elapse.`,
  ];
}

export function getSessionStateNotes(state: DemoSessionState): string[] {
  const items = [`Payer: ${state.payer}`, `Recipient: ${state.recipient}`];

  if (state.authorizedSigner) {
    items.push(`Authorized signer: ${state.authorizedSigner}`);
  }

  if (state.lastSettlementAt) {
    items.push(`Last settlement: ${state.lastSettlementAt}`);
  }

  if (state.closeRequestedAt) {
    items.push(`Close requested: ${state.closeRequestedAt}`);
  }

  return items;
}

export function formatTokenValue(
  amount: string,
  config: DemoConfigResponse,
): string {
  return formatChargeCost({
    amount,
    decimals: config.tokenDecimals,
    symbol: config.tokenSymbol,
  }).formatted;
}

export function setProgressForKind(
  endpointKind: DemoEndpointKind,
  detail: string,
  setters: {
    setChargeProgress: (progress: ChargeProgress) => void;
    setSessionProgress: (progress: SessionProgress) => void;
  },
): void {
  if (endpointKind === "session") {
    setters.setSessionProgress({ detail, type: "error" });
    return;
  }

  setters.setChargeProgress({ detail, type: "error" });
}
