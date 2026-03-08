/**
 * js/market-analysis-enhancements.js
 * Enhanced PMA capabilities: peer benchmarking, pipeline analysis, scenario modeling.
 *
 * Responsibilities:
 *  - benchmarkVsReference(score, result, referenceProjects) — percentile ranking
 *  - analyzeCompetitivePipeline(lihtcFeatures, lat, lon, miles) — pipeline analysis
 *  - generateScenarios(acs, existingUnits, scenarioList) — what-if modeling
 *  - exportWithMetadata(result, quality, scenarios) — full audit trail export
 *
 * Exposed as window.PMAEnhancements.
 * Dependencies: PMAEngine (window.PMAEngine) must be loaded first.
 */
(function () {
  'use strict';

  /* ── Pipeline thresholds ──────────────────────────────────────────── */
  var PIPELINE_STAGES = {
    prePermit:   'Pre-Permit',
    entitled:    'Entitled',
    construction: 'Under Construction',
    complete:    'Complete'
  };

  var SATURATION_THRESHOLD = 3; // competitive projects before saturation warning

  /* ── Peer Benchmarking ───────────────────────────────────────────── */
  /**
   * Rank the given score against a reference project set.
   * @param {number} score - overall PMA score (0–100)
   * @param {object} result - full PMA result from computePma
   * @param {Array}  referenceProjects - projects from reference-projects.json
   * @returns {object} benchmarkResult
   */
  function benchmarkVsReference(score, result, referenceProjects) {
    if (!referenceProjects || !referenceProjects.length) {
      return { available: false, reason: 'No reference projects loaded.' };
    }

    var scores = referenceProjects
      .filter(function (p) { return typeof p.pma_score === 'number'; })
      .map(function (p) { return p.pma_score; })
      .sort(function (a, b) { return a - b; });

    if (!scores.length) {
      return { available: false, reason: 'Reference projects have no PMA scores.' };
    }

    // Percentile rank: fraction of reference scores below this score
    var below = scores.filter(function (s) { return s < score; }).length;
    var percentile = Math.round((below / scores.length) * 100);

    // Find comparable projects (within ±10 points)
    var comparable = referenceProjects
      .filter(function (p) {
        return typeof p.pma_score === 'number' &&
               Math.abs(p.pma_score - score) <= 10;
      })
      .sort(function (a, b) { return Math.abs(a.pma_score - score) - Math.abs(b.pma_score - score); })
      .slice(0, 5);

    var mean = scores.reduce(function (s, v) { return s + v; }, 0) / scores.length;
    var median = scores[Math.floor(scores.length / 2)];

    // Identify the market type distribution for context
    var marketTypeCounts = {};
    referenceProjects.forEach(function (p) {
      var mt = p.market_type || 'unknown';
      marketTypeCounts[mt] = (marketTypeCounts[mt] || 0) + 1;
    });

    return {
      available:      true,
      score:          score,
      percentile:     percentile,
      referenceCount: scores.length,
      mean:           Math.round(mean * 10) / 10,
      median:         median,
      min:            scores[0],
      max:            scores[scores.length - 1],
      tier:           benchmarkTier(percentile),
      comparable:     comparable,
      marketTypes:    marketTypeCounts
    };
  }

  function benchmarkTier(percentile) {
    if (percentile >= 75) return { label: 'Top 25%',    color: 'var(--good)' };
    if (percentile >= 50) return { label: 'Top 50%',    color: 'var(--accent)' };
    if (percentile >= 25) return { label: 'Bottom 50%', color: 'var(--warn)' };
    return                       { label: 'Bottom 25%', color: 'var(--bad)'  };
  }

  /* ── Competitive Pipeline Analysis ──────────────────────────────── */
  /**
   * Analyse LIHTC supply within buffer by year cohort to infer pipeline.
   * Uses year_alloc to classify projects into recency stages.
   * @param {Array}  lihtcFeatures - all LIHTC features
   * @param {number} lat
   * @param {number} lon
   * @param {number} miles - buffer radius
   * @returns {object} pipelineResult
   */
  function analyzeCompetitivePipeline(lihtcFeatures, lat, lon, miles) {
    if (!lihtcFeatures || !lihtcFeatures.length) {
      return { available: false, projects: [], saturation: false };
    }

    var haversine = (window.PMAEngine && window.PMAEngine.haversine) || _haversine;
    var now       = new Date().getFullYear();

    var nearby = lihtcFeatures.filter(function (f) {
      var c = f.geometry && f.geometry.coordinates;
      if (!c) return false;
      return haversine(lat, lon, c[1], c[0]) <= miles;
    });

    // Classify by allocation year as a proxy for development stage
    var classified = nearby.map(function (f) {
      var p    = f.properties || {};
      var yr   = parseInt(p.YEAR_ALLOC || p.year_alloc || 0, 10);
      var dist = haversine(lat, lon,
                  (f.geometry.coordinates[1]),
                  (f.geometry.coordinates[0]));
      var stage;
      if (!yr || yr < now - 5) {
        stage = PIPELINE_STAGES.complete;
      } else if (yr >= now - 1) {
        stage = PIPELINE_STAGES.construction;
      } else if (yr >= now - 3) {
        stage = PIPELINE_STAGES.entitled;
      } else {
        stage = PIPELINE_STAGES.prePermit;
      }
      return {
        name:  p.PROJECT_NAME || p.project_name || 'LIHTC Project',
        city:  p.CITY || p.city || '',
        units: parseInt(p.TOTAL_UNITS || p.total_units || 0, 10),
        year:  yr,
        stage: stage,
        dist:  Math.round(dist * 10) / 10
      };
    });

    // Stage counts
    var stageCounts = {};
    Object.values(PIPELINE_STAGES).forEach(function (s) { stageCounts[s] = 0; });
    classified.forEach(function (p) { stageCounts[p.stage]++; });

    var activeCount = (stageCounts[PIPELINE_STAGES.prePermit] || 0) +
                      (stageCounts[PIPELINE_STAGES.entitled]   || 0) +
                      (stageCounts[PIPELINE_STAGES.construction] || 0);

    // Absorption timeline: rough estimate at 30% annual absorption
    var totalActiveUnits = classified
      .filter(function (p) { return p.stage !== PIPELINE_STAGES.complete; })
      .reduce(function (s, p) { return s + p.units; }, 0);
    var absorptionMonths = totalActiveUnits > 0 ? Math.ceil(totalActiveUnits / 50) : 0;

    return {
      available:       true,
      total:           nearby.length,
      active:          activeCount,
      saturation:      activeCount >= SATURATION_THRESHOLD,
      stageCounts:     stageCounts,
      totalActiveUnits: totalActiveUnits,
      estimatedAbsorptionMonths: absorptionMonths,
      projects:        classified.sort(function (a, b) { return a.dist - b.dist; }).slice(0, 10)
    };
  }

  /* ── Scenario Analysis ───────────────────────────────────────────── */
  /**
   * Run multiple what-if scenarios for different proposed unit counts.
   * @param {object} acs - aggregated ACS metrics
   * @param {number} existingUnits - existing LIHTC units in buffer
   * @param {Array}  scenarioList - array of {label, proposedUnits, amiMix}
   * @returns {Array} scenarioResults
   */
  function generateScenarios(acs, existingUnits, scenarioList) {
    if (!acs || !acs.renter_hh) return [];

    var computePma      = window.PMAEngine && window.PMAEngine.computePma;
    var simulateCapture = window.PMAEngine && window.PMAEngine.simulateCapture;
    if (!computePma || !simulateCapture) return [];

    return scenarioList.map(function (scenario) {
      var units   = scenario.proposedUnits || 0;
      var amiMix  = scenario.amiMix || { ami60: units };
      var pma     = computePma(acs, existingUnits, units);
      var capture = simulateCapture(acs.renter_hh, units, amiMix);

      return {
        label:        scenario.label || (units + ' units'),
        proposedUnits: units,
        amiMix:       amiMix,
        overall:      pma.overall,
        captureRisk:  pma.dimensions.captureRisk,
        captureRate:  capture.captureRate,
        risk:         capture.risk,
        flags:        pma.flags
      };
    });
  }

  /* ── Default scenario set ─────────────────────────────────────────── */
  function defaultScenarios(proposedUnits) {
    var base = proposedUnits || 100;
    return [
      { label: 'Baseline (' + base + ' units)',            proposedUnits: base,            amiMix: { ami60: base } },
      { label: 'Small (+' + Math.round(base * 0.5) + ')', proposedUnits: Math.round(base * 0.5),  amiMix: { ami60: Math.round(base * 0.5) } },
      { label: 'Large (+' + Math.round(base * 2) + ')',   proposedUnits: Math.round(base * 2),    amiMix: { ami60: Math.round(base * 2) } }
    ];
  }

  /* ── Full metadata export ─────────────────────────────────────────── */
  /**
   * Build a comprehensive export object with full provenance.
   * @param {object} result   - lastResult from runAnalysis
   * @param {object} quality  - from calculateDataQuality
   * @param {Array}  scenarios - from generateScenarios
   * @param {object} benchmark - from benchmarkVsReference
   * @param {object} pipeline  - from analyzeCompetitivePipeline
   * @returns {object} exportPayload
   */
  function exportWithMetadata(result, quality, scenarios, benchmark, pipeline) {
    return {
      exportedAt:     new Date().toISOString(),
      tool:           'Colorado Housing Analytics — Public Market Analysis (PMA)',
      version:        '2.0',
      provenance: {
        acsSources:   'US Census Bureau ACS 5-Year Estimates (B01003, B25003, B25004, B25070, B25064)',
        lihtcSource:  'HUD LIHTC Database (public)',
        geographySource: 'Census TIGERweb tract centroids',
        prop123Source: 'CHFA Prop 123 jurisdictions list',
        acsVintage:   (quality && quality.counts) ? 'ACS 2022 5-Year' : 'unknown',
        methodology:  'docs/MARKET_ANALYSIS_METHOD.md + docs/PMA_SCORING.md'
      },
      dataQuality:    quality || {},
      site: {
        lat:         result.lat,
        lon:         result.lon,
        bufferMiles: result.bufferMiles,
        tractCount:  result.tractCount
      },
      score: {
        overall:    result.overall,
        tier:       result.tier,
        dimensions: result.dimensions,
        flags:      result.flags,
        capture:    result.capture,
        rentRatio:  result.rentRatio
      },
      acs: result.acs || {},
      lihtc: {
        count:       result.lihtcCount,
        units:       result.lihtcUnits,
        prop123Count: result.prop123Count
      },
      benchmark:  benchmark  || { available: false },
      pipeline:   pipeline   || { available: false },
      scenarios:  scenarios  || [],
      calculationLog: {
        bufferTractIds: result._tractIds || [],
        fallbackUsed:   result._fallbackUsed || false,
        scoringWeights: (window.PMAEngine && window.PMAEngine.WEIGHTS) || {}
      }
    };
  }

  /* ── Haversine fallback ───────────────────────────────────────────── */
  function _haversine(lat1, lon1, lat2, lon2) {
    var R  = 3958.8;
    var dL = (lat2 - lat1) * Math.PI / 180;
    var dO = (lon2 - lon1) * Math.PI / 180;
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  window.PMAEnhancements = {
    benchmarkVsReference:       benchmarkVsReference,
    analyzeCompetitivePipeline: analyzeCompetitivePipeline,
    generateScenarios:          generateScenarios,
    defaultScenarios:           defaultScenarios,
    exportWithMetadata:         exportWithMetadata,
    PIPELINE_STAGES:            PIPELINE_STAGES,
    SATURATION_THRESHOLD:       SATURATION_THRESHOLD
  };

}());
