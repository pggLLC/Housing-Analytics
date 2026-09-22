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

test('the circle a reader sees matches the step it belongs to', () => {
  // This is the assertion that was missing, and the reorder shipped without
  // it. Every check above reads data-step and href — machine attributes. The
  // NUMERAL inside .wf-step__num is separate markup, it did not move with the
  // swap, and two pages went out showing "2" in the first circle and "1" in
  // the second while every attribute said the opposite. The reader sees the
  // circle; the guard was reading the label.
  //
  // It stayed invisible because WorkflowProgress.refreshSteps() rewrites every
  // circle from its own data-step at load, repairing the markup on the ten
  // pages that call it. Only three railed pages do not, and the finder is one
  // of them — so the drift was real everywhere in the files and visible on
  // exactly one page. A guard that reads the files catches all of it.
  const offenders = [];
  for (const f of railed) {
    const src = read(f);
    for (const m of src.matchAll(/class="wf-step[^"]*"[^>]*data-step="(\d)"[^>]*>\s*<span class="wf-step__num">([^<]+)<\/span>/g)) {
      const [, step, shown] = m;
      const text = shown.trim();
      // A completed step shows a check glyph instead of its digit.
      if (text === '&#10003;' || text === '\u2713') continue;
      if (text !== step) offenders.push(`${f}: step ${step} shows "${text}"`);
    }
  }
  assert.deepStrictEqual([...offenders], [], offenders.join('; '));
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
  // step up by its ordinal. It kept matching after the reorder and silently
  // addressed a different step.
  //
  // Deliberately reads the raw file — no comment stripping. Stripping first
  // seemed tidier (a comment quoting the old selector would fire this falsely)
  // but it is wrong in the direction that matters: any incompleteness in a
  // comment regex HIDES text from this scan, which is a silent miss of exactly
  // the bug being guarded. A false fire is loud and takes a minute to dismiss.
  // The match is already anchored on the invocation, not the mention.
  const offenders = [];
  for (const f of pages) {
    const src = read(f);
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

/* ── The rail has to fit, or scroll — never silently clip ────────────────── */

test('every step is a direct child of the strip', () => {
  // Structural, not textual. Step 7 shipped nested INSIDE step 6 on the deal
  // calculator, because that is the one page where step 6 is the active step —
  // a <div> rather than an <a> — and the insertion anchor matched one level
  // too early. The rail then rendered across four vertical positions with the
  // seventh step hanging below.
  //
  // A regex cannot see this: `<div class="wf-step-connector"></div>` supplies
  // a closing </div> that stops a non-greedy match early, which is both how
  // the bug got in and how my first check for it reported zero. So the markup
  // is parsed.
  const VOID = /^(br|img|input|meta|link|hr|source|area|base|col|embed|param|track|wbr)$/i;
  const offenders = [];
  for (const f of railed) {
    const src = read(f);
    // Start immediately after the strip's own opening tag, then walk tags
    // keeping a depth counter. A step is a direct child exactly when depth is
    // 0 at the moment its tag opens.
    const openTag = /<div[^>]*class="[^"]*wf-progress-steps[^"]*"[^>]*>/.exec(src);
    if (!openTag) continue;
    const body = src.slice(openTag.index + openTag[0].length);
    let depth = 0;
    const tagRe = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g;
    let m;
    while ((m = tagRe.exec(body))) {
      const [, closing, tag, attrs, selfClose] = m;
      if (closing) {
        if (depth === 0) break;      // the strip itself closed
        depth -= 1;
        continue;
      }
      if (VOID.test(tag) || selfClose) continue;
      const stepAttr = /data-step="(\d+)"/.exec(attrs);
      const isStep = /class="[^"]*\bwf-step\b/.test(attrs);
      if (isStep && stepAttr && depth !== 0) {
        offenders.push(`${f}: step ${stepAttr[1]} is nested ${depth} level(s) deep, not a direct child`);
      }
      depth += 1;
    }
  }
  assert.deepStrictEqual([...offenders], [], offenders.join('; '));
});

test('the compaction breakpoint is wide enough for the steps that exist', () => {
  // Derived, not picked, and asserted in BOTH producers.
  //
  // A full-size step is min-width 80px, a connector 20px, and the wrap adds
  // 36px of side padding. Seven steps therefore need 716px. The breakpoint was
  // 480px — correct when the rail had five steps — so adding step 7 opened a
  // band between 481px and 716px where the rail neither compacted nor
  // scrolled, and `overflow:hidden` on the wrap CLIPPED the last step. At
  // 666px a reader simply never learned "Recommendation" existed.
  const component = read('js/components/workflow-progress.js');
  const steps = [...component.matchAll(/\{ num: (\d+), key:/g)].length;
  assert.ok(steps >= 6, `only ${steps} steps parsed from the component`);

  const needed = (steps * 80) + ((steps - 1) * 20) + 36;

  const derived = /return \(STEPS\.length \* STEP_MIN_PX\)/.test(component);
  assert.ok(derived,
    'the component no longer derives the compaction width from STEPS.length, so it '
    + 'will not follow the next step that is added');

  const css = read('css/site-theme.css');
  const bp = /@media \(max-width: (\d+)px\) \{\s*\.wf-progress-wrap,/.exec(css);
  assert.ok(bp, 'the rail compaction breakpoint is gone from site-theme.css');
  assert.ok(Number(bp[1]) >= needed,
    `site-theme.css compacts the rail below ${bp[1]}px, but ${steps} steps need ${needed}px. `
    + `Between ${Number(bp[1]) + 1}px and ${needed}px the rail neither compacts nor fits, and `
    + 'the wrap clips it.');
});

test('the strip scrolls rather than clipping when it cannot fit', () => {
  // The safety net, for widths below even the compact minimum. Clipping loses
  // a step with no indication; scrolling keeps it reachable.
  const component = read('js/components/workflow-progress.js');
  const joined = component.replace(/'\s*\+\s*'/g, '').replace(/'\s*\n\s*\+\s*'/g, '');
  // Only the BASE rule counts. The compaction block also sets overflow-x:auto,
  // so matching anywhere passes while the full-size rail still clips — which is
  // exactly what the first version of this assertion did.
  const base = joined.slice(0, joined.indexOf('@media'));
  assert.ok(/\.wf-progress-steps\{[^}]*overflow-x:auto/.test(base),
    'the strip no longer scrolls at full size, so an overflowing rail is clipped by the '
    + "wrap's overflow:hidden");
});

test('no page keeps its own copy of the rail CSS', () => {
  // Ten pages carried a fork of the component's rail styles, each hardcoding
  // `top:70px` and its own breakpoint. They were appended after the component's
  // and won, so #1640's "pin to the measured header" fix never reached them —
  // and neither would any later fix. One producer.
  const offenders = [];
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html'))) {
    const src = read(f);
    if (/['.]wf-progress-wrap\{/.test(src) || /['.]wf-step\{/.test(src)) offenders.push(f);
  }
  assert.deepStrictEqual([...offenders], [],
    `these define rail CSS the component already owns: ${offenders.join(', ')}`);
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
  // The page already had a primary button to this place; a second one would
  // have been two producers of the same call to action, competing for the
  // same click. That part is unchanged.
  //
  // What changed is the wording. This used to pin the literal string "Start a
  // Housing Market Study", sourced from #1620 §7 — a scoping document whose
  // own opening line says it was "produced by Claude" and is "an input to an
  // owner decision, not a build order". It was implemented in #1713 anyway,
  // and the button then disagreed with select-jurisdiction.html, which tells
  // the reader seven times that they are beginning a Housing Needs
  // Assessment. The owner chose the destination's wording on 2026-09-18.
  //
  // Pinning a literal here is what let the two drift apart in the first
  // place, so this asserts the SHAPE — the CTA must name what it starts — and
  // test/homepage-job-routing.test.js checks that the name matches the page
  // it opens. Reword both together and both tests stay green; reword one and
  // that one fails.
  const src = read('index.html');
  const ctas = [...src.matchAll(/<a href="([^"]+)" class="btn"[\s\S]*?<\/a>/g)];
  assert.strictEqual(ctas.length, 1, `${ctas.length} primary CTAs on the homepage; expected exactly one`);
  assert.strictEqual(ctas[0][1], JURIS, `the entry CTA points at ${ctas[0][1]}`);
  assert.ok(/<span>\s*(?:Start|Begin|Open)\s+(?:a|an|your)\s+\S[^<]*</i.test(ctas[0][0]),
    'the entry CTA no longer names what the reader is starting');
  assert.ok(/Step 1 &mdash; pick a Colorado jurisdiction/.test(ctas[0][0]),
    'the CTA no longer says which step it opens, so it cannot be checked against the rail');
});

console.log(failures === 0
  ? '  entry-path-starts-at-jurisdiction: PASS'
  : `  entry-path-starts-at-jurisdiction: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
