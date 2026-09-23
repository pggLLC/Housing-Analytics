#!/usr/bin/env node
/**
 * Being asked for a jurisdiction returns you where you were going.
 *
 * The homepage links directly into every guided-path page except step 1, so a
 * first-time reader who picks "Deal Calculator" off a job tile arrives with no
 * jurisdiction. Until 2026-09-23 that produced "Earlier Step Incomplete —
 * Jurisdiction hasn't been completed yet", which blamed the reader for
 * skipping a step the site never showed them, and its button dropped them at
 * the top of the path, losing what they came for (#1837 F5).
 *
 * Now the prompt says what the page needs and carries the destination, so
 * choosing a jurisdiction comes back. Two things have to stay true:
 *
 *   1. `next` is an ALLOWLIST, not a redirect. It arrives in a URL a stranger
 *      can write. Only the guided path's own pages are accepted, matched by
 *      exact filename against workflow-progress.js STEPS — anything else,
 *      including any absolute URL, is ignored rather than sanitised.
 *   2. The button names where it actually goes. "Begin Housing Needs
 *      Assessment" on a button that opens the deal calculator is the same
 *      defect as a number meaning something other than it says.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELECTOR = fs.readFileSync(path.join(ROOT, 'js/jurisdiction-selector.js'), 'utf8');
const PROGRESS = fs.readFileSync(path.join(ROOT, 'js/components/workflow-progress.js'), 'utf8');
const NEXT_ACTION = fs.readFileSync(path.join(ROOT, 'js/components/workflow-next-action.js'), 'utf8');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

/** The allowlist, evaluated exactly as the browser runs it. */
function resolveNext(search) {
  const dom = new JSDOM(
    '<!doctype html><html><body><button id="sjContinueBtn">Begin Housing Needs Assessment →</button></body></html>',
    { url: 'http://localhost/select-jurisdiction.html' + search, runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(PROGRESS);
  w.eval(NEXT_ACTION);
  // Expose the module's internals the way the page reaches them.
  w.eval(SELECTOR);
  const steps = w.WorkflowProgress.STEPS;
  // The REAL allowlist, not a restatement of it. An earlier draft of this file
  // re-implemented the rule here and would have passed while the shipped
  // function was broken — the same mention-vs-usage gap this repo keeps
  // finding in its own guards.
  assert.ok(w.JurisdictionSelector && typeof w.JurisdictionSelector.returnTarget === 'function',
    'jurisdiction-selector.js no longer exposes returnTarget, so this guard cannot test it');
  const allowed = w.JurisdictionSelector.returnTarget();
  return { allowed, window: w, steps };
}

console.log('jurisdiction-return-trip');

test('the allowlist FOLLOWS the rail, rather than restating it', () => {
  // A parallel list is how the step sequence drifted before (#1838). Checking
  // the source for a hard-coded array only catches the spellings you thought
  // of — an earlier version of this test looked for `next === '...'` and
  // missed `raw === '...'`. So move the rail instead and see if the allowlist
  // moves with it. A copy cannot follow.
  const { window: w } = resolveNext('?next=deal-calculator.html');
  const real = w.WorkflowProgress.STEPS;

  // Remove the deal calculator from the rail: it must stop being accepted.
  w.WorkflowProgress.STEPS = real.filter((s) => s.href !== 'deal-calculator.html');
  assert.strictEqual(w.JurisdictionSelector.returnTarget(), null,
    'deal-calculator.html is still accepted after the rail dropped it — the allowlist is a '
    + 'hard-coded copy, not a read of workflow-progress.js STEPS');

  // Put it back under a different filename: that one must now be accepted.
  w.WorkflowProgress.STEPS = real.concat([{ num: 99, key: 'probe', label: 'Probe', href: 'deal-calculator.html' }]);
  assert.strictEqual(w.JurisdictionSelector.returnTarget(), 'deal-calculator.html',
    'a page the rail carries is not accepted; the allowlist is not reading the rail');

  w.WorkflowProgress.STEPS = real;
});

test('the destination flows from the rail, not from the URL', () => {
  // A PROVENANCE check, and deliberately a source-level one: returning the
  // query string instead of the rail's own href is behaviourally identical,
  // so no runtime assertion can tell them apart. The difference is that only
  // one of them can be shown — to a reader or to CodeQL, which flagged the
  // first version high severity — never to put a user-supplied string into
  // location.href. `next` selects a known destination; it never becomes one.
  const fn = /function returnTarget\(\)[\s\S]*?\n  \}/.exec(SELECTOR);
  assert.ok(fn, 'returnTarget() is gone or no longer matchable');
  assert.ok(/return steps\[i\]\.href;/.test(fn[0]),
    'returnTarget no longer returns the rail\'s own href');
  assert.ok(!/return raw;/.test(fn[0]),
    'returnTarget returns the string from the URL again; equal in behaviour, but it puts a '
    + 'query parameter into location.href and reopens the redirect finding');
});

test('a guided-path page is accepted', () => {
  const { allowed, steps } = resolveNext('?next=deal-calculator.html');
  assert.ok(steps.some((s) => s.href === 'deal-calculator.html'),
    'deal-calculator.html is not on the rail; this probe proves nothing');
  assert.strictEqual(allowed, 'deal-calculator.html');
});

test('an off-path page is refused', () => {
  assert.strictEqual(resolveNext('?next=lihtc-guide.html').allowed, null);
});

test('select-jurisdiction itself is refused — it would loop', () => {
  assert.strictEqual(resolveNext('?next=select-jurisdiction.html').allowed, null);
});

test('absolute URLs are refused — this is not an open redirect', () => {
  for (const hostile of [
    'https://example.com/evil',
    '//example.com/evil',
    'http://localhost/deal-calculator.html',
    'javascript:alert(1)',
    '/deal-calculator.html',
    '../deal-calculator.html',
    'deal-calculator.html/../../evil'
  ]) {
    assert.strictEqual(resolveNext('?next=' + encodeURIComponent(hostile)).allowed, null,
      `'${hostile}' was accepted as a redirect target`);
  }
});

test('no next means the normal route', () => {
  assert.strictEqual(resolveNext('').allowed, null);
});

test('the button names the destination it actually opens', () => {
  const { window: w } = resolveNext('?next=deal-calculator.html');
  const label = w.WorkflowNextAction.steps().labels.deal;
  assert.ok(label && /Deal Calculator/.test(label),
    `step 'deal' resolves to '${label}', so a button built from it would not name the page`);
  assert.ok(!/Housing Needs Assessment/.test(label),
    'the deal step is labelled as the needs assessment');
});

test('and the allowlist would actually notice', () => {
  // Every case above is a constant, so they pass whether or not the matching
  // works. Prove the rail comparison is what decides.
  const { steps } = resolveNext('');
  const hrefs = steps.map((s) => s.href);
  assert.ok(hrefs.some((h) => h === 'deal-calculator.html'), 'the rail lost the deal calculator');
  // The property that makes the allowlist safe: every rail href is a bare
  // relative filename. If one were ever absolute, matching it would hand
  // location.href another origin. Checked by SHAPE rather than by looking for
  // one known-bad string — searching for a URL substring is both weaker and
  // what CodeQL flags as incomplete sanitisation.
  for (const href of hrefs) {
    assert.ok(/^[\w.-]+\.html$/.test(href),
      `the rail carries '${href}', which is not a bare relative page; the allowlist would `
      + 'pass a non-local destination through to location.href');
  }
});

console.log(failures === 0
  ? '  jurisdiction-return-trip: PASS'
  : `  jurisdiction-return-trip: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
