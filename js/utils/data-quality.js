/**
 * js/utils/data-quality.js
 * Shared data-quality helpers for HNA, ranking, and PMA modules.
 *
 * Exposed as window.DataQuality (browser) and module.exports (Node/test).
 *
 * Functions:
 *   isMissingMetric(value)         — true if value is null/undefined/NaN/non-finite/sentinel
 *   sanitizeNumber(value, opts)    — normalize bad values to a display string or null
 *   formatMetric(value, type, opts)— unit-aware display formatting
 */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.DataQuality = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Sentinel value used by some ETL pipelines to indicate missing data.
   * Equals -666666666 (ACS/Census "not available" placeholder).
   */
  var SENTINEL = -666666666;

  /**
   * Determine whether a metric value represents missing / unavailable data.
   * Returns true for: null, undefined, NaN, non-finite numbers, and the
   * ACS sentinel value (-666666666).
   *
   * @param {*} value
   * @returns {boolean}
   */
  function isMissingMetric(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'number') {
      if (!isFinite(value) || isNaN(value)) return true;
      if (value === SENTINEL) return true;
    }
    return false;
  }

  /**
   * Normalize a potentially bad numeric value.
   * Returns null when the value is missing; otherwise returns the numeric value.
   *
   * Options:
   *   opts.fallback {*}  — override the null return (e.g. 0 or '—')
   *
   * @param {*}      value
   * @param {Object} [opts]
   * @returns {number|null|*}
   */
  function sanitizeNumber(value, opts) {
    var options = opts || {};
    if (isMissingMetric(value)) {
      return Object.prototype.hasOwnProperty.call(options, 'fallback')
        ? options.fallback
        : null;
    }
    return +value;
  }

  /**
   * Format a metric value for display, applying unit-aware formatting.
   * Returns an em-dash ('—') when the value is missing.
   *
   * Supported types: 'percent', 'dollars', 'units', 'integer' (default)
   *
   * Options:
   *   opts.decimals {number}  — override decimal places
   *   opts.missing  {string}  — override the missing-value string (default '—')
   *
   * @param {*}      value
   * @param {string} [type]   — 'percent' | 'dollars' | 'units' | 'integer'
   * @param {Object} [opts]
   * @returns {string}
   */
  function formatMetric(value, type, opts) {
    var options = opts || {};
    var missingStr = Object.prototype.hasOwnProperty.call(options, 'missing')
      ? options.missing
      : '\u2014'; // em-dash

    if (isMissingMetric(value)) return missingStr;

    var n = +value;
    var decimals = Object.prototype.hasOwnProperty.call(options, 'decimals')
      ? options.decimals
      : undefined;

    switch (type) {
      case 'percent':
        return n.toLocaleString('en-US', {
          minimumFractionDigits: decimals !== undefined ? decimals : 1,
          maximumFractionDigits: decimals !== undefined ? decimals : 1,
        }) + '%';
      case 'dollars':
        return '$' + n.toLocaleString('en-US', {
          minimumFractionDigits: decimals !== undefined ? decimals : 0,
          maximumFractionDigits: decimals !== undefined ? decimals : 0,
        });
      case 'units':
      case 'integer':
      default:
        return n.toLocaleString('en-US', {
          minimumFractionDigits: decimals !== undefined ? decimals : 0,
          maximumFractionDigits: decimals !== undefined ? decimals : 0,
        });
    }
  }

  return {
    SENTINEL: SENTINEL,
    isMissingMetric: isMissingMetric,
    sanitizeNumber: sanitizeNumber,
    formatMetric: formatMetric,
  };
}));
