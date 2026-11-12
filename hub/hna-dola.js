// SB24-174 view of the Housing Needs Assessment: DOLA's required tables, worked from the HNA's own files.
//
// What the law asks (C.R.S. 24-32-3702(1)(d), 24-32-3703; SB24-174 signed act) and how DOLA asks for it
// (Housing Needs Assessment Guide for Colorado Communities, December 2024, pp. 5-7 and 42-52):
//   Output 1  existing shortage ("catch-up"): one home per two overcrowded homes, plus rentals to bring
//             long-term rental vacancy to 5% and homes for sale to bring owner vacancy to 2%, seasonal homes left out.
//   Output 2  ten-year need ("keep-up"): State Demography Office household growth plus a 5% rental and 2% owner
//             vacancy allowance. This is the Housing-Analytics series housing_need.tenure_split
//             .incremental_units_needed_tenure_adjusted (county) and places.json incremental_tenure_adjusted
//             (town), read here, not recomputed.
//   Output 3  the local study area's total (a local HNA shows its own area; a regional HNA allocates by jobs).
//   Output 4  supportive homes (separate from the total) and accessible or visitable homes (a share of Output 2).
// Income tiers are HUD CHAS 2018-2022's. CHAS stops at "over 100% AMI", so DOLA's 81-120% and 120%+ rows are
// shown as 81-100% and over 100%; the split needs ACS income against HUD limits, which the HNA does not hold yet.
//
// Assumptions, each shown on the page beside the table it changes:
//   - Overcrowding is split between owners and renters by their share of households (ACS B25014's tenure split
//     is not in the HNA's files).
//   - Overcrowding is spread over income tiers as households are today; the vacancy adjustments only over the
//     tiers at or below 80% AMI (DOLA's example: "below-market AMI categories only", guide p. 44).
//   - Keep-up is spread over income tiers as each tenure's households are today (DOLA's example, p. 46).
//   - Accessible and visitable homes = residents with a disability (ACS DP02_0072E) / people in households
//     (DP02_0001E x DP02_0016E; total population would count prisons and nursing homes)
//     x the ten-year need (DOLA's example, p. 52). A person share, not a household share.
//
// Built for porting to Housing-Analytics as js/hna/hna-dola.js: pure functions plus one HTML builder, no DOM,
// no fetch. The regional table below belongs in data/policy/state-housing-laws.json when it ports.
(function (global) {
  'use strict';

  var AS_OF = '2026-11-06';
  var DEADLINE = '31 December 2026';
  var TIERS = [
    ['lte30', '≤30% AMI', 'Extremely low income'],
    ['31to50', '31–50% AMI', 'Very low income'],
    ['51to80', '51–80% AMI', 'Low income'],
    ['81to100', '81–100% AMI', 'Moderate income (lower part)'],
    ['100plus', 'Over 100% AMI', 'Moderate (upper part), middle and upper income']
  ];
  var BELOW_MARKET = ['lte30', '31to50', '51to80'];
  var RENT_VAC = 0.05, OWN_VAC = 0.02, YEARS = 10;

  var SRC = {
    act: 'https://leg.colorado.gov/sites/default/files/2024a_174_signed.pdf',
    guide: 'https://drive.google.com/file/d/1Q9-tcf1Yey6GGzvbwMROtrNYLjVG9-QY/view',
    displacement: 'https://drive.google.com/file/d/11fCO-hFcqlt2mDBCbKpO7D00l1sud5SE/view',
    plans: 'https://dlg.colorado.gov/housing-plans',
    approved: 'https://docs.google.com/spreadsheets/d/1ea3SU0IQSw6CYARg-YblGj9Iy2y8LUefT-NCCoWtzR4',
    multilaw: 'https://docs.google.com/spreadsheets/d/1dGcQTZ9X_3CUipeQ1q15xZLFMtGvzFgwfWrGDSkYo04/edit',
    selfCheck: 'https://docs.google.com/document/d/1wAU8R2iKS_jWgZCs54n6tmyR-qGf3C5V3mtagngf5ZU/edit',
    chas: 'https://www.huduser.gov/portal/datasets/cp.html',
    sdo: 'https://demography.dola.colorado.gov/',
    b25004: 'https://data.census.gov/table/ACSDT5Y2024.B25004'
  };
  var MEMBER = 'https://coho-backend.communityplanner.workers.dev/';

  // Approved regional HNAs on DOLA's list (read 2026-11-06) and who they can cover. A government inside one is
  // exempt from its own HNA only if it took part: its governing body reviewed the regional HNA at a public meeting
  // and sent comments (C.R.S. 24-32-3703(4)(a), 24-32-3704(2)). "partner" = the regional HNA names it as a partner;
  // "check" = it is in the region, but whether it took part has to be confirmed.
  var DRCOG_MEMBERS = ['Arvada', 'Aurora', 'Bennett', 'Black Hawk', 'Boulder', 'Bow Mar', 'Brighton', 'Castle Pines', 'Castle Rock',
    'Centennial', 'Central City', 'Cherry Hills Village', 'Columbine Valley', 'Commerce City', 'Dacono', 'Deer Trail', 'Edgewater', 'Empire',
    'Englewood', 'Erie', 'Federal Heights', 'Firestone', 'Foxfield', 'Frederick', 'Georgetown', 'Glendale', 'Golden', 'Greenwood Village',
    'Idaho Springs', 'Lafayette', 'Lakewood', 'Larkspur', 'Littleton', 'Lochbuie', 'Lone Tree', 'Longmont', 'Louisville', 'Lyons', 'Mead',
    'Morrison', 'Nederland', 'Northglenn', 'Parker', 'Sheridan', 'Silver Plume', 'Superior', 'Thornton', 'Westminster', 'Wheat Ridge',
    'Denver', 'Broomfield'];
  var REGIONAL = [
    { id: 'drcog', title: 'DRCOG Regional Housing Needs Assessment', approved: '2025-05-21', url: 'https://drcog.org/growth-development/regional-housing-needs-assessment',
      names: DRCOG_MEMBERS, basis: 'check', who: 'DRCOG member governments (board roster, 2 July 2024)', rosterUrl: 'https://drcog.org/sites/default/files/acc/Board_Roster_as-of-24-07-02.pdf' },
    { id: 'larimer', title: 'Larimer County Regional Housing Needs Assessment', approved: '2026-06-08', url: 'https://www.larimer.gov/housing/partners/housing-assessment',
      names: ['Fort Collins', 'Loveland'], basis: 'partner', who: 'Larimer County, Fort Collins and Loveland' },
    { id: 'eagle', title: 'Eagle County Regional Housing Needs Analysis', approved: '2026-01-14', url: 'https://www.avon.org/2382/Housing',
      counties: ['08037'], basis: 'check', who: 'Eagle County and its towns' },
    { id: 'gunnison', title: 'Gunnison Valley Housing Needs Assessment', approved: '2026-05-05', url: 'https://townofcrestedbutte.colorado.gov/sites/g/files/lrnvjt3261/files/documents/Gunnison%20Valley%20Housing%20Needs%20Assessment%202024_0.pdf',
      counties: ['08051'], basis: 'check', who: 'Gunnison County and its towns' },
    { id: 'sanmiguel', title: 'San Miguel County Housing Needs Analysis', approved: '2026-05-07', url: 'https://smrha.org/needs-assessment/',
      counties: ['08113'], basis: 'check', who: 'San Miguel County and its towns' },
    { id: 'eccog', title: 'East Central Council of Local Governments Regional Housing Needs Assessment', approved: '2025-12-23', url: 'https://www.eccog.com/',
      counties: ['08017', '08039', '08063', '08073'], basis: 'check', who: 'Cheyenne, Elbert, Kit Carson and Lincoln counties and their towns' },
    { id: 'archuleta', title: 'Archuleta County Regional Housing Needs Assessment', approved: '2025-05-07', url: 'https://www.archuletacounty.org/886/Archuleta-County-Housing-Needs-Assessmen',
      names: ['Pagosa Springs'], basis: 'partner', who: 'Archuleta County and Pagosa Springs' }
  ];

  function n(x) { return x == null || x === '' || !isFinite(Number(x)) ? null : Number(x); }
  function sum(a) { return a.reduce(function (t, x) { return t + (x || 0); }, 0); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt(x) { return x == null ? '—' : Math.round(x).toLocaleString('en-US'); }
  function longDate(iso) {
    var M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var p = String(iso || '').split('-');
    return p.length === 3 ? Number(p[2]) + ' ' + M[Number(p[1]) - 1] + ' ' + p[0] : String(iso || '');
  }

  // Whole numbers that add up to the rounded total (largest remainder), so a table's rows sum to its total line.
  function roundTo(values) {
    var total = Math.round(sum(values));
    var floors = values.map(function (v) { return Math.floor(v || 0); });
    var left = total - sum(floors);
    values.map(function (v, i) { return [(v || 0) - floors[i], i]; }).sort(function (a, b) { return b[0] - a[0]; })
      .slice(0, Math.max(0, left)).forEach(function (r) { floors[r[1]]++; });
    return floors;
  }

  // Spread a number over tiers in proportion to weights; all-zero weights give nulls (nothing to spread by).
  function spread(amount, weights) {
    var w = sum(weights);
    return weights.map(function (x) { return w > 0 ? amount * (x || 0) / w : null; });
  }

  function tierCounts(chas, tenure) {
    var t = chas && chas[tenure + '_hh_by_ami'];
    if (!t) return null;
    var out = TIERS.map(function (r) { return t[r[0]] ? n(t[r[0]].total) : null; });
    return out.some(function (x) { return x == null; }) ? null : out;
  }

  // Where this government stands under SB24-174, from DOLA's Multilaw sheet and approved list as Housing-Analytics
  // copies them (data/policy/state-housing-laws.json), plus the regional table above.
  function status(geoid, laws, countyFips) {
    if (!laws || !laws.jurisdictions) return { kind: 'loading' };
    var J = laws.jurisdictions, row = J[geoid];
    var isCounty = String(geoid).length === 5;
    if (!row) return { kind: 'not-government', countyRow: countyFips ? J[countyFips] : null };
    var hna = (row.laws || {})['sb24-174-hna'] || '', hap = (row.laws || {})['sb24-174-hap'] || '';
    var required = /^required/i.test(hna);
    var approved = row.hna_approved || [];
    var regional = isCounty ? null : REGIONAL.filter(function (r) {
      return (r.names && r.names.indexOf(row.name) !== -1) || (!r.names && r.counties && r.counties.indexOf(countyFips) !== -1);
    })[0] || null;
    var group = !required ? 'exempt' : approved.length ? 'approved' : regional ? (regional.basis === 'partner' ? 'regional-partner' : 'regional-check') : 'none';
    return { kind: 'government', name: row.name, required: required, hnaRule: hna, hapRule: hap, hapRequired: /^required/i.test(hap),
      approved: approved, regional: regional, group: group, isCounty: isCounty, asOf: (laws.meta || {}).hna_approved_source ? laws.meta.hna_approved_source.as_of : null };
  }

  // DOLA Output 1: today's shortage, by tenure and income tier.
  function catchUp(profile, vac, chas) {
    var p = profile || {}, V = (vac && vac.values) || vac || {};
    var owners = n(p.DP04_0046E), renters = n(p.DP04_0047E);
    var c1 = n(p.DP04_0078E), c2 = n(p.DP04_0079E);
    var forRent = n(V.for_rent), rno = n(V.rented_not_occupied), forSale = n(V.for_sale_only), sno = n(V.sold_not_occupied);
    if (owners == null || renters == null || forRent == null || forSale == null) return null;
    var renterBase = renters + (rno || 0), ownerBase = owners + (sno || 0);
    var rentVacNow = renterBase + forRent > 0 ? forRent / (renterBase + forRent) : null;
    var ownVacNow = ownerBase + forSale > 0 ? forSale / (ownerBase + forSale) : null;
    var addRent = Math.max(0, RENT_VAC * renterBase / (1 - RENT_VAC) - forRent);
    var addOwn = Math.max(0, OWN_VAC * ownerBase / (1 - OWN_VAC) - forSale);
    var crowded = c1 == null || c2 == null ? null : c1 + c2;
    var crowdUnits = crowded == null ? 0 : crowded / 2;
    var hh = owners + renters;
    var crowdOwn = hh > 0 ? crowdUnits * owners / hh : 0, crowdRent = crowdUnits - crowdOwn;
    var oT = tierCounts(chas, 'owner'), rT = tierCounts(chas, 'renter');
    if (!oT || !rT) return null;
    var below = function (arr) { return arr.map(function (x, i) { return BELOW_MARKET.indexOf(TIERS[i][0]) !== -1 ? x : 0; }); };
    var own = spread(crowdOwn, oT).map(function (x, i) { return (x || 0) + (spread(addOwn, below(oT))[i] || 0); });
    var rent = spread(crowdRent, rT).map(function (x, i) { return (x || 0) + (spread(addRent, below(rT))[i] || 0); });
    return table(own, rent, {
      crowded: crowded, crowdUnits: crowdUnits, addRent: addRent, addOwn: addOwn,
      rentVacNow: rentVacNow, ownVacNow: ownVacNow, forRent: forRent, forSale: forSale,
      moe: vac && vac.moe ? { for_rent: n(vac.moe.for_rent), for_sale_only: n(vac.moe.for_sale_only) } : null
    });
  }

  // DOLA Output 2: the next ten years, by tenure and income tier.
  // series = cumulative units needed with the 5%/2% allowance, index 0 = base year.
  function keepUp(series, ownerShare, chas) {
    var total = series && series.length > YEARS ? n(series[YEARS]) : null;
    var os = n(ownerShare);
    if (total == null || os == null) return null;
    var o = os / (1 - OWN_VAC), r = (1 - os) / (1 - RENT_VAC);
    var ownTotal = total * o / (o + r), rentTotal = total - ownTotal;
    var oT = tierCounts(chas, 'owner'), rT = tierCounts(chas, 'renter');
    if (!oT || !rT) return null;
    // A forecast decline is not a negative number of homes to build, and it does not cancel today's shortage:
    // keep-up is zero and the decline is reported on its own.
    if (total < 0) {
      var zero = TIERS.map(function () { return 0; });
      return table(zero, zero, { total: 0, decline: Math.round(-total) });
    }
    return table(spread(ownTotal, oT), spread(rentTotal, rT), { total: total });
  }

  function table(own, rent, parts) {
    var o = roundTo(own), r = roundTo(rent);
    var rows = TIERS.map(function (t, i) { return { tier: t[0], label: t[1], dola: t[2], owner: o[i], renter: r[i], total: o[i] + r[i] }; });
    return { rows: rows, owner: sum(o), renter: sum(r), total: sum(o) + sum(r), parts: parts };
  }

  // ACS counts disability for the civilian population outside institutions (DP02_0071E). Where that base is not
  // stored, people in households (households x average size, DP02_0001E x DP02_0016E) is the closer base: total
  // population would count prisons and nursing homes, whose residents are not in the disability count.
  function accessible(profile, keep) {
    var p = profile || {}, dis = n(p.DP02_0072E), base = n(p.DP02_0071E), label = 'civilian residents outside institutions';
    if (base == null && n(p.DP02_0001E) != null && n(p.DP02_0016E) != null) { base = n(p.DP02_0001E) * n(p.DP02_0016E); label = 'people in households'; }
    if (base == null) { base = n(p.DP05_0001E); label = 'residents'; }
    if (dis == null || !base || !keep) return null;
    var share = Math.min(1, dis / base);
    return { share: share, units: Math.round(share * keep.total), disabled: dis, population: base, base: label };
  }

  // DOLA's six required outputs, the recommendation duty, the two recommended outputs and the ten baseline
  // components, each with what the HNA's files can show. state: met | town | missing.
  function checklist(o) {
    var need = o.catchUp && o.keepUp;
    return [
      ['I', 'Existing housing stock', 'met', 'Homes by type, age, size and tenure (ACS).', 'housing'],
      ['II', 'Need by income level and type: for-sale and rental', need ? 'met' : 'missing', need ? 'Tables 1 and 2 below, by tenure and income tier.' : 'The files for this place are too thin to build the tables; see the county.', 'dola'],
      ['II', 'Need: accessible and visitable homes', o.accessible ? 'met' : 'missing', o.accessible ? 'Table 4 below, from the share of residents with a disability.' : 'No disability count in the ACS profile here.', 'dola'],
      ['II', 'Need: supportive homes', 'town', 'No public count of homelessness exists below the Continuum of Care. The town supplies its Point-in-Time share, beds and waitlists.', null],
      ['III', 'Number of households', 'met', 'Households by size, type, income and tenure (ACS).', 'people'],
      ['IV', 'Jobs by annual wage', 'met', 'Jobs in three pay bands and by industry (LEHD LODES).', 'future'],
      ['V', 'Share of state and regional need, from jobs', o.status && o.status.regional ? 'town' : 'met',
        o.status && o.status.regional ? 'This government is inside the ' + o.status.regional.title + '; its allocation comes from that study.' : 'Table 3 shows the local study area. In-commuters are counted in the 20-year figure; the statewide HNA is not due until 30 November 2027.', 'future'],
      ['VI', 'Areas at elevated risk of displacement', 'missing', 'Not built yet. DOLA’s tract-level displacement indicators and guidance set out the method.', null],
      ['Rec.', 'Recommended policy and program responses', 'met', 'What to do about it: an action plan checklist, Prop 123 status and local support.', 'action'],
      ['VII', 'Water supply needs (recommended)', 'town', 'Needs the utility’s gallons per person per day.', null],
      ['VIII', 'Market limits on building (recommended)', 'met', 'Income needed to buy or rent the typical home, building-type fit and costs.', 'afford'],
      ['(g)', 'Local resources for affordable housing', 'town', 'Local funds, fee relief and land on file; the town confirms them.', 'action'],
      ['(h)', 'Vacancy rates', 'met', 'Rental and owner vacancy without seasonal homes (ACS B25004), in Table 1.', 'dola'],
      ['(i)', 'Homelessness and housing instability', 'town', 'Same as supportive homes.', null]
    ];
  }

  // The chapter. o: { geoid, name, isCounty, countyFips, countyName, profile, vac, chas, series, ownerShare,
  //   tooSmall, laws, baseYear, acsLabel, population }
  function chapter(o) {
    var st = status(o.geoid, o.laws, o.countyFips);
    var cu = o.tooSmall ? null : catchUp(o.profile, o.vac, o.chas);
    var ku = o.tooSmall ? null : keepUp(o.series, o.ownerShare, o.chas);
    var ac = accessible(o.profile, ku);
    var base = n(o.baseYear) || 2024, end = base + YEARS;
    var short = String(o.name || '').replace(/ \((city|town|CDP|city and county)\)$/i, '');
    var h = '';

    // 1. Where this government stands.
    h += '<section class="dola-status" aria-labelledby="dola-st-h"><h2 id="dola-st-h">Where ' + esc(short) + ' stands</h2>' + statusHtml(st, short, o) + '</section>';

    if (o.loading) {
      return h + '<p class="note">Reading the HNA\u2019s forecast, CHAS and vacancy files\u2026</p><p class="metric-source">Sources: <a href="' + SRC.act + '" rel="noopener">SB24-174, signed act</a>; <a href="' + SRC.guide + '" rel="noopener">DOLA, Housing Needs Assessment Guide for Colorado Communities</a>, December 2024.</p>';
    }
    // 2. The need, as one finding and one picture.
    if (cu && ku) {
      var tot = cu.total + ku.total;
      h += '<section class="dola-need" aria-labelledby="dola-need-h"><h2 id="dola-need-h">Homes needed, DOLA’s way</h2>' +
        '<p class="chapter-finding" data-role="dola-finding">' + esc(short) + ' needs about ' + fmt(tot) + ' homes by ' + end + ': ' + fmt(cu.total) +
        (ku.parts.decline ? ' to ease today’s shortage and none to keep up with growth. The State Demography Office forecast, with DOLA’s vacancy allowance, falls by about ' + fmt(ku.parts.decline) + ' homes by ' + end + ', and a falling forecast does not ease today’s shortage.</p>'
          : ' to ease today’s shortage and ' + fmt(ku.total) + ' to keep up with growth.</p>') + bars(cu, ku) +
        '<p class="note">' + esc(belowLine(cu, ku)) + '</p></section>';
      h += '<div class="dola-tables">' + dolaTable('Table 1 · Existing shortage (catch-up)', cu, 'Catch-up') +
        dolaTable('Table 2 · Next ' + YEARS + ' years, ' + base + '–' + end + ' (keep-up)', ku, 'Keep-up') + '</div>';
      h += '<p class="metric-source">Table 1: one home per two homes with more than one person per room (ACS DP04), ' +
        'plus rentals to bring vacancy to 5% (now ' + pctTxt(cu.parts.rentVacNow) + ', ' + fmt(cu.parts.forRent) + ' for rent' + moeTxt(cu.parts.moe && cu.parts.moe.for_rent) + ') and homes to bring owner vacancy to 2% (now ' + pctTxt(cu.parts.ownVacNow) + ', ' + fmt(cu.parts.forSale) + ' for sale' + moeTxt(cu.parts.moe && cu.parts.moe.for_sale_only) + '), seasonal homes left out ' +
        '(<a href="' + SRC.b25004 + '" rel="noopener">ACS B25004</a>; DOLA guide pp. 43–44). Crowding is split by tenure share of households, an assumption. ' +
        'Table 2: <a href="' + SRC.sdo + '" rel="noopener">State Demography Office</a> household forecast with a 5% rental and 2% owner allowance (guide p. 45)' +
        (o.isCounty ? '' : ', ' + esc(short) + '’s share as the HNA sets it (households and permits, blended)') + '. Income tiers: <a href="' + SRC.chas + '" rel="noopener">HUD CHAS 2018–2022</a>; CHAS stops at “over 100% AMI”, so DOLA’s 81–120% and 120%+ rows are shown as 81–100% and over 100%.</p>';
      h += allocationTable(cu, ku, short, st);
      h += '<section class="dola-t4" aria-labelledby="dola-t4-h"><h2 id="dola-t4-h">Table 4 · Supportive, accessible and visitable homes</h2><div class="dola-two">' +
        '<div class="dola-card"><h3>Accessible and visitable</h3>' + (ac && ku.parts.decline ? '<p class="dola-big">None needed for growth</p><p>The forecast shows no growth here, so no new homes are counted. ' + (ac.share * 100).toFixed(1) + '% of ' + ac.base + ' have a disability (' + esc(o.acsLabel || 'ACS') + ', DP02); DOLA’s guide applies that share to new homes (p. 52).</p>'
          : ac ? '<p class="dola-big">About ' + fmt(ac.units) + ' of the ' + fmt(ku.total) + ' new homes</p><p>' +
          (ac.share * 100).toFixed(1) + '% of ' + ac.base + ' have a disability (' + esc(o.acsLabel || 'ACS') + ', DP02), applied to the ' + YEARS + '-year need, as DOLA’s guide suggests (p. 52). A share of the ' + fmt(ku.total) + ', not added to it.</p>'
          : '<p>No disability count in the ACS profile here.</p>') + '</div>' +
        '<div class="dola-card dola-input"><h3>Supportive</h3><p><strong>Town input needed.</strong> No public count of homelessness exists for a single town or county; HUD’s Point-in-Time count is by Continuum of Care. DOLA counts supportive homes on top of Table 3, not inside it.</p>' +
        '<a class="button-link" href="' + MEMBER + 'developer-hna-input.html?geoid=' + esc(o.geoid) + '">Add town input (members)</a></div></div></section>';
    } else {
      h += '<section class="dola-need"><h2>Homes needed, DOLA’s way</h2><p class="callout">' + (o.tooSmall
        ? esc(short) + ' has fewer than 250 households in the Census survey, too few for a town forecast. DOLA’s tables are on <a href="#/place/' + esc(o.countyFips) + '/dola">' + esc(o.countyName || 'the county') + '’s page</a>; the town’s own HNA would need local counts.'
        : 'The HNA’s files for this place do not hold every count the tables need (tenure, vacancy by status, or income tiers), so they are not drawn. Nothing is filled in by guess.') + '</p></section>';
    }

    // 3. DOLA's checklist, with what is met by data and what waits on the town.
    var rows = checklist({ catchUp: cu, keepUp: ku, accessible: ac, status: st });
    var WORD = { met: 'Met by data', town: 'Town input needed', missing: 'Not built yet' };
    var count = { met: 0, town: 0, missing: 0 };
    rows.forEach(function (r) { count[r[2]]++; });
    h += '<section class="dola-check" aria-labelledby="dola-ck-h"><h2 id="dola-ck-h">DOLA checklist</h2>' +
      '<p>' + count.met + ' items are met by the HNA’s data, ' + count.town + ' need the town’s own figures and ' + count.missing + ' are not built yet. This is a data start for an SB24-174 assessment, not a DOLA-approved one: only DOLA accepts an assessment.</p>' +
      '<div class="table-scroll" role="region" aria-label="DOLA checklist" tabindex="0"><table class="sb174-table"><thead><tr><th scope="col">Item</th><th scope="col">What the law or guide asks</th><th scope="col">Status</th><th scope="col">Where</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var cls = r[2] === 'met' ? 'sb174-yes' : r[2] === 'town' ? 'sb174-part' : 'sb174-no';
        var where = r[4] && r[4] !== 'dola' ? ' <a href="#/place/' + esc(o.geoid) + (r[4] === 'overview' ? '' : '/' + r[4]) + '">Open</a>' : r[4] === 'dola' ? ' Above' : '';
        return '<tr><td>' + esc(r[0]) + '</td><th scope="row">' + esc(r[1]) + '</th><td><span class="' + cls + '">' + WORD[r[2]] + '</span></td><td>' + esc(r[3]) + where + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="note">Items I to VI and the recommendations are what DOLA checks before it accepts an assessment (C.R.S. 24-32-3703(3)); VII and VIII are recommended (guide p. 7); (g), (h) and (i) are three of the ten baseline components it must show it considered (24-32-3702(2)). The rest of the ten are met across the chapters. Order follows DOLA’s <a href="' + SRC.selfCheck + '" rel="noopener">self-assessment checklist</a>.</p>' +
      '<div class="actions"><a class="button-link" href="' + MEMBER + 'developer-hna-input.html?geoid=' + esc(o.geoid) + '">Add town input (members)</a> ' +
      '<a class="button-link" href="' + MEMBER + 'developer-hap-survey.html?geoid=' + esc(o.geoid) + '">Choose action plan strategies (members)</a></div></section>';

    h += '<p class="metric-source">Sources: <a href="' + SRC.act + '" rel="noopener">SB24-174, signed act</a> (C.R.S. 24-32-3702 to 3705); <a href="' + SRC.guide + '" rel="noopener">DOLA, Housing Needs Assessment Guide for Colorado Communities</a>, December 2024; ' +
      '<a href="' + SRC.plans + '" rel="noopener">DOLA, Housing Plans</a>; <a href="' + SRC.approved + '" rel="noopener">DOLA approved HNA list</a> and <a href="' + SRC.multilaw + '" rel="noopener">Multilaw applicability sheet</a>' + (st.asOf ? ' (copied ' + esc(longDate(st.asOf)) + ')' : '') + '. Regional coverage read ' + longDate(AS_OF) + '.</p>';
    return h;
  }

  function lawLine(isCounty, hap) {
    return '<p>The law: each county and town of 1,000 or more residents must “conduct and publish” an assessment by ' + DEADLINE + ' (C.R.S. 24-32-3703(1)(a)), consider it at a public meeting, and send it to DOLA with the governing body’s comments within 60 days (24-32-3703(3)). DOLA’s page asks for it to be submitted by the same date. ' +
      (isCounty ? 'A county’s assessment covers its unincorporated area (24-32-3703(5)(b)); the tables below are the whole county. ' : '') + 'Updates are due at least every six years.' + (hap || '') + '</p>';

  }

  function pctTxt(x) { return x == null ? 'not published' : (x * 100).toFixed(1).replace(/\.0$/, '') + '%'; }
  function moeTxt(m) { return m == null ? '' : ' ±' + fmt(m); }

  function belowLine(cu, ku) {
    var b = function (t) { return sum(t.rows.filter(function (r) { return BELOW_MARKET.indexOf(r.tier) !== -1; }).map(function (r) { return r.total; })); };
    var cb = b(cu), kb = b(ku);
    return (cu.total ? Math.round(cb / cu.total * 100) + '% of today’s shortage' : 'None of today’s shortage') + ' and ' +
      (ku.total ? Math.round(kb / ku.total * 100) + '% of the next ' + YEARS + ' years’ need' : 'none of the growth need') + ' is at or below 80% of area income.';
  }

  function bars(cu, ku) {
    var max = Math.max.apply(null, TIERS.map(function (t, i) { return cu.rows[i].total + ku.rows[i].total; })) || 1;
    return '<figure class="dola-bars" aria-label="Homes needed by income tier: today’s shortage and the next ' + YEARS + ' years">' +
      '<ul class="dola-key" aria-hidden="true"><li><i class="dola-cu"></i>Today’s shortage</li><li><i class="dola-ku"></i>Next ' + YEARS + ' years</li></ul>' +
      TIERS.map(function (t, i) {
        var a = cu.rows[i].total, b = ku.rows[i].total;
        return '<div class="dola-row"><span class="dola-lab">' + esc(t[1]) + '</span><span class="dola-track"><span class="dola-cu" style="width:' + (a / max * 100).toFixed(1) + '%"></span><span class="dola-ku" style="width:' + (b / max * 100).toFixed(1) + '%"></span></span><b>' + fmt(a + b) + '</b></div>';
      }).join('') + '</figure>';
  }

  function dolaTable(title, t, totalWord) {
    return '<section class="dola-table"><h3>' + esc(title) + '</h3><div class="table-scroll" role="region" aria-label="' + esc(title) + '" tabindex="0"><table class="dola-num">' +
      '<thead><tr><th scope="col">Income</th><th scope="col">Owner</th><th scope="col">Renter</th><th scope="col">Total</th></tr></thead><tbody>' +
      t.rows.map(function (r) { return '<tr><th scope="row">' + esc(r.label) + '<br><span class="note">' + esc(r.dola) + '</span></th><td class="n">' + fmt(r.owner) + '</td><td class="n">' + fmt(r.renter) + '</td><td class="n">' + fmt(r.total) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><th scope="row">' + esc(totalWord) + '</th><td class="n">' + fmt(t.owner) + '</td><td class="n">' + fmt(t.renter) + '</td><td class="n">' + fmt(t.total) + '</td></tr></tfoot></table></div></section>';
  }

  // DOLA Output 3 for a local HNA: the local study area's existing plus projected need, rentals then ownership.
  function allocationTable(cu, ku, short, st) {
    var line = function (label, a, b) { return '<tr><th scope="row">' + esc(label) + '</th><td class="n">' + fmt(a) + '</td><td class="n">' + fmt(b) + '</td><td class="n">' + fmt(a + b) + '</td></tr>'; };
    var block = function (word, key) {
      return '<tr class="dola-sub"><th scope="rowgroup" colspan="4">' + word + '</th></tr>' + TIERS.map(function (t, i) { return line(t[1], cu.rows[i][key], ku.rows[i][key]); }).join('');
    };
    return '<section class="dola-table" aria-labelledby="dola-t3-h"><h2 id="dola-t3-h">Table 3 · ' + esc(short) + '’s total, existing plus next ' + YEARS + ' years</h2>' +
      '<div class="table-scroll" role="region" aria-label="Table 3" tabindex="0"><table class="dola-num"><thead><tr><th scope="col">Income</th><th scope="col">Existing</th><th scope="col">Projected</th><th scope="col">Total</th></tr></thead><tbody>' +
      block('Rentals', 'renter') + block('Ownership', 'owner') + '</tbody><tfoot>' + line('All homes', cu.total, ku.total) + '</tfoot></table></div>' +
      '<p class="note">A local HNA shows its own study area here (DOLA guide p. 49).' + (st && st.regional ? ' ' + esc(short) + ' is inside the ' + esc(st.regional.title) + ', which allocates regional need by jobs; that allocation, not this table, is the one DOLA reads for a member that took part.' : '') + '</p></section>';
  }

  function statusHtml(st, short, o) {
    var hapLine = function () {
      return st.hapRequired ? ' A housing action plan follows by <strong>1 January 2028</strong> (C.R.S. 24-32-3705).' : st.hapRule ? ' DOLA lists the housing action plan as “' + esc(st.hapRule) + '”.' : '';
    };
    if (st.kind === 'loading') return '<p class="note">Reading DOLA\u2019s lists\u2026</p>' + lawLine(false);
    if (st.kind === 'not-government') {
      return '<p>' + esc(short) + ' is not a town government, so SB24-174’s assessment is ' + esc(o.countyName || 'the county') + '’s to do (a county’s covers its unincorporated area, C.R.S. 24-32-3703(5)(b)). <a href="#/place/' + esc(o.countyFips) + '/dola">The county’s SB24-174 view</a>.</p>';
    }
    var lead;
    if (!st.required) lead = '<p class="dola-flag dola-ok">DOLA lists ' + esc(st.name) + ' as <strong>' + esc(st.hnaRule) + '</strong> for SB24-174’s housing needs assessment, so it does not have to publish one by ' + DEADLINE + '.</p>';
    else if (st.group === 'approved') lead = '<p class="dola-flag dola-ok">Done for this cycle. DOLA approved ' + st.approved.map(function (a) { return '<a href="' + esc(a.url) + '" rel="noopener">' + esc(a.title) + '</a> on ' + esc(longDate(a.date)); }).join('; ') + '.</p>';
    else if (st.group === 'regional-partner') lead = '<p class="dola-flag dola-ok">Covered by the <a href="' + esc(st.regional.url) + '" rel="noopener">' + esc(st.regional.title) + '</a>, approved by DOLA on ' + esc(longDate(st.regional.approved)) + ', which names ' + esc(st.name) + ' as a partner.</p>';
    else if (st.group === 'regional-check') lead = '<p class="dola-flag dola-maybe">Likely covered, but check. ' + esc(st.name) + ' is in the area of the <a href="' + esc(st.regional.url) + '" rel="noopener">' + esc(st.regional.title) + '</a> (approved by DOLA ' + esc(longDate(st.regional.approved)) + '; ' + esc(st.regional.who) + '). It is exempt from its own assessment only if its governing body reviewed the regional one at a public meeting and sent comments (C.R.S. 24-32-3703(4)(a), 24-32-3704(2)).</p>';
    else lead = '<p class="dola-flag dola-due"><strong>Needs an assessment by ' + DEADLINE + '.</strong> DOLA lists ' + esc(st.name) + ' as “' + esc(st.hnaRule) + '” and its approved list has no assessment for it' + (st.asOf ? ' (copied ' + esc(longDate(st.asOf)) + ')' : '') + '. A study under DOLA review would not show here yet.</p>';
    return lead + lawLine(st.isCounty, hapLine());
  }

  var api = { AS_OF: AS_OF, TIERS: TIERS, REGIONAL: REGIONAL, status: status, catchUp: catchUp, keepUp: keepUp, accessible: accessible, checklist: checklist, chapter: chapter, roundTo: roundTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LabHnaDola = api;
})(typeof window !== 'undefined' ? window : this);
