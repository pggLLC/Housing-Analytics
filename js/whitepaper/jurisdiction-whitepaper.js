/**
 * jurisdiction-whitepaper.js — one shareable jurisdiction report (the white paper) per Colorado jurisdiction,
 * built from what the repo already holds about it.
 *
 * buildModel(sources, geoid, opts) gathers the facts; renderHtml(model) writes a
 * self-contained, printable HTML document. Both are pure: the gated page
 * (developer-whitepaper.html) fetches the sources in the browser, and
 * scripts/whitepaper/build-whitepaper.mjs reads them from disk, so the two print the
 * same document.
 *
 * Rules this module keeps:
 *  - An unmeasured value is null and renders as "Not available", never 0
 *    (AGENTS.md, "An unmeasurable quantity is null").
 *  - Every section names the file and vintage it came from.
 *  - The "ideal deal" is a shape (credit route, income mix, rent check, basis
 *    boost), not a pro forma: dollar sizing belongs to the Deal Calculator engine.
 *  - Contacts appear only from a researched contacts file that quotes its source;
 *    search-engine links are never shown as contacts.
 *
 * Exposed as window.JurisdictionWhitepaper and module.exports.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JurisdictionWhitepaper = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Files the white paper reads, keyed by the name buildModel expects. Optional
  // ones may be missing; the section then says so.
  var SOURCE_FILES = {
    rankingIndex: 'data/hna/ranking-index.json',
    placeChas: 'data/hna/place-chas.json',
    countyChas: 'data/market/chas_co.json',
    chfaLihtc: 'data/chfa-lihtc.json',
    awards: 'data/policy/funding-awards/ledger.json',
    applications: { path: 'data/jurisdiction-briefs/_lihtc-applications.json', optional: true },
    prop123: 'data/policy/prop123_jurisdictions.json',
    landBanking: { path: 'data/policy/prop123-land-banking-awards.json', optional: true },
    landBankingContacts: { path: 'data/jurisdiction-briefs/_land-banking-contacts.json', optional: true },
    localFunds: 'data/policy/local-housing-funds.json',
    feeReductions: 'data/policy/fee-reductions.json',
    localSupport: 'data/policy/local-support.json',
    rentLimits: 'data/chfa-income-rent-limits-2026.json',
    fmr: 'data/hud-fmr-income-limits.json',
    fundingGuide: 'data/policy/co-developer-funding-guide.json',
    qapCalendar: 'data/chfa-qap-calendar.json',
    resortPrograms: { path: 'data/resort-workforce-housing-programs.json', optional: true },
    stewardship: { path: 'data/policy/stewardship-providers.json', optional: true },
    assumptions: { path: 'data/policy/lihtc-assumptions.json', optional: true },
    equityPricing: { path: 'data/market/novogradac-equity-pricing.json', optional: true },
    pab: { path: 'data/policy/pab-allocations.json', optional: true },
    zori: { path: 'data/market/zori_rents_co.json', optional: true },
    apartmentList: { path: 'data/market/apartment_list_co.json', optional: true },
    acsRent: { path: 'data/market/acs_median_rent_co.json', optional: true },
    properties: { path: 'data/affordable-housing/properties.json', optional: true },
    scorecard: { path: 'data/policy/housing-policy-scorecard.json', optional: true },
    progress: { path: 'data/policy/jurisdiction-housing-progress.json', optional: true },
    underwritingRules: { path: 'data/policy/lihtc-underwriting-rules.json', optional: true },
    qapScoring: { path: 'data/policy/chfa-2027-r1-scoring.json', optional: true },
    // Who works here and who drives in (public), the largest employers (public), and who to
    // call at them and at local housing partners (private: served by the gated site only).
    commute: { path: 'data/market/commute-strength.json', optional: true },
    // Where a town's working residents work, with residents who work in another state in the total.
    jobAccess: { path: 'data/policy/job-access.json', optional: true },
    employers: { path: 'data/market/principal-employers.json', optional: true },
    employerContacts: { path: 'data/jurisdiction-briefs/_employer-contacts.json', optional: true },
    // The private question bank: served by the gated site only (coho-backend gated/).
    townQuestions: { path: 'data/jurisdiction-briefs/_town-questions.json', optional: true }
  };

  function sourcePath(key) {
    var s = SOURCE_FILES[key];
    return typeof s === 'string' ? s : s.path;
  }
  function isOptional(key) {
    var s = SOURCE_FILES[key];
    return typeof s === 'object' && !!s.optional;
  }
  // Per-jurisdiction files, also optional.
  function briefPath(geoid) { return 'data/jurisdiction-briefs/' + geoid + '.json'; }
  function contactsPath(geoid) { return 'data/jurisdiction-briefs/_contacts/' + geoid + '.json'; }
  // Researched local landscape (agencies, plans, task forces, people, land, pipeline).
  // A place without its own file falls back to its county's.
  function landscapePath(geoid) { return 'data/jurisdiction-briefs/_landscape/' + geoid + '.json'; }
  // Where researched contacts and landscape can stand in when a place has none of its
  // own: a town falls back to its county, a county to the towns inside it.
  function relatedGeoids(src, geoid) {
    var rows = (src && src.rankingIndex && src.rankingIndex.rankings) || [];
    var row = rows.find(function (r) { return r.geoid === geoid; });
    if (!row) return [];
    if (row.type !== 'county') return row.containingCounty ? [row.containingCounty] : [];
    return rows.filter(function (r) { return r.type !== 'county' && r.containingCounty === geoid; }).map(function (r) { return r.geoid; });
  }
  // ACS profile for the place or county (demographics and housing stock).
  function summaryPath(geoid) { return 'data/hna/summary/' + geoid + '.json'; }

  // ---------------------------------------------------------------- helpers

  function num(v) {
    // null, undefined, '' and non-numbers are absent; a real 0 stays 0.
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var NA = 'Not available';
  function fmtInt(v) {
    var n = num(v);
    return n === null ? NA : Math.round(n).toLocaleString('en-US');
  }
  function fmtMoney(v) {
    var n = num(v);
    return n === null || n <= 0 ? NA : '$' + Math.round(n).toLocaleString('en-US');
  }
  function signedMoney(v) {
    var n = num(v);
    return n === null ? NA : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function fmtPct(v, digits) {
    var n = num(v);
    return n === null ? NA : n.toFixed(digits == null ? 1 : digits) + '%';
  }
  function share(v) { var n = num(v); return n === null ? null : n * 100; }
  function plainName(name) { return String(name || '').replace(/\s*\((city|town|CDP|city and county)\)\s*$/i, '').trim(); }
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/^(city|town|county) of /, '').replace(/ (city|town|county)$/, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function safeHref(u) {
    // Only http(s) links reach the document.
    return /^https?:\/\//i.test(String(u || '')) ? String(u) : null;
  }
  // The owner's own project stays out of every list this module prints.
  var EXCLUDED_PROJECT = /fruita\s+mews\s+(phase\s+)?(ii|2)\b/i;
  function excluded(rec) { return EXCLUDED_PROJECT.test(String((rec && (rec.name || rec.PROJECT)) || '')); }
  function isSearchLink(u) { return /google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com/i.test(String(u || '')); }

  // ---------------------------------------------------------------- model

  function findRanking(ri, geoid) {
    var rows = (ri && ri.rankings) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].geoid === geoid) return rows[i];
    return null;
  }

  function findByName(ri, query) {
    var q = norm(query);
    var rows = (ri && ri.rankings) || [];
    var exact = rows.filter(function (r) { return norm(plainName(r.name)) === q || norm(r.name) === q; });
    if (exact.length) {
      // "Gunnison" names both the city and the county; prefer the place unless "county" was typed.
      if (/county/i.test(query)) return exact.find(function (r) { return r.type === 'county'; }) || exact[0];
      return exact.find(function (r) { return r.type !== 'county'; }) || exact[0];
    }
    return rows.find(function (r) { return norm(r.name).indexOf(q) === 0; }) || null;
  }

  function gapsMeasured(m) {
    var zeros = num(m.ami_gap_30pct) === 0 && num(m.ami_gap_50pct) === 0 && num(m.ami_gap_60pct) === 0;
    return !(zeros && num(m.pct_burdened_lte30) === null);
  }
  function gapsKnown(n) { return n.gap30 !== null && n.gap50 !== null && n.gap60 !== null; }

  function needSection(row, src) {
    var m = (row && row.metrics) || {};
    var chas = null, chasSource = null;
    if (row.type === 'county') {
      var rec = ((src.countyChas && src.countyChas.records) || []).find(function (r) { return r.fips === row.geoid; });
      if (rec) { chas = rec; chasSource = sourcePath('countyChas') + ' (HUD CHAS, county)'; }
    } else {
      var p = src.placeChas && src.placeChas.places && src.placeChas.places[row.geoid];
      if (p && !p.low_confidence) { chas = p; chasSource = sourcePath('placeChas') + ' (HUD CHAS apportioned to the place)'; }
    }
    var bands = [];
    var LABELS = { lte30: '30% AMI or less', '31to50': '31–50% AMI', '51to80': '51–80% AMI', '81to100': '81–100% AMI', '100plus': 'Over 100% AMI' };
    if (chas && chas.renter_hh_by_ami) {
      Object.keys(LABELS).forEach(function (k) {
        var b = chas.renter_hh_by_ami[k];
        if (!b) return;
        bands.push({
          key: k, label: LABELS[k],
          households: num(b.total),
          burdenedPct: share(b.pct_cost_burdened_30),
          severePct: share(b.pct_cost_burdened_50)
        });
      });
    }
    return {
      population: num(m.population),
      medianIncome: num(m.median_hh_income),
      medianRent: num(m.gross_rent_median),
      medianHomeValue: num(m.median_home_value),
      renterSharePct: num(m.pct_renters),
      vacancyPct: num(m.active_market_vacancy_rate_pct),
      costBurdenedPct: num(m.pct_cost_burdened),
      severeBurdenedPct: num(m.pct_renter_severe_burdened),
      // Each is cumulative: renter households at or below the threshold minus rental
      // homes priced for them (scripts/hna/build_place_ami_gap.py), floored at 0.
      // They are not bands and do not add: cheaper homes count toward every
      // higher threshold, so the 60% figure can be lower than the 30% one.
      // Its no-data fallback writes 0 to all three with no band burden, which is unknown, not zero.
      gap30: gapsMeasured(m) ? num(m.ami_gap_30pct) : null,
      gap50: gapsMeasured(m) ? num(m.ami_gap_50pct) : null,
      gap60: gapsMeasured(m) ? num(m.ami_gap_60pct) : null,
      lowWageJobs: num(m.local_low_wage_jobs),
      inCommuters: num(m.in_commuters),
      need20yr: num(m.future_units_needed_20yr),
      seniorGrowthPp: num(m.senior_share_growth_pp),
      seasonalSharePct: num(m.seasonal_share_of_vacant),
      overallNeedScore: num(m.overall_need_score),
      percentileRank: num(row.percentileRank),
      rank: num(row.rank),
      // How the score is built, in the builder's own words (scripts/hna/build_ranking_index.py
      // writes it beside the data), so the explanation cannot drift from the weights.
      scoreMethod: ((((src.rankingIndex || {}).metrics) || []).find(function (x) { return x.id === 'overall_need_score'; }) || {}).description || null,
      ranked: ((src.rankingIndex && src.rankingIndex.rankings) || []).length || null,
      qctSharePct: num(m.qct_share_pct),
      ddaSharePct: num(m.dda_share_pct),
      bands: bands,
      chasSource: chasSource,
      rankingSource: sourcePath('rankingIndex') + ' (generated ' + ((src.rankingIndex.metadata || {}).generatedAt || 'date not recorded') + ')'
    };
  }

  // Who lives here and what housing exists, from the ACS profile the HNA pages use
  // (data/hna/summary/<geoid>.json). Variable codes follow js/hna/hna-renderers.js.
  // Every share needs both its count and its denominator; otherwise it is null.
  function ratio(part, whole) {
    var a = num(part), b = num(whole);
    return a === null || b === null || b <= 0 ? null : a / b * 100;
  }
  function bins(p, list, total) {
    var rows = list.map(function (b) { return { label: b[0], count: num(p[b[1]]) }; });
    if (rows.every(function (r) { return r.count === null; })) return null;
    // Shares are of the bins' own total when every bin is published: ACS tables have
    // different universes (Hayden's income bins sum to 837 households, DP02 says 779).
    if (rows.every(function (r) { return r.count !== null; })) total = rows.reduce(function (s, r) { return s + r.count; }, 0);
    return rows.map(function (r) { return { label: r.label, count: r.count, pct: ratio(r.count, total) }; });
  }
  var INCOME_BINS = [['Under $10,000', 'DP03_0052E'], ['$10,000–14,999', 'DP03_0053E'], ['$15,000–24,999', 'DP03_0054E'], ['$25,000–34,999', 'DP03_0055E'], ['$35,000–49,999', 'DP03_0056E'],
    ['$50,000–74,999', 'DP03_0057E'], ['$75,000–99,999', 'DP03_0058E'], ['$100,000–149,999', 'DP03_0059E'], ['$150,000–199,999', 'DP03_0060E'], ['$200,000 or more', 'DP03_0061E']];
  var STRUCTURE_BINS = [['Single-family detached', 'DP04_0007E'], ['Single-family attached', 'DP04_0008E'], ['2 units', 'DP04_0009E'], ['3 or 4 units', 'DP04_0010E'],
    ['5 to 9 units', 'DP04_0011E'], ['10 to 19 units', 'DP04_0012E'], ['20 or more units', 'DP04_0013E'], ['Mobile home', 'DP04_0014E']];
  var BUILT_BINS = [['2020 or later', 'DP04_0017E'], ['2010–2019', 'DP04_0018E'], ['2000–2009', 'DP04_0019E'], ['1990–1999', 'DP04_0020E'], ['1980–1989', 'DP04_0021E'],
    ['1970–1979', 'DP04_0022E'], ['1960–1969', 'DP04_0023E'], ['1950–1959', 'DP04_0024E'], ['1940–1949', 'DP04_0025E'], ['1939 or earlier', 'DP04_0026E']];
  var BEDROOM_BINS = [['Studio', 'DP04_0039E'], ['1 bedroom', 'DP04_0040E'], ['2 bedrooms', 'DP04_0041E'], ['3 bedrooms', 'DP04_0042E'], ['4 bedrooms', 'DP04_0043E'], ['5 or more', 'DP04_0044E']];
  var RENT_SHARE_BINS = [['Under 15%', 'DP04_0137PE'], ['15–19.9%', 'DP04_0138PE'], ['20–24.9%', 'DP04_0139PE'], ['25–29.9%', 'DP04_0140PE'], ['30–34.9%', 'DP04_0141PE'], ['35% or more', 'DP04_0142PE']];

  function homeValueOf(p) {
    var c = p.median_home_value;
    if (c && typeof c === 'object' && num(c.value) !== null && num(c.value) > 0) {
      return { value: num(c.value), label: c.source === 'zhvi' ? 'Zillow home value index' + (c.as_of ? ', ' + c.as_of : '') : 'Census ACS estimate' };
    }
    var a = num(p.DP04_0089E);
    return a !== null && a > 0 ? { value: a, label: 'Census ACS estimate' } : null;
  }

  function communitySection(summary, geoid) {
    if (!summary || !summary.acsProfile || !summary.geo || summary.geo.geoid !== geoid) return null;
    var p = summary.acsProfile;
    var pop = num(p.DP05_0001E), hh = num(p.DP02_0001E), units = num(p.DP04_0001E);
    var over65 = num(p.DP05_0024E) !== null ? num(p.DP05_0024E) : num(p.DP05_0029E);
    var lf = num(p.DP03_0002E), unemp = num(p.DP03_0005E);
    var c = summary.acsB08301 || {};
    var series = p._acsSeries === 'acs1' ? '1-year' : '5-year';
    var year = num(p._acsYear);
    return {
      vintage: year === null ? 'vintage not recorded' : 'ACS ' + (series === '5-year' ? (year - 4) + '–' + year : year) + ' ' + series,
      people: {
        population: pop,
        households: hh,
        householdSize: num(p.DP02_0016E),
        under18Pct: ratio(p.DP05_0019E, pop),
        over65Pct: ratio(over65, pop),
        withChildrenPct: ratio(p.DP02_0014E, hh),
        withSeniorPct: ratio(p.DP02_0015E, hh),
        hispanicPct: ratio(p.DP05_0090E, p.DP05_0033E),
        nhWhitePct: ratio(p.DP05_0096E, p.DP05_0033E),
        medianIncome: num(p.DP03_0062E),
        laborForce: lf,
        unemploymentPct: ratio(unemp, lf),
        workFromHomePct: ratio(c.work_from_home, c.total),
        transitWalkBikePct: num(c.total) > 0 && [c.transit, c.walk, c.bike].every(function (v) { return num(v) !== null; })
          ? ratio(num(c.transit) + num(c.walk) + num(c.bike), c.total) : null,
        income: bins(p, INCOME_BINS, hh)
      },
      stock: {
        units: units,
        occupied: num(p.DP04_0002E),
        vacant: num(p.DP04_0003E),
        vacantPct: ratio(p.DP04_0003E, units),
        // DP04_0005E is published as a rate already; it is not a count.
        rentalVacancyPct: num(p.DP04_0005E),
        ownerPct: num(p.DP04_0046PE),
        renterPct: num(p.DP04_0047PE),
        medianRent: num(p.DP04_0134E),
        // The site's home value is the cascade the ranking index uses (Zillow where
        // published, else ACS), so this section agrees with every other page.
        homeValue: homeValueOf(p),
        acsHomeValue: num(p.DP04_0089E),
        structure: bins(p, STRUCTURE_BINS, units),
        built: bins(p, BUILT_BINS, units),
        bedrooms: bins(p, BEDROOM_BINS, units),
        rentShare: RENT_SHARE_BINS.every(function (b) { return num(p[b[1]]) === null; }) ? null
          : RENT_SHARE_BINS.map(function (b) { return { label: b[0], pct: num(p[b[1]]) }; })
      },
      source: summaryPath(geoid) + ' (Census ACS data profile DP02–DP05 and B08301, refreshed ' + (summary.updated || 'date not recorded') + ')'
    };
  }

  // Market rent from each source the site holds, side by side with HUD's fair market rent.
  function marketRents(row, src) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var out = [];
    var acs = src.acsRent && (row.type === 'county' ? (src.acsRent.counties || {})[row.geoid] : (src.acsRent.places || {})[row.geoid]);
    if (acs && num(acs.median_gross_rent) !== null) {
      out.push({ source: 'Census ACS median gross rent (B25064)', scope: acs.name || row.name, all: num(acs.median_gross_rent), asOf: ((src.acsRent.meta || {}).vintage) || null });
    }
    var z = src.zori && (src.zori.counties || {})[county];
    if (z && num(z.rent) !== null) {
      out.push({ source: 'Zillow observed rent index (ZORI)', scope: z.name, all: num(z.rent), yoy: num(z.yoy_change_pct), asOf: z.vintage_month || null });
    }
    if (row.type !== 'county' && src.apartmentList) {
      var key = norm(plainName(row.name));
      var al = (src.apartmentList.cities || {})[key];
      if (al && norm(al.name) === key && num(al.rent_overall) !== null) {
        out.push({ source: 'Apartment List rent report', scope: al.name, all: num(al.rent_overall), br1: num(al.rent_1br), br2: num(al.rent_2br), yoy: num(al.yoy_change_pct), url: safeHref(al.source_url), asOf: ((src.apartmentList.meta || {}).generated_at_utc || '').slice(0, 10) || null });
      }
    }
    var f = ((src.fmr && src.fmr.counties) || []).find(function (c) { return c.fips === county; });
    if (f && f.fmr) {
      out.push({ source: 'HUD fair market rent' + (((src.fmr || {}).meta || {}).fiscal_year ? ' FY' + src.fmr.meta.fiscal_year : ''), scope: f.fmr_area_name || f.county_name, studio: num(f.fmr.efficiency), br1: num(f.fmr.one_br), br2: num(f.fmr.two_br), br3: num(f.fmr.three_br) });
    }
    return out;
  }

  // Every affordable property the site holds here (tax credit, HUD, USDA, local PHA),
  // not only CHFA tax-credit projects.
  function inventorySection(row, src) {
    if (!src.properties || !Array.isArray(src.properties.properties)) return null;
    var inScope = placeMatcher(row, src);
    var all = src.properties.properties;
    // A few records have no county; their city places them.
    var cityCounty = {};
    all.forEach(function (p) { var c = norm(p.city); if (c && p.county_fips && !cityCounty[c]) cityCounty[c] = String(p.county_fips).padStart(5, '0'); });
    var list = all.filter(function (p) {
      if (excluded({ name: p.property_name })) return false;
      var cf = p.county_fips ? String(p.county_fips).padStart(5, '0') : cityCounty[norm(p.city)] || null;
      return inScope(cf, p.city);
    }).map(function (p) {
      var programs = (Array.isArray(p.program_type) ? p.program_type : [p.program_type]).filter(Boolean);
      return {
        name: p.property_name || 'Unnamed property',
        city: p.city || null,
        programs: programs.filter(function (t) { return t !== 'preservation-candidate'; }).map(function (t) { return PROGRAM_LABELS[t] || t; }).join(', ') || 'Assisted (program not recorded)',
        units: num(p.total_units) !== null && num(p.total_units) > 0 ? num(p.total_units) : null,
        year: num(p.award_year) || num(p.year_placed_in_service) || num(p.latest_year) || null,
        expires: num(p.years_to_expiration),
        risk: p.risk_status || null
      };
    }).sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    var total = list.reduce(function (s, p) { return s + (p.units || 0); }, 0);
    return { properties: list, totalUnits: list.some(function (p) { return p.units !== null; }) ? total : null, source: sourcePath('properties') + ' (CHFA, HUD Multifamily, USDA Rural Development and local housing authority records, built ' + (((src.properties.metadata || {}).generated || '').slice(0, 10) || 'date not recorded') + ')' };
  }
  var PROGRAM_LABELS = {
    'lihtc-9pct': '9% tax credit', 'lihtc-4pct': '4% tax credit', 'lihtc-state-paired': 'state credit', 'lihtc-toc-paired': 'transit-oriented credit',
    'lihtc-mihtc': 'middle-income credit', 'hud-multifamily': 'HUD assisted', 'usda-rural-development': 'USDA Rural Development', 'pbv-local': 'project-based vouchers'
  };

  // Housing-policy markers (scorecard) and the curated policy-progress record.
  function civicSection(row, src) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var scores = (src.scorecard && src.scorecard.scores) || {};
    var s = scores[row.geoid] || null;
    var dims = (src.scorecard && src.scorecard.dimensions) || [];
    var markers = s ? dims.map(function (d) { return { label: d.label, value: s.dimensions ? s.dimensions[d.id] : null }; }) : [];
    var prog = ((src.progress || {}).by_geoid || {})[row.geoid] || null;
    return {
      total: s ? num(s.totalScore) : null, known: s ? num(s.knownDimensions) : null, max: s ? num(s.maxPossible) : null,
      markers: markers,
      progress: prog,
      countyNote: !s && scores[county] ? 'scored only at the county level' : null,
      sources: [sourcePath('scorecard'), prog ? sourcePath('progress') + ' (as of ' + (prog.as_of || 'date not recorded') + ')' : null].filter(Boolean)
    };
  }

  // A city can span counties (Aurora: Arapahoe, Adams, Douglas), and the records
  // carry the county the project sits in, not the city's main one. So a place
  // matches by name in any county, unless another Colorado place shares the
  // name, when it is held to its own county. Tax-credit and property lists share it.
  function placeMatcher(row, src) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var placeKey = norm(plainName(row.name));
    var sameName = ((src.rankingIndex && src.rankingIndex.rankings) || []).filter(function (r) {
      return r.type !== 'county' && norm(plainName(r.name)) === placeKey;
    }).length;
    return function inScope(recCounty, recTown) {
      if (row.type === 'county') return recCounty === county;
      if (norm(recTown) !== placeKey) return false;
      return sameName <= 1 || recCounty === county;
    };
  }

  function lihtcSection(row, src, countyName) {
    var inScope = placeMatcher(row, src);
    var props = ((src.chfaLihtc && src.chfaLihtc.features) || []).map(function (f) { return f.properties || f; })
      .filter(function (p) {
        return !excluded(p) && inScope(p.CNTY_FIPS, p.PROJ_CTY);
      })
      .map(function (p) {
        var a = p.AMIUnits || {};
        return {
          name: p.PROJECT, city: p.PROJ_CTY, awardYear: num(p.AwardYear || p.YR_ALLOC),
          credit: p.TypeOfCredits || p.CREDIT || null, units: num(p.N_UNITS), liUnits: num(p.LI_UNITS),
          mix: ['ami30', 'ami40', 'ami50', 'ami60', 'ami70', 'ami80'].map(function (k) { return num(a[k]); }),
          compliance: p.ComplianceStatus || null
        };
      })
      .sort(function (x, y) { return (y.awardYear || 0) - (x.awardYear || 0); });

    var awards = (((src.awards || {}).awards) || []).filter(function (a) {
      return inScope(a.county_fips, a.location);
    }).filter(function (a) { return !excluded(a); }).sort(function (x, y) { return (y.year || 0) - (x.year || 0); });

    var apps = null;
    if (src.applications && Array.isArray(src.applications.applications)) {
      apps = src.applications.applications.filter(function (a) {
        if (row.type === 'county') return (a.county_fips_all || [a.county_fips]).indexOf(row.geoid) !== -1;
        return (a.place_geoids || []).indexOf(row.geoid) !== -1;
      }).filter(function (a) { return !excluded(a); }).sort(function (x, y) { return (y.year || 0) - (x.year || 0); });
    }
    return {
      scopeLabel: row.type === 'county' ? countyName : plainName(row.name) + ' (city/town records only; see the county report for the rest of ' + countyName + ')',
      properties: props,
      awards: awards,
      applications: apps,
      applicationsMissing: apps === null,
      latestAwardYear: num((row.metrics || {}).latest_lihtc_year),
      // Projects mapped inside the boundary, which name matching can miss.
      inBoundary: num((row.metrics || {}).lihtc_in_boundary),
      // How the recency record was measured; 'never_funded' is a finding, a missing basis is not.
      recencyBasis: (row.metrics || {}).recency_basis || null,
      sources: [sourcePath('chfaLihtc') + ' (CHFA Housing Tax Credit properties layer, fetched ' + ((src.chfaLihtc || {}).fetchedAt || 'date not recorded') + ')',
        sourcePath('awards') + ' (CHFA, DOH and OEDIT award reports)',
        apps === null ? null : sourcePath('applications') + ' (CHFA applicant reports, ' + ((src.applications.meta || {}).first_year || '') + ' on)'].filter(Boolean)
    };
  }

  function prop123Section(row, src, countyName) {
    var list = (src.prop123 && src.prop123.jurisdictions) || [];
    var want = norm(plainName(row.name));
    var kind = row.type === 'county' ? 'county' : 'municipality';
    var rec = list.find(function (j) { return j.kind === kind && norm(j.name) === want; }) ||
      // Denver and Broomfield file as consolidated city and county governments.
      list.find(function (j) { return norm(j.name) === norm('City and County of ' + plainName(row.name)); }) || null;
    var countyRec = row.type === 'county' ? null
      : list.find(function (j) { return j.kind === 'county' && norm(j.name) === norm(countyName); }) || null;
    return {
      record: rec, countyRecord: countyRec,
      updated: (src.prop123 || {}).updated || null,
      source: sourcePath('prop123') + ' (DOLA commitment filings and fast-track lists)',
      landBanking: landBankingHere(row, src)
    };
  }

  // Prop 123 Land Banking awards in this place (or, for a county, anywhere in it),
  // each with the contact CHFA printed for it or one researched for an older round.
  function landBankingHere(row, src) {
    if (!src.landBanking || !Array.isArray(src.landBanking.awards)) return null;
    var awards = src.landBanking.awards.filter(function (a) {
      if (row.type === 'county') {
        return (a.county_fips || []).indexOf(row.geoid) !== -1 ||
          (a.places || []).some(function (p) { return p.county_fips === row.geoid; });
      }
      return (a.places || []).some(function (p) { return p.geoid === row.geoid; });
    }).filter(function (a) { return !excluded({ name: a.project }); });
    var C = src.landBankingContacts || {};
    var contacts = {};
    (C.from_award_lists || []).concat(C.researched || []).forEach(function (c) {
      if (c && c.award_id && !contacts[c.award_id]) contacts[c.award_id] = c;
    });
    var rounds = {};
    ((src.landBanking.meta || {}).rounds || []).forEach(function (r) { rounds[r.id] = r.label; });
    return {
      awards: awards.map(function (a) {
        return { project: a.project, sponsor: a.sponsor, location: a.location, round: rounds[a.round] || a.round,
          amount: num(a.amount_awarded), units: num(a.estimated_units), purpose: a.purpose,
          sourceUrl: a.source_url, quote: a.source_quote, contact: contacts[a.id] || null };
      }),
      contactsMissing: !src.landBankingContacts,
      programContact: (C.meta || {}).program_contact || null,
      programUrl: (src.landBanking.meta || {}).program_url || null,
      source: sourcePath('landBanking') + ' (CHFA Prop 123 Land Banking award lists)'
    };
  }

  function localPolicySection(row, src) {
    var ids = row.type === 'county' ? [row.geoid] : [row.geoid, row.containingCounty];
    function mine(e) { return ids.indexOf(e.geoid) !== -1; }
    var funds = (((src.localFunds || {}).entries) || []).filter(mine);
    var fees = (((src.feeReductions || {}).entries) || []).filter(mine);
    var landUse = (((src.feeReductions || {}).land_use) || []).filter(mine);
    var support = (((src.localSupport || {}).jurisdictions) || []).find(function (j) { return j.geoid === row.geoid; }) || null;
    return {
      funds: funds, fees: fees, landUse: landUse, support: support,
      sources: [sourcePath('localFunds'), sourcePath('feeReductions'), sourcePath('localSupport')]
    };
  }

  function rentsSection(row, src) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var lim = ((src.rentLimits && src.rentLimits.counties) || []).find(function (c) { return c.fips === county; }) || null;
    var fmr = ((src.fmr && src.fmr.counties) || []).find(function (c) { return c.fips === county; }) || null;
    var tiers = {};
    if (lim && lim.regular_tiers) {
      ['30', '40', '50', '60', '70', '80'].forEach(function (t) {
        var r = lim.regular_tiers[t];
        if (r) tiers[t] = { rent2br: num(r.max_rents && r.max_rents['2br']), income1p: num(r.income_limits && r.income_limits['1p']), income4p: num(r.income_limits && r.income_limits['4p']) };
      });
    }
    return {
      tiers: tiers,
      ruralResort: lim ? !!lim.rural_resort : null,
      fmr2br: fmr ? num(fmr.fmr && fmr.fmr.two_br) : null,
      fmrYear: ((src.fmr || {}).meta || {}).fiscal_year || null,
      medianRent: num((row.metrics || {}).gross_rent_median),
      limitsSource: sourcePath('rentLimits') + ' (CHFA 2026 income and rent limits)',
      fmrSource: sourcePath('fmr') + ' (' + (((src.fmr || {}).meta || {}).source || 'HUD') + ')'
    };
  }

  function fundingSection(row, src, FundingFit) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    // Every state award in this county, by agency and developer, on its own page. Absolute, like the
    // Deal Calculator link, so the downloaded report's link still works.
    var awardsHref = /^08\d{3}$/.test(county || '') ? 'https://cohoanalytics.com/where-housing-money-goes.html#county=' + county : null;
    if (!FundingFit || !src.fundingGuide) return { programs: null, awardsHref: awardsHref, source: sourcePath('fundingGuide') };
    var out = {};
    ['9%', '4%'].forEach(function (ex) {
      var q = { execution: ex, projectType: 'new-construction', county: county, place: row.type === 'county' ? undefined : row.geoid, openOnly: true };
      out[ex] = FundingFit.select(src.fundingGuide, q).map(function (r) {
        var p = r.program;
        return { name: p.name, administrator: p.administrator, url: safeHref(p.official_url), availability: r.availability, notes: r.notes || [] };
      });
    });
    return { programs: out, awardsHref: awardsHref, asOf: (src.fundingGuide.meta || {}).last_checked || null, source: sourcePath('fundingGuide') + ' via js/funding-fit.js (the Funding Sources finder)' };
  }

  // Current rents a new unit competes with: HUD two-bedroom FMR, Zillow's observed
  // rent, Apartment List's two-bedroom rent. ACS median gross rent includes long-held
  // cheap leases, so it is left out.
  function currentRents(market) {
    return (market || []).map(function (r) {
      return { rent: /ZORI/.test(r.source) ? r.all : /Apartment List|fair market rent/.test(r.source) ? r.br2 : null };
    });
  }

  function dealShape(need, rents, lihtc, guide, marketList, MixCheck, rulesFile) {
    // Screening rules, each stated in the document. Not an underwriting model.
    var notes = [];
    var route;
    var pop = need.population;
    if (pop !== null && pop < 25000) {
      route = '9% competitive credit first';
      notes.push('Population ' + fmtInt(pop) + ': a small market, where a 4% bond deal rarely reaches the scale its fixed costs need. The 4% route is a fallback that needs large soft funds.');
    } else if (pop !== null) {
      route = '9% or 4% (both viable at this scale)';
      notes.push('Population ' + fmtInt(pop) + ': large enough for a 4% bond deal of 80+ units as well as a 9% deal.');
    } else {
      route = 'Not determined';
      notes.push('Population not available, so the credit route is not suggested.');
    }

    var mix = null;
    if (gapsKnown(need)) {
      mix = { le30: need.gap30, le50: need.gap50, le60: need.gap60 };
      if (need.gap30 === 0 && need.gap50 === 0 && need.gap60 === 0) {
        notes.push('No rental shortfall is measured at or below 60% AMI. A tax-credit deal here has to rest on other evidence (waiting lists, a market study, commuters), and CHFA will ask for it.');
      } else if (need.gap30 > 0 && need.gap60 < need.gap30) {
        notes.push('The shortfall is deepest at the bottom: ' + fmtInt(need.gap30) + ' homes short at or below 30% AMI against ' + fmtInt(need.gap60) + ' at or below 60%. Weight the mix to 30–40% AMI units; under income averaging, some higher units keep the average at or below 60%. The 30% units carry the least debt (see the table below), so plan soft funds or project-based vouchers for them.');
      } else {
        notes.push('The shortfall reaches 60% AMI (' + fmtInt(need.gap60) + ' homes at or below 60%, ' + fmtInt(need.gap30) + ' of the need at or below 30%), so a 30–60% AMI mix fits the measured need.');
      }
    }

    // The homes-short counts are cumulative and can read 0 at a band whose renters
    // still pay too much; MixCheck reads cost burden by band, income averaging,
    // the middle-income lane and the 20-year need (js/mix-check.js).
    var burden = null, workforce = null, pencil = null;
    if (MixCheck) {
      burden = MixCheck.burdenByBand(need.bands);
      var mihtc = (((guide || {}).programs) || []).find(function (p) { return p && p.id === 'chfa-mihtc'; }) || null;
      var nn = MixCheck.needNotes({
        burden: burden, gap50: need.gap50,
        lim70: rents.tiers['70'] ? rents.tiers['70'].rent2br : null, lim80: rents.tiers['80'] ? rents.tiers['80'].rent2br : null,
        rentRange: MixCheck.rentRange(currentRents(marketList)), ruralResort: rents.ruralResort,
        mihtc: mihtc ? { name: mihtc.name, url: safeHref(mihtc.official_url) } : null, need20yr: need.need20yr
      });
      notes = notes.concat(nn.notes);
      workforce = nn.workforce;
      var limits = {};
      Object.keys(rents.tiers).forEach(function (t) { limits[t] = rents.tiers[t].rent2br; });
      pencil = MixCheck.pencil({ limits: limits, rules: rulesFile });
      if (pencil.ok) pencil.assumptionsText = MixCheck.assumptionsLine(pencil.assumptions);
    }

    var rentCheck = null;
    var lim60 = rents.tiers['60'] && rents.tiers['60'].rent2br;
    if (lim60 !== null && lim60 !== undefined) {
      rentCheck = { limit60: lim60, fmr: rents.fmr2br, median: rents.medianRent };
      var over = [];
      if (rents.fmr2br !== null && lim60 > rents.fmr2br) over.push('HUD fair market rent (' + fmtMoney(rents.fmr2br) + ')');
      if (rents.medianRent !== null && lim60 > rents.medianRent) over.push('the median gross rent (' + fmtMoney(rents.medianRent) + ')');
      if (over.length) notes.push('The CHFA 60% AMI two-bedroom limit (' + fmtMoney(lim60) + ') is above ' + over.join(' and ') + '. 60% units may not lease at their limit; the market study has to test achievable rent before the mix is set.');
      else notes.push('The CHFA 60% AMI two-bedroom limit (' + fmtMoney(lim60) + ') sits at or below local market measures, so tax-credit rents undercut the market.');
    }

    var boost = null;
    if (need.qctSharePct !== null || need.ddaSharePct !== null) {
      boost = { qct: need.qctSharePct, dda: need.ddaSharePct };
      if (need.ddaSharePct !== null && need.ddaSharePct >= 99) notes.push('The whole area is in a Difficult Development Area: any site gets the 30% basis boost.');
      else if (need.qctSharePct !== null && need.qctSharePct > 0) notes.push(fmtPct(need.qctSharePct, 0) + ' of the area is in a Qualified Census Tract: a site inside one gets the 30% basis boost, so check the tract before choosing a site.');
      else notes.push('No QCT or DDA coverage recorded: plan without the basis boost unless CHFA designates the site.');
    }

    var sizes = lihtc.properties.map(function (p) { return p.units; }).filter(function (u) { return u !== null; }).sort(function (a, b) { return a - b; });
    var medianSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : null;
    if (medianSize !== null) notes.push('Existing tax-credit projects here have a median of ' + fmtInt(medianSize) + ' units: a size the market has already absorbed.');
    return { route: route, mix: mix, burden: burden, workforce: workforce, pencil: pencil, rentCheck: rentCheck, boost: boost, medianSize: medianSize, notes: notes };
  }

  // When an application can realistically go in, back-solved from CHFA's calendar.
  // A round whose letter of intent is at least LEAD_DAYS away is the base case; a nearer
  // one is a stretch that needs the conditions below; under STRETCH_MIN_DAYS it is not
  // realistic. Both cut-offs are screening estimates, stated in the document.
  var LEAD_DAYS = 90, STRETCH_MIN_DAYS = 15;
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  // CHFA's dates are Colorado dates, so "today" is the date in Denver, not in UTC.
  function coloradoToday(now) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(now).forEach(function (x) { p[x.type] = x.value; });
      if (p.year && p.month && p.day) return p.year + '-' + p.month + '-' + p.day;
    } catch (e) { /* no time zone data: fall back to UTC */ }
    return now.toISOString().slice(0, 10);
  }
  function addMonths(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }

  function qapItem(scoring, id) {
    var hit = (((scoring || {}).thresholds) || []).concat(((scoring || {}).lines) || []).find(function (x) { return x.id === id; });
    return hit ? { id: id, page: hit.page || null, section: hit.section || null, quote: hit.quote } : null;
  }

  function dealTiming(src, today, route) {
    var rounds = {};
    (((src.qapCalendar || {}).events) || []).forEach(function (e) {
      var k = /^(\d{4})-r([12])-(loi|deadline|awards)$/.exec(e.id || '');
      if (!k || !e.date) return;
      var key = k[1] + ' R' + k[2];
      var r = rounds[key] || (rounds[key] = { label: key + (k[2] === '1' ? ' (9% + state credit)' : ' (4% + state credit)'), credit: k[2] === '1' ? '9%' : '4%', draft: false, url: null });
      r[k[3]] = e.date;
      if (k[3] === 'awards') r.awardsEstimated = e.date_precision === 'estimated';
      if (e.qap_status === 'draft') r.draft = true;
      if (!r.url) r.url = safeHref(e.url);
    });
    var open = Object.keys(rounds).map(function (k) { return rounds[k]; })
      .filter(function (r) { return r.loi && r.deadline && r.loi >= today; })
      .sort(function (a, b) { return a.loi < b.loi ? -1 : 1; });
    open.forEach(function (r) {
      r.daysToLoi = daysBetween(today, r.loi);
      r.reading = r.daysToLoi >= LEAD_DAYS ? 'base' : r.daysToLoi >= STRETCH_MIN_DAYS ? 'stretch' : 'late';
    });
    var credits = /^9%/.test(route) ? ['9%', '4%'] : /^4%/.test(route) ? ['4%', '9%'] : ['9%', '4%'];
    var rows = [];
    credits.forEach(function (c) {
      var mine = open.filter(function (r) { return r.credit === c; });
      for (var i = 0; i < mine.length; i++) { rows.push(mine[i]); if (mine[i].reading === 'base') break; }
    });
    // With no preferred credit, the earliest round wins: rows run in date order so the
    // first base case is the soonest realistic one.
    if (/^9% or 4%/.test(route)) rows.sort(function (a, b) { return a.loi < b.loi ? -1 : a.loi > b.loi ? 1 : 0; });
    // A 4% bond deal without state credit does not wait for a round: CHFA reviews it
    // on a rolling basis, so the round dates hold only for 4% paired with state credit.
    // Every route here keeps 4% at least as a fallback, so the rolling path shows even
    // when no fixed round is open.
    var rollEntry = (((src.qapCalendar || {}).rolling_programs) || []).find(function (p) { return p && p.category === '4pct-rolling'; }) || null;
    var roll = rollEntry;
    // The calendar lists the months CHFA takes no preliminary applications, so a report
    // built in one of them says when the window reopens instead of "need not wait".
    var closedMonths = roll && Array.isArray(roll.closed_months)
      ? roll.closed_months.filter(function (n) { return n >= 1 && n <= 12 && n === Math.floor(n); }) : [];
    var closedNow = closedMonths.indexOf(+today.slice(5, 7)) >= 0, reopens = null;
    if (closedNow && closedMonths.length < 12) {
      reopens = today.slice(0, 8) + '01';
      do { reopens = addMonths(reopens, 1); } while (closedMonths.indexOf(+reopens.slice(5, 7)) >= 0);
    }
    if (!rows.length && !roll) return null;
    var scoring = src.qapScoring || null;
    function milestones(r) {
      if (!scoring) return null;
      var out = [{ by: r.loi, what: 'Letter of intent to CHFA', ref: null }];
      [['T2', r.deadline, 'Site control: deed, title commitment or executed purchase agreement'],
        ['T7', r.deadline, 'Zoning status letter from the planning department, with parking'],
        ['T8', r.deadline, 'Phase I environmental, dated no earlier than ' + addMonths(r.deadline, -12) + ' (no older than 12 months at application)'],
        ['T3', r.deadline, 'Market study by a CHFA-approved, unaffiliated analyst, matching the application\'s mix and rents'],
        ['T16', r.deadline, 'Local government contribution in writing (state credit)'],
        ['T15', r.deadline, 'Public hearing in the community (state credit)']].forEach(function (x) {
        var q = qapItem(scoring, x[0]);
        if (q) out.push({ by: x[1], what: x[2], ref: q });
      });
      return out;
    }
    rows.forEach(function (r) { if (r.reading !== 'late') r.milestones = milestones(r); });
    var lb = ((((src.fundingGuide || {}).programs) || []).find(function (p) { return p && p.id === 'prop123-ahff-land-banking'; })) || null;
    return {
      rows: rows,
      rolling4: roll ? { name: roll.name, description: roll.description, url: safeHref(roll.url), closedMonths: closedMonths, closedNow: closedNow, reopens: reopens } : null,
      leadDays: LEAD_DAYS,
      stretchMinDays: STRETCH_MIN_DAYS,
      scoringStatus: scoring ? { draft: scoring.status === 'draft', note: scoring.status_note || null, title: (scoring.source || {}).title || null, url: safeHref((scoring.source || {}).url) } : null,
      landBanking: lb && lb.status === 'open' ? { cycle: lb.application_cycle || null, applicants: lb.eligible_applicants || null, url: safeHref(lb.official_url) } : null,
      sources: [sourcePath('qapCalendar'), sourcePath('qapScoring'), sourcePath('fundingGuide')]
    };
  }

  // Scoring lines a deal here can likely claim, or choose to earn, from the CHFA QAP
  // scoring file. A line shows only when the data supports it.
  function dealStructure(src, row, landscape, policy, contacts, route) {
    var scoring = src.qapScoring;
    if (!scoring) return null;
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var out = [];
    function add(id, reading, text) {
      var line = (scoring.lines || []).find(function (l) { return l.id === id; });
      if (line) out.push({ id: id, points: line.points, label: line.label, section: line.section, page: line.page, quote: line.quote, reading: reading, text: text });
    }
    // The report holds no metro delineation it can trust for this line, so a county
    // under the population cap is a line to confirm, not a likely one.
    var countyRow = findRanking(src.rankingIndex, county);
    var countyPop = countyRow ? num((countyRow.metrics || {}).population) : null;
    if (countyPop !== null && countyPop <= 180000) {
      add('5B3b-nonmetro', 'check', (countyRow.name || 'The county') + ' has ' + fmtInt(countyPop) + ' people, under the cap. Confirm with CHFA that it counts as non-metro: counties in a metro area do not.');
    }
    // Each line adds the files its evidence came from, so the table can be traced.
    var used = [sourcePath('qapScoring'), sourcePath('rankingIndex')];
    function cite(list) { list.forEach(function (p) { if (p && used.indexOf(p) === -1) used.push(p); }); }
    var support = policy.support && Array.isArray(policy.support.items) ? policy.support.items.length : 0;
    // A town's plan standing in for a county with none of its own is not the county's.
    var plans = landscape.research && !landscape.research.placeLevel ? landscape.research.groups.filter(function (g) { return g.key === 'plans' && g.items.length; }).length : 0;
    if (support || plans) {
      add('5B2a-priority', 'check', 'A plan or council record on housing is on file (see Local funds and Local landscape). Confirm it names the need this project serves before counting the points.');
      if (support) cite([sourcePath('localSupport')]);
      if (plans) cite(landscape.sources);
    }
    // No source here records whether an agency is a Colorado public housing authority
    // in law, so only agencies named as housing authorities are offered, and as a
    // line to confirm, never as supported points.
    var fromLandscape = landscape.authorities.map(function (a) { return a.name; }).filter(function (n) { return /housing authority/i.test(n); });
    var fromOrgs = contacts.orgs.filter(function (o) { return o.role === 'Housing authority' && /housing authority/i.test(o.name); }).map(function (o) { return o.name; });
    var pha = fromLandscape.concat(fromOrgs).filter(function (n, i, all) { return all.indexOf(n) === i; });
    if (pha.length) {
      add('5B4b-pha', 'check', pha.slice(0, 2).join(' or ') + ' as sole or majority co-general partner. Confirm it is a Colorado public housing authority before counting the points.');
      if (fromLandscape.length) cite(landscape.sources);
      if (fromOrgs.length) cite(['data/hna/local-resources.json']);
    }
    // No record here shows a nonprofit's legal status, housing purpose or capacity to
    // be general partner, so no provider is named as a candidate for these points.
    if (pha.length || landscape.stewards.length) {
      add('5B4a-nonprofit', 'check', 'A qualified nonprofit or housing authority as sole general partner. No partner on file is confirmed to qualify: confirm nonprofit status, a low-income housing purpose and capacity to act as general partner before counting the points.' +
        (pha.length ? ' An alternative to the housing authority line: one sponsor earns one of the two, not both.' : ''));
      if (landscape.stewards.length) cite([sourcePath('stewardship')]);
      // The same sponsor cannot earn both 5.B.4 lines (see submittal-review.js).
      if (pha.length) out.forEach(function (l) { if (l.id === '5B4a-nonprofit' || l.id === '5B4b-pha') l.exclusiveWith = l.id === '5B4a-nonprofit' ? '5B4b-pha' : '5B4a-nonprofit'; });
    }
    if (/9%/.test(route)) add('5B5-homeless', 'option', 'Needs a services partner. Cannot be combined with the extremely-low-income targeting points.');
    return {
      lines: out,
      draft: scoring.status === 'draft',
      title: (scoring.source || {}).title || null,
      url: safeHref((scoring.source || {}).url),
      source: used.join(', ')
    };
  }

  function contactsSection(row, src, contactsFile, resources, relatedFiles, contactsFailed) {
    function usable(f) {
      return f && Array.isArray(f.contacts) ? f.contacts.filter(function (c) { return c && c.name && safeHref(c.source_url) && c.source_quote; }) : [];
    }
    var researched = usable(contactsFile);
    // A town's county, or a county's towns, researched where this place is not.
    var allowed = relatedGeoids(src, row.geoid);
    var related = (relatedFiles || []).filter(function (f) { return f && allowed.indexOf(f.geoid) !== -1; })
      .map(function (f) { return { geoid: f.geoid, name: f.name || f.geoid, checked: f.checked || null, contacts: usable(f) }; })
      .filter(function (f) { return f.contacts.length; });
    // Organisation links from local-resources.json, without search-engine links.
    var orgs = [], plans = [], partners = [], offices = [];
    var keys = row.type === 'county' ? ['county:' + row.geoid] : ['place:' + row.geoid, 'county:' + row.containingCounty];
    keys.forEach(function (k) {
      var r = resources && resources[k];
      if (!r) return;
      [['housingLead', 'Housing lead'], ['housingAuthority', 'Housing authority']].forEach(function (pair) {
        var v = r[pair[0]];
        (Array.isArray(v) ? v : v ? [v] : []).forEach(function (o) {
          var u = safeHref(o.url);
          if (o && o.name && u && !isSearchLink(u)) orgs.push({ role: pair[1], name: o.name, url: u });
        });
      });
      ['council_agenda_url', 'planning_commission_url'].forEach(function (f) {
        var u = safeHref(r[f]);
        if (u && !isSearchLink(u)) orgs.push({ role: f === 'council_agenda_url' ? 'Council agendas' : 'Planning commission', name: plainName(row.name), url: u });
      });
      // Plans, partner organisations and the offices to reach, as the old brief's
      // "Local housing leadership" card listed them. A search link is not a source,
      // so an office with only a search link prints without one.
      (Array.isArray(r.housingPlans) ? r.housingPlans : []).forEach(function (pl) {
        if (pl && pl.name) plans.push({ name: pl.name, type: pl.type || null, year: pl.year || null, url: isSearchLink(pl.url) ? null : safeHref(pl.url) });
      });
      (Array.isArray(r.advocacy) ? r.advocacy : []).forEach(function (a) {
        if (a && a.name) partners.push({ name: a.name, url: isSearchLink(a.url) ? null : safeHref(a.url) });
      });
      (Array.isArray(r.contacts) ? r.contacts : []).forEach(function (c) {
        if (c && c.name) offices.push({ name: c.name, title: c.title || null, jurisdiction: c.jurisdiction || null, url: isSearchLink(c.url) ? null : safeHref(c.url) });
      });
    });
    function dedupe(list, key) {
      var seen = {};
      return list.filter(function (o) { var k = key(o); if (seen[k]) return false; seen[k] = true; return true; });
    }
    orgs = dedupe(orgs, function (o) { return o.url; });
    return {
      researched: researched,
      checked: contactsFile ? contactsFile.checked || null : null,
      related: related,
      orgs: orgs,
      plans: dedupe(plans, function (o) { return o.name.toLowerCase(); }),
      partners: dedupe(partners, function (o) { return o.name.toLowerCase(); }),
      offices: dedupe(offices, function (o) { return o.name.toLowerCase(); }),
      needsResearch: researched.length === 0 && related.length === 0,
      resourcesLoaded: !!resources,
      // A contact file that failed to load (not merely absent) leaves the search unfinished.
      contactsLoaded: !contactsFailed,
      // Every contact file searched, kept even when it held no usable contact, so a
      // negative finding can cite each one.
      searchedGeoids: [row.geoid].concat(allowed)
    };
  }

  // What the landscape research file may hold. Each entry is shown only when it carries
  // a public source URL and a quote from that page.
  var LANDSCAPE_KINDS = [
    ['plans', 'Plans and studies'],
    ['agencies', 'Housing authorities, funds and trusts'],
    ['state_funds', 'Recent state and federal money'],
    ['task_forces', 'Task forces and coalitions'],
    ['people', 'People to know'],
    ['land', 'Land and large sites'],
    ['lihtc_and_pipeline', 'Projects built and in the pipeline']
  ];

  function sourced(e) { return e && safeHref(e.source_url) && !isSearchLink(e.source_url) && e.source_quote; }

  function landscapeSection(row, src, file, countyName, landscapeFailed) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    // From the site's own data, for every jurisdiction.
    var authorities = (((src.resortPrograms || {}).authorities) || []).filter(function (a) {
      if (row.type === 'county') return a.county_fips === county;
      var serves = a.serves_place_geoids || a.place_geoids || [];
      return serves.indexOf(row.geoid) !== -1 || (a.county_fips === county && !serves.length);
    }).map(function (a) {
      var inv = a.inventory && Array.isArray(a.inventory.display) ? a.inventory.display.join('; ') : null;
      return { name: a.name, area: a.service_area || null, inventory: inv, url: safeHref(a.url) };
    });
    var stewards = (((src.stewardship || {}).providers) || []).filter(function (p) {
      return (p.counties_served || []).indexOf(county) !== -1;
    }).map(function (p) { // Only roles the provider record marks verified; the rest await confirmation.
      var verified = (p.role_evidence && Array.isArray(p.role_evidence.verified)) ? p.role_evidence.verified : [];
      return { name: p.name, url: safeHref(p.url), roles: verified.join(', ').replace(/_/g, ' ') }; });

    // From the hand-researched file, when there is one.
    var research = null;
    if (file && (file.geoid === row.geoid || file.geoid === county || (row.type === 'county' && relatedGeoids(src, row.geoid).indexOf(file.geoid) !== -1))) {
      research = { geoid: file.geoid, countyLevel: row.type !== 'county' && file.geoid !== row.geoid, placeLevel: row.type === 'county' && file.geoid !== row.geoid ? (file.name || (((src.rankingIndex || {}).rankings || []).find(function (r) { return r.geoid === file.geoid; }) || {}).name || file.geoid) : null, researched: file.researched || null, groups: [], notFound: (Array.isArray(file.not_found) ? file.not_found : []).filter(function (t) { return typeof t === 'string' && !EXCLUDED_PROJECT.test(t); }) };
      LANDSCAPE_KINDS.forEach(function (k) {
        var items = (Array.isArray(file[k[0]]) ? file[k[0]] : []).filter(sourced).filter(function (e) { return !EXCLUDED_PROJECT.test(JSON.stringify(e)); });
        research.groups.push({ key: k[0], label: k[1], items: items });
      });
    }
    var missing = LANDSCAPE_KINDS.filter(function (k) {
      return !research || !research.groups.some(function (g) { return g.key === k[0] && g.items.length; });
    }).map(function (k) { return k[1]; });
    return {
      authorities: authorities,
      stewards: stewards,
      research: research,
      missing: missing,
      // Which inputs actually loaded, so an empty list is never read as "none found".
      // A county read from a town's file has not been searched county-wide.
      // A landscape file that failed to load (not merely absent) leaves the search unfinished.
      loaded: { resortPrograms: !!src.resortPrograms, stewardship: !!src.stewardship, research: !!research && !research.placeLevel && !landscapeFailed },
      countyName: countyName,
      sources: [sourcePath('resortPrograms'), sourcePath('stewardship'), landscapePath(research ? research.geoid : row.geoid)]
    };
  }

  // How a tax-credit deal is put together here: the stack, the local pieces the data
  // already shows, and the path from letter of intent to a finished building.
  function dealDynamics(row, src, need, lihtc, policy) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var a = src.assumptions || null;
    var eq = (((src.equityPricing || {}).pricing) || {}).national_avg || null;
    var region = ((((src.equityPricing || {}).pricing) || {}).by_region || {}).north_central || null;
    var pabRows = ((src.pab || {}).allocations) || {};
    var pab = [pabRows[row.geoid], row.type === 'county' ? null : pabRows[county]].filter(Boolean).map(function (r) {
      return { name: r.type === 'county' && !/county/i.test(r.name) ? r.name + ' County' : r.name, amount: num(r.directAllocation) };
    });
    var pabMeta = (src.pab || {}).metadata || {};
    var localMoney = lihtc.awards.filter(function (w) { return !/LIHTC|MIHTC/.test(w.program || ''); }).map(function (w) {
      return { year: w.year, program: w.program, sponsor: w.sponsor && !/^\d+$/.test(String(w.sponsor)) ? w.sponsor : null, name: w.name, amount: num(w.amount_awarded), url: safeHref(w.source_url) };
    });
    return {
      equity9: eq ? num(eq.credit_9pct) : (a && a.equityPricing ? num(a.equityPricing.default9Pct) : null),
      equity4: eq ? num(eq.credit_4pct) : (a && a.equityPricing ? num(a.equityPricing.default4Pct) : null),
      equityRegion: region ? num(region.median_all_credits) : null,
      hardCost: a && a.hardCostPerUnit ? num(a.hardCostPerUnit.family) : null,
      hardCostSource: a && a.hardCostPerUnit ? a.hardCostPerUnit.source || null : null,
      softCostPct: a ? share(a.softCostPct) : null,
      devFeePct: a ? share(a.devFeePct) : null,
      basisBoostPct: a && a.basisBoost ? share(a.basisBoost.qct) : null,
      boostHere: need.qctSharePct !== null && need.qctSharePct > 0 || need.ddaSharePct !== null && need.ddaSharePct > 0,
      pab: pab,
      pabYear: pabMeta.year || null,
      pabStatewidePool: num((pabMeta.statewide || {}).chfaPool),
      // Linked only when the data names the DOLA page it was read from.
      pabSourceUrl: /^https:\/\/doh\.colorado\.gov\//.test(pabMeta.sourceUrl || '') ? pabMeta.sourceUrl : null,
      localMoney: localMoney,
      localFunds: policy.funds.length,
      sources: [sourcePath('equityPricing'), sourcePath('assumptions'), sourcePath('pab'), sourcePath('awards')]
    };
  }

  // Workers and employers: the commute reading for the place (or its county), the largest
  // employers printed for the county, and researched employer and housing partnership contacts.
  // The commute line prints once one other town employs this share of a town's working residents,
  // the same threshold Where Should I Build uses.
  var TOP_WORKPLACE_SHOWN = 0.2;

  function workforceSection(row, src, countyFips) {
    var C = src.commute || null;
    var rec = C ? ((C.places || {})[row.geoid] || (C.counties || {})[row.geoid] || null) : null;
    var fips = row.type === 'county' ? row.geoid : countyFips;
    var areas = ((src.employers || {}).areas || []).filter(function (a) { return (a.county_fips || []).indexOf(fips) !== -1; });
    var EC = src.employerContacts || null;
    var researched = [];
    areas.forEach(function (a) {
      var r = EC && EC.areas ? EC.areas[a.id] : null;
      if (!r) return;
      (r.employers || []).concat(r.partnerships || []).forEach(function (e) {
        var contacts = (e.contacts || []).filter(function (c) { return c && c.name && safeHref(c.source_url) && c.source_quote; });
        researched.push({ name: e.employer || e.org, kind: e.employer ? 'employer' : 'partner', what: e.housing_action || e.what || '',
          url: safeHref(e.source_url), quote: e.source_quote || null, contacts: contacts });
      });
    });
    // The one other town that employs the most of the place's working residents (towns only).
    var ja = src.jobAccess && row.type !== 'county' ? (src.jobAccess.places || {})[row.geoid] : null;
    var top = ja && ja.top_workplace && ja.workers ? { name: ja.top_workplace.name, workers: ja.top_workplace.workers, of: ja.workers,
      otherStates: ja.workers_other_states || 0, year: (src.jobAccess.meta || {}).lodes_year || null } : null;
    // A town too small for a commute record still gets its line when one other town employs a fifth or more.
    if (!rec && !areas.length && !(top && top.workers / top.of >= TOP_WORKPLACE_SHOWN)) return null;
    return {
      topWorkplace: top,
      commute: rec ? { name: rec.name, jobs: rec.jobs, inCommuters: rec.in_commuters, far: rec.far, farLow: rec.far_low, long: rec.long,
        medianFar: rec.median_far_miles, residents: rec.residents, outCommuters: rec.out_commuters, from: rec.from || [], to: rec.to || [],
        county: !!(C.counties || {})[row.geoid] || !(C.places || {})[row.geoid], year: (C.meta || {}).lodes_year || null } : null,
      areas: areas.map(function (a) { return { area: a.area, asOf: a.as_of, rows: a.rows || [], filer: (a.source || {}).filer, url: safeHref((a.source || {}).url), page: (a.source || {}).pdf_page || null }; }),
      researched: researched,
      checked: EC ? EC.checked || null : null,
      contactsMissing: !EC
    };
  }

  function nextDates(src, today) {
    var ev = ((src.qapCalendar || {}).events) || [];
    return ev.filter(function (e) { return e.date && e.date >= today && /LIHTC|R1|R2|Letter of Intent/i.test(e.name || ''); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 6)
      .map(function (e) { return { date: e.date, name: e.name, draft: e.qap_status === 'draft', url: safeHref(e.url) }; });
  }

  function buildModel(src, geoid, opts) {
    opts = opts || {};
    var row = findRanking(src.rankingIndex, geoid);
    if (!row) return { error: 'No jurisdiction with GEOID ' + geoid + ' in ' + sourcePath('rankingIndex') + '.' };
    var countyRow = row.type === 'county' ? row : findRanking(src.rankingIndex, row.containingCounty);
    var countyName = countyRow ? countyRow.name : 'its county';
    var need = needSection(row, src);
    var rents = rentsSection(row, src);
    var lihtc = lihtcSection(row, src, countyName);
    var today = opts.today || coloradoToday(new Date());
    var policy = localPolicySection(row, src);
    var landscape = landscapeSection(row, src, opts.landscape || (opts.relatedLandscape || []).filter(Boolean)[0] || null, countyName, !!opts.landscapeFailed);
    var brief = opts.brief && opts.brief.geoid === geoid ? opts.brief : null;
    // Text the public-artifact guard blocks is dropped paragraph by paragraph, so one
    // sentence does not cost the whole paper. The caller still checks the finished HTML.
    var blocked = typeof opts.isSensitive === 'function' ? opts.isSensitive : function () { return false; };
    var dropped = 0;
    function keep(text) { if (blocked(text)) { dropped++; return false; } return true; }
    var model = {
      geoid: geoid,
      name: row.type === 'county' ? row.name : plainName(row.name),
      kind: row.type,
      countyName: countyName,
      region: row.region || null,
      generated: today,
      community: communitySection(opts.summary || null, geoid),
      need: need,
      rents: rents,
      market: marketRents(row, src),
      inventory: inventorySection(row, src),
      civic: civicSection(row, src),
      lihtc: lihtc,
      prop123: prop123Section(row, src, countyName),
      policy: policy,
      funding: fundingSection(row, src, opts.FundingFit),
      deal: dealShape(need, rents, lihtc, src.fundingGuide, marketRents(row, src), opts.MixCheck || null, src.underwritingRules || null),
      landscape: landscape,
      dynamics: dealDynamics(row, src, need, lihtc, policy),
      workforce: workforceSection(row, src, countyRow ? countyRow.geoid : null),
      contacts: contactsSection(row, src, opts.contacts || null, opts.localResources || null, opts.relatedContacts || [], !!opts.contactsFailed),
      dates: nextDates(src, today),
      brief: brief ? {
        lastCurated: brief.last_curated || null,
        sections: (brief.sections || []).map(function (s) {
          return { heading: s.heading, paragraphs: (s.paragraphs || []).map(function (p) { return p.text; }).filter(keep) };
        }).filter(function (s) { return s.paragraphs.length; }),
        sources: (brief.sources || []).map(function (s) {
          var u = safeHref(s.url);
          return { id: s.id, title: s.title || s.label || s.publisher || (isSearchLink(u) ? null : s.url), url: isSearchLink(u) ? null : u };
        })
          .filter(function (s) { return keep(JSON.stringify(s)); }),
        summary: brief.summary && keep(brief.summary) ? brief.summary : null,
        dropped: dropped
      } : null
    };
    model.deal.timing = dealTiming(src, today, model.deal.route);
    model.deal.structure = dealStructure(src, row, landscape, policy, model.contacts, model.deal.route);
    // Questions for the local government: wording from the private bank, signals from this model.
    model.questions = opts.TownQuestions ? opts.TownQuestions.build(model, src.townQuestions || null, src.qapScoring || null, today) : null;
    return model;
  }

  // ---------------------------------------------------------------- render

  function row2(label, value) { return '<tr><th scope="row">' + esc(label) + '</th><td>' + value + '</td></tr>'; }
  function srcLine(list) {
    return '<p class="wp-src">Source: ' + (Array.isArray(list) ? list : [list]).filter(Boolean).map(esc).join('; ') + '</p>';
  }
  function link(text, url) { var u = safeHref(url); return u ? '<a href="' + esc(u) + '">' + esc(text) + '</a>' : esc(text); }

  var STYLE = [
    ':root{--text:#1a202c;--muted:#4a5568;--border:#cbd5e0;--accent:#096e65;--bg:#fff;--bg2:#f1f5f9}',
    '@media (prefers-color-scheme:dark){:root{--text:#e2e8f0;--muted:#a0aec0;--border:#4a5568;--accent:#4fd1c5;--bg:#111827;--bg2:#1f2937}}',
    'body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.wp{max-width:820px;margin:0 auto;padding:24px 16px 64px}',
    '.wp h1{font-size:1.9rem;line-height:1.2;margin:.2em 0}.wp h2{font-size:1.3rem;margin:2em 0 .4em;padding-top:.6em;border-top:2px solid var(--border)}',
    '.wp h3{font-size:1.05rem;margin:1.2em 0 .3em}.wp-kicker{color:var(--accent);font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:.8125rem}',
    '.wp-meta,.wp-src{color:var(--muted);font-size:.85rem}.wp-src{margin:.4em 0 0}',
    '.wp table{border-collapse:collapse;width:100%;margin:.5em 0;font-size:.92rem}.wp th,.wp td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}',
    '.wp thead th{background:var(--bg2)}.wp td.n{text-align:right;font-variant-numeric:tabular-nums}',
    '.wp-scroll{overflow-x:auto}.wp-note{background:var(--bg2);border-left:4px solid var(--accent);padding:10px 14px;margin:1em 0}',
    '.wp ul{padding-left:1.2em}.wp a{color:var(--accent)}.wp-tag{display:inline-block;font-size:.8125rem;padding:1px 6px;border:1px solid var(--border);border-radius:4px;margin-left:4px}',
    '.wp-glance{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:1em 0}.wp-tile{border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--bg2)}',
    '.wp-tile-v{font-size:1.25rem;font-weight:700;font-variant-numeric:tabular-nums}.wp-tile-l{font-size:.8125rem;color:var(--muted);line-height:1.3}',
    '@media (max-width:560px){.wp-glance{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    // Contact tables read as one card per person on a phone, so the phone and email show without scrolling sideways.
    '@media screen and (max-width:560px){.wp table.wp-stack thead{display:none}.wp table.wp-stack tr{display:block;border-bottom:1px solid var(--border);padding:6px 0}.wp table.wp-stack td{display:block;border:0;padding:2px 0}.wp table.wp-stack td[data-label]::before{content:attr(data-label) ": ";font-weight:600;color:var(--muted)}}',
    '.wp-barcell{position:relative;min-width:7em;white-space:nowrap}.wp-bar{display:inline-block;height:.7em;max-width:6em;margin-right:6px;background:var(--accent);opacity:.55;vertical-align:baseline;border-radius:2px}',
    '@media print{body{background:#fff;color:#000}.wp{max-width:none;padding:0}.wp h2{break-after:avoid}.wp table{break-inside:auto}.wp tr{break-inside:avoid}.wp-noprint{display:none}a{color:#000}}'
  ].join('\n');

  function renderSummary(m) {
    var n = m.need, d = m.deal, p = m.prop123.record;
    var items = [];
    items.push('<li><strong>Need:</strong> ' + (gapsKnown(n) ? fmtInt(n.gap30) + ' rental homes short for renters at or below 30% AMI; ' + fmtInt(n.gap60) + ' at or below 60%' : 'rental shortfall not available') + '. ' +
      (n.costBurdenedPct !== null ? fmtPct(n.costBurdenedPct) + ' of renters are cost-burdened.' : '') + '</li>');
    items.push('<li><strong>Tax-credit history:</strong> ' + m.lihtc.properties.length + ' CHFA tax-credit ' + (m.lihtc.properties.length === 1 ? 'property' : 'properties') +
      (m.lihtc.latestAwardYear !== null ? '; latest award ' + m.lihtc.latestAwardYear : '') +
      (m.lihtc.applications ? '; ' + m.lihtc.applications.length + ' application' + (m.lihtc.applications.length === 1 ? '' : 's') + ' in the CHFA applicant reports' : '') + '.</li>');
    items.push('<li><strong>Prop 123:</strong> ' + (p ? esc(p.status) + ' (filed ' + esc(p.filing_date || 'date not recorded') + ', ' + fmtInt(p.proposed_units) + ' units promised' + (p.fast_track ? ', fast-track adopted' : '') + ')' : 'no commitment on file for this jurisdiction') + '.</li>');
    items.push('<li><strong>Deal shape:</strong> ' + esc(d.route) + (d.rentCheck && d.rentCheck.limit60 !== null && d.rentCheck.fmr !== null && d.rentCheck.limit60 > d.rentCheck.fmr ? '; test achievable rent before using 60% AMI units' : '') + '.</li>');
    var tl = timingLine(d, false);
    if (tl) items.push('<li><strong>Timing:</strong> ' + tl + '</li>');
    if (m.questions && !m.questions.missing) items.push('<li><strong>Questions for ' + esc(m.questions.gov.name) + ':</strong> ' + m.questions.pointed.length + ' pointed, from this place\'s data, and ' + m.questions.standard.length + ' standard.</li>');
    items.push('<li><strong>Contacts:</strong> ' + (m.contacts.needsResearch ? 'not yet researched for this jurisdiction (organisation links below)'
      : m.contacts.researched.length ? m.contacts.researched.length + ' named, each with its source'
      : 'none researched here yet; ' + m.contacts.related.reduce(function (n, f) { return n + f.contacts.length; }, 0) + ' from ' + m.contacts.related.map(function (f) { return f.name; }).join(', ') + ' shown instead') + '.</li>');
    return '<h2 id="summary">Summary</h2><ul>' + items.join('') + '</ul>';
  }

  // The first screen: the numbers a reader asks for first, each from a section below.
  function renderGlance(m) {
    var C = m.community, n = m.need;
    var ppl = C ? C.people : {}, st = C ? C.stock : {};
    function tile(label, value) { return '<div class="wp-tile"><div class="wp-tile-v">' + value + '</div><div class="wp-tile-l">' + esc(label) + '</div></div>'; }
    var pop = ppl.population != null ? ppl.population : n.population;
    var inc = ppl.medianIncome != null ? ppl.medianIncome : n.medianIncome;
    var rent = st.medianRent != null ? st.medianRent : n.medianRent;
    var value = st.homeValue ? st.homeValue.value : n.medianHomeValue;
    var renters = st.renterPct != null ? st.renterPct : n.renterSharePct;
    return '<div class="wp-glance">' +
      tile('People', fmtInt(pop)) +
      tile('Households', fmtInt(ppl.households)) +
      tile('Median household income', fmtMoney(inc)) +
      tile('Households that rent', fmtPct(renters, 0)) +
      tile('Median rent', fmtMoney(rent)) +
      tile('Median home value', fmtMoney(value)) +
      tile('Renters paying 30%+ of income', fmtPct(n.costBurdenedPct, 0)) +
      tile('Rental homes short, 30% AMI or less', fmtInt(n.gap30)) +
      '</div>';
  }

  function binTable(title, head, rows, pctOnly) {
    if (!rows) return '';
    return '<h3>' + esc(title) + '</h3><div class="wp-scroll"><table><thead><tr><th>' + esc(head) + '</th>' + (pctOnly ? '' : '<th>Count</th>') + '<th>Share</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var pct = r.pct;
        return '<tr><td>' + esc(r.label) + '</td>' + (pctOnly ? '' : '<td class="n">' + fmtInt(r.count) + '</td>') +
          '<td class="wp-barcell">' + (pct === null ? NA : '<span class="wp-bar" style="width:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%"></span>' + fmtPct(pct, 0)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderCommunity(m) {
    var C = m.community;
    if (!C) {
      return '<h2 id="community">Who lives here and what housing exists</h2><p>The Census profile for this jurisdiction is not on file, so the community profile is not available. The need section below uses the statewide index instead.</p>';
    }
    var p = C.people, st = C.stock;
    var h = '<h2 id="community">Who lives here</h2><table><tbody>' +
      row2('People', fmtInt(p.population)) +
      row2('Households; average size', fmtInt(p.households) + '; ' + (p.householdSize === null ? NA : p.householdSize.toFixed(1))) +
      row2('Under 18; 65 and over', fmtPct(p.under18Pct, 0) + '; ' + fmtPct(p.over65Pct, 0)) +
      row2('Households with children; with someone 65+', fmtPct(p.withChildrenPct, 0) + '; ' + fmtPct(p.withSeniorPct, 0)) +
      row2('Hispanic or Latino; non-Hispanic white', fmtPct(p.hispanicPct, 0) + '; ' + fmtPct(p.nhWhitePct, 0)) +
      row2('Median household income', fmtMoney(p.medianIncome)) +
      row2('In the labor force; unemployed', fmtInt(p.laborForce) + '; ' + fmtPct(p.unemploymentPct)) +
      row2('Workers who work from home; walk, bike or ride transit', fmtPct(p.workFromHomePct, 0) + '; ' + fmtPct(p.transitWalkBikePct, 0)) +
      '</tbody></table>' +
      binTable('Household income', 'Income', p.income) +
      srcLine(C.source + ', ' + C.vintage);
    h += '<h2 id="stock">What housing exists</h2><table><tbody>' +
      row2('Homes; occupied; vacant', fmtInt(st.units) + '; ' + fmtInt(st.occupied) + '; ' + fmtInt(st.vacant) + (st.vacantPct === null ? '' : ' (' + fmtPct(st.vacantPct) + ', including seasonal homes)')) +
      row2('Rental vacancy rate', fmtPct(st.rentalVacancyPct) + (st.rentalVacancyPct === 0 ? ' <span class="wp-meta">(the published Census estimate; in a small sample it often means no vacant rental was surveyed, not that none exists)</span>' : '')) +
      row2('Owner-occupied; renter-occupied', fmtPct(st.ownerPct, 0) + '; ' + fmtPct(st.renterPct, 0)) +
      row2('Median gross rent', fmtMoney(st.medianRent)) +
      row2('Median home value', st.homeValue ? fmtMoney(st.homeValue.value) + ' <span class="wp-meta">(' + esc(st.homeValue.label) + (st.acsHomeValue !== null && st.acsHomeValue !== st.homeValue.value ? '; owners\' own Census estimate ' + fmtMoney(st.acsHomeValue) : '') + ')</span>' : NA) +
      '</tbody></table>' +
      binTable('Type of building', 'Building', st.structure) +
      binTable('Year built', 'Built', st.built) +
      binTable('Bedrooms', 'Bedrooms', st.bedrooms) +
      binTable('Rent as a share of household income (renters)', 'Share of income', st.rentShare, true) +
      srcLine(C.source + ', ' + C.vintage);
    return h;
  }

  function renderNeed(m) {
    var n = m.need;
    // Population, income, rent, home value and tenure are in the community profile when it is on file.
    var basics = m.community ? '' :
      row2('Population', fmtInt(n.population)) +
      row2('Median household income', fmtMoney(n.medianIncome)) +
      row2('Median gross rent', fmtMoney(n.medianRent)) +
      row2('Median home value', fmtMoney(n.medianHomeValue)) +
      row2('Renter share of households', fmtPct(n.renterSharePct));
    var h = '<h2 id="need">Housing need</h2><table><tbody>' + basics +
      row2('Rental vacancy, homes actually on the market (excludes seasonal and held-off homes)', fmtPct(n.vacancyPct)) +
      row2('Renters cost-burdened (30%+ of income)', fmtPct(n.costBurdenedPct)) +
      row2('Renters severely burdened (50%+)', fmtPct(n.severeBurdenedPct)) +
      row2('Rental homes short at or below 30% / 50% / 60% AMI (each counts everyone below it)', fmtInt(n.gap30) + ' / ' + fmtInt(n.gap50) + ' / ' + fmtInt(n.gap60)) +
      row2('Low-wage local jobs; workers commuting in', fmtInt(n.lowWageJobs) + '; ' + fmtInt(n.inCommuters)) +
      // Below zero is a surplus where projected households fall, said in words.
      row2('Homes needed over 20 years', n.need20yr !== null && n.need20yr < 0
        ? 'Surplus of ' + fmtInt(Math.abs(n.need20yr)) + ' (households projected to fall)' : fmtInt(n.need20yr)) +
      row2('Overall need score (0–100); statewide percentile', (n.overallNeedScore === null ? NA : n.overallNeedScore.toFixed(1)) + '; ' + (n.percentileRank === null ? NA : 'p' + Math.round(n.percentileRank))) +
      row2('Statewide rank', n.rank === null ? NA : '#' + fmtInt(n.rank) + (n.ranked ? ' of ' + fmtInt(n.ranked) : '')) +
      '</tbody></table>' +
      '<p class="wp-meta">' + (n.scoreMethod ? 'How the score is built: ' + esc(n.scoreMethod) + ' ' : '') + 'It compares places with each other; it is not a funding award score and does not replace a local housing needs assessment.</p>' +
      srcLine(n.rankingSource + ' (ACS 2020–2024, CHAS, LEHD LODES, DOLA projections)');
    if (n.bands.length) {
      h += '<h3>Renter households by income</h3><div class="wp-scroll"><table><thead><tr><th>Income band</th><th>Renter households</th><th>Cost-burdened</th><th>Severely burdened</th></tr></thead><tbody>' +
        n.bands.map(function (b) { return '<tr><td>' + esc(b.label) + '</td><td class="n">' + fmtInt(b.households) + '</td><td class="n">' + fmtPct(b.burdenedPct, 0) + '</td><td class="n">' + fmtPct(b.severePct, 0) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + srcLine(n.chasSource + ', 2018–2022');
    } else {
      h += '<p>Renter households by income band are not available at this geography.</p>';
    }
    return h;
  }

  function renderRents(m) {
    var r = m.rents;
    var rows = ['30', '40', '50', '60', '70', '80'].filter(function (t) { return r.tiers[t]; }).map(function (t) {
      var x = r.tiers[t];
      return '<tr><td>' + t + '% AMI</td><td class="n">' + fmtMoney(x.rent2br) + '</td><td class="n">' + fmtMoney(x.income1p) + '</td><td class="n">' + fmtMoney(x.income4p) + '</td></tr>';
    }).join('');
    var mk = m.market || [];
    var market = mk.length ? '<h3>Market rent by source</h3><div class="wp-scroll"><table><thead><tr><th>Source</th><th>Area</th><th>Studio</th><th>1BR</th><th>2BR</th><th>3BR</th><th>All units</th><th>Year over year</th></tr></thead><tbody>' +
      mk.map(function (x) {
        function c(v) { return '<td class="n">' + (v === null || v === undefined ? NA : fmtMoney(v)) + '</td>'; }
        return '<tr><td>' + link(x.source, x.url) + (x.asOf ? '<br><span class="wp-meta">' + esc(x.asOf) + '</span>' : '') + '</td><td>' + esc(x.scope || '') + '</td>' +
          c(x.studio) + c(x.br1) + c(x.br2) + c(x.br3) + c(x.all) + '<td class="n">' + (x.yoy === null || x.yoy === undefined ? NA : (x.yoy >= 0 ? '+' : '') + x.yoy.toFixed(1) + '%') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="wp-meta">Each source measures something different: ACS is what renters paid over five years, Zillow and Apartment List are asking rents for recent listings, and HUD\'s fair market rent is the 40th percentile used for vouchers. "Not available" means that source does not publish the figure.</p>' + srcLine([sourcePath('acsRent'), sourcePath('zori'), sourcePath('apartmentList'), sourcePath('fmr')])
      : '<p>No market rent source covers this area.</p>';
    return '<h2 id="rents">Rents and income limits</h2>' + market +
      (rows ? '<div class="wp-scroll"><table><thead><tr><th>Tier</th><th>2BR max gross rent</th><th>Income limit, 1 person</th><th>Income limit, 4 people</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p>CHFA limits not available for this county.</p>') +
      srcLine(r.limitsSource) +
      '<table><tbody>' + row2('HUD fair market rent, 2BR' + (r.fmrYear ? ' (FY' + r.fmrYear + ')' : ''), fmtMoney(r.fmr2br)) + row2('Median gross rent (ACS 2020–2024)', fmtMoney(r.medianRent)) +
      row2('CHFA rural resort county', r.ruralResort === null ? NA : r.ruralResort ? 'Yes (Prop 123 tiers to 160% AMI apply)' : 'No') + '</tbody></table>' + srcLine(r.fmrSource);
  }

  function mixCells(mix) {
    return mix.map(function (v) { return '<td class="n">' + (v === null ? '' : fmtInt(v)) + '</td>'; }).join('');
  }

  function renderLihtc(m) {
    var L = m.lihtc;
    var h = '<h2 id="lihtc">Tax-credit history</h2><p class="wp-meta">Scope: ' + esc(L.scopeLabel) + '</p>';
    if (L.properties.length) {
      h += '<h3>Properties</h3><div class="wp-scroll"><table><thead><tr><th>Project</th><th>Town</th><th>Award</th><th>Credit</th><th>Units</th><th>30%</th><th>40%</th><th>50%</th><th>60%</th><th>70%</th><th>80%</th></tr></thead><tbody>' +
        L.properties.map(function (p) {
          return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.city) + '</td><td>' + (p.awardYear || '') + '</td><td>' + esc(p.credit || '') + '</td><td class="n">' + fmtInt(p.units) + '</td>' + mixCells(p.mix) + '</tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      h += '<p>No CHFA tax-credit property is recorded here.</p>';
    }
    if (L.awards.length) {
      h += '<h3>Awards on record</h3><div class="wp-scroll"><table><thead><tr><th>Year</th><th>Agency and program</th><th>Project</th><th>Units</th><th>Amount</th></tr></thead><tbody>' +
        L.awards.map(function (a) {
          var amt = a.federal_credit != null ? fmtMoney(a.federal_credit) + ' annual federal credit' : a.amount_awarded != null ? fmtMoney(a.amount_awarded) : NA;
          return '<tr><td>' + esc(a.year) + '</td><td>' + esc(a.agency + ' · ' + a.program) + '</td><td>' + link(a.name || 'Name withheld', a.source_url) + '</td><td class="n">' + fmtInt(a.total_units != null ? a.total_units : a.restricted_units) + '</td><td>' + amt + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (L.applicationsMissing) {
      h += '<p class="wp-note">The list of everyone who applied for credits here (funded or not) is not in this copy of the data yet.</p>';
    } else if (L.applications.length) {
      var OUT = { awarded: 'Awarded', not_awarded: 'Not funded that round', pending: 'Decision pending', in_review: 'Under review', letter_of_intent: 'Letter of intent only', unclear: 'Unclear', unresolved: 'Unresolved' };
      h += '<h3>Who has applied (CHFA applicant reports)</h3><div class="wp-scroll"><table><thead><tr><th>Round</th><th>Project</th><th>Sponsor</th><th>Credit</th><th>Units</th><th>Outcome</th></tr></thead><tbody>' +
        L.applications.map(function (a) {
          return '<tr><td>' + esc(a.round_label || a.year) + '</td><td>' + link(a.name || 'Name withheld', a.source_url) + '</td><td>' + esc(a.sponsor || '') + '</td><td>' + esc(a.credit_type || '') + '</td><td class="n">' + fmtInt(a.total_units) + '</td><td>' + esc(OUT[a.outcome] || a.outcome || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      h += '<p>No CHFA tax-credit application since 2023 names this ' + (m.kind === 'county' ? 'county' : 'place') + '.</p>';
    }
    h += srcLine(L.sources);
    var I = m.inventory;
    if (I) {
      h += '<h3>All affordable housing on record</h3>';
      if (I.properties.length) {
        var shown = I.properties.slice(0, 40);
        h += '<p>' + I.properties.length + ' ' + (I.properties.length === 1 ? 'property' : 'properties') + (I.totalUnits !== null ? ', ' + fmtInt(I.totalUnits) + ' units in total' : '') + ', counting tax-credit, HUD, USDA and local voucher housing.</p>' +
          '<div class="wp-scroll"><table><thead><tr><th>Property</th><th>Town</th><th>Programs</th><th>Units</th><th>Award or opening year</th></tr></thead><tbody>' +
          shown.map(function (p) {
            return '<tr><td>' + esc(p.name) + (p.risk ? ' <span class="wp-tag">' + esc(p.risk) + '</span>' : '') + '</td><td>' + esc(p.city || '') + '</td><td>' + esc(p.programs) + '</td><td class="n">' + (p.units === null ? NA : fmtInt(p.units)) + '</td><td>' + (p.year || NA) + '</td></tr>';
          }).join('') + '</tbody></table></div>' + (I.properties.length > shown.length ? '<p class="wp-meta">' + (I.properties.length - shown.length) + ' more not shown.</p>' : '');
      } else {
        h += '<p>No assisted or tax-credit property is on record here.</p>';
      }
      h += srcLine(I.source);
    }
    return h;
  }

  function renderProp123(m) {
    var P = m.prop123;
    function one(r, label) {
      if (!r) return '<p>' + esc(label) + ': no Prop 123 commitment on file.</p>';
      return '<h3>' + esc(r.name) + '</h3><table><tbody>' +
        row2('Status', esc(r.status || NA)) + row2('Filed', esc(r.filing_date || NA)) +
        row2('Commitment', esc((r.required_commitment || '') + (r.commitment_length ? ' (' + r.commitment_length + ')' : ''))) +
        row2('Units promised over the cycle', fmtInt(r.proposed_units)) +
        row2('Fast-track approvals', r.fast_track ? 'Adopted' + (r.fast_track_adopted ? ' ' + esc(r.fast_track_adopted) : '') + (r.fast_track_instrument ? ' (' + esc(r.fast_track_instrument) + ')' : '') : 'Not adopted') +
        '</tbody></table>';
    }
    return '<h2 id="prop123">Proposition 123 standing</h2>' + one(P.record, m.name) + (m.kind !== 'county' ? one(P.countyRecord, m.countyName) : '') +
      '<p>A jurisdiction that promised units has to show them; a tax-credit project counts toward the promise, which makes it the natural first topic with staff.</p>' +
      srcLine(P.source + (P.updated ? ', updated ' + P.updated : '')) + renderLandBanking(P.landBanking, m);
  }

  function renderLandBanking(LB, m) {
    if (!LB) return '';
    var h = '<h3 id="land-banking">Prop 123 land banking awards here</h3>';
    if (!LB.awards.length) {
      return h + '<p>No Prop 123 Land Banking award names ' + (m.kind === 'county' ? 'a town in this county' : 'this place') +
        '.' + (LB.programUrl ? ' ' + link('CHFA\'s land banking program page', LB.programUrl) + ' lists every round.' : '') + '</p>';
    }
    function contactCell(c) {
      if (!c) return LB.contactsMissing ? 'Contacts not in this copy of the data' : 'Not yet researched';
      var bits = [c.name ? '<strong>' + esc(c.name) + '</strong>' : null, c.role ? esc(c.role) : null,
        c.phone ? esc(c.phone) : null, c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : null].filter(Boolean);
      var toConfirm = (c.status && c.status !== 'found') || c.confirmed === false ? ' <span class="wp-tag">to confirm</span>' : '';
      var note = c.note ? '<br><span class="wp-meta">' + esc(c.note) + '</span>' : '';
      return bits.join('<br>') + toConfirm +
        (c.source_url ? '<br>' + link('(' + (c.source_label || 'source') + (c.checked ? ', checked ' + c.checked : '') + ')', c.source_url) : '') + note;
    }
    h += '<div class="wp-scroll"><table><thead><tr><th>Round</th><th>Project</th><th>Received by</th><th>Homes planned</th><th>Awarded</th><th>Est. homes</th><th>Contact</th></tr></thead><tbody>' +
      LB.awards.map(function (a) {
        return '<tr><td>' + esc(a.round) + '</td><td>' + link(a.project, a.sourceUrl) + '</td><td>' + esc(a.sponsor) + '</td><td>' + esc(a.purpose || '') +
          '</td><td class="n">' + fmtMoney(a.amount) + '</td><td class="n">' + fmtInt(a.units) + '</td><td>' + contactCell(a.contact) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var pc = LB.programContact;
    h += '<p class="wp-meta">Land banking buys sites for later: each grantee must have the land zoned with a development plan within five years, and the homes permitted and funded within ten, so these are the organisations to ask what comes next.' +
      (pc && pc.email ? ' Program questions: ' + esc(pc.org || 'CHFA') + ', <a href="mailto:' + esc(pc.email) + '">' + esc(pc.email) + '</a>.' : '') + '</p>';
    return h + srcLine(LB.source);
  }

  function renderPolicy(m) {
    var P = m.policy;
    var h = '<h2 id="policy">Local funds, fee relief and support</h2>';
    if (P.funds.length) {
      h += '<h3>Local funds and dedicated revenue</h3><ul>' + P.funds.map(function (f) {
        return '<li><strong>' + esc(f.jurisdiction) + ':</strong> ' + esc(f.summary || f.rate_text || '') + ' ' + (f.source ? link('(' + (f.source.label || 'source') + ')', f.source.url) : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (P.fees.length || P.landUse.length) {
      h += '<h3>Fee relief and land-use tools</h3><ul>' + P.fees.concat(P.landUse).map(function (f) {
        var src = f.source || (f.evidence && f.evidence[0]) || null;
        return '<li><strong>' + esc(f.jurisdiction) + ':</strong> ' + esc(f.summary || f.detail || f.value_basis || '') + (src ? ' ' + link('(' + (src.label || src.section || 'source') + ')', src.url) : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (P.support && Array.isArray(P.support.items) && P.support.items.length) {
      h += '<h3>Adopted plans and council record</h3><ul>' + P.support.items.map(function (i) {
        return '<li>' + esc(i.date || '') + ' · ' + esc(i.body || '') + ': ' + esc(i.title || '') + (i.outcome ? ' (' + esc(i.outcome) + ')' : '') + '</li>';
      }).join('') + '</ul><p class="wp-meta">Checked ' + esc(P.support.checked || NA) + '.</p>';
    }
    if (!P.funds.length && !P.fees.length && !P.landUse.length && !P.support) h += '<p>No local fund, fee relief or council record has been researched for this jurisdiction yet.</p>';
    h += srcLine(P.sources);
    var C = m.civic;
    if (C && (C.markers.length || C.progress)) {
      h += '<h3>Housing-policy markers</h3>';
      if (C.markers.length) {
        h += '<p>' + (C.total === null ? NA : C.total) + ' of ' + (C.max === null ? NA : C.max) + ' markers present; ' + (C.known === null ? NA : C.known) + ' assessed. A marker not assessed is unknown, not absent.</p><table><tbody>' +
          C.markers.map(function (k) { return row2(k.label, k.value === true ? 'Yes' : k.value === false ? 'No' : 'Not assessed'); }).join('') + '</tbody></table>';
      }
      var G = C.progress;
      if (G) {
        var PL = { hna: 'Housing needs assessment', land_banking: 'Land banking', dedicated_income: 'Dedicated local revenue', tap_fee_reduction: 'Fee relief' };
        h += '<table><tbody>' + Object.keys(PL).filter(function (k) { return G[k]; }).map(function (k) {
          var g = G[k];
          var text = esc(String(g.status || '').replace(/_/g, ' ')) + (g.year ? ' (' + esc(g.year) + ')' : '') + [g.name, g.source, g.note, g.details].filter(Boolean).map(function (t) { return '. ' + esc(t); }).join('');
          return row2(PL[k], g.url ? text + ' ' + link('(source)', g.url) : text);
        }).join('') + '</tbody></table>';
      }
      h += srcLine(C.sources);
    }
    return h;
  }

  function renderFunding(m) {
    var F = m.funding;
    var awards = F.awardsHref ? '<p>What CHFA, OEDIT and DOLA have already awarded in this county, and to which developers: <a href="' + esc(F.awardsHref) + '">Where Colorado\'s Housing Money Goes</a>.</p>' : '';
    if (!F.programs) return '<h2 id="funding">Funding that fits</h2><p>The funding guide was not available.</p>' + awards + srcLine(F.source);
    function list(ex) {
      var ps = F.programs[ex] || [];
      return '<h3>' + esc(ex) + ' new construction: ' + ps.length + ' program' + (ps.length === 1 ? '' : 's') + ' taking applications or with a published round</h3><ul>' +
        ps.map(function (p) { return '<li>' + link(p.name, p.url) + ' <span class="wp-meta">(' + esc(p.administrator) + (p.availability === 'scheduled' ? '; next round published' : '') + ')</span>' + (p.notes.length ? ' <span class="wp-meta">' + esc(p.notes.join(' ')) + '</span>' : '') + '</li>'; }).join('') + '</ul>';
    }
    return '<h2 id="funding">Funding that fits</h2><p>Screened for eligibility from each program\'s own terms; not ranked and not an award prediction.</p>' +
      list('9%') + list('4%') + awards + srcLine(F.source + (F.asOf ? ', checked ' + F.asOf : ''));
  }

  function renderDeal(m) {
    var d = m.deal;
    var h = '<h2 id="deal">Ideal deal: structure and timing</h2><p><strong>Credit route:</strong> ' + esc(d.route) + '</p>';
    var tl = timingLine(d, true);
    if (tl) h += '<p>' + tl + '</p>';
    if (d.mix) {
      h += '<table><thead><tr><th>Income band</th><th>Rental homes short</th></tr></thead><tbody>' +
        '<tr><td>At or below 30% AMI</td><td class="n">' + fmtInt(d.mix.le30) + '</td></tr>' +
        '<tr><td>At or below 50% AMI</td><td class="n">' + fmtInt(d.mix.le50) + '</td></tr>' +
        '<tr><td>At or below 60% AMI</td><td class="n">' + fmtInt(d.mix.le60) + '</td></tr></tbody></table>' +
        '<p class="wp-meta">Each row is renter households at or below that income minus the rental homes priced for them, so the rows overlap and do not add up. A lower 60% figure means the cheaper homes are missing, not the 60% ones. A minimum: a home priced for a band may be rented by a higher-income household.</p>';
    }
    if (d.burden) {
      h += '<table><thead><tr><th>Renters by income band</th><th>Households</th><th>Paying over 30% of income</th></tr></thead><tbody>' +
        Object.keys(d.burden).map(function (k) { var b = d.burden[k]; return '<tr><td>' + esc(b.label) + '</td><td class="n">' + fmtInt(b.households) + '</td><td class="n">' + fmtInt(b.burdened) + ' (' + fmtPct(b.pct, 0) + ')</td></tr>'; }).join('') +
        '</tbody></table><p class="wp-meta">HUD CHAS cost burden by band. These are the renters a band\'s units would serve, whether or not homes priced for them are counted as short.</p>';
    }
    h += '<ul>' + d.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    if (d.pencil && d.pencil.ok) {
      h += '<h3>Does each rent level pay its way?</h3><table><thead><tr><th>Units at</th><th>Rent (2BR limit)</th><th>Net per unit, year 1</th><th>Net per unit, year 15</th><th>Yearly debt service it can carry</th><th>Operating cost it can bear</th></tr></thead><tbody>' +
        d.pencil.tiers.map(function (t) {
          return '<tr><td>' + esc(t.tier) + '% AMI</td><td class="n">' + fmtMoney(t.rent) + '</td><td class="n">' + signedMoney(t.noi1) + '</td><td class="n">' + signedMoney(t.noi15) + '</td><td class="n">' +
            (t.firstShortYear ? 'None: short from year ' + t.firstShortYear : signedMoney(t.debtServiceCapacity)) + '</td><td class="n">' + fmtMoney(t.breakevenCost) + '</td></tr>';
        }).join('') + '</tbody></table><p class="wp-meta">' + esc(d.pencil.assumptionsText) +
        ' Net is rent after vacancy less operating cost and reserve. Debt service is what the weakest of the 15 years can carry at the minimum coverage; a deeper mix carries less debt, so its funding gap is larger. Operating cost it can bear is the most a unit at that rent can spend on operations each year (before the reserve, in year-1 dollars) and still break even through year 15; mountain and small-town budgets often run above CHFA\'s minimum, so compare it with the real budget.</p>';
    } else if (d.pencil && d.pencil.reason) {
      h += '<p class="wp-note">Whether each rent level pays its way is not shown: ' + esc(d.pencil.reason) + '</p>';
    }
    h += renderStructure(d.structure) + renderTiming(d.timing);
    h += '<p class="wp-note">This is the deal\'s shape from the data, not a pro forma. Size the dollars in the ' +
      link('Deal Calculator for ' + m.name, 'https://cohoanalytics.com/deal-calculator.html?geoid=' + encodeURIComponent(m.geoid)) +
      ' and confirm achievable rents with a CHFA market study.</p>';
    return h + srcLine(['Rules in js/whitepaper/jurisdiction-whitepaper.js (dealShape, dealStructure, dealTiming), applied to the need, rent, tax-credit and funding sections']
      .concat(d.structure ? [d.structure.source] : []).concat(d.timing ? d.timing.sources : []));
  }

  // Where both credits are viable, the rolling 4% bond path is as early as any round,
  // so the dated base case is named as the round's, not the deal's only start.
  function rollingOpen(d) {
    return !!(d && d.timing && d.timing.rolling4 && /^9% or 4%/.test(d.route || ''));
  }

  // The timing headline for the summary and the deal section. A dated base case, a
  // stretch round when no base is left, and the rolling 4% path each show on their own,
  // so a report built late in a cycle still says when a deal can start.
  function timingLine(d, full) {
    var t = d && d.timing;
    if (!t) return '';
    var base = timingPick(t, 'base'), stretch = timingPick(t, 'stretch');
    var parts = [];
    if (base) {
      parts.push(full
        ? '<strong>Base case' + (rollingOpen(d) ? ' for a CHFA round' : '') + ':</strong> ' + esc(base.label) + ', letter of intent ' + esc(base.loi) + ', application ' + esc(base.deadline) + ' (estimate).' +
          (stretch ? ' <strong>Stretch:</strong> ' + esc(stretch.label) + ', letter of intent ' + esc(stretch.loi) + ', only if the conditions under Timing are met.' : '')
        : (rollingOpen(d) ? 'for a CHFA round, ' : '') + 'base case ' + esc(base.label) + ', application ' + esc(base.deadline) + (stretch ? '; ' + esc(stretch.label) + ' only as a stretch' : '') + ' (estimate).');
    } else if (stretch) {
      parts.push(full
        ? '<strong>No CHFA round is far enough out for a base case.</strong> <strong>Stretch:</strong> ' + esc(stretch.label) + ', letter of intent ' + esc(stretch.loi) + ', only if the conditions under Timing are met (estimate).'
        : 'no CHFA round is far enough out for a base case; ' + esc(stretch.label) + ' only as a stretch (estimate).');
    }
    // A 4% base round is the 4% route, which has the rolling path too.
    if (t.rolling4 && (rollingOpen(d) || !base || base.credit === '4%')) {
      var r4 = t.rolling4, rl = link(r4.name, r4.url);
      if (r4.closedNow) {
        var when = r4.reopens ? 'preliminary applications reopen ' + esc(r4.reopens) : 'preliminary applications are closed this month';
        parts.push(full
          ? '<strong>4% bonds without state credit:</strong> ' + rl + ' has no round, but CHFA takes no preliminary applications this month; ' + when + '.'
          : (parts.length ? 'A 4% bond deal without state credit waits only for its window: ' : '4% bonds without state credit: ') + rl + ' has no round; ' + when + '.');
      } else {
        parts.push(full
          ? '<strong>4% bonds without state credit:</strong> ' + rl + ' has no round, so this route need not wait for one.'
          : (parts.length ? 'A 4% bond deal without state credit need not wait: ' : '4% bonds without state credit: ') + rl + ' has no round.');
      }
    }
    return parts.join(' ');
  }

  function timingPick(t, reading) {
    if (!t) return null;
    return t.rows.filter(function (r) { return r.reading === reading; })[0] || null;
  }

  function qapCite(ref) {
    if (!ref) return '';
    return 'QAP ' + (ref.section ? esc(ref.section) + ', ' : '') + (ref.page ? 'p. ' + esc(ref.page) : '') + ': “' + esc(ref.quote) + '”';
  }

  function renderStructure(S) {
    if (!S || !S.lines.length) return '';
    return '<h3>Scoring points this place supports</h3>' +
      '<table><thead><tr><th>Points</th><th>Scoring line</th><th>Reading</th><th>Why here</th></tr></thead><tbody>' +
      S.lines.map(function (l) {
        return '<tr><td class="n">' + esc(l.points) + (l.exclusiveWith ? ' <span class="wp-meta">(either/or)</span>' : '') + '</td><td>' + esc(l.label) + '<br><span class="wp-meta">' + qapCite(l) + '</span></td><td>' +
          (l.reading === 'likely' ? 'Likely' : l.reading === 'check' ? 'To confirm' : 'Option a deal can choose') + '</td><td>' + esc(l.text) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="wp-meta">From the ' + link(S.title || 'CHFA QAP', S.url) + (S.draft ? ', a draft that may change before CHFA adopts it' : '') +
      '. "Likely" means the data here meets the line; "to confirm" means it may, pending a fact the data does not hold; "option" means a deal team can earn it by how it structures the deal. Points not listed may still be earned; they depend on the site.</p>';
  }

  function renderTiming(T) {
    if (!T) return '';
    var h = '<h3>Timing</h3>';
    var land = T.landBanking && T.landBanking.cycle
      ? '<p><strong>Land:</strong> ' + link('Prop 123 Land Banking', T.landBanking.url) + ' can hold a site until the round. ' + esc(T.landBanking.cycle) +
        (T.landBanking.applicants ? ' Who can apply: ' + esc(T.landBanking.applicants) : '') + '</p>'
      : '';
    if (!T.rows.length) {
      return h + '<p>No fixed CHFA round is open on the calendar. <strong>4% with bonds:</strong> ' + link(T.rolling4.name, T.rolling4.url) + ' has no round: ' + esc(T.rolling4.description) + '</p>' + land;
    }
    h += '<table><thead><tr><th>Round</th><th>Letter of intent</th><th>Application</th><th>Awards</th><th>Reading</th></tr></thead><tbody>' +
      T.rows.map(function (r) {
        var reading = r.reading === 'base' ? '<strong>Base case</strong>' : r.reading === 'stretch' ? 'Stretch: ' + r.daysToLoi + ' days to the letter of intent' : 'Not realistic: letter of intent in ' + r.daysToLoi + ' days';
        return '<tr><td>' + link(r.label, r.url) + (r.draft ? ' <span class="wp-tag">draft QAP</span>' : '') + '</td><td>' + esc(r.loi) + '</td><td>' + esc(r.deadline) + '</td><td>' +
          (r.awards ? esc(r.awards) + (r.awardsEstimated ? ' (est.)' : '') : NA) + '</td><td>' + reading + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (T.rolling4 ? '<p><strong>4% without state credit:</strong> CHFA\'s 4% rounds are for a 4% deal that also seeks state credit. ' + link(T.rolling4.name, T.rolling4.url) + ' alone has no round: ' + esc(T.rolling4.description) + '</p>' : '') +
      '<p class="wp-meta">Estimate: a round is the base case when its letter of intent is at least ' + T.leadDays + ' days away, the time a team usually needs to tie up a site, confirm zoning and line up partners; nearer than ' + T.stretchMinDays + ' days it is not realistic.</p>';
    var stretch = timingPick(T, 'stretch');
    if (stretch) {
      h += '<p><strong>The stretch round needs, before its letter of intent on ' + esc(stretch.loi) + ':</strong></p><ul>' +
        '<li>A site under an executed purchase agreement or option. A letter of intent to buy is not site control for CHFA.</li>' +
        '<li>Zoning confirmed, so the planning department can issue its status letter before ' + esc(stretch.deadline) + '.</li>' +
        '<li>The general partner or co-sponsor committed, if the deal counts on nonprofit or housing authority points.</li>' +
        '<li>The local contribution and public hearing scheduled on a Board agenda before ' + esc(stretch.deadline) + '.</li>' +
        '<li>Phase I environmental and market study ordered now.</li></ul><p class="wp-meta">If any of these is not in hand, ' +
        // With no base round left, the fallback is the rolling 4% path or a round not yet published.
        (timingPick(T, 'base') ? 'plan on the base case.'
          : T.rolling4 ? 'plan on ' + link(T.rolling4.name, T.rolling4.url) + ' (4% bonds without state credit) or the next CHFA round once it is published.'
          : 'plan on the next CHFA round once it is published.') + '</p>';
    }
    var base = timingPick(T, 'base');
    var target = base || stretch;
    if (target && target.milestones) {
      h += '<h3>What has to be ready for ' + esc(target.label) + '</h3><table><thead><tr><th>By</th><th>What</th><th>Where the QAP says so</th></tr></thead><tbody>' +
        target.milestones.map(function (x) {
          return '<tr><td>' + esc(x.by) + '</td><td>' + esc(x.what) + '</td><td class="wp-meta">' + (x.ref ? 'Threshold ' + esc(x.ref.id.replace(/^T/, '')) + ', p. ' + esc(x.ref.page) + ': “' + esc(x.ref.quote) + '”' : 'CHFA calendar') + '</td></tr>';
        }).join('') + '</tbody></table>';
      if (T.scoringStatus) h += '<p class="wp-meta">Thresholds from the ' + link(T.scoringStatus.title || 'CHFA QAP', T.scoringStatus.url) + (T.scoringStatus.draft ? ' (draft, not adopted)' : '') + '.</p>';
    }
    return h + land;
  }

  function renderQuestions(m) {
    var Q = m.questions;
    // Named for the government actually asked: a CDP's questions go to its county.
    var gov = (Q && Q.gov && Q.gov.name) || (m.kind === 'cdp' ? m.countyName : m.name);
    var h = '<h2 id="questions">Questions for ' + esc(gov) + '</h2>';
    if (!Q || Q.missing) return h + '<p>The question bank loads on the gated developer site only.</p>';
    function who(q) {
      var c = q.contact;
      return '<span class="wp-meta">Ask: ' + esc(q.roleLabel) + (c ? ', ' + link(c.name, c.url) + (c.role ? ' (' + esc(c.role) + ')' : '') : '') + '</span>';
    }
    h += '<p>Standard questions are worth asking any local government before an application. Pointed questions come from this place\'s own data; each shows the figure that raised it.</p>';
    if (Q.pointed.length) {
      h += '<h3>Pointed questions for ' + esc(m.name) + '</h3><ol>' + Q.pointed.map(function (q) {
        return '<li><strong>' + esc(q.ask) + '</strong><br>' + who(q) + '<br><span class="wp-meta">Raised by: ' + esc(q.evidence) + (q.why ? ' Why it matters: ' + esc(q.why) : '') + ' Source: ' + esc(q.source) + '.</span></li>';
      }).join('') + '</ol>';
      if (Q.firedNotShown) h += '<p class="wp-meta">' + Q.firedNotShown + ' more pointed question' + (Q.firedNotShown === 1 ? '' : 's') + ' left out to keep the list short.</p>';
    } else {
      h += '<p>No pointed questions: none of the data signals is raised here.</p>';
    }
    h += '<h3>Standard questions</h3><ol>' + Q.standard.map(function (q) {
      return '<li><strong>' + esc(q.ask) + '</strong><br>' + who(q) + (q.why || q.qap ? '<br><span class="wp-meta">' + (q.why ? 'Why: ' + esc(q.why) + (q.qap ? ' ' : '') : '') + (q.qap ? qapCite(q.qap) + (q.qap.draft ? ' (draft QAP)' : '') : '') + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
    return h + srcLine(['Question bank checked ' + (Q.bankChecked || NA) + '; signals in js/whitepaper/town-questions.js, applied to the sections above']);
  }

  function renderLandscape(m) {
    var L = m.landscape;
    var h = '<h2 id="landscape">Local landscape: who is already working on housing here</h2>';
    if (L.authorities.length) {
      h += '<h3>Housing authorities with programs here</h3><ul>' + L.authorities.map(function (a) {
        return '<li>' + link(a.name, a.url) + (a.area ? ' <span class="wp-meta">(' + esc(a.area) + ')</span>' : '') + (a.inventory ? ': ' + esc(a.inventory) : '') + '</li>';
      }).join('') + '</ul>';
    }
    var money = m.dynamics.localMoney;
    if (money.length) {
      h += '<h3>Recent state awards in this area</h3><ul>' + money.map(function (w) {
        return '<li>' + esc(w.year) + ' · ' + esc(w.program) + ': ' + link(w.name || 'project', w.url) + (w.sponsor ? ', to ' + esc(w.sponsor) : '') + (w.amount !== null ? ', ' + fmtMoney(w.amount) : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (L.research) {
      var R = L.research;
      if (R.countyLevel) h += '<p class="wp-meta">Researched for ' + esc(L.countyName) + ' as a whole; nothing yet specific to ' + esc(m.name) + '.</p>';
      if (R.placeLevel) h += '<p class="wp-meta">Researched for ' + esc(R.placeLevel) + ', a town in this county; nothing yet for the county as a whole.</p>';
      R.groups.forEach(function (g) {
        if (!g.items.length) return;
        h += '<h3>' + esc(g.label) + '</h3><ul>' + g.items.map(function (e) { return '<li>' + landscapeItem(g.key, e) + '</li>'; }).join('') + '</ul>';
      });
      h += '<p class="wp-meta">Researched ' + esc(R.researched || NA) + ' from public sources; each finding above quotes its source. Confirm before relying on it.</p>';
      if (R.notFound.length) h += '<h3>Open questions</h3><p class="wp-meta">What the research looked for and could not find. These are gaps to ask about, not findings: a thing not found in public sources may still exist.</p><ul>' + R.notFound.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    }
    if (L.stewards.length) {
      h += '<h3>Regional nonprofits serving the county</h3><ul>' + L.stewards.map(function (p) {
        return '<li>' + link(p.name, p.url) + (p.roles ? ' <span class="wp-meta">(' + esc(p.roles) + ')</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (L.missing.length) {
      h += '<p class="wp-note">Not yet researched for ' + esc(m.name) + ': ' + esc(L.missing.join(', ').toLowerCase()) + '. The local funds section and the curated brief, where there is one, carry what is on file.</p>';
    }
    return h + srcLine(L.sources);
  }

  function landscapeItem(key, e) {
    var title, rest = [];
    if (key === 'plans') { title = e.title; rest = [e.year, e.body, e.finding]; }
    else if (key === 'agencies') { title = e.name; rest = [e.role, e.funding, e.recent_activity, e.how_to_work_with]; }
    else if (key === 'state_funds') { title = e.program; rest = [e.recipient, e.amount, e.date, e.purpose]; }
    else if (key === 'task_forces') { title = e.name; rest = [e.members_public, e.activity]; }
    else if (key === 'people') { title = e.name; rest = [e.public_role, e.housing_involvement]; }
    else if (key === 'land') { title = e.name; rest = [e.acres != null ? e.acres + ' acres' : null, e.owner, e.status]; }
    else { title = e.name; rest = [e.units != null ? e.units + ' units' : null, e.status, e.year]; }
    rest = rest.filter(function (x) { return x !== null && x !== undefined && x !== ''; }).map(function (x) { return esc(x); });
    return '<strong>' + esc(title || '') + '</strong>' + (rest.length ? ': ' + rest.join('. ').replace(/\.\./g, '.') : '') +
      ' <span class="wp-meta">' + link('source', e.source_url) + ': “' + esc(e.source_quote) + '”</span>';
  }

  function renderDynamics(m) {
    var D = m.dynamics;
    var h = '<h2 id="dynamics">How a tax-credit deal comes together here</h2>';
    h += '<h3>The capital stack</h3><ul>' +
      '<li><strong>Tax-credit equity</strong> is the largest source. Investors paid about ' + (D.equity9 !== null ? '$' + D.equity9.toFixed(2) : NA) + ' per dollar of 9% credit and ' + (D.equity4 !== null ? '$' + D.equity4.toFixed(2) : NA) + ' for 4% (national average)' + (D.equityRegion !== null ? '; Novogradac\'s median for its North Central region, which includes Colorado, was $' + D.equityRegion.toFixed(2) : '') + '.</li>' +
      '<li><strong>Eligible basis</strong> sets the credit. A site in a QCT or DDA gets a ' + (D.basisBoostPct !== null ? fmtPct(D.basisBoostPct, 0) : NA) + ' boost' + (D.boostHere ? ', and part of this area qualifies (see Ideal deal: structure and timing)' : '; none of this area is designated, so plan without it') + '.</li>' +
      '<li><strong>Permanent debt</strong> is sized to the rents under Rents and income limits; deep 30% units carry little debt, which is why they need rental subsidy or more soft money.</li>' +
      '<li><strong>Soft money</strong> closes the gap: state programs (Funding that fits), local funds and fee relief, and land at low or no cost.' + (D.localMoney.length ? ' This area already has recent state awards, listed in the landscape section.' : '') + '</li>' +
      '<li><strong>Screening costs:</strong> ' + fmtMoney(D.hardCost) + ' hard cost per family unit' + (D.hardCostSource ? ' (' + esc(D.hardCostSource) + ')' : '') + ', soft costs ' + fmtPct(D.softCostPct, 0) + ' of hard, developer fee ' + fmtPct(D.devFeePct, 0) + '. Replace them with your own bids.</li></ul>';
    h += '<h3>The two credit routes</h3><ul>' +
      '<li><strong>9% (competitive):</strong> letter of intent, then a scored CHFA application (see Next CHFA dates). Over ten years the credits are worth about 70% of qualified basis in present value, so the gap is small but the competition is hard.</li>' +
      '<li><strong>4% with tax-exempt bonds:</strong> not competitive for credits, but it needs private activity bond cap. Most Colorado 4% deals draw it from CHFA\'s statewide pool' + (D.pabStatewidePool !== null ? ' (' + fmtMoney(D.pabStatewidePool) + ' in ' + esc(D.pabYear || '') + ')' : '') + '. ' +
      (D.pab.length ? D.pab.map(function (x) { return esc(x.name); }).join(' and ') + ' received an initial ' + esc(D.pabYear || '') + ' direct allocation of ' + D.pab.map(function (x) { return fmtMoney(x.amount); }).join(' and ') + ': a gross starting figure, not what is left, which may go to other bond uses or be ceded to CHFA. ' : 'No local direct allocation is recorded here. ') +
      'The credits are worth about 30% of qualified basis, so the gap is much larger.' +
      (D.pabSourceUrl ? ' ' + link('(DOLA private activity bond allocations)', D.pabSourceUrl) : ' <span class="wp-meta">(DOLA allocation page not on record)</span>') + '</li></ul>';
    h += '<h3>From award to occupancy</h3><ol>' +
      '<li>Site control, zoning and a CHFA market study before applying.</li>' +
      '<li>Local support: a council resolution, fee relief, land or a local loan, which also helps the jurisdiction count units toward its Prop 123 promise.</li>' +
      '<li><strong>9%:</strong> CHFA allocates credits after the round. A project not yet in service gets a carryover allocation, must have incurred more than 10% of its reasonably expected basis within 12 months of that allocation, and the building must be finished and in service by the end of the second calendar year after the allocation year.</li>' +
      '<li><strong>4%:</strong> the credits come with the tax-exempt bonds rather than a CHFA credit allocation, so the 9% carryover deadlines do not apply. The bonds must finance the required share of land and building, and CHFA still reviews the deal against its QAP.</li>' +
      '<li>Rents and incomes stay restricted through the compliance period and CHFA\'s extended use period.</li></ol>';
    return h + srcLine(D.sources);
  }

  function contactTable(list, checked) {
    return '<div class="wp-scroll"><table class="wp-stack"><thead><tr><th>Name</th><th>Role</th><th>Contact</th><th>Source</th></tr></thead><tbody>' +
      list.map(function (c) {
        var tel = String(c.phone || '').match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/);
        var how = [c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '',
          c.phone ? (tel ? '<a href="tel:' + esc(tel[0].replace(/\D/g, '')) + '">' + esc(c.phone) + '</a>' : esc(c.phone)) : ''].filter(Boolean).join('<br>');
        return '<tr><td data-label="Name"><strong>' + esc(c.name) + '</strong></td><td data-label="Role">' + esc(c.role || '') + (c.org ? '<br><span class="wp-meta">' + esc(c.org) + '</span>' : '') + '</td><td data-label="Contact">' + (how || NA) + '</td><td data-label="Source">' + link(c.source_label || 'source', c.source_url) + '<br><span class="wp-meta">“' + esc(c.source_quote) + '”</span></td></tr>';
      }).join('') + '</tbody></table></div><p class="wp-meta">Contacts checked ' + esc(checked || NA) + '. Staff change; confirm before reaching out.</p>';
  }

  function renderContacts(m) {
    var C = m.contacts;
    var h = '<h2 id="contacts">Who to contact</h2>';
    if (C.researched.length) {
      h += contactTable(C.researched, C.checked);
    } else if (C.related.length) {
      h += '<p class="wp-note">No contacts have been researched for ' + esc(m.name) + ' itself. These were researched for ' + (m.kind === 'county' ? 'a town in this county' : 'its county') + ' and are the nearest starting points.</p>';
    } else {
      h += '<p class="wp-note">No named contacts have been researched for this jurisdiction yet. The organisations below are the starting points.</p>';
    }
    (C.related || []).forEach(function (f) {
      h += '<h3>Researched for ' + esc(f.name) + '</h3>' + contactTable(f.contacts, f.checked);
    });
    if (C.orgs.length) {
      h += '<h3>Organisations</h3><ul>' + C.orgs.map(function (o) { return '<li>' + esc(o.role) + ': ' + link(o.name, o.url) + '</li>'; }).join('') + '</ul>';
    }
    if ((C.offices || []).length) {
      h += '<h3>Offices to reach</h3><ul>' + C.offices.map(function (o) {
        return '<li>' + link(o.name, o.url) + (o.jurisdiction && o.name.indexOf(o.jurisdiction) === -1 ? ' <span class="wp-meta">(' + esc(o.jurisdiction) + ')</span>' : '') +
          (o.url ? '' : ' <span class="wp-meta">no direct page on file; find the current holder on the jurisdiction\'s staff directory</span>') + '</li>';
      }).join('') + '</ul>';
    }
    if ((C.plans || []).length) {
      h += '<h3>Plans and assessments on file</h3><ul>' + C.plans.map(function (p) {
        return '<li>' + link(p.name, p.url) + (p.type || p.year ? ' <span class="wp-meta">' + esc([p.type, p.year].filter(Boolean).join(', ')) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    if ((C.partners || []).length) {
      h += '<h3>Advocacy and nonprofit partners</h3><ul>' + C.partners.map(function (p) { return '<li>' + link(p.name, p.url) + '</li>'; }).join('') + '</ul>';
    }
    return h + srcLine([contactsPath(m.geoid) + ' (researched contacts)'].concat((C.related || []).map(function (f) { return contactsPath(f.geoid); }), ['data/hna/local-resources.json (organisations, offices, plans and partners; search links omitted)']));
  }

  function renderWorkforce(m) {
    var W = m.workforce;
    if (!W) return '';
    var h = '<h2 id="workforce">Workers and employers</h2>';
    var c = W.commute;
    if (c) {
      var pct = function (a, b) { return b ? Math.round(100 * a / b) + '%' : NA; };
      h += (c.name !== m.name ? '<p class="wp-note">Figures for ' + esc(c.name) + '.</p>' : '') +
        '<table><tbody>' +
        row2('Primary jobs located here', fmtInt(c.jobs)) +
        row2('Held by people who live elsewhere', fmtInt(c.inCommuters) + ' (' + pct(c.inCommuters, c.jobs) + ')') +
        row2('Driving in from 20 to 60 miles', fmtInt(c.far) + ', of whom ' + fmtInt(c.farLow) + ' earn $3,333 a month or less' + (c.medianFar ? '; typical ' + c.medianFar + ' straight-line miles' : '')) +
        row2('Recorded 60+ miles away (many not daily)', fmtInt(c.long)) +
        row2(c.county ? 'Working residents who work in another Colorado county' : 'Working residents who work in another town', fmtInt(c.outCommuters) + ' of ' + fmtInt(c.residents)) +
        row2('Where in-commuters live', c.from.map(function (f) { return esc(f[0]) + ' ' + fmtInt(f[1]); }).join('; ') || NA) +
        (c.county ? '' : row2('Where working residents work', c.to.map(function (f) { return esc(f[0]) + ' ' + fmtInt(f[1]); }).join('; ') || NA)) +
        '</tbody></table>' +
        '<p class="wp-meta">In-commuters are the pool a new workforce property can draw from if some move closer. Count them as demand only with comparable-property evidence of tenants moving in (CHFA QAP).</p>' +
        srcLine('data/market/commute-strength.json (LEHD LODES ' + (c.year || NA) + ' primary jobs, home block to work block, straight-line miles)');
    }
    var t = W.topWorkplace;
    // Printed once one other town employs a fifth or more, the same line Where Should I Build shows.
    if (t && t.of && t.workers / t.of >= TOP_WORKPLACE_SHOWN) {
      // The commuting line a market study documents (NCHMA v3.1, III.F.8). Context only: no demand is added.
      h += '<p data-commute-line>' + Math.round(100 * t.workers / t.of) + '% of ' + esc(m.name) + '\'s ' + fmtInt(t.of) + ' working residents (' + fmtInt(t.workers) + ') work in ' + esc(t.name) + '.' +
        (t.otherStates ? ' The total includes ' + fmtInt(t.otherStates) + ' who work in another state.' : '') + '</p>' +
        srcLine('data/policy/job-access.json (LEHD LODES ' + (t.year || NA) + ' primary jobs, including jobs in other states)');
    }
    W.areas.forEach(function (a) {
      h += '<h3>Largest employers: ' + esc(a.area) + ' (' + esc(a.asOf) + ')</h3><div class="wp-scroll"><table><thead><tr><th>Rank</th><th>Employer</th><th>Employees</th></tr></thead><tbody>' +
        a.rows.map(function (r) { return '<tr><td>' + (r.rank == null ? '' : esc(r.rank)) + '</td><td>' + esc(r.employer) + '</td><td>' + esc(r.employees) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + '<p class="wp-src">Source: ' + esc(a.filer || NA) + ', annual financial report, "Principal Employers"' + (a.url ? ' (' + link('PDF', a.url) + (a.page ? ', page ' + esc(a.page) : '') + ')' : '') + '</p>';
    });
    if (W.areas.length) {
      if (W.contactsMissing) {
        h += '<p class="wp-note">Employer and housing partnership contacts are not in this copy of the data.</p>';
      } else if (!W.researched.length) {
        h += '<p class="wp-note">No employer or housing partnership contacts have been researched for this area yet.</p>';
      } else {
        W.researched.forEach(function (e) {
          h += '<h3>' + (e.kind === 'employer' ? 'Employer housing: ' : 'Housing partner: ') + esc(e.name) + '</h3>' +
            (e.what ? '<p>' + esc(e.what) + (e.url ? ' ' + link('Source', e.url) : '') + '</p>' : '') +
            (e.contacts.length ? contactTable(e.contacts, W.checked) : '');
        });
      }
    }
    return h;
  }

  function renderDates(m) {
    if (!m.dates.length) return '';
    return '<h2 id="dates">Next CHFA dates</h2><ul>' + m.dates.map(function (e) {
      return '<li><strong>' + esc(e.date) + '</strong>: ' + link(e.name, e.url) + (e.draft ? ' <span class="wp-tag">draft QAP, may change</span>' : '') + '</li>';
    }).join('') + '</ul>' + srcLine('data/chfa-qap-calendar.json');
  }

  function renderBrief(m) {
    if (!m.brief) return '';
    var b = m.brief;
    return '<h2 id="brief">Local housing history (curated brief)</h2>' + (b.summary ? '<p>' + esc(b.summary) + '</p>' : '') +
      b.sections.map(function (s) { return '<h3>' + esc(s.heading) + '</h3>' + s.paragraphs.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join(''); }).join('') +
      (b.sources.length ? '<h3>Brief sources</h3><ol>' + b.sources.map(function (s) { return '<li>' + link(s.title || s.url || s.id, s.url) + '</li>'; }).join('') + '</ol>' : '') +
      (b.dropped ? '<p class="wp-meta">' + b.dropped + ' passage' + (b.dropped === 1 ? '' : 's') + ' of the brief left out because they name private developer material.</p>' : '') +
      srcLine('data/jurisdiction-briefs/' + m.geoid + '.json, last curated ' + (b.lastCurated || NA));
  }

  function renderHtml(m) {
    if (m.error) return '<!doctype html><meta charset="utf-8"><title>Jurisdiction report</title><p>' + esc(m.error) + '</p>';
    var title = m.name + (m.kind === 'county' ? '' : ', ' + m.countyName);
    var body =
      '<p class="wp-kicker">Colorado jurisdiction report</p><h1>' + esc(title) + '</h1>' +
      '<p class="wp-meta">GEOID ' + esc(m.geoid) + (m.region ? ' · ' + esc(m.region) : '') + ' · built ' + esc(m.generated) +
      ' from public data in the COHO Analytics repository. Screening analysis: not a CHFA market study, underwriting, or legal advice.</p>' +
      renderGlance(m) + renderSummary(m) + renderCommunity(m) + renderNeed(m) + renderRents(m) + renderLihtc(m) + renderProp123(m) + renderPolicy(m) +
      renderLandscape(m) + renderBrief(m) + renderFunding(m) + renderDeal(m) + renderQuestions(m) + renderDynamics(m) + renderWorkforce(m) + renderContacts(m) + renderDates(m);
    // Number the sections in the order they print.
    var n = 0;
    body = body.replace(/<h2 id="(\w+)">/g, function (all, id) { return id === 'summary' ? all : '<h2 id="' + id + '">' + (++n) + '. '; });
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(title) + ' — jurisdiction report</title><style>' + STYLE + '</style></head><body><main class="wp">' + body + '</main></body></html>';
  }

  return {
    SOURCE_FILES: SOURCE_FILES,
    sourcePath: sourcePath,
    isOptional: isOptional,
    briefPath: briefPath,
    contactsPath: contactsPath,
    landscapePath: landscapePath,
    relatedGeoids: relatedGeoids,
    summaryPath: summaryPath,
    findByName: findByName,
    buildModel: buildModel,
    renderHtml: renderHtml,
    _internal: { coloradoToday: coloradoToday, num: num, fmtMoney: fmtMoney, dealShape: dealShape, isSearchLink: isSearchLink }
  };
}));
