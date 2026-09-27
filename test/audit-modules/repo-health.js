'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const HIGH_PRIORITY_LABELS = new Set(['urgent', 'critical', 'blocked']);
const BLOCKER_PATTERN = /\b(blocked by|depends on|blocks)\s+#\d+\b/i;

function parseRepositorySlug(env = process.env) {
    const slug = env.GITHUB_REPOSITORY || '';
    const [owner, repo] = slug.split('/');
    if (!owner || !repo) return null;
    return { owner, repo };
}

function workflowPathFor(file) {
    return `.github/workflows/${file}`;
}

function githubHeaders(token) {
    const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'housing-analytics-daily-audit',
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
}

// A GitHub API page cap. Past it a count is no longer a count, so the caller
// reports it as unavailable (null) rather than as the number it happened to
// reach — "100 open issues" when there are 140 is the same defect as "0".
const MAX_PAGES = 20;

function describeHttpFailure(label, res) {
    const remaining = res.headers && typeof res.headers.get === 'function'
        ? res.headers.get('x-ratelimit-remaining')
        : null;
    if ((res.status === 403 || res.status === 429) && remaining === '0') {
        return `${label} hit the GitHub API rate limit (HTTP ${res.status})`;
    }
    return `${label} returned HTTP ${res.status}`;
}

/**
 * One request, retried once on a 5XX or a network failure — the same policy
 * as the source-URL sweep (#1545). 4XX (auth, rate limit, not found) is not
 * retried: it will not clear in a second.
 */
async function requestWithRetry(fetchImpl, url, options, label) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let res;
        try {
            res = await fetchImpl(url, options);
        } catch (err) {
            lastError = new Error(`${label} failed: ${err && err.message ? err.message : String(err)}`);
            continue;
        }
        if (res.ok) return res;
        lastError = new Error(describeHttpFailure(label, res));
        if (res.status < 500) break;
    }
    throw lastError;
}

function createGithubClient({ token, fetchImpl = fetch, env = process.env } = {}) {
    const base = env.GITHUB_API_URL || 'https://api.github.com';
    const graphqlUrl = env.GITHUB_GRAPHQL_URL || `${base}/graphql`;

    async function json(apiPath) {
        const res = await requestWithRetry(fetchImpl, `${base}${apiPath}`, { headers: githubHeaders(token) }, apiPath);
        return res.json();
    }

    /**
     * Follows `page=` until a short page. `pick` extracts the array from a
     * response (REST list endpoints return an array; Actions wraps it).
     * Returns { items, complete } — complete is false when MAX_PAGES was hit.
     */
    async function paginate(apiPath, pick = body => body) {
        const items = [];
        const sep = apiPath.includes('?') ? '&' : '?';
        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const body = await json(`${apiPath}${sep}per_page=100&page=${page}`);
            const batch = pick(body) || [];
            items.push(...batch);
            if (batch.length < 100) return { items, complete: true };
        }
        return { items, complete: false };
    }

    async function graphql(query, variables) {
        const res = await requestWithRetry(fetchImpl, graphqlUrl, {
            method: 'POST',
            headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables }),
        }, 'graphql');
        const data = await res.json();
        if (data.errors && data.errors.length > 0) {
            throw new Error(data.errors.map(error => error.message).join('; '));
        }
        return data.data;
    }

    return { json, paginate, graphql };
}

function parseScheduledWorkflows() {
    if (!fs.existsSync(WORKFLOWS_DIR)) return [];
    return fs.readdirSync(WORKFLOWS_DIR)
        .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map(file => {
            const abs = path.join(WORKFLOWS_DIR, file);
            const content = fs.readFileSync(abs, 'utf8');
            const name = ((content.match(/^name:\s*(.+)$/m) || [])[1] || file).trim();
            const crons = [...content.matchAll(/cron:\s*(['"])([^'"]+)\1/g)].map(match => match[2]);
            return { file, path: workflowPathFor(file), name, crons };
        })
        .filter(workflow => workflow.crons.length > 0);
}

function parseNumberList(field) {
    if (!field || field === '*') return null;
    const parts = field.split(',');
    const values = [];
    for (const part of parts) {
        const trimmed = part.trim();
        if (/^\d+$/.test(trimmed)) {
            values.push(Number(trimmed));
            continue;
        }
        const step = trimmed.match(/^\*\/(\d+)$/);
        if (step) {
            return { step: Number(step[1]) };
        }
        return null;
    }
    return values;
}

function weeklyIntervalMs(days) {
    if (!Array.isArray(days) || days.length === 0) return null;
    const normalized = [...new Set(days.map(day => day === 7 ? 0 : day))].sort((a, b) => a - b);
    if (normalized.length === 1) return 7 * ONE_DAY_MS;
    let minGap = 7;
    for (let index = 0; index < normalized.length; index += 1) {
        const current = normalized[index];
        const next = normalized[(index + 1) % normalized.length];
        const gap = (next - current + 7) % 7 || 7;
        if (gap < minGap) minGap = gap;
    }
    return minGap * ONE_DAY_MS;
}

function inferCronIntervalMs(cron) {
    const fields = String(cron || '').trim().split(/\s+/);
    if (fields.length !== 5) return null;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

    if (/^\*\/\d+$/.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return Number(minute.slice(2)) * 60 * 1000;
    }
    if (/^\d+$/.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return ONE_HOUR_MS;
    }
    if (/^\*\/\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return Number(hour.slice(2)) * ONE_HOUR_MS;
    }
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return ONE_DAY_MS;
    }

    const dowValues = parseNumberList(dayOfWeek);
    if (dayOfMonth === '*' && month === '*' && Array.isArray(dowValues)) {
        return weeklyIntervalMs(dowValues);
    }

    const dayValues = parseNumberList(dayOfMonth);
    if (Array.isArray(dayValues) && month === '*' && dayOfWeek === '*') {
        return 31 * ONE_DAY_MS;
    }

    const monthStep = month.match(/^\*\/(\d+)$/);
    if (Array.isArray(dayValues) && monthStep && dayOfWeek === '*') {
        return Number(monthStep[1]) * 31 * ONE_DAY_MS;
    }

    const monthValues = parseNumberList(month);
    if (Array.isArray(dayValues) && Array.isArray(monthValues) && dayOfWeek === '*') {
        return 366 * ONE_DAY_MS;
    }

    return null;
}

// GitHub starts scheduled runs late — median ~180 min, and fetch-fred-data has
// never started less than 265 min late (AGENTS.md, #1555). Measuring from the
// last run's start cancels the typical delay but not its variance: a run that
// started on time followed by one that starts 265+ min late is a gap of
// interval + ~4.5h with nothing wrong. So every cadence, however short, gets
// at least SCHEDULE_LATENESS_MS of slack before it is called overdue.
const SCHEDULE_LATENESS_MS = 6 * ONE_HOUR_MS;

function overdueGraceMs(intervalMs) {
    return Math.max(SCHEDULE_LATENESS_MS, Math.min(24 * ONE_HOUR_MS, Math.round(intervalMs * 0.25)));
}

/** Shortest cadence across a workflow's crons, or null if none is understood. */
function workflowIntervalMs(crons) {
    const intervals = (crons || []).map(inferCronIntervalMs).filter(ms => ms);
    return intervals.length > 0 ? Math.min(...intervals) : null;
}

/**
 * Is a scheduled workflow overdue? lastRunAt null means no scheduled run was
 * ever returned — that is reported, but it is not the same as late.
 */
function isScheduleOverdue(lastRunAt, intervalMs, nowMs) {
    if (!lastRunAt || !intervalMs) return false;
    return nowMs > new Date(lastRunAt).getTime() + intervalMs + overdueGraceMs(intervalMs);
}

function checkStatus(hasFindings) {
    return hasFindings ? 'failed' : 'passed';
}

function repoIssue(severity, type, file, description, actual, recommendation, extra = {}) {
    return {
        severity,
        type,
        file,
        description,
        expected: extra.expected || '',
        actual,
        recommendation,
        ...extra,
    };
}

const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']);

function newestFirst(runs) {
    return [...(runs || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/**
 * Main-branch workflows whose LATEST completed run in the window failed.
 * A failure already followed by a success of the same workflow is resolved;
 * reporting it would turn every flaky-then-green cron into a daily alarm.
 */
function failingLatestRuns(runs) {
    const latest = new Map();
    for (const run of newestFirst(runs)) {
        if (run.status && run.status !== 'completed') continue;
        if (!latest.has(run.workflow_id)) latest.set(run.workflow_id, run);
    }
    return [...latest.values()].filter(run => FAILED_CONCLUSIONS.has(run.conclusion));
}

/**
 * deploy.yml runs with `concurrency: pages, cancel-in-progress: true`, so a
 * `cancelled` deploy is normally just superseded by the next push. Only a
 * failure since the last success, or no success at all, blocks the site.
 */
function deployState(runs) {
    const ordered = newestFirst(runs).filter(run => !run.status || run.status === 'completed');
    const successIndex = ordered.findIndex(run => run.conclusion === 'success');
    const lastSuccessfulDeploy = successIndex >= 0 ? ordered[successIndex] : null;
    const sinceSuccess = successIndex >= 0 ? ordered.slice(0, successIndex) : ordered;
    const recentDeployFailures = sinceSuccess.filter(run =>
        FAILED_CONCLUSIONS.has(run.conclusion) && run.conclusion !== 'cancelled');
    return {
        lastSuccessfulDeploy,
        recentDeployFailures,
        deployBlocked: !lastSuccessfulDeploy || recentDeployFailures.length > 0,
    };
}

async function collectActionsHealth(owner, repo, client, nowMs) {
    const sinceIso = new Date(nowMs - ONE_DAY_MS).toISOString();
    // Paginated: ci-checks, merge-ref-gate and the deploy watchdog alone start
    // ~80 runs a day, so a single page of 100 silently dropped the rest.
    const recent = await client.paginate(
        `/repos/${owner}/${repo}/actions/runs?branch=main&created=${encodeURIComponent('>=' + sinceIso)}`,
        body => body.workflow_runs
    );
    const failingRuns = failingLatestRuns(recent.items);

    const workflowsResponse = await client.paginate(`/repos/${owner}/${repo}/actions/workflows`, body => body.workflows);
    const workflowByPath = new Map(workflowsResponse.items.map(workflow => [workflow.path, workflow]));
    const recentScheduledRuns = await client.json(`/repos/${owner}/${repo}/actions/runs?branch=main&event=schedule&per_page=100`);
    const latestScheduledByWorkflowId = new Map();
    for (const run of newestFirst(recentScheduledRuns.workflow_runs)) {
        if (!latestScheduledByWorkflowId.has(run.workflow_id)) {
            latestScheduledByWorkflowId.set(run.workflow_id, run);
        }
    }
    const scheduled = parseScheduledWorkflows();
    const overdue = [];
    const neverRun = [];
    const unsupportedSchedules = [];

    for (const workflow of scheduled) {
        const intervalMs = workflowIntervalMs(workflow.crons);
        if (!intervalMs) {
            unsupportedSchedules.push({ name: workflow.name, path: workflow.path, cron: workflow.crons.join(', ') });
            continue;
        }
        const remote = workflowByPath.get(workflow.path);
        if (!remote || remote.state !== 'active') continue;
        let lastRun = latestScheduledByWorkflowId.get(remote.id) || null;
        if (!lastRun) {
            const runs = await client.json(`/repos/${owner}/${repo}/actions/workflows/${remote.id}/runs?branch=main&event=schedule&per_page=1`);
            lastRun = (runs.workflow_runs || [])[0] || null;
        }
        if (!lastRun) {
            neverRun.push({ name: workflow.name, path: workflow.path, cron: workflow.crons.join(', '), lastRunAt: null, html_url: remote.html_url });
            continue;
        }
        const lastRunAt = lastRun.run_started_at || lastRun.created_at;
        if (isScheduleOverdue(lastRunAt, intervalMs, nowMs)) {
            overdue.push({ name: workflow.name, path: workflow.path, cron: workflow.crons.join(', '), lastRunAt, html_url: lastRun.html_url });
        }
    }

    const deployRuns = await client.json(`/repos/${owner}/${repo}/actions/workflows/deploy.yml/runs?branch=main&per_page=20`);
    const deploy = deployState(deployRuns.workflow_runs);

    const issues = [];
    // high, not critical: the failing workflow is already red on its own, and
    // making the audit exit non-zero for it would put a second red mark on the
    // same defect every day any of ~70 workflows fails.
    for (const run of failingRuns.slice(0, 12)) {
        issues.push(repoIssue(
            'high',
            'repo',
            '.github/workflows',
            `Latest main run ${run.conclusion}: ${run.name}`,
            `${run.conclusion} at ${run.html_url}`,
            'Open the run and inspect the failed job. A cancelled run may have hit timeout-minutes.',
            { link: run.html_url }
        ));
    }
    for (const workflow of overdue.slice(0, 12)) {
        issues.push(repoIssue(
            'high',
            'repo',
            workflow.path,
            `Scheduled workflow overdue: ${workflow.name}`,
            `Last run ${workflow.lastRunAt}`,
            'Inspect the workflow schedule and the last run for stalls or missed dispatches.',
            { link: workflow.html_url }
        ));
    }
    for (const run of deploy.recentDeployFailures.slice(0, 6)) {
        issues.push(repoIssue(
            'critical',
            'repo',
            '.github/workflows/deploy.yml',
            'Deployment failed and has not succeeded since',
            `${run.conclusion} at ${run.html_url}`,
            'Fix the deployment failure before treating the repository as healthy.',
            { link: run.html_url }
        ));
    }
    if (!deploy.lastSuccessfulDeploy) {
        issues.push(repoIssue(
            'critical',
            'repo',
            '.github/workflows/deploy.yml',
            'No successful deploy found on main',
            'No successful deploy run was returned by the GitHub Actions API',
            'Inspect deploy.yml and the Actions history to restore a successful deployment path.'
        ));
    }

    return {
        issues,
        summary: {
            // null, not a short list, when the run listing was cut off.
            failingRuns: recent.complete ? failingRuns : null,
            overdueWorkflows: overdue,
            neverRun,
            unsupportedSchedules,
            lastSuccessfulDeploy: deploy.lastSuccessfulDeploy,
            recentDeployFailures: deploy.recentDeployFailures,
            deployBlocked: deploy.deployBlocked,
        },
        check: {
            name: 'GitHub Actions Health',
            critical: false,
            status: checkStatus(failingRuns.length > 0 || overdue.length > 0 || deploy.deployBlocked),
            summary: `${recent.complete ? failingRuns.length : 'unknown number of'} failing main workflows, ${overdue.length} overdue schedules`,
        },
    };
}

const PULL_REQUEST_QUERY = `
    query RepoHealthPullRequests($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequests(states: OPEN, first: 100, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            title
            url
            updatedAt
            mergeable
            reviewRequests(first: 1) { totalCount }
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
          }
        }
      }
    }
`;

async function collectPullRequestHealth(owner, repo, client, nowMs) {
    const pulls = [];
    let totalCount = null;
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const data = await client.graphql(PULL_REQUEST_QUERY, { owner, repo, cursor });
        const conn = ((data || {}).repository || {}).pullRequests;
        if (!conn) throw new Error('graphql returned no pullRequests connection');
        if (typeof conn.totalCount === 'number') totalCount = conn.totalCount;
        pulls.push(...(conn.nodes || []));
        if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
    }
    const failingChecks = [];
    const staleReviews = [];
    const conflicts = [];
    const inactive = [];
    for (const pr of pulls) {
        const updatedAtMs = new Date(pr.updatedAt).getTime();
        if ((pr.reviewRequests && pr.reviewRequests.totalCount > 0) && nowMs - updatedAtMs > 3 * ONE_DAY_MS) {
            staleReviews.push(pr);
        }
        if (nowMs - updatedAtMs > 7 * ONE_DAY_MS) inactive.push(pr);

        const rollup = (((pr.commits || {}).nodes || [])[0] || {}).commit;
        const state = rollup && rollup.statusCheckRollup ? rollup.statusCheckRollup.state : null;
        if (state === 'FAILURE' || state === 'ERROR') failingChecks.push(pr);
        if (pr.mergeable === 'CONFLICTING') conflicts.push(pr);
    }

    const issues = [];
    for (const pr of failingChecks.slice(0, 10)) {
        issues.push(repoIssue('high', 'repo', `PR #${pr.number}`, `Open PR has failing checks: ${pr.title}`, pr.url,
            'Open the PR checks tab and fix or rerun the failing jobs.', { link: pr.url }));
    }
    for (const pr of staleReviews.slice(0, 10)) {
        issues.push(repoIssue('medium', 'repo', `PR #${pr.number}`, `Review request is stale (>3 days): ${pr.title}`,
            `Last activity ${pr.updatedAt}`, 'Nudge reviewers or update the PR so the requested review can move.', { link: pr.url }));
    }
    for (const pr of conflicts.slice(0, 10)) {
        issues.push(repoIssue('high', 'repo', `PR #${pr.number}`, `PR has merge conflicts: ${pr.title}`, pr.url,
            'Update the branch and resolve conflicts before merge.', { link: pr.url }));
    }
    for (const pr of inactive.slice(0, 10)) {
        issues.push(repoIssue('low', 'repo', `PR #${pr.number}`, `PR inactive for >7 days: ${pr.title}`,
            `Last activity ${pr.updatedAt}`, 'Confirm whether the PR still needs action or should be closed.', { link: pr.url }));
    }

    return {
        issues,
        summary: {
            // The connection's totalCount, not how many nodes happened to be read.
            openCount: totalCount,
            failingChecks,
            staleReviews,
            conflicts,
            inactive,
        },
        check: {
            name: 'Pull Request Triage',
            critical: false,
            status: checkStatus(failingChecks.length > 0 || staleReviews.length > 0 || conflicts.length > 0 || inactive.length > 0),
            summary: `${totalCount === null ? 'unknown number of' : totalCount} open PRs`,
        },
    };
}

async function collectIssueHealth(owner, repo, client, nowMs) {
    const sinceIso = new Date(nowMs - ONE_DAY_MS).toISOString();
    const open = await client.paginate(`/repos/${owner}/${repo}/issues?state=open&sort=updated&direction=desc`);
    const closed = await client.paginate(`/repos/${owner}/${repo}/issues?state=closed&since=${encodeURIComponent(sinceIso)}`);
    const openIssues = open.items.filter(item => !item.pull_request);
    const closedIssues = closed.items.filter(item => !item.pull_request);

    const highPriority = openIssues.filter(issue => (issue.labels || []).some(label => HIGH_PRIORITY_LABELS.has(String(label.name || '').toLowerCase())));
    const blockers = openIssues.filter(issue =>
        (issue.labels || []).some(label => String(label.name || '').toLowerCase() === 'blocked') ||
        BLOCKER_PATTERN.test(issue.body || '')
    );
    const longstanding = openIssues.filter(issue => {
        const createdAt = new Date(issue.created_at).getTime();
        const updatedAt = new Date(issue.updated_at).getTime();
        return nowMs - createdAt > 30 * ONE_DAY_MS && nowMs - updatedAt > 30 * ONE_DAY_MS;
    });

    const issues = [];
    for (const issue of highPriority.slice(0, 10)) {
        issues.push(repoIssue('high', 'repo', `Issue #${issue.number}`, `High-priority issue needs triage: ${issue.title}`, issue.html_url,
            'Review the urgent/critical/blocked backlog and assign an owner or next action.', { link: issue.html_url }));
    }
    for (const issue of blockers.slice(0, 10)) {
        issues.push(repoIssue('medium', 'repo', `Issue #${issue.number}`, `Possible blocker or dependency: ${issue.title}`, issue.html_url,
            'Review the dependency note and confirm what work is blocked.', { link: issue.html_url }));
    }
    for (const issue of longstanding.slice(0, 10)) {
        issues.push(repoIssue('low', 'repo', `Issue #${issue.number}`, `Longstanding inactive issue (>30 days): ${issue.title}`,
            `Last activity ${issue.updated_at}`, 'Confirm whether the issue should be refreshed, broken down, or closed.', { link: issue.html_url }));
    }

    return {
        issues,
        summary: {
            // null when a listing was cut off at MAX_PAGES: a capped count is not a count.
            openCount: open.complete ? openIssues.length : null,
            newlyOpenedCount: open.complete && closed.complete
                ? openIssues.concat(closedIssues).filter(issue => issue.created_at >= sinceIso).length
                : null,
            closedCount: closed.complete
                ? closedIssues.filter(issue => issue.closed_at && issue.closed_at >= sinceIso).length
                : null,
            highPriority,
            blockers,
            longstanding,
        },
        check: {
            name: 'Issues Inventory',
            critical: false,
            status: checkStatus(highPriority.length > 0 || blockers.length > 0 || longstanding.length > 0),
            summary: `${open.complete ? openIssues.length : 'unknown number of'} open issues`,
        },
    };
}

function unavailableCheck(name, summary, details) {
    return { name, critical: false, status: 'unavailable', summary, details };
}

/**
 * Collects repository health. Never throws, and never fails the audit on its
 * own: each GitHub API section is independent, and a section that cannot be
 * read (network, rate limit, missing token) is reported as `unavailable` with
 * its data `null` — never as zero findings. None of these checks is critical:
 * an API hiccup is not a defect in the site.
 */
async function collectRepoHealth({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
    const repoSlug = parseRepositorySlug(env);
    const token = env.GITHUB_TOKEN || '';
    const empty = { issues: [], actions: null, pullRequests: null, issueInventory: null };

    if (!repoSlug) {
        return {
            ...empty,
            checks: [{
                name: 'Repository Health Summary',
                critical: false,
                status: 'skipped',
                summary: 'GITHUB_REPOSITORY not set',
                details: 'Repository context was unavailable outside GitHub Actions.',
            }],
        };
    }

    if (!token) {
        return {
            ...empty,
            checks: [unavailableCheck('Repository Health Summary', 'GitHub API token missing', 'GITHUB_TOKEN was not set.')],
        };
    }

    const { owner, repo } = repoSlug;
    const client = createGithubClient({ token, fetchImpl, env });
    const result = { ...empty, checks: [] };
    const sections = [
        { key: 'actions', name: 'GitHub Actions Health', collect: collectActionsHealth },
        { key: 'pullRequests', name: 'Pull Request Triage', collect: collectPullRequestHealth },
        { key: 'issueInventory', name: 'Issues Inventory', collect: collectIssueHealth },
    ];
    for (const section of sections) {
        try {
            const out = await section.collect(owner, repo, client, now);
            result.issues = result.issues.concat(out.issues);
            result.checks.push(out.check);
            result[section.key] = out.summary;
        } catch (err) {
            const message = err && err.message ? err.message : String(err);
            result.checks.push(unavailableCheck(section.name, 'GitHub API unavailable', message));
            result[section.key] = null;
        }
    }
    return result;
}

module.exports = {
    collectRepoHealth,
    createGithubClient,
    deployState,
    failingLatestRuns,
    inferCronIntervalMs,
    isScheduleOverdue,
    parseScheduledWorkflows,
    workflowIntervalMs,
    SCHEDULE_LATENESS_MS,
};
