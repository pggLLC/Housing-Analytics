// test/unit/pma-infrastructure.test.js
//
// Unit tests for js/pma-infrastructure.js
//
// Usage: node test/unit/pma-infrastructure.test.js
'use strict';

const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/pma-infrastructure.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const I = global.PMAInfrastructure;

test('PMAInfrastructure exposed on window', function () {
  assert(typeof I === 'object',                                     'PMAInfrastructure is an object');
  assert(typeof I.buildInfrastructureScorecard  === 'function',     'buildInfrastructureScorecard exported');
  assert(typeof I.getInfrastructureScore        === 'function',     'getInfrastructureScore exported');
  assert(typeof I.getInfrastructureLayer        === 'function',     'getInfrastructureLayer exported');
  assert(typeof I.getInfrastructureJustification === 'function',    'getInfrastructureJustification exported');
  assert(typeof I.INFRA_WEIGHTS                  === 'object',      'INFRA_WEIGHTS exported');
});

test('INFRA_WEIGHTS sum to 1.0', function () {
  const sum = Object.values(I.INFRA_WEIGHTS).reduce(function (a, b) { return a + b; }, 0);
  assert(Math.abs(sum - 1.0) < 0.001, 'INFRA_WEIGHTS sum ≈ 1.0 (got ' + sum + ')');
});

test('buildInfrastructureScorecard — empty inputs → mid-range score', function () {
  const sc = I.buildInfrastructureScorecard({}, {}, {}, {});
  assert(sc.compositeScore >= 0 && sc.compositeScore <= 100, 'compositeScore in [0,100]');
  assert(typeof sc.sewerCapacityAdequate === 'boolean',       'sewerCapacityAdequate is boolean');
  assert(typeof sc.floodRiskPercent      === 'number',        'floodRiskPercent is number');
});

test('buildInfrastructureScorecard — high flood risk → low flood score', function () {
  const sc = I.buildInfrastructureScorecard({ hazardPercent: 0.5 }, {}, {}, {});
  assert(sc.floodScore < 60, 'high flood risk (50%) → flood score < 60');
  assert(sc.flags.highFloodRisk === true, 'highFloodRisk flag set');
});

test('buildInfrastructureScorecard — zero flood risk → high flood score', function () {
  const sc = I.buildInfrastructureScorecard({ hazardPercent: 0 }, {}, {}, {});
  assert(sc.floodScore === 100, 'zero flood risk → flood score = 100');
  assert(sc.flags.highFloodRisk === false, 'highFloodRisk flag not set');
});

test('buildInfrastructureScorecard — low utility headroom → flagged', function () {
  const sc = I.buildInfrastructureScorecard(
    {}, {}, { sewerHeadroom: 0.1, waterCapacity: 0.1 }, {}
  );
  assert(sc.sewerCapacityAdequate === false, 'low headroom → sewerCapacityAdequate = false');
  assert(sc.flags.utilityAtCapacity === true, 'utilityAtCapacity flag set');
});

test('buildInfrastructureScorecard — food desert flagged', function () {
  const sc = I.buildInfrastructureScorecard(
    {}, {}, {}, { foodDeserts: [{ lat: 39.7, lon: -104.9 }], proximityIndex: 20 }
  );
  assert(sc.flags.foodDesertPresent === true, 'foodDesertPresent flag set');
  assert(sc.foodAccessScore < 50, 'low proximity index → low food access score');
});

test('getInfrastructureScore — returns number in [0,100]', function () {
  I.buildInfrastructureScorecard(
    { hazardPercent: 0.1 },
    { resilienceScore: 70 },
    { sewerHeadroom: 0.6, waterCapacity: 0.7 },
    { proximityIndex: 65 }
  );
  const score = I.getInfrastructureScore();
  assert(typeof score === 'number',      'getInfrastructureScore returns a number');
  assert(score >= 0 && score <= 100,     'score in [0,100]');
});

test('getInfrastructureLayer — FeatureCollection', function () {
  const floodZones  = [{ lat: 39.7, lon: -104.9, zone: 'AE' }];
  const foodDeserts = [{ lat: 39.72, lon: -104.88 }];
  const layer = I.getInfrastructureLayer(floodZones, foodDeserts);
  assert(layer.type === 'FeatureCollection',  'type is FeatureCollection');
  assert(layer.features.length === 2,         '1 flood + 1 food desert = 2 features');
});

test('getInfrastructureJustification — shape', function () {
  const j = I.getInfrastructureJustification();
  assert(typeof j.floodRiskPercent        === 'number',  'floodRiskPercent is number');
  assert(typeof j.climateResilienceScore  === 'number',  'climateResilienceScore is number');
  assert(typeof j.sewerCapacityAdequate   === 'boolean', 'sewerCapacityAdequate is boolean');
  assert(typeof j.foodAccessScore         === 'number',  'foodAccessScore is number');
  assert(typeof j.compositeScore          === 'number',  'compositeScore is number');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
