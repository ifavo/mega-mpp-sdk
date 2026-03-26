import { Credential } from "mppx";

import { demoDescriptions } from "../../../shared/descriptors.js";
import type {
  DemoMode,
  DemoPaidResourceResponse,
  DemoSessionResourceResponse,
} from "../../../shared/types.js";
import { resolveMode, type DemoEnvironment } from "../config.js";
import type { DemoRuntimeSet } from "./runtime.js";
import { readDemoSessionState } from "./sessionState.js";

type PaidRequestParameters = {
  amount: string;
  description: string;
  externalId: string;
  splits?:
    | Array<{
        amount: string;
        memo?: string;
        recipient: `0x${string}`;
      }>
    | undefined;
};

export async function handleChargeRequest(parameters: {
  environment: DemoEnvironment;
  request: Request;
  runtimeSet: DemoRuntimeSet;
  paidRequest: PaidRequestParameters;
}): Promise<Response> {
  const url = new URL(parameters.request.url);
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

  const runtime = getChargeRuntime(parameters.runtimeSet, mode);
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
    amount: parameters.paidRequest.amount,
    currency: parameters.environment.tokenAddress,
    description: parameters.paidRequest.description,
    externalId: parameters.paidRequest.externalId,
    methodDetails: {
      ...(runtime.feePayer ? { feePayer: true } : {}),
      ...(parameters.paidRequest.splits?.length
        ? { splits: parameters.paidRequest.splits }
        : {}),
    },
    recipient: runtime.recipient,
  })(parameters.request);

  if (result.status === 402) {
    return result.challenge;
  }

  return result.withReceipt(
    Response.json({
      amount: parameters.paidRequest.amount,
      description: parameters.paidRequest.description,
      feePayer: runtime.feePayer,
      mode,
      recipient: runtime.recipient,
      splitCount: parameters.paidRequest.splits?.length ?? 0,
      status: "paid",
      tokenAddress: parameters.environment.tokenAddress,
    } satisfies DemoPaidResourceResponse),
  );
}

export async function handleSessionRequest(parameters: {
  environment: DemoEnvironment;
  request: Request;
  runtimeSet: DemoRuntimeSet;
}): Promise<Response> {
  const { environment, request, runtimeSet } = parameters;
  if (!runtimeSet.sessionMppx || !environment.recipientAddress) {
    return Response.json(
      {
        detail: environment.session.blockers.join(" "),
        status: 503,
        title: "Session Demo Not Configured",
      },
      { status: 503 },
    );
  }

  const result = await runtimeSet.sessionMppx.megaeth.session({
    amount: environment.session.endpoint.amount,
    currency: environment.tokenAddress,
    description: demoDescriptions.session,
    externalId: "demo-session",
    recipient: environment.recipientAddress,
    suggestedDeposit: environment.session.suggestedDeposit,
    unitType: "request",
    methodDetails: {
      ...(environment.session.minVoucherDelta
        ? { minVoucherDelta: environment.session.minVoucherDelta }
        : {}),
      escrowContract: environment.session.escrowContract!,
    },
  })(request);

  if (result.status === 402) {
    return result.challenge;
  }

  const credential = Credential.fromRequest<{
    action: "close" | "open" | "topUp" | "voucher";
    channelId: `0x${string}`;
    cumulativeAmount?: string | undefined;
    signature?: `0x${string}` | undefined;
  }>(request);
  if (
    credential.payload.action === "close" ||
    (credential.payload.action === "topUp" &&
      (!credential.payload.cumulativeAmount || !credential.payload.signature))
  ) {
    return result.withReceipt();
  }

  const state = await readDemoSessionState({
    channelId: credential.payload.channelId,
    environment,
    runtimeSet,
  });
  if (!state) {
    return Response.json(
      {
        detail:
          "Retry after the demo server records the verified session state. The channel was accepted, but the durable session store is not readable yet.",
        status: 500,
        title: "Session State Unavailable",
      },
      { status: 500 },
    );
  }

  return result.withReceipt(
    Response.json({
      amount: environment.session.endpoint.amount,
      description: demoDescriptions.session,
      method: "session",
      session: state,
      status: "paid",
      tokenAddress: environment.tokenAddress,
    } satisfies DemoSessionResourceResponse),
  );
}

export async function handleSessionStateRequest(parameters: {
  channelId: string | null;
  environment: DemoEnvironment;
  runtimeSet: DemoRuntimeSet;
}): Promise<Response> {
  if (!parameters.channelId || !parameters.environment.session.escrowContract) {
    return Response.json(
      {
        detail:
          "Provide a session channelId query parameter before retrying the session state request.",
        status: 400,
        title: "Session State Request Invalid",
      },
      { status: 400 },
    );
  }

  const state = await readDemoSessionState({
    channelId: parameters.channelId as `0x${string}`,
    environment: parameters.environment,
    runtimeSet: parameters.runtimeSet,
  });
  if (!state) {
    return Response.json(
      {
        detail:
          "Open a session channel before retrying. The demo server could not find that channel in its durable session store.",
        status: 404,
        title: "Session State Not Found",
      },
      { status: 404 },
    );
  }

  return Response.json(state);
}

function getChargeRuntime(runtimeSet: DemoRuntimeSet, mode: DemoMode) {
  return runtimeSet.chargeRuntimes[mode];
}
