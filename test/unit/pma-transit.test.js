// test/unit/pma-transit.test.js
//
// Unit tests for js/pma-transit.js
//
// Usage: node test/unit/pma-transit.test.js
'use strict';

const path = require('path');
global.window = global;

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

test('calculateTransitScore — no routes → low score', function () {
  const score = T.calculateTransitScore(39.7, -104.9, [], {});
  assert(score >= 0 && score <= 100, 'score in [0,100]');
  assert(score < 50, 'no routes → score < 50');
});

test('calculateTransitScore — high-freq nearby routes → higher score', function () {
  const routes = [
    { routeId: 'R1', headwayMinutes: 10,
      stops: [{ lat: 39.701, lon: -104.901 }] },  // within 0.5 miles
    { routeId: 'R2', headwayMinutes: 12,
      stops: [{ lat: 39.702, lon: -104.902 }] }
  ];
  const score = T.calculateTransitScore(39.7, -104.9, routes, { transitAccessibility: 70, walkScore: 65 });
  assert(score > 0, 'score > 0 when routes present');
  assert(score <= 100, 'score ≤ 100');
});

test('calculateTransitScore — EPA index normalisation (0–20 range)', function () {
  // EPA D4a values are 0–20; module should scale ×5 to get 0–100
  const score = T.calculateTransitScore(39.7, -104.9, [], { transitAccessibility: 10, walkScore: 8 });
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
  assert(typeof j.walkScore                 === 'number', 'walkScore is number');
  assert(typeof j.nearbyRouteCount          === 'number', 'nearbyRouteCount is number');
  assert(typeof j.serviceGaps               === 'number', 'serviceGaps is number');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
