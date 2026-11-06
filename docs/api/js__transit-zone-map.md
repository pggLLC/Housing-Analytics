# `js/transit-zone-map.js`

js/transit-zone-map.js — the map in the needs assessment's "Potential
location: transit zone (HB26-1065)" panel.

  TransitZoneMap.render(mountEl, {
    geoid:     '0827425',                       // county (5) or place/CDP (7)
    name:      'Fruita',
    mapStatus: <data/policy/thiz-map-status.json>
  })  →  Promise<'ok' | 'unavailable' | 'superseded'>

Draws three things, each in the legend:
  - every confirmed public fixed-route stop (data/hna/transit-zone-map.json),
  - the screening radius around those stops merged into one shape, built by
    scripts/market/build_transit_zone_map.py from the same stops and radius
    as the panel's share figures,
  - the selected geography's boundary.
A label on the map itself says the shading is a screen awaiting OEDIT's
zone map, so a screenshot of the map cannot be read as a designation.

Absence is never a blank map: a missing data file, boundary or Leaflet
renders "Map unavailable" with the reason.

_No documented symbols — module has a file-header comment only._
