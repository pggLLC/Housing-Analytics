# `scripts/fetch-county-demographics.js`

scripts/fetch-county-demographics.js

Fetches live Census ACS 5-year county-level data for all Colorado counties
and writes the result to data/co-county-demographics.json.

Improvements:
 - Each county record now includes a `fips` field (5-digit FIPS string, e.g. "08001").
 - A statewide aggregate row is added under `counties.Colorado` so callers can
   reference state totals without summing individual counties themselves.
 - The `source` label reflects the actual ACS_YEAR used.

Fallback strategy:
 1. Try Census ACS 5-year API (public, no key required for basic tables)
 2. If Census API is unavailable, retain the existing file unchanged

Data source:
 U.S. Census Bureau — ACS 5-Year Estimates (2019-2023)
 https://api.census.gov/data/2023/acs/acs5

Run via:
 node scripts/fetch-county-demographics.js

## Symbols

### `buildStatewideAggregate(counties)`

Build a statewide aggregate row from individual county records.
Count fields are summed; rate/median fields use population-weighted averages.
This row is stored under `counties.Colorado` (FIPS "08") so downstream code
can reference state totals without re-summing 64 counties.
