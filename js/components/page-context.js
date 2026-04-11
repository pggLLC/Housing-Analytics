/**
 * js/components/page-context.js
 * Page-purpose disclosure: "What this page does / Why it matters / What it does NOT do"
 *
 * Renders a compact, collapsible context block at the top of analysis pages.
 * Helps users understand scope before diving into data.
 *
 * Usage (declarative):
 *   <div id="pageContext"
 *     data-ctx-what="Screening-level housing needs snapshot using public Census, DOLA, and HUD data."
 *     data-ctx-why="LIHTC applications require documented community need. This tool helps identify where need is greatest before commissioning a formal study."
 *     data-ctx-not="This is not a certified housing needs study, CHFA-required market analysis, or professional due diligence report.">
 *   </div>
 *
 * Or imperative:
 *   PageContext.render('pageContext', {
 *     what: '...',
 *     why: '...',
 *     not: '...',
 *     nextSteps: [{ label: 'Market Analysis', href: 'market-analysis.html', desc: 'Score a specific site' }]
 *   });
 *
 * Exposes window.PageContext.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(containerId, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var what = opts.what || '';
    var why = opts.why || '';
    var not = opts.not || '';
    var nextSteps = opts.nextSteps || [];

    if (!what && !why && !not) return;

    var nextHtml = '';
    if (nextSteps.length) {
      var links = nextSteps.map(function (s) {
        return '<a href="' + esc(s.href) + '" class="pctx-next-link">' +
          '<strong>' + esc(s.label) + '</strong>' +
          (s.desc ? ' <span class="pctx-next-desc">— ' + esc(s.desc) + '</span>' : '') +
          '</a>';
      }).join('');
      nextHtml = '<div class="pctx-section pctx-next">' +
        '<div class="pctx-label">Related steps</div>' +
        '<div class="pctx-next-links">' + links + '</div>' +
        '</div>';
    }

    el.innerHTML =
      '<details class="pctx-panel" open>' +
        '<summary class="pctx-summary">About this page</summary>' +
        '<div class="pctx-body">' +
          (what ? '<div class="pctx-section"><div class="pctx-label">What this page does</div><p class="pctx-text">' + esc(what) + '</p></div>' : '') +
          (why  ? '<div class="pctx-section"><div class="pctx-label">Why it matters</div><p class="pctx-text">' + esc(why) + '</p></div>' : '') +
          (not  ? '<div class="pctx-section pctx-not"><div class="pctx-label">What this page does NOT do</div><p class="pctx-text">' + esc(not) + '</p></div>' : '') +
          nextHtml +
        '</div>' +
      '</details>';
  }

  function scan() {
    var els = document.querySelectorAll('[data-ctx-what],[data-ctx-why],[data-ctx-not]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.id) continue;
      render(el.id, {
        what: el.getAttribute('data-ctx-what') || '',
        why:  el.getAttribute('data-ctx-why') || '',
        not:  el.getAttribute('data-ctx-not') || ''
      });
    }
  }

  function init() { scan(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.PageContext = { render: render, scan: scan };
})();
