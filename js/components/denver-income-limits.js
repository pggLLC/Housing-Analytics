/**
 * denver-income-limits.js — fills the Denver income-limit table on
 * colorado-deep-dive.html from data/hud-fmr-income-limits.json.
 *
 * The table used to be typed into the page: sixteen dollar figures labelled
 * "(2025)" that matched no HUD release (the 50% one-person limit read
 * $43,450; HUD FY2026 is $50,400). Every figure and the year now come from
 * the data file, so a HUD refresh updates the table with nothing to edit.
 * A figure the file does not carry stays "—"; nothing is estimated.
 */
(function () {
  'use strict';

  var DENVER_FIPS = '08031';
  var TIERS = ['30', '50', '60', '80'];
  var SIZES = [1, 2, 3, 4];

  function money(v) {
    return (typeof v === 'number' && isFinite(v) && v > 0) ? '$' + v.toLocaleString('en-US') : null;
  }

  function setAll(selector, text) {
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) els[i].textContent = text;
  }

  function render(doc) {
    var table = document.getElementById('denverIncomeLimits');
    if (!table) return;
    var meta = (doc && doc.meta) || {};
    var counties = (doc && doc.counties) || [];
    var denver = null;
    for (var i = 0; i < counties.length; i++) {
      if (counties[i] && counties[i].fips === DENVER_FIPS) { denver = counties[i]; break; }
    }
    var il = (denver && denver.income_limits) || {};
    var year = Number.isInteger(meta.income_limits_fiscal_year) ? 'FY' + meta.income_limits_fiscal_year : 'year unavailable';
    setAll('[data-denver-il-year]', year);
    setAll('[data-denver-ami]', money(il.ami_4person) || 'unavailable');

    TIERS.forEach(function (tier) {
      var row = table.querySelector('tr[data-il-tier="' + tier + '"]');
      if (!row) return;
      var cells = row.querySelectorAll('td');
      SIZES.forEach(function (size, idx) {
        if (cells[idx]) cells[idx].textContent = money(il['il' + tier + '_' + size + 'person']) || '—';
      });
    });

    var ctx = document.querySelector('[data-denver-context]');
    var low1 = il.il80_1person;
    if (ctx && typeof low1 === 'number' && low1 > 0) {
      var hourly = (low1 / 2080).toFixed(2);
      ctx.innerHTML = '<strong>Context:</strong> In Denver, one person earning up to ' + money(low1) +
        ' a year (about $' + hourly + ' an hour full time) counts as "low income" at 80% AMI under HUD ' + year +
        ' limits. Need for affordable housing reaches well into the working population.';
    }
  }

  function load() {
    var DS = window.DataService;
    if (!DS || typeof DS.getJSON !== 'function') return;
    DS.getJSON('data/hud-fmr-income-limits.json').then(render).catch(function () {
      setAll('[data-denver-il-year]', 'year unavailable');
      setAll('[data-denver-ami]', 'unavailable');
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { render: render };
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
    else load();
  }
})();
