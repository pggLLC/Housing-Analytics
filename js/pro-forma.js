/**
 * pro-forma.js — 15-Year Operating Pro Forma Module for LIHTC Deal Calculator
 *
 * ES5 IIFE pattern.  Reads year-1 values from the deal-calculator DOM,
 * projects rent/expense growth over a configurable horizon, and renders
 * an interactive table + Chart.js line chart.
 *
 * Mount:  ProForma.render('containerId')
 * Event:  auto-updates on 'deal-calc:updated' CustomEvent.
 */
(function () {
  'use strict';

  // ── helpers ────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function numVal(id, fallback) {
    var el = $(id);
    if (!el) return fallback;
    var v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  function textNum(id) {
    var el = $(id);
    if (!el) return 0;
    var raw = el.textContent.replace(/[^0-9.\-]/g, '');
    var v = parseFloat(raw);
    return isFinite(v) ? v : 0;
  }

  function fmt(n) {
    if (!isFinite(n)) return '\u2014';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(n) {
    if (!isFinite(n)) return '\u2014';
    return n.toFixed(2) + 'x';
  }

  // ── mortgage constant (mirrors deal-calculator.js) ────────────────
  function mortgageConstant(annualRate, termYears) {
    var monthlyRate = annualRate / 12;
    var totalMonths = termYears * 12;
    if (monthlyRate <= 0 || totalMonths <= 0) return 0;
    var factor = Math.pow(1 + monthlyRate, totalMonths);
    return (monthlyRate * factor / (factor - 1)) * 12;
  }

  // ── read year-1 values from deal-calculator DOM ───────────────────
  function readBaseYear() {
    var units = numVal('dc-units', 60);
    var vacancyPct = numVal('dc-vacancy', 7) / 100;
    var opexPerUnitMonth = numVal('dc-opex', 450);
    var repReservePerUnit = numVal('dc-rep-reserve', 350);
    var propTaxPerUnit = numVal('dc-prop-tax', 900);
    var taxExemptPct = numVal('dc-tax-exempt', 0) / 100;

    // Annual rents from the results element (populated by deal-calculator)
    var annualRents = textNum('dc-r-rents');

    // Operating expenses annualised
    var annualOpex = opexPerUnitMonth * 12 * units;
    var annualRepReserve = repReservePerUnit * units;
    var annualPropTaxGross = propTaxPerUnit * units;
    var taxSavings = annualPropTaxGross * taxExemptPct;
    var netPropTax = annualPropTaxGross - taxSavings;

    var vacancyLoss = annualRents * vacancyPct;
    var egi = annualRents - vacancyLoss;
    var noi = egi - annualOpex - annualRepReserve - netPropTax;

    // Debt service: mortgage * mortgage constant
    var interestRate = numVal('dc-rate', 6.5) / 100;
    var term = numVal('dc-term', 35);
    var mc = mortgageConstant(interestRate, term);
    var mortgageAmt = textNum('dc-r-mortgage');
    var annualDebtService = mc > 0 ? mortgageAmt * mc : 0;

    return {
      units: units,
      annualRents: annualRents,
      vacancyPct: vacancyPct,
      vacancyLoss: vacancyLoss,
      egi: egi,
      annualOpex: annualOpex,
      annualRepReserve: annualRepReserve,
      netPropTax: netPropTax,
      noi: noi,
      debtService: annualDebtService
    };
  }

  // ── projection engine ─────────────────────────────────────────────
  function project(base, rentGrowth, expGrowth, years) {
    var rows = [];
    var cumCF = 0;
    for (var y = 1; y <= years; y++) {
      var rentMult = Math.pow(1 + rentGrowth, y - 1);
      var expMult  = Math.pow(1 + expGrowth,  y - 1);

      var grossRents    = base.annualRents * rentMult;
      var vacancyLoss   = grossRents * base.vacancyPct;
      var egi           = grossRents - vacancyLoss;
      var opex          = base.annualOpex * expMult;
      var repReserve    = base.annualRepReserve * expMult;
      var propTax       = base.netPropTax * expMult;
      var noi           = egi - opex - repReserve - propTax;
      var debtService   = base.debtService; // fixed
      var cashFlow      = noi - debtService;
      cumCF += cashFlow;
      var dscr = debtService > 0 ? noi / debtService : 0;

      rows.push({
        year: y,
        grossRents: grossRents,
        vacancyLoss: vacancyLoss,
        egi: egi,
        opex: opex,
        repReserve: repReserve,
        propTax: propTax,
        noi: noi,
        debtService: debtService,
        cashFlow: cashFlow,
        dscr: dscr,
        cumCF: cumCF
      });
    }
    return rows;
  }

  // ── rendering ─────────────────────────────────────────────────────
  var _containerId = null;
  var _chart = null;

  function buildUI(containerId) {
    var c = $(containerId);
    if (!c) return;
    _containerId = containerId;

    c.innerHTML =
      '<section class="chart-card" style="margin-top:2rem;" aria-labelledby="pfTitle">' +
        '<h2 id="pfTitle" style="font-size:1rem;font-weight:700;margin-bottom:0.25rem;">' +
          'Operating Pro Forma Projection' +
        '</h2>' +
        '<p style="font-size:var(--small);color:var(--muted);margin-bottom:var(--sp3);max-width:760px;">' +
          'Projects the deal-calculator\u2019s year-1 income and expense figures over a multi-year horizon ' +
          'using constant annual growth rates and fixed debt service.' +
        '</p>' +

        // Disclaimer
        '<div style="margin-bottom:var(--sp3);padding:0.65rem 0.85rem;border-radius:var(--radius);' +
          'background:#fef3c7;border:1px solid #fcd34d;color:#92400e;font-size:var(--small);line-height:1.55;">' +
          '<strong>Disclaimer:</strong> Assumes constant growth rates and fixed debt service. ' +
          'Not a substitute for project-level underwriting or investor pro forma.' +
        '</div>' +

        // Assumptions inputs
        '<fieldset id="pf-assumptions" style="border:1px solid var(--border);border-radius:var(--radius);' +
          'padding:var(--sp3);margin-bottom:var(--sp3);">' +
          '<legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Projection Assumptions</legend>' +
          '<div style="display:flex;flex-wrap:wrap;gap:var(--sp3);align-items:flex-end;">' +
            '<label style="display:block;min-width:160px;">' +
              '<span style="font-size:var(--small);color:var(--muted);">Annual Rent Growth (%)</span>' +
              '<input id="pf-rent-growth" type="number" min="0" max="5" step="0.25" value="2"' +
                ' style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);' +
                'border-radius:var(--radius);background:var(--bg2);color:var(--text);">' +
            '</label>' +
            '<label style="display:block;min-width:160px;">' +
              '<span style="font-size:var(--small);color:var(--muted);">Annual Expense Growth (%)</span>' +
              '<input id="pf-exp-growth" type="number" min="0" max="6" step="0.25" value="3"' +
                ' style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);' +
                'border-radius:var(--radius);background:var(--bg2);color:var(--text);">' +
            '</label>' +
            '<label style="display:block;min-width:160px;">' +
              '<span style="font-size:var(--small);color:var(--muted);">Projection Years</span>' +
              '<input id="pf-years" type="number" min="5" max="30" step="1" value="15"' +
                ' style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);' +
                'border-radius:var(--radius);background:var(--bg2);color:var(--text);">' +
            '</label>' +
          '</div>' +
        '</fieldset>' +

        // Table container
        '<div id="pf-table-wrap" style="overflow-x:auto;margin-bottom:var(--sp3);"></div>' +

        // Chart container
        '<div style="position:relative;max-width:900px;margin:0 auto;">' +
          '<canvas id="pf-chart" style="width:100%;height:320px;" aria-label="Line chart: NOI, Debt Service, and Cash Flow over projection period" role="img"></canvas>' +
        '</div>' +
      '</section>';

    // Wire up input listeners
    var inputs = ['pf-rent-growth', 'pf-exp-growth', 'pf-years'];
    for (var i = 0; i < inputs.length; i++) {
      var el = $(inputs[i]);
      if (el) {
        el.addEventListener('input', update);
      }
    }

    update();
  }

  function update() {
    if (!_containerId) return;
    var base = readBaseYear();

    // If auto-NOI is not enabled or rents are zero, show a helpful message
    var autoNoiEl = $('dc-auto-noi');
    if (!autoNoiEl || !autoNoiEl.checked || base.annualRents <= 0) {
      var wrap = $('pf-table-wrap');
      if (wrap) {
        wrap.innerHTML =
          '<p style="font-size:var(--small);color:var(--muted);padding:1rem 0;">' +
          'Enable <strong>Auto-compute NOI</strong> in the deal calculator above and ensure ' +
          'AMI tier units are configured to populate the pro forma projection.' +
          '</p>';
      }
      if (_chart) { _chart.destroy(); _chart = null; }
      return;
    }

    var rentGrowth = numVal('pf-rent-growth', 2) / 100;
    var expGrowth  = numVal('pf-exp-growth', 3) / 100;
    var years      = Math.min(30, Math.max(5, Math.round(numVal('pf-years', 15))));

    // Clamp to valid ranges
    if (rentGrowth < 0) rentGrowth = 0;
    if (rentGrowth > 0.05) rentGrowth = 0.05;
    if (expGrowth < 0) expGrowth = 0;
    if (expGrowth > 0.06) expGrowth = 0.06;

    var rows = project(base, rentGrowth, expGrowth, years);

    renderTable(rows);
    renderChart(rows);
  }

  // ── table ─────────────────────────────────────────────────────────
  function renderTable(rows) {
    var wrap = $('pf-table-wrap');
    if (!wrap) return;

    var cols = [
      'Year', 'Gross Rents', 'Vacancy Loss', 'EGI',
      'Operating Exp', 'Rep Reserve', 'Prop Tax', 'NOI',
      'Debt Service', 'Cash Flow', 'DSCR', 'Cumulative CF'
    ];

    var html = '<table style="width:100%;border-collapse:collapse;font-size:var(--small);white-space:nowrap;">';
    html += '<thead><tr>';
    for (var c = 0; c < cols.length; c++) {
      html += '<th style="text-align:' + (c === 0 ? 'center' : 'right') +
        ';padding:0.4rem 0.5rem;border-bottom:2px solid var(--border);color:var(--muted);font-weight:600;font-size:var(--tiny);">' +
        cols[c] + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var bgStyle = i % 2 === 0 ? '' : 'background:var(--bg2);';
      var cfColor = r.cashFlow >= 0 ? 'color:var(--accent);' : 'color:var(--chart-7);';
      var dscrColor = r.dscr >= 1.20 ? 'color:var(--accent);' : (r.dscr >= 1.0 ? 'color:var(--warn,#d97706);' : 'color:var(--chart-7);');
      var cumColor = r.cumCF >= 0 ? '' : 'color:var(--chart-7);';

      html += '<tr style="' + bgStyle + '">';
      html += '<td style="text-align:center;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;">' + r.year + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.grossRents) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.vacancyLoss) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.egi) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.opex) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.repReserve) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.propTax) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;">' + fmt(r.noi) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.debtService) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;' + cfColor + '">' + fmt(r.cashFlow) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;' + dscrColor + '">' + fmtPct(r.dscr) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);' + cumColor + '">' + fmt(r.cumCF) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  // ── chart (Chart.js) ──────────────────────────────────────────────
  function renderChart(rows) {
    var canvas = $('pf-chart');
    if (!canvas) return;

    // Chart.js may not be loaded yet
    if (typeof Chart === 'undefined') {
      var parent = canvas.parentNode;
      if (parent) {
        parent.innerHTML =
          '<p style="font-size:var(--small);color:var(--muted);text-align:center;padding:2rem 0;">' +
          'Chart.js is not loaded on this page. Include js/vendor/chart.umd.min.js to enable the projection chart.' +
          '</p>';
      }
      return;
    }

    var labels = [];
    var noiData = [];
    var dsData = [];
    var cfData = [];

    for (var i = 0; i < rows.length; i++) {
      labels.push('Yr ' + rows[i].year);
      noiData.push(Math.round(rows[i].noi));
      dsData.push(Math.round(rows[i].debtService));
      cfData.push(Math.round(rows[i].cashFlow));
    }

    if (_chart) {
      _chart.data.labels = labels;
      _chart.data.datasets[0].data = noiData;
      _chart.data.datasets[1].data = dsData;
      _chart.data.datasets[2].data = cfData;
      _chart.update();
      return;
    }

    // Detect dark mode
    var isDark = document.documentElement.classList.contains('dark') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    var textColor = isDark ? '#aaa' : '#666';

    _chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'NOI',
            data: noiData,
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.15
          },
          {
            label: 'Debt Service',
            data: dsData,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: false,
            tension: 0,
            borderDash: [6, 3]
          },
          {
            label: 'Cash Flow',
            data: cfData,
            borderColor: '#d97706',
            backgroundColor: 'rgba(217,119,6,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.15
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: textColor, font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var val = ctx.parsed.y;
                var sign = val < 0 ? '-' : '';
                return ctx.dataset.label + ': ' + sign + '$' + Math.abs(val).toLocaleString('en-US');
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, font: { size: 11 } },
            grid:  { color: gridColor }
          },
          y: {
            ticks: {
              color: textColor,
              font: { size: 11 },
              callback: function (v) {
                if (v === 0) return '$0';
                if (Math.abs(v) >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
                return '$' + (v / 1000).toFixed(0) + 'K';
              }
            },
            grid: { color: gridColor }
          }
        }
      }
    });
  }

  // ── event wiring ──────────────────────────────────────────────────
  document.addEventListener('deal-calc:updated', function () {
    // Only update if already mounted
    if (_containerId) update();
  });

  // ── public API ────────────────────────────────────────────────────
  window.ProForma = {
    render: buildUI,
    update: update
  };
})();
