import type { Store } from "mppx/server";

type LockRelease = (() => Promise<void> | void) | void;

type LockCapableStore = Store.Store & {
  acquireLock?:
    | ((key: string) => Promise<LockRelease> | LockRelease)
    | undefined;
};

const localStoreLocks = new WeakMap<object, Map<string, Promise<void>>>();

export async function withVerificationLocks<T>(parameters: {
  keys: string[];
  store: Store.Store;
  task: () => Promise<T>;
}): Promise<T> {
  const keys = [...new Set(parameters.keys)].sort();
  const releases: Array<() => Promise<void>> = [];

  for (const key of keys) {
    releases.push(await acquireLock(parameters.store, key));
  }

  try {
    return await parameters.task();
  } finally {
    for (const release of releases.reverse()) {
      await release();
    }
  }
}

async function acquireLock(
  store: Store.Store,
  key: string,
): Promise<() => Promise<void>> {
  const lockCapableStore = store as LockCapableStore;
  if (typeof lockCapableStore.acquireLock === "function") {
    const release = await lockCapableStore.acquireLock(key);
    return async () => {
      if (typeof release === "function") {
        await release();
      }
    };
  }

  const release = await acquireLocalLock(store as object, key);
  return async () => {
    release();
  };
}

async function acquireLocalLock(
  owner: object,
  key: string,
): Promise<() => void> {
  let locks = localStoreLocks.get(owner);
  if (!locks) {
    locks = new Map<string, Promise<void>>();
    localStoreLocks.set(owner, locks);
  }

  while (locks.has(key)) {
    await locks.get(key);
  }

  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, pending);

  return () => {
    if (locks?.get(key) === pending) {
      locks.delete(key);
    }
    release?.();
  };
}
