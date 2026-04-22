# `js/pma-transit.js`

js/pma-transit.js
Transit accessibility weighting for PMA delineation.

Responsibilities:
 - fetchNTDData(boundingBox) — National Transit Database service levels
 - fetchEPASmartLocation(boundingBox) — EPA transit accessibility metrics
 - calculateTransitScore(siteLat, siteLon, routes, epaData) — 0–100 score
 - identifyTransitDeserts(pmaPolygon, routes) — gaps in service
 - getTransitLayer() — GeoJSON layer for map display
 - getTransitJustification() — audit-ready transit metrics

Exposed as window.PMATransit.

## Symbols

### `fetchNTDData(boundingBox)`

Fetch National Transit Database service level data.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{transitRoutes: Array, serviceMetrics: object}>}

### `fetchEPASmartLocation(boundingBox)`

Fetch EPA Smart Location Database transit accessibility metrics.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{transitAccessibility: number, walkScore: number}>}

### `calculateTransitScore(siteLat, siteLon, routes, epaData)`

Calculate a comprehensive 0–100 transit accessibility score.
When EPA data is unavailable (null values from failed API), the score
is based solely on local route data and flagged accordingly.

@param {number} siteLat
@param {number} siteLon
@param {Array}  routes   - Transit routes with stops/headways
@param {object} epaData  - EPA Smart Location metrics (may have null values)
@returns {number} 0–100 score

### `identifyTransitDeserts(pmaPolygon, routes)`

Identify transit deserts — zones within the PMA that lack route coverage.
Uses a grid-based approach: cells without a nearby route are "deserts".

@param {object} pmaPolygon - GeoJSON Polygon geometry
@param {Array}  routes
@returns {Array} desert zone descriptors

### `getTransitLayer(routes)`

Build a GeoJSON FeatureCollection for the transit route layer.
@param {Array} [routes]
@returns {object} GeoJSON FeatureCollection

### `getTransitJustification()`

Export transit analysis for ScoreRun audit trail.
Includes _dataSources so the UI can distinguish real vs. unavailable data.
@returns {object}
