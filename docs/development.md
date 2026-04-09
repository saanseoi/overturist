# Development Notes

## Local setup

```bash
git clone git@github.com:saanseoi/overturist.git
cd overturist
bun install
```

## Common commands

```bash
bun run typecheck
bun run test
bun run lint
bun run check
bun run format
```

## Project structure

- `overturist.ts`: CLI entrypoint
- `libs/core/`: config, args, filesystem helpers, shared types, validation
- `libs/data/`: cache, S3 access, releases, queries, DuckDB integration
- `libs/workflows/`: interactive, non-interactive, division, info, processing
- `libs/ui/`: menus, prompts, progress, and formatting helpers
- `tests/`: unit tests and workflow suites

## Notes

- Bun is the supported runtime for local development.
- The published npm package is currently limited to Linux x64 because of the
  DuckDB binding package in use.
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution workflow details.
