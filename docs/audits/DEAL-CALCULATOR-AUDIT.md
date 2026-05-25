# Deal Calculator + LIHTC Predictor Methodology Audit

*Last updated 2026-05-25 · scope: lihtc-deal-predictor + deal-calculator.html + pro-forma.js + capital stack model*

Written for the Codex handover. This audit covers how the deal calculator computes its capital stack, AMI mix, and recommendation, where the numbers come from, and what's stale/stubbed/wrong.

---

## 1. What the deal calculator does

Three user-facing surfaces, three engines underneath:

| Surface | Engine module | What it does |
|---|---|---|
| **deal-calculator.html** | [`js/deal-calculator.js`](../../js/deal-calculator.js) | Interactive proforma — user inputs unit count, AMI mix, costs → outputs equity, debt service, returns |
| **PMA → Recommended Concept card** | [`js/lihtc-deal-predictor.js`](../../js/lihtc-deal-predictor.js) | Auto-recommends 9% vs 4%, concept type (family/seniors/etc), unit mix, AMI mix, indicative capital stack |
| **HNA → Scenario Builder** | [`js/pro-forma.js`](../../js/pro-forma.js) | Multi-scenario pro-forma sensitivity (rent growth, vacancy, expense ratios) |

The PMA recommender (`lihtc-deal-predictor.js`) is the most-used surface — it's the auto-recommendation users see when they click a site on the PMA map. This audit focuses there.

---

## 2. Default assumptions — where do they come from?

The deal predictor loads assumptions from [`data/policy/lihtc-assumptions.json`](../../data/policy/lihtc-assumptions.json) (version "2026-Q1", lastUpdated 2026-03-20). Falls back to hardcoded defaults in [`lihtc-deal-predictor.js:86-103`](../../js/lihtc-deal-predictor.js) if the file fails to load.

### Current default values (2026-Q1 vintage)

| Assumption | Default | Hardcoded fallback | Source |
|---|---|---|---|
| 9% credit rate | 0.09 | same | IRC §42 |
| 4% credit rate | 0.04 | same | IRC §42 |
| 9% equity price | $0.87 | same | "CHFA syndication market, March 2026" |
| 4% equity price | $0.85 | same | same |
| Soft cost % | 22% of hard | 22% | Colorado construction cost survey Q4 2025 |
| Dev fee % | 15% of dev cost | 15% | Industry standard |
| Eligible basis % | 85% | 85% | Conservative LIHTC standard |
| Hard cost / unit (family) | $275K | $350K | CO construction cost survey Q4 2025 |
| Hard cost / unit (seniors) | $260K | $350K | same |
| Hard cost / unit (mixed-use) | $310K | $350K | same |
| Hard cost / unit (supportive) | $295K | $350K | same |
| Default soft funding | $500K | same | None (round number) |
| Operating expense / unit | $8,500/yr | not in JS | Industry standard |
| Permanent debt rate | 6.5% | not in JS | Q1 2026 commercial debt |
| Permanent debt amort | 35 yr | not in JS | Industry standard |
| DSCR target | 1.2 | not in JS | Lender standard |

### Geographic cost multipliers (from `_geoCostMultiplier`)

Hardcoded in [`lihtc-deal-predictor.js:155-178`](../../js/lihtc-deal-predictor.js):
- Range: ~0.65 (rural eastern plains) to ~1.55 (Pitkin / Aspen)
- Front Range base = 1.0
- Resort counties (Pitkin, Summit, Eagle, San Miguel, etc.) = 1.30-1.55
- Mountain counties (Lake, Gunnison, etc.) = 1.10-1.25
- Rural eastern plains = 0.65-0.85

So effective family hard cost ranges roughly: $179K (Baca County) → $426K (Pitkin County).

---

## 3. What's working

### 3.1 Externalized assumptions file

`data/policy/lihtc-assumptions.json` is the right architecture — assumptions are configurable without code changes. CHFA syndication market shifts annually; the file lets a non-developer update equity pricing without a PR.

### 3.2 Geographic cost calibration

The county-level cost multipliers are reasonably calibrated. Resort/rural spread of ~2.4x matches what's seen in actual CO LIHTC awards.

### 3.3 Concept-type differentiation

`_selectConceptType()` picks family / seniors / mixed-use / supportive based on county demographics. Each concept has its own hard-cost basis + unit mix + AMI mix. The differentiation is meaningful (supportive housing is more expensive per unit than family).

### 3.4 AMI × bedroom matrix (PR #890, just landed)

The recommender now outputs a proper 2D matrix (AMI tier × bedroom count) instead of two flat marginals. CHFA-preference skew baked in (3-BR concentrated at deepest AMI, studios at higher AMI). Per-concept skew tables.

### 3.5 IRC §42(d)(5)(B) basis boost handled correctly

Single 40-point bonus for QCT OR DDA (not stacked 30+20=50). One election per project. Documented inline in [`scoreSubsidy`](../../js/market-analysis/site-selection-score.js).

### 3.6 Honest disclaimers

The doc-block in [`lihtc-deal-predictor.js:78-82`](../../js/lihtc-deal-predictor.js) explicitly says: *"…does not constitute underwriting, legal, or investment advice. Always engage a qualified LIHTC syndicator and attorney before proceeding."*

---

## 4. What's broken or stale

### 4.1 🔴 Concept selection logic is opaque

[`_selectConceptType(inputs, rationale, risks)`](../../js/lihtc-deal-predictor.js) defaults to 'family' if no clearer signal. The rationale that's exposed to users (*"Family housing is the default concept type for this market profile"*) is literally just the fallback string. For a site that genuinely could be either family or seniors, the recommendation is uninformative.

**Fix:** Make the concept-selection criteria explicit (e.g., "Selected seniors because >25% of buffer population is 65+ AND median income <70% AMI"). The signals exist in the inputs; just need to be surfaced.

### 4.2 🔴 4% deal min-units threshold (100 units) is hardcoded

[`DEFAULT_ASSUMPTIONS.fourPctMinUnits: 100`](../../js/lihtc-deal-predictor.js#L101)

The recommender pushes any deal ≥100 units toward 4% bond execution. But 4% deals are getting done at smaller scales in CO (75+ units regularly) when paired with state credits. The 100-unit threshold may unnecessarily steer smaller deals away from 4%.

**Fix:** Either lower to 75 or make it a county-dependent threshold (resort markets can support smaller 4% deals because of higher rents; rural deals need more units for amortization economics).

### 4.3 🟡 Soft funding lookup is incomplete

`softFundingByGeography` in `lihtc-assumptions.json` covers some counties but not all 64. Missing counties fall back to `defaultSoftFunding: 500000` which is arbitrary.

**Fix:** Populate the JSON with realistic annual soft-funding budgets for the remaining counties, OR pull from a live CHFA data source.

### 4.4 🟡 Capital stack doesn't model perm debt sizing

`_computeCapitalStack()` computes:
- Total cost = hard + soft + dev fee
- Equity = annualCredit × 10 × equityPrice
- "First Mortgage" appears as a line but it's computed as `totalCost - equity - softFunding` (the gap), not as a DSCR-sized loan against actual rents.

**Fix:** Properly size perm debt via DSCR using projected NOI (rent revenue × occupancy − operating expense × unit count), then check feasibility (does that loan close the gap?). Current method silently produces unfundable deals when the gap exceeds what the rents can support.

### 4.5 🟡 Equity pricing is single-point

Defaults to $0.87 for 9% deals across all counties + market conditions. Real syndication pricing varies by:
- Project size (smaller deals price lower)
- Deal complexity (mixed-finance, scattered-site = lower price)
- Sponsor strength
- Quarterly market conditions

**Fix:** Either accept it as a screening simplification (and disclose) or build a range model (e.g., $0.80-$0.92 with sensitivity sliders).

### 4.6 🟡 Operating expense per unit ($8,500) is statewide flat

Real operating expenses scale by:
- Project size (economies of scale at 80+ units)
- Concept type (supportive housing has 2-3x the OpEx of family)
- Resort/rural location (utilities, insurance, snow removal)
- Age of building

**Fix:** OpEx-by-concept-type matrix similar to hard-cost matrix.

### 4.7 🟢 Hard cost vintage (Q4 2025) is acceptable but aging

Hard costs were calibrated Q4 2025 (six months ago at audit time). CO construction costs are still inflating ~4-6% annually. The numbers will be ~2-3% stale by Q3 2026.

**Fix:** Quarterly refresh of lihtc-assumptions.json from a published CO construction cost survey.

### 4.8 🔴 No actual project-vs-recommendation feedback loop

The recommender produces an output but there's no mechanism to track:
- Was a recommendation accurate?
- Did the recommended deal type actually get awarded?
- Did the AMI mix match what got built?

Without this loop, weights can't be calibrated.

**Fix (longer-term):** Match recommendations against the CHFA LIHTC database (already loaded as `chfa-lihtc.json` / `hud_lihtc_co.geojson`). For each historical project, compute what the recommender WOULD have suggested and compare to what actually got built.

---

## 5. Specific issues from the user's recent observations

### 5.1 "Why this fits" rationale was thin

User screenshot showed:
```
Why This Fits
- Larger scale (100 units) can support 4% bond-financed execution
- Soft funding availability ($500K) supports 4% capital stack
- Family housing is the default concept type for this market profile
```

The third bullet is the bare default. Improvement: surface actual demographic signals (age distribution, income, household size) that informed the family-vs-seniors call.

### 5.2 AMI × unit-type cross-tab — fixed by PR #890

User noted CHFA wants AMI spread across unit types. PR #890 (just landed) outputs the 2D matrix.

### 5.3 "Low confidence" badge — what drives it?

`_computeConfidence(inputs)` uses an arbitrary points system. A site with minimal user-input data scores "Low confidence." Users can't tell what they'd need to input to raise it.

**Fix:** Surface "Missing inputs" alongside confidence — e.g., *"Low confidence — improves to Moderate if you specify proposed unit count + concept type."*

---

## 6. Recommendations (prioritized)

### Must-fix before formal use

1. **Properly size perm debt via DSCR** — current "first mortgage" is a plug number, not an underwriting figure
2. **Surface concept-selection rationale** with real signals — eliminate the "default" string
3. **Soft funding gaps** — fill in remaining counties OR show "N/A — not yet calibrated" instead of a fake $500K

### Should-fix soon

4. Lower 4% min-units to 75 or make it county-dependent
5. OpEx-by-concept-type matrix
6. Equity pricing range with sensitivity
7. Confidence badge — surface what's missing

### Nice-to-have

8. Quarterly refresh process for `lihtc-assumptions.json`
9. Project-vs-recommendation back-test against CHFA LIHTC database
10. Cap-rate-by-county model (currently no cap rate concept at all)

---

## 7. Key file map

| File | Role |
|---|---|
| [`js/lihtc-deal-predictor.js`](../../js/lihtc-deal-predictor.js) | Main recommender — concept type, execution, unit/AMI mix, capital stack |
| [`js/deal-calculator.js`](../../js/deal-calculator.js) | Interactive pro-forma calculator (deal-calculator.html) |
| [`js/pro-forma.js`](../../js/pro-forma.js) | Multi-scenario sensitivity (HNA Scenario Builder) |
| [`data/policy/lihtc-assumptions.json`](../../data/policy/lihtc-assumptions.json) | External assumptions file (version 2026-Q1) |
| [`test/lihtc-deal-predictor.test.js`](../../test/lihtc-deal-predictor.test.js) | Existing unit tests |

---

## 8. Recent session changes (referenced PRs)

- **#890** — AMI × bedroom matrix replaces two flat distributions in concept recommender (fixed the user's "two flat lists" question)
- **#885** — Housing Needs Scorecard v2 (peer-normalised, includes owner cost burden) — feeds the recommender's `inputs.affordabilityGap`

Recommender outputs `suggestedMatrix` field as of PR #890. Backward-compat: `suggestedUnitMix` and `suggestedAMIMix` remain in the API.
