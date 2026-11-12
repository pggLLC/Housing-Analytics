// The lab's hubs as they run inside the public site (paul, 12 Nov 2026, option A; "Build all, release together").
// scripts/build-port.js --hub <id> writes this file to <Housing-Analytics>/hub/lab-config.js and fills HUBS
// (each hub page and the routes it draws, from port/hubs.js) and GUIDES. Every hub page sits at the site's
// root, so the site's own engines and data files are read in place: nothing comes from the lab's vendor copy.
window.LAB_VENDOR = './';
window.LAB_LIVE = '';
window.LAB_SITE = 'hub/';
window.LAB_TITLE = 'COHO Analytics';
// Tables sort with the site's own js/components/table-sort.js, not the lab's copy.
window.LAB_SITE_SORT = true;
window.resolveAssetUrl = function (p) { return p; };

(function (global) {
  'use strict';

  // Each hub page and the routes it draws itself. A route another hub page draws opens that page; any other
  // route opens the public page it rebuilds (FORWARD). The old pages stay live until the cutover redirects them.
  var HUBS = {"places-hub.html":["^#\\/places\\/?$","^#\\/places\\/(compare|ranking|scenario)\\/?$","^#\\/place\\/\\d{5,7}(\\/[a-z-]+)?\\/?$","^#\\/places\\/(incentives(\\/\\d{5,7})?|costs|economy|county-costs|multifamily|deep-dive|walk-bike|attract-housing)\\/?$","^#\\/report\\/?$"],"deal-hub.html":["^#\\/(projects|project|homes|handoff|convert|financials|open-deal|deal-calculator|sale-deal|use|deals|equity-pricing|pipeline|market|for-sale|recommendation|ic-summary|design)(\\/.*)?$"],"opportunities-hub.html":["^#\\/(opportunities|opportunity|finder)(\\/.*)?$"],"data-hub.html":["^#\\/data(\\/.*)?$"]}, STARTS = {"places-hub.html":"#/places","deal-hub.html":"#/projects","opportunities-hub.html":"#/opportunities","data-hub.html":"#/data"};
  Object.keys(HUBS).forEach(function (p) { HUBS[p] = HUBS[p].map(function (re) { return new RegExp(re); }); });
  var HERE = (location.pathname.split('/').pop() || 'index.html');
  var CARRIED = HUBS[HERE] || [];

  // Lab route -> public page. A place carried in the route (?g= or ?geoid=) goes with it as ?geoid=.
  var FORWARD = {
    '#/': 'index.html',
    '#/places/incentives': 'local-incentives.html',
    '#/places/costs': 'construction-commodities.html',
    '#/places/economy': 'economic-dashboard.html',
    '#/places/county-costs': 'article-co-housing-costs.html',
    '#/places/multifamily': 'census-dashboard.html',
    '#/places/deep-dive': 'colorado-deep-dive.html',
    '#/finder': 'lihtc-opportunity-finder.html',
    '#/recommendation': 'recommendation.html',
    '#/deal-calculator': 'deal-calculator.html',
    '#/equity-pricing': 'article-pricing.html',
    '#/market': 'market-analysis.html',
    '#/for-sale': 'for-sale-market-study.html',
    '#/deals': 'deal-summary.html',
    '#/ic-summary': 'ic-summary.html',
    '#/pipeline': 'pipeline.html',
    '#/money': 'where-housing-money-goes.html',
    '#/research': 'insights.html',
    '#/news': 'policy-briefs.html',
    '#/digest': 'sunday-digest.html',
    '#/legislation': 'housing-legislation-2026.html',
    '#/elections': 'colorado-elections.html',
    '#/opportunity/preservation': 'preservation.html',
    '#/opportunity/portfolio': 'chfa-portfolio.html',
    '#/opportunity/land-value': 'land-value.html',
    '#/opportunity/commuting': 'commuting.html',
    '#/opportunity/round-one': 'chfa-portfolio.html',
    '#/opportunity/land-banking': 'land-banking-awards.html',
    '#/data/map': 'data-map-browser.html',
    '#/data/explorer': 'data-explorer.html',
    '#/data/quality': 'dashboard-data-quality.html',
    '#/data/sources': 'dashboard-data-sources-ui.html',
    '#/data/status': 'data-status.html',
    '#/data/trust': 'data-review-hub.html',
    '#/assistance': 'housing-help.html',
    '#/search': 'search.html',
    '#/terms': 'terms-of-use.html',
    '#/privacy': 'privacy-policy.html',
    '#/sitemap': 'sitemap.html',
    '#/members': 'https://coho-backend.communityplanner.workers.dev/'
  };
  // Filled by the build from each guide's own public page (site/guides/<slug>.json "live").
  var GUIDES = {"about":"about.html","ahcia":"lihtc-enhancement-ahcia.html","cra-pricing":"cra-expansion-analysis.html","deal-reading":"deal-calculator.html","deal-team":"affordable-deal-team.html","fair-housing":"article-fair-housing-rollback.html","federal-rules":"article-federal-rule-changes.html","green-building":"green-building-guide.html","housing-authority":"housing-authority-guide.html","legislation-road":"housing-legislation-2026.html","lihtc-basics":"lihtc-guide-for-stakeholders.html","methods":"methods.html","renter-help":"housing-help.html","resident-services":"resident-services.html","white-paper":"apa-white-paper.html","working-paper":"working-paper.html"};
  Object.keys(GUIDES).forEach(function (slug) { FORWARD['#/guide/' + slug] = GUIDES[slug]; });

  function split(hash) {
    var h = String(hash || '#/'), q = h.indexOf('?');
    return { path: (q > -1 ? h.slice(0, q) : h).replace(/\/$/, '') || '#', query: q > -1 ? h.slice(q + 1) : '' };
  }
  function drawnBy(list, hash) { var p = split(hash).path; return list.some(function (re) { return re.test(p) || re.test(p + '/'); }); }
  function carries(hash) { return drawnBy(CARRIED, hash); }
  // The other hub page that draws a route, or null.
  function hubFor(hash) { var hit = null; Object.keys(HUBS).forEach(function (p) { if (!hit && p !== HERE && drawnBy(HUBS[p], hash)) hit = p; }); return hit; }
  // The public page for a lab route, or null when the site has none.
  function page(hash) {
    var other = hubFor(hash);
    if (other) return other + String(hash || '#/');
    var s = split(hash), path = s.path === '#' ? '#/' : s.path, to = FORWARD[path];
    if (!to) return null;
    // The route's own query goes too (QA/QC F01, 12 Nov: only the place was carried, so layer=qct and other
    // settings were dropped). The lab's g is the site's geoid; a malformed place is left out, never guessed.
    // Nothing is added to a link off this site (the member site).
    if (/^https?:/.test(to)) return to;
    var q = new URLSearchParams(s.query), out = new URLSearchParams(), geoid = q.get('geoid') || q.get('g');
    if (geoid && /^\d{5,7}$/.test(geoid)) out.set('geoid', geoid);
    q.forEach(function (v, k) { if (k !== 'g' && k !== 'geoid') out.append(k, v); });
    var qs = out.toString();
    return to + (qs ? '?' + qs : '');
  }
  // Where a link to a lab route should point here: the route itself, the public page, or null (leave it out).
  function href(hash) { return carries(hash) ? hash : page(hash); }
  // A route typed or followed that this page does not carry: the hub page or public page that has it, else
  // this page's own start.
  function leave(hash) { return carries(hash) ? null : (page(hash) || STARTS[HERE] || '#/'); }
  // Points every in-page lab link at what this site carries; a link with nowhere to go is left out
  // (a button) or kept as plain text (a link inside a sentence).
  // The Spanish link sends the page to Google Translate. Like the site's own (js/navigation.js spanishHref), it
  // carries the place and nothing else: a place page's route (#/place/<geoid>/<chapter>), never a query.
  function spanishHref(hash) {
    var m = /^#\/place\/\d{5,7}(\/[a-z-]+)?/.exec(split(hash).path);
    var u = 'https://cohoanalytics.com/' + HERE + (m ? m[0] : '');
    return 'https://translate.google.com/translate?sl=en&tl=es&hl=es&u={page}'.replace('{page}', function () { return encodeURIComponent(u); });
  }
  function fix(root) {
    var es = document.querySelector('a[lang="es"]');
    if (es) es.setAttribute('href', spanishHref(location.hash));
    // On the public site itself, "live site" and the lab's rebuilt/current tags say nothing; members-only stays.
    Array.prototype.forEach.call(root.querySelectorAll('.live-tag, .status-lab, .status-current'), function (n) { n.parentNode.removeChild(n); });
    Array.prototype.forEach.call(root.querySelectorAll('a'), function (a) {
      var t = a.lastChild;
      if (t && t.nodeType === 3 && /\s*(on the live site\s*)?↗\s*$/.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(/\s*(on the live site\s*)?↗\s*$/, '');
    });
    // A full cohoanalytics.com address is this site: keep it on the host it was opened on, so a staging build stays
    // on staging (QA/QC, 12 Nov: the Deal Calculator link left staging).
    Array.prototype.forEach.call(root.querySelectorAll('a[href^="https://cohoanalytics.com/"]'), function (a) {
      a.setAttribute('href', a.getAttribute('href').replace(/^https:\/\/cohoanalytics\.com\//, '') || 'index.html');
    });
    Array.prototype.forEach.call(root.querySelectorAll('a[href^="#/"]'), function (a) {
      var to = href(a.getAttribute('href'));
      if (to === a.getAttribute('href')) return;
      if (to) { a.setAttribute('href', to); return; }
      if (a.classList.contains('button-link') || a.classList.contains('use-link')) { a.parentNode.removeChild(a); return; }
      a.replaceWith(document.createTextNode(a.textContent));
    });
  }
  global.LAB_PORT = { HUBS: HUBS, HERE: HERE, CARRIED: CARRIED, FORWARD: FORWARD, carries: carries, hubFor: hubFor, page: page, href: href, leave: leave, fix: fix, spanishHref: spanishHref };
})(window);
