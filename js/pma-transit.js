/**
 * js/pma-transit.js
 * Transit accessibility weighting for PMA delineation.
 *
 * Responsibilities:
 *  - fetchTransitStops() — the statewide transit stop file, once per page
 *  - fetchTransitZoneStatus() — data/policy/thiz-map-status.json, once per page
 *  - fetchEPASmartLocation(boundingBox) — EPA transit accessibility metrics
 *  - calculateTransitScore(siteLat, siteLon, stopsGeojson, epaData, mapStatus)
 *    — 0–100 score from CONFIRMED STOPS, or null when it cannot be measured
 *  - distanceTiers(mapStatus) — the two distances the score uses
 *  - measureStops(siteLat, siteLon, countedStops, tiers) — the stop counts
 *  - identifyTransitDeserts(pmaPolygon, stops, mapStatus) — gaps in service
 *  - getTransitLayer() — GeoJSON layer of the counted stops
 *  - getTransitJustification() — audit-ready transit metrics
 *
 * Exposed as window.PMATransit.
 *
 * ── What the score is measured from (owner decisions 2026-09-27) ─────────
 * Confirmed transit stops in data/amenities/transit_stops_statewide_co.geojson,
 * selected by TransitZone.countsAsConfirmedStop (js/transit-zone.js) — the
 * same rule as scripts/lib/transit_stops.py and the zone screen: published by
 * CDOT or an agency GTFS feed, not a private shuttle, not demand-response.
 *
 * It used to be measured from route LINES (the route-line file in data/market/):
 * every route with a vertex in a ~10-mile box, with every floor(n/10)th vertex
 * taken as a pseudo-stop. That made the score a function of how many vertices
 * a route file happened to have — a lossless reformat changed the route count
 * at 614 of 2,157 replayed sites — and the "headway" it used for frequency was
 * invented from route_type. The route lines are still drawn on the map; they
 * are not scored.
 *
 * ── Distances: HB26-1065 administration, from the status file ────────────
 * Exactly two distances, both read at runtime from
 * data/policy/thiz-map-status.json through js/transit-zone.js, never
 * hardcoded here:
 *   * qap_tod_distance.miles (TransitZone.qapTodDistance) — the CHFA QAP
 *     transit-oriented distance: stops this close get full credit;
 *   * zone_radius_miles (TransitZone.zoneRadiusMiles) — the Transit and
 *     Housing Investment Zone screening radius: stops beyond the TOD
 *     distance and within it get half credit.
 * Beyond the zone radius a stop does not count. A status file that did not
 * load, or lacks either value, gives a null score with a reason.
 *
 * ── Frequency ────────────────────────────────────────────────────────────
 * The stop file carries no schedule, headway, route or mode field, so service
 * frequency cannot be measured here. hasHighFrequencyService is null with
 * highFrequencyUnavailableReason, and the frequency weight is excluded from
 * the composite (redistributed over the components that were measured),
 * never scored as "not high frequency".
 *
 * ── Absence ──────────────────────────────────────────────────────────────
 *  - Stop file or status file did not load (or the selection rule is not on
 *    the page): transitAccessibilityScore null + transitUnavailableReason.
 *  - Both loaded and no confirmed stop within the zone radius: a MEASURED
 *    zero coverage, flagged noConfirmedStopWithinZoneRadius: true.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var EARTH_RADIUS_MI      = 3958.8;
  var DESERT_CELL_MILES    = 1;      // grid cell size for desert detection

  /* Credit per tier. The DISTANCES come from the status file (distanceTiers);
   * these are only the weights: a stop within the QAP TOD distance counts in
   * full, one beyond it but inside the zone radius counts half. */
  var TOD_TIER_CREDIT  = 1.0;
  var ZONE_TIER_CREDIT = 0.5;

  /* Coverage: each tier contributes up to (credit × 100) points, reached at
   * STOPS_FOR_FULL_TIER confirmed stops in that tier; the tiers add and the
   * sum is capped at 100.
   *
   * Why a per-tier cap and not a per-stop sum: stops come in dense clusters
   * (both directions, every ~¼ mile), so a plain credit-weighted stop count
   * would give a site at the edge of the zone radius from a small town's bus
   * loop the same coverage as a site on the loop. Twenty stops is about two
   * bidirectional routes' worth of stops at ¼-mile spacing across a one-mile
   * line. */
  var STOPS_FOR_FULL_TIER = 20;

  /* ── Score weights ────────────────────────────────────────────────── */
  var TRANSIT_WEIGHTS = {
    frequency:   0.35,  // service headway — not measurable from the stop file; always excluded
    coverage:    0.30,  // confirmed stops near the site, by distance tier
    epaIndex:    0.25,  // EPA Smart Location transit accessibility index
    walkScore:   0.10   // pedestrian environment
  };
  var EPA_UNAVAILABLE_REASON = 'EPA Smart Location data is unavailable; no EPA transit or walkability score was calculated.';
  var STOPS_UNAVAILABLE_REASON = 'The statewide transit stop file did not load, so transit access was not scored.';
  var RULE_UNAVAILABLE_REASON = 'The transit stop rules (js/transit-zone.js) are not loaded on this page, so transit access was not scored.';
  var STATUS_UNAVAILABLE_REASON = 'The zone-map status file (data/policy/thiz-map-status.json) did not load or lacks the zone radius or the QAP transit-oriented distance, so transit access was not scored.';
  var FREQUENCY_UNAVAILABLE_REASON = 'The statewide transit stop file has no schedule, headway, route or mode data, so service frequency is not measured and is not part of the score.';
  var SELECTION_LABEL = 'confirmed public scheduled stops (CDOT or agency GTFS; no private shuttles, no demand-response)';

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastStops        = [];     // counted stops: { lat, lon, name, agency }
  var lastTiers        = null;   // distanceTiers() of the last scored site
  var lastEpaData      = null;
  // null until calculateTransitScore() runs, and tagged with the site it was
  // computed for, so a caller cannot read a 0 or a previous site's score as
  // this site's transit access (#1937).
  var lastScore        = null;
  var lastSite         = null;
  var lastWalkScore    = null;
  var lastDeserts      = [];
  var lastMeasure      = null;
  var lastTransitReason = null;
  var _lastDataSources = {};

  // The counted stops of the last FeatureCollection seen, so a page that
  // scores several sites against the same file selects them once.
  var _selectedFrom = null;
  var _selected     = null;

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function toRad(deg) { return deg * Math.PI / 180; }

  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Only for values already known to be present (EPA fields behind hasEpa).
  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function transitZone() {
    if (typeof window !== 'undefined' && window.TransitZone) return window.TransitZone;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('./transit-zone.js'); } catch (e) { return null; }
    }
    return null;
  }

  // Points for identifyTransitDeserts / getTransitLayer: counted stops
  // ({lat, lon}), or legacy route objects carrying a stops array.
  function toPoints(list) {
    var pts = [];
    (list || []).forEach(function (s) {
      if (!s) return;
      if (Array.isArray(s.stops)) {
        s.stops.forEach(function (p) {
          if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
            pts.push({ lat: p.lat, lon: p.lon, name: s.name || s.routeName || null, agency: s.agency || null });
          }
        });
      } else if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) {
        pts.push(s);
      }
    });
    return pts;
  }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * The statewide transit stop file, via DataService (fetched once per page).
   * @returns {Promise<{geojson: object|null, unavailableReason: string|null, _dataSource: string}>}
   */
  function fetchTransitStops() {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchTransitStops === 'function') {
      return ds.fetchTransitStops();
    }
    return Promise.resolve({ geojson: null, unavailableReason: STOPS_UNAVAILABLE_REASON, _dataSource: 'unavailable' });
  }

  /**
   * The zone-map status file, via DataService (fetched once per page).
   * @returns {Promise<{mapStatus: object|null, unavailableReason: string|null}>}
   */
  function fetchTransitZoneStatus() {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchTransitZoneStatus === 'function') {
      return ds.fetchTransitZoneStatus();
    }
    return Promise.resolve({ mapStatus: null, unavailableReason: STATUS_UNAVAILABLE_REASON });
  }

  /**
   * Fetch EPA Smart Location Database transit accessibility metrics.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{transitAccessibility: number, walkScore: number}>}
   */
  function fetchEPASmartLocation(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchEPASmartLocation === 'function') {
      return ds.fetchEPASmartLocation(boundingBox);
    }
    return Promise.resolve({
      transitAccessibility: null,
      walkScore: null,
      _dataSource: 'epa-unavailable',
      unavailableReason: EPA_UNAVAILABLE_REASON
    });
  }

  /**
   * The two distance tiers, from the zone-map status file.
   * @param {object|null} mapStatus - data/policy/thiz-map-status.json
   * @returns {{ tiers: Array|null, todMiles: number|null, zoneRadiusMiles: number|null,
   *             todLabel: string|null, todDisclosure: string|null, unavailableReason: string|null }}
   */
  function distanceTiers(mapStatus) {
    var tz = transitZone();
    if (!tz || typeof tz.qapTodDistance !== 'function' || typeof tz.zoneRadiusMiles !== 'function') {
      return { tiers: null, todMiles: null, zoneRadiusMiles: null, todLabel: null, todDisclosure: null,
               unavailableReason: RULE_UNAVAILABLE_REASON };
    }
    var tod = tz.qapTodDistance(mapStatus);
    var radius = tz.zoneRadiusMiles(mapStatus);
    if (!tod || radius === null) {
      return { tiers: null, todMiles: tod ? tod.miles : null, zoneRadiusMiles: radius, todLabel: tod ? tod.label : null,
               todDisclosure: null, unavailableReason: (mapStatus && mapStatus.unavailableReason) || STATUS_UNAVAILABLE_REASON };
    }
    return {
      tiers: [
        { maxMiles: tod.miles, credit: TOD_TIER_CREDIT,  label: 'tod' },
        { maxMiles: radius,    credit: ZONE_TIER_CREDIT, label: 'zone' }
      ],
      todMiles: tod.miles,
      zoneRadiusMiles: radius,
      todLabel: tod.label,
      // How the TOD distance is measured versus how CHFA scores it; every
      // surface that shows a TOD-distance count carries it (#1961).
      todDisclosure: tod.disclosure,
      unavailableReason: null
    };
  }

  /**
   * The counted stops of a stop FeatureCollection, by the shared rule.
   * @returns {{ stops: Array|null, unavailableReason: string|null }}
   */
  function selectCountedStops(stopsGeojson) {
    var feats = stopsGeojson && Array.isArray(stopsGeojson.features) ? stopsGeojson.features : null;
    if (!feats || !feats.length) {
      return { stops: null, unavailableReason: (stopsGeojson && stopsGeojson.unavailableReason) || STOPS_UNAVAILABLE_REASON };
    }
    var tz = transitZone();
    if (!tz || typeof tz.countsAsConfirmedStop !== 'function') {
      return { stops: null, unavailableReason: RULE_UNAVAILABLE_REASON };
    }
    if (_selectedFrom === stopsGeojson && _selected) return { stops: _selected, unavailableReason: null };
    var out = [];
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      var g = f && f.geometry;
      var c = g && g.type === 'Point' ? g.coordinates : null;
      if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      var p = f.properties || {};
      if (!tz.countsAsConfirmedStop(p)) continue;
      out.push({ lat: c[1], lon: c[0], name: p.name || null, agency: p.agency || null });
    }
    _selectedFrom = stopsGeojson;
    _selected = out;
    return { stops: out, unavailableReason: null };
  }

  /**
   * What the counted stops look like from one site.
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {Array<{lat,lon,name,agency}>} countedStops
   * @param {Array} tiers - distanceTiers(mapStatus).tiers, innermost first
   */
  function measureStops(siteLat, siteLon, countedStops, tiers) {
    var tierCounts = {};
    tiers.forEach(function (t) { tierCounts[t.label] = 0; });
    var outer = tiers.reduce(function (m, t) { return Math.max(m, t.maxMiles); }, 0);
    var inner = tiers[0].maxMiles;
    var agenciesNear = {}, agenciesZone = {};
    var nearest = null, dNearest = Infinity;
    for (var i = 0; i < countedStops.length; i++) {
      var s = countedStops[i];
      var d = haversine(siteLat, siteLon, s.lat, s.lon);
      if (d < dNearest) { dNearest = d; nearest = s; }
      if (d > outer) continue;
      for (var t = 0; t < tiers.length; t++) {
        if (d <= tiers[t].maxMiles) { tierCounts[tiers[t].label]++; break; }
      }
      if (s.agency) {
        agenciesZone[s.agency] = true;
        if (d <= inner) agenciesNear[s.agency] = true;
      }
    }
    var coverage = 0;
    var inTiers = 0;
    tiers.forEach(function (tier) {
      coverage += tier.credit * 100 * Math.min(1, tierCounts[tier.label] / STOPS_FOR_FULL_TIER);
      inTiers += tierCounts[tier.label];
    });
    return {
      tierBreakdown:        tierCounts,
      stopsWithinTodDistance: tierCounts[tiers[0].label],
      stopsWithinZoneRadius:  inTiers,
      nearbyAgencyCount:    Object.keys(agenciesNear).length,
      agenciesWithinZoneRadius: Object.keys(agenciesZone).sort(),
      nearestConfirmedStop: nearest ? { name: nearest.name, agency: nearest.agency,
                                        distanceMiles: Math.round(dNearest * 100) / 100 } : null,
      coverageScore:        Math.round(clamp(coverage, 0, 100) * 10) / 10
    };
  }

  function unavailable(reason, dataSources) {
    lastStops = [];
    lastMeasure = null;
    lastScore = null;
    lastTransitReason = reason;
    _lastDataSources = dataSources;
    return null;
  }

  /**
   * Calculate the 0–100 transit accessibility score from confirmed stops.
   *
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {object|null} stopsGeojson - data/amenities/transit_stops_statewide_co.geojson
   *   (a FeatureCollection). null / no features → null, with
   *   transitUnavailableReason (stopsGeojson.unavailableReason when given).
   * @param {object} epaData  - EPA Smart Location metrics (may have null values)
   * @param {object|null} mapStatus - data/policy/thiz-map-status.json, the
   *   source of both distances. Missing either value → null with a reason.
   * @returns {number|null} 0–100 score, or null when it could not be measured
   */
  function calculateTransitScore(siteLat, siteLon, stopsGeojson, epaData, mapStatus) {
    epaData = epaData || {};
    lastEpaData = epaData;
    lastSite    = { lat: siteLat, lon: siteLon };
    lastDeserts = [];

    var epaSource = epaData._dataSource || '';
    var epaAvail  = epaSource === 'epa-live' || epaSource === 'epa-sld-local';
    var hasEpa  = epaData.transitAccessibility != null && epaAvail;
    var hasWalk = epaData.walkScore != null && epaAvail;
    var epaReason = (!hasEpa || !hasWalk) ? (epaData.unavailableReason || EPA_UNAVAILABLE_REASON) : null;

    var walkScore = null;
    if (hasWalk) {
      var walkRaw = toNum(epaData.walkScore || epaData.D3b);
      walkScore = walkRaw <= 20 ? clamp(walkRaw * 5, 0, 100) : clamp(walkRaw, 0, 100);
    }
    lastWalkScore = walkScore;

    var dist = distanceTiers(mapStatus);
    lastTiers = dist;
    function sources(extra) {
      var o = {
        selection:         SELECTION_LABEL,
        epaData:           hasEpa ? epaSource : 'unavailable',
        walkData:          hasWalk ? epaSource : 'unavailable',
        frequencyData:     'unavailable',
        todMiles:          dist.todMiles,
        zoneRadiusMiles:   dist.zoneRadiusMiles,
        unavailableReason: epaReason
      };
      Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      return o;
    }

    if (!(Number.isFinite(siteLat) && Number.isFinite(siteLon))) {
      return unavailable('The site location could not be read, so transit access was not scored.',
        sources({ stopData: 'unavailable', countedStops: null, coverageScore: null, tierBreakdown: null }));
    }
    var sel = selectCountedStops(stopsGeojson);
    if (!sel.stops) {
      return unavailable(sel.unavailableReason,
        sources({ stopData: 'unavailable', countedStops: null, coverageScore: null, tierBreakdown: null }));
    }
    if (!dist.tiers) {
      return unavailable(dist.unavailableReason,
        sources({ stopData: 'local-stops', countedStops: sel.stops.length, coverageScore: null, tierBreakdown: null }));
    }

    lastStops = sel.stops;
    lastTransitReason = null;
    var m = measureStops(siteLat, siteLon, sel.stops, dist.tiers);
    lastMeasure = m;

    // Frequency is never measured (see header); the composite is the
    // weighted mean of the components that were.
    var parts = [{ w: TRANSIT_WEIGHTS.coverage, v: m.coverageScore }];
    if (hasEpa) {
      var epaRaw = toNum(epaData.transitAccessibility || epaData.D4a);
      parts.push({ w: TRANSIT_WEIGHTS.epaIndex, v: epaRaw <= 20 ? clamp(epaRaw * 5, 0, 100) : clamp(epaRaw, 0, 100) });
    }
    if (hasWalk) parts.push({ w: TRANSIT_WEIGHTS.walkScore, v: walkScore });
    var wSum = 0, vSum = 0;
    parts.forEach(function (p) { wSum += p.w; vSum += p.w * p.v; });
    lastScore = clamp(Math.round(vSum / wSum), 0, 100);

    _lastDataSources = sources({
      stopData:          'local-stops',
      countedStops:      sel.stops.length,
      coverageScore:     m.coverageScore,
      tierBreakdown:     m.tierBreakdown          // tod / zone stop counts
    });

    return lastScore;
  }

  /**
   * Identify transit deserts — cells of the PMA with no counted stop within
   * the QAP transit-oriented distance. Grid-based.
   *
   * @param {object} pmaPolygon - GeoJSON Polygon geometry
   * @param {Array}  [stops]    - counted stops ({lat, lon}); defaults to the
   *                              last scored site's. Legacy route objects with
   *                              a `stops` array are also accepted.
   * @param {object} [mapStatus] - the status file; defaults to the distances
   *                              of the last scored site.
   * @returns {Array|null} desert cells; null when the distance is unknown
   */
  function identifyTransitDeserts(pmaPolygon, stops, mapStatus) {
    if (!pmaPolygon) { return []; }
    var coords = (pmaPolygon.coordinates && pmaPolygon.coordinates[0]) || [];
    if (!coords.length) { return []; }

    var dist = mapStatus ? distanceTiers(mapStatus) : lastTiers;
    var reach = dist && dist.tiers ? dist.todMiles : null;
    if (reach === null) { lastDeserts = []; return null; }
    var pts = toPoints(stops || lastStops);

    var lats = coords.map(function (c) { return c[1]; });
    var lons = coords.map(function (c) { return c[0]; });
    var minLat = Math.min.apply(null, lats);
    var maxLat = Math.max.apply(null, lats);
    var minLon = Math.min.apply(null, lons);
    var maxLon = Math.max.apply(null, lons);

    var stepDeg = DESERT_CELL_MILES / 69.0;
    var deserts = [];

    for (var lat = minLat; lat <= maxLat; lat += stepDeg) {
      for (var lon = minLon; lon <= maxLon; lon += stepDeg) {
        var served = pts.some(function (s) {
          return haversine(lat, lon, s.lat, s.lon) <= reach;
        });
        if (!served) {
          deserts.push({ lat: lat, lon: lon, type: 'transit-desert' });
        }
      }
    }

    lastDeserts = deserts;
    return deserts;
  }

  /**
   * GeoJSON FeatureCollection of counted stops (the last scored site's
   * stops within the zone radius when called with no argument).
   * @param {Array} [stops]
   * @returns {object} GeoJSON FeatureCollection
   */
  function getTransitLayer(stops) {
    var radius = lastTiers && lastTiers.tiers ? lastTiers.zoneRadiusMiles : null;
    var pts = toPoints(stops || (lastSite && radius !== null ? lastStops.filter(function (s) {
      return haversine(lastSite.lat, lastSite.lon, s.lat, s.lon) <= radius;
    }) : []));
    return {
      type: 'FeatureCollection',
      features: pts.map(function (s) {
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          properties: { name: s.name || null, agency: s.agency || null }
        };
      })
    };
  }

  /**
   * Export transit analysis for ScoreRun audit trail.
   * @returns {object}
   */
  function getTransitJustification() {
    var epaAvailable = _lastDataSources.epaData === 'epa-live' || _lastDataSources.epaData === 'epa-sld-local';
    var walkAvailable = _lastDataSources.walkData === 'epa-live' || _lastDataSources.walkData === 'epa-sld-local';
    var epa = lastEpaData || {};
    var m = lastMeasure;
    var dist = lastTiers || {};
    return {
      transitAccessibilityScore: lastScore,
      // Why transitAccessibilityScore is null (stop or status data unreadable).
      transitUnavailableReason:  lastTransitReason,
      siteLat:                   lastSite ? lastSite.lat : null,
      siteLon:                   lastSite ? lastSite.lon : null,
      walkScore:                 lastWalkScore,
      walkScoreAvailable:        walkAvailable,
      epaDataAvailable:          epaAvailable,
      // EPA Smart Location unavailability (the transit reason is above).
      unavailableReason:         _lastDataSources.unavailableReason || null,
      // The two distances, from data/policy/thiz-map-status.json.
      todMiles:                  m ? dist.todMiles : null,
      todLabel:                  m ? dist.todLabel : null,
      todDisclosure:             m ? dist.todDisclosure : null,
      zoneRadiusMiles:           m ? dist.zoneRadiusMiles : null,
      // Confirmed stops by distance; null (not 0) when nothing was measured.
      nearbyStopCount:           m ? m.stopsWithinTodDistance : null,
      stopsWithinZoneRadius:     m ? m.stopsWithinZoneRadius : null,
      nearbyAgencyCount:         m ? m.nearbyAgencyCount : null,
      agenciesWithinZoneRadius:  m ? m.agenciesWithinZoneRadius : null,
      nearestConfirmedStop:      m ? m.nearestConfirmedStop : null,
      // A measured zero: the files loaded and no confirmed stop is in range.
      noConfirmedStopWithinZoneRadius: m ? m.stopsWithinZoneRadius === 0 : null,
      serviceGaps:               lastDeserts.length,
      hasHighFrequencyService:   null,
      highFrequencyUnavailableReason: FREQUENCY_UNAVAILABLE_REASON,
      // Extended EPA SLD metrics (available when _dataSource is epa-sld-local)
      jobAccess:                 epa.jobAccess != null ? epa.jobAccess : null,
      landUseMix:                epa.landUseMix != null ? epa.landUseMix : null,
      empDensity:                epa.empDensity != null ? epa.empDensity : null,
      blockGroupCount:           epa.blockGroupCount || null,
      _dataSources: _lastDataSources
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  var api = {
    fetchTransitStops:       fetchTransitStops,
    fetchTransitZoneStatus:  fetchTransitZoneStatus,
    fetchEPASmartLocation:   fetchEPASmartLocation,
    distanceTiers:           distanceTiers,
    selectCountedStops:      selectCountedStops,
    measureStops:            measureStops,
    calculateTransitScore:   calculateTransitScore,
    identifyTransitDeserts:  identifyTransitDeserts,
    getTransitLayer:         getTransitLayer,
    getTransitJustification: getTransitJustification,
    TRANSIT_WEIGHTS:         TRANSIT_WEIGHTS,
    STOPS_FOR_FULL_TIER:     STOPS_FOR_FULL_TIER
  };
  if (typeof window !== 'undefined') {
    window.PMATransit = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

}());
