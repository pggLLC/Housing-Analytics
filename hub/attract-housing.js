// How a Colorado town gets affordable homes built (#/places/attract-housing): the moves a town or county controls,
// in four tiers, for rental and for-sale homes. A lab addition to port (paul asked 5 Nov 2026; "Build now,
// restyle later" picked the same day). The order rests on state law and agency rules, not on a prediction:
//   1 Opens the door   a state rule makes it a gate (Prop 123 eligibility, a CHFA threshold)
//   2 Earns points     a CHFA scoring line or a Prop 123 counting credit rewards it
//   3 Cuts cost/time   it lowers what a project pays or how long approval takes
//   4 Keeps them coming  dedicated money and lasting partners
// Inside tiers 3 and 4 no rule sets the order, and the page says so. Tier 1 and 2 rules are written here with a
// dated primary source each (the same pattern as site/middle-income.js). Tier 3 and 4 tools come from the live
// site's own catalog (data/policy/incentive-alternatives.json) with its Colorado legal basis, and the count of
// places on record comes from the live Local Incentives logic (js/local-incentives-data.js). The town check reads
// DOLA's own lists as the live site keeps them: prop123_jurisdictions.json and state-housing-laws.json.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc;
  var FILES = {
    geoConfig: 'data/hna/geo-config.json', fees: 'data/policy/fee-reductions.json', funds: 'data/policy/local-housing-funds.json',
    coverage: 'data/policy/incentive-coverage.json', prop123: 'data/policy/prop123_jurisdictions.json', alternatives: 'data/policy/incentive-alternatives.json',
    laws: 'data/policy/state-housing-laws.json'
  };
  var ROUTE = '#/places/attract-housing';

  // Primary sources, each with the date it was issued or read.
  var S = {
    qap: { t: 'CHFA 2027-2028 Qualified Allocation Plan', u: 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf', d: 'adopted, read 5 Nov 2026' },
    dola: { t: 'DOLA, Meeting Proposition 123 Commitments: Unit Count and Expedited Review Guidance, 2027-2029', u: 'https://docs.google.com/document/d/1EwQ_rU8amUmc7lLPbO3nydJixd3AMBgZ2Ao4WXx1xpo/edit', d: 'second cycle, read 5 Nov 2026' },
    p123: { t: 'Proposition 123, C.R.S. 29-32-105', u: 'https://colorado.public.law/statutes/crs_29-32-105', d: 'approved by voters Nov 2022' },
    hb1313: { t: 'HB26-1313, 2026 Session Laws ch. 154', u: 'https://leg.colorado.gov/laws/session-laws/HB26-1313/154/download', d: 'approved 26 May 2026' },
    sb040: { t: 'SB26-040, 2026 Session Laws ch. 125', u: 'https://leg.colorado.gov/laws/session-laws/SB26-040/125/download', d: 'approved 6 May 2026' },
    fastTrack: { t: 'DOLA, Prop 123 fast track', u: 'https://cdola.colorado.gov/prop123fasttrack', d: 'read 5 Nov 2026' },
    status: { t: 'DOLA, Prop 123 commitment status sheet', u: 'https://docs.google.com/spreadsheets/d/1OuAIp8mpoR7GNW0kDWb1Ubl5iuRQLJkfvDkW0OQh-Ug', d: 'read 5 Nov 2026' },
    filings: { t: 'DOLA, Prop 123 commitment filings', u: 'https://cdola.colorado.gov/commitment-filings', d: 'read 5 Nov 2026' },
    plans: { t: 'DOLA, housing needs assessments and action plans (SB24-174)', u: 'https://dlg.colorado.gov/housing-plans', d: 'read 5 Nov 2026' },
    toc: { t: 'HB24-1313, Housing in Transit-Oriented Communities', u: 'https://leg.colorado.gov/bills/hb24-1313', d: 'signed 2024' },
    pha: { t: 'C.R.S. 29-4-227, housing authority property tax exemption', u: 'https://colorado.public.law/statutes/crs_29-4-227', d: 'current' },
    hb1001: { t: 'HB26-1001, housing on qualifying properties', u: 'https://leg.colorado.gov/bills/hb26-1001', d: '2026' }
  };
  function cite(k) { var x = Array.isArray(k) ? k : [k], s = S[x[0]]; return '<a href="' + esc(s.u) + '">' + esc(s.t) + '</a>' + (x[1] ? ', ' + esc(x[1]) : '') + ', ' + esc(s.d); }
  function src(keys) { return '<p class="metric-source">Source: ' + keys.map(cite).join('; ') + '.</p>'; }

  var TIERS = [
    { n: 1, name: 'Opens the door', q: 'Can a project here apply at all?' },
    { n: 2, name: 'Earns points or money', q: 'Does it raise a CHFA score or a Prop 123 count?' },
    { n: 3, name: 'Cuts cost or time', q: 'Does it make the numbers work sooner?' },
    { n: 4, name: 'Keeps projects coming', q: 'Does it bring the next project too?' }
  ];
  var BOTH = { rental: true, sale: true }, RENT = { rental: true, sale: false }, SALE = { rental: false, sale: true };

  // Tiers 1 and 2: each move with the rule that puts it there, quoted or closely paraphrased, with its place in the source.
  var RULES = [
    { id: 'fast-track', tier: 1, short: 'Fast-track review', title: 'Adopt a 90-day fast-track review', lanes: BOTH, speed: 'Council action. DOLA offers a template resolution for small towns whose reviews already take under 90 days.',
      what: 'A promise, in code or a resolution, to decide applications for projects that are at least half affordable within 90 calendar days of a complete application.',
      why: 'A town without a fast-track policy that DOLA has verified by 1 January 2027 loses Prop 123 eligibility for every project inside it, until DOLA verifies one. Only DOLA’s homelessness programs are exempt.',
      src: [['dola', 'Section 3 and glossary'], 'p123', 'fastTrack'] },
    { id: 'commitment', tier: 1, short: 'Prop 123 commitment', title: 'File a Prop 123 commitment', lanes: BOTH, speed: 'A filing through DOLA’s online portal, once per three-year cycle; the portal usually opens around 15 June.',
      what: 'A filing with DOLA’s Division of Housing that sets the town’s goal for new affordable homes over the cycle.',
      why: 'Projects seeking Prop 123 money must be in a place with a commitment on file. That covers DOLA’s homeownership and down payment programs and the Equity, loan and land banking programs run for OEDIT. The 2027-2029 deadline was 1 November 2026. A town that missed it gets no Prop 123 money in 2027, but it can file by 1 November 2027 for 2028.',
      src: [['dola', 'Sections 1C and 2A'], 'p123', 'filings'] },
    { id: 'zoning', tier: 1, short: 'Zoning in place', title: 'Have zoning that already allows the project', lanes: BOTH, speed: 'A rezoning takes a public hearing, so start before the developer applies.',
      what: 'The site’s zoning already permits the homes, the density and the parking the project needs.',
      why: 'Every tax credit application must meet this threshold to compete, and it includes a zoning status letter from the planning department, with the parking required and whether the remaining decisions are administrative or need a public hearing. For-sale projects face no CHFA test, but the same hearing risk applies; that part is our judgment.',
      src: [['qap', 'Section 3.B.4 and Threshold 7, p. 18']] },
    { id: 'contribution', tier: 1, short: 'Local contribution', title: 'Put something local into the project', lanes: RENT, speed: 'A letter of support or intent from the council or staff.',
      what: 'Money, land, fee relief or another in-kind contribution from the local government.',
      why: 'To get Colorado’s state tax credit, an application must show that the local government will provide “some monetary, in-kind, or other contribution benefiting the proposed project.” A letter describing it is accepted as evidence.',
      src: [['qap', 'Threshold 16, p. 21']] },
    { id: 'pha', tier: 2, short: 'Housing authority partner', title: 'Bring in a housing authority as a general partner', lanes: RENT, speed: 'A decision by the housing authority’s board.',
      what: 'A Colorado public housing authority joins the ownership as the sole or majority co-general partner.',
      why: 'Worth 7 points in CHFA’s scoring. It does not count if the authority is only a special limited partner. When a housing authority holds an ownership interest, the project is exempt from property tax in proportion to its share of homes for people of low income.',
      src: [['qap', '5.B.4.b, p. 45'], ['pha', '(1)(b)']] },
    { id: 'transit', tier: 2, short: 'Transit-oriented site', title: 'Zone for homes near transit', lanes: RENT, speed: 'A zoning change. HB24-1313 already asks the cities and counties it covers to zone for more homes near transit.',
      what: 'Allow more homes within a half-mile walk of transit corridors with easy access to jobs.',
      why: 'Worth 5 points, up from 3, for a project at an existing or planned transit-oriented site. CHFA asks that such projects use the most density the site allows, when feasible.',
      src: [['qap', '5.B.2.b, p. 44'], 'toc'] },
    { id: 'priority', tier: 2, short: 'Housing priority on record', title: 'Adopt a plan that names the housing need', lanes: BOTH, speed: 'A needs assessment and plan adopted by council. Under SB24-174, places of 1,000 or more people must send DOLA a needs assessment by 31 December 2026, unless their population has fallen 1% or more; the town check below shows what applies to each.',
      what: 'An adopted housing needs assessment, housing plan or comprehensive-plan goal that sets out who needs homes.',
      why: 'Worth 3 points when a project sits in a community with an identified affordable housing priority and the applicant shows the project fits that need. Reading an adopted plan as that evidence is our interpretation; CHFA decides what qualifies.',
      src: [['qap', '5.B.2.a, p. 44'], 'plans'] },
    { id: 'counting', tier: 2, short: 'Homes that count extra', title: 'Back the homes that count extra toward Prop 123', lanes: BOTH, speed: 'Choices made in each project the town supports.',
      what: 'Under HB26-1313, some homes count for more than one toward a town’s Prop 123 goal, which keeps its eligibility safe.',
      why: 'From 2027: each affordable ownership home counts 1.2, each home at or below 40% AMI 1.2, each home on land the local government donated 1.1, and each home funded by more than one jurisdiction 1.1. In a rental averaging 60% AMI with a deed restriction of 15 years or more, every home counts. Since 1 July 2026, for-sale homes up to 120% AMI count.',
      src: [['dola', 'Sections 4A and 4B'], 'hb1313', 'sb040'] }
  ];

  // Tiers 3 and 4: tools from the live catalog, in an order that is our judgment (the page says so).
  // lanes: who the tool helps; note: one line from a Colorado rule that bears on it, where there is one.
  var TOOLS = [
    { tool: 'land_bank_public_land', tier: 3, short: 'Public land', lanes: BOTH, note: 'Land a local government donates makes each home count 1.1 toward its Prop 123 goal. From 31 December 2027, housing on land owned by housing authorities, school districts, colleges, transit agencies and affordable housing nonprofits gets administrative approval under HB26-1001.', src: [['dola', 'Section 4B'], 'hb1001'] },
    { tool: 'fee_waiver_reduction', tier: 3, short: 'Fee waivers', lanes: BOTH, note: 'CHFA’s state credit test accepts a monetary, in-kind or other local contribution, so a waiver can go in the town’s letter.', src: [['qap', 'Threshold 16, p. 21']] },
    { tool: 'utility_rate_discount', tier: 3, short: 'Tap fee relief', lanes: BOTH },
    { tool: 'fee_deferral', tier: 3, short: 'Fee deferral', lanes: BOTH },
    { tool: 'parking_reduction', tier: 3, short: 'Less required parking', lanes: BOTH, note: 'CHFA’s zoning letter must state the parking required, so a lower requirement shows up in the application.', src: [['qap', 'Threshold 7, p. 18']] },
    { tool: 'density_bonus', tier: 3, short: 'Density bonus', lanes: BOTH },
    { tool: 'adu_by_right', tier: 3, short: 'Backyard homes by right', lanes: BOTH },
    { tool: 'dedicated_sales_tax', tier: 4, short: 'Housing sales tax', lanes: BOTH },
    { tool: 'dedicated_property_tax', tier: 4, short: 'Housing mill levy', lanes: BOTH },
    { tool: 'lodging_or_str_tax', tier: 4, short: 'Lodging tax for housing', lanes: BOTH },
    { tool: 'community_land_trust', tier: 4, short: 'Land trust', lanes: SALE },
    { tool: 'shared_equity_deed_restriction', tier: 4, short: 'Deed-restriction buy-downs', lanes: SALE },
    { tool: 'inclusionary_zoning_rental', tier: 4, short: 'Inclusionary rules', lanes: RENT },
    { tool: 'in_lieu_fee', tier: 4, short: 'Fee in lieu', lanes: BOTH }
  ];
  var LAW = {
    authorized: 'Allowed without a public vote', authorized_with_voter_approval: 'Needs a vote of the people (TABOR)',
    required_for_subject_jurisdictions: 'Required by state law in some places, a local choice elsewhere', unclear: 'Legal basis unclear'
  };

  var model = null;
  function build(d) { if (!model) model = global.LocalIncentivesData.build(d); return model; }

  // Every move in rank order, joined to the catalog and the adoption counts.
  function moves(d, m) {
    var shared = {};
    (((d.fees || {}).meta || {}).legal_basis || []).forEach(function (b) { shared[b.id] = b; });
    var tools = {};
    (d.alternatives.tools || []).forEach(function (t) { tools[t.id] = t; });
    var adopt = {};
    m.adoption.forEach(function (a) { adopt[a.tool.id] = a.adopters.length; });
    var list = RULES.map(function (r) { return Object.assign({ kind: 'rule' }, r); });
    TOOLS.forEach(function (x) {
      var t = tools[x.tool];
      if (!t) return;
      var basis = (t.legal_basis || []).concat((t.reuse_legal_basis_ids || []).map(function (id) { return shared[id]; }).filter(Boolean));
      list.push(Object.assign({ kind: 'tool', id: x.tool, title: t.label, what: t.what_it_is, law: t.colorado_status, basis: basis, places: adopt[x.tool] || 0 }, x));
    });
    return list;
  }

  // The ladder: four rungs, each move a labelled dot. Filled pine dot = rental and for-sale, blue = rental only,
  // amber = for-sale only. Drawn as HTML so labels wrap at 390px; the figure carries its own text alternative.
  var DOT = { both: 'Rental and for-sale', rental: 'Rental only', sale: 'For-sale only' };
  function laneKey(l) { return l.rental && l.sale ? 'both' : l.rental ? 'rental' : 'sale'; }
  function ladder(all, lane) {
    var alt = TIERS.map(function (t) {
      return 'Tier ' + t.n + ', ' + t.name + ': ' + all.filter(function (x) { return x.tier === t.n; }).map(function (x) { return x.short + ' (' + DOT[laneKey(x.lanes)].toLowerCase() + ')'; }).join(', ');
    }).join('. ') + '.';
    return '<figure class="ah-ladder" role="img" aria-label="' + esc('The four tiers of moves a town can make. ' + alt) + '">' +
      '<figcaption class="ah-cap">Tap a move to read why it sits in its tier.</figcaption><ol class="ah-rungs" aria-hidden="true">' + TIERS.map(function (t) {
        return '<li class="ah-rung ah-rung-' + t.n + '"><p class="ah-rung-name"><span class="ah-rung-n">' + t.n + '</span>' + esc(t.name) + '</p><ul class="ah-dots">' +
          all.filter(function (x) { return x.tier === t.n; }).map(function (x) {
            var k = laneKey(x.lanes), off = lane !== 'all' && !x.lanes[lane];
            return '<li class="ah-dot ah-dot-' + k + (off ? ' ah-off' : '') + '"><a href="' + ROUTE + (lane !== 'all' ? '?lane=' + lane + '&' : '?') + 'at=ah-' + esc(x.id) + '" data-jump="ah-' + esc(x.id) + '">' + esc(x.short) + '</a></li>';
          }).join('') + '</ul></li>';
      }).join('') + '</ol>' +
      '<p class="ah-key" aria-hidden="true">' + Object.keys(DOT).map(function (k) { return '<span class="ah-dot ah-dot-' + k + '">' + esc(DOT[k]) + '</span>'; }).join(' ') + '</p>' +
      '<p class="metric-source">Source: tiers 1 and 2 from ' + cite(['qap']) + ' and ' + cite(['dola']) + '; tiers 3 and 4 from the Local Incentives tool catalog. The order inside tiers 3 and 4 is our judgment.</p></figure>';
  }

  function laneSwitch(lane) {
    var opts = [['all', 'All homes'], ['rental', 'Rental'], ['sale', 'For-sale']];
    return '<nav class="ah-lanes" aria-label="Show moves for">' + opts.map(function (o) {
      return '<a href="' + ROUTE + (o[0] === 'all' ? '' : '?lane=' + o[0]) + '"' + (o[0] === lane ? ' aria-current="true" class="on"' : '') + '>' + esc(o[1]) + '</a>';
    }).join('') + '</nav>';
  }

  function top5(all, lane) {
    var five = all.filter(function (x) { return lane === 'all' || x.lanes[lane]; }).slice(0, 5);
    return '<ol class="ah-top">' + five.map(function (x, i) {
      return '<li><span class="ah-top-n">' + (i + 1) + '</span><a href="' + ROUTE + (lane !== 'all' ? '?lane=' + lane + '&' : '?') + 'at=ah-' + esc(x.id) + '" data-jump="ah-' + esc(x.id) + '"><strong>' + esc(x.title) + '</strong></a><span class="ah-top-why">' + esc(x.kind === 'rule' ? x.why.split('. ')[0].replace(/\.$/, '') + '.' : x.what) + '</span></li>';
    }).join('') + '</ol>';
  }

  function lanesText(l) { return l.rental && l.sale ? 'Rental and for-sale' : l.rental ? 'Rental' : 'For-sale'; }
  function card(x, lane) {
    var off = lane !== 'all' && !x.lanes[lane];
    var tags = '<p class="ah-tags"><span class="scope-tag">Tier ' + x.tier + '</span><span class="scope-tag">' + esc(lanesText(x.lanes)) + '</span></p>';
    if (x.kind === 'rule') {
      return '<article class="ah-card ah-tier-' + x.tier + (off ? ' ah-off' : '') + '" id="ah-' + esc(x.id) + '" tabindex="-1"><h3>' + esc(x.title) + '</h3>' + tags +
        '<p>' + esc(x.what) + '</p><p><strong>Why it ranks here.</strong> ' + esc(x.why) + '</p><p class="ah-speed"><strong>How fast.</strong> ' + esc(x.speed) + '</p>' + src(x.src) + '</article>';
    }
    var basis = x.basis.map(function (b) { var u = (b.source || {}).url; return /^https:/.test(u || '') ? '<a href="' + esc(u) + '">' + esc(b.citation) + '</a>' : esc(b.citation); });
    return '<article class="ah-card ah-tier-' + x.tier + (off ? ' ah-off' : '') + '" id="ah-' + esc(x.id) + '" tabindex="-1"><h3>' + esc(x.title) + '</h3>' + tags +
      '<p>' + esc(x.what) + '</p>' + (x.note ? '<p>' + esc(x.note) + '</p>' + src(x.src) : '') +
      '<p class="ah-speed"><strong>Colorado law.</strong> ' + esc(LAW[x.law] || x.law) + '.</p>' +
      '<p class="ah-record"><strong>' + (x.law === 'required_for_subject_jurisdictions' ? 'Required where state law applies' : x.places + ' Colorado ' + (x.places === 1 ? 'place has' : 'places have') + ' it on record') + '.</strong> <a href="#/places/incentives">See who →</a></p>' +
      (basis.length ? '<p class="metric-source">Colorado legal basis: ' + basis.join('; ') + '.</p>' : '') + '</article>';
  }

  // ---- Check a town: the three gates DOLA lists for every county and municipality ----------------
  function cleanName(n) { return String(n || '').replace(/ \((city|town|CDP)\)$/i, ''); }
  function options(m) {
    var list = [];
    m.geo.forEach(function (g) { if (g.kind !== 'cdp') list.push({ id: g.geoid, name: cleanName(g.name) }); });
    var seen = {};
    list = list.filter(function (o) { var c = global.LocalIncentivesData.canonicalGeoid(o.id); if (seen[c]) return false; seen[c] = true; return true; });
    return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function filingFor(d, m, subjectId) {
    var D = global.LocalIncentivesData;
    return (((d.prop123.next_cycle || {}).filings) || []).filter(function (f) {
      var id = D.resolveFilingName(f.name, m.geo);
      return id && D.canonicalGeoid(id) === D.canonicalGeoid(subjectId);
    })[0] || null;
  }
  function fastTrackOnly(d, m, subjectId) {
    var D = global.LocalIncentivesData;
    return (d.prop123.fast_track_without_cycle1_commitment || []).filter(function (f) {
      var id = D.resolveFilingName(f.name, m.geo);
      return id && D.canonicalGeoid(id) === D.canonicalGeoid(subjectId);
    })[0] || null;
  }
  // DOLA's own key on its status sheet.
  var STATUS = {
    'Approved': 'DOLA approved the commitment; the place is fully compliant.',
    'Contingent Approval': 'The place is not yet fully compliant with its 2024-2026 commitment. DOLA approves the new one once it is. If it misses the 2024-2026 goal, it loses Prop 123 eligibility for 2027.',
    'Pending': 'DOLA is still reviewing the filing, or has asked for changes.'
  };
  function gate(ok, label, text, source, missWord) {
    return '<li class="ah-gate ' + (ok ? 'ah-yes' : 'ah-no') + '"><p class="ah-gate-head"><span class="ah-pill">' + (ok ? 'On DOLA’s list' : esc(missWord || 'Not on DOLA’s list')) + '</span> <strong>' + esc(label) + '</strong></p><p>' + text + '</p>' + source + '</li>';
  }
  function townCheck(d, m, g) {
    var D = global.LocalIncentivesData, opts = options(m);
    var pick = '<label class="opp-menu ah-pick"><span>Town or county</span><select data-ah-pick="g"><option value="">Choose one</option>' + opts.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (o.id === g ? ' selected' : '') + '>' + esc(o.name) + '</option>';
    }).join('') + '</select></label>';
    var body = '';
    var p = g ? m.profile(g) : null;
    if (g && !p) body = '<p class="callout">No Colorado county or municipality has the ID ' + esc(g) + '.</p>';
    else if (p) {
      var subject = p.inheritsFrom || p.geoid, name = cleanName(m.geo.get(subject).name);
      var j = p.prop123, next = (j && j.next_cycle) || filingFor(d, m, subject), ftOnly = fastTrackOnly(d, m, subject);
      var src123 = d.prop123.sources || {}, ftDate = ((src123.fast_track || {}).sheet_last_updated) || d.prop123.updated;
      var ftOk = !!(j && j.fast_track) || !!ftOnly;
      var ft = gate(ftOk, 'Fast-track review verified',
        ftOk ? esc(name) + '’s fast-track policy is on DOLA’s verified list' + ((j && j.fast_track_adopted) || (ftOnly && ftOnly.fast_track_adopted) ? ', adopted ' + esc((j && j.fast_track_adopted) || ftOnly.fast_track_adopted) : '') + (j && j.fast_track_instrument ? ' (' + esc(j.fast_track_instrument) + ')' : '') + '.'
          : esc(name) + ' is not on DOLA’s verified list. Without a verified policy by 1 January 2027, projects there lose Prop 123 eligibility. A policy adopted recently may not be listed yet, so check with DOLA.',
        T.source('DOLA fast-track list', (src123.fast_track || {}).page || S.fastTrack.u, 'sheet updated ' + ftDate));
      var cm = gate(!!next, '2027-2029 commitment filed',
        next ? esc(name) + ' filed on ' + esc(next.submitted) + (next.unit_goal != null ? ', with a goal of ' + esc(String(next.unit_goal)) + ' affordable homes' : ', with no goal stated yet') + '. ' + (STATUS[next.status] ? 'DOLA’s status: <strong>' + esc(next.status) + '</strong>. ' + esc(STATUS[next.status]) : '')
          : esc(name) + ' is not on DOLA’s status sheet of 2027-2029 filings. ' + (j ? 'For 2024-2026 it filed, with status ' + esc(j.status) + '.' : 'It has no 2024-2026 filing on DOLA’s list.') + ' A town that did not file by 1 November 2026 gets no Prop 123 money in 2027, and can file by 1 November 2027, for 2028.',
        T.source('DOLA commitment status sheet', ((src123.fully_compliant || {}).sheet) || S.status.u, 'as of ' + d.prop123.updated));
      var row = d.laws.jurisdictions[D.canonicalGeoid(subject)] || d.laws.jurisdictions[subject] || null;
      var hna = row && row.hna_approved || [], req = row && row.laws && row.laws['sb24-174-hna'];
      var hm = d.laws.meta.hna_approved_source || {};
      var hn = gate(hna.length > 0, 'Needs assessment approved by DOLA',
        (hna.length ? hna.map(function (h) { return '<a href="' + esc(h.url) + '">' + esc(h.title) + '</a>, ' + esc(h.date); }).join('; ') + '.'
          : esc(name) + ' is not on DOLA’s list of approved assessments.') + (req ? ' What state law asks of ' + esc(name) + ': ' + esc(req) + '.' : ''),
        T.source(hm.label || 'DOLA approved housing needs assessments', hm.url || S.plans.u, 'as of ' + (hm.as_of || '')));
      body = (p.inheritsFrom ? '<p class="note">' + esc(cleanName(p.name)) + ' is a CDP, so ' + esc(name) + '’s answers apply.</p>' : '') + '<ul class="ah-gates">' + ft + cm + hn + '</ul>' +
        '<p><a class="button-link secondary" href="#/places/incentives/' + esc(subject) + '">Fees, land and funds on record for ' + esc(name) + ' →</a></p>';
    }
    return '<section id="ah-check" tabindex="-1" class="ah-sec"><h2>Check a town</h2><p>DOLA publishes three lists that can be checked for any Colorado county or municipality. Together they show whether a place has passed the tier 1 gates. For fee waivers, land and local funds, open the place’s full incentives record.</p>' + pick + body + '</section>';
  }

  function params() { var h = location.hash || '', q = h.indexOf('?'); return new URLSearchParams(q > -1 ? h.slice(q + 1) : ''); }
  if (global.document) document.addEventListener('change', function (ev) {
    var k = ev.target.dataset && ev.target.dataset.ahPick;
    if (!k) return;
    var p = params();
    p.delete('at');
    if (ev.target.value) p.set(k, ev.target.value); else p.delete(k);
    history.replaceState(null, '', ROUTE + (p.toString() ? '?' + p.toString() : ''));
    Shell.render();
    var again = document.querySelector('[data-ah-pick="' + k + '"]');
    if (again) again.focus();
  });

  function view(params) {
    var s = UI.load(FILES);
    var crumbs = T.trail('places', 'How towns attract affordable housing');
    var title = 'How a Colorado town gets affordable homes built';
    if (!s.data || !global.LocalIncentivesData) return T.head({ kind: 'guide', crumbs: crumbs, title: title }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var d = s.data, m = build(d), all = moves(d, m);
    var lane = { rental: 'rental', sale: 'sale' }[params.get('lane')] || 'all';
    var g = params.get('g') || '';
    var p123 = d.prop123, ftSrc = (p123.sources || {}).fast_track || {};
    return T.head({
      kind: 'guide', crumbs: crumbs, title: title,
      // The page story (paul 11-06): the deadline that matters most leads; the order's basis moves to the line below.
      answer: 'By 1 January 2027 a town needs a 90-day fast-track review that DOLA has verified, or projects inside it lose Prop 123 money. ' + esc(String(p123.fast_track_count)) + ' places have one. Below are the first five moves, then every move in order.',
      meta: 'Rental and for-sale. The order comes from what state law and agency rules require and reward. It is not a prediction of any town’s chances.',
      facts: [
        { value: '1 Jan 2027', label: 'Deadline for a verified fast-track policy, or projects lose Prop 123 money', source: 'DOLA guidance', href: S.dola.u },
        { value: String(p123.fast_track_count), label: 'Places with a fast-track policy DOLA has verified', source: 'DOLA, sheet updated ' + (ftSrc.sheet_last_updated || p123.updated), href: ftSrc.page || S.fastTrack.u },
        { value: String(p123.commitment_met_count), label: 'Places DOLA lists as fully compliant for 2024-2026', source: 'DOLA, ' + p123.updated, href: ((p123.sources || {}).fully_compliant || {}).page || S.filings.u },
        { value: '7 pts', label: 'CHFA points for a housing authority as sole or majority general partner', source: 'CHFA QAP 5.B.4.b', href: S.qap.u }
      ]
    }) +
      laneSwitch(lane) +
      '<section id="ah-first" class="ah-sec"><h2>The first five moves' + (lane === 'all' ? '' : ' for ' + (lane === 'rental' ? 'rental' : 'for-sale') + ' homes') + '</h2>' + top5(all, lane) + '</section>' +
      // Where a town stands comes right after the five moves, so a reader can act on them (paul 11-06).
      townCheck(d, m, g) +
      T.means([
        { text: 'Tier 1 moves are gates: without them, a project in the town cannot get Prop 123 money or cannot compete for tax credits. The other tiers earn points, cut cost or keep projects coming.' }
      ]) +
      T.onThisPage([{ id: 'ah-check', title: 'Check a town' }, { id: 'ah-ladder', title: 'Every move' }, { id: 'ah-t1', title: 'Opens the door' }, { id: 'ah-t2', title: 'Earns points' }, { id: 'ah-t3', title: 'Cuts cost' }, { id: 'ah-t4', title: 'Keeps them coming' }, { id: 'ah-method', title: 'How we ranked' }], true) +
      '<section id="ah-ladder" tabindex="-1" class="ah-sec"><h2>Every move, by tier</h2>' + ladder(all, lane) + '</section>' +
      TIERS.map(function (t) {
        var moves = all.filter(function (x) { return x.tier === t.n; });
        var body = '<p class="ah-q">' + esc(t.q) + (t.n > 2 ? ' No rule sets the order here; it is our judgment of how much each move saves and how fast a town can act.' : '') + '</p>' +
          '<div class="ah-cards">' + moves.map(function (x) { return card(x, lane); }).join('') + '</div>';
        // Tiers 3 and 4 fold shut on the page (paul, 10 Nov: phone length); tiers 1 and 2 stay open.
        if (t.n > 2 && global.LabTpl && global.LabTpl.fold) return '<section id="ah-t' + t.n + '" tabindex="-1" class="ah-sec">' + global.LabTpl.fold(t.n + '. ' + esc(t.name), esc(t.q) + ' ' + moves.length + ' moves.', body, { id: 'ah-t' + t.n + '-h' }) + '</section>';
        return '<section id="ah-t' + t.n + '" tabindex="-1" class="ah-sec"><h2>' + t.n + '. ' + esc(t.name) + '</h2>' + body + '</section>';
      }).join('') +
      '<section id="ah-method" tabindex="-1" class="ah-sec"><h2>How we ranked</h2><ul class="mi-list">' +
      '<li><strong>Tier 1</strong> holds moves a state rule makes a gate: without them a project cannot get Prop 123 money, or cannot compete for tax credits.</li>' +
      '<li><strong>Tier 2</strong> holds moves a state rule rewards: CHFA scoring points or extra Prop 123 counting credit.</li>' +
      '<li><strong>Tiers 3 and 4</strong> hold the local tools in Colorado law. No state rule ranks them, so their order is our judgment, and each card shows how many Colorado places already use the tool.</li>' +
      '<li>There is no single score, and no forecast of whether a project will be funded. CHFA keeps its discretion: scoring “does not operate to vest in an Applicant or project any right” to credits.</li>' +
      '<li>Only Colorado rules and records are used. The CHFA plan covers rental tax credit deals; for-sale homes rely on Prop 123 and DOLA programs instead.</li></ul>' +
      src([['qap', 'Section 5, p. 41'], 'dola']) + '</section>' +
      T.next('What to do next', [{ href: '#/places/incentives', label: 'See what your town already has →' }, { href: '#/places', label: 'Open your town\u2019s needs assessment', secondary: true }, { href: '#/finder', label: 'Where 4% and 9% deals fit', secondary: true }]);
  }

  var hub = Shell.views.places;
  Shell.views.places = function (params, parts) {
    return parts && parts[1] === 'attract-housing' ? view(params) : hub(params, parts);
  };
  global.LabAttractHousing = { view: view, FILES: FILES, SOURCES: S, RULES: RULES, TOOLS: TOOLS, TIERS: TIERS, moves: moves };
})(window);
