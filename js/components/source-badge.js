/**
 * js/components/source-badge.js
 * Auto-renders source attribution badges beneath chart/stat containers.
 *
 * Usage (declarative):
 *   <div class="chart-box"
 *        data-source="HUD CHAS 2017-2021"
 *        data-source-url="https://huduser.gov/..."
 *        data-vintage="2017–2021"
 *        data-source-type="raw">
 *     <canvas id="myChart"></canvas>
 *   </div>
 *
 * Every line carries a date. Without data-vintage, data-source-id="<inventory
 * id>" takes the date js/data-source-inventory.js records; with neither, the
 * line says "date unconfirmed".
 *
 * Or name inventory sources only, and the line is built from the inventory:
 *   <div data-source-ids="hna-ranking-index,hud-chas-co"></div>
 *
 * data-source-type values: raw | transformed | modeled | live
 *   raw         – data used exactly as published by the source
 *   transformed – aggregated, filtered, or joined from the source
 *   modeled     – output of a formula or model applied to source data
 *   live        – live API data fetched at render time
 *
 * Or call imperatively from chart render code:
 *   SourceBadge.attach(element, { source: 'FRED CPIAUCSL', url: '...', vintage: '2024', sourceType: 'raw' });
 *
 * Styling uses the existing .chart-source class from site-theme.css.
 * Attaching twice to the same element is a no-op.
 *
 * Exposes window.SourceBadge.
 */
(function () {
  'use strict';

  var SELECTOR = '[data-source], [data-source-ids]';
  // Base path for loading js/data-source-inventory.js on demand.
  var _script = document.currentScript && document.currentScript.src;
  var _base = _script ? _script.replace(/js\/components\/source-badge\.js.*$/, '') : '';
  var _inventory = null;
  var _observer = null;
  var _pendingScan = false;

  /** Map source-type values to human-readable labels. */
  var SOURCE_TYPE_LABELS = {
    raw:         'Raw data',
    transformed: 'Transformed',
    modeled:     'Modeled',
    live:        'Live data',
  };

  /**
   * Attach a source badge to a container element.
   * @param {HTMLElement} el - The container to attach to.
   * @param {{ source: string, url?: string, vintage?: string, sourceType?: string }} opts
   * @returns {HTMLElement|null} the badge element, or null if nothing was attached.
   */
  function attach(el, opts) {
    if (!el || !opts || !opts.source) return null;

    // F138 — Resolve the real append target. Cases:
    //   (a) el is a .chart-box (fixed-height wrapper) → append to parent
    //       .chart-card so the source text sits below the chart, not
    //       inside the fixed-height box.
    //   (b) F221b: el is a .chart-wrap. Same problem as .chart-box —
    //       Chart.js with maintainAspectRatio:false continuously re-fits
    //       the canvas to its parent's height. If the badge lives inside
    //       .chart-wrap, the wrap grows by the badge's height, Chart.js
    //       re-fits, wrap grows again — infinite resize loop that
    //       ballooned the FRED dashboard to many thousands of px tall.
    //       Hoist the badge to the wrap's parent (the FRED card / panel)
    //       so the wrap's measured height stays purely chart-driven.
    //   (c) el is the canvas itself with data-source attrs, and its parent
    //       isn't .chart-box. Walk up to the first ancestor with a fixed
    //       height OR position:relative (which behaves the same way), then
    //       jump to .chart-card. This catches inline-styled wrappers like
    //       `<div style="height:280px;position:relative;">` on
    //       colorado-deep-dive's LIHTC chart, where the source previously
    //       got pinned inside the 280px box and visually spilled out.
    var target = el;
    if (el.classList && el.classList.contains('chart-box')) {
      var card = el.closest('.chart-card');
      if (card) target = card;
    } else if (el.classList && el.classList.contains('chart-wrap')) {
      // F221b — see (b) above. Hoist to the wrap's parent.
      var wrapParent = el.parentElement;
      if (wrapParent) target = wrapParent;
    } else if (el.tagName === 'CANVAS') {
      var parent = el.parentElement;
      var hasFixedHeight = parent && (
        (parent.style && parent.style.height) ||
        (parent.style && parent.style.position === 'relative')
      );
      if (hasFixedHeight) {
        var cardA = el.closest('.chart-card, section.chart-card, [class*="chart-card"]');
        if (cardA) target = cardA;
      }
      // A canvas never renders child elements, so a badge appended to it is
      // invisible (construction-commodities' four FRED charts). Fall back to
      // the canvas's parent, or past a fixed-height .chart-container so the
      // badge sits below the chart instead of spilling over the next card.
      if (target === el && parent) {
        target = (parent.classList.contains('chart-container') && parent.parentElement) || parent;
      }
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

    var ariaLabel = 'Data source: ' + opts.source;
    if (opts.vintage) ariaLabel += ' (' + opts.vintage + ')';
    badge.setAttribute('aria-label', ariaLabel);

    // Build the inner HTML with optional vintage and source-type metadata
    var parts = [];

    var sourcePart;
    if (opts.url) {
      sourcePart = 'Source: <a href="' + opts.url + '" target="_blank" rel="noopener">' +
        opts.source + '</a>';
    } else {
      sourcePart = 'Source: ' + opts.source;
    }
    parts.push(sourcePart);

    // Every source line carries a date: the source's own vintage, else the
    // date the inventory records for the site's copy, else says it has none.
    parts.push('<span class="chart-source__vintage">' + (opts.vintage || 'date unconfirmed') + '</span>');

    if (opts.sourceType && SOURCE_TYPE_LABELS[opts.sourceType]) {
      var typeLabel = SOURCE_TYPE_LABELS[opts.sourceType];
      var typeClass = 'chart-source__type chart-source__type--' + opts.sourceType;
      parts.push('<span class="' + typeClass + '" title="Data type: ' + typeLabel + '">' + typeLabel + '</span>');
    }

    badge.innerHTML = parts.join(' · ');

    target.appendChild(badge);
    return badge;
  }

  /**
   * Scan DOM for [data-source] elements and auto-attach badges.
   * Safe to call multiple times (attach() skips already-badged elements).
   */
  /** Load js/data-source-inventory.js once; resolves to its source list. */
  function inventory() {
    if (_inventory) return _inventory;
    _inventory = new Promise(function (resolve) {
      var have = function () { return window.DataSourceInventory && typeof window.DataSourceInventory.getSources === 'function'; };
      if (have()) return resolve(window.DataSourceInventory.getSources());
      var tag = document.createElement('script');
      tag.src = _base + 'js/data-source-inventory.js';
      tag.onload = function () { resolve(have() ? window.DataSourceInventory.getSources() : []); };
      tag.onerror = function () { resolve([]); };
      document.head.appendChild(tag);
    });
    return _inventory;
  }

  function findSource(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // data-source-ids="a,b": a line naming each inventory source, linked to the
  // publisher (or the site's own /data copy when the source is derived here),
  // with the date the inventory records.
  function attachIds(el) {
    if (el.__sbIds) return;
    el.__sbIds = true;
    var ids = el.getAttribute('data-source-ids').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    inventory().then(function (list) {
      if (el.querySelector(':scope > .chart-source')) return;
      var items = ids.map(function (id) {
        var s = findSource(list, id);
        if (!s) return esc(id) + ' (date unconfirmed)';
        var href = s.url || (s.localFile ? _base + s.localFile : '');
        var name = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>' : esc(s.name);
        return name + ' (' + (s.lastUpdated ? 'updated ' + esc(s.lastUpdated) : 'date unconfirmed') + ')';
      });
      var badge = document.createElement('div');
      badge.className = 'chart-source';
      badge.innerHTML = (items.length > 1 ? 'Sources: ' : 'Source: ') + items.join('; ');
      el.appendChild(badge);
    });
  }

  function scan() {
    var els = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.hasAttribute('data-source')) { attachIds(el); continue; }
      var opts = {
        source:     el.getAttribute('data-source'),
        url:        el.getAttribute('data-source-url')  || null,
        vintage:    el.getAttribute('data-vintage')     || null,
        sourceType: el.getAttribute('data-source-type') || null,
      };
      var id = el.getAttribute('data-source-id');
      if (!opts.vintage && id && !el.__sbWait) {
        // Wait for the inventory's date rather than print "date unconfirmed".
        el.__sbWait = true;
        (function (node, o, sid) {
          inventory().then(function (list) {
            var s = findSource(list, sid);
            if (s && s.lastUpdated) o.vintage = 'updated ' + s.lastUpdated;
            attach(node, o);
          });
        })(el, opts, id);
        continue;
      }
      if (el.__sbWait) continue;
      attach(el, opts);
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
