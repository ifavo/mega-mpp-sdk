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
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";
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
import { session as clientSession } from "../client/Session.js";
import { charge as serverCharge } from "../server/Charge.js";
import { session as serverSession } from "../server/Session.js";
import { SESSION_ESCROW_ABI } from "../session/abi.js";
import { parseSubmissionMode } from "../utils/submissionMode.js";

type ChargeChallenge = Challenge.Challenge<
  SharedMethods.ChargeRequest,
  typeof SharedMethods.charge.intent,
  typeof SharedMethods.charge.name
>;

type ChargeCredential = Credential.Credential<
  SharedMethods.ChargeCredentialPayload,
  ChargeChallenge
>;

type SessionChallenge = Challenge.Challenge<
  SharedMethods.SessionRequest,
  typeof SharedMethods.session.intent,
  typeof SharedMethods.session.name
>;

type SessionCredential = Credential.Credential<
  SharedMethods.SessionCredentialPayload,
  SessionChallenge
>;

const shouldRunLive = process.env.RUN_MEGAETH_LIVE === "true";
const configuredChainId = Number(
  process.env.MEGAETH_CHAIN_ID ?? String(megaeth.id),
);
const chain =
  configuredChainId === megaethTestnet.id ? megaethTestnet : megaeth;
const rpcUrl = process.env.MEGAETH_RPC_URL ?? chain.rpcUrls.default.http[0]!;
const permit2Address = (process.env.MEGAETH_PERMIT2_ADDRESS ??
  PERMIT2_ADDRESS) as Address;
const tokenAddress = (process.env.MEGAETH_PAYMENT_TOKEN_ADDRESS ??
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
const sessionEscrowAddress = process.env.MEGAETH_SESSION_ESCROW_ADDRESS as
  | Address
  | undefined;
const sessionPayerKey = process.env.MEGAETH_LIVE_SESSION_PAYER_PRIVATE_KEY as
  | Hex
  | undefined;
const sessionServerKey = process.env.MEGAETH_LIVE_SESSION_SERVER_PRIVATE_KEY as
  | Hex
  | undefined;
const sessionAmount = process.env.MEGAETH_LIVE_SESSION_AMOUNT ?? "100000";
const sessionDeposit =
  process.env.MEGAETH_LIVE_SESSION_DEPOSIT ??
  (BigInt(sessionAmount) * 3n).toString();
const fundedSessionConfigured = Boolean(
  sessionEscrowAddress && sessionPayerKey && sessionServerKey,
);
const submissionMode = parseSubmissionMode(
  process.env.MEGAETH_SUBMISSION_MODE,
  {
    defaultMode: "realtime",
    variableName: "MEGAETH_SUBMISSION_MODE",
  },
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

    it("verifies that Permit2 and the configured payment token are deployed", async () => {
      const [permit2Code, tokenCode] = await Promise.all([
        publicClient.getBytecode({ address: permit2Address }),
        publicClient.getBytecode({ address: tokenAddress }),
      ]);

      expect(hasBytecode(permit2Code)).toBe(true);
      expect(hasBytecode(tokenCode)).toBe(true);
    });

    it("reads balance and allowance from the configured payment token contract", async () => {
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
      expect(submissionMode).toMatch(/^(sync|realtime|sendAndWait)$/);
    });
  });

  describe.skipIf(!sessionEscrowAddress)("session readonly checks", () => {
    it("verifies that the configured session escrow contract is deployed", async () => {
      if (!sessionEscrowAddress) {
        throw new Error(
          "Set MEGAETH_SESSION_ESCROW_ADDRESS before running the MegaETH session readonly checks.",
        );
      }

      const escrowCode = await publicClient.getBytecode({
        address: sessionEscrowAddress,
      });

      expect(hasBytecode(escrowCode)).toBe(true);
    });

    it("reads the session escrow domain separator", async () => {
      if (!sessionEscrowAddress) {
        throw new Error(
          "Set MEGAETH_SESSION_ESCROW_ADDRESS before reading the session escrow domain separator.",
        );
      }

      const domainSeparator = await readContract(publicClient, {
        abi: SESSION_ESCROW_ABI,
        address: sessionEscrowAddress,
        functionName: "domainSeparator",
      });

      expect(typeof domainSeparator).toBe("string");
      expect(domainSeparator).toMatch(/^0x[0-9a-fA-F]{64}$/);
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

  describe.skipIf(!fundedSessionConfigured)("funded session e2e checks", () => {
    it("opens, updates, settles, and closes a live MegaETH session channel", async () => {
      if (!sessionEscrowAddress || !sessionPayerKey || !sessionServerKey) {
        throw new Error(
          "Set MEGAETH_SESSION_ESCROW_ADDRESS, MEGAETH_LIVE_SESSION_PAYER_PRIVATE_KEY, and MEGAETH_LIVE_SESSION_SERVER_PRIVATE_KEY before running the live session suite.",
        );
      }

      const payer = privateKeyToAccount(sessionPayerKey);
      const server = privateKeyToAccount(sessionServerKey);
      if (payer.address === server.address) {
        throw new Error(
          "Use different payer and server keys before running the funded MegaETH session suite.",
        );
      }

      const payerWallet = createWalletClient({
        account: payer,
        chain,
        transport: http(rpcUrl),
      });
      const serverWallet = createWalletClient({
        account: server,
        chain,
        transport: http(rpcUrl),
      });

      await waitForTransactionReceipt(publicClient, {
        hash: await writeContract(payerWallet, {
          abi: ERC20_ABI,
          account: payer,
          address: tokenAddress,
          chain,
          functionName: "approve",
          args: [sessionEscrowAddress, BigInt(sessionDeposit)],
        }),
      });

      const store = Store.memory();
      const clientMethod = clientSession({
        account: payer,
        deposit: sessionDeposit,
        publicClient,
        walletClient: payerWallet,
      });
      const serverMethod = serverSession({
        account: server,
        chainId: chain.id,
        currency: tokenAddress,
        escrowContract: sessionEscrowAddress,
        publicClient,
        recipient: server.address,
        rpcUrls: { [chain.id]: rpcUrl },
        settlement: {
          close: { enabled: true },
          periodic: {
            intervalSeconds: 3600,
            minUnsettledAmount: (BigInt(sessionAmount) * 2n).toString(),
          },
        },
        store,
        unitType: "request",
        walletClient: serverWallet,
      });

      const beforeBalance = await readContract(publicClient, {
        abi: ERC20_ABI,
        address: tokenAddress,
        functionName: "balanceOf",
        args: [server.address],
      });

      const openChallenge = await issueLiveSessionChallenge(serverMethod, {
        amount: sessionAmount,
        currency: tokenAddress,
        escrowContract: sessionEscrowAddress,
        recipient: server.address,
        suggestedDeposit: sessionDeposit,
      });
      const openCredential = deserializeSessionCredential(
        await clientMethod.createCredential({
          challenge: openChallenge,
          context: {},
        }),
      );
      const openReceipt = await serverMethod.verify({
        credential: openCredential,
        request: openChallenge.request,
      });
      const channelId = (
        openCredential.payload as SharedMethods.SessionOpenPayload
      ).channelId as Hex;

      const voucherChallenge = await issueLiveSessionChallenge(serverMethod, {
        amount: sessionAmount,
        currency: tokenAddress,
        escrowContract: sessionEscrowAddress,
        recipient: server.address,
      });
      const voucherCredential = deserializeSessionCredential(
        await clientMethod.createCredential({
          challenge: voucherChallenge,
          context: {},
        }),
      );
      const voucherReceipt = await serverMethod.verify({
        credential: voucherCredential,
        request: voucherChallenge.request,
      });

      const afterSettlementBalance = await readContract(publicClient, {
        abi: ERC20_ABI,
        address: tokenAddress,
        functionName: "balanceOf",
        args: [server.address],
      });

      const closeChallenge = await issueLiveSessionChallenge(serverMethod, {
        amount: sessionAmount,
        currency: tokenAddress,
        escrowContract: sessionEscrowAddress,
        recipient: server.address,
      });
      const closeCredential = deserializeSessionCredential(
        await clientMethod.createCredential({
          challenge: closeChallenge,
          context: {
            action: "close",
            channelId,
          },
        }),
      );
      await serverMethod.verify({
        credential: closeCredential,
        request: closeChallenge.request,
      });

      const channel = await readContract(publicClient, {
        abi: SESSION_ESCROW_ABI,
        address: sessionEscrowAddress,
        functionName: "getChannel",
        args: [channelId],
      });

      expect(openReceipt.reference).toBe(channelId);
      expect(voucherReceipt.reference).toBe(channelId);
      expect(afterSettlementBalance - beforeBalance).toBe(
        BigInt(sessionAmount) * 2n,
      );
      expect((channel as { finalized: boolean }).finalized).toBe(true);
    });
  });
});

function hasBytecode(code: Hex | undefined): boolean {
  return Boolean(code && code !== "0x");
}

async function issueLiveSessionChallenge(
  serverMethod: ReturnType<typeof serverSession>,
  parameters: {
    amount: string;
    currency: Address;
    escrowContract: Address;
    recipient: Address;
    suggestedDeposit?: string | undefined;
  },
): Promise<SessionChallenge> {
  const request = await serverMethod.request?.({
    credential: undefined,
    request: {
      amount: parameters.amount,
      currency: parameters.currency,
      recipient: parameters.recipient,
      ...(parameters.suggestedDeposit
        ? { suggestedDeposit: parameters.suggestedDeposit }
        : {}),
      unitType: "request",
      methodDetails: {
        chainId: chain.id,
        escrowContract: parameters.escrowContract,
      },
    },
  });

  if (!request) {
    throw new Error(
      "Create a live MegaETH session request successfully before issuing a live session challenge.",
    );
  }

  return Challenge.fromMethod(SharedMethods.session, {
    expires: new Date(Date.now() + 300_000).toISOString(),
    realm: "live.megaeth.local",
    request,
    secretKey: "megaeth-live-session-secret",
  }) as SessionChallenge;
}

function deserializeSessionCredential(value: string): SessionCredential {
  return Credential.deserialize<SharedMethods.SessionCredentialPayload>(
    value,
  ) as SessionCredential;
}
