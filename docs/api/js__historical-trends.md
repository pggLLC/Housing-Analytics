# `js/historical-trends.js`

js/historical-trends.js

Renders the three panels of the Historical Trends tab (colorado-deep-dive.html#tab-history):
  1. Annual awards by credit type (projects or units, from the CHFA live feed)
     plus typical-deal tiles and the latest CHFA round's award-report figures
  2. LIHTC stock trajectory (cumulative units by award year — the feed has no opening year)
  3. Peer benchmark table (given user-chosen county + unit count, find similar LIHTC projects)

Data sources (all local, no external API):
  - data/affordable-housing/chfa-awards/2026-round-one.json — latest round, parsed from CHFA's award report
  - data/chfa-lihtc.json                     — CHFA HousingTaxCreditProperties_view live export

No rent trajectory panel: current ACS dataset is single-vintage (2023) and does not
support time-series rent trends. Add it when multi-year ACS ingestion is in place.

Charts use window.Chart (Chart.js) loaded from js/vendor/chart.umd.min.js.

Exposes window.HistoricalTrends.render() — the page calls it once, on the tab's first reveal.

_No documented symbols — module has a file-header comment only._
