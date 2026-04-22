# `js/data-connectors/fema-flood.js`

js/data-connectors/fema-flood.js
FEMA flood risk connector.
Uses preloaded flood zone data; falls back to "unknown" gracefully.
Exposes window.FemaFlood.

## Symbols

### `EARTH_RADIUS_MI`

@const {number} Earth radius in miles for haversine proximity fallback

### `floodZones`

Stored flood zone features.
Each item is expected to have at minimum: lat, lon, zone (FEMA zone code).
For polygon-based zones, lat/lon represent a representative centroid.
@type {Array.<Object>}

### `loaded`

Whether flood zone data has been loaded.
@type {boolean}

### `FALLBACK`

The neutral fallback response returned when data is unavailable.
@type {{ zone: string, riskLevel: string, score: number }}

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
@returns {number}

### `zoneToRisk(zone)`

Derives a human-readable risk level and a 0–100 risk score from a FEMA
flood zone code.

Zone codes:
  High risk    — A, AE, AH, AO, AR, A99, V, VE  (score: 0)
  Moderate risk— B, X500 (0.2% annual chance)    (score: 40)
  Low risk     — C, X                             (score: 100)
  Unknown      — anything else                    (score: 50)

@param {string} zone - FEMA flood zone code.
@returns {{ riskLevel: string, score: number }}

### `loadFloodZones(data)`

Stores preloaded flood zone feature data.
Each item must have a `zone` property (FEMA zone code) and either
`lat`/`lon` coordinates or a `geometry.coordinates` array [lon, lat].
@param {Array.<Object>|Object} data - Array of zone features or a GeoJSON
  FeatureCollection.

### `getRiskAtPoint(lat, lon)`

Returns the flood risk information for a given geographic point.
Finds the nearest stored zone feature (by centroid proximity) and derives
risk level and score from its zone code.

If no data has been loaded, returns the neutral fallback object.

@param {number} lat
@param {number} lon
@returns {{ zone: string, riskLevel: string, score: number }}

### `isLoaded()`

Returns whether flood zone data has been loaded.
@returns {boolean}
