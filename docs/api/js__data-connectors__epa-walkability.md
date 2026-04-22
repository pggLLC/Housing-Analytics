# `js/data-connectors/epa-walkability.js`

js/data-connectors/epa-walkability.js
EPA Smart Location Database walkability & bikeability connector.
Loads block-group data from data/market/epa_sld_co.json and provides
walkability/bikeability scores for any lat/lon in Colorado.

Exposes window.EpaWalkability.

Depends on: js/data-service-portable.js (DataService.getEpaSld),
            js/fetch-helper.js (safeFetchJSON)

## Symbols

### `_blockGroups`

@type {Object.<string, object>|null} Block-group GEOID → metrics

### `_loaded`

@type {boolean}

### `_bgCentroids`

@type {Array.<{geoid:string,lat:number,lon:number}>|null}

### `load(data)`

Load EPA SLD block-group data. Call once at page init.
Accepts the parsed JSON from data/market/epa_sld_co.json.
@param {object} data - { blockGroups: { "080010094092": { walkability, ... } } }

### `autoLoad()`

Auto-load from DataService if available.

### `getMetrics(lat, lon)`

Find the nearest block group(s) to a lat/lon by matching tract GEOIDs
from PMAEngine's buffer, or by brute-force nearest block-group centroid.

@param {number} lat
@param {number} lon
@returns {object|null} EPA SLD metrics for the best-matching block group(s)

### `getScores(lat, lon)`

Get walkability and bikeability scores (0-100) for a location.
@param {number} lat
@param {number} lon
@returns {{
  walkScore: number,
  bikeScore: number,
  walkLabel: string,
  bikeLabel: string,
  intersectionDensity: number|null,
  transitFrequency: number|null,
  landUseMix: number|null,
  autoNetDensity: number|null,
  blockGroupCount: number
}|null}

### `_getTractGeoids(lat, lon)`

Try to get tract GEOIDs from PMAEngine for the analysis buffer.

### `_averageForTracts(tractGeoids)`

Average EPA SLD metrics across block groups matching tract GEOIDs.

### `_nearestBlockGroup(lat, lon)`

Nearest block-group fallback using tract centroid data.
Approximates block-group location from the tract centroid file.

### `isLoaded()`

@returns {boolean}
