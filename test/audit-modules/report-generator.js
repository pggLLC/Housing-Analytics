'use strict';

/**
 * Report Generator Module
 *
 * Builds the structured HTML audit report with severity-coded sections and
 * sends it via email. For Critical issues, also fires a Slack alert.
 */

const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

// Severity display config
const SEVERITY_CONFIG = {
    critical: { emoji: '🔴', label: 'Critical (Fix Immediately)',       bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' },
    high:     { emoji: '🟠', label: 'High Priority (Fix Within 48 hrs)', bg: '#fff3cd', color: '#856404', border: '#ffeeba' },
    medium:   { emoji: '🟡', label: 'Medium Priority (Fix This Sprint)',  bg: '#fff8e1', color: '#7b5e00', border: '#ffe082' },
    low:      { emoji: '🟢', label: 'Low Priority / Improvements',        bg: '#d4edda', color: '#155724', border: '#c3e6cb' },
};

/**
 * Builds a comparison section for the HTML report.
 * @param {{ newIssues, resolvedIssues, persistentIssues }} comparison
 * @param {string} priorDate
 * @returns {string} HTML
 */
function buildComparisonSection(comparison, priorDate) {
    const { newIssues, resolvedIssues, persistentIssues } = comparison;
    const label = priorDate ? `compared to ${priorDate}` : '(first run — no prior data)';

    return `
    <div style="background:#f0f4ff;border:1px solid #c8d3f5;border-radius:8px;padding:20px;margin-bottom:28px;">
        <h2 style="margin-top:0;color:#1a237e;">📊 Change Summary ${label}</h2>
        <table style="border-collapse:collapse;width:100%;">
            <tr>
                <td style="padding:10px 16px;border:1px solid #c8d3f5;background:#e8eaf6;">🆕 New Issues</td>
                <td style="padding:10px 16px;border:1px solid #c8d3f5;font-weight:bold;color:${newIssues.length > 0 ? '#c62828' : '#2e7d32'};">${newIssues.length}</td>
            </tr>
            <tr>
                <td style="padding:10px 16px;border:1px solid #c8d3f5;background:#e8eaf6;">✅ Resolved Issues</td>
                <td style="padding:10px 16px;border:1px solid #c8d3f5;font-weight:bold;color:#2e7d32;">${resolvedIssues.length}</td>
            </tr>
            <tr>
                <td style="padding:10px 16px;border:1px solid #c8d3f5;background:#e8eaf6;">🔁 Persistent Issues</td>
                <td style="padding:10px 16px;border:1px solid #c8d3f5;font-weight:bold;color:${persistentIssues.length > 0 ? '#e65100' : '#2e7d32'};">${persistentIssues.length}</td>
            </tr>
        </table>
    </div>`;
}

/**
 * Builds one severity section of the report.
 * @param {string} severity
 * @param {Array<object>} issues
 * @returns {string} HTML
 */
function buildSeveritySection(severity, issues) {
    if (issues.length === 0) return '';
    const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.low;

    const rows = issues.map(issue => `
        <tr>
            <td style="padding:10px 14px;border:1px solid #dee2e6;word-break:break-all;font-size:13px;">${escHtml(issue.file || '')}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;font-size:13px;">${escHtml(issue.type || '')}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;font-size:13px;">${escHtml(issue.description || '')}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;font-size:13px;color:#555;">${escHtml(issue.expected || '')}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;font-size:13px;color:#c62828;">${escHtml(issue.actual || '')}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;font-size:13px;">${escHtml(issue.recommendation || '')}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;font-size:12px;color:#888;">${escHtml(issue.detectedAt || new Date().toUTCString())}</td>
        </tr>`).join('');

    return `
    <div style="margin-bottom:32px;">
        <h2 style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border};padding:14px 20px;border-radius:8px;margin-bottom:16px;">
            ${cfg.emoji} ${cfg.label} (${issues.length})
        </h2>
        <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <tr style="background:#f8f9fa;">
                <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">File / Component</th>
                <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Type</th>
                <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Description</th>
                <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Expected</th>
                <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Actual</th>
                <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Recommended Fix</th>
                <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">First Detected</th>
            </tr>
            ${rows}
        </table>
        </div>
    </div>`;
}

/**
 * Escapes HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Builds the full HTML email body for the audit report.
 * @param {object} params
 * @param {object} params.summary - { critical, high, medium, low, total, linkChecks }
 * @param {Array<object>} params.allIssues
 * @param {object} params.comparison - { newIssues, resolvedIssues, persistentIssues }
 * @param {string|null} params.priorDate
 * @param {Array<object>} params.trend
 * @param {number} params.runDurationMs
 * @returns {string} HTML
 */
function buildHtmlReport({ summary, allIssues, comparison, priorDate, trend, runDurationMs }) {
    const { critical, high, medium, low, total } = summary;
    const runSeconds = runDurationMs ? (runDurationMs / 1000).toFixed(1) : 'N/A';

    const overallStatus = critical > 0
        ? '<div style="background:#f8d7da;color:#721c24;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">🔴 Critical Issues Detected</div>'
        : high > 0
            ? '<div style="background:#fff3cd;color:#856404;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">🟠 High Priority Issues Found</div>'
            : total === 0
                ? '<div style="background:#d4edda;color:#155724;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">🟢 All Systems Healthy</div>'
                : '<div style="background:#fff8e1;color:#7b5e00;padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">🟡 Minor Issues Detected</div>';

    const summaryTable = `
    <h2>Executive Summary</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
        <tr style="background:#f8f9fa;">
            <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Category</th>
            <th style="padding:10px 16px;text-align:left;border:1px solid #dee2e6;">Count</th>
        </tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">🔴 Critical</td><td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#721c24;">${critical}</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">🟠 High</td><td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#856404;">${high}</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">🟡 Medium</td><td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#7b5e00;">${medium}</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">🟢 Low</td><td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#155724;">${low}</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;">Total Issues</td><td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;">${total}</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Links Checked</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${summary.linkChecks || 'N/A'}</td></tr>
        <tr><td style="padding:10px 16px;border:1px solid #dee2e6;">Audit Run Duration</td><td style="padding:10px 16px;border:1px solid #dee2e6;">${runSeconds}s</td></tr>
    </table>`;

    const trendSection = trend && trend.length > 1 ? `
    <h2>📈 7-Day Trend</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;font-size:13px;">
        <tr style="background:#f8f9fa;">
            <th style="padding:8px 12px;border:1px solid #dee2e6;">Date</th>
            <th style="padding:8px 12px;border:1px solid #dee2e6;">🔴</th>
            <th style="padding:8px 12px;border:1px solid #dee2e6;">🟠</th>
            <th style="padding:8px 12px;border:1px solid #dee2e6;">🟡</th>
            <th style="padding:8px 12px;border:1px solid #dee2e6;">🟢</th>
            <th style="padding:8px 12px;border:1px solid #dee2e6;">Total</th>
        </tr>
        ${trend.slice(-7).map(t => `
        <tr>
            <td style="padding:8px 12px;border:1px solid #dee2e6;">${escHtml(t.date)}</td>
            <td style="padding:8px 12px;border:1px solid #dee2e6;color:#721c24;">${t.critical}</td>
            <td style="padding:8px 12px;border:1px solid #dee2e6;color:#856404;">${t.high}</td>
            <td style="padding:8px 12px;border:1px solid #dee2e6;color:#7b5e00;">${t.medium}</td>
            <td style="padding:8px 12px;border:1px solid #dee2e6;color:#155724;">${t.low}</td>
            <td style="padding:8px 12px;border:1px solid #dee2e6;font-weight:bold;">${t.total}</td>
        </tr>`).join('')}
    </table>` : '';

    const severitySections = ['critical', 'high', 'medium', 'low']
        .map(sev => buildSeveritySection(sev, allIssues.filter(i => i.severity === sev)))
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Daily Audit Report — Housing Analytics</title></head>
<body style="font-family:Arial,sans-serif;max-width:1100px;margin:0 auto;padding:28px;color:#333;background:#fff;">
    <h1 style="border-bottom:3px solid #096e65;padding-bottom:14px;color:#096e65;">
        🏘️ Housing Analytics — Daily Audit Report
    </h1>
    <p><strong>Date:</strong> ${new Date().toUTCString()}</p>
    ${overallStatus}
    ${summaryTable}
    ${buildComparisonSection(comparison, priorDate)}
    ${trendSection}
    <h2>📋 Detailed Findings</h2>
    ${total === 0 ? '<p style="color:#155724;background:#d4edda;padding:16px;border-radius:8px;">No issues found. All checks passed. ✅</p>' : severitySections}
    <hr style="border:none;border-top:1px solid #dee2e6;margin:32px 0;">
    <p style="color:#888;font-size:12px;">Generated by Housing Analytics Daily Audit System — pggLLC/Housing-Analytics</p>
</body>
</html>`;
}

/**
 * Builds a plain-text Slack message for critical alerts.
 * @param {object} summary - { critical, high, medium, low, total }
 * @param {Array<object>} criticalIssues
 * @returns {object} Slack payload
 */
function buildSlackPayload(summary, criticalIssues) {
    const lines = [
        `🔴 *Housing Analytics — CRITICAL AUDIT ALERT*`,
        `Date: ${new Date().toUTCString()}`,
        `Critical: ${summary.critical}  High: ${summary.high}  Medium: ${summary.medium}  Low: ${summary.low}`,
        '',
        '*Critical Issues:*',
        ...criticalIssues.slice(0, 10).map(i => `• [${i.type}] ${i.file}: ${i.description}`),
        criticalIssues.length > 10 ? `...and ${criticalIssues.length - 10} more` : '',
    ].filter(l => l !== undefined);

    return { text: lines.join('\n') };
}

/**
 * Sends the HTML audit report via email.
 * Falls back to dry-run (logs to console) if credentials are missing.
 * @param {object} params
 * @param {string} params.htmlBody
 * @param {string} params.subject
 * @param {string} params.recipientEmail
 * @param {string} params.emailUser
 * @param {string} params.emailPassword
 * @returns {Promise<void>}
 */
async function sendEmailReport({ htmlBody, subject, recipientEmail, emailUser, emailPassword }) {
    if (!recipientEmail || !emailUser || !emailPassword) {
        console.warn('[report-generator] Email credentials not set — skipping email send (dry-run).');
        return;
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: emailUser, pass: emailPassword },
    });
    try {
        await transporter.sendMail({
            from: emailUser,
            to: recipientEmail,
            subject,
            html: htmlBody,
        });
        console.log(`[report-generator] Email report sent to ${recipientEmail}`);
    } catch (err) {
        console.warn(`[report-generator] Failed to send email: ${err.message}`);
    }
}

/**
 * Sends a Slack alert for critical issues.
 * @param {object} payload - Slack message payload
 * @param {string} webhookUrl
 * @returns {Promise<void>}
 */
async function sendSlackAlert(payload, webhookUrl) {
    if (!webhookUrl) {
        console.warn('[report-generator] SLACK_WEBHOOK_URL not set — skipping Slack alert.');
        return;
    }
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (res.ok) {
            console.log('[report-generator] Slack alert sent.');
        } else {
            console.warn(`[report-generator] Slack returned HTTP ${res.status}`);
        }
    } catch (err) {
        console.warn(`[report-generator] Failed to send Slack alert: ${err.message}`);
    }
}

module.exports = {
    buildHtmlReport,
    buildSlackPayload,
    sendEmailReport,
    sendSlackAlert,
};
