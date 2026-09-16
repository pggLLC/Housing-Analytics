#!/usr/bin/env node
/**
 * The glossary has to reach the text a novice actually reads.
 *
 * js/glossary.js wraps the first use of each acronym in a definition tooltip.
 * It ran ONCE, 150ms after DOMContentLoaded — against the static shell. The
 * HNA renders its panels after fetching data, so measured on
 * housing-needs-assessment.html: 17 terms wrapped page-wide, and ZERO inside
 * Affordable Ownership Need, a 2,038-word section carrying LIHTC, QCT, CHFA,
 * AMI, HUD, ACS and CHAS. The feature was written, shipped, wired into the
 * nav — and never touched the pages it was for.
 *
 * Fixing the reach exposed a second defect that had been latent because the
 * reach was so small: the wrapper ran one replace() per term over an
 * ACCUMULATING HTML string, so each term matched inside the definitions
 * already inserted. AMI's definition ends "...as calculated by HUD", which
 * produced 44 nested definitions on one page.
 *
 * These are source-level guards on the mechanism. The behavioural check —
 * 249 terms wrapped page-wide, 19 in the ownership section, 0 nested — was run
 * in a browser against the rendered page and is recorded in the PR; it needs a
 * live DOM with data loaded, which this suite does not have.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'glossary.js'), 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('glossary-reaches-rendered-content');

test('wrapping re-runs when content arrives, not once at load', () => {
  // Anchored on the CONSTRUCTION and the .observe() call, not the word: the
  // first version of this matched the `typeof MutationObserver` feature check,
  // so deleting the actual observer sailed past it. A mention is not a call —
  // the same distinction that bit the freshness-guard ordering test.
  assert.ok(/new MutationObserver\(/.test(SRC),
    'glossary.js no longer constructs an observer — it goes back to seeing only '
    + 'the static shell, and every dynamically rendered panel loses its definitions');
  assert.ok(/\)\.observe\(host,/.test(SRC),
    'the observer is constructed but never attached to the content host');
  assert.ok(/childList:\s*true/.test(SRC) && /subtree:\s*true/.test(SRC),
    'the observer is not watching the subtree, so nested renders are missed');
});

test('the re-run is debounced', () => {
  // The HNA renders many panels in a burst; a full walk per mutation would be
  // paid 100+ times for one screenful.
  assert.ok(/clearTimeout\(pending\)/.test(SRC),
    'the sweep is not debounced');
});

test('the observer ignores the mutations the sweep itself causes', () => {
  // Wrapping inserts nodes, which fires the observer, which sweeps again.
  assert.ok(/if \(mutating\) return;/.test(SRC),
    'the observer does not skip self-inflicted mutations and will chase its own tail');
});

test('a term is wrapped once per SECTION, not once per page', () => {
  // First-use-per-page is the wrong unit on a 17,000-word assessment: AMI
  // appears 169 times and CDP 218 times, so one definition at the top leaves
  // every panel below it unexplained.
  assert.ok(/function sectionKeyFor/.test(SRC), 'sectionKeyFor is gone');
  assert.ok(/sectionKey \+ '\|' \+ match/.test(SRC),
    'the wrapped-map key is no longer section-scoped');
  assert.ok(/closest\(\s*'section, \.chart-card, article, main'\s*\)/.test(SRC),
    'the section container list has changed; check it still matches the HNA panels');
});

test('bookkeeping survives between passes', () => {
  // Content arrives repeatedly; a per-invocation map would re-wrap the same
  // term on every sweep.
  assert.ok(/var _wrapped = Object\.create\(null\)/.test(SRC),
    'the wrapped map is no longer module-scoped, so repeat sweeps re-wrap');
  assert.ok(/var wrapped = _wrapped;/.test(SRC), 'autoTooltip is not using the persistent map');
});

test('text is wrapped in ONE pass, never by re-scanning its own output', () => {
  // The nested-definition bug. A per-term replace() over an accumulating
  // string matches inside definitions already inserted.
  assert.ok(/escaped\.replace\(termPattern,/.test(SRC),
    'wrapping no longer uses a single combined pass — per-term replacement over '
    + 'accumulating HTML nests definitions inside definitions');
  assert.ok(!/result = result\.replace\(re, tooltip\)/.test(SRC),
    'the accumulating per-term replace() is back');
  assert.ok(/var termPattern = new RegExp/.test(SRC), 'the combined pattern is gone');
});

test('the text is escaped before markup is inserted', () => {
  assert.ok(/var escaped = escHtml\(text\)/.test(SRC),
    'the text node is interpolated into innerHTML without escaping');
});

test('longer terms still win over shorter ones', () => {
  // "compliance period" must beat "compliance"; the alternation is ordered.
  const at = SRC.indexOf('acronyms.sort');
  const pat = SRC.indexOf('var termPattern');
  assert.ok(at >= 0 && pat > at,
    'the pattern is built before the longest-first sort, so "compliance" will '
    + 'match inside "compliance period"');
});

test('tooltips are never walked into', () => {
  assert.ok(/FILTER_REJECT/.test(SRC),
    'the walker no longer rejects tooltip subtrees; FILTER_SKIP alone keeps '
    + 'descending and re-wraps definition text');
  assert.ok(/closest\('\.gl-tooltip-popup'\)/.test(SRC),
    'the popup subtree is no longer excluded from the walk');
});

test('the skips that stopped garbled labels are all still there', () => {
  // Each of these was a real rendering bug: definitions bleeding into a
  // heading's accessible name, into <option> labels via flat textContent,
  // and into narrow table headers.
  for (const sel of ['h1, h2, h3, h4, h5, h6', 'option', 'button', 'th']) {
    assert.ok(SRC.includes(sel), `the ${sel} skip is gone`);
  }
  assert.ok(/'ABBR'/.test(SRC), 'ABBR is not skipped, so tooltips can nest in their own markup');
});

test('a renderer can ask for a rescan, and failures never break the page', () => {
  assert.ok(/rescan:/.test(SRC), 'the rescan hook is gone');
  assert.ok((SRC.match(/catch \(e\) \{/g) || []).length >= 2,
    'the sweep is not wrapped in a catch; a glossary error would take the page down');
});

console.log(failures === 0
  ? '  glossary-reaches-rendered-content: PASS'
  : `  glossary-reaches-rendered-content: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
