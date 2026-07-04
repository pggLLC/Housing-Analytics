/*
 * js/components/zori-rent-utils.js
 *
 * Shared Zillow ZORI helpers for deal underwriting surfaces.
 * ZORI is an all-bedroom county rent index; callers that need per-bedroom
 * estimates scale it with HUD FMR bedroom ratios so the ZORI level stays
 * current while bedroom spreads remain locally consistent.
 */
(function (root) {
  'use strict';

  function normalizeFips(fips) {
    var digits = String(fips || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length > 5) digits = digits.slice(0, 5);
    return digits.padStart(5, '0');
  }

  function getCountyRent(zoriData, fips) {
    var key = normalizeFips(fips);
    if (!zoriData || !zoriData.counties || !key) return null;
    var rec = zoriData.counties[key];
    var rent = rec && Number(rec.rent);
    if (!rec || !Number.isFinite(rent) || rent <= 0) return null;
    return {
      rent: Math.round(rent),
      vintage_month: rec.vintage_month || (zoriData.meta && zoriData.meta.vintage_month) || null,
      name: rec.name || null,
      yoy: Number.isFinite(rec.yoy_change_pct) ? rec.yoy_change_pct : null
    };
  }

  function getPerBedroomRent(zoriData, fips, hudFmr) {
    var zori = getCountyRent(zoriData, fips);
    if (!zori || !hudFmr || typeof hudFmr.getFmrByFips !== 'function') return null;
    var fmr = hudFmr.getFmrByFips(fips);
    if (!fmr || !Number.isFinite(Number(fmr.two_br)) || Number(fmr.two_br) <= 0) return null;
    var fmr2 = Number(fmr.two_br);
    var base = zori.rent;
    return {
      'studio': Math.round(base * Number(fmr.efficiency || fmr2 * 0.78) / fmr2),
      '1br':    Math.round(base * Number(fmr.one_br     || fmr2 * 0.87) / fmr2),
      '2br':    Math.round(base),
      '3br':    Math.round(base * Number(fmr.three_br   || fmr2 * 1.27) / fmr2),
      '4br':    Math.round(base * Number(fmr.four_br    || fmr2 * 1.45) / fmr2),
      _meta: {
        vintage_month: zori.vintage_month,
        name:          zori.name,
        yoy:           zori.yoy
      }
    };
  }

  var api = {
    normalizeFips: normalizeFips,
    getCountyRent: getCountyRent,
    getPerBedroomRent: getPerBedroomRent
  };

  root.ZoriRentUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof self !== 'undefined' ? self : this));
