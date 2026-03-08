// test/unit/pma-barriers.test.js
//
// Unit tests for js/pma-barriers.js
//
// Usage: node test/unit/pma-barriers.test.js
'use strict';

const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/pma-barriers.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const B = global.PMABarriers;

test('PMABarriers exposed on window', function () {
  assert(typeof B === 'object',                       'PMABarriers is an object');
  assert(typeof B.fetchUSGSHydrology  === 'function', 'fetchUSGSHydrology exported');
  assert(typeof B.fetchNLCDLandCover  === 'function', 'fetchNLCDLandCover exported');
  assert(typeof B.fetchStateHighways  === 'function', 'fetchStateHighways exported');
  assert(typeof B.subtractBarriers    === 'function', 'subtractBarriers exported');
  assert(typeof B.getBarrierSummary   === 'function', 'getBarrierSummary exported');
});

test('BARRIER_LAND_COVER — expected codes present', function () {
  assert(B.BARRIER_LAND_COVER[11] === 'Open Water',    'code 11 = Open Water');
  assert(B.BARRIER_LAND_COVER[12] === 'Perennial Ice/Snow', 'code 12 = Ice/Snow');
  assert(B.BARRIER_LAND_COVER[95] === 'Emergent Herbaceous Wetlands', 'code 95 = Wetlands');
});

test('fetchUSGSHydrology — invalid bbox returns empty', function () {
  const p = B.fetchUSGSHydrology(null);
  assert(typeof p.then === 'function', 'returns Promise');
  p.then(function (r) {
    assert(Array.isArray(r.waterBodies), 'waterBodies is Array');
    assert(Array.isArray(r.streams),     'streams is Array');
  });
});

test('fetchUSGSHydrology — valid bbox returns Promise', function () {
  const bbox = { minLat: 39.5, maxLat: 40.0, minLon: -105.1, maxLon: -104.8 };
  const p    = B.fetchUSGSHydrology(bbox);
  assert(typeof p.then === 'function', 'returns Promise');
});

test('subtractBarriers — no barriers leaves polygon unchanged', function () {
  const poly = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] };
  const r    = B.subtractBarriers(poly, { waterBodies: [], highways: [], landCover: [] });
  assert(r.refinedBoundary === poly,   'polygon unchanged when no barriers');
  assert(r.hasBarriers === false,      'hasBarriers = false');
  assert(r.excludedAreas.water === 0,  'water exclusion = 0');
});

test('subtractBarriers — water bodies increase water exclusion', function () {
  const poly = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] };
  const wb   = [{ name: 'Lake A' }, { name: 'River B' }, { name: 'Pond C' }];
  const r    = B.subtractBarriers(poly, { waterBodies: wb, highways: [], landCover: [] });
  assert(r.excludedAreas.water > 0,    'water exclusion > 0 when water bodies present');
  assert(r.barrierFeatures.some(f => f.type === 'water'), 'barrierFeatures includes water entry');
});

test('subtractBarriers — highway exclusion capped at 0.15', function () {
  const poly = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] };
  const hws  = Array.from({ length: 30 }, function (_, i) { return { name: 'I-' + i }; });
  const r    = B.subtractBarriers(poly, { waterBodies: [], highways: hws, landCover: [] });
  assert(r.excludedAreas.highways <= 0.15, 'highway exclusion capped at 0.15');
});

test('getBarrierSummary — shape', function () {
  const s = B.getBarrierSummary();
  assert(typeof s.waterBodiesExcluded === 'number', 'waterBodiesExcluded is a number');
  assert(typeof s.highwaysExcluded    === 'number', 'highwaysExcluded is a number');
  assert(typeof s.totalExcluded       === 'number', 'totalExcluded is a number');
  assert(s.totalExcluded <= 0.8,                    'totalExcluded never exceeds 0.8');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
