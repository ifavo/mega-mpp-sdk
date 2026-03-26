import { readFile, writeFile } from "node:fs/promises";

import {
  appendGithubOutputs,
  packageJsonPath,
  parseReleaseTag,
  releaseTitleForVersion,
  updatePackageManifestVersion,
} from "./shared.js";

async function main(): Promise<void> {
  const tagName = process.argv[2] ?? process.env.GITHUB_REF_NAME;

  if (!tagName) {
    throw new Error(
      "Provide a release tag like v0.3.0 so the workflow can set the package version before publishing.",
    );
  }

  const { version } = parseReleaseTag(tagName);
  const currentManifestText = await readFile(packageJsonPath, "utf8");
  const updatedManifestText = updatePackageManifestVersion(
    currentManifestText,
    version,
    packageJsonPath,
  );

  await writeFile(packageJsonPath, updatedManifestText, "utf8");
  await appendGithubOutputs({
    release_tag: tagName,
    release_title: releaseTitleForVersion(version),
    version,
  });

  console.log(`Prepared ${packageJsonPath} for ${tagName}.`);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "The release preparation step failed.";
  console.error(message);
  process.exitCode = 1;
});
