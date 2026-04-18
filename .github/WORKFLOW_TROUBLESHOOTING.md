# Workflow Troubleshooting Guide

This guide covers common failure modes for the data-building workflows in this repository, with step-by-step remediation instructions.

---

## Weekly Data Sync Failures (`run-all-workflows.yml`)

### Symptoms
- The **Run All Data Workflows** orchestration job fails on Sunday
- One or more of the 13 child workflows did not complete successfully
- GitHub issue tagged `market-data-build-failure` appears automatically

### Diagnosis steps

1. **Find the failed run** in [Actions → Run All Data Workflows](../../actions/workflows/run-all-workflows.yml)
2. Click the failed run and expand the **Trigger child workflows** step
3. Identify which child workflow failed (look for red ❌ icons)
4. Open that child workflow's run and expand the failed step for the error message

### Most common culprits

| Workflow | Required secret | Failure symptom |
|----------|----------------|-----------------|
| `market_data_build.yml` | `CENSUS_API_KEY` | Pre-flight check exits with "secret is not set" |
| `fetch-census-acs.yml` | `CENSUS_API_KEY` | API request returns 401 Unauthorized |
| `fetch-fred-data.yml` | `FRED_API_KEY` | Series fetch returns empty observations |
| `fetch-kalshi.yml` | Kalshi credentials | Auth failure |
| `zillow-data-sync.yml` | Zillow credentials | Auth failure |

### Recovery steps

1. Verify the required secret is set (see sections below for each key)
2. Re-trigger only the failed child workflow:
   ```bash
   gh workflow run <failed-workflow>.yml --repo pggLLC/Housing-Analytics
   ```
3. Once the child workflow succeeds, re-trigger the full orchestration:
   ```bash
   gh workflow run run-all-workflows.yml --repo pggLLC/Housing-Analytics
   ```

---

## Market Data Not Populating (`market_data_build.yml`)

### Symptoms
- `market-analysis.html` map shows no tracts or very few pins
- `data/market/tract_centroids_co.json` has fewer than 100 tracts
- `data/market/acs_tract_metrics_co.json` has fewer than 100 records
- `data/market/hud_lihtc_co.geojson` has fewer than 50 features

### Root cause checklist

| # | Check | How to verify |
|---|-------|---------------|
| 1 | `CENSUS_API_KEY` secret is set | Settings → Secrets and variables → Actions → look for `CENSUS_API_KEY` |
| 2 | Build workflow ran recently | [Actions → Build Market Data](../../actions/workflows/market_data_build.yml) |
| 3 | Build workflow completed successfully | Click the latest run and check all steps are green |
| 4 | Artifacts were committed back to `main` | Check recent commits for `chore(data): rebuild market data artifacts` |

---

## Setting up the Census API Key

The `market_data_build.yml` and `fetch-census-acs.yml` workflows require a free Census API key to fetch ACS tract-level data. Without it, the workflow will **fail in the pre-flight step** with:

```
CENSUS_API_KEY secret is not set.
```

> **Key expiration note:** Census API keys do not automatically expire, but GitHub Actions secrets should be rotated periodically. If your last key was set more than 90 days ago and the workflow is failing with 401 errors, request a new key and update the secret.

### Steps to add the key

1. **Get a free key** at <https://api.census.gov/data/key_signup.html>
   - Fill in your name and email address.
   - You will receive the key by email within a few minutes.

2. **Add the key to GitHub Secrets**
   - Go to your repository → **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret** (or **Update** if it already exists)
   - Name: `CENSUS_API_KEY`
   - Value: paste the 40-character key you received by email
   - Click **Add secret**

3. **Re-run the workflow**
   ```bash
   gh workflow run market_data_build.yml --repo <owner>/<repo>
   ```

### Verifying the key is set

Open the most recent **Build Market Data** workflow run and expand the **Pre-flight validation** step. You should see:

```
CENSUS_API_KEY: set (40 chars) ✅
```

If you see `CENSUS_API_KEY secret is not set` the key is missing from Secrets.

---

## Setting up the FRED API Key

The `fetch-fred-data.yml` workflow requires a free FRED API key to fetch economic time-series data. Without it, series will be fetched without authentication (rate-limited to 120 requests/min) and may fail intermittently.

### Steps to add the key

1. **Get a free key** at <https://fredaccount.stlouisfed.org/apikey>
   - Create a free account at <https://fred.stlouisfed.org/> if you do not have one.
   - Go to **My Account** → **API Keys** → **Request API Key**.
   - The key is available immediately in your account dashboard.

2. **Add the key to GitHub Secrets**
   - Go to your repository → **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret** (or **Update** if it already exists)
   - Name: `FRED_API_KEY`
   - Value: paste the 32-character key
   - Click **Add secret**

---

## Manually Triggering a Rebuild

### Option A — GitHub CLI (recommended)

```bash
# Rebuild market data
gh workflow run market_data_build.yml --repo pggLLC/Housing-Analytics

# Rebuild all data workflows at once
gh workflow run run-all-workflows.yml --repo pggLLC/Housing-Analytics
```

### Option B — Issue comment trigger

Post a comment on any open issue containing exactly:

```
@github-actions rebuild-market-data
```

The bot will acknowledge and dispatch `market_data_build.yml` automatically.  
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

The `scripts/validate-critical-data.js` script and the **Validate artifacts** step in `market_data_build.yml` both enforce these minimums. Builds that produce fewer records are treated as failures:

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
| `market_data_build.yml` | Every Sunday at 23:00 UTC | `0 23 * * 0` |
| `run-all-workflows.yml` | Every Sunday at 00:00 UTC | `0 0 * * 0` |

> **Note:** `run-all-workflows.yml` also triggers `market_data_build.yml` as part of its orchestration, so the market data build effectively runs twice on Sundays. This is intentional — the standalone 23:00 UTC run ensures fresh data before the new week, and the midnight orchestration verifies all workflows complete together.

---

## Census Cartographic Boundary URL Scheme

The Census Bureau publishes GeoJSON tract boundary files at:

```
https://www2.census.gov/geo/tiger/GENZ{year}/json/cb_{year}_08_tract_500k.json
```

The `{year}` segment matches the data vintage year (e.g. `2024`). The build script (`scripts/market/build_public_market_data.py`) tries these vintages **newest-first**:

| Priority | URL | Notes |
|----------|-----|-------|
| 1 (primary) | `.../GENZ2024/json/cb_2024_08_tract_500k.json` | Default since April 2026 |
| 2 (fallback) | `.../GENZ2023/json/cb_2023_08_tract_500k.json` | Secondary fallback |
| 3 (fallback) | `.../GENZ2022/json/cb_2022_08_tract_500k.json` | Legacy fallback (404 as of 2026) |

The `CENSUS_CB_URL` environment variable overrides the primary URL if set. The ordered fallback list is defined in `_CENSUS_CB_FALLBACK_URLS` in `build_public_market_data.py`.

**Symptoms of a stale URL:**
- Workflow log shows `HTTP 404` in the `[boundary-fallback]` lines
- `data/market/tract_boundaries_co.geojson` has 0 features
- Choropleth map in `market-analysis.html` shows no tract shading

**Fix:**
The build script will automatically try newer vintages first. If all known vintages return 404, check the Census FTP:
```
https://www2.census.gov/geo/tiger/
```

---

## HUD ArcGIS Temporary 403 Blocking

HUD and ESRI ArcGIS endpoints (`hudgis-hud.opendata.arcgis.com`, `services.arcgis.com/VTyQ9soqVukalItT/…`) occasionally return `HTTP 403 Forbidden` during maintenance windows or IP-based throttling. This is **not a credential issue** and resolves on its own within hours.

**Affected workflows:**
- `cache-hud-gis-data.yml` (QCT / DDA fetches)
- `market_data_build.yml` (HUD LIHTC fetch)

**Cache fallback behavior:**

Both workflows implement a cache fallback: when the live API returns an error, the workflow re-uses the **last successfully committed file** from the repository. No data is lost and GitHub Pages continues to serve the most-recent good data.

| Workflow | API | Fallback file |
|----------|-----|---------------|
| `cache-hud-gis-data.yml` | QCT ArcGIS | `data/qct-colorado.json` |
| `cache-hud-gis-data.yml` | DDA ArcGIS | `data/dda-colorado.json` |
| `market_data_build.yml` | HUD LIHTC GeoJSON | `data/market/hud_lihtc_co.geojson` |

**Status check:** <https://status.arcgis.com/>

**Recovery:** Once the API is healthy, manually re-trigger the workflow to refresh the cache:
```bash
gh workflow run cache-hud-gis-data.yml --repo pggLLC/Housing-Analytics
gh workflow run market_data_build.yml  --repo pggLLC/Housing-Analytics
```

---

## Git Push Conflict Recovery

**Error pattern:**
```
! [rejected]  main -> main (fetch first)
error: failed to push some refs to 'https://github.com/pggLLC/Housing-Analytics'
hint: Updates were rejected because the remote contains work that you do not have locally.
```

**Root cause:** Two workflows commit to `main` concurrently (e.g. `market_data_build.yml` and `fetch-chfa-lihtc.yml` running at the same time). One push wins; the other is rejected.

**Built-in fix:** All data workflows in this repository use the following pattern before `git push`:
```bash
git pull --rebase --autostash origin main
git push
```

`--autostash` stashes any uncommitted local changes before the rebase and re-applies them after, preventing "cannot pull with rebase" errors when the workspace is dirty. `--rebase` avoids merge commits.

**If a workflow still fails to push:**

1. Re-run the failed workflow from the [Actions tab](../../actions) — it will re-commit its changes on top of the updated `main` and push successfully.
2. If concurrent workflows keep colliding, stagger their cron schedules by at least 30 minutes.

---

`data/manifest.json` is automatically regenerated after every successful data build by calling `scripts/rebuild_manifest.py`. The updated manifest is committed back to the repository in the same workflow run.

### Workflows that regenerate the manifest

| Workflow | When manifest is regenerated |
|----------|------------------------------|
| `market_data_build.yml` | After market artifact validation passes |
| `build-hna-data.yml` | After all HNA data phases complete |
| `fetch-lihtc-data.yml` | After QCT/DDA data is fetched and validated |

### Manual manifest regeneration

If the manifest is stale (e.g., files were added outside a workflow), regenerate it locally:

```bash
python scripts/rebuild_manifest.py
git add data/manifest.json
git commit -m "chore(data): regenerate manifest.json"
git push
```

---

## Automatic Failure Alerts

When a build fails, the workflow automatically:

1. Posts a Slack notification (if `SLACK_WEBHOOK_URL` secret is configured)
2. Opens a GitHub issue tagged `market-data-build-failure` with remediation steps

These issues are deduplicated — only one open issue is created per label. Close the issue once the data is fixed.
