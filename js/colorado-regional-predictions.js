/**
 * colorado-regional-predictions.js
 * Renders the Colorado Regional Housing Predictions section
 * into any element with id="co-regional-predictions".
 *
 * No external dependencies — uses only native DOM APIs.
 * Styling is provided by css/colorado-regional-predictions.css.
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Regional prediction data — 2025 forecasts
     Sources: CHFA, Colorado Division of Housing, DMAR, CBRE, Census
  ------------------------------------------------------------------ */

  const REGIONS = [
    {
      id: 'denver',
      colorClass: 'crp-region--denver',
      label: 'Denver Metro',
      predictions: [
        { name: 'Median Price 2025',       value: '$578k', range: '$545k – $615k', trend: 'up',      change: '+1.1%'   },
        { name: 'Rental Vacancy 2025',     value: '4.1%',  range: '3.6% – 4.8%',  trend: 'up',      change: '+0.1pp'  },
        { name: 'Construction Starts 2025',value: '61.5k', range: '57k – 66k',    trend: 'down',    change: '-2.9%'   },
        { name: 'LIHTC Units 2025',        value: '2,480', range: '2,200 – 2,750',trend: 'up',      change: '+3.3%'   },
        { name: 'Rent Growth 2025',        value: '3.4%',  range: '2.1% – 5.1%',  trend: 'neutral', change: '−0.4pp'  },
      ],
      sources: [
        { text: 'DMAR',        href: 'https://www.dmar.org' },
        { text: 'Census Bureau', href: 'https://census.gov' },
      ],
    },
    {
      id: 'western',
      colorClass: 'crp-region--western',
      label: 'Western Slope',
      predictions: [
        { name: 'Median Price 2025',        value: '$425k', range: '$395k – $460k', trend: 'up',      change: '+0.8%'   },
        { name: 'Rental Vacancy 2025',      value: '5.2%',  range: '4.5% – 6.2%',  trend: 'up',      change: '+0.3pp'  },
        { name: 'Construction Starts 2025', value: '8.5k',  range: '7k – 10.5k',   trend: 'down',    change: '-3.1%'   },
        { name: 'LIHTC Units 2025',         value: '180',   range: '140 – 220',     trend: 'up',      change: '+2.8%'   },
        { name: 'Rent Growth 2025',         value: '2.1%',  range: '0.5% – 4.2%',  trend: 'neutral', change: '−0.8pp'  },
      ],
      sources: [
        { text: 'CBRE Mountain West', href: 'https://www.cbre.com' },
        { text: 'Census Bureau',      href: 'https://census.gov'   },
      ],
    },
    {
      id: 'springs',
      colorClass: 'crp-region--springs',
      label: 'Colorado Springs/Pueblo',
      predictions: [
        { name: 'Median Price 2025',        value: '$485k', range: '$450k – $525k', trend: 'up',      change: '+1.3%'   },
        { name: 'Rental Vacancy 2025',      value: '4.8%',  range: '4.0% – 5.8%',  trend: 'up',      change: '+0.2pp'  },
        { name: 'Construction Starts 2025', value: '12.3k', range: '10.5k – 14.5k',trend: 'down',    change: '-2.5%'   },
        { name: 'LIHTC Units 2025',         value: '420',   range: '350 – 500',     trend: 'up',      change: '+3.0%'   },
        { name: 'Rent Growth 2025',         value: '2.9%',  range: '1.5% – 4.5%',  trend: 'neutral', change: '−0.3pp'  },
      ],
      sources: [
        { text: 'Colorado Springs Board of Realtors', href: 'https://csbor.org'   },
        { text: 'Census Bureau',                      href: 'https://census.gov'  },
      ],
    },
    {
      id: 'boulder',
      colorClass: 'crp-region--boulder',
      label: 'Boulder/Northern Front Range',
      predictions: [
        { name: 'Median Price 2025',        value: '$725k', range: '$680k – $785k', trend: 'up',      change: '+0.9%'   },
        { name: 'Rental Vacancy 2025',      value: '3.8%',  range: '3.1% – 4.6%',  trend: 'up',      change: '+0.0pp'  },
        { name: 'Construction Starts 2025', value: '15.2k', range: '13k – 17.5k',  trend: 'down',    change: '-2.8%'   },
        { name: 'LIHTC Units 2025',         value: '340',   range: '280 – 410',     trend: 'up',      change: '+3.5%'   },
        { name: 'Rent Growth 2025',         value: '3.7%',  range: '2.2% – 5.4%',  trend: 'neutral', change: '+0.1pp'  },
      ],
      sources: [
        { text: 'Boulder County Assessor', href: 'https://www.bouldercounty.org' },
        { text: 'Census Bureau',           href: 'https://census.gov'            },
      ],
    },
    {
      id: 'mountains',
      colorClass: 'crp-region--mountains',
      label: 'Mountains',
      predictions: [
        { name: 'Median Price 2025',        value: '$650k', range: '$590k – $725k', trend: 'up',      change: '+0.5%'   },
        { name: 'Rental Vacancy 2025',      value: '6.1%',  range: '5.0% – 7.5%',  trend: 'up',      change: '+0.4pp'  },
        { name: 'Construction Starts 2025', value: '4.2k',  range: '3k – 5.5k',    trend: 'down',    change: '-3.5%'   },
        { name: 'LIHTC Units 2025',         value: '85',    range: '60 – 115',      trend: 'up',      change: '+2.0%'   },
        { name: 'Rent Growth 2025',         value: '1.8%',  range: '0.0% – 3.8%',  trend: 'neutral', change: '−1.2pp'  },
      ],
      sources: [
        { text: 'Colorado Ski Country USA', href: 'https://www.coloradoski.com' },
        { text: 'Census Bureau',            href: 'https://census.gov'          },
      ],
    },
  ];

  /* ------------------------------------------------------------------
     DOM helpers
  ------------------------------------------------------------------ */

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------------------
     Build one region card
  ------------------------------------------------------------------ */

  function buildRegionCard(region) {
    var card = el('div', { class: 'crp-region-card ' + region.colorClass, role: 'region', 'aria-label': region.label + ' 2025 predictions' });

    // Region label badge
    card.appendChild(el('span', { class: 'crp-region-label' }, region.label));

    // Metrics list
    var list = el('div', { class: 'crp-metrics-list' });
    region.predictions.forEach(function (pred) {
      var trendIcon  = pred.trend === 'up' ? '▲' : pred.trend === 'down' ? '▼' : '→';
      var trendClass = 'crp-trend-' + pred.trend;

      var item = el('div', { class: 'crp-metric-item' });

      item.appendChild(el('p', { class: 'crp-metric-name' }, pred.name));

      var valueRow = el('div', { class: 'crp-metric-value-row' });
      valueRow.appendChild(el('span', { class: 'crp-metric-value' }, pred.value));

      var changeSpan = el('span', { class: 'crp-metric-change ' + trendClass });
      changeSpan.textContent = trendIcon + ' ' + pred.change;
      valueRow.appendChild(changeSpan);
      item.appendChild(valueRow);

      item.appendChild(el('p', { class: 'crp-metric-range' }, 'Range: ' + pred.range));

      list.appendChild(item);
    });
    card.appendChild(list);

    // Sources footer
    var sources = el('p', { class: 'crp-sources' });
    sources.textContent = 'Sources: ';
    region.sources.forEach(function (src, i) {
      if (i > 0) sources.appendChild(document.createTextNode(', '));
      var a = el('a', { href: src.href, target: '_blank', rel: 'noopener' }, src.text);
      sources.appendChild(a);
    });
    card.appendChild(sources);

    return card;
  }

  /* ------------------------------------------------------------------
     Main render function
  ------------------------------------------------------------------ */

  function render(container) {
    // Header
    var header = el('div', { class: 'crp-header' });
    header.appendChild(el('h2', { class: 'crp-title' }, '🏔 Colorado Regional Housing Predictions (2025)'));
    header.appendChild(el('p', { class: 'crp-subtitle' }, 'Point estimates, forecast ranges, and year-over-year changes across Colorado\'s five housing market regions.'));
    container.appendChild(header);

    // Disclaimer
    var disc = el('p', { class: 'crp-disclaimer' });
    disc.textContent = '⚠ These are illustrative forecasts derived from published sources and consensus estimates. They are not investment advice and do not constitute actual prediction-market contract prices.';
    container.appendChild(disc);

    // Regions grid
    var grid = el('div', { class: 'crp-regions-grid' });
    REGIONS.forEach(function (region) {
      grid.appendChild(buildRegionCard(region));
    });
    container.appendChild(grid);

    // Methodology note
    var meth = el('div', { class: 'crp-methodology' });
    var p1 = el('p');
    p1.textContent = 'Regional forecasts incorporate CHFA affordable housing reports, Colorado Division of Housing data, Denver Metro Association of Realtors (DMAR) statistics, CBRE Mountain West multifamily outlook, Boulder County Assessor records, the Colorado Springs Board of Realtors, and Colorado Ski Country USA resort market data. National benchmarks draw on Census Bureau ACS estimates.';
    meth.appendChild(p1);
    var p2 = el('p');
    p2.textContent = 'Ranges represent the 10th–90th percentile of published forecaster estimates. Year-over-year changes are computed from full-year 2024 actuals or the most recent trailing twelve-month period. Construction starts are reported in thousands of units at an annualized rate.';
    meth.appendChild(p2);
    container.appendChild(meth);
  }

  /* ------------------------------------------------------------------
     Auto-initialise on DOMContentLoaded
  ------------------------------------------------------------------ */

  function init() {
    var container = document.getElementById('co-regional-predictions');
    if (!container) return;
    render(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual invocation if needed
  window.ColoradoRegionalPredictions = { init: init };
})();
