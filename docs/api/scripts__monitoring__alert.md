# `scripts/monitoring/alert.js`

alert.js — Housing Analytics Monitoring Alert Utility
======================================================
Creates GitHub Issues and (optionally) posts Slack messages when
data workflows detect empty datasets or critical failures.

Usage (CLI):
  node scripts/monitoring/alert.js \
    --title "fetch-fred-data: empty dataset" \
    --body  "No FRED series were fetched." \
    --label critical \
    --workflow fetch-fred-data.yml \
    --run-id  12345

Environment variables:
  GITHUB_TOKEN      — required for GitHub Issue creation
  GITHUB_REPOSITORY — "owner/repo" (set automatically in Actions)
  SLACK_WEBHOOK_URL — optional; enables Slack notifications

Exported API (for use in other scripts):
  createGitHubIssue({ title, body, labels })
  postSlackAlert({ text, blocks })
  alertOnEmptyDataset({ workflow, runId, dataFile, recordCount, details })

_No documented symbols — module has a file-header comment only._
