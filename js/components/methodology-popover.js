/**
 * methodology-popover.js
 *
 * Per-chart / per-stat plain-language methodology disclosure. Drops
 * an ℹ summary next to a heading; when the user opens it, surfaces
 * five structured fields: what, source, method, drift, caveats.
 *
 * Why
 * ---
 * The page-level PageContext panel covers "what's this page for"; this
 * component fills the same need at the metric level so a user can
 * ask "what's actually behind this number" without leaving the page.
 *
 * Public API
 * ----------
 *   window.MethodologyPopover.attach(targetEl, {
 *     what:        'Share of renter HH by gross rent as % of income',
 *     source:      'ACS DP04 GRAPI bins (2024)',
 *     method:      'Counts of households in each bin / total rented HH',
 *     drift:       'ACS 2023 bins changed — DP04_0143-46PE no longer exist',
 *     caveats:     '≥30%=cost-burdened; ≥50%=severely burdened. Self-reported.'
 *   });
 *
 *   window.MethodologyPopover.attachAll([
 *     { selector: '#rentBurdenHeading', meta: { ... } },
 *     ...
 *   ]);
 *
 * Idempotent — attaching twice replaces the existing popover.
 */
(function () {
  'use strict';

  var FIELDS = [
    { key: 'what',    label: 'What it measures' },
    { key: 'source',  label: 'Where it comes from' },
    { key: 'method',  label: 'How it’s calculated' },
    { key: 'drift',   label: 'Known drift / caveats' },
    { key: 'caveats', label: 'Use with care' },
  ];

  function _esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _buildPopover(meta) {
    var rows = FIELDS
      .filter(function (f) { return meta[f.key]; })
      .map(function (f) {
        return '<dt>' + _esc(f.label) + '</dt>' +
               '<dd>' + _esc(meta[f.key]) + '</dd>';
      })
      .join('');
    var details = document.createElement('details');
    details.className = 'methodology-popover';
    details.innerHTML =
      '<summary class="methodology-popover__summary" ' +
        'title="What’s behind this number?" ' +
        'aria-label="Open methodology disclosure for this metric">' +
        'ℹ️ Methodology' +
      '</summary>' +
      '<dl class="methodology-popover__body">' + rows + '</dl>';
    return details;
  }

  function attach(target, meta) {
    var el = (typeof target === 'string') ? document.querySelector(target) : target;
    if (!el || !meta) return null;
    // Remove existing popover at this anchor so attach() is idempotent.
    var prev = el.querySelector(':scope > .methodology-popover');
    if (prev) prev.remove();
    var pop = _buildPopover(meta);
    el.appendChild(pop);
    return pop;
  }

  function attachAll(items) {
    if (!Array.isArray(items)) return;
    items.forEach(function (it) { attach(it.selector, it.meta); });
  }

  window.MethodologyPopover = { attach: attach, attachAll: attachAll };
})();
