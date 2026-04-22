# `js/data-connectors/market-data-cache.js`

js/data-connectors/market-data-cache.js
Centralized data fetch wrapper with localStorage caching and fallback.
Exposes window.MarketDataCache.

## Symbols

### `PREFIX`

@const {string} localStorage key prefix

### `DEFAULT_TTL_MS`

@const {number} Default TTL: 1 hour in milliseconds

### `memoryStore`

In-memory fallback store for environments where localStorage is
unavailable or over quota.
@type {Object.<string, {value: *, expiresAt: number}>}

### `lsAvailable`

Whether localStorage is available for use.
@type {boolean}

### `storageKey(key)`

Returns the full localStorage key for a given cache key.
@param {string} key
@returns {string}

### `get(key)`

Retrieves a cached value. Checks localStorage first, then memory fallback.
Returns null if the entry is absent or expired.
@param {string} key
@returns {*} The cached value, or null.

### `set(key, value, ttlMs)`

Stores a value in the cache with a specified TTL.
Falls back to in-memory if localStorage is unavailable or over quota.
@param {string} key
@param {*} value
@param {number} [ttlMs] TTL in milliseconds; defaults to 1 hour.

### `fetchOrCache(url, key, ttlMs)`

Checks the cache for the given key; on miss, fetches via DataService.getJSON
and populates the cache before resolving.
@param {string} url  The URL to fetch on a cache miss.
@param {string} key  Cache key (must be unique per resource).
@param {number} [ttlMs] Optional TTL override in milliseconds.
@returns {Promise<*>} Resolves with the data.

### `invalidate(key)`

Removes a single cache entry from both localStorage and memory.
@param {string} key

### `clear()`

Removes all market-data-cache entries (those with PREFIX) from
localStorage and the in-memory fallback store.
