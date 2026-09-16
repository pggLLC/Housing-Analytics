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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'a11y-audit.mjs'), 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('a11y-audit-never-silently-skips');

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

/* ── behavioural ─────────────────────────────────────────────────────────── */

test('an unaudited page really does fail the run', () => {
  // The assertions above read the source. This one runs it: a page that cannot
  // be loaded must exit non-zero and say which page and why.
  const out = spawnSync('node', [
    'scripts/audit/a11y-audit.mjs', '--page', '__no_such_page__.html', '--json-only', '--quiet',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });

  if (/Executable doesn't exist|playwright install/i.test((out.stderr || '') + (out.stdout || ''))) {
    // No browser in this environment. Say so rather than passing quietly —
    // an unrunnable check reporting success is the defect under test.
    throw new Error('playwright chromium is not installed, so this assertion could not run. '
      + 'Run: npx playwright install chromium');
  }
  assert.strictEqual(out.status, 1,
    `a page that could not be audited exited ${out.status}; it must be non-zero`);
  assert.match(out.stderr || '', /could not be audited/,
    'the failure does not name what went wrong');
  assert.match(out.stderr || '', /__no_such_page__\.html/,
    'the failure does not name the page');
});

test('a single-page probe does not overwrite the site baseline', () => {
  // Writing this test is what exposed it: the probe above replaced
  // data/reports/a11y-baseline.json with a one-page result, leaving a
  // committable file claiming the site is one page long. Debugging one page
  // must not rewrite the record of the other twenty.
  const baselinePath = path.join(ROOT, 'data', 'reports', 'a11y-baseline.json');
  const before = fs.readFileSync(baselinePath, 'utf8');
  const out = spawnSync('node', [
    'scripts/audit/a11y-audit.mjs', '--page', '__no_such_page__.html', '--json-only', '--quiet',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
  if (/Executable doesn't exist|playwright install/i.test((out.stderr || '') + (out.stdout || ''))) {
    throw new Error('playwright chromium is not installed, so this assertion could not run. '
      + 'Run: npx playwright install chromium');
  }
  const after = fs.readFileSync(baselinePath, 'utf8');
  assert.strictEqual(after, before,
    'a --page probe rewrote data/reports/a11y-baseline.json; the site baseline is '
    + 'now a one-page file and would be committed as one');
  assert.ok(/singlePage/.test(SRC), 'the single-page guard is gone from the audit');
});

console.log(failures === 0
  ? '  a11y-audit-never-silently-skips: PASS'
  : `  a11y-audit-never-silently-skips: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
