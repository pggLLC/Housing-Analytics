# `js/housing-predictions.js`

housing-predictions.js
Housing Prediction Market Dashboard Module
Loads live probability data from data/kalshi/prediction-market.json
(fetched weekly by .github/workflows/fetch-kalshi.yml).
Falls back to built-in illustrative mock data if the feed is unavailable.

Usage: HousingPredictions.init()  (call after DOMContentLoaded)
Renders into: #housing-predictions-section

## Symbols

### `loadKalshiData()`

Attempt to load live data from the pre-fetched Kalshi JSON file.
Returns null (uses mock) if the file is missing, fails, or has no items.
"Unavailable" is defined as any of the following conditions:
  - The HTTP response is not OK (e.g. 404, 500, or network error)
  - The response body is not valid JSON
  - The parsed object is falsy or carries a top-level `error` field
  - The `items` array is absent or empty (no prediction-market data was fetched)
In all such cases null is returned and the caller falls back to mock data.
@returns {Promise<Object|null>}

### `formatDDMMYY(isoString)`

Format an ISO date string as dd-mm-yy.
@param {string} isoString
@returns {string}

### `mergeKalshiData(kalshiItems)`

Merge Kalshi live items into the chart data arrays.
Only overrides the datasets for metrics that Kalshi returns.
@param {Object[]} kalshiItems — items array from prediction-market.json
@returns {{ pricePredictions, mortgagePredictions, startsPredictions, vacancyPredictions }}

### `injectStyles()`

Convert a Kalshi outcomes array into the {label, prob, expertConsensus} format
used by the chart components. expertConsensus is kept from mock data when
the matching entry exists (identified by label), else defaults to prob.
@param {Object[]} outcomes
@param {Object[]} mockArr
@returns {Object[]}
/
    function outcomesToChartData(outcomes, mockArr) {
      return outcomes.map((o, i) => {
        const probPct = Math.round(o.prob * 100);
        // Try to find an expert consensus from the mock data at the same index
        const mockEntry = mockArr[i];
        return {
          label:           o.name,
          prob:            probPct,
          expertConsensus: mockEntry ? mockEntry.expertConsensus : probPct,
        };
      });
    }

    const pricePredictions    = byMetric['home_price_growth']
      ? outcomesToChartData(byMetric['home_price_growth'].outcomes, PRICE_PREDICTIONS)
      : PRICE_PREDICTIONS;

    const mortgagePredictions = byMetric['30yr_mortgage_rate']
      ? outcomesToChartData(byMetric['30yr_mortgage_rate'].outcomes, MORTGAGE_PREDICTIONS)
      : MORTGAGE_PREDICTIONS;

    const startsPredictions   = byMetric['housing_starts']
      ? outcomesToChartData(byMetric['housing_starts'].outcomes, STARTS_PREDICTIONS)
      : STARTS_PREDICTIONS;

    const vacancyPredictions  = byMetric['rent_growth']
      ? outcomesToChartData(byMetric['rent_growth'].outcomes, VACANCY_PREDICTIONS)
      : VACANCY_PREDICTIONS;

    return { pricePredictions, mortgagePredictions, startsPredictions, vacancyPredictions };
  }

  function render(section, usingLiveData, updatedLabel, merged, sourceUrl) {
    section.innerHTML = '';
    section.setAttribute('aria-label', 'Housing Prediction Market Dashboard');

    // Build the source attribution anchor
    const kalshiUrl = sourceUrl || 'https://kalshi.com';
    const sourceLink = el('a', { href: kalshiUrl, target: '_blank', rel: 'noopener noreferrer', class: 'hp-source-link' }, 'Source');

    // Header + disclaimer
    const disclaimerDiv = el('div', { class: 'hp-disclaimer', role: 'note', 'aria-label': 'Data disclaimer' });
    if (usingLiveData) {
      disclaimerDiv.appendChild(document.createTextNode('✅ Live prediction-market data loaded from the latest Kalshi feed. '));
      disclaimerDiv.appendChild(sourceLink);
      disclaimerDiv.appendChild(document.createTextNode(' · Last updated: ' + updatedLabel + '.'));
    } else {
      disclaimerDiv.appendChild(document.createTextNode('⚠️ Live prediction-market feed is unavailable. This section is currently showing illustrative fallback data. '));
      disclaimerDiv.appendChild(document.createTextNode('📊 Data from '));
      disclaimerDiv.appendChild(sourceLink);
      disclaimerDiv.appendChild(document.createTextNode(' (Kalshi). Last updated: ' + updatedLabel + '.'));
    }

    section.appendChild(el('div', { class: 'hp-header' },
      el('h2', { class: 'hp-title' }, 'Housing Prediction Market Dashboard'),
      el('p', { class: 'hp-subtitle' },
        'Prediction-market-style probabilities for key housing metrics. ' +
        'Compared against traditional expert consensus forecasts (Fed, NAR, Census Bureau).',
      ),
      disclaimerDiv,
    ));

    // Legend
    const legend = el('div', { class: 'hp-legend', 'aria-label': 'Chart legend' });
    legend.appendChild(el('span', { class: 'hp-legend-item hp-legend-market' }, '■ Prediction Market'));
    legend.appendChild(el('span', { class: 'hp-legend-item hp-legend-expert' }, '■ Expert Consensus'));
    section.appendChild(legend);

    // Distribution charts grid
    const chartsGrid = el('div', { class: 'hp-charts-grid' });

    const chartDefs = [
      { id: 'hp-chart-price',    data: merged.pricePredictions,    title: 'National Median Price Change (YoY)',    aria: 'Probability distribution: national home price change' },
      { id: 'hp-chart-mortgage', data: merged.mortgagePredictions, title: '30-Year Fixed Mortgage Rate (Year-End)', aria: 'Probability distribution: 30-year mortgage rate' },
      { id: 'hp-chart-starts',   data: merged.startsPredictions,   title: 'Housing Starts (Annualised, Millions)',  aria: 'Probability distribution: housing starts' },
      { id: 'hp-chart-vacancy',  data: merged.vacancyPredictions,  title: 'National Rental Vacancy Rate (Year-End)', aria: 'Probability distribution: rental vacancy rate' },
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
    section.appendChild(el('h3', { class: 'hp-section-heading' }, 'Historical Accuracy'));
    section.appendChild(el('p', { class: 'hp-acc-note' },
      'Tracks realized housing outcomes against the probability consensus for prior years. ' +
      'The market probability column reflects the implied odds from aggregated forecaster consensus at the start of each year; ' +
      '"Actual" reflects the documented outcome based on FRED, NAR, and Census Bureau data. ' +
      'A correct call means the highest-probability outcome materialized.',
    ));
    section.appendChild(buildAccuracyTable());

    // Methodology
    section.appendChild(el('div', { class: 'hp-methodology', role: 'region', 'aria-label': 'Methodology explanation' },
      el('h3', { class: 'hp-section-heading' }, 'Methodology & Sources'),
      el('p', {}, 'Prediction market probabilities are derived by converting implied odds to direct probabilities, ' +
        'deducting the "vig" (overround), and normalising to 100%. Expert consensus is aggregated from: ' +
        'Federal Reserve Monetary Policy Reports (semiannual), Fannie Mae Economic & Housing Outlook (monthly), ' +
        'Freddie Mac Quarterly Forecast, NAR Economic Outlook, Census Bureau HVS, Zillow Research, ' +
        'Moody\'s Analytics, and CoreLogic market insights.'),
      el('p', {}, 'Fannie Mae and Freddie Mac publish monthly and quarterly housing market forecasts covering ' +
        'home price appreciation, origination volumes, mortgage rates, and housing starts. These GSE forecasts ' +
        'are incorporated into the expert consensus range alongside NAR, MBA, and Fed projections.'),
      el('p', {}, 'Colorado-specific predictions incorporate CHFA affordable housing reports, ' +
        'Colorado Division of Housing data, and Denver Metro Association of Realtors statistics.'),
    ));
  }

  /* ------------------------------------------------------------------ */
  /*  Styles injection                                                   */
  /* ------------------------------------------------------------------
