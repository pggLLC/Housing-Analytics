'use strict';
/**
 * test/dc-dscr-stress.test.js
 *
 * Unit tests for the pure `computeDscrStressScenarios` function exposed by
 * js/deal-calculator.js. Validates the math that drives the new Debt
 * Service Coverage & Stress Tests panel on the Deal Calculator.
 *
 * Run: node test/dc-dscr-stress.test.js
 */

const { JSDOM } = require('jsdom');

// Minimal DOM — deal-calculator.js expects a document and window
const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
  url: 'http://localhost/'
});
global.document = dom.window.document;
global.window   = dom.window;
global.HTMLElement = dom.window.HTMLElement;

// Load the module (it wires window.__DealCalc)
require('../js/deal-calculator.js');

const dc = window.__DealCalc;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}
function nearly(a, b, tol) {
  tol = tol == null ? 1 : tol; // dollars by default
  return Math.abs(a - b) <= tol;
}

// Canonical baseline — the kind of 60-unit LIHTC deal a banker would model:
//   rents $1,000,000/yr, 7% vacancy, opex $324,000/yr, rep reserve $21,000/yr,
//   property tax (net) $48,000/yr → NOI $537,000/yr
//   Mortgage sized at target DCR 1.20, giving debt service $447,500/yr
const CANONICAL = {
  annualRents:       1000000,
  vacancyPct:        0.07,
  annualOpex:        324000,
  annualRepReserve:  21000,
  netPropTax:        48000,
  annualDebtService: 447500   // would give base DSCR = 1.20 exactly
};

test('API exposed', function () {
  assert(typeof dc === 'object',                      '__DealCalc on window');
  assert(typeof dc.computeDscrStressScenarios === 'function',
    'computeDscrStressScenarios exported');
});

test('null input → null (no crash, no fabricated output)', function () {
  assert(dc.computeDscrStressScenarios(null)      === null, 'null → null');
  assert(dc.computeDscrStressScenarios(undefined) === null, 'undefined → null');
  assert(dc.computeDscrStressScenarios({})        === null, '{} → null (no rents / debt service)');
});

test('zero debt service → null (deal not yet sized)', function () {
  assert(dc.computeDscrStressScenarios(Object.assign({}, CANONICAL, { annualDebtService: 0 })) === null,
    'zero debt service → null');
});

test('zero rents → null', function () {
  assert(dc.computeDscrStressScenarios(Object.assign({}, CANONICAL, { annualRents: 0 })) === null,
    'zero rents → null');
});

test('baseline — NOI matches manual calculation', function () {
  const s = dc.computeDscrStressScenarios(CANONICAL);
  // NOI = 1,000,000 × (1 − 0.07) − 324,000 − 21,000 − 48,000 = 537,000
  assert(nearly(s.base.noi, 537000),
    'base NOI is 537,000 (got ' + Math.round(s.base.noi) + ')');
  // DSCR = 537,000 / 447,500 ≈ 1.200
  assert(nearly(s.base.dscr, 537000 / 447500, 0.001),
    'base DSCR ≈ 1.20 (got ' + s.base.dscr.toFixed(3) + ')');
});

test('rent -10% — NOI drops by 10% of effective gross income', function () {
  const s = dc.computeDscrStressScenarios(CANONICAL);
  // Effective gross at 10% rent cut = 900,000 × 0.93 = 837,000
  // NOI_rent10 = 837,000 − 324,000 − 21,000 − 48,000 = 444,000
  assert(nearly(s.rent10.noi, 444000),
    'rent-10% NOI = 444,000 (got ' + Math.round(s.rent10.noi) + ')');
  // DSCR = 444,000 / 447,500 ≈ 0.992
  assert(nearly(s.rent10.dscr, 444000 / 447500, 0.001),
    'rent-10% DSCR ≈ 0.99 (got ' + s.rent10.dscr.toFixed(3) + ')');
  // Banker sanity check: a 10% rent drop pulls a 1.20x deal below 1.00 —
  // the deal fails debt coverage, confirming the stress is meaningful
  assert(s.rent10.dscr < 1.00,
    'rent-10% stress pulls DSCR below 1.00 for a standard 1.20x deal');
});

test('vacancy +5 pts — NOI drops by (rent × 5%)', function () {
  const s = dc.computeDscrStressScenarios(CANONICAL);
  // Eff vac = 0.07 + 0.05 = 0.12; EGI = 1,000,000 × 0.88 = 880,000
  // NOI = 880,000 − 324,000 − 21,000 − 48,000 = 487,000
  assert(nearly(s.vac5.noi, 487000),
    'vac+5 NOI = 487,000 (got ' + Math.round(s.vac5.noi) + ')');
});

test('opex +10% — NOI drops by 10% of opex only (not reserves, not tax)', function () {
  const s = dc.computeDscrStressScenarios(CANONICAL);
  // Only annualOpex is scaled. EGI unchanged at 930,000.
  // NOI = 930,000 − 324,000×1.10 − 21,000 − 48,000 = 504,600
  assert(nearly(s.opex10.noi, 504600),
    'opex+10% NOI = 504,600 (got ' + Math.round(s.opex10.noi) + ')');
});

test('combined stress — multi-variable NOI compounds', function () {
  const s = dc.computeDscrStressScenarios(CANONICAL);
  // Rent -5%, vac +3 pts, opex +5%
  // Eff vac = 0.10; EGI = 1,000,000 × 0.95 × 0.90 = 855,000
  // NOI = 855,000 − 324,000×1.05 − 21,000 − 48,000 = 445,800
  assert(nearly(s.combined.noi, 445800),
    'combined NOI = 445,800 (got ' + Math.round(s.combined.noi) + ')');
  // Combined is harsher than any single stress — a realistic downside
  assert(s.combined.dscr < s.vac5.dscr,
    'combined DSCR < vacancy-only DSCR (multi-stress compounds)');
  assert(s.combined.dscr < s.opex10.dscr,
    'combined DSCR < opex-only DSCR');
});

test('extreme vacancy does not produce negative occupancy', function () {
  // A 95% vacancy delta from a 7% base would push vacancy over 100%;
  // the function should clamp to 100% (zero rent) and produce a negative
  // NOI rather than NaN or infinite.
  const extreme = dc.computeDscrStressScenarios(Object.assign({}, CANONICAL, {
    vacancyPct: 0.95, // near-total vacancy to start
    annualDebtService: 447500
  }));
  const s = extreme.vac5;
  assert(isFinite(s.noi), 'clamped-vacancy NOI is finite (got ' + s.noi + ')');
  assert(isFinite(s.dscr), 'clamped-vacancy DSCR is finite');
});

test('zero opex-side inputs do not crash', function () {
  const lean = dc.computeDscrStressScenarios({
    annualRents:       500000,
    vacancyPct:        0.05,
    annualOpex:        0,
    annualRepReserve:  0,
    netPropTax:        0,
    annualDebtService: 300000
  });
  assert(lean != null,                     'lean-cost deal returns a result');
  assert(nearly(lean.base.noi, 475000),    'base NOI = 500k × 0.95 = 475k');
  assert(nearly(lean.base.dscr, 475000/300000, 0.001),
    'base DSCR ≈ 1.58');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
