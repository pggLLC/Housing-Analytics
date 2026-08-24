# Test coverage report

_Auto-generated 2026-08-24 by `scripts/generate-test-coverage.mjs` (weekly via `docs-sync.yml`)._

This is an **assertion-count** report, not line-coverage. Pattern-matched counts of `assert()`, `assert.X()`, `expect()`, `self.assert*()`, and bare pytest `assert` statements. Deliberate choice — a c8/nyc lift comes later once the test density justifies the instrumentation cost (see #655).

## Summary

| Runtime | Test files | Assertions |
|---|---:|---:|
| JavaScript (`test/`) | 198 | 6214 |
| Python (`tests/`)   | 24 | 568 |
| **Total** | **222** | **6782** |

## JavaScript — per file

| File | Target module | Lines | Assertions |
|---|---|---:|---:|
| `test/integration/housing-needs-assessment.test.js` | `housing-needs-assessment` | 662 | 203 |
| `test/combined-geo.test.js` | `combined-geo` | 877 | 188 |
| `test/acs-etl.test.js` | `acs-etl` | 522 | 136 |
| `test/pma-scoring.test.js` | `pma-scoring` | 706 | 135 |
| `test/integration/analytics.test.js` | `analytics` | 334 | 111 |
| `test/integration/compliance-dashboard.test.js` | `compliance-dashboard` | 249 | 108 |
| `test/jurisdiction-metrics-digest.test.js` | `jurisdiction-metrics-digest` | 527 | 103 |
| `test/compliance-checklist.test.js` | `compliance-checklist` | 537 | 102 |
| `test/ownership-finance.test.js` | `ownership-finance` | 468 | 100 |
| `test/prop123-historical.test.js` | `prop123-historical` | 402 | 96 |
| `test/unit/site-selection-score.test.js` | `site-selection-score` | 629 | 94 |
| `test/analytics.test.js` | `analytics` | 401 | 84 |
| `test/integration/economic-indicators.test.js` | `economic-indicators` | 225 | 83 |
| `test/integration/projections.test.js` | `projections` | 363 | 82 |
| `test/hna-ownership-need.test.js` | `hna-ownership-need` | 503 | 80 |
| `test/chfa-pma-checklist.test.js` | `chfa-pma-checklist` | 421 | 78 |
| `test/market-study-page.test.js` | `market-study-page` | 241 | 70 |
| `test/preservation.test.js` | `preservation` | 416 | 70 |
| `test/shared-equity-lifecycle.test.js` | `shared-equity-lifecycle` | 472 | 70 |
| `test/hna-ownership-strategy.test.js` | `hna-ownership-strategy` | 161 | 68 |
| `test/prop123.test.js` | `prop123` | 331 | 67 |
| `test/ownership-resale.test.js` | `ownership-resale` | 240 | 64 |
| `test/deal-calc-for-sale-feasibility.test.js` | `deal-calc-for-sale-feasibility` | 243 | 59 |
| `test/travel-time-matrix.test.js` | `travel-time-matrix` | 106 | 59 |
| `test/hna-home-value-cascade.test.js` | `hna-home-value-cascade` | 182 | 56 |
| `test/redfin-place-market-tracker.test.js` | `redfin-place-market-tracker` | 85 | 56 |
| `test/unit/pma-employment-centers.test.js` | `pma-employment-centers` | 331 | 56 |
| `test/acs-integration.test.js` | `acs-integration` | 421 | 54 |
| `test/hna-ranking-index.test.js` | `hna-ranking-index` | 600 | 54 |
| `test/unit/scenario-storage.test.js` | `scenario-storage` | 292 | 54 |
| `test/forsale-capture.test.js` | `forsale-capture` | 187 | 52 |
| `test/soft-funding-tracker.test.js` | `soft-funding-tracker` | 445 | 52 |
| `test/developable-land-context.test.js` | `developable-land-context` | 95 | 51 |
| `test/integration/hna-ranking.test.js` | `hna-ranking` | 281 | 51 |
| `test/fhfa-hpi-subcounty.test.js` | `fhfa-hpi-subcounty` | 125 | 49 |
| `test/unit/pma-competitive-set.test.js` | `pma-competitive-set` | 188 | 49 |
| `test/lihtc-deal-predictor.test.js` | `lihtc-deal-predictor` | 323 | 46 |
| `test/query-builder.test.js` | `query-builder` | 338 | 46 |
| `test/project-scenario.test.js` | `project-scenario` | 125 | 45 |
| `test/market-study-report.test.js` | `market-study-report` | 145 | 44 |
| `test/pma-confidence.test.js` | `pma-confidence` | 189 | 44 |
| `test/resale-waterfall.test.js` | `resale-waterfall` | 238 | 44 |
| `test/colorado-equity-pricing-factors.test.js` | `colorado-equity-pricing-factors` | 147 | 42 |
| `test/lodes-tract-od.test.js` | `lodes-tract-od` | 86 | 42 |
| `test/pma-commute-shaped.test.js` | `pma-commute-shaped` | 142 | 42 |
| `test/hna-projection-integrity.test.js` | `hna-projection-integrity` | 265 | 41 |
| `test/ownership-funding-schema.test.js` | `ownership-funding-schema` | 82 | 41 |
| `test/smoke.test.js` | `smoke` | 247 | 40 |
| `test/data-scope.test.js` | `data-scope` | 131 | 39 |
| `test/unit/pma-justification.test.js` | `pma-justification` | 133 | 39 |
| `test/unit/cohort-component-model.test.js` | `cohort-component-model` | 307 | 38 |
| `test/pma-competitive-set.test.js` | `pma-competitive-set` | 342 | 37 |
| `test/deal-calc-equity-pricing.test.js` | `deal-calc-equity-pricing` | 124 | 36 |
| `test/unit/fema-flood.test.js` | `fema-flood` | 374 | 36 |
| `test/hna-prop123-relationship.test.js` | `hna-prop123-relationship` | 110 | 35 |
| `test/phase3-comparison-ideas.test.js` | `phase3-comparison-ideas` | 129 | 35 |
| `test/pma-transit.test.js` | `pma-transit` | 311 | 35 |
| `test/canonical-geography-contract.test.js` | `canonical-geography-contract` | 135 | 34 |
| `test/co-lihtc-map.test.js` | `co-lihtc-map` | 177 | 34 |
| `test/funding-context-card.test.js` | `funding-context-card` | 141 | 34 |
| `test/land-disposition.test.js` | `land-disposition` | 165 | 34 |
| `test/hna-phase2-stubs-wired.test.js` | `hna-phase2-stubs-wired` | 136 | 33 |
| `test/pma-barrier-aware.test.js` | `pma-barrier-aware` | 192 | 33 |
| `test/place-chas-lookup.test.js` | `place-chas-lookup` | 153 | 32 |
| `test/pma-tract-display.test.js` | `pma-tract-display` | 196 | 32 |
| `test/tool-watch.test.js` | `tool-watch` | 90 | 32 |
| `test/workflow-state-set-jurisdiction.test.js` | `workflow-state-set-jurisdiction` | 225 | 32 |
| `test/homeownership-programs.test.js` | `homeownership-programs` | 138 | 31 |
| `test/dc-constants.test.js` | `dc-constants` | 156 | 30 |
| `test/dc-peer-deals.test.js` | `dc-peer-deals` | 189 | 30 |
| `test/hmda-lookup.test.js` | `hmda-lookup` | 148 | 30 |
| `test/tax-credit-equity-markets.test.js` | `tax-credit-equity-markets` | 145 | 30 |
| `test/co-historical-allocations.test.js` | `co-historical-allocations` | 256 | 29 |
| `test/dc-rent-achievability.test.js` | `dc-rent-achievability` | 146 | 29 |
| `test/hna-surplus-semantics.test.js` | `hna-surplus-semantics` | 297 | 29 |
| `test/place-pages.test.js` | `place-pages` | 140 | 29 |
| `test/pma-barrier-data.test.js` | `pma-barrier-data` | 126 | 29 |
| `test/unit/pma-commuting.test.js` | `pma-commuting` | 106 | 29 |
| `test/data-freshness-v2.test.js` | `data-freshness-v2` | 114 | 28 |
| `test/hna-dp04-codes.test.js` | `hna-dp04-codes` | 147 | 28 |
| `test/opportunity-zones-data.test.js` | `opportunity-zones-data` | 64 | 28 |
| `test/qap-simulator.test.js` | `qap-simulator` | 205 | 28 |
| `test/unit/pma-infrastructure.test.js` | `pma-infrastructure` | 106 | 28 |
| `test/hmda-trend-and-chas-badge.test.js` | `hmda-trend-and-chas-badge` | 110 | 27 |
| `test/hna-chas-vintage-disclosure.test.js` | `hna-chas-vintage-disclosure` | 95 | 27 |
| `test/hna-scope-badges.test.js` | `hna-scope-badges` | 137 | 27 |
| `test/public-facing-numbers.test.js` | `public-facing-numbers` | 124 | 27 |
| `test/stewardship-providers.test.js` | `stewardship-providers` | 63 | 27 |
| `test/pma-commute-context.test.js` | `pma-commute-context` | 126 | 26 |
| `test/website-monitor.test.js` | `website-monitor` | 187 | 26 |
| `test/energy-retrofit-funding.test.js` | `energy-retrofit-funding` | 123 | 25 |
| `test/hud-zip-tract-crosswalk.test.js` | `hud-zip-tract-crosswalk` | 75 | 25 |
| `test/tax-credit-insights-data.test.js` | `tax-credit-insights-data` | 92 | 25 |
| `test/unit/pma-opportunities.test.js` | `pma-opportunities` | 113 | 25 |
| `test/deal-tracker-wording.test.js` | `deal-tracker-wording` | 219 | 24 |
| `test/hna-deep-dive-batch2.test.js` | `hna-deep-dive-batch2` | 132 | 24 |
| `test/pma-methodology-language.test.js` | `pma-methodology-language` | 84 | 24 |
| `test/pro-forma.test.js` | `pro-forma` | 205 | 24 |
| `test/site-review-build-pause-regressions.test.js` | `site-review-build-pause-regressions` | 235 | 24 |
| `test/unit/pma-barriers.test.js` | `pma-barriers` | 89 | 24 |
| `test/unit/pma-schools.test.js` | `pma-schools` | 91 | 24 |
| `test/dc-dscr-stress.test.js` | `dc-dscr-stress` | 162 | 23 |
| `test/deal-calc-correctness.test.js` | `deal-calc-correctness` | 45 | 23 |
| `test/effective-demand.test.js` | `effective-demand` | 122 | 23 |
| `test/hna-provenance-disclosure.test.js` | `hna-provenance-disclosure` | 109 | 23 |
| `test/metric-truth-crosssurface.test.js` | `metric-truth-crosssurface` | 158 | 23 |
| `test/a11y-contrast-labels.test.js` | `a11y-contrast-labels` | 57 | 22 |
| `test/unit/pma-transit.test.js` | `pma-transit` | 91 | 22 |
| `test/caching.test.js` | `caching` | 221 | 21 |
| `test/home-jurisdiction-search.test.js` | `home-jurisdiction-search` | 113 | 21 |
| `test/buyer-assistance-programs.test.js` | `buyer-assistance-programs` | 47 | 20 |
| `test/chas-tier-shares.test.js` | `chas-tier-shares` | 119 | 20 |
| `test/cross-county-disclosure.test.js` | `cross-county-disclosure` | 135 | 20 |
| `test/data-trust-center.test.js` | `data-trust-center` | 113 | 20 |
| `test/foreclosure-performance.test.js` | `foreclosure-performance` | 111 | 20 |
| `test/integration/market-analysis.test.js` | `market-analysis` | 130 | 20 |
| `test/ownership-decision-chain.test.js` | `ownership-decision-chain` | 130 | 20 |
| `test/policy-briefs-curated.test.js` | `policy-briefs-curated` | 62 | 20 |
| `test/ranking-scenarios.test.js` | `ranking-scenarios` | 75 | 20 |
| `test/scenario-presets-shared.test.js` | `scenario-presets-shared` | 136 | 20 |
| `test/county-from-coords.test.js` | `county-from-coords` | 148 | 19 |
| `test/deal-calc-ami-bands.test.js` | `deal-calc-ami-bands` | 147 | 19 |
| `test/hna-scenario-builder-saved.test.js` | `hna-scenario-builder-saved` | 202 | 19 |
| `test/homepage-job-routing.test.js` | `homepage-job-routing` | 102 | 19 |
| `test/orphan-nav-cleanup.test.js` | `orphan-nav-cleanup` | 79 | 19 |
| `test/data-trust-center-badges.test.js` | `data-trust-center-badges` | 93 | 18 |
| `test/fetch-error-surface.test.js` | `fetch-error-surface` | 121 | 18 |
| `test/f116-r1-matching.test.js` | `f116-r1-matching` | 146 | 17 |
| `test/hna-orphan-charts-wired.test.js` | `hna-orphan-charts-wired` | 130 | 17 |
| `test/hna-profile-fetch-batches.test.js` | `hna-profile-fetch-batches` | 128 | 17 |
| `test/mobile-overflow-containment.test.js` | `mobile-overflow-containment` | 42 | 17 |
| `test/pipeline-guards-a2.test.js` | `pipeline-guards-a2` | 132 | 17 |
| `test/policy-data-currency.test.js` | `policy-data-currency` | 48 | 17 |
| `test/semantic-label-guard.test.js` | `semantic-label-guard` | 102 | 17 |
| `test/data-quality-check.test.js` | `data-quality-check` | 215 | 16 |
| `test/hna-deep-dive-batch1.test.js` | `hna-deep-dive-batch1` | 107 | 16 |
| `test/place-lehd-apportionment.test.js` | `place-lehd-apportionment` | 94 | 16 |
| `test/unit-mix-validation.test.js` | `unit-mix-validation` | 121 | 16 |
| `test/affordable-housing-preservation-risk.test.js` | `affordable-housing-preservation-risk` | 39 | 15 |
| `test/hna-jurisdiction-normalization.test.js` | `hna-jurisdiction-normalization` | 162 | 15 |
| `test/map-pane-order.test.js` | `map-pane-order` | 59 | 15 |
| `test/place-chas-coverage-panel.test.js` | `place-chas-coverage-panel` | 83 | 15 |
| `test/augment-local-resources-nondestructive.test.js` | `augment-local-resources-nondestructive` | 172 | 14 |
| `test/file-manifest.test.js` | `file-manifest` | 96 | 14 |
| `test/lihtc-guide-accuracy.test.js` | `lihtc-guide-accuracy` | 48 | 14 |
| `test/pma-map-integrity.test.js` | `pma-map-integrity` | 36 | 14 |
| `test/tigerweb-timeout.test.js` | `tigerweb-timeout` | 156 | 14 |
| `test/hna-comparison-place-cost-burden.test.js` | `hna-comparison-place-cost-burden` | 81 | 13 |
| `test/hna-sub-county-and-sync.test.js` | `hna-sub-county-and-sync` | 85 | 13 |
| `test/data-map-coverage.test.js` | `data-map-coverage` | 89 | 12 |
| `test/deal-calc-workflow-prefill.test.js` | `deal-calc-workflow-prefill` | 117 | 12 |
| `test/hna-county-scope-disclosures.test.js` | `hna-county-scope-disclosures` | 97 | 12 |
| `test/polymarket-resolved.test.js` | `polymarket-resolved` | 71 | 12 |
| `test/census-dashboard-scope.test.js` | `census-dashboard-scope` | 54 | 11 |
| `test/deal-calc-screening-apply.test.js` | `deal-calc-screening-apply` | 92 | 11 |
| `test/homepage-claims.test.js` | `homepage-claims` | 80 | 11 |
| `test/pages-deploy-watchdog.test.js` | `pages-deploy-watchdog` | 101 | 11 |
| `test/pma-small-area-confidence.test.js` | `pma-small-area-confidence` | 42 | 11 |
| `test/fred-commodities-config.test.js` | `fred-commodities-config` | 61 | 10 |
| `test/hna-car-loader.test.js` | `hna-car-loader` | 132 | 10 |
| `test/hna-labor-market-renderers.test.js` | `hna-labor-market-renderers` | 95 | 10 |
| `test/lihtc-opportunity-finder-zori-capture.test.js` | `lihtc-opportunity-finder-zori-capture` | 104 | 10 |
| `test/phantom-alias-no-orphans.test.js` | `phantom-alias-no-orphans` | 69 | 10 |
| `test/pipeline-guards-a1.test.js` | `pipeline-guards-a1` | 51 | 10 |
| `test/developer-brief-hna.test.js` | `developer-brief-hna` | 22 | 9 |
| `test/local-resources-discovery.test.js` | `local-resources-discovery` | 47 | 9 |
| `test/data-source-inventory-paths.test.js` | `data-source-inventory-paths` | 79 | 7 |
| `test/hna-takeaways-chas-disclosure.test.js` | `hna-takeaways-chas-disclosure` | 28 | 7 |
| `test/mi-supply-co-vs-national.test.js` | `mi-supply-co-vs-national` | 47 | 7 |
| `test/place-chas-tenure-anchor.test.js` | `place-chas-tenure-anchor` | 87 | 7 |
| `test/boards-advocates-search-links.test.js` | `boards-advocates-search-links` | 68 | 6 |
| `test/hna-extended-fetch-tenure.test.js` | `hna-extended-fetch-tenure` | 64 | 6 |
| `test/hna-race-ethnicity-dp05.test.js` | `hna-race-ethnicity-dp05` | 131 | 6 |
| `test/hna-rent-burden-bins.test.js` | `hna-rent-burden-bins` | 87 | 6 |
| `test/lof-lazy-oz.test.js` | `lof-lazy-oz` | 25 | 6 |
| `test/metric-trust-map-metadata.test.js` | `metric-trust-map-metadata` | 38 | 6 |
| `test/chart-id-coherence.test.js` | `chart-id-coherence` | 127 | 5 |
| `test/econ-dash-series-labels.test.js` | `econ-dash-series-labels` | 35 | 5 |
| `test/hna-ami-chas-disclosure.test.js` | `hna-ami-chas-disclosure` | 38 | 5 |
| `test/nodemailer-v9-smoke.test.js` | `nodemailer-v9-smoke` | 32 | 5 |
| `test/registry-cross-county-consistency.test.js` | `registry-cross-county-consistency` | 59 | 5 |
| `test/econ-dash-co-unemployment.test.js` | `econ-dash-co-unemployment` | 30 | 4 |
| `test/geo-config-county-consistency.test.js` | `geo-config-county-consistency` | 70 | 4 |
| `test/mcm-palette.test.js` | `mcm-palette` | 25 | 4 |
| `test/source-url-sweep-skip-templates.test.js` | `source-url-sweep-skip-templates` | 64 | 4 |
| `test/deal-calc-mortgage-math.test.js` | `deal-calc-mortgage-math` | 53 | 3 |
| `test/metric-semantics-wording.test.js` | `metric-semantics-wording` | 67 | 3 |
| `test/perf-deep-dive-lazy-tract.test.js` | `perf-deep-dive-lazy-tract` | 34 | 3 |
| `test/place-glossary-path.test.js` | `place-glossary-path` | 53 | 3 |
| `test/cross-surface-vintage-labels.test.js` | `cross-surface-vintage-labels` | 94 | 2 |
| `test/navigation-paths.test.js` | `navigation-paths` | 19 | 2 |
| `test/developer-geoids.test.js` | `developer-geoids` | 151 | 0 |
| `test/geography-registry-phantoms.test.js` | `geography-registry-phantoms` | 190 | 0 |
| `test/hna-acs-var-coverage.test.js` | `hna-acs-var-coverage` | 87 | 0 |
| `test/hud-egis.test.js` | `hud-egis` | 508 | 0 |
| `test/smoke-f139.test.js` | `smoke-f139` | 198 | 0 |
| `test/smoke-fmr.test.js` | `smoke-fmr` | 297 | 0 |
| `test/wcag-pill-contrast.test.js` | `wcag-pill-contrast` | 267 | 0 |

## Python — per file

| File | Target module | Lines | Assertions |
|---|---|---:|---:|
| `tests/test_sentinel_normalization.py` | `sentinel_normalization.py` | 305 | 67 |
| `tests/test_stage2_temporal.py` | `stage2_temporal.py` | 756 | 65 |
| `tests/test_stage3_accessibility.py` | `stage3_accessibility.py` | 509 | 57 |
| `tests/test_governance_stress.py` | `governance_stress.py` | 761 | 55 |
| `tests/test_stage3_visualization.py` | `stage3_visualization.py` | 520 | 47 |
| `tests/test_hna_ranking_integrity.py` | `hna_ranking_integrity.py` | 492 | 46 |
| `tests/test_fmr_parsing.py` | `fmr_parsing.py` | 181 | 24 |
| `tests/test_data_plausibility.py` | `data_plausibility.py` | 497 | 22 |
| `tests/test_pma_provenance.py` | `pma_provenance.py` | 180 | 21 |
| `tests/test_hna_geography_coverage.py` | `hna_geography_coverage.py` | 232 | 19 |
| `tests/test_upstream_schema_check.py` | `upstream_schema_check.py` | 170 | 18 |
| `tests/test_build_hna_data_http_204.py` | `build_hna_data_http_204.py` | 88 | 17 |
| `tests/test_place_chas_coverage.py` | `place_chas_coverage.py` | 128 | 17 |
| `tests/test_place_chas.py` | `place_chas.py` | 230 | 15 |
| `tests/test_chas_tract_data.py` | `chas_tract_data.py` | 178 | 14 |
| `tests/test_fmr_extractor.py` | `fmr_extractor.py` | 95 | 13 |
| `tests/test_hmda_data.py` | `hmda_data.py` | 169 | 12 |
| `tests/test_build_hna_data_batch_b.py` | `build_hna_data_batch_b.py` | 124 | 11 |
| `tests/test_place_phantom_aliases.py` | `place_phantom_aliases.py` | 160 | 10 |
| `tests/test_chas_parsing.py` | `chas_parsing.py` | 155 | 9 |
| `tests/test_ranking_index_sentinels.py` | `ranking_index_sentinels.py` | 93 | 9 |
| `tests/build_counties_co_test.py` | `build_counties_co_test.py` | 299 | 0 |
| `tests/demographic_projections_test.py` | `demographic_projections_test.py` | 493 | 0 |
| `tests/economic_indicators_test.py` | `economic_indicators_test.py` | 644 | 0 |

## Reading this report

- **Assertion count is a floor, not a ceiling** of coverage. A test file with 50 assertions can still miss an important edge case; a file with 10 can have exhaustive coverage via property-based checks. Use it to spot *regression directions* (count drops from one report to the next → tests were deleted or converted to narrow snapshots).
- **Target module** is inferred from the test file name (e.g. `pma-transit.test.js` → `pma-transit`). Cross-module integration tests naturally show a single heuristic target.
- **Python assertion count** is lower than line count would suggest because pytest encourages one-assert-per-test — line count per file is closer to "test-case count".

