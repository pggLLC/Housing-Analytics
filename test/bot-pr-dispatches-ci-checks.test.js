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
// This is structural, not a pinned string. For every job in every workflow it
// finds the steps that write a bot branch -- peter-evans/create-pull-request,
// `gh pr create`, or a `git push` of a branch the job created -- works out
// which branch that is, and requires a `gh workflow run ci-checks.yml --ref R`
// after it whose R resolves to the SAME branch, with `actions: write` and a
// token for gh. Renaming the branch on one side only fails; rewording comments
// or the notice line does not.
//
// It also asserts the other half of the agreement: ci-checks.yml accepts
// workflow_dispatch, and every step it runs only for PRs and merges (the
// generated-file regeneration) also runs for a dispatch, so a dispatched run
// judges a bot PR by the same rules as a pull_request run would.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const WF_DIR = process.env.BOT_PR_WF_DIR || path.join(ROOT, '.github', 'workflows');

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
        const pr = l.match(/\bgh\s+pr\s+create\b/);
        if (pr) {
          // --head may sit on a continuation line.
          const rest = lines.filter((x) => x.i >= i).map((x) => x.l).join(' ');
          const head = (rest.match(/--head\s+(\S+)/) || [])[1];
          // The PR head is what the job pushed; the dispatch must follow that
          // push, and may precede `gh pr create` (market_data_build.yml does).
          const push = lines.find((x) => x.i < i && /(^|[\s;&|(])git\s+push\b/.test(x.l));
          out.push({ f, jobId, job, steps, idx, line: push ? push.i : i, ctx, how: 'gh pr create',
            branchExpr: head || null, token: ghToken });
        }
      }
    });
  }
  return out;
}

// Every `gh workflow run ci-checks.yml --ref X` in a job, with its position.
function dispatches(steps, doc, job) {
  const out = [];
  steps.forEach((step, idx) => {
    for (const { l, i } of commandLines(step.run)) {
      if (!/\bgh\s+workflow\s+run\s+["']?ci-checks(\.yml)?["']?(\s|$)/.test(l)) continue;
      const ref = (l.match(/--ref[=\s]+(\S+)/) || [])[1];
      const token = (step.env && (step.env.GH_TOKEN || step.env.GITHUB_TOKEN))
        || (job.env && job.env.GH_TOKEN) || (doc.env && doc.env.GH_TOKEN);
      out.push({ idx, line: i, step, ref, token });
    }
  });
  return out;
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

test('every GITHUB_TOKEN bot branch dispatches ci-checks.yml on that same branch', () => {
  const problems = [];
  for (const w of tokenWriters) {
    const where = w.f + ' (' + w.jobId + ', ' + w.how + ')';
    const branch = resolve(w.branchExpr, w.ctx);
    if (!branch) { problems.push(where + ': cannot tell which branch it writes (' + w.branchExpr + ')'); continue; }
    const after = dispatches(w.steps, w.ctx.doc, w.job)
      .filter((d) => d.idx > w.idx || (d.idx === w.idx && d.line > w.line));
    const same = after.filter((d) => resolve(d.ref, { ...w.ctx, step: d.step }) === branch);
    if (!same.length) {
      const seen = after.map((d) => d.ref + ' -> ' + resolve(d.ref, { ...w.ctx, step: d.step }));
      problems.push(where + ': writes ' + branch + ' but never dispatches ci-checks.yml on it after'
        + (seen.length ? ' (dispatches: ' + seen.join(', ') + ')' : ''));
      continue;
    }
    const perms = w.job.permissions || w.ctx.doc.permissions || {};
    if (perms.actions !== 'write') problems.push(where + ': dispatches ci-checks without `actions: write`');
    if (!same.some((d) => d.token)) problems.push(where + ': the dispatch step sets no GH_TOKEN for gh');
  }
  assert.deepStrictEqual(problems, []);
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

const ci = docs['ci-checks.yml'];

test('ci-checks.yml accepts workflow_dispatch (the dispatches above would 422 otherwise)', () => {
  const on = ci.on || ci[true];
  assert.ok(on && Object.prototype.hasOwnProperty.call(on, 'workflow_dispatch'), 'ci-checks.yml has no workflow_dispatch trigger');
});

test('a dispatched ci-checks run treats a branch like a PR wherever pull_request and push are special-cased', () => {
  const steps = Object.values(ci.jobs).flatMap((j) => j.steps || []);
  const prOnly = steps.filter((s) => {
    const t = [s.if, s.run].filter(Boolean).join('\n');
    return /pull_request/.test(t) && /["']push["']/.test(t);
  });
  assert.ok(prOnly.length >= 2, 'expected the inventory and regeneration steps, found ' + prOnly.length);
  const missing = prOnly.filter((s) => {
    const t = [s.if, s.run].filter(Boolean).join('\n');
    return !(/workflow_dispatch/.test(t) && /default_branch/.test(t));
  }).map((s) => s.name);
  assert.deepStrictEqual(missing, [], 'these run for PRs but not for a dispatch on a PR branch');
});

// Report the audit so a CI log shows what was checked.
for (const w of found) {
  console.log('    · ' + w.f + ' [' + w.how + '] -> ' + resolve(w.branchExpr, w.ctx)
    + (isWorkflowToken(w.token) ? ' (GITHUB_TOKEN)' : ' (other token: exempt)'));
}
console.log('bot-pr-dispatches-ci-checks: ' + passed + ' passed');
