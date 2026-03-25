import type { DemoSubmissionMode } from "./types.js";

export function formatSubmissionModeLabel(mode: DemoSubmissionMode): string {
  if (mode === "realtime") {
    return "Realtime";
  }

  if (mode === "sendAndWait") {
    return "Send + Wait";
  }

  if (mode === "sync") {
    return "Sync";
  }

  return "Auto";
}

export function describeSubmissionMode(mode: DemoSubmissionMode): string {
  if (mode === "realtime") {
    return "The demo uses MegaETH realtime submission so receipts can resolve from mini blocks without extra polling when the signer supports raw transaction signing.";
  }

  if (mode === "sync") {
    return "The demo requires eth_sendRawTransactionSync, so the configured RPC must return a receipt immediately.";
  }

  if (mode === "sendAndWait") {
    return "The demo uses standard transaction submission and waits for the receipt by transaction hash.";
  }

  return "The demo tries MegaETH-specific submission methods first and only downgrades when the wallet or RPC reports that the current method is unsupported.";
}
