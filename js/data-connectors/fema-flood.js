/**
 * js/data-connectors/fema-flood.js
 * FEMA flood risk connector.
 * Uses preloaded flood zone data; falls back to "unknown" gracefully.
 * Exposes window.FemaFlood.
 */
(function () {
  'use strict';

  /** @const {number} Earth radius in miles for haversine proximity fallback */
  var EARTH_RADIUS_MI = 3958.8;

  /**
   * Stored flood zone features.
   * Each item is expected to have at minimum: lat, lon, zone (FEMA zone code).
   * For polygon-based zones, lat/lon represent a representative centroid.
   * @type {Array.<Object>}
   */
  var floodZones = [];

  /**
   * Whether flood zone data has been loaded.
   * @type {boolean}
   */
  var loaded = false;

  /**
   * The neutral fallback response returned when data is unavailable.
   * @type {{ zone: string, riskLevel: string, score: number }}
   */
  var FALLBACK = { zone: 'Unknown', riskLevel: 'Unknown', score: 50 };

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
   * @returns {number}
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
   * Derives a human-readable risk level and a 0–100 risk score from a FEMA
   * flood zone code.
   *
   * Zone codes:
   *   High risk    — A, AE, AH, AO, AR, A99, V, VE  (score: 0)
   *   Moderate risk— B, X500 (0.2% annual chance)    (score: 40)
   *   Low risk     — C, X                             (score: 100)
   *   Unknown      — anything else                    (score: 50)
   *
   * @param {string} zone - FEMA flood zone code.
   * @returns {{ riskLevel: string, score: number }}
   */
  function zoneToRisk(zone) {
    if (!zone || typeof zone !== 'string') {
      return { riskLevel: 'Unknown', score: 50 };
    }

    var z = zone.toUpperCase().trim();

    // High risk: any zone starting with A or V
    if (/^A/.test(z) || /^V/.test(z)) {
      return { riskLevel: 'High', score: 0 };
    }

    // Moderate risk: B or X500
    if (z === 'B' || z === 'X500' || z === '0.2 PCT ANNUAL CHANCE FLOOD HAZARD') {
      return { riskLevel: 'Moderate', score: 40 };
    }

    // Low risk: C or X
    if (z === 'C' || z === 'X') {
      return { riskLevel: 'Low', score: 100 };
    }

    return { riskLevel: 'Unknown', score: 50 };
  }

  /**
   * Stores preloaded flood zone feature data.
   * Each item must have a `zone` property (FEMA zone code) and either
   * `lat`/`lon` coordinates or a `geometry.coordinates` array [lon, lat].
   * @param {Array.<Object>|Object} data - Array of zone features or a GeoJSON
   *   FeatureCollection.
   */
  function loadFloodZones(data) {
    if (!data) {
      console.warn('[FemaFlood] loadFloodZones: no data provided');
      return;
    }

    if (Array.isArray(data)) {
      floodZones = data;
    } else if (data.features && Array.isArray(data.features)) {
      floodZones = data.features;
    } else {
      console.warn('[FemaFlood] loadFloodZones: unrecognised format');
      return;
    }

    loaded = floodZones.length > 0;
    console.log('[FemaFlood] Loaded ' + floodZones.length + ' flood zone features');
  }

  /**
   * Returns the flood risk information for a given geographic point.
   * Finds the nearest stored zone feature (by centroid proximity) and derives
   * risk level and score from its zone code.
   *
   * If no data has been loaded, returns the neutral fallback object.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {{ zone: string, riskLevel: string, score: number }}
   */
  function getRiskAtPoint(lat, lon) {
    if (!loaded) {
      return { zone: FALLBACK.zone, riskLevel: FALLBACK.riskLevel, score: FALLBACK.score };
    }

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      console.warn('[FemaFlood] getRiskAtPoint: invalid coordinates');
      return { zone: FALLBACK.zone, riskLevel: FALLBACK.riskLevel, score: FALLBACK.score };
    }

    var nearest = null;
    var minDist = Infinity;

    for (var i = 0; i < floodZones.length; i++) {
      var f = floodZones[i];
      if (!f) { continue; }

      var fLat, fLon;
      if (f.geometry && f.geometry.coordinates && f.geometry.coordinates.length >= 2) {
        fLon = f.geometry.coordinates[0];
        fLat = f.geometry.coordinates[1];
      } else {
        fLat = parseFloat(f.lat  || f.LATITUDE  || f.latitude)  || 0;
        fLon = parseFloat(f.lon  || f.LONGITUDE || f.longitude) || 0;
      }

      var d = haversine(lat, lon, fLat, fLon);
      if (d < minDist) {
        minDist = d;
        nearest = f;
      }
    }

    if (!nearest) {
      return { zone: FALLBACK.zone, riskLevel: FALLBACK.riskLevel, score: FALLBACK.score };
    }

    var zoneCode = String(
      nearest.zone || nearest.ZONE || nearest.FLD_ZONE ||
      (nearest.properties && (nearest.properties.FLD_ZONE || nearest.properties.zone)) ||
      'Unknown'
    );

    var risk = zoneToRisk(zoneCode);
    return {
      zone:      zoneCode,
      riskLevel: risk.riskLevel,
      score:     risk.score
    };
  }

  /**
   * Returns whether flood zone data has been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  window.FemaFlood = {
    loadFloodZones: loadFloodZones,
    getRiskAtPoint: getRiskAtPoint,
    isLoaded: isLoaded
  };

}());
