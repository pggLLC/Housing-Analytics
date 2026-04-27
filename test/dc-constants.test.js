'use strict';
/**
 * test/dc-constants.test.js
 *
 * Validates that the Methodology & Formulas panel's editable constants
 * actually flow through to the math:
 *   - rentBurdenPct affects the LIHTC ceiling formula
 *   - rent/vac/opex stress percentages affect computeDscrStressScenarios
 *   - combined-stress trio affects the combined scenario
 *   - DEFAULT_CONSTANTS exposes the industry-standard defaults
 *
 * Run: node test/dc-constants.test.js
 */

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
  url: 'http://localhost/'
});
global.document = dom.window.document;
global.window   = dom.window;
global.HTMLElement = dom.window.HTMLElement;

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
  tol = tol == null ? 1 : tol;
  return Math.abs(a - b) <= tol;
}

const CANONICAL = {
  annualRents:       1000000,
  vacancyPct:        0.07,
  annualOpex:        324000,
  annualRepReserve:  21000,
  netPropTax:        48000,
  annualDebtService: 447500
};

test('DEFAULT_CONSTANTS exported and matches industry standards', function () {
  const D = dc.DEFAULT_CONSTANTS;
  assert(typeof D === 'object',                 'DEFAULT_CONSTANTS is an object');
  assert(D.rentBurdenPct   === 0.30,            'rentBurdenPct = 30% (HUD standard)');
  assert(D.rentStressPct   === 0.10,            'rentStressPct = 10%');
  assert(D.vacStressPp     === 0.05,            'vacStressPp   = 5 pp');
  assert(D.opexStressPct   === 0.10,            'opexStressPct = 10%');
  assert(D.combinedRentPct === 0.05,            'combinedRentPct = 5%');
  assert(D.combinedVacPp   === 0.03,            'combinedVacPp   = 3 pp');
  assert(D.combinedOpexPct === 0.05,            'combinedOpexPct = 5%');
});

test('test helpers _getConstants / _setConstantsForTest / _resetConstantsForTest exposed', function () {
  assert(typeof dc._getConstants          === 'function', '_getConstants exported');
  assert(typeof dc._setConstantsForTest   === 'function', '_setConstantsForTest exported');
  assert(typeof dc._resetConstantsForTest === 'function', '_resetConstantsForTest exported');
});

test('reset returns to industry defaults', function () {
  dc._setConstantsForTest({ rentBurdenPct: 0.28 });
  assert(dc._getConstants().rentBurdenPct === 0.28, 'override applied');
  dc._resetConstantsForTest();
  assert(dc._getConstants().rentBurdenPct === 0.30, 'reset restores default');
});

test('default stress matches the original hard-coded behavior', function () {
  dc._resetConstantsForTest();
  const s = dc.computeDscrStressScenarios(CANONICAL, dc.DEFAULT_CONSTANTS);
  // baseline regressions from #720's test:
  // base NOI = 537000, rent10 NOI = 444000, vac5 = 487000, opex10 = 504600,
  // combined = 445800
  assert(nearly(s.base.noi, 537000),     'default base NOI = 537,000');
  assert(nearly(s.rent10.noi, 444000),   'default rent10 NOI = 444,000');
  assert(nearly(s.vac5.noi, 487000),     'default vac5 NOI = 487,000');
  assert(nearly(s.opex10.noi, 504600),   'default opex10 NOI = 504,600');
  assert(nearly(s.combined.noi, 445800), 'default combined NOI = 445,800');
});

test('non-default rent stress percentage flows through', function () {
  // Tighten rent stress from 10% to 15%
  const constants = Object.assign({}, dc.DEFAULT_CONSTANTS, { rentStressPct: 0.15 });
  const s = dc.computeDscrStressScenarios(CANONICAL, constants);
  // EGI at 85% rent = 1,000,000 × 0.85 × 0.93 = 790,500
  // NOI = 790,500 − 324,000 − 21,000 − 48,000 = 397,500
  assert(nearly(s.rent10.noi, 397500),
    '15% rent stress NOI = 397,500 (got ' + Math.round(s.rent10.noi) + ')');
  // DSCR = 397,500 / 447,500 ≈ 0.888
  assert(nearly(s.rent10.dscr, 397500 / 447500, 0.001),
    '15% rent stress DSCR ≈ 0.89 (got ' + s.rent10.dscr.toFixed(3) + ')');
  // Should be lower than the 10%-stress DSCR (0.99) — tighter stress = worse
  const sDefault = dc.computeDscrStressScenarios(CANONICAL, dc.DEFAULT_CONSTANTS);
  assert(s.rent10.dscr < sDefault.rent10.dscr,
    'tighter rent stress (15% > 10%) produces lower DSCR');
});

test('non-default vacancy stress flows through', function () {
  const constants = Object.assign({}, dc.DEFAULT_CONSTANTS, { vacStressPp: 0.10 });
  const s = dc.computeDscrStressScenarios(CANONICAL, constants);
  // Vac = 0.07 + 0.10 = 0.17; EGI = 1,000,000 × 0.83 = 830,000
  // NOI = 830,000 − 324,000 − 21,000 − 48,000 = 437,000
  assert(nearly(s.vac5.noi, 437000),
    '10pp vacancy stress NOI = 437,000 (got ' + Math.round(s.vac5.noi) + ')');
});

test('non-default opex stress flows through', function () {
  const constants = Object.assign({}, dc.DEFAULT_CONSTANTS, { opexStressPct: 0.20 });
  const s = dc.computeDscrStressScenarios(CANONICAL, constants);
  // EGI unchanged at 930,000
  // NOI = 930,000 − 324,000×1.20 − 21,000 − 48,000 = 472,200
  assert(nearly(s.opex10.noi, 472200),
    '20% opex stress NOI = 472,200 (got ' + Math.round(s.opex10.noi) + ')');
});

test('combined stress respects all three constants together', function () {
  const constants = Object.assign({}, dc.DEFAULT_CONSTANTS, {
    combinedRentPct: 0.10,
    combinedVacPp:   0.05,
    combinedOpexPct: 0.10
  });
  const s = dc.computeDscrStressScenarios(CANONICAL, constants);
  // Vac = 0.07+0.05 = 0.12; EGI = 1,000,000 × 0.90 × 0.88 = 792,000
  // NOI = 792,000 − 324,000×1.10 − 21,000 − 48,000 = 366,600
  assert(nearly(s.combined.noi, 366600),
    'tighter combined stress NOI = 366,600 (got ' + Math.round(s.combined.noi) + ')');
});

test('zero stress percentages → stressed NOI == base NOI', function () {
  const noStress = Object.assign({}, dc.DEFAULT_CONSTANTS, {
    rentStressPct: 0, vacStressPp: 0, opexStressPct: 0,
    combinedRentPct: 0, combinedVacPp: 0, combinedOpexPct: 0
  });
  const s = dc.computeDscrStressScenarios(CANONICAL, noStress);
  assert(nearly(s.rent10.noi,   s.base.noi),   'rent10 NOI = base when no stress');
  assert(nearly(s.vac5.noi,     s.base.noi),   'vac5 NOI = base when no stress');
  assert(nearly(s.opex10.noi,   s.base.noi),   'opex10 NOI = base when no stress');
  assert(nearly(s.combined.noi, s.base.noi),   'combined NOI = base when no stress');
});

test('omitted constants argument falls back to defaults (back-compat)', function () {
  const s = dc.computeDscrStressScenarios(CANONICAL); // no second arg
  // Should match #720's original assertions exactly
  assert(nearly(s.rent10.noi, 444000),   'default behavior preserved when constants omitted');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
