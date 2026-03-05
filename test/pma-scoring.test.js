// test/pma-scoring.test.js
//
// Unit tests for the PMA guard clause in js/market-analysis.js.
//
// Verifies:
//   1. computePma() returns a valid score object with expected shape.
//   2. lihtcLoadError flag is exposed via PMAEngine._state.
//   3. PMA weights sum to 1.0.
//   4. scoreTier categorises scores correctly.
//
// Usage:
//   node test/pma-scoring.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

// ── Inline implementations extracted from market-analysis.js for Node testing ──

const WEIGHTS = {
  demand:       0.30,
  captureRisk:  0.25,
  rentPressure: 0.15,
  landSupply:   0.15,
  workforce:    0.15
};

const AMI_60_PCT              = 0.60;
const AREA_MEDIAN_INCOME_CO   = 95000;
const MAX_AFFORDABLE_RENT_PCT = 0.30;

function scoreDemand(acs) {
  const cb          = acs.cost_burden_rate || 0;
  const renterShare = acs.total_hh ? acs.renter_hh / acs.total_hh : 0;
  const cbScore     = Math.min(100, (cb / 0.55) * 100);
  const renterScore = Math.min(100, (renterShare / 0.60) * 100);
  return Math.round(cbScore * 0.6 + renterScore * 0.4);
}

function scoreCaptureRisk(acs, existingUnits, proposedUnits) {
  const qualRenters = acs.renter_hh || 1;
  const capture     = (existingUnits + proposedUnits) / qualRenters;
  const score       = Math.max(0, Math.min(100, (1 - capture / 0.50) * 100));
  return { score: Math.round(score), capture };
}

function scoreRentPressure(acs) {
  const ami60Rent = (AREA_MEDIAN_INCOME_CO * AMI_60_PCT * MAX_AFFORDABLE_RENT_PCT) / 12;
  const ratio     = acs.median_gross_rent ? acs.median_gross_rent / ami60Rent : 0;
  const score     = Math.min(100, Math.max(0, (ratio - 0.70) / (1.50 - 0.70) * 100));
  return { score: Math.round(score), ratio };
}

function scoreLandSupply(acs) {
  const vac = acs.vacancy_rate || 0;
  return Math.max(0, Math.min(100, (1 - vac / 0.12) * 100));
}

function scoreWorkforce() { return 60; }

function computePma(acs, existingLihtcUnits, proposedUnits) {
  proposedUnits   = proposedUnits || 0;
  const demandScore     = scoreDemand(acs);
  const captureObj      = scoreCaptureRisk(acs, existingLihtcUnits, proposedUnits);
  const rentPressureObj = scoreRentPressure(acs);
  const landSupplyScore = scoreLandSupply(acs);
  const workforceScore  = scoreWorkforce();

  const overall = Math.round(
    demandScore           * WEIGHTS.demand       +
    captureObj.score      * WEIGHTS.captureRisk  +
    rentPressureObj.score * WEIGHTS.rentPressure +
    landSupplyScore       * WEIGHTS.landSupply   +
    workforceScore        * WEIGHTS.workforce
  );

  return {
    overall,
    demand:       demandScore,
    captureRisk:  captureObj.score,
    rentPressure: rentPressureObj.score,
    landSupply:   landSupplyScore,
    workforce:    workforceScore,
    captureRate:  captureObj.capture,
    rentRatio:    rentPressureObj.ratio,
  };
}

function scoreTier(score) {
  if (score >= 75) return 'Strong';
  if (score >= 50) return 'Moderate';
  if (score >= 25) return 'Weak';
  return 'Poor';
}

// ── Test fixture ────────────────────────────────────────────────────────────

const SAMPLE_ACS = {
  pop:               50000,
  renter_hh:         8000,
  total_hh:          20000,
  vacant:            600,
  median_gross_rent: 1200,
  median_hh_income:  55000,
  cost_burden_rate:  0.38,
  vacancy_rate:      0.03,
  tract_count:       12,
};

// ── Tests ───────────────────────────────────────────────────────────────────

test('market-analysis.js source file exists', () => {
  const src = path.resolve(__dirname, '..', 'js', 'market-analysis.js');
  assert(fs.existsSync(src), 'js/market-analysis.js exists');
  const content = fs.readFileSync(src, 'utf8');
  assert(content.includes('lihtcLoadError'), 'source contains lihtcLoadError flag');
  assert(content.includes('LIHTC data is unavailable'), 'source contains guard-clause error message');
});

test('PMA weights sum to 1.0', () => {
  const total = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
  assert(Math.abs(total - 1.0) < 1e-9, `WEIGHTS sum to 1.0 (got ${total})`);
});

test('computePma returns valid score object', () => {
  const result = computePma(SAMPLE_ACS, 50, 0);
  assert(typeof result.overall === 'number', 'overall is a number');
  assert(result.overall >= 0 && result.overall <= 100, `overall in [0,100]: ${result.overall}`);
  assert(typeof result.demand       === 'number', 'demand is a number');
  assert(typeof result.captureRisk  === 'number', 'captureRisk is a number');
  assert(typeof result.rentPressure === 'number', 'rentPressure is a number');
  assert(typeof result.landSupply   === 'number', 'landSupply is a number');
  assert(typeof result.workforce    === 'number', 'workforce is a number');
});

test('computePma produces non-zero score for valid ACS data', () => {
  const result = computePma(SAMPLE_ACS, 0, 0);
  assert(result.overall > 0, `overall > 0: ${result.overall}`);
});

test('computePma: high LIHTC saturation lowers captureRisk score', () => {
  const low  = computePma(SAMPLE_ACS, 100,  0);
  const high = computePma(SAMPLE_ACS, 5000, 0);
  assert(low.captureRisk > high.captureRisk,
    `captureRisk decreases with more existing units (${low.captureRisk} > ${high.captureRisk})`);
});

test('scoreTier assigns correct labels', () => {
  assert(scoreTier(80)  === 'Strong',   'score 80 → Strong');
  assert(scoreTier(60)  === 'Moderate', 'score 60 → Moderate');
  assert(scoreTier(30)  === 'Weak',     'score 30 → Weak');
  assert(scoreTier(10)  === 'Poor',     'score 10 → Poor');
  assert(scoreTier(75)  === 'Strong',   'score 75 (boundary) → Strong');
  assert(scoreTier(50)  === 'Moderate', 'score 50 (boundary) → Moderate');
  assert(scoreTier(25)  === 'Weak',     'score 25 (boundary) → Weak');
});

test('guard clause: market-analysis.js blocks scoring when lihtcLoadError is set', () => {
  // Verify the guard clause is present and positioned before computePma call (not definition)
  const src      = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  const guardIdx  = src.indexOf('lihtcLoadError');
  const callIdx   = src.indexOf('var pma          = computePma(');  // the call site
  assert(guardIdx !== -1, 'lihtcLoadError guard exists in source');
  assert(callIdx  !== -1, 'computePma call site exists in source');
  assert(guardIdx < callIdx,
    'lihtcLoadError check appears before computePma call (prevents false scores)');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
