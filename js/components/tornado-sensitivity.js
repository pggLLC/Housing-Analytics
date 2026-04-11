/**
 * js/components/tornado-sensitivity.js
 * Tornado (horizontal bar) chart for scenario sensitivity visualization.
 *
 * Renders a visual tornado diagram showing how key assumptions affect
 * the deal outcome.  Uses existing scenarioSensitivity data from
 * LIHTCDealPredictor.predictConcept().
 *
 * Mount: renders into #tornadoChartMount (if present on page).
 * Depends on: Chart.js (vendored), LIHTCDealPredictor (optional)
 */
(function (global) {
  'use strict';

  /* ── Extract sensitivity data ───────────────────────────────────── */

  function _getSensitivityData() {
    // Try WorkflowState deal step first
    var WS = global.WorkflowState;
    if (WS && typeof WS.getStep === 'function') {
      var deal = WS.getStep('deal') || {};
      if (deal.scenarioSensitivity) return deal.scenarioSensitivity;
    }

    // Try SiteState PMA results
    var SS = global.SiteState;
    if (SS && typeof SS.getPmaResults === 'function') {
      var pma = SS.getPmaResults() || {};
      if (pma.scenarioSensitivity) return pma.scenarioSensitivity;
    }

    // Try last predictor result (if available on window)
    if (global._lastPredictorResult && global._lastPredictorResult.scenarioSensitivity) {
      return global._lastPredictorResult.scenarioSensitivity;
    }

    return null;
  }

  /* ── Parse dollar strings ───────────────────────────────────────── */

  function _parseDollars(s) {
    if (typeof s === 'number') return s;
    if (!s) return 0;
    return parseFloat(String(s).replace(/[$,\s]/g, '')) || 0;
  }

  /* ── Render tornado chart ───────────────────────────────────────── */

  function render(sensitivity, mountId) {
    var mount = document.getElementById(mountId || 'tornadoChartMount');
    if (!mount) return;

    var data = sensitivity || _getSensitivityData();
    if (!data) {
      mount.innerHTML = '<p style="font-size:.82rem;color:var(--muted);padding:.5rem;">Run a deal analysis to see sensitivity ranges.</p>';
      return;
    }

    // Parse equity range into numeric values
    var eqLow  = _parseDollars(data.equityPricingRange && data.equityPricingRange.low);
    var eqHigh = _parseDollars(data.equityPricingRange && data.equityPricingRange.high);
    var eqBase = (eqLow + eqHigh) / 2;
    var eqNote = (data.equityPricingRange && data.equityPricingRange.note) || '';

    // Map demand signal to numeric (for visualization)
    var signalMap = { weak: 30, moderate: 55, strong: 80 };
    var demLow  = signalMap[data.demandSignalRange && data.demandSignalRange.low] || 50;
    var demHigh = signalMap[data.demandSignalRange && data.demandSignalRange.high] || 50;
    var demBase = (demLow + demHigh) / 2;
    var demNote = (data.demandSignalRange && data.demandSignalRange.note) || '';

    // Saturation: extract project counts
    var satLowMatch  = data.saturationRange && data.saturationRange.low  ? data.saturationRange.low.match(/(\d+)/)  : null;
    var satHighMatch = data.saturationRange && data.saturationRange.high ? data.saturationRange.high.match(/(\d+)/) : null;
    var satLow  = satLowMatch  ? parseInt(satLowMatch[1])  : 0;
    var satHigh = satHighMatch ? parseInt(satHighMatch[1]) : 5;
    var satBase = (satLow + satHigh) / 2;
    var satNote = (data.saturationRange && data.saturationRange.note) || '';

    // Build the visual
    mount.innerHTML = '';

    var container = document.createElement('div');
    container.className = 'tornado-chart';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', 'Sensitivity tornado chart showing how key assumptions affect the deal outcome');

    // Support generic factors array (from deal calculator) or legacy format (from predictor)
    var factors;
    if (Array.isArray(data.factors)) {
      factors = data.factors;
    } else {
      factors = [
        {
          label: 'Equity Proceeds',
          low: eqLow, high: eqHigh, base: eqBase,
          lowLabel: '$' + (eqLow / 1e6).toFixed(1) + 'M',
          highLabel: '$' + (eqHigh / 1e6).toFixed(1) + 'M',
          note: eqNote,
          color: 'var(--accent)'
        },
        {
          label: 'Demand Signal',
          low: demLow, high: demHigh, base: demBase,
          lowLabel: (data.demandSignalRange && data.demandSignalRange.low) || '—',
          highLabel: (data.demandSignalRange && data.demandSignalRange.high) || '—',
          note: demNote,
          color: 'var(--info)'
        },
        {
          label: 'Market Saturation',
          low: satLow, high: satHigh, base: satBase,
          lowLabel: (data.saturationRange && data.saturationRange.low) || '—',
          highLabel: (data.saturationRange && data.saturationRange.high) || '—',
          note: satNote,
          color: 'var(--warn)'
        }
      ];
    }

    var html = '<div class="tornado-rows">';
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      // For the bar, show the range relative to baseline
      var range = f.high - f.low;
      var maxVisual = Math.max.apply(null, factors.map(function(x) { return x.high - x.low; })) || 1;
      var barWidth = Math.max(10, Math.round((range / maxVisual) * 80));

      html += '<div class="tornado-row">' +
        '<div class="tornado-row__label">' + f.label + '</div>' +
        '<div class="tornado-row__bar-wrap">' +
          '<span class="tornado-row__low">' + f.lowLabel + '</span>' +
          '<div class="tornado-row__bar" style="width:' + barWidth + '%;background:' + f.color + ';opacity:0.7;">' +
          '</div>' +
          '<span class="tornado-row__high">' + f.highLabel + '</span>' +
        '</div>' +
        '<div class="tornado-row__note">' + f.note + '</div>' +
      '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    mount.appendChild(container);
  }

  /* ── CSS (injected once) ────────────────────────────────────────── */

  function _injectStyles() {
    if (document.getElementById('tornadoStyles')) return;
    var style = document.createElement('style');
    style.id = 'tornadoStyles';
    style.textContent =
      '.tornado-chart { padding: .5rem 0; }' +
      '.tornado-rows { display: flex; flex-direction: column; gap: 12px; }' +
      '.tornado-row { display: grid; grid-template-columns: 130px 1fr; grid-template-rows: auto auto; gap: 2px 12px; align-items: center; }' +
      '.tornado-row__label { font-size: .82rem; font-weight: 700; color: var(--text); grid-row: 1; grid-column: 1; }' +
      '.tornado-row__bar-wrap { grid-row: 1; grid-column: 2; display: flex; align-items: center; gap: 8px; }' +
      '.tornado-row__bar { height: 20px; border-radius: 3px; min-width: 10px; transition: width .4s ease; }' +
      '.tornado-row__low, .tornado-row__high { font-size: .75rem; font-weight: 600; color: var(--muted); white-space: nowrap; }' +
      '.tornado-row__note { grid-row: 2; grid-column: 2; font-size: .72rem; color: var(--faint); }' +
      '@media (max-width: 600px) { .tornado-row { grid-template-columns: 1fr; } .tornado-row__label { margin-bottom: 2px; } }';
    document.head.appendChild(style);
  }

  /* ── Init ────────────────────────────────────────────────────────── */

  function init() {
    _injectStyles();
    // Only auto-render if mount exists
    if (document.getElementById('tornadoChartMount')) {
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  global.TornadoSensitivity = { render: render };

})(typeof window !== 'undefined' ? window : this);
