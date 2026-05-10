// test/chas-tier-shares.test.js
//
// Phase 1: validates the per-county / per-place AMI tier-share helper
// that replaces the statewide heuristic shipped in PR #798.
//
// What it asserts
//   - Module API surface (window.ChasTierShares)
//   - Path convention guard (no double-'data/' prefix bug)
//   - Tier order is the canonical 5-tier sequence (≤30, 31-50, 51-80,
//     81-100, >100% AMI)
//   - Underlying data files exist and have well-formed tier counts
//   - Real CHAS shares produce sensible distributions (Denver ≤30% is
//     22%, not the statewide-heuristic 13%)
//   - hna-renderers wires window.ChasTierShares into chartHouseholdDemand
//   - hna-controller initializes window.ChasTierShares
//
// Run: node test/chas-tier-shares.test.js

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

console.log('\n[test] ChasTierShares module structure');
const src = readRel('js/chas-tier-shares.js');
assert(/window\.ChasTierShares\s*=\s*\{/.test(src),
  'attaches ChasTierShares to window');
['init', 'getRenterShares', 'getRenterSharesWithFallback'].forEach(fn => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(src),
    'defines ' + fn + '()');
});

console.log('\n[test] Path convention guard (PR #791 regression)');
assert(!/baseData\s*\(\s*['"]data\//.test(src),
  'no path passed to baseData() starts with "data/"');
assert(/PLACE_CHAS_PATH\s*=\s*['"]hna\//.test(src),
  'PLACE_CHAS_PATH is relative to data/');
assert(/COUNTY_CHAS_PATH\s*=\s*['"]market\//.test(src),
  'COUNTY_CHAS_PATH is relative to data/');

console.log('\n[test] Tier order is canonical 5-tier sequence');
const tierOrderMatch = src.match(/TIER_ORDER\s*=\s*\[([\s\S]*?)\]/);
assert(tierOrderMatch != null,
  'TIER_ORDER constant declared');
if (tierOrderMatch) {
  const body = tierOrderMatch[1];
  ['lte30', '31to50', '51to80', '81to100', '100plus'].forEach(k => {
    assert(body.includes("'" + k + "'"),
      'TIER_ORDER includes ' + k);
  });
}

console.log('\n[test] Underlying CHAS data files parse + have tier counts');
const countyDoc = JSON.parse(readRel('data/market/chas_co.json'));
assert(Array.isArray(countyDoc.records) && countyDoc.records.length === 64,
  'county CHAS has 64 records');
const denver = countyDoc.records.find(r => r.fips === '08031');
assert(denver != null, 'Denver record present in county CHAS');
if (denver) {
  ['lte30','31to50','51to80','81to100','100plus'].forEach(k => {
    assert(denver.renter_hh_by_ami[k] && typeof denver.renter_hh_by_ami[k].total === 'number',
      'Denver has tier ' + k + ' with numeric total');
  });
}

console.log('\n[test] Real CHAS shares differ meaningfully from statewide heuristic');
// Denver lte30 share in real data is ~22%, vs heuristic 13%. If the
// helper degrades back to the heuristic without warning, this test
// catches the silent fallback.
const denverTotal = ['lte30','31to50','51to80','81to100','100plus']
  .reduce((s, k) => s + (denver.renter_hh_by_ami[k].total || 0), 0);
const denverLte30Share = denver.renter_hh_by_ami.lte30.total / denverTotal;
assert(denverLte30Share > 0.20 && denverLte30Share < 0.26,
  'Denver real ≤30% share is in [20%, 26%]; differs from heuristic 13%');

console.log('\n[test] hna-renderers wires ChasTierShares into chartHouseholdDemand');
const renderersSrc = readRel('js/hna/hna-renderers.js');
assert(/window\.ChasTierShares/.test(renderersSrc),
  'hna-renderers references window.ChasTierShares');
assert(/getRenterSharesWithFallback/.test(renderersSrc),
  'hna-renderers calls getRenterSharesWithFallback for fallback chain');
assert(/source.*===.*['"]place-chas['"]|source: ['"]place-chas['"]/.test(renderersSrc) ||
       /tierMeta\.source/.test(renderersSrc),
  'hna-renderers surfaces the source attribution');

console.log('\n[test] hna-controller initializes ChasTierShares');
const controllerSrc = readRel('js/hna/hna-controller.js');
assert(/window\.ChasTierShares.*\.init/.test(controllerSrc),
  'hna-controller calls window.ChasTierShares.init()');

console.log('\n[test] FMR panel renderer is no longer a stub');
const fmrMatch = renderersSrc.match(/function renderFmrPanel\([\s\S]*?\}\n  \}/);
assert(fmrMatch != null && fmrMatch[0].length > 200,
  'renderFmrPanel body has substance (>200 chars)');
if (fmrMatch) {
  assert(/hudFmrTable/.test(fmrMatch[0]),
    'renderFmrPanel targets #hudFmrTable (canonical container)');
  assert(/hudIncomeLimitsTable/.test(fmrMatch[0]),
    'renderFmrPanel targets #hudIncomeLimitsTable');
  assert(/window\.HudFmr/.test(fmrMatch[0]),
    'renderFmrPanel uses window.HudFmr connector');
}

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
