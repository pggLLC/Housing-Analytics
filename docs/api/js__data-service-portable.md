# `js/data-service-portable.js`

js/data-service-portable.js
Centralised data-loading service.  Exposes window.DataService with:

  DataService.getJSON(path)                  — fetch any JSON by full/resolved path
  DataService.getGeoJSON(path)               — alias for getJSON, for GeoJSON assets
  DataService.baseData(filename)             — resolve "data/<filename>"
  DataService.baseMaps(filename)             — resolve "maps/<filename>"
  DataService.fredObservations(seriesId, p)  — FRED API call with key injection
  DataService.census(url)                    — Census API call (key already in URL or injected)

All local asset loads go through safeFetchJSON (defined in fetch-helper.js).
API keys are read from window.APP_CONFIG; a console warning is emitted if missing.

## Symbols

### `fredObservations(seriesId, params)`

Fetch observations from the FRED API.
LIVE: Makes a real network request to api.stlouisfed.org.
Requires APP_CONFIG.FRED_API_KEY; logs and re-throws on failure so callers
(e.g. Promise.allSettled wrappers) can handle individual source failures.
@param {string} seriesId   - FRED series ID (e.g. "CPIAUCSL")
@param {object} [params]   - Additional query params (units, limit, sort_order, etc.)
@returns {Promise<object>} - Parsed FRED response

### `census(url)`

Make a Census Bureau API call.
LIVE: Makes a real network request to api.census.gov.
If the URL already contains "&key=" the key is not appended again.
Logs and re-throws on failure so callers can handle source failures gracefully.
@param {string} url - Full Census API URL (key may or may not be present)
@returns {Promise<any>}

### `getText(relativePath)`

Fetch a non-JSON text asset (e.g. CSV, TXT) by relative path.
Uses resolveAssetUrl for base-path resolution, plain fetch for text.
@param {string} relativePath
@returns {Promise<string>}

### `_localLodesData`

Cached local LODES data (loaded once from data/market/lodes_co.json).
@type {Object|null}

### `_loadLocalLodesData()`

Load the local LODES tract data (from fetch_lodes.py output).
@returns {Promise<Object|null>}

### `fetchLODES(lat, lon, radiusMiles, vintage)`

Fetch LEHD LODES commuting and employment data.
Loads from local data/market/lodes_co.json (populated by fetch_lodes.py).
Falls back to LODES_PROXY_URL if configured, or empty result.

@param {number} lat
@param {number} lon
@param {number} radiusMiles
@param {string} [vintage]   - LODES vintage year
@returns {Promise<{workplaces: Array, commutingFlows: Array}>}

### `fetchUSGSHydrology(bbox)`

Fetch USGS National Hydrography Dataset (NHD) water features.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{waterBodies: Array, streams: Array}>}

### `fetchNLCDLandCover(bbox)`

Fetch NLCD land cover classification summary for a bounding box.
Uses the MRLC WMS/WCS service.
STUB: NLCD data is raster and requires server-side processing; returns empty
arrays until a raster-processing proxy is configured.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{landCover: Array, classifications: Array}>}

### `fetchStateHighways(bbox)`

Fetch state DOT highway data from the USGS National Transportation Dataset.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{highways: Array, majorRoutes: Array}>}

### `fetchSchoolBoundaries(bbox)`

Fetch ED school attendance boundaries and NCES school data.
Uses the USGS ArcGIS service for attendance boundaries.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{schoolDistricts: Array, schools: Array}>}

### `fetchNTDData(bbox)`

Fetch transit route data.
Loads from local transit_routes_co.geojson (GTFS-derived, 508 routes)
when available; falls back to empty array otherwise.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{transitRoutes: Array, serviceMetrics: object, _dataSource: string}>}

### `_loadEpaSldLocal()`

Load the local EPA SLD block-group data file (fetched by fetch_epa_sld.py).
Returns the parsed JSON or null if the file is unavailable.

### `_loadTractCentroids()`

Load tract centroids for bbox-to-tract matching.

### `_tractsInBbox(tracts, bbox)`

Given a bounding box, find tract GEOIDs whose centroids fall inside.

### `_averageEpaSldForTracts(sldData, tractGeoids)`

Average EPA SLD metrics across block groups matching the given tract GEOIDs.
Block group GEOID (12 digits) shares first 11 digits with tract GEOID (11 digits).

### `fetchEPASmartLocation(bbox, tractFips)`

Fetch EPA Smart Location Database transit accessibility metrics.

Strategy:
  1. Try local file (data/market/epa_sld_co.json) — match block groups
     to tracts whose centroids fall within the bounding box.
  2. Fall back to live EPA ArcGIS API if local file unavailable.
  3. Return null values if both fail.

@param {{minLat,minLon,maxLat,maxLon}} bbox
@param {string} [tractFips] - Optional 11-digit tract GEOID for direct lookup
@returns {Promise<{transitAccessibility: number, walkScore: number, _dataSource: string}>}

### `fetchHudNhpd(bbox)`

Fetch HUD NHPD subsidized housing data via the HUD eGIS API.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{properties: Array, subsidyMetadata: Array}>}

### `_loadOpportunityInsights()`

Load Opportunity Insights tract data from local JSON (cached).
@returns {Promise<{meta: object, tracts: object}>}

### `_tractsInBbox(bbox)`

Find tracts within a bounding box using cached centroid data.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<Array<string>>} Array of 11-digit FIPS codes

### `fetchHudOpportunityAtlas(bbox)`

Fetch Opportunity Atlas economic mobility data for tracts in a bounding box.
Loads from local data/market/opportunity_insights_co.json (Opportunity Insights,
Harvard/Brown — Chetty/Hendren tract-level outcomes).
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{mobilityIndex: number|null, percentiles: Array, _stub: boolean, _dataSource: string}>}

### `fetchHudAFFH(bbox)`

Fetch fair housing opportunity index data, using Opportunity Insights
mobility metrics as a proxy.  High upward mobility + low incarceration
rates correlate with fair housing opportunity.

Derived opportunityIndex:
  70% mobility component (higher mobility = more opportunity)
  30% safety component (lower incarceration = more opportunity)

@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{opportunityIndex: number|null, segregationMetrics: object, _stub: boolean}>}

### `fetchOpportunityZones(bbox)`

Fetch Opportunity Zones dataset for a bounding box.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{zones: Array, designationYear: Array}>}

### `_loadClimateData()`

Load climate hazards from local JSON (pre-fetched by fetch_climate_and_environment.py).
@returns {Promise<Object>}

### `fetchNOAAClimateData(location, climateVariable)`

Derive a resilience score (0-100) from Colorado climate hazard data.
Higher = more resilient (fewer hazards). Scores the 6 hazard categories
and, if available, EJI tract-level environmental burden data.

Local-first: loads data/market/climate_hazards_co.json (built by
scripts/market/fetch_climate_and_environment.py). Falls back to NOAA CDO
live API if local data is empty and a token is configured.

@param {{lat:number,lon:number}} location
@param {string} [climateVariable]
@returns {Promise<{normals: object, extremes: object, resilienceScore: number, hazards: object, _stub: boolean, _dataSource: string}>}

### `_loadUtilityData()`

Load utility service area data from local GeoJSON
(pre-fetched by scripts/market/fetch_utility_capacity.py).
@returns {Promise<Object>}

### `fetchUtilityCapacity(bbox, jurisdiction)`

Fetch utility infrastructure capacity data for a bounding box.
Local-first: loads data/market/utility_capacity_co.geojson (CDSS/DWR/DOLA
water district and municipal service area boundaries). When features exist,
returns a coverage-based capacity estimate. When no features are found,
returns null values with _stub:true.

@param {{minLat,minLon,maxLat,maxLon}} bbox
@param {string} [jurisdiction]
@returns {Promise<{sewerHeadroom: number|null, waterCapacity: number|null, _stub: boolean, _dataSource: string}>}

### `_loadFoodAccess()`

Load USDA Food Access Atlas data from local JSON (cached).
@returns {Promise<{meta: object, tracts: object}>}

### `fetchFoodAccessAtlas(bbox)`

Fetch USDA Food Access Atlas data for a bounding box.
Loads local data/market/food_access_co.json (USDA ERS 2019), finds tracts
in the bbox, and computes a proximity index (0-100) where higher = better access.

@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{foodDeserts: Array, proximityIndex: number|null, _stub: boolean, _dataSource: string}>}

### `_localFloodData`

Cached local flood zone data (loaded once from data/market/flood_zones_co.json).
@type {Object|null}

### `_loadLocalFloodData()`

Load the local flood zone tract summary (from fetch_fema_nfhl.py output).
@returns {Promise<Object|null>}

### `fetchFEMAFloodData(bbox)`

Fetch FEMA National Flood Hazard Layer data.
Prefers local tract-level summary (data/market/flood_zones_co.json) when
available; falls back to live FEMA NFHL ArcGIS query.
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{floodZones: Array, hazardPercent: number}>}
