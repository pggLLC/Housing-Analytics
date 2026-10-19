#!/usr/bin/env node
// test/data-commits-queue.test.js
//
// Two agreements between the data workflows and what the site publishes.
//
// 1. Every workflow in the shared `data-commits` concurrency group declares
//    `queue: max`. Without it GitHub keeps one pending run per group and
//    silently cancels the others: ten scheduled data runs were dropped that way
//    between 2026-08-15 and 2026-10-11, each cancelled with zero jobs, grey
//    rather than red. A workflow that pushes to main outside the group can race
//    the ones inside it, so the pushers outside it are listed exactly, each with
//    its reason, and the list may only shrink.
//
// 2. deploy.yml publishes the committed data and fetches none of its own. It
//    used to run scripts/fetch-chfa-lihtc.js with continue-on-error, which
//    skipped the validation, county split and derived rebuild that
//    fetch-chfa-lihtc.yml runs, and stamped the map footer's "data as of" date
//    with the deploy time.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');

// Workflows that push a commit to main but sit outside data-commits. Moving each
// into the shared queue behind one push script is the follow-up ("2.1") from the
// 2026-10-15 workflow review.
const OUTSIDE_QUEUE = {
  'archive-audit-post-merge.yml': 'post-merge generated files; own group shared with refresh-working-paper, retries 3x (pending 2.1)',
  'refresh-working-paper.yml': 'paper figures; shares paper-figures-refresh with the post-merge job (pending 2.1)',
  'chfa-qap-watch.yml': 'weekly QAP snapshot; own group (pending 2.1, before it goes daily)',
  'discover-local-resources-weekly.yml': 'weekly candidate list; own group (pending 2.1)',
  'pab-allocations-annual.yml': 'annual; own group (pending 2.1)',
  'qa-status.yml': 'daily QA status file; own group (pending 2.1)',
  'refresh-co-demographics.yml': 'monthly; own group, retries 5x (pending 2.1)',
  'upstream-vintage-watch.yml': 'weekly vintage file; own group (pending 2.1)',
  'url-health-weekly.yml': 'weekly URL report; own group (pending 2.1)',
  'backfill_housing_brief.yml': 'manual-only GDELT backfill, last run 2026-04 (pending 2.1)',
};

// Workflows whose `git push` never puts a commit on main.
const NOT_MAIN = {
  'cleanup-stale-branches.yml': 'deletes stale branches',
  'docs-sync.yml': 'pushes a PR branch',
  'market_data_build.yml': 'pushes a PR branch',
  'external-references-check.yml': '"git push" is text in an issue body',
};

// Steps that build a manifest, commit, then rebase without building that
// manifest again. Each fails the day another commit lands on main inside its window.
// Moving each to scripts/push-data-commit.sh is the follow-up; the list may
// only shrink.
const MANIFESTS_BEFORE_REBASE = {
  'data-source-monitoring.yml': 'Commit discovery report',
  'discover-local-resources-weekly.yml': 'Commit updated candidates file',
  'fetch-cdphe-boundaries.yml': 'Commit and push',
  'fetch-parcel-zoning-data.yml': 'Commit updated data files', // rebuilds only data/manifest.json after
  'pab-allocations-annual.yml': 'Commit refreshed allocations',
  'qa-status.yml': 'Commit data/_qa-status.json (cron only)',
  'rebuild-place-od-flows.yml': 'Commit refreshed flows',
  'upstream-vintage-watch.yml': 'Commit refreshed watch result',
  'url-health-weekly.yml': 'Commit updated url-health.json',
};

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

const docs = {};
for (const f of fs.readdirSync(WF_DIR).filter((x) => x.endsWith('.yml'))) {
  docs[f] = yaml.load(fs.readFileSync(path.join(WF_DIR, f), 'utf8'));
}

function inDataCommits(doc) {
  const c = doc.concurrency;
  return Boolean(c && typeof c === 'object' && /data-commits/.test(String(c.group)));
}

function runText(doc) {
  const out = [];
  for (const job of Object.values(doc.jobs || {})) {
    for (const s of job.steps || []) {
      if (s.run) out.push(s.run);
      if (s.with && s.with.script) out.push(String(s.with.script));
    }
  }
  return out.join('\n');
}

function pushesToMain(f, doc) {
  if (NOT_MAIN[f]) return false;
  const text = runText(doc);
  return /(^|[\s;&|(])git push\b/m.test(text)
    || /commit-with-derived-chain\.sh(?![^\n]*--no-push)/.test(text)
    || /push-inventory-sync\.sh/.test(text)
    || /push-data-commit\.sh/.test(text);
}

const queued = Object.keys(docs).filter((f) => inDataCommits(docs[f]));

test('the scan finds the data-commits workflows', () => {
  assert.ok(queued.length >= 25, `expected at least 25 workflows in data-commits, found ${queued.length}`);
});

test('every data-commits workflow keeps all waiting runs (queue: max)', () => {
  const missing = queued.filter((f) => docs[f].concurrency.queue !== 'max');
  assert.deepStrictEqual(missing, [],
    `these drop pending runs silently; add "queue: max" under concurrency: ${missing.join(', ')}`);
});

test('no data-commits workflow cancels a run in progress', () => {
  // queue: max is invalid with cancel-in-progress: true, and cancelling a data
  // run mid-push is the failure the group exists to prevent.
  const cancelling = queued.filter((f) => docs[f].concurrency['cancel-in-progress'] !== false);
  assert.deepStrictEqual(cancelling, []);
});

test('every workflow that pushes to main is in data-commits or listed with a reason', () => {
  const outside = Object.keys(docs)
    .filter((f) => pushesToMain(f, docs[f]) && !inDataCommits(docs[f]))
    .sort();
  assert.ok(Object.keys(docs).filter((f) => pushesToMain(f, docs[f])).length >= 25,
    'the push scan should find the data workflows that commit to main');
  assert.deepStrictEqual(outside, Object.keys(OUTSIDE_QUEUE).sort(),
    'OUTSIDE_QUEUE must list exactly the main-pushers outside data-commits: '
    + 'join the group, or list the file with its reason');
});

test('deploy.yml fetches no data of its own', () => {
  const doc = docs['deploy.yml'];
  assert.ok(doc && doc.jobs && doc.jobs.deploy, 'deploy.yml has a deploy job');
  const steps = doc.jobs.deploy.steps || [];
  assert.ok(steps.some((s) => /build-public-site/.test(s.run || '')),
    'the scan reads the deploy steps that build the site');
  const fetching = steps
    .filter((s) => /scripts\/[\w/.-]*fetch[\w.-]*/i.test(s.run || ''))
    .map((s) => s.name || s.run);
  assert.deepStrictEqual(fetching, [],
    'the deploy must publish committed data; refresh data in its own workflow, which validates and commits it');
});

test('no step commits the manifests and then rebases without rebuilding them', () => {
  const rebasing = [];
  const stale = [];
  for (const [f, doc] of Object.entries(docs)) {
    if (NOT_MAIN[f]) continue; // rebases onto its own branch, which nothing else writes
    for (const job of Object.values(doc.jobs || {})) {
      for (const s of job.steps || []) {
        const run = s.run || '';
        const commit = run.indexOf('git commit');
        const rebase = run.slice(Math.max(commit, 0)).search(/git (pull --rebase|rebase)\b/);
        if (commit < 0 || rebase < 0) continue;
        rebasing.push(`${f}: ${s.name}`);
        // Split at the rebase, not the commit: a manifest built between the
        // two is still built before the rebase (Copilot review).
        const before = run.slice(0, commit + rebase);
        const after = run.slice(commit + rebase);
        // Each manifest built before the commit is built again after the
        // rebase: rebuilding only data/manifest.json leaves a committed
        // data/_manifest.json describing the pre-rebase tree.
        const builders = [/rebuild_manifest\.py/, /audit:file-manifest/];
        if (builders.some((re) => re.test(before) && !re.test(after))) {
          stale.push(`${f}: ${s.name}`);
        }
      }
    }
  }
  assert.ok(rebasing.length >= 20, `the scan should find the commit-then-rebase steps, found ${rebasing.length}`);
  const known = Object.entries(MANIFESTS_BEFORE_REBASE).map(([f, step]) => `${f}: ${step}`);
  assert.deepStrictEqual(stale.sort(), known.sort(),
    'a step that builds the manifests before its commit must build them again after the rebase '
    + '(or use scripts/push-data-commit.sh); fix it, or drop a fixed step from MANIFESTS_BEFORE_REBASE');
});

test('the shared push script commits before it builds the manifests', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'push-data-commit.sh'), 'utf8');
  const at = (re) => src.search(re);
  assert.ok(at(/^git commit -q -m/m) > 0, 'the script commits the workflow paths');
  assert.ok(at(/^\s*git rebase /m) > at(/^git commit -q -m/m), 'it rebases after that commit');
  assert.ok(at(/^\s*python3 scripts\/rebuild_manifest\.py/m) > at(/^\s*git rebase /m), 'and builds the manifests after the rebase');
  assert.ok(at(/^\s*npm run -s audit:file-manifest/m) < at(/^\s*python3 scripts\/rebuild_manifest\.py/m),
    'data/_manifest.json first, then data/manifest.json (two-manifest trap)');
});

test('a refused push fetches, rebases and rebuilds the manifests again', () => {
  // A PR merged between the fetch and the push refused Polymarket's single
  // push on 2026-10-19. The retry must start from the fetch, and take the
  // manifests back out of the commit first, or the next rebase conflicts on them.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'push-data-commit.sh'), 'utf8');
  const loop = (src.match(/^for attempt in [^\n]*\n([\s\S]*?)^done$/m) || [])[1];
  assert.ok(loop, 'the push runs inside a retry loop');
  const order = [/git fetch origin/, /git rebase /, /audit:file-manifest/, /rebuild_manifest\.py/, /if git push origin/, /git checkout HEAD~1 -- "\$\{MANIFESTS\[@\]\}"/]
    .map((re) => loop.search(re));
  assert.ok(order.every((i) => i >= 0), 'fetch, rebase, both manifests, push and manifest reset are all in the loop: ' + order);
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'in that order');
  assert.ok(!/^git push/m.test(src), 'no push outside the loop');
  assert.match(src, /done\n[^\n]*::error::[^\n]*\nexit 1/, 'a branch that keeps moving fails the run');
});

test('Rebuild BPS Permits checks the data bounds on the tree it commits', () => {
  // validate-critical-data.js checks the ranking-index metric bounds. Before
  // the move to the shared script it ran after the chain; a check that only
  // runs before the chain would pass the old committed index (Codex review).
  const steps = docs['rebuild-bps-permits.yml'].jobs.rebuild.steps;
  const commit = steps.find((s) => /commit-with-derived-chain\.sh/.test(s.run || ''));
  assert.ok(commit, 'the scan finds the BPS commit step');
  assert.match(commit.run, /commit-with-derived-chain\.sh[^\n]*--validate-critical/);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'commit-with-derived-chain.sh'), 'utf8');
  const fn = src.slice(src.indexOf('rebuild_and_commit() {'), src.indexOf('git commit -q -F'));
  assert.match(fn, /npm run rebuild:derived[\s\S]*validate-critical-data\.js/,
    'the script validates the bounds after the chain and before its commit');
});

test('a workflow that pushes a PR branch leaves both manifests out of its commit', () => {
  // ci-checks rebuilds the manifests on every PR and the post-merge job commits
  // them to main, so a PR never carries them (AGENTS.md). market_data_build
  // staged them and its rebase onto main conflicted whenever another data
  // commit landed during its run: three failed builds for #2318, 2026-10-18.
  const prBranch = Object.keys(NOT_MAIN).filter((f) => /PR branch/.test(NOT_MAIN[f]));
  assert.ok(prBranch.length >= 2, 'the scan finds the PR-branch workflows');
  for (const f of prBranch) {
    for (const [job, def] of Object.entries(docs[f].jobs || {})) {
      for (const step of def.steps || []) {
        for (const line of String(step.run || '').split('\n')) {
          if (/^\s*git add\b/.test(line)) {
            assert.ok(!/data\/(_)?manifest\.json|\bdata\/?(\s|$)/.test(line),
              `${f} ${job} "${step.name}" stages a manifest: ${line.trim()}`);
          }
        }
      }
    }
  }
});

console.log(`\n${passed} passed`);
