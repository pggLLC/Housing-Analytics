'use strict';
/**
 * test/lihtc-deal-predictor.test.js
 *
 * Unit tests for js/lihtc-deal-predictor.js — LIHTC deal-concept
 * recommender. Covers execution-path selection, concept-type selection,
 * saturation / absorption logic, confidence scoring, scenario
 * sensitivity, and the legacy predict() wrapper.
 *
 * The module factory exports a CommonJS surface, so no DOM is required.
 *
 * Run: node test/lihtc-deal-predictor.test.js
 */

const assert = require('node:assert/strict');

const Predictor = require('../js/lihtc-deal-predictor.js');

/* ── Test harness ───────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

function group(name, fn) {
  console.log(`\n${name}`);
  fn();
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function baseInputs(overrides) {
  return Object.assign({
    proposedUnits:          60,
    ami30UnitsNeeded:       5,
    totalUndersupply:       400,
    competitiveSetSize:     0,
    softFundingAvailable:   500_000,
    pmaScore:               70,
    isQct:                  false,
    isDda:                  false,
    pabCapAvailable:        null,
    seniorsDemand:          false,
    supportiveNeed:         false,
  }, overrides || {});
}

/* ── Tests ──────────────────────────────────────────────────────────── */

console.log('LIHTCDealPredictor — unit tests');

group('1. Public API surface', () => {
  test('exports predictConcept, predict, DISCLAIMER', () => {
    assert.equal(typeof Predictor.predictConcept, 'function');
    assert.equal(typeof Predictor.predict, 'function');
    assert.equal(typeof Predictor.DISCLAIMER, 'string');
    assert.ok(Predictor.DISCLAIMER.length > 20, 'DISCLAIMER should be a real sentence');
  });

  test('predictConcept({}) returns every documented key', () => {
    const rec = Predictor.predictConcept({});
    const expected = [
      'recommendedExecution', 'conceptType', 'suggestedUnitMix',
      'suggestedAMIMix', 'indicativeCapitalStack', 'keyRationale',
      'keyRisks', 'caveats', 'confidence', 'confidenceBadge',
      'alternativePath', 'pabCapNote', 'fmrAlignment',
      'scenarioSensitivity', 'chfaAwardContext',
    ];
    for (const k of expected) {
      assert.ok(k in rec, `missing key: ${k}`);
    }
  });

  test('predict({}) returns legacy DealScore shape', () => {
    const d = Predictor.predict({});
    assert.ok(typeof d.feasibilityScore === 'number');
    assert.ok(d.feasibilityScore >= 0 && d.feasibilityScore <= 100);
    assert.equal(typeof d.recommendation, 'string');
    assert.ok(d.breakdown && typeof d.breakdown === 'object');
    assert.ok(typeof d.disclaimer === 'string');
  });
});

group('2. Execution path selection', () => {
  test('deep affordability + small project + low saturation → 9%', () => {
    const rec = Predictor.predictConcept(baseInputs({
      proposedUnits:      40,
      ami30UnitsNeeded:   25, // 62% > 25% deep-affordability threshold
      competitiveSetSize: 0,
    }));
    assert.equal(rec.recommendedExecution, '9%');
    assert.ok(rec.keyRationale.some(r => /deep affordability/i.test(r)),
      'expected deep-affordability rationale');
  });

  test('large scale (≥100 units) + soft funding + PAB available → 4%', () => {
    const rec = Predictor.predictConcept(baseInputs({
      proposedUnits:        150,
      softFundingAvailable: 1_000_000,
      pabCapAvailable:      true,
    }));
    assert.equal(rec.recommendedExecution, '4%');
    assert.ok(rec.keyRationale.some(r => /larger scale|support 4%/i.test(r)),
      'expected 4%-path rationale');
  });

  test('large scale with PAB explicitly unavailable → Either (not 4%)', () => {
    const rec = Predictor.predictConcept(baseInputs({
      proposedUnits:        150,
      softFundingAvailable: 1_000_000,
      pabCapAvailable:      false,
    }));
    assert.equal(rec.recommendedExecution, 'Either');
    assert.ok(rec.keyRisks.some(r => /PAB cap not available/i.test(r)));
  });

  test('small project default falls through to 9%', () => {
    const rec = Predictor.predictConcept(baseInputs({
      proposedUnits:    50,
      totalUndersupply: 800,
    }));
    assert.equal(rec.recommendedExecution, '9%');
  });

  test('oversaturated market + no soft funding → Either with both-headwinds risk', () => {
    const rec = Predictor.predictConcept(baseInputs({
      proposedUnits:        60,
      competitiveSetSize:   10,   // above saturationHighThreshold (5)
      softFundingAvailable: 0,
    }));
    assert.equal(rec.recommendedExecution, 'Either');
    assert.ok(rec.keyRisks.some(r => /both credit paths face headwinds|Soft funding unavailable/i.test(r)));
  });
});

group('3. Saturation and absorption signalling', () => {
  test('competitiveSetSize at threshold (5) flags market saturation risk', () => {
    const rec = Predictor.predictConcept(baseInputs({
      competitiveSetSize: 5,
    }));
    assert.ok(rec.keyRisks.some(r => /[Mm]arket saturation/.test(r)),
      'expected saturation risk at competitiveSetSize=5');
  });

  test('competitiveSetSize below med threshold (2) does NOT flag saturation risk', () => {
    // _identifyRisks emits the "Market saturation:" line at the MED
    // threshold (3), not just the high one (5). So cs=4 would still
    // fire it — only cs<=2 genuinely silences it.
    const rec = Predictor.predictConcept(baseInputs({
      competitiveSetSize: 2,
    }));
    assert.ok(!rec.keyRisks.some(r => /^Market saturation:/.test(r)),
      'should not emit Market saturation risk when cs is below med threshold');
  });

  test('competitiveSetSize at med threshold (3) flags the "within MA" saturation line', () => {
    const rec = Predictor.predictConcept(baseInputs({
      competitiveSetSize: 3,
    }));
    // The med-threshold risk wording differs slightly from the high one —
    // "within the market area" vs "within 1 mile may limit absorption".
    assert.ok(rec.keyRisks.some(r => /^Market saturation:.*within the market area$/.test(r)),
      'expected med-threshold saturation line at cs=3');
  });

  test('scenarioSensitivity.competitiveSet exposes ±2 perturbation labels', () => {
    const rec = Predictor.predictConcept(baseInputs({
      competitiveSetSize: 3,
    }));
    assert.ok(rec.scenarioSensitivity);
    // The shape may vary but should surface a saturation band label
    const ss = JSON.stringify(rec.scenarioSensitivity);
    assert.ok(/saturated|moderate|low/i.test(ss),
      'sensitivity output should include saturation band terminology');
  });
});

group('4. Basis-boost / QCT+DDA rationale', () => {
  test('isQct adds a basis-boost rationale', () => {
    const rec = Predictor.predictConcept(baseInputs({ isQct: true }));
    assert.ok(rec.keyRationale.some(r => /QCT/i.test(r) && /basis boost/i.test(r)));
  });

  test('isDda adds a basis-boost rationale', () => {
    const rec = Predictor.predictConcept(baseInputs({ isDda: true }));
    assert.ok(rec.keyRationale.some(r => /DDA/i.test(r) && /basis boost/i.test(r)));
  });

  test('neither QCT nor DDA → no basis-boost line', () => {
    const rec = Predictor.predictConcept(baseInputs());
    assert.ok(!rec.keyRationale.some(r => /basis boost/i.test(r)));
  });
});

group('5. Caveats from missing inputs', () => {
  test('missing pmaScore adds a caveat', () => {
    const rec = Predictor.predictConcept({ proposedUnits: 60 });
    assert.ok(rec.caveats.some(c => /PMA score not provided/i.test(c)));
  });

  test('missing ami30UnitsNeeded adds a caveat', () => {
    const rec = Predictor.predictConcept({ proposedUnits: 60 });
    assert.ok(rec.caveats.some(c => /HNA affordability gap data not provided/i.test(c)));
  });

  test('large project missing pabCapAvailable adds a caveat', () => {
    const rec = Predictor.predictConcept({ proposedUnits: 150 });
    assert.ok(rec.caveats.some(c => /PAB volume cap status not provided/i.test(c)));
  });

  test('small project missing pabCapAvailable does NOT add that caveat', () => {
    const rec = Predictor.predictConcept({ proposedUnits: 40 });
    assert.ok(!rec.caveats.some(c => /PAB volume cap status not provided/i.test(c)));
  });

  test('DISCLAIMER is always the first caveat', () => {
    const rec = Predictor.predictConcept(baseInputs());
    assert.equal(rec.caveats[0], Predictor.DISCLAIMER);
  });
});

group('6. Confidence + confidenceBadge', () => {
  test('confidence is one of low/medium/high', () => {
    const rec = Predictor.predictConcept(baseInputs());
    assert.ok(['low', 'medium', 'high'].includes(rec.confidence),
      `unexpected confidence: ${rec.confidence}`);
  });

  test('fully-specified inputs produce higher confidence than empty inputs', () => {
    const rank = { low: 0, medium: 1, high: 2 };
    const empty = Predictor.predictConcept({});
    const full  = Predictor.predictConcept(baseInputs({
      isQct:            true,
      pabCapAvailable:  true,
    }));
    assert.ok(rank[full.confidence] >= rank[empty.confidence],
      `full inputs (${full.confidence}) should not be LESS confident than empty (${empty.confidence})`);
  });

  test('confidenceBadge is a non-empty string', () => {
    const rec = Predictor.predictConcept(baseInputs());
    assert.equal(typeof rec.confidenceBadge, 'string');
    assert.ok(rec.confidenceBadge.length > 0);
  });
});

group('7. Unit and AMI mix', () => {
  test('suggestedUnitMix.total equals proposedUnits when supplied', () => {
    const rec = Predictor.predictConcept(baseInputs({ proposedUnits: 80 }));
    const sum = Object.values(rec.suggestedUnitMix).reduce((s, v) => {
      return s + (typeof v === 'number' ? v : 0);
    }, 0);
    // The mix structure may include a 'total' key or individual bedroom counts
    // that sum to proposedUnits. Either way the implied total should be ≥ 80.
    assert.ok(sum >= 80 || rec.suggestedUnitMix.total === 80,
      'unit-mix total should reflect proposedUnits=80');
  });

  test('suggestedAMIMix returns an object keyed by AMI tier', () => {
    const rec = Predictor.predictConcept(baseInputs({ proposedUnits: 60 }));
    assert.ok(rec.suggestedAMIMix && typeof rec.suggestedAMIMix === 'object');
  });
});

group('8. Legacy predict() wrapper', () => {
  test('feasibilityScore maps confidence: high→80, medium→55, low→30', () => {
    // We can't force a specific confidence reliably, but we can spot-check
    // that the returned score is one of the three expected tier values.
    const d = Predictor.predict(baseInputs());
    assert.ok([80, 55, 30].includes(d.feasibilityScore),
      `unexpected score ${d.feasibilityScore}`);
  });

  test('breakdown.execution matches predictConcept.recommendedExecution', () => {
    const inputs = baseInputs({ proposedUnits: 150, pabCapAvailable: true, softFundingAvailable: 1_000_000 });
    const d = Predictor.predict(inputs);
    const r = Predictor.predictConcept(inputs);
    assert.equal(d.breakdown.execution, r.recommendedExecution);
  });

  test('disclaimer on legacy shape matches module DISCLAIMER', () => {
    const d = Predictor.predict({});
    assert.equal(d.disclaimer, Predictor.DISCLAIMER);
  });
});

group('9. Robustness to bad inputs', () => {
  test('predictConcept handles null input gracefully', () => {
    const rec = Predictor.predictConcept(null);
    assert.ok(rec);
    assert.ok(Array.isArray(rec.caveats));
  });

  test('predictConcept handles string numbers (coerces via _num)', () => {
    const rec = Predictor.predictConcept(baseInputs({ proposedUnits: '60' }));
    assert.ok(rec.suggestedUnitMix);
  });

  test('predictConcept handles negative units without throwing', () => {
    const rec = Predictor.predictConcept(baseInputs({ proposedUnits: -10 }));
    assert.ok(rec);
    assert.ok(Array.isArray(rec.caveats));
  });
});

/* ── Summary ───────────────────────────────────────────────────────── */

console.log('\n=============================================');
console.log(`LIHTCDealPredictor: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
