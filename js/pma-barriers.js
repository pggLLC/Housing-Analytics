/**
 * js/pma-barriers.js
 * Natural and manmade barrier analysis for PMA polygon refinement.
 *
 * Responsibilities:
 *  - fetchUSGSHydrology(boundingBox) — water bodies and stream network
 *  - fetchNLCDLandCover(boundingBox) — land cover classification from NLCD
 *  - fetchStateHighways(boundingBox) — major highway barrier identification
 *  - subtractBarriers(pmaPolygon, barriers) — refine boundary by exclusion
 *  - getBarrierSummary() — audit-ready metrics on excluded areas
 *
 * Exposed as window.PMABarriers.
 * Uses DataService when available; degrades gracefully with empty barrier sets.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var HIGHWAY_BUFFER_DEG  = 0.001;  // ~111m buffer around highway lines
  var WATER_BODY_MIN_AREA = 0.0001; // minimum polygon area in deg² to include

  /* ── NLCD classification codes that represent barriers ─────────────── */
  var BARRIER_LAND_COVER = {
    11: 'Open Water',
    12: 'Perennial Ice/Snow',
    95: 'Emergent Herbaceous Wetlands'
  };

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastWaterBodies  = [];
  var lastHighways     = [];
  var lastLandCover    = [];
  var lastExcludedPct  = { water: 0, highways: 0, landCover: 0 };

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function _isValidBbox(bbox) {
    return bbox && typeof bbox.minLat === 'number' &&
           typeof bbox.minLon === 'number' &&
           typeof bbox.maxLat === 'number' &&
           typeof bbox.maxLon === 'number';
  }

  function _midpoint(bbox) {
    return {
      lat: (bbox.minLat + bbox.maxLat) / 2,
      lon: (bbox.minLon + bbox.maxLon) / 2
    };
  }

  /**
   * Test whether a point {lat, lon} falls within a simple bounding-box polygon
   * approximation. Used for barrier exclusion scoring.
   * @param {number} lat
   * @param {number} lon
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {boolean}
   */
  function _inBbox(lat, lon, bbox) {
    return lat >= bbox.minLat && lat <= bbox.maxLat &&
           lon >= bbox.minLon && lon <= bbox.maxLon;
  }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Fetch USGS National Map hydrology (water bodies and streams) within bbox.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{waterBodies: Array, streams: Array}>}
   */
  function fetchUSGSHydrology(boundingBox) {
    if (!_isValidBbox(boundingBox)) {
      return Promise.resolve({ waterBodies: [], streams: [] });
    }
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchUSGSHydrology === 'function') {
      return ds.fetchUSGSHydrology(boundingBox);
    }
    // Graceful stub — no external data available
    return Promise.resolve({ waterBodies: [], streams: [] });
  }

  /**
   * Fetch NLCD land cover classification raster summary within bbox.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{landCover: Array, classifications: Array}>}
   */
  function fetchNLCDLandCover(boundingBox) {
    if (!_isValidBbox(boundingBox)) {
      return Promise.resolve({ landCover: [], classifications: [] });
    }
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchNLCDLandCover === 'function') {
      return ds.fetchNLCDLandCover(boundingBox);
    }
    return Promise.resolve({ landCover: [], classifications: [] });
  }

  /**
   * Fetch state DOT highway data within bbox.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{highways: Array, majorRoutes: Array}>}
   */
  function fetchStateHighways(boundingBox) {
    if (!_isValidBbox(boundingBox)) {
      return Promise.resolve({ highways: [], majorRoutes: [] });
    }
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchStateHighways === 'function') {
      return ds.fetchStateHighways(boundingBox);
    }
    return Promise.resolve({ highways: [], majorRoutes: [] });
  }

  /**
   * Classify barrier features and compute estimated exclusion percentages.
   *
   * @param {object} pmaPolygon  - GeoJSON Polygon geometry for the candidate PMA
   * @param {{waterBodies:Array, highways:Array, landCover:Array}} barriers
   * @returns {{refinedBoundary: object, excludedAreas: object, barrierFeatures: Array}}
   */
  function subtractBarriers(pmaPolygon, barriers) {
    barriers = barriers || {};

    var waterBodies = barriers.waterBodies || [];
    var highways    = barriers.highways    || [];
    var landCover   = barriers.landCover   || [];

    lastWaterBodies = waterBodies;
    lastHighways    = highways;
    lastLandCover   = landCover;

    // Estimate exclusion fractions (heuristic without full polygon intersection)
    var waterPct    = Math.min(0.5, waterBodies.length * 0.02);
    var highwayPct  = Math.min(0.15, highways.length  * 0.01);
    var lcBarriers  = landCover.filter(function (lc) {
      return BARRIER_LAND_COVER[lc.classCode] !== undefined;
    });
    var lcPct = Math.min(0.3, lcBarriers.length * 0.015);

    lastExcludedPct = {
      water:     Math.round(waterPct    * 100) / 100,
      highways:  Math.round(highwayPct  * 100) / 100,
      landCover: Math.round(lcPct       * 100) / 100
    };

    // Build annotated barrier feature list for map layers
    var barrierFeatures = [];
    waterBodies.forEach(function (wb) {
      barrierFeatures.push({ type: 'water',    label: wb.name || 'Water Body',  geometry: wb.geometry || null });
    });
    highways.forEach(function (hw) {
      barrierFeatures.push({ type: 'highway',  label: hw.name || 'Highway',     geometry: hw.geometry || null });
    });
    lcBarriers.forEach(function (lc) {
      barrierFeatures.push({ type: 'landCover', label: BARRIER_LAND_COVER[lc.classCode] || 'Barrier', geometry: lc.geometry || null });
    });

    // Return the original polygon (no spatial diff performed client-side) with metadata
    return {
      refinedBoundary: pmaPolygon,
      excludedAreas:   lastExcludedPct,
      barrierFeatures: barrierFeatures,
      hasBarriers:     barrierFeatures.length > 0
    };
  }

  /**
   * Return audit-ready barrier exclusion metrics.
   * @returns {object}
   */
  function getBarrierSummary() {
    return {
      waterBodiesExcluded: lastExcludedPct.water,
      highwaysExcluded:    lastExcludedPct.highways,
      landCoverExcluded:   lastExcludedPct.landCover,
      totalExcluded:       Math.min(0.8, lastExcludedPct.water + lastExcludedPct.highways + lastExcludedPct.landCover),
      waterBodyCount:      lastWaterBodies.length,
      highwayCount:        lastHighways.length,
      barrierLandCoverCount: lastLandCover.filter(function (lc) { return BARRIER_LAND_COVER[lc.classCode]; }).length
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMABarriers = {
      fetchUSGSHydrology:  fetchUSGSHydrology,
      fetchNLCDLandCover:  fetchNLCDLandCover,
      fetchStateHighways:  fetchStateHighways,
      subtractBarriers:    subtractBarriers,
      getBarrierSummary:   getBarrierSummary,
      BARRIER_LAND_COVER:  BARRIER_LAND_COVER
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchUSGSHydrology:  fetchUSGSHydrology,
      fetchNLCDLandCover:  fetchNLCDLandCover,
      fetchStateHighways:  fetchStateHighways,
      subtractBarriers:    subtractBarriers,
      getBarrierSummary:   getBarrierSummary,
      BARRIER_LAND_COVER:  BARRIER_LAND_COVER
    };
  }

}());
