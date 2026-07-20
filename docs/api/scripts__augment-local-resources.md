# `scripts/augment-local-resources.js`

augment-local-resources.js

Idempotent augmentation of data/hna/local-resources.json with place-level
entries for the top 15 CO cities. Run once after a fresh
local-resources.json is published, or after adding more entries to the
PLACE_ENTRIES table below.

Before this script: only 3 of 547 places had place-level entries —
Boulder city (one of CO's largest, with its own housing authority + comp
plan + IZ ordinance) was falling back to Boulder County data. Now any
city explicitly listed below gets its own block.

Run:  node scripts/augment-local-resources.js

To extend: add entries to PLACE_ENTRIES keyed by 'place:GEOID' format,
mirroring the existing county:* shape (prop123, housingLead,
housingAuthority, housingPlans, advocacy, contacts).

MERGE SEMANTICS (non-destructive; see test/augment-local-resources-
nondestructive.test.js): the committed JSON is the source of truth.
local-resources.json is enriched after the fact by later processes —
F35 link healing (durable search URLs), discovery promotion, and
hand-curation (council_agenda_url, schoolDistrict, hospital,
majorEmployers, advocacy additions). This script therefore only FILLS IN
fields that are missing: new place keys are added whole, missing fields
on existing entries are added, plain objects are merged recursively, and
any field already present in the JSON (scalars AND arrays) is left
untouched. It never deletes or overwrites existing data.

Data sourced from public-facing city/county housing pages + CDOLA
Prop 123 commitment filings + each housing authority's own website.
Last verified 2026-05-26; Greenwood Village verified 2026-07-14.

## Symbols

### `mergeMissing(existing, incoming)`

Recursively fill fields from `incoming` into `existing` without ever
overwriting or deleting anything already there. The committed JSON wins
every conflict: scalars and arrays present in `existing` are left as-is
(arrays are NOT merged element-wise — a healed URL or hand-added array
item must survive), plain objects recurse. Returns the number of fields
added. Mutates `existing`.
