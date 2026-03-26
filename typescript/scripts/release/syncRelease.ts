import { readFile, writeFile } from "node:fs/promises";

import {
  assertChangelogVersionMissing,
  changelogPath,
  defaultRepositorySlug,
  packageJsonPath,
  parseReleaseTag,
  prependChangelogEntry,
  releaseUrlForTag,
  renderChangelogEntry,
  updatePackageManifestVersion,
} from "./shared.js";

async function main(): Promise<void> {
  const tagName = process.argv[2] ?? process.env.GITHUB_REF_NAME;
  const releaseNotesPath = process.argv[3] ?? process.env.RELEASE_NOTES_FILE;
  const releaseDate =
    process.argv[4] ??
    process.env.RELEASE_DATE ??
    new Date().toISOString().slice(0, 10);

  if (!tagName) {
    throw new Error(
      "Provide the release tag like v0.3.0 so the sync step can update package.json and CHANGELOG.md.",
    );
  }

  if (!releaseNotesPath) {
    throw new Error(
      "Provide a release notes file path so the sync step can copy the GitHub release notes into CHANGELOG.md.",
    );
  }

  const { version } = parseReleaseTag(tagName);
  const repositorySlug = process.env.GITHUB_REPOSITORY ?? defaultRepositorySlug;
  const [currentManifestText, currentChangelogText, releaseNotesText] =
    await Promise.all([
      readFile(packageJsonPath, "utf8"),
      readFile(changelogPath, "utf8"),
      readFile(releaseNotesPath, "utf8"),
    ]);

  assertChangelogVersionMissing(currentChangelogText, version);

  const updatedManifestText = updatePackageManifestVersion(
    currentManifestText,
    version,
    packageJsonPath,
  );
  const changelogEntryText = renderChangelogEntry({
    version,
    releaseDate,
    releaseNotes: releaseNotesText,
    releaseUrl: releaseUrlForTag(repositorySlug, tagName),
  });
  const updatedChangelogText = prependChangelogEntry(
    currentChangelogText,
    changelogEntryText,
  );

  await Promise.all([
    writeFile(packageJsonPath, updatedManifestText, "utf8"),
    writeFile(changelogPath, updatedChangelogText, "utf8"),
  ]);

  console.log(`Synced ${packageJsonPath} and ${changelogPath} for ${tagName}.`);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "The release sync step failed.";
  console.error(message);
  process.exitCode = 1;
});
