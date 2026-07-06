# `scripts/backfill_dp04_value_brackets.mjs`

## Symbols

### `sleep`

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
/

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const SUMMARY_DIR = path.join(REPO_ROOT, "data", "hna", "summary");

const DRY_RUN = process.argv.includes("--dry");
const CENSUS_API_KEY = process.env.CENSUS_API_KEY;
if (!CENSUS_API_KEY) {
  throw new Error(
    "CENSUS_API_KEY is required. Set it in the environment before running."
  );
}

const VARS = [
  "DP04_0080E",
  "DP04_0081E",
  "DP04_0082E",
  "DP04_0083E",
  "DP04_0084E",
  "DP04_0085E",
  "DP04_0086E",
  "DP04_0087E",
  "DP04_0088E",
];
const SENTINEL = "DP04_0083E"; // used to detect already-filled files
const ACS_BASE = "https://api.census.gov/data/2023/acs/acs5/profile";
const MAX_CONCURRENT = 4;

/** Sleep helper.

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
