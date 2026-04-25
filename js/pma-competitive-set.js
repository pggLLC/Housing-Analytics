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

  /**
   * Parse an AMI targeting value into a number 0–100, or null when
   * unreported / unparseable. Accepts numeric (60), string with pct
   * sign ("60%"), or bare string ("60"). Range strings like "30-60%"
   * return the upper bound (the most permissive target in the range).
   *
   * Returns null — NOT a default — so downstream composites can
   * distinguish "targeting unknown" from "targeting 60%".
   */
  function _parseAmi(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    // "30-60%" → take the upper bound
    var rangeMatch = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      var upper = parseFloat(rangeMatch[2]);
      return isFinite(upper) && upper > 0 ? upper : null;
    }
    var single = parseFloat(s);
    return isFinite(single) && single > 0 ? single : null;
  }

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
    // Handles HUD LIHTC (PROJECT_NAME), NHPD (property_name), and internal shapes
    return p.PROJECT_NAME || p.projectName || p.name
        || p.PROPERTY_NAME || p.property_name || 'Unknown Property';
  }

  function _propUnits(f) {
    var p = (f && f.properties) ? f.properties : f;
    // LI_UNITS/N_UNITS = HUD LIHTC; total_units/assisted_units = NHPD
    return toNum(p && (p.LI_UNITS || p.N_UNITS || p.totalUnits || p.units
                    || p.total_units || p.assisted_units) || 0);
  }

  // Extract expiry year from LIHTC numeric fields or NHPD date strings
  function _propExpiryYear(f) {
    var p = (f && f.properties) ? f.properties : f;
    if (!p) return null;
    var direct = toNum(p.expiryYear || p.EXPIRY_YEAR || 0);
    if (direct) return direct;
    // NHPD subsidy_expiration is a date string like "2027-09-30"
    var iso = p.subsidy_expiration || p.subsidyExpiration;
    if (iso) {
      var y = parseInt(String(iso).slice(0, 4), 10);
      if (y >= 1900 && y <= 2100) return y;
    }
    return null;
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
        expiryYear = _propExpiryYear(nhpdMatch);
      }
      // AMI targeting precedence (all null-preserving, no fabricated default):
      //   1. The LIHTC record's own AMI_PCT / amiPercent field
      //   2. If an NHPD record matched by name, its `ami_targeting` field
      //      (e.g. "60%" → 60). NHPD has this populated on ~every subsidized
      //      property in Colorado — filling in HUD's LIHTC DB where
      //      per-unit AMI mix isn't published.
      //   3. Otherwise null (unknown targeting, not "60% default").
      var ami = _parseAmi(
        props.AMI_PCT != null ? props.AMI_PCT :
        props.amiPercent != null ? props.amiPercent :
        null
      );
      if (ami == null && nhpdMatch) {
        var nprops = nhpdMatch.properties || nhpdMatch;
        ami = _parseAmi(nprops.ami_targeting != null ? nprops.ami_targeting : nprops.amiPercent);
      }
      return {
        id:              props.HUDID || props.id || ('lihtc-' + Math.random().toString(36).slice(2)),
        name:            _propName(f),
        lat:             _propLat(f),
        lon:             _propLon(f),
        distanceMiles:   Math.round(dist * 10) / 10,
        units:           _propUnits(f),
        programType:     props.PROGRAM || props.programType || 'LIHTC',
        amiPercent:      ami,
        amiSource:       ami == null ? 'unknown'
                       : (props.AMI_PCT != null || props.amiPercent != null) ? 'lihtc'
                       : 'nhpd',
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
        var expYear = _propExpiryYear(f);
        // NHPD's canonical field is `ami_targeting` (string like "60%").
        // Previously this branch read `props.amiPercent`, which NHPD does
        // not populate, so every NHPD-only record got amiPercent: null.
        // Read the right field and parse the percentage.
        var ami = _parseAmi(props.ami_targeting != null ? props.ami_targeting : props.amiPercent);
        merged.push({
          id:              props.id || props.nhpd_id || ('nhpd-' + Math.random().toString(36).slice(2)),
          name:            _propName(f),
          lat:             _propLat(f),
          lon:             _propLon(f),
          distanceMiles:   Math.round(dist * 10) / 10,
          units:           _propUnits(f),
          programType:     props.program || props.PROGRAM || props.subsidy_type || 'Section 8',
          amiPercent:      ami,
          amiSource:       ami == null ? 'unknown' : 'nhpd',
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
        var expiry = _propExpiryYear(f) || 0;
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
      SUBSIDY_EXPIRY_RISK_YEARS: SUBSIDY_EXPIRY_RISK_YEARS,
      /* Exposed for testing */
      _parseAmi:                 _parseAmi
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
