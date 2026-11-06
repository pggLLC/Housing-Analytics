# `scripts/policy/fetch_thiz_zones.mjs`

scripts/policy/fetch_thiz_zones.mjs: OEDIT's Transit and Housing
Investment Zone map (HB26-1065, C.R.S. 24-48.5-136) as one committed file.

OEDIT published the map on 2026-11-03 as an ArcGIS Experience
(MAP_URL below; also data/policy/thiz-map-status.json map_source_url). It
reads two public, query-only feature services owned by the state's OIT GIS
account:

  Transit_Facility_Buffer/FeatureServer/2  full_dissolve_2mile: the zone,
                                           one statewide MultiPolygon
  OEDIT_Transit_Facility/FeatureServer/0   every transportation facility
                                           OEDIT identifies, as points

Both are written to data/policy/thiz-zones.geojson: the zone as the only
feature, and the facilities as a compact `facilities` table. A site inside
the zone is linked to the nearest listed facility within the statute's two
miles (js/transit-zone.js), the same rule OEDIT used to draw the zone
(BUFF_DIST on the per-facility buffer layer). No stop from our own stop
file is ever used.

  node scripts/policy/fetch_thiz_zones.mjs           write the file
  node scripts/policy/fetch_thiz_zones.mjs --check   report whether OEDIT's
       layers changed since the committed vintage (exit 0 either way;
       prints CHANGED or UNCHANGED)

_No documented symbols — module has a file-header comment only._
