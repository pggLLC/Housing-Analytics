# `js/environmental-screening.js`

js/environmental-screening.js
Environmental Constraints Overlay — Phase 2.1

Assesses environmental risk for a site (lat/lon) using preloaded public
data: FEMA flood zones, EPA Superfund/brownfield sites, and county-level
soil/seismic heuristics.

Non-goals:
  - Does NOT replace a Phase I Environmental Site Assessment (professional required)
  - Does NOT perform real-time API calls — all data is preloaded from local files
  - Does NOT assess zoning or land-use compatibility

Usage:
  EnvironmentalScreening.load(floodGeoJSON, epaData).then(function () {
    var result = EnvironmentalScreening.assess(39.74, -104.99, 1.0);
  });

Exposed as window.EnvironmentalScreening (browser) and module.exports (Node).

@typedef {Object} EnvRiskResult
@property {Object}  floodZone        — { zone, riskLevel, sfha, year100Flood, narrative }
@property {Object}  soil             — { stability, liquefactionRisk, narrative }
@property {Object}  hazmat           — { superfundSites, brownfieldSites, nearestSuperfundMi, narrative }
@property {Object}  culturalHeritage — { nhpd, tribalLand }
@property {string}  riskBadge        — '🟢 Low' | '🟡 Moderate' | '🔴 High'
@property {string}  overallRisk      — 'low' | 'moderate' | 'high'
@property {string}  narrative        — human-readable summary

## Symbols

### `_milesToDegLon(miles, lat)`

Convert miles to degrees longitude at a given latitude.

### `_inBBox(lat, lon, bbox)`

Point-in-bounding-box test.

### `_ringBBox(ring)`

Compute bounding box from ring.

### `_pointInRing(lat, lon, ring)`

Point-in-polygon (ray casting).

### `_pointInFeature(lat, lon, geometry)`

Check if point (lat, lon) is inside a GeoJSON polygon/multipolygon.

### `_distanceMiles(lat1, lon1, lat2, lon2)`

Haversine distance in miles.

### `load(floodGeoJSON, epaData)`

Load environmental datasets into memory.
In a browser environment, fetch the local JSON files.
In Node.js (tests), pass the data directly.

@param {Object|null} floodGeoJSON  - GeoJSON FeatureCollection or null
@param {Object|null} epaData       - EPA JSON object or null
@returns {Promise<void>}

### `assess(lat, lon, bufferMiles)`

Assess environmental risk for a site.

@param {number} lat         - Site latitude (WGS84)
@param {number} lon         - Site longitude (WGS84)
@param {number} [bufferMiles=0.5] - Search radius for hazmat sites
@returns {EnvRiskResult}

### `isLoaded()`

Returns true if data has been loaded via load().
@returns {boolean}
