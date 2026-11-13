// The five menus. Each opens a panel listing its pages with one line on what each answers.
// Pages rebuilt in the lab open here; the rest open the live site, and the panel says which.
(function (global) {
  'use strict';

  // A port into the public site sets LAB_LIVE to its own root, so these links stay on that site.
  var LIVE = global.LAB_LIVE != null ? global.LAB_LIVE : 'https://cohoanalytics.com/';

  // lab: a lab route. path: a live page, linked as cohoanalytics.com shows it today.
  var MENUS = [
    { id: 'places', title: 'Places and need', question: 'Where is the need, and how big is it?', hub: '#/places', views: ['places', 'place', 'report'], groups: [
      { title: 'Look up a place', items: [
        { label: 'Find a place', lab: '#/places', desc: 'Any Colorado town, county or CDP, with its full needs assessment.' },
        { label: 'Housing Needs Assessment', lab: '#/place/0828745', desc: 'Six chapters per place. Fruita is the sample.' },
        { label: 'Free report', lab: '#/report', desc: 'A printable needs and market summary for any place. Free.' },
        { label: 'Walking and biking', lab: '#/places/walk-bike', desc: 'How many homes can walk or bike to groceries, schools, care and jobs.' },
        { label: 'Compare places', lab: '#/places/compare', desc: 'Two to six places side by side.' },
        { label: 'HNA ranking', lab: '#/places/ranking', desc: 'Every county, town and CDP ranked on housing need.' },
        { label: 'Scenario builder', lab: '#/places/scenario', desc: 'Change the state forecast and see the homes needed.' }] },
      { title: 'The state picture', items: [
        { label: 'Colorado deep dive', lab: '#/places/deep-dive', desc: 'County markets: tax credit pipeline, AMI gap, QCTs and DDAs.' },
        { label: 'Economic dashboard', lab: '#/places/economy', desc: 'Rates, costs, jobs and inflation that shape deals.' },
        { label: 'Housing costs by county', lab: '#/places/county-costs', desc: 'County rents, prices, wages and permits, mapped.' },
        { label: 'Multifamily lens', lab: '#/places/multifamily', desc: 'Apartment stock, tenure, rent and cost burden.' },
        { label: 'Construction costs', lab: '#/places/costs', desc: 'Apartment building prices since 2020, and what happened.' },
        { label: 'Local incentives', lab: '#/places/incentives', desc: 'Which housing tools each county and town has adopted.' },
        { label: 'How towns attract affordable housing', lab: '#/places/attract-housing', desc: 'What a town or county can do, in order of what matters most.' }] }
    ] },
    { id: 'opportunities', title: 'Opportunities', question: 'Where can homes be built or kept affordable?', hub: '#/opportunities', views: ['opportunities', 'opportunity', 'finder'], groups: [
      { title: 'Find a site or a property', items: [
        { label: 'Opportunity Finder lite', lab: '#/finder', desc: 'Every town on the facts for 4% and 9% deals. Free.' },
        { label: 'Preservation inventory', lab: '#/opportunity/preservation', desc: 'Affordable homes that could be lost, and when.' },
        { label: 'Preservation in Colorado', lab: '#/guide/preservation', desc: 'Right to buy, park sales and money to keep homes affordable.' },
        { label: 'CHFA portfolio', lab: '#/opportunity/portfolio', desc: 'Every tax credit property and its homes.' },
        { label: 'Land value', lab: '#/opportunity/land-value', desc: 'Estimate a site’s land value and a negotiation range.' },
        { label: 'Commuting and jobs', lab: '#/opportunity/commuting', desc: 'Where workers live, where the jobs are, and the largest employers.' }] },
      { title: 'Where the money went', items: [
        { label: '2026 Round One awards', lab: '#/opportunity/round-one', desc: 'CHFA’s latest tax credit awards.' },
        { label: 'Prop 123 land banking', lab: '#/opportunity/land-banking', desc: 'State awards to buy land for future homes.' }] }
    ] },
    { id: 'deal', title: 'Build a deal', question: 'Does this project pencil, and who does what?', hub: '#/projects', views: ['projects', 'project', 'homes', 'handoff', 'convert', 'financials', 'open-deal', 'deal-calculator', 'sale-deal', 'use', 'deals', 'equity-pricing', 'pipeline', 'market', 'for-sale', 'recommendation', 'ic-summary', 'design'], groups: [
      { title: 'Tools', items: [
        { label: 'Deal Calculator', lab: '#/deal-calculator', desc: 'Sources and uses, credits, debt and the gap.' },
        { label: 'Market check', lab: '#/market', desc: 'Renters, rents, supply and a capture rate for any place. Free.' },
        { label: 'For-sale and ownership', lab: '#/for-sale', desc: 'What each income can pay for a home, and resale formulas. Free.' },
        { label: 'Recommendation', lab: '#/recommendation', desc: 'What the public data says a place needs, and how sure. Free.' },
        { label: 'Deal summaries', lab: '#/deals', desc: 'One sourced summary per Colorado tax credit award.' },
        { label: 'Investor summary', lab: '#/ic-summary', desc: 'One place on one page, for lenders and investors.' },
        { label: 'Your projects', lab: '#/projects', desc: 'Projects saved in this browser.' }] },
      { title: 'Learn how deals work', items: [
        { label: 'LIHTC basics', lab: '#/guide/lihtc-basics', desc: 'How tax credits work, and who does what.' },
        { label: 'Who does what', lab: '#/guide/deal-team', desc: 'Bankers, syndicators, lawyers and local partners.' },
        { label: 'How it gets built', lab: '#/pipeline', desc: 'Eight stages from need to homes people can afford.' },
        { label: 'Tax credit equity markets', lab: '#/equity-pricing', desc: 'What investors pay for credits now.' },
        { label: 'Green building', lab: '#/guide/green-building', desc: 'CHFA green rules, costs and Colorado programs.' },
        { label: 'Design, health and community', lab: '#/design', desc: 'Small homes that work, porches, access rules and what CHFA scores.' },
        { label: 'Resident services', lab: '#/guide/resident-services', desc: 'Services that help residents stay housed.' },
        { label: 'CRA and pricing', lab: '#/guide/cra-pricing', desc: 'How bank rule changes could move credit prices.' }] }
    ] },
    { id: 'policy', title: 'Policy & research', question: 'What is changing, and what does the research say?', hub: '#/guides', views: ['guides', 'guide', 'news', 'digest', 'housing-posts', 'legislation', 'calendar', 'elections', 'money', 'research', 'tax-credit-history', 'middle-income'], groups: [
      { title: 'Policy and news', items: [
        { label: 'Housing news', lab: '#/news', desc: 'Colorado housing news articles, dated and linked.' },
        { label: 'Sunday digest', lab: '#/digest', desc: 'The week in Colorado housing news, every item linked to its source.' },
        { label: 'Deadlines and events', lab: '#/calendar', desc: 'CHFA round dates, law deadlines, hearings, trainings and conferences.' },
        { label: 'Who holds housing posts', lab: '#/housing-posts', desc: 'State housing appointments at DOLA, CHFA, OEDIT and the State Housing Board.' },
        { label: 'Legislation 2026', lab: '#/legislation', desc: 'Federal and Colorado housing laws COHO tracks.' },
        { label: 'AHCIA status', lab: '#/guide/ahcia', desc: 'Where the federal credit expansion stands.' },
        { label: 'Fair housing', lab: '#/guide/fair-housing', desc: 'What the federal rollback did, and what survives.' },
        { label: 'Federal rule changes', lab: '#/guide/federal-rules', desc: 'Federal fixes that would help affordable housing, ranked.' },
        { label: 'Elections', lab: '#/elections', desc: 'How elections and ballot measures shape housing policy.' },
        { label: 'Where the money goes', lab: '#/money', desc: 'Housing awards from CHFA, OEDIT and others, traced.' }] },
      { title: 'Research', items: [
        { label: 'Research overview', lab: '#/research', desc: 'All research and analysis in one place.' },
        { label: 'How tax credit deals have changed', lab: '#/tax-credit-history', desc: 'Colorado’s housing tax credit since 1987: deal size, bonds, who it serves.' },
        { label: 'Commuters and capture rates', lab: '#/guide/commuters-capture', desc: 'How workers who drive in can widen a rental\u2019s market, and the proof CHFA asks for.' },
        { label: 'Middle-income rental', lab: '#/middle-income', desc: 'The middle-income credit, Prop 123 Equity and town deed restrictions: who each serves.' },
        { label: 'White paper', lab: '#/guide/white-paper', desc: 'Deciding about housing with public data.' },
        { label: 'Working paper', lab: '#/guide/working-paper', desc: 'What building a public housing-data system taught.' },
        { label: 'Starting a housing authority', lab: '#/guide/housing-authority', desc: 'How a Colorado town or county creates one, step by step.' }] }
    ] },
    { id: 'data', title: 'Data and methods', question: 'Where does each number come from, and can I trust it?', hub: '#/data', views: ['data'], groups: [
      { title: 'How it works', items: [
        { label: 'Methods', lab: '#/guide/methods', desc: 'Every calculation behind the need estimates.' },
        { label: 'Trust center', lab: '#/data/trust', desc: 'Sources, freshness and QA behind every number.' },
        { label: 'About', lab: '#/guide/about', desc: 'Sources, methods and how the site is built.' },
        { label: 'Glossary', lab: '#/data/glossary', desc: 'Plain definitions of tax credit and housing terms.' }] },
      { title: 'The data', items: [
        { label: 'Data explorer', lab: '#/data/explorer', desc: 'Every data file behind the site, with previews.' },
        { label: 'Data map', lab: '#/data/map', desc: 'Every geographic dataset on a map.' },
        { label: 'Data sources', lab: '#/data/sources', desc: 'Every source, its freshness and coverage.' },
        { label: 'Data quality', lab: '#/data/quality', desc: 'Source status and pipeline health.' },
        { label: 'Data status', lab: '#/data/status', desc: 'Freshness checks for every dataset.' }] }
    ] }
  ];

  var esc = function (s) { return global.LabShell.esc(s); };
  // In a port into the public site (window.LAB_PORT), a lab route the hub carries stays a route, one it does
  // not carry opens the public page it rebuilds, and a lab page with no public page yet is left out (null).
  var PORT = global.LAB_PORT || null;
  function href(it) { return it.lab ? (PORT ? PORT.href(it.lab) : it.lab) : LIVE + it.path; }
  function isLive(it) { return !PORT && !it.lab; }

  function panel(m) {
    return '<div class="mega" id="mega-' + m.id + '" hidden><div class="mega-inner">' +
      '<div class="mega-intro"><p class="mega-question">' + esc(m.question) + '</p>' +
      (!PORT || PORT.href(m.hub) === m.hub ? '<a class="mega-hub" href="' + esc(m.hub) + '" data-hub="' + esc(m.views[0]) + '">All of ' + esc(m.title) + ' →</a>' : '') + '</div>' +
      m.groups.map(function (g) {
        var items = g.items.filter(function (it) { return href(it) != null; });
        if (!items.length) return '';
        return '<div class="mega-group"><h2 class="mega-title">' + esc(g.title) + '</h2><ul>' + items.map(function (it) {
          return '<li><a href="' + esc(href(it)) + '"' + (isLive(it) ? ' class="is-live"' : '') + '><span class="mega-label">' + esc(it.label) +
            (isLive(it) ? '<span class="live-tag" aria-label="opens the live site">live site ↗</span>' : '') + '</span>' +
            '<span class="mega-desc">' + esc(it.desc) + '</span></a></li>';
        }).join('') + '</ul></div>';
      }).join('') + '</div></div>';
  }

  function render() {
    var nav = document.getElementById('site-nav');
    nav.innerHTML = '<ul class="menus">' + MENUS.map(function (m) {
      return '<li class="menu"><button type="button" class="menu-button" aria-expanded="false" aria-controls="mega-' + m.id + '" data-menu="' + m.id + '">' +
        esc(m.title) + '<span class="chev" aria-hidden="true"></span></button>' + panel(m) + '</li>';
    }).join('') + '</ul>' +
      '<span class="nav-utilities">' +
      [['#/assistance', 'assistance', 'Housing help', ''], ['#/search', 'search', 'Search', 'nav-search'], ['#/members', 'members', 'Members', 'nav-members']].map(function (u) {
        var to = PORT ? PORT.href(u[0]) : u[0];
        return to == null ? '' : '<a href="' + esc(to) + '" data-hub="' + u[1] + '"' + (u[3] ? ' class="' + u[3] + '"' : '') + '>' + u[2] + '</a>';
      }).join('') + '</span>';
  }

  function closeAll(except) {
    document.querySelectorAll('.menu-button').forEach(function (b) {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      document.getElementById(b.getAttribute('aria-controls')).hidden = true;
    });
  }

  function toggle(btn, open) {
    closeAll(btn);
    var on = open == null ? btn.getAttribute('aria-expanded') !== 'true' : open;
    btn.setAttribute('aria-expanded', String(on));
    document.getElementById(btn.getAttribute('aria-controls')).hidden = !on;
  }

  function menuFor(view) {
    return MENUS.filter(function (m) { return m.views.indexOf(view) > -1; })[0] || null;
  }

  // The menu button for the section the reader is in shows as current.
  function mark() {
    var at = (location.hash || '#/').split('?')[0];
    var view = at.slice(2).split('/')[0] || 'home';
    // A page listed in a menu belongs to that menu (LIHTC basics sits under Build a deal, though
    // guides as a kind belong to Policy and research); otherwise the view decides.
    var m = MENUS.filter(function (x) { return x.groups.some(function (g) { return g.items.some(function (it) { return it.lab && (at === it.lab || at.indexOf(it.lab + '/') === 0); }); }); })[0] || menuFor(view);
    // The two resident guides sit under Housing help, which is not one of the five menus.
    var help = /^#\/(assistance|guide\/(renter-help|homebuyer-help))$/.test(at.replace(/\/$/, ''));
    if (help) m = null;
    document.querySelectorAll('.menu-button').forEach(function (b) {
      if (m && b.dataset.menu === m.id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    closeAll();
  }

  // The page wires the menus; the checks in qa/ load this file for its menu list only.
  if (document.getElementById && document.getElementById('site-nav')) {
    render();
    var nav = document.getElementById('site-nav');
    nav.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.menu-button');
      if (btn) toggle(btn);
    });
    document.addEventListener('click', function (ev) { if (!ev.target.closest('#site-nav')) closeAll(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var open = document.querySelector('.menu-button[aria-expanded="true"]');
      if (open) { closeAll(); open.focus(); }
    });
    window.addEventListener('hashchange', mark);
    mark();
  }

  global.LabNav = { MENUS: MENUS, menuFor: menuFor, href: href, LIVE: LIVE };
})(window);
