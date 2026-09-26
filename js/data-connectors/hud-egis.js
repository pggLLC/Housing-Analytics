/**
 * js/data-connectors/hud-egis.js
 * HUD EGIS ArcGIS FeatureServer connector for QCT and DDA overlays.
 * NOTE: For GitHub Pages, falls back to local GeoJSON files loaded via DataService.
 * Exposes window.HudEgis.
 *
 * QCT (Qualified Census Tract): A census tract where 50%+ of households have
 * incomes below 60% of AMI, or the poverty rate is 25%+. Defined under
 * IRC §42(d)(5)(B)(ii)(I). HUD designates new QCTs annually.
 *
 * DDA (Difficult Development Area): A metropolitan area or non-metropolitan
 * county designated by HUD where housing construction, land, and utility costs
 * are high relative to AMI. Defined under IRC §42(d)(5)(B)(iii).
 *
 * Both QCT and DDA designations allow a LIHTC project to qualify for an
 * "eligible basis boost" — up to 130% of eligible basis — which directly
 * increases the annual credit amount awarded under IRC §42(d)(5)(B).
 */
(function () {
  'use strict';

  /**
   * Locally preloaded QCT GeoJSON (set via loadLocalQct or auto-loaded from DataService).
   * @type {Object|null}
   */
  var localQctData = null;

  /**
   * Locally preloaded DDA GeoJSON (set via loadLocalDda or auto-loaded from DataService).
   * @type {Object|null}
   */
  var localDdaData = null;

  /**
   * Tracks whether auto-loading of QCT/DDA data from DataService has been attempted.
   * Prevents repeated fetch attempts on every checkDesignation() call.
   */
  var _loadAttempted = false;

  /* ── Point-in-polygon algorithm ─────────────────────────────────── */

  /**
   * Ray-casting point-in-polygon test for a single GeoJSON ring.
   *
   * How it works: a ray is cast from the test point in the +X (eastward)
   * direction. Each time the ray crosses an edge of the polygon ring, a
   * counter is toggled. An odd count at the end means the point is inside.
   *
   * NOTE on coordinate order: the function accepts (lat, lon) in geographic
   * convention (latitude first), but GeoJSON rings store coordinates as
   * [longitude, latitude]. Inside the loop, ring[i][0] is longitude (x-axis)
   * and ring[i][1] is latitude (y-axis). The algorithm compares lon against
   * the x-coordinate of each edge crossing, which is correct.
   *
   * @param {number} lat  - Point latitude.
   * @param {number} lon  - Point longitude.
   * @param {Array}  ring - GeoJSON ring: array of [lon, lat] pairs.
   * @returns {boolean}   True if the point is inside the ring.
   */
  function _pointInRing(lat, lon, ring) {
    var inside = false;
    var n = ring.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = ring[i][0], yi = ring[i][1]; // [lon, lat]
      var xj = ring[j][0], yj = ring[j][1];
      // Check if the horizontal ray from (lon, lat) crosses this edge
      var intersect = ((yi > lat) !== (yj > lat)) &&
                      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Test whether a point falls within a GeoJSON Feature (Polygon or MultiPolygon).
   * For polygons with holes, a point inside an interior ring (hole) is outside.
   *
   * @param {number} lat     - Point latitude.
   * @param {number} lon     - Point longitude.
   * @param {Object} feature - GeoJSON Feature object.
   * @returns {boolean}      True if the point is inside the feature geometry.
   */
  function _pointInFeature(lat, lon, feature) {
    if (!feature || !feature.geometry) return false;
    var geom = feature.geometry;
    var coords = geom.coordinates;

    if (geom.type === 'Polygon') {
      // coords[0] = exterior ring, coords[1..] = interior rings (holes)
      if (!_pointInRing(lat, lon, coords[0])) return false;
      for (var h = 1; h < coords.length; h++) {
        if (_pointInRing(lat, lon, coords[h])) return false; // inside a hole
      }
      return true;
    }

    if (geom.type === 'MultiPolygon') {
      // Each element of coords is a polygon (array of rings)
      for (var p = 0; p < coords.length; p++) {
        var rings = coords[p];
        if (!_pointInRing(lat, lon, rings[0])) continue;
        var inHole = false;
        for (var h2 = 1; h2 < rings.length; h2++) {
          if (_pointInRing(lat, lon, rings[h2])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
    }

    return false;
  }

  /**
   * Test whether any feature in a GeoJSON FeatureCollection contains the point.
   *
   * @param {number} lat - Point latitude.
   * @param {number} lon - Point longitude.
   * @param {Object} fc  - GeoJSON FeatureCollection.
   * @returns {boolean}  True if the point is inside any feature.
   */
  function _isInCollection(lat, lon, fc) {
    if (!fc || !Array.isArray(fc.features)) return false;
    for (var i = 0; i < fc.features.length; i++) {
      if (_pointInFeature(lat, lon, fc.features[i])) return true;
    }
    return false;
  }

  /* ── Data loading ─────────────────────────────────────────────────── */

  /**
   * Attempt to load QCT and DDA GeoJSON from DataService and cache in memory.
   * Called once at module init (deferred to allow DataService to initialise).
   * Logs a clear warning if DataService is unavailable or the fetch fails —
   * never silently returns false without a diagnostic message.
   */
  function _autoLoad() {
    if (_loadAttempted) return;
    _loadAttempted = true;

    var DS = window.DataService;
    if (!DS || typeof DS.getJSON !== 'function') {
      console.warn('[HudEgis] DataService not available — QCT/DDA designation checks will use safe defaults.');
      return;
    }

    // Load QCT data (data/qct-colorado.json — 224 Colorado QCT polygons)
    if (!localQctData) {
      DS.getJSON(DS.baseData('qct-colorado.json'))
        .then(function (data) {
          if (data && Array.isArray(data.features) && data.features.length) {
            localQctData = data;
            console.log('[HudEgis] QCT data loaded (' + data.features.length + ' features)');
          } else {
            console.warn('[HudEgis] qct-colorado.json loaded but contains no features — QCT checks will return false.');
          }
        })
        .catch(function (err) {
          console.warn('[HudEgis] Failed to load qct-colorado.json — QCT checks will use false.', err);
        });
    }

    // Load DDA data (data/dda-colorado.json — Colorado DDA polygons)
    if (!localDdaData) {
      DS.getJSON(DS.baseData('dda-colorado.json'))
        .then(function (data) {
          if (data && Array.isArray(data.features) && data.features.length) {
            localDdaData = data;
            console.log('[HudEgis] DDA data loaded (' + data.features.length + ' features)');
          } else {
            console.warn('[HudEgis] dda-colorado.json loaded but contains no features — DDA checks will return false.');
          }
        })
        .catch(function (err) {
          console.warn('[HudEgis] Failed to load dda-colorado.json — DDA checks will use false.', err);
        });
    }
  }

  /* ── Public API ───────────────────────────────────────────────────── */

  /**
   * Determines whether a given coordinate falls within a QCT polygon.
   * Uses the ray-casting point-in-polygon algorithm against localQctData.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  function isQct(lat, lon) {
    if (!localQctData) {
      console.warn('[HudEgis] isQct(): QCT data not yet loaded — returning false (data loads async at page init).');
      return false;
    }
    return _isInCollection(lat, lon, localQctData);
  }

  /**
   * Determines whether a given coordinate falls within a DDA polygon.
   * Uses the ray-casting point-in-polygon algorithm against localDdaData.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  function isDda(lat, lon) {
    if (!localDdaData) {
      console.warn('[HudEgis] isDda(): DDA data not yet loaded — returning false (data loads async at page init).');
      return false;
    }
    return _isInCollection(lat, lon, localDdaData);
  }

  /**
   * Returns combined QCT/DDA overlay information for a given coordinate.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {{ qct: boolean, dda: boolean, note: string }}
   */
  function getOverlayData(lat, lon) {
    var qct = isQct(lat, lon);
    var dda = isDda(lat, lon);
    return {
      qct: qct,
      dda: dda,
      note: (localQctData || localDdaData)
        ? 'Live designation data from local GeoJSON'
        : 'Overlay data not yet loaded — using safe defaults'
    };
  }

  /**
   * Why a designation layer cannot answer, or null when it can. A layer that
   * never loaded, or loaded with no features at all, cannot show that a site
   * is outside every QCT/DDA — a globally empty source proves nothing.
   * @private
   */
  function _layerUnavailableReason(fc, label, file) {
    if (!fc || !Array.isArray(fc.features)) {
      return label + ' data not loaded (' + file + ')';
    }
    if (fc.features.length === 0) {
      return file + ' loaded but contains no ' + label + ' features';
    }
    return null;
  }

  /**
   * Check whether a lat/lon point falls within a QCT or DDA polygon and
   * return the combined designation result used by the scoring pipeline.
   *
   * Each flag is true, false, or null. null means UNKNOWN: that layer has not
   * loaded, or loaded with no features, so it cannot show the site is outside
   * a QCT/DDA. It is never reported as false — "not in a QCT" drops the 30%
   * basis boost and subsidy points, and an unknown must not do that.
   * `unavailableReason` says why whenever any flag is null.
   *
   * basis_boost_eligible is true whenever the site is in a QCT or DDA
   * (allowing up to 130% eligible basis under IRC §42(d)(5)(B)), false only
   * when BOTH layers are known and the site is in neither, and null otherwise.
   *
   * @param {number} lat - Site latitude.
   * @param {number} lon - Site longitude.
   * @returns {{ in_qct: boolean|null, in_dda: boolean|null,
   *             basis_boost_eligible: boolean|null, unavailableReason: string|null }}
   */
  function checkDesignation(lat, lon) {
    var qctReason = _layerUnavailableReason(localQctData, 'QCT', 'data/qct-colorado.json');
    var ddaReason = _layerUnavailableReason(localDdaData, 'DDA', 'data/dda-colorado.json');
    var in_qct = qctReason ? null : _isInCollection(lat, lon, localQctData);
    var in_dda = ddaReason ? null : _isInCollection(lat, lon, localDdaData);
    var reasons = [qctReason, ddaReason].filter(Boolean);
    if (reasons.length) {
      console.warn('[HudEgis] checkDesignation(): designation unknown — ' + reasons.join('; ') + '.');
    }
    var basis_boost_eligible;
    if (in_qct === true || in_dda === true) basis_boost_eligible = true;
    else if (in_qct === false && in_dda === false) basis_boost_eligible = false;
    else basis_boost_eligible = null;
    return {
      in_qct: in_qct,
      in_dda: in_dda,
      basis_boost_eligible: basis_boost_eligible,
      unavailableReason: reasons.length ? reasons.join('; ') : null
    };
  }

  /**
   * Accepts preloaded QCT GeoJSON and stores it for future point-in-polygon
   * lookups. Replaces any previously auto-loaded data.
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
   * lookups. Replaces any previously auto-loaded data.
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

  // Pre-load QCT/DDA GeoJSON as soon as the module is evaluated.
  // DataService may not be defined yet if this script loads before
  // data-service-portable.js, so defer the attempt to the next tick.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoLoad);
  } else {
    setTimeout(_autoLoad, 0);
  }

  window.HudEgis = {
    isQct: isQct,
    isDda: isDda,
    getOverlayData: getOverlayData,
    checkDesignation: checkDesignation,
    loadLocalQct: loadLocalQct,
    loadLocalDda: loadLocalDda
  };

}());
