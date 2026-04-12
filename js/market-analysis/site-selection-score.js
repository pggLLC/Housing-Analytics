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
   * IRC §42(d)(5)(B) allows projects in QCTs or DDAs to qualify for a basis
   * boost up to 130% of eligible basis, materially increasing annual credits.
   * When basis_boost_eligible is provided and true, a unified bonus is awarded.
   * Otherwise, individual qctFlag / ddaFlag are used for backward compatibility.
   *
   * @param {boolean|number} qctFlag             - Site is in a QCT (1=yes).
   * @param {boolean|number} ddaFlag             - Site is in a DDA (1=yes).
   * @param {number}         fmrRatio            - Market rent ÷ FMR (Fair Market Rent).
   * @param {number}         nearbySubsidized    - Count of subsidised units within buffer.
   * @param {boolean}        basis_boost_eligible - Site qualifies for IRC §42(d)(5)(B) basis boost.
   * @returns {number} 0–100
   */
  function scoreSubsidy(qctFlag, ddaFlag, fmrRatio, nearbySubsidized, basis_boost_eligible) {
    var score = 0;

    // IRC §42(d)(5)(B) basis boost: sites in QCTs or DDAs may reach 130% eligible basis.
    // When basis_boost_eligible is provided and true, award a unified bonus (QCT + DDA
    // combined). Fall back to individual flags when the parameter is absent so that
    // callers that do not yet pass basis_boost_eligible continue to work correctly.
    //
    // NOTE: The unified bonus is intentionally 40 pts rather than 50 (the arithmetic
    // sum of 30+20). The IRC §42(d)(5)(B) basis boost is a single election — you
    // qualify or you don't — regardless of whether the site is in a QCT, a DDA, or
    // both. A site in both still gets only one basis boost. The 40-pt score reflects
    // that unified eligibility; individual flags are checked in the fallback branch only
    // to support callers that lack the combined flag.
    if (typeof basis_boost_eligible !== 'undefined' && basis_boost_eligible) {
      score += 40; // Unified QCT/DDA basis boost bonus (single IRC §42(d)(5)(B) election)
    } else {
      // QCT designation adds 30 pts (basis-boost eligibility).
      if (qctFlag) score += 30;

      // DDA designation adds 20 pts (additional basis boost).
      if (ddaFlag) score += 20;
    }

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
   * Score the physical site feasibility — INDICATOR ONLY.
   *
   * NOTE: "soilScore" is actually derived from CDC Environmental Justice
   * Index (EJI) environmental burden, NOT from geotechnical soil data.
   * A high EJI burden → low "soil" score. This is a proxy for
   * environmental risk, not foundation engineering suitability.
   *
   * These scores are directional flags from public data. They do NOT
   * replace Phase I ESA, geotechnical survey, or FEMA LOMA determination.
   *
   * @param {number}  floodRisk   - 0 (none) – 3 (high); FEMA zone indicator.
   * @param {number}  soilScore   - 0–100; EJI environmental burden proxy (NOT geotechnical).
   * @param {boolean} cleanupFlag - True when EJI burden is in high percentile.
   * @returns {number} 0–100
   */
  function scoreFeasibility(floodRisk, soilScore, cleanupFlag) {
    // Flood risk penalty: each level removes 20 pts from a 60-pt base.
    // NOTE: Flood levels are a platform construct (0-3), not FEMA categories
    var flood    = _safe(floodRisk, 0);
    var floodPts = _clamp(60 - (flood * 20));

    // Environmental burden proxy (from EJI, not soil geotechnics)
    var soil    = _safe(soilScore, 50);
    var soilPts = _clamp((soil / 100) * 30);

    // Cleanup/brownfield deducts 10 pts.
    var cleanupPenalty = cleanupFlag ? 10 : 0;

    return _clamp(floodPts + soilPts - cleanupPenalty);
  }

  /**
   * Score neighborhood amenity access, optionally blended with EPA SLD
   * walkability and bikeability scores.
   *
   * Without walkability context: pure distance-based scoring (backward compatible).
   * With walkability context: 55% distance + 25% walkability + 20% bikeability.
   *
   * @param {object|null} amenities - Distances in miles.
   *   Keys: grocery, transit, parks, healthcare, schools.
   * @param {object|null} [walkabilityCtx] - From EpaWalkability.getScores().
   *   Keys: walkScore (0-100), bikeScore (0-100).
   * @returns {number} 0–100
   */
  function scoreAccess(amenities, walkabilityCtx) {
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
    var parks      = _distPts(_safe(amenities.parks,      1), 0.25, 1.0, 15);
    var healthcare = _distPts(_safe(amenities.healthcare, 3), 1.0,  3.0, 20);
    var schools    = _distPts(_safe(amenities.schools,    1), 0.5,  2.0, 15);

    // Transit scoring: differentiate fixed rail/tram from bus stops.
    // Rail/tram within 0.5mi earns full points; bus requires closer proximity.
    // Falls back to generic transit distance if no type data available.
    var transitPts = 0;
    var railDist  = _safe(amenities.transit_rail, 99);
    var busDist   = _safe(amenities.transit_bus, 99);
    var anyDist   = _safe(amenities.transit, 1);

    if (railDist < 99) {
      // Rail/tram: best within 0.5mi, good within 1.5mi
      transitPts = Math.max(transitPts, _distPts(railDist, 0.5, 1.5, 25));
    }
    if (busDist < 99) {
      // Bus: best within 0.25mi, good within 1mi
      transitPts = Math.max(transitPts, _distPts(busDist, 0.25, 1.0, 20));
    }
    if (transitPts === 0) {
      // No typed transit data — use generic distance (legacy behavior)
      transitPts = _distPts(anyDist, 0.25, 1.0, 25);
    }

    var distanceScore = _clamp(grocery + transitPts + parks + healthcare + schools);

    // If walkability context is available, blend it into the access score.
    // This captures whether the measured distances are actually traversable
    // on foot or bike (street network connectivity, intersection density,
    // car-orientation of the built environment).
    if (walkabilityCtx && typeof walkabilityCtx.walkScore === 'number') {
      var walkPts = _clamp(walkabilityCtx.walkScore);
      var bikePts = _clamp(_safe(walkabilityCtx.bikeScore, walkPts));
      return _clamp(Math.round(
        distanceScore * 0.55 +
        walkPts       * 0.25 +
        bikePts       * 0.20
      ));
    }

    return distanceScore;
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
    var subsidy_score     = Math.round(scoreSubsidy(i.qctFlag, i.ddaFlag, i.fmrRatio, i.nearbySubsidized, i.basisBoostEligible));
    var feasibility_score = Math.round(scoreFeasibility(i.floodRisk, i.soilScore, i.cleanupFlag));
    var access_score      = Math.round(scoreAccess(i.amenities, i.walkabilityCtx));
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
   * Build a plain-English narrative summarizing the scoring result.
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

  /**
   * Market tightness score derived from ACS vacancy rate.
   * NOTE: Despite the legacy function name, this measures how fully
   * occupied the existing housing stock is — NOT land availability
   * for new construction. Low vacancy = tight market = demand signal.
   * Function name retained for backward compatibility.
   *
   * @param {object|null} acs - ACS aggregate. Expected key: vacancy_rate (0–1 decimal).
   * @returns {number} 0–100
   */
  function scoreLandSupply(acs) {
    if (!acs || typeof acs !== 'object') return 50;
    var vac = _safe(acs.vacancy_rate, 0.05);
    // Very low vacancy (<1%) → score ≈ 92; at 12%+ vacancy → score ≈ 0.
    return _clamp(Math.round((1 - vac / 0.12) * 100));
  }

  /**
   * Enhanced land-supply score that incorporates Bridge assessed land value data.
   * When Bridge data is unavailable, falls back to pure ACS vacancy-based scoring.
   *
   * @param {object} acs - ACS data (vacancy_rate etc.)
   * @param {object|null} bridgeContext - from BridgeMarketSummary.getLandCostContext()
   *   { tier: 'low'|'moderate'|'high'|'unknown', medianLandValue: number|null, isRural: boolean }
   * @returns {number} 0-100
   */
  function scoreLandSupplyWithBridge(acs, bridgeContext) {
    var base = scoreLandSupply(acs);   // ACS vacancy-rate base score
    if (!bridgeContext || bridgeContext.tier === 'unknown') return base;

    // Blend: 60% ACS vacancy signal, 40% Bridge land cost signal
    var landCostScore;
    if (bridgeContext.tier === 'low')      landCostScore = 80;
    else if (bridgeContext.tier === 'moderate') landCostScore = 55;
    else                                       landCostScore = 30;  // 'high'

    // Rural bonus: rural markets have structurally more developable land
    if (bridgeContext.isRural) landCostScore = Math.min(100, landCostScore + 10);

    return _clamp(Math.round(base * 0.60 + landCostScore * 0.40));
  }

  /**
   * Enhanced market score blending existing inputs with Bridge transaction velocity.
   * @param bridgeContext - from BridgeMarketSummary.getMarketVelocity()
   *   { transactionCount: number, priceTrendPct: number|null, label: 'active'|'moderate'|'quiet' }
   */
  function scoreMarketWithBridge(rentTrend, jobTrend, concentration, serviceStrength, bridgeContext) {
    var base = scoreMarket(rentTrend, jobTrend, concentration, serviceStrength);
    if (!bridgeContext || !bridgeContext.label || bridgeContext.label === 'unknown') return base;

    // Market velocity bonus/penalty (±10 pts max)
    var velocityAdj = bridgeContext.label === 'active'   ?  8 :
                      bridgeContext.label === 'moderate'  ?  0 :
                     /* quiet */                           -8;

    // Price trend boost (Bridge transaction data, 0-5% trend range)
    var trendAdj = 0;
    if (bridgeContext.priceTrendPct != null) {
      trendAdj = _clamp(Math.round((Math.min(bridgeContext.priceTrendPct / 5, 1)) * 7));
    }

    return _clamp(base + velocityAdj + trendAdj);
  }

  /* ── Expose ─────────────────────────────────────────────────────── */
  window.SiteSelectionScore = {
    COMPONENT_WEIGHTS:         COMPONENT_WEIGHTS,
    scoreDemand:               scoreDemand,
    scoreSubsidy:              scoreSubsidy,
    scoreFeasibility:          scoreFeasibility,
    scoreAccess:               scoreAccess,
    scorePolicy:               scorePolicy,
    scoreMarket:               scoreMarket,
    scoreLandSupply:           scoreLandSupply,
    scoreLandSupplyWithBridge: scoreLandSupplyWithBridge,
    scoreMarketWithBridge:     scoreMarketWithBridge,
    computeScore:              computeScore
  };

}());
