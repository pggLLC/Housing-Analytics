# `scripts/backfill_dp04_value_brackets.mjs`

Backfill DP04_0080E .. DP04_0088E (home-value brackets) into
data/hna/summary/*.json acsProfile blocks. F160 home-value-distribution
chart needs every bracket; today most summary files only carry the
median (DP04_0089E).

Usage:
  CENSUS_API_KEY=xxxxxx node scripts/backfill_dp04_value_brackets.mjs
  CENSUS_API_KEY=xxxxxx node scripts/backfill_dp04_value_brackets.mjs --dry

One-off. Reads summary files, identifies which already carry
DP04_0083E in acsProfile (skip) vs. which need fill, calls the ACS
5-year profile endpoint with the nine bracket vars + NAME, and
merges the values back into acsProfile (no other fields touched).

Polite batching: max 4 concurrent requests, one retry on transient
error, summary report at end.

## Symbols

### `sleep`

Sleep helper.

### `resolveGeo(record)`

Resolve the geoType + geoid for a given summary record. Prefers
acsProfile._geoType when present; falls back to sum.geo.type. Place
variants ("place" / "cdp" / "city") all map to the place endpoint.

### `buildUrl(kind, geoid)`

Build the Census ACS 5-year profile URL for the bracket vars. Returns
null when the geoid shape doesn't match what we expect for the kind.

### `fetchBrackets(url, attempt = 0)`

Fetch the bracket vars for a given URL and return a plain
{ DP04_0080E: ..., ... } object. One retry on transient errors.

### `processFile(filePath)`

Process one summary file end-to-end.

### `runQueue(tasks, concurrency, onResult)`

Drain a queue of tasks with a fixed concurrency.
