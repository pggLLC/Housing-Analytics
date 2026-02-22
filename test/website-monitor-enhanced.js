'use strict';

const nodemailer = require('nodemailer');
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const WEBSITE_URL = process.env.WEBSITE_URL;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;

if (!WEBSITE_URL) {
    console.error('ERROR: WEBSITE_URL environment variable is required.');
    process.exit(1);
}
if (!RECIPIENT_EMAIL) {
    console.error('ERROR: RECIPIENT_EMAIL environment variable is required.');
    process.exit(1);
}
if (!EMAIL_USER || !EMAIL_PASSWORD) {
    console.error('ERROR: EMAIL_USER and EMAIL_PASSWORD environment variables are required.');
    process.exit(1);
}

const reportsDir = path.join(__dirname, '..', 'monitoring-reports');
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
}

async function checkLink(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
        return { url, status: res.status, ok: res.ok };
    } catch (err) {
        return { url, status: null, ok: false, error: err.message };
    } finally {
        clearTimeout(timer);
    }
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

function buildHtmlReport(websiteUrl, results) {
    const total = results.length;
    const healthy = results.filter(r => r.ok).length;
    const broken = total - healthy;
    const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 100;
    const allFine = broken === 0;

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
            <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Health Score</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${healthPct}%</td></tr>
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
</body>
</html>`;
}

async function main() {
    console.log(`Scanning links on: ${WEBSITE_URL}`);

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
    const urls = [...new Set(
        anchors
            .map(a => {
                try { return new URL(a.href, WEBSITE_URL).href; } catch (_) { return null; }
            })
            .filter(u => u && (u.startsWith('http://') || u.startsWith('https://')))
    )];

    console.log(`Found ${urls.length} unique links. Checking each one...`);
    const results = await Promise.all(urls.map(checkLink));

    const broken = results.filter(r => !r.ok);
    console.log(`Healthy: ${results.length - broken.length}  Broken: ${broken.length}`);

    // Save JSON report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportsDir, `report-${timestamp}.json`);
    fs.writeFileSync(reportFile, JSON.stringify({ website: WEBSITE_URL, date: new Date().toISOString(), results }, null, 2));
    console.log(`JSON report saved to ${reportFile}`);

    // Send email report
    const htmlBody = buildHtmlReport(WEBSITE_URL, results);
    const subject = broken.length === 0
        ? `✅ Website Monitor: Everything is Fine — ${WEBSITE_URL}`
        : `⚠️ Website Monitor: ${broken.length} Issue(s) Found — ${WEBSITE_URL}`;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD }
    });

    await transporter.sendMail({
        from: EMAIL_USER,
        to: RECIPIENT_EMAIL,
        subject,
        html: htmlBody
    });

    console.log(`Email report sent to ${RECIPIENT_EMAIL}`);
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});