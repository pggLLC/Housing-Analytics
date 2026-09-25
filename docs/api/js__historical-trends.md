# `js/historical-trends.js`

js/historical-trends.js

Renders three panels on historical-trends.html:
  1. Annual awards by credit type (projects or units, from the CHFA live feed)
     plus typical-deal tiles and the latest CHFA round's award-report figures
  2. LIHTC stock trajectory (cumulative units by placed-in-service year)
  3. Peer benchmark table (given user-chosen county + unit count, find similar LIHTC projects)

Data sources (all local, no external API):
  - data/affordable-housing/chfa-awards/2026-round-one.json — latest round, parsed from CHFA's award report
  - data/chfa-lihtc.json                     — CHFA HousingTaxCreditProperties_view live export, 926 CO projects through 2025 (preferred)
  - data/market/hud_lihtc_co.geojson         — fallback copy with the same CHFA-style fields, used only if chfa-lihtc.json fails

No rent trajectory panel: current ACS dataset is single-vintage (2023) and does not
support time-series rent trends. Add it when multi-year ACS ingestion is in place.

Charts use window.Chart (Chart.js) loaded from js/vendor/chart.umd.min.js.

Exposes window.HistoricalTrends.render() — call on DOMContentLoaded.

_No documented symbols — module has a file-header comment only._
