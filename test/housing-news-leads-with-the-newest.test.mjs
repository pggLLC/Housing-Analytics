#!/usr/bin/env node
/**
 * A page called Housing News leads with the newest story.
 *
 * ── What was wrong ──
 *
 * F191 scored briefs by LIHTC relevance and ordered the page by that score.
 * On 2026-09-19 the rendered order, by age in days, was:
 *
 *     0, 1, 5, 24, 60, 3, 38, 36, 58
 *
 * A two-month-old brief sat above a three-day-old one, on a page whose title
 * is "Housing News", with nothing saying the sort was relevance rather than
 * recency. The site is also not a LIHTC newsletter — of the feeds in
 * scripts/alert_feeds.txt, only one of six is LIHTC-specific; the rest are
 * Colorado affordable housing, zoning and land use, housing policy and the
 * legislature, CHFA, and NCSHA.
 *
 * ── And it never applied on first paint anyway ──
 *
 * The initial render calls renderBriefs(list), while applyFilters() reads
 * `briefs`. F191 assigned its sorted copy to `briefs` only, so the ordering
 * it intended appeared only once the reader touched a filter — at which point
 * the list silently resequenced under them. The list is now sorted in place
 * and `briefs` points at the same array, so both paths agree.
 *
 * ── What this guard holds ──
 *
 * The ordering rule, in source, and that relevance is not the sort key. The
 * rendered order itself is verified in a browser rather than here; a static
 * test cannot run the page.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'policy-briefs.html'), 'utf8');
// executable source only: the explanation above this fix names the old
// behaviour, and a comment must not be able to satisfy these assertions.
const code = SRC
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

test('the page still renders briefs at all', () => {
  assert.ok(/renderBriefs\(/.test(code), 'renderBriefs is gone; re-derive this guard');
  assert.ok(/briefsGrid/.test(code), 'the briefs grid is gone');
});

test('there is a date-based ordering, and it sorts newest first', () => {
  assert.ok(/_briefTime/.test(code),
    'no date function; the page cannot be ordering by recency');
  // tb - ta is descending: newest first. ta - tb would bury today's news.
  assert.ok(/return\s+tb\s*-\s*ta/.test(code),
    'the date comparator is not newest-first');
});

test('LIHTC relevance is not the sort key', () => {
  // The exact line that used to order the page.
  assert.ok(!/\.sort\(function \(a, b\) \{ return b\.score - a\.score; \}\);\s*\n\s*_lihtcTop3Titles[\s\S]{0,200}briefs = scored/.test(code),
    'the page is ordered by LIHTC relevance again');
  // Relevance may still break ties and may still tag, but the primary
  // comparison has to be time.
  const cmp = code.match(/list\.sort\(function \(a, b\) \{([\s\S]*?)\}\);/);
  assert.ok(cmp, 'the list is no longer sorted in place');
  const firstReturn = (cmp[1].match(/return[^;]+;/) || [])[0] || '';
  assert.ok(/t[ab]/.test(firstReturn),
    `the first comparison is not by time: ${firstReturn.trim().slice(0, 60)}`);
});

test('the first render and the filtered render use the same order', () => {
  // The bug that hid F191's own ordering: sorting a copy into `briefs` while
  // the first paint renders `list`.
  assert.ok(/briefs = list;/.test(code),
    'briefs no longer points at the sorted list, so the first render and the '
    + 'filtered render can disagree again');
  assert.ok(!/briefs = list\.slice\(\)/.test(code),
    'briefs is a sorted COPY again; the first render will show a different order');
});

test('the LIHTC badge is a topic tag, not a ranking claim', () => {
  // This is not a LIHTC newsletter. A "priority" badge on a general Colorado
  // housing news page asserts an ordering the page no longer uses.
  assert.ok(!/>★ LIHTC priority</.test(code),
    'the badge still claims LIHTC priority on a date-ordered news page');
  assert.ok(/brief-lihtc-priority/.test(code),
    'the LIHTC tag is gone entirely; it is still useful as a topic marker');
});
