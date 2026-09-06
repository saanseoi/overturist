# Changelog

## 0.2.2

### Patch Changes

- Handle empty spatial extraction results as successful zero-row Parquet outputs, and retain underlying error details in spatial download failure summaries.

- d0acc5a: Fix download error reporting and statistics handling:

  - Report failed feature extractions and exit unsuccessfully after processing the remaining features.
  - Allow final statistics to resolve in the background while subsequent downloads proceed.
  - Preserve unknown polygon areas instead of displaying them as zero.
  - Handle apostrophes in output paths and division IDs consistently in DuckDB queries.

  Simplify progress statistics handling and remove redundant filesystem checks.

- 7f7c1ce: Align download progress headers and rows using shared column widths and separators. Right-align numeric columns, center status markers, and use single-width symbols for consistent terminal rendering.

## 0.2.1

### Patch Changes

- d9ef8ad: Show the combined size of completed download outputs in the final progress status.

## 0.2.0

### Minor Changes

- fc6e304: Add a `releases` command that lists S3-available Overture release versions, with optional JSON output.

### Patch Changes

- c1211e8: Normalize clipped geometry for area types, and filter clipped division_area slivers
- 7890377: Update runtime and development dependencies.

## 0.1.4 - 2026-06-18

### Patch Changes

- Reduce the release cache refresh timeout from 24 to 1 hours
- Use changesets for changelog management

## 0.1.3 - 2026-05-27

- Resolve script resolution for `bunx` invocation

## 0.1.2 - 2026-05-27

- Update dependencies
- Fix compatibility with Bun v1.3.14

## 0.1.1 - 2026-04-09

- Respect geometry's embedded CRS for correct area calculation
- Sort previous searches by last run

## 0.1.0 - 2026-04-09

Initial public release.

- Interactive CLI for searching Overture administrative divisions
- Non-interactive `get` workflow for scripted downloads
- DuckDB-powered bbox and boundary filtering for Overture Parquet data
- Release-aware caching for divisions, searches, themes, and release metadata
- Target places, bounding boxes or the whole world.
- Find places by their name, GERS Id, or OSM Id.
- Search results are presented within the context of their hierarchy
- Download all or a targeted subset by theme (e.g. `transportation`, `places`) or type (e.g. `building`, `division`)
- Filter results by intersection or containment of a division boundary or an exact bbox
- Rewrite the geometry output to preserve geometry, clip selectively or clip all.
- I18n support so results are presented and stored in your language.
