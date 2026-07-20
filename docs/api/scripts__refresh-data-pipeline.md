# `scripts/refresh-data-pipeline.js`

scripts/refresh-data-pipeline.js

Orchestrates a full data-refresh pass for the Housing Analytics site.
Steps (in order):
  1. Validate API keys (Census, FRED)
  2. Fetch Census ACS county-level data for Colorado (state FIPS 08)
  3. Write / update data/co-county-demographics.json
  4. Rebuild data/manifest.json (file count + timestamp)

Environment variables (set in CI via GitHub Secrets, or in .env for local dev):
  CENSUS_API_KEY   — U.S. Census Bureau API key (optional; unauthenticated requests
                     are rate-limited but still work for low-volume fetches)
  FRED_API_KEY     — Federal Reserve FRED API key (optional; not used in this script
                     but logged for completeness)

Graceful-fallback behaviour when CENSUS_API_KEY is absent:
  - A warning is logged (not an error).
  - The request is still made without a key (public endpoint, rate-limited).
  - If the unauthenticated request fails, the existing data file is retained.
  - Execution continues; the script always exits 0 unless an unrecoverable
    filesystem error occurs.

Run locally:
  node scripts/refresh-data-pipeline.js
  CENSUS_API_KEY=yourkey node scripts/refresh-data-pipeline.js

## Symbols

### `buildCensusAcsUrl(year, vars)`

Build a Census ACS 5-year API URL for Colorado counties.

@param {number} year  - ACS vintage year (e.g. 2022)
@param {string} vars  - Comma-separated variable list including NAME
@returns {string}

### `fetchJson(url)`

Minimal HTTP(S) GET that returns parsed JSON.
Compatible with Node ≥ 18 native fetch and older Node via https module.

@param {string} url
@returns {Promise<any>}

### `parseAcsRows(rows, year)`

Parse a flat Census API array response into an object keyed by county name.

@param {Array} rows  - Census API rows (first row = headers)
@param {number} year - ACS vintage year used for metadata
@returns {object|null}
