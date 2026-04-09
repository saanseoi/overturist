# Spatial Filtering and Geometry Modes

Overturist separates three related ideas: the target, the filter frame, and the
output geometry mode.

## Target

The target answers "what area am I downloading for?"

- `--division <id>`: use an administrative division
- `--osmId <relation>`: resolve a division from OSM
- `--bbox xmin,ymin,xmax,ymax`: use a raw bounding box
- `--world`: download the full dataset

## Spatial frame

The spatial frame answers "what exact shape should be used to test features?"

- `--frame division`: test features against the resolved division geometry
- `--frame bbox`: test features against the bounding box

This matters most when you provide both a division and a bounding box. For
example, you might target a division but use a narrower bbox as the exact frame.

## Spatial predicate

The predicate answers "when does a feature count as a match?"

- `--predicate intersects`: keep features that touch the frame
- `--predicate within`: keep only features fully contained by the frame

Example:

```bash
bun overturist.ts get \
  --bbox -71.068,42.353,-71.058,42.363 \
  --frame bbox \
  --predicate within
```

## Geometry mode

Geometry mode answers "what geometry should be written to the output file?"

- `--geometry preserve`: keep original geometries
- `--geometry clip-smart`: clip selected large-area geometries, preserve the rest
- `--geometry clip-all`: clip all matched geometries to the active frame

Example:

```bash
bun overturist.ts get --division <id> --geometry clip-smart
```

These choices affect output filenames so that different spatial strategies do
not silently overwrite one another.
