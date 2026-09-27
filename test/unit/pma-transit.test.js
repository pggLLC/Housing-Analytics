// test/unit/pma-transit.test.js
//
// Unit tests for js/pma-transit.js
//
// Usage: node test/unit/pma-transit.test.js
'use strict';

const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/transit-zone.js'));
require(path.join(__dirname, '../../js/pma-transit.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const T = global.PMATransit;
const MAP_STATUS = JSON.parse(require('fs').readFileSync(path.join(__dirname, '../../data/policy/thiz-map-status.json'), 'utf8'));

test('PMATransit exposed on window', function () {
  assert(typeof T === 'object',                              'PMATransit is an object');
  assert(typeof T.calculateTransitScore   === 'function',    'calculateTransitScore exported');
  assert(typeof T.identifyTransitDeserts  === 'function',    'identifyTransitDeserts exported');
  assert(typeof T.getTransitLayer         === 'function',    'getTransitLayer exported');
  assert(typeof T.getTransitJustification === 'function',    'getTransitJustification exported');
  assert(typeof T.TRANSIT_WEIGHTS         === 'object',      'TRANSIT_WEIGHTS exported');
});

test('TRANSIT_WEIGHTS sum to 1.0', function () {
  const sum = Object.values(T.TRANSIT_WEIGHTS).reduce(function (a, b) { return a + b; }, 0);
  assert(Math.abs(sum - 1.0) < 0.001, 'TRANSIT_WEIGHTS sum ≈ 1.0 (got ' + sum + ')');
});

// A stop file as data/amenities/transit_stops_statewide_co.geojson writes it.
function stopFile(points) {
  return { type: 'FeatureCollection', features: points.map(function (p) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { name: 'S', agency: 'A', operator: 'public', reliability: 'confirmed', service: 'fixed_route' } };
  }) };
}

test('calculateTransitScore — no stops nearby → low score', function () {
  const score = T.calculateTransitScore(39.7, -104.9, stopFile([{ lat: 37.0, lon: -102.1 }]), {}, MAP_STATUS);
  assert(score >= 0 && score <= 100, 'score in [0,100]');
  assert(score < 50, 'no stops nearby → score < 50');
});

test('calculateTransitScore — nearby confirmed stops → higher score', function () {
  const stops = stopFile([{ lat: 39.701, lon: -104.901 }, { lat: 39.702, lon: -104.902 }]);  // within 0.5 miles
  const score = T.calculateTransitScore(39.7, -104.9, stops, { transitAccessibility: 70, walkScore: 65 }, MAP_STATUS);
  assert(score > 0, 'score > 0 when stops present');
  assert(score <= 100, 'score ≤ 100');
});

test('calculateTransitScore — EPA index normalisation (0–20 range)', function () {
  // EPA D4a values are 0–20; module should scale ×5 to get 0–100
  const score = T.calculateTransitScore(39.7, -104.9, stopFile([{ lat: 37.0, lon: -102.1 }]), { transitAccessibility: 10, walkScore: 8 }, MAP_STATUS);
  assert(score >= 0 && score <= 100, 'score in [0,100] for EPA 0-20 input');
});

test('identifyTransitDeserts — no polygon → empty', function () {
  const deserts = T.identifyTransitDeserts(null, []);
  assert(Array.isArray(deserts), 'returns Array');
  assert(deserts.length === 0,   'empty for null polygon');
});

test('getTransitLayer — FeatureCollection with stops', function () {
  const routes = [{
    routeId: 'R1', name: 'Test Bus',
    stops: [{ lat: 39.7, lon: -104.9 }, { lat: 39.71, lon: -104.91 }]
  }];
  const layer = T.getTransitLayer(routes);
  assert(layer.type === 'FeatureCollection', 'type is FeatureCollection');
  assert(layer.features.length === 2,        '2 stop features');
  assert(layer.features[0].geometry.type === 'Point', 'feature is a Point');
});

test('getTransitJustification — shape', function () {
  const j = T.getTransitJustification();
  assert(typeof j.transitAccessibilityScore === 'number', 'transitAccessibilityScore is number');
  // walkScore is deliberately null when EPA Smart Location data is unavailable
  // (js/pma-transit.js:236 — `lastWalkScore = hasWalk ? walkScore : null`), so a
  // missing walk environment is distinguishable from a genuinely zero one. This
  // once required a number, which forbids exactly that signal. `walkScoreAvailable`
  // is the companion flag, so assert the two agree rather than banning null.
  assert(j.walkScore === null || typeof j.walkScore === 'number',
    'walkScore is a number or null (null = EPA data unavailable)');
  assert(typeof j.walkScoreAvailable === 'boolean',
    'walkScoreAvailable is a boolean');
  if (j.walkScore === null) {
    assert(j.walkScoreAvailable === false,
      'a null walkScore is reported as unavailable, not as a real zero');
  }
  assert(typeof j.nearbyStopCount           === 'number', 'nearbyStopCount is number');
  assert(typeof j.serviceGaps               === 'number', 'serviceGaps is number');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
