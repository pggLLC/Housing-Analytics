'use strict';

/**
 * Guards for the daily audit's Pull Request Progress section.
 *
 * PRs merge on their own once CI and the Codex review are clean, so the email
 * is where the owner sees them go by. Each block pins a behaviour on fixture
 * GraphQL nodes, with no network:
 *
 *  - Codex review state is read only from Codex's own comment, with the
 *    marker's braces escaped or not, and only counts for the head commit;
 *  - CI on the head is the `ci-checks` check run itself, never just a green
 *    rollup: passing / failing / running / cancelled / no ci-checks run;
 *  - bot PRs are labelled, merged rows are only the last 24h;
 *  - an API failure leaves this section unavailable and the rest intact.
 */

const assert = require('node:assert/strict');
const {
    botLabel,
    ciState,
    codexReviewState,
    codexStateFromComments,
    collectPrProgress,
    formatAge,
    parseCodexState,
    summarizeMerged,
    summarizeOpen,
} = require('./audit-modules/pr-progress.js');
const { collectRepoHealth } = require('./audit-modules/repo-health.js');
const { buildHtmlReport } = require('./audit-modules/report-generator.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OLD = '0000000aaaaaaabbbbbbbcccccccdddddddeeeee';

let failures = 0;
const tests = [];
function run(name, fn) { tests.push({ name, fn }); }

function codexComment(state, { escaped = false, login = 'chatgpt-codex-connector' } = {}) {
    let json = JSON.stringify({ code_review: state });
    if (escaped) json = json.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
    return { author: { login }, body: `### Codex Review\nSummary text.\n<!-- codex-review-state:v1 ${json} -->` };
}

/** A head rollup whose contexts hold one `ci-checks` run in the given state. */
function ciRun(status, conclusion = null, startedAt = iso(NOW - HOUR), name = 'ci-checks') {
    return { __typename: 'CheckRun', name, status, conclusion, startedAt };
}
function rollupWith(nodes, { state = 'SUCCESS', hasNextPage = false } = {}) {
    return { state, contexts: { pageInfo: { hasNextPage }, nodes } };
}
const ROLLUPS = {
    SUCCESS: rollupWith([ciRun('COMPLETED', 'SUCCESS'), ciRun('COMPLETED', 'SUCCESS', iso(NOW - HOUR), 'axe')]),
    FAILURE: rollupWith([ciRun('COMPLETED', 'FAILURE')], { state: 'FAILURE' }),
    PENDING: rollupWith([ciRun('IN_PROGRESS')], { state: 'PENDING' }),
};

function openNode({ number = 1, createdAt = NOW - 3 * DAY, rollup = 'SUCCESS', comments = [], author = { login: 'paulglasow', __typename: 'User' }, draft = false } = {}) {
    return {
        number,
        title: `PR ${number}`,
        url: `https://example.com/o/r/pull/${number}`,
        createdAt: iso(createdAt),
        isDraft: draft,
        headRefOid: HEAD,
        author,
        commits: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: rollup ? ROLLUPS[rollup] : null } }] },
        comments: { nodes: comments },
    };
}

// ── 1. Codex review state ───────────────────────────────────────────────────

run('the state marker parses with plain or HTML-escaped braces, and junk is null', () => {
    const state = { commit_sha: HEAD, has_unresolved_findings: false, status: 'completed' };
    assert.deepEqual(parseCodexState(codexComment(state).body), state);
    assert.deepEqual(parseCodexState(codexComment(state, { escaped: true }).body), state);
    assert.equal(parseCodexState('no marker here'), null);
    assert.equal(parseCodexState('<!-- codex-review-state:v1 {not json} -->'), null, 'a broken marker is unknown, not clean');
});

run('each Codex state is named for the head commit only', () => {
    const at = (sha, status, findings) => ({ commit_sha: sha, status, has_unresolved_findings: findings });
    assert.equal(codexReviewState(at(HEAD, 'completed', false), HEAD), 'clean on head');
    assert.equal(codexReviewState(at(HEAD, 'completed', true), HEAD), 'findings open');
    assert.equal(codexReviewState(at(HEAD, 'running', false), HEAD), 'reviewing');
    assert.equal(codexReviewState(at(HEAD.slice(0, 7), 'completed', false), HEAD), 'clean on head', 'a short SHA names the same commit');
    assert.equal(codexReviewState(at(OLD, 'completed', false), HEAD), 'not reviewed on head',
        'a clean review of an older commit says nothing about what would merge now');
    assert.equal(codexReviewState(null, HEAD), 'not reviewed on head');
});

run('only Codex\'s own comment counts, and the newest one wins', () => {
    const clean = { commit_sha: HEAD, status: 'completed', has_unresolved_findings: false };
    const spoofed = codexComment(clean, { login: 'someone-else' });
    assert.equal(codexStateFromComments([spoofed]), null, 'on a public repo anyone can paste the marker');
    const older = codexComment({ ...clean, commit_sha: OLD });
    const newer = codexComment(clean, { login: 'chatgpt-codex-connector[bot]' });
    assert.equal(codexStateFromComments([older, { author: { login: 'paulglasow' }, body: 'lgtm' }, newer]).commit_sha, HEAD);
});

// ── 2. CI, bots, ages ───────────────────────────────────────────────────────

run('CI on head is the ci-checks run itself, not the rollup', () => {
    assert.equal(ciState(rollupWith([ciRun('COMPLETED', 'SUCCESS')])), 'passing');
    assert.equal(ciState(rollupWith([ciRun('COMPLETED', 'SUCCESS', iso(NOW - HOUR), 'axe')])), 'no ci-checks run',
        'a SUCCESS rollup without ci-checks is not passing: ci-checks may not have been queued yet');
    assert.equal(ciState(rollupWith([ciRun('QUEUED', null, null)], { state: 'SUCCESS' })), 'running', 'pending ci-checks is running, whatever the rollup says');
    assert.equal(ciState(rollupWith([ciRun('IN_PROGRESS')])), 'running');
    assert.equal(ciState(rollupWith([ciRun('COMPLETED', 'FAILURE')])), 'failing');
    assert.equal(ciState(rollupWith([ciRun('COMPLETED', 'TIMED_OUT')])), 'failing');
    assert.equal(ciState(rollupWith([ciRun('COMPLETED', 'CANCELLED')])), 'cancelled');
    assert.equal(ciState(rollupWith([ciRun('COMPLETED', 'SKIPPED')])), 'not passed (skipped)', 'a skipped ci-checks is not passing');
    assert.equal(ciState(rollupWith([{ __typename: 'StatusContext', context: 'ci-checks', state: 'SUCCESS' }])), 'no ci-checks run',
        'only the check run counts');
    assert.equal(ciState(null), 'no ci-checks run', 'nothing reported is not "passing"');
    assert.equal(ciState(rollupWith([], { hasNextPage: true })), 'unknown', 'a cut-off context list is unknown, not missing');
});

run('the newest ci-checks attempt decides', () => {
    const older = ciRun('COMPLETED', 'FAILURE', iso(NOW - 3 * HOUR));
    const newer = ciRun('COMPLETED', 'SUCCESS', iso(NOW - HOUR));
    assert.equal(ciState(rollupWith([newer, older])), 'passing');
    assert.equal(ciState(rollupWith([older, ciRun('IN_PROGRESS', null, iso(NOW - 10 * 60 * 1000))])), 'running');
});

run('dependabot and github-actions PRs are labelled as bots; people are not', () => {
    assert.equal(botLabel({ login: 'dependabot', __typename: 'Bot' }), 'dependabot');
    assert.equal(botLabel({ login: 'dependabot[bot]' }), 'dependabot');
    assert.equal(botLabel({ login: 'github-actions', __typename: 'Bot' }), 'github-actions');
    assert.equal(botLabel({ login: 'renovate', __typename: 'Bot' }), 'renovate');
    assert.equal(botLabel({ login: 'paulglasow', __typename: 'User' }), null);
    assert.equal(botLabel(null), null);
});

run('ages read as minutes, hours, then days', () => {
    assert.equal(formatAge(20 * 60 * 1000), '20m');
    assert.equal(formatAge(7 * HOUR), '7h');
    assert.equal(formatAge(30 * HOUR), '30h');
    assert.equal(formatAge(5 * DAY + HOUR), '5d');
    assert.equal(formatAge(NaN), 'unknown');
});

// ── 3. Rows ─────────────────────────────────────────────────────────────────

run('merged rows are the last 24h only, newest first, with who merged', () => {
    const rows = summarizeMerged([
        { number: 10, title: 'old', url: 'u10', mergedAt: iso(NOW - 25 * HOUR), mergedBy: { login: 'paulglasow' } },
        { number: 11, title: 'a', url: 'u11', mergedAt: iso(NOW - 5 * HOUR), mergedBy: { login: 'github-actions' } },
        { number: 12, title: 'b', url: 'u12', mergedAt: iso(NOW - HOUR), mergedBy: null, author: { login: 'dependabot', __typename: 'Bot' } },
    ], NOW);
    assert.deepEqual(rows.map(r => r.number), [12, 11]);
    assert.equal(rows[0].mergedBy, null, 'an unknown merger is null, never guessed');
    assert.equal(rows[0].bot, 'dependabot');
    assert.equal(rows[1].mergedBy, 'github-actions');
});

run('open rows carry age, CI and Codex state, oldest first', () => {
    const rows = summarizeOpen([
        openNode({ number: 2, createdAt: NOW - HOUR, rollup: 'PENDING', comments: [codexComment({ commit_sha: HEAD, status: 'running' })] }),
        openNode({ number: 1, createdAt: NOW - 4 * DAY, rollup: 'FAILURE', comments: [codexComment({ commit_sha: HEAD, status: 'completed', has_unresolved_findings: true }, { escaped: true })] }),
        openNode({ number: 3, createdAt: NOW - 2 * HOUR, rollup: 'SUCCESS', author: { login: 'dependabot', __typename: 'Bot' }, draft: true }),
    ], NOW);
    assert.deepEqual(rows.map(r => [r.number, r.age, r.ci, r.codex, r.bot, r.draft]), [
        [1, '4d', 'failing', 'findings open', null, false],
        [3, '2h', 'passing', 'not reviewed on head', 'dependabot', true],
        [2, '1h', 'running', 'reviewing', null, false],
    ]);
});

// ── 4. Collection and fail-soft ─────────────────────────────────────────────

function fakeClient(pages) {
    const calls = [];
    return {
        calls,
        graphql: async (query, { cursor }) => {
            const kind = /states: MERGED/.test(query) ? 'merged' : 'open';
            calls.push([kind, cursor]);
            const list = pages[kind];
            const index = cursor ? Number(cursor) : 0;
            return { repository: { pullRequests: {
                totalCount: list.reduce((n, p) => n + p.length, 0),
                pageInfo: { hasNextPage: index + 1 < list.length, endCursor: String(index + 1) },
                nodes: list[index],
            } } };
        },
    };
}

run('merged pages stop once updates fall before the window', async () => {
    const recent = { number: 5, title: 't', url: 'u', mergedAt: iso(NOW - 2 * HOUR), updatedAt: iso(NOW - 2 * HOUR) };
    const stale = { number: 4, title: 's', url: 'u', mergedAt: iso(NOW - 3 * DAY), updatedAt: iso(NOW - 3 * DAY) };
    const client = fakeClient({ merged: [[recent, stale], [stale], [stale]], open: [[openNode()]] });
    const out = await collectPrProgress('o', 'r', client, NOW);
    assert.equal(client.calls.filter(([kind]) => kind === 'merged').length, 1, 'no page past the window is read');
    assert.deepEqual(out.summary.merged.map(r => r.number), [5]);
    assert.equal(out.summary.mergedComplete, true);
    assert.equal(out.summary.openCount, 1);
    assert.equal(out.check, null, 'informational: no Audit Health row for a report of merges');
    assert.deepEqual(out.issues, [], 'failing checks are already Pull Request Triage findings');
});

run('a failed PR query makes only this section unavailable, and the email still renders', async () => {
    const response = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
    const fetchImpl = async (url, options = {}) => {
        if (url.endsWith('/graphql') && /PrProgress/.test(options.body || '')) return response(502, {});
        if (url.endsWith('/graphql')) return response(200, { data: { repository: { pullRequests: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } });
        if (url.includes('/actions/workflows/deploy.yml/runs')) return response(200, { workflow_runs: [{ status: 'completed', conclusion: 'success', created_at: iso(NOW - HOUR), html_url: 'd' }] });
        if (url.includes('/actions/workflows?')) return response(200, { workflows: [] });
        if (url.includes('/actions/')) return response(200, { workflow_runs: [] });
        return response(200, []);
    };
    const health = await collectRepoHealth({ env: { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', GITHUB_API_URL: 'https://example.com/api' }, fetchImpl, now: NOW });
    const byName = Object.fromEntries(health.checks.map(c => [c.name, c.status]));
    assert.equal(byName['Pull Request Progress'], 'unavailable');
    assert.equal(byName['Pull Request Triage'], 'passed', 'the triage query is separate and still read');
    assert.equal(health.prProgress, null);
    const html = buildHtmlReport({ summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, allIssues: [],
        comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] }, priorDate: null, trend: [], runDurationMs: 1, repoHealth: health });
    const card = html.slice(html.indexOf('<h3 style="margin-top:0;">Pull Request Progress'));
    assert.match(card.slice(0, 400), /Unavailable/, 'the section says it could not be read');
    assert.match(html, /Issues Inventory/, 'and the rest of the email is still there');
});

run('the rendered tables show every column and escape titles', () => {
    const progress = {
        merged: summarizeMerged([{ number: 7, title: 'Fix <script>', url: 'https://example.com/o/r/pull/7', mergedAt: iso(NOW - HOUR), mergedBy: { login: 'github-actions' }, author: { login: 'github-actions', __typename: 'Bot' } }], NOW),
        mergedComplete: true,
        open: summarizeOpen([openNode({ number: 8, comments: [codexComment({ commit_sha: HEAD, status: 'completed', has_unresolved_findings: false })] })], NOW),
        openCount: 1,
        openComplete: true,
    };
    const html = buildHtmlReport({ summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, allIssues: [],
        comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] }, priorDate: null, trend: [], runDurationMs: 1,
        repoHealth: { prProgress: progress } });
    assert.ok(!html.includes('Fix <script>'), 'a PR title is data, never markup');
    assert.match(html, /Fix &lt;script&gt;/);
    assert.match(html, /\(bot: github-actions\)/);
    for (const text of ['Merged by', 'CI on head', 'Codex review', 'clean on head', 'passing', '3d', 'https://example.com/o/r/pull/8']) {
        assert.ok(html.includes(text), `missing ${text}`);
    }
});

(async () => {
    console.log('daily-audit-pr-progress');
    for (const { name, fn } of tests) {
        try { await fn(); console.log('  ✓ ' + name); }
        catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
    }
    console.log(failures === 0 ? '  all daily-audit-pr-progress guards passed' : '  ' + failures + ' guard(s) failed');
    process.exit(failures === 0 ? 0 : 1);
})();
