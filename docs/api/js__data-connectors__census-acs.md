# `js/data-connectors/census-acs.js`

js/data-connectors/census-acs.js
Census ACS data connector — loads prebuilt ACS tract metrics.
For GitHub Pages, uses prebuilt data/market/acs_tract_metrics_co.json.
Exposes window.CensusAcs.

## Symbols

### `geoidIndex`

Index of ACS metrics keyed by census tract GEOID string.
@type {Object.<string, Object>}

### `allMetrics`

Raw array of all loaded ACS metrics objects.
@type {Array.<Object>}

### `loaded`

Whether metrics have been successfully loaded.
@type {boolean}

### `toNum(v)`

Safely coerces a value to a finite number; returns 0 on failure.
@param {*} v
@returns {number}

### `loadMetrics(data)`

Accepts a preloaded ACS metrics array and builds an internal GEOID index
for fast tract lookups.
Each element is expected to have at minimum a `geoid` string property.
@param {Array.<Object>} data - Array of ACS tract metric objects.

### `getMetrics(geoid)`

Returns the metrics object for a single census tract.
@param {string} geoid - Census tract GEOID (e.g. "08031000100").
@returns {Object|null}

### `aggregateForTracts(geoidList)`

Aggregates ACS metrics across a list of tract GEOIDs.
Numeric fields are summed; weighted averages are computed for rate fields.
@param {Array.<string>} geoidList
@returns {{
  pop: number,
  renter_hh: number,
  owner_hh: number,
  total_hh: number,
  vacant: number,
  median_gross_rent: number,
  median_hh_income: number,
  cost_burden_rate: number,
  vacancy_rate: number,
  poverty_rate: number,
  tract_count: number
}}

### `getCostBurdenStats()`

Computes cost-burden statistics across all loaded tracts.
@returns {{ mean: number, max: number, highBurdenCount: number, totalTracts: number }}

### `isLoaded()`

Returns whether ACS metrics have been loaded.
@returns {boolean}
