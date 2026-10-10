'use strict';

/**
 * Guards for the daily audit's repository-health section (#1972).
 *
 * The audit step no longer has continue-on-error, so whatever this module
 * returns decides whether the scheduled job goes red. Each block below pins a
 * behaviour, never a sentence of copy:
 *
 *  - a GitHub API that cannot be read reports `unavailable` and `null`, never
 *    a count of 0, and never fails the job on its own;
 *  - counts are the real total, not the first page of 30 or 100;
 *  - a schedule is "overdue" only past GitHub's documented lateness (#1555);
 *  - a deploy cancelled by `cancel-in-progress` is not a blocked deploy;
 *  - the email subject, the HTML banner and the exit code agree, because all
 *    three read one status function.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
    collectRepoHealth,
    deployState,
    failingLatestRuns,
    isScheduleOverdue,
    parseScheduledWorkflows,
    workflowIntervalMs,
    SCHEDULE_LATENESS_MS,
} = require('./audit-modules/repo-health.js');
const { auditExitCode, overallStatus, summarizeChecks } = require('./audit-modules/audit-status.js');
const { buildEmailSubject, buildHtmlReport } = require('./audit-modules/report-generator.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-27T12:00:00Z');
const ENV = { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', GITHUB_API_URL: 'https://example.com/api' };

let failures = 0;
const tests = [];
function run(name, fn) { tests.push({ name, fn }); }

function response(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: key => headers[key.toLowerCase()] ?? null },
        json: async () => body,
    };
}

/** A fake GitHub API. `routes` maps a predicate on the URL to a handler. */
function fakeGithub(routes) {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        calls.push(url);
        for (const [match, handler] of routes) {
            if (match(url, options)) return handler(url, options);
        }
        return response(404, { message: 'not found' });
    };
    return { fetchImpl, calls };
}

const pageOf = url => Number(new URL(url).searchParams.get('page') || 1);
const iso = ms => new Date(ms).toISOString();

/** A healthy API, with overrides per route. Page sizes follow the real API. */
function healthyRoutes({ runs = [], openIssues = [], closedIssues = [], prPages = [[]], deployRuns } = {}) {
    const paged = items => url => {
        const page = pageOf(url);
        return items.slice((page - 1) * 100, page * 100);
    };
    const runsPage = paged(runs);
    const openPage = paged(openIssues);
    const closedPage = paged(closedIssues);
    return [
        [url => url.includes('/actions/runs?branch=main&created='), url => response(200, { workflow_runs: runsPage(url) })],
        [url => url.includes('/actions/workflows?'), () => response(200, { workflows: [] })],
        [url => url.includes('/actions/runs?branch=main&event=schedule'), () => response(200, { workflow_runs: [] })],
        [url => url.includes('/actions/workflows/deploy.yml/runs'), () => response(200, {
            workflow_runs: deployRuns || [{ status: 'completed', conclusion: 'success', created_at: iso(NOW - HOUR), html_url: 'd' }],
        })],
        [url => url.includes('/issues?state=open'), url => response(200, openPage(url))],
        [url => url.includes('/issues?state=closed'), url => response(200, closedPage(url))],
        [url => url.endsWith('/graphql'), (url, options) => {
            const { cursor } = JSON.parse(options.body).variables;
            const index = cursor ? Number(cursor) : 0;
            const total = prPages.reduce((n, p) => n + p.length, 0);
            return response(200, { data: { repository: { pullRequests: {
                totalCount: total,
                pageInfo: { hasNextPage: index + 1 < prPages.length, endCursor: String(index + 1) },
                nodes: prPages[index],
            } } } });
        }],
    ];
}

// ── 1. An API that cannot be read is unavailable, not zero, and not fatal ───

run('a network outage makes every repo-health section unavailable and null, and the job still passes', async () => {
    const { fetchImpl } = fakeGithub([[() => true, () => { throw new Error('ECONNRESET'); }]]);
    const health = await collectRepoHealth({ env: ENV, fetchImpl, now: NOW });
    assert.equal(health.checks.length, 3, 'one check per section, so the report shows which part is missing');
    for (const check of health.checks) {
        assert.equal(check.status, 'unavailable', check.name);
        assert.equal(check.critical, false, check.name + ' must not be critical: an API outage is not a site defect');
        assert.match(check.details, /ECONNRESET/, 'the reason travels with the status');
    }
    assert.equal(health.actions, null);
    assert.equal(health.pullRequests, null);
    assert.equal(health.issueInventory, null);
    assert.deepEqual(health.issues, [], 'an outage is not a finding');
    const auditHealth = summarizeChecks(health.checks);
    assert.equal(auditExitCode({ critical: 0 }, auditHealth), 0,
        'with continue-on-error gone, a GitHub API hiccup alone must not turn the scheduled job red');
    assert.notEqual(overallStatus({ summary: { critical: 0, high: 0, total: 0 }, auditHealth, repoHealth: health }).key, 'healthy',
        'but it must not read as healthy either');
});

run('one failing section does not take the others down with it', async () => {
    const routes = healthyRoutes();
    routes.unshift([url => url.endsWith('/graphql'), () => response(502, {})]);
    const { fetchImpl } = fakeGithub(routes);
    const health = await collectRepoHealth({ env: ENV, fetchImpl, now: NOW });
    const byName = Object.fromEntries(health.checks.map(c => [c.name, c.status]));
    assert.equal(byName['Pull Request Triage'], 'unavailable');
    assert.equal(byName['Issues Inventory'], 'passed');
    assert.equal(byName['GitHub Actions Health'], 'passed');
    assert.equal(health.pullRequests, null);
    assert.notEqual(health.issueInventory, null);
});

run('a rate limit is named as one and is not retried; a 5XX is retried once', async () => {
    const limited = fakeGithub([[() => true, () => response(403, {}, { 'x-ratelimit-remaining': '0' })]]);
    const health = await collectRepoHealth({ env: ENV, fetchImpl: limited.fetchImpl, now: NOW });
    assert.match(health.checks[0].details, /rate limit/i, 'the reader must be told why the section is missing');
    assert.equal(limited.calls.length, 3, 'one call per section: a 403 will not clear in a second');

    let first = true;
    const routes = healthyRoutes();
    routes.unshift([url => url.includes('/issues?state=open') && first, () => { first = false; return response(503, {}); }]);
    const flaky = fakeGithub(routes);
    const recovered = await collectRepoHealth({ env: ENV, fetchImpl: flaky.fetchImpl, now: NOW });
    assert.equal(recovered.checks.find(c => c.name === 'Issues Inventory').status, 'passed',
        'a single 503 is retried, the same policy as the source-URL sweep (#1545)');
});

run('a GitHub API call that never answers times out, is retried once, then goes unavailable', async () => {
    const { REQUEST_TIMEOUT_MS } = require('./audit-modules/repo-health.js');
    assert.ok(REQUEST_TIMEOUT_MS >= 10000 && REQUEST_TIMEOUT_MS <= 30000,
        'the production limit must sit well inside the job\'s 30-minute timeout-minutes');
    const hung = fakeGithub([[() => true, () => new Promise(() => {})]]);
    let watchdog;
    const health = await Promise.race([
        collectRepoHealth({ env: ENV, fetchImpl: hung.fetchImpl, now: NOW, timeoutMs: 20 }),
        new Promise(resolve => { watchdog = setTimeout(() => resolve(null), 5000); }),
    ]);
    clearTimeout(watchdog);
    assert.ok(health, 'the audit must come back, not hang until the job\'s timeout-minutes cancels it');
    for (const check of health.checks) {
        assert.equal(check.status, 'unavailable', check.name);
        assert.match(check.details, /timed out/, 'the reason travels with the status');
    }
    assert.equal(hung.calls.length, 6, 'each section: one attempt plus one retry');

    // A stall on the first attempt only is recovered by the retry.
    const routes = healthyRoutes();
    let stalled = false;
    routes.unshift([url => url.includes('/issues?state=open') && !stalled, () => { stalled = true; return new Promise(() => {}); }]);
    const once = fakeGithub(routes);
    const recovered = await collectRepoHealth({ env: ENV, fetchImpl: once.fetchImpl, now: NOW, timeoutMs: 20 });
    assert.equal(recovered.checks.find(c => c.name === 'Issues Inventory').status, 'passed');
});

run('an active scheduled workflow that has never run is a finding once it has had time to run', async () => {
    const [scheduled] = parseScheduledWorkflows().filter(w => w.file === 'daily-audit-system.yml');
    assert.ok(scheduled, 'precondition: a real scheduled workflow to point the fake API at');
    const workflow = createdAt => ({ id: 77, path: scheduled.path, state: 'active', html_url: 'w', created_at: createdAt });
    const routesFor = remote => {
        const routes = healthyRoutes();
        routes.unshift([url => url.includes('/actions/workflows?'), () => response(200, { workflows: [remote] })]);
        routes.unshift([url => url.includes('/actions/workflows/77/runs'), () => response(200, { workflow_runs: [] })]);
        return routes;
    };

    const old = await collectRepoHealth({ env: ENV, fetchImpl: fakeGithub(routesFor(workflow(iso(NOW - 30 * DAY)))).fetchImpl, now: NOW });
    const check = old.checks.find(c => c.name === 'GitHub Actions Health');
    assert.equal(check.status, 'failed', 'a workflow that never fires must not leave the check green');
    const finding = old.issues.find(i => i.file === scheduled.path);
    assert.ok(finding, 'it must become a finding, not only an entry nobody reads');
    assert.ok(['medium', 'high'].includes(finding.severity), 'worth a look, never critical: ' + finding.severity);
    assert.deepEqual(old.actions.neverRun.map(w => w.path), [scheduled.path]);
    const html = buildHtmlReport({ summary: quiet, allIssues: [], comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] },
        priorDate: null, trend: [], runDurationMs: 1, repoHealth: old });
    const card = html.slice(html.indexOf('GitHub Actions Health'), html.indexOf('Pull Request Triage'));
    assert.ok(card.includes(scheduled.name), 'the report must name the workflow that never ran');

    const fresh = await collectRepoHealth({ env: ENV, fetchImpl: fakeGithub(routesFor(workflow(iso(NOW - HOUR)))).fetchImpl, now: NOW });
    assert.equal(fresh.checks.find(c => c.name === 'GitHub Actions Health').status, 'passed',
        'a workflow added an hour ago has not had its first scheduled slot yet');
    assert.deepEqual(fresh.actions.neverRun, []);
});

run('a missing token is unavailable and emits no finding', async () => {
    const health = await collectRepoHealth({ env: { GITHUB_REPOSITORY: 'o/r' }, fetchImpl: () => { throw new Error('must not call'); }, now: NOW });
    assert.equal(health.checks.length, 1);
    assert.equal(health.checks[0].status, 'unavailable');
    assert.equal(health.checks[0].critical, false);
    assert.deepEqual(health.issues, []);
    assert.equal(auditExitCode({ critical: 0 }, summarizeChecks(health.checks)), 0);
});

run('an unavailable section is rendered without a single count, and a known count is rendered as itself', () => {
    const base = {
        summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0, linkChecks: 0 },
        allIssues: [],
        comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] },
        priorDate: null,
        trend: [],
        runDurationMs: 1,
    };
    const section = html => html.slice(html.indexOf('Repository Health Summary'), html.indexOf('Detailed Findings'));
    const unavailable = section(buildHtmlReport({ ...base, repoHealth: { actions: null, pullRequests: null, issueInventory: null } }));
    assert.ok(unavailable.length > 0, 'precondition: the section rendered');
    const shownCounts = unavailable.match(/<\/strong>\s*\d+/g) || [];
    assert.deepEqual(shownCounts, [],
        'a section the API could not read must not show "0 open PRs" or "0 failed workflows"');
    assert.doesNotMatch(unavailable, /No successful deploy found/,
        'an unread deploy history is not evidence that no deploy succeeded');

    // Partial data: the counts we have are shown; the counts we lack are not 0.
    const known = section(buildHtmlReport({ ...base, repoHealth: {
        actions: null,
        pullRequests: { openCount: 137, failingChecks: [], staleReviews: [], conflicts: [], inactive: [] },
        issueInventory: { openCount: null, newlyOpenedCount: null, closedCount: 4, highPriority: [], blockers: [], longstanding: [] },
    } }));
    assert.match(known, /<\/strong>\s*137\b/, 'the open-PR total must be rendered as the number in the data');
    assert.match(known, /<\/strong>\s*4\b/, 'a known closed count is rendered');
    const issuesCard = known.slice(known.indexOf('Issues Inventory'));
    const firstLine = issuesCard.slice(0, issuesCard.indexOf('</p>'));
    assert.equal((firstLine.match(/<\/strong>\s*\d+/g) || []).length, 1,
        'of open / new / closed only "closed" was measured, so only one number may appear');
});

// ── 2. Counts are totals, not the first page ────────────────────────────────

run('open issue and PR counts are the full totals across pages', async () => {
    const openIssues = Array.from({ length: 250 }, (_, i) => ({
        number: i + 1, title: 't', labels: [], body: '',
        created_at: iso(NOW - 2 * DAY), updated_at: iso(NOW - 2 * DAY), html_url: 'u',
    }));
    // Mixed in: PRs appear in the issues listing and must not be counted.
    for (let i = 0; i < 20; i += 1) openIssues.splice(i * 10, 0, { number: 1000 + i, pull_request: {}, created_at: iso(NOW) });
    const pr = n => ({ number: n, title: 'p', url: 'u', updatedAt: iso(NOW - HOUR), mergeable: 'MERGEABLE',
        reviewRequests: { totalCount: 0 }, commits: { nodes: [] } });
    const prPages = [Array.from({ length: 100 }, (_, i) => pr(i)), Array.from({ length: 40 }, (_, i) => pr(100 + i))];
    const { fetchImpl } = fakeGithub(healthyRoutes({ openIssues, prPages }));
    const health = await collectRepoHealth({ env: ENV, fetchImpl, now: NOW });
    assert.equal(health.issueInventory.openCount, openIssues.filter(i => !i.pull_request).length,
        'the open-issue count must equal the issues the API holds, not the first 100 rows');
    assert.equal(health.pullRequests.openCount, prPages[0].length + prPages[1].length,
        'the open-PR count must equal the total, not the first page of nodes');
});

run('a listing cut off at the page cap reports its count as null, not as the cap', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i, labels: [], created_at: iso(NOW), updated_at: iso(NOW) }));
    const routes = healthyRoutes();
    routes.unshift([url => url.includes('/issues?state=open'), () => response(200, full)]);
    // PRs: GraphQL knows the true total even when we stop reading pages.
    const TRUE_TOTAL = 2500;
    routes.unshift([url => url.endsWith('/graphql'), () => response(200, { data: { repository: { pullRequests: {
        totalCount: TRUE_TOTAL,
        pageInfo: { hasNextPage: true, endCursor: 'x' },
        nodes: Array.from({ length: 100 }, (_, i) => ({ number: i, updatedAt: iso(NOW), reviewRequests: { totalCount: 0 }, commits: { nodes: [] } })),
    } } } })]);
    const { fetchImpl } = fakeGithub(routes);
    const health = await collectRepoHealth({ env: ENV, fetchImpl, now: NOW });
    assert.equal(health.issueInventory.openCount, null);
    assert.equal(health.issueInventory.newlyOpenedCount, null);
    assert.equal(health.pullRequests.openCount, TRUE_TOTAL,
        'the PR count is the connection total, not however many nodes were read before the cap');
});

run('a failing main run on the second page of the 24h window is still found', async () => {
    const runs = Array.from({ length: 180 }, (_, i) => ({
        workflow_id: 1, status: 'completed', conclusion: 'success', name: 'ci', created_at: iso(NOW - HOUR - i * 60000), html_url: 'r',
    }));
    runs[150] = { workflow_id: 2, status: 'completed', conclusion: 'failure', name: 'weekly', created_at: iso(NOW - 20 * HOUR), html_url: 'x' };
    const { fetchImpl } = fakeGithub(healthyRoutes({ runs }));
    const health = await collectRepoHealth({ env: ENV, fetchImpl, now: NOW });
    assert.deepEqual(health.actions.failingRuns.map(r => r.workflow_id), [2],
        '~80+ main runs a day: a single page of 100 silently dropped the rest');
});

// ── 3. Failing and blocked mean the current state, not any past event ──────

run('a failure followed by a success of the same workflow is resolved', () => {
    const runs = [
        { workflow_id: 1, status: 'completed', conclusion: 'failure', created_at: iso(NOW - 5 * HOUR) },
        { workflow_id: 1, status: 'completed', conclusion: 'success', created_at: iso(NOW - HOUR) },
        { workflow_id: 2, status: 'completed', conclusion: 'success', created_at: iso(NOW - 5 * HOUR) },
        { workflow_id: 2, status: 'completed', conclusion: 'timed_out', created_at: iso(NOW - HOUR) },
        { workflow_id: 3, status: 'in_progress', conclusion: null, created_at: iso(NOW) },
        { workflow_id: 3, status: 'completed', conclusion: 'success', created_at: iso(NOW - HOUR) },
    ];
    assert.deepEqual(failingLatestRuns(runs).map(r => r.workflow_id), [2]);
});

run('a deploy cancelled by cancel-in-progress does not block; a failure since the last success does', () => {
    const deployYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
    assert.match(deployYml, /cancel-in-progress:\s*true/,
        'precondition: deploy.yml cancels superseded runs, which is why cancelled is ignored below');
    const ok = { status: 'completed', conclusion: 'success', created_at: iso(NOW - 3 * HOUR) };
    const cancelled = { status: 'completed', conclusion: 'cancelled', created_at: iso(NOW - HOUR) };
    const failed = { status: 'completed', conclusion: 'failure', created_at: iso(NOW - HOUR) };
    const oldFailure = { status: 'completed', conclusion: 'failure', created_at: iso(NOW - 6 * HOUR) };
    const newer = (conclusion, status = 'completed') => ({ status, conclusion, created_at: iso(NOW - 10 * 60 * 1000) });
    for (const superseding of [newer('success'), newer('failure'), newer(null, 'in_progress')]) {
        const label = superseding.conclusion || superseding.status;
        const state = deployState([ok, cancelled, superseding]);
        assert.ok(!state.recentDeployFailures.includes(cancelled),
            `a cancelled deploy with a newer (${label}) run behind it was superseded, not failed`);
    }
    assert.equal(deployState([ok, cancelled, newer(null, 'in_progress')]).deployBlocked, false);
    assert.equal(deployState([ok, oldFailure]).deployBlocked, false, 'a failure already fixed by a later success');
    assert.equal(deployState([ok, failed]).deployBlocked, true);
    assert.equal(deployState([cancelled]).deployBlocked, true, 'no success on record at all');
});

run('the newest deploy cancelled with nothing after it is blocked, whatever succeeded before', () => {
    // Cancelled by hand, or by timeout-minutes (which also reports `cancelled`):
    // the newest commit may never have deployed, and an older success says
    // nothing about it.
    const ok = { status: 'completed', conclusion: 'success', created_at: iso(NOW - 3 * HOUR) };
    const cancelled = { status: 'completed', conclusion: 'cancelled', created_at: iso(NOW - HOUR) };
    const state = deployState([ok, cancelled]);
    assert.equal(state.deployBlocked, true);
    assert.deepEqual(state.recentDeployFailures, [cancelled], 'the run that left main undeployed is named');
});

// ── 4. Overdue allows for GitHub's documented schedule lateness ─────────────

run('every cron in the repo is parsed, including double-quoted ones', () => {
    const dir = path.join(ROOT, '.github', 'workflows');
    const withCron = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f))
        .filter(f => /^\s*-\s*cron:/m.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.ok(withCron.length > 20, 'precondition: the scan found the scheduled workflows');
    const parsed = parseScheduledWorkflows().map(w => w.file).sort();
    assert.deepEqual(parsed, withCron.sort(),
        'a workflow whose cron the parser misses is never checked for being overdue');
});

/** Real scheduled workflow files, with fake API records for every one. */
function scheduledRoutes({ bulkAge = 400 * DAY, confirmation } = {}) {
    const workflows = parseScheduledWorkflows().map((workflow, index) => ({
        ...workflow, id: index + 1000, state: 'active', created_at: iso(NOW - 180 * DAY),
    }));
    const scheduledRun = (workflow, age) => ({
        workflow_id: workflow.id, created_at: iso(NOW - age),
        html_url: `https://example.com/runs/${workflow.id}/${age}`,
    });
    const routes = healthyRoutes();
    routes.unshift(
        [url => url.includes('/actions/workflows?'), url => response(200, {
            workflows: workflows.slice((pageOf(url) - 1) * 100, pageOf(url) * 100),
        })],
        [url => url.includes('/actions/runs?branch=main&event=schedule'), () => response(200, {
            workflow_runs: workflows.map(w => scheduledRun(w, bulkAge)),
        })],
        [url => /\/actions\/workflows\/\d+\/runs\?branch=main&event=schedule&per_page=1$/.test(url), url => {
            const id = Number(url.match(/\/workflows\/(\d+)\/runs/)[1]);
            const workflow = workflows.find(w => w.id === id);
            assert.ok(workflow, 'confirmation must name a parsed scheduled workflow');
            return confirmation ? confirmation(workflow, scheduledRun) : response(200, { workflow_runs: [scheduledRun(workflow, HOUR)] });
        }],
    );
    return { workflows, ...fakeGithub(routes) };
}

run('Oct 7 stale bulk listing is cleared by fresh per-workflow runs for every scheduled workflow', async () => {
    const fake = scheduledRoutes({ confirmation: (workflow, scheduledRun) => response(200, {
        // The daily audit ran yesterday; shorter cadences ran an hour ago.
        workflow_runs: [scheduledRun(workflow, workflow.file === 'daily-audit-system.yml' ? DAY : HOUR)],
    }) });
    const health = await collectRepoHealth({ env: ENV, fetchImpl: fake.fetchImpl, now: NOW });
    assert.deepEqual(health.actions.overdueWorkflows, []);
    assert.deepEqual(health.actions.neverRun, []);
    assert.deepEqual(health.issues, []);
    assert.equal(health.checks.find(c => c.name === 'GitHub Actions Health').status, 'passed');
    const checkedIds = fake.calls.filter(url => /\/workflows\/\d+\/runs/.test(url))
        .map(url => Number(url.match(/\/workflows\/(\d+)\/runs/)[1]));
    assert.ok(fake.workflows.length > 0, 'non-vacuity: scheduled files were found');
    assert.equal(checkedIds.length, parseScheduledWorkflows().length,
        'every scheduled workflow parsed from .github/workflows must be evaluated');
    assert.deepEqual(checkedIds.sort((a, b) => a - b), fake.workflows.map(w => w.id),
        'each real scheduled workflow must get its own confirmation, with no duplicates');
    console.log(`    confirmed ${checkedIds.length} scheduled workflows from .github/workflows`);
});

run('a recent bulk run clears a workflow without a confirmation request', async () => {
    const fake = scheduledRoutes({ bulkAge: HOUR, confirmation: () => { throw new Error('unneeded confirmation'); } });
    const health = await collectRepoHealth({ env: ENV, fetchImpl: fake.fetchImpl, now: NOW });
    assert.deepEqual(health.actions.overdueWorkflows, []);
    assert.equal(fake.calls.filter(url => /\/workflows\/\d+\/runs/.test(url)).length, 0);
    assert.equal(health.checks.find(c => c.name === 'GitHub Actions Health').status, 'passed');
});

run('both listings old still reports the genuinely overdue workflow and its last-run URL', async () => {
    const targetFile = parseScheduledWorkflows()[0].file;
    const fake = scheduledRoutes({ bulkAge: 90 * DAY, confirmation: (workflow, scheduledRun) => response(200, {
        workflow_runs: [scheduledRun(workflow, workflow.file === targetFile ? 90 * DAY : HOUR)],
    }) });
    const health = await collectRepoHealth({ env: ENV, fetchImpl: fake.fetchImpl, now: NOW });
    const target = fake.workflows.find(w => w.file === targetFile);
    const overdue = health.actions.overdueWorkflows.find(w => w.path === target.path);
    assert.ok(overdue, 'a genuinely missed schedule must remain in the overdue list');
    assert.equal(overdue.lastRunAt, iso(NOW - 90 * DAY));
    const finding = health.issues.find(i => i.file === target.path);
    assert.ok(finding, 'a genuinely missed schedule must produce a finding, not just a list entry');
    assert.equal(finding.severity, 'high');
    assert.equal(finding.link, overdue.html_url);
    assert.equal(finding.link, `https://example.com/runs/${target.id}/${90 * DAY}`);
    assert.equal(health.checks.find(c => c.name === 'GitHub Actions Health').status, 'failed');
    console.log(`    genuine overdue finding retained: ${finding.file} → ${finding.link}`);
});

run('confirmation failing twice is unavailable, never overdue or healthy', async () => {
    for (const fail of [() => { throw new Error('ECONNRESET'); }, () => response(403, {})]) {
        const fake = scheduledRoutes({ confirmation: fail });
        const health = await collectRepoHealth({ env: ENV, fetchImpl: fake.fetchImpl, now: NOW });
        assert.equal(fake.calls.filter(url => /\/workflows\/\d+\/runs/.test(url)).length, 2,
            'confirmation gets exactly one re-read, including HTTP errors');
        const check = health.checks.find(c => c.name === 'GitHub Actions Health');
        assert.equal(check.status, 'unavailable');
        assert.equal(health.actions, null, 'unread schedules cannot be represented by a healthy empty list');
        assert.deepEqual(health.issues, [], 'an API outage is not evidence of an overdue or never-run workflow');
        const auditHealth = summarizeChecks(health.checks);
        assert.equal(summarizeChecks([check]).passed, 0);
        assert.equal(auditHealth.unavailable, 1);
        assert.notEqual(overallStatus({ summary: quiet, auditHealth, repoHealth: health }).key, 'healthy');
    }
});

run('a failed confirmation followed by a recent run recovers on the single re-read', async () => {
    let first = true;
    const fake = scheduledRoutes({ confirmation: (workflow, scheduledRun) => {
        if (first) { first = false; throw new Error('ECONNRESET'); }
        return response(200, { workflow_runs: [scheduledRun(workflow, HOUR)] });
    } });
    const health = await collectRepoHealth({ env: ENV, fetchImpl: fake.fetchImpl, now: NOW });
    assert.equal(fake.calls.filter(url => /\/workflows\/\d+\/runs/.test(url)).length, fake.workflows.length + 1);
    assert.deepEqual(health.actions.overdueWorkflows, []);
    assert.equal(health.checks.find(c => c.name === 'GitHub Actions Health').status, 'passed');
});

run('a run up to ~265 min late is not overdue at any cadence; a genuinely missed one is', () => {
    // AGENTS.md / #1555: median start ~180 min late, 265+ min observed. The
    // worst honest gap between two starts is interval + that lateness.
    const late = 265 * 60 * 1000;
    assert.ok(SCHEDULE_LATENESS_MS > late, 'the allowance must exceed the observed worst case');
    for (const cron of ['*/30 * * * *', '35 * * * *', '15 */2 * * *', '17 */6 * * *', '13 9 * * *', '11 3 * * 0', '29 4 5 * *']) {
        const interval = workflowIntervalMs([cron]);
        assert.ok(interval, cron + ' must be understood');
        const lastRun = iso(NOW - interval - late);
        assert.equal(isScheduleOverdue(lastRun, interval, NOW), false, cron + ' flagged after a normal late start');
        const missed = iso(NOW - 2 * interval - SCHEDULE_LATENESS_MS - DAY);
        assert.equal(isScheduleOverdue(missed, interval, NOW), true, cron + ' not flagged after missing a whole cycle');
    }
    assert.equal(isScheduleOverdue(null, DAY, NOW), false, 'no run on record is reported separately, not as late');
    assert.equal(workflowIntervalMs(['13 9 * * 1', '13 9 * * *']), DAY, 'several crons: the shortest cadence');
});

// ── 5. Subject, banner and exit code agree ──────────────────────────────────

const quiet = { critical: 0, high: 0, medium: 0, low: 0, total: 0, linkChecks: 1 };
function render(summary, auditHealth, repoHealth) {
    const html = buildHtmlReport({ summary, allIssues: [], comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] },
        priorDate: null, trend: [], runDurationMs: 1, auditHealth, repoHealth });
    const subject = buildEmailSubject({ summary, auditHealth, repoHealth, reportDate: new Date(NOW) });
    const banner = html.match(/margin-bottom:24px;">([^<]+)<\/div>/)[1];
    return { html, subject, banner, key: overallStatus({ summary, auditHealth, repoHealth }).key };
}
const lead = text => [...text.trim()][0];
const healthySubject = render(quiet, summarizeChecks([{ name: 'a', status: 'passed' }]), undefined).subject;

run('the subject and the banner always carry the same tone', () => {
    const cases = [
        [quiet, summarizeChecks([{ name: 'a', status: 'passed' }]), undefined],
        [{ ...quiet, critical: 1, total: 1 }, summarizeChecks([]), undefined],
        [quiet, summarizeChecks([{ name: 'link', critical: true, status: 'unavailable' }]), undefined],
        [quiet, summarizeChecks([{ name: 'repo', critical: false, status: 'unavailable' }]), undefined],
        [{ ...quiet, high: 1, total: 1 }, summarizeChecks([]), undefined],
        [quiet, summarizeChecks([]), { actions: { deployBlocked: true } }],
        [quiet, summarizeChecks([]), { issueInventory: { highPriority: [{}] } }],
    ];
    const keys = new Set();
    for (const [summary, auditHealth, repoHealth] of cases) {
        const r = render(summary, auditHealth, repoHealth);
        keys.add(r.key);
        assert.equal(lead(r.subject), lead(r.banner), `${r.key}: subject "${r.subject}" vs banner "${r.banner}"`);
    }
    assert.equal(keys.size, cases.length, 'non-vacuity: every case exercised a distinct status');
});

run('a crashed critical check is not reported as a blocked deploy, and fails the job', () => {
    const auditHealth = summarizeChecks([{ name: 'Link Detection & Validation', critical: true, status: 'unavailable' }]);
    const blocked = render(quiet, summarizeChecks([]), { actions: { deployBlocked: true } });
    const crashed = render(quiet, auditHealth, { actions: { deployBlocked: false }, issueInventory: { highPriority: [] } });
    assert.notEqual(crashed.subject.replace(/—.*$/, ''), blocked.subject.replace(/—.*$/, ''),
        'a link check that threw says nothing about the deploy');
    assert.equal(auditExitCode(quiet, auditHealth), 1, 'the audit silently not running must fail the job');
});

run('a critical finding outranks a labelled issue in the subject', () => {
    const both = render({ ...quiet, critical: 1, total: 1 }, summarizeChecks([]), { issueInventory: { highPriority: [{}, {}] } });
    assert.equal(both.key, 'critical');
    assert.equal(lead(both.subject), lead(render({ ...quiet, critical: 1, total: 1 }, summarizeChecks([]), undefined).subject));
});

run('checks that did not run block the all-clear in both subject and banner', () => {
    const r = render(quiet, summarizeChecks([{ name: 'a', status: 'passed' }, { name: 'repo', status: 'skipped' }]), undefined);
    assert.notEqual(r.subject, healthySubject);
    assert.notEqual(r.key, 'healthy');
    assert.notEqual(r.banner, render(quiet, summarizeChecks([{ name: 'a', status: 'passed' }]), undefined).banner);
});

run('only a critical finding or a crashed critical check fails the job', () => {
    const lowOnly = summarizeChecks([{ name: 'link', critical: true, status: 'failed', issues: [{ severity: 'low' }, { severity: 'medium' }] }]);
    assert.equal(lowOnly.criticalFailures, 0, 'a broken link of low severity is not a critical failure');
    assert.equal(auditExitCode({ ...quiet, medium: 1, low: 1, total: 2 }, lowOnly), 0);
    const real = summarizeChecks([{ name: 'data', critical: true, status: 'failed', issues: [{ severity: 'critical' }] }]);
    assert.equal(real.criticalFailures, 1);
    assert.equal(auditExitCode({ ...quiet, critical: 1, total: 1 }, real), 1);

    const src = fs.readFileSync(path.join(ROOT, 'test', 'daily-audit-system.js'), 'utf8');
    const exits = src.match(/if \(([^\n]+)\) \{\n\s*console\.error\(\s*\n?\s*`\[audit\] Exiting with code 1/);
    assert.ok(exits, 'precondition: found the exit-1 branch');
    assert.match(exits[1], /auditExitCode\(/, 'the script must exit on the same rule these tests pin');
});

// ── 6. The workflow matches what the module does ────────────────────────────

run('the job token can read what the queries ask for, and later steps survive an exit 1', () => {
    const yaml = require('js-yaml');
    const wf = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-audit-system.yml'), 'utf8'));
    const job = wf.jobs.audit;
    const src = fs.readFileSync(path.join(ROOT, 'test', 'audit-modules', 'repo-health.js'), 'utf8');
    if (/statusCheckRollup/.test(src)) {
        assert.equal(job.permissions.checks, 'read', 'statusCheckRollup reads check runs');
        assert.equal(job.permissions.statuses, 'read', 'statusCheckRollup reads commit statuses');
    }
    const auditIndex = job.steps.findIndex(step => step.run === 'node test/daily-audit-system.js');
    assert.ok(auditIndex >= 0, 'precondition: found the audit step');
    const after = job.steps.slice(auditIndex + 1);
    assert.ok(after.length > 0, 'precondition: there are steps after the audit');
    for (const step of after) {
        assert.ok(step.if && /always\(\)|!cancelled\(\)|failure\(\)/.test(step.if),
            `"${step.name}" would be skipped whenever the audit exits 1, now that continue-on-error is gone`);
    }
});

(async () => {
    console.log('daily-audit-repo-health');
    for (const { name, fn } of tests) {
        try { await fn(); console.log('  ✓ ' + name); }
        catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
    }
    console.log(failures === 0 ? '  all daily-audit-repo-health guards passed' : '  ' + failures + ' guard(s) failed');
    process.exit(failures === 0 ? 0 : 1);
})();
