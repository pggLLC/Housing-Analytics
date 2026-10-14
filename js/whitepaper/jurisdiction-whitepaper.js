/**
 * jurisdiction-whitepaper.js — one shareable white paper per Colorado jurisdiction,
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
    pab: { path: 'data/policy/pab-allocations.json', optional: true }
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
      overallNeedScore: num(m.overall_need_score),
      percentileRank: num(row.percentileRank),
      qctSharePct: num(m.qct_share_pct),
      ddaSharePct: num(m.dda_share_pct),
      bands: bands,
      chasSource: chasSource,
      rankingSource: sourcePath('rankingIndex') + ' (generated ' + ((src.rankingIndex.metadata || {}).generatedAt || 'date not recorded') + ')'
    };
  }

  function lihtcSection(row, src, countyName) {
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var placeKey = norm(plainName(row.name));
    // A city can span counties (Aurora: Arapahoe, Adams, Douglas), and the records
    // carry the county the project sits in, not the city's main one. So a place
    // matches by name in any county, unless another Colorado place shares the
    // name, when it is held to its own county.
    var sameName = ((src.rankingIndex && src.rankingIndex.rankings) || []).filter(function (r) {
      return r.type !== 'county' && norm(plainName(r.name)) === placeKey;
    }).length;
    function inScope(recCounty, recTown) {
      if (row.type === 'county') return recCounty === county;
      if (norm(recTown) !== placeKey) return false;
      return sameName <= 1 || recCounty === county;
    }
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
      scopeLabel: row.type === 'county' ? countyName : plainName(row.name) + ' (city/town records only; see the county white paper for the rest of ' + countyName + ')',
      properties: props,
      awards: awards,
      applications: apps,
      applicationsMissing: apps === null,
      latestAwardYear: num((row.metrics || {}).latest_lihtc_year),
      sources: [sourcePath('chfaLihtc') + ' (CHFA Housing Tax Credit properties layer, fetched ' + ((src.chfaLihtc || {}).fetchedAt || 'date not recorded') + ')',
        sourcePath('awards') + ' (CHFA, DOH and OEDIT award reports)',
        apps === null ? null : sourcePath('applications') + ' (CHFA applicant reports, ' + ((src.applications.meta || {}).first_year || '') + ' on)'].filter(Boolean)
    };
  }

  function prop123Section(row, src, countyName) {
    var list = (src.prop123 && src.prop123.jurisdictions) || [];
    var want = norm(plainName(row.name));
    var kind = row.type === 'county' ? 'county' : 'municipality';
    var rec = list.find(function (j) { return j.kind === kind && norm(j.name) === want; }) || null;
    var countyRec = row.type === 'county' ? null
      : list.find(function (j) { return j.kind === 'county' && norm(j.name) === norm(countyName); }) || null;
    return {
      record: rec, countyRecord: countyRec,
      updated: (src.prop123 || {}).updated || null,
      source: sourcePath('prop123') + ' (DOLA commitment filings and fast-track lists)'
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
    if (!FundingFit || !src.fundingGuide) return { programs: null, source: sourcePath('fundingGuide') };
    var county = row.type === 'county' ? row.geoid : row.containingCounty;
    var out = {};
    ['9%', '4%'].forEach(function (ex) {
      var q = { execution: ex, projectType: 'new-construction', county: county, place: row.type === 'county' ? undefined : row.geoid, openOnly: true };
      out[ex] = FundingFit.select(src.fundingGuide, q).map(function (r) {
        var p = r.program;
        return { name: p.name, administrator: p.administrator, url: safeHref(p.official_url), availability: r.availability, notes: r.notes || [] };
      });
    });
    return { programs: out, asOf: (src.fundingGuide.meta || {}).last_checked || null, source: sourcePath('fundingGuide') + ' via js/funding-fit.js (the Funding Sources finder)' };
  }

  function dealShape(need, rents, lihtc) {
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
        notes.push('The shortfall is deepest at the bottom: ' + fmtInt(need.gap30) + ' homes short at or below 30% AMI against ' + fmtInt(need.gap60) + ' at or below 60%. Weight the mix to 30–40% AMI units; under income averaging, some higher units keep the average at or below 60%. Plan rental subsidy (project-based vouchers) for the 30% units.');
      } else {
        notes.push('The shortfall reaches 60% AMI (' + fmtInt(need.gap60) + ' homes at or below 60%, ' + fmtInt(need.gap30) + ' of the need at or below 30%), so a 30–60% AMI mix fits the measured need.');
      }
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
    return { route: route, mix: mix, rentCheck: rentCheck, boost: boost, medianSize: medianSize, notes: notes };
  }

  function contactsSection(row, src, contactsFile, resources) {
    var researched = contactsFile && Array.isArray(contactsFile.contacts) ? contactsFile.contacts.filter(function (c) {
      return c && c.name && safeHref(c.source_url) && c.source_quote;
    }) : [];
    // Organisation links from local-resources.json, without search-engine links.
    var orgs = [];
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
    });
    var seen = {};
    orgs = orgs.filter(function (o) { if (seen[o.url]) return false; seen[o.url] = true; return true; });
    return {
      researched: researched,
      checked: contactsFile ? contactsFile.checked || null : null,
      orgs: orgs,
      needsResearch: researched.length === 0
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

  function landscapeSection(row, src, file, countyName) {
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
    if (file && (file.geoid === row.geoid || file.geoid === county)) {
      research = { geoid: file.geoid, countyLevel: file.geoid !== row.geoid, researched: file.researched || null, groups: [], notFound: (Array.isArray(file.not_found) ? file.not_found : []).filter(function (t) { return typeof t === 'string' && !EXCLUDED_PROJECT.test(t); }) };
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
      countyName: countyName,
      sources: [sourcePath('resortPrograms'), sourcePath('stewardship'), landscapePath(research ? research.geoid : row.geoid)]
    };
  }

  // How a tax-credit deal is put together here: the stack, the local pieces the data
  // already shows, and the path from letter of intent to placed in service.
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
      localMoney: localMoney,
      localFunds: policy.funds.length,
      sources: [sourcePath('equityPricing'), sourcePath('assumptions'), sourcePath('pab'), sourcePath('awards')]
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
    var today = opts.today || new Date().toISOString().slice(0, 10);
    var policy = localPolicySection(row, src);
    var brief = opts.brief && opts.brief.geoid === geoid ? opts.brief : null;
    // Text the public-artifact guard blocks is dropped paragraph by paragraph, so one
    // sentence does not cost the whole paper. The caller still checks the finished HTML.
    var blocked = typeof opts.isSensitive === 'function' ? opts.isSensitive : function () { return false; };
    var dropped = 0;
    function keep(text) { if (blocked(text)) { dropped++; return false; } return true; }
    return {
      geoid: geoid,
      name: row.type === 'county' ? row.name : plainName(row.name),
      kind: row.type,
      countyName: countyName,
      region: row.region || null,
      generated: today,
      need: need,
      rents: rents,
      lihtc: lihtc,
      prop123: prop123Section(row, src, countyName),
      policy: policy,
      funding: fundingSection(row, src, opts.FundingFit),
      deal: dealShape(need, rents, lihtc),
      landscape: landscapeSection(row, src, opts.landscape || null, countyName),
      dynamics: dealDynamics(row, src, need, lihtc, policy),
      contacts: contactsSection(row, src, opts.contacts || null, opts.localResources || null),
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
    '.wp h3{font-size:1.05rem;margin:1.2em 0 .3em}.wp-kicker{color:var(--accent);font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:.8rem}',
    '.wp-meta,.wp-src{color:var(--muted);font-size:.85rem}.wp-src{margin:.4em 0 0}',
    '.wp table{border-collapse:collapse;width:100%;margin:.5em 0;font-size:.92rem}.wp th,.wp td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}',
    '.wp thead th{background:var(--bg2)}.wp td.n{text-align:right;font-variant-numeric:tabular-nums}',
    '.wp-scroll{overflow-x:auto}.wp-note{background:var(--bg2);border-left:4px solid var(--accent);padding:10px 14px;margin:1em 0}',
    '.wp ul{padding-left:1.2em}.wp a{color:var(--accent)}.wp-tag{display:inline-block;font-size:.75rem;padding:1px 6px;border:1px solid var(--border);border-radius:4px;margin-left:4px}',
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
    items.push('<li><strong>Contacts:</strong> ' + (m.contacts.needsResearch ? 'not yet researched for this jurisdiction (organisation links below)' : m.contacts.researched.length + ' named, each with its source') + '.</li>');
    return '<h2 id="summary">Summary</h2><ul>' + items.join('') + '</ul>';
  }

  function renderNeed(m) {
    var n = m.need;
    var h = '<h2 id="need">Housing need</h2><table><tbody>' +
      row2('Population', fmtInt(n.population)) +
      row2('Median household income', fmtMoney(n.medianIncome)) +
      row2('Median gross rent', fmtMoney(n.medianRent)) +
      row2('Median home value', fmtMoney(n.medianHomeValue)) +
      row2('Renter share of households', fmtPct(n.renterSharePct)) +
      row2('Rental vacancy (active market)', fmtPct(n.vacancyPct)) +
      row2('Renters cost-burdened (30%+ of income)', fmtPct(n.costBurdenedPct)) +
      row2('Renters severely burdened (50%+)', fmtPct(n.severeBurdenedPct)) +
      row2('Rental homes short at or below 30% / 50% / 60% AMI (each counts everyone below it)', fmtInt(n.gap30) + ' / ' + fmtInt(n.gap50) + ' / ' + fmtInt(n.gap60)) +
      row2('Low-wage local jobs; workers commuting in', fmtInt(n.lowWageJobs) + '; ' + fmtInt(n.inCommuters)) +
      row2('Homes needed over 20 years', fmtInt(n.need20yr)) +
      row2('Overall need score (0–100); statewide percentile', (n.overallNeedScore === null ? NA : n.overallNeedScore.toFixed(1)) + '; ' + (n.percentileRank === null ? NA : 'p' + Math.round(n.percentileRank))) +
      '</tbody></table>' + srcLine(n.rankingSource + ' (ACS 2020–2024, CHAS, LEHD LODES, DOLA projections)');
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
    return '<h2 id="rents">Rents and income limits</h2>' +
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
    return h + srcLine(L.sources);
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
      srcLine(P.source + (P.updated ? ', updated ' + P.updated : ''));
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
    return h + srcLine(P.sources);
  }

  function renderFunding(m) {
    var F = m.funding;
    if (!F.programs) return '<h2 id="funding">Funding that fits</h2><p>The funding guide was not available.</p>' + srcLine(F.source);
    function list(ex) {
      var ps = F.programs[ex] || [];
      return '<h3>' + esc(ex) + ' new construction: ' + ps.length + ' program' + (ps.length === 1 ? '' : 's') + ' taking applications or with a published round</h3><ul>' +
        ps.map(function (p) { return '<li>' + link(p.name, p.url) + ' <span class="wp-meta">(' + esc(p.administrator) + (p.availability === 'scheduled' ? '; next round published' : '') + ')</span>' + (p.notes.length ? ' <span class="wp-meta">' + esc(p.notes.join(' ')) + '</span>' : '') + '</li>'; }).join('') + '</ul>';
    }
    return '<h2 id="funding">Funding that fits</h2><p>Screened for eligibility from each program\'s own terms; not ranked and not an award prediction.</p>' +
      list('9%') + list('4%') + srcLine(F.source + (F.asOf ? ', checked ' + F.asOf : ''));
  }

  function renderDeal(m) {
    var d = m.deal;
    var h = '<h2 id="deal">Ideal deal shape</h2><p><strong>Credit route:</strong> ' + esc(d.route) + '</p>';
    if (d.mix) {
      h += '<table><thead><tr><th>Income band</th><th>Rental homes short</th></tr></thead><tbody>' +
        '<tr><td>At or below 30% AMI</td><td class="n">' + fmtInt(d.mix.le30) + '</td></tr>' +
        '<tr><td>At or below 50% AMI</td><td class="n">' + fmtInt(d.mix.le50) + '</td></tr>' +
        '<tr><td>At or below 60% AMI</td><td class="n">' + fmtInt(d.mix.le60) + '</td></tr></tbody></table>' +
        '<p class="wp-meta">Each row is renter households at or below that income minus the rental homes priced for them, so the rows overlap and do not add up. A lower 60% figure means the cheaper homes are missing, not the 60% ones. A minimum: a home priced for a band may be rented by a higher-income household.</p>';
    }
    h += '<ul>' + d.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    h += '<p class="wp-note">This is the deal\'s shape from the data, not a pro forma. Size the dollars in the ' +
      link('Deal Calculator for ' + m.name, 'https://cohoanalytics.com/deal-calculator.html?geoid=' + encodeURIComponent(m.geoid)) +
      ' and confirm achievable rents with a CHFA market study.</p>';
    return h + srcLine('Rules in js/whitepaper/jurisdiction-whitepaper.js (dealShape), applied to the need, rent and tax-credit sections');
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
      '<li><strong>Eligible basis</strong> sets the credit. A site in a QCT or DDA gets a ' + (D.basisBoostPct !== null ? fmtPct(D.basisBoostPct, 0) : NA) + ' boost' + (D.boostHere ? ', and part of this area qualifies (see Ideal deal shape)' : '; none of this area is designated, so plan without it') + '.</li>' +
      '<li><strong>Permanent debt</strong> is sized to the rents under Rents and income limits; deep 30% units carry little debt, which is why they need rental subsidy or more soft money.</li>' +
      '<li><strong>Soft money</strong> closes the gap: state programs (Funding that fits), local funds and fee relief, and land at low or no cost.' + (D.localMoney.length ? ' This area already has recent state awards, listed in the landscape section.' : '') + '</li>' +
      '<li><strong>Screening costs:</strong> ' + fmtMoney(D.hardCost) + ' hard cost per family unit' + (D.hardCostSource ? ' (' + esc(D.hardCostSource) + ')' : '') + ', soft costs ' + fmtPct(D.softCostPct, 0) + ' of hard, developer fee ' + fmtPct(D.devFeePct, 0) + '. Replace them with your own bids.</li></ul>';
    h += '<h3>The two credit routes</h3><ul>' +
      '<li><strong>9% (competitive):</strong> letter of intent, then a scored CHFA application (see Next CHFA dates). Over ten years the credits are worth about 70% of qualified basis in present value, so the gap is small but the competition is hard.</li>' +
      '<li><strong>4% with tax-exempt bonds:</strong> not competitive for credits, but it needs private activity bond cap. Most Colorado 4% deals draw it from CHFA\'s statewide pool' + (D.pabStatewidePool !== null ? ' (' + fmtMoney(D.pabStatewidePool) + ' in ' + esc(D.pabYear || '') + ')' : '') + '. ' +
      (D.pab.length ? D.pab.map(function (x) { return esc(x.name); }).join(' and ') + ' received an initial ' + esc(D.pabYear || '') + ' direct allocation of ' + D.pab.map(function (x) { return fmtMoney(x.amount); }).join(' and ') + ': a gross starting figure, not what is left, which may go to other bond uses or be ceded to CHFA. ' : 'No local direct allocation is recorded here. ') +
      'The credits are worth about 30% of qualified basis, so the gap is much larger.</li></ul>';
    h += '<h3>From award to occupancy</h3><ol>' +
      '<li>Site control, zoning and a CHFA market study before applying.</li>' +
      '<li>Local support: a council resolution, fee relief, land or a local loan, which also helps the jurisdiction count units toward its Prop 123 promise.</li>' +
      '<li><strong>9%:</strong> CHFA allocates credits after the round. A project not yet in service gets a carryover allocation, must have incurred more than 10% of its reasonably expected basis within 12 months of that allocation, and must be placed in service by the end of the second calendar year after the allocation year.</li>' +
      '<li><strong>4%:</strong> the credits come with the tax-exempt bonds rather than a CHFA credit allocation, so the 9% carryover deadlines do not apply. The bonds must finance the required share of land and building, and CHFA still reviews the deal against its QAP.</li>' +
      '<li>Rents and incomes stay restricted through the compliance period and CHFA\'s extended use period.</li></ol>';
    return h + srcLine(D.sources);
  }

  function renderContacts(m) {
    var C = m.contacts;
    var h = '<h2 id="contacts">Who to contact</h2>';
    if (C.researched.length) {
      h += '<div class="wp-scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Contact</th><th>Source</th></tr></thead><tbody>' +
        C.researched.map(function (c) {
          var how = [c.email ? esc(c.email) : '', c.phone ? esc(c.phone) : ''].filter(Boolean).join('<br>');
          return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.role || '') + (c.org ? '<br><span class="wp-meta">' + esc(c.org) + '</span>' : '') + '</td><td>' + (how || NA) + '</td><td>' + link(c.source_label || 'source', c.source_url) + '<br><span class="wp-meta">“' + esc(c.source_quote) + '”</span></td></tr>';
        }).join('') + '</tbody></table></div><p class="wp-meta">Contacts checked ' + esc(C.checked || NA) + '. Staff change; confirm before reaching out.</p>';
    } else {
      h += '<p class="wp-note">No named contacts have been researched for this jurisdiction yet. The organisations below are the starting points.</p>';
    }
    if (C.orgs.length) {
      h += '<h3>Organisations</h3><ul>' + C.orgs.map(function (o) { return '<li>' + esc(o.role) + ': ' + link(o.name, o.url) + '</li>'; }).join('') + '</ul>';
    }
    return h + srcLine(['data/jurisdiction-briefs/_contacts/' + m.geoid + '.json (researched contacts)', 'data/hna/local-resources.json (organisation links; search links omitted)']);
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
    if (m.error) return '<!doctype html><meta charset="utf-8"><title>White paper</title><p>' + esc(m.error) + '</p>';
    var title = m.name + (m.kind === 'county' ? '' : ', ' + m.countyName);
    var body =
      '<p class="wp-kicker">Colorado housing white paper</p><h1>' + esc(title) + '</h1>' +
      '<p class="wp-meta">GEOID ' + esc(m.geoid) + (m.region ? ' · ' + esc(m.region) : '') + ' · built ' + esc(m.generated) +
      ' from public data in the COHO Analytics repository. Screening analysis: not a CHFA market study, underwriting, or legal advice.</p>' +
      renderSummary(m) + renderNeed(m) + renderRents(m) + renderLihtc(m) + renderProp123(m) + renderPolicy(m) +
      renderLandscape(m) + renderFunding(m) + renderDeal(m) + renderDynamics(m) + renderContacts(m) + renderDates(m) + renderBrief(m);
    // Number the sections in the order they print.
    var n = 0;
    body = body.replace(/<h2 id="(\w+)">/g, function (all, id) { return id === 'summary' ? all : '<h2 id="' + id + '">' + (++n) + '. '; });
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(title) + ' — housing white paper</title><style>' + STYLE + '</style></head><body><main class="wp">' + body + '</main></body></html>';
  }

  return {
    SOURCE_FILES: SOURCE_FILES,
    sourcePath: sourcePath,
    isOptional: isOptional,
    briefPath: briefPath,
    contactsPath: contactsPath,
    landscapePath: landscapePath,
    findByName: findByName,
    buildModel: buildModel,
    renderHtml: renderHtml,
    _internal: { num: num, fmtMoney: fmtMoney, dealShape: dealShape, isSearchLink: isSearchLink }
  };
}));
