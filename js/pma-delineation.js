/**
 * js/pma-delineation.js
 * PMA and SMA boundary visualization on the Leaflet map.
 *
 * Renders the delineated Primary Market Area as the actual included tract
 * polygons and the Secondary Market Area ring (~25 miles) on top of the
 * existing market-analysis.js Leaflet map.
 *
 * Uses industry-standard NH&RA / Novogradac terminology:
 *   PMA — Primary Market Area  (commuting + barrier + school-adjusted polygon)
 *   SMA — Secondary Market Area (~25 mile ring, wider competitive context)
 *
 * Public API (window.PMADelineation):
 *   renderPmaLayer(map, lat, lon, bufferMiles, includedTracts)
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
  var PMA_TRACT_GEOMETRY_URL = 'data/market/pma_tract_display_geometry.geojson';

  /* ── Layer state ──────────────────────────────────────────────────── */
  var _pmaPolygonLayer  = null;   // included-tract polygon fills
  var _pmaRingLayer     = null;   // dashed buffer ring (always shown)
  var _smaLayer         = null;   // Secondary Market Area ring
  var _commutingLayer   = null;   // commuting-based boundary polygon
  var _lastPmaPolygon   = null;   // GeoJSON FeatureCollection for export
  var _tractGeometryPromise = null;
  var _tractGeometryCache   = null;

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

  function _fetchJSON(url) {
    var fetcher = window.fetchWithBase || window.fetch;
    if (typeof fetcher !== 'function') return Promise.reject(new Error('fetch unavailable'));
    return fetcher.call(window, url).then(function (res) {
      if (!res || !res.ok) throw new Error('fetch failed: ' + url);
      return res.json();
    });
  }

  function _featureGeoid(feature) {
    var p = feature && feature.properties;
    return p && (p.GEOID || p.geoid || p.GEOID20 || p.tract_geoid);
  }

  function _tractGeoid(tract) {
    return tract && (tract.geoid || tract.GEOID || tract.GEOID20 || tract.tract_geoid);
  }

  function _tractShare(tract) {
    var raw = tract && (tract._bufferShare != null ? tract._bufferShare : tract.share);
    var n = Number(raw);
    if (!isFinite(n)) return 1;
    return Math.max(0.08, Math.min(1, n));
  }

  function _loadTractGeometry() {
    if (_tractGeometryCache) return Promise.resolve(_tractGeometryCache);
    if (_tractGeometryPromise) return _tractGeometryPromise;
    _tractGeometryPromise = _fetchJSON(PMA_TRACT_GEOMETRY_URL).then(function (gj) {
      var index = {};
      (gj && gj.features || []).forEach(function (feature) {
        var geoid = _featureGeoid(feature);
        if (geoid) index[String(geoid)] = feature;
      });
      _tractGeometryCache = { geojson: gj, index: index };
      return _tractGeometryCache;
    });
    return _tractGeometryPromise;
  }

  function _featureCollectionForTracts(tracts, geometryIndex) {
    var features = [];
    (tracts || []).forEach(function (tract) {
      var geoid = _tractGeoid(tract);
      var source = geoid ? geometryIndex[String(geoid)] : null;
      if (!source) return;
      var copy = {
        type: 'Feature',
        properties: Object.assign({}, source.properties || {}, {
          GEOID: String(geoid),
          pma_weight: _tractShare(tract)
        }),
        geometry: source.geometry
      };
      features.push(copy);
    });
    return {
      type: 'FeatureCollection',
      properties: { label: 'PMA Included Tracts', type: 'pma-tract-display' },
      features: features
    };
  }

  function _renderIncludedTracts(map, tracts, bMiles) {
    if (!tracts || !tracts.length) return Promise.resolve(null);
    var L = window.L;
    return _loadTractGeometry().then(function (geometry) {
      var featureCollection = _featureCollectionForTracts(tracts, geometry.index);
      if (!featureCollection.features.length) return null;

      _lastPmaPolygon = featureCollection;
      _pmaPolygonLayer = L.geoJSON(featureCollection, {
        style: function (feature) {
          var weight = feature && feature.properties ? Number(feature.properties.pma_weight) : 1;
          if (!isFinite(weight)) weight = 1;
          return {
            color:       PMA_BORDER_COLOR,
            weight:      0,
            opacity:     0,
            fillColor:   PMA_COLOR,
            fillOpacity: Math.max(0.06, Math.min(0.28, 0.06 + weight * 0.18))
          };
        },
        interactive: true
      }).addTo(map)
        .bindTooltip(
          '<strong>Primary Market Area (PMA)</strong><br>' +
          featureCollection.features.length + ' included census tracts · ' + bMiles + ' mi buffer',
          { sticky: true }
        );

      console.log('[PMADelineation] PMA tract display rendered: ' +
        featureCollection.features.length + ' included tracts');
      return featureCollection;
    }).catch(function (err) {
      console.warn('[PMADelineation] PMA tract display skipped:', err && err.message ? err.message : err);
      return null;
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
   * Render the PMA included-tract fills and dashed buffer ring on the map.
   * The tract display uses the same tract set the PMA engine aggregated; if
   * that set is unavailable, it falls back to the engine's current buffer
   * filter. PMA scores are unchanged by this display-only layer.
   *
   * @param {L.Map}   map
   * @param {number}  lat
   * @param {number}  lon
   * @param {number}  bufferMiles
   * @param {object[]} [includedTractsOverride] — optional pre-filtered list;
   *                    if omitted, reads from PMAEngine._state or data cache.
   */
  function renderPmaLayer(map, lat, lon, bufferMiles, includedTractsOverride) {
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
    if (Array.isArray(includedTractsOverride) && includedTractsOverride.length > 0) {
      tractList = includedTractsOverride;
    } else if (window.PMADataCache && window.PMADataCache.has('tractCentroids')) {
      var cached = window.PMADataCache.get('tractCentroids');
      tractList  = (cached && cached.tracts) ? cached.tracts : (Array.isArray(cached) ? cached : null);
    }

    if (!tractList || tractList.length === 0) return;

    // 3. Render the actual included tract polygons. If we were handed the
    // full centroid cache instead of an included set, filter it first.
    var inBuffer = Array.isArray(includedTractsOverride) && includedTractsOverride.length > 0
      ? includedTractsOverride
      : _tractsInRadius(tractList, lat, lon, bMiles);
    return _renderIncludedTracts(map, inBuffer, bMiles);
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
   * Return the last rendered PMA tract FeatureCollection, or null.
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
    _featureCollectionForTracts: _featureCollectionForTracts,
    _tractsInRadius:        _tractsInRadius,
    getLastPmaPolygon:      getLastPmaPolygon
  };

}());
