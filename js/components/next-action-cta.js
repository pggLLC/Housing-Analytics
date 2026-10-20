/**
 * js/components/next-action-cta.js
 *
 * Renders a "Next" block at the end of each core analytical page of the
 * deal-targeting workflow:
 *
 *   Opportunity Finder   →   Find a market
 *   Housing Needs Asmt.  →   Browse need data per jurisdiction
 *   Market Analysis      →   Run a PMA workup for a site
 *   Deal Calculator      →   Build a deal concept + capital stack
 *
 * One primary link goes to the next step on the 1-7 path; the other core
 * pages follow as plain "also for this place" links. When a jurisdiction is in scope
 * (via URL ?fips= param, WorkflowState, or SiteState) the URLs include
 * ?fips=…&geoType=… so the destination page auto-loads it.
 *
 * Usage from a page:
 *   <script src="js/components/next-action-cta.js" defer></script>
 *   <div id="next-action-cta-mount"></div>
 *
 * Or auto-mount at the bottom of <main>:
 *   <script src="js/components/next-action-cta.js" defer
 *           data-next-action-auto="true"
 *           data-from-page="hna"></script>
 *
 * data-from-page values: 'hna' | 'of' | 'pma' | 'deal'
 *
 * (c) COHO Analytics
 */

(function () {
  'use strict';

  var PAGES = {
    'of':   { label: '🎯 Opportunity Finder',   href: 'lihtc-opportunity-finder.html',  geoSupport: 'place' },
    'hna':  { label: '📋 Housing Needs Asmt.',  href: 'housing-needs-assessment.html',  geoSupport: 'both' },
    'pma':  { label: '🗺️ Market Analysis (PMA)', href: 'market-analysis.html',          geoSupport: 'place-or-county' },
    'deal': { label: '💵 Deal Calculator',       href: 'deal-calculator.html',           geoSupport: 'county' }
  };

  function _getActiveJurisdiction() {
    try {
      var shared = window.JurisdictionUrlContext &&
        window.JurisdictionUrlContext.resolveSync &&
        window.JurisdictionUrlContext.resolveSync();
      if (shared && (shared.fips || shared.geoid)) {
        return { fips: shared.fips || shared.geoid, geoType: shared.geoType || 'county' };
      }
    } catch (_) {}

    // Priority: URL params → WorkflowState → SiteState
    try {
      var sp = new URLSearchParams(window.location.search);
      var fips = sp.get('fips') || sp.get('geoid');
      var geoType = sp.get('geoType');
      if (fips && /^\d{5}$/.test(fips)) return { fips: fips, geoType: geoType || 'county' };
      if (fips && /^\d{7}$/.test(fips)) return { fips: fips, geoType: geoType || 'place' };
    } catch (_) {}
    try {
      var p = window.WorkflowState && window.WorkflowState.getActiveProject && window.WorkflowState.getActiveProject();
      var jx = p && (p.jurisdiction || (p.steps && p.steps.jurisdiction));
      if (jx) {
        if (jx.placeGeoid && /^\d{7}$/.test(jx.placeGeoid)) return { fips: jx.placeGeoid, geoType: 'place' };
        if (jx.fips || jx.countyFips) return { fips: jx.fips || jx.countyFips, geoType: 'county' };
      }
    } catch (_) {}
    try {
      var sc = window.SiteState && window.SiteState.getCounty && window.SiteState.getCounty();
      if (sc && sc.fips) return { fips: sc.fips, geoType: 'county' };
    } catch (_) {}
    return null;
  }

  // The page's own slot on the 1-7 path. The next step is the slot after it
  // on the reader's product route (WorkflowProgress.routeSteps(): a for-sale
  // project's step 4 is the for-sale market study, not Market Analysis), so
  // this block and the step rail cannot disagree. Walkthrough 2026-10-20
  // (R1): the old strip pinned three equal buttons to the bottom of the phone
  // screen (about a fifth of it) and competed with the rail. Now there is one
  // next action, at the end of the page, and the other tools stay as plain
  // links under it.
  var SLOT = { 'of': 2, 'hna': 3, 'pma': 4, 'deal': 6 };
  // Used only when workflow-progress.js is not on the page; mirrors its
  // STEPS (test/next-step-link.test.js checks that it does).
  var FALLBACK_ROUTE = [
    { num: 3, key: 'hsa',            label: 'Needs Assessment', href: 'hna-what-housing-exists.html' },
    { num: 4, key: 'market',         label: 'Market Analysis',  href: 'market-analysis.html' },
    { num: 5, key: 'scenario',       label: 'Scenarios',        href: 'hna-scenario-builder.html' },
    { num: 6, key: 'deal',           label: 'Deal Calculator',  href: 'deal-calculator.html' },
    { num: 7, key: 'recommendation', label: 'Recommendation',   href: 'recommendation.html' }
  ];
  // Which PAGES entry a route slot opens, so it is not listed twice.
  var KEY_TO_PAGE = { hsa: 'hna', market: 'pma', deal: 'deal', opportunity: 'of' };

  function _route() {
    try {
      var WP = window.WorkflowProgress;
      if (WP && typeof WP.routeSteps === 'function') {
        var r = WP.routeSteps();
        if (r && r.length) return r;
      }
    } catch (_) {}
    return FALLBACK_ROUTE;
  }

  function _nextStep(fromPage) {
    var slot = SLOT[fromPage];
    if (!slot) return null;
    var route = _route();
    for (var i = 0; i < route.length; i++) if (route[i].num === slot + 1) return route[i];
    return null;
  }

  // Carry the jurisdiction in the form each page reads: the Scenario Builder
  // takes geoid/geoType, the Recommendation reads fips/geoType without
  // auto-running, and the rest take fips/geoType/auto=1.
  function _withJurisdiction(href, jurisdiction, noAuto) {
    if (!jurisdiction) return href;
    var sep = href.indexOf('?') === -1 ? '?' : '&';
    var fips = encodeURIComponent(jurisdiction.fips);
    var geoType = encodeURIComponent(jurisdiction.geoType);
    if (/hna-scenario-builder\.html/.test(href)) {
      return href + sep + 'geoType=' + geoType + '&geoid=' + fips + '&auto=1';
    }
    return href + sep + 'fips=' + fips + '&geoType=' + geoType +
      ((noAuto || /recommendation\.html/.test(href)) ? '' : '&auto=1');
  }

  function _buildHref(pageDef, jurisdiction) {
    if (!jurisdiction || !pageDef.geoSupport) return pageDef.href;
    return _withJurisdiction(pageDef.href, jurisdiction);
  }

  function render(opts) {
    opts = opts || {};
    var fromPage = opts.fromPage || 'unknown';
    var jurisdiction = opts.jurisdiction || _getActiveJurisdiction();
    var next = _nextStep(fromPage);
    var nextPage = next ? KEY_TO_PAGE[next.key] : null;

    var primary = next
      ? '<a class="naca-next" href="' + _withJurisdiction(next.href, jurisdiction) + '">Next: Step ' + next.num + ', ' + next.label + ' \u2192</a>'
      : '';

    var keys = Object.keys(PAGES).filter(function (k) {
      return k !== fromPage && !(next && !next.routed && nextPage === k);
    });
    var links = keys.map(function (k) {
      var def = PAGES[k];
      return '<a class="naca-btn" href="' + _buildHref(def, jurisdiction) + '">' + def.label + '</a>';
    }).join('');
    var jxName = jurisdiction
      ? '<span class="naca-jx">Also for <strong>' + (jurisdiction.geoType === 'place' ? 'this place' : 'this jurisdiction') + '</strong>:</span>'
      : '<span class="naca-jx naca-jx--none">Other tools (select a jurisdiction first to carry it forward):</span>';

    return '<aside class="naca-strip" data-naca-auto="true" role="navigation" aria-label="Next steps">' +
      '<div class="naca-strip__inner">' +
        primary +
        '<div class="naca-also">' + jxName +
        '<div class="naca-links">' + links + '</div></div>' +
      '</div>' +
    '</aside>';
  }

  function _injectStyles() {
    if (document.getElementById('naca-strip-styles')) return;
    var s = document.createElement('style');
    s.id = 'naca-strip-styles';
    s.textContent = [
      '.naca-strip { margin: 32px 0 16px; padding: 16px; border: 1px solid var(--border);',
      '  border-left: 3px solid var(--accent); border-radius: 8px; background: var(--card); }',
      '.naca-strip__inner { max-width: 1200px; margin: 0 auto;',
      '  display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }',
      '.naca-next { display: inline-flex; align-items: center; min-height: 44px; padding: 8px 16px;',
      '  border-radius: 8px; font-weight: 800; background: var(--accent); color: var(--on-accent, #fff);',
      '  text-decoration: none; }',
      '.naca-next:hover { text-decoration: underline; }',
      'html.dark-mode .naca-next { color: #0a0f1d; }',
      '.naca-also { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.naca-jx { font-size: .875rem; color: var(--muted); }',
      '.naca-jx--none { font-style: italic; }',
      '.naca-links { display: flex; gap: 6px; flex-wrap: wrap; }',
      '.naca-btn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px;',
      '  border-radius: 6px; font-size: .875rem; font-weight: 700;',
      '  background: var(--card); border: 1px solid var(--border); color: var(--text); text-decoration: none; }',
      '.naca-btn:hover { border-color: var(--accent); text-decoration: underline; }'
    ].join('\n');
    document.head.appendChild(s);
  }

  // Public API
  window.NextActionCTA = { render: render, getActiveJurisdiction: _getActiveJurisdiction };

  // Auto-mount via data attribute
  function _autoMount() {
    var scripts = document.querySelectorAll('script[src*="next-action-cta.js"][data-next-action-auto="true"]');
    if (!scripts.length) return;
    var fromPage = scripts[0].getAttribute('data-from-page') || 'unknown';
    _injectStyles();
    var existingStrip = document.querySelector('.naca-strip[data-naca-auto="true"]');
    if (existingStrip && existingStrip.parentNode) existingStrip.parentNode.removeChild(existingStrip);
    var html = render({ fromPage: fromPage });
    var mount = document.getElementById('next-action-cta-mount');
    if (mount) {
      mount.outerHTML = html;
      return;
    }
    // No explicit mount — append to <main>
    var main = document.querySelector('main');
    if (main) main.insertAdjacentHTML('beforeend', html);
  }

  document.addEventListener('jurisdiction-url-context:resolved', _autoMount);
  document.addEventListener('workflow:product-changed', _autoMount);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoMount);
  } else {
    _autoMount();
  }
}());
