import type { charge } from "./Charge.js";
import type { session } from "./Session.js";

const MEGAETH_SERVER_METHOD_METADATA = Symbol(
  "mega-mpp-sdk/megaeth-server-method",
);

export type MegaethServerMethodMetadata =
  | {
      intent: "charge";
      parameters: charge.Parameters;
    }
  | {
      intent: "session";
      parameters: session.Parameters;
    };

export function attachMegaethServerMethodMetadata<method>(
  method: method,
  metadata: MegaethServerMethodMetadata,
): method {
  return Object.assign(method as object, {
    [MEGAETH_SERVER_METHOD_METADATA]: metadata,
  }) as method;
}

export function getMegaethServerMethodMetadata(
  method: unknown,
): MegaethServerMethodMetadata | undefined {
  if (!method || typeof method !== "object") {
    return undefined;
  }

  return Reflect.get(method as object, MEGAETH_SERVER_METHOD_METADATA) as
    | MegaethServerMethodMetadata
    | undefined;
}
