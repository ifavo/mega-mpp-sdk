import { getSessionChannelKey } from "../../../../typescript/packages/mpp/src/index.js";

import type { DemoSessionState } from "../../../shared/types.js";
import type { DemoEnvironment } from "../config.js";
import type { DemoRuntimeSet } from "./runtime.js";

export async function readDemoSessionState(parameters: {
  channelId: `0x${string}`;
  environment: DemoEnvironment;
  runtimeSet: DemoRuntimeSet;
}): Promise<DemoSessionState | null> {
  if (!parameters.environment.session.escrowContract) {
    return null;
  }

  const state = await parameters.runtimeSet.sessionStore.getChannel(
    getSessionChannelKey({
      chainId: parameters.environment.chain.id,
      channelId: parameters.channelId,
      escrowContract: parameters.environment.session.escrowContract,
    }),
  );
  if (!state) {
    return null;
  }

  return {
    acceptedCumulative: state.acceptedCumulative,
    ...(state.authorizedSigner
      ? { authorizedSigner: state.authorizedSigner }
      : {}),
    channelId: state.channelId,
    ...(state.closeRequestedAt
      ? { closeRequestedAt: state.closeRequestedAt }
      : {}),
    deposit: state.deposit,
    ...(state.lastSettlementAt
      ? { lastSettlementAt: state.lastSettlementAt }
      : {}),
    payer: state.payer,
    recipient: state.recipient,
    settled: state.settled,
    signerMode: state.authorizedSigner ? "delegated" : "wallet",
    status: state.status,
    unsettled: (
      BigInt(state.acceptedCumulative) - BigInt(state.settled)
    ).toString(),
  };
}
