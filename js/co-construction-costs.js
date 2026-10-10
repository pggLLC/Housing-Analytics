/**
 * co-construction-costs.js — Construction Labor & Costs tab on colorado-deep-dive.html.
 *
 * Two panels, kept apart on purpose:
 *   Labor     — data/market/co-construction-labor-cost.json (BLS CES, LAUS,
 *               JOLTS, OEWS; refreshed monthly by
 *               .github/workflows/fetch-co-construction-labor-cost.yml).
 *   Materials — data/fred-data.json (BLS PPI via FRED, refreshed daily). The
 *               labor-cost file names which PPI series to show, so the list of
 *               materials lives in one place.
 *
 * A missing value renders as "Value unavailable", never as 0.
 */
(function (global) {
  'use strict';

  var LABOR_FILE = 'market/co-construction-labor-cost.json';
  var FRED_FILE = 'fred-data.json';
  var UNAVAILABLE = 'Value unavailable';
  var started = false;

  function dataUrl(key) {
    if (global.DataService && typeof global.DataService.baseData === 'function') return global.DataService.baseData(key);
    return 'data/' + key;
  }

  function fetchJSON(key) {
    return fetch(dataUrl(key)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + key);
      return r.json();
    });
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function fmtPct(v, digits) {
    if (!isNum(v)) return UNAVAILABLE;
    var d = digits == null ? 1 : digits;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  }

  function fmtPts(v) {
    if (!isNum(v)) return UNAVAILABLE;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' pts';
  }

  function fmtChange(yoy) {
    if (!yoy || !isNum(yoy.value)) return UNAVAILABLE;
    return yoy.basis === 'pts' ? fmtPts(yoy.value) : fmtPct(yoy.value);
  }

  function fmtValue(v, unit) {
    if (!isNum(v)) return UNAVAILABLE;
    if (unit === 'usd_per_hour') return '$' + v.toFixed(2);
    if (unit === 'usd_per_week') return '$' + Math.round(v).toLocaleString('en-US');
    if (unit === 'thousands') return v.toFixed(1) + 'K';
    if (unit === 'percent') return v.toFixed(1) + '%';
    return v.toLocaleString('en-US');
  }

  function monthLabel(period) {
    if (!period || !/^\d{4}-\d{2}$/.test(period)) return period || '';
    var parts = period.split('-');
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, 1));
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function setStatus(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    if (text) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
  }

  function kpiCard(label, value, sub) {
    return '<div class="mi-kpi"><div class="mi-kpi-value">' + escapeHtml(value) + '</div>' +
      '<div class="mi-kpi-label">' + escapeHtml(label) + '</div>' +
      (sub ? '<div class="mi-kpi-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';
  }

  /* ── Labor ─────────────────────────────────────────────────────── */
  var LABOR_KPIS = [
    { id: 'SMU08000002000000003', label: 'CO construction hourly earnings' },
    { id: 'SMU08000002000000011', label: 'CO construction weekly earnings' },
    { id: 'SMU08000002000000001', label: 'CO construction jobs' },
    { id: 'LASST080000000000003', label: 'CO unemployment rate' },
    { id: 'JTU230000000000000JOR', label: 'U.S. construction job openings rate' },
    { id: 'JTU230000000000000HIR', label: 'U.S. construction hires rate' }
  ];

  function renderLaborKpis(d) {
    var el = document.getElementById('ccLaborKpis');
    if (!el) return;
    var monthly = (d && d.monthly) || {};
    el.innerHTML = LABOR_KPIS.map(function (k) {
      var s = monthly[k.id];
      if (!s || !s.latest) {
        return kpiCard(k.label, UNAVAILABLE, (s && s.unavailableReason) || 'Not in this month’s file');
      }
      var sub = fmtChange(s.yoy) + ' vs a year earlier · ' + monthLabel(s.latest.period) +
        (s.latest.preliminary ? ' (preliminary)' : '');
      return kpiCard(k.label, fmtValue(s.latest.value, s.unit), sub);
    }).join('');
  }

  function lastN(obs, n) { return (obs || []).slice(-n); }

  function renderLaborChart(d) {
    var canvas = document.getElementById('ccLaborChart');
    var monthly = (d && d.monthly) || {};
    var ahe = monthly.SMU08000002000000003;
    var emp = monthly.SMU08000002000000001;
    if (!canvas || !global.Chart || !ahe || !emp || !(ahe.observations || []).length) {
      setStatus('ccLaborStatus', 'The labor chart is unavailable: the monthly earnings series did not load.');
      return;
    }
    var a = lastN(ahe.observations, 60);
    var byPeriod = {};
    (emp.observations || []).forEach(function (o) { byPeriod[o.period] = o.value; });
    var labels = a.map(function (o) { return o.period; });
    var c1 = cssVar('--chart-1', '#096e65');
    var c2 = cssVar('--chart-2', '#c2410c');
    new global.Chart(canvas, {
      type: 'line',
      data: {
        labels: labels.map(monthLabel),
        datasets: [
          { label: 'Avg hourly earnings ($)', data: a.map(function (o) { return isNum(o.value) ? o.value : null; }),
            borderColor: c1, backgroundColor: c1, yAxisID: 'y', pointRadius: 0, borderWidth: 2, spanGaps: false },
          { label: 'Construction jobs (thousands)', data: labels.map(function (p) { return isNum(byPeriod[p]) ? byPeriod[p] : null; }),
            borderColor: c2, backgroundColor: c2, yAxisID: 'y1', pointRadius: 0, borderWidth: 2, borderDash: [5, 3], spanGaps: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { title: { display: true, text: 'Month' }, ticks: { maxTicksLimit: 8 } },
          y: { position: 'left', title: { display: true, text: 'Hourly earnings ($)' },
               ticks: { callback: function (v) { return '$' + v; } } },
          y1: { position: 'right', title: { display: true, text: 'Jobs (thousands)' }, grid: { drawOnChartArea: false } }
        }
      }
    });
    var first = a[0], last = a[a.length - 1];
    var text = document.getElementById('ccLaborChartText');
    if (text && first && last) {
      text.textContent = 'Colorado construction average hourly earnings went from ' + fmtValue(first.value, 'usd_per_hour') +
        ' in ' + monthLabel(first.period) + ' to ' + fmtValue(last.value, 'usd_per_hour') + ' in ' + monthLabel(last.period) + '.';
    }
  }

  function renderTradeTable(d) {
    var head = document.getElementById('ccTradeHead');
    var body = document.getElementById('ccTradeBody');
    var heading = document.getElementById('ccTradeHeading');
    var o = d && d.oews;
    if (!head || !body) return;
    if (!o || !Array.isArray(o.rows) || !o.rows.length) {
      body.innerHTML = '<tr><td>' + UNAVAILABLE + ': the OEWS trade wages did not load.</td></tr>';
      return;
    }
    if (heading && o.referencePeriod) heading.textContent = 'Hourly wage by trade, ' + o.referencePeriod;
    var areas = o.areas || [];
    var index = {};
    o.rows.forEach(function (r) { index[r.area + '|' + r.soc] = r; });
    var state = areas[0];
    head.innerHTML = '<th scope="col">Trade</th>' + areas.map(function (a) {
      return '<th scope="col">' + escapeHtml(a.name) + '</th>';
    }).join('') + (state ? '<th scope="col">' + escapeHtml(state.name) + ' change</th>' : '');
    body.innerHTML = (o.occupations || []).map(function (occ) {
      var cells = areas.map(function (a) {
        var r = index[a.code + '|' + occ.soc];
        return '<td>' + (r && isNum(r.hourlyMean) ? '$' + r.hourlyMean.toFixed(2) : '<span title="' +
          escapeHtml((r && r.unavailableReason) || 'Not published') + '">—</span>') + '</td>';
      }).join('');
      var sr = state && index[state.code + '|' + occ.soc];
      var change = state ? '<td>' + (sr && isNum(sr.changePct) ? fmtPct(sr.changePct) : '—') + '</td>' : '';
      return '<tr><th scope="row">' + escapeHtml(occ.title) + '</th>' + cells + change + '</tr>';
    }).join('');
  }

  /* ── Materials ─────────────────────────────────────────────────── */
  function toMonthly(observations) {
    return (observations || []).map(function (o) {
      var v = o.value === '.' || o.value == null || o.value === '' ? null : parseFloat(o.value);
      return { period: String(o.date).slice(0, 7), value: isNum(v) && v > 0 ? v : null };
    });
  }

  function renderMaterials(d, fred) {
    var kpis = document.getElementById('ccMaterialsKpis');
    var list = (d && d.materials && d.materials.series) || [];
    var series = (fred && fred.series) || {};
    if (kpis) {
      kpis.innerHTML = list.map(function (m) {
        var sub = isNum(m.yoyPct) ? fmtPct(m.yoyPct) + ' vs a year earlier · ' + monthLabel(m.latestPeriod) : 'Year-over-year change unavailable';
        return kpiCard(m.label, isNum(m.yoyPct) ? fmtPct(m.yoyPct) : UNAVAILABLE, sub);
      }).join('') || kpiCard('Construction input prices', UNAVAILABLE, 'The materials list did not load');
    }

    var canvas = document.getElementById('ccMaterialsChart');
    if (!canvas || !global.Chart || !list.length) {
      setStatus('ccMaterialsStatus', 'The materials chart is unavailable: the price index data did not load.');
      return;
    }
    // Headline first, then up to four materials, so the chart stays readable.
    var shown = list.slice(0, 5);
    var palette = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];
    var fallbacks = ['#096e65', '#c2410c', '#1d4ed8', '#7c3aed', '#a16207'];
    var labels = null;
    var datasets = [];
    shown.forEach(function (m, i) {
      var s = series[m.id];
      if (!s) return;
      var obs = toMonthly(s.observations).slice(-61);
      if (!labels) labels = obs.map(function (o) { return o.period; });
      var byPeriod = {};
      obs.forEach(function (o) { byPeriod[o.period] = o.value; });
      var base = byPeriod[labels[0]];
      if (!isNum(base)) return; // cannot rebase without a starting value; leave it out rather than invent one
      var color = cssVar(palette[i], fallbacks[i]);
      datasets.push({
        label: m.label,
        data: labels.map(function (p) { return isNum(byPeriod[p]) ? +(byPeriod[p] / base * 100).toFixed(1) : null; }),
        borderColor: color, backgroundColor: color, pointRadius: 0,
        borderWidth: i === 0 ? 3 : 1.5, borderDash: i === 0 ? [] : [4, 3], spanGaps: false
      });
    });
    if (!labels || !datasets.length) {
      setStatus('ccMaterialsStatus', 'The materials chart is unavailable: the price index data did not load.');
      return;
    }
    new global.Chart(canvas, {
      type: 'line',
      data: { labels: labels.map(monthLabel), datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { title: { display: true, text: 'Month' }, ticks: { maxTicksLimit: 8 } },
          y: { title: { display: true, text: 'Index (' + monthLabel(labels[0]) + ' = 100)' } }
        }
      }
    });
    var text = document.getElementById('ccMaterialsChartText');
    if (text) {
      text.textContent = 'Construction input price indexes rebased to ' + monthLabel(labels[0]) + ' = 100: ' +
        datasets.map(function (ds) {
          var last = ds.data[ds.data.length - 1];
          return ds.label + ' ' + (isNum(last) ? last : UNAVAILABLE);
        }).join('; ') + '.';
    }
  }

  /* ── Summary + history ─────────────────────────────────────────── */
  function renderSummary(d) {
    var el = document.getElementById('ccSummary');
    var gen = document.getElementById('ccGenerated');
    if (el) el.textContent = (d && d.summary && d.summary.text) || 'The monthly summary is unavailable.';
    if (gen && d && d.generatedAt) {
      gen.textContent = 'Last refreshed ' + new Date(d.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + '.';
    }
  }

  function renderHistory(d) {
    var body = document.getElementById('ccHistoryBody');
    if (!body) return;
    var rows = ((d && d.history) || []).slice(-12).reverse();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4">' + UNAVAILABLE + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      return '<tr><th scope="row">' + escapeHtml(monthLabel(r.period)) + '</th><td>' + fmtPct(r.laborWageYoyPct) +
        '</td><td>' + fmtPct(r.employmentYoyPct) + '</td><td>' + fmtPct(r.materialsYoyPct) + '</td></tr>';
    }).join('');
  }

  function init() {
    if (started) return;
    started = true;
    var fred = fetchJSON(FRED_FILE).catch(function () { return null; });
    fetchJSON(LABOR_FILE).then(function (d) {
      renderSummary(d);
      renderLaborKpis(d);
      renderLaborChart(d);
      renderTradeTable(d);
      renderHistory(d);
      return fred.then(function (f) { renderMaterials(d, f); });
    }).catch(function (err) {
      console.warn('[co-construction-costs] load failed:', err);
      var el = document.getElementById('ccSummary');
      if (el) el.textContent = 'Construction labor and cost data could not be loaded.';
      setStatus('ccLaborStatus', 'Labor data unavailable.');
      setStatus('ccMaterialsStatus', 'Materials data unavailable.');
    });
  }

  global.CoConstructionCosts = { init: init, _fmtPct: fmtPct, _toMonthly: toMonthly };

  // Opened straight onto the tab (e.g. #tab-construction): the tab script has
  // already revealed it, so draw now.
  function maybeInit() {
    var panel = document.getElementById('tab-construction');
    if (panel && !panel.hasAttribute('hidden')) init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeInit);
  else maybeInit();
})(window);
