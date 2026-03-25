import { getAddress, type Address, type Hex } from "viem";

export type SessionSignerMode = "delegated" | "wallet";

export type SessionClientState = {
  acceptedCumulative: string;
  authorizedSigner?: Address | undefined;
  chainId: number;
  channelId: Hex;
  currency: Address;
  deposit: string;
  escrowContract: Address;
  lastSettlementAt?: string | undefined;
  payer: Address;
  recipient: Address;
  signerMode: SessionSignerMode;
  status: "closing" | "open";
  unitType?: string | undefined;
  unsettledCumulative: string;
};

export type SessionChannelState = {
  acceptedCumulative: string;
  authorizedSigner?: Address | undefined;
  chainId: number;
  channelId: Hex;
  closeRequestedAt?: string | undefined;
  currency: Address;
  deposit: string;
  escrowContract: Address;
  lastChallengeId?: string | undefined;
  lastOnChainVerifiedAt?: string | undefined;
  lastSettlementAt?: string | undefined;
  lastSettlementReference?: Hex | undefined;
  lastVoucherSignature?: Hex | undefined;
  payer: Address;
  recipient: Address;
  settled: string;
  status: "close_requested" | "closed" | "open";
  unitType?: string | undefined;
};

export type SessionClientStateStore = {
  delete(scopeKey: string): Promise<void>;
  get(scopeKey: string): Promise<SessionClientState | undefined>;
  put(scopeKey: string, state: SessionClientState): Promise<void>;
};

export type SessionJsonStore = {
  delete(key: string): Promise<void> | void;
  get(key: string): Promise<unknown> | unknown;
  put(key: string, value: unknown): Promise<void> | void;
};

export type SessionChannelStore = {
  deleteChannel(channelKey: string): Promise<void>;
  getChannel(channelKey: string): Promise<SessionChannelState | undefined>;
  updateChannel(
    channelKey: string,
    updater: (
      current: SessionChannelState | undefined,
    ) => SessionChannelState | null,
  ): Promise<SessionChannelState | undefined>;
};

export function createMemorySessionClientStore(): SessionClientStateStore {
  const state = new Map<string, SessionClientState>();

  return {
    async delete(scopeKey) {
      state.delete(scopeKey);
    },
    async get(scopeKey) {
      return state.get(scopeKey);
    },
    async put(scopeKey, value) {
      state.set(scopeKey, value);
    },
  };
}

export function createSessionChannelStore(
  store: SessionJsonStore,
): SessionChannelStore {
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    while (locks.has(key)) {
      await locks.get(key);
    }

    let release: (() => void) | undefined;
    locks.set(
      key,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    try {
      return await task();
    } finally {
      locks.delete(key);
      release?.();
    }
  }

  return {
    async deleteChannel(channelKey) {
      await store.delete(channelKey);
    },
    async getChannel(channelKey) {
      return (await store.get(channelKey)) as SessionChannelState | undefined;
    },
    async updateChannel(channelKey, updater) {
      return withLock(channelKey, async () => {
        const current = (await store.get(channelKey)) as
          | SessionChannelState
          | undefined;
        const next = updater(current);
        if (next) {
          await store.put(channelKey, next);
          return next;
        }

        await store.delete(channelKey);
        return undefined;
      });
    },
  };
}

export function getSessionClientScopeKey(parameters: {
  chainId: number;
  currency: Address;
  escrowContract: Address;
  recipient: Address;
  unitType?: string | undefined;
}): string {
  return [
    parameters.chainId,
    getAddress(parameters.escrowContract).toLowerCase(),
    getAddress(parameters.recipient).toLowerCase(),
    getAddress(parameters.currency).toLowerCase(),
    parameters.unitType ?? "",
  ].join(":");
}

export function getSessionChannelKey(parameters: {
  chainId: number;
  channelId: Hex;
  escrowContract: Address;
}): string {
  return [
    "megaeth",
    "session",
    parameters.chainId,
    getAddress(parameters.escrowContract).toLowerCase(),
    parameters.channelId.toLowerCase(),
  ].join(":");
}
