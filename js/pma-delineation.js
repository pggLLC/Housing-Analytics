/**
 * js/pma-delineation.js
 * PMA and SMA boundary visualization on the Leaflet map.
 *
 * Renders the delineated Primary Market Area polygon (derived from the convex
 * hull of census tract centroids inside the buffer) and the Secondary Market
 * Area ring (~25 miles) on top of the existing market-analysis.js Leaflet map.
 *
 * Uses industry-standard NH&RA / Novogradac terminology:
 *   PMA — Primary Market Area  (commuting + barrier + school-adjusted polygon)
 *   SMA — Secondary Market Area (~25 mile ring, wider competitive context)
 *
 * Public API (window.PMADelineation):
 *   renderPmaLayer(map, lat, lon, bufferMiles, tractCentroids)
 *   renderSmaLayer(map, lat, lon, show)
 *   renderCommutingBoundary(map, boundaryGeoJSON)
 *   removeAllBoundaries(map)
 *   getLastPmaPolygon() → GeoJSON Feature or null
 *
 * All functions are null-safe and degrade silently when Leaflet (window.L)
 * is not yet available.
 *
 * Depends on: window.L (Leaflet), window.PMAEngine (for tract centroid list)
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var SMA_MILES            = 25;
  var METERS_PER_MILE      = 1609.34;
  var PMA_COLOR            = '#096e65';   // site-theme --accent
  var PMA_BORDER_COLOR     = '#096e65';
  var SMA_COLOR            = '#64748b';   // slate / muted
  var COMMUTING_COLOR      = '#1d4ed8';   // blue (LODES data)
  var MIN_CONVEX_HULL_PTS  = 3;

  /* ── Layer state ──────────────────────────────────────────────────── */
  var _pmaPolygonLayer  = null;   // convex-hull polygon of buffer tracts
  var _pmaRingLayer     = null;   // dashed buffer ring (always shown)
  var _smaLayer         = null;   // Secondary Market Area ring
  var _commutingLayer   = null;   // commuting-based boundary polygon
  var _lastPmaPolygon   = null;   // GeoJSON Feature for export

  /* ── Convex hull (Andrew's monotone chain) ────────────────────────── */

  function _cross(O, A, B) {
    return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  }

  /**
   * Compute convex hull of 2-D points using Andrew's monotone chain.
   * @param {Array<[number,number]>} points  — [lon, lat] pairs
   * @returns {Array<[number,number]>} — hull vertices (counter-clockwise, closed)
   */
  function _convexHull(points) {
    var pts = points.slice().sort(function (a, b) {
      return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
    });
    var n = pts.length;
    if (n < MIN_CONVEX_HULL_PTS) return pts.concat([pts[0]]);

    var lower = [];
    for (var i = 0; i < n; i++) {
      while (lower.length >= 2 && _cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
        lower.pop();
      }
      lower.push(pts[i]);
    }
    var upper = [];
    for (var j = n - 1; j >= 0; j--) {
      while (upper.length >= 2 && _cross(upper[upper.length - 2], upper[upper.length - 1], pts[j]) <= 0) {
        upper.pop();
      }
      upper.push(pts[j]);
    }
    lower.pop();
    upper.pop();
    var hull = lower.concat(upper);
    hull.push(hull[0]);  // close the ring
    return hull;
  }

  /* ── Haversine distance (miles) ───────────────────────────────────── */

  function _toRad(deg) { return deg * Math.PI / 180; }

  function _haversine(lat1, lon1, lat2, lon2) {
    var R  = 3958.8;
    var dL = _toRad(lat2 - lat1);
    var dO = _toRad(lon2 - lon1);
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Generate PMA polygon GeoJSON ────────────────────────────────── */

  /**
   * Build a convex-hull GeoJSON polygon from a list of tract centroid objects.
   * @param {{lat:number, lon:number}[]} tracts
   * @returns {object|null} GeoJSON Polygon geometry or null
   */
  function generatePmaPolygon(tracts) {
    if (!tracts || tracts.length < MIN_CONVEX_HULL_PTS) return null;
    var pts = tracts
      .filter(function (t) { return typeof t.lat === 'number' && typeof t.lon === 'number'; })
      .map(function (t) { return [t.lon, t.lat]; });
    if (pts.length < MIN_CONVEX_HULL_PTS) return null;

    var hull = _convexHull(pts);
    return {
      type: 'Feature',
      properties: { label: 'PMA Boundary', type: 'pma' },
      geometry: {
        type: 'Polygon',
        coordinates: [hull]
      }
    };
  }

  /**
   * Filter a full tract centroid list to those within `miles` of (lat, lon).
   * Falls back to PMAEngine.haversine when available.
   * @param {object[]} tractList — items with lat, lon properties
   * @param {number} lat
   * @param {number} lon
   * @param {number} miles
   * @returns {object[]}
   */
  function _tractsInRadius(tractList, lat, lon, miles) {
    var hav = (window.PMAEngine && window.PMAEngine.haversine) ? window.PMAEngine.haversine : _haversine;
    return tractList.filter(function (t) {
      return typeof t.lat === 'number' && typeof t.lon === 'number' &&
             hav(lat, lon, t.lat, t.lon) <= miles;
    });
  }

  /* ── Layer management helpers ─────────────────────────────────────── */

  function _removeLayer(map, layerRef) {
    if (layerRef && map) {
      try { map.removeLayer(layerRef); } catch (e) {}
    }
    return null;
  }

  function removeAllBoundaries(map) {
    _pmaPolygonLayer = _removeLayer(map, _pmaPolygonLayer);
    _pmaRingLayer    = _removeLayer(map, _pmaRingLayer);
    _smaLayer        = _removeLayer(map, _smaLayer);
    _commutingLayer  = _removeLayer(map, _commutingLayer);
    _lastPmaPolygon  = null;
  }

  /* ── Public render functions ──────────────────────────────────────── */

  /**
   * Render the PMA polygon and dashed buffer ring on the map.
   * The polygon is derived from the convex hull of tract centroids inside
   * `bufferMiles`; if fewer than 3 centroids are available, only the ring
   * is shown.
   *
   * @param {L.Map}   map
   * @param {number}  lat
   * @param {number}  lon
   * @param {number}  bufferMiles
   * @param {object[]} [tractCentroidsOverride] — optional pre-filtered list;
   *                    if omitted, reads from PMAEngine._state or data cache.
   */
  function renderPmaLayer(map, lat, lon, bufferMiles, tractCentroidsOverride) {
    var L = window.L;
    if (!L || !map || typeof lat !== 'number' || typeof lon !== 'number') return;

    // Clean up previous layers
    _pmaPolygonLayer = _removeLayer(map, _pmaPolygonLayer);
    _pmaRingLayer    = _removeLayer(map, _pmaRingLayer);
    _lastPmaPolygon  = null;

    var bMiles = typeof bufferMiles === 'number' ? bufferMiles : 5;

    // 1. Always draw the dashed ring at the exact buffer radius
    _pmaRingLayer = L.circle([lat, lon], {
      radius:      bMiles * METERS_PER_MILE,
      color:       PMA_BORDER_COLOR,
      weight:      1.5,
      fillOpacity: 0,
      dashArray:   '6 5',
      interactive: false
    }).addTo(map).bindTooltip('PMA buffer (' + bMiles + ' mi)', { sticky: true });

    // 2. Build tract list — use override, or fetch from PMAEngine/PMADataCache
    var tractList = null;
    if (Array.isArray(tractCentroidsOverride) && tractCentroidsOverride.length > 0) {
      tractList = tractCentroidsOverride;
    } else if (window.PMADataCache && window.PMADataCache.has('tractCentroids')) {
      var cached = window.PMADataCache.get('tractCentroids');
      tractList  = (cached && cached.tracts) ? cached.tracts : (Array.isArray(cached) ? cached : null);
    }

    if (!tractList || tractList.length === 0) return;

    // 3. Filter to buffer and build convex hull polygon
    var inBuffer = _tractsInRadius(tractList, lat, lon, bMiles);
    if (inBuffer.length < MIN_CONVEX_HULL_PTS) return;

    var feature = generatePmaPolygon(inBuffer);
    if (!feature) return;

    _lastPmaPolygon = feature;

    _pmaPolygonLayer = L.geoJSON(feature, {
      style: {
        color:       PMA_BORDER_COLOR,
        weight:      2,
        dashArray:   '7 4',
        fillColor:   PMA_COLOR,
        fillOpacity: 0.07
      },
      interactive: true
    }).addTo(map)
      .bindTooltip(
        '<strong>Primary Market Area (PMA)</strong><br>' +
        inBuffer.length + ' census tracts · ' + bMiles + ' mi buffer',
        { sticky: true }
      );

    console.log('[PMADelineation] PMA polygon rendered: ' + inBuffer.length +
      ' tracts, hull points=' + (feature.geometry.coordinates[0].length - 1));
  }

  /**
   * Show or hide the 25-mile Secondary Market Area ring.
   * @param {L.Map}   map
   * @param {number}  lat
   * @param {number}  lon
   * @param {boolean} show
   */
  function renderSmaLayer(map, lat, lon, show) {
    var L = window.L;
    _smaLayer = _removeLayer(map, _smaLayer);
    if (!show || !L || !map || typeof lat !== 'number' || typeof lon !== 'number') return;

    _smaLayer = L.circle([lat, lon], {
      radius:      SMA_MILES * METERS_PER_MILE,
      color:       SMA_COLOR,
      weight:      1.5,
      fillColor:   SMA_COLOR,
      fillOpacity: 0.02,
      dashArray:   '10 6',
      interactive: true
    }).addTo(map)
      .bindTooltip(
        '<strong>Secondary Market Area (SMA)</strong><br>' +
        SMA_MILES + '-mile competitive context boundary',
        { sticky: true }
      );

    console.log('[PMADelineation] SMA ring rendered at ' + SMA_MILES + ' miles');
  }

  /**
   * Render a commuting-flow-based PMA boundary polygon.
   * `boundary` should be a GeoJSON Polygon or MultiPolygon Feature/FeatureCollection
   * generated by PMACommuting.generateCommutingBoundary().
   *
   * @param {L.Map}   map
   * @param {object}  boundary — GeoJSON
   */
  function renderCommutingBoundary(map, boundary) {
    var L = window.L;
    _commutingLayer = _removeLayer(map, _commutingLayer);
    if (!L || !map || !boundary) return;

    _commutingLayer = L.geoJSON(boundary, {
      style: {
        color:       COMMUTING_COLOR,
        weight:      2,
        dashArray:   '4 3',
        fillColor:   COMMUTING_COLOR,
        fillOpacity: 0.06
      },
      interactive: true
    }).addTo(map)
      .bindTooltip(
        '<strong>Commuting-based PMA</strong><br>LODES/LEHD flow-derived boundary',
        { sticky: true }
      );

    console.log('[PMADelineation] Commuting boundary rendered');
  }

  /**
   * Return the last computed PMA polygon as a GeoJSON Feature, or null.
   * Useful for export.
   */
  function getLastPmaPolygon() {
    return _lastPmaPolygon;
  }

  /* ── Auto-wire SMA / parcel-zoning checkboxes on DOMContentLoaded ── */
  // This wiring lives here so pma-ui-controller.js stays decoupled.

  function _getSiteCoords() {
    var eng = window.PMAEngine;
    if (eng && typeof eng._lastLat === 'number' && typeof eng._lastLon === 'number') {
      return { lat: eng._lastLat, lon: eng._lastLon };
    }
    // Fallback: parse the pmaSiteCoords element
    var el = document.getElementById('pmaSiteCoords');
    if (el) {
      var m = (el.textContent || '').match(/([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
    }
    return null;
  }

  function _initCheckboxListeners() {
    var smaCheck = document.getElementById('pmaSmaToggle');
    if (smaCheck) {
      smaCheck.addEventListener('change', function () {
        var map  = window.PMAEngine && window.PMAEngine._map();
        var site = _getSiteCoords();
        if (!map || !site) return;
        renderSmaLayer(map, site.lat, site.lon, smaCheck.checked);
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _initCheckboxListeners);
    } else {
      _initCheckboxListeners();
    }
  }

  /* ── Expose ───────────────────────────────────────────────────────── */
  window.PMADelineation = {
    renderPmaLayer:         renderPmaLayer,
    renderSmaLayer:         renderSmaLayer,
    renderCommutingBoundary: renderCommutingBoundary,
    removeAllBoundaries:    removeAllBoundaries,
    generatePmaPolygon:     generatePmaPolygon,
    getLastPmaPolygon:      getLastPmaPolygon
  };

}());
