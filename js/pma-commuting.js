/**
 * js/pma-commuting.js
 * LEHD/LODES-based commuting flow analysis for PMA delineation.
 *
 * Responsibilities:
 *  - fetchLODESWorkplaces(lat, lon, radiusMiles) — workplace locations near site
 *  - analyzeCommutingFlows(workplaces) — identify resident origin zones
 *  - generateCommutingBoundary(lat, lon, flows) — produce weighted PMA polygon
 *  - getJustificationData() — export audit-ready commuting metrics
 *
 * Replaces simple circular buffer with commuting-weighted polygon, capturing
 * approximately 70–80 % of likely residents based on LODES WAC/RAC data.
 *
 * Exposed as window.PMACommuting.
 * Uses DataService (window.DataService) when available; degrades gracefully.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var DEFAULT_RADIUS_MILES = 30;
  var CAPTURE_TARGET       = 0.75;   // aim to capture 75 % of commuting workers
  var MAX_ORIGIN_ZONES     = 50;     // top origin census tracts to retain
  var EARTH_RADIUS_MI      = 3958.8;

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastWorkplaces    = [];
  var lastFlows         = [];
  var lastBoundary      = null;
  var lastCaptureRate   = 0;
  var lastOriginZones   = [];
  var lastDataCoverage  = 'fallback'; // tracks whether real LODES data was used

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function toRad(deg) { return deg * Math.PI / 180; }

  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  /**
   * Build a simple convex-hull-style bounding polygon from an array of
   * {lat, lon} points. Returns a GeoJSON Polygon geometry or null.
   * @param {Array.<{lat:number,lon:number}>} points
   * @returns {object|null}
   */
  function buildConvexHullPolygon(points) {
    if (!points || points.length < 3) return null;

    // Sort by longitude then latitude for gift-wrap
    var pts = points.slice().sort(function (a, b) {
      return a.lon !== b.lon ? a.lon - b.lon : a.lat - b.lat;
    });

    function cross(O, A, B) {
      return (A.lon - O.lon) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lon - O.lon);
    }

    var lower = [];
    for (var i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
        lower.pop();
      }
      lower.push(pts[i]);
    }
    var upper = [];
    for (var j = pts.length - 1; j >= 0; j--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[j]) <= 0) {
        upper.pop();
      }
      upper.push(pts[j]);
    }
    upper.pop();
    lower.pop();
    var hull = lower.concat(upper);
    if (hull.length < 3) return null;

    var coords = hull.map(function (p) { return [p.lon, p.lat]; });
    coords.push(coords[0]); // close ring

    return {
      type: 'Polygon',
      coordinates: [coords]
    };
  }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Fetch LODES workplace locations within a given radius of a site.
   * Calls DataService.fetchLODES when available; returns empty stub otherwise.
   *
   * @param {number} lat        - Site latitude
   * @param {number} lon        - Site longitude
   * @param {number} [radiusMiles] - Search radius (default 30 miles)
   * @param {string} [vintage]  - LODES vintage year (default "2021")
   * @returns {Promise<{workplaces: Array, commutingFlows: Array}>}
   */
  function fetchLODESWorkplaces(lat, lon, radiusMiles, vintage) {
    radiusMiles = radiusMiles || DEFAULT_RADIUS_MILES;
    vintage     = vintage     || '2021';

    var ds        = (typeof window !== 'undefined') ? window.DataService    : null;
    var lodesConn = (typeof window !== 'undefined') ? window.LodesCommute   : null;

    // Prefer DataService live API when available
    if (ds && typeof ds.fetchLODES === 'function') {
      lastDataCoverage = 'full';
      return ds.fetchLODES(lat, lon, radiusMiles, vintage);
    }

    // Fall back to local LodesCommute connector (data/market/lodes_co.json)
    if (lodesConn && typeof lodesConn.loadMetrics === 'function') {
      return lodesConn.loadMetrics().then(function (raw) {
        // Adapt LodesCommute tract records into the workplace format expected by
        // analyzeCommutingFlows: { lat, lon, jobCount, tractId }
        var tracts = (raw && raw.tracts) ? raw.tracts : (Array.isArray(raw) ? raw : []);
        var workplaces = tracts.map(function (t) {
          return {
            id:       t.geoid,
            lat:      toNum(t.lat),
            lon:      toNum(t.lon),
            jobCount: toNum(t.work_workers != null ? t.work_workers : (t.home_workers != null ? t.home_workers : 0)),
            tractId:  t.geoid
          };
        }).filter(function (w) { return w.lat !== 0 || w.lon !== 0; });

        lastDataCoverage = workplaces.length > 0 ? 'partial' : 'fallback';
        return { workplaces: workplaces, commutingFlows: [] };
      }).catch(function () {
        // FALLBACK: lodes_co.json failed to load. Using synthetic workplace data.
        lastDataCoverage = 'fallback';
        return {
          workplaces: _buildSyntheticWorkplaces(lat, lon, radiusMiles),
          commutingFlows: []
        };
      });
    }

    // FALLBACK: Neither DataService.fetchLODES nor window.LodesCommute is available.
    // Using synthetic stub data until lodes-commute.js is loaded.
    lastDataCoverage = 'fallback';
    return Promise.resolve({
      workplaces: _buildSyntheticWorkplaces(lat, lon, radiusMiles),
      commutingFlows: []
    });
  }

  /**
   * Build synthetic workplace locations for fallback (no live API).
   * Distributes points in concentric rings around the site.
   * @private
   */
  function _buildSyntheticWorkplaces(lat, lon, radiusMiles) {
    var workplaces = [];
    var rings = [
      { radiusFraction: 0.2, count: 8,  avgJobs: 300 },
      { radiusFraction: 0.5, count: 12, avgJobs: 200 },
      { radiusFraction: 0.8, count: 16, avgJobs: 100 },
      { radiusFraction: 1.0, count: 10, avgJobs:  50 }
    ];
    var id = 1;
    rings.forEach(function (ring) {
      var r = ring.radiusFraction * radiusMiles;
      for (var i = 0; i < ring.count; i++) {
        var angle = (2 * Math.PI * i) / ring.count;
        var dlat  = (r / 69.0) * Math.cos(angle);
        var dlon  = (r / (69.0 * Math.cos(toRad(lat)))) * Math.sin(angle);
        workplaces.push({
          id:        'wp-' + (id++),
          lat:       lat + dlat,
          lon:       lon + dlon,
          jobCount:  ring.avgJobs + Math.round((Math.random() - 0.5) * 50),
          industry:  ['Healthcare', 'Retail', 'Education', 'Manufacturing', 'Tech'][id % 5],
          tractId:   '08' + String(id).padStart(9, '0')
        });
      }
    });
    return workplaces;
  }

  /**
   * Analyse commuting flow patterns to identify resident origin zones.
   * Returns sorted list of origin zones by estimated resident count.
   *
   * @param {Array} workplaces - Array of workplace objects with lat, lon, jobCount
   * @returns {{originZones: Array, totalWorkers: number}}
   */
  function analyzeCommutingFlows(workplaces) {
    if (!workplaces || !workplaces.length) {
      return { originZones: [], totalWorkers: 0, captureRate: 0 };
    }

    lastWorkplaces = workplaces;

    // Aggregate job counts by approximate tract (rounded coords as proxy)
    var tractMap = {};
    var totalJobs = 0;
    workplaces.forEach(function (wp) {
      var jobs = toNum(wp.jobCount);
      totalJobs += jobs;
      var tractKey = wp.tractId || (
        String(Math.round(toNum(wp.lat) * 100) / 100) + ',' +
        String(Math.round(toNum(wp.lon) * 100) / 100)
      );
      if (!tractMap[tractKey]) {
        tractMap[tractKey] = {
          tractId:        tractKey,
          lat:            toNum(wp.lat),
          lon:            toNum(wp.lon),
          estimatedWorkers: 0,
          industries:     {}
        };
      }
      tractMap[tractKey].estimatedWorkers += jobs;
      if (wp.industry) {
        tractMap[tractKey].industries[wp.industry] =
          (tractMap[tractKey].industries[wp.industry] || 0) + jobs;
      }
    });

    // Sort by worker count descending
    var zones = Object.values(tractMap).sort(function (a, b) {
      return b.estimatedWorkers - a.estimatedWorkers;
    });

    // Retain top zones until CAPTURE_TARGET is met
    var running = 0;
    var selected = [];
    zones.forEach(function (z) {
      if (running / totalJobs < CAPTURE_TARGET || selected.length < 5) {
        running += z.estimatedWorkers;
        selected.push(z);
      }
    });
    selected = selected.slice(0, MAX_ORIGIN_ZONES);

    lastFlows = zones;
    lastOriginZones = selected;
    lastCaptureRate = totalJobs > 0 ? running / totalJobs : 0;

    return {
      originZones:   selected,
      totalWorkers:  totalJobs,
      captureRate:   Math.min(lastCaptureRate, 1.0)
    };
  }

  /**
   * Generate a commuting-weighted PMA boundary polygon.
   * Uses origin zone centroids to build a convex hull that encloses the
   * primary resident catchment area.
   *
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {{originZones: Array}} flowResult - output of analyzeCommutingFlows
   * @returns {{boundary: object|null, captureRate: number, zoneCentroids: Array}}
   */
  function generateCommutingBoundary(siteLat, siteLon, flowResult) {
    var zones = (flowResult && flowResult.originZones) ? flowResult.originZones : lastOriginZones;

    if (!zones || zones.length < 3) {
      // Not enough zones — fall back to a 5-mile circular approximation
      lastBoundary = _circlePolygon(siteLat, siteLon, 5, 16);
      return {
        boundary:      lastBoundary,
        captureRate:   lastCaptureRate,
        zoneCentroids: zones || [],
        fallback:      true
      };
    }

    // Include the site itself in the hull
    var points = [{ lat: siteLat, lon: siteLon }].concat(
      zones.map(function (z) { return { lat: z.lat, lon: z.lon }; })
    );

    var hull = buildConvexHullPolygon(points);
    lastBoundary = hull;

    return {
      boundary:      hull,
      captureRate:   lastCaptureRate,
      zoneCentroids: zones,
      fallback:      false
    };
  }

  /**
   * Build a circular GeoJSON polygon approximation.
   * @private
   */
  function _circlePolygon(lat, lon, radiusMiles, sides) {
    sides = sides || 32;
    var coords = [];
    for (var i = 0; i <= sides; i++) {
      var angle = (2 * Math.PI * i) / sides;
      var dlat  = (radiusMiles / 69.0) * Math.cos(angle);
      var dlon  = (radiusMiles / (69.0 * Math.cos(toRad(lat)))) * Math.sin(angle);
      coords.push([lon + dlon, lat + dlat]);
    }
    return { type: 'Polygon', coordinates: [coords] };
  }

  /**
   * Export commuting analysis justification data for ScoreRun audit trail.
   * @returns {object}
   */
  function getJustificationData() {
    return {
      lodesWorkplaces:    lastWorkplaces.length,
      residentOriginZones: lastOriginZones.slice(),
      captureRate:        lastCaptureRate,
      totalFlowZones:     lastFlows.length,
      boundary:           lastBoundary,
      dataCoverage:       lastDataCoverage
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMACommuting = {
      fetchLODESWorkplaces:      fetchLODESWorkplaces,
      analyzeCommutingFlows:     analyzeCommutingFlows,
      generateCommutingBoundary: generateCommutingBoundary,
      getJustificationData:      getJustificationData,
      _buildCirclePolygon:       _circlePolygon  // exposed for testing
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchLODESWorkplaces:      fetchLODESWorkplaces,
      analyzeCommutingFlows:     analyzeCommutingFlows,
      generateCommutingBoundary: generateCommutingBoundary,
      getJustificationData:      getJustificationData
    };
  }

}());
