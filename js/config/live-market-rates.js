/**
 * js/config/live-market-rates.js
 * Loads live market rates from the pre-cached FRED data file and updates
 * deal calculator inputs + COHO_DEFAULTS with current values.
 *
 * Reads from data/fred-data.json (refreshed daily by GitHub Actions).
 * Falls back gracefully to hardcoded defaults if fetch fails.
 *
 * Series used:
 *   MORTGAGE30US  — 30-year fixed mortgage rate (→ deal calc permanent debt rate)
 *   DGS10        — 10-year Treasury yield (→ yield curve / discount rate)
 *   T10Y2Y       — Yield curve spread (→ market stress signal)
 *   BAA10Y       — Baa corporate - 10Y Treasury spread (→ credit stress)
 *   WPUFD49207   — PPI: Inputs to construction (→ hard cost adjustment)
 *
 * Depends on: js/config/financial-constants.js (must load first)
 */
(function (global) {
  'use strict';

  var FRED_PATH = 'data/fred-data.json';
  var _loaded = false;
  var _rates = {};

  /* ── Extract latest valid observation from a FRED series ────────── */

  function _latestObs(series) {
    if (!series || !series.observations) return null;
    var obs = series.observations;
    for (var i = obs.length - 1; i >= 0; i--) {
      var v = parseFloat(obs[i].value);
      if (isFinite(v)) return { date: obs[i].date, value: v };
    }
    return null;
  }

  /* ── Resolve data path using APP_BASE_PATH (set by path-resolver.js) */

  function _resolvePath(filename) {
    var base = global.APP_BASE_PATH || '/';
    return base + filename;
  }

  /* ── Main loader ────────────────────────────────────────────────── */

  function load() {
    if (_loaded) return Promise.resolve(_rates);

    var url = _resolvePath(FRED_PATH);

    return fetch(url)
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        var s = data.series || {};
        var updated = data.updated || null;

        // 1. Mortgage rate (MORTGAGE30US)
        var mortgage = _latestObs(s.MORTGAGE30US);
        if (mortgage) {
          _rates.mortgageRate = mortgage.value;       // e.g. 6.75 (percent)
          _rates.mortgageRateDecimal = mortgage.value / 100; // 0.0675
          _rates.mortgageDate = mortgage.date;
        }

        // 2. 10-Year Treasury (DGS10)
        var treasury10y = _latestObs(s.DGS10);
        if (treasury10y) {
          _rates.treasury10y = treasury10y.value;
          _rates.treasury10yDate = treasury10y.date;
        }

        // 3. Yield curve spread (T10Y2Y)
        var yieldCurve = _latestObs(s.T10Y2Y);
        if (yieldCurve) {
          _rates.yieldCurveSpread = yieldCurve.value;
          _rates.yieldCurveInverted = yieldCurve.value < 0;
        }

        // 4. Credit spread (BAA10Y)
        var creditSpread = _latestObs(s.BAA10Y);
        if (creditSpread) {
          _rates.creditSpread = creditSpread.value;
          _rates.creditStress = creditSpread.value > 2.0; // >200bp = stress
        }

        // 5. Construction PPI (WPUFD49207 or PCU236200236200)
        var constructionPPI = _latestObs(s.PCU236200236200) || _latestObs(s.WPUFD49207);
        if (constructionPPI) {
          _rates.constructionPPI = constructionPPI.value;
          _rates.constructionPPIDate = constructionPPI.date;
        }

        // 6. SOFR (if available — used in some newer LIHTC permanent debt)
        var sofr = _latestObs(s.SOFR);
        if (sofr) {
          _rates.sofr = sofr.value;
        }

        _rates.fredUpdated = updated;
        _loaded = true;

        // ── Apply to deal calculator inputs ──────────────────────────
        _applyToDealCalculator();

        // ── Apply market stress signals ──────────────────────────────
        _renderMarketSignals();

        // ── Dispatch event for other modules ─────────────────────────
        try {
          document.dispatchEvent(new CustomEvent('market-rates:loaded', { detail: _rates }));
        } catch (_) {}

        return _rates;
      })
      .catch(function (err) {
        console.warn('[live-market-rates] Failed to load FRED data, using defaults:', err.message);
        if (global.CohoToast) global.CohoToast.show('Live market rates unavailable — using default assumptions.', 'warn');
        _loaded = true;
        return _rates;
      });
  }

  /* ── Apply live rates to deal calculator inputs ─────────────────── */

  function _applyToDealCalculator() {
    // Update permanent debt rate input if it still has the default value
    var rateInput = document.getElementById('dc-rate');
    if (rateInput && _rates.mortgageRate) {
      var currentVal = parseFloat(rateInput.value);
      var defaultVal = (global.COHO_DEFAULTS && global.COHO_DEFAULTS.commercialRate)
        ? global.COHO_DEFAULTS.commercialRate * 100
        : 6.5;

      // Only auto-update if user hasn't manually changed it from default
      if (Math.abs(currentVal - defaultVal) < 0.01) {
        // LIHTC perm debt is typically ~50-75bp above 10Y Treasury, or
        // use the 30-year mortgage rate as a proxy, adjusted down for
        // LIHTC low-risk profile (typically 50-100bp below conventional)
        var lihtcPermRate = Math.max(4.0, _rates.mortgageRate - 0.75);
        rateInput.value = lihtcPermRate.toFixed(2);

        // Show the live rate source
        _showRateSource(rateInput, lihtcPermRate);
      }
    }
  }

  /* ── Show rate source indicator ─────────────────────────────────── */

  function _showRateSource(inputEl, rate) {
    // Add a small indicator below the rate input showing it's live
    var parent = inputEl.parentElement;
    if (!parent) return;

    var existing = parent.querySelector('.live-rate-indicator');
    if (existing) existing.remove();

    var indicator = document.createElement('div');
    indicator.className = 'live-rate-indicator';
    indicator.style.cssText = 'font-size:.72rem;color:var(--good,#047857);margin-top:2px;';
    indicator.innerHTML = '<span style="display:inline-block;width:6px;height:6px;background:var(--good,#047857);border-radius:50%;margin-right:4px;vertical-align:middle;"></span>' +
      'Live: ' + rate.toFixed(2) + '% (FRED ' + (_rates.mortgageDate || '') + ')';
    parent.appendChild(indicator);
  }

  /* ── Render market stress signals ───────────────────────────────── */

  function _renderMarketSignals() {
    // Find or create a market signals container on the deal calculator page
    var heroEl = document.querySelector('.dc-hero');
    if (!heroEl) return;

    var signals = [];

    // Yield curve inversion warning
    if (_rates.yieldCurveInverted) {
      signals.push({
        type: 'warn',
        text: 'Yield curve inverted (spread: ' + _rates.yieldCurveSpread.toFixed(2) + '%) — historically signals economic slowdown. Equity pricing and investor appetite may be under pressure.'
      });
    }

    // Credit spread stress
    if (_rates.creditStress) {
      signals.push({
        type: 'warn',
        text: 'Credit spreads elevated (Baa-10Y: ' + _rates.creditSpread.toFixed(2) + '%) — LIHTC equity pricing may be 2-3 cents below normal market.'
      });
    }

    // Rate environment context
    if (_rates.mortgageRate) {
      var rateContext = _rates.mortgageRate >= 7.5 ? 'high'
                      : _rates.mortgageRate >= 6.0 ? 'elevated'
                      : _rates.mortgageRate >= 4.5 ? 'moderate'
                      : 'low';
      if (rateContext === 'high') {
        signals.push({
          type: 'info',
          text: 'Rate environment: ' + rateContext + ' (' + _rates.mortgageRate.toFixed(2) + '%). Permanent debt capacity reduced — expect larger equity or soft funding requirements.'
        });
      }
    }

    if (signals.length === 0) return;

    // Create signals banner
    var existing = document.getElementById('dcMarketSignals');
    if (existing) existing.remove();

    var banner = document.createElement('div');
    banner.id = 'dcMarketSignals';
    banner.style.cssText = 'max-width:1200px;margin:8px auto 0;padding:0 18px;';

    var html = '';
    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      var bg = s.type === 'warn' ? 'var(--warn-dim)' : 'var(--info-dim)';
      var border = s.type === 'warn' ? 'var(--warn)' : 'var(--info)';
      var color = s.type === 'warn' ? 'var(--warn)' : 'var(--info)';
      html += '<div style="padding:8px 14px;background:' + bg + ';border-left:3px solid ' + border + ';border-radius:4px;font-size:.82rem;color:' + color + ';margin-bottom:6px;">' + s.text + '</div>';
    }
    banner.innerHTML = html;

    // Insert after the hero section
    heroEl.parentNode.insertBefore(banner, heroEl.nextSibling);
  }

  /* ── Init ────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(load, 200); });
  } else {
    setTimeout(load, 200);
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  global.LiveMarketRates = {
    load: load,
    getRates: function () { return _rates; },
    isLoaded: function () { return _loaded; }
  };

})(typeof window !== 'undefined' ? window : this);
