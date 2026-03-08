/**
 * js/market-analysis/site-selection-score.js
 * 6-component weighted scoring model for affordable housing site selection.
 * Exposes window.SiteSelectionScore.
 *
 * Component weights (must sum to 1.0):
 *   demand      0.25
 *   subsidy     0.20
 *   feasibility 0.15
 *   access      0.15
 *   policy      0.15
 *   market      0.10
 */
(function () {
  'use strict';

  /* ── Component weights ──────────────────────────────────────────── */
  /** @type {object} */
  var COMPONENT_WEIGHTS = {
    demand:      0.25,
    subsidy:     0.20,
    feasibility: 0.15,
    access:      0.15,
    policy:      0.15,
    market:      0.10
  };

  /* ── Internal helpers ───────────────────────────────────────────── */

  /**
   * Clamp a value to [0, 100].
   * @param {number} v
   * @returns {number}
   */
  function _clamp(v) {
    return Math.min(100, Math.max(0, isNaN(v) ? 0 : v));
  }

  /**
   * Return `defaultVal` when `v` is null, undefined, or NaN.
   * @param {*} v
   * @param {number} defaultVal
   * @returns {number}
   */
  function _safe(v, defaultVal) {
    return (v === null || v === undefined || isNaN(v)) ? defaultVal : Number(v);
  }

  /**
   * Resolve the opportunityBand helper, preferring window.MAUtils.
   * @param {number} score
   * @returns {string}
   */
  function _band(score) {
    var utils = window.MAUtils;
    if (utils && typeof utils.opportunityBand === 'function') {
      return utils.opportunityBand(score);
    }
    if (score >= 70) return 'High';
    if (score >= 45) return 'Moderate';
    return 'Lower';
  }

  /* ── Component scorers ──────────────────────────────────────────── */

  /**
   * Score the housing demand signal from ACS tract metrics.
   *
   * Drivers:
   *   cost_burden_rate – higher burden → higher demand pressure (0–50 pts)
   *   renter_share     – higher renter concentration → higher need  (0–30 pts)
   *   poverty_rate     – higher poverty → deeper affordability gap   (0–20 pts)
   *
   * @param {object|null} acs - Aggregated ACS object.
   *   Expected keys: cost_burden_rate (0–1), renter_share (0–1), poverty_rate (0–1).
   * @returns {number} 0–100
   */
  function scoreDemand(acs) {
    if (!acs || typeof acs !== 'object') return 50; // neutral fallback

    // Cost-burden component: 45 %+ is the high-pressure ceiling.
    var cb    = _safe(acs.cost_burden_rate, 0.30);
    var cbPts = _clamp((cb / 0.45) * 50);

    // Renter-share component: 60 %+ represents high renter concentration.
    var rs    = _safe(acs.renter_share, 0.35);
    var rsPts = _clamp((rs / 0.60) * 30);

    // Poverty-rate component: 20 %+ is the high-poverty ceiling.
    var pov    = _safe(acs.poverty_rate, 0.12);
    var povPts = _clamp((pov / 0.20) * 20);

    return _clamp(cbPts + rsPts + povPts);
  }

  /**
   * Score the subsidy eligibility and market positioning.
   *
   * @param {boolean|number} qctFlag          - Site is in a QCT (1=yes).
   * @param {boolean|number} ddaFlag          - Site is in a DDA (1=yes).
   * @param {number}         fmrRatio         - Market rent ÷ FMR (Fair Market Rent).
   * @param {number}         nearbySubsidized - Count of subsidised units within buffer.
   * @returns {number} 0–100
   */
  function scoreSubsidy(qctFlag, ddaFlag, fmrRatio, nearbySubsidized) {
    var score = 0;

    // QCT designation adds 30 pts (basis-boost eligibility).
    if (qctFlag) score += 30;

    // DDA designation adds 20 pts (additional basis boost).
    if (ddaFlag) score += 20;

    // FMR ratio: a ratio ≥ 1.10 (market rents above FMR) signals subsidy gap.
    // Scale from 0 at 0.80 to 30 pts at 1.20+.
    var fmr    = _safe(fmrRatio, 1.0);
    var fmrPts = _clamp(((fmr - 0.80) / 0.40) * 30);
    score += fmrPts;

    // Nearby subsidized units: gap measured against 200-unit saturation ceiling.
    // Fewer units → more need → higher score (up to 20 pts).
    var ns     = _safe(nearbySubsidized, 0);
    var nsPts  = _clamp(((200 - Math.min(ns, 200)) / 200) * 20);
    score += nsPts;

    return _clamp(score);
  }

  /**
   * Score the physical site feasibility.
   *
   * @param {number}  floodRisk   - 0 (none) – 3 (high); higher = worse.
   * @param {number}  soilScore   - 0–100; higher = better bearing capacity.
   * @param {boolean} cleanupFlag - True when a brownfield/cleanup action is required.
   * @returns {number} 0–100
   */
  function scoreFeasibility(floodRisk, soilScore, cleanupFlag) {
    // Flood risk penalty: each level removes 20 pts from a 60-pt base.
    var flood    = _safe(floodRisk, 0);
    var floodPts = _clamp(60 - (flood * 20));

    // Soil score contributes up to 30 pts.
    var soil    = _safe(soilScore, 50);
    var soilPts = _clamp((soil / 100) * 30);

    // Cleanup/brownfield deducts 10 pts.
    var cleanupPenalty = cleanupFlag ? 10 : 0;

    return _clamp(floodPts + soilPts - cleanupPenalty);
  }

  /**
   * Score neighborhood amenity access.
   * Lower distances to key amenities → higher score.
   *
   * @param {object|null} amenities - Distances in miles.
   *   Keys: grocery, transit, parks, healthcare, schools.
   * @returns {number} 0–100
   */
  function scoreAccess(amenities) {
    if (!amenities || typeof amenities !== 'object') return 50;

    /**
     * Convert a distance to a 0–maxPts score.
     * Distance at or below `near` earns full points; at or above `far` earns 0.
     */
    function _distPts(dist, near, far, maxPts) {
      var d = _safe(dist, far);
      if (d <= near) return maxPts;
      if (d >= far)  return 0;
      return _clamp(((far - d) / (far - near)) * maxPts);
    }

    var grocery    = _distPts(_safe(amenities.grocery,    2), 0.5, 2.0, 25);
    var transit    = _distPts(_safe(amenities.transit,    1), 0.25, 1.0, 25);
    var parks      = _distPts(_safe(amenities.parks,      1), 0.25, 1.0, 15);
    var healthcare = _distPts(_safe(amenities.healthcare, 3), 1.0,  3.0, 20);
    var schools    = _distPts(_safe(amenities.schools,    1), 0.5,  2.0, 15);

    return _clamp(grocery + transit + parks + healthcare + schools);
  }

  /**
   * Score policy and zoning opportunity.
   *
   * @param {number}  zoningCapacity  - Estimated affordable units permitted by-right.
   * @param {boolean} publicOwnership - True when site is publicly owned.
   * @param {number}  overlayCount    - Number of supportive policy overlays present.
   * @returns {number} 0–100
   */
  function scorePolicy(zoningCapacity, publicOwnership, overlayCount) {
    // Zoning capacity: up to 200 units maps to 50 pts.
    var zc    = _safe(zoningCapacity, 0);
    var zcPts = _clamp((Math.min(zc, 200) / 200) * 50);

    // Public ownership adds 30 pts (land-cost reduction).
    var pubPts = publicOwnership ? 30 : 0;

    // Overlays: each overlay adds 5 pts up to 20 pts maximum.
    var oc      = _safe(overlayCount, 0);
    var ocPts   = _clamp(Math.min(oc, 4) * 5);

    return _clamp(zcPts + pubPts + ocPts);
  }

  /**
   * Score market conditions for affordable housing viability.
   *
   * @param {number} rentTrend       - Annual rent change % (e.g. 0.05 = 5 %).
   * @param {number} jobTrend        - Annual job growth % (e.g. 0.03 = 3 %).
   * @param {number} concentration   - Market concentration index 0–1 (1 = monopoly).
   * @param {number} serviceStrength - 0–1 service-industry employment share.
   * @returns {number} 0–100
   */
  function scoreMarket(rentTrend, jobTrend, concentration, serviceStrength) {
    // Rent growth: 5 %+ annual growth maps to full 30 pts.
    var rt    = _safe(rentTrend, 0);
    var rtPts = _clamp((Math.min(Math.max(rt, 0), 0.05) / 0.05) * 30);

    // Job growth: 3 %+ annual growth maps to full 25 pts.
    var jt    = _safe(jobTrend, 0);
    var jtPts = _clamp((Math.min(Math.max(jt, 0), 0.03) / 0.03) * 25);

    // Low concentration (competitive market) is favorable; penalize monopoly.
    var conc     = _safe(concentration, 0.5);
    var concPts  = _clamp((1 - conc) * 25);

    // Service-industry strength: 30 %+ share → 20 pts (workforce demand signal).
    var ss    = _safe(serviceStrength, 0.20);
    var ssPts = _clamp((Math.min(ss, 0.30) / 0.30) * 20);

    return _clamp(rtPts + jtPts + concPts + ssPts);
  }

  /* ── Main scoring entry point ───────────────────────────────────── */

  /**
   * Compute the composite site selection score.
   *
   * @param {object} inputs
   * @param {object}  inputs.acs               - ACS aggregate (see scoreDemand).
   * @param {boolean} inputs.qctFlag            - QCT designation.
   * @param {boolean} inputs.ddaFlag            - DDA designation.
   * @param {number}  inputs.fmrRatio           - Market rent / FMR.
   * @param {number}  inputs.nearbySubsidized   - Subsidised units in buffer.
   * @param {number}  inputs.floodRisk          - 0–3 flood risk level.
   * @param {number}  inputs.soilScore          - 0–100 soil bearing score.
   * @param {boolean} inputs.cleanupFlag        - Brownfield cleanup required.
   * @param {object}  inputs.amenities          - Distance-to-amenities map (miles).
   * @param {number}  inputs.zoningCapacity     - By-right affordable units.
   * @param {boolean} inputs.publicOwnership    - Site publicly owned.
   * @param {number}  inputs.overlayCount       - Supportive overlays present.
   * @param {number}  inputs.rentTrend          - Annual rent growth rate.
   * @param {number}  inputs.jobTrend           - Annual job growth rate.
   * @param {number}  inputs.concentration      - Market concentration 0–1.
   * @param {number}  inputs.serviceStrength    - Service employment share 0–1.
   * @returns {{
   *   demand_score: number,
   *   subsidy_score: number,
   *   feasibility_score: number,
   *   access_score: number,
   *   policy_score: number,
   *   market_score: number,
   *   final_score: number,
   *   opportunity_band: string,
   *   component_weights: object,
   *   narrative: string
   * }}
   */
  function computeScore(inputs) {
    var i = inputs || {};

    var demand_score      = Math.round(scoreDemand(i.acs));
    var subsidy_score     = Math.round(scoreSubsidy(i.qctFlag, i.ddaFlag, i.fmrRatio, i.nearbySubsidized));
    var feasibility_score = Math.round(scoreFeasibility(i.floodRisk, i.soilScore, i.cleanupFlag));
    var access_score      = Math.round(scoreAccess(i.amenities));
    var policy_score      = Math.round(scorePolicy(i.zoningCapacity, i.publicOwnership, i.overlayCount));
    var market_score      = Math.round(scoreMarket(i.rentTrend, i.jobTrend, i.concentration, i.serviceStrength));

    var W = COMPONENT_WEIGHTS;
    var final_score = Math.round(
      demand_score      * W.demand      +
      subsidy_score     * W.subsidy     +
      feasibility_score * W.feasibility +
      access_score      * W.access      +
      policy_score      * W.policy      +
      market_score      * W.market
    );
    final_score = _clamp(final_score);

    var opportunity_band = _band(final_score);

    var narrative = _buildNarrative(
      final_score, opportunity_band,
      demand_score, subsidy_score, feasibility_score,
      access_score, policy_score, market_score
    );

    return {
      demand_score:      demand_score,
      subsidy_score:     subsidy_score,
      feasibility_score: feasibility_score,
      access_score:      access_score,
      policy_score:      policy_score,
      market_score:      market_score,
      final_score:       final_score,
      opportunity_band:  opportunity_band,
      component_weights: COMPONENT_WEIGHTS,
      narrative:         narrative
    };
  }

  /* ── Narrative builder ──────────────────────────────────────────── */

  /**
   * Build a plain-English narrative summarising the scoring result.
   * @private
   */
  function _buildNarrative(final, band, demand, subsidy, feasibility, access, policy, market) {
    var parts = [];

    parts.push(
      'This site received an overall score of ' + final + '/100, ' +
      'placing it in the \u201c' + band + '\u201d opportunity band.'
    );

    // Identify the top driver (highest scoring component).
    // Sort a copy so the original declaration order is preserved.
    var comps = [
      { label: 'housing demand', score: demand },
      { label: 'subsidy eligibility', score: subsidy },
      { label: 'physical feasibility', score: feasibility },
      { label: 'neighborhood access', score: access },
      { label: 'policy environment', score: policy },
      { label: 'market conditions', score: market }
    ].slice().sort(function (a, b) { return b.score - a.score; });

    parts.push(
      'The strongest driver is ' + comps[0].label +
      ' (' + comps[0].score + '), followed by ' +
      comps[1].label + ' (' + comps[1].score + ').'
    );

    // Flag any component below 40 as a risk.
    var risks = comps.filter(function (c) { return c.score < 40; });
    if (risks.length > 0) {
      var riskLabels = risks.map(function (c) { return c.label; }).join(', ');
      parts.push(
        'Areas requiring attention: ' + riskLabels + '.'
      );
    } else {
      parts.push('No components scored below the moderate threshold.');
    }

    return parts.join(' ');
  }

  /* ── Expose ─────────────────────────────────────────────────────── */
  window.SiteSelectionScore = {
    COMPONENT_WEIGHTS: COMPONENT_WEIGHTS,
    scoreDemand:       scoreDemand,
    scoreSubsidy:      scoreSubsidy,
    scoreFeasibility:  scoreFeasibility,
    scoreAccess:       scoreAccess,
    scorePolicy:       scorePolicy,
    scoreMarket:       scoreMarket,
    computeScore:      computeScore
  };

}());
