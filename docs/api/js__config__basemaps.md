# `js/config/basemaps.js`

js/config/basemaps.js — one place that knows where map tiles come from.

CARTO's anonymous basemap tiles are no longer usable. As of 2026-09 they
still return HTTP 200 with a valid PNG — with "API KEY REQUIRED ·
carto.com/basemaps/apikey" painted diagonally across the image. Status codes
and headers look healthy; only the pixels say otherwise, which is why this
reached production before anyone noticed.

Seven tile URLs across six files pointed at CARTO. They now point here.

Esri's Canvas basemaps replace them and need no key. Two differences that
matter:

  LABELS ARE A SEPARATE LAYER. CARTO's `*_all` styles include place names;
  Esri splits them into a Base and a transparent Reference overlay, so the
  labelled variants are layer groups, not tile layers. `dark_nolabels` maps
  onto the bare Base.

  NATIVE DETAIL STOPS AT z16. Past that Esri serves a grey "Map data not yet
  available" tile. maxNativeZoom keeps Leaflet upsampling z16 instead —
  softer when you zoom right in, but continuous, and markers stay put. A
  blank grey pane would read as a broken map.

To move back to CARTO, set window.COHO_CARTO_API_KEY before this file loads
and the CARTO styles are used with the key appended. Nothing else changes.

## Symbols

### `asBasemap(base, reference)`

Make a LayerGroup usable everywhere a basemap is expected.

CARTO bundled labels into one tile layer. Esri splits them, so a labelled
basemap became an L.LayerGroup — and a LayerGroup is NOT a TileLayer. Two
things broke, both of them silently at first:

  bringToBack()  — not a LayerGroup method. js/hna/hna-controller.js calls
                   it after every basemap swap, and threw
                   "activeBase.bringToBack is not a function".
  tile events    — a LayerGroup emits none, so the `once('tileerror')`
                   fallback to OSM in the same file could never fire. That
                   one threw nothing at all: the fallback just stopped
                   existing, which is worse.

Rather than patch each call site, the group honours the contract a caller
already has with a basemap. Anything that worked with a CARTO tile layer
works with this.

### `labelled(tone, opts)`

Labelled basemap. A LayerGroup unless CARTO is keyed, which bundles labels.

### `unlabelled(tone, opts)`

Bare basemap, no place names.
