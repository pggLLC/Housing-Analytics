/**
 * js/market-analysis/housing-needs-fit-analyzer.js
 * Bridges Housing Needs Assessment (HNA) data with LIHTC concept recommendations.
 *
 * Given a NeedProfile (from HNAMarketBridge.buildNeedProfile()) and a
 * DealRecommendation (from LIHTCDealPredictor.predictConcept()), this module
 * computes how well the proposed concept addresses the county or municipal
 * housing need:
 *
 *   - Which AMI priority segments this concept targets
 *   - % of identified unmet need covered by the proposed AMI mix
 *   - Alignment rating: "strong" | "partial" | "weak"
 *   - Narrative bullets grounded in local HNA data
 *   - Un-addressed gaps (tiers with significant need but no allocation)
 *
 * Usage (browser):  window.HousingNeedsFitAnalyzer.analyzeHousingNeedsFit(...)
 * Usage (Node/test): const hna = require('./js/market-analysis/housing-needs-fit-analyzer');
 */
/* global module, self */
;(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.HousingNeedsFitAnalyzer = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────────────── */

  function _pctToUnits(pctOrStr, totalUnits) {
    if (pctOrStr === null || pctOrStr === undefined) return 0;
    var str = String(pctOrStr).replace('%', '').trim();
    var pct = parseFloat(str);
    if (!isFinite(pct) || totalUnits <= 0) return 0;
    if (pct > 0 && pct <= 1) pct = pct * 100;
    return Math.round((pct / 100) * totalUnits);
  }

  function _n(v) {
    var n = parseFloat(v);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  /* ── Main analysis function ──────────────────────────────────────── */

  /**
   * @typedef {Object} HNSFit
   * @property {string}   geography        - County or municipality name.
   * @property {string[]} prioritySegments - AMI tiers addressed by this concept.
   * @property {{ami30:number, ami50:number, ami60:number, total:number}} needCoverage
   * @property {string}   alignment        - "strong" | "partial" | "weak".
   * @property {string[]} alignmentPoints  - 2–5 narrative bullet statements.
   * @property {string[]} gaps             - Unaddressed tiers with significant need.
   * @property {number}   coveragePct      - Overall coverage score 0–100.
   *
   * @param {Object|null} needProfile - Output of HNAMarketBridge.buildNeedProfile().
   * @param {Object|null} rec         - Output of LIHTCDealPredictor.predictConcept().
   * @param {Object}      [opts]      - Optional overrides.
   * @param {number}      [opts.proposedUnits] - Override total unit count.
   * @returns {HNSFit}
   */
  function analyzeHousingNeedsFit(needProfile, rec, opts) {
    opts = opts || {};

    var EMPTY = {
      geography:        'the area',
      prioritySegments: [],
      needCoverage:     { ami30: 0, ami50: 0, ami60: 0, total: 0 },
      alignment:        'weak',
      alignmentPoints:  ['Insufficient HNA data available to assess housing needs fit.'],
      gaps:             [],
      coveragePct:      0
    };

    if (!needProfile || !rec) return EMPTY;

    var geo       = (needProfile.geography && needProfile.geography.name) || 'the area';
    var afGap     = needProfile.affordabilityGap || {};
    var segments  = needProfile.prioritySegments  || [];
    var amiMix    = rec.suggestedAMIMix  || {};
    var unitMix   = rec.suggestedUnitMix || {};

    var unitMixTotal = _n(unitMix.studio) + _n(unitMix.oneBR)  +
                       _n(unitMix.twoBR)  + _n(unitMix.threeBR) +
                       _n(unitMix.fourBRPlus);
    var proposedUnits = opts.proposedUnits ||
      (unitMixTotal > 0 ? unitMixTotal : 60);

    var ami30Units = _pctToUnits(amiMix.ami30, proposedUnits);
    var ami40Units = _pctToUnits(amiMix.ami40, proposedUnits);
    var ami50Units = _pctToUnits(amiMix.ami50, proposedUnits);
    var ami60Units = _pctToUnits(amiMix.ami60, proposedUnits);

    var need30 = _n(afGap.ami30UnitsNeeded || afGap.ami30Needed || 0);
    var need50 = _n(afGap.ami50UnitsNeeded || afGap.ami50Needed || 0);
    var need60 = _n(afGap.ami60UnitsNeeded || afGap.ami60Needed || 0);

    var effective30 = ami30Units + Math.round(ami40Units * 0.5);
    var effective50 = ami50Units + Math.round(ami40Units * 0.5);

    function _cov(numerator, denominator) {
      if (denominator <= 0) return numerator > 0 ? 100 : 0;
      return Math.min(100, Math.round((numerator / denominator) * 100));
    }

    var cov30   = _cov(effective30,   need30);
    var cov50   = _cov(effective50,   need50);
    var cov60   = _cov(ami60Units,    need60);
    var totalIn = ami30Units + ami40Units + ami50Units + ami60Units;
    var totalNd = need30 + need50 + need60;
    var covTot  = _cov(totalIn, totalNd);

    var targeted = [];
    if (effective30 > 0 && need30 > 0) targeted.push('30% AMI');
    if (effective50 > 0 && need50 > 0) targeted.push('50% AMI');
    if (ami60Units > 0  && need60 > 0) targeted.push('60% AMI');

    if (targeted.length === 0 && segments.length > 0) {
      var topSeg = segments[0];
      targeted.push(topSeg.ami || topSeg.tier || 'Priority AMI tier');
    }

    var alignScore = (cov30 + cov50 + cov60) / 3;
    var alignment  = alignScore >= 50 ? 'strong' :
                     alignScore >= 15 ? 'partial' : 'weak';

    var points = [];

    if (need30 > 0 && effective30 > 0) {
      var depth30 = need30 < 100 ? 'small' : need30 < 500 ? 'moderate' : 'significant';
      points.push(effective30 + ' units at 30% AMI address the ' + depth30 +
        ' deep-affordability gap in ' + geo + ' (\u2248' + cov30 + '% of identified need)');
    } else if (need30 > 0 && effective30 === 0) {
      points.push('30% AMI deep-affordability gap (' + need30 + ' units needed) is not directly addressed by this concept');
    }

    if (need50 > 0 && effective50 > 0) {
      points.push(effective50 + ' units at 50% AMI target the workforce housing gap (\u2248' + cov50 + '% of need)');
    }

    if (need60 > 0 && ami60Units > 0) {
      points.push(ami60Units + ' units at 60% AMI align with the primary rental affordability deficit (\u2248' + cov60 + '% of need)');
    }

    if (points.length === 0) {
      points.push('This concept is projected to partially address housing demand in ' + geo);
    }

    if (covTot >= 5) {
      points.push('Project would address approximately ' + covTot + '% of the total identified affordable unit gap');
    }

    if (alignment === 'strong') {
      points.push('Strong alignment \u2014 AMI mix closely matches ' + geo + '\'s priority affordability segments');
    } else if (alignment === 'partial') {
      points.push('Partial alignment \u2014 consider deepening affordability to close remaining gaps');
    }

    var gaps = [];
    if (need30 > 50 && effective30 < 5) {
      gaps.push(need30 + ' units needed at 30% AMI \u2014 deep-affordability gap remains after this project');
    }
    if (need50 > 50 && effective50 < 5) {
      gaps.push(need50 + ' units needed at 50% AMI \u2014 could be partially addressed by adding units in this tier');
    }
    if (need60 > 50 && ami60Units < 5) {
      gaps.push(need60 + ' units needed at 60% AMI \u2014 current AMI mix leaves this tier unaddressed');
    }

    return {
      geography:        geo,
      prioritySegments: targeted,
      needCoverage:     { ami30: cov30, ami50: cov50, ami60: cov60, total: covTot },
      alignment:        alignment,
      alignmentPoints:  points,
      gaps:             gaps,
      coveragePct:      covTot
    };
  }

  return {
    analyzeHousingNeedsFit: analyzeHousingNeedsFit
  };

}));
