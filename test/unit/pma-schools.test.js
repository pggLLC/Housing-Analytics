// test/unit/pma-schools.test.js
//
// Unit tests for js/pma-schools.js
//
// Usage: node test/unit/pma-schools.test.js
'use strict';

const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/pma-schools.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const S = global.PMASchools;

test('PMASchools exposed on window', function () {
  assert(typeof S === 'object',                          'PMASchools is an object');
  assert(typeof S.fetchSchoolBoundaries    === 'function', 'fetchSchoolBoundaries exported');
  assert(typeof S.alignPMAWithSchools      === 'function', 'alignPMAWithSchools exported');
  assert(typeof S.scoreSchoolAccessibility === 'function', 'scoreSchoolAccessibility exported');
  assert(typeof S.getSchoolLayer           === 'function', 'getSchoolLayer exported');
  assert(typeof S.getSchoolJustification   === 'function', 'getSchoolJustification exported');
});

test('alignPMAWithSchools — no polygon, no districts', function () {
  const r = S.alignPMAWithSchools(null, []);
  assert(r.districtCount === 0,              'districtCount = 0');
  assert(r.alignedDistricts.length === 0,    'alignedDistricts empty');
  assert(typeof r.alignmentRationale === 'string', 'rationale is a string');
});

test('alignPMAWithSchools — districts within 10 miles are aligned', function () {
  const poly = {
    type: 'Polygon',
    coordinates: [[[-104.99, 39.73],[-104.97, 39.73],[-104.97, 39.75],[-104.99, 39.75],[-104.99, 39.73]]]
  };
  const districts = [
    { name: 'DPS',      lat: 39.74, lon: -104.98, performanceScore: 80 },  // ~0.5 miles
    { name: 'Jeffco',   lat: 39.65, lon: -105.10, performanceScore: 70 },  // ~8 miles — in
    { name: 'Far Away', lat: 40.50, lon: -104.50, performanceScore: 60 }   // ~60 miles — out
  ];
  const r = S.alignPMAWithSchools(poly, districts);
  assert(r.districtCount >= 2,               'at least 2 nearby districts aligned');
  assert(r.averagePerformanceScore > 0,      'averagePerformanceScore > 0');
  assert(r.alignedDistricts.every(function (d) { return d.distanceMiles !== undefined; }),
    'all aligned districts have distanceMiles');
});

test('scoreSchoolAccessibility — neutral when no schools', function () {
  const score = S.scoreSchoolAccessibility(39.7, -104.9, []);
  assert(score === 50, 'score is 50 (neutral) when no schools');
});

test('scoreSchoolAccessibility — high performance nearby → higher score', function () {
  const schools = [{ lat: 39.7, lon: -104.9, performanceScore: 95 }];
  const score   = S.scoreSchoolAccessibility(39.7, -104.9, schools);
  assert(score > 50, 'high-performance nearby school → score > 50');
  assert(score <= 100, 'score capped at 100');
});

test('getSchoolLayer — GeoJSON FeatureCollection', function () {
  const layer = S.getSchoolLayer([
    { name: 'Test SD', lat: 39.7, lon: -104.9, performanceScore: 75 }
  ]);
  assert(layer.type === 'FeatureCollection',      'type is FeatureCollection');
  assert(Array.isArray(layer.features),           'features is an Array');
  assert(layer.features.length === 1,             '1 feature for 1 district');
  assert(layer.features[0].geometry.type === 'Point', 'feature geometry is Point');
});

test('getSchoolJustification — shape', function () {
  const j = S.getSchoolJustification();
  assert(typeof j.schoolDistrictsAligned   === 'number', 'schoolDistrictsAligned is number');
  assert(typeof j.averagePerformanceScore  === 'number', 'averagePerformanceScore is number');
  assert(typeof j.accessibilityScore       === 'number', 'accessibilityScore is number');
  assert(typeof j.alignmentRationale       === 'string', 'alignmentRationale is string');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
