# `js/data-connectors/osm-amenities.js`

js/data-connectors/osm-amenities.js
OSM amenity proximity connector.
Uses preloaded amenity data (no live OSM API calls on GitHub Pages).
Exposes window.OsmAmenities.

## Symbols

### `EARTH_RADIUS_MI`

@const {number} Earth radius in miles for haversine calculations

### `AMENITY_TYPES`

Canonical amenity type identifiers used throughout the scoring logic.
@type {Array.<string>}

### `SCORE_KEY_TO_TYPE`

Mapping from score-output keys to canonical amenity type identifiers.
@type {Object.<string, string>}

### `amenities`

Stored amenities array. Each item: { type, name, lat, lon }
@type {Array.<{type: string, name: string, lat: number, lon: number}>}

### `loaded`

Whether amenity data has been loaded.
@type {boolean}

### `toRad(deg)`

Converts degrees to radians.
@param {number} deg
@returns {number}

### `haversine(lat1, lon1, lat2, lon2)`

Computes the haversine great-circle distance in miles between two points.
@param {number} lat1
@param {number} lon1
@param {number} lat2
@param {number} lon2
@returns {number} Distance in miles.

### `distanceToScore(distanceMiles)`

Converts a distance in miles to a walkability score (0–100).
@param {number} distanceMiles
@returns {number}

### `loadAmenities(data)`

Stores a preloaded amenities array.
Each item must have at minimum: type, name, lat, lon.
@param {Array.<{type: string, name: string, lat: number, lon: number}>} data

### `getNearestByType(lat, lon, type)`

Returns the nearest amenity of a given type to a coordinate, along with
its distance in miles.
@param {number} lat
@param {number} lon
@param {string} type  One of the AMENITY_TYPES values.
@returns {{ name: string, distanceMiles: number, score: number }|null}
  Null if no amenity of that type is found.

### `getAccessScore(lat, lon)`

Computes a multi-category access score for a given coordinate.
Each category returns the nearest amenity of the mapped type.
`overall` is the rounded mean of all five category scores.
@param {number} lat
@param {number} lon
@returns {{
  grocery:    { name: string, distanceMiles: number, score: number },
  transit:    { name: string, distanceMiles: number, score: number },
  parks:      { name: string, distanceMiles: number, score: number },
  healthcare: { name: string, distanceMiles: number, score: number },
  schools:    { name: string, distanceMiles: number, score: number },
  overall:    number
}}

### `isLoaded()`

Returns whether amenity data has been loaded.
@returns {boolean}
