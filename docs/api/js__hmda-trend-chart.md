# `js/hmda-trend-chart.js`

hmda-trend-chart.js

Renders the "Mortgage Credit Access — Statewide Trends" panel on
economic-dashboard.html. Pulls the statewide HMDA YoY data shipped
in PR #786 (data/hmda/co-state-trends.json) and shows:
  - 4 KPI cards: latest-year originations, denial rate, mean loan,
    multifamily originations (with YoY delta on each)
  - 4 small line charts: each metric across all available years

Why a separate panel
--------------------
The economic-dashboard already groups FRED housing-cycle indicators
(HSN1F, TLRESCONS, USCONS — leading/coincident/lagging). HMDA is the
actual transaction-flow data underneath those macro signals: the
pairing answers "what's the mortgage market doing right now?" with
both macro outlook and ground-truth credit-access metrics.

Boots on DOMContentLoaded; soft-fails if data file is missing.

_No documented symbols — module has a file-header comment only._
