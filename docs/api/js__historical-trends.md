# `js/historical-trends.js`

js/historical-trends.js

Renders three panels on historical-trends.html:
  1. CHFA annual award history (awards/year + credit-type split + county roll-up)
  2. LIHTC stock trajectory (cumulative projects by year, by county)
  3. Peer benchmark table (given user-chosen county + unit count, find similar LIHTC projects)

Data sources (all local, no external API):
  - data/policy/chfa-awards-historical.json  — sample 2015–2025 awards + aggregate summary
  - data/market/hud_lihtc_co.geojson         — HUD LIHTC DB, 716 CO projects with YR_ALLOC

No rent trajectory panel: current ACS dataset is single-vintage (2023) and does not
support time-series rent trends. Add it when multi-year ACS ingestion is in place.

Charts use window.Chart (Chart.js) loaded from js/vendor/chart.umd.min.js.

Exposes window.HistoricalTrends.render() — call on DOMContentLoaded.

_No documented symbols — module has a file-header comment only._
