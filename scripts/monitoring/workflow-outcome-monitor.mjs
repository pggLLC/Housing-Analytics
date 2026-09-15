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

export const OUTCOME = {
  RECOVERED: 'recovered',   // success — close any tracking issue
  FAILED: 'failed',         // failure — open / update
  TIMED_OUT: 'timed_out',   // cancelled at its ceiling, having actually run — open / update
  NEVER_RAN: 'never_ran',   // cancelled without executing a step — queue eviction, no alert
  STOPPED: 'stopped',       // cancelled, cause not determinable — no alert, but logged
  IGNORED: 'ignored',       // skipped / neutral — no action
};

/**
 * A cancelled run is a timeout only if it BOTH ran and died at its ceiling.
 *
 * Duration alone is not enough, and this repo's own history shows why:
 *
 *   build-hna-data       120/120 min   9 steps run   real timeout
 *   run-all-workflows    180/180 min   7 steps run   real timeout
 *   weekly_housing_brief  16/15  min   0 steps run   NEVER STARTED
 *   data-refresh          20-31/75 min 0 steps run   queue eviction
 *
 * weekly_housing_brief sat at 104% of its ceiling having executed nothing. A
 * duration-only rule — which is what the original scoping proposed — would have
 * raised a false timeout alert on it. Thirty workflows share the `data-commits`
 * concurrency group, so a pending run being evicted when a newer one queues is
 * routine and must never alert.
 *
 * Hence two factors. `stepsRun` is the one that distinguishes "was killed while
 * working" from "never got to work".
 */
export const TIMEOUT_CEILING_RATIO = 0.95;

export function classifyCancelled(run, ceilingMinutes) {
  const raw = run && run.stepsRun;
  const steps = Number(raw);

  // An UNKNOWN step count is not the same as a known zero. Collapsing the two
  // would make "we could not tell" indistinguishable from "it never started",
  // and the second answer silently means "do not alert" — absence coerced into
  // a confident finding, which is the defect class this whole package exists to
  // remove. Unknown stays STOPPED: visible in the log, not asserted as benign.
  if (raw == null || !Number.isFinite(steps)) return OUTCOME.STOPPED;

  if (steps <= 0) return OUTCOME.NEVER_RAN;

  const mins = runDurationMinutes(run);
  if (mins == null || !ceilingMinutes) return OUTCOME.STOPPED;

  return (mins >= ceilingMinutes * TIMEOUT_CEILING_RATIO)
    ? OUTCOME.TIMED_OUT
    : OUTCOME.STOPPED;
}

/**
 * Classify one completed run. Deliberately does NOT decide what to do about a
 * `cancelled` run: separating a timeout from a human cancellation needs the
 * job's declared timeout-minutes, which arrives in P2. Returning STOPPED rather
 * than guessing keeps this package honest about what it can and cannot tell.
 */
export function classify(run, ceilingMinutes) {
  if (!run || typeof run !== 'object') return OUTCOME.IGNORED;
  switch (run.conclusion) {
    case 'success':   return OUTCOME.RECOVERED;
    case 'failure':   return OUTCOME.FAILED;
    case 'cancelled': return classifyCancelled(run, ceilingMinutes);
    default:          return OUTCOME.IGNORED;
  }
}

/** Outcomes that warrant opening or updating a tracking issue. */
export function shouldAlert(outcome) {
  return outcome === OUTCOME.FAILED || outcome === OUTCOME.TIMED_OUT;
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

/* ── P3: staleness — a cron that quietly stops firing ──────────────────── */

/**
 * `workflow_run` fires when a run COMPLETES. It is therefore blind to the
 * failure mode that produced #1556: a scheduled workflow that stops producing
 * completed runs at all. build-hna-data went fifteen days that way and was
 * found by hand.
 *
 * Staleness has to be judged against each workflow's OWN declared cadence. A
 * fixed threshold would flag pab-allocations-annual as broken every day of the
 * year and miss a daily job that has been silent for three days. This repo
 * declares at least five distinct cadences: hourly, daily, weekly, monthly and
 * quarterly.
 */

/** Expected interval between scheduled runs, in hours, from a 5-field cron. */
export function cronIntervalHours(expr) {
  if (typeof expr !== 'string') return null;
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, month, dow] = f;

  const step = (field) => {
    const m = /^\*\/(\d+)$/.exec(field);
    return m ? Number(m[1]) : null;
  };

  // Quarterly and other month-stepped schedules: `1 */3 *` → every 3 months.
  const monthStep = step(month);
  if (monthStep) return monthStep * 30 * 24;
  if (month !== '*') return 365 * 24;            // a fixed month = annual

  if (dom !== '*') return 30 * 24;               // day-of-month set = monthly
  if (dow !== '*') return 7 * 24;                // day-of-week set = weekly

  const hourStep = step(hour);
  if (hourStep) return hourStep;                 // */6 → every 6 hours
  if (hour === '*') return step(min) ? step(min) / 60 : 1;
  return 24;                                     // fixed hour, every day
}

/**
 * How much slack before a silent workflow is called stale: TWO missed runs.
 *
 * This was 2.5x, and that value failed its own founding case. #1556 was
 * build-hna-data — a WEEKLY workflow (`23 7 * * 6`) — silent for fifteen days.
 * At 2.5x a weekly job gets 17.5 days before anything fires, so the rule would
 * have stayed quiet through the exact outage it was written to catch, and the
 * issue would still have been found by hand.
 *
 * 2.0 means "two scheduled runs have been missed", which is the semantic
 * actually wanted. Weekly then fires at 14 days and #1556 is caught; daily
 * fires at 2 days; quarterly at 6 months. Scheduler jitter is handled by
 * STALENESS_FLOOR_HOURS, not by loosening this.
 */
export const STALENESS_TOLERANCE = 2.0;

/**
 * A floor, in hours, beneath which nothing is called stale regardless of cadence.
 *
 * GitHub delays scheduled workflows under load, and high-frequency crons feel it
 * most. The first real run of this rule flagged pages-deploy-watchdog — an
 * hourly job — after about four hours of silence, which is ordinary scheduler
 * jitter, not an outage. Without a floor, 2.5x on an hourly cadence means a
 * 2.5-hour fuse, and the monitor becomes something people mute.
 *
 * Six hours still catches the case this package exists for: #1556 was fifteen
 * DAYS of silence on a weekly job.
 */
export const STALENESS_FLOOR_HOURS = 6;

/**
 * `null` when the workflow is within its expected cadence, otherwise a
 * description of how far past due it is.
 */
export function assessStaleness({ cron, hoursSinceLastCompletedRun }) {
  const expected = cronIntervalHours(cron);
  if (expected == null) return null;                       // not a cron we parse
  if (hoursSinceLastCompletedRun == null) return null;     // unknown, not asserted stale
  const limit = Math.max(expected * STALENESS_TOLERANCE, STALENESS_FLOOR_HOURS);
  if (hoursSinceLastCompletedRun <= limit) return null;
  return {
    expectedIntervalHours: expected,
    hoursSinceLastCompletedRun,
    limitHours: limit,
    missedRuns: Math.floor(hoursSinceLastCompletedRun / expected),
  };
}

/* ── P4: deciding what to do about an outcome ──────────────────────────── */

/**
 * The marker that ties an alert to its workflow.
 *
 * Deliberately the SAME format `.github/actions/notify-workflow-outcome` has
 * used since 2026-05: `[workflow-fail:<id>]`. Eight issues already carry it
 * (#1627, #1613, #1566, #1425, #1371, #1035, #937, #914). Reusing it means this
 * monitor finds and closes those existing trackers rather than opening a second
 * parallel history for the same workflow.
 */
export function trackerMarker(workflowId) {
  return `[workflow-fail:${workflowId}]`;
}

export function trackerTitle(workflowId) {
  return `⚠️ ${trackerMarker(workflowId)} ${workflowId} workflow failing`;
}

/**
 * Decide the action for an outcome, given whether a tracker is already open.
 *
 * Pure so it can be tested without touching the API. The rules:
 *   - a failure or a real timeout OPENS a tracker, or COMMENTS on the open one
 *     (multi-day outages produce one issue with a history, not one per run)
 *   - a success CLOSES an open tracker, and does nothing when none is open
 *   - everything else does nothing, and says why
 */
export function decideAction({ outcome, hasOpenTracker }) {
  if (shouldAlert(outcome)) {
    return hasOpenTracker
      ? { action: 'comment', reason: `${outcome} while a tracker is already open` }
      : { action: 'open',    reason: `${outcome} with no tracker open` };
  }
  if (outcome === OUTCOME.RECOVERED) {
    return hasOpenTracker
      ? { action: 'close', reason: 'a green run closes the tracker' }
      : { action: 'none',  reason: 'green, and nothing was open' };
  }
  // never_ran / stopped / ignored: explicitly not alerts, and the reason is
  // carried so a quiet monitor can be distinguished from a broken one.
  return { action: 'none', reason: `${outcome} is not an alertable outcome` };
}

/**
 * A tracker body that says what happened and how to check it.
 *
 * Timeouts get different wording from failures on purpose: a timeout renders
 * grey rather than red in the Actions UI, so someone scanning for red misses
 * it, and the first triage question is different — "what got slower" rather
 * than "what broke".
 */
export function trackerBody({ workflowId, outcome, runUrl, durationMinutes, ceilingMinutes }) {
  const lines = [
    `**Workflow**: \`${workflowId}\``,
    `**Outcome**: \`${outcome}\``,
    runUrl ? `**Run**: ${runUrl}` : null,
  ].filter(Boolean);

  if (outcome === OUTCOME.TIMED_OUT) {
    lines.push('', `This run was **cancelled at its timeout ceiling** (${Math.round(durationMinutes)} min `
      + `against a ${ceilingMinutes}-minute limit) after executing steps — it did not fail, it ran out `
      + `of time. GitHub records that as \`cancelled\`, which renders grey rather than red, so a scan `
      + `for red misses it. That is how #1556 went fifteen days unnoticed.`);
    lines.push('', 'Triage: look for what got slower, not what broke.');
  }

  lines.push('', '_Opened by the external workflow-outcome monitor. It watches from outside the job, '
    + 'because a job killed by its own timeout cannot run a final notification step._');
  return lines.join('\n');
}

/* ── GitHub API (P4) ───────────────────────────────────────────────────── */

/**
 * The smallest REST surface that opens, comments on and closes a tracker.
 *
 * Deliberately raw fetch rather than a client library: this runs in a 5-minute
 * job whose only job is to report, and a dependency that fails to install turns
 * the alerting path off again — which is the exact failure this package exists
 * to end. Read capability stays read-only; nothing here can dispatch, re-run or
 * cancel a workflow, and test/workflow-outcome-monitor.test.js enforces that.
 */
export class GitHubApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'GitHubApiError';
    Object.assign(this, details);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function header(res, name) {
  return res && res.headers && typeof res.headers.get === 'function'
    ? res.headers.get(name)
    : null;
}

function rateLimitDelayMs(res, nowMs) {
  const rawRetryAfter = header(res, 'retry-after');
  const retryAfter = Number(rawRetryAfter);
  if (rawRetryAfter != null && Number.isFinite(retryAfter) && retryAfter >= 0) {
    return retryAfter * 1000;
  }

  const remaining = header(res, 'x-ratelimit-remaining');
  const reset = Number(header(res, 'x-ratelimit-reset'));
  if (remaining === '0' && Number.isFinite(reset)) {
    return Math.max(0, reset * 1000 - nowMs) + 1000;
  }
  return 60000;
}

/**
 * REST request with bounded, operation-aware retries.
 *
 * Safe reads may be retried after network failures and 5xx responses. Mutating
 * requests are NOT blindly retried after those failures because GitHub may have
 * accepted the write before the connection was lost; repeating it could open or
 * comment twice. Explicit rate-limit responses are safe to retry because GitHub
 * rejected the request. Exhaustion always throws so a dropped alert is red.
 */
export async function ghRequest(path, {
  token,
  method = 'GET',
  body,
  fetchImpl,
  sleepImpl = sleep,
  nowImpl = Date.now,
  maxAttempts = 3,
  maxRetryDelayMs = 120000,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const verb = String(method).toUpperCase();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res;
    try {
      res = await doFetch(`https://api.github.com${path}`, {
        method: verb,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'coho-workflow-outcome-monitor',
          'x-github-api-version': '2022-11-28',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      const canRetry = verb === 'GET' && attempt < maxAttempts;
      if (canRetry) {
        await sleepImpl(1000 * (2 ** (attempt - 1)));
        continue;
      }
      throw new GitHubApiError(
        `${verb} ${path} -> network failure${verb === 'GET' ? ' after retries' : ' (write outcome unknown)'}`,
        { path, method: verb, attempt, transient: true, cause });
    }

    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (res.ok) return parsed;

    const detail = (parsed && parsed.message) || text.slice(0, 200) || '(no body)';
    const status = Number(res.status);
    const isRateLimited = status === 429 || (status === 403 && (
      header(res, 'retry-after') != null
      || header(res, 'x-ratelimit-remaining') === '0'
      || /rate limit|secondary rate/i.test(detail)
    ));
    const safeTransientRead = verb === 'GET' && (status >= 500 || status === 408);
    const canRetry = attempt < maxAttempts && (isRateLimited || safeTransientRead);

    if (canRetry) {
      const delayMs = isRateLimited
        ? rateLimitDelayMs(res, nowImpl())
        : 1000 * (2 ** (attempt - 1));
      if (delayMs <= maxRetryDelayMs) {
        await sleepImpl(delayMs);
        continue;
      }
    }

    throw new GitHubApiError(`${verb} ${path} -> HTTP ${status}: ${detail}`, {
      path,
      method: verb,
      status,
      attempt,
      rateLimited: isRateLimited,
      transient: isRateLimited || safeTransientRead || status >= 500,
    });
  }

  throw new GitHubApiError(`${verb} ${path} -> retry budget exhausted`, { path, method: verb });
}

/**
 * Find the open tracker for a workflow, matched on the MARKER rather than the
 * title. Titles get edited by people; the marker is the contract, and it is the
 * same one `.github/actions/notify-workflow-outcome` has written since 2026-05,
 * so this finds and closes the eight trackers that already exist instead of
 * starting a parallel history.
 */
export function findTracker(issues, workflowId) {
  const marker = trackerMarker(workflowId);
  return (issues || []).find((i) =>
    i
    // GET /issues returns PULL REQUESTS as well as issues — on this repo it
    // returned 12 items for 9 issues. A PR that quotes a tracker's title, which
    // is exactly what a PR fixing one tends to do, would otherwise match here
    // and the monitor would comment on and CLOSE that pull request.
    && !i.pull_request
    // The marker is predictable and issues are public. Only a tracker created
    // by this repository's Actions token is trusted; otherwise any user could
    // open a look-alike issue and receive comments or have it auto-closed.
    && i.user && i.user.login === 'github-actions[bot]'
    && i.state === 'open'
    && typeof i.title === 'string'
    && i.title.includes(marker)) || null;
}

/**
 * Every open issue, following pagination.
 *
 * A single per_page=100 request looks sufficient at today's 9 open issues and
 * fails silently the moment the repo passes 100: the tracker sits on page 2,
 * findTracker returns null, and every subsequent failure opens ANOTHER tracker
 * — the monitor spamming issues while appearing to work. The cap is a
 * belt-and-braces stop against a pathological repo, not an expected limit.
 */
export async function listOpenIssues(repo, { token, fetchImpl, maxPages = 20 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await ghRequest(
      `/repos/${repo}/issues?state=open&per_page=100&page=${page}`, { token, fetchImpl });
    if (!Array.isArray(batch)) {
      throw new Error(`GitHub issues response for ${repo} page ${page} is malformed`);
    }
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/**
 * The workflow id used in the marker is the workflow FILE's basename, not its
 * display name: the existing trackers read `[workflow-fail:build-hna-data]`
 * while the display name is "Build HNA Data Cache". Deriving it from the path
 * keeps this monitor matched to those issues.
 */
export function workflowIdFromPath(wfPath) {
  if (!wfPath || typeof wfPath !== 'string') return null;
  const base = wfPath.split('/').pop() || '';
  const id = base.replace(/\.ya?ml$/i, '');
  return id || null;
}

export function workflowFileFromPath(wfPath) {
  if (!wfPath || typeof wfPath !== 'string') return null;
  const base = wfPath.split('/').pop() || '';
  return /\.ya?ml$/i.test(base) ? base : null;
}

export function compareRunOrder(a, b) {
  const numberDiff = Number(a && a.run_number) - Number(b && b.run_number);
  if (numberDiff) return numberDiff;
  return Number(a && a.run_attempt) - Number(b && b.run_attempt);
}

/** Latest completed scheduled or manually dispatched run on the default branch. */
export async function latestRelevantRun(repo, workflowFile, branch, { token, fetchImpl } = {}) {
  const candidates = [];
  for (const event of ['schedule', 'workflow_dispatch']) {
    const query = new URLSearchParams({ branch, event, status: 'completed', per_page: '1' });
    const payload = await ghRequest(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?${query}`,
      { token, fetchImpl });
    if (!payload || !Array.isArray(payload.workflow_runs)) {
      throw new Error(`GitHub Actions runs response for ${workflowFile} (${event}) is malformed`);
    }
    if (payload.workflow_runs[0]) candidates.push(payload.workflow_runs[0]);
  }
  return candidates.sort((a, b) => compareRunOrder(b, a))[0] || null;
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

async function main() {
  requireToken();
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');

  // P1 is observation only: report what the triggering run concluded, and make
  // the classification visible in the log. Issue open/close arrives in P4, when
  // a watched workflow's in-job notifier is removed in the same commit.
  if (process.env.MONITOR_MODE === 'staleness') {
    console.log('::warning::[monitor] staleness alerting is not active; no workflow runs were '
      + 'queried and no tracker was opened. Cancellation inference and cadence-based staleness '
      + 'remain separate follow-up packages.');
    return;
  }

  const name = process.env.MONITOR_WORKFLOW_NAME || '(unknown)';
  const conclusion = process.env.MONITOR_CONCLUSION || '';
  const outcome = classify({ conclusion });
  const runUrl = process.env.MONITOR_RUN_URL || null;
  const workflowId = workflowIdFromPath(process.env.MONITOR_WORKFLOW_PATH) || null;

  console.log(`[monitor] repo=${repo} workflow=${name} conclusion=${conclusion || '(none)'} -> ${outcome}`);
  if (outcome === OUTCOME.STOPPED) {
    console.log('[monitor] cancelled: timeout vs human cancellation needs duration analysis (P2); '
      + 'no alert is raised in this package.');
  }

  // Without the file path there is no marker, and a tracker opened under a
  // guessed id would not match the eight that already exist. Say so and stop
  // rather than opening a duplicate history.
  if (!workflowId) {
    console.log('::warning::[monitor] tracker skipped — MONITOR_WORKFLOW_PATH is not set, '
      + 'so the [workflow-fail:<id>] marker cannot be derived');
    return;
  }

  const token = requireToken();
  const headBranch = process.env.MONITOR_HEAD_BRANCH || '';
  const defaultBranch = process.env.MONITOR_DEFAULT_BRANCH || '';
  if (!headBranch || !defaultBranch || headBranch !== defaultBranch) {
    console.log(`::warning::[monitor] tracker skipped — run branch ${headBranch || '(unknown)'} `
      + `is not the repository default branch ${defaultBranch || '(unknown)'}`);
    return;
  }

  // Skip the lookup only for outcomes that do nothing REGARDLESS of tracker
  // state. Asking decideAction with a hard-coded `hasOpenTracker: false` looks
  // like the same saving and is not: `recovered` maps to none when nothing is
  // open, so that shortcut returned before ever discovering the open tracker
  // and no recovery would have closed one. Trackers would accumulate forever
  // and the monitor would look like it was working.
  const inert = decideAction({ outcome, hasOpenTracker: true }).action === 'none'
             && decideAction({ outcome, hasOpenTracker: false }).action === 'none';
  if (inert) {
    console.log(`[monitor] tracker: no action — ${decideAction({ outcome, hasOpenTracker: false }).reason}`);
    return;
  }

  try {
    const workflowFile = workflowFileFromPath(process.env.MONITOR_WORKFLOW_PATH);
    const currentRun = {
      id: Number(process.env.MONITOR_RUN_ID),
      run_number: Number(process.env.MONITOR_RUN_NUMBER),
      run_attempt: Number(process.env.MONITOR_RUN_ATTEMPT),
      event: process.env.MONITOR_RUN_EVENT,
    };
    if (!workflowFile
        || !Number.isFinite(currentRun.id) || currentRun.id <= 0
        || !Number.isFinite(currentRun.run_number) || currentRun.run_number <= 0
        || !Number.isFinite(currentRun.run_attempt) || currentRun.run_attempt <= 0
        || !['schedule', 'workflow_dispatch'].includes(currentRun.event)) {
      throw new Error('workflow run identity is incomplete; refusing to mutate a tracker');
    }

    // `queue: max` prevents GitHub's default one-pending displacement, but it
    // does not promise execution order. An older event that starts later must
    // not reopen or close a tracker after a newer completed outcome.
    const latest = await latestRelevantRun(repo, workflowFile, defaultBranch, { token });
    if (!latest) {
      throw new Error(`no completed default-branch run was returned for ${workflowFile}; `
        + 'refusing to mutate a tracker without an ordering reference');
    }
    if (latest && compareRunOrder(latest, currentRun) > 0) {
      console.log(`[monitor] tracker: no action — stale run ${currentRun.run_number}.${currentRun.run_attempt}; `
        + `newer completed run ${latest.run_number}.${latest.run_attempt} already exists`);
      return;
    }

    const open = await listOpenIssues(repo, { token });
    const tracker = findTracker(open, workflowId);
    const decided = decideAction({ outcome, hasOpenTracker: Boolean(tracker) });

    // Every outcome names its channel and result on one line. alert.js failed
    // silently for months precisely because a skip looked like a success.
    if (decided.action === 'open') {
      const created = await ghRequest(`/repos/${repo}/issues`, {
        token, method: 'POST',
        body: {
          title: trackerTitle(workflowId),
          body: trackerBody({ workflowId, outcome, runUrl }),
        },
      });
      console.log(`[monitor] tracker: opened #${created.number} — ${decided.reason}`);
    } else if (decided.action === 'comment') {
      await ghRequest(`/repos/${repo}/issues/${tracker.number}/comments`, {
        token, method: 'POST',
        body: { body: trackerBody({ workflowId, outcome, runUrl }) },
      });
      console.log(`[monitor] tracker: commented on #${tracker.number} — ${decided.reason}`);
    } else if (decided.action === 'close') {
      await ghRequest(`/repos/${repo}/issues/${tracker.number}/comments`, {
        token, method: 'POST',
        body: { body: `✅ \`${workflowId}\` recovered${runUrl ? ` ([run](${runUrl}))` : ''}. Auto-closing.` },
      });
      await ghRequest(`/repos/${repo}/issues/${tracker.number}`, {
        token, method: 'PATCH', body: { state: 'closed' },
      });
      console.log(`[monitor] tracker: closed #${tracker.number} — ${decided.reason}`);
    } else {
      console.log(`[monitor] tracker: no action — ${decided.reason}`);
    }
  } catch (err) {
    console.error(`::error::[monitor] tracker: FAILED (${err.message})`);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`[monitor] ${err.message}`); process.exit(1); });
}
