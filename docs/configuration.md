# Configuration and Environment Variables

Overturist reads settings from three sources, in this order:

1. Command-line arguments
2. Environment variables from `.env`
3. Built-in defaults

## Common environment variables

Target selection:

- `DIVISION_ID`: stable Overture division id
- `BBOX_XMIN`, `BBOX_XMAX`, `BBOX_YMIN`, `BBOX_YMAX`: optional bounding box
- `TARGET`: `division`, `bbox`, or `world`
- `LOCALE`: preferred language for localized names

Download selection:

- `FEATURE_TYPES`: comma-separated feature types
- `RELEASE_VERSION`: exact release version

Workflow behavior:

- `ON_FILE_EXISTS`: `skip`, `replace`, or `abort`
- `CONFIRM_FEATURE_SELECTION`: set to `false` to skip the feature confirmation
  step in interactive mode when features were preselected

Spatial behavior:

- `SPATIAL_FRAME`: `division` or `bbox`
- `SPATIAL_PREDICATE`: `intersects` or `within`
- `SPATIAL_GEOMETRY`: `preserve`, `clip-smart`, or `clip-all`

Use [.env.example](../.env.example) as the source of truth for the full list.

## Example

```bash
# .env
DIVISION_ID="b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d"
FEATURE_TYPES="building,address"
RELEASE_VERSION="2026-03-18.0"
SPATIAL_FRAME="division"
SPATIAL_PREDICATE="intersects"
SPATIAL_GEOMETRY="clip-smart"
ON_FILE_EXISTS="skip"
```

CLI arguments always win over `.env`, so this command will override the feature
selection from the example above:

```bash
bun overturist.ts get --division <id> --theme buildings
```
