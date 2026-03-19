/**
 * js/data-connectors/hud-egis.js
 * HUD EGIS ArcGIS FeatureServer connector for QCT and DDA overlays.
 * NOTE: For GitHub Pages, falls back to local derived data files.
 * Exposes window.HudEgis.
 *
 * QCT  — Qualified Census Tract: census tracts where 50 %+ of households earn
 *         below 60 % of Area Median Income, or where the poverty rate is ≥ 25 %.
 *         Source: HUD annually per IRC §42(d)(5)(B)(ii).
 * DDA  — Difficult Development Area: metro areas / non-metro counties with high
 *         construction, land, and utility costs relative to AMI.
 *         Source: HUD annually per IRC §42(d)(5)(B)(iii).
 * Both designations allow a LIHTC project to claim up to 130 % of eligible
 * basis ("basis boost"), increasing annual tax credits by up to 30 %.
 */
(function () {
  'use strict';

  /* ── In-memory GeoJSON cache ──────────────────────────────────────── */

  /**
   * Locally preloaded QCT GeoJSON (set via loadLocalQct or auto-loaded by
   * checkDesignation).  Null means not yet loaded.
   * @type {Object|null}
   */
  var localQctData = null;

  /**
   * Locally preloaded DDA GeoJSON (set via loadLocalDda or auto-loaded by
   * checkDesignation).  Null means not yet loaded.
   * @type {Object|null}
   */
  var localDdaData = null;

  /**
   * In-flight load Promises to avoid duplicate network requests when
   * checkDesignation() is called before the first load completes.
   * @type {Promise|null}
   */
  var _qctLoadPromise = null;
  var _ddaLoadPromise = null;

  /* ── Ray-casting point-in-polygon algorithm ──────────────────────── */

  /**
   * Test whether a point (lat, lon) lies inside a GeoJSON linear ring.
   *
   * Uses the Jordan curve / ray-casting algorithm: cast a horizontal ray
   * eastward from the test point and count how many polygon edges it crosses.
   * An odd count means inside; even means outside.
   *
   * GeoJSON coordinates are [longitude, latitude] pairs (x = lon, y = lat).
   *
   * @param {number}   lat  - Point latitude  (°N).
   * @param {number}   lon  - Point longitude (°E).
   * @param {Array}    ring - Array of [lon, lat] coordinate pairs forming a
   *                          closed linear ring (first === last point).
   * @returns {boolean}
   */
  function _pointInRing(lat, lon, ring) {
    var inside = false;
    var n = ring.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      // ring[i] = [lon, lat]; use lon as x, lat as y
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      // Does the edge (xi,yi)→(xj,yj) cross the horizontal ray from (lon,lat)?
      var intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Test whether a point lies inside a GeoJSON Polygon geometry.
   * Handles the outer ring and any interior hole rings (holes subtract area).
   *
   * @param {number} lat
   * @param {number} lon
   * @param {Array}  coordinates - GeoJSON Polygon coordinates array
   *                               (array of rings, first = exterior).
   * @returns {boolean}
   */
  function _pointInPolygon(lat, lon, coordinates) {
    if (!coordinates || !coordinates.length) return false;
    // Must be inside the outer ring …
    if (!_pointInRing(lat, lon, coordinates[0])) return false;
    // … and outside every hole ring.
    for (var h = 1; h < coordinates.length; h++) {
      if (_pointInRing(lat, lon, coordinates[h])) return false;
    }
    return true;
  }

  /**
   * Test whether a point lies inside any polygon of a GeoJSON feature.
   * Supports Polygon and MultiPolygon geometry types.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {Object} feature - A GeoJSON Feature with Polygon or MultiPolygon geometry.
   * @returns {boolean}
   */
  function _pointInFeature(lat, lon, feature) {
    if (!feature || !feature.geometry) return false;
    var geom = feature.geometry;
    if (geom.type === 'Polygon') {
      return _pointInPolygon(lat, lon, geom.coordinates);
    }
    if (geom.type === 'MultiPolygon') {
      for (var p = 0; p < geom.coordinates.length; p++) {
        if (_pointInPolygon(lat, lon, geom.coordinates[p])) return true;
      }
    }
    return false;
  }

  /**
   * Test whether a point lies inside any feature of a GeoJSON FeatureCollection.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {Object} fc - A GeoJSON FeatureCollection.
   * @returns {boolean}
   */
  function _pointInCollection(lat, lon, fc) {
    if (!fc || !Array.isArray(fc.features)) return false;
    for (var i = 0; i < fc.features.length; i++) {
      if (_pointInFeature(lat, lon, fc.features[i])) return true;
    }
    return false;
  }

  /* ── GeoJSON loaders ──────────────────────────────────────────────── */

  /**
   * Ensure the QCT FeatureCollection is loaded (or loading).
   * Returns a Promise that resolves to the loaded data (or null on failure).
   * Subsequent calls return the same in-flight Promise (caching).
   * @returns {Promise<Object|null>}
   */
  function _ensureQct() {
    if (localQctData) return Promise.resolve(localQctData);
    if (_qctLoadPromise) return _qctLoadPromise;

    var ds = window.DataService;
    if (!ds || typeof ds.getJSON !== 'function') {
      console.warn('[HudEgis] DataService unavailable — QCT check will use safe defaults');
      return Promise.resolve(null);
    }

    _qctLoadPromise = ds.getJSON(ds.baseData('qct-colorado.json'))
      .then(function (data) {
        if (!data || !Array.isArray(data.features)) {
          console.warn('[HudEgis] qct-colorado.json returned unexpected structure');
          _qctLoadPromise = null;
          return null;
        }
        localQctData = data;
        console.log('[HudEgis] QCT data loaded (' + data.features.length + ' features)');
        return data;
      })
      .catch(function (err) {
        console.warn('[HudEgis] Failed to load QCT overlay data — using safe default (in_qct=false). Error:', err && err.message);
        // Clear the promise reference so the next checkDesignation() call can
        // retry the load.  Concurrent callers who already hold this same Promise
        // reference receive the null fallback; only NEW callers after this point
        // will attempt a fresh fetch.
        _qctLoadPromise = null;
        return null;
      });

    return _qctLoadPromise;
  }

  /**
   * Ensure the DDA FeatureCollection is loaded (or loading).
   * Returns a Promise that resolves to the loaded data (or null on failure).
   * @returns {Promise<Object|null>}
   */
  function _ensureDda() {
    if (localDdaData) return Promise.resolve(localDdaData);
    if (_ddaLoadPromise) return _ddaLoadPromise;

    var ds = window.DataService;
    if (!ds || typeof ds.getJSON !== 'function') {
      console.warn('[HudEgis] DataService unavailable — DDA check will use safe defaults');
      return Promise.resolve(null);
    }

    _ddaLoadPromise = ds.getJSON(ds.baseData('dda-colorado.json'))
      .then(function (data) {
        if (!data || !Array.isArray(data.features)) {
          console.warn('[HudEgis] dda-colorado.json returned unexpected structure');
          _ddaLoadPromise = null;
          return null;
        }
        localDdaData = data;
        console.log('[HudEgis] DDA data loaded (' + data.features.length + ' features)');
        return data;
      })
      .catch(function (err) {
        console.warn('[HudEgis] Failed to load DDA overlay data — using safe default (in_dda=false). Error:', err && err.message);
        // Clear the promise reference so the next checkDesignation() call can
        // retry the load.  Concurrent callers who already hold this same Promise
        // reference receive the null fallback; only NEW callers after this point
        // will attempt a fresh fetch.
        _ddaLoadPromise = null;
        return null;
      });

    return _ddaLoadPromise;
  }

  /* ── Public designation check ────────────────────────────────────── */

  /**
   * Check whether a geographic point falls within a QCT or DDA polygon.
   *
   * Loads data/qct-colorado.json and data/dda-colorado.json via DataService
   * on first call; subsequent calls use the in-memory cache.
   *
   * Falls back gracefully to { in_qct: false, in_dda: false,
   * basis_boost_eligible: false } when data is unavailable, logging a clear
   * console warning rather than throwing.
   *
   * @param {number} lat - Site latitude.
   * @param {number} lon - Site longitude.
   * @returns {Promise<{ in_qct: boolean, in_dda: boolean, basis_boost_eligible: boolean }>}
   */
  function checkDesignation(lat, lon) {
    var SAFE_DEFAULT = { in_qct: false, in_dda: false, basis_boost_eligible: false };

    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
      console.warn('[HudEgis] checkDesignation: invalid coordinates (lat=' + lat + ', lon=' + lon + ')');
      return Promise.resolve(SAFE_DEFAULT);
    }

    return Promise.all([_ensureQct(), _ensureDda()])
      .then(function (results) {
        var qctData = results[0];
        var ddaData = results[1];

        var in_qct = qctData ? _pointInCollection(lat, lon, qctData) : false;
        var in_dda = ddaData ? _pointInCollection(lat, lon, ddaData) : false;

        // basis_boost_eligible = true when the site is in a QCT or DDA,
        // qualifying for up to 130% eligible basis under IRC §42(d)(5)(B).
        var basis_boost_eligible = in_qct || in_dda;

        if (!qctData || !ddaData) {
          console.warn('[HudEgis] checkDesignation: one or more overlay files unavailable — ' +
            'returning partial result (qct=' + in_qct + ', dda=' + in_dda + ')');
        }

        return { in_qct: in_qct, in_dda: in_dda, basis_boost_eligible: basis_boost_eligible };
      })
      .catch(function (err) {
        console.warn('[HudEgis] checkDesignation error — using safe defaults. Error:', err && err.message);
        return SAFE_DEFAULT;
      });
  }

  /**
   * Synchronously tests whether a preloaded point falls within a QCT.
   * Returns false (with a log) when QCT data has not been loaded yet.
   * Prefer checkDesignation() for new code — it handles loading automatically.
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  function isQct(lat, lon) {
    if (!localQctData) {
      console.log('[HudEgis] isQct: QCT data not yet loaded; call checkDesignation() for async lookup');
      return false;
    }
    return _pointInCollection(lat, lon, localQctData);
  }

  /**
   * Synchronously tests whether a preloaded point falls within a DDA.
   * Returns false (with a log) when DDA data has not been loaded yet.
   * Prefer checkDesignation() for new code — it handles loading automatically.
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  function isDda(lat, lon) {
    if (!localDdaData) {
      console.log('[HudEgis] isDda: DDA data not yet loaded; call checkDesignation() for async lookup');
      return false;
    }
    return _pointInCollection(lat, lon, localDdaData);
  }

  /**
   * Returns combined QCT/DDA overlay information for a given coordinate.
   * Uses locally cached data; falls back to false when not loaded.
   * @param {number} lat
   * @param {number} lon
   * @returns {{ qct: boolean, dda: boolean, note: string }}
   */
  function getOverlayData(lat, lon) {
    var qct = isQct(lat, lon);
    var dda = isDda(lat, lon);
    return {
      qct:  qct,
      dda:  dda,
      note: (localQctData && localDdaData)
        ? ('QCT=' + qct + ' DDA=' + dda)
        : 'Overlay data not fully loaded — call checkDesignation() for accurate results'
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
    isQct:             isQct,
    isDda:             isDda,
    getOverlayData:    getOverlayData,
    loadLocalQct:      loadLocalQct,
    loadLocalDda:      loadLocalDda,
    checkDesignation:  checkDesignation
  };

}());
