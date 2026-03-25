import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { Mppx, megaeth as megaethMethod } from '../../../typescript/packages/mpp/src/server/index.js';
import { createPublicClient, createWalletClient, http } from 'viem';

import {
  createDemoConfig,
  getWarnings,
  loadDemoEnvironment,
  resolveDemoStatus,
  resolveMode,
} from './config.js';

const app = express();
app.use(express.json());
app.use(
  cors({
    exposedHeaders: ['www-authenticate', 'payment-receipt'],
  }),
);

const environment = loadDemoEnvironment();
const publicClient = createPublicClient({
  chain: environment.chain,
  transport: http(environment.rpcUrl),
});
const walletClient = environment.settlementAccount
  ? createWalletClient({
      account: environment.settlementAccount,
      chain: environment.chain,
      transport: http(environment.rpcUrl),
    })
  : undefined;
const demoConfig = createDemoConfig(environment);

const permit2Mppx =
  environment.secretKey && environment.settlementAccount && walletClient
    ? Mppx.create({
        methods: [
          megaethMethod.charge({
            account: environment.settlementAccount,
            chainId: environment.chain.id,
            currency: environment.tokenAddress,
            feePayer: environment.feePayer,
            permit2Address: environment.permit2Address,
            publicClient,
            recipient: environment.settlementAccount.address,
            rpcUrls: { [environment.chain.id]: environment.rpcUrl },
            testnet: environment.testnet,
            walletClient,
          }),
        ],
        realm: new URL(environment.apiOrigin).host,
        secretKey: environment.secretKey,
      })
    : undefined;

const hashMppx =
  environment.secretKey && environment.recipientAddress
    ? Mppx.create({
        methods: [
          megaethMethod.charge({
            chainId: environment.chain.id,
            currency: environment.tokenAddress,
            feePayer: false,
            permit2Address: environment.permit2Address,
            publicClient,
            recipient: environment.recipientAddress,
            rpcUrls: { [environment.chain.id]: environment.rpcUrl },
            testnet: environment.testnet,
          }),
        ],
        realm: new URL(environment.apiOrigin).host,
        secretKey: environment.secretKey,
      })
    : undefined;

app.get('/api/v1/health', (_request: ExpressRequest, response: ExpressResponse) => {
  response.json({
    ...demoConfig,
    status: resolveDemoStatus(environment.modeStatuses),
    warnings: getWarnings({
      modeStatuses: environment.modeStatuses,
      splitRecipient: environment.splitRecipient,
    }),
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
    splits: environment.splitRecipient
      ? [
          {
            amount: environment.splitAmount,
            memo: 'platform fee',
            recipient: environment.splitRecipient,
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

app.listen(environment.port, () => {
  process.stdout.write(`mega-mpp demo server listening on ${environment.apiOrigin}\n`);
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
    currency: environment.tokenAddress,
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
      tokenAddress: environment.tokenAddress,
    }),
  );

  await sendWebResponse(response, webResponse);
}

function getModeRuntime(mode: 'permit2' | 'hash') {
  return mode === 'permit2'
    ? {
        ...environment.modeStatuses.permit2,
        mppx: permit2Mppx,
      }
    : {
        ...environment.modeStatuses.hash,
        mppx: hashMppx,
      };
}

function toWebRequest(request: ExpressRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  return new Request(new URL(request.originalUrl, environment.apiOrigin).toString(), {
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
