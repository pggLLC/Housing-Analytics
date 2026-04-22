# `js/data-connectors/epa-cleanup.js`

js/data-connectors/epa-cleanup.js
EPA Brownfield/Superfund cleanup sites connector.
Uses preloaded data or returns safe defaults.
Exposes window.EpaCleanup.

## Symbols

### `EARTH_RADIUS_MI`

@const {number} Earth radius in miles for haversine calculations

### `sites`

Stored cleanup sites array.
Each item: { name, lat, lon, type, status }
  type:   'brownfield' | 'superfund' | 'rcra'
  status: 'active' | 'complete' | 'listed'
@type {Array.<{name: string, lat: number, lon: number, type: string, status: string}>}

### `loaded`

Whether site data has been loaded.
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

### `normalizeType(raw)`

Validates and normalizes the `type` field of a site record.
@param {*} raw
@returns {string}

### `normalizeStatus(raw)`

Validates and normalizes the `status` field of a site record.
@param {*} raw
@returns {string}

### `loadSites(data)`

Stores a preloaded array of EPA cleanup site records.
@param {Array.<{name: string, lat: number, lon: number, type: string, status: string}>} data

### `getSitesInBuffer(lat, lon, miles)`

Returns all cleanup sites within the specified radius of a point.
@param {number} lat  Center latitude.
@param {number} lon  Center longitude.
@param {number} miles  Search radius in miles.
@returns {Array.<Object>} Matching site objects.

### `getConstraintScore(sitesArr)`

Derives a 0–100 development constraint score for a set of sites.

Scoring rules (applied in order of worst-case precedence):
  20  — Any superfund site with status 'listed'
  50  — Any active brownfield (type 'brownfield', status 'active')
  80  — Only complete brownfields present
  100 — No sites in the set

If multiple risk levels are present the lowest (most constrained) score
is returned.

@param {Array.<Object>} sitesArr
@returns {number} Score from 0 to 100.

### `isLoaded()`

Returns whether cleanup site data has been loaded.
@returns {boolean}
