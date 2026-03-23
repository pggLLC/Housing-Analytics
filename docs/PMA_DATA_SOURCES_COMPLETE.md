# PMA Data Sources — Complete Reference Guide

**Last updated:** 2025-03  
**Scope:** All statewide Colorado data sources integrated into the Public Market Analysis (PMA) scoring engine

---

## Overview

The PMA scoring engine uses data from three implementation phases to evaluate housing market conditions across all Colorado census tracts. Each source has an idempotent fetch script with caching, fallback logic, and standardized metadata.

### Quick Reference — Running the Build

```bash
# Full build (all phases)
python scripts/market/build_public_market_data.py

# Core only (TIGERweb + ACS + LIHTC)
python scripts/market/build_public_market_data.py --core-only

# Phase 1 only (critical data)
python scripts/market/build_public_market_data.py --phase 1

# Phase 2 only (enhancement data)
python scripts/market/build_public_market_data.py --phase 2

# Phase 3 only (policy overlays)
python scripts/market/build_public_market_data.py --phase 3
```

### Environment Variables (all optional)

| Variable | Source | Purpose |
|----------|--------|---------|
| `CENSUS_API_KEY` | https://api.census.gov/data/key_signup.html | Census ACS + LEHD (free key improves rate limits) |
| `HUD_API_TOKEN` | https://www.huduser.gov/hudapi/public/login | HUD CHAS, FMR, QCT/DDA APIs |
| `NOAA_API_KEY` | https://www.ncdc.noaa.gov/cdo-web/token | NOAA Climate Data Online |

---

## Core Data Sources (Always Built)

These are the foundational datasets built by `build_public_market_data.py` core.

### Census Tract Geometries (TIGERweb)
- **File:** `data/market/tract_centroids_co.json`
- **File:** `data/market/tract_boundaries_co.geojson`
- **Source:** US Census TIGERweb ArcGIS REST (public, no auth)
- **URL:** https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0
- **Refresh:** Weekly (matches census boundary updates)
- **Note:** WHERE clause uses double-quoted strings (`STATEFP="08"`) per ArcGIS REST spec

### ACS Housing/Economic Metrics
- **File:** `data/market/acs_tract_metrics_co.json`
- **Source:** US Census ACS 5-Year Estimates (public API)
- **URL:** https://api.census.gov/data/2023/acs/acs5
- **Refresh:** Annual (ACS vintage updates December each year)
- **Key fields:** `pop`, `renter_hh`, `vacancy_rate`, `median_gross_rent`, `cost_burden_rate`

### HUD LIHTC Properties
- **File:** `data/market/hud_lihtc_co.geojson`
- **Source:** HUD LIHTC public dataset (OpenData ArcGIS)
- **Refresh:** Monthly (new LIHTC allocations)

---

## Phase 1: Critical Data Sources

### 1.1 LEHD/LODES Commuting Shed
- **Script:** `scripts/market/fetch_lehd_commuting.py`
- **File:** `data/market/commuting_shed_co.geojson`
- **Source:** US Census LODES8 Origin-Destination Employment Statistics (public)
- **URL:** https://lehd.ces.census.gov/data/lodes/LODES8/co/
- **Vintage:** 2021 (most recent LODES8 CO data)
- **Refresh:** Annual (LODES data updates ~18 months lag)
- **PMA Use:** Workforce availability scoring
- **Key fields:**
  - `inbound_workers` — Workers commuting into tract
  - `outbound_workers` — Workers commuting out of tract
  - `total_jobs` — Jobs in tract (WAC)
  - `resident_workers` — Working residents (RAC)
  - `workers_to_jobs_ratio` — > 1 = bedroom community, < 1 = employment center

### 1.2 Colorado School Data
- **Script:** `scripts/market/fetch_school_data.py`
- **File:** `data/market/schools_co.geojson`
- **Source:** NCES Public School Locations 2021-22 (public ArcGIS FeatureServer)
- **URL:** https://services1.arcgis.com/Ua5sjt3LWTPigjyD/arcgis/rest/services/NCES_Public_School_Locations_2122/FeatureServer/0
- **Refresh:** Annual (NCES updates each school year)
- **PMA Use:** Neighborhood quality scoring
- **Key fields:**
  - `school_name`, `district`, `grade_span` — School identification
  - `school_level` — Elementary/Middle/High
  - `performance_rating` — CDE SPF rating (null until populated from CDE data)

### 1.3 Opportunity Zones
- **Script:** `scripts/market/fetch_opportunity_zones.py`
- **File:** `data/market/opportunity_zones_co.geojson`
- **Source:** HUD CDFI Fund Opportunity Zones (public ArcGIS FeatureServer)
- **Refresh:** As-needed (designations rarely change)
- **PMA Use:** Policy incentives scoring (subsidy availability)
- **Coverage:** ~70 designated zones in Colorado
- **Key fields:**
  - `geoid` — 11-digit census tract GEOID
  - `designation_date` — "2018-04-09" (most CO OZs designated)
  - `investment_incentives` — Summary of capital gains tax incentives

### 1.4 County Parcel Aggregates
- **Script:** `scripts/market/fetch_county_assessor_data.py`
- **File:** `data/market/parcel_aggregates_co.json`
- **Source:** Colorado DOLA Parcel Viewer + county assessor estimates
- **Refresh:** Annual (assessor data updates annually)
- **PMA Use:** Land feasibility and supply assessment
- **Coverage:** All 64 Colorado counties
- **Key fields:**
  - `parcel_count` — Total parcels (null if API unavailable)
  - `avg_land_value_per_acre` — Estimated average land value
  - `data_source` — `dola_api` or `estimate`

### 1.5 HUD FMR (Enhanced)
- **Script:** `scripts/fetch_fmr_api.py`
- **File:** `data/market/fmr_co.json`
- **Source:** HUD User FMR API (public)
- **Refresh:** Annual (HUD updates FMRs each October for new FY)
- **PMA Use:** Rent pressure dimension

### 1.6 HUD CHAS Affordability Data
- **Script:** `scripts/market/fetch_chas_data.py`
- **File:** `data/market/chas_co.json`
- **Source:** HUD CHAS API (public, token improves rate limits)
- **Vintage:** 2020 (most recent published CHAS)
- **Refresh:** Biennial (CHAS updates every 2-3 years)
- **PMA Use:** Demand dimension and affordability gap scoring
- **Key fields:**
  - `cost_burden_30pct` — Renters paying 30-49.9% of income on rent
  - `cost_burden_50pct` — Severely cost-burdened renters (50%+)
  - `cost_burden_30pct_rate` — Rate of cost burden

---

## Phase 2: High-Priority Enhancement Sources

### 2.1 Transit Routes (GTFS)
- **Script:** `scripts/market/fetch_gtfs_transit.py`
- **File:** `data/market/transit_routes_co.geojson`
- **Source:** GTFS feeds: RTD, Bustang, Mountain Metro Transit (public)
- **Refresh:** Weekly (GTFS data updated regularly by agencies)
- **PMA Use:** Neighborhood access scoring
- **Agencies:** RTD (Denver metro), Bustang (intercity), Mountain Metro (CS)
- **Key fields:**
  - `stop_id`, `stop_name` — Stop identification
  - `agency_id`, `agency_name` — Transit agency
  - `route_count` — Routes served by agency
  - `stop_frequency` — Peak-hour frequency (null = computed at runtime)

### 2.2 EPA Walkability Index
- **Script:** `scripts/market/fetch_epa_walkability.py`
- **File:** `data/market/walkability_scores_co.json`
- **Source:** EPA Smart Location Database v3 (public ArcGIS FeatureServer)
- **Vintage:** 2021
- **Refresh:** Quarterly (EPA updates)
- **PMA Use:** Accessibility dimension scoring
- **Key fields:**
  - `walk_score` — National Walkability Index (1-20; 15+ = walkable)
  - `transit_proximity` — Transit trips within 1/4 mile
  - `car_dependent` — True if walk_score < 6
  - `block_group_count` — Block groups averaged for tract

### 2.3 FEMA Flood Zones
- **Script:** `scripts/market/fetch_fema_flood_data.py`
- **File:** `data/market/flood_zones_co.geojson`
- **Source:** FEMA NFHL ArcGIS MapServer (public)
- **Refresh:** Quarterly (FEMA updates flood maps)
- **PMA Use:** Infrastructure risk scoring
- **Key fields:**
  - `zone_designation` — FEMA zone code (AE, X, etc.)
  - `special_flood_hazard_area` — True = 100-year floodplain
  - `base_flood_elevation` — BFE in feet (NAVD88)
  - `risk_level` — high | moderate | low

### 2.4 USDA Food Access Atlas
- **Script:** `scripts/market/fetch_food_access.py`
- **File:** `data/market/food_access_co.json`
- **Source:** USDA Economic Research Service Food Access Research Atlas (public ArcGIS)
- **Vintage:** 2019
- **Refresh:** Annual
- **PMA Use:** Neighborhood quality scoring
- **Key fields:**
  - `low_access_flag_1mi` — LILA flag (1-mile threshold)
  - `pop_beyond_1mi` — Population beyond 1 mile from supermarket
  - `snap_authorized_stores_1mi` — SNAP stores within 1 mile

### 2.5 HUD QCT/DDA Designations
- **Script:** `scripts/market/fetch_qct_dda_designations.py`
- **File:** `data/market/qct_dda_designations_co.json`
- **Source:** HUD public ArcGIS FeatureServer (QCT and DDA layers)
- **Refresh:** Annual (HUD designates each January)
- **PMA Use:** Development incentives scoring
- **Key fields:**
  - `qct_status` — True = Qualified Census Tract
  - `dda_status` — True = Difficult Development Area
  - `eligible_basis_multiplier` — 1.30 = 130% eligible basis for LIHTC
  - `expiration_date` — Designation expiration

### 2.6 NHPD Preservation Database
- **Script:** `scripts/market/fetch_nhpd_preservation.py`
- **File:** `data/market/nhpd_preservation_co.geojson`
- **Source:** NHPD API (preservationdatabase.org)
- **Refresh:** Monthly
- **PMA Use:** Competitive supply and pipeline scoring
- **Key fields:**
  - `units` — Total affordable units
  - `project_type` — LIHTC, Section 8, HOME, etc.
  - `preservation_status` — Active | At Risk | Expired | Converted
  - `expiration_year` — Year affordability expires
  - `is_expiring_soon` — True if expiring within 5 years

### 2.7 Utility Capacity
- **Script:** `scripts/market/fetch_utility_capacity.py`
- **File:** `data/market/utility_capacity_co.geojson`
- **Source:** Colorado DOLA Water Service Areas + municipal estimates
- **Refresh:** Annual
- **PMA Use:** Infrastructure feasibility scoring
- **Key fields:**
  - `water_capacity_remaining_pct` — Remaining water capacity %
  - `sewer_capacity_remaining_pct` — Remaining sewer capacity %
  - `moratorium_flag` — True = connection moratorium in effect

### 2.8 Zoning Compatibility Index
- **Script:** `scripts/market/fetch_zoning_data.py`
- **File:** `data/market/zoning_compat_index_co.json`
- **Source:** Denver Open Data + municipal research
- **Refresh:** Semi-annual (manual updates required)
- **PMA Use:** Land feasibility scoring
- **Coverage:** 15+ major Colorado municipalities (expanding)
- **Key fields:**
  - `multifamily_allowed` — True = apartment development permitted
  - `max_density_units_per_acre` — Density limit
  - `height_limit_ft` — Maximum building height
  - `affordable_bonus_available` — True = density bonus for affordable units
  - `zoning_compat_score` — Computed score 0-100

---

## Phase 3: Policy Overlays & Subsidy Programs

### 3.1 CHFA Subsidy Programs
- **Script:** `scripts/market/fetch_chfa_subsidies.py`
- **File:** `data/market/chfa_programs_co.json`
- **Source:** CHFA public program information (chfainfo.com) — curated
- **Refresh:** Monthly
- **PMA Use:** Subsidy opportunity scoring
- **Programs covered:**
  - LIHTC 9% Tax Credit (competitive, annual QAP cycle)
  - LIHTC 4% + Tax-Exempt Bonds (non-competitive, rolling)
  - HOME Investment Partnerships (~$25M annually)
  - CHFA Multifamily Mortgage (rolling)
  - Colorado Affordable Housing Tax Credit (~$10M annually)
  - National Housing Trust Fund (~$5M annually, ELI focus)

### 3.2 Inclusionary Zoning Ordinances
- **Script:** `scripts/market/fetch_inclusionary_zoning.py`
- **File:** `data/market/inclusionary_zoning_co.json`
- **Source:** Municipal code research + DOLA policy tracking
- **Refresh:** Semi-annual (manual review required)
- **PMA Use:** Policy incentives scoring
- **Coverage:** 9+ municipalities (Denver, Boulder, Fort Collins, Longmont, Lakewood, etc.)
- **Key fields:**
  - `has_iz` — True = mandatory IZ ordinance
  - `iz_percentage_required` — % of units that must be affordable
  - `iz_ami_target_pct` — AMI target for affordable units
  - `fee_in_lieu_per_unit` — In-lieu fee option
  - `density_bonus_pct` — Density bonus for compliance

### 3.3 Climate Hazard Data
- **Script:** `scripts/market/fetch_climate_hazards.py`
- **File:** `data/market/climate_hazards_co.json`
- **Source:** NOAA Climate Normals 1991-2020 + USDA Drought Monitor + USFS wildfire data
- **Coverage:** All 64 Colorado counties (county-level data)
- **Refresh:** Annual (NOAA updates normals decadally; wildfire risk updated annually)
- **PMA Use:** Infrastructure resilience scoring
- **Key fields:**
  - `frost_days` — Average annual frost days
  - `extreme_heat_days` — Average annual days above 95°F
  - `drought_risk` — low | moderate | high
  - `wildfire_risk` — low | moderate | high
  - `avg_annual_precip_in` — Average annual precipitation (inches)

### 3.4 Environmental Constraints
- **Script:** `scripts/market/fetch_environmental_constraints.py`
- **File:** `data/market/environmental_constraints_co.geojson`
- **Source:** EPA EJSCREEN 2023 + CPW State Lands
- **Refresh:** Annual
- **PMA Use:** Development feasibility scoring
- **Key fields:**
  - `constraint_type` — environmental_justice | protected_land | wildlife_corridor
  - `severity` — high | moderate | low
  - `minority_pct`, `low_income_pct` — EJ demographic indicators
  - `cancer_risk_percentile` — Cancer risk percentile (national)

### 3.5 Healthcare Access
- **Script:** `scripts/market/fetch_healthcare_access.py`
- **File:** `data/market/healthcare_access_co.json`
- **Source:** HRSA FQHC Data + CMS Hospital Compare
- **Refresh:** Annual
- **PMA Use:** Neighborhood quality scoring
- **Key fields:**
  - `provider_type` — FQHC | Hospital | RHC
  - `accepts_medicaid` — True = Medicaid accepted
  - `availability` — Service hours description
  - `distance_to_site` — Distance from project site (computed at runtime)

### 3.6 Diversity Metrics
- **Script:** `scripts/market/fetch_diversity_metrics.py`
- **File:** `data/market/diversity_metrics_co.json`
- **Source:** US Census ACS 5-Year Estimates (B02001, B03001, B16001)
- **Vintage:** 2023
- **Refresh:** Annual
- **PMA Use:** Market demand dimension
- **Key fields:**
  - `ethnic_diversity_index` — Shannon entropy racial diversity (0-1)
  - `language_diversity_index` — Non-English language share (0-1)
  - `hispanic_pct` — Hispanic/Latino population share
  - `immigrant_pct` — Hispanic population proxy for immigrant demand

---

## Data Architecture

### File Naming Convention
All output files follow the pattern: `{dataset}_{state}.{ext}`
- `_co` suffix = Colorado statewide
- `.json` = tabular data (tracts or counties)
- `.geojson` = spatial features (FeatureCollection)

### Metadata Schema
Every output file includes a top-level `meta` object:
```json
{
  "meta": {
    "source": "Data source description",
    "vintage": "Data year or release",
    "state": "Colorado",
    "state_fips": "08",
    "generated": "2025-03-23T00:00:00Z",
    "coverage_pct": 95.2,
    "fields": { "field_name": "description" },
    "note": "How to rebuild"
  }
}
```

### FIPS Code Compliance (Rule 1)
All county FIPS codes must be 5-digit zero-padded strings:
- ✅ `"08031"` (Denver)
- ✅ `"08091"` (Ouray)
- ❌ `"8031"` — will cause join failures with CHFA-LIHTC data

### Caching Strategy
- Core build: 24-hour disk cache in `$TMPDIR/pma_build_cache/`
- Phase scripts: No cache by default (run fresh each time)
- Add `--refresh-all` (future feature) to force full rebuild

### Error Handling
- Each script fails gracefully: returns empty output with metadata rather than crashing
- Warnings logged when coverage below threshold
- Non-zero exit only for completely empty/unreadable outputs
- Fallback to cached/existing files when API unavailable

---

## TIGERweb API Notes

**Important:** The TIGERweb ArcGIS REST API requires **double quotes** for string values in WHERE clauses:

```python
# ✅ Correct — double quotes around string value
where=f'STATEFP="{STATE_FIPS}"'

# ❌ Wrong — single quotes cause HTTP 400 error
where=f"STATEFP='{STATE_FIPS}'"
```

All scripts in this repository use the correct double-quote format.

**Full Colorado coverage:** The API paginates using `resultOffset` + `exceededTransferLimit`. The build script automatically pages through all results. For Colorado:
- ~1,300 census tracts
- 64 counties

---

## API Keys and Rate Limits

| Source | Auth Required | Free Tier Limit | Key Registration |
|--------|--------------|-----------------|-----------------|
| Census ACS | Optional | 500/day (unkeyed) | https://api.census.gov/data/key_signup.html |
| HUD APIs | Optional (bearer token) | ~500/day | https://www.huduser.gov/hudapi/public/login |
| NOAA CDO | Optional | 1000/day | https://www.ncdc.noaa.gov/cdo-web/token |
| TIGERweb | None | Generous (public GIS) | N/A |
| NCES ArcGIS | None | Generous (public GIS) | N/A |
| FEMA NFHL | None | Generous (public GIS) | N/A |
| USDA Food Atlas | None | Generous (public GIS) | N/A |
| EPA EJSCREEN | None | Generous (public GIS) | N/A |
| LODES | None | Bulk file downloads | N/A |
| NHPD | None | ~500/day | N/A |
| GTFS feeds | None | Zip file downloads | N/A |

---

## Estimated Data Completeness After Full Build

| Phase | Output files | Estimated accuracy impact |
|-------|-------------|--------------------------|
| Core | 4 files | Baseline |
| Phase 1 | +6 files | +15–20% PMA accuracy |
| Phase 2 | +8 files | +25–30% PMA accuracy |
| Phase 3 | +6 files | +10–15% PMA accuracy |
| **Total** | **24 files** | **+40–50% PMA accuracy** |

---

## Troubleshooting

### TIGERweb 400 Errors
Cause: Single quotes in WHERE clause (`STATEFP='08'` → must be `STATEFP="08"`)  
Fix: All scripts corrected; run `python scripts/market/test_tiger_api.py` to verify

### LODES CSV Download Fails
Cause: LODES8 files for the most recent year may not be published for all states  
Fix: Script uses YEAR=2021 constant; update to 2022 when available at https://lehd.ces.census.gov/data/lodes/LODES8/co/

### Census ACS Returns Empty
Cause: Missing `CENSUS_API_KEY` or API key rate limit exceeded  
Fix: Add key in GitHub Secrets; get free key at https://api.census.gov/data/key_signup.html

### NHPD API Returns Empty
Cause: NHPD API may have changed endpoint or requires auth  
Fix: Check https://preservationdatabase.org/api/ for current documentation

### Phase Scripts Timeout
Cause: Large geographic areas with many features  
Fix: Increase timeout in script constants; FEMA and EPA scripts may be slow for first fetch
