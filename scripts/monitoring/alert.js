/**
 * alert.js — Housing Analytics Monitoring Alert Utility
 * ======================================================
 * Creates GitHub Issues and (optionally) posts Slack messages when
 * data workflows detect empty datasets or critical failures.
 *
 * Usage (CLI):
 *   node scripts/monitoring/alert.js \
 *     --title "fetch-fred-data: empty dataset" \
 *     --body  "No FRED series were fetched." \
 *     --label critical \
 *     --workflow fetch-fred-data.yml \
 *     --run-id  12345
 *
 * Environment variables:
 *   GITHUB_TOKEN      — required for GitHub Issue creation
 *   GITHUB_REPOSITORY — "owner/repo" (set automatically in Actions)
 *   SLACK_WEBHOOK_URL — optional; enables Slack notifications
 *
 * Exported API (for use in other scripts):
 *   createGitHubIssue({ title, body, labels })
 *   postSlackAlert({ text, blocks })
 *   alertOnEmptyDataset({ workflow, runId, dataFile, recordCount, details })
 */

'use strict';

const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpsPost(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// GitHub Issue creation
// ---------------------------------------------------------------------------

async function createGitHubIssue({ title, body, labels = [] }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[alert] GITHUB_TOKEN not set — skipping GitHub Issue creation');
    return null;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.warn('[alert] GITHUB_REPOSITORY not set — skipping GitHub Issue creation');
    return null;
  }

  const url = `https://api.github.com/repos/${repo}/issues`;
  const payload = { title, body, labels };
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'housing-analytics-monitor/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    const issue = await httpsPost(url, payload, headers);
    console.log(`[alert] Created GitHub Issue #${issue.number}: ${issue.html_url}`);
    return issue;
  } catch (err) {
    console.error(`[alert] Failed to create GitHub Issue: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slack alert
// ---------------------------------------------------------------------------

async function postSlackAlert({ text, blocks }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return null; // Slack is optional
  }
  const payload = { text, ...(blocks ? { blocks } : {}) };
  try {
    await httpsPost(webhookUrl, payload, {});
    console.log('[alert] Slack notification sent');
    return true;
  } catch (err) {
    console.error(`[alert] Failed to post Slack alert: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// High-level: alert on empty / failed dataset
// ---------------------------------------------------------------------------

async function alertOnEmptyDataset({ workflow, runId, dataFile, recordCount, details }) {
  const repo = process.env.GITHUB_REPOSITORY || 'unknown/repo';
  const runUrl = runId
    ? `https://github.com/${repo}/actions/runs/${runId}`
    : `https://github.com/${repo}/actions`;

  const timestamp = new Date().toISOString();
  const title = `⚠️ Empty dataset detected: ${workflow}`;
  const body = [
    `## ⚠️ Empty Dataset Alert`,
    ``,
    `**Workflow:** \`${workflow}\``,
    `**Time:** ${timestamp}`,
    `**Data file:** \`${dataFile || 'unknown'}\``,
    `**Record count:** ${recordCount != null ? recordCount : 'N/A'}`,
    ``,
    `### Details`,
    details || '_No additional details provided._',
    ``,
    `### Diagnostics`,
    `- [View workflow run logs](${runUrl})`,
    `- Run locally: \`python3 scripts/monitoring/data-quality-check.py\``,
    ``,
    `---`,
    `_This issue was created automatically by the Housing Analytics monitoring system._`,
  ].join('\n');

  const labels = ['monitoring', 'data-quality', 'critical'];
  await createGitHubIssue({ title, body, labels });

  // Slack
  const slackText =
    `⚠️ *Empty dataset detected* in \`${workflow}\`\n` +
    `File: \`${dataFile || 'unknown'}\`  |  Records: ${recordCount != null ? recordCount : 'N/A'}\n` +
    `<${runUrl}|View run logs>`;
  await postSlackAlert({ text: slackText });
}

// ---------------------------------------------------------------------------
// Generic workflow failure alert
// ---------------------------------------------------------------------------

async function alertOnWorkflowFailure({ workflow, runId, step, error, details }) {
  const repo = process.env.GITHUB_REPOSITORY || 'unknown/repo';
  const runUrl = runId
    ? `https://github.com/${repo}/actions/runs/${runId}`
    : `https://github.com/${repo}/actions`;

  const timestamp = new Date().toISOString();
  const title = `❌ Workflow failure: ${workflow}${step ? ` (${step})` : ''}`;
  const body = [
    `## ❌ Workflow Failure Alert`,
    ``,
    `**Workflow:** \`${workflow}\``,
    `**Step:** ${step || '_unknown_'}`,
    `**Time:** ${timestamp}`,
    `**Error:** ${error || '_no error message_'}`,
    ``,
    `### Details`,
    details || '_No additional details provided._',
    ``,
    `### Diagnostics`,
    `- [View workflow run logs](${runUrl})`,
    `- Run data quality check: \`python3 scripts/monitoring/data-quality-check.py\``,
    ``,
    `---`,
    `_This issue was created automatically by the Housing Analytics monitoring system._`,
  ].join('\n');

  const labels = ['monitoring', 'workflow-failure', 'critical'];
  await createGitHubIssue({ title, body, labels });

  const slackText =
    `❌ *Workflow failure* in \`${workflow}\`` +
    (step ? ` at step \`${step}\`` : '') +
    `\n${error || ''}\n<${runUrl}|View run logs>`;
  await postSlackAlert({ text: slackText });
}

// ---------------------------------------------------------------------------
// CLI interface
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const mode = get('--mode') || 'empty-dataset';
  const workflow = get('--workflow') || 'unknown-workflow';
  const runId = get('--run-id');
  const dataFile = get('--data-file');
  const recordCount = get('--record-count') != null ? Number(get('--record-count')) : undefined;
  const title = get('--title');
  const bodyArg = get('--body');
  const label = get('--label');
  const step = get('--step');
  const error = get('--error');
  const details = get('--details');

  (async () => {
    if (mode === 'empty-dataset') {
      await alertOnEmptyDataset({ workflow, runId, dataFile, recordCount, details });
    } else if (mode === 'failure') {
      await alertOnWorkflowFailure({ workflow, runId, step, error, details });
    } else if (mode === 'custom') {
      if (!title) { console.error('--title required for custom mode'); process.exit(1); }
      const labels = label ? [label] : ['monitoring'];
      await createGitHubIssue({ title, body: bodyArg || title, labels });
    } else {
      console.error(`Unknown mode: ${mode}. Use empty-dataset, failure, or custom`);
      process.exit(1);
    }
  })().catch((err) => {
    console.error('[alert] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { createGitHubIssue, postSlackAlert, alertOnEmptyDataset, alertOnWorkflowFailure };
