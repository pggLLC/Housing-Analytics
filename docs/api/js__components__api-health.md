# `js/components/api-health.js`

js/components/api-health.js
Lightweight API connectivity checker.

Tests whether external data sources are reachable and reports
status as working / degraded / unavailable. Does NOT replace
DataQualityMonitor — this is a quick pre-flight check that
runs once on page load and reports results.

Usage:
  ApiHealth.check([
    { name: 'Census ACS',  test: () => fetch('data/census-acs-state.json').then(r => r.ok) },
    { name: 'FRED',        test: () => fetch('data/fred-data.json').then(r => r.ok) },
  ]).then(results => ApiHealth.renderBadge('apiHealthBadge', results));

Or auto-run with declarative attribute:
  <div id="apiHealthBadge" data-api-health="auto"></div>

Exposes window.ApiHealth.

## Symbols

### `DEFAULT_SOURCES`

Default data sources to probe (cached JSON files).
Each entry tests whether the cached data file is loadable.
This does NOT test live APIs (those require keys); it tests
whether the GitHub Actions pipeline has populated the cache.

### `probe(src)`

Probe a single source with timeout.
@param {{ name: string, path?: string, test?: function, critical?: boolean }} src
@returns {Promise.<{ name: string, status: string, critical: boolean, ms: number }>}

### `check(sources)`

Check multiple sources in parallel.
@param {Array} [sources] - Array of source configs. Defaults to DEFAULT_SOURCES.
@returns {Promise.<Array>} Results array.

### `renderBadge(containerId, results)`

Render a compact badge showing overall API health.
@param {string} containerId
@param {Array} results - From check()
