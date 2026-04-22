# `scripts/audit/data-sentinels-check.mjs`

## Symbols

### `SENTINELS`

data-sentinels-check.mjs — verify critical data artifacts haven't
regressed in row count. Partial closeout of issue #657 (row-count
sentinels) from epic #447.

Companion to data-freshness-check.mjs:
  - freshness-check: are files RECENT enough?
  - sentinels-check: do files have ENOUGH ROWS?

Both questions matter: a fresh file with 50 of an expected 500 entries
is just as broken as a 90-day-stale one. The two checks together give
us "is the pipeline healthy" coverage that neither catches alone.

For each configured artifact the script:
  1. Loads the file (JSON parse, GeoJSON parse, or filesystem listing
     for directory-style artifacts like data/hna/summary/).
  2. Counts entries via an extractor function (config-driven).
  3. Fails non-zero if the count is below the configured minimum.

Thresholds are deliberately set COMFORTABLY below the current row
count — the sentinel catches sudden cratering, not normal drift. As
of 2026-04-21 every artifact is well above its floor:
  - ranking-index: 547 entries, floor 540
  - HNA summary dir: 548 files, floor 540
  - HUD LIHTC: 1000+ features, floor 500
  - ACS tract metrics: 1400+ tracts, floor 1300
  - CO county demographics: 64 counties, floor 64 (all CO counties)

Exit codes:
  0  — every sentinel passed
  1  — at least one sentinel regressed below floor
  2  — internal script error (e.g. a configured file is missing)
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

/**
Sentinel configuration. Each entry describes one artifact and how to
count its rows. The `expect` counter receives the parsed JSON (or the
list of filenames for directory artifacts) and returns an integer.
