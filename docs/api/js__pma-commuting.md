# `js/pma-commuting.js`

js/pma-commuting.js
LEHD/LODES-based commuting flow analysis for PMA delineation.

Responsibilities:
 - fetchLODESWorkplaces(lat, lon, radiusMiles) — workplace locations near site
 - analyzeCommutingFlows(workplaces) — identify resident origin zones
 - generateCommutingBoundary(lat, lon, flows) — produce weighted PMA polygon
 - getJustificationData() — export audit-ready commuting metrics

Replaces simple circular buffer with commuting-weighted polygon, capturing
approximately 70–80 % of likely residents based on LODES WAC/RAC data.

Exposed as window.PMACommuting.
Uses DataService (window.DataService) when available; degrades gracefully.

## Symbols

### `buildConvexHullPolygon(points)`

Build a simple convex-hull-style bounding polygon from an array of
{lat, lon} points. Returns a GeoJSON Polygon geometry or null.
@param {Array.<{lat:number,lon:number}>} points
@returns {object|null}

### `fetchLODESWorkplaces(lat, lon, radiusMiles, vintage)`

Fetch LODES workplace locations within a given radius of a site.
Calls DataService.fetchLODES when available; returns empty stub otherwise.

@param {number} lat        - Site latitude
@param {number} lon        - Site longitude
@param {number} [radiusMiles] - Search radius (default 30 miles)
@param {string} [vintage]  - LODES vintage year (default "2023")
@returns {Promise<{workplaces: Array, commutingFlows: Array}>}

### `_buildSyntheticWorkplaces(lat, lon, radiusMiles)`

Build synthetic workplace locations for fallback (no live API).
Distributes points in concentric rings around the site.
@private

### `analyzeCommutingFlows(workplaces)`

Analyse commuting flow patterns to identify resident origin zones.
Returns sorted list of origin zones by estimated resident count.

@param {Array} workplaces - Array of workplace objects with lat, lon, jobCount
@returns {{originZones: Array, totalWorkers: number}}

### `generateCommutingBoundary(siteLat, siteLon, flowResult)`

Generate a commuting-weighted PMA boundary polygon.
Uses origin zone centroids to build a convex hull that encloses the
primary resident catchment area.

@param {number} siteLat
@param {number} siteLon
@param {{originZones: Array}} flowResult - output of analyzeCommutingFlows
@returns {{boundary: object|null, captureRate: number, zoneCentroids: Array}}

### `_circlePolygon(lat, lon, radiusMiles, sides)`

Build a circular GeoJSON polygon approximation.
@private

### `getJustificationData()`

Export commuting analysis justification data for ScoreRun audit trail.
@returns {object}
