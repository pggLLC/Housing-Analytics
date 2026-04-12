# PMA Data Sources — Complete Phase 3 Reference

> **Version:** Phase 3 · **Updated:** 2026-03-26  
> This document is the authoritative reference for all data sources used in the COHO Analytics Platform Market Analysis (PMA) pipeline, including endpoints, field definitions, refresh schedules, and known limitations.

---

## Overview

The PMA pipeline ingests data from seven core categories plus eight Phase 3 bulk datasets:

| # | Category | Primary Source | Refresh |
|---|---|---|---|
| 1 | Demographics & Housing | Census ACS 5-Year | Annual (Dec) |
| 2 | Income Limits / FMR | HUD | Annual (Apr) |
| 3 | LIHTC Portfolio | CHFA / HUD LIHTC | Monthly |
| 4 | QCT/DDA Designations | HUD GIS | Annual |
| 5 | Economic Indicators | FRED (St. Louis Fed) | Daily |
| 6 | Cost Burden (CHAS) | HUD CHAS | Every 2–3 years |
| 7 | Preservation / NHPD | NHPD | Quarterly |
| 8a–8i | Bulk Market Data (Phase 3) | EPA/USDA/FEMA/LODES/DOLA/NOAA | On demand |

---

## 1. Census ACS 5-Year Estimates

**Endpoint:** `https://api.census.gov/data/{year}/acs/acs5`  
**Secret required:** `CENSUS_API_KEY`  
**Output:** `data/acs/` (per-county, per-geography JSON files)  
**Workflow:** `fetch-acs-data.yml` (scheduled)

### Key Variables

| Variable | Description |
|---|---|
| `B25064_001E` | Median gross rent |
| `B25003_002E` | Owner-occupied units |
| `B25003_003E` | Renter-occupied units |
| `B19013_001E` | Median household income |
| `B01003_001E` | Total population |
| `B25070_001E` | Gross rent as % of income (cost burden base) |

### Notes

- ACS 5-year geography coverage: state, county, census tract, place (incorporated), CDP
- Colorado state FIPS: `08`; county FIPS: `08001`–`08125` (5-digit, zero-padded per Rule 1)
- All county FIPS codes must be 5-digit strings; use `.padStart(5, '0')` in JS or `str(fips).zfill(5)` in Python

---

## 2. HUD Fair Market Rents & Income Limits

**Endpoint:** `https://www.huduser.gov/hudapi/public/fmr/statedata/{state_code}`  
**Secret required:** `HUD_API_TOKEN`  
**Output:** `data/hud-fmr-income-limits.json` (64 counties, FY2025)  
**Workflow:** `fetch-fmr-data.yml`  
**JS module:** `js/data-connectors/hud-fmr.js` (`window.HudFmr`)

### Fields

| Field | Description |
|---|---|
| `fips` | 5-digit county FIPS |
| `county_name` | Human-readable county name |
| `fmr_0br`–`fmr_4br` | Fair Market Rent by bedroom count |
| `il_30pct`–`il_80pct` | Income limit at 30/50/60/80% AMI |
| `ami_4person` | Area Median Income for 4-person household |

### Notes

- `ami_4person` must never be null (used as denominator in affordability ratio — Rule 2)

---

## 3. LIHTC Portfolio (CHFA + HUD)

**Primary:** `data/chfa-lihtc.json` (GeoJSON FeatureCollection)  
**Secondary:** `data/co-lihtc.json`  
**Workflow:** `fetch-chfa-lihtc.yml` (Monday 05:00 UTC)  
**JS module:** `js/data-connectors/hud-lihtc.js`

### Sentinel Keys (Rule 18)

- `fetchedAt` — ISO-8601 UTC timestamp; must be preserved across schema migrations

### Fields

| Field | Description |
|---|---|
| `CNTY_FIPS` | 5-digit county FIPS |
| `LI_UNITS` | Low-income units (must not exceed `N_UNITS` — Rule 2) |
| `N_UNITS` | Total units |
| `CREDIT` | Tax credit type (4% / 9%) |
| `NON_PROF` | Nonprofit set-aside flag |
| `DDA` | Difficult Development Area flag |

---

## 4. QCT / DDA Designations

**Source:** HUD GIS Open Data  
**Raw output:** `data/market/qct_dda_designations_co.json`  
**Normalized:** `data/market/qct_dda_designations_co_normalized.json`  
**Fetch script:** `scripts/market/fetch_qct_dda.py`  
**Normalize script:** `scripts/market/normalize_qct_dda_co.py`  
**Validate script:** `scripts/market/validate_qct_dda_co.py`  
**Workflow:** `cache-hud-gis-data.yml` (Monday 04:00 UTC)

### Raw Structure

```json
{
  "meta": { "designation_year": 2025, "generated": "…", … },
  "designations": [
    { "geoid": "08013950100", "type": "QCT", "county_fips": "08013", "year": 2025 }
  ]
}
```

### Normalized Structure

```json
{
  "meta": { …, "normalized_at": "…", "tract_count": 150 },
  "counties": {
    "08013": { "fips": "08013", "qct_tracts": ["08013950100"], "dda_tracts": [], "is_dda": false }
  },
  "tracts": [
    { "geoid": "08013950100", "county_fips": "08013", "designation": "QCT", "is_qct": true, "is_dda": false }
  ]
}
```

### FIPS Requirements (Rule 1)

- `geoid`: 11-digit census tract GEOID (zero-padded)
- `county_fips`: 5-digit county FIPS
- `state_fips`: 2-digit state FIPS (`"08"`)

---

## 5. FRED Economic Indicators

**Source:** Federal Reserve Bank of St. Louis FRED API  
**Secret required:** `FRED_API_KEY`  
**Output:** `data/fred-data.json`  
**Workflow:** `fetch-fred-data.yml` (daily 06:00 UTC)

### Sentinel Keys (Rule 18)

- `updated` — ISO-8601 UTC timestamp; must be preserved across schema migrations

### National Series

| Series ID | Description |
|---|---|
| `CPIAUCSL` | CPI (All Urban Consumers) |
| `UNRATE` | Unemployment Rate |
| `HOUST` | Housing Starts |
| `HOUST5F` | Multifamily Starts (5+ units) |
| `MORTGAGE30US` | 30-Year Fixed Mortgage Rate |
| `RRVRUSQ156N` | Rental Vacancy Rate |

### Colorado-Specific Series (added Phase 3)

| Series ID | Description |
|---|---|
| `COUR08000000000000006` | Colorado Unemployment Rate |
| `COCONS` | Colorado Construction Employment |
| `COPOP` | Colorado Population |
| `MEHOUCO` | Colorado Median Household Income |
| `COAHOMIDX` | Colorado Home Price Index (FHFA) |
| `COBP` | Colorado Building Permits |

### Temporal Continuity (Rule 7)

- Monthly series must have no gap exceeding 35 days
- Any series arriving empty must trigger an alert (not be silently stored)
- All series objects must include a non-empty `name` field (Rule 6)

---

## 6. HUD CHAS (Cost Burden)

**Source:** HUD Comprehensive Housing Affordability Strategy  
**Output:** `data/hna/chas_affordability_gap.json`  
**Fetch script:** `scripts/fetch_chas.py`  
**Workflow:** `fetch-chas-data.yml` (Monday 03:00 UTC)

### Key Fields

| Field | Description |
|---|---|
| `T1_est29` | Renter households 30–50% AMI, cost-burdened (`mod_burdened` key) |
| `T1_est52` | Renter households 50–80% AMI, cost-burdened |

---

## 7. Preservation / NHPD

**Source:** National Housing Preservation Database  
**Output:** `data/market/nhpd_co.geojson`  
**Fetch script:** `scripts/fetch_nhpd.py`  
**JS module:** `js/data-connectors/nhpd.js` (CacheManager 6hr TTL)

---

## 8. Phase 3 Bulk Market Data Sources (April 2026)

The following Colorado-specific datasets are pre-fetched by scripts in `scripts/market/` and loaded locally by `js/data-service-portable.js` (local-first pattern — no live API calls at page load).

| # | Dataset | Source | Output File | Records | Fetch Script |
|---|---|---|---|---|---|
| 8a | EPA Smart Location Database | EPA ArcGIS MapServer | `data/market/epa_sld_co.json` | ~3,500 block groups | `fetch_epa_sld.py` |
| 8b | USDA Food Access Atlas | USDA ERS | `data/market/food_access_co.json` | ~1,200 tracts | `fetch_food_access.py` |
| 8c | FEMA Flood Zones | FEMA NFHL ArcGIS | `data/market/flood_zones_co.json` | ~1,600 tracts | `fetch_fema_nfhl.py` |
| 8d | LODES Commuting | Census LEHD LODES 8.x | `data/market/lodes_co.json` | ~1,400 tracts | `fetch_lodes.py` |
| 8e | Opportunity Insights | Harvard/Brown | `data/market/opportunity_insights_co.json` | ~1,200 tracts | `fetch_opportunity_insights.py` |
| 8f | DOLA Demographics | Colorado DOLA API | `data/market/dola_demographics_co.json` | 64 counties | `fetch_dola.py` |
| 8g | Climate Hazards | NOAA/EPA EJI/CWCB | `data/market/climate_hazards_co.json` | 6 hazard categories + EJI tracts | `fetch_climate_and_environment.py` |
| 8h | Utility Service Areas | CDSS/DWR/DOLA | `data/market/utility_capacity_co.geojson` | GeoJSON features | `fetch_utility_capacity.py` |
| 8i | Environmental Constraints | CPW Protected Lands | `data/market/environmental_constraints_co.geojson` | GeoJSON features | `fetch_climate_and_environment.py` |

### Data Loading Pattern

All Phase 3 data uses the **local-first** pattern in `data-service-portable.js`:
1. Load pre-fetched JSON from `data/market/` (zero CORS issues, works offline)
2. If local data is empty/missing, fall back to live API query (where available)
3. Return `_stub: true` with `_dataSource` metadata when data is unavailable
4. All functions return Promises for consistent async API

### Rebuild Command

```bash
python3 scripts/market/build_public_market_data.py
```

Or individually:
```bash
python3 scripts/market/fetch_epa_sld.py
python3 scripts/market/fetch_food_access.py
python3 scripts/market/fetch_fema_nfhl.py
python3 scripts/market/fetch_lodes.py
python3 scripts/market/fetch_opportunity_insights.py
python3 scripts/market/fetch_dola.py
python3 scripts/market/fetch_climate_and_environment.py
python3 scripts/market/fetch_utility_capacity.py
```

---

## Data Quality Checks

Run `python3 scripts/market/validate_qct_dda_co.py` to validate QCT/DDA output.

Run `node scripts/validate-schemas.js` for comprehensive artifact validation (includes all Phase 3 market data).

Run `node test/data-quality-check.test.js` for end-to-end data quality tests.

All data files must include their sentinel `generated`/`fetchedAt`/`updated` timestamps (Rule 18).

---

## Endpoint Allowlist

The following external endpoints must be accessible in CI/CD:

| Domain | Purpose |
|---|---|
| `api.census.gov` | ACS data fetch |
| `api.stlouisfed.org` | FRED series fetch |
| `www.huduser.gov` | HUD FMR/income limits |
| `services.arcgis.com` | HUD GIS QCT/DDA layer |
| `services1.arcgis.com` | CHFA LIHTC ArcGIS |
| `data.denvergov.org` | Local Denver open data (PR #422) |
| `tigerweb.geo.census.gov` | TIGERweb boundaries |
| `geodata.epa.gov` | EPA Smart Location Database |
| `hazards.fema.gov` | FEMA NFHL flood data |
| `lehd.ces.census.gov` | LODES commuting data |
| `data2.nhgis.org` | Opportunity Insights tract data |
| `gis.dola.colorado.gov` | DOLA demographics API |
| `www.ncdc.noaa.gov` | NOAA climate data (optional token) |

See `.github/COPILOT_ALLOWLIST` for firewall configuration notes.
