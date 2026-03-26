# Releasing `@moldy/mega-mpp-sdk`

The npm package is published from GitHub tags in `ifavo/mega-mpp-sdk`.

## One-Time Setup

1. Create the npm package under the `@moldy` scope.
2. In npm trusted publishers, add GitHub Actions for:
   - owner: `ifavo`
   - repository: `mega-mpp-sdk`
   - workflow filename: `release.yml`
3. Keep the workflow on GitHub-hosted runners. Trusted publishing does not work from self-hosted runners.
4. Keep the publish job on Node `22.14+`. The checked-in workflow uses Node `24` so npm trusted publishing can exchange the GitHub OIDC token correctly.

## Release Flow

1. Merge the release-ready changes to `main`.
2. Confirm CI is green.
3. Push a stable tag in the form `vX.Y.Z`.

```bash
git tag v0.3.0
git push origin v0.3.0
```

The release workflow then:

- validates the tag format
- installs dependencies and reruns the full release gate
- publishes `typescript/packages/mpp` to npm with trusted publishing
- creates a GitHub Release with generated notes
- opens a follow-up PR that syncs `typescript/packages/mpp/package.json` and `typescript/packages/mpp/CHANGELOG.md` back to `main`

Merge the follow-up PR after the release job succeeds so the repository version matches the published package.

## Failure Recovery

- If the workflow says the version already exists on npm, push a new `vX.Y.Z` tag instead of reusing the old one.
- If npm authentication fails, verify the trusted publisher entry matches `release.yml` exactly, including case and file extension.
- If the sync PR step fails after npm publish succeeds, create the changelog/version PR manually from the workflow branch noted in the job logs.
