# `js/pma-infrastructure.js`

js/pma-infrastructure.js
Infrastructure and environmental feasibility INDICATORS.

IMPORTANT: These scores are directional indicators from public datasets,
NOT professional site assessments. They do not replace:
 - Phase I Environmental Site Assessment (ESA)
 - Geotechnical survey
 - Utility will-serve letters
 - FEMA LOMA/LOMR determination
 - Traffic impact study

Responsibilities:
 - fetchFEMAFloodData(boundingBox) — flood hazard zone coverage
 - fetchNOAAClimateData(location, variable) — extreme weather normals
 - fetchUtilityCapacity(boundingBox, jurisdiction) — sewer/water headroom
 - fetchFoodAccessAtlas(boundingBox) — food desert/proximity data
 - buildInfrastructureScorecard(floodData, climateData, utilityData, foodData)
 - getInfrastructureScore() — 0–100 composite feasibility score
 - getInfrastructureLayer() — GeoJSON for map display
 - getInfrastructureJustification() — audit-ready scorecard

Exposed as window.PMAInfrastructure.

## Symbols

### `fetchFEMAFloodData(boundingBox)`

Fetch FEMA flood hazard zone data for a bounding box.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{floodZones: Array, hazardPercent: number}>}

### `fetchNOAAClimateData(location, climateVariable)`

Fetch NOAA climate data for a location.
@param {{lat:number,lon:number}} location
@param {string} [climateVariable] - e.g. "precipitation", "temperature"
@returns {Promise<{normals: object, extremes: object, resilienceScore: number}>}

### `fetchUtilityCapacity(boundingBox, jurisdiction)`

Fetch local utility infrastructure capacity data.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@param {string} [jurisdiction]
@returns {Promise<{sewerHeadroom: number, waterCapacity: number}>}

### `fetchFoodAccessAtlas(boundingBox)`

Fetch USDA Food Access Atlas data.
Delegates to DataService which loads local data/market/food_access_co.json
and computes a proximity index (0-100) from tract-level food desert flags,
low-access indicators, and poverty rates.

@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{foodDeserts: Array, proximityIndex: number, _stub: boolean, _dataSource: string}>}

### `buildInfrastructureScorecard(floodData, climateData, utilityData, foodData)`

Build a comprehensive infrastructure feasibility scorecard.

@param {object} floodData   - {hazardPercent: 0–1}
@param {object} climateData - {resilienceScore: 0–100}
@param {object} utilityData - {sewerHeadroom: 0–1, waterCapacity: 0–1}
@param {object} foodData    - {proximityIndex: 0–100}
@returns {object} scorecard with per-component scores and composite

### `getInfrastructureScore()`

Return the latest composite infrastructure feasibility score (0–100).
@returns {number}

### `getInfrastructureLayer(floodZones, foodDeserts)`

Build GeoJSON FeatureCollection for the infrastructure map layer.
@param {Array} [floodZones]
@param {Array} [foodDeserts]
@returns {object}

### `getInfrastructureJustification()`

Export infrastructure scorecard for ScoreRun audit trail.
@returns {object}
