# Workflow Setup

This document explains how to configure GitHub Actions secrets, troubleshoot data workflow failures, and run data pipelines locally.

---

## Required Secrets

| Secret | Where Used | How to Obtain |
|--------|-----------|---------------|
| `CENSUS_API_KEY` | `build-hna-data.yml`, `market_data_build.yml` | Free key at https://api.census.gov/data/key_signup.html |
| `SLACK_WEBHOOK_URL` | Alert workflows | Optional — Slack workspace webhook for failure notifications |

---

## Census API Key Setup

### Step 1: Get a Free Key

1. Visit https://api.census.gov/data/key_signup.html
2. Enter your name and email address
3. You will receive the key by email within a few minutes

### Step 2: Add the Key to GitHub Secrets

1. Go to your repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `CENSUS_API_KEY`
4. Value: paste the 40-character key from your email
5. Click **Add secret**

### Step 3: Verify the Key Is Set

Re-run the workflow and expand the **Environment check** or **Pre-flight validation** step. You should see:

```
CENSUS_API_KEY: set (40 chars) ✅
```

If you see `CENSUS_API_KEY: NOT SET`, the key is missing from Secrets.

---

## Workflow Reference

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `build-hna-data.yml` | Mon 06:30 UTC | Fetches ACS + DOLA + LEHD data; generates HNA projections |
| `market_data_build.yml` | Sun 23:00 UTC | Fetches tract-level ACS data; rebuilds LIHTC GeoJSON |
| `fetch-fred-data.yml` | (varies) | Fetches FRED economic indicator series |
| `fetch-chas-data.yml` | Mon 03:00 UTC | Fetches CHAS affordability gap data |
| `cache-hud-gis-data.yml` | Mon 04:00 UTC | Fetches HUD QCT/DDA GeoJSON data |
| `fetch-chfa-lihtc.yml` | Mon 05:00 UTC | Fetches CHFA LIHTC project data |

---

## Running Workflows Manually

To trigger any workflow on demand (requires write access to the repository):

```bash
# Using GitHub CLI
gh workflow run build-hna-data.yml --repo pggLLC/Housing-Analytics
gh workflow run market_data_build.yml --repo pggLLC/Housing-Analytics
```

Or navigate to **Actions** → select the workflow → click **Run workflow**.

---

## Building HNA Data Locally

```bash
# Install dependencies (none required beyond Python stdlib)
cd /path/to/Housing-Analytics

# Build HNA data (requires CENSUS_API_KEY environment variable)
export CENSUS_API_KEY=your_key_here
python3 scripts/hna/build_hna_data.py

# Build scenario files (no API key required)
python3 scripts/hna/build_scenarios.py

# Run cohort-component projections for all counties
python3 scripts/hna/build_cohort_projections.py

# Validate DOLA and FRED data
python3 scripts/hna/validate_dola_fred_data.py
```

---

## Common Failure Modes

### Build Market Data Fails at Pre-Flight

**Symptom:** Workflow fails immediately with:
```
CENSUS_API_KEY secret is not set.
```

**Fix:** Follow the [Census API Key Setup](#census-api-key-setup) steps above.

### HNA Data Build Produces No Output Files

**Symptom:** Post-build verification step reports 0 files.

**Checklist:**
1. Is `CENSUS_API_KEY` set and valid? (Try the key at https://api.census.gov/data?key=YOUR_KEY)
2. Did the Census API rate-limit the request? (Re-run the workflow after 10 minutes)
3. Is the ACS endpoint responding? Check https://api.census.gov/data/2022/acs/acs5/variables.json
4. Run `python3 scripts/hna/diagnose.py` locally to test connectivity

### LEHD WAC Parse Warning

**Symptom:** Workflow completes but shows:
```
::warning::LEHD WAC parse failed (non-critical; will retry next run)
```

This is **non-critical** — LEHD data is a supplemental employment layer. The HNA dashboard will use the previous LEHD cache.

### Scenario Files Missing

**Symptom:** The Scenario Builder page shows "DOLA data not available".

**Fix:**
```bash
python3 scripts/hna/build_scenarios.py
```

Then commit the new files in `data/hna/scenarios/`.

### DOLA SYA Files Missing Counties

**Symptom:** `validate_dola_fred_data.py` reports missing county files.

**Fix:** Re-run `build_hna_data.py` — it fetches DOLA SYA data for all 64 counties. If individual counties fail, check whether DOLA's API (https://demography.dola.colorado.gov/) is responding.

---

## Data Freshness Indicators

Each dashboard shows a **"Last Updated"** timestamp sourced from:

| Data | Sentinel Field | File |
|------|---------------|------|
| FRED series | `updated` | `data/fred-data.json` |
| LIHTC | `fetchedAt` | `data/chfa-lihtc.json` |
| AMI gap | `meta.generated` | `data/hna/co_ami_gap_by_county.json` |
| Manifest | `generated` | `data/manifest.json` |

These sentinel keys **must not be removed** during schema migrations (see `DATA-MANIFEST.json`).

---

## Adding a New Workflow

When adding a new data workflow:

1. Add `CENSUS_API_KEY` to the workflow `env` block if it makes Census API calls
2. Use `ctx.waitUntil()` for any Cloudflare Worker cache writes (not `await cache.put()`)
3. Add the new data file to `DATA-MANIFEST.json`
4. Update this document with the new workflow's schedule and purpose
5. Add a row to the `/health` route list in `cloudflare-worker/worker.js`

---

## See Also

- [WORKFLOW_TROUBLESHOOTING.md](../.github/WORKFLOW_TROUBLESHOOTING.md) — detailed per-workflow failure guides
- [DATA-SOURCES.md](DATA-SOURCES.md) — data source attribution and refresh schedules
- [Projection Methodology](PROJECTION-METHODOLOGY.md) — how projections are computed
