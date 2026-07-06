# `js/historical-trends.js`

js/historical-trends.js

Renders three panels on historical-trends.html:
  1. CHFA annual award history (awards/year + credit-type split + county roll-up)
  2. LIHTC stock trajectory (cumulative projects by year, by county)
  3. Peer benchmark table (given user-chosen county + unit count, find similar LIHTC projects)

Data sources (all local, no external API):
  - data/policy/chfa-awards-historical.json  — sample 2015–2025 awards + aggregate summary
  - data/chfa-lihtc.json                     — CHFA HousingTaxCreditProperties_view live export, 926 CO projects through 2025 (preferred)
  - data/market/hud_lihtc_co.geojson         — Legacy HUD LIHTC snapshot, 716 CO projects (YR_PIS through ~2020) — fallback only

No rent trajectory panel: current ACS dataset is single-vintage (2023) and does not
support time-series rent trends. Add it when multi-year ACS ingestion is in place.

Charts use window.Chart (Chart.js) loaded from js/vendor/chart.umd.min.js.

Exposes window.HistoricalTrends.render() — call on DOMContentLoaded.

_No documented symbols — module has a file-header comment only._
