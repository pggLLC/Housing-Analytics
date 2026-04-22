# `js/trend-analysis.js`

trend-analysis.js
Colorado Housing Trend Analysis Module
Compares Colorado housing metrics against 10+ peer states with
statistical significance indicators, time-range filtering, and CSV export.

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
