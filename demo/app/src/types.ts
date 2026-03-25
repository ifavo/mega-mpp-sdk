import type { DemoSessionState } from "../../shared/types.js";

export type {
  DemoConfig,
  DemoConfigResponse,
  DemoEndpoint,
  DemoEndpointKind,
  DemoSessionResourceResponse,
  DemoSessionState,
  DemoHealthResponse,
  DemoMode,
  DemoSubmissionMode,
  ModeStatus,
} from "../../shared/types.js";

export type ChargeProgress =
  | {
      type: "idle";
    }
  | {
      detail?: string;
      type:
        | "challenge"
        | "signing"
        | "signed"
        | "paying"
        | "confirming"
        | "paid"
        | "error";
    };

export type ChargeResult = {
  receipt: string | null;
  resource: unknown;
};

export type SessionProgress =
  | {
      type: "idle";
    }
  | {
      detail?: string;
      type:
        | "challenge"
        | "opening"
        | "opened"
        | "updating"
        | "updated"
        | "toppingUp"
        | "toppedUp"
        | "closing"
        | "closed"
        | "error";
    };

export type SessionResult = {
  receipt: string | null;
  resource: unknown;
  session: DemoSessionState | null;
};
