# `js/components/qap-competitiveness-panel.js`

js/components/qap-competitiveness-panel.js
Renders a QAP Competitiveness Score panel on the Deal Calculator page.

Shows:
  - Estimated QAP score (0–100) with competitive band
  - 6-factor breakdown with bar chart comparison to avg winners/losers
  - Award likelihood percentage
  - Historical context (applications/funded, percentile rank)
  - Actionable recommendations to improve score

Depends on:
  - js/chfa-award-predictor.js (scoring engine)
  - data/policy/chfa-awards-historical.json (historical data)

Mount: renders into #dcQapPanel (created dynamically after HOS panel)

_No documented symbols — module has a file-header comment only._
