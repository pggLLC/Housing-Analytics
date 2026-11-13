// Policy and research, the three pages the live site still served for this menu: Elections (#/elections),
// Where the money goes (#/money) and Research overview (#/research).
// - Elections runs the live page's own module (js/colorado-elections.js) on the same element ids, so its
//   ballot coverage, archive and result rules stay the site's. The lab adds the frame around it.
// - Where the money goes reads the award files through the live page's arithmetic
//   (js/agency-funding-model.js): credits and dollars are never added, homes are the one shared measure.
// - Research overview lists the site's research catalog (data/insights/catalog.json), opening the lab's
//   rebuilt page where there is one.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num, money = UI.money;
  var VENDOR = global.LAB_VENDOR;
  var LIVE = 'https://cohoanalytics.com/';
  if (typeof global.resolveAssetUrl !== 'function') global.resolveAssetUrl = function (p) { return VENDOR + p; };

  // ---------- Elections ----------
  var ELECTION = '2026-11-03';
  // The live page's six policy levers, in its own words and order, and its milestone list; each milestone keeps its source.
  var LEVERS = [
    ['Zoning and land use authority', 'State legislators and local elected officials set zoning codes that control where housing can be built and at what density. “Missing middle” reforms, ADU allowances and transit-oriented development mandates all flow through the legislative process. Colorado’s HB24-1313 (Housing in Transit-Oriented Communities) is a recent example: it sets housing-capacity goals for communities near frequent transit.'],
    ['State affordable housing appropriations', 'The governor’s budget and the legislature’s appropriations committees control funding for CHFA programs, the transformational affordable housing grants created in 2022 with federal recovery funds (HB22-1304), and gap-financing tools. Legislative majorities and the governor’s priorities set how much capital flows into affordable housing each year.'],
    ['Ballot measures and citizen initiatives', 'Colorado voters can amend the state constitution or pass statutes directly. Proposition 123 (2022) dedicated a portion of state income tax revenue to affordable housing, bypassing the yearly budget. Similar measures can raise or limit housing funding without the legislature.'],
    ['Rent stabilization and tenant protections', 'State law (C.R.S. 38-12-301) still bars local rent control; HB23-1115, which would have repealed that ban, failed in the Senate in 2023. HB21-1117 (2021) lets cities and counties require affordable rental units in new development (inclusionary zoning), as long as developers are offered alternatives to building them on site. Whether a city uses that tool depends on local elections and council decisions.'],
    ['Tax credit program administration', 'CHFA administers housing tax credit allocation under state law, but the rules, including preferences for rural areas, transit and permanent supportive housing, are set by the legislature and CHFA’s board. Changes in legislative priorities can shift where credits go.'],
    ['Federal delegation and congressional action', 'Colorado’s congressional delegation votes on federal housing money (Section 8, HOME, CDBG), tax policy (the tax credit per-capita ceiling, and the permanent 4% credit floor enacted in December 2020) and regulatory relief. Federal elections therefore change what the state can do, even when state policy does not change.']
  ];
  var MILESTONES = [
    ['2020', 'Federal 4% credit floor', 'The Consolidated Appropriations Act, 2021 (signed December 27, 2020) set a permanent 4% minimum credit rate for bond-financed tax credit buildings placed in service after 2020, raising the equity those deals can raise.', 'https://www.congress.gov/bill/116th-congress/house-bill/133', 'Congress.gov: H.R. 133'],
    ['2021', 'HB21-1117: local inclusionary zoning', 'Cities and counties may require affordable units in new or redeveloped rentals, if developers are offered at least one alternative to building them on site. It does not allow rent control on existing housing.', 'https://leg.colorado.gov/bills/hb21-1117', 'leg.colorado.gov: HB21-1117'],
    ['2022', 'Proposition 123', 'Passed by voters. Sets aside state income tax revenue, up to 0.1% of taxable income a year, for a State Affordable Housing Fund (estimated at $290 million a year from 2023-24), split between affordable housing financing and programs for homeownership, homelessness and local planning. Local governments that seek the money must commit to raising affordable housing by 3% a year and speed up approvals for affordable projects.', 'https://content.leg.colorado.gov/sites/default/files/initiative%2520referendum_proposition%20123%20final%20lc%20packet.pdf', 'Legislative Council analysis of Proposition 123'],
    ['2023', 'HB23-1255: local growth caps voided', 'Voids local caps on population growth or on the number of residential building permits a year, with narrow, temporary exceptions.', 'https://leg.colorado.gov/bills/hb23-1255', 'leg.colorado.gov: HB23-1255'],
    ['2023', 'HB23-1115: rent control ban repeal fails', 'Would have repealed the state ban on local rent control. It passed the House and was postponed indefinitely in the Senate Local Government and Housing Committee on April 25, 2023, so the ban remains.', 'https://leg.colorado.gov/bills/hb23-1115', 'leg.colorado.gov: HB23-1115'],
    ['2024', 'HB24-1313: housing in transit-oriented communities', 'Larger metro communities with frequent transit must zone for a housing goal of an average 40 homes per acre in transit areas; certified communities can draw on a $35 million infrastructure grant program. Signed May 13, 2024.', 'https://leg.colorado.gov/bills/hb24-1313', 'leg.colorado.gov: HB24-1313'],
    ['2024', 'HB24-1098: cause required for eviction', 'Bars most residential evictions without cause, with listed no-fault grounds such as demolition, substantial renovation or owner occupancy. Signed April 19, 2024.', 'https://leg.colorado.gov/bills/hb24-1098', 'leg.colorado.gov: HB24-1098'],
    ['2025', 'Federal tax credit expansion', 'P.L. 119-21, signed July 4, 2025, permanently raises each state’s 9% credit ceiling by 12% from 2026 and lowers the tax-exempt bond test for 4% credits from 50% to 25% from 2026.', 'https://www.congress.gov/bill/119th-congress/house-bill/1', 'Congress.gov: H.R. 1'],
    ['2026', 'SB26-001: workforce housing and housing tax credit', 'Counties and cities can sell or lease their land for affordable housing, counties can spend property tax revenue on housing authorities and workforce housing, and voters can create multi-jurisdiction housing authorities at biennial local elections. Signed March 25, 2026.', 'https://leg.colorado.gov/bills/sb26-001', 'leg.colorado.gov: SB26-001'],
    ['2026', 'HB26-1313: Prop 123 local commitments adjusted', 'For the cycle starting January 1, 2027, the 3%-a-year commitment becomes a target based on each community’s recent permits and job growth, with waivers. Signed May 26, 2026.', 'https://leg.colorado.gov/bills/hb26-1313', 'leg.colorado.gov: HB26-1313'],
    ['2026', 'HB26-1065: transit and housing investment zones', 'Designated transit areas can use state sales tax growth to pay for station infrastructure, and CHFA may allocate a state affordable housing tax credit in those zones of up to $8,333,333 a year, 2027 through 2033. Signed May 27, 2026.', 'https://leg.colorado.gov/bills/hb26-1065', 'leg.colorado.gov: HB26-1065']
  ];
  // The live page's "Connecting elections to platform data" links, pointed at their lab homes.
  var EL_LINKS = [
    ['#/places/deep-dive', 'Colorado deep dive', 'Map tax credit projects, QCTs and DDAs; see which communities current policy reaches.'],
    ['#/places', 'Housing needs assessment', 'The housing gaps policy has to close, for any Colorado place.'],
    ['#/places/economy', 'Economic dashboard', 'Housing costs next to the wider economy that elections respond to.'],
    ['#/news', 'Housing news', 'Colorado housing headlines, newest first.'],
    ['#/legislation', 'Policy and legislation', 'The federal and Colorado laws, rules and CHFA plan changes COHO tracks.']
  ];
  function denverToday() {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var get = function (t) { return p.filter(function (x) { return x.type === t; })[0].value; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  var mountTimer = null, electionNode = null, holder = null;
  // A long block folds shut behind its title and a one-line answer (paul, 10 Nov: phone length).
  function foldOr(title, take, body, id) {
    return global.LabTpl && global.LabTpl.fold ? global.LabTpl.fold(esc(title), esc(take), body, { id: id }) : '<h2 id="' + id + '">' + esc(title) + '</h2>' + body;
  }
  var ELECTION_MARKUP = '<div id="election-data">' +
    '<section aria-labelledby="ballot-heading"><h2 id="ballot-heading">On the ballot</h2>' +
    '<p id="ballot-coverage-summary" class="note"></p><div id="on-ballot-records" class="election-list"></div></section>' +
    '<section id="election-results" hidden aria-labelledby="results-heading">' + foldOr('Election results', 'Results for the housing measures and races tracked on this page.', '<div id="election-result-records" class="election-list"></div>', 'results-heading') + '</section>' +
    // Folded: the candidate cards run about seven phone screens. The title and its one-line answer show.
    (global.LabTpl && global.LabTpl.fold ? '<section>' + global.LabTpl.fold('Candidates’ stated housing positions',
      'What each statewide campaign put out on housing, race by race, and how its wording was checked.',
      '<p class="note">Campaign claims are what candidates say, not government action. Each card says how its wording was checked.</p><div id="candidate-records" class="election-list"></div>', { id: 'candidate-heading' }) + '</section>'
      : '<section aria-labelledby="candidate-heading"><h2 id="candidate-heading">Candidates’ stated housing positions</h2>' +
    '<p class="note">Campaign claims are what candidates say, not government action. Each card says how its wording was checked.</p><div id="candidate-records" class="election-list"></div></section>') +
    '<section aria-labelledby="people-heading"><h2 id="people-heading">People and roles</h2>' +
    '<details class="fold"><summary>Show who holds the offices that shape housing policy</summary><div id="people-records" class="election-list"></div></details></section>' +
    '<section id="ballot-coverage" aria-labelledby="coverage-heading"><h2 id="coverage-heading">Every ballot checked</h2>' +
    '<details class="fold"><summary>Show the research for each county, city and town</summary>' +
    '<p><label for="coverage-county">Show a county</label> <select id="coverage-county" disabled><option value="">All counties</option></select></p>' +
    '<p id="coverage-status" class="coverage-note" role="status"></p>' +
    '<div class="table-scroll" role="region" aria-label="Ballot research coverage" tabindex="0"><table class="election-coverage"><caption>Ballot research, by jurisdiction</caption><thead><tr><th scope="col">Jurisdiction</th><th scope="col">County</th><th scope="col">What was found</th><th scope="col">Checked</th><th scope="col">Source</th></tr></thead><tbody id="coverage-rows"></tbody></table></div></details></section>' +
    '<section id="past-elections" hidden aria-labelledby="past-heading">' + foldOr('Past elections', 'Housing measures from earlier Colorado elections, with their results.', '<div id="past-election-records"></div>', 'past-heading') + '</section></div>';
  // When a page change replaces main, park the block in a hidden holder until the reader comes back.
  new MutationObserver(function () {
    if (!electionNode || electionNode.isConnected) return;
    if (!holder) { holder = document.createElement('div'); holder.hidden = true; document.body.appendChild(holder); }
    holder.appendChild(electionNode);
  }).observe(document.getElementById('main') || document.body, { childList: true });

  // At a glance (lab addition): the measures on the ballot, grouped by what they do, and how far the ballot
  // research reached, counted from the same ballot files the live module reads.
  var BALLOT_FILES = (function () {
    var f = { statewide: 'data/policy/ballot-2026/statewide.json' };
    for (var i = 1; i <= 125; i += 2) f['c' + i] = 'data/policy/ballot-2026/counties/08' + ('00' + i).slice(-3) + '.json';
    f.c14 = 'data/policy/ballot-2026/counties/08014.json';
    return f;
  })();
  var BALLOT_GROUPS = [
    ['money', 'Money for housing', 'var(--pine)', function (r) { return r.indexOf('housing_tax') >= 0 || r.indexOf('housing_finance') >= 0; }],
    ['homeless', 'Homelessness response', 'var(--c-blue)', function (r) { return r.indexOf('homelessness') >= 0; }],
    ['land', 'Land use, zoning and growth', 'var(--c-amber)', function (r) { return r.indexOf('land_use') >= 0; }],
    ['other', 'Other housing questions', 'var(--muted)', function () { return true; }]
  ];
  var COVERAGE = [
    ['verified_measure_found', 'Had a housing measure', 'var(--pine)'],
    ['official_ballot_reviewed_none_found', 'Ballot read, none found', 'var(--grey)'],
    ['not_applicable', 'No election this year', 'var(--grey-line)'],
    ['official_notice_unavailable', 'Ballot notice not posted', 'var(--c-amber)'],
    ['source_unreadable', 'Clerk site could not be read', 'var(--warn)']
  ];
  function ballotSummary(data) {
    var entries = [], cov = [];
    Object.keys(data).forEach(function (k) { entries = entries.concat(data[k].entries || []); cov = cov.concat(data[k].coverage || []); });
    var on = entries.filter(function (e) { return e.status === 'on_ballot' || e.status === 'passed' || e.status === 'failed'; });
    var groups = BALLOT_GROUPS.map(function (g) { return { key: g[0], label: g[1], color: g[2], items: [] }; });
    on.forEach(function (e) {
      var rel = (e.measure && e.measure.relevance) || [];
      for (var i = 0; i < BALLOT_GROUPS.length; i++) if (BALLOT_GROUPS[i][3](rel)) { groups[i].items.push(e); break; }
    });
    var counts = COVERAGE.map(function (c) { return [c[0], c[1], c[2], cov.filter(function (x) { return x.coverage_state === c[0]; }).length]; });
    var places = {};
    on.forEach(function (e) { places[e.jurisdiction.geoid] = 1; });
    return { state: on.filter(function (e) { return e.jurisdiction.level === 'state' || e.jurisdiction.level === 'statewide'; }).length, on: on, groups: groups.filter(function (g) { return g.items.length; }), counts: counts, total: cov.length, places: Object.keys(places).length };
  }
  // A result tag that says how settled it is: unofficial or certified, with its date and the county results page.
  // A count the file does not settle (another stage, or no outcome after election day) is not shown as a result.
  function resultTag(e, over) {
    var r = e.result;
    if (r && (r.outcome === 'passed' || r.outcome === 'failed') && (r.stage === 'unofficial' || r.stage === 'certified')) {
      var word = (r.outcome === 'passed' ? 'Passed' : 'Failed') + (r.stage === 'certified' ? ', certified ' : ', unofficial, as of ') + r.as_of;
      var url = r.source && r.source.url;
      return ' <span class="scope-tag">' + (url ? '<a href="' + esc(url) + '">' + esc(word) + '</a>' : esc(word)) + '</span>';
    }
    if (r) return ' <span class="scope-tag">Count ' + esc(r.stage || 'pending') + ', not settled</span>';
    if (!over || e.status !== 'on_ballot') return '';
    var close = (e.limitations || []).some(function (t) { return /no outcome is recorded yet because the margin/i.test(t); });
    return ' <span class="scope-tag">' + (close ? 'Too close to call so far' : 'No result yet') + '</span>';
  }
  function ballotGlance() {
    var s = UI.load(BALLOT_FILES);
    if (!s.data) return s.error ? '' : '<p role="status" class="note">Counting the ballot research…</p>';
    var b = ballotSummary(s.data), over = denverToday() > ELECTION;
    var asOf = b.on.map(function (e) { return e.result && e.result.as_of; }).filter(Boolean).sort().pop();
    var bar = '<div class="el-cov-bar" role="img" aria-label="' + esc(b.counts.map(function (c) { return c[3] + ' ' + c[1].toLowerCase(); }).join(', ')) + '">' +
      b.counts.filter(function (c) { return c[3]; }).map(function (c) { return '<span style="flex:' + c[3] + ';background:' + c[2] + '" title="' + esc(c[1] + ': ' + c[3]) + '"></span>'; }).join('') + '</div>' +
      '<ul class="el-cov-key">' + b.counts.filter(function (c) { return c[3]; }).map(function (c) { return '<li><span class="el-dot" style="background:' + c[2] + '"></span><strong>' + c[3] + '</strong> ' + esc(c[1].toLowerCase()) + '</li>'; }).join('') + '</ul>';
    var tiles = b.groups.map(function (g) {
      return '<div class="el-group" style="border-top-color:' + g.color + '"><p class="el-group-title">' + esc(g.label) + ' <span class="el-n">' + g.items.length + '</span></p><ul>' + g.items.map(function (e) {
        return '<li><strong>' + esc(e.jurisdiction.name) + '</strong>' + resultTag(e, over) + '<br><span class="note">' + esc(e.neutral_title) + '</span></li>';
      }).join('') + '</ul></div>';
    }).join('');
    return '<section class="el-glance" aria-labelledby="el-glance-h"><h2 id="el-glance-h">At a glance</h2>' +
      '<p><strong>' + b.on.length + ' housing measures</strong> in ' + b.places + ' places ' + (over ? 'were' : 'are') + ' on the November 3 ballot' + (b.state ? ', ' + b.state + ' of them statewide.' : '. None ' + (over ? 'was' : 'is') + ' statewide.') + '</p>' +
      (asOf ? '<p class="note">Results are unofficial county counts, as of ' + esc(longDate(asOf) || asOf) + '. They can change until each county certifies its count.</p>' : '') +
      '<div class="el-groups">' + tiles + '</div>' +
      '<h3>How far the ballot research reached</h3><p class="note">' + b.total + ' counties, cities and towns, each checked against its clerk’s official ballot or notice.</p>' + bar +
      '<p class="metric-source">Source: county and city clerk sample ballots and notices, each linked on its card below; read September and October 2026.' + (asOf ? ' Results: each county’s election results page, linked on each result above.' : '') + '</p></section>';
  }
  function elections() {
    var today = denverToday(), days = Math.round((Date.parse(ELECTION) - Date.parse(today)) / 864e5);
    var when = days > 1 ? 'Election day is November 3, 2026, ' + days + ' days away.' : days === 1 ? 'Election day is tomorrow, November 3, 2026.' : days === 0 ? 'Today is election day, November 3, 2026.' : 'The November 3, 2026 election is over; results show as counties report them.';
    // The live module runs once, on a block of its own that stays in the page between visits: leaving
    // mid-load would otherwise remove the elements it is about to fill.
    clearTimeout(mountTimer);
    mountTimer = setTimeout(function () {
      var slot = document.getElementById('election-slot');
      if (!slot) return;
      if (!electionNode) {
        var box = document.createElement('div');
        box.innerHTML = ELECTION_MARKUP;
        electionNode = box.firstChild;
        slot.replaceWith(electionNode);
        var s = document.createElement('script');
        s.src = VENDOR + 'js/colorado-elections.js';
        document.body.appendChild(s);
      } else slot.replaceWith(electionNode);
    }, 0);
    return T.head({
      kind: 'data', crumbs: T.trail('policy', 'Elections'), title: 'Elections and housing',
      answer: 'What is on Colorado ballots, what candidates have said about housing, and the offices that shape housing policy. Nonpartisan: no endorsements.'
    }) +
      UI.intro('What does this election decide about housing?', when) +
      ballotGlance() +
            '<div id="election-slot"></div>' +
      '<section class="el-levers"><h2>Key housing policy levers shaped by elections</h2><div class="lever-cards">' + LEVERS.map(function (l) {
        return '<div class="lever"><h3 class="lever-title">' + esc(l[0]) + '</h3><p>' + esc(l[1]) + '</p></div>';
      }).join('') + '</div></section>' +
      '<h2>Milestones, 2020 to 2026</h2><p class="note">Sources: Colorado General Assembly bill pages, Colorado Secretary of State election results, Congress.gov.</p><ol class="milestones">' + MILESTONES.map(function (m) {
        return '<li><span class="ms-year">' + esc(m[0]) + '</span><div><p class="ms-title">' + esc(m[1]) + '</p><p>' + esc(m[2]) + '</p><p class="metric-source"><a href="' + esc(m[3]) + '">' + esc(m[4]) + '</a></p></div></li>';
      }).join('') + '</ol>' +
      '<section class="el-links"><h2>Connecting elections to platform data</h2><p class="note">Where policy changes show up in COHO’s data.</p><div class="research-cards">' + EL_LINKS.map(function (l) {
        return '<a class="hub-card" href="' + esc(l[0]) + '"><span class="hub-card-title">' + esc(l[1]) + '</span><span class="hub-card-desc">' + esc(l[2]) + '</span></a>';
      }).join('') + '</div></section>' +
      T.next('Next', [{ href: '#/legislation', label: 'Housing laws COHO tracks →' }, { href: '#/calendar', label: 'Deadlines and events', secondary: true }]);
  }

  // ---------- Where the money goes ----------
  var AGENCY_ORDER = ['CHFA', 'OEDIT', 'DOLA'];
  var MONEY_FILES = {
    ledger: 'data/policy/funding-awards/ledger.json', documents: 'data/policy/funding-awards/documents.json',
    rows: 'data/policy/funding-awards/award-rows.json', dola: 'data/policy/funding-awards/dola-awards.json',
    aliases: 'data/policy/funding-awards/developer-aliases.json', demographics: 'data/co-county-demographics.json',
    boundaries: 'data/boundaries/counties_co.geojson', regions: 'data/derived/funding-vs-need.json'
  };
  function moneyData(d) {
    if (d._awards) return d;
    var M = global.AgencyFundingModel, counties = {};
    d.boundaries.features.forEach(function (f) {
      var name = f.properties.NAME, demo = d.demographics.counties[name] || {};
      counties[f.properties.GEOID] = { name: name, population: demo.population > 0 ? demo.population : null };
    });
    d._counties = counties;
    // CHFA's 4% bond deals outside its rounds, as the live page adds them (js/agency-funding.js): without them the lab
    // dropped those awards and their homes (QA 11-09).
    var fvnMeta = (d.regions && d.regions.meta) || {};
    d._awards = M.normalise({ ledger: d.ledger, documents: d.documents, rows: d.rows, dola: d.dola, aliases: d.aliases, counties: counties,
      bondDeals: { deals: fvnMeta.bond_deals_outside_rounds || [], url: LIVE + 'chfa-portfolio.html', checked: fvnMeta.generatedAt || null } });
    return d;
  }
  // What one agency's headline is measured in: CHFA's yearly credits, the others' dollars, homes for all three.
  function measureText(s, agency) {
    if (agency === 'ALL') return s.homes == null ? 'no homes printed' : num(s.homes) + ' homes';
    if (agency === 'CHFA') return s.credits == null ? 'no credits printed' : money(s.credits) + ' a year in tax credits';
    return s.dollars == null ? 'no amounts printed' : money(s.dollars);
  }
  var RAMP = ['var(--map-0)', 'var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)'], NONE = 'var(--map-empty)';
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  var ring = K.ring;
  function shape(g) { return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(function (p) { return p.map(ring).join(''); }).join(''); }

  // ---------- The flow: which program paid, and where the homes are ----------
  // Built by the live page's own arithmetic (AgencyFundingModel.flows), measured in homes, the one thing
  // every agency prints. Drawn twice, like the house charts, so labels keep their size on a phone.
  var FLOW_INK = 'var(--ink)', FLOW_MUT = 'var(--muted)';
  // DOLA is gold, not purple: purple and the OEDIT blue look alike to red-blind readers (Gemini round 2, 5a; big visual pass 11-06).
  var FLOW_HUE = { CHFA: 'var(--c-green)', OEDIT: 'var(--c-blue)', DOLA: 'var(--gold)' };
  var FLOW_KEY = { CHFA: 'CHFA tax credits', OEDIT: 'OEDIT Prop 123 fund', DOLA: 'DOLA grants and loans' };
  // Map kit part 2: regions are names, not warnings, so they take the colour-blind safe category set, never rust.
  var REGION_HUE = ['var(--cat-1)', 'var(--cat-3)', 'var(--cat-2)', 'var(--cat-6)', 'var(--cat-4)', 'var(--cat-7)'];
  function moneyRegions(d) {
    if (d._regionOf) return d;
    d._regionOf = {}; d._regionOrder = [];
    ((d.regions && d.regions.counties) || []).forEach(function (c) {
      if (!c.fips || !c.region) return;
      d._regionOf[c.fips] = c.region;
      if (d._regionOrder.indexOf(c.region) === -1) d._regionOrder.push(c.region);
    });
    return d;
  }
  function flowDrawing(f, W, size, pick, href) {
    var BAR = 10, GAP = 10, SLOT = size < 13 ? 40 : 44, TOP = 4;
    var rows = Math.max(f.left.length, f.right.length), k = (rows * 22) / f.homes;
    function place(nodes) {
      var y = TOP;
      return nodes.map(function (n) {
        var h = Math.max(2, n.homes * k), slot = Math.max(h, SLOT), o = { n: n, h: h, slot: slot, y: y, top: y + (slot - h) / 2 };
        o.next = o.top; y += slot + GAP; return o;
      }).concat([{ end: y }]);
    }
    var L = place(f.left), R = place(f.right);
    var H = Math.ceil(Math.max(L.pop().end, R.pop().end)) + TOP;
    var byL = {}, byR = {};
    L.forEach(function (o) { byL[o.n.key] = o; });
    R.forEach(function (o) { byR[o.n.key] = o; });
    var x0 = 0, x1 = W - BAR, mx = (x0 + BAR + x1) / 2;
    var ribbons = f.links.map(function (l) {
      var a = byL[l.from], b = byR[l.to], h = Math.max(1, l.homes * k);
      var ya = a.next + h / 2, yb = b.next + h / 2;
      a.next += l.homes * k; b.next += l.homes * k;
      var on = !pick || l.from === pick || l.to === pick;
      return '<path d="M' + (x0 + BAR) + ',' + ya.toFixed(1) + ' C' + mx + ',' + ya.toFixed(1) + ' ' + mx + ',' + yb.toFixed(1) + ' ' + x1 + ',' + yb.toFixed(1) +
        '" fill="none" stroke="' + FLOW_HUE[l.agency] + '" stroke-opacity="' + (on ? (pick ? 0.55 : 0.32) : 0.06) + '" stroke-width="' + h.toFixed(1) + '"><title>' +
        esc(a.n.label + ' (' + l.agency + ') to ' + b.n.label + ': ' + num(l.homes) + ' homes') + '</title></path>';
    }).join('');
    // A white edge behind each label keeps it readable where it sits on a coloured band.
    var HALO = ' stroke="var(--halo)" stroke-width="3" stroke-linejoin="round" paint-order="stroke"';
    function node(o, left) {
      var n = o.n, x = left ? x0 : x1, tx = left ? x0 + BAR + 6 : x1 - 6, anchor = left ? 'start' : 'end', mid = o.y + o.slot / 2;
      var name = !left && n.key === '_none' && size < 13 ? 'No single county' : n.label;
      var hit = Math.min(220, Math.floor(W * 0.5));
      return '<a data-flow="' + esc(n.key) + '" href="' + esc(href(pick === n.key ? null : n.key)) + '" aria-label=""' + esc(n.label + ', ' + num(n.homes) + ' homes: ' + (pick === n.key ? 'show all' : left ? 'show where they went' : 'show where they came from')) + '">' +
        '<rect x="' + (left ? x0 : W - hit) + '" y="' + o.y.toFixed(1) + '" width="' + hit + '" height="' + o.slot.toFixed(1) + '" fill="transparent"/>' +
        '<rect x="' + x + '" y="' + o.top.toFixed(1) + '" width="' + BAR + '" height="' + o.h.toFixed(1) + '" rx="2" fill="' + (left ? FLOW_HUE[n.agency] : FLOW_INK) + '"' + (pick === n.key ? ' stroke="' + FLOW_INK + '" stroke-width="2"' : '') + '/>' +
        '<text x="' + tx + '" y="' + (mid - 2).toFixed(1) + '" font-size="' + size + '" font-weight="600" fill="' + FLOW_INK + '" text-anchor="' + anchor + '"' + HALO + '>' + esc(name) + '</text>' +
        '<text x="' + tx + '" y="' + (mid + 13).toFixed(1) + '" font-size="' + (size - 1) + '" fill="' + FLOW_MUT + '" text-anchor="' + anchor + '"' + HALO + '>' + esc(num(n.homes) + ' homes' + (n.estimated ? ', some est.' : '')) + '</text></a>';
    }
    var nodes = L.map(function (o) { return node(o, true); }).concat(R.map(function (o) { return node(o, false); })).join('');
    return { h: H, body: '<g>' + ribbons + '</g><g>' + nodes + '</g>' };
  }
  // Where each region is: the counties, one hue per region, keyed below.
  function regionMap(d, regions) {
    var hue = {};
    regions.forEach(function (r, i) { hue[r] = REGION_HUE[i % REGION_HUE.length]; });
    var paths = d.boundaries.features.map(function (f) {
      var r = d._regionOf[f.properties.GEOID];
      return '<path d="' + shape(f.geometry) + '" fill="' + (r && hue[r] ? hue[r] : NONE) + '" stroke="var(--map-edge)" stroke-width="1"><title>' + esc(f.properties.NAME + ' County: ' + (r || 'no region')) + '</title></path>';
    }).join('');
    return '<div class="flow-regions"><p class="flow-sub">Where each region is</p><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="img" aria-label="Colorado counties colored by the six regions in the chart">' + paths + '</svg>' +
      '<ul class="flow-key">' + regions.map(function (r) { return '<li><i style="background:' + hue[r] + '"></i>' + esc(r) + '</li>'; }).join('') + '</ul></div>';
  }
  // On a phone, the flow as one bar per program, split by region, before the drawing (Gemini round 2, question 7;
  // big visual pass 11-06). Same links as the drawing; each row picks its program like the drawing's labels do.
  function flowBars(f, d, pick, href) {
    var hue = {}, order = d._regionOrder.concat(['_none']);
    d._regionOrder.forEach(function (r, i) { hue[r] = REGION_HUE[i % REGION_HUE.length]; });
    hue._none = 'var(--slate-text)';
    var byR = {};
    f.right.forEach(function (n) { byR[n.key] = n; });
    var used = order.filter(function (k) { return byR[k]; });
    return '<div class="flow-bars"><p class="flow-sub">Where each program’s homes are</p><ul>' + f.left.map(function (n) {
      var segs = f.links.filter(function (l) { return l.from === n.key; }).sort(function (a, b) { return order.indexOf(a.to) - order.indexOf(b.to); });
      return '<li' + (pick && pick !== n.key ? ' class="is-dim"' : '') + '><a data-flow="' + esc(n.key) + '" href="' + esc(href(pick === n.key ? null : n.key)) + '">' +
        '<span class="fb-t"><i style="background:' + FLOW_HUE[n.agency] + '"></i>' + esc(n.label) + '</span><span class="fb-n">' + esc(num(n.homes)) + '</span>' +
        '<span class="fb-bar" aria-hidden="true">' + segs.map(function (l) {
          return '<b style="width:' + (l.homes / n.homes * 100).toFixed(2) + '%;background:' + hue[l.to] + '" title="' + esc(byR[l.to].label + ': ' + num(l.homes)) + '"></b>';
        }).join('') + '</span></a></li>';
    }).join('') + '</ul><ul class="flow-key">' + used.map(function (k) { return '<li><i style="background:' + hue[k] + '"></i>' + esc(byR[k].label) + '</li>'; }).join('') + '</ul></div>';
  }
  function flowFigure(d, awards, where, pick, href) {
    var M = global.AgencyFundingModel, f = M.flows(awards, d._regionOf, d._regionOrder);
    var title = 'Which programs paid, and where the homes are';
    if (!f.homes) return '<h2>' + title + '</h2><p class="note">No award' + esc(where) + ' has a home count in these lists, so there is nothing to draw.</p>';
    var byL = {}, byR = {};
    f.left.forEach(function (n) { byL[n.key] = n; });
    f.right.forEach(function (n) { byR[n.key] = n; });
    var picked = pick && (byL[pick] || byR[pick]) ? pick : null;
    var line;
    if (picked) {
      var isLeft = !!byL[picked], n = byL[picked] || byR[picked];
      var parts = f.links.filter(function (l) { return isLeft ? l.from === picked : l.to === picked; }).sort(function (a, b) { return b.homes - a.homes; }).map(function (l) {
        return (isLeft ? byR[l.to].label : byL[l.from].label + ' (' + l.agency + ')') + ' ' + num(l.homes) + ' (' + Math.round(l.homes / n.homes * 100) + '%)';
      });
      line = '<strong>' + esc((isLeft ? n.label + ' (' + n.agency + ')' : n.label) + ', ' + num(n.homes) + ' homes' + (isLeft ? ' went to' : ' came from')) + ':</strong> ' + esc(parts.join(', ')) + '. <a data-flow="" href="' + esc(href(null)) + '">Show all</a>';
    } else {
      line = 'Select a program or a region to see where its homes went.';
    }
    var dk = flowDrawing(f, 760, 13, picked, href), ph = flowDrawing(f, 340, 12, picked, href);
    var agencies = AGENCY_ORDER.filter(function (a) { return f.left.some(function (n) { return n.agency === a; }); });
    var regions = d._regionOrder.filter(function (r) { return byR[r]; });
    var text = '<details class="flow-text"><summary>The same numbers as a list</summary><ul>' + f.left.map(function (n) {
      return '<li>' + esc(n.label + ' (' + n.agency + '): ' + num(n.homes) + ' homes. ' + f.links.filter(function (l) { return l.from === n.key; }).map(function (l) { return byR[l.to].label + ' ' + num(l.homes); }).join(', ') + '.') + '</li>';
    }).join('') + '</ul></details>';
    return '<figure class="viz money-flow"><figcaption><strong>' + title + '</strong>' +
      '<span class="viz-answer">Left: the program that paid, colored by agency. Right: the region of the county on the award. Band width is homes, ' + num(f.homes) + ' in all' + esc(where) + '.</span></figcaption>' +
      '<p class="flow-pick" role="status">' + line + '</p>' +
      '<ul class="flow-key">' + agencies.map(function (a) { return '<li><i style="background:' + FLOW_HUE[a] + '"></i>' + esc(FLOW_KEY[a]) + '</li>'; }).join('') + '</ul>' +
      '<svg class="viz-d" viewBox="0 0 760 ' + dk.h + '" role="group" aria-label="' + title + '">' + dk.body + '</svg>' +
      flowBars(f, d, picked, href) +
      '<svg class="viz-p" viewBox="0 0 340 ' + ph.h + '" role="group" aria-label="' + title + '">' + ph.body + '</svg>' +
      (regions.length ? regionMap(d, d._regionOrder) : '') +
      '<p class="note">A project paid for by two programs is counted under each, so this adds up homes named in awards, not separate buildings.' +
      (f.estimated ? ' Land banking counts are the estimates the awards print.' : '') +
      (f.withoutHomes ? ' ' + num(f.withoutHomes) + ' award' + (f.withoutHomes === 1 ? ' has' : 's have') + ' no home count and ' + (f.withoutHomes === 1 ? 'is' : 'are') + ' left out.' : '') +
      ' Regions follow DOLA’s planning regions, folded into six. Federal grants are HOME, CDBG and the Housing Trust Fund, passed through DOLA.</p>' + text + '</figure>';
  }

  // ---------- Who funded whom ----------
  // Every agency in its own columns, never added: credits a year, 4% bonds, Prop 123 money by kind, DOLA dollars.
  var MATRIX_ROWS = { county: ['County', 'counties'], town: ['Town', 'towns'], developer: ['Developer', 'developers'], agency: ['Agency', 'agencies'] };
  function matrix(d, awards, by, q) {
    var M = global.AgencyFundingModel;
    var rows = M.group(awards, by).map(function (g) {
      var b = g.summary.byAgency, o = b.OEDIT || { byKind: {} };
      var r = { name: g.label, key: g.key, chfa: b.CHFA ? b.CHFA.credits : null, bonds: b.CHFA ? b.CHFA.bonds : null, dola: b.DOLA ? b.DOLA.dollars : null, homes: g.summary.homes, awards: g.summary.awards };
      Object.keys(M.OEDIT_KINDS).forEach(function (kind) { r['o_' + kind] = o.byKind && o.byKind[kind] != null ? o.byKind[kind] : null; });
      return r;
    }).sort(function (a, b) { return (a.key === '_none') - (b.key === '_none') || (b.homes || 0) - (a.homes || 0); });
    var cols = [
      { key: 'name', label: MATRIX_ROWS[by][0], href: by === 'county' ? function (r) { return r.key === '_none' ? null : q('county', r.key); } : null },
      { key: 'chfa', label: 'CHFA credits a year', num: true, fmt: money, tip: 'Housing tax credits a year from CHFA; the credit runs ten years. Not dollars, so never added to the other columns.' },
      { key: 'bonds', label: 'CHFA 4% bonds', num: true, fmt: money, tip: 'Tax-exempt bond amounts on CHFA’s 4% award reports (from 2018). Bonds are a loan to the project.' }
    ].concat(Object.keys(M.OEDIT_KINDS).map(function (kind) {
      return { key: 'o_' + kind, label: M.OEDIT_KINDS[kind].head, num: true, fmt: money, tip: M.OEDIT_KINDS[kind].tip };
    })).concat([
      { key: 'dola', label: 'DOLA $', num: true, fmt: money, tip: 'Grants and loans from DOLA’s Division of Housing, plus Division of Local Government housing grants.' },
      { key: 'homes', label: 'Homes', num: true, fmt: num },
      { key: 'awards', label: 'Awards', num: true }
    ]);
    var chips = '<nav class="dm-chips" aria-label="Rows"><ul>' + Object.keys(MATRIX_ROWS).map(function (k) {
      return '<li><a href="' + esc(q('rows', k)) + '"' + (k === by ? ' class="is-on" aria-current="true"' : '') + '>' + esc(MATRIX_ROWS[k][1].replace(/^./, function (c) { return c.toUpperCase(); })) + '</a></li>';
    }).join('') + '</ul></nav>';
    return '<h2>Who funded whom</h2><p class="note">Group by</p>' + chips +
      '<p class="note">Each agency in its own columns, sorted by homes, whichever agency is picked above. Select a column heading to sort by it. No column is added to another.</p>' +
      UI.table('money-matrix-' + by, 'Awards by ' + by + ' and agency', cols, rows, { noun: MATRIX_ROWS[by][1], placeholder: MATRIX_ROWS[by][0] });
  }

  function moneyPage(params) {
    var M = global.AgencyFundingModel;
    var title = 'Where the money goes';
    var headFor = function (dated) { return T.head({
      kind: 'data', crumbs: T.trail('policy', title), title: title,
      answer: 'Every affordable housing award from CHFA, OEDIT and DOLA’s Division of Housing, by county and project, each linked to the list it came from.',
      dated: dated
    }); };
    var head = headFor();
    if (!M) return head + '<p class="callout">The award arithmetic did not load.</p>';
    var s = UI.load(MONEY_FILES);
    if (s.error) return head + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return head + '<p role="status" class="note">Loading every state housing award…</p>';
    var d = moneyRegions(moneyData(s.data));
    var agency = AGENCY_ORDER.indexOf(params.get('agency')) > -1 ? params.get('agency') : 'ALL';
    var county = d._counties[params.get('county')] ? params.get('county') : null;
    // The live page's Years pickers (js/agency-funding.js, hm-from and hm-to): every figure, the map, the flow and the
    // tables use only awards in the picked years, through the model's own filter. Awards with no year drop out of a
    // narrowed range, as on the live page.
    var allYears = d._awards.map(function (a) { return a.year; }).filter(function (y) { return y != null; });
    var minY = Math.min.apply(null, allYears), maxY = Math.max.apply(null, allYears);
    var yr = function (k, dflt) { var v = Number(params.get('f.' + k)); return v >= minY && v <= maxY ? v : dflt; };
    var from = yr('from', minY), to = yr('to', maxY);
    if (from > to) to = from;
    var narrowed = from > minY || to < maxY;
    var base = narrowed ? M.filter(d._awards, { from: from, to: to }) : d._awards;
    var yearMenu = function (k, label, cur, dflt) {
      var o = ''; for (var y = minY; y <= maxY; y++) o += '<option value="' + y + '"' + (y === cur ? ' selected' : '') + '>' + y + '</option>';
      return '<label class="opp-menu"><span>' + label + '</span><select data-opp-menu="' + k + '" data-default="' + dflt + '">' + o + '</select></label>';
    };
    var yearPick = '<div class="opp-menus" role="group" aria-label="Years">' + yearMenu('from', 'From year', from, minY) + yearMenu('to', 'To year', to, maxY) + '</div>';
    var all = M.filter(base, { agency: agency });
    var picked = county ? M.filter(all, { county: county }) : all;
    var sum = M.summarise(picked);
    var years = picked.map(function (a) { return a.year; }).filter(function (y) { return y != null; });
    var span = years.length ? Math.min.apply(null, years) + ' to ' + Math.max.apply(null, years) : '';
    var where = county ? d._counties[county].name + ' County' : 'Colorado';
    var byCounty = M.group(all, 'county').filter(function (g) { return g.key !== '_none'; });
    var finding = (agency === 'ALL' ? 'Awards from CHFA, OEDIT and DOLA' : M.AGENCIES[agency].label + ' awards') + ' in ' + where + (span ? ', ' + span : '') + ': ' +
      measureText(sum, agency) + ' across ' + num(sum.awards) + ' awards' + (county ? '.' : ', in ' + byCounty.length + ' of 64 counties.');
    var q = function (k, v) { var p = new URLSearchParams(params); if (v == null) p.delete(k); else p.set(k, v); var x = p.toString(); return '#/money' + (x ? '?' + x : ''); };
    var chips = '<nav class="dm-chips" aria-label="Which agency"><ul>' + [['ALL', 'All three, in homes']].concat(AGENCY_ORDER.map(function (k) { return [k, M.AGENCIES[k].label]; })).map(function (c) {
      return '<li><a href="' + esc(q('agency', c[0] === 'ALL' ? null : c[0])) + '"' + (c[0] === agency ? ' class="is-on" aria-current="true"' : '') + '>' + esc(c[1]) + '</a></li>';
    }).join('') + '</ul></nav>';
    // The three agencies, each in its own measure.
    var whole = M.summarise(county ? M.filter(base, { county: county }) : base);
    var cards = '<div class="agency-cards">' + AGENCY_ORDER.map(function (k) {
      var b = whole.byAgency[k] || { awards: 0, homes: null, credits: null, dollars: null };
      return '<div class="agency-card"><p class="lever-title">' + esc(M.AGENCIES[k].label) + '</p><p class="metric-value">' + esc(measureText(b, k)) + '</p>' +
        '<p class="dq-n">' + num(b.awards) + ' awards' + (b.homes != null ? ', ' + num(b.homes) + ' homes' : '') +
        // The live page's split line (js/agency-funding.js splitList): CHFA's 4% bond deals outside the rounds print no credit.
        (k === 'CHFA' && whole.bondDeals && whole.bondDeals.awards ? ' (' + num(whole.bondDeals.awards) + ' of them 4% bond deals outside the rounds, ' + num(whole.bondDeals.homes) + ' homes, credit amount not printed)' : '') + '</p><p class="dq-what">' + esc(M.AGENCIES[k].plain) + '</p></div>';
    }).join('') + '</div>';
    // County map: one hue, light to dark, by the chosen measure. A county opens its awards.
    // The live page opens per resident (js/agency-funding.js state.norm 'per'): homes per 1,000 residents, or dollars or
    // credits per resident, from the county populations in the demographics file. "Total" shows the raw sum.
    var per = params.get('norm') !== 'total';
    var unit = agency === 'ALL' ? (per ? 'homes per 1,000 residents' : 'homes') : agency === 'CHFA' ? (per ? 'tax credits a year per resident' : 'tax credits a year') : (per ? 'dollars per resident' : 'dollars');
    var show = function (v) { return v == null ? 'no awards' : agency === 'ALL' ? (per ? v.toFixed(1) + ' homes per 1,000 residents' : num(v) + ' homes') : per ? '$' + (v >= 100 ? num(v) : v.toFixed(2)) + (agency === 'CHFA' ? ' a year in credits' : '') + ' per resident' : agency === 'CHFA' ? money(v) + ' a year in credits' : money(v); };
    var val = {}, max = 0;
    byCounty.forEach(function (g) {
      var v = agency === 'ALL' ? g.summary.homes : M.measureOf(g.summary, agency);
      if (per && v != null) { var r = M.perResident(v, (d._counties[g.key] || {}).population); v = r == null ? null : agency === 'ALL' ? r * 1000 : r; }
      val[g.key] = v; if (v > max) max = v;
    });
    var normChips = '<nav class="dm-chips" aria-label="Map measure"><ul>' + [['per', agency === 'ALL' ? 'Per 1,000 residents' : 'Per resident'], ['total', 'Total']].map(function (c) {
      return '<li><a href="' + esc(q('norm', c[0] === 'per' ? null : 'total')) + '"' + ((c[0] === 'per') === per ? ' class="is-on" aria-current="true"' : '') + '>' + esc(c[1]) + '</a></li>';
    }).join('') + '</ul></nav>';
    var mcls = function (v) { return Math.max(1, Math.min(RAMP.length - 1, Math.floor(Math.sqrt(v / max) * RAMP.length))); };
    var paths = d.boundaries.features.map(function (f) {
      var k = f.properties.GEOID, v = val[k], fill = v == null || !max ? NONE : RAMP[mcls(v)];
      var label = f.properties.NAME + ' County: ' + show(v);
      return '<a href="' + esc(q('county', k)) + '" aria-label="' + esc(label) + '"><path d="' + shape(f.geometry) + '" fill="' + fill + '"' + (k === county ? ' class="is-picked"' : '') + '><title>' + esc(label) + '</title></path></a>';
    }).join('');
    var mapTitle = (agency === 'ALL' ? 'Homes awarded' : M.AGENCIES[agency].label + ' awards') + (per ? ' per ' + (agency === 'ALL' ? '1,000 residents' : 'resident') : '') + ', by county';
    // Map kit part 2: the title is the finding, and the legend gives each step's range and count, not "Less" and "More".
    var ranked = Object.keys(val).filter(function (k) { return val[k] != null && val[k] > 0; }).sort(function (a, b) { return val[b] - val[a]; });
    var nameOf = {}; d.boundaries.features.forEach(function (f) { nameOf[f.properties.GEOID] = f.properties.NAME; });
    var noneN = d.boundaries.features.length - ranked.length;
    var mapFinding = ranked.length ? nameOf[ranked[0]] + ' County leads (' + show(val[ranked[0]]) + ')' + (ranked[1] ? ', then ' + nameOf[ranked[1]] + ' (' + show(val[ranked[1]]) + ')' : '') + (noneN ? '; ' + noneN + ' counties have no awards in these lists' : '') : mapTitle;
    var vfmt = function (v) { return agency === 'ALL' ? (per ? v.toFixed(1) : num(v)) : per ? '$' + (v >= 100 ? num(v) : v.toFixed(2)) : money(v); };
    var steps = K.classes(ranked.map(function (k) { return val[k]; }), RAMP.length, mcls).map(function (c, i) {
      return c.count ? '<li><i style="background:' + RAMP[i] + '"></i>' + esc((c.lo === c.hi ? vfmt(c.lo) : vfmt(c.lo) + ' to ' + vfmt(c.hi)) + ' (' + c.count + ')') + '</li>' : '';
    }).reverse().join('');
    var map = '<figure class="pres-map money-map"><figcaption><span class="cc-kicker">' + esc(mapTitle) + '</span><strong>' + esc(mapFinding) + '</strong><span class="note">Darker means more ' + esc(unit) + '. Select a county for its awards.' + (per ? ' Per resident, a small county with one project can top the map.' : '') + '</span></figcaption>' + normChips +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="' + esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(mapFinding, 'CHFA, OEDIT and DOLA awards')) + '">' + paths + K.cities() + '</svg></div>' +
      '<ul class="mk-legend"><li class="mk-legend-unit">' + esc(unit.replace(/^./, function (c) { return c.toUpperCase(); })) + ':</li>' + steps + (noneN ? '<li><i style="background:' + NONE + '"></i>No awards (' + noneN + ')</li>' : '') + '</ul>' +
      T.source('CHFA, OEDIT and DOLA award lists, as gathered by COHO' + (per ? '; county populations from the site\u2019s county demographics file' : '') + '; county outlines from US Census TIGER', LIVE + 'where-housing-money-goes.html', day(d.ledger.meta && d.ledger.meta.generated_at)) +
      (global.LabVizData ? global.LabVizData.block(mapTitle,
        ['County', unit.replace(/^./, function (c) { return c.toUpperCase(); })],
        d.boundaries.features.map(function (f) { return [f.properties.NAME + ' County', val[f.properties.GEOID] == null ? null : val[f.properties.GEOID]]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; })) : '') + '</figure>';
    var rows = picked.map(function (a) {
      return { name: a.name, town: a.town, county: a.county, agency: a.agency, program: a.program, year: a.yearLabel, homes: a.homes, amount: a.agency === 'CHFA' ? a.credits : a.dollars,
        amountNote: a.agency === 'CHFA' ? 'credits a year' : (a.dollarsBasis === 'requested' ? 'requested' : ''), url: a.sourceUrl, source: a.sourceTitle, developer: a.developer };
    });
    return headFor({ ledger: s.data.ledger, rows: s.data.rows, dola: s.data.dola, documents: s.data.documents }) + chips + yearPick + UI.intro('Where has state housing money gone?', finding) +
      (county ? '<p><a href="' + esc(q('county', null)) + '">← All of Colorado</a></p>' : '') + cards + map +
      flowFigure(d, picked, county ? ' in ' + where : '', params.get('flow'), function (k) { return q('flow', k); }) + T.source('CHFA, OEDIT and DOLA award lists, as gathered by COHO', LIVE + 'where-housing-money-goes.html', day(d.ledger.meta && d.ledger.meta.generated_at)) +
      matrix(d, county ? M.filter(base, { county: county }) : base, MATRIX_ROWS[params.get('rows')] ? params.get('rows') : (county ? 'town' : 'county'), q) + T.source('CHFA, OEDIT and DOLA award lists, as gathered by COHO', LIVE + 'where-housing-money-goes.html', day(d.ledger.meta && d.ledger.meta.generated_at)) +
      '<h2>Every award' + (county ? ' in ' + esc(where) : '') + '</h2>' +
      UI.table('money-awards', 'Each award, as its list prints it', [
        { key: 'name', label: 'Project', href: function (r) { return r.url; } },
        { key: 'town', label: 'Town' },
        { key: 'agency', label: 'Agency' },
        { key: 'program', label: 'Program' },
        { key: 'year', label: 'Year' },
        { key: 'homes', label: 'Homes', num: true, fmt: num },
        { key: 'amount', label: 'Amount', num: true, fmt: function (v, r) { return money(v) + (r.amountNote ? ' (' + r.amountNote + ')' : ''); } },
        { key: 'developer', label: 'Developer or grantee' }
      ], rows, { noun: 'awards', placeholder: 'Project, town or developer' }) +
      (M.csv ? '<p class="viz-data-csv"><a class="button-link secondary" download="colorado-housing-awards' + (agency === 'ALL' ? '' : '-' + agency.toLowerCase()) + (county ? '-' + county : '') + '.csv" href="data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + M.csv(picked)) + '">Download these ' + num(picked.length) + ' awards as CSV</a></p>' : '') +
      '<p class="note">From CHFA’s award reports (2016 to 2026), Prop 123 fund selection lists from OEDIT (FY23-24 to FY25-26), and DOLA announcements read by hand, which are partial. Tax credits are not dollars: CHFA prints the credit each project claims a year, so credits are never added to grants and loans, and “all three” is counted in homes. A project funded by two agencies counts under each. Land banking homes are estimates.</p>' +
      T.source('CHFA, OEDIT and DOLA award lists, as gathered by COHO', LIVE + 'where-housing-money-goes.html', day(d.ledger.meta && d.ledger.meta.generated_at)) +
      T.next('Next', [{ href: '#/opportunity/round-one', label: '2026 Round One awards →' }, { href: '#/deals', label: 'Deal summaries', secondary: true }]);
  }
  function day(iso) { return iso ? String(iso).slice(0, 10) : null; }

  // ---------- Research overview ----------
  // The catalog's live pages, and where each one lives in the lab today.
  var LAB_ROUTE = {
    'housing-legislation-2026.html': '#/legislation', 'lihtc-enhancement-ahcia.html': '#/guide/ahcia', 'article-fair-housing-rollback.html': '#/guide/fair-housing',
    'article-federal-rule-changes.html': '#/guide/federal-rules',
    'cra-expansion-analysis.html': '#/guide/cra-pricing', 'working-paper.html': '#/guide/working-paper', 'apa-white-paper.html': '#/guide/white-paper',
    'methods.html': '#/guide/methods', 'article-pricing.html': '#/equity-pricing', 'lihtc-guide-for-stakeholders.html': '#/guide/lihtc-basics',
    'local-incentives.html': '#/places/incentives', 'resident-services.html': '#/guide/resident-services', 'affordable-deal-team.html': '#/guide/deal-team',
    'green-building-guide.html': '#/guide/green-building', 'help-for-homebuyers.html': '#/assistance', 'housing-authority-guide.html': '#/guide/housing-authority',
    'sunday-digest.html': '#/digest', 'housing-help.html': '#/assistance'
  };
  // The catalog's own section names and notes (meta.sections), in its order.
  var SECTIONS = [['current', 'Current policy status'], ['analysis', 'Analysis and research briefs'], ['papers', 'Papers and methods'], ['reference', 'Reference and guides'], ['data', 'Data explorations']];
  var KEEP = { reviewed: 'Checked on a schedule', dated: 'Published once, dated', generated: 'Rebuilt from the data', 'live-data': 'Live data' };
  // A module from the pinned copy, loaded the first time a page needs it; the page redraws when it arrives.
  // test() says whether it is already there (a module the site declares with const is not on window).
  // Its path must be in index.html's LAB_LAZY_VENDOR list, or the hosted preview does not carry it.
  var scripts = {};
  function scriptFailed(path) { return scripts[path] === 'failed'; }
  function needScript(path, test) {
    if (test()) return true;
    if (!scripts[path] && typeof document.createElement === 'function') {
      scripts[path] = 1;
      var el = document.createElement('script');
      el.src = VENDOR + path;
      el.onload = function () { Shell.render(); };
      el.onerror = function () { scripts[path] = 'failed'; Shell.render(); };
      document.body.appendChild(el);
    }
    return false;
  }

  // ---------- Market data snapshot ----------
  // The live Research page's three cards: credit pricing (js/components/equity-pricing.js), risk indicators and
  // rates and deadlines (js/components/market-pulse.js), each read from the same data files through the site's
  // own helpers, so every value, period and "unavailable" rule is the site's.
  var SNAP_FILES = {
    bench: 'data/market/novogradac-equity-pricing.json', hist: 'data/market/lihtc-equity-pricing-history.json',
    fred: 'data/fred-data.json', vacancy: 'data/market/aamd-denver-vacancy.json',
    foreclosure: 'data/market/colorado-foreclosure-performance.json', calendar: 'data/chfa-qap-calendar.json'
  };
  function snapPct(v, d) { return v == null ? 'Value unavailable' : v.toFixed(d == null ? 1 : d) + '%'; }
  function snapBps(v) { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' bp'; }
  function snapQuarter(q) { return String(q || '').replace(/(\d{4})-?Q(\d)/, '$1 Q$2'); }
  function snapDay(iso) { var t = Date.parse(String(iso || '').slice(0, 10)); return isNaN(t) ? '—' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  function snapMeter(label, value, bar, basis, src, href, scale) {
    return '<li class="snap-meter"><p class="snap-row"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></p>' +
      '<div class="snap-bar" role="img" aria-label="' + esc(label + ': ' + value + ', ' + scale) + '"><span style="width:' + (bar == null ? 0 : Math.round(bar)) + '%"></span></div>' +
      '<p class="note">' + esc(basis) + ' · <a href="' + esc(href) + '">' + esc(src) + '</a></p></li>';
  }
  function snapshot() {
    var EP = global.EquityPricing, MP = global.MarketPulse;
    var ready = needScript('js/components/equity-pricing.js', function () { return !!global.EquityPricing; }) &
      needScript('js/components/market-pulse.js', function () { return !!global.MarketPulse; });
    var s = UI.load(SNAP_FILES);
    var h = '<section class="snap" id="rs-snapshot"><h2>Market data snapshot</h2>' +
      '<p class="note">Prices, risk signals, rates and CHFA dates, each read from a data file with its own date.</p>';
    if (s.error) return h + '<p class="callout">' + esc(s.error) + '</p></section>';
    if (scriptFailed('js/components/equity-pricing.js') || scriptFailed('js/components/market-pulse.js')) return h + '<p class="callout">The snapshot module did not load. The snapshot is on <a href="' + LIVE + 'insights.html">the live Research page ↗</a>.</p></section>';
    if (!s.data || !ready || !EP || !MP) return h + '<p class="note">Loading the market snapshot…</p></section>';
    var d = s.data;
    // Credit pricing: QoQ and YoY only where the history ends on the printed quarter at the printed prices.
    var c = EP.current(d.bench), same = EP.agrees(d.bench, d.hist), bm = (d.bench && d.bench.meta) || {};
    var priceRow = function (label, key) {
      return '<tr><th scope="row">' + esc(label) + '</th><td class="num"><strong>' + esc(EP.money(c[key])) + '</strong></td><td class="num">' +
        esc(EP.pct(same ? EP.change(d.hist, key, 1) : null)) + '</td><td class="num">' + esc(EP.pct(same ? EP.change(d.hist, key, 4) : null)) + '</td></tr>';
    };
    var pricing = '<div class="snap-card"><h3>Credit pricing analysis</h3>' +
      '<p class="note">Equity price per $1 of credit: the Colorado median, with national averages as a market reference' + (c && c.asOf ? '. As of ' + esc(c.asOf) + (c.vintage ? ' (' + esc(snapQuarter(c.vintage)) + ')' : '') : '') + '.</p>' +
      (c ? '<div class="table-scroll" role="region" aria-label="Credit pricing" tabindex="0"><table class="snap-table"><thead><tr><th scope="col">Credit type</th><th scope="col" class="num">Price</th><th scope="col" class="num" title="Change from the quarter before">QoQ</th><th scope="col" class="num" title="Change from a year before">YoY</th></tr></thead><tbody>' +
        priceRow('Colorado median, all credits', 'co') + priceRow('9% competitive (national, market reference)', 'nine') + priceRow('4% bond-financed (national, market reference)', 'four') + '</tbody></table></div>' +
        '<p class="note">Novogradac publishes Colorado as one median across credit types, with no history here, so its QoQ and YoY read n/a.</p>'
        : '<p class="callout">Pricing could not be read from the pricing file.</p>') +
      '<p class="metric-source">Source: <a href="' + esc(bm.source_url || 'https://www.novoco.com/') + '">' + esc(bm.source || 'Novogradac LIHTC equity pricing') + '</a>' +
      (bm.next_expected_update ? '. Next update expected ' + esc(bm.next_expected_update) : '') + '. Colorado and regional prices: <a href="#/equity-pricing">Tax credit equity markets</a>.</p></div>';
    // Risk indicators: unemployment and vacancy bars run 0 to 10%; foreclosure is a share of the 2010 peak.
    var r = MP.risk(d.fred, d.vacancy, d.foreclosure), v = r.vacancy, f = r.foreclosure;
    var vb = []; if (v.vintage) vb.push(v.vintage.replace('-', ' ')); vb.push('stabilized, metro');
    if (v.priorQuarter != null) vb.push(snapPct(v.priorQuarter) + ' last quarter'); if (v.yearAgo != null) vb.push(snapPct(v.yearAgo) + ' a year ago');
    var fb = []; if (f.period) fb.push(snapQuarter(f.period)); fb.push('of loans in foreclosure');
    if (f.seriousDelinquency != null) fb.push(snapPct(f.seriousDelinquency) + ' seriously delinquent');
    if (f.peak != null && f.peakPeriod) fb.push('peak ' + snapPct(f.peak) + ' in ' + snapQuarter(f.peakPeriod));
    var risk = '<div class="snap-card"><h3>Risk indicators</h3><p class="note">Market health signals, each with its period and source.</p><ul class="snap-meters">' +
      snapMeter('Colorado unemployment', snapPct(r.unemployment.value), r.unemployment.bar, r.unemployment.period ? r.unemployment.period + ', Colorado statewide, seasonally adjusted' : 'Colorado statewide rate unavailable', 'BLS LAUS via FRED', 'https://fred.stlouisfed.org/series/COUR', 'bar runs 0 to 10%') +
      snapMeter('Metro Denver apartment vacancy', snapPct(v.value), v.bar, vb.join(' · '), 'AAMD Vacancy and Rent Report', v.sourceUrl || 'https://www.aamdhq.org/', 'bar runs 0 to 10%') +
      snapMeter('Colorado mortgages in foreclosure', snapPct(f.value), f.bar, fb.join(' · '), 'FHFA NMDB', f.sourceUrl || 'https://www.fhfa.gov/data/nmdb', 'bar is the share of the 2010 peak') +
      '</ul><p class="note">Unemployment refreshes daily from FRED; vacancy and foreclosure are read from COHO data files refreshed quarterly.</p></div>';
    // Rates and the next three CHFA dates a developer has to act on (decided by date, not by the file's status).
    var rates = MP.rates(d.fred), dl = MP.nextDeadlines(d.calendar, denverToday(), 3);
    var rateCard = '<div class="snap-card snap-wide"><h3>Rates and deadlines</h3><p class="note">Financing rates and CHFA’s next tax credit dates.</p>' +
      '<div class="table-scroll" role="region" aria-label="Rates" tabindex="0"><table class="snap-table"><thead><tr><th scope="col">Rate</th><th scope="col" class="num">Latest</th><th scope="col" class="num" title="Change from the value a year before, in basis points (1 bp = 0.01 percentage point)">1-year change</th><th scope="col">As of</th></tr></thead><tbody>' +
      rates.map(function (x) { return '<tr><th scope="row">' + esc(x.label) + '</th><td class="num"><strong>' + esc(snapPct(x.value, 2)) + '</strong></td><td class="num">' + esc(snapBps(x.changeBps)) + '</td><td>' + esc(snapDay(x.date)) + '</td></tr>'; }).join('') +
      '</tbody></table></div><h4>Next CHFA deadlines</h4>' +
      (dl.length ? '<ul class="snap-deadlines">' + dl.map(function (e) {
        return '<li><strong>' + esc(snapDay(e.date)) + '</strong> · ' + e.days + (e.days === 1 ? ' day' : ' days') + '<br>' + (e.url ? '<a href="' + esc(e.url) + '">' + esc(e.name) + '</a>' : esc(e.name)) + (e.draft ? ' <span class="scope-tag">Draft QAP</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="note">No upcoming CHFA deadlines are in the calendar file.</p>') +
      '<p class="metric-source">Rates: <a href="https://fred.stlouisfed.org">FRED</a> (Treasury, NY Fed, Freddie Mac)' + (rates.length && rates[0].date ? ', as of ' + esc(String(rates[0].date).slice(0, 10)) : '') + '. Deadlines: <a href="https://www.chfainfo.com/rental-housing/housing-credit/dates-and-deadlines-7a0d2c0727864a506470f2f4352cf192">CHFA Dates and Deadlines</a>; every date is on <a href="#/calendar">Deadlines and events</a>.</p></div>';
    return h + '<div class="snap-grid">' + pricing + risk + rateCard + '</div></section>';
  }

  // ---------- Research briefs ----------
  // The live site's source-reviewed briefs, from the same file (data/policy_briefs_curated.json), laid out the way
  // its brief reader lays them out: takeaway, summary, implications, the brief's own sections, then every source.
  var BRIEFS = 'data/policy_briefs_curated.json';
  var FEE_LABELS = {
    measure: { waived: ['Waived', 'The fee is not owed.'], reduced: ['Reduced', 'Part of the fee is still owed.'], reimbursed: ['Reimbursed', 'The fee is paid first, then paid back.'],
      rate_discount: ['Utility bill discount', 'A recurring bill discount, not a reduction in development costs.'], deferred: ['Deferred', 'Payment comes later; the fee is still owed.'] },
    kind: { program: ['Standing program', 'An ongoing offer, subject to its eligibility rules and approvals.'], project_award: ['Project award', 'A one-off award to a named project, not an offer to every project.'],
      repealed: ['Repealed', 'A former measure kept for the record; it is no longer offered.'] }
  };
  function briefList(feed) { return ((feed && feed.briefs) || []).filter(function (b) { return b && b.is_curated; }); }
  function longDate(v) { var t = Date.parse(v); return isNaN(t) ? null : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  // The feed is plain text: break long text every three sentences, as the live reader does, without changing a word.
  function paras(text) {
    var s = String(text || '').split(/(?<=\.)\s+(?=[A-Z])/), out = '';
    for (var i = 0; i < s.length; i += 3) out += '<p>' + esc(s.slice(i, i + 3).join(' ')) + '</p>';
    return out;
  }
  function safeHref(v) { return typeof v === 'string' && /^https?:\/\//.test(v) ? v : null; }
  function briefCard(b) {
    // The card carries the first sentence; the brief opens with the whole takeaway.
    var lede = String(b.takeaway || b.summary || '').split(/(?<=\.)\s+(?=[A-Z])/)[0];
    return '<a class="hub-card research-card" href="#/research/brief/' + esc(encodeURIComponent(b.id)) + '"><span class="page-kind">' + esc(b.source_reviewed ? 'Source-reviewed brief' : 'Research brief') + '</span>' +
      '<span class="hub-card-title">' + esc(b.title) + '</span><span class="hub-card-desc">' + esc(lede) + '</span>' +
      '<span class="research-meta">' + esc([b.policy_topic, longDate(b.generated) && 'Published ' + longDate(b.generated)].filter(Boolean).join(' · ')) + '</span></a>';
  }
  function feeSection(fees) {
    var co = fees.entries.filter(function (e) { return e.state === 'CO'; });
    var once = co.filter(function (e) { return e.recurrence === 'one_time'; });
    var table = function (field, caption) {
      return '<div class="table-scroll"><table><caption>' + esc(caption) + '</caption><thead><tr><th scope="col">Type and meaning</th><th scope="col" class="num">Records</th></tr></thead><tbody>' +
        Object.keys(FEE_LABELS[field]).map(function (k) {
          var d = FEE_LABELS[field][k];
          return '<tr><th scope="row">' + esc(d[0]) + '<span class="brief-def">' + esc(d[1]) + '</span></th><td class="num">' + co.filter(function (e) { return e[field] === k; }).length + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    };
    var gaps = (fees.meta && fees.meta.known_gaps) || [];
    return '<section id="brief-dataset"><h2>What the dataset contains</h2><p><strong>' + co.length + '</strong> Colorado fee records, including project awards and repealed measures. Land-use incentives are separate and are not counted here.</p>' +
      table('measure', 'How the fee changes') + table('kind', 'What kind of record it is') +
      '<p><strong>' + once.filter(function (e) { return e.eligibility && e.eligibility.by_right === false; }).length + '</strong> of <strong>' + once.length + '</strong> one-time Colorado fee measures require discretionary approval: the benefit is not automatic even when a project meets the stated eligibility rules.</p>' +
      '<p><strong>' + co.filter(function (e) { return e.backfill && e.backfill.method === 'not_specified'; }).length + '</strong> of <strong>' + co.length + '</strong> Colorado fee measures do not specify how forgone fee revenue is replaced. This does not mean no replacement funding exists.</p>' +
      '<p>Plus ' + (fees.entries.length - co.length) + ' out-of-state comparison records, not counted above.</p></section>' +
      '<section id="brief-limitations"><h2>Screening limitations</h2><p>What a jurisdiction offers is not what a project has been awarded. A deferral is still owed. A jurisdiction with no entry has not been researched or has no verified entry; that does not mean it has no program.</p>' +
      '<p>Showing ' + Math.min(5, gaps.length) + ' of ' + gaps.length + ' known gaps.</p><ul>' + gaps.slice(0, 5).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul></section>';
  }
  function briefSections(b) {
    return (Array.isArray(b.sections) ? b.sections : []).map(function (it) {
      if (!it || typeof it.heading !== 'string') return '';
      var h = '<section id="brief-section-' + esc(it.id) + '"><h2>' + esc(it.heading) + '</h2>' + (it.paragraphs || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
      if (Array.isArray(it.items) && it.items.length) h += (it.items_heading ? '<h3>' + esc(it.items_heading) + '</h3>' : '') + '<ul>' + it.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (it.map === 'transit-zone-screen') h += '<p class="note">The live brief draws the transit-stop screen on a map here. A transit-stop screen is not a zone designation; only OEDIT’s Transit and Housing Investment Zone map decides eligibility.</p>';
      var t = it.table;
      if (t && Array.isArray(t.columns) && Array.isArray(t.rows)) {
        h += '<div class="table-scroll"><table class="brief-text-table">' + (t.caption ? '<caption>' + esc(t.caption) + '</caption>' : '') + '<thead><tr>' + t.columns.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          t.rows.map(function (r) { return '<tr>' + (Array.isArray(r) ? r : []).map(function (c, i) { return i ? '<td>' + esc(String(c)) + '</td>' : '<th scope="row">' + esc(String(c)) + '</th>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      }
      var st = it.steps;
      if (st && Array.isArray(st.items) && st.items.length) {
        h += '<figure class="brief-steps">' + (st.caption ? '<figcaption>' + esc(st.caption) + '</figcaption>' : '') + '<ol>' + st.items.filter(function (x) { return x && typeof x.label === 'string'; }).map(function (x) {
          return '<li>' + (x.level ? '<span class="brief-step-level">' + esc(x.level) + '</span> ' : '') + '<strong>' + esc(x.label) + '</strong>' + (x.text ? ' ' + esc(x.text) : '') + '</li>';
        }).join('') + '</ol><p class="brief-steps-ends" aria-hidden="true"><span>More public</span><span>More private</span></p></figure>';
      }
      if (it.see_also && typeof it.see_also.text === 'string') h += '<p class="note">' + esc(it.see_also.text) + '</p>';
      if (it.note) h += '<p class="note">' + esc(it.note) + '</p>';
      return h + '</section>';
    }).join('');
  }
  function brief(id) {
    var s = UI.load({ feed: BRIEFS });
    var crumbs = T.trail('policy', 'Research overview').concat([]);
    if (s.error) return T.head({ kind: 'guide', crumbs: crumbs, title: 'Research brief' }) + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return T.head({ kind: 'guide', crumbs: crumbs, title: 'Research brief' }) + '<p role="status" class="note">Loading the brief…</p>';
    var b = briefList(s.data.feed).filter(function (x) { return x.id === id; })[0];
    if (!b) return T.head({ kind: 'guide', crumbs: crumbs, title: 'Brief not found' }) + '<p>This research brief is not in the list. <a href="#/research">All research</a></p>';
    var fees = null;
    if (b.related_data === 'data/policy/fee-reductions.json') {
      var f = UI.load({ fees: 'data/policy/fee-reductions.json' });
      if (f.error) return T.head({ kind: 'guide', crumbs: crumbs, title: b.title }) + '<p class="callout">' + esc(f.error) + '</p>';
      if (!f.data) return T.head({ kind: 'guide', crumbs: crumbs, title: b.title }) + '<p role="status" class="note">Loading the fee records…</p>';
      fees = f.data.fees;
    }
    var meta = ['Published ' + (longDate(b.generated) || 'date unavailable')];
    var checked = fees ? fees.meta && fees.meta.as_of : b.verified;
    if (checked && longDate(checked)) meta.push('Data verified ' + longDate(checked));
    var arts = Array.isArray(b.articles) ? b.articles : [];
    return T.head({ kind: 'brief', crumbs: crumbs, title: b.title, meta: esc([b.policy_topic].concat(meta).filter(Boolean).join(' · ')) }) +
      '<article class="guide-body brief">' +
      '<section id="brief-takeaway" class="brief-takeaway"><h2>Takeaway</h2><p>' + esc(b.takeaway || String(b.summary || '').split(/(?<=\.)\s+(?=[A-Z])/).slice(0, 2).join(' ')) + '</p></section>' +
      '<section id="brief-summary"><h2>Summary</h2>' + paras(b.summary) + '</section>' +
      '<section id="brief-implications"><h2>Practical implications</h2>' + paras(b.implications) + '</section>' +
      briefSections(b) + (fees ? feeSection(fees) : '') +
      '<section id="brief-sources">' + T.fold('Sources', esc(arts.length + (arts.length === 1 ? ' source' : ' sources') + ', each linked to the original.'), '<ol class="brief-sources">' + arts.map(function (a) {
        var href = safeHref(a.link), t = esc(a.title || a.link || 'Source');
        return '<li>' + (href ? '<a href="' + esc(href) + '">' + t + '</a>' : t + ' (link unavailable)') + ([a.source, a.date].filter(Boolean).length ? '<span class="research-meta">' + esc([a.source, a.date].filter(Boolean).join(' · ')) + '</span>' : '') + '</li>';
      }).join('') + '</ol>') + '</section></article>' +
      T.next('Next', [{ href: '#/research', label: 'All research →' }, { href: '#/news', label: 'Housing news', secondary: true }]);
  }

  function research(params, parts) {
    if (parts && parts[1] === 'brief') return brief(decodeURIComponent(parts[2] || ''));
    var s = UI.load({ cat: 'data/insights/catalog.json', feed: BRIEFS });
    var head = T.head({
      kind: 'hub', crumbs: T.trail('policy', 'Research overview'), title: 'Research overview',
      answer: 'COHO’s analysis, papers and reference on Colorado affordable housing, each with its date and what it draws on.'
    });
    if (s.error) return head + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return head + '<p role="status" class="note">Loading the research list…</p>';
    var all = s.data.cat.entries;
    var secs = (s.data.cat.meta && s.data.cat.meta.sections || []).map(function (x) { return [x.key, x.label, x.note]; });
    if (!secs.length) secs = SECTIONS;
    var briefs = briefList(s.data.feed).slice().sort(function (a, b) { return String(b.generated || '').localeCompare(String(a.generated || '')); });
    return head + (briefs.length ? '<h2>Research briefs</h2><p class="note">Source-reviewed briefs on federal and Colorado housing policy, each linked to the laws and documents it reads.</p><div class="research-cards">' + briefs.map(briefCard).join('') + '</div>' : '') + secs.map(function (sec) {
      var items = all.filter(function (e) { return e.section === sec[0]; });
      if (!items.length) return '';
      return '<h2>' + esc(sec[1]) + '</h2>' + (sec[2] ? '<p class="note">' + esc(sec[2]) + '</p>' : '') + '<div class="research-cards">' + items.map(function (e) {
        var lab = LAB_ROUTE[e.url], href = lab || LIVE + e.url;
        var dated = e.updated ? 'Updated ' + e.updated : e.published ? 'Published ' + e.published : KEEP[e.maintenance] || '';
        return '<a class="hub-card research-card' + (lab ? '' : ' is-live') + '" href="' + esc(href) + '"><span class="page-kind">' + esc(e.type) + '</span>' +
          '<span class="hub-card-title">' + esc(e.title) + (lab ? '' : ' <span class="live-tag">live site ↗</span>') + '</span>' +
          '<span class="hub-card-desc">' + esc(e.summary) + '</span>' +
          '<span class="research-meta">' + esc([dated, (e.sources || []).slice(0, 4).join(', ')].filter(Boolean).join(' · ')) + '</span></a>';
      }).join('') + '</div>';
    }).join('') + snapshot() +
      T.source('COHO research catalog', LIVE + 'insights.html', s.data.cat.meta && s.data.cat.meta.updated) +
      T.next('Next', [{ href: '#/equity-pricing', label: 'Tax credit prices now →' }, { href: '#/news', label: 'Housing news', secondary: true }]);
  }

  // The live module links its summary to "#ballot-coverage", which the lab's router would read as a page:
  // open the coverage table and scroll to it instead.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href="#ballot-coverage"]');
    var sec = a && document.getElementById('ballot-coverage');
    if (!sec) return;
    ev.preventDefault();
    var d = sec.querySelector('details'); if (d) d.open = true;
    sec.scrollIntoView({ block: 'start' });
  });

  // Picking in the flow redraws in place: the page keeps its scroll and focus stays on what was picked.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('.money-flow a[data-flow]');
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    ev.preventDefault();
    var key = a.getAttribute('data-flow'), y = global.scrollY;
    history.replaceState(null, '', a.getAttribute('href'));
    Shell.render();
    var again = Array.prototype.filter.call(document.querySelectorAll('.money-flow a[data-flow="' + (key || '').replace(/"/g, '\\"') + '"]'), function (x) { return x.getClientRects().length; })[0] ||
      document.querySelector('.money-flow .flow-pick a, .money-flow a[data-flow]');
    if (again) again.focus({ preventScroll: true });
    global.scrollTo(0, y);
  });

  // Housing news (site/policy.js) gains the live page's "Related datasets" links, set just above its Next box.
  // Added from here so the news page itself stays with its own file.
  var NEWS_RELATED = [
    ['#/digest', 'Sunday digest', 'This week in Colorado housing news, every item linked to its source.'],
    ['#/places/deep-dive', 'Colorado deep dive', 'Tax credit projects, QCTs and DDAs by county.'],
    ['#/places', 'Housing needs assessment', 'Housing need for any Colorado place.'],
    ['#/market', 'Market check', 'Renters, rents, supply and a capture rate for a place. The full market analysis is for members.']
  ];
  var newsBase = Shell.views.news;
  if (newsBase) Shell.views.news = function () {
    var html = newsBase.apply(this, arguments), at = html.lastIndexOf('<aside class="next-box"');
    if (at < 0) return html;
    return html.slice(0, at) + '<section class="news-related" id="nw-related"><h2>Related datasets</h2><div class="research-cards">' + NEWS_RELATED.map(function (l) {
      return '<a class="hub-card" href="' + esc(l[0]) + '"><span class="hub-card-title">' + esc(l[1]) + '</span><span class="hub-card-desc">' + esc(l[2]) + '</span></a>';
    }).join('') + '</div></section>' + html.slice(at);
  };

  // ---------- Sunday digest ----------
  // The live page's weekly digest (data/news-digest/), drawn with the live page's own escape-first Markdown
  // reader (js/sunday-digest.js, window.SundayDigest.render). Published on both sites; dated by edition.
  var DIGEST = { idx: 'data/news-digest/index.json' };
  var digestMd = {}, digestJs = null;
  function digestReader() {
    if (global.SundayDigest) return global.SundayDigest;
    if (!digestJs) {
      digestJs = document.createElement('script');
      digestJs.src = VENDOR + 'js/sunday-digest.js';
      digestJs.onload = function () { Shell.render(); };
      document.body.appendChild(digestJs);
    }
    return null;
  }
  function digestText(file) {
    if (!digestMd[file]) {
      digestMd[file] = { text: null, error: null };
      fetch(VENDOR + file).then(function (r) { if (!r.ok) throw new Error(file + ' ' + r.status); return r.text(); })
        .then(function (t) { digestMd[file].text = t; Shell.render(); })
        .catch(function (e) { digestMd[file].error = 'The edition did not load (' + e.message + ').'; Shell.render(); });
    }
    return digestMd[file];
  }
  function digest(params) {
    var crumbs = T.trail('policy', 'Sunday digest');
    var s = UI.load(DIGEST);
    var head0 = function (meta) { return T.head({ kind: 'data', crumbs: crumbs, title: 'Sunday digest', answer: 'The week in Colorado affordable housing news: state programs, Prop 123, local actions, disasters, federal funding and the market. Every item links to its source.', meta: meta }); };
    if (s.error) return head0() + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return head0() + '<p role="status" class="note">Loading the digest…</p>';
    var eds = (s.data.idx.editions || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!eds.length) return head0() + '<p>No edition has been published yet.</p>';
    var want = params.get('date'), ed = eds.filter(function (e) { return e.date === want; })[0] || eds[0];
    var stamp = '<span class="scope-tag">Colorado</span> Week of ' + esc(longDate(ed.window_start)) + ' to ' + esc(longDate(ed.window_end)) + ' · Prepared ' + esc(longDate(ed.date));
    var md = digestText(ed.file), R = digestReader();
    var body;
    if (md.error) body = '<p class="callout">' + esc(md.error) + '</p>';
    else if (md.text == null || !R) body = '<p role="status" class="note">Loading the edition…</p>';
    else {
      var lines = md.text.split('\n'), h1 = lines.findIndex(function (l) { return /^#\s+/.test(l); });
      if (h1 >= 0) lines.splice(h1, 1);
      body = '<div class="guide-body digest-body">' + R.render(lines.join('\n')) + '</div>';
    }
    return head0(stamp) +
      '<article id="dg-edition" aria-label="' + esc(ed.title) + '"><h2>' + esc(ed.title) + '</h2>' + body + '</article>' +
      (eds.length > 1 ? '<section id="dg-past"><h2>Earlier editions</h2><ul>' + eds.map(function (e) {
        return '<li><a href="#/digest?date=' + esc(e.date) + '"' + (e.date === ed.date ? ' aria-current="page"' : '') + '>' + esc(longDate(e.window_start)) + ' to ' + esc(longDate(e.window_end)) + '</a></li>';
      }).join('') + '</ul></section>' : '') +
      T.source('COHO Sunday digest, written from official releases and checked newsrooms', LIVE + 'sunday-digest.html?date=' + ed.date, s.data.idx.meta && s.data.idx.meta.updated) +
      T.next('Next', [{ href: '#/news', label: 'All headlines →' }, { href: '#/calendar', label: 'Deadlines and events', secondary: true }]);
  }

  Shell.views.elections = elections;
  Shell.views.digest = digest;
  Shell.views.money = moneyPage;
  Shell.views.research = research;
  global.LabPolicyMore = { ballotSummary: ballotSummary, BALLOT_FILES: BALLOT_FILES, elections: elections, money: moneyPage, research: research, LAB_ROUTE: LAB_ROUTE, ELECTION: ELECTION };
})(window);
