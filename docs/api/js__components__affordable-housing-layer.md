# `js/components/affordable-housing-layer.js`

js/components/affordable-housing-layer.js — F119
=================================================
Reusable Leaflet layer that shows ALL affordable-housing properties
across every map in COHO, color-coded by program type so the user can
distinguish 9% LIHTC, 4% LIHTC, 9%+State, 4%+State, MIHTC, HUD MF,
USDA RD, and preservation candidates at a glance.

Usage:
  <script src="js/components/affordable-housing-layer.js"></script>
  <script>
    window.AffordableHousingLayer.attach(map, {
      show9pct: true, show4pct: true, showMihtc: true,
      showStatePaired: true, showHudMf: true, showUsdaRd: true,
      showPreservation: true,
      showLegend: true,    // floating legend control
      interactive: true,   // popups + tooltips on click
    });
  </script>

Data:
  data/affordable-housing/properties.json — 3,073 properties from CHFA
  LIHTC + CHFA Preservation + HUD MF Assisted + USDA RD + Prop 123.
  Built by scripts/build-affordable-housing-properties.js. The component
  is idempotent: re-attaching to the same map is safe.

Color palette tuned for contrast in both light + dark modes.

## Symbols

### `loadProperties()`

Public: trigger the shared properties.json fetch + resolve with the
cached array. Lets other components (e.g. HNA info panel) reuse the
2MB fetch we already paid for instead of double-loading.

### `categorize(p)`

Public: bucket a property record into one of the legend CATEGORIES.
Returns null if no category matches.

### `setCategoryVisible(map, key, visible)`

F173 — Toggle a single AHL sub-layer (e.g. 'hud_mf', 'usda_rd',
'pbv_local', 'preservation') on/off. Idempotent. Quietly no-ops if
the layer hasn't loaded yet — the layer-toggle wires up early; the
properties.json fetch resolves async.

@param {L.Map} map
@param {string} key — one of the CATEGORIES[].key values
@param {boolean} visible

### `setLihtcVisible(map, visible)`

F173 — Convenience: toggle ALL LIHTC sub-categories (9pct, 4pct,
9pct_state, 4pct_state, mihtc) at once. The HNA has a single
"LIHTC" layer-toggle that controls both the dedicated CHFA
lihtcLayer (div-icon markers) AND these AHL circle markers, so
checking it should drive both.
