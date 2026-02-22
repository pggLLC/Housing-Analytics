'use strict';

const nodemailer = require('nodemailer');

const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;

if (!RECIPIENT_EMAIL || !EMAIL_USER || !EMAIL_PASSWORD) {
    console.error('ERROR: RECIPIENT_EMAIL, EMAIL_USER, and EMAIL_PASSWORD environment variables are all required.');
    console.error('Set them in your .env file (for local testing) or in GitHub Secrets (for CI).');
    process.exit(1);
}

function buildSuccessEmail() {
    return {
        subject: '✅ Website Monitor: Everything is Fine — https://example.com',
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Website Monitoring Report</title></head>
<body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#333;">
    <h1 style="border-bottom:2px solid #dee2e6;padding-bottom:12px;">Website Monitoring Report</h1>
    <p><strong>Website:</strong> https://example.com</p>
    <p><strong>Date:</strong> ${new Date().toUTCString()}</p>
    <div style="background:#d4edda;color:#155724;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">✅ Everything is Fine</div>
    <h2>Summary</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
        <tr style="background:#f8f9fa;">
            <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Metric</th>
            <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Value</th>
        </tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Total Links Checked</td><td style="padding:10px 16px;border:1px solid #dee2e6;">45</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">✅ Healthy Links</td><td style="padding:10px 16px;border:1px solid #dee2e6;">45</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">❌ Broken Links</td><td style="padding:10px 16px;border:1px solid #dee2e6;">0</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Health Score</td><td style="padding:10px 16px;border:1px solid #dee2e6;">100%</td></tr>
    </table>
    <p style="color:#155724;">All 45 links are working correctly. No action required.</p>
</body>
</html>`
    };
}

function buildIssuesEmail() {
    const brokenLinks = [
        { url: 'https://example.com/old-page', status: 404, fix: 'Page not found — update or remove this link.' },
        { url: 'https://example.com/api/data', status: 503, fix: 'Service unavailable — the server may be down; retry later or contact the host.' },
        { url: 'https://broken.example.com/resource', status: null, error: 'ENOTFOUND', fix: 'Network error (ENOTFOUND) — verify the URL is reachable.' }
    ];

    const rows = brokenLinks.map(r => `
        <tr>
            <td style="padding:10px 16px;border:1px solid #dee2e6;word-break:break-all;">${r.url}</td>
            <td style="padding:10px 16px;border:1px solid #dee2e6;">${r.status || r.error || 'N/A'}</td>
            <td style="padding:10px 16px;border:1px solid #dee2e6;">${r.fix}</td>
        </tr>`).join('');

    const actionItems = brokenLinks.map(r => `<li>${r.url} — ${r.fix}</li>`).join('');

    return {
        subject: '⚠️ Website Monitor: 3 Issue(s) Found — https://example.com',
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Website Monitoring Report</title></head>
<body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#333;">
    <h1 style="border-bottom:2px solid #dee2e6;padding-bottom:12px;">Website Monitoring Report</h1>
    <p><strong>Website:</strong> https://example.com</p>
    <p><strong>Date:</strong> ${new Date().toUTCString()}</p>
    <div style="background:#fff3cd;color:#856404;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">⚠️ Issues Found (3 broken links)</div>
    <h2>Summary</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
        <tr style="background:#f8f9fa;">
            <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Metric</th>
            <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Value</th>
        </tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Total Links Checked</td><td style="padding:10px 16px;border:1px solid #dee2e6;">45</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">✅ Healthy Links</td><td style="padding:10px 16px;border:1px solid #dee2e6;">42</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">❌ Broken Links</td><td style="padding:10px 16px;border:1px solid #dee2e6;">3</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Health Score</td><td style="padding:10px 16px;border:1px solid #dee2e6;">93%</td></tr>
    </table>
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
    <ul>${actionItems}</ul>
</body>
</html>`
    };
}

async function main() {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD }
    });

    console.log(`Sending test emails to ${RECIPIENT_EMAIL}...`);

    const emails = [buildSuccessEmail(), buildIssuesEmail()];
    for (const email of emails) {
        await transporter.sendMail({
            from: EMAIL_USER,
            to: RECIPIENT_EMAIL,
            subject: email.subject,
            html: email.html
        });
        console.log(`Sent: ${email.subject}`);
    }

    console.log('Both test emails sent successfully.');
}

main().catch(err => {
    console.error('Error sending test emails:', err.message);
    process.exit(1);
});
