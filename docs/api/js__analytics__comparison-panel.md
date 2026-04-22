# `js/analytics/comparison-panel.js`

js/analytics/comparison-panel.js
Multi-geography comparison panel.

Responsibilities:
 - ComparisonPanel class for side-by-side geography comparison
 - Multi-select geography UI (2–4 geographies)
 - Side-by-side metric cards with color coding
 - Comparison table view
 - Downloadable comparison results (CSV/JSON)

Exposed on window.ComparisonPanel.

## Symbols

### `ComparisonPanel(container, options)`

@class ComparisonPanel
@param {HTMLElement|string} container
@param {object} [options]
@param {string[]} [options.metrics] - Metric keys to compare (defaults to all).
@param {function} [options.onSelectionChange] - Callback when selection changes.
