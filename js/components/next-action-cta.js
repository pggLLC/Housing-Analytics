/**
 * js/components/next-action-cta.js
 *
 * Renders a sticky-bottom "Next action" CTA strip that connects the four
 * core analytical pages of the deal-targeting workflow:
 *
 *   Opportunity Finder   →   Find a market
 *   Housing Needs Asmt.  →   Browse need data per jurisdiction
 *   Market Analysis      →   Run a PMA workup for a site
 *   Deal Calculator      →   Build a deal concept + capital stack
 *
 * The CTA strip always shows the three pages NOT currently being viewed,
 * each as a click-to-navigate button. When a jurisdiction is in scope
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

  function _buildHref(pageDef, jurisdiction) {
    if (!jurisdiction || !pageDef.geoSupport) return pageDef.href;
    return pageDef.href + '?fips=' + encodeURIComponent(jurisdiction.fips) +
           '&geoType=' + encodeURIComponent(jurisdiction.geoType) + '&auto=1';
  }

  function render(opts) {
    opts = opts || {};
    var fromPage = opts.fromPage || 'unknown';
    var jurisdiction = opts.jurisdiction || _getActiveJurisdiction();

    var keys = Object.keys(PAGES).filter(function (k) { return k !== fromPage; });
    var jxName = jurisdiction
      ? '<span class="naca-jx">For <strong>' + (jurisdiction.geoType === 'place' ? 'this place' : 'this jurisdiction') + '</strong>:</span>'
      : '<span class="naca-jx naca-jx--none">Select a jurisdiction first to chain forward:</span>';

    var links = keys.map(function (k) {
      var def = PAGES[k];
      return '<a class="naca-btn" href="' + _buildHref(def, jurisdiction) + '">' + def.label + '</a>';
    }).join('');

    return '<aside class="naca-strip" data-naca-auto="true" role="navigation" aria-label="Next steps">' +
      '<div class="naca-strip__inner">' +
        '<span class="naca-label">Next step →</span>' +
        jxName +
        '<div class="naca-links">' + links + '</div>' +
      '</div>' +
    '</aside>';
  }

  function _injectStyles() {
    if (document.getElementById('naca-strip-styles')) return;
    var s = document.createElement('style');
    s.id = 'naca-strip-styles';
    s.textContent = [
      '.naca-strip { position: sticky; bottom: 0; z-index: 100;',
      '  background: color-mix(in oklab, var(--card) 92%, var(--accent) 8%);',
      '  border-top: 2px solid var(--accent);',
      '  padding: 10px 16px; margin: 0 -16px;',
      '  box-shadow: 0 -2px 12px rgba(0,0,0,0.06); }',
      '.naca-strip__inner { max-width: 1200px; margin: 0 auto;',
      '  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }',
      '.naca-label { font-weight: 800; font-size: .9rem; color: var(--accent); flex-shrink: 0; }',
      '.naca-jx { font-size: .82rem; color: var(--muted); flex-shrink: 0; }',
      '.naca-jx--none { font-style: italic; }',
      '.naca-links { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }',
      '.naca-btn { padding: 6px 12px; border-radius: 6px; font-size: .82rem; font-weight: 700;',
      '  background: var(--card); border: 1px solid var(--border); color: var(--text);',
      '  text-decoration: none; transition: background .12s, transform .1s; }',
      '.naca-btn:hover { background: var(--accent); color: var(--card);',
      '  border-color: var(--accent); transform: translateY(-1px); text-decoration: none; }',
      '@media (max-width: 700px) { .naca-strip { padding: 8px 12px; }',
      '  .naca-strip__inner { gap: 6px; } .naca-btn { padding: 4px 8px; font-size: .78rem; } }'
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
