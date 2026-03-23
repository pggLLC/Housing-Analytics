# LIHTC Deal Predictor — Method Guide & Schema Documentation

## Overview

The LIHTC Deal Predictor (`js/lihtc-deal-predictor.js`) is a concept-level recommendation engine that generates planning-level recommendations for Low-Income Housing Tax Credit (LIHTC) development based on site analysis, Primary Market Area (PMA) results, Housing Needs Assessment (HNA) data, and local market conditions.

**Exposed as:** `window.LIHTCDealPredictor` (browser) · `module.exports` (Node/test)

**Primary function:** `LIHTCDealPredictor.predictConcept(inputs)`

---

## Non-Goals (Explicitly Documented)

This module **does not**:

- Underwrite individual projects (no investor-level pro forma)
- Predict CHFA QAP award outcomes (no competitive scoring model)
- Calculate basis, eligible basis, or applicable fraction
- Model permanent debt underwriting (DSCR, LTV)
- Finalize a capital stack (indicative outline only)

All outputs are concept-level planning tools and must be validated by a qualified LIHTC syndicator and attorney before proceeding.

---

## Input Schema (`DealInputs`)

| Field | Type | Description |
|---|---|---|
| `geoid` | `string` | 5-digit county FIPS code |
| `pmaScore` | `number` | PMA site score (0–100) from PMAAnalysisRunner |
| `pmaConfidence` | `string` | `'high'` \| `'medium'` \| `'low'` |
| `proposedUnits` | `number` | Total proposed unit count |
| `ami30UnitsNeeded` | `number` | Units needed at 30% AMI (from HNA affordability gap) |
| `ami50UnitsNeeded` | `number` | Units needed at 50% AMI |
| `ami60UnitsNeeded` | `number` | Units needed at 60% AMI |
| `totalUndersupply` | `number` | Total affordable unit gap from HNA |
| `competitiveSetSize` | `number` | Count of LIHTC projects within the PMA |
| `isQct` | `boolean` | Qualified Census Tract designation |
| `isDda` | `boolean` | Difficult Development Area designation |
| `softFundingAvailable` | `number` | Estimated local soft funding available ($) |
| `marketVacancy` | `number` | Rental vacancy rate (0–1) |
| `medianRentToIncome` | `number` | Median rent-to-income ratio (0–1) |
| `seniorsDemand` | `boolean` | Senior housing demand signal |
| `supportiveNeed` | `boolean` | Supportive housing need signal |

All fields are optional. Missing fields reduce confidence and may trigger caveats.

---

## Output Schema (`DealRecommendation`)

| Field | Type | Description |
|---|---|---|
| `recommendedExecution` | `string` | `'9%'` \| `'4%'` \| `'Either'` |
| `conceptType` | `string` | `'family'` \| `'seniors'` \| `'mixed-use'` \| `'supportive'` |
| `suggestedUnitMix` | `object` | `{ studio, oneBR, twoBR, threeBR, fourBRPlus }` counts |
| `suggestedAMIMix` | `object` | `{ ami30, ami40, ami50, ami60 }` unit counts |
| `indicativeCapitalStack` | `object` | `{ totalDevelopmentCost, equity, firstMortgage, localSoft, stateSoft, deferredFee, gap }` |
| `keyRationale` | `string[]` | Decision factors supporting the recommendation |
| `keyRisks` | `string[]` | Identified risks and warnings |
| `caveats` | `string[]` | Limitations, disclaimers, and data quality notes |
| `confidence` | `string` | `'high'` \| `'medium'` \| `'low'` |
| `confidenceBadge` | `string` | Emoji badge: 🟢 high · 🟡 medium · 🔴 low |
| `alternativePath` | `string` | Description of the alternate credit type path |

---

## Decision Logic

### Credit Type Selection (4% vs 9%)

The module applies a rule-based engine to select `recommendedExecution`:

**Prefer 9%** when:
- Deep affordability need: 30% AMI units exceed 25% of total proposed units
- Project scale is under 100 units (well-suited for competitive application)
- Market saturation is low (fewer than 3 competitive projects in PMA)

**Prefer 4%** when:
- Larger scale: 100+ units proposed
- Soft funding available to close the capital stack gap
- QCT/DDA designation provides basis boost improving 4% economics

**Flag "Either"** when:
- Both soft funding is unavailable AND market is oversaturated (≥5 competitive projects)
- Or large scale with bond cap uncertainty and weak soft funding support

### Concept Type Selection

| Signal | Recommended Concept |
|---|---|
| `supportiveNeed: true` + large 30% AMI gap | `supportive` |
| `seniorsDemand: true` | `seniors` |
| Large total affordability gap + adequate PMA score | `mixed-use` |
| Default | `family` |

### Confidence Scoring

Confidence is computed from the presence of key inputs:

| Input Present | Score Weight |
|---|---|
| PMA score | 1.0 |
| 30% AMI units needed | 1.0 |
| Competitive set size | 1.0 |
| QCT flag | 0.5 |
| DDA flag | 0.5 |
| Soft funding availability | 1.0 |
| Rent-to-income ratio | 1.0 |

**Thresholds:**
- `high`: ≥75% of maximum score
- `medium`: ≥45%
- `low`: <45%

### Unit Mix Calculation

Default unit mix by concept type (as % of total units):

| Bedroom Type | Family | Seniors | Mixed-Use | Supportive |
|---|---|---|---|---|
| Studio | 7% | 20% | 10% | 50% |
| 1-BR | 27% | 60% | 30% | 40% |
| 2-BR | 47% | 20% | 40% | 10% |
| 3-BR | 19% | 0% | 20% | 0% |

### AMI Mix Calculation

Default AMI splits are adjusted toward local HNA gap data when available, weighted up to 50% toward the observed gap distribution.

---

## Indicative Capital Stack

The capital stack is a rough planning-level estimate based on:

- **Hard cost**: $275,000/unit (2026 Colorado average; sourced from `data/policy/lihtc-assumptions.json`)
- **Soft cost**: 22% of hard cost
- **Developer fee**: 15% of total development cost; 50% deferred
- **Equity**: Annual LIHTC credit × 10 years × equity price ($0.87 for 9%, $0.85 for 4%)
- **Basis boost**: 30% if QCT or DDA designated
- **Local soft**: From `softFundingAvailable` input or county default
- **State soft**: Estimated at 10% of TDC, capped at $2M

These are indicative figures. Actual equity pricing, debt terms, and subsidy availability will differ.

---

## Integration Points

### With HNA-PMA Bridge

The recommended workflow uses `HNAMarketBridge` to produce a `NeedProfile` first, then convert it to `DealInputs`:

```javascript
var needProfile = HNAMarketBridge.buildNeedProfile(hnaData, pmaResult);
var dealInputs  = HNAMarketBridge.toDealInputs(needProfile, {
  proposedUnits:       75,
  isQct:               true,
  softFundingAvailable: 1500000
});
var rec = LIHTCDealPredictor.predictConcept(dealInputs);
```

### With PMA Analysis Runner

After `PMAAnalysisRunner.run()` completes, `scoreRun.pmaSupportSummary` contains a structured object with data completeness, source modes, and overall confidence. The UI controller (`pma-ui-controller.js`) uses this to render the concept card automatically.

### Policy Assumptions

All default thresholds (equity pricing, hard cost per unit, saturation thresholds, soft funding by county) are stored in `data/policy/lihtc-assumptions.json`. Update this file to reflect current market conditions.

---

## Limitations

1. **No QAP scoring**: The module cannot predict CHFA competitive award outcomes. 9% credits are awarded competitively; projects that score well here may still not receive funding.
2. **Simplified capital stack**: Does not model DSCR constraints, LTV limits, or investor-specific underwriting requirements.
3. **Static equity pricing**: Uses a single point estimate; actual syndication market prices vary by 3–5 cents quarterly.
4. **No parcel-level data**: Does not incorporate zoning, environmental, or title constraints.
5. **County-level assumptions**: Soft funding availability is estimated at county level; actual program caps vary by fund and cycle.

---

## Files

| File | Purpose |
|---|---|
| `js/lihtc-deal-predictor.js` | Core recommendation engine |
| `js/hna/hna-market-bridge.js` | HNA-PMA need profile builder |
| `data/policy/lihtc-assumptions.json` | Policy and market assumption defaults |
| `test/test_lihtc_deal_predictor.js` | Unit tests (68 checks) |
| `test/test_hna_market_bridge.js` | Unit tests (68 checks) |
| `docs/LIHTC_DEAL_PREDICTOR.md` | This document |

---

## Running Tests

```bash
node test/test_lihtc_deal_predictor.js
node test/test_hna_market_bridge.js
```

Both test files exit with code 0 on success, non-zero on failure. No additional test framework required.

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-03-23 | Initial implementation replacing placeholder stub |

---

*This module is part of the COHO Analytics Phase 2 implementation. See `docs/IMPLEMENTATION-GUIDE.md` for the full Phase 2 architecture overview.*
