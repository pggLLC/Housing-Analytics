#!/usr/bin/env node
/**
 * An accessibility audit must not answer differently for identical code, and
 * must never report a page it never looked at as clean.
 *
 * Two runs of commit e7df0d0cc on 2026-09-16 disagreed — one passed, one
 * failed — because Chromium dropped the tab on deal-calculator.html (219 form
 * inputs, the heaviest page in the set) and the rejection escaped auditPage(),
 * killing the run. What people learn from a gate like that is to ignore a red
 * axe, which is exactly what happened: PR #1707 was merged with it failing.
 *
 * Reading the code to fix that turned up the worse half. summarize() did
 * `if (r.error) continue`, so a page that failed to LOAD contributed nothing
 * and the audit exited 0 — reporting "no accessibility problems" about a page
 * it never opened. The noisy bug was random failure; the quiet one was random
 * success.
 *
 * Three states now, and they are not interchangeable: violations found, clean,
 * and UNAUDITED.
 */

import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'a11y-audit.mjs'), 'utf8');

let failures = 0;
let skipped  = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const skip = (m) => { skipped += 1; console.log(`  ~ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

/**
 * A browser-dependent assertion, in a repo whose main test lane has no browser.
 *
 * ci-checks does not install playwright; only .github/workflows/a11y-audit.yml
 * does. The first version of these threw when the browser was missing, which
 * was right in spirit — an unrunnable check reporting success is the defect
 * under test — and wrong in placement: it failed ci-checks for the absence of
 * something ci-checks never had.
 *
 * So they SKIP, visibly, and never count as passing. That is only honest
 * because "runs somewhere else" is itself asserted below: the a11y-audit
 * workflow must invoke this file. Skipped-here plus unrun-everywhere would be
 * the same silent pass this whole file exists to prevent.
 */
const CANNOT_RUN = 'the audit cannot run in this environment';

/**
 * Why the audit could not run here — or null if it ran.
 *
 * This used to look only for a missing browser. A missing `axe-core` produces
 * a completely different message, fell through the check, and surfaced as
 * "the failure does not name what went wrong" — which reads as a defect in the
 * audit's error handling rather than "this lane has no dependencies". A guard
 * built to stop an unrunnable check reporting misleadingly had that exact
 * blind spot, one dependency over.
 *
 * A missing dependency is only an ENVIRONMENT problem when nothing is
 * installed. In a populated node_modules, `axe-core` going missing is a real
 * defect — the audit's own dependency removed — and must fail rather than
 * skip. That distinction is the point of checking the directory.
 */
function unrunnableReason(output, root = ROOT) {
  if (/Executable doesn't exist|playwright install/i.test(output)) {
    return 'playwright chromium is not installed — run: npx playwright install chromium';
  }
  const missingModule = /([\w@/-]+) not found in node_modules|Cannot find module '([^']+)'/i.exec(output);
  if (missingModule) {
    const name = missingModule[1] || missingModule[2];
    let installed = 0;
    try { installed = fs.readdirSync(path.join(root, 'node_modules')).length; } catch { installed = 0; }
    if (installed === 0) return `dependencies are not installed (${name} is missing) — run: npm ci`;
    // node_modules exists and is populated, so this is not an empty lane.
    return null;
  }
  return null;
}

const browserTest = (name, fn) => {
  try { fn(); pass(name); } catch (e) {
    if (e.message.startsWith(CANNOT_RUN)) {
      skip(`${name} — SKIPPED: ${e.message.slice(CANNOT_RUN.length + 2)}; runs in a11y-audit.yml`);
      return;
    }
    fail(`${name} — ${e.message}`);
  }
};

console.log('a11y-audit-never-silently-skips');

test('an unrunnable lane is told apart from a broken audit', () => {
  // The detector itself, exercised directly — the branch it guards only fires
  // when a dependency is genuinely absent, so running the suite in a healthy
  // environment never reaches it. Left untested it regressed silently once
  // already: it knew one way to be unrunnable and reported every other way as
  // a defect in the audit.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-guard-'));
  const bare = path.join(tmp, 'bare');
  const stocked = path.join(tmp, 'stocked');
  fs.mkdirSync(bare, { recursive: true });
  fs.mkdirSync(path.join(stocked, 'node_modules', 'anything'), { recursive: true });
  try {
    const MISSING_AXE = 'axe-core not found in node_modules. Run `npm ci`.';

    // Each reason carries the command that un-skips it. A skip that does not
    // say how to stop skipping is how a lane stays unrunnable indefinitely.
    assert.match(unrunnableReason("Executable doesn't exist at /ms-playwright/chromium", stocked) || '',
      /playwright chromium is not installed .* npx playwright install chromium/,
      'a missing browser is no longer recognised, or no longer says how to fix it');

    // The case this fix is for: nothing installed at all.
    assert.match(unrunnableReason(MISSING_AXE, bare) || '',
      /dependencies are not installed \(axe-core is missing\) .* npm ci/,
      'a lane with no node_modules still reports a missing dependency as an audit defect');
    assert.match(unrunnableReason("Cannot find module 'playwright'", bare) || '',
      /dependencies are not installed/,
      'only axe-core is recognised; any missing module means the lane is not set up');

    // And the distinction that keeps this honest: with dependencies present, a
    // missing one is a REAL defect and must fail rather than skip.
    assert.strictEqual(unrunnableReason(MISSING_AXE, stocked), null,
      'axe-core going missing from a populated node_modules is the audit losing its '
      + 'own dependency — that must fail, not skip');

    // Ordinary output must never be mistaken for an unrunnable lane.
    assert.strictEqual(unrunnableReason('62 pages audited, 0 violations', stocked), null);
    assert.strictEqual(unrunnableReason('3 pages could not be audited: foo.html', stocked), null,
      'a genuine audit failure was swallowed as an environment problem');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a page that cannot be audited is counted, not skipped', () => {
  assert.ok(/const unaudited = results\.filter\(r => r\.error\)/.test(SRC),
    'summarize() no longer tracks unaudited pages — a page that fails to load '
    + 'would again contribute nothing and produce a clean summary');
  assert.ok(/unaudited,/.test(SRC), 'the unaudited list is not returned in the summary');
  assert.ok(/auditedCount/.test(SRC), 'the audited count is gone, so nobody can see the denominator');
});

test('the run exits non-zero when a page was never looked at', () => {
  assert.ok(/if \(summary\.unaudited\.length > 0\)/.test(SRC),
    'unaudited pages no longer fail the run');
  const at = SRC.indexOf('if (summary.unaudited.length > 0)');
  const block = SRC.slice(at, at + 900);
  assert.ok(/process\.exit\(1\)/.test(block), 'the unaudited branch does not exit non-zero');
  assert.ok(/not a clean result and not a violation/.test(block),
    'the failure message does not distinguish "never audited" from "has violations" — '
    + 'a red axe should mean one specific thing');
});

test('a crash in one page cannot take down the run', () => {
  // goto, addScriptTag and evaluate must all be inside the same try. Only goto
  // was, which is why a crashed tab killed the audit.
  const at = SRC.indexOf('async function auditPage');
  const fn = SRC.slice(at, SRC.indexOf('\nfunction summarize', at));
  const tryAt = fn.indexOf('try {');
  const catchAt = fn.indexOf('} catch (err) {');
  assert.ok(tryAt >= 0 && catchAt > tryAt, 'auditPage has no try/catch around the audit');
  const guarded = fn.slice(tryAt, catchAt);
  for (const call of ['page.goto(', 'page.addScriptTag(', 'page.evaluate(']) {
    assert.ok(guarded.includes(call),
      `${call} is outside the try block; a failure there escapes auditPage and kills the run`);
  }
});

test('the browser context is released even when the page crashes', () => {
  // It was closed only on the success path, so every crash leaked a context
  // for the remaining pages to compete with — the likeliest reason the LAST
  // page of a 21-page run is the one that dies.
  const at = SRC.indexOf('async function auditPage');
  const fn = SRC.slice(at, SRC.indexOf('\nfunction summarize', at));
  assert.ok(/} finally \{[\s\S]{0,120}context\.close\(\)/.test(fn),
    'the context is not closed in a finally; a crash leaks it');
});

test('a transient crash is retried once, and a real failure still fails', () => {
  assert.ok(/if \(r\.error\) \{[\s\S]{0,320}auditPage\(browser, p, axeScript\)/.test(SRC),
    'the single retry is gone');
  // The retry must not loop, or a genuinely broken page hangs the run.
  const at = SRC.indexOf('let r = await auditPage');
  const block = SRC.slice(at, at + 500);
  const attempts = (block.match(/auditPage\(/g) || []).length;
  assert.strictEqual(attempts, 2, `the retry runs auditPage ${attempts} times; it should be exactly two attempts`);
});

test('the browser-dependent half actually runs somewhere', () => {
  // Skipping for lack of a browser is only acceptable if a lane that HAS one
  // runs this file. Without this, the two assertions below could be skipped in
  // every lane forever and the suite would report PASS — which is precisely
  // the silent pass this file exists to prevent, reproduced one level up.
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'a11y-audit.yml'), 'utf8');
  assert.ok(/playwright install/.test(wf),
    'a11y-audit.yml no longer installs a browser, so nothing can run the behavioural half');
  assert.ok(/a11y-audit-never-silently-skips\.test\.mjs/.test(wf),
    'a11y-audit.yml does not run this test. It is the only lane with a browser, so '
    + 'the behavioural assertions would be skipped everywhere and never executed.');
});

/* ── behavioural ─────────────────────────────────────────────────────────── */

browserTest('an unaudited page really does fail the run', () => {
  // The assertions above read the source. This one runs it: a page that cannot
  // be loaded must exit non-zero and say which page and why.
  const out = spawnSync('node', [
    'scripts/audit/a11y-audit.mjs', '--page', '__no_such_page__.html', '--json-only', '--quiet',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });

  const why = unrunnableReason((out.stderr || '') + (out.stdout || ''));
  if (why) {
    // Say what is missing rather than passing quietly, and rather than
    // failing with a message about the audit that is not about the audit —
    // an unrunnable check reporting either is the defect under test.
    throw new Error(`${CANNOT_RUN}: ${why}`);
  }
  assert.strictEqual(out.status, 1,
    `a page that could not be audited exited ${out.status}; it must be non-zero`);
  assert.match(out.stderr || '', /could not be audited/,
    'the failure does not name what went wrong');
  assert.match(out.stderr || '', /__no_such_page__\.html/,
    'the failure does not name the page');
});

browserTest('a single-page probe does not overwrite the site baseline', () => {
  // Writing this test is what exposed it: the probe above replaced
  // data/reports/a11y-baseline.json with a one-page result, leaving a
  // committable file claiming the site is one page long. Debugging one page
  // must not rewrite the record of the other twenty.
  const baselinePath = path.join(ROOT, 'data', 'reports', 'a11y-baseline.json');
  const before = fs.readFileSync(baselinePath, 'utf8');
  const out = spawnSync('node', [
    'scripts/audit/a11y-audit.mjs', '--page', '__no_such_page__.html', '--json-only', '--quiet',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
  const why = unrunnableReason((out.stderr || '') + (out.stdout || ''));
  if (why) {
    // Say what is missing rather than passing quietly, and rather than
    // failing with a message about the audit that is not about the audit —
    // an unrunnable check reporting either is the defect under test.
    throw new Error(`${CANNOT_RUN}: ${why}`);
  }
  const after = fs.readFileSync(baselinePath, 'utf8');
  assert.strictEqual(after, before,
    'a --page probe rewrote data/reports/a11y-baseline.json; the site baseline is '
    + 'now a one-page file and would be committed as one');
  assert.ok(/singlePage/.test(SRC), 'the single-page guard is gone from the audit');
});

console.log(failures === 0
  ? `  a11y-audit-never-silently-skips: PASS${skipped ? ` (${skipped} skipped — no browser in this lane)` : ''}`
  : `  a11y-audit-never-silently-skips: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
