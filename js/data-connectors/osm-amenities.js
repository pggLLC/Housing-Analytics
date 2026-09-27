/**
 * js/data-connectors/osm-amenities.js
 * OSM amenity proximity connector.
 * Uses preloaded amenity data (no live OSM API calls on GitHub Pages).
 * Exposes window.OsmAmenities.
 */
(function () {
  'use strict';

  /** @const {number} Earth radius in miles for haversine calculations */
  var EARTH_RADIUS_MI = 3958.8;

  /**
   * Canonical amenity type identifiers used throughout the scoring logic.
   * @type {Array.<string>}
   */
  var AMENITY_TYPES = ['grocery', 'transit_stop', 'park', 'healthcare', 'school', 'hospital', 'childcare'];

  /**
   * Mapping from score-output keys to canonical amenity type identifiers.
   * @type {Object.<string, string>}
   */
  var SCORE_KEY_TO_TYPE = {
    grocery:    'grocery',
    transit:    'transit_stop',
    parks:      'park',
    healthcare: 'healthcare',
    schools:    'school',
    hospitals:  'hospital',
    childcare:  'childcare'
  };

  /**
   * transit_stop records carry transit_stop_basis (scripts/lib/transit_stops.py):
   * "confirmed" (CDOT or an agency GTFS feed publishes the stop) or
   * "openstreetmap_unconfirmed" (only OpenStreetMap maps it). A record with no
   * basis (the builder's seed fallback) is treated as confirmed.
   */
  var BASIS_CONFIRMED = 'confirmed';
  var BASIS_UNCONFIRMED = 'openstreetmap_unconfirmed';
  var BASIS_NONE = 'none';

  /**
   * The distance within which a stop earns transit credit: the last band of
   * distanceToScore() with a score above 0. The OpenStreetMap-only fallback
   * applies only when no confirmed stop is this close to the analyzed site.
   * tests/test_transit_stop_selection.py pins the builder's
   * TRANSIT_FALLBACK_RADIUS_MILES to the same band.
   * @type {number}
   */
  var TRANSIT_SCORING_RADIUS_MILES = 2.0;

  /**
   * Stored amenities array. Each item: { type, name, lat, lon }
   * @type {Array.<{type: string, name: string, lat: number, lon: number}>}
   */
  var amenities = [];

  /**
   * The transit_stop subset of amenities, kept once at load so the per-site
   * transit rule does not rescan every record type.
   * @type {Array.<Object>}
   */
  var transitRecords = [];

  /**
   * Whether amenity data has been loaded.
   * @type {boolean}
   */
  var loaded = false;

  /**
   * Converts degrees to radians.
   * @param {number} deg
   * @returns {number}
   */
  function toRad(deg) {
    return deg * Math.PI / 180;
  }

  /**
   * Computes the haversine great-circle distance in miles between two points.
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} Distance in miles.
   */
  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Converts a distance in miles to a walkability score (0–100).
   * @param {number} distanceMiles
   * @returns {number}
   */
  function distanceToScore(distanceMiles) {
    if (distanceMiles <= 0.25) { return 100; }
    if (distanceMiles <= 0.50) { return 75; }
    if (distanceMiles <= 1.00) { return 50; }
    if (distanceMiles <= 2.00) { return 25; }
    return 0;
  }

  /**
   * Stores a preloaded amenities array.
   * Each item must have at minimum: type, name, lat, lon.
   * @param {Array.<{type: string, name: string, lat: number, lon: number}>} data
   */
  function loadAmenities(data) {
    if (!Array.isArray(data)) {
      console.warn('[OsmAmenities] loadAmenities: expected an array, got ' + typeof data);
      return;
    }

    amenities = [];
    transitRecords = [];
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      if (!item || !item.type) { continue; }
      var rec = {
        type: String(item.type),
        name: String(item.name || ''),
        lat:  parseFloat(item.lat) || 0,
        lon:  parseFloat(item.lon) || 0
      };
      if (rec.type === 'transit_stop') {
        rec.transitStopBasis = item.transit_stop_basis === BASIS_UNCONFIRMED ? BASIS_UNCONFIRMED : BASIS_CONFIRMED;
      }
      amenities.push(rec);
      if (rec.type === 'transit_stop') { transitRecords.push(rec); }
    }

    loaded = amenities.length > 0;
    console.log('[OsmAmenities] Loaded ' + amenities.length + ' amenity records');
  }

  /**
   * Which transit stops an analyzed site is scored on, decided for THAT site:
   * the confirmed stops whenever one is within TRANSIT_SCORING_RADIUS_MILES;
   * otherwise the OpenStreetMap-only stops when one of them is; otherwise the
   * confirmed stops (none in range, so the site scores as it always did).
   * Never mixed: a nearer unconfirmed stop never outranks a confirmed one in
   * range. (Codex on #1991: the fallback used to be chosen around place
   * centroids by the builder, not per site.)
   * @param {number} lat
   * @param {number} lon
   * @returns {{ basis: string, records: Array.<Object> }}
   */
  function transitSelection(lat, lon) {
    var confirmed = [], unconfirmed = [];
    var confirmedInRange = false, unconfirmedInRange = false;
    for (var i = 0; i < transitRecords.length; i++) {
      var a = transitRecords[i];
      // Great-circle distance is never less than the latitude difference
      // alone, so a stop that far north or south cannot be in range.
      var inRange = EARTH_RADIUS_MI * Math.abs(toRad(a.lat - lat)) <= TRANSIT_SCORING_RADIUS_MILES &&
                    haversine(lat, lon, a.lat, a.lon) <= TRANSIT_SCORING_RADIUS_MILES;
      if (a.transitStopBasis === BASIS_UNCONFIRMED) {
        unconfirmed.push(a);
        if (inRange) { unconfirmedInRange = true; }
      } else {
        confirmed.push(a);
        if (inRange) { confirmedInRange = true; }
      }
    }
    if (confirmedInRange) { return { basis: BASIS_CONFIRMED, records: confirmed }; }
    if (unconfirmedInRange) { return { basis: BASIS_UNCONFIRMED, records: unconfirmed }; }
    return { basis: BASIS_NONE, records: confirmed.length ? confirmed : unconfirmed };
  }

  var TRANSIT_BASIS_REASON = {
    openstreetmap_unconfirmed: 'No CDOT- or agency-published stop is within ' + TRANSIT_SCORING_RADIUS_MILES +
      ' miles of this site, so it is scored on a stop that only OpenStreetMap maps; confirm service with the agency.',
    none: 'No transit stop is within ' + TRANSIT_SCORING_RADIUS_MILES + ' miles of this site.'
  };

  /**
   * Returns the nearest amenity of a given type to a coordinate, along with
   * its distance in miles. For transit_stop the per-site confirmed-first rule
   * (transitSelection) decides which stops are eligible, and the result says
   * which: transitStopBasis ("confirmed", "openstreetmap_unconfirmed" or
   * "none"), confirmed (true, false, or null when no stop is in range) and
   * transitStopBasisReason (null when confirmed).
   * @param {number} lat
   * @param {number} lon
   * @param {string} type  One of the AMENITY_TYPES values.
   * @returns {{ name: string, distanceMiles: number, score: number }|null}
   *   Null if no amenity of that type is found.
   */
  function getNearestByType(lat, lon, type) {
    if (!loaded || typeof lat !== 'number' || typeof lon !== 'number' || !type) {
      return null;
    }

    var nearest = null;
    var minDist = Infinity;
    var selection = type === 'transit_stop' ? transitSelection(lat, lon) : null;
    var pool = selection ? selection.records : amenities;

    for (var i = 0; i < pool.length; i++) {
      var a = pool[i];
      if (a.type !== type) { continue; }
      // Exact prune: the great-circle distance is at least the latitude
      // difference, so this record cannot beat the nearest found so far.
      if (EARTH_RADIUS_MI * Math.abs(toRad(a.lat - lat)) >= minDist) { continue; }

      var d = haversine(lat, lon, a.lat, a.lon);
      if (d < minDist) {
        minDist = d;
        nearest = a;
      }
    }

    if (!nearest) { return null; }

    var dist = parseFloat(minDist.toFixed(2));
    var out = {
      name:          nearest.name,
      distanceMiles: dist,
      score:         distanceToScore(dist)
    };
    if (selection) {
      out.transitStopBasis = selection.basis;
      out.confirmed = selection.basis === BASIS_NONE ? null : selection.basis === BASIS_CONFIRMED;
      out.transitStopBasisReason = TRANSIT_BASIS_REASON[selection.basis] || null;
    }
    return out;
  }

  /**
   * Returns every amenity of a given type within a radius of a coordinate,
   * nearest first. Distances are straight-line (haversine) miles.
   * @param {number} lat
   * @param {number} lon
   * @param {string} type          One of the AMENITY_TYPES values.
   * @param {number} radiusMiles
   * @returns {Array<{ name: string, lat: number, lon: number, distanceMiles: number }>}
   *   transit_stop hits also carry transitStopBasis, so a caller can tell an
   *   OpenStreetMap-only stop from a confirmed one; nothing is filtered here.
   *   Empty when nothing is in range. Null when amenity data is not loaded
   *   or the inputs are invalid, so "no data" is not mistaken for "none nearby".
   */
  function getWithinRadius(lat, lon, type, radiusMiles) {
    if (!loaded || typeof lat !== 'number' || typeof lon !== 'number' || !type ||
        typeof radiusMiles !== 'number' || !(radiusMiles > 0)) {
      return null;
    }

    var found = [];
    for (var i = 0; i < amenities.length; i++) {
      var a = amenities[i];
      if (a.type !== type) { continue; }
      var d = haversine(lat, lon, a.lat, a.lon);
      if (d <= radiusMiles) {
        var hit = { name: a.name, lat: a.lat, lon: a.lon, distanceMiles: parseFloat(d.toFixed(2)) };
        if (a.transitStopBasis) { hit.transitStopBasis = a.transitStopBasis; }
        found.push(hit);
      }
    }
    found.sort(function (x, y) { return x.distanceMiles - y.distanceMiles; });
    return found;
  }

  /**
   * Computes a multi-category access score for a given coordinate.
   * Each category returns the nearest amenity of the mapped type.
   * `overall` is the rounded mean of all five category scores.
   * @param {number} lat
   * @param {number} lon
   * @returns {{
   *   grocery:    { name: string, distanceMiles: number, score: number },
   *   transit:    { name: string, distanceMiles: number, score: number },
   *   parks:      { name: string, distanceMiles: number, score: number },
   *   healthcare: { name: string, distanceMiles: number, score: number },
   *   schools:    { name: string, distanceMiles: number, score: number },
   *   overall:    number
   * }}
   */
  function getAccessScore(lat, lon) {
    var defaultEntry = { name: '', distanceMiles: null, score: 0 };
    var result = {
      grocery:    defaultEntry,
      transit:    defaultEntry,
      parks:      defaultEntry,
      healthcare: defaultEntry,
      schools:    defaultEntry,
      hospitals:  defaultEntry,
      childcare:  defaultEntry,
      overall:    0
    };

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return result;
    }

    var scoreSum = 0;
    var scoreCount = 0;

    for (var key in SCORE_KEY_TO_TYPE) {
      if (!Object.prototype.hasOwnProperty.call(SCORE_KEY_TO_TYPE, key)) { continue; }
      var amenityType = SCORE_KEY_TO_TYPE[key];
      var nearest = getNearestByType(lat, lon, amenityType);
      if (nearest) {
        result[key] = nearest;
        scoreSum += nearest.score;
      } else {
        result[key] = { name: '', distanceMiles: null, score: 0 };
      }
      scoreCount++;
    }

    result.overall = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;

    // Add typed transit distances for rail vs bus differentiation.
    // transit_rail = nearest rail/tram/light rail stop
    // transit_bus  = nearest bus stop
    var RAIL_TYPES = { rail_station: true, tram_stop: true, rail_halt: true, transit_station: true };
    var BUS_TYPES  = { bus_stop: true, bus_station: true, platform: true };
    // Same per-site stop set as the transit score, so a rail/bus distance
    // never comes from an unconfirmed stop where a confirmed one is in range.
    var nearestRail = null, nearestBus = null;
    var railDist = Infinity, busDist = Infinity;
    var transitPool = transitSelection(lat, lon).records;

    for (var ti = 0; ti < transitPool.length; ti++) {
      var ta = transitPool[ti];
      if (ta.type !== 'transit_stop') continue;
      var td = haversine(lat, lon, ta.lat, ta.lon);
      var tt = ta.transit_type || '';
      if (RAIL_TYPES[tt] && td < railDist) { railDist = td; nearestRail = ta; }
      if (BUS_TYPES[tt] && td < busDist) { busDist = td; nearestBus = ta; }
      // If no transit_type field, treat as bus (conservative)
      if (!tt && td < busDist) { busDist = td; nearestBus = ta; }
    }

    result.transit_rail = nearestRail
      ? { name: nearestRail.name, distanceMiles: parseFloat(railDist.toFixed(2)), transit_type: nearestRail.transit_type || 'rail' }
      : { name: '', distanceMiles: null, transit_type: 'none' };
    result.transit_bus = nearestBus
      ? { name: nearestBus.name, distanceMiles: parseFloat(busDist.toFixed(2)), transit_type: nearestBus.transit_type || 'bus' }
      : { name: '', distanceMiles: null, transit_type: 'none' };

    return result;
  }

  /**
   * Returns whether amenity data has been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  /**
   * Returns how many loaded records there are of each type, e.g.
   * { grocery: 2178, hospital: 121, ... }. A fresh object each call; types
   * with no records are absent, not 0. Empty object before data loads.
   * @returns {Object.<string, number>}
   */
  function countByType() {
    var counts = {};
    for (var i = 0; i < amenities.length; i++) {
      var t = amenities[i].type;
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }

  window.OsmAmenities = {
    loadAmenities: loadAmenities,
    getNearestByType: getNearestByType,
    getWithinRadius: getWithinRadius,
    getAccessScore: getAccessScore,
    isLoaded: isLoaded,
    countByType: countByType
  };

}());
