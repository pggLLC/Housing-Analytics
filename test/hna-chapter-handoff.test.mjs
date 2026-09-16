#!/usr/bin/env node
/**
 * Each part of the HNA must close by naming what the reader has, and what is next.
 *
 * The assessment is 15,765 words across 53 sections on the canonical page. It
 * is already split into five parts of 11-15 sections — and every one of them
 * ended on the same generic "Continue to Market Analysis" panel, so finishing
 * "Who lives here" produced no signal that anything had been finished, and no
 * reason to open the next part. Five pages, not a path.
 *
 * What this guards is mostly restraint. The risks are that the summary starts
 * computing its own numbers (a second producer, which this repo has been
 * bitten by), that it renders an absent figure as a confident blank, or that
 * it grows into a celebration. The subject is people who cannot afford housing.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hna', 'hna-views.json'), 'utf8'));
const RUNTIME = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-chapter-handoff.js'), 'utf8');
const GEN = fs.readFileSync(path.join(ROOT, 'scripts', 'hna', 'build_hna_views.py'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('hna-chapter-handoff');

const views = VIEWS.views || [];

test('every part declares a handoff', () => {
  assert.ok(views.length >= 5, `only ${views.length} views`);
  const missing = views.filter((v) => !v.handoff).map((v) => v.id);
  assert.deepStrictEqual([...missing], [],
    `these parts end with no handoff, so a reader finishing them is told nothing: ${missing.join(', ')}`);
});

test('each handoff says why the next part matters', () => {
  for (const v of views) {
    const why = (v.handoff || {}).why || '';
    assert.ok(why.length >= 40,
      `${v.id}: the reason for the next part is missing or too thin to be a reason`);
  }
});

test('the parts chain, and exactly one leaves the assessment', () => {
  const ids = new Set(views.map((v) => v.id));
  const exits = views.filter((v) => !(v.handoff || {}).next);
  assert.strictEqual(exits.length, 1,
    `${exits.length} parts have no next part; there should be exactly one end of the path`);
  for (const v of views) {
    const nxt = (v.handoff || {}).next;
    if (!nxt) continue;
    assert.ok(ids.has(nxt), `${v.id} points at "${nxt}", which is not a part`);
    assert.notStrictEqual(nxt, v.id, `${v.id} points at itself`);
  }
  // No cycles: following next from the first part must reach the exit.
  let cur = views[0], seen = new Set(), steps = 0;
  while (cur && (cur.handoff || {}).next && steps++ < 20) {
    assert.ok(!seen.has(cur.id), `the path loops at ${cur.id}`);
    seen.add(cur.id);
    cur = views.find((v) => v.id === cur.handoff.next);
  }
  assert.ok(cur && !(cur.handoff || {}).next, 'following the path never reaches the end');
});

test('the figures are quoted from the page, never recomputed', () => {
  // A summary that derives its own numbers is a second producer. When
  // co-county-demographics.json had two, they disagreed daily and both were
  // green. The handoff reads the stat cells that are already rendered.
  assert.ok(/document\.getElementById\(li\.getAttribute\('data-stat'\)\)/.test(RUNTIME),
    'the handoff no longer reads its values from the page');
  for (const bad of ['fetch(', 'JSON.parse', 'reduce(']) {
    assert.ok(!RUNTIME.includes(bad),
      `the handoff runtime contains "${bad}" — it should quote the page, not compute`);
  }
});

test('a figure that did not load is dropped, not shown as a dash', () => {
  // Salida publishes no QCT count; the cell reads "—". Repeating that under a
  // heading promising a summary is the same defect one layer up.
  assert.ok(/PLACEHOLDER/.test(RUNTIME) && /—/.test(RUNTIME),
    'the placeholder filter is gone; dashes will render as figures');
  assert.ok(/\/\\d\/\.test\(t\)/.test(RUNTIME) || /\/\\d\//.test(RUNTIME),
    'the runtime no longer requires a digit, so labels and error strings can render as figures');
  assert.ok(/empty\.hidden = shown > 0/.test(RUNTIME),
    'there is no message for the case where nothing loaded');
});

test('hidden figures are actually hidden', () => {
  // `display: flex` on the list item beats the user agent's
  // `[hidden] { display: none }`, so a dropped figure still rendered its label
  // with no number beside it — worse than the dash it replaced.
  assert.ok(/\.hna-handoff__list li\[hidden\]/.test(CSS),
    'the [hidden] override is gone; dropped figures will show their labels with no value');
});

test('the block is generated, not hand-written into five pages', () => {
  assert.ok(/def handoff\(out, view, all_views\)/.test(GEN), 'the generator function is gone');
  assert.ok(/no continue panel to place the handoff before/.test(GEN),
    'the generator no longer fails loudly when its anchor moves');
});

test('every part actually carries the block', () => {
  for (const v of views) {
    const page = path.join(ROOT, v.slug);
    assert.ok(fs.existsSync(page), `${v.slug} is missing`);
    const src = fs.readFileSync(page, 'utf8');
    assert.ok(src.includes('id="hnaChapterHandoff"'), `${v.slug} has no handoff block — regenerate the views`);
    assert.ok(src.includes('hna-chapter-handoff.js'), `${v.slug} does not load the handoff runtime`);
    for (const k of (v.handoff.know || [])) {
      assert.ok(src.includes(`data-stat="${k.id}"`), `${v.slug} is missing the ${k.id} figure`);
    }
  }
});

test('it stays quiet', () => {
  // The reward on offer is competence, not applause. A housing needs
  // assessment that congratulates someone for scrolling reads as not taking
  // the subject seriously, and this audience notices.
  // Scoped to what a READER sees: the configured copy plus the rendered block
  // on each page. The first version scanned the generator and the stylesheet
  // too, and failed on "anchor points at an id" in an unrelated error message.
  // A guard that fires on the word "points" inside a stack trace gets deleted,
  // and then the thing it was protecting is unguarded.
  let reader = views.map((v) => Object.values(v.handoff)
    .map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join(' ');
  for (const v of views) {
    const src = fs.readFileSync(path.join(ROOT, v.slug), 'utf8');
    const i = src.indexOf('<section class="hna-handoff"');
    if (i >= 0) reader += ' ' + src.slice(i, src.indexOf('</section>', i)).replace(/<[^>]*>/g, ' ');
  }
  for (const cheese of ['🎉', '🏆', 'Congratulations', 'Well done', 'Great job',
    '\\bpoints\\b', '\\bbadge', '\\bstreak', 'Level up', 'confetti', '\\bearned\\b']) {
    assert.ok(!new RegExp(cheese, 'i').test(reader),
      `"${cheese}" reaches the reader in the handoff — this is an assessment of who cannot afford housing`);
  }
  // And the check must be able to see the copy at all.
  assert.ok(/What you have now/i.test(reader), 'the scan found no handoff copy to check');
});

test('the step label matches the rail', () => {
  // The rail numbers the assessment 3 of 6; the closing panel asked whether
  // step 2 was complete.
  const canonical = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert.ok(/Step 3 complete\?/.test(canonical), 'the closing panel no longer matches the rail number');
  assert.ok(!/Step 2 complete\?/.test(canonical), 'the old step number is back');
});

console.log(failures === 0
  ? '  hna-chapter-handoff: PASS'
  : `  hna-chapter-handoff: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
