/**
 * js/historical-trends.js
 *
 * Renders three panels on historical-trends.html:
 *   1. Annual awards by credit type (projects or units, from the CHFA live feed)
 *      plus typical-deal tiles and QAP scoring tiles from the synthesized sample
 *   2. LIHTC stock trajectory (cumulative units by placed-in-service year)
 *   3. Peer benchmark table (given user-chosen county + unit count, find similar LIHTC projects)
 *
 * Data sources (all local, no external API):
 *   - data/policy/chfa-awards-historical.json  — synthesized 2015–2025 sample; scoring tiles only, never charted
 *   - data/chfa-lihtc.json                     — CHFA HousingTaxCreditProperties_view live export, 926 CO projects through 2025 (preferred)
 *   - data/market/hud_lihtc_co.geojson         — Legacy HUD LIHTC snapshot, 716 CO projects (YR_PIS through ~2020) — fallback only
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
    lihtcFeatures: null,  // chfa-lihtc.json features (fallback: hud_lihtc_co.geojson)
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
  /* Shared chart styling                                            */
  /* ─────────────────────────────────────────────────────────────── */

  // Series colours, validated with the dataviz palette checker (lightness
  // band, chroma floor, CVD separation, contrast) against each theme's card
  // surface. Dark mode is its own selected pair, not an automatic flip.
  var PALETTE = {
    light: { nine: '#0a9484', four: '#c2570c', other: '#8a94a3' },
    dark:  { nine: '#12a594', four: '#dd6b2a', other: '#7d8898' }
  };

  function _cssVar(name, fallback) {
    var v = (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
    return v || fallback;
  }

  // Theme is read from the rendered --card token so the manual toggle and
  // prefers-color-scheme both work. Scriptable colour options call this on
  // every chart.update(), which chart-theme.js triggers on a theme change.
  function _isDark() {
    var m = _cssVar('--card', '#ffffff').match(/^#([0-9a-f]{6})$/i);
    if (!m) return false;
    var n = parseInt(m[1], 16);
    var lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum < 0.4;
  }

  function _color(key) {
    return function () { return PALETTE[_isDark() ? 'dark' : 'light'][key]; };
  }

  function _surface() { return _cssVar('--card', '#ffffff'); }

  function _fmt(n) { return Number(n).toLocaleString(); }

  function _median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  // Credit-type buckets. CHFA writes combined executions ("4% and State",
  // "9% and State and TOC"); the federal credit is the leading token. A record
  // naming both 9% and 4% (one in the feed) and MIHTC go to "Other".
  function _creditBucket(credit) {
    var c = String(credit || '');
    var has9 = c.indexOf('9%') !== -1;
    var has4 = c.indexOf('4%') !== -1;
    if (has9 && !has4) return 'nine';
    if (has4 && !has9) return 'four';
    return 'other';
  }

  var BUCKET_LABEL = { nine: '9% competitive', four: '4% (bond-financed)', other: 'Other / mixed' };

  // Normalised project rows from the LIHTC feed. Units that are missing stay
  // null (never 0) so they are excluded from sums and medians, not counted.
  function _projects() {
    return (state.lihtcFeatures || []).map(function (f) {
      var p = f.properties || {};
      var alloc = parseInt(p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC, 10);
      var pis = parseInt(p.YR_PIS, 10);
      var units = parseInt(p.N_UNITS || p.TOTAL_UNITS, 10);
      var thisYear = new Date().getFullYear();
      return {
        alloc: alloc > 1985 && alloc <= thisYear ? alloc : null,
        pis: pis > 1985 && pis <= thisYear ? pis : null,
        units: units > 0 ? units : null,
        bucket: _creditBucket(p.CREDIT || p.TypeOfCredits)
      };
    });
  }

  function _yearRange(years) {
    var lo = Math.min.apply(null, years), hi = Math.max.apply(null, years);
    var out = [];
    for (var y = lo; y <= hi; y++) out.push(y);
    return out;
  }

  function _dataTable(elId, caption, headers, rows) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML =
      '<details class="ht-table-toggle"><summary>Show the numbers behind this chart</summary>' +
      '<div style="overflow-x:auto;"><table class="ht-bench-table ht-data-table"><caption class="sr-only">' + esc(caption) + '</caption><thead><tr>' +
      headers.map(function (h, i) { return '<th scope="col"' + (i ? ' style="text-align:right"' : '') + '>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (v, i) {
          return i ? '<td style="text-align:right">' + esc(v) + '</td>' : '<th scope="row">' + esc(v) + '</th>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div></details>';
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* Panel 1: Annual awards by credit type                           */
  /* ─────────────────────────────────────────────────────────────── */

  var awardMetric = 'projects';

  function _renderAwardsPanel() {
    if (!global.Chart) return;
    var ctx = document.getElementById('chfaTimelineChart');
    if (!ctx) return;

    var rows = _projects().filter(function (r) { return r.alloc != null; });
    if (!rows.length) return;
    var years = _yearRange(rows.map(function (r) { return r.alloc; }));
    var keys = ['nine', 'four', 'other'];
    var agg = {};
    keys.forEach(function (k) {
      agg[k] = { projects: years.map(function () { return 0; }), units: years.map(function () { return 0; }) };
    });
    rows.forEach(function (r) {
      var i = years.indexOf(r.alloc);
      agg[r.bucket].projects[i] += 1;
      if (r.units != null) agg[r.bucket].units[i] += r.units;
    });

    var metricLabel = awardMetric === 'units' ? 'Units awarded' : 'Projects awarded';

    if (state.charts.chfaTimeline) state.charts.chfaTimeline.destroy();
    state.charts.chfaTimeline = new global.Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: keys.filter(function (k) {
          return agg[k].projects.some(function (v) { return v > 0; });
        }).map(function (k) {
          return {
            label: BUCKET_LABEL[k],
            data: agg[k][awardMetric],
            backgroundColor: _color(k),
            borderColor: _surface,
            borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
            borderSkipped: false,
            barPercentage: 0.8,
            categoryPercentage: 0.9
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: {
            footerColor: function () { return _cssVar('--text', '#0d1f35'); },
            filter: function (it) { return it.parsed.y > 0; },
            callbacks: {
              label: function (c) { return ' ' + c.dataset.label + ': ' + _fmt(c.parsed.y); },
              footer: function (items) {
                var t = items.reduce(function (s, it) { return s + it.parsed.y; }, 0);
                return 'Total: ' + _fmt(t) + (awardMetric === 'units' ? ' units' : ' projects');
              }
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } },
          y: {
            stacked: true, beginAtZero: true,
            title: { display: true, text: metricLabel },
            ticks: { precision: 0, callback: function (v) { return _fmt(v); } },
            border: { display: false }
          }
        }
      }
    });

    _dataTable('chfaTable', 'Colorado LIHTC awards per year by credit type', [
      'Award year', '9% projects', '4% projects', 'Other', '9% units', '4% units', 'Other units'
    ], years.map(function (y, i) {
      return [y, agg.nine.projects[i], agg.four.projects[i], agg.other.projects[i],
        _fmt(agg.nine.units[i]), _fmt(agg.four.units[i]), _fmt(agg.other.units[i])];
    }).reverse());

    // "What a deal looks like" — last ten award years in the feed.
    var lastYr = years[years.length - 1];
    var recent = rows.filter(function (r) { return r.alloc > lastYr - 10; });
    function sizes(b) {
      return recent.filter(function (r) { return r.bucket === b && r.units != null; })
        .map(function (r) { return r.units; });
    }
    var nineN = recent.filter(function (r) { return r.bucket === 'nine'; }).length;
    var fourN = recent.filter(function (r) { return r.bucket === 'four'; }).length;
    var dealEl = document.getElementById('dealStats');
    if (dealEl) {
      var med9 = _median(sizes('nine')), med4 = _median(sizes('four'));
      dealEl.innerHTML =
        '<p class="ht-stat-caption">Typical deal, ' + (lastYr - 9) + '–' + lastYr + ' awards (CHFA live feed)</p>' +
        '<dl class="ht-stat-list">' +
          '<div><dt>Projects awarded</dt><dd>' + _fmt(recent.length) + '</dd></div>' +
          '<div><dt>Avg awards / yr</dt><dd>' + Math.round(recent.length / 10) + '</dd></div>' +
          '<div><dt>Median 9% project</dt><dd>' + (med9 != null ? med9 + ' units' : 'Unavailable') + '</dd></div>' +
          '<div><dt>Median 4% project</dt><dd>' + (med4 != null ? med4 + ' units' : 'Unavailable') + '</dd></div>' +
          '<div><dt>9% share of projects</dt><dd>' +
            (nineN + fourN ? Math.round(100 * nineN / (nineN + fourN)) + '%' : 'Unavailable') + '</dd></div>' +
        '</dl>';
    }
  }

  // QAP scoring statistics come from the synthesized awards sample — kept as
  // tiles (not a chart) and labelled as directional.
  function _renderScoringStats() {
    var statsEl = document.getElementById('chfaStats');
    if (!statsEl || !state.awards) return;
    var awards = state.awards.awards || [];
    var summary = state.awards.summary || {};
    var years = uniqueSorted((summary.yearsAnalyzed || []).concat(awards.map(function (a) { return a.year; }))
      .filter(function (y) { return typeof y === 'number' && isFinite(y); }));
    function pct(v) { return v != null ? Math.round(v * 100) + '%' : 'Unavailable'; }
    function val(v, suffix) { return v != null ? v + (suffix || '') : 'Unavailable'; }
    statsEl.innerHTML =
      '<p class="ht-stat-caption">9% QAP scoring, ' +
        (years.length ? years[0] + '–' + years[years.length - 1] : 'years unavailable') +
        ' — synthesized sample, directional only</p>' +
      '<dl class="ht-stat-list">' +
        '<div><dt>Avg applications / yr</dt><dd>' + val(summary.avgApplicationsPerYear) + '</dd></div>' +
        '<div><dt>Award rate</dt><dd>' + pct(summary.awardRate) + '</dd></div>' +
        '<div><dt>Average score</dt><dd>' + val(summary.avgScore, ' / 100') + '</dd></div>' +
        '<div><dt>Median score</dt><dd>' + val(summary.medianScore, ' / 100') + '</dd></div>' +
        '<div><dt>Family win rate</dt><dd>' + pct(summary.familyWinRate) + '</dd></div>' +
      '</dl>';
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* Panel 2: LIHTC Stock Trajectory                                 */
  /* ─────────────────────────────────────────────────────────────── */

  function _renderStockPanel() {
    if (!state.lihtcFeatures || !global.Chart) return;
    var ctx = document.getElementById('stockTimelineChart');
    if (!ctx) return;

    var rows = _projects().filter(function (r) { return r.pis != null; });
    if (!rows.length) return;
    var years = _yearRange(rows.map(function (r) { return r.pis; }));
    var unitsByYr = years.map(function () { return 0; });
    var projByYr = years.map(function () { return 0; });
    rows.forEach(function (r) {
      var i = years.indexOf(r.pis);
      projByYr[i] += 1;
      if (r.units != null) unitsByYr[i] += r.units;
    });
    var cumUnits = [], cumProj = [], u = 0, n = 0;
    years.forEach(function (_, i) { u += unitsByYr[i]; n += projByYr[i]; cumUnits.push(u); cumProj.push(n); });

    if (state.charts.stockTimeline) state.charts.stockTimeline.destroy();
    state.charts.stockTimeline = new global.Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [{
          label: 'Units in LIHTC projects placed in service (cumulative)',
          data: cumUnits,
          borderColor: _color('nine'),
          backgroundColor: function () { return _isDark() ? 'rgba(18,165,148,0.14)' : 'rgba(10,148,132,0.12)'; },
          fill: 'origin',
          borderWidth: 2,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: _surface
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            footerColor: function () { return _cssVar('--muted', '#374151'); },
            footerFont: { weight: 'normal' },
            callbacks: {
              title: function (items) { return 'Through ' + items[0].label; },
              label: function (c) { return ' ' + _fmt(cumUnits[c.dataIndex]) + ' units in ' + _fmt(cumProj[c.dataIndex]) + ' projects'; },
              footer: function (items) {
                var i = items[0].dataIndex;
                return '+' + _fmt(unitsByYr[i]) + ' units in ' + _fmt(projByYr[i]) + ' projects that year';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 16 } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Units (cumulative)' },
            ticks: { callback: function (v) { return _fmt(v); } },
            border: { display: false }
          }
        }
      }
    });

    _dataTable('stockTable', 'Colorado LIHTC projects and units by placed-in-service year',
      ['Year placed in service', 'Projects', 'Units', 'Cumulative projects', 'Cumulative units'],
      years.map(function (y, i) {
        return [y, projByYr[i], _fmt(unitsByYr[i]), _fmt(cumProj[i]), _fmt(cumUnits[i])];
      }).reverse());

    var statsEl = document.getElementById('stockStats');
    if (statsEl) {
      var lastYr = years[years.length - 1];
      var recent = rows.filter(function (r) { return r.pis > lastYr - 5; });
      var recentUnits = recent.reduce(function (s, r) { return s + (r.units || 0); }, 0);
      statsEl.innerHTML =
        '<dl class="ht-stat-list">' +
          '<div><dt>Total CO LIHTC projects</dt><dd>' + _fmt(state.lihtcFeatures.length) + '</dd></div>' +
          '<div><dt>Total LIHTC units</dt><dd>' + _fmt(u) + '</dd></div>' +
          '<div><dt>Years of data</dt><dd>' + years[0] + '–' + lastYr + '</dd></div>' +
          '<div><dt>Placed in service ' + (lastYr - 4) + '–' + lastYr + '</dt><dd>' +
            _fmt(recent.length) + ' projects · ' + _fmt(recentUnits) + ' units</dd></div>' +
        '</dl>';
    }
  }

  function _wireAwardToggle() {
    var btns = document.querySelectorAll('[data-award-metric]');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        awardMetric = b.getAttribute('data-award-metric');
        Array.prototype.forEach.call(btns, function (o) {
          o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
        });
        _renderAwardsPanel();
      });
    });
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
    var chfaUrl       = 'data/policy/chfa-awards-historical.json';
    // Prefer the fresh CHFA LIHTC cache (926 projects through 2025). Fall
    // back to the legacy HUD geojson snapshot (716 projects, last fresh
    // YR_PIS=2020) only if CHFA is unavailable. Inverted in F7 (2026-05-26)
    // — previously HUD was the sole source, so the stock-trajectory chart
    // under-reported recent allocations.
    var lihtcUrlPrimary  = 'data/chfa-lihtc.json';
    var lihtcUrlFallback = 'data/market/hud_lihtc_co.geojson';

    function fetchLihtc() {
      return _fetchJson(lihtcUrlPrimary).catch(function () {
        return _fetchJson(lihtcUrlFallback).catch(function () { return null; });
      });
    }

    Promise.all([
      _fetchJson(chfaUrl).catch(function () { return null; }),
      fetchLihtc()
    ]).then(function (results) {
      state.awards = results[0];
      state.lihtcFeatures = results[1] && Array.isArray(results[1].features) ? results[1].features : [];

      _renderAwardsPanel();
      _renderScoringStats();
      _renderStockPanel();
      _wireAwardToggle();
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
