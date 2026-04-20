<!-- sync-banner:start -->
> **⚠️ Superseded** — See [`GIS_DATA_MODEL.md`](GIS_DATA_MODEL.md) for the authoritative data architecture reference. Also see [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md).  
> *Auto-synced 2026-04-20 by `scripts/sync-docs.mjs` · 38 pages · 884 data files · 36 workflows*
<!-- sync-banner:end -->

> **Note:** For the authoritative data architecture and GIS model, see [`GIS_DATA_MODEL.md`](GIS_DATA_MODEL.md) and [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md).

# Data Architecture

This document describes the data pipeline, APIs, build scripts, cached JSON files, and visualization layer for the Housing Analytics platform.

---

## Overview

The platform follows a **build-cache-serve** pattern:

1. **Data ingestion scripts** (`scripts/`) fetch data from external APIs (Census, HUD, FRED, etc.)
2. **Build scripts** transform raw data into structured JSON caches (`data/`)
3. **JavaScript modules** (`js/`) read the cached JSON and render interactive visualizations

This design avoids runtime API dependency and ensures fast page loads even when upstream APIs are unavailable.

---

## Directory Structure

```
Housing-Analytics/
├── data/                        # Cached JSON datasets (served statically)
│   ├── alerts/                  # News alert archive (from fetch_google_alerts.py)
│   ├── boundaries/              # County and census boundary GeoJSON
│   ├── hna/                     # Housing Needs Assessment data
│   │   ├── dola_sya/            # DOLA Single-Year-of-Age population pyramids
│   │   ├── lehd/                # LEHD LODES employment & commute data
│   │   ├── projections/         # 20-year demographic projection outputs
│   │   └── summary/             # ACS profile + commuting summaries by geography
│   ├── market/                  # Market analysis datasets
│   │   ├── acs_tract_metrics_co.json   # ACS census tract metrics (≥500 tracts)
│   │   ├── hud_lihtc_co.geojson        # HUD LIHTC projects in Colorado (≥100)
│   │   ├── tract_centroids_co.json     # Census tract centroids (≥500)
│   │   ├── reference-projects.json    # Benchmark LIHTC project data
│   │   ├── fmr_co.json                # HUD Fair Market Rents (from fetch_fmr_api.py)
│   │   ├── chas_co.json               # HUD CHAS data (from fetch_chas.py)
│   │   ├── nhpd_co.geojson            # NHPD properties (from fetch_nhpd.py)
│   │   └── hud_egis_co.geojson        # HUD eGIS data (from fetch_hud_egis.py)
│   └── policy/                  # Policy reference data
│       └── prop123_jurisdictions.json # Proposition 123 jurisdictions
├── js/                          # Browser JavaScript modules
├── css/                         # Stylesheets
├── scripts/                     # Build and ingestion scripts
└── docs/                        # Technical documentation (this directory)
```

---

## External APIs

### U.S. Census Bureau
- **ACS 1-Year and 5-Year Profile Tables** (`acs/acs1/profile`, `acs/acs5/profile`)
  - Used for: population, income, housing tenure, rent burden, housing units
  - Key tables: DP02, DP03, DP04, DP05
- **ACS Subject Table S0801** – Commuting characteristics by sex
- **ACS Table B08301** – Means of transportation to work (drive, transit, walk, bike, WFH)
- **TIGERweb ArcGIS REST** – County and place boundary geometries
  - `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query`

### HUD (U.S. Department of Housing and Urban Development)
- **HUD LIHTC Database** (via ArcGIS FeatureServer)
  - `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer`
- **HUD Fair Market Rents API**
  - `https://www.huduser.gov/hudapi/public/fmr/statedata/CO`
- **HUD eGIS Public Housing Authorities**
  - `https://egis.hud.gov/arcgis/rest/services/eGIS/Public_Housing_Authorities/FeatureServer`
- **HUD CHAS Data** (downloadable ZIP)
  - `https://www.huduser.gov/portal/datasets/cp.html`
- **HUD QCT/DDA** – Qualified Census Tracts and Difficult Development Areas

### FRED (Federal Reserve Bank of St. Louis)
- Economic time series: CPI, unemployment, housing permits, mortgage rates
- `https://fred.stlouisfed.org/graph/fredgraph.csv`

### DOLA (Colorado Department of Local Affairs)
- Single-Year-of-Age (SYA) population data for Colorado counties
- `https://demography.dola.colorado.gov/`

### LEHD (Longitudinal Employer-Household Dynamics)
- LODES8 Origin-Destination (OD) files for commute flows
- `https://lehd.ces.census.gov/data/lodes/LODES8/co/`

### NHPD (National Housing Preservation Database)
- Affordable housing properties across the country
- `https://preservationdatabase.org/`

### CAR (Colorado Association of Realtors)
- Monthly market reports: median sale price, active listings, days on market
- Fetched via `scripts/fetch-car-data.js`

---

## Build Scripts

| Script | Purpose | Output |
|--------|---------|--------|
| `scripts/hna/build_hna_data.py` | ACS + LEHD + DOLA data for HNA | `data/hna/summary/*.json`, `data/hna/lehd/*.json` |
| `scripts/market/build_public_market_data.py` | Census tract metrics + LIHTC | `data/market/acs_tract_metrics_co.json`, `data/market/hud_lihtc_co.geojson` |
| `scripts/fetch_hud_egis.py` | HUD eGIS public housing data | `data/market/hud_egis_co.geojson` |
| `scripts/fetch_fmr_api.py` | HUD Fair Market Rents | `data/market/fmr_co.json` |
| `scripts/fetch_chas.py` | HUD CHAS affordability data | `data/market/chas_co.json` |
| `scripts/fetch_nhpd.py` | NHPD preservation data | `data/market/nhpd_co.geojson` |
| `scripts/fetch_google_alerts.py` | News RSS feed aggregation | `data/alerts/alerts_archive.json` |
| `scripts/generate_policy_briefs.py` | AI policy brief generation | `data/policy_briefs.json` |
| `scripts/fetch-car-data.js` | CAR monthly market reports | `data/car-market-report-*.json` |
| `scripts/fetch-chfa-lihtc.js` | CHFA LIHTC portfolio | `data/chfa-lihtc.json` |
| `scripts/rebuild_manifest.py` | Regenerate data manifest | `data/manifest.json` |

---

## CI/CD Workflows

Workflows live in `.github/workflows/`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci-checks.yml` | Push / PR | Validates required files, JSON validity, no raw fetch paths |
| `build-hna-data.yml` | Manual / Schedule | Runs `build_hna_data.py` |
| `market_data_build.yml` | Manual / Schedule | Runs `build_public_market_data.py` |
| `fetch-fred-data.yml` | Schedule | Updates FRED economic data |
| `cache-hud-gis-data.yml` | Schedule | Caches HUD/Esri GIS responses |
| `fetch-car-data.js` workflow | Schedule | Downloads CAR market reports |
| `deploy.yml` | Push to main | Deploys to GitHub Pages |

---

## Visualization Layer

### JavaScript Modules

| Module | Purpose |
|--------|---------|
| `js/co-lihtc-map.js` | Leaflet map: LIHTC projects, DDA/QCT overlays, county boundaries |
| `js/housing-needs-assessment.js` | HNA dashboard: ACS profile, LEHD, projections |
| `js/market-analysis.js` | PMA scoring and tract-level market analysis |
| `js/market-intelligence.js` | Market intelligence dashboard |
| `js/navigation.js` | Site-wide header, footer, mobile menu, runtime error panel |
| `js/data-service-portable.js` | Base-path-aware JSON/GeoJSON fetcher |
| `js/path-resolver.js` | GitHub Pages sub-path detection (`APP_BASE_PATH`) |
| `js/fetch-helper.js` | `fetchWithTimeout` with retry and exponential backoff |
| `js/cache-manager.js` | 1-hour localStorage cache with in-memory fallback |

### Key Design Rules

1. **No raw fetch calls to `data/` paths** — always use `DataService.getJSON()` or `resolveAssetUrl()`
   so URLs work on GitHub Pages sub-paths and custom domains.
2. **FIPS codes are always 5-digit strings** — `str(fips).zfill(5)` in Python, `.padStart(5, '0')` in JS.
3. **ArcGIS queries must include `outSR=4326`** — otherwise coordinates default to Web Mercator.
4. **ETL outputs must preserve sentinel metadata keys** — `updated`, `fetchedAt`, `meta.generated`.
5. **Colorado county coverage = exactly 64 counties** for any statewide dataset.

---

## Data Freshness

| Dataset | Update Frequency | Automation |
|---------|-----------------|------------|
| ACS Census data | Annual (autumn release) | `build-hna-data.yml` |
| HUD LIHTC | Annual | `cache-hud-gis-data.yml` |
| FRED economic | Monthly | `fetch-fred-data.yml` |
| CAR market reports | Monthly | `fetch-car-data` workflow |
| DOLA population | Annual | `build-hna-data.yml` |
| News alerts | Daily | `fetch_google_alerts.py` |
| Policy briefs | Daily | `generate_policy_briefs.py` |

---

## Data Validation

Run `node scripts/validate-critical-data.js` to check that all critical data files exist and meet minimum feature thresholds:

- County boundaries: ≥64 features
- QCT/DDA: ≥1 feature each
- ACS tract metrics: ≥500 records (warn if sparse)
- Tract centroids: ≥500 records (warn if sparse)
- HUD LIHTC: ≥100 features (warn if sparse)

---

## Adding a New Data Source

1. Create a fetch script in `scripts/` following the naming convention `fetch_<source>.py` or `fetch-<source>.js`
2. Write output to `data/<category>/<name>.json` or `.geojson`
3. Include a `meta` object with `source`, `generated` (ISO-8601), and `methodology` fields
4. Add a corresponding GitHub Actions workflow in `.github/workflows/`
5. Add the file to the CI checks in `.github/workflows/ci-checks.yml`
6. Run `python3 scripts/rebuild_manifest.py` to update `data/manifest.json`
