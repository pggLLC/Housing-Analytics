/**
 * benchmark-ui.js — COHO Analytics Comparative Analysis
 *
 * UI controller for multi-jurisdiction benchmark comparisons.
 * Renders comparison tables and Chart.js bar charts.
 *
 * Dependencies:
 *   - js/comparative-analysis/data-service.js
 *   - Chart.js (CDN)
 *
 * Exposes: window.BenchmarkUI
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let _selectedGeoids = [];
  let _comparisonChart = null;
  let _countyFips = null;

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(opts) {
    opts = opts || {};
    _countyFips = opts.countyFips || null;

    _bindJurisdictionPicker();
    _bindClearBtn();
    _bindExportBtn();

    if (_selectedGeoids.length) _renderComparison();
  }

  // ---------------------------------------------------------------------------
  // Jurisdiction picker
  // ---------------------------------------------------------------------------

  function _bindJurisdictionPicker() {
    const form = document.getElementById('bmAddJurisdiction');
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const select = document.getElementById('bmJurisdictionSelect');
      if (!select || !select.value) return;
      const geoid = select.value;
      if (!_selectedGeoids.includes(geoid)) {
        _selectedGeoids.push(geoid);
        await _renderComparison();
        _announce(`Added ${select.options[select.selectedIndex]?.text || geoid} to comparison.`);
      }
    });
  }

  function _bindClearBtn() {
    const btn = document.getElementById('bmClearComparison');
    if (!btn) return;
    btn.addEventListener('click', () => {
      _selectedGeoids = [];
      _renderComparison();
      _announce('Comparison cleared.');
    });
  }

  function _bindExportBtn() {
    const btn = document.getElementById('bmExportComparison');
    if (!btn) return;
    btn.addEventListener('click', _exportCSV);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  async function _renderComparison() {
    const container = document.getElementById('bmComparisonPanel');
    if (!container) return;

    if (!_selectedGeoids.length) {
      container.innerHTML = '<p class="bm-empty" data-i18n="comparative.noData">Select at least one jurisdiction to compare.</p>';
      if (window.i18n) window.i18n._applyToDOM();
      return;
    }

    container.innerHTML = '<p class="bm-loading" aria-live="polite">Loading comparison data…</p>';

    try {
      const rows = await window.BenchmarkDataService.buildComparison(_selectedGeoids, _countyFips);
      _renderTable(rows);
      _renderChart(rows);
    } catch (err) {
      console.error('BenchmarkUI: comparison failed:', err);
      container.innerHTML = '<p class="bm-error">Failed to load comparison data. Please try again.</p>';
    }
  }

  const METRIC_KEYS = [
    { key: 'population',       label: 'Population',          format: 'int' },
    { key: 'medianIncome',     label: 'Median Income',        format: 'currency' },
    { key: 'medianRent',       label: 'Median Rent',          format: 'currency' },
    { key: 'rentBurden',       label: 'Rent Burden',          format: 'percent' },
    { key: 'vacancyRate',      label: 'Vacancy Rate',         format: 'percent' },
    { key: 'unitsNeeded',      label: 'Units Needed',         format: 'int' },
  ];

  function _renderTable(rows) {
    const container = document.getElementById('bmComparisonPanel');
    if (!container) return;

    const thead = `
      <thead>
        <tr>
          <th scope="col">Jurisdiction</th>
          ${METRIC_KEYS.map(m => `<th scope="col">${m.label}</th>`).join('')}
        </tr>
      </thead>
    `;

    const tbody = rows.map(row => {
      const cls = row.isAggregate ? ' class="bm-row-aggregate"' : '';
      const cells = METRIC_KEYS.map(m => {
        const val = row.metrics[m.key];
        return `<td>${val != null ? _formatVal(val, m.format) : '—'}</td>`;
      }).join('');
      return `<tr${cls}><td><strong>${_escHtml(row.label)}</strong></td>${cells}</tr>`;
    }).join('');

    container.innerHTML = `
      <div class="bm-table-wrap" role="region" aria-label="Comparison table" tabindex="0">
        <table class="bm-table" aria-label="Jurisdiction comparison metrics">
          ${thead}
          <tbody>${tbody}</tbody>
        </table>
      </div>
      <div class="bm-chart-wrap">
        <canvas id="bmComparisonChart" role="img" aria-label="Comparison bar chart of housing metrics by jurisdiction"></canvas>
      </div>
    `;

    _renderChart(rows);
  }

  function _renderChart(rows) {
    const canvas = document.getElementById('bmComparisonChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels  = rows.map(r => r.label);
    const rentData = rows.map(r => r.metrics.medianRent ?? 0);
    const needData = rows.map(r => r.metrics.unitsNeeded ?? 0);

    const CHART_COLORS = [
      'rgba(9,110,101,0.75)', 'rgba(168,70,8,0.75)', 'rgba(29,78,216,0.75)',
      'rgba(200,111,13,0.75)', 'rgba(153,27,27,0.75)',
    ];

    const bgColors = rows.map((r, i) =>
      r.isAggregate ? 'rgba(100,100,100,0.4)' : CHART_COLORS[i % CHART_COLORS.length]
    );

    if (_comparisonChart) {
      _comparisonChart.destroy();
      _comparisonChart = null;
    }

    _comparisonChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Median Rent ($)',
            data: rentData,
            backgroundColor: bgColors,
            yAxisID: 'yRent',
          },
          {
            label: 'Units Needed',
            data: needData,
            backgroundColor: bgColors.map(c => c.replace('0.75', '0.3')),
            type: 'line',
            yAxisID: 'yUnits',
            borderColor: 'var(--accent)',
            borderWidth: 2,
            pointRadius: 4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                return ctx.datasetIndex === 0
                  ? `${ctx.dataset.label}: $${v.toLocaleString()}`
                  : `${ctx.dataset.label}: ${v.toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          yRent:  { type: 'linear', position: 'left',  title: { display: true, text: 'Median Rent ($)' },  ticks: { callback: v => '$' + v.toLocaleString() } },
          yUnits: { type: 'linear', position: 'right', title: { display: true, text: 'Units Needed' }, grid: { drawOnChartArea: false }, ticks: { callback: v => v.toLocaleString() } },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  async function _exportCSV() {
    try {
      const rows = await window.BenchmarkDataService.buildComparison(_selectedGeoids, _countyFips);
      const header = ['Jurisdiction', ...METRIC_KEYS.map(m => m.label)].join(',');
      const dataRows = rows.map(r =>
        [_csvCell(r.label), ...METRIC_KEYS.map(m => r.metrics[m.key] ?? '')].join(',')
      );
      const csv  = [header, ...dataRows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `coho-comparison-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('BenchmarkUI: export failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function _announce(msg) {
    const el = document.getElementById('bmLiveRegion') || document.getElementById('hnaLiveRegion');
    if (el) el.textContent = msg;
  }

  function _formatVal(val, format) {
    if (val == null) return '—';
    switch (format) {
      case 'int':      return Math.round(val).toLocaleString();
      case 'currency': return '$' + Math.round(val).toLocaleString();
      case 'percent':  return (val * (val < 1 ? 100 : 1)).toFixed(1) + '%';
      default:         return val;
    }
  }

  function _escHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  function _csvCell(val) {
    const s = String(val);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window.BenchmarkUI = {
    init,
    addGeoid(geoid) {
      if (!_selectedGeoids.includes(geoid)) {
        _selectedGeoids.push(geoid);
        _renderComparison();
      }
    },
    removeGeoid(geoid) {
      _selectedGeoids = _selectedGeoids.filter(g => g !== geoid);
      _renderComparison();
    },
    getSelectedGeoids: () => _selectedGeoids.slice(),
  };
})();
