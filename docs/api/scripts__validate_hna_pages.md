# `scripts/validate_hna_pages.js`

scripts/validate_hna_pages.js

HNA page smoke-test and sentinel-leak validator.

Runs two complementary validation modes:

 1. **Static checks** (always run, no browser required)
    • HNA HTML pages exist and declare required elements / scripts
    • JS utility files (data-quality.js, hna-utils.js, …) are present
    • All <canvas> elements carry role="img" and aria-label
    • aria-live regions are present on interactive HNA pages
    • Spot-check of data/hna/summary/*.json for leaked sentinel values
    • Ranking-index.json and geo-config.json have expected structure

 2. **Browser checks** (opt-in, requires Playwright)
    • HNA pages load without JavaScript console errors
    • Missing-metric cells render as "—" (em-dash), not "-666,666,666"
    • Data-quality warning badges appear for incomplete geographies
    • Ranking table renders with ≥1 row
    Pass `--browser` to enable.

Usage
-----
  node scripts/validate_hna_pages.js              # static checks only
  node scripts/validate_hna_pages.js --browser    # static + browser
  node scripts/validate_hna_pages.js --url http://localhost:3000  # custom base URL

Exit codes
----------
  0   All enabled checks passed.
  1   One or more checks failed.

## Symbols

### `hasSentinel(val)`

Recursively walk any JSON value; return true if a sentinel is found.
@param {*} val
@returns {boolean}
