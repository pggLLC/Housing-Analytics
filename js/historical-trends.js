/**
 * js/historical-trends.js
 *
 * Renders three panels on historical-trends.html:
 *   1. CHFA annual award history (awards/year + credit-type split + county roll-up)
 *   2. LIHTC stock trajectory (cumulative projects by year, by county)
 *   3. Peer benchmark table (given user-chosen county + unit count, find similar LIHTC projects)
 *
 * Data sources (all local, no external API):
 *   - data/policy/chfa-awards-historical.json  — sample 2015–2025 awards + aggregate summary
 *   - data/market/hud_lihtc_co.geojson         — HUD LIHTC DB, 716 CO projects with YR_ALLOC
 *
 * No rent trajectory panel: current ACS dataset is single-vintage (2023) and does not
 * support time-series rent trends. Add it when multi-year ACS ingestion is in place.
 *
 * Charts use window.Chart (Chart.js) loaded from js/vendor/chart.umd.min.js.
 *
 * Exposes window.HistoricalTrends.render() — call on DOMContentLoaded.
 */
(function (global) {
  'use strict';

  var state = {
    awards: null,         // chfa-awards-historical.json parsed
    lihtcFeatures: null,  // hud_lihtc_co.geojson features
    charts: {}            // Chart.js instance map (for teardown on re-render)
  };

  /* ─────────────────────────────────────────────────────────────── */
  /* Helpers                                                         */
  /* ─────────────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function groupBy(arr, keyFn) {
    var out = {};
    arr.forEach(function (x) {
      var k = keyFn(x);
      (out[k] = out[k] || []).push(x);
    });
    return out;
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr)).sort(function (a, b) {
      return typeof a === 'number' ? a - b : String(a).localeCompare(String(b));
    });
  }

  function _resolveUrl(path) {
    return (typeof global.resolveAssetUrl === 'function')
      ? global.resolveAssetUrl(path)
      : path;
  }

  function _fetchJson(path) {
    return fetch(_resolveUrl(path)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
      return r.json();
    });
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* Panel 1: CHFA Award History                                     */
  /* ─────────────────────────────────────────────────────────────── */

  function _renderChfaPanel() {
    if (!state.awards || !global.Chart) return;
    var awards = state.awards.awards || [];
    var summary = state.awards.summary || {};

    // By-year aggregation
    var years = uniqueSorted((summary.yearsAnalyzed || []).concat(awards.map(function (a) { return a.year; })));
    var byYear = groupBy(awards, function (a) { return a.year; });
    var yearCounts = years.map(function (y) { return (byYear[y] || []).length; });

    // Credit-type split (9% vs 4%)
    var nine = years.map(function (y) {
      return (byYear[y] || []).filter(function (a) { return a.execution === '9%'; }).length;
    });
    var four = years.map(function (y) {
      return (byYear[y] || []).filter(function (a) { return a.execution === '4%'; }).length;
    });

    // Destroy any existing chart
    if (state.charts.chfaTimeline) state.charts.chfaTimeline.destroy();

    var ctx = document.getElementById('chfaTimelineChart');
    if (!ctx) return;

    state.charts.chfaTimeline = new global.Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          { label: '9% competitive', data: nine, backgroundColor: '#096e65' },
          { label: '4% PAB-backed',  data: four, backgroundColor: '#b45309' }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title:  { display: true, text: 'Colorado LIHTC awards per year (by credit type)' },
          legend: { position: 'bottom' }
        },
        scales: {
          x: { stacked: true, title: { display: true, text: 'Year' } },
          y: { stacked: true, title: { display: true, text: 'Project count (sample)' }, beginAtZero: true }
        }
      }
    });

    // Summary stats table
    var statsEl = document.getElementById('chfaStats');
    if (statsEl) {
      statsEl.innerHTML =
        '<dl class="ht-stat-list">' +
          '<div><dt>Awards tracked</dt><dd>' + (summary.totalAwards || awards.length) + '</dd></div>' +
          '<div><dt>Years covered</dt><dd>' + (years.length ? (years[0] + '–' + years[years.length - 1]) : '—') + '</dd></div>' +
          '<div><dt>Average score</dt><dd>' + (summary.avgScore || '—') + ' / 100</dd></div>' +
          '<div><dt>Median score</dt><dd>' + (summary.medianScore || '—') + ' / 100</dd></div>' +
          '<div><dt>Avg awards / yr</dt><dd>' + (summary.avgAwardsPerYear || '—') + '</dd></div>' +
          '<div><dt>Avg applications / yr</dt><dd>' + (summary.avgApplicationsPerYear || '—') + '</dd></div>' +
          '<div><dt>Award rate</dt><dd>' +
            (summary.awardRate != null ? (Math.round(summary.awardRate * 100) + '%') : '—') +
          '</dd></div>' +
          '<div><dt>Family win rate</dt><dd>' +
            (summary.familyWinRate != null ? (Math.round(summary.familyWinRate * 100) + '%') : '—') +
          '</dd></div>' +
        '</dl>';
    }
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* Panel 2: LIHTC Stock Trajectory                                 */
  /* ─────────────────────────────────────────────────────────────── */

  function _renderStockPanel() {
    if (!state.lihtcFeatures || !global.Chart) return;
    var feats = state.lihtcFeatures;

    // Year-allocated histogram → cumulative
    var years = feats.map(function (f) {
      var p = f.properties || {};
      return parseInt(p.YR_ALLOC || p.YEAR_ALLOC || p.YR_PIS || 0, 10);
    }).filter(function (y) { return y > 1985 && y <= new Date().getFullYear(); });

    var minYr = Math.min.apply(null, years) || 1987;
    var maxYr = Math.max.apply(null, years) || new Date().getFullYear();
    var yrLabels = [];
    for (var y = minYr; y <= maxYr; y++) yrLabels.push(y);

    var byYear = {};
    years.forEach(function (y) { byYear[y] = (byYear[y] || 0) + 1; });
    var perYear = yrLabels.map(function (y) { return byYear[y] || 0; });
    var cumul = perYear.reduce(function (acc, v, i) {
      acc.push((acc[i - 1] || 0) + v);
      return acc;
    }, []);

    if (state.charts.stockTimeline) state.charts.stockTimeline.destroy();

    var ctx = document.getElementById('stockTimelineChart');
    if (!ctx) return;

    state.charts.stockTimeline = new global.Chart(ctx, {
      type: 'line',
      data: {
        labels: yrLabels,
        datasets: [
          {
            label: 'Cumulative CO LIHTC projects',
            data: cumul,
            borderColor: '#096e65',
            backgroundColor: 'rgba(9,110,101,0.15)',
            fill: true,
            tension: 0.15,
            yAxisID: 'y'
          },
          {
            label: 'Annual LIHTC placements',
            data: perYear,
            type: 'bar',
            backgroundColor: 'rgba(180,83,9,0.7)',
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title:  { display: true, text: 'Colorado LIHTC stock trajectory (HUD DB)' },
          legend: { position: 'bottom' }
        },
        scales: {
          x:  { title: { display: true, text: 'Year (YR_ALLOC)' } },
          y:  { title: { display: true, text: 'Cumulative projects' }, position: 'left', beginAtZero: true },
          y1: { title: { display: true, text: 'Annual placements' }, position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } }
        }
      }
    });

    var statsEl = document.getElementById('stockStats');
    if (statsEl) {
      var totalUnits = feats.reduce(function (s, f) {
        var p = f.properties || {};
        return s + (parseInt(p.N_UNITS || p.TOTAL_UNITS || 0, 10) || 0);
      }, 0);
      var recentYears = years.filter(function (y) { return (new Date().getFullYear()) - y <= 5; });
      statsEl.innerHTML =
        '<dl class="ht-stat-list">' +
          '<div><dt>Total CO LIHTC projects</dt><dd>' + feats.length.toLocaleString() + '</dd></div>' +
          '<div><dt>Total LIHTC units</dt><dd>' + totalUnits.toLocaleString() + '</dd></div>' +
          '<div><dt>Years of data</dt><dd>' + minYr + '–' + maxYr + '</dd></div>' +
          '<div><dt>Projects placed in last 5 yrs</dt><dd>' + recentYears.length + '</dd></div>' +
        '</dl>';
    }
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* Panel 3: Peer Benchmark                                         */
  /* ─────────────────────────────────────────────────────────────── */

  function _renderCountyPicker() {
    if (!state.lihtcFeatures) return;
    var sel = document.getElementById('benchCounty');
    if (!sel) return;

    var counties = {};
    state.lihtcFeatures.forEach(function (f) {
      var p = f.properties || {};
      var nm = p.CNTY_NAME || p.COUNTY_NAME || p.COUNTY || '';
      var fips = p.CNTY_FIPS || p.COUNTY_FIPS || null;
      if (nm) counties[nm] = fips;
    });
    var names = Object.keys(counties).sort();
    sel.innerHTML = '<option value="">Select a county…</option>' + names.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
    }).join('');
  }

  function _renderBenchmark() {
    var sel = document.getElementById('benchCounty');
    var sizeEl = document.getElementById('benchUnits');
    var tbody = document.getElementById('benchTableBody');
    var summaryEl = document.getElementById('benchSummary');
    if (!sel || !tbody) return;

    var county = sel.value;
    var targetUnits = parseInt((sizeEl && sizeEl.value) || '0', 10) || 0;

    if (!county) {
      tbody.innerHTML = '<tr><td colspan="6" class="ht-empty">Select a county to see peer LIHTC projects.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    var feats = (state.lihtcFeatures || []).filter(function (f) {
      var p = f.properties || {};
      return (p.CNTY_NAME || p.COUNTY_NAME || p.COUNTY || '') === county;
    }).map(function (f) {
      var p = f.properties || {};
      return {
        name:     p.PROJECT_NAME || p.PROJECT || '(unnamed)',
        city:     p.PROJ_CTY || p.CITY || '',
        units:    parseInt(p.N_UNITS || p.TOTAL_UNITS || 0, 10) || 0,
        liUnits:  parseInt(p.LI_UNITS || 0, 10) || 0,
        yrAlloc:  parseInt(p.YR_ALLOC || p.YEAR_ALLOC || 0, 10) || null,
        yrPis:    parseInt(p.YR_PIS || 0, 10) || null,
        credit:   p.CREDIT || ''
      };
    });

    if (!feats.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="ht-empty">No LIHTC projects found in this county.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    // Sort by distance from target unit count when set; otherwise by most recent year
    if (targetUnits > 0) {
      feats.sort(function (a, b) {
        return Math.abs(a.units - targetUnits) - Math.abs(b.units - targetUnits);
      });
    } else {
      feats.sort(function (a, b) { return (b.yrAlloc || 0) - (a.yrAlloc || 0); });
    }

    // Top 20 peers
    var top = feats.slice(0, 20);
    tbody.innerHTML = top.map(function (p) {
      var unitsCell = p.units + (p.liUnits ? ' <small style="color:var(--muted)">(' + p.liUnits + ' LI)</small>' : '');
      return '<tr>' +
        '<td>' + esc(p.name) + '</td>' +
        '<td>' + esc(p.city) + '</td>' +
        '<td style="text-align:right">' + unitsCell + '</td>' +
        '<td style="text-align:right">' + (p.yrAlloc || '—') + '</td>' +
        '<td style="text-align:right">' + (p.yrPis || '—') + '</td>' +
        '<td>' + esc(p.credit || '—') + '</td>' +
      '</tr>';
    }).join('');

    if (summaryEl) {
      var totalUnits = feats.reduce(function (s, p) { return s + p.units; }, 0);
      var avgUnits = feats.length ? Math.round(totalUnits / feats.length) : 0;
      var mostRecent = Math.max.apply(null, feats.map(function (p) { return p.yrAlloc || 0; }).filter(Boolean));
      summaryEl.innerHTML =
        '<strong>' + feats.length + '</strong> LIHTC projects in ' + esc(county) +
        ' · <strong>' + totalUnits.toLocaleString() + '</strong> total units' +
        ' · avg <strong>' + avgUnits + '</strong> units/project' +
        (isFinite(mostRecent) && mostRecent > 0 ? ' · most recent allocation: <strong>' + mostRecent + '</strong>' : '');
    }
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* Public entry point                                              */
  /* ─────────────────────────────────────────────────────────────── */

  function render() {
    var chfaUrl  = 'data/policy/chfa-awards-historical.json';
    var lihtcUrl = 'data/market/hud_lihtc_co.geojson';

    Promise.all([
      _fetchJson(chfaUrl).catch(function () { return null; }),
      _fetchJson(lihtcUrl).catch(function () { return null; })
    ]).then(function (results) {
      state.awards = results[0];
      state.lihtcFeatures = results[1] && Array.isArray(results[1].features) ? results[1].features : [];

      _renderChfaPanel();
      _renderStockPanel();
      _renderCountyPicker();
      _renderBenchmark();

      // Wire benchmark controls
      var sel = document.getElementById('benchCounty');
      var unitsEl = document.getElementById('benchUnits');
      if (sel) sel.addEventListener('change', _renderBenchmark);
      if (unitsEl) {
        var deb = null;
        unitsEl.addEventListener('input', function () {
          clearTimeout(deb);
          deb = setTimeout(_renderBenchmark, 250);
        });
      }
    }).catch(function (err) {
      var container = document.getElementById('htErrorBanner');
      if (container) {
        container.hidden = false;
        container.textContent = 'Failed to load historical data: ' + (err && err.message || err);
      }
    });
  }

  global.HistoricalTrends = { render: render };
})(typeof window !== 'undefined' ? window : this);
