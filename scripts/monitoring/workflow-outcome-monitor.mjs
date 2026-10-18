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

/**
 * The values a cron field selects within [lo, hi], or null for `*`. Handles
 * lists, ranges and steps (`1,16`, `1-5`, every-6 steps, `0-12/3`); null on anything
 * else, so an unparsed field is never guessed at.
 */
function cronValues(field, lo, hi) {
  if (field === '*') return null;
  const out = new Set();
  for (const part of field.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const start = m[1] === '*' ? lo : Number(m[1]);
    const end = m[2] != null ? Number(m[2]) : (m[1] === '*' || m[3] ? hi : start);
    const step = m[3] ? Number(m[3]) : 1;
    if (!(step > 0) || start < lo || end > hi || start > end) return null;
    for (let v = start; v <= end; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Longest wait between selected values on a cycle of `period` units. */
function longestGap(values, period) {
  if (!values || !values.length) return null;
  let gap = values[0] + period - values[values.length - 1];
  for (let i = 1; i < values.length; i += 1) gap = Math.max(gap, values[i] - values[i - 1]);
  return gap;
}

/**
 * Expected interval between scheduled runs, in hours, from a 5-field cron.
 *
 * The LONGEST gap between runs, so a list such as `1,16` (fetch-bps-monthly,
 * twice a month) is judged as ~15 days rather than as monthly, and the
 * two-missed-runs rule keeps its meaning without alerting inside a normal gap.
 */
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
  if (monthStep) return monthStep * 31 * 24;
  if (month !== '*') return 365 * 24;            // a fixed month = annual

  if (dom !== '*') {                             // day-of-month set: monthly, or more often for a list
    // A 31-day cycle, the longest month: `1,16` waits 16 days from the 16th of
    // a 31-day month to the 1st, and a monthly job can wait 31 days.
    const gap = longestGap(cronValues(dom, 1, 31), 31);
    return gap == null ? 31 * 24 : gap * 24;
  }
  if (dow !== '*') {                             // day-of-week set: weekly, or more often for a list
    const gap = longestGap(cronValues(dow.replace(/\b7\b/g, '0'), 0, 6), 7);
    return gap == null ? 7 * 24 : gap * 24;
  }

  if (hour === '*') return step(min) ? step(min) / 60 : 1;
  const hourGap = longestGap(cronValues(hour, 0, 23), 24);
  return hourGap == null ? 24 : hourGap;         // */6 → 6, `6,18` → 12, fixed hour → 24
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
 * Added to every limit: a scheduled run starts hours late, so "two intervals
 * have passed" is not yet "two runs were missed". Without it a monthly job that
 * last succeeded on the 24th is flagged on the morning the second run is due.
 */
export const STALENESS_GRACE_HOURS = 12;

/**
 * `null` when the workflow is within its expected cadence, otherwise a
 * description of how far past due it is.
 */
export function assessStaleness({ cron, hoursSinceLastCompletedRun, expectedHours }) {
  const expected = expectedHours != null ? expectedHours : cronIntervalHours(cron);
  if (expected == null) return null;                       // not a cron we parse
  if (hoursSinceLastCompletedRun == null) return null;     // unknown, not asserted stale
  // The grace covers GitHub starting a scheduled run late (median ~3 h here,
  // AGENTS.md), so the second missed run must actually have had time to run.
  const limit = Math.max(expected * STALENESS_TOLERANCE, STALENESS_FLOOR_HOURS) + STALENESS_GRACE_HOURS;
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
  return findMarkedIssue(issues, trackerMarker(workflowId));
}

/** The open, Actions-authored issue whose title carries `marker`, or null. */
export function findMarkedIssue(issues, marker) {
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

/* ── P5: the staleness sweep ───────────────────────────────────────────── */

/**
 * ONE tracker for every silent schedule, not one per workflow. On first run a
 * repo with 68 scheduled workflows could have several overdue at once, and a
 * burst of issues is how a monitor gets muted. The issue body is the current
 * list; a comment is added only when that list changes, so a long outage is one
 * notification, not one a day.
 */
export const STALE_MARKER = '[workflow-stale]';
export const SELF_WORKFLOW_FILE = 'workflow-outcome-monitor.yml';
export const STALE_TITLE = `⚠️ ${STALE_MARKER} scheduled workflows have stopped succeeding`;

/** The cron expressions a workflow file declares (comments stripped). */
export function scheduledCrons(yamlText) {
  if (typeof yamlText !== 'string') return [];
  const code = yamlText.replace(/^\s*#.*$/gm, '');
  return [...code.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1].trim());
}

/** Shortest declared interval, in hours, or null when no cron parses. */
export function workflowCadenceHours(crons) {
  const hours = (crons || []).map(cronIntervalHours).filter((h) => h != null);
  return hours.length ? Math.min(...hours) : null;
}

/** Every workflow in the repo, with its enabled state, following pagination. */
export async function listWorkflows(repo, { token, fetchImpl, maxPages = 10 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await ghRequest(
      `/repos/${repo}/actions/workflows?per_page=100&page=${page}`, { token, fetchImpl });
    if (!payload || !Array.isArray(payload.workflows)) {
      throw new Error(`GitHub workflows response for ${repo} page ${page} is malformed`);
    }
    all.push(...payload.workflows);
    if (payload.workflows.length < 100) break;
  }
  return all;
}

/**
 * Latest SUCCESSFUL scheduled or dispatched run on the default branch.
 *
 * Success, not merely completed: #1556 was a weekly job whose runs kept
 * completing as `cancelled` at the timeout, so "it ran" was true for fifteen
 * days while no data landed. A manual dispatch that succeeds counts, because the
 * data it produced is just as fresh.
 */
export async function lastSuccessfulRun(repo, workflowFile, branch, { token, fetchImpl } = {}) {
  const found = [];
  for (const event of ['schedule', 'workflow_dispatch']) {
    const query = new URLSearchParams({ branch, event, status: 'success', per_page: '1' });
    const payload = await ghRequest(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?${query}`,
      { token, fetchImpl });
    if (!payload || !Array.isArray(payload.workflow_runs)) {
      throw new Error(`GitHub Actions runs response for ${workflowFile} (${event}) is malformed`);
    }
    if (payload.workflow_runs[0]) found.push(payload.workflow_runs[0]);
  }
  const at = (r) => new Date(r.updated_at || r.created_at).getTime();
  return found.filter((r) => Number.isFinite(at(r))).sort((a, b) => at(b) - at(a))[0] || null;
}

/** The ids listed in a stale tracker's body, so a changed list can be told apart. */
export function staleIdsFromBody(body) {
  const m = /<!-- stale-ids: ([^>]*) -->/.exec(body || '');
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).sort() : [];
}

export function staleBody(stale, { checked, unknown = [] } = {}) {
  const days = (h) => (h / 24).toFixed(h < 48 ? 1 : 0);
  const rows = stale.map((s) => `| \`${s.workflowId}\` | every ${days(s.expectedIntervalHours)} d `
    + `| ${s.lastSuccessAt ? `[${s.lastSuccessAt.slice(0, 10)}](${s.lastSuccessUrl})` : 'none found'} `
    + `| ${days(s.hoursSinceLastCompletedRun)} d | ${days(s.limitHours)} d |`);
  const lines = [
    `${stale.length} of ${checked} scheduled workflows have not succeeded on the default branch `
      + 'within two of their own scheduled intervals.',
    '',
    '| Workflow | Cadence | Last success | Silent for | Alert after |',
    '|---|---|---|---|---|',
    ...rows,
  ];
  if (unknown.length) {
    lines.push('', `Not judged (no successful run on record, so no baseline): ${unknown.map((u) => `\`${u}\``).join(', ')}.`);
  }
  lines.push('',
    'A silent schedule is invisible to the per-run alerts, which fire only when a run completes. '
    + 'That is how #1556 went fifteen days unnoticed. This list is rebuilt daily; the issue closes '
    + 'itself when every listed workflow has succeeded again.',
    '', `<!-- stale-ids: ${stale.map((s) => s.workflowId).sort().join(',')} -->`);
  return lines.join('\n');
}

/** open / update / close / none, given the stale set now and the open tracker. */
export function decideStaleAction({ staleIds, tracker }) {
  if (!staleIds.length) {
    return tracker ? { action: 'close', reason: 'every scheduled workflow is within its cadence' }
                   : { action: 'none', reason: 'nothing stale and nothing open' };
  }
  if (!tracker) return { action: 'open', reason: `${staleIds.length} stale with no tracker open` };
  const before = staleIdsFromBody(tracker.body);
  const same = before.length === staleIds.length && before.every((id, i) => id === [...staleIds].sort()[i]);
  return same ? { action: 'refresh', reason: 'same stale set; body refreshed without a notification' }
              : { action: 'update', reason: `stale set changed (${before.length} → ${staleIds.length})` };
}

/**
 * Judge every scheduled, enabled workflow against its own cadence. `mutate`
 * false prints the report and touches no issue: a dispatch from a feature
 * branch must never open or close a production tracker.
 */
export async function runStaleness({ repo, token, branch, workflowsDir, fetchImpl, now = Date.now(), mutate = true, log = console.log }) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  const states = new Map((await listWorkflows(repo, { token, fetchImpl }))
    .map((w) => [String(w.path || '').split('/').pop(), w.state]));

  const stale = []; const unknown = []; let checked = 0;
  for (const file of files) {
    const cadence = workflowCadenceHours(scheduledCrons(fs.readFileSync(path.join(workflowsDir, file), 'utf8')));
    if (cadence == null) continue;
    const id = workflowIdFromPath(file);
    // The sweep never judges itself: a monitor that has stopped cannot report
    // that, and on its first scheduled run its only prior success is an old
    // manual dispatch, which flagged it in the live dry run on 2026-10-18.
    if (file === SELF_WORKFLOW_FILE) continue;
    if (states.get(file) !== 'active') {
      log(`[monitor] staleness: ${id} skipped — workflow state is ${states.get(file) || 'unknown to the API'}`);
      continue;
    }
    checked += 1;
    const last = await lastSuccessfulRun(repo, file, branch, { token, fetchImpl });
    if (!last) { unknown.push(id); continue; }
    const lastAt = last.updated_at || last.created_at;
    const hours = (now - new Date(lastAt).getTime()) / 3600000;
    // Reuses the P3 rule as is: two missed runs, never under the jitter floor.
    const verdict = assessStaleness({ cron: null, hoursSinceLastCompletedRun: hours, expectedHours: cadence });
    if (verdict) stale.push({ workflowId: id, ...verdict, lastSuccessAt: lastAt, lastSuccessUrl: last.html_url });
  }

  log(`[monitor] staleness: checked ${checked} scheduled workflows, ${stale.length} stale, `
    + `${unknown.length} without a successful run on record`);
  if (unknown.length) log(`[monitor]   not judged (no success on record): ${unknown.join(', ')}`);
  for (const s of stale) log(`[monitor]   stale: ${s.workflowId} — ${Math.round(s.hoursSinceLastCompletedRun)} h since last success (limit ${s.limitHours} h)`);

  const body = staleBody(stale, { checked, unknown });
  if (!mutate) { log('[monitor] staleness: report only — not on the default branch, no tracker touched'); return { stale, unknown, checked }; }

  const tracker = findMarkedIssue(await listOpenIssues(repo, { token, fetchImpl }), STALE_MARKER);
  const decided = decideStaleAction({ staleIds: stale.map((s) => s.workflowId), tracker });
  if (decided.action === 'open') {
    const created = await ghRequest(`/repos/${repo}/issues`, { token, fetchImpl, method: 'POST', body: { title: STALE_TITLE, body } });
    log(`[monitor] staleness tracker: opened #${created.number} — ${decided.reason}`);
  } else if (decided.action === 'refresh' || decided.action === 'update') {
    // Comment BEFORE rewriting the body: the body's stale-ids are what the next
    // sweep compares against, so writing them first and then failing the
    // comment would make tomorrow's run see "unchanged" and drop the
    // notification for good. This order can at worst notify twice.
    if (decided.action === 'update') {
      await ghRequest(`/repos/${repo}/issues/${tracker.number}/comments`, { token, fetchImpl, method: 'POST',
        body: { body: `The stale list changed; it now names ${stale.length}: ${stale.map((s) => `\`${s.workflowId}\``).join(', ')}.` } });
    }
    await ghRequest(`/repos/${repo}/issues/${tracker.number}`, { token, fetchImpl, method: 'PATCH', body: { body } });
    log(`[monitor] staleness tracker: ${decided.action}d #${tracker.number} — ${decided.reason}`);
  } else if (decided.action === 'close') {
    await ghRequest(`/repos/${repo}/issues/${tracker.number}/comments`, { token, fetchImpl, method: 'POST',
      body: { body: '✅ Every scheduled workflow has succeeded within its cadence again. Auto-closing.' } });
    await ghRequest(`/repos/${repo}/issues/${tracker.number}`, { token, fetchImpl, method: 'PATCH', body: { state: 'closed' } });
    log(`[monitor] staleness tracker: closed #${tracker.number} — ${decided.reason}`);
  } else {
    log(`[monitor] staleness tracker: no action — ${decided.reason}`);
  }
  return { stale, unknown, checked, action: decided.action };
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
    const branch = process.env.MONITOR_DEFAULT_BRANCH || '';
    const ref = process.env.GITHUB_REF_NAME || '';
    if (!branch) throw new Error('MONITOR_DEFAULT_BRANCH is not set; refusing to judge staleness against a guessed branch');
    await runStaleness({
      repo, token: requireToken(), branch,
      workflowsDir: process.env.MONITOR_WORKFLOWS_DIR || '.github/workflows',
      mutate: ref === branch,
    });
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
