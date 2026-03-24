/**
 * test/test_chfa_award_predictor.js
 * Unit tests for js/chfa-award-predictor.js
 *
 * Usage:
 *   node test/test_chfa_award_predictor.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */
'use strict';

const path      = require('path');
const predictor = require(path.resolve(__dirname, '..', 'js', 'chfa-award-predictor'));
const data      = require(path.resolve(__dirname, '..', 'data', 'policy', 'chfa-awards-historical.json'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  \u2705 PASS: ' + message);
    passed++;
  } else {
    console.error('  \u274c FAIL: ' + message);
    failed++;
  }
}

function test(name, fn) {
  console.log('\n[test] ' + name);
  try {
    fn();
  } catch (e) {
    console.error('  \u274c EXCEPTION: ' + e.message);
    failed++;
  }
}

/* ── Module exports ─────────────────────────────────────────────── */
test('Module exports', function () {
  assert(typeof predictor === 'object',                    'module is an object');
  assert(typeof predictor.load === 'function',             'exports load()');
  assert(typeof predictor.predict === 'function',          'exports predict()');
  assert(typeof predictor.isLoaded === 'function',         'exports isLoaded()');
  assert(typeof predictor.getAwardsByType === 'function',  'exports getAwardsByType()');
  assert(typeof predictor._estimateFactors === 'function', 'exports _estimateFactors for testing');
  assert(typeof predictor._scoreToProbability === 'function', 'exports _scoreToProbability for testing');
  assert(typeof predictor._likelihoodToBand === 'function',   'exports _likelihoodToBand for testing');
  assert(typeof predictor._computePercentile === 'function',  'exports _computePercentile for testing');
  assert(typeof predictor._sumScore === 'function',           'exports _sumScore for testing');
});

/* ── _scoreToProbability ─────────────────────────────────────────── */
test('_scoreToProbability: monotone mapping', function () {
  var p90 = predictor._scoreToProbability(90);
  var p80 = predictor._scoreToProbability(80);
  var p70 = predictor._scoreToProbability(70);
  var p60 = predictor._scoreToProbability(60);

  assert(p90 >= p80, 'score 90 >= score 80 probability');
  assert(p80 >= p70, 'score 80 >= score 70 probability');
  assert(p70 >= p60, 'score 70 >= score 60 probability');

  assert(p90 >= 0 && p90 <= 1, 'p90 in [0,1]: ' + p90);
  assert(p60 >= 0 && p60 <= 1, 'p60 in [0,1]: ' + p60);
});

/* ── _likelihoodToBand ───────────────────────────────────────────── */
test('_likelihoodToBand: correct mapping', function () {
  assert(predictor._likelihoodToBand(0.70) === 'strong',   '0.70 → strong');
  assert(predictor._likelihoodToBand(0.60) === 'strong',   '0.60 → strong');
  assert(predictor._likelihoodToBand(0.50) === 'moderate', '0.50 → moderate');
  assert(predictor._likelihoodToBand(0.35) === 'moderate', '0.35 → moderate');
  assert(predictor._likelihoodToBand(0.20) === 'weak',     '0.20 → weak');
  assert(predictor._likelihoodToBand(0.0)  === 'weak',     '0.0 → weak');
});

/* ── _sumScore ───────────────────────────────────────────────────── */
test('_sumScore: sums factor values', function () {
  var factors = {
    geography:    { value: 15, maxPts: 20 },
    communityNeed:{ value: 18, maxPts: 25 },
    localSupport: { value: 12, maxPts: 22 },
    developer:    { value: 10, maxPts: 15 },
    design:       { value: 6,  maxPts: 10 },
    other:        { value: 4,  maxPts: 8  }
  };
  var sum = predictor._sumScore(factors);
  assert(Math.abs(sum - 65) < 0.01, '_sumScore = 65 (got ' + sum + ')');

  var empty = predictor._sumScore({});
  assert(empty === 0, '_sumScore of empty = 0');
});

/* ── isLoaded before load ────────────────────────────────────────── */
test('isLoaded() before load()', function () {
  assert(typeof predictor.isLoaded() === 'boolean', 'isLoaded returns boolean');
});

/* ── load() ─────────────────────────────────────────────────────── */
test('load() with historical data', function () {
  return predictor.load(data).then(function () {
    assert(predictor.isLoaded() === true, 'isLoaded() is true after load()');
  });
});

/* ── predict() result schema ─────────────────────────────────────── */
test('predict(): result schema validation', function () {
  predictor.load(data);
  var concept     = { conceptType: 'family', recommendedExecution: '9%' };
  var siteContext = { pmaScore: 75, isQct: false, isDda: false, totalUndersupply: 100, hasHnaData: true };
  var result      = predictor.predict(concept, siteContext);

  assert(typeof result.awardLikelihood === 'number',    'awardLikelihood is number');
  assert(result.awardLikelihood >= 0 && result.awardLikelihood <= 1, 'awardLikelihood 0–1: ' + result.awardLikelihood);
  assert(typeof result.competitiveBand === 'string',    'competitiveBand is string');
  assert(typeof result.scoreEstimate === 'number',      'scoreEstimate is number');
  assert(typeof result.factors === 'object',            'factors is object');
  assert(typeof result.competitiveContext === 'object', 'competitiveContext is object');
  assert(typeof result.narrative === 'string',          'narrative is string');
  assert(Array.isArray(result.caveats),                 'caveats is array');
  assert(result.caveats.length > 0,                     'caveats is non-empty');
});

/* ── predict(): competitiveBand values ──────────────────────────── */
test('predict(): competitiveBand is valid value', function () {
  predictor.load(data);
  var validBands = ['strong', 'moderate', 'weak'];
  var scenarios = [
    { pmaScore: 90, isQct: true,  hasHnaData: true,  totalUndersupply: 300, localSoftFunding: 600000, hasGovernmentSupport: true },
    { pmaScore: 65, isQct: false, hasHnaData: false, totalUndersupply: 10 },
    { pmaScore: 75, isQct: false, hasHnaData: true,  totalUndersupply: 100 }
  ];
  scenarios.forEach(function (ctx, i) {
    var r = predictor.predict({ conceptType: 'family' }, ctx);
    assert(validBands.indexOf(r.competitiveBand) !== -1,
      'Scenario ' + i + ' competitiveBand valid: ' + r.competitiveBand);
  });
});

/* ── predict(): factor keys ─────────────────────────────────────── */
test('predict(): factors contain required keys', function () {
  predictor.load(data);
  var result = predictor.predict({ conceptType: 'family' }, { pmaScore: 75 });
  var requiredFactors = ['geography', 'communityNeed', 'localSupport', 'developer', 'design', 'other'];

  requiredFactors.forEach(function (key) {
    assert(key in result.factors, 'factors contains: ' + key);
    assert(typeof result.factors[key].value === 'number',  key + '.value is number');
    assert(typeof result.factors[key].maxPts === 'number', key + '.maxPts is number');
    assert(typeof result.factors[key].note === 'string',   key + '.note is string');
    assert(result.factors[key].value >= 0,                 key + '.value >= 0');
    assert(result.factors[key].value <= result.factors[key].maxPts, key + '.value <= maxPts');
  });
});

/* ── predict(): score estimate in reasonable range ───────────────── */
test('predict(): scoreEstimate in 0–100 range', function () {
  predictor.load(data);
  var scenarios = [
    [{}, {}],
    [{ conceptType: 'family' }, { pmaScore: 90, isQct: true, hasHnaData: true, totalUndersupply: 500, localSoftFunding: 800000, hasGovernmentSupport: true }],
    [{ conceptType: 'seniors' }, { pmaScore: 40, isQct: false, isRural: true }]
  ];
  scenarios.forEach(function (s, i) {
    var r = predictor.predict(s[0], s[1]);
    assert(r.scoreEstimate >= 0 && r.scoreEstimate <= 100,
      'Scenario ' + i + ' scoreEstimate in [0,100]: ' + r.scoreEstimate);
  });
});

/* ── predict(): QCT/DDA boosts geography score ───────────────────── */
test('predict(): QCT boosts geography score', function () {
  predictor.load(data);
  var withQct    = predictor.predict({ conceptType: 'family' }, { isQct: true });
  var withoutQct = predictor.predict({ conceptType: 'family' }, { isQct: false });
  assert(withQct.factors.geography.value >= withoutQct.factors.geography.value,
    'QCT geo score >= non-QCT: ' + withQct.factors.geography.value + ' vs ' + withoutQct.factors.geography.value);
});

/* ── predict(): HNA data boosts community need ───────────────────── */
test('predict(): HNA data boosts communityNeed score', function () {
  predictor.load(data);
  var withHna    = predictor.predict({ conceptType: 'family' }, { hasHnaData: true, totalUndersupply: 100 });
  var withoutHna = predictor.predict({ conceptType: 'family' }, { hasHnaData: false, totalUndersupply: 0 });
  assert(withHna.factors.communityNeed.value >= withoutHna.factors.communityNeed.value,
    'HNA communityNeed >= no-HNA: ' + withHna.factors.communityNeed.value + ' vs ' + withoutHna.factors.communityNeed.value);
});

/* ── predict(): local support with government backing ────────────── */
test('predict(): government support boosts localSupport score', function () {
  predictor.load(data);
  var withSupport    = predictor.predict({ conceptType: 'family' }, { hasGovernmentSupport: true, localSoftFunding: 600000 });
  var withoutSupport = predictor.predict({ conceptType: 'family' }, { hasGovernmentSupport: false, localSoftFunding: 0 });
  assert(withSupport.factors.localSupport.value >= withoutSupport.factors.localSupport.value,
    'With support >= without: ' + withSupport.factors.localSupport.value + ' vs ' + withoutSupport.factors.localSupport.value);
});

/* ── predict(): rural adds caveat ─────────────────────────────────── */
test('predict(): rural site adds rural caveat', function () {
  predictor.load(data);
  var result = predictor.predict({ conceptType: 'family' }, { isRural: true });
  var hasRuralCaveat = result.caveats.some(function (c) {
    return c.toLowerCase().indexOf('rural') !== -1;
  });
  assert(hasRuralCaveat, 'Rural caveat present for rural site');
});

/* ── predict(): competitiveContext fields ─────────────────────────── */
test('predict(): competitiveContext has required fields', function () {
  predictor.load(data);
  var result = predictor.predict({ conceptType: 'family' }, {});

  assert(typeof result.competitiveContext.applicationsExpected === 'number', 'applicationsExpected is number');
  assert(typeof result.competitiveContext.fundingAvailable === 'number',     'fundingAvailable is number');
  assert(typeof result.competitiveContext.percentileRank === 'number',       'percentileRank is number');
  assert(result.competitiveContext.percentileRank >= 0 && result.competitiveContext.percentileRank <= 1,
    'percentileRank 0–1: ' + result.competitiveContext.percentileRank);
  assert(typeof result.competitiveContext.note === 'string',                 'note is string');
});

/* ── getAwardsByType() ───────────────────────────────────────────── */
test('getAwardsByType(): filters correctly', function () {
  predictor.load(data);
  var familyAwards    = predictor.getAwardsByType('family');
  var seniorAwards    = predictor.getAwardsByType('seniors');
  var unknownAwards   = predictor.getAwardsByType('nonexistent');

  assert(Array.isArray(familyAwards),  'family awards is array');
  assert(familyAwards.length > 0,      'family awards exist in data');
  assert(Array.isArray(seniorAwards),  'senior awards is array');
  assert(seniorAwards.length > 0,      'senior awards exist in data');
  assert(Array.isArray(unknownAwards), 'unknown type is array');
  assert(unknownAwards.length === 0,   'unknown type returns empty array');

  familyAwards.forEach(function (a) {
    assert(a.type === 'family',  'all family awards have type=family');
    assert(a.awarded === true,   'all returned awards are awarded=true');
  });
});

/* ── predict(): no concept graceful ─────────────────────────────── */
test('predict(): handles null concept and context gracefully', function () {
  predictor.load(data);
  var result = predictor.predict(null, null);
  assert(typeof result === 'object',              'returns object for null inputs');
  assert(typeof result.awardLikelihood === 'number', 'awardLikelihood is number');
  assert(result.awardLikelihood >= 0,             'awardLikelihood >= 0');
});

/* ── _computePercentile ─────────────────────────────────────────── */
test('_computePercentile: percentile is between 0 and 1', function () {
  predictor.load(data);
  [50, 70, 80, 90, 100].forEach(function (score) {
    var p = predictor._computePercentile(score);
    assert(p >= 0 && p <= 1, 'percentile in [0,1] for score ' + score + ': ' + p);
  });
});

/* ── predict(): narrative is non-empty ───────────────────────────── */
test('predict(): narrative is non-empty string for all bands', function () {
  predictor.load(data);
  var scenarios = [
    { pmaScore: 90, isQct: true, hasHnaData: true, totalUndersupply: 500, localSoftFunding: 800000, hasGovernmentSupport: true },
    { pmaScore: 60 },
    { pmaScore: 40, isRural: true }
  ];
  scenarios.forEach(function (ctx, i) {
    var r = predictor.predict({ conceptType: 'family' }, ctx);
    assert(r.narrative && r.narrative.length > 0, 'Scenario ' + i + ' narrative non-empty');
  });
});

/* ── Summary ─────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
