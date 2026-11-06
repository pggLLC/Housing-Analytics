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

### `_drawUnionOutline()`

Compute the union outline of the currently-selected tract polygons
by deduplicating shared interior edges. Each edge that appears in
exactly one selected polygon is a hull edge; edges that appear in
two adjacent selected polygons are interior and we drop them.

Renders the surviving edges as a single LayerGroup of polylines
styled as STYLE_UNION_OUTLINE so the PMA reads as one merged shape
sitting on top of the per-tract fill.

Pure-JS, no turf.js needed. Vertex precision: rounds to ~5 decimals
(≈1 m) so floating-point jitter from the source geojson doesn't
defeat the dedup.

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

### `proposeNaturalFeatures()`

Turn the option on: propose exclusions from the current selection.
@returns {Promise<object>} getNaturalFeatures()

### `applyNaturalFeatures()`

Remove the proposed tracts that are not kept. The proposal is re-run on
the selection as it stands, so tracts added since it was drawn are tested
too. The selection from before Apply is stored for turning the option off.
@returns {object} getNaturalFeatures()

### `setNaturalFeatureKeep(geoid, keep, reason)`

Keep (or stop keeping) a proposed tract because a crossing connects it.
After Apply, keeping puts the tract back and un-keeping removes it.

### `turnOffNaturalFeatures()`

Turn the option off; an applied proposal is undone exactly.

### `getNaturalFeatures()`

The option's state, as every surface reads it (narrative, audit export,
saved run). Each proposed tract carries how it got its state:
'proposed out' (before Apply), 'excluded by feature', 'kept: crossing',
or 're-added by analyst' (excluded, then clicked back in).

### `naturalFeatureSummary()`

A plain sentence for the rationale box, generated from getNaturalFeatures().
