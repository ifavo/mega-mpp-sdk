import type {
  ChargeProgress,
  DemoConfigResponse,
  DemoEndpointKind,
  DemoSessionState,
  SessionProgress,
} from "../types.js";
import {
  formatTokenValue,
  getProgressDetail,
  getSessionStateNotes,
} from "./helpers.js";
import { CodeBlock, Fact, NoteGroup, Panel, Status, shortHex } from "./shared.js";

export function ResultsSection(properties: {
  activeProgress: ChargeProgress | SessionProgress;
  activeResponse: unknown;
  config: DemoConfigResponse;
  endpointKind: DemoEndpointKind;
  lastReceipt: string | null;
  sessionState: DemoSessionState | null;
}) {
  return (
    <section className="grid">
      <Panel title="Progress">
        <Status value={properties.activeProgress.type} />
        <p className="panel-copy">
          {getProgressDetail(properties.activeProgress, properties.endpointKind)}
        </p>
        {properties.lastReceipt ? <CodeBlock code={properties.lastReceipt} /> : null}
      </Panel>

      <Panel title={properties.endpointKind === "charge" ? "Resource" : "Response"}>
        {properties.activeResponse ? (
          <CodeBlock code={JSON.stringify(properties.activeResponse, null, 2)} />
        ) : (
          <p className="panel-copy">
            {properties.endpointKind === "charge"
              ? "Run the charge flow to inspect the resource payload."
              : "Run the session flow to inspect the most recent response."}
          </p>
        )}
      </Panel>

      {properties.endpointKind === "session" ? (
        <Panel title="Session Channel">
          {properties.sessionState ? (
            <>
              <div className="facts-stack">
                <Fact label="Status" value={properties.sessionState.status} />
                <Fact
                  label="Channel ID"
                  value={shortHex(properties.sessionState.channelId)}
                />
                <Fact
                  label="Signer Mode"
                  value={properties.sessionState.signerMode}
                />
                <Fact
                  label="Deposit"
                  value={formatTokenValue(
                    properties.sessionState.deposit,
                    properties.config,
                  )}
                />
                <Fact
                  label="Accepted"
                  value={formatTokenValue(
                    properties.sessionState.acceptedCumulative,
                    properties.config,
                  )}
                />
                <Fact
                  label="Settled"
                  value={formatTokenValue(
                    properties.sessionState.settled,
                    properties.config,
                  )}
                />
                <Fact
                  label="Unsettled"
                  value={formatTokenValue(
                    properties.sessionState.unsettled,
                    properties.config,
                  )}
                />
              </div>
              <NoteGroup
                emptyMessage="This channel does not have extra timing markers yet."
                items={getSessionStateNotes(properties.sessionState)}
                title="Channel notes"
              />
            </>
          ) : (
            <p className="panel-copy">
              Run the reusable session resource once to create a channel and
              inspect its current deposit, voucher total, and settlement state.
            </p>
          )}
        </Panel>
      ) : null}
    </section>
  );
}
