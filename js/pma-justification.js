/**
 * js/pma-justification.js
 * Automated PMA justification narrative generation and audit trail export.
 *
 * Responsibilities:
 *  - synthesizePMA(components) — combine all module outputs into a ScoreRun
 *  - generateNarrative(scoreRun) — plain-English justification (<500 words)
 *  - generateAuditTrail(scoreRun) — full audit metadata with data vintage
 *  - exportToJSON(scoreRun) — JSON export for audit trail
 *  - getLayerOrder() — ordered list of decision factor layers for map display
 *
 * Depends on (all optional): PMACommuting, PMABarriers, PMASchools,
 * PMATransit, PMACompetitiveSet, PMAOpportunities, PMAInfrastructure.
 *
 * Exposed as window.PMAJustification.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var DATA_VINTAGE   = 'ACS_2023_5YR';
  var LODES_VINTAGE  = '2021';
  var SCHEMA_VERSION = '2.0';

  /* ── Narrative templates ─────────────────────────────────────────── */
  var TIER_LABELS = {
    high:     'strong',
    moderate: 'moderate',
    low:      'limited',
    unknown:  'undetermined'
  };

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastScoreRun   = null;
  var lastNarrative  = '';
  var lastRunId      = null;

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function _ts()    { return new Date().toISOString(); }
  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function _generateRunId() {
    var d = new Date();
    return 'pma-run-' +
      d.getFullYear()                                       +
      String(d.getMonth() + 1).padStart(2, '0')            +
      String(d.getDate())      .padStart(2, '0')            + '-' +
      Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Synthesize all PMA component outputs into a single ScoreRun object.
   * Calls each module's justification accessor when available.
   *
   * @param {object} [overrides] - manually supplied component data (optional)
   * @returns {object} ScoreRun
   */
  function synthesizePMA(overrides) {
    overrides = overrides || {};
    lastRunId = _generateRunId();

    var commuting   = _safeGet('PMACommuting',       'getJustificationData',    overrides.commuting);
    var barriers    = _safeGet('PMABarriers',         'getBarrierSummary',       overrides.barriers);
    var employment  = {
      centers: (overrides.employmentCenters ||
                (_hasModule('PMAEmploymentCenters') ? window.PMAEmploymentCenters.getEmploymentLayer().features.map(function (f) { return f.properties; }) : []))
    };
    var schools     = _safeGet('PMASchools',          'getSchoolJustification',  overrides.schools);
    var transit     = _safeGet('PMATransit',          'getTransitJustification', overrides.transit);
    var competitive = _safeGet('PMACompetitiveSet',   'getCompetitiveJustification', overrides.competitiveSet);
    var opps        = _safeGet('PMAOpportunities',    'getOpportunityJustification', overrides.opportunities);
    var infra       = _safeGet('PMAInfrastructure',   'getInfrastructureJustification', overrides.infrastructure);

    lastScoreRun = {
      run_id:       lastRunId,
      created_at:   _ts(),
      schema_version: SCHEMA_VERSION,
      data_vintage: DATA_VINTAGE,
      lodes_vintage: LODES_VINTAGE,

      commuting:        commuting,
      barriers:         barriers,
      employmentCenters: employment.centers || [],
      schools:          schools,
      transit:          transit,
      competitiveSet:   competitive,
      opportunities:    opps,
      infrastructure:   infra,

      dataQuality: _assessDataQuality(commuting, schools, transit, opps, infra)
    };

    return lastScoreRun;
  }

  /**
   * Generate a plain-English justification narrative from a ScoreRun.
   * Target: ≤500 words, suitable for LIHTC/CHFA application attachments.
   *
   * @param {object} [scoreRun] - defaults to lastScoreRun
   * @returns {string} narrative text
   */
  function generateNarrative(scoreRun) {
    scoreRun = scoreRun || lastScoreRun;
    if (!scoreRun) {
      lastNarrative = 'PMA analysis has not yet been run. Please execute synthesizePMA() first.';
      return lastNarrative;
    }

    var parts = [];

    // Opening: boundary method
    var c = scoreRun.commuting || {};
    var captureRate = toNum(c.captureRate || 0);
    if (captureRate > 0) {
      parts.push(
        'This PMA boundary was delineated using LEHD/LODES commuting flow analysis ' +
        '(vintage ' + scoreRun.lodes_vintage + '), capturing approximately ' +
        Math.round(captureRate * 100) + ' % of likely future residents from ' +
        (c.lodesWorkplaces || 0) + ' workplace locations within the study area.'
      );
    } else {
      parts.push(
        'This PMA boundary was delineated using a standard circular buffer method, ' +
        'consistent with HUD LIHTC market study guidelines.'
      );
    }

    // Barriers
    var b = scoreRun.barriers || {};
    if (b.waterBodyCount > 0 || b.highwayCount > 0) {
      parts.push(
        'The boundary excludes significant natural and manmade barriers, including ' +
        (b.waterBodyCount || 0) + ' water feature(s) and ' +
        (b.highwayCount   || 0) + ' major highway segment(s), ' +
        'which prevent practical access for prospective residents.'
      );
    }

    // Employment
    var centers = scoreRun.employmentCenters || [];
    if (centers.length) {
      var topCenter = centers[0];
      parts.push(
        'The PMA is served by ' + centers.length + ' major employment center(s). ' +
        'The largest concentration (' + (topCenter.jobCount || topCenter.jobs || 'N/A') + ' jobs) ' +
        'is in the ' + (topCenter.dominantIndustry || topCenter.industry || 'Mixed') + ' sector, ' +
        'making this location well-suited for workforce housing demand.'
      );
    }

    // Schools
    var s = scoreRun.schools || {};
    if (s.schoolDistrictsAligned > 0) {
      parts.push(
        'The PMA boundary aligns with ' + s.schoolDistrictsAligned + ' school district(s), ' +
        'with an average performance score of ' + (s.averagePerformanceScore || 'N/A') + ' out of 100, ' +
        'supporting family-oriented demand for affordable housing in this area.'
      );
    }

    // Transit
    var t = scoreRun.transit || {};
    var tScore = toNum(t.transitAccessibilityScore || 0);
    if (tScore > 0) {
      var tDesc = tScore >= 70 ? 'strong' : tScore >= 40 ? 'moderate' : 'limited';
      parts.push(
        'Transit accessibility within the PMA is ' + tDesc + ', ' +
        'with a composite score of ' + tScore + '/100 ' +
        '(walk score: ' + (t.walkScore || 'N/A') + '). ' +
        (tScore < 40 ? 'On-site parking and car-share programs are recommended to address service gaps.' : '')
      );
    }

    // Opportunities
    var o = scoreRun.opportunities || {};
    var ozPct = Math.round(toNum(o.opportunityZoneShare || 0) * 100);
    if (ozPct > 0) {
      parts.push(
        ozPct + ' % of the PMA falls within a federally designated Opportunity Zone, ' +
        'making the project potentially eligible for LIHTC basis step-down incentives ' +
        'and New Markets Tax Credits.'
      );
    }

    // Infrastructure
    var i = scoreRun.infrastructure || {};
    var floodPct = Math.round(toNum(i.floodRiskPercent || 0) * 100);
    if (floodPct > 0 || i.sewerCapacityAdequate === false) {
      var infraNotes = [];
      if (floodPct > 10) infraNotes.push(floodPct + ' % of the site area is in a FEMA flood zone');
      if (i.sewerCapacityAdequate === false) infraNotes.push('local sewer capacity may require upgrade');
      if (infraNotes.length) {
        parts.push(
          'Infrastructure review identified the following considerations: ' +
          infraNotes.join('; ') + '. These items should be addressed during site engineering.'
        );
      }
    }

    // Data quality note
    parts.push(
      'Data vintage: ' + scoreRun.data_vintage + '. ' +
      'Analysis quality: ' + (scoreRun.dataQuality || 'STANDARD') + '. ' +
      'Run ID: ' + scoreRun.run_id + '.'
    );

    lastNarrative = parts.join('\n\n');
    return lastNarrative;
  }

  /**
   * Generate an audit trail object for regulatory compliance purposes.
   * @param {object} [scoreRun]
   * @returns {object}
   */
  function generateAuditTrail(scoreRun) {
    scoreRun = scoreRun || lastScoreRun || {};
    return {
      run_id:           scoreRun.run_id || lastRunId,
      generated_at:     _ts(),
      schema_version:   SCHEMA_VERSION,
      data_vintage:     scoreRun.data_vintage || DATA_VINTAGE,
      lodes_vintage:    scoreRun.lodes_vintage || LODES_VINTAGE,
      narrative:        lastNarrative || generateNarrative(scoreRun),
      layers:           getLayerOrder(),
      component_weights: {
        commuting:    'LEHD/LODES ' + (scoreRun.lodes_vintage || LODES_VINTAGE),
        barriers:     'USGS NHD + NLCD',
        schools:      'ED Attendance Boundaries + NCES',
        transit:      'NTD + EPA Smart Location',
        opportunities: 'OZ + HUD AFFH + Opportunity Atlas',
        infrastructure: 'FEMA + NOAA + USDA Food Atlas'
      },
      data_quality:     scoreRun.dataQuality || 'STANDARD',
      alternative_pmas: scoreRun.alternativePmas || []
    };
  }

  /**
   * Export the full ScoreRun as a JSON string.
   * @param {object} [scoreRun]
   * @returns {string} JSON string
   */
  function exportToJSON(scoreRun) {
    scoreRun = scoreRun || lastScoreRun;
    if (!scoreRun) { return '{}'; }
    var trail = generateAuditTrail(scoreRun);
    var full  = Object.assign({}, scoreRun, { auditTrail: trail });
    return JSON.stringify(full, null, 2);
  }

  /**
   * Return the ordered list of decision factor layers for the map picker.
   * @returns {Array.<string>}
   */
  function getLayerOrder() {
    return [
      'commuting',
      'barriers',
      'employmentCenters',
      'schools',
      'transit',
      'competitiveSet',
      'opportunities',
      'infrastructure'
    ];
  }

  /* ── Private helpers ─────────────────────────────────────────────── */
  function _hasModule(name) {
    return typeof window !== 'undefined' && window[name] && typeof window[name] === 'object';
  }

  function _safeGet(moduleName, methodName, fallback) {
    if (fallback !== undefined && fallback !== null) return fallback;
    if (_hasModule(moduleName) && typeof window[moduleName][methodName] === 'function') {
      try { return window[moduleName][methodName](); } catch (e) { return {}; }
    }
    return {};
  }

  function _assessDataQuality(commuting, schools, transit, opps, infra) {
    var present = 0, total = 5;
    if (commuting && (toNum(commuting.lodesWorkplaces || commuting.captureRate) > 0)) present++;
    if (schools   && toNum(schools.schoolDistrictsAligned)   > 0) present++;
    if (transit   && toNum(transit.transitAccessibilityScore) > 0) present++;
    if (opps      && (toNum(opps.opportunityZoneShare) > 0 || toNum(opps.fairHousingScore) > 0)) present++;
    if (infra     && toNum(infra.compositeScore)       > 0) present++;
    if (present === total) return 'HIGH';
    if (present >= 3)      return 'MEDIUM';
    return 'LOW';
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMAJustification = {
      synthesizePMA:        synthesizePMA,
      generateNarrative:    generateNarrative,
      generateAuditTrail:   generateAuditTrail,
      exportToJSON:         exportToJSON,
      getLayerOrder:        getLayerOrder,
      DATA_VINTAGE:         DATA_VINTAGE,
      SCHEMA_VERSION:       SCHEMA_VERSION
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      synthesizePMA:        synthesizePMA,
      generateNarrative:    generateNarrative,
      generateAuditTrail:   generateAuditTrail,
      exportToJSON:         exportToJSON,
      getLayerOrder:        getLayerOrder,
      DATA_VINTAGE:         DATA_VINTAGE,
      SCHEMA_VERSION:       SCHEMA_VERSION
    };
  }

}());
