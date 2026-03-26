import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

export const packageName = "@moldy/mega-mpp-sdk";
export const defaultRepositorySlug = "ifavo/mega-mpp-sdk";

export const typescriptRootPath = resolve(process.cwd());
export const packageDirectoryPath = resolve(typescriptRootPath, "packages/mpp");
export const packageJsonPath = resolve(packageDirectoryPath, "package.json");
export const changelogPath = resolve(packageDirectoryPath, "CHANGELOG.md");

const releaseTagPattern = /^v(\d+\.\d+\.\d+)$/;

export interface ParsedReleaseTag {
  tagName: string;
  version: string;
}

export interface PackageManifest {
  name: string;
  version: string;
  [key: string]: unknown;
}

interface NpmPackFileEntry {
  path: string;
}

interface NpmPackSummary {
  name: string;
  version: string;
  files: NpmPackFileEntry[];
}

export interface RenderChangelogEntryOptions {
  version: string;
  releaseDate: string;
  releaseUrl: string;
  releaseNotes: string;
}

export function parseReleaseTag(tagName: string): ParsedReleaseTag {
  const match = releaseTagPattern.exec(tagName);

  if (!match) {
    throw new Error(
      `Release tags must use the form vX.Y.Z. Push a tag like v0.3.0 instead of "${tagName}".`,
    );
  }

  const version = match[1];

  if (!version) {
    throw new Error(
      `Release tags must include a semantic version after the v prefix. Push a tag like v0.3.0 instead of "${tagName}".`,
    );
  }

  return {
    tagName,
    version,
  };
}

export function parsePackageManifest(
  sourceText: string,
  filePath = "package.json",
): PackageManifest {
  const parsedValue: unknown = JSON.parse(sourceText);

  if (
    !parsedValue ||
    typeof parsedValue !== "object" ||
    Array.isArray(parsedValue)
  ) {
    throw new Error(
      `${filePath} must contain a JSON object before the release workflow can update the package version.`,
    );
  }

  const manifest = parsedValue as PackageManifest;

  if (
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(
      `${filePath} must include string "name" and "version" fields before the release workflow can continue.`,
    );
  }

  return manifest;
}

export function updatePackageManifestVersion(
  sourceText: string,
  version: string,
  filePath = "package.json",
): string {
  const manifest = parsePackageManifest(sourceText, filePath);

  manifest.version = version;

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseNpmPackSummary(sourceText: string): NpmPackSummary {
  const parsedValue: unknown = JSON.parse(sourceText);

  if (!Array.isArray(parsedValue) || parsedValue.length !== 1) {
    throw new Error(
      "npm pack --json --dry-run must return exactly one package summary before the release workflow can validate the tarball.",
    );
  }

  const [summary] = parsedValue;

  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    typeof summary.name !== "string" ||
    typeof summary.version !== "string" ||
    !Array.isArray(summary.files)
  ) {
    throw new Error(
      "npm pack --json --dry-run returned an unexpected payload. Update the tarball validation script before releasing.",
    );
  }

  return summary as NpmPackSummary;
}

export function validateTarballFileList(filePaths: readonly string[]): void {
  const requiredPaths = [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ];
  const exactAllowedPaths = new Set([
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]);

  const missingPaths = requiredPaths.filter(
    (filePath) => !filePaths.includes(filePath),
  );

  if (missingPaths.length > 0) {
    throw new Error(
      `The npm tarball is missing ${missingPaths.join(
        ", ",
      )}. Build the package and keep the package-local docs checked in before publishing.`,
    );
  }

  const unexpectedPaths = filePaths.filter(
    (filePath) =>
      !filePath.startsWith("dist/") && !exactAllowedPaths.has(filePath),
  );

  if (unexpectedPaths.length > 0) {
    throw new Error(
      `The npm tarball includes unexpected files: ${unexpectedPaths.join(
        ", ",
      )}. Restrict published files to dist output plus README.md, CHANGELOG.md, LICENSE, and package.json.`,
    );
  }
}

export function renderChangelogEntry({
  version,
  releaseDate,
  releaseUrl,
  releaseNotes,
}: RenderChangelogEntryOptions): string {
  const trimmedNotes = releaseNotes.trim();
  const notesBlock =
    trimmedNotes.length > 0
      ? trimmedNotes
      : "- GitHub did not generate release notes for this tag.";

  return [
    `## ${version} - ${releaseDate}`,
    "",
    `[GitHub release](${releaseUrl})`,
    "",
    notesBlock,
    "",
  ].join("\n");
}

export function assertChangelogVersionMissing(
  changelogText: string,
  version: string,
): void {
  const versionHeadingPattern = new RegExp(
    `^## ${escapeForRegExp(version)}(?:\\s|$)`,
    "m",
  );

  if (versionHeadingPattern.test(changelogText)) {
    throw new Error(
      `CHANGELOG.md already contains version ${version}. Remove the duplicate entry or publish a new tag before retrying.`,
    );
  }
}

export function prependChangelogEntry(
  changelogText: string,
  entryText: string,
): string {
  const normalizedChangelog = changelogText.trimEnd();
  const normalizedEntry = entryText.trim();
  const firstReleaseHeadingIndex = normalizedChangelog.indexOf("\n## ");

  if (firstReleaseHeadingIndex === -1) {
    return `${normalizedChangelog}\n\n${normalizedEntry}\n`;
  }

  const beforeEntries = normalizedChangelog
    .slice(0, firstReleaseHeadingIndex)
    .trimEnd();
  const afterEntries = normalizedChangelog
    .slice(firstReleaseHeadingIndex + 1)
    .trimStart();

  return `${beforeEntries}\n\n${normalizedEntry}\n\n${afterEntries}\n`;
}

export function releaseTitleForVersion(version: string): string {
  return `${packageName} v${version}`;
}

export function releaseUrlForTag(
  repositorySlug: string,
  tagName: string,
): string {
  return `https://github.com/${repositorySlug}/releases/tag/${encodeURIComponent(tagName)}`;
}

export async function appendGithubOutputs(
  values: Record<string, string>,
): Promise<void> {
  const githubOutputPath = process.env.GITHUB_OUTPUT;

  if (!githubOutputPath) {
    return;
  }

  const outputLines = Object.entries(values).map(
    ([key, value]) => `${key}=${value}`,
  );

  await appendFile(githubOutputPath, `${outputLines.join("\n")}\n`, "utf8");
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
