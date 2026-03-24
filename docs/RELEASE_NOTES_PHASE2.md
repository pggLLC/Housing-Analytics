# Release Notes — Phase 2: PMA Concept Card & ACS Cache Fix

**Release date:** March 2026  
**Branch:** `copilot/fix-no-acs-data-error`  
**Affects:** `market-analysis.html` and all supporting JS modules

---

## Overview

Phase 2 delivers three improvements to the Primary Market Analysis (PMA) tool
on [`market-analysis.html`](../market-analysis.html):

| # | What was fixed/added |
|---|---------------------|
| 1 | **ACS cache persistence** — second and subsequent map clicks no longer fail with "No ACS data isn't available" |
| 2 | **Full-featured concept card** — replaces the one-line stub with a complete recommendation card showing unit mix, AMI mix, capital stack, risks, and caveats |
| 3 | **Housing Needs Fit section** — the concept card now shows how the recommended project aligns with local HNA (AMI tier coverage %, alignment rating, gaps) |

---

## 1. ACS Cache Persistence (`js/market-analysis-cache-fix.js`)

### Problem
On the second map click, `runAnalysis()` checked the module-level `acsMetrics`
variable (set once during page load) but could encounter stale or empty data
from a previous analysis run, producing the error:

> "ACS data isn't available: ACS tract metrics file is missing or empty."

### Fix
A new module `window.PMADataCache` stores the ACS tract metrics and centroid
data globally after the **first** successful load:

```js
// After loadData() succeeds:
window.PMADataCache.set('acsMetrics',      acsMetrics);
window.PMADataCache.set('tractCentroids',  tractData);
```

At the **start of every `runAnalysis()` call**, the engine checks the cache and
restores the data if the module variable is empty:

```js
if ((!acsMetrics || !acsMetrics.tracts.length) && cache.has('acsMetrics')) {
  acsMetrics = cache.get('acsMetrics');   // cache HIT — restored from global store
}
```

This ensures the second and all subsequent map clicks work identically to the first.

### How to verify

Open DevTools → Console and click the map twice. You should see:

```
[market-analysis] loadData(): complete — centroids=1236, acs=1417, lihtc=716
[PMADataCache] cached "acsMetrics"
[PMADataCache] cached "tractCentroids"
... (second click) ...
[PMADataCache] cache HIT "tractCentroids" (hits=1)
[PMADataCache] cache HIT "acsMetrics" (hits=1)
[market-analysis] runAnalysis(): restored acsMetrics from PMADataCache
```

---

## 2. Full Concept Card (`js/lihtc-concept-card-renderer.js`)

### Problem
In buffer mode (map click), the concept card only showed a one-line summary
because the code checked for `window.PMAUIController._drawCard` — a function
that was never publicly exposed. The full card was only shown in
commuting/hybrid modes.

### Fix
A dedicated `window.LIHTCConceptCardRenderer.render(container, rec, hnsFit)`
function now handles all modes (buffer, commuting, hybrid). The renderer:

- Injects scoped CSS once on first call
- Renders all Phase 2 outputs: confidence badge, execution (4%/9%), concept type, unit count, unit mix table, AMI mix table, rationale bullets, risk flags, alternative path, collapsible capital stack, caveats warning box
- Adds the Housing Needs Fit section when `hnsFit` is provided
- Wires the Export JSON button to download both the recommendation and HNA fit

### Concept card structure

```
🟡 Recommended: 9% Family Housing  (60 units)  medium confidence
───────────────────────────────────────────────────────────────
Why This Fits
  • High cost burden rate (48%) signals strong affordability demand
  • Low vacancy (2.1%) supports market absorption
  • QCT designation provides 30% eligible basis boost

Unit Mix          AMI Mix           Capital Stack (indicative)
  Studio:   5     30% AMI: 20%        Total Dev Cost:  $18.0M
  1-BR:    20     50% AMI: 40%        LIHTC Equity:     $9.0M
  2-BR:    25     60% AMI: 40%        1st Mortgage:     $5.0M
  3-BR:    10                         Local Soft:        $2.0M
                                       Deferred Dev Fee:  $1.0M

▼ Indicative Capital Stack  [collapsed by default]

⚠ Key Risks
  • Competitive QAP environment — apply early and thoroughly

Alternative path: Consider 4% if more than 100 units

🏘 Housing Needs Fit — Denver County             [see section 3]

⚠ Important: This is a planning-level estimate only. ...

[Export Concept JSON]
```

---

## 3. Housing Needs Fit Section (`js/market-analysis/housing-needs-fit-analyzer.js`)

### Purpose
Shows how the recommended LIHTC concept addresses the specific county or
municipal housing need recorded in HNA data, answering:

- Which AMI priority segments does this project target?
- What % of the identified unmet need does it cover at each tier?
- Is the alignment strong, partial, or weak?
- Which tiers remain unaddressed?

### Algorithm

Given proposed units by AMI tier and the HNA affordability gap:

```
coverage_30% = min(100, round(units_30% / need_30% × 100))
coverage_50% = min(100, round(units_50% / need_50% × 100))
coverage_60% = min(100, round(units_60% / need_60% × 100))

alignment = "strong"  if avg(coverage_*) ≥ 50
          = "partial" if avg(coverage_*) ≥ 15
          = "weak"    otherwise
```

40% AMI units are split 50/50 between the 30% and 50% tiers for coverage
calculation.

### Card section appearance

```
🏘 Housing Needs Fit — Denver County
Alignment: 🟡 Partial · Need coverage: 14%

30% AMI — 4% coverage  [▓░░░░░░░░░░░░░░░░░░░]
50% AMI — 21% coverage [▓▓▓▓░░░░░░░░░░░░░░░░]

• 12 units at 30% AMI address the significant deep-affordability gap (≈4% of identified need)
• 24 units at 50% AMI target the workforce housing gap (≈21% of need)
• Partial alignment — consider deepening affordability to close remaining gaps

Un-addressed gaps: 308 units needed at 30% AMI — deep-affordability gap remains after this project
```

---

## New & Modified Files Summary

| File | Change |
|------|--------|
| `js/market-analysis-cache-fix.js` | **New** — `window.PMADataCache` singleton |
| `js/lihtc-concept-card-renderer.js` | **New** — `window.LIHTCConceptCardRenderer` full card |
| `js/market-analysis/housing-needs-fit-analyzer.js` | **New** — `window.HousingNeedsFitAnalyzer` |
| `test/test_housing_needs_fit_analyzer.js` | **New** — 55 unit tests |
| `js/market-analysis.js` | **Modified** — cache save/restore, full renderer call |
| `js/pma-ui-controller.js` | **Modified** — HNA fit + full renderer call |
| `market-analysis.html` | **Modified** — 3 new `<script defer>` tags |
| `test/smoke-market-analysis.js` | **Modified** — 28 new smoke checks (section 21) |
| `README.md` | **Modified** — Phase 2 section added |
| `CHANGELOG.md` | **Modified** — This release entry |

---

## Testing

```bash
# Unit tests
node test/test_lihtc_deal_predictor.js       # 68 passed
node test/test_hna_market_bridge.js          # 68 passed
node test/test_housing_needs_fit_analyzer.js # 55 passed

# Smoke tests (covers all 21 sections including Phase 2)
node test/smoke-market-analysis.js           # 185 passed

# Full CI suite
npm run test:ci                              # all checks passed
```

---

## Backward Compatibility

All changes are fully backward-compatible:

- Buffer mode continues to work when `HousingNeedsFitAnalyzer` or `HNAMarketBridge` are unavailable (HNA section is simply omitted from the card)
- Enhanced modes (commuting/hybrid) continue to work unchanged
- The fallback inline renderer in `pma-ui-controller.js` is preserved for cases where `LIHTCConceptCardRenderer` is not loaded
- The `PMADataCache` is purely additive; removing it would have no effect on the core data pipeline

---

## Customisation

### Policy assumptions
Edit `data/policy/lihtc-assumptions.json` to change financing assumptions,
per-unit development costs, or LTV ratios used in the capital stack estimate.

### Decision rules (4% vs 9%)
Edit the scoring branches in `js/lihtc-deal-predictor.js`. The key decision
gates are documented with inline comments at lines 80–180.

### AMI tier weights for alignment score
Edit the `_cov()` calls and the `alignScore` threshold values in
`js/market-analysis/housing-needs-fit-analyzer.js` (lines 105–115).

---

## Questions

- **How does the 4% vs 9% decision work?** → See `docs/LIHTC_DEAL_PREDICTOR.md`
- **How is the site suitability score calculated?** → See `docs/SITE_SELECTION_SCORING.md`
- **How do I add a new AMI tier?** → Update `suggestedAMIMix` in the predictor and the coverage calculation in the analyzer
- **Why is confidence 'low'?** → Missing PMA score, QCT/DDA status, or HNA data reduces confidence; see `predictConcept()` in the predictor
