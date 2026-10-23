// test/pma-chfa-qualified-renters.test.js
//
// The capture-rate denominator follows CHFA's Market Study Guide (QAP
// Appendix A, section 7): renter households whose income is at or under the
// unit's AMI limit, high enough that the maximum tax-credit rent is no more
// than 40% of income, and whose size fits a 1-3 bedroom unit. CHFA's one
// line is 85%, from its 2027-28 draft QAP (the 2025-26 QAP sets no number).
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

test('household sizes no offered bedroom size fits are left out (CHFA guide)', () => {
  // 2BR/3BR only: the 1-person household drops out, 3p@45 stays: 300 * 100/400.
  assert.strictEqual(Math.round(S.chfaQualifiedRenters(demand, limits, tracts, [60], ['2br', '3br']).value), 75);
  // 1BR only: the 3-person household drops out, 1p@40 stays.
  assert.strictEqual(Math.round(S.chfaQualifiedRenters(demand, limits, tracts, [60], ['1br']).value), 75);
  // Default is 1-3BR, the same as passing them.
  const d = S.chfaQualifiedRenters(demand, limits, tracts, [60]);
  assert.deepStrictEqual(d.bedrooms, ['1br', '2br', '3br']);
  assert.strictEqual(d.value, S.chfaQualifiedRenters(demand, limits, tracts, [60], ['3br', '1br', '2br']).value);
  // A studio serves one person, priced at the studio rent.
  const withStudio = JSON.parse(JSON.stringify(limits));
  withStudio['08001'].regular_tiers['60'].max_rents['0br'] = 800;
  assert.strictEqual(Math.round(S.chfaQualifiedRenters(demand, withStudio, tracts, [60], ['0br']).value), 75);
  // Nothing usable offered is unavailable, never zero.
  const none = S.chfaQualifiedRenters(demand, limits, tracts, [60], ['4br']);
  assert.strictEqual(none.value, null);
  assert.strictEqual(none.source, 'unavailable');
});

test('a buffer share scales the tract', () => {
  const r = S.chfaQualifiedRenters(demand, limits, [{ geoid: '08001000100', _bufferShare: 0.5 }], [60]);
  assert.strictEqual(Math.round(r.value), 75);
});

test('a PUMA bin is moved onto the tract county\'s scale before the cut-offs', () => {
  // The PUMA's limit is 20% above this county's, so each bin is 1.2x higher
  // on the county's scale. The 51to80 tier then holds 3p@45 (54.6%) and 6+@45
  // (54.6%); 1p@70 moves to 84.6%, out of the tier. Only the 3p household
  // qualifies (floor 37.5%, limit 60%). Unscaled, the tier holds only 1p@70: 0.
  const scaled = Object.assign({}, demand, {
    tracts: { '08001000100': ['P1', 0, 0, 300, 0, 0] },
    puma_lim50_2024: { P1: [60000, 66000, 72000, 78000, 84000, 90000, 96000, 102000] },
    county_lim50_2024: { '08001': [50000, 55000, 60000, 65000, 70000, 75000, 80000, 85000] },
  });
  const r = S.chfaQualifiedRenters(scaled, limits, tracts, [60]);
  assert.strictEqual(Math.round(r.value), 150);   // 300 * 100/200
});

test('households above 120% stay in the top CHAS tier', () => {
  const top = bins(); top[121] = 100;
  const d2 = { pumas: { P1: [top, bins(), bins(), bins(), bins(), bins()] }, tracts: { '08001000100': ['P1', 0, 0, 0, 0, 50] } };
  const r = S.chfaQualifiedRenters(d2, limits, tracts, [60]);
  assert.strictEqual(r.value, 0, 'none of them qualify, and the tier is not dropped as empty');
  assert.strictEqual(r.source, 'chfa_qualified');
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

test('real data: a tract CHAS counts as zero renters is a measured zero, not missing', () => {
  const d = read('data/market/chfa_renter_demand_co.json');
  const lim = {};
  read('data/chfa-income-rent-limits-2026.json').counties.forEach((c) => { lim[c.fips] = c; });
  assert.deepStrictEqual(d.tracts['08005007113'].slice(1), [0, 0, 0, 0, 0], 'all-zero CHAS tract kept in the file');
  const r = S.chfaQualifiedRenters(d, lim, [{ geoid: '08005007113', _bufferShare: 1 }], [60]);
  assert.strictEqual(r.source, 'chfa_qualified');
  assert.strictEqual(r.value, 0);
});

test('the file names CHFA\'s rules and its sources', () => {
  const m = read('data/market/chfa_renter_demand_co.json').meta;
  assert(/Appendix A/.test(m.rules_source));
  ['chas', 'pums', 'tract_puma', 'limits_for_pums'].forEach((k) => assert(m.sources[k] && m.sources[k].url, k + ' url'));
});

if (failures) { console.log('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nAll checks passed ✅');
