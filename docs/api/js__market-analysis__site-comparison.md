# `js/market-analysis/site-comparison.js`

js/market-analysis/site-comparison.js
Multi-site comparison workspace for the Market Analysis page.

Captures site scoring snapshots and renders a ranked comparison table
showing each site's 6-dimension scores, overall score, opportunity band,
QCT/DDA status, and gap coverage.  Up to 10 saved sites.

Depends on:
  js/site-state.js           (persistence)
  js/market-analysis/site-selection-score.js (scoring output)
  js/market-analysis/market-analysis-state.js (MAState — live results)
  js/pma-ui-controller.js    (triggers after scoring)

## Symbols

### `_captureSnapshot()`

Capture the current PMA/site score as a snapshot object.
Returns null if no scored site is available.
