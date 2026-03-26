import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { Challenge, Credential, Errors, Store } from "mppx";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  deployContract,
  getTransaction,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as SharedMethods from "../Methods.js";
import { megaethTestnet } from "../constants.js";
import { charge as clientCharge } from "../client/Charge.js";
import { charge as serverCharge } from "../server/Charge.js";
import {
  capturePaymentError,
  type ChargeCredential,
  deserializeChargeCredential,
} from "./fixtures/chargeTestkit.js";
import { compileMockContracts } from "./fixtures/mockContracts.js";

type ChargeChallenge = Challenge.Challenge<
  SharedMethods.ChargeRequest,
  typeof SharedMethods.charge.intent,
  typeof SharedMethods.charge.name
>;

type LocalWalletClient = ReturnType<typeof createWalletClient> & {
  account: NonNullable<ReturnType<typeof createWalletClient>["account"]>;
};

type MockContracts = ReturnType<typeof compileMockContracts>;

type TestContext = {
  contracts: MockContracts;
  permit2Address: Address;
  publicClient: PublicClient;
  rpcUrl: string;
  splitAddress: Address;
  store: Store.Store;
  tokenAddress: Address;
  wallets: {
    deployer: LocalWalletClient;
    payer: LocalWalletClient;
    recipient: LocalWalletClient;
    split: LocalWalletClient;
  };
};

const TEST_SECRET = "mega-mpp-sdk-test-secret";
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

let anvilProcess: ChildProcess | undefined;
let snapshotId: string | undefined;
let testContext: TestContext | undefined;

describe("megaeth charge integration", () => {
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
    const split = createMnemonicWalletClient(rpcUrl, 3);

    const contracts = compileMockContracts();
    const tokenHash = await deployContract(deployer, {
      abi: contracts.mockErc20.abi,
      account: deployer.account,
      args: ["Mock USDm", "USDm", 18],
      bytecode: contracts.mockErc20.bytecode,
      chain: megaethTestnet,
    });
    const tokenReceipt = await waitForTransactionReceipt(publicClient, {
      hash: tokenHash,
    });
    const tokenAddress = tokenReceipt.contractAddress;

    const permit2Hash = await deployContract(deployer, {
      abi: contracts.mockPermit2.abi,
      account: deployer.account,
      bytecode: contracts.mockPermit2.bytecode,
      chain: megaethTestnet,
    });
    const permit2Receipt = await waitForTransactionReceipt(publicClient, {
      hash: permit2Hash,
    });
    const permit2Address = permit2Receipt.contractAddress;

    if (!tokenAddress || !permit2Address) {
      throw new Error(
        "Deploy the mock contracts and accounts successfully before running the integration suite.",
      );
    }

    await waitForTransactionReceipt(publicClient, {
      hash: await writeContract(deployer, {
        abi: contracts.mockErc20.abi,
        account: deployer.account,
        address: tokenAddress,
        args: [payer.account.address, 10_000n],
        chain: megaethTestnet,
        functionName: "mint",
      }),
    });

    await waitForTransactionReceipt(publicClient, {
      hash: await writeContract(payer, {
        abi: contracts.mockErc20.abi,
        account: payer.account,
        address: tokenAddress,
        args: [permit2Address, 10_000n],
        chain: megaethTestnet,
        functionName: "approve",
      }),
    });

    testContext = {
      contracts,
      permit2Address,
      publicClient,
      rpcUrl,
      splitAddress: split.account.address,
      store: Store.memory(),
      tokenAddress,
      wallets: {
        deployer,
        payer,
        recipient,
        split,
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

  it("settles a direct Permit2 credential and prevents challenge replay", async () => {
    const context = requireTestContext();
    const clientMethod = createIntegrationClientMethod(context);
    const serverMethod = createIntegrationServerMethod(context);

    const challenge = await issueChallenge(
      serverMethod,
      context.tokenAddress,
      context.wallets.recipient.account.address,
      {
        chainId: megaethTestnet.id,
        permit2Address: context.permit2Address,
      },
    );

    const credential = deserializeChargeCredential(
      await clientMethod.createCredential({ challenge }),
    );
    const receipt = await serverMethod.verify({
      credential,
      request: challenge.request,
    });
    const settlementTransaction = await getTransaction(context.publicClient, {
      hash: receipt.reference as `0x${string}`,
    });

    const recipientBalance = await readContract(context.publicClient, {
      abi: context.contracts.mockErc20.abi,
      address: context.tokenAddress,
      functionName: "balanceOf",
      args: [context.wallets.recipient.account.address],
    });

    expect(receipt.reference).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(settlementTransaction.input.slice(0, 10)).toBe("0x137c29fe");
    expect(recipientBalance).toBe(1000n);

    await expect(
      serverMethod.verify({
        credential,
        request: challenge.request,
      }),
    ).rejects.toBeInstanceOf(Errors.InvalidChallengeError);

    const replayError = await capturePaymentError(
      serverMethod.verify({
        credential,
        request: challenge.request,
      }),
    );
    expect(replayError.message).toMatch(/fresh payment challenge/i);
  });

  it("verifies a transaction-hash credential after the payer broadcasts the Permit2 transaction", async () => {
    const context = requireTestContext();
    const clientMethod = createIntegrationClientMethod(context, {
      credentialMode: "hash",
    });
    const serverMethod = createIntegrationServerMethod(context, {
      account: undefined,
      publicClient: context.publicClient,
      rpcUrls: undefined,
      walletClient: undefined,
    });

    const challenge = await issueChallenge(
      serverMethod,
      context.tokenAddress,
      context.wallets.recipient.account.address,
      {
        chainId: megaethTestnet.id,
        permit2Address: context.permit2Address,
      },
    );

    const credential = deserializeChargeCredential(
      await clientMethod.createCredential({ challenge }),
    );
    expect(
      getAddress(
        credential.challenge.request.methodDetails.permit2Address ??
          context.permit2Address,
      ),
    ).toBe(getAddress(context.permit2Address));
    const transaction = await getTransaction(context.publicClient, {
      hash: (credential.payload as SharedMethods.ChargeHashPayload)
        .hash as `0x${string}`,
    });

    expect(
      getAddress(
        transaction.to ?? "0x0000000000000000000000000000000000000000",
      ),
    ).toBe(getAddress(context.permit2Address));
    expect(transaction.input.slice(0, 10)).toBe("0x137c29fe");

    const receipt = await serverMethod.verify({
      credential,
      request: challenge.request,
    });

    const recipientBalance = await readContract(context.publicClient, {
      abi: context.contracts.mockErc20.abi,
      address: context.tokenAddress,
      functionName: "balanceOf",
      args: [context.wallets.recipient.account.address],
    });

    expect(receipt.reference).toBe(
      (credential.payload as SharedMethods.ChargeHashPayload).hash,
    );
    expect(recipientBalance).toBe(1000n);
  });

  it("settles split payments with the draft batch Permit2 extension", async () => {
    const context = requireTestContext();
    const clientMethod = createIntegrationClientMethod(context);
    const serverMethod = createIntegrationServerMethod(context, {
      splits: [
        {
          amount: "100",
          memo: "platform fee",
          recipient: context.splitAddress,
        },
      ],
    });

    const challenge = await issueChallenge(
      serverMethod,
      context.tokenAddress,
      context.wallets.recipient.account.address,
      {
        chainId: megaethTestnet.id,
        permit2Address: context.permit2Address,
        splits: [
          {
            amount: "100",
            memo: "platform fee",
            recipient: context.splitAddress,
          },
        ],
      },
    );

    const credential = deserializeChargeCredential(
      await clientMethod.createCredential({ challenge }),
    );
    const receipt = await serverMethod.verify({
      credential,
      request: challenge.request,
    });
    const settlementTransaction = await getTransaction(context.publicClient, {
      hash: receipt.reference as `0x${string}`,
    });

    const [recipientBalance, splitBalance] = await Promise.all([
      readContract(context.publicClient, {
        abi: context.contracts.mockErc20.abi,
        address: context.tokenAddress,
        functionName: "balanceOf",
        args: [context.wallets.recipient.account.address],
      }),
      readContract(context.publicClient, {
        abi: context.contracts.mockErc20.abi,
        address: context.tokenAddress,
        functionName: "balanceOf",
        args: [context.splitAddress],
      }),
    ]);

    expect(settlementTransaction.input.slice(0, 10)).toBe("0xfe8ec1a7");
    expect(recipientBalance).toBe(900n);
    expect(splitBalance).toBe(100n);
  });

  it("rejects a mutated payload that changes the requested amount", async () => {
    const context = requireTestContext();
    const clientMethod = createIntegrationClientMethod(context);
    const serverMethod = createIntegrationServerMethod(context);

    const challenge = await issueChallenge(
      serverMethod,
      context.tokenAddress,
      context.wallets.recipient.account.address,
      {
        chainId: megaethTestnet.id,
        permit2Address: context.permit2Address,
      },
    );

    const credential = deserializeChargeCredential(
      await clientMethod.createCredential({ challenge }),
    );
    const mutated = Credential.from({
      ...credential,
      payload: {
        ...(credential.payload as SharedMethods.ChargePermit2Payload),
        permit: {
          ...(credential.payload as SharedMethods.ChargePermit2Payload).permit,
          permitted: {
            amount: "999",
            token: context.tokenAddress,
          },
        },
      },
    }) as ChargeCredential;

    await expect(
      serverMethod.verify({
        credential: mutated,
        request: challenge.request,
      }),
    ).rejects.toBeInstanceOf(Errors.VerificationFailedError);

    const verificationError = await capturePaymentError(
      serverMethod.verify({
        credential: mutated,
        request: challenge.request,
      }),
    );
    expect(verificationError.message).toMatch(/requested token and amount/i);
  });

  it('guides the client to use credentialMode "permit2" when the server sponsors gas', async () => {
    const context = requireTestContext();
    const clientMethod = createIntegrationClientMethod(context, {
      credentialMode: "hash",
    });
    const serverMethod = createIntegrationServerMethod(context, {
      feePayer: true,
    });

    const challenge = await issueChallenge(
      serverMethod,
      context.tokenAddress,
      context.wallets.recipient.account.address,
      {
        chainId: megaethTestnet.id,
        feePayer: true,
        permit2Address: context.permit2Address,
      },
    );

    await expect(
      clientMethod.createCredential({ challenge }),
    ).rejects.toThrowError(/credentialmode "permit2"/i);
  });

  it("returns a structured payment-insufficient error when Permit2 approval is missing", async () => {
    const context = requireTestContext();
    await waitForTransactionReceipt(context.publicClient, {
      hash: await writeContract(context.wallets.payer, {
        abi: context.contracts.mockErc20.abi,
        account: context.wallets.payer.account,
        address: context.tokenAddress,
        args: [context.permit2Address, 0n],
        chain: megaethTestnet,
        functionName: "approve",
      }),
    });

    const clientMethod = createIntegrationClientMethod(context);
    const serverMethod = createIntegrationServerMethod(context);

    const challenge = await issueChallenge(
      serverMethod,
      context.tokenAddress,
      context.wallets.recipient.account.address,
      {
        chainId: megaethTestnet.id,
        permit2Address: context.permit2Address,
      },
    );

    const credential = deserializeChargeCredential(
      await clientMethod.createCredential({ challenge }),
    );

    await expect(
      serverMethod.verify({
        credential,
        request: challenge.request,
      }),
    ).rejects.toBeInstanceOf(Errors.PaymentInsufficientError);

    const insufficientError = await capturePaymentError(
      serverMethod.verify({
        credential,
        request: challenge.request,
      }),
    );
    expect(insufficientError.message).toMatch(/approve permit2/i);
  });
});

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(
          new Error("Reserve a TCP port successfully before starting Anvil."),
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
  });
}

function requireTestContext(): TestContext {
  if (!testContext) {
    throw new Error(
      "Initialize the Anvil-backed test context before running the integration suite.",
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
      "Attach test accounts to the local wallet clients before running the integration suite.",
    );
  }

  return walletClient as LocalWalletClient;
}

function createIntegrationClientMethod(
  context: TestContext,
  overrides?: Partial<Parameters<typeof clientCharge>[0]>,
) {
  return clientCharge({
    account: context.wallets.payer.account,
    rpcUrls: { [megaethTestnet.id]: context.rpcUrl },
    submissionMode: "sendAndWait",
    walletClient: context.wallets.payer,
    ...overrides,
  });
}

function createIntegrationServerMethod(
  context: TestContext,
  overrides?: Partial<Parameters<typeof serverCharge>[0]>,
) {
  return serverCharge({
    account: context.wallets.recipient.account,
    chainId: megaethTestnet.id,
    currency: context.tokenAddress,
    permit2Address: context.permit2Address,
    recipient: context.wallets.recipient.account.address,
    rpcUrls: { [megaethTestnet.id]: context.rpcUrl },
    submissionMode: "sendAndWait",
    store: context.store,
    walletClient: context.wallets.recipient,
    ...overrides,
  });
}

async function issueChallenge(
  serverMethod: ReturnType<typeof serverCharge>,
  currency: Address,
  recipient: Address,
  methodDetails: SharedMethods.ChargeRequest["methodDetails"],
): Promise<ChargeChallenge> {
  const request = await serverMethod.request?.({
    credential: undefined,
    request: {
      amount: "1000",
      currency,
      recipient,
      methodDetails,
    },
  });

  if (!request) {
    throw new Error(
      "Create a server-side charge request before issuing a challenge.",
    );
  }

  return Challenge.fromMethod(SharedMethods.charge, {
    expires: new Date(Date.now() + 60_000).toISOString(),
    realm: "tests.megaeth.local",
    request,
    secretKey: TEST_SECRET,
  }) as ChargeChallenge;
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
          "Start Anvil successfully before running the integration suite.",
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
          `Keep Anvil running during integration tests. It exited early with code ${String(code)}.`,
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
    "Serve the local MegaETH test RPC before running the integration suite.",
  );
}
