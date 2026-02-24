/**
 * js/data-service-portable.js
 * Centralised data-loading service.  Exposes window.DataService with:
 *
 *   DataService.getJSON(path)                  — fetch any JSON by full/resolved path
 *   DataService.getGeoJSON(path)               — alias for getJSON, for GeoJSON assets
 *   DataService.baseData(filename)             — resolve "data/<filename>"
 *   DataService.baseMaps(filename)             — resolve "maps/<filename>"
 *   DataService.fredObservations(seriesId, p)  — FRED API call with key injection
 *   DataService.census(url)                    — Census API call (key already in URL or injected)
 *
 * All local asset loads go through safeFetchJSON (defined in fetch-helper.js).
 * API keys are read from window.APP_CONFIG; a console warning is emitted if missing.
 */
(function () {
  'use strict';

  // Defer reading APP_CONFIG until first use so load order doesn't matter.
  function cfg(key) {
    var c = window.APP_CONFIG || {};
    var v = c[key];
    if (!v) console.warn('[DataService] APP_CONFIG.' + key + ' is not set. Some API calls may fail.');
    return v || '';
  }

  // Local asset helpers
  function baseData(filename) {
    return 'data/' + (filename || '');
  }

  function baseMaps(filename) {
    return 'maps/' + (filename || '');
  }

  // Generic JSON loader — uses safeFetchJSON when available, plain fetch otherwise.
  function getJSON(path, options) {
    if (typeof window.safeFetchJSON === 'function') {
      return window.safeFetchJSON(path, options);
    }
    // Minimal fallback in case fetch-helper.js is not yet loaded
    return fetch(path, options).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
      return r.json();
    });
  }

  function getGeoJSON(path, options) {
    return getJSON(path, options);
  }

  /**
   * Fetch observations from the FRED API.
   * @param {string} seriesId   - FRED series ID (e.g. "CPIAUCSL")
   * @param {object} [params]   - Additional query params (units, limit, sort_order, etc.)
   * @returns {Promise<object>} - Parsed FRED response
   */
  function fredObservations(seriesId, params) {
    var key = cfg('FRED_API_KEY');
    var base = 'https://api.stlouisfed.org/fred/series/observations';
    var p = Object.assign({
      series_id: seriesId,
      api_key:   key,
      file_type: 'json',
      sort_order: 'desc',
      limit: '1'
    }, params || {});
    var qs = Object.keys(p).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]);
    }).join('&');
    var url = base + '?' + qs;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('FRED ' + seriesId + ' HTTP ' + r.status);
      return r.json();
    });
  }

  /**
   * Make a Census Bureau API call.
   * If the URL already contains "&key=" the key is not appended again.
   * @param {string} url - Full Census API URL (key may or may not be present)
   * @returns {Promise<any>}
   */
  function census(url) {
    var fullUrl = url;
    if (fullUrl.indexOf('key=') === -1) {
      var key = cfg('CENSUS_API_KEY');
      if (key) {
        fullUrl += (fullUrl.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key);
      }
    }
    return fetch(fullUrl).then(function (r) {
      if (!r.ok) throw new Error('Census API HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  window.DataService = {
    getJSON:           getJSON,
    getGeoJSON:        getGeoJSON,
    baseData:          baseData,
    baseMaps:          baseMaps,
    fredObservations:  fredObservations,
    census:            census
  };
})();
