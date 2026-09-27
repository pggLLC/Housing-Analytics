# `js/data-connectors/epa-walkability.js`

js/data-connectors/epa-walkability.js
EPA Smart Location Database walkability & bikeability connector.
Loads block-group data from data/market/epa_sld_co.json and provides
walkability/bikeability scores for any lat/lon in Colorado.

A site is located by point-in-polygon against the 2010 block-group
boundaries in data/market/epa_sld_bg_geometry_co.geojson (same GEOID set as
the EPA file; EPA SLD v3 is published on 2010 block groups, so the repo's
TIGER 2020 tracts cannot be used to join it). A site that falls in no block
group gets null and an unavailable reason — never another place's values.

Exposes window.EpaWalkability.

Depends on: js/data-service-portable.js (DataService.getEpaSld),
            js/fetch-helper.js (safeFetchJSON)

## Symbols

### `_blockGroups`

@type {Object.<string, object>|null} Block-group GEOID → metrics

### `_loaded`

@type {boolean}

### `_bgIndex`

Block-group boundaries, indexed for point-in-polygon.
@type {Array.<{geoid:string,bbox:number[],polys:Array}>|null}

### `_geometryFailure`

@type {string|null} Why the boundary file is not available, once known

### `load(data)`

Load EPA SLD block-group data. Call once at page init.
Accepts the parsed JSON from data/market/epa_sld_co.json.
@param {object} data - { blockGroups: { "080010094092": { walkability, ... } } }

### `loadGeometry(fc)`

Load the 2010 block-group boundaries used to locate a site.
Accepts the parsed GeoJSON from data/market/epa_sld_bg_geometry_co.geojson.
@param {object} fc - FeatureCollection; properties.geoid on each feature

### `autoLoad()`

Auto-load from DataService if available.

### `resolveSite(lat, lon)`

Find the EPA SLD block group(s) a site sits in.

@param {number} lat
@param {number} lon
@returns {{blockGroups: string[], method: string|null, unavailableReason: string|null}}
  blockGroups is empty exactly when unavailableReason is set. method is
  'contains', or 'within-simplification-tolerance' for a sliver match.

### `getMetrics(lat, lon)`

EPA SLD metrics for the block group(s) containing a site.

@param {number} lat
@param {number} lon
@returns {object|null} null when the site cannot be located; see
  getUnavailableReason() for why.

### `getUnavailableReason(lat, lon)`

Why getMetrics()/getScores() return null for a site, or null when they do not.
@param {number} lat
@param {number} lon
@returns {string|null}

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

### `_distToPolys(x, y, polys)`

Planar distance, in degrees, from a point to the nearest polygon edge.

### `_inPolygon(x, y, rings)`

Even-odd ray cast over every ring, so holes are excluded.

### `_averageForBlockGroups(bgIds)`

Average EPA SLD metrics across the given block groups.

### `isLoaded()`

@returns {boolean} true once both the metrics and the boundaries have loaded
