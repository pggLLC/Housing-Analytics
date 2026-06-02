/**
 * chart-theme.js  (F19, 2026-05-27)
 *
 * Site-wide Chart.js default theming. Sets Chart.defaults.color (axis
 * labels, tooltip text, legend text), .borderColor (grid lines), and
 * .scales.*.ticks/.title colors from the site's CSS tokens so charts
 * read correctly in BOTH light + dark modes.
 *
 * Without this, Chart.js uses its defaults (#666 text, #ddd grid lines)
 * which fail WCAG AA contrast on the dark-mode background. Several
 * pages — HNA, Historical Trends, CHFA Portfolio, Policy Simulator —
 * have multi-chart dashboards where axis labels become unreadable
 * black-on-dark.
 *
 * How it works:
 *   1. Reads CSS custom properties at runtime: --text, --muted,
 *      --border, --card. These vary by theme (prefers-color-scheme +
 *      manual .dark-mode toggle).
 *   2. Sets Chart.defaults — applies to all charts created AFTER this
 *      file loads.
 *   3. Listens for theme changes (matchMedia + click on .dark-mode-toggle)
 *      and re-applies + tells existing charts to re-render.
 *
 * Loaded by all pages that include Chart.js. Defer order:
 *   <script defer src="js/vendor/chart.js"></script>
 *   <script defer src="js/components/chart-theme.js"></script>
 *   <script defer src="js/your-chart-page.js"></script>
 */
(function (global) {
  'use strict';

  if (!global.Chart || !global.Chart.defaults) {
    // Chart.js not loaded yet — wait for it. Retry up to 2s.
    var tries = 0;
    var iv = setInterval(function () {
      if (global.Chart && global.Chart.defaults) {
        clearInterval(iv);
        _init();
      } else if (++tries > 40) {
        clearInterval(iv);
        // Silent — page may legitimately not use Chart.js
      }
    }, 50);
    return;
  }
  _init();

  function _init() {
    _applyTheme();
    _wireThemeChangeListeners();
  }

  function _readTokens() {
    var cs = window.getComputedStyle(document.documentElement);
    function pick(name, fallback) {
      var v = (cs.getPropertyValue(name) || '').trim();
      return v || fallback;
    }
    return {
      text:        pick('--text',        '#0d1f35'),
      textStrong:  pick('--text-strong', '#060f1d'),
      muted:       pick('--muted',       '#5a6a7c'),
      border:      pick('--border',      'rgba(13,31,53,0.12)'),
      card:        pick('--card',        '#ffffff'),
      bg:          pick('--bg',          '#eef2f7'),
      accent:      pick('--accent',      '#096e65'),
      good:        pick('--good',        '#16a34a'),
      warn:        pick('--warn',        '#d97706')
    };
  }

  function _applyTheme() {
    var t = _readTokens();
    var defaults = global.Chart.defaults;

    // Top-level — affects legend, tooltip, title, axis labels
    defaults.color       = t.text;
    // borderColor is the fallback for dataset borders (line-chart line color,
    // bar-chart border, etc). t.muted meets WCAG AA in both themes — gridlines
    // are still set separately on scales.*.grid.color below.
    defaults.borderColor = t.muted;
    defaults.backgroundColor = t.card;
    defaults.font = defaults.font || {};
    defaults.font.family = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

    // F115 — Element-level theme defaults so unstyled bar/line/point charts
    // adopt the accent color instead of Chart.js's near-black baked-in
    // defaults. Without this, any chart that forgot to pass a backgroundColor
    // renders bars as #0000001a (rgba black 10%) — illegible in dark mode.
    if (defaults.elements) {
      var bar  = defaults.elements.bar  = defaults.elements.bar  || {};
      var line = defaults.elements.line = defaults.elements.line || {};
      var point= defaults.elements.point= defaults.elements.point|| {};
      // Bars: solid accent with 80% opacity so stacked colors still differentiate
      bar.backgroundColor = _withAlpha(t.accent, 0.8);
      bar.borderColor     = t.accent;
      bar.borderWidth     = 1;
      // Lines: accent stroke; backgroundColor for fill region uses a soft tint
      line.borderColor     = t.accent;
      line.backgroundColor = _withAlpha(t.accent, 0.18);
      line.borderWidth     = 2;
      // Points
      point.backgroundColor = t.accent;
      point.borderColor     = t.card;
    }

    // Scales — grid + tick + title colors
    if (defaults.scales) {
      ['x', 'y', 'r', 'linear', 'category', 'time', 'logarithmic'].forEach(function (axisKey) {
        if (!defaults.scales[axisKey]) defaults.scales[axisKey] = {};
        var ax = defaults.scales[axisKey];
        if (!ax.grid)  ax.grid  = {};
        if (!ax.ticks) ax.ticks = {};
        if (!ax.title) ax.title = {};
        ax.grid.color  = t.border;
        ax.ticks.color = t.muted;
        ax.title.color = t.text;
        // Radial chart-specific
        if (ax.angleLines) ax.angleLines.color = t.border;
        if (ax.pointLabels) ax.pointLabels.color = t.muted;
      });
    }

    // Plugin defaults (tooltip, legend, title)
    var p = defaults.plugins || {};
    if (p.legend) {
      p.legend.labels = p.legend.labels || {};
      p.legend.labels.color = t.text;
    }
    if (p.tooltip) {
      // Solid card-background tooltip so it doesn't blend into the chart
      p.tooltip.backgroundColor = _withAlpha(t.card, 0.95);
      p.tooltip.titleColor      = t.textStrong;
      p.tooltip.bodyColor       = t.text;
      p.tooltip.borderColor     = t.border;
      p.tooltip.borderWidth     = 1;
    }
    if (p.title) {
      p.title.color = t.textStrong;
    }

    // Mark applied so debug tooling can verify
    document.documentElement.setAttribute('data-chart-theme-applied', 'true');
  }

  // Crude alpha-injection — handles hex (#rrggbb) and rgb(a) forms.
  function _withAlpha(color, alpha) {
    if (!color) return 'rgba(255,255,255,' + alpha + ')';
    var hex = color.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      var r = parseInt(hex[1].slice(0, 2), 16);
      var g = parseInt(hex[1].slice(2, 4), 16);
      var b = parseInt(hex[1].slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    var rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
      return 'rgba(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + ',' + alpha + ')';
    }
    return color;
  }

  // Update all existing chart instances so live charts re-paint with
  // the new tokens. Chart.js v3+ stores instances in Chart.instances.
  function _refreshAllCharts() {
    if (!global.Chart) return;
    _applyTheme();
    var instances = global.Chart.instances || {};
    Object.keys(instances).forEach(function (k) {
      try {
        var inst = instances[k];
        if (inst && typeof inst.update === 'function') inst.update('none');
      } catch (_) {}
    });
  }

  function _wireThemeChangeListeners() {
    // 1. OS dark/light mode change
    if (window.matchMedia) {
      try {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        var handler = function () { _refreshAllCharts(); };
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else if (mq.addListener) mq.addListener(handler);
      } catch (_) {}
    }
    // 2. Manual toggle — listen for .dark-mode class flipping on <html>
    if (window.MutationObserver) {
      try {
        var mo = new MutationObserver(function (mutations) {
          for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].attributeName === 'class') {
              _refreshAllCharts();
              break;
            }
          }
        });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      } catch (_) {}
    }
  }

  // Expose for debugging / manual refresh
  global.ChartTheme = {
    apply: _applyTheme,
    refresh: _refreshAllCharts,
    tokens: _readTokens
  };
})(typeof window !== 'undefined' ? window : this);
