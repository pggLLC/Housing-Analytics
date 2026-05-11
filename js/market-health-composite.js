/**
 * market-health-composite.js
 *
 * Computes a per-county "Market Health" composite index (0-100) by
 * blending 5 normalized signals already on disk:
 *
 *   1. Job growth 5y (BLS QCEW)            — higher = stronger demand
 *   2. Population growth 5y (ACS/DOLA)     — higher = stronger demand
 *   3. Inverse unemployment (BLS LAUS)     — lower unemp = stronger
 *   4. Mortgage origination volume per pop — higher = healthier credit
 *   5. Inverse denial rate (HMDA)          — lower denial = healthier
 *
 * Output: 0-100 composite where higher = stronger market.
 * Renders into #marketHealthComposite as a sorted county table.
 *
 * Why this matters (per Phase 3 / C4)
 * -----------------------------------
 * Investor "where's the market heat?" question gets a single answer
 * blending labor, demographics, and credit signals — pairs with the
 * Affordability Metrics panel (C1) for a complete market-positioning
 * read.
 */
(function () {
  'use strict';

  var INDICATORS_PATH = 'co-county-economic-indicators.json';
  var HMDA_PATH       = 'hmda/co-county-aggregates.json';
  var _indicators = null;
  var _hmda = null;
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
    if (_indicators && _hmda) return Promise.resolve();
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all([
      _fetchJson(_resolveDataUrl(INDICATORS_PATH)).catch(function () { return null; }),
      _fetchJson(_resolveDataUrl(HMDA_PATH)).catch(function () { return null; }),
    ]).then(function (r) { _indicators = r[0]; _hmda = r[1]; });
    return _loadPromise;
  }

  // Map county NAME to FIPS for HMDA cross-reference. CO FIPS dict
  // is hand-coded (64 counties + DC-style sort by FIPS).
  var CO_COUNTY_NAMES_TO_FIPS = {
    'Adams':'08001','Alamosa':'08003','Arapahoe':'08005','Archuleta':'08007',
    'Baca':'08009','Bent':'08011','Boulder':'08013','Broomfield':'08014',
    'Chaffee':'08015','Cheyenne':'08017','Clear Creek':'08019','Conejos':'08021',
    'Costilla':'08023','Crowley':'08025','Custer':'08027','Delta':'08029',
    'Denver':'08031','Dolores':'08033','Douglas':'08035','Eagle':'08037',
    'Elbert':'08039','El Paso':'08041','Fremont':'08043','Garfield':'08045',
    'Gilpin':'08047','Grand':'08049','Gunnison':'08051','Hinsdale':'08053',
    'Huerfano':'08055','Jackson':'08057','Jefferson':'08059','Kiowa':'08061',
    'Kit Carson':'08063','Lake':'08065','La Plata':'08067','Larimer':'08069',
    'Las Animas':'08071','Lincoln':'08073','Logan':'08075','Mesa':'08077',
    'Mineral':'08079','Moffat':'08081','Montezuma':'08083','Montrose':'08085',
    'Morgan':'08087','Otero':'08089','Ouray':'08091','Park':'08093',
    'Phillips':'08095','Pitkin':'08097','Prowers':'08099','Pueblo':'08101',
    'Rio Blanco':'08103','Rio Grande':'08105','Routt':'08107','Saguache':'08109',
    'San Juan':'08111','San Miguel':'08113','Sedgwick':'08115','Summit':'08117',
    'Teller':'08119','Washington':'08121','Weld':'08123','Yuma':'08125',
  };

  function _percentile(value, sortedAsc) {
    if (value == null || !Number.isFinite(value) || !sortedAsc.length) return 50;
    var n = sortedAsc.length;
    var idx = 0;
    while (idx < n && sortedAsc[idx] < value) idx++;
    return Math.round((idx / n) * 100);
  }

  /** Compute composite scores for all counties. Returns sorted array. */
  function computeAll() {
    if (!_indicators || !_indicators.counties) return [];
    var counties = Object.entries(_indicators.counties).map(function (entry) {
      var name = entry[0];
      var m    = entry[1];
      var fips = CO_COUNTY_NAMES_TO_FIPS[name] ||
                 CO_COUNTY_NAMES_TO_FIPS[name.replace(' County', '')];
      var hmdaRec = null;
      if (fips && _hmda && _hmda.counties && _hmda.counties[fips]) {
        var years = Object.keys(_hmda.counties[fips].years || {}).sort();
        if (years.length) {
          hmdaRec = _hmda.counties[fips].years[years[years.length - 1]];
        }
      }
      return {
        name: name,
        fips: fips,
        jobGrowth:  Number(m.job_growth_5yr_pct),
        popGrowth:  Number(m.population_growth_5yr_pct),
        unempRate:  Number(m.unemployment_rate),
        origVolume: hmdaRec ? Number(hmdaRec.originations) : null,
        denialRate: hmdaRec ? Number(hmdaRec.denial_rate)  : null,
      };
    });
    // Build sorted lists for percentile lookups
    var sortedJob   = counties.map(c => c.jobGrowth).filter(v => Number.isFinite(v)).sort((a,b)=>a-b);
    var sortedPop   = counties.map(c => c.popGrowth).filter(v => Number.isFinite(v)).sort((a,b)=>a-b);
    var sortedUnemp = counties.map(c => c.unempRate).filter(v => Number.isFinite(v)).sort((a,b)=>a-b);
    var sortedOrig  = counties.map(c => c.origVolume).filter(v => Number.isFinite(v)).sort((a,b)=>a-b);
    var sortedDen   = counties.map(c => c.denialRate).filter(v => Number.isFinite(v)).sort((a,b)=>a-b);

    counties.forEach(function (c) {
      var pJob   = _percentile(c.jobGrowth,  sortedJob);
      var pPop   = _percentile(c.popGrowth,  sortedPop);
      var pUnemp = 100 - _percentile(c.unempRate, sortedUnemp);  // invert
      var pOrig  = _percentile(c.origVolume, sortedOrig);
      var pDen   = 100 - _percentile(c.denialRate, sortedDen);   // invert
      // Equal-weight average
      c.composite = Math.round((pJob + pPop + pUnemp + pOrig + pDen) / 5);
      c.pJob = pJob; c.pPop = pPop; c.pUnemp = pUnemp; c.pOrig = pOrig; c.pDen = pDen;
    });
    counties.sort(function (a, b) { return b.composite - a.composite; });
    return counties;
  }

  function _tierColor(score) {
    if (score >= 70) return 'var(--good,#16a34a)';
    if (score >= 50) return 'var(--warn,#d97706)';
    return 'var(--bad,#dc2626)';
  }

  function render(mount) {
    if (!mount) return;
    if (!_indicators) {
      mount.innerHTML = '<p style="color:var(--muted);">Market health data unavailable.</p>';
      return;
    }
    var scored = computeAll();
    var html = '';
    html += '<p style="font-size:.85rem;color:var(--muted);margin:0 0 .75rem;">' +
      'Composite 0-100 score blending 5 signals: job growth (5y), pop growth (5y), ' +
      'inverse unemployment, HMDA origination volume, and inverse HMDA denial rate. ' +
      'Equal-weighted percentile blend. Higher = stronger market.' +
      '</p>';
    html += '<div style="overflow-x:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:.85rem;">';
    html += '<thead><tr>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);">County</th>' +
      '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);">Composite</th>' +
      '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);">Job 5y</th>' +
      '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);">Pop 5y</th>' +
      '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);">Unemp</th>' +
      '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);">Origs</th>' +
      '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);">Denial</th>' +
    '</tr></thead><tbody>';
    scored.forEach(function (c) {
      html += '<tr>' +
        '<td style="padding:4px 8px;">' + _esc(c.name) + '</td>' +
        '<td style="text-align:right;padding:4px 8px;color:' + _tierColor(c.composite) +
            ';font-weight:700;font-variant-numeric:tabular-nums;">' + c.composite + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;color:var(--muted);">' +
            (Number.isFinite(c.jobGrowth) ? c.jobGrowth.toFixed(1) + '%' : '—') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;color:var(--muted);">' +
            (Number.isFinite(c.popGrowth) ? c.popGrowth.toFixed(1) + '%' : '—') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;color:var(--muted);">' +
            (Number.isFinite(c.unempRate) ? c.unempRate.toFixed(1) + '%' : '—') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;color:var(--muted);">' +
            (c.origVolume != null ? c.origVolume.toLocaleString() : '—') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;color:var(--muted);">' +
            (c.denialRate != null ? (c.denialRate * 100).toFixed(1) + '%' : '—') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
    html += '<p style="font-size:.72rem;color:var(--muted);margin-top:.5rem;">' +
      'Sources: BLS QCEW (jobs), BLS LAUS (unemp), ACS/DOLA (pop), CFPB HMDA (origs + denial).' +
      '</p>';
    mount.innerHTML = html;
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function boot() {
    var mount = document.getElementById('marketHealthComposite');
    if (!mount) return;
    init().then(function () { render(mount); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.MarketHealthComposite = { init: init, computeAll: computeAll, render: render };
})();
