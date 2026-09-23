#!/usr/bin/env node
/**
 * The guided path has ONE step sequence, and every producer reads it.
 *
 * workflow-progress.js STEPS is canonical. workflow-next-action.js used to
 * keep a parallel copy, and the copy drifted twice: the first two steps were
 * swapped, and step 7 was never added. So the same screen showed the rail
 * reading "step 1 of 7" and the banner reading "Step 2 of 6", and the deal
 * calculator announced itself as "Step 6 of 6" and pointed nowhere — the
 * guided path ended one page short of Recommendation, the step that exists
 * precisely so the reader does not "finish the route holding six pages and
 * no answer".
 *
 * A comment in workflow-next-action.js had already recorded an EARLIER round
 * of the same drift ("Step 2 of 5" against "step 3 of 6"), fixed by re-typing
 * the list. That is why it came back. This guard is the thing that comment
 * was missing: a copy kept in step by hand goes out of step the next time the
 * other one moves.
 *
 * Both files are browser IIFEs, so they are evaluated here in a jsdom window
 * — the real load order a page uses — and the sequence the banner RESOLVED is
 * compared against the rail's. That is stronger than reading the source for a
 * hard-coded array: it fails whatever way the two stop agreeing.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROGRESS = path.join(ROOT, 'js/components/workflow-progress.js');
const NEXT_ACTION = path.join(ROOT, 'js/components/workflow-next-action.js');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

/** Evaluate both components in one window, in the page's load order. */
function load() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { url: 'http://localhost/deal-calculator.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(PROGRESS, 'utf8'));
  w.eval(fs.readFileSync(NEXT_ACTION, 'utf8'));
  return w;
}

const w = load();

console.log('one-canonical-step-sequence');

test('both components actually loaded', () => {
  // Without this every comparison below passes by comparing nothing.
  assert.ok(w.WorkflowProgress, 'workflow-progress.js did not expose WorkflowProgress');
  assert.ok(w.WorkflowNextAction, 'workflow-next-action.js did not expose WorkflowNextAction');
  assert.ok(Array.isArray(w.WorkflowProgress.STEPS) && w.WorkflowProgress.STEPS.length >= 5,
    'the rail exposes no usable STEPS array');
});

test('the banner resolves the rail sequence, in the rail order', () => {
  const rail = w.WorkflowProgress.STEPS.map((s) => s.key);
  const banner = w.WorkflowNextAction.steps().keys;
  assert.deepStrictEqual(banner, rail,
    'the banner is using a different step sequence from the rail. One screen would show '
    + 'two different "Step N of M" answers. workflow-progress.js STEPS is canonical — read '
    + 'it rather than restating it');
});

test('every step has an href the banner can send someone to', () => {
  const urls = w.WorkflowNextAction.steps().urls;
  const rail = w.WorkflowProgress.STEPS;
  for (const step of rail) {
    assert.strictEqual(urls[step.key], step.href,
      `${step.key} points at ${urls[step.key]} in the banner and ${step.href} in the rail`);
  }
});

test('the last step is reachable — the path does not end one page early', () => {
  const rail = w.WorkflowProgress.STEPS;
  const last = rail[rail.length - 1];
  const banner = w.WorkflowNextAction.steps();
  assert.ok(banner.keys.indexOf(last.key) !== -1,
    `the final step '${last.key}' is missing from the banner's sequence, so the step before it `
    + 'announces itself as the last one and points nowhere. That is the defect this file exists '
    + 'to prevent: the reader finishes the route holding no answer');
  assert.strictEqual(banner.keys[banner.keys.length - 1], last.key,
    `'${last.key}' is not last in the banner's sequence`);
});

test('the offline fallback matches the rail too', () => {
  // The fallback only runs on a page that loads the banner without the rail,
  // which is exactly where nobody would notice it had gone stale.
  const rail = w.WorkflowProgress.STEPS.map((s) => s.key);
  const fallback = w.WorkflowNextAction.fallbackSteps().map((s) => s.key);
  assert.deepStrictEqual(fallback, rail,
    'the hard-coded fallback sequence has drifted from the rail');
});

test('every URL alias names a step the rail actually has', () => {
  // An alias is how one step covers several pages (the needs assessment's
  // chapters and its full report). An alias for a step that does not exist
  // silently stops matching, and the page it names loses its banner.
  const keys = w.WorkflowNextAction.steps().keys;
  const aliases = w.WorkflowNextAction.urlAliases();
  const names = Object.keys(aliases);
  assert.ok(names.length >= 1, 'no aliases registered; the probe below proves nothing');
  for (const page of names) {
    assert.ok(keys.indexOf(aliases[page]) !== -1,
      `${page} is aliased to step '${aliases[page]}', which is not in the rail's sequence`);
    assert.ok(fs.existsSync(path.join(ROOT, page)), `${page} is aliased but does not exist`);
  }
});

test('and the comparison would actually notice', () => {
  // Everything agrees today, so the assertions above pass whether or not they
  // work. Exercise the comparison against a sequence that is deliberately
  // wrong, the two ways it has actually drifted before: a swap, and a drop.
  const rail = w.WorkflowProgress.STEPS.map((s) => s.key);
  const swapped = rail.slice(); const t = swapped[0]; swapped[0] = swapped[1]; swapped[1] = t;
  const dropped = rail.slice(0, -1);

  assert.notDeepStrictEqual(swapped, rail, 'a swapped sequence compares equal to the rail');
  assert.notDeepStrictEqual(dropped, rail, 'a truncated sequence compares equal to the rail');
  assert.ok(rail.length >= 2, 'the rail is too short for this probe to mean anything');
});

console.log(failures === 0
  ? '  one-canonical-step-sequence: PASS'
  : `  one-canonical-step-sequence: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
