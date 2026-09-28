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

Fetch NCES school locations inside a bounding box.

Loads the committed `data/market/schools_co.geojson` — 1,941 real schools
from the NCES Common Core of Data, School Locations 2021-22. This replaces
an ArcGIS FeatureServer query that returned `{"error":{"code":400}}`; the
hosting org still answers with 527 services, none of them school-related,
so the layer was removed rather than renamed (#1541). The failure was
silent — a `.catch` returning empty arrays — so every PMA run scored the
schools dimension on nothing while still citing the source.

`schoolDistricts` is deliberately empty: this file carries school *points*,
not attendance-boundary polygons. The old code returned the same array for
both, which is why "districts aligned" was really "schools nearby".

@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{schoolDistricts: Array, schools: Array, _dataSource: string}>}

### `TRANSIT_STOPS_PATH`

The statewide transit stop file, for the PMA transit score.

Scoring reads confirmed stops, never route geometry (owner decision
2026-09-27): the old fetchNTDData() sampled ~10 vertices per route from
the route-line file as pseudo-stops, so the score moved with the file's
vertex count rather than with where transit is.

The file is ~4 MB and does not change within a page visit, so it is
fetched once per page and the parsed copy is shared by every PMA run
(and by the market-analysis TOD check). A failed load is not cached:
the next run tries again.

Resolves (never rejects) to
  { geojson: FeatureCollection|null, unavailableReason: string|null,
    _dataSource: 'local-stops'|'unavailable', path }

### `TRANSIT_ZONE_STATUS_PATH`

The zone-map status file: the two HB26-1065 distances the PMA transit
score uses (zone_radius_miles and qap_tod_distance.miles), read through
js/transit-zone.js. Fetched once per page; a failed load is not cached.

Resolves (never rejects) to { mapStatus: object|null, unavailableReason }.

### `_loadEpaSldLocal()`

Load the local EPA SLD block-group data file (fetched by fetch_epa_sld.py).
Returns the parsed JSON or null if the file is unavailable.

### `_loadEpaSldGeometry()`

Load the 2010 block-group boundaries the EPA SLD is published on
(data/market/epa_sld_bg_geometry_co.geojson, same GEOID set as
epa_sld_co.json) and index each one by its envelope.

The repo's tract file is TIGER 2020. EPA SLD v3 is on 2010 block groups, so
selecting by 2020 tract prefix could never reach the 667 block groups whose
2010 tract no longer exists, and found nothing for the 384 2020 tracts with
no 2010 namesake.

Resolves null when the file is unavailable, so the caller falls back.

### `_pointInRings(x, y, rings)`

Even-odd ray cast over every ring of one polygon, so holes are excluded.

### `_segmentHitsBbox(ax, ay, bx, by, bbox)`

Liang-Barsky: does segment (ax,ay)-(bx,by) touch the bbox?

### `_epaBlockGroupsInBbox(index, bbox)`

GEOIDs of every 2010 block group whose boundary intersects the bbox — the
polygon, not its envelope, which would take in a rural block group that
only wraps around a corner. A polygon meets a rectangle exactly when one of
its edges touches the rectangle or the rectangle lies wholly inside it.

### `_averageEpaSldForBlockGroups(sldData, bgIds)`

Average EPA SLD metrics across the given 12-digit block-group GEOIDs.

### `fetchEPASmartLocation(bbox)`

Fetch EPA Smart Location Database transit accessibility metrics.

Strategy:
  1. Try local files — average the block groups in data/market/epa_sld_co.json
     whose 2010 boundaries (epa_sld_bg_geometry_co.geojson) intersect the bbox.
  2. Fall back to live EPA ArcGIS API if a local file is unavailable or no
     block group intersects the bbox.
  3. Return null values if both fail.

@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {Promise<{transitAccessibility: null, walkScore: number|null, _dataSource: string}>}

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
@returns {Promise<{normals: object, extremes: object, resilienceScore: number|null, hazards: object, _stub: boolean, _dataSource: string, unavailableReason?: string|null}>}

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
