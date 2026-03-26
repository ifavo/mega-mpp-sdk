import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createFileStore } from "./store.js";

describe("demo file store", () => {
  it("persists replay markers across store instances", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "mega-mpp-demo-store-"),
    );
    const filePath = path.join(directory, "store.json");
    const challengeKey = "megaeth:charge:challenge:demo-1";

    const firstStore = createFileStore(filePath);
    await firstStore.put(challengeKey, true);

    const secondStore = createFileStore(filePath);
    await expect(secondStore.get(challengeKey)).resolves.toBe(true);
  });
});
