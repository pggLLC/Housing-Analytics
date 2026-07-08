# Pass A — Calculations And Lineage Audit

Audit date: 2026-07-07  
Scope: audit only; no code or data changed. Browser rendering was not run, so visual/mobile/blank-state checks are `UNRENDERED` and limited to source inspection.

## Gate Evidence

| Gate | Result | Evidence |
|---|---:|---|
| `npm run test:hna-benchmarks` | PASS | Benchmark harness completed and printed calibration ratios for La Plata, Pueblo County/City, Milliken, Alamosa, and Erie. Ratios are explicitly calibration signals, not pass/fail gates. |
| `npm run check:dola-vintage` | PASS with warnings | Official SDO forecast detected as Vintage 2023, Prepared October 2024. 64 counties compared; median diff -1.4%; 12 counties beyond +/-5% warning threshold. |
| `npm run test:hna` | PASS | 730 passed, 0 failed. |
| `npm run validate:data` | PASS | Critical data, numeric bounds, and county AMI distinct-value checks passed. |
| `node scripts/validate-schemas.js` | PASS | 85 passed, 0 failed. |
| `node test/hna-dp04-codes.test.js` | PASS | 27 passed, 0 failed. |
| `node test/acs-etl.test.js` | PASS | 167 passed, 0 failed. |

Known pre-existing failures from the work order were not rerun as blockers: `python3 scripts/qa_stage1.py`, the `pytest` place CHAS `acs_anchor` schema failure, and `node test/integration/housing-needs-assessment.test.js` six failures against the compatibility-stub era.

## A0 Cross-Surface Sweep

| Surface | Primary source paths inspected | Lineage status | Notes |
|---|---|---|---|
| HNA live page | `housing-needs-assessment.html`, `js/hna/*`, `data/hna/summary/*`, `data/hna/home-value-cascade.json` | Mixed | Most HNA metrics are now modularized and tested, but median home value still has two live render paths with different source selection and vintage labels. |
| Generated place pages | `places/_template.html`, `places/*.html`, `scripts/hna/build_place_pages.py` | Mostly aligned | Affordable Ownership is no longer absent in current main, so absence was not audited. Source inspection only; real page rendering is `UNRENDERED`. |
| Jurisdiction metrics digest | `scripts/hna/build_jurisdiction_metrics_digest.mjs`, `data/hna/jurisdiction-metrics-digest/*.json` | Mostly aligned | Prior county/place ownership labeling issue appears fixed in current main. No forbidden digest freshness command was run. |
| Compare page | `compare.html`, `js/compare.js` | Partial risk | Preservation counts use `preservation-candidate` as a substantive market signal even though the tag is source-membership based. |
| PMA / market analysis | `market-analysis.html`, `js/pma-*`, `js/market-analysis*`, `docs/guides/pma-analysis.md` | Improved but still screening-level | Capture/absorption language is surfaced; circular-buffer and screening disclaimers are present. |
| Deal calculator | `deal-calculator.html`, `js/deal-calculator.js`, `js/lihtc-deal-predictor.js` | Improved | Full calculator has DSCR/first-mortgage sizing. The lightweight deal predictor still says its capital stack is placeholder and not permanent-debt underwriting. |
| Opportunity Finder | `lihtc-opportunity-finder.html`, `js/lihtc-opportunity-finder.js`, `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md`, `scripts/audit/verify-opportunity-finder.mjs` | Drift in audit harness | Production 4% weights and methodology agree; the verification harness hard-codes old 4% weights. |
| Preservation / affordable housing layer | `preservation.html`, `js/components/affordable-housing-layer.js`, `scripts/build-affordable-housing-properties.js`, `data/affordable-housing/properties.json` | Label mismatch | `preservation-candidate` is applied from source membership, then explained in UI as at-risk/expiring. |
| Tier 3 dashboards | `LIHTC-dashboard.html`, `chfa-portfolio.html`, `compliance-dashboard.html`, `construction-commodities.html`, `economic-dashboard.html` | Generally bounded | Diagnostics and source links are present in source. Runtime visual/blank behavior is `UNRENDERED`. |

## Findings

| ID | Severity | Class | Finding | Evidence | Recommendation |
|---|---:|---|---|---|---|
| A-01 | P0 | A: multiple data paths | HNA median home value can contradict itself on the same page. The stat card prefers `profile.median_home_value` cascade, including ZHVI and county-adjusted estimates, then falls back to `DP04_0089E`; the narrative reads raw `DP04_0089E` directly and hardcodes `(ACS 2020–2024)`. | `js/hna/hna-renderers.js:14-40`, `js/hna/hna-renderers.js:384-397`; `js/hna/hna-narratives.js:64-72`, `js/hna/hna-narratives.js:407-426`. | Centralize the display home-value object and source/vintage formatter. The narrative should consume the same `{value, source, as_of, confidence, suppress_*}` structure as the stat card. Add a cross-surface assertion for equality and label agreement. |
| A-02 | P0 | B: analytical label mirrors source membership | `preservation-candidate` is not a risk classification. The build marks CHFA Preservation, HUD MF Assisted, USDA RD, and local PBV records as `preservation-candidate`; 1,822 of 1,920 property records carry the tag, but only 109 have `years_to_expiration`. The map legend describes it as “Property at risk of losing affordability restrictions.” | `scripts/build-affordable-housing-properties.js:137-158`, `:171-192`, `:208-230`; count command over `data/affordable-housing/properties.json`; `js/components/affordable-housing-layer.js:124-128`. | Rename the broad tag to a source-membership label such as `subsidized-inventory` or add a separate true-risk flag based on expiration, troubled/compliance status, covenant age, or owner-reviewed risk rules. |
| A-03 | P1 | QA drift | Opportunity Finder’s production 4% weights were rebalanced to `{need:.30, recency:.17, basis:.15, pop:.20, civic:.18}`, and the methodology text says the same. The verifier says weights “must match” source exactly but still hard-codes old 4% weights `{need:.25, recency:.12, basis:.15, pop:.30, civic:.18}`. | `js/lihtc-opportunity-finder.js:297-311`; `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md:261-266`; `scripts/audit/verify-opportunity-finder.mjs:54-66`. | Make the verifier import/extract production weights or regenerate its expectation from a shared JSON/module. This is a guardrail bug: it can validate the wrong model while the app and docs agree. |
| A-04 | P1 | Methodology wording | Preservation candidate counts appear in multiple downstream contexts as market opportunity/at-risk inventory, but current data only guarantees membership in CHFA/HUD/USDA/PBV feeds. | `js/components/affordable-housing-layer.js:124-128`; `js/compare.js:720-722`; `js/market-analysis/market-report-renderers.js:244-264`. | Until A-02 is fixed, downstream copy should say “tracked subsidized/preservation-source inventory” and reserve “at risk” for records with an actual risk signal. |
| A-05 | P2 | Screen vs pro forma boundary | `js/lihtc-deal-predictor.js` is honest in comments that it does not model permanent debt underwriting and produces placeholder sources/uses; however it is still invoked inside the deal workflow, where the fuller calculator now contains DSCR and supportable first mortgage panels. | `js/lihtc-deal-predictor.js:14`, `:584-604`; `js/deal-calculator.js:1370-1418`, `:2389-2401`; `docs/guides/deal-predictor.md:16`, `:104`. | Keep the lightweight predictor as “concept screening.” Do not let its placeholder capital stack be described as underwriting. Longer term, either route users to the full calculator for finance outputs or share the calculator’s debt-sizing primitives. |
| A-06 | P2 | Vintage warning | DOLA vintage check reports 12 counties beyond +/-5% against official 2030 forecast even though median drift is small. This is not a failure, but it deserves visible owner review because Broomfield (-11.7%), Custer (-10.8%), and San Juan (+15.4%) are large relative deltas. | `npm run check:dola-vintage` output, 2026-07-07. | Add the warning table to the next data-refresh QA note; decide whether deltas are expected from the repo’s projection method or require updated population inputs. |
| A-07 | P2 | Hardcoded vintage | HNA page markup and narrative include several static `ACS 2020–2024` labels. Many are acceptable for chart boxes, but the narrative hardcoding is dangerous when the value path may be ZHVI/current-market or county-adjusted. | `housing-needs-assessment.html:673-738`, `:975-1018`; `js/hna/hna-narratives.js:421`. | For values that can come from the cascade, use the source object’s `as_of`. Static chart-box vintages are acceptable when tied to ACS-only charts. |
| A-08 | P2 | PMA method boundary | PMA source text now explicitly says screening-only and circular-buffer. That resolves older methodology overclaim risk, but runtime render and mobile behavior are `UNRENDERED` in this audit. | `market-analysis.html:148-163`, `:263-292`; `docs/guides/pma-analysis.md:3-20`, `:108-109`. | Preserve the disclaimer as a first-viewport or near-control affordance during future redesigns. |
| A-09 | P2 | HNA benchmarks | Benchmarks pass but show large calibration deltas for some consultant comparisons, e.g. Pueblo County total need 1,691 vs 9,561 (0.18 ratio) and La Plata <=30% AMI gap 1,328 vs 651 (2.04 ratio). | `npm run test:hna-benchmarks` output, 2026-07-07. | Treat benchmark ratios as a recurring calibration dashboard, not a failing test. Add owner notes where methodology intentionally differs. |
| A-10 | P3 | Rendering not validated | Tier 3 pages and generated place pages were inspected by source only. Blank states, mobile layout, chart drawing, and console behavior are `UNRENDERED`. | Work order allowed no browser requirement; no Playwright/browser run performed. | Schedule a follow-up rendered smoke pass after this audit PR if visual confidence is needed. |

## Stale Audit Reconciliation

| Prior audit item | Current disposition |
|---|---|
| Deal calculator lacked DSCR / first mortgage support | Mostly addressed in `js/deal-calculator.js`; lightweight predictor still intentionally screening-only. |
| Opportunity Finder civic/weight methodology drift | Production and methodology mostly aligned, but verifier drift remains (A-03). |
| PMA capture/absorption absent | Absorption/capture is now rendered in `js/pma-ui-controller.js:523-551`; keep as screening, not formal PMA. |
| Preservation candidates overclaimed | Still current and elevated to P0 due cross-surface impact. |
| HNA source/vintage drift | Current P0 for home value narrative/stat contradiction. |
