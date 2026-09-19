/**
 * "Is this script wired into CI?" — answered by resolving the npm script
 * graph, not by searching a string.
 *
 * test:ci used to be one 7,595-character line holding all 213 steps, so
 * `scripts['test:ci'].includes('test:my-guard')` happened to work. It is now a
 * chain of ci:part-N groups, and those substring checks all broke at once —
 * the same failure #1740 fixed for scripts/audit/finish-line.mjs, which
 * reported two guards as deleted while both were still running.
 *
 * A substring check also can't tell a step from a comment, an adjacency from a
 * coincidence, or `test:foo` from `test:foo-bar`. This walks `npm run X` and
 * answers about what actually executes.
 */
'use strict';

/** Every script reachable from `root` by following `npm run` references. */
function reachableFrom(scripts, root, depth) {
  const seen = new Set();
  const queue = [root];
  let guard = 0;
  while (queue.length) {
    if (guard++ > 5000) break;              // cycle safety
    const name = queue.shift();
    if (seen.has(name) || !scripts[name]) continue;
    seen.add(name);
    for (const m of String(scripts[name]).matchAll(/npm run ([\w:.-]+)/g)) {
      queue.push(m[1]);
    }
  }
  seen.delete(root);
  return seen;
}

/** True when `name` actually runs as part of `root` (default: test:ci). */
function runsInCi(scripts, name, root) {
  return reachableFrom(scripts, root || 'test:ci').has(name);
}

/** Flattened run order of `root`, one level per `npm run` reference. */
function ciOrder(scripts, root, depth) {
  const d = depth || 0;
  if (d > 6) return [];
  return String(scripts[root || 'test:ci'] || '').split('&&')
    .map((s) => s.trim().replace(/^npm run /, ''))
    .filter(Boolean)
    .reduce((out, step) => out.concat(
      scripts[step] && /npm run /.test(String(scripts[step]))
        ? ciOrder(scripts, step, d + 1)
        : [step],
    ), []);
}

module.exports = { runsInCi, reachableFrom, ciOrder };
