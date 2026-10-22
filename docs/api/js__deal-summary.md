# `js/deal-summary.js`

deal-summary.js: one sourced summary per CHFA housing tax credit award, on deal-summary.html.

deal-summary.html?d=<slug> draws data/deals/<slug>.json; with no (or an unknown) slug it lists
every summary in data/deals/index.json. Each record is hand-researched from public sources and
every figure names its source ids, which are drawn as numbered links to the Sources list.
Rows on where-housing-money-goes.html link here (js/agency-funding.js reads the same index).

_No documented symbols — module has a file-header comment only._
