# `scripts/split-lihtc-by-county.js`

split-lihtc-by-county.js
Reads data/chfa-lihtc.json (a GeoJSON FeatureCollection of all Colorado
LIHTC projects) and writes one per-county GeoJSON file into
data/hna/lihtc/<FIPS>.json for all 64 Colorado counties.

Counties with no matching projects are written as an empty FeatureCollection
so that the front-end always finds a valid file.

Run:  node scripts/split-lihtc-by-county.js

This script is called by .github/workflows/fetch-chfa-lihtc.yml immediately
after fetch-chfa-lihtc.js so that the per-county files are kept in sync
with the source data on every Monday refresh.

## Symbols

### `byFips`

@type {Map<string, object[]>}
