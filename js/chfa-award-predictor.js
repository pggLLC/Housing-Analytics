/**
 * js/chfa-award-predictor.js
 * CHFA QAP Competitiveness Predictor — Phase 2.1
 *
 * Estimates award likelihood and competitive score for a LIHTC concept
 * based on historical CHFA QAP award patterns (2015–2025).
 *
 * ⚠ DATA SOURCE DISCLOSURE:
 *   The underlying dataset (`data/policy/chfa-awards-historical.json`) is
 *   a **synthesized sample** assembled from CHFA's public award
 *   announcements — see `meta.note` in that file. It is suitable for
 *   directional calibration but is NOT CHFA's authoritative award record.
 *   UI surfaces that consume this predictor (see qap-competitiveness-panel.js
 *   and lihtc-concept-card-renderer.js) render a visible banner above any
 *   predicted score. Verify specific figures against CHFA's current award
 *   history before citing them: https://www.chfainfo.com/developers/rental-housing-and-funding
 *
 * Non-goals:
 *   - Does NOT predict the actual CHFA score (CHFA is the sole arbiter)
 *   - Does NOT guarantee an award — estimates only
 *   - Does NOT replace professional pre-application consultation with CHFA
 *   - Estimates are based on historical patterns; current QAP may differ
 *
 * Usage:
 *   CHFAAwardPredictor.load(historicalData).then(function () {
 *     var result = CHFAAwardPredictor.predict(concept, siteContext);
 *   });
 *
 * Exposed as window.CHFAAwardPredictor (browser) and module.exports (Node).
 *
 * @typedef {Object} AwardPrediction
 * @property {number}   awardLikelihood   — 0–1 probability estimate
 * @property {string}   competitiveBand   — 'strong'|'moderate'|'weak'
 * @property {number}   scoreEstimate     — rough 0–100 score estimate
 * @property {Object}   factors           — factor-level breakdown
 * @property {Object}   competitiveContext — applications/funded context
 * @property {string}   narrative         — human-readable summary
 * @property {string[]} caveats           — important disclaimers
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CHFAAwardPredictor = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Internal state ─────────────────────────────────────────────── */
  var _awards  = [];
  var _summary = {};
  var _factors = {};
  var _loaded  = false;

  /* ── Default scoring weights (aligned with QAP structure) ────────── */
  var SCORING_WEIGHTS = {
    geography:    { maxPts: 20, avgWinner: 16.2, avgLoser: 12.1 },
    communityNeed:{ maxPts: 25, avgWinner: 20.8, avgLoser: 14.3 },
    localSupport: { maxPts: 22, avgWinner: 18.5, avgLoser: 11.2 },
    developer:    { maxPts: 15, avgWinner: 12.1, avgLoser: 9.4  },
    design:       { maxPts: 10, avgWinner: 7.8,  avgLoser: 5.2  },
    other:        { maxPts: 8,  avgWinner: 6.1,  avgLoser: 3.8  }
  };

  /* ── Score estimator ─────────────────────────────────────────────── */

  /**
   * Estimate individual factor scores from concept and site context.
   * @param {Object} concept     - DealRecommendation from LIHTCDealPredictor
   * @param {Object} siteContext - Site-level context signals
   * @returns {Object} factorScores
   */
  function _estimateFactors(concept, siteContext) {
    var ctx = siteContext || {};
    var factors = {};

    /* Geography — transit access, QCT, DDA, opportunity areas */
    var geoScore = SCORING_WEIGHTS.geography.avgLoser;
    if (ctx.isQct || concept.isQct) geoScore += 2.5;
    if (ctx.isDda || concept.isDda) geoScore += 2.0;
    if (ctx.pmaScore && ctx.pmaScore >= 75) geoScore += 2.0;
    else if (ctx.pmaScore && ctx.pmaScore >= 60) geoScore += 1.0;
    if (ctx.isRural) geoScore -= 1.5;      // rural areas often score lower on geo
    geoScore = Math.min(geoScore, SCORING_WEIGHTS.geography.maxPts);
    factors.geography = {
      value: parseFloat(geoScore.toFixed(1)),
      maxPts: SCORING_WEIGHTS.geography.maxPts,
      note: ctx.isQct ? 'QCT bonus applied' :
            ctx.isDda ? 'DDA bonus applied' :
            ctx.pmaScore >= 75 ? 'Strong site score' : 'Standard market area'
    };

    /* Community Need — HNA data, rent burden, housing gap */
    var needScore = SCORING_WEIGHTS.communityNeed.avgLoser;
    if (ctx.totalUndersupply && ctx.totalUndersupply > 200) needScore += 4.0;
    else if (ctx.totalUndersupply && ctx.totalUndersupply > 50)  needScore += 2.0;
    if (ctx.ami30UnitsNeeded && ctx.ami30UnitsNeeded > 50) needScore += 2.0;
    if (ctx.hasHnaData) needScore += 1.5;   // HNA-backed need = QAP bonus
    needScore = Math.min(needScore, SCORING_WEIGHTS.communityNeed.maxPts);
    factors.communityNeed = {
      value: parseFloat(needScore.toFixed(1)),
      maxPts: SCORING_WEIGHTS.communityNeed.maxPts,
      note: ctx.hasHnaData ? 'HNA-backed need documentation' :
            ctx.totalUndersupply > 200 ? 'Severe housing gap identified' :
            'Standard community need'
    };

    /* Local Support — government letters, funding, land */
    var supportScore = SCORING_WEIGHTS.localSupport.avgLoser;
    if (ctx.localSoftFunding && ctx.localSoftFunding > 500000) supportScore += 5.0;
    else if (ctx.localSoftFunding && ctx.localSoftFunding > 100000) supportScore += 2.5;
    if (ctx.hasGovernmentSupport) supportScore += 3.0;
    if (ctx.publicLandOpportunity === 'strong') supportScore += 2.5;
    supportScore = Math.min(supportScore, SCORING_WEIGHTS.localSupport.maxPts);
    factors.localSupport = {
      value: parseFloat(supportScore.toFixed(1)),
      maxPts: SCORING_WEIGHTS.localSupport.maxPts,
      note: ctx.hasGovernmentSupport ? 'Local government commitment' :
            ctx.localSoftFunding > 500000 ? 'Strong local soft funding' :
            'No confirmed government support'
    };

    /* Developer — track record, capacity */
    var devScore = SCORING_WEIGHTS.developer.avgLoser + 2.0; // neutral estimate
    factors.developer = {
      value: parseFloat(devScore.toFixed(1)),
      maxPts: SCORING_WEIGHTS.developer.maxPts,
      note: 'Estimated (track record not provided)'
    };

    /* Design — green building, accessibility */
    var designScore = SCORING_WEIGHTS.design.avgLoser;
    if (ctx.greenBuilding) designScore += 2.0;
    factors.design = {
      value: parseFloat(designScore.toFixed(1)),
      maxPts: SCORING_WEIGHTS.design.maxPts,
      note: ctx.greenBuilding ? 'Green building planned' : 'Standard design'
    };

    /* Other — QCT/DDA, rural priority, preservation */
    var otherScore = SCORING_WEIGHTS.other.avgLoser;
    if (ctx.isRural) otherScore += 1.5;         // rural priority tiebreaker
    if (ctx.isPreservation) otherScore += 1.0;   // preservation preference
    otherScore = Math.min(otherScore, SCORING_WEIGHTS.other.maxPts);
    factors.other = {
      value: parseFloat(otherScore.toFixed(1)),
      maxPts: SCORING_WEIGHTS.other.maxPts,
      note: ctx.isRural ? 'Rural priority bonus' :
            ctx.isPreservation ? 'Preservation preference' : 'Standard'
    };

    return factors;
  }

  /** Sum all factor scores. */
  function _sumScore(factors) {
    return Object.keys(factors).reduce(function (sum, key) {
      return sum + (factors[key].value || 0);
    }, 0);
  }

  /** Estimate award likelihood from score. */
  function _scoreToProbability(score) {
    var threshold = _summary.scoreThreshold || { highLikelihood: 82, moderateLikelihood: 74, lowLikelihood: 65 };
    if (score >= threshold.highLikelihood)     return 0.72;
    if (score >= threshold.moderateLikelihood) return 0.48;
    if (score >= threshold.lowLikelihood)      return 0.28;
    return 0.12;
  }

  /** Map likelihood to competitive band. */
  function _likelihoodToBand(p) {
    if (p >= 0.60) return 'strong';
    if (p >= 0.35) return 'moderate';
    return 'weak';
  }

  /** Compute percentile vs historical winners. */
  function _computePercentile(score) {
    var awardedScores = _awards
      .filter(function (a) { return a.awarded && typeof a.qapScore === 'number'; })
      .map(function (a) { return a.qapScore; })
      .sort(function (a, b) { return a - b; });

    if (!awardedScores.length) return 0.5;
    var below = awardedScores.filter(function (s) { return s < score; }).length;
    return parseFloat((below / awardedScores.length).toFixed(2));
  }

  /* ── Narrative builder ──────────────────────────────────────────── */
  function _buildNarrative(likelihood, band, score, concept) {
    var pct = Math.round(likelihood * 100);
    var conceptType = (concept && concept.conceptType) ? concept.conceptType : 'family';
    if (band === 'strong') {
      return 'Strong award likelihood (' + pct + '%) based on historical patterns — estimated QAP score ' + Math.round(score) + '/100.';
    }
    if (band === 'moderate') {
      return 'Moderate award likelihood (' + pct + '%) — competitive field; strengthening local support and community need documentation is advised.';
    }
    return 'Below historical award threshold (est. ' + pct + '%) — significant improvements needed to score, local support, or community need documentation.';
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Load historical award data.
   * @param {Object} historicalData — parsed chfa-awards-historical.json
   * @returns {Promise<void>}
   */
  function load(historicalData) {
    if (historicalData) {
      _awards  = historicalData.awards  || [];
      _summary = historicalData.summary || {};
      _factors = historicalData.scoringFactors || {};
    }
    _loaded = true;
    return Promise.resolve();
  }

  /**
   * Predict CHFA award competitiveness for a concept.
   *
   * @param {Object} concept      - DealRecommendation from LIHTCDealPredictor (or minimal obj)
   * @param {Object} siteContext  - Site signals: { pmaScore, isQct, isDda, isRural, totalUndersupply,
   *                                  ami30UnitsNeeded, localSoftFunding, hasGovernmentSupport,
   *                                  publicLandOpportunity, hasHnaData, greenBuilding, isPreservation }
   * @returns {AwardPrediction}
   */
  function predict(concept, siteContext) {
    var c   = concept || {};
    var ctx = siteContext || {};

    var factors     = _estimateFactors(c, ctx);
    var scoreEst    = parseFloat(_sumScore(factors).toFixed(1));
    var likelihood  = _scoreToProbability(scoreEst);
    var band        = _likelihoodToBand(likelihood);
    var percentile  = _computePercentile(scoreEst);

    // Historical summary stats — return null + visible "unavailable"
    // rather than fabricating 27 apps / 37% rate when the summary file
    // didn't load. Hardcoded fallbacks were flagged as hallucinations
    // in the 2026-04-23 origin audit (issue #712).
    var summaryLoaded = typeof _summary.avgApplicationsPerYear === 'number' &&
                        typeof _summary.awardRate === 'number';
    var avgApps   = summaryLoaded ? _summary.avgApplicationsPerYear : null;
    var awardRate = summaryLoaded ? _summary.awardRate              : null;
    var funded    = summaryLoaded ? Math.round(avgApps * awardRate) : null;

    var narrative = _buildNarrative(likelihood, band, scoreEst, c);

    var caveats = [
      'Estimate based on 2015–2025 historical QAP award patterns.',
      'Actual 2026 QAP scoring criteria may differ from historical averages.',
      'Developer track record assumed neutral — adjust if known.',
      'Contact CHFA for pre-application consultation before submission.'
    ];
    if (!summaryLoaded) {
      caveats.unshift('⚠ Historical summary data did not load — application-count and award-rate context unavailable; see CHFA directly for current figures.');
    }

    if (ctx.isRural) {
      caveats.push('Rural markets have historically lower award rates — rural priority tiebreaker may offset.');
    }

    return {
      awardLikelihood:  likelihood,
      competitiveBand:  band,
      scoreEstimate:    scoreEst,
      factors:          factors,
      competitiveContext: {
        applicationsExpected: avgApps,          // may be null
        fundingAvailable:     funded,           // may be null
        percentileRank:       percentile,
        summaryAvailable:     summaryLoaded,    // new flag for UI renderers
        note: summaryLoaded
          ? 'Based on ' + _awards.length + ' historical awards (2015–2025).'
          : 'Historical-award summary not available — competitive context omitted.'
      },
      narrative: narrative,
      caveats:   caveats
    };
  }

  /**
   * Returns true if historical data has been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return _loaded;
  }

  /**
   * Return awards filtered by concept type.
   * @param {string} type - 'family'|'seniors'|'supportive'|'mixed-use'
   * @returns {Array<Object>}
   */
  function getAwardsByType(type) {
    return _awards.filter(function (a) { return a.type === type && a.awarded; });
  }

  return {
    load:           load,
    predict:        predict,
    isLoaded:       isLoaded,
    getAwardsByType: getAwardsByType,
    /* Exposed for testing */
    _estimateFactors:     _estimateFactors,
    _scoreToProbability:  _scoreToProbability,
    _likelihoodToBand:    _likelihoodToBand,
    _computePercentile:   _computePercentile,
    _sumScore:            _sumScore
  };
}));
