# Data Integration Guide

This document describes all data sources used across the Housing Analytics site, how they are updated, and how to use them in frontend code.

---

## Overview of Data Sources

| Source | Type | Freshness | Update Method |
|--------|------|-----------|---------------|
| Census / ACS | API | Real-time | Serverless endpoint (`/api/co-ami-gap`) |
| HUD Markets | API | Weekly | Serverless cache (`/api/hud-markets`) |
| CO Demographics | API | Weekly | Serverless cache (`/api/co-demographics`) |
| Zillow | JSON file | Weekly | GitHub Actions workflow |
| CAR | JSON file | Monthly | Manual workflow dispatch |
| FRED | JSON file | Daily | GitHub Actions workflow |

---

## Data Sources Detail

### 1. Census / ACS (`/api/co-ami-gap`)
- **What it provides:** Household counts and affordable unit counts by AMI band for Colorado counties.
- **Format:** JSON with `statewide` object, `counties` array, `bands` array, and `meta` object.
- **Frontend access:** `HousingDataIntegration.loadCensusData()`
- **Fallback:** `data/co_ami_gap_by_county.json` (static snapshot)
- **Config key:** `APP_CONFIG.AMI_GAP_API_URL`

### 2. HUD Markets (`/api/hud-markets`)
- **What it provides:** HUD Fair Market Rents, income limits, and market-level affordability analysis.
- **Format:** JSON with metro-level market data.
- **Frontend access:** `HousingDataIntegration.loadHUDData()`
- **Config key:** `APP_CONFIG.HUD_MARKETS_API_URL`

### 3. Colorado Demographics (`/api/co-demographics`)
- **What it provides:** Population, household formation, and housing unit trend data for Colorado.
- **Format:** JSON with statewide and county-level demographic indicators.
- **Frontend access:** `HousingDataIntegration.loadDemographicsData()`
- **Config key:** `APP_CONFIG.DEMOGRAPHICS_API_URL`

### 4. Zillow (`/data/zillow-YYYY-MM-DD.json`)
- **What it provides:** Zillow Home Value Index (ZHVI) and related housing market indicators.
- **Update schedule:** Weekly, via `.github/workflows/` (Zillow data sync workflow).
- **Frontend access:** `HousingDataIntegration.loadZillowData()` (tries last 14 days of filenames).
- **File location:** `data/zillow-YYYY-MM-DD.json`

### 5. CAR Market Reports (`/data/car-market-report-YYYY-MM.json`)
- **What it provides:** Colorado Association of REALTORS monthly market statistics — median price, inventory, days on market, price per sq ft.
- **Update schedule:** Monthly, via manual `workflow_dispatch` trigger.
- **Frontend access:** `HousingDataIntegration.loadCARData()` (tries last 6 months of filenames).
- **File location:** `data/car-market-report-YYYY-MM.json`
- **Template:** `scripts/car-data-template.json`

### 6. FRED (`/data/fred-data.json`)
- **What it provides:** Federal Reserve economic indicators (CPI, mortgage rates, housing starts, etc.).
- **Update schedule:** Daily, via `.github/workflows/fetch-fred-data.yml`.
- **Frontend access:** Loaded directly in `economic-dashboard.html`.

---

## How to Update Each Source

### Zillow — Automatic (GitHub Actions)
The Zillow sync workflow runs on a schedule. No manual action needed.  
To trigger manually: **Actions → Zillow Data Sync → Run workflow**.

### Demographics — Automatic (Serverless)
The `/api/co-demographics` endpoint refreshes automatically from the Census API.  
No manual action required.

### HUD Markets — Automatic (Serverless)
The `/api/hud-markets` endpoint refreshes automatically.  
No manual action required.

### CAR — Manual Workflow Trigger
See [CAR_DATA_PROCESS.md](./CAR_DATA_PROCESS.md) for step-by-step instructions.

### Census — Real-time API
Census data is fetched on page load via the serverless endpoint. No manual action required.

### FRED — Automatic (GitHub Actions)
The FRED data workflow runs daily at 06:00 UTC.  
To trigger manually: **Actions → Fetch FRED Data → Run workflow**.  
Requires `FRED_API_KEY` secret in repository settings.

---

## Setup Instructions

### Serverless Endpoints
Configure API URLs in `js/config.js` (or `js/config.local.js` for local development):

```javascript
window.APP_CONFIG = {
  AMI_GAP_API_URL:      "https://your-worker.example.com/api/co-ami-gap",
  HUD_MARKETS_API_URL:  "https://your-worker.example.com/api/hud-markets",
  DEMOGRAPHICS_API_URL: "https://your-worker.example.com/api/co-demographics",
  FRED_API_KEY:         "your_fred_api_key"
};
```

If these are not set, the integration module falls back to static JSON files in `data/`.

### GitHub Actions Secrets
For automated workflows, configure these in **Settings → Secrets and variables → Actions**:

| Secret | Required for |
|--------|-------------|
| `FRED_API_KEY` | FRED data workflow |

CAR data uses manual user input — no secrets required.

---

## Frontend Usage Examples

### Load all sources at once
```javascript
const hdi = window.HousingDataIntegration;
const all = await hdi.loadAllData();

console.log("CAR median price:", all.car?.statewide?.median_sale_price);
console.log("Sources loaded:",   all.metadata.sources);
console.log("Load errors:",      all.metadata.errors);
```

### Load a single source
```javascript
const car = await window.HousingDataIntegration.loadCARData();
if (car) {
  document.getElementById("carMedianPrice").textContent =
    "$" + car.statewide.median_sale_price.toLocaleString();
}
```

### Access cached data (no re-fetch)
```javascript
const cachedCensus = window.HousingDataIntegration.getCachedData("census");
```

---

## Data Freshness Indicators

The `loadAllData()` response includes `metadata`:

```javascript
{
  lastUpdated: Date,       // when loadAllData() was called
  loadTimeMs:  number,     // total fetch time in milliseconds
  sources:     string[],   // names of sources that loaded successfully
  errors:      [{ source, message }]  // sources that failed
}
```

Use `errors` to show actionable error messages to users when a source is unavailable.

---

## API Endpoints Reference

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/api/co-ami-gap` | GET | AMI gap analysis by county |
| `/api/hud-markets` | GET | HUD FMR and income limits |
| `/api/co-demographics` | GET | CO population and housing trends |

---

## Troubleshooting

### Data not loading in browser
1. Open browser DevTools → Console and look for `[HousingData]` warnings.
2. Check that `APP_CONFIG` URLs are set correctly in `js/config.js`.
3. Verify static fallback files exist in `data/` directory.

### CAR data file missing
Trigger the **Update CAR Market Data** workflow (see [CAR_DATA_PROCESS.md](./CAR_DATA_PROCESS.md)).

### FRED charts not loading
Confirm `FRED_API_KEY` secret is set in GitHub repository settings and the **Fetch FRED Data** workflow has run successfully.

### Stale Zillow data
Manually trigger the Zillow sync workflow from the **Actions** tab.
