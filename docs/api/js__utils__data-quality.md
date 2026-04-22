# `js/utils/data-quality.js`

js/utils/data-quality.js
Shared data-quality helpers for HNA, ranking, and PMA modules.

Exposed as window.DataQuality (browser) and module.exports (Node/test).

Functions:
  isMissingMetric(value)         — true if value is null/undefined/NaN/non-finite/sentinel
  sanitizeNumber(value, opts)    — normalize bad values to a display string or null
  formatMetric(value, type, opts)— unit-aware display formatting

## Symbols

### `SENTINEL`

Sentinel value used by some ETL pipelines to indicate missing data.
Equals -666666666 (ACS/Census "not available" placeholder).

### `isMissingMetric(value)`

Determine whether a metric value represents missing / unavailable data.
Returns true for: null, undefined, NaN, non-finite numbers, and the
ACS sentinel value (-666666666).

@param {*} value
@returns {boolean}

### `sanitizeNumber(value, opts)`

Normalize a potentially bad numeric value.
Returns null when the value is missing; otherwise returns the numeric value.

Options:
  opts.fallback {*}  — override the null return (e.g. 0 or '—')

@param {*}      value
@param {Object} [opts]
@returns {number|null|*}

### `formatMetric(value, type, opts)`

Format a metric value for display, applying unit-aware formatting.
Returns an em-dash ('—') when the value is missing.

Supported types: 'percent', 'dollars', 'units', 'integer' (default)

Options:
  opts.decimals {number}  — override decimal places
  opts.missing  {string}  — override the missing-value string (default '—')

@param {*}      value
@param {string} [type]   — 'percent' | 'dollars' | 'units' | 'integer'
@param {Object} [opts]
@returns {string}
