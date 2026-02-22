'use strict';

const nodemailer = require('nodemailer');
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const WEBSITE_URL = process.env.WEBSITE_URL || 'https://example.com';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'communityplanner@gmail.com';
const REPORTS_DIR = path.join(process.cwd(), 'monitoring-reports');

function getRecommendedFix(status, url) {
    if (status === 404) return 'Page not found. Update or remove this link from your site.';
    if (status === 503) return 'Service unavailable. Check if the server is running and retry later.';
    if (status === 500) return 'Internal server error. Contact the site owner or check server logs.';
    if (status === 301 || status === 302) return 'Redirect detected. Update the link to point to the final destination URL.';
    if (status === 403) return 'Access forbidden. Verify the URL is publicly accessible.';
    if (typeof status === 'string' && status.includes('ENOTFOUND')) return 'Domain not found. Verify the URL is correct and the domain exists.';
    if (typeof status === 'string') return `Network error (${status}). Check connectivity and verify the URL is reachable.`;
    return `Unexpected status ${status}. Investigate the link and update as needed.`;
}

function buildHtmlReport(results, websiteUrl) {
    const broken = results.filter(r => r.broken);
    const healthy = results.filter(r => !r.broken);
    const total = results.length;
    const healthPercent = total > 0 ? Math.round((healthy.length / total) * 100) : 100;
    const allGood = broken.length === 0;

    const statusBanner = allGood
        ? '<div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:16px;margin-bottom:20px;font-size:20px;font-weight:bold;color:#155724;">✅ Everything is Fine — All links are healthy!</div>'
        : `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin-bottom:20px;font-size:20px;font-weight:bold;color:#856404;">⚠️ Issues Found — ${broken.length} broken link(s) detected</div>`;

    const summaryTable = `
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr style="background:#f8f9fa;">
                <td style="padding:12px;border:1px solid #dee2e6;font-weight:bold;">Total Links Checked</td>
                <td style="padding:12px;border:1px solid #dee2e6;">${total}</td>
            </tr>
            <tr>
                <td style="padding:12px;border:1px solid #dee2e6;font-weight:bold;">Healthy Links</td>
                <td style="padding:12px;border:1px solid #dee2e6;color:#155724;">✅ ${healthy.length}</td>
            </tr>
            <tr style="background:#f8f9fa;">
                <td style="padding:12px;border:1px solid #dee2e6;font-weight:bold;">Broken Links</td>
                <td style="padding:12px;border:1px solid #dee2e6;color:${broken.length > 0 ? '#721c24' : '#155724'};">${broken.length > 0 ? '❌' : '✅'} ${broken.length}</td>
            </tr>
            <tr>
                <td style="padding:12px;border:1px solid #dee2e6;font-weight:bold;">Health Score</td>
                <td style="padding:12px;border:1px solid #dee2e6;font-weight:bold;color:${healthPercent >= 90 ? '#155724' : healthPercent >= 70 ? '#856404' : '#721c24'};">${healthPercent}%</td>
            </tr>
        </table>`;

    let brokenSection = '';
    if (broken.length > 0) {
        const rows = broken.map(r => `
            <tr>
                <td style="padding:10px;border:1px solid #dee2e6;word-break:break-all;">${r.url}</td>
                <td style="padding:10px;border:1px solid #dee2e6;color:#721c24;font-weight:bold;">${r.status}</td>
                <td style="padding:10px;border:1px solid #dee2e6;">${getRecommendedFix(r.status, r.url)}</td>
            </tr>`).join('');

        const actionItems = broken.map((r, i) =>
            `<li style="margin-bottom:8px;">Fix link #${i + 1}: <code>${r.url}</code> — ${getRecommendedFix(r.status, r.url)}</li>`
        ).join('');

        brokenSection = `
            <h2 style="color:#721c24;">Broken Links Details</h2>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
                <thead>
                    <tr style="background:#f8d7da;">
                        <th style="padding:10px;border:1px solid #dee2e6;text-align:left;">URL</th>
                        <th style="padding:10px;border:1px solid #dee2e6;text-align:left;">Status</th>
                        <th style="padding:10px;border:1px solid #dee2e6;text-align:left;">Recommended Fix</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <h2 style="color:#856404;">Action Items</h2>
            <ul style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 32px;margin-bottom:24px;">${actionItems}</ul>`;
    }

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Website Monitoring Report</title></head>
<body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#212529;">
    <h1 style="color:#343a40;border-bottom:2px solid #dee2e6;padding-bottom:12px;">
        🔍 Website Monitoring Report
    </h1>
    <p style="color:#6c757d;">Site: <strong>${websiteUrl}</strong> &nbsp;|&nbsp; Generated: <strong>${new Date().toISOString()}</strong></p>
    ${statusBanner}
    <h2 style="color:#343a40;">Summary</h2>
    ${summaryTable}
    ${brokenSection}
    <hr style="border:none;border-top:1px solid #dee2e6;margin-top:32px;">
    <p style="color:#adb5bd;font-size:12px;">Automated report generated by Housing Analytics Website Monitor</p>
</body>
</html>`;
}

async function checkLink(url) {
    try {
        const res = await fetch(url, { redirect: 'follow', timeout: 15000 });
        return { url, status: res.status, broken: !res.ok };
    } catch (err) {
        const status = err.code || err.message || 'UNKNOWN_ERROR';
        return { url, status, broken: true };
    }
}

async function collectLinks(websiteUrl) {
    const res = await fetch(websiteUrl, { timeout: 20000 });
    const html = await res.text();
    const dom = new JSDOM(html, { url: websiteUrl });
    const anchors = [...dom.window.document.querySelectorAll('a[href]')];
    const seen = new Set();
    const links = [];
    for (const a of anchors) {
        const href = a.href;
        if (href && href.startsWith('http') && !seen.has(href)) {
            seen.add(href);
            links.push(href);
        }
    }
    return links;
}

async function runMonitor() {
    console.log(`Starting website monitor for: ${WEBSITE_URL}`);

    if (!EMAIL_USER || !EMAIL_PASSWORD) {
        console.warn('Warning: EMAIL_USER or EMAIL_PASSWORD not set. Email will not be sent.');
    }

    let links;
    try {
        links = await collectLinks(WEBSITE_URL);
        console.log(`Found ${links.length} links to check`);
    } catch (err) {
        console.error('Failed to fetch website:', err.message);
        process.exit(1);
    }

    const results = await Promise.all(links.map(checkLink));
    const broken = results.filter(r => r.broken);

    console.log(`Checked ${results.length} links — ${broken.length} broken`);

    // Save JSON report
    try {
        if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
        const reportFile = path.join(REPORTS_DIR, `report-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify({ url: WEBSITE_URL, timestamp: new Date().toISOString(), results }, null, 2));
        console.log(`JSON report saved to ${reportFile}`);
    } catch (err) {
        console.warn('Could not save JSON report:', err.message);
    }

    if (!EMAIL_USER || !EMAIL_PASSWORD) {
        console.log('Skipping email (no credentials). Done.');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD }
    });

    const brokenCount = broken.length;
    const subject = brokenCount === 0
        ? `✅ Website Monitor: Everything is Fine — ${WEBSITE_URL}`
        : `⚠️ Website Monitor: ${brokenCount} Issue(s) Found — ${WEBSITE_URL}`;

    const htmlReport = buildHtmlReport(results, WEBSITE_URL);

    await transporter.sendMail({
        from: EMAIL_USER,
        to: RECIPIENT_EMAIL,
        subject,
        html: htmlReport
    });

    console.log(`Report email sent to ${RECIPIENT_EMAIL}`);
}

runMonitor().catch(err => {
    console.error('Monitor error:', err);
    process.exit(1);
});