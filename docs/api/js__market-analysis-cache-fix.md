# `js/market-analysis-cache-fix.js`

js/market-analysis-cache-fix.js
Persistent ACS data cache for the PMA tool.

Fixes the bug where acsMetrics (module-level in market-analysis.js) can
become stale or unavailable on subsequent map clicks, producing a
"No ACS data isn't available" error on the second run.

After the first successful data load, both the raw ACS metrics array and
the pre-built GEOID index are saved globally in this singleton so that any
subsequent runAnalysis() call can recover them even if the module-level
variable has been lost or is empty.

Exposes: window.PMADataCache

## Symbols

### `_store`

In-memory store: string key → arbitrary value.
@type {Object.<string, *>}

### `_hits`

Hit counts for each key — useful for debugging cache effectiveness.
@type {Object.<string, number>}

### `set(key, data)`

Saves a data payload under the given cache key.
Silently ignores null/undefined values so callers can unconditionally
call set() without null guards.

@param {string} key  - Unique cache key (e.g. 'acsMetrics', 'tractCentroids').
@param {*}      data - Value to cache.

### `get(key)`

Retrieves a previously cached value, or null if absent.
Increments the hit counter for the key.

@param {string} key
@returns {*} The cached value, or null.

### `has(key)`

Returns true when the key exists and the stored value is meaningfully
non-empty (non-empty array, object with a non-empty .tracts array, or
any other truthy value).

@param {string} key
@returns {boolean}

### `remove(key)`

Removes a single cached entry.
@param {string} key

### `clear()`

Clears all cached entries and resets hit counters.

### `debugSummary()`

Returns a compact debug string listing all cached keys with their hit
counts, e.g. "acsMetrics(hits=3), tractCentroids(hits=3)".
@returns {string}

### `_lsSet(key, value)`

Safely write a value to localStorage.
Gracefully degrades when localStorage is unavailable (private mode, etc.).
@param {string} key
@param {*}      value

### `_lsGet(key)`

Safely read a value from localStorage.
Returns null on any error.
@param {string} key
@returns {*}

### `saveLastResult(lat, lon, options, scoreRun)`

Persist the last PMA run to localStorage so results survive page refresh.
Stored entry contains: lat, lon, options, scoreRun, and a timestamp.
Entries older than LS_TTL (24 h) are automatically discarded on load.

@param {number} lat
@param {number} lon
@param {object} options   - method, bufferMiles, proposedUnits
@param {object} scoreRun  - full result object from PMAAnalysisRunner

### `loadLastResult()`

Restore the last PMA run from localStorage.
Returns null when no entry exists, the entry is malformed, or it is
older than LS_TTL (24 h).

@returns {{ lat:number, lon:number, options:object, scoreRun:object }|null}

### `clearLastResult()`

Remove the persisted last-result entry (e.g. when user clears the tool).
