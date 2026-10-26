'use strict';

/**
 * Pull Request Progress for the daily audit email.
 *
 * PRs now merge on their own once CI and the Codex review are clean, so the
 * owner no longer sees them go by. This section lists what merged in the last
 * 24 hours and where every open PR stands: CI on its head commit, and whether
 * Codex has reviewed that head. It reports; it emits no findings — failing
 * checks and conflicts are already findings under Pull Request Triage.
 *
 * Everything below `collectPrProgress` is a pure function of the GraphQL
 * nodes, so the state logic is tested on fixture JSON with no network.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// One page cap per listing. Past it the list is marked incomplete rather than
// shown as if it were everything.
const MAX_PAGES = 10;

// Codex (chatgpt-codex-connector[bot]) keeps one summary comment per PR and
// rewrites it in place. GraphQL gives a bot's login without the [bot] suffix;
// REST gives it with. Only its comments are trusted for the state marker: on
// a public repo anyone can paste the marker into a comment.
const CODEX_LOGIN = /^chatgpt-codex-connector(\[bot\])?$/i;
const CODEX_MARKER = /<!--\s*codex-review-state:v1\s+([\s\S]*?)\s*-->/;

// Bot PR authors named in the email. Any other Bot account is labelled with
// its own login.
const BOT_LABELS = {
    'dependabot': 'dependabot',
    'github-actions': 'github-actions',
};

function decodeEntities(text) {
    return String(text)
        .replace(/&#123;|&#x7b;|&lbrace;/gi, '{')
        .replace(/&#125;|&#x7d;|&rbrace;/gi, '}')
        .replace(/&quot;|&#34;|&#x22;/gi, '"')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

/**
 * The `code_review` object from a Codex summary comment body, or null when the
 * body carries no marker or the marker's JSON does not parse. The braces may
 * arrive HTML-escaped (&#123; &#125;).
 */
function parseCodexState(body) {
    const match = CODEX_MARKER.exec(String(body || ''));
    if (!match) return null;
    try {
        const parsed = JSON.parse(decodeEntities(match[1]));
        return parsed && typeof parsed.code_review === 'object' && parsed.code_review ? parsed.code_review : null;
    } catch (_) {
        return null;
    }
}

/** The newest Codex-authored comment that carries a parseable state marker. */
function codexStateFromComments(comments) {
    const list = comments || [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
        const comment = list[index] || {};
        const login = comment.author && comment.author.login;
        if (!login || !CODEX_LOGIN.test(login)) continue;
        const state = parseCodexState(comment.body);
        if (state) return state;
    }
    return null;
}

/** Full and abbreviated SHAs name the same commit. */
function sameCommit(a, b) {
    const x = String(a || '').toLowerCase();
    const y = String(b || '').toLowerCase();
    if (x.length < 7 || y.length < 7) return false;
    return x.startsWith(y) || y.startsWith(x);
}

const CODEX_RUNNING = new Set(['running', 'queued', 'pending', 'in_progress', 'started']);

/**
 * One of: 'clean on head', 'findings open', 'reviewing', 'not reviewed on head'.
 * A review of an older commit says nothing about the head, whatever it found.
 */
function codexReviewState(codeReview, headSha) {
    if (!codeReview || !sameCommit(codeReview.commit_sha, headSha)) return 'not reviewed on head';
    const status = String(codeReview.status || '').toLowerCase();
    if (CODEX_RUNNING.has(status)) return 'reviewing';
    if (status.startsWith('complete')) {
        return codeReview.has_unresolved_findings ? 'findings open' : 'clean on head';
    }
    return 'not reviewed on head';
}

// The one result to look at (ci-checks.yml): its `ci-checks` job gathers
// every test:ci leg and other-checks. A SUCCESS rollup is not enough: it can
// be green before ci-checks has even been queued, or with ci-checks skipped.
const CI_CHECK_NAME = 'ci-checks';
const CI_FAILED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'STALE']);

/**
 * CI on the head: the state of the `ci-checks` check run itself, from the
 * head commit's statusCheckRollup contexts. passing / failing / running /
 * cancelled / 'no ci-checks run', or 'unknown' when the context list was cut
 * off before ci-checks appeared. A re-run or a second event's run is a newer
 * attempt, so the newest one decides.
 */
function ciState(rollup) {
    const contexts = (rollup && rollup.contexts) || {};
    const runs = (contexts.nodes || []).filter(node => node && node.name === CI_CHECK_NAME && (!node.__typename || node.__typename === 'CheckRun'));
    if (runs.length === 0) {
        return contexts.pageInfo && contexts.pageInfo.hasNextPage ? 'unknown' : 'no ci-checks run';
    }
    // Not started yet (queued) sorts as newest.
    const started = run => (run.startedAt ? Date.parse(run.startedAt) : Infinity);
    const latest = runs.reduce((a, b) => (started(b) > started(a) ? b : a));
    if (String(latest.status || '').toUpperCase() !== 'COMPLETED') return 'running';
    const conclusion = String(latest.conclusion || '').toUpperCase();
    if (conclusion === 'SUCCESS') return 'passing';
    if (conclusion === 'CANCELLED') return 'cancelled';
    if (CI_FAILED.has(conclusion)) return 'failing';
    return `not passed (${conclusion.toLowerCase() || 'no conclusion'})`;
}

/** 'dependabot', 'github-actions', another bot's login, or null for a person. */
function botLabel(author) {
    if (!author || !author.login) return null;
    const login = String(author.login).replace(/\[bot\]$/i, '');
    if (BOT_LABELS[login.toLowerCase()]) return BOT_LABELS[login.toLowerCase()];
    if (author.__typename === 'Bot' || /\[bot\]$/i.test(author.login)) return login;
    return null;
}

/** "45m", "7h", "3d" — short enough for a table cell. */
function formatAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'unknown';
    if (ms < ONE_HOUR_MS) return `${Math.max(1, Math.round(ms / 60000))}m`;
    if (ms < 2 * ONE_DAY_MS) return `${Math.floor(ms / ONE_HOUR_MS)}h`;
    return `${Math.floor(ms / ONE_DAY_MS)}d`;
}

/** Merged-in-window rows, newest merge first. */
function summarizeMerged(nodes, nowMs) {
    const sinceMs = nowMs - ONE_DAY_MS;
    return (nodes || [])
        .filter(pr => pr && pr.mergedAt && Date.parse(pr.mergedAt) >= sinceMs && Date.parse(pr.mergedAt) <= nowMs)
        .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
        .map(pr => ({
            number: pr.number,
            title: pr.title || '',
            url: pr.url || '',
            mergedAt: pr.mergedAt,
            mergedBy: pr.mergedBy && pr.mergedBy.login ? pr.mergedBy.login : null,
            bot: botLabel(pr.author),
        }));
}

/** Open-PR rows, oldest first so what has waited longest leads. */
function summarizeOpen(nodes, nowMs) {
    return (nodes || [])
        .filter(Boolean)
        .map(pr => {
            const head = (((pr.commits || {}).nodes || [])[0] || {}).commit || {};
            const headSha = pr.headRefOid || head.oid || '';
            return {
                number: pr.number,
                title: pr.title || '',
                url: pr.url || '',
                createdAt: pr.createdAt,
                age: formatAge(nowMs - Date.parse(pr.createdAt)),
                draft: Boolean(pr.isDraft),
                bot: botLabel(pr.author),
                ci: ciState(head.statusCheckRollup),
                codex: codexReviewState(codexStateFromComments((pr.comments || {}).nodes), headSha),
            };
        })
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

const MERGED_QUERY = `
    query PrProgressMerged($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequests(states: MERGED, first: 50, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            title
            url
            mergedAt
            updatedAt
            mergedBy { login }
            author { login __typename }
          }
        }
      }
    }
`;

const OPEN_QUERY = `
    query PrProgressOpen($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequests(states: OPEN, first: 25, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            title
            url
            createdAt
            isDraft
            headRefOid
            author { login __typename }
            commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) {
              pageInfo { hasNextPage }
              nodes { __typename ... on CheckRun { name status conclusion startedAt } }
            } } } } }
            comments(last: 100) { nodes { author { login } body } }
          }
        }
      }
    }
`;

function connectionOf(data) {
    const conn = ((data || {}).repository || {}).pullRequests;
    if (!conn) throw new Error('graphql returned no pullRequests connection');
    return conn;
}

/**
 * Reads merged and open PRs through the repo-health GitHub client. Throws on
 * an API failure; collectRepoHealth turns that into an `unavailable` section
 * so the rest of the email still sends.
 */
async function collectPrProgress(owner, repo, client, nowMs) {
    const sinceMs = nowMs - ONE_DAY_MS;

    // Ordered by last update: mergedAt <= updatedAt, so once a page's oldest
    // update is before the window, no later page can hold a merge inside it.
    const mergedNodes = [];
    let mergedComplete = false;
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const conn = connectionOf(await client.graphql(MERGED_QUERY, { owner, repo, cursor }));
        const nodes = conn.nodes || [];
        mergedNodes.push(...nodes);
        const oldest = nodes.length > 0 ? Date.parse(nodes[nodes.length - 1].updatedAt) : -Infinity;
        if (!conn.pageInfo || !conn.pageInfo.hasNextPage || oldest < sinceMs) { mergedComplete = true; break; }
        cursor = conn.pageInfo.endCursor;
    }

    const openNodes = [];
    let openTotal = null;
    let openComplete = false;
    cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const conn = connectionOf(await client.graphql(OPEN_QUERY, { owner, repo, cursor }));
        if (typeof conn.totalCount === 'number') openTotal = conn.totalCount;
        openNodes.push(...(conn.nodes || []));
        if (!conn.pageInfo || !conn.pageInfo.hasNextPage) { openComplete = true; break; }
        cursor = conn.pageInfo.endCursor;
    }

    const merged = summarizeMerged(mergedNodes, nowMs);
    const open = summarizeOpen(openNodes, nowMs);
    return {
        issues: [],
        summary: { merged, mergedComplete, open, openCount: openTotal, openComplete },
        // Informational: no check row, so a day of merges is not a "passed" check.
        check: null,
    };
}

module.exports = {
    botLabel,
    ciState,
    codexReviewState,
    codexStateFromComments,
    collectPrProgress,
    formatAge,
    parseCodexState,
    summarizeMerged,
    summarizeOpen,
};
