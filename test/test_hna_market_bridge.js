/**
 * test/test_hna_market_bridge.js
 * Unit tests for js/hna/hna-market-bridge.js
 *
 * Usage:
 *   node test/test_hna_market_bridge.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */

'use strict';

const path   = require('path');
const bridge = require(path.resolve(__dirname, '..', 'js', 'hna', 'hna-market-bridge'));

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

// ── Sample fixtures ───────────────────────────────────────────────────────────

var SAMPLE_HNA = {
  geoid:               '08031',
  countyName:          'Denver County',
  geoType:             'county',
  ami30UnitsNeeded:    320,
  ami50UnitsNeeded:    280,
  ami60UnitsNeeded:    200,
  totalUndersupply:    800,
  vacancyRate:         0.035,
  householdGrowth:     1250,
  projectedUnitsNeeded: 1100,
  rentGrowthRate:       0.032,
  dataVintage:          '2024-01-01'
};

var SAMPLE_PMA = {
  method:     'hybrid',
  score:      72,
  confidence: 'medium',
  tractCount: 18
};

// ── Module exports ────────────────────────────────────────────────────────────

test('Module exports buildNeedProfile and toDealInputs', () => {
  assert(typeof bridge.buildNeedProfile === 'function', 'buildNeedProfile is function');
  assert(typeof bridge.toDealInputs     === 'function', 'toDealInputs is function');
});

// ── NeedProfile schema ────────────────────────────────────────────────────────

test('buildNeedProfile returns complete NeedProfile schema', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA, { geoid: '08031', name: 'Denver County', type: 'county' });
  assert(typeof profile.geography         === 'object', 'geography is object');
  assert(typeof profile.pma               === 'object', 'pma is object');
  assert(typeof profile.demandSignals     === 'object', 'demandSignals is object');
  assert(typeof profile.affordabilityGap  === 'object', 'affordabilityGap is object');
  assert(Array.isArray(profile.prioritySegments), 'prioritySegments is array');
  assert(typeof profile.confidence        === 'string', 'confidence is string');
  assert(Array.isArray(profile.caveats),  'caveats is array');
});

// ── Geography fields ──────────────────────────────────────────────────────────

test('Geography fields populated from options', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA, { geoid: '08013', name: 'Boulder County', type: 'county' });
  assert(profile.geography.geoid === '08013',        'geoid from options');
  assert(profile.geography.name  === 'Boulder County', 'name from options');
  assert(profile.geography.type  === 'county',        'type from options');
});

test('Geography falls back to HNA data fields', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  assert(profile.geography.geoid === '08031',         'geoid from HNA data');
  assert(profile.geography.name  === 'Denver County', 'name from HNA data');
});

// ── PMA normalization ─────────────────────────────────────────────────────────

test('PMA fields normalized correctly', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  assert(profile.pma.method     === 'hybrid',  'pma.method is hybrid');
  assert(profile.pma.score      === 72,        'pma.score is 72');
  assert(profile.pma.confidence === 'medium',  'pma.confidence is medium');
  assert(profile.pma.tractCount === 18,        'pma.tractCount is 18');
});

test('PMA handles pma_score field alias', () => {
  var altPma = { method: 'buffer', pma_score: 55, pma_confidence: 'low' };
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, altPma);
  assert(profile.pma.score === 55, 'reads pma_score alias correctly');
});

test('PMA defaults gracefully when null', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, null);
  assert(profile.pma.method     === 'unknown', 'method is unknown when PMA missing');
  assert(profile.pma.score      === null,      'score is null when PMA missing');
  assert(profile.pma.confidence === 'low',     'confidence is low when PMA missing');
});

// ── Demand signals ────────────────────────────────────────────────────────────

test('Demand signals extracted from HNA data', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  assert(profile.demandSignals.householdGrowth      === 1250,  'householdGrowth is 1250');
  assert(profile.demandSignals.projectedUnitsNeeded === 1100,  'projectedUnitsNeeded is 1100');
  assert(profile.demandSignals.underlyingRentGrowth === 0.032, 'underlyingRentGrowth is 0.032');
});

test('Trend strength is moderate for 3.2% rent growth', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  assert(profile.demandSignals.trendStrength === 'moderate', 'trend is moderate for 3.2% rent growth');
});

test('Trend strength is strong for >4% rent growth', () => {
  var hna = Object.assign({}, SAMPLE_HNA, { rentGrowthRate: 0.055 });
  var profile = bridge.buildNeedProfile(hna, SAMPLE_PMA);
  assert(profile.demandSignals.trendStrength === 'strong', 'trend is strong for 5.5% rent growth');
});

test('Trend strength is flat for zero rent growth', () => {
  var hna = Object.assign({}, SAMPLE_HNA, { rentGrowthRate: 0 });
  var profile = bridge.buildNeedProfile(hna, SAMPLE_PMA);
  assert(profile.demandSignals.trendStrength === 'flat', 'trend is flat for zero growth');
});

// ── Affordability gap ─────────────────────────────────────────────────────────

test('Affordability gap fields extracted correctly', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  var gap = profile.affordabilityGap;
  assert(gap.ami30UnitsNeeded === 320, 'ami30UnitsNeeded is 320');
  assert(gap.ami50UnitsNeeded === 280, 'ami50UnitsNeeded is 280');
  assert(gap.ami60UnitsNeeded === 200, 'ami60UnitsNeeded is 200');
  assert(gap.totalUndersupply === 800, 'totalUndersupply is 800');
  assert(gap.vacancy          === 0.035, 'vacancy rate is 0.035');
});

test('Deep affordability pressure detected when 30% AMI > 40% of gap', () => {
  var hna = Object.assign({}, SAMPLE_HNA, {
    ami30UnitsNeeded: 400,
    ami50UnitsNeeded: 200,
    ami60UnitsNeeded: 200,
    totalUndersupply: 800  // 400/800 = 50% → deep
  });
  var profile = bridge.buildNeedProfile(hna, SAMPLE_PMA);
  assert(profile.affordabilityGap.deepAffordabilityPressure === true, 'deep affordability pressure detected');
});

test('Deep affordability pressure false when 30% AMI is small share', () => {
  var hna = Object.assign({}, SAMPLE_HNA, {
    ami30UnitsNeeded: 50,
    ami50UnitsNeeded: 400,
    ami60UnitsNeeded: 350,
    totalUndersupply: 800  // 50/800 = 6% → not deep
  });
  var profile = bridge.buildNeedProfile(hna, SAMPLE_PMA);
  assert(profile.affordabilityGap.deepAffordabilityPressure === false, 'deep pressure false when 30% is small share');
});

test('Affordability gap handles gap_30ami field alias', () => {
  var hna = { gap_30ami: 150, gap_50ami: 200, gap_60ami: 100 };
  var profile = bridge.buildNeedProfile(hna, null);
  assert(profile.affordabilityGap.ami30UnitsNeeded === 150, 'reads gap_30ami alias');
  assert(profile.affordabilityGap.ami50UnitsNeeded === 200, 'reads gap_50ami alias');
});

test('Total undersupply auto-computed when not provided', () => {
  var hna = { ami30UnitsNeeded: 100, ami50UnitsNeeded: 150, ami60UnitsNeeded: 50 };
  var profile = bridge.buildNeedProfile(hna, null);
  assert(profile.affordabilityGap.totalUndersupply === 300, 'auto-computes total undersupply (100+150+50=300)');
});

// ── Priority segments ─────────────────────────────────────────────────────────

test('Priority segments generated for provided AMI tiers', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  assert(profile.prioritySegments.length >= 2, 'at least 2 priority segments generated');
});

test('Priority segments have required fields', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  var seg = profile.prioritySegments[0];
  assert(typeof seg.ami         === 'number', 'segment.ami is number');
  assert(typeof seg.priority    === 'string', 'segment.priority is string');
  assert(typeof seg.unitsNeeded === 'number', 'segment.unitsNeeded is number');
  assert(typeof seg.rationale   === 'string', 'segment.rationale is string');
});

test('Priority segment for 30% AMI detected as critical when dominant', () => {
  var hna = Object.assign({}, SAMPLE_HNA, {
    ami30UnitsNeeded: 500,
    ami50UnitsNeeded: 150,
    ami60UnitsNeeded: 150,
    totalUndersupply: 800   // 500/800 = 62.5% → critical
  });
  var profile = bridge.buildNeedProfile(hna, SAMPLE_PMA);
  var seg30   = profile.prioritySegments.find(function (s) { return s.ami === 30; });
  assert(seg30 !== undefined, 'segment for 30% AMI exists');
  assert(seg30.priority === 'critical', '30% AMI segment is critical when dominant (62.5% of gap)');
});

test('Priority segments sorted by priority level', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  var segs    = profile.prioritySegments;
  var order   = { critical: 0, high: 1, moderate: 2, low: 3 };
  var sorted  = true;
  for (var i = 0; i < segs.length - 1; i++) {
    if ((order[segs[i].priority] || 3) > (order[segs[i + 1].priority] || 3)) sorted = false;
  }
  assert(sorted, 'priority segments are sorted by priority level');
});

// ── Confidence ────────────────────────────────────────────────────────────────

test('High confidence with complete HNA + PMA data', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  assert(profile.confidence === 'high', 'confidence is high with complete data (got: ' + profile.confidence + ')');
});

test('Low confidence with no data', () => {
  var profile = bridge.buildNeedProfile(null, null);
  assert(profile.confidence === 'low', 'confidence is low with no data');
});

test('Missing data adds caveats', () => {
  var profile = bridge.buildNeedProfile(null, null);
  assert(profile.caveats.length > 0, 'caveats added when data is missing');
});

test('Stale HNA data adds caveat', () => {
  var staleHna = Object.assign({}, SAMPLE_HNA, { dataVintage: '2020-01-01' });
  var profile  = bridge.buildNeedProfile(staleHna, SAMPLE_PMA);
  var hasStale = profile.caveats.some(function (c) { return /months old|stale|old/i.test(c); });
  assert(hasStale, 'stale HNA data triggers age caveat');
});

// ── toDealInputs ──────────────────────────────────────────────────────────────

test('toDealInputs produces DealInputs-compatible object', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  var inputs  = bridge.toDealInputs(profile);
  assert(typeof inputs.geoid             === 'string', 'geoid is string');
  assert(typeof inputs.pmaScore          === 'number', 'pmaScore is number');
  assert(typeof inputs.ami30UnitsNeeded  === 'number', 'ami30UnitsNeeded is number');
  assert(typeof inputs.ami50UnitsNeeded  === 'number', 'ami50UnitsNeeded is number');
  assert(typeof inputs.ami60UnitsNeeded  === 'number', 'ami60UnitsNeeded is number');
  assert(typeof inputs.totalUndersupply  === 'number', 'totalUndersupply is number');
});

test('toDealInputs values match NeedProfile', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA, { geoid: '08031' });
  var inputs  = bridge.toDealInputs(profile);
  assert(inputs.geoid            === '08031', 'geoid matches');
  assert(inputs.pmaScore         === 72,      'pmaScore matches');
  assert(inputs.ami30UnitsNeeded === 320,     'ami30UnitsNeeded matches');
  assert(inputs.totalUndersupply === 800,     'totalUndersupply matches');
  assert(inputs.marketVacancy    === 0.035,   'marketVacancy matches vacancy');
});

test('toDealInputs merges overrides', () => {
  var profile = bridge.buildNeedProfile(SAMPLE_HNA, SAMPLE_PMA);
  var inputs  = bridge.toDealInputs(profile, { proposedUnits: 75, isQct: true });
  assert(inputs.proposedUnits === 75,   'override proposedUnits applied');
  assert(inputs.isQct         === true, 'override isQct applied');
  assert(inputs.pmaScore      === 72,   'base pmaScore preserved');
});

test('toDealInputs handles null needProfile', () => {
  var inputs = bridge.toDealInputs(null, { proposedUnits: 60 });
  assert(inputs.proposedUnits === 60, 'overrides applied even when profile is null');
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('Handles completely empty HNA object', () => {
  var profile = bridge.buildNeedProfile({}, SAMPLE_PMA);
  assert(typeof profile.confidence === 'string', 'confidence string even with empty HNA');
  assert(Array.isArray(profile.prioritySegments), 'prioritySegments array even with empty HNA');
});

test('Handles undefined inputs gracefully', () => {
  var profile = bridge.buildNeedProfile(undefined, undefined);
  assert(profile && typeof profile.confidence === 'string', 'handles undefined inputs');
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log('\n' + '\u2500'.repeat(60));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
