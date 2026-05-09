/**
 * js/pma-transit.js
 * Transit accessibility weighting for PMA delineation.
 *
 * Responsibilities:
 *  - fetchNTDData(boundingBox) — National Transit Database service levels
 *  - fetchEPASmartLocation(boundingBox) — EPA transit accessibility metrics
 *  - calculateTransitScore(siteLat, siteLon, routes, epaData) — 0–100 score
 *  - identifyTransitDeserts(pmaPolygon, routes) — gaps in service
 *  - getTransitLayer() — GeoJSON layer for map display
 *  - getTransitJustification() — audit-ready transit metrics
 *
 * Exposed as window.PMATransit.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var EARTH_RADIUS_MI      = 3958.8;
  var WALK_TO_TRANSIT_MILES = 0.5;   // half-mile walk catchment standard
  var HIGH_FREQUENCY_MIN   = 15;     // headway ≤ 15 min = high frequency
  var DESERT_RADIUS_MILES  = 1;      // grid cell size for desert detection

  /* ── Distance-decay tiers for transit accessibility ─────────────────
   *
   * Pre-2026-05-09 the transit score used a binary catchment: any route
   * stop > 0.5 mi from site → 0 transit credit. That punished rural CO
   * sites with intercity bus access (e.g. a Bustang stop 1.5 mi away)
   * even when they had real transit access. With #781 expanding agency
   * coverage from 4 to 55 (Mountain Metro, Pueblo Transit, RFTA, etc.),
   * the binary catchment had become the limiting factor on accuracy.
   *
   * Distance-decay model (each route counted at the credit of the
   * nearest tier it qualifies for):
   *
   *   ≤ 0.5 mi        →  100% credit  (urban walk catchment, unchanged)
   *   0.5–2 mi        →   50% credit  (bike or drop-off pattern)
   *   2–5 mi          →   20% credit  (drive-and-ride pattern, common rural)
   *   > 5 mi          →    0% credit  (no meaningful access)
   *
   * Urban scoring is unchanged at the 0.5-mi tier — the 0.5–2 / 2–5 mi
   * tiers add credit only for sites that previously scored 0. Rural
   * Bustang corridor sites should now register a real transit score.
   */
  var DISTANCE_DECAY_TIERS = [
    { maxMiles: 0.5, credit: 1.00, label: 'walk' },
    { maxMiles: 2.0, credit: 0.50, label: 'bike/drop-off' },
    { maxMiles: 5.0, credit: 0.20, label: 'drive-and-ride' }
    // beyond 5.0: not counted (implicit 0)
  ];

  /* ── Score weights ────────────────────────────────────────────────── */
  var TRANSIT_WEIGHTS = {
    frequency:   0.35,  // service headway
    coverage:    0.30,  // route density near site
    epaIndex:    0.25,  // EPA Smart Location transit accessibility index
    walkScore:   0.10   // pedestrian environment
  };

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastRoutes       = [];
  var lastEpaData      = null;
  var lastScore        = 0;
  var lastWalkScore    = 0;
  var lastDeserts      = [];

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

  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Fetch National Transit Database service level data.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{transitRoutes: Array, serviceMetrics: object}>}
   */
  function fetchNTDData(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchNTDData === 'function') {
      return ds.fetchNTDData(boundingBox);
    }
    return Promise.resolve({ transitRoutes: [], serviceMetrics: {} });
  }

  /**
   * Fetch EPA Smart Location Database transit accessibility metrics.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{transitAccessibility: number, walkScore: number}>}
   */
  function fetchEPASmartLocation(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchEPASmartLocation === 'function') {
      return ds.fetchEPASmartLocation(boundingBox);
    }
    // FALLBACK: DataService.fetchEPASmartLocation unavailable. Using neutral values 50 until EPA Smart Location data is wired.
    return Promise.resolve({ transitAccessibility: 50, walkScore: 50 });
  }

  /**
   * Calculate a comprehensive 0–100 transit accessibility score.
   * When EPA data is unavailable (null values from failed API), the score
   * is based solely on local route data and flagged accordingly.
   *
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {Array}  routes   - Transit routes with stops/headways
   * @param {object} epaData  - EPA Smart Location metrics (may have null values)
   * @returns {number} 0–100 score
   */
  function calculateTransitScore(siteLat, siteLon, routes, epaData) {
    routes  = routes  || lastRoutes;
    epaData = epaData || lastEpaData || {};

    lastRoutes  = routes;
    lastEpaData = epaData;

    // Track which data sources are available
    var hasRoutes = routes && routes.length > 0;
    var epaSource = epaData._dataSource || '';
    var epaAvail  = epaSource === 'epa-live' || epaSource === 'epa-sld-local';
    var hasEpa = epaData.transitAccessibility != null && epaAvail;
    var hasWalk = epaData.walkScore != null && epaAvail;

    // For each route, compute the minimum distance from site to any stop
    // and assign a credit weight based on the distance-decay tier.
    // Returns objects: { route, minDist, credit, tier }
    var weightedRoutes = (routes || [])
      .map(function (r) {
        var stops = r.stops || [];
        if (!stops.length) { return null; }
        var minDist = Infinity;
        for (var i = 0; i < stops.length; i++) {
          var d = haversine(siteLat, siteLon, toNum(stops[i].lat), toNum(stops[i].lon));
          if (d < minDist) { minDist = d; }
        }
        // Find the tightest distance tier this route qualifies for
        for (var t = 0; t < DISTANCE_DECAY_TIERS.length; t++) {
          if (minDist <= DISTANCE_DECAY_TIERS[t].maxMiles) {
            return {
              route:    r,
              minDist:  minDist,
              credit:   DISTANCE_DECAY_TIERS[t].credit,
              tier:     DISTANCE_DECAY_TIERS[t].label
            };
          }
        }
        return null;  // beyond all tiers (>5 mi)
      })
      .filter(function (x) { return x !== null; });

    // Backward-compat: `nearbyRoutes` retains the original "within
    // walk distance" semantics so any external consumer that reads
    // _lastDataSources.nearbyRouteCount sees the urban-catchment count,
    // not the inflated decay-weighted count.
    var nearbyRoutes = weightedRoutes
      .filter(function (w) { return w.minDist <= WALK_TO_TRANSIT_MILES; })
      .map(function (w) { return w.route; });

    // Headway proxy: total credit-weighted "route count equivalent" of
    // routes that qualify as high-frequency. Sites with a few high-freq
    // routes within walking distance score the same as before; rural
    // sites with intercity bus 2 mi away contribute partial credit.
    var highFreqCredit = weightedRoutes
      .filter(function (w) {
        return w.route.headwayMinutes != null &&
               toNum(w.route.headwayMinutes) <= HIGH_FREQUENCY_MIN;
      })
      .reduce(function (sum, w) { return sum + w.credit; }, 0);

    // Total credit-weighted route count across all distance tiers
    var totalCredit = weightedRoutes.reduce(
      function (sum, w) { return sum + w.credit; }, 0
    );

    // Frequency score: ABSOLUTE credit-weighted high-frequency routes.
    // Pre-distance-decay this was a ratio (highFreq / total), which made
    // a single far high-frequency route score identical to a single near
    // high-freq route — defeating the point of the decay tiers. Switching
    // to absolute scaling so the urban-vs-rural gap reflects credit:
    //   1 walk-tier high-freq route   → 30 pts
    //   3 walk-tier high-freq routes  → 90 pts (+ bonus)
    //   1 drive-and-ride high-freq    →  6 pts (20% credit)
    var freqScore = clamp(
      highFreqCredit * 30 + (totalCredit > 2 ? 20 : 0),
      0, 100
    );

    // Coverage score: 15 points per credit-weighted route equivalent
    // (matches prior scaling: 7 routes within walk distance → 100).
    // Now naturally rewards rural sites with multiple distant routes
    // without overweighting them vs urban sites.
    var coverageScore = clamp(totalCredit * 15, 0, 100);

    // EPA index — use real data if available, otherwise exclude from weighting
    var epaScore = 0;
    var walkScore = 0;
    var effectiveWeights = Object.assign({}, TRANSIT_WEIGHTS);

    if (hasEpa) {
      var epaRaw  = toNum(epaData.transitAccessibility || epaData.D4a);
      epaScore = epaRaw <= 20 ? clamp(epaRaw * 5, 0, 100) : clamp(epaRaw, 0, 100);
    } else {
      // Redistribute EPA weight to frequency and coverage
      effectiveWeights.frequency += effectiveWeights.epaIndex / 2;
      effectiveWeights.coverage  += effectiveWeights.epaIndex / 2;
      effectiveWeights.epaIndex   = 0;
    }

    if (hasWalk) {
      var walkRaw = toNum(epaData.walkScore || epaData.D3b);
      walkScore = walkRaw <= 20 ? clamp(walkRaw * 5, 0, 100) : clamp(walkRaw, 0, 100);
    } else {
      // Redistribute walk weight to frequency and coverage
      effectiveWeights.frequency += effectiveWeights.walkScore / 2;
      effectiveWeights.coverage  += effectiveWeights.walkScore / 2;
      effectiveWeights.walkScore  = 0;
    }
    lastWalkScore = walkScore;

    lastScore = Math.round(
      effectiveWeights.frequency * freqScore  +
      effectiveWeights.coverage  * coverageScore +
      effectiveWeights.epaIndex  * epaScore   +
      effectiveWeights.walkScore * walkScore
    );

    // Store data availability for justification + tier breakdown
    // for the audit trail. Tier counts let downstream UIs explain
    // "site has 1 route walkable + 3 routes drive-and-ride" rather
    // than just a single number.
    var tierCounts = { walk: 0, 'bike/drop-off': 0, 'drive-and-ride': 0 };
    weightedRoutes.forEach(function (w) {
      if (tierCounts[w.tier] != null) { tierCounts[w.tier] += 1; }
    });
    _lastDataSources = {
      routeData:        hasRoutes ? 'local-gtfs' : 'none',
      epaData:          hasEpa ? epaSource : 'unavailable',
      walkData:         hasWalk ? epaSource : 'unavailable',
      nearbyRouteCount: nearbyRoutes.length,        // walk-tier only (back-compat)
      totalRouteCount:  weightedRoutes.length,      // all tiers combined
      tierBreakdown:    tierCounts,                 // walk / bike / drive-and-ride counts
      totalCredit:      Math.round(totalCredit * 100) / 100  // credit-weighted equivalent
    };

    return clamp(lastScore, 0, 100);
  }

  var _lastDataSources = {};

  /**
   * Identify transit deserts — zones within the PMA that lack route coverage.
   * Uses a grid-based approach: cells without a nearby route are "deserts".
   *
   * @param {object} pmaPolygon - GeoJSON Polygon geometry
   * @param {Array}  routes
   * @returns {Array} desert zone descriptors
   */
  function identifyTransitDeserts(pmaPolygon, routes) {
    routes = routes || lastRoutes;
    if (!pmaPolygon || !routes) { return []; }

    var coords = (pmaPolygon.coordinates && pmaPolygon.coordinates[0]) || [];
    if (!coords.length) { return []; }

    // Compute PMA bounding box
    var lats = coords.map(function (c) { return c[1]; });
    var lons = coords.map(function (c) { return c[0]; });
    var minLat = Math.min.apply(null, lats);
    var maxLat = Math.max.apply(null, lats);
    var minLon = Math.min.apply(null, lons);
    var maxLon = Math.max.apply(null, lons);

    var stepDeg = DESERT_RADIUS_MILES / 69.0;
    var deserts = [];

    for (var lat = minLat; lat <= maxLat; lat += stepDeg) {
      for (var lon = minLon; lon <= maxLon; lon += stepDeg) {
        // Check if any route stop is within walk distance
        var served = routes.some(function (r) {
          return (r.stops || []).some(function (s) {
            return haversine(lat, lon, toNum(s.lat), toNum(s.lon)) <= WALK_TO_TRANSIT_MILES;
          });
        });
        if (!served) {
          deserts.push({ lat: lat, lon: lon, type: 'transit-desert' });
        }
      }
    }

    lastDeserts = deserts;
    return deserts;
  }

  /**
   * Build a GeoJSON FeatureCollection for the transit route layer.
   * @param {Array} [routes]
   * @returns {object} GeoJSON FeatureCollection
   */
  function getTransitLayer(routes) {
    routes = routes || lastRoutes;
    var features = (routes || []).map(function (r) {
      var stops = (r.stops || []).map(function (s) {
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [toNum(s.lon), toNum(s.lat)] },
          properties: {
            routeId:   r.routeId || r.id || 'unknown',
            routeName: r.name || r.routeName || 'Transit Route',
            // Pass through null when headway is unknown rather than
            // fabricating a 60-minute default. Map layers / downstream
            // consumers should render "—" for null.
            headway:   r.headwayMinutes != null ? toNum(r.headwayMinutes) : null,
            mode:      r.mode || 'Bus'
          }
        };
      });
      return stops;
    }).reduce(function (acc, val) { return acc.concat(val); }, []);

    return { type: 'FeatureCollection', features: features };
  }

  /**
   * Export transit analysis for ScoreRun audit trail.
   * Includes _dataSources so the UI can distinguish real vs. unavailable data.
   * @returns {object}
   */
  function getTransitJustification() {
    var epaAvailable = _lastDataSources.epaData === 'epa-live' || _lastDataSources.epaData === 'epa-sld-local';
    var walkAvailable = _lastDataSources.walkData === 'epa-live' || _lastDataSources.walkData === 'epa-sld-local';
    var epa = lastEpaData || {};
    return {
      transitAccessibilityScore: lastScore,
      walkScore:                 lastWalkScore,
      walkScoreAvailable:        walkAvailable,
      epaDataAvailable:          epaAvailable,
      nearbyRouteCount:          _lastDataSources.nearbyRouteCount || lastRoutes.length,
      serviceGaps:               lastDeserts.length,
      hasHighFrequencyService:   lastRoutes.some(function (r) {
        // Only "known high-frequency" counts — unknown headways don't
        // get a manufactured 60-minute default that would exclude them
        // or (worse) falsely include them in the justification.
        return r.headwayMinutes != null && toNum(r.headwayMinutes) <= HIGH_FREQUENCY_MIN;
      }),
      // Extended EPA SLD metrics (available when _dataSource is epa-sld-local)
      jobAccess:                 epa.jobAccess != null ? epa.jobAccess : null,
      landUseMix:                epa.landUseMix != null ? epa.landUseMix : null,
      empDensity:                epa.empDensity != null ? epa.empDensity : null,
      blockGroupCount:           epa.blockGroupCount || null,
      _dataSources: _lastDataSources
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMATransit = {
      fetchNTDData:            fetchNTDData,
      fetchEPASmartLocation:   fetchEPASmartLocation,
      calculateTransitScore:   calculateTransitScore,
      identifyTransitDeserts:  identifyTransitDeserts,
      getTransitLayer:         getTransitLayer,
      getTransitJustification: getTransitJustification,
      TRANSIT_WEIGHTS:         TRANSIT_WEIGHTS
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchNTDData:            fetchNTDData,
      fetchEPASmartLocation:   fetchEPASmartLocation,
      calculateTransitScore:   calculateTransitScore,
      identifyTransitDeserts:  identifyTransitDeserts,
      getTransitLayer:         getTransitLayer,
      getTransitJustification: getTransitJustification,
      TRANSIT_WEIGHTS:         TRANSIT_WEIGHTS
    };
  }

}());
