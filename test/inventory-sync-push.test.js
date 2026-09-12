#!/usr/bin/env node
/*
 * Guard for scripts/audit/push-inventory-sync.sh — the commit/rebase/push
 * cycle the sync workflow uses to land inventory corrections on main.
 *
 * The race it exists to prevent
 * ----------------------------
 * The counts the sync scripts produce describe the tree that was checked out.
 * Before pushing, the workflow rebases onto origin/main, and another data
 * workflow may have advanced it in the meantime. Git reports no conflict —
 * nothing upstream touched the inventory — so the rebase replays the
 * inventory-only commit cleanly onto data it never saw, and main ends up with
 * counts describing the previous revision. Nothing downstream catches it: the
 * push uses GITHUB_TOKEN, and GitHub does not trigger workflows for such
 * pushes, so ci-checks never runs on the result.
 *
 * These cases drive the real script against real git repositories, with a
 * genuine concurrent push from a second clone between the two.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const PUSH_SCRIPT = path.join('scripts', 'audit', 'push-inventory-sync.sh');
const COPIED = [
  PUSH_SCRIPT,
  path.join('scripts', 'audit', 'refresh-inventory-mtimes.mjs'),
  path.join('scripts', 'audit', 'inventory-count-paths.cjs'),
  path.join('scripts', 'audit', 'sync-manifest-mtimes.mjs'),
];

// --- Fixtures --------------------------------------------------------------

// `lastUpdated` is parked in the far future so a clone's fresh mtimes can never
// bump it. Git does not preserve mtimes, so without this every clone would also
// rewrite the dates and blur what these cases are actually about: the counts.
const FAR_FUTURE = '2099-01-01';

function countiesFile(n) {
  const counties = {};
  for (let i = 0; i < n; i += 1) counties[`080${String(i).padStart(2, '0')}`] = { parcels: i };
  return JSON.stringify({ counties }, null, 2);
}

function inventory(regridFeatures) {
  return [
    '(function () {',
    "  'use strict';",
    '',
    '  var SOURCES = [',
    '    {',
    "      id: 'regrid-parcels',",
    "      name: 'Regrid parcels fixture',",
    "      url: 'http://127.0.0.1/regrid',",
    "      localFile: 'data/regrid-parcels.json',",
    `      lastUpdated: '${FAR_FUTURE}',`,
    `      features: ${regridFeatures},`,
    '    },',
    '  ];',
    '',
    '  window.DataSourceInventory = { getSources: function () { return SOURCES; } };',
    '}());',
    '',
  ].join('\n');
}

// --- git helpers -----------------------------------------------------------

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function seedRepo(dir, initialCounties, declaredFeatures) {
  fs.mkdirSync(path.join(dir, 'scripts', 'audit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  for (const rel of COPIED) fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  fs.chmodSync(path.join(dir, PUSH_SCRIPT), 0o755);
  fs.writeFileSync(path.join(dir, 'DATA-MANIFEST.json'), JSON.stringify({ sources: [] }, null, 2));
  fs.writeFileSync(path.join(dir, 'data/regrid-parcels.json'), countiesFile(initialCounties));
  fs.writeFileSync(path.join(dir, 'js/data-source-inventory.js'), inventory(declaredFeatures));

  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'seed');
}

function clone(origin, dest) {
  execFileSync('git', ['clone', '--quiet', origin, dest], { encoding: 'utf8' });
  git(dest, 'config', 'user.email', 'runner@example.invalid');
  git(dest, 'config', 'user.name', 'Runner');
  return dest;
}

function runSync(cwd) {
  const r = spawnSync(process.execPath, ['scripts/audit/refresh-inventory-mtimes.mjs'], {
    cwd, encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, `sync failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

function runPush(cwd, branch = 'main') {
  const r = spawnSync('bash', [PUSH_SCRIPT, branch], { cwd, encoding: 'utf8' });
  return { ...r, output: `${r.stdout}${r.stderr}` };
}

function declaredFeatures(text) {
  const m = /^ {6}features: (\d+),$/m.exec(text);
  assert.ok(m, `no features line in:\n${text}`);
  return Number(m[1]);
}

// Read a file as it exists on the bare origin, i.e. what actually landed.
function atOrigin(origin, file) {
  return execFileSync('git', ['show', `main:${file}`], { cwd: origin, encoding: 'utf8' });
}

function withRepos(initialCounties, declaredFeaturesValue, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-push-'));
  try {
    const seed = path.join(root, 'seed');
    fs.mkdirSync(seed);
    seedRepo(seed, initialCounties, declaredFeaturesValue);
    const origin = path.join(root, 'origin.git');
    execFileSync('git', ['clone', '--quiet', '--bare', seed, origin], { encoding: 'utf8' });
    body({ root, origin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const checks = [];
function check(label, fn) { fn(); checks.push(label); }

// --- 1. No race: the corrected count lands ---------------------------------

check('corrections land when origin/main has not moved', () => {
  withRepos(2, 99, ({ root, origin }) => {
    const runner = clone(origin, path.join(root, 'runner'));
    runSync(runner);
    assert.strictEqual(declaredFeatures(fs.readFileSync(path.join(runner, 'js/data-source-inventory.js'), 'utf8')), 2);

    const result = runPush(runner);
    assert.strictEqual(result.status, 0, `push script failed:\n${result.output}`);
    assert.match(result.output, /pushed=true/, result.output);
    assert.strictEqual(declaredFeatures(atOrigin(origin, 'js/data-source-inventory.js')), 2,
      'the corrected count must be what landed on origin');
  });
});

// --- 2. The race: main advanced with new data between sync and push --------

check('a concurrent data push is re-reconciled instead of landing stale counts', () => {
  withRepos(2, 99, ({ root, origin }) => {
    // Runner computes against 2 counties and commits nothing yet.
    const runner = clone(origin, path.join(root, 'runner'));
    runSync(runner);
    assert.strictEqual(
      declaredFeatures(fs.readFileSync(path.join(runner, 'js/data-source-inventory.js'), 'utf8')),
      2,
      'runner must have computed the pre-race count',
    );

    // Meanwhile another data workflow lands 5 counties. It does not touch the
    // inventory, so the rebase below will NOT conflict — that is the trap.
    const other = clone(origin, path.join(root, 'other'));
    fs.writeFileSync(path.join(other, 'data/regrid-parcels.json'), countiesFile(5));
    git(other, 'commit', '-am', 'data: more counties');
    git(other, 'push', 'origin', 'main');

    const result = runPush(runner);
    assert.strictEqual(result.status, 0, `push script failed:\n${result.output}`);
    assert.match(result.output, /re-reconciled against the new tip/,
      `the script must notice main advanced:\n${result.output}`);

    const landed = atOrigin(origin, 'js/data-source-inventory.js');
    assert.strictEqual(declaredFeatures(landed), 5,
      'the landed count must describe the data actually on main, not the checked-out revision');

    // And main is self-consistent: declared count === counted records.
    const data = JSON.parse(atOrigin(origin, 'data/regrid-parcels.json'));
    assert.strictEqual(declaredFeatures(landed), Object.keys(data.counties).length,
      'origin/main must reconcile after the push');
  });
});

// --- 3. Nothing to do ------------------------------------------------------

check('a clean tree pushes nothing and reports pushed=false', () => {
  withRepos(2, 2, ({ root, origin }) => {
    const runner = clone(origin, path.join(root, 'runner'));
    const before = git(runner, 'rev-parse', 'HEAD');
    runSync(runner);

    const result = runPush(runner);
    assert.strictEqual(result.status, 0, `push script failed:\n${result.output}`);
    assert.match(result.output, /No mtime or feature-count drift/, result.output);
    assert.doesNotMatch(result.output, /pushed=true/, 'must not claim a push');
    assert.strictEqual(git(runner, 'rev-parse', 'HEAD'), before, 'must not commit');
  });
});

// --- 4. Non-vacuity: the naive sequence would have landed stale counts ------

// Without the re-reconcile the old workflow did: commit, fetch, rebase, push.
// Replay exactly that and confirm it produces the wrong answer, so case 2 is
// demonstrably testing the fix rather than something git does for free.
check('the old commit/rebase/push sequence really did land stale counts', () => {
  withRepos(2, 99, ({ root, origin }) => {
    const runner = clone(origin, path.join(root, 'runner'));
    runSync(runner);
    git(runner, 'add', '-A');
    git(runner, 'commit', '-m', 'chore(data): sync');

    const other = clone(origin, path.join(root, 'other'));
    fs.writeFileSync(path.join(other, 'data/regrid-parcels.json'), countiesFile(5));
    git(other, 'commit', '-am', 'data: more counties');
    git(other, 'push', 'origin', 'main');

    git(runner, 'fetch', 'origin', 'main');
    git(runner, 'rebase', 'origin/main');   // clean: nothing upstream touched the inventory
    git(runner, 'push', 'origin', 'main');

    const landed = atOrigin(origin, 'js/data-source-inventory.js');
    const data = JSON.parse(atOrigin(origin, 'data/regrid-parcels.json'));
    assert.strictEqual(declaredFeatures(landed), 2, 'the naive sequence lands the pre-race count');
    assert.notStrictEqual(declaredFeatures(landed), Object.keys(data.counties).length,
      'and leaves main failing its own drift gate — this is the bug case 2 covers');
  });
});

console.log(`inventory sync push/rebase: PASS (${checks.length} behaviours verified)`);
checks.forEach((label) => console.log(`  · ${label}`));
