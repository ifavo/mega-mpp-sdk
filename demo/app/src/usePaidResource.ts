import { useMutation } from "@tanstack/react-query";
import {
  Mppx,
  megaeth,
} from "../../../typescript/packages/mpp/src/client/index.js";
import { type Address } from "viem";

import { formatChargeCost } from "./cost.js";
import { createDemoClients } from "./demoClients.js";
import type { ChargeProgress, ChargeResult, DemoConfig } from "./types.js";

export function usePaidResourceRequest(parameters: {
  onProgress: (progress: ChargeProgress) => void;
  onReceipt: (receipt: string | null) => void;
}) {
  return useMutation({
    mutationFn: async (resourceRequest: {
      account: Address;
      credentialMode: "permit2" | "hash";
      config: DemoConfig;
      endpoint: string;
    }): Promise<ChargeResult> => {
      const { publicClient, walletClient } = createDemoClients({
        account: resourceRequest.account,
        config: resourceRequest.config,
      });

      const mppx = Mppx.create({
        methods: [
          megaeth.charge(
            createDemoChargeMethodParameters({
              account: resourceRequest.account,
              config: resourceRequest.config,
              credentialMode: resourceRequest.credentialMode,
              onProgress: parameters.onProgress,
              publicClient,
              walletClient,
            }),
          ),
        ],
        polyfill: false,
      });

      const response = await mppx.fetch(
        `${resourceRequest.config.apiOrigin}${resourceRequest.endpoint}`,
      );
      const receipt = response.headers.get("payment-receipt");
      parameters.onReceipt(receipt);
      return {
        receipt,
        resource: await response.json(),
      };
    },
    onMutate() {
      parameters.onProgress({ type: "idle" });
      parameters.onReceipt(null);
    },
    onError(error) {
      parameters.onProgress({
        detail:
          error instanceof Error
            ? error.message
            : "Retry after resolving the paid-request error.",
        type: "error",
      });
    },
  });
}

export function createDemoChargeMethodParameters(parameters: {
  account: Address;
  config: DemoConfig;
  credentialMode: "permit2" | "hash";
  onProgress: (progress: ChargeProgress) => void;
  publicClient: Parameters<typeof megaeth.charge>[0]["publicClient"];
  walletClient: Parameters<typeof megaeth.charge>[0]["walletClient"];
}): Parameters<typeof megaeth.charge>[0] {
  return {
    account: parameters.account,
    credentialMode: parameters.credentialMode,
    onProgress(progress) {
      parameters.onProgress(
        toProgressState(progress, parameters.config, parameters.credentialMode),
      );
    },
    publicClient: parameters.publicClient,
    rpcUrls: {
      [parameters.config.chainId]: parameters.config.rpcUrl,
    },
    submissionMode: parameters.config.submissionMode,
    walletClient: parameters.walletClient,
  };
}

export function toProgressState(
  progress:
    | {
        amount: string;
        type: "challenge";
      }
    | {
        transactionHash?: `0x${string}` | undefined;
        type: "paid";
      }
    | {
        type: "confirming" | "paying" | "signed" | "signing";
      },
  config: DemoConfig,
  credentialMode: "permit2" | "hash",
): ChargeProgress {
  if (progress.type === "challenge") {
    const formattedAmount = formatChargeCost({
      amount: progress.amount,
      decimals: config.tokenDecimals,
      symbol: config.tokenSymbol,
    });
    return {
      detail: `Payment challenge received for ${formattedAmount.formatted}.`,
      type: "challenge",
    };
  }

  if (progress.type === "confirming") {
    return {
      detail:
        credentialMode === "hash"
          ? config.submissionMode === "realtime"
            ? "Waiting for the Permit2 transaction to land in a MegaETH mini block before the demo server verifies the transaction-hash credential."
            : "Waiting for the Permit2 transaction to confirm on MegaETH before the demo server verifies the transaction-hash credential."
          : config.submissionMode === "realtime"
            ? "Waiting for the demo server to verify the signed Permit2 credential and broadcast the settlement transaction through MegaETH realtime submission."
            : "Waiting for the demo server to verify the signed Permit2 credential and broadcast the settlement transaction.",
      type: "confirming",
    };
  }

  if (progress.type === "paid") {
    return {
      detail: progress.transactionHash
        ? config.submissionMode === "realtime"
          ? `Permit2 transaction ${progress.transactionHash} confirmed through MegaETH mini-block execution.`
          : `Permit2 transaction ${progress.transactionHash} confirmed on MegaETH.`
        : "Signed Permit2 credential returned to the demo server for verification. Inspect the receipt header below after the paid resource is released.",
      type: "paid",
    };
  }

  if (progress.type === "signed") {
    return {
      detail:
        credentialMode === "hash"
          ? "Permit2 payload signed and ready for client broadcast."
          : "Permit2 credential signed and ready for server verification.",
      type: "signed",
    };
  }

  if (progress.type === "paying") {
    return {
      detail:
        credentialMode === "hash"
          ? "Broadcasting the Permit2 transaction from the payer wallet now."
          : "Returning the signed Permit2 credential to the demo server now.",
      type: "paying",
    };
  }

  return { type: progress.type };
}
