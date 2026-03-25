import { describeSubmissionMode } from "../../../../typescript/packages/mpp/src/utils/submissionMode.js";

import type {
  DemoConfigResponse,
  DemoEndpointKind,
  DemoHealthResponse,
  ModeStatus,
} from "../types.js";
import { formatTokenValue, getSessionNotes } from "./helpers.js";
import { Fact, NoteGroup, Panel, shortHex } from "./shared.js";

export function EnvironmentPanel(properties: {
  config: DemoConfigResponse;
  endpointKind: DemoEndpointKind;
  health: DemoHealthResponse;
  selectedMode: ModeStatus;
}) {
  return (
    <Panel title="Environment">
      {properties.endpointKind === "charge" ? (
        <>
          <div className="facts-stack">
            <Fact label="Token Address" value={shortHex(properties.config.tokenAddress)} />
            <Fact
              label="Recipient"
              value={
                properties.selectedMode.recipient
                  ? shortHex(properties.selectedMode.recipient)
                  : properties.config.recipient
                    ? shortHex(properties.config.recipient)
                    : "configure recipient address"
              }
            />
            <Fact
              label="Transaction sender"
              value={
                properties.selectedMode.transactionSender === "server"
                  ? "server wallet"
                  : "payer wallet"
              }
            />
            <Fact
              label="Gas payer"
              value={
                properties.selectedMode.feePayer
                  ? "server wallet"
                  : "payer wallet"
              }
            />
          </div>
          <p className="panel-copy">
            {describeSubmissionMode(properties.config.submissionMode)}
          </p>
          <NoteGroup
            emptyMessage="The selected flow has no setup blockers."
            items={properties.selectedMode.blockers}
            title="Flow blockers"
          />
          <NoteGroup
            emptyMessage="The current server did not publish additional spec notes."
            items={properties.config.draftCaveats}
            title="Spec notes"
          />
        </>
      ) : (
        <>
          <div className="facts-stack">
            <Fact
              label="Escrow"
              value={
                properties.config.session.escrowContract
                  ? shortHex(properties.config.session.escrowContract)
                  : "configure escrow contract"
              }
            />
            <Fact
              label="Recipient"
              value={
                properties.config.recipient
                  ? shortHex(properties.config.recipient)
                  : "configure recipient address"
              }
            />
            <Fact
              label="Suggested Deposit"
              value={formatTokenValue(
                properties.config.session.suggestedDeposit,
                properties.config,
              )}
            />
            <Fact
              label="Delegated Signer"
              value={
                properties.config.session.allowDelegatedSigner
                  ? "supported"
                  : "disabled"
              }
            />
          </div>
          <NoteGroup
            emptyMessage="The current server has no session setup blockers."
            items={properties.config.session.blockers}
            title="Session blockers"
          />
          <NoteGroup
            emptyMessage="The session constraints are already reflected in the current setup."
            items={getSessionNotes(properties.config)}
            title="Session notes"
          />
        </>
      )}
      <NoteGroup
        emptyMessage="The server is configured and ready."
        items={properties.health.warnings}
        title="Server notes"
      />
    </Panel>
  );
}
