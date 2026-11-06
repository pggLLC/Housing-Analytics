# `scripts/monitoring/workflow-outcome-monitor.mjs`

workflow-outcome-monitor — observe scheduled workflow outcomes from OUTSIDE
the workflow being observed.

WHY THIS CANNOT LIVE INSIDE THE WATCHED JOB

Every data workflow here carries a job-level `timeout-minutes` (15-180). A
job killed by that timeout terminates its runner, and `if: always()` does not
survive it -- so a final in-job notification step never executes. The repo's
own history shows the consequence: build-hna-data has five cancelled runs
(four of them ~120 min against a 120-minute ceiling, i.e. timeouts), and not
one produced an alert. #1556 -- fifteen days with no completed scheduled run
-- was found by hand.

`.github/actions/notify-workflow-outcome` is correct and does handle
`cancelled`; it simply cannot be reached in the case it was written for. An
external observer can be.

POLICY NOTE, LEARNED FROM THIS REPO'S DATA

GitHub has never emitted `timed_out` or `startup_failure` here. Across 200+
runs the only conclusions are success, failure and cancelled. A timeout
surfaces as `cancelled`, which renders grey rather than red -- which is
exactly why these went unnoticed. Any policy keyed on a `timed_out`
conclusion would fire never. Timeouts must be INFERRED from run duration
against the workflow's declared ceiling. That inference lands in P2; this
package only observes and classifies.

OBSERVATION ONLY. This monitor never dispatches, re-runs or cancels a
workflow. run-all-workflows dispatches children with `gh workflow run`, so a
monitor that could dispatch would be one edit away from a loop. A guard test
asserts no dispatch capability exists in this file.

## Symbols

### `OBSERVED_CONCLUSIONS`

Conclusions GitHub actually produces in this repository.

### `TIMEOUT_CEILING_RATIO`

A cancelled run is a timeout only if it BOTH ran and died at its ceiling.

Duration alone is not enough, and this repo's own history shows why:

  build-hna-data       120/120 min   9 steps run   real timeout
  run-all-workflows    180/180 min   7 steps run   real timeout
  weekly_housing_brief  16/15  min   0 steps run   NEVER STARTED
  data-refresh          20-31/75 min 0 steps run   queue eviction

weekly_housing_brief sat at 104% of its ceiling having executed nothing. A
duration-only rule — which is what the original scoping proposed — would have
raised a false timeout alert on it. Thirty workflows share the `data-commits`
concurrency group, so a pending run being evicted when a newer one queues is
routine and must never alert.

Hence two factors. `stepsRun` is the one that distinguishes "was killed while
working" from "never got to work".

### `classify(run, ceilingMinutes)`

Classify one completed run. Deliberately does NOT decide what to do about a
`cancelled` run: separating a timeout from a human cancellation needs the
job's declared timeout-minutes, which arrives in P2. Returning STOPPED rather
than guessing keeps this package honest about what it can and cannot tell.

### `shouldAlert(outcome)`

Outcomes that warrant opening or updating a tracking issue.

### `runDurationMinutes(run)`

Run duration in minutes, or null when the timestamps are unusable.

### `requireToken(env = process.env)`

The token must be present and must be asserted, not assumed.

scripts/monitoring/alert.js returns null and lets the caller exit 0 when
GITHUB_TOKEN is absent. Fifteen workflows call it, none supplies a token, and
it has never opened an issue in this repository's history -- a notifier that
reports success while doing nothing. This exits nonzero instead.

### `cronValues(field, lo, hi)`

The values a cron field selects within [lo, hi], or null for `*`. Handles
lists, ranges and steps (`1,16`, `1-5`, every-6 steps, `0-12/3`); null on anything
else, so an unparsed field is never guessed at.

### `longestGap(values, period)`

Longest wait between selected values on a cycle of `period` units.

### `cronIntervalHours(expr)`

Expected interval between scheduled runs, in hours, from a 5-field cron.

The LONGEST gap between runs, so a list such as `1,16` (fetch-bps-monthly,
twice a month) is judged as ~15 days rather than as monthly, and the
two-missed-runs rule keeps its meaning without alerting inside a normal gap.

### `STALENESS_TOLERANCE`

How much slack before a silent workflow is called stale: TWO missed runs.

This was 2.5x, and that value failed its own founding case. #1556 was
build-hna-data — a WEEKLY workflow (`23 7 * * 6`) — silent for fifteen days.
At 2.5x a weekly job gets 17.5 days before anything fires, so the rule would
have stayed quiet through the exact outage it was written to catch, and the
issue would still have been found by hand.

2.0 means "two scheduled runs have been missed", which is the semantic
actually wanted. Weekly then fires at 14 days and #1556 is caught; daily
fires at 2 days; quarterly at 6 months. Scheduler jitter is handled by
STALENESS_FLOOR_HOURS, not by loosening this.

### `STALENESS_FLOOR_HOURS`

A floor, in hours, beneath which nothing is called stale regardless of cadence.

GitHub delays scheduled workflows under load, and high-frequency crons feel it
most. The first real run of this rule flagged pages-deploy-watchdog — an
hourly job — after about four hours of silence, which is ordinary scheduler
jitter, not an outage. Without a floor, 2.5x on an hourly cadence means a
2.5-hour fuse, and the monitor becomes something people mute.

Six hours still catches the case this package exists for: #1556 was fifteen
DAYS of silence on a weekly job.

### `STALENESS_GRACE_HOURS`

Added to every limit: a scheduled run starts hours late, so "two intervals
have passed" is not yet "two runs were missed". Without it a monthly job that
last succeeded on the 24th is flagged on the morning the second run is due.

### `assessStaleness({ cron, hoursSinceLastCompletedRun, expectedHours })`

`null` when the workflow is within its expected cadence, otherwise a
description of how far past due it is.

### `trackerMarker(workflowId)`

The marker that ties an alert to its workflow.

Deliberately the SAME format `.github/actions/notify-workflow-outcome` has
used since 2026-05: `[workflow-fail:<id>]`. Eight issues already carry it
(#1627, #1613, #1566, #1425, #1371, #1035, #937, #914). Reusing it means this
monitor finds and closes those existing trackers rather than opening a second
parallel history for the same workflow.

### `decideAction({ outcome, hasOpenTracker })`

Decide the action for an outcome, given whether a tracker is already open.

Pure so it can be tested without touching the API. The rules:
  - a failure or a real timeout OPENS a tracker, or COMMENTS on the open one
    (multi-day outages produce one issue with a history, not one per run)
  - a success CLOSES an open tracker, and does nothing when none is open
  - everything else does nothing, and says why

### `trackerBody({ workflowId, outcome, runUrl, durationMinutes, ceilingMinutes })`

A tracker body that says what happened and how to check it.

Timeouts get different wording from failures on purpose: a timeout renders
grey rather than red in the Actions UI, so someone scanning for red misses
it, and the first triage question is different — "what got slower" rather
than "what broke".

### `GitHubApiError`

The smallest REST surface that opens, comments on and closes a tracker.

Deliberately raw fetch rather than a client library: this runs in a 5-minute
job whose only job is to report, and a dependency that fails to install turns
the alerting path off again — which is the exact failure this package exists
to end. Read capability stays read-only; nothing here can dispatch, re-run or
cancel a workflow, and test/workflow-outcome-monitor.test.js enforces that.

### `ghRequest(path, { token, method = 'GET', body, fetchImpl, sleepImpl = sleep, nowImpl = Date.now, maxAttempts = 3, maxRetryDelayMs = 120000, } = {})`

REST request with bounded, operation-aware retries.

Safe reads may be retried after network failures and 5xx responses. Mutating
requests are NOT blindly retried after those failures because GitHub may have
accepted the write before the connection was lost; repeating it could open or
comment twice. Explicit rate-limit responses are safe to retry because GitHub
rejected the request. Exhaustion always throws so a dropped alert is red.

### `findTracker(issues, workflowId)`

Find the open tracker for a workflow, matched on the MARKER rather than the
title. Titles get edited by people; the marker is the contract, and it is the
same one `.github/actions/notify-workflow-outcome` has written since 2026-05,
so this finds and closes the eight trackers that already exist instead of
starting a parallel history.

### `findMarkedIssue(issues, marker)`

The open, Actions-authored issue whose title carries `marker`, or null.

### `listOpenIssues(repo, { token, fetchImpl, maxPages = 20 } = {})`

Every open issue, following pagination.

A single per_page=100 request looks sufficient at today's 9 open issues and
fails silently the moment the repo passes 100: the tracker sits on page 2,
findTracker returns null, and every subsequent failure opens ANOTHER tracker
— the monitor spamming issues while appearing to work. The cap is a
belt-and-braces stop against a pathological repo, not an expected limit.

### `workflowIdFromPath(wfPath)`

The workflow id used in the marker is the workflow FILE's basename, not its
display name: the existing trackers read `[workflow-fail:build-hna-data]`
while the display name is "Build HNA Data Cache". Deriving it from the path
keeps this monitor matched to those issues.

### `latestRelevantRun(repo, workflowFile, branch, { token, fetchImpl } = {})`

Latest completed scheduled or manually dispatched run on the default branch.

### `STALE_MARKER`

ONE tracker for every silent schedule, not one per workflow. On first run a
repo with 68 scheduled workflows could have several overdue at once, and a
burst of issues is how a monitor gets muted. The issue body is the current
list; a comment is added only when that list changes, so a long outage is one
notification, not one a day.

### `scheduledCrons(yamlText)`

The cron expressions a workflow file declares (comments stripped).

### `workflowCadenceHours(crons)`

Shortest declared interval, in hours, or null when no cron parses.

### `listWorkflows(repo, { token, fetchImpl, maxPages = 10 } = {})`

Every workflow in the repo, with its enabled state, following pagination.

### `lastSuccessfulRun(repo, workflowFile, branch, { token, fetchImpl } = {})`

Latest SUCCESSFUL scheduled or dispatched run on the default branch.

Success, not merely completed: #1556 was a weekly job whose runs kept
completing as `cancelled` at the timeout, so "it ran" was true for fifteen
days while no data landed. A manual dispatch that succeeds counts, because the
data it produced is just as fresh.

### `staleIdsFromBody(body)`

The ids listed in a stale tracker's body, so a changed list can be told apart.

### `decideStaleAction({ staleIds, tracker })`

open / update / close / none, given the stale set now and the open tracker.

### `runStaleness({ repo, token, branch, workflowsDir, fetchImpl, now = Date.now()`

Judge every scheduled, enabled workflow against its own cadence. `mutate`
false prints the report and touches no issue: a dispatch from a feature
branch must never open or close a production tracker.
