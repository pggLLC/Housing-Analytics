'use strict';

/**
 * Audit History & Comparison Module
 *
 * Maintains a running audit log with issue history, resolution status, and
 * trend tracking. Compares each report to the prior day's audit and highlights
 * new issues, resolved issues, and persistent unresolved issues.
 */

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', '..', 'monitoring-reports', 'audit-history');
const MAX_HISTORY_FILES = 90; // Keep up to 90 days of history

/**
 * Ensures the audit history directory exists.
 */
function ensureHistoryDir() {
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
}

/**
 * Returns the file path for today's audit snapshot.
 * @param {string} [dateStr] - ISO date string (YYYY-MM-DD); defaults to today
 * @returns {string}
 */
function snapshotPath(dateStr) {
    const date = dateStr || new Date().toISOString().slice(0, 10);
    return path.join(HISTORY_DIR, `audit-${date}.json`);
}

/**
 * Creates a stable fingerprint for an issue to enable cross-audit deduplication.
 * Uses file + type + description (first 80 chars) as the key.
 * @param {object} issue
 * @returns {string}
 */
function issueFingerprint(issue) {
    const desc = (issue.description || '').slice(0, 80).replace(/\s+/g, ' ').trim();
    return `${issue.file}||${issue.type}||${desc}`;
}

/**
 * Saves today's audit snapshot to the history directory.
 * Prunes old snapshots beyond MAX_HISTORY_FILES.
 * @param {object} auditResult - Full audit result object
 * @returns {string} path of the saved snapshot
 */
function saveAuditSnapshot(auditResult) {
    ensureHistoryDir();
    const today = new Date().toISOString().slice(0, 10);
    const filePath = snapshotPath(today);
    const snapshot = {
        date: today,
        timestamp: new Date().toISOString(),
        summary: auditResult.summary,
        issues: auditResult.allIssues,
    };
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
    pruneOldSnapshots();
    return filePath;
}

/**
 * Removes oldest audit snapshots when more than MAX_HISTORY_FILES exist.
 */
function pruneOldSnapshots() {
    try {
        const files = fs.readdirSync(HISTORY_DIR)
            .filter(f => f.startsWith('audit-') && f.endsWith('.json'))
            .sort(); // ascending chronological order
        if (files.length > MAX_HISTORY_FILES) {
            const toRemove = files.slice(0, files.length - MAX_HISTORY_FILES);
            for (const f of toRemove) {
                fs.unlinkSync(path.join(HISTORY_DIR, f));
            }
        }
    } catch (_) {
        // Non-fatal — pruning failure shouldn't block the audit
    }
}

/**
 * Loads the most recent previous audit snapshot (not today's).
 * @returns {object|null} prior snapshot or null if not found
 */
function loadPriorSnapshot() {
    ensureHistoryDir();
    const today = new Date().toISOString().slice(0, 10);
    try {
        const files = fs.readdirSync(HISTORY_DIR)
            .filter(f => f.startsWith('audit-') && f.endsWith('.json') && !f.includes(today))
            .sort()
            .reverse(); // most recent first
        if (files.length === 0) return null;
        return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, files[0]), 'utf8'));
    } catch (_) {
        return null;
    }
}

/**
 * Compares current audit issues with the prior snapshot and categorises them.
 * @param {Array<object>} currentIssues
 * @param {object|null} priorSnapshot
 * @returns {{ newIssues: Array, resolvedIssues: Array, persistentIssues: Array }}
 */
function compareWithPrior(currentIssues, priorSnapshot) {
    if (!priorSnapshot) {
        return {
            newIssues: currentIssues,
            resolvedIssues: [],
            persistentIssues: [],
        };
    }

    const priorIssues = priorSnapshot.issues || [];
    const priorSet = new Set(priorIssues.map(issueFingerprint));
    const currentSet = new Set(currentIssues.map(issueFingerprint));

    const newIssues = currentIssues.filter(i => !priorSet.has(issueFingerprint(i)));
    const persistentIssues = currentIssues.filter(i => priorSet.has(issueFingerprint(i)));
    const resolvedIssues = priorIssues.filter(i => !currentSet.has(issueFingerprint(i)));

    return { newIssues, resolvedIssues, persistentIssues };
}

/**
 * Loads audit trend data — count of issues per severity over time.
 * @returns {Array<object>} Array of { date, critical, high, medium, low }
 */
function loadTrendData() {
    ensureHistoryDir();
    const trend = [];
    try {
        const files = fs.readdirSync(HISTORY_DIR)
            .filter(f => f.startsWith('audit-') && f.endsWith('.json'))
            .sort();
        for (const file of files) {
            try {
                const snap = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'));
                trend.push({
                    date: snap.date,
                    critical: (snap.summary && snap.summary.critical) || 0,
                    high: (snap.summary && snap.summary.high) || 0,
                    medium: (snap.summary && snap.summary.medium) || 0,
                    low: (snap.summary && snap.summary.low) || 0,
                    total: (snap.summary && snap.summary.total) || 0,
                });
            } catch (_) {
                // Skip corrupted files
            }
        }
    } catch (_) {
        // Return empty trend on error
    }
    return trend;
}

module.exports = {
    saveAuditSnapshot,
    loadPriorSnapshot,
    compareWithPrior,
    loadTrendData,
    issueFingerprint,
};
