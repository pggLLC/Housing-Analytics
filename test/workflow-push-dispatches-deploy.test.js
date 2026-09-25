#!/usr/bin/env node
// test/workflow-push-dispatches-deploy.test.js
//
// A push made with the workflow token does not trigger push workflows, so a
// data workflow that pushes to main and does nothing else leaves the site on
// the previous commit. When nothing else deploys within the grace period,
// pages-deploy-watchdog fails (#1875: a chfa-qap-watch commit). 23 workflows
// were in that state; they now run .github/actions/dispatch-pages-deploy.
//
// 1. Sweep: every workflow whose job runs `git push` either dispatches
//    deploy.yml or is listed in NOT_DEPLOYED with the reason (it pushes a
//    branch other than main, or deletes branches). Non-vacuity: the sweep
//    must find the pushing workflows it is about.
// 2. Behaviour: dispatch.sh, run against a real git repo and a fake `gh`,
//    dispatches only for a commit this run made and only once main has it.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const ACTION = './.github/actions/dispatch-pages-deploy';
const SCRIPT = path.join(ROOT, '.github', 'actions', 'dispatch-pages-deploy', 'dispatch.sh');

// Workflows that run `git push` but never put a commit on main.
const NOT_DEPLOYED = {
  'cleanup-stale-branches.yml': 'deletes stale branches; pushes no commit',
  'docs-sync.yml': 'pushes a PR branch; the merge deploys',
  'market_data_build.yml': 'pushes a PR branch; the merge deploys',
  'external-references-check.yml': '"git push" is text in an issue body it writes, not a command',
};

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

function stepText(s) {
  return [s.run, s.uses, s.with && s.with.script].filter(Boolean).join('\n');
}

const files = fs.readdirSync(WF_DIR).filter((f) => f.endsWith('.yml'));
const pushing = [];
for (const f of files) {
  const doc = yaml.load(fs.readFileSync(path.join(WF_DIR, f), 'utf8'));
  for (const [jobId, job] of Object.entries(doc.jobs || {})) {
    const steps = job.steps || [];
    const pushIdx = steps.findIndex((s) => /(^|[\s;&|(])git push\b/m.test(s.run || ''));
    if (pushIdx === -1) continue;
    pushing.push({ f, jobId, doc, job, steps, pushIdx });
  }
}

test('the sweep finds the workflows that push (non-vacuous)', () => {
  assert.ok(pushing.length >= 30, 'only ' + pushing.length + ' pushing jobs found');
  for (const f of Object.keys(NOT_DEPLOYED)) {
    assert.ok(fs.existsSync(path.join(WF_DIR, f)), 'NOT_DEPLOYED names a missing workflow: ' + f);
  }
});

test('every job that pushes to main dispatches deploy.yml after its push', () => {
  const missing = [];
  for (const { f, jobId, doc, job, steps, pushIdx } of pushing) {
    if (NOT_DEPLOYED[f]) continue;
    const after = steps.slice(pushIdx).map(stepText).join('\n');
    const dispatches = after.includes(ACTION) || /deploy\.yml/.test(after);
    const perms = job.permissions || doc.permissions || {};
    if (!dispatches) missing.push(f + ' (' + jobId + '): no deploy dispatch after the push');
    else if (perms.actions !== 'write') missing.push(f + ' (' + jobId + '): dispatches without actions: write');
  }
  assert.deepStrictEqual(missing, []);
});

test('a NOT_DEPLOYED workflow that starts pushing to main fails here', () => {
  for (const f of Object.keys(NOT_DEPLOYED)) {
    const src = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
    assert.ok(!/git push origin (HEAD:)?main\b/.test(src), f + ' pushes main but is listed as not deploying');
  }
});

// ── Behaviour ────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-deploy-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
// Fake gh: `gh api .../compare/...` prints $FAKE_STATUS; `gh workflow run` logs.
fs.writeFileSync(path.join(bin, 'gh'), [
  '#!/usr/bin/env bash',
  'echo "$*" >> "$FAKE_LOG"',
  'if [ "$1" = api ]; then echo "${FAKE_STATUS}"; exit 0; fi',
  'if [ "$1" = workflow ]; then exit "${FAKE_DISPATCH_EXIT:-0}"; fi',
].join('\n'), { mode: 0o755 });

const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
git('init', '-q');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'start');
const startSha = git('rev-parse', 'HEAD');

function run(env) {
  const log = path.join(tmp, 'log-' + Math.random().toString(36).slice(2));
  fs.writeFileSync(log, '');
  const r = spawnSync('bash', [SCRIPT], {
    cwd: repo,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: bin + path.delimiter + process.env.PATH,
      GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: startSha, FAKE_LOG: log,
      DISPATCH_ATTEMPTS: '3', DISPATCH_SLEEP: '0',
    }, env),
  });
  return { code: r.status, out: r.stdout + r.stderr, calls: fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}
const dispatched = (r) => r.calls.some((c) => c.startsWith('workflow run deploy.yml --ref main'));

test('no commit made by this run: no compare, no dispatch', () => {
  const r = run({ FAKE_STATUS: 'identical' });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(r.calls, []);
});

git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'data');
const dataSha = git('rev-parse', 'HEAD');
assert.notStrictEqual(dataSha, startSha, 'the fixture commit applied');

test('main is the pushed commit (identical) or descends from it (ahead): dispatch', () => {
  for (const status of ['identical', 'ahead']) {
    const r = run({ FAKE_STATUS: status });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.calls[0].includes('compare/' + dataSha + '...main'), 'compares this commit against main');
    assert.ok(dispatched(r), status + ' did not dispatch');
  }
});

test('the commit is not on main (push failed, or another branch): no dispatch, no failure', () => {
  for (const status of ['diverged', 'behind', 'error']) {
    const r = run({ FAKE_STATUS: status });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!dispatched(r), status + ' dispatched');
    assert.strictEqual(r.calls.length, 3, 'waits for main before giving up');
    assert.match(r.out, /not on main/);
  }
});

test('a refused dispatch (no actions: write) fails the step loudly', () => {
  const r = run({ FAKE_STATUS: 'ahead', FAKE_DISPATCH_EXIT: '1' });
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /actions: write/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nworkflow push → deploy dispatch: ${passed} passed (${pushing.length} pushing jobs checked)`);
