'use strict';

/**
 * historical-trends.html must show real CHFA data, and what it says about that
 * data must agree with the files it is computed from.
 *
 * Before this guard the page charted data/policy/chfa-awards-historical.json —
 * a 28-row sample "synthesized from publicly available CHFA award
 * announcements" — as "Colorado LIHTC awards per year" (1–5 a year, where the
 * live feed has 30–60), and printed QAP scores and award rates from it. It now
 * charts data/chfa-lihtc.json and shows the latest round from CHFA's parsed
 * award report. This guard pins:
 *
 *   1. the page never reads the synthesized file;
 *   2. the award chart accounts for every dated project in the feed;
 *   3. the latest-round figures equal CHFA's own press-release totals;
 *   4. the counts hard-coded in the page's HTML equal what the JS computes;
 *   5. the page's "4% deals are about twice the size" copy agrees with the
 *      medians it is describing;
 *   6. missing credits / units are excluded (null), never summed as 0;
 *   7. the "not yet in the live feed" caption flips when the feed catches up.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const JS_REL = 'js/historical-trends.js';
const HTML_REL = 'historical-trends.html';
const ROUND_REL = 'data/affordable-housing/chfa-awards/2026-round-one.json';
const FEED_REL = 'data/chfa-lihtc.json';

const dom = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1/historical-trends.html' });
dom.window.eval(read(JS_REL));
const HT = dom.window.HistoricalTrends;
assert(HT && HT._internal, 'historical-trends.js must expose HistoricalTrends._internal');
const { summarizeRound, dealStats, projects } = HT._internal;

const js = read(JS_REL);
const html = read(HTML_REL);
const feed = readJson(FEED_REL).features;
const round = readJson(ROUND_REL);

// Non-vacuity: there is real data to check.
assert(feed.length > 0, 'feed has projects');
assert(round.awards.length > 0, 'round file has awards');

// 1. Synthesized sample is not read by this page.
assert(!/chfa-awards-historical/.test(js), `${JS_REL} must not load the synthesized chfa-awards-historical.json`);
assert(!/Average score|Median score|Award rate|Family win rate/.test(js),
  'scoring tiles came from the synthesized sample and must not return without a real source');
assert(js.includes(ROUND_REL), `${JS_REL} must load ${ROUND_REL}`);

// 2. The award chart accounts for every dated project.
const rows = projects(feed);
const dated = rows.filter((r) => r.alloc != null);
assert.strictEqual(rows.length, feed.length, 'one normalised row per feed feature');
assert(dated.length >= feed.length - 5, `nearly every project has an award year (${dated.length}/${feed.length})`);
const buckets = dated.reduce((m, r) => ((m[r.bucket] = (m[r.bucket] || 0) + 1), m), {});
assert.strictEqual((buckets.nine || 0) + (buckets.four || 0) + (buckets.other || 0), dated.length, 'no project dropped by bucketing');
assert((buckets.other || 0) < dated.length * 0.02, `"Other / mixed" must stay a fold bucket, got ${buckets.other}`);

// 3. Latest round equals CHFA's press-release totals.
const r = summarizeRound(round, feed);
const meta = round.metadata;
assert.strictEqual(r.developments, meta.press_release_total_developments, 'developments == CHFA press release');
assert.strictEqual(r.units, meta.press_release_total_units, 'units == CHFA press release');

// 4. Counts hard-coded in the HTML equal what the JS computes.
const cov = html.match(/coverage: '(\d+) developments, ([\d,]+) units'/);
assert(cov, 'data-quality coverage string for the round must state developments and units');
assert.strictEqual(Number(cov[1]), r.developments, 'HTML coverage developments == computed');
assert.strictEqual(Number(cov[2].replace(/,/g, '')), r.units, 'HTML coverage units == computed');
const feedCount = html.match(/(\d+) (?:Colorado )?projects (?:through \d{4}|\(1987)/g) || [];
assert(feedCount.length > 0, 'page states the feed project count');
feedCount.forEach((s) => assert.strictEqual(Number(s.match(/\d+/)[0]), feed.length, `"${s}" == ${FEED_REL} feature count`));

// 5. "about twice the size" agrees with the medians.
const d = dealStats(feed);
assert(d.median9 > 0 && d.median4 > 0, 'both medians computed');
// Any "N times the size / as large" claim in the page must match the medians.
const MULT = { twice: 2, 'two times': 2, 'three times': 3, 'half again': 1.5 };
const ratio = d.median4 / d.median9;
const sizeClaims = [...html.matchAll(/\b(twice|two times|three times|half again|\d+(?:\.\d+)?x)\s+(?:the size|as large|as big|larger|bigger)\b/gi)];
sizeClaims.forEach((m) => {
  const w = m[1].toLowerCase();
  const claimed = MULT[w] != null ? MULT[w] : parseFloat(w);
  assert(Math.abs(ratio - claimed) / claimed <= 0.25,
    `page says 4% deals are "${m[0]}" 9% deals; the medians give ${ratio.toFixed(2)}x`);
});

// 6. Absence: missing credits/units excluded, not 0; all-missing -> null.
const partial = summarizeRound({
  metadata: { round: '2030 Round One' },
  awards: [
    { total_units: 40, federal_9pct_credit: 1600000, state_credit: 500000 },
    { total_units: null, federal_9pct_credit: null, state_credit: null },
  ],
}, []);
assert.strictEqual(partial.units, 40, 'null units excluded from the sum');
assert.strictEqual(partial.federal9Total, 1600000, 'null credit excluded from the sum');
assert.strictEqual(partial.federal9PerUnit, 40000, 'per-unit uses only records with both values');
assert.strictEqual(partial.withStateCredit, 1, 'null state credit is not "with state credit"');
const empty = summarizeRound({ metadata: {}, awards: [{ total_units: null, federal_9pct_credit: null }] }, []);
assert.strictEqual(empty.units, null, 'no units anywhere -> null, not 0');
assert.strictEqual(empty.federal9Total, null, 'no credits anywhere -> null, not $0');
assert.strictEqual(empty.federal9PerUnit, null, 'no per-unit figure -> null');
assert.strictEqual(empty.medianUnits, null, 'no median -> null');
assert.strictEqual(summarizeRound({ awards: [] }, []), null, 'no awards -> nothing rendered');

// 7. The caption flips once the feed carries the round's year.
const yr = r.roundYear;
assert(yr > 2000, 'round year parsed from metadata');
const maxFeedYear = Math.max(...dated.map((x) => x.alloc));
assert.strictEqual(r.inFeed, maxFeedYear >= yr, 'inFeed reflects the real feed');
const caughtUp = feed.concat([{ properties: { AwardYear: yr, N_UNITS: 50, CREDIT: '9% Competitive' } }]);
assert.strictEqual(summarizeRound(round, caughtUp).inFeed, true, 'a feed with the round year flips inFeed');

console.log(`historical-trends real-data guard: PASS (${feed.length} feed projects, ${r.developments} round awards, 4%/9% median ${d.median4}/${d.median9})`);
