#!/usr/bin/env node
/**
 * Every registered guard either runs in CI, or says why it does not.
 *
 * ── What was wrong (#1756) ──
 *
 * A guard could be dropped from test:ci and nothing noticed. Removing
 * `npm run test:notify-cancelled` from a CI group was missed by all three
 * guards that exist to catch exactly that:
 *
 *   test:gate-order        asserts the flattened step count is > 200. Dropping
 *                          one takes 213 -> 212. It is a floor against the
 *                          list being EMPTIED, not against it losing an entry.
 *   test:unwired-suite     RUNS the files it finds unwired and fails only if
 *                          one of them fails. A dropped guard is still
 *                          discovered, still executed, still passes — so the
 *                          suite reports success while the guard is no longer
 *                          part of CI's actual gate. It measures "does this
 *                          file pass", not "is this file wired".
 *   test:test-reachability inherits the same blind spot.
 *
 * It is not hypothetical: between #1752 and #1753 both edited the single
 * 7,595-character test:ci line, and resolving the conflict dropped one of the
 * two new guards. A human reading the merge caught it, not the suite.
 *
 * ── What counts as "runs in CI" ──
 *
 * Two ways, and counting only the first is why #1756 reported nine unwired
 * scripts when four of them were running the whole time:
 *
 *   1. Reachable by following `npm run` from a script a workflow invokes.
 *   2. The workflow runs the guard's FILE directly. contrast-audit.yml,
 *      deploy.yml and rebuild-bps-permits.yml all do this, because those
 *      guards need setup (a browser, a built site) that the ci-checks chain
 *      deliberately does not do.
 *
 * A guard covered either way is running. Requiring a declaration for one that
 * already runs is how an exemption list turns into a dumping ground (#1746).
 *
 * A THIRD form exists and deliberately does NOT count: a guard's file appended
 * to another script's command line. test:hna-provenance-disclosure used to end
 * with `&& node test/hna-chas-vintage-disclosure.test.js`, so the CHAS
 * disclosure guard ran in CI under a name that was not its own — invisible to
 * `npm run test:hna-chas-vintage-disclosure`, and silently dropped if anyone
 * edited the other script. That chain was removed and the guard wired
 * explicitly. Counting such chains as "wired" would bless the hiding place;
 * failing on them says make it explicit, which is the repair.
 *
 * ── The ledger ──
 *
 * Whatever is left must appear in NOT_IN_CI with a reason. A tenth undeclared
 * script breaks the build. A declaration for a script that IS covered must be
 * removed, so the list cannot accumulate stale entries, and a declaration for
 * a script that no longer exists must be removed too.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const { reachableFrom } = require_(path.join(ROOT, 'test/helpers/ci-wiring.js'));
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

/**
 * Guards that do NOT run in CI, each with the reason. Adding a line here is a
 * recorded decision, not a way to silence this test — anything listed is a
 * guard the repo has agreed is not protecting main.
 */
const NOT_IN_CI = {
  'test:all': {
    why: 'an entry point, not a guard: it runs test:ci plus extra smokes and pytest, '
       + 'for a maintainer who wants everything in one command. Wiring it into CI '
       + 'would make CI invoke itself.',
  },
  'test:qa-recent': {
    why: 'a dated one-off harness written for the Codex handover of PRs #881-#890 '
       + '(May 2026). It needs puppeteer and live source URLs, so it is neither '
       + 'hermetic nor current; it is kept as a manual reviewer tool.',
  },
  'test:rendered-mobile-overflow': {
    why: 'a local convenience wrapper that skips loudly when no Playwright browser '
       + 'is installed. The real enforcement DOES run in CI — site-audit.yml '
       + 'installs Chromium and runs scripts/audit/core-rendered-smoke.mjs — and '
       + 'the ci-checks chain deliberately avoids installing a browser.',
  },
};

/** Scripts a workflow invokes with `npm run`, expanded through the npm graph. */
function ciReachable() {
  const dir = path.join(ROOT, '.github/workflows');
  const roots = new Set();
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/npm run ([\w:.-]+)/g)) {
      if (scripts[m[1]]) roots.add(m[1]);
    }
  }
  const seen = new Set();
  for (const r of roots) {
    seen.add(r);
    for (const s of reachableFrom(scripts, r)) seen.add(s);
  }
  return { roots, seen };
}

/** Repo-relative file paths a script's command line runs. */
function filesRunBy(command) {
  return [...String(command).matchAll(/(?:^|\s)((?:test|scripts|tests)\/[\w./-]+\.(?:mjs|js|cjs|py))/g)]
    .map((m) => m[1]);
}

/** Guards whose FILE a workflow runs directly, bypassing npm. */
function directlyInvoked(testScripts) {
  const dir = path.join(ROOT, '.github/workflows');
  const blob = fs.readdirSync(dir)
    .filter((n) => /\.ya?ml$/.test(n))
    .map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))
    .join('\n');
  const out = new Map();
  for (const name of testScripts) {
    const files = filesRunBy(scripts[name]);
    // Exactly one file, or this is an aggregate rather than a guard. test:all
    // runs a dozen files and several of them appear in workflows under OTHER
    // scripts, which would otherwise mark the aggregate itself as "running in
    // CI" when nothing invokes it at all.
    if (files.length !== 1) continue;
    // Match the path as written, so scripts/audit/run.js cannot be satisfied
    // by some other run.js elsewhere in a workflow.
    if (blob.includes(files[0])) out.set(name, files[0]);
  }
  return out;
}

const TEST_SCRIPTS = Object.keys(scripts).filter((k) => k.startsWith('test:'));
const { roots, seen } = ciReachable();
const direct = directlyInvoked(TEST_SCRIPTS);
const covered = (name) => seen.has(name) || direct.has(name);

test('the measurement itself found something to measure', () => {
  // Without these floors every later assertion passes vacuously: an empty
  // roots set makes nothing reachable, and an empty script list makes
  // "every guard is covered" trivially true.
  assert.ok(roots.size >= 5, `only ${roots.size} CI roots found — the workflow scan is broken`);
  assert.ok(TEST_SCRIPTS.length >= 200, `only ${TEST_SCRIPTS.length} test:* scripts found`);
  assert.ok(seen.size >= 200, `only ${seen.size} scripts reachable — the npm graph walk is broken`);
});

test('every guard either runs in CI or is declared with a reason', () => {
  const undeclared = TEST_SCRIPTS.filter((n) => !covered(n) && !NOT_IN_CI[n]);
  assert.deepEqual(undeclared, [],
    'these guards run nowhere and say nothing about why:\n' +
    undeclared.map((n) => `  ${n}  ->  ${scripts[n]}`).join('\n') +
    '\n\nEither wire it into a ci:part-N group, or add it to NOT_IN_CI with the reason. ' +
    'A guard that runs nowhere is not protecting anything, and reads in package.json ' +
    'exactly like one that is.');
});

test('a declaration is removed once its guard runs in CI', () => {
  const stale = Object.keys(NOT_IN_CI).filter((n) => covered(n));
  assert.deepEqual(stale, [],
    `these are declared "not in CI" but they do run:\n` +
    stale.map((n) => `  ${n}${direct.has(n) ? ' (workflow runs ' + direct.get(n) + ')' : ' (reachable via npm run)'}`).join('\n') +
    '\n\nDrop them from NOT_IN_CI — a stale exemption is how the list becomes a dumping ground.');
});

test('a declaration is removed once its guard is gone', () => {
  const orphans = Object.keys(NOT_IN_CI).filter((n) => !scripts[n]);
  assert.deepEqual(orphans, [], `NOT_IN_CI names scripts that no longer exist: ${orphans.join(', ')}`);
});

test('every declaration actually states a reason', () => {
  for (const [name, entry] of Object.entries(NOT_IN_CI)) {
    assert.ok(entry && typeof entry.why === 'string' && entry.why.trim().length >= 40,
      `${name} is declared without a real reason — "why" must say what it is and why CI does not run it`);
  }
});
