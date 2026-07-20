# `js/housing-predictions.js`

housing-predictions.js
Housing Prediction Market Dashboard Module
Loads live probability data from data/kalshi/prediction-market.json
(fetched weekly by .github/workflows/fetch-kalshi.yml).
Falls back to built-in illustrative mock data if the feed is unavailable.

Usage: HousingPredictions.init()  (call after DOMContentLoaded)
Renders into: #housing-predictions-section

## Symbols

### `loadKalshiData()`

Attempt to load live data from the pre-fetched Kalshi JSON file.
Returns null (uses mock) if the file is missing, fails, or has no items.
"Unavailable" is defined as any of the following conditions:
  - The HTTP response is not OK (e.g. 404, 500, or network error)
  - The response body is not valid JSON
  - The parsed object is falsy or carries a top-level `error` field
  - The `items` array is absent or empty (no prediction-market data was fetched)
In all such cases null is returned and the caller falls back to mock data.
@returns {Promise<Object|null>}

### `formatDDMMYY(isoString)`

Format an ISO date string as dd-mm-yy.
@param {string} isoString
@returns {string}

### `mergeKalshiData(kalshiItems)`

Merge Kalshi live items into the chart data arrays.
Only overrides the datasets for metrics that Kalshi returns.
@param {Object[]} kalshiItems — items array from prediction-market.json
@returns {{ pricePredictions, mortgagePredictions, startsPredictions, vacancyPredictions }}
