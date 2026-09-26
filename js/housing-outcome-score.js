/**
 * js/housing-outcome-score.js
 * Housing Outcome Score (HOS) — composite 0-100 metric combining four
 * dimensions of project viability:
 *
 *   1. Need Coverage  (30%) — How well does the proposed concept address
 *      the community's identified affordability gap?
 *   2. Policy Alignment (20%) — Does the jurisdiction have supportive
 *      housing policies, QCT/DDA designation, and Prop 123 participation?
 *   3. Financial Feasibility (30%) — Site selection score, deal predictor
 *      confidence, and capital stack health.
 *   4. Site Quality (20%) — Access to amenities, transit, schools; low
 *      environmental risk; market opportunity band.
 *
 * The HOS provides a single decision-support number that integrates
 * data from all 5 workflow steps.  It updates incrementally as the user
 * completes each step — partial scores are shown with a confidence
 * indicator reflecting data completeness.
 *
 * Depends on (all optional — degrades gracefully):
 *   WorkflowState, SiteState, HNAState, SiteSelectionScore,
 *   LIHTCDealPredictor, HousingNeedsFitAnalyzer
 *
 * Exposes: window.HousingOutcomeScore
 */
(function (global) {
  'use strict';

  /* ── Dimension weights (must sum to 1.0) ────────────────────────── */
  var WEIGHTS = {
    needCoverage:        0.30,
    policyAlignment:     0.20,
    financialFeasibility: 0.30,
    siteQuality:         0.20
  };

  /* ── Helpers ────────────────────────────────────────────────────── */

  // Absence is returned as absence. The old form ended in `(fallback || 0)`,
  // which turned an explicit `null` fallback into a measured 0: with no market
  // analysis run, pmaScore became a site score of 0 and the panel read
  // "0 / Grade F". A caller that wants a number for a missing value must say
  // so; with no fallback given, a missing value is null.
  function _n(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback === undefined ? null : fallback;
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback === undefined ? null : fallback);
  }

  function _clamp(v) {
    return Math.min(100, Math.max(0, Math.round(v)));
  }

  function _pct(n, d) {
    return d > 0 ? Math.min(100, (n / d) * 100) : 0;
  }

  /* ── Dimension scorers ──────────────────────────────────────────── */

  /**
   * 1. Need Coverage (0-100)
   * Sources: HNA affordability gap, HousingNeedsFitAnalyzer coverage %,
   *          CHAS cost burden data
   */
  function _scoreNeedCoverage(data) {
    var result = { score: null, available: false, inputs: {}, measured: 0, components: 1 };

    // Best case: HousingNeedsFitAnalyzer coveragePct
    if (data.hnsFit && data.hnsFit.coveragePct != null) {
      result.score = _clamp(data.hnsFit.coveragePct);
      result.available = true;
      result.inputs.coveragePct = data.hnsFit.coveragePct;
      result.inputs.alignment = data.hnsFit.alignment;
      result.measured = 1;
      return result;
    }

    // Fallback: derive from gap data + scenario units
    if (data.affordabilityGap && data.scenarioUnits) {
      var gap = data.affordabilityGap;
      var total = _n(gap.totalUndersupply);
      var units = _n(data.scenarioUnits);
      if (total != null && total > 0 && units != null) {
        result.score = _clamp(_pct(units, total));
        result.available = true;
        result.inputs.totalGap = total;
        result.inputs.proposedUnits = units;
        result.measured = 1;
      }
    }

    // Partial: just knowing the gap exists gives some credit
    if (!result.available && data.affordabilityGap) {
      var g = data.affordabilityGap;
      var gapTotal = _n(g.totalUndersupply);
      if (gapTotal != null && gapTotal > 0) {
        result.score = 20; // Partial credit for having identified the need
        result.available = true;
        result.inputs.gapIdentified = true;
        result.measured = 1;
      }
    }

    if (!result.available) {
      result.unavailableReason = 'No housing-need coverage measure (needs-fit coverage, or the affordability gap with a unit count) is available.';
    }
    return result;
  }

  /**
   * 2. Policy Alignment (0-100)
   * Sources: QCT/DDA flags, housing scorecard dimensions, Prop 123
   */
  // A component whose input is unknown (null) is excluded from both the
  // points and the maximum, and listed in inputs.missing — it is not scored
  // as a "no". Previously an unknown scorecard or Prop 123 status still added
  // its maximum, so a missing input counted as zero points.
  function _scorePolicyAlignment(data) {
    var result = { score: null, available: false, inputs: {}, measured: 0, components: 4 };
    var points = 0;
    var maxPoints = 0;
    var missing = [];

    // QCT flag (20 pts)
    if (data.qct != null) {
      maxPoints += 20;
      result.available = true;
      result.measured++;
      if (data.qct) { points += 20; result.inputs.qct = true; }
    } else {
      missing.push('QCT designation');
    }

    // DDA flag (15 pts)
    if (data.dda != null) {
      maxPoints += 15;
      result.available = true;
      result.measured++;
      if (data.dda) { points += 15; result.inputs.dda = true; }
    } else {
      missing.push('DDA designation');
    }

    // Scorecard dimensions (up to 45 pts — 7 dimensions at ~6.4 pts each)
    if (data.scorecard) {
      result.available = true;
      result.measured++;
      var dims = ['has_inclusionary_zoning', 'has_housing_authority', 'has_land_bank',
                  'has_density_bonus', 'prop123_participant', 'has_housing_trust_fund',
                  'has_affordable_housing_plan'];
      var scorecardPts = 0;
      for (var i = 0; i < dims.length; i++) {
        maxPoints += 6.43;
        if (data.scorecard[dims[i]]) scorecardPts += 6.43;
      }
      points += scorecardPts;
      result.inputs.scorecardDims = Math.round(scorecardPts / 6.43);
    } else {
      missing.push('housing policy scorecard');
    }

    // Prop 123 fast-track eligible (20 pts)
    if (data.prop123FastTrack != null) {
      maxPoints += 20;
      result.available = true;
      result.measured++;
      if (data.prop123FastTrack) { points += 20; result.inputs.fastTrack = true; }
    } else {
      missing.push('Prop 123 fast-track status');
    }

    if (missing.length) result.inputs.missing = missing;
    if (result.available && maxPoints > 0) {
      result.score = _clamp((points / maxPoints) * 100);
    } else {
      result.available = false;
      result.unavailableReason = 'No policy input (QCT/DDA designation, policy scorecard, Prop 123 status) is known.';
    }
    return result;
  }

  /**
   * 3. Financial Feasibility (0-100)
   * Sources: site selection score, deal predictor confidence, capital stack
   */
  function _scoreFinancialFeasibility(data) {
    var result = { score: null, available: false, inputs: {}, measured: 0, components: 3 };
    var components = [];

    // Site selection final score (0-100)
    if (data.siteScore != null) {
      components.push({ val: _clamp(data.siteScore), weight: 0.40 });
      result.available = true;
      result.measured++;
      result.inputs.siteScore = data.siteScore;
    }

    // Deal predictor confidence
    if (data.dealConfidence) {
      var confMap = { high: 85, medium: 60, low: 35 };
      if (Object.prototype.hasOwnProperty.call(confMap, data.dealConfidence)) {
        components.push({ val: confMap[data.dealConfidence], weight: 0.30 });
        result.available = true;
        result.measured++;
        result.inputs.dealConfidence = data.dealConfidence;
      } else {
        result.inputs.dealConfidenceUnavailableReason =
          'Deal confidence is missing or unrecognized; it was excluded from the financial-feasibility score.';
      }
    }

    // Capital stack gap ratio (lower gap = higher score)
    if (data.gapPct != null) {
      // gapPct is the unfunded gap as % of TDC; 0% = perfect, 30%+ = bad
      var gapScore = _clamp(100 - (data.gapPct * 3.33));
      components.push({ val: gapScore, weight: 0.30 });
      result.available = true;
      result.measured++;
      result.inputs.gapPct = data.gapPct;
    }

    if (components.length > 0) {
      var totalWeight = 0;
      var weighted = 0;
      for (var i = 0; i < components.length; i++) {
        weighted += components[i].val * components[i].weight;
        totalWeight += components[i].weight;
      }
      result.score = _clamp(weighted / totalWeight);
    }

    var finMissing = [];
    if (data.siteScore == null) finMissing.push('site selection score');
    if (!Object.prototype.hasOwnProperty.call({ high: 1, medium: 1, low: 1 }, data.dealConfidence)) finMissing.push('deal confidence');
    if (data.gapPct == null) finMissing.push('capital stack gap');
    if (finMissing.length) result.inputs.missing = finMissing;
    if (!result.available) {
      result.unavailableReason = 'No financial input (site selection score, deal confidence, capital stack gap) is available.';
    }
    return result;
  }

  /**
   * 4. Site Quality (0-100)
   * Sources: site selection access + feasibility scores, opportunity band
   */
  function _scoreSiteQuality(data) {
    var result = { score: null, available: false, inputs: {}, measured: 0, components: 3 };
    var components = [];

    // Access score from site selection (0-100)
    if (data.accessScore != null) {
      components.push({ val: _clamp(data.accessScore), weight: 0.40 });
      result.available = true;
      result.measured++;
      result.inputs.accessScore = data.accessScore;
    }

    // Feasibility score from site selection (0-100)
    if (data.feasibilityScore != null) {
      components.push({ val: _clamp(data.feasibilityScore), weight: 0.35 });
      result.available = true;
      result.measured++;
      result.inputs.feasibilityScore = data.feasibilityScore;
    }

    // Market score from site selection (0-100)
    if (data.marketScore != null) {
      components.push({ val: _clamp(data.marketScore), weight: 0.25 });
      result.available = true;
      result.measured++;
      result.inputs.marketScore = data.marketScore;
    }

    if (components.length > 0) {
      var totalWeight = 0;
      var weighted = 0;
      for (var i = 0; i < components.length; i++) {
        weighted += components[i].val * components[i].weight;
        totalWeight += components[i].weight;
      }
      result.score = _clamp(weighted / totalWeight);
    }

    var siteMissing = [];
    if (data.accessScore == null) siteMissing.push('access score');
    if (data.feasibilityScore == null) siteMissing.push('feasibility score');
    if (data.marketScore == null) siteMissing.push('market score');
    if (siteMissing.length) result.inputs.missing = siteMissing;
    if (!result.available) {
      result.unavailableReason = 'No site-quality input (access, feasibility or market score from the market analysis) is available.';
    }
    return result;
  }

  /* ── Data collector ─────────────────────────────────────────────── */

  /**
   * Gather all available data from the various state systems.
   * Returns a flat object with all input fields.
   */
  function _gatherData() {
    var d = {};
    var WS = global.WorkflowState;
    var SS = global.SiteState;

    // From WorkflowState
    if (WS && typeof WS.getStep === 'function') {
      var market = WS.getStep('market') || {};
      d.siteScore        = _n(market.pmaScore, null);
      d.qct              = market.qctFlag != null ? !!market.qctFlag : null;
      d.dda              = market.ddaFlag != null ? !!market.ddaFlag : null;
      d.accessScore      = market.dimensions ? _n(market.dimensions.access, null) : null;
      d.feasibilityScore = market.dimensions ? _n(market.dimensions.feasibility, null) : null;
      d.marketScore      = market.dimensions ? _n(market.dimensions.market, null) : null;

      var scenario = WS.getStep('scenario') || {};
      d.scenarioUnits = _n(scenario.totalUnits, null);

      var deal = WS.getStep('deal') || {};
      d.dealConfidence = deal.confidence || null;
      d.gapPct         = deal.results ? _n(deal.results.gapPct, null) : null;
    }

    // From SiteState PMA results
    if (SS && typeof SS.getPmaResults === 'function') {
      var pma = SS.getPmaResults() || {};
      if (d.siteScore == null)        d.siteScore = _n(pma.score || pma.final_score, null);
      if (d.qct == null && pma.qctFlag != null)  d.qct = !!pma.qctFlag;
      if (d.dda == null && pma.ddaFlag != null)  d.dda = !!pma.ddaFlag;

      var sr = pma.siteScoreResult || pma;
      if (d.accessScore == null)      d.accessScore = _n(sr.access_score, null);
      if (d.feasibilityScore == null) d.feasibilityScore = _n(sr.feasibility_score, null);
      if (d.marketScore == null)      d.marketScore = _n(sr.market_score, null);
    }

    // From HNA State
    if (global.HNAState && global.HNAState.state) {
      var hnaState = global.HNAState.state;
      d.affordabilityGap = hnaState.affordabilityGap || null;
      d.hnsFit = hnaState.hnsFit || null;
    }

    // From HNA Ranking (scorecard data)
    if (global.HNARanking && typeof global.HNARanking.getScorecardData === 'function') {
      d.scorecard = global.HNARanking.getScorecardData();
    }

    // Prop 123 fast-track
    if (global.HNAState && global.HNAState.state && global.HNAState.state.prop123) {
      var fastTrack = global.HNAState.state.prop123.fastTrackEligible;
      d.prop123FastTrack = fastTrack != null ? !!fastTrack : null;
    }

    return d;
  }

  /* ── Main compute function ──────────────────────────────────────── */

  /**
   * Compute the Housing Outcome Score.
   *
   * @param {Object} [overrides] - Optional data overrides (for testing)
   * @returns {{
   *   score:        number|null,  — Composite 0-100; null when unavailable
   *   grade:        string|null,  — A/B/C/D/F letter grade; null when unavailable
   *   available:    boolean,      — false when too little is measured to score
   *   unavailableReason: string|null,
   *   confidence:   string,       — 'high'|'medium'|'low'
   *   dimensions:   Object,       — Per-dimension {score, weight, available, inputs, unavailableReason}
   *   dataComplete: number,       — 0-100 pct of scoring inputs actually measured
   *   missingInputs: string[],    — the inputs that were excluded as unknown
   *   summary:      string        — One-sentence narrative
   * }}
   */
  function compute(overrides) {
    var data = _gatherData();
    if (overrides) {
      for (var k in overrides) {
        if (overrides.hasOwnProperty(k)) data[k] = overrides[k];
      }
    }

    // Score each dimension
    var need    = _scoreNeedCoverage(data);
    var policy  = _scorePolicyAlignment(data);
    var finance = _scoreFinancialFeasibility(data);
    var site    = _scoreSiteQuality(data);

    var dims = {
      needCoverage:         { score: need.score,    weight: WEIGHTS.needCoverage,         available: need.available,    inputs: need.inputs,    unavailableReason: need.unavailableReason || null },
      policyAlignment:      { score: policy.score,  weight: WEIGHTS.policyAlignment,      available: policy.available,  inputs: policy.inputs,  unavailableReason: policy.unavailableReason || null },
      financialFeasibility: { score: finance.score, weight: WEIGHTS.financialFeasibility, available: finance.available, inputs: finance.inputs, unavailableReason: finance.unavailableReason || null },
      siteQuality:          { score: site.score,    weight: WEIGHTS.siteQuality,          available: site.available,    inputs: site.inputs,    unavailableReason: site.unavailableReason || null }
    };
    var scored = [need, policy, finance, site];

    // Composite score (weighted average of available dimensions)
    var totalWeight = 0;
    var weighted = 0;
    var availableCount = 0;

    for (var key in dims) {
      if (dims[key].available) {
        weighted += dims[key].score * dims[key].weight;
        totalWeight += dims[key].weight;
        availableCount++;
      }
    }

    // Coverage counts the inputs actually measured, not the dimensions that
    // have at least one: a dimension scored from one of four inputs is not
    // "available" in the sense a reader of "75% of workflow data" assumes.
    var measured = 0, possible = 0, missingInputs = [];
    for (var s = 0; s < scored.length; s++) {
      measured += scored[s].measured;
      possible += scored[s].components;
    }
    for (var mk in dims) {
      if (dims[mk].inputs && dims[mk].inputs.missing) missingInputs = missingInputs.concat(dims[mk].inputs.missing);
      else if (!dims[mk].available) missingInputs.push(mk === 'needCoverage' ? 'housing-need coverage' : mk);
    }
    var dataComplete = possible > 0 ? Math.round((measured / possible) * 100) : 0;

    // Confidence based on data completeness
    var confidence = dataComplete >= 75 ? 'high' : dataComplete >= 50 ? 'medium' : 'low';

    // The score rests on the market analysis: the site selection score and
    // the site-quality scores are its outputs, and they carry half the
    // weight. Without it there is no overall score — a weighted average of
    // whatever else happens to be present is not the same metric.
    var marketMeasured = data.siteScore != null || data.accessScore != null ||
                         data.feasibilityScore != null || data.marketScore != null;
    var unavailableReason = null;
    if (!marketMeasured) {
      unavailableReason = 'Run the market analysis first — the Housing Outcome Score needs its site selection and site-quality scores.';
    } else if (availableCount < 2) {
      unavailableReason = 'Too few scoring dimensions are measured to compute an overall score. Complete more workflow steps.';
    }

    if (unavailableReason) {
      // No score, so no confidence in one: never "High" beside a blank.
      return {
        score:             null,
        grade:             null,
        available:         false,
        unavailableReason: unavailableReason,
        confidence:        'low',
        dimensions:        dims,
        dataComplete:      dataComplete,
        missingInputs:     missingInputs,
        summary:           'Housing Outcome Score unavailable. ' + unavailableReason
      };
    }

    var compositeScore = _clamp(weighted / totalWeight);

    // Letter grade
    var grade;
    if (compositeScore >= 85) grade = 'A';
    else if (compositeScore >= 70) grade = 'B';
    else if (compositeScore >= 55) grade = 'C';
    else if (compositeScore >= 40) grade = 'D';
    else grade = 'F';

    // Summary narrative
    var summary = _buildSummary(compositeScore, grade, confidence, dims);
    if (missingInputs.length) {
      summary += ' Not measured, excluded from the score: ' + missingInputs.join(', ') + '.';
    }

    return {
      score:        compositeScore,
      grade:        grade,
      available:    true,
      unavailableReason: null,
      confidence:   confidence,
      dimensions:   dims,
      dataComplete: dataComplete,
      missingInputs: missingInputs,
      summary:      summary
    };
  }

  function _buildSummary(score, grade, confidence, dims) {
    var parts = [];
    parts.push('Housing Outcome Score: ' + score + '/100 (Grade ' + grade + ').');

    // Highlight strongest/weakest
    var strongest = null, weakest = null;
    var strongVal = -1, weakVal = 101;
    var labels = {
      needCoverage: 'need coverage',
      policyAlignment: 'policy alignment',
      financialFeasibility: 'financial feasibility',
      siteQuality: 'site quality'
    };

    for (var key in dims) {
      if (dims[key].available) {
        if (dims[key].score > strongVal) { strongVal = dims[key].score; strongest = key; }
        if (dims[key].score < weakVal)   { weakVal = dims[key].score;   weakest = key; }
      }
    }

    if (strongest) parts.push('Strongest: ' + labels[strongest] + ' (' + dims[strongest].score + ').');
    if (weakest && weakest !== strongest) parts.push('Needs attention: ' + labels[weakest] + ' (' + dims[weakest].score + ').');

    if (confidence === 'low') {
      parts.push('Complete more workflow steps to improve score confidence.');
    }

    return parts.join(' ');
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  global.HousingOutcomeScore = {
    compute: compute,
    WEIGHTS: WEIGHTS
  };

})(typeof window !== 'undefined' ? window : this);
