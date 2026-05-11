// test/hna-phase2-stubs-wired.test.js
//
// Phase 2: validates that the 5 remaining HNA stub renderers are now
// real implementations (no longer empty 1-line stubs).
//
// What it asserts
//   - renderBlsLabourMarket pulls per-county data + builds 4 KPI cards
//   - renderGapCoverageStats injects into the CHAS section when no
//     container exists (idempotent)
//   - renderHnaScorecardPanel builds a 4-card composite scorecard
//   - renderFastTrackCalculatorSection reads form values + computes a
//     timeline estimate into #ftResult
//   - renderHistoricalSection delegates to window.Prop123Tracker
//   - renderComplianceTable builds a year-by-year table (legacy helper)
//
// Run: node test/hna-phase2-stubs-wired.test.js

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

function readRel(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const renderersSrc = readRel('js/hna/hna-renderers.js');

function extractFn(src, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

console.log('\n[test] renderBlsLabourMarket no longer a stub');
const blsBody = extractFn(renderersSrc, 'renderBlsLabourMarket');
assert(blsBody !== null, 'function exists');
if (blsBody) {
  assert(blsBody.length > 300, 'body has substance (>300 chars)');
  assert(blsBody.includes('blsLabourMarketCards'), 'targets #blsLabourMarketCards');
  assert(blsBody.includes('unemployment_rate'), 'reads unemployment_rate');
  assert(blsBody.includes('job_growth_5yr_pct'), 'reads job_growth_5yr_pct');
  assert(blsBody.includes('CO_COUNTY_NAMES'), 'maps FIPS → county name');
}

console.log('\n[test] renderHnaScorecardPanel no longer a stub');
const scoreBody = extractFn(renderersSrc, 'renderHnaScorecardPanel');
assert(scoreBody !== null, 'function exists');
if (scoreBody) {
  assert(scoreBody.length > 300, 'body has substance (>300 chars)');
  assert(scoreBody.includes('hnaScorecardPanel'), 'targets #hnaScorecardPanel');
  assert(scoreBody.includes('pct_renter_cb30'), 'reads CHAS cost-burden rate');
  assert(/composite/i.test(scoreBody), 'builds a composite score');
}

console.log('\n[test] renderFastTrackCalculatorSection no longer a stub');
const ftBody = extractFn(renderersSrc, 'renderFastTrackCalculatorSection');
assert(ftBody !== null, 'function exists');
if (ftBody) {
  assert(ftBody.length > 200, 'body has substance');
  assert(/ftResult/.test(ftBody), 'writes to #ftResult');
  assert(/HB 22-1093|fast.track/i.test(ftBody), 'references HB 22-1093 / fast-track');
  assert(/estMonths|baseMonths/.test(ftBody), 'computes a timeline estimate');
}

console.log('\n[test] renderHistoricalSection no longer a stub');
const histBody = extractFn(renderersSrc, 'renderHistoricalSection');
assert(histBody !== null, 'function exists');
if (histBody) {
  assert(histBody.length > 200, 'body has substance');
  assert(/window\.Prop123Tracker/.test(histBody),
    'delegates to window.Prop123Tracker');
  assert(/prop123HistoricalContent/.test(histBody),
    'targets #prop123HistoricalContent');
}

console.log('\n[test] renderGapCoverageStats no longer a stub');
const gapBody = extractFn(renderersSrc, 'renderGapCoverageStats');
assert(gapBody !== null, 'function exists');
if (gapBody) {
  assert(gapBody.length > 200, 'body has substance');
  assert(/createElement/.test(gapBody),
    'injects container when not present (idempotent)');
  assert(/pct_renter_cb30/.test(gapBody),
    'reads CHAS cost-burden summary');
}

console.log('\n[test] renderComplianceTable produces year-by-year table');
const compBody = extractFn(renderersSrc, 'renderComplianceTable');
assert(compBody !== null, 'function exists');
if (compBody) {
  assert(/<table/.test(compBody), 'builds an HTML table');
  assert(/Required|Actual/.test(compBody), 'has required + actual columns');
}

console.log('\n[test] Controller stashes profile + contextCounty for Phase 2 panels');
const controllerSrc = readRel('js/hna/hna-controller.js');
assert(/state\.lastProfile\s*=\s*profile/.test(controllerSrc),
  'controller stashes state.lastProfile');
assert(/state\.contextCounty\s*=\s*contextCounty/.test(controllerSrc),
  'controller stashes state.contextCounty');

console.log('\n[test] BLS economic indicators data file present + well-formed');
const blsData = JSON.parse(readRel('data/co-county-economic-indicators.json'));
assert(blsData.counties && typeof blsData.counties === 'object',
  'data file has counties dict');
const cnames = Object.keys(blsData.counties);
assert(cnames.length >= 60,
  `≥60 CO counties present (found ${cnames.length})`);
const sample = blsData.counties[cnames[0]];
['unemployment_rate', 'job_growth_5yr_pct', 'population_growth_5yr_pct', 'affordability_index']
  .forEach(field => {
    assert(field in sample, 'each county has ' + field);
  });

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
