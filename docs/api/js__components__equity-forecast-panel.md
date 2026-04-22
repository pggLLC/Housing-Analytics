# `js/components/equity-forecast-panel.js`

js/components/equity-forecast-panel.js
LIHTC Equity Pricing Forecast — renders ARIMA-based forward curve
with 95% confidence interval on the Deal Calculator page.

Uses js/forecasting.js (EconometricForecaster.forecastPricing) for
ARIMA(2,1,1) model. Historical data from data/market/lihtc-equity-pricing-history.json.

Renders:
  - Historical sparkline (last 12 quarters)
  - 8-quarter forecast with 95% CI shaded band
  - Current vs forecast pricing comparison
  - Market stress context from live FRED data

Mount: creates #dcEquityForecast after the Assumptions panel in deal-calculator.html

_No documented symbols — module has a file-header comment only._
