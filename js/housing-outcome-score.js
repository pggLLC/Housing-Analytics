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

  function _n(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback || 0);
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
    var result = { score: 0, available: false, inputs: {} };

    // Best case: HousingNeedsFitAnalyzer coveragePct
    if (data.hnsFit && data.hnsFit.coveragePct != null) {
      result.score = _clamp(data.hnsFit.coveragePct);
      result.available = true;
      result.inputs.coveragePct = data.hnsFit.coveragePct;
      result.inputs.alignment = data.hnsFit.alignment;
      return result;
    }

    // Fallback: derive from gap data + scenario units
    if (data.affordabilityGap && data.scenarioUnits) {
      var gap = data.affordabilityGap;
      var total = _n(gap.totalUndersupply);
      var units = _n(data.scenarioUnits);
      if (total > 0) {
        result.score = _clamp(_pct(units, total));
        result.available = true;
        result.inputs.totalGap = total;
        result.inputs.proposedUnits = units;
      }
    }

    // Partial: just knowing the gap exists gives some credit
    if (!result.available && data.affordabilityGap) {
      var g = data.affordabilityGap;
      if (_n(g.totalUndersupply) > 0) {
        result.score = 20; // Partial credit for having identified the need
        result.available = true;
        result.inputs.gapIdentified = true;
      }
    }

    return result;
  }

  /**
   * 2. Policy Alignment (0-100)
   * Sources: QCT/DDA flags, housing scorecard dimensions, Prop 123
   */
  function _scorePolicyAlignment(data) {
    var result = { score: 0, available: false, inputs: {} };
    var points = 0;
    var maxPoints = 0;

    // QCT flag (20 pts)
    maxPoints += 20;
    if (data.qct != null) {
      result.available = true;
      if (data.qct) { points += 20; result.inputs.qct = true; }
    }

    // DDA flag (15 pts)
    maxPoints += 15;
    if (data.dda != null) {
      result.available = true;
      if (data.dda) { points += 15; result.inputs.dda = true; }
    }

    // Scorecard dimensions (up to 45 pts — 7 dimensions at ~6.4 pts each)
    if (data.scorecard) {
      result.available = true;
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
      maxPoints += 45;
    }

    // Prop 123 fast-track eligible (20 pts)
    maxPoints += 20;
    if (data.prop123FastTrack != null) {
      result.available = true;
      if (data.prop123FastTrack) { points += 20; result.inputs.fastTrack = true; }
    }

    result.score = maxPoints > 0 ? _clamp((points / maxPoints) * 100) : 0;
    return result;
  }

  /**
   * 3. Financial Feasibility (0-100)
   * Sources: site selection score, deal predictor confidence, capital stack
   */
  function _scoreFinancialFeasibility(data) {
    var result = { score: 0, available: false, inputs: {} };
    var components = [];

    // Site selection final score (0-100)
    if (data.siteScore != null) {
      components.push({ val: _clamp(data.siteScore), weight: 0.40 });
      result.available = true;
      result.inputs.siteScore = data.siteScore;
    }

    // Deal predictor confidence
    if (data.dealConfidence) {
      var confMap = { high: 85, medium: 60, low: 35 };
      var confVal = confMap[data.dealConfidence] || 50;
      components.push({ val: confVal, weight: 0.30 });
      result.available = true;
      result.inputs.dealConfidence = data.dealConfidence;
    }

    // Capital stack gap ratio (lower gap = higher score)
    if (data.gapPct != null) {
      // gapPct is the unfunded gap as % of TDC; 0% = perfect, 30%+ = bad
      var gapScore = _clamp(100 - (data.gapPct * 3.33));
      components.push({ val: gapScore, weight: 0.30 });
      result.available = true;
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

    return result;
  }

  /**
   * 4. Site Quality (0-100)
   * Sources: site selection access + feasibility scores, opportunity band
   */
  function _scoreSiteQuality(data) {
    var result = { score: 0, available: false, inputs: {} };
    var components = [];

    // Access score from site selection (0-100)
    if (data.accessScore != null) {
      components.push({ val: _clamp(data.accessScore), weight: 0.40 });
      result.available = true;
      result.inputs.accessScore = data.accessScore;
    }

    // Feasibility score from site selection (0-100)
    if (data.feasibilityScore != null) {
      components.push({ val: _clamp(data.feasibilityScore), weight: 0.35 });
      result.available = true;
      result.inputs.feasibilityScore = data.feasibilityScore;
    }

    // Market score from site selection (0-100)
    if (data.marketScore != null) {
      components.push({ val: _clamp(data.marketScore), weight: 0.25 });
      result.available = true;
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
      d.prop123FastTrack = !!global.HNAState.state.prop123.fastTrackEligible;
    }

    return d;
  }

  /* ── Main compute function ──────────────────────────────────────── */

  /**
   * Compute the Housing Outcome Score.
   *
   * @param {Object} [overrides] - Optional data overrides (for testing)
   * @returns {{
   *   score:        number,       — Composite 0-100
   *   grade:        string,       — A/B/C/D/F letter grade
   *   confidence:   string,       — 'high'|'medium'|'low'
   *   dimensions:   Object,       — Per-dimension {score, weight, available, inputs}
   *   dataComplete: number,       — 0-100 pct of data dimensions available
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
      needCoverage:         { score: need.score,    weight: WEIGHTS.needCoverage,         available: need.available,    inputs: need.inputs },
      policyAlignment:      { score: policy.score,  weight: WEIGHTS.policyAlignment,      available: policy.available,  inputs: policy.inputs },
      financialFeasibility: { score: finance.score, weight: WEIGHTS.financialFeasibility, available: finance.available, inputs: finance.inputs },
      siteQuality:          { score: site.score,    weight: WEIGHTS.siteQuality,          available: site.available,    inputs: site.inputs }
    };

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

    var compositeScore = totalWeight > 0 ? _clamp(weighted / totalWeight) : 0;
    var dataComplete = Math.round((availableCount / 4) * 100);

    // Confidence based on data completeness
    var confidence = dataComplete >= 75 ? 'high' : dataComplete >= 50 ? 'medium' : 'low';

    // Letter grade
    var grade;
    if (compositeScore >= 85) grade = 'A';
    else if (compositeScore >= 70) grade = 'B';
    else if (compositeScore >= 55) grade = 'C';
    else if (compositeScore >= 40) grade = 'D';
    else grade = 'F';

    // Summary narrative
    var summary = _buildSummary(compositeScore, grade, confidence, dims);

    return {
      score:        compositeScore,
      grade:        grade,
      confidence:   confidence,
      dimensions:   dims,
      dataComplete: dataComplete,
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
