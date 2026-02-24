/**
 * js/fetch-helper.js
 * Provides resolveAssetUrl() and safeFetchJSON() for portable, hardened asset loading.
 *
 * resolveAssetUrl(relativePath) — prepend APP_BASE_PATH so paths work regardless of
 *   GitHub Pages repo sub-path or custom domain.
 *
 * safeFetchJSON(relativePath, options) — fetch with:
 *   - Cache-busting query param (?v=<timestamp>)
 *   - Retry logic (up to 3 attempts with exponential backoff)
 *   - Timeout (10 s per attempt)
 *   - Console error on failure
 *   - Visible red error banner inserted into the page on failure
 */
(function () {
  'use strict';

  var BASE = (typeof window.APP_BASE_PATH === 'string') ? window.APP_BASE_PATH : '/';

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
   * Fetch JSON from a local asset path with cache-busting, timeout, and retry.
   *
   * @param {string} relativePath - Relative (or absolute) path to the JSON asset.
   * @param {object} [options]    - Optional fetch options (method, headers, etc.).
   * @returns {Promise<any>}      - Resolves with parsed JSON.
   */
  function safeFetchJSON(relativePath, options) {
    var maxRetries = 3;
    var timeoutMs  = 10000;

    var url = resolveAssetUrl(relativePath);
    // Only add cache-busting for local (same-origin) assets
    if (!/^https?:\/\//i.test(relativePath)) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now();
    }

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
          .then(resolve)
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

  // Expose on window
  window.resolveAssetUrl = resolveAssetUrl;
  window.safeFetchJSON   = safeFetchJSON;
})();
