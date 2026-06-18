# Contributing

## Runtime Baseline

- Runtime and package manager: Bun.
- Language: TypeScript with `strict` enabled.
- Formatter and linter: Biome.

## Commands

- `bun run check` validates formatting and lint rules.
- `bun run typecheck` runs TypeScript in no-emit mode.
- `bun run test` runs unit tests with Bun's built-in test runner.
- `bun run changeset` creates a release note entry under `.changeset/`.
- `bun run changeset:status` shows pending release entries.
- `bun run changeset:version` consumes pending entries, bumps package versions, and updates `CHANGELOG.md`.

Run all three before opening a PR.

## Conventions

- Prefer small modules with one clear responsibility.
- Keep CLI orchestration separate from pure data logic.
- Put side effects at the edges: S3, DuckDB, filesystem, prompts.
- Add tests for pure functions and for bug fixes that can be reproduced without network access.
- When behavior depends on precedence, encode that precedence in tests.
- Avoid placeholder implementations on exported code paths. If a path is not ready, fail explicitly.

## Tests

- Place tests under `tests/` unless keeping them next to a tightly scoped module is clearer.
- Prefer deterministic unit tests over integration tests that depend on S3 or the release website.
- Mock boundaries rather than the whole module graph when possible.

## Changesets

Use Changesets for any change that should appear in the next published release.

Create an entry:

```bash
bun run changeset
```

Then:

- Select `@saanseoi/overturist`.
- Choose the semver bump type: `patch`, `minor`, or `major`.
- Write a short user-facing summary. Keep it concise and describe the shipped behavior, not the implementation details.

This creates a Markdown file under [`.changeset/`](./.changeset) that should be committed with the code change.

When preparing a release, combine the pending entries into a version bump and changelog update with:

```bash
bun run changeset:version
```

That command updates [`package.json`](./package.json), rewrites [`CHANGELOG.md`](./CHANGELOG.md), and removes the consumed entry files. The full release sequence is documented in [`docs/release.md`](./docs/release.md).
