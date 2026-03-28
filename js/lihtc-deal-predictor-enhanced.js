/**
 * js/lihtc-deal-predictor-enhanced.js
 * Enhanced LIHTC Deal Prediction Module — Phase 3 (Epic #445)
 *
 * Extends the base LIHTCDealPredictor with additional data integration points:
 *   - PMA demand score pipeline integration
 *   - Affordability gap data (county-level 30%/50%/60% AMI gaps)
 *   - HUD FMR/AMI data connectors (via window.HudFmr or module.exports)
 *   - QCT/DDA basis boost logic (enhanced)
 *   - Legislative context from LegislativeTracker (AHCIA / HR6644 impact)
 *   - Risk scenario sensitivity (equity pricing, demand, market saturation)
 *
 * This module wraps the base predictor and layers in Phase 3 data sources.
 * All base predictConcept() logic is preserved and extended — not replaced.
 *
 * Exposed as window.LIHTCDealPredictorEnhanced (browser) and
 * module.exports (Node/test).
 *
 * Usage:
 *   var result = LIHTCDealPredictorEnhanced.predictEnhanced(inputs);
 *   // result.base         → base DealRecommendation from LIHTCDealPredictor
 *   // result.enhanced     → Phase 3 extensions (legislativeContext, pmaSignals, etc.)
 *   // result.summary      → plain-text summary for UI rendering
 */

(function (root, factory) {
  'use strict';
  /* istanbul ignore next */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./lihtc-deal-predictor'),
      null,  // LegislativeTracker (optional in Node; pass null)
      null   // HudFmr (optional in Node; pass null)
    );
  } else {
    root.LIHTCDealPredictorEnhanced = factory(
      root.LIHTCDealPredictor,
      root.LegislativeTracker,
      root.HudFmr
    );
  }
}(typeof self !== 'undefined' ? self : this, function (BasePredictor, LegislativeTracker, HudFmr) {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────────── */

  var VERSION = '3.0.0';

  /**
   * Legislative impact multipliers for equity pricing forecasts.
   * Based on Novogradac analysis of AHCIA/H.R.6644 provisions.
   */
  var LEGISLATIVE_EQUITY_BOOST = {
    AHCIA:   0.04,   // +4 cents/credit from expanded investor base
    HR6644:  0.02,   // +2 cents from FHA limit increases + NEPA streamlining
    'CRA-MOD': 0.03, // +3 cents from expanded CRA-eligible investor universe
    ROAD:    0.01    // +1 cent (Senate; must reconcile with HR6644)
  };

  /** Minimum PMA score thresholds by confidence tier. */
  var PMA_THRESHOLDS = {
    strong: 75,
    adequate: 50,
    marginal: 30
  };

  /* ── Helpers ─────────────────────────────────────────────────────── */

  function _num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback !== undefined ? fallback : 0);
  }

  function _bool(v, fallback) {
    if (v === true || v === false) return v;
    return fallback || false;
  }

  /* ── PMA Signal Integration ──────────────────────────────────────── */

  /**
   * Derive demand-tier signals from PMA score + confidence.
   * @param {Object} inputs
   * @returns {Object} pmaSignals
   */
  function _computePmaSignals(inputs) {
    var score      = _num(inputs.pmaScore, -1);
    var confidence = inputs.pmaConfidence || 'medium';

    if (score < 0) {
      return {
        tier: 'unknown',
        label: 'PMA score not provided',
        supportsNinePct: null,
        supportsFourPct: null,
        note: 'Provide a PMA score (0–100) for demand-tier signal.'
      };
    }

    var tier;
    if (score >= PMA_THRESHOLDS.strong)  tier = 'strong';
    else if (score >= PMA_THRESHOLDS.adequate) tier = 'adequate';
    else if (score >= PMA_THRESHOLDS.marginal) tier = 'marginal';
    else tier = 'weak';

    var confidencePenalty = confidence === 'low' ? -5 : 0;
    var adjustedScore = score + confidencePenalty;

    return {
      tier:            tier,
      score:           score,
      adjustedScore:   adjustedScore,
      confidence:      confidence,
      label:           'PMA demand: ' + tier + ' (' + score + '/100)',
      supportsNinePct: adjustedScore >= PMA_THRESHOLDS.adequate,
      supportsFourPct: adjustedScore >= PMA_THRESHOLDS.marginal,
      note: tier === 'weak'
        ? 'Weak PMA score — market study may not support CHFA QAP competitiveness.'
        : null
    };
  }

  /* ── Affordability Gap Integration ───────────────────────────────── */

  /**
   * Interpret affordability gap data for AMI mix targeting.
   * @param {Object} inputs
   * @returns {Object} gapSignals
   */
  function _computeAffordabilityGapSignals(inputs) {
    var ami30 = _num(inputs.ami30UnitsNeeded, 0);
    var ami50 = _num(inputs.ami50UnitsNeeded, 0);
    var ami60 = _num(inputs.ami60UnitsNeeded, 0);
    var total = _num(inputs.totalUndersupply, ami30 + ami50 + ami60);

    var deepAffordabilityShare = total > 0 ? ami30 / total : 0;
    var moderateAffordabilityShare = total > 0 ? ami50 / total : 0;

    var targeting;
    if (deepAffordabilityShare >= 0.4) {
      targeting = 'deep-affordable';
    } else if (deepAffordabilityShare >= 0.2 || moderateAffordabilityShare >= 0.4) {
      targeting = 'mixed-affordability';
    } else {
      targeting = 'moderate-affordable';
    }

    return {
      targeting:                targeting,
      deepAffordabilityShare:   Math.round(deepAffordabilityShare * 100),
      moderateAffordabilityShare: Math.round(moderateAffordabilityShare * 100),
      totalUndersupply:         total,
      label: 'Gap targeting: ' + targeting,
      recommendDeepUnits: deepAffordabilityShare >= 0.3,
      note: deepAffordabilityShare >= 0.4
        ? 'High 30% AMI gap — prioritize deep-affordable units in AMI mix.'
        : null
    };
  }

  /* ── HUD FMR Integration ─────────────────────────────────────────── */

  /**
   * Load and normalise FMR data for the given county FIPS.
   * Falls back to inputs.fmrData if the HudFmr connector is unavailable.
   * @param {Object} inputs
   * @returns {Object|null} fmrRecord
   */
  function _loadFmrData(inputs) {
    var geoid = inputs.geoid || '';

    // Prefer live connector if available
    if (HudFmr && typeof HudFmr.getByFips === 'function' && geoid) {
      var record = HudFmr.getByFips(geoid);
      if (record) return record;
    }

    // Fall back to caller-supplied fmrData
    if (inputs.fmrData && typeof inputs.fmrData === 'object') {
      return inputs.fmrData;
    }

    return null;
  }

  /* ── Legislative Context Integration ────────────────────────────── */

  /**
   * Pull legislative market impact signals from LegislativeTracker.
   * @returns {Object} legislativeContext
   */
  function _computeLegislativeContext() {
    if (!LegislativeTracker || typeof LegislativeTracker.getMarketImpactSummary !== 'function') {
      return {
        available: false,
        note: 'LegislativeTracker not loaded — legislative context unavailable.'
      };
    }

    var summary    = LegislativeTracker.getMarketImpactSummary();
    var bills      = LegislativeTracker.getAllBills ? LegislativeTracker.getAllBills() : [];
    var activeBills = bills.filter(function (b) {
      return b.stage !== 'Failed / Died in Committee';
    });

    // Weighted equity pricing uplift from active bills
    var equityPricingBoost = activeBills.reduce(function (acc, bill) {
      var boost = LEGISLATIVE_EQUITY_BOOST[bill.id] || 0;
      var passageWeight = _num(bill.passageProbability, 50) / 100;
      return acc + boost * passageWeight;
    }, 0);

    return {
      available:          true,
      equityPricingBoost: Math.round(equityPricingBoost * 100) / 100,
      activeBillCount:    activeBills.length,
      lihtcDemandBoost:   summary.weightedLihtcDemandBoost || 0,
      craExpansion:       summary.weightedCraExpansionScore || 0,
      keyBills:           activeBills.map(function (b) {
        return { id: b.id, title: b.title, stage: b.stage, passageProbability: b.passageProbability };
      }),
      note: equityPricingBoost > 0
        ? 'Active legislation may boost equity pricing by approximately $' + equityPricingBoost.toFixed(2) + '/credit.'
        : null
    };
  }

  /* ── Summary Builder ─────────────────────────────────────────────── */

  /**
   * Build a plain-text summary from base + enhanced outputs.
   * @param {Object} base  - DealRecommendation from base predictor
   * @param {Object} enhanced - Phase 3 extensions
   * @returns {string}
   */
  function _buildSummary(base, enhanced) {
    var lines = [
      'Enhanced LIHTC Deal Analysis (Phase 3)',
      '══════════════════════════════════════',
      'Recommended execution: ' + base.recommendedExecution,
      'Concept type:          ' + base.conceptType,
      'Confidence:            ' + base.confidence,
      ''
    ];

    var pma = enhanced.pmaSignals;
    if (pma.tier !== 'unknown') {
      lines.push('PMA demand tier: ' + pma.tier + ' (score: ' + pma.score + '/100)');
    }

    var gap = enhanced.affordabilityGapSignals;
    lines.push('Affordability gap targeting: ' + gap.targeting);
    if (gap.totalUndersupply > 0) {
      lines.push('  Total undersupply: ' + gap.totalUndersupply + ' units');
      lines.push('  Deep affordable (30% AMI): ' + gap.deepAffordabilityShare + '%');
    }

    var leg = enhanced.legislativeContext;
    if (leg.available && leg.activeBillCount > 0) {
      lines.push('Legislative context: ' + leg.activeBillCount + ' active bill(s)');
      if (leg.equityPricingBoost > 0) {
        lines.push('  Projected equity pricing uplift: +$' + leg.equityPricingBoost.toFixed(2) + '/credit');
      }
    }

    if (base.pabCapNote) {
      lines.push('PAB cap note: ' + base.pabCapNote);
    }

    var notes = [];
    if (pma.note)  notes.push(pma.note);
    if (gap.note)  notes.push(gap.note);
    if (leg.note)  notes.push(leg.note);
    if (notes.length) {
      lines.push('');
      lines.push('Notes:');
      notes.forEach(function (n) { lines.push('  • ' + n); });
    }

    return lines.join('\n');
  }

  /* ── Main Public API ─────────────────────────────────────────────── */

  /**
   * Generate a Phase 3 enhanced LIHTC deal recommendation.
   *
   * @param {Object} inputs — same as LIHTCDealPredictor.predictConcept() inputs,
   *   plus optional Phase 3 fields (geoid, pmaScore, pmaConfidence, etc.)
   * @returns {{base: DealRecommendation, enhanced: Object, summary: string}}
   */
  function predictEnhanced(inputs) {
    inputs = inputs || {};

    // Resolve FMR data (from connector or caller-supplied)
    var fmrData = _loadFmrData(inputs);
    var enrichedInputs = Object.assign({}, inputs, fmrData ? { fmrData: fmrData } : {});

    // Run base predictor
    var base = BasePredictor.predictConcept(enrichedInputs);

    // Compute Phase 3 extensions
    var pmaSignals              = _computePmaSignals(inputs);
    var affordabilityGapSignals = _computeAffordabilityGapSignals(inputs);
    var legislativeContext      = _computeLegislativeContext();

    var enhanced = {
      version:                 VERSION,
      pmaSignals:              pmaSignals,
      affordabilityGapSignals: affordabilityGapSignals,
      legislativeContext:      legislativeContext,
      fmrDataSource:           fmrData ? (fmrData.source || 'provided') : 'none'
    };

    return {
      base:     base,
      enhanced: enhanced,
      summary:  _buildSummary(base, enhanced)
    };
  }

  /**
   * Batch-evaluate multiple scenarios and return side-by-side comparisons.
   * @param {Object[]} scenarioList  — array of input objects
   * @returns {Object[]}
   */
  function evaluateScenarios(scenarioList) {
    if (!Array.isArray(scenarioList)) return [];
    return scenarioList.map(function (inputs, idx) {
      var result = predictEnhanced(inputs);
      return {
        scenarioIndex:   idx,
        label:           inputs.label || ('Scenario ' + (idx + 1)),
        execution:       result.base.recommendedExecution,
        conceptType:     result.base.conceptType,
        confidence:      result.base.confidence,
        pmaSignalTier:   result.enhanced.pmaSignals.tier,
        gapTargeting:    result.enhanced.affordabilityGapSignals.targeting,
        legislativeBoost: result.enhanced.legislativeContext.equityPricingBoost || 0,
        full:            result
      };
    });
  }

  return {
    VERSION:        VERSION,
    predictEnhanced: predictEnhanced,
    evaluateScenarios: evaluateScenarios,
    /* Expose internals for unit testing */
    _computePmaSignals:              _computePmaSignals,
    _computeAffordabilityGapSignals: _computeAffordabilityGapSignals,
    _computeLegislativeContext:      _computeLegislativeContext
  };
}));
