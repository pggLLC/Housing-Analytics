// test/hmda-lookup.test.js
//
// Tests for js/hmda-lookup.js + the HMDA data files shipped in PR #786.
// Verifies:
//   - Helper module exposes the expected API
//   - Data file paths follow the relative-to-data/ convention
//     (regression for the bug class fixed in PR #791)
//   - HmdaLookup is referenced by Deal Calculator + PMA simulator
//   - HTML script tags wire the module before its consumers
//   - State-vs-county delta math is well-defined for a known county
//
// Run: node test/hmda-lookup.test.js

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✅ PASS: ' + message);
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message);
    failed++;
  }
}

function readRel(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

console.log('\n[test] hmda-lookup.js exposes expected API');
const helperSrc = readRel('js/hmda-lookup.js');
assert(/window\.HmdaLookup\s*=\s*\{/.test(helperSrc),
  'attaches HmdaLookup to window');
['init', 'getCounty', 'getCountyTrend', 'getStateLatest', 'getCountyVsState', 'formatCountyCallout'].forEach((fn) => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(helperSrc),
    'defines ' + fn + '() function');
});

console.log('\n[test] No double-data/ prefix bug (regression: 2026-05-10 audit)');
assert(!/baseData\s*\(\s*['"]data\//.test(helperSrc),
  'no path passed to baseData() starts with "data/"');
assert(/COUNTY_PATH\s*=\s*['"]hmda\//.test(helperSrc),
  'COUNTY_PATH starts with hmda/ (relative to data/)');
assert(/STATE_PATH\s*=\s*['"]hmda\//.test(helperSrc),
  'STATE_PATH starts with hmda/ (relative to data/)');

console.log('\n[test] HMDA data files exist + load');
const countyDoc = JSON.parse(readRel('data/hmda/co-county-aggregates.json'));
const stateDoc = JSON.parse(readRel('data/hmda/co-state-trends.json'));
assert(countyDoc.counties && Object.keys(countyDoc.counties).length === 64,
  'county doc has 64 CO counties');
assert(stateDoc.years && Object.keys(stateDoc.years).length >= 5,
  'state doc has ≥5 years of data');

// Spot-check a known county
const denver = countyDoc.counties['08031'];
assert(denver != null, 'Denver County (08031) present in HMDA county doc');
const denver2024 = denver && denver.years && denver.years['2024'];
assert(denver2024 != null, 'Denver has 2024 data');
assert(denver2024 && denver2024.originations > 5000,
  'Denver 2024 originations > 5000 (sanity)');
assert(denver2024 && denver2024.denial_rate > 0 && denver2024.denial_rate < 1,
  'Denver 2024 denial_rate in [0, 1]');
assert(denver2024 && denver2024.multifamily && denver2024.multifamily.originations > 0,
  'Denver 2024 has at least one multifamily origination');

console.log('\n[test] Deal Calculator wires HMDA context');
const dcSrc = readRel('js/deal-calculator.js');
assert(/dc-hmda-context/.test(dcSrc),
  'Deal Calculator HTML includes #dc-hmda-context container');
assert(/_renderHmdaContext/.test(dcSrc),
  'Deal Calculator defines _renderHmdaContext helper');
assert(/window\.HmdaLookup/.test(dcSrc),
  'Deal Calculator references window.HmdaLookup');
assert(/_renderHmdaContext\(fips\)/.test(dcSrc),
  'Deal Calculator calls _renderHmdaContext on county change');

console.log('\n[test] PMA simulator wires HMDA + cross-county disclosure');
const maSrc = readRel('js/market-analysis.js');
assert(/renderHmdaContext\s*\(/.test(maSrc),
  'PMA defines renderHmdaContext()');
assert(/window\.HmdaLookup/.test(maSrc),
  'PMA references window.HmdaLookup');
assert(/PMA buffer spans/.test(maSrc),
  'PMA shows multi-county buffer disclosure');

console.log('\n[test] HTML script tags load HMDA before consumers');
const dcHtml = readRel('deal-calculator.html');
const dcHmdaIdx = dcHtml.indexOf('hmda-lookup.js');
const dcCalcIdx = dcHtml.indexOf('js/deal-calculator.js');
assert(dcHmdaIdx >= 0,
  'deal-calculator.html includes hmda-lookup.js');
assert(dcHmdaIdx < dcCalcIdx,
  'deal-calculator.html: hmda-lookup.js loads BEFORE deal-calculator.js');

const maHtml = readRel('market-analysis.html');
const maHmdaIdx = maHtml.indexOf('hmda-lookup.js');
const maMaIdx = maHtml.indexOf('js/market-analysis.js');
assert(maHmdaIdx >= 0,
  'market-analysis.html includes hmda-lookup.js');
assert(maHmdaIdx < maMaIdx,
  'market-analysis.html: hmda-lookup.js loads BEFORE market-analysis.js');

const maCcIdx = maHtml.indexOf('cross-county-disclosure.js');
assert(maCcIdx >= 0,
  'market-analysis.html includes cross-county-disclosure.js');
assert(maCcIdx < maMaIdx,
  'market-analysis.html: cross-county-disclosure.js loads BEFORE market-analysis.js');

console.log('\n[test] PMA HTML has the new card');
assert(/id="pmaHmdaResult"/.test(maHtml),
  'market-analysis.html has #pmaHmdaResult container');
assert(/Mortgage Credit Access/.test(maHtml),
  'market-analysis.html has Mortgage Credit Access heading');

console.log('\n[test] Math sanity: state-vs-county delta is well-defined');
// Stub global window for module-style logic check (we just simulate the
// comparison computation here against the actual data).
function getCounty(fips) {
  var rec = countyDoc.counties[fips];
  if (!rec) return null;
  var years = Object.keys(rec.years).sort();
  var latest = years[years.length - 1];
  return Object.assign({ year: latest }, rec.years[latest]);
}
function getStateLatest() {
  var years = Object.keys(stateDoc.years).sort();
  var latest = years[years.length - 1];
  return Object.assign({ year: latest }, stateDoc.years[latest]);
}
const arapahoe = getCounty('08005');
const stateLatest = getStateLatest();
assert(arapahoe.year === stateLatest.year,
  'Arapahoe and state latest year align (' + arapahoe.year + ')');
const arapDelta = (arapahoe.denial_rate - stateLatest.denial_rate) * 100;
assert(Number.isFinite(arapDelta),
  'Arapahoe vs state denial-rate delta is finite (' + arapDelta.toFixed(2) + 'pp)');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
