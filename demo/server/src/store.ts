import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type StoreLike = {
  delete: <key extends string>(key: key) => Promise<void>;
  get: <key extends string>(key: key) => Promise<unknown | null>;
  put: <key extends string>(key: key, value: unknown) => Promise<void>;
};

type SerializedStoreState = Record<string, string>;

export function createFileStore(filePath: string): StoreLike {
  let pending = Promise.resolve();

  async function withFileLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = pending;
    let release: (() => void) | undefined;
    pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release?.();
    }
  }

  return {
    async delete(key) {
      await withFileLock(async () => {
        const state = await readState(filePath);
        delete state[key];
        await writeState(filePath, state);
      });
    },
    async get(key) {
      return await withFileLock(async () => {
        const state = await readState(filePath);
        const raw = state[key];
        return raw === undefined ? null : JSON.parse(raw);
      });
    },
    async put(key, value) {
      await withFileLock(async () => {
        const state = await readState(filePath);
        state[key] = JSON.stringify(value);
        await writeState(filePath, state);
      });
    },
  };
}

export function getDefaultDemoStorePath(): string {
  return path.join(process.cwd(), ".mega-mpp-demo-store.json");
}

async function readState(filePath: string): Promise<SerializedStoreState> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as SerializedStoreState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }
}

async function writeState(
  filePath: string,
  state: SerializedStoreState,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state), "utf8");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
