// test/pma-chfa-qualified-renters.test.js
//
// The capture-rate denominator follows CHFA's Market Study Guide (QAP
// Appendix A, section 7): renter households whose income is at or under the
// unit's AMI limit, high enough that the maximum tax-credit rent is no more
// than 40% of income, and whose size fits a 1-3 bedroom unit. CHFA's one
// published line is 85% (QAP section 2.B).
//
// Usage: node test/pma-chfa-qualified-renters.test.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../js/market-analysis-scoring.js');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); } catch (e) { failures++; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// One tract, one PUMA. 50% limits of 50,000 (1p) and 60,000 (3p); 60% rents
// of 1,000 (1BR) and 1,500 (2BR). Floors: 1p = 1000*12/0.4/50000*50 = 30%;
// 3p = 1500*12/0.4/60000*50 = 37.5%.
const lim50 = { '1p': 50000, '2p': 55000, '3p': 60000, '4p': 65000, '5p': 70000, '6p': 75000, '7p': 80000, '8p': 85000 };
const limits = { '08001': { regular_tiers: {
  '50': { income_limits: lim50, max_rents: { '1br': 900, '2br': 1200, '3br': 1400 } },
  '60': { income_limits: {}, max_rents: { '1br': 1000, '2br': 1500, '3br': 1700 } }
} } };
const bins = () => new Array(122).fill(0);
const mix = [bins(), bins(), bins(), bins(), bins(), bins()];
mix[0][20] = 100;   // 1p at 20%: under the 30% floor
mix[0][40] = 100;   // 1p at 40%: qualifies
mix[0][70] = 100;   // 1p at 70%: over 60%
mix[2][35] = 100;   // 3p at 35%: under the 37.5% floor
mix[2][45] = 100;   // 3p at 45%: qualifies
mix[5][45] = 100;   // 6+ people: no 1-3BR unit fits
// CHAS tiers: lte30, 31to50, 51to80, 81to100, 100plus
const demand = { pumas: { P1: mix }, tracts: { '08001000100': ['P1', 50, 300, 100, 0, 0] } };
const tracts = [{ geoid: '08001000100', _bufferShare: 1 }];

test('counts only households between the 40%-of-income floor and the limit, sized for 1-3 bedrooms', () => {
  const r = S.chfaQualifiedRenters(demand, limits, tracts, [60]);
  // 31to50 tier (bins 30-49) holds 1p@40, 3p@35, 3p@45, 6p@45 = 400; 1p@40 and 3p@45 qualify: 300 * 200/400.
  // 51to80 tier holds 1p@70 only: none qualify. lte30 holds 1p@20: under the floor.
  assert.strictEqual(r.source, 'chfa_qualified');
  assert.strictEqual(Math.round(r.value), 150);
  assert.strictEqual(Math.round(r.byTier[60]), 150);
});

test('a buffer share scales the tract', () => {
  const r = S.chfaQualifiedRenters(demand, limits, [{ geoid: '08001000100', _bufferShare: 0.5 }], [60]);
  assert.strictEqual(Math.round(r.value), 75);
});

test('missing inputs are unavailable, never zero renters', () => {
  assert.strictEqual(S.chfaQualifiedRenters(null, limits, tracts, [60]).value, null);
  assert.strictEqual(S.chfaQualifiedRenters(demand, null, tracts, [60]).value, null);
  assert.strictEqual(S.chfaQualifiedRenters(demand, limits, [], [60]).value, null);
});

test('the score reaches zero at CHFA\'s 85% line and names the CHFA denominator', () => {
  assert.strictEqual(S.CHFA_CAPTURE_LIMIT, 0.85);
  assert.strictEqual(S.RISK.captureHigh, S.CHFA_CAPTURE_LIMIT);
  const r = S.scoreCaptureRisk({ renter_hh: 5000 }, 85, 0, { value: 100, source: 'chfa_qualified' });
  assert.strictEqual(r.denominatorSource, 'chfa_qualified');
  assert.strictEqual(r.score, 0);
  assert.strictEqual(S.scoreCaptureRisk({}, 0, 0, { value: 100, source: 'chfa_qualified' }).score, 100);
});

test('real data: Denver 60% AMI qualified renters are fewer than all renters at or under 80% AMI', () => {
  const d = read('data/market/chfa_renter_demand_co.json');
  const lim = {};
  read('data/chfa-income-rent-limits-2026.json').counties.forEach((c) => { lim[c.fips] = c; });
  const denver = Object.keys(d.tracts).filter((g) => g.startsWith('08031')).map((g) => ({ geoid: g, _bufferShare: 1 }));
  assert(denver.length > 100, 'expected Denver tracts in the file');
  const r = S.chfaQualifiedRenters(d, lim, denver, [60]);
  const le80 = denver.reduce((s, t) => { const row = d.tracts[t.geoid]; return s + row[1] + row[2] + row[3]; }, 0);
  assert.strictEqual(r.tractsMissing, 0);
  assert(r.value > 0.1 * le80 && r.value < le80, 'qualified ' + Math.round(r.value) + ' vs ≤80% AMI ' + le80);
  const union = S.chfaQualifiedRenters(d, lim, denver, [30, 60]);
  assert(union.value >= r.value, 'adding a tier never shrinks the pool');
});

test('the file names CHFA\'s rules and its sources', () => {
  const m = read('data/market/chfa_renter_demand_co.json').meta;
  assert(/Appendix A/.test(m.rules_source));
  ['chas', 'pums', 'tract_puma', 'limits_for_pums'].forEach((k) => assert(m.sources[k] && m.sources[k].url, k + ' url'));
});

if (failures) { console.log('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nAll checks passed ✅');
