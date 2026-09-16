/**
 * scripts/lib/freshness-guard.mjs
 *
 * Node counterpart of scripts/lib/freshness_guard.py. Same rule, same reason:
 * a freshness checker restores its targets with `git checkout --` (and, for the
 * jurisdiction digests, `git clean -fd`, which also deletes untracked files),
 * so running one between regenerating and committing throws the regeneration
 * away without saying anything.
 *
 * See the Python module for the incident this came from.
 */
import { spawnSync } from 'node:child_process';

// 0 fresh · 1 stale · 2 the generator failed · 3 refused to look.
export const REFUSED = 3;

function git(...args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

export function dirtyPaths(targets) {
  const out = git('status', '--porcelain', '--', ...targets).stdout || '';
  return out
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => {
      const p = line.slice(3).trim();
      // Porcelain v1 renames read "XY <old> -> <new>".
      return p.includes(' -> ') ? p.split(' -> ')[1] : p;
    })
    .filter(Boolean);
}

export function exempt() {
  return Boolean(process.env.CI) || Boolean(process.env.FRESHNESS_ALLOW_DIRTY);
}

/**
 * Exit with REFUSED if any target holds uncommitted work. Returns normally
 * when it is safe to proceed.
 */
export function refuseIfDirty(targets, { checker, npmScript } = {}) {
  if (exempt()) return;
  const dirty = dirtyPaths(targets);
  if (dirty.length === 0) return;

  console.error(`⛔ refusing to run ${checker}: uncommitted changes under ${targets.join(', ')}.`);
  console.error('');
  console.error('   This check regenerates those paths and then restores them with');
  console.error('   `git checkout --` and `git clean -fd`, which would silently discard');
  console.error('   your work — including untracked files.');
  console.error('');
  console.error('   Uncommitted:');
  for (const p of dirty.slice(0, 12)) console.error(`     ${p}`);
  if (dirty.length > 12) console.error(`     … and ${dirty.length - 12} more`);
  console.error('');
  console.error('   If you have just regenerated these files, you already know the answer');
  console.error('   this check would give: the committed copy is stale. Commit, then re-run.');
  if (npmScript) console.error(`   Commit first, then:  npm run ${npmScript}`);
  console.error('   To run anyway and lose the changes:  FRESHNESS_ALLOW_DIRTY=1 …');
  process.exit(REFUSED);
}
