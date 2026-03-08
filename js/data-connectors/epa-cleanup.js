/**
 * js/data-connectors/epa-cleanup.js
 * EPA Brownfield/Superfund cleanup sites connector.
 * Uses preloaded data or returns safe defaults.
 * Exposes window.EpaCleanup.
 */
(function () {
  'use strict';

  /** @const {number} Earth radius in miles for haversine calculations */
  var EARTH_RADIUS_MI = 3958.8;

  /**
   * Stored cleanup sites array.
   * Each item: { name, lat, lon, type, status }
   *   type:   'brownfield' | 'superfund' | 'rcra'
   *   status: 'active' | 'complete' | 'listed'
   * @type {Array.<{name: string, lat: number, lon: number, type: string, status: string}>}
   */
  var sites = [];

  /**
   * Whether site data has been loaded.
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
   * Validates and normalises the `type` field of a site record.
   * @param {*} raw
   * @returns {string}
   */
  function normaliseType(raw) {
    var t = String(raw || '').toLowerCase().trim();
    if (t === 'brownfield' || t === 'superfund' || t === 'rcra') { return t; }
    return 'brownfield'; // safe default
  }

  /**
   * Validates and normalises the `status` field of a site record.
   * @param {*} raw
   * @returns {string}
   */
  function normaliseStatus(raw) {
    var s = String(raw || '').toLowerCase().trim();
    if (s === 'active' || s === 'complete' || s === 'listed') { return s; }
    return 'active'; // safe default
  }

  /**
   * Stores a preloaded array of EPA cleanup site records.
   * @param {Array.<{name: string, lat: number, lon: number, type: string, status: string}>} data
   */
  function loadSites(data) {
    if (!Array.isArray(data)) {
      console.warn('[EpaCleanup] loadSites: expected an array, got ' + typeof data);
      return;
    }

    sites = [];
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      if (!item) { continue; }
      sites.push({
        name:   String(item.name || item.NAME || ''),
        lat:    parseFloat(item.lat  || item.LATITUDE  || item.latitude)  || 0,
        lon:    parseFloat(item.lon  || item.LONGITUDE || item.longitude) || 0,
        type:   normaliseType(item.type   || item.TYPE),
        status: normaliseStatus(item.status || item.STATUS)
      });
    }

    loaded = sites.length > 0;
    console.log('[EpaCleanup] Loaded ' + sites.length + ' EPA cleanup site records');
  }

  /**
   * Returns all cleanup sites within the specified radius of a point.
   * @param {number} lat  Center latitude.
   * @param {number} lon  Center longitude.
   * @param {number} miles  Search radius in miles.
   * @returns {Array.<Object>} Matching site objects.
   */
  function getSitesInBuffer(lat, lon, miles) {
    if (!loaded || typeof lat !== 'number' || typeof lon !== 'number' || typeof miles !== 'number') {
      return [];
    }

    var results = [];
    for (var i = 0; i < sites.length; i++) {
      var s = sites[i];
      if (!s) { continue; }
      if (haversine(lat, lon, s.lat, s.lon) <= miles) {
        results.push(s);
      }
    }
    return results;
  }

  /**
   * Derives a 0–100 development constraint score for a set of sites.
   *
   * Scoring rules (applied in order of worst-case precedence):
   *   20  — Any superfund site with status 'listed'
   *   50  — Any active brownfield (type 'brownfield', status 'active')
   *   80  — Only complete brownfields present
   *   100 — No sites in the set
   *
   * If multiple risk levels are present the lowest (most constrained) score
   * is returned.
   *
   * @param {Array.<Object>} sitesArr
   * @returns {number} Score from 0 to 100.
   */
  function getConstraintScore(sitesArr) {
    if (!Array.isArray(sitesArr) || sitesArr.length === 0) {
      return 100;
    }

    var score = 100;

    for (var i = 0; i < sitesArr.length; i++) {
      var s = sitesArr[i];
      if (!s) { continue; }

      var type   = normaliseType(s.type);
      var status = normaliseStatus(s.status);

      if (type === 'superfund' && status === 'listed') {
        // Worst case — return immediately
        return 20;
      }

      if (type === 'brownfield' && status === 'active') {
        if (score > 50) { score = 50; }
      } else if (type === 'brownfield' && status === 'complete') {
        if (score > 80) { score = 80; }
      } else if (type === 'rcra') {
        // RCRA sites treated similarly to active brownfields
        if (score > 50) { score = 50; }
      }
    }

    return score;
  }

  /**
   * Returns whether cleanup site data has been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  window.EpaCleanup = {
    loadSites: loadSites,
    getSitesInBuffer: getSitesInBuffer,
    getConstraintScore: getConstraintScore,
    isLoaded: isLoaded
  };

}());
