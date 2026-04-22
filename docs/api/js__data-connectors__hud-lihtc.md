# `js/data-connectors/hud-lihtc.js`

js/data-connectors/hud-lihtc.js
Centralized LIHTC data connector.

Source priority (most complete first):
  1. data/chfa-lihtc.json          — 716 CO projects, weekly CI (CHFA schema)
  2. data/market/hud_lihtc_co.geojson — normalized derivative (HUD schema)
  3. Live CHFA ArcGIS FeatureServer  — 15 s timeout, public
  4. Live HUD ArcGIS FeatureServer   — 15 s timeout, public
  5. Embedded sentinel records       — ~60 hard-coded projects, last resort

Field normalization: all sources are mapped to the CHFA canonical schema
(PROJECT, PROJ_CTY, N_UNITS, YR_ALLOC, CREDIT, LI_UNITS, YR_PIS, CNTY_FIPS,
CNTY_NAME, STATEFP, COUNTYFP, QCT, DDA) before returning.

Exposes window.HudLihtc.

## Symbols

### `EARTH_RADIUS_MI`

@const {number} Earth radius in miles for haversine calculations

### `CHFA_ARCGIS_ENDPOINT`

@const {string} CHFA ArcGIS FeatureServer base URL (Tier 3 live fallback).
 Both CHFA and HUD LIHTC services are hosted on the same ArcGIS Online org
 (VTyQ9soqVukalItT — HUD EGIS portal). CHFA publishes its data under the
 /LIHTC/ service name; HUD publishes the broader national database under
 /LIHTC_Properties/.  Tier 3 prefers the CHFA service because it is more
 current for Colorado; Tier 4 falls back to the HUD service.

### `HUD_ARCGIS_ENDPOINT`

@const {string} HUD ArcGIS FeatureServer base URL (Tier 4 live fallback).
 Resides in the same ArcGIS Online org as CHFA_ARCGIS_ENDPOINT but under
 the /LIHTC_Properties/ service, which is the broader HUD national database.

### `LIVE_TIMEOUT_MS`

@const {number} Fetch timeout for live ArcGIS calls in milliseconds

### `ARCGIS_CO_WHERE`

WHERE clause used for ArcGIS FeatureServer queries.
Checks all three known representations of the Colorado state identifier
(postal abbreviation, FIPS code string, and full name) because different
service vintages use different encodings.
@const {string}

### `EMBEDDED_SENTINEL`

Embedded sentinel — a representative geographic spread of Colorado LIHTC
projects used only when all four primary sources are unavailable.
Uses the canonical CHFA field schema (N_UNITS, PROJ_CTY, etc.).
@const {Object}

### `features`

Stored array of normalized GeoJSON Feature objects.
@type {Array.<Object>}

### `loaded`

Whether features have been loaded.
@type {boolean}

### `_source`

The source tier that successfully supplied the data.
@type {string|null}

### `_fetchedAt`

ISO-8601 UTC timestamp from the data file's fetchedAt field.
@type {string|null}

### `_loadPromise`

In-flight or resolved load promise — ensures load() is called only once.
@type {Promise|null}

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

### `_withTimeout(promise, ms)`

Wraps a promise with a timeout that rejects after ms milliseconds.
@param {Promise} promise
@param {number} ms
@returns {Promise}

### `_tryStaticFile(path, sourceName)`

Fetches a static JSON/GeoJSON file by path and resolves with the parsed
object plus `_source` and `_fetchedAt` metadata.
Rejects when the file is missing, empty, or has no features.
@param {string} path  Relative or absolute URL.
@param {string} sourceName  Human-readable source identifier.
@returns {Promise.<Object>}

### `_tryArcGIS(endpoint, sourceName)`

Queries a public ArcGIS FeatureServer for Colorado LIHTC projects.
Uses a single-page request (up to 2000 records) sufficient for
statewide CO data.  Rejects on timeout, HTTP error, or empty result.
@param {string} endpoint  FeatureServer layer URL (no trailing slash).
@param {string} sourceName
@returns {Promise.<Object>}

### `_normalizeFeature(f)`

Normalizes a GeoJSON Feature from any supported source schema to the
canonical CHFA schema.  The HUD schema uses different field names:
  PROJECT_NAME → PROJECT
  CITY         → PROJ_CTY
  TOTAL_UNITS  → N_UNITS
  YEAR_ALLOC   → YR_ALLOC
  CREDIT_PCT   → CREDIT
Normalization adds the CHFA-style fields alongside the originals so
existing callers that reference either name continue to work.
@param {Object} f  GeoJSON Feature
@returns {Object}  The same feature with normalized properties.

### `load()`

Loads LIHTC features from the highest-priority source available.
Implements a 5-tier fallback:
  Tier 1 – data/chfa-lihtc.json          (716 projects, CHFA schema)
  Tier 2 – data/market/hud_lihtc_co.geojson (normalized derivative)
  Tier 3 – Live CHFA ArcGIS FeatureServer (15 s timeout)
  Tier 4 – Live HUD ArcGIS FeatureServer  (15 s timeout)
  Tier 5 – Embedded sentinel               (~10 hard-coded projects)

The promise is memoised — repeated calls return the same result.
All loaded features are normalized to the CHFA canonical schema.

@returns {Promise.<{features: Array, _source: string, _fetchedAt: string|null}>}

### `loadFeatures(geojson)`

Stores LIHTC GeoJSON features for subsequent queries.
Accepts a GeoJSON FeatureCollection or a plain array of Feature objects.
@param {Object|Array} geojson

### `getFeaturesInBuffer(lat, lon, miles)`

Returns all LIHTC features whose coordinates fall within the specified
radius of the given point.
Features must have geometry.coordinates in [longitude, latitude] order
(standard GeoJSON), or properties.LATITUDE / properties.LONGITUDE as
fallback.
@param {number} lat  Center latitude.
@param {number} lon  Center longitude.
@param {number} miles  Search radius in miles.
@returns {Array.<Object>} Matching GeoJSON Feature objects.

### `getStats(featureArr)`

Computes summary statistics for an array of LIHTC feature objects.
@param {Array.<Object>} featureArr
@returns {{
  count: number,
  totalUnits: number,
  avgYearAlloc: number,
  unitsByAmi: { ami30: number, ami40: number, ami50: number, ami60: number, ami80: number }
}}

### `getConcentration(featureArr, bufferAreaSqMi)`

Returns the density of affordable units per square mile for a set of
features within a known buffer area.
@param {Array.<Object>} featureArr
@param {number} bufferAreaSqMi  Area of the search buffer in square miles.
@returns {number} Units per square mile, or 0 if area is zero.

### `isLoaded()`

Returns whether LIHTC features have been loaded.
@returns {boolean}

### `getFeatures()`

Returns a copy of all loaded (normalized) feature objects.
@returns {Array.<Object>}

### `getSource()`

Returns the source tier string for the loaded data
(e.g. 'chfa-local', 'hud-local', 'chfa-arcgis', 'hud-arcgis', 'embedded').
@returns {string|null}

### `getFetchedAt()`

Returns the ISO-8601 UTC fetchedAt timestamp from the data file, or null
when the data came from a live ArcGIS request or the embedded sentinel.
@returns {string|null}
