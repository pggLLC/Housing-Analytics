#!/usr/bin/env node
// Review-date warnings on hand-verified policy and homebuyer-program records,
// and the daily reminder that asks a person to re-check them (#2009).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { dueReviews, FILES, markersFromIssues } from '../scripts/audit/policy-review-reminders.mjs';

const require = createRequire(import.meta.url);
const ReviewStatus = require('../js/components/review-status.js');
const read = (p) => readFileSync(p, 'utf8');
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── 1. States, at their boundaries ─────────────────────────────────────────
const T = '2026-10-10';
assert.equal(ReviewStatus.of({ review_by: '2026-10-09' }, T).state, 'overdue');
assert.equal(ReviewStatus.of({ review_by: '2026-10-10' }, T).state, 'due', 'due on the day itself, not yet overdue');
assert.equal(ReviewStatus.of({ review_by: addDays(T, ReviewStatus.DUE_SOON_DAYS) }, T).state, 'due');
assert.equal(ReviewStatus.of({ review_by: addDays(T, ReviewStatus.DUE_SOON_DAYS + 1) }, T).state, 'current');
assert.equal(ReviewStatus.of({}, T).state, 'unknown', 'a missing review date is said, not treated as current');
assert.equal(ReviewStatus.of({ review_by: 'soon' }, T).state, 'unknown');
assert.equal(ReviewStatus.html({ review_by: '2026-12-01' }, T), '', 'a current record shows no warning');
const overdue = ReviewStatus.html({ review_by: '2026-10-01', last_verified: '2026-07-18' }, T);
assert(overdue.includes('data-review-status="overdue"') && overdue.includes('October 1, 2026') && overdue.includes('July 18, 2026'),
  'the overdue warning names the review date and when it was last checked');
assert(/official source/.test(overdue));
const summary = ReviewStatus.summaryHtml([{ review_by: '2026-10-01' }, { review_by: '2026-10-12' }, { review_by: '2027-01-01' }], T, 'programs');
assert(summary.includes('1 of 3 programs') && summary.includes('October 12, 2026'), summary);
assert.equal(ReviewStatus.summaryHtml([{ review_by: '2027-01-01' }], T, 'programs'), '', 'nothing to say when all are current');

// ── 2. The data carries what the warnings read ─────────────────────────────
// Non-vacuity on the scan: both files have records, and every record has the
// two dates. A record with no review_by would show "No review date recorded".
let recordCount = 0;
for (const { file, key } of FILES) {
  const records = JSON.parse(read(file))[key];
  assert(Array.isArray(records) && records.length > 0, `${file} has no ${key}`);
  for (const r of records) {
    recordCount++;
    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.review_by || ''), `${file} ${r.id}: review_by missing or not YYYY-MM-DD`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.last_verified || ''), `${file} ${r.id}: last_verified missing or not YYYY-MM-DD`);
    assert(r.review_by > r.last_verified, `${file} ${r.id}: review_by must come after last_verified`);
  }
}

// ── 3. Every renderer shows the warning (real render, not a string match) ──
const today = ReviewStatus.todayDenver();
const past = addDays(today, -3);
const future = addDays(today, 60);
function windowWith(...files) {
  const dom = new JSDOM('<!doctype html><body><div id="t"></div></body>', { runScripts: 'outside-only' });
  dom.window.fetch = () => new Promise(() => {}); // components auto-init; keep them idle
  for (const f of files) dom.window.eval(read(f));
  return dom.window;
}

// 3a. Homebuyer program cards
{
  const w = windowWith('js/provenance-label.js', 'js/components/review-status.js', 'js/components/homeownership-programs.js');
  const doc = JSON.parse(read('data/policy/homeownership-programs.json'));
  doc.programs = doc.programs.slice(0, 3).map((p, i) => ({ ...p, review_by: i === 0 ? past : future, last_verified: addDays(today, -80) }));
  const t = w.document.getElementById('t');
  w.HomeownershipPrograms.renderPrograms(t, doc);
  assert.equal(t.querySelectorAll('[data-review-status="overdue"]').length, 1, 'homebuyer: the one overdue program is marked');
  assert.equal(t.querySelectorAll('[data-review-status]').length, 1, 'homebuyer: current programs carry no warning');
  const overdueCard = t.querySelector('[data-review-status="overdue"]').closest('[data-homeownership-program-id]');
  assert.equal(overdueCard.getAttribute('data-homeownership-program-id'), doc.programs[0].id, 'the warning sits on the right card');
  assert(t.querySelector('[data-review-summary="overdue"]').textContent.includes('1 of 3 programs'), 'homebuyer: page summary counts it');
}

// 3b. Tax-credit watchlist cards (article-pricing, CRA)
{
  const w = windowWith('js/provenance-label.js', 'js/components/review-status.js', 'js/components/tax-credit-equity-markets.js');
  const doc = JSON.parse(read('data/policy/tax-credit-legislation.json'));
  doc.entries = doc.entries.slice(0, 2).map((e, i) => ({ ...e, review_by: i === 0 ? future : past }));
  const t = w.document.getElementById('t');
  w.TaxCreditEquityMarkets.renderLegislationWatch(t, doc, {});
  assert.equal(t.querySelectorAll('[data-review-status="overdue"]').length, 1, 'watchlist: the overdue entry is marked');
  assert(t.querySelector('[data-review-summary]'), 'watchlist: summary rendered');
}

// 3c. Legislation page: the tracker carries review_by and the inline renderer uses it
{
  const Tracker = require('../js/legislative-tracker.js');
  const doc = JSON.parse(read('data/policy/tax-credit-legislation.json'));
  const bills = Tracker.setLegislationData(doc);
  assert(bills.length > 0 && bills.every((b) => b.reviewBy === doc.entries.find((e) => e.id === b.id).review_by),
    'LegislativeTracker must carry each entry\'s review_by');
  const page = read('housing-legislation-2026.html');
  assert(page.indexOf('js/components/review-status.js') > -1 &&
    page.indexOf('js/components/review-status.js') < page.indexOf('js/legislative-tracker.js'), 'legislation page loads review-status.js first');
  assert(/ReviewStatus\.html\(\{ review_by: bill\.reviewBy/.test(page) && /ReviewStatus\.summaryHtml\(/.test(page),
    'legislation page renders the per-entry warning and the summary');
}

// 3d. Every page that renders these records loads the helper before the renderer
for (const [page, renderer] of [['help-for-homebuyers.html', 'homeownership-programs.js'],
  ['article-pricing.html', 'tax-credit-equity-markets.js'], ['cra-expansion-analysis.html', 'tax-credit-equity-markets.js']]) {
  const src = read(page);
  const a = src.indexOf('js/components/review-status.js');
  const b = src.indexOf(`js/components/${renderer}`);
  assert(a > -1 && b > -1 && a < b, `${page} must load review-status.js before ${renderer}`);
}

// ── 4. Reminder issues ─────────────────────────────────────────────────────
const fixture = {
  'data/policy/homeownership-programs.json': { programs: [
    { id: 'a', name: 'A', status: 'active', last_verified: '2026-07-18', review_by: '2026-10-16', source_url: 'https://example.gov/a' },
    { id: 'b', name: 'B', status: 'active', last_verified: '2026-07-18', review_by: '2027-01-15', source_url: 'https://example.gov/b' },
  ] },
  'data/policy/tax-credit-legislation.json': { entries: [
    { id: 'c', title: 'C', status: 'enacted', last_verified: '2026-09-21', review_by: '2026-12-21' },
  ] },
};
assert.deepEqual(dueReviews(fixture, '2026-10-08'), [], 'nothing opens before the lead window');
const opened = dueReviews(fixture, '2026-10-09');
assert.equal(opened.length, 1, 'one issue for the file with a record inside the 7-day window');
assert(opened[0].body.startsWith('<!-- policy-review:data/policy/homeownership-programs.json:2026-10-16 -->'));
assert(opened[0].body.includes('**A** (`a`)') && !opened[0].body.includes('**B**'), 'lists only the records coming due');
assert(opened[0].body.includes('https://example.gov/a'), 'links the official source');
assert.deepEqual(dueReviews(fixture, '2026-10-20', markersFromIssues(opened)), [], 'never opens the same wave twice');
assert(dueReviews(fixture, '2026-10-20')[0].body.includes('1 already past review'), 'says when records are already overdue');

// Against the real files: at their earliest review date, both files come due.
const real = Object.fromEntries(FILES.map(({ file }) => [file, JSON.parse(read(file))]));
const earliest = FILES.map(({ file, key }) => real[file][key].map((r) => r.review_by).sort()[0]).sort()[0];
assert(dueReviews(real, earliest).length >= 1, `the real files produce a review issue by ${earliest}`);

console.log(`Policy review status: PASS (${recordCount} records dated; warnings render on homebuyer, watchlist and legislation cards; reminders open from ${earliest})`);
