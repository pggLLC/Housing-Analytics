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

### `BASIS_CONFIRMED`

transit_stop records carry transit_stop_basis (scripts/lib/transit_stops.py):
"confirmed" (CDOT or an agency GTFS feed publishes the stop) or
"openstreetmap_unconfirmed" (only OpenStreetMap maps it). A record with no
basis (the builder's seed fallback) is treated as confirmed.

### `TRANSIT_SCORING_RADIUS_MILES`

The distance within which a stop earns transit credit: the last band of
distanceToScore() with a score above 0. The OpenStreetMap-only fallback
applies only when no confirmed stop is this close to the analyzed site.
tests/test_transit_stop_selection.py pins the builder's
TRANSIT_FALLBACK_RADIUS_MILES to the same band.
@type {number}

### `amenities`

Stored amenities array. Each item: { type, name, lat, lon }
@type {Array.<{type: string, name: string, lat: number, lon: number}>}

### `transitRecords`

The transit_stop subset of amenities, kept once at load so the per-site
transit rule does not rescan every record type.
@type {Array.<Object>}

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

### `transitSelection(lat, lon)`

Which transit stops an analyzed site is scored on, decided for THAT site:
the confirmed stops whenever one is within TRANSIT_SCORING_RADIUS_MILES;
otherwise the OpenStreetMap-only stops when one of them is; otherwise the
confirmed stops (none in range, so the site scores as it always did).
Never mixed: a nearer unconfirmed stop never outranks a confirmed one in
range. (Codex on #1991: the fallback used to be chosen around place
centroids by the builder, not per site.)
@param {number} lat
@param {number} lon
@returns {{ basis: string, records: Array.<Object> }}

### `getNearestByType(lat, lon, type)`

Returns the nearest amenity of a given type to a coordinate, along with
its distance in miles. For transit_stop the per-site confirmed-first rule
(transitSelection) decides which stops are eligible, and the result says
which: transitStopBasis ("confirmed", "openstreetmap_unconfirmed" or
"none"), confirmed (true, false, or null when no stop is in range) and
transitStopBasisReason (null when confirmed).
@param {number} lat
@param {number} lon
@param {string} type  One of the AMENITY_TYPES values.
@returns {{ name: string, distanceMiles: number, score: number }|null}
  Null if no amenity of that type is found.

### `getWithinRadius(lat, lon, type, radiusMiles)`

Returns every amenity of a given type within a radius of a coordinate,
nearest first. Distances are straight-line (haversine) miles.
@param {number} lat
@param {number} lon
@param {string} type          One of the AMENITY_TYPES values.
@param {number} radiusMiles
@returns {Array<{ name: string, lat: number, lon: number, distanceMiles: number }>}
  transit_stop hits also carry transitStopBasis, so a caller can tell an
  OpenStreetMap-only stop from a confirmed one; nothing is filtered here.
  Empty when nothing is in range. Null when amenity data is not loaded
  or the inputs are invalid, so "no data" is not mistaken for "none nearby".

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

### `countByType()`

Returns how many loaded records there are of each type, e.g.
{ grocery: 2178, hospital: 121, ... }. A fresh object each call; types
with no records are absent, not 0. Empty object before data loads.
@returns {Object.<string, number>}
