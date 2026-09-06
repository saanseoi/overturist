---
'@saanseoi/overturist': patch
---

Fix download error reporting and statistics handling:

- Report failed feature extractions and exit unsuccessfully after processing the remaining features.
- Allow final statistics to resolve in the background while subsequent downloads proceed.
- Preserve unknown polygon areas instead of displaying them as zero.
- Handle apostrophes in output paths and division IDs consistently in DuckDB queries.

Simplify progress statistics handling and remove redundant filesystem checks.
