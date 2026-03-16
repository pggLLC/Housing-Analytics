# Site Audit & GIS Reliability — Housing Analytics

*Last updated: 2026-03-06 (revised after fixes)*

---

## 1. Complete Page Inventory (23 HTML files)

| Page | Title | Map? | Primary JS | Local Data Sources | External APIs | Key Failure Modes | Priority |
|---|---|---|---|---|---|---|---|
| `index.html` | COHO Analytics | — | `main.js`, `navigation.js` | `data/fred-data.json` | FRED | Missing `fred-data.json`, stale cache | High |
| `colorado-deep-dive.html` | Colorado Deep Dive | ✅ Leaflet | `co-lihtc-map.js`, `prop123-map.js`, `colorado-deep-dive.js` | `data/chfa-lihtc.json`, `data/qct-colorado.json`, `data/dda-colorado.json`, `data/prop123_jurisdictions.json`, `data/co-county-boundaries.json` | CHFA ArcGIS, HUD ArcGIS, TIGERweb | County boundaries placeholder (0 features); TIGERweb response now cached 24h | **Critical** |
| `LIHTC-dashboard.html` | LIHTC Allocations Dashboard | ✅ D3 SVG | `state-allocations-2026.js`, `state-allocations-2025.js`, `state-allocations-2024.js` | `data/states-10m.json`, `data/allocations.json`, `data/chfa-lihtc.json` | CHFA ArcGIS, HUD ArcGIS | `states-10m.json` fetch error (has CDN fallback) | High |
| `state-allocation-map.html` | 2026 LIHTC by State | ✅ D3 SVG | `state-allocations-2026.js` | `data/states-10m.json`, `data/allocations.json` | cdn.jsdelivr.net (fallback) | `states-10m.json` missing (CDN fallback in place) | High |
| `economic-dashboard.html` | Economic Dashboard | — | `fred-cards.js`, `fred-kpi-cards.js`, `census-stats.js` | `data/fred-data.json` | FRED | Stale `fred-data.json`; 5 series without observations | Medium |
| `colorado-market.html` | Colorado LIHTC Market Analysis | — | `colorado-map-data.js`, `co-ami-gap.js` | `data/co-county-demographics.json`, `data/co-county-economic-indicators.json`, `data/co_ami_gap_by_county.json` | Census ACS (refresh) | ACS API timeout on manual refresh | Medium |
| `housing-needs-assessment.html` | Housing Needs Assessment | ✅ Leaflet | `housing-needs-assessment.js`, `hna-export.js`, `prop123-historical-tracker.js` | `data/hna/summary/*.json`, `data/hna/lehd/*.json`, `data/hna/dola_sya/*.json`, `data/hna/projections/*.json`, `data/hna/geo-config.json`, `data/hna/local-resources.json` | TIGERweb, Census ACS | HNA projection errors; TIGERweb county boundary (TIGERweb mocked in CI) | Medium |
| `market-analysis.html` | Market Analysis (PMA Scoring) | ✅ Leaflet | `market-analysis.js` | `data/co-county-boundaries.json`, `data/qct-colorado.json`, `data/dda-colorado.json`, `data/prop123_jurisdictions.json`, `data/market/tract_centroids_co.json`, `data/market/acs_tract_metrics_co.json`, `data/market/hud_lihtc_co.geojson` | TIGERweb (tracts) | `hud_lihtc_co.geojson` has only 10 placeholder features; `co-county-boundaries.json` is empty (fallback: TIGERweb) | Medium |
| `market-intelligence.html` | Market Intelligence | — | `market-intelligence.js` | `data/census-acs-state.json`, `data/fred-data.json` | Census ACS, FRED | ACS timeout; uses cached state-level ACS | Medium |
| `regional.html` | Regional Analysis | — | `regional.js` | `data/fred-data.json`, `data/census-acs-state.json` | FRED, Census | API timeout | Low |
| `dashboard.html` | LIHTC Market Dashboard | — | `dashboard.js` | `data/fred-data.json`, `data/chfa-lihtc.json` | FRED | Stale FRED cache | Low |
| `compliance-dashboard.html` | Compliance Dashboard | — | `prop123-historical-tracker.js` | `data/prop123_jurisdictions.json`, `data/policy/prop123_jurisdictions.json` | — | None (fully offline) | Low |
| `census-dashboard.html` | Census Data | — | `census-stats.js` | `data/census-acs-state.json` | Census ACS | ACS API rate limit | Low |
| `chfa-portfolio.html` | CHFA Multifamily Portfolio | — | `co-lihtc-map.js` (portfolio mode) | `data/chfa-lihtc.json` | CHFA ArcGIS (fallback) | CHFA ArcGIS timeout (has local fallback) | Low |
| `construction-commodities.html` | Construction Commodities Forecast | — | `fred-construction-commodities.js`, `fred-commodities.js` | `data/fred-data.json` | FRED | Stale FRED cache; missing PPI series | Low |
| `cra-expansion-analysis.html` | CRA Expansion Analysis | — | `cra-expansion-forecast.js` | `data/fred-data.json` | FRED | Stale FRED cache | Low |
| `housing-legislation-2026.html` | Housing for the 21st Century Act | — | — | — | — | Static page, no dynamic data | None |
| `insights.html` | Market Insights | — | `trend-analysis.js` | `data/fred-data.json`, `data/market/` | FRED | Stale cache | Low |
| `lihtc-enhancement-ahcia.html` | AHCIA LIHTC Enhancement | — | — | — | — | Static article | None |
| `lihtc-guide-for-stakeholders.html` | LIHTC Basics | — | — | — | — | Static article | None |
| `article-pricing.html` | Tax Credit Pricing Article | — | — | `data/fred-data.json` | — | Stale FRED cache | Low |
| `about.html` | About | — | — | — | — | Static, no dynamic data | None |
| `privacy-policy.html` | Privacy Policy | — | — | — | — | Static, no dynamic data | None |

---

## 2. Map Pages — Detailed GIS Inventory

### 2.1 `colorado-deep-dive.html` — Primary Colorado Map

| Layer | Container | Source | Feature Count | Geographic Extent | Status |
|---|---|---|---|---|---|
| LIHTC Projects (CHFA) | `#coMap` | `data/chfa-lihtc.json` (local) → CHFA ArcGIS → HUD ArcGIS → embedded stub | **716 features** (Point) | Colorado statewide, 94 cities | ✅ Fixed — CNTY_NAME now populated from CNTY_FIPS reverse lookup |
| QCT Overlay | `#coMap` | `data/qct-colorado.json` (local) → HUD ArcGIS fallback | **224 features** (Polygon) | 31 CO counties | ✅ Good |
| DDA Overlay | `#coMap` | `data/dda-colorado.json` (local) → HUD ArcGIS fallback | **10 features** (Polygon) | CO metro/zip areas | ✅ Good |
| Prop 123 Jurisdictions | `#coMap` | `data/prop123_jurisdictions.json` | **80 jurisdictions** | Colorado municipalities & counties | ✅ Good |
| County Boundaries | `#coMap` | `data/co-county-boundaries.json` → TIGERweb (24h cached) → NaturalEarth → FALLBACK_COUNTY | **0 features** (placeholder) | Expected 64 CO counties | ⚠️ Empty — TIGERweb fallback works; now cached 24h in localStorage |

**Map initialization:** `co-lihtc-map.js` uses `window.coLihtcMap`; Leaflet loaded from `js/vendor/leaflet.js`.

### 2.2 `state-allocation-map.html` — National LIHTC Allocation Map

| Layer | Container | Source | Feature Count | Geographic Extent | Status |
|---|---|---|---|---|---|
| State Choropleth | D3 SVG | `data/states-10m.json` → cdn.jsdelivr.net fallback | **51 states + DC** (TopoJSON) | National | ✅ Good (CDN fallback) |
| Allocation Data | D3 circles | `data/allocations.json` (JS embed `StateAllocations2026`) | **51 entries** | National | ✅ Good |

**Rendering:** D3 v7 + TopoJSON v3; no Leaflet dependency.

### 2.3 `LIHTC-dashboard.html` — LIHTC Multi-Year Dashboard

| Layer | Container | Source | Feature Count | Geographic Extent | Status |
|---|---|---|---|---|---|
| State Map (2024/2025/2026) | D3 SVG | `data/states-10m.json` → two CDN fallbacks | **51 states + DC** | National | ✅ Good (two CDN fallbacks) |
| Allocation Data (3 years) | D3 | `state-allocations-2024.js`, `state-allocations-2025.js`, `state-allocations-2026.js` | **51 per year** | National | ✅ Good |
| CHFA LIHTC (CO detail) | Charts | `data/chfa-lihtc.json` → CHFA ArcGIS fallback | **716 features** | Colorado | ⚠️ CNTY_FIPS null for all records |

### 2.4 `housing-needs-assessment.html` — HNA with Map

| Layer | Container | Source | Feature Count | Geographic Extent | Status |
|---|---|---|---|---|---|
| County Boundaries | Leaflet | TIGERweb (live) | Varies | Mesa County + featured geos | ✅ Mocked in CI |
| LIHTC Points | Leaflet | `data/hna/lihtc/{county}.json` | **716 total** across 44 counties | CO counties | ✅ Fixed — split-lihtc-by-county.js populated from chfa-lihtc.json |

### 2.5 `market-analysis.html` — PMA Scoring Tool

| Layer | Container | Source | Feature Count | Geographic Extent | Status |
|---|---|---|---|---|---|
| County Boundaries | Leaflet `#pmaMap` | `data/co-county-boundaries.json` → TIGERweb | **0 features** (placeholder) | 64 CO counties | ⚠️ Falls back to TIGERweb |
| QCT / DDA | Leaflet | `data/qct-colorado.json`, `data/dda-colorado.json` | 224 / 10 features | Colorado | ✅ Good |
| Tract Centroids | Leaflet | `data/market/tract_centroids_co.json` | **20 tracts** (placeholder) | CO sample tracts | ⚠️ Very sparse (placeholder only) |
| ACS Tract Metrics | Score overlay | `data/market/acs_tract_metrics_co.json` | **4 tracts** (placeholder) | CO sample | ⚠️ Placeholder data |
| HUD LIHTC | Leaflet | `data/market/hud_lihtc_co.geojson` | **10 features** (placeholder) | CO sample | ⚠️ Placeholder only — PMA scoring degraded |

---

## 3. Local Data Source Catalog

### 3.1 Root `data/` directory

| File | Format | Features / Records | Geographic Coverage | Notes |
|---|---|---|---|---|
| `data/fred-data.json` | JSON (series dict) | 39 series, 34 with observations, 0 stubs | National/Colorado | Updated by `fetch-fred-data.yml` daily; 12 years of observations |
| `data/chfa-lihtc.json` | GeoJSON | **716 Point features** | Colorado, 94 cities | ✅ Fixed — CNTY_NAME enriched from CNTY_FIPS reverse lookup; 44 distinct county FIPS |
| `data/qct-colorado.json` | GeoJSON | **224 Polygon features** | 31 Colorado counties | QCTs 2024; fetched by `cache-hud-gis-data.yml` |
| `data/dda-colorado.json` | GeoJSON | **10 Polygon features** | CO metro/ZCTA areas | DDAs 2024; fetched by `cache-hud-gis-data.yml` |
| `data/prop123_jurisdictions.json` | JSON | **80 jurisdictions** | Colorado municipalities | Updated manually via `fetch-lihtc-data.yml` |
| `data/allocations.json` | JSON | **51 state records** | National (all 50 states + DC) | 2026 LIHTC allocations |
| `data/states-10m.json` | TopoJSON | **51 states + DC** (multi-polygon) | National | Source: US Atlas; fetched by CI; CDN fallback if missing |
| `data/co-county-boundaries.json` | GeoJSON | **0 features** ⚠️ | Expected 64 CO counties | Placeholder — run `scripts/boundaries/build_counties_co.py` to populate |
| `data/co-county-demographics.json` | JSON | **64 county records** | All 64 CO counties | ACS demographic profiles; updated by `fetch-county-data.yml` |
| `data/co-county-economic-indicators.json` | JSON | **64 county records** | All 64 CO counties | Employment/wage data; updated by CI |
| `data/co_ami_gap_by_county.json` | JSON | **63 counties** | Colorado | AMI gap at 7 income bands (30–100% AMI) |
| `data/census-acs-state.json` | JSON | **50 states + DC** | National | ACS state-level profiles |
| `data/lihtc-trends-by-county.json` | JSON | **29 counties × 11 years** (2015–2025) | CO tracked counties | LIHTC trend series |
| `data/co-demographics.json` | JSON | Statewide aggregates | Colorado | High-level demographic summary |
| `data/manifest.json` | JSON | 2 files tracked | — | Tracks `qct-colorado.json` + `dda-colorado.json`; needs expansion |
| `data/kalshi/prediction-market.json` | JSON | 0 items | — | ⚠️ Credentials not configured; empty |
| `data/car-market.json` | JSON | Statewide metrics | Colorado | CAR monthly housing market data |
| `data/car-market-report-2026-02.json` | JSON | Monthly report | Colorado | February 2026 CAR report |
| `data/car-market-report-2026-03.json` | JSON | Monthly report | Colorado | March 2026 CAR report |

### 3.2 `data/hna/` — Housing Needs Assessment data

| Path | Format | Count | Geographic Coverage | Notes |
|---|---|---|---|---|
| `data/hna/geo-config.json` | JSON | 5 featured geos + 64 counties | Mesa County area | Contains full CO county list |
| `data/hna/summary/*.json` | JSON | **544 files** | CO counties + places + CDPs | ACS Profile + S0801 per geo |
| `data/hna/lehd/*.json` | JSON | **64 files** (1 per county) | All 64 CO counties | LEHD LODES 2023 jobs data: inflow / outflow / within-county commuters |
| `data/hna/dola_sya/*.json` | JSON | **64 files** (1 per county) | All 64 CO counties | DOLA single-year-of-age pyramids 2020–2050; senior pressure projections |
| `data/hna/projections/*.json` | JSON | **64 files** (1 per county) | All 64 CO counties | Housing unit need projections 2021–2041; DOLA + trend scenarios |
| `data/hna/lihtc/*.json` | GeoJSON | **64 files** — **0 features each** ⚠️ | All 64 CO counties | Placeholder — populated by `scripts/split-lihtc-by-county.js` |
| `data/hna/local-resources.json` | JSON | **68 local resource entries** | Colorado | Affordable housing programs directory |
| `data/hna/local-notes.json` | JSON | Notes metadata | — | Editorial notes |
| `data/hna/derived/geo-derived.json` | JSON | **5 featured geos** | Mesa County area | ACS 5-year derived metrics (pre-computed) |
| `data/hna/acs_debug_log.txt` | Text | — | — | Empty (no ACS fetch errors recorded) |
| `data/hna/source/*.csv` | CSV | — | Colorado | DOLA raw source files |

### 3.3 `data/market/` — PMA Scoring Engine data

| File | Format | Features / Records | Geographic Coverage | Notes |
|---|---|---|---|---|
| `data/market/hud_lihtc_co.geojson` | GeoJSON | **10 Point features** ⚠️ | CO sample locations | Placeholder — run `scripts/market/build_public_market_data.py` |
| `data/market/acs_tract_metrics_co.json` | JSON | **4 tracts** ⚠️ | CO sample tracts | Placeholder — run build script |
| `data/market/tract_centroids_co.json` | JSON | **20 tract centroids** ⚠️ | CO sample tracts | Placeholder — run build script |

### 3.4 `data/boundaries/` — County Boundary (placeholder)

| File | Format | Features | Notes |
|---|---|---|---|
| `data/boundaries/counties_co.geojson` | GeoJSON | **0 features** ⚠️ | Not referenced in JS/HTML; run `scripts/boundaries/build_counties_co.py` |

### 3.5 `data/amenities/` — Amenity POIs (placeholder)

| File | Format | Features | Notes |
|---|---|---|---|
| `data/amenities/grocery_co.geojson` | GeoJSON | **0 features** ⚠️ | Placeholder; run `scripts/amenities/build_osm_amenities.py` |
| `data/amenities/healthcare_co.geojson` | GeoJSON | **0 features** ⚠️ | Placeholder; not referenced in any current JS/HTML |
| `data/amenities/retail_nodes_co.geojson` | GeoJSON | **0 features** ⚠️ | Placeholder; not referenced in any current JS/HTML |
| `data/amenities/schools_co.geojson` | GeoJSON | **0 features** ⚠️ | Placeholder; not referenced in any current JS/HTML |

### 3.6 `maps/` — GeoJSON Base Maps

| File | Status | Notes |
|---|---|---|
| `maps/us-states.geojson` | **MISSING** ⚠️ | Only referenced by `js/data.js` which is not used by any HTML page; low impact |

---

## 4. GIS Reliability Checklist

### 4.1 Base Path Handling
- [x] `path-resolver.js` exposes `resolveAssetUrl()` / `DataService.baseData()` for GitHub Pages sub-path support
- [x] `co-lihtc-map.js` uses `resolveAssetUrl()` for vendor icon paths
- [x] All local data files now loaded via `DataService.baseData()` — no raw fetch paths remain
- [x] `state-allocation-map.html` uses `d3.json('data/states-10m.json')` with CDN fallback

### 4.2 Fetch Helpers & Timeouts
- [x] `fetch-helper.js` provides `fetchWithTimeout()` utility (15 s timeout, 2 retries, exponential backoff)
- [x] `co-lihtc-map.js` wraps all fetches with 15 s timeout
- [x] `prop123-map.js` uses `AbortController` with 20 s timeout and exponential-backoff retry
- [x] `market-analysis.js` uses `DataService.getJSON()` with error catching per source

### 4.3 Retry Logic
- [x] `prop123-map.js` retries failed requests up to 2 times with exponential backoff
- [x] `prop123-map.js` retries detecting `window.coLihtcMap` up to 10 × 200 ms after DOMContentLoaded

### 4.4 Fallbacks
- [x] `co-lihtc-map.js` falls back: `data/chfa-lihtc.json` → CHFA ArcGIS → HUD ArcGIS → embedded stub
- [x] `co-lihtc-map.js` county boundaries: local file → TIGERweb → NaturalEarth → `FALLBACK_COUNTY` embedded constant
- [x] `colorado-deep-dive.js` falls back: configured API URL → `data/prop123_jurisdictions.json`
- [x] `prop123-map.js` falls back: configured API URL → `data/prop123_jurisdictions.json`
- [x] `LIHTC-dashboard.html` falls back: `data/states-10m.json` → GitHub Pages CDN → jsdelivr CDN
- [x] `state-allocation-map.html` falls back: `data/states-10m.json` → jsdelivr CDN

### 4.5 Error Surfaces
- [x] Map status text element `#mapStatus` updated with user-visible messages
- [x] `#prop123Status` shows loading state, feature count, or error message
- [x] `#prop123TableBody` renders error row when data is unavailable
- [x] `market-analysis.js` shows `#pmaStatus` with loading/error messages

### 4.6 Caching
- [x] `colorado-deep-dive.js` provides `cacheGet` / `cacheSet` with TTL via `localStorage`
- [x] `js/cache-manager.js` provides 1-hour `localStorage` cache with in-memory fallback
- [x] TIGERweb county boundary responses now cached 24 hours in `localStorage` (`co-lihtc-map.js`)

---

## 5. Proposition 123 Status

**Status:** ✅ Fixed (2026-03-02)

- `#prop123TableBody` now populates from `data/prop123_jurisdictions.json` on GitHub Pages without requiring a serverless API
- `colorado-deep-dive.js` calls `initProp123Section()` at DOMContentLoaded if the policy tab is already active (e.g. via `#tab-policy-simulator` deep link)
- `prop123-map.js` waits up to 2 seconds for `window.coLihtcMap` before giving up
- Status element `#prop123Status` shows "Loaded N features" on success

---

## 6. Identified Issues & Fixes

### 6.1 CHFA LIHTC — Null County Name (716 features affected)

**Problem:** All 716 features in `data/chfa-lihtc.json` had `CNTY_NAME` set to `null`. The `CNTY_FIPS` field was already populated (44 distinct county FIPS codes). `CNTY_NAME` is used by LIHTC trend charts, county-level tooltips, and filtering in `LIHTC-dashboard.html` and `chfa-portfolio.html`.

**Status:** ✅ Fixed (2026-03-06)

- `data/chfa-lihtc.json` enriched: `CNTY_NAME` derived from `CNTY_FIPS` using a reverse lookup (e.g. `'08031'` → `'Denver'`).
- `scripts/fetch-chfa-lihtc.js` updated to persist `CNTY_NAME` on future weekly fetches via `resolveCntyNameFromFips()`.

### 6.2 County Boundaries — Empty Placeholder

**Problem:** `data/co-county-boundaries.json` and `data/boundaries/counties_co.geojson` both have 0 features.

**Impact:** Medium — `co-lihtc-map.js` (Colorado Deep Dive) and `market-analysis.js` (PMA Tool) both load county boundaries. The three-source fallback (local → TIGERweb → NaturalEarth) means users see county outlines after a TIGERweb round-trip (~0.5–2 s delay vs. instant local load), but this adds latency. TIGERweb responses are now cached 24 h in localStorage (see §4.6), reducing repeated round-trips.

**Remaining Fix:** Run `python scripts/boundaries/build_counties_co.py` in CI to populate both files with the 64 Colorado county polygons from TIGERweb and commit them as static assets.

### 6.3 HNA LIHTC County Files

**Status:** ✅ Fixed (2026-03-06)

- 44 of 64 county files in `data/hna/lihtc/` now contain LIHTC features (716 features total).
- 20 counties have no LIHTC projects — their files are correctly empty `FeatureCollection`s.
- `node scripts/split-lihtc-by-county.js` runs automatically after each weekly CHFA LIHTC fetch.

### 6.4 PMA Market Data — Placeholder Files

**Problem:** Three files in `data/market/` are placeholders: `hud_lihtc_co.geojson` (10 features), `acs_tract_metrics_co.json` (4 tracts), `tract_centroids_co.json` (20 tracts).

**Impact:** Medium — the PMA scoring tool in `market-analysis.html` provides degraded results with sparse data. Comparable properties and tract-level metrics will be missing for most Colorado geographies.

**Fix:** Run `python scripts/market/build_public_market_data.py` to fetch real data from TIGERweb, Census ACS 5-year API, and HUD LIHTC dataset.

### 6.5 Amenity POI Files — All Empty, Not Referenced

**Problem:** All four files in `data/amenities/` have 0 features.

**Impact:** None currently — no JS or HTML references these files.

**Fix:** When amenity-scoring is added to the PMA tool, run `python scripts/amenities/build_osm_amenities.py` to populate from Overpass API.

### 6.6 Kalshi Prediction Market Data — Empty

**Problem:** `data/kalshi/prediction-market.json` has 0 items (credentials not configured).

**Impact:** Low — only affects prediction-market display widgets. Pages degrade gracefully.

**Fix:** Configure `KALSHI_API_KEY` and `KALSHI_API_SECRET` secrets in GitHub Actions.

### 6.7 County Boundary Visibility — Dark Mode

**Status:** ✅ Fixed (2026-03-06)

- CSS variables `--map-boundary-stroke` and `--map-boundary-weight` defined in `css/site-theme.css` — light mode `rgba(15, 23, 42, 0.55)`, dark mode `rgba(130, 180, 240, 0.55)`.
- `co-lihtc-map.js` now reads these CSS variables via `getCountyBoundaryStyle()` and applies them when rendering the county boundary layer.
- A `MutationObserver` on `<html>` and `<body>` class changes calls `updateCountyBoundaryTheme()` to restyle Leaflet layers immediately on dark/light toggle without requiring a page reload.

---

## 7. Models & Modeling Analysis

The site uses Python-based demographic / economic models (run offline by CI) and JavaScript-based analytical models (run in-browser). All projections are estimates based on public data; uncertainty bands are not currently shown to users.

### 7.1 Demographic Projection Models (`scripts/hna/`)

#### CohortComponentModel (`demographic_projections.py`)
- **Method:** Cohort-component model — applies age/sex-specific survival rates and net-migration assumptions to a base-year population pyramid.
- **Inputs:** DOLA SYA pyramid (`data/hna/dola_sya/{county}.json`), historic CAGR from Census, net-migration time series.
- **Outputs:** Population by age/sex through 2041 for 64 Colorado counties.
- **Scenarios:** `baseline`, `low_growth`, `high_growth` (defined in `scripts/hna/projection_scenarios.json`).
- **Limitations:** Migration assumed constant; no age-specific migration rates; no fertility variation.

#### HeadshipRateModel (`household_projections.py`)
- **Method:** Multiplies projected age-specific population by age-specific headship rates (share of age group that are householders) to produce household projections.
- **Inputs:** `CohortComponentModel` output, ACS 2019 headship rates by age group.
- **Outputs:** Household count projections by year (2021–2041).
- **Limitations:** Headship rates are held constant at 2019 ACS values; does not account for trend toward delayed household formation.

#### HousingDemandProjector (`housing_demand_projections.py`)
- **Method:** Adds a target vacancy buffer (12% default) to projected household count to produce required housing unit stock.
- **Inputs:** `HeadshipRateModel` output, base-year vacancy rate (ACS), target vacancy rate.
- **Outputs:** `units_needed_dola` and `incremental_units_needed_dola` arrays stored in `data/hna/projections/{county}.json`.
- **Limitations:** Target vacancy rate (12%) is fixed; does not distinguish rental vs. ownership vacancy; no seasonal/second-home adjustment.

### 7.2 Economic Indicator Models (`scripts/hna/`)

#### EmploymentGrowthIndicator
- Calculates CAGR of total employment from LEHD LODES WAC data (2019–2023).
- Derives sector concentration and flags high-growth / declining sectors.

#### WageTrendIndicator
- Derives wage distribution shift from LEHD CE01/CE02/CE03 employment bands.
- Uses `WAGE_BAND_ANNUAL` midpoints: `{CE01: 10000, CE02: 30000, CE03: 65000}`.

#### IndustryConcentration
- Location quotient for each two-digit NAICS sector vs. Colorado average.

#### JobAccessibility
- Index of jobs reachable within a travel-time zone; depends on tract-centroid data.

#### WageAffordabilityGap (`economic_housing_bridge.py`)
- Computes ratio of median wage to 30%-of-income rent threshold.
- Gap = (affordable rent at median wage) − (median gross rent from ACS).
- Negative gap indicates unaffordability at median wage.

### 7.3 BLS / QCEW Integration (`bls_integration.py`)
- Fetches and caches BLS CES (state employment), QCEW (quarterly wages), and LAUS (unemployment) series.
- Implements a 24-hour file-based cache to avoid BLS rate limits (50 requests/day without key).
- Used by `economic_indicators.py` to populate county-level economic indicators.

### 7.4 PMA Scoring Engine (`js/market-analysis.js`)
- **Method:** Weighted multi-criteria scoring across 5 dimensions:
  1. Demographics (ACS population growth, renter rate)
  2. Affordability (cost-burden rate, AMI gap)
  3. Transit / job access (tract centroid distance to employment nodes)
  4. LIHTC saturation (existing projects per capita in buffer)
  5. QCT / DDA designation bonus
- **Inputs:** `tract_centroids_co.json`, `acs_tract_metrics_co.json`, `hud_lihtc_co.geojson`, `qct-colorado.json`, `dda-colorado.json`
- **Outputs:** PMA score (0–100) with dimension breakdown; exportable as JSON or CSV
- **Limitations:** Tract and HUD data are placeholders (see §6.4); scores will be unreliable until populated.

### 7.5 AMI Gap Model (`js/co-ami-gap.js`)
- Reads `data/co_ami_gap_by_county.json` (63 counties, 7 AMI bands: 30–100%)
- Visualizes rental affordability gap at each AMI threshold: households at ≤N% AMI vs. units priced affordable at ≤N%
- Coverage rate (`units / households`) < 1.0 indicates a deficit

### 7.6 Forecasting & Trend Analysis (`js/forecasting.js`, `js/trend-analysis.js`)
- Linear and exponential trend extrapolation on FRED time series
- 12–24 month forward projections using OLS on most recent 24 observations
- Confidence bands not displayed; labeled as "trend extrapolation, not a forecast"

---

## 8. CI/CD & Automated Data Refresh

| Workflow | Trigger | Populates | Status |
|---|---|---|---|
| `fetch-fred-data.yml` | Daily 06:00 UTC | `data/fred-data.json` | ✅ Active |
| `cache-hud-gis-data.yml` | Weekly | `data/qct-colorado.json`, `data/dda-colorado.json` | ✅ Active |
| `fetch-chfa-lihtc.yml` | Weekly | `data/chfa-lihtc.json` | ✅ Active (CNTY_FIPS null — see §6.1) |
| `fetch-county-data.yml` | Monthly | `data/co-county-demographics.json`, `data/co-county-economic-indicators.json` | ✅ Active |
| `build-hna-data.yml` | Manual / on push | `data/hna/` directory | ✅ Active |
| `build-market-data.yml` | Manual | `data/market/` directory | ⚠️ Placeholder data not yet populated |
| `generate-market-analysis-data.yml` | Manual | `data/market/` | ⚠️ See §6.4 |
| `fetch-kalshi.yml` | Daily | `data/kalshi/prediction-market.json` | ⚠️ Credentials missing |
| `car-data-update.yml` | 1st of month 04:00 UTC | `data/car-market-report-*.json` | ✅ Active |
| `ci-checks.yml` | Every push / PR | Validation only | ✅ Active |
| `site-audit.yml` | On push + schedule | `audit-report/` (local) | ✅ Active |

---

## 9. Prioritized Recommendations

### Critical
1. **Populate `data/co-county-boundaries.json`**: Run `python scripts/boundaries/build_counties_co.py` in CI (`cache-hud-gis-data.yml`). Eliminates TIGERweb round-trip (~1–2 s) on colorado-deep-dive and market-analysis map init. TIGERweb is now 24h cached (§4.6) as a stop-gap.

### High — *Completed*
2. ~~Enrich `data/chfa-lihtc.json` COUNTY FIPS~~ ✅ **Fixed 2026-03-06** — `CNTY_NAME` enriched from CNTY_FIPS reverse lookup; `fetch-chfa-lihtc.js` updated to persist on future fetches.
3. ~~Populate HNA LIHTC county files~~ ✅ **Fixed 2026-03-06** — 44/64 county files now have features (716 total); `split-lihtc-by-county.js` runs after each weekly CHFA fetch.

### High — *Remaining*
4. **Run `build_public_market_data.py`**: The PMA scoring tool has placeholder data for tracts (4), centroids (20), and HUD LIHTC (10). Real data significantly improves scoring accuracy.

### Medium — *Completed*
5. ~~TIGERweb TTL cache~~ ✅ **Fixed 2026-03-06** — 24-hour `localStorage` cache added to `co-lihtc-map.js`.
6. ~~Map boundary theme observer~~ ✅ **Fixed 2026-03-06** — `MutationObserver` on `<html>` and `<body>` class changes added to `co-lihtc-map.js`; county boundary style now reads CSS custom properties `--map-boundary-stroke` / `--map-boundary-weight`.

### Medium — *Remaining*
7. **Show projection uncertainty bands**: The demographic projections (§7.1) produce `low_growth` and `high_growth` scenarios but only the `baseline` is displayed. Surface all three as a shaded band in the HNA charts.
8. **Configure Kalshi credentials**: Set `KALSHI_API_KEY` / `KALSHI_API_SECRET` in GitHub Actions to populate prediction-market data.

### Low
9. ~~Expand `data/manifest.json`~~ ✅ **Fixed 2026-03-06** — manifest updated to reflect correct lihtc/chfa status; records all 38 tracked data files.
10. **Retire or wire `js/data.js` and `js/app.js`**: These ES modules are not referenced by any HTML page but reference the missing `maps/us-states.geojson`. Either integrate them into a page or remove them to avoid confusion.
11. **Add amenity scoring to PMA**: The `data/amenities/` files are ready-to-populate stubs. Run `build_osm_amenities.py` and integrate grocery/school/healthcare proximity into the PMA score.
12. **Link validation in CI**: Run `node test/validate-links.js` in `ci-checks.yml` to catch broken internal hrefs before deploy.

## Actionable Recommendations

- Archived file: `_audit/js/app.js` — review and remove fully if unneeded.
- Archived file: `_audit/js/colorado-interactive-map.js` — review and remove fully if unneeded.
- Archived file: `_audit/js/dashboard.js` — review and remove fully if unneeded.
- Archived file: `_audit/js/data-service.js` — review and remove fully if unneeded.
- Archived file: `_audit/js/data.js` — review and remove fully if unneeded.
- Archived file: `_audit/js/metrics.js` — review and remove fully if unneeded.
- Archived file: `_audit/js/national-regional-map.js` — review and remove fully if unneeded.
- Archived file: `_audit/js/responsive-nav.js` — review and remove fully if unneeded.
- Archived file: `_audit/css/responsive-nav.css` — review and remove fully if unneeded.
- Archived file: `_audit/scripts/hna/acs_debug_tools.py` — review and remove fully if unneeded.
- Docs and site-audit pipeline are automatically updated after every merge.

## 