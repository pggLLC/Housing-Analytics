/**
 * js/market-analysis/market-analysis-utils.js
 * Shared utility functions for the market analysis report.
 * Exposes window.MAUtils.
 */
(function () {
  'use strict';

  /* ── Distance ───────────────────────────────────────────────────── */

  /**
   * Haversine great-circle distance between two WGS-84 points.
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} Distance in miles.
   */
  function haversine(lat1, lon1, lat2, lon2) {
    var R  = 3958.8; // Earth radius in miles
    var dL = (lat2 - lat1) * Math.PI / 180;
    var dO = (lon2 - lon1) * Math.PI / 180;
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Numeric helpers ────────────────────────────────────────────── */

  /**
   * Linearly normalize `value` from [min, max] onto [0, 100], clamped.
   * Returns 0 when min === max to avoid division by zero.
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number} 0–100
   */
  function normalize(value, min, max) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    if (max === min) return 0;
    var result = ((value - min) / (max - min)) * 100;
    return Math.min(100, Math.max(0, result));
  }

  /**
   * Compute a weighted average score from a components object.
   * @param {object} components - `{ key: { score: number, weight: number } }`
   * @returns {number} Weighted 0–100 score.
   */
  function weightedScore(components) {
    if (!components || typeof components !== 'object') return 0;
    var totalWeight = 0;
    var totalScore  = 0;
    for (var key in components) {
      if (!Object.prototype.hasOwnProperty.call(components, key)) continue;
      var comp = components[key];
      if (!comp || typeof comp.score !== 'number' || typeof comp.weight !== 'number') continue;
      totalWeight += comp.weight;
      totalScore  += comp.score * comp.weight;
    }
    if (totalWeight === 0) return 0;
    return Math.min(100, Math.max(0, totalScore / totalWeight));
  }

  /* ── Formatting ─────────────────────────────────────────────────── */

  /**
   * Format a number with locale thousands separators.
   * @param {number} n
   * @param {number} [decimals=0]
   * @returns {string}
   */
  function formatNumber(n, decimals) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var d = (typeof decimals === 'number') ? decimals : 0;
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }

  /**
   * Format a decimal rate as a percentage string.
   * @param {number} rate - e.g. 0.384
   * @param {number} [decimals=1]
   * @returns {string} e.g. "38.4%"
   */
  function formatPct(rate, decimals) {
    if (rate === null || rate === undefined || isNaN(rate)) return '—';
    var d = (typeof decimals === 'number') ? decimals : 1;
    return (Number(rate) * 100).toFixed(d) + '%';
  }

  /**
   * Format a number as a USD currency string.
   * @param {number} n
   * @returns {string} e.g. "$1,200"
   */
  function formatCurrency(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  /* ── Scoring helpers ────────────────────────────────────────────── */

  /**
   * Map a 0–100 score to an opportunity band label.
   * @param {number} score
   * @returns {string} "High" | "Moderate" | "Lower"
   */
  function opportunityBand(score) {
    if (typeof score !== 'number' || isNaN(score)) return 'Lower';
    if (score >= 70) return 'High';
    if (score >= 45) return 'Moderate';
    return 'Lower';
  }

  /**
   * Map a 0–100 score to a CSS color variable token.
   * @param {number} score
   * @returns {string} CSS var() string.
   */
  function scoreColor(score) {
    if (typeof score !== 'number' || isNaN(score)) return 'var(--bad)';
    if (score >= 70) return 'var(--good)';
    if (score >= 45) return 'var(--warn)';
    return 'var(--bad)';
  }

  /**
   * Truncate a string to `maxLen` characters, appending an ellipsis.
   * @param {string} str
   * @param {number} maxLen
   * @returns {string}
   */
  function truncate(str, maxLen) {
    if (typeof str !== 'string') return '';
    if (typeof maxLen !== 'number' || maxLen <= 0) return str;
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '\u2026';
  }

  /* ── Expose ─────────────────────────────────────────────────────── */
  window.MAUtils = {
    haversine:       haversine,
    normalize:       normalize,
    weightedScore:   weightedScore,
    formatNumber:    formatNumber,
    formatPct:       formatPct,
    formatCurrency:  formatCurrency,
    opportunityBand: opportunityBand,
    scoreColor:      scoreColor,
    truncate:        truncate
  };

}());
