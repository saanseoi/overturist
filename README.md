# Overturist

CLI to obtain Overture Maps data from S3.

![TypeScript Badge](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff&style=for-the-badge) ![Bun Badge](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=fff&style=for-the-badge) ![Biome Badge](https://img.shields.io/badge/Biome-60A5FA?logo=biome&logoColor=fff&style=for-the-badge) ![DuckDB Badge](https://img.shields.io/badge/DuckDB-FFF000?logo=duckdb&logoColor=000&style=for-the-badge)

## Overview

Overturist is a command-line tool that downloads and processes Overture Maps data for specific geographic regions. It supports filtering by the geometry of the target country, and can fetch both current and historical releases.

Note that the Overture Maps Foundation maintain a 60 day retention policy. Data older than 60 days may not be available.

## Features

- Search for the area or place you want to download (all languages supported)
- Download all, or a selection, of featureTypes
- Results can be filtered by _boundaries_ or _bounding box_
- Interactive or scripted mode
- Cached query results

## Prerequisites

- [Bun](https://bun.sh/) (recommended package manager and runtime)

## Installation

### Run Without Installing

Requires [Bun](https://bun.sh/).

```bash
bunx --package @saanseoi/overturist overturist --help
```

### Install Globally

Requires [Bun](https://bun.sh/) and is (currently) supported on Linux x64.

```bash
npm install -g @saanseoi/overturist
overturist --help
```

### Local Development

1. Clone the repository:

```bash
git clone git@github.com:saanseoi/overturist.git
cd overturist
```

2. Install dependencies:

```bash
bun install
```

## Release Status

- Package name: `@saanseoi/overturist`
- Command name: `overturist`
- Runtime requirement: Bun
- Current platform support for published package: Linux x64

The package currently depends on `@duckdb/node-bindings-linux-x64`, so npm publication is intentionally limited to Linux x64.

The published `overturist` command is a small launcher script that executes the TypeScript entrypoint with Bun.

## Usage

Overturist supports three entry modes:

### Interactive Mode (Default)

For guided use, searching administrative divisions, and browsing available releases:

```bash
bun overturist.ts
```

### Non-Interactive Mode (Scripting)

For automation, CI/CD pipelines, and scripting:

```bash
bun overturist.ts get [OPTIONS]
```

### Division Info Mode

For inspecting one division record and saving its metadata into the release hierarchy:

```bash
bun overturist.ts info [OPTIONS]
```

**Key difference**: `get` and `info` both run without further user input and require the relevant division to be provided as an Overture division id (`-d` / `DIVISION_ID`) or an OSM relation id (`--osmId`).

### Command Line Options

#### Download Options

| Option      | Alias | Description                                            |
| ----------- | ----- | ------------------------------------------------------ |
| `--release` | `-r`  | Download specific release version (e.g., 2025-10-22.0) |
| `--theme`   | `-T`  | Download only specific themes (repeatable)             |
| `--type`    | `-t`  | Download only specific feature types (repeatable)      |

#### Geographic Selection

| Option           | Alias | Description                                                                    |
| ---------------- | ----- | ------------------------------------------------------------------------------ |
| `--division`     | `-d`  | Filter results by division's boundaries using its stable Overture id           |
| `--osmId`        | -     | Resolve the division from an OSM relation id                                   |
| `--bbox`         | -     | Filter results by bounding box (e.g., -71.068,42.353,-71.058,42.363)           |
| `--frame`        | -     | Exact spatial frame for filtering: `division` or `bbox`                       |
| `--predicate`    | -     | Spatial predicate: `intersects` or `within`                                   |
| `--geometry`     | -     | Output geometry mode: `preserve`, `clip-smart`, or `clip-all`                 |

#### File Handling

| Option      | Alias | Description                                             |
| ----------- | ----- | ------------------------------------------------------- |
| `--skip`    | -     | Skip existing files and download missing ones (default) |
| `--replace` | -     | Replace existing files with fresh downloads             |
| `--abort`   | -     | Exit if existing files are found                        |

#### Help

| Option       | Alias | Description                  |
| ------------ | ----- | ---------------------------- |
| `--examples` | -     | Show detailed usage examples |
| `--help`     | `-h`  | Show help message            |

### Environment Variables

You can also configure behavior using environment variables in a `.env` file. The available variables are documented in `.env.example`.

### Examples

#### Interactive Mode Examples

```bash
# Start interactive mode
bun overturist.ts

# Show help (stays in interactive mode)
bun overturist.ts --help

# Show examples (stays in interactive mode)
bun overturist.ts --examples
```

#### Non-Interactive Mode Examples

```bash
# Basic download (requires division_id)
bun overturist.ts get --division <id>

# Inspect one division and save it to ./data/<release>/divisions/.../division.json
bun overturist.ts info --division <id>

# Download specific theme
bun overturist.ts get --division <id> --theme buildings

# Download with specific release
bun overturist.ts get --division <id> --release 2025-10-22.0

# Replace existing files
bun overturist.ts get --division <id> --replace

# Download within bounding box
bun overturist.ts get --division <id> --bbox -71.068,42.353,-71.058,42.363

# Use bbox as the exact frame and keep only features fully within it
bun overturist.ts get --bbox -71.068,42.353,-71.058,42.363 --frame bbox --predicate within

# Clip only selected large-area geometries to the active frame
bun overturist.ts get --division <id> --geometry clip-smart

# Complex example with multiple options
bun overturist.ts get \
  --division <id> \
  --theme buildings,transportation \
  --type building,segment \
  --release 2025-10-22.0 \
  --replace
```

#### Configuration Sources

The tool reads configuration from multiple sources (in order of priority):

```bash
# Priority 1: CLI arguments (highest)
bun overturist.ts get --division <id> --theme buildings

# Priority 2: Environment variables (.env file)
# DIVISION_ID="b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d"
# FEATURE_TYPES="building,address"
# SPATIAL_FRAME="division"
# SPATIAL_PREDICATE="intersects"
# SPATIAL_GEOMETRY="clip-smart"
# CONFIRM_FEATURE_SELECTION=true
# ON_FILE_EXISTS="replace"

# Priority 3: Default values
# OnFileExists="skip", Release="latest"
```

### Interactive Mode

When run without command-line options, Overturist enters interactive mode with a main menu:

- **Download data**: Opens a second-level menu for downloading data
- **Get division details**: Saves one division record into `./data` and prints it with formatting
- **Settings**: Manage preferences and cache (show current config, reset preferences, view cache stats, purge cache)
- **Exit**: Quit the application

The download menu offers:

- **Search**: Opens a third-level menu with `New search` and `Repeat a search`
- **Provide an OSM Id**: Resolve an OSM relation id directly
- **The whole world**: Download the full world dataset

The interactive mode is ideal for exploratory use cases where you want to search for specific administrative divisions or browse available releases before downloading.

If you preselect feature types with `--type`, `--theme`, or `FEATURE_TYPES`, interactive mode will ask you to confirm that selection by default. Set `CONFIRM_FEATURE_SELECTION=false` to accept the preselection without the confirmation prompt. Programmatic `get` commands do not prompt for feature confirmation.

## Development

### Scripts

- `bun run typecheck` - Run TypeScript type checking
- `bun run test` - Run the unit test suite with Bun's built-in test runner
- `bun run test:watch` - Re-run tests in watch mode
- `bun run lint` - Run Biome linter
- `bun run lint:fix` - Fix linting issues automatically
- `bun run format` - Format code with Biome
- `bun run format:check` - Check code formatting
- `bun run check` - Run all Biome checks
- `bun run check:fix` - Fix all Biome issues automatically

### Project Structure

```
overturist/
├── libs/           # Utility modules
│   ├── args.ts     # Command-line argument parsing
│   ├── config.ts   # Configuration management
│   ├── get.ts      # Non-interactive workflow orchestration
│   ├── interactive.ts # Interactive menu orchestration
│   ├── processing.ts # Data processing
│   ├── queries.ts  # DuckDB-backed S3 query helpers
│   ├── releases.ts # Release selection and metadata
│   ├── s3.ts       # S3 listing and download helpers
│   ├── types.ts    # TypeScript type definitions
│   └── ui.ts       # User interface helpers
├── data/           # Output directory for downloaded data
├── overturist.ts   # Main entry point
├── .env.example    # Example environment configuration
└── README.md       # This file
```

## Output

Downloaded data is saved as `parquet` files in the `./data/` directory organized by:

- Release version
- Division Hierachy (e.g. country, region, locality etc)
- Feature type

The tool handles file conflicts based on the selected strategy.

The `info` command saves a single division record as `division.json` inside the same release and division hierarchy.

## Configuration

**See `--help` for available options**. The tool reads configuration from multiple sources (in order of priority):

1. **Command-line options** (highest priority):
   - `--division`: Override division ID for the target region
   - `--osmId`: Resolve the target region from an OSM relation id
   - `--bbox`: Override bounding box coordinates (format: xmin,ymin,xmax,ymax)
   - `--frame`: Choose the exact spatial frame (`division` or `bbox`)
   - `--predicate`: Choose the exact spatial predicate (`intersects` or `within`)
   - `--geometry`: Choose the output geometry mode (`preserve`, `clip-smart`, or `clip-all`)

2. **Environment variables** (via `.env` file):
   - `DIVISION_ID`: Overture Maps division ID for the target region
   - `BBOX_XMIN`, `BBOX_XMAX`, `BBOX_YMIN`, `BBOX_YMAX`: Bounding box coordinates (optional - can be set via interactive search)
    - `SPATIAL_FRAME`: Exact spatial frame (`division` or `bbox`)
    - `SPATIAL_PREDICATE`: Exact spatial predicate (`intersects` or `within`)
    - `SPATIAL_GEOMETRY`: Output geometry mode (`preserve`, `clip-smart`, or `clip-all`)

3. **Default settings** in `libs/config.ts`:
   - Output directory: `./data`
   - Release metadata file: `releases.json`
   - Release calendar URL: [Overture Maps official release calendar](https://docs.overturemaps.org/release-calendar/)

**Note**: Bounding box configuration is optional. If not provided via environment variables or CLI options, you can search for administrative divisions interactively and the tool will use the division's boundaries.

## Caching

Overturist uses a `.cache/` directory to store:

- **Division records**: `.cache/{version}/division/{id}.json` - Stores division data per version to avoid re-downloading the same division data
- **Search history**: `.cache/{version}/search/{adminLevel}/{term}.json` - Caches administrative division search results with timestamps for quick access
- **Themes**: `.cache/{version}/theme_mapping.json` - Caches theme mappings for each release version
- **Release metadata**: `.cache/releases.json` - Caches available release versions from S3

The cache is version-specific, ensuring data integrity across different Overture releases while improving performance for repeated downloads. Search history enables quick repetition of previous administrative division searches without re-querying the S3 data (which is slow!).

## Theme and Type Filtering

OMF partitions the data by [themes and feature types](https://docs.overturemaps.org/guides/). Overturist supports filters by

- **Themes**: High-level categories like `buildings`, `transportation`, `places`, etc.
- **Types**: Specific feature types like `building`, `address`, `segment`, etc.

When both `--theme` and `--type` options are provided, the tool downloads the union of matching feature types. Invalid themes or types will trigger an automatic refresh of the theme mapping from S3 to ensure the most current schema is used.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Roadmap to V1

- [ ] Select Themes interactively
- [ ] Download the whole world

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run the linter and type checker
5. Submit a pull request

## Support

For issues and questions, please open an issue on the repository.
