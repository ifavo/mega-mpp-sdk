import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { Challenge, Credential, Errors, Store } from "mppx";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  deployContract,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as SharedMethods from "../Methods.js";
import { megaethTestnet } from "../constants.js";
import {
  DelegatedSessionAuthorizer,
  session as clientSession,
} from "../client/Session.js";
import { session as serverSession } from "../server/Session.js";
import { getSessionChannelKey } from "../session/store.js";
import { compileMockContracts } from "./fixtures/mockContracts.js";
import {
  loadErc1967ProxyContract,
  loadSessionEscrowContract,
} from "./fixtures/sessionContracts.js";

type SessionChallenge = Challenge.Challenge<
  SharedMethods.SessionRequest,
  typeof SharedMethods.session.intent,
  typeof SharedMethods.session.name
>;

type LocalWalletClient = ReturnType<typeof createWalletClient> & {
  account: NonNullable<ReturnType<typeof createWalletClient>["account"]>;
};

type SessionIntegrationContext = {
  escrowAddress: Address;
  publicClient: PublicClient;
  rpcUrl: string;
  store: Store.Store;
  tokenAddress: Address;
  wallets: {
    deployer: LocalWalletClient;
    payer: LocalWalletClient;
    recipient: LocalWalletClient;
    signer: LocalWalletClient;
  };
};

const TEST_SECRET = "mega-mpp-sdk-session-test-secret";
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

let anvilProcess: ChildProcess | undefined;
let snapshotId: string | undefined;
let testContext: SessionIntegrationContext | undefined;

describe("megaeth session integration", () => {
  beforeAll(async () => {
    const port = await getFreePort();
    const rpcUrl = `http://127.0.0.1:${port}`;
    anvilProcess = await startAnvil(port);

    const publicClient = createPublicClient({
      chain: megaethTestnet,
      transport: http(rpcUrl),
    });

    await waitForRpc(publicClient);

    const deployer = createMnemonicWalletClient(rpcUrl, 0);
    const payer = createMnemonicWalletClient(rpcUrl, 1);
    const recipient = createMnemonicWalletClient(rpcUrl, 2);
    const signer = createMnemonicWalletClient(rpcUrl, 3);

    const mockContracts = compileMockContracts();
    const erc1967Proxy = loadErc1967ProxyContract();
    const sessionEscrow = loadSessionEscrowContract();

    const tokenHash = await deployContract(deployer, {
      abi: mockContracts.mockErc20.abi,
      account: deployer.account,
      args: ["Mock USDC", "USDC", 6],
      bytecode: mockContracts.mockErc20.bytecode,
      chain: megaethTestnet,
    });
    const tokenReceipt = await waitForTransactionReceipt(publicClient, {
      hash: tokenHash,
    });
    const tokenAddress = tokenReceipt.contractAddress;

    const implementationHash = await deployContract(deployer, {
      abi: sessionEscrow.abi,
      account: deployer.account,
      bytecode: sessionEscrow.bytecode,
      chain: megaethTestnet,
    });
    const implementationReceipt = await waitForTransactionReceipt(
      publicClient,
      {
        hash: implementationHash,
      },
    );
    const implementationAddress = implementationReceipt.contractAddress;

    if (!tokenAddress || !implementationAddress) {
      throw new Error(
        "Deploy the mock token and MegaETH session escrow successfully before running the session integration suite.",
      );
    }

    const escrowHash = await deployContract(deployer, {
      abi: erc1967Proxy.abi,
      account: deployer.account,
      args: [
        implementationAddress,
        encodeFunctionData({
          abi: sessionEscrow.abi,
          args: [deployer.account.address, 86_400],
          functionName: "initialize",
        }),
      ],
      bytecode: erc1967Proxy.bytecode,
      chain: megaethTestnet,
    });
    const escrowReceipt = await waitForTransactionReceipt(publicClient, {
      hash: escrowHash,
    });
    const escrowAddress = escrowReceipt.contractAddress;

    if (!escrowAddress) {
      throw new Error(
        "Deploy the MegaETH session escrow proxy successfully before running the session integration suite.",
      );
    }

    await waitForTransactionReceipt(publicClient, {
      hash: await writeContract(deployer, {
        abi: mockContracts.mockErc20.abi,
        account: deployer.account,
        address: tokenAddress,
        args: [payer.account.address, 25_000n],
        chain: megaethTestnet,
        functionName: "mint",
      }),
    });

    await waitForTransactionReceipt(publicClient, {
      hash: await writeContract(payer, {
        abi: mockContracts.mockErc20.abi,
        account: payer.account,
        address: tokenAddress,
        args: [escrowAddress, 25_000n],
        chain: megaethTestnet,
        functionName: "approve",
      }),
    });

    testContext = {
      escrowAddress,
      publicClient,
      rpcUrl,
      store: Store.memory(),
      tokenAddress,
      wallets: {
        deployer,
        payer,
        recipient,
        signer,
      },
    };

    snapshotId = await rpcRequest<string>(publicClient, "evm_snapshot");
  });

  beforeEach(async () => {
    const context = requireTestContext();
    if (snapshotId) {
      await rpcRequest<boolean>(context.publicClient, "evm_revert", [
        snapshotId,
      ]);
    }

    snapshotId = await rpcRequest<string>(context.publicClient, "evm_snapshot");
    context.store = Store.memory();
  });

  afterAll(async () => {
    if (!anvilProcess) return;

    await new Promise<void>((resolve) => {
      anvilProcess?.once("exit", () => resolve());
      anvilProcess?.kill("SIGTERM");
    });
  });

  it("auto-opens a session and settles after the second accepted voucher", async () => {
    const context = requireTestContext();
    const progress: string[] = [];
    const clientMethod = clientSession({
      account: context.wallets.payer.account,
      deposit: "3000",
      onProgress(update) {
        progress.push(update.type);
      },
      publicClient: context.publicClient,
      walletClient: context.wallets.payer,
    });
    const serverMethod = createServerMethod(context, {
      settlement: {
        close: { enabled: true },
        periodic: {
          intervalSeconds: 3_600,
          minUnsettledAmount: "2000",
        },
      },
    });

    const challengeOne = await issueSessionChallenge(serverMethod, context, {
      amount: "1000",
      suggestedDeposit: "3000",
    });
    const credentialOne = deserializeSessionCredential(
      await clientMethod.createCredential({
        challenge: challengeOne,
        context: {},
      }),
    );
    const receiptOne = await serverMethod.verify({
      credential: credentialOne,
      request: challengeOne.request,
    });

    const recipientBalanceAfterOpen = await readTokenBalance(context);
    expect(receiptOne.reference).toBe(
      (credentialOne.payload as SharedMethods.SessionOpenPayload).channelId,
    );
    expect(recipientBalanceAfterOpen).toBe(0n);

    const challengeTwo = await issueSessionChallenge(serverMethod, context, {
      amount: "1000",
    });
    const credentialTwo = deserializeSessionCredential(
      await clientMethod.createCredential({
        challenge: challengeTwo,
        context: {},
      }),
    );
    await serverMethod.verify({
      credential: credentialTwo,
      request: challengeTwo.request,
    });

    const recipientBalanceAfterVoucher = await readTokenBalance(context);

    expect(progress).toEqual([
      "challenge",
      "opening",
      "opened",
      "challenge",
      "updating",
      "updated",
    ]);
    expect(recipientBalanceAfterVoucher).toBe(2000n);
  });

  it("tops up an existing session channel and closes it cooperatively", async () => {
    const context = requireTestContext();
    const clientMethod = clientSession({
      account: context.wallets.payer.account,
      deposit: "1000",
      publicClient: context.publicClient,
      walletClient: context.wallets.payer,
    });
    const serverMethod = createServerMethod(context, {
      settlement: {
        close: { enabled: true },
        periodic: {
          intervalSeconds: 3_600,
          minUnsettledAmount: "10000",
        },
      },
    });

    const openChallenge = await issueSessionChallenge(serverMethod, context, {
      amount: "1000",
      suggestedDeposit: "1000",
    });
    const openCredential = deserializeSessionCredential(
      await clientMethod.createCredential({
        challenge: openChallenge,
        context: {},
      }),
    );
    await serverMethod.verify({
      credential: openCredential,
      request: openChallenge.request,
    });
    const channelId = (
      openCredential.payload as SharedMethods.SessionOpenPayload
    ).channelId as Hex;

    const topUpChallenge = await issueSessionChallenge(serverMethod, context, {
      amount: "1000",
    });
    const topUpCredential = deserializeSessionCredential(
      await clientMethod.createCredential({
        challenge: topUpChallenge,
        context: {
          action: "topUp",
          additionalDepositRaw: "2000",
          authorizeCurrentRequest: false,
          channelId,
        },
      }),
    );
    await serverMethod.verify({
      credential: topUpCredential,
      request: topUpChallenge.request,
    });

    const channelAfterTopUp = await readContract(context.publicClient, {
      abi: loadSessionEscrowContract().abi,
      address: context.escrowAddress,
      functionName: "getChannel",
      args: [channelId],
    });
    expect((channelAfterTopUp as { deposit: bigint }).deposit).toBe(3000n);

    const closeChallenge = await issueSessionChallenge(serverMethod, context, {
      amount: "1000",
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

    const [recipientBalance, payerBalance, serverState] = await Promise.all([
      readTokenBalance(context),
      readContract(context.publicClient, {
        abi: compileMockContracts().mockErc20.abi,
        address: context.tokenAddress,
        functionName: "balanceOf",
        args: [context.wallets.payer.account.address],
      }),
      context.store.get(
        getSessionChannelKey({
          chainId: megaethTestnet.id,
          channelId,
          escrowContract: context.escrowAddress,
        }),
      ),
    ]);

    expect(recipientBalance).toBe(1000n);
    expect(payerBalance).toBe(24_000n);
    expect((serverState as { status: string }).status).toBe("closed");
  });

  it("accepts delegated-signer vouchers end to end", async () => {
    const context = requireTestContext();
    const clientMethod = clientSession({
      account: context.wallets.payer.account,
      authorizer: new DelegatedSessionAuthorizer({
        signerAccount: context.wallets.signer.account,
        signerWalletClient: context.wallets.signer,
      }),
      deposit: "2000",
      publicClient: context.publicClient,
      walletClient: context.wallets.payer,
    });
    const serverMethod = createServerMethod(context, {
      settlement: {
        close: { enabled: true },
        periodic: {
          intervalSeconds: 3_600,
          minUnsettledAmount: "2000",
        },
      },
      verifier: {
        allowDelegatedSigner: true,
        minVoucherDelta: "500",
      },
    });

    const openChallenge = await issueSessionChallenge(serverMethod, context, {
      amount: "1000",
      suggestedDeposit: "2000",
    });
    const openCredential = deserializeSessionCredential(
      await clientMethod.createCredential({
        challenge: openChallenge,
        context: {},
      }),
    );
    await serverMethod.verify({
      credential: openCredential,
      request: openChallenge.request,
    });

    const voucherChallenge = await issueSessionChallenge(
      serverMethod,
      context,
      {
        amount: "1000",
      },
    );
    const voucherCredential = deserializeSessionCredential(
      await clientMethod.createCredential({
        challenge: voucherChallenge,
        context: {},
      }),
    );
    await serverMethod.verify({
      credential: voucherCredential,
      request: voucherChallenge.request,
    });

    const channelId = (
      openCredential.payload as SharedMethods.SessionOpenPayload
    ).channelId as Hex;
    const [channel, recipientBalance] = await Promise.all([
      readContract(context.publicClient, {
        abi: loadSessionEscrowContract().abi,
        address: context.escrowAddress,
        functionName: "getChannel",
        args: [channelId],
      }),
      readTokenBalance(context),
    ]);

    expect((channel as { authorizedSigner: Address }).authorizedSigner).toBe(
      context.wallets.signer.account.address,
    );
    expect(recipientBalance).toBe(2000n);
  });

  it("rejects a replayed session challenge", async () => {
    const context = requireTestContext();
    const clientMethod = clientSession({
      account: context.wallets.payer.account,
      deposit: "2000",
      publicClient: context.publicClient,
      walletClient: context.wallets.payer,
    });
    const serverMethod = createServerMethod(context, {
      settlement: {
        close: { enabled: true },
        periodic: {
          intervalSeconds: 3_600,
          minUnsettledAmount: "5000",
        },
      },
    });

    const challenge = await issueSessionChallenge(serverMethod, context, {
      amount: "1000",
      suggestedDeposit: "2000",
    });
    const credential = deserializeSessionCredential(
      await clientMethod.createCredential({ challenge, context: {} }),
    );
    await serverMethod.verify({
      credential,
      request: challenge.request,
    });

    await expect(
      serverMethod.verify({
        credential,
        request: challenge.request,
      }),
    ).rejects.toBeInstanceOf(Errors.InvalidChallengeError);
  });
});

function requireTestContext(): SessionIntegrationContext {
  if (!testContext) {
    throw new Error(
      "Initialize the Anvil-backed MegaETH session test context before running the integration suite.",
    );
  }

  return testContext;
}

function createMnemonicWalletClient(
  rpcUrl: string,
  addressIndex: number,
): LocalWalletClient {
  const walletClient = createWalletClient({
    account: mnemonicToAccount(TEST_MNEMONIC, { addressIndex }),
    chain: megaethTestnet,
    transport: http(rpcUrl),
  });

  if (!walletClient.account) {
    throw new Error(
      "Attach test accounts to the local wallet clients before running the session integration suite.",
    );
  }

  return walletClient as LocalWalletClient;
}

function createServerMethod(
  context: SessionIntegrationContext,
  overrides?: Partial<Parameters<typeof serverSession>[0]>,
) {
  return serverSession({
    account: context.wallets.recipient.account,
    chainId: megaethTestnet.id,
    currency: context.tokenAddress,
    escrowContract: context.escrowAddress,
    recipient: context.wallets.recipient.account.address,
    rpcUrls: { [megaethTestnet.id]: context.rpcUrl },
    store: context.store,
    walletClient: context.wallets.recipient,
    ...overrides,
  } as Parameters<typeof serverSession>[0]);
}

async function issueSessionChallenge(
  serverMethod: ReturnType<typeof serverSession>,
  context: SessionIntegrationContext,
  overrides?: Partial<SharedMethods.SessionRequest>,
): Promise<SessionChallenge> {
  const request = await serverMethod.request?.({
    credential: undefined,
    request: {
      amount: "1000",
      currency: context.tokenAddress,
      recipient: context.wallets.recipient.account.address,
      ...(overrides?.suggestedDeposit
        ? { suggestedDeposit: overrides.suggestedDeposit }
        : {}),
      unitType: "request",
      methodDetails: {
        chainId: megaethTestnet.id,
        escrowContract: context.escrowAddress,
        ...(overrides?.methodDetails?.channelId
          ? { channelId: overrides.methodDetails.channelId }
          : {}),
      },
      ...overrides,
    },
  });

  if (!request) {
    throw new Error(
      "Create a server-side session request before issuing a session challenge.",
    );
  }

  return Challenge.fromMethod(SharedMethods.session, {
    expires: new Date(Date.now() + 60_000).toISOString(),
    realm: "tests.megaeth.local",
    request,
    secretKey: TEST_SECRET,
  }) as SessionChallenge;
}

function deserializeSessionCredential(
  value: string,
): Credential.Credential<
  SharedMethods.SessionCredentialPayload,
  SessionChallenge
> {
  return Credential.deserialize<SharedMethods.SessionCredentialPayload>(
    value,
  ) as Credential.Credential<
    SharedMethods.SessionCredentialPayload,
    SessionChallenge
  >;
}

async function readTokenBalance(
  context: SessionIntegrationContext,
): Promise<bigint> {
  return (await readContract(context.publicClient, {
    abi: compileMockContracts().mockErc20.abi,
    address: context.tokenAddress,
    functionName: "balanceOf",
    args: [context.wallets.recipient.account.address],
  })) as bigint;
}

async function rpcRequest<value>(
  publicClient: PublicClient,
  method: string,
  params?: readonly unknown[] | undefined,
): Promise<value> {
  const request = publicClient.request as (parameters: {
    method: string;
    params?: readonly unknown[] | undefined;
  }) => Promise<unknown>;

  return (await request({ method, params })) as value;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(
          new Error(
            "Resolve a local TCP port successfully before starting Anvil.",
          ),
        );
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.once("error", reject);
  });
}

async function startAnvil(port: number): Promise<ChildProcess> {
  const process = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      String(megaethTestnet.id),
      "--mnemonic",
      TEST_MNEMONIC,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          "Start Anvil successfully before running the session integration suite.",
        ),
      );
    }, 10_000);

    const onData = (chunk: Buffer) => {
      const output = chunk.toString();
      if (output.includes("Listening on")) {
        clearTimeout(timeout);
        process.stdout.off("data", onData);
        process.stderr.off("data", onData);
        resolve();
      }
    };

    process.stdout.on("data", onData);
    process.stderr.on("data", onData);
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Keep Anvil running during session integration tests. It exited early with code ${String(code)}.`,
        ),
      );
    });
  });

  return process;
}

async function waitForRpc(publicClient: PublicClient): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await publicClient.getBlockNumber();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(
    "Serve the local MegaETH test RPC before running the session integration suite.",
  );
}
