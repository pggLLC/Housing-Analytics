# `js/co-construction-costs.js`

co-construction-costs.js — Construction Labor & Costs tab on colorado-deep-dive.html.

Two panels, kept apart on purpose:
  Labor     — data/market/co-construction-labor-cost.json (BLS CES, LAUS,
              JOLTS, OEWS; refreshed monthly by
              .github/workflows/fetch-co-construction-labor-cost.yml).
  Materials — data/fred-data.json (BLS PPI via FRED, refreshed daily). The
              labor-cost file names which PPI series to show, so the list of
              materials lives in one place.

A missing value renders as "Value unavailable", never as 0.

_No documented symbols — module has a file-header comment only._
