# Changelog

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
