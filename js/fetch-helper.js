/**
 * js/fetch-helper.js
 * Provides resolveAssetUrl() and safeFetchJSON() for portable, hardened asset loading.
 *
 * resolveAssetUrl(relativePath) — prepend APP_BASE_PATH so paths work regardless of
 *   GitHub Pages repo sub-path or custom domain.
 *
 * safeFetchJSON(relativePath, options) — fetch with:
 *   - Stable cache-busting query param (?v=<DATA_VERSION|timestamp>)
 *   - Optional localStorage caching (24-hour TTL, stale-while-revalidate)
 *   - Retry logic (up to 3 attempts with exponential backoff)
 *   - Timeout (10 s per attempt)
 *   - Console error on failure
 *   - Visible red error banner inserted into the page on failure
 *   - Error message also written into #statusPanel if present
 */
(function () {
  'use strict';

  var BASE = (typeof window.APP_BASE_PATH === 'string') ? window.APP_BASE_PATH : '/';
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Resolve a relative asset path against the detected base path.
   * Strips any leading "./" or "/" from relativePath first.
   */
  function resolveAssetUrl(relativePath) {
    var clean = (relativePath || '').replace(/^\.?\/+/, '');
    // Absolute URLs (http/https/data) are returned unchanged.
    if (/^https?:\/\//i.test(relativePath) || /^data:/i.test(relativePath)) {
      return relativePath;
    }
    return BASE + clean;
  }

  /**
   * Show a persistent red error banner at the top of the page.
   * Safe to call multiple times — only one banner is created.
   */
  function showErrorBanner(message) {
    if (document.getElementById('_fetch-error-banner')) return;
    function attach() {
      var div = document.createElement('div');
      div.id = '_fetch-error-banner';
      div.setAttribute('role', 'alert');
      div.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
        'background:#c0392b', 'color:#fff', 'padding:10px 16px',
        'font:bold 14px/1.4 sans-serif', 'text-align:center'
      ].join(';');
      div.textContent = '⚠ Data load error: ' + message +
        ' — Some content may be unavailable. Check the console for details.';
      document.body.insertBefore(div, document.body.firstChild);
    }
    if (document.body) {
      attach();
    } else {
      document.addEventListener('DOMContentLoaded', attach);
    }
  }

  /**
   * Write a short error note into #statusPanel if it exists on the page.
   */
  function updateStatusPanel(message) {
    var panel = document.getElementById('statusPanel');
    if (!panel) return;
    function write() {
      panel.textContent = '⚠ ' + message;
    }
    if (document.body) {
      write();
    } else {
      document.addEventListener('DOMContentLoaded', write);
    }
  }

  /**
   * Attempt to read a cached entry from localStorage.
   * Returns { stale, value } if found, or null if absent.
   */
  function readCache(cacheKey) {
    try {
      var raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.ts || !('data' in entry)) return null;
      var age = Date.now() - entry.ts;
      return { stale: age > CACHE_TTL_MS, value: entry.data };
    } catch (e) {
      return null;
    }
  }

  /**
   * Write a value into localStorage under the given cache key.
   */
  function writeCache(cacheKey, data) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) {
      // Ignore storage errors (private mode, quota exceeded, etc.)
    }
  }

  /**
   * Fetch JSON from a local asset path with cache-busting, timeout, and retry.
   *
   * @param {string} relativePath - Relative (or absolute) path to the JSON asset.
   * @param {object} [options]    - Optional fetch options (method, headers, etc.).
   * @returns {Promise<any>}      - Resolves with parsed JSON.
   */
  function safeFetchJSON(relativePath, options) {
    var maxRetries = 3;
    var timeoutMs  = 10000;
    var isLocal = !/^https?:\/\//i.test(relativePath);

    var url = resolveAssetUrl(relativePath);
    // Only add cache-busting for local (same-origin) assets; skip if v= already present
    if (isLocal && url.indexOf('v=') === -1) {
      var version = (window.APP_CONFIG && window.APP_CONFIG.DATA_VERSION) || Date.now();
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + version;
    }

    var cacheKey = isLocal ? '_fh_' + relativePath : null;

    // Stale-while-revalidate: serve stale cache immediately, revalidate in background
    var cached = cacheKey ? readCache(cacheKey) : null;
    if (cached && cached.stale) {
      fetchAndCache(cacheKey, url, maxRetries, timeoutMs, options, relativePath, true);
      return Promise.resolve(cached.value);
    }
    if (cached && !cached.stale) {
      return Promise.resolve(cached.value);
    }

    return fetchAndCache(cacheKey, url, maxRetries, timeoutMs, options, relativePath, false);
  }

  function fetchAndCache(cacheKey, url, maxRetries, timeoutMs, options, relativePath, background) {
    function attempt(n) {
      return new Promise(function (resolve, reject) {
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = controller
          ? setTimeout(function () { controller.abort(); }, timeoutMs)
          : null;

        var fetchOptions = Object.assign({}, options || {});
        if (controller) fetchOptions.signal = controller.signal;

        fetch(url, fetchOptions)
          .then(function (res) {
            if (timer) clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
            return res.json();
          })
          .then(function (data) {
            if (cacheKey) writeCache(cacheKey, data);
            resolve(data);
          })
          .catch(function (err) {
            if (timer) clearTimeout(timer);
            if (n < maxRetries) {
              // Exponential backoff: 500ms, 1000ms, 2000ms
              setTimeout(function () {
                attempt(n + 1).then(resolve).catch(reject);
              }, 500 * Math.pow(2, n - 1));
            } else {
              var pathLabel = (function () {
                try { return new URL(url).pathname; } catch (e) { return relativePath; }
              }());
              console.error('[fetch-helper] Failed to load "' + relativePath + '" after ' + maxRetries + ' attempts:', err);
              if (!background) {
                showErrorBanner(pathLabel);
                updateStatusPanel('Failed to load ' + pathLabel);
              }
              reject(err);
            }
          });
      });
    }

    return attempt(1);
  }

  // Expose on window
  window.resolveAssetUrl = resolveAssetUrl;
  window.safeFetchJSON   = safeFetchJSON;
})();
