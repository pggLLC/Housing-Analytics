#!/usr/bin/env node
/**
 * test-reachability — a test file that never runs is not a test.
 *
 * Audited 2026-09-14: 52 of 230 test files never executed in CI. 47 had no npm
 * script at all; 5 had one that `test:ci` never called. `test/acs-etl.test.js`
 * alone carries 170 assertions and had never run. Nothing was broken-looking --
 * the suite reported green the whole time, because the unrun files were not
 * part of what "green" measured.
 *
 * That is the same shape as the other defects found this week: alert.js never
 * had a token and never opened an issue in the repo's history; the cancellation
 * branch of notify-workflow-outcome is correct code the runner kills before it
 * can execute. In each case something reported a state it never verified.
 *
 * Every test file must therefore be reachable one of three ways:
 *   1. named by an npm script that `test:ci` runs;
 *   2. picked up by test/unwired-suite.test.js, which discovers its own list;
 *   3. listed in that runner's QUARANTINE with a reason.
 *
 * (3) is deliberately uncomfortable: the reason is printed on every CI run and
 * asserted non-trivial here, so a quarantined file is visible rather than
 * forgotten. Fixing the file and deleting its entry is the intended exit.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const suite = require('./unwired-suite.test.js');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };

console.log('\ntest-reachability');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const ci = ' ' + (scripts['test:ci'] || '') + ' ';

const all = suite.discoverAll();
if (all.length < 100) {
  fail(`found only ${all.length} test files — discovery has probably drifted and this `
     + `guard would pass vacuously`);
}

// The runner itself must be wired into test:ci, or routes 2 and 3 mean nothing.
const runnerScript = Object.entries(scripts)
  .find(([, v]) => typeof v === 'string' && v.includes(suite.SELF));
if (!runnerScript) {
  fail(`test/${suite.SELF} has no npm script — the discovered suite would never run`);
} else if (!ci.includes(`npm run ${runnerScript[0]} `)) {
  fail(`"${runnerScript[0]}" is not in test:ci — the discovered suite would never run`);
}

const { run, quarantined } = suite.partition();
const runnable = new Set(run);
const quarantineSet = new Set(quarantined);

for (const f of all) {
  if (f === suite.SELF) continue;
  if (runnable.has(f) || quarantineSet.has(f)) continue;   // routes 2 and 3

  // Route 1: named by a script — but that script must actually be in test:ci.
  const owners = Object.entries(scripts)
    .filter(([, v]) => typeof v === 'string' && v.includes(f))
    .map(([k]) => k);
  if (!owners.length) {
    fail(`test/${f} is unreachable: no npm script names it and the discovered suite skips it`);
    continue;
  }
  if (!owners.some((k) => ci.includes(`npm run ${k} `))) {
    fail(`test/${f} has script(s) ${owners.map((o) => `"${o}"`).join(', ')} but none is in `
       + `test:ci — it is defined and still never runs`);
  }
}

// A quarantine entry without a real reason is just a disabled test.
for (const [file, reason] of Object.entries(suite.QUARANTINE)) {
  if (!fs.existsSync(path.join(ROOT, 'test', file))) {
    fail(`QUARANTINE lists test/${file}, which does not exist — delete the entry`);
  }
  if (!reason || reason.trim().length < 25) {
    fail(`QUARANTINE entry for ${file} needs a reason someone can act on, got: ${JSON.stringify(reason)}`);
  }
}

if (failures) {
  console.error(`\ntest-reachability: FAIL (${failures})`);
  process.exit(1);
}
console.log(`  ✓ all ${all.length} test files reachable `
  + `(${run.length} via the discovered suite, ${quarantined.length} quarantined with reasons)`);
console.log('test-reachability: PASS');
