import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { contentDate, isShallow, isDirty } from '../scripts/audit/content-date.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

function sh(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** A throwaway repo with two files committed on different dates. */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coho-cd-'));
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  sh(dir, ['config', 'user.name', 'Test']);
  const commit = (file, body, when) => {
    fs.writeFileSync(path.join(dir, file), body);
    execFileSync('git', ['-C', dir, 'add', file], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'add ' + file], {
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
    });
  };
  commit('old.json', '{"a":1}', '2025-03-04T05:35:12Z');
  commit('new.json', '{"b":2}', '2026-09-07T09:57:26Z');
  return dir;
}

console.log('content-date-freshness');

const repo = makeRepo();

run('a file\'s date is the commit that changed it, not its mtime', () => {
  // Touch the file so mtime is now — the exact condition checkout creates.
  const p = path.join(repo, 'old.json');
  const now = new Date();
  fs.utimesSync(p, now, now);
  const r = contentDate(repo, 'old.json');
  assert.equal(r.source, 'git');
  assert.equal(r.date, '2025-03-04', 'content date survives an mtime of now');
});

run('two files committed on different dates get different stamps', () => {
  // The whole defect was every source sharing one date.
  const a = contentDate(repo, 'old.json');
  const b = contentDate(repo, 'new.json');
  assert.notEqual(a.date, b.date);
  assert.equal(b.date, '2026-09-07');
});

run('timestamps are normalised to UTC with a trailing Z', () => {
  const r = contentDate(repo, 'new.json');
  assert.match(r.iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    'got ' + r.iso + ' — the manifest field stores UTC Z, not a local offset');
});

run('uncommitted changes fall back to the working copy', () => {
  fs.writeFileSync(path.join(repo, 'new.json'), '{"b":3}');
  const r = contentDate(repo, 'new.json');
  assert.equal(r.source, 'worktree', 'a modified file is genuinely newer than HEAD');
  assert.equal(isDirty(repo, 'new.json'), true);
  sh(repo, ['checkout', '--', 'new.json']);
});

run('a path git has never seen yields no date rather than a guess', () => {
  fs.writeFileSync(path.join(repo, 'untracked.json'), '{}');
  const r = contentDate(repo, 'untracked.json');
  assert.equal(r.date, null);
  assert.equal(r.source, 'untracked');
});

run('a missing file yields no date', () => {
  const r = contentDate(repo, 'nope.json');
  assert.equal(r.date, null);
  assert.equal(r.source, 'missing');
});

run('a shallow clone declines to stamp instead of writing one wrong date', () => {
  // Stamping from a shallow clone would give every file the boundary
  // commit's date — reproducing the exact bug being fixed.
  const r = contentDate(repo, 'old.json', { shallow: true });
  assert.equal(r.date, null);
  assert.equal(r.source, 'shallow');
});

run('isShallow reports false for a normal clone', () => {
  assert.equal(isShallow(repo), false);
});

run('both sync scripts read content dates, not mtimes', () => {
  for (const f of ['scripts/audit/refresh-inventory-mtimes.mjs', 'scripts/audit/sync-manifest-mtimes.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /from ["']\.\/content-date\.mjs["']/, f + ' imports the shared helper');
    assert.ok(!/statSync\([^)]*\)\.mtime/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
      f + ' no longer derives a stamp from mtime');
  }
});

run('the live inventory freshness signal is not vacuous', () => {
  // The regression guard for #1597: if a future change re-stamps everything
  // to one date, this fails. 47 of 47 sources shared a date before the fix.
  const src = fs.readFileSync(path.join(ROOT, 'js/data-source-inventory.js'), 'utf8');
  const dates = [...src.matchAll(/lastUpdated:\s*'([0-9]{4}-[0-9]{2}-[0-9]{2})'/g)].map((m) => m[1]);
  assert.ok(dates.length > 20, 'expected a substantial inventory');
  const distinct = new Set(dates).size;
  assert.ok(distinct >= 5,
    'only ' + distinct + ' distinct lastUpdated dates across ' + dates.length +
    ' sources — the freshness signal has gone vacuous again (#1597)');
});

fs.rmSync(repo, { recursive: true, force: true });

if (failures) { console.error('content-date-freshness: FAIL'); process.exitCode = 1; }
else console.log('content-date-freshness: PASS');
