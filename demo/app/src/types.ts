export type {
  DemoConfig,
  DemoConfigResponse,
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
