# `js/pma-tract-picker.js`

js/pma-tract-picker.js
CHFA-compliant tract picker for the PMA tool.

CHFA's 2025-26 Market Study Guide (Appendix A) is explicit: "Radius
boundaries are not allowed. The market boundary must include entire
census tracts." The buffer/radius mode in this tool is a first-pass
screening proxy. This module exposes the real interaction — click to
add / remove whole tracts, build a tract-union boundary, and pass the
explicit GEOID set to the analysis runner so aggregation respects the
picked set rather than a radius.

Exposed as window.PMATractPicker. Depends on Leaflet (window.L) and
the tract_boundaries_co.geojson + tract_centroids_co.json files in
data/market/.

## Symbols

### `init(map, lat, lon, onChange)`

Initialize the tract picker at a given click point.
Fetches boundaries + centroids if not cached, filters to tracts
whose centroid is within NEARBY_RADIUS_MI miles, pre-selects those
within AUTOSELECT_RADIUS_MI miles, and renders the GeoJSON layer.

@param {L.Map}    map
@param {number}   lat
@param {number}   lon
@param {function} [onChange] — called with Array<GEOID> on each toggle
@returns {Promise<{selected: string[], visible: number}>}

### `clear(map)`

Remove the tract layer from the map and reset state.
@param {L.Map} map

### `wasCurated()`

True when the analyst has either toggled any tract relative to the
auto-pick OR written a non-empty rationale. We treat a written rationale
as curation even without a tract toggle — sometimes the auto-ring is the
right answer and the analyst explains why.

### `getCurationMetadata()`

@returns {object} metadata for justification narrative + audit trail

### `getSelectedGeoids()`

@returns {string[]} currently-selected tract GEOIDs

### `getBoundary()`

Build a GeoJSON FeatureCollection of the selected whole-tract polygons.
Leaflet can render this directly, and downstream aggregation can use the
explicit GEOID list without pretending the boundary is a radius or hull.

@returns {object|null} GeoJSON FeatureCollection or null when empty
