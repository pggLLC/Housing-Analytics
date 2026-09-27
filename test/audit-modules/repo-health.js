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

function parseRepositorySlug() {
    const slug = process.env.GITHUB_REPOSITORY || '';
    const [owner, repo] = slug.split('/');
    if (!owner || !repo) return null;
    return { owner, repo };
}

function workflowPathFor(file) {
    return `.github/workflows/${file}`;
}

function isoDateDaysAgo(days) {
    return new Date(Date.now() - days * ONE_DAY_MS).toISOString();
}

function toRelative(filePath) {
    return filePath.replace(ROOT + path.sep, '').replace(/\\/g, '/');
}

function githubHeaders(token) {
    const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'housing-analytics-daily-audit',
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
}

async function githubJson(apiPath, token) {
    const base = process.env.GITHUB_API_URL || 'https://api.github.com';
    const url = `${base}${apiPath}`;
    const res = await fetch(url, { headers: githubHeaders(token) });
    if (!res.ok) {
        throw new Error(`${apiPath} returned HTTP ${res.status}`);
    }
    return res.json();
}

function parseScheduledWorkflows() {
    if (!fs.existsSync(WORKFLOWS_DIR)) return [];
    return fs.readdirSync(WORKFLOWS_DIR)
        .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map(file => {
            const abs = path.join(WORKFLOWS_DIR, file);
            const content = fs.readFileSync(abs, 'utf8');
            const name = ((content.match(/^name:\s*(.+)$/m) || [])[1] || file).trim();
            const crons = [...content.matchAll(/cron:\s*'([^']+)'/g)].map(match => match[1]);
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

function overdueGraceMs(intervalMs) {
    return Math.max(3 * ONE_HOUR_MS, Math.min(24 * ONE_HOUR_MS, Math.round(intervalMs * 0.25)));
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

async function collectActionsHealth(owner, repo, token) {
    const sinceIso = isoDateDaysAgo(1);
    const recentRuns = await githubJson(`/repos/${owner}/${repo}/actions/runs?branch=main&per_page=100`, token);
    const failingRuns = (recentRuns.workflow_runs || []).filter(run =>
        run.created_at >= sinceIso &&
        ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion)
    );

    const workflowsResponse = await githubJson(`/repos/${owner}/${repo}/actions/workflows?per_page=100`, token);
    const workflowByPath = new Map((workflowsResponse.workflows || []).map(workflow => [workflow.path, workflow]));
    const scheduled = parseScheduledWorkflows();
    const overdue = [];
    const unsupportedSchedules = [];

    for (const workflow of scheduled) {
        const intervalMs = inferCronIntervalMs(workflow.crons[0]);
        if (!intervalMs) {
            unsupportedSchedules.push({
                name: workflow.name,
                path: workflow.path,
                cron: workflow.crons[0],
            });
            continue;
        }
        const remote = workflowByPath.get(workflow.path);
        if (!remote || remote.state !== 'active') continue;
        const runs = await githubJson(`/repos/${owner}/${repo}/actions/workflows/${remote.id}/runs?branch=main&event=schedule&per_page=1`, token);
        const lastRun = (runs.workflow_runs || [])[0];
        if (!lastRun) {
            overdue.push({
                name: workflow.name,
                path: workflow.path,
                cron: workflow.crons[0],
                lastRunAt: null,
                html_url: remote.html_url,
            });
            continue;
        }
        const lastRunAt = lastRun.run_started_at || lastRun.created_at;
        const dueAt = new Date(lastRunAt).getTime() + intervalMs + overdueGraceMs(intervalMs);
        if (Date.now() > dueAt) {
            overdue.push({
                name: workflow.name,
                path: workflow.path,
                cron: workflow.crons[0],
                lastRunAt,
                html_url: lastRun.html_url,
            });
        }
    }

    const deployRuns = await githubJson(`/repos/${owner}/${repo}/actions/workflows/deploy.yml/runs?branch=main&per_page=20`, token);
    const deployWorkflowRuns = deployRuns.workflow_runs || [];
    const lastSuccessfulDeploy = deployWorkflowRuns.find(run => run.conclusion === 'success') || null;
    const recentDeployFailures = deployWorkflowRuns.filter(run =>
        run.created_at >= sinceIso &&
        ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion)
    );

    const issues = [];
    for (const run of failingRuns.slice(0, 12)) {
        issues.push(repoIssue(
            'critical',
            'repo',
            '.github/workflows',
            `Main workflow failed or was cancelled: ${run.name}`,
            `${run.conclusion} at ${run.html_url}`,
            'Open the run and inspect the failed job before the next scheduled cycle.',
            { link: run.html_url }
        ));
    }
    for (const workflow of overdue.slice(0, 12)) {
        issues.push(repoIssue(
            'high',
            'repo',
            workflow.path,
            `Scheduled workflow overdue: ${workflow.name}`,
            workflow.lastRunAt ? `Last run ${workflow.lastRunAt}` : 'No scheduled run found',
            'Inspect the workflow schedule and the last run for stalls or missed dispatches.',
            { link: workflow.html_url }
        ));
    }
    for (const run of recentDeployFailures.slice(0, 6)) {
        issues.push(repoIssue(
            'critical',
            'repo',
            '.github/workflows/deploy.yml',
            'Deployment workflow failed or was cancelled',
            `${run.conclusion} at ${run.html_url}`,
            'Fix the deployment failure before treating the repository as healthy.',
            { link: run.html_url }
        ));
    }
    if (!lastSuccessfulDeploy) {
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
            failingRuns,
            overdueWorkflows: overdue,
            unsupportedSchedules,
            lastSuccessfulDeploy,
            recentDeployFailures,
        },
        check: {
            name: 'GitHub Actions Health',
            critical: true,
            status: checkStatus(failingRuns.length > 0 || overdue.length > 0 || recentDeployFailures.length > 0 || !lastSuccessfulDeploy),
            summary: `${failingRuns.length} failed/cancelled main runs, ${overdue.length} overdue schedules`,
        },
    };
}

async function collectPullRequestHealth(owner, repo, token) {
    const pulls = await githubJson(`/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=updated&direction=desc`, token);
    const failingChecks = [];
    const staleReviews = [];
    const conflicts = [];
    const inactive = [];
    const warnings = [];

    await Promise.all((pulls || []).map(async pr => {
        const updatedAtMs = new Date(pr.updated_at).getTime();
        if ((pr.requested_reviewers || []).length > 0 || (pr.requested_teams || []).length > 0) {
            if (Date.now() - updatedAtMs > 3 * ONE_DAY_MS) staleReviews.push(pr);
        }
        if (Date.now() - updatedAtMs > 7 * ONE_DAY_MS) inactive.push(pr);

        try {
            const status = await githubJson(`/repos/${owner}/${repo}/commits/${pr.head.sha}/status`, token);
            if (['failure', 'error'].includes(status.state)) failingChecks.push(pr);
        } catch (err) {
            warnings.push(`Status lookup failed for PR #${pr.number}: ${err.message}`);
        }

        try {
            const detail = await githubJson(`/repos/${owner}/${repo}/pulls/${pr.number}`, token);
            if (detail.mergeable === false || detail.mergeable_state === 'dirty') conflicts.push(detail);
        } catch (err) {
            warnings.push(`Mergeability lookup failed for PR #${pr.number}: ${err.message}`);
        }
    }));

    const issues = [];
    for (const pr of failingChecks.slice(0, 10)) {
        issues.push(repoIssue(
            'high',
            'repo',
            `PR #${pr.number}`,
            `Open PR has failing checks: ${pr.title}`,
            pr.html_url,
            'Open the PR checks tab and fix or rerun the failing jobs.',
            { link: pr.html_url }
        ));
    }
    for (const pr of staleReviews.slice(0, 10)) {
        issues.push(repoIssue(
            'medium',
            'repo',
            `PR #${pr.number}`,
            `Review request is stale (>3 days): ${pr.title}`,
            `Last activity ${pr.updated_at}`,
            'Nudge reviewers or update the PR so the requested review can move.',
            { link: pr.html_url }
        ));
    }
    for (const pr of conflicts.slice(0, 10)) {
        issues.push(repoIssue(
            'high',
            'repo',
            `PR #${pr.number}`,
            `PR has merge conflicts: ${pr.title}`,
            pr.html_url,
            'Update the branch and resolve conflicts before merge.',
            { link: pr.html_url }
        ));
    }
    for (const pr of inactive.slice(0, 10)) {
        issues.push(repoIssue(
            'low',
            'repo',
            `PR #${pr.number}`,
            `PR inactive for >7 days: ${pr.title}`,
            `Last activity ${pr.updated_at}`,
            'Confirm whether the PR still needs action or should be closed.',
            { link: pr.html_url }
        ));
    }

    return {
        issues,
        summary: {
            openCount: pulls.length,
            failingChecks,
            staleReviews,
            conflicts,
            inactive,
            warnings,
        },
        check: {
            name: 'Pull Request Triage',
            critical: false,
            status: warnings.length > 0 ? 'unavailable' : checkStatus(
                failingChecks.length > 0 || staleReviews.length > 0 || conflicts.length > 0 || inactive.length > 0
            ),
            summary: `${pulls.length} open PRs`,
            details: warnings.join(' | '),
        },
    };
}

async function collectIssueHealth(owner, repo, token) {
    const openResults = await githubJson(`/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`, token);
    const closedResults = await githubJson(`/repos/${owner}/${repo}/issues?state=closed&per_page=100&sort=updated&direction=desc`, token);
    const openIssues = (openResults || []).filter(item => !item.pull_request);
    const closedIssues = (closedResults || []).filter(item => !item.pull_request);

    const sinceIso = isoDateDaysAgo(1);
    const highPriority = openIssues.filter(issue => (issue.labels || []).some(label => HIGH_PRIORITY_LABELS.has(String(label.name || '').toLowerCase())));
    const blockers = openIssues.filter(issue =>
        (issue.labels || []).some(label => String(label.name || '').toLowerCase() === 'blocked') ||
        BLOCKER_PATTERN.test(issue.body || '')
    );
    const longstanding = openIssues.filter(issue => {
        const createdAt = new Date(issue.created_at).getTime();
        const updatedAt = new Date(issue.updated_at).getTime();
        return Date.now() - createdAt > 30 * ONE_DAY_MS && Date.now() - updatedAt > 30 * ONE_DAY_MS;
    });

    const issues = [];
    for (const issue of highPriority.slice(0, 10)) {
        issues.push(repoIssue(
            'high',
            'repo',
            `Issue #${issue.number}`,
            `High-priority issue needs triage: ${issue.title}`,
            issue.html_url,
            'Review the urgent/critical/blocked backlog and assign an owner or next action.',
            { link: issue.html_url }
        ));
    }
    for (const issue of blockers.slice(0, 10)) {
        issues.push(repoIssue(
            'medium',
            'repo',
            `Issue #${issue.number}`,
            `Possible blocker or dependency: ${issue.title}`,
            issue.html_url,
            'Review the dependency note and confirm what work is blocked.',
            { link: issue.html_url }
        ));
    }
    for (const issue of longstanding.slice(0, 10)) {
        issues.push(repoIssue(
            'low',
            'repo',
            `Issue #${issue.number}`,
            `Longstanding inactive issue (>30 days): ${issue.title}`,
            `Last activity ${issue.updated_at}`,
            'Confirm whether the issue should be refreshed, broken down, or closed.',
            { link: issue.html_url }
        ));
    }

    return {
        issues,
        summary: {
            openCount: openIssues.length,
            newlyOpenedCount: openIssues.filter(issue => issue.created_at >= sinceIso).length,
            closedCount: closedIssues.filter(issue => issue.closed_at && issue.closed_at >= sinceIso).length,
            highPriority,
            blockers,
            longstanding,
        },
        check: {
            name: 'Issues Inventory',
            critical: false,
            status: checkStatus(highPriority.length > 0 || blockers.length > 0 || longstanding.length > 0),
            summary: `${openIssues.length} open issues`,
        },
    };
}

async function collectRepoHealth() {
    const repoSlug = parseRepositorySlug();
    const token = process.env.GITHUB_TOKEN || '';

    if (!repoSlug) {
        return {
            issues: [],
            checks: [{
                name: 'Repository Health Summary',
                critical: true,
                status: 'skipped',
                summary: 'GITHUB_REPOSITORY not set',
                details: 'Repository context was unavailable outside GitHub Actions.',
            }],
            actions: null,
            pullRequests: null,
            issueInventory: null,
        };
    }

    if (!token) {
        return {
            issues: [
                repoIssue(
                    'critical',
                    'repo',
                    '.github/workflows/daily-audit-system.yml',
                    'Repository-health audit cannot call the GitHub API',
                    'GITHUB_TOKEN was not provided to the audit step',
                    'Pass github.token to the daily audit step so repo-health checks can run.'
                ),
            ],
            checks: [{
                name: 'Repository Health Summary',
                critical: true,
                status: 'unavailable',
                summary: 'GitHub API token missing',
                details: 'GITHUB_TOKEN was not set.',
            }],
            actions: null,
            pullRequests: null,
            issueInventory: null,
        };
    }

    try {
        const { owner, repo } = repoSlug;
        const checks = [];
        const issues = [];

        const actions = await collectActionsHealth(owner, repo, token);
        issues.push(...actions.issues);
        checks.push(actions.check);

        const pullRequests = await collectPullRequestHealth(owner, repo, token);
        issues.push(...pullRequests.issues);
        checks.push(pullRequests.check);

        const issueInventory = await collectIssueHealth(owner, repo, token);
        issues.push(...issueInventory.issues);
        checks.push(issueInventory.check);

        return {
            issues,
            checks,
            actions: actions.summary,
            pullRequests: pullRequests.summary,
            issueInventory: issueInventory.summary,
        };
    } catch (err) {
        return {
            issues: [
                repoIssue(
                    'critical',
                    'repo',
                    '.github/workflows/daily-audit-system.yml',
                    'Repository-health audit failed internally',
                    err && err.message ? err.message : String(err),
                    'Inspect the repo-health collector and GitHub API responses before treating the audit as healthy.'
                ),
            ],
            checks: [{
                name: 'Repository Health Summary',
                critical: true,
                status: 'unavailable',
                summary: 'GitHub API audit failed',
                details: err && err.message ? err.message : String(err),
            }],
            actions: null,
            pullRequests: null,
            issueInventory: null,
        };
    }
}

module.exports = {
    collectRepoHealth,
    inferCronIntervalMs,
    parseScheduledWorkflows,
};
