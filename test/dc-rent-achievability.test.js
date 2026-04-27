'use strict';
/**
 * test/dc-rent-achievability.test.js
 *
 * Unit tests for the pure `computeRentAchievability` function exposed by
 * js/deal-calculator.js. Validates the LIHTC ceiling vs HUD FMR 2BR
 * comparison + status thresholds that drive the new Rent Achievability
 * Check panel.
 *
 * Run: node test/dc-rent-achievability.test.js
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

// ── Fixtures ──
// Adams County (Denver MSA): strong rental market — LIHTC 60% ceiling
// is below HUD FMR 2BR, so rents clear comfortably.
const ADAMS = {
  amiLimits: { 30: 931, 40: 1241, 50: 1551, 60: 1862 },
  fmr:       { efficiency: 1348, one_br: 1484, two_br: 1802, three_br: 2386, four_br: 2750 }
};

// Otero County: weak rural market — LIHTC ceilings approach or exceed
// HUD FMR 2BR, signalling that proforma rents at the ceiling won't
// actually clear and revenue assumptions need a haircut.
const OTERO = {
  amiLimits: { 30: 412, 40: 549, 50: 686, 60: 824 },
  fmr:       { efficiency: 720, one_br: 815, two_br: 950, three_br: 1305, four_br: 1448 }
};

test('API exposed', function () {
  assert(typeof dc.computeRentAchievability === 'function', 'computeRentAchievability exported');
});

test('null / missing input → null', function () {
  assert(dc.computeRentAchievability(null) === null,                 'null → null');
  assert(dc.computeRentAchievability({}) === null,                   '{} → null');
  assert(dc.computeRentAchievability({ amiLimits: {} }) === null,    'missing fmr → null');
  assert(dc.computeRentAchievability({ fmr: {} }) === null,          'missing amiLimits → null');
});

test('FMR 2BR missing or zero → null', function () {
  assert(dc.computeRentAchievability({
    amiLimits: ADAMS.amiLimits,
    fmr: { two_br: 0 }
  }) === null, 'zero 2BR → null');
  assert(dc.computeRentAchievability({
    amiLimits: ADAMS.amiLimits,
    fmr: { efficiency: 1000 }
  }) === null, 'no 2BR field → null');
});

test('Adams (Denver MSA) — all tiers clear market', function () {
  const r = dc.computeRentAchievability(ADAMS);
  assert(r !== null && Array.isArray(r.tiers),  'returns tiers array');
  assert(r.tiers.length === 4,                   'all 4 AMI tiers present');

  const t30 = r.tiers.find(t => t.pct === 30);
  const t60 = r.tiers.find(t => t.pct === 60);
  assert(t30.gap === 931 - 1802,                'gap = ceiling − FMR (30% AMI)');
  assert(t30.gap < 0,                            '30% AMI ceiling well below FMR (clear)');
  assert(t30.status === 'clear',                 'status: clear');

  // 60% AMI: 1862 − 1802 = 60 → "tight" (gap > 50 wait, 60 > 50)
  assert(t60.gap === 60,                         'gap = +60 (60% AMI ceiling slightly above FMR)');
  assert(t60.status === 'concerning',            '60-dollar gap is "concerning" (> $50 threshold)');
});

test('Otero (rural) — high tiers misaligned', function () {
  const r = dc.computeRentAchievability(OTERO);
  const t30 = r.tiers.find(t => t.pct === 30);
  const t60 = r.tiers.find(t => t.pct === 60);
  assert(t30.gap === 412 - 950,                 '30% AMI very far below FMR');
  assert(t30.status === 'clear',                 '30% AMI: clear');
  // 60% AMI: 824 − 950 = -126 → still clear
  assert(t60.gap === -126,                       '60% AMI gap = -126');
  assert(t60.status === 'clear',                 '60% AMI: clear (FMR is HIGH relative to AMI in rural Otero)');
});

test('synthetic — concerning + misaligned status thresholds', function () {
  // Force gaps on each side of the threshold:
  //   gap = 0  → clear
  //   gap = 1  → tight (≤ $50)
  //   gap = 51 → concerning (> $50, ≤ $200)
  //   gap = 201 → misaligned
  const r = dc.computeRentAchievability({
    amiLimits: { 30: 1000, 40: 1001, 50: 1051, 60: 1201 },
    fmr: { efficiency: 800, one_br: 900, two_br: 1000, three_br: 1100, four_br: 1200 }
  });
  const byPct = {};
  r.tiers.forEach(t => byPct[t.pct] = t);
  assert(byPct[30].status === 'clear',       '30% AMI gap=0 → clear');
  assert(byPct[40].status === 'tight',       '40% AMI gap=+1 → tight');
  assert(byPct[50].status === 'concerning',  '50% AMI gap=+51 → concerning');
  assert(byPct[60].status === 'misaligned',  '60% AMI gap=+201 → misaligned');
});

test('partial AMI tier coverage — only present tiers returned', function () {
  // If only 50% and 60% AMI are populated (some counties may lack 30/40 limits),
  // the result should include only those tiers, not synthesized fillers.
  const r = dc.computeRentAchievability({
    amiLimits: { 50: 1000, 60: 1200 },
    fmr: { two_br: 1100 }
  });
  assert(r.tiers.length === 2,             'only 2 tiers returned');
  assert(r.tiers[0].pct === 50,            'first tier is 50% AMI');
  assert(r.tiers[1].pct === 60,            'second tier is 60% AMI');
});

test('all amiLimits zero/null → null result (no tiers)', function () {
  const r = dc.computeRentAchievability({
    amiLimits: { 30: 0, 40: null, 50: undefined, 60: 0 },
    fmr: { two_br: 1500 }
  });
  assert(r === null, 'no valid tiers → null');
});

test('fmr passes through for downstream rendering', function () {
  const r = dc.computeRentAchievability(ADAMS);
  assert(r.fmr === ADAMS.fmr,                   'fmr returned unchanged for downstream UI');
  assert(r.fmr.three_br === 2386,               'bedroom data accessible');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
