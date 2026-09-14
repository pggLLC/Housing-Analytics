#!/usr/bin/env node
/**
 * test-reachability — a test file that never runs is not a test.
 *
 * 72 of this repo's test files had no route to CI when this was written.
 * test/acs-etl.test.js alone carries 170 assertions and had never executed.
 * Nothing looked wrong: the suite reported green, because the unrun files were
 * not part of what "green" measured.
 *
 * Every IN-SCOPE test file (scope declared in unwired-suite.test.js, and
 * asserted below) must be reachable one of three ways:
 *   1. invoked by a script that CI starts, directly or through nested npm run;
 *   2. executed by test/unwired-suite.test.js, which discovers its own list;
 *   3. listed in that runner's QUARANTINE with a reason, an issue and a date.
 *
 * Three things this guard learned the hard way, each now asserted:
 *   - Substring matching let xss-hmda-lookup.test.js "reach" hmda-lookup.test.js,
 *     so a real test was excluded from the runner AND passed the gate.
 *   - test:ci is not the only CI root; ci-checks.yml runs test:smoke separately,
 *     and requiring a direct test:ci entry produced duplicate wiring.
 *   - Discovery that finds nothing passes vacuously, so every count has a floor.
 */
const fs = require('fs');
const path = require('path');
const suite = require('./unwired-suite.test.js');

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };

console.log('\ntest-reachability');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const inScope = suite.discoverAll();

/* ── vacuous-pass floors ───────────────────────────────────────────────── */

if (inScope.length < 200) {
  fail(`discovery found only ${inScope.length} in-scope test files — the scope patterns have `
     + `probably drifted and every check below would pass vacuously`);
}
const roots = suite.ciRoots(scripts);
if (!roots.has('test:ci')) {
  fail('test:ci is not detected as a CI root — reachability would be computed from nothing');
}
if (roots.size < 2) {
  fail(`only ${roots.size} CI root(s) detected; ci-checks.yml alone starts more than one, so `
     + `workflow scanning has probably broken`);
}

/* ── the runner itself must be wired, or routes 2 and 3 mean nothing ───── */

const reachable = suite.reachableScripts(scripts);
const runnerOwners = suite.wiredScriptsFor(suite.SELF, scripts, reachable);
if (!runnerOwners.length) {
  fail(`test/${suite.SELF} is not invoked by any script CI starts — the discovered suite `
     + `would never run`);
}

/* ── exact-path matching, not substring ────────────────────────────────── */

// Guard the property directly: a filename that is a suffix of another must not
// be considered invoked by the script that runs the longer one.
const collisionProbe = suite.invokesExactly('node test/xss-hmda-lookup.test.js', 'hmda-lookup.test.js');
if (collisionProbe) {
  fail('invokesExactly() matches on substrings — "xss-hmda-lookup.test.js" counts as invoking '
     + '"hmda-lookup.test.js", which silently excludes a real test while reporting it reached');
}

/* ── every in-scope file is reachable ──────────────────────────────────── */

const { directlyWired, transitivelyWired, run, quarantined } = suite.partition();
const accounted = new Set([...directlyWired, ...transitivelyWired, ...run, ...quarantined, suite.SELF]);
for (const rel of inScope) {
  if (!accounted.has(rel)) {
    fail(`test/${rel} is unreachable: no CI-reachable script invokes it, the discovered suite `
       + `skips it, and it is not quarantined`);
  }
}

// A script that CI never starts is not a route. Flag tests whose only owner is orphaned.
const allScriptNames = Object.keys(scripts);
for (const rel of run) {
  const orphans = allScriptNames.filter((k) => suite.invokesExactly(scripts[k], rel) && !reachable.has(k));
  if (orphans.length) {
    console.log(`  · test/${rel} has script(s) ${orphans.map((o) => `"${o}"`).join(', ')} that no CI `
      + `workflow starts — the discovered suite runs it instead`);
  }
}

/* ── quarantine hygiene ────────────────────────────────────────────────── */

const MAX_QUARANTINE = 0;   // raise deliberately, in a reviewed diff, never by drift
const qEntries = Object.entries(suite.QUARANTINE);
if (qEntries.length > MAX_QUARANTINE) {
  fail(`${qEntries.length} quarantined test(s) but MAX_QUARANTINE is ${MAX_QUARANTINE}. `
     + `Quarantining is allowed, growing the quarantine silently is not — raise the ceiling in `
     + `the same diff so it shows up in review.`);
}
for (const [rel, q] of qEntries) {
  if (!fs.existsSync(path.join(ROOT, 'test', rel))) {
    fail(`QUARANTINE lists test/${rel}, which does not exist — delete the entry`);
  }
  if (!q || typeof q !== 'object') {
    fail(`QUARANTINE entry for ${rel} must be an object with { reason, issue, since }`);
    continue;
  }
  if (!q.reason || String(q.reason).trim().length < 25) {
    fail(`QUARANTINE ${rel}: needs a reason someone can act on, got ${JSON.stringify(q.reason)}`);
  }
  if (!Number.isInteger(q.issue) || q.issue <= 0) {
    fail(`QUARANTINE ${rel}: needs a follow-up issue number, got ${JSON.stringify(q.issue)}. `
       + `A quarantine with no issue is a test nobody has agreed to fix.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(q.since || ''))) {
    fail(`QUARANTINE ${rel}: needs a "since" date as YYYY-MM-DD, got ${JSON.stringify(q.since)}`);
  }
}

/* ── declared scope must be honest ─────────────────────────────────────── */

const excluded = suite.excludedByScope();
for (const g of excluded) {
  if (!g.reason || String(g.reason).trim().length < 25) {
    fail(`scope exclusion "${g.label}" needs a stated reason`);
  }
}
const excludedCount = excluded.reduce((n, g) => n + g.files.length, 0);

if (failures) {
  console.error(`\ntest-reachability: FAIL (${failures})`);
  process.exit(1);
}
console.log(`  ✓ ${inScope.length} in-scope test files all reachable`);
console.log(`      directly wired ${directlyWired.length} · transitively wired ${transitivelyWired.length} `
  + `· discovered ${run.length} · quarantined ${quarantined.length}`);
console.log(`  ✓ ${excludedCount} file(s) excluded by declared scope, each with a stated reason`);
console.log(`  ✓ reachability computed from ${roots.size} CI roots, through nested npm run calls`);
console.log(`  ✓ exact-path matching: a filename cannot be reached by being a suffix of another`);
console.log('test-reachability: PASS');
