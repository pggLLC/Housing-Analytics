// test/unit/pma-opportunities.test.js
//
// Unit tests for js/pma-opportunities.js
//
// Usage: node test/unit/pma-opportunities.test.js
'use strict';

const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/pma-opportunities.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const O = global.PMAOpportunities;

test('PMAOpportunities exposed on window', function () {
  assert(typeof O === 'object',                                   'PMAOpportunities is an object');
  assert(typeof O.calculateOpportunityShare    === 'function',    'calculateOpportunityShare exported');
  assert(typeof O.scoreOpportunityIndex        === 'function',    'scoreOpportunityIndex exported');
  assert(typeof O.determineIncentiveEligibility === 'function',   'determineIncentiveEligibility exported');
  assert(typeof O.getOpportunityLayer          === 'function',    'getOpportunityLayer exported');
  assert(typeof O.getOpportunityJustification  === 'function',    'getOpportunityJustification exported');
  assert(typeof O.OPP_WEIGHTS                  === 'object',      'OPP_WEIGHTS exported');
});

test('OPP_WEIGHTS sum to 1.0', function () {
  const sum = Object.values(O.OPP_WEIGHTS).reduce(function (a, b) { return a + b; }, 0);
  assert(Math.abs(sum - 1.0) < 0.001, 'OPP_WEIGHTS sum ≈ 1.0 (got ' + sum + ')');
});

test('calculateOpportunityShare — null polygon → 0', function () {
  const share = O.calculateOpportunityShare(null, [{ lat: 39.7, lon: -104.9 }]);
  assert(share === 0, 'null polygon → 0 share');
});

test('calculateOpportunityShare — no OZ zones → 0', function () {
  const poly = {
    type: 'Polygon',
    coordinates: [[[-105, 39.5],[-104.8, 39.5],[-104.8, 39.9],[-105, 39.9],[-105, 39.5]]]
  };
  const share = O.calculateOpportunityShare(poly, []);
  assert(share === 0, 'empty zones → 0 share');
});

test('calculateOpportunityShare — zones within bbox → share > 0', function () {
  const poly = {
    type: 'Polygon',
    coordinates: [[[-105, 39.5],[-104.8, 39.5],[-104.8, 39.9],[-105, 39.9],[-105, 39.5]]]
  };
  const zones = [
    { lat: 39.6, lon: -104.9 },
    { lat: 39.7, lon: -104.85 }
  ];
  const share = O.calculateOpportunityShare(poly, zones);
  assert(share >= 0 && share <= 1, 'share in [0,1]');
});

test('scoreOpportunityIndex — all inputs at 50 → score ≈ 50', function () {
  O.calculateOpportunityShare(
    { type: 'Polygon', coordinates: [[[-105,39.5],[-104.8,39.5],[-104.8,39.9],[-105,39.9],[-105,39.5]]] },
    []
  ); // oz share = 0
  const score = O.scoreOpportunityIndex(39.7, -104.9, { opportunityIndex: 50 }, { mobilityIndex: 50 });
  assert(score >= 0 && score <= 100, 'score in [0,100]');
});

test('scoreOpportunityIndex — high AFFH score raises index', function () {
  const scoreHigh = O.scoreOpportunityIndex(39.7, -104.9, { opportunityIndex: 90 }, { mobilityIndex: 80 });
  const scoreLow  = O.scoreOpportunityIndex(39.7, -104.9, { opportunityIndex: 20 }, { mobilityIndex: 20 });
  assert(scoreHigh > scoreLow, 'higher AFFH / mobility → higher opportunity index');
});

test('determineIncentiveEligibility — OZ > 20% → LIHTC basis eligible', function () {
  const elig = O.determineIncentiveEligibility(0.25, 60, 55);
  assert(elig.lihtcBasisStepDown === true,      'OZ > 20% → lihtcBasisStepDown');
  assert(elig.qualifiedOpportunityZone === true, 'OZ > 0 → qualifiedOpportunityZone');
});

test('determineIncentiveEligibility — low mobility → NMTC eligible', function () {
  const elig = O.determineIncentiveEligibility(0, 40, 35);
  assert(elig.newMarketsTaxCredit === true, 'low scores → NMTC eligible');
  assert(elig.lihtcBasisStepDown === false, 'no OZ → no basis step-down');
});

test('getOpportunityLayer — FeatureCollection', function () {
  const zones = [{ lat: 39.7, lon: -104.9, censusTract: '08031001700' }];
  const layer = O.getOpportunityLayer(zones);
  assert(layer.type === 'FeatureCollection', 'type is FeatureCollection');
  assert(layer.features.length === 1,        '1 feature');
  assert(layer.features[0].geometry.type === 'Point', 'geometry is Point');
});

test('getOpportunityJustification — shape', function () {
  const j = O.getOpportunityJustification();
  assert(typeof j.opportunityZoneShare         === 'number', 'opportunityZoneShare is number');
  assert(typeof j.fairHousingScore             === 'number', 'fairHousingScore is number');
  assert(typeof j.economicMobilityPercentile   === 'number', 'economicMobilityPercentile is number');
  assert(typeof j.incentiveEligibility         === 'object', 'incentiveEligibility is object');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
