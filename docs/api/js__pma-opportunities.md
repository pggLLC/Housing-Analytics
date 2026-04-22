# `js/pma-opportunities.js`

js/pma-opportunities.js
Opportunity and incentive overlay analysis for PMA scoring.

Responsibilities:
 - fetchOpportunityZones(boundingBox) — IRS QOZ dataset
 - fetchHudAFFH(boundingBox) — HUD AFFH fair housing opportunity index
 - fetchHudOpportunityAtlas(boundingBox) — economic mobility percentiles
 - calculateOpportunityShare(pmaPolygon, ozZones) — % area in OZ
 - scoreOpportunityIndex(lat, lon, affhData, atlasData) — 0–100 composite
 - determineIncentiveEligibility(opportunityShare, affhScore, atlasPercentile)
 - getOpportunityLayer() — GeoJSON for map display
 - getOpportunityJustification() — audit-ready opportunity metrics

Exposed as window.PMAOpportunities.

## Symbols

### `_estimateOzShare(bbox, ozZones)`

Estimate the fraction of a bounding box that overlaps a list of OZ features.
Uses a point-in-bbox approximation proportional to zone count.
@private

### `fetchOpportunityZones(boundingBox)`

Fetch Opportunity Zones dataset for a bounding box.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{zones: Array, designationYear: Array}>}

### `fetchHudAFFH(boundingBox)`

Fetch HUD AFFH fair housing opportunity index data.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{opportunityIndex: number, segregationMetrics: object}>}

### `fetchHudOpportunityAtlas(boundingBox)`

Fetch HUD Opportunity Atlas economic mobility indicators.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{mobilityIndex: number, percentiles: Array}>}

### `calculateOpportunityShare(pmaPolygon, ozZones)`

Calculate the fraction of the PMA polygon area that falls within
Opportunity Zones.

@param {object} pmaPolygon - GeoJSON Polygon geometry
@param {Array}  ozZones    - OZ feature array from fetchOpportunityZones
@returns {number} share 0.0–1.0

### `scoreOpportunityIndex(lat, lon, affhData, atlasData)`

Compute a composite 0–100 opportunity index for a site location.

@param {number} lat
@param {number} lon
@param {object} affhData   - {opportunityIndex: number} from fetchHudAFFH
@param {object} atlasData  - {mobilityIndex: number} from fetchHudOpportunityAtlas
@returns {number} 0–100

### `determineIncentiveEligibility(opportunityShare, affhScore, atlasPercentile)`

Determine program incentive eligibility based on opportunity metrics.

@param {number} opportunityShare - fraction of PMA in OZ (0–1)
@param {number} affhScore        - 0–100 fair housing score
@param {number} atlasPercentile  - 0–100 economic mobility percentile
@returns {{lihtcBasisStepDown: boolean, newMarketsTaxCredit: boolean, qualifiedOpportunityZone: boolean}}

### `getOpportunityLayer(ozZones)`

Build GeoJSON FeatureCollection for opportunity overlay layer.
@param {Array} [ozZones]
@returns {object}

### `getOpportunityJustification()`

Export opportunity analysis for ScoreRun audit trail.
@returns {object}
