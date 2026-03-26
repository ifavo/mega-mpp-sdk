import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { maxUint256, type Address, type Hash } from "viem";
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";

import { ERC20_ABI } from "../../../typescript/packages/mpp/src/abi.js";

import { createDemoClients } from "./demoClients.js";
import type { DemoConfig } from "./types.js";
import type { EthereumProvider } from "./wallet.js";

const USER_REJECTED_REQUEST_CODE = 4001;

export type Permit2ApprovalState =
  | {
      hasInfiniteApproval: false;
      hasRequiredAllowance: false;
      type: "checking" | "error" | "idle" | "required";
      detail?: string | undefined;
    }
  | {
      hasInfiniteApproval: false;
      hasRequiredAllowance: true;
      type: "recommended";
    }
  | {
      hasInfiniteApproval: true;
      hasRequiredAllowance: true;
      type: "ready";
    };

export function usePermit2Approval(parameters: {
  account: Address | null;
  config: DemoConfig | null;
  provider?: EthereumProvider | undefined;
  requiredAmount: bigint | null;
}) {
  const queryClient = useQueryClient();
  const { account, config, provider, requiredAmount } = parameters;
  const enabled =
    account !== null && config !== null && requiredAmount !== null;

  const approvalQuery = useQuery({
    enabled,
    queryFn: async () => {
      if (account === null || config === null) {
        throw new Error(
          "Connect the wallet before checking the Permit2 allowance.",
        );
      }

      return await readPermit2Allowance({
        account,
        config,
        provider,
      });
    },
    queryKey:
      account !== null && config !== null
        ? getPermit2ApprovalQueryKey({
            account,
            config,
          })
        : ["permit2-allowance", "idle"],
    staleTime: 15_000,
  });

  const approvalMutation = useMutation({
    mutationFn: async () => {
      if (account === null || config === null) {
        throw new Error(
          "Connect the wallet before enabling Permit2 for the charge demo.",
        );
      }

      return await approvePermit2InfiniteAllowance({
        account,
        config,
        provider,
      });
    },
    onSuccess: async () => {
      if (account === null || config === null) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: getPermit2ApprovalQueryKey({
          account,
          config,
        }),
      });
    },
  });

  const approvalState = getPermit2ApprovalState({
    account,
    allowance: approvalQuery.data,
    errorDetail:
      approvalQuery.error instanceof Error
        ? approvalQuery.error.message
        : approvalQuery.isError
          ? "Load the current Permit2 allowance successfully before relying on the approval prompt."
          : undefined,
    isLoading: approvalQuery.isPending,
    requiredAmount,
  });

  return {
    approvalMutation,
    approvalQuery,
    approvalState,
    approvalError:
      approvalMutation.error instanceof Error
        ? approvalMutation.error.message
        : approvalMutation.isError
          ? "Approve Permit2 for the payment token before retrying the charge demo."
          : null,
  };
}

export function getPermit2ApprovalState(parameters: {
  account: Address | null;
  allowance?: bigint | undefined;
  errorDetail?: string | undefined;
  isLoading: boolean;
  requiredAmount: bigint | null;
}): Permit2ApprovalState {
  const { account, allowance, errorDetail, isLoading, requiredAmount } =
    parameters;

  if (account === null || requiredAmount === null) {
    return {
      hasInfiniteApproval: false,
      hasRequiredAllowance: false,
      type: "idle",
    };
  }

  if (isLoading) {
    return {
      hasInfiniteApproval: false,
      hasRequiredAllowance: false,
      type: "checking",
    };
  }

  if (errorDetail) {
    return {
      detail: errorDetail,
      hasInfiniteApproval: false,
      hasRequiredAllowance: false,
      type: "error",
    };
  }

  const currentAllowance = allowance ?? 0n;
  if (currentAllowance < requiredAmount) {
    return {
      detail: `Approve Permit2 for at least ${requiredAmount.toString()} base units before retrying the charge demo.`,
      hasInfiniteApproval: false,
      hasRequiredAllowance: false,
      type: "required",
    };
  }

  if (currentAllowance !== maxUint256) {
    return {
      hasInfiniteApproval: false,
      hasRequiredAllowance: true,
      type: "recommended",
    };
  }

  return {
    hasInfiniteApproval: true,
    hasRequiredAllowance: true,
    type: "ready",
  };
}

export async function readPermit2Allowance(parameters: {
  account: Address;
  config: DemoConfig;
  provider?: EthereumProvider | undefined;
}): Promise<bigint> {
  const { publicClient } = createDemoClients(parameters);

  return await readContract(publicClient, {
    abi: ERC20_ABI,
    address: parameters.config.tokenAddress,
    args: [parameters.account, parameters.config.permit2Address],
    functionName: "allowance",
  });
}

export async function approvePermit2InfiniteAllowance(parameters: {
  account: Address;
  config: DemoConfig;
  provider?: EthereumProvider | undefined;
}): Promise<Hash> {
  try {
    const { publicClient, walletClient } = createDemoClients(parameters);
    const hash = await writeContract(walletClient, {
      abi: ERC20_ABI,
      account: parameters.account,
      address: parameters.config.tokenAddress,
      args: [parameters.config.permit2Address, maxUint256],
      functionName: "approve",
    });

    await waitForTransactionReceipt(publicClient, { hash });
    return hash;
  } catch (error) {
    throw new Error(getPermit2ApprovalErrorMessage(error));
  }
}

function getPermit2ApprovalQueryKey(parameters: {
  account: Address;
  config: DemoConfig;
}) {
  return [
    "permit2-allowance",
    parameters.config.chainId,
    parameters.account,
    parameters.config.tokenAddress,
    parameters.config.permit2Address,
  ] as const;
}

function getPermit2ApprovalErrorMessage(error: unknown): string {
  if (getErrorCode(error) === USER_REJECTED_REQUEST_CODE) {
    return "Approve the Permit2 token allowance in the wallet before retrying the charge demo.";
  }

  const message = getErrorMessage(error);
  if (message) {
    return `${message} Retry after approving Permit2 for the payment token.`;
  }

  return "Approve Permit2 for the payment token before retrying the charge demo.";
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const code = Reflect.get(error, "code");
  return typeof code === "number" ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}
