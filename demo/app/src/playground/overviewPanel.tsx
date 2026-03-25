import { formatSubmissionModeLabel } from "../../../../typescript/packages/mpp/src/utils/submissionMode.js";

import type { DemoConfigResponse, DemoEndpointKind } from "../types.js";
import { Fact } from "./shared.js";

export function OverviewPanel(properties: {
  config: DemoConfigResponse;
  endpointKind: DemoEndpointKind;
  selectedStatus: string;
}) {
  return (
    <section className="overview-panel">
      <div className="overview-copy">
        <p className="eyebrow">
          {properties.config.testnet ? "MegaETH testnet" : "MegaETH mainnet"}
        </p>
        <h2>Run charge and session flows against the MegaETH server.</h2>
        <p className="lede">
          Connect a wallet, choose a flow, inspect the receipt, and review the
          current session channel state when a reusable channel is active.
        </p>
      </div>
      <div className="facts-grid">
        <Fact
          label="Selected Method"
          value={properties.endpointKind === "charge" ? "Charge" : "Session"}
        />
        <Fact
          label="Chain"
          value={`${properties.config.chainId}${properties.config.testnet ? " testnet" : ""}`}
        />
        <Fact
          label="Submission"
          value={formatSubmissionModeLabel(properties.config.submissionMode)}
        />
        <Fact label="Token" value={properties.config.tokenSymbol} />
        <Fact label="Status" value={properties.selectedStatus} />
      </div>
    </section>
  );
}
