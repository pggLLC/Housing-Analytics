# `js/config/live-market-rates.js`

js/config/live-market-rates.js
Loads live market rates from the pre-cached FRED data file and updates
deal calculator inputs + COHO_DEFAULTS with current values.

Reads from data/fred-data.json (refreshed daily by GitHub Actions).
Falls back gracefully to hardcoded defaults if fetch fails.

Series used:
  MORTGAGE30US  — 30-year fixed mortgage rate (→ deal calc permanent debt rate)
  DGS10        — 10-year Treasury yield (→ yield curve / discount rate)
  T10Y2Y       — Yield curve spread (→ market stress signal)
  BAA10Y       — Baa corporate - 10Y Treasury spread (→ credit stress)
  WPUFD49207   — PPI: Inputs to construction (→ hard cost adjustment)

Depends on: js/config/financial-constants.js (must load first)

_No documented symbols — module has a file-header comment only._
