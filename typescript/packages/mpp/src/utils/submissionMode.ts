export type SubmissionMode = "auto" | "sync" | "realtime" | "sendAndWait";

export const submissionModes = [
  "auto",
  "sync",
  "realtime",
  "sendAndWait",
] as const satisfies readonly SubmissionMode[];

export function isSubmissionMode(value: unknown): value is SubmissionMode {
  return submissionModes.includes(value as SubmissionMode);
}

export function parseSubmissionMode(
  value: string | undefined,
  parameters: {
    defaultMode?: SubmissionMode | undefined;
    variableName?: string | undefined;
  } = {},
): SubmissionMode {
  if (!value) {
    return parameters.defaultMode ?? "auto";
  }

  if (isSubmissionMode(value)) {
    return value;
  }

  const variableName = parameters.variableName ?? "submission mode";
  throw new Error(
    `Set ${variableName} to auto, sync, realtime, or sendAndWait before retrying.`,
  );
}

export function formatSubmissionModeLabel(mode: SubmissionMode): string {
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

export function describeSubmissionMode(mode: SubmissionMode): string {
  if (mode === "realtime") {
    return "MegaETH realtime submission resolves receipts from mini blocks without extra polling.";
  }

  if (mode === "sync") {
    return "MegaETH sync submission requires eth_sendRawTransactionSync to return a receipt immediately.";
  }

  if (mode === "sendAndWait") {
    return "Standard transaction submission broadcasts the transaction hash and waits for the receipt.";
  }

  return "Compatibility mode tries MegaETH sync submission first, then realtime submission, then standard transaction submission when earlier methods are unsupported.";
}
