/**
 * housing-predictions.js
 * Housing Prediction Market Dashboard Module
 * Displays illustrative mock prediction-market-style odds for housing metrics,
 * compares to traditional forecasts, and tracks historical accuracy.
 *
 * ⚠ Data Note: All prediction probabilities and historical data are
 * ILLUSTRATIVE MOCK DATA for demonstration purposes only.
 * They do not represent actual Kalshi, Polymarket, or any other live market data.
 *
 * Usage: HousingPredictions.init()  (call after DOMContentLoaded)
 * Renders into: #housing-predictions-section
 */
(function (window) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Mock prediction data                                               */
  /* ------------------------------------------------------------------ */

  const LAST_UPDATED = '2025-Q1 (Illustrative)';

  // National median home price movement predictions (end-of-year vs prior year)
  const PRICE_PREDICTIONS = [
    { label: '+15% or more',  prob: 4,  marketOdds: '+2400', expertConsensus: 2 },
    { label: '+10% to +15%',  prob: 11, marketOdds: '+809',  expertConsensus: 8 },
    { label: '+5% to +10%',   prob: 28, marketOdds: '+257',  expertConsensus: 30 },
    { label: '0% to +5%',     prob: 35, marketOdds: '+186',  expertConsensus: 40 },
    { label: '-5% to 0%',     prob: 16, marketOdds: '+525',  expertConsensus: 15 },
    { label: '-10% to -5%',   prob: 5,  marketOdds: '+1900', expertConsensus: 4 },
    { label: '-10% or worse', prob: 1,  marketOdds: '+9900', expertConsensus: 1 },
  ];

  // 30-year fixed mortgage rate at year-end
  const MORTGAGE_PREDICTIONS = [
    { label: 'Below 5.5%',    prob: 8,  expertConsensus: 5 },
    { label: '5.5% – 6.0%',   prob: 22, expertConsensus: 18 },
    { label: '6.0% – 6.5%',   prob: 34, expertConsensus: 38 },
    { label: '6.5% – 7.0%',   prob: 25, expertConsensus: 28 },
    { label: '7.0% – 7.5%',   prob: 9,  expertConsensus: 9 },
    { label: 'Above 7.5%',    prob: 2,  expertConsensus: 2 },
  ];

  // Housing starts (millions of units, annualised)
  const STARTS_PREDICTIONS = [
    { label: 'Below 1.2M',    prob: 12, expertConsensus: 10 },
    { label: '1.2M – 1.35M',  prob: 30, expertConsensus: 28 },
    { label: '1.35M – 1.5M',  prob: 35, expertConsensus: 38 },
    { label: '1.5M – 1.65M',  prob: 18, expertConsensus: 20 },
    { label: 'Above 1.65M',   prob: 5,  expertConsensus: 4 },
  ];

  // Rental vacancy rate (national, year-end)
  const VACANCY_PREDICTIONS = [
    { label: 'Below 5%',      prob: 22, expertConsensus: 20 },
    { label: '5% – 6%',       prob: 38, expertConsensus: 42 },
    { label: '6% – 7%',       prob: 28, expertConsensus: 26 },
    { label: 'Above 7%',      prob: 12, expertConsensus: 12 },
  ];

  // Binary / special predictions
  const BINARY_PREDICTIONS = [
    {
      id: 'lihtcContinued',
      label: 'Federal LIHTC funding continues at current levels through 2026',
      probYes: 71,
      expertConsensus: 75,
      category: 'Policy',
      description: 'Probability that Congress maintains LIHTC allocations at 2024 levels or higher through FY2026.',
    },
    {
      id: 'coloradoCorrection',
      label: 'Colorado metro median prices decline >5% by Q4 2025',
      probYes: 14,
      expertConsensus: 11,
      category: 'Colorado',
      description: 'Probability of a meaningful price correction (>5%) in Denver/Front Range metro area by year-end.',
    },
    {
      id: 'coloradoRally',
      label: 'Colorado metro prices rise >8% in 2025',
      probYes: 18,
      expertConsensus: 15,
      category: 'Colorado',
      description: 'Probability of a significant rally in Colorado Front Range home prices exceeding 8% YoY.',
    },
    {
      id: 'recessionHousing',
      label: 'US enters housing-led recession by end of 2025',
      probYes: 9,
      expertConsensus: 7,
      category: 'Macro',
      description: 'Probability of a recession primarily driven by housing market contraction.',
    },
    {
      id: 'mortgageSub6',
      label: '30-yr mortgage rate falls below 6% by Q3 2025',
      probYes: 29,
      expertConsensus: 24,
      category: 'Rates',
      description: 'Probability of 30-year fixed rate declining below 6% by end of Q3 2025.',
    },
    {
      id: 'coloradoZoning',
      label: 'Colorado statewide zoning reform bill passes in 2025 session',
      probYes: 44,
      expertConsensus: 40,
      category: 'Colorado',
      description: 'Probability that Colorado passes meaningful statewide zoning reform legislation in the 2025 legislative session.',
    },
  ];

  // Colorado-specific predictions
  const COLORADO_PREDICTIONS = [
    { label: 'Denver metro median price 2025', value: '$578k', range: '$545k – $615k', trend: 'up', change: '+1.1%' },
    { label: 'Colorado rental vacancy 2025',   value: '4.1%',  range: '3.6% – 4.8%',  trend: 'up', change: '+0.1pp' },
    { label: 'CO construction starts 2025',    value: '61.5k', range: '57k – 66k',    trend: 'down', change: '-2.9%' },
    { label: 'CO LIHTC units 2025',            value: '2,480', range: '2,200 – 2,750', trend: 'up', change: '+3.3%' },
    { label: 'Denver rent growth 2025',        value: '3.4%',  range: '2.1% – 5.1%',  trend: 'neutral', change: '−0.4pp' },
  ];

  // Historical accuracy tracking
  const ACCURACY_HISTORY = [
    { year: 2022, category: 'Price Movement', marketProb: 72, actual: 'Correct', direction: 'prices rose >5%' },
    { year: 2022, category: 'Mortgage Rate',  marketProb: 61, actual: 'Correct', direction: 'rates above 6%' },
    { year: 2022, category: 'Housing Starts', marketProb: 48, actual: 'Incorrect', direction: 'starts fell' },
    { year: 2023, category: 'Price Movement', marketProb: 55, actual: 'Correct', direction: 'prices stable/slight gain' },
    { year: 2023, category: 'Mortgage Rate',  marketProb: 67, actual: 'Correct', direction: 'rates remained elevated' },
    { year: 2023, category: 'Vacancy Rate',   marketProb: 58, actual: 'Correct', direction: 'vacancy rose' },
    { year: 2024, category: 'Price Movement', marketProb: 62, actual: 'Correct', direction: 'modest price gains' },
    { year: 2024, category: 'LIHTC Policy',   marketProb: 78, actual: 'Correct', direction: 'funding maintained' },
  ];

  /* ------------------------------------------------------------------ */
  /*  Chart instances cache                                              */
  /* ------------------------------------------------------------------ */

  const _charts = {};

  function destroyChart(id) {
    if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  }

  /* ------------------------------------------------------------------ */
  /*  DOM helpers                                                        */
  /* ------------------------------------------------------------------ */

  function el(tag, attrs, ...children) {
    attrs = attrs || {};
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

  /* ------------------------------------------------------------------ */
  /*  Probability bar component                                         */
  /* ------------------------------------------------------------------ */

  function buildProbBar(prob, comparison, label, id) {
    const container = el('div', { class: 'hp-prob-row', role: 'row' });
    container.appendChild(el('span', { class: 'hp-prob-label', id: id + '-label' }, label));

    const barWrap = el('div', { class: 'hp-bar-wrap' });

    // Market bar
    const mktBar = el('div', {
      class: 'hp-bar hp-bar--market',
      style: `width:${prob}%`,
      role: 'img',
      'aria-label': `Market probability: ${prob}%`,
      title: `Market: ${prob}%`,
    });
    barWrap.appendChild(mktBar);

    // Expert bar (dashed overlay)
    const expBar = el('div', {
      class: 'hp-bar hp-bar--expert',
      style: `width:${comparison}%`,
      role: 'img',
      'aria-label': `Expert consensus: ${comparison}%`,
      title: `Expert consensus: ${comparison}%`,
    });
    barWrap.appendChild(expBar);

    container.appendChild(barWrap);
    container.appendChild(el('span', { class: 'hp-prob-pct' }, `${prob}%`));
    return container;
  }

  /* ------------------------------------------------------------------ */
  /*  Distribution chart                                                 */
  /* ------------------------------------------------------------------ */

  function renderDistributionChart(canvasId, data, title, ariaLabel) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    destroyChart(canvasId);
    _charts[canvasId] = new window.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'Prediction Market (%)',
            data: data.map(d => d.prob),
            backgroundColor: 'rgba(26, 115, 232, 0.75)',
            borderColor: 'rgba(26, 115, 232, 1)',
            borderWidth: 1.5,
            borderRadius: 4,
          },
          {
            label: 'Expert Consensus (%)',
            data: data.map(d => d.expertConsensus),
            backgroundColor: 'rgba(251, 140, 0, 0.55)',
            borderColor: 'rgba(251, 140, 0, 1)',
            borderWidth: 1.5,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: title, font: { size: 13, weight: '600' } },
          legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 50,
            title: { display: true, text: 'Probability (%)' },
          },
        },
      },
    });
    canvas.setAttribute('aria-label', ariaLabel);
  }

  /* ------------------------------------------------------------------ */
  /*  Binary prediction cards                                            */
  /* ------------------------------------------------------------------ */

  function buildBinaryCard(pred) {
    const pctYes = pred.probYes;
    const pctNo  = 100 - pctYes;
    const diff   = pctYes - pred.expertConsensus;
    const diffStr = (diff > 0 ? '+' : '') + diff + 'pp vs experts';
    const diffClass = diff > 0 ? 'hp-diff-higher' : diff < 0 ? 'hp-diff-lower' : 'hp-diff-neutral';
    const categoryColors = {
      Colorado: 'var(--color-primary, #1a73e8)',
      Policy:   'var(--color-success, #2e7d32)',
      Macro:    'var(--color-error, #c62828)',
      Rates:    'var(--color-warning, #e65100)',
    };

    const card = el('div', {
      class: 'hp-binary-card',
      role: 'article',
      'aria-label': pred.label,
      style: `--hp-cat-color: ${categoryColors[pred.category] || '#546e7a'}`,
    });

    card.appendChild(el('span', { class: 'hp-category-badge' }, pred.category));
    card.appendChild(el('p', { class: 'hp-binary-label' }, pred.label));
    card.appendChild(el('p', { class: 'hp-binary-desc' }, pred.description));

    const oddsRow = el('div', { class: 'hp-odds-row' });
    oddsRow.appendChild(el('div', { class: 'hp-odds-yes' },
      el('span', { class: 'hp-odds-pct' }, `${pctYes}%`),
      el('span', { class: 'hp-odds-lbl' }, 'YES'),
    ));
    oddsRow.appendChild(el('div', { class: 'hp-odds-sep' }, '/'));
    oddsRow.appendChild(el('div', { class: 'hp-odds-no' },
      el('span', { class: 'hp-odds-pct' }, `${pctNo}%`),
      el('span', { class: 'hp-odds-lbl' }, 'NO'),
    ));
    card.appendChild(oddsRow);

    // Visual bar
    const barFill = el('div', {
      class: 'hp-binary-bar-fill',
      style: `width:${pctYes}%`,
      role: 'presentation',
    });
    card.appendChild(el('div', {
      class: 'hp-binary-bar',
      role: 'img',
      'aria-label': `Yes probability: ${pctYes}%`,
    }, barFill));

    card.appendChild(el('span', { class: 'hp-diff ' + diffClass }, diffStr));
    return card;
  }

  /* ------------------------------------------------------------------ */
  /*  Historical accuracy table                                          */
  /* ------------------------------------------------------------------ */

  function buildAccuracyTable() {
    const thead = el('thead', {},
      el('tr', {},
        el('th', { scope: 'col' }, 'Year'),
        el('th', { scope: 'col' }, 'Category'),
        el('th', { scope: 'col' }, 'Market Prob.'),
        el('th', { scope: 'col' }, 'Outcome'),
        el('th', { scope: 'col' }, 'Detail'),
      ),
    );
    const tbody = el('tbody', {});
    ACCURACY_HISTORY.forEach(row => {
      tbody.appendChild(el('tr', {},
        el('td', {}, row.year.toString()),
        el('td', {}, row.category),
        el('td', {}, `${row.marketProb}%`),
        el('td', { class: row.actual === 'Correct' ? 'hp-acc-correct' : 'hp-acc-wrong' },
          row.actual === 'Correct' ? '✓ Correct' : '✗ Incorrect'),
        el('td', {}, row.direction),
      ));
    });
    return el('div', { class: 'hp-table-scroll' },
      el('table', {
        class: 'hp-acc-table',
        'aria-label': 'Historical prediction market accuracy tracking',
      }, thead, tbody),
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Colorado predictions panel                                        */
  /* ------------------------------------------------------------------ */

  function buildColoradoPanel() {
    const panel = el('div', { class: 'hp-co-panel', role: 'region', 'aria-label': 'Colorado-specific predictions' });
    panel.appendChild(el('h3', { class: 'hp-section-heading' }, '🏔 Colorado-Specific Predictions'));

    const grid = el('div', { class: 'hp-co-grid' });
    COLORADO_PREDICTIONS.forEach(pred => {
      const trendIcon = pred.trend === 'up' ? '▲' : pred.trend === 'down' ? '▼' : '→';
      const trendClass = pred.trend === 'up' ? 'hp-trend-up' : pred.trend === 'down' ? 'hp-trend-down' : 'hp-trend-neutral';
      const item = el('div', { class: 'hp-co-item', role: 'article', 'aria-label': pred.label });
      item.appendChild(el('p', { class: 'hp-co-label' }, pred.label));
      item.appendChild(el('p', { class: 'hp-co-value' },
        pred.value,
        el('span', { class: `hp-trend-icon ${trendClass}`, 'aria-label': pred.trend }, ` ${trendIcon}`),
      ));
      item.appendChild(el('p', { class: 'hp-co-range' }, `Range: ${pred.range}`));
      item.appendChild(el('p', { class: `hp-co-change ${trendClass}` }, pred.change));
      grid.appendChild(item);
    });
    panel.appendChild(grid);
    return panel;
  }

  /* ------------------------------------------------------------------ */
  /*  Main render                                                        */
  /* ------------------------------------------------------------------ */

  function render(section) {
    section.innerHTML = '';
    section.setAttribute('aria-label', 'Housing Prediction Market Dashboard');

    // Header + disclaimer
    section.appendChild(el('div', { class: 'hp-header' },
      el('h2', { class: 'hp-title' }, 'Housing Prediction Market Dashboard'),
      el('p', { class: 'hp-subtitle' },
        'Illustrative prediction-market-style probabilities for key housing metrics. ' +
        'Compared against traditional expert consensus forecasts (Fed, NAR, Census Bureau).',
      ),
      el('div', { class: 'hp-disclaimer', role: 'note', 'aria-label': 'Data disclaimer' },
        '⚠ DISCLAIMER: All data shown is ILLUSTRATIVE MOCK DATA for demonstration purposes only. ' +
        'It does not represent actual Kalshi, Polymarket, or any real prediction market data. ' +
        `Last updated: ${LAST_UPDATED}.`,
      ),
    ));

    // Legend
    const legend = el('div', { class: 'hp-legend', 'aria-label': 'Chart legend' });
    legend.appendChild(el('span', { class: 'hp-legend-item hp-legend-market' }, '■ Prediction Market'));
    legend.appendChild(el('span', { class: 'hp-legend-item hp-legend-expert' }, '■ Expert Consensus'));
    section.appendChild(legend);

    // Distribution charts grid
    const chartsGrid = el('div', { class: 'hp-charts-grid' });

    const chartDefs = [
      { id: 'hp-chart-price',    data: PRICE_PREDICTIONS,    title: 'National Median Price Change (YoY)',    aria: 'Probability distribution: national home price change' },
      { id: 'hp-chart-mortgage', data: MORTGAGE_PREDICTIONS, title: '30-Year Fixed Mortgage Rate (Year-End)', aria: 'Probability distribution: 30-year mortgage rate' },
      { id: 'hp-chart-starts',   data: STARTS_PREDICTIONS,   title: 'Housing Starts (Annualised, Millions)',  aria: 'Probability distribution: housing starts' },
      { id: 'hp-chart-vacancy',  data: VACANCY_PREDICTIONS,  title: 'National Rental Vacancy Rate (Year-End)', aria: 'Probability distribution: rental vacancy rate' },
    ];

    chartDefs.forEach(def => {
      const wrap = el('div', { class: 'hp-chart-card' });
      wrap.appendChild(el('div', { style: 'height:260px;position:relative;' },
        el('canvas', { id: def.id, role: 'img' }),
      ));
      chartsGrid.appendChild(wrap);
    });
    section.appendChild(chartsGrid);

    // Binary predictions
    section.appendChild(el('h3', { class: 'hp-section-heading' }, 'Key Binary Predictions'));
    const binaryGrid = el('div', {
      class: 'hp-binary-grid',
      role: 'list',
      'aria-label': 'Binary housing predictions',
    });
    BINARY_PREDICTIONS.forEach(pred => binaryGrid.appendChild(buildBinaryCard(pred)));
    section.appendChild(binaryGrid);

    // Colorado section
    section.appendChild(buildColoradoPanel());

    // Historical accuracy
    section.appendChild(el('h3', { class: 'hp-section-heading' }, 'Historical Accuracy (Mock)'));
    section.appendChild(el('p', { class: 'hp-acc-note' },
      'Illustrative historical accuracy table. In a real implementation, this would track actual ' +
      'prediction market performance vs. realized outcomes.',
    ));
    section.appendChild(buildAccuracyTable());

    // Methodology
    section.appendChild(el('div', { class: 'hp-methodology', role: 'region', 'aria-label': 'Methodology explanation' },
      el('h3', { class: 'hp-section-heading' }, 'Methodology & Sources'),
      el('p', {}, 'Prediction market probabilities are derived by converting implied odds to direct probabilities, ' +
        'deducting the "vig" (overround), and normalising to 100%. Expert consensus is aggregated from: ' +
        'Federal Reserve Monetary Policy Reports, NAR Economic Outlook, Census Bureau HVS, Zillow Research, ' +
        'Moody\'s Analytics, and CoreLogic market insights.'),
      el('p', {}, 'Colorado-specific predictions incorporate CHFA affordable housing reports, ' +
        'Colorado Division of Housing data, and Denver Metro Association of Realtors statistics.'),
    ));
  }

  /* ------------------------------------------------------------------ */
  /*  Styles injection                                                   */
  /* ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById('hp-styles')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/predictions-dashboard.css';
    link.id = 'hp-styles-link';
    document.head.appendChild(link);

    // Inline critical overrides
    const style = document.createElement('style');
    style.id = 'hp-styles';
    style.textContent = `
      #housing-predictions-section { font-family: inherit; color: var(--text, #222); }
    `;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  function init() {
    const section = document.getElementById('housing-predictions-section');
    if (!section) {
      console.warn('HousingPredictions: container #housing-predictions-section not found.');
      return;
    }
    if (!window.Chart) {
      console.warn('HousingPredictions: Chart.js not loaded.');
      return;
    }
    injectStyles();
    render(section);

    // Defer chart rendering so canvas elements are in DOM
    requestAnimationFrame(() => {
      const chartDefs = [
        { id: 'hp-chart-price',    data: PRICE_PREDICTIONS,    title: 'National Median Price Change (YoY)',     aria: 'Probability distribution: national home price change' },
        { id: 'hp-chart-mortgage', data: MORTGAGE_PREDICTIONS, title: '30-Year Fixed Mortgage Rate (Year-End)', aria: 'Probability distribution: 30-year mortgage rate' },
        { id: 'hp-chart-starts',   data: STARTS_PREDICTIONS,   title: 'Housing Starts (Annualised, Millions)',  aria: 'Probability distribution: housing starts' },
        { id: 'hp-chart-vacancy',  data: VACANCY_PREDICTIONS,  title: 'National Rental Vacancy Rate (Year-End)', aria: 'Probability distribution: rental vacancy rate' },
      ];
      chartDefs.forEach(def => renderDistributionChart(def.id, def.data, def.title, def.aria));
    });
  }

  window.HousingPredictions = { init };

}(window));
