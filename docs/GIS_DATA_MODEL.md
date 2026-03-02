# GIS Data Model Architecture — Housing Analytics

*Housing Analytics — Colorado LIHTC & Affordable Housing*

---

## 1. Data Folder Structure

```
data/
├── core/                          # Shared base geography
│   ├── states-10m.json            # TopoJSON — US states (10m resolution)
│   └── co-county-boundaries.json  # GeoJSON — Colorado county boundaries
│
├── housing/                       # LIHTC & affordable housing inventory
│   ├── chfa-lihtc.json            # CHFA LIHTC project list (fetched by CI)
│   └── hna/                       # Housing Needs Assessment projections
│       └── co-hna-2025.json
│
├── demographics/                  # ACS population & household data
│   ├── census-acs-state.json      # ACS 5-year state-level estimates
│   └── co-demographics.json       # County-level ACS variables (B25070, B11001…)
│
├── amenities/                     # Points of interest for PMA scoring
│   └── (generated on demand from OpenStreetMap Overpass API)
│
├── policy/                        # Policy & eligibility layers
│   ├── prop123_jurisdictions.json # Prop 123 commitment list (municipalities + counties)
│   ├── dda-colorado.json          # Difficult Development Areas — Colorado
│   └── qct-colorado.json          # Qualified Census Tracts — Colorado
│
└── market/                        # Market signals & economic indicators
    ├── fred-data.json             # FRED series (vacancy, permits, HPI…)
    ├── car-market.json            # CAR market KPIs (median price, DOM…)
    ├── co_ami_gap_by_county.json  # AMI gap calculations by county
    └── allocations.json           # State LIHTC allocation history
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

1. **Fetch**: GitHub Actions `fetch-chfa-lihtc.yml` queries CHFA ArcGIS Feature Service (public endpoint) nightly; falls back to HUD LIHTC ArcGIS if CHFA is unavailable
2. **Transform**: Raw feature records normalized to `Property` schema; coordinates extracted from ArcGIS geometry
3. **Cache**: Written to `data/chfa-lihtc.json`; in-browser `localStorage` cache with 24-hour TTL
4. **Serve**: `co-lihtc-map.js` reads local file first; fetches live on stale/miss

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

1. **Source**: HUD ArcGIS Feature Services (public)
2. **Fetch**: On-demand from `co-lihtc-map.js` when user enables the overlay
3. **Cache**: Response cached in `localStorage` for 7 days

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
