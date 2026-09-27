/**
 * js/data-connectors/epa-walkability.js
 * EPA Smart Location Database walkability & bikeability connector.
 * Loads block-group data from data/market/epa_sld_co.json and provides
 * walkability/bikeability scores for any lat/lon in Colorado.
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

  /** @type {Array.<{geoid:string,lat:number,lon:number}>|null} */
  var _bgCentroids = null;

  /* ── Earth constants ──────────────────────────────────────────────── */
  var EARTH_R_MI = 3958.8;

  function _toRad(d) { return d * Math.PI / 180; }

  function _haversine(lat1, lon1, lat2, lon2) {
    var dLat = _toRad(lat2 - lat1);
    var dLon = _toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_R_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Value range constants (from Colorado EPA SLD data) ───────────── */
  var WALK_MAX      = 200;   // D3b intersection density cap for scoring (99th pctile ≈ 180)
  var AUTO_MAX      = 48;    // D3apo auto network density cap

  // transitAccess in epa_sld_co.json is EPA SLD D4A: the distance in metres
  // from a block group's population-weighted centroid to the nearest transit
  // stop (EPA's own field alias), not service frequency and not an index.
  // Lower is better, and EPA leaves it blank beyond ~3/4 mile, so half of
  // Colorado's block groups have no value. It used to be divided by a 1200
  // "frequency cap" and added to the walk score, which rewarded being far from
  // transit. It is now carried as a distance and kept out of both scores;
  // turning distance into a score is a methodology decision not yet made.
  var EPA_D4A_NOT_A_SCORE_REASON = 'EPA SLD D4A is distance to the nearest transit stop (metres), not transit ' +
    'service frequency or an index, so it is not part of the walkability score; walkability uses intersection ' +
    'density (D3B) and land-use mix.';

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

    // Pre-compute approximate centroids from GEOIDs for nearest-match lookup.
    // Colorado block-group GEOIDs are 12 digits: SSCCCTTTTTTB.
    // We'll use a spatial index built lazily on first query.
    _bgCentroids = null;
    console.log('[EpaWalkability] Loaded ' + Object.keys(_blockGroups).length + ' block groups');
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
    fetch('data/market/epa_sld_co.json')
      .then(function (data) { if (data) load(data); })
      .catch(function () { console.warn('[EpaWalkability] Could not auto-load EPA SLD'); });
  }

  /* ── Lookup ────────────────────────────────────────────────────────── */

  /**
   * Find the nearest block group(s) to a lat/lon by matching tract GEOIDs
   * from PMAEngine's buffer, or by brute-force nearest block-group centroid.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {object|null} EPA SLD metrics for the best-matching block group(s)
   */
  function getMetrics(lat, lon) {
    if (!_loaded || !_blockGroups) return null;

    // Strategy 1: Use PMAEngine buffered tract GEOIDs if available
    var tractGeoids = _getTractGeoids(lat, lon);
    if (tractGeoids && tractGeoids.length > 0) {
      return _averageForTracts(tractGeoids);
    }

    // Strategy 2: Find nearest block group by lat/lon approximation
    return _nearestBlockGroup(lat, lon);
  }

  /**
   * Get walkability and bikeability scores (0-100) for a location.
   * @param {number} lat
   * @param {number} lon
   * @returns {{
   *   walkScore: number|null,
   *   bikeScore: number|null,
   *   walkLabel: string|null,
   *   bikeLabel: string|null,
   *   intersectionDensity: number|null,
   *   nearestTransitStopMeters: number|null,
   *   transitStopBlockGroupCount: number,
   *   transitScoreUnavailableReason: string,
   *   landUseMix: number|null,
   *   autoNetDensity: number|null,
   *   blockGroupCount: number
   * }|null}
   */
  function getScores(lat, lon) {
    var m = getMetrics(lat, lon);
    if (!m) return null;

    var walk = _num(m.walkability);
    var mix = _num(m.landUseMix);
    var auto = _num(m.autoNetDensity);
    var intersectionPts = walk != null ? Math.min(walk / WALK_MAX, 1) * 100 : null;
    var mixPts = mix != null ? mix * 100 : null;

    // Walkability: intersection density (75%) + land-use mix (25%). This was
    // 60/20/20 with D4A as the middle term; D4A's share went to the other two
    // pro rata (see EPA_D4A_NOT_A_SCORE_REASON).
    var walkScore = _blend([
      { value: intersectionPts, weight: 0.75 },
      { value: mixPts,          weight: 0.25 }
    ]);

    // Bikeability: low auto-orientation (40%) + land-use mix (30%) + intersection density (30%)
    // Low auto-net density = more bike-friendly
    var bikeScore = _blend([
      { value: auto != null ? (1 - Math.min(auto / AUTO_MAX, 1)) * 100 : null, weight: 0.40 },
      { value: mixPts,          weight: 0.30 },
      { value: intersectionPts, weight: 0.30 }
    ]);

    var d4a = _num(m.transitAccess);
    return {
      walkScore:           walkScore,
      bikeScore:           bikeScore,
      walkLabel:           walkScore != null ? _scoreLabel(walkScore) : null,
      bikeLabel:           bikeScore != null ? _scoreLabel(bikeScore) : null,
      intersectionDensity: walk != null ? Math.round(walk * 10) / 10 : null,
      // Mean over the block groups that HAVE a stop within EPA's cutoff; the
      // rest are blank in the source, so this is not an area-wide average.
      nearestTransitStopMeters:   d4a != null ? Math.round(d4a) : null,
      transitStopBlockGroupCount: m._transitCount != null ? m._transitCount : (d4a != null ? 1 : 0),
      transitScoreUnavailableReason: EPA_D4A_NOT_A_SCORE_REASON,
      landUseMix:          mix != null ? Math.round(mix * 100) / 100 : null,
      autoNetDensity:      auto != null ? Math.round(auto * 10) / 10 : null,
      empDensity:          m.empDensity != null ? Math.round(m.empDensity * 100) / 100 : null,
      blockGroupCount:     m._count || 1
    };
  }

  /* ── Internal helpers ──────────────────────────────────────────────── */

  function _num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  /**
   * Weighted mean over the components that were measured. A missing component
   * is dropped and its weight shared out; it is never scored as 0 or as the
   * worst case. Null when nothing was measured.
   */
  function _blend(parts) {
    var sum = 0, w = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].value == null) continue;
      sum += parts[i].value * parts[i].weight;
      w += parts[i].weight;
    }
    return w > 0 ? Math.max(0, Math.min(100, Math.round(sum / w))) : null;
  }

  function _scoreLabel(score) {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Moderate';
    if (score >= 20) return 'Low';
    return 'Very Low';
  }

  /**
   * Try to get tract GEOIDs from PMAEngine for the analysis buffer.
   */
  function _getTractGeoids(lat, lon) {
    var pma = window.PMAEngine;
    if (!pma || typeof pma.tractsInBuffer !== 'function') return null;
    try {
      var tracts = pma.tractsInBuffer(lat, lon, 3);
      if (tracts && tracts.length) {
        return tracts.map(function (t) { return t.geoid; });
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * Average EPA SLD metrics across block groups matching tract GEOIDs.
   */
  function _averageForTracts(tractGeoids) {
    var tractSet = {};
    for (var i = 0; i < tractGeoids.length; i++) {
      tractSet[tractGeoids[i]] = true;
    }

    var sums = { walkability: 0, transitAccess: 0, landUseMix: 0, autoNetDensity: 0, empDensity: 0 };
    var counts = { walkability: 0, transitAccess: 0, landUseMix: 0, autoNetDensity: 0, empDensity: 0 };

    var bgIds = Object.keys(_blockGroups);
    for (var j = 0; j < bgIds.length; j++) {
      var tractPrefix = bgIds[j].substring(0, 11);
      if (!tractSet[tractPrefix]) continue;
      var bg = _blockGroups[bgIds[j]];
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
      _count:         counts.walkability,
      _transitCount:  counts.transitAccess
    };
  }

  /**
   * Nearest block-group fallback using tract centroid data.
   * Approximates block-group location from the tract centroid file.
   */
  function _nearestBlockGroup(lat, lon) {
    // Build centroid index lazily from tract_centroids_co.json data
    if (!_bgCentroids) {
      _bgCentroids = [];
      // Use tract centroids: each block group shares its tract's centroid
      var ds = window.DataService;
      if (ds && ds._tractCentroidsCache) {
        var tracts = ds._tractCentroidsCache;
        for (var i = 0; i < tracts.length; i++) {
          _bgCentroids.push({
            geoid: tracts[i].geoid,
            lat:   tracts[i].lat,
            lon:   tracts[i].lon
          });
        }
      }
    }

    // Find 3 nearest tracts and average their block groups
    if (_bgCentroids.length === 0) {
      // Last resort: pick the first block group (better than nothing)
      var firstKey = Object.keys(_blockGroups)[0];
      return firstKey ? _blockGroups[firstKey] : null;
    }

    var nearest = [];
    for (var k = 0; k < _bgCentroids.length; k++) {
      var c = _bgCentroids[k];
      var d = _haversine(lat, lon, c.lat, c.lon);
      if (nearest.length < 3 || d < nearest[nearest.length - 1].dist) {
        nearest.push({ geoid: c.geoid, dist: d });
        nearest.sort(function (a, b) { return a.dist - b.dist; });
        if (nearest.length > 3) nearest.pop();
      }
    }

    var tractGeoids = nearest.map(function (n) { return n.geoid; });
    return _averageForTracts(tractGeoids);
  }

  /** @returns {boolean} */
  function isLoaded() { return _loaded; }

  /* ── Init ──────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoLoad);
  } else {
    autoLoad();
  }

  /* ── Expose ────────────────────────────────────────────────────────── */
  window.EpaWalkability = {
    load:       load,
    isLoaded:   isLoaded,
    getMetrics: getMetrics,
    getScores:  getScores
  };

}());
