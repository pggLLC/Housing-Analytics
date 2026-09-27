'use strict';

/**
 * Report Generator Module
 *
 * Builds the structured HTML audit report with severity-coded sections and
 * sends it via email. For Critical issues, also fires a Slack alert.
 */

const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const { overallStatus } = require('./audit-status');

// Severity display config
const SEVERITY_CONFIG = {
    critical: { emoji: '🔴', label: 'Critical (Fix Immediately)',       bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' },
    high:     { emoji: '🟠', label: 'High Priority (Fix Within 48 hrs)', bg: '#fff3cd', color: '#856404', border: '#ffeeba' },
    medium:   { emoji: '🟡', label: 'Medium Priority (Fix This Sprint)',  bg: '#fff8e1', color: '#7b5e00', border: '#ffe082' },
    low:      { emoji: '🟢', label: 'Low Priority / Improvements',        bg: '#d4edda', color: '#155724', border: '#c3e6cb' },
};

const CHECK_STATUS_CONFIG = {
    passed: { emoji: '✅', label: 'Passed', bg: '#d4edda', color: '#155724', border: '#c3e6cb' },
    failed: { emoji: '❌', label: 'Failed', bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' },
    skipped: { emoji: '⏭️', label: 'Skipped', bg: '#eef2f7', color: '#495057', border: '#ced4da' },
    unavailable: { emoji: '⚠️', label: 'Unavailable', bg: '#fff3cd', color: '#856404', border: '#ffeeba' },
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

function statusBadge(status) {
    const cfg = CHECK_STATUS_CONFIG[status] || CHECK_STATUS_CONFIG.unavailable;
    return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border};font-size:12px;font-weight:bold;">${cfg.emoji} ${cfg.label}</span>`;
}

function buildChecksTable(checks) {
    if (!checks || checks.length === 0) return '<p>No audit checks were recorded.</p>';
    return `
    <table style="border-collapse:collapse;width:100%;margin-top:12px;font-size:13px;">
        <tr style="background:#f8f9fa;">
            <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Check</th>
            <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Status</th>
            <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Notes</th>
        </tr>
        ${checks.map(check => `
        <tr>
            <td style="padding:10px 14px;border:1px solid #dee2e6;">${escHtml(check.name || '')}${check.critical ? ' <span style="color:#721c24;font-size:12px;">(critical)</span>' : ''}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;">${statusBadge(check.status)}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;color:#555;">${escHtml(check.summary || check.details || '')}</td>
        </tr>`).join('')}
    </table>`;
}

function buildLinkedList(items, renderer, emptyText, limit = 6) {
    if (!items || items.length === 0) return `<p style="margin:8px 0 0;color:#155724;">${escHtml(emptyText)}</p>`;
    const visible = items.slice(0, limit);
    const more = items.length - visible.length;
    return `<ul style="margin:8px 0 0 18px;padding:0;">${visible.map(renderer).join('')}</ul>` +
        (more > 0 ? `<p style="margin:8px 0 0;color:#666;">…and ${more} more.</p>` : '');
}

function buildAuditHealthSection(auditHealth) {
    if (!auditHealth) return '';
    const warnings = auditHealth.internalErrors || [];
    return `
    <div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:20px;margin-bottom:28px;">
        <h2 style="margin-top:0;">🩺 Audit Health</h2>
        <table style="border-collapse:collapse;width:100%;margin-bottom:12px;">
            <tr style="background:#fff;">
                <td style="padding:10px 16px;border:1px solid #dee2e6;">Checks Run</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;">${auditHealth.totalChecks || 0}</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;">✅ Passed</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#155724;">${auditHealth.passed || 0}</td>
            </tr>
            <tr style="background:#fff;">
                <td style="padding:10px 16px;border:1px solid #dee2e6;">❌ Failed</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#721c24;">${auditHealth.failed || 0}</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;">⏭️ Skipped / ⚠️ Unavailable</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#856404;">${(auditHealth.skipped || 0) + (auditHealth.unavailable || 0)}</td>
            </tr>
        </table>
        ${warnings.length > 0 ? `<p style="margin:0 0 8px;color:#856404;"><strong>Warnings:</strong> ${escHtml(warnings.join(' | '))}</p>` : ''}
        ${auditHealth.workflowRunUrl ? `<p style="margin:0 0 12px;"><a href="${escHtml(auditHealth.workflowRunUrl)}">View this workflow run</a></p>` : ''}
        ${buildChecksTable(auditHealth.checks)}
    </div>`;
}

const UNAVAILABLE = '<span style="color:#856404;">unavailable</span>';

/** A count, or "unavailable" — a count we could not take is never shown as 0. */
function countOrUnavailable(value) {
    if (Array.isArray(value)) return String(value.length);
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : UNAVAILABLE;
}

function unavailableCard(title) {
    return `
            <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:16px;">
                <h3 style="margin-top:0;">${escHtml(title)}</h3>
                <p style="margin:0;color:#856404;">⚠️ Unavailable — the GitHub API could not be read for this section, so nothing here was checked.</p>
            </div>`;
}

function buildActionsCard(actions) {
    if (!actions) return unavailableCard('GitHub Actions Health');
    const deployText = actions.lastSuccessfulDeploy
        ? `${escHtml(actions.lastSuccessfulDeploy.run_started_at || actions.lastSuccessfulDeploy.created_at || 'unknown')} · <a href="${escHtml(actions.lastSuccessfulDeploy.html_url || '')}">view run</a>`
        : 'No successful deploy found';
    return `
            <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:16px;">
                <h3 style="margin-top:0;">GitHub Actions Health</h3>
                <p style="margin:0 0 8px;"><strong>Main workflows whose latest run failed (24h):</strong> ${countOrUnavailable(actions.failingRuns)}</p>
                <p style="margin:0 0 8px;"><strong>Overdue scheduled workflows:</strong> ${countOrUnavailable(actions.overdueWorkflows)}</p>
                <p style="margin:0 0 8px;"><strong>Last successful deploy:</strong> ${deployText}</p>
                ${buildLinkedList(
                    (actions.failingRuns || []).concat(actions.overdueWorkflows || []),
                    item => `<li style="margin-bottom:6px;"><a href="${escHtml(item.html_url || '')}">${escHtml(item.name || item.path || 'Workflow')}</a>${item.lastRunAt ? ` — last run ${escHtml(item.lastRunAt)}` : ''}</li>`,
                    Array.isArray(actions.failingRuns) ? 'No failing or overdue workflows.' : 'No overdue workflows; the failing-run list was incomplete.'
                )}
            </div>`;
}

function buildPullsCard(pulls) {
    if (!pulls) return unavailableCard('Pull Request Triage');
    return `
            <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:16px;">
                <h3 style="margin-top:0;">Pull Request Triage</h3>
                <p style="margin:0 0 8px;"><strong>Open PRs:</strong> ${countOrUnavailable(pulls.openCount)}</p>
                <p style="margin:0 0 8px;"><strong>Failing checks:</strong> ${countOrUnavailable(pulls.failingChecks)} · <strong>Stale reviews:</strong> ${countOrUnavailable(pulls.staleReviews)}</p>
                <p style="margin:0 0 8px;"><strong>Conflicts:</strong> ${countOrUnavailable(pulls.conflicts)} · <strong>Inactive &gt;7d:</strong> ${countOrUnavailable(pulls.inactive)}</p>
                ${buildLinkedList(
                    []
                        .concat(pulls.failingChecks || [])
                        .concat(pulls.staleReviews || [])
                        .concat(pulls.conflicts || [])
                        .concat(pulls.inactive || []),
                    pr => `<li style="margin-bottom:6px;"><a href="${escHtml(pr.html_url || pr.url || '')}">PR #${escHtml(pr.number)} — ${escHtml(pr.title || '')}</a></li>`,
                    'No PRs need triage.'
                )}
            </div>`;
}

function buildIssuesCard(issues) {
    if (!issues) return unavailableCard('Issues Inventory');
    return `
            <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:16px;">
                <h3 style="margin-top:0;">Issues Inventory</h3>
                <p style="margin:0 0 8px;"><strong>Open:</strong> ${countOrUnavailable(issues.openCount)} · <strong>New (24h):</strong> ${countOrUnavailable(issues.newlyOpenedCount)} · <strong>Closed (24h):</strong> ${countOrUnavailable(issues.closedCount)}</p>
                <p style="margin:0 0 8px;"><strong>High-priority:</strong> ${countOrUnavailable(issues.highPriority)} · <strong>Blockers:</strong> ${countOrUnavailable(issues.blockers)} · <strong>Inactive &gt;30d:</strong> ${countOrUnavailable(issues.longstanding)}</p>
                ${buildLinkedList(
                    []
                        .concat(issues.highPriority || [])
                        .concat(issues.blockers || [])
                        .concat(issues.longstanding || []),
                    issue => `<li style="margin-bottom:6px;"><a href="${escHtml(issue.html_url || '')}">Issue #${escHtml(issue.number)} — ${escHtml(issue.title || '')}</a></li>`,
                    'No issue backlog hotspots detected.'
                )}
            </div>`;
}

function buildRepositoryHealthSection(repoHealth) {
    if (!repoHealth) return '';
    return `
    <div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:20px;margin-bottom:28px;">
        <h2 style="margin-top:0;">🔍 Repository Health Summary</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;">
            ${buildActionsCard(repoHealth.actions)}
            ${buildPullsCard(repoHealth.pullRequests)}
            ${buildIssuesCard(repoHealth.issueInventory)}
        </div>
    </div>`;
}

const BANNER_STYLE = {
    red:    'background:#f8d7da;color:#721c24;',
    orange: 'background:#fff3cd;color:#856404;',
    yellow: 'background:#fff8e1;color:#7b5e00;',
    green:  'background:#d4edda;color:#155724;',
};

function banner(tone, text) {
    return `<div style="${BANNER_STYLE[tone]}padding:16px 24px;border-radius:8px;font-size:22px;font-weight:bold;margin-bottom:24px;">${text}</div>`;
}

function buildOverallStatus(summary, auditHealth, repoHealth) {
    const status = overallStatus({ summary, auditHealth, repoHealth });
    switch (status.key) {
        case 'deploy-blocked':       return banner('red', '🔴 Deploy Blocked');
        case 'critical':             return banner('red', '🔴 Critical Issues Detected');
        case 'audit-incomplete':     return banner('red', `🔴 Audit Incomplete — ${status.count} Critical Check(s) Unavailable`);
        case 'high-priority-issues': return banner('yellow', `🟡 ${status.count} High-Priority Issue(s)`);
        case 'high':                 return banner('orange', '🟠 High Priority Issues Found');
        case 'checks-not-run':       return banner('orange', `🟠 ${status.count} Check(s) Did Not Run`);
        case 'minor':                return banner('yellow', '🟡 Minor Issues Detected');
        default:                     return banner('green', '🟢 All Systems Healthy');
    }
}

function buildEmailSubject({ summary, auditHealth, repoHealth, reportDate = new Date() }) {
    const stamp = reportDate.toDateString();
    const status = overallStatus({ summary, auditHealth, repoHealth });
    switch (status.key) {
        case 'deploy-blocked':
            return `🔴 DEPLOY BLOCKED — Housing Analytics Audit — ${stamp}`;
        case 'critical':
            return `🔴 [CRITICAL] Housing Analytics Audit — ${status.count} Critical Issue(s) — ${stamp}`;
        case 'audit-incomplete':
            return `🔴 AUDIT INCOMPLETE — Housing Analytics Audit — ${status.count} Critical Check(s) Unavailable — ${stamp}`;
        case 'high-priority-issues':
            return `🟡 ${status.count} HIGH-PRIORITY ISSUES — Housing Analytics Audit — ${stamp}`;
        case 'high':
            return `🟠 Housing Analytics Audit — ${status.count} High Priority Issue(s) — ${stamp}`;
        case 'checks-not-run':
            return `🟠 Housing Analytics Audit — ${status.count} Check(s) Did Not Run — ${stamp}`;
        default:
            // 'minor' keeps its pre-repo-health subject: medium/low findings
            // alone have always read as All Clear in the subject line.
            return `🟢 Housing Analytics Audit — All Clear — ${stamp}`;
    }
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
function buildHtmlReport({ summary, allIssues, comparison, priorDate, trend, runDurationMs, auditHealth, repoHealth }) {
    const { critical, high, medium, low, total } = summary;
    const runSeconds = runDurationMs ? (runDurationMs / 1000).toFixed(1) : 'N/A';
    const overallStatus = buildOverallStatus(summary, auditHealth, repoHealth);

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
    ${buildAuditHealthSection(auditHealth)}
    ${buildComparisonSection(comparison, priorDate)}
    ${trendSection}
    ${buildRepositoryHealthSection(repoHealth)}
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
    buildEmailSubject,
    buildSlackPayload,
    sendEmailReport,
    sendSlackAlert,
};
