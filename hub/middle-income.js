// Middle-income rental in Colorado (#/middle-income): who each program serves, how its rent and money work,
// and what the Deal Calculator does with it today. A lab addition to port (there is no live page yet; paul chose
// "Guide now, MIHTC model later" on 3 Nov 2026). Program rules are written here with a dated primary source each.
// Two parts come from the live site's own files at the pin: the CHFA property layer's MIHTC awards
// (data/chfa-lihtc.json) and the Prop 123 rural resort petitions (data/policy/prop123-rental-rules.json).
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc;
  var FILES = { chfa: 'data/chfa-lihtc.json', p123: 'data/policy/prop123-rental-rules.json' };

  // Primary sources, each with the date it was read or issued.
  var S = {
    law: { t: 'HB24-1316, Middle-Income Housing Tax Credit', u: 'https://leg.colorado.gov/bills/HB24-1316', d: 'signed 30 May 2024' },
    plan26: { t: 'CHFA 2026 MIHTC Allocation Plan (amended)', u: 'https://www.chfainfo.com/getattachment/72c474a6-bbe5-40d2-a889-784447fe09b5/2026-MIHTC-AllocationPlan-Amended.pdf', d: 'adopted 12 Mar 2026' },
    draft27: { t: 'CHFA 2027 MIHTC Allocation Plan, first draft', u: 'https://www.chfainfo.com/getattachment/d480fa92-248d-46ff-927c-d5b1608a7673/2027-MIHTC-Allocation-Plan-FirstDraft.pdf', d: 'hearing 29 Oct 2026' },
    award26: { t: 'CHFA 2026 MIHTC Award Report', u: 'https://www.chfainfo.com/getattachment/743ba3e4-5c64-4b1a-84d5-85d209bd1990/2026-MIHTC-Award-Report.pdf', d: 'as of 24 Jul 2026' },
    mihtc: { t: 'CHFA MIHTC page', u: 'https://www.chfainfo.com/rental-housing/housing-credit/middle-income-housing-tax-credit-mihtc', d: 'read 3 Nov 2026' },
    chfaLimits: { t: 'CHFA 2026 income and rent limits', u: 'https://www.chfainfo.com/getattachment/620a2abf-e2d3-44a6-868b-4318906acc3e/2026-Rent-and-income-limits.pdf', d: 'effective 1 May 2026' },
    equity: { t: 'Prop 123 Equity Program Guidelines v5', u: 'https://coloradoaffordablehousingfinancingfund.com/wp-content/uploads/2026/01/Prop123-CO-AHFF-EquityProgramGuidelines-V5.pdf', d: '26 Jan 2026' },
    p123law: { t: 'HB26-1360, reprinting C.R.S. 29-32-104(1)(b)', u: 'https://leg.colorado.gov/laws/session-laws/HB26-1360/192/download', d: 'approved 28 May 2026' },
    debt: { t: 'HB23-1304, C.R.S. 29-32-104(1)(c)(V)(A)', u: 'https://leg.colorado.gov/sites/default/files/documents/2023A/bills/sl/2023a_sl_381.pdf', d: 'approved 5 Jun 2023' },
    petitions: { t: 'DOLA, rural resort income limit petitions', u: 'https://cdola.colorado.gov/rural-resort-income-limit-petition-process', d: 'read 14 Oct 2026' },
    irc: { t: 'IRC §42(g)(1)', u: 'https://www.law.cornell.edu/uscode/text/26/42', d: 'current' },
    iz: { t: 'HB21-1117, local rental inclusionary housing', u: 'https://leg.colorado.gov/bills/hb21-1117', d: '2021' },
    denver: { t: 'Otten Johnson, Denver Expanding Housing Affordability ordinance', u: 'https://www.ottenjohnson.com/news/denver-city-council-passes-expanding-housing-affordability-ordinance-and-related-changes-to-zoning-code/', d: 'passed 6 Jun 2022' }
  };
  function cite(k, extra) { var s = S[k]; return '<a href="' + esc(s.u) + '">' + esc(s.t) + '</a>' + (extra ? ', ' + esc(extra) : '') + ', ' + esc(s.d); }
  function src(keys) { return '<p class="metric-source">Source: ' + keys.map(function (k) { return Array.isArray(k) ? cite(k[0], k[1]) : cite(k); }).join('; ') + '.</p>'; }
  function sec(id, title, body) { return '<section id="' + id + '" tabindex="-1" class="mi-sec"><h2>' + esc(title) + '</h2>' + body + '</section>'; }

  // Who each program serves, on one 0-160% AMI scale. lo/hi are the income band; avg is a required project
  // average, drawn as a tick. A dashed end means a rural resort or petition limit above the usual one.
  var BANDS = [
    { name: 'Federal tax credit (9% and 4%)', lo: 20, hi: 80, avg: 60, color: 'var(--pine)', note: 'Under income averaging, each unit is 20% to 80% AMI and the units average 60% or less. Under the older tests, units are held at 50% or 60% AMI.', src: ['irc'] },
    { name: 'Prop 123 concessionary debt', lo: 0, hi: null, avg: 60, color: 'var(--c-blue)', note: 'Project average 60% AMI or less. No per-unit limit is set; up to 25% of units can be unrestricted but are left out of the loan.', src: ['debt'] },
    { name: 'Prop 123 Equity', lo: 0, hi: null, avg: 90, color: 'var(--c-violet)', note: 'Project average 90% AMI or less. Single units can sit above or below 90%.', src: ['p123law', 'equity'] },
    { name: 'Middle-income credit (MIHTC)', lo: 80, hi: 120, ext: 140, color: 'var(--c-amber)', note: 'Each MIHTC unit 80% to 120% AMI, up to 140% in rural resort counties.', src: ['law', ['plan26', 'p. 5']] }
  ];
  var MAX = 160;
  function x(v) { return (v / MAX * 100).toFixed(2) + '%'; }
  function bandChart() {
    var ticks = [0, 40, 80, 120, 160];
    return '<figure class="mi-chart" aria-label="' + esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })('Tax credit homes stop at 80% AMI; the middle-income credit serves 80% to 120%', 'IRC Section 42, HB24-1316')) + '"><figcaption id="mi-chart-t"><strong>Tax credit homes stop at 80% of area median income (AMI); the middle-income credit serves 80% to 120%, up to 140% in rural resort counties</strong><span class="mi-what">Income each program serves, as a share of AMI</span></figcaption>' +
      '<ul class="mi-rows">' + BANDS.map(function (b) {
        var hi = b.hi == null ? b.avg : b.hi;
        var label = b.hi == null ? 'project average ' + b.avg + '% AMI or less' : b.lo + '% to ' + b.hi + '% AMI' + (b.ext ? ' (' + b.ext + '% in resort counties)' : '') + (b.avg ? ', average ' + b.avg + '% or less' : '');
        return '<li><span class="mi-name">' + esc(b.name) + '</span><span class="mi-track" role="img" aria-label="' + esc(b.name + ': ' + label) + '">' +
          '<span class="mi-bar' + (b.hi == null ? ' mi-avg-only' : '') + '" style="left:' + x(b.lo) + ';width:' + x(hi - b.lo) + ';background:' + b.color + '"></span>' +
          (b.ext ? '<span class="mi-bar mi-ext" style="left:' + x(b.hi) + ';width:' + x(b.ext - b.hi) + ';border-color:' + b.color + '"></span>' : '') +
          (b.avg ? '<span class="mi-tick" style="left:' + x(b.avg) + '" title="average"></span>' : '') +
          '</span><span class="mi-label">' + esc(label) + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="mi-axis" aria-hidden="true">' + ticks.map(function (t) { return '<span style="left:' + x(t) + '">' + t + '%</span>'; }).join('') + '</div>' +
      '<p class="note">A solid bar is the income band each unit must fall in. A black tick is a required average across the restricted units. A faded bar is an average-only rule with no set floor. A hollow bar is the rural resort reach.</p></figure>' + bandSrc();
  }
  // Each program's rule and source, under the chart in the page head (Gemini round 10, pick A, paul 11-05).
  // One source line under the chart: every program rule it draws, each with its date.
  function bandSrc() {
    var keys = [];
    BANDS.forEach(function (b) { (b.src || []).forEach(function (k) { var id = Array.isArray(k) ? k[0] : k; if (keys.indexOf(id) < 0) keys.push(id); }); });
    return src(keys);
  }
  function bandNotes() {
    return '<dl class="mi-notes">' + BANDS.map(function (b) { return '<dt>' + esc(b.name) + '</dt><dd>' + esc(b.note) + ' ' + src(b.src) + '</dd>'; }).join('') + '</dl>';
  }

  // MIHTC awards in CHFA's property layer, with the homes CHFA records at each income band.
  function mihtcAwards(geo) {
    var f = geo.features || geo;
    return f.map(function (x) { return x.properties || x; }).filter(function (p) { return /MIHTC/.test(String(p.CREDIT || p.TypeOfCredits || '')); })
      .map(function (p) { var a = p.AMIUnits || {}; return { name: p.PROJECT || p.PROJECT_NAME || '', city: p.PROJ_CTY || p.City || '', year: +(p.YR_ALLOC || p.AwardYear), homes: +(p.N_UNITS || p.TOTAL_UNITS) || 0, at80: +a.ami80 || 0, at100: +a.ami100 || 0, at120: +a.ami120 || 0 }; })
      .sort(function (a, b) { return a.year - b.year || a.name.localeCompare(b.name); });
  }
  function approvedPetitions(rules) {
    var list = rules && rules.rural_resort_petitions && rules.rural_resort_petitions.petitions || [];
    return list.filter(function (p) { return p.status === 'approved'; });
  }

  function mihtcSection(awards, fetched) {
    var rows = awards.map(function (a) {
      return '<tr><th scope="row">' + esc(a.name) + '</th><td>' + esc(a.city) + '</td><td>' + a.year + '</td><td>' + a.homes + '</td><td>' + (a.at80 || '—') + '</td><td>' + (a.at100 || '—') + '</td></tr>';
    }).join('');
    return sec('mi-credit', 'The middle-income credit (MIHTC)',
      '<p>Colorado’s own credit for homes at 80% to 120% AMI. CHFA runs it beside the federal credit, with its own plan and round.</p>' +
      '<div class="mi-cards">' +
      card('5 years', 'The credit is taken over 5 years from placed in service, not the federal 10.', ['law']) +
      card('30%', 'Of qualified basis, over the whole 5 years, for new construction. Annual credit = eligible basis × applicable fraction × 30% ÷ 5.', [['plan26', 'pp. 23, 25']]) +
      card('$1.65M to $5M', 'Of annual MIHTC a project can apply for in 2026. The 2027 draft lowers the floor to $1M.', [['plan26', 'p. 22'], 'draft27']) +
      card('15 years', 'Minimum affordability, up to 40. Longer terms score better.', [['plan26', 'pp. 3, 10']]) +
      '</div>' +
      '<h3>How much there is</h3>' +
      '<p>$5 million of annual credit a year in 2025 and 2026, and $10 million a year in 2027 to 2029. Credit left after 2029 moves to the state affordable housing credit. In 2026 there is one competitive round (letters of intent 20 April, applications 18 May), then rolling applications while credit remains.</p>' +
      src(['law', ['plan26', 'p. 13']]) +
      '<h3>Rents: not yet written down</h3>' +
      '<p>Neither the law nor the 2026 plan sets a rent formula for MIHTC units. Rents go on CHFA’s Unit Mix and Rents worksheet. The plan’s market study rules assume a household pays up to 40% of income for the maximum MIHTC rent, gross of utilities. CHFA publishes 110% and 120% AMI rent tiers in its 2026 limits, but no plan names them as the MIHTC cap. Confirm the rent with CHFA before you underwrite.</p>' +
      src([['plan26', 'p. 40'], 'chfaLimits']) +
      '<h3>Awards so far</h3>' +
      (rows ? '<div class="table-wrap mi-table-wrap"><table class="mi-table"><caption>MIHTC properties in CHFA’s property records</caption><thead><tr><th scope="col">Property</th><th scope="col">City</th><th scope="col">Year</th><th scope="col">Homes</th><th scope="col">At 80% AMI</th><th scope="col">At 100% AMI</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="metric-source">Source: <a href="https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/HousingTaxCreditProperties_view/FeatureServer/layers">CHFA tax credit property records</a>, as published on the live site' + (fetched ? ', fetched ' + esc(String(fetched).slice(0, 10)) : '') + '.</p>' : '<p class="callout">CHFA’s property records list no MIHTC award yet.</p>') +
      '<p>CHFA’s 2026 award report lists one more: Lumberyard Apartments in Aspen, 118 MIHTC homes of 173, $2.89 million requested.</p>' + src(['award26']) +
      '<h3>What changes next</h3>' +
      '<p>CHFA held the hearing on its 2027 draft plan on 29 October 2026. The draft raises the credit to $10 million and lowers the smallest application to $1 million. Check the adopted plan before relying on any figure here.</p>' + src(['draft27', 'mihtc']));
  }
  function card(value, text, keys) { return '<div class="mi-card"><p class="mi-val">' + esc(value) + '</p><p>' + esc(text) + '</p>' + src(keys) + '</div>'; }

  function p123Section(pets) {
    var list = pets.length ? '<ul class="mi-pets">' + pets.map(function (p) {
      return '<li><strong>' + esc(p.jurisdiction) + '</strong>: rentals up to ' + p.ami_pct_rental + '% AMI for ' + esc(p.programs.map(function (k) { return k.replace(/_/g, ' '); }).join(', ')) + '</li>';
    }).join('') + '</ul>' : '<p class="callout">No approved petitions are on file.</p>';
    return sec('mi-p123', 'Prop 123 money for middle incomes',
      '<p><strong>Equity.</strong> The state fund buys an equity stake in rental projects whose restricted homes average 90% AMI or less. Each restricted home’s gross rent is at most 30% of its income limit. Homes stay restricted for 30 years.</p>' + src(['p123law', 'equity']) +
      '<p><strong>Concessionary debt.</strong> Low-rate loans for rentals that average 60% AMI or less, held for the longer of the loan term or 30 years. This serves lower incomes than the name suggests.</p>' + src(['debt']) +
      '<p><strong>Rural resort petitions.</strong> A rural resort town or county can ask DOLA to raise the income levels for Equity, Land Banking and Concessionary Debt. An approved petition holds for the current three-year cycle. Approved now:</p>' + list + src(['petitions']));
  }

  function localSection() {
    return sec('mi-local', 'Town and county deed restrictions',
      '<p>Since 2021, a Colorado town or county may require affordable homes in new rental projects. The rule must give the builder a choice of options, including at least one other than building the homes on site, such as a fee or homes built elsewhere. Before that, the Telluride ruling (2000) treated such rules for rentals as rent control.</p>' + src(['iz']) +
      '<p>Each town sets its own income levels and rents, so read the town’s code. For example, under Denver’s 2022 rules, a 100-home rental project in a typical market area can provide 8 homes at 60% AMI, or 12 homes averaging 70% AMI, or pay a fee in lieu.</p>' + src(['denver']));
  }

  function stackSection() {
    return sec('mi-stack', 'Putting them together',
      '<ul class="mi-list">' +
      '<li><strong>Mixed-income buildings.</strong> A project can hold federal tax credit homes and MIHTC homes. The MIHTC homes must be spread evenly through each building. Each home answers to its own program’s rules.' + src([['plan26', 'p. 21']]) + '</li>' +
      '<li><strong>The lower rent wins.</strong> When a home carries two restrictions, such as a tax credit and a town deed restriction, the lower income and rent limit applies.</li>' +
      '<li><strong>Prop 123 on top.</strong> Prop 123 Equity or a gap loan can sit in the same deal. Its averaging counts the restricted homes it funds.' + src(['equity']) + '</li>' +
      '</ul>');
  }

  function calcSection() {
    return sec('mi-calc', 'What the Deal Calculator does today',
      '<ul class="mi-list">' +
      '<li>Homes at 110% and 120% AMI are planning bands: their rents come from CHFA’s published tiers, and they earn no credit.</li>' +
      '<li>MIHTC is not sized yet. A deal of only middle-income homes shows no credit equity. It will be added when CHFA adopts its 2027 plan, so the rent rule and amounts are settled.</li>' +
      '<li>For Prop 123, choose the Prop 123 rent setting on the live Deal Calculator, with the program and any approved petition. Saved rent schedules use CHFA limits only.</li>' +
      '</ul>');
  }

  function view() {
    var s = UI.load(FILES);
    var crumbs = T.trail('policy', 'Middle-income rental');
    var title = 'Middle-income rental in Colorado';
    if (!s.data) return T.head({ kind: 'brief', crumbs: crumbs, title: title }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var awards = mihtcAwards(s.data.chfa), pets = approvedPetitions(s.data.p123);
    return T.head({
      kind: 'brief', crumbs: crumbs, title: title, strip: bandChart(),
      answer: 'Homes for households at 80% to 120% of area median income have three sources in Colorado: the state’s middle-income credit (MIHTC), Prop 123’s Equity program, and town deed restrictions. Each sets income, rent and years differently.',
      facts: [
        { value: '80–120%', label: 'AMI the middle-income credit serves (140% in resort counties)', source: 'HB24-1316', href: S.law.u },
        { value: '$5M → $10M', label: 'Annual MIHTC, 2026 to 2027–29', source: 'HB24-1316', href: S.law.u },
        { value: '90%', label: 'Prop 123 Equity project average AMI cap', source: 'C.R.S. 29-32-104(1)(b)', href: S.p123law.u },
        { value: String(awards.length), label: 'MIHTC properties in CHFA’s records', source: 'CHFA', href: S.mihtc.u }
      ]
    }) +
      T.onThisPage([{ id: 'mi-who', title: 'Who each serves' }, { id: 'mi-credit', title: 'MIHTC' }, { id: 'mi-p123', title: 'Prop 123' }, { id: 'mi-local', title: 'Deed restrictions' }, { id: 'mi-stack', title: 'Together' }, { id: 'mi-calc', title: 'In the calculator' }], true) +
      sec('mi-who', 'Who each program serves', '<p>The chart at the top of the page shows each program\u2019s income band. The rules behind it:</p>' + bandNotes()) +
      mihtcSection(awards, s.data.chfa && s.data.chfa.fetchedAt) + p123Section(pets) + localSection() + stackSection() + calcSection() +
      T.next('Next', [{ href: '#/deal-calculator', label: 'Test a LIHTC deal →' }, { href: '#/tax-credit-history', label: 'How tax credit deals have changed', secondary: true }]);
  }

  Shell.views['middle-income'] = view;
  global.LabMiddleIncome = { view: view, FILES: FILES, BANDS: BANDS, SOURCES: S, mihtcAwards: mihtcAwards, approvedPetitions: approvedPetitions };
})(window);
