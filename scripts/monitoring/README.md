# Monitoring & Alerting — Housing Analytics

This directory contains scripts for data quality monitoring, alerting, and report generation for the Housing Analytics data pipelines.

---

## Scripts

### `data-quality-check.py`

Python script that validates all tracked data artifacts. Can be run locally or in CI after any fetch/build step.

```bash
# Basic run (prints pass/fail for each file)
python3 scripts/monitoring/data-quality-check.py

# Output results as JSON (useful for CI step summaries)
python3 scripts/monitoring/data-quality-check.py --json

# Override minimum GeoJSON feature count (e.g. require at least 10)
python3 scripts/monitoring/data-quality-check.py --min-features 10
```

Exit codes: `0` = all critical checks passed; `1` = at least one critical failure.

---

### `generate-report.js`

Node.js report generator. Produces a human-readable console summary and/or a machine-readable JSON report.

```bash
# Console summary
node scripts/monitoring/generate-report.js

# JSON output to stdout
node scripts/monitoring/generate-report.js --json

# Write JSON report to a file
node scripts/monitoring/generate-report.js --output reports/data-quality.json
```

---

### `alert.js`

Alerting utility for creating GitHub Issues and (optionally) posting Slack notifications when data workflows detect failures.

#### GitHub Issues

Set the `GITHUB_TOKEN` and `GITHUB_REPOSITORY` environment variables (these are set automatically in GitHub Actions).

```bash
# Alert for an empty dataset
node scripts/monitoring/alert.js \
  --mode empty-dataset \
  --workflow fetch-fred-data.yml \
  --run-id 12345678 \
  --data-file data/fred-data.json \
  --record-count 0 \
  --details "FRED API returned no series"

# Alert for a workflow failure
node scripts/monitoring/alert.js \
  --mode failure \
  --workflow fetch-kalshi.yml \
  --run-id 12345678 \
  --step "Fetch Kalshi prediction market data" \
  --error "HTTP 401 Unauthorized"

# Create a custom issue
node scripts/monitoring/alert.js \
  --mode custom \
  --title "My custom alert" \
  --body  "Details here" \
  --label critical
```

#### Slack Notifications (optional)

Set the `SLACK_WEBHOOK_URL` secret in your repository:

1. Go to **Settings → Secrets and variables → Actions**
2. Add a new secret: `SLACK_WEBHOOK_URL` = your Slack incoming webhook URL
3. The `alert.js` script will automatically post to Slack when the secret is set

---

## Workflow Integration

Each data workflow calls these scripts as follows:

1. **After data fetch/build**: runs a validation step that checks the output file.
2. **On validation failure** (`if: failure()`): calls `alert.js` to create a GitHub Issue.
3. **Optional**: Slack notification via `SLACK_WEBHOOK_URL` secret.

The `permissions` block in each workflow includes `issues: write` to allow automated issue creation.

---

## Required Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `GITHUB_TOKEN` | Auto-set | Used by `alert.js` to create GitHub Issues |
| `SLACK_WEBHOOK_URL` | Optional | Slack incoming webhook for Slack alerts |
| `FRED_API_KEY` | Yes (fetch-fred) | FRED API key |
| `KALSHI_API_KEY` | Yes (fetch-kalshi) | Kalshi API key |
| `KALSHI_API_SECRET` | Yes (fetch-kalshi) | Kalshi API secret |
| `KASHLI_API_KEY` | Yes (fetch-kashli) | Kashli API key (legacy name for the secondary Kalshi feed) |
| `CENSUS_API_KEY` | Yes (build-hna) | Census API key |

---

## Running Locally

```bash
# Full data quality check
python3 scripts/monitoring/data-quality-check.py

# Generate a JSON report
node scripts/monitoring/generate-report.js --output /tmp/housing-data-report.json

# View the report
cat /tmp/housing-data-report.json | python3 -m json.tool
```
