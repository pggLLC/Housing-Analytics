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

    // Frequency score: based on nearby routes with headway <= HIGH_FREQUENCY_MIN
    var nearbyRoutes = (routes || []).filter(function (r) {
      var stops = r.stops || [];
      return stops.some(function (s) {
        return haversine(siteLat, siteLon, toNum(s.lat), toNum(s.lon)) <= WALK_TO_TRANSIT_MILES;
      });
    });

    var highFreqCount = nearbyRoutes.filter(function (r) {
      return toNum(r.headwayMinutes || 60) <= HIGH_FREQUENCY_MIN;
    }).length;
    var freqScore = nearbyRoutes.length
      ? clamp((highFreqCount / nearbyRoutes.length) * 100 + (nearbyRoutes.length > 2 ? 20 : 0), 0, 100)
      : 0;

    // Coverage score: number of distinct routes within walk distance
    var coverageScore = clamp(nearbyRoutes.length * 15, 0, 100);

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

    // Store data availability for justification
    _lastDataSources = {
      routeData: hasRoutes ? 'local-gtfs' : 'none',
      epaData: hasEpa ? epaSource : 'unavailable',
      walkData: hasWalk ? epaSource : 'unavailable',
      nearbyRouteCount: nearbyRoutes.length
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
            headway:   toNum(r.headwayMinutes || 60),
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
        return toNum(r.headwayMinutes || 60) <= HIGH_FREQUENCY_MIN;
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
