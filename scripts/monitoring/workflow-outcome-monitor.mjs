#!/usr/bin/env node
/**
 * workflow-outcome-monitor — observe scheduled workflow outcomes from OUTSIDE
 * the workflow being observed.
 *
 * WHY THIS CANNOT LIVE INSIDE THE WATCHED JOB
 *
 * Every data workflow here carries a job-level `timeout-minutes` (15-180). A
 * job killed by that timeout terminates its runner, and `if: always()` does not
 * survive it -- so a final in-job notification step never executes. The repo's
 * own history shows the consequence: build-hna-data has five cancelled runs
 * (four of them ~120 min against a 120-minute ceiling, i.e. timeouts), and not
 * one produced an alert. #1556 -- fifteen days with no completed scheduled run
 * -- was found by hand.
 *
 * `.github/actions/notify-workflow-outcome` is correct and does handle
 * `cancelled`; it simply cannot be reached in the case it was written for. An
 * external observer can be.
 *
 * POLICY NOTE, LEARNED FROM THIS REPO'S DATA
 *
 * GitHub has never emitted `timed_out` or `startup_failure` here. Across 200+
 * runs the only conclusions are success, failure and cancelled. A timeout
 * surfaces as `cancelled`, which renders grey rather than red -- which is
 * exactly why these went unnoticed. Any policy keyed on a `timed_out`
 * conclusion would fire never. Timeouts must be INFERRED from run duration
 * against the workflow's declared ceiling. That inference lands in P2; this
 * package only observes and classifies.
 *
 * OBSERVATION ONLY. This monitor never dispatches, re-runs or cancels a
 * workflow. run-all-workflows dispatches children with `gh workflow run`, so a
 * monitor that could dispatch would be one edit away from a loop. A guard test
 * asserts no dispatch capability exists in this file.
 */

/** Conclusions GitHub actually produces in this repository. */
export const OBSERVED_CONCLUSIONS = ['success', 'failure', 'cancelled'];

/** Classification this package can make without duration data (see P2). */
export const OUTCOME = {
  RECOVERED: 'recovered',   // success — close any tracking issue
  FAILED: 'failed',         // failure — open / update
  STOPPED: 'stopped',       // cancelled — needs duration to tell timeout from human
  IGNORED: 'ignored',       // skipped / neutral — no action
};

/**
 * Classify one completed run. Deliberately does NOT decide what to do about a
 * `cancelled` run: separating a timeout from a human cancellation needs the
 * job's declared timeout-minutes, which arrives in P2. Returning STOPPED rather
 * than guessing keeps this package honest about what it can and cannot tell.
 */
export function classify(run) {
  if (!run || typeof run !== 'object') return OUTCOME.IGNORED;
  switch (run.conclusion) {
    case 'success':   return OUTCOME.RECOVERED;
    case 'failure':   return OUTCOME.FAILED;
    case 'cancelled': return OUTCOME.STOPPED;
    default:          return OUTCOME.IGNORED;
  }
}

/** Run duration in minutes, or null when the timestamps are unusable. */
export function runDurationMinutes(run) {
  const start = run && (run.run_started_at || run.created_at);
  const end = run && run.updated_at;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
}

/**
 * The token must be present and must be asserted, not assumed.
 *
 * scripts/monitoring/alert.js returns null and lets the caller exit 0 when
 * GITHUB_TOKEN is absent. Fifteen workflows call it, none supplies a token, and
 * it has never opened an issue in this repository's history -- a notifier that
 * reports success while doing nothing. This exits nonzero instead.
 */
export function requireToken(env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is not set. A monitor that cannot authenticate must fail loudly: '
      + 'scripts/monitoring/alert.js warned and returned null in this situation and '
      + 'consequently never opened an issue in this repo\'s entire history (#1619).'
    );
  }
  return token;
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

async function main() {
  requireToken();
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');

  // P1 is observation only: report what the triggering run concluded, and make
  // the classification visible in the log. Issue open/close arrives in P4, when
  // a watched workflow's in-job notifier is removed in the same commit.
  const name = process.env.MONITOR_WORKFLOW_NAME || '(unknown)';
  const conclusion = process.env.MONITOR_CONCLUSION || '';
  const outcome = classify({ conclusion });

  console.log(`[monitor] repo=${repo} workflow=${name} conclusion=${conclusion || '(none)'} -> ${outcome}`);
  if (outcome === OUTCOME.STOPPED) {
    console.log('[monitor] cancelled: timeout vs human cancellation needs duration analysis (P2); '
      + 'no alert is raised in this package.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`[monitor] ${err.message}`); process.exit(1); });
}
