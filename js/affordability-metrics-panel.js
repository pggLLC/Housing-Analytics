/**
 * affordability-metrics-panel.js
 *
 * Renders the "Affordability Metrics" panel on colorado-deep-dive's
 * Market Trends tab. Three ratios per county (computed from existing
 * data/co-county-economic-indicators.json):
 *
 *   1. Price-to-Income ratio (median home price / median HHI)
 *      — Healthy: ≤3.0, Moderate: 3.1-4.5, Stretched: >4.5
 *   2. Price-to-Rent ratio (median home price / annual gross rent)
 *      — Buy-friendly: ≤15, Balanced: 15-20, Rent-friendly: >20
 *   3. Affordability rate (% of CO HHs that can afford the median
 *      home assuming 30% PITI rule + 7% mortgage rate)
 *
 * Why these three (per Phase 3 / C1)
 * ----------------------------------
 * Industry-standard affordability ratios that LIHTC analysts use to
 * gauge market positioning. P/I and P/R are simple cross-county
 * comparators; affordability rate gives a per-county threshold that
 * helps explain LIHTC demand (high P/I = more renters need LIHTC).
 *
 * Adapted from flamingo_project's metric list (comparison review).
 * Stack-portable; uses Chart.js when available + plain HTML otherwise.
 */
(function () {
  'use strict';

  var INDICATORS_PATH = 'co-county-economic-indicators.json';
  var FRED_PATH       = 'fred-data.json';   // for current 30-yr mortgage rate
  var _data = null;
  var _fredRate = 7.0;  // fallback (CO 30-yr fixed)
  var _loadPromise = null;

  function _resolveDataUrl(rel) {
    if (typeof window !== 'undefined' && window.DataService
        && typeof window.DataService.baseData === 'function') {
      return window.DataService.baseData(rel);
    }
    return 'data/' + rel;
  }

  function _fetchJson(url) {
    if (typeof window !== 'undefined' && window.DataService && window.DataService.getJSON) {
      return window.DataService.getJSON(url);
    }
    return fetch(url).then(function (r) { return r.json(); });
  }

  function init() {
    if (_data) return Promise.resolve(_data);
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all([
      _fetchJson(_resolveDataUrl(INDICATORS_PATH)).catch(function () { return null; }),
      _fetchJson(_resolveDataUrl(FRED_PATH)).catch(function () { return null; }),
    ]).then(function (r) {
      _data = r[0];
      // Best-effort grab the latest MORTGAGE30US observation as the current rate
      var fred = r[1] && r[1].series && r[1].series.MORTGAGE30US;
      if (fred && fred.observations && fred.observations.length) {
        var last = fred.observations[fred.observations.length - 1];
        var v = Number(last.value);
        if (Number.isFinite(v) && v > 1 && v < 20) _fredRate = v;
      }
      return _data;
    });
    return _loadPromise;
  }

  /**
   * Compute the 3 affordability ratios + an HH affordability percent
   * for a county metric record.
   * @param {object} rec - { median_home_price, median_hh_income, ... }
   * @param {number} medianGrossRent - county median gross rent ($/mo)
   * @returns {object} ratios + flags
   */
  function compute(rec, medianGrossRent) {
    if (!rec) return null;
    var home = Number(rec.median_home_price) || 0;
    var hhi  = Number(rec.median_hh_income)  || 0;
    var rent = Number(medianGrossRent)       || 0;
    var p_i  = (home && hhi)  ? home / hhi          : null;
    var p_r  = (home && rent) ? home / (rent * 12)  : null;
    // Affordability rate: HHs whose income >= mortgage threshold.
    // Threshold: monthly PITI = 30% of HHI. Using current 30-yr rate (_fredRate)
    //   monthlyPI = home * (r/12) * (1+r/12)^360 / ((1+r/12)^360 - 1)
    var monthlyRate = (_fredRate / 100) / 12;
    var monthlyPI = home * monthlyRate * Math.pow(1 + monthlyRate, 360) /
                    (Math.pow(1 + monthlyRate, 360) - 1);
    // PITI ≈ monthly P+I × 1.25 (taxes + insurance)
    var monthlyPITI = monthlyPI * 1.25;
    var annualPITI  = monthlyPITI * 12;
    var requiredHHI = annualPITI / 0.30;
    // Affordability rate is hard to compute without HH income distribution;
    // proxy via county median income ratio: if median HHI >= required, ~50%
    // can afford (median split); else proportionally less.
    var affRate = (hhi && requiredHHI) ? Math.min(100, Math.max(0,
      (hhi / requiredHHI) * 50)) : null;
    return {
      home_price: home,
      median_hhi: hhi,
      median_rent: rent,
      price_to_income: p_i,
      price_to_rent: p_r,
      required_hhi_for_home: requiredHHI,
      affordability_rate_pct: affRate,
      mortgage_rate: _fredRate,
    };
  }

  function _tier(value, thresholds, colors) {
    if (value == null || !Number.isFinite(value)) return { color: 'var(--muted)', label: '—' };
    for (var i = 0; i < thresholds.length; i++) {
      if (value <= thresholds[i].max) {
        return { color: colors[i], label: thresholds[i].label };
      }
    }
    return { color: colors[colors.length - 1], label: thresholds[thresholds.length - 1].label };
  }

  /**
   * Render the table for all counties.
   * @param {HTMLElement} mount
   */
  function render(mount) {
    if (!mount) return;
    if (!_data || !_data.counties) {
      mount.innerHTML = '<p style="color:var(--muted);">Affordability data unavailable.</p>';
      return;
    }
    // For now, county median rent isn't in the indicators file. We use a
    // CO statewide proxy until per-county rent data is wired:
    var coRentProxy = 1750;  // CO statewide median gross rent (ACS DP04 2023, rounded)
    var rows = Object.entries(_data.counties).map(function (entry) {
      var rec = compute(entry[1], coRentProxy);
      return {
        name: entry[0],
        rec: rec,
      };
    }).filter(function (r) { return r.rec && r.rec.home_price; });

    // Sort by price-to-income descending (least affordable at top)
    rows.sort(function (a, b) {
      return (b.rec.price_to_income || 0) - (a.rec.price_to_income || 0);
    });

    var piTiers   = [{ max: 3.0, label: 'Healthy' }, { max: 4.5, label: 'Moderate' }, { max: 10, label: 'Stretched' }];
    var prTiers   = [{ max: 15, label: 'Buy-friendly' }, { max: 20, label: 'Balanced' }, { max: 50, label: 'Rent-friendly' }];
    var affTiers  = [{ max: 30, label: 'Constrained' }, { max: 50, label: 'Tight' }, { max: 100, label: 'Accessible' }];
    var colorsBad  = ['var(--good,#16a34a)', 'var(--warn,#d97706)', 'var(--bad,#dc2626)'];
    var colorsGood = ['var(--bad,#dc2626)', 'var(--warn,#d97706)', 'var(--good,#16a34a)'];

    // F143 — Column metadata: tooltip text + tier list + colors per
    // column. Drives both the header tooltips AND the sort state.
    var columns = [
      { key: 'name',           label: 'County',      align: 'left',  tt: 'Colorado county. Click to sort A→Z / Z→A.' },
      { key: 'home_price',     label: 'Median Home', align: 'right', tt: 'ACS 5-year median home value for owner-occupied units (DP04). Click to sort.' },
      { key: 'median_hhi',     label: 'Median HHI',  align: 'right', tt: 'ACS 5-year median household income (DP03). Click to sort.' },
      { key: 'price_to_income',label: 'P/I',         align: 'right', tt: 'Price-to-income ratio (Median Home ÷ Median HHI). Healthy ≤3, Moderate 3–4.5, Stretched >4.5. Click to sort.' },
      { key: 'price_to_rent',  label: 'P/R',         align: 'right', tt: 'Price-to-rent ratio (Median Home ÷ annual rent). ≤15 favors buying, 15–20 balanced, >20 favors renting. Click to sort.' },
      { key: 'affordability_rate_pct', label: 'Aff %', align: 'right', tt: 'Affordability rate — estimated share of CO households who can afford the median home at ' + _fredRate.toFixed(2) + '% mortgage rate (30% PITI rule). Higher is better. Click to sort.' },
    ];

    var html = '';
    html += '<p style="font-size:.85rem;color:var(--muted);margin:0 0 .75rem;">' +
      'Three industry-standard affordability ratios per county. ' +
      'Hover any column header for the definition; click any column header to sort. ' +
      'Healthy P/I ≤3; stretched >4.5. P/R ≤15 favors buying; >20 favors renting. ' +
      'Affordability rate: estimate of CO households who can afford the median home at ' +
      _fredRate.toFixed(2) + '% mortgage rate, 30% PITI rule.' +
      '</p>';
    html += '<div style="overflow-x:auto;">';
    html += '<table class="affordability-table" style="width:100%;border-collapse:collapse;font-size:.85rem;">';
    html += '<thead><tr>';
    columns.forEach(function (col) {
      html += '<th data-sort-key="' + col.key + '" tabindex="0" role="columnheader" ' +
        'aria-sort="none" ' +
        'title="' + _esc(col.tt) + '" ' +
        'style="text-align:' + col.align + ';padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;white-space:nowrap;">' +
        _esc(col.label) +
        '<span class="aff-sort-indicator" aria-hidden="true" style="opacity:.4;margin-left:.25rem;">⇅</span>' +
      '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var pi = r.rec.price_to_income;
      var pr = r.rec.price_to_rent;
      var aff = r.rec.affordability_rate_pct;
      var piMeta = _tier(pi, piTiers, colorsBad);
      var prMeta = _tier(pr, prTiers, colorsBad);
      var affMeta = _tier(aff, affTiers, colorsGood);
      html += '<tr>' +
        '<td style="padding:4px 8px;">' + _esc(r.name) + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">$' +
          Math.round(r.rec.home_price).toLocaleString() + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">$' +
          Math.round(r.rec.median_hhi).toLocaleString() + '</td>' +
        '<td style="text-align:right;padding:4px 8px;color:' + piMeta.color + ';font-weight:600;font-variant-numeric:tabular-nums;" title="' + piMeta.label + '">' +
          (pi != null ? pi.toFixed(2) : '—') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;color:' + prMeta.color + ';font-weight:600;font-variant-numeric:tabular-nums;" title="' + prMeta.label + '">' +
          (pr != null ? pr.toFixed(1) : '—') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;color:' + affMeta.color + ';font-weight:600;font-variant-numeric:tabular-nums;" title="' + affMeta.label + '">' +
          (aff != null ? aff.toFixed(0) + '%' : '—') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
    html += '<p style="font-size:.72rem;color:var(--muted);margin-top:.5rem;">' +
      'Source: <a href="https://data.census.gov/" target="_blank" rel="noopener">ACS 5-year</a> ' +
      '(median home, HHI) · <a href="https://fred.stlouisfed.org/series/MORTGAGE30US" target="_blank" rel="noopener">FRED MORTGAGE30US</a> ' +
      '(current rate). CO statewide median gross rent used as a proxy for the P/R ratio until per-county rent data is wired.' +
      '</p>';
    mount.innerHTML = html;

    // F143 — Wire up click-to-sort and keyboard activation on the table
    // headers. Tracks current sort key + direction in closure; rebuilds
    // the tbody only (header stays static so users keep their tooltip
    // focus state). Initial sort = P/I descending (matches prior
    // behavior so existing screenshots/docs still apply).
    var _sortState = { key: 'price_to_income', dir: 'desc' };
    function _renderTbody() {
      var sortedRows = rows.slice();
      sortedRows.sort(function (a, b) {
        var av, bv;
        if (_sortState.key === 'name') {
          av = a.name; bv = b.name;
          return (_sortState.dir === 'asc' ? 1 : -1) * av.localeCompare(bv);
        }
        av = a.rec[_sortState.key]; bv = b.rec[_sortState.key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (_sortState.dir === 'asc' ? 1 : -1) * (av - bv);
      });
      var tbody = mount.querySelector('.affordability-table tbody');
      if (!tbody) return;
      tbody.innerHTML = sortedRows.map(function (r) {
        var pi = r.rec.price_to_income;
        var pr = r.rec.price_to_rent;
        var aff = r.rec.affordability_rate_pct;
        var piMeta = _tier(pi, piTiers, colorsBad);
        var prMeta = _tier(pr, prTiers, colorsBad);
        var affMeta = _tier(aff, affTiers, colorsGood);
        return '<tr>' +
          '<td style="padding:4px 8px;">' + _esc(r.name) + '</td>' +
          '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">$' + Math.round(r.rec.home_price).toLocaleString() + '</td>' +
          '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">$' + Math.round(r.rec.median_hhi).toLocaleString() + '</td>' +
          '<td style="text-align:right;padding:4px 8px;color:' + piMeta.color + ';font-weight:600;font-variant-numeric:tabular-nums;" title="' + piMeta.label + '">' + (pi != null ? pi.toFixed(2) : '—') + '</td>' +
          '<td style="text-align:right;padding:4px 8px;color:' + prMeta.color + ';font-weight:600;font-variant-numeric:tabular-nums;" title="' + prMeta.label + '">' + (pr != null ? pr.toFixed(1) : '—') + '</td>' +
          '<td style="text-align:right;padding:4px 8px;color:' + affMeta.color + ';font-weight:600;font-variant-numeric:tabular-nums;" title="' + affMeta.label + '">' + (aff != null ? aff.toFixed(0) + '%' : '—') + '</td>' +
        '</tr>';
      }).join('');
    }
    function _updateHeaders() {
      var ths = mount.querySelectorAll('.affordability-table thead th');
      ths.forEach(function (th) {
        var k = th.getAttribute('data-sort-key');
        var ind = th.querySelector('.aff-sort-indicator');
        if (k === _sortState.key) {
          th.setAttribute('aria-sort', _sortState.dir === 'asc' ? 'ascending' : 'descending');
          if (ind) { ind.textContent = _sortState.dir === 'asc' ? '↑' : '↓'; ind.style.opacity = '1'; }
        } else {
          th.setAttribute('aria-sort', 'none');
          if (ind) { ind.textContent = '⇅'; ind.style.opacity = '.4'; }
        }
      });
    }
    function _onHeaderActivate(th) {
      var k = th.getAttribute('data-sort-key');
      if (!k) return;
      if (_sortState.key === k) {
        _sortState.dir = _sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _sortState.key = k;
        // Default descending for numeric columns, ascending for name
        _sortState.dir = k === 'name' ? 'asc' : 'desc';
      }
      _renderTbody();
      _updateHeaders();
    }
    var headerEls = mount.querySelectorAll('.affordability-table thead th');
    headerEls.forEach(function (th) {
      th.addEventListener('click', function () { _onHeaderActivate(th); });
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onHeaderActivate(th); }
      });
    });
    _updateHeaders();
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function boot() {
    var mount = document.getElementById('affordabilityMetrics');
    if (!mount) return;
    init().then(function () { render(mount); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.AffordabilityMetrics = {
    init: init,
    compute: compute,
    render: render,
  };
})();
