# `js/components/jurisdiction-boundaries.js`

js/components/jurisdiction-boundaries.js
=========================================
Zoom-aware county + place boundary overlay for any Leaflet map in COHO.

USAGE
  <script src="js/components/jurisdiction-boundaries.js"></script>
  <script>
    // After your map is initialized:
    window.JurisdictionBoundaries.attach(map, {
      showCounties: true,   // default true — always visible
      showPlaces:   true,   // default true — visible from zoom >= placesMinZoom
      placesMinZoom: 9,     // default 9 — county-fits-screen scale
      countyStyle: {...},   // optional Leaflet Path style override
      placeStyle:  {...},   // optional
      cdpStyle:    {...},   // optional — CDPs styled differently
      interactive: false    // default false — overlay is decorative
    });
  </script>

DATA SOURCES
  data/co-county-boundaries.json    — 64 CO counties (always loaded)
  data/co-place-boundaries.geojson  — 273 incorporated + 211 CDP places
    (built by scripts/build_co_place_boundaries.py from Census TIGERweb)

The component is idempotent: calling attach() multiple times on the
same map is safe — repeat calls just refresh style/options.

_No documented symbols — module has a file-header comment only._
