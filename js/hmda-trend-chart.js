/**
 * hmda-trend-chart.js
 *
 * Renders the "Mortgage Credit Access — Statewide Trends" panel on
 * economic-dashboard.html. Pulls the statewide HMDA YoY data shipped
 * in PR #786 (data/hmda/co-state-trends.json) and shows:
 *   - 4 KPI cards: latest-year originations, denial rate, mean loan,
 *     multifamily originations (with YoY delta on each)
 *   - 4 small line charts: each metric across all available years
 *
 * Why a separate panel
 * --------------------
 * The economic-dashboard already groups FRED housing-cycle indicators
 * (HSN1F, TLRESCONS, USCONS — leading/coincident/lagging). HMDA is the
 * actual transaction-flow data underneath those macro signals: the
 * pairing answers "what's the mortgage market doing right now?" with
 * both macro outlook and ground-truth credit-access metrics.
 *
 * Boots on DOMContentLoaded; soft-fails if data file is missing.
 */
(function () {
  'use strict';

  // Path is RELATIVE to data/. DataService.baseData() prepends 'data/';
  // standalone fallback below also prepends 'data/'. Path-convention
  // regression-protected by tests (see PR #791).
  var STATE_TRENDS_PATH = 'hmda/co-state-trends.json';

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
    if (!document.getElementById('hmda-trends-section')) return;
    var loadingEl = document.getElementById('hmdaTrendsLoading');
    var contentEl = document.getElementById('hmdaTrendsContent');
    if (!contentEl) return;

    // F142 — Race the fetch against a 12-second timeout so the panel
    // doesn't sit stuck on "Loading HMDA trends…" forever if the CDN
    // is slow, the file 404s on a stale deploy, or DataService hangs.
    // The user reported the section frozen on the loading text; without
    // a timeout there was no surfaced error path. Also add a CFPB link
    // to the "unavailable" message so users can verify upstream data.
    var fetchPromise = _fetchJson(_resolveDataUrl(STATE_TRENDS_PATH));
    var timeoutPromise = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout after 12s')); }, 12000);
    });
    Promise.race([fetchPromise, timeoutPromise])
      .then(function (doc) {
        if (!doc || !doc.years || !Object.keys(doc.years).length) {
          if (loadingEl) loadingEl.innerHTML = 'HMDA trends data is empty. ' +
            'Verify upstream: <a href="https://ffiec.cfpb.gov/data-browser/" ' +
            'target="_blank" rel="noopener">CFPB HMDA Data Browser ↗</a>';
          return;
        }
        render(doc);
        if (loadingEl) loadingEl.style.display = 'none';
        contentEl.style.display = '';
      })
      .catch(function (err) {
        console.warn('[hmda-trend-chart] Could not load:', err);
        if (loadingEl) {
          loadingEl.innerHTML = 'HMDA trends unavailable (' +
            (err && err.message ? err.message : err) +
            '). Source: <a href="https://ffiec.cfpb.gov/data-browser/" ' +
            'target="_blank" rel="noopener">CFPB HMDA Data Browser ↗</a>';
        }
      });
  }

  function render(doc) {
    var years = Object.keys(doc.years).sort();
    var latest = years[years.length - 1];
    var prior = years.length >= 2 ? years[years.length - 2] : null;
    var L = doc.years[latest];
    var P = prior ? doc.years[prior] : null;

    // KPI cards
    _setText('hmdaTrendOriginations', _formatCompact(L.originations));
    _setText('hmdaTrendDenialRate', (L.denial_rate * 100).toFixed(1) + '%');
    _setText('hmdaTrendMeanLoan', '$' + _formatCompact(L.mean_loan_amount_usd, true));
    _setText('hmdaTrendMultifamily', _formatCompact(L.multifamily.originations));

    if (P) {
      _setDelta('hmdaTrendOriginationsDelta', _yoyPct(L.originations, P.originations), prior);
      _setDelta('hmdaTrendDenialRateDelta', _yoyPp(L.denial_rate, P.denial_rate), prior, /* isPp */ true);
      _setDelta('hmdaTrendMeanLoanDelta', _yoyPct(L.mean_loan_amount_usd, P.mean_loan_amount_usd), prior);
      _setDelta('hmdaTrendMultifamilyDelta', _yoyPct(L.multifamily.originations, P.multifamily.originations), prior);
    }

    // Build chart series
    var labels = years;
    var origs = years.map(function (y) { return doc.years[y].originations; });
    var denials = years.map(function (y) { return (doc.years[y].denial_rate || 0) * 100; });
    var means = years.map(function (y) { return doc.years[y].mean_loan_amount_usd || 0; });
    var mf = years.map(function (y) {
      return (doc.years[y].multifamily && doc.years[y].multifamily.originations) || 0;
    });

    _drawChart('hmdaTrendOriginationsChart', labels, origs, 'Originations', '#2563eb', /* yLabel */ null);
    _drawChart('hmdaTrendDenialChart', labels, denials, 'Denial Rate (%)', '#dc2626', /* yLabel */ '%');
    _drawChart('hmdaTrendMeanLoanChart', labels, means, 'Mean Loan ($)', '#7c3aed', /* yLabel */ '$');
    _drawChart('hmdaTrendMultifamilyChart', labels, mf, 'Multifamily Originations', '#059669', null);
  }

  function _drawChart(canvasId, labels, values, label, color, yPrefix) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    var ctx = canvas.getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: values,
          borderColor: color,
          backgroundColor: color + '22',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed.y;
                if (yPrefix === '%') return label + ': ' + v.toFixed(1) + '%';
                if (yPrefix === '$') return label + ': $' + Math.round(v).toLocaleString();
                return label + ': ' + v.toLocaleString();
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            grid: { color: 'rgba(148,163,184,.22)' },
            ticks: {
              font: { size: 11 },
              callback: function (v) {
                if (yPrefix === '%') return v.toFixed(0) + '%';
                if (yPrefix === '$') return '$' + _formatCompact(v, true);
                return _formatCompact(v);
              },
            },
          },
        },
      },
    });
  }

  function _setText(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  function _setDelta(id, val, priorYear, isPp) {
    var el = document.getElementById(id);
    if (!el || val == null) return;
    var arrow = val > 0 ? '▲' : val < 0 ? '▼' : '→';
    var color = val > 0 ? 'var(--good,#16a34a)' : val < 0 ? 'var(--bad,#dc2626)' : 'var(--muted)';
    el.style.color = color;
    el.textContent = arrow + ' ' + Math.abs(val).toFixed(isPp ? 1 : 1) +
      (isPp ? 'pp' : '%') + ' YoY';
  }

  function _yoyPct(curr, prev) {
    if (prev == null || prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  }

  function _yoyPp(curr, prev) {
    if (curr == null || prev == null) return null;
    return (curr - prev) * 100;
  }

  function _formatCompact(n, currency) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(currency ? 0 : 1) + 'K';
    return n.toLocaleString();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HmdaTrendChart = { init: init, render: render };
})();
