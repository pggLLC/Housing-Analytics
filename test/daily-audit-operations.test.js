'use strict';

/**
 * Guards for the daily audit's operations sections (operations-status.js):
 * Member Site Deploy, Scheduled Data Workflows, Review Follow-ups, Upcoming
 * Deadlines and Source & Figure Accuracy. Pure functions on fixture JSON, no
 * network. Each block pins a behaviour:
 *
 *  - the member-site distance is a number only when a readable build stamp
 *    gave one; otherwise it says unknown;
 *  - a data workflow is listed when its latest scheduled run in 24h failed,
 *    or was cancelled before any job started — not when it recovered;
 *  - Codex follow-ups and unassigned bot watch issues are told apart;
 *  - data/deadlines.json is well formed, public, agrees with the CHFA
 *    calendar it was copied from, and only the next 14 days are shown;
 *  - broken links and overdue review dates are counted from the files the
 *    sweep and the review reminders already keep;
 *  - the email leads with the work, in the owner's order, and ends with
 *    check results that list only what failed or did not run.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ops = require('./audit-modules/operations-status.js');
const { buildHtmlReport } = require('./audit-modules/report-generator.js');

const ROOT = path.resolve(__dirname, '..');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-26T15:00:00Z');
const iso = ms => new Date(ms).toISOString();

let failures = 0;
const tests = [];
function run(name, fn) { tests.push({ name, fn }); }

function render(repoHealth) {
    return buildHtmlReport({ summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, allIssues: [],
        comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] }, priorDate: null, trend: [], runDurationMs: 1, repoHealth });
}

// ── 1. Member Site Deploy ───────────────────────────────────────────────────

run('with no public build stamp the distance is unknown, and no request is made', async () => {
    const client = { external: () => { throw new Error('must not call'); }, json: () => { throw new Error('must not call'); } };
    const out = await ops.collectMemberSite('o', 'r', client, NOW, { env: {} });
    assert.equal(out.summary.known, false);
    assert.equal(out.summary.aheadBy, null, 'never a guessed number');
    assert.match(out.summary.reason, /Cloudflare Access/);
    assert.match(render({ memberSite: out.summary }), /Member Site Deploy[\s\S]*Unknown\./);
});

run('a readable stamp is compared with main and the distance shown', async () => {
    const calls = [];
    const client = {
        external: async url => { calls.push(url); return { source_revision: 'ABCDEF1234567', built_at: '2026-10-20T00:00:00Z' }; },
        json: async apiPath => { calls.push(apiPath); return { ahead_by: 12, behind_by: 0 }; },
    };
    const out = await ops.collectMemberSite('o', 'r', client, NOW, { env: { MEMBER_SITE_BUILD_URL: 'https://example.com/version' } });
    assert.deepEqual(calls, ['https://example.com/version', '/repos/o/r/compare/abcdef1234567...main']);
    assert.equal(out.summary.known, true);
    assert.equal(out.summary.aheadBy, 12);
    assert.match(render({ memberSite: out.summary }), /main is 12 commit\(s\) ahead/);
});

run('a stamp with no usable revision stays unknown', () => {
    const state = ops.memberSiteState({ buildUrl: 'https://example.com/v', build: { source_revision: 'not-a-sha' } });
    assert.equal(state.known, false);
    assert.equal(ops.buildRevision({ commit: 'deadbeef' }), 'deadbeef');
});

// ── 2. Scheduled Data Workflows ─────────────────────────────────────────────

const runOf = (id, file, conclusion, ageMs, extra = {}) => ({
    id, workflow_id: file, name: file.replace(/\.yml$/, ''), path: `.github/workflows/${file}`, event: 'schedule',
    status: 'completed', conclusion, created_at: iso(NOW - ageMs), html_url: `https://example.com/runs/${id}`, ...extra,
});

run('data workflows are named by file; audits and monitors are not', () => {
    for (const file of ['fetch-fred-data.yml', 'build-hna-data.yml', 'data-refresh.yml', 'zillow-data-sync.yml', 'car-data-update.yml', 'market_data_build.yml']) {
        assert.ok(ops.isDataWorkflow({ path: `.github/workflows/${file}` }), file);
    }
    for (const file of ['a11y-audit.yml', 'daily-audit-system.yml', 'ci-checks.yml', 'data-freshness-check.yml']) {
        assert.ok(!ops.isDataWorkflow({ path: `.github/workflows/${file}` }), file);
    }
});

run('the data workflow pattern covers the fetch/build/refresh family of scheduled workflows', () => {
    const files = fs.readdirSync(path.join(ROOT, '.github', 'workflows'))
        .filter(file => /cron:/.test(fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8')))
        .filter(file => ops.isDataWorkflow({ path: `.github/workflows/${file}` }));
    assert.ok(files.length >= 20, `expected the fetch/build/refresh family, got ${files.length}`);
});

run('a failure is listed, a recovered failure is not, and a cancel only with 0 jobs', () => {
    const runs = [
        runOf(1, 'fetch-fred-data.yml', 'failure', 2 * HOUR),
        runOf(2, 'build-hna-data.yml', 'failure', 10 * HOUR),
        runOf(3, 'build-hna-data.yml', 'success', 3 * HOUR),
        runOf(4, 'fetch-census-acs.yml', 'cancelled', 4 * HOUR),
        runOf(5, 'fetch-hmda-data.yml', 'cancelled', 5 * HOUR),
        runOf(6, 'fetch-kalshi.yml', 'failure', 30 * HOUR),
        runOf(7, 'a11y-audit.yml', 'failure', HOUR),
        runOf(8, 'fetch-fmr-data.yml', 'failure', HOUR, { event: 'workflow_dispatch' }),
    ];
    const candidates = ops.latestDataRunsToReview(runs, NOW);
    assert.deepEqual(candidates.map(r => r.id).sort(), [1, 4, 5]);
    const problems = ops.dataWorkflowProblems(candidates, { 4: 0, 5: 3 });
    assert.deepEqual(problems.map(p => [p.file, p.outcome]), [
        ['fetch-census-acs.yml', 'cancelled with 0 jobs'],
        ['fetch-fred-data.yml', 'failure'],
    ]);
    assert.deepEqual(ops.dataWorkflowProblems(candidates, {}).map(p => p.file), ['fetch-fred-data.yml'],
        'an unread job count is not evidence that a cancel never started');
});

run('a 0-job cancel superseded by a newer run of the same workflow is not listed', () => {
    const runs = [
        runOf(4, 'fetch-census-acs.yml', 'cancelled', 3 * HOUR),
        runOf(9, 'fetch-census-acs.yml', null, HOUR, { status: 'in_progress' }),
    ];
    assert.deepEqual(ops.latestDataRunsToReview(runs, NOW), []);
});

run('the collector asks for jobs only on cancelled runs', async () => {
    const calls = [];
    const client = {
        paginate: async apiPath => { calls.push(apiPath); return { items: [runOf(4, 'fetch-census-acs.yml', 'cancelled', HOUR), runOf(1, 'fetch-fred-data.yml', 'failure', HOUR)], complete: true }; },
        json: async apiPath => { calls.push(apiPath); return { total_count: 0, jobs: [] }; },
    };
    const out = await ops.collectDataWorkflows('o', 'r', client, NOW);
    assert.equal(calls.filter(c => c.includes('/jobs')).length, 1);
    assert.equal(out.check.status, 'warning', 'no finding of its own, so a warning');
    assert.deepEqual(out.issues, [], 'Actions Health already files failing runs as findings');
    assert.match(render({ dataWorkflows: out.summary }), /cancelled with 0 jobs/);
});

// ── 3. Review Follow-ups ────────────────────────────────────────────────────

run('Codex follow-ups and unassigned bot watch issues are found by title, label and author', () => {
    const bot = { login: 'github-actions[bot]', type: 'Bot' };
    const person = { login: 'paulglasow', type: 'User' };
    const rows = ops.reviewFollowups([
        { number: 1, title: 'Green building guide: follow-ups from the Codex review of #2487', user: person, labels: [], assignees: [] },
        { number: 2, title: 'Funding watch: OEDIT', user: bot, labels: [{ name: 'funding-watch' }], assignees: [] },
        { number: 3, title: 'Funding watch: CHFA', user: bot, labels: [{ name: 'funding-watch' }], assignees: [{ login: 'paulglasow' }] },
        { number: 4, title: 'Upstream vintage check needs attention', user: bot, labels: [{ name: 'upstream-vintage' }], assignees: [] },
        { number: 5, title: 'Quarantine candidates', user: bot, labels: [], assignees: [] },
        { number: 6, title: 'Watch this space', user: person, labels: [], assignees: [] },
        { number: 7, title: 'Codex PR', user: person, labels: [], assignees: [], pull_request: {} },
    ]);
    assert.deepEqual(rows.codex.map(r => r.number), [1]);
    assert.deepEqual(rows.unassignedWatch.map(r => r.number), [2, 4], 'assigned (3), non-watch (5), human (6) and PRs (7) are out');
});

// ── 4. Upcoming Deadlines ───────────────────────────────────────────────────

const DEADLINES = JSON.parse(fs.readFileSync(ops.DEADLINES_FILE, 'utf8'));

run('only the next 14 days are shown, soonest first, and a bad entry is an error', () => {
    const doc = { deadlines: [
        { date: '2026-11-15', title: 'Too far', source: 'https://example.com/a' },
        { date: '2026-10-29', title: 'Hearing', source: 'https://example.com/b' },
        { date: '2026-10-25', title: 'Past', source: 'https://example.com/c' },
        { date: '2026-10-26', title: 'Today', source: 'https://example.com/d', status: 'draft QAP date' },
    ] };
    const rows = ops.upcomingDeadlines(doc, '2026-10-26');
    assert.deepEqual(rows.map(r => [r.title, r.daysAway]), [['Today', 0], ['Hearing', 3]]);
    assert.throws(() => ops.upcomingDeadlines({ deadlines: [{ date: '10/29/2026', title: 'x', source: 'https://example.com' }] }, '2026-10-26'));
    assert.throws(() => ops.upcomingDeadlines({ deadlines: [{ date: '2026-10-29', title: 'x', source: 'http://example.com' }] }, '2026-10-26'));
    assert.throws(() => ops.upcomingDeadlines({}, '2026-10-26'), 'a malformed file reads as unavailable, not as "nothing due"');
    assert.equal(ops.denverDay(Date.parse('2026-10-27T03:00:00Z')), '2026-10-26', 'the day is Denver\'s, not UTC\'s');
});

run('data/deadlines.json is valid, public, and agrees with the calendar it was copied from', () => {
    assert.ok(DEADLINES.deadlines.length > 0);
    ops.upcomingDeadlines(DEADLINES, '2026-01-01', 3650);
    const text = fs.readFileSync(ops.DEADLINES_FILE, 'utf8');
    const body = JSON.stringify(DEADLINES.deadlines);
    assert.ok(!/indibuild|\brfq\b|request for qualifications/i.test(body), 'this repo is public: no private deal or RFQ');
    const calendar = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-qap-calendar.json'), 'utf8'));
    const byId = new Map(calendar.events.map(event => [event.id, event]));
    for (const entry of DEADLINES.deadlines) {
        assert.match(entry.from || '', /^data\/[\w./-]+\.json(#.+)?$/, `${entry.title}: say which repo file it came from`);
        const [file, id] = entry.from.split('#');
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${entry.from} exists`);
        if (file === 'data/chfa-qap-calendar.json') {
            const event = byId.get(id);
            assert.ok(event, `${entry.from} names a calendar event`);
            assert.equal(entry.date, event.date, `${entry.title}: date drifted from the calendar`);
            assert.equal(entry.source, event.url, `${entry.title}: source drifted from the calendar`);
        }
    }
    assert.ok(text.endsWith('\n'));
});

run('the deadlines card lists what is due and says so when nothing is', () => {
    const due = ops.collectDeadlines(Date.parse('2026-10-26T15:00:00Z'));
    const html = render({ deadlines: due });
    if (due.upcoming.length > 0) assert.ok(html.includes(due.upcoming[0].title.replace(/&/g, '&amp;')));
    assert.match(render({ deadlines: { windowDays: 14, upcoming: [] } }), /Nothing due in the next 14 days/);
    assert.match(render({}), /Upcoming Deadlines[\s\S]*Unavailable/);
});

// ── 5. Source & Figure Accuracy ─────────────────────────────────────────────

run('broken links use the sweep\'s own confirmation rule: a first failure is unconfirmed, the second is newly broken', async () => {
    const policy = await ops.loadUrlHealthPolicy();
    const { CONFIRMED_FAILURE_SWEEPS } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts', 'audit', 'url-health-policy.mjs')).href);
    assert.equal(policy.CONFIRMED_FAILURE_SWEEPS, CONFIRMED_FAILURE_SWEEPS, 'the sweep\'s constant, not a copy');
    const summary = ops.urlHealthSummary({ lastSweepAt: '2026-10-23T11:27:03Z', byUrl: {
        'https://example.com/first': { status: 'broken', httpStatus: 404, consecutiveFailures: 1 },
        'https://example.com/second': { status: 'broken', httpStatus: 404, consecutiveFailures: 2 },
        'https://example.com/old': { status: 'broken', httpStatus: 500, consecutiveFailures: 9 },
        'https://example.com/slow': { status: 'timeout', httpStatus: null, consecutiveFailures: 2 },
        'https://example.com/auth': { status: 'auth', httpStatus: 403, consecutiveFailures: 5 },
        'https://example.com/ok': { status: 'ok', consecutiveFailures: 0 },
    } }, policy);
    assert.deepEqual(summary.newlyBroken.map(r => r.url), ['https://example.com/second', 'https://example.com/slow'],
        'the second consecutive failure is newly broken, timeouts included, as the sweep files them');
    assert.equal(summary.unconfirmed, 1, 'a first failure is held for confirmation');
    assert.equal(summary.broken, 3, 'confirmed: newly broken + still broken; auth is the server answering, not rot');
    assert.throws(() => ops.urlHealthSummary({}, policy));
    assert.throws(() => ops.urlHealthSummary({ byUrl: {} }), 'never a re-derived rule');
    const real = ops.urlHealthSummary(JSON.parse(fs.readFileSync(ops.URL_HEALTH_FILE, 'utf8')), policy);
    assert.ok(Number.isInteger(real.broken), 'the committed sweep state parses');
});

run('figures past review are counted per watched file; unreadable files are named', () => {
    const specs = [
        { file: 'a.json', key: 'entries', title: 'A' },
        { file: 'b.json', key: 'programs', title: 'B' },
        { file: 'c.json', key: 'entries', title: 'C' },
    ];
    const docs = {
        'a.json': { entries: [{ review_by: '2026-10-01' }, { review_by: '2026-12-01' }, { review_by: null }] },
        'b.json': { programs: [{ review_by: '2026-11-30' }] },
        'c.json': null,
    };
    assert.deepEqual(ops.overdueReviews(specs, docs, '2026-10-26'), [
        { title: 'A', file: 'a.json', overdue: 1 },
        { title: 'C', file: 'c.json', overdue: null },
    ]);
});

run('the policy-review file list is reused, and every file it names parses', async () => {
    const { FILES } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts', 'audit', 'policy-review-reminders.mjs')).href);
    const docs = Object.fromEntries(FILES.map(spec => [spec.file, JSON.parse(fs.readFileSync(path.join(ROOT, spec.file), 'utf8'))]));
    const rows = ops.overdueReviews(FILES, docs, '2026-10-26');
    assert.ok(rows.every(row => row.overdue !== null), 'every watched file has its records array');
});

run('an unreadable review file makes the overdue total a lower bound, never a plain number', () => {
    assert.deepEqual(ops.overdueTotal([{ overdue: 2 }, { overdue: null }]), { count: 2, partial: true });
    assert.deepEqual(ops.overdueTotal([{ overdue: 2 }, { overdue: 1 }]), { count: 3, partial: false });
    assert.deepEqual(ops.overdueTotal([]), { count: 0, partial: false });
    assert.equal(ops.overdueTotal(null), null);
    const base = { urlHealth: null, sweep: null, issues: null, errors: [] };
    const unreadableOnly = render({ accuracy: { ...base, overdue: [{ title: 'C', file: 'c.json', overdue: null }] } });
    assert.match(unreadableOnly, /Figures past review date:<\/strong> 0\+ \(some sources unreadable\)/);
    assert.doesNotMatch(unreadableOnly, /Figures past review date:<\/strong> 0</, 'unknown is never shown as zero');
    const mixed = render({ accuracy: { ...base, overdue: [{ title: 'A', file: 'a.json', overdue: 2 }, { title: 'C', file: 'c.json', overdue: null }] },
        reviewFollowups: { codex: [], unassignedWatch: [] } });
    assert.match(mixed, /Figures past review date:<\/strong> 2\+ \(some sources unreadable\)/);
    assert.match(mixed, /2\+ \(some sources unreadable\) figure\(s\) past review/, 'the summary line carries the same lower bound');
    assert.match(render({ accuracy: { ...base, overdue: [{ title: 'A', file: 'a.json', overdue: 2 }] } }), /Figures past review date:<\/strong> 2</);
});

run('accuracy issues are the url-health, policy-review and benchmark trackers', () => {
    const rows = ops.accuracyIssues([
        { number: 1, title: '[url-health-weekly] 1 newly-broken URL(s)', labels: [{ name: 'url-health' }] },
        { number: 2, title: 'Review due: Colorado policy watch', labels: [{ name: 'policy-review' }] },
        { number: 3, title: 'Benchmark snapshots past their cadence (6)', labels: [] },
        { number: 4, title: 'Funding watch: OEDIT', labels: [{ name: 'funding-watch' }] },
    ]);
    assert.deepEqual(rows.map(r => r.number), [1, 2, 3]);
});

run('a GitHub outage leaves the local half of the accuracy card in place', async () => {
    const down = () => { throw new Error('ECONNRESET'); };
    const out = await ops.collectAccuracy('o', 'r', { json: down, paginate: down }, NOW);
    assert.ok(out.summary.urlHealth, 'the committed sweep state is still read');
    assert.ok(Array.isArray(out.summary.overdue));
    assert.equal(out.summary.sweep, null);
    assert.equal(out.summary.issues, null);
    assert.equal(out.summary.errors.length, 2);
    const html = render({ accuracy: out.summary });
    assert.match(html, /Broken source links:<\/strong> \d+/);
    assert.match(html, /Source URL Sweep \(last run\):<\/strong> <span style="color:#856404;">unavailable/);
});

// ── 6. Email layout ─────────────────────────────────────────────────────────

run('the email opens with 3-5 summary lines, then needs-you, PRs, deploy, deadlines, then check results', () => {
    const html = render({
        reviewFollowups: { codex: [], unassignedWatch: [] },
        prProgress: { merged: [], mergedComplete: true, open: [], openCount: 0, openComplete: true },
        memberSite: ops.memberSiteState({}),
        deadlines: { windowDays: 14, upcoming: [] },
        actions: null, pullRequests: null, issueInventory: null, dataWorkflows: null, accuracy: null,
    });
    const summary = html.slice(html.indexOf('<ul'), html.indexOf('</ul>'));
    const lines = (summary.match(/<li>/g) || []).length;
    assert.ok(lines >= 3 && lines <= 5, `summary has ${lines} lines`);
    const order = ['<ul', '🙋 Needs You', '🔀 Pull Requests', '🚀 Deploy', '📅 Deadlines', 'Check Results', '🔍 Repository Health Summary', '📋 Detailed Findings']
        .map(marker => [marker, html.indexOf(marker)]);
    for (const [marker, index] of order) assert.ok(index >= 0, `missing ${marker}`);
    for (let i = 1; i < order.length; i += 1) assert.ok(order[i - 1][1] < order[i][1], `${order[i - 1][0]} must come before ${order[i][0]}`);
});

run('check results list only failures and checks that did not run', () => {
    const checks = [
        { name: 'Alpha Passing', status: 'passed' },
        { name: 'Beta Passing', status: 'passed' },
        { name: 'Gamma Failing', status: 'failed' },
        { name: 'Delta Unread', status: 'unavailable' },
    ];
    const html = buildHtmlReport({ summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, allIssues: [],
        comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] }, priorDate: null, trend: [], runDurationMs: 1,
        auditHealth: { totalChecks: 4, passed: 2, failed: 1, skipped: 0, unavailable: 1, checks } });
    assert.ok(!html.includes('Alpha Passing') && !html.includes('Beta Passing'), 'passing checks are summarized, not listed');
    assert.ok(html.includes('Gamma Failing') && html.includes('Delta Unread'));
    assert.match(html, /2 other check\(s\) passed/);
});

(async () => {
    console.log('daily-audit-operations');
    for (const { name, fn } of tests) {
        try { await fn(); console.log('  ✓ ' + name); }
        catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
    }
    console.log(failures === 0 ? '  all daily-audit-operations guards passed' : '  ' + failures + ' guard(s) failed');
    process.exit(failures === 0 ? 0 : 1);
})();
