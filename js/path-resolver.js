/**
 * js/path-resolver.js
 * Detects the deployment base path reliably for GitHub Pages and custom domains.
 * Sets window.APP_BASE_PATH and window.APP_BASE_URL for use by other scripts.
 *
 * Algorithm (portable, case-preserving):
 *  - On github.io domains: detect the repo sub-path prefix from the first pathname segment.
 *  - On custom domains: always return "/" (no repo prefix applies).
 *  - If the first segment looks like a file (contains a recognised extension), treat as root "/".
 *
 * Works on:
 *  - https://user.github.io/RepoName/page.html  →  /RepoName/
 *  - https://user.github.io/page.html           →  /
 *  - https://custom-domain.com/page.html        →  /
 *  - https://custom-domain.com/admin/page.html  →  /  (NOT /admin/)
 */
// A written guide opens in the new format (2026-11-13): policy-hub.html draws it
// (index.html for the two resident guides under Housing help)
// from the words on the guide's own page, which stay in that file and are still
// edited there. This is the first script each of those pages loads, so a
// visitor is sent on before the page paints. A section link (#id) goes with
// it. The hub reads a guide page inside a frame, and ?classic=1 shows the page
// as written (audits use it); neither is forwarded.
// test/guides-open-in-hub.test.mjs holds this list and the hub's in agreement.
(function () {
  'use strict';
  var GUIDE_PAGES = {
    'lihtc-guide-for-stakeholders.html': 'lihtc-basics',
    'affordable-deal-team.html': 'deal-team',
    'green-building-guide.html': 'green-building',
    'resident-services.html': 'resident-services',
    'cra-expansion-analysis.html': 'cra-pricing',
    'lihtc-enhancement-ahcia.html': 'ahcia',
    'article-fair-housing-rollback.html': 'fair-housing',
    'article-federal-rule-changes.html': 'federal-rules',
    'housing-authority-guide.html': 'housing-authority',
    'apa-white-paper.html': 'white-paper',
    'working-paper.html': 'working-paper',
    'methods.html': 'methods',
    'about.html': 'about',
    'housing-help.html': 'renter-help',
    'help-for-homebuyers.html': 'homebuyer-help'
  };
  // The two guides for residents open on the front page (Housing help), not under the Policy hub.
  var GUIDE_HUB = { 'renter-help': 'index.html', 'homebuyer-help': 'index.html' };
  window.COHO_GUIDE_PAGES = { pages: GUIDE_PAGES, hub: GUIDE_HUB };
  try {
    var loc = window.location;
    var file = String(loc.pathname || '').split('/').pop();
    if (!Object.prototype.hasOwnProperty.call(GUIDE_PAGES, file)) return;
    var slug = GUIDE_PAGES[file];
    if (window.top !== window.self || /[?&]classic(=|&|$)/.test(loc.search || '')) return;
    var at = String(loc.hash || '').slice(1);
    loc.replace((Object.prototype.hasOwnProperty.call(GUIDE_HUB, slug) ? GUIDE_HUB[slug] : 'policy-hub.html') + '#/guide/' + slug + (/^[A-Za-z0-9_-]{1,80}$/.test(at) ? '?at=' + at : ''));
  } catch (e) { /* the page stays as written */ }
})();

// Pages whose content now lives in a hub view (paul, 14 Nov 2026: "redirect group A", "redirect county costs"). The content
// check of 14 Nov 2026 found each page's headings, figures and tables in its view. Two parts:
//  1. An old address forwards to its view, as the guides do: never inside a frame, never with ?classic=1,
//     which still opens the page as written. A place, a deal or a comparison in the address goes with it.
//     select-jurisdiction.html is not forwarded while it picks a place for another page (?next=, ?step=,
//     ?new=) or with ?classic=1 (the place pill on the pages that stay).
//  2. On the pages that stay, a link to one of these pages (a menu, a card, a "Next" link) is pointed at
//     the view itself as the page is read or the link is used, so a reader goes straight there.
// test/old-pages-forward.test.mjs holds this list, the hubs and the lab's list (hub/nav.js) in agreement.
(function () {
  'use strict';
  var MOVED_PAGES = {
    'colorado-elections.html': 'policy-hub.html#/elections',
    'commuting.html': 'opportunities-hub.html#/opportunity/commuting',
    'compare.html': 'places-hub.html#/places/compare',
    'construction-commodities.html': 'places-hub.html#/places/costs',
    'article-pricing.html': 'deal-hub.html#/equity-pricing',
    'land-value.html': 'opportunities-hub.html#/opportunity/land-value',
    'deal-summary.html': 'deal-hub.html#/deals',
    'preservation.html': 'opportunities-hub.html#/opportunity/preservation',
    'hna-scenario-builder.html': 'places-hub.html#/places/scenario',
    'recommendation.html': 'deal-hub.html#/recommendation',
    'select-jurisdiction.html': 'places-hub.html#/places',
    'local-incentives.html': 'places-hub.html#/places/incentives',
    'policy-briefs.html': 'policy-hub.html#/news',
    'data-status.html': 'data-hub.html#/data/status',
    'data-map-browser.html': 'data-hub.html#/data/map',
    // paul, 14 Nov 2026: "redirect county costs" (rechecked on the live site after #2872).
    'article-co-housing-costs.html': 'places-hub.html#/places/county-costs'
  };
  var GEO = /^\d{5}(\d{2})?$/;
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  // The view for an old page and its query string, or null when the page stays as written.
  function movedTo(file, search) {
    if (!has(MOVED_PAGES, file)) return null;
    var q = new URLSearchParams(search || '');
    if (q.has('classic')) return null;
    if (file === 'select-jurisdiction.html' && (q.has('next') || q.has('step') || q.has('new'))) return null;
    var to = MOVED_PAGES[file];
    var places = function (list) {
      return list.filter(function (x, i, a) { return x && GEO.test(x) && a.indexOf(x) === i; });
    };
    if (file === 'deal-summary.html' && /^[a-z0-9-]{1,120}$/.test(q.get('d') || '')) return to + '/' + q.get('d');
    if (file === 'compare.html') {
      var picked = places(String(q.get('jurisdictions') || '').split(',')).slice(0, 6);
      var t = /^[a-z0-9_-]{1,20}$/.test(q.get('target') || '') ? q.get('target') : '';
      var qs = [picked.length ? 'g=' + picked.join(',') : '', t ? 't=' + t : ''].filter(Boolean).join('&');
      return to + (qs ? '?' + qs : '');
    }
    if (file === 'hna-scenario-builder.html' || file === 'recommendation.html') {
      var g = places([q.get('geoid'), q.get('fips')]);
      return to + (g.length ? '?g=' + g[0] : '');
    }
    return to;
  }
  try {
    var loc = window.location;
    var file = String(loc.pathname || '').split('/').pop();
    // Inside a frame (how a hub reads a page) nothing is forwarded or rewritten.
    if (window.top !== window.self) return;
    var away = movedTo(file, loc.search);
    if (away) { loc.replace(away); return; }
    // Part 2: links on this page.
    // Links resolve against the page without its query or hash: a calculator share link's hash runs to many
    // thousands of characters, and reading it again for every link made pages with many links stall.
    var base = loc.protocol + '//' + loc.host + loc.pathname, G = window.COHO_GUIDE_PAGES;
    var fix = function (a) {
      var raw = a && a.getAttribute && a.getAttribute('href');
      if (!raw || raw.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(raw)) return;
      // Only a link naming a forwarded page or a guide is read further.
      var name = /([^\/]+\.html)$/.exec(raw.split(/[?#]/)[0]);
      if (!name || !(has(MOVED_PAGES, name[1]) || (G && has(G.pages, name[1])))) return;
      var u;
      try { u = new URL(raw, base); } catch (e) { return; }
      if (u.host !== loc.host && !/^(www\.)?cohoanalytics\.com$/i.test(u.hostname)) return;
      var f = u.pathname.split('/').pop(), to = movedTo(f, u.search);
      // A written guide (forwarded since 13 Nov 2026) is pointed at its hub view the same way.
      if (!to && G && has(G.pages, f) && !/[?&]classic(=|&|$)/.test(u.search)) {
        var slug = G.pages[f], at = u.hash.slice(1);
        to = (has(G.hub, slug) ? G.hub[slug] : 'policy-hub.html') + '#/guide/' + slug + (/^[A-Za-z0-9_-]{1,80}$/.test(at) ? '?at=' + at : '');
      }
      if (to) a.setAttribute('href', new URL(to, u).href);
    };
    var fixIn = function (root) {
      if (!root || root.nodeType !== 1) return;
      if (root.tagName === 'A') fix(root);
      Array.prototype.forEach.call(root.querySelectorAll('a[href]'), fix);
    };
    var fixAll = function () { fixIn(document.documentElement); };
    var onUse = function (e) { var a = e.target && e.target.closest && e.target.closest('a[href]'); if (a) fix(a); };
    ['click', 'auxclick', 'contextmenu', 'focusin'].forEach(function (k) { document.addEventListener(k, onUse, true); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixAll); else fixAll();
    window.addEventListener('load', fixAll);
    // Pages that draw their links later (a chapter's "Next" links, deal cards, the step bar that adds the place to
    // its links) get them pointed as they appear or change: only what was added or changed is read, not the whole
    // page again. A link this script points is not pointed again: its new address names no forwarded page.
    if (window.MutationObserver) {
      new window.MutationObserver(function (records) {
        records.forEach(function (r) {
          if (r.type === 'attributes') fix(r.target); else Array.prototype.forEach.call(r.addedNodes, fixIn);
        });
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    }
    window.COHO_MOVED_PAGES = { pages: MOVED_PAGES, to: movedTo };
  } catch (e) { /* the page stays as written */ }
})();

(function () {
  'use strict';

  function computeBasePath() {
    var hostname = (window.location && window.location.hostname) ? window.location.hostname : '';
    var pathname = (window.location && window.location.pathname) ? window.location.pathname : '/';

    // Only attempt GitHub Pages repo detection on *.github.io hosts.
    // Custom domains always serve from the root — no repo sub-path prefix applies.
    var isGitHubPages = /\.github\.io$/i.test(hostname);
    if (!isGitHubPages) return '/';

    var parts = pathname.replace(/^\/+/, '').split('/').filter(Boolean);

    // If first segment looks like a file (has a recognised extension), treat as root
    if (!parts.length || /\.\w+$/.test(parts[0])) return '/';

    // GitHub Pages project site: /RepoName/...  (preserve original casing)
    return '/' + parts[0] + '/';
  }

  var basePath = computeBasePath();
  var baseUrl  = window.location.protocol + '//' + window.location.host + basePath;

  window.APP_BASE_PATH = basePath;
  window.APP_BASE_URL  = baseUrl;
  window.__PATH_DEBUG__ = { pathname: window.location.pathname, base: basePath };
})();
