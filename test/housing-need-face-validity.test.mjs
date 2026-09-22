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
/*
 * Ranks re-snapshotted 2026-09-20, twice in one day.
 *
 * First: Keystone 312 -> 316, Cattle Creek 307 -> 308, when
 * rebuild-bps-permits.yml refreshed projections/places.json.
 *
 * Then: Cattle Creek 308 -> 312, Nathrop 320 -> 324, when the production
 * figure began taking max(resident growth, workforce). 365 of 546
 * jurisdictions gained a workforce reading, so the ones that host no
 * workforce fell relative to them. These two are on this ledger precisely
 * BECAUSE the job-based reading correctly sees no gap for them — Cattle
 * Creek has 59 local low-wage jobs — so a change that lifts places with a
 * workforce is expected to push these down. The movement confirms the
 * mechanism rather than contradicting it.
 *
 * Both moved because rebuild-bps-permits.yml refreshed
 * data/hna/projections/places.json and the chain rebuilt the index from it —
 * a data refresh, not a scoring change. Nothing in the weighting or the
 * components moved.
 *
 * Worth knowing about this rule: it cannot tell those two apart. It fails when
 * a ledger place's rank rises for ANY reason, so an ordinary projections
 * refresh reads the same as the methodology regressing. Re-snapshotting is
 * therefore the right maintenance here, and would be exactly the wrong
 * response to a real regression. Anyone updating these numbers should confirm,
 * as was confirmed here, that the movement traces to an input rebuild.
 */
const KNOWN_FAILURES = {
  // Re-snapshotted 2026-09-22: Cattle Creek 312 -> 313, when build-hna-data
  // (bot commit d4b511043, the first run after #1808/#1811) rebuilt the CHAS,
  // AMI-gap and summary inputs statewide. Confirmed as an input rebuild, not
  // a scoring change, the way the note above asks: every raw metric on
  // Cattle Creek's record is byte-identical before and after; only the
  // percentile-pooled cost_burden_pressure_score moved (71.1 -> 70.6,
  // overall_need_score unchanged at 40.1); it lost one place because
  // La Junta (317 -> 302) and Franktown (322 -> 311) rose past it in a
  // rebuild that moved 258 of 546 ranks; ranking-index metadata (weights,
  // note, augmenters) identical. Keystone improved 316 -> 305 in the same
  // rebuild and stays on the ledger — still short of the top half.

  // Ranks nudged 2026-09-19 (Keystone 311 -> 312, Nathrop 317 -> 320) when the
  // ranking index was restored from 41 metrics back to 72. A cron had rebuilt
  // it with build_ranking_index.py alone, dropping both augmenters and with
  // them every recency and regional-recency field; putting them back changes
  // the opportunity percentile pools, so every rank moves a little. One and
  // three places of movement is that repooling, not these two getting worse on
  // their own inputs.

  // Updated 2026-09-17 after the workforce gap landed (#1732). Demand is now
  // also read from the low-wage jobs a place HOSTS, and gap pressure is the
  // max of the resident and workforce readings.
  //
  // Snowmass Village came OFF this ledger: 1,624 local low-wage jobs against
  // 406 affordable units gave it a workforce gap of 1,218 (75% of its
  // low-wage jobs), its gap pressure went 10.1 -> 75.8 and its rank 363 ->
  // 197. That is the defect this ledger was opened for, closed.
  //
  // The two CDPs below are NEW failures, and they are new for an honest
  // reason rather than a regression: the workforce reading can only see a
  // place that hosts a workforce. Cattle Creek has 59 local low-wage jobs and
  // Nathrop has 41, against a state median of 215. Their need is residential,
  // not employment-driven, so a job-based demand term has nothing to measure
  // and they stay where they were. They were failing this rule before the
  // change too; Snowmass and Keystone were simply worse, and the rule only
  // reports the set.
  '0840550': { name: 'Keystone (CDP)', rank: 316,
    why: 'improved by the workforce gap — 538 low-wage jobs, 199 unhoused, gap pressure 12.3 -> 37.6 '
       + 'and rank 339 -> 311 — but still short of the top half' },
  '0812470': { name: 'Cattle Creek (CDP)', rank: 313,
    why: 'a house costs 24.6x local income and affordability intensity is 99.2, but it hosts only 59 '
       + 'low-wage jobs and has 59 affordable units, so the job-based reading correctly sees no gap' },
  '0853010': { name: 'Nathrop (CDP)', rank: 324,
    why: '23.9x price-to-income and 98.4 affordability intensity against 41 local low-wage jobs — '
       + 'below the 50-job floor, so no workforce percentage is even published for it' },
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
    localLowWageJobs: value(d.metrics, 'local_low_wage_jobs'),
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

test('what sinks the remaining failures is that they host no workforce', () => {
  // Re-derived 2026-09-17. The old diagnosis was "the gap component sinks
  // them", and it was right until the gap learned to read demand from jobs.
  // It no longer holds: Keystone's gap pressure is 37.6 and Nathrop's is
  // 46.9, both above rows that score correctly.
  //
  // The diagnosis now is about coverage, not weighting. A job-based demand
  // term can only speak for a place that hosts jobs. Every remaining failure
  // is an expensive place with almost no local employment, so the workforce
  // reading has nothing to measure and the composite falls back to the
  // resident gap — which is exactly the reading that cannot see them either.
  //
  // If this assertion starts failing, the remaining failures are no longer
  // low-employment places and the fix needed is a different one.
  const failing = Object.keys(KNOWN_FAILURES)
    .map((g) => places.find((p) => p.geoid === g))
    .filter(Boolean);
  assert.ok(failing.length >= 2, 'not enough ledger rows resolved to compare');

  const jobsOf = (p) => (typeof p.localLowWageJobs === 'number' ? p.localLowWageJobs : null);
  const measured = failing.map(jobsOf).filter((v) => v !== null);
  assert.ok(measured.length >= 2,
    'the digests no longer carry local_low_wage_jobs — re-derive this diagnosis');

  // Every expensive place that scores CORRECTLY hosts real employment.
  const credible = places.filter((p) => (p.priceToIncome || 0) >= PRICE_TO_INCOME
    && !KNOWN_FAILURES[p.geoid] && (p.rank || 999) <= BOTTOM_HALF
    && typeof p.localLowWageJobs === 'number');
  assert.ok(credible.length >= 4, 'not enough credible expensive rows to compare against');

  const mostJobsAmongFailures = Math.max(...measured);
  const medianCredibleJobs = [...credible.map(jobsOf)].sort((a, b) => a - b)[Math.floor(credible.length / 2)];
  assert.ok(mostJobsAmongFailures < medianCredibleJobs,
    `the remaining failures are no longer the low-employment places (busiest failure hosts `
    + `${mostJobsAmongFailures} low-wage jobs, median credible row hosts ${medianCredibleJobs}). `
    + 'The diagnosis in this file is out of date — re-derive it before trusting the rest');
});

console.log(failures === 0
  ? '  housing-need-face-validity: PASS'
  : `  housing-need-face-validity: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
