'use strict';

/**
 * Guard: the commits that break main must be verified.
 *
 * GitHub runs no workflows for pushes made with GITHUB_TOKEN, so `push: main`
 * never fires for the data crons -- and those are precisely the commits that
 * break main. On 2026-09-13 that happened four times across three pipelines,
 * each surfacing only when an unrelated PR inherited a failure on files it
 * never touched.
 *
 * ci-checks answers this two ways: a two-hourly schedule (a bounded window) and
 * a workflow_run trigger on the pipelines that push (minutes instead of hours).
 * This file asserts both remain wired, that the enumerated list still matches
 * the workflows that actually push on a daily-or-weekly cadence, and that
 * ci-checks never lists itself.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const CI = path.join(WF_DIR, 'ci-checks.yml');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures += 1; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('ci-verifies-bot-commits');

const ci = fs.readFileSync(CI, 'utf8');
const ciName = (ci.match(/^name:\s*(.+)$/m) || [])[1].trim().replace(/^["']|["']$/g, '');

/* ── the two mechanisms ─────────────────────────────────────────────────── */
{
  if (!/schedule:\s*\n\s*- cron:/.test(ci)) {
    fail('ci-checks has no schedule — bot commits would go unverified until the next PR');
  } else {
    ok('the two-hourly sweep is still wired');
  }
  if (!/^\s*workflow_run:/m.test(ci)) {
    fail('ci-checks has no workflow_run trigger — a data pipeline can push and publish '
       + 'without its commit ever being verified');
  } else {
    ok('completion of a data pipeline triggers verification');
  }
}

/* ── the watched list ───────────────────────────────────────────────────── */
const watched = (() => {
  const m = ci.match(/workflow_run:\s*\n\s*workflows:\s*\n([\s\S]*?)\n\s*types:/);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((x) => x[1]);
})();

{
  if (!watched.length) {
    fail('could not parse the watched list — every guard below would pass vacuously');
  } else if (watched.includes(ciName)) {
    fail(`ci-checks lists itself ("${ciName}") — workflow_run would recurse`);
  } else {
    ok(`${watched.length} pipelines watched, and ci-checks is not among them`);
  }
}

/* ── drift: does the list still match what actually pushes? ─────────────── */
{
  // A workflow qualifies if it pushes commits AND runs at least weekly. Monthly
  // and annual backfills are deliberately excluded — their infrequency is its
  // own bound, and listing them would add maintenance for no coverage.
  const frequentPushers = [];
  for (const f of fs.readdirSync(WF_DIR).filter((x) => /\.ya?ml$/.test(x))) {
    const text = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
    if (!/git push/.test(text)) continue;
    const cron = (text.match(/cron:\s*'([^']+)'/) || [])[1];
    if (!cron) continue;
    const dayOfMonth = cron.trim().split(/\s+/)[2];
    if (dayOfMonth !== '*') continue;            // monthly/annual — out of scope
    const name = (text.match(/^name:\s*(.+)$/m) || [])[1];
    if (name) frequentPushers.push(name.trim().replace(/^["']|["']$/g, ''));
  }

  if (!frequentPushers.length) {
    fail('found no frequent pushers — the drift check would pass vacuously');
  } else {
    // Some frequent pushers are intentionally unwatched (housekeeping that
    // cannot break a build). Only flag a pipeline that pushes DATA.
    const EXEMPT = new Set([
      // Deletes merged branches. Touches no data any check reads.
      'Cleanup Stale Merged Branches',
      // Both write a link-health cache that no ci-checks assertion consumes, and
      // the sweep is known to over-report on WAF 403s -- watching them would
      // trigger the full suite for a result CI does not use.
      'URL Health — Weekly Sweep',
      'a developer URL Health Monitor',
    ]);
    const missing = frequentPushers.filter((n) => !watched.includes(n) && !EXEMPT.has(n));
    if (missing.length) {
      fail(`these push at least weekly but are not watched by ci-checks:\n      - ${missing.join('\n      - ')}\n`
         + '    Add them to the workflow_run list, or to EXEMPT here with a reason.');
    } else {
      ok(`every frequent data pusher is watched (${frequentPushers.length} checked, ${EXEMPT.size} exempt)`);
    }

    // The reverse: a watched workflow that no longer exists is a silent no-op.
    const allNames = fs.readdirSync(WF_DIR).filter((x) => /\.ya?ml$/.test(x)).map((f) => {
      const t = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
      return ((t.match(/^name:\s*(.+)$/m) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
    });
    const orphans = watched.filter((n) => !allNames.includes(n));
    if (orphans.length) {
      fail(`watched but no such workflow (renamed or deleted): ${orphans.join(', ')}`);
    } else {
      ok('no watched name is an orphan');
    }
  }
}

console.log(failures === 0
  ? '  ci-verifies-bot-commits: PASS'
  : `  ci-verifies-bot-commits: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
