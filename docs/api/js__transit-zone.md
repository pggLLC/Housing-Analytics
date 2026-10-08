# `js/transit-zone.js`

js/transit-zone.js — HB26-1065 transit-zone screen (#1937 Phase 2).

One answer to "is this point within 2 miles of transit, and is that
official?", for every page that asks (needs assessment, PMA, market study,
recommendation, exports), so they cannot disagree.

  var zone = TransitZone.create({
    stops:     <data/amenities/transit_stops_statewide_co.geojson>,
    mapStatus: <data/policy/thiz-map-status.json>,
    zones:     <OEDIT zone polygons, once published; else null>,
    now:       new Date()          // optional, for tests
  });
  zone.status(lat, lon, siteSource)  →  {
    program: { qualified: true | false | null, ... }, // sole eligibility evidence
    // The remaining fields describe the legacy stop screen, not eligibility:
    status:               'within_2mi' | 'outside' | 'unavailable',
    unavailableReason:    string | null,
    radiusMiles:          number | null,  // from mapStatus, never hardcoded
    nearestStop:          { name, agency, sources, reliability, distanceMiles } | null,
    nearestConfirmedStop: same shape | null,
    confirmedOnly:        true when the answer does not rest on an
                          OpenStreetMap-only stop; null when unavailable,
    designation:          'provisional' | 'official_in' | 'official_out',
    designationNote:      the sentence every rendered result must carry,
    mapPublished:         true once the status file says OEDIT has published
  }

The '2' in 'within_2mi' is the radius in the status file; the name is kept
for its consumers, and test/transit-zone.test.js fails if the two differ.
nearestStop.distanceMiles is rounded to 0.01 mi but never across the
radius, so the figure shown always agrees with the status.

Absence is never a "no": missing or stale stop data, or an unreadable
point, gives status 'unavailable' with the reason, not 'outside'.

_No documented symbols — module has a file-header comment only._
