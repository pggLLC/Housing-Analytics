# Workflow Troubleshooting Guide

This guide covers common failure modes for the data-building workflows in this repository, with step-by-step remediation instructions.

---

## Market Data Not Populating (`build-market-data.yml`)

### Symptoms
- `market-analysis.html` map shows no tracts or very few pins
- `data/market/tract_centroids_co.json` has fewer than 100 tracts
- `data/market/acs_tract_metrics_co.json` has fewer than 100 records
- `data/market/hud_lihtc_co.geojson` has fewer than 50 features

### Root cause checklist

| # | Check | How to verify |
|---|-------|---------------|
| 1 | `CENSUS_API_KEY` secret is set | Settings → Secrets and variables → Actions → look for `CENSUS_API_KEY` |
| 2 | Build workflow ran recently | [Actions → Build Market Data](../../actions/workflows/build-market-data.yml) |
| 3 | Build workflow completed successfully | Click the latest run and check all steps are green |
| 4 | Artifacts were committed back to `main` | Check recent commits for `chore(data): rebuild market data artifacts` |

---

## Setting up the Census API Key

The `build-market-data.yml` workflow requires a free Census API key to fetch ACS tract-level data. Without it the workflow will **fail in the pre-flight step** with:

```
CENSUS_API_KEY secret is not set.
```

### Steps to add the key

1. **Get a free key** at <https://api.census.gov/data/key_signup.html>
   - Fill in your name and email address.
   - You will receive the key by email within a few minutes.

2. **Add the key to GitHub Secrets**
   - Go to your repository → **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `CENSUS_API_KEY`
   - Value: paste the key you received by email
   - Click **Add secret**

3. **Re-run the workflow**
   ```bash
   gh workflow run build-market-data.yml --repo <owner>/<repo>
   ```

### Verifying the key is set

Open the most recent **Build Market Data** workflow run and expand the **Pre-flight validation** step. You should see:

```
CENSUS_API_KEY: set (40 chars) ✅
```

If you see `CENSUS_API_KEY secret is not set` the key is missing from Secrets.

---

## Manually Triggering a Rebuild

### Option A — GitHub CLI (recommended)

```bash
# Rebuild market data
gh workflow run build-market-data.yml --repo pggLLC/Housing-Analytics

# Rebuild all data workflows at once
gh workflow run run-all-workflows.yml --repo pggLLC/Housing-Analytics
```

### Option B — Issue comment trigger

Post a comment on any open issue containing exactly:

```
@github-actions rebuild-market-data
```

The bot will acknowledge and dispatch `build-market-data.yml` automatically.  
_Only repository members (collaborator or above) can trigger this._

### Option C — GitHub Actions UI

1. Go to **Actions** → **Build Market Data**
2. Click **Run workflow** (top-right of the workflow list)
3. Leave `Force refresh` as `false` unless you want to ignore any cached data
4. Click **Run workflow**

### Option D — Local rebuild (requires Python 3.11+)

```bash
# Set the key in your local environment first
export CENSUS_API_KEY=your_key_here

# Run the builder
python scripts/market/build_public_market_data.py

# Validate the output
node scripts/validate-critical-data.js
```

---

## Common Census API Errors

| HTTP status | Meaning | Fix |
|-------------|---------|-----|
| `401 Unauthorized` | API key is invalid or expired | Re-request a key at https://api.census.gov/data/key_signup.html |
| `429 Too Many Requests` | Rate limit hit | Wait ~1 hour and re-run; the build script uses exponential back-off automatically |
| `503 Service Unavailable` | Census API is temporarily down | Check https://www.census.gov/about/policies/privacy/faq.html#par_textimage_1 and retry in an hour |
| `400 Bad Request` | Malformed query (usually a bad variable name) | Check `scripts/market/build_public_market_data.py` for the `ACS_VARIABLES` list |

---

## Minimum Data Thresholds

The `scripts/validate-critical-data.js` script and the **Validate artifacts** step in `build-market-data.yml` both enforce these minimums. Builds that produce fewer records are treated as failures:

| File | Minimum records | Why |
|------|----------------|-----|
| `data/market/tract_centroids_co.json` | 100 tracts | Colorado has ~1,300 tracts; fewer means placeholder data |
| `data/market/acs_tract_metrics_co.json` | 100 records | Same tract count as centroids |
| `data/market/hud_lihtc_co.geojson` | 50 features | Colorado has hundreds of LIHTC properties |

To validate locally after a build:

```bash
node scripts/validate-critical-data.js
```

---

## Weekly Schedule

| Workflow | Schedule | Cron |
|----------|----------|------|
| `build-market-data.yml` | Every Sunday at 23:00 UTC | `0 23 * * 0` |
| `run-all-workflows.yml` | Every Sunday at 00:00 UTC | `0 0 * * 0` |

> **Note:** `run-all-workflows.yml` also triggers `build-market-data.yml` as part of its orchestration, so the market data build effectively runs twice on Sundays. This is intentional — the standalone 23:00 UTC run ensures fresh data before the new week, and the midnight orchestration verifies all workflows complete together.

---

## Automatic Failure Alerts

When a build fails, the workflow automatically:

1. Posts a Slack notification (if `SLACK_WEBHOOK_URL` secret is configured)
2. Opens a GitHub issue tagged `market-data-build-failure` with remediation steps

These issues are deduplicated — only one open issue is created per label. Close the issue once the data is fixed.
