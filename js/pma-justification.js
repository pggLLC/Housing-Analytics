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
  // NOTE (Rule 3 / Rule 18): Update DATA_VINTAGE and LODES_VINTAGE together
  // whenever the underlying data vintage advances.  These values must stay in
  // sync with the pyramidYear / baseYear in projection data files.
  // DATA_VINTAGE corresponds to 'generated'/'updated' sentinel keys (Rule 18).
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

  // Old saved buffer/tract runs used 0 for an unmeasured quantity. A real
  // zero needs a positive worker denominator; keep it numeric at every consumer.
  function commutingCapture(commuting) {
    var c = commuting || {};
    var measured = Number.isFinite(c.captureRate) && c.captureRate >= 0 && c.captureRate <= 1
      && (c.captureRate > 0 || (Number.isFinite(c.totalWorkers) && c.totalWorkers > 0))
      && !c.captureUnavailableReason;
    return Object.assign({}, c, {
      captureRate: measured ? c.captureRate : null,
      captureUnavailableReason: measured ? null : (c.captureUnavailableReason ||
        'Commuting capture is unavailable: no measured commuting flow capture.')
    });
  }

  /**
   * Render a tract-GEOID list compactly for the narrative. Up to 12 GEOIDs
   * inline; longer lists collapse to "first … last (N total)" so the
   * narrative stays under ~500 words.
   */
  function _summarizeGeoidList(geoids) {
    if (!geoids || !geoids.length) return '(none)';
    var sorted = geoids.slice().sort();
    if (sorted.length <= 12) return sorted.join(', ');
    var head = sorted.slice(0, 6).join(', ');
    var tail = sorted.slice(-3).join(', ');
    return head + ', …, ' + tail + ' (' + sorted.length + ' tracts total)';
  }

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

    var commuting   = commutingCapture(_safeGet('PMACommuting', 'getJustificationData', overrides.commuting));
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

    // CHFA tract-picker boundary (takes precedence over commuting/buffer opener).
    // Whole-tract selection satisfies CHFA Market Study Guide (Appendix A,
    // 2025-26 QAP), which prohibits radius boundaries. When the picker is
    // used, the boundary IS the union of the listed tract polygons.
    var picked = scoreRun.pmaTractSelection || null;
    var pickedGeoids = picked && Array.isArray(picked.selected) ? picked.selected : null;
    if (pickedGeoids && pickedGeoids.length > 0) {
      parts.push(
        'This PMA boundary is defined as the union of ' + pickedGeoids.length +
        ' whole census tract(s), satisfying CHFA Market Study Guide (Appendix A, ' +
        '2025-26 QAP): "Radius boundaries are not allowed. The market boundary ' +
        'must include entire census tracts." Included GEOIDs: ' +
        _summarizeGeoidList(pickedGeoids) + '.'
      );
      if (picked.rationale && picked.rationale.trim()) {
        parts.push(
          'Analyst rationale for boundary delineation: ' + picked.rationale.trim()
        );
      }
      if (picked.curated === false) {
        parts.push(
          'CAVEAT: This boundary is the unedited ' + (picked.autoSelectRadiusMi || 4) +
          '-mile auto-pick ring with no analyst curation or rationale. For a CHFA ' +
          'submittal, the boundary must be justified by natural barriers, school ' +
          'districts, jurisdictional lines, or a commute shed — not a radius ' +
          'snapped to tract edges. Treat this output as screening only until ' +
          'the tract set is curated.'
        );
      }
    } else {
      // Opening: legacy boundary methods (commuting / buffer)
      var c = commutingCapture(scoreRun.commuting);
      var captureRate = c.captureRate;
      if (captureRate !== null) {
        parts.push(
          'This PMA boundary was delineated using LEHD/LODES commuting flow analysis ' +
          '(vintage ' + scoreRun.lodes_vintage + '), capturing approximately ' +
          Math.round(captureRate * 100) + ' % of likely future residents from ' +
          (c.lodesWorkplaces || 0) + ' workplace locations within the study area. ' +
          'Note: this is a screening boundary and does not by itself satisfy ' +
          'CHFA Appendix A (whole-tract requirement).'
        );
      } else {
        parts.push(
          (c.method === 'buffer' ? 'This PMA boundary was delineated using a standard circular buffer method. ' : '') +
          c.captureUnavailableReason + ' ' +
          'Note: this is a screening boundary and does not satisfy CHFA Market ' +
          'Study Guide (Appendix A, 2025-26 QAP), which requires the boundary to ' +
          'be defined by whole census tracts.'
        );
      }
    }

    // Keep source limitations in the narrative too, including downloaded
    // narratives and restored runs created before coverage metadata existed.
    var competitive = scoreRun.competitiveSet || {};
    parts.push(competitive.preservationRiskUnavailableReason ||
      'NHPD coverage is unverified. Preservation totals and risk are unknown; no matching record does not mean no preservation risk.');

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
    var schoolsAligned = toNum(s.schoolsAligned || s.schoolDistrictsAligned);
    if (schoolsAligned > 0) {
      // These are schools, not attendance-boundary districts — the previous
      // source returned school points and labelled them districts (#1541).
      // Performance is stated only when a performance source actually supplied
      // it; "a score of N/A out of 100" is not a sentence worth printing, and a
      // number in its place would be invented.
      var perf = (s.averagePerformanceScore === null || s.averagePerformanceScore === undefined)
        ? ' School performance is not scored: ' +
          (s.performanceUnavailableReason || 'no performance source is wired in.')
        : ' Average performance score across them is ' + s.averagePerformanceScore + ' out of 100.';
      parts.push(
        'The PMA boundary contains ' + schoolsAligned + ' school(s),' +
        ' supporting family-oriented demand for affordable housing in this area.' + perf
      );
    }

    // Transit — scored from confirmed stops (js/pma-transit.js) at the two
    // distances in data/policy/thiz-map-status.json, which travel with the
    // result (todLabel, zoneRadiusMiles) so this text cannot name others.
    // Three cases, never conflated: not measured (null + reason), measured
    // with no confirmed stop within the zone radius (a real 0 coverage), and
    // measured with stops.
    var t = scoreRun.transit || {};
    var tScore = Number.isFinite(t.transitAccessibilityScore) ? t.transitAccessibilityScore : null;
    var epaNote = t.unavailableReason ? t.unavailableReason + ' ' : '';
    var radiusText = typeof t.zoneRadiusMiles === 'number'
      ? t.zoneRadiusMiles + (t.zoneRadiusMiles === 1 ? ' mile' : ' miles') : null;
    if (tScore === null && t.transitUnavailableReason) {
      parts.push('Transit accessibility was not scored: ' + t.transitUnavailableReason);
    } else if (tScore !== null && t.noConfirmedStopWithinZoneRadius === true && radiusText) {
      var nearestFar = t.nearestConfirmedStop;
      parts.push(
        'No confirmed transit stop was found within ' + radiusText + ' of the site' +
        (nearestFar && typeof nearestFar.distanceMiles === 'number'
          ? ' (the nearest is ' + nearestFar.distanceMiles + ' miles away)' : '') +
        ', so stop coverage is measured as zero; the composite transit score is ' + tScore + '/100. ' +
        epaNote +
        'On-site parking and car-share programs are recommended to address service gaps.'
      );
    } else if (tScore !== null) {
      var tDesc = tScore >= 70 ? 'strong' : tScore >= 40 ? 'moderate' : 'limited';
      var near = typeof t.nearbyStopCount === 'number' ? t.nearbyStopCount : null;
      var zone = typeof t.stopsWithinZoneRadius === 'number' ? t.stopsWithinZoneRadius : null;
      var stopsNote = (near !== null && zone !== null && t.todLabel && radiusText)
        ? near + ' confirmed transit stop(s) within ' + t.todLabel + ' and ' + zone + ' within ' + radiusText +
          (typeof t.nearbyAgencyCount === 'number' && t.nearbyAgencyCount > 0
            ? ' (' + t.nearbyAgencyCount + ' agenc' + (t.nearbyAgencyCount === 1 ? 'y' : 'ies') + ' within ' + t.todLabel + ')' : '') + ', '
        : '';
      parts.push(
        'Transit accessibility within the PMA is ' + tDesc + ', with ' + stopsNote +
        'a composite score of ' + tScore + '/100 ' +
        '(walk score: ' + (t.walkScore === null || t.walkScore === undefined ? 'N/A' : t.walkScore) + '). ' +
        (stopsNote && t.todDisclosure ? t.todDisclosure + ' ' : '') +
        epaNote +
        (t.highFrequencyUnavailableReason ? 'Service frequency is not scored: the stop data has no schedules. ' : '') +
        (tScore < 40 ? 'On-site parking and car-share programs are recommended to address service gaps.' : '')
      );
    }

    // Opportunities
    var o = scoreRun.opportunities || {};
    var oz = o.siteOpportunityZone || {};
    var ozSource = (oz.vintage ? ' Designation vintage: ' + oz.vintage + '.' : '') +
      (oz.source_url ? ' Source: ' + oz.source_url : '');
    if (oz.inZone === true) {
      parts.push('The exact site is within a federally designated Opportunity Zone' +
        (oz.geoid ? ' (GEOID ' + oz.geoid + ')' : '') + '.' + ozSource);
    } else if (oz.inZone === false) {
      parts.push('The exact site is outside the mapped Opportunity Zone polygons.' + ozSource);
    } else {
      parts.push('The site’s Opportunity Zone status is unavailable: ' +
        (oz.unavailableReason || 'exact site coordinates and designation polygons are required.'));
    }

    // Infrastructure
    var i = scoreRun.infrastructure || {};
    // floodRiskPercent is null when no FEMA lookup succeeded. `|| 0` previously
    // turned that into a confident 0 %, which reads as "no flood risk found".
    var floodKnown = i.floodRiskPercent != null;
    var floodPct = floodKnown ? Math.round(toNum(i.floodRiskPercent) * 100) : null;
    if (floodKnown ? floodPct > 0 : (i.floodUnavailableReason || i.sewerCapacityAdequate === false)) {
      var infraNotes = [];
      if (!floodKnown) {
        infraNotes.push('flood exposure could not be determined from FEMA data and must be confirmed by a flood determination');
      } else if (floodPct > 10) {
        infraNotes.push(floodPct + ' % of the site area is in a FEMA flood zone');
      }
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

    // Optional confidence disclosure (populated when PMAProvenance is loaded)
    // Integration point for future PMA confidence badge UI.
    if (typeof window !== 'undefined' && window.PMAProvenance && scoreRun.run_id) {
      var provenanceRecord = window.PMAProvenance.getRecord(scoreRun.run_id);
      if (provenanceRecord && provenanceRecord.confidence !== 'high') {
        parts.push(window.PMAProvenance.getDisclosureNote(provenanceRecord));
      }
    }

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
      run_id:               scoreRun.run_id || lastRunId,
      generated_at:         _ts(),
      schema_version:       SCHEMA_VERSION,
      data_vintage:         scoreRun.data_vintage || DATA_VINTAGE,
      lodes_vintage:        scoreRun.lodes_vintage || LODES_VINTAGE,
      narrative:            generateNarrative(scoreRun),
      layers:               getLayerOrder(),
      component_weights: {
        commuting:    'LEHD/LODES ' + (scoreRun.lodes_vintage || LODES_VINTAGE),
        barriers:     'USGS NHD + NLCD',
        schools:      'NCES CCD School Locations 2021-22 (locations only; no performance measure)',
        transit:      'NTD + EPA Smart Location',
        opportunities: 'OZ + HUD AFFH + Opportunity Atlas',
        infrastructure: 'FEMA + NOAA + USDA Food Atlas'
      },
      data_quality:         scoreRun.dataQuality || 'STANDARD',
      alternative_pmas:     scoreRun.alternativePmas || [],
      pma_tract_selection:  scoreRun.pmaTractSelection || null
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
    var full  = Object.assign({}, scoreRun, { commuting: commutingCapture(scoreRun.commuting), auditTrail: trail });
    var competitive = scoreRun.competitiveSet || {};
    var coverage = competitive.nhpdCoverage || { status: 'unavailable', complete: false,
      recordCount: null, generated: null,
      unavailableReason: 'NHPD coverage is unverified. Preservation totals and risk are unknown; no matching record does not mean no preservation risk.' };
    full.competitiveSet = Object.assign({}, competitive, { nhpdCoverage: coverage,
      nhpdAssisted: coverage.recordCount == null ? null : competitive.nhpdAssisted,
      preservationRiskTotal: null, preservationRiskUnavailableReason: coverage.unavailableReason });
    // Cached pre-coverage runs are exported with today's absence contract.
    // Keep their observed counts and ratio when supported, never their risk tier.
    var absorption = scoreRun.absorptionRisk || (scoreRun._analysisResults && scoreRun._analysisResults.absorptionRisk);
    if (!coverage.complete && absorption) {
      full.absorptionRisk = Object.assign({}, absorption, {
        risk: null, basis: 'observed-records-only', unavailableReason: coverage.unavailableReason,
        captureRate: absorption.totalCompetitiveUnits > 0 ? absorption.captureRate : null
      });
    }
    if (scoreRun._analysisResults) {
      full._analysisResults = Object.assign({}, scoreRun._analysisResults, {
        commuting: commutingCapture(scoreRun._analysisResults.commuting),
        competitiveSet: full.competitiveSet,
        absorptionRisk: full.absorptionRisk
      });
    }
    if (scoreRun.justification) {
      full.justification = Object.assign({}, scoreRun.justification, { narrative: trail.narrative });
    }
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
    if (commuting && (toNum(commuting.lodesWorkplaces) > 0 || commutingCapture(commuting).captureRate !== null)) present++;
    if (schools   && toNum(schools.schoolsAligned || schools.schoolDistrictsAligned) > 0) present++;
    if (transit   && Number.isFinite(transit.transitAccessibilityScore)) present++;
    if (opps && ((opps.siteOpportunityZone && typeof opps.siteOpportunityZone.inZone === 'boolean') ||
        Number.isFinite(opps.fairHousingScore) || Number.isFinite(opps.economicMobilityPercentile))) present++;
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
