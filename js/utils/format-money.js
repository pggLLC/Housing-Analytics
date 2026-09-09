/**
 * Shared currency formatting contract.
 *
 * Absence is always a single em dash. Zero is a real value. The ACS
 * -666666666 sentinel is absence even when it arrives as a string.
 */
(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.MoneyFormatter = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var ACS_NOT_AVAILABLE = -666666666;

  function isAbsent(value) {
    if (value === null || value === undefined || value === '') return true;
    var number = Number(value);
    return !Number.isFinite(number) || number === ACS_NOT_AVAILABLE;
  }

  function formatMoney(value, opts) {
    if (isAbsent(value)) return '—';
    opts = opts || {};
    var minimumFractionDigits = Number.isInteger(opts.minimumFractionDigits)
      ? opts.minimumFractionDigits
      : 0;
    var maximumFractionDigits = Number.isInteger(opts.maximumFractionDigits)
      ? opts.maximumFractionDigits
      : minimumFractionDigits;
    return Number(value).toLocaleString(opts.locale || 'en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: minimumFractionDigits,
      maximumFractionDigits: maximumFractionDigits,
    });
  }

  return {
    ACS_NOT_AVAILABLE: ACS_NOT_AVAILABLE,
    isAbsent: isAbsent,
    formatMoney: formatMoney,
  };
}));
