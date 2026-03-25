import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { type Address } from "viem";

import { formatChargeCost } from "./cost.js";
import type {
  ChargeProgress,
  DemoConfigResponse,
  DemoHealthResponse,
  DemoMode,
} from "./types.js";
import { usePaidResourceRequest } from "./usePaidResource.js";
import { connectWalletForDemoChain } from "./wallet.js";

export function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [progress, setProgress] = useState<ChargeProgress>({ type: "idle" });
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);
  const [credentialMode, setCredentialMode] = useState<DemoMode>("permit2");
  const [endpoint, setEndpoint] = useState<"basic" | "splits">("basic");

  const configQuery = useQuery({
    queryFn: async () => {
      const response = await fetch("/api/v1/config");
      if (!response.ok) {
        throw new Error(
          "Load the demo configuration successfully before retrying.",
        );
      }

      return (await response.json()) as DemoConfigResponse;
    },
    queryKey: ["demo-config"],
  });

  const healthQuery = useQuery({
    queryFn: async () => {
      const response = await fetch("/api/v1/health");
      if (!response.ok) {
        throw new Error(
          "Load the demo health status successfully before retrying.",
        );
      }

      return (await response.json()) as DemoHealthResponse;
    },
    queryKey: ["demo-health"],
    refetchInterval: 15_000,
  });

  const selectedEndpoint = useMemo(
    () =>
      configQuery.data?.endpoints?.find((item) => item.id === endpoint) ?? null,
    [configQuery.data?.endpoints, endpoint],
  );

  const chargeMutation = usePaidResourceRequest({
    onProgress: setProgress,
    onReceipt: setLastReceipt,
  });

  if (configQuery.isLoading || healthQuery.isLoading) {
    return <Shell title="MPP Playground" subtitle="Loading configuration" />;
  }

  if (
    configQuery.isError ||
    !configQuery.data ||
    healthQuery.isError ||
    !healthQuery.data
  ) {
    return (
      <Shell
        title="MPP Playground"
        subtitle="Load the demo server successfully before retrying."
      />
    );
  }

  const config = configQuery.data;
  const health = healthQuery.data;
  const selectedMode = config.modes[credentialMode];
  const selectedCost = selectedEndpoint
    ? formatChargeCost({
        amount: selectedEndpoint.amount,
        decimals: config.tokenDecimals,
        symbol: config.tokenSymbol,
      })
    : null;

  return (
    <Shell title="MPP Playground" subtitle="MegaETH demo">
      <section className="overview-panel">
        <div className="overview-copy">
          <p className="eyebrow">
            {config.testnet ? "MegaETH testnet" : "MegaETH mainnet"}
          </p>
          <h2>
            Run the same paid request with server or client Permit2 broadcast.
          </h2>
          <p className="lede">
            Connect a wallet, choose who broadcasts the Permit2 transaction, and
            inspect the receipt plus resource payload from the demo server.
          </p>
        </div>
        <div className="facts-grid">
          <Fact
            label="Chain"
            value={`${config.chainId}${config.testnet ? " testnet" : ""}`}
          />
          <Fact
            label="Status"
            value={
              health.status ?? (config.canSettle ? "ready" : "setup required")
            }
          />
          <Fact label="Token" value={config.tokenSymbol} />
          <Fact label="Permit2" value={shortAddress(config.permit2Address)} />
        </div>
      </section>

      <section className="grid grid-featured">
        <Panel title="Request Paid Resource">
          <p className="panel-copy">
            Connect the payer wallet on MegaETH, then request the paid resource
            with the selected Permit2 transaction flow.
          </p>
          <button
            className="button button-secondary"
            onClick={() => {
              void connectWalletForDemoChain(config, window.ethereum)
                .then((nextAccount) => {
                  setAccount(nextAccount);
                })
                .catch((error) => {
                  setProgress({
                    detail:
                      error instanceof Error
                        ? error.message
                        : "Connect the wallet successfully before retrying the demo.",
                    type: "error",
                  });
                });
            }}
          >
            {account ? `Connected: ${shortAddress(account)}` : "Connect Wallet"}
          </button>
          <label className="field">
            <span>Endpoint</span>
            <select
              value={endpoint}
              onChange={(event) =>
                setEndpoint(event.target.value as "basic" | "splits")
              }
            >
              {config.endpoints?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Permit2 transaction flow</span>
            <select
              value={credentialMode}
              onChange={(event) =>
                setCredentialMode(event.target.value as "permit2" | "hash")
              }
            >
              <option value="permit2">
                Server broadcasts Permit2 transaction
              </option>
              <option value="hash">
                Client broadcasts Permit2 transaction
              </option>
            </select>
          </label>
          {selectedCost ? (
            <div className="cost-card">
              <span className="cost-label">Cost</span>
              <strong>{selectedCost.formatted}</strong>
              <p>{selectedCost.raw}</p>
            </div>
          ) : null}
          <div className="callout">
            <strong>{selectedMode.label}</strong>
            <p>
              {selectedMode.ready
                ? getReadyModeCopy(credentialMode)
                : getBlockedModeCopy(credentialMode)}
            </p>
          </div>
          <button
            className="button button-primary"
            disabled={
              !account ||
              chargeMutation.isPending ||
              !selectedEndpoint ||
              !selectedMode.ready
            }
            onClick={() => {
              if (!account || !selectedEndpoint) return;
              void chargeMutation.mutateAsync({
                account,
                credentialMode,
                config,
                endpoint: `${selectedEndpoint.path}?mode=${credentialMode}`,
              });
            }}
          >
            {chargeMutation.isPending
              ? "Processing Paid Request"
              : "Request Paid Resource"}
          </button>
        </Panel>

        <Panel title="Environment">
          <div className="facts-stack">
            <Fact
              label="Token Address"
              value={shortAddress(config.tokenAddress)}
            />
            <Fact
              label="Recipient"
              value={
                selectedMode.recipient
                  ? shortAddress(selectedMode.recipient)
                  : config.recipient
                    ? shortAddress(config.recipient)
                    : "configure recipient address"
              }
            />
            <Fact
              label="Transaction sender"
              value={
                selectedMode.transactionSender === "server"
                  ? "server settlement wallet"
                  : "payer wallet"
              }
            />
            <Fact
              label="Gas payer"
              value={
                selectedMode.feePayer
                  ? "server settlement wallet"
                  : "payer wallet"
              }
            />
          </div>
          <NoteGroup
            emptyMessage="The selected mode has no setup blockers."
            items={selectedMode.blockers}
            title="Mode blockers"
          />
          <NoteGroup
            emptyMessage="The demo server is configured and ready."
            items={health.warnings}
            title="Server notes"
          />
          <NoteGroup
            emptyMessage="The current server did not publish additional spec notes."
            items={config.draftCaveats}
            title="Spec notes"
          />
        </Panel>
      </section>

      <section className="grid">
        <Panel title="Progress">
          <Status value={progress.type} />
          <p className="panel-copy">{getProgressDetail(progress)}</p>
          {lastReceipt ? <CodeBlock code={lastReceipt} /> : null}
        </Panel>

        <Panel title="Resource">
          {chargeMutation.data ? (
            <CodeBlock
              code={JSON.stringify(chargeMutation.data.resource, null, 2)}
            />
          ) : (
            <p className="panel-copy">
              Run the paid request to inspect the resource payload.
            </p>
          )}
        </Panel>
      </section>
    </Shell>
  );
}

function CodeBlock(properties: { code: string }) {
  return <pre className="code-block">{properties.code}</pre>;
}

function getReadyModeCopy(mode: DemoMode): string {
  if (mode === "hash") {
    return "Client broadcast is ready to return a transaction-hash credential after the payer submits the Permit2 transaction.";
  }

  return "Server broadcast is ready to verify a signed Permit2 credential and submit the settlement transaction.";
}

function getBlockedModeCopy(mode: DemoMode): string {
  if (mode === "hash") {
    return "Client broadcast still needs setup before the demo can verify a transaction-hash credential and release the paid resource.";
  }

  return "Server broadcast still needs setup before the demo can verify the signed Permit2 credential and release the paid resource.";
}

function Fact(properties: { label: string; value: string }) {
  return (
    <dl className="fact">
      <dt>{properties.label}</dt>
      <dd>{properties.value}</dd>
    </dl>
  );
}

function Panel(properties: { children: ReactNode; title: string }) {
  return (
    <article className="panel">
      <h3>{properties.title}</h3>
      {properties.children}
    </article>
  );
}

function MessageList(properties: {
  emptyMessage: string;
  items?: string[] | undefined;
}) {
  if (!properties.items?.length) {
    return <p className="panel-copy">{properties.emptyMessage}</p>;
  }

  return (
    <ul className="list">
      {properties.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function NoteGroup(properties: {
  emptyMessage: string;
  items?: string[] | undefined;
  title: string;
}) {
  return (
    <section className="note-group">
      <h4>{properties.title}</h4>
      <MessageList
        emptyMessage={properties.emptyMessage}
        items={properties.items}
      />
    </section>
  );
}

function Shell(properties: {
  children?: ReactNode;
  subtitle: string;
  title: string;
}) {
  if (!properties.children) {
    return (
      <main className="shell">
        <header className="header">
          <p className="eyebrow">{properties.subtitle}</p>
          <h1>{properties.title}</h1>
        </header>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="header">
        <p className="eyebrow">{properties.subtitle}</p>
        <h1>{properties.title}</h1>
      </header>
      {properties.children}
    </main>
  );
}

function Status(properties: { value: ChargeProgress["type"] }) {
  return (
    <div className={`status status-${properties.value}`}>
      {properties.value}
    </div>
  );
}

function getProgressDetail(progress: ChargeProgress): string {
  if ("detail" in progress && progress.detail) {
    return progress.detail;
  }

  return "Progress updates appear here while the challenge is issued, signed, submitted, and verified.";
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
