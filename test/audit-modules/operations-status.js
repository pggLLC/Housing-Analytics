'use strict';

/**
 * Operations status for the daily audit email: five short sections the owner
 * asked for alongside Pull Request Progress.
 *
 *  - Member Site Deploy: how far main is ahead of the last member-site build.
 *  - Scheduled Data Workflows: data workflows whose last scheduled run in the
 *    past 24h failed, or was cancelled before any job started.
 *  - Review Follow-ups: open issues from Codex reviews, and bot watch issues
 *    nobody is assigned to.
 *  - Upcoming Deadlines: the next 14 days of data/deadlines.json.
 *  - Source & Figure Accuracy: broken source links and hand-verified figures
 *    past their review date. Accuracy, not freshness: data-freshness-check
 *    and benchmark-freshness already cover cadence.
 *
 * Each section reports; none emits findings (failing runs and broken links
 * already reach the findings list through their own checks), so none can
 * change the email's subject or the job's exit code. The pure functions are
 * exported and tested on fixtures in test/daily-audit-operations.test.js.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ── Member Site Deploy ───────────────────────────────────────────────────────

// The member site (coho-backend) records the HA commit it was built from in
// /.coho-build.json, but serves it only behind Cloudflare Access, and nothing
// in this repo records a member-site deploy (deploy-test.sh runs by hand from
// a local checkout). So the distance is unknown unless MEMBER_SITE_BUILD_URL
// names a stamp the runner can read without signing in. A number is never
// guessed from anything else.
const REVISION_FIELDS = ['source_revision', 'commit', 'sha', 'revision'];

function buildRevision(build) {
    if (!build || typeof build !== 'object') return null;
    for (const field of REVISION_FIELDS) {
        const value = build[field];
        if (typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value.trim())) return value.trim().toLowerCase();
    }
    return null;
}

/** { known, revision, aheadBy, builtAt, reason } from a stamp and a compare. */
function memberSiteState({ buildUrl, build, compare }) {
    if (!buildUrl) {
        return {
            known: false,
            revision: null,
            aheadBy: null,
            builtAt: null,
            reason: 'Nothing public records a member-site deploy: its build stamp (/.coho-build.json) is behind Cloudflare Access.',
        };
    }
    const revision = buildRevision(build);
    if (!revision) {
        return { known: false, revision: null, aheadBy: null, builtAt: null,
            reason: `The build stamp at ${buildUrl} names no source revision.` };
    }
    const aheadBy = compare && Number.isInteger(compare.ahead_by) ? compare.ahead_by : null;
    return {
        known: aheadBy !== null,
        revision,
        aheadBy,
        builtAt: (build && (build.built_at || build.builtAt || build.generated_at)) || null,
        reason: aheadBy === null ? `Revision ${revision.slice(0, 7)} could not be compared with main.` : null,
    };
}

/**
 * The check row for an informational section: none while everything was
 * read, `unavailable` as soon as any part was not. The parts that were read
 * stay in the summary; this row is what makes Audit Health, the banner and
 * the subject say the section is incomplete (overallStatus 'checks-not-run')
 * instead of reading healthy beside an "unavailable" card.
 */
function partialCheck(name, errors) {
    if (!errors || errors.length === 0) return null;
    return { name, critical: false, status: 'unavailable', summary: 'Partly unavailable', details: errors.join('; ') };
}

async function collectMemberSite(owner, repo, client, nowMs, ctx = {}) {
    const env = ctx.env || process.env;
    const buildUrl = (env.MEMBER_SITE_BUILD_URL || '').trim();
    if (!buildUrl) return { issues: [], summary: memberSiteState({}), check: null };
    // A stamp behind Access answers with a login page, not JSON; external()
    // throws on that and the section is reported unavailable.
    const build = await client.external(buildUrl);
    const revision = buildRevision(build);
    const compare = revision
        ? await client.json(`/repos/${owner}/${repo}/compare/${revision}...main`)
        : null;
    const summary = memberSiteState({ buildUrl, build, compare });
    // No URL configured is the expected "Unknown" (above). A configured stamp
    // that gives no comparable revision is a failed read, not a normal state.
    return { issues: [], summary, check: partialCheck('Member Site Deploy', summary.known ? [] : [summary.reason]) };
}

// ── Scheduled Data Workflows ─────────────────────────────────────────────────

// Data workflows are the ones that fetch, build or refresh files under data/.
// Named by file, because their steps commit through several different paths
// (git add, the data-commits queue, dispatch-pages-deploy).
const DATA_WORKFLOW_FILE = /^(?:(?:fetch|build|backfill|rebuild|refresh|cache|update|scrape|discover)-[\w.-]+|car-data-update|data-refresh|funding-awards|market_data_build|zillow-data-sync|pab-allocations-annual|sync-data-mtimes|weekly_housing_brief)\.ya?ml$/;
const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

function workflowFile(run) {
    return path.basename(String((run && run.path) || '').split('@')[0]);
}

function isDataWorkflow(run) {
    return DATA_WORKFLOW_FILE.test(workflowFile(run));
}

/**
 * The latest completed scheduled run per data workflow in the window, kept
 * when it failed or was cancelled (jobs are checked by the caller). A failure
 * already followed by a success is resolved and not listed.
 */
function latestDataRunsToReview(runs, nowMs) {
    const sinceMs = nowMs - ONE_DAY_MS;
    const latest = new Map();
    const newest = new Map();
    const ordered = [...(runs || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    for (const run of ordered) {
        if (!run || run.event !== 'schedule' || !isDataWorkflow(run)) continue;
        if (Date.parse(run.created_at) < sinceMs) continue;
        if (!newest.has(run.workflow_id)) newest.set(run.workflow_id, run);
        if (run.status && run.status !== 'completed') continue;
        if (!latest.has(run.workflow_id)) latest.set(run.workflow_id, run);
    }
    // A cancel with a newer run of the same workflow (even one still going)
    // was superseded, as in repo-health's failingLatestRuns.
    return [...latest.values()].filter(run => FAILED.has(run.conclusion) ||
        (run.conclusion === 'cancelled' && newest.get(run.workflow_id) === run));
}

/**
 * Final rows. `jobCounts` maps run id to its job total; a cancelled run is
 * listed only with 0 jobs (it never started: a concurrency or queue cancel).
 * A cancelled run with jobs is a timeout or a human, and Actions Health
 * already lists every cancelled latest run.
 */
function dataWorkflowProblems(candidates, jobCounts) {
    return (candidates || [])
        .map(run => {
            const jobs = jobCounts && Object.prototype.hasOwnProperty.call(jobCounts, run.id) ? jobCounts[run.id] : null;
            if (run.conclusion === 'cancelled') {
                if (jobs !== 0) return null;
                return { name: run.name, file: workflowFile(run), outcome: 'cancelled with 0 jobs', at: run.created_at, url: run.html_url };
            }
            return { name: run.name, file: workflowFile(run), outcome: run.conclusion, at: run.created_at, url: run.html_url };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function collectDataWorkflows(owner, repo, client, nowMs) {
    const sinceIso = new Date(nowMs - ONE_DAY_MS).toISOString();
    const listing = await client.paginate(
        `/repos/${owner}/${repo}/actions/runs?branch=main&event=schedule&created=${encodeURIComponent('>=' + sinceIso)}`,
        body => body.workflow_runs
    );
    const candidates = latestDataRunsToReview(listing.items, nowMs);
    const jobCounts = {};
    for (const run of candidates.filter(r => r.conclusion === 'cancelled')) {
        const jobs = await client.json(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=1`);
        jobCounts[run.id] = typeof jobs.total_count === 'number' ? jobs.total_count : null;
    }
    const problems = dataWorkflowProblems(candidates, jobCounts);
    return {
        issues: [],
        summary: { problems, complete: listing.complete },
        check: {
            name: 'Scheduled Data Workflows',
            critical: false,
            // A warning, not failed: this section files no findings (Actions
            // Health files the high finding for a failing run).
            status: problems.length > 0 ? 'warning' : 'passed',
            summary: `${problems.length} data workflow(s) failed or never started in 24h`,
        },
    };
}

// ── Review Follow-ups ────────────────────────────────────────────────────────

// Codex-review follow-ups are filed by hand ("…follow-ups from the Codex
// review of #2487") or by the Codex bot; either names Codex in the title or
// carries a codex label. Watch issues are opened by github-actions[bot] under
// labels such as funding-watch and upstream-vintage.
const CODEX = /\bcodex\b/i;
const WATCH = /watch|vintage/i;

function isBotUser(user) {
    return Boolean(user && (user.type === 'Bot' || /\[bot\]$/i.test(user.login || '')));
}

function labelNames(issue) {
    return (issue.labels || []).map(label => String(typeof label === 'string' ? label : label.name || ''));
}

function issueRow(issue) {
    return { number: issue.number, title: issue.title || '', url: issue.html_url || '', createdAt: issue.created_at, labels: labelNames(issue) };
}

/** { codex, unassignedWatch } rows from a REST open-issues listing. */
function reviewFollowups(items) {
    const issues = (items || []).filter(item => item && !item.pull_request);
    const codex = issues.filter(issue =>
        CODEX.test(issue.title || '') ||
        labelNames(issue).some(name => CODEX.test(name)) ||
        /^chatgpt-codex-connector/i.test((issue.user && issue.user.login) || ''));
    const unassignedWatch = issues.filter(issue =>
        isBotUser(issue.user) &&
        (labelNames(issue).some(name => WATCH.test(name)) || /\bwatch\b/i.test(issue.title || '')) &&
        (issue.assignees || []).length === 0 && !issue.assignee);
    return { codex: codex.map(issueRow), unassignedWatch: unassignedWatch.map(issueRow) };
}

async function collectReviewFollowups(owner, repo, client) {
    const open = await client.paginate(`/repos/${owner}/${repo}/issues?state=open&sort=created&direction=asc`);
    const rows = reviewFollowups(open.items);
    return { issues: [], summary: { ...rows, complete: open.complete }, check: null };
}

// ── Upcoming Deadlines ───────────────────────────────────────────────────────

const DEADLINES_FILE = path.join(ROOT, 'data', 'deadlines.json');
const DEADLINE_WINDOW_DAYS = 14;

/** YYYY-MM-DD in America/Denver, the day the owner reads the email. */
function denverDay(nowMs) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(nowMs));
}

function addDays(isoDay, days) {
    const d = new Date(`${isoDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Throws on a malformed file, so a typo reads as unavailable, not as "none due". */
function upcomingDeadlines(doc, today, days = DEADLINE_WINDOW_DAYS) {
    if (!doc || !Array.isArray(doc.deadlines)) throw new Error('data/deadlines.json has no deadlines array');
    const horizon = addDays(today, days);
    for (const entry of doc.deadlines) {
        if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date)) || !entry.title || !/^https:\/\//.test(String(entry.source || ''))) {
            throw new Error(`data/deadlines.json: entry needs date (YYYY-MM-DD), title and an https source: ${JSON.stringify(entry)}`);
        }
    }
    return doc.deadlines
        .filter(entry => entry.date >= today && entry.date <= horizon)
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
        .map(entry => ({
            date: entry.date,
            daysAway: Math.round((Date.parse(entry.date) - Date.parse(today)) / ONE_DAY_MS),
            title: entry.title,
            source: entry.source,
            status: entry.status || null,
        }));
}

function collectDeadlines(nowMs, file = DEADLINES_FILE) {
    const today = denverDay(nowMs);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { today, windowDays: DEADLINE_WINDOW_DAYS, upcoming: upcomingDeadlines(doc, today) };
}

// ── Source & Figure Accuracy ─────────────────────────────────────────────────

const URL_HEALTH_FILE = path.join(ROOT, 'data', 'url-health.json');
const POLICY_REVIEW_MODULE = path.join(ROOT, 'scripts', 'audit', 'policy-review-reminders.mjs');
const URL_HEALTH_POLICY_MODULE = path.join(ROOT, 'scripts', 'audit', 'url-health-policy.mjs');
// Open issues that say a source or a figure needs re-checking.
const ACCURACY_LABELS = new Set(['url-health', 'policy-review', 'brief-review']);
const ACCURACY_TITLE = /^Benchmark snapshots past their/i;

/** The weekly sweep's own classifier (url-health-policy.mjs), loaded once. */
async function loadUrlHealthPolicy() {
    const mod = await import(pathToFileURL(URL_HEALTH_POLICY_MODULE).href);
    return { diffConfirmedSweeps: mod.diffConfirmedSweeps, CONFIRMED_FAILURE_SWEEPS: mod.CONFIRMED_FAILURE_SWEEPS };
}

/**
 * Broken source links from the weekly URL sweep's committed state, classified
 * by the sweep's own confirmation rule rather than a copy of it: a URL is
 * newly broken on its CONFIRMED_FAILURE_SWEEPS-th consecutive failure, a
 * first failure is unconfirmed, and later ones are still broken. Diffing the
 * state against itself applies that rule to the current sweep alone.
 */
function urlHealthSummary(doc, policy) {
    if (!doc || typeof doc.byUrl !== 'object' || !doc.byUrl) throw new Error('data/url-health.json has no byUrl map');
    if (!policy || typeof policy.diffConfirmedSweeps !== 'function') throw new Error('url-health policy not loaded');
    const { newlyBroken, stillBroken, unconfirmed } = policy.diffConfirmedSweeps(doc, doc);
    const row = failure => ({ url: failure.url, httpStatus: failure.httpStatus ?? null, status: failure.status });
    return {
        lastSweepAt: doc.lastSweepAt || null,
        confirmedAfter: policy.CONFIRMED_FAILURE_SWEEPS,
        broken: newlyBroken.length + stillBroken.length,
        newlyBroken: newlyBroken.map(row),
        unconfirmed: unconfirmed.length,
    };
}

/**
 * Sum of overdue counts. Unknown stays separate from zero (AGENTS.md): a file
 * that could not be read makes the total a lower bound, never a plain number.
 * Returns { count, partial } or null when nothing was read at all.
 */
function overdueTotal(rows) {
    if (!Array.isArray(rows)) return null;
    let count = 0;
    let partial = false;
    for (const row of rows) {
        if (typeof row.overdue === 'number') count += row.overdue;
        else partial = true;
    }
    return { count, partial };
}

/**
 * Hand-verified records whose review_by has passed, per watched file, using
 * the same file list as policy-review-reminders.mjs. `docs` maps file to JSON.
 */
function overdueReviews(specs, docs, today) {
    const rows = [];
    for (const spec of specs || []) {
        const doc = docs[spec.file];
        const records = doc && Array.isArray(doc[spec.key]) ? doc[spec.key] : null;
        if (!records) { rows.push({ title: spec.title, file: spec.file, overdue: null }); continue; }
        const overdue = records.filter(record => {
            const by = /^\d{4}-\d{2}-\d{2}/.test(String(record.review_by || '')) ? String(record.review_by).slice(0, 10) : null;
            return by && by < today;
        }).length;
        if (overdue > 0) rows.push({ title: spec.title, file: spec.file, overdue });
    }
    return rows;
}

function accuracyIssues(items) {
    return (items || [])
        .filter(item => item && !item.pull_request)
        .filter(issue => labelNames(issue).some(name => ACCURACY_LABELS.has(name)) || ACCURACY_TITLE.test(issue.title || ''))
        .map(issueRow);
}

async function loadReviewSpecs() {
    const mod = await import(pathToFileURL(POLICY_REVIEW_MODULE).href);
    return mod.FILES;
}

async function collectAccuracy(owner, repo, client, nowMs, ctx = {}) {
    const root = ctx.root || ROOT;
    const today = denverDay(nowMs);
    const summary = { today, urlHealth: null, overdue: null, sweep: null, issues: null, errors: [] };
    const note = (label, err) => summary.errors.push(`${label}: ${err && err.message ? err.message : String(err)}`);

    // Local reads first: a GitHub outage must not hide what the checkout knows.
    try {
        summary.urlHealth = urlHealthSummary(JSON.parse(fs.readFileSync(path.join(root, 'data', 'url-health.json'), 'utf8')), await loadUrlHealthPolicy());
    } catch (err) { note('url-health.json', err); }
    try {
        const specs = await loadReviewSpecs();
        const docs = {};
        for (const spec of specs) {
            if (docs[spec.file]) continue;
            try { docs[spec.file] = JSON.parse(fs.readFileSync(path.join(root, spec.file), 'utf8')); } catch (err) { docs[spec.file] = null; note(spec.file, err); }
        }
        summary.overdue = overdueReviews(specs, docs, today);
    } catch (err) { note('review dates', err); }

    try {
        const runs = await client.json(`/repos/${owner}/${repo}/actions/workflows/source-url-sweep.yml/runs?branch=main&per_page=1`);
        const run = (runs.workflow_runs || [])[0] || null;
        summary.sweep = run ? { conclusion: run.conclusion || run.status, at: run.created_at, url: run.html_url } : { conclusion: 'never run', at: null, url: null };
    } catch (err) { note('source URL sweep', err); }
    try {
        const open = await client.paginate(`/repos/${owner}/${repo}/issues?state=open&sort=created&direction=asc`);
        summary.issues = accuracyIssues(open.items);
    } catch (err) { note('accuracy issues', err); }

    return { issues: [], summary, check: partialCheck('Source & Figure Accuracy', summary.errors) };
}

module.exports = {
    accuracyIssues,
    buildRevision,
    collectAccuracy,
    collectDataWorkflows,
    collectDeadlines,
    collectMemberSite,
    collectReviewFollowups,
    dataWorkflowProblems,
    denverDay,
    isDataWorkflow,
    latestDataRunsToReview,
    memberSiteState,
    loadUrlHealthPolicy,
    partialCheck,
    overdueReviews,
    overdueTotal,
    reviewFollowups,
    upcomingDeadlines,
    urlHealthSummary,
    DEADLINES_FILE,
    URL_HEALTH_FILE,
};
