/**
 * js/data-connectors/hud-egis.js
 * HUD EGIS ArcGIS FeatureServer connector for QCT and DDA overlays.
 * NOTE: For GitHub Pages, falls back to local derived data files.
 * Exposes window.HudEgis.
 */
(function () {
  'use strict';

  /**
   * Locally preloaded QCT GeoJSON (set via loadLocalQct).
   * @type {Object|null}
   */
  var localQctData = null;

  /**
   * Locally preloaded DDA GeoJSON (set via loadLocalDda).
   * @type {Object|null}
   */
  var localDdaData = null;

  /**
   * Placeholder: determines whether a given coordinate falls within a QCT.
   * In static/GitHub Pages mode this always returns false.
   * When local QCT data has been loaded via loadLocalQct(), a GeoJSON
   * point-in-polygon check would be performed; that logic requires a
   * geometry library and is left for future enhancement.
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  function isQct(lat, lon) {
    if (!localQctData) {
      console.log('[HudEgis] QCT lookup not available in static mode');
      return false;
    }
    // Future: perform point-in-polygon against localQctData.features
    console.log('[HudEgis] QCT lookup not available in static mode');
    return false;
  }

  /**
   * Placeholder: determines whether a given coordinate falls within a DDA.
   * In static/GitHub Pages mode this always returns false.
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  function isDda(lat, lon) {
    if (!localDdaData) {
      console.log('[HudEgis] QCT lookup not available in static mode');
      return false;
    }
    // Future: perform point-in-polygon against localDdaData.features
    console.log('[HudEgis] QCT lookup not available in static mode');
    return false;
  }

  /**
   * Returns combined QCT/DDA overlay information for a given coordinate.
   * In static mode, both flags are always false.
   * @param {number} lat
   * @param {number} lon
   * @returns {{ qct: boolean, dda: boolean, note: string }}
   */
  function getOverlayData(lat, lon) {
    return {
      qct: isQct(lat, lon),
      dda: isDda(lat, lon),
      note: 'Static mode — overlay data unavailable'
    };
  }

  /**
   * Accepts preloaded QCT GeoJSON and stores it for future point-in-polygon
   * lookups.
   * @param {Object} data - A GeoJSON FeatureCollection of QCT polygons.
   */
  function loadLocalQct(data) {
    if (!data || typeof data !== 'object') {
      console.warn('[HudEgis] loadLocalQct: invalid data provided');
      return;
    }
    localQctData = data;
    console.log('[HudEgis] Local QCT data loaded (' +
      ((data.features && data.features.length) || 0) + ' features)');
  }

  /**
   * Accepts preloaded DDA GeoJSON and stores it for future point-in-polygon
   * lookups.
   * @param {Object} data - A GeoJSON FeatureCollection of DDA polygons.
   */
  function loadLocalDda(data) {
    if (!data || typeof data !== 'object') {
      console.warn('[HudEgis] loadLocalDda: invalid data provided');
      return;
    }
    localDdaData = data;
    console.log('[HudEgis] Local DDA data loaded (' +
      ((data.features && data.features.length) || 0) + ' features)');
  }

  window.HudEgis = {
    isQct: isQct,
    isDda: isDda,
    getOverlayData: getOverlayData,
    loadLocalQct: loadLocalQct,
    loadLocalDda: loadLocalDda
  };

}());
