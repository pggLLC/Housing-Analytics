#!/usr/bin/env node
/**
 * unwired-suite — run every in-scope test file that CI would otherwise never execute.
 *
 * Test files in this repo had a habit of being written and never wired up:
 * 72 of them had no route to CI at all when this was introduced, including
 * test/acs-etl.test.js and its 170 assertions. The cause was friction --
 * `test:ci` is a ~190-step single-line `&&` chain, so adding an entry means
 * editing that line, and skipping it costs nothing. This runner is ONE entry
 * that discovers its own contents, so a new test file is picked up by existing.
 *
 * Pairs with test/test-reachability.test.js, which fails if any in-scope test
 * file is neither reachable from a CI root nor quarantined.
 *
 * SCOPE IS DECLARED, NOT IMPLIED (see SCOPE below). An earlier version reported
 * "all 252 test files reachable" while silently ignoring 70 test-shaped files
 * in other conventions -- the same overclaim as a schema declaring fields no
 * row carries. Whatever is out of scope is counted and named, never dropped.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

/** Per-test wall clock. A hung legacy test must not eat the CI job ceiling. */
const TEST_TIMEOUT_MS = Number(process.env.UNWIRED_TEST_TIMEOUT_MS || 120000);

/**
 * What this gate covers, stated outright.
 *
 * INCLUDED: JavaScript test files under test/, at any depth, in the two
 * conventions this repo actually uses.
 *
 * EXCLUDED: everything below, with the reason. Excluded files are COUNTED and
 * reported; they are not silently outside the claim.
 */
const SCOPE = {
  includePatterns: [/\.test\.m?js$/, /^test_[^/]*\.js$/],
  excluded: [
    {
      label: 'Python tests (*.py under test/ and tests/)',
      match: (rel, abs) => abs.endsWith('.py'),
      dirs: ['test', 'tests'],
      reason: 'need pytest and per-suite dependencies; five are already invoked by npm scripts '
            + '(test:fmr-flatten-guard, test:fred-commodities-config, test:hna-build-concurrency, '
            + 'test:acs-fetch-retries). Bringing the rest under one runner is its own change.',
    },
    {
      label: 'Non-test .js under test/ (helpers and named entry points)',
      match: (rel, abs) => rel.endsWith('.js')
        && !/\.test\.m?js$/.test(rel) && !/(^|\/)test_[^/]*\.js$/.test(rel),
      dirs: ['test'],
      reason: 'audit entry points and shared helpers invoked by name '
            + '(e.g. pages-availability-check.js runs inside deploy.yml, hna-functionality-check.js '
            + 'inside test:hna); running them blind would execute helpers as if they were suites.',
    },
  ],
};

/**
 * Quarantine: known-failing in-scope tests.
 *
 * Empty is the intended resting state. Thirteen entries lived here when the
 * runner was introduced and all thirteen were fixed rather than left to sit.
 *
 * Every entry needs a reason, a follow-up issue and the date it was added --
 * test-reachability asserts all three. Without them a quarantine is just a
 * disabled test with better manners.
 */
const QUARANTINE = {
  // 'example.test.js': { reason: '…', issue: 1234, since: '2026-09-14' },
};

/* ── discovery ─────────────────────────────────────────────────────────── */

function walk(dir, prefix, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    const rel = prefix + e.name;
    if (e.isDirectory()) walk(abs, rel + '/', out);
    else out.push(rel);
  }
  return out;
}

/** Every file under test/, at any depth, relative to test/. */
function allFiles() {
  return walk(TEST_DIR, '', []).sort();
}

/** In-scope test files (the set this gate makes claims about). */
function discoverAll() {
  return allFiles().filter((rel) => {
    const base = path.basename(rel);
    return SCOPE.includePatterns.some((re) => re.test(base));
  });
}

/** Out-of-scope files grouped by the declared exclusion they fall under. */
function excludedByScope() {
  const groups = SCOPE.excluded.map((g) => ({ ...g, files: [] }));
  const seen = new Set(discoverAll());
  const roots = new Set(SCOPE.excluded.flatMap((g) => g.dirs));
  for (const dirName of roots) {
    const dir = path.join(ROOT, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const rel of walk(dir, '', [])) {
      const key = dirName + '/' + rel;
      if (dirName === 'test' && seen.has(rel)) continue;
      for (const g of groups) {
        if (!g.dirs.includes(dirName)) continue;
        if (g.match(rel, key)) { g.files.push(key); break; }
      }
    }
  }
  return groups;
}

/* ── reachability ──────────────────────────────────────────────────────── */

/**
 * Scripts CI actually starts. `test:ci` is the big one, but ci-checks.yml also
 * runs `npm run test:smoke` on its own, and deploy.yml has its own entry points.
 * Treating test:ci as the only root marked those as unreachable and produced
 * duplicate wiring for tests that already ran.
 */
function ciRoots(scripts) {
  const roots = new Set();
  const wfDir = path.join(ROOT, '.github', 'workflows');
  if (fs.existsSync(wfDir)) {
    for (const f of fs.readdirSync(wfDir)) {
      if (!/\.ya?ml$/.test(f)) continue;
      const src = fs.readFileSync(path.join(wfDir, f), 'utf8');
      for (const m of src.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
        if (scripts[m[1]]) roots.add(m[1]);
      }
    }
  }
  return roots;
}

/** Scripts reachable from the CI roots, following nested `npm run` calls. */
function reachableScripts(scripts) {
  const seen = new Set();
  const queue = [...ciRoots(scripts)];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || !scripts[name]) continue;
    seen.add(name);
    for (const m of String(scripts[name]).matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
      if (!seen.has(m[1])) queue.push(m[1]);
    }
  }
  return seen;
}

/**
 * Does `body` invoke exactly this test file?
 *
 * Substring matching made `hmda-lookup.test.js` look reached because
 * `xss-hmda-lookup.test.js` contains it -- so a real test was excluded from the
 * runner AND passed the gate. It never ran, and the guard said it was fine.
 * Anchor on a path boundary so one filename cannot be a suffix of another.
 */
function invokesExactly(body, rel) {
  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[\\s"\'=(])(?:\\./)?test/' + esc + '(?=$|[\\s"\'&;)])').test(String(body));
}

/** rel -> array of reachable script names that invoke it by exact path. */
function wiredScriptsFor(rel, scripts, reachable) {
  return [...reachable].filter((k) => invokesExactly(scripts[k], rel));
}

const SELF = path.relative(TEST_DIR, __filename);

function partition() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  const reachable = reachableScripts(scripts);
  const allScripts = Object.keys(scripts);

  const directlyWired = [];     // named by a script test:ci runs in its own chain
  const transitivelyWired = []; // reached through a nested npm run, or another CI root
  const run = [];               // no script route: this runner executes them
  const quarantined = [];
  const ciBody = ' ' + (scripts['test:ci'] || '') + ' ';

  for (const rel of discoverAll()) {
    if (rel === SELF) continue;
    if (QUARANTINE[rel]) { quarantined.push(rel); continue; }

    const owners = wiredScriptsFor(rel, scripts, reachable);
    if (!owners.length) {
      // Defined by a script that CI never starts is the same as unwired.
      const orphanOwners = allScripts.filter((k) => invokesExactly(scripts[k], rel));
      run.push(rel);
      if (orphanOwners.length) run[run.length - 1] = rel; // still run it; gate reports the orphan
      continue;
    }
    if (owners.some((k) => ciBody.includes(`npm run ${k} `))) directlyWired.push(rel);
    else transitivelyWired.push(rel);
  }
  return { directlyWired, transitivelyWired, run, quarantined, scripts, reachable };
}

module.exports = {
  QUARANTINE, SCOPE, TEST_TIMEOUT_MS, SELF,
  allFiles, discoverAll, excludedByScope,
  ciRoots, reachableScripts, invokesExactly, wiredScriptsFor, partition,
};

/* ── runner ────────────────────────────────────────────────────────────── */

if (require.main === module) {
  const { directlyWired, transitivelyWired, run, quarantined } = partition();
  console.log(`\nunwired-suite — ${run.length} in-scope test files with no route from a CI root`);
  console.log(`  (directly wired: ${directlyWired.length} · transitively wired: ${transitivelyWired.length})`);

  const failed = [];
  for (const rel of run) {
    try {
      execFileSync(process.execPath, [path.join(TEST_DIR, rel)], {
        stdio: 'pipe',
        timeout: TEST_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
    } catch (err) {
      failed.push(rel);
      if (err.killed || err.signal === 'SIGKILL' || err.code === 'ETIMEDOUT') {
        console.error(`  ✗ ${rel} — TIMED OUT after ${TEST_TIMEOUT_MS}ms and was killed`);
        continue;
      }
      const out = ((err.stdout || '') + (err.stderr || '')).toString();
      console.error(`  ✗ ${rel}`);
      out.split('\n').filter((l) => /✗|❌|FAIL|Error/.test(l)).slice(0, 3)
        .forEach((l) => console.error(`      ${l.trim().slice(0, 140)}`));
    }
  }

  if (quarantined.length) {
    console.log(`\n  quarantined (${quarantined.length}) — tracked, not silently skipped:`);
    for (const rel of quarantined) {
      const q = QUARANTINE[rel];
      console.log(`    · ${rel} — #${q.issue} (since ${q.since}) — ${q.reason}`);
    }
  }

  for (const g of excludedByScope()) {
    if (g.files.length) console.log(`\n  out of declared scope — ${g.label}: ${g.files.length} file(s)\n    ${g.reason}`);
  }

  if (failed.length) {
    console.error(`\nunwired-suite: FAIL (${failed.length} of ${run.length})`);
    process.exit(1);
  }
  console.log(`\n  ✓ ${run.length} passed`);
  console.log('unwired-suite: PASS');
}
