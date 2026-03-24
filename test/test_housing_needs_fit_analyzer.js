/**
 * test/test_housing_needs_fit_analyzer.js
 * Unit tests for js/market-analysis/housing-needs-fit-analyzer.js
 *
 * Usage:
 *   node test/test_housing_needs_fit_analyzer.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */

'use strict';

const path     = require('path');
const analyzer = require(path.resolve(__dirname, '..', 'js', 'market-analysis', 'housing-needs-fit-analyzer'));

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

var SAMPLE_NEED_PROFILE = {
  geography: { name: 'Denver County', type: 'county', geoid: '08031' },
  pma:       { method: 'hybrid', score: 72, confidence: 'medium' },
  affordabilityGap: {
    ami30UnitsNeeded: 320,
    ami50UnitsNeeded: 280,
    ami60UnitsNeeded: 200,
    totalUndersupply: 800
  },
  prioritySegments: [
    { ami: '30% AMI', rank: 1, urgency: 'critical' },
    { ami: '50% AMI', rank: 2, urgency: 'high'     }
  ],
  confidence: 'medium',
  caveats:    []
};

var SAMPLE_REC = {
  recommendedExecution: '9%',
  conceptType:          'family',
  confidence:           'medium',
  confidenceBadge:      '\uD83D\uDFE1',
  suggestedUnitMix: {
    studio:   5,
    oneBR:   20,
    twoBR:   25,
    threeBR: 10
  },
  suggestedAMIMix: {
    ami30: '20%',
    ami40: '0%',
    ami50: '40%',
    ami60: '40%'
  },
  indicativeCapitalStack: {
    totalDevelopmentCost: 18000000,
    equity:               9000000,
    firstMortgage:        5000000,
    localSoft:            2000000,
    deferredFee:          1000000,
    gap:                  1000000
  },
  keyRationale:   ['Strong demand signal', 'Low vacancy rate'],
  keyRisks:       ['Competitive QAP environment'],
  alternativePath:'Consider 4% if more than 100 units',
  caveats:        ['This is a planning-level estimate only.']
};

// ── Module exports ─────────────────────────────────────────────────────────────

test('Module exports analyzeHousingNeedsFit function', () => {
  assert(typeof analyzer === 'object', 'module exports an object');
  assert(typeof analyzer.analyzeHousingNeedsFit === 'function', 'analyzeHousingNeedsFit is a function');
});

// ── HNSFit schema ─────────────────────────────────────────────────────────────

test('analyzeHousingNeedsFit returns complete HNSFit schema', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC);
  assert(typeof fit === 'object',           'returns an object');
  assert(typeof fit.geography === 'string', 'geography is string');
  assert(Array.isArray(fit.prioritySegments),'prioritySegments is array');
  assert(typeof fit.needCoverage === 'object','needCoverage is object');
  assert(typeof fit.needCoverage.ami30 === 'number', 'needCoverage.ami30 is number');
  assert(typeof fit.needCoverage.ami50 === 'number', 'needCoverage.ami50 is number');
  assert(typeof fit.needCoverage.ami60 === 'number', 'needCoverage.ami60 is number');
  assert(typeof fit.needCoverage.total === 'number', 'needCoverage.total is number');
  assert(typeof fit.alignment === 'string',  'alignment is string');
  assert(Array.isArray(fit.alignmentPoints), 'alignmentPoints is array');
  assert(Array.isArray(fit.gaps),            'gaps is array');
  assert(typeof fit.coveragePct === 'number','coveragePct is number');
});

// ── Field types & value ranges ─────────────────────────────────────────────────

test('needCoverage values are in [0, 100]', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC);
  assert(fit.needCoverage.ami30 >= 0 && fit.needCoverage.ami30 <= 100, 'ami30 in [0,100]');
  assert(fit.needCoverage.ami50 >= 0 && fit.needCoverage.ami50 <= 100, 'ami50 in [0,100]');
  assert(fit.needCoverage.ami60 >= 0 && fit.needCoverage.ami60 <= 100, 'ami60 in [0,100]');
  assert(fit.needCoverage.total >= 0 && fit.needCoverage.total <= 100, 'total in [0,100]');
});

test('alignment is one of the three valid values', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC);
  assert(['strong','partial','weak'].includes(fit.alignment), 'alignment is valid enum');
});

test('coveragePct is in [0, 100]', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC);
  assert(fit.coveragePct >= 0 && fit.coveragePct <= 100, 'coveragePct in [0,100]');
});

test('geography matches the input name', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC);
  assert(fit.geography === 'Denver County', 'geography matches input');
});

// ── Priority segments logic ────────────────────────────────────────────────────

test('prioritySegments are non-empty when AMI mix covers need tiers', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC);
  // SAMPLE_REC has ami30=20%, ami50=40%, ami60=40%; all three tiers have need
  assert(fit.prioritySegments.length > 0, 'at least one segment targeted');
});

test('prioritySegments include 30% AMI when ami30 allocation and need are both > 0', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC, { proposedUnits: 60 });
  // 20% of 60 units = 12 units at 30% AMI; need30 = 320
  assert(fit.prioritySegments.includes('30% AMI'), '30% AMI is in prioritySegments');
});

// ── Coverage calculation accuracy ─────────────────────────────────────────────

test('cov30 is capped at 100 when allocated units exceed unmet need', () => {
  const bigRec = Object.assign({}, SAMPLE_REC, {
    suggestedAMIMix: { ami30: '100%', ami40: '0%', ami50: '0%', ami60: '0%' }
  });
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, bigRec, { proposedUnits: 600 });
  assert(fit.needCoverage.ami30 === 100, 'cov30 capped at 100 when units > need');
});

test('coverage is 0 when no units allocated at a tier', () => {
  const zeroRec = Object.assign({}, SAMPLE_REC, {
    suggestedAMIMix: { ami30: '0%', ami40: '0%', ami50: '0%', ami60: '100%' }
  });
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, zeroRec, { proposedUnits: 60 });
  assert(fit.needCoverage.ami30 === 0, 'ami30 coverage is 0 when no units allocated');
  assert(fit.needCoverage.ami50 === 0, 'ami50 coverage is 0 when no units allocated');
});

// ── Gap detection ─────────────────────────────────────────────────────────────

test('gaps are reported when need > 50 and no units allocated', () => {
  const noAmi30Rec = Object.assign({}, SAMPLE_REC, {
    suggestedAMIMix: { ami30: '0%', ami40: '0%', ami50: '50%', ami60: '50%' }
  });
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, noAmi30Rec, { proposedUnits: 60 });
  // need30 = 320 > 50 and no ami30 allocation
  assert(fit.gaps.length > 0, 'gap reported for unaddressed 30% AMI need');
  assert(fit.gaps.some(function(g) { return g.includes('30% AMI'); }), '30% AMI gap mentioned');
});

test('no gaps when all needs are sufficiently addressed', () => {
  const bigAllRec = Object.assign({}, SAMPLE_REC, {
    suggestedAMIMix: { ami30: '34%', ami40: '0%', ami50: '33%', ami60: '33%' }
  });
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, bigAllRec, { proposedUnits: 2400 });
  // 816 units at 30%, 792 at 50%, 792 at 60% vs needs of 320, 280, 200 — all far exceed
  assert(fit.gaps.length === 0, 'no gaps when all needs are addressed');
});

// ── Null / empty input handling ────────────────────────────────────────────────

test('handles null needProfile gracefully', () => {
  const fit = analyzer.analyzeHousingNeedsFit(null, SAMPLE_REC);
  assert(typeof fit === 'object',           'returns object for null needProfile');
  assert(fit.alignment === 'weak',          'alignment is weak for null input');
  assert(fit.coveragePct === 0,             'coveragePct is 0 for null input');
  assert(fit.alignmentPoints.length > 0,   'alignmentPoints has fallback message');
});

test('handles null rec gracefully', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, null);
  assert(typeof fit === 'object',           'returns object for null rec');
  assert(fit.alignment === 'weak',          'alignment is weak for null input');
});

test('handles both null inputs', () => {
  const fit = analyzer.analyzeHousingNeedsFit(null, null);
  assert(typeof fit === 'object',           'returns object for null+null');
  assert(fit.coveragePct === 0,             'coveragePct is 0');
  assert(Array.isArray(fit.gaps),           'gaps is an array');
});

test('handles empty affordabilityGap', () => {
  const emptyGapProfile = Object.assign({}, SAMPLE_NEED_PROFILE, { affordabilityGap: {} });
  const fit = analyzer.analyzeHousingNeedsFit(emptyGapProfile, SAMPLE_REC);
  assert(typeof fit === 'object',           'returns object');
  assert(fit.needCoverage.ami30 === 0 || fit.needCoverage.ami30 === 100, 'ami30 coverage handles zero need');
});

test('handles missing geography gracefully', () => {
  const noGeoProfile = Object.assign({}, SAMPLE_NEED_PROFILE, { geography: null });
  const fit = analyzer.analyzeHousingNeedsFit(noGeoProfile, SAMPLE_REC);
  assert(typeof fit.geography === 'string', 'geography falls back to default string');
  assert(fit.geography.length > 0,          'fallback geography is non-empty');
});

// ── proposedUnits override ─────────────────────────────────────────────────────

test('opts.proposedUnits overrides unit-mix total', () => {
  const fit1 = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC, { proposedUnits: 120 });
  const fit2 = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC, { proposedUnits: 60  });
  // More units → higher coverage
  assert(fit1.coveragePct >= fit2.coveragePct, 'doubling units increases or maintains coverage');
});

// ── alignmentPoints ────────────────────────────────────────────────────────────

test('alignmentPoints is a non-empty array', () => {
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, SAMPLE_REC);
  assert(Array.isArray(fit.alignmentPoints),      'alignmentPoints is array');
  assert(fit.alignmentPoints.length >= 1,         'at least one point');
  fit.alignmentPoints.forEach(function(p, i) {
    assert(typeof p === 'string', 'alignmentPoints[' + i + '] is string');
    assert(p.length > 0,          'alignmentPoints[' + i + '] is non-empty');
  });
});

// ── ami40 split logic ──────────────────────────────────────────────────────────

test('ami40 units contribute to both 30% and 50% effective counts', () => {
  const ami40Rec = Object.assign({}, SAMPLE_REC, {
    suggestedAMIMix: { ami30: '0%', ami40: '40%', ami50: '0%', ami60: '60%' }
  });
  const fit = analyzer.analyzeHousingNeedsFit(SAMPLE_NEED_PROFILE, ami40Rec, { proposedUnits: 100 });
  // 40 units at 40% AMI → 20 contribute to 30% tier, 20 to 50% tier
  assert(fit.needCoverage.ami30 > 0, 'ami40 units help cover 30% AMI need');
  assert(fit.needCoverage.ami50 > 0, 'ami40 units help cover 50% AMI need');
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '\u2500'.repeat(60));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
  process.exit(1);
}
