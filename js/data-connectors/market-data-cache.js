/**
 * js/data-connectors/market-data-cache.js
 * Centralized data fetch wrapper with localStorage caching and fallback.
 * Exposes window.MarketDataCache.
 */
(function () {
  'use strict';

  /** @const {string} localStorage key prefix */
  var PREFIX = 'mdc_';

  /** @const {number} Default TTL: 1 hour in milliseconds */
  var DEFAULT_TTL_MS = 60 * 60 * 1000;

  /**
   * In-memory fallback store for environments where localStorage is
   * unavailable or over quota.
   * @type {Object.<string, {value: *, expiresAt: number}>}
   */
  var memoryStore = {};

  /**
   * Whether localStorage is available for use.
   * @type {boolean}
   */
  var lsAvailable = (function () {
    try {
      var testKey = PREFIX + '__test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }());

  /**
   * Returns the full localStorage key for a given cache key.
   * @param {string} key
   * @returns {string}
   */
  function storageKey(key) {
    return PREFIX + key;
  }

  /**
   * Retrieves a cached value. Checks localStorage first, then memory fallback.
   * Returns null if the entry is absent or expired.
   * @param {string} key
   * @returns {*} The cached value, or null.
   */
  function get(key) {
    if (!key) { return null; }

    var fullKey = storageKey(key);
    var now = Date.now();

    if (lsAvailable) {
      try {
        var raw = localStorage.getItem(fullKey);
        if (raw) {
          var entry = JSON.parse(raw);
          if (entry && entry.expiresAt > now) {
            return entry.value;
          }
          localStorage.removeItem(fullKey);
        }
      } catch (e) {
        console.warn('[MarketDataCache] localStorage read error for key "' + key + '":', e);
      }
    }

    var memEntry = memoryStore[fullKey];
    if (memEntry && memEntry.expiresAt > now) {
      return memEntry.value;
    }
    delete memoryStore[fullKey];
    return null;
  }

  /**
   * Stores a value in the cache with a specified TTL.
   * Falls back to in-memory if localStorage is unavailable or over quota.
   * @param {string} key
   * @param {*} value
   * @param {number} [ttlMs] TTL in milliseconds; defaults to 1 hour.
   */
  function set(key, value, ttlMs) {
    if (!key) { return; }

    var ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : DEFAULT_TTL_MS;
    var entry = { value: value, expiresAt: Date.now() + ttl };
    var fullKey = storageKey(key);

    if (lsAvailable) {
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
        return;
      } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          console.warn('[MarketDataCache] localStorage quota exceeded; falling back to memory for key "' + key + '"');
        } else {
          console.warn('[MarketDataCache] localStorage write error for key "' + key + '":', e);
        }
      }
    }

    memoryStore[fullKey] = entry;
  }

  /**
   * Checks the cache for the given key; on miss, fetches via DataService.getJSON
   * and populates the cache before resolving.
   * @param {string} url  The URL to fetch on a cache miss.
   * @param {string} key  Cache key (must be unique per resource).
   * @param {number} [ttlMs] Optional TTL override in milliseconds.
   * @returns {Promise<*>} Resolves with the data.
   */
  function fetchOrCache(url, key, ttlMs) {
    return new Promise(function (resolve, reject) {
      var cached = get(key);
      if (cached !== null) {
        resolve(cached);
        return;
      }

      if (!window.DataService || typeof window.DataService.getJSON !== 'function') {
        console.warn('[MarketDataCache] DataService unavailable; cannot fetch "' + url + '"');
        reject(new Error('DataService.getJSON unavailable'));
        return;
      }

      window.DataService.getJSON(url)
        .then(function (data) {
          set(key, data, ttlMs);
          resolve(data);
        })
        ['catch'](function (err) {
          console.warn('[MarketDataCache] Fetch failed for "' + url + '":', err);
          reject(err);
        });
    });
  }

  /**
   * Removes a single cache entry from both localStorage and memory.
   * @param {string} key
   */
  function invalidate(key) {
    if (!key) { return; }
    var fullKey = storageKey(key);

    if (lsAvailable) {
      try {
        localStorage.removeItem(fullKey);
      } catch (e) {
        console.warn('[MarketDataCache] localStorage remove error for key "' + key + '":', e);
      }
    }

    delete memoryStore[fullKey];
  }

  /**
   * Removes all market-data-cache entries (those with PREFIX) from
   * localStorage and the in-memory fallback store.
   */
  function clear() {
    if (lsAvailable) {
      try {
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) {
            keysToRemove.push(k);
          }
        }
        for (var j = 0; j < keysToRemove.length; j++) {
          localStorage.removeItem(keysToRemove[j]);
        }
      } catch (e) {
        console.warn('[MarketDataCache] localStorage clear error:', e);
      }
    }

    for (var mk in memoryStore) {
      if (Object.prototype.hasOwnProperty.call(memoryStore, mk) && mk.indexOf(PREFIX) === 0) {
        delete memoryStore[mk];
      }
    }
  }

  window.MarketDataCache = {
    get: get,
    set: set,
    fetchOrCache: fetchOrCache,
    invalidate: invalidate,
    clear: clear
  };

}());
