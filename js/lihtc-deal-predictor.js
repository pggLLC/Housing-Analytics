/**
 * js/lihtc-deal-predictor.js
 * LIHTC Deal Predictor — concept-level recommendation engine.
 *
 * Generates planning-level recommendations (4% vs 9%, concept type, unit/AMI
 * mix, indicative capital stack) based on site analysis, PMA results, housing
 * needs, and market conditions.
 *
 * Non-goals (explicitly documented):
 *   - Does NOT underwrite individual projects (no investor-level pro forma)
 *   - Does NOT predict CHFA QAP award (no competitive scoring model)
 *   - Does NOT calculate basis, eligible basis, or applicable fraction
 *   - Does NOT model permanent debt underwriting (DSCR, LTV)
 *   - Does NOT finalize capital stack (conceptual outline only)
 *
 * Usage:
 *   var rec = LIHTCDealPredictor.predictConcept(inputs);
 *   // rec.recommendedExecution → '9%' | '4%' | 'Either'
 *   // rec.conceptType         → 'family' | 'seniors' | 'mixed-use' | 'supportive'
 *   // rec.confidence          → 'high' | 'medium' | 'low'
 *
 * Exposed as window.LIHTCDealPredictor (browser) and module.exports (Node/test).
 *
 * @typedef {Object} DealInputs
 * @property {string}   [geoid]                — 5-digit county FIPS
 * @property {number}   [pmaScore]             — PMA site score 0–100
 * @property {string}   [pmaConfidence]        — 'high'|'medium'|'low'
 * @property {number}   [proposedUnits]        — total proposed units
 * @property {number}   [ami30UnitsNeeded]     — units needed at 30% AMI (HNA gap)
 * @property {number}   [ami50UnitsNeeded]     — units needed at 50% AMI
 * @property {number}   [ami60UnitsNeeded]     — units needed at 60% AMI
 * @property {number}   [totalUndersupply]     — total affordable unit gap
 * @property {number}   [competitiveSetSize]   — LIHTC projects within 1 mile
 * @property {boolean}  [isQct]                — Qualified Census Tract flag
 * @property {boolean}  [isDda]                — Difficult Development Area flag
 * @property {number}   [softFundingAvailable] — estimated local soft $ available
 * @property {number}   [marketVacancy]        — area rental vacancy rate (0–1)
 * @property {number}   [medianRentToIncome]   — rent-to-income ratio (0–1)
 * @property {boolean}  [seniorsDemand]        — senior housing demand signal
 * @property {boolean}  [supportiveNeed]       — supportive housing need signal
 * @property {string}   [dataVintage]          — ISO date of source data
 *
 * @typedef {Object} DealRecommendation
 * @property {string}   recommendedExecution   — '9%' | '4%' | 'Either'
 * @property {string}   conceptType            — 'family'|'seniors'|'mixed-use'|'supportive'
 * @property {Object}   suggestedUnitMix       — { studio, oneBR, twoBR, threeBR, fourBRPlus }
 * @property {Object}   suggestedAMIMix        — { ami30, ami40, ami50, ami60 } unit counts
 * @property {Object}   indicativeCapitalStack — equity, firstMortgage, localSoft, stateSoft, deferredFee, gap
 * @property {string[]} keyRationale           — decision factors
 * @property {string[]} keyRisks              — identified risks
 * @property {string[]} caveats               — limitations/disclaimers
 * @property {string}   confidence            — 'high' | 'medium' | 'low'
 * @property {string}   confidenceBadge       — emoji badge for UI display
 * @property {string}   alternativePath       — description of the alternate credit type path
 */

(function (root, factory) {
  'use strict';
  /* istanbul ignore next */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LIHTCDealPredictor = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────────── */

  var DISCLAIMER = 'Concept-level recommendation only. Requires CHFA pre-screening, ' +
    'syndicator validation, and local soft-fund confirmation. This tool does not ' +
    'constitute underwriting, legal, or investment advice. Actual LIHTC award outcomes ' +
    'depend on CHFA QAP scoring, market conditions, subsidy availability, and factors ' +
    'not modeled here. Always engage a qualified LIHTC syndicator and attorney before proceeding.';

  var DEFAULT_ASSUMPTIONS = {
    equityPrice9Pct:          0.87,
    equityPrice4Pct:          0.85,
    hardCostPerUnit:          275000,
    softCostPct:              0.22,
    devFeePct:                0.15,
    defaultSoftFunding:       500000,
    saturationLowThreshold:   1,
    saturationMedThreshold:   3,
    saturationHighThreshold:  5,
    pmaStrongThreshold:       70,
    pmaModerateThreshold:     50,
    fourPctMinUnits:          100,
    deepAffordabilityPct:     0.25
  };

  /* ── Helper: safe numeric access ─────────────────────────────────── */

  function _num(v, fallback) {
    var n = parseFloat(v);
    return (isFinite(n) && n !== null) ? n : (fallback || 0);
  }

  function _missing(v) {
    return (v === null || v === undefined || (typeof v === 'number' && !isFinite(v)));
  }

  /* ── Confidence scoring ──────────────────────────────────────────── */

  function _computeConfidence(inputs) {
    var score = 0;
    var maxScore = 6;

    if (!_missing(inputs.pmaScore))             score += 1;
    if (!_missing(inputs.ami30UnitsNeeded))      score += 1;
    if (!_missing(inputs.competitiveSetSize))    score += 1;
    if (!_missing(inputs.isQct))                score += 0.5;
    if (!_missing(inputs.isDda))                score += 0.5;
    if (!_missing(inputs.softFundingAvailable))  score += 1;
    if (!_missing(inputs.medianRentToIncome))    score += 1;

    var ratio = score / maxScore;
    if (ratio >= 0.75) return 'high';
    if (ratio >= 0.45) return 'medium';
    return 'low';
  }

  function _confidenceBadge(confidence) {
    if (confidence === 'high')   return '🟢';
    if (confidence === 'medium') return '🟡';
    return '🔴';
  }

  /* ── Credit type selection (4% vs 9%) ───────────────────────────── */

  function _selectExecution(inputs, rationale, risks) {
    var proposedUnits   = _num(inputs.proposedUnits, 60);
    var ami30Units      = _num(inputs.ami30UnitsNeeded, 0);
    var totalUndersupply = _num(inputs.totalUndersupply, 0);
    var competitiveSet  = _num(inputs.competitiveSetSize, 0);
    var softFunding     = _num(inputs.softFundingAvailable, DEFAULT_ASSUMPTIONS.defaultSoftFunding);
    var pmaScore        = _num(inputs.pmaScore, 50);

    var deepAffordabilityPct = (proposedUnits > 0)
      ? (ami30Units / proposedUnits)
      : 0;
    var isDeepAffordability = deepAffordabilityPct > DEFAULT_ASSUMPTIONS.deepAffordabilityPct;
    var isLargeScale        = proposedUnits >= DEFAULT_ASSUMPTIONS.fourPctMinUnits;
    var isMarketSaturated   = competitiveSet >= DEFAULT_ASSUMPTIONS.saturationHighThreshold;
    var hasSoftFunding      = softFunding > 0;
    var pmaIsStrong         = pmaScore >= DEFAULT_ASSUMPTIONS.pmaStrongThreshold;

    // Flag both paths when soft funding unavailable or market oversaturated
    if (!hasSoftFunding && isMarketSaturated) {
      risks.push('Soft funding unavailable and market is oversaturated — both credit paths face headwinds');
      rationale.push('Neither 4% nor 9% has clear advantage without soft funding and given saturation');
      return 'Either';
    }

    if (isMarketSaturated) {
      risks.push('Market saturation: ' + competitiveSet + ' competitive LIHTC projects within 1 mile may limit absorption');
    }

    // Prefer 9% when deep affordability need, weak debt capacity, low saturation
    if (isDeepAffordability && !isLargeScale && competitiveSet < DEFAULT_ASSUMPTIONS.saturationMedThreshold) {
      rationale.push('Deep affordability need (>25% of units at 30% AMI) favors 9% competitive credit');
      rationale.push('Smaller project scale (<100 units) is well-suited for 9% competitive application');
      if (pmaIsStrong) rationale.push('Strong PMA score (' + Math.round(pmaScore) + ') supports competitive application');
      return '9%';
    }

    // Prefer 4% when large scale and partial debt support available
    if (isLargeScale && hasSoftFunding) {
      rationale.push('Larger scale (' + proposedUnits + ' units) can support 4% bond-financed execution');
      rationale.push('Soft funding availability (' + _formatDollars(softFunding) + ') supports 4% capital stack');
      if (inputs.isQct || inputs.isDda) {
        rationale.push('QCT/DDA designation provides up to 30% basis boost, improving 4% execution');
      }
      return '4%';
    }

    // Default: 9% for smaller projects with affordability pressure
    if (!isLargeScale) {
      rationale.push('Project scale (' + proposedUnits + ' units) is well-suited to 9% competitive application');
      if (totalUndersupply > 0) {
        rationale.push('Housing needs gap of ' + totalUndersupply + ' units supports competitive application narrative');
      }
      return '9%';
    }

    // Large scale without strong soft funding — flag both
    rationale.push('Large scale project could use either 4% or 9% depending on bond cap availability');
    risks.push('4% execution requires Private Activity Bond volume cap allocation — coordinate with CHFA');
    return 'Either';
  }

  /* ── Concept type selection ──────────────────────────────────────── */

  function _selectConceptType(inputs, rationale, risks) {
    var seniorsDemand  = !!inputs.seniorsDemand;
    var supportiveNeed = !!inputs.supportiveNeed;
    var ami30Units     = _num(inputs.ami30UnitsNeeded, 0);
    var pmaScore       = _num(inputs.pmaScore, 50);

    if (supportiveNeed && ami30Units > 50) {
      rationale.push('High need for supportive housing at 30% AMI in this market');
      return 'supportive';
    }
    if (seniorsDemand) {
      rationale.push('Senior housing demand signal detected — seniors concept recommended');
      return 'seniors';
    }
    if (ami30Units > 100 && pmaScore >= DEFAULT_ASSUMPTIONS.pmaModerateThreshold) {
      rationale.push('High deep affordability gap and adequate PMA score support mixed-use concept');
      return 'mixed-use';
    }
    rationale.push('Family housing is the default concept type for this market profile');
    return 'family';
  }

  /* ── Unit mix calculation ────────────────────────────────────────── */

  function _computeUnitMix(conceptType, proposedUnits) {
    var n = _num(proposedUnits, 60);
    var mixes = {
      family:      { studio: 0.07, oneBR: 0.27, twoBR: 0.47, threeBR: 0.19, fourBRPlus: 0.00 },
      seniors:     { studio: 0.20, oneBR: 0.60, twoBR: 0.20, threeBR: 0.00, fourBRPlus: 0.00 },
      'mixed-use': { studio: 0.10, oneBR: 0.30, twoBR: 0.40, threeBR: 0.20, fourBRPlus: 0.00 },
      supportive:  { studio: 0.50, oneBR: 0.40, twoBR: 0.10, threeBR: 0.00, fourBRPlus: 0.00 }
    };
    var pcts = mixes[conceptType] || mixes.family;
    var mix = {};
    var keys = Object.keys(pcts);
    var assigned = 0;
    keys.forEach(function (k, i) {
      if (i < keys.length - 1) {
        mix[k] = Math.round(n * pcts[k]);
        assigned += mix[k];
      } else {
        mix[k] = Math.max(0, n - assigned);
      }
    });
    return mix;
  }

  /* ── AMI mix calculation ─────────────────────────────────────────── */

  function _computeAMIMix(conceptType, proposedUnits, inputs) {
    var n = _num(proposedUnits, 60);
    var ami30Gap = _num(inputs.ami30UnitsNeeded, 0);
    var ami50Gap = _num(inputs.ami50UnitsNeeded, 0);
    var ami60Gap = _num(inputs.ami60UnitsNeeded, 0);

    // Default splits by concept type
    var defaults = {
      family:      { ami30: 0.17, ami40: 0.08, ami50: 0.33, ami60: 0.42 },
      seniors:     { ami30: 0.20, ami40: 0.30, ami50: 0.30, ami60: 0.20 },
      'mixed-use': { ami30: 0.19, ami40: 0.06, ami50: 0.38, ami60: 0.37 },
      supportive:  { ami30: 0.50, ami40: 0.25, ami50: 0.25, ami60: 0.00 }
    };
    var pcts = defaults[conceptType] || defaults.family;

    // Adjust toward gap data if available
    var totalGap = ami30Gap + ami50Gap + ami60Gap;
    if (totalGap > 0) {
      var gapWeight = Math.min(0.5, totalGap / (n * 2));
      pcts = {
        ami30: pcts.ami30 * (1 - gapWeight) + (ami30Gap / totalGap) * gapWeight,
        ami40: pcts.ami40,
        ami50: pcts.ami50 * (1 - gapWeight) + (ami50Gap / totalGap) * gapWeight,
        ami60: pcts.ami60 * (1 - gapWeight) + (ami60Gap / totalGap) * gapWeight
      };
    }

    var mix = {};
    var keys = ['ami30', 'ami40', 'ami50', 'ami60'];
    var assigned = 0;
    keys.forEach(function (k, i) {
      if (i < keys.length - 1) {
        mix[k] = Math.round(n * pcts[k]);
        assigned += mix[k];
      } else {
        mix[k] = Math.max(0, n - assigned);
      }
    });
    return mix;
  }

  /* ── Indicative capital stack ────────────────────────────────────── */

  function _computeCapitalStack(inputs, execution, unitMix) {
    var totalUnits   = _num(inputs.proposedUnits, 60);
    var hardCost     = DEFAULT_ASSUMPTIONS.hardCostPerUnit * totalUnits;
    var softCost     = hardCost * DEFAULT_ASSUMPTIONS.softCostPct;
    var totalDevCost = hardCost + softCost;
    var devFee       = totalDevCost * DEFAULT_ASSUMPTIONS.devFeePct;
    var totalCost    = totalDevCost + devFee;

    var equityPrice  = (execution === '4%')
      ? DEFAULT_ASSUMPTIONS.equityPrice4Pct
      : DEFAULT_ASSUMPTIONS.equityPrice9Pct;
    var basisBoost   = (inputs.isQct || inputs.isDda) ? 1.30 : 1.00;
    var annualCredit = (execution === '9%')
      ? totalDevCost * 0.09 * basisBoost
      : totalDevCost * 0.04 * basisBoost;
    var equity       = annualCredit * 10 * equityPrice;

    var localSoft    = _num(inputs.softFundingAvailable, DEFAULT_ASSUMPTIONS.defaultSoftFunding);
    var stateSoft    = Math.min(totalCost * 0.10, 2000000);
    var deferred     = devFee * 0.50;
    var totalSources = equity + localSoft + stateSoft + deferred;
    var gap          = Math.max(0, totalCost - totalSources);
    var firstMortgage = Math.min(gap, totalCost * 0.35);
    gap = Math.max(0, gap - firstMortgage);

    return {
      totalDevelopmentCost: Math.round(totalCost),
      equity:               Math.round(equity),
      firstMortgage:        Math.round(firstMortgage),
      localSoft:            Math.round(localSoft),
      stateSoft:            Math.round(stateSoft),
      deferredFee:          Math.round(deferred),
      gap:                  Math.round(gap)
    };
  }

  /* ── Risk identification ─────────────────────────────────────────── */

  function _identifyRisks(inputs, execution, risks) {
    var competitive = _num(inputs.competitiveSetSize, 0);
    var pmaScore    = _num(inputs.pmaScore, 50);
    var softFunding = _num(inputs.softFundingAvailable, DEFAULT_ASSUMPTIONS.defaultSoftFunding);

    if (competitive >= DEFAULT_ASSUMPTIONS.saturationMedThreshold) {
      risks.push('Market saturation: ' + competitive + ' competitive LIHTC projects within the market area');
    }
    if (pmaScore < DEFAULT_ASSUMPTIONS.pmaModerateThreshold) {
      risks.push('Below-moderate PMA score (' + Math.round(pmaScore) + ') — demand signals are weak');
    }
    if (softFunding < 500000) {
      risks.push('Limited local soft funding (<$500K) — gap financing may be challenging');
    }
    if (execution === '4%') {
      risks.push('4% execution requires Private Activity Bond volume cap — limited in Colorado');
    }
    if (!inputs.isQct && !inputs.isDda) {
      risks.push('No QCT/DDA designation — basis boost unavailable, reducing equity yield');
    }
    if (_missing(inputs.medianRentToIncome) || _missing(inputs.marketVacancy)) {
      risks.push('Stale or missing rent comps — income/rent ratio assumptions may not reflect current market');
    }
    return risks;
  }

  /* ── Alternative path description ───────────────────────────────── */

  function _alternativePath(execution, inputs) {
    var units = _num(inputs.proposedUnits, 60);
    if (execution === '9%') {
      var targetUnits = Math.max(units, DEFAULT_ASSUMPTIONS.fourPctMinUnits);
      return 'Consider 4% bond financing if scale increases to ' + targetUnits +
        '+ units and Private Activity Bond cap is available. 4% is often faster (no QAP competition) ' +
        'but requires bond cap and stronger debt capacity.';
    }
    if (execution === '4%') {
      return 'Consider 9% competitive application if scale is reduced to under 100 units or if deep ' +
        'affordability (30% AMI) need is the primary driver. 9% credits are more competitive but do not ' +
        'require bond cap.';
    }
    return 'Both 4% and 9% paths require further feasibility analysis. Consult a LIHTC syndicator ' +
      'to evaluate bond cap availability, QAP competitiveness, and soft funding alignment.';
  }

  /* ── Format helpers ──────────────────────────────────────────────── */

  function _formatDollars(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n);
  }

  /* ── Main predictConcept function ────────────────────────────────── */

  /**
   * Generate a concept-level LIHTC recommendation.
   *
   * @param {DealInputs} inputs
   * @returns {DealRecommendation}
   */
  function predictConcept(inputs) {
    inputs = inputs || {};

    var rationale = [];
    var risks     = [];
    var caveats   = [
      DISCLAIMER,
      'Unit mix and AMI mix are illustrative starting points based on typical Colorado LIHTC deals.',
      'Capital stack is indicative only; actual figures depend on current equity pricing, debt terms, and local subsidy programs.',
      'Competitive set analysis is based on data available at time of run; pipeline projects may not be reflected.'
    ];

    // Data quality notes
    if (_missing(inputs.pmaScore)) {
      caveats.push('PMA score not provided — credit type recommendation uses defaults.');
    }
    if (_missing(inputs.ami30UnitsNeeded)) {
      caveats.push('HNA affordability gap data not provided — AMI mix uses county-level defaults.');
    }

    var confidence     = _computeConfidence(inputs);
    var execution      = _selectExecution(inputs, rationale, risks);
    var conceptType    = _selectConceptType(inputs, rationale, risks);
    var proposedUnits  = _num(inputs.proposedUnits, 60);
    var suggestedUnitMix = _computeUnitMix(conceptType, proposedUnits);
    var suggestedAMIMix  = _computeAMIMix(conceptType, proposedUnits, inputs);

    // Basis boost rationale
    if (inputs.isQct) rationale.push('QCT designation provides up to 30% basis boost — improves equity yield');
    if (inputs.isDda) rationale.push('DDA designation provides up to 30% basis boost — improves equity yield');

    _identifyRisks(inputs, execution, risks);

    var capitalStack = _computeCapitalStack(inputs, execution, suggestedUnitMix);

    return {
      recommendedExecution:   execution,
      conceptType:            conceptType,
      suggestedUnitMix:       suggestedUnitMix,
      suggestedAMIMix:        suggestedAMIMix,
      indicativeCapitalStack: capitalStack,
      keyRationale:           rationale,
      keyRisks:               risks,
      caveats:                caveats,
      confidence:             confidence,
      confidenceBadge:        _confidenceBadge(confidence),
      alternativePath:        _alternativePath(execution, inputs)
    };
  }

  /**
   * Legacy predict function — returns DealScore-shaped object for
   * backward compatibility with any callers using the old stub interface.
   *
   * @param {Object} inputs
   * @returns {Object}
   */
  function predict(inputs) {
    var rec = predictConcept(inputs);
    return {
      feasibilityScore: rec.confidence === 'high' ? 80 : rec.confidence === 'medium' ? 55 : 30,
      recommendation:   rec.recommendedExecution,
      breakdown: {
        execution:   rec.recommendedExecution,
        conceptType: rec.conceptType,
        confidence:  rec.confidence
      },
      disclaimer: DISCLAIMER
    };
  }

  return {
    predictConcept: predictConcept,
    predict:        predict,
    DISCLAIMER:     DISCLAIMER
  };
}));
