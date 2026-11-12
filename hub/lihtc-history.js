// How Colorado's tax credit deals have changed (#/tax-credit-history): a history of the housing tax credit in
// Colorado from 1987, worked out when the page opens from the live site's own files: CHFA's tax credit property
// layer (one record per property, with allocation year, credit type, homes, development type, populations,
// income bands and region) and the equity pricing series. The rule changes and twinned awards are written here
// with a dated primary source each. There is no live page for this yet: it is a lab addition to port.
//
// Every figure is counted from the records; nothing is estimated. Where the records cannot show a trend
// (scattered sites, twinned buildings, pricing before September 2021) the page says so.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI, Viz = global.LabViz;
  var esc = Shell.esc;
  var FILES = { props: 'data/market/hud_lihtc_co.geojson', hist: 'data/market/lihtc-equity-pricing-history.json', bench: 'data/market/novogradac-equity-pricing.json' };
  var C = Viz.COLORS;
  var GREY = 'var(--grey)', SAND = 'var(--c-amber)';
  var CHFA_LAYER = 'https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/HousingTaxCreditProperties_view/FeatureServer/layers';
  var LII42 = 'https://www.law.cornell.edu/uscode/text/26/42';

  // Five-year periods; the first runs from the first awards to 1994, and the last takes in 2025.
  var PERIODS = [[1987, 1994], [1995, 1999], [2000, 2004], [2005, 2009], [2010, 2014], [2015, 2019], [2020, 2025]];
  function plabel(p) { return p[0] + '–' + String(p[1]).slice(2); }
  function periodOf(y) { for (var i = 0; i < PERIODS.length; i++) if (y >= PERIODS[i][0] && y <= PERIODS[i][1]) return i; return -1; }

  function num(v) { return Math.round(v).toLocaleString('en-US'); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  // "6% to 8%", from the smallest and largest of a set of percentages.
  function range(ps, f) { var v = ps.map(f), lo = Math.min.apply(null, v), hi = Math.max.apply(null, v); return lo === hi ? lo + '%' : lo + '% to ' + hi + '%'; }
  function link(text, href) { return '<a href="' + esc(href) + '">' + esc(text) + '</a>'; }
  function src(html) { return '<p class="metric-source">' + html + '</p>'; }
  function sec(id, title, body) { return '<section id="' + id + '" tabindex="-1" class="lh-sec"><h2>' + esc(title) + '</h2>' + body + '</section>'; }

  // One record per property, reduced to what the page counts. Credit kind: 9% (with or without state credit),
  // 4% (with or without state credit), or other (the middle-income credit). A record listing both is a twin.
  function records(geo) {
    return (geo.features || []).map(function (f) {
      var p = f.properties || {}, credit = String(p.CREDIT || p.TypeOfCredits || ''), y = +(p.YR_ALLOC || p.AwardYear);
      var has9 = /9%/.test(credit), has4 = /4%/.test(credit);
      return {
        name: p.PROJECT || p.PROJECT_NAME || '', year: y, pis: +p.YR_PIS || null, homes: +(p.N_UNITS || p.TOTAL_UNITS) || 0, li: +p.LI_UNITS || 0,
        kind: has9 && has4 ? 'both' : has9 ? '9' : has4 ? '4' : 'other', state: /State/.test(credit), toc: /TOC/.test(credit), mihtc: /MIHTC/.test(credit),
        rehab: /Rehab/i.test(p.ProjectType || ''), newc: /New Construction/i.test(p.ProjectType || ''), region: p.Region || '', setting: p.UrbanRural || '',
        pop: p.PopulationUnits || {}, ami: p.AMIUnits || {}
      };
    }).filter(function (r) { return r.year >= 1987 && r.year <= 2100; });
  }

  // Everything the page says, counted from the records. Exported so the test works the same figures.
  function analyze(geo) {
    var rs = records(geo), per = PERIODS.map(function (p) { return { label: plabel(p), from: p[0], to: p[1], rs: [] }; });
    rs.forEach(function (r) { var i = periodOf(r.year); if (i >= 0) per[i].rs.push(r); });
    per.forEach(function (p) {
      var L = p.rs, sum = function (f) { return L.reduce(function (t, r) { return t + f(r); }, 0); };
      p.n = L.length; p.homes = sum(function (r) { return r.homes; });
      p.med = median(L.map(function (r) { return r.homes; }));
      p.med9 = median(L.filter(function (r) { return r.kind === '9'; }).map(function (r) { return r.homes; }));
      p.med4 = median(L.filter(function (r) { return r.kind === '4'; }).map(function (r) { return r.homes; }));
      p.n9 = L.filter(function (r) { return r.kind === '9'; }).length; p.n4 = L.filter(function (r) { return r.kind === '4'; }).length;
      p.nOther = p.n - p.n9 - p.n4;
      p.h9 = sum(function (r) { return r.kind === '9' ? r.homes : 0; }); p.h4 = sum(function (r) { return r.kind === '4' ? r.homes : 0; });
      p.hOther = p.homes - p.h9 - p.h4;
      p.hNew = sum(function (r) { return r.newc && !r.rehab ? r.homes : 0; }); p.hRehab = sum(function (r) { return r.rehab && !r.newc ? r.homes : 0; });
      p.hMixed = p.homes - p.hNew - p.hRehab;
      p.nState = L.filter(function (r) { return r.state; }).length;
      var pop = { senior: 0, family: 0, hs: 0, other: 0 };
      L.forEach(function (r) { var u = r.pop; pop.senior += +u.senior || 0; pop.family += +u.family || 0; pop.hs += (+u.homeless || 0) + (+u.supportive || 0); pop.other += (+u.veteran || 0) + (+u.special || 0); });
      p.pop = pop; p.popTotal = pop.senior + pop.family + pop.hs + pop.other;
      var ami = { a30: 0, a50: 0, a60: 0, a80: 0, above: 0 };
      L.forEach(function (r) { var u = r.ami; ami.a30 += (+u.lte20 || 0) + (+u.ami30 || 0); ami.a50 += (+u.ami40 || 0) + (+u.ami50 || 0); ami.a60 += +u.ami60 || 0; ami.a80 += (+u.ami70 || 0) + (+u.ami80 || 0); ami.above += (+u.ami100 || 0) + (+u.ami120 || 0); });
      p.ami = ami; p.amiTotal = ami.a30 + ami.a50 + ami.a60 + ami.a80 + ami.above;
      var where = { metro: 0, front: 0, west: 0, rural: 0 };
      L.forEach(function (r) {
        if (r.region === 'Denver Metro') where.metro++;
        else if (['Larimer/Weld', 'El Paso/Teller', 'Pueblo'].indexOf(r.region) > -1) where.front++;
        else if (['Western Slope', 'Mountain Rural/Resort', 'Upper Arkansas Valley'].indexOf(r.region) > -1) where.west++;
        else where.rural++;
      });
      p.where = where;
      p.nRuralMtn = L.filter(function (r) { return r.setting === 'Rural' || r.setting === 'Mountain'; }).length;
    });
    var years = {};
    rs.forEach(function (r) { var y = years[r.year] = years[r.year] || { n9: 0, n4: 0 }; if (r.kind === '9') y.n9++; if (r.kind === '4') y.n4++; });
    var first = per[0], last = per[per.length - 1], firstYear = Math.min.apply(null, rs.map(function (r) { return r.year; })), lastYear = Math.max.apply(null, rs.map(function (r) { return r.year; }));
    var peak4 = Object.keys(years).reduce(function (b, y) { return !b || years[y].n4 > years[b].n4 ? y : b; }, null);
    return {
      rs: rs, per: per, years: years, first: first, last: last, firstYear: firstYear, lastYear: lastYear,
      total: rs.length, totalHomes: rs.reduce(function (t, r) { return t + r.homes; }, 0), peak4: +peak4, peak4n: years[peak4].n4,
      twinRecords: rs.filter(function (r) { return r.kind === 'both'; }).length, mihtc: rs.filter(function (r) { return r.mihtc; }).length,
      tocRecords: rs.filter(function (r) { return r.toc; }).length, firstState: Math.min.apply(null, rs.filter(function (r) { return r.state; }).map(function (r) { return r.year; }))
    };
  }

  // Rule changes that reshaped the deals, each with its primary source and date. Written by hand; checked 2026-11-02.
  var RULES = [
    { year: '1986', what: 'Congress creates the housing tax credit in the Tax Reform Act of 1986. Colorado’s first awards follow in 1987.', src: 'Pub. L. 99-514, 1986-10-22', href: LII42 },
    { year: '1993', what: 'The credit is made permanent; until then it had to be renewed.', src: 'Pub. L. 103-66, sec. 13142, 1993-08-10', href: LII42 },
    { year: '2000', what: 'Congress raises each state’s 9% ceiling to $1.75 a resident from 2002 (with $1.50 for 2001) and ties it to inflation. Colorado tries its own state credit as a two-year pilot, which lapses in 2002.', src: 'Pub. L. 106-554, 2000-12-21; Colorado Office of the State Auditor, April 2022', href: 'https://leg.colorado.gov/sites/default/files/images/committees/osa_housing_tax_expenditure_reports.pdf' },
    { year: '2008', what: 'The Housing and Economic Recovery Act sets a temporary 9% floor on the credit rate and lets state agencies give 9% buildings a basis boost of up to 30% outside federal QCTs and DDAs. CHFA’s discretionary boost comes from this.', src: 'Pub. L. 110-289, 2008-07-30', href: LII42 },
    { year: '2014', what: 'Colorado brings back the state credit (House Bill 14-1017): $5 million a year for 2015 to 2019, claimed over six years. Its first awards are in 2015.', src: 'C.R.S. 39-22-2102; State Auditor evaluation, April 2022', href: 'https://colorado.public.law/statutes/crs_39-22-2102' },
    { year: '2015', what: 'The 9% floor is made permanent.', src: 'Pub. L. 114-113, sec. 131, 2015-12-18', href: LII42 },
    { year: '2018', what: 'Income averaging lets a project mix homes from 20% to 80% AMI as long as the average stays at or under 60%. The 9% ceiling rises 12.5% for 2018 to 2021.', src: 'Pub. L. 115-141, secs. 102-103, 2018-03-23', href: LII42 },
    { year: '2020', what: 'Colorado’s state credit doubles to $10 million a year from 2020. In December, Congress sets a permanent 4% floor on the bond credit rate for buildings financed with bonds issued from 2021, which raised the credit each of those deals earns.', src: 'C.R.S. 39-22-2102(7); Pub. L. 116-260, 2020-12-27', href: LII42 },
    { year: '2024', what: 'Colorado adds more state credit for 2024 to 2031 and a new Transit-Oriented Communities credit (House Bill 24-1434), and creates a middle-income housing credit (House Bill 24-1316). CHFA makes the first middle-income awards in 2025.', src: 'HB24-1434 fiscal note; CHFA 2025 middle-income award report', href: 'https://leg.colorado.gov/sites/default/files/documents/2024A/bills/fn/2024a_hb1434_f1.pdf' },
    { year: '2025', what: 'Congress raises the 9% ceiling 12% for every year from 2026 and cuts the bond test for 4% deals from 50% of the building and land cost to 25%. CHFA raises its 9% cap to $1.8 million a year and drops the extra state credit it had set aside for twinned 4% deals.', src: 'Pub. L. 119-21, sec. 70422, 2025-07-04; CHFA 2025-26 QAP second amendment, adopted 2025-09-26', href: LII42 }
  ];
  // Awarded buildings that paired a 9% award with a 4% bond award, from CHFA's award reports.
  var TWINS = [
    { year: 2021, name: 'Joli and Sol (Sun Valley), Denver', what: '80 homes under 9% and 130 under 4%, on neighboring blocks', href: 'https://www.chfainfo.com/getattachment/73c04756-71db-42a0-a4fb-1d3a5f0ffb83/2021-Round-1-Award-Report.pdf', src: 'CHFA 2021 Round One award report, 2021-06-09' },
    { year: 2022, name: 'Willoughby Corner Phase 1, Lafayette', what: '63 senior homes under 9% and 129 family homes under 4%, in one phase', href: 'https://www.chfainfo.com/getattachment/5e11c07a-670e-42b2-b978-53f0a2db1635/2022-Round-2-Award-Report.pdf', src: 'CHFA 2022 Round One and Round Two award reports' },
    { year: 2024, name: 'Viña Senior Residences, Denver', what: '50 homes under 9% and 102 under 4%, in one building split into two condominiums', href: 'https://www.chfainfo.com/getattachment/a87d0b61-b330-44f7-9a73-382779f7ef11/2024-Round-One-Housing-Tax-Credit-Award-Report.pdf', src: 'CHFA 2024 Round One award report, 2024-07-26' },
    { year: 2025, name: 'Ives II, Wheat Ridge', what: '54 homes under 9% and 44 under 4%, in one building', href: 'https://www.chfainfo.com/getattachment/b90453bd-52f8-491f-be44-c7a431440afc/2025-Round-One-Housing-Tax-Credit-Award-Report.pdf', src: 'CHFA 2025 Round One award report, 2025-05-08' }
  ];

  function layerSource(d) { return src(link('CHFA housing tax credit properties', CHFA_LAYER) + ', fetched ' + esc(String(d.fetchedAt || '').slice(0, 10)) + '. One record per property, by the year credits were allocated.'); }

  function findings(a) {
    var f = a.first, l = a.last, p15 = a.per[5];
    return '<ul class="lh-find">' +
      '<li><strong>Deals got bigger.</strong> The median property allocated credits in ' + f.label + ' had ' + num(f.med) + ' homes. In ' + l.label + ' it had ' + num(l.med) + '.</li>' +
      '<li><strong>Bonds took over.</strong> 4% bond deals were ' + num(f.n4) + ' of ' + num(f.n) + ' properties in ' + f.label + ' and ' + pct(p15.n4, p15.n) + '% of them in ' + p15.label + '. The 9% round stayed at about a dozen awards a year.</li>' +
      '<li><strong>Deeper affordability.</strong> Homes for households at 30% of area median income or less went from ' + pct(f.ami.a30, f.amiTotal) + '% of restricted homes in ' + f.label + ' to ' + pct(l.ami.a30, l.amiTotal) + '% in ' + l.label + '.</li>' +
      '<li><strong>Wider income range.</strong> Homes at 70% and 80% AMI were almost absent before income averaging in 2018. They were ' + pct(l.ami.a80, l.amiTotal) + '% of homes in ' + l.label + '.</li>' +
      '<li><strong>Colorado added its own credit.</strong> The records first show the state credit on ' + a.firstState + ' allocations. In ' + l.label + ', ' + pct(l.nState, l.n) + '% of properties carried it.</li>' +
      '<li><strong>Supportive housing held steady.</strong> Homes for people leaving homelessness or needing services have been ' + range(a.per.slice(2), function (p) { return pct(p.pop.hs, p.popTotal); }) + ' of homes in every period since 2000.</li></ul>';
  }

  function sizeSection(a) {
    var rows = a.per.map(function (p) { return [p.label, p.med]; });
    return sec('lh-size', 'Bigger deals',
      '<p>Colorado’s tax credit properties have roughly doubled in size. The 9% credit is capped per project, so 9% deals stay modest. Bond deals carry no cap and have always been larger.</p>' +
      Viz.orderedBars({ title: 'Median homes per property, by allocation period', answer: num(a.first.med) + ' homes in ' + a.first.label + ', ' + num(a.last.med) + ' in ' + a.last.label + '.', rows: rows, noShare: true, color: C.pine }) +
      UI.table('lh-size-t', 'Median homes per property by credit type', [{ key: 'label', label: 'Allocated' }, { key: 'n', label: 'Properties', num: true, fmt: num },
        { key: 'med9', label: '9% median homes', num: true, fmt: function (v) { return v == null ? '—' : num(v); } }, { key: 'med4', label: '4% median homes', num: true, fmt: function (v) { return v == null ? '—' : num(v); } }], a.per, { noun: 'periods', placeholder: 'Period' }) +
      layerSource(a.meta));
  }

  function creditSection(a) {
    var ys = Object.keys(a.years).map(Number).sort(function (x, y) { return x - y; });
    var line = Viz.timeLines({ title: 'Properties allocated credits each year, 9% and 4%', answer: '4% bond deals peaked at ' + a.peak4n + ' in ' + a.peak4 + '.',
      series: [{ label: 'properties at 9% (latest year)', color: C.pine, points: ys.map(function (y) { return [y, a.years[y].n9]; }) }, { label: 'properties at 4% (latest year)', color: C.blue, points: ys.map(function (y) { return [y, a.years[y].n4]; }) }],
      fmt: function (v) { return num(v); }, note: 'Recent years fill in as CHFA records more deals, so the last two or three years may rise.' });
    return sec('lh-credit', 'From 9% to bonds',
      '<p>For its first decade Colorado’s program was almost all 9%. From the late 1990s, deals financed with tax-exempt private activity bonds, which earn the 4% credit without competing for it, became common, and after 2015 they were most of the properties. The 4% floor set in December 2020, for bonds issued from 2021, raised the credit each new bond deal earns.</p>' +
      Viz.stackedBars({ title: 'Homes by credit type, by allocation period', rows: a.per.map(function (p) { return [p.label, [p.h9, p.h4, p.hOther]]; }), parts: [['9%', C.pine], ['4% with bonds', C.blue], ['Both, or middle-income credit', GREY]], end: function (r) { return num(r[1][0] + r[1][1] + r[1][2]) + ' homes'; } }) +
      line + layerSource(a.meta));
  }

  function rehabSection(a) {
    var f = a.per, mx = f.reduce(function (b, p) { return !b || p.hRehab / p.homes > b.hRehab / b.homes ? p : b; }, null);
    return sec('lh-rehab', 'New homes and preservation',
      '<p>Credits pay to build new homes and to buy and fix up existing ones. The share going to acquisition and rehab peaked in ' + mx.label + ', at ' + pct(mx.hRehab, mx.homes) + '% of homes. In ' + f[f.length - 1].label + ' it was ' + pct(f[f.length - 1].hRehab, f[f.length - 1].homes) + '%.</p>' +
      Viz.stackedBars({ title: 'Homes by development type, by allocation period', rows: f.map(function (p) { return [p.label, [p.hNew, p.hRehab, p.hMixed]]; }), parts: [['New construction', C.homes], ['Acquisition or rehab', SAND], ['Both in one deal', GREY]], end: function (r) { return pct(r[1][1], r[1][0] + r[1][1] + r[1][2]) + '% rehab'; } }) +
      '<p>For properties that could leave the program, see ' + link('Preservation inventory', '#/opportunity/preservation') + '.</p>' + layerSource(a.meta));
  }

  function popSection(a) {
    var l = a.last, sr = a.per.reduce(function (b, p) { return !b || p.pop.senior / p.popTotal > b.pop.senior / b.popTotal ? p : b; }, null);
    return sec('lh-pop', 'Who the homes serve',
      '<p>Most tax credit homes in Colorado have always been for families. Senior homes peaked at ' + pct(sr.pop.senior, sr.popTotal) + '% in ' + sr.label + ' and were ' + pct(l.pop.senior, l.popTotal) + '% in ' + l.label + '. Homes for people leaving homelessness or needing supportive services have stayed at ' + range(a.per.slice(2), function (p) { return pct(p.pop.hs, p.popTotal); }) + ' since 2000. The records count homes set aside for these groups; they do not say which buildings are permanent supportive housing with services on site.</p>' +
      Viz.stackedBars({ title: 'Homes by population served, by allocation period', rows: a.per.map(function (p) { return [p.label, [p.pop.family, p.pop.senior, p.pop.hs, p.pop.other]]; }), parts: [['Families', C.blue], ['Seniors', C.purple], ['Homeless or supportive', C.households], ['Veterans and other special needs', GREY]], end: function (r) { return pct(r[1][2], r[1][0] + r[1][1] + r[1][2] + r[1][3]) + '% supportive'; } }) +
      '<p class="note">CHFA counts the homes set aside for each group. A property can serve more than one.</p>' + layerSource(a.meta));
  }

  function amiSection(a) {
    return sec('lh-ami', 'How deep the affordability goes',
      '<p>Early deals clustered at 50% and 60% of area median income, the two federal limits. The range has since spread both ways. Homes at 30% AMI or less grew from almost none to ' + pct(a.last.ami.a30, a.last.amiTotal) + '% in ' + a.last.label + '. Income averaging, allowed from 2018, lets a project add 70% and 80% AMI homes as long as the average stays at 60% or less, and those were ' + pct(a.last.ami.a80, a.last.amiTotal) + '%.</p>' +
      Viz.stackedBars({ title: 'Restricted homes by income limit, by allocation period', rows: a.per.map(function (p) { return [p.label, [p.ami.a30, p.ami.a50, p.ami.a60, p.ami.a80, p.ami.above]]; }), parts: [['30% AMI or less', C.households], ['40–50%', SAND], ['60%', C.blue], ['70–80%', C.purple], ['Above 80%', GREY]], end: function (r) { return pct(r[1][0], r[1].reduce(function (t, x) { return t + x; }, 0)) + '% at 30% or less'; } }) +
      '<p class="note">Limits are as CHFA records them for each property today. Most of the homes above 80% AMI are in late-1990s mixed-income deals.</p>' + layerSource(a.meta));
  }

  function whereSection(a) {
    var f = a.first, l = a.last;
    return sec('lh-where', 'Where the deals go',
      '<p>In ' + f.label + ', ' + pct(f.nRuralMtn, f.n) + '% of properties were in rural or mountain areas. Since 2000 that share has stayed at ' + range(a.per.slice(2), function (p) { return pct(p.nRuralMtn, p.n); }) + ', and the Denver metro has had well over half of new properties.</p>' +
      Viz.stackedBars({ title: 'Properties by region, by allocation period', rows: a.per.map(function (p) { return [p.label, [p.where.metro, p.where.front, p.where.west, p.where.rural]]; }), parts: [['Denver metro', C.pine], ['Other Front Range', C.blue], ['Western Slope and mountains', C.homes], ['Eastern Plains and San Luis Valley', SAND]], end: function (r) { return num(r[1].reduce(function (t, x) { return t + x; }, 0)) + ' properties'; } }) +
      '<p class="note">Regions are CHFA’s. Other Front Range is Larimer/Weld, El Paso/Teller and Pueblo; Western Slope and mountains adds Mountain Rural/Resort and the Upper Arkansas Valley.</p>' + layerSource(a.meta));
  }

  function rulesSection() {
    return sec('lh-rules', 'Rule changes that reshaped the deals',
      '<ol class="lh-rules">' + RULES.map(function (r) {
        return '<li><span class="lh-yr">' + esc(r.year) + '</span><div><p>' + esc(r.what) + '</p>' + src(link(r.src, r.href)) + '</div></li>';
      }).join('') + '</ol>');
  }

  function shapesSection(a) {
    var l = a.last;
    return sec('lh-shapes', 'New deal shapes',
      '<h3>State credit on top of federal</h3><p>Since 2015 CHFA has paired Colorado’s own credit with both 9% and 4% deals. In ' + l.label + ', ' + num(l.nState) + ' of ' + num(l.n) + ' properties carried it. ' + num(a.tocRecords) + ' properties also carry the Transit-Oriented Communities credit, and ' + num(a.mihtc) + ' the middle-income credit, both new in 2024.</p>' +
      '<h3>Twinned 9% and 4% buildings</h3><p>A few recent deals pair a 9% award and a 4% bond award on one site or in one building. CHFA’s award reports show these four:</p>' +
      '<ul class="lh-twins">' + TWINS.map(function (t) { return '<li><strong>' + esc(t.year + ': ' + t.name) + '.</strong> ' + esc(t.what) + '. ' + link(t.src, t.href) + '</li>'; }).join('') + '</ul>' +
      '<p class="note">The property records list Sun Valley and Willoughby Corner as two properties each, Ives II as one, and only the 4% half of Viña so far. The charts above count each listed half by its own credit.</p>' +
      '<h3>Scattered sites</h3><p>Federal law treats buildings on separate sites as one project only if every home in them is a tax credit home (' + link('26 U.S.C. 42(g)(7)', LII42) + '). CHFA’s property records do not mark which properties are scattered-site, so this page cannot count them over time.</p>');
  }

  function pricingSection(h, b) {
    var q = h.quarterly || [], co = b.pricing && b.pricing.by_state && b.pricing.by_state.CO;
    if (q.length < 2) return sec('lh-price', 'What the credit sells for', '<p class="callout">The pricing series did not load.</p>');
    var a0 = q[0], a1 = q[q.length - 1], qn = function (s) { var m = /^(\d{4})-Q(\d)$/.exec(s); return m ? new Date(+m[1], (+m[2] - 1) * 3 + 1, 15) : null; };
    return sec('lh-price', 'What the credit sells for',
      '<p>Investors buy credits for less than face value. What they pay sets how much equity a deal raises. ' + (co ? 'Novogradac puts Colorado’s median at $' + (+co.median_all_credits).toFixed(2) + ' per dollar of credit for 9% and 4% together (' + esc(b.meta.vintage) + '). ' : '') + 'It splits 9% and 4% only nationally, shown here as the market reference.</p>' +
      Viz.timeLines({ title: 'National price per $1 of credit, ' + a0.quarter + ' to ' + a1.quarter, answer: '9% went from $' + (+a0.nine).toFixed(2) + ' to $' + (+a1.nine).toFixed(2) + '; 4% from $' + (+a0.four).toFixed(2) + ' to $' + (+a1.four).toFixed(2) + '.', zero: false,
        series: [{ label: '9% credits', color: C.pine, points: q.map(function (r) { return [qn(r.quarter), +r.nine]; }) }, { label: '4% credits', color: C.blue, points: q.map(function (r) { return [qn(r.quarter), +r.four]; }) }],
        fmt: function (v) { return '$' + v.toFixed(2); }, source: link('Novogradac, LIHTC equity pricing trends', h.meta.source_url) + ', captured ' + esc(h.meta.captured) }) +
      '<p>Novogradac does not publish a 9% and 4% split before September 2021, so this page does not show pricing for earlier years. More on pricing is on ' + link('Tax credit equity markets', '#/equity-pricing') + '.</p>');
  }

  function limitsSection(a) {
    return sec('lh-limits', 'What these records can and cannot show',
      '<ul><li>The records are CHFA’s current monitoring list of tax credit properties. A property that has left CHFA’s monitoring is missing, so the earliest periods count only the properties still on the list and trends from them lean toward the deals that lasted. The file is named for HUD’s database, but it holds the same CHFA records, so it is not a second count. The list has ' + num(a.total) + ' properties allocated from ' + a.firstYear + ' to ' + a.lastYear + '.</li>' +
      '<li>Years are when credits were allocated, not when buildings opened. Recent years fill in as deals close.</li>' +
      '<li>Income limits and populations are as CHFA records them for each property now.</li>' +
      '<li>The records do not mark scattered-site projects or which properties were built as twins.</li></ul>');
  }

  function view() {
    var s = UI.load(FILES);
    var crumbs = T.trail('policy', 'How tax credit deals have changed');
    if (!s.data) return T.head({ kind: 'brief', crumbs: crumbs, title: 'How Colorado’s tax credit deals have changed' }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var a = analyze(s.data.props); a.meta = s.data.props;
    var l = a.last, f = a.first;
    return T.head({
      kind: 'brief', crumbs: crumbs, title: 'How Colorado’s tax credit deals have changed',
      answer: num(a.total) + ' properties in CHFA’s current monitoring list were allocated housing tax credits from ' + a.firstYear + ' to ' + a.lastYear + '. Deals have grown from a median of ' + num(f.med) + ' homes to ' + num(l.med) + ', most now use bonds and the 4% credit, and more homes serve the lowest incomes. Early years count only properties still on the list, so they undercount what was built then.',
      facts: [
        { value: num(a.total), label: 'Properties in CHFA’s current monitoring list, allocated ' + a.firstYear + '–' + a.lastYear, source: 'CHFA', href: CHFA_LAYER },
        { value: num(a.totalHomes), label: 'Homes in them', source: 'CHFA', href: CHFA_LAYER },
        { value: num(l.med), label: 'Median homes per property, ' + l.label, source: 'CHFA', href: CHFA_LAYER },
        { value: pct(l.n4, l.n) + '%', label: 'Share that were 4% bond deals, ' + l.label, source: 'CHFA', href: CHFA_LAYER }
      ]
    }) +
      T.onThisPage([{ id: 'lh-story', title: 'The short story' }, { id: 'lh-size', title: 'Bigger deals' }, { id: 'lh-credit', title: '9% to bonds' }, { id: 'lh-rehab', title: 'Preservation' },
        { id: 'lh-pop', title: 'Who it serves' }, { id: 'lh-ami', title: 'Affordability' }, { id: 'lh-where', title: 'Where' }, { id: 'lh-rules', title: 'Rule changes' },
        { id: 'lh-shapes', title: 'New deal shapes' }, { id: 'lh-price', title: 'Pricing' }, { id: 'lh-limits', title: 'Limits' }], true) +
      sec('lh-story', 'The short story', findings(a)) +
      sizeSection(a) + creditSection(a) + rehabSection(a) + popSection(a) + amiSection(a) + whereSection(a) + rulesSection() + shapesSection(a) +
      pricingSection(s.data.hist, s.data.bench) + limitsSection(a) +
      T.next('Next', [{ href: '#/opportunity/portfolio', label: 'See every property →' }, { href: '#/equity-pricing', label: 'Tax credit equity markets', secondary: true }]);
  }

  Shell.views['tax-credit-history'] = view;
  global.LabLihtcHistory = { view: view, FILES: FILES, analyze: analyze, RULES: RULES, TWINS: TWINS, PERIODS: PERIODS };
})(window);
