# Contributing

## Runtime Baseline

- Runtime and package manager: Bun.
- Language: TypeScript with `strict` enabled.
- Formatter and linter: Biome.

## Commands

- `bun run check` validates formatting and lint rules.
- `bun run typecheck` runs TypeScript in no-emit mode.
- `bun run test` runs unit tests with Bun's built-in test runner.

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
