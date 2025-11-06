# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `bun run typecheck` - Run TypeScript type checking without emitting files
- `bun run check` - Run all Biome checks (linting + formatting)
- `bun run check:fix` - Fix all Biome issues automatically
- `bun overturist.ts` - Run the CLI tool in interactive mode
- `bun overturist.ts get` - Run the CLI tool in non-interactive mode

## Architecture Overview

Overturist is a TypeScript CLI tool that downloads and processes geospatial data from the Overture Maps Foundation's S3 bucket. The architecture follows a modular design with clear separation of concerns:

### Core Components

- **overturist.ts** - Main entry point that orchestrates the data extraction workflow
- **libs/config.ts** - Configuration management using environment variables and defaults
- **libs/types.ts** - TypeScript type definitions for all data structures
- **libs/processing.ts** - Core data processing logic with DuckDB spatial queries
- **libs/duckdb.ts** - DuckDB wrapper for spatial queries and Parquet file operations
- **libs/releases.ts** - Release management and version handling
- **libs/s3.ts** - AWS S3 client integration for data downloads
- **libs/init.ts** - Initialization workflow and release context setup
- **libs/args.ts** - Command-line argument parsing
- **libs/fs.ts** - File system operations and output directory management
- **libs/ui.ts** - CLI user interface components and progress displays
- **libs/utils.ts** - Common utility functions
- **libs/validation.ts** - Data validation helpers

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

Data is organized as: `./data/{release_version}/{hierarchy...}/{feature_type}.parquet`

The tool maintains a `releases.json` file with cached release metadata and provides diff calculations between consecutive releases.
