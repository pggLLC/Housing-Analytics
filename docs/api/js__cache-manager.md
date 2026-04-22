# `js/cache-manager.js`

js/cache-manager.js
Namespace-isolated localStorage caching with 1-hour TTL and in-memory fallback.

Usage:
  const cache = new CacheManager('hdi');   // namespace prefix
  cache.set('census', data);               // store with timestamp
  cache.get('census');                     // returns data or null (if expired/missing)
  cache.clear('census');                   // remove a single key
  cache.clearAll();                        // remove all keys in this namespace

Graceful degradation:
  - Falls back to an in-memory store when localStorage is unavailable
    (private/incognito mode, storage quota exceeded, etc.).

## Symbols

### `CacheManager(namespace, ttlMs)`

@param {string} namespace  Short prefix to avoid key collisions (e.g. 'hdi').
@param {number} [ttlMs]    TTL in milliseconds. Defaults to 1 hour.
