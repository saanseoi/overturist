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

1. Clone the repository:

```bash
git clone git@github.com:saanseoi/overturist.git
cd overturist
```

2. Install dependencies:

```bash
bun install
```

## Usage

Overturist supports two distinct modes:

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

**Key difference**: `get` command runs without further user input, and requires the relevant division to be provided as an option (`-d`) or env variable (`DIVISION_ID`).

### Command Line Options

#### Download Options
| Option       | Alias | Description                                               |
| ------------ | ----- | --------------------------------------------------------- |
| `--release`  | `-r`  | Download specific release version (e.g., 2025-10-22.0)    |
| `--theme`    | `-T`  | Download only specific themes (repeatable)                 |
| `--type`     | `-t`  | Download only specific feature types (repeatable)          |

#### Geographic Selection
| Option       | Alias | Description                                               |
| ------------ | ----- | --------------------------------------------------------- |
| `--division` | `-d`  | Filter results by division's boundaries                    |
| `--bbox`     | `-b`  | Filter results by bounding box (e.g., -71.068,42.353,-71.058,42.363) |

#### File Handling
| Option       | Alias | Description                                               |
| ------------ | ----- | --------------------------------------------------------- |
| `--skip`     | -     | Skip existing files and download missing ones (default)   |
| `--replace`  | -     | Replace existing files with fresh downloads               |
| `--abort`    | -     | Exit if existing files are found                          |

#### Help
| Option       | Alias | Description                                               |
| ------------ | ----- | --------------------------------------------------------- |
| `--examples` | `-x`  | Show detailed usage examples                              |
| `--help`     | `-h`  | Show help message                                         |

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
bun overturistist get --division <id>

# Download specific theme
bun overturistist get --division <id> --theme buildings

# Download with specific release
bun overturistist get --division <id> --release 2025-10-22.0

# Replace existing files
bun overturistist get --division <id> --replace

# Download within bounding box
bun overturistist get --division <id> --bbox -71.068,42.353,-71.058,42.363

# Complex example with multiple options
bun overturistist get \
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
bun overturist.ts --get --division <id> --theme buildings

# Priority 2: Environment variables (.env file)
# DIVISION_ID="b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d"
# FEATURE_TYPES="building,address"
# ON_FILE_EXISTS="replace"

# Priority 3: Default values
# OnFileExists="skip", Release="latest"
```

### Interactive Mode

When run without command-line options, Overturist enters interactive mode with a main menu:

- **Download latest**: Downloads the most recent Overture Maps release using current configuration
- **Repeat a search**: Browse and re-run previous administrative division searches (shows only when search history exists)
- **Download historic**: Select and download from available historical releases (last 60 days)
- **Settings**: Manage preferences and cache (show current config, reset preferences, view cache stats, purge cache)
- **Exit**: Quit the application

The interactive mode is ideal for exploratory use cases where you want to search for specific administrative divisions or browse available releases before downloading.

## Development

### Scripts

- `bun run typecheck` - Run TypeScript type checking
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
│   ├── init.ts     # Initialization logic
│   ├── processing.ts # Data processing
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

## Configuration

The tool reads configuration from multiple sources (in order of priority):

1. **Command-line options** (highest priority):
   - `--division`: Override division ID for the target region
   - `--bbox`: Override bounding box coordinates (format: xmin,ymin,xmax,ymax)

2. **Environment variables** (via `.env` file):
   - `DIVISION_ID`: Overture Maps division ID for the target region
   - `BBOX_XMIN`, `BBOX_XMAX`, `BBOX_YMIN`, `BBOX_YMAX`: Bounding box coordinates (optional - can be set via interactive search)

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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run the linter and type checker
5. Submit a pull request

## Support

For issues and questions, please open an issue on the repository.
