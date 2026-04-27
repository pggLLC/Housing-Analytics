# `js/lihtc-deal-predictor.js`

js/lihtc-deal-predictor.js
LIHTC Deal Predictor — concept-level recommendation engine.

Generates planning-level recommendations (4% vs 9%, concept type, unit/AMI
mix, indicative capital stack) based on site analysis, PMA results, housing
needs, and market conditions.

Non-goals (explicitly documented):
  - Does NOT underwrite individual projects (no investor-level pro forma)
  - Does NOT predict CHFA QAP award (no competitive scoring model)
  - Approximates eligible basis at 85% of TDC; actual eligible basis requires full
    cost-certification review excluding land, permanent fees, and non-depreciable items
  - Does NOT model permanent debt underwriting (DSCR, LTV)
  - Does NOT finalize capital stack (conceptual outline only)

Usage:
  var rec = LIHTCDealPredictor.predictConcept(inputs);
  // rec.recommendedExecution → '9%' | '4%' | 'Either'
  // rec.conceptType         → 'family' | 'seniors' | 'mixed-use' | 'supportive'
  // rec.confidence          → 'high' | 'medium' | 'low'

Exposed as window.LIHTCDealPredictor (browser) and module.exports (Node/test).

@typedef {Object} DealInputs
@property {string}   [geoid]                — 5-digit county FIPS
@property {number}   [pmaScore]             — PMA site score 0–100
@property {string}   [pmaConfidence]        — 'high'|'medium'|'low'
@property {number}   [proposedUnits]        — total proposed units
@property {number}   [ami30UnitsNeeded]     — units needed at 30% AMI (HNA gap)
@property {number}   [ami50UnitsNeeded]     — units needed at 50% AMI
@property {number}   [ami60UnitsNeeded]     — units needed at 60% AMI
@property {number}   [totalUndersupply]     — total affordable unit gap
@property {number}   [competitiveSetSize]   — LIHTC projects within 1 mile
@property {boolean}  [isQct]                — Qualified Census Tract flag
@property {boolean}  [isDda]                — Difficult Development Area flag
@property {number}   [softFundingAvailable] — estimated local soft $ available
@property {number}   [marketVacancy]        — area rental vacancy rate (0–1)
@property {number}   [medianRentToIncome]   — rent-to-income ratio (0–1)
@property {boolean}  [seniorsDemand]        — senior housing demand signal
@property {boolean}  [supportiveNeed]       — supportive housing need signal
@property {string}   [dataVintage]          — ISO date of source data
@property {boolean}  [pabCapAvailable]      — PAB volume cap pre-allocated for 4% execution
@property {Object}   [fmrData]              — HUD FMR data { oneBedroomFMR, twoBedroomFMR, threeBedroomFMR }
@property {number}   [chfaHistoricalAwards] — # of prior CHFA awards in this county (last 5 yrs)
@property {number}   [countyAffordabilityGap] — county-level affordability gap score 0–100

@typedef {Object} DealRecommendation
@property {string}   recommendedExecution   — '9%' | '4%' | 'Either'
@property {string}   conceptType            — 'family'|'seniors'|'mixed-use'|'supportive'
@property {Object}   suggestedUnitMix       — { studio, oneBR, twoBR, threeBR, fourBRPlus }
@property {Object}   suggestedAMIMix        — { ami30, ami40, ami50, ami60 } unit counts
@property {Object}   indicativeCapitalStack — equity, firstMortgage, localSoft, stateSoft, deferredFee, gap
@property {string[]} keyRationale           — decision factors
@property {string[]} keyRisks              — identified risks
@property {string[]} caveats               — limitations/disclaimers
@property {string}   confidence            — 'high' | 'medium' | 'low'
@property {string}   confidenceBadge       — emoji badge for UI display
@property {string}   alternativePath       — description of the alternate credit type path
@property {Object}   scenarioSensitivity   — sensitivity ranges for key risk factors
@property {Object}   fmrAlignment          — how proposed rents align with HUD FMR (if fmrData provided)
@property {Object}   chfaAwardContext       — CHFA historical award context for county

## Symbols

### `_loadAssumptions()`

Load constants from data/policy/lihtc-assumptions.json (once, cached).
Overrides DEFAULT_ASSUMPTIONS where the JSON provides values.
Falls back silently to hardcoded defaults on fetch failure.

### `_HARD_COST_MULTIPLIERS_BY_FIPS`

Geographic cost multipliers by CO county FIPS. Calibrated to bracket
the ~$180k (rural) to ~$450k (resort) range with a Front-Range base
of ~1.0. Applied on top of concept-specific base costs from
lihtc-assumptions.json. Counties not listed here use the base cost
(treated as Front-Range-ish). This is explicit so callers can audit
the assumption rather than inheriting a single statewide number.

### `_getHardCostPerUnit(conceptType, countyFips)`

Return hard cost per unit for the given concept type, optionally
adjusted for the project's county FIPS. When countyFips is not
provided (e.g. caller couldn't resolve it) returns the concept-
specific base cost unmodified — callers should treat that case as
"approximate, no geographic adjustment applied" and surface to user.

@param {string} conceptType  'family' / 'seniors' / 'mixed-use' / 'supportive'
@param {string} [countyFips] 5-digit FIPS for geographic multiplier
@returns {{value:number, source:string, multiplier:number}}

### `_getEligibleBasisPct()`

Return eligible basis percentage, preferring COHO_DEFAULTS when available.

### `predictConcept(inputs)`

Generate a concept-level LIHTC recommendation.

@param {DealInputs} inputs
@returns {DealRecommendation}

### `predict(inputs)`

Legacy predict function — returns DealScore-shaped object for
backward compatibility with any callers using the old stub interface.

@param {Object} inputs
@returns {Object}
