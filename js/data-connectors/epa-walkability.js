/**
 * js/data-connectors/epa-walkability.js
 * EPA Smart Location Database walkability & bikeability connector.
 * Loads block-group data from data/market/epa_sld_co.json and provides
 * walkability/bikeability scores for any lat/lon in Colorado.
 *
 * A site is located by point-in-polygon against the 2010 block-group
 * boundaries in data/market/epa_sld_bg_geometry_co.geojson (same GEOID set as
 * the EPA file; EPA SLD v3 is published on 2010 block groups, so the repo's
 * TIGER 2020 tracts cannot be used to join it). A site that falls in no block
 * group gets null and an unavailable reason — never another place's values.
 *
 * Exposes window.EpaWalkability.
 *
 * Depends on: js/data-service-portable.js (DataService.getEpaSld),
 *             js/fetch-helper.js (safeFetchJSON)
 */
(function () {
  'use strict';

  /** @type {Object.<string, object>|null} Block-group GEOID → metrics */
  var _blockGroups = null;

  /** @type {boolean} */
  var _loaded = false;

  /**
   * Block-group boundaries, indexed for point-in-polygon.
   * @type {Array.<{geoid:string,bbox:number[],polys:Array}>|null}
   */
  var _bgIndex = null;

  /** @type {string|null} Why the boundary file is not available, once known */
  var _geometryFailure = null;

  var SLD_URL      = 'data/market/epa_sld_co.json';
  var BG_GEOM_URL  = 'data/market/epa_sld_bg_geometry_co.geojson';

  // The boundary file is simplified server-side (maxAllowableOffset 0.0005°,
  // see scripts/market/fetch_epa_sld_bg_geometry.py), polygon by polygon, which
  // opens slivers between neighbours. A site in a sliver is matched to the
  // nearest boundary within that tolerance and no further.
  var SIMPLIFY_TOL_DEG = 0.0005;

  /* ── Value range constants (from Colorado EPA SLD data) ───────────── */
  var WALK_MAX      = 200;   // D3b intersection density cap for scoring (99th pctile ≈ 180)
  var TRANSIT_MAX   = 1200;  // D4a transit service frequency cap
  var AUTO_MAX      = 48;    // D3apo auto network density cap

  /* ── Load ──────────────────────────────────────────────────────────── */

  /**
   * Load EPA SLD block-group data. Call once at page init.
   * Accepts the parsed JSON from data/market/epa_sld_co.json.
   * @param {object} data - { blockGroups: { "080010094092": { walkability, ... } } }
   */
  function load(data) {
    if (!data || !data.blockGroups) {
      console.warn('[EpaWalkability] No block-group data provided');
      return;
    }
    _blockGroups = data.blockGroups;
    _loaded = true;
    console.log('[EpaWalkability] Loaded ' + Object.keys(_blockGroups).length + ' block groups');
  }

  /**
   * Load the 2010 block-group boundaries used to locate a site.
   * Accepts the parsed GeoJSON from data/market/epa_sld_bg_geometry_co.geojson.
   * @param {object} fc - FeatureCollection; properties.geoid on each feature
   */
  function loadGeometry(fc) {
    if (!fc || !Array.isArray(fc.features) || !fc.features.length) {
      _bgIndex = null;
      _geometryFailure = 'block-group boundary file had no features';
      console.warn('[EpaWalkability] No block-group boundaries provided');
      return;
    }
    var index = [];
    for (var i = 0; i < fc.features.length; i++) {
      var f = fc.features[i];
      var geoid = f && f.properties ? String(f.properties.geoid || '') : '';
      var g = f && f.geometry;
      if (!geoid || !g) continue;
      var polys = g.type === 'Polygon' ? [g.coordinates]
        : g.type === 'MultiPolygon' ? g.coordinates : null;
      if (!polys) continue;
      index.push({ geoid: geoid, bbox: _bboxOf(polys), polys: polys });
    }
    _bgIndex = index;
    _geometryFailure = null;
  }

  /**
   * Auto-load from DataService if available.
   */
  function autoLoad() {
    var fetch = (typeof window.safeFetchJSON === 'function') ? window.safeFetchJSON : null;
    if (!fetch) {
      setTimeout(autoLoad, 100);
      return;
    }
    fetch(SLD_URL)
      .then(function (data) { if (data) load(data); })
      .catch(function () { console.warn('[EpaWalkability] Could not auto-load EPA SLD'); });
    fetch(BG_GEOM_URL)
      .then(function (fc) {
        if (fc) loadGeometry(fc);
        else _geometryFailure = 'block-group boundary file did not load';
      })
      .catch(function () {
        _geometryFailure = 'block-group boundary file did not load';
        console.warn('[EpaWalkability] Could not auto-load block-group boundaries');
      });
  }

  /* ── Lookup ────────────────────────────────────────────────────────── */

  /**
   * Find the EPA SLD block group(s) a site sits in.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {{blockGroups: string[], method: string|null, unavailableReason: string|null}}
   *   blockGroups is empty exactly when unavailableReason is set. method is
   *   'contains', or 'within-simplification-tolerance' for a sliver match.
   */
  function resolveSite(lat, lon) {
    function none(reason) { return { blockGroups: [], method: null, unavailableReason: reason }; }
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) {
      return none('site coordinates are missing or not numeric');
    }
    if (!_loaded || !_blockGroups) return none('EPA Smart Location Database has not loaded');
    if (!_bgIndex) return none(_geometryFailure || 'block-group boundaries have not loaded yet');

    var hits = [];
    for (var i = 0; i < _bgIndex.length; i++) {
      var bg = _bgIndex[i];
      var b = bg.bbox;
      if (lon < b[0] || lat < b[1] || lon > b[2] || lat > b[3]) continue;
      if (!_blockGroups[bg.geoid]) continue;
      for (var p = 0; p < bg.polys.length; p++) {
        if (_inPolygon(lon, lat, bg.polys[p])) { hits.push(bg.geoid); break; }
      }
    }
    if (hits.length) return { blockGroups: hits, method: 'contains', unavailableReason: null };

    var best = null, bestD = SIMPLIFY_TOL_DEG;
    for (var k = 0; k < _bgIndex.length; k++) {
      var c = _bgIndex[k], cb = c.bbox;
      if (lon < cb[0] - bestD || lat < cb[1] - bestD || lon > cb[2] + bestD || lat > cb[3] + bestD) continue;
      if (!_blockGroups[c.geoid]) continue;
      var d = _distToPolys(lon, lat, c.polys);
      if (d <= bestD) { bestD = d; best = c.geoid; }
    }
    if (best) return { blockGroups: [best], method: 'within-simplification-tolerance', unavailableReason: null };
    return none('site is not inside any Colorado block group in the EPA Smart Location Database');
  }

  /**
   * EPA SLD metrics for the block group(s) containing a site.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {object|null} null when the site cannot be located; see
   *   getUnavailableReason() for why.
   */
  function getMetrics(lat, lon) {
    var site = resolveSite(lat, lon);
    if (!site.blockGroups.length) return null;
    return _averageForBlockGroups(site.blockGroups);
  }

  /**
   * Why getMetrics()/getScores() return null for a site, or null when they do not.
   * @param {number} lat
   * @param {number} lon
   * @returns {string|null}
   */
  function getUnavailableReason(lat, lon) {
    var site = resolveSite(lat, lon);
    if (site.unavailableReason) return site.unavailableReason;
    if (!getMetrics(lat, lon)) return 'EPA Smart Location Database has no intersection density for this block group';
    return null;
  }

  /**
   * Get walkability and bikeability scores (0-100) for a location.
   * @param {number} lat
   * @param {number} lon
   * @returns {{
   *   walkScore: number,
   *   bikeScore: number,
   *   walkLabel: string,
   *   bikeLabel: string,
   *   intersectionDensity: number|null,
   *   transitFrequency: number|null,
   *   landUseMix: number|null,
   *   autoNetDensity: number|null,
   *   blockGroupCount: number
   * }|null}
   */
  function getScores(lat, lon) {
    var m = getMetrics(lat, lon);
    if (!m) return null;

    var walkRaw = m.walkability != null ? m.walkability : 0;
    var transitRaw = m.transitAccess != null ? m.transitAccess : 0;
    var mixRaw = m.landUseMix != null ? m.landUseMix : 0;
    var autoRaw = m.autoNetDensity != null ? m.autoNetDensity : AUTO_MAX;

    // Walkability score: blend intersection density (60%) + transit freq (20%) + land-use mix (20%)
    var walkIntersection = Math.min(walkRaw / WALK_MAX, 1) * 100;
    var walkTransit = Math.min(transitRaw / TRANSIT_MAX, 1) * 100;
    var walkMix = mixRaw * 100;
    var walkScore = Math.round(
      walkIntersection * 0.60 +
      walkTransit * 0.20 +
      walkMix * 0.20
    );
    walkScore = Math.max(0, Math.min(100, walkScore));

    // Bikeability score: low auto-orientation (40%) + land-use mix (30%) + intersection density (30%)
    // Low auto-net density = more bike-friendly
    var bikeAuto = (1 - Math.min(autoRaw / AUTO_MAX, 1)) * 100;
    var bikeIntersection = Math.min(walkRaw / WALK_MAX, 1) * 100;
    var bikeMix = mixRaw * 100;
    var bikeScore = Math.round(
      bikeAuto * 0.40 +
      bikeMix * 0.30 +
      bikeIntersection * 0.30
    );
    bikeScore = Math.max(0, Math.min(100, bikeScore));

    return {
      walkScore:           walkScore,
      bikeScore:           bikeScore,
      walkLabel:           _scoreLabel(walkScore),
      bikeLabel:           _scoreLabel(bikeScore),
      intersectionDensity: m.walkability != null ? Math.round(m.walkability * 10) / 10 : null,
      transitFrequency:    m.transitAccess != null ? Math.round(m.transitAccess) : null,
      landUseMix:          m.landUseMix != null ? Math.round(m.landUseMix * 100) / 100 : null,
      autoNetDensity:      m.autoNetDensity != null ? Math.round(m.autoNetDensity * 10) / 10 : null,
      empDensity:          m.empDensity != null ? Math.round(m.empDensity * 100) / 100 : null,
      blockGroupCount:     m._count || 1
    };
  }

  /* ── Internal helpers ──────────────────────────────────────────────── */

  function _scoreLabel(score) {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Moderate';
    if (score >= 20) return 'Low';
    return 'Very Low';
  }

  function _bboxOf(polys) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var p = 0; p < polys.length; p++) {
      var outer = polys[p][0] || [];
      for (var i = 0; i < outer.length; i++) {
        var x = outer[i][0], y = outer[i][1];
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      }
    }
    return b;
  }

  /** Planar distance, in degrees, from a point to the nearest polygon edge. */
  function _distToPolys(x, y, polys) {
    var best = Infinity;
    for (var p = 0; p < polys.length; p++) {
      for (var r = 0; r < polys[p].length; r++) {
        var ring = polys[p][r];
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          var ax = ring[j][0], ay = ring[j][1], dx = ring[i][0] - ax, dy = ring[i][1] - ay;
          var len2 = dx * dx + dy * dy;
          var t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
          var ex = ax + t * dx - x, ey = ay + t * dy - y;
          var d = Math.sqrt(ex * ex + ey * ey);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Even-odd ray cast over every ring, so holes are excluded. */
  function _inPolygon(x, y, rings) {
    var inside = false;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Average EPA SLD metrics across the given block groups.
   */
  function _averageForBlockGroups(bgIds) {
    var sums = { walkability: 0, transitAccess: 0, landUseMix: 0, autoNetDensity: 0, empDensity: 0 };
    var counts = { walkability: 0, transitAccess: 0, landUseMix: 0, autoNetDensity: 0, empDensity: 0 };

    for (var j = 0; j < bgIds.length; j++) {
      var bg = _blockGroups[bgIds[j]];
      if (!bg) continue;
      if (bg.walkability != null)    { sums.walkability    += bg.walkability;    counts.walkability++;    }
      if (bg.transitAccess != null)  { sums.transitAccess  += bg.transitAccess;  counts.transitAccess++;  }
      if (bg.landUseMix != null)     { sums.landUseMix     += bg.landUseMix;     counts.landUseMix++;     }
      if (bg.autoNetDensity != null) { sums.autoNetDensity += bg.autoNetDensity; counts.autoNetDensity++; }
      if (bg.empDensity != null)     { sums.empDensity     += bg.empDensity;     counts.empDensity++;     }
    }

    if (counts.walkability === 0) return null;

    return {
      walkability:    sums.walkability / counts.walkability,
      transitAccess:  counts.transitAccess > 0  ? sums.transitAccess / counts.transitAccess   : null,
      landUseMix:     counts.landUseMix > 0     ? sums.landUseMix / counts.landUseMix         : null,
      autoNetDensity: counts.autoNetDensity > 0 ? sums.autoNetDensity / counts.autoNetDensity : null,
      empDensity:     counts.empDensity > 0     ? sums.empDensity / counts.empDensity         : null,
      _count:         counts.walkability
    };
  }

  /** @returns {boolean} true once both the metrics and the boundaries have loaded */
  function isLoaded() { return _loaded && !!_bgIndex; }

  /* ── Init ──────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoLoad);
  } else {
    autoLoad();
  }

  /* ── Expose ────────────────────────────────────────────────────────── */
  window.EpaWalkability = {
    load:                 load,
    loadGeometry:         loadGeometry,
    isLoaded:             isLoaded,
    resolveSite:          resolveSite,
    getMetrics:           getMetrics,
    getScores:            getScores,
    getUnavailableReason: getUnavailableReason
  };

}());
