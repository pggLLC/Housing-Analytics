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
 *   - a listed place getting worse breaks the build — measured on its own
 *     EVIDENCE, not its rank or need score, because both of those are
 *     normalized across the dataset and move when other places move; plus a
 *     wide floor under its need score (NEED_SCORE_BAND), so a scoring change
 *     that sinks it with unchanged inputs is still caught,
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
 * ── Why this ledger pins evidence, not scores or ranks ──
 *
 * It used to pin each place's RANK and fail when the rank rose. That fired
 * three times in three days (307->308, 308->312, 312->313), every one a false
 * alarm, because rank is RELATIVE: a place slides down when some OTHER place
 * improves, with nothing about it changing. Measured across d4b511043, the
 * scheduled build that last broke this file: for all three ledger places every
 * own-input metric was byte-identical and only rank moved. That commit touched
 * no scoring code. The rule was reporting other places getting BETTER as these
 * places getting worse. The same flaw ran the other way unnoticed — Keystone
 * improving 316 -> 305 rotted its pin by 11 places in silence.
 *
 * The obvious repair, pinning overall_need_score instead, was measured and
 * REJECTED. Across three consecutive scheduled data builds (1,446 place
 * comparisons, no scoring code touched):
 *
 *   workforce_housing_pressure_score   0.0% changed
 *   local_low_wage_jobs                0.0% changed
 *   gap_pressure_score                 0.0% changed
 *   home_value_to_income               1.2% changed
 *   overall_need_score                19.3% changed   <- not absolute
 *
 * Need score moved by up to 4.2 points on builds that changed no code, and of
 * the 140 places whose need score FELL, 134 had every one of their own inputs
 * byte-identical. It is normalized across the dataset, so it is a relative
 * measure too — the same category error as rank, just harder to see. No
 * tolerance rescues it: the movement runs continuously from 0.1 to 4.2 with no
 * break to cut at.
 *
 * So the pin is the place's own EVIDENCE — the numbers that come from this
 * place's own prices, incomes and jobs and cannot be disturbed by a neighbour.
 * The ledger's claim about each row is "its own evidence says extreme, yet the
 * site reads it as low need". That claim gets more wrong when the evidence
 * STRENGTHENS while the place is still under-read, and that is what is
 * asserted.
 *
 * Evidence alone cannot see the other way a ledger place gets worse: a scoring
 * change that sinks it while its inputs stay the same — the case this ledger
 * was opened for. So needWhenPinned IS asserted, but only as a wide floor:
 * the largest drift measured above is 4.2 points, and NEED_SCORE_BAND is 10,
 * more than double that, so it cannot fire on a data build and fires only
 * when the composite itself has moved against the place. rankWhenPinned is
 * context for a reader and is not asserted. Re-snapshotting either is never
 * required by drift; the band is re-based only when the ledger entry is.
 */
const KNOWN_FAILURES = {
  // History, for the record only — rank is no longer asserted and none of
  // these needed a code change: ranks moved on 2026-09-19 (the index restored
  // from 41 metrics to 72, repooling every percentile) and on 2026-09-22
  // (build-hna-data d4b511043 rebuilt CHAS/AMI-gap/summary inputs and moved
  // 258 of 546 ranks; every ledger place's own inputs were byte-identical).
  // Both are the drift the rationale above measures, not these places
  // getting worse.

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
  '0840550': { name: 'Keystone (CDP)',
    evidence: { workforce: 90.4, priceToIncome: 24.9 },
    needWhenPinned: 40.7, rankWhenPinned: 305,
    why: 'improved by the workforce gap — 538 low-wage jobs, 199 unhoused, gap pressure 12.3 -> 37.6 '
       + '— but still short of the top half' },
  '0812470': { name: 'Cattle Creek (CDP)',
    evidence: { workforce: 84.2, priceToIncome: 24.57 },
    needWhenPinned: 40.1, rankWhenPinned: 313,
    why: 'a house costs 24.57x local income and affordability intensity is 99.2, but it hosts only 59 '
       + 'low-wage jobs and has 59 affordable units, so the job-based reading correctly sees no gap' },
  '0853010': { name: 'Nathrop (CDP)',
    evidence: { workforce: 81.9, priceToIncome: 23.88 },
    needWhenPinned: 39.1, rankWhenPinned: 324,
    why: '23.88x price-to-income and 98.4 affordability intensity against 41 local low-wage jobs — '
       + 'below the 50-job floor, so no workforce percentage is even published for it' },
};

/** Ranks worse than this are the bottom half of the 546 ranked geographies. */
const BOTTOM_HALF = 273;
/**
 * How far a ledger place's need score may fall below needWhenPinned before it
 * counts as the scoring turning against it. Data-build drift measured at most
 * 4.2 points across 1,446 comparisons (see the rationale above KNOWN_FAILURES);
 * 10 is more than double that, so this fires only on a scoring change.
 */
const NEED_SCORE_BAND = 10;

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

/**
 * Why this place is more wrong than when it was pinned, or null if it is not.
 *
 * Compared on the place's own EVIDENCE of extremity, never on its need score
 * or its rank — both of those are normalized across the dataset and move when
 * other places move. See the rationale above KNOWN_FAILURES for the
 * measurements behind that choice.
 *
 * Separated from the loop so it can be exercised directly: nothing is worse
 * today, so the loop below is green whether or not this function works.
 */
function regression(place, entry) {
  if (!place) return `${entry.name} has left the dataset`;
  // A place the site now reads correctly is not "more wrong" whatever its
  // evidence did; 'entries cannot go stale' owns that case and says to delete
  // the entry. Reporting it here too would claim it is still under-read.
  if (typeof place.rank === 'number' && place.rank <= BOTTOM_HALF) return null;
  const now = { workforce: place.workforce, priceToIncome: place.priceToIncome };
  for (const [field, pinned] of Object.entries(entry.evidence)) {
    const current = now[field];
    if (typeof current !== 'number') {
      // Absence is not agreement. Evidence that stopped being published cannot
      // be compared, and must not pass quietly.
      return `${entry.name} no longer publishes ${field}, so this cannot be checked`;
    }
    if (current > pinned) {
      return `${entry.name}: ${field} ${pinned} -> ${current} while it is still read as low need`
        + ` (rank ${place.rank}) — the evidence got stronger and the site still does not see it`;
    }
  }
  if (typeof entry.needWhenPinned === 'number') {
    if (typeof place.need !== 'number') {
      return `${entry.name} no longer publishes a need score, so this cannot be checked`;
    }
    if (place.need < entry.needWhenPinned - NEED_SCORE_BAND) {
      return `${entry.name}: need score ${entry.needWhenPinned} -> ${place.need} with its own evidence unchanged`
        + ` — more than ${NEED_SCORE_BAND} points below where it was pinned, which no data build has ever`
        + ' produced; the scoring itself has moved against it';
    }
  }
  return null;
}

test('no place on the ledger has got worse', () => {
  const worse = Object.entries(KNOWN_FAILURES)
    .map(([geoid, entry]) => regression(places.find((p) => p.geoid === geoid), entry))
    .filter(Boolean);
  assert.deepStrictEqual(worse, [],
    `these were already wrong and are now more wrong: ${worse.join('; ')}`);
});

test('and that comparison would actually notice', () => {
  // The assertion above passes on an empty list, and the list is empty in
  // every healthy run, so it says nothing about whether the comparison still
  // works. Pinning stable evidence made this sharper, not safer: the old rank
  // comparison fired constantly on drift, which disguised the fact that a
  // broken comparator looks exactly like a clean one. Probe it directly.
  const pinned = { name: 'probe', evidence: { workforce: 84.2, priceToIncome: 24.57 }, needWhenPinned: 40.1 };
  const at = (workforce, priceToIncome, need = 40.1) => ({ name: 'probe', workforce, priceToIncome, need, rank: 400 });

  assert.ok(regression(at(90.0, 24.57), pinned),
    'workforce pressure rising is no longer detected — the check above would pass vacuously');
  assert.ok(regression(at(84.2, 30.0), pinned),
    'price-to-income rising is no longer detected');
  assert.ok(regression(at(undefined, 24.57), pinned),
    'evidence that stopped being published is no longer detected');
  assert.ok(regression(undefined, pinned),
    'a place leaving the dataset is no longer detected');

  assert.strictEqual(regression(at(84.2, 24.57), pinned), null,
    'unchanged evidence is reported as a regression');
  assert.strictEqual(regression(at(80.0, 20.0), pinned), null,
    'evidence WEAKENING is reported as a regression — that is the place improving');
  assert.strictEqual(regression({ ...at(84.2, 24.57), rank: 546 }, pinned), null,
    'rank is being compared again — it is relative and this file stopped using it');
  assert.strictEqual(regression(at(84.2, 24.57, 40.1 - 4.2), pinned), null,
    'need score drift inside the band is reported — the band must stay wider than any measured drift');
  assert.ok(regression(at(84.2, 24.57, 40.1 - NEED_SCORE_BAND - 0.1), pinned),
    'a need score collapsing with unchanged evidence is no longer detected — a scoring regression '
    + 'against a ledger place would ship green');
  assert.match(String(regression({ ...at(84.2, 24.57), need: null }, pinned)), /no longer publishes a need score/,
    'a need score that stopped being published is not reported as absent — null < n is true, so '
    + 'without the absence branch this would be misreported as a collapse, or worse, pass');
  assert.strictEqual(regression({ ...at(90.0, 24.57, 20), rank: 200 }, pinned), null,
    'a place the site now reads correctly is reported as more wrong — that case belongs to '
    + "'entries cannot go stale'");
});

test('the ledger stays short', () => {
  // Three is a defect. Ten would be a methodology that has stopped working,
  // and a list long enough to stop reading.
  assert.ok(Object.keys(KNOWN_FAILURES).length <= 5,
    `${Object.keys(KNOWN_FAILURES).length} places on the ledger — this is no longer a list of `
    + 'exceptions, it is the normal output of the scoring');
});

/**
 * What is malformed about a ledger entry, or null. Separated from the test so
 * it can be probed: every real entry is well-formed, so the loop below would
 * be green with any of these checks deleted.
 */
function entryProblem(geoid, entry) {
  if (!(entry.name && entry.why && entry.why.length > 25)) {
    return `${geoid} is on the ledger with no explanation; an unexplained entry is an exemption`;
  }
  if (!(entry.evidence && Object.keys(entry.evidence).length >= 2)) {
    return `${geoid} records no evidence, so there is nothing to compare it against`;
  }
  // Exactly the two fields regression() reads: a typo key would otherwise
  // fail later as "no longer publishes <typo>", pointing at the wrong place.
  const keys = Object.keys(entry.evidence).sort();
  if (keys.join(',') !== 'priceToIncome,workforce') {
    return `${geoid} pins evidence fields the comparison does not read: ${keys.join(', ')}`;
  }
  for (const [field, v] of Object.entries(entry.evidence)) {
    if (typeof v !== 'number') return `${geoid} pins a non-numeric ${field}`;
  }
  if (typeof entry.needWhenPinned !== 'number') {
    return `${geoid} records no needWhenPinned, so the need-score floor cannot be applied`;
  }
  if (typeof entry.rankWhenPinned !== 'number') return `${geoid} records a non-numeric rankWhenPinned`;
  // Prose must agree with the fields it sits beside: a quoted "Nx" is the
  // pinned price-to-income, and rank is context, never quoted as a number.
  const quotedRatio = entry.why.match(/(\d+(?:\.\d+)?)x\b/);
  if (quotedRatio && Number(quotedRatio[1]) !== entry.evidence.priceToIncome) {
    return `${geoid}'s why quotes ${quotedRatio[1]}x but pins priceToIncome ${entry.evidence.priceToIncome}`;
  }
  if (/\brank \d/.test(entry.why)) {
    return `${geoid}'s why quotes a rank; rank is relative and drifts, keep it out of the prose`;
  }
  return null;
}

test('each ledger entry says what is wrong with it', () => {
  const problems = Object.entries(KNOWN_FAILURES).map(([g, e]) => entryProblem(g, e)).filter(Boolean);
  assert.deepStrictEqual(problems, [], problems.join('; '));
});

test('and a malformed entry would actually be noticed', () => {
  const ok = { name: 'probe', evidence: { workforce: 84.2, priceToIncome: 24.57 },
    needWhenPinned: 40.1, rankWhenPinned: 313,
    why: 'a house costs 24.57x local income, and this sentence is long enough to count' };
  assert.strictEqual(entryProblem('p', ok), null, 'a well-formed entry is reported as malformed');
  const bad = (patch, expect, label) => assert.match(String(entryProblem('p', { ...ok, ...patch })), expect,
    `${label} is no longer detected`);
  bad({ why: 'short' }, /no explanation/, 'a missing explanation');
  bad({ evidence: { workforce: 84.2, priceToincome: 24.57 } }, /fields the comparison does not read/, 'a typo evidence key');
  bad({ evidence: { workforce: 84.2 } }, /records no evidence/, 'a single pinned field');
  bad({ evidence: { workforce: '84.2', priceToIncome: 24.57 } }, /non-numeric workforce/, 'a non-numeric pin');
  bad({ needWhenPinned: undefined }, /no needWhenPinned/, 'a missing needWhenPinned');
  bad({ rankWhenPinned: '313' }, /non-numeric rankWhenPinned/, 'a non-numeric rankWhenPinned');
  bad({ why: 'a house costs 24.6x local income, and this sentence is long enough to count' },
    /quotes 24.6x but pins/, 'prose disagreeing with the pinned ratio');
  bad({ why: 'improved, and rank 339 -> 311, which is long enough to count as prose' },
    /quotes a rank/, 'prose quoting a rank');
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
