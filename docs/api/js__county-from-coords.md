# `js/county-from-coords.js`

county-from-coords.js

Browser-side point-in-polygon utility: maps a Colorado lat/lon to its
containing county FIPS by testing against TIGER county boundaries
(data/co-county-boundaries.json — 64 features, ~126 KB).

Why this exists
---------------
The Deal Calculator currently asks users to manually pick a county
for HUD AMI rent limits. That's friction for the user (and a
correctness risk in cross-county jurisdictions like Erie, Aurora,
Longmont — where a parcel on the wrong side of the line is in a
DIFFERENT HUD AMI tier than the place's "primary" county). With
this helper, the user can paste a lat/lon (or use browser
geolocation) and have the county auto-detected from the parcel's
actual geographic location.

Public API
----------
  window.CountyFromCoords.init() — fetch + cache boundaries
  window.CountyFromCoords.lookup(lat, lon) — returns {fips, name} or null
  window.CountyFromCoords.lookupSync(lat, lon) — same but throws if not init'd

Algorithm
---------
Standard ray-casting point-in-polygon (PnP). For each county feature:
  1. Bounding-box pre-filter (skip if (lat,lon) outside bbox).
  2. Walk the polygon edges; count how many edges a horizontal ray
     from (lat,lon) crosses. Odd = inside, even = outside.
  3. For MultiPolygon: any ring containing the point counts as a hit.
     Inner rings (holes) are subtracted via even-odd accumulation.

The TIGER 2024 boundary data has ~60 vertices/county on average. A
full scan of all 64 counties is ~3,800 vertex tests in the worst
case — sub-millisecond on any modern device. Bbox pre-filter typically
cuts this to <100 vertex tests.

## Symbols

### `_normalizeFeatures(gj)`

Convert a raw GeoJSON FeatureCollection into our compact internal
 representation: every county becomes one record with {name, fips,
 bbox, rings}. Polygons → 1 ring set; MultiPolygons → flattened
 list of ring sets. Simplifies the lookup loop downstream.

### `_extractRings(geom)`

Extract rings as an array of arrays of [lon, lat]. Handles
 Polygon (single set of rings) and MultiPolygon (multiple sets).

### `_pointInRing(lat, lon, ring)`

Standard ray-casting point-in-polygon. Tests whether (lat, lon) is
 inside the ring. Even-odd rule means rings can be added together
 for MultiPolygon-with-holes correctness.

### `_pointInFeature(lat, lon, feat)`

Test whether (lat, lon) is inside ANY ring of the feature.
 Even-odd accumulation handles holes correctly.

### `lookup(lat, lon)`

Find the county containing (lat, lon). Returns {fips, name} or null.
 Async — call init() first or wait for the returned promise.

### `lookupSync(lat, lon)`

Synchronous lookup. Throws if init() hasn't completed yet.

### `isReady()`

Test whether init() has completed and data is ready.
