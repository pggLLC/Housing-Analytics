/**
 * js/lihtc-project-size.js
 *
 * The Project Size panel of the Historical Trends tab
 * (colorado-deep-dive.html#tab-history): how many units Colorado LIHTC
 * projects have, by award period, credit type, size band and county.
 *
 * Source: data/chfa-lihtc.json (CHFA HousingTaxCreditProperties_view), the
 * same feed as the other Historical Trends panels. Years are CHFA award
 * (credit reservation) years, not opening years. A project whose unit count
 * is missing is excluded and counted in the disclosure, never treated as 0.
 *
 * Exposes window.LihtcProjectSize.render() (the page calls it once, on the
 * tab's first reveal) and .compute(features) for tests.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LihtcProjectSize = api;
})(typeof window !== 'undefined' ? window : null, function (global) {
  'use strict';

  var PERIOD_YEARS = 5;
  // Upper bounds are inclusive; the last band is open-ended.
  var BANDS = [
    { label: 'Under 25 units', max: 24 },
    { label: '25–49 units', max: 49 },
    { label: '50–99 units', max: 99 },
    { label: '100–199 units', max: 199 },
    { label: '200 units or more', max: Infinity }
  ];
  // Same tokens as the awards chart, so 9% and 4% keep their colours across panels.
  var TOKENS = { nine: '--chart-3', four: '--chart-6' };
  var LABEL = { nine: '9% competitive', four: '4% (bond-financed)' };

  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }
  function sum(arr) { return arr.reduce(function (n, v) { return n + v; }, 0); }
  function bandIndex(units) {
    for (var i = 0; i < BANDS.length; i++) if (units <= BANDS[i].max) return i;
    return BANDS.length - 1;
  }

  // Projects are LihtcByYear.projects() rows plus urbanRural, read from the same features.
  function compute(features, byYear) {
    byYear = byYear || (global && global.LihtcByYear);
    if (!byYear) return { unavailableReason: 'CHFA LIHTC series unavailable' };
    var all = byYear.projects(features).map(function (r, i) {
      var p = (features[i] && features[i].properties) || {};
      r.urbanRural = /^(urban|rural)$/i.test(p.UrbanRural || '') ? p.UrbanRural.charAt(0).toUpperCase() + p.UrbanRural.slice(1).toLowerCase() : null;
      return r;
    });
    var rows = all.filter(function (r) { return r.alloc != null && r.units != null; });
    var excluded = all.length - rows.length;
    if (!rows.length) return { unavailableReason: 'No dated CHFA projects with a unit count', excluded: excluded };

    var lo = Math.min.apply(null, rows.map(function (r) { return r.alloc; }));
    var hi = Math.max.apply(null, rows.map(function (r) { return r.alloc; }));
    // Five-year periods ending at the latest award year; the earliest may be shorter.
    var periods = [];
    for (var end = hi; end >= lo; end -= PERIOD_YEARS) {
      var start = Math.max(lo, end - PERIOD_YEARS + 1);
      periods.unshift({ start: start, end: end, label: start === end ? String(start) : start + '–' + end });
    }
    periods.forEach(function (pd) {
      var inP = rows.filter(function (r) { return r.alloc >= pd.start && r.alloc <= pd.end; });
      pd.projects = inP.length;
      pd.units = sum(inP.map(function (r) { return r.units; }));
      pd.median = median(inP.map(function (r) { return r.units; }));
      ['nine', 'four'].forEach(function (k) {
        var u = inP.filter(function (r) { return r.bucket === k; }).map(function (r) { return r.units; });
        pd[k] = { projects: u.length, median: median(u) };
      });
    });

    var bands = BANDS.map(function (b) { return { label: b.label, projects: 0, units: 0, nine: 0, four: 0, other: 0 }; });
    rows.forEach(function (r) {
      var b = bands[bandIndex(r.units)];
      b.projects += 1; b.units += r.units; b[r.bucket] += 1;
    });

    var counties = {};
    rows.forEach(function (r) {
      var name = r.county || 'County not recorded';
      (counties[name] = counties[name] || []).push(r.units);
    });
    var countyRows = Object.keys(counties).map(function (name) {
      var u = counties[name];
      return { county: name, projects: u.length, units: sum(u), average: Math.round(sum(u) / u.length), median: median(u), largest: Math.max.apply(null, u) };
    }).sort(function (a, b) { return b.projects - a.projects || b.units - a.units || a.county.localeCompare(b.county); });

    var setting = {};
    ['Urban', 'Rural'].forEach(function (k) {
      var u = rows.filter(function (r) { return r.urbanRural === k; }).map(function (r) { return r.units; });
      setting[k] = { projects: u.length, median: median(u) };
    });

    return {
      range: lo + '–' + hi,
      projects: rows.length,
      units: sum(rows.map(function (r) { return r.units; })),
      median: median(rows.map(function (r) { return r.units; })),
      excluded: excluded,
      periods: periods,
      bands: bands,
      counties: countyRows,
      setting: setting
    };
  }

  /* ── Rendering ─────────────────────────────────────────────── */

  var chart = null;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
  function cssVar(name, fallback) {
    var v = (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
    return v || fallback;
  }
  function color(key) { return function () { return cssVar(TOKENS[key], '#096e65'); }; }

  function table(caption, headers, rows) {
    return '<div style="overflow-x:auto;"><table class="ht-bench-table ht-data-table"><caption class="sr-only">' + esc(caption) + '</caption><thead><tr>' +
      headers.map(function (h, i) { return '<th scope="col"' + (i ? ' style="text-align:right"' : '') + '>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (v, i) {
          return i ? '<td style="text-align:right">' + esc(v) + '</td>' : '<th scope="row">' + esc(v) + '</th>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function show(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

  function draw(result) {
    var heading = document.getElementById('htSizeHeading');
    if (heading) {
      heading.textContent = 'LIHTC Project Size' + (result.range ? ' (' + result.range + ')' : ' — unavailable');
      heading.dataset.yearRange = result.range || '';
    }
    var note = document.getElementById('htSizeStatus');
    if (result.unavailableReason) {
      if (note) { note.hidden = false; note.textContent = 'Project size analysis unavailable: ' + result.unavailableReason + '.'; }
      return;
    }
    if (note) {
      note.hidden = !result.excluded;
      note.textContent = result.excluded ? fmt(result.excluded) + ' projects without an award year or unit count are left out of these figures.' : '';
    }

    show('sizeStats',
      '<dl class="ht-stat-list">' +
        '<div><dt>Median project, all years</dt><dd>' + fmt(result.median) + ' units</dd></div>' +
        '<div><dt>Median urban project</dt><dd>' + fmt(result.setting.Urban.median) + ' units</dd></div>' +
        '<div><dt>Median rural project</dt><dd>' + fmt(result.setting.Rural.median) + ' units</dd></div>' +
        '<div><dt>Projects of 100+ units</dt><dd>' + fmt(result.bands[3].projects + result.bands[4].projects) + ' of ' + fmt(result.projects) + '</dd></div>' +
      '</dl>');

    var ctx = document.getElementById('sizeByPeriodChart');
    if (ctx && global.Chart) {
      if (chart) chart.destroy();
      var labels = result.periods.map(function (p) { return p.label; });
      chart = new global.Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: ['nine', 'four'].map(function (k) {
            return {
              label: LABEL[k],
              data: result.periods.map(function (p) { return p[k].median; }),
              backgroundColor: color(k),
              borderRadius: 4,
              borderSkipped: 'start',
              maxBarThickness: 36
            };
          })
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12 } },
            tooltip: {
              callbacks: {
                title: function (items) { return 'Awarded ' + items[0].label; },
                label: function (c) {
                  var p = result.periods[c.dataIndex][c.datasetIndex === 0 ? 'nine' : 'four'];
                  return ' ' + c.dataset.label + ': ' + (p.median == null ? 'no projects' : 'median ' + fmt(p.median) + ' units (' + fmt(p.projects) + ' projects)');
                }
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
            y: { beginAtZero: true, title: { display: true, text: 'Median units per project' }, border: { display: false } }
          }
        }
      });
    }

    show('sizePeriodTable',
      '<details class="ht-table-toggle"><summary>Show the numbers behind this chart</summary>' +
      table('Colorado LIHTC project size by award period',
        ['Award period', 'Projects', 'Units', 'Median, all', 'Median 9% (projects)', 'Median 4% (projects)'],
        result.periods.slice().reverse().map(function (p) {
          return [p.label, fmt(p.projects), fmt(p.units), fmt(p.median),
            p.nine.median == null ? '—' : fmt(p.nine.median) + ' (' + p.nine.projects + ')',
            p.four.median == null ? '—' : fmt(p.four.median) + ' (' + p.four.projects + ')'];
        })) + '</details>');

    show('sizeBandTable',
      '<p class="ht-stat-caption">Projects by size, ' + esc(result.range) + '</p>' +
      table('Colorado LIHTC projects by size band and credit type',
        ['Size', 'Projects', 'Share of projects', 'Units', '9%', '4%', 'Other / mixed'],
        result.bands.map(function (b) {
          return [b.label, fmt(b.projects), Math.round(100 * b.projects / result.projects) + '%', fmt(b.units), fmt(b.nine), fmt(b.four), fmt(b.other)];
        })));

    show('sizeCountyTable',
      '<details class="ht-table-toggle"><summary>Project size by county (' + result.counties.length + ' counties with LIHTC projects)</summary>' +
      table('Colorado LIHTC project size by county',
        ['County', 'Projects', 'Units', 'Average units', 'Median units', 'Largest project'],
        result.counties.map(function (c) {
          return [c.county, fmt(c.projects), fmt(c.units), fmt(c.average), fmt(c.median), fmt(c.largest)];
        })) + '</details>');
  }

  function render() {
    var url = typeof global.resolveAssetUrl === 'function' ? global.resolveAssetUrl('data/chfa-lihtc.json') : 'data/chfa-lihtc.json';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      draw(compute(d && Array.isArray(d.features) ? d.features : []));
    }).catch(function () {
      draw({ unavailableReason: 'the CHFA LIHTC feed could not be loaded' });
    });
  }

  return { compute: compute, render: render, BANDS: BANDS };
});
