<img width="720" alt="image" src="https://github.com/user-attachments/assets/ed828dd2-724c-462e-846c-476858db840d" />

Friendly CLI to get [Overture](https://overturemaps.org/) [Maps](https://explore.overturemaps.org/?mode=explore#10.44/22.369/114.1002) data.

![TypeScript Badge](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff&style=for-the-badge) ![Bun Badge](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=fff&style=for-the-badge)![DuckDB Badge](https://img.shields.io/badge/DuckDB-FFF000?logo=duckdb&logoColor=000&style=for-the-badge) ![Biome Badge](https://img.shields.io/badge/Biome-60A5FA?logo=biome&logoColor=fff&style=for-the-badge) 

## Overview

**Overturist** downloads and filters `Overture Maps` data for a specific place, a bounding box, or the whole world. It supports both guided interactive use and fully scripted runs; common selection and clipping strategies, and a local cache to speed up results.

## Features

- **Modes** : run interactively or fully scripted with `.env` config and `--arguments`.
- **Target** : places, bounding boxes or the whole world.
- **Flexible Lookups** : find places by their name, [GERS](https://overturemaps.org/gers/) `Id`, or [OSM](https://wiki.openstreetmap.org/wiki/Relation) relation `Id`.
- **Disambiguation** : search results are presented within the context of their hierarchy
- **Themes** : download all or a targeted subset by theme (e.g. `transportation`, `places`) or type (e.g. `building`, `division`)
- **Selection** : Filter results by intersection or containment of a division boundary or an exact bbox
- **Clipping** : Rewrite the geometry output to preserve geometry, clip selectively or clip all.
- **Cache** : release metadata, division lookups, and search history for faster results.
- **I18n** : results are presented and stored in your language.

## Gallery

<img width="857" height="362" alt="image" src="https://github.com/user-attachments/assets/b6b4f228-6baf-41e2-9110-f7d20d6c1183" />
<img width="464" height="519" alt="image" src="https://github.com/user-attachments/assets/6f6b48ea-fb8f-44ea-9bfe-aa2b4fb1976e" />
<img width="1043" height="871" alt="image" src="https://github.com/user-attachments/assets/a79cecff-7d09-4d60-9cef-d6eb97df48f6" />

## Installation

Requires [Bun](https://bun.sh/).

### Run Without Installing

```bash
bunx --package @saanseoi/overturist overturist
```

This package currently targets Linux x64 and requires Bun `>=1.3.0`.

### Install Globally

The published package currently targets Linux x64 because it depends on `@duckdb/node-bindings-linux-x64`.

```bash
bun install -g @saanseoi/overturist
overturist
```

## Basic Usage

Start the interactive CLI:

```bash
bun overturist.ts
```

Download data non-interactively:

```bash
bun overturist.ts get --division <gersId>
```

Useful examples:

```bash
# Download one theme for a division
bun overturist.ts get --division <id> --theme buildings

# Resolve a division from an OSM relation id
bun overturist.ts info --osmId 913110

# Filter by bbox and keep only features fully within it
bun overturist.ts get --bbox 113.81724,22.13672,114.50249,22.56833 --frame bbox --predicate within
```

Use `bun overturist.ts --help` or `bun overturist.ts --examples` for the full
CLI reference.

## Advanced Topics

- [Command reference and examples](docs/commands.md)
- [Configuration and environment variables](docs/configuration.md)
- [Spatial filtering and geometry modes](docs/spatial-filtering.md)
- [Output layout and cache behavior](docs/output-and-cache.md)
- [Development notes](docs/development.md)

## Limits 

The Overture Maps Foundation has a monthly release cadence and keeps 60 days of releases available in S3. So usually only the latest 2 releases are available for download.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Made with <3 in 

<img width="1280" height="1125" alt="image" src="https://github.com/user-attachments/assets/b794d3f8-4062-475b-8232-4eef60d5b1cd" />
<img width="1280" height="1119" alt="image" src="https://github.com/user-attachments/assets/1877b702-acd1-46fa-846c-71ce5bb180b1" />
<img width="1280" height="1160" alt="image" src="https://github.com/user-attachments/assets/e39d6d71-c989-46c2-bf17-9793501386fc" />
