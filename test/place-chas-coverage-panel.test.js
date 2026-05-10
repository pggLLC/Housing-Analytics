// test/place-chas-coverage-panel.test.js
//
// Tests for js/place-chas-coverage-panel.js + the dashboard wiring.
// Verifies:
//   - Module exposes expected API
//   - Path convention (relative-to-data/, regression-guarding the PR #791 bug)
//   - Dashboard HTML mounts the panel
//
// Run: node test/place-chas-coverage-panel.test.js

'use strict';

const fs   = require('fs');
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

console.log('\n[test] place-chas-coverage-panel.js structure');
const panelSrc = readRel('js/place-chas-coverage-panel.js');
assert(/window\.PlaceChasCoveragePanel\s*=\s*\{/.test(panelSrc),
  'attaches PlaceChasCoveragePanel to window');
assert(/function\s+init\s*\(/.test(panelSrc),
  'defines init()');
assert(/function\s+render\s*\(/.test(panelSrc),
  'defines render()');

console.log('\n[test] No double-data/ prefix bug (PR #791 regression guard)');
assert(!/baseData\s*\(\s*['"]data\//.test(panelSrc),
  'no path passed to baseData() starts with "data/"');
assert(/STATS_PATH\s*=\s*['"]hna\//.test(panelSrc),
  'STATS_PATH starts with hna/ (relative to data/)');

console.log('\n[test] Dashboard HTML wires the panel');
const html = readRel('dashboard-data-quality.html');
assert(/place-chas-coverage-panel\.js/.test(html),
  'dashboard-data-quality.html includes place-chas-coverage-panel.js');
assert(/id="placeChasCoverage"/.test(html),
  'dashboard has #placeChasCoverage container');
assert(/Place-Level Data Coverage/.test(html),
  'dashboard has "Place-Level Data Coverage" heading');

console.log('\n[test] Coverage data file structure');
const stats = JSON.parse(readRel('data/hna/place-chas-coverage-stats.json'));
assert(stats.totals && typeof stats.totals.coverage_pct === 'number',
  'stats.totals.coverage_pct is numeric');
assert(stats.totals.coverage_pct >= 85,
  'coverage_pct ≥ 85% floor');
assert(Array.isArray(stats.uncovered_places),
  'uncovered_places is an array');
assert(typeof stats.by_county === 'object',
  'by_county is an object');
assert(stats.totals.covered_via_alias >= 25,
  'phantom-alias bucket nonempty (regression guard for PR #791)');

console.log('\n[test] Per-county arithmetic reconciles');
const sumOfBuckets = (
  stats.totals.covered_direct +
  stats.totals.covered_via_alias +
  stats.totals.covered_with_zero_apportion +
  stats.totals.uncovered_county_fallback
);
assert(sumOfBuckets === stats.totals.registry_places,
  `buckets sum (${sumOfBuckets}) === registry_places (${stats.totals.registry_places})`);

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
