# `js/affordability-metrics-panel.js`

affordability-metrics-panel.js

Renders the "Affordability Metrics" panel on colorado-deep-dive's
Market Trends tab. Three ratios per county (computed from existing
data/co-county-economic-indicators.json):

  1. Price-to-Income ratio (median home price / median HHI)
     — Healthy: ≤3.0, Moderate: 3.1-4.5, Stretched: >4.5
  2. Price-to-Rent ratio (median home price / annual gross rent)
     — Buy-friendly: ≤15, Balanced: 15-20, Rent-friendly: >20
  3. Affordability rate (% of CO HHs that can afford the median
     home assuming 30% PITI rule + 7% mortgage rate)

Why these three (per Phase 3 / C1)
----------------------------------
Industry-standard affordability ratios that LIHTC analysts use to
gauge market positioning. P/I and P/R are simple cross-county
comparators; affordability rate gives a per-county threshold that
helps explain LIHTC demand (high P/I = more renters need LIHTC).

Adapted from flamingo_project's metric list (comparison review).
Stack-portable; uses Chart.js when available + plain HTML otherwise.

## Symbols

### `compute(rec, medianGrossRent)`

Compute the 3 affordability ratios + an HH affordability percent
for a county metric record.
@param {object} rec - { median_home_price, median_hh_income, ... }
@param {number} medianGrossRent - county median gross rent ($/mo)
@returns {object} ratios + flags

### `render(mount)`

Render the table for all counties.
@param {HTMLElement} mount
