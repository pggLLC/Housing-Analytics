// Guide template: a written page from the live site, word for word, set in the lab's design.
// The text comes from site/guides/<slug>.json (scripts/build-guide-pages.js); the lab adds the
// page head, the key facts with their sources, a contents list, one diagram and the Next box.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl;
  var esc = Shell.esc;
  var cache = {};

  // Per guide: where it sits, its key facts (each quoted from the guide, with the guide's own source),
  // and where to go next. Facts and the diagram are the lab's additions and say so on the page.
  var GUIDES = {
    'lihtc-basics': {
      menu: 'deal',
      facts: [
        { value: 'About $90K/yr', label: '9% credit for each $1M of eligible basis, for 10 years', source: 'IRC §42(b)', href: 'https://www.law.cornell.edu/uscode/text/26/42' },
        { value: 'About $40K/yr', label: '4% credit for each $1M of eligible basis, for 10 years', source: 'IRC §42(b)', href: 'https://www.law.cornell.edu/uscode/text/26/42' },
        { value: '14 of 32', label: '9% applications CHFA funded in 2026', source: 'CHFA applicant and award reports', href: 'https://www.chfainfo.com/rental-housing/housing-credit/awards' },
        { value: '9 of 21', label: '4% + state credit applications CHFA funded in Round Two, 2025 (2026 awards pending)', source: 'CHFA applicant and award reports', href: 'https://www.chfainfo.com/rental-housing/housing-credit/awards' },
        { value: '30 years', label: 'Colorado minimum affordability (15 compliance + 15 extended use)', source: 'CHFA QAP', href: 'https://www.chfainfo.com/rental-housing/housing-credit/qualified-allocation-plan' }
      ],
      diagram: function (g) { return partners() + payStack(g) + creditCompare(g); },
      // What a newcomer needs stays open; every other panel folds shut behind a one-line summary.
      // Keys are section id / panel number. The summaries are the lab's, from each panel's own text.
      open: ['key-concepts/0', 'key-concepts/1'],
      fold: {
        'developers/0': 'The timeline phase by phase, from site and market study through construction, lease-up and compliance.',
        'developers/1': 'A sample $25M, 100-home budget: tax credit equity covers 56% and the permanent loan 30%.',
        'key-concepts/2': 'An award does not guarantee closing. The risks that stall Colorado deals, such as water supply, with the Colorado rule behind each.',
        'key-concepts/3': 'Credits become cash when a syndicator sells them to investors; the price per credit dollar sets the equity.',
        'key-concepts/4': 'Colorado\u2019s state credit (HB 24-1434) adds a second equity layer on top of the federal credit.',
        'key-concepts/5': 'Two podcasts for keeping current: Tax Credit Tuesday and UCLA Housing Voice.',
        'housing-authorities/0': 'CHFA writes the QAP, scores applications and runs two competitive rounds a year: 9% with state credit in Round One (applications February 1, 2027) and 4% with state credit in Round Two (August 2, 2027). The 2027–28 caps and gap money for both rounds.',
        'housing-authorities/1': 'The largest scoring lines for CHFA\u2019s 2027 Round One, led by low-income targeting.',
        'investors/0': 'What investors get: credits over 10 years, depreciation and a passive ownership share.',
        'investors/1': 'A numbered checklist, starting with the development team and the market and site.',
        'investors/2': '2026 pricing: $0.82 national for 9%, $0.83 for 4%, $0.81 Colorado median (Novogradac 2026-Q2).',
        'resources/0': 'Related COHO pages and outside sources: Novogradac, HUD, NCSHA and others.'
      },
      next: [{ href: '#/deal-calculator', label: 'Test a LIHTC deal in the Deal Calculator →' }, { href: '#/guide/deal-team', label: 'Who does what on a deal', secondary: true }]
    },
    // Article pages copied word for word by scripts/build-guide-pages.js (mode 'h2'). No facts strip: a fact
    // would have to quote the page, and these pages lead with their own short answer.
    'deal-team': { menu: 'deal', inserts: { 'dt-cra': function (html, params) { return global.LabCra ? global.LabCra.insert(html, params) : html; } }, diagram: cardsFrom({ from: 'dt-team', rows: true, title: 'Who works for whom on a deal', max: 9 }), introTitle: 'In short', next: [{ href: '#/guide/lihtc-basics', label: 'LIHTC basics \u2192' }, { href: '#/deal-calculator', label: 'Test a LIHTC deal', secondary: true }] },
    // Part of the live Deal Calculator page: its reading sections, below the calculator there.
    'deal-reading': { menu: 'deal', diagram: cardsFrom({ from: 'what-makes-lihtc-deals-actually-hard', title: 'What makes LIHTC deals hard' }), introTitle: 'In short', next: [{ href: '#/deal-calculator', label: 'Back to the Deal Calculator \u2192' }, { href: '#/guide/lihtc-basics', label: 'LIHTC basics', secondary: true }] },
    'green-building': { menu: 'deal', diagram: cardsFrom({ from: 'gb-requirements', title: 'What CHFA requires of every project' }), introTitle: 'In short', next: [{ href: '#/deal-calculator', label: 'Test a LIHTC deal \u2192' }, { href: '#/guide/lihtc-basics', label: 'LIHTC basics', secondary: true }] },
    'resident-services': { menu: 'deal', diagram: cardsFrom({ from: 'rs-how', kind: 'flow', title: 'How services help, step by step' }), introTitle: 'In short', next: [{ href: '#/guide/deal-team', label: 'Who does what on a deal \u2192' }, { href: '#/deal-calculator', label: 'Test a LIHTC deal', secondary: true }] },
    'cra-pricing': { menu: 'deal', diagram: craBars, introTitle: 'In short', next: [{ href: '#/deal-calculator', label: 'Test equity prices in the Deal Calculator \u2192' }, { href: '#/guide/deal-team', label: 'Which banks invest', secondary: true }] },
    'ahcia': { menu: 'policy', diagram: cardsFrom({ from: 'key-provisions-impacting-lihtc-productio', title: 'The key provisions for tax credit production' }), introTitle: 'In short', next: [{ href: '#/equity-pricing', label: 'What credits sell for now \u2192' }, { href: '#/guide/lihtc-basics', label: 'LIHTC basics', secondary: true }] },
    'fair-housing': { menu: 'policy', diagram: cardsFrom({ from: 'what-is-changing-and-what-is-not', title: 'What survives, and what has gone' }), introTitle: 'In short', next: [{ href: '#/places', label: 'See a place\u2019s needs \u2192' }, { href: '#/guide/housing-authority', label: 'Starting a housing authority', secondary: true }] },
    // Read from the live page at a newer commit than the pin (latest: true in the build); it has no intro before its first heading.
    'federal-rules': { menu: 'policy', next: [{ href: '#/legislation', label: 'Laws COHO tracks \u2192' }, { href: '#/guide/fair-housing', label: 'Fair housing', secondary: true }] },
    'housing-authority': { facts: [{ value: '3', label: 'Ways to form one: city or town, county, or joint', source: 'C.R.S. 29-4 and 29-1-204.5', href: 'https://leg.colorado.gov/colorado-revised-statutes' }, { value: 'Up to 11', label: 'Commissioners on a county authority (up to 9 for a city or town)', source: 'C.R.S. 29-4-204, 29-4-504', href: 'https://leg.colorado.gov/colorado-revised-statutes' }, { value: 'Up to 1%', label: 'Sales or use tax a joint authority can levy with voter approval, or up to 5 mills', source: 'C.R.S. 29-1-204.5', href: 'https://leg.colorado.gov/colorado-revised-statutes' }], menu: 'policy', diagram: cardsFrom({ from: 'ha-routes', rows: true, title: 'Three ways to form a housing authority' }), introTitle: 'In short', next: [{ href: '#/places', label: 'Check your place\u2019s needs \u2192' }, { href: '#/guide/deal-team', label: 'Who does what in a deal', secondary: true }] },
    'white-paper': { menu: 'policy', download: true, diagram: cardsFrom({ from: 'five-questions-and-why-they-are-different', kind: 'flow', title: 'Five questions, in the order the site asks them', max: 5 }), introTitle: 'In short', next: [{ href: '#/guide/working-paper', label: 'The working paper \u2192' }, { href: '#/places', label: 'Find a place', secondary: true }] },
    'working-paper': { menu: 'policy', download: true, diagram: cardsFrom({ from: '05-policy-decisions-and-why', title: 'The policy decisions behind the site' }), introTitle: 'In short', next: [{ href: '#/guide/white-paper', label: 'The white paper \u2192' }, { href: '#/places', label: 'Find a place', secondary: true }] },
    'methods': { menu: 'data', diagram: cardsFrom({ from: '10-why-this-method-and-not-another', title: 'Why this method and not another' }), introTitle: 'In short', next: [{ href: '#/data/sources', label: 'Every source and how fresh it is \u2192' }, { href: '#/places', label: 'See the numbers for a place', secondary: true }] },
    // The renter page sits under Housing help, which is not one of the five menus.
    'renter-help': { facts: [{ value: '2-1-1', label: 'Shelter, food and rent help; or text your ZIP code to 898-211', source: '2-1-1 Colorado', href: 'https://www.211colorado.org/' }, { value: '1-844-926-6632', label: 'Evictions and lease questions', source: 'Colorado Housing Connects', href: 'https://coloradohousingconnects.org/' }, { value: '(303) 838-1200', label: 'Behind on rent with an eviction notice: CARE Center, weekdays 8:30 to 5:30', source: 'Division of Housing', href: 'https://doh.colorado.gov/emergency-rental-assistance' }], diagram: cardsFrom({ from: 'start-here', kind: 'phones', title: 'Who to call' }), crumbs: [{ label: 'Home', href: '#/' }, { label: 'Housing help', href: '#/assistance' }], introTitle: 'In short', next: [{ href: '#/assistance', label: 'Help to buy or keep a home \u2192' }, { href: '#/places', label: 'Housing need in your town', secondary: true }] },
    // The full homebuyer page: every program card (open, expired and proposed) and the local help list, as its own
    // page draws them from the site's program file. Housing help (#/assistance) is the short way in.
    'homebuyer-help': { crumbs: [{ label: 'Home', href: '#/' }, { label: 'Housing help', href: '#/assistance' }], introTitle: 'Start here', next: [{ href: '#/assistance', label: 'All housing help \u2192' }, { href: '#/for-sale', label: 'What a household can afford to buy', secondary: true }] },
    'about': { menu: 'data', diagram: cardsFrom({ from: 'core-sources', title: 'Where the data comes from' }), introTitle: 'In short', next: [{ href: '#/guide/methods', label: 'How the numbers are made \u2192' }, { href: '#/data/sources', label: 'Data sources', secondary: true }] },
    // Written by the lab (no live page has this), from the primary sources each section links.
    'preservation': {
      menu: 'opportunities', introTitle: 'Why it matters',
      facts: [
        { value: 'Nearly 21,000', label: 'Restricted rental homes whose restrictions end in the next 15 years (Dec 2024)', source: 'CHFA, Preservation', href: 'https://www.chfainfo.com/rental-housing/preservation' },
        { value: '40 years', label: 'Minimum affordability after a local government buys under HB24-1175', source: 'HB24-1175', href: 'https://content.leg.colorado.gov/sites/default/files/2024a_1175_signed.pdf' },
        { value: '120 days', label: 'For mobile home park residents to make an offer after notice', source: 'Division of Housing', href: 'https://doh.colorado.gov/sell-a-park' },
        { value: '243 homes', label: 'Preserved by CHFA\u2019s CAHP fund as of Sept 2024', source: 'CHFA, CAHP', href: 'https://www.chfainfo.com/rental-housing/multifamily-lending/affordable-housing-preservation-fund' }
      ],
      next: [{ href: '#/opportunity/preservation', label: 'Preservation inventory \u2192' }, { href: '#/deal-calculator', label: 'Test an acquisition and rehab deal', secondary: true }]
    },
    // Written by the lab from the primary sources each section links. The chart of towns is drawn from the
    // public site's LODES commute file; the capture bars are A Line Flats' own figures in CHFA's narratives.
    'commuters-capture': {
      menu: 'policy', introTitle: 'In short',
      facts: [
        { value: '85%', label: 'Capture rate above which CHFA wants more data to support demand', source: 'CHFA 2027-28 QAP, p. 9', href: 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf' },
        { value: '65%', label: 'Share of Durango\u2019s primary jobs held by people who live outside the city (2024)', source: 'LEHD LODES 2024', href: 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/' },
        { value: '61%', label: 'Summit County in-commuters surveyed who would make a trade-off to live in the county', source: 'Summit County 2023 HNA, V-60', href: 'https://www.friscogov.com/wp-content/uploads/2026/04/Attachment-1_2023-Summit-County-Housing-Needs-Assessment.pdf' },
        { value: '26.3% \u2192 21.0%', label: 'A Line Flats capture rate before and after a 25% in-migration adjustment', source: 'CHFA 2025 Round Two narratives, p. 12', href: 'https://www.chfainfo.com/getattachment/7441af58-7dec-46d2-abab-1b5ac8f19575/2025-HTC-Round-Two-Application-Narratives.pdf' }
      ],
      diagram: commuterCharts,
      next: [{ href: '#/opportunity/commuting', label: 'Commuting and jobs by town \u2192' }, { href: '#/market', label: 'Run a market study', secondary: true }]
    }
  };

  // Commuters and capture rates: a published capture rate with and without in-migration, then the share of
  // jobs held by in-commuters in Colorado job centers, computed from the LODES file the commuting page reads.
  var COMMUTE_TOWNS = ['Aspen (city)', 'Bayfield (town)', 'Breckenridge (town)', 'Buena Vista (town)', 'Durango (city)', 'Estes Park (town)', 'Glenwood Springs (city)',
    'Gunnison (city)', 'Montrose (city)', 'Pagosa Springs (town)', 'Salida (city)', 'Steamboat Springs (city)', 'Telluride (town)'];
  function commuterCharts() {
    var Viz = global.LabViz, UI = global.LabUI;
    if (!Viz || !Viz.orderedBars || !UI) return '';
    var pct = function (v) { return v.toFixed(1) + '%'; };
    var out = Viz.orderedBars({ title: 'A Line Flats, Denver: capture rate before and after in-migration', answer: 'Counting tenants expected from outside the market area lowered the rate by about a fifth.',
      rows: [['Renters in the market area only', 26.3], ['With 25% in-migration', 21.0]], noShare: true, color: 'var(--c-blue)', fmt: pct,
      source: 'CHFA 2025 Round Two Housing Tax Credit application narratives, p. 12' });
    var s = UI.load({ commute: 'data/market/commute-strength.json' });
    if (s.error) return out + '<p class="note">' + esc(s.error) + '</p>';
    if (!s.data) return out + '<p role="status" class="note">Loading the commute counts\u2026</p>';
    var places = s.data.commute.places, rows = [];
    Object.keys(places).forEach(function (k) {
      var p = places[k];
      if (COMMUTE_TOWNS.indexOf(p.name) > -1 && p.jobs) rows.push([p.name.replace(/ \((city|town)\)$/, ''), Math.round(p.in_commuters / p.jobs * 1000) / 10]);
    });
    rows.sort(function (a, b) { return b[1] - a[1]; });
    return out + Viz.orderedBars({ title: 'Share of a town\u2019s primary jobs held by people who live outside it, 2023', answer: 'In most of these job centers, more than half the jobs go to people who drive in.',
      rows: rows, noShare: true, color: 'var(--c-green)', fmt: pct, source: 'LEHD LODES 2024, primary jobs, Colorado homes only (' + esc(s.data.commute.meta.lodes_year) + ' file, COHO copy)' });
  }

  // The guide's three parties and what passes between them, drawn from its own sentences:
  // "The housing agency awards the credits. The developer builds and operates the housing.
  // The investor turns the credits into upfront money."
  function partners() {
    return '<figure class="lab-diagram" aria-labelledby="partners-cap">' +
      '<svg viewBox="0 0 720 300" role="img" aria-label="The housing agency awards credits to the project; the investor pays cash for them; the developer builds and runs the homes.">' +
      box(260, 20, 200, 64, 'The housing agency', 'In Colorado, CHFA') +
      box(260, 200, 200, 76, 'The project', 'The developer builds and operates the housing', true) +
      box(20, 200, 180, 76, 'The investor', 'A bank, insurer or large business') +
      box(520, 200, 180, 76, 'Residents', 'Homes at affordable rents') +
      arrow('M360 84 L360 196', 'awards the credits', 372, 145, 'start') +
      arrow('M200 222 L256 222', 'cash up front', 228, 194, 'middle') +
      arrow('M256 258 L200 258', 'credits over time', 228, 294, 'middle') +
      arrow('M460 238 L516 238', 'homes', 488, 228, 'middle') +
      '</svg>' +
      // Phones get the same parties and flows as a stacked list: real text at body size, no sideways scroll.
      '<ol class="dg-stack">' +
      stackBox('The housing agency', 'In Colorado, CHFA') +
      stackFlow('\u2193', 'awards the credits') +
      stackBox('The project', 'The developer builds and operates the housing', true) +
      stackFlow('\u2193', 'homes') +
      stackBox('Residents', 'Homes at affordable rents') +
      '</ol>' +
      '<ol class="dg-stack dg-stack--then">' +
      stackBox('The investor', 'A bank, insurer or large business') +
      stackFlow('\u2191', 'pays the project cash up front and gets the credits over time') +
      '</ol>' +
      '<figcaption id="partners-cap">Source: IRC §42; CHFA 2026 Qualified Allocation Plan. The cash lowers the debt the project carries, which is what makes lower rents possible.</figcaption></figure>';
  }
  // How a tax credit deal is paid for (Gemini round 5, q16): the guide's own sample sources table drawn as one
  // stacked bar. Read from the page's table so the picture never says something the table does not.
  function sampleSources(g) {
    var html = (g && g.sections || []).map(function (x) { return x.html || ''; }).join(' ');
    var at = html.indexOf('Example Sources of Funds'); if (at < 0) return null;
    var end = html.indexOf('TOTAL SOURCES', at); if (end < 0) return null;
    var rows = [], re = /<tr>([\s\S]*?)<\/tr>/g, m, part = html.slice(at, end);
    while ((m = re.exec(part))) {
      var td = (m[1].match(/<td>[\s\S]*?<\/td>/g) || []).map(function (c) { return c.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); });
      var amt = td[1] && td[1].match(/\$([\d.]+)M/), pct = td[2] && td[2].match(/(\d+)%/);
      if (td.length >= 3 && amt && pct) rows.push({ name: td[0], m: +amt[1], pct: +pct[1] });
    }
    var tot = html.slice(at).match(/\$([\d.]+)M budget/);
    return rows.length >= 3 ? { rows: rows, total: tot ? +tot[1] : rows.reduce(function (t, r) { return t + r.m; }, 0) } : null;
  }
  var STACK_CLASS = ['ps-eq', 'ps-loan', 'ps-fee', 'ps-gap', 'ps-gap'];
  function payStack(g) {
    var d = sampleSources(g); if (!d) return '';
    var big = d.rows[0];
    return '<figure class="pay-stack" aria-labelledby="ps-cap"><figcaption id="ps-cap"><strong>In this sample, tax credit equity pays ' + big.pct + '% of a $' + d.total + 'M, 100-home project</strong></figcaption>' +
      '<div class="ps-bar" role="img" aria-label="' + esc(d.rows.map(function (r) { return r.name + ' ' + r.pct + '%'; }).join(', ')) + '">' +
      d.rows.map(function (r, i) { return '<span class="' + STACK_CLASS[i] + '" style="flex:' + r.pct + '">' + (r.pct >= 10 ? '<b>' + r.pct + '%</b>' : '') + '</span>'; }).join('') + '</div>' +
      '<ul class="ps-key">' + d.rows.map(function (r, i) { return '<li><i class="' + STACK_CLASS[i] + '"></i>' + esc(r.name) + ' <b>$' + r.m.toFixed(1) + 'M</b> · ' + r.pct + '%</li>'; }).join('') + '</ul>' +
      '<p class="metric-source">Sample amounts from the budget under “The LIHTC development process” below. Real deals vary; rural deals often need more gap money.</p></figure>';
  }
  // 9% against 4% for one sample 60-home project (q17). Rates and prices are the ones this guide cites:
  // about 9% and 4% of eligible basis a year for 10 years (IRC §42(b)); $0.82 and $0.83 per credit dollar
  // (Novogradac 2026-Q2). The cost and basis are labelled samples.
  function creditCompare() {
    var COST = 15, BASIS = 12, PRICE = { 9: 0.82, 4: 0.83 };
    function side(r) {
      var credits = BASIS * r / 100 * 10, eq = credits * PRICE[r], pct = Math.round(eq / COST * 100);
      return { r: r, credits: credits, eq: eq, pct: pct };
    }
    var S = [side(9), side(4)];
    // The 4% + state row draws only its federal part: no public source prices Colorado's state credit.
    var HOW = {
      9: 'Won in CHFA’s competitive Round One. 14 of 32 applications were funded in 2026.',
      4: 'Bonds alone: not a contest while bond cap lasts. CHFA takes these all year except February, August and December. Loans and soft funds fill more.',
      '4s': 'Bonds plus Colorado state credit, won in CHFA’s competitive Round Two (applications due August 2, 2027). 9 of 21 were funded in 2025. Per project in 2027: a fixed $1,000,000 a year of accelerated state credit plus up to $675,000 of standard. No public source prices the state credit, so the bar shows only the federal part.'
    };
    function row(x, key) {
      return '<li><span class="cc-t">' + (key === '4s' ? '4% + state' : x.r + '% credit') + '</span>' +
        '<span class="cc-bar"><span class="cc-eq" style="width:' + x.pct + '%"><b>$' + x.eq.toFixed(1) + 'M</b></span></span>' +
        '<span class="cc-v"><b>' + x.pct + '%</b> ' + (key === '4s' ? '+ state credit' : 'of the cost') + '</span>' +
        '<span class="cc-how">' + HOW[key || x.r] + '</span></li>';
    }
    return '<figure class="credit-compare" aria-labelledby="cc-cap"><figcaption id="cc-cap"><strong>A 9% credit pays about twice as much of a project as a 4% credit</strong>' +
      '<span>Sample: 60 homes costing $' + COST + 'M, $' + BASIS + 'M of it eligible basis. Bars show credit equity as a share of the cost.</span></figcaption>' +
      '<ol class="cc-rows">' + row(S[0]) + row(S[1]) + row(S[1], '4s') + '</ol>' +
      '<p class="metric-source">Credit: about ' + S.map(function (x) { return x.r + '% of basis a year for 10 years ($' + x.credits.toFixed(1) + 'M)'; }).join(' or ') + ', <a href="https://www.law.cornell.edu/uscode/text/26/42" target="_blank" rel="noopener">IRC §42(b)</a>. Price: $0.82 (9%) and $0.83 (4%) per credit dollar, Novogradac 2026-Q2 national averages. Round Two dates and state credit caps: <a href="https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf" target="_blank" rel="noopener">CHFA 2027–28 QAP</a> §3.B.2 (p. 15) and §3.L (p. 31); Round Two counts: CHFA applicant and award reports.</p></figure>';
  }
  function stackBox(title, sub, strong) {
    return '<li class="dg-stack-box' + (strong ? ' dg-stack-box--main' : '') + '"><strong>' + esc(title) + '</strong><span>' + esc(sub) + '</span></li>';
  }
  function stackFlow(mark, label) {
    return '<li class="dg-stack-flow"><span aria-hidden="true">' + mark + '</span> ' + esc(label) + '</li>';
  }
  function box(x, y, w, h, title, sub, strong) {
    return '<g class="dg-box' + (strong ? ' dg-box--main' : '') + '"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10"/>' +
      '<text x="' + (x + w / 2) + '" y="' + (y + 28) + '" class="dg-box-title" text-anchor="middle">' + esc(title) + '</text>' +
      wrap(sub, 30).map(function (line, i) { return '<text x="' + (x + w / 2) + '" y="' + (y + 48 + i * 16) + '" class="dg-box-sub" text-anchor="middle">' + esc(line) + '</text>'; }).join('') + '</g>';
  }
  function arrow(d, label, lx, ly, anchor) {
    return '<path d="' + d + '" class="dg-arrow" marker-end="url(#dg-head)"/><text x="' + lx + '" y="' + ly + '" class="dg-arrow-label" text-anchor="' + anchor + '">' + esc(label) + '</text>' +
      (arrow.defs ? '' : (arrow.defs = true, '<defs><marker id="dg-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="dg-head"/></marker></defs>'));
  }
  function wrap(text, max) {
    var lines = [''];
    text.split(' ').forEach(function (w) {
      var last = lines[lines.length - 1];
      if ((last + ' ' + w).trim().length > max) lines.push(w); else lines[lines.length - 1] = (last + ' ' + w).trim();
    });
    return lines;
  }


  // A picture of one part of the guide, drawn from that part's own headings and first lines, so the
  // words on the cards are the guide's words. o: { from: section id, title, kind: 'flow'|'grid'|'phones',
  // rows: true to read a table's rows (row heading, first cell) instead of h3 headings, max }.
  function cardsFrom(o) {
    return function (g) {
      var s = (g.sections || []).filter(function (x) { return x.id === o.from; })[0];
      if (!s) return '';
      var box = document.createElement('div');
      box.innerHTML = s.html;
      var items = [];
      if (o.rows) {
        Array.prototype.forEach.call(box.querySelectorAll('tbody tr'), function (tr) {
          var th = tr.querySelector('th'), td = tr.querySelector('td');
          if (!th) return;
          var head = th.childNodes[0] && th.childNodes[0].nodeType === 3 ? th.childNodes[0].textContent : th.textContent;
          items.push({ t: head.trim(), d: td ? td.textContent.trim() : '' });
        });
      } else {
        Array.prototype.forEach.call(box.querySelectorAll('h3'), function (h) {
          var d = '', n = h.nextElementSibling;
          while (n && !d) {
            if (/^(P|UL|OL)$/.test(n.tagName)) d = (n.tagName === 'P' ? n : n.querySelector('li') || n).textContent;
            n = n.nextElementSibling;
          }
          if (!d && h.parentNode) { var p = h.parentNode.querySelector('p'); d = p ? p.textContent : ''; }
          if (o.kind === 'phones' && h.parentNode) {
            // Phone cards show the numbers in that block, as written there.
            var nums = h.parentNode.textContent.match(/\(\d{3}\) \d{3}-\d{4}|\b1-\d{3}-\d{3}-\d{4}\b|\b2-1-1\b/g);
            if (nums) d = nums.filter(function (x, i) { return nums.indexOf(x) === i; }).slice(0, 2).join(' or ');
          }
          items.push({ t: h.textContent.replace(/:$/, '').trim(), d: firstSentence(d) });
        });
      }
      items = items.filter(function (x) { return x.t; }).slice(0, o.max || 8);
      if (items.length < 2) return '';
      var kind = o.kind || 'grid';
      return '<figure class="lab-diagram g-cards g-cards--' + kind + '" style="--n:' + items.length + '"><p class="g-cards-title">' + esc(o.title) + '</p><ol>' +
        items.map(function (x, i) {
          return '<li><span class="g-card-n" aria-hidden="true">' + (i + 1) + '</span><strong>' + esc(x.t) + '</strong>' + (x.d ? '<span>' + esc(x.d) + '</span>' : '') + '</li>';
        }).join('') + '</ol><figcaption>From this guide: <a href="#/' + esc(location.hash.slice(2).split('?')[0]) + '?at=g-' + esc(s.id) + '" data-jump="g-' + esc(s.id) + '">' + esc(s.title) + '</a>.</figcaption></figure>';
    };
  }
  function firstSentence(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    var m = t.match(/^.{20,}?[.!?](?=\s|$)/);
    t = (m ? m[0] : t).replace(/:$/, '.');
    return t.length > 160 ? t.slice(0, 157).replace(/\s+\S*$/, '') + '…' : t;
  }

  // The 9% price paths in the CRA guide, read from the guide's own chart-data sentence.
  function craBars(g) {
    var s = (g.sections || []).filter(function (x) { return x.id === 'four-scenarios'; })[0];
    var line = s && (s.html.match(/at 2027-Q4,([^<]*)/) || [])[1];
    var Viz = global.LabViz;
    if (!line || !Viz || !Viz.orderedBars) return '';
    // The starting price is the guide's own too ("all scenarios start at the 2026-Q2 benchmark $0.82").
    var from = s.html.match(/start at the (\d{4}-Q\d) benchmark \$(\d\.\d\d)/);
    var rows = [from ? [from[1] + ' benchmark', Number(from[2])] : ['2026-Q2 benchmark', 0.82]];
    line.replace(/([A-Z][A-Za-z ()]+?) \$(\d\.\d\d)/g, function (_, name, v) { rows.push([name.trim(), Number(v)]); });
    if (rows.length < 3) return '';
    return Viz.orderedBars({ title: '9% credit price after six quarters, by scenario', answer: 'Scenarios, not a forecast: each moves the 2026-Q2 national benchmark by its stated range.',
      rows: rows, noShare: true, color: 'var(--c-blue)', fmt: function (v) { return '$' + v.toFixed(2); },
      source: 'Novogradac LIHTC equity pricing, 2026-Q2 benchmark; scenario ranges from this guide' });
  }

  // Long parts of an article guide show their opening, then fold the rest behind one button.
  // The words are unchanged; the contents list opens a folded part when it jumps there.
  function shortened(s, html) {
    var words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    if (words < 160) return html;
    var box = document.createElement('div');
    box.innerHTML = html;
    var root = box;
    while (root.children.length === 1 && /^(SECTION|DIV)$/.test(root.children[0].tagName)) root = root.children[0];
    var kids = Array.prototype.slice.call(root.children), keep = 0, seen = 0;
    // Keep the opening (about 45 words), and always leave at least one block to fold.
    while (keep < kids.length - 1 && (keep === 0 || seen < 45)) { seen += kids[keep].textContent.split(/\s+/).filter(Boolean).length; keep++; }
    if (!keep) return html;
    var d = document.createElement('details');
    d.className = 'g-more';
    d.innerHTML = '<summary>Read the rest of this part <span class="note">(about ' + Math.max(1, Math.round((words - seen) / 220)) + ' min)</span></summary>';
    kids.slice(keep).forEach(function (k) { d.appendChild(k); });
    root.appendChild(d);
    return box.innerHTML;
  }

  // A guide's text names the site's own data file where a reader needs the publisher; say who publishes it.
  function clean(html) {
    return html.replace('Chart data is computed from the latest benchmark price in data/market/novogradac-equity-pricing.json.',
      'Chart data: the latest benchmark price in Novogradac’s LIHTC equity pricing survey.');
  }

  // Each top-level block of a section that has a heading (a panel) folds behind its summary,
  // unless the guide keeps it open. The words inside are unchanged.
  function folded(s, conf) {
    if (!conf.fold) return shortened(s, clean(s.html));
    var box = document.createElement('div');
    box.innerHTML = clean(s.html);
    var n = 0;
    Array.prototype.slice.call(box.children).forEach(function (el) {
      var h = el.querySelector('h3');
      if (!h) return;
      var key = s.id + '/' + (n++);
      if ((conf.open || []).indexOf(key) > -1 || !conf.fold[key]) return;
      var d = document.createElement('details');
      d.className = 'fold';
      var title = el.classList.contains('panel') ? h.textContent : s.title;
      if (el.classList.contains('panel')) h.remove();
      d.innerHTML = '<summary><span class="fold-title">' + esc(title.trim()) + '</span><span class="fold-take">' + esc(conf.fold[key]) + '</span></summary>';
      el.parentNode.replaceChild(d, el);
      d.appendChild(el);
    });
    return box.innerHTML;
  }

  // The guides whose live page has its own layout, or whose scripts write some of its words and tables.
  var PAGE_MODE = { 'lihtc-basics': 'lihtc' };
  var PAGE_RENDERED = { 'lihtc-basics': true, 'green-building': true, 'resident-services': true, 'cra-pricing': true, 'about': true, 'ahcia': true, 'homebuyer-help': true };
  var PAGE_PATHS = { 'working-paper': true, 'methods': true };
  // A read that fails (a dropped connection; Safari calls it "Load failed") is tried once more on its own. If
  // that fails too the page says so with a Try again button, and the failure is not kept as the answer: opening
  // the guide again reads it again, as the hub's data loads do (components.js load()).
  function load(slug, again) {
    var had = cache[slug];
    if (had && !(had.error && Date.now() - had.failedAt > 5000)) return had;
    var c = cache[slug] = {};
    var done = function (g) { if (cache[slug] === c) { c.guide = g; Shell.render(); } };
    var fail = function (e) {
      if (cache[slug] !== c) return;
      if (!again) { delete cache[slug]; setTimeout(function () { if (!cache[slug]) load(slug, true); }, 1500); return; }
      c.error = 'The guide did not load (' + ((e && e.message) || 'no reply') + ').'; c.failedAt = Date.now(); Shell.render();
    };
    // Inside the public site the guide is read from its own page, cut the same way the lab's copy is
    // (site/guide-extract.js), so it never shows a frozen copy (format review F3).
    var X = global.LabGuideExtract, P = global.LAB_PORT, page = P && P.GUIDES && P.GUIDES[slug];
    if (page && X && global.DOMParser) {
      var o = { routes: X.ROUTES, live: '', self: '#/guide/' + slug, keepPaths: !!PAGE_PATHS[slug], mode: PAGE_MODE[slug], rendered: !!PAGE_RENDERED[slug] };
      var mine = function (b) { b.sections.forEach(function (x) { delete x.liveFilled; }); b.slug = slug; b.live = page; b.here = true; return b; };
      var read = function (rendered) {
        o.rendered = rendered;
        // Figures that arrive after the first read (a slow connection) redraw the guide when they land.
        return X.fromPage(page, o, function (late) { done(mine(late)); }).then(function (b) {
          // A part the page's scripts fill, on a page not yet marked as such: read the page again once it has drawn.
          if (!rendered && b.sections.some(function (x) { return x.liveFilled; })) return read(true);
          return mine(b);
        });
      };
      read(o.rendered).then(done, fail);
      return c;
    }
    fetch('guides/' + slug + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(done, fail);
    return c;
  }

  if (global.document) global.document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-guide-retry]');
    if (!b) return;
    delete cache[b.getAttribute('data-guide-retry')];
    Shell.render();
  });
  // A phone that brings the page back from its back-forward cache (Safari) has cancelled any read in flight:
  // read again the guides that failed or were still loading.
  if (global.addEventListener) global.addEventListener('pageshow', function (ev) {
    if (!ev.persisted) return;
    Object.keys(cache).forEach(function (k) { if (!cache[k].guide) delete cache[k]; });
    Shell.render();
  });

  function guideView(params, parts) {
    var slug = parts[1];
    var conf = GUIDES[slug];
    if (!conf) return '<h1>Guide not found</h1><p class="lede">There is no guide at this address.</p><p><a href="#/guides">Policy &amp; research</a></p>';
    var c = load(slug);
    if (c.error) return '<h1>Guide</h1><div class="callout" role="alert"><p>' + esc(c.error) + ' The connection may have dropped.</p>' +
      '<p><button type="button" class="button-link secondary" data-guide-retry="' + esc(slug) + '">Try again</button></p></div>';
    if (!c.guide) return '<h1>Loading the guide</h1><p role="status" class="note">Loading…</p>';
    var g = c.guide;
    arrow.defs = false;
    var startTitle = conf.introTitle || 'The three parties';
    var hasStart = !!(String(g.intro || '').replace(/<[^>]*>/g, '').trim() || conf.diagram);
    var sections = (hasStart ? [{ id: 'g-start', title: startTitle }] : []).concat(g.sections.map(function (s) { return { id: 'g-' + s.id, title: s.title, lang: s.lang }; }));
    // Currency stamp (paul 11-09): the live page's own dates from the site's research catalog.
    var cat = global.LabUI.load({ cat: 'data/insights/catalog.json' }).data;
    var ce = cat && g.live ? (cat.cat.entries || []).filter(function (e) { return e.url && ('/' + g.live).slice(-e.url.length - 1) === '/' + e.url; })[0] : null;
    var gStamp = ce ? (ce.updated ? T.stamp('Updated', ce.updated) : ce.published ? T.stamp('Published', ce.published) : '') : '';
    // A reviewed guide the catalog does not date: the newest "checked <date>" the page itself states.
    if (!gStamp) {
      var MONS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'], best = '';
      String(g.intro || '').concat(g.sections.map(function (x) { return x.html; }).join(' ')).replace(/checked (?:on )?([A-Z][a-z]+) (\d{1,2}), (\d{4})/g, function (m, mo, d, y) {
        var i = MONS.indexOf(mo.toLowerCase()); if (i < 0) return m;
        var iso = y + '-' + ('0' + (i + 1)).slice(-2) + '-' + ('0' + d).slice(-2); if (iso > best) best = iso; return m;
      });
      if (best) gStamp = T.stamp('Checked', best);
    }
    // A part whose live page mounts a tool (the bank map) gets the lab's own tool in the same spot.
    var ins = conf.inserts || {};
    var page = T.head({
      kind: 'guide', crumbs: conf.crumbs ? conf.crumbs.concat([{ label: g.title }]) : T.trail(conf.menu, g.title), title: g.title, answer: esc(g.lede),
      meta: g.draft ? 'Written ' + esc(g.draft.written) + '. Every figure links its source.'
        : g.livePage ? 'From the full <a href="' + esc(g.live) + '">' + esc(g.livePage) + '</a> page, below the calculator.'
        // Inside the public site the guide's own page stays one link away (?classic=1 holds it open; see js/path-resolver.js).
        : g.here ? (gStamp ? gStamp + ' ' : '') + '<a class="guide-own" href="' + esc(g.live) + '?classic=1">Open this guide as its own page</a>.'
        : 'From the full <a href="' + esc(g.live) + '">' + esc(g.title) + '</a> guide.' + (gStamp ? ' ' + gStamp : ''),
      facts: conf.facts
    }) + (conf.download ? T.printBar({ word: 'coho-' + slug }) : '') +
      // The live page's own header lines: its disclaimer, kind and dated byline.
      // One- to three-word kickers ("Guide", "Platform") repeat the page kind the lab already shows, so only
      // the longer lines are drawn; the record keeps them all.
      (function (lines) { return lines.length ? '<ul class="guide-notes">' + lines.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : ''; })((g.notes || []).filter(function (n) { return n.split(' ').length > 3; })) +
      // A guide written in two languages keeps its page's switch: a link to where the other language starts.
      (function (es) { return es ? '<p class="guide-lang"><a href="#/guide/' + esc(slug) + '?at=g-' + esc(es.id) + '" data-jump="g-' + esc(es.id) + '" lang="es" hreflang="es">Espa\u00f1ol</a></p>' : ''; })(g.sections.filter(function (x) { return x.lang === 'es'; })[0]) +
      (g.docGuide ? '<aside class="doc-guide" aria-labelledby="doc-guide-t"><p class="doc-guide-t" id="doc-guide-t">' + esc(g.docGuide.title) + '</p><ol>' + g.docGuide.items.map(function (x) {
        return '<li' + (x.here ? ' class="is-here"' : '') + '>' + (x.here ? '<strong>' + esc(x.name) + '</strong> <span class="note">You are here</span>' : '<a href="' + esc(x.href) + '">' + esc(x.name) + '</a>') +
          (x.use ? '<span class="doc-guide-use">' + esc(x.use) + '</span>' : '') + (x.about ? '<span class="doc-guide-about">' + esc(x.about) + '</span>' : '') + '</li>';
      }).join('') + '</ol></aside>' : '') +
      '<div class="guide-layout">' + T.onThisPage(sections) +
      '<article class="guide-body">' +
      (hasStart ? '<section id="g-start" tabindex="-1"><h2>' + esc(startTitle) + '</h2>' + (conf.fold ? g.intro : shortened(null, g.intro)) + (conf.diagram ? conf.diagram(g) : '') + '</section>' : '') +
      g.sections.map(function (s) {
        return '<section id="g-' + esc(s.id) + '" tabindex="-1"' + (s.lang ? ' lang="' + esc(s.lang) + '"' : '') + '><h2>' + esc(s.title) + '</h2>' + (ins[s.id] ? ins[s.id](folded(s, conf), params) : folded(s, conf)) +
          (s.liveFilled && !ins[s.id] ? '<p class="callout live-filled"><a href="' + esc(g.live) + '">More figures for this part in the full guide</a>.</p>' : '') + '</section>';
      }).join('') +
      T.next('Next', conf.next) +
      '</article></div>';
    // A section named in the hash (from the contents list) is scrolled to after the page draws.
    var at = params.get('at');
    // A wide table scrolls sideways inside its box; the box takes keyboard focus so it can be scrolled without a mouse,
    // as the table's box does on the guide's own page.
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('.guide-body table'), function (t) {
        var d = t.parentNode;
        if (!d || d.tagName !== 'DIV' || d.hasAttribute('tabindex')) return;
        var cap = t.querySelector('caption');
        d.setAttribute('tabindex', '0'); d.setAttribute('role', 'region');
        d.setAttribute('aria-label', ((cap && cap.textContent.replace(/\s+/g, ' ').trim()) || 'Table') + ' (scrolls sideways on a narrow screen)');
      });
    }, 0);
    // An anchor from the guide's own page (its address before the move) lands on the part that holds it.
    // Once the guide is drawn, its glossary terms and column headings get their definitions (see hoverHelp).
    setTimeout(function () { helpFiles(function (F) { hoverHelp(document.querySelector('.guide-body'), F, !!g.termsOnce); }); }, 0);
    function land(at) {
      var held = g.sections.filter(function (x) { return x.id === at || (x.ids || []).indexOf(at) > -1; })[0];
      // The exact element the page's anchor named, when the guide kept it; else the part that held it.
      var named = Array.prototype.filter.call(document.querySelectorAll('.guide-body [data-at]'), function (n) { return n.getAttribute('data-at') === at; })[0];
      var el = document.getElementById(at) || named || (held && document.getElementById('g-' + held.id));
      if (!el) return false;
      // Every fold around it opens, so the link shows what it pointed at; a part jumped to opens its "read the rest".
      for (var up = el.parentNode; up && up !== document; up = up.parentNode) if (up.tagName === 'DETAILS') up.open = true;
      if (el.tagName === 'DETAILS') el.open = true;
      Array.prototype.forEach.call(el.querySelectorAll('details.g-more'), function (d) { d.open = true; });
      el.scrollIntoView({ block: 'start' });
      return true;
    }
    if (at) setTimeout(function () { land(at); }, 0);
    here = { slug: slug, land: land };
    return page;
  }

  // ---- Hover help the guide's own page has: glossary definitions and column heading tips ----------------------
  // The site's pages get these from js/glossary.js and js/components/table-header-tips.js, which do not run here.
  // The same two files those scripts read are read here, and the same rules kept: a term is defined at its first
  // use in each part, never in a heading, link, button, table heading or code; a heading's tip is its own
  // (data-tip from the page) or the site's entry for that heading's words.
  // One read of the two files for every page that asks; a page that asks while the read is under way gets the
  // same answer when it comes (a guide opened, then Financials before the files arrive).
  var HELP = { files: null, waiting: null };
  function helpFiles(then) {
    if (HELP.files) return then(HELP.files);
    if (HELP.waiting) { HELP.waiting.push(then); return; }
    HELP.waiting = [then];
    var V = global.LAB_VENDOR || '';
    var get = function (f) { return fetch(V + f).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    Promise.all([get('data/glossary.json'), get('data/table-header-tips.json')]).then(function (all) {
      var terms = ((all[0] && all[0].terms) || []).filter(function (t) { return t && t.term && t.definition && t.autolink !== false; });
      var map = Object.create(null);
      terms.forEach(function (t) { map[t.term] = t; });
      terms.forEach(function (t) { (t.aliases || []).forEach(function (a) { if (!map[a]) map[a] = t; }); });
      var keys = Object.keys(map).sort(function (a, b) { return b.length - a.length; });
      HELP.files = {
        map: map, tips: (all[1] && (all[1].tips || all[1])) || {},
        pattern: keys.length ? new RegExp('\\b(' + keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b', 'g') : null
      };
      // Every term with a short definition, the ones not linked on sight included: a guide whose own page defines
      // each term once at its first use (js/components/inline-glossary.js reads the same list) does so here too.
      var once = Object.create(null);
      // A term's key there is its inline_key or its name, and each of its other spellings (scripts/sync-glossary.mjs).
      ((all[0] && all[0].terms) || []).forEach(function (t) {
        if (!t || !t.term || !t.definition || !t.short) return;
        [t.inline_key || t.term].concat(t.aliases || []).forEach(function (k) { if (k && !once[k]) once[k] = t; });
      });
      var onceKeys = Object.keys(once).sort(function (a, b) { return b.length - a.length; });
      HELP.files.once = once;
      HELP.files.oncePattern = onceKeys.length ? new RegExp('\\b(' + onceKeys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b', 'g') : null;
      var waiting = HELP.waiting; HELP.waiting = null;
      waiting.forEach(function (f) { f(HELP.files); });
    });
  }
  function clip(text, max) {
    text = String(text || '');
    if (text.length <= max) return text;
    var cut = text.slice(0, max), sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:]+$/, '') + '…';
  }
  function termMark(t, text) {
    var full = t.full || t.label || t.term, a = document.createElement('abbr');
    a.className = 'g-term'; a.setAttribute('tabindex', '0'); a.setAttribute('aria-label', full);
    a.setAttribute('data-gtip', full + ': ' + clip(t.definition, 160)); a.setAttribute('data-term', t.term);
    a.textContent = text;
    return a;
  }
  function hoverHelp(body, F, termsOnce) {
    if (!body || body.getAttribute('data-help') === '1') return;
    gtipWire();
    body.setAttribute('data-help', '1');
    // Column headings: the page's own tip, else the site's entry for the heading's words.
    Array.prototype.forEach.call(body.querySelectorAll('th'), function (th) {
      var tip = th.getAttribute('data-tip') || F.tips[th.textContent.replace(/\s+/g, ' ').replace(/[▲▼↑↓⇅↕?]+\s*$/, '').trim().toLowerCase()];
      // The table sorter's arrow button is not a control of the heading's own (js/components/table-header-tips.js
      // allows it too): the sorter may run before or after this, so a sortable heading keeps its tip either way.
      if (!tip || !th.textContent.trim() || th.querySelector('a, button:not(.th-sort), input, select')) return;
      th.setAttribute('data-gtip', tip); th.classList.add('g-tip');
      if (!th.hasAttribute('tabindex')) th.setAttribute('tabindex', '0');
    });
    // A definition the guide's page already carries (an abbr with a title, written by the page's own glossary
    // script before the guide was read) opens the same way as the rest: on hover, focus or a tap.
    Array.prototype.forEach.call(body.querySelectorAll('abbr[title]:not(.g-term)'), function (a) {
      var def = a.getAttribute('title'), word = a.textContent.replace(/\s+/g, ' ').trim();
      if (!def || !word) return;
      var t = (F.once && F.once[word]) || (F.map && F.map[word]);
      a.classList.add('g-term'); a.setAttribute('data-gtip', def); a.setAttribute('data-term', t ? t.term : word);
      a.setAttribute('aria-label', word + ': ' + def); a.removeAttribute('title');
      if (!a.closest('a, button, summary')) a.setAttribute('tabindex', '0');
    });
    if (!F.pattern) return;
    // Glossary terms: first use in each part of the guide.
    var SKIP = 'a, button, abbr, th, code, pre, h1, h2, h3, h4, h5, h6, summary, figcaption, svg, select, option, textarea, input, .no-glossary, .guide-diagram, .g-cards';
    Array.prototype.forEach.call(body.querySelectorAll('.guide-section, section'), function (sec) {
      if (sec.getAttribute('lang') && sec.getAttribute('lang') !== 'en') return;
      var seen = Object.create(null), w = document.createTreeWalker(sec, 4), nodes = [], n;
      while ((n = w.nextNode())) nodes.push(n);
      nodes.forEach(function (node) {
        var par = node.parentNode;
        if (!par || !node.nodeValue || !node.nodeValue.trim() || (par.closest && par.closest(SKIP))) return;
        // A part inside this one is walked on its own turn.
        if (par.closest('.guide-section, section') !== sec) return;
        var text = node.nodeValue, last = 0, frag = null, m;
        F.pattern.lastIndex = 0;
        while ((m = F.pattern.exec(text))) {
          if (seen[m[1]]) continue;
          var t = F.map[m[1]]; if (!t) continue;
          seen[m[1]] = true;
          frag = frag || document.createDocumentFragment();
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          frag.appendChild(termMark(t, m[1]));
          last = m.index + m[1].length;
        }
        if (frag) { if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last))); par.replaceChild(frag, node); }
      });
    });
    // Once in the whole guide, where its own page does the same: any term still without a definition anywhere in
    // the guide gets one at its first use. Running words are tried first; a term that is used only in a heading
    // or a column heading is defined there, as on the page.
    if (!termsOnce || !F.oncePattern) return;
    var have = Object.create(null);
    Array.prototype.forEach.call(body.querySelectorAll('abbr.g-term'), function (a) { have[a.getAttribute('data-term')] = true; });
    var LOOSE = 'a, button, abbr, code, pre, summary, svg, select, option, textarea, input, .no-glossary, .guide-diagram, .g-cards, th.g-tip';
    // Last, a term used only inside a link or a fold's title: defined on hover there, and the link or the fold
    // stays the one thing to press.
    var LINKS = LOOSE.replace(/^a, /, '').replace(' summary,', '');
    [SKIP, LOOSE, LINKS].forEach(function (skip) {
      var w = document.createTreeWalker(body, 4), nodes = [], n;
      while ((n = w.nextNode())) nodes.push(n);
      nodes.forEach(function (node) {
        var par = node.parentNode;
        if (!par || !node.nodeValue || !node.nodeValue.trim() || (par.closest && par.closest(skip))) return;
        var sec = par.closest('.guide-section, section');
        if (sec && sec.getAttribute('lang') && sec.getAttribute('lang') !== 'en') return;
        var text = node.nodeValue, last = 0, frag = null, m;
        F.oncePattern.lastIndex = 0;
        while ((m = F.oncePattern.exec(text))) {
          if (have[m[1]]) continue;
          have[m[1]] = true;
          frag = frag || document.createDocumentFragment();
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          var mark = termMark(F.once[m[1]], m[1]);
          if (par.closest('a, summary')) mark.removeAttribute('tabindex');
          frag.appendChild(mark);
          last = m.index + m[1].length;
        }
        if (frag) { if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last))); par.replaceChild(frag, node); }
      });
    });
  }
  // One small label for both, shown on hover, focus or a tap, and closed by Escape or moving away.
  var gtip = null, gtipOn = null;
  function gtipHide() { if (gtip) gtip.hidden = true; if (gtipOn) gtipOn.removeAttribute('aria-describedby'); gtipOn = null; }
  function gtipShow(el) {
    if (gtipOn === el) return;
    gtipHide();
    if (!gtip) { gtip = document.createElement('div'); gtip.id = 'guide-tip'; gtip.className = 'viz-tip guide-tip'; gtip.setAttribute('role', 'tooltip'); document.body.appendChild(gtip); }
    gtip.textContent = el.getAttribute('data-gtip'); gtip.hidden = false;
    var r = el.getBoundingClientRect(), w = gtip.offsetWidth, h = gtip.offsetHeight, vw = document.documentElement.clientWidth;
    var left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, vw - w - 6)), top = r.top - h - 8 < 6 ? r.bottom + 8 : r.top - h - 8;
    gtip.style.left = (left + global.pageXOffset) + 'px'; gtip.style.top = (top + global.pageYOffset) + 'px';
    el.setAttribute('aria-describedby', 'guide-tip'); gtipOn = el;
  }
  // A guide's words, and any other page part marked data-hover-help (Financials, site/calc-help.js), use the same label.
  var GTIP = '.guide-body [data-gtip], [data-hover-help] [data-gtip]';
  function gtipTarget(ev) { var t = ev.target; return t && t.closest ? t.closest(GTIP) : null; }
  // Wired once, when the first guide gets its hover help (this file is also loaded where there is no page to listen on).
  var gtipWired = false;
  function gtipWire() {
    if (gtipWired) return;
    gtipWired = true;
    // A tap on a sortable heading opens its definition and does not sort the table; the sorter's arrow is the
    // separate touch target (the rule js/components/table-header-tips.js keeps on the guide's own page). A mouse
    // click, a keypress and a tap on the arrow still sort.
    var lastTouch = false;
    document.addEventListener('pointerdown', function (ev) { lastTouch = ev.pointerType === 'touch' || ev.pointerType === 'pen'; }, true);
    document.addEventListener('click', function (ev) {
      var th = ev.target && ev.target.closest ? ev.target.closest('.guide-body th[data-gtip], [data-hover-help] th[data-gtip]') : null;
      if (!th || !lastTouch || !ev.detail || ev.target.closest('.th-sort')) return;
      ev.stopPropagation(); ev.preventDefault();
      gtipShow(th);
    }, true);
    // After a touch, a stray mouse event elsewhere does not close the label; a tap elsewhere does (the click below).
    document.addEventListener('mouseover', function (ev) { var el = gtipTarget(ev); if (el) gtipShow(el); else if (gtipOn && !lastTouch) gtipHide(); });
    document.addEventListener('focusin', function (ev) { var el = gtipTarget(ev); if (el) gtipShow(el); else if (gtipOn) gtipHide(); });
    document.addEventListener('click', function (ev) { var el = gtipTarget(ev); if (el && gtipOn !== el) gtipShow(el); else if (!el && gtipOn) gtipHide(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && gtipOn) gtipHide(); });
    global.addEventListener('hashchange', gtipHide);
  }

  // A link in the guide's words to another part of the same guide lands there without drawing the page again,
  // and works a second time (the address would not change, so the router would not hear it).
  var here = null;
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('.guide-body a[href^="#/guide/"]');
    var m = a && here && !a.hasAttribute('data-jump') && /^#\/guide\/([a-z0-9-]+)\?at=([A-Za-z0-9_-]{1,80})$/.exec(a.getAttribute('href'));
    if (m && m[1] === here.slug && here.land(m[2])) ev.preventDefault();
  });

  Shell.views.guide = guideView;
  // hoverHelp and helpFiles are shared with Financials (site/calc-help.js), which marks its terms the same way.
  global.LabGuide = { GUIDES: GUIDES, hoverHelp: hoverHelp, helpFiles: helpFiles, hideTip: gtipHide, wireTips: gtipWire };
})(window);
