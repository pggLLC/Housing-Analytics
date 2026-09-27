# `js/pma-transit.js`

js/pma-transit.js
Transit accessibility weighting for PMA delineation.

Responsibilities:
 - fetchTransitStops() — the statewide transit stop file, once per page
 - fetchTransitZoneStatus() — data/policy/thiz-map-status.json, once per page
 - fetchEPASmartLocation(boundingBox) — EPA transit accessibility metrics
 - calculateTransitScore(siteLat, siteLon, stopsGeojson, epaData, mapStatus)
   — 0–100 score from CONFIRMED STOPS, or null when it cannot be measured
 - distanceTiers(mapStatus) — the two distances the score uses
 - measureStops(siteLat, siteLon, countedStops, tiers) — the stop counts
 - identifyTransitDeserts(pmaPolygon, stops, mapStatus) — gaps in service
 - getTransitLayer() — GeoJSON layer of the counted stops
 - getTransitJustification() — audit-ready transit metrics

Exposed as window.PMATransit.

── What the score is measured from (owner decisions 2026-09-27) ─────────
Confirmed transit stops in data/amenities/transit_stops_statewide_co.geojson,
selected by TransitZone.countsAsConfirmedStop (js/transit-zone.js) — the
same rule as scripts/lib/transit_stops.py and the zone screen: published by
CDOT or an agency GTFS feed, not a private shuttle, not demand-response.

It used to be measured from route LINES (the route-line file in data/market/):
every route with a vertex in a ~10-mile box, with every floor(n/10)th vertex
taken as a pseudo-stop. That made the score a function of how many vertices
a route file happened to have — a lossless reformat changed the route count
at 614 of 2,157 replayed sites — and the "headway" it used for frequency was
invented from route_type. The route lines are still drawn on the map; they
are not scored.

── Distances: HB26-1065 administration, from the status file ────────────
Exactly two distances, both read at runtime from
data/policy/thiz-map-status.json through js/transit-zone.js, never
hardcoded here:
  * qap_tod_distance.miles (TransitZone.qapTodDistance) — the CHFA QAP
    transit-oriented distance: stops this close get full credit;
  * zone_radius_miles (TransitZone.zoneRadiusMiles) — the Transit and
    Housing Investment Zone screening radius: stops beyond the TOD
    distance and within it get half credit.
Beyond the zone radius a stop does not count. A status file that did not
load, or lacks either value, gives a null score with a reason.

── Frequency ────────────────────────────────────────────────────────────
The stop file carries no schedule, headway, route or mode field, so service
frequency cannot be measured here. hasHighFrequencyService is null with
highFrequencyUnavailableReason, and the frequency weight is excluded from
the composite (redistributed over the components that were measured),
never scored as "not high frequency".

── Absence ──────────────────────────────────────────────────────────────
 - Stop file or status file did not load (or the selection rule is not on
   the page): transitAccessibilityScore null + transitUnavailableReason.
 - Both loaded and no confirmed stop within the zone radius: a MEASURED
   zero coverage, flagged noConfirmedStopWithinZoneRadius: true.

## Symbols

### `fetchTransitStops()`

The statewide transit stop file, via DataService (fetched once per page).
@returns {Promise<{geojson: object|null, unavailableReason: string|null, _dataSource: string}>}

### `fetchTransitZoneStatus()`

The zone-map status file, via DataService (fetched once per page).
@returns {Promise<{mapStatus: object|null, unavailableReason: string|null}>}

### `fetchEPASmartLocation(boundingBox)`

Fetch EPA Smart Location Database transit accessibility metrics.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{transitAccessibility: number, walkScore: number}>}

### `distanceTiers(mapStatus)`

The two distance tiers, from the zone-map status file.
@param {object|null} mapStatus - data/policy/thiz-map-status.json
@returns {{ tiers: Array|null, todMiles: number|null, zoneRadiusMiles: number|null,
            todLabel: string|null, unavailableReason: string|null }}

### `selectCountedStops(stopsGeojson)`

The counted stops of a stop FeatureCollection, by the shared rule.
@returns {{ stops: Array|null, unavailableReason: string|null }}

### `measureStops(siteLat, siteLon, countedStops, tiers)`

What the counted stops look like from one site.
@param {number} siteLat
@param {number} siteLon
@param {Array<{lat,lon,name,agency}>} countedStops
@param {Array} tiers - distanceTiers(mapStatus).tiers, innermost first

### `calculateTransitScore(siteLat, siteLon, stopsGeojson, epaData, mapStatus)`

Calculate the 0–100 transit accessibility score from confirmed stops.

@param {number} siteLat
@param {number} siteLon
@param {object|null} stopsGeojson - data/amenities/transit_stops_statewide_co.geojson
  (a FeatureCollection). null / no features → null, with
  transitUnavailableReason (stopsGeojson.unavailableReason when given).
@param {object} epaData  - EPA Smart Location metrics (may have null values)
@param {object|null} mapStatus - data/policy/thiz-map-status.json, the
  source of both distances. Missing either value → null with a reason.
@returns {number|null} 0–100 score, or null when it could not be measured

### `identifyTransitDeserts(pmaPolygon, stops, mapStatus)`

Identify transit deserts — cells of the PMA with no counted stop within
the QAP transit-oriented distance. Grid-based.

@param {object} pmaPolygon - GeoJSON Polygon geometry
@param {Array}  [stops]    - counted stops ({lat, lon}); defaults to the
                             last scored site's. Legacy route objects with
                             a `stops` array are also accepted.
@param {object} [mapStatus] - the status file; defaults to the distances
                             of the last scored site.
@returns {Array|null} desert cells; null when the distance is unknown

### `getTransitLayer(stops)`

GeoJSON FeatureCollection of counted stops (the last scored site's
stops within the zone radius when called with no argument).
@param {Array} [stops]
@returns {object} GeoJSON FeatureCollection

### `getTransitJustification()`

Export transit analysis for ScoreRun audit trail.
@returns {object}
