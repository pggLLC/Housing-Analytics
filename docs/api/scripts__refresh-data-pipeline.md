# `scripts/refresh-data-pipeline.js`

## Symbols

### `buildCensusAcsUrl(year, vars)`

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
/
'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Load .env for local development (optional; silently ignored if absent)
// ---------------------------------------------------------------------------
(function loadDotEnv() {
  const envFile = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return;
  try {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
    console.log('[pipeline] Loaded environment variables from .env');
  } catch (e) {
    console.warn('[pipeline] Could not parse .env file:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// 2. Read and validate API keys
// ---------------------------------------------------------------------------
const CENSUS_API_KEY = (process.env.CENSUS_API_KEY || '').trim();
const FRED_API_KEY   = (process.env.FRED_API_KEY   || '').trim();

console.log('[pipeline] API key status:');
console.log('  CENSUS_API_KEY :', CENSUS_API_KEY ? `set (${CENSUS_API_KEY.length} chars)` : 'NOT SET — will use unauthenticated Census requests (rate-limited)');
console.log('  FRED_API_KEY   :', FRED_API_KEY   ? `set (${FRED_API_KEY.length} chars)`   : 'NOT SET — FRED steps skipped');

if (!CENSUS_API_KEY) {
  console.warn('[pipeline] WARNING: CENSUS_API_KEY is not configured.');
  console.warn('[pipeline]   • For CI/CD: add CENSUS_API_KEY to GitHub Secrets');
  console.warn('             (Settings → Secrets and variables → Actions → New repository secret).');
  console.warn('[pipeline]   • For local development: set CENSUS_API_KEY in your .env file.');
  console.warn('[pipeline]   • Free key signup: https://api.census.gov/data/key_signup.html');
  console.warn('[pipeline]   Continuing without a key — Census data may be incomplete.');
}

// ---------------------------------------------------------------------------
// 3. Utility helpers
// ---------------------------------------------------------------------------

/**
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
