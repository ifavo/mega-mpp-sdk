import { Mppx, Store, megaeth as megaethMethod } from "../../../typescript/packages/mpp/src/server/index.js";
import { createPublicClient, createWalletClient, http } from "viem";

import type {
  DemoConfigResponse,
  DemoEndpoint,
  DemoHealthResponse,
  DemoMode,
  DemoPaidResourceResponse,
  ModeStatus,
} from "../../shared/types.js";
import {
  createDemoConfig,
  getWarnings,
  resolveDemoStatus,
  resolveMode,
  type DemoEnvironment,
} from "./config.js";

export const DEMO_DRAFT_CAVEATS = [
  "Direct settlement signs the recipient as the spender because the draft spec does not yet expose a dedicated spender field.",
  "Split payments use the SDK batch Permit2 extension while PR 205 remains open.",
] as const;

export const DEMO_ENDPOINTS: DemoEndpoint[] = [
  {
    amount: "100000",
    description: "Direct MegaETH charge demo",
    id: "basic",
    path: "/api/v1/charge/basic",
  },
  {
    amount: "250000",
    description: "Charge with split settlement",
    id: "splits",
    path: "/api/v1/charge/splits",
  },
];

type PaidRequestParameters = {
  amount: string;
  description: string;
  externalId: string;
  splits?: Array<{
    amount: string;
    memo?: string;
    recipient: `0x${string}`;
  }> | undefined;
};

type DemoApi = {
  handleRequest: (request: Request) => Promise<Response | null>;
};

export function createDemoApi(parameters: {
  environment: DemoEnvironment;
  store?: Store.Store | undefined;
}): DemoApi {
  const { environment, store = Store.memory() } = parameters;
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
              store,
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
              store,
              testnet: environment.testnet,
            }),
          ],
          realm: new URL(environment.apiOrigin).host,
          secretKey: environment.secretKey,
        })
      : undefined;

  type DemoMppx = NonNullable<typeof permit2Mppx> | NonNullable<typeof hashMppx>;

  return {
    async handleRequest(request) {
      const url = new URL(request.url);

      switch (url.pathname) {
        case "/api/v1/health":
          return Response.json(createHealthResponse(demoConfig, environment));
        case "/api/v1/config":
          return Response.json(createConfigResponse(demoConfig));
        case "/api/v1/charge/basic":
          return handlePaidRequest(request, {
            amount: "100000",
            description: "MegaETH MPP basic charge demo",
            externalId: "demo-basic",
          });
        case "/api/v1/charge/splits":
          return handlePaidRequest(request, {
            amount: "250000",
            description: "MegaETH MPP split charge demo",
            externalId: "demo-splits",
            splits: environment.splitRecipient
              ? [
                  {
                    amount: environment.splitAmount,
                    memo: "platform fee",
                    recipient: environment.splitRecipient,
                  },
                ]
              : [],
          });
        default:
          return null;
      }
    },
  };

  async function handlePaidRequest(
    request: Request,
    paidRequest: PaidRequestParameters,
  ): Promise<Response> {
    const url = new URL(request.url);
    const mode = resolveMode(url.searchParams.get("mode"));
    if (!mode) {
      return Response.json(
        {
          detail:
            "Use `?mode=permit2` or `?mode=hash` before retrying the demo request.",
          status: 400,
          title: "Demo Request Invalid",
        },
        { status: 400 },
      );
    }

    const runtime = getModeRuntime(mode);
    if (!runtime.ready || !runtime.mppx || !runtime.recipient) {
      return Response.json(
        {
          detail: runtime.blockers.join(" "),
          status: 503,
          title: "Demo Not Configured",
        },
        { status: 503 },
      );
    }

    const result = await runtime.mppx.megaeth.charge({
      amount: paidRequest.amount,
      currency: environment.tokenAddress,
      description: paidRequest.description,
      externalId: paidRequest.externalId,
      methodDetails: {
        ...(runtime.feePayer ? { feePayer: true } : {}),
        ...(paidRequest.splits?.length ? { splits: paidRequest.splits } : {}),
      },
      recipient: runtime.recipient,
    })(request);

    if (result.status === 402) {
      return result.challenge;
    }

    return result.withReceipt(
      Response.json({
        amount: paidRequest.amount,
        description: paidRequest.description,
        feePayer: runtime.feePayer,
        mode,
        recipient: runtime.recipient,
        splitCount: paidRequest.splits?.length ?? 0,
        status: "paid",
        tokenAddress: environment.tokenAddress,
      } satisfies DemoPaidResourceResponse),
    );
  }

  function getModeRuntime(mode: DemoMode): ModeStatus & {
    mppx?: DemoMppx | undefined;
  } {
    return mode === "permit2"
      ? {
          ...environment.modeStatuses.permit2,
          mppx: permit2Mppx,
        }
      : {
          ...environment.modeStatuses.hash,
          mppx: hashMppx,
        };
  }
}

function createHealthResponse(
  demoConfig: ReturnType<typeof createDemoConfig>,
  environment: DemoEnvironment,
): DemoHealthResponse {
  return {
    ...demoConfig,
    status: resolveDemoStatus(environment.modeStatuses),
    warnings: getWarnings({
      modeStatuses: environment.modeStatuses,
      splitRecipient: environment.splitRecipient,
    }),
  };
}

function createConfigResponse(
  demoConfig: ReturnType<typeof createDemoConfig>,
): DemoConfigResponse {
  return {
    ...demoConfig,
    draftCaveats: [...DEMO_DRAFT_CAVEATS],
    endpoints: DEMO_ENDPOINTS,
  };
}
