#!/usr/bin/env node
/**
 * The prediction-market panel must not publish markets that have already
 * settled, and the page must not reference markets that are not published.
 *
 * ── What was wrong ──
 *
 * The fetch workflow held a hardcoded list of 15 event slugs and re-fetched
 * exactly those, forever. By 2026-09-18 NINE had resolved — including all
 * three housing markets, which asked about April 30 and were being shown in
 * mid-September on a housing site. Several slugs had a month in the name:
 * fed-decision-in-april, march-inflation-us-annual-higher-brackets.
 *
 * The cached payload carried only title, slug and prices, so the site had no
 * way to know a market had closed and inferred it from price extremes alone.
 *
 * ── What this file used to assert ──
 *
 *     assert(wiredResolvedMarkets.length > 0,
 *       'cached data includes at least one wired settled Polymarket market')
 *
 * It REQUIRED a settled market to be present. The intent was to prove the
 * "Settled" render path had something to render, but the effect was a guard
 * that enforced the defect: publishing only live markets would have failed
 * it. Render-path behaviour is checked against fixtures below instead, which
 * is where a rendering test belongs.
 *
 * ── What it asserts now ──
 *
 * That the published cache is current, that it carries the metadata needed to
 * know that, and that the page and the data file name the same markets.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

function isResolved(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return false;
  const nums = prices.map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length < 2) return false;
  return Math.max(...nums) >= 0.999 && Math.min(...nums) <= 0.001;
}

const data = readJson('data/polymarket-data.json');
const dashboard = read('economic-dashboard.html');
const workflow = read('.github/workflows/fetch-polymarket-data.yml');
const events = data.events || {};
const slugs = Object.keys(events);

/* ── the render path can still label a settled market ───────────────────── */

assert(dashboard.includes('function pmIsResolved'), 'economic dashboard defines pmIsResolved helper');
assert(/max\s*>=\s*0\.999/.test(dashboard), 'resolved helper checks the high price extreme');
assert(/min\s*<=\s*0\.001/.test(dashboard), 'resolved helper checks the low price extreme');
assert(dashboard.includes('Settled'), 'Polymarket render path can emit Settled labels');
assert(dashboard.includes('pm-settled'), 'Polymarket render path adds a settled visual state');
assert(dashboard.includes('pmIsResolved(prices)'), 'parsed markets carry the resolved check before rendering probabilities');
assert(dashboard.includes('pmEventIsResolved'), 'whole-card render paths distinguish fully settled events');
assert(!dashboard.includes('Live prediction market prices from'), 'panel intro no longer over-claims every market is live');

// Behaviour, against fixtures rather than against whatever production happens
// to contain. This is what the old data-dependent assertion was really for.
assert(isResolved(['0', '1']), '0/1 outcome prices are treated as settled');
assert(isResolved(['1', '0']), '1/0 outcome prices are treated as settled');
assert(!isResolved(['0.125', '0.875']), 'fractional outcome prices remain live');
assert(!isResolved(['0.5']), 'a single price is not a settled market');
assert(!isResolved(null), 'missing prices are not a settled market');

/* ── the cache is current ───────────────────────────────────────────────── */

assert(slugs.length > 0, 'the cached payload has no events at all');

const now = new Date();
const stale = [];
for (const slug of slugs) {
  const e = events[slug];
  // `closed` is the signal. `active` is NOT: every one of the nine settled
  // events in #1738 reported active:true alongside closed:true, so a liveness
  // check built on `active` would have kept all of them.
  if (e.closed === true) { stale.push(`${slug} (closed)`); continue; }
  if (e.endDate) {
    const end = new Date(e.endDate);
    if (!Number.isNaN(end.getTime()) && end < now) stale.push(`${slug} (ended ${e.endDate.slice(0, 10)})`);
  }
}
assert.deepEqual(stale, [],
  `the published cache contains settled or expired markets: ${stale.join(', ')}`);

for (const slug of slugs) {
  assert('endDate' in events[slug],
    `${slug} has no endDate — without it nothing can tell a live market from a resolved one`);
  assert('closed' in events[slug],
    `${slug} has no closed flag`);
}

/* ── the page and the data name the same markets ────────────────────────── */

// Three places used to hold this list independently: the workflow, this test
// and the page. Dropping a settled market from the data left the page asking
// for it and rendering "Loading…" forever.
const pageSlugs = [...new Set(
  (dashboard.match(/polymarket\.com\/event\/([a-z0-9-]+)/g) || [])
    .map((m) => m.replace(/.*\/event\//, '')),
)];
const requested = [...new Set(
  (dashboard.match(/getEvent\('([^']+)'\)/g) || [])
    .map((m) => m.replace(/getEvent\('/, '').replace(/'\)/, '')),
)];

const missingFromData = pageSlugs.filter((s) => !slugs.includes(s));
assert.deepEqual(missingFromData, [],
  `the page links markets that are not in the cache: ${missingFromData.join(', ')}`);

const requestedButAbsent = requested.filter((s) => !slugs.includes(s));
assert.deepEqual(requestedButAbsent, [],
  `the page calls getEvent() for markets that are not in the cache, which renders "Loading…" forever: ${requestedButAbsent.join(', ')}`);

const unusedInPage = slugs.filter((s) => !pageSlugs.includes(s) && !requested.includes(s));
assert.deepEqual(unusedInPage, [],
  `these markets are fetched every day and shown nowhere: ${unusedInPage.join(', ')}`);

/* ── this is a housing site ─────────────────────────────────────────────── */

// Word-boundaried. A bare /rent/ matches "Brentford FC" and "different",
// which is how a football fixture nearly qualified as a housing market while
// this was being written.
const HOUSING = /\b(home value|home prices?|housing|mortgage rate|rents?)\b/i;
const housing = slugs.filter((s) => HOUSING.test(String(events[s].title || '')));
assert(housing.length > 0,
  'no housing-related market is published, on a housing site — the curated list in '
  + '.github/workflows/fetch-polymarket-data.yml needs a successor market');

/* ── the workflow cannot go back to publishing settled markets ──────────── */

// Definition AND call site. A bare /is_settled/ passes against
// `def is_settled_DISABLED(...)`, which is how this assertion first failed
// its own sabotage test: the substring survived the function being disabled.
assert(/def is_settled\(event\):/.test(workflow),
  'the fetch workflow no longer defines is_settled()');
assert(/settled,\s*why\s*=\s*is_settled\(event\)/.test(workflow),
  'the fetch workflow defines is_settled() but never calls it on a fetched event');
assert(/if settled:/.test(workflow),
  'the fetch workflow calls is_settled() but does not act on the result');
assert(/"endDate": event\.get\("endDate"\)/.test(workflow),
  'the fetch workflow no longer persists endDate');
assert(!/\bactive\b\s*is\s*True/.test(workflow),
  'the workflow appears to treat `active` as a liveness signal; `closed` is the signal');

console.log(`polymarket-resolved: PASS (${slugs.length} live events, ${housing.length} housing, 0 settled)`);
