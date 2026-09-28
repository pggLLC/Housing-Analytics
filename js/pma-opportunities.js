/**
 * js/pma-opportunities.js
 * Opportunity and incentive overlay analysis for PMA scoring.
 *
 * Responsibilities:
 *  - fetchOpportunityZones() — tracked CDFI designation polygons
 *  - fetchHudAFFH(boundingBox) — HUD AFFH fair housing opportunity index
 *  - fetchHudOpportunityAtlas(boundingBox) — economic mobility percentiles
 *  - siteOpportunityZone(lat, lon, zones) — exact site point-in-polygon
 *  - scoreOpportunityIndex(lat, lon, affhData, atlasData, zones) — 0–100 composite
 *  - determineIncentiveEligibility(siteStatus)
 *  - getOpportunityLayer() — GeoJSON for map display
 *  - getOpportunityJustification() — audit-ready opportunity metrics
 *
 * Exposed as window.PMAOpportunities.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var OZ_PATH = 'data/market/opportunity_zones_co.geojson';

  /* ── Score weights ────────────────────────────────────────────────── */
  var OPP_WEIGHTS = {
    opportunityZone: 0.30,
    fairHousing:     0.35,
    economicMobility: 0.35
  };

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastSiteOz = siteOpportunityZone(null, null, null);
  var lastFairHousingScore = null;
  var lastMobilityPct = null;
  var lastOpportunityScore = null;

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // A ring returns 0 outside, 1 inside, or 2 on its boundary. Treat polygon
  // boundaries as included, and hole interiors as excluded.
  function pointInRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var a = ring[j], b = ring[i];
      var cross = (lon - a[0]) * (b[1] - a[1]) - (lat - a[1]) * (b[0] - a[0]);
      if (cross === 0 && lon >= Math.min(a[0], b[0]) && lon <= Math.max(a[0], b[0]) &&
          lat >= Math.min(a[1], b[1]) && lat <= Math.max(a[1], b[1])) return 2;
      if ((a[1] > lat) !== (b[1] > lat) &&
          lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside ? 1 : 0;
  }

  function pointInPolygon(lon, lat, rings) {
    var outer = pointInRing(lon, lat, rings[0]);
    if (outer !== 1) return outer === 2;
    for (var i = 1; i < rings.length; i++) {
      var hole = pointInRing(lon, lat, rings[i]);
      if (hole === 2) return true;
      if (hole === 1) return false;
    }
    return true;
  }

  function validPolygon(rings) {
    return Array.isArray(rings) && rings.length > 0 && rings.every(function (ring) {
      return Array.isArray(ring) && ring.length >= 4 && ring.every(function (p) {
        return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
      }) && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    });
  }

  /**
   * Check the exact site against CDFI designation polygons (GeoJSON or features).
   * Missing coordinates, missing data and invalid geometry are unknown, not out.
   * @returns {{inZone: boolean|null, geoid: string|null, unavailableReason: string|null,
   *            vintage: string|null, source_url: string|null}}
   */
  function siteOpportunityZone(lat, lon, zones) {
    var meta = (zones && zones.meta) || {};
    var result = { inZone: null, geoid: null, unavailableReason: null,
      vintage: meta.vintage || null, source_url: meta.source_url || null };
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      result.unavailableReason = 'Exact site coordinates are missing or invalid.';
      return result;
    }
    var features = Array.isArray(zones) ? zones : zones && zones.features;
    if (!features || !Array.isArray(features) || !features.length || zones.unavailableReason) {
      result.unavailableReason = (zones && zones.unavailableReason) || 'Opportunity Zone polygon data is unavailable.';
      return result;
    }
    var valid = features.filter(function (f) {
      var g = f && f.geometry;
      return g && (g.type === 'Polygon' ? validPolygon(g.coordinates) :
        g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length > 0 &&
          g.coordinates.every(validPolygon));
    });
    // Inside a valid polygon is conclusive whatever else is broken. Outside is
    // only conclusive when every polygon is valid: a broken one could hold the site.
    var match = valid.find(function (f) {
      var g = f.geometry;
      return g.type === 'Polygon' ? pointInPolygon(lon, lat, g.coordinates) :
        g.coordinates.some(function (rings) { return pointInPolygon(lon, lat, rings); });
    });
    if (!match && valid.length < features.length) {
      result.unavailableReason = 'Opportunity Zone polygon geometry is missing or invalid.';
      return result;
    }
    result.inZone = !!match;
    result.geoid = match ? ((match.properties || {}).geoid || (match.properties || {}).GEOID || null) : null;
    return result;
  }

  /* ── Core API ────────────────────────────────────────────────────── */

  /** Load the same tracked CDFI polygons as the map; preserve their metadata. */
  function fetchOpportunityZones() {
    var base = (typeof window !== 'undefined' && window.APP_BASE_PATH) || '';
    return Promise.resolve().then(function () {
      return fetch(base + OZ_PATH);
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).catch(function () {
      return { features: [], unavailableReason: 'Opportunity Zone polygon data could not be loaded.' };
    });
  }

  /**
   * Fetch HUD AFFH fair housing opportunity index data.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{opportunityIndex: number, segregationMetrics: object}>}
   */
  function fetchHudAFFH(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchHudAFFH === 'function') {
      return Promise.resolve().then(function () { return ds.fetchHudAFFH(boundingBox); })
        .catch(function () { return { opportunityIndex: null }; });
    }
    return Promise.resolve({ opportunityIndex: null, segregationMetrics: {} });
  }

  /**
   * Fetch HUD Opportunity Atlas economic mobility indicators.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{mobilityIndex: number, percentiles: Array}>}
   */
  function fetchHudOpportunityAtlas(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchHudOpportunityAtlas === 'function') {
      return Promise.resolve().then(function () { return ds.fetchHudOpportunityAtlas(boundingBox); })
        .catch(function () { return { mobilityIndex: null }; });
    }
    return Promise.resolve({ mobilityIndex: null, percentiles: [] });
  }

  /** PMA area share is not measured. Retained for existing API consumers. */
  function calculateOpportunityShare() {
    return null;
  }

  /**
   * Compute a composite 0–100 opportunity index for a site location.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {object} affhData   - {opportunityIndex: number} from fetchHudAFFH
   * @param {object} atlasData  - {mobilityIndex: number} from fetchHudOpportunityAtlas
   * @param {object} zones - tracked CDFI GeoJSON, including meta
   * @returns {number|null} 0–100, or null when every component is unavailable
   */
  function scoreOpportunityIndex(lat, lon, affhData, atlasData, zones) {
    affhData  = affhData  || {};
    atlasData = atlasData || {};

    // Track which data sources are real vs. stub
    var affhIsStub  = affhData._stub  || affhData.opportunityIndex == null;
    var atlasIsStub = atlasData._stub || atlasData.mobilityIndex == null;

    lastFairHousingScore = affhIsStub  ? null : clamp(toNum(affhData.opportunityIndex), 0, 100);
    lastMobilityPct      = atlasIsStub ? null : clamp(toNum(atlasData.mobilityIndex), 0, 100);

    lastSiteOz = siteOpportunityZone(lat, lon, zones);
    var ozScore = lastSiteOz.inZone === true ? 100 : lastSiteOz.inZone === false ? 0 : null;

    // Only include dimensions with real data in the composite
    var totalWeight = 0;
    var weightedSum = 0;
    if (ozScore !== null) {
      totalWeight += OPP_WEIGHTS.opportunityZone;
      weightedSum += OPP_WEIGHTS.opportunityZone * ozScore;
    }

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
      opportunityZones: ozScore === null ? 'unavailable' : 'tracked'
    };

    return lastOpportunityScore;
  }

  var _lastDataSources = {};

  /** Only exact-site OZ geography establishes this designation. */
  function determineIncentiveEligibility(siteStatus) {
    var inZone = siteStatus && siteStatus.inZone;
    return { qualifiedOpportunityZone: typeof inZone === 'boolean' ? inZone : null };
  }

  /**
   * Build GeoJSON FeatureCollection for opportunity overlay layer.
   * @param {Array} [ozZones]
   * @returns {object}
   */
  function getOpportunityLayer(ozZones) {
    var features = Array.isArray(ozZones) ? ozZones : (ozZones && ozZones.features) || [];
    return { type: 'FeatureCollection', features: features };
  }

  /**
   * Export opportunity analysis for ScoreRun audit trail.
   * @returns {object}
   */
  function getOpportunityJustification() {
    return {
      opportunityZoneShare:      null,
      siteOpportunityZone:      Object.assign({}, lastSiteOz),
      fairHousingScore:          lastFairHousingScore,
      economicMobilityPercentile: lastMobilityPct,
      opportunityIndex:          lastOpportunityScore,
      incentiveEligibility:      determineIncentiveEligibility(lastSiteOz),
      _dataSources: Object.assign({}, _lastDataSources)
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMAOpportunities = {
      fetchOpportunityZones:        fetchOpportunityZones,
      siteOpportunityZone:         siteOpportunityZone,
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
      siteOpportunityZone:         siteOpportunityZone,
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
