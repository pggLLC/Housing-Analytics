/**
 * developer-nav.js — the one menu for every gated developer page.
 *
 * Each page carries an empty <nav id="devNav" class="ib-section-nav"> and this
 * script fills it, so the pages cannot drift apart again (2026-10-14: five pages
 * had four different menus). test/jurisdiction-whitepaper.test.mjs fails on a gated page
 * that writes its own links.
 *
 * Lives in js/whitepaper/ because the gated bundle already copies that folder and
 * the public build already excludes it.
 */
(function (root) {
  'use strict';

  var PAGES = [
    { href: 'developer.html', label: 'Home' },
    { href: 'developer-brief.html', label: 'Jurisdiction reports', also: ['developer-whitepaper.html'] },
    { href: 'developer-where.html', label: 'Where to build' },
    { href: 'developer-pipeline.html', label: 'Pipeline' },
    { href: 'developer-methods.html', label: 'Methodology' },
    { href: 'developer-about.html', label: 'About' }
  ];
  // Served only by the private site (coho-backend), so there is no file for it here.
  var PRIVATE = [{ href: 'dossiers/', label: 'Dossiers' }];
  var BACK = { href: 'lihtc-opportunity-finder.html', label: '← Opportunity Finder' };

  var STYLE =
    '.ib-section-nav{display:flex;flex-wrap:wrap;gap:.25rem .5rem;align-items:center;padding:.6rem 0;margin-bottom:var(--sp3,1rem);border-bottom:1px solid var(--border);font-size:var(--small,.9rem)}' +
    '.ib-section-nav a{color:var(--muted);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;min-height:44px;min-width:44px;box-sizing:border-box;padding:.35rem .7rem;border-radius:var(--radius-sm,6px)}' +
    '.ib-section-nav a[aria-current="page"]{color:var(--accent);background:color-mix(in oklab,var(--accent) 10%,transparent 90%)}' +
    '.ib-section-nav a:hover{color:var(--accent)}.ib-section-nav .spacer{flex:1}' +
    '.ib-section-nav .dev-nav-badge{background:var(--warn);color:var(--card);font-size:.8125rem;padding:2px 7px;border-radius:9999px;font-weight:700;letter-spacing:.03em}';

  function current(path) {
    var file = String(path || '').split('/').pop() || 'developer.html';
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].href === file || (PAGES[i].also || []).indexOf(file) !== -1) return PAGES[i].href;
    }
    return null;
  }

  function html(path) {
    var here = current(path);
    return PAGES.map(function (p) {
      return '<a href="' + p.href + '"' + (p.href === here ? ' aria-current="page" class="active"' : '') + '>' + p.label + '</a>';
    }).join('') + PRIVATE.map(function (p) {
      return '<a href="' + p.href + '"' + (/\/dossiers\//.test(String(path || '')) ? ' aria-current="page" class="active"' : '') + '>' + p.label + '</a>';
    }).join('') + '<a href="' + BACK.href + '">' + BACK.label + '</a><span class="spacer"></span><span class="dev-nav-badge">INTERNAL</span>';
  }

  function mount(doc) {
    doc = doc || root.document;
    var nav = doc && doc.getElementById('devNav');
    if (!nav) return;
    if (!doc.getElementById('devNavStyle')) {
      var st = doc.createElement('style');
      st.id = 'devNavStyle';
      st.textContent = STYLE;
      doc.head.appendChild(st);
    }
    nav.setAttribute('aria-label', 'Developer pages');
    nav.innerHTML = html(doc.location ? doc.location.pathname : '');
  }

  var api = { PAGES: PAGES, PRIVATE: PRIVATE, html: html, mount: mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.DeveloperNav = api;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { mount(); });
      else mount();
    }
  }
}(typeof self !== 'undefined' ? self : this));
