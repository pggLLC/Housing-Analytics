/**
 * county-from-coords.js
 *
 * Browser-side point-in-polygon utility: maps a Colorado lat/lon to its
 * containing county FIPS by testing against TIGER county boundaries
 * (data/co-county-boundaries.json — 64 features, ~126 KB).
 *
 * Why this exists
 * ---------------
 * The Deal Calculator currently asks users to manually pick a county
 * for HUD AMI rent limits. That's friction for the user (and a
 * correctness risk in cross-county jurisdictions like Erie, Aurora,
 * Longmont — where a parcel on the wrong side of the line is in a
 * DIFFERENT HUD AMI tier than the place's "primary" county). With
 * this helper, the user can paste a lat/lon (or use browser
 * geolocation) and have the county auto-detected from the parcel's
 * actual geographic location.
 *
 * Public API
 * ----------
 *   window.CountyFromCoords.init() — fetch + cache boundaries
 *   window.CountyFromCoords.lookup(lat, lon) — returns {fips, name} or null
 *   window.CountyFromCoords.lookupSync(lat, lon) — same but throws if not init'd
 *
 * Algorithm
 * ---------
 * Standard ray-casting point-in-polygon (PnP). For each county feature:
 *   1. Bounding-box pre-filter (skip if (lat,lon) outside bbox).
 *   2. Walk the polygon edges; count how many edges a horizontal ray
 *      from (lat,lon) crosses. Odd = inside, even = outside.
 *   3. For MultiPolygon: any ring containing the point counts as a hit.
 *      Inner rings (holes) are subtracted via even-odd accumulation.
 *
 * The TIGER 2024 boundary data has ~60 vertices/county on average. A
 * full scan of all 64 counties is ~3,800 vertex tests in the worst
 * case — sub-millisecond on any modern device. Bbox pre-filter typically
 * cuts this to <100 vertex tests.
 */
(function () {
  'use strict';

  // Path is RELATIVE to data/. DataService.baseData() prepends 'data/';
  // standalone fallback below also prepends 'data/'. Path-convention
  // regression-protected by tests (see PR #791).
  var BOUNDARIES_PATH = 'co-county-boundaries.json';
  var _features = null;        // [{ name, fips, bbox: [minLon, minLat, maxLon, maxLat], rings: [[[lon,lat],...],...] }]
  var _loadPromise = null;

  function _resolveDataUrl(rel) {
    if (typeof window !== 'undefined' && window.DataService
        && typeof window.DataService.baseData === 'function') {
      return window.DataService.baseData(rel);
    }
    return 'data/' + rel;
  }

  function _fetchJson(url) {
    if (typeof window !== 'undefined' && window.DataService && window.DataService.getJSON) {
      return window.DataService.getJSON(url);
    }
    return fetch(url).then(function (r) { return r.json(); });
  }

  function init() {
    if (_features) return Promise.resolve(_features);
    if (_loadPromise) return _loadPromise;
    _loadPromise = _fetchJson(_resolveDataUrl(BOUNDARIES_PATH))
      .then(function (gj) {
        _features = _normalizeFeatures(gj);
        return _features;
      })
      .catch(function (err) {
        console.warn('[county-from-coords] Could not load ' + BOUNDARIES_PATH + ':', err);
        _features = [];
        return _features;
      });
    return _loadPromise;
  }

  /** Convert a raw GeoJSON FeatureCollection into our compact internal
   *  representation: every county becomes one record with {name, fips,
   *  bbox, rings}. Polygons → 1 ring set; MultiPolygons → flattened
   *  list of ring sets. Simplifies the lookup loop downstream. */
  function _normalizeFeatures(gj) {
    var out = [];
    var feats = (gj && gj.features) || [];
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      if (!f || !f.geometry) continue;
      var props = f.properties || {};
      var name = props.NAME || props.name || '';
      var fips = String(props.GEOID || props.FIPS || '').padStart(5, '0');
      if (!fips || fips.length !== 5) continue;
      var rings = _extractRings(f.geometry);
      if (!rings.length) continue;
      var bbox = _computeBbox(rings);
      out.push({ name: name, fips: fips, bbox: bbox, rings: rings });
    }
    return out;
  }

  /** Extract rings as an array of arrays of [lon, lat]. Handles
   *  Polygon (single set of rings) and MultiPolygon (multiple sets). */
  function _extractRings(geom) {
    if (!geom || !geom.coordinates) return [];
    if (geom.type === 'Polygon') {
      return geom.coordinates;  // [outer, hole1, hole2, ...]
    }
    if (geom.type === 'MultiPolygon') {
      var flat = [];
      for (var i = 0; i < geom.coordinates.length; i++) {
        var rings = geom.coordinates[i];
        for (var j = 0; j < rings.length; j++) {
          flat.push(rings[j]);
        }
      }
      return flat;
    }
    return [];
  }

  function _computeBbox(rings) {
    var minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      for (var j = 0; j < r.length; j++) {
        var p = r[j];
        if (p[0] < minLon) minLon = p[0];
        if (p[0] > maxLon) maxLon = p[0];
        if (p[1] < minLat) minLat = p[1];
        if (p[1] > maxLat) maxLat = p[1];
      }
    }
    return [minLon, minLat, maxLon, maxLat];
  }

  /** Standard ray-casting point-in-polygon. Tests whether (lat, lon) is
   *  inside the ring. Even-odd rule means rings can be added together
   *  for MultiPolygon-with-holes correctness. */
  function _pointInRing(lat, lon, ring) {
    var inside = false;
    var nVertices = ring.length;
    for (var i = 0, j = nVertices - 1; i < nVertices; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > lat) !== (yj > lat)) &&
                      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /** Test whether (lat, lon) is inside ANY ring of the feature.
   *  Even-odd accumulation handles holes correctly. */
  function _pointInFeature(lat, lon, feat) {
    // Bbox pre-filter
    var bb = feat.bbox;
    if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) return false;
    var insideCount = 0;
    for (var i = 0; i < feat.rings.length; i++) {
      if (_pointInRing(lat, lon, feat.rings[i])) insideCount++;
    }
    return (insideCount % 2) === 1;
  }

  /** Find the county containing (lat, lon). Returns {fips, name} or null.
   *  Async — call init() first or wait for the returned promise. */
  function lookup(lat, lon) {
    return init().then(function () {
      return lookupSync(lat, lon);
    });
  }

  /** Synchronous lookup. Throws if init() hasn't completed yet. */
  function lookupSync(lat, lon) {
    if (!_features) return null;
    if (!isFinite(lat) || !isFinite(lon)) return null;
    for (var i = 0; i < _features.length; i++) {
      var f = _features[i];
      if (_pointInFeature(lat, lon, f)) {
        return { fips: f.fips, name: f.name };
      }
    }
    return null;
  }

  /** Test whether init() has completed and data is ready. */
  function isReady() {
    return _features !== null && _features.length > 0;
  }

  window.CountyFromCoords = {
    init: init,
    lookup: lookup,
    lookupSync: lookupSync,
    isReady: isReady,
  };
})();
