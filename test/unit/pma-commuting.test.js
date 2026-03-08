// test/unit/pma-commuting.test.js
//
// Unit tests for js/pma-commuting.js
//
// Usage: node test/unit/pma-commuting.test.js
'use strict';

const path = require('path');

// ── Minimal window shim ──
global.window = global;

require(path.join(__dirname, '../../js/pma-commuting.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const C = global.PMACommuting;

test('PMACommuting exposed on window', function () {
  assert(typeof C === 'object' && C !== null, 'PMACommuting is an object');
  assert(typeof C.fetchLODESWorkplaces      === 'function', 'fetchLODESWorkplaces exported');
  assert(typeof C.analyzeCommutingFlows     === 'function', 'analyzeCommutingFlows exported');
  assert(typeof C.generateCommutingBoundary === 'function', 'generateCommutingBoundary exported');
  assert(typeof C.getJustificationData      === 'function', 'getJustificationData exported');
});

test('analyzeCommutingFlows — empty input', function () {
  const r = C.analyzeCommutingFlows([]);
  assert(r.originZones.length === 0,  'empty workplaces → 0 origin zones');
  assert(r.totalWorkers === 0,        'empty workplaces → 0 workers');
  assert(r.captureRate === 0,         'empty workplaces → 0 capture rate');
});

test('analyzeCommutingFlows — with workplaces', function () {
  const wps = [];
  for (let i = 0; i < 20; i++) {
    wps.push({ lat: 39.7 + i * 0.01, lon: -104.9 + i * 0.01,
               jobCount: 100 + i * 10, tractId: 'tract-' + i });
  }
  const r = C.analyzeCommutingFlows(wps);
  assert(r.originZones.length > 0,   'non-empty workplaces → origin zones');
  assert(r.totalWorkers > 0,         'totalWorkers > 0');
  assert(r.captureRate >= 0 && r.captureRate <= 1, 'captureRate in [0,1]');
});

test('generateCommutingBoundary — fallback with fewer than 3 zones', function () {
  const r = C.generateCommutingBoundary(39.7392, -104.9847, { originZones: [] });
  assert(r.boundary !== null,          'returns a boundary even for 0 zones');
  assert(r.fallback === true,          'fallback flag set');
  assert(r.boundary.type === 'Polygon','boundary is a GeoJSON Polygon');
});

test('generateCommutingBoundary — convex hull with 5+ zones', function () {
  const zones = [];
  for (let i = 0; i < 8; i++) {
    zones.push({ lat: 39.7 + i * 0.05, lon: -104.9 + i * 0.04,
                 tractId: 'z-' + i, estimatedWorkers: 200 });
  }
  const r = C.generateCommutingBoundary(39.7392, -104.9847, { originZones: zones });
  assert(r.fallback !== true,          'not a fallback when enough zones');
  assert(r.boundary.type === 'Polygon','convex hull is a GeoJSON Polygon');
  const ring = r.boundary.coordinates[0];
  assert(ring[0][0] === ring[ring.length-1][0] && ring[0][1] === ring[ring.length-1][1],
    'polygon ring is closed');
});

test('_buildCirclePolygon — produces closed GeoJSON polygon', function () {
  const poly = C._buildCirclePolygon(39.7, -104.9, 5, 16);
  assert(poly.type === 'Polygon',            'type is Polygon');
  const ring = poly.coordinates[0];
  assert(ring.length === 17,                 '16 sides + closing point = 17 coords');
  assert(ring[0][0] === ring[16][0],         'ring is closed (lon)');
  assert(ring[0][1] === ring[16][1],         'ring is closed (lat)');
});

test('fetchLODESWorkplaces — returns Promise resolving to {workplaces, commutingFlows}', function () {
  const p = C.fetchLODESWorkplaces(39.7, -104.9, 5);
  assert(typeof p.then === 'function', 'returns a Promise');
  // Resolved synchronously (no proxy configured → immediate stub)
  return p.then(function (r) {
    assert(Array.isArray(r.workplaces),      'workplaces is an Array');
    assert(Array.isArray(r.commutingFlows),  'commutingFlows is an Array');
  });
});

test('getJustificationData — shape', function () {
  const d = C.getJustificationData();
  assert(typeof d === 'object',                       'returns an object');
  assert(typeof d.lodesWorkplaces   === 'number',     'lodesWorkplaces is a number');
  assert(Array.isArray(d.residentOriginZones),        'residentOriginZones is an Array');
  assert(typeof d.captureRate       === 'number',     'captureRate is a number');
});

// ── Summary ──
console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) { process.exitCode = 1; }
