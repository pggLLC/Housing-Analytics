/**
 * scripts/fetch-county-demographics.js
 *
 * Fetches live Census ACS 5-year county-level data for all Colorado counties
 * and writes the result to data/co-county-demographics.json.
 *
 * Fallback strategy:
 *  1. Try Census ACS 5-year API (public, no key required for basic tables)
 *  2. If Census API is unavailable, retain the existing file unchanged
 *
 * Data source:
 *  U.S. Census Bureau — ACS 5-Year Estimates (2018-2022)
 *  https://api.census.gov/data/2022/acs/acs5
 *
 * Run via:
 *  node scripts/fetch-county-demographics.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, '..', 'data', 'co-county-demographics.json');
const ACS_YEAR = 2022;
const ACS_URL =
  'https://api.census.gov/data/' + ACS_YEAR + '/acs/acs5' +
  '?get=NAME,B25070_007E,B25070_008E,B25070_009E,B25070_010E,B25070_001E' +
  ',B11001_001E,B25014_008E,B25014_001E,B25002_001E,B25002_003E' +
  ',B25064_001E,B19013_001E,B25077_001E,B01003_001E' +
  '&for=county:*&in=state:08';

function fetchJSON(url) {
  // Support both node-fetch v2 (CommonJS) and native fetch (Node 18+)
  if (typeof fetch !== 'undefined') {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  try {
    const nodeFetch = require('node-fetch');
    return nodeFetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  } catch (e) {
    return Promise.reject(new Error('node-fetch not available: ' + e.message));
  }
}

function parseCountyRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  var headers = rows[0];
  var counties = {};

  function getVal(row, name) {
    var i = headers.indexOf(name);
    return i >= 0 ? Number(row[i]) : null;
  }

  rows.slice(1).forEach(function (row) {
    var fullName = row[headers.indexOf('NAME')] || '';
    var m = fullName.match(/^(.+?)\s+County/i);
    if (!m) return;
    var cName = m[1].trim();

    var totalRenter = getVal(row, 'B25070_001E');
    var burdened30 =
      (getVal(row, 'B25070_007E') || 0) +
      (getVal(row, 'B25070_008E') || 0) +
      (getVal(row, 'B25070_009E') || 0) +
      (getVal(row, 'B25070_010E') || 0);
    var severe50 = getVal(row, 'B25070_010E');
    var hh = getVal(row, 'B11001_001E');
    var overcrowded = getVal(row, 'B25014_008E');
    var totalUnits = getVal(row, 'B25014_001E');
    var totalHU = getVal(row, 'B25002_001E');
    var vacantHU = getVal(row, 'B25002_003E');
    var medRent = getVal(row, 'B25064_001E');
    var medIncome = getVal(row, 'B19013_001E');
    var medHomeValue = getVal(row, 'B25077_001E');
    var population = getVal(row, 'B01003_001E');

    counties[cName] = {
      cost_burden_share: totalRenter > 0 ? parseFloat((burdened30 / totalRenter).toFixed(4)) : null,
      severe_burden_share: totalRenter > 0 ? parseFloat((severe50 / totalRenter).toFixed(4)) : null,
      household_count: hh,
      overcrowding_rate: totalUnits > 0 ? parseFloat((overcrowded / totalUnits).toFixed(4)) : null,
      vacancy_rate: totalHU > 0 ? parseFloat((vacantHU / totalHU).toFixed(4)) : null,
      median_gross_rent_current: medRent && medRent > 0 ? medRent : null,
      median_home_value: medHomeValue && medHomeValue > 0 ? medHomeValue : null,
      median_hh_income: medIncome && medIncome > 0 ? medIncome : null,
      population: population && population > 0 ? population : null
    };
  });

  return counties;
}

function run() {
  console.log('Fetching ACS 5-year county data from Census API…');
  fetchJSON(ACS_URL)
    .then(function (rows) {
      var counties = parseCountyRows(rows);
      if (!counties || Object.keys(counties).length === 0) {
        throw new Error('Census API returned empty data');
      }
      var existing = {};
      try {
        existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      } catch (e) {
        // file doesn't exist yet — that's fine
      }
      var output = Object.assign({}, existing, {
        updated: new Date().toISOString().slice(0, 10),
        source: 'U.S. Census Bureau — American Community Survey 5-Year Estimates (' + ACS_YEAR + ')',
        source_url: 'https://data.census.gov/',
        note: 'County-level fallback data refreshed weekly by CI. Live data fetched directly from Census ACS API at page load.',
        counties: counties
      });
      fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
      console.log('Wrote ' + Object.keys(counties).length + ' counties to ' + OUT_FILE);
    })
    .catch(function (err) {
      console.error('Census API fetch failed: ' + err.message);
      console.log('Retaining existing ' + OUT_FILE + ' unchanged.');
      process.exit(0); // non-fatal: CI should not fail if Census API is temporarily down
    });
}

run();
