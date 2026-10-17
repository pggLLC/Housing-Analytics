'use strict';
/**
 * test/lihtc-deal-predictor-backtest.test.js
 *
 * The Concept Recommendation card must agree with what CHFA actually did.
 * Runs js/lihtc-deal-predictor.js the way js/deal-calculator.js calls it
 * (unit count, county, boost flag, the county's AMI shortfall; no soft
 * funding, no PMA score) on every CHFA allocation since 2019 with a 4% or 9%
 * credit, and compares the credit it names with the credit CHFA allocated.
 *
 * Before 2026-10-17 it named the right credit for 86 of 275 and never named
 * 4% (69% of those deals were 4%). The floor below is set under the measured
 * 218 of 275 so a new award round cannot fail it by itself; the 4% check is
 * the one that caught the original defect.
 *
 * Also pins the predictor's fallback constants to the data files that hold
 * the adopted values, so the two cannot drift apart silently.
 *
 * Run: node test/lihtc-deal-predictor-backtest.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Predictor = require('../js/lihtc-deal-predictor.js');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const chfa = read('data/chfa-lihtc.json').features.map((f) => f.properties);
const gapByFips = {};
read('data/co_ami_gap_by_county.json').counties.forEach((c) => { gapByFips[c.fips] = c; });

function pageInputs(p) {
  // Mirrors _runDealPredictor in js/deal-calculator.js.
  const c = gapByFips[p.CNTY_FIPS];
  const g = (c && c.gap_units_minus_households_le_ami_pct) || {};
  return {
    softFundingAvailable: null,
    pmaScore: null,
    geoid: p.CNTY_FIPS,
    countyFips: p.CNTY_FIPS,
    proposedUnits: p.N_UNITS,
    isQct: !!(p.QCT || p.DDA),
    ami30UnitsNeeded: Math.max(0, -(g['30'] || 0)),
    ami50UnitsNeeded: Math.max(0, -(g['50'] || 0)),
    ami60UnitsNeeded: Math.max(0, -(g['60'] || 0))
  };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch (err) { console.log('  ❌ ' + name + '\n     ' + err.message); failed++; }
}

const deals = chfa.filter((p) => p.AwardYear >= 2019 && p.N_UNITS > 0 && /4%|9%/.test(p.TypeOfCredits || ''));
const results = deals.map((p) => ({
  actual: /4%/.test(p.TypeOfCredits) ? '4%' : '9%',
  predicted: Predictor.predictConcept(pageInputs(p)).recommendedExecution
}));
const right = results.filter((r) => r.actual === r.predicted).length;
const actual4 = results.filter((r) => r.actual === '4%');
const right4 = actual4.filter((r) => r.predicted === '4%').length;

console.log('Backtest: ' + right + ' of ' + results.length + ' CHFA allocations since 2019 (' +
  right4 + ' of ' + actual4.length + ' 4% deals)');

test('the scan found the CHFA allocations it backtests against', () => {
  assert.ok(results.length >= 200, 'only ' + results.length + ' allocations found');
  assert.ok(actual4.length >= 100, 'only ' + actual4.length + ' 4% allocations found');
});

test('names the credit CHFA allocated for at least 75% of deals', () => {
  assert.ok(right / results.length >= 0.75, right + ' of ' + results.length);
});

test('names 4% for at least two thirds of the deals CHFA funded with 4%', () => {
  assert.ok(right4 / actual4.length >= 2 / 3, right4 + ' of ' + actual4.length);
});

test('a county-wide 30% AMI shortfall does not make a project "deep affordability"', () => {
  const big = Predictor.predictConcept({ proposedUnits: 80, countyFips: '08031', ami30UnitsNeeded: 20000 });
  assert.equal(big.recommendedExecution, '4%');
  const small = Predictor.predictConcept({ proposedUnits: 40, countyFips: '08031', ami30UnitsNeeded: 20000 });
  assert.ok(!small.keyRationale.some((r) => /^Deep affordability need/.test(r)), small.keyRationale.join(' | '));
  assert.ok(small.keyRationale.some((r) => /^Area shortfall of 20000 households/.test(r)), small.keyRationale.join(' | '));
  const own = Predictor.predictConcept({ proposedUnits: 40, countyFips: '08031', ami30UnitsNeeded: 25 });
  assert.ok(own.keyRationale.some((r) => /^Deep affordability need/.test(r)), 'a project-level 30% count still counts');
});

test('9% credit is capped at the CHFA per-project limit (50 homes, La Plata, boosted)', () => {
  const rec = Predictor.predictConcept({ proposedUnits: 50, countyFips: '08067', isDda: true, softFundingAvailable: 0 });
  const stack = rec.indicativeCapitalStack;
  assert.equal(rec.recommendedExecution, '9%');
  assert.equal(stack.creditCapApplied, true);
  assert.equal(stack.annualCredit, Predictor._assumptions.nineCreditAnnualCap);
});

test('the 9% cap constant equals the adopted QAP rule in lihtc-underwriting-rules.json', () => {
  const rule = read('data/policy/lihtc-underwriting-rules.json').rules.credit_cap_federal_9pct;
  assert.equal(rule.status, 'adopted');
  assert.equal(Predictor._assumptions.nineCreditAnnualCap, rule.annual_cap);
});

test('the fallback hard cost equals lihtc-assumptions.json family cost', () => {
  const doc = read('data/policy/lihtc-assumptions.json');
  assert.equal(Predictor._assumptions.hardCostPerUnit, doc.hardCostPerUnit.family);
});

test('Gunnison County gets a mountain cost multiplier, not the Front Range base', () => {
  const rec = Predictor.predictConcept({ proposedUnits: 44, countyFips: '08051', softFundingAvailable: 0 });
  assert.ok(rec.indicativeCapitalStack.hardCostMultiplier > 1, String(rec.indicativeCapitalStack.hardCostMultiplier));
});

console.log('\nlihtc-deal-predictor-backtest: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
