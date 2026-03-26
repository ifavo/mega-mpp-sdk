export type SubmissionMode = "sync" | "realtime" | "sendAndWait";

export const submissionModes = [
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
  const variableName = parameters.variableName ?? "submission mode";
  if (!value) {
    if (parameters.defaultMode) {
      return parameters.defaultMode;
    }

    throw new Error(
      `Set ${variableName} to sync, realtime, or sendAndWait before retrying.`,
    );
  }

  if (isSubmissionMode(value)) {
    return value;
  }

  throw new Error(
    `Set ${variableName} to sync, realtime, or sendAndWait before retrying.`,
  );
}

export function formatSubmissionModeLabel(mode: SubmissionMode): string {
  if (mode === "realtime") {
    return "Realtime";
  }

  if (mode === "sendAndWait") {
    return "Send + Wait";
  }

  return "Sync";
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

  return "MegaETH sync submission requires eth_sendRawTransactionSync to return a receipt immediately.";
}
