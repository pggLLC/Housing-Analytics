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

  /** Max age for localStorage JSON cache: 24 hours in ms */
  var CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
   * Also writes a short message into #statusPanel if it exists.
   */
  function showErrorBanner(message) {
    // Extract just the pathname portion for a cleaner message
    var displayPath = message;
    try {
      var u = new URL(message, window.location.href);
      displayPath = u.pathname;
    } catch (e) { /* keep original */ }

    if (!document.getElementById('_fetch-error-banner')) {
      function attach() {
        var div = document.createElement('div');
        div.id = '_fetch-error-banner';
        div.setAttribute('role', 'alert');
        div.style.cssText = [
          'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
          'background:#c0392b', 'color:#fff', 'padding:10px 16px',
          'font:bold 14px/1.4 sans-serif', 'text-align:center'
        ].join(';');
        div.textContent = '⚠ Data load error: ' + displayPath +
          ' — Some content may be unavailable. Check the console for details.';
        document.body.insertBefore(div, document.body.firstChild);
      }
      if (document.body) {
        attach();
      } else {
        document.addEventListener('DOMContentLoaded', attach);
      }
    }

    // Also surface the error in #statusPanel if present
    function updateStatusPanel() {
      var panel = document.getElementById('statusPanel');
      if (panel) {
        panel.textContent = '⚠ Failed to load: ' + displayPath;
        panel.style.cssText = 'color:#c0392b;font-size:0.85em;padding:4px 0;';
      }
    }
    if (document.body) {
      updateStatusPanel();
    } else {
      document.addEventListener('DOMContentLoaded', updateStatusPanel);
    }
  }

  /** Read a cached JSON entry from localStorage. Returns null if absent/expired/error. */
  function lsRead(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || typeof entry.ts !== 'number' || entry.data === undefined) return null;
      if (Date.now() - entry.ts > CACHE_MAX_AGE_MS) {
        localStorage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  /** Write a JSON value to localStorage. Silently ignores quota/errors. */
  function lsWrite(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) { /* quota or private mode — ignore */ }
  }

  /**
   * Fetch JSON from a local asset path with stable cache-busting, localStorage caching,
   * timeout, and retry.
   *
   * @param {string} relativePath - Relative (or absolute) path to the JSON asset.
   * @param {object} [options]    - Optional fetch options (method, headers, etc.).
   * @returns {Promise<any>}      - Resolves with parsed JSON.
   */
  function safeFetchJSON(relativePath, options) {
    var maxRetries = 3;
    var timeoutMs  = 10000;

    var url = resolveAssetUrl(relativePath);

    // Stable cache-busting: use DATA_VERSION from APP_CONFIG if available, else Date.now()
    if (!/^https?:\/\//i.test(relativePath) && url.indexOf('v=') === -1) {
      var version = (window.APP_CONFIG && window.APP_CONFIG.DATA_VERSION)
        ? window.APP_CONFIG.DATA_VERSION
        : Date.now();
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + version;
    }

    var cacheKey = 'jsoncache:' + url;

    function fetchFresh() {
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
              lsWrite(cacheKey, data);
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
                console.error('[fetch-helper] Failed to load "' + relativePath + '" after ' + maxRetries + ' attempts:', err);
                showErrorBanner(relativePath);
                reject(err);
              }
            });
        });
      }
      return attempt(1);
    }

    // Check localStorage cache first (only for local assets, not external URLs)
    if (!/^https?:\/\//i.test(relativePath)) {
      var cached = lsRead(cacheKey);
      if (cached !== null) {
        // Return cached immediately; revalidate in background (stale-while-revalidate)
        fetchFresh().catch(function () { /* background refresh failure is silent */ });
        return Promise.resolve(cached);
      }
    }

    return fetchFresh();
  }

  // Expose on window
  window.resolveAssetUrl = resolveAssetUrl;
  window.safeFetchJSON   = safeFetchJSON;
})();
