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
   * Stored amenities array. Each item: { type, name, lat, lon }
   * @type {Array.<{type: string, name: string, lat: number, lon: number}>}
   */
  var amenities = [];

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
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      if (!item || !item.type) { continue; }
      amenities.push({
        type: String(item.type),
        name: String(item.name || ''),
        lat:  parseFloat(item.lat) || 0,
        lon:  parseFloat(item.lon) || 0
      });
    }

    loaded = amenities.length > 0;
    console.log('[OsmAmenities] Loaded ' + amenities.length + ' amenity records');
  }

  /**
   * Returns the nearest amenity of a given type to a coordinate, along with
   * its distance in miles.
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

    for (var i = 0; i < amenities.length; i++) {
      var a = amenities[i];
      if (a.type !== type) { continue; }

      var d = haversine(lat, lon, a.lat, a.lon);
      if (d < minDist) {
        minDist = d;
        nearest = a;
      }
    }

    if (!nearest) { return null; }

    var dist = parseFloat(minDist.toFixed(2));
    return {
      name:          nearest.name,
      distanceMiles: dist,
      score:         distanceToScore(dist)
    };
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
    return result;
  }

  /**
   * Returns whether amenity data has been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  window.OsmAmenities = {
    loadAmenities: loadAmenities,
    getNearestByType: getNearestByType,
    getAccessScore: getAccessScore,
    isLoaded: isLoaded
  };

}());
