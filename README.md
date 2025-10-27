# Overturist

CLI to obtain Overture Maps data from S3.

![TypeScript Badge](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff&style=for-the-badge) ![Bun Badge](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=fff&style=for-the-badge) ![Biome Badge](https://img.shields.io/badge/Biome-60A5FA?logo=biome&logoColor=fff&style=for-the-badge) ![DuckDB Badge](https://img.shields.io/badge/DuckDB-FFF000?logo=duckdb&logoColor=000&style=for-the-badge)

## Overview

Overturist is a command-line tool that downloads and processes Overture Maps data for specific geographic regions. It supports filtering by the geometry of the target country, and can fetch both current and historical releases.

Note that the Overture Maps Foundation maintain a 60 day retention policy. Data older than 60 days may not be available.

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

## Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit the `.env` file with your desired configuration:

```bash
# Region code for output directory structure
COUNTRY_CODE="hk"

# Bounding box coordinates for your target area
BBOX_XMIN=113.77
BBOX_XMAX=114.57
BBOX_YMIN=22.08
BBOX_YMAX=22.63

# Division ID for the specific region (check release for valid IDs)
DIVISION_ID="b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d"
```

## Usage

### Basic Usage

Run the tool interactively:

```bash
bun overturist.ts
```

### Command Line Options

| Option       | Alias | Description                                               |
| ------------ | ----- | --------------------------------------------------------- |
| `--skip`     | -     | Skip existing files and download missing ones (default)   |
| `--override` | -     | Replace existing files with fresh downloads               |
| `--abort`    | -     | Exit the script if existing files are found               |
| `--historic` | -     | Select a specific release version from available versions |
| `--help`     | `-h`  | Show help message                                         |

### Examples

```bash
# Interactive mode (default behavior)
bun overturist.ts

# Automatically skip existing files
bun overturist.ts --skip

# Override existing files
bun overturist.ts --override

# Exit if existing files are found
bun overturist.ts --abort

# Select from available release versions
bun overturist.ts --historic
```

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

## Configuration

The tool reads configuration from:

1. **Environment variables** (via `.env` file):
   - `COUNTRY_CODE`: Country/region code for output directory structure
   - `BBOX_XMIN`, `BBOX_XMAX`, `BBOX_YMIN`, `BBOX_YMAX`: Bounding box coordinates
   - `DIVISION_ID`: Overture Maps division ID for the target region

2. **Default settings** in `libs/config.ts`:
   - Output directory: `./data`
   - Release metadata file: `releases.json`
   - Release calendar URL: [Overture Maps official release calendar](https://docs.overturemaps.org/release-calendar/)

## Output

Downloaded data is saved as `parquet` files in the `./data/` directory organized by:

- Country code
- Release version
- Feature type

The tool handles file conflicts based on the selected strategy.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run the linter and type checker
5. Submit a pull request

## Support

For issues and questions, please open an issue on the repository.
