'use strict';

const nodemailer = require('nodemailer');
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const config = require('./website-monitor-config');
const { withRetry, runWithConcurrency, ResultCache, computeStats, shouldIgnore } = require('./website-monitor-utils');

const WEBSITE_URL = config.websiteUrl;
const RECIPIENT_EMAIL = config.recipientEmail;
const EMAIL_USER = config.emailUser;
const EMAIL_PASSWORD = config.emailPassword;

if (!WEBSITE_URL) {
    console.error('ERROR: WEBSITE_URL environment variable is required.');
    process.exit(1);
}
if (!RECIPIENT_EMAIL) {
    console.error('ERROR: RECIPIENT_EMAIL environment variable is required.');
    process.exit(1);
}
if (!EMAIL_USER || !EMAIL_PASSWORD) {
    if (!config.dryRun) {
        console.error('ERROR: EMAIL_USER and EMAIL_PASSWORD environment variables are required.');
        process.exit(1);
    }
}

const reportsDir = path.join(__dirname, '..', 'monitoring-reports');
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
}

const cache = config.cacheEnabled ? new ResultCache(config.cacheTtlMs) : null;

async function checkLink(url) {
    if (cache) {
        const cached = cache.get(url);
        if (cached) {
            if (config.debugMode) console.debug(`[cache] hit for ${url}`);
            return cached;
        }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeout);
    const startTime = Date.now();
    let result;
    try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
        const responseTime = Date.now() - startTime;
        const redirected = res.redirected || false;
        const finalUrl = res.url || url;
        result = {
            url,
            status: res.status,
            ok: res.ok,
            responseTime,
            redirected,
            finalUrl: redirected ? finalUrl : null,
            slow: responseTime > config.slowLinkThresholdMs,
        };
    } catch (err) {
        const responseTime = Date.now() - startTime;
        result = {
            url,
            status: null,
            ok: false,
            responseTime,
            redirected: false,
            finalUrl: null,
            slow: false,
            error: err.message,
        };
    } finally {
        clearTimeout(timer);
    }

    if (cache) cache.set(url, result);
    return result;
}

async function checkLinkWithRetry(url) {
    return withRetry(() => checkLink(url));
}

function recommendedFix(result) {
    if (result.status === 404) return 'Page not found — update or remove this link.';
    if (result.status === 403) return 'Access forbidden — check server permissions or authentication.';
    if (result.status === 503) return 'Service unavailable — the server may be down; retry later or contact the host.';
    if (result.status >= 500) return 'Server error — contact the website administrator.';
    if (result.status >= 400) return 'Client error — verify the URL is correct.';
    if (result.error) return `Network error (${result.error}) — verify the URL is reachable.`;
    return 'Unknown issue — manually inspect the URL.';
}

function buildHtmlReport(websiteUrl, results, runDurationMs) {
    const total = results.length;
    const healthy = results.filter(r => r.ok).length;
    const broken = total - healthy;
    const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 100;
    const allFine = broken === 0;

    const responseTimes = results.filter(r => r.responseTime !== undefined).map(r => r.responseTime);
    const stats = computeStats(responseTimes);
    const slowLinks = results.filter(r => r.ok && r.slow);
    const redirectedLinks = results.filter(r => r.redirected);
    const runSeconds = runDurationMs !== undefined ? (runDurationMs / 1000).toFixed(1) : 'N/A';

    const statusBanner = allFine
        ? '<div style="background:#d4edda;color:#155724;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">✅ Everything is Fine</div>'
        : `<div style="background:#fff3cd;color:#856404;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">⚠️ Issues Found (${broken} broken link${broken !== 1 ? 's' : ''})</div>`;

    const summaryTable = `
        <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
            <tr style="background:#f8f9fa;">
                <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Metric</th>
                <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Value</th>
            </tr>
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Total Links Checked</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${total}</td></tr>
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">✅ Healthy Links</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${healthy}</td></tr>
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">❌ Broken Links</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${broken}</td></tr>
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">⏱️ Slow Links (&gt;${config.slowLinkThresholdMs}ms)</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${slowLinks.length}</td></tr>
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Health Score</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${healthPct}%</td></tr>
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Response Time (min/avg/max)</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${stats.min}ms / ${stats.avg}ms / ${stats.max}ms</td></tr>
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Monitoring Run Duration</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${runSeconds}s</td></tr>
        </table>`;

    let issuesSection = '';
    const brokenResults = results.filter(r => !r.ok);
    if (brokenResults.length > 0) {
        const rows = brokenResults.map(r => `
            <tr>
                <td style="padding:10px 16px;border:1px solid #dee2e6;word-break:break-all;">${r.url}</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;">${r.status || r.error || 'N/A'}</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;">${recommendedFix(r)}</td>
            </tr>`).join('');
        const actionItems = brokenResults.map(r => `<li>${r.url} — ${recommendedFix(r)}</li>`).join('');
        issuesSection = `
            <h2 style="color:#856404;">Broken Links</h2>
            <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
                <tr style="background:#f8f9fa;">
                    <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">URL</th>
                    <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Status / Error</th>
                    <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Recommended Fix</th>
                </tr>
                ${rows}
            </table>
            <h2 style="color:#856404;">Action Items</h2>
            <ul>${actionItems}</ul>`;
    }

    let slowSection = '';
    if (slowLinks.length > 0) {
        const rows = slowLinks.map(r => `
            <tr>
                <td style="padding:10px 16px;border:1px solid #dee2e6;word-break:break-all;">${r.url}</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;">${r.responseTime}ms</td>
            </tr>`).join('');
        slowSection = `
            <h2 style="color:#856404;">⏱️ Slow Links (&gt;${config.slowLinkThresholdMs}ms)</h2>
            <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
                <tr style="background:#f8f9fa;">
                    <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">URL</th>
                    <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Response Time</th>
                </tr>
                ${rows}
            </table>`;
    }

    let redirectSection = '';
    if (redirectedLinks.length > 0) {
        const rows = redirectedLinks.map(r => `
            <tr>
                <td style="padding:10px 16px;border:1px solid #dee2e6;word-break:break-all;">${r.url}</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;word-break:break-all;">${r.finalUrl}</td>
            </tr>`).join('');
        redirectSection = `
            <h2 style="color:#0c5460;">🔀 Redirected Links</h2>
            <p style="color:#0c5460;">Consider updating these links to their final destination to avoid redirect chains.</p>
            <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
                <tr style="background:#f8f9fa;">
                    <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Original URL</th>
                    <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Final URL</th>
                </tr>
                ${rows}
            </table>`;
    }

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Website Monitoring Report</title></head>
<body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#333;">
    <h1 style="border-bottom:2px solid #dee2e6;padding-bottom:12px;">Website Monitoring Report</h1>
    <p><strong>Website:</strong> ${websiteUrl}</p>
    <p><strong>Date:</strong> ${new Date().toUTCString()}</p>
    ${statusBanner}
    <h2>Summary</h2>
    ${summaryTable}
    ${issuesSection}
    ${slowSection}
    ${redirectSection}
</body>
</html>`;
}

async function main() {
    const runStart = Date.now();
    console.log(`Scanning links on: ${WEBSITE_URL}`);
    if (config.dryRun) console.log('[dry-run] Email will NOT be sent.');
    if (config.debugMode) console.debug(`[config] timeout=${config.requestTimeout}ms retries=${config.maxRetries} concurrency=${config.concurrency}`);

    let pageText;
    try {
        const res = await fetch(WEBSITE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${WEBSITE_URL}`);
        pageText = await res.text();
    } catch (err) {
        console.error('Failed to fetch website:', err.message);
        process.exit(1);
    }

    const dom = new JSDOM(pageText, { url: WEBSITE_URL });
    const anchors = [...dom.window.document.querySelectorAll('a[href]')];
    const allUrls = [...new Set(
        anchors
            .map(a => {
                try { return new URL(a.href, WEBSITE_URL).href; } catch (_) { return null; }
            })
            .filter(u => u && (u.startsWith('http://') || u.startsWith('https://')))
    )];

    const urls = allUrls.filter(u => !shouldIgnore(u));
    const ignoredCount = allUrls.length - urls.length;
    if (ignoredCount > 0) console.log(`Ignored ${ignoredCount} link(s) matching filter patterns.`);

    console.log(`Found ${urls.length} unique links. Checking with concurrency=${config.concurrency}...`);

    let checked = 0;
    const tasks = urls.map(url => async () => {
        const result = await checkLinkWithRetry(url);
        checked++;
        if (config.debugMode || checked % 10 === 0 || checked === urls.length) {
            console.log(`  [${checked}/${urls.length}] ${result.ok ? '✅' : '❌'} ${url} (${result.responseTime}ms)`);
        }
        return result;
    });

    const results = await runWithConcurrency(tasks, config.concurrency);
    const runDurationMs = Date.now() - runStart;

    const broken = results.filter(r => !r.ok);
    const slow = results.filter(r => r.ok && r.slow);
    console.log(`Healthy: ${results.length - broken.length}  Broken: ${broken.length}  Slow: ${slow.length}  Duration: ${(runDurationMs / 1000).toFixed(1)}s`);

    // Save JSON report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportsDir, `report-${timestamp}.json`);
    fs.writeFileSync(reportFile, JSON.stringify({ website: WEBSITE_URL, date: new Date().toISOString(), runDurationMs, results }, null, 2));
    console.log(`JSON report saved to ${reportFile}`);

    if (config.dryRun) {
        console.log('[dry-run] Skipping email send.');
        return;
    }

    // Send email report
    const htmlBody = buildHtmlReport(WEBSITE_URL, results, runDurationMs);
    const subject = broken.length === 0
        ? `✅ Website Monitor: Everything is Fine — ${WEBSITE_URL}`
        : `⚠️ Website Monitor: ${broken.length} Issue(s) Found — ${WEBSITE_URL}`;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD }
    });

    try {
        await transporter.sendMail({
            from: EMAIL_USER,
            to: RECIPIENT_EMAIL,
            subject,
            html: htmlBody
        });
        console.log(`Email report sent to ${RECIPIENT_EMAIL}`);
    } catch (emailErr) {
        console.warn(`Warning: Failed to send email report: ${emailErr.message}`);
    }
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
