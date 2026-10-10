/**
 * funding-vs-need.js — Funding vs Need tab on colorado-deep-dive.html.
 *
 * Reads data/derived/funding-vs-need.json (scripts/funding/build_funding_vs_need.mjs,
 * a step of the derived chain), which joins the award ledger parsed weekly from
 * CHFA and Prop 123 award PDFs (.github/workflows/funding-awards.yml) to the
 * need and vacancy fields of the ranking index. The rent-advantage chart is
 * computed here from data/market/zori_rents_co.json, because ZORI is committed
 * by a workflow that does not run the derived chain.
 *
 * A missing value renders as "Value unavailable" with its reason, never as 0.
 */
(function (global) {
  'use strict';

  var FILE = 'derived/funding-vs-need.json';
  var ZORI_FILE = 'market/zori_rents_co.json';
  var UNAVAILABLE = 'Value unavailable';
  var started = false;
  var rows = [];
  var sortKey = 'gap_per_1000';
  var sortDir = -1;

  // Plain-language names for the four quadrants the builder assigns.
  // Fixed hues rather than --chart-N: the theme's first chart colours are close
  // blues, and these four groups must be told apart at a glance.
  var QUADRANTS = {
    'underserved': { label: 'High need, less funding', color: '#c2410c' },
    'aligned': { label: 'High need, more funding', color: '#0f766e' },
    'funded-above-need': { label: 'Lower need, more funding', color: '#7c3aed' },
    'low-need-low-funding': { label: 'Lower need, less funding', color: '#64748b' }
  };
  var FLAG_LABELS = { 'high-vacancy': 'High vacancy', 'building-ahead': 'Building ahead of growth' };

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
  function fmtInt(v) { return isNum(v) ? Math.round(v).toLocaleString('en-US') : UNAVAILABLE; }
  function fmtNum(v, d) { return isNum(v) ? v.toFixed(d == null ? 1 : d) : UNAVAILABLE; }
  function fmtPct(v, d) { return isNum(v) ? v.toFixed(d == null ? 1 : d) + '%' : UNAVAILABLE; }
  function fmtMoney(v) {
    if (!isNum(v)) return UNAVAILABLE;
    var a = Math.abs(v);
    var s = a >= 1e6 ? '$' + (a / 1e6).toFixed(1) + 'M' : '$' + Math.round(a).toLocaleString('en-US');
    return v < 0 ? '−' + s : s;
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

  function quadrantColor(q) {
    return QUADRANTS[q] ? QUADRANTS[q].color : cssVar('--muted', '#64748b');
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setStatus(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
  }

  function shortName(name) { return String(name || '').replace(/ County$/, ''); }

  // A value with its unavailable reason, as one cell's text.
  function withReason(value, reason, fmt) {
    if (isNum(value)) return fmt(value);
    return UNAVAILABLE + (reason ? ' (' + reason + ')' : '');
  }

  function renderSummary(d) {
    var s = d.statewide || {};
    var w = (d.meta && d.meta.window) || {};
    var q = s.quadrants || {};
    var soft = s.counties_soft_and_funded || [];
    setText('fvnSummary',
      'From ' + w.first_year + ' to ' + w.last_year + ', CHFA awarded housing tax credits to ' + fmtInt(s.tax_credit_awards) +
      ' projects with ' + fmtInt(s.lihtc_units) + ' LIHTC units, and the Prop 123 financing fund selected ' + fmtInt(s.prop123_awards) +
      ' awards worth ' + fmtMoney(s.prop123_dollars) + '. ' + fmtInt(q.underserved) + ' counties have above-median need and below-median funding for it; ' +
      soft.length + ' funded counties show both soft-market signals at once.');
    if (d.meta && d.meta.generatedAt) {
      setText('fvnGenerated', 'Built ' + new Date(d.meta.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) + '.');
    }
  }

  function renderKpis(d) {
    var el = document.getElementById('fvnKpis');
    if (!el) return;
    var s = d.statewide || {};
    var w = (d.meta && d.meta.window) || {};
    var items = [
      [fmtInt(s.lihtc_units), 'LIHTC units awarded', w.first_year + '–' + w.last_year + ', ' + fmtInt(s.tax_credit_awards) + ' credit awards'],
      [fmtMoney(s.prop123_dollars), 'Prop 123 fund awards', fmtInt(s.prop123_awards) + ' selections since FY23-24'],
      [fmtPct(s.prop123_mixed_income_share_pct), 'Prop 123 dollars to mixed-income', 'A catalyst signal, not a flaw'],
      [fmtInt((s.quadrants || {}).underserved), 'High need, less funding', 'Counties, split at the medians'],
      [fmtInt((s.counties_soft_and_funded || []).length), 'Soft and funded', 'Both soft-market flags and LIHTC awards']
    ];
    el.innerHTML = items.map(function (k) {
      return '<div class="mi-kpi"><div class="mi-kpi-value">' + escapeHtml(k[0]) + '</div><div class="mi-kpi-label">' +
        escapeHtml(k[1]) + '</div><div class="mi-kpi-sub">' + escapeHtml(k[2]) + '</div></div>';
    }).join('');
  }

  function renderScatter(d) {
    var canvas = document.getElementById('fvnScatter');
    var split = (d.meta && d.meta.quadrant_split) || {};
    var plotted = d.counties.filter(function (c) {
      return isNum(c.need.gap_per_1000_residents) && isNum(c.funding.lihtc_units_per_100_gap) && c.quadrant;
    });
    if (!canvas || !global.Chart || !plotted.length) {
      setStatus('fvnScatterStatus', 'The need and funding chart is unavailable: the county data did not load.');
      return;
    }
    var maxX = Math.max.apply(null, plotted.map(function (c) { return c.need.gap_per_1000_residents; }));
    var maxY = Math.max.apply(null, plotted.map(function (c) { return c.funding.lihtc_units_per_100_gap; }));
    var datasets = Object.keys(QUADRANTS).map(function (q) {
      var col = quadrantColor(q);
      return {
        label: QUADRANTS[q].label,
        data: plotted.filter(function (c) { return c.quadrant === q; }).map(function (c) {
          return { x: c.need.gap_per_1000_residents, y: c.funding.lihtc_units_per_100_gap, name: c.name };
        }),
        backgroundColor: col, borderColor: col, pointRadius: 5, pointHoverRadius: 7
      };
    });
    var guide = cssVar('--muted', '#64748b');
    if (isNum(split.gap_per_1000_residents)) {
      datasets.push({ type: 'line', label: 'Median need', data: [{ x: split.gap_per_1000_residents, y: 0 }, { x: split.gap_per_1000_residents, y: maxY }],
        borderColor: guide, borderDash: [4, 4], borderWidth: 1, pointRadius: 0, showLine: true });
    }
    if (isNum(split.lihtc_units_per_100_gap)) {
      datasets.push({ type: 'line', label: 'Median funding', data: [{ x: 0, y: split.lihtc_units_per_100_gap }, { x: maxX, y: split.lihtc_units_per_100_gap }],
        borderColor: guide, borderDash: [4, 4], borderWidth: 1, pointRadius: 0, showLine: true });
    }
    new global.Chart(canvas, {
      type: 'scatter',
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            filter: function (item) { return !!(item.raw && item.raw.name); },
            callbacks: {
              label: function (ctx) {
                return ctx.raw.name + ': need ' + ctx.raw.x.toFixed(1) + ' per 1,000 residents, ' + ctx.raw.y.toFixed(1) + ' units per 100 gap households';
              }
            }
          }
        },
        scales: {
          x: { type: 'linear', min: 0, title: { display: true, text: '≤30% AMI gap per 1,000 residents' } },
          y: { type: 'linear', min: 0, title: { display: true, text: 'Units per 100 gap households' } }
        }
      }
    });
    var counts = {};
    plotted.forEach(function (c) { counts[c.quadrant] = (counts[c.quadrant] || 0) + 1; });
    setText('fvnScatterText', 'Scatter of ' + plotted.length + ' counties. ' + Object.keys(QUADRANTS).map(function (q) {
      return QUADRANTS[q].label + ': ' + (counts[q] || 0);
    }).join('; ') + '.');
  }

  function renderRentAdvantage(d, zori) {
    var canvas = document.getElementById('fvnRentChart');
    var z = zori && zori.counties;
    if (!canvas || !global.Chart || !z) {
      setStatus('fvnRentStatus', 'The rent comparison is unavailable: the Zillow rent file did not load.');
      return;
    }
    var pts = d.counties.map(function (c) {
      var m = z[c.fips];
      var cap = c.market.chfa_60ami_max_rent_2br;
      if (!m || !isNum(m.rent) || m.rent <= 0 || !isNum(cap) || cap <= 0) return null;
      return { name: shortName(c.name), gap: m.rent - cap, market: m.rent, cap: cap, yoy: isNum(m.yoy_change_pct) ? m.yoy_change_pct : null, units: c.funding.lihtc_units };
    }).filter(Boolean).sort(function (a, b) { return b.gap - a.gap; });
    if (!pts.length) {
      setStatus('fvnRentStatus', 'The rent comparison is unavailable: no county has both a Zillow rent and a CHFA rent limit.');
      return;
    }
    var pos = cssVar('--chart-1', '#096e65');
    var neg = cssVar('--chart-2', '#c2410c');
    canvas.parentNode.style.height = Math.max(320, pts.length * 18 + 80) + 'px';
    new global.Chart(canvas, {
      type: 'bar',
      data: {
        labels: pts.map(function (p) { return p.name; }),
        datasets: [{
          label: 'Typical market rent minus 60% AMI 2-bedroom maximum',
          data: pts.map(function (p) { return p.gap; }),
          backgroundColor: pts.map(function (p) { return p.gap >= 0 ? pos : neg; })
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var p = pts[ctx.dataIndex];
                return [fmtMoney(p.gap) + ' a month', 'Market ' + fmtMoney(p.market) + ', 60% AMI max ' + fmtMoney(p.cap),
                  'Market rent change over a year: ' + (p.yoy === null ? UNAVAILABLE : p.yoy.toFixed(1) + '%'),
                  'LIHTC units awarded: ' + fmtInt(p.units)];
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: 'Dollars a month (negative: the restricted rent is at or above market)' },
               ticks: { callback: function (v) { return fmtMoney(v); } } },
          y: { title: { display: true, text: 'County' }, ticks: { autoSkip: false, font: { size: 11 } } }
        }
      }
    });
    var below = pts.filter(function (p) { return p.gap <= 0; }).map(function (p) { return p.name; });
    setText('fvnRentText', pts.length + ' counties have a Zillow rent. The largest gap is ' + pts[0].name + ' at ' + fmtMoney(pts[0].gap) +
      ' a month. ' + (below.length ? 'The 60% AMI maximum is at or above typical market rent in ' + below.join(', ') + '.' : 'Typical market rent is above the 60% AMI maximum in every one.'));
    var vintage = zori.meta && (zori.meta.vintage_month || zori.meta.vintage || zori.meta.updated);
    if (vintage) setText('fvnRentVintage', 'Zillow rent vintage: ' + vintage + '.');
  }

  function renderByYear(d) {
    var canvas = document.getElementById('fvnYearChart');
    var by = (d.statewide && d.statewide.by_year) || [];
    if (!canvas || !global.Chart || !by.length) {
      setStatus('fvnYearStatus', 'The awards-by-year chart is unavailable.');
      return;
    }
    var c1 = cssVar('--chart-1', '#096e65');
    var c2 = cssVar('--chart-2', '#c2410c');
    new global.Chart(canvas, {
      type: 'bar',
      data: {
        labels: by.map(function (y) { return String(y.year); }),
        datasets: [
          { label: 'LIHTC units awarded', data: by.map(function (y) { return y.lihtc_units; }), backgroundColor: c1, yAxisID: 'y' },
          // Prop 123 began in FY23-24: earlier years have no program, so they are gaps, not zeros.
          { type: 'line', label: 'Prop 123 fund awards ($M)', data: by.map(function (y) { return y.year >= 2023 ? y.prop123_dollars / 1e6 : null; }),
            borderColor: c2, backgroundColor: c2, yAxisID: 'y1', spanGaps: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { title: { display: true, text: 'Award year' } },
          y: { position: 'left', min: 0, title: { display: true, text: 'LIHTC units' } },
          y1: { position: 'right', min: 0, title: { display: true, text: 'Prop 123 dollars ($M)' }, grid: { drawOnChartArea: false } }
        }
      }
    });
    var last = by[by.length - 1];
    setText('fvnYearText', 'LIHTC units awarded by year, ' + by[0].year + ' to ' + last.year + '. ' + last.year + ' is the year to date.');
  }

  // Table: one column definition list drives the header, the cells, the sort and the CSV.
  var COLUMNS = [
    { key: 'name', label: 'County', title: 'Colorado county', get: function (c) { return c.name; }, text: function (c) { return c.name; } },
    { key: 'region', label: 'Region', get: function (c) { return c.region; }, text: function (c) { return c.region || ''; } },
    { key: 'gap30', label: '≤30% AMI gap', title: 'Households at or below 30% AMI without an affordable home (HUD CHAS, via the ranking index)',
      get: function (c) { return c.need.gap_units_30ami; }, text: function (c) { return fmtInt(c.need.gap_units_30ami); } },
    { key: 'gap_per_1000', label: 'Gap per 1,000 residents', get: function (c) { return c.need.gap_per_1000_residents; }, text: function (c) { return fmtNum(c.need.gap_per_1000_residents); } },
    { key: 'gap_share', label: 'Share of state gap', get: function (c) { return c.need.share_of_state_gap; }, text: function (c) { return fmtPct(c.need.share_of_state_gap, 2); } },
    { key: 'units', label: 'LIHTC units awarded', title: 'Restricted units where the award report prints them, else total units',
      get: function (c) { return c.funding.lihtc_units; }, text: function (c) { return fmtInt(c.funding.lihtc_units); } },
    { key: 'unit_share', label: 'Share of state LIHTC units', get: function (c) { return c.funding.share_of_state_lihtc_units; }, text: function (c) { return fmtPct(c.funding.share_of_state_lihtc_units, 2); } },
    { key: 'coverage', label: 'Units per 100 gap households', get: function (c) { return c.funding.lihtc_units_per_100_gap; },
      text: function (c) { return withReason(c.funding.lihtc_units_per_100_gap, c.funding.lihtc_units_per_100_gap_unavailable_reason, function (v) { return v.toFixed(1); }); } },
    { key: 'credit9', label: '9% credit per unit (annual)', title: 'Annual federal 9% credit divided by 9% units; the credit is claimed for 10 years',
      get: function (c) { return c.funding.federal_9pct_credit_per_unit_annual; },
      text: function (c) { return withReason(c.funding.federal_9pct_credit_per_unit_annual, c.funding.federal_9pct_credit_per_unit_unavailable_reason, fmtMoney); } },
    { key: 'p123', label: 'Prop 123 dollars', get: function (c) { return c.funding.prop123_dollars; }, text: function (c) { return fmtMoney(c.funding.prop123_dollars); } },
    { key: 'vacancy', label: 'Active-market vacancy', title: 'ACS for-rent plus for-sale-only vacant units over all units',
      get: function (c) { return c.market.active_market_vacancy_pct; }, text: function (c) { return fmtPct(c.market.active_market_vacancy_pct); } },
    { key: 'pace', label: 'Permits ÷ projected growth', title: 'Average annual permits over five years divided by DOLA projected annual household growth',
      get: function (c) { return c.market.production_to_need_ratio; }, text: function (c) { return isNum(c.market.production_to_need_ratio) ? c.market.production_to_need_ratio.toFixed(2) + '×' : UNAVAILABLE; } },
    { key: 'quadrant', label: 'Need vs funding', get: function (c) { return c.quadrant ? QUADRANTS[c.quadrant].label : ''; },
      text: function (c) { return c.quadrant ? QUADRANTS[c.quadrant].label : 'Not placed (' + (c.quadrant_unavailable_reason || 'not computable') + ')'; } },
    { key: 'flags', label: 'Soft-market flags', get: function (c) { return c.flags.length; },
      text: function (c) { return c.flags.length ? c.flags.map(function (f) { return FLAG_LABELS[f.id] || f.id; }).join('; ') : 'None'; },
      cellTitle: function (c) { return c.flags.map(function (f) { return f.text; }).join('\n'); } }
  ];

  function compare(a, b) {
    var col = COLUMNS.filter(function (c) { return c.key === sortKey; })[0];
    var va = col.get(a), vb = col.get(b);
    var aMissing = va == null || va === '', bMissing = vb == null || vb === '';
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;   // unknowns sort last both ways
    if (typeof va === 'string') return sortDir * va.localeCompare(vb);
    return sortDir * (va - vb);
  }

  function renderTable() {
    var head = document.getElementById('fvnTableHead');
    var body = document.getElementById('fvnTableBody');
    if (!head || !body) return;
    head.innerHTML = COLUMNS.map(function (c) {
      var sorted = c.key === sortKey;
      var aria = sorted ? (sortDir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" aria-sort="' + aria + '"' + (c.title ? ' title="' + escapeHtml(c.title) + '"' : '') +
        '><button type="button" class="fvn-sort" data-key="' + c.key + '">' + escapeHtml(c.label) +
        (sorted ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('');
    body.innerHTML = rows.slice().sort(compare).map(function (r) {
      return '<tr>' + COLUMNS.map(function (c, i) {
        var t = c.cellTitle ? c.cellTitle(r) : '';
        var tag = i === 0 ? 'th scope="row"' : 'td';
        return '<' + tag + (t ? ' title="' + escapeHtml(t) + '"' : '') + '>' + escapeHtml(c.text(r)) + '</' + tag.split(' ')[0] + '>';
      }).join('') + '</tr>';
    }).join('');
  }

  function onSort(ev) {
    var btn = ev.target.closest && ev.target.closest('.fvn-sort');
    if (!btn) return;
    var key = btn.getAttribute('data-key');
    if (key === sortKey) sortDir = -sortDir;
    else { sortKey = key; sortDir = key === 'name' || key === 'region' ? 1 : -1; }
    renderTable();
    var again = document.querySelector('.fvn-sort[data-key="' + key + '"]');
    if (again) again.focus();
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadCsv() {
    var fields = [
      ['county_fips', function (c) { return c.fips; }], ['county', function (c) { return c.name; }], ['region', function (c) { return c.region; }],
      ['gap_units_30ami', function (c) { return c.need.gap_units_30ami; }], ['gap_per_1000_residents', function (c) { return c.need.gap_per_1000_residents; }],
      ['share_of_state_gap_pct', function (c) { return c.need.share_of_state_gap; }], ['overall_need_score', function (c) { return c.need.overall_need_score; }],
      ['tax_credit_awards', function (c) { return c.funding.tax_credit_awards; }], ['lihtc_units', function (c) { return c.funding.lihtc_units; }],
      ['lihtc_9pct_units', function (c) { return c.funding.lihtc_9pct_units; }], ['share_of_state_lihtc_units_pct', function (c) { return c.funding.share_of_state_lihtc_units; }],
      ['lihtc_units_per_100_gap', function (c) { return c.funding.lihtc_units_per_100_gap; }],
      ['lihtc_units_per_100_gap_unavailable_reason', function (c) { return c.funding.lihtc_units_per_100_gap_unavailable_reason; }],
      ['federal_9pct_credit_annual', function (c) { return c.funding.federal_9pct_credit_annual; }], ['federal_4pct_credit_annual', function (c) { return c.funding.federal_4pct_credit_annual; }],
      ['state_credit_annual', function (c) { return c.funding.state_credit_annual; }], ['mihtc_credit_annual', function (c) { return c.funding.mihtc_credit_annual; }],
      ['toc_credit_annual', function (c) { return c.funding.toc_credit_annual; }], ['prop123_awards', function (c) { return c.funding.prop123_awards; }],
      ['prop123_dollars', function (c) { return c.funding.prop123_dollars; }], ['prop123_mixed_income_dollars', function (c) { return c.funding.prop123_mixed_income_dollars; }],
      ['prop123_homeownership_dollars', function (c) { return c.funding.prop123_homeownership_dollars; }],
      ['active_market_vacancy_pct', function (c) { return c.market.active_market_vacancy_pct; }], ['production_to_need_ratio', function (c) { return c.market.production_to_need_ratio; }],
      ['chfa_60ami_max_rent_2br', function (c) { return c.market.chfa_60ami_max_rent_2br; }],
      ['quadrant', function (c) { return c.quadrant; }], ['flags', function (c) { return c.flags.map(function (f) { return f.id; }).join(';'); }]
    ];
    var lines = [fields.map(function (f) { return f[0]; }).join(',')];
    rows.forEach(function (c) { lines.push(fields.map(function (f) { return csvCell(f[1](c)); }).join(',')); });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'colorado-funding-vs-need.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function renderReview(d) {
    var el = document.getElementById('fvnReview');
    if (!el) return;
    var list = (d.meta && d.meta.documents_needing_review) || [];
    var unplaced = d.meta && d.meta.unplaced_awards;
    var parts = [];
    if (list.length) {
      parts.push('Left out until a person checks them, because their rows do not add up to the totals they print: ' + list.map(function (doc) {
        return '<a href="' + escapeHtml(doc.url) + '" target="_blank" rel="noopener">' + escapeHtml(doc.file) + '</a>';
      }).join(', ') + '.');
    }
    if (isNum(unplaced) && unplaced > 0) parts.push(unplaced + ' awards could not be placed in one county and count only toward the statewide totals.');
    el.innerHTML = parts.join(' ');
    el.hidden = !parts.length;
  }

  function init() {
    if (started) return;
    started = true;
    var zori = fetchJSON(ZORI_FILE).catch(function () { return null; });
    fetchJSON(FILE).then(function (d) {
      rows = d.counties || [];
      renderSummary(d);
      renderKpis(d);
      renderScatter(d);
      renderByYear(d);
      renderTable();
      renderReview(d);
      var head = document.getElementById('fvnTableHead');
      if (head) head.addEventListener('click', onSort);
      var btn = document.getElementById('fvnCsv');
      if (btn) btn.addEventListener('click', downloadCsv);
      return zori.then(function (z) { renderRentAdvantage(d, z); });
    }).catch(function (err) {
      console.warn('[funding-vs-need] load failed:', err);
      setText('fvnSummary', 'The funding and need data could not be loaded.');
      setStatus('fvnScatterStatus', 'Funding data unavailable.');
    });
  }

  global.FundingVsNeed = { init: init, _fmtMoney: fmtMoney, _withReason: withReason };

  // Opened straight onto the tab (#tab-need): the tab script has already revealed it.
  function maybeInit() {
    var panel = document.getElementById('tab-need');
    if (panel && !panel.hasAttribute('hidden')) init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeInit);
  else maybeInit();
}(window));
