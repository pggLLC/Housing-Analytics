# `js/funding-vs-need.js`

funding-vs-need.js — Funding vs Need tab on colorado-deep-dive.html.

Reads data/derived/funding-vs-need.json (scripts/funding/build_funding_vs_need.mjs,
a step of the derived chain), which joins the award ledger parsed weekly from
CHFA and Prop 123 award PDFs (.github/workflows/funding-awards.yml) to the
need and vacancy fields of the ranking index. The rent-advantage chart is
computed here from data/market/zori_rents_co.json, because ZORI is committed
by a workflow that does not run the derived chain.

A missing value renders as "Value unavailable" with its reason, never as 0.

_No documented symbols — module has a file-header comment only._
