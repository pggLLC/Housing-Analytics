/**
 * js/acs-error-handler.js
 *
 * User-facing error messages and data freshness UI indicators for ACS data.
 *
 * Provides:
 *   ACSErrorHandler.handleError(context, error, fallback)
 *     Show an inline warning in a container element and return fallback.
 *
 *   ACSErrorHandler.showFreshnessIndicator(containerId, freshnessInfo)
 *     Render a data-timestamp badge inside the specified container.
 *
 *   ACSErrorHandler.formatFreshnessText(freshnessInfo)
 *     Return a human-readable freshness string without touching the DOM.
 *
 *   ACSErrorHandler.clearError(containerId)
 *     Remove any error/warning element previously injected.
 *
 * Usage (browser)
 * ---------------
 *   <script src="js/acs-error-handler.js"></script>
 *
 *   // On load failure:
 *   ACSErrorHandler.handleError('hnaACSContainer', err, { DP04_0001E: null });
 *
 *   // After successful load:
 *   ACSErrorHandler.showFreshnessIndicator('hnaACSContainer', data._freshness);
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var WARN_AFTER_HOURS  = 24 * 7;   // show "stale" warning after 7 days
  var ERROR_AFTER_HOURS = 24 * 30;  // show "very old" error after 30 days

  var CSS_CLASS_FRESH   = 'acs-freshness--fresh';
  var CSS_CLASS_STALE   = 'acs-freshness--stale';
  var CSS_CLASS_ERROR   = 'acs-freshness--error';
  var CSS_CLASS_WARN    = 'acs-warning';

  // ---------------------------------------------------------------------------
  // DOM helpers (safe — no-ops when element is absent)
  // ---------------------------------------------------------------------------

  function _el(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
  }

  function _removeChild(parent, cls) {
    if (!parent) return;
    var existing = parent.querySelector('.' + cls);
    if (existing) existing.parentNode.removeChild(existing);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  var ACSErrorHandler = {};

  /**
   * Handle an ACS load error by injecting a visible warning into *containerId*
   * and returning *fallback* so callers can continue rendering with defaults.
   *
   * @param {string} containerId  - DOM id of the container element.
   * @param {Error}  error        - The error that was caught.
   * @param {*}      [fallback]   - Value to return (default: null).
   * @returns {*} The fallback value.
   */
  ACSErrorHandler.handleError = function (containerId, error, fallback) {
    var container = _el(containerId);
    var msg = _friendlyMessage(error);
    console.warn('[acs-error-handler] ACS load error in "' + containerId + '":', error);

    if (container) {
      _removeChild(container, CSS_CLASS_WARN);
      var div   = document.createElement('div');
      div.className  = CSS_CLASS_WARN + ' data-warning';
      div.setAttribute('role', 'alert');
      div.setAttribute('aria-live', 'polite');
      div.innerHTML  =
        '<span class="acs-warning__icon" aria-hidden="true">⚠</span>' +
        '<span class="acs-warning__text">' + _escapeHtml(msg) + '</span>';
      container.insertBefore(div, container.firstChild);
    }

    return (typeof fallback !== 'undefined') ? fallback : null;
  };

  /**
   * Render or update a data-freshness indicator badge inside *containerId*.
   *
   * @param {string} containerId   - DOM id of the container element.
   * @param {object} freshnessInfo - Object with {fetchedAt, ageHours, isFresh, isStale}.
   */
  ACSErrorHandler.showFreshnessIndicator = function (containerId, freshnessInfo) {
    if (!freshnessInfo) return;
    var container = _el(containerId);
    var text      = ACSErrorHandler.formatFreshnessText(freshnessInfo);
    var cls       = _freshnessClass(freshnessInfo);

    if (container) {
      _removeChild(container, 'acs-freshness');
      var badge = document.createElement('span');
      badge.className        = 'acs-freshness data-timestamp ' + cls;
      badge.title            = 'Data fetched: ' + freshnessInfo.fetchedAt;
      badge.setAttribute('aria-label', text);
      badge.textContent      = text;
      container.appendChild(badge);
    }
  };

  /**
   * Return a human-readable data-freshness string without touching the DOM.
   *
   * @param {object} freshnessInfo - {fetchedAt, ageHours, isFresh, isStale}
   * @returns {string}
   */
  ACSErrorHandler.formatFreshnessText = function (freshnessInfo) {
    if (!freshnessInfo || !freshnessInfo.fetchedAt) return 'Data freshness unknown';
    var h = freshnessInfo.ageHours || 0;

    if (h < 1)              return 'Data updated just now';
    if (h < 24)             return 'Data updated ' + Math.round(h) + 'h ago';
    var days = Math.round(h / 24);
    if (days === 1)         return 'Data updated 1 day ago';
    if (days < 30)          return 'Data updated ' + days + ' days ago';
    var months = Math.round(days / 30);
    if (months === 1)       return 'Data updated 1 month ago';
    return 'Data updated ' + months + ' months ago';
  };

  /**
   * Remove any injected error/warning element from *containerId*.
   *
   * @param {string} containerId - DOM id of the container element.
   */
  ACSErrorHandler.clearError = function (containerId) {
    var container = _el(containerId);
    if (!container) return;
    _removeChild(container, CSS_CLASS_WARN);
  };

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function _freshnessClass(info) {
    if (!info) return CSS_CLASS_ERROR;
    var h = info.ageHours || 0;
    if (h >= ERROR_AFTER_HOURS) return CSS_CLASS_ERROR;
    if (h >= WARN_AFTER_HOURS)  return CSS_CLASS_STALE;
    return CSS_CLASS_FRESH;
  }

  function _friendlyMessage(error) {
    if (!error) return 'ACS data is temporarily unavailable.';
    var msg = error.message || String(error);
    if (/network|failed to fetch|load/i.test(msg)) {
      return 'Census data could not be loaded. Displaying cached or placeholder values.';
    }
    if (/timeout|abort/i.test(msg)) {
      return 'Census API request timed out. Please try again shortly.';
    }
    if (/429|rate/i.test(msg)) {
      return 'Census API rate limit reached. Data will reload automatically.';
    }
    if (/404|not found/i.test(msg)) {
      return 'ACS data not found for this geography. Some fields may be unavailable.';
    }
    return 'ACS data is temporarily unavailable. Displaying fallback values.';
  }

  function _escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  global.ACSErrorHandler = ACSErrorHandler;

})(typeof window !== 'undefined' ? window : this);
