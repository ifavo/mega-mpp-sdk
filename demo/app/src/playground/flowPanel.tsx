import { formatChargeCost } from "../cost.js";
import type {
  DemoConfigResponse,
  DemoEndpoint,
  DemoEndpointKind,
  DemoMode,
  DemoSessionState,
  ModeStatus,
} from "../types.js";
import type { Permit2ApprovalState } from "../usePermit2Approval.js";
import {
  getBlockedModeCopy,
  getPrimaryActionLabel,
  getReadyModeCopy,
} from "./helpers.js";
import { Permit2ApprovalCard } from "./permit2ApprovalCard.js";
import { Panel, ToggleButton, shortHex } from "./shared.js";

export function FlowPanel(properties: {
  account: `0x${string}` | null;
  availableEndpoints: DemoEndpoint[];
  clearReceipt: () => void;
  config: DemoConfigResponse;
  credentialMode: DemoMode;
  endpointKind: DemoEndpointKind;
  onChargeModeChange: (mode: DemoMode) => void;
  onConnectWallet: () => void;
  onEnablePermit2: () => void;
  onEndpointChange: (endpointId: string) => void;
  onKindChange: (kind: DemoEndpointKind) => void;
  onRunFlow: () => void;
  permit2ApprovalError: string | null;
  permit2ApprovalPending: boolean;
  permit2ApprovalState: Permit2ApprovalState;
  onSessionClose: () => void;
  onSessionTopUp: () => void;
  selectedEndpoint: DemoEndpoint | null;
  selectedMode: ModeStatus;
  sessionActionsDisabled: boolean;
  sessionReady: boolean;
  sessionState: DemoSessionState | null;
  isPending: boolean;
}) {
  const selectedCost = properties.selectedEndpoint
    ? formatChargeCost({
        amount: properties.selectedEndpoint.amount,
        decimals: properties.config.tokenDecimals,
        symbol: properties.config.tokenSymbol,
      })
    : null;

  return (
    <Panel title="Run Flow">
      <p className="panel-copy">
        Use the same protected route for one-shot charges or reusable session
        vouchers.
      </p>
      <div className="toggle-group" role="tablist" aria-label="Payment method">
        <ToggleButton
          active={properties.endpointKind === "charge"}
          label="Charge"
          onClick={() => {
            properties.onKindChange("charge");
            properties.clearReceipt();
          }}
        />
        <ToggleButton
          active={properties.endpointKind === "session"}
          label="Session"
          onClick={() => {
            properties.onKindChange("session");
            properties.clearReceipt();
          }}
        />
      </div>
      <button className="button button-secondary" onClick={properties.onConnectWallet}>
        {properties.account
          ? `Connected: ${shortHex(properties.account)}`
          : "Connect Wallet"}
      </button>
      <label className="field">
        <span>Endpoint</span>
        <select
          value={properties.selectedEndpoint?.id ?? ""}
          onChange={(event) => {
            properties.onEndpointChange(event.target.value);
            properties.clearReceipt();
          }}
        >
          {properties.availableEndpoints.map((item) => (
            <option key={item.id} value={item.id}>
              {item.description}
            </option>
          ))}
        </select>
      </label>
      {properties.endpointKind === "charge" ? (
        <label className="field">
          <span>Transaction sender</span>
          <select
            value={properties.credentialMode}
            onChange={(event) =>
              properties.onChargeModeChange(event.target.value as DemoMode)
            }
          >
            <option value="permit2">{properties.config.modes.permit2.label}</option>
            <option value="hash">{properties.config.modes.hash.label}</option>
          </select>
        </label>
      ) : null}
      {selectedCost ? (
        <div className="cost-card">
          <span className="cost-label">Cost</span>
          <strong>{selectedCost.formatted}</strong>
          <p>{selectedCost.raw}</p>
        </div>
      ) : null}
      {properties.endpointKind === "charge" ? (
        <div className="callout">
          <strong>{properties.selectedMode.label}</strong>
          <p>
            {properties.selectedMode.ready
              ? getReadyModeCopy(properties.credentialMode)
              : getBlockedModeCopy(properties.credentialMode)}
          </p>
        </div>
      ) : (
        <div className="callout">
          <strong>{properties.config.session.label}</strong>
          <p>
            {properties.sessionReady
              ? "The session flow is ready to open an escrow channel, accept cumulative vouchers, and settle periodically."
              : "Complete the session escrow setup shown below before retrying the session flow."}
          </p>
        </div>
      )}
      {properties.endpointKind === "charge" ? (
        <Permit2ApprovalCard
          account={properties.account}
          approvalError={properties.permit2ApprovalError}
          approvalPending={properties.permit2ApprovalPending}
          approvalState={properties.permit2ApprovalState}
          config={properties.config}
          onEnable={properties.onEnablePermit2}
          selectedEndpoint={properties.selectedEndpoint}
        />
      ) : null}
      <button
        className="button button-primary"
        disabled={
          !properties.account ||
          !properties.selectedEndpoint ||
          properties.isPending ||
          (properties.endpointKind === "charge"
            ? !properties.selectedMode.ready ||
              properties.permit2ApprovalPending ||
              properties.permit2ApprovalState.type === "checking" ||
              properties.permit2ApprovalState.type === "required"
            : !properties.sessionReady)
        }
        onClick={properties.onRunFlow}
      >
        {getPrimaryActionLabel({
          endpointKind: properties.endpointKind,
          isPending: properties.isPending,
        })}
      </button>
      {properties.endpointKind === "session" ? (
        <div className="button-row">
          <button
            className="button button-secondary"
            disabled={properties.sessionActionsDisabled}
            onClick={properties.onSessionTopUp}
          >
            Top Up
          </button>
          <button
            className="button button-secondary"
            disabled={
              properties.sessionActionsDisabled ||
              properties.sessionState?.status === "closed"
            }
            onClick={properties.onSessionClose}
          >
            Close
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
