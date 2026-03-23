/**
 * js/hna/hna-market-bridge.js
 * HNA-PMA Bridge — unified "need profile" combining HNA affordability gap
 * data with PMA market conditions to inform concept recommendations.
 *
 * Purpose:
 *   Creates a single structured object that answers "what does this market
 *   need?" by integrating HNA affordability gap by AMI band with PMA demand
 *   signals. The output (NeedProfile) is the canonical input to the LIHTC
 *   Deal Predictor and can be reused by policy dashboards and strategic
 *   planning tools.
 *
 * Usage (browser):
 *   var profile = HNAMarketBridge.buildNeedProfile(hnaData, pmaResult, options);
 *
 * Usage (Node/test):
 *   var bridge = require('./js/hna/hna-market-bridge');
 *   var profile = bridge.buildNeedProfile(hnaData, pmaResult);
 *
 * @typedef {Object} NeedProfile
 * @property {Object}   geography          — geoid, name, type
 * @property {Object}   pma                — method, score, confidence
 * @property {Object}   demandSignals      — householdGrowth, projectedUnitsNeeded, etc.
 * @property {Object}   affordabilityGap   — ami30/50/60 units needed, totalUndersupply, vacancy
 * @property {Array}    prioritySegments   — ranked AMI tiers with rationale
 * @property {string}   confidence         — 'high' | 'medium' | 'low'
 * @property {string[]} caveats            — data limitations
 */

(function (root, factory) {
  'use strict';
  /* istanbul ignore next */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.HNAMarketBridge = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Helper: safe numeric access ─────────────────────────────────── */

  function _num(v, fallback) {
    var n = parseFloat(v);
    return (isFinite(n) && v !== null && v !== undefined) ? n : (fallback !== undefined ? fallback : 0);
  }

  function _missing(v) {
    return (v === null || v === undefined || (typeof v === 'number' && !isFinite(v)));
  }

  /* ── Demand signal extraction ────────────────────────────────────── */

  function _extractDemandSignals(hnaData) {
    if (!hnaData) {
      return {
        householdGrowth:       null,
        projectedUnitsNeeded:  null,
        underlyingRentGrowth:  null,
        trendStrength:         'unknown'
      };
    }

    var growth        = _num(hnaData.householdGrowth,       null);
    var projected     = _num(hnaData.projectedUnitsNeeded,  null);
    var rentGrowth    = _num(hnaData.rentGrowthRate,        null);
    var population    = _num(hnaData.populationGrowthRate,  null);

    var trend = 'unknown';
    if (!_missing(rentGrowth)) {
      if (rentGrowth > 0.04) trend = 'strong';
      else if (rentGrowth > 0.02) trend = 'moderate';
      else if (rentGrowth > 0) trend = 'weak';
      else trend = 'flat';
    } else if (!_missing(population)) {
      if (population > 0.015) trend = 'strong';
      else if (population > 0.008) trend = 'moderate';
      else trend = 'weak';
    }

    return {
      householdGrowth:       growth,
      projectedUnitsNeeded:  projected,
      underlyingRentGrowth:  rentGrowth,
      trendStrength:         trend
    };
  }

  /* ── Affordability gap extraction ────────────────────────────────── */

  function _extractAffordabilityGap(hnaData) {
    if (!hnaData) {
      return {
        ami30UnitsNeeded:       null,
        ami50UnitsNeeded:       null,
        ami60UnitsNeeded:       null,
        totalUndersupply:       null,
        deepAffordabilityPressure: false,
        vacancy:                null
      };
    }

    var ami30 = _num(hnaData.ami30UnitsNeeded || hnaData.gap_30ami, null);
    var ami50 = _num(hnaData.ami50UnitsNeeded || hnaData.gap_50ami, null);
    var ami60 = _num(hnaData.ami60UnitsNeeded || hnaData.gap_60ami, null);
    var total = _num(hnaData.totalUndersupply, null);
    var vacancy = _num(hnaData.vacancyRate || hnaData.vacancy, null);

    // Compute total if not provided
    if (_missing(total) && (!_missing(ami30) || !_missing(ami50) || !_missing(ami60))) {
      total = _num(ami30, 0) + _num(ami50, 0) + _num(ami60, 0);
    }

    // Deep affordability pressure: 30% AMI units >25% of total gap
    var deepPressure = false;
    if (!_missing(ami30) && !_missing(total) && total > 0) {
      deepPressure = (ami30 / total) > 0.25;
    }

    return {
      ami30UnitsNeeded:         ami30,
      ami50UnitsNeeded:         ami50,
      ami60UnitsNeeded:         ami60,
      totalUndersupply:         total,
      deepAffordabilityPressure: deepPressure,
      vacancy:                  vacancy
    };
  }

  /* ── Priority segment identification ────────────────────────────── */

  function _buildPrioritySegments(affordabilityGap, pmaResult) {
    var segments = [];
    var gap30    = _num(affordabilityGap.ami30UnitsNeeded, 0);
    var gap50    = _num(affordabilityGap.ami50UnitsNeeded, 0);
    var gap60    = _num(affordabilityGap.ami60UnitsNeeded, 0);
    var total    = _num(affordabilityGap.totalUndersupply, gap30 + gap50 + gap60);
    var vacancy  = _num(affordabilityGap.vacancy, null);
    var pmaScore = pmaResult ? _num(pmaResult.score || pmaResult.pma_score, null) : null;

    // 30% AMI segment
    if (!_missing(gap30) && gap30 > 0) {
      var prio30 = 'moderate';
      var rat30  = [];
      if (total > 0 && gap30 / total > 0.40) {
        prio30 = 'critical';
        rat30.push('Severe undersupply at 30% AMI (' + Math.round((gap30 / total) * 100) + '% of gap)');
      } else if (total > 0 && gap30 / total > 0.25) {
        prio30 = 'high';
        rat30.push('Significant undersupply at 30% AMI (' + Math.round((gap30 / total) * 100) + '% of gap)');
      } else {
        rat30.push('Moderate undersupply at 30% AMI');
      }
      if (!_missing(vacancy) && vacancy < 0.03) rat30.push('Tight vacancy (' + (vacancy * 100).toFixed(1) + '%) confirms pressure');
      segments.push({ ami: 30, priority: prio30, unitsNeeded: Math.round(gap30), rationale: rat30.join(' + ') });
    }

    // 50% AMI segment
    if (!_missing(gap50) && gap50 > 0) {
      var prio50 = 'moderate';
      var rat50  = ['Working-family demand at 50% AMI'];
      if (gap50 > gap30) {
        prio50 = 'high';
        rat50 = ['Largest gap tier — workforce housing demand at 50% AMI'];
      }
      if (!_missing(pmaScore) && pmaScore >= 70) rat50.push('Strong PMA score supports workforce housing demand');
      segments.push({ ami: 50, priority: prio50, unitsNeeded: Math.round(gap50), rationale: rat50.join(' + ') });
    }

    // 60% AMI segment
    if (!_missing(gap60) && gap60 > 0) {
      var prio60 = 'moderate';
      var rat60  = ['Near-market affordability gap at 60% AMI'];
      segments.push({ ami: 60, priority: prio60, unitsNeeded: Math.round(gap60), rationale: rat60.join(' + ') });
    }

    // Sort by priority
    var priorityOrder = { critical: 0, high: 1, moderate: 2, low: 3 };
    segments.sort(function (a, b) {
      return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
    });

    return segments;
  }

  /* ── Confidence assessment ───────────────────────────────────────── */

  function _computeConfidence(hnaData, pmaResult, caveats) {
    var score = 0;
    var maxScore = 5;

    if (hnaData && !_missing(hnaData.ami30UnitsNeeded || hnaData.gap_30ami)) score += 2;
    else caveats.push('HNA affordability gap data missing — AMI analysis uses estimates');

    if (pmaResult && !_missing(pmaResult.score || pmaResult.pma_score)) score += 1.5;
    else caveats.push('PMA score not available — demand signals are estimated');

    if (hnaData && !_missing(hnaData.vacancyRate || hnaData.vacancy)) score += 1;
    else caveats.push('Vacancy rate data unavailable — market tightness unconfirmed');

    if (hnaData && !_missing(hnaData.dataVintage || hnaData.vintage)) {
      var vintage = hnaData.dataVintage || hnaData.vintage;
      var vintageDate = new Date(vintage);
      var ageMonths = (new Date() - vintageDate) / (1000 * 60 * 60 * 24 * 30);
      if (ageMonths > 18) {
        caveats.push('HNA data is ' + Math.round(ageMonths) + ' months old — verify current conditions');
        score -= 0.5;
      } else {
        score += 0.5;
      }
    }

    var ratio = Math.max(0, score) / maxScore;
    if (ratio >= 0.70) return 'high';
    if (ratio >= 0.40) return 'medium';
    return 'low';
  }

  /* ── PMA result normalization ────────────────────────────────────── */

  function _normalizePma(pmaResult) {
    if (!pmaResult) {
      return { method: 'unknown', score: null, confidence: 'low' };
    }
    return {
      method:     pmaResult.method || pmaResult.pma_method || 'buffer',
      score:      _missing(pmaResult.score) ? _num(pmaResult.pma_score, null) : _num(pmaResult.score, null),
      confidence: pmaResult.confidence || pmaResult.pma_confidence || 'low',
      tractCount: _num(pmaResult.tractCount || pmaResult.tract_count, null)
    };
  }

  /* ── Main buildNeedProfile function ─────────────────────────────── */

  /**
   * Build a unified need profile from HNA and PMA data.
   *
   * @param {Object} hnaData   — HNA affordability gap data for the county/area
   * @param {Object} pmaResult — PMA analysis result object (from PMAAnalysisRunner or PMAEngine)
   * @param {Object} [options] — { geoid, name, type }
   * @returns {NeedProfile}
   */
  function buildNeedProfile(hnaData, pmaResult, options) {
    options = options || {};

    var caveats = [];
    var demandSignals    = _extractDemandSignals(hnaData);
    var affordabilityGap = _extractAffordabilityGap(hnaData);
    var pma              = _normalizePma(pmaResult);
    var prioritySegments = _buildPrioritySegments(affordabilityGap, pma);
    var confidence       = _computeConfidence(hnaData, pmaResult, caveats);

    if (!hnaData)   caveats.push('No HNA data provided — need profile uses structural estimates only');
    if (!pmaResult) caveats.push('No PMA result provided — market signals unavailable');

    return {
      geography: {
        geoid: String(options.geoid || (hnaData && hnaData.geoid) || ''),
        name:  options.name  || (hnaData && hnaData.countyName) || 'Unknown',
        type:  options.type  || (hnaData && hnaData.geoType)    || 'county'
      },
      pma:              pma,
      demandSignals:    demandSignals,
      affordabilityGap: affordabilityGap,
      prioritySegments: prioritySegments,
      confidence:       confidence,
      caveats:          caveats
    };
  }

  /**
   * Convenience: extract DealInputs-compatible fields from a NeedProfile.
   * Bridges the NeedProfile to the LIHTCDealPredictor.predictConcept() input shape.
   *
   * @param {NeedProfile} needProfile
   * @param {Object}      [overrides] — additional fields to merge
   * @returns {Object} DealInputs-compatible object
   */
  function toDealInputs(needProfile, overrides) {
    if (!needProfile) return overrides || {};
    var gap = needProfile.affordabilityGap || {};
    var pma = needProfile.pma             || {};
    return Object.assign({
      geoid:                needProfile.geography ? needProfile.geography.geoid : '',
      pmaScore:             pma.score,
      pmaConfidence:        pma.confidence,
      ami30UnitsNeeded:     gap.ami30UnitsNeeded,
      ami50UnitsNeeded:     gap.ami50UnitsNeeded,
      ami60UnitsNeeded:     gap.ami60UnitsNeeded,
      totalUndersupply:     gap.totalUndersupply,
      marketVacancy:        gap.vacancy
    }, overrides || {});
  }

  return {
    buildNeedProfile: buildNeedProfile,
    toDealInputs:     toDealInputs
  };
}));
