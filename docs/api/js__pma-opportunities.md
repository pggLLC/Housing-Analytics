# `js/pma-opportunities.js`

js/pma-opportunities.js
Opportunity and incentive overlay analysis for PMA scoring.

Responsibilities:
 - fetchOpportunityZones() — tracked CDFI designation polygons
 - fetchHudAFFH(boundingBox) — HUD AFFH fair housing opportunity index
 - fetchHudOpportunityAtlas(boundingBox) — economic mobility percentiles
 - siteOpportunityZone(lat, lon, zones) — exact site point-in-polygon
 - scoreOpportunityIndex(lat, lon, affhData, atlasData, zones) — 0–100 composite
 - determineIncentiveEligibility(siteStatus)
 - getOpportunityLayer() — GeoJSON for map display
 - getOpportunityJustification() — audit-ready opportunity metrics

Exposed as window.PMAOpportunities.

## Symbols

### `siteOpportunityZone(lat, lon, zones)`

Check the exact site against CDFI designation polygons (GeoJSON or features).
Missing coordinates, missing data and invalid geometry are unknown, not out.
@returns {{inZone: boolean|null, geoid: string|null, unavailableReason: string|null,
           vintage: string|null, source_url: string|null}}

### `fetchOpportunityZones()`

Load the same tracked CDFI polygons as the map; preserve their metadata.

### `fetchHudAFFH(boundingBox)`

Fetch HUD AFFH fair housing opportunity index data.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{opportunityIndex: number, segregationMetrics: object}>}

### `fetchHudOpportunityAtlas(boundingBox)`

Fetch HUD Opportunity Atlas economic mobility indicators.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{mobilityIndex: number, percentiles: Array}>}

### `calculateOpportunityShare()`

PMA area share is not measured. Retained for existing API consumers.

### `scoreOpportunityIndex(lat, lon, affhData, atlasData, zones)`

Compute a composite 0–100 opportunity index for a site location.

@param {number} lat
@param {number} lon
@param {object} affhData   - {opportunityIndex: number} from fetchHudAFFH
@param {object} atlasData  - {mobilityIndex: number} from fetchHudOpportunityAtlas
@param {object} zones - tracked CDFI GeoJSON, including meta
@returns {number|null} 0–100, or null when every component is unavailable

### `determineIncentiveEligibility(siteStatus)`

Only exact-site OZ geography establishes this designation.

### `getOpportunityLayer(ozZones)`

Build GeoJSON FeatureCollection for opportunity overlay layer.
@param {Array} [ozZones]
@returns {object}

### `getOpportunityJustification()`

Export opportunity analysis for ScoreRun audit trail.
@returns {object}
