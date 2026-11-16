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

// Pages whose content now lives in a hub view (paul, 14 Nov 2026: "redirect group A", "redirect county costs"; 15 Nov 2026:
// groups B and C, "finish everything else", once the content gaps behind them were live). The content check of 14 Nov
// 2026 found each page's headings, figures and tables in its view. Two parts:
//  1. An old address forwards to its view, as the guides do: never inside a frame, never with ?classic=1,
//     which still opens the page as written. A place, a deal or a comparison in the address goes with it, as do the
//     town or county picked on local-incentives.html (#j=<geoid>) and a county's deal write-ups (?county=).
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
    'article-co-housing-costs.html': 'places-hub.html#/places/county-costs',
    // Group B (15 Nov 2026).
    'census-dashboard.html': 'places-hub.html#/places/multifamily',
    'chfa-portfolio.html': 'opportunities-hub.html#/opportunity/portfolio',
    'colorado-deep-dive.html': 'places-hub.html#/places/deep-dive',
    'economic-dashboard.html': 'places-hub.html#/places/economy',
    'hna-comparative-analysis.html': 'places-hub.html#/places/ranking',
    'insights.html': 'policy-hub.html#/research',
    'housing-legislation-2026.html': 'policy-hub.html#/legislation',
    'land-banking-awards.html': 'opportunities-hub.html#/opportunity/land-banking',
    'pipeline.html': 'deal-hub.html#/pipeline',
    'data-explorer.html': 'data-hub.html#/data/explorer',
    'dashboard-data-quality.html': 'data-hub.html#/data/quality',
    'dashboard-data-sources-ui.html': 'data-hub.html#/data/sources',
    'data-review-hub.html': 'data-hub.html#/data/trust',
    // Group C (15 Nov 2026): the needs assessment and its five chapters open the place's page on the same chapter.
    'housing-needs-assessment.html': 'places-hub.html#/places',
    'hna-who-lives-here.html': 'places-hub.html#/places',
    'hna-what-housing-exists.html': 'places-hub.html#/places',
    'hna-what-households-can-afford.html': 'places-hub.html#/places',
    'hna-where-its-heading.html': 'places-hub.html#/places',
    'hna-what-to-do.html': 'places-hub.html#/places',
    'ic-summary.html': 'deal-hub.html#/ic-summary',
    'where-housing-money-goes.html': 'policy-hub.html#/money',
    // Duplicates batch 3 (16 Nov 2026): the weekly digest and its earlier editions are the Sunday digest view.
    'sunday-digest.html': 'policy-hub.html#/digest'
  };
  // Pages that stay at their own address, but whose links on other pages open the newer copy of the same tool, with the
  // same query and hash. Duplicates batch 3 (16 Nov 2026): market-analysis.html is the page the full Market Analysis is
  // kept on, and deal-market-analysis.html is built from it (scripts/build-market-analysis-hub.mjs) in the new pages'
  // header and step bar; every menu already opens the new one. The old page itself does not forward, because the
  // member site's Market screen engine loads it by name (coho-backend engines/market-screen).
  var LINK_TO = { 'market-analysis.html': 'deal-market-analysis.html' };
  // The place page's chapter for each needs assessment page (hub/hna.js TABS).
  var HNA_TAB = { 'housing-needs-assessment.html': '', 'hna-who-lives-here.html': '/people', 'hna-what-housing-exists.html': '/housing',
    'hna-what-households-can-afford.html': '/afford', 'hna-where-its-heading.html': '/future', 'hna-what-to-do.html': '/action' };
  // The deep dive's tabs (hub/deep-dive.js TABS), named in the old page's hash (#tab-funding) and taken by the view as ?tab=.
  var DD_TABS = ['deepdive', 'ami-gap', 'market-trends', 'snapshot', 'affordability-geo', 'signals', 'construction', 'history', 'funding', 'market', 'need', 'direction', 'patterns', 'timeline'];
  // Three old tab names the view calls something else (Codex P2 on #2877): the old "Colorado Snapshot" and "Market
  // Conditions" tabs (with its policy simulator) are the view's snapshot tab, and "Market patterns" is its patterns tab.
  var DD_OLD = { 'state-comparison': 'snapshot', 'policy-simulator': 'snapshot', 'types': 'patterns' };
  var CO_GEO = /^08\d{3}(\d{2})?$/;
  // The place this browser is working on. The hubs and the member site keep it under coho-lab-working and
  // coho-member-place as {geoid, at}, and the newer of the two wins (hub/step-bar.js working()). Only a browser that
  // has neither falls back to the place last picked on the old pages (js/workflow-state-core.js: the active
  // project's id under coho_wf_active, the project under coho_wf_project_<id>, its place under .jurisdiction).
  // The hub place comes first: a project left on the old pages sent a member who had since picked another place
  // back to the old one, and the place page then saved it over theirs (member live check, 15 Nov 2026: El Paso
  // over Carbondale). Read only, never written.
  function keptPlace(key) {
    try {
      var x = JSON.parse(window.localStorage.getItem(key) || 'null');
      var g = x && typeof x === 'object' ? String(x.geoid || '') : '';
      var at = x ? Number(x.at) : 0;
      return CO_GEO.test(g) ? { geoid: g, at: isFinite(at) && at > 0 ? at : 0 } : null;
    } catch (e) { return null; }
  }
  function savedPlace() {
    var member = keptPlace('coho-member-place'), hub = keptPlace('coho-lab-working');
    var w = member && hub ? (hub.at > member.at ? hub : member) : (member || hub);
    if (w) return w.geoid;
    try {
      var id = JSON.parse(window.localStorage.getItem('coho_wf_active') || 'null');
      var j = id && (JSON.parse(window.localStorage.getItem('coho_wf_project_' + id) || 'null') || {}).jurisdiction;
      var g = j ? String(j.geoid || j.fips || '').replace(/\D/g, '') : '';
      return g === '08' || CO_GEO.test(g) ? g : null;
    } catch (e) { return null; }
  }
  var GEO = /^\d{5}(\d{2})?$/;
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  // The view for an old page, its query string and its hash, or null when the page stays as written. forLink is set
  // when a link on a page is being pointed at its view, rather than the page itself forwarding.
  function movedTo(file, search, hash, forLink) {
    if (!has(MOVED_PAGES, file)) return null;
    var q = new URLSearchParams(search || '');
    if (q.has('classic')) return null;
    if (file === 'select-jurisdiction.html' && (q.has('next') || q.has('step') || q.has('new'))) return null;
    var to = MOVED_PAGES[file];
    var places = function (list) {
      return list.filter(function (x, i, a) { return x && GEO.test(x) && a.indexOf(x) === i; });
    };
    if (file === 'deal-summary.html' && /^[a-z0-9-]{1,120}$/.test(q.get('d') || '')) return to + '/' + q.get('d');
    // A county's write-ups (?county=<name> as CHFA prints it, js/components/place-deals-limits.js) open filtered.
    if (file === 'deal-summary.html' && /^[A-Za-z .'-]{2,40}$/.test(q.get('county') || '')) return to + '?county=' + encodeURIComponent(q.get('county'));
    if (file === 'compare.html') {
      var picked = places(String(q.get('jurisdictions') || '').split(',')).slice(0, 6);
      var t = /^[a-z0-9_-]{1,20}$/.test(q.get('target') || '') ? q.get('target') : '';
      var qs = [picked.length ? 'g=' + picked.join(',') : '', t ? 't=' + t : ''].filter(Boolean).join('&');
      return to + (qs ? '?' + qs : '');
    }
    // Local incentives keeps its picked town or county in the hash (#j=<geoid>, js/local-incentives.js geoidFromHash).
    if (file === 'local-incentives.html') {
      var j = /(?:^#?|[&?])j=(\d{7}|\d{5})(?!\d)/.exec(hash || '');
      if (j) return to + '/' + j[1];
    }
    if (file === 'hna-scenario-builder.html' || file === 'recommendation.html') {
      var g = places([q.get('geoid'), q.get('fips')]);
      return to + (g.length ? '?g=' + g[0] : '');
    }
    // Group C. A needs assessment page opens the place's page on its chapter. A region or a combined set of places
    // (?region=, ?geos=, ?combinedMode=) stays on the page as written, which is the only page that draws them.
    if (has(HNA_TAB, file)) {
      // Colorado as a whole has no place page in the hubs, so the statewide assessment (?geoid=08) stays as written too.
      if (q.has('region') || q.has('geos') || q.has('combinedMode') || q.get('geoid') === '08' || q.get('fips') === '08') return null;
      // With no place in the address, the old page opened the place this browser last picked (js/hna/hna-controller.js,
      // WorkflowState); so does the view. Statewide stays as written, as above.
      // A link with no place is left as written, so it opens the place saved when it is followed, not the one saved
      // when the page loaded (a recent project's Resume link saves its place on the click; Codex P2 on #2877).
      var hg = [q.get('geoid'), q.get('fips')].filter(function (x) { return x && CO_GEO.test(x); })[0];
      if (!hg && forLink) return null;
      hg = hg || savedPlace();
      if (hg === '08') return null;
      // The menus' "Ownership Need" opens the assessment at its ownership section, which is on the place's What to do chapter.
      var tab = /^#?affordable-ownership-need-section$/.test(hash || '') ? '/action' : HNA_TAB[file];
      return hg ? 'places-hub.html#/place/' + hg + tab : to;
    }
    // The investor summary carries its place; one opened from a deal (?dc= or #dc=) stays as written. With no place in
    // the address, the old page used the browser's saved workflow place (js/ic-summary.js), and so does the view
    // (Codex P2 on #2877).
    if (file === 'ic-summary.html') {
      if (q.has('dc') || /(?:^#?|[&?])dc=/.test(hash || '')) return null;
      var ig = places([q.get('geoid'), q.get('fips')])[0];
      // As for the needs assessment above, a link with no place waits for the click.
      if (!ig && forLink) return null;
      ig = ig || savedPlace();
      return to + (ig && ig !== '08' ? '?g=' + ig : '');
    }
    // An edition of the digest (?date=YYYY-MM-DD, as the Sunday email links it) opens that edition.
    if (file === 'sunday-digest.html' && /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '')) return to + '?date=' + q.get('date');
    if (file === 'data-explorer.html' && /^[A-Za-z0-9_./-]{1,200}$/.test(q.get('file') || '') && !/\.\./.test(q.get('file'))) return to + '?file=' + encodeURIComponent(q.get('file'));
    if (file === 'colorado-deep-dive.html') {
      var t2 = /^#?tab-([a-z-]{1,30})$/.exec(hash || ''), tn = t2 && (has(DD_OLD, t2[1]) ? DD_OLD[t2[1]] : t2[1]);
      if (tn && DD_TABS.indexOf(tn) >= 0) return to + '?tab=' + tn;
    }
    return to;
  }
  try {
    var loc = window.location;
    var file = String(loc.pathname || '').split('/').pop();
    // Inside a frame (how a hub reads a page) nothing is forwarded or rewritten.
    if (window.top !== window.self) return;
    var away = movedTo(file, loc.search, loc.hash);
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
      if (!name || !(has(MOVED_PAGES, name[1]) || has(LINK_TO, name[1]) || (G && has(G.pages, name[1])))) return;
      var u;
      try { u = new URL(raw, base); } catch (e) { return; }
      if (u.host !== loc.host && !/^(www\.)?cohoanalytics\.com$/i.test(u.hostname)) return;
      var f = u.pathname.split('/').pop(), to = movedTo(f, u.search, u.hash, true);
      if (!to && has(LINK_TO, f) && !new URLSearchParams(u.search).has('classic')) to = LINK_TO[f] + u.search + u.hash;
      // A written guide (forwarded since 13 Nov 2026) is pointed at its hub view the same way.
      if (!to && G && has(G.pages, f) && !/[?&]classic(=|&|$)/.test(u.search)) {
        var slug = G.pages[f], at = u.hash.slice(1);
        to = (has(G.hub, slug) ? G.hub[slug] : 'policy-hub.html') + '#/guide/' + slug + (/^[A-Za-z0-9_-]{1,80}$/.test(at) ? '?at=' + at : '');
      }
      // A link written as a path stays a path (the site audits count only outside addresses as source links); a
      // full address stays a full address.
      if (to) a.setAttribute('href', /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(raw) ? new URL(to, u).href : raw.split(/[?#]/)[0].replace(/[^\/]*$/, '') + to);
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
