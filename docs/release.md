# Release Process

This document describes how to cut and publish a new `overturist` release.

## Release Targets

Each release has two public outputs:

- GitHub release: <https://github.com/saanseoi/overturist/releases>
- npm package: <https://www.npmjs.com/package/@saanseoi/overturist>

## Pre-flight

Before starting a release:

- Make sure the working tree is clean.
- Make sure you are on the branch you want to release from.
- Make sure `bun install` has been run if dependencies changed.
- Confirm the intended version is not already tagged:

```bash
git tag --list
```

## Release Checklist

### 1. Update the version

Bump the version in `package.json`.

For `v0.1.2`, the package version should be:

```json
"version": "0.1.2"
```

### 2. Update the changelog

Add a new section at the top of [`CHANGELOG.md`](../CHANGELOG.md) using the next released version and release date.

Example for `v0.1.2`:

```md
## 0.1.2 - 2026-05-27

- Update dependencies
- Fix compatibility with Bun v1.3.14
```

Keep the changelog concise and user-facing.

### 3. Validate the release candidate

Run the standard checks:

```bash
bun run typecheck
bun run test
bun run check
```

Then run a quick CLI smoke test:

```bash
bun overturist.ts --help
```

If the release changes runtime compatibility, also test the affected flow directly.

### 4. Commit the release

Create a release commit with a conventional message:

```bash
git add package.json CHANGELOG.md
git add docs/release.md README.md
git commit -m "chore: release v0.1.2"
```

If other files are part of the release, include them in the same commit.

### 5. Create the git tag

Create an annotated tag that matches the npm/GitHub release version:

```bash
git tag -a v0.1.2 -m "v0.1.2"
```

### 6. Publish to npm

Run a dry run first:

```bash
bun run publish:dry-run
```

If the package contents look correct, publish:

```bash
npm publish --access public
```

### 7. Push commit and tag

```bash
git push origin <branch-name>
git push origin v0.1.2
```

### 8. Publish the GitHub release

Open <https://github.com/saanseoi/overturist/releases> and create a new release from tag `v0.1.2`.

Use the tag title:

```text
v0.1.2
```

Suggested release notes:

```md
## Changes

- chore: update dependencies
- fix: compatibility with Bun v1.3.14
```

Then publish the release.

## Post-release Verification

After publishing:

- Confirm the GitHub release is visible with the expected notes.
- Confirm the npm package page shows `0.1.2`.
- Verify installability:

```bash
bunx @saanseoi/overturist --help
```

## Notes

- Git tags use the `v` prefix, for example `v0.1.2`.
- `CHANGELOG.md` entries use the plain semver number, for example `0.1.2`.
- The npm package is currently published as `@saanseoi/overturist`.
