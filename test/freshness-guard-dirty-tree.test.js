#!/usr/bin/env node
/**
 * A freshness check must not destroy the work it is being asked about.
 *
 * Every checker of this shape regenerates its target into the working tree,
 * diffs it, then `git checkout --` (and for the digests `git clean -fd`) to
 * restore. Run one between regenerating and committing and the regeneration is
 * gone, with no warning. On 2026-09-15 that happened twice in one session; the
 * second time was ninety minutes after a commit message had been written
 * saying "Regenerate, commit, THEN check".
 *
 * Three kinds of assertion here, in descending order of how much they prove:
 *
 *   1. BEHAVIOURAL, end-to-end: dirty a real target, run the real checker with
 *      CI unset, and assert the local edit is still on disk afterwards. If the
 *      guard is removed this does not merely fail — it takes minutes, because
 *      the generator actually runs. That is the honest cost of the thing being
 *      tested.
 *   2. BEHAVIOURAL, unit: the guard's own decisions, exercised against a real
 *      throwaway git repo rather than a mocked one.
 *   3. DISCOVERY: find every script that restores the tree and require each to
 *      hold the guard. This is what catches the NEXT checker, which nobody has
 *      written yet.
 */

const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REFUSED = 3;

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('freshness-guard-dirty-tree');

/* ── 1. end-to-end: the uncommitted file survives ─────────────────────────── */

test('a dirty target is refused, and the uncommitted edit is still there after', () => {
  const target = path.join(ROOT, 'data', 'hna', 'ranking-index.json');
  if (!fs.existsSync(target)) throw new Error('data/hna/ranking-index.json is absent');

  // Only dirty a file that is clean to begin with: otherwise a failure here
  // would restore someone else's in-progress work to HEAD.
  const already = spawnSync('git', ['status', '--porcelain', '--', 'data/hna/ranking-index.json'],
    { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  if (already) throw new Error('ranking-index.json is already dirty; cannot run this safely');

  const original = fs.readFileSync(target);
  const marker = `__freshness_guard_probe_${Date.now()}__`;
  try {
    const doc = JSON.parse(original.toString('utf8'));
    doc.__probe = marker;
    fs.writeFileSync(target, JSON.stringify(doc));

    // CI and the override are stripped deliberately: in CI the guard is exempt
    // by design, so running with the ambient env would assert nothing.
    const env = { ...process.env };
    delete env.CI;
    delete env.FRESHNESS_ALLOW_DIRTY;

    const res = spawnSync('python3', ['scripts/check-ranking-index-fresh.py'],
      { cwd: ROOT, encoding: 'utf8', env, timeout: 600000 });

    const onDisk = fs.readFileSync(target, 'utf8');
    assert.ok(onDisk.includes(marker),
      'the checker ran and restored the file — the uncommitted regeneration a '
      + 'maintainer had just built would have been destroyed here');
    assert.strictEqual(res.status, REFUSED,
      `expected exit ${REFUSED} (refused), got ${res.status}: ${(res.stdout || '') + (res.stderr || '')}`);
    assert.match(res.stdout || '', /ranking-index\.json/,
      'the refusal does not name the file it is protecting');
    assert.match(res.stdout || '', /commit/i,
      'the refusal does not say what to do about it');
  } finally {
    fs.writeFileSync(target, original);
  }
});

/* ── 2. unit: the guard's decisions, against a real git repo ──────────────── */

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freshness-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'thing.json'), '{"a":1}\n');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  return { dir, git };
}

const GUARD = path.join(ROOT, 'scripts', 'lib', 'freshness-guard.mjs');

function dirtyPathsIn(dir, targets) {
  const res = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import {dirtyPaths} from ${JSON.stringify(GUARD)};`
    + `console.log(JSON.stringify(dirtyPaths(${JSON.stringify(targets)})));`,
  ], { cwd: dir, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

test('a clean tree reports nothing dirty', () => {
  const { dir } = tempRepo();
  assert.deepStrictEqual(dirtyPathsIn(dir, ['data/']), []);
});

test('a modified tracked file is seen', () => {
  const { dir } = tempRepo();
  fs.writeFileSync(path.join(dir, 'data', 'thing.json'), '{"a":2}\n');
  assert.deepStrictEqual(dirtyPathsIn(dir, ['data/']), ['data/thing.json']);
});

test('an UNTRACKED file under the target is seen too', () => {
  // The digest checker runs `git clean -fd` over its targets, which deletes
  // untracked files outright. Those are the ones with no copy in git at all.
  const { dir } = tempRepo();
  fs.writeFileSync(path.join(dir, 'data', 'brand-new.json'), '{}\n');
  assert.deepStrictEqual(dirtyPathsIn(dir, ['data/']), ['data/brand-new.json']);
});

test('a staged file is seen', () => {
  const { dir, git } = tempRepo();
  fs.writeFileSync(path.join(dir, 'data', 'thing.json'), '{"a":3}\n');
  git('add', '-A');
  assert.deepStrictEqual(dirtyPathsIn(dir, ['data/']), ['data/thing.json']);
});

test('dirt OUTSIDE the target paths is not the guard\'s business', () => {
  // Refusing on any dirty file anywhere would make these checks unusable on a
  // working branch, and would be a gate nobody could leave on.
  const { dir } = tempRepo();
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'hello\n');
  assert.deepStrictEqual(dirtyPathsIn(dir, ['data/']), []);
});

function refusalExit(dir, env) {
  const res = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import {refuseIfDirty} from ${JSON.stringify(GUARD)};`
    + `refuseIfDirty(['data/'], {checker: 'probe'});`
    + `console.log('PROCEEDED');`,
  ], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  return res;
}

test('refuseIfDirty exits 3 on a dirty target', () => {
  const { dir } = tempRepo();
  fs.writeFileSync(path.join(dir, 'data', 'thing.json'), '{"a":9}\n');
  const env = { ...process.env };
  delete env.CI;
  delete env.FRESHNESS_ALLOW_DIRTY;
  const res = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import {refuseIfDirty} from ${JSON.stringify(GUARD)};`
    + `refuseIfDirty(['data/'], {checker: 'probe'});`
    + `console.log('PROCEEDED');`,
  ], { cwd: dir, encoding: 'utf8', env });
  assert.strictEqual(res.status, REFUSED, `exit was ${res.status}`);
  assert.ok(!(res.stdout || '').includes('PROCEEDED'), 'it kept going anyway');
});

test('CI is exempt — the gate never fires on an ephemeral checkout', () => {
  const { dir } = tempRepo();
  fs.writeFileSync(path.join(dir, 'data', 'thing.json'), '{"a":9}\n');
  const res = refusalExit(dir, { CI: 'true', FRESHNESS_ALLOW_DIRTY: '' });
  assert.strictEqual(res.status, 0, `CI run was refused: ${res.stderr}`);
  assert.ok((res.stdout || '').includes('PROCEEDED'), 'the guard blocked a CI run');
});

test('FRESHNESS_ALLOW_DIRTY is an escape hatch that works', () => {
  const { dir } = tempRepo();
  fs.writeFileSync(path.join(dir, 'data', 'thing.json'), '{"a":9}\n');
  const env = { ...process.env, FRESHNESS_ALLOW_DIRTY: '1' };
  delete env.CI;
  const res = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import {refuseIfDirty} from ${JSON.stringify(GUARD)};`
    + `refuseIfDirty(['data/'], {checker: 'probe'});`
    + `console.log('PROCEEDED');`,
  ], { cwd: dir, encoding: 'utf8', env });
  assert.ok((res.stdout || '').includes('PROCEEDED'), 'the documented override does not work');
});

/* ── 3. discovery: every restorer must carry the guard ────────────────────── */

const RESTORES = /git\(\s*['"]checkout['"]\s*,\s*['"]--['"]|git\(\s*["']clean["']|\[\s*["']git["']\s*,\s*["']checkout["']/;
const HAS_GUARD = /refuse_if_dirty|refuseIfDirty/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(py|mjs|js|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const restorers = walk(path.join(ROOT, 'scripts'))
  .filter((f) => RESTORES.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f))
  .sort();

test('the search actually finds the known restorers', () => {
  // Without this the discovery below passes by finding nothing.
  const expected = [
    'scripts/check-jurisdiction-digest-fresh.mjs',
    'scripts/check-place-chas-fresh.py',
    'scripts/check-place-pages-fresh.py',
    'scripts/check-ranking-index-fresh.py',
  ];
  for (const e of expected) {
    assert.ok(restorers.includes(e), `${e} was not detected as a restorer — the pattern has drifted`);
  }
});

test('every script that restores the working tree refuses to eat your work first', () => {
  const unguarded = restorers.filter((rel) => !HAS_GUARD.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  assert.deepStrictEqual(unguarded, [],
    `these restore the working tree without checking it first: ${unguarded.join(', ')}. `
    + 'Add refuse_if_dirty()/refuseIfDirty() before the generator runs.');
});

/**
 * Strip the module docstring / leading block comment.
 *
 * Both of these files DISCUSS the generator and the guard in prose above the
 * code. Searching the raw source finds the prose, and the first version of this
 * assertion did exactly that and reported the guard as misplaced when it was
 * not. What matters is the order of the two CALLS.
 */
function executableBody(src) {
  const py = src.indexOf('\"\"\"');
  if (py >= 0 && py < 200) {
    const close = src.indexOf('\"\"\"', py + 3);
    if (close > 0) return src.slice(close + 3);
  }
  const js = src.indexOf('/**');
  if (js >= 0 && js < 200) {
    const close = src.indexOf('*/', js + 3);
    if (close > 0) return src.slice(close + 2);
  }
  return src;
}

test('the guard runs BEFORE the generator, not after it', () => {
  // A guard placed after the build has already lost the file.
  //
  // Anchored on the INVOCATION, not on the generator's filename. The first
  // version of this matched the name, and broke the moment check-ranking-index
  // -fresh.py listed its producers in a CHAIN constant above main() — the
  // guard still ran first, the test was reading a declaration. A mention is
  // not an execution, which is the same distinction this whole file is about.
  const order = {
    'scripts/check-ranking-index-fresh.py': /for runtime, script in CHAIN:/,
    'scripts/check-place-chas-fresh.py': /\[sys\.executable, "scripts\/hna\/build_place_chas\.py"\]/,
    'scripts/check-place-pages-fresh.py': /\[sys\.executable, "scripts\/hna\/build_place_pages\.py"\]/,
    'scripts/check-jurisdiction-digest-fresh.mjs': /run\('npm', \['run', 'build:jurisdiction-metrics-digest'\]\)/,
  };
  const CALL = /(refuse_if_dirty|refuseIfDirty)\s*\(/;
  for (const [rel, invocation] of Object.entries(order)) {
    let body = executableBody(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    // For the Python checkers, module-level constants sit between the
    // docstring and main(); the flow that matters starts at main().
    const mainAt = body.indexOf('def main(');
    if (mainAt >= 0) body = body.slice(mainAt);
    const g = body.search(CALL);
    const b = body.search(invocation);
    assert.ok(g >= 0, `${rel}: no guard CALL found in the executable flow`);
    assert.ok(b >= 0, `${rel}: generator INVOCATION not found — the anchor has drifted`);
    assert.ok(g < b, `${rel}: the guard is called after the generator has already overwritten the file`);
  }
});

console.log(failures === 0
  ? '  freshness-guard-dirty-tree: PASS'
  : `  freshness-guard-dirty-tree: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
