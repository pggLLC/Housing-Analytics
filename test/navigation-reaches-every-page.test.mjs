#!/usr/bin/env node
/**
 * A page nobody can navigate to is a page nobody reads.
 *
 * ── What was wrong ──
 *
 * 27 of 63 top-level pages were absent from js/navigation.js. Most of those
 * are fine — they are reached from a sensible parent, and a nav listing every
 * page is a nav nobody scans. Four were not fine:
 *
 *   recommendation.html   STEP 7 of the seven-step guided path, reachable
 *                         only from the deal calculator and the comparative
 *                         analysis page
 *   working-paper.html    the research write-up, reachable only from
 *   methods.html          insights.html
 *   sitemap.html          linked from NOTHING — a sitemap nobody can find
 *
 * Two others looked orphaned and are not: colorado-market.html and
 * indibuild-pipeline-public.html are redirect stubs (1006 and 394 bytes)
 * pointing at colorado-deep-dive.html and pipeline.html, both of which exist.
 * Adding a redirect to the nav would have been the wrong fix, which is why
 * this guard checks reachability rather than nav membership.
 *
 * ── What this holds ──
 *
 * Every top-level page is reachable: in the nav, linked from another page, or
 * explicitly listed below as deliberately unlisted. The third list is the
 * honest part — a guard with no exemptions gets its exemptions added silently.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nav = fs.readFileSync(path.join(ROOT, 'js/navigation.js'), 'utf8');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const sources = pages.map((p) => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]);
const jsDir = path.join(ROOT, 'js');
const jsBlob = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');

/** Pages that are deliberately not linked from anywhere. Each needs a reason. */
const UNLINKED_BY_DESIGN = {
  'og-card.html': 'social preview card rendered by crawlers, never navigated to',
  '404.html': 'served by GitHub Pages for any missing URL; reached by a broken link or typo, never by navigation',
  'colorado-market.html':
    'redirect stub (1006 bytes) to colorado-deep-dive.html; exists to catch old '
    + 'inbound links and bookmarks, so being unlinked is the point',
  'indibuild-pipeline-public.html':
    'redirect stub (394 bytes) to pipeline.html, which returns 200 in production; '
    + 'same reason — it catches old links rather than being navigated to',
};

test('the scan sees the whole site', () => {
  assert.ok(pages.length > 50, `only ${pages.length} top-level pages found`);
  assert.ok(nav.length > 1000, 'navigation.js looks empty');
});

test('the seven-step guided path is fully navigable', () => {
  // Step 7 was missing. A path whose last step cannot be reached from the nav
  // is a path that ends in a shrug.
  const steps = [
    'select-jurisdiction.html', 'lihtc-opportunity-finder.html',
    'hna-what-housing-exists.html', 'market-analysis.html',
    'hna-scenario-builder.html', 'deal-calculator.html', 'recommendation.html',
  ];
  const absent = steps.filter((s) => !nav.includes(s));
  assert.deepEqual(absent, [],
    `guided-path steps missing from the navigation: ${absent.join(', ')}`);
});

test('the research write-up is reachable from the navigation', () => {
  for (const p of ['working-paper.html', 'methods.html']) {
    assert.ok(nav.includes(p),
      `${p} is not in the navigation; it was reachable only from insights.html`);
  }
});

test('every page is reachable from somewhere', () => {
  const unreachable = [];
  for (const p of pages) {
    if (UNLINKED_BY_DESIGN[p]) continue;
    if (nav.includes(p)) continue;
    const linked = sources.some(([name, src]) => name !== p && src.includes(p));
    if (linked) continue;
    if (jsBlob.includes(p)) continue;
    unreachable.push(p);
  }
  assert.deepEqual(unreachable, [],
    `these pages are in the nav of nothing and linked from nothing: ${unreachable.join(', ')}`);
});

test('every deliberate exemption says why', () => {
  for (const [page, reason] of Object.entries(UNLINKED_BY_DESIGN)) {
    assert.ok(fs.existsSync(path.join(ROOT, page)),
      `${page} is exempted but no longer exists; drop the entry`);
    assert.ok(reason && reason.length > 20,
      `${page} is exempted with no real reason, which is how an exemption list becomes a dumping ground`);
  }
});
