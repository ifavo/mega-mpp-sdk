import { type Address } from "viem";

import { formatChargeCost } from "../cost.js";
import type { DemoConfigResponse, DemoEndpoint } from "../types.js";
import type { Permit2ApprovalState } from "../usePermit2Approval.js";
import { shortHex } from "./shared.js";

export function Permit2ApprovalCard(properties: {
  account: Address | null;
  approvalError: string | null;
  approvalPending: boolean;
  approvalState: Permit2ApprovalState;
  config: DemoConfigResponse;
  onEnable: () => void;
  selectedEndpoint: DemoEndpoint | null;
}) {
  if (properties.account === null || properties.selectedEndpoint === null) {
    return null;
  }

  const selectedCost = formatChargeCost({
    amount: properties.selectedEndpoint.amount,
    decimals: properties.config.tokenDecimals,
    symbol: properties.config.tokenSymbol,
  });
  const appearance = getCardAppearance(properties.approvalState);

  return (
    <div className={`callout permit2-callout ${appearance.className}`}>
      <strong>{appearance.title}</strong>
      <p>{getPermit2Detail(properties.approvalState, selectedCost.formatted)}</p>
      <p className="permit2-meta">
        Permit2 {shortHex(properties.config.permit2Address)}
      </p>
      {properties.approvalError ? (
        <p className="permit2-error">{properties.approvalError}</p>
      ) : null}
      {appearance.showAction ? (
        <button
          className="button button-secondary permit2-action"
          disabled={properties.approvalPending}
          onClick={properties.onEnable}
          type="button"
        >
          {properties.approvalPending
            ? "Waiting for Approval"
            : appearance.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function getCardAppearance(approvalState: Permit2ApprovalState): {
  actionLabel: string;
  className: string;
  showAction: boolean;
  title: string;
} {
  switch (approvalState.type) {
    case "required":
      return {
        actionLabel: "Enable Permit2",
        className: "permit2-callout-required",
        showAction: true,
        title: "Enable Permit2 Once",
      };
    case "recommended":
      return {
        actionLabel: "Enable Infinite Approval",
        className: "permit2-callout-subtle",
        showAction: true,
        title: "Permit2 Is Ready for This Charge",
      };
    case "ready":
      return {
        actionLabel: "",
        className: "permit2-callout-subtle",
        showAction: false,
        title: "Permit2 Is Enabled",
      };
    case "error":
      return {
        actionLabel: "",
        className: "permit2-callout-error",
        showAction: false,
        title: "Permit2 Check Needs Attention",
      };
    case "checking":
      return {
        actionLabel: "",
        className: "permit2-callout-subtle",
        showAction: false,
        title: "Checking Permit2",
      };
    case "idle":
      return {
        actionLabel: "",
        className: "permit2-callout-subtle",
        showAction: false,
        title: "Permit2",
      };
  }
}

function getPermit2Detail(
  approvalState: Permit2ApprovalState,
  selectedCost: string,
): string {
  switch (approvalState.type) {
    case "required":
      return `Charge uses Permit2 to transfer the payment token. Enable a one-time infinite approval so this wallet can cover ${selectedCost} and future charge runs without another token approval. You can reduce or revoke it later if you prefer.`;
    case "recommended":
      return `This wallet can already cover ${selectedCost}, but the current Permit2 approval is not infinite. Upgrade it once if you want repeat charge runs without revisiting token allowance.`;
    case "ready":
      return "This wallet already gave Permit2 an infinite token allowance, so future charge runs can reuse the same setup.";
    case "error":
      return approvalState.detail ??
        "Load the current Permit2 allowance successfully before relying on the approval prompt.";
    case "checking":
      return "The demo is checking the connected wallet's current Permit2 allowance now.";
    case "idle":
      return "Connect the wallet to inspect Permit2 approval status for charge flows.";
  }
}
