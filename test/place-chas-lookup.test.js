// test/place-chas-lookup.test.js
//
// Tests for js/place-chas-lookup.js + the data file
// data/hna/place-chas.json. Verifies:
//   - Helper module exposes expected API
//   - Data file structure + key cross-county jurisdictions present
//   - HNA renderer + controller reference the new module
//   - HTML script tag wires the module before hna-renderers.js
//
// Run: node test/place-chas-lookup.test.js

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

console.log('\n[test] place-chas-lookup.js exposes expected API');
const helperSrc = readRel('js/place-chas-lookup.js');
assert(/window\.PlaceChas\s*=\s*\{/.test(helperSrc),
  'attaches PlaceChas to window');
['init', 'lookup', 'compareToCounty', 'formatComparison'].forEach((fn) => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(helperSrc),
    'defines ' + fn + '() function');
});

console.log('\n[test] place-chas.json data file structure');
const data = JSON.parse(readRel('data/hna/place-chas.json'));
assert(data.meta && data.places, 'has meta + places top-level keys');
assert(typeof data.meta.count_places === 'number' && data.meta.count_places >= 400,
  'meta.count_places ≥ 400');
assert(typeof data.meta.vintage_chas === 'string',
  'meta.vintage_chas is string');
assert(typeof data.meta.vintage_tiger === 'number',
  'meta.vintage_tiger is number');
assert(/area-weighted/i.test(data.meta.method),
  'meta.method describes area-weighted apportionment');

console.log('\n[test] Cross-county places present with TIGER-derived rates');
// These places span multiple counties — their CHAS should now be
// place-level (TIGER-aggregated) rather than primary-county fallback.
const REQUIRED = {
  '0824950': 'Erie',
  '0804000': 'Aurora',
  '0845970': 'Longmont',
  '0875640': 'Superior',
  '0885485': 'Windsor',
};
Object.keys(REQUIRED).forEach((geoid) => {
  const expected = REQUIRED[geoid];
  const p = data.places[geoid];
  assert(p != null,
    geoid + ' (' + expected + ') is in place-CHAS doc');
  if (p) {
    assert(p.tract_count >= 1,
      geoid + ' has at least one underlying tract');
    assert(p.summary && typeof p.summary.renter_cb30_share === 'number',
      geoid + ' has summary.renter_cb30_share');
    assert(p.summary.renter_cb30_share >= 0 && p.summary.renter_cb30_share <= 1,
      geoid + ' renter_cb30_share is in [0,1]');
  }
});

console.log('\n[test] Aurora has plausible renter HH count (large city)');
const aurora = data.places['0804000'];
assert(aurora && aurora.summary.total_renter_hh > 30000,
  'Aurora renter total > 30K (it is CO\'s 3rd largest city)');
assert(aurora && aurora.summary.total_renter_hh < 80000,
  'Aurora renter total < 80K (sanity ceiling)');

console.log('\n[test] HNA renderers reference window.PlaceChas');
const renderersSrc = readRel('js/hna/hna-renderers.js');
assert(/window\.PlaceChas/.test(renderersSrc),
  'hna-renderers.js references window.PlaceChas');
assert(/_tigerPlaceTiers/.test(renderersSrc),
  'hna-renderers.js defines _tigerPlaceTiers helper for TIGER path');
assert(/TIGER 2024/.test(renderersSrc),
  'hna-renderers.js attribution mentions TIGER 2024');

console.log('\n[test] HNA controller initializes PlaceChas');
const controllerSrc = readRel('js/hna/hna-controller.js');
assert(/window\.PlaceChas\.init/.test(controllerSrc),
  'hna-controller.js calls PlaceChas.init() before rendering CHAS chart');

console.log('\n[test] HTML script tag loads place-chas-lookup before hna-renderers');
const htmlSrc = readRel('housing-needs-assessment.html');
const placeChasIdx = htmlSrc.indexOf('place-chas-lookup.js');
const renderersIdx = htmlSrc.indexOf('hna/hna-renderers.js');
assert(placeChasIdx >= 0,
  'housing-needs-assessment.html includes place-chas-lookup.js');
assert(renderersIdx >= 0 && placeChasIdx < renderersIdx,
  'place-chas-lookup.js loads BEFORE hna-renderers.js');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
