# `js/housing-data-integration.js`

housing-data-integration.js
Unified loader for all housing data sources used across the site.

Sources:
  Census   — /api/co-ami-gap          (real-time serverless)
  HUD      — /api/hud-markets         (weekly serverless cache)
  Demo     — /api/co-demographics     (weekly serverless cache)
  Zillow   — /data/zillow-*.json      (weekly GitHub Actions)
  CAR      — /data/car-*.json         (monthly manual workflow)
  Kalshi   — /data/kalshi/prediction-market.json  (weekly GitHub Actions)

Usage:
  const hdi = window.HousingDataIntegration;
  const all = await hdi.loadAllData();
  const car = hdi.getCachedData('car');

## Symbols

### `loadCensusData()`

Load Census AMI gap data from serverless endpoint or local JSON fallback.

### `loadHUDData()`

Load HUD markets data from serverless endpoint.

### `loadDemographicsData()`

Load Colorado demographics data from serverless endpoint.

### `loadZillowData()`

Load the most recent Zillow data file from /data/zillow-*.json.
Falls back to any matching file found via directory listing.

### `loadCARData()`

Load the most recent CAR market report from /data/car-market-report-YYYY-MM.json.

### `formatDDMMYY(isoString)`

Format an ISO date string as dd-mm-yy.
@param {string} isoString
@returns {string}

### `loadAllData()`

Load all data sources in parallel and return a unified object.
Each source gracefully returns null on failure so the rest still load.

@returns {Promise<{census, hud, demographics, zillow, car, metadata}>}

### `getCachedData(source)`

Return cached data for a named source without re-fetching.
@param {"census"|"hud"|"demographics"|"zillow"|"car"} source
