#!/usr/bin/env node
/**
 * unwired-suite — run every test file that no npm script names.
 *
 * 52 of 230 test files never executed in CI. They were not deleted and not
 * disabled; they simply had no npm script, so nothing ran them and nothing
 * said so. `test/acs-etl.test.js` alone carries 170 assertions and had never
 * run once. Predictably, several rotted: `hna-rent-burden-bins` is 17 passed
 * and 1 failed, `co-lihtc-map` 32 and 1 -- single stale assertions against code
 * that moved on, invisible because nothing was watching.
 *
 * The wiring itself was the cause. `test:ci` is a 181-step, 6,500-character
 * single-line `&&` chain, so adding a test means editing that line, and the
 * path of least resistance is to write the file and skip the wiring. Adding 34
 * more entries would make that worse. This runner is ONE entry that discovers
 * its own contents, so a new test file is picked up by existing it.
 *
 * Pairs with test/test-reachability.test.js, which fails if any test file is
 * neither named by an npm script, nor picked up here, nor quarantined below.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/**
 * Known-failing files, with the reason. Quarantine is deliberately noisy: the
 * list is printed on every run and the reachability gate requires a non-empty
 * reason for each entry, so an item cannot sit here quietly. Removing an entry
 * is the fix; adding one needs a reason someone will read.
 */
const QUARANTINE = {
  // Empty, and that is the intended resting state. Thirteen entries lived here
  // when this runner was introduced; all thirteen were fixed rather than left
  // to sit. Twelve were stale assertions -- pinned field names, call shapes,
  // parameter counts and markup that had moved on while nothing ran them. One
  // (co-historical-allocations) turned out to be a real inconsistency: the
  // dataset declared six fields in fieldDefinitions that no entry has ever
  // carried, and the generator preserved that declaration verbatim on every
  // refresh, so it outlived whatever wrote it.
  //
  // Adding an entry is allowed but deliberately uncomfortable: the reason is
  // printed on every CI run and test-reachability asserts it is substantive.
  // Deleting the entry is the exit.
};

/**
 * Every test file under test/, at any depth, as a path relative to test/.
 *
 * This read test/ non-recursively when it was written, which missed the seven
 * files in test/integration/ -- none of them wired to an npm script either. The
 * guard could not see the directory it was supposed to be guarding, so the
 * original "52 unreachable" count was itself short by seven. Recursion is the
 * fix; the vacuous-pass floor in test-reachability is what would eventually
 * have caught a regression here.
 */
function discoverAll(dir, prefix) {
  const base = dir || path.join(ROOT, 'test');
  const pre = prefix || '';
  const out = [];
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      out.push(...discoverAll(path.join(base, e.name), pre + e.name + '/'));
    } else if (/\.test\.(js|mjs)$/.test(e.name)) {
      out.push(pre + e.name);
    }
  }
  return out.sort();
}

/** Test files named by any npm script — they run through their own entry. */
function namedByScript() {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {};
  const named = new Set();
  for (const file of discoverAll()) {
    if (Object.values(scripts).some((v) => typeof v === 'string' && v.includes(file))) named.add(file);
  }
  return named;
}

// Exported so the reachability gate reasons about exactly the same sets.
const SELF = path.relative(path.join(ROOT, 'test'), __filename);
function partition() {
  const named = namedByScript();
  const run = [];
  for (const f of discoverAll()) {
    if (f === SELF) continue;
    if (named.has(f)) continue;               // has its own entry
    if (QUARANTINE[f]) continue;              // known-failing, tracked
    run.push(f);
  }
  return { run, quarantined: Object.keys(QUARANTINE).slice(), named };
}

module.exports = { QUARANTINE, discoverAll, namedByScript, partition, SELF };

if (require.main === module) {
  const { run, quarantined } = partition();
  console.log(`\nunwired-suite — ${run.length} test files with no npm script of their own`);

  let failed = [];
  for (const f of run) {
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'test', f)], { stdio: 'pipe' });
    } catch (err) {
      failed.push(f);
      const out = ((err.stdout || '') + (err.stderr || '')).toString();
      const why = out.split('\n').filter((l) => /✗|❌|FAIL|Error/.test(l)).slice(0, 3);
      console.error(`  ✗ ${f}`);
      why.forEach((l) => console.error(`      ${l.trim().slice(0, 140)}`));
    }
  }

  if (quarantined.length) {
    console.log(`\n  quarantined (${quarantined.length}) — tracked, not silently skipped:`);
    for (const f of quarantined) console.log(`    · ${f} — ${QUARANTINE[f]}`);
  }

  if (failed.length) {
    console.error(`\nunwired-suite: FAIL (${failed.length} of ${run.length})`);
    process.exit(1);
  }
  console.log(`  ✓ ${run.length} passed`);
  console.log('unwired-suite: PASS');
}
