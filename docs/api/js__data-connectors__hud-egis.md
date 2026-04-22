# `js/data-connectors/hud-egis.js`

js/data-connectors/hud-egis.js
HUD EGIS ArcGIS FeatureServer connector for QCT and DDA overlays.
NOTE: For GitHub Pages, falls back to local GeoJSON files loaded via DataService.
Exposes window.HudEgis.

QCT (Qualified Census Tract): A census tract where 50%+ of households have
incomes below 60% of AMI, or the poverty rate is 25%+. Defined under
IRC §42(d)(5)(B)(ii)(I). HUD designates new QCTs annually.

DDA (Difficult Development Area): A metropolitan area or non-metropolitan
county designated by HUD where housing construction, land, and utility costs
are high relative to AMI. Defined under IRC §42(d)(5)(B)(iii).

Both QCT and DDA designations allow a LIHTC project to qualify for an
"eligible basis boost" — up to 130% of eligible basis — which directly
increases the annual credit amount awarded under IRC §42(d)(5)(B).

## Symbols

### `localQctData`

Locally preloaded QCT GeoJSON (set via loadLocalQct or auto-loaded from DataService).
@type {Object|null}

### `localDdaData`

Locally preloaded DDA GeoJSON (set via loadLocalDda or auto-loaded from DataService).
@type {Object|null}

### `_loadAttempted`

Tracks whether auto-loading of QCT/DDA data from DataService has been attempted.
Prevents repeated fetch attempts on every checkDesignation() call.

### `_pointInRing(lat, lon, ring)`

Ray-casting point-in-polygon test for a single GeoJSON ring.

How it works: a ray is cast from the test point in the +X (eastward)
direction. Each time the ray crosses an edge of the polygon ring, a
counter is toggled. An odd count at the end means the point is inside.

NOTE on coordinate order: the function accepts (lat, lon) in geographic
convention (latitude first), but GeoJSON rings store coordinates as
[longitude, latitude]. Inside the loop, ring[i][0] is longitude (x-axis)
and ring[i][1] is latitude (y-axis). The algorithm compares lon against
the x-coordinate of each edge crossing, which is correct.

@param {number} lat  - Point latitude.
@param {number} lon  - Point longitude.
@param {Array}  ring - GeoJSON ring: array of [lon, lat] pairs.
@returns {boolean}   True if the point is inside the ring.

### `_pointInFeature(lat, lon, feature)`

Test whether a point falls within a GeoJSON Feature (Polygon or MultiPolygon).
For polygons with holes, a point inside an interior ring (hole) is outside.

@param {number} lat     - Point latitude.
@param {number} lon     - Point longitude.
@param {Object} feature - GeoJSON Feature object.
@returns {boolean}      True if the point is inside the feature geometry.

### `_isInCollection(lat, lon, fc)`

Test whether any feature in a GeoJSON FeatureCollection contains the point.

@param {number} lat - Point latitude.
@param {number} lon - Point longitude.
@param {Object} fc  - GeoJSON FeatureCollection.
@returns {boolean}  True if the point is inside any feature.

### `_autoLoad()`

Attempt to load QCT and DDA GeoJSON from DataService and cache in memory.
Called once at module init (deferred to allow DataService to initialise).
Logs a clear warning if DataService is unavailable or the fetch fails —
never silently returns false without a diagnostic message.

### `isQct(lat, lon)`

Determines whether a given coordinate falls within a QCT polygon.
Uses the ray-casting point-in-polygon algorithm against localQctData.

@param {number} lat
@param {number} lon
@returns {boolean}

### `isDda(lat, lon)`

Determines whether a given coordinate falls within a DDA polygon.
Uses the ray-casting point-in-polygon algorithm against localDdaData.

@param {number} lat
@param {number} lon
@returns {boolean}

### `getOverlayData(lat, lon)`

Returns combined QCT/DDA overlay information for a given coordinate.

@param {number} lat
@param {number} lon
@returns {{ qct: boolean, dda: boolean, note: string }}

### `checkDesignation(lat, lon)`

Check whether a lat/lon point falls within a QCT or DDA polygon and
return the combined designation result used by the scoring pipeline.

When overlay data has not yet loaded, returns safe defaults (all false)
with a console warning so callers can distinguish a real "not designated"
result from a data-availability gap.

basis_boost_eligible is true whenever the site is in a QCT or DDA,
allowing the project to claim up to 130% eligible basis under IRC §42(d)(5)(B).

@param {number} lat - Site latitude.
@param {number} lon - Site longitude.
@returns {{ in_qct: boolean, in_dda: boolean, basis_boost_eligible: boolean }}

### `loadLocalQct(data)`

Accepts preloaded QCT GeoJSON and stores it for future point-in-polygon
lookups. Replaces any previously auto-loaded data.
@param {Object} data - A GeoJSON FeatureCollection of QCT polygons.

### `loadLocalDda(data)`

Accepts preloaded DDA GeoJSON and stores it for future point-in-polygon
lookups. Replaces any previously auto-loaded data.
@param {Object} data - A GeoJSON FeatureCollection of DDA polygons.
