# `scripts/validate-critical-data.js`

## Symbols

### `countRecords(json)`

Count the number of records in a parsed JSON object.
Handles: {tracts:[]} (ACS/centroid files), GeoJSON FeatureCollections,
and plain arrays.
@param {*} json
@returns {number}
