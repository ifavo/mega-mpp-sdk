import { describe, expect, it } from "vitest";

import {
  assertChangelogVersionMissing,
  parseNpmPackSummary,
  parseReleaseTag,
  prependChangelogEntry,
  releaseTitleForVersion,
  releaseUrlForTag,
  renderChangelogEntry,
  updatePackageManifestVersion,
  validateTarballFileList,
} from "../release/shared.js";

describe("release helpers", () => {
  it("parses stable release tags", () => {
    expect(parseReleaseTag("v1.2.3")).toEqual({
      tagName: "v1.2.3",
      version: "1.2.3",
    });
  });

  it("rejects malformed release tags with an instructive error", () => {
    expect(() => parseReleaseTag("1.2.3")).toThrowError(
      'Release tags must use the form vX.Y.Z. Push a tag like v0.3.0 instead of "1.2.3".',
    );
  });

  it("updates the package version without changing other manifest fields", () => {
    const updatedManifestText = updatePackageManifestVersion(
      JSON.stringify(
        {
          description: "SDK",
          name: "@moldy/mega-mpp-sdk",
          version: "0.2.0",
        },
        null,
        2,
      ),
      "0.3.0",
    );

    expect(JSON.parse(updatedManifestText)).toEqual({
      description: "SDK",
      name: "@moldy/mega-mpp-sdk",
      version: "0.3.0",
    });
  });

  it("renders changelog entries from GitHub release notes", () => {
    expect(
      renderChangelogEntry({
        releaseDate: "2026-03-26",
        releaseNotes: "## What's Changed\n- Added release automation",
        releaseUrl: releaseUrlForTag("ifavo/mega-mpp-sdk", "v0.3.0"),
        version: "0.3.0",
      }),
    ).toContain(
      "[GitHub release](https://github.com/ifavo/mega-mpp-sdk/releases/tag/v0.3.0)",
    );
  });

  it("prepends a release entry after the changelog preamble", () => {
    const updatedChangelog = prependChangelogEntry(
      [
        "# Changelog",
        "",
        "All notable changes to `@moldy/mega-mpp-sdk` are documented in this file.",
        "",
        "## 0.2.0 - 2026-03-25",
        "",
        "- First release",
        "",
      ].join("\n"),
      ["## 0.3.0 - 2026-03-26", "", "- Added release automation"].join("\n"),
    );

    expect(updatedChangelog).toContain("## 0.3.0 - 2026-03-26");
    expect(updatedChangelog.indexOf("## 0.3.0 - 2026-03-26")).toBeLessThan(
      updatedChangelog.indexOf("## 0.2.0 - 2026-03-25"),
    );
  });

  it("rejects duplicate changelog versions", () => {
    expect(() =>
      assertChangelogVersionMissing("## 0.3.0 - 2026-03-26\n", "0.3.0"),
    ).toThrowError(
      "CHANGELOG.md already contains version 0.3.0. Remove the duplicate entry or publish a new tag before retrying.",
    );
  });

  it("accepts the intended npm tarball contents", () => {
    expect(() =>
      validateTarballFileList([
        "CHANGELOG.md",
        "LICENSE",
        "README.md",
        "dist/client/index.js",
        "dist/index.d.ts",
        "dist/index.js",
        "dist/server/index.js",
        "package.json",
      ]),
    ).not.toThrow();
  });

  it("rejects unexpected source files in the npm tarball", () => {
    expect(() =>
      validateTarballFileList([
        "CHANGELOG.md",
        "LICENSE",
        "README.md",
        "dist/index.d.ts",
        "dist/index.js",
        "package.json",
        "src/__tests__/integration.test.ts",
      ]),
    ).toThrowError(
      "The npm tarball includes unexpected files: src/__tests__/integration.test.ts. Restrict published files to dist output plus README.md, CHANGELOG.md, LICENSE, and package.json.",
    );
  });

  it("parses npm pack json output", () => {
    expect(
      parseNpmPackSummary(
        JSON.stringify([
          {
            files: [{ path: "package.json" }],
            name: "@moldy/mega-mpp-sdk",
            version: "0.3.0",
          },
        ]),
      ),
    ).toMatchObject({
      name: "@moldy/mega-mpp-sdk",
      version: "0.3.0",
    });
  });

  it("formats release titles consistently", () => {
    expect(releaseTitleForVersion("0.3.0")).toBe("@moldy/mega-mpp-sdk v0.3.0");
  });
});
