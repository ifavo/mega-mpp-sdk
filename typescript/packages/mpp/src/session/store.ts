import { z } from "mppx";
import { getAddress, type Address, type Hex } from "viem";

import {
  SessionStoreConfigurationError,
  SessionStoreStateError,
} from "./errors.js";
import { baseUnitIntegerString } from "../utils/baseUnit.js";

const sessionSignerModeSchema = z.enum(["delegated", "wallet"]);

const sessionClientStateSchema = z.object({
  acceptedCumulative: baseUnitIntegerString(
    "accepted session cumulative amount",
  ),
  authorizedSigner: z.optional(z.address()),
  chainId: z.number(),
  channelId: z.hash(),
  currency: z.address(),
  deposit: baseUnitIntegerString("session deposit"),
  escrowContract: z.address(),
  lastSettlementAt: z.optional(z.string()),
  payer: z.address(),
  recipient: z.address(),
  signerMode: sessionSignerModeSchema,
  status: z.enum(["closing", "open"]),
  unitType: z.optional(z.string()),
  unsettledCumulative: baseUnitIntegerString(
    "unsettled session cumulative amount",
  ),
});

const sessionChannelStateSchema = z.object({
  acceptedCumulative: baseUnitIntegerString(
    "accepted session cumulative amount",
  ),
  authorizedSigner: z.optional(z.address()),
  chainId: z.number(),
  channelId: z.hash(),
  closeRequestedAt: z.optional(
    baseUnitIntegerString("session close-request timestamp"),
  ),
  currency: z.address(),
  deposit: baseUnitIntegerString("session deposit"),
  escrowContract: z.address(),
  lastChallengeId: z.optional(z.string()),
  lastOnChainVerifiedAt: z.optional(z.string()),
  lastSettlementAt: z.optional(z.string()),
  lastSettlementReference: z.optional(z.hash()),
  lastVoucherSignature: z.optional(z.signature()),
  payer: z.address(),
  recipient: z.address(),
  settled: baseUnitIntegerString("settled session amount"),
  status: z.enum(["close_requested", "closed", "open"]),
  unitType: z.optional(z.string()),
});

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
  concurrency: "single-process";
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
      return parseSessionClientState({
        scopeKey,
        value: state.get(scopeKey),
      });
    },
    async put(scopeKey, value) {
      state.set(
        scopeKey,
        parseSessionClientState({
          scopeKey,
          value,
        }) as SessionClientState,
      );
    },
  };
}

export function asSingleProcessSessionStore(store: {
  delete(key: string): Promise<void> | void;
  get(key: string): Promise<unknown> | unknown;
  put(key: string, value: unknown): Promise<void> | void;
}): SessionJsonStore {
  return {
    concurrency: "single-process",
    delete(key) {
      return store.delete(key);
    },
    get(key) {
      return store.get(key);
    },
    put(key, value) {
      return store.put(key, value);
    },
  };
}

export function createSessionChannelStore(
  store: SessionJsonStore,
): SessionChannelStore {
  assertSingleProcessStore(store);
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
      return parseSessionChannelState({
        channelKey,
        value: await store.get(channelKey),
      });
    },
    async updateChannel(channelKey, updater) {
      return withLock(channelKey, async () => {
        const current = parseSessionChannelState({
          channelKey,
          value: await store.get(channelKey),
        });
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

function assertSingleProcessStore(store: SessionJsonStore): void {
  if (store.concurrency !== "single-process") {
    throw new SessionStoreConfigurationError(
      "Create session channel stores from an explicit single-process JSON store before retrying. For distributed runtimes, provide session({ channelStore }) with an implementation that coordinates atomic updates across instances.",
    );
  }
}

function parseSessionChannelState(parameters: {
  channelKey: string;
  value: unknown;
}): SessionChannelState | undefined {
  if (parameters.value == null) {
    return undefined;
  }

  const result = sessionChannelStateSchema.safeParse(parameters.value);
  if (result.success) {
    return result.data as SessionChannelState;
  }

  throw new SessionStoreStateError(
    `Repair or clear the persisted session channel state for "${parameters.channelKey}" before retrying. The stored value does not match the current MegaETH session channel schema.`,
    { cause: result.error },
  );
}

function parseSessionClientState(parameters: {
  scopeKey: string;
  value: unknown;
}): SessionClientState | undefined {
  if (parameters.value == null) {
    return undefined;
  }

  const result = sessionClientStateSchema.safeParse(parameters.value);
  if (result.success) {
    return result.data as SessionClientState;
  }

  throw new SessionStoreStateError(
    `Repair or clear the persisted session client state for "${parameters.scopeKey}" before retrying. The stored value does not match the current MegaETH session client schema.`,
    { cause: result.error },
  );
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
