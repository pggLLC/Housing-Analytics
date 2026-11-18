#!/usr/bin/env node
/**
 * messaging-need-not-erased — a zero on one measure, a low blended rank or a
 * projected fall in households must not read as "no housing need". From the
 * outside messaging-preservation review of 18 Nov 2026, checked on Otero County
 * (08089: 104 homes priced per 100 renters at 30% AMI, HUD CHAS 220 short),
 * Fruita (0828745) and Lake City (0842330, thin data).
 *
 * Per AGENTS.md "Guards: pin the agreement, not the copy", each check asserts
 * what the wording has to agree with (the digest figure, the ranking weights,
 * the quadrant method, the calculation behind a map), not the sentence itself.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const digest = (g) => JSON.parse(read('data/hna/jurisdiction-metrics-digest/' + g + '.json'));
const Contract = require('../js/workflow/recommendation-contract.js');
const card = (g, id) => Contract.build({ digest: digest(g), generatedAt: 'x' }).conclusions.find((c) => c.id === id);
const val = (g, k) => { const m = digest(g).metrics[k]; return m ? m.value : null; };
const n = (s) => Number(String(s).replace(/,/g, ''));

// The ranking's own weights, from the builder that computes overall_need_score.
const builder = read('scripts/hna/build_ranking_index.py');
const W = {
  need: Math.round(Number(builder.match(/"community_need":\s*([0-9.]+)/)[1]) * 100),
  opp: Math.round(Number(builder.match(/"opportunity":\s*([0-9.]+)/)[1]) * 100)
};
const CONTROLS = ['08089', '0828745', '0842330'];

test('a fall in households is said as fewer homes needed, with the digest figure, never a surplus of homes', () => {
  let checked = 0;
  for (const g of CONTROLS) {
    const fu = val(g, 'future_units_needed_20yr');
    const c = card(g, 'production');
    if (!c || !c.verdict || typeof fu !== 'number' || fu >= 0) continue;
    checked += 1;
    const text = c.verdict + ' ' + c.plain;
    assert.doesNotMatch(text, /surplus/i, g);
    const said = text.match(/([\d,]+) fewer homes needed/);
    assert.ok(said, g + ': the fall is not said in words: ' + text);
    assert.equal(n(said[1]), Math.abs(Math.round(fu)), g + ': the words disagree with future_units_needed_20yr');
    assert.match(c.plain, /not a count of spare homes/i, g + ': a projected fall is not a stock of spare homes');
  }
  assert.ok(checked >= 2, 'too few controls with a projected fall to mean anything (' + checked + ')');
});

test('the 30% AMI gap the recommendation quotes is the digest figure and is named as price-only', () => {
  for (const g of CONTROLS) {
    const c = card(g, 'production'), gap = val(g, 'housing_gap_units');
    if (!c || !c.verdict || typeof gap !== 'number') continue;
    const said = c.plain.match(/price-only gap of ([\d,]+) homes at or below 30% AMI/);
    assert.ok(said, g + ': the gap is not named as price-only: ' + c.plain);
    assert.equal(n(said[1]), gap, g + ': the gap disagrees with housing_gap_units');
  }
});

test('the blended rank discloses the builder\'s own weights and never reads as need alone', () => {
  for (const g of CONTROLS) {
    const c = card(g, 'need');
    assert.match(c.question, /need and opportunity/i, g);
    if (!c.verdict) continue;
    assert.doesNotMatch(c.plain, /housing pressure/i, g);
    const w = c.plain.match(/(\d+)% need and (\d+)% opportunity/);
    assert.ok(w, g + ': the weights are not disclosed: ' + c.plain);
    assert.deepEqual([+w[1], +w[2]], [W.need, W.opp], g + ': disclosed weights disagree with build_ranking_index.py');
    const rank = val(g, 'rank');
    if (rank != null) assert.match(c.plain, new RegExp('ranked ' + rank + ' of'), g + ': rank disagrees with the digest');
  }
  // Every label that states the blend states the builder's weights.
  for (const f of ['hub/hna.js', 'hub/nav.js', 'hub/home.js', 'hub/places.js']) {
    const src = read(f);
    for (const m of src.matchAll(/(\d+)% need(?:,| and) (\d+)% opportunity/g)) {
      assert.deepEqual([+m[1], +m[2]], [W.need, W.opp], f + ': ' + m[0]);
    }
    const nav = src.match(/(\d+)% need\)/g) || [];
    nav.forEach((m) => assert.equal(+m.match(/\d+/)[0], W.need, f + ': ' + m));
  }
});

test('a list of missing evidence renders the contract\'s own lines', () => {
  const lines = Contract.build({ digest: digest('0842330'), generatedAt: 'x' }).conclusions.flatMap((c) => c.blocking);
  assert.ok(lines.length, 'Lake City should have an unanswered question to test with');
  lines.forEach((l) => assert.equal(typeof l, 'string', 'the contract emits plain lines'));
  // The renderer must accept what the contract emits: a string is printed as it is.
  const src = read('hub/finder.js');
  assert.match(src, /typeof b === 'string' \? b :/, 'hub/finder.js does not print the contract\'s plain lines');
});

test('HNA leads quote HUD\'s affordable-and-available record beside the price-only count', () => {
  const src = read('hub/hna.js');
  const fn = src.match(/function hudBeside\(\) \{[\s\S]*?\n    \}/);
  assert.ok(fn, 'hudBeside is gone');
  assert.match(fn[0], /hudRecord\(\)/, 'the sentence must come from the HUD CHAS affordable-and-available record');
  assert.match(fn[0], /tiers\['30'\]/);
  const finding = src.match(/var finding = \{[\s\S]*?\n      people:/)[0];
  assert.ok((finding.match(/hudBeside\(\)/g) || []).length >= 2, 'the overview lead uses it on both the no-shortfall and shortfall branches');
  const aa = JSON.parse(read('data/hna/chas_affordable_available.json'));
  assert.ok(aa.counties['08089'].tiers['30'].homes_short > 0, 'Otero control: HUD record shows a shortfall to quote');
});

test('Deep Dive: the funding group label describes the median split the file computes, the same on every surface', () => {
  const method = JSON.parse(read('data/derived/funding-vs-need.json')).meta.quadrant_method;
  assert.match(method, /median/i, 'the quadrant method is a median split');
  const labels = ['hub/deep-dive.js', 'hub/places-state.js', 'hub/ic-summary.js'].map((f) => {
    const m = read(f).match(/'funded-above-need':\s*\[?\s*'([^']+)'/);
    assert.ok(m, f + ' has no label for funded-above-need');
    return m[1].toLowerCase();
  });
  labels.forEach((l) => {
    assert.match(l, /median/, 'label must name the median split: ' + l);
    assert.doesNotMatch(l, /beyond need|exceeds need|over-?funded/, 'a median split does not show funding exceeds need: ' + l);
  });
  assert.equal(new Set(labels).size, 1, 'surfaces disagree: ' + labels.join(' | '));
});

test('Deep Dive: a ratio of medians is never labelled as household cost burden', () => {
  const dd = read('hub/deep-dive.js');
  const geo = dd.match(/function geography\(d\) \{[\s\S]*?var chas = d\.chas/)[0];
  assert.match(geo, /t\.median_gross_rent/);
  assert.match(geo, /t\.median_hh_income/);
  const bands = dd.match(/var RATIO_BANDS = \[[^\n]*\];/)[0];
  assert.doesNotMatch(bands, /burden/i, 'bands of a median-rent / median-income ratio are not burden classes');
  const intro = dd.match(/sec\('ratio-map', '([^']+)', '<p>([^<]+)<\/p>/);
  assert.doesNotMatch(intro[1] + ' ' + intro[2], /spend .* of their income|cost-burdened/i);
});

test('the rent-against-income headline compares survey with survey; the 2000 view carries Census\'s rule', () => {
  const src = read('hub/rent-income.js');
  const lead = src.match(/cardBody\(d, x, '([^']+)', place\)/)[1];
  const series = JSON.parse(read('data/co-housing-costs/rent-income-history.json')).colorado;
  const start = series.find((r) => r.period === lead);
  assert.ok(start, 'the headline period is not in the series: ' + lead);
  assert.ok(start.rent_year >= 2005, 'the headline starts before the ACS (' + lead + '), which Census says does not compare with ACS rent');
  assert.match(src, /2024_ACSSubjectDefinitions\.pdf/, 'the 2000 caveat must cite Census\'s subject definitions');
  assert.match(src, /over\(d, x, '2000'\)/, 'the since-2000 view stays beside the headline (paul, 18 Nov 2026: keep both)');
});
