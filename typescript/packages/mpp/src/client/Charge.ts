import { Credential, Method } from "mppx";
import type { Account, Address, Hex } from "viem";

import * as Methods from "../Methods.js";
import {
  resolveAccount,
  resolveChargeChainId,
  resolvePublicClient,
  resolveWalletClient,
  type WalletClientResolver,
} from "../utils/clients.js";
import {
  createPermitPayload,
  encodePermit2Calldata,
  getPermit2Address,
  buildTypedData,
} from "../utils/permit2.js";
import { submitTransaction } from "../utils/rpc.js";
import { createDidPkhSource } from "../utils/source.js";
import {
  defaultChargeSubmissionMode,
  parseSubmissionMode,
  type SubmissionMode,
} from "../utils/submissionMode.js";

export function charge(
  parameters: charge.Parameters,
): Method.Client<typeof Methods.charge> {
  const {
    account,
    credentialMode = "permit2",
    onProgress,
    submissionMode,
  } = parameters;

  return Method.toClient(Methods.charge, {
    async createCredential({ challenge }) {
      const chainId = resolveChargeChainId(challenge.request.methodDetails);
      const walletClient = await resolveWalletClient(parameters, chainId);
      const signer = resolveAccount(walletClient, account);
      const permit2Address = getPermit2Address(challenge.request);
      const returnsTransactionHashCredential = credentialMode === "hash";
      const hasSplits = Boolean(challenge.request.methodDetails.splits?.length);

      if (
        returnsTransactionHashCredential &&
        challenge.request.methodDetails.feePayer
      ) {
        throw new Error(
          'Use credentialMode "permit2" for this challenge because the server asked to sponsor gas. Retry after switching away from the transaction-hash credential flow.',
        );
      }
      if (returnsTransactionHashCredential && hasSplits) {
        throw new Error(
          'Use credentialMode "permit2" for split payments because PR 205 does not define a split transaction-hash credential flow.',
        );
      }

      const deadline = BigInt(
        challenge.expires
          ? Math.floor(new Date(challenge.expires).getTime() / 1000)
          : Math.floor(Date.now() / 1000) + 300,
      );
      const nonce = BigInt(
        `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      );

      onProgress?.({
        amount: challenge.request.amount,
        chainId,
        currency: challenge.request.currency as Address,
        recipient: challenge.request.recipient as Address,
        type: "challenge",
      });

      const unsignedPayload = createPermitPayload({
        deadline,
        nonce,
        request: challenge.request,
      });

      const spender = (
        returnsTransactionHashCredential
          ? signer.address
          : challenge.request.recipient
      ) as Address;
      onProgress?.({ type: "signing" });
      const payload: Methods.ChargePermit2Payload = {
        type: "permit2",
        authorizations: await Promise.all(
          unsignedPayload.authorizations.map(async (authorization) => {
            const typedData = buildTypedData({
              authorization,
              chainId,
              permit2Address,
              spender,
            });
            const signature = await walletClient.signTypedData({
              account: signer,
              domain: typedData.domain,
              message: typedData.message,
              primaryType: typedData.primaryType,
              types: typedData.types,
            });

            return {
              ...authorization,
              signature,
            };
          }),
        ),
      };

      if (credentialMode === "permit2") {
        onProgress?.({ type: "signed" });
        onProgress?.({ type: "paying" });
        onProgress?.({ type: "confirming" });
        onProgress?.({ type: "paid" });
        return Credential.serialize({
          challenge,
          payload,
          source: createDidPkhSource(chainId, signer.address),
        });
      }

      const resolvedSubmissionMode = requireSubmissionMode(
        submissionMode,
        "submissionMode for the client-broadcast charge flow",
      );
      const publicClient = await resolvePublicClient(parameters, chainId);
      const calldata = encodePermit2Calldata({
        authorization: payload.authorizations[0]!,
        owner: signer.address,
      });

      onProgress?.({ type: "paying" });
      onProgress?.({ type: "confirming" });
      const receipt = await submitTransaction({
        account: signer,
        chainId,
        data: calldata,
        publicClient,
        submissionMode: resolvedSubmissionMode,
        to: permit2Address,
        walletClient,
      });

      onProgress?.({ transactionHash: receipt.transactionHash, type: "paid" });
      return Credential.serialize({
        challenge,
        payload: {
          type: "hash",
          hash: receipt.transactionHash,
        },
        source: createDidPkhSource(chainId, signer.address),
      });
    },
  });
}

export declare namespace charge {
  type Progress =
    | {
        amount: string;
        chainId: number;
        currency: Address;
        recipient: Address;
        type: "challenge";
      }
    | {
        type: "signing";
      }
    | {
        type: "signed";
      }
    | {
        type: "paying";
      }
    | {
        type: "confirming";
      }
    | {
        transactionHash?: Hex | undefined;
        type: "paid";
      };

  type Parameters = WalletClientResolver & {
    account?: Account | Address | undefined;
    credentialMode?: "permit2" | "hash" | undefined;
    onProgress?: ((progress: Progress) => void) | undefined;
    submissionMode?: SubmissionMode | undefined;
  };
}

function requireSubmissionMode(
  submissionMode: SubmissionMode | undefined,
  variableName: string,
): SubmissionMode {
  return parseSubmissionMode(submissionMode, {
    defaultMode: defaultChargeSubmissionMode,
    variableName,
  });
}
