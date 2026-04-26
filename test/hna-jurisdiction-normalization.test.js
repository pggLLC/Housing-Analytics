'use strict';
/**
 * test/hna-jurisdiction-normalization.test.js
 *
 * Validates the fix for the "Fruita/Boulder anomaly" bug — where
 * countyFromGeoid in js/hna/hna-utils.js silently fell back to Mesa
 * County (08077) for any place not in the small __HNA_GEO_CONFIG
 * featured/places/cdps lists, causing comparison panels to label
 * Mesa data with non-Mesa geography names.
 *
 * The fix:
 *   1. Adds a registry-lookup pathway (window.__HNA_GEOGRAPHY_REGISTRY)
 *      that covers all 513 CO places + CDPs with their containingCounty.
 *   2. Drops the bogus '08077' fallback — returns null for genuinely
 *      unknown geoids.
 *
 * Run: node test/hna-jurisdiction-normalization.test.js
 */

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
global.document = dom.window.document;
global.window   = dom.window;

// Make `location` available — hna-utils.js reads `location.search` at top level
global.location = dom.window.location;

require('../js/hna/hna-utils.js');
const U = window.HNAUtils;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

// Reset state between tests
function reset() {
  delete window.__HNA_GEO_CONFIG;
  delete window.__HNA_GEOGRAPHY_REGISTRY;
}

test('countyFromGeoid: county type returns geoid itself', function () {
  reset();
  assert(U.countyFromGeoid('county', '08001') === '08001', 'Adams county geoid');
  assert(U.countyFromGeoid('county', '08077') === '08077', 'Mesa county geoid');
});

test('countyFromGeoid: state type returns null', function () {
  reset();
  assert(U.countyFromGeoid('state', '08') === null, 'state has no single county');
});

test('countyFromGeoid: featured config (legacy fast path) still works', function () {
  reset();
  window.__HNA_GEO_CONFIG = {
    featured: [
      { type: 'place', geoid: '0828745', label: 'Fruita (city)', containingCounty: '08077' }
    ],
    places: [],
    cdps: []
  };
  assert(U.countyFromGeoid('place', '0828745') === '08077', 'Fruita resolves to Mesa via featured');
});

test('countyFromGeoid: unknown geoid returns null (no Mesa fabrication)', function () {
  reset();
  window.__HNA_GEO_CONFIG = { featured: [], places: [], cdps: [] };
  // Boulder city (0807850) is NOT in the empty config — must not silently
  // become Mesa (08077). Pre-fix: returned '08077'. Post-fix: returns null.
  const result = U.countyFromGeoid('place', '0807850');
  assert(result === null, 'unknown place returns null (was incorrectly 08077 before fix)');
});

test('countyFromGeoid: registry resolves Boulder city correctly', function () {
  reset();
  window.__HNA_GEO_CONFIG = { featured: [], places: [], cdps: [] };
  window.__HNA_GEOGRAPHY_REGISTRY = {
    geographies: [
      { geoid: '08013',   name: 'Boulder County',  type: 'county' },
      { geoid: '0807850', name: 'Boulder (city)',  type: 'place', containingCounty: '08013' },
      { geoid: '0828745', name: 'Fruita (city)',   type: 'place', containingCounty: '08077' }
    ]
  };
  assert(U.countyFromGeoid('place', '0807850') === '08013',
    'Boulder city resolves to Boulder County (08013) via registry — NOT to Mesa');
  assert(U.countyFromGeoid('place', '0828745') === '08077',
    'Fruita resolves to Mesa County (08077) via registry');
});

test('countyFromGeoid: registry takes precedence when config lacks entry', function () {
  reset();
  // Boulder city not in config but IS in registry
  window.__HNA_GEO_CONFIG = { featured: [], places: [], cdps: [] };
  window.__HNA_GEOGRAPHY_REGISTRY = {
    geographies: [
      { geoid: '0807850', name: 'Boulder (city)', type: 'place', containingCounty: '08013' }
    ]
  };
  assert(U.countyFromGeoid('place', '0807850') === '08013', 'registry rescues missing config entry');
});

test('countyFromGeoid: config wins over registry for featured (fast path)', function () {
  reset();
  // Hypothetical conflict — config and registry disagree. Config wins
  // (it's the in-memory authoritative source for featured geos).
  window.__HNA_GEO_CONFIG = {
    featured: [{ geoid: 'FAKE', containingCounty: '08001' }],
    places: [], cdps: []
  };
  window.__HNA_GEOGRAPHY_REGISTRY = {
    geographies: [{ geoid: 'FAKE', containingCounty: '08077', type: 'place' }]
  };
  assert(U.countyFromGeoid('place', 'FAKE') === '08001', 'config takes precedence');
});

test('countyFromGeoid: CDP type works through registry', function () {
  reset();
  window.__HNA_GEO_CONFIG = { featured: [], places: [], cdps: [] };
  window.__HNA_GEOGRAPHY_REGISTRY = {
    geographies: [
      { geoid: '0815165', name: 'Clifton (CDP)', type: 'cdp', containingCounty: '08077' },
      { geoid: '0836410', name: 'Highlands Ranch (CDP)', type: 'cdp', containingCounty: '08035' }
    ]
  };
  assert(U.countyFromGeoid('cdp', '0815165') === '08077', 'Clifton CDP → Mesa');
  assert(U.countyFromGeoid('cdp', '0836410') === '08035', 'Highlands Ranch CDP → Douglas');
});

test('countyFromGeoid: places NOT in registry still return null', function () {
  reset();
  window.__HNA_GEOGRAPHY_REGISTRY = {
    geographies: [
      { geoid: '0807850', name: 'Boulder', type: 'place', containingCounty: '08013' }
    ]
  };
  // Some hypothetical place geoid not in registry
  assert(U.countyFromGeoid('place', '0899999') === null,
    'truly unknown geoid returns null (no fabrication)');
});

test('ensureGeographyRegistry exported', function () {
  assert(typeof U.ensureGeographyRegistry === 'function',
    'ensureGeographyRegistry is exported');
});

test('ensureGeographyRegistry returns cached registry if already loaded', async function () {
  reset();
  const fake = { geographies: [{ geoid: 'X' }] };
  window.__HNA_GEOGRAPHY_REGISTRY = fake;
  const result = await U.ensureGeographyRegistry();
  assert(result === fake, 'returns the cached object');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
