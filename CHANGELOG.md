# Changelog

All notable changes to this project will be documented in this file.

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
