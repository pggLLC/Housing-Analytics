# GIS Data Model Architecture — Housing Analytics

*Housing Analytics — Colorado LIHTC & Affordable Housing*

---

## 1. Data Folder Structure

> *This reflects the current repository layout as of March 2026.*

```
data/
├── allocations.json               # LIHTC state allocation history
├── census-acs-state.json          # ACS 5-year state-level estimates
├── chfa-lihtc.json                # CHFA LIHTC project list (fetched by CI; 716 features)
├── co_ami_gap_by_county.json      # AMI gap calculations by county
├── co-county-boundaries.json      # GeoJSON — Colorado county boundaries
├── co-county-demographics.json    # County-level ACS demographic variables
├── co-county-economic-indicators.json # County-level economic indicator data
├── co-demographics.json           # Statewide ACS variables (B25070, B11001…)
├── co-historical-allocations.json # Historical Colorado LIHTC allocation data
├── dda-colorado.json              # Difficult Development Areas — Colorado
├── fred-data.json                 # FRED series (vacancy, permits, HPI…)
├── hud-fmr-income-limits.json     # HUD Fair Market Rents / Income Limits (FY2025)
├── lihtc-trends-by-county.json    # LIHTC unit trend data (64 counties)
├── manifest.json                  # Feature counts and timestamps for CI-built files
├── qct-colorado.json              # Qualified Census Tracts — Colorado
├── states-10m.json                # TopoJSON — US states (10m resolution)
│
├── amenities/                     # Points of interest for PMA scoring
│   └── (generated on demand from OpenStreetMap Overpass API)
│
├── boundaries/                    # Additional boundary geometries
│
├── derived/                       # ETL-computed derived datasets
│
├── hna/                           # Housing Needs Assessment data
│   ├── geo-config.json            # Featured geographies (counties, places, CDPs)
│   ├── local-resources.json       # Curated local housing authority / advocacy links
│   ├── chas_affordability_gap.json # CHAS-derived affordability gap estimates
│   ├── summary/{geoid}.json       # ACS profile + S0801 commuting cache per geography
│   ├── lehd/{countyFips5}.json    # LEHD LODES inflow/outflow; employment by industry
│   ├── dola_sya/{fips5}.json      # DOLA/SDO single-year-of-age pyramid
│   ├── projections/{fips5}.json   # DOLA/SDO 20-year population + housing-need model
│   ├── lihtc/{countyFips5}.json   # Per-county LIHTC features (64 files)
│   └── derived/geo-derived.json   # ETL-computed inputs for municipal scaling
│
├── kalshi/                        # Kalshi prediction market data
│   └── prediction-market.json
│
├── market/                        # Market signals & comparable data
│   ├── acs_tract_metrics_co.json  # ACS 5-year tract-level metrics
│   ├── hud_lihtc_co.geojson       # HUD LIHTC Colorado properties
│   ├── lodes_co.json              # LEHD LODES employment data
│   ├── nhpd_co.geojson            # NHPD preservation-at-risk properties
│   ├── reference-projects.json    # 50 CO benchmark comparable projects
│   └── tract_centroids_co.json    # Colorado census tract centroids
│
└── policy/                        # Policy & eligibility layers
    └── prop123_jurisdictions.json # Prop 123 commitment list (municipalities + counties)
```

---

## 2. Entity Schemas

### 2.1 Jurisdiction

Represents a local government unit (municipality or county).

```json
{
  "id": "string (FIPS or slug)",
  "name": "string",
  "kind": "municipality | county | city-county",
  "fips_state": "08",
  "fips_county": "string (3-digit)",
  "fips_place": "string (5-digit, municipalities only)",
  "prop123_committed": "boolean",
  "prop123_filing_date": "YYYY-MM-DD | null",
  "inclusionary_rate": "number (0–1) | null",
  "geometry": "GeoJSON Polygon | MultiPolygon | null"
}
```

### 2.2 Site

Represents a parcel or development site under evaluation.

```json
{
  "id": "string (UUID)",
  "name": "string",
  "address": "string",
  "lat": "number",
  "lng": "number",
  "parcel_id": "string | null",
  "jurisdiction_id": "string",
  "area_acres": "number | null",
  "zoning_code": "string | null",
  "fema_flood_zone": "string | null",
  "created_at": "ISO 8601 datetime",
  "geometry": "GeoJSON Point | Polygon | null"
}
```

### 2.3 PMA (Primary Market Area)

```json
{
  "id": "string (UUID)",
  "site_id": "string",
  "mode": "buffer | isochrone",
  "drive_time_minutes": 15,
  "buffer_radius_miles": "number | null",
  "created_at": "ISO 8601 datetime",
  "geometry": "GeoJSON Polygon"
}
```

### 2.4 Property

LIHTC or affordable housing property.

```json
{
  "id": "string (HUD project ID or CHFA ID)",
  "name": "string",
  "address": "string",
  "city": "string",
  "county": "string",
  "state": "CO",
  "lat": "number",
  "lng": "number",
  "total_units": "integer",
  "lihtc_units": "integer",
  "program_type": "LIHTC-9% | LIHTC-4% | Section-8 | HOME | other",
  "ami_band_max": "number (e.g. 60 for 60% AMI)",
  "year_placed_in_service": "integer | null",
  "credit_type": "9% | 4% | mixed | null",
  "data_source": "CHFA | HUD | local",
  "geometry": "GeoJSON Point | null"
}
```

### 2.5 Amenity

Point-of-interest used in PMA access scoring.

```json
{
  "id": "string",
  "name": "string",
  "category": "school | grocery | transit_stop | healthcare | park",
  "lat": "number",
  "lng": "number",
  "source": "osm | gtfs | census",
  "osm_id": "string | null"
}
```

### 2.6 Metrics

Tract- or county-level ACS/market metrics used for scoring.

```json
{
  "geo_id": "string (FIPS tract or county FIPS)",
  "geo_type": "tract | county",
  "vintage_year": "integer (ACS release year)",
  "rent_burden_share": "number (0–1)",
  "household_count": "integer",
  "household_growth_rate_5yr": "number",
  "vacancy_rate": "number (0–1)",
  "median_gross_rent": "number",
  "median_household_income": "number",
  "pct_renter_occupied": "number (0–1)",
  "lihtc_units_per_1k_hh": "number",
  "pipeline_units_per_1k_hh": "number"
}
```

### 2.7 ScoreRun

Stores a score calculation result with full explainability.

```json
{
  "run_id": "string (UUID)",
  "site_id": "string",
  "pma_id": "string",
  "created_at": "ISO 8601 datetime",
  "data_vintage": "string (e.g. ACS-2022)",
  "weight_overrides": "object | null",
  "scores": {
    "pma_score": "number (0–100)",
    "access_score": "number (0–100)",
    "demand_score": "number (0–100)",
    "competition_score": "number (0–100)",
    "policy_score": "number (0–100)",
    "site_score": "number (0–100)"
  },
  "components": {
    "access": {
      "school_proximity_score": "number",
      "grocery_proximity_score": "number",
      "transit_stop_score": "number",
      "healthcare_proximity_score": "number",
      "raw_composite": "number",
      "percentile_rank": "number"
    },
    "demand": {
      "rent_burden_share": "number",
      "household_growth_rate": "number",
      "job_accessibility": "number",
      "raw_composite": "number",
      "percentile_rank": "number"
    },
    "competition": {
      "lihtc_units_per_1k_hh": "number",
      "pipeline_pressure": "number",
      "vacancy_proxy": "number",
      "raw_composite": "number",
      "percentile_rank": "number"
    },
    "policy": {
      "prop123_committed": "boolean",
      "inclusionary_rate": "number",
      "flood_risk_inverse": "number",
      "rezoning_opportunity": "boolean",
      "raw_composite": "number",
      "percentile_rank": "number"
    }
  }
}
```

---

## 3. Data Pipeline Descriptions

### 3.1 LIHTC Inventory

**Canonical fetch script:** `scripts/fetch-chfa-lihtc.js` — run weekly by `.github/workflows/fetch-chfa-lihtc.yml`.

**Update cadence:** Every Monday at 05:00 UTC (offset 1 h after the QCT/DDA cache at 04:00).  Run manually via the GitHub Actions UI ("Fetch CHFA LIHTC Data" → "Run workflow") whenever:
- The cached file is missing or stale after a fresh clone or branch reset.
- CHFA releases a new allocation round or updates project records.
- HUD annual LIHTC database vintage changes (typically Q4).

1. **Fetch**: `fetch-chfa-lihtc.yml` runs `scripts/fetch-chfa-lihtc.js`, which queries the CHFA ArcGIS FeatureServer (CHFA primary → HUD ArcGIS fallback) for all Colorado LIHTC projects.
2. **Transform**: Raw ArcGIS features normalized to the `Property` schema; FIPS codes zero-padded to 5 digits; `fetchedAt` ISO-8601 UTC timestamp and `source` URL written to the top-level JSON envelope.
3. **Cache**: Written to `data/chfa-lihtc.json` (GeoJSON FeatureCollection with `fetchedAt` / `source` metadata); also split per-county to `data/hna/lihtc/{fips5}.json` by `scripts/split-lihtc-by-county.js`.
4. **Serve**: `co-lihtc-map.js` uses a four-tier fallback: CHFA ArcGIS → HUD ArcGIS → `data/chfa-lihtc.json` → embedded JSON. When reading from the local file, the `fetchedAt` date is displayed in the `#map-status` bar (e.g. "Source: local backup (716 projects) · cache: 2025-10-14").
5. **HNA page**: `housing-needs-assessment.js` also reads `data/chfa-lihtc.json`; the `fetchedAt` date is shown in `#lihtcMapStatus` (e.g. "Source: local · cache: 2025-10-14").

### 3.2 Prop 123 Jurisdictions

1. **Source**: DOLA commitment filings list (public) — manual update process
2. **Local file**: `data/prop123_jurisdictions.json` — updated via PR when new commitments are filed
3. **Geometry**: Fetched at runtime from Census TIGERweb ArcGIS (Places + Counties layers) using STATEFP='08' filter
4. **Fallback**: If TIGERweb is unavailable, jurisdiction list still renders in the table (no map overlay)

### 3.3 Census ACS Demographics

1. **Fetch**: GitHub Actions `fetch-census-acs.yml` calls Census Bureau Data API (`api.census.gov`) with state-level and county-level variables
2. **Transform**: JSON response reshaped to `Metrics` schema; county FIPS codes standardized
3. **Cache**: Written to `data/census-acs-state.json` and `data/co-demographics.json`

### 3.4 DDA / QCT Overlays

**Canonical fetch workflow:** `.github/workflows/cache-hud-gis-data.yml` (primary, runs Monday 04:00 UTC).  A secondary workflow `fetch-lihtc-data.yml` also writes the same files on Sundays at 07:00 UTC (see Redundancy Analysis in DATA-SOURCES.md).

**Update cadence:** Weekly on Monday at 04:00 UTC.  Run manually via the GitHub Actions UI ("Cache HUD GIS Overlay Data" → "Run workflow") whenever:
- The cached files are missing or stale after a fresh clone.
- HUD releases a new QCT or DDA designation vintage (e.g. 2026 → 2027).
- A new featured geography needs its tracts pre-cached.

1. **Source**: HUD ArcGIS FeatureServers — `Qualified_Census_Tracts_2026` and `Difficult_Development_Areas_2026` (public, no API key).
2. **Fetch**: `cache-hud-gis-data.yml` queries HUD ArcGIS REST using paginated GeoJSON requests with `outSR=4326`; a `fetchedAt` ISO-8601 UTC timestamp and `source` URL are written to the top-level JSON envelope.
3. **Transform**: DDA features normalized by `scripts/normalize-dda.js` (maps `DDA_NAME → NAME`, `DDA_CODE → GEOID`, etc.); `fetchedAt` is preserved through normalization.
4. **Cache**: Written to `data/qct-colorado.json` and `data/dda-colorado.json`.
5. **Serve**: `co-lihtc-map.js` reads local cache first; falls back to embedded representative polygons. The `fetchedAt` date from the cached files is displayed in `#map-source-date` (e.g. "Data: QCT/DDA cache: 2025-10-14").

### 3.5 PMA Geometry (Buffer Mode)

1. **Input**: Site latitude/longitude from user input or parcel lookup
2. **Compute**: Turf.js `circle()` generates a GeoJSON polygon at 12-mile (primary) and 25-mile (secondary) radii
3. **No external dependency**: Runs entirely in-browser; no routing API required

### 3.6 PMA Geometry (Isochrone Mode)

1. **API**: OpenRouteService Isochrone API (free tier, public key) or Mapbox Isochrone
2. **Request**: POST with site coordinates, profile `driving-car`, range `[900, 1800]` seconds (15/30 min)
3. **Fallback**: If API unavailable, automatically fall back to buffer mode

---

## 4. Notes on Explainability & Score Audit Trail

- Every `ScoreRun` record stores the full `components` breakdown so analysts can see exactly why a site scored high or low
- `data_vintage` ties each score run to a specific ACS release so results can be reproduced
- `weight_overrides` allows analyst customization without losing the default weight baseline
- Score runs should be stored client-side (IndexedDB or localStorage) and optionally exported as JSON/CSV
