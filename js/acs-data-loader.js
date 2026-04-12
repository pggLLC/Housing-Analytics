/**
 * js/acs-data-loader.js
 *
 * Async loader for ACS (American Community Survey) profile data from the
 * Census Bureau API.  Provides:
 *
 *   loadACSData(geoid, profileNames)   — main entry point
 *   ACS_FIELD_MAPPING                  — semantic field metadata (DP04/DP05)
 *
 * Caching strategy
 * ----------------
 * Uses CacheManager (js/cache-manager.js) with a 24-hour TTL for browser
 * sessions.  Cache keys are namespaced under 'acs:'.
 *
 * Network strategy
 * ----------------
 * Uses fetchWithTimeout (js/fetch-helper.js) with 3 retries and exponential
 * backoff (1 s / 2 s / 4 s).  On failure returns a fallback object so callers
 * always receive a defined structure.
 *
 * Usage (browser)
 * ---------------
 *   // Dependencies must be loaded first:
 *   //   <script src="js/fetch-helper.js"></script>
 *   //   <script src="js/cache-manager.js"></script>
 *   //   <script src="js/acs-data-loader.js"></script>
 *
 *   loadACSData('08077', ['DP04', 'DP05'])
 *     .then(function(result) { console.log(result); });
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  var ACS_BASE_URL   = 'https://api.census.gov/data';
  var ACS_SERIES     = 'acs5';
  var ACS_YEAR       = 2024;
  var STATE_FIPS     = '08';
  var CACHE_TTL_MS   = 24 * 60 * 60 * 1000;  // 24 hours
  var RETRY_DELAYS   = [1000, 2000, 4000];    // ms between retries

  // Fallback values used when the API is unavailable
  var FALLBACKS = {
    DP04_0001E:  null,
    DP04_0046PE: null,
    DP04_0089E:  null,
    DP04_0134E:  null,
    DP05_0001E:  null,
    DP05_0018E:  null,
  };

  // ---------------------------------------------------------------------------
  // Semantic field mapping (mirrors scripts/hna/acs_field_mapping.json)
  // ---------------------------------------------------------------------------

  var ACS_FIELD_MAPPING = {
    DP04: {
      DP04_0001E:  { name: 'total_housing_units',    type: 'integer',    description: 'Total housing units' },
      DP04_0003PE: { name: 'vacancy_rate',            type: 'percentage', description: 'Vacancy rate (%)' },
      DP04_0046PE: { name: 'pct_owner_occupied',      type: 'percentage', description: '% owner-occupied units' },
      DP04_0047PE: { name: 'pct_renter_occupied',     type: 'percentage', description: '% renter-occupied units' },
      DP04_0089E:  { name: 'median_home_value',       type: 'integer',    description: 'Median home value ($)' },
      DP04_0134E:  { name: 'median_gross_rent',       type: 'integer',    description: 'Median gross rent ($)' },
      DP04_0142PE: { name: 'grapi_lt15',              type: 'percentage', description: 'Gross rent < 15% of income' },
      DP04_0143PE: { name: 'grapi_15_19',             type: 'percentage', description: 'Gross rent 15-19.9%' },
      DP04_0144PE: { name: 'grapi_20_24',             type: 'percentage', description: 'Gross rent 20-24.9%' },
      DP04_0145PE: { name: 'grapi_25_29',             type: 'percentage', description: 'Gross rent 25-29.9%' },
      DP04_0146PE: { name: 'grapi_30_34',             type: 'percentage', description: 'Gross rent 30-34.9%' },
      DP04_0147PE: { name: 'grapi_35_plus',           type: 'percentage', description: 'Gross rent 35%+' },
      DP04_0011PE: { name: 'pct_units_5_9',           type: 'percentage', description: '% units in 5-9 unit structures' },
      DP04_0012PE: { name: 'pct_units_10_19',         type: 'percentage', description: '% units in 10-19 unit structures' },
      DP04_0013PE: { name: 'pct_units_20_plus',       type: 'percentage', description: '% units in 20+ unit structures' },
    },
    DP05: {
      DP05_0001E:  { name: 'total_population',        type: 'integer',    description: 'Total population' },
      DP05_0018E:  { name: 'median_age',              type: 'float',      description: 'Median age (years)' },
      DP05_0037PE: { name: 'pct_white_alone',         type: 'percentage', description: '% White alone' },
      DP05_0038PE: { name: 'pct_black_alone',         type: 'percentage', description: '% Black or African American alone' },
      DP05_0044PE: { name: 'pct_asian_alone',         type: 'percentage', description: '% Asian alone' },
      DP05_0071PE: { name: 'pct_hispanic_latino',     type: 'percentage', description: '% Hispanic or Latino' },
    },
  };

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  var _cache = null;

  function _getCache() {
    if (!_cache) {
      _cache = (typeof CacheManager !== 'undefined')
        ? new CacheManager('acs', CACHE_TTL_MS)
        : _memCache();
    }
    return _cache;
  }

  function _memCache() {
    var store = {};
    return {
      get: function (k) {
        var entry = store[k];
        if (!entry) return null;
        if (Date.now() - entry.ts > CACHE_TTL_MS) { delete store[k]; return null; }
        return entry.data;
      },
      set: function (k, v) { store[k] = { ts: Date.now(), data: v }; },
    };
  }

  // ---------------------------------------------------------------------------
  // URL builder
  // ---------------------------------------------------------------------------

  function _buildUrl(tableId, geoid, year, apiKey) {
    var fields  = Object.keys(ACS_FIELD_MAPPING[tableId] || {});
    var varList = 'NAME,' + fields.join(',');
    var base    = ACS_BASE_URL + '/' + year + '/acs/' + ACS_SERIES + '/profile';

    var geoParam;
    if (geoid.length === 5) {
      geoParam = 'for=county:' + geoid.slice(2) + '&in=state:' + STATE_FIPS;
    } else if (geoid.length === 7) {
      geoParam = 'for=place:' + geoid.slice(2) + '&in=state:' + STATE_FIPS;
    } else {
      geoParam = 'for=county:' + geoid + '&in=state:' + STATE_FIPS;
    }

    var url = base + '?get=' + encodeURIComponent(varList) + '&' + geoParam;
    if (apiKey) url += '&key=' + encodeURIComponent(apiKey);
    return url;
  }

  // ---------------------------------------------------------------------------
  // Fetch with retry
  // ---------------------------------------------------------------------------

  function _fetchWithRetry(url, retryIdx) {
    retryIdx = retryIdx || 0;
    var fetcher = (typeof fetchWithTimeout !== 'undefined')
      ? function (u) { return fetchWithTimeout(u, {}, 15000, 0); }
      : function (u) { return fetch(u); };

    return fetcher(url).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    }).catch(function (err) {
      if (retryIdx < RETRY_DELAYS.length) {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            _fetchWithRetry(url, retryIdx + 1).then(resolve).catch(reject);
          }, RETRY_DELAYS[retryIdx]);
        });
      }
      throw err;
    });
  }

  // ---------------------------------------------------------------------------
  // Parser
  // ---------------------------------------------------------------------------

  function _parseResponse(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return null;
    var header = arr[0];
    var row    = arr[1];
    var out    = {};
    header.forEach(function (h, i) { out[h] = row[i]; });
    return out;
  }

  function _coerce(value, type) {
    if (value === null || value === undefined || value === '' ||
        value === '-666666666' || value === '-888888888' || value === '-999999999') {
      return null;
    }
    if (type === 'integer') {
      var n = parseInt(value, 10);
      return isNaN(n) ? null : n;
    }
    if (type === 'float' || type === 'percentage') {
      var f = parseFloat(value);
      return isNaN(f) ? null : f;
    }
    return value;
  }

  function _mapFields(tableId, raw) {
    var tableMeta = ACS_FIELD_MAPPING[tableId] || {};
    var out = {};
    Object.keys(tableMeta).forEach(function (fieldId) {
      out[fieldId] = _coerce(raw[fieldId], tableMeta[fieldId].type);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Data freshness
  // ---------------------------------------------------------------------------

  function _makeFreshnessInfo(fetchedAt) {
    var now      = Date.now();
    var ts       = new Date(fetchedAt).getTime();
    var ageMs    = now - ts;
    var ageHours = ageMs / (1000 * 60 * 60);
    return {
      fetchedAt:  fetchedAt,
      ageHours:   Math.round(ageHours * 10) / 10,
      isFresh:    ageMs < CACHE_TTL_MS,
      isStale:    ageMs >= CACHE_TTL_MS,
    };
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  /**
   * Load ACS data for one geography and one or more profile tables.
   *
   * @param {string}   geoid         - 5-digit county or 7-digit place FIPS.
   * @param {string[]} profileNames  - ACS table IDs, e.g. ['DP04', 'DP05'].
   * @param {object}   [options]
   * @param {number}   [options.year]   - ACS data year (default: 2024).
   * @param {string}   [options.apiKey] - Census API key (optional).
   * @param {boolean}  [options.forceRefresh] - Skip cache lookup.
   * @returns {Promise<object>} Resolved with mapped field data plus metadata.
   */
  function loadACSData(geoid, profileNames, options) {
    options      = options || {};
    var year     = options.year     || ACS_YEAR;
    var apiKey   = options.apiKey   || (typeof window !== 'undefined' && window.CENSUS_API_KEY) || '';
    var noCache  = options.forceRefresh || false;

    var cacheKey  = 'acs_' + geoid + '_' + profileNames.sort().join('_') + '_' + year;
    var cache     = _getCache();

    if (!noCache) {
      var cached = cache.get(cacheKey);
      if (cached) {
        return Promise.resolve(Object.assign({}, cached, {
          _fromCache:   true,
          _freshness:   _makeFreshnessInfo(cached._fetchedAt),
        }));
      }
    }

    var promises = (profileNames || []).map(function (tableId) {
      var url = _buildUrl(tableId, geoid, year, apiKey);
      return _fetchWithRetry(url).then(function (arr) {
        var raw    = _parseResponse(arr);
        var mapped = raw ? _mapFields(tableId, raw) : {};
        return { tableId: tableId, data: mapped, name: raw ? raw.NAME : null, ok: !!raw };
      }).catch(function (err) {
        console.warn('[acs-data-loader] ' + tableId + ' fetch failed for ' + geoid + ':', err);
        return { tableId: tableId, data: {}, ok: false, error: err.message };
      });
    });

    return Promise.all(promises).then(function (results) {
      var merged    = Object.assign({}, FALLBACKS);
      var anyOk     = false;
      var geographyName = null;

      results.forEach(function (r) {
        if (r.ok) {
          anyOk = true;
          Object.assign(merged, r.data);
          if (r.name) geographyName = r.name;
        }
      });

      var now = new Date().toISOString();
      var out = Object.assign({}, merged, {
        _geoid:       geoid,
        _tables:      profileNames,
        _fetchedAt:   now,
        _fromCache:   false,
        _freshness:   _makeFreshnessInfo(now),
        _partial:     !anyOk,
        _name:        geographyName,
      });

      if (anyOk) cache.set(cacheKey, out);
      return out;
    });
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  global.loadACSData       = loadACSData;
  global.ACS_FIELD_MAPPING = ACS_FIELD_MAPPING;

})(typeof window !== 'undefined' ? window : this);
