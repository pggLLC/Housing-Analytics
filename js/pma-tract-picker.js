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

  /* Color for the unified PMA boundary outline drawn on top of the
     individual tract polygons. Matches STYLE_SELECTED.color so the
     outline reads as part of the same set. Thicker stroke makes the
     PMA hull pop visually. */
  var STYLE_UNION_OUTLINE = {
    color:   '#096e65',
    weight:  4,
    opacity: 0.95
  };

  /* ── State ────────────────────────────────────────────────────────── */
  var _boundariesCache  = null;       // full GeoJSON FeatureCollection
  var _centroidsCache   = null;       // { GEOID: { lat, lon } }
  var _tractLayer       = null;       // L.GeoJSON layer for nearby tracts
  var _unionLayer       = null;       // L.LayerGroup of polylines tracing the PMA hull
  var _map              = null;       // active Leaflet map (for redrawing the union)
  var _selected         = new Set();  // selected tract GEOIDs
  var _autoSelected     = new Set();  // snapshot of init-time auto-pick (for curation diff)
  var _rationale        = '';         // analyst's per-PMA boundary rationale (CHFA Appendix A)
  var _onChange         = null;       // user callback(selectedGeoids)
  var _siteCenter       = null;       // { lat, lon }

  /* ── Persistence ──────────────────────────────────────────────────── */
  var STORAGE_KEY = 'coho.pmaTractPicker.v1';

  function _persist() {
    try {
      var payload = {
        siteCenter: _siteCenter,
        selected: Array.from(_selected),
        autoSelected: Array.from(_autoSelected),
        rationale: _rationale,
        updated_at: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) { /* localStorage unavailable; non-fatal */ }
  }

  function _loadPersisted() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      // Drop if older than 7 days — tract selections shouldn't dangle forever
      if (!p || !p.updated_at || (Date.now() - p.updated_at) > 7 * 86400 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return p;
    } catch (e) { return null; }
  }

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
        _persist();
        _drawUnionOutline();
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

      // Restore persisted selection if the user is returning to the same site
      // (within ~0.5 mi of the prior init point) — otherwise pre-select from
      // the auto-radius. 0.5 mi tolerance handles small map drag jiggles +
      // refining a site location across reloads.
      var persisted = _loadPersisted();
      var sameSite = persisted && persisted.siteCenter &&
        _haversineMi(lat, lon, persisted.siteCenter.lat, persisted.siteCenter.lon) < 0.5;

      _selected = new Set();
      if (sameSite && persisted.selected && persisted.selected.length) {
        persisted.selected.forEach(function (gid) { _selected.add(gid); });
        _rationale = persisted.rationale || '';
        console.log('[PMATractPicker] restored ' + _selected.size + ' tracts from localStorage');
      } else {
        nearby.forEach(function (f) {
          var gid = _featureGeoid(f);
          var c   = data.centroids[gid];
          if (c && _haversineMi(lat, lon, c.lat, c.lon) <= AUTOSELECT_RADIUS_MI) {
            _selected.add(gid);
          }
        });
      }

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

      // Snapshot the auto-pick set so we can later tell whether the analyst
      // has actually curated the boundary (CHFA Appendix A expects a justified
      // tract set, not an unedited radius snapped to tract edges).
      _autoSelected = sameSite && persisted.autoSelected && persisted.autoSelected.length
        ? new Set(persisted.autoSelected)
        : new Set(_selected);
      _persist();

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

      _map = map;
      _drawUnionOutline();

      if (typeof _onChange === 'function') _onChange(Array.from(_selected));

      console.log('[PMATractPicker] init: ' + nearby.length + ' visible, ' +
        _selected.size + ' pre-selected near ' + lat.toFixed(4) + ',' + lon.toFixed(4));

      return { selected: Array.from(_selected), visible: nearby.length };
    });
  }

  /**
   * Compute the union outline of the currently-selected tract polygons
   * by deduplicating shared interior edges. Each edge that appears in
   * exactly one selected polygon is a hull edge; edges that appear in
   * two adjacent selected polygons are interior and we drop them.
   *
   * Renders the surviving edges as a single LayerGroup of polylines
   * styled as STYLE_UNION_OUTLINE so the PMA reads as one merged shape
   * sitting on top of the per-tract fill.
   *
   * Pure-JS, no turf.js needed. Vertex precision: rounds to ~5 decimals
   * (≈1 m) so floating-point jitter from the source geojson doesn't
   * defeat the dedup.
   */
  function _drawUnionOutline() {
    if (!_map || !window.L) return;
    if (_unionLayer) {
      try { _map.removeLayer(_unionLayer); } catch (e) { /* ignore */ }
      _unionLayer = null;
    }
    if (!_selected.size || !_boundariesCache) return;

    // Collect the selected polygons (with their outer rings).
    // Source data: TIGER state file simplified per-tract — adjacent tracts
    // do NOT share byte-identical vertices, so pure string-key dedup of
    // edges only catches ~7% of true tract-tract seams. Switched to a
    // topology test: for each edge, offset its midpoint slightly
    // perpendicular OUTWARD; if that outside-point is inside any OTHER
    // selected polygon, treat the edge as a shared seam (interior).
    var selectedRings = [];
    (_boundariesCache.features || []).forEach(function (f) {
      var gid = _featureGeoid(f);
      if (!_selected.has(gid) || !f.geometry) return;
      var coords = f.geometry.coordinates;
      if (f.geometry.type === 'Polygon') {
        selectedRings.push({ gid: gid, rings: coords });
      } else if (f.geometry.type === 'MultiPolygon') {
        coords.forEach(function (poly) { selectedRings.push({ gid: gid, rings: poly }); });
      }
    });
    if (!selectedRings.length) return;

    // Point-in-polygon: standard ray-casting on the outer ring only.
    function _pip(point, ring) {
      var x = point[0], y = point[1];
      var inside = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1];
        var xj = ring[j][0], yj = ring[j][1];
        var intersect = ((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    // ε for perpendicular offset — small enough to land just outside the
    // current edge but inside an adjacent polygon if one exists. At ~CO
    // latitude, 0.00015° ≈ 16 m, smaller than the 4dp source precision
    // gap (~10-100 m typical) but enough to clear floating-point noise.
    var EPS_DEG = 0.00015;

    var hullSegments = [];

    selectedRings.forEach(function (s) {
      // Walk the outer ring only (s.rings[0]) — holes don't matter for
      // the PMA hull.
      var ring = s.rings[0];
      for (var i = 0; i < ring.length - 1; i++) {
        var a = ring[i], b = ring[i + 1];
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        // Edge vector
        var dx = b[0] - a[0], dy = b[1] - a[1];
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        // Right-perpendicular unit, scaled to EPS_DEG
        var nx = (dy / len) * EPS_DEG;
        var ny = (-dx / len) * EPS_DEG;
        // Probe both sides — one will land outside the current tract.
        var pLeft  = [mx + nx, my + ny];
        var pRight = [mx - nx, my - ny];
        // Determine which side is OUTSIDE the current tract.
        var leftInsideSelf  = _pip(pLeft, ring);
        var rightInsideSelf = _pip(pRight, ring);
        var outsidePoint = leftInsideSelf ? pRight : pLeft;
        // If the outside-point lies inside any OTHER selected polygon,
        // this edge is a shared seam → interior. Skip drawing.
        var isInteriorSeam = false;
        for (var k = 0; k < selectedRings.length; k++) {
          var other = selectedRings[k];
          if (other.gid === s.gid) continue;
          if (_pip(outsidePoint, other.rings[0])) {
            isInteriorSeam = true;
            break;
          }
        }
        if (!isInteriorSeam) {
          // GeoJSON [lon, lat] → Leaflet [lat, lon]
          hullSegments.push([[a[1], a[0]], [b[1], b[0]]]);
        }
      }
    });

    if (!hullSegments.length) return;
    var lines = hullSegments.map(function (seg) {
      return window.L.polyline(seg, STYLE_UNION_OUTLINE);
    });
    _unionLayer = window.L.layerGroup(lines).addTo(_map);
  }

  /**
   * Remove the tract layer from the map and reset state.
   * @param {L.Map} map
   */
  function clear(map) {
    if (_tractLayer && map) {
      try { map.removeLayer(_tractLayer); } catch (e) { /* ignore */ }
    }
    if (_unionLayer && map) {
      try { map.removeLayer(_unionLayer); } catch (e) { /* ignore */ }
    }
    _tractLayer   = null;
    _unionLayer   = null;
    _map          = null;
    _selected     = new Set();
    _autoSelected = new Set();
    _rationale    = '';
    _siteCenter   = null;
  }

  function _setsEqual(a, b) {
    if (a.size !== b.size) return false;
    var ok = true;
    a.forEach(function (v) { if (!b.has(v)) ok = false; });
    return ok;
  }

  /**
   * True when the analyst has either toggled any tract relative to the
   * auto-pick OR written a non-empty rationale. We treat a written rationale
   * as curation even without a tract toggle — sometimes the auto-ring is the
   * right answer and the analyst explains why.
   */
  function wasCurated() {
    if (_rationale && _rationale.trim().length > 0) return true;
    return !_setsEqual(_selected, _autoSelected);
  }

  function setRationale(text) {
    _rationale = String(text == null ? '' : text).slice(0, 2000);
    _persist();
  }

  function getRationale() {
    return _rationale;
  }

  /**
   * @returns {object} metadata for justification narrative + audit trail
   */
  function getCurationMetadata() {
    return {
      autoSelected:        Array.from(_autoSelected).sort(),
      selected:            Array.from(_selected).sort(),
      curated:             wasCurated(),
      rationale:           _rationale,
      autoSelectRadiusMi:  AUTOSELECT_RADIUS_MI
    };
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
   * Build a GeoJSON FeatureCollection of the selected whole-tract polygons.
   * Leaflet can render this directly, and downstream aggregation can use the
   * explicit GEOID list without pretending the boundary is a radius or hull.
   *
   * @returns {object|null} GeoJSON FeatureCollection or null when empty
   */
  function getBoundary() {
    if (_selected.size === 0 || !_boundariesCache || !Array.isArray(_boundariesCache.features)) return null;
    var selected = _boundariesCache.features.filter(function (f) {
      var gid = _featureGeoid(f);
      return gid && _selected.has(gid);
    });
    if (!selected.length) return null;
    var curated = wasCurated();
    return {
      type: 'FeatureCollection',
      properties: {
        source:      'pma-tract-picker',
        tract_count: selected.length,
        curated:     curated,
        rationale:   _rationale || null
      },
      features: selected.map(function (f) {
        var copy = {
          type: 'Feature',
          properties: Object.assign({}, f.properties || {}),
          geometry: f.geometry
        };
        copy.properties.source   = 'pma-tract-picker';
        copy.properties.selected = true;
        return copy;
      })
    };
  }

  function clearSelection() {
    _selected = new Set();
    if (_tractLayer && typeof _tractLayer.eachLayer === 'function') {
      _tractLayer.eachLayer(function (layer) {
        if (!layer || !layer.feature || !layer.setStyle) return;
        layer.setStyle(STYLE_UNSELECTED);
      });
    }
    _persist();
    _drawUnionOutline();
    if (typeof _onChange === 'function') _onChange([]);
  }

  window.PMATractPicker = {
    init:                init,
    clear:               clear,
    getSelectedGeoids:   getSelectedGeoids,
    getCount:            getCount,
    clearSelection:      clearSelection,
    getBoundary:         getBoundary,
    wasCurated:          wasCurated,
    setRationale:        setRationale,
    getRationale:        getRationale,
    getCurationMetadata: getCurationMetadata
  };
})();
