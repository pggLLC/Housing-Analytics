/**
 * js/data-connectors/hud-lihtc.js
 * HUD LIHTC database connector — loads from prebuilt GeoJSON.
 * For GitHub Pages, uses data/market/hud_lihtc_co.geojson.
 * Exposes window.HudLihtc.
 */
(function () {
  'use strict';

  /** @const {number} Earth radius in miles for haversine calculations */
  var EARTH_RADIUS_MI = 3958.8;

  /**
   * Stored array of GeoJSON Feature objects from the LIHTC dataset.
   * @type {Array.<Object>}
   */
  var features = [];

  /**
   * Whether features have been loaded.
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
   * Safely coerces a value to a finite number; returns 0 on failure.
   * @param {*} v
   * @returns {number}
   */
  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  /**
   * Stores LIHTC GeoJSON features for subsequent queries.
   * Accepts a GeoJSON FeatureCollection or a plain array of Feature objects.
   * @param {Object|Array} geojson
   */
  function loadFeatures(geojson) {
    if (!geojson) {
      console.warn('[HudLihtc] loadFeatures: no data provided');
      return;
    }

    if (Array.isArray(geojson)) {
      features = geojson;
    } else if (geojson.features && Array.isArray(geojson.features)) {
      features = geojson.features;
    } else {
      console.warn('[HudLihtc] loadFeatures: unrecognised format; expected GeoJSON FeatureCollection or array');
      return;
    }

    loaded = features.length > 0;
    console.log('[HudLihtc] Loaded ' + features.length + ' LIHTC features');
  }

  /**
   * Returns all LIHTC features whose coordinates fall within the specified
   * radius of the given point.
   * Features must have geometry.coordinates in [longitude, latitude] order
   * (standard GeoJSON), or properties.LATITUDE / properties.LONGITUDE as
   * fallback.
   * @param {number} lat  Center latitude.
   * @param {number} lon  Center longitude.
   * @param {number} miles  Search radius in miles.
   * @returns {Array.<Object>} Matching GeoJSON Feature objects.
   */
  function getFeaturesInBuffer(lat, lon, miles) {
    if (!loaded || typeof lat !== 'number' || typeof lon !== 'number' || typeof miles !== 'number') {
      return [];
    }

    var results = [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      if (!f) { continue; }

      var fLat, fLon;
      if (f.geometry && f.geometry.coordinates && f.geometry.coordinates.length >= 2) {
        fLon = f.geometry.coordinates[0];
        fLat = f.geometry.coordinates[1];
      } else if (f.properties) {
        fLat = toNum(f.properties.LATITUDE  || f.properties.lat);
        fLon = toNum(f.properties.LONGITUDE || f.properties.lon);
      } else {
        continue;
      }

      if (typeof fLat !== 'number' || typeof fLon !== 'number') { continue; }
      if (haversine(lat, lon, fLat, fLon) <= miles) {
        results.push(f);
      }
    }
    return results;
  }

  /**
   * Computes summary statistics for an array of LIHTC feature objects.
   * @param {Array.<Object>} featureArr
   * @returns {{
   *   count: number,
   *   totalUnits: number,
   *   avgYearAlloc: number,
   *   unitsByAmi: { ami30: number, ami40: number, ami50: number, ami60: number, ami80: number }
   * }}
   */
  function getStats(featureArr) {
    var empty = {
      count: 0,
      totalUnits: 0,
      avgYearAlloc: 0,
      unitsByAmi: { ami30: 0, ami40: 0, ami50: 0, ami60: 0, ami80: 0 }
    };

    if (!Array.isArray(featureArr) || featureArr.length === 0) {
      return empty;
    }

    var totalUnits = 0;
    var yearSum = 0;
    var yearCount = 0;
    var ami30 = 0, ami40 = 0, ami50 = 0, ami60 = 0, ami80 = 0;

    for (var i = 0; i < featureArr.length; i++) {
      var f = featureArr[i];
      if (!f) { continue; }
      var p = f.properties || f;

      totalUnits += toNum(p.TOTAL_UNITS || p.N_UNITS || p.total_units || 0);

      var yr = toNum(p.YR_ALLOC || p.yr_alloc || p.YEAR_ALLOC || 0);
      if (yr > 0) {
        yearSum += yr;
        yearCount++;
      }

      // AMI-banded unit counts; fall back to LI_UNITS as proxy when unavailable
      var li = toNum(p.LI_UNITS || p.li_units || 0);
      ami30 += toNum(p.UNITS_30 || p.units_30 || 0);
      ami40 += toNum(p.UNITS_40 || p.units_40 || 0);
      ami50 += toNum(p.UNITS_50 || p.units_50 || li);
      ami60 += toNum(p.UNITS_60 || p.units_60 || 0);
      ami80 += toNum(p.UNITS_80 || p.units_80 || 0);
    }

    return {
      count: featureArr.length,
      totalUnits: totalUnits,
      avgYearAlloc: yearCount > 0 ? Math.round(yearSum / yearCount) : 0,
      unitsByAmi: {
        ami30: ami30,
        ami40: ami40,
        ami50: ami50,
        ami60: ami60,
        ami80: ami80
      }
    };
  }

  /**
   * Returns the density of affordable units per square mile for a set of
   * features within a known buffer area.
   * @param {Array.<Object>} featureArr
   * @param {number} bufferAreaSqMi  Area of the search buffer in square miles.
   * @returns {number} Units per square mile, or 0 if area is zero.
   */
  function getConcentration(featureArr, bufferAreaSqMi) {
    if (!bufferAreaSqMi || bufferAreaSqMi <= 0) { return 0; }
    var stats = getStats(featureArr);
    return parseFloat((stats.totalUnits / bufferAreaSqMi).toFixed(2));
  }

  /**
   * Returns whether LIHTC features have been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  window.HudLihtc = {
    loadFeatures: loadFeatures,
    getFeaturesInBuffer: getFeaturesInBuffer,
    getStats: getStats,
    getConcentration: getConcentration,
    isLoaded: isLoaded
  };

}());
