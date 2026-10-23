/**
 * pro-forma.js — 15-Year Operating Pro Forma Module for LIHTC Deal Calculator
 *
 * ES5 IIFE pattern.  Renders the engine result's operating projection over a configurable horizon as
 * an interactive table + Chart.js line chart.
 *
 * Mount:  ProForma.render('containerId')
 * Event:  auto-updates on 'deal-calc:updated' CustomEvent.
 */
(function () {
  'use strict';

  // ── helpers ────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function fmt(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    return n.toFixed(2) + 'x';
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
        '<p style="font-size:var(--small);color:var(--muted);margin-bottom:var(--sp3);">' +
          'Projects the deal-calculator\u2019s year-1 income and expense figures over a multi-year horizon ' +
          'using constant annual growth rates and the stated loan payment schedules.' +
        '</p>' +

        // F133 — was hardcoded #fef3c7 (light yellow) bg + #92400e dark amber
        // text. STRONG inside inherited --text via the global rule, giving
        // light-blue on yellow = 1.12:1 in dark mode. Use --warn-dim bg with
        // explicit --text-strong color (theme-aware) and inner STRONG also
        // gets --text-strong so it doesn't inherit dark-mode --text.
        '<div style="margin-bottom:var(--sp3);padding:0.65rem 0.85rem;border-radius:var(--radius);' +
          'background:var(--warn-dim, rgba(168,70,8,0.1));border:1px solid var(--warn);color:var(--text-strong);font-size:var(--small);line-height:1.55;">' +
          '<strong style="color:var(--text-strong);">Disclaimer:</strong> Assumes constant growth rates and the stated loan payment schedules. ' +
          'Not a substitute for project-level underwriting or investor pro forma.' +
        '</div>' +

        // Assumptions inputs
        '<fieldset id="pf-assumptions" style="border:1px solid var(--border);border-radius:var(--radius);' +
          'padding:var(--sp3);margin-bottom:var(--sp3);">' +
          '<legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Projection Assumptions</legend>' +
          '<div style="display:flex;flex-wrap:wrap;gap:var(--sp3);align-items:flex-end;">' +
            '<label style="display:block;min-width:160px;">' +
              '<span style="font-size:var(--small);color:var(--muted);">Annual Rent Growth (%)</span>' +
              '<input id="pf-rent-growth" type="number" min="-3" max="5" step="0.25" value="2"' +
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
              '<input id="pf-years" type="number" min="5" max="50" step="1" value="15"' +
                ' style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);' +
                'border-radius:var(--radius);background:var(--bg2);color:var(--text);">' +
            '</label>' +
          '</div>' +
        '</fieldset>' +

        '<div id="pf-loans"></div>' +

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
        el.addEventListener('input', function () {
          if (window.__DealCalc) window.__DealCalc.recalculate();
        });
      }
    }

    update();
  }

  function update(event) {
    if (!_containerId) return;
    var result = event && event.detail && event.detail.result ||
      (window.__DealCalc && window.__DealCalc.getResult());
    var wrap = $('pf-table-wrap');
    renderLoans(result);
    if (!result || !result.projection) {
      var reason = result && result.unavailable.projection || 'The deal calculation is unavailable.';
      if (wrap) { wrap.dataset.unavailableReason = reason; wrap.textContent = 'Unavailable — ' + reason; }
      if (_chart) { _chart.destroy(); _chart = null; }
      return;
    }
    if (wrap) delete wrap.dataset.unavailableReason;
    var rows = result.projection.rows.slice(0, result.projection.years);
    renderTable(rows, result.unavailable);
    renderChart(rows);
  }

  function escapeLabel(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderLoans(result) {
    var host = $('pf-loans');
    if (!host) return;
    if (!result || !result.obligations || !result.obligations.loans) {
      host.textContent = 'Unavailable — ' + (result && result.obligations && result.obligations.unavailableReason || 'Loan inputs are unavailable.');
      return;
    }
    var years = result.coverage && result.coverage.years || [];
    var html = '<details><summary style="min-height:44px;cursor:pointer;">Annual loan obligations and coverage</summary>' +
      '<p>Screening schedule: paid amounts use available NOI, with required payments before contingent loans. Maturity amounts are separate from regular coverage and are not assumed refinanced or paid from operations. Years after an unpaid maturity are unavailable. Forgiveness assumes all agreement conditions are met.</p>' +
      '<div style="overflow-x:auto;"><table data-loan-coverage data-no-sort><caption>Coverage of regular must-pay payments</caption><thead><tr><th>Year</th><th>Senior only</th><th>All must-pay</th><th>Maturity due</th></tr></thead><tbody>';
    years.forEach(function (row) {
      html += '<tr><td>' + escapeLabel(row.year) + '</td><td>' + (row.seniorCoverage == null ? 'Unavailable — ' + escapeLabel(row.unavailableReason || 'No positive senior debt service.') : fmtPct(row.seniorCoverage)) + '</td><td>' +
        (row.allMustPayCoverage == null ? 'Unavailable — ' + escapeLabel(row.unavailableReason || 'No positive must-pay debt service.') : fmtPct(row.allMustPayCoverage)) + '</td><td>' +
        (row.maturityDue == null ? 'Unavailable — ' + escapeLabel(row.unavailableReason || 'Unknown loan obligation') : fmt(row.maturityDue)) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    result.obligations.loans.forEach(function (loan) {
      html += '<div style="overflow-x:auto;margin-top:1rem;"><table data-no-sort data-loan-id="' + escapeLabel(loan.id) + '" style="white-space:nowrap;width:100%;font-size:var(--small);"><caption>' +
        escapeLabel(loan.program || loan.id) + ' · ' + escapeLabel(window.DealEngine.LOAN_TYPES[loan.type]) +
        ' · maturity year ' + escapeLabel(loan.maturity) + ' · priority ' + escapeLabel(loan.priority) + '</caption>' +
        '<thead><tr><th>Year</th><th>Regular due</th><th>Paid</th><th>Unpaid</th><th>Interest accrued</th><th>Balance</th><th>Maturity due</th><th>Forgiven</th></tr></thead><tbody>';
      loan.rows.slice(0, loan.maturity).forEach(function (row) {
        html += '<tr><td>' + escapeLabel(row.year) + '</td>';
        ['due', 'paid', 'unpaid', 'accrued', 'balance', 'maturityDue', 'forgiven'].forEach(function (key) {
          html += '<td style="text-align:right;">' + (row[key] == null ? 'Unavailable — ' + escapeLabel(row.unavailableReason) : fmt(row[key])) + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    });
    host.innerHTML = html + '</details>';
  }

  // ── table ─────────────────────────────────────────────────────────
  function renderTable(rows, unavailable) {
    var wrap = $('pf-table-wrap');
    if (!wrap) return;

    var cols = [
      'Year', 'Gross Rents', 'Other Income', 'Vacancy Loss', 'EGI',
      'Operating Exp', 'Rep Reserve', 'Prop Tax', 'NOI',
      'All Must-pay Service', 'Bridge & Asset Fee', 'Cash Flow', 'All Must-pay DSCR', 'Cumulative CF'
    ];

    // Annual schedules carry each year into the next, so they stay in year order.
    var html = '<table data-no-sort style="width:100%;border-collapse:collapse;font-size:var(--small);white-space:nowrap;">';
    html += '<thead><tr>';
    for (var c = 0; c < cols.length; c++) {
      html += '<th style="text-align:' + (c === 0 ? 'center' : 'right') +
        ';padding:0.4rem 0.5rem;border-bottom:2px solid var(--border);color:var(--muted);font-weight:600;font-size:var(--tiny);">' +
        cols[c] + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var rowReason = r.unavailableReason || 'Debt service is unavailable for this year.';
      var rowMoney = function (value) { return value == null ? 'Unavailable — ' + escapeLabel(rowReason) : fmt(value); };
      var bgStyle = i % 2 === 0 ? '' : 'background:var(--bg2);';
      var cfColor = r.cashFlow >= 0 ? 'color:var(--accent);' : 'color:var(--chart-7);';
      var dscrColor = r.dscr >= 1.20 ? 'color:var(--accent);' : (r.dscr >= 1.0 ? 'color:var(--warn,#d97706);' : 'color:var(--chart-7);');
      var cumColor = r.cumCF >= 0 ? '' : 'color:var(--chart-7);';

      html += '<tr style="' + bgStyle + '">';
      html += '<td style="text-align:center;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;">' + r.year + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.grossRents) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.otherIncome || 0) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.vacancyLoss) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.egi) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.opex) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.repReserve) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + fmt(r.propTax) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;">' + fmt(r.noi) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + rowMoney(r.debtService) + '</td>';
      // DOH PR 4: bridge-loan debt service and the asset management fee also come out of cash flow.
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);">' + rowMoney(r.bridgeDebtService == null || r.assetMgmtFee == null ? null : r.bridgeDebtService + r.assetMgmtFee) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;' + cfColor + '">' + rowMoney(r.cashFlow) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);font-weight:600;' + dscrColor + '">' + (r.dscr == null ? 'Unavailable — ' + escapeLabel(r.unavailableReason || unavailable['projection.rows.' + i + '.dscr']) : fmtPct(r.dscr)) + '</td>';
      html += '<td style="text-align:right;padding:0.35rem 0.5rem;border-bottom:1px solid var(--border);' + cumColor + '">' + rowMoney(r.cumCF) + '</td>';
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
      dsData.push((rows[i].debtService == null ? null : Math.round(rows[i].debtService)));
      cfData.push((rows[i].cashFlow == null ? null : Math.round(rows[i].cashFlow)));
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
            borderColor: '#10b981',
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
  document.addEventListener('deal-calc:updated', update);

  // ── public API ────────────────────────────────────────────────────
  window.ProForma = {
    render: buildUI,
    update: update
  };
})();
