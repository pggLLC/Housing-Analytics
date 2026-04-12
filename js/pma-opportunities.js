/**
 * js/pma-opportunities.js
 * Opportunity and incentive overlay analysis for PMA scoring.
 *
 * Responsibilities:
 *  - fetchOpportunityZones(boundingBox) — IRS QOZ dataset
 *  - fetchHudAFFH(boundingBox) — HUD AFFH fair housing opportunity index
 *  - fetchHudOpportunityAtlas(boundingBox) — economic mobility percentiles
 *  - calculateOpportunityShare(pmaPolygon, ozZones) — % area in OZ
 *  - scoreOpportunityIndex(lat, lon, affhData, atlasData) — 0–100 composite
 *  - determineIncentiveEligibility(opportunityShare, affhScore, atlasPercentile)
 *  - getOpportunityLayer() — GeoJSON for map display
 *  - getOpportunityJustification() — audit-ready opportunity metrics
 *
 * Exposed as window.PMAOpportunities.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var OZ_BASIS_STEP_DOWN_THRESHOLD = 0.20; // >20 % OZ area → LIHTC basis eligible
  var NMTC_SCORE_THRESHOLD         = 50;   // AFFH or atlas score < 50 → NMTC eligible
  var EARTH_RADIUS_MI              = 3958.8;

  /* ── Score weights ────────────────────────────────────────────────── */
  var OPP_WEIGHTS = {
    opportunityZone: 0.30,
    fairHousing:     0.35,
    economicMobility: 0.35
  };

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastOzShare         = 0;
  var lastFairHousingScore = 50;
  var lastMobilityPct     = 50;
  var lastOpportunityScore = 50;
  var lastEligibility     = {};

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /**
   * Estimate the fraction of a bounding box that overlaps a list of OZ features.
   * Uses a point-in-bbox approximation proportional to zone count.
   * @private
   */
  function _estimateOzShare(bbox, ozZones) {
    if (!ozZones || !ozZones.length || !bbox) return 0;
    var bboxArea = Math.abs((bbox.maxLon - bbox.minLon) * (bbox.maxLat - bbox.minLat));
    if (bboxArea === 0) return 0;
    var overlapCount = ozZones.filter(function (z) {
      var zLat = toNum(z.lat || z.centroidLat || (bbox.minLat + bbox.maxLat) / 2);
      var zLon = toNum(z.lon || z.centroidLon || (bbox.minLon + bbox.maxLon) / 2);
      return zLat >= bbox.minLat && zLat <= bbox.maxLat &&
             zLon >= bbox.minLon && zLon <= bbox.maxLon;
    }).length;
    // Rough share: proportion of OZ features within bbox × typical OZ area fraction
    return clamp(overlapCount / Math.max(ozZones.length, 1) * 0.8, 0, 1);
  }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Fetch Opportunity Zones dataset for a bounding box.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{zones: Array, designationYear: Array}>}
   */
  function fetchOpportunityZones(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchOpportunityZones === 'function') {
      return ds.fetchOpportunityZones(boundingBox);
    }
    return Promise.resolve({ zones: [], designationYear: [] });
  }

  /**
   * Fetch HUD AFFH fair housing opportunity index data.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{opportunityIndex: number, segregationMetrics: object}>}
   */
  function fetchHudAFFH(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchHudAFFH === 'function') {
      return ds.fetchHudAFFH(boundingBox);
    }
    return Promise.resolve({ opportunityIndex: 50, segregationMetrics: {} });
  }

  /**
   * Fetch HUD Opportunity Atlas economic mobility indicators.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{mobilityIndex: number, percentiles: Array}>}
   */
  function fetchHudOpportunityAtlas(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchHudOpportunityAtlas === 'function') {
      return ds.fetchHudOpportunityAtlas(boundingBox);
    }
    return Promise.resolve({ mobilityIndex: 50, percentiles: [] });
  }

  /**
   * Calculate the fraction of the PMA polygon area that falls within
   * Opportunity Zones.
   *
   * @param {object} pmaPolygon - GeoJSON Polygon geometry
   * @param {Array}  ozZones    - OZ feature array from fetchOpportunityZones
   * @returns {number} share 0.0–1.0
   */
  function calculateOpportunityShare(pmaPolygon, ozZones) {
    ozZones = ozZones || [];
    if (!pmaPolygon || !ozZones.length) {
      lastOzShare = 0;
      return 0;
    }

    var coords = (pmaPolygon.coordinates && pmaPolygon.coordinates[0]) || [];
    if (!coords.length) { lastOzShare = 0; return 0; }

    var lats = coords.map(function (c) { return c[1]; });
    var lons = coords.map(function (c) { return c[0]; });
    var bbox = {
      minLat: Math.min.apply(null, lats),
      maxLat: Math.max.apply(null, lats),
      minLon: Math.min.apply(null, lons),
      maxLon: Math.max.apply(null, lons)
    };

    lastOzShare = Math.round(_estimateOzShare(bbox, ozZones) * 100) / 100;
    return lastOzShare;
  }

  /**
   * Compute a composite 0–100 opportunity index for a site location.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {object} affhData   - {opportunityIndex: number} from fetchHudAFFH
   * @param {object} atlasData  - {mobilityIndex: number} from fetchHudOpportunityAtlas
   * @returns {number} 0–100
   */
  function scoreOpportunityIndex(lat, lon, affhData, atlasData) {
    affhData  = affhData  || {};
    atlasData = atlasData || {};

    // Track which data sources are real vs. stub
    var affhIsStub  = affhData._stub  || affhData.opportunityIndex == null;
    var atlasIsStub = atlasData._stub || atlasData.mobilityIndex == null;

    lastFairHousingScore = affhIsStub  ? null : clamp(toNum(affhData.opportunityIndex), 0, 100);
    lastMobilityPct      = atlasIsStub ? null : clamp(toNum(atlasData.mobilityIndex), 0, 100);

    var ozScore = clamp(lastOzShare * 100, 0, 100);

    // Only include dimensions with real data in the composite
    var totalWeight = OPP_WEIGHTS.opportunityZone;
    var weightedSum = OPP_WEIGHTS.opportunityZone * ozScore;

    if (lastFairHousingScore != null) {
      totalWeight += OPP_WEIGHTS.fairHousing;
      weightedSum += OPP_WEIGHTS.fairHousing * lastFairHousingScore;
    }
    if (lastMobilityPct != null) {
      totalWeight += OPP_WEIGHTS.economicMobility;
      weightedSum += OPP_WEIGHTS.economicMobility * lastMobilityPct;
    }

    lastOpportunityScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;

    // Store data availability
    _lastDataSources = {
      affh: affhIsStub ? 'unavailable' : 'live',
      atlas: atlasIsStub ? 'unavailable' : 'live',
      opportunityZones: lastOzShare > 0 ? 'live' : 'none'
    };

    return lastOpportunityScore != null ? clamp(lastOpportunityScore, 0, 100) : 0;
  }

  var _lastDataSources = {};

  /**
   * Determine program incentive eligibility based on opportunity metrics.
   *
   * @param {number} opportunityShare - fraction of PMA in OZ (0–1)
   * @param {number} affhScore        - 0–100 fair housing score
   * @param {number} atlasPercentile  - 0–100 economic mobility percentile
   * @returns {{lihtcBasisStepDown: boolean, newMarketsTaxCredit: boolean, qualifiedOpportunityZone: boolean}}
   */
  function determineIncentiveEligibility(opportunityShare, affhScore, atlasPercentile) {
    opportunityShare = typeof opportunityShare === 'number' ? opportunityShare : lastOzShare;
    affhScore        = typeof affhScore        === 'number' ? affhScore        : lastFairHousingScore;
    atlasPercentile  = typeof atlasPercentile  === 'number' ? atlasPercentile  : lastMobilityPct;

    // NMTC eligibility requires real AFFH/Atlas data — do not grant based on stubs
    var canEvaluateNmtc = affhScore != null && atlasPercentile != null;

    lastEligibility = {
      lihtcBasisStepDown:    opportunityShare > OZ_BASIS_STEP_DOWN_THRESHOLD,
      newMarketsTaxCredit:   canEvaluateNmtc
        ? (affhScore < NMTC_SCORE_THRESHOLD || atlasPercentile < NMTC_SCORE_THRESHOLD)
        : false,  // Cannot determine without real data
      qualifiedOpportunityZone: opportunityShare > 0,
      _dataLimitations: canEvaluateNmtc ? [] : ['AFFH/Atlas data unavailable — NMTC eligibility cannot be confirmed']
    };
    return lastEligibility;
  }

  /**
   * Build GeoJSON FeatureCollection for opportunity overlay layer.
   * @param {Array} [ozZones]
   * @returns {object}
   */
  function getOpportunityLayer(ozZones) {
    var features = (ozZones || []).map(function (z) {
      var lat = toNum(z.lat || z.centroidLat || 0);
      var lon = toNum(z.lon || z.centroidLon || 0);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          censustract:      z.censusTract || z.GEOID || null,
          designationYear:  toNum(z.designationYear || 2018),
          state:            z.state || 'CO'
        }
      };
    });
    return { type: 'FeatureCollection', features: features };
  }

  /**
   * Export opportunity analysis for ScoreRun audit trail.
   * @returns {object}
   */
  function getOpportunityJustification() {
    return {
      opportunityZoneShare:      lastOzShare,
      fairHousingScore:          lastFairHousingScore,
      economicMobilityPercentile: lastMobilityPct,
      opportunityIndex:          lastOpportunityScore,
      incentiveEligibility:      Object.assign({}, lastEligibility),
      _dataSources: Object.assign({}, _lastDataSources)
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMAOpportunities = {
      fetchOpportunityZones:        fetchOpportunityZones,
      fetchHudAFFH:                 fetchHudAFFH,
      fetchHudOpportunityAtlas:     fetchHudOpportunityAtlas,
      calculateOpportunityShare:    calculateOpportunityShare,
      scoreOpportunityIndex:        scoreOpportunityIndex,
      determineIncentiveEligibility: determineIncentiveEligibility,
      getOpportunityLayer:          getOpportunityLayer,
      getOpportunityJustification:  getOpportunityJustification,
      OPP_WEIGHTS:                  OPP_WEIGHTS
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchOpportunityZones:        fetchOpportunityZones,
      fetchHudAFFH:                 fetchHudAFFH,
      fetchHudOpportunityAtlas:     fetchHudOpportunityAtlas,
      calculateOpportunityShare:    calculateOpportunityShare,
      scoreOpportunityIndex:        scoreOpportunityIndex,
      determineIncentiveEligibility: determineIncentiveEligibility,
      getOpportunityLayer:          getOpportunityLayer,
      getOpportunityJustification:  getOpportunityJustification,
      OPP_WEIGHTS:                  OPP_WEIGHTS
    };
  }

}());
