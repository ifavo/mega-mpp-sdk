import {
  demoDraftCaveats,
  demoEndpoints,
} from "../../../shared/descriptors.js";
import type {
  DemoConfigResponse,
  DemoHealthResponse,
} from "../../../shared/types.js";
import {
  getWarnings,
  resolveDemoStatus,
  type DemoEnvironment,
} from "../config.js";

export function createHealthResponse(parameters: {
  config: Omit<DemoHealthResponse, "status" | "warnings">;
  environment: DemoEnvironment;
}): DemoHealthResponse {
  return {
    ...parameters.config,
    status: resolveDemoStatus(parameters.environment.modeStatuses),
    warnings: getWarnings({
      modeStatuses: parameters.environment.modeStatuses,
      session: parameters.environment.session,
      submissionMode: parameters.environment.submissionMode,
      splitRecipient: parameters.environment.splitRecipient,
    }),
  };
}

export function createConfigResponse(parameters: {
  config: Omit<DemoConfigResponse, "draftCaveats" | "endpoints">;
}): DemoConfigResponse {
  return {
    ...parameters.config,
    draftCaveats: [...demoDraftCaveats],
    endpoints: demoEndpoints.map((endpoint) => ({ ...endpoint })),
  };
}
