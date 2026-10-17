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

  /* ── Exclusion heuristic factors ─────────────────────────────────── */
  // Each factor represents the estimated fractional area exclusion per feature.
  // E.g. WATER_EXCLUSION_FACTOR = 0.02 assumes each water body covers ~2 % of PMA area.
  var WATER_EXCLUSION_FACTOR    = 0.02;
  var HIGHWAY_EXCLUSION_FACTOR  = 0.01;
  var LAND_COVER_EXCLUSION_FACTOR = 0.015;

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
    var waterPct    = Math.min(0.5, waterBodies.length * WATER_EXCLUSION_FACTOR);
    var highwayPct  = Math.min(0.15, highways.length  * HIGHWAY_EXCLUSION_FACTOR);
    var lcBarriers  = landCover.filter(function (lc) {
      return BARRIER_LAND_COVER[lc.classCode] !== undefined;
    });
    var lcPct = Math.min(0.3, lcBarriers.length * LAND_COVER_EXCLUSION_FACTOR);

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
      // subtractBarriers returns the boundary unchanged; nothing is excluded
      // from it. The *Excluded fractions above are count-based estimates.
      boundaryExcludesFeatures: false,
      waterBodyCount:      lastWaterBodies.length,
      highwayCount:        lastHighways.length,
      barrierLandCoverCount: lastLandCover.filter(function (lc) { return BARRIER_LAND_COVER[lc.classCode]; }).length
    };
  }

  /* ── Tract-level barrier exclusion ────────────────────────────────── */

  /**
   * Minimum AADT (Annual Average Daily Traffic) to qualify as a significant
   * barrier. Below this threshold, roads are not considered barriers to
   * market area continuity.
   */
  var MIN_BARRIER_AADT = 10000;

  /**
   * Test whether two line segments intersect using the cross-product method.
   * Returns true if segment (p1→p2) crosses segment (p3→p4).
   */
  function _segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    var d1x = x2 - x1, d1y = y2 - y1;
    var d2x = x4 - x3, d2y = y4 - y3;
    var denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-12) return false; // parallel or collinear

    var t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / denom;
    var u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  /**
   * Extract line segments from barrier GeoJSON features.
   * Only includes highways with AADT >= MIN_BARRIER_AADT and all water bodies.
   * @param {Array} features - barrier features from natural_barriers_co.geojson
   * @returns {Array} [{x1,y1,x2,y2}]
   */
  function _extractBarrierSegments(features) {
    var segments = [];
    if (!features || !features.length) return segments;

    features.forEach(function (f) {
      if (!f || !f.geometry) return;
      var props = f.properties || {};

      // Skip minor roads (AADT below threshold)
      if (props.barrier_type === 'highway') {
        var aadt = parseInt(props.aadt, 10) || 0;
        if (aadt < MIN_BARRIER_AADT) return;
      }

      var coords = f.geometry.coordinates;
      if (!coords) return;

      // Handle LineString
      if (f.geometry.type === 'LineString' && coords.length >= 2) {
        for (var i = 0; i < coords.length - 1; i++) {
          segments.push({ x1: coords[i][0], y1: coords[i][1], x2: coords[i + 1][0], y2: coords[i + 1][1] });
        }
      }
      // Handle MultiLineString
      else if (f.geometry.type === 'MultiLineString') {
        coords.forEach(function (line) {
          for (var j = 0; j < line.length - 1; j++) {
            segments.push({ x1: line[j][0], y1: line[j][1], x2: line[j + 1][0], y2: line[j + 1][1] });
          }
        });
      }
    });

    return segments;
  }

  /**
   * Identify census tracts that are "behind" a significant barrier
   * relative to the site location. A tract is excluded if any major
   * barrier segment intersects the straight line from the site to
   * the tract centroid.
   *
   * This is a practical approximation: it does NOT clip the PMA polygon
   * (which would require turf.js), but instead removes tracts from the
   * ACS aggregation that are on the far side of a highway or water body.
   *
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {Array}  tractCentroids - [{geoid, lat, lon}]
   * @param {Array}  barrierFeatures - GeoJSON features from natural_barriers_co.geojson
   * @returns {Array} GEOIDs of excluded tracts
   */
  function identifyExcludedTracts(siteLat, siteLon, tractCentroids, barrierFeatures) {
    if (!tractCentroids || !tractCentroids.length || !barrierFeatures || !barrierFeatures.length) {
      return [];
    }

    var segments = _extractBarrierSegments(barrierFeatures);
    if (!segments.length) return [];

    // Performance optimization: only test segments within a reasonable
    // bounding box around the PMA (avoid testing distant barriers)
    var maxDist = 0.25; // ~15 miles in degrees at Colorado latitudes
    var relevantSegments = segments.filter(function (seg) {
      return Math.abs(seg.x1 - siteLon) < maxDist && Math.abs(seg.y1 - siteLat) < maxDist;
    });

    if (!relevantSegments.length) return [];

    var excluded = [];
    tractCentroids.forEach(function (tc) {
      var tcLat = parseFloat(tc.lat) || 0;
      var tcLon = parseFloat(tc.lon) || 0;
      if (!tcLat || !tcLon) return;

      // Test if any barrier segment crosses the site→tract line
      for (var i = 0; i < relevantSegments.length; i++) {
        var seg = relevantSegments[i];
        if (_segmentsIntersect(
          siteLon, siteLat, tcLon, tcLat,
          seg.x1, seg.y1, seg.x2, seg.y2
        )) {
          excluded.push(tc.geoid || tc.GEOID || '');
          break; // one blocking barrier is enough
        }
      }
    });

    return excluded;
  }

  /* ── Proposed exclusions for the tract picker ─────────────────────── */

  /* The feature types the market-area option uses, as stated on screen.
     Interstates only: they are crossed only at interchanges and
     underpasses, while a US route through a town is a surface street with
     signals (US 6 is North Avenue in Grand Junction). Water is rivers,
     lakes and reservoirs; creeks, canals and unnamed ponds are left out
     because a pond or ditch between the site and a tract does not separate
     a market. */
  var SUPPORTED_FEATURES = 'interstates carrying ' + MIN_BARRIER_AADT.toLocaleString('en-US') +
    '+ vehicles a day, rivers, and named lakes and reservoirs';

  /* Route "070A" sign I -> "I-70" (sign U -> "US 70"); "Colorado Riv" -> "Colorado River", "Grand Lk" -> "Grand Lake". */
  function _featureLabel(props) {
    if (props.barrier_type === 'highway') {
      var n = parseInt(props.route, 10);
      if (!isFinite(n)) return props.name || null;
      return (props.route_sign === 'I' ? 'I-' : 'US ') + n;
    }
    return String(props.name || '').trim()
      .replace(/\bRiv\b/g, 'River').replace(/\bLks\b/g, 'Lakes').replace(/\bLk\b/g, 'Lake');
  }

  /* 'river' | 'lake' for a qualifying water feature, else null. */
  function _waterKind(props) {
    var name = String(props.name || '').trim();
    // The file abbreviates and numbers its names ("Lk Hope", "Cottonwood
    // Lake Number 5", "Road Canyon Reservoir No 1"), so match the word anywhere.
    if (props.sub_type === 'river' || /\bRiv(er)?\b/.test(name)) return 'river';
    if (/\b(Lks?|Lakes?|Reservoirs?)\b/.test(name)) return 'lake';
    return null;
  }

  /* One record per qualifying feature, with its line segments. The tract
     picker re-runs the proposal on every click, so the result is kept for
     the feature array it came from. */
  var _supportedCache = { input: null, out: null };
  function _supportedFeatures(features) {
    if (features && features === _supportedCache.input) return _supportedCache.out;
    var out = _normalizeFeatures(features);
    _supportedCache = { input: features, out: out };
    return out;
  }

  function _normalizeFeatures(features) {
    var out = [];
    (features || []).forEach(function (f) {
      if (!f || !f.geometry || !f.properties) return;
      var p = f.properties;
      var kind;
      if (p.barrier_type === 'highway') {
        if (p.route_sign !== 'I') return;
        var aadt = Number(p.aadt);
        if (!(aadt >= MIN_BARRIER_AADT)) return;
        kind = 'highway';
      } else if (p.barrier_type === 'water') {
        kind = _waterKind(p);
        if (!kind) return;
      } else {
        return;
      }
      var label = _featureLabel(p);
      if (!label) return;
      var lines = [];
      var g = f.geometry;
      if (g.type === 'LineString') lines = [g.coordinates];
      else if (g.type === 'MultiLineString' || g.type === 'Polygon') lines = g.coordinates;
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(function (poly) { lines = lines.concat(poly); });
      var segs = [];
      lines.forEach(function (line) {
        for (var i = 0; line && i < line.length - 1; i++) {
          segs.push([line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]]);
        }
      });
      if (segs.length) out.push({ label: label, kind: kind, segs: segs });
    });
    return out;
  }

  /**
   * Propose which tracts a supported natural feature separates from the site.
   * A tract is proposed when the straight line from the site to its centroid
   * crosses a feature. Nothing is removed here: the tract picker shows the
   * proposals and the analyst applies them, keeping any tract that a bridge
   * or interchange connects.
   *
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {Array}  tracts   [{geoid, lat, lon}]
   * @param {Array|null} barrierFeatures features of natural_barriers_co.geojson; null when it did not load
   * @param {string} [siteGeoid] the tract containing the site, which is never proposed
   * @returns {{status: string, reason: string|null, supported: string, exclusions: Array<{geoid, feature, featureType}>}}
   *   status: 'proposed' (features were tested), 'no_features' (none of the
   *   supported types near the site or the tracts), or 'unavailable' (no data).
   */
  function proposeTractExclusions(siteLat, siteLon, tracts, barrierFeatures, siteGeoid) {
    var base = { supported: SUPPORTED_FEATURES, exclusions: [] };
    if (!Array.isArray(barrierFeatures) || !barrierFeatures.length) {
      return Object.assign(base, { status: 'unavailable',
        reason: 'the natural-feature file did not load' });
    }
    if (!Number.isFinite(siteLat) || !Number.isFinite(siteLon)) {
      return Object.assign(base, { status: 'unavailable', reason: 'no site location' });
    }
    var pts = (tracts || []).filter(function (t) {
      return t && t.geoid && Number.isFinite(t.lat) && Number.isFinite(t.lon);
    });
    // Only features near the site-to-tract lines can cross them.
    var minX = siteLon, maxX = siteLon, minY = siteLat, maxY = siteLat;
    pts.forEach(function (t) {
      minX = Math.min(minX, t.lon); maxX = Math.max(maxX, t.lon);
      minY = Math.min(minY, t.lat); maxY = Math.max(maxY, t.lat);
    });
    var near = [];
    _supportedFeatures(barrierFeatures).forEach(function (f) {
      var segs = f.segs.filter(function (s) {
        return Math.max(s[0], s[2]) >= minX && Math.min(s[0], s[2]) <= maxX &&
               Math.max(s[1], s[3]) >= minY && Math.min(s[1], s[3]) <= maxY;
      });
      if (segs.length) near.push({ label: f.label, kind: f.kind, segs: segs });
    });
    if (!near.length) {
      return Object.assign(base, { status: 'no_features',
        reason: 'none of the supported features lies between the site and the selected tracts' });
    }
    pts.forEach(function (t) {
      if (siteGeoid && String(t.geoid) === String(siteGeoid)) return;
      for (var i = 0; i < near.length; i++) {
        var f = near[i];
        for (var j = 0; j < f.segs.length; j++) {
          var s = f.segs[j];
          if (_segmentsIntersect(siteLon, siteLat, t.lon, t.lat, s[0], s[1], s[2], s[3])) {
            base.exclusions.push({ geoid: String(t.geoid), feature: f.label, featureType: f.kind });
            return;
          }
        }
      }
    });
    return Object.assign(base, { status: 'proposed', reason: null });
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMABarriers = {
      fetchUSGSHydrology:       fetchUSGSHydrology,
      fetchNLCDLandCover:       fetchNLCDLandCover,
      fetchStateHighways:       fetchStateHighways,
      subtractBarriers:         subtractBarriers,
      getBarrierSummary:        getBarrierSummary,
      identifyExcludedTracts:   identifyExcludedTracts,
      proposeTractExclusions:   proposeTractExclusions,
      SUPPORTED_FEATURES:       SUPPORTED_FEATURES,
      BARRIER_LAND_COVER:       BARRIER_LAND_COVER,
      MIN_BARRIER_AADT:         MIN_BARRIER_AADT
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchUSGSHydrology:  fetchUSGSHydrology,
      fetchNLCDLandCover:  fetchNLCDLandCover,
      fetchStateHighways:  fetchStateHighways,
      subtractBarriers:    subtractBarriers,
      getBarrierSummary:   getBarrierSummary,
      proposeTractExclusions: proposeTractExclusions,
      BARRIER_LAND_COVER:  BARRIER_LAND_COVER
    };
  }

}());
