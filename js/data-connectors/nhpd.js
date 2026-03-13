/**
 * js/data-connectors/nhpd.js
 * NHPD subsidized housing inventory connector.
 * Falls back gracefully when live data unavailable.
 * Exposes window.Nhpd.
 */
(function () {
  'use strict';

  /** @const {number} Earth radius in miles for haversine calculations */
  var EARTH_RADIUS_MI = 3958.8;

  /**
   * Stored NHPD features array.
   * @type {Array.<Object>}
   */
  var inventory = [];

  /**
   * Whether inventory data has been loaded.
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
   * Stores a preloaded NHPD features array.
   * Each item is expected to have at minimum: lat, lon, total_units,
   * subsidy_type, subsidy_expiration (ISO date string or year number).
   * @param {Array.<Object>} data
   */
  function loadInventory(data) {
    if (!Array.isArray(data)) {
      console.warn('[Nhpd] loadInventory: expected an array, got ' + typeof data);
      return;
    }

    inventory = data;
    loaded = inventory.length > 0;
    console.log('[Nhpd] Loaded ' + inventory.length + ' NHPD inventory records');
  }

  /**
   * Returns all inventory items within the specified radius of a point.
   * Each item must have numeric `lat` and `lon` properties.
   * @param {number} lat  Center latitude.
   * @param {number} lon  Center longitude.
   * @param {number} miles  Search radius in miles.
   * @returns {Array.<Object>} Matching inventory items.
   */
  function getInventoryInBuffer(lat, lon, miles) {
    if (!loaded || typeof lat !== 'number' || typeof lon !== 'number' || typeof miles !== 'number') {
      return [];
    }

    var results = [];
    for (var i = 0; i < inventory.length; i++) {
      var item = inventory[i];
      if (!item) { continue; }

      var iLat = toNum(item.lat || item.LATITUDE  || item.latitude);
      var iLon = toNum(item.lon || item.LONGITUDE || item.longitude);
      if (!iLat && !iLon) { continue; }

      if (haversine(lat, lon, iLat, iLon) <= miles) {
        results.push(item);
      }
    }
    return results;
  }

  /**
   * Computes summary statistics for an array of NHPD inventory items.
   * @param {Array.<Object>} items
   * @returns {{
   *   count: number,
   *   subsidyTypes: Object.<string, number>,
   *   totalUnits: number,
   *   expiringCount: number
   * }}
   */
  function getStats(items) {
    var empty = { count: 0, subsidyTypes: {}, totalUnits: 0, expiringCount: 0 };
    if (!Array.isArray(items) || items.length === 0) {
      return empty;
    }

    var totalUnits = 0;
    var subsidyTypes = {};
    var expiringCount = 0;

    // Cutoff: 3 years from today
    var cutoffYear = new Date().getFullYear() + 3;
    var cutoffMs   = new Date(cutoffYear, 11, 31).getTime();

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item) { continue; }

      totalUnits += toNum(item.total_units || item.TOTAL_UNITS || 0);

      var sType = item.subsidy_type || item.SUBSIDY_TYPE || 'unknown';
      subsidyTypes[sType] = (subsidyTypes[sType] || 0) + 1;

      var expRaw = item.subsidy_expiration || item.SUBSIDY_EXPIRATION;
      if (expRaw) {
        var expMs;
        if (typeof expRaw === 'number') {
          // Treat a 4-digit year as Dec 31 of that year
          expMs = expRaw > 1900 ? new Date(expRaw, 11, 31).getTime() : expRaw;
        } else {
          expMs = new Date(String(expRaw)).getTime();
        }
        if (isFinite(expMs) && expMs <= cutoffMs) {
          expiringCount++;
        }
      }
    }

    return {
      count: items.length,
      subsidyTypes: subsidyTypes,
      totalUnits: totalUnits,
      expiringCount: expiringCount
    };
  }

  /**
   * Convenience alias used by DataService.fetchHudNhpd.
   * Identical to getInventoryInBuffer.
   * @param {number} lat  Center latitude.
   * @param {number} lon  Center longitude.
   * @param {number} miles  Search radius in miles.
   * @returns {Array.<Object>}
   */
  function getPropertiesNear(lat, lon, miles) {
    return getInventoryInBuffer(lat, lon, miles);
  }

  /**
   * Loads inventory from a GeoJSON FeatureCollection.
   * Flattens each Feature's properties and injects lat/lon from the geometry.
   * @param {Object} geojson  GeoJSON FeatureCollection object.
   */
  function loadFromGeoJSON(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) {
      console.warn('[Nhpd] loadFromGeoJSON: expected a GeoJSON FeatureCollection');
      return;
    }

    var records = [];
    for (var i = 0; i < geojson.features.length; i++) {
      var feat = geojson.features[i];
      if (!feat || feat.type !== 'Feature') { continue; }

      var props = feat.properties || {};
      var record = {};
      var key;
      for (key in props) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
          record[key] = props[key];
        }
      }

      // Inject lat/lon from geometry when not already present in properties
      if (feat.geometry && feat.geometry.type === 'Point' && Array.isArray(feat.geometry.coordinates)) {
        if (!record.lon && !record.longitude) { record.lon = feat.geometry.coordinates[0]; }
        if (!record.lat && !record.latitude)  { record.lat = feat.geometry.coordinates[1]; }
      }

      records.push(record);
    }

    loadInventory(records);
  }

  /**
   * Returns whether inventory data has been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  window.Nhpd = {
    loadInventory: loadInventory,
    loadFromGeoJSON: loadFromGeoJSON,
    getInventoryInBuffer: getInventoryInBuffer,
    getPropertiesNear: getPropertiesNear,
    getStats: getStats,
    isLoaded: isLoaded
  };

}());
