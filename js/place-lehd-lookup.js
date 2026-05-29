/**
 * place-lehd-lookup.js
 *
 * Browser-side helper for the place-level LEHD WAC blob produced by
 * scripts/hna/build_place_lehd.py:
 *
 *   PR-C2 — TIGER place→tract spatial membership
 *   (this) — place-level LEHD WAC via population-weighted
 *            apportionment of each containing county's blob
 *
 * Why
 * ---
 * LEHD LODES8 WAC publishes employment data at COUNTY granularity in
 * the cached pipeline. Without place-level apportionment, every place
 * selection on HNA silently inherits the parent county's wage /
 * industry numbers — fine for a city that dominates its county
 * (Denver, Colorado Springs) but very misleading for small towns
 * (Paonia, Manitou Springs) and cross-county jurisdictions (Aurora,
 * Erie, Longmont).
 *
 * Public API
 * ----------
 *   window.PlaceLehd.init()       — fetch + cache data/hna/place-lehd.json
 *   window.PlaceLehd.lookup(geoid)— returns place LEHD blob or null
 *   window.PlaceLehd.confidence(geoid) — 'high' | 'medium' | 'low' | null
 *
 * The lookup return shape matches the county LEHD cache files so
 * callers can drop a place blob into renderers that previously read
 * `__HNA_LEHD_CACHE[county]` (same C000, CE01–03, CNS01–20,
 * within/inflow/outflow, annualEmployment {year:n}, annualWages
 * {year:{low,medium,high}}, industries[]).
 */
(function () {
  'use strict';

  var DATA_PATH  = 'hna/place-lehd.json';
  // Reuse the same phantom-alias map place-CHAS uses — same 29 places
  // with non-canonical GEOIDs need the same redirect.
  var ALIAS_PATH = 'hna/place-phantom-aliases.json';
  var _cache   = null;
  var _aliases = null;
  var _loadPromise = null;

  function _resolveDataUrl(rel) {
    if (typeof window !== 'undefined' && window.DataService
        && typeof window.DataService.baseData === 'function') {
      return window.DataService.baseData(rel);
    }
    return 'data/' + rel;
  }

  function _fetchJson(url) {
    if (typeof window !== 'undefined' && window.DataService && window.DataService.getJSON) {
      return window.DataService.getJSON(url);  // DataService defaults to cache:'no-store'
    }
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  function init() {
    if (_cache && _aliases) return Promise.resolve(_cache);
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all([
      _fetchJson(_resolveDataUrl(DATA_PATH)).catch(function (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[place-lehd-lookup] Could not load ' + DATA_PATH + ':', err);
        }
        return { places: {}, meta: {} };
      }),
      _fetchJson(_resolveDataUrl(ALIAS_PATH)).catch(function () {
        return { aliases: {}, meta: {} };
      }),
    ]).then(function (results) {
      _cache   = results[0] || { places: {}, meta: {} };
      _aliases = (results[1] && results[1].aliases) || {};
      return _cache;
    });
    return _loadPromise;
  }

  function _resolveAlias(geoid) {
    if (!geoid) return null;
    if (_aliases && _aliases[geoid]) return _aliases[geoid];
    return geoid;
  }

  function lookup(geoid) {
    if (!_cache || !geoid) return null;
    var resolved = _resolveAlias(geoid);
    var entry = _cache.places && _cache.places[resolved];
    if (!entry || !entry.lehd) return null;
    return entry.lehd;
  }

  function confidence(geoid) {
    if (!_cache || !geoid) return null;
    var resolved = _resolveAlias(geoid);
    var entry = _cache.places && _cache.places[resolved];
    return (entry && entry.coverage_confidence) || null;
  }

  function meta() {
    return (_cache && _cache.meta) || {};
  }

  window.PlaceLehd = { init: init, lookup: lookup, confidence: confidence, meta: meta };
})();
