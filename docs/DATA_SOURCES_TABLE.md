<!-- sync-banner:start -->
> **⚠️ Superseded** — See [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md) for the authoritative data source catalog.  
> *Auto-synced 2026-03-21 by `scripts/sync-docs.mjs` · 31 pages · 843 data files · 31 workflows*
<!-- sync-banner:end -->

# Data Sources — Status & Metadata

Last updated: 2026-03-15

> For the complete GIS reliability audit, see [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md).

This document describes every data file used by the site, where it comes
from, which CI workflow maintains it, whether it requires an API secret, and
its current status.

---

## Map Overlays (GIS Data)

| File | Records | Source API / Service | CI Workflow | Secret Required | Fallback Strategy | Status |
|------|---------|----------------------|-------------|-----------------|-------------------|--------|
| `data/chfa-lihtc.json` | **716** | CHFA ArcGIS FeatureServer (public) | `fetch-chfa-lihtc.yml` (Mon 05:00 UTC) + `deploy.yml` on every push | None — public API | 1. Local file → 2. CHFA ArcGIS → 3. HUD ArcGIS → 4. 14 embedded projects | ✅ 716 features |
| `data/qct-colorado.json` | **224** | HUD ArcGIS `Qualified_Census_Tracts_2026` (public) | `cache-hud-gis-data.yml` (Mon 04:00 UTC) | None — public API | Local file → live API → GitHub Pages backup → 27 embedded polygons | ✅ Populated |
| `data/dda-colorado.json` | **10** (Colorado county-level DDAs) | HUD ArcGIS `Difficult_Development_Areas_2026` (public), normalised by `scripts/normalize-dda.js` | `cache-hud-gis-data.yml` (Mon 04:00 UTC) | None — public API | Local file → live API → GitHub Pages backup → 10 embedded polygons | ✅ Populated |
| `data/hna/lihtc/*.json` | 64 files (one per CO county) | HUD ArcGIS `LIHTC_Properties` (public) | `generate-housing-data.yml` (Mon 06:00 UTC) | None — public API | County file → statewide `chfa-lihtc.json` → CHFA ArcGIS → HUD ArcGIS → embedded | ✅ 64 county files present |

### Notes on Map Overlay APIs
- All three HUD/CHFA ArcGIS FeatureServer endpoints are **publicly accessible** — no API key or auth header required.
- `data/chfa-lihtc.json` now contains **716 features** (fixed March 2026; see [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md) for details).
- `data/dda-colorado.json` contains only **county-level** DDAs (`DDA_CODE` starts with `NCNTY08`).  Metro-area DDAs (Denver-Aurora, Colorado Springs, etc.) are designated at the HUD Metro FMR Area level and are **not** represented as polygons in this file; the `CO_DDA` static lookup in `housing-needs-assessment.js` covers those counties with a status badge but no polygon overlay.

---

## Economic & Market Data

| File | Records | Source API / Service | CI Workflow | Secret Required | Update Frequency | Status |
|------|---------|----------------------|-------------|-----------------|-----------------|--------|
| `data/fred-data.json` | 45 FRED series (macro/housing) | FRED REST API (`api.stlouisfed.org`) | `fetch-fred-data.yml` (daily 06:00 UTC) | `FRED_API_KEY` (**required**) | Daily | ✅ Updated 2026-03-02 |
| `data/census-acs-state.json` | 52 states + DC (ACS 5-yr estimates) | Census API (`api.census.gov/data/{year}/acs/acs5`) | `fetch-census-acs.yml` (daily 06:30 UTC) | `CENSUS_API_KEY` (**required**) | Daily | ✅ Updated 2026-03-02 |
| `data/co_ami_gap_by_county.json` | 64 CO counties | Derived from ACS + HUD AMI data | `build-hna-data.yml` (Mon 06:30 UTC) | `CENSUS_API_KEY` | Weekly | ✅ Present |
| `data/allocations.json` | LIHTC state-level allocations | HUD LIHTC database (public) | `fetch-lihtc-data.yml` | None | Weekly | ✅ Present |
| `data/car-market-report-*.json` | CAR monthly market reports | Colorado Association of Realtors (manual/script) | `car-data-update.yml` (manual) | None | Monthly (manual trigger) | ✅ Feb + Mar 2026 present |
| `data/prop123_jurisdictions.json` | Colorado Prop 123 jurisdictions | CDOLA commitment-filings portal | None — manually maintained | None | Ad-hoc | ✅ Present (2025-01-15) |
| `data/kalshi/prediction-market.json` | Kalshi housing prediction markets | Kalshi REST API | `fetch-kalshi.yml` (weekly) | `KALSHI_API_KEY`, `KALSHI_API_SECRET` | Weekly | ✅ Present |

---

## Housing Needs Assessment (HNA) Cache

These files are pre-computed and stored under `data/hna/` to make the Housing Needs Assessment
page load quickly without hitting live APIs for every page view.

| Directory / File | Records | Source | CI Workflow | Secret Required | Status |
|------------------|---------|--------|-------------|-----------------|--------|
| `data/hna/summary/{geoid}.json` | 544 files (all CO counties + places) | ACS 5-yr + LEHD + DOLA | `build-hna-data.yml` (Mon 06:30 UTC) | `CENSUS_API_KEY` | ✅ 544 files |
| `data/hna/lihtc/{countyFips5}.json` | 64 files (one per CO county) | HUD ArcGIS LIHTC | `generate-housing-data.yml` (Mon 06:00 UTC) | None | ✅ 64 files |
| `data/hna/lehd/{geoid}.json` | 64 files | LEHD/LODES (Census Bureau) | `build-hna-data.yml` | None — public | ✅ 64 files |
| `data/hna/projections/{countyFips5}.json` | CO county population projections | DOLA State Demographer | `build-hna-data.yml` | None | ✅ Present |
| `data/hna/dola_sya/{countyFips5}.json` | CO county single-year age data | DOLA SDO | `build-hna-data.yml` | None | ✅ Present |
| `data/hna/geo-config.json` | All CO geographies (counties + places) | TIGERweb / Census | `build-hna-data.yml` | `CENSUS_API_KEY` | ✅ Present |

---

## GitHub Actions Secrets Required

| Secret | Used By | Required? | Notes |
|--------|---------|-----------|-------|
| `CENSUS_API_KEY` | `build-hna-data.yml`, `fetch-census-acs.yml`, `deploy.yml` | **Yes** | Free key from api.census.gov/data/key_signup.html |
| `FRED_API_KEY` | `fetch-fred-data.yml` | **Yes** | Free key from fred.stlouisfed.org/docs/api/api_key.html |
| `KALSHI_API_KEY` | `fetch-kalshi.yml` | No (graceful fallback) | Kalshi access-key ID |
| `KALSHI_API_SECRET` | `fetch-kalshi.yml` | No (graceful fallback) | RSA private key in PEM format |

> **HUD ArcGIS services** (`services.arcgis.com/VTyQ9soqVukalItT/…`) are **public** — no secret needed for QCT, DDA, or LIHTC overlays.

> **GitHub Pages deployment** uses the built-in `GITHUB_TOKEN` (auto-provided) — no manual configuration required.

---

## Local Data Creation Status

| Data File | Local Creation Working? | Redundancy / Notes |
|-----------|------------------------|--------------------|
| `data/chfa-lihtc.json` | ✅ **Working** — 716 features | Fixed March 2026. Front-end loads local file first; falls back to CHFA/HUD ArcGIS APIs then 14 embedded projects. |
| `data/qct-colorado.json` | ✅ **Working** — 224 features | Created weekly by `cache-hud-gis-data.yml`. Front-end loads local file first; falls back to live HUD ArcGIS API. |
| `data/dda-colorado.json` | ✅ **Working** — 10 county-level features | Created weekly by `cache-hud-gis-data.yml` + `normalize-dda.js`. Metro DDAs not represented as polygons; handled by static `CO_DDA` lookup. |
| `data/fred-data.json` | ✅ **Working** — requires `FRED_API_KEY` secret | 45 macro/housing FRED series; updated daily. |
| `data/census-acs-state.json` | ✅ **Working** — requires `CENSUS_API_KEY` secret | 52-state ACS 5-yr snapshot; updated daily. |
| `data/hna/summary/*.json` | ✅ **Working** — 544 files | Requires `CENSUS_API_KEY`. Updated weekly by `build-hna-data.yml`. |
| `data/hna/lihtc/*.json` | ✅ **Working** — 64 county files | No secret needed. Updated weekly by `generate-housing-data.yml`. |
| `data/prop123_jurisdictions.json` | ✅ **Present** — manually maintained | No CI automation; update manually from CDOLA. |
| `data/kalshi/*.json` | ✅ **Working** — requires Kalshi secrets | Graceful fallback to demo data if secrets absent. |

---

## Timeout Configuration (Frontend)

All front-end data fetches use an `AbortController`-based `fetchWithTimeout()` helper.

| Fetch Type | File | Previous Timeout | Current Timeout | Reason for Change |
|-----------|------|-----------------|-----------------|-------------------|
| Local JSON files (QCT/DDA) | `co-lihtc-map.js` | 5 s (was part of LIHTC fetch) | **8 s** | Static files should load quickly; increased for slow GitHub Pages CDN |
| LIHTC local file | `co-lihtc-map.js` | 5 s | **8 s** | Increased to handle CDN latency |
| CHFA ArcGIS remote | `co-lihtc-map.js` | 8 s | **15 s** | GIS services can be slow to cold-start |
| HUD ArcGIS remote | `co-lihtc-map.js` | 8 s | **15 s** | GIS services can be slow to cold-start |
| CHFA LIHTC remote | `housing-needs-assessment.js` | 8 s | **15 s** | GIS services can be slow to cold-start |
| HUD LIHTC remote | `housing-needs-assessment.js` | 8 s | **15 s** | GIS services can be slow to cold-start |
| QCT ArcGIS remote | `housing-needs-assessment.js` | **5 s** | **15 s** | 5 s too short for national GIS service |
| DDA ArcGIS remote | `housing-needs-assessment.js` | **5 s** | **15 s** | 5 s too short for national GIS service |
| loadJson (HNA cache) | `housing-needs-assessment.js` | 10 s | 10 s | No change — appropriate for JSON files |

---

## API Endpoint Reference

| Service | URL | Auth | Used By |
|---------|-----|------|---------|
| CHFA LIHTC ArcGIS | `https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer/0` | None (public) | `scripts/fetch-chfa-lihtc.js`, `co-lihtc-map.js`, `housing-needs-assessment.js` |
| HUD LIHTC ArcGIS | `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0` | None (public) | `co-lihtc-map.js`, `housing-needs-assessment.js`, `generate-housing-data.yml` |
| HUD QCT 2026 | `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/QCT_2026/FeatureServer/0` | None (public) | `housing-needs-assessment.js` (live fallback) |
| HUD QCT (cache workflow) | `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Qualified_Census_Tracts_2026/FeatureServer/0` | None (public) | `cache-hud-gis-data.yml` |
| HUD DDA 2026 | `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/DDA_2026/FeatureServer/0` | None (public) | `housing-needs-assessment.js` (live fallback) |
| HUD DDA (cache workflow) | `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas_2026/FeatureServer/0` | None (public) | `cache-hud-gis-data.yml` |
| FRED API | `https://api.stlouisfed.org/fred/series/observations` | `FRED_API_KEY` secret | `fetch-fred-data.yml` |
| Census ACS API | `https://api.census.gov/data/{year}/acs/acs5` | `CENSUS_API_KEY` secret | `build-hna-data.yml`, `fetch-census-acs.yml` |
| Census TIGERweb | `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer` | None (public) | `housing-needs-assessment.js` (boundary fetch) |
| Kalshi Trading API | `https://trading-api.kalshi.com/trade-api/v2` | `KALSHI_API_KEY` + `KALSHI_API_SECRET` | `fetch-kalshi.yml` |

> **Note:** The `QCT_2026` and `DDA_2026` service names in `housing-needs-assessment.js` and the `Qualified_Census_Tracts_2026` / `Difficult_Development_Areas_2026` names in `cache-hud-gis-data.yml` refer to the same HUD datasets.  Update the year suffix annually when HUD publishes the next designation cycle (typically announced ~September/October for the following January effective date).
