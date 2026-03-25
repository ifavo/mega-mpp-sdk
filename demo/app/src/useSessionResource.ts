import { useMutation } from "@tanstack/react-query";
import { Mppx, megaeth } from "../../../typescript/packages/mpp/src/client/index.js";
import { type Address } from "viem";

import { createDemoClients } from "./demoClients.js";
import type {
  DemoConfig,
  DemoSessionResourceResponse,
  SessionProgress,
  SessionResult,
} from "./types.js";
import type { EthereumProvider } from "./wallet.js";

export type SessionMutationContext = {
  action?: "close" | "open" | "topUp" | "voucher" | undefined;
  additionalDepositRaw?: string | undefined;
  authorizeCurrentRequest?: boolean | undefined;
  channelId?: `0x${string}` | undefined;
  cumulativeAmountRaw?: string | undefined;
};

export function useSessionResourceRequest(parameters: {
  onProgress: (progress: SessionProgress) => void;
  onReceipt: (receipt: string | null) => void;
  onSessionState: (
    state: DemoSessionResourceResponse["session"] | null,
  ) => void;
}) {
  return useMutation({
    mutationFn: (resourceRequest: {
      account: Address;
      config: DemoConfig;
      context?: SessionMutationContext | undefined;
      endpoint: string;
      method?: "GET" | "HEAD" | undefined;
    }) =>
      executeSessionResourceRequest({
        ...resourceRequest,
        onProgress: parameters.onProgress,
        onReceipt: parameters.onReceipt,
        onSessionState: parameters.onSessionState,
      }),
    onMutate() {
      parameters.onProgress({ type: "idle" });
      parameters.onReceipt(null);
      parameters.onSessionState(null);
    },
    onError(error) {
      parameters.onProgress(toSessionErrorProgress(error));
    },
  });
}

export async function executeSessionResourceRequest(parameters: {
  account: Address;
  config: DemoConfig;
  context?: SessionMutationContext | undefined;
  endpoint: string;
  method?: "GET" | "HEAD" | undefined;
  onProgress: (progress: SessionProgress) => void;
  onReceipt: (receipt: string | null) => void;
  onSessionState: (
    state: DemoSessionResourceResponse["session"] | null,
  ) => void;
  provider?: EthereumProvider | undefined;
}): Promise<SessionResult> {
  const { publicClient, walletClient } = createDemoClients({
    account: parameters.account,
    config: parameters.config,
    provider: parameters.provider,
  });

  let latestChannelId = parameters.context?.channelId ?? null;

  const mppx = Mppx.create({
    methods: [
      megaeth.session({
        account: parameters.account,
        deposit: parameters.config.session.suggestedDeposit,
        onProgress(progress) {
          if ("channelId" in progress && progress.channelId) {
            latestChannelId = progress.channelId;
          }
          parameters.onProgress(toSessionProgress(progress));
        },
        publicClient,
        rpcUrls: {
          [parameters.config.chainId]: parameters.config.rpcUrl,
        },
        walletClient,
      }),
    ],
    polyfill: false,
  });

  const response = await mppx.fetch(
    `${parameters.config.apiOrigin}${parameters.endpoint}`,
    {
      context: parameters.context ?? {},
      method: parameters.method ?? "GET",
    },
  );

  const receipt = response.headers.get("payment-receipt");
  parameters.onReceipt(receipt);

  let resource: unknown = null;
  let session: DemoSessionResourceResponse["session"] | null = null;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    resource = (await response.json()) as unknown;
    if (
      resource &&
      typeof resource === "object" &&
      "session" in resource &&
      resource.session
    ) {
      session = (resource as DemoSessionResourceResponse).session;
      latestChannelId = session.channelId;
    }
  }

  if (!session && latestChannelId) {
    const sessionStateResponse = await fetch(
      `${parameters.config.apiOrigin}${parameters.config.session.statePath}?channelId=${latestChannelId}`,
    );
    if (sessionStateResponse.ok) {
      session =
        (await sessionStateResponse.json()) as DemoSessionResourceResponse["session"];
    }
  }

  parameters.onSessionState(session);

  return {
    receipt,
    resource,
    session,
  };
}

export function toSessionErrorProgress(error: unknown): SessionProgress {
  return {
    detail:
      error instanceof Error
        ? error.message
        : "Retry after resolving the session request error.",
    type: "error",
  };
}

export function toSessionProgress(
  progress:
    | {
        amount: string;
        chainId: number;
        channelId?: `0x${string}` | undefined;
        currency: Address;
        recipient: Address;
        type: "challenge";
      }
    | {
        deposit: string;
        type: "opening";
      }
    | {
        channelId: `0x${string}`;
        deposit: string;
        transactionHash: `0x${string}`;
        type: "opened";
      }
    | {
        channelId: `0x${string}`;
        cumulativeAmount: string;
        type: "updating";
      }
    | {
        channelId: `0x${string}`;
        cumulativeAmount: string;
        type: "updated";
      }
    | {
        additionalDeposit: string;
        channelId: `0x${string}`;
        type: "toppingUp";
      }
    | {
        channelId: `0x${string}`;
        deposit: string;
        transactionHash: `0x${string}`;
        type: "toppedUp";
      }
    | {
        channelId: `0x${string}`;
        cumulativeAmount: string;
        type: "closing";
      }
    | {
        channelId: `0x${string}`;
        cumulativeAmount: string;
        type: "closed";
      },
): SessionProgress {
  switch (progress.type) {
    case "challenge":
      return {
        detail: "Session challenge received from the MegaETH demo server.",
        type: "challenge",
      };
    case "opening":
      return {
        detail: `Opening the session escrow channel with a deposit of ${progress.deposit} base units.`,
        type: "opening",
      };
    case "opened":
      return {
        detail: `Session channel ${progress.channelId} opened on-chain with transaction ${progress.transactionHash}.`,
        type: "opened",
      };
    case "updating":
      return {
        detail: `Signing the next cumulative session voucher for ${progress.cumulativeAmount} base units.`,
        type: "updating",
      };
    case "updated":
      return {
        detail: `Session voucher for ${progress.cumulativeAmount} base units submitted to the demo server.`,
        type: "updated",
      };
    case "toppingUp":
      return {
        detail: `Adding ${progress.additionalDeposit} base units to the existing session escrow deposit.`,
        type: "toppingUp",
      };
    case "toppedUp":
      return {
        detail: `Session channel topped up on-chain with transaction ${progress.transactionHash}.`,
        type: "toppedUp",
      };
    case "closing":
      return {
        detail: `Signing the final cooperative close voucher at ${progress.cumulativeAmount} base units.`,
        type: "closing",
      };
    case "closed":
      return {
        detail: `Session close submitted for channel ${progress.channelId}.`,
        type: "closed",
      };
  }
}
