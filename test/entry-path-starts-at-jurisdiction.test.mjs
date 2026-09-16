#!/usr/bin/env node
/**
 * The guided path starts at "pick my town".
 *
 * The Opportunity Finder was step 1. It is a STATEWIDE screening tool — the
 * right answer to "where should we build" and a detour for the far more common
 * visitor who already knows which town they are working on. The guided path
 * opened on a question most readers had already answered, and the jurisdiction
 * that every downstream number depends on was chosen second.
 *
 * #1620 §7 slice 1 swaps steps 1 and 2. Route and copy only: the finder stays
 * on the path as the optional branch, and nothing is moved or deleted.
 *
 * What this file mostly guards is the swap's blast radius, because a step
 * number is used as an identity in four separate places that can disagree:
 *
 *   1. the hard-coded rail markup in twelve HTML pages,
 *   2. js/components/workflow-progress.js STEPS,
 *   3. a `.wf-step[data-step="2"]` selector that named the jurisdiction step by
 *      its ordinal — it had already been renumbered once (F21) and pointed at
 *      the wrong step both times,
 *   4. a WorkflowState key → step-number literal in the same component, which
 *      would have ticked the finder as done when a jurisdiction was chosen.
 *
 * 3 and 4 were fixed by removing the ordinal, not by renumbering it again: the
 * step's href and the STEPS table are its identity. The assertions below are
 * written so that another renumber cannot reintroduce either.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JURIS = 'select-jurisdiction.html';
const FINDER = 'lihtc-opportunity-finder.html';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('entry-path-starts-at-jurisdiction');

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const railed = pages.filter((f) => read(f).includes('class="wf-step'));

test('the scan finds the hard-coded rails', () => {
  // Without this, every assertion below passes by finding nothing.
  assert.ok(railed.length >= 10,
    `only ${railed.length} pages carry a rail; the markup has changed shape and this guard is now blind`);
});

test('every rail puts the jurisdiction at step 1', () => {
  const offenders = [];
  for (const f of railed) {
    const src = read(f);
    // Step 1 is either a link to the jurisdiction page, or — on that page —
    // the active step, which renders as an unlinked div.
    const linked = new RegExp(`<a class="wf-step[^"]*" href="${JURIS}"[^>]*data-step="1"`).test(src);
    const active = f === JURIS && /<div class="wf-step[^"]*wf-step--active"[^>]*data-step="1"/.test(src);
    if (!linked && !active) offenders.push(f);
  }
  assert.deepStrictEqual([...offenders], [],
    `these open the guided path somewhere other than the jurisdiction: ${offenders.join(', ')}`);
});

test('the finder is still on the path, as step 2', () => {
  // Route change, not a removal. If the finder ever stops being reachable from
  // the rail this is a deletion wearing a reorder's clothes.
  assert.ok(fs.existsSync(path.join(ROOT, FINDER)), `${FINDER} is gone`);
  const linking = railed.filter((f) =>
    new RegExp(`<a class="wf-step[^"]*" href="${FINDER}"[^>]*data-step="2"`).test(read(f)));
  assert.ok(linking.length >= 8,
    `only ${linking.length} rails link the finder at step 2; it has fallen off the path`);
});

test('the rail component agrees with the markup', () => {
  // One rail, two producers. Changing the component alone changed nothing for
  // any of the twelve pages, and the browser showed the old order while the
  // file on disk showed the new one.
  const src = read('js/components/workflow-progress.js');
  const steps = [...src.matchAll(/\{ num: (\d)[^}]*?href: '([^']+)' \}/g)]
    .map((m) => [Number(m[1]), m[2]]);
  assert.ok(steps.length >= 6, `the STEPS table no longer parses (${steps.length} steps found)`);
  assert.deepStrictEqual(steps.slice(0, 2), [[1, JURIS], [2, FINDER]],
    'the rail component and the page markup disagree about steps 1 and 2');
});

test('no page identifies a rail step by its number', () => {
  // The defect that survived the F21 renumber: page JS looked the jurisdiction
  // step up as .wf-step[data-step="2"]. It kept matching after the reorder and
  // silently addressed a different step.
  const offenders = [];
  for (const f of pages) {
    const src = read(f).replace(/<!--[\s\S]*?-->/g, '');
    if (/querySelector\w*\(\s*['"][^'"]*\.wf-step\[data-step=/.test(src)) offenders.push(f);
  }
  assert.deepStrictEqual([...offenders], [],
    `these look a rail step up by its ordinal, which survives a renumber pointing `
    + `at the wrong step — anchor on href instead: ${offenders.join(', ')}`);
});

test('the jurisdiction connector is anchored on the href', () => {
  // The positive half of the assertion above: the lookup still has to happen.
  const src = read('housing-needs-assessment.html');
  assert.ok(src.includes(`document.querySelector('.wf-step[href="${JURIS}"]')`),
    'updateWorkflowStepState() no longer finds the jurisdiction step by href');
});

test('the WorkflowState step map is derived, not duplicated', () => {
  const src = read('js/components/workflow-progress.js');
  assert.ok(/for \(var m = 0; m < STEPS\.length; m\+\+\) \{ map\[STEPS\[m\]\.key\] = STEPS\[m\]\.num; \}/.test(src),
    'the key → step-number map is no longer derived from STEPS');
  assert.ok(!/var map = \{\s*\w+:\s*\d/.test(src),
    'a parallel key → number literal is back; it disagreed with STEPS through two '
    + 'renumbers and would tick the wrong step as done');
  for (const key of ['jurisdiction', 'opportunity', 'hsa', 'market', 'scenario', 'deal']) {
    assert.ok(new RegExp(`key: '${key}'`).test(src),
      `STEPS lost the '${key}' key, so that WorkflowState step can never be marked done`);
  }
});

test('the homepage cards open on the jurisdiction', () => {
  const src = read('index.html');
  const cards = [...src.matchAll(/<li class="home-step[^"]*">\s*<span class="home-step__num"[^>]*>(\d+)<\/span>[\s\S]*?href="([^"]+)" aria-label="Step (\d+):/g)]
    .map((m) => ({ num: m[1], href: m[2], aria: m[3] }));
  assert.ok(cards.length >= 6, `only ${cards.length} homepage step cards parsed`);
  assert.deepStrictEqual(
    cards.slice(0, 2).map((c) => [c.num, c.href, c.aria]),
    [['01', JURIS, '1'], ['02', FINDER, '2']],
    'the homepage still presents the finder as the first step');
});

test('the numeral, the link and the aria label never disagree', () => {
  // Three copies of the same step number on one card. The reorder moved the
  // cards; if any copy is renumbered independently a screen-reader user and a
  // sighted user are told different things.
  const src = read('index.html');
  const offenders = [];
  for (const m of src.matchAll(/<span class="home-step__num"[^>]*>(\d+)<\/span>[\s\S]*?aria-label="Step (\d+):/g)) {
    if (String(Number(m[1])) !== m[2]) offenders.push(`card ${m[1]} is labelled step ${m[2]}`);
  }
  assert.deepStrictEqual([...offenders], [], offenders.join('; '));
});

test('the featured card is the one the reader should start on', () => {
  // The featured treatment is the visual "start here". Left on the finder it
  // would have reordered the list while still pointing the eye at step 2.
  const src = read('index.html');
  const featured = [...src.matchAll(/<li class="home-step home-step--featured">[\s\S]*?<\/li>/g)];
  assert.strictEqual(featured.length, 1,
    `${featured.length} homepage cards are featured; exactly one can be the start`);
  assert.ok(featured[0][0].includes(`href="${JURIS}"`),
    'the featured card is not the jurisdiction step');
});

test('one entry CTA, and it names the study', () => {
  // #1620 §7 asks for a "Start a Housing Market Study" CTA. The page already
  // had a primary button to the same place; a second one would have been two
  // producers of the same call to action, competing for the same click.
  const src = read('index.html');
  const ctas = [...src.matchAll(/<a href="([^"]+)" class="btn"[\s\S]*?<\/a>/g)];
  assert.strictEqual(ctas.length, 1, `${ctas.length} primary CTAs on the homepage; expected exactly one`);
  assert.strictEqual(ctas[0][1], JURIS, `the entry CTA points at ${ctas[0][1]}`);
  assert.ok(ctas[0][0].includes('Start a Housing Market Study'),
    'the entry CTA no longer names what the reader is starting');
  assert.ok(/Step 1 &mdash; pick a Colorado jurisdiction/.test(ctas[0][0]),
    'the CTA no longer says which step it opens, so it cannot be checked against the rail');
});

console.log(failures === 0
  ? '  entry-path-starts-at-jurisdiction: PASS'
  : `  entry-path-starts-at-jurisdiction: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
