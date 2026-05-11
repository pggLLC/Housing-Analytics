# Test coverage report

_Auto-generated 2026-05-11 by `scripts/generate-test-coverage.mjs` (weekly via `docs-sync.yml`)._

This is an **assertion-count** report, not line-coverage. Pattern-matched counts of `assert()`, `assert.X()`, `expect()`, `self.assert*()`, and bare pytest `assert` statements. Deliberate choice — a c8/nyc lift comes later once the test density justifies the instrumentation cost (see #655).

## Summary

| Runtime | Test files | Assertions |
|---|---:|---:|
| JavaScript (`test/`) | 69 | 2925 |
| Python (`tests/`)   | 19 | 450 |
| **Total** | **88** | **3375** |

## JavaScript — per file

| File | Target module | Lines | Assertions |
|---|---|---:|---:|
| `test/integration/housing-needs-assessment.test.js` | `housing-needs-assessment` | 644 | 201 |
| `test/acs-etl.test.js` | `acs-etl` | 522 | 136 |
| `test/integration/analytics.test.js` | `analytics` | 334 | 111 |
| `test/integration/compliance-dashboard.test.js` | `compliance-dashboard` | 243 | 110 |
| `test/compliance-checklist.test.js` | `compliance-checklist` | 537 | 102 |
| `test/prop123-historical.test.js` | `prop123-historical` | 390 | 96 |
| `test/unit/site-selection-score.test.js` | `site-selection-score` | 629 | 94 |
| `test/integration/economic-indicators.test.js` | `economic-indicators` | 232 | 91 |
| `test/analytics.test.js` | `analytics` | 401 | 84 |
| `test/integration/projections.test.js` | `projections` | 358 | 79 |
| `test/chfa-pma-checklist.test.js` | `chfa-pma-checklist` | 421 | 78 |
| `test/preservation.test.js` | `preservation` | 406 | 67 |
| `test/prop123.test.js` | `prop123` | 332 | 67 |
| `test/unit/pma-employment-centers.test.js` | `pma-employment-centers` | 331 | 56 |
| `test/unit/scenario-storage.test.js` | `scenario-storage` | 292 | 54 |
| `test/acs-integration.test.js` | `acs-integration` | 417 | 52 |
| `test/soft-funding-tracker.test.js` | `soft-funding-tracker` | 445 | 52 |
| `test/integration/hna-ranking.test.js` | `hna-ranking` | 281 | 51 |
| `test/unit/pma-competitive-set.test.js` | `pma-competitive-set` | 188 | 49 |
| `test/lihtc-deal-predictor.test.js` | `lihtc-deal-predictor` | 323 | 46 |
| `test/query-builder.test.js` | `query-builder` | 338 | 46 |
| `test/pma-confidence.test.js` | `pma-confidence` | 189 | 44 |
| `test/smoke.test.js` | `smoke` | 253 | 40 |
| `test/pma-scoring.test.js` | `pma-scoring` | 307 | 39 |
| `test/unit/pma-justification.test.js` | `pma-justification` | 133 | 39 |
| `test/unit/cohort-component-model.test.js` | `cohort-component-model` | 307 | 38 |
| `test/unit/fema-flood.test.js` | `fema-flood` | 374 | 36 |
| `test/phase3-comparison-ideas.test.js` | `phase3-comparison-ideas` | 129 | 35 |
| `test/pma-transit.test.js` | `pma-transit` | 311 | 35 |
| `test/co-lihtc-map.test.js` | `co-lihtc-map` | 177 | 34 |
| `test/hna-phase2-stubs-wired.test.js` | `hna-phase2-stubs-wired` | 136 | 33 |
| `test/place-chas-lookup.test.js` | `place-chas-lookup` | 151 | 31 |
| `test/dc-constants.test.js` | `dc-constants` | 156 | 30 |
| `test/dc-peer-deals.test.js` | `dc-peer-deals` | 189 | 30 |
| `test/hmda-lookup.test.js` | `hmda-lookup` | 148 | 30 |
| `test/co-historical-allocations.test.js` | `co-historical-allocations` | 256 | 29 |
| `test/dc-rent-achievability.test.js` | `dc-rent-achievability` | 146 | 29 |
| `test/pma-competitive-set.test.js` | `pma-competitive-set` | 292 | 29 |
| `test/unit/pma-commuting.test.js` | `pma-commuting` | 106 | 29 |
| `test/data-freshness-v2.test.js` | `data-freshness-v2` | 114 | 28 |
| `test/hna-ranking-index.test.js` | `hna-ranking-index` | 462 | 28 |
| `test/qap-simulator.test.js` | `qap-simulator` | 205 | 28 |
| `test/unit/pma-infrastructure.test.js` | `pma-infrastructure` | 106 | 28 |
| `test/hmda-trend-and-chas-badge.test.js` | `hmda-trend-and-chas-badge` | 110 | 27 |
| `test/hna-scope-badges.test.js` | `hna-scope-badges` | 137 | 27 |
| `test/hna-dp04-codes.test.js` | `hna-dp04-codes` | 140 | 26 |
| `test/website-monitor.test.js` | `website-monitor` | 187 | 26 |
| `test/unit/pma-opportunities.test.js` | `pma-opportunities` | 113 | 25 |
| `test/place-pages.test.js` | `place-pages` | 130 | 24 |
| `test/pro-forma.test.js` | `pro-forma` | 205 | 24 |
| `test/unit/pma-barriers.test.js` | `pma-barriers` | 89 | 24 |
| `test/unit/pma-schools.test.js` | `pma-schools` | 91 | 24 |
| `test/dc-dscr-stress.test.js` | `dc-dscr-stress` | 162 | 23 |
| `test/unit/pma-transit.test.js` | `pma-transit` | 91 | 22 |
| `test/caching.test.js` | `caching` | 221 | 21 |
| `test/chas-tier-shares.test.js` | `chas-tier-shares` | 119 | 20 |
| `test/cross-county-disclosure.test.js` | `cross-county-disclosure` | 135 | 20 |
| `test/integration/market-analysis.test.js` | `market-analysis` | 130 | 20 |
| `test/county-from-coords.test.js` | `county-from-coords` | 148 | 19 |
| `test/hna-orphan-charts-wired.test.js` | `hna-orphan-charts-wired` | 130 | 17 |
| `test/data-quality-check.test.js` | `data-quality-check` | 215 | 16 |
| `test/unit-mix-validation.test.js` | `unit-mix-validation` | 121 | 16 |
| `test/hna-jurisdiction-normalization.test.js` | `hna-jurisdiction-normalization` | 162 | 15 |
| `test/place-chas-coverage-panel.test.js` | `place-chas-coverage-panel` | 83 | 15 |
| `test/tigerweb-timeout.test.js` | `tigerweb-timeout` | 146 | 14 |
| `test/census-dashboard-scope.test.js` | `census-dashboard-scope` | 54 | 11 |
| `test/chart-id-coherence.test.js` | `chart-id-coherence` | 127 | 5 |
| `test/hud-egis.test.js` | `hud-egis` | 508 | 0 |
| `test/smoke-fmr.test.js` | `smoke-fmr` | 297 | 0 |

## Python — per file

| File | Target module | Lines | Assertions |
|---|---|---:|---:|
| `tests/test_sentinel_normalization.py` | `sentinel_normalization.py` | 305 | 67 |
| `tests/test_stage2_temporal.py` | `stage2_temporal.py` | 740 | 65 |
| `tests/test_stage3_accessibility.py` | `stage3_accessibility.py` | 509 | 57 |
| `tests/test_governance_stress.py` | `governance_stress.py` | 761 | 55 |
| `tests/test_stage3_visualization.py` | `stage3_visualization.py` | 520 | 47 |
| `tests/test_data_plausibility.py` | `data_plausibility.py` | 466 | 21 |
| `tests/test_pma_provenance.py` | `pma_provenance.py` | 180 | 21 |
| `tests/test_hna_geography_coverage.py` | `hna_geography_coverage.py` | 206 | 17 |
| `tests/test_place_chas_coverage.py` | `place_chas_coverage.py` | 128 | 17 |
| `tests/test_place_chas.py` | `place_chas.py` | 230 | 15 |
| `tests/test_chas_tract_data.py` | `chas_tract_data.py` | 178 | 14 |
| `tests/test_hna_ranking_integrity.py` | `hna_ranking_integrity.py` | 271 | 14 |
| `tests/test_hmda_data.py` | `hmda_data.py` | 169 | 12 |
| `tests/test_place_phantom_aliases.py` | `place_phantom_aliases.py` | 160 | 10 |
| `tests/test_chas_parsing.py` | `chas_parsing.py` | 155 | 9 |
| `tests/test_ranking_index_sentinels.py` | `ranking_index_sentinels.py` | 93 | 9 |
| `tests/build_counties_co_test.py` | `build_counties_co_test.py` | 299 | 0 |
| `tests/demographic_projections_test.py` | `demographic_projections_test.py` | 493 | 0 |
| `tests/economic_indicators_test.py` | `economic_indicators_test.py` | 582 | 0 |

## Reading this report

- **Assertion count is a floor, not a ceiling** of coverage. A test file with 50 assertions can still miss an important edge case; a file with 10 can have exhaustive coverage via property-based checks. Use it to spot *regression directions* (count drops from one report to the next → tests were deleted or converted to narrow snapshots).
- **Target module** is inferred from the test file name (e.g. `pma-transit.test.js` → `pma-transit`). Cross-module integration tests naturally show a single heuristic target.
- **Python assertion count** is lower than line count would suggest because pytest encourages one-assert-per-test — line count per file is closer to "test-case count".

