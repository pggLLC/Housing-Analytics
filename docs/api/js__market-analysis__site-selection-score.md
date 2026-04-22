# `js/market-analysis/site-selection-score.js`

js/market-analysis/site-selection-score.js
6-component weighted scoring model for affordable housing site selection.
Exposes window.SiteSelectionScore.

Component weights (must sum to 1.0):
  demand      0.25
  subsidy     0.20
  feasibility 0.15
  access      0.15
  policy      0.15
  market      0.10

## Symbols

### `COMPONENT_WEIGHTS`

@type {object}

### `_clamp(v)`

Clamp a value to [0, 100].
@param {number} v
@returns {number}

### `_safe(v, defaultVal)`

Return `defaultVal` when `v` is null, undefined, or NaN.
@param {*} v
@param {number} defaultVal
@returns {number}

### `_band(score)`

Resolve the opportunityBand helper, preferring window.MAUtils.
@param {number} score
@returns {string}

### `scoreDemand(acs)`

Score the housing demand signal from ACS tract metrics.

Drivers:
  cost_burden_rate – higher burden → higher demand pressure (0–50 pts)
  renter_share     – higher renter concentration → higher need  (0–30 pts)
  poverty_rate     – higher poverty → deeper affordability gap   (0–20 pts)

@param {object|null} acs - Aggregated ACS object.
  Expected keys: cost_burden_rate (0–1), renter_share (0–1), poverty_rate (0–1).
@returns {number} 0–100

### `scoreSubsidy(qctFlag, ddaFlag, fmrRatio, nearbySubsidized, basis_boost_eligible)`

Score the subsidy eligibility and market positioning.

IRC §42(d)(5)(B) allows projects in QCTs or DDAs to qualify for a basis
boost up to 130% of eligible basis, materially increasing annual credits.
When basis_boost_eligible is provided and true, a unified bonus is awarded.
Otherwise, individual qctFlag / ddaFlag are used for backward compatibility.

@param {boolean|number} qctFlag             - Site is in a QCT (1=yes).
@param {boolean|number} ddaFlag             - Site is in a DDA (1=yes).
@param {number}         fmrRatio            - Market rent ÷ FMR (Fair Market Rent).
@param {number}         nearbySubsidized    - Count of subsidised units within buffer.
@param {boolean}        basis_boost_eligible - Site qualifies for IRC §42(d)(5)(B) basis boost.
@returns {number} 0–100

### `scoreFeasibility(floodRisk, soilScore, cleanupFlag)`

Score the physical site feasibility — INDICATOR ONLY.

NOTE: "soilScore" is actually derived from CDC Environmental Justice
Index (EJI) environmental burden, NOT from geotechnical soil data.
A high EJI burden → low "soil" score. This is a proxy for
environmental risk, not foundation engineering suitability.

These scores are directional flags from public data. They do NOT
replace Phase I ESA, geotechnical survey, or FEMA LOMA determination.

@param {number}  floodRisk   - 0 (none) – 3 (high); FEMA zone indicator.
@param {number}  soilScore   - 0–100; EJI environmental burden proxy (NOT geotechnical).
@param {boolean} cleanupFlag - True when EJI burden is in high percentile.
@returns {number} 0–100

### `scoreAccess(amenities, walkabilityCtx)`

Score neighborhood amenity access, optionally blended with EPA SLD
walkability and bikeability scores.

Without walkability context: pure distance-based scoring (backward compatible).
With walkability context: 55% distance + 25% walkability + 20% bikeability.

@param {object|null} amenities - Distances in miles.
  Keys: grocery, transit, parks, healthcare, schools.
@param {object|null} [walkabilityCtx] - From EpaWalkability.getScores().
  Keys: walkScore (0-100), bikeScore (0-100).
@returns {number} 0–100

### `scorePolicy(zoningCapacity, publicOwnership, overlayCount)`

Convert a distance to a 0–maxPts score.
Distance at or below `near` earns full points; at or above `far` earns 0.
/
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
Score policy and zoning opportunity.

@param {number}  zoningCapacity  - Estimated affordable units permitted by-right.
@param {boolean} publicOwnership - True when site is publicly owned.
@param {number}  overlayCount    - Number of supportive policy overlays present.
@returns {number} 0–100

### `scoreMarket(rentTrend, jobTrend, concentration, serviceStrength)`

Score market conditions for affordable housing viability.

@param {number} rentTrend       - Annual rent change % (e.g. 0.05 = 5 %).
@param {number} jobTrend        - Annual job growth % (e.g. 0.03 = 3 %).
@param {number} concentration   - Market concentration index 0–1 (1 = monopoly).
@param {number} serviceStrength - 0–1 service-industry employment share.
@returns {number} 0–100

### `computeScore(inputs)`

Compute the composite site selection score.

@param {object} inputs
@param {object}  inputs.acs               - ACS aggregate (see scoreDemand).
@param {boolean} inputs.qctFlag            - QCT designation.
@param {boolean} inputs.ddaFlag            - DDA designation.
@param {number}  inputs.fmrRatio           - Market rent / FMR.
@param {number}  inputs.nearbySubsidized   - Subsidised units in buffer.
@param {number}  inputs.floodRisk          - 0–3 flood risk level.
@param {number}  inputs.soilScore          - 0–100 soil bearing score.
@param {boolean} inputs.cleanupFlag        - Brownfield cleanup required.
@param {object}  inputs.amenities          - Distance-to-amenities map (miles).
@param {number}  inputs.zoningCapacity     - By-right affordable units.
@param {boolean} inputs.publicOwnership    - Site publicly owned.
@param {number}  inputs.overlayCount       - Supportive overlays present.
@param {number}  inputs.rentTrend          - Annual rent growth rate.
@param {number}  inputs.jobTrend           - Annual job growth rate.
@param {number}  inputs.concentration      - Market concentration 0–1.
@param {number}  inputs.serviceStrength    - Service employment share 0–1.
@returns {{
  demand_score: number,
  subsidy_score: number,
  feasibility_score: number,
  access_score: number,
  policy_score: number,
  market_score: number,
  final_score: number,
  opportunity_band: string,
  component_weights: object,
  narrative: string
}}

### `_buildNarrative(final, band, demand, subsidy, feasibility, access, policy, market)`

Build a plain-English narrative summarizing the scoring result.
@private

### `scoreLandSupply(acs)`

Market tightness score derived from ACS vacancy rate.
NOTE: Despite the legacy function name, this measures how fully
occupied the existing housing stock is — NOT land availability
for new construction. Low vacancy = tight market = demand signal.
Function name retained for backward compatibility.

@param {object|null} acs - ACS aggregate. Expected key: vacancy_rate (0–1 decimal).
@returns {number} 0–100

### `scoreLandSupplyWithBridge(acs, bridgeContext)`

Enhanced land-supply score that incorporates Bridge assessed land value data.
When Bridge data is unavailable, falls back to pure ACS vacancy-based scoring.

@param {object} acs - ACS data (vacancy_rate etc.)
@param {object|null} bridgeContext - from BridgeMarketSummary.getLandCostContext()
  { tier: 'low'|'moderate'|'high'|'unknown', medianLandValue: number|null, isRural: boolean }
@returns {number} 0-100

### `scoreMarketWithBridge(rentTrend, jobTrend, concentration, serviceStrength, bridgeContext)`

Enhanced market score blending existing inputs with Bridge transaction velocity.
@param bridgeContext - from BridgeMarketSummary.getMarketVelocity()
  { transactionCount: number, priceTrendPct: number|null, label: 'active'|'moderate'|'quiet' }
