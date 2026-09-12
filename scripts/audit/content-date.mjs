/**
 * content-date.mjs — when did a tracked file's CONTENT last change?
 *
 * The freshness stamps on the site (`lastUpdated` in js/data-source-inventory.js,
 * `last_update` in DATA-MANIFEST.json) were derived from filesystem mtime. Git
 * does not record or restore mtimes, and actions/checkout writes every tracked
 * file fresh, so on a runner every data file's mtime is the checkout time. The
 * sync scripts bump whenever mtime is newer than the declared stamp, so on each
 * scheduled run *everything* bumped and the dashboard's "Stale" signal became
 * vacuous — no source could ever go stale because the bot re-certified all of
 * them each morning (#1597).
 *
 * The evidence was stark: 47 of 47 inventory sources with a localFile carried
 * one identical date, and 31 of 31 manifest sources carried one identical
 * timestamp — the exact second CI checked out the repo.
 *
 * Git history is the honest source. `git log -1 --format=%cs -- <path>` is the
 * commit that last changed that file's content: checkout-independent, and it
 * differentiates. data/co-county-boundaries.json last genuinely changed
 * 2026-03-06; its mtime claimed 2026-07-15 locally and today's date in CI.
 *
 * Correctness depends on real history being present, so every failure mode
 * reports itself rather than guessing:
 *   - a shallow clone cannot see the true commit, so we decline to stamp
 *   - a path git has never seen has no content date
 *   - a path with uncommitted changes genuinely differs from HEAD, so the
 *     working copy's mtime is the truthful answer for a local run
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** True when the clone lacks full history, so `git log` cannot be trusted. */
export function isShallow(repo) {
  try {
    return git(repo, ['rev-parse', '--is-shallow-repository']) === 'true';
  } catch (_) {
    return false;
  }
}

/** True when git tracks the path at HEAD. */
export function isTracked(repo, relPath) {
  try {
    git(repo, ['ls-files', '--error-unmatch', '--', relPath]);
    return true;
  } catch (_) {
    return false;
  }
}

/** True when the path has staged or unstaged modifications. */
export function isDirty(repo, relPath) {
  try {
    return git(repo, ['status', '--porcelain', '--', relPath]).length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * contentDate — resolve when a file's content last changed.
 *
 * @param {string} repo     repository root
 * @param {string} relPath  path relative to the repo root
 * @param {{shallow?:boolean}} [opts] pass a cached isShallow() to avoid
 *        re-shelling once per file across a few hundred sources
 * @returns {{date: (string|null), iso: (string|null), source: string, reason: string}}
 *          `date` is YYYY-MM-DD and `iso` a full timestamp, or null when no
 *          trustworthy answer exists. `source` is one of
 *          'git' | 'worktree' | 'shallow' | 'untracked' | 'missing' | 'error'.
 */
export function contentDate(repo, relPath, opts) {
  opts = opts || {};
  const abs = path.join(repo, relPath);
  if (!fs.existsSync(abs)) {
    return { date: null, iso: null, source: 'missing', reason: 'file does not exist' };
  }

  const shallow = opts.shallow !== undefined ? opts.shallow : isShallow(repo);
  if (shallow) {
    // Refusing to stamp beats stamping the shallow boundary commit, which
    // would be the same wrong date for every file — the very bug being fixed.
    return { date: null, iso: null, source: 'shallow', reason: 'shallow clone has no real history' };
  }

  if (!isTracked(repo, relPath)) {
    // `git status --porcelain` reports an untracked file too, so this check
    // must come first — otherwise an untracked file falls through to mtime,
    // which is the guessing this module exists to avoid.
    return { date: null, iso: null, source: 'untracked', reason: 'no commit has touched this path' };
  }

  if (isDirty(repo, relPath)) {
    // Content genuinely differs from anything git has recorded, so the
    // working copy is the truth. This is the local-development path; CI
    // runs on a clean tree.
    const m = fs.statSync(abs).mtime;
    return {
      date: m.toISOString().slice(0, 10),
      iso: m.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      source: 'worktree',
      reason: 'uncommitted changes — mtime is the true content date',
    };
  }

  let out;
  try {
    out = git(repo, ['log', '-1', '--format=%cs\t%cI', '--', relPath]);
  } catch (err) {
    return { date: null, iso: null, source: 'error', reason: String(err.message || err).slice(0, 120) };
  }
  if (!out) {
    return { date: null, iso: null, source: 'untracked', reason: 'no commit has touched this path' };
  }
  const [date, iso] = out.split('\t');
  // %cI carries the committer's local offset (…+02:00, …-0600). The manifest
  // stores UTC with a trailing Z, so normalise rather than writing two
  // formats into the same field.
  let utc = null;
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) utc = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return {
    date: date,
    iso: utc,
    source: 'git',
    reason: 'last commit that changed this file',
  };
}

export default { contentDate, isShallow, isDirty, isTracked };
