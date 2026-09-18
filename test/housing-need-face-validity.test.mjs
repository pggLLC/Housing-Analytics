#!/usr/bin/env node
/**
 * Would a housing professional look at this row and stop trusting the site?
 *
 * Every other guard in this repo asks whether a number is internally
 * consistent. This one asks whether it is CREDIBLE, because those are not the
 * same question and only the second one decides whether anyone uses the tool.
 *
 * The case that prompted it: Snowmass Village ranks 358 of 546 on housing
 * need. Median home value $2.5M, a house costs 24.4 years of median income,
 * and the site's own workforce-housing score for it is 83.9 with two
 * components maxed at 100. Nobody who works in Colorado affordable housing
 * reads "Snowmass, below-average need" and checks the weights. They close the
 * tab. A composite that contradicts its own inputs that badly is a
 * credibility failure whether or not the arithmetic is right.
 *
 * ── The rule ──
 *
 * A place whose prices are extreme relative to local incomes, and which the
 * workforce-housing layer already flags as under pressure, may not rank in the
 * bottom half of housing need.
 *
 * The thresholds are stable from 12x/70 to 20x/80 — asserted below, including
 * where the stability ENDS. Below 12x the set grows to include Granby (10.8x)
 * and Red Cliff (11.6x), which are not extreme markets, so 12x is where
 * "expensive" stops being a judgement call. Recording the boundary matters as
 * much as recording the rule: a threshold with no stated range of validity is
 * a number someone picked.
 *
 * ── Why this file is red-by-design, and why it still passes ──
 *
 * Three places fail the rule today. They are listed, by name, with their
 * numbers. That ledger is NOT an exemption list:
 *
 *   - a fourth place failing breaks the build,
 *   - a listed place getting worse breaks the build,
 *   - a listed place being FIXED also breaks the build, with instructions to
 *     delete its entry.
 *
 * That last one is what stops it rotting into a suppression file. The
 * alternative — landing this permanently red — trains everyone to merge past a
 * red check, which this repo has already done once with a flaky axe gate.
 *
 * Fixing the score is a methodology decision with consequences for all 546
 * rankings and is deliberately not attempted here. This file only makes the
 * defect impossible to lose track of.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIGEST_DIR = path.join(ROOT, 'data/hna/jurisdiction-metrics-digest');

/** Prices this far above local income are not a normal market. */
const PRICE_TO_INCOME = 12;
/** The workforce layer's own reading that the local workforce cannot house itself. */
const WORKFORCE_PRESSURE = 70;

/**
 * Places that fail the rule right now. Each entry is a DEFECT ON RECORD, not
 * permission. Remove an entry when the place stops failing — the test tells
 * you to.
 */
const KNOWN_FAILURES = {
  // Updated 2026-09-17 after #1724 (absence in cost burden stops being a
  // measured zero). That fix removed 115 fabricated 0% figures from the
  // percentile pool, which moved these two WORSE without their own numbers
  // changing at all: Keystone's cost burden is still 28.5%, but 28.5% no
  // longer scores above 115 fake zeros, so its cost-burden pressure fell
  // 43.8 -> 25.4 and its rank 278 -> 329.
  //
  // That is the pool getting honest, not a regression. It also makes the
  // finding worse: Keystone now sits at 329 while carrying the highest
  // workforce-housing pressure in the state.
  //
  // Nathrop came OFF this ledger in the same build. Its 0% was one of the
  // fabricated ones; nulling it raised its cost-burden pressure 33.4 -> 39
  // and its rank 282 -> 270, out of the bottom half. The test required its
  // removal rather than letting a stale entry sit here.
  // Both ranks moved WORSE in this build, and the cause is measured rather
  // than guessed: the 20-year figure now comes from places.json, the same
  // number the page shows. Snowmass's is -1 and Keystone's is small, so both
  // lost future-pressure percentile against places with real growth. The
  // projection is more accurate and these two rows got worse — recording that
  // is the point of this ledger, not a reason to leave the figure wrong.
  //
  // The underlying defect is fixed separately by the workforce gap, which
  // reads demand from local jobs instead of resident households and takes
  // Snowmass to 197 and Keystone to 311.
  '0840550': { name: 'Keystone (CDP)', rank: 339,
    why: 'workforce pressure 90.4 — the highest in the state, above Aspen — with a gap score of 12.3' },
  '0871755': { name: 'Snowmass Village (town)', rank: 363,
    why: 'gap score 10.1 against a $2.5M median home value; 2,833 in-commuters into a town of 2,972' },
};

/** Ranks worse than this are the bottom half of the 546 ranked geographies. */
const BOTTOM_HALF = 273;

const read = (f) => JSON.parse(fs.readFileSync(path.join(DIGEST_DIR, f), 'utf8'));
const value = (m, k) => (m[k] || {}).value;

const places = fs.readdirSync(DIGEST_DIR).filter((f) => f.endsWith('.json'))
  .map(read).filter((d) => d.geography.type !== 'county')
  .map((d) => ({
    geoid: d.geography.geoid,
    name: d.geography.name,
    priceToIncome: value(d.metrics, 'home_value_to_income'),
    workforce: value(d.metrics, 'workforce_housing_pressure_score'),
    need: value(d.metrics, 'overall_need_score'),
    rank: value(d.metrics, 'rank'),
    gap: value(d.metrics, 'gap_pressure_score'),
  }));

function failing(priceThreshold = PRICE_TO_INCOME, workforceThreshold = WORKFORCE_PRESSURE) {
  return places.filter((p) => (p.priceToIncome || 0) >= priceThreshold
    && (p.workforce || 0) >= workforceThreshold
    && (p.rank || 0) > BOTTOM_HALF);
}

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('housing-need-face-validity');

/* ── The scan has to be able to see anything at all ──────────────────────── */

test('the inputs the rule depends on are present and populated', () => {
  // Without this, every assertion below passes by finding nothing — which is
  // how a check ends up green about an empty set.
  assert.ok(places.length >= 450, `only ${places.length} places read`);
  // Measured floors, not guessed ones: 482 places, of which 385 (80%) carry a
  // price-to-income ratio and all 482 carry the rest. A floor set above the
  // real coverage fails for the wrong reason and teaches people to raise it.
  for (const [field, min] of [['priceToIncome', 350], ['workforce', 450], ['rank', 450]]) {
    const populated = places.filter((p) => typeof p[field] === 'number').length;
    assert.ok(populated >= min,
      `only ${populated} of ${places.length} places carry ${field}; the rule cannot see the state`);
  }
  const expensive = places.filter((p) => (p.priceToIncome || 0) >= PRICE_TO_INCOME);
  assert.ok(expensive.length >= 5,
    `only ${expensive.length} places clear ${PRICE_TO_INCOME}x price-to-income; the rule has nothing to judge`);
});

/* ── The thresholds are a signal, not a choice ───────────────────────────── */

test('the failing set is stable across the range the rule claims', () => {
  // A rule that only works at one setting is a rule reverse-engineered from
  // its answer. This one holds from 12x/70 to 20x/80.
  const RANGE = [[12, 70], [12, 75], [15, 75], [18, 78], [20, 80]];
  const sets = RANGE.map(([p, w]) => failing(p, w).map((x) => x.geoid).sort().join(','));
  const distinct = [...new Set(sets)];
  assert.strictEqual(distinct.length, 1,
    'the failing set moves within the range the rule claims to be stable over:\n    '
    + sets.map((s, i) => `${JSON.stringify(RANGE[i])} -> ${s || '(none)'}`).join('\n    '));
});

test('and the rule stops being stable where it says it does', () => {
  // The boundary, recorded rather than implied. Below 12x the set picks up
  // places whose prices are high but not extreme, which is the point at which
  // "expensive" stops being a fact and starts being an opinion. If this ever
  // passes silently, the honest range has moved and the docstring is stale.
  const at12 = failing(12, 70).map((p) => p.geoid).sort().join(',');
  const at10 = failing(10, 70).map((p) => p.geoid).sort().join(',');
  assert.notStrictEqual(at10, at12,
    'the set no longer grows below 12x. That is good news about the data, but the '
    + 'stated range in this file is now wrong — re-derive it and update the docstring');
});

/* ── The rule itself ─────────────────────────────────────────────────────── */

test('no NEW place ranks in the bottom half while its own inputs say extreme', () => {
  const unexpected = failing().filter((p) => !KNOWN_FAILURES[p.geoid]);
  assert.deepStrictEqual(unexpected.map((p) => `${p.name} (rank ${p.rank}, ${p.priceToIncome}x, workforce ${p.workforce})`), [],
    'a housing professional would read these rows and stop trusting the site. Either the '
    + 'scoring changed for the worse, or a new place has hit the same defect');
});

test('every place on the ledger still fails — entries cannot go stale', () => {
  // The half that stops this becoming a suppression list. If a place is fixed,
  // its entry has to go, or the ledger slowly stops describing reality.
  const stillFailing = new Set(failing().map((p) => p.geoid));
  const fixed = Object.entries(KNOWN_FAILURES)
    .filter(([geoid]) => !stillFailing.has(geoid))
    .map(([geoid, e]) => `${e.name} (${geoid})`);
  assert.deepStrictEqual(fixed, [],
    `good news — these no longer fail the rule. Delete their entries from `
    + `KNOWN_FAILURES so the ledger keeps meaning something: ${fixed.join(', ')}`);
});

test('no place on the ledger has got worse', () => {
  const worse = [];
  for (const [geoid, entry] of Object.entries(KNOWN_FAILURES)) {
    const place = places.find((p) => p.geoid === geoid);
    if (!place) { worse.push(`${entry.name} has left the dataset`); continue; }
    if ((place.rank || 0) > entry.rank) {
      worse.push(`${entry.name}: rank ${entry.rank} -> ${place.rank}`);
    }
  }
  assert.deepStrictEqual(worse, [],
    `these were already wrong and are now more wrong: ${worse.join('; ')}`);
});

test('the ledger stays short', () => {
  // Three is a defect. Ten would be a methodology that has stopped working,
  // and a list long enough to stop reading.
  assert.ok(Object.keys(KNOWN_FAILURES).length <= 5,
    `${Object.keys(KNOWN_FAILURES).length} places on the ledger — this is no longer a list of `
    + 'exceptions, it is the normal output of the scoring');
});

test('each ledger entry says what is wrong with it', () => {
  for (const [geoid, entry] of Object.entries(KNOWN_FAILURES)) {
    assert.ok(entry.name && entry.why && entry.why.length > 25,
      `${geoid} is on the ledger with no explanation; an unexplained entry is an exemption`);
    assert.ok(typeof entry.rank === 'number', `${geoid} records no rank to compare against`);
  }
});

/* ── What the defect actually is, pinned so the fix is checkable ─────────── */

test('the gap component is what sinks them', () => {
  // The diagnosis, asserted rather than left in a comment: every expensive
  // place that scores CORRECTLY has a high gap score, and all three failures
  // have a low one. If a fix lands, this is the assertion that should change.
  const expensive = places.filter((p) => (p.priceToIncome || 0) >= PRICE_TO_INCOME
    && typeof p.gap === 'number');
  const bad = expensive.filter((p) => KNOWN_FAILURES[p.geoid]);
  const good = expensive.filter((p) => !KNOWN_FAILURES[p.geoid] && (p.rank || 999) <= BOTTOM_HALF);
  assert.ok(bad.length >= 2 && good.length >= 4, 'not enough of either group to compare');
  const worstGood = Math.min(...good.map((p) => p.gap));
  const bestBad = Math.max(...bad.map((p) => p.gap));
  assert.ok(bestBad < worstGood || bad.every((p) => p.gap < 45),
    `the gap score no longer separates the credible rows from the incredible ones `
    + `(failures up to ${bestBad}, correct rows down to ${worstGood}). The diagnosis in `
    + 'this file is out of date — re-derive it before trusting the rest');
});

console.log(failures === 0
  ? '  housing-need-face-validity: PASS'
  : `  housing-need-face-validity: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
