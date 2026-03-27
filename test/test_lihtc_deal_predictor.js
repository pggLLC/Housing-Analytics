/**
 * test/test_lihtc_deal_predictor.js
 * Unit tests for js/lihtc-deal-predictor.js
 *
 * Usage:
 *   node test/test_lihtc_deal_predictor.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */

'use strict';

const path      = require('path');
const predictor = require(path.resolve(__dirname, '..', 'js', 'lihtc-deal-predictor'));

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
  } catch (err) {
    console.error('  \u274c FAIL: threw unexpected error \u2014 ' + err.message);
    failed++;
  }
}

// ── Module exports ────────────────────────────────────────────────────────────

test('Module exports predictConcept function', () => {
  assert(typeof predictor.predictConcept === 'function', 'predictConcept is a function');
  assert(typeof predictor.predict === 'function',        'predict (legacy) is a function');
  assert(typeof predictor.DISCLAIMER === 'string',       'DISCLAIMER is a string');
  assert(predictor.DISCLAIMER.length > 20,               'DISCLAIMER has meaningful content');
});

// ── DealRecommendation schema ─────────────────────────────────────────────────

test('predictConcept returns complete DealRecommendation schema', () => {
  var rec = predictor.predictConcept({});
  assert(typeof rec.recommendedExecution === 'string',  'recommendedExecution is string');
  assert(typeof rec.conceptType === 'string',           'conceptType is string');
  assert(typeof rec.suggestedUnitMix === 'object',      'suggestedUnitMix is object');
  assert(typeof rec.suggestedAMIMix === 'object',       'suggestedAMIMix is object');
  assert(typeof rec.indicativeCapitalStack === 'object','indicativeCapitalStack is object');
  assert(Array.isArray(rec.keyRationale),               'keyRationale is array');
  assert(Array.isArray(rec.keyRisks),                   'keyRisks is array');
  assert(Array.isArray(rec.caveats),                    'caveats is array');
  assert(typeof rec.confidence === 'string',            'confidence is string');
  assert(typeof rec.confidenceBadge === 'string',       'confidenceBadge is string');
  assert(typeof rec.alternativePath === 'string',       'alternativePath is string');
});

test('recommendedExecution is 9%, 4%, or Either', () => {
  var values = ['9%', '4%', 'Either'];
  var rec = predictor.predictConcept({});
  assert(values.indexOf(rec.recommendedExecution) !== -1, 'recommendedExecution is valid: ' + rec.recommendedExecution);
});

test('conceptType is one of the four valid types', () => {
  var types = ['family', 'seniors', 'mixed-use', 'supportive'];
  var rec = predictor.predictConcept({});
  assert(types.indexOf(rec.conceptType) !== -1, 'conceptType is valid: ' + rec.conceptType);
});

test('confidence is high, medium, or low', () => {
  var values = ['high', 'medium', 'low'];
  var rec = predictor.predictConcept({});
  assert(values.indexOf(rec.confidence) !== -1, 'confidence is valid: ' + rec.confidence);
});

// ── Unit mix fields ───────────────────────────────────────────────────────────

test('suggestedUnitMix has all required fields', () => {
  var rec = predictor.predictConcept({ proposedUnits: 60 });
  var mix = rec.suggestedUnitMix;
  assert(typeof mix.studio    === 'number', 'studio is number');
  assert(typeof mix.oneBR     === 'number', 'oneBR is number');
  assert(typeof mix.twoBR     === 'number', 'twoBR is number');
  assert(typeof mix.threeBR   === 'number', 'threeBR is number');
  assert(typeof mix.fourBRPlus=== 'number', 'fourBRPlus is number');
});

test('suggestedUnitMix totals approximately to proposedUnits', () => {
  var units = 60;
  var rec   = predictor.predictConcept({ proposedUnits: units });
  var mix   = rec.suggestedUnitMix;
  var total = mix.studio + mix.oneBR + mix.twoBR + mix.threeBR + mix.fourBRPlus;
  assert(Math.abs(total - units) <= 2, 'unit mix total (' + total + ') ≈ proposedUnits (' + units + ')');
});

// ── AMI mix fields ────────────────────────────────────────────────────────────

test('suggestedAMIMix has all required fields', () => {
  var rec = predictor.predictConcept({ proposedUnits: 60 });
  var mix = rec.suggestedAMIMix;
  assert(typeof mix.ami30 === 'number', 'ami30 is number');
  assert(typeof mix.ami40 === 'number', 'ami40 is number');
  assert(typeof mix.ami50 === 'number', 'ami50 is number');
  assert(typeof mix.ami60 === 'number', 'ami60 is number');
});

test('suggestedAMIMix totals approximately to proposedUnits', () => {
  var units = 60;
  var rec   = predictor.predictConcept({ proposedUnits: units });
  var mix   = rec.suggestedAMIMix;
  var total = mix.ami30 + mix.ami40 + mix.ami50 + mix.ami60;
  assert(Math.abs(total - units) <= 2, 'AMI mix total (' + total + ') ≈ proposedUnits (' + units + ')');
});

// ── Capital stack fields ──────────────────────────────────────────────────────

test('indicativeCapitalStack has all required fields', () => {
  var rec   = predictor.predictConcept({ proposedUnits: 60 });
  var stack = rec.indicativeCapitalStack;
  assert(typeof stack.totalDevelopmentCost === 'number', 'totalDevelopmentCost is number');
  assert(typeof stack.equity        === 'number', 'equity is number');
  assert(typeof stack.firstMortgage === 'number', 'firstMortgage is number');
  assert(typeof stack.localSoft     === 'number', 'localSoft is number');
  assert(typeof stack.stateSoft     === 'number', 'stateSoft is number');
  assert(typeof stack.deferredFee   === 'number', 'deferredFee is number');
  assert(typeof stack.gap           === 'number', 'gap is number');
});

test('capital stack totalDevelopmentCost > 0', () => {
  var rec = predictor.predictConcept({ proposedUnits: 60 });
  assert(rec.indicativeCapitalStack.totalDevelopmentCost > 0, 'totalDevelopmentCost > 0');
});

// ── 4% vs 9% logic ───────────────────────────────────────────────────────────

test('Prefers 9% for small scale with deep affordability need', () => {
  var rec = predictor.predictConcept({
    proposedUnits:     50,
    ami30UnitsNeeded:  20,   // 40% of units → deep affordability
    totalUndersupply:  200,
    competitiveSetSize: 0,
    pmaScore:          75
  });
  assert(rec.recommendedExecution === '9%', 'recommends 9% for small scale + deep affordability');
});

test('Prefers 4% for large scale with soft funding available', () => {
  var rec = predictor.predictConcept({
    proposedUnits:         120,
    softFundingAvailable:  2000000,
    ami30UnitsNeeded:      10,
    competitiveSetSize:    1,
    pmaScore:              65
  });
  assert(rec.recommendedExecution === '4%', 'recommends 4% for 120 units + soft funding');
});

test('Flags Either path when market is saturated AND soft funding unavailable', () => {
  var rec = predictor.predictConcept({
    proposedUnits:         80,
    softFundingAvailable:  0,
    competitiveSetSize:    6,  // above highThreshold of 5
    pmaScore:              45
  });
  assert(rec.recommendedExecution === 'Either', 'recommends Either when saturated + no soft funds');
});

test('QCT designation appears in rationale', () => {
  var rec = predictor.predictConcept({ isQct: true, proposedUnits: 50 });
  var hasQct = rec.keyRationale.some(function (r) { return /QCT/i.test(r); });
  assert(hasQct, 'QCT designation mentioned in rationale');
});

test('DDA designation appears in rationale', () => {
  var rec = predictor.predictConcept({ isDda: true, proposedUnits: 50 });
  var hasDda = rec.keyRationale.some(function (r) { return /DDA/i.test(r); });
  assert(hasDda, 'DDA designation mentioned in rationale');
});

// ── Concept type logic ────────────────────────────────────────────────────────

test('Recommends seniors concept when seniorsDemand flag is set', () => {
  var rec = predictor.predictConcept({ seniorsDemand: true });
  assert(rec.conceptType === 'seniors', 'concept type is seniors when seniorsDemand=true');
});

test('Recommends supportive concept when supportiveNeed + large 30% AMI gap', () => {
  var rec = predictor.predictConcept({ supportiveNeed: true, ami30UnitsNeeded: 80 });
  assert(rec.conceptType === 'supportive', 'concept type is supportive when supportiveNeed=true');
});

test('Defaults to family concept when no special signals', () => {
  var rec = predictor.predictConcept({ pmaScore: 60, proposedUnits: 60 });
  assert(rec.conceptType === 'family', 'default concept type is family');
});

// ── Confidence scoring ────────────────────────────────────────────────────────

test('High confidence when all key inputs provided', () => {
  var rec = predictor.predictConcept({
    pmaScore:              72,
    pmaConfidence:         'high',
    ami30UnitsNeeded:      50,
    ami50UnitsNeeded:      80,
    ami60UnitsNeeded:      60,
    competitiveSetSize:    2,
    isQct:                 true,
    isDda:                 false,
    softFundingAvailable:  1500000,
    medianRentToIncome:    0.32,
    proposedUnits:         60
  });
  assert(rec.confidence === 'high', 'confidence is high with complete inputs (got: ' + rec.confidence + ')');
  assert(rec.confidenceBadge === '\uD83D\uDFE2', 'green badge for high confidence');
});

test('Low confidence when all inputs missing', () => {
  var rec = predictor.predictConcept({});
  assert(rec.confidence === 'low', 'confidence is low with no inputs');
  assert(rec.confidenceBadge === '\uD83D\uDD34', 'red badge for low confidence');
});

test('Medium confidence with partial inputs', () => {
  var rec = predictor.predictConcept({
    pmaScore:           60,
    ami30UnitsNeeded:   40,
    competitiveSetSize: 1,
    softFundingAvailable: 800000,
    proposedUnits:      60
  });
  assert(rec.confidence === 'medium', 'confidence is medium with partial inputs (got: ' + rec.confidence + ')');
  assert(rec.confidenceBadge === '\uD83D\uDFE1', 'yellow badge for medium confidence');
});

// ── Risk identification ───────────────────────────────────────────────────────

test('Market saturation risk flagged when competitive set >= 3', () => {
  var rec = predictor.predictConcept({ competitiveSetSize: 4, proposedUnits: 50 });
  var hasSaturation = rec.keyRisks.some(function (r) { return /saturation/i.test(r); });
  assert(hasSaturation, 'saturation risk flagged when 4 competitive projects');
});

test('Weak PMA risk flagged when score < 50', () => {
  var rec = predictor.predictConcept({
    pmaScore:          35,
    ami30UnitsNeeded:  10,
    proposedUnits:     50
  });
  var hasWeakPma = rec.keyRisks.some(function (r) { return /PMA score/i.test(r); });
  assert(hasWeakPma, 'weak PMA risk flagged when score < 50');
});

test('Limited soft funding risk flagged', () => {
  var rec = predictor.predictConcept({
    softFundingAvailable: 200000,
    proposedUnits:        60
  });
  var hasFundingRisk = rec.keyRisks.some(function (r) { return /soft funding/i.test(r); });
  assert(hasFundingRisk, 'limited soft funding risk flagged');
});

// ── Caveats ───────────────────────────────────────────────────────────────────

test('Caveats array always contains DISCLAIMER content', () => {
  var rec = predictor.predictConcept({});
  var hasDisclaimer = rec.caveats.some(function (c) {
    return /planning-level/i.test(c) || /underwriting/i.test(c);
  });
  assert(hasDisclaimer, 'caveats include disclaimer language');
});

test('Missing PMA score adds caveat', () => {
  var rec = predictor.predictConcept({ ami30UnitsNeeded: 50 });
  var hasCaveat = rec.caveats.some(function (c) { return /PMA score/i.test(c); });
  assert(hasCaveat, 'missing PMA score adds caveat');
});

test('Missing HNA data adds caveat', () => {
  var rec = predictor.predictConcept({ pmaScore: 65 });
  var hasCaveat = rec.caveats.some(function (c) { return /HNA|affordability gap/i.test(c); });
  assert(hasCaveat, 'missing HNA gap data adds caveat');
});

// ── Alternative path ──────────────────────────────────────────────────────────

test('Alternative path is provided for 9% recommendation', () => {
  var rec = predictor.predictConcept({
    proposedUnits:     50,
    ami30UnitsNeeded:  15,
    competitiveSetSize: 0
  });
  assert(rec.recommendedExecution === '9%', 'is a 9% recommendation');
  assert(rec.alternativePath.length > 10, 'alternativePath is provided: ' + rec.alternativePath.substring(0, 50));
});

test('Alternative path is provided for 4% recommendation', () => {
  var rec = predictor.predictConcept({
    proposedUnits:         120,
    softFundingAvailable:  2000000,
    ami30UnitsNeeded:      10
  });
  assert(rec.recommendedExecution === '4%', 'is a 4% recommendation');
  assert(rec.alternativePath.length > 10, 'alternativePath is provided');
});

// ── Legacy predict() compatibility ────────────────────────────────────────────

test('Legacy predict() returns expected shape', () => {
  var res = predictor.predict({ pmaScore: 70, proposedUnits: 60 });
  assert(typeof res.feasibilityScore === 'number', 'feasibilityScore is number');
  assert(typeof res.recommendation   === 'string', 'recommendation is string');
  assert(typeof res.breakdown        === 'object', 'breakdown is object');
  assert(typeof res.disclaimer       === 'string', 'disclaimer is string');
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('Handles null inputs gracefully', () => {
  var rec = predictor.predictConcept(null);
  assert(rec && typeof rec.recommendedExecution === 'string', 'handles null input without throwing');
});

test('Handles NaN inputs gracefully', () => {
  var rec = predictor.predictConcept({
    pmaScore:          NaN,
    proposedUnits:     NaN,
    ami30UnitsNeeded:  NaN
  });
  assert(rec && typeof rec.confidence === 'string', 'handles NaN inputs without throwing');
});

test('Handles zero proposedUnits without division errors', () => {
  var rec = predictor.predictConcept({ proposedUnits: 0 });
  assert(rec && typeof rec.conceptType === 'string', 'handles zero proposedUnits');
});

// ── Phase 3: PAB cap analysis ─────────────────────────────────────────────────

test('PAB cap unavailable shifts large-scale 4% recommendation to Either', () => {
  var rec = predictor.predictConcept({
    proposedUnits:        120,
    softFundingAvailable: 2000000,
    ami30UnitsNeeded:     10,
    pabCapAvailable:      false
  });
  assert(rec.recommendedExecution === 'Either', 'PAB cap=false shifts 4% to Either: ' + rec.recommendedExecution);
  var hasPabRisk = rec.keyRisks.some(function (r) { return /PAB/i.test(r); });
  assert(hasPabRisk, 'PAB cap risk noted in keyRisks');
});

test('PAB cap available preserves 4% recommendation', () => {
  var rec = predictor.predictConcept({
    proposedUnits:        120,
    softFundingAvailable: 2000000,
    ami30UnitsNeeded:     10,
    pabCapAvailable:      true
  });
  assert(rec.recommendedExecution === '4%', 'PAB cap=true keeps 4% recommendation');
  assert(typeof rec.pabCapNote === 'string', 'pabCapNote returned for 4% path');
});

test('pabCapNote is null for 9% recommendations', () => {
  var rec = predictor.predictConcept({
    proposedUnits:    50,
    ami30UnitsNeeded: 20,
    pabCapAvailable:  true
  });
  assert(rec.recommendedExecution === '9%', 'is 9% recommendation');
  assert(rec.pabCapNote === null, 'pabCapNote is null for 9% path');
});

test('PAB cap caveat added for large projects without pabCapAvailable', () => {
  var rec = predictor.predictConcept({ proposedUnits: 120 });
  var hasCaveat = rec.caveats.some(function (c) { return /PAB/i.test(c); });
  assert(hasCaveat, 'PAB status caveat added when large project and pabCapAvailable not set');
});

// ── Phase 3: HUD FMR alignment ────────────────────────────────────────────────

test('fmrAlignment returned when fmrData provided', () => {
  var rec = predictor.predictConcept({
    proposedUnits: 60,
    fmrData: { oneBedroomFMR: 1400, twoBedroomFMR: 1700, threeBedroomFMR: 2100 }
  });
  assert(rec.fmrAlignment !== null, 'fmrAlignment is not null when fmrData provided');
  assert(typeof rec.fmrAlignment === 'object', 'fmrAlignment is an object');
  assert(typeof rec.fmrAlignment.oneBR === 'object', 'fmrAlignment.oneBR is present');
  assert(rec.fmrAlignment.oneBR.fmr === 1400, 'FMR value preserved: ' + rec.fmrAlignment.oneBR.fmr);
  assert(rec.fmrAlignment.oneBR.maxRentAt60Ami > 0, 'maxRentAt60Ami computed');
  assert(rec.fmrAlignment.oneBR.maxRentAt30Ami < rec.fmrAlignment.oneBR.maxRentAt60Ami, 'AMI rent tiers descend');
});

test('fmrAlignment is null when fmrData not provided', () => {
  var rec = predictor.predictConcept({ proposedUnits: 60 });
  assert(rec.fmrAlignment === null, 'fmrAlignment null without fmrData');
});

// ── Phase 3: Scenario sensitivity ────────────────────────────────────────────

test('scenarioSensitivity returned for all recommendations', () => {
  ['9%', '4%', 'Either'].forEach(function (path) {
    var inputs = path === '9%'
      ? { proposedUnits: 50, ami30UnitsNeeded: 20, competitiveSetSize: 0 }
      : path === '4%'
      ? { proposedUnits: 120, softFundingAvailable: 2000000, pabCapAvailable: true }
      : { proposedUnits: 80, softFundingAvailable: 0, competitiveSetSize: 6 };
    var rec = predictor.predictConcept(inputs);
    assert(typeof rec.scenarioSensitivity === 'object', path + ': scenarioSensitivity is object');
    assert(typeof rec.scenarioSensitivity.equityPricingRange === 'object', path + ': equityPricingRange present');
    assert(typeof rec.scenarioSensitivity.demandSignalRange === 'object', path + ': demandSignalRange present');
    assert(typeof rec.scenarioSensitivity.saturationRange === 'object', path + ': saturationRange present');
  });
});

// ── Phase 3: CHFA award context ───────────────────────────────────────────────

test('chfaAwardContext returned when chfaHistoricalAwards provided', () => {
  var rec = predictor.predictConcept({
    proposedUnits:         60,
    chfaHistoricalAwards:  3,
    countyAffordabilityGap: 75
  });
  assert(rec.chfaAwardContext !== null, 'chfaAwardContext is not null');
  assert(rec.chfaAwardContext.countyAwardsLast5Years === 3, 'award count preserved');
  assert(rec.chfaAwardContext.countyAwardSignal === 'high', 'high signal for 3+ awards');
  assert(rec.chfaAwardContext.affordabilityGapTier === 'critical', 'critical gap tier at 75');
});

test('chfaAwardContext: low signal for zero historical awards', () => {
  var rec = predictor.predictConcept({ proposedUnits: 60, chfaHistoricalAwards: 0 });
  assert(rec.chfaAwardContext !== null, 'chfaAwardContext present');
  assert(rec.chfaAwardContext.countyAwardSignal === 'low', 'low signal for 0 awards');
});

test('chfaAwardContext includes QAP note for 9% recommendations', () => {
  var rec = predictor.predictConcept({
    proposedUnits:        50,
    ami30UnitsNeeded:     20,
    chfaHistoricalAwards: 1
  });
  assert(rec.recommendedExecution === '9%', 'is 9% recommendation');
  assert(typeof rec.chfaAwardContext.qapCompetitivenessNote === 'string', 'QAP note present for 9% path');
});

test('chfaAwardContext is null when no award context inputs provided', () => {
  var rec = predictor.predictConcept({ proposedUnits: 60 });
  assert(rec.chfaAwardContext === null, 'chfaAwardContext null without context inputs');
});

// ── Phase 3: New output fields schema ─────────────────────────────────────────

test('predictConcept returns all Phase 3 output fields', () => {
  var rec = predictor.predictConcept({ proposedUnits: 60 });
  assert('pabCapNote' in rec,          'pabCapNote field present');
  assert('fmrAlignment' in rec,        'fmrAlignment field present');
  assert('scenarioSensitivity' in rec, 'scenarioSensitivity field present');
  assert('chfaAwardContext' in rec,    'chfaAwardContext field present');
});

test('Exported helper functions available on module', () => {
  assert(typeof predictor._computeScenarioSensitivity === 'function', '_computeScenarioSensitivity exported');
  assert(typeof predictor._computeFmrAlignment === 'function',        '_computeFmrAlignment exported');
  assert(typeof predictor._computeChfaAwardContext === 'function',    '_computeChfaAwardContext exported');
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
