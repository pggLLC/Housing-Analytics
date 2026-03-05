/**
 * js/cache-manager.js
 * Namespace-isolated localStorage caching with 1-hour TTL and in-memory fallback.
 *
 * Usage:
 *   const cache = new CacheManager('hdi');   // namespace prefix
 *   cache.set('census', data);               // store with timestamp
 *   cache.get('census');                     // returns data or null (if expired/missing)
 *   cache.clear('census');                   // remove a single key
 *   cache.clearAll();                        // remove all keys in this namespace
 *
 * Graceful degradation:
 *   - Falls back to an in-memory store when localStorage is unavailable
 *     (private/incognito mode, storage quota exceeded, etc.).
 */
(function (global) {
  'use strict';

  var DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * @param {string} namespace  Short prefix to avoid key collisions (e.g. 'hdi').
   * @param {number} [ttlMs]    TTL in milliseconds. Defaults to 1 hour.
   */
  function CacheManager(namespace, ttlMs) {
    this._ns     = (namespace || 'cm') + ':';
    this._ttl    = (typeof ttlMs === 'number') ? ttlMs : DEFAULT_TTL_MS;
    this._mem    = {};   // in-memory fallback store
    this._useLS  = _localStorageAvailable();
  }

  /**
   * Store a value under the given key. Stamps the current time for TTL checks.
   * @param {string} key
   * @param {*}      value  Must be JSON-serialisable.
   */
  CacheManager.prototype.set = function (key, value) {
    var entry = { ts: Date.now(), data: value };
    var lsKey = this._ns + key;

    if (this._useLS) {
      try {
        localStorage.setItem(lsKey, JSON.stringify(entry));
        return;
      } catch (e) {
        // Quota exceeded or serialisation failure — fall through to in-memory.
        this._useLS = false;
      }
    }

    this._mem[lsKey] = entry;
  };

  /**
   * Retrieve a cached value. Returns null if the key is absent or the TTL has expired.
   * @param {string} key
   * @returns {*|null}
   */
  CacheManager.prototype.get = function (key) {
    var lsKey = this._ns + key;
    var entry = null;

    if (this._useLS) {
      try {
        var raw = localStorage.getItem(lsKey);
        if (raw) entry = JSON.parse(raw);
      } catch (e) {
        entry = null;
      }
    } else {
      entry = this._mem[lsKey] || null;
    }

    if (!entry || !entry.ts || !('data' in entry)) return null;
    if ((Date.now() - entry.ts) > this._ttl) {
      this.clear(key);
      return null;
    }

    return entry.data;
  };

  /**
   * Remove a single key from the cache.
   * @param {string} key
   */
  CacheManager.prototype.clear = function (key) {
    var lsKey = this._ns + key;
    if (this._useLS) {
      try { localStorage.removeItem(lsKey); } catch (e) { /* ignore */ }
    }
    delete this._mem[lsKey];
  };

  /**
   * Remove all keys belonging to this namespace from both localStorage and memory.
   */
  CacheManager.prototype.clearAll = function () {
    var prefix = this._ns;

    if (this._useLS) {
      try {
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) toRemove.push(k);
        }
        toRemove.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* ignore */ }
    }

    var mem = this._mem;
    Object.keys(mem).forEach(function (k) {
      if (k.indexOf(prefix) === 0) delete mem[k];
    });
  };

  // ── Internal helper ─────────────────────────────────────────────

  function _localStorageAvailable() {
    try {
      var testKey = '__cm_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── Expose ──────────────────────────────────────────────────────

  global.CacheManager = CacheManager;

})(window);
