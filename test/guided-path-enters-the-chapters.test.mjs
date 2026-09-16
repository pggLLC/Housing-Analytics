#!/usr/bin/env node
/**
 * Step 3 of the guided path opens the assessment in parts, not the full report.
 *
 * The canonical housing-needs-assessment.html is 53 sections and ~15,800 words.
 * A planner who had just chosen their town was redirected straight into it —
 * that redirect, not the rail, is where the guided path stopped being guided.
 *
 * The rail turned out to live in TWO places: js/components/workflow-progress.js
 * AND hard-coded markup in ten HTML pages. Changing the component alone changed
 * nothing for any of them, and the browser showed the old target while the file
 * on disk showed the new one. One rail, two producers — the same shape as
 * co-county-demographics.json. That is what most of this file guards.
 *
 * The relationship also has to stay two-way: every part offers "Full report →",
 * and before this the full report offered nothing back, so anyone arriving
 * there from search or a bookmark met 53 sections with no sign the parts
 * existed.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAPTER = 'hna-what-housing-exists.html';
const FULL = 'housing-needs-assessment.html';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('guided-path-enters-the-chapters');

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const railed = pages.filter((f) => read(f).includes('data-step="3"'));

test('the scan finds the hard-coded rails', () => {
  // Without this every assertion below passes by finding nothing — which is
  // exactly how the JS-only change looked correct while ten pages disagreed.
  assert.ok(railed.length >= 8,
    `only ${railed.length} pages carry a rail; the markup has changed shape and this guard is now blind`);
});

test('no rail sends step 3 to the full report', () => {
  const offenders = [];
  for (const f of railed) {
    const m = /<a class="wf-step[^"]*" href="([^"]+)"[^>]*data-step="3"/.exec(read(f));
    if (m && m[1] !== CHAPTER) offenders.push(`${f} → ${m[1]}`);
  }
  assert.deepStrictEqual([...offenders], [],
    `these send a novice into the 53-section full report: ${offenders.join(', ')}`);
});

test('at least one rail actually links to step 3', () => {
  // On the assessment pages themselves step 3 is the current step and renders
  // unlinked. If NO page links it, the assertion above is vacuous.
  const linking = railed.filter((f) => new RegExp(`<a class="wf-step[^"]*" href="${CHAPTER}"[^>]*data-step="3"`).test(read(f)));
  assert.ok(linking.length >= 3,
    `only ${linking.length} pages link step 3; expected the other steps' pages to link it`);
});

test('the rail component agrees with the markup', () => {
  // Two producers of the same rail. They diverged silently once already.
  const src = read('js/components/workflow-progress.js');
  const m = /num: 3[\s\S]{0,400}?href: '([^']+)'/.exec(src);
  assert.ok(m, 'step 3 is gone from the rail component');
  assert.strictEqual(m[1], CHAPTER,
    `the rail component points step 3 at ${m[1]} while the markup points at ${CHAPTER}`);
});

test('choosing a jurisdiction opens part 1, not the full report', () => {
  // The moment that actually matters: this is where a novice meets the
  // assessment for the first time.
  const src = read('js/jurisdiction-selector.js');
  assert.ok(src.includes(`global.location.href = '${CHAPTER}'`),
    'the post-selection redirect no longer opens the chapters');
  assert.ok(!/global\.location\.href = 'housing-needs-assessment\.html'/.test(src),
    'the redirect into the full report is back');
});

test('the homepage entry opens part 1', () => {
  const src = read('index.html');
  assert.ok(src.includes(`href="${CHAPTER}" aria-label="Step 3: Housing needs assessment"`),
    'the homepage sends a first-time visitor into the full report');
});

test('resuming a saved project still opens the full report, on purpose', () => {
  // Deliberately NOT changed. Someone resuming saved work wants the whole
  // thing, not to be restarted at part 1. Pinned so that if it ever changes it
  // is a decision rather than a sweep.
  const src = read('js/jurisdiction-selector.js');
  assert.ok(/sj-recent-card__resume" href="housing-needs-assessment\.html"/.test(src),
    'the resume card was repointed at the chapters — if that is intended, change '
    + 'this assertion deliberately; a returning user is not a first-time reader');
});

test('the comparison table opens part 1, from every producer of that link', () => {
  // 546 rows, each with an "Open HNA" link — the way a reader starts an
  // assessment from the ranking table. TWO files build those links:
  // hna-ranking-index.js (which normally wins) and hna-comparison.js (a
  // fallback that returns early when a row already has one).
  //
  // Editing the fallback alone changed nothing on screen and looked correct in
  // the diff. That is how the second producer was found — by loading the page,
  // not by reading the code. Both are pinned here.
  const ranking = read('js/hna/hna-ranking-index.js');
  const m = /const HNA_PAGE\s+= '([^']+)'/.exec(ranking);
  assert.ok(m, 'HNA_PAGE is gone from hna-ranking-index.js');
  assert.strictEqual(m[1], CHAPTER,
    `the ranking table sends all 546 rows to ${m[1]}; this one constant decides `
    + 'where every row goes');

  const fallback = read('js/hna/hna-comparison.js');
  assert.ok(fallback.includes(`<a href="${CHAPTER}?fips=`),
    'the hna-comparison.js fallback still builds a link to the full report; it '
    + 'runs whenever a row has no link yet, so it must agree with the primary');
});

test('the comparison page keeps the reader in the guided path', () => {
  // An excursion FROM step 3, reached by "Compare all jurisdictions →". With
  // no rail a reader lost their place entirely — the back button was the only
  // way home.
  const src = read('hna-comparative-analysis.html');
  assert.ok(src.includes('data-step="3"'), 'hna-comparative-analysis.html has no workflow rail');
  assert.ok(/<a class="wf-step[^"]*" href="hna-what-housing-exists\.html"[^>]*data-step="3"/.test(src),
    'step 3 is not a link back to the assessment. It must not be marked active: '
    + 'this page is not the needs assessment, and an active step renders unlinked, '
    + 'leaving no way back to what the reader stepped away from');
  assert.ok(src.includes('js/components/workflow-progress.js'),
    'the rail component is not loaded, so the markup renders unstyled — the '
    + 'styles ship inside that script, not in the CSS files');
});

test('the full report offers the parts back', () => {
  const src = read(FULL);
  const switchers = (src.match(/class="hna-view-switcher"/g) || []).length;
  assert.strictEqual(switchers, 1,
    `the full report carries ${switchers} switchers; it needs exactly one, or it is a dead end`);
  const views = JSON.parse(read('data/hna/hna-views.json')).views;
  for (const v of views) {
    assert.ok(src.includes(`href="${v.slug}"`), `the full report does not link to ${v.slug}`);
  }
});

test('each part carries exactly one switcher, and it reaches the full report', () => {
  // The canonical switcher is inherited by the generated views and removed by
  // reframe(). If that removal stops matching, every view ships two rows of
  // tabs — the first marking "Full report" as the current page while the
  // reader is plainly not on it.
  const views = JSON.parse(read('data/hna/hna-views.json')).views;
  for (const v of views) {
    const src = read(v.slug);
    const n = (src.match(/class="hna-view-switcher"/g) || []).length;
    assert.strictEqual(n, 1, `${v.slug} carries ${n} switchers`);
    assert.ok(!src.includes('id="hnaFullReportSwitcher"'),
      `${v.slug} inherited the canonical switcher; reframe() is no longer removing it`);
    assert.ok(src.includes(`href="${FULL}"`), `${v.slug} cannot reach the full report`);
  }
});

test('the generator fails loudly if the canonical switcher moves', () => {
  const gen = read('scripts/hna/build_hna_views.py');
  assert.ok(/hnaFullReportSwitcher/.test(gen), 'the generator no longer knows about the canonical switcher');
  assert.ok(/the canonical full-report switcher was not found/.test(gen),
    'the generator would silently ship two switchers if the anchor moved');
});

console.log(failures === 0
  ? '  guided-path-enters-the-chapters: PASS'
  : `  guided-path-enters-the-chapters: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
