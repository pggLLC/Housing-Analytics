/**
 * js/pma-tract-picker.js
 * CHFA-compliant tract picker for the PMA tool.
 *
 * CHFA's 2025-26 Market Study Guide (Appendix A) is explicit: "Radius
 * boundaries are not allowed. The market boundary must include entire
 * census tracts." The buffer/radius mode in this tool is a first-pass
 * screening proxy. This module exposes the real interaction — click to
 * add / remove whole tracts, build a tract-union boundary, and pass the
 * explicit GEOID set to the analysis runner so aggregation respects the
 * picked set rather than a radius.
 *
 * Exposed as window.PMATractPicker. Depends on Leaflet (window.L) and
 * the tract_boundaries_co.geojson + tract_centroids_co.json files in
 * data/market/.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var TRACT_BOUNDARIES_URL = 'data/market/tract_boundaries_co.geojson';
  var TRACT_CENTROIDS_URL  = 'data/market/tract_centroids_co.json';
  var NEARBY_RADIUS_MI     = 12;     // show tracts within this radius of click
  var AUTOSELECT_RADIUS_MI = 4;      // pre-select tracts within this radius
                                     // (4 mi handles rural sites where the
                                     // closest tract centroid is ~3-4 mi away)

  var STYLE_UNSELECTED = {
    color:       '#7a7a7a',
    weight:      1,
    fillColor:   '#7a7a7a',
    fillOpacity: 0.04,
    dashArray:   '3 3'
  };
  var STYLE_SELECTED = {
    color:       '#096e65',
    weight:      2,
    fillColor:   '#096e65',
    fillOpacity: 0.18,
    dashArray:   null
  };
  var STYLE_HOVER = {
    weight:      3,
    fillOpacity: 0.28
  };

  /* ── State ────────────────────────────────────────────────────────── */
  var _boundariesCache = null;       // full GeoJSON FeatureCollection
  var _centroidsCache  = null;       // { GEOID: { lat, lon } }
  var _tractLayer      = null;       // L.GeoJSON layer for nearby tracts
  var _selected        = new Set();  // selected tract GEOIDs
  var _onChange        = null;       // user callback(selectedGeoids)
  var _siteCenter      = null;       // { lat, lon }

  /* ── Utility ──────────────────────────────────────────────────────── */
  function _haversineMi(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function _fetchJSON(url) {
    var fetcher = (window.fetchWithBase) ? window.fetchWithBase : window.fetch.bind(window);
    return fetcher(url).then(function (r) {
      if (!r || !r.ok) throw new Error('fetch failed: ' + url);
      return r.json();
    });
  }

  function _loadData() {
    var bP = _boundariesCache
      ? Promise.resolve(_boundariesCache)
      : _fetchJSON(TRACT_BOUNDARIES_URL).then(function (gj) {
          _boundariesCache = gj;
          return gj;
        });
    var cP = _centroidsCache
      ? Promise.resolve(_centroidsCache)
      : _fetchJSON(TRACT_CENTROIDS_URL).then(function (cj) {
          // Normalize to { GEOID: { lat, lon } }
          var map = {};
          var arr = Array.isArray(cj) ? cj : (cj && cj.tracts) || [];
          arr.forEach(function (t) {
            var gid = t.GEOID || t.geoid || t.GEOID20 || t.tract_geoid;
            var lat = t.lat || t.LAT || t.centroid_lat;
            var lon = t.lon || t.LON || t.centroid_lon;
            if (gid && typeof lat === 'number' && typeof lon === 'number') {
              map[gid] = { lat: lat, lon: lon };
            }
          });
          _centroidsCache = map;
          return map;
        });
    return Promise.all([bP, cP]).then(function (arr) {
      return { boundaries: arr[0], centroids: arr[1] };
    });
  }

  /* ── Hover handlers (declared at module scope so styling
   *    helpers can re-apply them per feature redraw) ──────────────── */
  function _onLayerEvents(feature, layer) {
    var gid = _featureGeoid(feature);
    if (!gid) return;
    layer.on({
      click: function () {
        if (_selected.has(gid)) {
          _selected.delete(gid);
        } else {
          _selected.add(gid);
        }
        _applyStyle(layer, gid);
        if (typeof _onChange === 'function') _onChange(Array.from(_selected));
      },
      mouseover: function () {
        layer.setStyle(STYLE_HOVER);
      },
      mouseout: function () {
        _applyStyle(layer, gid);
      }
    });
    layer.bindTooltip(
      'Tract ' + gid + (_selected.has(gid) ? ' · selected' : ' · click to add'),
      { sticky: true, opacity: 0.9 }
    );
  }

  function _featureGeoid(feature) {
    if (!feature || !feature.properties) return null;
    return feature.properties.GEOID ||
           feature.properties.geoid ||
           feature.properties.GEOID20 ||
           null;
  }

  function _applyStyle(layer, gid) {
    layer.setStyle(_selected.has(gid) ? STYLE_SELECTED : STYLE_UNSELECTED);
  }

  /* ── Public API ───────────────────────────────────────────────────── */

  /**
   * Initialize the tract picker at a given click point.
   * Fetches boundaries + centroids if not cached, filters to tracts
   * whose centroid is within NEARBY_RADIUS_MI miles, pre-selects those
   * within AUTOSELECT_RADIUS_MI miles, and renders the GeoJSON layer.
   *
   * @param {L.Map}    map
   * @param {number}   lat
   * @param {number}   lon
   * @param {function} [onChange] — called with Array<GEOID> on each toggle
   * @returns {Promise<{selected: string[], visible: number}>}
   */
  function init(map, lat, lon, onChange) {
    if (!window.L || !map || typeof lat !== 'number' || typeof lon !== 'number') {
      return Promise.reject(new Error('PMATractPicker.init: invalid arguments'));
    }
    _siteCenter = { lat: lat, lon: lon };
    _onChange   = onChange || null;
    clear(map);

    return _loadData().then(function (data) {
      // Filter to nearby tracts by centroid distance
      var nearby = (data.boundaries.features || []).filter(function (f) {
        var gid = _featureGeoid(f);
        if (!gid) return false;
        var c = data.centroids[gid];
        if (!c) return false;
        return _haversineMi(lat, lon, c.lat, c.lon) <= NEARBY_RADIUS_MI;
      });

      // Pre-select tracts inside auto-select radius
      _selected = new Set();
      nearby.forEach(function (f) {
        var gid = _featureGeoid(f);
        var c   = data.centroids[gid];
        if (c && _haversineMi(lat, lon, c.lat, c.lon) <= AUTOSELECT_RADIUS_MI) {
          _selected.add(gid);
        }
      });

      // If auto-select picked nothing (rural with sparse centroids), grab
      // the single closest tract so the user has a working starting set.
      if (_selected.size === 0 && nearby.length > 0) {
        var closest = null, bestD = Infinity;
        nearby.forEach(function (f) {
          var gid = _featureGeoid(f);
          var c   = data.centroids[gid];
          if (!c) return;
          var d = _haversineMi(lat, lon, c.lat, c.lon);
          if (d < bestD) { bestD = d; closest = gid; }
        });
        if (closest) _selected.add(closest);
      }

      _tractLayer = window.L.geoJSON(
        { type: 'FeatureCollection', features: nearby },
        {
          style: function (feature) {
            var gid = _featureGeoid(feature);
            return _selected.has(gid) ? STYLE_SELECTED : STYLE_UNSELECTED;
          },
          onEachFeature: _onLayerEvents
        }
      ).addTo(map);

      if (typeof _onChange === 'function') _onChange(Array.from(_selected));

      console.log('[PMATractPicker] init: ' + nearby.length + ' visible, ' +
        _selected.size + ' pre-selected near ' + lat.toFixed(4) + ',' + lon.toFixed(4));

      return { selected: Array.from(_selected), visible: nearby.length };
    });
  }

  /**
   * Remove the tract layer from the map and reset state.
   * @param {L.Map} map
   */
  function clear(map) {
    if (_tractLayer && map) {
      try { map.removeLayer(_tractLayer); } catch (e) { /* ignore */ }
    }
    _tractLayer = null;
    _selected   = new Set();
    _siteCenter = null;
  }

  /**
   * @returns {string[]} currently-selected tract GEOIDs
   */
  function getSelectedGeoids() {
    return Array.from(_selected);
  }

  function getCount() {
    return _selected.size;
  }

  /**
   * Build a GeoJSON Polygon Feature representing the union of selected
   * tracts (convex hull of their centroids — a tract-union polygon is
   * out of scope without a geometry library; the hull is a faithful
   * "tract-set boundary" for screening purposes).
   *
   * @returns {object|null} GeoJSON Feature or null when <3 tracts picked
   */
  function getBoundary() {
    if (_selected.size < 3 || !_centroidsCache) return null;
    var pts = [];
    _selected.forEach(function (gid) {
      var c = _centroidsCache[gid];
      if (c) pts.push({ lat: c.lat, lon: c.lon });
    });
    if (pts.length < 3) return null;
    return _convexHullFeature(pts);
  }

  function _convexHullFeature(points) {
    var pts = points.slice().sort(function (a, b) {
      return a.lon !== b.lon ? a.lon - b.lon : a.lat - b.lat;
    });
    function cross(O, A, B) {
      return (A.lon - O.lon) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lon - O.lon);
    }
    var lower = [];
    for (var i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    var upper = [];
    for (var j = pts.length - 1; j >= 0; j--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[j]) <= 0) upper.pop();
      upper.push(pts[j]);
    }
    upper.pop();
    lower.pop();
    var hull = lower.concat(upper);
    if (hull.length < 3) return null;
    var coords = hull.map(function (p) { return [p.lon, p.lat]; });
    coords.push(coords[0]);
    return {
      type: 'Feature',
      properties: { source: 'pma-tract-picker', tract_count: _selected.size },
      geometry: { type: 'Polygon', coordinates: [coords] }
    };
  }

  window.PMATractPicker = {
    init:              init,
    clear:             clear,
    getSelectedGeoids: getSelectedGeoids,
    getCount:          getCount,
    getBoundary:       getBoundary
  };
})();
