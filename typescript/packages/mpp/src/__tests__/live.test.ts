import { Challenge, Credential, Store } from "mppx";
import {
  createPublicClient,
  createWalletClient,
  http,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readContract } from "viem/actions";
import { describe, expect, it } from "vitest";

import { ERC20_ABI } from "../abi.js";
import * as SharedMethods from "../Methods.js";
import {
  DEFAULT_USDM,
  PERMIT2_ADDRESS,
  megaeth,
  megaethTestnet,
} from "../constants.js";
import { charge as clientCharge } from "../client/Charge.js";
import { charge as serverCharge } from "../server/Charge.js";
import { type SubmissionMode } from "../utils/rpc.js";

type ChargeChallenge = Challenge.Challenge<
  SharedMethods.ChargeRequest,
  typeof SharedMethods.charge.intent,
  typeof SharedMethods.charge.name
>;

type ChargeCredential = Credential.Credential<
  SharedMethods.ChargeCredentialPayload,
  ChargeChallenge
>;

const shouldRunLive = process.env.RUN_MEGAETH_LIVE === "true";
const testnet = process.env.MEGAETH_TESTNET !== "false";
const chain = testnet ? megaethTestnet : megaeth;
const rpcUrl = process.env.MEGAETH_RPC_URL ?? chain.rpcUrls.default.http[0]!;
const permit2Address = (process.env.MEGAETH_PERMIT2_ADDRESS ??
  PERMIT2_ADDRESS) as Address;
const tokenAddress = (process.env.MEGAETH_TOKEN_ADDRESS ??
  DEFAULT_USDM.address) as Address;
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});
const fundedPayerKey = process.env.MEGAETH_LIVE_PAYER_PRIVATE_KEY as
  | Hex
  | undefined;
const fundedRecipient = process.env.MEGAETH_LIVE_RECIPIENT as
  | Address
  | undefined;
const fundedAmount = process.env.MEGAETH_LIVE_AMOUNT ?? "1";
const fundedConfigured = Boolean(fundedPayerKey && fundedRecipient);
const submissionMode = resolveSubmissionMode(
  process.env.MEGAETH_SUBMISSION_MODE,
);

describe.skipIf(!shouldRunLive)("megaeth live smoke tests", () => {
  describe("readonly checks", () => {
    it("reaches the configured MegaETH RPC", async () => {
      const [chainId, blockNumber] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getBlockNumber(),
      ]);

      expect(chainId).toBe(chain.id);
      expect(blockNumber >= 0n).toBe(true);
    });

    it("verifies that Permit2 and the configured token are deployed", async () => {
      const [permit2Code, tokenCode] = await Promise.all([
        publicClient.getBytecode({ address: permit2Address }),
        publicClient.getBytecode({ address: tokenAddress }),
      ]);

      expect(hasBytecode(permit2Code)).toBe(true);
      expect(hasBytecode(tokenCode)).toBe(true);
    });

    it("reads balance and allowance from the configured token contract", async () => {
      const [balance, allowance] = await Promise.all([
        readContract(publicClient, {
          abi: ERC20_ABI,
          address: tokenAddress,
          functionName: "balanceOf",
          args: [zeroAddress],
        }),
        readContract(publicClient, {
          abi: ERC20_ABI,
          address: tokenAddress,
          functionName: "allowance",
          args: [zeroAddress, permit2Address],
        }),
      ]);

      expect(typeof balance).toBe("bigint");
      expect(typeof allowance).toBe("bigint");
    });

    it("accepts an explicit live submission mode configuration", () => {
      expect(submissionMode).toMatch(/^(auto|sync|realtime|sendAndWait)$/);
    });
  });

  describe.skipIf(!fundedConfigured)("funded e2e checks", () => {
    it("settles a live transaction-hash credential flow end to end when funded credentials are configured", async () => {
      if (!fundedPayerKey || !fundedRecipient) {
        throw new Error(
          "Set MEGAETH_LIVE_PAYER_PRIVATE_KEY and MEGAETH_LIVE_RECIPIENT before running the funded MegaETH live suite.",
        );
      }

      const payer = privateKeyToAccount(fundedPayerKey);
      if (payer.address === fundedRecipient) {
        throw new Error(
          "Use a MEGAETH_LIVE_RECIPIENT address that differs from the funded payer before running the live e2e payment.",
        );
      }

      const walletClient = createWalletClient({
        account: payer,
        chain,
        transport: http(rpcUrl),
      });
      const store = Store.memory();
      const clientMethod = clientCharge({
        account: payer,
        credentialMode: "hash",
        publicClient,
        submissionMode,
        walletClient,
      });
      const serverMethod = serverCharge({
        chainId: chain.id,
        currency: tokenAddress,
        permit2Address,
        publicClient,
        recipient: fundedRecipient,
        store,
        testnet,
      });
      const amount = BigInt(fundedAmount);
      const beforeBalance = await readContract(publicClient, {
        abi: ERC20_ABI,
        address: tokenAddress,
        functionName: "balanceOf",
        args: [fundedRecipient],
      });

      const request = await serverMethod.request?.({
        credential: undefined,
        request: {
          amount: amount.toString(),
          currency: tokenAddress,
          methodDetails: {
            chainId: chain.id,
            ...(testnet ? { testnet: true } : {}),
            permit2Address,
          },
          recipient: fundedRecipient,
        },
      });

      if (!request) {
        throw new Error(
          "Create a live MegaETH charge request successfully before running the funded live suite.",
        );
      }

      const challenge = Challenge.fromMethod(SharedMethods.charge, {
        expires: new Date(Date.now() + 300_000).toISOString(),
        realm: "live.megaeth.local",
        request,
        secretKey: "megaeth-live-smoke-secret",
      }) as ChargeChallenge;
      const credential =
        Credential.deserialize<SharedMethods.ChargeCredentialPayload>(
          await clientMethod.createCredential({ challenge }),
        ) as ChargeCredential;
      const receipt = await serverMethod.verify({
        credential,
        request: challenge.request,
      });
      const afterBalance = await readContract(publicClient, {
        abi: ERC20_ABI,
        address: tokenAddress,
        functionName: "balanceOf",
        args: [fundedRecipient],
      });

      expect(credential.payload.type).toBe("hash");
      expect(receipt.reference).toBe(
        (credential.payload as SharedMethods.ChargeHashPayload).hash,
      );
      expect(afterBalance - beforeBalance).toBe(amount);
    });
  });
});

function hasBytecode(code: Hex | undefined): boolean {
  return Boolean(code && code !== "0x");
}

function resolveSubmissionMode(value: string | undefined): SubmissionMode {
  if (!value) {
    return "auto";
  }

  if (
    value === "auto" ||
    value === "sync" ||
    value === "realtime" ||
    value === "sendAndWait"
  ) {
    return value;
  }

  throw new Error(
    "Set MEGAETH_SUBMISSION_MODE to auto, sync, realtime, or sendAndWait before running the live suite.",
  );
}
