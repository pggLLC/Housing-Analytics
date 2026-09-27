#!/usr/bin/env node
// test/bot-pr-dispatches-ci-checks.test.js
//
// A workflow that opens a PR, or pushes a branch other than main, with the
// workflow token (GITHUB_TOKEN) gets no ci-checks on that PR by itself. The push
// starts no push workflow, and the pull_request run GitHub does create for the
// bot's PR is held at "action_required" until a person approves it -- on the PR
// that reads as "only CodeQL ran" (#1995, and #1925 before #1990 fixed
// market_data_build.yml). workflow_dispatch is the exception GitHub makes for
// the workflow token, so each such workflow dispatches ci-checks.yml on the
// branch it pushed.
//
// The dispatch must also wait for the push to land. `gh workflow run --ref B`
// resolves B server-side when it is called, and right after `git push` the API
// can still report the previous tip -- ci-checks would then pass on a commit
// nobody changed while the new head goes unverified. Every dispatch therefore
// goes through .github/actions/dispatch-ci-checks, which polls until the
// branch reports the pushed SHA and fails the step if it never does.
//
// This is structural, not a pinned string. For every job in every workflow it
// finds the steps that write a bot branch -- peter-evans/create-pull-request,
// `gh pr create`, or a `git push` of a branch the job created -- works out
// which branch that is, and requires a waited dispatch after it whose ref
// resolves to the SAME branch and whose SHA is the one that step pushed, with
// `actions: write`. A bare `gh workflow run ci-checks` anywhere fails. The
// wait itself is exercised against a fake `gh`. Renaming the branch on one side
// only fails; rewording comments or notices does not.
//
// It also asserts the other half of the agreement: ci-checks.yml accepts
// workflow_dispatch, and every step it gates on pull_request also runs for a
// dispatch on a non-default branch (or is allowlisted with a reason), so a
// dispatched run judges a bot PR by the same rules a pull_request run would.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const WF_DIR = process.env.BOT_PR_WF_DIR || path.join(ROOT, '.github', 'workflows');
const ACTION_DIR = process.env.BOT_PR_ACTION_DIR || path.join(ROOT, '.github', 'actions', 'dispatch-ci-checks');
const ACTION_USES = /^\.\/\.github\/actions\/dispatch-ci-checks\/?$/;
const SCRIPT_CALL = /\.github\/actions\/dispatch-ci-checks\/dispatch\.sh\b/;

// ci-checks steps gated on pull_request that deliberately do NOT run for a
// branch dispatch. Each needs the reason. Empty today.
const PR_ONLY_ALLOW = {};

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

const unquote = (s) => String(s).trim().replace(/^["']|["']$/g, '');

// A token expression that is the workflow token (or absent, which defaults to it).
function isWorkflowToken(expr) {
  if (expr == null || expr === '') return true;
  return /\$\{\{\s*(secrets\.GITHUB_TOKEN|github\.token)\s*\}\}/.test(String(expr));
}

// Resolve a branch expression to a literal, or null when it cannot be told.
function resolve(expr, ctx, depth = 0) {
  if (expr == null || depth > 6) return null;
  const e = unquote(expr);
  let m;
  if ((m = e.match(/^\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/))) {
    return resolve(lookupEnv(m[1], ctx), ctx, depth + 1);
  }
  if ((m = e.match(/^\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.pull-request-branch\s*\}\}$/))) {
    const s = ctx.steps.find((x) => x.id === m[1]);
    return s ? resolve(cprBranch(s), { ...ctx, step: s }, depth + 1) : null;
  }
  if ((m = e.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/))) {
    const name = m[1];
    const run = (ctx.step && ctx.step.run) || '';
    const assigns = [...run.matchAll(new RegExp('^\\s*(?:export\\s+)?' + name + '=(\\S+)\\s*$', 'gm'))];
    if (assigns.length) return resolve(assigns[assigns.length - 1][1], ctx, depth + 1);
    return resolve(lookupEnv(name, ctx), ctx, depth + 1);
  }
  if (/[$`]/.test(e)) return null;
  return e;
}

function lookupEnv(name, ctx) {
  for (const scope of [ctx.step && ctx.step.env, ctx.job.env, ctx.doc.env]) {
    if (scope && Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
  }
  return null;
}

const CPR = /^peter-evans\/create-pull-request@/;
const cprBranch = (s) => (s.with && s.with.branch) || 'create-pull-request/patch';

// Lines of a run script that are commands (comments dropped).
const commandLines = (run) => String(run || '').split('\n')
  .map((l, i) => ({ l: l.replace(/(^|\s)#.*$/, ''), i }))
  .filter(({ l }) => l.trim());

// Shell words of a line, keeping quoted words (which may hold spaces) whole.
const words = (l) => (l.match(/"[^"]*"|'[^']*'|\S+/g) || []);

// Destination branch of a `git push` line, or null for deletes and bare pushes.
function pushTarget(line) {
  const toks = line.trim().split(/\s+/);
  const at = toks.indexOf('push');
  const args = toks.slice(at + 1).filter((t) => !t.startsWith('-'));
  if (toks.includes('--delete') || toks.includes('-d')) return null;
  if (args.length < 2) return null; // `git push`: the branch checked out, main on the crons
  const spec = unquote(args[1]);
  return spec.includes(':') ? spec.split(':').pop() : spec;
}

// Every place a job writes a bot branch.
function writers(f, doc) {
  const out = [];
  for (const [jobId, job] of Object.entries(doc.jobs || {})) {
    const steps = job.steps || [];
    const checkoutToken = (steps.find((s) => /^actions\/checkout@/.test(s.uses || '')) || {}).with;
    steps.forEach((step, idx) => {
      const ctx = { doc, job, steps, step };
      if (CPR.test(step.uses || '')) {
        out.push({ f, jobId, job, steps, idx, line: Infinity, ctx, how: 'create-pull-request',
          branchExpr: cprBranch(step), token: step.with && step.with.token });
        return;
      }
      const lines = commandLines(step.run);
      const createsBranch = lines.some(({ l }) => /\bgit\s+(checkout\s+-[bB]|switch\s+-[cC])\b/.test(l));
      const ghToken = (step.env && (step.env.GH_TOKEN || step.env.GITHUB_TOKEN))
        || (job.env && job.env.GH_TOKEN) || (doc.env && doc.env.GH_TOKEN);
      for (const { l, i } of lines) {
        if (/(^|[\s;&|(])git\s+push\b/.test(l) && createsBranch) {
          const t = pushTarget(l);
          if (t && !/^(main|refs\/heads\/main)$/.test(unquote(t))) {
            out.push({ f, jobId, job, steps, idx, line: i, ctx, how: 'git push', branchExpr: t,
              token: checkoutToken && checkoutToken.token });
          }
        }
        if (/\bgh\s+pr\s+create\b/.test(l)) {
          // --head may sit on a continuation line.
          const rest = lines.filter((x) => x.i >= i).map((x) => x.l).join(' ');
          const head = (rest.match(/--head\s+(\S+)/) || [])[1];
          // The PR head is what the job pushed; the dispatch must follow that
          // push, and may precede `gh pr create`.
          const push = lines.find((x) => x.i < i && /(^|[\s;&|(])git\s+push\b/.test(x.l));
          out.push({ f, jobId, job, steps, idx, line: push ? push.i : i, ctx, how: 'gh pr create',
            branchExpr: head || null, token: ghToken });
        }
      }
    });
  }
  return out;
}

// Every ci-checks dispatch in a job: through the waiting action or its script
// (waited), or a bare `gh workflow run ci-checks` (not waited).
function dispatches(steps) {
  const out = [];
  steps.forEach((step, idx) => {
    if (ACTION_USES.test(step.uses || '')) {
      const w = step.with || {};
      out.push({ idx, line: -1, step, ref: w.ref, sha: w.sha, waited: true });
      return;
    }
    for (const { l, i } of commandLines(step.run)) {
      if (SCRIPT_CALL.test(l)) {
        const ws = words(l);
        const at = ws.findIndex((x) => SCRIPT_CALL.test(x));
        out.push({ idx, line: i, step, ref: ws[at + 1], sha: ws[at + 2], waited: true });
      } else if (/\bgh\s+workflow\s+run\s+["']?ci-checks(\.yml)?["']?(\s|$)/.test(l)) {
        out.push({ idx, line: i, step, ref: (l.match(/--ref[=\s]+(\S+)/) || [])[1], waited: false });
      }
    }
  });
  return out;
}

const REV_PARSE_HEAD = /^\$\(git rev-parse HEAD\)$/;

// Is `d.sha` the commit writer `w` pushed?
function shaIsPushed(d, w) {
  if (d.sha == null) return false;
  const e = unquote(d.sha);
  if (w.how === 'create-pull-request') {
    const m = e.match(/^\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.pull-request-head-sha\s*\}\}$/);
    return !!m && m[1] === w.steps[w.idx].id;
  }
  // A push in a run script: HEAD after the push, read after the push line.
  if (d.idx !== w.idx) return false;
  if (REV_PARSE_HEAD.test(e)) return d.line > w.line;
  const v = e.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
  if (!v) return false;
  const assigns = commandLines(d.step.run)
    .filter(({ l }) => new RegExp('^\\s*(?:export\\s+)?' + v[1] + '=').test(l));
  const last = assigns.filter((a) => a.i < d.line).pop();
  if (!last) return false;
  return last.i > w.line && REV_PARSE_HEAD.test(unquote(last.l.trim().slice(last.l.trim().indexOf('=') + 1)));
}

const files = fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const docs = Object.fromEntries(files.map((f) => [f, yaml.load(fs.readFileSync(path.join(WF_DIR, f), 'utf8'))]));
const found = files.flatMap((f) => writers(f, docs[f]));
const tokenWriters = found.filter((w) => isWorkflowToken(w.token));

test('the scan finds the bot-branch writers it is about (non-vacuous)', () => {
  const names = new Set(tokenWriters.map((w) => w.f));
  for (const f of ['market_data_build.yml', 'source-liveness-weekly.yml']) {
    assert.ok(names.has(f), 'scan did not find ' + f + ' -- the guard below would pass vacuously. Found: '
      + [...names].join(', '));
  }
  assert.ok(names.size >= 2);
});

test('every GITHUB_TOKEN bot branch dispatches ci-checks.yml on that branch, for the SHA it pushed', () => {
  const problems = [];
  for (const w of tokenWriters) {
    const where = w.f + ' (' + w.jobId + ', ' + w.how + ')';
    const branch = resolve(w.branchExpr, w.ctx);
    if (!branch) { problems.push(where + ': cannot tell which branch it writes (' + w.branchExpr + ')'); continue; }
    const after = dispatches(w.steps)
      .filter((d) => d.idx > w.idx || (d.idx === w.idx && d.line > w.line));
    const same = after.filter((d) => resolve(d.ref, { ...w.ctx, step: d.step }) === branch);
    if (!same.length) {
      const seen = after.map((d) => d.ref + ' -> ' + resolve(d.ref, { ...w.ctx, step: d.step }));
      problems.push(where + ': writes ' + branch + ' but never dispatches ci-checks.yml on it after'
        + (seen.length ? ' (dispatches: ' + seen.join(', ') + ')' : ''));
      continue;
    }
    const waited = same.filter((d) => d.waited);
    if (!waited.length) {
      problems.push(where + ': dispatches ci-checks on ' + branch + ' without waiting for the pushed SHA '
        + '-- use .github/actions/dispatch-ci-checks');
      continue;
    }
    if (!waited.some((d) => shaIsPushed(d, w))) {
      problems.push(where + ': waits for ' + waited.map((d) => d.sha).join(', ')
        + ', which is not the commit this step pushed');
    }
    const perms = w.job.permissions || w.ctx.doc.permissions || {};
    if (perms.actions !== 'write') problems.push(where + ': dispatches ci-checks without `actions: write`');
  }
  assert.deepStrictEqual(problems, []);
});

test('no workflow dispatches ci-checks.yml without the SHA wait', () => {
  const bare = [];
  for (const f of files) {
    for (const [jobId, job] of Object.entries(docs[f].jobs || {})) {
      for (const d of dispatches(job.steps || [])) {
        if (!d.waited) bare.push(f + ' (' + jobId + '): gh workflow run ci-checks --ref ' + d.ref);
      }
    }
  }
  assert.deepStrictEqual(bare, []);
});

test('the dispatch action runs dispatch.sh with its ref and sha inputs, in that order', () => {
  const action = yaml.load(fs.readFileSync(path.join(ACTION_DIR, 'action.yml'), 'utf8'));
  for (const k of ['ref', 'sha']) assert.ok(action.inputs && action.inputs[k] && action.inputs[k].required, 'input ' + k + ' must be required');
  const step = (action.runs.steps || []).find((s) => /dispatch\.sh/.test(s.run || ''));
  assert.ok(step, 'action.yml runs no dispatch.sh');
  const ws = words(commandLines(step.run).find(({ l }) => /dispatch\.sh/.test(l)).l);
  const at = ws.findIndex((x) => /dispatch\.sh/.test(unquote(x)));
  const inputOf = (tok) => {
    let e = unquote(tok || '');
    const v = e.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    if (v && step.env) e = String(step.env[v[1]] || '');
    return (e.match(/^\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}$/) || [])[1];
  };
  assert.deepStrictEqual([inputOf(ws[at + 1]), inputOf(ws[at + 2])], ['ref', 'sha']);
});

// ── the wait, exercised: dispatch.sh against a fake `gh` ────────────────────
{
  const SCRIPT = path.join(ACTION_DIR, 'dispatch.sh');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ci-'));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  // `gh api .../branches/B` prints the next line of $FAKE_TIPS (the last one
  // repeats); `gh workflow run` logs and exits $FAKE_DISPATCH_EXIT.
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    'echo "$*" >> "$FAKE_LOG"',
    'if [ "$1" = api ]; then',
    '  n=$(grep -c "^api " "$FAKE_LOG")',
    '  total=$(wc -l < "$FAKE_TIPS")',
    '  [ "$n" -gt "$total" ] && n=$total',
    '  sed -n "${n}p" "$FAKE_TIPS"; exit 0',
    'fi',
    'if [ "$1" = workflow ]; then exit "${FAKE_DISPATCH_EXIT:-0}"; fi',
  ].join('\n'), { mode: 0o755 });

  const OLD = 'a'.repeat(40);
  const NEW = 'b'.repeat(40);
  const run = (args, tips, env = {}) => {
    const id = Math.random().toString(36).slice(2);
    const log = path.join(tmp, 'log-' + id);
    const tipsFile = path.join(tmp, 'tips-' + id);
    fs.writeFileSync(log, '');
    fs.writeFileSync(tipsFile, tips.join('\n') + '\n');
    const r = spawnSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, GITHUB_REPOSITORY: 'o/r',
        FAKE_LOG: log, FAKE_TIPS: tipsFile, DISPATCH_ATTEMPTS: '4', DISPATCH_SLEEP: '0', ...env },
    });
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    return { code: r.status, out: r.stdout + r.stderr, calls };
  };
  const dispatchCalls = (r) => r.calls.filter((c) => c.startsWith('workflow run ci-checks.yml'));

  test('dispatch.sh waits while the branch still reports the previous tip, then dispatches on it', () => {
    const r = run(['chore/x', NEW], [OLD, OLD, NEW]);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.calls.filter((c) => c.startsWith('api ')).length, 3, 'polled until the tip matched');
    assert.ok(r.calls[0].includes('repos/o/r/branches/chore/x'), 'asks for the pushed branch');
    const d = dispatchCalls(r);
    assert.strictEqual(d.length, 1);
    assert.match(d[0], /--ref chore\/x(\s|$)/);
    assert.ok(r.calls.indexOf(d[0]) > r.calls.lastIndexOf(r.calls.filter((c) => c.startsWith('api ')).pop()),
      'dispatches only after the matching poll');
  });

  test('dispatch.sh fails loudly, and does not dispatch, when the tip never catches up', () => {
    const r = run(['chore/x', NEW], [OLD]);
    assert.notStrictEqual(r.code, 0);
    assert.deepStrictEqual(dispatchCalls(r), []);
    assert.strictEqual(r.calls.length, 4, 'tries every attempt before giving up');
    assert.match(r.out, /::error::/);
  });

  test('dispatch.sh refuses a missing SHA or main, and fails when the dispatch itself fails', () => {
    for (const args of [['chore/x', ''], ['chore/x'], ['main', NEW]]) {
      const r = run(args, [NEW]);
      assert.notStrictEqual(r.code, 0, JSON.stringify(args));
      assert.deepStrictEqual(r.calls, [], 'no API call or dispatch for ' + JSON.stringify(args));
    }
    const r = run(['chore/x', NEW], [NEW], { FAKE_DISPATCH_EXIT: '1' });
    assert.notStrictEqual(r.code, 0);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── ci-checks: a branch dispatch is checked like a pull_request ────────────
const ci = docs['ci-checks.yml'];

test('ci-checks.yml accepts workflow_dispatch (the dispatches above would 422 otherwise)', () => {
  const on = ci.on || ci[true];
  assert.ok(on && Object.prototype.hasOwnProperty.call(on, 'workflow_dispatch'), 'ci-checks.yml has no workflow_dispatch trigger');
});

test('every pull_request-gated ci-checks step or job also runs for a dispatch on a PR branch', () => {
  const units = [];
  for (const [jobId, job] of Object.entries(ci.jobs)) {
    units.push({ name: 'job ' + jobId, text: String(job.if || '') });
    for (const s of job.steps || []) units.push({ name: s.name || s.uses, text: [s.if, s.run].filter(Boolean).join('\n') });
  }
  const gated = units.filter((u) => /\bpull_request\b/.test(u.text));
  // The inventory line, the regeneration and the changed-files URL sweep.
  assert.ok(gated.length >= 3, 'expected at least 3 pull_request-gated steps, found ' + gated.length);
  const missing = gated
    .filter((u) => !(/workflow_dispatch/.test(u.text) && /default_branch/.test(u.text)))
    .filter((u) => !PR_ONLY_ALLOW[u.name])
    .map((u) => u.name);
  assert.deepStrictEqual(missing, [], 'these run for a PR but not for the dispatch that stands in for one');
  for (const [name, reason] of Object.entries(PR_ONLY_ALLOW)) {
    assert.ok(reason && reason.length > 20, 'PR_ONLY_ALLOW[' + name + '] needs a reason');
    assert.ok(gated.some((u) => u.name === name), 'PR_ONLY_ALLOW names no pull_request-gated step: ' + name);
  }
});

test('no ci-checks expression reads github.base_ref without a fallback (empty on a dispatch)', () => {
  const text = fs.readFileSync(path.join(WF_DIR, 'ci-checks.yml'), 'utf8');
  const exprs = [...text.matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1]).filter((e) => /github\.base_ref/.test(e));
  assert.ok(exprs.length >= 1, 'no github.base_ref read found; is the changed-files sweep still here?');
  const bare = exprs.filter((e) => !/github\.base_ref\s*\|\|/.test(e));
  assert.deepStrictEqual(bare, []);
});

test('no bot-branch commit carries the CI-skip directive', () => {
  // Built, not written out, so this file never contains the directive itself.
  const directive = new RegExp('\\[(' + ['skip', 'ci'].join(' ') + '|' + ['ci', 'skip'].join(' ')
    + '|no ci|skip actions|actions skip)\\]', 'i');
  const bad = [];
  for (const w of tokenWriters) {
    const s = w.steps[w.idx];
    const text = [s.run, s.with && s.with['commit-message']].filter(Boolean).join('\n');
    if (directive.test(text)) bad.push(w.f + ' (' + w.jobId + ')');
  }
  // A person who later re-syncs the PR would inherit the suppression (#1990).
  assert.deepStrictEqual(bad, []);
});

// Report the audit so a CI log shows what was checked.
for (const w of found) {
  console.log('    · ' + w.f + ' [' + w.how + '] -> ' + resolve(w.branchExpr, w.ctx)
    + (isWorkflowToken(w.token) ? ' (GITHUB_TOKEN)' : ' (other token: exempt)'));
}
console.log('bot-pr-dispatches-ci-checks: ' + passed + ' passed');
