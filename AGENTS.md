# Repository Guidelines

## Project Structure & Module Organization

Overturist is a TypeScript CLI tool that downloads and processes geospatial data from the Overture Maps Foundation's S3 bucket. `overturist.ts` is the Bun CLI entrypoint. The architecture follows a modular design with clear separation of concerns:

- **overturist.ts** - Main entry point that orchestrates the data extraction workflow
- **libs/core/** - Shared configuration, args, filesystem helpers, types, validation, and utilities
- **libs/data/** - Cache access, S3 integration, release metadata, DuckDB queries, and web scraping
- **libs/workflows/** - Interactive, non-interactive, division, processing, info, settings, and theme workflows
- **libs/ui/** - CLI menus, prompts, progress rendering, and formatting helpers
- **tests/** - Unit tests plus workflow suites for higher-level orchestration paths

## Build, Test, and Development Commands
Use Bun for local work:

- `bun overturist.ts` runs the interactive CLI.
- `bun overturist.ts get --division <id>` runs the non-interactive download path.
- `bun run typecheck` runs `tsc --noEmit`.
- `bun run test` runs the unit test suite.
- `bun run lint` runs Biome lint rules.
- `bun run check` runs Biome’s formatter, linter, and assists in check mode.
- `bun run format` applies project formatting.

Run `bun install` after dependency changes.

### Data Processing Pipeline

The tool follows a two-stage filtering process:

1. **Initialization**: Sets up the release context, validates the mapping, initializes the output directory structure.
2. **Bounding Box Filter**: Downloads Parquet files from S3 and filters by geographic coordinates using DuckDB spatial queries
3. **Geometry Filter**: Further refines results using administrative division boundaries (if DIVISION_ID is configured)

### Key Data Flow

1. Configuration loaded from environment variables (.env file)
2. Release context determined (current or historical version)
3. Feature types and theme mapping established
4. Output directory structure created based on country code and release version
5. For each feature type:
   - Skip/replace/abort based on existing file strategy
   - Apply bounding box filter using DuckDB spatial queries
   - Apply geometry filter if division ID is configured
   - Display progress with diff against previous release
   - Save filtered data as compressed Parquet files

### Configuration Management

Configuration is handled through:

- Environment variables (.env file) for geographic settings
- Default values in libs/config.ts for output directories and URLs
- Command-line arguments for existing file handling and release selection

### Dependencies

- **DuckDB**: Primary query engine with spatial extensions for geospatial filtering
- **AWS SDK**: S3 client for accessing Overture Maps data
- **Clack Prompts**: Interactive CLI components
- **Biome**: Code formatting and linting
- **Cheerio**: HTML parsing for release calendar scraping
- **Kleur**: Terminal color formatting

### Output Structure

Data is organized as: `./data/{release_version}/{hierarchy...}/{feature_type}[.{spatialSuffix}].parquet`

Spatially specific filenames are required so different frame, predicate, and geometry strategies never collide:

- `world` -> `{featureType}.parquet`
- bounded outputs -> `{featureType}.{frame}.{predicate}.{geometry}.parquet`

The tool maintains a `releases.json` file with cached release metadata and provides diff calculations between consecutive releases.

## Coding Style
- Formatter/linter: Biome (`biome.json`).
- Indentation: 2 spaces; line width: 88; LF endings.
- JavaScript/TypeScript style: single quotes, only use semicolons when needed.
- Prefer small, single-purpose modules under `libs/`.
- Use `camelCase` for variables and functions, `PascalCase` for types and interfaces, and descriptive file names such as `releases.ts` or `divisions.ts`.
- Keep CLI-facing strings concise and operational.

### Comments
- ALWAYS preserve existing comments when editing code; update wording if behavior changes instead of deleting useful context.
- ALWAYS use standard JSDoc for exported functions: include `@param`, `@returns`, and `@remarks` where behavior constraints matter.
- For service modules and route modules:
  - ALWAYS add JSDoc to exported functions and non-trivial file-local helpers.
  - ALWAYS add a concise one-line comment immediately above the block of a complex operation so the intent is scannable before reading the implementation.

## Testing Guidelines
Use `bun run test`, `bun run typecheck`, and `bun run check` for routine validation. Then smoke-test the affected CLI path, for example `bun overturist.ts --help` or a scoped `get` command against a known division. Place unit tests under `tests/` unless a module-local test is clearer.

When changing output semantics, cache layout, spatial filtering behavior, or file naming:

- Add or update tests for the low-level helper that constructs filenames or paths.
- Add or update at least one workflow-facing test that proves skip/replace/existing-file behavior still uses the same naming rule.
- Treat frame, predicate, and geometry changes as output-shape changes. A changed spatial mode must not reuse an old filename silently.
- Prefer targeted test runs while iterating, but finish with the narrowest high-signal suite that covers the touched workflow plus `bun run typecheck`.

## Commit & Pull Request Guidelines
Follows Conventional Commit prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, and `chore:`. Keep commits focused and imperative, for example `fix: validate bbox parsing`. Pull requests should explain the user-visible change, list validation commands run, note config or data impacts, and include screenshots or terminal output only when the CLI UX changed.

## Configuration & Data Notes
Project configuration is environment-driven via `.env`; use `.env.example` as the source of truth for new keys. Do not commit secrets, downloaded datasets, or cache artifacts unless the change explicitly requires fixture data.
