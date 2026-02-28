/**
 * map-error-handler.js — Graceful degradation for map data loading
 * Provides a fallback chain: API → Local file → Placeholder → User message
 * Validates GeoJSON structure, handles timeouts/retries, and shows
 * user-friendly notifications instead of silent failures.
 */
(function () {
  'use strict';

  var TIMEOUT_MS = 10000;
  var MAX_RETRIES = 2;

  // ----------------------------------------------------------------
  // GeoJSON validation
  // ----------------------------------------------------------------
  function isValidGeoJSON(data) {
    return (
      data &&
      typeof data === 'object' &&
      data.type === 'FeatureCollection' &&
      Array.isArray(data.features)
    );
  }

  var EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] };

  // ----------------------------------------------------------------
  // Fetch with timeout
  // ----------------------------------------------------------------
  function fetchWithTimeout(url, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('Request timed out after ' + ms + 'ms: ' + url));
      }, ms);
      fetch(url)
        .then(function (res) {
          clearTimeout(timer);
          if (!res.ok) {
            reject(new Error('HTTP ' + res.status + ' for ' + url));
          } else {
            resolve(res);
          }
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ----------------------------------------------------------------
  // Fetch JSON with retries
  // ----------------------------------------------------------------
  function fetchJSONWithRetry(url, retries) {
    retries = typeof retries === 'number' ? retries : MAX_RETRIES;
    return fetchWithTimeout(url, TIMEOUT_MS)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!isValidGeoJSON(data)) {
          throw new Error('Invalid GeoJSON from ' + url);
        }
        return data;
      })
      .catch(function (err) {
        if (retries > 0) {
          console.warn('[map-error-handler] Retrying (' + retries + ' left):', err.message);
          return fetchJSONWithRetry(url, retries - 1);
        }
        throw err;
      });
  }

  // ----------------------------------------------------------------
  // User notification (non-blocking banner)
  // ----------------------------------------------------------------
  function showMapNotification(message) {
    if (typeof document === 'undefined') return;
    var existing = document.getElementById('map-error-notification');
    if (existing) { existing.remove(); }

    var el = document.createElement('div');
    el.id = 'map-error-notification';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
      'position:fixed', 'bottom:1rem', 'left:50%', 'transform:translateX(-50%)',
      'background:var(--warn,#d97706)', 'color:#fff',
      'padding:.55rem 1.1rem', 'border-radius:8px', 'font-size:.85rem',
      'box-shadow:0 4px 16px rgba(0,0,0,.2)', 'z-index:9500',
      'max-width:90vw', 'text-align:center', 'pointer-events:auto'
    ].join(';');
    el.textContent = message;

    var close = document.createElement('button');
    close.setAttribute('aria-label', 'Dismiss notification');
    close.style.cssText = 'margin-left:.75rem;background:transparent;border:none;color:#fff;cursor:pointer;font-size:1rem;line-height:1;vertical-align:middle;';
    close.textContent = '×';
    close.addEventListener('click', function () { el.remove(); });
    el.appendChild(close);

    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) { el.remove(); } }, 8000);
  }

  // ----------------------------------------------------------------
  // Main load function: API → local file → placeholder
  // ----------------------------------------------------------------
  function loadMapData(opts) {
    // opts: { apiUrl, localUrl, layerName, onSuccess, onEmpty }
    var apiUrl    = opts.apiUrl    || null;
    var localUrl  = opts.localUrl  || null;
    var layerName = opts.layerName || 'map layer';
    var onSuccess = typeof opts.onSuccess === 'function' ? opts.onSuccess : function () {};
    var onEmpty   = typeof opts.onEmpty   === 'function' ? opts.onEmpty   : function () {};

    var tried = [];

    function tryAPI() {
      if (!apiUrl) return tryLocal();
      tried.push('API');
      return fetchJSONWithRetry(apiUrl, 1)
        .then(function (data) {
          if (data.features.length === 0) { onEmpty(data); return data; }
          return onSuccess(data);
        })
        .catch(function (err) {
          console.warn('[map-error-handler] API failed for', layerName + ':', err.message);
          return tryLocal();
        });
    }

    function tryLocal() {
      if (!localUrl) return usePlaceholder('API unavailable');
      tried.push('local file');
      return fetchJSONWithRetry(localUrl, 0)
        .then(function (data) {
          if (data.features.length === 0) { onEmpty(data); return data; }
          return onSuccess(data);
        })
        .catch(function (err) {
          console.warn('[map-error-handler] Local file failed for', layerName + ':', err.message);
          return usePlaceholder(err.message);
        });
    }

    function usePlaceholder(reason) {
      console.info('[map-error-handler] Using empty placeholder for', layerName, '(tried: ' + tried.join(', ') + '). Reason:', reason);
      onEmpty(EMPTY_FEATURE_COLLECTION);
      showMapNotification(layerName + ' data temporarily unavailable — map may be incomplete.');
      return EMPTY_FEATURE_COLLECTION;
    }

    return tryAPI();
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------
  window.mapErrorHandler = {
    loadMapData:   loadMapData,
    isValidGeoJSON: isValidGeoJSON,
    showMapNotification: showMapNotification
  };

}());
