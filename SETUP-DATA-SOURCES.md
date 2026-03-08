# Data Sources Setup Guide

This document describes the external data sources used by Housing Analytics, the GitHub Secrets
required to activate each automated workflow, and the fallback behaviour when a source is
unavailable.

---

## Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions** of the repository.

| Secret | Required? | Used by | How to obtain |
|---|---|---|---|
| `CENSUS_API_KEY` | **Required** | `fetch-census-acs.yml`, `build-hna-data.yml`, `data-refresh.yml`, `audit-endpoints.yml` | [api.census.gov/data/key_signup.html](https://api.census.gov/data/key_signup.html) — free, instant |
| `FRED_API_KEY` | **Required** | `deploy.yml` (injected into `js/config.js`) | [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) — free, instant |
| `KALSHI_API_KEY` | Optional | `fetch-kalshi.yml`, `fetch-kashli-data.yml` | [kalshi.com](https://kalshi.com) — requires account |
| `KALSHI_API_SECRET` | Optional | `fetch-kalshi.yml` | Same account as above |
| `KALSHI_API_BASE_URL` | Optional | `fetch-kalshi.yml` | Default: `https://trading-api.kalshi.com/trade-api/v2` |
| `ZILLOW_EMAIL` | Optional | `zillow-data-sync.yml` | Zillow Research account credentials |
| `ZILLOW_PASSWORD` | Optional | `zillow-data-sync.yml` | Same account as above |
| `EMAIL_USER` | Optional | Site monitoring | Gmail account address |
| `EMAIL_PASSWORD` | Optional | Site monitoring | Gmail app password (16 chars) |
| `RECIPIENT_EMAIL` | Optional | Site monitoring | Notification recipient address |

---

## Workflow Schedule Overview

All times are UTC. Workflows are staggered to avoid conflicts and to respect upstream data
publication cadences.

| Time (UTC) | Day | Workflow | Data produced |
|---|---|---|---|
| Monday 02:00 | Weekly | `zillow-data-sync.yml` | `data/zillow-*.json` |
| Monday 03:00 | Weekly | `fetch-kalshi.yml` | `data/kalshi/prediction-market.json` |
| Monday 03:00 | Weekly | `fetch-kashli-data.yml` | `data/kashli-market-data.json` |
| Monday 04:00 | Weekly | `cache-hud-gis-data.yml` | `data/hud-*` |
| Monday 05:00 | Weekly | `fetch-chfa-lihtc.yml` | `data/chfa-lihtc.json`, `data/hna/lihtc/*.json` |
| Monday 06:30 | Weekly | `build-hna-data.yml` | `data/hna/*.json` |
| Monday 08:30 | Weekly | `audit-endpoints.yml` | Endpoint reachability report |
| Daily 06:30 | Daily | `fetch-census-acs.yml` | `data/census-acs-state.json` |
| Daily 07:00 | Daily | `data-refresh.yml` | `data/co-county-demographics.json`, `data/manifest.json` |
| 1st of month 04:00 | Monthly | `car-data-update.yml` | `data/car-market-report-YYYY-MM.json` |
| On push to `main` | Continuous | `deploy.yml` | GitHub Pages |

---

## Data Sources

### U.S. Census Bureau — ACS 5-Year Estimates
- **Workflow**: `fetch-census-acs.yml`
- **Secret required**: `CENSUS_API_KEY` (configured via GitHub Secrets — see [Adding Secrets to GitHub](#adding-secrets-to-github))
- **Output**: `data/census-acs-state.json`
- **Fallback**: If `CENSUS_API_KEY` is missing the workflow logs a warning and continues with
  unauthenticated requests (rate-limited but functional for low volume). Site pages load but
  Census-dependent charts may show empty states if rate limits are hit.
- **Notes**: The workflow automatically tries recent vintages (current year−1 through year−5) so it
  remains resilient as the Census publishes new releases.

### Data Refresh Pipeline
- **Workflow**: `data-refresh.yml`
- **Script**: `scripts/refresh-data-pipeline.js`
- **Secret required**: `CENSUS_API_KEY` (optional — graceful fallback if absent)
- **Output**: `data/co-county-demographics.json`, `data/manifest.json`
- **Fallback**: If `CENSUS_API_KEY` is absent, the script logs a warning and attempts an
  unauthenticated Census request. If that also fails, the existing data file is retained unchanged.
  Execution always completes successfully — it never blocks the pipeline.
- **Notes**: Also reads `FRED_API_KEY` for status logging.

### Housing Needs Assessment (HNA) Builder
- **Workflow**: `build-hna-data.yml`
- **Script**: `scripts/hna/build_hna_data.py`
- **Secret required**: `CENSUS_API_KEY`
- **Output**: `data/hna/*.json`
- **Fallback**: HNA pages display placeholder content when data files are absent.
- **Notes**: Also uses LEHD/LODES and DOLA open data (no extra keys needed).

### CHFA LIHTC (Low Income Housing Tax Credits)
- **Workflow**: `fetch-chfa-lihtc.yml`
- **Script**: `scripts/fetch-chfa-lihtc.js`
- **Secrets required**: None (public data)
- **Output**: `data/chfa-lihtc.json`, `data/hna/lihtc/*.json`
- **Fallback**: `deploy.yml` runs the same script with `continue-on-error: true`; an outdated or
  missing file is tolerated.

### Kalshi Prediction Markets
- **Workflow**: `fetch-kalshi.yml`
- **Script**: `scripts/kalshi/fetch_kalshi_prediction_markets.js`
- **Secrets required**: `KALSHI_API_KEY`, `KALSHI_API_SECRET`, `KALSHI_API_BASE_URL` (optional)
- **Output**: `data/kalshi/prediction-market.json`
- **Fallback**: Markets page hides the prediction widget when data is missing.

### Colorado Association of REALTORS (CAR)
- **Workflow**: `car-data-update.yml`
- **Script**: `scripts/generate-car-placeholder.mjs`
- **Secrets required**: None
- **Output**: `data/car-market-report-YYYY-MM.json`
- **Notes**: Generates a placeholder JSON file each month. Replace `null` values with real CAR
  report figures once the monthly PDF is published. The script skips creation if the file already
  exists, so manual updates are preserved.

### Zillow Research Data
- **Workflow**: `zillow-data-sync.yml`
- **Script**: `scripts/fetch-zillow.js`
- **Secrets required**: `ZILLOW_EMAIL`, `ZILLOW_PASSWORD`
- **Output**: `data/zillow-*.json`
- **Fallback**: Workflow uses `continue-on-error: true`; site pages render without Zillow data.
- **Notes**: Uses Puppeteer to log in and download CSV exports. Credentials must be for a Zillow
  Research account with data export access.

### FRED (Federal Reserve Economic Data)
- **Secret**: `FRED_API_KEY`
- **Used in**: `deploy.yml` — injected into `js/config.js` at build time so browser-side charts
  can call the FRED API directly.
- **How to obtain**: Free registration at [fred.stlouisfed.org](https://fred.stlouisfed.org).

### HUD GIS Data
- **Workflow**: `cache-hud-gis-data.yml`
- **Secrets required**: None (public data)
- **Output**: `data/hud-*`

---

## Adding Secrets to GitHub

1. Go to your repository on GitHub.
2. Click **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Enter the secret name (e.g., `CENSUS_API_KEY`) and its value.
5. Click **Add secret**.

Secrets are encrypted and only exposed to workflow runs — they are never logged or included in the
deployed site output.

---

## Local Development

Copy `.env.example` to `.env` and fill in the values you need for local testing:

```bash
cp .env.example .env
# Edit .env with your keys
```

The `.env` file is listed in `.gitignore` and must **never** be committed.

---

## Troubleshooting

### Census API key not configured

**Symptom**: Workflow logs show `CENSUS_API_KEY: NOT SET` or Census-related charts on the
dashboard display empty states / "No data available".

**Cause**: The `CENSUS_API_KEY` secret has not been added to the repository, or the workflow step
is not passing the secret to the script via `env:`.

**Resolution**:

1. **Obtain a free Census API key** at
   [api.census.gov/data/key_signup.html](https://api.census.gov/data/key_signup.html).
   The key is issued instantly via email.

2. **Add the key to GitHub Secrets**:
   - Navigate to your repository → **Settings** → **Secrets and variables** → **Actions**.
   - Click **New repository secret**.
   - Name: `CENSUS_API_KEY`  
     Value: the key you received by email.
   - Click **Add secret**.

3. **Verify the workflow step** includes:
   ```yaml
   env:
     CENSUS_API_KEY: ${{ secrets.CENSUS_API_KEY }}
   ```
   Both `data-refresh.yml` and `fetch-census-acs.yml` include this block by default.

4. **For local development**, add the key to your `.env` file:
   ```
   CENSUS_API_KEY=your_census_api_key_here
   ```
   `scripts/refresh-data-pipeline.js` automatically loads `.env` when run locally.

**Note**: Without a key, Census API requests are still attempted using the public (unauthenticated)
endpoint, which is rate-limited. Low-volume local testing usually succeeds without a key.

---

### FRED API key not configured

**Symptom**: Economic indicator charts show stale or empty data.

**Resolution**: Obtain a free key at [fred.stlouisfed.org](https://fred.stlouisfed.org) and add it
as the `FRED_API_KEY` secret in GitHub Secrets.

---

### data/manifest.json is out of date

**Symptom**: CI pre-commit check fails with "manifest `generated` timestamp is older than 30 days"
or "file count is below 100 entries".

**Resolution**: Run the data refresh pipeline manually:
```bash
node scripts/refresh-data-pipeline.js
```
Or trigger the `data-refresh.yml` workflow from the Actions tab.
