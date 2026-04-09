# Commands and Examples

Overturist has three entry modes.

## Interactive mode

Use interactive mode when you want guided prompts, place search, or to browse
available releases.

```bash
bun overturist.ts
```

Useful helpers:

```bash
bun overturist.ts --help
bun overturist.ts --examples
```

## `get` command

Use `get` for automation, CI, and repeatable downloads.

```bash
bun overturist.ts get [options]
```

Common examples:

```bash
# Download all matching feature types for one division
bun overturist.ts get --division <gersId>

# Download one release only
bun overturist.ts get --division <gersId> --release 2026-03-18.0

# Filter by theme or type
bun overturist.ts get --division <gersId> --theme buildings
bun overturist.ts get --division <gersId> --type building,address

# Replace existing output files
bun overturist.ts get --division <gersId> --replace

# Download the full global dataset
bun overturist.ts get --world
```

## `info` command

Use `info` to inspect one division and save its metadata into the matching
release hierarchy.

```bash
bun overturist.ts info [options]
```

Examples:

```bash
bun overturist.ts info --division <gersId>
bun overturist.ts info --osmId 913110
```

## Common options

Download selection:

- `--release`, `-r`: choose a specific release version
- `--theme`, `-T`: include all feature types from one or more themes
- `--type`, `-t`: include one or more feature types directly

Geographic selection:

- `--division`, `-d`: target a stable Overture division id
- `--osmId`: resolve the division from an OSM relation id
- `--bbox`: target a bounding box using `xmin,ymin,xmax,ymax`
- `--world`: target the full global dataset

File handling:

- `--skip`: skip existing files
- `--replace`: overwrite existing files
- `--abort`: stop if output files already exist

See [configuration.md](configuration.md) and
[spatial-filtering.md](spatial-filtering.md) for the more advanced flags.
