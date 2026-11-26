# `js/chfa-round-two-map.js`

js/chfa-round-two-map.js — the map in the CHFA 2026 Round Two research brief.

  ChfaRoundTwoMap.render(mountEl) → Promise<'ok' | 'unavailable'>

Reads data/affordable-housing/chfa-awards/2026-round-two.json (awards and the
applications not awarded, each with its CHFA address point) and
data/boundaries/counties_co.geojson (county lines). Draws:
  - awards as filled dots, applications not awarded as dashed rings, sized by homes;
  - county lines, named on hover;
  - a tooltip on hover and a popup on tap for every dot, with the figures CHFA prints.
Streets are OpenStreetMap with a Satellite switch (js/config/basemaps.js).
Absence is never a blank map: a missing file or Leaflet renders "Map unavailable".

_No documented symbols — module has a file-header comment only._
