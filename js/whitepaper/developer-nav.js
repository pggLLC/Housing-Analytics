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

  // The menu in groups (paul, 3 Nov: seventeen member tools no longer fit one row).
  // The top row names the groups; the row below lists the pages in the group you are in.
  // private: served only by the member site (coho-backend gated/), so no file here.
  var GROUPS = [
    { label: 'Home', pages: [{ href: 'developer.html', label: 'Home' }] },
    { label: 'Find', pages: [
      { href: 'developer-where.html', label: 'Where to build' },
      { href: 'developer-finder.html', label: 'Where to look', private: true },
      { href: 'developer-brief.html', label: 'Jurisdiction reports', also: ['developer-whitepaper.html'] },
      { href: 'developer-entitled-land.html', label: 'Entitled land', private: true },
      { href: 'developer-parcel-sales.html', label: 'Parcel sales', private: true },
      { href: 'developer-preservation-first.html', label: 'Preservation first', private: true }] },
    { label: 'Check a site', pages: [
      { href: 'developer-market-screen.html', label: 'Market screen', private: true },
      { href: 'developer-env-screen.html', label: 'Environmental screen', private: true },
      { href: 'developer-commuters.html', label: 'Commuters', private: true }] },
    { label: 'Deal', pages: [
      { href: 'developer-deal-workbook.html', label: 'Deal workbook' },
      { href: 'developer-investor-returns.html', label: 'Investor returns', private: true },
      { href: 'developer-submittal-review.html', label: 'Submittal review' }] },
    { label: 'Next round', pages: [
      { href: 'developer-round-watch.html', label: 'Next round' },
      { href: 'developer-next-places.html', label: 'Next places', private: true },
      { href: 'developer-frontier.html', label: 'Where money goes furthest', private: true }] },
    { label: 'Team', pages: [
      { href: 'developer-pipeline.html', label: 'Pipeline' },
      { href: 'dossiers/', label: 'Dossiers', private: true }] },
    { label: 'About', pages: [
      { href: 'developer-methods.html', label: 'Methodology' },
      { href: 'developer-about.html', label: 'About' }] }
  ];
  var ALL = [];
  GROUPS.forEach(function (g) { g.pages.forEach(function (p) { ALL.push(p); }); });
  // Pages with a file in this repo, and pages only the member site serves.
  var PAGES = ALL.filter(function (p) { return !p.private; });
  var PRIVATE = ALL.filter(function (p) { return p.private; });
  var BACK = { href: 'lihtc-opportunity-finder.html', label: '← Opportunity Finder' };
  // /logout (coho-backend) clears the password cookie and ends the Cloudflare
  // sign-in, so the next visit asks for a code again.

  var STYLE =
    '.ib-section-nav{display:flex;flex-wrap:wrap;gap:.25rem .5rem;align-items:center;padding:.6rem 0;margin-bottom:var(--sp3,1rem);border-bottom:1px solid var(--border);font-size:var(--small,.9rem)}' +
    '.ib-section-nav a{color:var(--muted);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;min-height:44px;min-width:44px;box-sizing:border-box;padding:.35rem .7rem;border-radius:var(--radius-sm,6px)}' +
    '.ib-section-nav a[aria-current="page"]{color:var(--accent);background:color-mix(in oklab,var(--accent) 10%,transparent 90%)}' +
    '.ib-section-nav a:hover{color:var(--accent)}.ib-section-nav .spacer{flex:1}' +
    // The pages of the group you are in, under the group row.
    '#devNav a[aria-current="true"]{color:var(--accent);box-shadow:inset 0 -2px 0 var(--accent);border-radius:0}' +
    '@media print{#devSubNav{display:none !important}}' +
    '#devNav{margin-bottom:0}#devNav+.dev-sub-nav{margin-top:0;border-bottom:1px solid var(--border);font-weight:500}' +
    '.ib-section-nav .dev-nav-badge{background:var(--warn);color:var(--card);font-size:.8125rem;padding:2px 7px;border-radius:9999px;font-weight:700;letter-spacing:.03em}' +
    // On a phone the eleven links wrapped to five rows above every page. One row that
    // scrolls sideways instead, with the page you are on scrolled into view.
    '@media (max-width:640px){.ib-section-nav{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;padding:.25rem 0;' +
    // a fade at the right edge says the row goes on
    '-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 2.5rem),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 2.5rem),transparent)}' +
    '.ib-section-nav a,.ib-section-nav .dev-nav-badge{flex:0 0 auto;white-space:nowrap}.ib-section-nav .spacer{flex:0 0 .5rem}}';

  function isHere(p, path) {
    var str = String(path || '');
    var inDossiers = /\/dossiers\//.test(str);
    if (p.href === 'dossiers/' || inDossiers) return p.href === 'dossiers/' && inDossiers;
    var file = str.split('/').pop() || 'developer.html';
    return p.href === file || (p.also || []).indexOf(file) !== -1;
  }
  function current(path) {
    for (var i = 0; i < ALL.length; i++) if (isHere(ALL[i], path)) return ALL[i];
    return null;
  }
  function groupOf(path) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].pages.some(function (p) { return isHere(p, path); })) return GROUPS[i];
    }
    return null;
  }

  // "../" for each folder between the page and the site root, counted from /dossiers/: "/dossiers/" and
  // "/dossiers/index.html" are one deep, "/dossiers/<slug>/index.html" two. "" anywhere else.
  function upFrom(path) {
    var m = /\/dossiers\/(.*)$/.exec(String(path || ''));
    if (!m) return '';
    return new Array(m[1].split('/').length + 1).join('../');
  }

  // The top row: one link per group, to its first page.
  function html(path) {
    var g = groupOf(path);
    return GROUPS.map(function (x) {
      return '<a href="' + x.pages[0].href + '"' + (x === g ? ' aria-current="true" class="active"' : '') + '>' + x.label + '</a>';
    }).join('') + '<a href="' + BACK.href + '">' + BACK.label + '</a><span class="spacer"></span><span class="dev-nav-badge">INTERNAL</span><a href="/logout">Sign out</a>';
  }

  // The second row: every page in the group you are in. Empty for a one-page group.
  function subHtml(path) {
    var g = groupOf(path), here = current(path);
    if (!g || g.pages.length < 2) return '';
    return g.pages.map(function (p) {
      return '<a href="' + p.href + '"' + (p === here ? ' aria-current="page" class="active"' : '') + '>' + p.label + '</a>';
    }).join('');
  }

  function centre(nav, cur) {
    if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - nav.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2); // centred, so the links either side show
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
    var path = doc.location ? doc.location.pathname : '';
    nav.setAttribute('aria-label', 'Member site sections');
    nav.innerHTML = html(path);
    centre(nav, nav.querySelector('[aria-current]'));
    var subMarkup = subHtml(path), sub = doc.getElementById('devSubNav');
    if (subMarkup) {
      if (!sub) {
        sub = doc.createElement('nav');
        sub.id = 'devSubNav';
        sub.className = 'ib-section-nav dev-sub-nav';
        nav.parentNode.insertBefore(sub, nav.nextSibling);
      }
      sub.setAttribute('aria-label', 'Pages in ' + groupOf(path).label);
      sub.innerHTML = subMarkup;
      centre(sub, sub.querySelector('[aria-current="page"]'));
    } else if (sub) sub.parentNode.removeChild(sub);
        // The links are written from the site root. Under /dossiers/ (the index, or a dossier's own folder) they
    // need the way back up, or "developer.html" would resolve inside the dossier folder.
    var up = upFrom(path);
    if (up) Array.prototype.forEach.call(doc.querySelectorAll('#devNav a[href], #devSubNav a[href]'), function (a) {
      var h = a.getAttribute('href');
      if (!/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(h)) a.setAttribute('href', up + h);
    });
    // "Working on: <place>" under the menu (member-place.js). Loaded from here so every page with the member
    // menu gets it without each page listing another script.
    if (doc.createElement && doc.head && !doc.getElementById('mpScript') && !root.MemberPlace) {
      var mp = doc.createElement('script');
      mp.id = 'mpScript'; mp.src = up + 'js/whitepaper/member-place.js';
      doc.head.appendChild(mp);
    }
    var out = nav.querySelector('a[href="/logout"]');
    if (out) out.addEventListener('click', function () {
      try { root.sessionStorage.removeItem('ib-auth-v1'); } catch (_) { /* storage blocked */ }
    });
  }

  var api = { GROUPS: GROUPS, PAGES: PAGES, PRIVATE: PRIVATE, html: html, subHtml: subHtml, mount: mount, upFrom: upFrom };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.DeveloperNav = api;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { mount(); });
      else mount();
    }
  }
}(typeof self !== 'undefined' ? self : this));
