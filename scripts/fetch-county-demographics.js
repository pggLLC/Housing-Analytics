#!/usr/bin/env node
/**
 * scripts/fetch-county-demographics.js
 * Pre-fetch ACS 5-year demographic data for all 64 Colorado counties from the
 * public Census Bureau API and cache results to data/co-county-demographics.json.
 *
 * No API key required for basic ACS queries (Census API allows keyless requests
 * at reduced rate limits).  Set CENSUS_API_KEY env var for higher rate limits.
 *
 * Run:  node scripts/fetch-county-demographics.js
 * CI:   invoked by .github/workflows/fetch-county-data.yml (weekly, Monday 6 AM UTC)
 *
 * Fallback strategy:
 *  1. Live Census API fetch (this script)
 *  2. Existing data/co-county-demographics.json (preserved on fetch failure)
 *  3. Embedded representative values in data/co-county-demographics.json
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'co-county-demographics.json');

// Colorado state FIPS
const CO_FIPS = '08';

// ACS 5-year variables to fetch
// Key: ACS variable code, Value: friendly output key
const ACS_VARS = {
  B01001_001E: 'population',
  B19013_001E: 'median_household_income',
  B25064_001E: 'median_gross_rent',
  B11001_001E: 'household_count',
  B25070_007E: 'rent_burden_30_34',   // 30-34.9%
  B25070_008E: 'rent_burden_35_39',   // 35-39.9%
  B25070_009E: 'rent_burden_40_49',   // 40-49.9%
  B25070_010E: 'rent_burden_50plus',  // ≥50% (severe)
  B25070_001E: 'renter_total',
  B25014_008E: 'overcrowded_renter',  // >1 person/room renter
  B25014_001E: 'housing_units_occ_total',
  B25002_001E: 'housing_units_total',
  B25002_003E: 'vacant_units',
  B25003_003E: 'renter_occupied',
};

/**
 * Try several recent ACS 5-year vintages (newest first) for robustness.
 * The Census API publishes new vintages on its own schedule.
 */
function candidateYears() {
  const now = new Date();
  const years = [];
  for (let y = now.getFullYear() - 1; y >= now.getFullYear() - 5; y--) {
    years.push(y);
  }
  return years;
}

/**
 * Minimal HTTPS GET returning a Promise that resolves to the response body string.
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HousingAnalytics-DataSync/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Build Census API URL for Colorado county-level ACS 5-year data.
 */
function buildUrl(year, apiKey) {
  const base = `https://api.census.gov/data/${year}/acs/acs5`;
  const getVars = ['NAME', ...Object.keys(ACS_VARS)].join(',');
  const params = new URLSearchParams({
    get: getVars,
    for: `county:*`,
    in: `state:${CO_FIPS}`,
  });
  if (apiKey) params.set('key', apiKey);
  return `${base}?${params}`;
}

/**
 * Parse the Census API tabular response (array of arrays) into structured objects.
 */
function parseResponse(rows, year) {
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  function toNum(row, key) {
    const i = idx[key];
    if (i == null) return null;
    const v = Number(row[i]);
    return isNaN(v) || v < 0 ? null : v;
  }

  const counties = {};
  for (const row of rows.slice(1)) {
    const name = row[idx.NAME] || '';
    // "Boulder County, Colorado" → "Boulder"
    const county = name.replace(/ County,.*$/, '').trim();
    if (!county) continue;

    const renterTotal = toNum(row, 'B25070_001E') || 0;
    const burdened = ['B25070_007E', 'B25070_008E', 'B25070_009E', 'B25070_010E']
      .reduce((a, k) => a + (toNum(row, k) || 0), 0);
    const severe = toNum(row, 'B25070_010E') || 0;
    const overcrowded = toNum(row, 'B25014_008E') || 0;
    const housingOccTotal = toNum(row, 'B25014_001E') || 0;
    const housingTotal = toNum(row, 'B25002_001E') || 0;
    const vacant = toNum(row, 'B25002_003E') || 0;
    const renterOcc = toNum(row, 'B25003_003E') || 0;

    counties[county] = {
      population: toNum(row, 'B01001_001E'),
      median_household_income: toNum(row, 'B19013_001E'),
      median_gross_rent: toNum(row, 'B25064_001E'),
      household_count: toNum(row, 'B11001_001E'),
      cost_burden_share: renterTotal > 0 ? burdened / renterTotal : null,
      severe_burden_share: renterTotal > 0 ? severe / renterTotal : null,
      overcrowding_rate: housingOccTotal > 0 ? overcrowded / housingOccTotal : null,
      vacancy_rate: housingTotal > 0 ? vacant / housingTotal : null,
      renter_share: housingTotal > 0 ? renterOcc / housingTotal : null,
      acs_year: year,
    };
  }
  return counties;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const apiKey = (process.env.CENSUS_API_KEY || '').trim();
  const years = candidateYears();

  let countiesData = null;
  let usedYear = null;

  for (const year of years) {
    const url = buildUrl(year, apiKey);
    console.log(`Trying ACS ${year} 5-year for Colorado counties…`);
    try {
      const body = await httpsGet(url);
      const rows = JSON.parse(body);
      if (!Array.isArray(rows) || rows.length < 2) {
        console.warn(`  No data rows for year ${year}, trying next…`);
        continue;
      }
      countiesData = parseResponse(rows, year);
      usedYear = year;
      console.log(`  ✓ Fetched ${Object.keys(countiesData).length} counties from ACS ${year}.`);
      break;
    } catch (err) {
      console.warn(`  Year ${year} failed: ${err.message}`);
    }
  }

  if (!countiesData) {
    console.error('ERROR: Could not fetch Census ACS data for any candidate year.');
    // Preserve existing file if present
    if (fs.existsSync(OUTPUT_FILE)) {
      console.warn('Preserving existing', OUTPUT_FILE);
      process.exit(0);
    }
    process.exit(1);
  }

  // Guard: never overwrite a populated file with an empty result
  if (Object.keys(countiesData).length === 0 && fs.existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    if (Object.keys(existing.counties || {}).length > 0) {
      console.warn('Fetch returned 0 counties — preserving existing file.');
      process.exit(0);
    }
  }

  const output = {
    metadata: {
      source: 'U.S. Census Bureau ACS 5-Year Estimates',
      dataset: `ACS ${usedYear} 5-year`,
      lastUpdated: new Date().toISOString().slice(0, 10),
      geography: 'county',
      notes: 'Colorado county-level ACS 5-year estimates. Fetched by scripts/fetch-county-demographics.js.',
    },
    counties: countiesData,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${OUTPUT_FILE} (${Object.keys(countiesData).length} counties, ACS ${usedYear}).`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
