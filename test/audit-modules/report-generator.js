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
    // Low or medium findings only (audit-status.js statusFromFindings).
    warning: { emoji: '🟡', label: 'Warning', bg: '#fff8e1', color: '#7b5e00', border: '#ffe082' },
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

// `critical` on a check means "a crash here fails the job" (audit-status.js),
// not that its findings are severe. Labelled "(critical)" in red, a core
// check with three medium findings read as three critical failures in an
// All Clear email. Severity lives on the findings, not on this tag.
function buildChecksTable(checks) {
    if (!checks || checks.length === 0) return '<p>No audit checks were recorded.</p>';
    // Only what matters: failures and checks that did not run. A long list of
    // passing checks buried the one that failed.
    const shown = checks.filter(check => check.status !== 'passed');
    const passed = checks.length - shown.length;
    const passedNote = `<p style="margin:12px 0 0;color:#155724;">${shown.length === 0 ? `All ${passed} checks passed.` : `${passed} other check(s) passed.`}</p>`;
    if (shown.length === 0) return passedNote;
    return `
    <table style="border-collapse:collapse;width:100%;margin-top:12px;font-size:13px;">
        <tr style="background:#f8f9fa;">
            <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Check</th>
            <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Status</th>
            <th style="padding:10px 14px;text-align:left;border:1px solid #dee2e6;">Notes</th>
        </tr>
        ${shown.map(check => `
        <tr>
            <td style="padding:10px 14px;border:1px solid #dee2e6;">${escHtml(check.name || '')}${check.critical ? ' <span style="color:#555;font-size:12px;">(core check)</span>' : ''}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;">${statusBadge(check.status)}</td>
            <td style="padding:10px 14px;border:1px solid #dee2e6;color:#555;">${escHtml(check.summary || check.details || '')}</td>
        </tr>`).join('')}
    </table>${passedNote}`;
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
            <tr style="background:#fff;">
                <td style="padding:10px 16px;border:1px solid #dee2e6;">🟡 Warning (low/medium findings only)</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;font-weight:bold;color:#7b5e00;">${auditHealth.warnings || 0}</td>
                <td style="padding:10px 16px;border:1px solid #dee2e6;" colspan="2"></td>
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
                <p style="margin:0 0 8px;"><strong>Scheduled workflows never run:</strong> ${countOrUnavailable(actions.neverRun)}</p>
                <p style="margin:0 0 8px;"><strong>Last successful deploy:</strong> ${deployText}</p>
                ${buildLinkedList(
                    (actions.failingRuns || []).concat(actions.overdueWorkflows || []).concat(actions.neverRun || []),
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

const CELL = 'padding:6px 10px;border:1px solid #dee2e6;text-align:left;vertical-align:top;';
const PR_TABLE_LIMIT = 25;

const CI_STYLE = { passing: '#155724', failing: '#721c24', running: '#856404', 'no checks': '#666' };
const CODEX_STYLE = { 'clean on head': '#155724', 'findings open': '#721c24', reviewing: '#856404', 'not reviewed on head': '#666' };

function prLink(pr) {
    const bot = pr.bot ? ` <span style="color:#666;font-size:12px;">(bot: ${escHtml(pr.bot)})</span>` : '';
    const draft = pr.draft ? ' <span style="color:#666;font-size:12px;">(draft)</span>' : '';
    return `<a href="${escHtml(pr.url)}">#${escHtml(pr.number)}</a> ${escHtml(pr.title)}${bot}${draft}`;
}

function moreRows(total, shown, cols) {
    return total > shown ? `<tr><td colspan="${cols}" style="${CELL}color:#666;">…and ${total - shown} more.</td></tr>` : '';
}

/**
 * Merged-in-24h and open-PR tables. PRs merge on their own once CI and the
 * Codex review are clean, so this is where the owner sees them go by.
 */
function buildPrProgressCard(progress) {
    if (!progress) return unavailableCard('Pull Request Progress');
    const merged = progress.merged || [];
    const open = progress.open || [];
    const mergedRows = merged.slice(0, PR_TABLE_LIMIT).map(pr => `
                <tr><td style="${CELL}">${prLink(pr)}</td><td style="${CELL}">${escHtml(pr.mergedAt)}</td><td style="${CELL}">${escHtml(pr.mergedBy || 'unknown')}</td></tr>`).join('');
    const openRows = open.slice(0, PR_TABLE_LIMIT).map(pr => `
                <tr><td style="${CELL}">${prLink(pr)}</td><td style="${CELL}">${escHtml(pr.age)}</td><td style="${CELL}color:${CI_STYLE[pr.ci] || '#666'};">${escHtml(pr.ci)}</td><td style="${CELL}color:${CODEX_STYLE[pr.codex] || '#666'};">${escHtml(pr.codex)}</td></tr>`).join('');
    return `
        <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:16px;margin-top:16px;">
            <h3 style="margin-top:0;">Pull Request Progress</h3>
            <p style="margin:0 0 6px;"><strong>Merged in the last 24h:</strong> ${merged.length}${progress.mergedComplete === false ? '+ (list cut off)' : ''}</p>
            ${merged.length === 0 ? '<p style="margin:0 0 12px;color:#555;">No PRs merged in the last 24h.</p>' : `
            <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:12px;">
                <tr style="background:#f8f9fa;"><th style="${CELL}">PR</th><th style="${CELL}">Merged (UTC)</th><th style="${CELL}">Merged by</th></tr>${mergedRows}${moreRows(merged.length, PR_TABLE_LIMIT, 3)}
            </table>`}
            <p style="margin:0 0 6px;"><strong>Open:</strong> ${countOrUnavailable(progress.openCount)}${progress.openComplete === false ? ' (list cut off)' : ''}</p>
            ${open.length === 0 ? '<p style="margin:0;color:#555;">No open PRs.</p>' : `
            <table style="border-collapse:collapse;width:100%;font-size:13px;">
                <tr style="background:#f8f9fa;"><th style="${CELL}">PR</th><th style="${CELL}">Age</th><th style="${CELL}">CI on head</th><th style="${CELL}">Codex review</th></tr>${openRows}${moreRows(open.length, PR_TABLE_LIMIT, 4)}
            </table>`}
        </div>`;
}

const CARD_OPEN = '<div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:16px;">';
const MUTED = 'margin:8px 0 0;color:#555;';

function issueItem(issue) {
    return `<li style="margin-bottom:6px;"><a href="${escHtml(issue.url)}">#${escHtml(issue.number)}</a> ${escHtml(issue.title)}</li>`;
}

/** Member Site Deploy: a distance only when a public build stamp gave one. */
function buildMemberSiteCard(site) {
    if (!site) return unavailableCard('Member Site Deploy');
    const line = site.known
        ? `<strong>main is ${escHtml(site.aheadBy)} commit(s) ahead</strong> of the member site (built from <code>${escHtml(site.revision.slice(0, 7))}</code>${site.builtAt ? ` at ${escHtml(site.builtAt)}` : ''}).`
        : '<strong>Unknown.</strong>';
    return `
            ${CARD_OPEN}
                <h3 style="margin-top:0;">Member Site Deploy</h3>
                <p style="margin:0;">${line}</p>
                ${site.reason ? `<p style="${MUTED}">${escHtml(site.reason)}</p>` : ''}
            </div>`;
}

function buildDataWorkflowsCard(data) {
    if (!data) return unavailableCard('Scheduled Data Workflows');
    return `
            ${CARD_OPEN}
                <h3 style="margin-top:0;">Scheduled Data Workflows</h3>
                <p style="margin:0;"><strong>Last scheduled run (24h) failed or never started:</strong> ${countOrUnavailable(data.problems)}${data.complete === false ? ' (run list cut off)' : ''}</p>
                ${buildLinkedList(data.problems, run => `<li style="margin-bottom:6px;"><a href="${escHtml(run.url || '')}">${escHtml(run.name)}</a> — ${escHtml(run.outcome)}</li>`, 'Every data workflow that ran on schedule in the last 24h finished.', 8)}
            </div>`;
}

function buildReviewFollowupsCard(followups) {
    if (!followups) return unavailableCard('Review Follow-ups');
    return `
            ${CARD_OPEN}
                <h3 style="margin-top:0;">Review Follow-ups</h3>
                <p style="margin:0;"><strong>Open from Codex reviews:</strong> ${countOrUnavailable(followups.codex)}</p>
                ${buildLinkedList(followups.codex, issueItem, 'None open.', 5)}
                <p style="margin:12px 0 0;"><strong>Bot watch issues with no assignee:</strong> ${countOrUnavailable(followups.unassignedWatch)}</p>
                ${buildLinkedList(followups.unassignedWatch, issueItem, 'None unassigned.', 5)}
            </div>`;
}

function buildDeadlinesCard(deadlines) {
    if (!deadlines) return unavailableCard('Upcoming Deadlines');
    return `
            ${CARD_OPEN}
                <h3 style="margin-top:0;">Upcoming Deadlines (${escHtml(deadlines.windowDays)} days)</h3>
                ${buildLinkedList(deadlines.upcoming, item => `<li style="margin-bottom:6px;"><strong>${escHtml(item.date)}</strong> (${item.daysAway === 0 ? 'today' : `in ${escHtml(item.daysAway)}d`}) — <a href="${escHtml(item.source)}">${escHtml(item.title)}</a>${item.status ? ` <span style="color:#666;font-size:12px;">(${escHtml(item.status)})</span>` : ''}</li>`, 'Nothing due in the next 14 days.', 8)}
                <p style="${MUTED}font-size:12px;">From data/deadlines.json.</p>
            </div>`;
}

function buildAccuracyCard(accuracy) {
    if (!accuracy) return unavailableCard('Source & Figure Accuracy');
    const url = accuracy.urlHealth;
    const sweep = accuracy.sweep;
    const overdue = accuracy.overdue;
    const overdueTotal = Array.isArray(overdue) ? overdue.reduce((n, row) => n + (row.overdue || 0), 0) : null;
    return `
            ${CARD_OPEN}
                <h3 style="margin-top:0;">Source &amp; Figure Accuracy</h3>
                <p style="margin:0 0 6px;"><strong>Broken source links:</strong> ${url ? `${escHtml(url.broken)} (${escHtml(url.newlyBroken.length)} new) as of the ${escHtml(String(url.lastSweepAt || 'unknown').slice(0, 10))} URL sweep` : UNAVAILABLE}</p>
                <p style="margin:0 0 6px;"><strong>Source URL Sweep (last run):</strong> ${sweep ? `${sweep.url ? `<a href="${escHtml(sweep.url)}">${escHtml(sweep.conclusion)}</a>` : escHtml(sweep.conclusion)}${sweep.at ? ` ${escHtml(String(sweep.at).slice(0, 10))}` : ''}` : UNAVAILABLE}</p>
                <p style="margin:0 0 6px;"><strong>Figures past review date:</strong> ${overdueTotal === null ? UNAVAILABLE : escHtml(overdueTotal)}</p>
                ${Array.isArray(overdue) && overdue.length > 0 ? `<ul style="margin:0 0 6px 18px;padding:0;">${overdue.map(row => `<li>${escHtml(row.title)}: ${row.overdue === null ? 'unreadable' : escHtml(row.overdue)}</li>`).join('')}</ul>` : ''}
                <p style="margin:6px 0 0;"><strong>Open accuracy issues:</strong> ${countOrUnavailable(accuracy.issues)}</p>
                ${Array.isArray(accuracy.issues) ? buildLinkedList(accuracy.issues, issueItem, 'None open.', 5) : ''}
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

function workGroup(title, cards) {
    return `
    <h2 style="margin:24px 0 12px;">${title}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:8px;">${cards}
    </div>`;
}

/**
 * The work the owner acts on, in his order: what needs him, PRs, deploy,
 * deadlines. Check results follow at the end of the email.
 */
function buildWorkSections(repoHealth) {
    if (!repoHealth) return '';
    return [
        workGroup('🙋 Needs You', buildReviewFollowupsCard(repoHealth.reviewFollowups) +
            buildDataWorkflowsCard(repoHealth.dataWorkflows) +
            buildAccuracyCard(repoHealth.accuracy)),
        `<h2 style="margin:24px 0 0;">🔀 Pull Requests</h2>${buildPrProgressCard(repoHealth.prProgress)}`,
        workGroup('🚀 Deploy', buildMemberSiteCard(repoHealth.memberSite)),
        workGroup('📅 Deadlines', buildDeadlinesCard(repoHealth.deadlines)),
    ].join('');
}

const count = list => (Array.isArray(list) ? list.length : null);
const orUnknown = value => (value === null || value === undefined ? 'unavailable' : String(value));

/**
 * The 3–5 line summary the email opens with: one line per work group, then
 * one for findings and checks. Each count that could not be read says so.
 */
function buildSummaryLines({ summary, auditHealth, repoHealth }) {
    const rh = repoHealth || {};
    const lines = [];
    if (repoHealth) {
        const f = rh.reviewFollowups;
        const overdue = rh.accuracy && Array.isArray(rh.accuracy.overdue)
            ? rh.accuracy.overdue.reduce((n, row) => n + (row.overdue || 0), 0) : null;
        lines.push(`<strong>Needs you:</strong> ${orUnknown(f && count(f.codex))} Codex follow-up(s), ${orUnknown(f && count(f.unassignedWatch))} unassigned watch issue(s), ${orUnknown(rh.dataWorkflows && count(rh.dataWorkflows.problems))} data workflow(s) failed, ${orUnknown(overdue)} figure(s) past review.`);
        const pr = rh.prProgress;
        if (pr) {
            const failing = (pr.open || []).filter(row => row.ci === 'failing').length;
            const findings = (pr.open || []).filter(row => row.codex === 'findings open').length;
            lines.push(`<strong>PRs:</strong> ${pr.merged.length} merged in 24h, ${orUnknown(pr.openCount)} open (${failing} failing CI, ${findings} with Codex findings).`);
        } else {
            lines.push('<strong>PRs:</strong> unavailable.');
        }
        const site = rh.memberSite;
        const deploy = rh.actions && rh.actions.lastSuccessfulDeploy;
        const memberText = !site ? 'unavailable' : site.known ? `main is ${site.aheadBy} commit(s) ahead` : 'unknown';
        lines.push(`<strong>Deploy:</strong> member site ${escHtml(memberText)}; public site last deployed ${deploy ? escHtml(String(deploy.run_started_at || deploy.created_at || 'unknown').slice(0, 16).replace('T', ' ')) : rh.actions ? 'never (no success found)' : 'unavailable'}.`);
        const d = rh.deadlines;
        const next = d && d.upcoming && d.upcoming[0];
        lines.push(`<strong>Deadlines:</strong> ${!d ? 'unavailable' : next ? `${escHtml(next.date)} ${escHtml(next.title)}${d.upcoming.length > 1 ? ` (+${d.upcoming.length - 1} more in ${d.windowDays} days)` : ''}` : `none in the next ${d.windowDays} days`}.`);
    }
    const h = auditHealth || {};
    const notRun = (h.unavailable || 0) + (h.skipped || 0);
    lines.push(`<strong>Findings:</strong> ${summary.critical} critical, ${summary.high} high, ${summary.medium} medium, ${summary.low} low${auditHealth ? `; checks ${h.failed || 0} failed, ${h.warnings || 0} warning, ${notRun} did not run, ${h.passed || 0} passed` : ''}.`);
    return `
    <ul style="margin:0 0 24px 18px;padding:0;line-height:1.6;">${lines.map(line => `<li>${line}</li>`).join('')}</ul>`;
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
    <h2>Findings by Severity</h2>
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
    ${buildSummaryLines({ summary, auditHealth, repoHealth })}
    ${buildWorkSections(repoHealth)}
    <!-- Check results: summarized at the end, failures and changes first. -->
    <h2 style="margin-top:36px;border-top:2px solid #dee2e6;padding-top:20px;">Check Results</h2>
    ${buildAuditHealthSection(auditHealth)}
    ${buildComparisonSection(comparison, priorDate)}
    ${summaryTable}
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
