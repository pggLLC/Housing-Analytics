# `js/analytics/metric-calculator.js`

js/analytics/metric-calculator.js
Custom metric formula calculator.

Responsibilities:
 - MetricCalculator class for defining and evaluating custom metric formulas
 - Visual formula builder (operand + operator selectors, not free-text)
 - Real-time calculation when geography data changes
 - Save/load custom metrics (localStorage-backed)

Exposed on window.MetricCalculator.

## Symbols

### `MetricCalculator(container, options)`

@class MetricCalculator
@param {HTMLElement|string} container
@param {object} [options]
@param {function} [options.onResult] - Called with (name, value, data) after each calculation.
