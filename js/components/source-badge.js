/**
 * js/components/source-badge.js
 * Auto-renders source attribution badges beneath chart/stat containers.
 *
 * Usage (declarative):
 *   <div class="chart-box" data-source="HUD CHAS 2017-2021" data-source-url="https://huduser.gov/...">
 *     <canvas id="myChart"></canvas>
 *   </div>
 *
 * Or call imperatively from chart render code:
 *   SourceBadge.attach(element, { source: 'FRED CPIAUCSL', url: '...' });
 *
 * Styling uses the existing .chart-source class from site-theme.css.
 * Attaching twice to the same element is a no-op.
 *
 * Exposes window.SourceBadge.
 */
(function () {
  'use strict';

  var SELECTOR = '[data-source]';
  var _observer = null;
  var _pendingScan = false;

  /**
   * Attach a source badge to a container element.
   * @param {HTMLElement} el - The container to attach to.
   * @param {{ source: string, url?: string }} opts
   * @returns {HTMLElement|null} the badge element, or null if nothing was attached.
   */
  function attach(el, opts) {
    if (!el || !opts || !opts.source) return null;

    // Resolve the real append target first: for .chart-box (which has fixed
    // height), append to the parent .chart-card so the source text doesn't
    // overflow the chart.
    var target = el;
    if (el.classList && el.classList.contains('chart-box')) {
      var card = el.closest('.chart-card');
      if (card) target = card;
    }

    // Double-attach guard: check the *target* rather than the caller's
    // element. Two imperative attach() calls on the same .chart-box would
    // otherwise both succeed (badge lives on the parent .chart-card, which
    // the child .chart-box doesn't see).
    if (target.querySelector(':scope > .chart-source, :scope > .kpi-source')) {
      return null;
    }

    var badge = document.createElement('div');
    badge.className = 'chart-source';
    badge.setAttribute('aria-label', 'Data source: ' + opts.source);

    var safeUrl = _safeLinkUrl(opts.url);
    if (safeUrl) {
      badge.appendChild(document.createTextNode('Source: '));
      var link = document.createElement('a');
      link.setAttribute('href', safeUrl);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.textContent = opts.source;
      badge.appendChild(link);
    } else {
      badge.textContent = 'Source: ' + opts.source;
    }

    target.appendChild(badge);
    return badge;
  }

  /**
   * Scan DOM for [data-source] elements and auto-attach badges.
   * Safe to call multiple times (attach() skips already-badged elements).
   */
  function scan() {
    var els = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      attach(el, {
        source: el.getAttribute('data-source'),
        url:    el.getAttribute('data-source-url') || null
      });
    }
  }

  /**
   * Schedule a single scan() on the next animation frame. Multiple calls
   * within the same frame collapse to one pass — this is what makes the
   * MutationObserver cheap even when charts inject lots of DOM in bursts.
   */
  function _scheduleScan() {
    if (_pendingScan) return;
    _pendingScan = true;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () {
      _pendingScan = false;
      scan();
    });
  }

  /**
   * Return a safe absolute URL for external links, or null if invalid/unsafe.
   * @param {string|null|undefined} raw
   * @returns {string|null}
   */
  function _safeLinkUrl(raw) {
    if (!raw) return null;
    try {
      var url = new URL(raw, window.location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.href;
    } catch (e) {
      return null;
    }
  }

  /**
   * Start a MutationObserver that re-scans whenever new DOM is added.
   * Replaces the old fixed 3-second setTimeout, which missed charts that
   * rendered after the 3s window (slow data loads, tab switches, user
   * interactions). The observer stays active for the page lifetime so
   * *every* late-arriving chart gets a badge as soon as it lands.
   */
  function _startObserver() {
    if (_observer || typeof MutationObserver !== 'function') return;
    _observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        if (!added || !added.length) continue;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue; // ELEMENT_NODE only
          // Fast-path: check the new node and any of its [data-source]
          // descendants before triggering a full-document scan.
          if (n.matches && n.matches(SELECTOR)) {
            _scheduleScan();
            return;
          }
          if (n.querySelector && n.querySelector(SELECTOR)) {
            _scheduleScan();
            return;
          }
        }
      }
    });
    _observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    scan();
    _startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SourceBadge = {
    attach: attach,
    scan:   scan,
    /** Internal — exposed for tests so they can stop the observer cleanly. */
    _disconnect: function () {
      if (_observer) { _observer.disconnect(); _observer = null; }
    }
  };
})();
