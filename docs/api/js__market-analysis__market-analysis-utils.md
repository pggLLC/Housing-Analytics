# `js/market-analysis/market-analysis-utils.js`

js/market-analysis/market-analysis-utils.js
Shared utility functions for the market analysis report.
Exposes window.MAUtils.

## Symbols

### `haversine(lat1, lon1, lat2, lon2)`

Haversine great-circle distance between two WGS-84 points.
@param {number} lat1
@param {number} lon1
@param {number} lat2
@param {number} lon2
@returns {number} Distance in miles.

### `normalize(value, min, max)`

Linearly normalize `value` from [min, max] onto [0, 100], clamped.
Returns 0 when min === max to avoid division by zero.
@param {number} value
@param {number} min
@param {number} max
@returns {number} 0–100

### `weightedScore(components)`

Compute a weighted average score from a components object.
@param {object} components - `{ key: { score: number, weight: number } }`
@returns {number} Weighted 0–100 score.

### `formatNumber(n, decimals)`

Format a number with locale thousands separators.
@param {number} n
@param {number} [decimals=0]
@returns {string}

### `formatPct(rate, decimals)`

Format a decimal rate as a percentage string.
@param {number} rate - e.g. 0.384
@param {number} [decimals=1]
@returns {string} e.g. "38.4%"

### `formatCurrency(n)`

Format a number as a USD currency string.
@param {number} n
@returns {string} e.g. "$1,200"

### `opportunityBand(score)`

Map a 0–100 score to an opportunity band label.
@param {number} score
@returns {string} "High" | "Moderate" | "Lower"

### `scoreColor(score)`

Map a 0–100 score to a CSS color variable token.
@param {number} score
@returns {string} CSS var() string.

### `truncate(str, maxLen)`

Truncate a string to `maxLen` characters, appending an ellipsis.
@param {string} str
@param {number} maxLen
@returns {string}
