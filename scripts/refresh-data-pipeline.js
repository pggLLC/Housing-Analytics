#!/usr/bin/env node
/**
 * scripts/refresh-data-pipeline.js
 *
 * Orchestrates a full data-refresh pass for the Housing Analytics site.
 * Steps (in order):
 *   1. Validate API keys (Census, FRED)
 *   2. Fetch Census ACS county-level data for Colorado (state FIPS 08)
 *   3. Write / update data/co-county-demographics.json
 *   4. Rebuild data/manifest.json (file count + timestamp)
 *
 * Environment variables (set in CI via GitHub Secrets, or in .env for local dev):
 *   CENSUS_API_KEY   — U.S. Census Bureau API key (optional; unauthenticated requests
 *                      are rate-limited but still work for low-volume fetches)
 *   FRED_API_KEY     — Federal Reserve FRED API key (optional; not used in this script
 *                      but logged for completeness)
 *
 * Graceful-fallback behaviour when CENSUS_API_KEY is absent:
 *   - A warning is logged (not an error).
 *   - The request is still made without a key (public endpoint, rate-limited).
 *   - If the unauthenticated request fails, the existing data file is retained.
 *   - Execution continues; the script always exits 0 unless an unrecoverable
 *     filesystem error occurs.
 *
 * Run locally:
 *   node scripts/refresh-data-pipeline.js
 *   CENSUS_API_KEY=yourkey node scripts/refresh-data-pipeline.js
 */
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
 * Build a Census ACS 5-year API URL for Colorado counties.
 *
 * @param {number} year  - ACS vintage year (e.g. 2022)
 * @param {string} vars  - Comma-separated variable list including NAME
 * @returns {string}
 */
function buildCensusAcsUrl(year, vars) {
  const base = `https://api.census.gov/data/${year}/acs/acs5`;
  const params = new URLSearchParams({
    get: vars,
    for: 'county:*',
    in:  'state:08',
  });
  if (CENSUS_API_KEY) {
    params.set('key', CENSUS_API_KEY);
  }
  return `${base}?${params.toString()}`;
}

/**
 * Minimal HTTP(S) GET that returns parsed JSON.
 * Compatible with Node ≥ 18 native fetch and older Node via https module.
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  if (typeof fetch !== 'undefined') {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
      return r.json();
    });
  }
  // Fallback: Node's built-in https module
  const https = require('https');
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode + ' — ' + url));
        res.resume();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 4. Step: Fetch Census ACS county data for Colorado
// ---------------------------------------------------------------------------
const ACS_VARS = [
  'NAME',
  'B25070_007E', 'B25070_008E', 'B25070_009E', 'B25070_010E', 'B25070_001E',
  'B11001_001E', 'B25014_008E', 'B25014_001E', 'B25002_001E', 'B25002_003E',
  'B25064_001E', 'B19013_001E', 'B25077_001E', 'B01003_001E',
].join(',');

// Try vintages newest-first for resilience against Census publication lag.
const now = new Date();
const currentYear = now.getUTCFullYear();
const candidateYears = [];
for (let y = currentYear - 1; y >= currentYear - 5; y--) {
  candidateYears.push(y);
}

const OUT_DIR   = path.join(__dirname, '..', 'data');
const OUT_FILE  = path.join(OUT_DIR, 'co-county-demographics.json');

/**
 * Parse a flat Census API array response into an object keyed by county name.
 *
 * @param {Array} rows  - Census API rows (first row = headers)
 * @param {number} year - ACS vintage year used for metadata
 * @returns {object|null}
 */
function parseAcsRows(rows, year) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const headers = rows[0];
  const counties = {};

  function idx(name) { return headers.indexOf(name); }
  function num(row, name) {
    const i = idx(name);
    if (i < 0) return null;
    const v = Number(row[i]);
    return isNaN(v) ? null : v;
  }

  rows.slice(1).forEach(function (row) {
    const fullName = row[idx('NAME')] || '';
    const m = fullName.match(/^(.+?)\s+County/i);
    if (!m) return;
    const cName = m[1].trim();

    const totalRenter  = num(row, 'B25070_001E');
    const burdened30   = (num(row, 'B25070_007E') || 0) +
                         (num(row, 'B25070_008E') || 0) +
                         (num(row, 'B25070_009E') || 0) +
                         (num(row, 'B25070_010E') || 0);
    const severe50     = num(row, 'B25070_010E');
    const totalHU      = num(row, 'B25002_001E');
    const vacantHU     = num(row, 'B25002_003E');

    counties[cName] = {
      cost_burdened_pct:      totalRenter ? Math.round((burdened30 / totalRenter) * 1000) / 10 : null,
      severely_burdened_pct:  totalRenter ? Math.round(((severe50 || 0) / totalRenter) * 1000) / 10 : null,
      households:             num(row, 'B11001_001E'),
      overcrowded:            num(row, 'B25014_008E'),
      total_housing_units:    num(row, 'B25014_001E'),
      vacancy_rate:           totalHU ? Math.round(((vacantHU || 0) / totalHU) * 1000) / 10 : null,
      median_gross_rent:      num(row, 'B25064_001E'),
      median_household_income: num(row, 'B19013_001E'),
      median_home_value:      num(row, 'B25077_001E'),
      population:             num(row, 'B01003_001E'),
      acs_year:               year,
    };
  });

  return counties;
}

async function fetchCensusCountyData() {
  console.log('\n[pipeline] Step: Fetch Census ACS county data for Colorado');

  let lastErr = null;
  for (const year of candidateYears) {
    const url = buildCensusAcsUrl(year, ACS_VARS);
    // Log URL without key for security
    const safeUrl = url.replace(/key=[^&]+/, 'key=REDACTED');
    console.log(`  Trying ACS ${year} — ${safeUrl}`);
    try {
      const rows = await fetchJson(url);
      const counties = parseAcsRows(rows, year);
      if (!counties || Object.keys(counties).length === 0) {
        throw new Error('Parsed 0 counties — unexpected response shape');
      }
      console.log(`  ✓ ACS ${year}: ${Object.keys(counties).length} Colorado counties fetched`);

      // Read existing file to preserve any non-ACS fields
      let existing = {};
      if (fs.existsSync(OUT_FILE)) {
        try { existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); }
        catch (_) { /* ignore parse errors */ }
      }

      const out = Object.assign({}, existing, {
        meta: {
          source:        'U.S. Census Bureau API (ACS 5-year)',
          dataset:       `${year}/acs/acs5`,
          geography:     'county',
          state:         'Colorado (FIPS 08)',
          refreshed_utc: new Date().toISOString(),
          census_api_key_used: !!CENSUS_API_KEY,
        },
        counties,
      });

      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
      console.log(`  ✓ Wrote ${OUT_FILE}`);
      return true;
    } catch (e) {
      lastErr = e;
      console.warn(`  ✗ ACS ${year} failed: ${e.message}`);
    }
  }

  // All vintages failed
  console.warn('[pipeline] WARNING: Could not fetch Census ACS county data for any candidate year.');
  if (lastErr) console.warn('[pipeline]   Last error:', lastErr.message);
  if (fs.existsSync(OUT_FILE)) {
    console.warn('[pipeline]   Retaining existing', OUT_FILE);
  } else {
    console.warn('[pipeline]   No existing file to retain. Census-dependent charts will show empty states.');
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. Step: Rebuild data/manifest.json
// ---------------------------------------------------------------------------
const MANIFEST_FILE = path.join(OUT_DIR, 'manifest.json');

async function rebuildManifest() {
  console.log('\n[pipeline] Step: Rebuild data/manifest.json');
  try {
    const REPO_ROOT = path.resolve(__dirname, '..');
    const filesObj = {};
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          // Use repo-root-relative paths (e.g. "data/chfa-lihtc.json")
          const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
          if (rel === 'data/manifest.json') continue;
          let size = 0;
          try { size = fs.statSync(full).size; } catch (_) { /* ignore */ }
          filesObj[rel] = { bytes: size };
        }
      }
    }
    walk(OUT_DIR);

    const fileCount = Object.keys(filesObj).length;
    const manifest = {
      generated:  new Date().toISOString(),
      file_count: fileCount,
      files:      filesObj,
    };

    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`  ✓ Manifest updated (${fileCount} files)`);
  } catch (e) {
    console.warn('[pipeline] WARNING: Could not rebuild manifest:', e.message);
  }
}

// ---------------------------------------------------------------------------
// 6. Main entry point
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Housing Analytics — Data Refresh Pipeline ===');
  console.log('    Run at:', new Date().toISOString());
  console.log('    Node.js:', process.version);
  console.log('');

  await fetchCensusCountyData();
  await rebuildManifest();

  console.log('\n[pipeline] Refresh complete.');
}

main().catch(function (err) {
  console.error('[pipeline] FATAL:', err);
  process.exit(1);
});
