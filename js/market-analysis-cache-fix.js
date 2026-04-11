/**
 * js/market-analysis-cache-fix.js
 * Persistent ACS data cache for the PMA tool.
 *
 * Fixes the bug where acsMetrics (module-level in market-analysis.js) can
 * become stale or unavailable on subsequent map clicks, producing a
 * "No ACS data isn't available" error on the second run.
 *
 * After the first successful data load, both the raw ACS metrics array and
 * the pre-built GEOID index are saved globally in this singleton so that any
 * subsequent runAnalysis() call can recover them even if the module-level
 * variable has been lost or is empty.
 *
 * Exposes: window.PMADataCache
 */
(function () {
  'use strict';

  /**
   * In-memory store: string key → arbitrary value.
   * @type {Object.<string, *>}
   */
  var _store = {};

  /**
   * Hit counts for each key — useful for debugging cache effectiveness.
   * @type {Object.<string, number>}
   */
  var _hits = {};

  /* ── Public API ──────────────────────────────────────────────────── */

  /**
   * Saves a data payload under the given cache key.
   * Silently ignores null/undefined values so callers can unconditionally
   * call set() without null guards.
   *
   * @param {string} key  - Unique cache key (e.g. 'acsMetrics', 'tractCentroids').
   * @param {*}      data - Value to cache.
   */
  function set(key, data) {
    if (!key) return;
    if (data === null || data === undefined) return;
    _store[key] = data;
    if (!_hits[key]) _hits[key] = 0;
    console.log('[PMADataCache] cached "' + key + '"');
  }

  /**
   * Retrieves a previously cached value, or null if absent.
   * Increments the hit counter for the key.
   *
   * @param {string} key
   * @returns {*} The cached value, or null.
   */
  function get(key) {
    if (!key) return null;
    if (!Object.prototype.hasOwnProperty.call(_store, key)) return null;
    _hits[key] = (_hits[key] || 0) + 1;
    console.log('[PMADataCache] cache HIT "' + key + '" (hits=' + _hits[key] + ')');
    return _store[key];
  }

  /**
   * Returns true when the key exists and the stored value is meaningfully
   * non-empty (non-empty array, object with a non-empty .tracts array, or
   * any other truthy value).
   *
   * @param {string} key
   * @returns {boolean}
   */
  function has(key) {
    if (!Object.prototype.hasOwnProperty.call(_store, key)) return false;
    var v = _store[key];
    if (v === null || v === undefined) return false;
    if (Array.isArray(v))              return v.length > 0;
    if (typeof v === 'object') {
      if (Array.isArray(v.tracts))     return v.tracts.length > 0;
      return Object.keys(v).length > 0;
    }
    return Boolean(v);
  }

  /**
   * Removes a single cached entry.
   * @param {string} key
   */
  function remove(key) {
    delete _store[key];
  }

  /**
   * Clears all cached entries and resets hit counters.
   */
  function clear() {
    _store = {};
    _hits  = {};
  }

  /**
   * Returns a compact debug string listing all cached keys with their hit
   * counts, e.g. "acsMetrics(hits=3), tractCentroids(hits=3)".
   * @returns {string}
   */
  function debugSummary() {
    var keys = Object.keys(_store);
    if (!keys.length) return '(empty)';
    return keys.map(function (k) {
      return k + '(hits=' + (_hits[k] || 0) + ')';
    }).join(', ');
  }

  /* ── localStorage persistence for last PMA run ───────────────────── */

  var LS_KEY   = 'pma_last_result_v1';
  var LS_TTL   = 24 * 60 * 60 * 1000;  // 24 hours in ms

  /**
   * Safely write a value to localStorage.
   * Gracefully degrades when localStorage is unavailable (private mode, etc.).
   * @param {string} key
   * @param {*}      value
   */
  function _lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  /**
   * Safely read a value from localStorage.
   * Returns null on any error.
   * @param {string} key
   * @returns {*}
   */
  function _lsGet(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  /**
   * Persist the last PMA run to localStorage so results survive page refresh.
   * Stored entry contains: lat, lon, options, scoreRun, and a timestamp.
   * Entries older than LS_TTL (24 h) are automatically discarded on load.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {object} options   - method, bufferMiles, proposedUnits
   * @param {object} scoreRun  - full result object from PMAAnalysisRunner
   */
  function saveLastResult(lat, lon, options, scoreRun) {
    if (lat == null || lon == null || !scoreRun) return;
    _lsSet(LS_KEY, {
      ts:       Date.now(),
      lat:      lat,
      lon:      lon,
      options:  options || {},
      scoreRun: scoreRun
    });
    console.log('[PMADataCache] lastResult persisted to localStorage');
  }

  /**
   * Restore the last PMA run from localStorage.
   * Returns null when no entry exists, the entry is malformed, or it is
   * older than LS_TTL (24 h).
   *
   * @returns {{ lat:number, lon:number, options:object, scoreRun:object }|null}
   */
  function loadLastResult() {
    var entry = _lsGet(LS_KEY);
    if (!entry || !entry.ts || !entry.scoreRun) return null;
    if (Date.now() - entry.ts > LS_TTL) {
      try { localStorage.removeItem(LS_KEY); } catch (_) {}
      return null;
    }
    return { lat: entry.lat, lon: entry.lon, options: entry.options, scoreRun: entry.scoreRun };
  }

  /**
   * Remove the persisted last-result entry (e.g. when user clears the tool).
   */
  function clearLastResult() {
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
  }

  /* ── Expose ──────────────────────────────────────────────────────── */
  window.PMADataCache = {
    set:             set,
    get:             get,
    has:             has,
    remove:          remove,
    clear:           clear,
    debugSummary:    debugSummary,
    saveLastResult:  saveLastResult,
    loadLastResult:  loadLastResult,
    clearLastResult: clearLastResult
  };

}());
