# `js/trend-analysis.js`

trend-analysis.js
Colorado Housing Trend Analysis Module

⚠⚠⚠ DEMO / SCAFFOLD DATA — NOT PRODUCTION ⚠⚠⚠

The MEDIAN_PRICE, RENT_GROWTH, VACANCY_RATE, and CONSTRUCTION_STARTS
matrices below are HARDCODED placeholder values from the original
scaffold commit (0dfdb273, 2026-02-22) — they were never wired to
a real data pipeline. The values look plausible but are NOT sourced
from MLS, CoStar, Zillow, Census ACS, or any other named provider
despite the methodology strings implying otherwise.

The module renders a prominent demo-data banner at the top of the
#trend-analysis-section so users cannot mistake the output for a
sourced analysis. Do not cite these numbers in applications,
investor decks, or underwriting.

To replace with real data: wire each matrix to its named provider
(Zillow ZORI for rent growth, Census HVS for vacancy, HUD for
construction starts, FHFA HPI for price), persist the output as a
JSON file in data/, and gate the render on that file loading.

Usage: TrendAnalysis.init()  (call after DOMContentLoaded)
Renders into: #trend-analysis-section

## Symbols

### `mean(arr)`

Compute mean of an array.

### `stddev(arr)`

Compute sample standard deviation.

### `welchT(a, b)`

Two-sample Welch t-test statistic.
Returns { t, significant } where significant = |t| > 2.0 (~p<0.05 heuristic).
