import { useMutation, useQuery } from '@tanstack/react-query';
import { Mppx, megaeth } from '../../../typescript/packages/mpp/src/client/index.js';
import { useMemo, useState, type ReactNode } from 'react';
import { formatChargeCost } from './cost.js';
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  numberToHex,
  type Address,
} from 'viem';

type DemoMode = 'permit2' | 'hash';

type ModeStatus = {
  blockers: string[];
  feePayer: boolean;
  label: string;
  ready: boolean;
  recipient?: Address | undefined;
  settlement: 'client' | 'server';
};

type DemoConfig = {
  apiOrigin: string;
  canSettle: boolean;
  chainId: number;
  draftCaveats?: string[];
  endpoints?: Array<{
    amount: string;
    description: string;
    id: 'basic' | 'splits';
    path: string;
  }>;
  feePayer: boolean;
  modes: Record<DemoMode, ModeStatus>;
  permit2Address: Address;
  recipient?: Address | undefined;
  rpcUrl: string;
  splitAmount: string;
  splitRecipient?: Address | undefined;
  status?: string;
  testnet: boolean;
  tokenAddress: Address;
  tokenDecimals: number;
  tokenSymbol: string;
  warnings?: string[];
};

type ChargeProgress =
  | {
      type: 'idle';
    }
  | {
      detail?: string;
      type: 'challenge' | 'signing' | 'signed' | 'paying' | 'confirming' | 'paid' | 'error';
    };

type ChargeResult = {
  receipt: string | null;
  resource: unknown;
};

export function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [progress, setProgress] = useState<ChargeProgress>({ type: 'idle' });
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);
  const [mode, setMode] = useState<DemoMode>('permit2');
  const [endpoint, setEndpoint] = useState<'basic' | 'splits'>('basic');

  const configQuery = useQuery({
    queryFn: async () => {
      const response = await fetch('/api/v1/config');
      if (!response.ok) {
        throw new Error('Load the demo configuration successfully before retrying.');
      }

      return (await response.json()) as DemoConfig;
    },
    queryKey: ['demo-config'],
  });

  const healthQuery = useQuery({
    queryFn: async () => {
      const response = await fetch('/api/v1/health');
      if (!response.ok) {
        throw new Error('Load the demo health status successfully before retrying.');
      }

      return (await response.json()) as DemoConfig;
    },
    queryKey: ['demo-health'],
    refetchInterval: 15_000,
  });

  const selectedEndpoint = useMemo(
    () => configQuery.data?.endpoints?.find((item) => item.id === endpoint) ?? null,
    [configQuery.data?.endpoints, endpoint],
  );

  const chargeMutation = usePaidResource({
    onProgress: setProgress,
    onReceipt: setLastReceipt,
  });

  if (configQuery.isLoading || healthQuery.isLoading) {
    return <Shell title="MPP Playground" subtitle="Loading configuration" />;
  }

  if (configQuery.isError || !configQuery.data || healthQuery.isError || !healthQuery.data) {
    return (
      <Shell
        title="MPP Playground"
        subtitle="Load the demo server successfully before retrying."
      />
    );
  }

  const config = configQuery.data;
  const health = healthQuery.data;
  const selectedMode = config.modes[mode];
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
          <p className="eyebrow">{config.testnet ? 'MegaETH testnet' : 'MegaETH mainnet'}</p>
          <h2>Run the same paid request through Permit2 or hash mode.</h2>
          <p className="lede">
            Connect a wallet, choose a flow, and inspect the live receipt and resource payload from the demo server.
          </p>
        </div>
        <div className="facts-grid">
          <Fact label="Chain" value={`${config.chainId}${config.testnet ? ' testnet' : ''}`} />
          <Fact label="Status" value={health.status ?? (config.canSettle ? 'ready' : 'setup required')} />
          <Fact label="Token" value={config.tokenSymbol} />
          <Fact label="Permit2" value={shortAddress(config.permit2Address)} />
        </div>
      </section>

      <section className="grid grid-featured">
        <Panel title="Run Payment">
          <p className="panel-copy">
            Connect the payer wallet on MegaETH, then request the paid resource with the selected settlement flow.
          </p>
          <button
            className="button button-secondary"
            onClick={() => {
              void connectWallet(config, setAccount).catch((error) => {
                setProgress({
                  detail:
                    error instanceof Error
                      ? error.message
                      : 'Connect the wallet successfully before retrying the demo.',
                  type: 'error',
                });
              });
            }}
          >
            {account ? `Connected: ${shortAddress(account)}` : 'Connect Wallet'}
          </button>
          <label className="field">
            <span>Endpoint</span>
            <select value={endpoint} onChange={(event) => setEndpoint(event.target.value as 'basic' | 'splits')}>
              {config.endpoints?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Settlement mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as 'permit2' | 'hash')}>
              <option value="permit2">Server settles Permit2</option>
              <option value="hash">Client broadcasts hash</option>
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
                ? `${selectedMode.label} is ready to issue and verify payments.`
                : `${selectedMode.label} still needs setup before the paid request can complete.`}
            </p>
          </div>
          <button
            className="button button-primary"
            disabled={!account || chargeMutation.isPending || !selectedEndpoint || !selectedMode.ready}
            onClick={() => {
              if (!account || !selectedEndpoint) return;
              void chargeMutation.mutateAsync({
                account,
                broadcast: mode === 'hash',
                config,
                endpoint: `${selectedEndpoint.path}?mode=${mode}`,
              });
            }}
          >
            {chargeMutation.isPending ? 'Processing Payment' : 'Fetch Paid Resource'}
          </button>
        </Panel>

        <Panel title="Environment">
          <div className="facts-stack">
            <Fact label="Token Address" value={shortAddress(config.tokenAddress)} />
            <Fact
              label="Recipient"
              value={
                selectedMode.recipient
                  ? shortAddress(selectedMode.recipient)
                  : config.recipient
                    ? shortAddress(config.recipient)
                    : 'configure recipient'
              }
            />
            <Fact label="Settlement" value={selectedMode.settlement === 'server' ? 'server sponsored' : 'client broadcast'} />
            <Fact label="Fee sponsor" value={selectedMode.feePayer ? 'enabled' : 'disabled'} />
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
            <CodeBlock code={JSON.stringify(chargeMutation.data.resource, null, 2)} />
          ) : (
            <p className="panel-copy">Run the charge flow to inspect the paid resource payload.</p>
          )}
        </Panel>
      </section>
    </Shell>
  );
}

function CodeBlock(properties: { code: string }) {
  return <pre className="code-block">{properties.code}</pre>;
}

async function connectWallet(config: DemoConfig, setAccount: (account: Address | null) => void): Promise<void> {
  const provider = window.ethereum;
  if (!provider) {
    setAccount(null);
    throw new Error('Install an EIP-1193 wallet before retrying the MegaETH demo.');
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: numberToHex(config.chainId) }],
    });
  } catch {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: numberToHex(config.chainId),
          chainName: config.testnet ? 'MegaETH Testnet' : 'MegaETH',
          nativeCurrency: {
            decimals: 18,
            name: 'Ether',
            symbol: 'ETH',
          },
          rpcUrls: [config.rpcUrl],
        },
      ],
    });
  }

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const nextAccount = accounts[0] as Address | undefined;
  setAccount(nextAccount ?? null);
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

function MessageList(properties: { emptyMessage: string; items?: string[] | undefined }) {
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

function NoteGroup(properties: { emptyMessage: string; items?: string[] | undefined; title: string }) {
  return (
    <section className="note-group">
      <h4>{properties.title}</h4>
      <MessageList emptyMessage={properties.emptyMessage} items={properties.items} />
    </section>
  );
}

function Shell(properties: { children?: ReactNode; subtitle: string; title: string }) {
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

function Status(properties: { value: ChargeProgress['type'] }) {
  return <div className={`status status-${properties.value}`}>{properties.value}</div>;
}

function getProgressDetail(progress: ChargeProgress): string {
  if ('detail' in progress && progress.detail) {
    return progress.detail;
  }

  return 'Progress updates appear here while the challenge is issued, signed, submitted, and verified.';
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function usePaidResource(parameters: {
  onProgress: (progress: ChargeProgress) => void;
  onReceipt: (receipt: string | null) => void;
}) {
  return useMutation({
    mutationFn: async (request: {
      account: Address;
      broadcast: boolean;
      config: DemoConfig;
      endpoint: string;
    }): Promise<ChargeResult> => {
      const provider = window.ethereum;
      if (!provider) {
        throw new Error('Install an EIP-1193 wallet before retrying the MegaETH demo.');
      }

      const chain = createDemoChain(request.config);
      const walletClient = createWalletClient({
        account: request.account,
        chain,
        transport: custom(provider),
      });
      const publicClient = createPublicClient({
        chain,
        transport: http(request.config.rpcUrl),
      });

      const mppx = Mppx.create({
        methods: [
          megaeth.charge({
            account: request.account,
            broadcast: request.broadcast,
            onProgress(progress) {
              const nextState: ChargeProgress =
                progress.type === 'challenge'
                  ? { detail: `Challenge for ${progress.amount} units received.`, type: 'challenge' }
                  : progress.type === 'confirming'
                    ? {
                        detail:
                          'Waiting for MegaETH confirmation before the demo server returns the paid resource.',
                        type: 'confirming',
                      }
                  : progress.type === 'paid'
                    ? {
                        detail: progress.signature
                          ? `Transaction ${progress.signature} confirmed.`
                          : 'Permit2 credential submitted. Inspect the receipt header below after the server verifies it.',
                        type: 'paid',
                      }
                    : progress.type === 'signed'
                      ? { detail: 'Permit2 payload signed and ready for submission.', type: 'signed' }
                      : progress.type === 'paying'
                        ? {
                            detail:
                              'Submitting the MegaETH payment flow now. The next state will confirm the transaction or credential hand-off.',
                            type: 'paying',
                          }
                        : { type: progress.type };
              parameters.onProgress(nextState);
            },
            publicClient,
            rpcUrls: { [request.config.chainId]: request.config.rpcUrl },
            walletClient,
          }),
        ],
        polyfill: false,
      });

      const response = await mppx.fetch(`${request.config.apiOrigin}${request.endpoint}`);
      const receipt = response.headers.get('payment-receipt');
      parameters.onReceipt(receipt);
      return {
        receipt,
        resource: await response.json(),
      };
    },
    onMutate() {
      parameters.onProgress({ type: 'idle' });
      parameters.onReceipt(null);
    },
    onError(error) {
      parameters.onProgress({
        detail: error instanceof Error ? error.message : 'Retry after resolving the demo payment error.',
        type: 'error',
      });
    },
  });
}

function createDemoChain(config: DemoConfig) {
  return defineChain({
    id: config.chainId,
    name: config.testnet ? 'MegaETH Testnet' : 'MegaETH',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
      },
    },
  });
}

declare global {
  interface Window {
    ethereum?: {
      request: (parameters: { method: string; params?: unknown[] | undefined }) => Promise<unknown>;
    };
  }
}
