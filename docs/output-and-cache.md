# Output Layout and Cache Behavior

## Output layout

Downloaded data is written under `./data/`.

The path includes:

- release version
- resolved target hierarchy
- feature type

Examples:

- world output: `{featureType}.parquet`
- spatially specific output:
  `{featureType}.{frame}.{predicate}.{geometry}.parquet`

The `info` command saves one division record as `division.json` alongside the
matching release and hierarchy.

## Existing files

Use one of these strategies when output files already exist:

- `--skip`: keep existing files and download only what is missing
- `--replace`: rebuild matching files
- `--abort`: stop instead of mixing old and new output

## Cache layout

Overturist uses `.cache/` to avoid repeating expensive lookups.

Cached data includes:

- release metadata
- division records
- search history
- theme mappings

The cache is version-aware, so repeated lookups stay fast without mixing data
from different Overture releases.
