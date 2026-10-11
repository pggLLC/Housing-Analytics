/**
 * guided-route-map.js — the whole guided path on one screen, before step 1.
 *
 * The rail shows where a reader is; this shows where the path goes and what
 * each stop answers, for the product they chose. Every label, link and swap
 * comes from WorkflowProgress.stepsFor(product), the same list the rail and
 * the next-step banner use, so the map cannot name a step the rail does not.
 *
 *   GuidedRouteMap.render(mountEl, product)   // product: a WorkflowProgress product key
 *   GuidedRouteMap.html(steps, productLabel)  // pure, for tests
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GuidedRouteMap = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : null;

  // What each stop answers, in the reader's words. A step a product routes to
  // another page carries its own `action` sentence and uses that instead.
  var ANSWERS = {
    jurisdiction:   'Which place are you working on?',
    opportunity:    'Where in Colorado does a tax-credit project score well?',
    hsa:            'Who lives here, and which households are short of housing?',
    market:         'Can a site here fill its units?',
    scenario:       'How do rents, mix and growth change the need?',
    deal:           'Does the project pencil, and how big is the gap?',
    recommendation: 'What does it all add up to?'
  };
  // Step 2 is the one stop the path does not require (select-jurisdiction.html
  // says so in its step-2 note).
  var OPTIONAL = { opportunity: true };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function html(steps, productLabel) {
    var anyRouted = false, anyCompanion = false;
    var items = steps.map(function (s) {
      if (s.routed) anyRouted = true;
      if (s.companion) anyCompanion = true;
      return '<li data-step-key="' + esc(s.key) + '"'
        + (OPTIONAL[s.key] ? ' data-optional="true"' : '')
        + (s.routed ? ' data-routed="true"' : '') + '>'
        + '<span class="dg-route__num" aria-hidden="true">' + esc(s.num) + '</span>'
        + '<a class="dg-route__label" href="' + esc(s.href) + '">'
        + '<span class="sr-only">Step ' + esc(s.num) + ': </span>' + esc(s.label) + '</a>'
        + '<span class="dg-route__answers">' + esc(s.routed && s.action ? s.action : ANSWERS[s.key] || '')
        + (OPTIONAL[s.key] ? ' Optional.' : '') + '</span>'
        + (s.companion
          ? '<a class="dg-route__also" href="' + esc(s.companion.href) + '">For the for-sale homes, also: '
            + esc(s.companion.label) + '</a>'
          : '')
        + '</li>';
    }).join('');
    var legend = '<p class="dg-legend"><span><i aria-hidden="true"></i>Required step</span>'
      + '<span><i class="is-optional" aria-hidden="true"></i>Optional</span>'
      + (anyRouted ? '<span><i class="is-routed" aria-hidden="true"></i>Swapped for ownership tools</span>' : '')
      + '</p>';
    return '<figure class="diagram dg-route-map" aria-labelledby="routeMapTitle">'
      + '<p class="diagram__title" id="routeMapTitle">The path ahead: ' + esc(productLabel) + '</p>'
      + '<ol class="dg-route">' + items + '</ol>' + legend
      + '<figcaption>' + (anyCompanion
        ? 'Rental and for-sale projects follow the rental steps; the for-sale tool for a step is listed under it.'
        : 'Change what you are planning above and the path changes with it.')
      + '</figcaption></figure>';
  }

  function render(mount, product) {
    var WP = root && root.WorkflowProgress;
    if (!mount || !WP || typeof WP.stepsFor !== 'function') return false;
    var match = (WP.PRODUCTS || []).filter(function (p) { return p.id === product; })[0];
    var label = match ? match.label : product;
    mount.innerHTML = html(WP.stepsFor(product), label);
    return true;
  }

  return { ANSWERS: ANSWERS, OPTIONAL: OPTIONAL, html: html, render: render };
}));
