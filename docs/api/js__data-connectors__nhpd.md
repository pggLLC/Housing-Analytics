# `js/data-connectors/nhpd.js`

js/data-connectors/nhpd.js
NHPD subsidized housing inventory connector.
Falls back gracefully when live data unavailable.
Exposes window.Nhpd.

## Symbols

### `EARTH_RADIUS_MI`

@const {number} Earth radius in miles for haversine calculations

### `inventory`

Stored NHPD features array.
@type {Array.<Object>}

### `loaded`

Whether inventory data has been loaded.
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

### `toNum(v)`

Safely coerces a value to a finite number; returns 0 on failure.
@param {*} v
@returns {number}

### `loadInventory(data)`

Stores a preloaded NHPD features array.
Each item is expected to have at minimum: lat, lon, total_units,
subsidy_type, subsidy_expiration (ISO date string or year number).
@param {Array.<Object>} data

### `getInventoryInBuffer(lat, lon, miles)`

Returns all inventory items within the specified radius of a point.
Each item must have numeric `lat` and `lon` properties.
@param {number} lat  Center latitude.
@param {number} lon  Center longitude.
@param {number} miles  Search radius in miles.
@returns {Array.<Object>} Matching inventory items.

### `getStats(items)`

Computes summary statistics for an array of NHPD inventory items.
@param {Array.<Object>} items
@returns {{
  count: number,
  subsidyTypes: Object.<string, number>,
  totalUnits: number,
  expiringCount: number
}}

### `getPropertiesNear(lat, lon, miles)`

Convenience alias used by DataService.fetchHudNhpd.
Identical to getInventoryInBuffer.
@param {number} lat  Center latitude.
@param {number} lon  Center longitude.
@param {number} miles  Search radius in miles.
@returns {Array.<Object>}

### `loadFromGeoJSON(geojson)`

Loads inventory from a GeoJSON FeatureCollection.
Flattens each Feature's properties and injects lat/lon from the geometry.
@param {Object} geojson  GeoJSON FeatureCollection object.

### `isLoaded()`

Returns whether inventory data has been loaded.
@returns {boolean}
