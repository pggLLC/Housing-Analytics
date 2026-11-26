// Home and Housing help, rebuilt (gaps doc, paul 30 Oct "build home and help").
//   #/            Home: find a place, member access (paul 5 Nov: sell it, no free-tools list), the seven steps from a town to a deal, and where
//                 else to start. Statewide figures are the AMI gap file's own totals.
//   #/assistance  Housing help: renting, buying and keeping a home. Buyer programs and homebuyer classes come
//                 from the public site's watchlist (data/policy/homeownership-programs.json). The renter
//                 contacts are the "Start here" cards of the live renter page (housing-help.html, checked
//                 29 Oct 2026); the page links there for the full list in English and Spanish.
// The original link-list views in shell.js stay as the fallback if this file does not load.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI, Pl = global.LabPlaces;
  var esc = Shell.esc, num = Pl.num;
  var LIVE = Pl.LIVE;
  var PROGRAMS = { watch: 'data/policy/homeownership-programs.json' };

  // ---- Home --------------------------------------------------------------------------------------
  var TOOLS = [
    ['1', 'Housing Needs Assessment', 'Who lives here, what they earn, what homes exist and how many more are needed.', '#/places', '#/place/0828745'],
    ['2', 'Market check', 'Renters, rents against the tax credit limit, supply and a capture rate.', '#/market', '#/market?g=0828745'],
    ['3', 'For-sale and ownership', 'What each income can pay for a home, and how resale formulas work.', '#/for-sale', '#/for-sale?g=0828745'],
    ['4', 'Free report', 'A printable needs and market summary for any place.', '#/report', '#/report?g=0828745']
  ];

  // The live homepage's own figures (js/index.js), read from the same files. A figure a file cannot support
  // is left as a dash, never a 0.
  var HOME_FILES = {
    snap: 'data/home-snapshot.json', aa: 'data/hna/chas_affordable_available.json', gap: 'data/co_ami_gap_by_county.json',
    proj: 'data/hna/projections/08.json', burden: 'data/hna/chas_affordability_gap.json'
  };
  // The statewide ACS profile (data/hna/summary/08.json). The hosted preview packs the per-place summary files
  // into bundles (LAB_HNA_LOAD), so it is read on its own, the way places-state.js reads one; until it arrives
  // the households figure shows a dash.
  var stateSum = null;
  function stateSummary() {
    if (stateSum) return stateSum;
    stateSum = { data: null };
    var VENDOR = global.LAB_VENDOR;
    (global.LAB_HNA_LOAD ? global.LAB_HNA_LOAD('08').then(function (r) { return r[1]; })
      : fetch(VENDOR + 'data/hna/summary/08.json').then(function (r) { if (!r.ok) throw new Error('summary ' + r.status); return r.json(); }))
      .then(function (sum) { stateSum.data = sum; Shell.render(); }).catch(function () { stateSum.data = false; });
    return stateSum;
  }
  var HSRC = {
    dp04: 'https://data.census.gov/table/ACSDP5Y2024.DP04', dp03: 'https://data.census.gov/table/ACSDP5Y2024.DP03',
    b25070: 'https://data.census.gov/table/ACSDT5Y2024.B25070', b25119: 'https://data.census.gov/table/ACSDT5Y2024.B25119', b25118: 'https://data.census.gov/table/ACSDT5Y2024.B25118',
    chas: 'https://www.huduser.gov/portal/datasets/cp.html', dola: 'https://demography.dola.colorado.gov/',
    chfa: 'https://www.chfainfo.com/rental-housing/housing-credit'
  };
  // The state's own 2026 count (paul, 17 Nov "fix the home burden line"): Colorado Housing Needs Assessment, Statewide
  // Analysis, State Demography Office and Division of Housing, Nov 2026, p.10 ("Nearly 34% ... renters (49%) ... owners
  // (25%) ... 843,100 households"). The report, not the press release (842,900 / 26%), is the source of record.
  var STATE_HNA = {
    households: 843100, allPct: 34, renterPct: 49, ownerPct: 25, year: 2026,
    cite: '<a href="https://drive.google.com/uc?export=download&id=1T9pIRab6usCUyPfg7C3n-D9YSDTD3IS4">Colorado Housing Needs Assessment, DOLA, Nov 2026, p.10</a>'
  };
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function cnt(v) { return fin(v) && v >= 0 ? num(v) : '—'; }

  // Statewide figures. Every one is the file's own value, or a sum the live page's text already states.
  function homeFigures(d) {
    var f = {};
    var v = (d.snap && d.snap.values) || {};
    var measured = function (x) { return x == null || x === '' ? NaN : Number(x); };
    f.burden = measured(v.renter_cost_burden_pct);
    var t = d.aa && d.aa.statewide && d.aa.statewide.tiers;
    f.t30 = t && t['30']; f.t50 = t && t['50']; f.chasVintage = (d.aa && d.aa.meta && d.aa.meta.vintage) || '—';
    var min = d.gap && d.gap.statewide && d.gap.statewide.min_shortfall_matched_le_ami_pct;
    f.min30 = min && min['30']; f.min60 = min && min['60']; f.acsYear = d.gap && d.gap.meta && d.gap.meta.acs_year;
    f.renters = d.gap && d.gap.statewide && d.gap.statewide.renter_households_total;
    // The one statewide income limit the ACS floor is measured against, and its HUD year: the file's own.
    f.ami4 = d.gap && d.gap.statewide ? Number(d.gap.statewide.ami_4person) : NaN; f.hudYear = d.gap && d.gap.meta && d.gap.meta.hud_income_limits_year;
    f.households = d.sum && d.sum.acsProfile ? Number(d.sum.acsProfile.DP02_0001E) : NaN;
    // Owners beside renters (paul, 15 Nov): the typical home's value against the typical household's income, both
    // from the same statewide ACS 5-year profile (DP04_0089E median value of owner-occupied homes, DP03_0062E median
    // household income).
    f.value = d.sum && d.sum.acsProfile ? Number(d.sum.acsProfile.DP04_0089E) : NaN;
    f.income = d.sum && d.sum.acsProfile ? Number(d.sum.acsProfile.DP03_0062E) : NaN;
    f.priceRatio = f.value > 0 && f.income > 0 ? f.value / f.income : NaN;
    var need = d.proj && d.proj.housing_need && d.proj.housing_need.incremental_units_needed_dola;
    var raw = Array.isArray(need) && need.length ? need[need.length - 1] : null;
    f.need = raw == null || raw === '' ? NaN : Math.round(Number(raw));
    f.sdoVintage = d.proj && d.proj.source && d.proj.source.households_vintage ? String(d.proj.source.households_vintage) : '';
    f.needYear = d.snap && d.snap.deficit_growth_basis && d.snap.deficit_growth_basis.projection_years ? d.snap.deficit_growth_basis.projection_years[1] : 2044;
    f.lihtcCount = Number(v.lihtc_property_count); f.lihtcPerYr = Number(v.average_lihtc_units_per_year);
    f.newPerYr = Number(v.average_lihtc_new_construction_units_per_year); f.presPerYr = measured(v.average_lihtc_preservation_units_per_year);
    f.renterGrowth = Number(v.annual_le60_renter_household_growth); f.coverage = Number(v.lihtc_new_construction_coverage_of_le60_renter_growth);
    // Owners and renters together who pay 30% or more (HUD CHAS), summed over the 64 counties: the live page's
    // "nearly 1 in 3 Colorado households, about 694,000".
    // Split by tenure (paul, 16 Nov: renters and owners side by side wherever the data allows).
    var burdened = 0, all = 0, by = { renter_hh_by_ami: [0, 0], owner_hh_by_ami: [0, 0] };
    var cs = d.burden && d.burden.counties; cs = cs ? (Array.isArray(cs) ? cs : Object.keys(cs).map(function (k) { return cs[k]; })) : [];
    cs.forEach(function (c) { Object.keys(by).forEach(function (k) { var x = c[k] || {}; Object.keys(x).forEach(function (b) { by[k][0] += x[b].cost_burdened_30pct || 0; by[k][1] += x[b].total || 0; burdened += x[b].cost_burdened_30pct || 0; all += x[b].total || 0; }); }); });
    f.allBurdened = burdened > 0 ? burdened : NaN; f.allBurdenedShare = all > 0 ? burdened / all : NaN;
    f.rentBurdened = by.renter_hh_by_ami[0] > 0 ? by.renter_hh_by_ami[0] : NaN; f.rentBurdenedShare = by.renter_hh_by_ami[1] > 0 ? by.renter_hh_by_ami[0] / by.renter_hh_by_ami[1] : NaN;
    f.ownBurdened = by.owner_hh_by_ami[0] > 0 ? by.owner_hh_by_ami[0] : NaN; f.ownBurdenedShare = by.owner_hh_by_ami[1] > 0 ? by.owner_hh_by_ami[0] / by.owner_hh_by_ami[1] : NaN;
    // The owner gap: what it takes to buy the typical home, against what owners and renters earn (ACS B25119).
    var ti = d.tenure && d.tenure.geos && d.tenure.geos['08'];
    f.incOwner = ti && ti.owner > 0 ? ti.owner : NaN; f.incRenter = ti && ti.renter > 0 ? ti.renter : NaN;
    f.tenureYears = d.tenure && d.tenure.meta ? d.tenure.meta.vintage : '';
    f.rentMed = d.sum && d.sum.acsProfile ? Number(d.sum.acsProfile.DP04_0134E) : NaN;
    f.og = global.LabTpl.ownerGap(f.value, f.rentMed);
    // Renters alone in the same HUD count, so the page can say why it sits below the Census survey's share (paul, 17 Nov).
    f.renterBurdenChas = fin(f.rentBurdenedShare) ? f.rentBurdenedShare * 100 : NaN;
    return f;
  }

  // A bar of 100 households: how many have a home they can afford and get into.
  function per100Bar(per100, label) {
    if (!fin(per100)) return '';
    var w = Math.max(0, Math.min(100, per100));
    return '<div class="hg-bar" role="img" aria-label="' + esc(label) + '"><span class="hg-fill" style="width:' + w.toFixed(1) + '%"></span></div>' +
      '<p class="hg-bar-key"><span><b>' + Math.round(per100) + '</b> homes</span><span>per <b>100</b> households</span></p>';
  }

  function glanceCard(o) {
    return '<article class="hg-card"><h3>' + esc(o.title) + '</h3><p class="hg-value">' + esc(o.value) + '</p>' +
      '<p class="hg-plain">' + esc(o.plain) + '</p>' + (o.graphic || '') +
      '<details class="hg-how"><summary>How this is counted</summary><p>' + o.how + '</p></details>' +
      '<p class="metric-source">' + o.src + '</p></article>';
  }

  function glance(f) {
    var cov = fin(f.coverage) && f.coverage > 0 && fin(f.newPerYr) && f.newPerYr > 0 && fin(f.renterGrowth) && f.renterGrowth > 0;
    var t30 = f.t30 || {};
    var cards = [
      glanceCard({ title: 'Renters paying 30% or more of income', value: fin(f.burden) && f.burden > 0 ? f.burden.toFixed(1) + '%' : '—',
        plain: 'The usual line for cost burden: rent and utilities take 30% or more of the household’s income.',
        graphic: fin(f.burden) ? per100Bar(f.burden, Math.round(f.burden) + ' of every 100 renter households').replace('homes</span><span>per <b>100</b> households', 'renters</span><span>of every <b>100</b>') : '',
        how: 'Share of Colorado renter households whose gross rent (rent plus utilities) is 30% or more of household income. The Census leaves out renters whose share can’t be computed, such as those with no income or no cash rent, so this runs a little above HUD’s count' +
          (fin(f.renterBurdenChas) ? ' of ' + f.renterBurdenChas.toFixed(1) + '% (CHAS ' + esc(f.chasVintage) + ')' : '') + ' and close to the state’s 49% for 2026 (' + STATE_HNA.cite + ').',
        src: '<a href="' + HSRC.b25070 + '">ACS 2020–2024, table B25070</a>' }),
      glanceCard({ title: 'Owners paying 30% or more of income', value: fin(f.ownBurdenedShare) ? (f.ownBurdenedShare * 100).toFixed(1) + '%' : '—',
        plain: 'The same line for owners: the mortgage, taxes, insurance and utilities take 30% or more of the household’s income.',
        graphic: fin(f.ownBurdenedShare) ? per100Bar(f.ownBurdenedShare * 100, Math.round(f.ownBurdenedShare * 100) + ' of every 100 owner households').replace('homes</span><span>per <b>100</b> households', 'owners</span><span>of every <b>100</b>') : '',
        how: 'Share of Colorado owner households whose housing costs are 30% or more of household income: ' + cnt(f.ownBurdened) + ' owner households. HUD’s CHAS count; for renters it gives ' + (fin(f.rentBurdenedShare) ? (f.rentBurdenedShare * 100).toFixed(1) + '%' : '—') + ', lower than the ACS figure beside it because the years and the way income is counted differ.',
        src: '<a href="' + HSRC.chas + '">HUD CHAS ' + esc(f.chasVintage) + '</a>' }),
      glanceCard({ title: 'Homes short for renters ≤30% AMI', value: cnt(t30.homes_short),
        plain: 'Homes Colorado lacks for renters earning 30% or less of area median income (AMI), counting only homes they can afford that higher earners don’t already rent.',
        graphic: per100Bar(t30.homes_per_100_households, Math.round(t30.homes_per_100_households) + ' affordable, available homes for every 100 renter households at or below 30% of area median income'),
        how: 'A count of homes, not people. ' + cnt(t30.renter_households) + ' renter households earn up to 30% of area median income, and only ' + cnt(t30.affordable_available_homes) +
          ' homes they can afford are vacant or rented by someone in that group: ' + (fin(t30.homes_per_100_households) ? Math.round(t30.homes_per_100_households) : '—') +
          ' for every 100 households. Cheap homes rented by higher-income households don’t count, because no one in the group can move in.</p><p>' +
          esc(f.acsYear || '2024') + ' minimum: ' + cnt(f.min30) + ' homes short (AMI gap, ACS ' + esc(f.acsYear || '—') + '). Renter households earning up to 30% of area median income, minus the homes that rent for what they can afford, and minus homes rented for no cash rent. It counts cheap homes even when higher-income households rent them, and measures everyone against one statewide AMI (' + (fin(f.ami4) ? '$' + num(f.ami4) + ' for a 4-person household' : 'for a 4-person household') + (f.hudYear ? ', HUD FY' + esc(f.hudYear) : '') + '), so it differs from HUD’s count, which uses older survey years and each county’s own limits.',
        src: '<a href="' + HSRC.chas + '">HUD CHAS ' + esc(f.chasVintage) + '</a> · <a href="' + HSRC.b25118 + '">AMI gap, ACS ' + esc(f.acsYear || '—') + '</a>' }),
      glanceCard({ title: 'Homes Colorado needs by ' + f.needYear, value: cnt(f.need),
        plain: 'New homes needed for 20 years of household growth, at all incomes. This is growth only, separate from today’s shortfall.',
        how: 'Additional homes Colorado needs by ' + f.needYear + ' to house projected household growth at a healthy vacancy rate, all incomes. Counts growth only: not today’s shortfall, and not reduced by existing affordable or naturally affordable homes. Base year 2024.',
        src: 'COHO estimate from the <a href="' + HSRC.dola + '">State Demography Office household forecast' + (f.sdoVintage ? ', Vintage ' + esc(f.sdoVintage) : '') + '</a>' }),
      glanceCard({ title: 'New tax-credit homes against new low-income renters', value: cov ? Math.round(f.coverage * 100) + '% covered' : '—',
        plain: 'How much of each year’s growth in renters at or below 60% AMI new tax-credit construction keeps up with.',
        graphic: cov ? per100Bar(f.coverage * 100, Math.round(f.coverage * 100) + '% of new low-income renter households covered by new tax-credit homes').replace('homes</span><span>per <b>100</b> households', 'covered</span><span>of each year’s <b>100</b> new renters') : '',
        how: 'New LIHTC construction (' + (cov ? num(f.newPerYr) : '—') + ' homes a year, 10-year average) covers this share of projected new ≤60% AMI renter households (' + (cov ? num(f.renterGrowth) : '—') +
          ' a year: DOLA household growth × the share of all households that are renters at ≤60% AMI, from ACS 2020–2024), before any losses from the existing affordable stock, which no source here measures. Acquisition and rehab (' + (fin(f.presPerYr) ? num(f.presPerYr) : '—') + ' a year) preserves homes; it does not add to them.',
        src: '<a href="' + HSRC.b25118 + '">ACS 2020–2024 (B25118)</a> · <a href="' + HSRC.dola + '">State Demography Office household forecast' + (f.sdoVintage ? ', Vintage ' + esc(f.sdoVintage) : '') + ', from 2024</a> · <a href="' + HSRC.chfa + '">CHFA tax credit properties</a>' })
    ];
    return '<section class="home-glance" aria-labelledby="h-glance"><h2 id="h-glance">Colorado at a glance</h2><div class="hg-grid">' + cards.join('') + '</div>' +
      '<div class="hg-read"><p><strong>Why this matters.</strong> The shortfall is deepest for the lowest-income renters, and new tax-credit homes cover only part of each year’s growth in low-income renters, so building at today’s pace does not keep up with new demand, let alone the existing shortfall.</p>' +
      '<p><strong>What to decide.</strong> Which income band a project should serve, and whether to add new homes or keep existing affordable ones. Statewide figures hide wide local differences, so check your town’s numbers before you decide.</p></div>' +
      '<p class="hg-burden">Across Colorado, roughly half of <strong>renters</strong> pay 30% or more of their income for housing (' + (fin(f.burden) ? f.burden.toFixed(1) + '% in ' : '') + '<a href="' + HSRC.b25070 + '">ACS 2020–2024</a>' +
        (fin(f.renterBurdenChas) ? '; ' + f.renterBurdenChas.toFixed(1) + '% in HUD CHAS ' + esc(f.chasVintage) : '') + '). Counting <strong>homeowners</strong> too, the state’s housing needs assessment counts <strong>' + num(STATE_HNA.households) + '</strong> cost-burdened households in ' + STATE_HNA.year +
        ', about ' + STATE_HNA.allPct + '%: ' + STATE_HNA.renterPct + '% of renters and ' + STATE_HNA.ownerPct + '% of owners (' + STATE_HNA.cite + '). HUD’s count from earlier years puts it at ' +
        (fin(f.allBurdenedShare) && f.allBurdenedShare > 0.28 && f.allBurdenedShare < 0.34 ? 'nearly 1 in 3' : (fin(f.allBurdenedShare) ? Math.round(f.allBurdenedShare * 100) + '% of' : 'many')) +
        ' households, about <strong>' + (fin(f.allBurdened) ? num(Math.round(f.allBurdened / 1000) * 1000) : '—') + '</strong>' +
        (fin(f.rentBurdened) && fin(f.ownBurdened) ? ': <strong>' + num(f.rentBurdened) + ' renter households</strong> (' + Math.round(f.rentBurdenedShare * 100) + '% of renters) and <strong>' + num(f.ownBurdened) + ' owner households</strong> (' + Math.round(f.ownBurdenedShare * 100) + '% of owners)' : '') +
        ' (<a href="' + HSRC.chas + '">HUD CHAS ' + esc(f.chasVintage) + '</a>). The state’s count applies Census survey data from 2022 to 2024 to 2026 households, so it is a newer count, not a correction of HUD’s.</p>' +
      '<p class="note">Educational; not a substitute for lender underwriting or legal advice.</p></section>';
  }

  // Counties plus the towns and CDPs the site has a page for: the count the ranking covers. Counted, never typed,
  // so it cannot go stale (the old home page's count once did).
  function placeCount() {
    var towns = Shell.inHub('places', function (e) { return e.role === 'generated-place'; }).length, counties = Pl.countyEntries().length;
    return towns && counties ? towns + counties : 0;
  }
  function allPlaces() { return placeCount() ? 'all ' + num(placeCount()) + ' places' : 'every town and county'; }

  // "What brings you here?": the live homepage's six doors (js/home-jurisdiction-search.js DOORS), each with
  // the lab pages its next steps point to.
  var DOORS = [
    ['council', 'I work for a town or county', [['Pick your town: full needs assessment', '#/places'], ['Compare with other Colorado places', '#/places/ranking'], ['What other Colorado towns offer builders', '#/places/incentives'], ['How to get affordable homes built here', '#/places/attract-housing']]],
    ['build', 'I develop housing', [['Where tax credit housing fits: Opportunity Finder', '#/finder'], ['Test a project: Deal Calculator', '#/deal-calculator'], ['Funding programs that fit', '#/places/deep-dive?tab=funding'], ['Pick your town: full needs assessment', '#/places']]],
    ['operate', 'I run a housing authority or nonprofit', [['What a housing authority can do', '#/guide/housing-authority'], ['Homes at risk of losing affordability', '#/opportunity/preservation'], ['Resident services', '#/guide/resident-services'], ['Pick your town: full needs assessment', '#/places']]],
    ['fund', 'I fund, lend or invest', [['Where housing money goes', '#/money'], ['Colorado tax credit awards by year', '#/tax-credit-history'], ['Funded deals, one page each', '#/deals'], ['Pick your town: full needs assessment', '#/places']]],
    ['analyze', 'I research or report on housing', [['Pick your town: full needs assessment', '#/places'], ['Compare with other Colorado places', '#/places/ranking'], ['Sources and how we check them', '#/data/trust'], ['Every data source', '#/data/sources']]],
    ['rent', 'I need a place to live', [['Rent help, eviction help and vouchers (English y español)', '#/assistance'], ['Free housing help line: Colorado Housing Connects, 1-844-926-6632', 'https://coloradohousingconnects.org/'], ['Search income-restricted rentals: ColoradoHousingSearch.com', 'https://www.coloradohousingsearch.com/'], ['Thinking about buying? Help for homebuyers', LIVE + 'help-for-homebuyers.html']]]
  ];
  // Home's own address with one setting changed: the role picked (door), the town picked (town) or the search (q).
  function homeHref(params, set) {
    // Everything else Home keeps in its address (the map's measure and county, the table's region) stays as it is.
    var q = new URLSearchParams(params.toString());
    ['door', 'town', 'q'].forEach(function (k) { var v = set && k in set ? set[k] : params.get(k); if (v) q.set(k, v); else q.delete(k); });
    var t = q.toString();
    return '#/' + (t ? '?' + t : '');
  }
  function validPlace(g) { return /^08\d{3}(\d{2})?$/.test(String(g || '')); }
  // A door's link, opened on the town picked on Home when the page takes one.
  function onPlace(href, g) {
    if (!validPlace(g) || /^https/.test(href)) return href;
    if (href === '#/places') return '#/place/' + g;
    if (['#/finder', '#/deal-calculator', '#/market', '#/for-sale', '#/recommendation'].indexOf(href) > -1) return href + '?g=' + g;
    return href;
  }
  function doorLinks(d, g) {
    return '<ul>' + d[2].map(function (l) { return '<li><a href="' + esc(onPlace(l[1], g)) + '">' + esc(l[0]) + (/^https/.test(l[1]) && l[1].indexOf(LIVE) !== 0 ? ' ↗' : '') + '</a></li>'; }).join('') + '</ul>';
  }
  // The links show as soon as a role is picked: no town is needed (on the old home page they waited for one).
  function doors(params) {
    var picked = params.get('door'), g = params.get('town');
    var d = DOORS.filter(function (x) { return x[0] === picked; })[0];
    return '<div class="home-doors"><p class="hd-ask" id="hd-ask">What brings you here?</p><ul class="home-chips" aria-labelledby="hd-ask">' + DOORS.map(function (x) {
      return '<li><a href="' + esc(homeHref(params, { door: x[0] === picked ? '' : x[0], q: '' })) + '"' + (x[0] === picked ? ' aria-current="true"' : '') + '>' + esc(x[1]) + '</a></li>';
    }).join('') + '</ul>' +
      (d ? '<div class="hd-next"><p class="hd-title">Next steps for you</p>' + doorLinks(d, g) + '</div>' : '') + '</div>';
  }

  // Typing a town: matches under the box, on Home. Picking one shows its answer card, also on Home.
  function found(params) {
    var q = params.get('q');
    if (!q) return '';
    var all = Pl.countyEntries().concat(Shell.inHub('places', function (e) { return e.role === 'generated-place'; }));
    var hits = all.filter(Shell.matches(q));
    return '<div class="hh-found"><p class="count" role="status">' + (hits.length === 0 ? 'No Colorado town or county matches. Check the spelling.' : hits.length > 6 ? 'Showing 6 of ' + hits.length + '. Type more to narrow the list.' : hits.length + (hits.length === 1 ? ' match.' : ' matches.')) + '</p>' +
      '<ul>' + hits.slice(0, 6).map(function (e) { return '<li><a href="' + esc(homeHref(params, { town: e.geoid, q: '' })) + '">' + esc(e.label) + '</a></li>'; }).join('') + '</ul></div>';
  }

  // "Continue where you left off" (the old home page's resume strip): the place this browser last worked on,
  // with the three steps people come back to. It names no step number: visiting a page does not mark it done.
  // A place saved by the public site's older workflow (js/workflow-state-core.js: the active project's id under
  // coho_wf_active, the project under coho_wf_project_<id>, its place under .jurisdiction). Read only, so a
  // visitor who picked a place before Home was rebuilt still gets the resume line. Never written here.
  function workflowPlace() {
    try {
      var id = JSON.parse(global.localStorage.getItem('coho_wf_active') || 'null');
      if (!id) return null;
      var j = (JSON.parse(global.localStorage.getItem('coho_wf_project_' + id) || 'null') || {}).jurisdiction;
      return j && validPlace(j.geoid) && j.name ? { geoid: String(j.geoid), label: String(j.name), key: id + '|' + j.geoid } : null;
    } catch (e) { return null; }
  }
  // Clear on Home sets that older place aside under a key of this page's own (RESUME_OFF), since the workflow's
  // storage is never written here. It shows again once the workflow holds a different project or place.
  var RESUME_OFF = 'coho-lab-resume-off';
  function savedWorkflowPlace() {
    var w = workflowPlace();
    if (!w) return null;
    try { if (global.localStorage.getItem(RESUME_OFF) === w.key) return null; } catch (e) { /* storage off: show it */ }
    return { geoid: w.geoid, label: w.label };
  }
  // Clear (feature check, 13 Nov 2026: every other hub page could clear the working place from its "Working on"
  // line; Home could only swap it). One button on the resume line and one on a picked place's card.
  function clearButton(params, label) {
    return '<button type="button" class="hh-clear" data-home-clear="1" data-to="' + esc(homeHref(params, { town: '', q: '' })) + '" aria-label="Clear ' + esc(label) + ' as the place you are working on">Clear</button>';
  }
  var cleared = false;
  if (global.document && global.addEventListener) {
    global.addEventListener('hashchange', function () { cleared = false; });
    global.document.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-home-clear]');
      if (!b) return;
      if (global.LabHna && global.LabHna.clearWorking) global.LabHna.clearWorking();
      var w = workflowPlace();
      try { if (w) global.localStorage.setItem(RESUME_OFF, w.key); } catch (e) { /* storage off: nothing was kept */ }
      cleared = true;
      // A picked place's card is in the address (?town=); leaving it there would pick the place again.
      var to = b.getAttribute('data-to') || '#/';
      if (location.hash !== to && (location.hash || '#/') !== to) history.pushState(null, '', to);
      Shell.render();
      var said = document.getElementById('hh-cleared');
      if (said) said.focus({ preventScroll: true });
    });
  }
  function resume(params) {
    var w = (global.LabHna && global.LabHna.working ? global.LabHna.working() : null) || savedWorkflowPlace();
    if (validPlace(params.get('town')) || params.get('q')) return '';
    if (!w) return cleared ? '<p class="hh-resume" id="hh-cleared" tabindex="-1">Place cleared. Pick a town or county to start again.</p>' : '';
    var g = w.geoid;
    return '<p class="hh-resume"><span>Continue where you left off:</span> <a href="#/place/' + esc(g) + '"><strong>' + esc(w.label) + '</strong>’s needs assessment</a> · ' +
      '<a href="' + esc(onPlace('#/market', g)) + '">Market check</a> · <a href="' + esc(onPlace('#/deal-calculator', g)) + '">Deal Calculator</a> · ' +
      '<a href="' + esc(homeHref(params, { town: g })) + '">Its headline figures</a> · ' + clearButton(params, w.label) + '</p>';
  }
  function firstMatch(q) {
    if (!q) return null;
    return Pl.countyEntries().concat(Shell.inHub('places', function (e) { return e.role === 'generated-place'; })).filter(Shell.matches(q))[0] || null;
  }
  // One place's own figures, on Home (the live homepage's answer card). The figures and their wording are the
  // public site's: js/home-jurisdiction-search.js answerFacts, read from the place's metrics digest.
  var digests = {};
  function digestFor(g) {
    var c = digests[g];
    if (c) return c;
    c = digests[g] = { data: null, error: false };
    var VENDOR = global.LAB_VENDOR;
    (global.LAB_HNA_LOAD ? global.LAB_HNA_LOAD(g).then(function (r) { return r[0]; })
      : fetch(VENDOR + 'data/hna/jurisdiction-metrics-digest/' + g + '.json').then(function (r) { if (!r.ok) throw new Error('digest ' + r.status); return r.json(); }))
      .then(function (d) { c.data = d; Shell.render(); }).catch(function () { c.error = true; Shell.render(); });
    return c;
  }
  function answer(params) {
    var g = params.get('town');
    if (!validPlace(g)) return '';
    var e = Pl.entryFor(g), label = e ? e.label : g;
    if (global.LabHna && global.LabHna.setWorking) global.LabHna.setWorking(g, label);
    var c = digestFor(g), HJS = global.HomeJurisdictionSearch;
    var facts = c.data && HJS ? HJS.answerFacts(c.data) : [];
    var d = DOORS.filter(function (x) { return x[0] === params.get('door'); })[0];
    var body = c.error ? '<p class="note">This place’s figures did not load. This is a loading problem, not missing data. Its full page is still open below.</p>'
      : !c.data ? '<p role="status" class="note">Loading ' + esc(label) + '’s figures…</p>'
      : !facts.length ? '<p class="note">The Census sample here is too small for a headline figure. The full page shows what is known.</p>'
      : '<dl class="ha-facts">' + facts.map(function (f) {
          return '<div><dt>' + esc(f.label) + '</dt><dd><b>' + esc(f.value) + '</b> ' + esc(f.note) + ' <span class="metric-source">' + esc(f.source) + '</span></dd></div>';
        }).join('') + '</dl>';
    return '<section class="home-answer" aria-labelledby="ha-h"><h2 id="ha-h">' + esc(label) + '</h2>' + body +
      '<p class="actions"><a class="button-link" href="#/place/' + esc(g) + '">Open ' + esc(label) + '’s full needs assessment →</a></p>' +
      (d ? '<p class="hd-title">Next steps for you</p>' + doorLinks(d, g) : '') +
      // The old home page's own two extras for a picked place: its short profile page and its data file.
      '<p class="ha-more">' + (e && /^places\//.test(e.path || '') ? '<a href="' + esc(LIVE + e.path) + '">' + esc(label) + '’s short profile page</a> · ' : '') +
      '<a href="' + esc(LIVE + 'data/hna/jurisdiction-metrics-digest/' + g + '.json') + '">The data file behind these figures</a></p>' +
      '<p class="ha-clear"><a href="' + esc(homeHref(params, { town: '' })) + '">Pick another town or county</a> · ' + clearButton(params, label) + '</p></section>';
  }

  // The tools the old home page listed as quick links, each at its rebuilt page.
  var QUICK = [['Needs Assessment', '#/places'], ['Compare', '#/places/ranking'], ['Opportunity Finder', '#/finder'], ['Preservation', '#/opportunity/preservation'],
    ['Ownership Need', '#/for-sale'], ['For-Sale Market Study', '#/for-sale'], ['Market check', '#/market'], ['Deal Calculator', '#/deal-calculator'],
    ['Scenario Builder', '#/places/scenario'], ['Recommendation', '#/recommendation'], ['Land Value', '#/opportunity/land-value'], ['Data Map', '#/data/map'], ['Data Trust Center', '#/data/trust']];
  function quick(g) {
    var seen = {};
    return '<nav class="home-quick" aria-label="Jump to a tool"><p class="hd-ask">Jump to a tool</p><ul class="home-chips">' + QUICK.filter(function (x) { if (x[0] === 'Ownership Need') return false; if (seen[x[1]]) return false; seen[x[1]] = 1; return true; }).map(function (x) {
      return '<li><a href="' + esc(onPlace(x[1], g)) + '">' + esc(x[0]) + '</a></li>';
    }).join('') + '</ul></nav>';
  }

  // The live homepage's seven steps, each with what it does and the lab page that does it.
  var STEPS = [
    ['Select your jurisdiction', 'Set the place for the analysis. It decides the income limits, HUD Fair Market Rents, QCT and DDA areas, Census figures and CHFA history used everywhere else.', '#/places', 'Pick a place'],
    ['Opportunity Finder, new', 'Optional, for deciding where to look. Compare Colorado places on housing need, recent CHFA investment, QCT and DDA basis boost, size and local capacity, read for a 4% bond or a 9% competitive deal.', '#/finder', 'Browse places statewide'],
    ['Housing needs assessment', 'Who needs housing: incomes, cost burden, renters and owners, the gap between what exists and what is needed, 10-year demand, and a recommended income mix.', '#/place/0828745', 'Open Fruita’s assessment'],
    ['Market check', 'Renters and the homes priced for them, rents against the tax credit limit, tax credit supply and a capture rate, with a market area you can draw. CHFA requires a market study with every application. The full Market Analysis, which scores a site, is a member tool.', '#/market', 'Run a market check'],
    ['Scenario builder', 'Compare 20-year population and housing forecasts under baseline, low and high growth. Tax credit homes stay affordable for 15 to 30 years, so lenders and CHFA look for demand that lasts.', '#/places/scenario', 'Change the forecast'],
    ['Deal calculator', 'Size the capital stack: credit equity, the permanent loan from net operating income, and the gap soft funding must fill. Compare 9% and 4% side by side, or size an ownership subsidy.', '#/deal-calculator', 'Open the Deal Calculator'],
    ['Recommendation', 'The earlier steps on one page: what the public data says the place needs, what you recorded, and what the data cannot answer. Prints for a council or a board.', '#/recommendation', 'See the recommendation']
  ];
  function steps() {
    return '<section class="home-steps" aria-labelledby="h-steps"><h2 id="h-steps">From public data to a housing decision</h2>' +
      '<p>Tax credit rental, deed-restricted or shared-equity ownership, or keeping homes that are already affordable: the questions come in the same order. Where, who needs what, does the market support it, does the deal pencil, and what do you recommend. Pick a place once and the tools open on it. Visiting a step does not mark it done.</p>' +
      '<ol class="hs-list">' + STEPS.map(function (s, i) {
        return '<li><span class="hs-n" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span><div><h3>' + esc(s[0]) + '</h3><p>' + esc(s[1]) + '</p><p class="hs-go"><a href="' + esc(s[2]) + '">' + esc(s[3]) + ' →</a></p></div></li>';
      }).join('') + '</ol></section>';
  }

  var PATHS = [
    ['Tax credit rental (LIHTC)', 'The largest federal source for affordable rentals. Investors buy dollar-for-dollar federal credits, and the homes stay restricted to households at 30–80% of area median income. CHFA awards credits competitively under its Qualified Allocation Plan; most applicants do not win on the first try, and site to move-in typically takes 3–7 years.', 'Know: the QAP scorecard, a 15-year compliance period that usually runs 30 or more, and equity pricing that moves with the market.'],
    ['Affordable ownership', 'Deed-restricted for-sale homes, community land trusts and shared equity keep a home affordable at resale rather than at rent.', 'Capital: down payment help, soft second mortgages, land held by a trust. Risks: the resale formula, stewarding the restriction for decades, and whether buyers can get a loan.'],
    ['Preservation', 'Buying and repairing homes that are already affordable, such as tax credit properties near the end of their compliance period or older buildings affordable by default. Often faster and cheaper than building.', 'Risks: acquisition timing, rehab scope, and keeping rents affordable through the change.'],
    ['Public and partnership routes', 'Housing authorities, employers and Colorado’s Prop 123 land banking can put in land or capital with no tax credit at all.', 'Same questions; what changes is the capital stack.']
  ];
  function paths() {
    return '<section class="home-paths" aria-labelledby="h-paths"><h2 id="h-paths">Paths to affordable housing, and how they differ</h2>' +
      '<p>Tax credit rental, affordable ownership, preservation and public routes ask the same questions. What changes is the capital, the timeline and the obligations after closing.</p>' +
      '<div class="hp-grid">' + PATHS.map(function (p) { return '<article class="hp-card"><h3>' + esc(p[0]) + '</h3><p>' + esc(p[1]) + '</p><p class="hp-know">' + esc(p[2]) + '</p></article>'; }).join('') + '</div>' +
      '<p class="hp-links"><a href="#/pipeline">How these paths fit together: the affordable housing pipeline →</a> <a href="#/guide/lihtc-basics">The LIHTC guide for Colorado →</a> <a href="#/for-sale">For-sale and ownership →</a></p></section>';
  }

  var AUDIENCES = [
    ['Newly elected officials', 'Your community has been asked to support affordable housing, perhaps under Proposition 123, a regional housing plan or residents’ requests. See how many households are cost-burdened, which incomes need the most help, what a realistic project looks like near you, and your role in making it happen.'],
    ['First-time developers', 'Affordable development, rental or restricted ownership, is a multi-year, multi-party process with set requirements at each stage. Follow the public workflow from documenting need and defining a market area to how CHFA’s QAP scores an application and how ownership programs set resale terms.'],
    ['Graduate-level financiers', 'The deal mechanics, unvarnished: eligible basis, QCT and DDA boost, permanent loan sizing from net operating income, credit equity pricing and gap analysis, all from HUD, CHFA and Census data, with 9% and 4% side by side and a CRA lender finder.']
  ];
  function audiences() {
    return '<section class="home-people" aria-labelledby="h-people"><h2 id="h-people">Built for the people doing the work</h2>' +
      '<p>COHO is built for people who develop, plan, finance and govern housing, working from the same public sources (Census, HUD CHAS, CHFA and DOLA) so everyone sees the same picture. If you are learning the field, you are welcome too: each step explains its terms.</p>' +
      '<div class="hp-grid">' + AUDIENCES.map(function (a) { return '<article class="hp-card"><h3>' + esc(a[0]) + '</h3><p>' + esc(a[1]) + '</p></article>'; }).join('') + '</div>' +
      '<aside class="callout home-why"><h3>Affordable housing is not just a real estate transaction</h3>' +
      '<p>It is a public health measure. Research links stable, affordable housing to fewer emergency room visits, better school attendance, less child welfare involvement and more long-term economic security.</p>' +
      '<p>It is also about community: the working family putting nearly half of every paycheck toward rent, the senior on a fixed income, the neighbor finding a way out of homelessness. They need homes that fit their communities, architecturally, socially and financially.</p>' +
      '<p>COHO makes the data plainer for everyone with a hand in building those homes, so a developer sees the same picture a planner does, and a financier and a resident can read the same sources and reach the same conclusions.</p></aside></section>';
  }

  function moreNumbers(f) {
    var t50 = f.t50 || {};
    var rows = [
      [fin(f.households) ? num(f.households) : '—', 'Colorado households', '<a href="https://data.census.gov/table/ACSDP5Y2024.DP02">ACS 2020–2024, DP02</a>, statewide summary'],
      [cnt(f.renters), 'Renter households', '<a href="' + HSRC.b25118 + '">ACS 2020–2024, B25118</a>'],
      // One row, as the live page has it: the ≤60% figure is an ACS floor by a different method, so it rides as a note on
      // the HUD ≤50% count. As its own number beside it, a smaller 60% shortfall read as a contradiction (paul, 11-10).
      [cnt(t50.homes_short), 'Homes short for renters ≤50% AMI (includes ≤30%)', '<a href="' + HSRC.chas + '">HUD CHAS ' + esc(f.chasVintage) + '</a>: ' + cnt(t50.renter_households) + ' households, ' + cnt(t50.affordable_available_homes) + ' homes they can afford that are vacant or rented within the group, ' + (fin(t50.homes_per_100_households) ? Math.round(t50.homes_per_100_households) : '—') + ' per 100 (HUD has no 60% tier).' +
        ' The ACS ' + esc(f.acsYear || '2024') + ' floor at ≤60% AMI is lower, ' + cnt(f.min60) + ' (<a href="' + HSRC.b25118 + '">AMI gap, ACS ' + esc(f.acsYear || '—') + '</a>), because it counts every home under the rent limit, even ones already occupied or rented by higher earners.'],
      [fin(f.lihtcCount) && f.lihtcCount > 0 ? num(f.lihtcCount) : '—', 'CHFA tax credit properties', '<a href="' + HSRC.chfa + '">CHFA tax credit properties</a>, all listed through 2025'],
      [fin(f.lihtcPerYr) && f.lihtcPerYr > 0 ? num(f.lihtcPerYr) : '—', 'Tax credit homes a year (10-year average)', '<a href="' + HSRC.chfa + '">CHFA tax credit properties</a>, by award year']
    ];
    return '<section class="home-more" aria-labelledby="h-more"><h2 id="h-more">More Colorado numbers</h2>' +
      '<ul class="fact-strip home-facts">' + rows.map(function (r) { return '<li><span class="fact-value">' + r[0] + '</span><span class="fact-label">' + r[1] + '</span><span class="fact-source">' + r[2] + '</span></li>'; }).join('') + '</ul>' +
      '<p class="metric-source">Data vintage: shortfall from HUD CHAS ' + esc(f.chasVintage) + '. Freshness, coverage and limits of each file are on <a href="#/data/trust">the data trust page</a>.</p></section>';
  }

  var RESEARCH = [
    ['Novogradac & Co.', 'LIHTC equity pricing', 'https://www.novoco.com/'], ['NLIHC', 'Out of Reach housing wage', 'https://nlihc.org/oor'],
    ['Harvard JCHS', 'State of the Nation’s Housing', 'https://www.jchs.harvard.edu/'], ['Yardi Matrix', 'Multifamily rent and occupancy', 'https://www.yardimatrix.com/publications/'],
    ['Freddie Mac', 'Multifamily debt and cap rates', 'https://mf.freddiemac.com/'], ['Brookings', 'Schuetz and Cortright land-use research', 'https://www.brookings.edu/programs/brookings-metro/'],
    ['UCLA Lewis Center', 'Housing Voice podcast', 'https://lewis.ucla.edu/'], ['Common Sense Institute Colorado', 'Colorado-specific research', 'https://commonsenseinstituteus.org/colorado'],
    ['Up For Growth', 'Underproduction method', 'https://upforgrowth.org/'], ['Urban Institute HFPC', 'Mortgage market data', 'https://www.urban.org/expertise/housing-finance'],
    ['DOLA State Demography Office', 'Colorado projections', 'https://demography.dola.colorado.gov/'], ['HUD CHAS', 'Cost burden by income', 'https://www.huduser.gov/portal/datasets/cp.html']
  ];
  function research() {
    return '<section class="home-research" aria-labelledby="h-research"><h2 id="h-research">Research sources cited on this site</h2>' +
      '<p>Federal data (Census ACS and CHAS, HUD Fair Market Rents and income limits, BLS LODES) plus research commonly cited in affordable housing planning and finance. Each links to its own site.</p>' +
      '<ul class="home-sources">' + RESEARCH.map(function (r) { return '<li><a href="' + esc(r[2]) + '">' + esc(r[0]) + ' ↗</a><span>' + esc(r[1]) + '</span></li>'; }).join('') + '</ul></section>';
  }

  // Three ways in, each one page from an answer.
  function startPaths() {
    var P = [
      ['need', 'See a place’s needs', 'Who lives there, what they earn, and how many homes are missing at each income.', '#/places', 'Start here: pick a town or county'],
      ['deal', 'Test whether a project works', 'Rents, costs, tax credits and debt for an affordable housing project, and whether there is a gap.', '#/projects', 'Open Build a deal'],
      ['site', 'Find where to build', 'Every town and CDP on the facts that matter for a tax credit project, sorted your way with no score, and homes that could be kept affordable.', '#/opportunities', 'Open Opportunities']
    ];
    var ICON = { need: 'need', deal: 'credit', site: 'place' };
    return '<section class="hh-paths" aria-label="Where to start"><ul>' + P.map(function (p) {
      return '<li><a href="' + p[3] + '"><span class="hh-icon">' + global.LabIcon.svg(ICON[p[0]]) + '</span>' +
        '<span class="hh-path-t">' + esc(p[1]) + '</span><span class="hh-path-d">' + esc(p[2]) + '</span><span class="hh-path-go">' + esc(p[4]) + ' →</span></a></li>';
    }).join('') + '</ul></section>';
  }

  // Five things to know about Colorado (reorg step 2b, paul 23 Nov 2026 "build Home and the menu"): the hero's figures
  // as sentences, the way a county's Summary reads, each tagged Renters, Owners or All homes, each with why it matters
  // (paul, 15 Nov) and its dated source. The same figures as before: the four-number strip and the owner card's buying gap.
  function roundTo(v, step) { return Math.round(v / step) * step; }
  function fiveThings(f) {
    if (!f) return '<section class="hh-facts hh-five" role="region" aria-labelledby="h-five"><h2 id="h-five">Five things to know about Colorado</h2><p role="status" class="note">Loading Colorado’s figures…</p></section>';
    var t30 = f.t30 || {}, g = f.og || {};
    // tag, the sentence (figure in bold), why it matters, source, link
    var items = [
      fin(f.need) ? ['All homes', 'Colorado needs about <strong class="hh-n">' + num(roundTo(f.need, 1000)) + '</strong> more homes by ' + esc(f.needYear) + ' as households grow, at every income.',
        'If building falls short of this, the shortage grows and prices climb for everyone.', 'COHO estimate from the State Demography Office forecast' + (f.sdoVintage ? ', Vintage ' + f.sdoVintage : ''), HSRC.dola] : null,
      fin(f.burden) ? ['Renters', '<strong class="hh-n">' + Math.round(f.burden) + '%</strong> of Colorado renters pay 30% or more of their income for rent and utilities.',
        'That leaves little for food, child care or savings, and one rent increase can force a move.', 'ACS 2020–2024, B25070', HSRC.b25070] : null,
      fin(t30.homes_short) ? ['Renters', 'The lowest-income renters, who earn 30% of area median income or less, are about <strong class="hh-n">' + num(roundTo(t30.homes_short, 100)) + '</strong> homes short.',
        'These households are the likeliest to fall behind or lose their home, and rents this low rarely get built without public money.', 'HUD CHAS ' + f.chasVintage, HSRC.chas] : null,
      // Each number says what it is (paul, 25 Nov: "$539,400 against $95,470 a year" was unclear). DP04_0089 is the
      // median value of owner-occupied homes; DP03_0062 is the median income of all households.
      fin(f.priceRatio) ? ['Owners', 'A typical home costs <strong class="hh-n">' + f.priceRatio.toFixed(1) + ' years</strong> of a typical household’s income' + (fin(f.value) && fin(f.income) ? ': the typical owner’s home is valued at $' + num(f.value) + ', and the typical household earns $' + num(f.income) + ' a year' : '') + '.',
        'First-time buyers need a far bigger income or down payment, so more households keep renting.', 'ACS 2020–2024, DP04 and DP03', HSRC.dp04] : null,
      g.buy && fin(f.incRenter) ? ['Owners', 'Buying the typical home takes about <strong class="hh-n">$' + num(g.buy) + '</strong> a year in income. Renter households, the would-be first-time buyers, earn <strong>$' + num(f.incRenter) + '</strong>.',
        'At 30% of income, ' + Math.round((g.down || 0.1) * 100) + '% down and ' + (g.rate ? (g.rate * 100).toFixed(2) + '%' : 'today’s rate') + ' for 30 years, with taxes and insurance.', 'ACS ' + (f.tenureYears || '2020–2024') + ', B25119; Freddie Mac' + (g.week ? ', week of ' + g.week : ''), HSRC.b25119] : null
    ].filter(Boolean);
    // .hh-facts li .hh-n stays the page's ready marker (Housing-Analytics scripts/audit/ux-budget.json), and the
    // explicit region role is how Housing-Analytics' accessibility gate finds Home's figure strip (tests/test_stage3_accessibility.py).
    return '<section class="hh-facts hh-five" role="region" aria-labelledby="h-five"><h2 id="h-five">Five things to know about Colorado</h2><ol>' + items.map(function (x) {
      // Each thing is a tile led by its figure, large (paul, 23 Nov: the sentence list read "a little more clunky").
      // The large figure is for the eye; the sentence carries it for screen readers.
      var big = (/<strong class="hh-n">([^<]+)<\/strong>/.exec(x[1]) || [])[1] || '';
      return '<li><span class="hh-tag hh-tag-' + x[0].replace(/\W+/g, '').toLowerCase() + '">' + esc(x[0]) + '</span>' +
        (big ? '<span class="hh-fig" aria-hidden="true">' + big + '</span>' : ' ') + x[1] +
        ' <span class="hf-why">' + esc(x[2]) + '</span> <a class="hh-s" href="' + esc(x[4]) + '">' + esc(x[3]) + '</a></li>';
    }).join('') + '</ol></section>';
  }

  // Why affordable housing matters, in plain words (paul, 15 Nov: the site's message on Home).
  function why() {
    var W = [
      ['A home is where the rest starts', 'Kids stay in one school. People keep their jobs and see the same doctor. There is something left at the end of the month to save.'],
      ['Towns need the people who keep them running', 'When rent and prices run ahead of pay, teachers, nurses, cooks and retirees move away or drive in from far off. Businesses can’t hire, and people who grew up there can’t afford to stay.'],
      ['It takes many hands, working from the same facts', 'Town staff, builders, lenders, nonprofits and neighbors each have a part. Plans move faster when everyone starts from the same numbers, and every number here links to where it came from.']
    ];
    return '<section class="home-why" aria-labelledby="h-why"><h2 id="h-why">Why affordable housing matters</h2><ul class="hw-list">' + W.map(function (w) {
      return '<li><strong>' + esc(w[0]) + '</strong> ' + esc(w[1]) + '</li>';
    }).join('') + '</ul></section>';
  }

  // Owners beside renters (paul, 15 Nov). Colorado only, like the rent card above it.
  function ownCard(f) {
    if (!f || !fin(f.priceRatio)) return '';
    var r = f.priceRatio, wInc = (100 / r).toFixed(1);
    return '<section class="ri-card hw-own" aria-label="Home prices against income in Colorado"><div class="ri-text"><p class="ri-kick">Colorado · Owners</p>' +
      '<h3 class="ri-h">A typical home costs ' + r.toFixed(1) + ' years of a typical income</h3>' +
      '<p>The typical owner’s home in Colorado is valued at <strong>$' + num(f.value) + '</strong>. The typical household earns <strong>$' + num(f.income) + '</strong> a year.</p>' +
      '<div class="ri-take"><p class="ri-big">' + r.toFixed(1) + '×</p><p>income, for the typical home. Buyers also need a down payment, and the monthly cost moves with mortgage rates.</p></div>' +
      ownGap(f) + '</div>' +
      '<div class="ri-viz"><p class="ri-vt">Typical home value against typical household income, 2020–2024</p>' +
      '<div class="ri-cmp-wrap" role="img" aria-label="' + esc('Colorado, 2020–2024: typical home value $' + num(f.value) + ', typical household income $' + num(f.income) + ' a year, ' + r.toFixed(1) + ' times.') + '">' +
      '<div class="ri-cmp"><span class="ri-t">Typical home value</span><b>$' + num(f.value) + '</b><span class="ri-bar ri-rent" style="width:100%"></span></div>' +
      '<div class="ri-cmp"><span class="ri-t">Typical household income, one year</span><b>$' + num(f.income) + '</b><span class="ri-bar ri-inc" style="width:' + wInc + '%"></span></div></div>' +
      '<p class="ri-lnote">This compares two medians. Home values are what owners told the Census Bureau their home is worth; it is not a sale price.</p></div>' +
      '<div class="ri-foot"><p class="metric-source">Source: <a href="' + HSRC.dp04 + '">ACS 2020–2024 5-year, DP04</a> (median value, owner-occupied homes) and <a href="' + HSRC.dp03 + '">DP03</a> (median household income), Colorado.</p>' +
      '<p class="ri-more-link"><a href="#/for-sale">What each income can pay for a home, town by town →</a></p></div></section>';
  }

  // The owner gap beside the rent gap: the income the typical home and the typical rent take, against what owner
  // and renter households earn (ACS B25119). Colorado only, like the card it sits in.
  function ownGap(f) {
    var g = f.og || {};
    if (!g.buy || !fin(f.incRenter) || !fin(f.incOwner)) return '';
    return '<div class="ri-owngap"><p class="ri-vt">Income it takes, against what households earn</p><ul class="ri-owngap-list">' +
      '<li><span class="hh-tag hh-tag-owners">Buying</span> The typical home takes about <strong>$' + num(g.buy) + '</strong> a year. Renter households, the would-be first-time buyers, earn <strong>$' + num(f.incRenter) + '</strong>: <strong>$' + num(global.LabTpl.short(g.buy, f.incRenter)) + '</strong> short. Owner households earn $' + num(f.incOwner) + '.</li>' +
      (g.rent ? '<li><span class="hh-tag hh-tag-renters">Renting</span> The typical rent ($' + num(f.rentMed) + ' a month) takes about <strong>$' + num(g.rent) + '</strong> a year. Renter households earn $' + num(f.incRenter) + (global.LabTpl.short(g.rent, f.incRenter) ? ': <strong>$' + num(global.LabTpl.short(g.rent, f.incRenter)) + '</strong> short.' : ', enough.') + '</li>' : '') + '</ul>' +
      '<p class="ri-lnote">Buying at ' + (g.rate ? (g.rate * 100).toFixed(2) + '%' : 'today’s rate') + ' for 30 years (Freddie Mac, week of ' + esc(g.week || '') + '), ' + Math.round((g.down || 0.1) * 100) + '% down, with taxes, insurance and mortgage insurance, at 30% of income. Renting at 30% of income. Typical means the median. These are two prices against two incomes, not a count of homes.</p>' +
      '<p class="metric-source">Source: <a href="' + HSRC.b25119 + '">ACS ' + esc(f.tenureYears || '2020–2024') + ' 5-year, B25119</a> (median income of renter and owner households), <a href="' + HSRC.dp04 + '">DP04</a> (median value and rent), <a href="https://www.freddiemac.com/pmms">Freddie Mac PMMS</a>, week of ' + esc(g.week || '') + '.</p></div>';
  }

  // Every hub and tool, read from the menus so it never drifts from them (paul, 15 Nov: an inventory on Home).
  // The four areas, and the parts of each as the menus group them, explained (paul, 23 Nov 2026: "swap the page
  // list for the four areas ... the four areas and the two sub areas in them"). It replaced a list of every page,
  // which repeated the menus. Each part names its most-used pages; the menus and each area's own page list the rest.
  var AREAS = {
    places: 'Start with a town or county: how many homes it needs, for whom, and how Colorado compares.',
    deal: 'For developers, funders and housing teams: test a deal, find a site, follow the money and learn how deals work.',
    policy: 'Housing news, deadlines and laws as they change, and dated briefs and papers on Colorado housing.',
    data: 'Every source is linked and dated. See how each figure is worked out, how fresh each source is, and open the data yourself.'
  };
  var PARTS = {
    'Look up a place': ['Any town, county or CDP: its needs assessment, the need at each income level, a free printable report, and scenarios that change the forecast.',
      ['#/places', '#/place/0828745', '#/report', '#/places/ranking', '#/places/scenario']],
    'The state picture': ['Colorado as a whole: county markets, the economy, housing and construction costs, and what towns have adopted.',
      ['#/places/deep-dive', '#/places/economy', '#/places/county-costs', '#/places/incentives']],
    'Tools': ['Test whether a tax credit deal pencils, check a market, study homes for sale, and see what the data says a place needs.',
      ['#/deal-calculator', '#/market', '#/for-sale', '#/recommendation']],
    'Find a site or a property': ['Places that fit 4% or 9% deals, affordable homes at risk of being lost, land value, and where workers commute.',
      ['#/finder', '#/opportunity/preservation', '#/opportunity/land-value', '#/opportunity/commuting']],
    'Where the money went': ['Who won tax credits and Prop 123 land awards, and where housing money from CHFA, OEDIT and others went.',
      ['#/deals?round=2026-1', '#/opportunity/land-banking', '#/money']],
    'Learn how deals work': ['How tax credits work, who does what, how a project gets built, and what investors pay for credits now.',
      ['#/guide/lihtc-basics', '#/guide/deal-team', '#/pipeline', '#/equity-pricing']],
    'Policy and news': ['Colorado housing news, deadlines and events, the laws COHO tracks, and elections.',
      ['#/news', '#/calendar', '#/legislation', '#/elections']],
    'Research': ['Every paper and brief, each dated, from how tax credit deals have changed to starting a housing authority.',
      ['#/guides?at=research-all', '#/tax-credit-history', '#/middle-income', '#/guide/housing-authority']],
    'How it works': ['How each figure is worked out, how fresh each source is, and plain definitions of the terms.',
      ['#/guide/methods', '#/data/trust', '#/data/glossary']],
    'The data': ['Every data file and source behind the site, with previews and a map.',
      ['#/data/explorer', '#/data/map', '#/data/sources']]
  };
  function areas() {
    var N = global.LabNav;
    if (!N || !N.MENUS) return '';
    // The county list the ranking's place count is counted from loads with Places' data.
    if (Pl.data) Pl.data();
    return '<section class="home-all" aria-labelledby="h-all"><h2 id="h-all">The four areas of the site</h2>' +
      '<p class="ha-lede">Each area answers one question. Here is what is in each part, and where to start.</p><div class="hall-grid hall-areas">' +
      N.MENUS.map(function (m) {
        var count = m.groups.reduce(function (t, g) { return t + g.items.length; }, 0);
        return '<article class="hall-card"><h3><a href="' + esc(m.hub) + '">' + esc(m.title) + '</a></h3><p class="hall-q">' + esc(m.question) + '</p>' +
          (AREAS[m.id] ? '<p class="hall-what">' + esc(AREAS[m.id]) + '</p>' : '') +
          m.groups.map(function (g) {
            var part = PARTS[g.title] || ['', []];
            // A lab route stays a route here, like every other link on Home, so the port points it at its hub page.
            // The ranking says how many places it covers, counted (the public site's count check reads it).
            var links = part[1].map(function (h) { return g.items.filter(function (it) { return it.lab === h; })[0]; }).filter(Boolean).map(function (it) {
              var text = it.lab === '#/places/ranking' && placeCount() ? 'Rank ' + allPlaces() : it.label;
              return '<a href="' + esc(it.lab || N.href(it)) + '" title="' + esc(it.desc || '') + '">' + esc(text) + '</a>';
            });
            // The parts describe what is on each page ("4% or 9% deals" names a kind of deal, not a figure to source).
            return '<div class="hall-part"><h4>' + esc(g.title) + '</h4>' + (part[0] ? '<p data-no-source="definition">' + esc(part[0]) + '</p>' : '') +
              (links.length ? '<p class="hall-links">' + links.join(' · ') + '</p>' : '') + '</div>';
          }).join('') +
          '<p class="hall-all"><a href="' + esc(m.hub) + '">All ' + count + ' in ' + esc(m.title) + ' →</a></p></article>';
      }).join('') + '</div></section>';
  }

  function home(params) {
    params = params || new URLSearchParams();
    var r = Shell.recent ? Shell.recent() : [];
    var x = UI.load(HOME_FILES), sum = stateSummary().data;
    // Incomes by tenure load on their own, so Home draws without them (the owner lines wait for them).
    var ten = UI.load({ tenure: 'data/hna/tenure-income.json' });
    var f = x.data ? homeFigures(Object.assign({ sum: sum || null, tenure: ten.data && ten.data.tenure }, x.data)) : null;
    var figures = x.error ? '<p class="callout">' + esc(x.error) + '</p>' : !f ? '<p role="status" class="note">Loading Colorado’s figures…</p>' : '';
    var g = params.get('town');
    return '<section class="home-hero hh-warm" aria-labelledby="home-h1"><div class="hh-copy"><p class="hh-kicker">COHO Analytics · Colorado housing</p>' +
      '<h1 id="home-h1">Colorado needs more homes that people can afford.</h1>' +
      '<p class="lede">We bring data and expert analysis to the people who work on housing, from town staff to builders, so communities can plan the homes they need and there is housing with dignity for all.</p></div>' +
      // The search comes before the county figure, so it is on the first phone screen; a picked town answers here.
      '<div class="hh-find">' + Shell.searchBox('home-place', 'Find your town or county', params.get('q') || '', 'For example Fruita or Mesa County') +
      found(params) + answer(params) + resume(params) +
      (g || params.get('q') ? '' : '<p class="hh-try">Try <a href="' + esc(homeHref(params, { town: '0828745' })) + '">Fruita</a> · <a href="' + esc(homeHref(params, { town: '08077' })) + '">Mesa County</a> · <a href="' + esc(homeHref(params, { town: '0862000' })) + '">Pueblo</a></p>') +
      '<p class="hh-help"><a href="#/assistance">Looking for a home? Rent help, eviction help and vouchers, English y español →</a></p></div>' +
      // The three ways in sit in the hero, under the search, where the five things leave room (paul, 24 Nov 2026:
      // "blank spaces that result in more scrolling"); after the five things in reading order, as before.
      fiveThings(f) + startPaths() + '</section>' +
      (f && global.LabTpl.newest(x.data) ? '<p class="page-meta home-stamp">' + global.LabTpl.stamp('Figures updated', global.LabTpl.newest(x.data)) + '</p>' : '') +
      // Search, five things and the three ways in (the one "Start here" entry the public site's tests hold), then one
      // row of goals; the rest in folds (reorg step 2b).
      doors(params) + (g ? quick(g) : '') + why() +
      // Colorado only: one picker on Home (the search above); counties and towns are on their own pages.
      // The chart shows open again (paul, 23 Nov: "the graphic nature and ux are important too").
      '<section class="home-rent" aria-labelledby="h-rent"><h2 id="h-rent">Rent and home prices against income</h2>' +
      '<p class="ha-lede">Statewide, for renters and for owners. For your own town, use the search at the top.</p>' +
      (global.LabRentIncome ? global.LabRentIncome.card('08') : '') + ownCard(f) + '</section>' +
      '<details class="home-about home-all-fold" data-fold="all"><summary>The four areas of the site, and what is in each</summary><div class="hf-body">' + areas() + '</div></details>' +
      '<p class="callout home-member"><strong>For developers and housing teams.</strong> The Market check and the for-sale study are free here. Members get the full versions, site dossiers and deal workbooks. <a href="#/members">Member tools</a></p>' +
      figures + (f ? '<details class="home-about home-counted"><summary>How the Colorado numbers are counted, and more of them</summary>' + glance(f) + moreNumbers(f) + '</details>' : '') +
      '<details class="home-about" id="home-about"><summary>How COHO works, who it is for, and the research behind it</summary>' + steps() + paths() + audiences() + research() + '</details>' +
      '<p><a href="' + esc(LIVE + 'places/index.html') + '">Local housing profiles</a>: a short page for every Colorado town and county.</p>' +
      (r.length ? '<h2>Recent in this browser</h2><ul class="route-list">' + r.map(function (x) { return '<li><a href="' + esc(x.href) + '">' + esc(x.label) + '</a></li>'; }).join('') + '</ul>' : '') +
      '<p><a href="#/sitemap">Site map</a> · <a href="#/search">Search the site</a>' +
      // The every-page index is a lab page; on the public site the site map is that list.
      (global.LAB_PORT ? '' : ' · <a href="#/tools">See all ' + Shell.catalog().total + ' pages</a>') + ' · <a href="#/privacy">Privacy</a></p>';
  }

  // ---- Housing help ------------------------------------------------------------------------------
  var RENT = [
    { title: 'Help right now: shelter, food, rent', phone: 'Call 2-1-1 or (866) 760-6489', text: 'Or text your ZIP code to 898-211. 2-1-1 Colorado connects you with emergency shelter, food and rent help. Free, confidential and multilingual.', link: ['211colorado.org', 'https://www.211colorado.org/'] },
    { title: 'Problems with a landlord or an eviction', phone: '1-844-926-6632', text: 'Colorado Housing Connects helps renters and mobile home owners with evictions and lease questions.', link: ['coloradohousingconnects.org', 'https://coloradohousingconnects.org/'] },
    { title: 'Behind on rent', phone: 'CARE Center (303) 838-1200', text: 'The state’s Emergency Rental Assistance is for Coloradans behind on rent who meet income limits. Call with an eviction notice or court summons, weekdays 8:30 to 5:30.', link: ['Emergency Rental Assistance', 'https://doh.colorado.gov/emergency-rental-assistance'] },
    { title: 'Find an income-restricted rental', phone: null, text: 'Search ColoradoHousingSearch.com, CHFA’s free listing site. For a Housing Choice Voucher, apply at your local housing authority.', link: ['ColoradoHousingSearch.com', 'https://www.coloradohousingsearch.com/'] }
  ];
  var REGIONS = [['', 'All of Colorado'], ['front-range', 'Front Range'], ['western', 'Western Slope'], ['mountains', 'Mountains'], ['southwest', 'Southwest'], ['south', 'South'], ['statewide', 'Statewide or online']];
  var LEVELS = [['federal', 'Federal'], ['colorado', 'Colorado'], ['metro', 'Metro']];
  var OWNER_KINDS = ['property-tax-relief'];
  var OWNER_IDS = ['colorado-wap-weatherization'];

  function helpCard(c) {
    return '<article class="help-card"><h3>' + esc(c.title) + '</h3>' + (c.phone ? '<p class="help-phone">' + esc(c.phone) + '</p>' : '') +
      '<p>' + esc(c.text) + '</p><p><a href="' + esc(c.link[1]) + '">' + esc(c.link[0]) + ' ↗</a></p></article>';
  }
  function worth(p) { return /^VERIFY/.test(p.what_its_worth || '') ? 'Amount: see the program page.' : p.what_its_worth; }
  // h is the card's heading level: one below the group heading when the programs are grouped.
  function programCard(p, h) {
    h = typeof h === 'string' ? h : 'h3';
    return '<article class="help-card program-card"><' + h + '>' + esc(p.name) + '</' + h + '>' +
      '<p class="help-worth">' + esc(worth(p)) + '</p>' +
      // The program's own plain summary, as the live Help for Homebuyers card shows it (QA 11-09).
      (p.plain_summary ? '<p>' + esc(p.plain_summary) + '</p>' : '') +
      '<p><span class="rc-k">Who it’s for</span> ' + esc(p.who_its_for) + '</p>' +
      '<p><span class="rc-k">How to start</span> ' + esc(p.how_to_start) + '</p>' +
      '<p class="note"><a href="' + esc(p.source_url) + '">Program page ↗</a> · checked ' + esc(p.last_verified) + '</p></article>';
  }

  // Homebuyer classes by region. The list arrived in the watchlist after the pinned copy (HA 26 Oct), so a copy
  // without it says so and links CHFA's own list.
  function classesPart(w, region, rlabel, classes) {
    if (!w.local_help) return '<h3>Homebuyer classes and local help</h3><p>CHFA lists approved homebuyer class providers across Colorado on its <a href="https://www.chfainfo.com/homeownership/homebuyer-education">homebuyer education page ↗</a>.</p>';
    return '<h3>Homebuyer classes and local help</h3><p class="note">' + esc(w.local_help_meta.note) + '</p>' +
      '<nav class="region-nav" aria-label="Region">' + REGIONS.map(function (r) {
        return '<a href="#/assistance' + (r[0] ? '?r=' + r[0] : '') + '"' + (r[0] === region ? ' aria-current="true"' : '') + '>' + esc(r[1]) + '</a>';
      }).join('') + '</nav>' +
      '<p class="count" role="status">' + classes.length + (classes.length === 1 ? ' provider' : ' providers') + ', ' + esc(rlabel) + '.</p>' +
      '<div class="table-scroll"><table><thead><tr><th scope="col">Provider</th><th scope="col">Area</th><th scope="col">What they offer</th><th scope="col">Phone</th></tr></thead><tbody>' +
      classes.map(function (h) {
        // Where a listing comes from a page other than the provider's own (a city or county list), that page is linked too, as on the old page.
        return '<tr><th scope="row"><a href="' + esc(h.url) + '">' + esc(h.name) + '</a></th><td>' + esc(h.area || '') + '</td><td>' + esc(h.offers || '') + (h.source_url && h.source_url !== h.url ? ' <a class="help-src" href="' + esc(h.source_url) + '">Source</a>' : '') + '</td><td>' + esc(h.phone || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="metric-source"><a href="' + esc(w.local_help_meta.source_url) + '">CHFA homebuyer education provider list</a> · COHO program watchlist, checked ' + esc(w.meta.last_verified) + '</p>';
  }

  function assistance(params) {
    var head = T.head({
      kind: 'hub', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Housing help' }], title: 'Housing help',
      answer: 'For people looking for a home to rent or buy, or trying to keep one. COHO is a data site and can’t take a single case; the groups below can. Every link goes to the official program.'
    });
    var paths = '<ul class="help-paths">' +
      '<li><a href="#/assistance" data-jump="help-rent"><span class="hp-t">I need a place to rent</span><span class="hp-d">Shelter, rent help, evictions, affordable rentals</span></a></li>' +
      '<li><a href="#/assistance" data-jump="help-buy"><span class="hp-t">I want to buy a home</span><span class="hp-d">Down payment help and homebuyer classes</span></a></li>' +
      '<li><a href="#/assistance" data-jump="help-own"><span class="hp-t">I own and need help</span><span class="hp-d">Property tax relief, repairs, foreclosure help</span></a></li></ul>';
    var rent = '<h2 id="help-rent" tabindex="-1">Renting</h2><div class="help-cards">' + RENT.map(helpCard).join('') + '</div>' +
      '<p>Your rights as a renter, legal help, vouchers and homeless services are in the <a href="#/guide/renter-help">full renter guide, in English and Spanish</a> (<a href="#/guide/renter-help?at=g-si-necesita-vivienda-ahora" lang="es">en español</a>).</p>' +
      '<p class="metric-source">As listed on the renter help page, each program read on 29 October 2026.</p>';

    var x = UI.load(PROGRAMS);
    if (x.error) return head + paths + rent + '<p class="callout">' + esc(x.error) + '</p>';
    if (!x.data) return head + paths + rent + '<p role="status" class="note">Loading the homebuyer programs…</p>';
    var w = x.data.watch, active = w.programs.filter(function (p) { return p.status === 'active'; });
    var buyer = active.filter(function (p) { return OWNER_KINDS.indexOf(p.kind) < 0 && OWNER_IDS.indexOf(p.id) < 0; });
    var owner = active.filter(function (p) { return OWNER_KINDS.indexOf(p.kind) > -1 || OWNER_IDS.indexOf(p.id) > -1; });
    var notNow = w.programs.filter(function (p) { return p.status !== 'active'; });
    var region = params.get('r') || '', rlabel = (REGIONS.filter(function (r) { return r[0] === region; })[0] || REGIONS[0])[1];
    var classes = (w.local_help || []).filter(function (h) { return !region || h.region === region; });

    // The live page groups its programs by who runs them: federal, statewide, then Denver metro.
    var levels = LEVELS.map(function (l) { return [l[1], buyer.filter(function (p) { return p.level === l[0]; })]; })
      .concat([['Other', buyer.filter(function (p) { return !LEVELS.some(function (l) { return l[0] === p.level; }); })]])
      .filter(function (l) { return l[1].length; });
    var buy = '<h2 id="help-buy" tabindex="-1">Buying a home</h2>' +
      '<p>First, see <a href="#/for-sale">what a household at each income can pay</a> against what homes cost in your town. Then the programs below can close the gap.</p>' +
      '<aside class="callout"><h3>Start here</h3><p>These cards explain programs in plain terms. They are not a substitute for a lender, tax professional, program administrator or HUD-approved housing counselor. Terms change, funding can pause, and eligibility depends on your household, lender, property and timing.</p>' +
      '<p>Quick terms: <strong>DPA</strong> means down-payment assistance. <strong>AMI</strong> means area median income. A <strong>tax credit</strong> reduces tax owed dollar for dollar; a deduction reduces taxable income.</p>' +
      '<p>For CHFA programs the next step is usually a participating lender and <a href="https://www.chfainfo.com/homeownership/homebuyer-education">CHFA-approved homebuyer education ↗</a>. For tax credits, talk with a tax professional before counting a benefit in your budget.</p></aside>' +
      levels.map(function (l) { return (levels.length > 1 ? '<h3>' + esc(l[0]) + '</h3>' : '') + '<div class="help-cards">' + l[1].map(function (p) { return programCard(p, levels.length > 1 ? 'h4' : 'h3'); }).join('') + '</div>'; }).join('') +
      '<p>Every program COHO tracks, with its status, who runs it and its official source, including ones that have ended or are only proposed, is on the <a href="#/guide/homebuyer-help">full Help for Homebuyers page</a>.</p>' +
      '<details class="review-rules"><summary>Data sources and review rules</summary><ul>' +
      '<li>Each card is from COHO’s homeownership program watchlist and links the program’s official page.</li>' +
      '<li>Dollar amounts are shown only when the official page stated them clearly.</li>' +
      '<li>Where the official page gives no single amount, or the amount depends on the borrower, the card says to see the program page.</li>' +
      '<li>Informational only. Confirm current terms with the program administrator, a participating lender, a HUD-approved housing counselor or a qualified tax professional.</li></ul></details>' +
      classesPart(w, region, rlabel, classes);

    var own = '<h2 id="help-own" tabindex="-1">Keeping your home</h2><div class="help-cards">' + owner.map(programCard).join('') +
      helpCard({ title: 'Behind on the mortgage', phone: null, text: 'The Division of Housing lists free foreclosure counseling and legal help.', link: ['Foreclosures, evictions and legal help', 'https://doh.colorado.gov/foreclosures-evictions-and-legal-help'] }) + '</div>' +
      // Each links its official source, as the old Help for Homebuyers page did (content check gap 11).
      (notNow.length ? '<p class="note">Not available now: ' + notNow.map(function (p) { return (p.source_url ? '<a href="' + esc(p.source_url) + '">' + esc(p.name) + '</a>' : esc(p.name)) + ' (' + esc(p.status === 'VERIFY' ? 'being checked' : p.status) + ')'; }).join('; ') + '.</p>' : '');

    return head + paths + rent + buy + own +
      '<h2>More help pages</h2>' + Shell.list(Shell.inHub('assistance')) +
      // On the public site the list above already names both pages (their own addresses open the guides).
      (global.LAB_PORT ? '' : '<ul class="route-list"><li><a href="#/guide/renter-help">If You Need Housing Now (renters, English and Spanish)</a></li>' +
      '<li><a href="#/guide/homebuyer-help">Help for Homebuyers (every program, with sources)</a></li></ul>');
  }

  // ---- Shell pages: not found, privacy, search, site map, share card --------------------------------------
  function utilHead(title, answer) {
    return T.head({ kind: 'hub', crumbs: [{ label: 'Home', href: '#/' }, { label: title }], title: title, answer: answer });
  }

  // Any address with no lab page (shell.js hands unknown routes here). The live 404.html's links, as lab pages.
  function notFound() {
    return utilHead('That page is not here', 'There is no page at this address. Pages move when the site changes; the places below are always current.') +
      '<ul class="choices">' +
      Shell.choice('#/places', 'Pick a Colorado place', 'Start a housing needs assessment for a county, city, town or CDP.') +
      Shell.choice('#/places/ranking', 'Compare ' + allPlaces(), 'Ranked on need and opportunity.') +
      Shell.choice('#/places', 'Browse place profiles', 'Every city, town and CDP.') +
      Shell.choice('#/search', 'Search the site', 'Pages, data sources and place profiles.') +
      Shell.choice('#/sitemap', 'Site map', 'Every page, listed.') +
      '</ul><p>Think this link should work? It may be a data file that moved in a refresh. <a href="#/data/explorer">The data explorer</a> lists every current file.</p>' +
      '<p><a class="button-link" href="#/">Go to Home</a></p>';
  }

  // privacy-policy.html, section by section (read 1 Nov 2026).
  var FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSfC1m7Y1_b3VL_U9rOg8f0nIE14RVg8qm4gvhQaG2Qw8vVOdw/viewform';
  var MAIL = '<a href="mailto:info@cohoanalytics.com">info@cohoanalytics.com</a>';
  var PRIVACY = [
    ['data', 'Data collection', 'The site does not sell personal information and needs no account. It asks for information in two places only. The optional <a href="' + FORM + '">questions or feedback form</a> (a Google Form) records what you type, the page you sent it from, the role you pick, and an email address only if you give one. Responses sit in a private spreadsheet read by the site’s maintainers and are not published or shared; <a href="https://policies.google.com/privacy">Google’s privacy policy</a> applies to the form. Email to ' + MAIL + ' is passed by an email-forwarding service to the maintainers’ private mailbox, where your address and message are kept. Emails are not published or shared.'],
    ['analytics', 'Analytics and tracking', 'Visits are counted with Cloudflare Web Analytics. It sets no cookies, does not fingerprint your browser and does not track you across sites; it records only anonymous page views, the referring site, and coarse browser, device and country. Developer pages are not measured. No advertising trackers are used. See the <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare privacy policy</a>.'],
    ['cookies', 'Cookies', 'Only functional cookies, for features such as remembering dark mode. No advertising or cross-site tracking cookies. Clearing cookies in your browser does not affect access to anything on the site.'],
    ['third', 'Third-party services', 'Figures come from public services run by others, including the Federal Reserve Bank of St. Louis (FRED), the U.S. Census Bureau, the Bureau of Labor Statistics, HUD, CHFA via ArcGIS, and Esri/ArcGIS maps. When your browser fetches data from them directly, their own privacy policies apply. The site does not control their data practices.'],
    ['tiles', 'Map tiles', 'Maps are drawn with Leaflet on base tiles that may come from OpenStreetMap contributors or other tile providers, whose servers may log your IP address. See the <a href="https://wiki.osmfoundation.org/wiki/Privacy_Policy">OpenStreetMap Foundation privacy policy</a>.'],
    ['links', 'External links', 'The site links to government and industry resources. It is not responsible for their content or privacy practices, and a link is not an endorsement.'],
    ['retention', 'Data retention', 'Apart from messages you send through the form or by email, the site keeps no user data. Form responses and emails are kept while they are useful for answering you or fixing the site, and deleted on request. Cached public datasets (for example data/fred-data.json) hold only aggregated economic series, with no personal information.'],
    ['rights', 'Your rights', 'To have a feedback message or email you sent corrected or deleted, ask through the same form or at ' + MAIL + ', and include the email address you used. If you believe anything on the site violates your rights or is inaccurate about you, please get in touch.'],
    ['contact', 'Contact', 'Send privacy questions through the <a href="' + FORM + '?usp=pp_url&amp;entry.440415848=%2Fprivacy-policy.html">questions or feedback form</a> or by email to ' + MAIL + '.'],
    ['updates', 'Policy updates', 'This policy may change as the site changes. The current version is always on this page.']
  ];
  function privacy() {
    return utilHead('Privacy policy', 'How the site handles data, cookies and third-party services. In short: no accounts, no selling data, no advertising trackers, and no cookies beyond what features need.') +
      '<ul class="priv-sum">' + [['No account', 'Nothing to sign up for on the free site'], ['No ad trackers', 'Visits are counted without cookies'], ['Two ways to reach us', 'A feedback form and email, kept private']].map(function (x) {
        return '<li><strong>' + esc(x[0]) + '</strong><span>' + esc(x[1]) + '</span></li>';
      }).join('') + '</ul>' +
      PRIVACY.map(function (x) { return '<section class="priv-sec"><h2 id="priv-' + x[0] + '">' + esc(x[1]) + '</h2><p>' + x[2] + '</p></section>'; }).join('');
  }

  // search.html: what readers look for, opened in the lab. One record per menu page (its label and its one
  // line from the menus), the housing help page, every place profile and county needs assessment, and the
  // data sources. Maintainer screens and the live site's old addresses are left out, as on the live
  // search (Housing-Analytics scripts/lib/search-index.mjs SEARCH_HIDDEN).
  var SEARCH_HIDDEN = ['#/data/quality', '#/data/status'];
  // Plain words readers type for a page whose own text says it another way.
  var SEARCH_WORDS = {
    '#/assistance': 'help paying rent rental assistance rent help eviction help emergency housing homeless shelter find affordable housing apply voucher section 8 first-time homebuyer down payment help buy a home',
    '#/guide/methods': 'how numbers are calculated methodology',
    '#/data/trust': 'where the data comes from how current data freshness',
    '#/guide/lihtc-basics': 'what is lihtc tax credit basics how tax credits work',
    '#/guide/housing-authority': 'start create a housing authority'
  };
  // Colorado's 64 counties in FIPS order: odd codes from 001 (Adams) to 125 (Yuma), with Broomfield (014)
  // added in 2001. The order is the Census's own, so Lake (065) comes before La Plata (067).
  var COUNTY_FIPS = ('Adams Alamosa Arapahoe Archuleta Baca Bent Boulder Chaffee Cheyenne Clear_Creek Conejos Costilla Crowley Custer Delta Denver ' +
    'Dolores Douglas Eagle Elbert El_Paso Fremont Garfield Gilpin Grand Gunnison Hinsdale Huerfano Jackson Jefferson Kiowa Kit_Carson Lake La_Plata ' +
    'Larimer Las_Animas Lincoln Logan Mesa Mineral Moffat Montezuma Montrose Morgan Otero Ouray Park Phillips Pitkin Prowers Pueblo Rio_Blanco ' +
    'Rio_Grande Routt Saguache San_Juan San_Miguel Sedgwick Summit Teller Washington Weld Yuma').split(' ').map(function (n, i) {
    return [n.replace(/_/g, ' '), '08' + ('00' + (2 * i + 1)).slice(-3)];
  }).concat([['Broomfield', '08014']]);
  function countyRecords() {
    return COUNTY_FIPS.map(function (c) {
      return { t: c[0] + ' County', u: '#/place/' + c[1], d: 'Housing needs assessment for ' + c[0] + ' County.', kind: 'County' };
    });
  }
  function searchRecords() {
    var out = [], seen = {};
    // Keyed by link and kind: the menu's Housing Needs Assessment opens Fruita as its sample, and Fruita's
    // own place record must still be found by its name.
    function add(r) { var key = r.u + ' ' + (r.kind || ''); if (!r.u || seen[key] || SEARCH_HIDDEN.indexOf(r.u) > -1) return; seen[key] = true; r.a = SEARCH_WORDS[r.u] || ''; out.push(r); }
    add({ t: 'Housing help', u: '#/assistance', d: 'Help to rent, buy or keep a home in Colorado: rent help, eviction and legal help, vouchers and homebuyer programs.' });
    ((global.LabNav && global.LabNav.MENUS) || []).forEach(function (m) {
      m.groups.forEach(function (g) { g.items.forEach(function (it) { if (it.lab) add({ t: it.label, u: it.lab, d: it.desc || '', k: m.title + ' ' + g.title }); }); });
    });
    countyRecords().forEach(add);
    Shell.catalog().entries.filter(function (e) { return e.role === 'generated-place' && e.geoid; }).forEach(function (e) {
      add({ t: e.label, u: '#/place/' + e.geoid, d: '', kind: 'Place profile' });
    });
    addSiteIndex(out);
    return out;
  }

  // The rest of what the site's own search finds (Housing-Analytics search-index.json, built by
  // scripts/build-public-site.mjs from scripts/lib/search-index.mjs): the glossary's terms, the deep dive's funding
  // programs, the research briefs and the method notes, and the headings and words of every page. Each opens its new
  // view where there is one. A page already listed above keeps one entry and gains that page's words, so a search
  // for a heading on it still finds it. Without the file (the bare lab) the list above is the whole search.
  var SITE_INDEX = { data: null, asked: false };
  function siteIndex() {
    if (!SITE_INDEX.asked) {
      SITE_INDEX.asked = true;
      fetch((global.LAB_VENDOR || '') + 'search-index.json').then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) { SITE_INDEX.data = Array.isArray(j) ? j : []; if (/^#\/search/.test(location.hash)) Shell.render(); }, function () { SITE_INDEX.data = []; });
    }
    return SITE_INDEX.data || [];
  }
  // A page of the old site whose lab route is drawn by a hub page (the port's FORWARD map read backwards), so a
  // result opens the new view, not the page it replaced.
  function rebuiltRoute(file) {
    var port = global.LAB_PORT;
    if (!port || !port.FORWARD) return null;
    var hit = null;
    Object.keys(port.FORWARD).forEach(function (route) {
      if (!hit && port.FORWARD[route] === file && (port.carries(route) || port.hubFor(route))) hit = route;
    });
    return hit;
  }
  function siteIndexHref(u) {
    u = String(u || '');
    if (/^https?:/.test(u)) return u;
    var m = /^places\/(\d{5}|\d{7})\.html$/.exec(u);
    if (m) return '#/place/' + m[1];
    if (u === 'places/index.html') return '#/places';
    m = /^research-brief\.html\?id=([A-Za-z0-9_-]{1,120})$/.exec(u);
    if (m) return '#/research/brief/' + m[1];
    // A glossary term opens the glossary on that term; a funding program opens the deep dive's funding tab on it.
    m = /^index\.html#glossary(?:=(.*))?$/.exec(u);
    if (m) { var term = ''; try { term = decodeURIComponent(m[1] || ''); } catch (e) { term = ''; } return '#/data/glossary' + (term ? '?term=' + encodeURIComponent(term) : ''); }
    m = /^colorado-deep-dive\.html\?program=([a-z0-9-]{1,80})(?:#tab-funding)?$/.exec(u);
    if (m) return '#/places/deep-dive?tab=funding&program=' + m[1];
    var moved = global.LabNav && global.LabNav.movedHref(u);
    if (moved) return moved;
    var file = /^([a-z0-9-]+\.html)$/i.exec(u);
    var route = file && rebuiltRoute(file[1].toLowerCase());
    if (route) return route;
    return ((global.LabNav && global.LabNav.LIVE) || '') + u;
  }
  function siteIndexTag(u) {
    if (/^index\.html#glossary=/.test(u)) return 'Glossary';
    if (/[?&]program=/.test(u)) return 'Funding program';
    if (/^research-brief\.html/.test(u)) return 'Research brief';
    if (/^docs\//.test(u)) return 'Method note';
    return '';
  }
  function addSiteIndex(out) {
    var byHref = {}, seen = {};
    out.forEach(function (r) { if (!byHref[r.u]) byHref[r.u] = r; seen[r.u + ' ' + fold(r.t)] = true; });
    siteIndex().forEach(function (x) {
      if (!x || !x.u || /^search\.html/.test(x.u)) return;
      var u = siteIndexHref(x.u), tag = siteIndexTag(x.u), words = [x.k, x.b].filter(Boolean).join(' ');
      var title = String(x.t || '').replace(/\s*\|\s*COHO[^|]*$/, '');
      if (SEARCH_HIDDEN.indexOf(u) > -1) return;
      // A page the list already has: one entry, with this page's headings and words added.
      if (!tag && byHref[u]) { byHref[u].b = [byHref[u].b, words].filter(Boolean).join(' '); return; }
      var key = u + ' ' + fold(title);
      if (seen[key]) return;
      seen[key] = true;
      var r = { t: title, u: u, d: x.d || '', k: '', a: x.a || '', b: words, tag: tag };
      if (!tag) byHref[u] = r;
      out.push(r);
    });
  }
  function fold(text) { return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  // Every word must appear (AND). A title hit at the start of a word scores most, then the reader words,
  // then the menu group, then the one-line description, then the page's own headings and words (from the site's
  // search index). Places and counties match on their name only.
  function scoreRecord(r, words) {
    var t = fold(r.t), a = fold(r.a), k = fold(r.k), d = fold(r.d), b = fold(r.b), s = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], start = new RegExp('(^|[^a-z0-9])' + w);
      var inT = start.test(t), inA = start.test(a), inK = start.test(k), inD = start.test(d), inB = !!b && start.test(b);
      if (r.kind && !inT) return 0;
      if (!inT && !inA && !inK && !inD && !inB) return 0;
      s += (t.indexOf(w) === 0 ? 14 : inT ? 9 : 0) + (inA ? 6 : 0) + (inK ? 3 : 0) + (inD ? 2 : 0) + (inB ? 1 : 0);
    }
    return r.kind === 'Place profile' ? s * 0.9 : s;
  }
  function rankSearch(records, q) {
    var words = fold(q).replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return records.map(function (r) { return { r: r, s: scoreRecord(r, words) }; }).filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.r.t.length - b.r.t.length; }).map(function (x) { return x.r; });
  }
  function search(params) {
    var q = (params && params.get('q')) || '';
    var records = searchRecords();
    var inv = global.DataSourceInventory, srcs = inv && typeof inv.getSources === 'function' ? inv.getSources() : [];
    var hits = q ? rankSearch(records, q) : [];
    var words = fold(q).split(/\s+/).filter(Boolean);
    var srcHits = q ? srcs.filter(function (s) { var hay = fold((s.name || '') + ' ' + (s.provider || '') + ' ' + (s.category || '') + ' ' + (s.id || '')); return words.every(function (w) { return hay.indexOf(w) > -1; }); }) : [];
    var places = records.filter(function (r) { return r.kind; }).length, terms = records.filter(function (r) { return r.tag; }).length;
    var body = !q ? '<p class="count">Type a place (for example Silt), a topic (LIHTC, AMI, rent burden) or a page name. ' + (records.length - places - terms) + ' pages, ' +
        (terms ? terms + ' terms, funding programs, research briefs and method notes, ' : '') + places + ' places and counties' + (srcs.length ? ', and ' + srcs.length + ' data sources' : '') + '.</p>' +
        '<p class="note">Try: <a href="#/search?q=Silt">Silt</a> · <a href="#/search?q=LIHTC">LIHTC</a> · <a href="#/search?q=AMI">AMI</a> · <a href="#/search?q=preservation">preservation</a></p>'
      : '<p class="count" role="status">' + (hits.length + srcHits.length === 0 ? 'No matches. Try fewer words.' : (hits.length ? hits.length + (hits.length === 1 ? ' result' : ' results') : '') + (hits.length && srcHits.length ? ' and ' : '') + (srcHits.length ? srcHits.length + (srcHits.length === 1 ? ' data source' : ' data sources') : '') + '.') + '</p>' +
        (hits.length ? '<h2>Pages, places and terms</h2><ul class="route-list">' + hits.slice(0, 50).map(function (r) {
          return '<li><a href="' + esc(r.u) + '">' + esc(r.t) + '</a>' + (r.kind || r.tag ? '<span class="status">' + esc(r.kind || r.tag) + '</span>' : '') + (r.d ? '<p class="note">' + esc(r.d) + '</p>' : '') + '</li>';
        }).join('') + '</ul>' + (hits.length > 50 ? '<p class="note">Showing 50 of ' + hits.length + '. Type more to narrow the list.</p>' : '') : '') +
        (srcHits.length ? '<h2>Data sources</h2><ul class="route-list">' + srcHits.slice(0, 20).map(function (s) { return '<li><a href="#/data/sources?source=' + esc(encodeURIComponent(s.id)) + '">' + esc(s.name || s.id) + '</a><p class="note">' + esc([s.provider, s.category].filter(Boolean).join(' · ')) + '</p></li>'; }).join('') + '</ul>' : '');
    return utilHead('Search the site', 'Find any Colorado place, county, tool, guide or data source. Type a place, a topic or a page name.') +
      Shell.searchBox('search-q', 'Search', q, 'Place, topic or page') + body;
  }

  // sitemap.html's four groups and their pages, each opened in the lab where the lab has it.
  var SITEMAP = [
    ['Analysis tools', [['Housing needs assessment', 'County and town needs assessment', '#/places'], ['Select a jurisdiction', 'Choose a county, town or CDP', '#/places'], ['Place profiles', 'One page for every Colorado city, town and CDP', '#/places'],
      ['Opportunity Finder', 'Rank places for tax credit opportunity (free version; full Finder for members)', '#/finder'], ['Compare places', 'Side-by-side comparison', '#/places/compare'], ['Market check', 'Market area and feasibility, free (the full Market Analysis is step 4 of Build a deal)', '#/market'],
      ['Scenario builder', '20-year population and housing forecasts', '#/places/scenario'], ['Deal Calculator', 'Tax credit pro forma and capital stack', '#/deal-calculator'], ['Land value and negotiation', 'Market comps and residual land bid', '#/opportunity/land-value'],
      ['Colorado deep dive', 'Market signals, construction labor and costs, tax credit history, counties', '#/places/deep-dive']]],
    ['Dashboards', [['Economic dashboard', 'FRED economic indicators', '#/places/economy'], ['CHFA portfolio', 'CHFA tax credit projects', '#/opportunity/portfolio'], ['Where Colorado’s housing money goes', 'State housing awards by place and developer', '#/money'],
      ['Prop 123 land banking awards', 'Where Prop 123 has paid for land', '#/opportunity/land-banking'], ['Commuting and jobs', 'Who drives in to work, and the largest employers', '#/opportunity/commuting'], ['Preservation tracking', 'Federal subsidy contracts ending', '#/opportunity/preservation']]],
    ['Insights', [['Research and analysis', 'Dated analysis and research briefs', '#/guides?at=research-all'], ['LIHTC guide', 'Tax credit basics for stakeholders', '#/guide/lihtc-basics'], ['Who does what in a Colorado affordable deal', 'Bankers, syndicators, lawyers, community work and CRA', '#/guide/deal-team'],
      ['Green building in a Colorado deal', 'CHFA rules, utility allowances, programs', '#/guide/green-building'], ['Affordable Housing Credit Improvement Act', 'Enacted provisions and pending bills', '#/guide/ahcia'], ['Policy and legislation', 'Laws, rules and CHFA plan changes we track', '#/legislation'],
      ['If you need housing now', 'Rent help, eviction help and vouchers, in English and Spanish', '#/guide/renter-help'], ['Help for homebuyers', 'Credits, grants and down payment help', '#/assistance'], ['Starting a housing authority', 'Colorado steps, the board, and tax exemptions', '#/guide/housing-authority'],
      ['Housing news', 'Headlines, newest first, with a policy watch', '#/news'], ['Colorado elections', '2026 ballot, candidates, housing officials', '#/elections'], ['White paper for planners', 'A finding in plain language', '#/guide/white-paper'],
      ['Working paper', 'Why the system works the way it does', '#/guide/working-paper'], ['Methods', 'Every formula, to check a number', '#/guide/methods'], ['Tax credit equity markets', 'Equity pricing history and benchmarks', '#/equity-pricing'],
      ['CRA expansion and tax credit pricing', 'Hypothetical CRA pricing scenarios', '#/guide/cra-pricing'], ['Need and opportunity ranking', 'Statewide ranking: 55% need, 45% opportunity', '#/places/ranking']]],
    ['About', [['Home', 'Platform overview', '#/'], ['About COHO Analytics', 'Platform and method', '#/guide/about'], ['Data health', 'Pipeline status and data freshness', '#/data/trust?at=trust-today'], ['Data trust center', 'Sources, freshness and checks', '#/data/trust'],
      ['File browser', 'Browse datasets with previews', '#/data/explorer'], ['Data map', 'Datasets on a map', '#/data/map'], ['Affordable housing pipeline', 'From need to homes, step by step', '#/pipeline'], ['Privacy policy', 'Data and privacy', '#/privacy']]]
  ];
  function sitemap() {
    return utilHead('Site map', 'Every page and tool on COHO Analytics, in four groups. Member tools are listed on <a href="#/members">Member tools</a>.') +
      '<nav class="otp-inline on-this-page" aria-label="Groups"><ol>' + SITEMAP.map(function (g, i) { return '<li><a href="#/sitemap" data-jump="sm-' + i + '">' + esc(g[0]) + '</a></li>'; }).join('') + '</ol></nav>' +
      SITEMAP.map(function (g, i) {
        return '<section class="sm-group"><h2 id="sm-' + i + '" tabindex="-1">' + esc(g[0]) + '</h2><ul class="sm-grid">' + g[1].map(function (x) {
          var ext = /^https/.test(x[2]);
          return '<li><a href="' + esc(x[2]) + '"><strong>' + esc(x[0]) + (ext ? ' <span class="live-tag">live site ↗</span>' : '') + '</strong><span>' + esc(x[1]) + '</span></a></li>';
        }).join('') + '</ul></section>';
      }).join('');
  }

  // og-card.html: the picture social sites show beside a shared cohoanalytics.com link, drawn at its 1200 × 630 shape.
  function shareCard() {
    return utilHead('Share card', 'When someone shares a cohoanalytics.com link, social sites and chat apps show this card beside it. It is a picture, not a page people read.') +
      '<figure class="og-frame" data-no-source="catalog: a picture of the share card, with no figures"><div class="og-card" role="img" aria-label="Share card: Colorado needs more homes that people can afford. COHO Analytics, free, every number sourced."><p class="og-brand">COHO Analytics · Colorado housing</p>' +
      '<h2 class="og-title">Colorado needs more homes that people can afford.</h2><p class="og-tag">The need in every town and county, where to build, and whether a project works.</p>' +
      '<p class="og-foot">cohoanalytics.com<span class="og-free">Free · every number sourced</span></p></div>' +
      '<figcaption class="note">Shown at 1200 × 630, the shape link previews use.</figcaption></figure>';
  }

  Shell.views['not-found'] = notFound;
  Shell.views.privacy = privacy;
  Shell.views.search = search;
  Shell.views.sitemap = sitemap;
  Shell.views['share-card'] = shareCard;
  Shell.views.home = home;
  Shell.views.assistance = assistance;
  global.LabHome = { home: home, firstMatch: firstMatch, homeHref: homeHref, QUICK: QUICK, DOORS: DOORS, assistance: assistance, notFound: notFound, privacy: privacy, search: search, searchRecords: searchRecords, rankSearch: rankSearch, COUNTY_FIPS: COUNTY_FIPS, sitemap: sitemap, shareCard: shareCard, TOOLS: TOOLS, RENT: RENT, STEPS: STEPS, SITEMAP: SITEMAP, homeFigures: homeFigures, HOME_FILES: HOME_FILES, stateSummary: stateSummary };
})(window);
