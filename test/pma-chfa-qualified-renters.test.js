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

test('a larger unit does not stand in for a missing smaller one', () => {
  // 1p, 2p and 3p households at 45%, all above every floor here.
  const m = [bins(), bins(), bins(), bins(), bins(), bins()];
  m[0][45] = 100; m[1][45] = 100; m[2][45] = 100;
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 300, 0, 0, 0] } };
  const lim = JSON.parse(JSON.stringify(limits));
  lim['08001'].regular_tiers['50'].income_limits = lim50;
  const at = (br) => Math.round(S.chfaQualifiedRenters(d, lim, tracts, [60], br).value);
  assert.strictEqual(at(['2br', '3br']), 200, 'no 1BR: one-person households leave, 2p and 3p stay');
  assert.strictEqual(at(['3br']), 100, '3BR only: 3-5 people');
  assert.strictEqual(at(['1br', '2br', '3br']), 300);
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

// Bedroom demand assumptions (paul, 8 Nov 2026): two-person households split
// 28/72 between a 1BR and a 2BR, CHAS counts scaled to ACS renters, and the
// PUMS size mix matched to the area's ACS average renter household size.
test('two-person households split between a 1BR and a 2BR; the older rule puts them all in a 1BR', () => {
  // 2p at 35%: floor 1BR = 1000*12/0.4/55000*50 = 27.3% (fits), 2BR = 1500 -> 40.9% (does not).
  const m = [bins(), bins(), bins(), bins(), bins(), bins()];
  m[1][35] = 100;
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 100, 0, 0, 0] },
    two_person_split: { statewide_small_share: 0.28, pumas: {} } };
  const shared = S.chfaQualifiedRenters(d, limits, tracts, [60]);
  const smallest = S.chfaQualifiedRenters(d, limits, tracts, [60], null, { rule: 'smallest' });
  assert.strictEqual(shared.value, 28, 'only the 28% counted toward a 1BR clears the 1BR rent floor');
  assert.deepStrictEqual(shared.byBedroom, { '1br': 28, '2br': 0, '3br': 0 });
  assert.strictEqual(smallest.value, 100);
  assert.strictEqual(shared.assumptions.rule, 'shared');
  assert.strictEqual(smallest.assumptions.rule, 'smallest');
  // At 45% both floors are met: everyone counts, split 28/72 by bedroom.
  const m2 = [bins(), bins(), bins(), bins(), bins(), bins()]; m2[1][45] = 100;
  const both = S.chfaQualifiedRenters(Object.assign({}, d, { pumas: { P1: m2 } }), limits, tracts, [60]);
  assert.strictEqual(both.value, 100);
  assert.deepStrictEqual(both.byBedroom, { '1br': 28, '2br': 72, '3br': 0 });
  // No 2BR offered: no split, the 1BR takes them all.
  assert.strictEqual(S.chfaQualifiedRenters(d, limits, tracts, [60], ['1br', '3br']).value, 100);
  // Each PUMA uses its own (blended) share from the file.
  const local = Object.assign({}, d, { pumas: { P1: m2 }, two_person_split: { statewide_small_share: 0.28, pumas: { P1: [0.5, 120, 0.71, 0.59] } } });
  const lr = S.chfaQualifiedRenters(local, limits, tracts, [60]);
  assert.deepStrictEqual(lr.byBedroom, { '1br': 50, '2br': 50, '3br': 0 });
  assert.strictEqual(lr.assumptions.twoPersonSmallShare, 0.5);
  assert.strictEqual(lr.assumptions.localWeight, 0.71);
  assert.strictEqual(lr.assumptions.localCases, 120);
});

test('CHAS tier counts are scaled to the tract\'s ACS renter households', () => {
  const acsIdx = { '08001000100': { geoid: '08001000100', renter_hh: 900 } };   // CHAS total 450
  const r = S.chfaQualifiedRenters(demand, limits, tracts, [60], null, { acsIdx: acsIdx });
  assert.strictEqual(r.value, 300, 'twice the CHAS-only 150');
  assert.deepStrictEqual(r.assumptions.renterScale, { tractsScaled: 1, tractsNotScaled: 0, chasRenters: 450, acsRenters: 900 });
  // No ACS row: the tract stays at CHAS and is reported as not scaled.
  const miss = S.chfaQualifiedRenters(demand, limits, tracts, [60], null, { acsIdx: {} });
  assert.strictEqual(miss.value, 150);
  assert.strictEqual(miss.assumptions.renterScale.tractsNotScaled, 1);
  // An ACS count of zero renters is a measured zero.
  assert.strictEqual(S.chfaQualifiedRenters(demand, limits, tracts, [60], null,
    { acsIdx: { '08001000100': { renter_hh: 0 } } }).value, 0);
});

test('the size mix is matched to the area\'s published renter household sizes (B25009)', () => {
  // Equal 1p and 3p weight at 45% (both qualify).
  const m = [bins(), bins(), bins(), bins(), bins(), bins()];
  m[0][45] = 100; m[2][45] = 100; m[0][20] = 100;   // a 1p under every floor
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 300, 0, 0, 0] } };
  const at = (sizes) => S.chfaQualifiedRenters(d, limits, tracts, [60], null, { sizeIdx: { '08001000100': sizes } });
  const big = at([100, 0, 200, 0, 0, 0]), small = at([250, 0, 50, 0, 0, 0]);
  assert(big.assumptions.sizeMatched);
  assert.deepStrictEqual(big.assumptions.areaSizeShares, [0.333, 0, 0.667, 0, 0, 0]);
  assert.strictEqual(big.assumptions.areaRenterSize, 2.33);
  assert.strictEqual(big.assumptions.sizeTracts, 1);
  assert(big.byBedroom['2br'] > small.byBedroom['2br'], 'larger households: more 2BR demand');
  assert(big.byBedroom['1br'] < small.byBedroom['1br'], 'smaller households: more 1BR demand');
  // No published sizes: the mix is used as it is.
  const none = S.chfaQualifiedRenters(d, limits, tracts, [60], null, { sizeIdx: {} });
  assert.strictEqual(none.assumptions.sizeMatched, false);
  assert.strictEqual(none.assumptions.areaSizeShares, null);
  assert.strictEqual(none.value, 300);
  assert.strictEqual(big.value, 300, 'both sizes qualify, so only the bedroom split moves');
});

test('the size fit reproduces the published shares on the CHAS-weighted renters the count uses', () => {
  // Sizes mixed within each tier, tiers weighted 90 / 10: the fitted shares
  // match the target although the raw sample is 50 / 50.
  const m = [bins(), bins(), bins(), bins(), bins(), bins()];
  m[0][40] = 100; m[2][40] = 20; m[0][55] = 20; m[2][55] = 100;
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 90, 10, 0, 0] } };
  const r = S.chfaQualifiedRenters(d, limits, tracts, [60], null, { sizeIdx: { '08001000100': [60, 0, 40, 0, 0, 0] } });
  assert(r.assumptions.sizeMatched);
  assert(r.assumptions.pumsSizeShares[0] > 0.7, 'before the fit, weighted to these tiers: ' + r.assumptions.pumsSizeShares);
  // Every household here qualifies (1p -> 1BR, 3p -> 2BR), so byBedroom shows the fitted sizes.
  const n1 = r.byBedroom['1br'], n3 = r.byBedroom['2br'];
  assert(Math.abs(n1 / (n1 + n3) - 0.6) < 0.01, 'fitted 1-person share ' + n1 / (n1 + n3));
  // The fit itself: published shares are reached.
  const fit = S.areaSizeFit([{ count: 90, sizes: [100, 0, 20, 0, 0, 0] }, { count: 10, sizes: [20, 0, 100, 0, 0, 0] }], [0.6, 0, 0.4, 0, 0, 0]);
  assert(Math.abs(fit.fitted[0] - 0.6) < 1e-4 && Math.abs(fit.fitted[2] - 0.4) < 1e-4);
});

test('a tract the count skips (no usable limits) is left out of the size match too (Codex #2747)', () => {
  const m1 = [bins(), bins(), bins(), bins(), bins(), bins()]; m1[0][45] = 100; m1[2][45] = 100;
  const m2 = [bins(), bins(), bins(), bins(), bins(), bins()]; m2[0][45] = 100;
  const d = { pumas: { P1: m1, P2: m2 }, tracts: { '08001000100': ['P1', 0, 100, 0, 0, 0], '08099000100': ['P2', 0, 100, 0, 0, 0] } };
  const two = [{ geoid: '08001000100', _bufferShare: 1 }, { geoid: '08099000100', _bufferShare: 1 }];
  // The skipped tract is all 1-person; it must not pull the target.
  const sizeIdx = { '08001000100': [60, 0, 40, 0, 0, 0], '08099000100': [100, 0, 0, 0, 0, 0] };
  const r = S.chfaQualifiedRenters(d, limits, two, [60], null, { sizeIdx: sizeIdx });   // county 08099 has no limits
  assert.strictEqual(r.tractsMissing, 1);
  assert.strictEqual(r.assumptions.sizeTracts, 1);
  const n1 = r.byBedroom['1br'], n3 = r.byBedroom['2br'];
  assert(Math.abs(n1 / (n1 + n3) - 0.6) < 0.01, 'fitted 1-person share ' + n1 / (n1 + n3));
});

test('households in which everyone attends college are left out of those who qualify', () => {
  const m = [bins(), bins(), bins(), bins(), bins(), bins()]; m[0][45] = 100;
  const sh = [[0, 0.3, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 100, 0, 0, 0] }, student_share: { pumas: { P1: sh } } };
  const r = S.chfaQualifiedRenters(d, limits, tracts, [60]);
  assert.strictEqual(r.value, 70, '30% of the 31-50% tier is all-student');
  assert.strictEqual(r.assumptions.studentsRemoved, 30);
  const without = S.chfaQualifiedRenters({ pumas: d.pumas, tracts: d.tracts }, limits, tracts, [60]);
  assert.strictEqual(without.value, 100);
  assert.strictEqual(without.assumptions.studentsRemoved, null, 'no student data: nothing removed, and none claimed');
});

test('a cell where every household is all-student is removed entirely (Codex #2751)', () => {
  const m = [bins(), bins(), bins(), bins(), bins(), bins()]; m[0][45] = 100;
  const sh = [[0, 1, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 100, 0, 0, 0] }, student_share: { pumas: { P1: sh } } };
  const r = S.chfaQualifiedRenters(d, limits, tracts, [60]);
  assert.strictEqual(r.value, 0);
  assert.strictEqual(r.assumptions.studentsRemoved, 100);
});

test('the student share is picked by the bin\'s own PUMA income tier, not the county-adjusted one (Codex #2751)', () => {
  // A 1-person bin at 45% of the PUMA limit; the county limit is lower, so it
  // lands in the county's 50-80% tier. Its student share is the PUMA's 30-50% cell.
  const m = [bins(), bins(), bins(), bins(), bins(), bins()]; m[0][45] = 100;
  const sh = [[0, 0.4, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 0, 100, 0, 0] }, student_share: { pumas: { P1: sh } },
    puma_lim50_2024: { P1: [60000, 60000, 60000, 60000, 60000, 60000] }, county_lim50_2024: { '08001': [50000, 50000, 50000, 50000, 50000, 50000] } };
  const r = S.chfaQualifiedRenters(d, limits, tracts, [60]);
  assert.strictEqual(r.assumptions.studentsRemoved, 40);
});

test('a size fit that cannot reach the published shares is not reported or used as a match (Codex #2751)', () => {
  // 1p only at 40%, 3p only at 55%, tiers 90 / 10: sizes are pinned at 90 / 10, so 50 / 50 is out of reach.
  assert.strictEqual(S.areaSizeFit([{ count: 90, sizes: [1, 0, 0, 0, 0, 0] }, { count: 10, sizes: [0, 0, 1, 0, 0, 0] }], [0.5, 0, 0.5, 0, 0, 0]), null);
  // A target that would zero out a whole tier (100% 3-person) drops those renters instead of refitting: rejected too.
  assert.strictEqual(S.areaSizeFit([{ count: 90, sizes: [1, 0, 0, 0, 0, 0] }, { count: 10, sizes: [0, 0, 1, 0, 0, 0] }], [0, 0, 1, 0, 0, 0]), null);
  const m = [bins(), bins(), bins(), bins(), bins(), bins()];
  m[0][40] = 100; m[2][55] = 100;
  const d = { pumas: { P1: m }, tracts: { '08001000100': ['P1', 0, 90, 10, 0, 0] } };
  const all3 = S.chfaQualifiedRenters(d, limits, tracts, [60], null, { sizeIdx: { '08001000100': [0, 0, 100, 0, 0, 0] } });
  assert.strictEqual(all3.assumptions.sizeMatched, false);
  assert.strictEqual(all3.value, 100);
  const r = S.chfaQualifiedRenters(d, limits, tracts, [60], null, { sizeIdx: { '08001000100': [50, 0, 50, 0, 0, 0] } });
  assert.strictEqual(r.assumptions.sizeMatched, false);
  assert.deepStrictEqual(r.assumptions.areaSizeShares, [0.5, 0, 0.5, 0, 0, 0], 'the published shares are still shown');
  assert.strictEqual(r.byBedroom['1br'], 90, 'the sample is used as it is');
});

test('the files carry the student share and tract household sizes with their sources', () => {
  const d = read('data/market/chfa_renter_demand_co.json');
  const st = d.student_share;
  assert(/SCHG/.test(st.source) && /upper bound/.test(st.definition));
  Object.keys(d.pumas).forEach((p) => {
    assert.strictEqual(st.pumas[p].length, 6, p);
    st.pumas[p].forEach((row) => row.forEach((v) => assert(v >= 0 && v <= 1)));
  });
  const z = read('data/market/acs_tract_renter_household_size_co.json');
  assert(/B25009/.test(z.meta.source));
  assert(Object.keys(z.tracts).length >= 1400);
  Object.values(z.tracts).forEach((row) => assert(row.length === 6 && row.every((v) => Number.isInteger(v) && v >= 0)));
});

test('the file carries the two-person split with its sample size and source', () => {
  const d = read('data/market/chfa_renter_demand_co.json');
  const sp = d.two_person_split;
  assert.strictEqual(sp.statewide_cases, 2439);
  assert(Math.abs(sp.statewide_small_share - 0.28) < 0.01);
  assert.deepStrictEqual(sp.ami_range, [20, 60]);
  assert(/PUMS/.test(sp.source) && /BDSP/.test(sp.source));
  Object.keys(d.pumas).forEach((p) => {
    const row = sp.pumas[p];
    assert(row, p + ' has a split');
    // share used = local weight x own share + the rest statewide; weight = n / (n + prior)
    assert(Math.abs(row[2] - row[1] / (row[1] + sp.prior_cases)) < 0.006, p + ' weight follows its sample size');
    assert(Math.abs(row[0] - (row[2] * row[3] + (1 - row[2]) * sp.statewide_small_share)) < 0.006, p + ' blended share');
  });
  assert.strictEqual(d.size_values.length, 6);
});

test('the disclosed two-person split is weighted by two-person renters, not all renters (Codex #2747)', () => {
  const twoOnly = [bins(), bins(), bins(), bins(), bins(), bins()]; twoOnly[1][45] = 100;
  const oneOnly = [bins(), bins(), bins(), bins(), bins(), bins()]; oneOnly[0][45] = 100;
  const d = { pumas: { PA: twoOnly, PB: oneOnly },
    tracts: { '08001000100': ['PA', 0, 100, 0, 0, 0], '08001000200': ['PB', 0, 100, 0, 0, 0] },
    two_person_split: { statewide_small_share: 0.28, pumas: { PA: [0.2, 100, 0.67, 0.2], PB: [0.8, 100, 0.67, 0.8] } } };
  const two = [{ geoid: '08001000100', _bufferShare: 1 }, { geoid: '08001000200', _bufferShare: 1 }];
  const r = S.chfaQualifiedRenters(d, limits, two, [60]);
  assert.deepStrictEqual(r.byBedroom, { '1br': 120, '2br': 80, '3br': 0 });
  assert.strictEqual(r.assumptions.twoPersonSmallShare, 0.2, 'the share shown is the one applied');
});

test('the bedroom fit shown follows the offered sizes (Codex #2747)', () => {
  const all = S.chfaQualifiedRenters(demand, limits, tracts, [60]).assumptions.fit;
  assert.deepStrictEqual(all, [['1br'], ['1br', '2br'], ['2br'], ['3br'], ['3br'], null]);
  const only3 = S.chfaQualifiedRenters(demand, limits, tracts, [60], ['3br']).assumptions.fit;
  assert.deepStrictEqual(only3, [null, null, ['3br'], ['3br'], ['3br'], null], '3 people go to a 3BR when it is the only size');
  const old = S.chfaQualifiedRenters(demand, limits, tracts, [60], null, { rule: 'smallest' }).assumptions.fit;
  assert.deepStrictEqual(old[1], ['1br']);
});

if (failures) { console.log('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nAll checks passed ✅');
