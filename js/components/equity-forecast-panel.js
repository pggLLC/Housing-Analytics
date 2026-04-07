/**
 * js/components/equity-forecast-panel.js
 * LIHTC Equity Pricing Forecast — renders ARIMA-based forward curve
 * with 95% confidence interval on the Deal Calculator page.
 *
 * Uses js/forecasting.js (EconometricForecaster.forecastPricing) for
 * ARIMA(2,1,1) model. Historical data from data/market/lihtc-equity-pricing-history.json.
 *
 * Renders:
 *   - Historical sparkline (last 12 quarters)
 *   - 8-quarter forecast with 95% CI shaded band
 *   - Current vs forecast pricing comparison
 *   - Market stress context from live FRED data
 *
 * Mount: creates #dcEquityForecast after the Assumptions panel in deal-calculator.html
 */
(function (global) {
  'use strict';

  var _mountId = 'dcEquityForecast';
  var _history = null;
  var _forecast9 = null;
  var _forecast4 = null;

  /* ── Load historical data ───────────────────────────────────────── */

  function _loadHistory() {
    if (_history) return Promise.resolve(_history);
    var base = global.APP_BASE_PATH || '';
    var url = base + 'data/market/lihtc-equity-pricing-history.json';
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _history = data.quarterly || [];
        return _history;
      })
      .catch(function (err) {
        console.warn('[equity-forecast] Failed to load pricing history:', err.message);
        if (global.CohoToast) global.CohoToast.show('Equity pricing history unavailable.', 'warn');
        return [];
      });
  }

  /* ── Run ARIMA forecast ─────────────────────────────────────────── */

  function _runForecast(history, creditType) {
    var EF = global.EconometricForecaster;
    if (!EF || typeof EF.forecastPricing !== 'function') return null;
    if (!history || history.length < 8) return null;

    var key = creditType === '4%' ? 'four' : 'nine';
    var data = history.map(function (d) { return { nine: d[key] || d.nine }; });
    try {
      return EF.forecastPricing(data, 8);
    } catch (e) {
      console.warn('[equity-forecast] ARIMA failed:', e.message);
      return null;
    }
  }

  /* ── SVG sparkline with CI band ─────────────────────────────────── */

  function _buildChart(history, forecast, creditType) {
    var key = creditType === '4%' ? 'four' : 'nine';
    var label = creditType === '4%' ? '4%' : '9%';

    // Last 12 quarters of history
    var hist = history.slice(-12);
    if (!hist.length || !forecast || !forecast.length) return '';

    // Combine for scaling
    var allValues = hist.map(function (d) { return d[key]; });
    var fcastPoints = forecast.map(function (f) { return f.point; });
    var fcastLower = forecast.map(function (f) { return f.lower; });
    var fcastUpper = forecast.map(function (f) { return f.upper; });
    var allVals = allValues.concat(fcastPoints, fcastLower, fcastUpper);

    var minVal = Math.min.apply(null, allVals) - 0.02;
    var maxVal = Math.max.apply(null, allVals) + 0.02;
    var range = maxVal - minVal || 0.10;

    var totalPts = hist.length + forecast.length;
    var W = 520;
    var H = 140;
    var padL = 40;
    var padR = 10;
    var padT = 10;
    var padB = 28;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;

    function x(i) { return padL + (i / (totalPts - 1)) * chartW; }
    function y(v) { return padT + chartH - ((v - minVal) / range) * chartH; }

    // CI band polygon (forecast region)
    var ciBandPts = '';
    for (var i = 0; i < forecast.length; i++) {
      ciBandPts += x(hist.length + i) + ',' + y(fcastUpper[i]) + ' ';
    }
    for (var j = forecast.length - 1; j >= 0; j--) {
      ciBandPts += x(hist.length + j) + ',' + y(fcastLower[j]) + ' ';
    }

    // Historical line
    var histLine = hist.map(function (d, i) {
      return (i === 0 ? 'M' : 'L') + x(i) + ',' + y(d[key]);
    }).join(' ');

    // Forecast line
    var fcastLine = 'M' + x(hist.length - 1) + ',' + y(hist[hist.length - 1][key]) + ' ';
    fcastLine += forecast.map(function (f, i) {
      return 'L' + x(hist.length + i) + ',' + y(f.point);
    }).join(' ');

    // Divider line (now vs forecast)
    var divX = x(hist.length - 1);

    // Y-axis labels
    var yLabels = '';
    var steps = 5;
    for (var s = 0; s <= steps; s++) {
      var val = minVal + (range * s / steps);
      yLabels += '<text x="' + (padL - 4) + '" y="' + (y(val) + 3) + '" ' +
        'font-size="9" fill="var(--muted)" text-anchor="end">$' + val.toFixed(2) + '</text>';
      yLabels += '<line x1="' + padL + '" y1="' + y(val) + '" x2="' + (W - padR) + '" y2="' + y(val) + '" ' +
        'stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,3"/>';
    }

    // X-axis labels (every 4th quarter)
    var xLabels = '';
    var allQuarters = hist.map(function (d) { return d.quarter; });
    for (var fi = 0; fi < forecast.length; fi++) {
      var lastQ = hist[hist.length - 1].quarter;
      var parts = lastQ.split('-');
      var yr = parseInt(parts[0]);
      var qn = parseInt(parts[1].replace('Q', ''));
      qn += fi + 1;
      while (qn > 4) { qn -= 4; yr++; }
      allQuarters.push(yr + '-Q' + qn);
    }
    for (var xi = 0; xi < allQuarters.length; xi += 3) {
      var qLabel = allQuarters[xi].replace(/^\d{2}/, '');
      xLabels += '<text x="' + x(xi) + '" y="' + (H - 4) + '" ' +
        'font-size="8" fill="var(--muted)" text-anchor="middle">' + qLabel + '</text>';
    }

    // Final forecast value annotation
    var lastFcast = forecast[forecast.length - 1];
    var annotX = x(totalPts - 1);
    var annotY = y(lastFcast.point);

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;max-height:180px;" aria-label="LIHTC ' + label + ' equity pricing forecast chart">' +
      // Grid
      yLabels + xLabels +
      // CI band
      '<polygon points="' + ciBandPts + '" fill="var(--accent)" opacity="0.12"/>' +
      // Divider
      '<line x1="' + divX + '" y1="' + padT + '" x2="' + divX + '" y2="' + (H - padB) + '" ' +
        'stroke="var(--muted)" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>' +
      '<text x="' + (divX - 3) + '" y="' + (padT + 10) + '" font-size="8" fill="var(--muted)" text-anchor="end">Now</text>' +
      // Historical line
      '<path d="' + histLine + '" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>' +
      // Forecast line
      '<path d="' + fcastLine + '" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linejoin="round"/>' +
      // Current dot
      '<circle cx="' + divX + '" cy="' + y(hist[hist.length - 1][key]) + '" r="3" fill="var(--text)"/>' +
      // Forecast end dot + label
      '<circle cx="' + annotX + '" cy="' + annotY + '" r="3" fill="var(--accent)"/>' +
      '<text x="' + (annotX - 4) + '" y="' + (annotY - 6) + '" font-size="9" fill="var(--accent)" text-anchor="end" font-weight="700">' +
        '$' + lastFcast.point.toFixed(2) +
      '</text>' +
      '<text x="' + (annotX - 4) + '" y="' + (annotY + 12) + '" font-size="7" fill="var(--muted)" text-anchor="end">' +
        '[$' + lastFcast.lower.toFixed(2) + '–$' + lastFcast.upper.toFixed(2) + ']' +
      '</text>' +
    '</svg>';
  }

  /* ── Market stress context from FRED ────────────────────────────── */

  function _getMarketContext() {
    var LMR = global.LiveMarketRates;
    if (!LMR || typeof LMR.getRates !== 'function') return null;
    var rates = LMR.getRates();
    if (!rates || !rates.mortgageRate) return null;

    var signals = [];
    if (rates.creditStress) {
      signals.push({ type: 'warn', text: 'Elevated credit spreads may suppress equity pricing by 2–5¢/credit.' });
    }
    if (rates.yieldCurveInverted) {
      signals.push({ type: 'warn', text: 'Inverted yield curve signals potential recession — investor demand may soften.' });
    }
    if (rates.mortgageRate >= 7.5) {
      signals.push({ type: 'info', text: 'High rate environment reduces LIHTC project IRRs — equity pricing typically compresses.' });
    } else if (rates.mortgageRate < 5.0) {
      signals.push({ type: 'info', text: 'Low rate environment generally supports stronger equity pricing.' });
    }
    return signals.length > 0 ? signals : null;
  }

  /* ── Render ─────────────────────────────────────────────────────── */

  function render() {
    _loadHistory().then(function (history) {
      if (!history || history.length < 8) return;

      var EF = global.EconometricForecaster;
      if (!EF) return;

      // Run forecasts for both credit types
      _forecast9 = _runForecast(history, '9%');
      _forecast4 = _runForecast(history, '4%');

      if (!_forecast9 && !_forecast4) return;

      _renderInner(history);
    });
  }

  function _renderInner(history) {
    // Determine current credit type selection
    var rate4 = document.getElementById('dc-rate-4');
    var is4Pct = rate4 && rate4.checked;
    var creditType = is4Pct ? '4%' : '9%';
    var forecast = is4Pct ? _forecast4 : _forecast9;
    var key = is4Pct ? 'four' : 'nine';

    if (!forecast) return;

    // Find or create mount after Assumptions panel
    var mount = document.getElementById(_mountId);
    if (!mount) {
      // Insert after the Sources & Uses fieldset's parent div
      var suTable = document.getElementById('dc-su-table');
      var sfBreakdown = document.getElementById('dcSoftFundingBreakdown');
      var insertAfter = sfBreakdown || (suTable ? suTable.parentElement : null);
      if (!insertAfter) return;

      mount = document.createElement('div');
      mount.id = _mountId;
      mount.style.cssText = 'margin-top:16px;padding:14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card,#fff);';
      insertAfter.parentNode.insertBefore(mount, insertAfter.nextSibling);
    }

    // Current pricing
    var lastHist = history[history.length - 1];
    var current = lastHist[key];
    var lastFcast = forecast[forecast.length - 1];

    // Direction
    var delta = lastFcast.point - current;
    var direction = delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'stable';
    var dirColor = direction === 'up' ? 'var(--good,#047857)' : direction === 'down' ? 'var(--bad,#dc2626)' : 'var(--muted)';
    var dirIcon = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '●';
    var dirText = direction === 'up' ? 'Upward' : direction === 'down' ? 'Downward' : 'Stable';

    // Build chart
    var chartSvg = _buildChart(history, forecast, creditType);

    // Market context
    var marketCtx = _getMarketContext();
    var ctxHtml = '';
    if (marketCtx) {
      ctxHtml = '<div style="margin-top:8px;">';
      for (var i = 0; i < marketCtx.length; i++) {
        var s = marketCtx[i];
        var bg = s.type === 'warn' ? 'var(--warn-dim,#fef3c7)' : 'var(--info-dim,#dbeafe)';
        var clr = s.type === 'warn' ? 'var(--warn,#d97706)' : 'var(--info,#2563eb)';
        ctxHtml += '<div style="padding:4px 10px;background:' + bg + ';border-radius:3px;font-size:.72rem;color:' + clr + ';margin-bottom:4px;">' + s.text + '</div>';
      }
      ctxHtml += '</div>';
    }

    // Summary stats
    var q2Fcast = forecast.length >= 2 ? forecast[1] : forecast[0];
    var q4Fcast = forecast.length >= 4 ? forecast[3] : forecast[forecast.length - 1];

    mount.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
        '<div>' +
          '<strong style="font-size:.88rem;">Equity Pricing Forecast</strong>' +
          '<span style="font-size:.72rem;color:var(--muted);margin-left:8px;">' + creditType + ' Credits · ARIMA(2,1,1) · 95% CI</span>' +
        '</div>' +
        '<span style="font-size:.82rem;font-weight:700;color:' + dirColor + ';">' + dirIcon + ' ' + dirText + '</span>' +
      '</div>' +

      // Chart
      '<div style="background:var(--bg2);border-radius:6px;padding:8px 4px 0;">' + chartSvg + '</div>' +

      // Stats row
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:10px;">' +
        '<div style="text-align:center;padding:6px;border-radius:4px;background:var(--bg2);">' +
          '<div style="font-size:.68rem;color:var(--muted);">Current</div>' +
          '<div style="font-size:1rem;font-weight:800;">$' + current.toFixed(2) + '</div>' +
          '<div style="font-size:.66rem;color:var(--muted);">' + lastHist.quarter + '</div>' +
        '</div>' +
        '<div style="text-align:center;padding:6px;border-radius:4px;background:var(--bg2);">' +
          '<div style="font-size:.68rem;color:var(--muted);">+2 Qtrs</div>' +
          '<div style="font-size:1rem;font-weight:800;color:var(--accent);">$' + q2Fcast.point.toFixed(2) + '</div>' +
          '<div style="font-size:.66rem;color:var(--muted);">[$' + q2Fcast.lower.toFixed(2) + '–$' + q2Fcast.upper.toFixed(2) + ']</div>' +
        '</div>' +
        '<div style="text-align:center;padding:6px;border-radius:4px;background:var(--bg2);">' +
          '<div style="font-size:.68rem;color:var(--muted);">+4 Qtrs</div>' +
          '<div style="font-size:1rem;font-weight:800;color:var(--accent);">$' + q4Fcast.point.toFixed(2) + '</div>' +
          '<div style="font-size:.66rem;color:var(--muted);">[$' + q4Fcast.lower.toFixed(2) + '–$' + q4Fcast.upper.toFixed(2) + ']</div>' +
        '</div>' +
        '<div style="text-align:center;padding:6px;border-radius:4px;background:var(--bg2);">' +
          '<div style="font-size:.68rem;color:var(--muted);">+8 Qtrs</div>' +
          '<div style="font-size:1rem;font-weight:800;color:var(--accent);">$' + lastFcast.point.toFixed(2) + '</div>' +
          '<div style="font-size:.66rem;color:var(--muted);">[$' + lastFcast.lower.toFixed(2) + '–$' + lastFcast.upper.toFixed(2) + ']</div>' +
        '</div>' +
      '</div>' +

      // Market context
      ctxHtml +

      // Disclaimer
      '<p style="font-size:.68rem;color:var(--muted);margin:8px 0 0;line-height:1.4;">' +
        'ARIMA(2,1,1) model fitted on ' + _history.length + ' quarters of historical equity pricing data. ' +
        'Confidence intervals widen with forecast horizon. Actual pricing depends on investor appetite, CRA demand, legislative changes, and macro conditions. ' +
        'Not investment advice — consult your syndicator or financial advisor.' +
      '</p>';
  }

  /* ── Init ────────────────────────────────────────────────────────── */

  function init() {
    render();

    // Re-render when credit type changes
    document.addEventListener('soft-funding:refresh', function () {
      if (_history) _renderInner(_history);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 900); });
  } else {
    setTimeout(init, 900);
  }

  global.EquityForecastPanel = { render: render };

})(typeof window !== 'undefined' ? window : this);
