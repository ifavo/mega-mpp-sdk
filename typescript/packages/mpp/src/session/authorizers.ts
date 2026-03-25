import { SESSION_ESCROW_ABI } from "./abi.js";
import { signSessionVoucher } from "./voucher.js";
import {
  getAddress,
  type Account,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { writeContract } from "viem/actions";

import { resolveAccount } from "../utils/clients.js";
import { SessionClientConfigurationError } from "./errors.js";

export type SessionAuthorizer = {
  readonly mode: "delegated" | "wallet";
  getAuthorizedSigner(parameters: {
    chainId: number;
    walletClient: WalletClient;
    walletAccount?: Account | Address | undefined;
  }): Promise<Address | undefined> | Address | undefined;
  getVoucherSourceAddress(parameters: {
    chainId: number;
    walletClient: WalletClient;
    walletAccount?: Account | Address | undefined;
  }): Promise<Address> | Address;
  openChannel(parameters: {
    authorizedSigner?: Address | undefined;
    deposit: bigint;
    escrowContract: Address;
    payerAccount?: Account | Address | undefined;
    payee: Address;
    salt: Hex;
    token: Address;
    walletClient: WalletClient;
  }): Promise<Hex>;
  signVoucher(parameters: {
    chainId: number;
    channelId: Hex;
    cumulativeAmount: bigint;
    escrowContract: Address;
    walletAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Promise<Hex>;
  topUpChannel(parameters: {
    additionalDeposit: bigint;
    channelId: Hex;
    escrowContract: Address;
    payerAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Promise<Hex>;
};

export class WalletSessionAuthorizer implements SessionAuthorizer {
  readonly mode = "wallet" as const;

  getAuthorizedSigner(_parameters: {
    chainId: number;
    walletAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Address | undefined {
    return undefined;
  }

  getVoucherSourceAddress(parameters: {
    chainId: number;
    walletAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Address {
    return getAddress(
      resolveAccount(parameters.walletClient, parameters.walletAccount).address,
    );
  }

  async openChannel(parameters: {
    authorizedSigner?: Address | undefined;
    deposit: bigint;
    escrowContract: Address;
    payerAccount?: Account | Address | undefined;
    payee: Address;
    salt: Hex;
    token: Address;
    walletClient: WalletClient;
  }): Promise<Hex> {
    const payer = resolveAccount(
      parameters.walletClient,
      parameters.payerAccount,
    );
    return writeContract(parameters.walletClient, {
      account: payer,
      address: parameters.escrowContract,
      abi: SESSION_ESCROW_ABI,
      functionName: "open",
      args: [
        parameters.payee,
        parameters.token,
        parameters.deposit,
        parameters.salt,
        parameters.authorizedSigner ??
          "0x0000000000000000000000000000000000000000",
      ],
      chain: parameters.walletClient.chain,
    });
  }

  async signVoucher(parameters: {
    chainId: number;
    channelId: Hex;
    cumulativeAmount: bigint;
    escrowContract: Address;
    walletAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Promise<Hex> {
    const signer = resolveAccount(
      parameters.walletClient,
      parameters.walletAccount,
    );
    return signSessionVoucher({
      account: signer.address,
      chainId: parameters.chainId,
      channelId: parameters.channelId,
      cumulativeAmount: parameters.cumulativeAmount,
      escrowContract: parameters.escrowContract,
      walletClient: parameters.walletClient,
    });
  }

  async topUpChannel(parameters: {
    additionalDeposit: bigint;
    channelId: Hex;
    escrowContract: Address;
    payerAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Promise<Hex> {
    const payer = resolveAccount(
      parameters.walletClient,
      parameters.payerAccount,
    );
    return writeContract(parameters.walletClient, {
      account: payer,
      address: parameters.escrowContract,
      abi: SESSION_ESCROW_ABI,
      functionName: "topUp",
      args: [parameters.channelId, parameters.additionalDeposit],
      chain: parameters.walletClient.chain,
    });
  }
}

export class DelegatedSessionAuthorizer implements SessionAuthorizer {
  readonly mode = "delegated" as const;

  constructor(
    private readonly parameters: {
      getSignerWalletClient?:
        | ((parameters: {
            chainId: number;
          }) => Promise<WalletClient> | WalletClient)
        | undefined;
      signerAccount?: Account | Address | undefined;
      signerWalletClient?: WalletClient | undefined;
    },
  ) {}

  async getAuthorizedSigner(parameters: {
    chainId: number;
    walletAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Promise<Address> {
    const signerWalletClient = await this.resolveSignerWalletClient(
      parameters.chainId,
    );
    return getAddress(
      resolveAccount(signerWalletClient, this.parameters.signerAccount).address,
    );
  }

  async getVoucherSourceAddress(parameters: {
    walletAccount?: Account | Address | undefined;
    walletClient: WalletClient;
    chainId: number;
  }): Promise<Address> {
    return this.getAuthorizedSigner({
      chainId: parameters.chainId,
      walletAccount: parameters.walletAccount,
      walletClient: parameters.walletClient,
    });
  }

  async openChannel(parameters: {
    authorizedSigner?: Address | undefined;
    deposit: bigint;
    escrowContract: Address;
    payerAccount?: Account | Address | undefined;
    payee: Address;
    salt: Hex;
    token: Address;
    walletClient: WalletClient;
  }): Promise<Hex> {
    const payer = resolveAccount(
      parameters.walletClient,
      parameters.payerAccount,
    );
    return writeContract(parameters.walletClient, {
      account: payer,
      address: parameters.escrowContract,
      abi: SESSION_ESCROW_ABI,
      functionName: "open",
      args: [
        parameters.payee,
        parameters.token,
        parameters.deposit,
        parameters.salt,
        parameters.authorizedSigner ??
          (await this.getAuthorizedSigner({
            chainId: parameters.walletClient.chain?.id ?? 0,
            walletClient: parameters.walletClient,
          })),
      ],
      chain: parameters.walletClient.chain,
    });
  }

  async signVoucher(parameters: {
    chainId: number;
    channelId: Hex;
    cumulativeAmount: bigint;
    escrowContract: Address;
    walletAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Promise<Hex> {
    const signerWalletClient = await this.resolveSignerWalletClient(
      parameters.chainId,
    );
    const signer = resolveAccount(
      signerWalletClient,
      this.parameters.signerAccount,
    );

    return signSessionVoucher({
      account: signer.address,
      chainId: parameters.chainId,
      channelId: parameters.channelId,
      cumulativeAmount: parameters.cumulativeAmount,
      escrowContract: parameters.escrowContract,
      walletClient: signerWalletClient,
    });
  }

  async topUpChannel(parameters: {
    additionalDeposit: bigint;
    channelId: Hex;
    escrowContract: Address;
    payerAccount?: Account | Address | undefined;
    walletClient: WalletClient;
  }): Promise<Hex> {
    const payer = resolveAccount(
      parameters.walletClient,
      parameters.payerAccount,
    );
    return writeContract(parameters.walletClient, {
      account: payer,
      address: parameters.escrowContract,
      abi: SESSION_ESCROW_ABI,
      functionName: "topUp",
      args: [parameters.channelId, parameters.additionalDeposit],
      chain: parameters.walletClient.chain,
    });
  }

  private async resolveSignerWalletClient(
    chainId: number,
  ): Promise<WalletClient> {
    if (this.parameters.getSignerWalletClient) {
      const walletClient = await this.parameters.getSignerWalletClient({
        chainId,
      });
      this.assertChain(walletClient, chainId);
      return walletClient;
    }

    if (!this.parameters.signerWalletClient) {
      throw new SessionClientConfigurationError(
        "Provide signerWalletClient or getSignerWalletClient so delegated session vouchers can be signed before retrying.",
      );
    }

    this.assertChain(this.parameters.signerWalletClient, chainId);
    return this.parameters.signerWalletClient;
  }

  private assertChain(walletClient: WalletClient, chainId: number): void {
    if (!walletClient.chain) {
      throw new SessionClientConfigurationError(
        `Provide a delegated signer walletClient configured for chainId "${chainId}" before retrying the session request.`,
      );
    }

    if (walletClient.chain.id !== chainId) {
      throw new SessionClientConfigurationError(
        `Provide a delegated signer walletClient configured for chainId "${chainId}" instead of "${walletClient.chain.id}".`,
      );
    }
  }
}
