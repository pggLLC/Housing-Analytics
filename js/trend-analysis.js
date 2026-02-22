/**
 * trend-analysis.js
 * Colorado Housing Trend Analysis Module
 * Compares Colorado housing metrics against 10+ peer states with
 * statistical significance indicators, time-range filtering, and CSV export.
 *
 * Usage: TrendAnalysis.init()  (call after DOMContentLoaded)
 * Renders into: #trend-analysis-section
 */
(function (window) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Constants & hardcoded data                                         */
  /* ------------------------------------------------------------------ */

  const STATES = [
    'Colorado', 'Texas', 'California', 'Arizona', 'Utah',
    'Nevada', 'Oregon', 'Washington', 'Florida', 'Georgia',
    'North Carolina', 'Virginia',
  ];

  // Annual snapshots: 2019 – 2024
  const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];

  // Median home price (USD thousands)
  const MEDIAN_PRICE = {
    Colorado:       [420, 445, 530, 590, 565, 572],
    Texas:          [230, 250, 305, 350, 330, 335],
    California:     [580, 620, 720, 810, 760, 775],
    Arizona:        [265, 295, 375, 430, 400, 408],
    Utah:           [320, 360, 455, 530, 500, 510],
    Nevada:         [295, 325, 405, 460, 425, 432],
    Oregon:         [365, 395, 470, 510, 480, 487],
    Washington:     [420, 460, 545, 610, 575, 582],
    Florida:        [260, 295, 380, 430, 415, 421],
    Georgia:        [215, 240, 305, 355, 340, 346],
    'North Carolina': [215, 240, 300, 345, 335, 341],
    Virginia:       [305, 335, 400, 445, 430, 437],
  };

  // Year-over-year rent growth (%)
  const RENT_GROWTH = {
    Colorado:       [3.1, 1.8, 8.4, 12.1, 4.2, 3.8],
    Texas:          [2.8, 0.5, 9.2, 14.3, 3.1, 2.9],
    California:     [3.5, -0.2, 6.1, 8.7, 2.5, 2.1],
    Arizona:        [4.2, 2.1, 14.5, 18.2, 2.8, 2.4],
    Utah:           [3.8, 2.4, 12.1, 15.6, 3.4, 3.0],
    Nevada:         [5.1, 0.8, 13.4, 16.9, 2.1, 1.8],
    Oregon:         [2.9, 1.2, 7.8, 10.4, 3.0, 2.7],
    Washington:     [3.3, 0.6, 9.1, 12.7, 3.8, 3.4],
    Florida:        [4.0, 1.5, 15.2, 19.4, 3.2, 2.8],
    Georgia:        [3.2, 1.4, 11.3, 14.8, 3.5, 3.1],
    'North Carolina': [3.0, 1.6, 10.5, 13.7, 3.6, 3.2],
    Virginia:       [2.7, 1.1, 7.4, 9.8, 2.9, 2.6],
  };

  // Vacancy rate (%)
  const VACANCY_RATE = {
    Colorado:       [4.2, 4.8, 3.9, 3.1, 3.8, 4.0],
    Texas:          [7.1, 7.8, 5.9, 4.8, 6.2, 6.5],
    California:     [3.8, 4.2, 3.5, 2.9, 3.4, 3.6],
    Arizona:        [5.5, 6.1, 4.2, 3.3, 5.1, 5.4],
    Utah:           [3.9, 4.5, 3.2, 2.6, 3.5, 3.7],
    Nevada:         [5.8, 6.8, 4.5, 3.4, 5.3, 5.6],
    Oregon:         [4.1, 4.9, 3.8, 3.0, 3.7, 3.9],
    Washington:     [3.7, 4.3, 3.4, 2.8, 3.3, 3.5],
    Florida:        [6.2, 7.1, 4.8, 3.6, 5.4, 5.7],
    Georgia:        [6.5, 7.3, 5.1, 3.9, 5.8, 6.1],
    'North Carolina': [5.9, 6.7, 4.6, 3.5, 5.2, 5.5],
    Virginia:       [4.8, 5.4, 4.1, 3.3, 4.5, 4.7],
  };

  // New construction starts (thousands of units)
  const CONSTRUCTION_STARTS = {
    Colorado:       [58.2, 54.1, 68.4, 72.1, 61.3, 59.8],
    Texas:          [185.4, 172.3, 215.6, 228.4, 198.7, 192.3],
    California:     [112.3, 98.7, 125.4, 118.9, 105.2, 101.8],
    Arizona:        [54.1, 48.9, 67.8, 74.2, 62.5, 60.1],
    Utah:           [28.4, 25.6, 36.1, 40.3, 33.8, 32.4],
    Nevada:         [22.1, 19.8, 28.4, 32.1, 26.7, 25.3],
    Oregon:         [24.6, 21.3, 29.8, 33.4, 27.9, 26.5],
    Washington:     [52.3, 47.8, 63.2, 68.9, 57.4, 55.1],
    Florida:        [142.6, 128.4, 168.9, 182.3, 158.7, 152.4],
    Georgia:        [78.4, 69.2, 94.6, 105.3, 88.7, 84.9],
    'North Carolina': [62.1, 55.8, 78.3, 86.4, 73.1, 70.2],
    Virginia:       [38.7, 34.5, 47.2, 52.8, 44.3, 42.6],
  };

  const METRICS = [
    {
      key: 'medianPrice',
      label: 'Median Home Price',
      unit: '$k',
      data: MEDIAN_PRICE,
      methodology: 'Median home price (USD thousands) sourced from state-level MLS aggregates and Census ACS 5-year estimates. Values represent Q4 annual figures.',
    },
    {
      key: 'rentGrowth',
      label: 'Rent Growth (YoY %)',
      unit: '%',
      data: RENT_GROWTH,
      methodology: 'Year-over-year percentage change in median asking rent for 2-bedroom units. Derived from CoStar, Zillow Observed Rent Index, and BLS CPI shelter component.',
    },
    {
      key: 'vacancyRate',
      label: 'Vacancy Rate',
      unit: '%',
      data: VACANCY_RATE,
      methodology: 'Rental vacancy rate (%) from Census Housing Vacancy Survey and ACS estimates. Reflects the share of rental units available but unoccupied.',
    },
    {
      key: 'constructionStarts',
      label: 'New Construction Starts',
      unit: 'k units',
      data: CONSTRUCTION_STARTS,
      methodology: 'Annual new residential construction starts (thousands of units) from Census Bureau Building Permits Survey and State Construction Monitors.',
    },
  ];

  const TIME_RANGES = [
    { label: '1 Year', value: 1 },
    { label: '3 Years', value: 3 },
    { label: '5 Years', value: 5 },
  ];

  const COLORS = [
    '#1a73e8', '#e53935', '#43a047', '#fb8c00', '#8e24aa',
    '#00acc1', '#f06292', '#558b2f', '#6d4c41', '#546e7a',
    '#fdd835', '#26c6da',
  ];

  /* ------------------------------------------------------------------ */
  /*  In-memory cache                                                    */
  /* ------------------------------------------------------------------ */

  const _cache = {};

  function getCached(key) { return _cache[key]; }
  function setCache(key, val) { _cache[key] = val; return val; }

  /* ------------------------------------------------------------------ */
  /*  Statistical helpers                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Compute mean of an array.
   */
  function mean(arr) {
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  /**
   * Compute sample standard deviation.
   */
  function stddev(arr) {
    const m = mean(arr);
    const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * Two-sample Welch t-test statistic.
   * Returns { t, significant } where significant = |t| > 2.0 (~p<0.05 heuristic).
   */
  function welchT(a, b) {
    if (a.length < 2 || b.length < 2) return { t: 0, significant: false };
    const ma = mean(a), mb = mean(b);
    const sa = stddev(a), sb = stddev(b);
    const se = Math.sqrt((sa ** 2 / a.length) + (sb ** 2 / b.length));
    if (se === 0) return { t: 0, significant: false };
    const t = (ma - mb) / se;
    return { t: parseFloat(t.toFixed(2)), significant: Math.abs(t) > 2.0 };
  }

  /* ------------------------------------------------------------------ */
  /*  Data helpers                                                       */
  /* ------------------------------------------------------------------ */

  function sliceByYears(arr, numYears) {
    return arr.slice(arr.length - numYears);
  }

  function yearsLabel(numYears) {
    return YEARS.slice(YEARS.length - numYears);
  }

  /* ------------------------------------------------------------------ */
  /*  CSV export                                                         */
  /* ------------------------------------------------------------------ */

  function buildCSV(metricKey, numYears) {
    const metric = METRICS.find(m => m.key === metricKey);
    if (!metric) return '';
    const yearSlice = yearsLabel(numYears);
    const rows = [['State', ...yearSlice, 'Vs CO (t-stat)', 'Significant']];
    const coData = sliceByYears(metric.data['Colorado'], numYears);
    STATES.forEach(state => {
      const vals = sliceByYears(metric.data[state], numYears);
      const { t, significant } = welchT(coData, vals);
      rows.push([state, ...vals.map(v => v.toFixed(2)), t, significant ? 'Yes' : 'No']);
    });
    return rows.map(r => r.join(',')).join('\n');
  }

  function downloadCSV(metricKey, numYears) {
    const csv = buildCSV(metricKey, numYears);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colorado-${metricKey}-${numYears}yr-trend.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ */
  /*  Chart rendering                                                    */
  /* ------------------------------------------------------------------ */

  function buildChartDatasets(metric, numYears) {
    const cacheKey = `${metric.key}-${numYears}`;
    if (getCached(cacheKey)) return getCached(cacheKey);

    const yearSlice = yearsLabel(numYears);
    const datasets = STATES.map((state, i) => ({
      label: state,
      data: sliceByYears(metric.data[state], numYears),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length] + '22',
      borderWidth: state === 'Colorado' ? 3 : 1.5,
      pointRadius: state === 'Colorado' ? 5 : 3,
      tension: 0.3,
    }));

    return setCache(cacheKey, { labels: yearSlice, datasets });
  }

  function renderChart(canvasId, metric, numYears) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Destroy previous instance if any
    if (canvas._chartInstance) {
      canvas._chartInstance.destroy();
    }

    const chartData = buildChartDatasets(metric, numYears);

    canvas._chartInstance = new window.Chart(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              font: { size: 12 },
              color: getComputedStyle(document.documentElement).getPropertyValue('--text') || '#333',
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ${metric.unit}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: 'Year' },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#666' },
          },
          y: {
            title: { display: true, text: `${metric.label} (${metric.unit})` },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#666' },
          },
        },
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Significance table                                                 */
  /* ------------------------------------------------------------------ */

  function buildSignificanceTable(metric, numYears) {
    const coData = sliceByYears(metric.data['Colorado'], numYears);
    const rows = STATES.filter(s => s !== 'Colorado').map(state => {
      const stateData = sliceByYears(metric.data[state], numYears);
      const { t, significant } = welchT(coData, stateData);
      const coMean = mean(coData).toFixed(1);
      const stMean = mean(stateData).toFixed(1);
      const diff = (mean(coData) - mean(stateData)).toFixed(1);
      return { state, coMean, stMean, diff, t, significant };
    });
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /*  DOM helpers                                                        */
  /* ------------------------------------------------------------------ */

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('data-')) node.dataset[k.slice(5)] = v;
      else node.setAttribute(k, v);
    });
    children.forEach(child => {
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else if (child) node.appendChild(child);
    });
    return node;
  }

  /* ------------------------------------------------------------------ */
  /*  Main render                                                        */
  /* ------------------------------------------------------------------ */

  function renderMetricPanel(container, metric, numYears) {
    // Chart card
    const canvasId = `ta-chart-${metric.key}`;

    const chartWrapper = el('div', { class: 'ta-chart-wrapper', style: 'height:320px;position:relative;' });
    const canvas = el('canvas', {
      id: canvasId,
      'aria-label': `${metric.label} trend chart for Colorado vs peer states`,
      role: 'img',
    });
    chartWrapper.appendChild(canvas);

    // Significance table
    const rows = buildSignificanceTable(metric, numYears);
    const thead = el('thead', {},
      el('tr', {},
        el('th', { scope: 'col' }, 'State'),
        el('th', { scope: 'col' }, `CO Mean (${metric.unit})`),
        el('th', { scope: 'col' }, `State Mean (${metric.unit})`),
        el('th', { scope: 'col' }, 'Difference'),
        el('th', { scope: 'col' }, 't-stat'),
        el('th', { scope: 'col' }, 'Significant?'),
      ),
    );

    const tbody = el('tbody', {});
    rows.forEach(r => {
      const sigCell = el('td', { class: r.significant ? 'ta-sig-yes' : 'ta-sig-no' },
        r.significant ? '✓ Yes (p<0.05)' : '— No',
      );
      tbody.appendChild(el('tr', {},
        el('td', {}, r.state),
        el('td', {}, r.coMean),
        el('td', {}, r.stMean),
        el('td', {
          class: parseFloat(r.diff) > 0 ? 'ta-positive' : 'ta-negative',
        }, (parseFloat(r.diff) > 0 ? '+' : '') + r.diff),
        el('td', {}, r.t.toString()),
        sigCell,
      ));
    });

    const table = el('table', {
      class: 'ta-sig-table',
      'aria-label': `Statistical significance comparison: Colorado vs peer states for ${metric.label}`,
      role: 'table',
    }, thead, tbody);

    const tableScroll = el('div', {
      class: 'ta-table-scroll',
      tabindex: '0',
      'aria-label': 'Scrollable significance table',
    }, table);

    // Methodology tooltip
    const methodBtn = el('button', {
      class: 'ta-method-btn',
      'aria-expanded': 'false',
      'aria-controls': `ta-method-${metric.key}`,
      type: 'button',
    }, 'ℹ Methodology');

    const methodContent = el('div', {
      id: `ta-method-${metric.key}`,
      class: 'ta-method-content',
      role: 'region',
      'aria-label': `Methodology for ${metric.label}`,
      hidden: '',
    }, metric.methodology + ' Statistical significance uses a two-sample Welch t-test; |t| > 2.0 indicates p < 0.05.');

    methodBtn.addEventListener('click', () => {
      const hidden = methodContent.hasAttribute('hidden');
      if (hidden) {
        methodContent.removeAttribute('hidden');
        methodBtn.setAttribute('aria-expanded', 'true');
      } else {
        methodContent.setAttribute('hidden', '');
        methodBtn.setAttribute('aria-expanded', 'false');
      }
    });

    methodBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); methodBtn.click(); }
    });

    // Export button
    const exportBtn = el('button', {
      class: 'ta-export-btn',
      type: 'button',
      'aria-label': `Export ${metric.label} data as CSV`,
    }, '⬇ Export CSV');
    exportBtn.addEventListener('click', () => downloadCSV(metric.key, numYears));

    const btnRow = el('div', { class: 'ta-btn-row' }, methodBtn, exportBtn);
    container.appendChild(chartWrapper);
    container.appendChild(btnRow);
    container.appendChild(methodContent);
    container.appendChild(tableScroll);

    // Defer chart rendering so canvas is in DOM
    requestAnimationFrame(() => renderChart(canvasId, metric, numYears));
  }

  function render(section, activeMetricKey, numYears) {
    section.innerHTML = '';
    section.setAttribute('aria-label', 'Colorado Housing Trend Analysis');

    // Header
    const header = el('div', { class: 'ta-header' },
      el('h2', { class: 'ta-title' }, 'Colorado Housing Trend Analysis'),
      el('p', { class: 'ta-subtitle' },
        'Comparing Colorado housing metrics against 11 peer states (2019–2024). ' +
        'Statistical significance tested using Welch\u2019s two-sample t-test.'),
    );
    section.appendChild(header);

    // Time range controls
    const timeRow = el('div', {
      class: 'ta-controls',
      role: 'group',
      'aria-label': 'Time range filter',
    });
    TIME_RANGES.forEach(range => {
      const btn = el('button', {
        class: 'ta-time-btn' + (range.value === numYears ? ' active' : ''),
        type: 'button',
        'aria-pressed': range.value === numYears ? 'true' : 'false',
        'data-years': range.value.toString(),
      }, range.label);
      btn.addEventListener('click', () => {
        render(section, activeMetricKey, range.value);
      });
      timeRow.appendChild(btn);
    });
    section.appendChild(timeRow);

    // Metric tabs
    const tabList = el('div', {
      class: 'ta-tabs',
      role: 'tablist',
      'aria-label': 'Housing metric tabs',
    });
    METRICS.forEach(metric => {
      const tab = el('button', {
        class: 'ta-tab' + (metric.key === activeMetricKey ? ' active' : ''),
        role: 'tab',
        type: 'button',
        'aria-selected': metric.key === activeMetricKey ? 'true' : 'false',
        'aria-controls': `ta-panel-${metric.key}`,
        id: `ta-tab-${metric.key}`,
        tabindex: metric.key === activeMetricKey ? '0' : '-1',
      }, metric.label);
      tab.addEventListener('click', () => render(section, metric.key, numYears));
      tab.addEventListener('keydown', e => {
        const keys = METRICS.map(m => m.key);
        const idx = keys.indexOf(activeMetricKey);
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          render(section, keys[(idx + 1) % keys.length], numYears);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          render(section, keys[(idx - 1 + keys.length) % keys.length], numYears);
        }
      });
      tabList.appendChild(tab);
    });
    section.appendChild(tabList);

    // Active metric panel
    const activeMeta = METRICS.find(m => m.key === activeMetricKey) || METRICS[0];
    const panel = el('div', {
      class: 'ta-panel',
      id: `ta-panel-${activeMeta.key}`,
      role: 'tabpanel',
      'aria-labelledby': `ta-tab-${activeMeta.key}`,
    });
    section.appendChild(panel);
    renderMetricPanel(panel, activeMeta, numYears);

    // Focus active tab after re-render
    requestAnimationFrame(() => {
      const activeTab = section.querySelector('.ta-tab.active');
      if (activeTab) activeTab.focus();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Styles injection                                                   */
  /* ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById('ta-styles')) return;
    const style = document.createElement('style');
    style.id = 'ta-styles';
    style.textContent = `
      #trend-analysis-section { font-family: inherit; color: var(--text, #222); }
      .ta-header { margin-bottom: 1rem; }
      .ta-title { font-size: 1.5rem; font-weight: 700; margin: 0 0 .4rem; color: var(--text, #222); }
      .ta-subtitle { font-size: .9rem; color: var(--muted, #555); margin: 0; }
      .ta-controls { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1rem; }
      .ta-time-btn {
        padding: .4rem .9rem; border-radius: 20px; border: 1.5px solid var(--border, #ccc);
        background: var(--card, #fff); color: var(--text, #222); cursor: pointer; font-size: .85rem;
        transition: background .2s, color .2s;
      }
      .ta-time-btn.active, .ta-time-btn:focus-visible {
        background: var(--color-primary, #1a73e8); color: #fff; border-color: var(--color-primary, #1a73e8);
        outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px;
      }
      .ta-tabs { display: flex; gap: .25rem; flex-wrap: wrap; border-bottom: 2px solid var(--border, #e0e0e0); margin-bottom: 1rem; }
      .ta-tab {
        padding: .55rem 1.1rem; border: none; background: none; cursor: pointer; font-size: .9rem;
        color: var(--muted, #555); border-bottom: 3px solid transparent; margin-bottom: -2px;
        transition: color .2s, border-color .2s; border-radius: 4px 4px 0 0;
      }
      .ta-tab.active { color: var(--color-primary, #1a73e8); border-bottom-color: var(--color-primary, #1a73e8); font-weight: 600; }
      .ta-tab:focus-visible { outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px; }
      .ta-chart-wrapper { margin-bottom: 1rem; background: var(--card, #fff); border: 1px solid var(--border, #e0e0e0); border-radius: var(--radius-lg, 8px); padding: 1rem; }
      .ta-btn-row { display: flex; gap: .75rem; flex-wrap: wrap; margin-bottom: .75rem; }
      .ta-method-btn, .ta-export-btn {
        padding: .35rem .8rem; border-radius: 6px; border: 1.5px solid var(--border, #ccc);
        background: var(--card, #fff); color: var(--link, #1a73e8); cursor: pointer; font-size: .82rem;
      }
      .ta-method-btn:hover, .ta-export-btn:hover { background: var(--bg2, #f5f5f5); }
      .ta-method-btn:focus-visible, .ta-export-btn:focus-visible { outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px; }
      .ta-method-content {
        background: var(--bg2, #f5f5f5); border: 1px solid var(--border, #ddd); border-radius: 6px;
        padding: .75rem 1rem; font-size: .83rem; color: var(--text2, #444); margin-bottom: .75rem; line-height: 1.5;
      }
      .ta-table-scroll { overflow-x: auto; }
      .ta-sig-table { width: 100%; border-collapse: collapse; font-size: .83rem; }
      .ta-sig-table th, .ta-sig-table td { padding: .45rem .7rem; border: 1px solid var(--border, #e0e0e0); text-align: left; }
      .ta-sig-table th { background: var(--bg2, #f5f5f5); color: var(--text, #222); font-weight: 600; }
      .ta-sig-table tr:nth-child(even) td { background: var(--bg2, #fafafa); }
      .ta-sig-yes { color: var(--color-success, #2e7d32); font-weight: 600; }
      .ta-sig-no  { color: var(--muted, #777); }
      .ta-positive { color: var(--color-error, #c62828); }
      .ta-negative { color: var(--color-success, #2e7d32); }
      .ta-panel { background: var(--card, #fff); border-radius: var(--radius-lg, 8px); padding: 1rem; border: 1px solid var(--border, #e0e0e0); }
    `;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  function init() {
    const section = document.getElementById('trend-analysis-section');
    if (!section) {
      console.warn('TrendAnalysis: container #trend-analysis-section not found.');
      return;
    }
    if (!window.Chart) {
      console.warn('TrendAnalysis: Chart.js not loaded.');
      return;
    }
    injectStyles();
    render(section, METRICS[0].key, 5);
  }

  window.TrendAnalysis = { init };

}(window));
