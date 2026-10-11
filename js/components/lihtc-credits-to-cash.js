/**
 * lihtc-credits-to-cash.js — the worked example in the LIHTC guide's
 * "How tax credits become cash" diagram.
 *
 * Equity = annual credit × 10 years × price per credit dollar, worked for a
 * $1.5M-a-year deal at the given price and at 5 cents below it. The price is
 * the Colorado median from data/market/novogradac-equity-pricing.json; a price
 * that is missing, zero or negative returns null, never a $0 equity figure.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LihtcCreditsToCash = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var ANNUAL_CREDIT = 1500000;
  var CREDIT_YEARS = 10;
  var LOWER_BY = 0.05;

  function millions(v) { return '$' + (v / 1e6).toFixed(2) + 'M'; }
  function thousands(v) { return '$' + Math.round(v / 1e3).toLocaleString('en-US') + 'K'; }
  function price(v) { return '$' + v.toFixed(2); }

  function example(medianPrice) {
    if (typeof medianPrice !== 'number' || !isFinite(medianPrice) || medianPrice <= 0) return null;
    var low = Math.round((medianPrice - LOWER_BY) * 100) / 100;
    if (low <= 0) return null;
    var equity = ANNUAL_CREDIT * CREDIT_YEARS * medianPrice;
    var lowEquity = ANNUAL_CREDIT * CREDIT_YEARS * low;
    return {
      price: price(medianPrice),
      equity: millions(equity),
      lowPrice: price(low),
      lowEquity: millions(lowEquity),
      difference: thousands(equity - lowEquity)
    };
  }

  return { ANNUAL_CREDIT: ANNUAL_CREDIT, CREDIT_YEARS: CREDIT_YEARS, LOWER_BY: LOWER_BY, example: example };
}));
