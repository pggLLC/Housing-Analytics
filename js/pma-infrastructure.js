/**
 * js/pma-infrastructure.js
 * Infrastructure and environmental feasibility scorecard.
 *
 * Responsibilities:
 *  - fetchFEMAFloodData(boundingBox) — flood hazard zone coverage
 *  - fetchNOAAClimateData(location, variable) — extreme weather normals
 *  - fetchUtilityCapacity(boundingBox, jurisdiction) — sewer/water headroom
 *  - fetchFoodAccessAtlas(boundingBox) — food desert/proximity data
 *  - buildInfrastructureScorecard(floodData, climateData, utilityData, foodData)
 *  - getInfrastructureScore() — 0–100 composite feasibility score
 *  - getInfrastructureLayer() — GeoJSON for map display
 *  - getInfrastructureJustification() — audit-ready scorecard
 *
 * Exposed as window.PMAInfrastructure.
 */
(function () {
  'use strict';

  /* ── Score weights ────────────────────────────────────────────────── */
  var INFRA_WEIGHTS = {
    floodRisk:    0.30,  // inverse: lower flood risk = higher score
    climate:      0.20,
    utility:      0.25,
    foodAccess:   0.25
  };

  /* ── Risk thresholds ──────────────────────────────────────────────── */
  var HIGH_FLOOD_PCT       = 0.25;  // >25 % AE/AO zone = high risk
  var UTILITY_CAPACITY_MIN = 0.20;  // <20 % headroom = at capacity

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastFloodRiskPct      = 0;
  var lastClimateScore      = 50; // FALLBACK: neutral value until NOAA climate data is loaded
  var lastUtilityScore      = 50; // FALLBACK: neutral value until utility capacity data is loaded
  var lastFoodAccessScore   = 50; // FALLBACK: neutral value until USDA food access data is loaded
  var lastCompositeScore    = 50; // FALLBACK: neutral value until buildInfrastructureScorecard runs
  var lastSewerAdequate     = true;
  var lastScorecard         = null;

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Fetch FEMA flood hazard zone data for a bounding box.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{floodZones: Array, hazardPercent: number}>}
   */
  function fetchFEMAFloodData(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchFEMAFloodData === 'function') {
      return ds.fetchFEMAFloodData(boundingBox);
    }
    // Try the existing FemaFlood connector if available
    var ff = (typeof window !== 'undefined') ? window.FemaFlood : null;
    if (ff && typeof ff.getFloodRisk === 'function') {
      var mid = boundingBox
        ? { lat: (boundingBox.minLat + boundingBox.maxLat) / 2, lon: (boundingBox.minLon + boundingBox.maxLon) / 2 }
        : { lat: 39.5, lon: -104.9 };
      var result = ff.getFloodRisk(mid.lat, mid.lon);
      return Promise.resolve({ floodZones: [], hazardPercent: result ? (100 - result.score) / 100 : 0.05 });
    }
    return Promise.resolve({ floodZones: [], hazardPercent: 0.05 });
  }

  /**
   * Fetch NOAA climate data for a location.
   * @param {{lat:number,lon:number}} location
   * @param {string} [climateVariable] - e.g. "precipitation", "temperature"
   * @returns {Promise<{normals: object, extremes: object, resilienceScore: number}>}
   */
  function fetchNOAAClimateData(location, climateVariable) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchNOAAClimateData === 'function') {
      return ds.fetchNOAAClimateData(location, climateVariable || 'all');
    }
    // FALLBACK: DataService.fetchNOAAClimateData unavailable. Using neutral resilienceScore 50 until a live NOAA or cached climate endpoint is wired.
    return Promise.resolve({ normals: {}, extremes: {}, resilienceScore: 50 });
  }

  /**
   * Fetch local utility infrastructure capacity data.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @param {string} [jurisdiction]
   * @returns {Promise<{sewerHeadroom: number, waterCapacity: number}>}
   */
  function fetchUtilityCapacity(boundingBox, jurisdiction) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchUtilityCapacity === 'function') {
      return ds.fetchUtilityCapacity(boundingBox, jurisdiction || '');
    }
    // FALLBACK: DataService.fetchUtilityCapacity unavailable. Using neutral fractions 0.5 (50% headroom) until a utility-capacity data source is wired.
    return Promise.resolve({ sewerHeadroom: 0.5, waterCapacity: 0.5 });
  }

  /**
   * Fetch USDA Food Access Atlas data.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{foodDeserts: Array, proximityIndex: number}>}
   */
  function fetchFoodAccessAtlas(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchFoodAccessAtlas === 'function') {
      return ds.fetchFoodAccessAtlas(boundingBox);
    }
    // FALLBACK: DataService.fetchFoodAccessAtlas unavailable. Using neutral proximityIndex 50 until USDA Food Access Atlas data is wired.
    return Promise.resolve({ foodDeserts: [], proximityIndex: 50 });
  }

  /**
   * Build a comprehensive infrastructure feasibility scorecard.
   *
   * @param {object} floodData   - {hazardPercent: 0–1}
   * @param {object} climateData - {resilienceScore: 0–100}
   * @param {object} utilityData - {sewerHeadroom: 0–1, waterCapacity: 0–1}
   * @param {object} foodData    - {proximityIndex: 0–100}
   * @returns {object} scorecard with per-component scores and composite
   */
  function buildInfrastructureScorecard(floodData, climateData, utilityData, foodData) {
    floodData   = floodData   || {};
    climateData = climateData || {};
    utilityData = utilityData || {};
    foodData    = foodData    || {};

    // Track which data sources are real vs. stub
    var _stubSources = [];
    var _realSources = [];

    // Flood risk: inverse scale — lower hazard % = higher score
    var floodIsStub = floodData._stub || (!floodData.floodZones || !floodData.floodZones.length);
    lastFloodRiskPct = clamp(
      floodData.hazardPercent != null ? toNum(floodData.hazardPercent) : 0.05,
      0, 1
    );
    var floodScore = clamp(Math.round((1 - lastFloodRiskPct) * 100), 0, 100);
    if (floodIsStub && floodData.hazardPercent === 0.05) {
      // Default value from failed API — mark as unavailable
      _stubSources.push('flood');
    } else {
      _realSources.push('flood');
    }

    // Climate resilience (already 0–100 or convert from raw)
    var climateIsStub = climateData._stub || (climateData.resilienceScore === 50 && !climateData.normals);
    var climateRaw = toNum(climateData.resilienceScore != null ? climateData.resilienceScore : 50);
    lastClimateScore = clamp(climateRaw <= 1 ? climateRaw * 100 : climateRaw, 0, 100);
    if (climateIsStub) {
      _stubSources.push('climate');
    } else {
      _realSources.push('climate');
    }

    // Utility capacity: headroom fraction -> score
    var utilityIsStub = utilityData._stub || (utilityData.sewerHeadroom == null);
    if (utilityIsStub) {
      // No real data — set neutral but flag it
      lastUtilityScore = null;
      lastSewerAdequate = null;
      _stubSources.push('utility');
    } else {
      var sewerHeadroom  = clamp(toNum(utilityData.sewerHeadroom), 0, 1);
      var waterCapacity  = clamp(toNum(utilityData.waterCapacity), 0, 1);
      lastSewerAdequate  = sewerHeadroom >= UTILITY_CAPACITY_MIN;
      lastUtilityScore   = clamp(Math.round(((sewerHeadroom + waterCapacity) / 2) * 100), 0, 100);
      _realSources.push('utility');
    }

    // Food access (0–100 proximity index)
    var foodIsStub = foodData._stub || (foodData.proximityIndex == null);
    if (foodIsStub) {
      lastFoodAccessScore = null;
      _stubSources.push('foodAccess');
    } else {
      var foodRaw = toNum(foodData.proximityIndex);
      lastFoodAccessScore = clamp(foodRaw <= 1 ? foodRaw * 100 : foodRaw, 0, 100);
      _realSources.push('foodAccess');
    }

    // Composite weighted score — only include dimensions with real data
    var totalWeight = 0;
    var weightedSum = 0;

    if (_realSources.indexOf('flood') !== -1) {
      totalWeight += INFRA_WEIGHTS.floodRisk;
      weightedSum += INFRA_WEIGHTS.floodRisk * floodScore;
    }
    if (_realSources.indexOf('climate') !== -1) {
      totalWeight += INFRA_WEIGHTS.climate;
      weightedSum += INFRA_WEIGHTS.climate * lastClimateScore;
    }
    if (lastUtilityScore != null) {
      totalWeight += INFRA_WEIGHTS.utility;
      weightedSum += INFRA_WEIGHTS.utility * lastUtilityScore;
    }
    if (lastFoodAccessScore != null) {
      totalWeight += INFRA_WEIGHTS.foodAccess;
      weightedSum += INFRA_WEIGHTS.foodAccess * lastFoodAccessScore;
    }

    lastCompositeScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;

    lastScorecard = {
      floodRiskPercent:       Math.round(lastFloodRiskPct * 100) / 100,
      floodScore:             floodScore,
      climateResilienceScore: lastClimateScore,
      sewerCapacityAdequate:  lastSewerAdequate,
      utilityScore:           lastUtilityScore,
      foodAccessScore:        lastFoodAccessScore,
      compositeScore:         lastCompositeScore != null ? clamp(lastCompositeScore, 0, 100) : null,
      flags: {
        highFloodRisk:        lastFloodRiskPct > HIGH_FLOOD_PCT,
        utilityAtCapacity:    lastSewerAdequate === false,
        foodDesertPresent:    (foodData.foodDeserts || []).length > 0
      },
      _dataAvailability: {
        realSources: _realSources,
        stubSources: _stubSources,
        coverageRatio: _realSources.length / (_realSources.length + _stubSources.length)
      }
    };

    return lastScorecard;
  }

  /**
   * Return the latest composite infrastructure feasibility score (0–100).
   * @returns {number}
   */
  function getInfrastructureScore() {
    if (!lastScorecard) return null;
    return lastScorecard.compositeScore != null ? clamp(lastScorecard.compositeScore, 0, 100) : null;
  }

  /**
   * Build GeoJSON FeatureCollection for the infrastructure map layer.
   * @param {Array} [floodZones]
   * @param {Array} [foodDeserts]
   * @returns {object}
   */
  function getInfrastructureLayer(floodZones, foodDeserts) {
    var features = [];
    (floodZones || []).forEach(function (z) {
      if (z.lat && z.lon) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [toNum(z.lon), toNum(z.lat)] },
          properties: { type: 'flood', zone: z.zone || 'AE', label: 'Flood Zone ' + (z.zone || 'AE') }
        });
      }
    });
    (foodDeserts || []).forEach(function (fd) {
      if (fd.lat && fd.lon) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [toNum(fd.lon), toNum(fd.lat)] },
          properties: { type: 'food-desert', label: 'Food Desert', lowAccess: true }
        });
      }
    });
    return { type: 'FeatureCollection', features: features };
  }

  /**
   * Export infrastructure scorecard for ScoreRun audit trail.
   * @returns {object}
   */
  function getInfrastructureJustification() {
    return lastScorecard
      ? Object.assign({}, lastScorecard)
      : {
          floodRiskPercent:       lastFloodRiskPct,
          climateResilienceScore: lastClimateScore,
          sewerCapacityAdequate:  lastSewerAdequate,
          foodAccessScore:        lastFoodAccessScore,
          compositeScore:         lastCompositeScore
        };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMAInfrastructure = {
      fetchFEMAFloodData:            fetchFEMAFloodData,
      fetchNOAAClimateData:          fetchNOAAClimateData,
      fetchUtilityCapacity:          fetchUtilityCapacity,
      fetchFoodAccessAtlas:          fetchFoodAccessAtlas,
      buildInfrastructureScorecard:  buildInfrastructureScorecard,
      getInfrastructureScore:        getInfrastructureScore,
      getInfrastructureLayer:        getInfrastructureLayer,
      getInfrastructureJustification: getInfrastructureJustification,
      INFRA_WEIGHTS:                 INFRA_WEIGHTS
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchFEMAFloodData:            fetchFEMAFloodData,
      fetchNOAAClimateData:          fetchNOAAClimateData,
      fetchUtilityCapacity:          fetchUtilityCapacity,
      fetchFoodAccessAtlas:          fetchFoodAccessAtlas,
      buildInfrastructureScorecard:  buildInfrastructureScorecard,
      getInfrastructureScore:        getInfrastructureScore,
      getInfrastructureLayer:        getInfrastructureLayer,
      getInfrastructureJustification: getInfrastructureJustification,
      INFRA_WEIGHTS:                 INFRA_WEIGHTS
    };
  }

}());
