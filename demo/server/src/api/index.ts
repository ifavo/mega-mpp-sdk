import { demoDescriptions } from "../../../shared/descriptors.js";
import type { DemoEnvironment } from "../config.js";
import { createConfigResponse, createHealthResponse } from "./responses.js";
import { createDemoRuntimeSet } from "./runtime.js";
import {
  handleChargeRequest,
  handleSessionRequest,
  handleSessionStateRequest,
} from "./routes.js";
import { Store } from "../../../../typescript/packages/mpp/src/server/index.js";

type DemoApi = {
  handleRequest: (request: Request) => Promise<Response | null>;
};

export function createDemoApi(parameters: {
  environment: DemoEnvironment;
  store?: Store.Store | undefined;
}): DemoApi {
  const runtimeSet = createDemoRuntimeSet(parameters);
  const { environment } = parameters;

  return {
    async handleRequest(request) {
      const url = new URL(request.url);

      switch (url.pathname) {
        case "/api/v1/health":
          return Response.json(
            createHealthResponse({
              config: runtimeSet.config,
              environment,
            }),
          );
        case "/api/v1/config":
          return Response.json(
            createConfigResponse({
              config: runtimeSet.config,
            }),
          );
        case "/api/v1/session/basic":
          return handleSessionRequest({
            environment,
            request,
            runtimeSet,
          });
        case "/api/v1/session/state":
          return handleSessionStateRequest({
            channelId: url.searchParams.get("channelId"),
            environment,
            runtimeSet,
          });
        case "/api/v1/charge/basic":
          return handleChargeRequest({
            environment,
            paidRequest: {
              amount: "100000",
              description: demoDescriptions.chargeBasic,
              externalId: "demo-basic",
            },
            request,
            runtimeSet,
          });
        case "/api/v1/charge/splits":
          return handleChargeRequest({
            environment,
            paidRequest: {
              amount: "250000",
              description: demoDescriptions.chargeSplits,
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
            },
            request,
            runtimeSet,
          });
        default:
          return null;
      }
    },
  };
}
