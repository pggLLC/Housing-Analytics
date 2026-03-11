/**
 * js/pma-confidence.js
 * Heuristic confidence scoring for the PMA (Public Market Analysis) engine.
 *
 * Computes a 0–100 confidence score from five independent factors:
 *   1. Data completeness  — % of tracts with non-null ACS metric values
 *   2. Temporal freshness — age of ACS vintage year vs. current date
 *   3. Geographic coverage — count of LIHTC projects vs. expected baseline
 *   4. Sample size adequacy — minimum tract count for stable aggregate
 *   5. Buffer proximity  — how many tracts fall within the analysis buffer
 *
 * Confidence levels:
 *   🟢 High   (≥80) — Full confidence in PMA score
 *   🟡 Medium (60–79) — Moderate; recommend validation
 *   🔴 Low    (<60) — Sparse data; treat as preliminary
 *
 * Exposed as window.PMAConfidence.
 */
(function () {
  'use strict';

  /* ── Configuration ─────────────────────────────────────────────── */
  var CONFIG = {
    // Target data vintage year (ACS 5-Year data); update when Census releases new data
    TARGET_ACS_VINTAGE:       2022,
    // Target statewide counts — TARGET_ACS_TRACTS matches STATEWIDE_TRACT_COUNT in market-analysis.js
    TARGET_ACS_TRACTS:        1500,
    TARGET_LIHTC_PROJECTS:    500,
    TARGET_CENTROIDS:         1500,
    // Production-ready threshold: ≥80% statewide tract coverage
    PRODUCTION_THRESHOLD:     0.80,
    // Minimum buffer tracts for a reliable aggregate
    MIN_BUFFER_TRACTS:        5,
    TARGET_BUFFER_TRACTS:     20,
    // Factor weights — must sum to 1.0
    WEIGHTS: {
      completeness:  0.25,
      freshness:     0.20,
      lihtcCoverage: 0.20,
      sampleSize:    0.20,
      bufferDepth:   0.15
    }
  };

  /* ── Factor 1: Data completeness ───────────────────────────────── */
  /**
   * Measures the proportion of required ACS fields that are non-null
   * across the loaded tracts.
   * @param {Array} acsTracts
   * @returns {number} 0–100
   */
  function scoreCompleteness(acsTracts) {
    if (!acsTracts || !acsTracts.length) return 0;
    var REQUIRED_FIELDS = [
      'median_gross_rent', 'median_hh_income', 'cost_burden_rate',
      'vacancy_rate', 'renter_hh', 'total_hh'
    ];
    var totalChecks = 0, nonNullChecks = 0;
    acsTracts.forEach(function (t) {
      REQUIRED_FIELDS.forEach(function (field) {
        totalChecks++;
        if (t[field] !== null && t[field] !== undefined && t[field] !== '') nonNullChecks++;
      });
    });
    return totalChecks ? Math.round((nonNullChecks / totalChecks) * 100) : 0;
  }

  /* ── Factor 2: Temporal freshness ──────────────────────────────── */
  /**
   * Penalises data older than the target vintage.
   * ACS releases a new 5-year dataset roughly every year.
   * @param {number|string} [generatedYear]  - Vintage year of the data (e.g. 2022)
   * @returns {number} 0–100
   */
  function scoreFreshness(generatedYear) {
    var vintage = parseInt(generatedYear, 10);
    if (isNaN(vintage)) return 60; // unknown → moderate
    var current = new Date().getFullYear();
    var ageYears = current - vintage;
    if (ageYears <= 1)  return 100;
    if (ageYears <= 2)  return 90;
    if (ageYears <= 3)  return 75;
    if (ageYears <= 4)  return 60;
    if (ageYears <= 6)  return 40;
    return 20; // > 6 years stale
  }

  /* ── Factor 3: Geographic LIHTC coverage ───────────────────────── */
  /**
   * Measures LIHTC project count relative to expected statewide baseline.
   * @param {number} lihtcCount
   * @returns {number} 0–100
   */
  function scoreLihtcCoverage(lihtcCount) {
    if (!lihtcCount) return 0;
    return Math.min(100, Math.round((lihtcCount / CONFIG.TARGET_LIHTC_PROJECTS) * 100));
  }

  /* ── Factor 4: Sample size adequacy ────────────────────────────── */
  /**
   * Adequate total statewide tract count enables stable aggregate statistics.
   * @param {number} tractCount
   * @returns {number} 0–100
   */
  function scoreSampleSize(tractCount) {
    if (!tractCount) return 0;
    return Math.min(100, Math.round((tractCount / CONFIG.TARGET_ACS_TRACTS) * 100));
  }

  /* ── Factor 5: Buffer proximity (tracts in buffer) ─────────────── */
  /**
   * How many tracts fall within the analysis buffer.
   * Very few buffer tracts → unreliable local aggregate.
   * @param {number} bufferTractCount
   * @returns {number} 0–100
   */
  function scoreBufferDepth(bufferTractCount) {
    if (!bufferTractCount) return 0;
    if (bufferTractCount < CONFIG.MIN_BUFFER_TRACTS) {
      return Math.round((bufferTractCount / CONFIG.MIN_BUFFER_TRACTS) * 50);
    }
    return Math.min(100, 50 + Math.round(
      ((bufferTractCount - CONFIG.MIN_BUFFER_TRACTS) /
       (CONFIG.TARGET_BUFFER_TRACTS - CONFIG.MIN_BUFFER_TRACTS)) * 50
    ));
  }

  /* ── Composite confidence score ─────────────────────────────────── */
  /**
   * Compute the overall heuristic confidence score (0–100).
   *
   * @param {object} params
   * @param {Array}  params.acsTracts      - Loaded ACS tract records
   * @param {number} params.lihtcCount     - Number of LIHTC features loaded
   * @param {number} params.centroidCount  - Number of tract centroids loaded
   * @param {number} params.bufferTracts   - Number of tracts within the analysis buffer
   * @param {number} [params.acsVintage]   - ACS data vintage year (e.g. 2022)
   * @returns {{ score: number, level: string, color: string, factors: object }}
   */
  function compute(params) {
    params = params || {};
    var acsTracts     = params.acsTracts     || [];
    var lihtcCount    = params.lihtcCount    || 0;
    var bufferTracts  = params.bufferTracts  || 0;
    var acsVintage    = params.acsVintage    || CONFIG.TARGET_ACS_VINTAGE;

    var W = CONFIG.WEIGHTS;

    var factors = {
      completeness:  scoreCompleteness(acsTracts),
      freshness:     scoreFreshness(acsVintage),
      lihtcCoverage: scoreLihtcCoverage(lihtcCount),
      sampleSize:    scoreSampleSize(acsTracts.length),
      bufferDepth:   scoreBufferDepth(bufferTracts)
    };

    var score = Math.round(
      factors.completeness  * W.completeness  +
      factors.freshness     * W.freshness     +
      factors.lihtcCoverage * W.lihtcCoverage +
      factors.sampleSize    * W.sampleSize    +
      factors.bufferDepth   * W.bufferDepth
    );

    score = Math.min(100, Math.max(0, score));

    var level, color;
    if (score >= 80) {
      level = 'High';    color = 'var(--good)';
    } else if (score >= 60) {
      level = 'Medium';  color = 'var(--warn)';
    } else {
      level = 'Low';     color = 'var(--bad)';
    }

    return { score: score, level: level, color: color, factors: factors };
  }

  /* ── Render helper ────────────────────────────────────────────── */
  /**
   * Update a DOM element (by id) with the formatted confidence result.
   * @param {string} elementId
   * @param {{ score, level, color }} result
   */
  function renderConfidenceBadge(elementId, result) {
    var el = document.getElementById(elementId);
    if (!el) return;
    var emoji = result.score >= 80 ? '🟢' : (result.score >= 60 ? '🟡' : '🔴');
    el.textContent = emoji + ' ' + result.score + '% — ' + result.level;
    el.style.color = result.color;
    el.setAttribute('title',
      'Completeness: ' + result.factors.completeness + '%' +
      '  |  Freshness: ' + result.factors.freshness + '%' +
      '  |  LIHTC coverage: ' + result.factors.lihtcCoverage + '%' +
      '  |  Sample size: ' + result.factors.sampleSize + '%' +
      '  |  Buffer depth: ' + result.factors.bufferDepth + '%'
    );
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.PMAConfidence = {
    compute:               compute,
    renderConfidenceBadge: renderConfidenceBadge,
    scoreCompleteness:     scoreCompleteness,
    scoreFreshness:        scoreFreshness,
    scoreLihtcCoverage:    scoreLihtcCoverage,
    scoreSampleSize:       scoreSampleSize,
    scoreBufferDepth:      scoreBufferDepth,
    CONFIG:                CONFIG
  };

}());
