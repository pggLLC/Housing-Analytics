/**
 * policy-simulator.js
 * Colorado LIHTC Housing Policy Simulator Module
 * Compares five policy scenarios with cost, ROI, and impact metrics.
 * Supports CSV export and Chart.js visualizations.
 *
 * Usage: PolicySimulator.init()  (call after DOMContentLoaded)
 * Renders into: #policy-simulator-section
 */
(function (window) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Scenario data                                                      */
  /* ------------------------------------------------------------------ */

  const SCENARIOS = [
    {
      id: 'current',
      label: 'Current Policy',
      description: 'Colorado's baseline LIHTC program: standard 9% and 4% tax credits per current federal/state allocation rules.',
      color: '#546e7a',
      unitsProduced: 2400,
      totalPublicCostM: 312,      // $ millions
      taxRevenueM: 198,           // $ millions (property tax + income tax)
      economicMultiplier: 1.8,
      householdsServed: 2400,
      avgAmiFocus: 60,            // % AMI threshold
      ruralShare: 14,             // % units in rural areas
    },
    {
      id: 'basisBoost',
      label: 'Basis Boost Expansion',
      description: 'Expand 30% basis boost to all Difficult Development Areas (DDAs) and Qualified Census Tracts (QCTs) statewide, including rural counties.',
      color: '#1a73e8',
      unitsProduced: 3100,
      totalPublicCostM: 388,
      taxRevenueM: 256,
      economicMultiplier: 1.85,
      householdsServed: 3100,
      avgAmiFocus: 60,
      ruralShare: 22,
    },
    {
      id: 'perCapita',
      label: 'Increased Per-Capita Allocation',
      description: 'Increase Colorado's per-capita LIHTC allocation from $2.75 to $4.00 (matching highest-performing state programs).',
      color: '#43a047',
      unitsProduced: 3800,
      totalPublicCostM: 472,
      taxRevenueM: 310,
      economicMultiplier: 1.82,
      householdsServed: 3800,
      avgAmiFocus: 60,
      ruralShare: 15,
    },
    {
      id: 'zoningReform',
      label: 'Zoning Reform + LIHTC',
      description: 'Pair statewide zoning reform (ADU legalization, transit corridor upzoning) with LIHTC to reduce land and construction costs by ~12%.',
      color: '#fb8c00',
      unitsProduced: 4500,
      totalPublicCostM: 498,
      taxRevenueM: 372,
      economicMultiplier: 2.1,
      householdsServed: 5200,     // includes market-rate spillover
      avgAmiFocus: 60,
      ruralShare: 18,
    },
    {
      id: 'ruralFocus',
      label: 'Rural Focus Program',
      description: 'Dedicated rural LIHTC set-aside (35% of state credits) with enhanced basis boost and simplified compliance for small rural developments.',
      color: '#8e24aa',
      unitsProduced: 2800,
      totalPublicCostM: 356,
      taxRevenueM: 228,
      economicMultiplier: 1.9,
      householdsServed: 2800,
      avgAmiFocus: 50,
      ruralShare: 45,
    },
  ];

  /* ------------------------------------------------------------------ */
  /*  Derived metrics                                                    */
  /* ------------------------------------------------------------------ */

  function enrichScenario(s) {
    const costPerUnit = Math.round((s.totalPublicCostM * 1e6) / s.unitsProduced);
    const roi = parseFloat(
      (((s.taxRevenueM + s.totalPublicCostM * (s.economicMultiplier - 1)) /
        s.totalPublicCostM) * 100).toFixed(1),
    );
    return { ...s, costPerUnit, roi };
  }

  const ENRICHED = SCENARIOS.map(enrichScenario);

  /* ------------------------------------------------------------------ */
  /*  CSV export                                                         */
  /* ------------------------------------------------------------------ */

  function downloadCSV() {
    const headers = [
      'Scenario', 'Units Produced', 'Total Public Cost ($M)',
      'Cost Per Unit ($)', 'Tax Revenue ($M)', 'Economic Multiplier',
      'ROI (%)', 'Households Served', 'Avg AMI Focus (%)', 'Rural Share (%)',
    ];
    const rows = ENRICHED.map(s => [
      s.label, s.unitsProduced, s.totalPublicCostM,
      s.costPerUnit, s.taxRevenueM, s.economicMultiplier,
      s.roi, s.householdsServed, s.avgAmiFocus, s.ruralShare,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'colorado-lihtc-policy-scenarios.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ */
  /*  Chart rendering                                                    */
  /* ------------------------------------------------------------------ */

  const _charts = {};

  function destroyChart(id) {
    if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  }

  function renderBarChart(canvasId, labels, datasets, title, ariaLabel) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    destroyChart(canvasId);
    _charts[canvasId] = new window.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 12 } } },
          title: { display: !!title, text: title, font: { size: 13, weight: '600' } },
        },
        scales: {
          y: { beginAtZero: true },
        },
        aria: { label: ariaLabel },
      },
    });
    canvas.setAttribute('aria-label', ariaLabel || title);
  }

  function renderRadarChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    destroyChart(canvasId);

    // Normalise metrics to 0-100 scale for radar
    const maxUnits = Math.max(...ENRICHED.map(s => s.unitsProduced));
    const maxCost  = Math.max(...ENRICHED.map(s => s.costPerUnit));
    const maxROI   = Math.max(...ENRICHED.map(s => s.roi));
    const maxHH    = Math.max(...ENRICHED.map(s => s.householdsServed));
    const maxRural = Math.max(...ENRICHED.map(s => s.ruralShare));

    const datasets = ENRICHED.map(s => ({
      label: s.label,
      data: [
        (s.unitsProduced / maxUnits) * 100,
        (1 - s.costPerUnit / maxCost) * 100,   // inverted: lower cost = better
        (s.roi / maxROI) * 100,
        (s.householdsServed / maxHH) * 100,
        (s.ruralShare / maxRural) * 100,
      ],
      borderColor: s.color,
      backgroundColor: s.color + '22',
      pointBackgroundColor: s.color,
    }));

    _charts[canvasId] = new window.Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels: ['Units Produced', 'Cost Efficiency', 'ROI', 'Households Served', 'Rural Reach'],
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 12 } } },
          title: { display: true, text: 'Policy Scenario Comparison (normalised to 100)', font: { size: 13, weight: '600' } },
        },
        scales: {
          r: { min: 0, max: 100, ticks: { stepSize: 25 } },
        },
      },
    });
    canvas.setAttribute('aria-label', 'Radar chart comparing all policy scenarios across key metrics');
  }

  /* ------------------------------------------------------------------ */
  /*  DOM helpers                                                        */
  /* ------------------------------------------------------------------ */

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    children.forEach(child => {
      if (!child && child !== 0) return;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    });
    return node;
  }

  function fmt(n) {
    return n.toLocaleString('en-US');
  }

  /* ------------------------------------------------------------------ */
  /*  Scenario card                                                      */
  /* ------------------------------------------------------------------ */

  function buildScenarioCard(s, isActive) {
    const card = el('div', {
      class: 'ps-card' + (isActive ? ' ps-card--active' : ''),
      tabindex: '0',
      role: 'article',
      'aria-label': `Policy scenario: ${s.label}`,
      style: `--ps-accent: ${s.color}`,
      'data-id': s.id,
    });

    const badge = el('span', { class: 'ps-badge' }, s.label);
    card.appendChild(badge);
    card.appendChild(el('p', { class: 'ps-desc' }, s.description));

    const grid = el('div', { class: 'ps-metrics-grid' });
    const metrics = [
      { label: 'Units Produced', value: fmt(s.unitsProduced), icon: '🏠' },
      { label: 'Total Public Cost', value: `$${s.totalPublicCostM}M`, icon: '💰' },
      { label: 'Cost Per Unit', value: `$${fmt(s.costPerUnit)}`, icon: '📊' },
      { label: 'ROI', value: `${s.roi}%`, icon: '📈' },
      { label: 'Households Served', value: fmt(s.householdsServed), icon: '👨‍👩‍👧' },
      { label: 'Rural Share', value: `${s.ruralShare}%`, icon: '🌾' },
    ];
    metrics.forEach(m => {
      const item = el('div', { class: 'ps-metric-item' },
        el('span', { class: 'ps-metric-icon', 'aria-hidden': 'true' }, m.icon),
        el('span', { class: 'ps-metric-value' }, m.value),
        el('span', { class: 'ps-metric-label' }, m.label),
      );
      grid.appendChild(item);
    });
    card.appendChild(grid);

    // AMI focus bar
    const amiFill = el('div', {
      class: 'ps-ami-fill',
      style: `width:${s.avgAmiFocus}%`,
      role: 'presentation',
    });
    card.appendChild(el('div', { class: 'ps-ami-row' },
      el('span', { class: 'ps-ami-label' }, `AMI Focus: ${s.avgAmiFocus}%`),
      el('div', { class: 'ps-ami-bar', 'aria-label': `AMI focus ${s.avgAmiFocus} percent`, role: 'img' }, amiFill),
    ));

    return card;
  }

  /* ------------------------------------------------------------------ */
  /*  Main render                                                        */
  /* ------------------------------------------------------------------ */

  function render(section, activeId) {
    section.innerHTML = '';
    section.setAttribute('aria-label', 'Colorado LIHTC Policy Simulator');

    // Header
    section.appendChild(el('div', { class: 'ps-header' },
      el('h2', { class: 'ps-title' }, 'LIHTC Policy Simulator'),
      el('p', { class: 'ps-subtitle' },
        'Compare five Colorado LIHTC policy scenarios side-by-side. ' +
        'Metrics are modelled estimates based on historical program data and policy analysis.',
      ),
    ));

    // Export button
    const exportBtn = el('button', {
      class: 'ps-export-btn',
      type: 'button',
      'aria-label': 'Export scenario comparison as CSV',
    }, '⬇ Export Comparison CSV');
    exportBtn.addEventListener('click', downloadCSV);
    section.appendChild(exportBtn);

    // Scenario cards
    const cardsGrid = el('div', {
      class: 'ps-cards-grid',
      role: 'list',
      'aria-label': 'Policy scenario cards',
    });
    ENRICHED.forEach(s => {
      const card = buildScenarioCard(s, s.id === activeId);
      card.addEventListener('click', () => render(section, s.id));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); render(section, s.id); }
      });
      cardsGrid.appendChild(card);
    });
    section.appendChild(cardsGrid);

    // Charts section
    const chartsSection = el('div', { class: 'ps-charts-section' });
    section.appendChild(chartsSection);

    chartsSection.appendChild(el('h3', { class: 'ps-chart-heading' }, 'Visual Comparison'));

    // Row 1: Bar charts
    const barRow = el('div', { class: 'ps-bar-row' });

    const unitsWrap = el('div', { class: 'ps-chart-card' }, el('div', { style: 'height:260px;position:relative;' },
      el('canvas', { id: 'ps-chart-units', role: 'img' }),
    ));
    const costWrap = el('div', { class: 'ps-chart-card' }, el('div', { style: 'height:260px;position:relative;' },
      el('canvas', { id: 'ps-chart-cost', role: 'img' }),
    ));
    const roiWrap = el('div', { class: 'ps-chart-card' }, el('div', { style: 'height:260px;position:relative;' },
      el('canvas', { id: 'ps-chart-roi', role: 'img' }),
    ));
    barRow.appendChild(unitsWrap);
    barRow.appendChild(costWrap);
    barRow.appendChild(roiWrap);
    chartsSection.appendChild(barRow);

    // Row 2: Radar
    const radarWrap = el('div', { class: 'ps-chart-card ps-chart-card--wide' }, el('div', { style: 'height:340px;position:relative;' },
      el('canvas', { id: 'ps-chart-radar', role: 'img' }),
    ));
    chartsSection.appendChild(radarWrap);

    // Methodology note
    section.appendChild(el('p', { class: 'ps-methodology' },
      '📋 Methodology: Unit and cost projections are modelled from Colorado CHFA annual reports, ' +
      'HUD LIHTC Database, Urban Institute research, and Colorado Office of Economic Development fiscal notes. ' +
      'ROI includes direct tax revenue, construction employment multiplier (IMPLAN), and ongoing property tax streams. ' +
      'All figures are illustrative estimates for comparative policy analysis.',
    ));

    // Defer chart rendering
    requestAnimationFrame(() => {
      const labels = ENRICHED.map(s => s.label);
      const colors = ENRICHED.map(s => s.color);

      renderBarChart(
        'ps-chart-units',
        labels,
        [{ label: 'Units Produced', data: ENRICHED.map(s => s.unitsProduced), backgroundColor: colors }],
        'Affordable Units Produced',
        'Bar chart: units produced per policy scenario',
      );

      renderBarChart(
        'ps-chart-cost',
        labels,
        [{ label: 'Cost Per Unit ($)', data: ENRICHED.map(s => s.costPerUnit), backgroundColor: colors }],
        'Cost Per Unit ($)',
        'Bar chart: cost per unit per policy scenario',
      );

      renderBarChart(
        'ps-chart-roi',
        labels,
        [{ label: 'ROI (%)', data: ENRICHED.map(s => s.roi), backgroundColor: colors }],
        'Return on Investment (%)',
        'Bar chart: ROI per policy scenario',
      );

      renderRadarChart('ps-chart-radar');
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Styles injection                                                   */
  /* ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById('ps-styles')) return;
    const style = document.createElement('style');
    style.id = 'ps-styles';
    style.textContent = `
      #policy-simulator-section { font-family: inherit; color: var(--text, #222); }
      .ps-header { margin-bottom: 1rem; }
      .ps-title { font-size: 1.5rem; font-weight: 700; margin: 0 0 .4rem; }
      .ps-subtitle { font-size: .9rem; color: var(--muted, #555); margin: 0 0 1rem; }
      .ps-export-btn {
        margin-bottom: 1.25rem; padding: .4rem .9rem; border-radius: 6px;
        border: 1.5px solid var(--border, #ccc); background: var(--card, #fff);
        color: var(--link, #1a73e8); cursor: pointer; font-size: .85rem;
      }
      .ps-export-btn:hover { background: var(--bg2, #f5f5f5); }
      .ps-export-btn:focus-visible { outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px; }
      .ps-cards-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 1rem; margin-bottom: 1.5rem;
      }
      .ps-card {
        background: var(--card, #fff); border: 2px solid var(--border, #e0e0e0);
        border-radius: var(--radius-lg, 8px); padding: 1rem; cursor: pointer;
        transition: border-color .2s, box-shadow .2s;
        border-top: 4px solid var(--ps-accent, #546e7a);
      }
      .ps-card:hover, .ps-card:focus-visible { box-shadow: 0 4px 16px rgba(0,0,0,.12); outline: none; }
      .ps-card--active { border-color: var(--ps-accent, #1a73e8); box-shadow: 0 0 0 3px rgba(26,115,232,.18); }
      .ps-card:focus-visible { outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px; }
      .ps-badge {
        display: inline-block; font-size: .78rem; font-weight: 700; padding: .2rem .6rem;
        border-radius: 12px; background: var(--ps-accent, #546e7a); color: #fff; margin-bottom: .5rem;
      }
      .ps-desc { font-size: .83rem; color: var(--text2, #444); margin: 0 0 .75rem; line-height: 1.45; }
      .ps-metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4rem; margin-bottom: .75rem; }
      .ps-metric-item { display: flex; flex-direction: column; align-items: center; text-align: center; background: var(--bg2, #f5f5f5); border-radius: 6px; padding: .4rem .3rem; }
      .ps-metric-icon { font-size: 1.1rem; }
      .ps-metric-value { font-size: .95rem; font-weight: 700; color: var(--text, #222); }
      .ps-metric-label { font-size: .7rem; color: var(--muted, #666); }
      .ps-ami-row { display: flex; align-items: center; gap: .5rem; }
      .ps-ami-label { font-size: .75rem; color: var(--muted, #666); white-space: nowrap; }
      .ps-ami-bar { flex: 1; height: 8px; background: var(--border, #ddd); border-radius: 4px; overflow: hidden; }
      .ps-ami-fill { height: 100%; background: var(--ps-accent, #1a73e8); border-radius: 4px; }
      .ps-charts-section { margin-top: 1.5rem; }
      .ps-chart-heading { font-size: 1.1rem; font-weight: 600; margin: 0 0 .75rem; }
      .ps-bar-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
      .ps-chart-card { background: var(--card, #fff); border: 1px solid var(--border, #e0e0e0); border-radius: var(--radius-lg, 8px); padding: 1rem; }
      .ps-chart-card--wide { width: 100%; max-width: 720px; }
      .ps-methodology { font-size: .8rem; color: var(--muted, #777); background: var(--bg2, #f9f9f9); border-left: 3px solid var(--border, #ccc); padding: .75rem 1rem; border-radius: 0 6px 6px 0; margin-top: 1rem; line-height: 1.5; }
    `;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  function init() {
    const section = document.getElementById('policy-simulator-section');
    if (!section) {
      console.warn('PolicySimulator: container #policy-simulator-section not found.');
      return;
    }
    if (!window.Chart) {
      console.warn('PolicySimulator: Chart.js not loaded.');
      return;
    }
    injectStyles();
    render(section, 'current');
  }

  window.PolicySimulator = { init };

}(window));
