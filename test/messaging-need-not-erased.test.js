#!/usr/bin/env node
/**
 * messaging-need-not-erased — wording that must not turn "a zero on one measure"
 * or "a low blended rank" into "no housing need". From the outside
 * messaging-preservation review of 18 Nov 2026, checked on Otero County
 * (08089: 104 homes priced per 100 renters at 30% AMI, HUD CHAS 220 short),
 * Fruita (0828745) and Lake City (0842330, thin data).
 *
 * Wording only: every figure is read from the same files as before.
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
const build = (g) => Contract.build({ digest: digest(g), generatedAt: 'x' });
const card = (g, id) => build(g).conclusions.find((c) => c.id === id);

test('Otero: falling households are "fewer homes needed", never a surplus of homes', () => {
  const c = card('08089', 'production');
  assert.ok(c && c.verdict, 'Otero has no production answer');
  const text = c.verdict + ' ' + c.plain;
  assert.doesNotMatch(text, /surplus/i);
  assert.match(text, /fewer homes needed/);
  assert.match(c.plain, /not a count of spare homes/);
  assert.match(c.plain, /price-only gap of \d+ homes at or below 30% AMI/);
  assert.match(c.plain, /HUD.s affordable-and-available count/);
});

test('the blended rank is named as need and opportunity, and a low rank is not low need', () => {
  for (const g of ['08089', '0828745', '0842330']) {
    const c = card(g, 'need');
    assert.equal(c.question, 'Where does it rank on need and opportunity?');
    if (c.verdict) {
      assert.doesNotMatch(c.plain, /housing pressure/i, g);
      assert.match(c.plain, /55% need and 45% opportunity/, g);
      assert.match(c.plain, /not low need/, g);
    }
  }
});

test('a list of missing evidence is printed as lines, never "undefined"', () => {
  const src = read('hub/finder.js');
  assert.match(src, /typeof b === 'string' \? b :/);
  const lines = build('0842330').conclusions.flatMap((c) => c.blocking);
  assert.ok(lines.length, 'Lake City should have at least one unanswered question to test with');
  for (const l of lines) assert.equal(typeof l, 'string');
});

test('HNA leads put HUD\'s affordable-and-available count beside the price-only count', () => {
  const src = read('hub/hna.js');
  assert.match(src, /function hudBeside\(\)/);
  assert.match(src, /as renters at every income up to ' \+ bs\[bs\.length - 1\]\.band \+ '% AMI\.' \+ hudBeside\(\)/);
  assert.match(src, /first \? hudBeside\(\) : ''/);
  // Otero has a HUD record to quote.
  const aa = JSON.parse(read('data/hna/chas_affordable_available.json'));
  assert.equal(aa.counties['08089'].tiers['30'].homes_short, 220);
});

test('the ladder key and caption say price, not homelessness', () => {
  const src = read('hub/places.js');
  assert.doesNotMatch(src, /<i><\/i>no home<\/span>/);
  assert.match(src, /no home priced for them/);
  assert.match(src, /whoever rents them; the black tick is 100/);
});

test('Deep Dive: groups describe the comparison, zero is not zero need, a ratio of medians is not a burden', () => {
  for (const f of ['hub/deep-dive.js', 'hub/places-state.js', 'hub/ic-summary.js']) {
    assert.doesNotMatch(read(f), /funded beyond need/i, f);
  }
  const dd = read('hub/deep-dive.js');
  assert.match(dd, /Above-median awards, below-median measured gap/);
  assert.match(dd, /which is not zero need/);
  const bands = dd.match(/var RATIO_BANDS = \[[^\n]*\];/)[0];
  assert.doesNotMatch(bands, /burden/i);
  assert.doesNotMatch(dd, /Tracts in red spend/);
  assert.match(dd, /it is not the share of income any renter pays/);
});

test('rent since 2000 quotes Census\'s comparability rule', () => {
  const src = read('hub/rent-income.js');
  assert.doesNotMatch(src, /can be compared with care/);
  assert.match(src, /should not be compared directly with survey rent/);
  assert.match(src, /2024_ACSSubjectDefinitions\.pdf/);
});

test('menus and labels name the need-and-opportunity rank', () => {
  assert.doesNotMatch(read('hub/nav.js'), /ranked on housing need/);
  assert.doesNotMatch(read('hub/home.js'), /Ranked by housing need|Statewide needs ranking/);
  assert.doesNotMatch(read('404.html'), /ranked by housing need/);
  assert.doesNotMatch(read('hub/hna.js'), /'Statewide need ranking'/);
  assert.match(read('hub/finder.js'), /not that its need is lower/);
});
