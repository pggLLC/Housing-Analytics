'use strict';

/**
 * Daily Audit System — Main Orchestrator
 *
 * Consolidates all diagnostic modules and runs the full audit pipeline:
 *   1. Data Integrity & Completeness
 *   2. Link Detection & Validation
 *   3. Logic & Methodology Validation
 *   4. UI/UX & Rendering Validation
 *   5. Performance & Dependency Monitoring
 *
 * Generates a structured severity-graded report, compares with prior audits,
 * sends the report via email, and fires a Slack alert for Critical issues.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');

const { runDataIntegrityChecks } = require('./audit-modules/data-integrity');
const { runLogicValidationChecks } = require('./audit-modules/logic-validation');
const { runUiValidationChecks } = require('./audit-modules/ui-validation');
const {
    saveAuditSnapshot,
    loadPriorSnapshot,
    compareWithPrior,
    loadTrendData,
} = require('./audit-modules/audit-history');
const {
    buildHtmlReport,
    buildSlackPayload,
    sendEmailReport,
    sendSlackAlert,
} = require('./audit-modules/report-generator');

// ── Configuration ─────────────────────────────────────────────────────────────
const WEBSITE_URL        = process.env.WEBSITE_URL        || 'https://pggllc.github.io/Housing-Analytics/';
const RECIPIENT_EMAIL    = process.env.RECIPIENT_EMAIL    || '';
const EMAIL_USER         = process.env.EMAIL_USER         || '';
const EMAIL_PASSWORD     = process.env.EMAIL_PASSWORD     || '';
const SLACK_WEBHOOK_URL  = process.env.SLACK_WEBHOOK_URL  || '';
const SKIP_EMAIL          = process.env.MONITOR_DRY_RUN === 'true' || (!RECIPIENT_EMAIL || !EMAIL_USER || !EMAIL_PASSWORD);
const REQUEST_TIMEOUT_MS = parseInt(process.env.MONITOR_TIMEOUT_MS,   10) || 12000;
const SLOW_THRESHOLD_MS  = parseInt(process.env.MONITOR_SLOW_THRESHOLD_MS, 10) || 3000;
const CONCURRENCY        = parseInt(process.env.MONITOR_CONCURRENCY,   10) || 6;
const MAX_RETRIES        = parseInt(process.env.MONITOR_MAX_RETRIES,   10) || 2;

// Reports directory
const REPORTS_DIR = path.join(__dirname, '..', 'monitoring-reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Runs a set of async tasks with limited concurrency.
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 * @returns {Promise<T[]>}
 */
async function runWithConcurrency(tasks, limit) {
    const results = [];
    let index = 0;
    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            results[i] = await tasks[i]();
        }
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * Checks a single URL and returns a structured result.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function checkLink(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const start = Date.now();
    try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
        const responseTime = Date.now() - start;
        return {
            url,
            status: res.status,
            ok: res.ok,
            responseTime,
            redirected: res.redirected || false,
            finalUrl: res.redirected ? (res.url || null) : null,
            slow: responseTime > SLOW_THRESHOLD_MS,
        };
    } catch (err) {
        return {
            url,
            status: null,
            ok: false,
            responseTime: Date.now() - start,
            redirected: false,
            finalUrl: null,
            slow: false,
            error: err.message,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Retries a link check up to MAX_RETRIES times on failure.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function checkLinkWithRetry(url) {
    let lastResult;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        lastResult = await checkLink(url);
        if (lastResult.ok) return lastResult;
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
    return lastResult;
}

/**
 * Generates a recommended fix string for a link result.
 * @param {object} result
 * @returns {string}
 */
function recommendedFix(result) {
    if (result.status === 404) return 'Page not found — update or remove this link.';
    if (result.status === 403) return 'Access forbidden — check server permissions.';
    if (result.status === 503) return 'Service unavailable — retry later or contact host.';
    if (result.status >= 500) return 'Server error — contact website administrator.';
    if (result.status >= 400) return 'Client error — verify the URL is correct.';
    if (result.error)         return `Network error (${result.error}) — verify URL is reachable.`;
    return 'Unknown issue — manually inspect the URL.';
}

// ── Link Checking Module ──────────────────────────────────────────────────────

/**
 * Crawls the website and checks all discovered links.
 * @returns {Promise<{ issues: Array<object>, linkChecks: number }>}
 */
async function runLinkChecks() {
    console.log(`[link-check] Crawling ${WEBSITE_URL}...`);
    const issues = [];
    let pageText;

    try {
        const res = await fetch(WEBSITE_URL, { timeout: REQUEST_TIMEOUT_MS });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pageText = await res.text();
    } catch (err) {
        console.error(`[link-check] Failed to fetch site: ${err.message}`);
        issues.push({
            severity: 'critical',
            type: 'link',
            file: WEBSITE_URL,
            description: `Cannot fetch website: ${err.message}`,
            expected: 'HTTP 200 response from website',
            actual: err.message,
            recommendation: 'Check site deployment and DNS resolution.',
        });
        return { issues, linkChecks: 0 };
    }

    const dom = new JSDOM(pageText, { url: WEBSITE_URL });
    const anchors = [...dom.window.document.querySelectorAll('a[href]')];
    const allUrls = [...new Set(
        anchors
            .map(a => { try { return new URL(a.href, WEBSITE_URL).href; } catch (_) { return null; } })
            .filter(u => u && (u.startsWith('http://') || u.startsWith('https://')))
    )];

    console.log(`[link-check] Found ${allUrls.length} unique links. Checking...`);
    const tasks = allUrls.map(url => () => checkLinkWithRetry(url));
    const results = await runWithConcurrency(tasks, CONCURRENCY);

    const broken    = results.filter(r => !r.ok);
    const slow      = results.filter(r => r.ok && r.slow);
    const redirected = results.filter(r => r.redirected);

    for (const r of broken) {
        issues.push({
            severity: r.status === 404 ? 'high' : 'medium',
            type: 'link',
            file: r.url,
            description: `Broken link: HTTP ${r.status || r.error || 'TIMEOUT'}`,
            expected: 'HTTP 200 response',
            actual: r.error ? `Network error: ${r.error}` : `HTTP ${r.status}`,
            recommendation: recommendedFix(r),
        });
    }
    for (const r of slow) {
        issues.push({
            severity: 'low',
            type: 'performance',
            file: r.url,
            description: `Slow response: ${r.responseTime}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`,
            expected: `Response time < ${SLOW_THRESHOLD_MS}ms`,
            actual: `${r.responseTime}ms`,
            recommendation: 'Optimize server response time or enable CDN caching.',
        });
    }
    for (const r of redirected) {
        issues.push({
            severity: 'low',
            type: 'link',
            file: r.url,
            description: `Redirect detected → ${r.finalUrl}`,
            expected: 'Direct URL with no redirect',
            actual: `Redirects to ${r.finalUrl}`,
            recommendation: 'Update the link to point directly to the final destination.',
        });
    }

    console.log(`[link-check] Healthy: ${results.length - broken.length}  Broken: ${broken.length}  Slow: ${slow.length}  Redirected: ${redirected.length}`);
    return { issues, linkChecks: results.length };
}

// ── Performance / Dependency Module ──────────────────────────────────────────

/**
 * Checks package.json for obviously outdated or missing dependencies.
 * @returns {Promise<Array<object>>}
 */
async function runPerformanceChecks() {
    console.log('[performance] Running performance & dependency checks...');
    const issues = [];
    const ROOT = path.join(__dirname, '..');
    const pkgPath = path.join(ROOT, 'package.json');

    if (!fs.existsSync(pkgPath)) {
        issues.push({
            severity: 'medium',
            type: 'performance',
            file: 'package.json',
            description: 'package.json not found',
            expected: 'package.json present in repository root',
            actual: 'File not found',
            recommendation: 'Add a package.json to track Node.js dependencies.',
        });
        return issues;
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (_) {
        issues.push({
            severity: 'medium',
            type: 'performance',
            file: 'package.json',
            description: 'package.json cannot be parsed',
            expected: 'Valid JSON',
            actual: 'Parse error',
            recommendation: 'Fix syntax errors in package.json.',
        });
        return issues;
    }

    // Check for pinned versions (no range specifiers) in devDependencies
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const unpinned = Object.entries(allDeps).filter(([, v]) => /^\^|^~/.test(v));
    if (unpinned.length > 0) {
        issues.push({
            severity: 'low',
            type: 'performance',
            file: 'package.json',
            description: `${unpinned.length} dependencies use loose version ranges (^ or ~)`,
            expected: 'Pinned exact versions for reproducible builds',
            actual: unpinned.slice(0, 5).map(([n, v]) => `${n}@${v}`).join(', ') + (unpinned.length > 5 ? '...' : ''),
            recommendation: 'Run npm ci with exact versions or update lockfile to pin dependencies.',
        });
    }

    // Check that nodemailer is available (needed for email reports)
    if (!allDeps.nodemailer) {
        issues.push({
            severity: 'high',
            type: 'performance',
            file: 'package.json',
            description: 'nodemailer dependency is missing from package.json',
            expected: 'nodemailer listed in dependencies or devDependencies',
            actual: 'Not found',
            recommendation: 'Add nodemailer: npm install nodemailer.',
        });
    }

    console.log(`[performance] Found ${issues.length} issue(s).`);
    return issues;
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

async function main() {
    const runStart = Date.now();
    console.log('='.repeat(60));
    console.log('🏘️  Housing Analytics — Daily Audit System');
    console.log(`   Run started: ${new Date().toUTCString()}`);
    console.log(`   Target: ${WEBSITE_URL}`);
    if (SKIP_EMAIL) console.log('   [dry-run] Email will NOT be sent.');
    console.log('='.repeat(60));

    // ── Run all audit modules ──
    const [
        dataIssues,
        logicIssues,
        uiIssues,
        { issues: linkIssues, linkChecks },
        perfIssues,
    ] = await Promise.all([
        runDataIntegrityChecks(),
        runLogicValidationChecks(),
        runUiValidationChecks(),
        runLinkChecks(),
        runPerformanceChecks(),
    ]);

    // Stamp detection time
    const now = new Date().toUTCString();
    const allIssues = [
        ...dataIssues,
        ...logicIssues,
        ...uiIssues,
        ...linkIssues,
        ...perfIssues,
    ].map(issue => ({ ...issue, detectedAt: issue.detectedAt || now }));

    // ── Build summary ──
    const summary = {
        critical: allIssues.filter(i => i.severity === 'critical').length,
        high:     allIssues.filter(i => i.severity === 'high').length,
        medium:   allIssues.filter(i => i.severity === 'medium').length,
        low:      allIssues.filter(i => i.severity === 'low').length,
        total:    allIssues.length,
        linkChecks,
    };

    console.log('\n── Audit Summary ──────────────────────────────────────────');
    console.log(`  🔴 Critical: ${summary.critical}`);
    console.log(`  🟠 High:     ${summary.high}`);
    console.log(`  🟡 Medium:   ${summary.medium}`);
    console.log(`  🟢 Low:      ${summary.low}`);
    console.log(`  📊 Total:    ${summary.total}`);
    console.log(`  🔗 Links:    ${linkChecks}`);
    console.log('──────────────────────────────────────────────────────────');

    // ── Audit history & comparison ──
    const auditResult = { summary, allIssues };
    const priorSnapshot = loadPriorSnapshot();
    const priorDate = priorSnapshot ? priorSnapshot.date : null;
    const comparison = compareWithPrior(allIssues, priorSnapshot);
    const trend = loadTrendData();

    console.log(`\n[history] New: ${comparison.newIssues.length}  Resolved: ${comparison.resolvedIssues.length}  Persistent: ${comparison.persistentIssues.length}`);

    const snapshotFile = saveAuditSnapshot(auditResult);
    console.log(`[history] Snapshot saved: ${snapshotFile}`);

    // ── Save JSON report ──
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonReportPath = path.join(REPORTS_DIR, `audit-${ts}.json`);
    fs.writeFileSync(jsonReportPath, JSON.stringify(
        { date: new Date().toISOString(), summary, comparison: { newIssues: comparison.newIssues.length, resolvedIssues: comparison.resolvedIssues.length, persistentIssues: comparison.persistentIssues.length }, allIssues },
        null, 2
    ));
    console.log(`[report] JSON report saved: ${jsonReportPath}`);

    // ── Build and send email report ──
    const runDurationMs = Date.now() - runStart;
    const htmlBody = buildHtmlReport({ summary, allIssues, comparison, priorDate, trend, runDurationMs });
    const htmlReportPath = path.join(REPORTS_DIR, `audit-${ts}.html`);
    fs.writeFileSync(htmlReportPath, htmlBody);
    console.log(`[report] HTML report saved: ${htmlReportPath}`);

    const subject = summary.critical > 0
        ? `🔴 [CRITICAL] Housing Analytics Audit — ${summary.critical} Critical Issue(s) — ${new Date().toDateString()}`
        : summary.high > 0
            ? `🟠 Housing Analytics Audit — ${summary.high} High Priority Issue(s) — ${new Date().toDateString()}`
            : `🟢 Housing Analytics Audit — All Clear — ${new Date().toDateString()}`;

    if (!SKIP_EMAIL) {
        await sendEmailReport({ htmlBody, subject, recipientEmail: RECIPIENT_EMAIL, emailUser: EMAIL_USER, emailPassword: EMAIL_PASSWORD });
    } else {
        console.log(`[report] Skipping email (credentials not configured). Subject would be: "${subject}"`);
    }

    // ── Slack alert for critical issues ──
    if (summary.critical > 0 && SLACK_WEBHOOK_URL) {
        const slackPayload = buildSlackPayload(summary, allIssues.filter(i => i.severity === 'critical'));
        await sendSlackAlert(slackPayload, SLACK_WEBHOOK_URL);
    } else if (summary.critical > 0) {
        console.warn('[report] Critical issues found but SLACK_WEBHOOK_URL not set — Slack alert skipped.');
    }

    console.log(`\n✅ Audit complete in ${(runDurationMs / 1000).toFixed(1)}s`);

    // Exit with non-zero code if critical issues found (makes CI fail visibly)
    if (summary.critical > 0) {
        console.error(`[audit] Exiting with code 1 — ${summary.critical} critical issue(s) detected.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Unhandled error in daily audit system:', err);
    process.exit(1);
});
