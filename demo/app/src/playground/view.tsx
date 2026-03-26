import { useEffect, useState } from "react";
import { type Address } from "viem";

import { PLAYGROUND_TITLE } from "../../../shared/descriptors.js";
import type {
  ChargeProgress,
  DemoEndpointKind,
  DemoMode,
  DemoSessionState,
  SessionProgress,
} from "../types.js";
import { usePermit2Approval } from "../usePermit2Approval.js";
import { usePaidResourceRequest } from "../usePaidResource.js";
import { useSessionResourceRequest } from "../useSessionResource.js";
import { connectWalletForDemoChain } from "../wallet.js";
import { getSelectedStatus, setProgressForKind } from "./helpers.js";
import { EnvironmentPanel } from "./environmentPanel.js";
import { FlowPanel } from "./flowPanel.js";
import { OverviewPanel } from "./overviewPanel.js";
import { ResultsSection } from "./resultsSection.js";
import { Shell } from "./shared.js";
import { useDemoData } from "./useDemoData.js";

export function PlaygroundView() {
  const [account, setAccount] = useState<Address | null>(null);
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [endpointKind, setEndpointKind] = useState<DemoEndpointKind>("charge");
  const [chargeProgress, setChargeProgress] = useState<ChargeProgress>({
    type: "idle",
  });
  const [sessionProgress, setSessionProgress] = useState<SessionProgress>({
    type: "idle",
  });
  const [sessionState, setSessionState] = useState<DemoSessionState | null>(
    null,
  );
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);
  const [credentialMode, setCredentialMode] = useState<DemoMode>("permit2");

  const { configQuery, healthQuery } = useDemoData();

  const chargeMutation = usePaidResourceRequest({
    onProgress: setChargeProgress,
    onReceipt: setLastReceipt,
  });
  const sessionMutation = useSessionResourceRequest({
    onProgress: setSessionProgress,
    onReceipt: setLastReceipt,
    onSessionState: setSessionState,
  });

  useEffect(() => {
    const config = configQuery.data;
    if (!config) {
      return;
    }

    const matchingEndpoints = config.endpoints.filter(
      (item) => item.kind === endpointKind,
    );
    if (!matchingEndpoints.length) {
      return;
    }

    const currentEndpoint = matchingEndpoints.find((item) => item.id === endpointId);
    if (!currentEndpoint) {
      setEndpointId(matchingEndpoints[0]!.id);
    }
  }, [configQuery.data, endpointId, endpointKind]);

  const config = configQuery.data ?? null;
  const health = healthQuery.data ?? null;
  const availableEndpoints =
    config?.endpoints.filter((item) => item.kind === endpointKind) ?? [];
  const selectedEndpoint =
    availableEndpoints.find((item) => item.id === endpointId) ?? null;
  const requiredChargeAmount =
    endpointKind === "charge" && selectedEndpoint !== null
      ? BigInt(selectedEndpoint.amount)
      : null;
  const permit2Approval = usePermit2Approval({
    account,
    config,
    requiredAmount: requiredChargeAmount,
  });

  if (configQuery.isLoading || healthQuery.isLoading) {
    return <Shell title={PLAYGROUND_TITLE} subtitle="Loading configuration" />;
  }

  if (configQuery.isError || config === null || healthQuery.isError || health === null) {
    return (
      <Shell
        title={PLAYGROUND_TITLE}
        subtitle="Load the demo server successfully before retrying."
      />
    );
  }

  const selectedMode = config.modes[credentialMode];
  const selectedStatus = getSelectedStatus({
    config,
    credentialMode,
    endpointKind,
    health,
  });
  const activeProgress =
    endpointKind === "session" ? sessionProgress : chargeProgress;
  const activeResponse =
    endpointKind === "session"
      ? sessionMutation.data?.resource ?? null
      : chargeMutation.data?.resource ?? null;
  const sessionReady = config.session.ready;
  const sessionActionsDisabled =
    !account || sessionMutation.isPending || !sessionReady || !sessionState;

  return (
    <Shell title={PLAYGROUND_TITLE} subtitle="MegaETH">
      <OverviewPanel
        config={config}
        endpointKind={endpointKind}
        selectedStatus={selectedStatus}
      />

      <section className="grid grid-featured">
        <FlowPanel
          account={account}
          availableEndpoints={availableEndpoints}
          clearReceipt={() => setLastReceipt(null)}
          config={config}
          credentialMode={credentialMode}
          endpointKind={endpointKind}
          isPending={
            endpointKind === "charge"
              ? chargeMutation.isPending
              : sessionMutation.isPending
          }
          onChargeModeChange={setCredentialMode}
          onConnectWallet={() => {
            void connectWalletForDemoChain(config, window.ethereum)
              .then((nextAccount) => {
                setAccount(nextAccount);
              })
              .catch((error) => {
                const detail =
                  error instanceof Error
                    ? error.message
                    : "Connect the wallet successfully before retrying the demo.";
                setProgressForKind(endpointKind, detail, {
                  setChargeProgress,
                  setSessionProgress,
                });
              });
          }}
          onEnablePermit2={() => {
            permit2Approval.approvalMutation.mutate();
          }}
          onEndpointChange={setEndpointId}
          onKindChange={setEndpointKind}
          onRunFlow={() => {
            if (!account || !selectedEndpoint) {
              return;
            }

            if (endpointKind === "charge") {
              void chargeMutation.mutateAsync({
                account,
                credentialMode,
                config,
                endpoint: `${selectedEndpoint.path}?mode=${credentialMode}`,
              });
              return;
            }

            void sessionMutation.mutateAsync({
              account,
              config,
              endpoint: selectedEndpoint.path,
            });
          }}
          onSessionClose={() => {
            if (!account || !selectedEndpoint || !sessionState) {
              return;
            }

            void sessionMutation.mutateAsync({
              account,
              config,
              context: {
                action: "close",
                channelId: sessionState.channelId,
              },
              endpoint: selectedEndpoint.path,
              method: "HEAD",
            });
          }}
          onSessionTopUp={() => {
            if (!account || !selectedEndpoint || !sessionState) {
              return;
            }

            void sessionMutation.mutateAsync({
              account,
              config,
              context: {
                action: "topUp",
                additionalDepositRaw: config.session.suggestedDeposit,
                authorizeCurrentRequest: false,
                channelId: sessionState.channelId,
              },
              endpoint: selectedEndpoint.path,
              method: "HEAD",
            });
          }}
          permit2ApprovalError={permit2Approval.approvalError}
          permit2ApprovalPending={permit2Approval.approvalMutation.isPending}
          permit2ApprovalState={permit2Approval.approvalState}
          selectedEndpoint={selectedEndpoint}
          selectedMode={selectedMode}
          sessionActionsDisabled={sessionActionsDisabled}
          sessionReady={sessionReady}
          sessionState={sessionState}
        />
        <EnvironmentPanel
          config={config}
          endpointKind={endpointKind}
          health={health}
          selectedMode={selectedMode}
        />
      </section>

      <ResultsSection
        activeProgress={activeProgress}
        activeResponse={activeResponse}
        config={config}
        endpointKind={endpointKind}
        lastReceipt={lastReceipt}
        sessionState={sessionState}
      />
    </Shell>
  );
}
