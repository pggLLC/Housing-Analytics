# `scripts/augment_lihtc_by_geometry.mjs`

## Symbols

### `_pointInPolygon(lng, lat, rings)`

F191 — Augment ranking-index.json with LIHTC counts via point-in-
polygon attribution (closes future-work item 4: CDP coverage).

The existing recency augmentation script (scripts/augment_ranking_
index_recency.mjs) matches LIHTC records to jurisdictions by
normalized city name. This works for cities + towns where the LIHTC
record's PROJ_CTY matches a place's `name` field. It FAILS for CDPs
(Census Designated Places — unincorporated areas) because LIHTC
records list a postal city (e.g. "Aurora"), not the CDP name (e.g.
"Acres Green CDP").

F191 fixes that by doing point-in-polygon against
data/co-place-boundaries.geojson. Each LIHTC record's lat/lng is
tested against every place polygon; the containing place gets +1 to
its lihtc_in_boundary count.

Writes:
  - rankings[*].metrics.lihtc_in_boundary  (geographic count)
  - rankings[*].metrics.lihtc_in_boundary_year (max year of contained projects)
  - metric descriptors added

The original `lihtc_project_count` (city-name-matched) stays in
place; the new field supplements it. Consumers can pick whichever
fits the semantic — city-name matching is more conservative for
cities (counts only properties listing that city as PROJ_CTY); the
geometric count is more accurate for CDPs (counts properties whose
coordinates fall inside the CDP boundary).

Idempotent.
/

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

const RI_PATH     = path.join(REPO_ROOT, 'data', 'hna', 'ranking-index.json');
const CHFA_PATH   = path.join(REPO_ROOT, 'data', 'affordable-housing', 'lihtc', 'chfa-properties.json');
const PLACES_PATH = path.join(REPO_ROOT, 'data', 'co-place-boundaries.geojson');

/* Ray-casting point-in-polygon. Accepts a polygon as an array of
rings (each ring is an array of [lng, lat] pairs). Handles holes
via even-odd rule across all rings.
