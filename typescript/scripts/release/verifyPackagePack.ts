import { execFileSync } from "node:child_process";

import {
  packageDirectoryPath,
  packageName,
  parseNpmPackSummary,
  validateTarballFileList,
} from "./shared.js";

async function main(): Promise<void> {
  const packSummaryText = execFileSync("npm", ["pack", "--json", "--dry-run"], {
    cwd: packageDirectoryPath,
    encoding: "utf8",
  });
  const packSummary = parseNpmPackSummary(packSummaryText);

  if (packSummary.name !== packageName) {
    throw new Error(
      `npm pack resolved ${packSummary.name}. Update typescript/packages/mpp/package.json so the published package name is ${packageName}.`,
    );
  }

  validateTarballFileList(packSummary.files.map((entry) => entry.path));

  console.log(
    `Verified ${packSummary.name}@${packSummary.version} tarball contents from ${packageDirectoryPath}.`,
  );
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "The npm tarball verification step failed.";
  console.error(message);
  process.exitCode = 1;
});
