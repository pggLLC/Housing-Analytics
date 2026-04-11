/**
 * js/components/source-badge.js
 * Auto-renders source attribution badges beneath chart/stat containers.
 *
 * Usage (declarative):
 *   <div class="chart-box" data-source="HUD CHAS 2017-2021" data-source-url="https://huduser.gov/...">
 *     <canvas id="myChart"></canvas>
 *   </div>
 *
 * Or call imperatively:
 *   SourceBadge.attach(element, { source: 'FRED CPIAUCSL', url: '...' });
 *
 * Styling uses existing .chart-source class from site-theme.css.
 * Skips elements that already have a .chart-source or .kpi-source child.
 *
 * Exposes window.SourceBadge.
 */
(function () {
  'use strict';

  /**
   * Attach a source badge to a container element.
   * @param {HTMLElement} el - The container to attach to.
   * @param {{ source: string, url?: string }} opts
   */
  function attach(el, opts) {
    if (!el || !opts || !opts.source) return;
    // Don't double-attach
    if (el.querySelector('.chart-source, .kpi-source')) return;

    var badge = document.createElement('div');
    badge.className = 'chart-source';
    badge.setAttribute('aria-label', 'Data source: ' + opts.source);

    if (opts.url) {
      badge.innerHTML = 'Source: <a href="' + opts.url + '" target="_blank" rel="noopener">' +
        opts.source + '</a>';
    } else {
      badge.textContent = 'Source: ' + opts.source;
    }

    el.appendChild(badge);
  }

  /**
   * Scan DOM for elements with data-source attributes and auto-attach badges.
   * Safe to call multiple times (skips already-badged elements).
   */
  function scan() {
    var els = document.querySelectorAll('[data-source]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      attach(el, {
        source: el.getAttribute('data-source'),
        url:    el.getAttribute('data-source-url') || null
      });
    }
  }

  // Auto-scan on DOMContentLoaded and after a short delay (for dynamically rendered charts)
  function init() {
    scan();
    setTimeout(scan, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SourceBadge = { attach: attach, scan: scan };
})();
