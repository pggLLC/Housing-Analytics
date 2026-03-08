# PMA Data Source Enhancements

*Housing Analytics — Colorado LIHTC & Affordable Housing*

This document describes the 15 free public data sources integrated into the enhanced PMA delineation engine, the `DataService` API methods that fetch them, and the caching strategy.

---

## Data Sources

### #14 LEHD / LODES — Job Locations & Commuting Flows

| Property | Value |
|---|---|
| Provider | U.S. Census Bureau, Center for Economic Studies |
| Endpoint | `https://lehd.ces.census.gov/data/lodes/LODES8/co/wac/` |
| DataService method | `DataService.fetchLODES(lat, lon, radiusMiles, vintage)` |
| Vintage | 2021 (updated annually) |
| Cache TTL | 30 days |
| Fallback | Synthetic workplace distribution (concentric rings) |

Returns `{ workplaces: GeoJSON, commutingFlows: [] }`. Used by `PMACommuting` to build commuting-flow-based PMA boundaries.

---

### #17 USGS National Map — Hydrology (NHD)

| Property | Value |
|---|---|
| Provider | U.S. Geological Survey |
| Endpoint | `https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/2/query` |
| DataService method | `DataService.fetchUSGSHydrology(bbox)` |
| Cache TTL | 90 days (stable) |
| Fallback | Empty arrays |

Returns `{ waterBodies: GeoJSON[], streams: GeoJSON[] }`. Used by `PMABarriers` to exclude water features from PMA polygon.

---

### #19 NLCD — Land Cover Classification

| Property | Value |
|---|---|
| Provider | Multi-Resolution Land Characteristics (MRLC) Consortium |
| Endpoint | MRLC WCS (raster; server-side processing required) |
| DataService method | `DataService.fetchNLCDLandCover(bbox)` |
| Cache TTL | 90 days |
| Fallback | Empty arrays (raster requires server-side tiling) |

Barrier codes: `11` (Open Water), `12` (Perennial Ice/Snow), `95` (Emergent Wetlands). Used by `PMABarriers`.

---

### #36 State DOT Traffic Counts — Highway Identification

| Property | Value |
|---|---|
| Provider | U.S. Census TIGERweb Transportation |
| Endpoint | `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/2/query` |
| DataService method | `DataService.fetchStateHighways(bbox)` |
| Query filter | `RTTYP IN ('I','U','S')` — Interstate, US, State routes |
| Cache TTL | 90 days |
| Fallback | Empty arrays |

Returns `{ highways: GeoJSON[], majorRoutes: GeoJSON[] }`. Used by `PMABarriers` to flag major highway barriers.

---

### #32 ED School Attendance Boundaries

| Property | Value |
|---|---|
| Provider | U.S. Department of Education / ArcGIS Online |
| Endpoint | `https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Public_School_Location_201819/FeatureServer/0/query` |
| DataService method | `DataService.fetchSchoolBoundaries(bbox)` |
| Cache TTL | 365 days (boundaries change rarely) |
| Fallback | Empty arrays |

Returns `{ schoolDistricts: GeoJSON[], schools: GeoJSON[] }`. Used by `PMASchools`.

---

### #21 National Transit Database (NTD)

| Property | Value |
|---|---|
| Provider | Federal Transit Administration |
| Endpoint | Annual bulk download (no live spatial query API) |
| DataService method | `DataService.fetchNTDData(bbox)` |
| Cache TTL | 7 days |
| Fallback | Empty stub — transit score uses EPA index only |

Returns `{ transitRoutes: [], serviceMetrics: {} }` until NTD live spatial API is available. Used by `PMATransit`.

---

### #25 EPA Smart Location Database

| Property | Value |
|---|---|
| Provider | U.S. Environmental Protection Agency |
| Endpoint | `https://geodata.epa.gov/arcgis/rest/services/OA/SmartLocationDatabase/MapServer/0/query` |
| DataService method | `DataService.fetchEPASmartLocation(bbox)` |
| Key fields | `D4a` (transit accessibility, 0–20), `D3b` (pedestrian environment, 0–20) |
| Cache TTL | 30 days |
| Fallback | `{ transitAccessibility: 50, walkScore: 50 }` |

Used by `PMATransit` to compute transit and walkability scores.

---

### #4 HUD NHPD — Subsidized Housing Inventory

| Property | Value |
|---|---|
| Provider | HUD National Housing Preservation Database |
| Module | `js/data-connectors/nhpd.js` (pre-loaded inventory) |
| DataService method | `DataService.fetchHudNhpd(bbox)` |
| Cache TTL | In-memory (loaded once per session) |
| Fallback | Empty arrays when NHPD connector not loaded |

Returns `{ properties: [], subsidyMetadata: [] }`. Used by `PMACompetitiveSet` to flag subsidy expiry risk.

---

### #24 Opportunity Zones Dataset

| Property | Value |
|---|---|
| Provider | U.S. Treasury / HUD ArcGIS Online |
| Endpoint | `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/0/query` |
| DataService method | `DataService.fetchOpportunityZones(bbox)` |
| Cache TTL | 30 days (designations are permanent) |
| Fallback | Empty arrays |

Returns `{ zones: GeoJSON[], designationYear: number[] }`. Used by `PMAOpportunities` to calculate OZ share and incentive eligibility.

---

### #8 HUD AFFH Data — Fair Housing Opportunity Index

| Property | Value |
|---|---|
| Provider | HUD Office of Fair Housing |
| Endpoint | HUD AFFH API (requires HUD API key for full access) |
| DataService method | `DataService.fetchHudAFFH(bbox)` |
| Cache TTL | 30 days |
| Fallback | `{ opportunityIndex: 50 }` |

Returns `{ opportunityIndex: 0–100, segregationMetrics: {} }`. Used by `PMAOpportunities`.

---

### #7 HUD Opportunity Atlas

| Property | Value |
|---|---|
| Provider | Opportunity Insights / HUD |
| Endpoint | Opportunity Atlas API |
| DataService method | `DataService.fetchHudOpportunityAtlas(bbox)` |
| Cache TTL | 30 days |
| Fallback | `{ mobilityIndex: 50 }` |

Returns `{ mobilityIndex: 0–100, percentiles: [] }`. Used by `PMAOpportunities`.

---

### #18 NOAA Climate Data

| Property | Value |
|---|---|
| Provider | NOAA National Centers for Environmental Information (NCEI) |
| Endpoint | `https://www.ncdc.noaa.gov/cdo-web/api/v2/data` |
| DataService method | `DataService.fetchNOAAClimateData(location, variable)` |
| Auth | Requires `APP_CONFIG.NOAA_CDO_TOKEN` |
| Cache TTL | 30 days |
| Fallback | `{ normals: {}, extremes: {}, resilienceScore: 50 }` |

Used by `PMAInfrastructure` to compute climate resilience score.

---

### #39 Utility Infrastructure Data

| Property | Value |
|---|---|
| Provider | Local jurisdiction GIS (no national API) |
| DataService method | `DataService.fetchUtilityCapacity(bbox, jurisdiction)` |
| Fallback | `{ sewerHeadroom: 0.5, waterCapacity: 0.5 }` |

Returns headroom fractions (0–1). Used by `PMAInfrastructure`.

---

### #20 USDA Food Access Atlas

| Property | Value |
|---|---|
| Provider | USDA Economic Research Service |
| Endpoint | ERS ArcGIS services (annual update) |
| DataService method | `DataService.fetchFoodAccessAtlas(bbox)` |
| Cache TTL | 30 days |
| Fallback | `{ foodDeserts: [], proximityIndex: 50 }` |

Used by `PMAInfrastructure` to flag food desert conditions.

---

### FEMA National Flood Hazard Layer

| Property | Value |
|---|---|
| Provider | FEMA |
| Endpoint | `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query` |
| DataService method | `DataService.fetchFEMAFloodData(bbox)` |
| Query filter | `FLD_ZONE IN ('AE','AO','A','AH')` |
| Cache TTL | 30 days |
| Fallback | `{ floodZones: [], hazardPercent: 0.05 }` |

Used by `PMAInfrastructure` to calculate flood risk score.

---

## Caching Strategy

All `DataService` PMA fetch methods follow a **two-tier caching model**:

1. **`CacheManager` (localStorage + in-memory)** — responses cached with a per-method TTL (see table above). Key format: `pma:{method}:{bbox_hash}`.
2. **Graceful degradation** — if a fetch fails for any reason (network, CORS, rate limit), the method returns a safe neutral stub value rather than throwing. The analysis continues with available data.
3. **Cache invalidation** — cache is invalidated when `data_vintage` changes (detected by comparing vintage string in cached entry vs current `DATA_VINTAGE` constant in `pma-justification.js`).

## API Key Configuration

Only NOAA CDO requires an API key. Add to `js/config.js`:

```javascript
window.APP_CONFIG = {
  NOAA_CDO_TOKEN: 'your-token-here',
  // ...existing keys
};
```

All other sources are fully open without authentication.
