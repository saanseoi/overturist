# Release Process

This document describes how to manage release notes with Changesets and publish a new `overturist` release.

## Release Targets

Each release has two public outputs:

- GitHub release: <https://github.com/saanseoi/overturist/releases>
- npm package: <https://www.npmjs.com/package/@saanseoi/overturist>

## Changeset Workflow

Contributors should create a changeset whenever a merged change should appear in the next published release.

Create an entry:

```bash
bun run changeset
```

Then:

- Select `@saanseoi/overturist`.
- Choose the semver bump type: `patch`, `minor`, or `major`.
- Write a short user-facing summary.

Commit the generated Markdown file under [`.changeset/`](../.changeset). Multiple PRs can contribute changesets independently; the next release combines all pending entries.

Useful commands:

```bash
bun run changeset
bun run changeset:status
bun run changeset:version
```

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

### 1. Review pending changesets

Inspect the queued release entries:

```bash
bun run changeset:status
```

Make sure the pending summaries and bump types match the release you intend to cut.

### 2. Generate the release version and changelog

Combine all pending changesets into a version bump and changelog update:

```bash
bun run changeset:version
```

This updates:

- [`package.json`](../package.json)
- [`CHANGELOG.md`](../CHANGELOG.md)

It also removes the consumed `.changeset/*.md` entry files.

### 3. Review the generated release files

Check that:

- `package.json` has the expected new semver version.
- `CHANGELOG.md` is concise and user-facing.
- No unrelated changes were pulled into the release commit.

### 4. Validate the release candidate

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

### 5. Commit the release

Create a release commit with a conventional message:

```bash
git add package.json CHANGELOG.md bun.lock
git commit -m "chore: release v0.1.4"
```

If other files are part of the release, include them in the same commit.

### 6. Create the git tag

Create an annotated tag that matches the npm/GitHub release version:

```bash
git tag -a v0.1.4 -m "v0.1.4"
```

### 7. Publish to npm

Run a dry run first:

```bash
bun run publish:dry-run
```

If the package contents look correct, publish:

```bash
npm publish --access public
```

### 8. Push commit and tag

```bash
git push origin <branch-name>
git push origin v0.1.4
```

### 9. Publish the GitHub release

Open <https://github.com/saanseoi/overturist/releases> and create a new release from the new tag.

Use the tag title:

```text
v0.1.4
```

You can reuse the generated `CHANGELOG.md` entry as the basis for the GitHub release notes.

## Post-release Verification

After publishing:

- Confirm the GitHub release is visible with the expected notes.
- Confirm the npm package page shows the new version.
- Verify installability:

```bash
bunx @saanseoi/overturist --help
```

## Notes

- Git tags use the `v` prefix, for example `v0.1.4`.
- `CHANGELOG.md` entries use the plain semver number, for example `0.1.4`.
- The npm package is published as `@saanseoi/overturist`.
