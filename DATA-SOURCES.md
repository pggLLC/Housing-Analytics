# Housing Analytics — Data Sources Reference

This document provides a complete inventory of all data sources, local cache files,
GitHub Actions workflows, API credentials, and their operational status.

---

## API Secrets Audit

All API keys and credentials are stored as **GitHub Actions Secrets** (Settings → Secrets and variables → Actions).
No keys are hard-coded in source files or committed to the repository.
The generated `js/config.js` is listed in `.gitignore` and is never committed.

| Secret Name | Purpose | Required By | Key Source |
|---|---|---|---|
| `CENSUS_API_KEY` | US Census Bureau ACS data | `fetch-census-acs.yml`, `build-hna-data.yml`, `deploy.yml` | Free — https://api.census.gov/data/key_signup.html |
| `FRED_API_KEY` | Federal Reserve economic data | `fetch-fred-data.yml`, `deploy.yml` | Free — https://research.stlouisfed.org/useraccount/apikey |
| `KASHLI_API_KEY` | Kashli real estate market data | `fetch-kashli-data.yml` | Paid — https://kashli.com |
| `KALSHI_API_KEY` | Kalshi prediction market data | `fetch-kalshi.yml` | Paid — https://kalshi.com |
| `KALSHI_API_SECRET` | Kalshi API authentication | `fetch-kalshi.yml` | Paid — https://kalshi.com |
| `KALSHI_API_BASE_URL` | Kalshi API endpoint URL | `fetch-kalshi.yml` | Paid — https://kalshi.com |
| `ZILLOW_EMAIL` | Zillow account login | `zillow-data-sync.yml` | Zillow account credentials |
| `ZILLOW_PASSWORD` | Zillow account password | `zillow-data-sync.yml` | Zillow account credentials |
| `EMAIL_USER` | Email address for monitoring alerts | `daily-monitoring.yml` | Gmail or SMTP account |
| `EMAIL_PASSWORD` | Email app password for alerts | `daily-monitoring.yml` | Gmail app password |
| `WEBSITE_URL` | Live site URL for monitoring checks | `daily-monitoring.yml` | Configuration value |

**Public APIs (no key required):**
- HUD ArcGIS FeatureServer — LIHTC, QCT, DDA overlays
- CHFA ArcGIS FeatureServer — Colorado LIHTC properties
- US Census TIGERweb — boundary geometry
- OpenStreetMap tile layer — base map

---

## Data Files Inventory

### Root `data/` directory

| File | Size | Source | CI Workflow | Schedule | Local Creation Working? | Notes |
|---|---|---|---|---|---|---|
| `data/chfa-lihtc.json` | ~182 B (empty) | CHFA ArcGIS FeatureServer | `fetch-chfa-lihtc.yml`, `deploy.yml` | Monday 05:00 UTC + every deploy | ⚠️ Empty — CI fetch returning 0 features | GeoJSON FeatureCollection; front-end falls back to HUD ArcGIS then embedded data when empty |
| `data/qct-colorado.json` | ~447 KB | HUD ArcGIS `Qualified_Census_Tracts_2026` | `fetch-lihtc-data.yml`, `cache-hud-gis-data.yml` | Sunday 07:00 + Monday 04:00 UTC | ✅ 224 features | QCT polygon overlays for Colorado; written by two workflows (no redundancy conflict) |
| `data/dda-colorado.json` | ~342 KB | HUD ArcGIS `Difficult_Development_Areas_2026` | `fetch-lihtc-data.yml`, `cache-hud-gis-data.yml` | Sunday 07:00 + Monday 04:00 UTC | ✅ 2,902 features | DDA polygon overlays for Colorado; normalized by `normalize-dda.js` in both workflows |
| `data/manifest.json` | ~249 B | Generated | `fetch-lihtc-data.yml` | Sunday 07:00 UTC | ✅ | Records feature counts and timestamps for QCT/DDA files |
| `data/fred-data.json` | ~958 KB | FRED API (St. Louis Fed) | `fetch-fred-data.yml` | Daily 06:00 UTC | ✅ (requires `FRED_API_KEY` secret) | 30+ economic series; observations from 2014-01-01 |
| `data/census-acs-state.json` | ~25 KB | US Census ACS 5-year API | `fetch-census-acs.yml` | Daily 06:30 UTC | ✅ (requires `CENSUS_API_KEY` secret) | State-level ACS estimates; auto-selects most recent available vintage (2021–2024) |
| `data/states-10m.json` | ~115 KB | TopoJSON — Natural Earth / Census | Manual / committed | Static | ✅ | US state boundaries (TopoJSON 10m resolution); used by national maps |
| `data/allocations.json` | ~12 KB | Manual / static | Committed to repo | Static | ✅ | LIHTC state allocation data by year; updated manually |
| `data/co_ami_gap_by_county.json` | ~68 KB | Computed (HUD AMI data) | Committed to repo | Static | ✅ | Colorado AMI gap by county; used by Colorado Deep Dive AMI chart |
| `data/prop123_jurisdictions.json` | ~24 KB | CDOLA commitment portal | Committed to repo / `fetch-prop123.js` | Manual | ✅ | Prop 123 jurisdiction commitments; refreshed by running `scripts/fetch-prop123.js` |
| `data/kashli-market-data.json` | ~129 B (empty) | Kashli API | `fetch-kashli-data.yml` | Monday 03:00 UTC | ⚠️ Empty `markets:{}` | Requires valid `KASHLI_API_KEY` secret |
| `data/car-market-report-2026-02.json` | ~2.3 KB | CAR (Colorado Association of Realtors) | `car-data-update.yml` | Monthly | ✅ | Colorado market report data; month-stamped filenames |
| `data/car-market-report-2026-03.json` | ~2.3 KB | CAR | `car-data-update.yml` | Monthly | ✅ | |
| `data/kalshi/prediction-market.json` | — | Kalshi API | `fetch-kalshi.yml` | Monday 03:00 UTC | ✅ (requires Kalshi secrets) | Prediction market contracts related to housing/rates |

### `data/hna/` — Housing Needs Assessment cache

| Path | Contents | CI Workflow | Schedule | Status | Notes |
|---|---|---|---|---|---|
| `data/hna/geo-config.json` | Featured geographies (counties, places, CDPs) | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | Required for HNA geography selector |
| `data/hna/local-resources.json` | Curated local housing authority / advocacy links | Committed to repo | Static | ✅ | |
| `data/hna/summary/{geoid}.json` | ACS profile + S0801 commuting cache per geography | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | Requires `CENSUS_API_KEY` |
| `data/hna/lehd/{countyFips5}.json` | LEHD LODES OD inflow/outflow/within-county; multi-year employment + industry breakdown (Phase 3) | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | Phase 3: also updated by `scripts/hna/parse_lehd_wac.py` with historical WAC data |
| `data/hna/dola_sya/{fips5}.json` | DOLA/SDO single-year-of-age pyramid + senior pressure | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | No live API fallback |
| `data/hna/projections/{fips5}.json` | DOLA/SDO 20-year population + housing-need model | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | No live API fallback |
| `data/hna/derived/geo-derived.json` | ETL-computed inputs for municipal scaling | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | |
| `data/hna/lihtc/{countyFips5}.json` | Per-county LIHTC features (64 files) | `generate-housing-data.yml` | Monday 06:00 UTC | ✅ | HUD ArcGIS source; first-tier cache for HNA LIHTC map layer |
| `data/hna/acs_debug_log.txt` | ACS fetch diagnostics | `build-hna-data.yml` | Monday 06:30 UTC | — | Inspect when ACS data fails to load |
| `data/hna/municipal/municipal-config.json` | All featured CO municipalities — FIPS, population, county, ACS metrics | Committed to repo (ETL refreshes annually) | Annually | ✅ | Seed data; expanded by ETL |
| `data/hna/municipal/growth-rates.json` | Municipal 3/5/10-yr CAGRs and smoothed projection rates | Committed to repo (ETL refreshes annually) | Annually | ✅ | Used by `js/municipal-analysis.js` for projection scaling |
| `data/hna/municipal/scaling-factors/{fips5}.json` | Per-county pre-computed population shares, headship, relative growth | `build-hna-data.yml` | Monday 06:30 UTC | 🔄 | Generated by `build_hna_data.py --county`; absent files cause client-side fallback |
| `data/hna/municipal/demographics/{geoid}.json` | Pre-calculated municipal demographic baselines | `build-hna-data.yml` | Monday 06:30 UTC | 🔄 | Optional cache — JS computes on demand if absent |
| `data/hna/municipal/affordability/{geoid}.json` | Municipal affordability tier distributions by AMI tier | `build-hna-data.yml` | Monday 06:30 UTC | 🔄 | Optional cache — JS computes on demand if absent |

### `data/market/` — Market analysis artifacts (Phase 3)

| Path | Contents | CI Workflow | Schedule | Status | Notes |
|---|---|---|---|---|---|
| `data/market/tract_centroids_co.json` | Colorado census tract centroids (lat/lon, county FIPS) | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | Rebuilt by `scripts/generate_tract_centroids.py`; cached for 30 days |
| `data/market/acs_tract_metrics_co.json` | ACS 5-year tract-level metrics | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | Built by `scripts/market/build_public_market_data.py` |
| `data/market/hud_lihtc_co.geojson` | HUD LIHTC Colorado properties (GeoJSON) | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | Built by `scripts/market/build_public_market_data.py` |
| `data/tract-centroids.json` | Phase 3 centroid format — 11-digit FIPS, county_geoid, name, area_sqmiles | `build-hna-data.yml` | Monday 06:30 UTC | ✅ | Phase 3 spec format; rebuilt by `scripts/generate_tract_centroids.py` |

### `data/policy/` — Policy data artifacts

| Path | Contents | CI Workflow | Schedule | Status | Notes |
|---|---|---|---|---|---|
| `data/policy/prop123_jurisdictions.json` | Prop 123 / HB 22-1093 commitment filings | Committed to repo + manual | Manual | ✅ | Used by compliance dashboard and HNA page |



---

## GIS Scripts & Data Flow

### Map overlay fallback chain

Each map layer uses a multi-tier fallback to ensure data always displays:

#### Colorado LIHTC Properties (red circle markers) — `js/co-lihtc-map.js`
```
Tier 1: data/chfa-lihtc.json          (CI-populated; 15s timeout)
         → if 404: proceed to Tier 2
         → if empty (0 features): use Tier 2
Tier 2: CHFA ArcGIS FeatureServer     (public; 15s timeout)
Tier 3: HUD ArcGIS FeatureServer      (public; 15s timeout)
Tier 4: Embedded FALLBACK_LIHTC       (14 representative CO projects)
```

#### QCT Overlays (green polygons) — `js/co-lihtc-map.js`
```
Tier 1: data/qct-colorado.json        (CI-populated; 15s timeout — was always FALLBACK before fix)
Tier 2: Embedded FALLBACK_QCT         (14 representative CO census tracts)
```

#### DDA Overlays (orange polygons) — `js/co-lihtc-map.js`
```
Tier 1: data/dda-colorado.json        (CI-populated; 15s timeout — was always FALLBACK before fix)
Tier 2: Embedded FALLBACK_DDA         (10 representative CO DDA areas)
```

#### HNA QCT — `js/housing-needs-assessment.js`
```
Tier 1: data/qct-colorado.json        (local; loadJson with 20s timeout)
Tier 2: HUD ArcGIS Qualified_Census_Tracts_2026  (live; 15s timeout — was 5s and wrong URL)
Tier 3: GitHub Pages backup copy      (https://pggllc.github.io/Housing-Analytics/data/qct-colorado.json)
Tier 4: Embedded QCT_FALLBACK_CO      (27 representative CO QCT tracts)
```

#### HNA DDA — `js/housing-needs-assessment.js`
```
Tier 1: data/dda-colorado.json        (local; loadJson with 20s timeout)
Tier 2: HUD ArcGIS Difficult_Development_Areas_2026  (live; 15s timeout — was 5s and wrong URL)
Tier 3: GitHub Pages backup copy      (https://pggllc.github.io/Housing-Analytics/data/dda-colorado.json)
Tier 4: Embedded DDA_FALLBACK_CO      (10 representative CO DDA areas)
```

#### Prop 123 Jurisdictions — `js/prop123-map.js`
```
Tier 1: data/prop123_jurisdictions.json  (committed to repo)
Tier 2: cfg.PROP123_API_URL (if set in APP_CONFIG)
Geometry: Census TIGERweb ArcGIS (public; 20s timeout — was 10s)
```

---

## Municipal Interpolation Methodology

The HNA tool scales county-level ACS data to municipalities using the **population share
method** implemented in `js/municipal-analysis.js`. The key formula is:

```
Municipal Metric ≈ County Metric × (municipal_pop / county_pop)
                 × growth_adjustment_factor
```

### Data Confidence Levels

| Label | Score | Source | Condition |
|---|---|---|---|
| **Direct** | 100% | Direct ACS place-level table | Variable available in ACS place-level data |
| **Interpolated** | 80% | County data × municipal characteristics | Place population ≥ 2,500 |
| **Estimated** | 60% | County trend extrapolation | Place population < 2,500 or adjustment factors absent |
| **Unavailable** | 0% | No data | Variable not available at any level |

### Metrics and Sources

| HNA Metric | Source for counties | Source for municipalities |
|---|---|---|
| Population | ACS DP05 (direct) | ACS DP05 place (direct if available) |
| Households | ACS DP02 (direct) | County headship × municipal pop (interpolated) |
| Housing units | ACS DP04 (direct) | Households ÷ (1 − vacancy) (interpolated) |
| Median rent | ACS DP04 (direct) | ACS DP04 place (direct if available) |
| AMI tiers | ACS DP03/DP04 (direct) | County tiers adjusted by rent differential (interpolated) |
| Employment | LEHD WAC (direct) | County LEHD × population share (estimated) |
| Prop 123 baseline | ACS DP04 + tenure (direct) | Municipal renters × county 60%-AMI fraction (interpolated) |

### Lineage

1. `data/hna/municipal/municipal-config.json` — seed file with ACS place metrics
2. `data/hna/municipal/growth-rates.json` — historical CAGRs from ACS 5-year trend
3. `data/hna/derived/geo-derived.json` — ETL-computed shares and headship slopes
4. `js/municipal-analysis.js` — client-side calculation using the above inputs
5. UI badge in `housing-needs-assessment.html` — displays confidence level to users

For full technical detail see [docs/MUNICIPAL-ANALYSIS-METHODOLOGY.md](docs/MUNICIPAL-ANALYSIS-METHODOLOGY.md).

---

## Redundancy Analysis

| File | Populated By | Redundant Workflows | Resolution |
|---|---|---|---|
| `data/qct-colorado.json` | `fetch-lihtc-data.yml` (Sun) AND `cache-hud-gis-data.yml` (Mon) | Both write the same file | Not harmful — Monday overwrites Sunday with identical source data |
| `data/dda-colorado.json` | `fetch-lihtc-data.yml` (Sun) AND `cache-hud-gis-data.yml` (Mon) | Both write the same file; Monday also normalizes field names | Fixed — `fetch-lihtc-data.yml` now also runs `normalize-dda.js` for consistent schema on both runs |
| `data/hna/lihtc/{fips}.json` | `generate-housing-data.yml` (Mon 06:00) | Separate from `data/chfa-lihtc.json` | Not redundant — per-county split serves HNA map; statewide file serves colorado-deep-dive map |

---

## Workflow Schedule Summary

| Workflow | Schedule | Key Secret(s) | Output File(s) |
|---|---|---|---|
| `deploy.yml` | Push to main + manual | `CENSUS_API_KEY`, `FRED_API_KEY` | `js/config.js` (generated); also runs `fetch-chfa-lihtc.js` |
| `fetch-chfa-lihtc.yml` | Monday 05:00 UTC | None (public API) | `data/chfa-lihtc.json` |
| `fetch-lihtc-data.yml` | Sunday 07:00 UTC | None (public API) | `data/qct-colorado.json`, `data/dda-colorado.json`, `data/manifest.json` |
| `cache-hud-gis-data.yml` | Monday 04:00 UTC | None (public API) | `data/qct-colorado.json`, `data/dda-colorado.json` (normalized) |
| `generate-housing-data.yml` | Monday 06:00 UTC | None (public API) | `data/hna/lihtc/*.json` (64 files) |
| `build-hna-data.yml` | Monday 06:30 UTC | `CENSUS_API_KEY` | `data/hna/geo-config.json`, `summary/`, `lehd/`, `dola_sya/`, `projections/`, `derived/` |
| `fetch-census-acs.yml` | Daily 06:30 UTC | `CENSUS_API_KEY` | `data/census-acs-state.json` |
| `fetch-fred-data.yml` | Daily 06:00 UTC | `FRED_API_KEY` | `data/fred-data.json` |
| `fetch-kashli-data.yml` | Monday 03:00 UTC | `KASHLI_API_KEY` | `data/kashli-market-data.json` |
| `fetch-kalshi.yml` | Monday 03:00 UTC | `KALSHI_API_KEY`, `KALSHI_API_SECRET`, `KALSHI_API_BASE_URL` | `data/kalshi/prediction-market.json` |
| `zillow-data-sync.yml` | Monday 02:00 UTC | `ZILLOW_EMAIL`, `ZILLOW_PASSWORD` | `data/zillow-*.json` |
| `car-data-update.yml` | Monthly | None | `data/car-market-report-*.json` |
| `daily-monitoring.yml` | Daily | `EMAIL_USER`, `EMAIL_PASSWORD`, `WEBSITE_URL` | Email alerts only |

---

## Known Issues & Recommendations

1. **`data/chfa-lihtc.json` is empty** — The CHFA ArcGIS FeatureServer returned 0 features on the last CI run.
   The front-end correctly falls back to the HUD ArcGIS API, then to embedded data (14 projects).
   **Action:** Manually run the `Fetch CHFA LIHTC Data` workflow from the Actions tab to retry.

2. **`data/kashli-market-data.json` is empty** — The Kashli API returned no market data.
   **Action:** Verify the `KASHLI_API_KEY` secret is valid. Check Kashli API status.

3. **Zillow data** — Uses account credentials (email/password) which may break if Zillow updates
   their authentication. Consider migrating to a public data API or static dataset.

4. **ArcGIS service URL alignment (fixed)** — `housing-needs-assessment.js` was referencing
   `QCT_2026` and `DDA_2026` service names that did not match the CI scripts (`Qualified_Census_Tracts_2026`
   and `Difficult_Development_Areas_2026`). Both now use the correct service names.

5. **Timeout increases applied** — All ArcGIS remote API calls now use 15–20 second timeouts
   (previously 5–10 seconds) to prevent premature failures on slow HUD/Census servers.
   The Prop 123 TIGERweb geometry timeout was increased from 10s to 20s.
