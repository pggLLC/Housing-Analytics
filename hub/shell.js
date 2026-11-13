// Lab shell: Home, the hubs, All tools and Members, with hash routes so browser Back works.
// Every public-site page comes from route-catalog.json (built by scripts/build-route-catalog.js).
(function (global) {
  'use strict';

  var STATUS = {
    current: 'Current tool',
    members: 'Members only',
    lab: 'Lab screen',
    unfinished: 'Not built yet',
    alias: 'Old address',
    'not-public': 'Not a visitor page'
  };

  // Lab-only destinations. Step numbers refer to docs/first-slice.md and the readiness review.
  var LAB = {
    projects: [
      { label: 'Prototype: guided project analysis', href: '../index.html', status: 'lab', note: 'The recovered Version 8 prototype, with sample data. Used as an interaction reference only.' },
      { label: 'Homes and affordability schedule', href: null, status: 'unfinished', note: 'Step 4. Includes the handoff review and manual mix conversion.' },
      { label: 'Financials on the real Deal Engine', href: '#/projects', status: 'lab', note: 'Open a project, set the homes and rents, then run the Deal Calculator on it.' }
    ],
    // Member pages that live only on the member site (coho-backend gated/), so they are not in
    // route-catalog.json, which lists the public repo's pages. Linked, never copied.
    members: [
      { label: 'Entitled land for sale', href: 'https://coho-backend.communityplanner.workers.dev/developer-entitled-land.html', status: 'members', note: 'Western Slope land on the market that is approved, or zoned, for a 30 to 50 home townhome tax credit deal, with each approval\u2019s source and what to confirm with the town.' },
      { label: 'Market screen', href: 'https://coho-backend.communityplanner.workers.dev/developer-market-screen.html', status: 'members', note: 'How a town or site\u2019s rental market scores for a tax credit project, the share of qualifying renters a project needs, and the affordable housing already there.' },
      { label: 'CHFA market study draft', href: 'https://coho-backend.communityplanner.workers.dev/developer-chfa-market-study.html', status: 'members', note: 'A tax credit project and a market area of whole census tracts laid against CHFA\u2019s Market Study Guide: the nine sections, every table public data can fill, six maps and a Word draft for an approved analyst to finish. Not a CHFA market study.' },
      { label: 'Where to look', href: 'https://coho-backend.communityplanner.workers.dev/developer-finder.html', status: 'members', note: 'Every Colorado town ranked for the kind of tax credit deal you are chasing: need, years since the last award, basis boost, renter scale and local readiness.' },
      { label: 'Site environmental screen', href: 'https://coho-backend.communityplanner.workers.dev/developer-env-screen.html', status: 'members', note: 'A step 1 records screen for one site: flood zone, wetlands, nearby cleanup, tank and well records, and what a Phase I should cover. Not a Phase I.' },
      { label: 'Parcel sales', href: 'https://coho-backend.communityplanner.workers.dev/developer-parcel-sales.html', status: 'members', note: 'What land and homes last sold for, parcel by parcel, from state and county records, with room to add your own sales.' },
      { label: 'Commuters', href: 'https://coho-backend.communityplanner.workers.dev/developer-commuters.html', status: 'members', note: 'Who drives in, out and through each Colorado town or county, from LODES 2024 and the ACS, with what a market study can count.' },
      { label: 'Investor returns', href: 'https://coho-backend.communityplanner.workers.dev/developer-investor-returns.html', status: 'members', note: 'Credits, depreciation, capital accounts, exit taxes and after-tax yield from the investor\u2019s side of a deal.' },
      { label: 'Next places', href: 'https://coho-backend.communityplanner.workers.dev/developer-next-places.html', status: 'members', note: 'Where CHFA tax credit awards have tended to land over ten years, read beside a need-only baseline. A look back, not a forecast or an approval chance.' },
      { label: 'Where money goes furthest', href: 'https://coho-backend.communityplanner.workers.dev/developer-frontier.html', status: 'members', note: 'Where a 9% deal meets the most need for the least credit requested, with signs of local gap money. An illustration, not an award schedule.' },
      { label: 'Preservation first', href: 'https://coho-backend.communityplanner.workers.dev/developer-preservation-first.html', status: 'members', note: 'Affordable rentals whose HUD contract, USDA restriction or tax credit use period ends soon, with the most homes at risk first.' },
      { label: 'Prop 123 strategy', href: 'https://coho-backend.communityplanner.workers.dev/developer-prop123.html', status: 'members', note: 'How a nonprofit holding land, a developer and the housing authority work together with Prop 123 money: each step, who carries which risk, property tax, and who in each place already holds land-banked land.' },
      { label: 'Where a deal pencils', href: 'https://coho-backend.communityplanner.workers.dev/developer-deal-pencil.html', status: 'members', note: 'A standard 9% and 4% family deal run through the Deal Calculator\u2019s engine in every Colorado town, with the most a deal can cost per home and still close.' },
      { label: 'My partners', href: 'https://coho-backend.communityplanner.workers.dev/developer-my-partners.html', status: 'members', note: 'The firms you work with, shown in the Local players section of every dossier. Only you see them.' },
      // Decided member tools that are still public pages today (paul, 26 Oct and 30 Oct). They move behind the
      // gate when their hub lands; until then the link opens the public page.
      { label: 'Market Analysis (full, site market area)', href: 'https://cohoanalytics.com/market-analysis.html', status: 'members', note: 'Decided as a member tool. Still a public page until it moves behind the member gate. The free Market check is on this site.' },
      { label: 'For-sale market study (full)', href: 'https://cohoanalytics.com/for-sale-market-study.html', status: 'members', note: 'Decided as a member tool (30 Oct). Still a public page until it moves behind the member gate. The free For-sale and ownership screen is on this site.' }
    ]
  };

  var HUBS = {
    places: { title: 'Places and need', lede: 'Look up a Colorado town or county, see its housing need, and compare it with others.' },
    opportunities: { title: 'Opportunities', lede: 'Find locations, existing affordable housing at risk, public land and awards.' },
    projects: { title: 'Build a deal', lede: 'Test a site, set the homes and rents, and run the numbers. You can explore without starting a project.' },
    guides: { title: 'Policy and research', lede: 'Plain guides to how affordable housing gets built and paid for in Colorado, plus policy and news.' },
    data: { title: 'Data and methods', lede: 'Where each number comes from, how fresh it is, and how the calculations work.' },
    assistance: { title: 'Housing help', lede: 'Help for people looking for a home to buy or rent. No project or account needed.' },
    members: { title: 'Member tools', lede: 'Market screen, site and environmental checks, land sales, deal workbook, investor returns, pipeline and round watch for the developer team.' },
    tools: { title: 'All tools', lede: 'Every page on the site in one list. Search by name.' }
  };

  var catalog = null;
  var main = document.getElementById('main');
  var announce = document.getElementById('announce');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parseHash() {
    var raw = (location.hash || '#/').slice(1);
    var q = raw.indexOf('?');
    var parts = (q > -1 ? raw.slice(0, q) : raw).split('/').filter(Boolean);
    var params = new URLSearchParams(q > -1 ? raw.slice(q + 1) : '');
    return { view: parts[0] || 'home', parts: parts, params: params };
  }

  // The live site's own error page (404.html) is listed so every page is accounted for, but it is
  // not somewhere a reader means to go back to, so it never enters the recent list.
  var NOT_RECENT = /\/404\.html$/;
  function remember(entry) {
    if (NOT_RECENT.test(entry.href || '')) return;
    try {
      var list = JSON.parse(localStorage.getItem('coho-lab-recent') || '[]').filter(function (x) { return x.href !== entry.href; });
      list.unshift({ label: entry.label, href: entry.href });
      localStorage.setItem('coho-lab-recent', JSON.stringify(list.slice(0, 5)));
    } catch (_) { /* recent list is a convenience only */ }
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem('coho-lab-recent') || '[]').filter(function (x) { return !NOT_RECENT.test(x.href || ''); }); } catch (_) { return []; }
  }

  function item(e) {
    var link = e.href
      ? '<a href="' + esc(e.href) + '" data-route-path="' + esc(e.path || '') + '">' + esc(e.path === '404.html' ? 'The site\u2019s \u201cPage not found\u201d screen' : e.label) + '</a>'
      : '<span class="unlinked">' + esc(e.label) + '</span>';
    var note = e.status === 'alias' ? 'Forwards to ' + e.target + '.' : e.note;
    var use = e.role === 'generated-place'
      ? '<a class="use-link" href="#/use?' + esc(String(new URLSearchParams({ kind: 'place-reference', geoid: e.geoid, label: e.label, href: e.href, from: location.hash || '#/' }))) + '">Use in project</a>'
      : '';
    return '<li>' + link + '<span class="status status-' + esc(e.status) + '">' + esc(STATUS[e.status]) + '</span>' +
      (note ? '<p class="note"' + (e.noteTerms ? ' data-no-source="' + esc(e.noteTerms) + '"' : '') + '>' + esc(note) +
        // A description that states a figure names the figure's dated source (scripts/build-route-catalog.js).
        (e.noteSource ? ' Source: <a href="' + esc(e.noteSource.href) + '">' + esc(e.noteSource.label) + '</a>.' : '') + '</p>' : '') + use + '</li>';
  }

  function list(entries) {
    return '<ul class="route-list">' + entries.map(item).join('') + '</ul>';
  }

  // The full list in groups: one card per group with its count, each opening its folded list.
  var GROUPS = [['places', 'Places and need'], ['opportunities', 'Opportunities'], ['guides', 'Policy and research'], ['data', 'Data and methods'],
    ['members', 'Member tools'], ['projects', 'Projects'], ['assistance', 'Housing help'], ['home', 'Home'], ['utilities', 'Site pages'], ['aliases', 'Old addresses']];
  function groups(entries) {
    var named = GROUPS.map(function (g) { return g[0]; });
    var sets = GROUPS.map(function (g) { return [g, entries.filter(function (e) { return e.hub === g[0]; })]; })
      .concat([[['other', 'Other'], entries.filter(function (e) { return named.indexOf(e.hub) < 0; })]])
      .filter(function (x) { return x[1].length; });
    var here = location.hash.split('?')[0];
    return '<ul class="tool-groups">' + sets.map(function (x) {
      return '<li><a href="' + esc(here) + '" data-jump="tools-' + esc(x[0][0]) + '"><span class="tg-n">' + x[1].length + '</span><span class="tg-t">' + esc(x[0][1]) + '</span></a></li>';
    }).join('') + '</ul>' + sets.map(function (x) {
      return '<details class="tool-group" id="tools-' + esc(x[0][0]) + '"><summary>' + esc(x[0][1]) + ' <span class="note">(' + x[1].length + ')</span></summary>' + list(x[1]) + '</details>';
    }).join('');
  }

  function inHub(hub, filter) {
    return catalog.entries.filter(function (e) { return e.hub === hub && (!filter || filter(e)); });
  }

  function matches(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return function (e) {
      var hay = (e.label + ' ' + e.path + ' ' + (e.geoid || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) > -1; });
    };
  }

  function searchBox(id, label, value, placeholder) {
    return '<form class="search" role="search" data-search="' + id + '">' +
      '<label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" name="q" type="search" autocomplete="off" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '">' +
      '</form>';
  }

  function capped(entries, max) {
    var shown = entries.slice(0, max);
    return '<p class="count" role="status">' + (entries.length === 0 ? 'No matches.' : entries.length > max
      ? 'Showing ' + max + ' of ' + entries.length + '. Type more to narrow the list.' : entries.length + (entries.length === 1 ? ' match.' : ' matches.')) + '</p>' + list(shown);
  }

  var VIEWS = {
    home: function () {
      var r = recent();
      return '<h1>Colorado housing, from need to a project</h1>' +
        '<p class="lede">Start with a place, an opportunity or a project. Every tool on the site is still here.</p>' +
        searchBox('home-place', 'Find a town or county', '', 'For example Fruita or Mesa County') +
        '<ul class="choices">' +
        choice('#/places', 'Places and need', 'Housing need, incomes and rents for any Colorado place.') +
        choice('#/opportunities', 'Find an opportunity', 'Locations, preservation risks, public land and awards.') +
        choice('#/projects', 'Scope a project', 'Market, homes and rents, then the financials.') +
        choice('#/assistance', 'Get housing help', 'For people looking to buy or rent a home.') +
        choice('#/guides', 'Guides and research', 'How deals work in Colorado, policy and news.') +
        choice('#/data', 'Data and methods', 'Sources, freshness and how the calculations work.') +
        '</ul>' +
        (r.length ? '<h2>Recent in this browser</h2>' + '<ul class="route-list">' + r.map(function (x) { return '<li><a href="' + esc(x.href) + '">' + esc(x.label) + '</a></li>'; }).join('') + '</ul>' : '') +
        '<p><a href="#/tools">See all ' + catalog.total + ' pages</a></p>';
    },
    places: function (p) {
      var q = p.get('q') || '';
      var tools = inHub('places', function (e) { return e.role !== 'generated-place' && e.role !== 'directory'; });
      var profiles = inHub('places', function (e) { return e.role === 'generated-place'; });
      return hubHead('places') +
        searchBox('place-q', 'Find a town or county profile', q, 'Name or GEOID') +
        (q ? capped(profiles.filter(matches(q)), 25) : '<p class="count">' + profiles.length + ' place profiles. Type a name to find one.</p>') +
        '<h2>Tools for any place</h2>' + list(tools) +
        '<h2>Directory</h2>' + list(inHub('places', function (e) { return e.role === 'directory'; }));
    },
    opportunities: function () { return hubHead('opportunities') + list(inHub('opportunities')); },
    projects: function () {
      var mine = LabProjects.list();
      var legacy = LabProjects.legacyPreview();
      return hubHead('projects') +
        '<div class="callout">Exploring never starts a project. Results go into a project only when you choose \u201cUse in project\u201d.</div>' +
        '<h2>Your projects</h2>' + (LabProjects.persistent() ? '<p class="note">Saved in this browser only. Nothing is sent anywhere.</p>' : NOT_STORED) +
        (mine.length ? '<ul class="route-list">' + mine.map(function (p) {
          return '<li><a href="#/project/' + esc(p.projectId) + '">' + esc(p.name) + '</a><span class="status">' + esc(KIND[p.kind]) + '</span>' +
            '<p class="note">' + esc(p.jurisdiction ? p.jurisdiction.name : 'No place set') + ' \u00b7 ' + (LabProjects.isTemporary(p.projectId) ? 'not saved, this visit only' : 'saved ' + esc(when(p.savedAt))) + '</p></li>';
        }).join('') + '</ul>' : '<p>No projects yet.</p>') +
        newProjectForm('', '') +
        '<p class="note"><a href="#/open-deal">Open a shared deal</a> from a share link or deal file.</p>' +
        (legacy.subject || legacy.projects.length ? '<div class="callout">This browser also has records from Market Analysis or the older workflow pages. They are not used here unless you import them from a project page.</div>' : '') +
        '<h2>Current project tools</h2>' + list(inHub('projects'));
    },
    guides: function () {
      return hubHead('guides') +
        list(inHub('guides', function (e) { return e.role !== 'embedded-map'; })) +
        '<h2>Maps from the Colorado housing costs article</h2>' + list(inHub('guides', function (e) { return e.role === 'embedded-map'; }));
    },
    data: function () { return hubHead('data') + list(inHub('data')); },
    assistance: function () { return hubHead('assistance') + list(inHub('assistance')); },
    members: function () {
      return hubHead('members') +
        '<div class="callout">These tools stay on the member site, behind the same sign-in and gate as today. This site links to them and does not copy them or their data. <a href="#/request-access">Request a quote</a> for access.</div>' +
        list(LAB.members.concat(inHub('members')));
    },
    project: function (p, parts) { return projectView(LabProjects.get(parts[1]), p.get('delete') === 'ask'); },
    use: function (p) { return useView(p); },
    tools: function (p) {
      var q = p.get('q') || '';
      var all = catalog.entries.filter(function (e) { return e.hub !== 'internal'; });
      var nonPlace = all.filter(function (e) { return e.role !== 'generated-place'; });
      return hubHead('tools') + searchBox('tools-q', 'Search all pages', q, 'Tool, guide or place name') +
        (q ? capped(all.filter(matches(q)), 50) : '<p class="count">' + nonPlace.length + ' tools and guides, plus ' + (all.length - nonPlace.length) + ' place profiles (search to find one).</p>' + groups(nonPlace)) +
        '<h2>Other files</h2>' + list(catalog.entries.filter(function (e) { return e.hub === 'internal'; }));
    }
  };

  var KIND = { development: 'Development site', strategy: 'Place strategy' };
  var EVIDENCE = [
    { kind: 'place-reference', title: 'Need and market: place', step: null },
    { kind: 'market-snapshot', title: 'Need and market: market area', step: 4 },
    { kind: 'site-reference', title: 'Site', step: null },
    { kind: 'rent-schedule', title: 'Homes and affordability', step: null },
    { kind: 'financials', title: 'Financials', step: null }
  ];
  var STATE = { 'not attached': 'Not added', attached: 'Added, not reviewed', reviewed: 'Reviewed', stale: 'Out of date' };

  function when(iso) { return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never'; }

  function newProjectForm(name, place, extra) {
    return '<form class="stack" data-action="create">' + (extra || '') +
      '<h2>Start a project</h2>' +
      '<label for="np-name">Project name</label><input id="np-name" name="name" required value="' + esc(name) + '">' +
      '<fieldset><legend>What kind of project?</legend>' +
      '<label><input type="radio" name="kind" value="development" checked> A development site: one site, its homes and its numbers</label>' +
      '<label><input type="radio" name="kind" value="strategy"> A place strategy: a town or county plan that can list several sites</label></fieldset>' +
      '<p class="note">' + (place ? 'Place: ' + esc(place) : 'You can add a place later.') + '</p>' +
      '<button type="submit">Start project</button></form>';
  }

  // Shown wherever a project would otherwise read as saved while the browser is refusing to store it.
  var NOT_STORED = '<div class="callout" role="alert"><p><strong>Not saved.</strong> This browser is not storing data for this site (private browsing, blocked site data or full storage), ' +
    'so projects last only until this tab is closed or reloaded. To keep one, open its Financials and use \u201cDownload deal file\u201d, or allow site data and start again.</p></div>';

  function projectView(p, askDelete) {
    if (!p) return '<a class="back-link" href="#/projects">\u2190 Projects</a><h1>Project not found</h1><p class="lede">It is not saved in this browser.</p>';
    var rows = p.scenarios.map(function (s) {
      return '<h3>' + esc(s.name) + '</h3><ul class="route-list">' + EVIDENCE.map(function (ev) {
        var st = LabProjects.stateOf(p.projectId, s.scenarioId, ev.kind);
        var att = p.attachments.filter(function (a) { return a.scenarioId === s.scenarioId && a.kind === ev.kind && a.state !== 'replaced'; })[0];
        var detail = att ? esc(att.label) + '. ' + (att.staleReason ? esc(att.staleReason) + '. ' : '') + 'Added ' + esc(when(att.attachedAt)) + '.'
          : ev.step && ev.kind !== 'rent-schedule' ? 'Not built yet (step ' + ev.step + ').' : 'Nothing added yet.';
        var back = att && att.origin && att.origin.route ? ' <a href="' + esc(att.origin.route) + '">Open where it came from</a>' : '';
        if (ev.kind === 'rent-schedule') back += ' <a href="#/homes/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">' + (att ? 'Open the schedule' : 'Set homes and rents') + '</a>';
        return '<li><span class="unlinked">' + esc(ev.title) + '</span><span class="status state-' + esc(st.replace(' ', '-')) + '">' + esc(STATE[st]) + '</span>' +
          '<p class="note">' + detail + back + '</p></li>';
      }).join('') + '</ul>';
    }).join('');
    return '<a class="back-link" href="#/projects">\u2190 Projects</a><h1>' + esc(p.name) + '</h1>' +
      '<p class="lede">' + esc(KIND[p.kind]) + ' \u00b7 ' + esc(p.jurisdiction ? p.jurisdiction.name : 'No place set') + '</p>' +
      (LabProjects.isTemporary(p.projectId) ? NOT_STORED : '') +
      '<p class="note">' + (LabProjects.isTemporary(p.projectId) ? 'Last changed ' : 'Saved in this browser ') + esc(when(p.savedAt)) + '. \u201cAdded\u201d means the evidence is stored with the project; \u201cReviewed\u201d means someone checked it.</p>' +
      rows + '<h2>Brief</h2><p>Not built yet. It will list assumptions, open questions and sources, and will not give a verdict the evidence does not support.</p>' +
      // The confirmation is part of the page: a browser dialog is not shown in every place the lab runs.
      (askDelete
        ? '<form data-action="delete" data-project="' + esc(p.projectId) + '" class="callout" role="alert"><p><strong>Delete ' + esc(p.name) + ' from this browser?</strong> Its scenarios and saved evidence go too. This cannot be undone.</p>' +
          '<div class="actions"><button type="submit" name="confirm" value="yes">Delete the project</button><a class="button-link secondary" href="#/project/' + esc(p.projectId) + '">Keep it</a></div></form>'
        : '<form data-action="delete" data-project="' + esc(p.projectId) + '"><button type="submit" class="quiet">Delete this project from this browser</button></form>');
  }

  // "Fruita project", then "Fruita project 2", so a second project never looks like the first.
  function freshName(base, mine) {
    var taken = mine.map(function (p) { return p.name; });
    if (taken.indexOf(base) < 0) return base;
    for (var n = 2; ; n++) if (taken.indexOf(base + ' ' + n) < 0) return base + ' ' + n;
  }

  function useView(params) {
    var label = params.get('label') || '';
    var from = params.get('from') || '#/';
    var mine = LabProjects.list();
    var done = params.get('done');
    if (done) {
      return '<h1>Added to ' + esc(done) + '</h1><p class="lede">' + esc(label) + ' is now part of that project.</p>' +
        '<p><a class="button-link" href="' + esc(from) + '">Back to where you were</a></p>' +
        '<p><a href="#/project/' + esc(params.get('project')) + '">Open the project</a></p>';
    }
    return '<a class="back-link" href="' + esc(from) + '">\u2190 Back without adding</a>' +
      '<h1>Use in a project</h1><p class="lede">Add <strong>' + esc(label) + '</strong> to a project. Nothing is added until you confirm.</p>' +
      '<p class="note">What is stored: a link to the place profile and its ID. Figures are not copied, so they stay as the place profile shows them.</p>' +
      (mine.length ? '<form class="stack" data-action="attach"><fieldset><legend>Choose a project</legend>' + mine.map(function (p) {
        var full = LabProjects.get(p.projectId);
        var conflict = p.jurisdiction && p.jurisdiction.geoid !== params.get('geoid')
          ? ' <span class="note">This project is in ' + esc(p.jurisdiction.name) + '; its place will not change.</span>' : '';
        return full.scenarios.map(function (s) {
          // Two projects can share a name, so each choice also shows its place and when it was saved.
          return '<label><input type="radio" name="target" required value="' + esc(p.projectId + '|' + s.scenarioId) + '"> ' + esc(p.name) + ' (' + esc(s.name) + ')' +
            ' <span class="note">' + esc(p.jurisdiction ? p.jurisdiction.name : 'No place set') + ' \u00b7 saved ' + esc(when(p.savedAt)) + '</span>' + conflict + '</label>';
        }).join('');
      }).join('') + '</fieldset><button type="submit">Add to this project</button></form><p>Or start a new one:</p>' : '') +
      newProjectForm(freshName(label + ' project', mine), label, '<input type="hidden" name="attachAfter" value="1">');
  }

  function choice(href, title, text) {
    return '<li class="choice"><a href="' + href + '"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></a></li>';
  }

  // Which of the five menus each hub sits under, for its breadcrumbs.
  var HUB_MENU = { places: 'places', opportunities: 'opportunities', projects: 'deal', guides: 'policy', data: 'data' };
  function hubHead(key) {
    var T = global.LabTpl;
    if (!T) return '<a class="back-link" href="#/">← Home</a><h1>' + esc(HUBS[key].title) + '</h1><p class="lede">' + esc(HUBS[key].lede) + '</p>';
    var crumbs = HUB_MENU[key] ? T.trail(HUB_MENU[key]).slice(0, 1).concat([{ label: HUBS[key].title }]) : [{ label: 'Home', href: '#/' }, { label: HUBS[key].title }];
    return T.head({ kind: 'hub', crumbs: crumbs, title: HUBS[key].title, answer: esc(HUBS[key].lede) });
  }

  // The control that has focus, described so it can be found again after the page is redrawn.
  var lastTab = null;
  document.addEventListener('keydown', function (ev) { lastTab = ev.key === 'Tab' ? { at: Date.now(), back: ev.shiftKey } : null; }, true);
  var lastIn = null;
  document.addEventListener('focusin', function (ev) { lastIn = ev.target; }, true);
  function heldFocus() {
    var el = document.activeElement, tab = lastTab && Date.now() - lastTab.at < 250 ? lastTab : null;
    // While Tab is moving focus the browser reports no focused control, so use the one being left.
    if ((!el || el === document.body) && tab && lastIn && main.contains(lastIn)) el = lastIn;
    else tab = null;
    if (!el || el === main || !main.contains(el)) return null;
    var sel = el.id ? '#' + (global.CSS && CSS.escape ? CSS.escape(el.id) : el.id)
      : el.name ? el.tagName.toLowerCase() + '[name="' + String(el.name).replace(/["\\]/g, '\\$&') + '"]' +
        (el.type === 'radio' ? '[value="' + String(el.value).replace(/["\\]/g, '\\$&') + '"]' : '') : null;
    return sel ? { sel: sel, tab: tab } : null;
  }
  function refocus(held) {
    global.setTimeout(function () {
      var now = document.activeElement;
      if (now && now !== document.body && now !== main && document.contains(now)) return;
      var el; try { el = main.querySelector(held.sel); } catch (e) { el = null; }
      if (!el) return;
      if (held.tab) {
        var all = Array.prototype.filter.call(main.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'),
          function (n) { return n === el || (!n.disabled && n.type !== 'hidden' && !n.closest('details:not([open]) > :not(summary)') && n.getClientRects().length); });
        var next = all[all.indexOf(el) + (held.tab.back ? -1 : 1)];
        if (next) el = next;
      }
      el.focus({ preventScroll: true });
    }, 0);
  }

  function render() {
    var route = parseHash();
    // In a port into the public site (window.LAB_PORT), a route that hub does not carry opens the public
    // page it rebuilds instead; replace() keeps Back on the page the reader came from.
    var away = global.LAB_PORT && global.LAB_PORT.leave(location.hash || '#/');
    if (away) { location.replace(away); return; }
    // The view is looked up by the route table's own names, never by the address text itself.
    var key = Object.keys(VIEWS).filter(function (k) { return k === route.view; })[0];
    var view = key && typeof VIEWS[key] === 'function' ? VIEWS[key] : null;
    // Which place the charts on this page describe; a place page sets it, every other page leaves it empty,
    // so a chart's CSV never carries the last place visited.
    global.LAB_VIZ_CONTEXT = null;
    var held = heldFocus();
    main.innerHTML = typeof view === 'function' ? view(route.params, route.parts)
      : VIEWS['not-found'] ? VIEWS['not-found'](route.params, route.parts) : '<h1>Page not found</h1><p class="lede">There is no page at this address.</p><p><a href="#/">Go to Home</a></p>';
    // The seven-step bar sits in one place on every page that has it: first in the page, just under the main
    // navigation (paul, 12 Nov), with its slim line right after it.
    var spBar = main.querySelector('.step-path');
    if (spBar && main.firstChild !== spBar) {
      var spSlim = main.querySelector('[data-sp-sticky]');
      main.insertBefore(spBar, main.firstChild);
      if (spSlim) main.insertBefore(spSlim, spBar.nextSibling);
    }
    // A tab row that swipes sideways on a phone opens with the current tab in view.
    var curTab = main.querySelector('.tabs [aria-current="page"]'), tabList = curTab && curTab.closest('ul');
    if (tabList && tabList.scrollWidth > tabList.clientWidth) tabList.scrollLeft = Math.max(0, curTab.offsetLeft - tabList.offsetLeft - 16);
    // Fold the source lines before anything below measures the page, so a redraw keeps the reader's place.
    if (global.LabTpl && global.LabTpl.foldSources) global.LabTpl.foldSources();
    if (global.LabTpl && global.LabTpl.sortable) global.LabTpl.sortable();
    if (global.LabTpl && global.LabTpl.pageTabs) global.LabTpl.pageTabs();
    // A port points each link at what that site carries (window.LAB_PORT.fix).
    if (global.LAB_PORT && global.LAB_PORT.fix) global.LAB_PORT.fix(main);
    document.querySelectorAll('.site-nav a').forEach(function (a) {
      if (a.dataset.hub === route.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var h1 = main.querySelector('h1');
    var suffix = global.LAB_TITLE || 'COHO lab preview';
    document.title = (route.view === 'home' ? suffix : h1.textContent + ' · ' + suffix);
    announce.textContent = h1.textContent;
    closeMenu();
    // Keep focus in the search box while typing; otherwise move focus to the new view.
    var input = main.querySelector('input[name="q"]');
    if (input && route.params.get('q') != null) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    // A re-render for data that arrived (same address) leaves focus where the reader has it.
    else if (render.started && render.last !== location.hash) main.focus({ preventScroll: true });
    // A redraw in place (a field was changed) rebuilds the form. Put focus back on the field the reader was
    // using, or on the next one if they pressed Tab to leave it, so a keyboard user is not sent to the top.
    if (held && render.started && render.path === location.hash.split('?')[0]) refocus(held);
    // A link to another page opens at its top, as a new page would on the live site. A change to the same
    // page's address (a filter, a picker, a tab) keeps the reader where they are.
    var path = location.hash.split('?')[0];
    if (render.started && render.path !== path) global.scrollTo(0, 0);
    render.path = path;
    render.started = true;
    render.last = location.hash;
  }

  function closeMenu() {
    var nav = document.getElementById('site-nav');
    nav.classList.remove('open');
    document.querySelector('.menu-toggle').setAttribute('aria-expanded', 'false');
  }

  // Search terms live in the hash, so Back restores the list a visitor was looking at.
  main.addEventListener('input', function (ev) {
    var form = ev.target.form;
    if (!form || !form.dataset.search) return;
    var target = form.dataset.search === 'tools-q' ? 'tools' : form.dataset.search === 'search-q' ? 'search' : 'places';
    var next = '#/' + target + (ev.target.value ? '?q=' + encodeURIComponent(ev.target.value) : '');
    if (form.dataset.search === 'home-place') {
      // The rebuilt Home answers on Home: the search rides in its own address (#/?q=), with the role picked.
      if (!global.LabHome) { location.hash = next; return; }
      var hp = new URLSearchParams(parseHash().params);
      hp.delete('town');
      if (ev.target.value) hp.set('q', ev.target.value); else hp.delete('q');
      var hs = hp.toString();
      history.replaceState(null, '', '#/' + (hs ? '?' + hs : ''));
      render();
      return;
    }
    history.replaceState(null, '', next);
    render();
  });
  main.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var form = ev.target;
    // Enter in Home's search picks the first match, and Home answers for it.
    if (form.dataset && form.dataset.search === 'home-place') {
      var hit = global.LabHome && global.LabHome.firstMatch ? global.LabHome.firstMatch(form.querySelector('input').value) : null;
      if (hit) { var sp = new URLSearchParams(parseHash().params); sp.delete('q'); sp.set('town', hit.geoid); location.hash = '#/?' + sp.toString(); }
      return;
    }
    var route = parseHash();
    var p = route.params;
    var fd = new FormData(form);
    function attachTo(projectId, scenarioId) {
      var project = LabProjects.get(projectId);
      LabProjects.attach(projectId, scenarioId, {
        kind: 'place-reference', label: p.get('label'),
        snapshot: { geoid: p.get('geoid'), name: p.get('label'), href: p.get('href') },
        origin: { route: p.get('from') || '#/' }
      });
      var done = new URLSearchParams(p);
      done.set('done', project.name); done.set('project', projectId);
      // Replace the chooser in history, so Back from the confirmation returns to the origin.
      history.replaceState(null, '', '#/use?' + done);
      render();
    }
    if (form.dataset.action === 'create') {
      var place = route.view === 'use' ? { geoid: p.get('geoid'), name: p.get('label') } : null;
      var created = LabProjects.create({ name: fd.get('name'), kind: fd.get('kind'), jurisdiction: place });
      if (fd.get('attachAfter')) attachTo(created.projectId, created.scenarios[0].scenarioId);
      else location.hash = '#/project/' + created.projectId;
    } else if (form.dataset.action === 'attach') {
      var target = String(fd.get('target')).split('|');
      attachTo(target[0], target[1]);
    } else if (form.dataset.action === 'delete') {
      if (ev.submitter && ev.submitter.value === 'yes') {
        LabProjects.remove(form.dataset.project);
        location.hash = '#/projects';
      } else {
        location.hash = '#/project/' + form.dataset.project + '?delete=ask';
      }
    }
  });
  // The skip link must not change the hash, or the router would treat #main as a page.
  document.querySelector('.skip-link').addEventListener('click', function (ev) { ev.preventDefault(); main.focus(); });
  main.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-route-path]');
    if (a) remember({ label: a.textContent, href: a.getAttribute('href') });
  });
  // Light or dark: follows the device until the reader picks one; the pick is kept (same key as the live site).
  (function () {
    var btn = document.querySelector('.theme-toggle'), html = document.documentElement;
    if (!btn) return;
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function isDark() { return html.classList.contains('dark-mode') || (!html.classList.contains('light-mode') && !!(mq && mq.matches)); }
    function label() { var d = isDark(); btn.textContent = d ? 'Light' : 'Dark'; btn.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode'); btn.setAttribute('aria-pressed', String(d)); }
    btn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      html.classList.remove('dark-mode', 'light-mode'); html.classList.add(next + '-mode');
      try { localStorage.setItem('coho-analytics-scheme', next); } catch (e) {}
      label();
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', label);
    label();
  })();
  document.querySelector('.menu-toggle').addEventListener('click', function () {
    var nav = document.getElementById('site-nav');
    var open = nav.classList.toggle('open');
    this.setAttribute('aria-expanded', String(open));
  });

  // Other lab modules (homes.js) add their views here before the first render.
  global.LabShell = {
    views: VIEWS, esc: esc, when: when, KIND: KIND, render: function () { render(); },
    // For views built in other files (places.js): the same catalog, rows and search box as the hubs here.
    catalog: function () { return catalog; }, list: list, searchBox: searchBox, hubHead: hubHead, matches: matches,
    inHub: function (hub, filter) { return inHub(hub, filter); }, recent: recent, choice: choice
  };

  // The first render waits for every script on the page, so views added by later files (homes.js,
  // financials.js, places.js) are in place even when the catalog arrives before they have run.
  var ready = new Promise(function (resolve) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve); else resolve();
  });
  Promise.all([fetch((global.LAB_SITE || '') + 'route-catalog.json').then(function (r) { return r.json(); }), ready]).then(function (got) {
    catalog = got[0];
    window.addEventListener('hashchange', render);
    render();
  }).catch(function () {
    main.innerHTML = '<h1>The page list did not load</h1><p class="lede">Open this page through the local server described in the README.</p>';
  });
})(window);
