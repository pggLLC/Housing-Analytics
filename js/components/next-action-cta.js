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

  // The next step on the 1-7 path (workflow-progress.js STEPS) from each
  // page. Walkthrough 2026-10-20 (R1): the old strip pinned three equal
  // buttons to the bottom of the phone screen (about a fifth of it) and
  // competed with the step rail. Now there is one next action, at the end
  // of the page, and the cross-tool links stay as plain links under it.
  var NEXT = {
    'of':   { step: 3, label: 'Housing Needs Assessment', page: 'hna' },
    'hna':  { step: 4, label: 'Market Analysis', page: 'pma' },
    'pma':  { step: 5, label: 'Scenario Builder', href: 'hna-scenario-builder.html' },
    'deal': { step: 7, label: 'Recommendation', href: 'recommendation.html', geoSupport: 'both', noAuto: true }
  };

  function _buildHref(pageDef, jurisdiction) {
    if (!jurisdiction || !pageDef.geoSupport) return pageDef.href;
    return pageDef.href + '?fips=' + encodeURIComponent(jurisdiction.fips) +
           '&geoType=' + encodeURIComponent(jurisdiction.geoType) + (pageDef.noAuto ? '' : '&auto=1');
  }

  function render(opts) {
    opts = opts || {};
    var fromPage = opts.fromPage || 'unknown';
    var jurisdiction = opts.jurisdiction || _getActiveJurisdiction();
    var next = NEXT[fromPage];
    var nextDef = next ? (next.page ? PAGES[next.page] : next) : null;

    var primary = nextDef
      ? '<a class="naca-next" href="' + _buildHref(nextDef, jurisdiction) + '">Next: Step ' + next.step + ', ' + next.label + ' \u2192</a>'
      : '';

    var keys = Object.keys(PAGES).filter(function (k) {
      return k !== fromPage && !(next && next.page === k);
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoMount);
  } else {
    _autoMount();
  }
}());
