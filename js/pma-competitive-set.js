/**
 * js/pma-competitive-set.js
 * Enhanced competitive property analysis with HUD NHPD subsidy expiry risk.
 *
 * Responsibilities:
 *  - buildCompetitiveSet(lihtcFeatures, nhpdFeatures, lat, lon, radiusMiles)
 *  - flagSubsidyExpiryRisk(nhpdFeatures, thresholdYears) — at-risk properties
 *  - calculateAbsorptionRisk(competitiveSet, proposedUnits) — market saturation
 *  - getCompetitiveSetLayer() — GeoJSON for map display
 *  - getCompetitiveJustification() — audit-ready competitive analysis
 *
 * Builds on the existing LIHTC filter logic in PMAEngine, layering in
 * NHPD subsidy data for a complete competitive landscape.
 *
 * Exposed as window.PMACompetitiveSet.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var EARTH_RADIUS_MI   = 3958.8;
  var DEFAULT_RADIUS    = 5;         // miles
  var SUBSIDY_EXPIRY_RISK_YEARS = 5;         // properties expiring within this many years are "at risk"
  var SATURATION_LIMIT  = 0.10;      // >10 % capture rate = high absorption risk
  var CURRENT_YEAR      = new Date().getFullYear();

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastLihtcCount    = 0;
  var lastNhpdAssisted  = 0;
  var lastExpiryRisk    = [];
  var lastAbsorptionRisk = 'low';
  var lastSet           = [];

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

  function _propLat(f) {
    if (!f) return 0;
    if (f.geometry && f.geometry.coordinates) return toNum(f.geometry.coordinates[1]);
    return toNum(f.lat || f.LAT || f.latitude || 0);
  }

  function _propLon(f) {
    if (!f) return 0;
    if (f.geometry && f.geometry.coordinates) return toNum(f.geometry.coordinates[0]);
    return toNum(f.lon || f.LON || f.longitude || 0);
  }

  function _propName(f) {
    if (!f) return 'Unknown Property';
    var p = f.properties || f;
    return p.PROJECT_NAME || p.projectName || p.name || p.PROPERTY_NAME || 'Unknown Property';
  }

  function _propUnits(f) {
    var p = (f && f.properties) ? f.properties : f;
    return toNum(p && (p.LI_UNITS || p.N_UNITS || p.totalUnits || p.units) || 0);
  }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Build the competitive property set by merging LIHTC and NHPD data
   * within the specified radius of the proposed site.
   *
   * @param {Array}  lihtcFeatures - GeoJSON features from hud_lihtc_co
   * @param {Array}  nhpdFeatures  - NHPD subsidized property features
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {number} [radiusMiles]
   * @returns {Array} competitive set with merged subsidy metadata
   */
  function buildCompetitiveSet(lihtcFeatures, nhpdFeatures, siteLat, siteLon, radiusMiles) {
    radiusMiles   = radiusMiles || DEFAULT_RADIUS;
    lihtcFeatures = lihtcFeatures || [];
    nhpdFeatures  = nhpdFeatures  || [];

    // Filter LIHTC within radius
    var lihtcNearby = lihtcFeatures.filter(function (f) {
      var lat = _propLat(f), lon = _propLon(f);
      return lat !== 0 && lon !== 0 &&
             haversine(siteLat, siteLon, lat, lon) <= radiusMiles;
    });

    // Filter NHPD within radius
    var nhpdNearby = nhpdFeatures.filter(function (f) {
      var lat = _propLat(f), lon = _propLon(f);
      return lat !== 0 && lon !== 0 &&
             haversine(siteLat, siteLon, lat, lon) <= radiusMiles;
    });

    // Build a lookup of NHPD by name for merge
    var nhpdLookup = {};
    nhpdNearby.forEach(function (f) {
      var n = _propName(f).toLowerCase().replace(/\s+/g, '');
      nhpdLookup[n] = f;
    });

    // Merge LIHTC + NHPD metadata
    var merged = lihtcNearby.map(function (f) {
      var key     = _propName(f).toLowerCase().replace(/\s+/g, '');
      var nhpdMatch = nhpdLookup[key] || null;
      var dist    = haversine(siteLat, siteLon, _propLat(f), _propLon(f));
      var props   = f.properties || f;
      var expiryYear = null;
      if (nhpdMatch) {
        var nhpdProps = nhpdMatch.properties || nhpdMatch;
        expiryYear = toNum(nhpdProps.expiryYear || nhpdProps.EXPIRY_YEAR || 0) || null;
      }
      return {
        id:              props.HUDID || props.id || ('lihtc-' + Math.random().toString(36).slice(2)),
        name:            _propName(f),
        lat:             _propLat(f),
        lon:             _propLon(f),
        distanceMiles:   Math.round(dist * 10) / 10,
        units:           _propUnits(f),
        programType:     props.PROGRAM || props.programType || 'LIHTC',
        amiPercent:      toNum(props.AMI_PCT || props.amiPercent || 60),
        yearPlaced:      toNum(props.YR_PIS || props.yearPlaced || 0),
        yearAllocated:   toNum(props.YR_ALLOC || props.YEAR_ALLOC || props.yearAllocated || 0),
        creditType:      props.CREDIT || props.creditType || '',
        hasNhpd:         !!nhpdMatch,
        subsidyExpiryYear: expiryYear,
        atExpiryRisk:    expiryYear && expiryYear - CURRENT_YEAR <= SUBSIDY_EXPIRY_RISK_YEARS
      };
    });

    // Add NHPD-only properties (not in LIHTC)
    nhpdNearby.forEach(function (f) {
      var key = _propName(f).toLowerCase().replace(/\s+/g, '');
      var alreadyMerged = lihtcNearby.some(function (lf) {
        return _propName(lf).toLowerCase().replace(/\s+/g, '') === key;
      });
      if (!alreadyMerged) {
        var dist = haversine(siteLat, siteLon, _propLat(f), _propLon(f));
        var props = f.properties || f;
        var expYear = toNum(props.expiryYear || props.EXPIRY_YEAR || 0) || null;
        merged.push({
          id:              props.id || ('nhpd-' + Math.random().toString(36).slice(2)),
          name:            _propName(f),
          lat:             _propLat(f),
          lon:             _propLon(f),
          distanceMiles:   Math.round(dist * 10) / 10,
          units:           _propUnits(f),
          programType:     props.program || props.PROGRAM || 'Section 8',
          amiPercent:      toNum(props.amiPercent || 60),
          yearPlaced:      toNum(props.yearPlaced || 0),
          hasNhpd:         true,
          subsidyExpiryYear: expYear,
          atExpiryRisk:    expYear && expYear - CURRENT_YEAR <= SUBSIDY_EXPIRY_RISK_YEARS
        });
      }
    });

    lastSet          = merged.sort(function (a, b) { return a.distanceMiles - b.distanceMiles; });
    lastLihtcCount   = lihtcNearby.length;
    lastNhpdAssisted = nhpdNearby.length;

    return lastSet;
  }

  /**
   * Flag subsidized properties at risk of subsidy expiry.
   * @param {Array}  nhpdFeatures
   * @param {number} [thresholdYears]
   * @returns {Array} at-risk properties sorted by expiry year
   */
  function flagSubsidyExpiryRisk(nhpdFeatures, thresholdYears) {
    thresholdYears = thresholdYears || SUBSIDY_EXPIRY_RISK_YEARS;
    nhpdFeatures   = nhpdFeatures   || [];

    lastExpiryRisk = nhpdFeatures
      .map(function (f) {
        var props = f.properties || f;
        var expiry = toNum(props.expiryYear || props.EXPIRY_YEAR || 0);
        return {
          property:    _propName(f),
          lat:         _propLat(f),
          lon:         _propLon(f),
          expiryYear:  expiry,
          atRiskUnits: _propUnits(f),
          yearsRemaining: expiry ? expiry - CURRENT_YEAR : null
        };
      })
      .filter(function (p) {
        return p.expiryYear && p.yearsRemaining !== null && p.yearsRemaining <= thresholdYears;
      })
      .sort(function (a, b) { return a.expiryYear - b.expiryYear; });

    return lastExpiryRisk;
  }

  /**
   * Assess absorption risk based on competitive unit count vs proposed units.
   * @param {Array}  competitiveSet - Output of buildCompetitiveSet
   * @param {number} proposedUnits
   * @returns {{risk: string, captureRate: number, totalCompetitiveUnits: number}}
   */
  function calculateAbsorptionRisk(competitiveSet, proposedUnits) {
    competitiveSet = competitiveSet || lastSet;
    proposedUnits  = toNum(proposedUnits) || 1;

    var totalCompetitive = competitiveSet.reduce(function (s, p) { return s + p.units; }, 0);
    var captureRate = totalCompetitive > 0 ? proposedUnits / (totalCompetitive + proposedUnits) : 0;

    var risk;
    if (captureRate < SATURATION_LIMIT * 0.5) risk = 'low';
    else if (captureRate < SATURATION_LIMIT)   risk = 'moderate';
    else                                       risk = 'high';

    lastAbsorptionRisk = risk;

    return {
      risk:                   risk,
      captureRate:            Math.round(captureRate * 100) / 100,
      totalCompetitiveUnits:  totalCompetitive,
      proposedUnits:          proposedUnits,
      competitivePropertyCount: competitiveSet.length
    };
  }

  /**
   * Build GeoJSON FeatureCollection for competitive set map layer.
   * @param {Array} [set]
   * @returns {object}
   */
  function getCompetitiveSetLayer(set) {
    set = set || lastSet;
    var features = (set || []).map(function (p) {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: {
          name:              p.name,
          units:             p.units,
          programType:       p.programType,
          distanceMiles:     p.distanceMiles,
          hasNhpd:           p.hasNhpd,
          atExpiryRisk:      !!p.atExpiryRisk,
          subsidyExpiryYear: p.subsidyExpiryYear
        }
      };
    });
    return { type: 'FeatureCollection', features: features };
  }

  /**
   * Export competitive set analysis for ScoreRun audit trail.
   * @returns {object}
   */
  function getCompetitiveJustification() {
    // Compute recency: most recent allocation year and count of projects funded in last 5 years
    var recentYears = lastSet.filter(function (p) {
      return p.yearAllocated && p.yearAllocated >= CURRENT_YEAR - 5;
    });
    var mostRecentAllocation = lastSet.reduce(function (max, p) {
      return (p.yearAllocated && p.yearAllocated > max) ? p.yearAllocated : max;
    }, 0);

    return {
      lihtcCount:         lastLihtcCount,
      nhpdAssisted:       lastNhpdAssisted,
      subsidyExpiryRisk:  lastExpiryRisk.slice(),
      absorptionRisk:     lastAbsorptionRisk,
      totalProperties:    lastSet.length,
      // Recency metrics — visible to user for CHFA geographic distribution awareness
      recentAllocations:  recentYears.length,
      mostRecentYear:     mostRecentAllocation || null,
      recentNote:         recentYears.length > 2
        ? 'This PMA has received ' + recentYears.length + ' LIHTC allocations in the last 5 years. CHFA may consider geographic distribution in scoring.'
        : null
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMACompetitiveSet = {
      buildCompetitiveSet:       buildCompetitiveSet,
      flagSubsidyExpiryRisk:     flagSubsidyExpiryRisk,
      calculateAbsorptionRisk:   calculateAbsorptionRisk,
      getCompetitiveSetLayer:    getCompetitiveSetLayer,
      getCompetitiveJustification: getCompetitiveJustification,
      SUBSIDY_EXPIRY_RISK_YEARS: SUBSIDY_EXPIRY_RISK_YEARS
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildCompetitiveSet:       buildCompetitiveSet,
      flagSubsidyExpiryRisk:     flagSubsidyExpiryRisk,
      calculateAbsorptionRisk:   calculateAbsorptionRisk,
      getCompetitiveSetLayer:    getCompetitiveSetLayer,
      getCompetitiveJustification: getCompetitiveJustification,
      SUBSIDY_EXPIRY_RISK_YEARS: SUBSIDY_EXPIRY_RISK_YEARS
    };
  }

}());
