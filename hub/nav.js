// The four menus, with Home the five hubs (reorg step 2b). Each opens a panel listing its pages with one line on what each answers.
// Pages rebuilt in the lab open here; the rest open the live site, and the panel says which.
(function (global) {
  'use strict';

  // A port into the public site sets LAB_LIVE to its own root, so these links stay on that site.
  var LIVE = global.LAB_LIVE != null ? global.LAB_LIVE : 'https://cohoanalytics.com/';

  // lab: a lab route. path: a live page, linked as cohoanalytics.com shows it today.
  // step: the item is that step of the seven from a town to a deal (site/step-bar.js PATH, counted from 0). The menu
  // steps (paul, 16 Nov 2026: "build the menu steps"): a step's item takes the step bar's name, says it is one of the
  // seven steps, and opens on the working place as the bar does. The seven sit in three menus, by what they answer;
  // the line under each ties them together. No step numbers: "1, 3, 5" in one menu reads oddly.
  var MENUS = [
    { id: 'places', title: 'Places and need', question: 'Where is the need, and how big is it?', summary: 'Start with one place for its own numbers, or look across the state.', hub: '#/places', views: ['places', 'place', 'report'], groups: [
      { title: 'Look up a place', about: 'One town, county or CDP: its needs assessment, report, ranking and what-ifs.', items: [
        { step: 0, label: 'Jurisdiction', lab: '#/places', desc: 'Find any Colorado town, county or CDP, with its full needs assessment.' },
        { step: 2, label: 'Needs Assessment', lab: '#/place/0828745', desc: 'The housing needs assessment: six chapters per place, need by income level.' },
        { label: 'Free report', lab: '#/report', desc: 'A printable needs and market summary for any place. Free.' },
        { label: 'Walking and biking', lab: '#/places/walk-bike', desc: 'How many homes can walk or bike to groceries, schools, care and jobs.' },
        { label: 'Compare 2–6 places', lab: '#/places/compare', desc: 'Two to six places side by side, figure by figure.' },
        { label: 'Rank every place', lab: '#/places/ranking', desc: 'Every county, town and CDP ranked on need and opportunity (HNA ranking, 55% need).' },
        { step: 4, label: 'Scenarios', lab: '#/places/scenario', desc: 'Change the state forecast and see the homes needed.' }] },
      { title: 'The state picture', about: 'Statewide maps and dashboards: costs, jobs, apartments and local tools.', items: [
        { label: 'Colorado deep dive', lab: '#/places/deep-dive', desc: 'County markets: tax credit pipeline, AMI gap, QCTs and DDAs.' },
        { label: 'Economic dashboard', lab: '#/places/economy', desc: 'Rates, costs, jobs and inflation that shape deals.' },
        { label: 'Housing costs by county', lab: '#/places/county-costs', desc: 'County rents, prices, wages and permits, mapped.' },
        { label: 'Multifamily lens', lab: '#/places/multifamily', desc: 'Apartment stock, tenure, rent and cost burden.' },
        { label: 'Construction costs', lab: '#/places/costs', desc: 'Apartment building prices since 2020, and what happened.' },
        { label: 'Local incentives', lab: '#/places/incentives', desc: 'Which housing tools each county and town has adopted.' },
        { label: 'How towns attract affordable housing', lab: '#/places/attract-housing', desc: 'What a town or county can do, in order of what matters most.' }] }
    ] },
    // Money and deals (reorg step 2b, paul 23 Nov 2026 "build Home and the menu"): Opportunities and Build a deal in one
    // menu, with Where the money goes from Policy. No page or address moves.
    { id: 'deal', title: 'Money and deals', question: 'Where can homes be built, does the deal pencil, and where did the money go?', summary: 'From a site to a tested deal, and what has already been funded.', hub: '#/projects', views: ['opportunities', 'opportunity', 'finder', 'money', 'projects', 'project', 'homes', 'handoff', 'convert', 'financials', 'open-deal', 'open-calc', 'deal-calculator', 'sale-deal', 'use', 'deals', 'equity-pricing', 'pipeline', 'market', 'for-sale', 'recommendation', 'ic-summary', 'design'], groups: [
      { title: 'Tools', about: 'Test a deal: market check, Deal Calculator, ownership and summaries.', items: [
        { step: 5, label: 'Deal Calculator', lab: '#/deal-calculator', desc: 'Sources and uses, credits, debt and the gap.' },
        { label: 'Market check', lab: '#/market', desc: 'Renters, rents, supply and a capture rate for any place. Free.' },
        { step: 3, label: 'Market Analysis', path: 'deal-market-analysis.html', desc: 'The full study for one site: market area, demand, rents and capture. A member tool, open to all for now.' },
        { label: 'For-sale and ownership', lab: '#/for-sale', desc: 'What each income can pay for a home, and resale formulas. Free.' },
        { step: 6, label: 'Recommendation', lab: '#/recommendation', desc: 'What the public data says a place needs, and how sure. Free.' },
        { label: 'Deal summaries', lab: '#/deals', desc: 'One sourced summary per Colorado tax credit award.' },
        { label: 'Investor summary', lab: '#/ic-summary', desc: 'One place on one page, for lenders and investors.' },
        { label: 'Your projects', lab: '#/projects', desc: 'Projects saved in this browser.' }] },
      { title: 'Find a site or a property', about: 'Land, homes at risk of loss and existing tax credit homes.', items: [
        { step: 1, label: 'Opportunity Finder', lab: '#/finder', desc: 'Every town on the facts for 4% and 9% deals. Free.' },
        { label: 'Preservation inventory', lab: '#/opportunity/preservation', desc: 'Affordable homes that could be lost, and when.' },
        { draft: true, label: 'Preservation in Colorado', lab: '#/guide/preservation', desc: 'Right to buy, park sales and money to keep homes affordable.' },
        { label: 'CHFA portfolio', lab: '#/opportunity/portfolio', desc: 'Every tax credit property and its homes.' },
        { label: 'Land value', lab: '#/opportunity/land-value', desc: 'Estimate a site’s land value and a negotiation range.' },
        { label: 'Commuting and jobs', lab: '#/opportunity/commuting', desc: 'Where workers live, where the jobs are, and the largest employers.' }] },
      { title: 'Where the money went', about: 'Past awards from CHFA, the state and others.', items: [
        { label: '2026 Round One awards', lab: '#/deals?round=2026-1', desc: 'CHFA’s latest tax credit awards.' },
        { label: 'Prop 123 land banking', lab: '#/opportunity/land-banking', desc: 'State awards to buy land for future homes.' },
        { label: 'Where the money goes', lab: '#/money', desc: 'Housing awards from CHFA, OEDIT and others, traced.' }] },
      { title: 'Learn how deals work', about: 'Short guides to tax credits, partners and building.', items: [
        { label: 'LIHTC basics', lab: '#/guide/lihtc-basics', desc: 'How tax credits work, and who does what.' },
        { label: 'Who does what', lab: '#/guide/deal-team', desc: 'Bankers, syndicators, lawyers and local partners.' },
        { label: 'How it gets built', lab: '#/pipeline', desc: 'Eight stages from need to homes people can afford.' },
        { label: 'Tax credit equity markets', lab: '#/equity-pricing', desc: 'What investors pay for credits now.' },
        { label: 'Green building', lab: '#/guide/green-building', desc: 'CHFA green rules, costs and Colorado programs.' },
        { label: 'Design, health and community', lab: '#/design', desc: 'Small homes that work, porches, access rules and what CHFA scores.' },
        { label: 'Resident services', lab: '#/guide/resident-services', desc: 'Services that help residents stay housed.' },
        { label: 'CRA and pricing', lab: '#/guide/cra-pricing', desc: 'How bank rule changes could move credit prices.' }] }
    ] },
    { id: 'policy', title: 'Policy & research', question: 'What is changing, and what does the research say?', summary: 'What is changing in law and the news, and what the research shows.', hub: '#/guides', views: ['guides', 'guide', 'news', 'digest', 'housing-posts', 'legislation', 'calendar', 'elections', 'research', 'tax-credit-history', 'middle-income'], groups: [
      { title: 'Policy and news', about: 'Dated news, deadlines, laws and who holds housing posts.', items: [
        { label: 'Housing news', lab: '#/news', desc: 'Colorado housing news articles, dated and linked.' },
        { label: 'Sunday digest', lab: '#/digest', desc: 'The week in Colorado housing news, every item linked to its source.' },
        { label: 'Deadlines and events', lab: '#/calendar', desc: 'CHFA round dates, law deadlines, hearings, trainings and conferences.' },
        { label: 'Who holds housing posts', lab: '#/housing-posts', desc: 'State housing appointments at DOLA, CHFA, OEDIT and the State Housing Board.' },
        { label: 'Legislation 2026', lab: '#/legislation', desc: 'Federal and Colorado housing laws COHO tracks.' },
        { label: 'AHCIA status', lab: '#/guide/ahcia', desc: 'Where the federal credit expansion stands.' },
        { label: 'Fair housing', lab: '#/guide/fair-housing', desc: 'What the federal rollback did, and what survives.' },
        { label: 'Federal rule changes', lab: '#/guide/federal-rules', desc: 'Federal fixes that would help affordable housing, ranked.' },
        { label: 'Elections', lab: '#/elections', desc: 'How elections and ballot measures shape housing policy.' }] },
      { title: 'Research', about: 'Briefs and papers, each with its sources.', items: [
        { label: 'All research and briefs', lab: '#/guides?at=research-all', desc: 'Every paper, brief and analysis, each with its date.' },
        { label: 'How tax credit deals have changed', lab: '#/tax-credit-history', desc: 'Colorado’s housing tax credit since 1987: deal size, bonds, who it serves.' },
        { draft: true, label: 'Commuters and capture rates', lab: '#/guide/commuters-capture', desc: 'How workers who drive in can widen a rental\u2019s market, and the proof CHFA asks for.' },
        { label: 'Middle-income rental', lab: '#/middle-income', desc: 'The middle-income credit, Prop 123 Equity and town deed restrictions: who each serves.' },
        { label: 'White paper', lab: '#/guide/white-paper', desc: 'Deciding about housing with public data.' },
        { label: 'Working paper', lab: '#/guide/working-paper', desc: 'What building a public housing-data system taught.' },
        { label: 'Starting a housing authority', lab: '#/guide/housing-authority', desc: 'How a Colorado town or county creates one, step by step.' }] }
    ] },
    { id: 'data', title: 'Data and methods', question: 'Where does each number come from, and can I trust it?', summary: 'How every figure is made and where it comes from.', hub: '#/data', views: ['data'], groups: [
      { title: 'How it works', about: 'Methods, nightly checks and plain definitions.', items: [
        { label: 'Methods', lab: '#/guide/methods', desc: 'Every calculation behind the need estimates.' },
        { label: 'Trust center', lab: '#/data/trust', desc: 'Sources, freshness, the nightly checks and today’s dataset check.' },
        { label: 'About', lab: '#/guide/about', desc: 'Sources, methods and how the site is built.' },
        { label: 'Glossary', lab: '#/data/glossary', desc: 'Plain definitions of tax credit and housing terms.' }] },
      { title: 'The data', about: 'Every file and source, with its date, to browse.', items: [
        { label: 'Data explorer', lab: '#/data/explorer', desc: 'Every data file behind the site, with previews.' },
        { label: 'Data map', lab: '#/data/map', desc: 'Every geographic dataset on a map.' },
        { label: 'Data sources', lab: '#/data/sources', desc: 'Every source, its freshness and coverage.' }] }
    ] }
  ];
  // A guide still in draft (site/guides/<slug>.json has no public page yet) shows in the lab menus only. The public
  // site has no page for it, so its menu link opened nothing there (paul's site sweep, 15 Nov 2026).
  if (global.LAB_PORT) MENUS.forEach(function (m) { m.groups.forEach(function (g) { g.items = g.items.filter(function (it) { return !it.draft; }); }); });

  var esc = function (s) { return global.LabShell.esc(s); };
  // In a port into the public site (window.LAB_PORT), a lab route the hub carries stays a route, one it does
  // not carry opens the public page it rebuilds, and a lab page with no public page yet is left out (null).
  var PORT = global.LAB_PORT || null;
  function href(it) { return it.lab ? (PORT ? PORT.href(it.lab) : it.lab) : LIVE + it.path; }
  function isLive(it) { return !PORT && !it.lab; }
  // Every item, in menu order; a drawn link names its item by its place here (data-item).
  var FLAT = [];
  MENUS.forEach(function (m) { m.groups.forEach(function (g) { g.items.forEach(function (it) { FLAT.push(it); }); }); });

  // The menu steps. The working place is the step bar's (site/step-bar.js, which loads after this file), read when
  // a menu opens, so a place picked on any page carries. Without one a step opens as listed: the Needs Assessment on
  // Fruita, the sample.
  function working() { var S = global.LabStep; return S && S.working ? S.working() : null; }
  function stepHref(it, w) {
    var S = global.LabStep;
    if (it.step == null || !w || !S || !S.placed) return href(it);
    if (it.path) return LIVE + S.withPlace(it.path, encodeURIComponent(w.geoid));
    var route = it.step === 2 ? '#/place/' + encodeURIComponent(w.geoid) : S.placed(it.lab, w);
    return (PORT ? PORT.href(route) : route) || href(it);
  }
  function stepNote(it, w) {
    return 'One of the 7 steps' + (it.step === 0 ? '' : w ? ' · opens on ' + w.label : it.step === 2 ? ' · opens on Fruita, the sample' : '');
  }
  // The item for the page you are on: the full Market Analysis by its file, a place's page (any chapter) as the Needs
  // Assessment, an item with a query only at that exact address, and otherwise the longest route the address starts
  // with. Jurisdiction (#/places) is marked on its own page only, not on every Places page under it.
  function hereItem() {
    var hash = location.hash || '#/', at = hash.split('?')[0], file = location.pathname.split('/').pop() || 'index.html';
    var best = null, len = -1;
    FLAT.forEach(function (it) {
      var hit, l;
      if (it.path) { hit = file === it.path; l = 1000; }
      else if (it.lab.indexOf('?') > -1) { hit = hash === it.lab; l = it.lab.length; }
      else if (it.step === 2) { hit = /^#\/place\/\d/.test(at); l = it.lab.length; }
      else if (it.step === 0) { hit = at === it.lab || at === it.lab + '/'; l = it.lab.length; }
      else { hit = at === it.lab || at.indexOf(it.lab + '/') === 0; l = it.lab.length; }
      if (hit && l > len) { best = it; len = l; }
    });
    return best;
  }
  // Sets each step's link and line, and marks the page you are on "You are here". Run when a menu opens and when the
  // page changes; the menus are drawn once.
  function refresh() {
    var nav = document.getElementById('site-nav');
    if (!nav || !nav.querySelectorAll) return;
    var w = working(), here = hereItem();
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-item]'), function (a) {
      var it = FLAT[+a.getAttribute('data-item')];
      if (!it) return;
      if (it.step != null) {
        a.setAttribute('href', stepHref(it, w));
        var note = a.querySelector('.mega-step');
        if (note) note.textContent = stepNote(it, w);
      }
      var tag = a.querySelector('.mega-here');
      if (it === here) {
        a.classList.add('is-here');
        a.setAttribute('aria-current', 'page');
        if (!tag) { tag = document.createElement('span'); tag.className = 'mega-here'; tag.textContent = 'You are here'; a.querySelector('.mega-label').appendChild(tag); }
      } else {
        a.classList.remove('is-here');
        a.removeAttribute('aria-current');
        if (tag) tag.parentNode.removeChild(tag);
      }
    });
  }

  function panel(m) {
    // Money and deals carries four groups (reorg step 2b, 23 Nov): they sit side by side, so the menu still fits a tall screen.
    return '<div class="mega" id="mega-' + m.id + '" hidden><div class="mega-inner' + (m.groups.length > 2 ? ' mega-' + m.groups.length : '') + '">' +
      // Under the question (paul, 25 Nov 2026): one line on what the menu holds, and what each column is for.
      '<div class="mega-intro"><p class="mega-question">' + esc(m.question) + '</p>' +
      (m.summary ? '<p class="mega-summary">' + esc(m.summary) + '</p>' : '') +
      '<dl class="mega-key">' + m.groups.filter(function (g) { return g.about; }).map(function (g) { return '<dt>' + esc(g.title) + '</dt><dd>' + esc(g.about) + '</dd>'; }).join('') + '</dl>' +
      (!PORT || PORT.href(m.hub) === m.hub ? '<a class="mega-hub" href="' + esc(m.hub) + '" data-hub="' + esc(m.views[0]) + '">All of ' + esc(m.title) + ' →</a>' : '') + '</div>' +
      m.groups.map(function (g) {
        var items = g.items.filter(function (it) { return href(it) != null; });
        if (!items.length) return '';
        return '<div class="mega-group"><h2 class="mega-title">' + esc(g.title) + '</h2><ul>' + items.map(function (it) {
          return '<li><a href="' + esc(href(it)) + '" data-item="' + FLAT.indexOf(it) + '"' + (isLive(it) ? ' class="is-live"' : '') + '><span class="mega-label">' + esc(it.label) +
            (isLive(it) ? '<span class="live-tag" aria-label="opens the live site">live site ↗</span>' : '') + '</span>' +
            '<span class="mega-desc">' + esc(it.desc) + '</span>' + (it.step != null ? '<span class="mega-step">' + esc(stepNote(it, null)) + '</span>' : '') + '</a></li>';
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
    if (on) refresh();
    document.getElementById(btn.getAttribute('aria-controls')).hidden = !on;
    if (on) fit();
  }

  // A long menu scrolls inside the screen (paul, 16 Nov 2026): the open menu is as tall as the room from its top to the
  // bottom of the screen, and scrolls past that (templates.css). Fitted again when the window is resized or the page
  // scrolls under it. Below 1180px the menus sit in the Menu list, which scrolls as a whole, so the height is let go.
  function fit() {
    var btn = document.querySelector('.menu-button[aria-expanded="true"]');
    var panel = btn && document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel || panel.hidden) return;
    if (getComputedStyle(panel).position !== 'absolute') { panel.style.maxHeight = ''; return; }
    var top = Math.max(0, panel.getBoundingClientRect().top);
    panel.style.maxHeight = Math.max(160, window.innerHeight - top) + 'px';
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
    refresh();
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
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { passive: true });
    mark();
  }

  // Old pages whose content now lives in a view, and which forward there on the public site (js/path-resolver.js):
  // the written guides since 13 Nov 2026, redirect group A and county costs since 14 Nov, and groups B and C since
  // 15 Nov (paul: "finish everything else", after the content gaps behind them went live). A link to one is pointed at the
  // view, so the reader takes one step, not two, and a view never sends a reader to a page that sends them back.
  // A link with ?classic=1 (the page as written) is left alone.
  var MOVED = {
    'colorado-elections.html': '#/elections', 'commuting.html': '#/opportunity/commuting', 'compare.html': '#/places/compare',
    'construction-commodities.html': '#/places/costs', 'article-pricing.html': '#/equity-pricing', 'land-value.html': '#/opportunity/land-value',
    'deal-summary.html': '#/deals', 'preservation.html': '#/opportunity/preservation', 'hna-scenario-builder.html': '#/places/scenario',
    'recommendation.html': '#/recommendation', 'select-jurisdiction.html': '#/places', 'local-incentives.html': '#/places/incentives',
    'policy-briefs.html': '#/news', 'data-status.html': '#/data/status', 'data-map-browser.html': '#/data/map',
    'article-co-housing-costs.html': '#/places/county-costs',
    'lihtc-guide-for-stakeholders.html': '#/guide/lihtc-basics', 'affordable-deal-team.html': '#/guide/deal-team',
    'green-building-guide.html': '#/guide/green-building', 'resident-services.html': '#/guide/resident-services',
    'cra-expansion-analysis.html': '#/guide/cra-pricing', 'lihtc-enhancement-ahcia.html': '#/guide/ahcia',
    'article-fair-housing-rollback.html': '#/guide/fair-housing', 'article-federal-rule-changes.html': '#/guide/federal-rules',
    'housing-authority-guide.html': '#/guide/housing-authority', 'apa-white-paper.html': '#/guide/white-paper',
    'working-paper.html': '#/guide/working-paper', 'methods.html': '#/guide/methods', 'about.html': '#/guide/about',
    'housing-help.html': '#/guide/renter-help', 'help-for-homebuyers.html': '#/guide/homebuyer-help',
    // Group B.
    'census-dashboard.html': '#/places/multifamily', 'chfa-portfolio.html': '#/opportunity/portfolio', 'colorado-deep-dive.html': '#/places/deep-dive',
    'economic-dashboard.html': '#/places/economy', 'hna-comparative-analysis.html': '#/places/ranking', 'insights.html': '#/research',
    'housing-legislation-2026.html': '#/legislation', 'land-banking-awards.html': '#/opportunity/land-banking', 'pipeline.html': '#/pipeline',
    'data-explorer.html': '#/data/explorer', 'dashboard-data-quality.html': '#/data/quality', 'dashboard-data-sources-ui.html': '#/data/sources',
    'data-review-hub.html': '#/data/trust',
    // Group C: the needs assessment and its five chapters open the place's page on the same chapter.
    'housing-needs-assessment.html': '#/places', 'hna-who-lives-here.html': '#/places', 'hna-what-housing-exists.html': '#/places',
    'hna-what-households-can-afford.html': '#/places', 'hna-where-its-heading.html': '#/places', 'hna-what-to-do.html': '#/places',
    'ic-summary.html': '#/ic-summary', 'where-housing-money-goes.html': '#/money',
    // Duplicates batch 3 (16 Nov 2026): the weekly digest and its earlier editions are the Sunday digest view.
    'sunday-digest.html': '#/digest'
  };
  // The place page's chapter for each needs assessment page (site/hna.js TABS).
  var HNA_TAB = { 'housing-needs-assessment.html': '', 'hna-who-lives-here.html': '/people', 'hna-what-housing-exists.html': '/housing',
    'hna-what-households-can-afford.html': '/afford', 'hna-where-its-heading.html': '/future', 'hna-what-to-do.html': '/action' };
  // The deep dive's tabs, which the old page named in its hash (#tab-funding) and the view takes as ?tab=.
  var DD_TABS = ['deepdive', 'ami-gap', 'market-trends', 'snapshot', 'affordability-geo', 'signals', 'construction', 'history', 'funding', 'market', 'need', 'direction', 'patterns', 'timeline'];
  // Three old tab names the view calls something else (Codex P2 on HA #2877): the old "Colorado Snapshot" and "Market
  // Conditions" tabs (with its policy simulator) are the view's snapshot tab, and "Market patterns" is its patterns tab.
  var DD_OLD = { 'state-comparison': 'snapshot', 'policy-simulator': 'snapshot', 'types': 'patterns' };
  var CO_GEO = /^08\d{3}(\d{2})?$/;
  var GEO = /^\d{5}(\d{2})?$/;
  function movedHref(href) {
    var m = /^(?:https:\/\/(?:www\.)?cohoanalytics\.com\/|\.\/)?([a-z0-9-]+\.html)(\?[^#]*)?(?:#(.*))?$/i.exec(String(href || ''));
    if (!m || !Object.prototype.hasOwnProperty.call(MOVED, m[1].toLowerCase())) return null;
    var file = m[1].toLowerCase(), q = new URLSearchParams((m[2] || '').slice(1)), to = MOVED[file];
    if (q.has('classic')) return null;
    if (file === 'select-jurisdiction.html' && (q.has('next') || q.has('step') || q.has('new'))) return null;
    var g = function (list) { return list.filter(function (x, i, a) { return x && GEO.test(x) && a.indexOf(x) === i; }); };
    if (file === 'deal-summary.html' && /^[a-z0-9-]{1,120}$/.test(q.get('d') || '')) return to + '/' + q.get('d');
    // A county's write-ups (?county=<name>, from the Housing Needs Assessment) open filtered (Codex P2 on HA #2875).
    if (file === 'deal-summary.html' && /^[A-Za-z .'-]{2,40}$/.test(q.get('county') || '')) return to + '?county=' + encodeURIComponent(q.get('county'));
    if (file === 'compare.html') {
      var picked = g(String(q.get('jurisdictions') || '').split(',')).slice(0, 6), t = /^[a-z0-9_-]{1,20}$/.test(q.get('target') || '') ? q.get('target') : '';
      var qs = [picked.length ? 'g=' + picked.join(',') : '', t ? 't=' + t : ''].filter(Boolean).join('&');
      return to + (qs ? '?' + qs : '');
    }
    // An edition of the digest (?date=YYYY-MM-DD, as the Sunday email links it) opens that edition.
    if (file === 'sunday-digest.html' && /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '')) return to + '?date=' + q.get('date');
    if (file === 'hna-scenario-builder.html' || file === 'recommendation.html') { var one = g([q.get('geoid'), q.get('fips')]); return to + (one.length ? '?g=' + one[0] : ''); }
    // Local incentives keeps its picked town or county in the hash (#j=<geoid>, js/local-incentives.js geoidFromHash).
    if (file === 'local-incentives.html') { var j = /(?:^|[&?])j=(\d{7}|\d{5})(?!\d)/.exec(m[3] || ''); if (j) return to + '/' + j[1]; }
    if (/^\/guide\//.test(to.slice(1)) && /^[A-Za-z0-9_-]{1,80}$/.test(m[3] || '')) return to + '?at=' + m[3];
    // Group C. A needs assessment page opens the place's page on its chapter. A region or a combined set of places
    // (?region=, ?geos=, ?combinedMode=) stays on the page as written, which is the only place that draws them.
    if (Object.prototype.hasOwnProperty.call(HNA_TAB, file)) {
      // Colorado as a whole has no place page in the hubs, so the statewide assessment (?geoid=08) stays as written too.
      if (q.has('region') || q.has('geos') || q.has('combinedMode') || q.get('geoid') === '08' || q.get('fips') === '08') return null;
      var hg = [q.get('geoid'), q.get('fips')].filter(function (x) { return x && CO_GEO.test(x); })[0];
      // "Ownership Need" opens the assessment at its ownership section, which is on the place's What to do chapter.
      return hg ? '#/place/' + hg + (/^#?affordable-ownership-need-section$/.test(m[3] || '') ? '/action' : HNA_TAB[file]) : to;
    }
    // The investor summary carries its place; one opened from a deal (?dc= or #dc=) stays as written.
    if (file === 'ic-summary.html') {
      if (q.has('dc') || /(?:^|[&?])dc=/.test(m[3] || '')) return null;
      var ig = g([q.get('geoid'), q.get('fips')])[0];
      return to + (ig ? '?g=' + ig : '');
    }
    if (file === 'data-explorer.html' && /^[A-Za-z0-9_./-]{1,200}$/.test(q.get('file') || '') && !/\.\./.test(q.get('file'))) return to + '?file=' + encodeURIComponent(q.get('file'));
    if (file === 'colorado-deep-dive.html') {
      var t2 = /^tab-([a-z-]{1,30})$/.exec(m[3] || ''), tn = t2 && (Object.prototype.hasOwnProperty.call(DD_OLD, t2[1]) ? DD_OLD[t2[1]] : t2[1]);
      if (tn && DD_TABS.indexOf(tn) >= 0) return to + '?tab=' + tn;
    }
    return to;
  }
  // A page that stays at its own address, but whose links open the newer copy of the same tool, with the same query
  // and hash, as js/path-resolver.js LINK_TO does on the public site's own pages (duplicates batch 3). The old Market
  // Analysis stays because the member site's Market screen engine loads it by name; ?classic=1 opens it as written.
  // The views needed it too: the Methods guide's link opened the old page (found in the 2897 live check, 16 Nov 2026).
  var LINK_TO = { 'market-analysis.html': 'deal-market-analysis.html' };
  function linkTo(href) {
    var m = /^((?:https:\/\/(?:www\.)?cohoanalytics\.com\/|\.\/)?)([a-z0-9-]+\.html)((?:\?[^#]*)?(?:#.*)?)$/i.exec(String(href || ''));
    if (!m || !Object.prototype.hasOwnProperty.call(LINK_TO, m[2].toLowerCase())) return null;
    if (/^\?(?:[^#]*&)?classic(?:[=&#]|$)/.test(m[3])) return null;
    return m[1] + LINK_TO[m[2].toLowerCase()] + m[3];
  }
  // Points every moved-page link inside a drawn view at its view (the shell calls this after each draw).
  function retarget(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('a[href]'), function (a) {
      var to = movedHref(a.getAttribute('href'));
      if (to) { a.setAttribute('href', to); a.removeAttribute('target'); return; }
      var copy = linkTo(a.getAttribute('href'));
      if (copy) a.setAttribute('href', copy);
    });
  }

  global.LabNav = { MENUS: MENUS, menuFor: menuFor, href: href, stepHref: stepHref, hereItem: hereItem, refresh: refresh, LIVE: LIVE, MOVED: MOVED, movedHref: movedHref, linkTo: linkTo, retarget: retarget };
})(window);
