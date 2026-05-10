// test/county-from-coords.test.js
//
// Tests for js/county-from-coords.js — point-in-polygon lookup of CO
// counties from lat/lon. Verifies:
//   - Module structure + API surface
//   - Path-convention regression guard (PR #791)
//   - Point-in-polygon math for known city centroids
//     (Denver, Colorado Springs, Pueblo, Aurora, Boulder, Fort Collins,
//      Grand Junction, Durango, Steamboat Springs)
//   - Bbox pre-filter rejects outside-CO points
//   - Deal Calculator wiring + HTML script ordering
//
// Run: node test/county-from-coords.test.js

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

function readRel(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

console.log('\n[test] Module structure');
const src = readRel('js/county-from-coords.js');
assert(/window\.CountyFromCoords\s*=\s*\{/.test(src),
  'attaches CountyFromCoords to window');
['init', 'lookup', 'lookupSync', 'isReady'].forEach((fn) => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(src),
    'defines ' + fn + '() function');
});
['_pointInRing', '_pointInFeature', '_extractRings', '_normalizeFeatures', '_computeBbox'].forEach((fn) => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(src),
    'defines internal helper ' + fn + '()');
});

console.log('\n[test] Path convention regression guard (PR #791)');
assert(!/baseData\s*\(\s*['"]data\//.test(src),
  'no path passed to baseData() starts with "data/"');
assert(/BOUNDARIES_PATH\s*=\s*['"](?!data\/)/.test(src),
  'BOUNDARIES_PATH does not start with "data/"');

console.log('\n[test] Point-in-polygon math: known city centroids land in correct county');

// Load the module in a sandbox + run point-in-polygon tests against
// the real boundary data.
const boundaries = JSON.parse(readRel('data/co-county-boundaries.json'));
const sandbox = { window: {}, fetch: function () { return Promise.resolve({ json: () => Promise.resolve(boundaries) }); } };
sandbox.window.fetch = sandbox.fetch;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const cfc = sandbox.window.CountyFromCoords;
assert(typeof cfc === 'object' && cfc != null,
  'module loads in sandbox');

// Pre-load synchronously by calling _normalizeFeatures equivalent
// — easier path: call init() and await
async function runMathTests() {
  await cfc.init();
  assert(cfc.isReady(), 'isReady() returns true after init');

  // Known city-hall lat/lon → expected county FIPS
  // Sources: standard public knowledge / GeoNames
  const cases = [
    { lat: 39.7392, lon: -104.9903,  expectedFips: '08031', expectedName: 'Denver',     city: 'Denver' },
    { lat: 38.8339, lon: -104.8214,  expectedFips: '08041', expectedName: 'El Paso',    city: 'Colorado Springs' },
    { lat: 38.2544, lon: -104.6091,  expectedFips: '08101', expectedName: 'Pueblo',     city: 'Pueblo' },
    { lat: 39.7294, lon: -104.8319,  expectedFips: '08005', expectedName: 'Arapahoe',   city: 'Aurora (Arapahoe portion)' },
    { lat: 40.0150, lon: -105.2705,  expectedFips: '08013', expectedName: 'Boulder',    city: 'Boulder' },
    { lat: 40.5853, lon: -105.0844,  expectedFips: '08069', expectedName: 'Larimer',    city: 'Fort Collins' },
    { lat: 39.0639, lon: -108.5506,  expectedFips: '08077', expectedName: 'Mesa',       city: 'Grand Junction' },
    { lat: 37.2753, lon: -107.8801,  expectedFips: '08067', expectedName: 'La Plata',   city: 'Durango' },
    { lat: 40.4850, lon: -106.8317,  expectedFips: '08107', expectedName: 'Routt',      city: 'Steamboat Springs' },
    { lat: 39.5501, lon: -105.7821,  expectedFips: '08093', expectedName: 'Park',       city: 'Bailey' },
  ];

  for (const c of cases) {
    const result = cfc.lookupSync(c.lat, c.lon);
    if (result && result.fips === c.expectedFips) {
      console.log('  ✅ PASS: ' + c.city + ' (' + c.lat + ',' + c.lon + ') → ' + result.name + ' County (' + result.fips + ')');
      passed++;
    } else {
      const got = result ? (result.name + ' County / ' + result.fips) : 'null';
      console.error('  ❌ FAIL: ' + c.city + ' expected ' + c.expectedName + ' (' + c.expectedFips + '), got ' + got);
      failed++;
    }
  }

  // Outside-CO bbox should return null
  const outside = [
    { lat: 35.0,    lon: -100.0,  city: 'Texas Panhandle' },
    { lat: 41.5,    lon: -111.0,  city: 'Wyoming' },
    { lat: 40.0,    lon: -100.0,  city: 'Nebraska' },
  ];
  for (const c of outside) {
    const result = cfc.lookupSync(c.lat, c.lon);
    assert(result === null,
      'Outside-CO point (' + c.city + ') returns null');
  }

  // Invalid input handling
  assert(cfc.lookupSync(NaN, -105) === null,
    'NaN lat returns null');
  assert(cfc.lookupSync(40, undefined) === null,
    'undefined lon returns null');
}

(async function () {
  await runMathTests();

  console.log('\n[test] Deal Calculator wiring');
  const dcSrc = readRel('js/deal-calculator.js');
  assert(/dc-coords-lat/.test(dcSrc) && /dc-coords-lon/.test(dcSrc),
    'Deal Calculator HTML has #dc-coords-lat and #dc-coords-lon inputs');
  assert(/dc-coords-detect/.test(dcSrc),
    'Deal Calculator has #dc-coords-detect button');
  assert(/dc-coords-geo/.test(dcSrc),
    'Deal Calculator has #dc-coords-geo (geolocation) button');
  assert(/_wireCountyDetect/.test(dcSrc),
    'Deal Calculator defines _wireCountyDetect helper');
  assert(/window\.CountyFromCoords/.test(dcSrc),
    'Deal Calculator references window.CountyFromCoords');
  assert(/navigator\.geolocation/.test(dcSrc),
    'Deal Calculator uses navigator.geolocation for "Use my location"');

  console.log('\n[test] HTML script tag ordering');
  const html = readRel('deal-calculator.html');
  const cfcIdx = html.indexOf('county-from-coords.js');
  const dcIdx  = html.indexOf('js/deal-calculator.js');
  assert(cfcIdx >= 0,
    'deal-calculator.html includes county-from-coords.js');
  assert(cfcIdx < dcIdx,
    'county-from-coords.js loads BEFORE deal-calculator.js');

  console.log('\n=========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})();
