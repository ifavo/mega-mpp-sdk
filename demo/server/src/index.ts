import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { Mppx, megaeth as megaethMethod } from '../../../typescript/packages/mpp/src/server/index.js';
import {
  DEFAULT_USDM,
  PERMIT2_ADDRESS,
  megaeth as megaethChain,
  megaethTestnet,
  TESTNET_USDC,
} from '../../../typescript/packages/mpp/src/constants.js';
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

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
  feePayer: boolean;
  modes: Record<DemoMode, ModeStatus>;
  permit2Address: `0x${string}`;
  recipient?: `0x${string}` | undefined;
  rpcUrl: string;
  splitAmount: string;
  splitRecipient?: `0x${string}` | undefined;
  testnet: boolean;
  tokenAddress: `0x${string}`;
  tokenDecimals: number;
  tokenSymbol: string;
};

const app = express();
app.use(express.json());
app.use(
  cors({
    exposedHeaders: ['www-authenticate', 'payment-receipt'],
  }),
);

const port = Number(process.env.PORT ?? 3001);
const testnet = process.env.MEGAETH_TESTNET !== 'false';
const chain = testnet ? megaethTestnet : megaethChain;
const rpcUrl = process.env.MEGAETH_RPC_URL ?? chain.rpcUrls.default.http[0]!;
const tokenAddress = (process.env.MEGAETH_TOKEN_ADDRESS ?? DEFAULT_USDM.address) as `0x${string}`;
const permit2Address = (process.env.MEGAETH_PERMIT2_ADDRESS ?? PERMIT2_ADDRESS) as `0x${string}`;
const tokenMetadata = resolveTokenMetadata({
  testnet,
  tokenAddress,
});
const splitRecipient = process.env.MEGAETH_SPLIT_RECIPIENT as `0x${string}` | undefined;
const splitAmount = process.env.MEGAETH_SPLIT_AMOUNT ?? '50000';
const feePayer = process.env.MEGAETH_FEE_PAYER !== 'false';
const apiOrigin = process.env.DEMO_PUBLIC_ORIGIN ?? `http://localhost:${port}`;
const secretKey = process.env.MPP_SECRET_KEY;
const settlementKey = process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY as `0x${string}` | undefined;
const settlementAccount = settlementKey ? privateKeyToAccount(settlementKey) : undefined;
const recipientAddress = (process.env.MEGAETH_RECIPIENT_ADDRESS ?? settlementAccount?.address) as
  | `0x${string}`
  | undefined;
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});
const walletClient = settlementAccount
  ? createWalletClient({
      account: settlementAccount,
      chain,
      transport: http(rpcUrl),
    })
  : undefined;
const modeStatuses = createModeStatuses();

const demoConfig: DemoConfig = {
  apiOrigin,
  canSettle: modeStatuses.permit2.ready,
  chainId: chain.id,
  feePayer,
  modes: modeStatuses,
  permit2Address,
  ...(recipientAddress ? { recipient: recipientAddress } : {}),
  rpcUrl,
  splitAmount,
  ...(splitRecipient ? { splitRecipient } : {}),
  testnet,
  tokenAddress,
  tokenDecimals: tokenMetadata.decimals,
  tokenSymbol: tokenMetadata.symbol,
};

const permit2Mppx =
  secretKey && settlementAccount && walletClient
    ? Mppx.create({
        methods: [
          megaethMethod.charge({
            account: settlementAccount,
            chainId: chain.id,
            currency: tokenAddress,
            feePayer,
            permit2Address,
            publicClient,
            recipient: settlementAccount.address,
            rpcUrls: { [chain.id]: rpcUrl },
            testnet,
            walletClient,
          }),
        ],
        realm: new URL(apiOrigin).host,
        secretKey,
      })
    : undefined;
const hashMppx =
  secretKey && recipientAddress
    ? Mppx.create({
        methods: [
          megaethMethod.charge({
            chainId: chain.id,
            currency: tokenAddress,
            feePayer: false,
            permit2Address,
            publicClient,
            recipient: recipientAddress,
            rpcUrls: { [chain.id]: rpcUrl },
            testnet,
          }),
        ],
        realm: new URL(apiOrigin).host,
        secretKey,
      })
    : undefined;

app.get('/api/v1/health', (_request: ExpressRequest, response: ExpressResponse) => {
  response.json({
    ...demoConfig,
    status: resolveDemoStatus(modeStatuses),
    warnings: getWarnings(),
  });
});

app.get('/api/v1/config', (_request: ExpressRequest, response: ExpressResponse) => {
  response.json({
    ...demoConfig,
    endpoints: [
      {
        amount: '100000',
        description: 'Direct MegaETH charge demo',
        id: 'basic',
        path: '/api/v1/charge/basic',
      },
      {
        amount: '250000',
        description: 'Charge with split settlement',
        id: 'splits',
        path: '/api/v1/charge/splits',
      },
    ],
    draftCaveats: [
      'Direct settlement signs the recipient as the spender because the draft spec does not yet expose a dedicated spender field.',
      'Split payments use the SDK batch Permit2 extension while PR 205 remains open.',
    ],
  });
});

app.get('/api/v1/charge/basic', async (request: ExpressRequest, response: ExpressResponse) => {
  await handlePaidRequest(request, response, {
    amount: '100000',
    description: 'MegaETH MPP basic charge demo',
    externalId: 'demo-basic',
  });
});

app.get('/api/v1/charge/splits', async (request: ExpressRequest, response: ExpressResponse) => {
  await handlePaidRequest(request, response, {
    amount: '250000',
    description: 'MegaETH MPP split charge demo',
    externalId: 'demo-splits',
    splits: splitRecipient
      ? [
          {
            amount: splitAmount,
            memo: 'platform fee',
            recipient: splitRecipient,
          },
        ]
      : [],
  });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDist = path.resolve(__dirname, '../../app/dist');
app.use(express.static(appDist));
app.get('*splat', (_request: ExpressRequest, response: ExpressResponse) => {
  response.sendFile(path.join(appDist, 'index.html'));
});

app.listen(port, () => {
  process.stdout.write(`mega-mpp demo server listening on ${apiOrigin}\n`);
});

async function handlePaidRequest(
  request: ExpressRequest,
  response: ExpressResponse,
  parameters: {
    amount: string;
    description: string;
    externalId: string;
    splits?: Array<{
      amount: string;
      memo?: string;
      recipient: `0x${string}`;
    }> | undefined;
  },
): Promise<void> {
  const mode = resolveMode(request.query.mode);
  if (!mode) {
    response.status(400).json({
      detail: 'Use `?mode=permit2` or `?mode=hash` before retrying the demo request.',
      status: 400,
      title: 'Demo Request Invalid',
    });
    return;
  }

  const runtime = getModeRuntime(mode);
  if (!runtime.ready || !runtime.mppx || !runtime.recipient) {
    response.status(503).json({
      detail: runtime.blockers.join(' '),
      status: 503,
      title: 'Demo Not Configured',
    });
    return;
  }

  const result = await runtime.mppx.megaeth.charge({
    amount: parameters.amount,
    currency: tokenAddress,
    description: parameters.description,
    externalId: parameters.externalId,
    methodDetails: {
      ...(runtime.feePayer ? { feePayer: true } : {}),
      ...(parameters.splits?.length ? { splits: parameters.splits } : {}),
    },
    recipient: runtime.recipient,
  })(toWebRequest(request));

  if (result.status === 402) {
    await sendWebResponse(response, result.challenge);
    return;
  }

  const webResponse = result.withReceipt(
    Response.json({
      amount: parameters.amount,
      description: parameters.description,
      feePayer: runtime.feePayer,
      mode,
      recipient: runtime.recipient,
      splitCount: parameters.splits?.length ?? 0,
      status: 'paid',
      tokenAddress,
    }),
  );

  await sendWebResponse(response, webResponse);
}

function createModeStatuses(): Record<DemoMode, ModeStatus> {
  const permit2Blockers: string[] = [];
  const hashBlockers: string[] = [];

  if (!secretKey) {
    const message =
      'Set MPP_SECRET_KEY before retrying. Challenge issuance requires a stable secret key for both demo modes.';
    permit2Blockers.push(message);
    hashBlockers.push(message);
  }

  if (!settlementAccount) {
    permit2Blockers.push(
      'Set MEGAETH_SETTLEMENT_PRIVATE_KEY before retrying. Direct Permit2 settlement requires a funded settlement wallet.',
    );
  }

  if (!recipientAddress) {
    hashBlockers.push(
      'Set MEGAETH_RECIPIENT_ADDRESS or MEGAETH_SETTLEMENT_PRIVATE_KEY before retrying. Hash-mode verification needs a configured recipient address.',
    );
  }

  return {
    hash: {
      blockers: hashBlockers,
      feePayer: false,
      label: 'Client broadcasts hash',
      ready: hashBlockers.length === 0,
      ...(recipientAddress ? { recipient: recipientAddress } : {}),
      settlement: 'client',
    },
    permit2: {
      blockers: permit2Blockers,
      feePayer,
      label: 'Server settles Permit2',
      ready: permit2Blockers.length === 0,
      ...(settlementAccount ? { recipient: settlementAccount.address } : {}),
      settlement: 'server',
    },
  };
}

function resolveTokenMetadata(parameters: {
  testnet: boolean;
  tokenAddress: `0x${string}`;
}): {
  decimals: number;
  symbol: string;
} {
  const configuredDecimals = process.env.MEGAETH_TOKEN_DECIMALS;
  const configuredSymbol = process.env.MEGAETH_TOKEN_SYMBOL;
  if (configuredDecimals && configuredSymbol) {
    return {
      decimals: Number(configuredDecimals),
      symbol: configuredSymbol,
    };
  }

  if (parameters.testnet && parameters.tokenAddress.toLowerCase() === TESTNET_USDC.address) {
    return TESTNET_USDC;
  }

  return DEFAULT_USDM;
}

function getModeRuntime(mode: DemoMode): ModeStatus & { mppx?: typeof permit2Mppx } {
  return mode === 'permit2'
    ? {
        ...modeStatuses.permit2,
        mppx: permit2Mppx,
      }
    : {
        ...modeStatuses.hash,
        mppx: hashMppx,
      };
}

function resolveDemoStatus(modes: Record<DemoMode, ModeStatus>): string {
  if (modes.permit2.ready && modes.hash.ready) {
    return 'ready';
  }

  if (modes.permit2.ready || modes.hash.ready) {
    return 'partial-configuration';
  }

  return 'configuration-required';
}

function resolveMode(value: unknown): DemoMode | undefined {
  if (value === 'permit2' || value === 'hash') {
    return value;
  }

  return undefined;
}

function getWarnings(): string[] {
  const warnings = Array.from(
    new Set([
      ...modeStatuses.permit2.blockers,
      ...modeStatuses.hash.blockers,
      ...(!splitRecipient
        ? [
            'Set MEGAETH_SPLIT_RECIPIENT if you want the split-payment demo route to fan out a second transfer.',
          ]
        : []),
    ]),
  );

  if (!warnings.length) {
    return ['The demo server is configured for both direct Permit2 and hash-mode requests.'];
  }

  return warnings;
}

function toWebRequest(request: ExpressRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  return new Request(new URL(request.originalUrl, apiOrigin).toString(), {
    headers,
    method: request.method,
  });
}

async function sendWebResponse(response: ExpressResponse, webResponse: globalThis.Response): Promise<void> {
  response.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  const body = await webResponse.text();
  response.send(body);
}
