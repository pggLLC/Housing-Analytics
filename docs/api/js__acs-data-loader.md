# `js/acs-data-loader.js`

js/acs-data-loader.js

Async loader for ACS (American Community Survey) profile data from the
Census Bureau API.  Provides:

  loadACSData(geoid, profileNames)   — main entry point
  ACS_FIELD_MAPPING                  — semantic field metadata (DP04/DP05)

Caching strategy
----------------
Uses CacheManager (js/cache-manager.js) with a 24-hour TTL for browser
sessions.  Cache keys are namespaced under 'acs:'.

Network strategy
----------------
Uses fetchWithTimeout (js/fetch-helper.js) with 3 retries and exponential
backoff (1 s / 2 s / 4 s).  On failure returns a fallback object so callers
always receive a defined structure.

Usage (browser)
---------------
  // Dependencies must be loaded first:
  //   <script src="js/fetch-helper.js"></script>
  //   <script src="js/cache-manager.js"></script>
  //   <script src="js/acs-data-loader.js"></script>

  loadACSData('08077', ['DP04', 'DP05'])
    .then(function(result) { console.log(result); });

## Symbols

### `loadACSData(geoid, profileNames, options)`

Load ACS data for one geography and one or more profile tables.

@param {string}   geoid         - 5-digit county or 7-digit place FIPS.
@param {string[]} profileNames  - ACS table IDs, e.g. ['DP04', 'DP05'].
@param {object}   [options]
@param {number}   [options.year]   - ACS data year (default: 2024).
@param {string}   [options.apiKey] - Census API key (optional).
@param {boolean}  [options.forceRefresh] - Skip cache lookup.
@returns {Promise<object>} Resolved with mapped field data plus metadata.
