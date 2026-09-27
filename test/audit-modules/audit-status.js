'use strict';

/**
 * One place that decides what the daily audit's run amounts to. The email
 * subject, the HTML banner and the process exit code all read from here, so
 * they cannot disagree — before this, the subject said "DEPLOY BLOCKED" for a
 * crashed link check and the banner could say healthy while checks were
 * unavailable.
 */

/**
 * Tallies check results. `criticalFailures` counts critical checks that
 * produced a critical-severity finding — not every critical check with any
 * finding, which would turn one low-severity broken link into a failed job.
 */
function summarizeChecks(checks, workflowRunUrl = '') {
    const list = checks || [];
    const count = status => list.filter(check => check.status === status).length;
    return {
        checks: list,
        totalChecks: list.length,
        passed: count('passed'),
        failed: count('failed'),
        skipped: count('skipped'),
        unavailable: count('unavailable'),
        criticalFailures: list.filter(check =>
            check.critical && check.status === 'failed' &&
            (check.issues || []).some(issue => issue.severity === 'critical')).length,
        criticalUnavailable: list.filter(check => check.critical && check.status === 'unavailable').length,
        internalErrors: list
            .filter(check => check.status === 'unavailable')
            .map(check => `${check.name}: ${check.details || check.error || 'Unavailable'}`),
        workflowRunUrl,
    };
}

/** Deploy is blocked only when the Actions data was actually read and says so. */
function isDeployBlocked(repoHealth) {
    const actions = repoHealth && repoHealth.actions;
    if (!actions) return false;
    if (typeof actions.deployBlocked === 'boolean') return actions.deployBlocked;
    return !actions.lastSuccessfulDeploy || (actions.recentDeployFailures || []).length > 0;
}

/**
 * The run's overall status, in precedence order. Returns { key, count }.
 * Missing auditHealth / repoHealth degrade to the pre-repo-health behaviour.
 */
function overallStatus({ summary, auditHealth, repoHealth }) {
    const s = summary || {};
    const health = auditHealth || {};
    if (isDeployBlocked(repoHealth)) return { key: 'deploy-blocked', count: 0 };
    if (s.critical > 0) return { key: 'critical', count: s.critical };
    if (health.criticalUnavailable > 0) return { key: 'audit-incomplete', count: health.criticalUnavailable };
    const highPriority = repoHealth && repoHealth.issueInventory
        ? (repoHealth.issueInventory.highPriority || []).length
        : 0;
    if (highPriority > 0) return { key: 'high-priority-issues', count: highPriority };
    if (s.high > 0) return { key: 'high', count: s.high };
    const notRun = (health.unavailable || 0) + (health.skipped || 0);
    if (notRun > 0) return { key: 'checks-not-run', count: notRun };
    if (s.total > 0) return { key: 'minor', count: s.total };
    return { key: 'healthy', count: 0 };
}

/**
 * Should the workflow step exit non-zero? A critical finding (the pre-PR rule)
 * or a critical local check that crashed — the audit silently not running is
 * exactly what removing continue-on-error is meant to surface. Repository-
 * health checks are never critical, so a GitHub API outage does not qualify.
 */
function auditExitCode(summary, auditHealth) {
    const critical = (summary && summary.critical) || 0;
    const crashed = (auditHealth && auditHealth.criticalUnavailable) || 0;
    return critical > 0 || crashed > 0 ? 1 : 0;
}

module.exports = {
    auditExitCode,
    isDeployBlocked,
    overallStatus,
    summarizeChecks,
};
