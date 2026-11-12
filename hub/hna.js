// The Housing Needs Assessment inside the place page: one tab per chapter, in the lab's design.
// Figures come from the HNA's own per-place files at the pin: the metrics digest (each value with its
// source and vintage) and the ACS profile summary. Nothing is recalculated here; a value the files
// do not hold shows as not published, never as zero.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var Pl = global.LabPlaces;
  var esc = Shell.esc, num = Pl.num, money = Pl.money;
  var VENDOR = global.LAB_VENDOR;

  // Chapter names as the live site's HNA uses them.
  var TABS = [
    { id: 'overview', title: 'Overview' },
    { id: 'people', title: 'Who lives here', live: 'hna-who-lives-here.html' },
    { id: 'housing', title: 'What housing exists', live: 'hna-what-housing-exists.html' },
    { id: 'afford', title: 'What households can afford', live: 'hna-what-households-can-afford.html' },
    { id: 'future', title: 'Where it’s heading', live: 'hna-where-its-heading.html' },
    { id: 'action', title: 'What to do about it', tab: 'What to do', live: 'hna-what-to-do.html' },
    // New in the lab (SB24-174): DOLA's required tables and checklist. No live page yet; ports as its own chapter.
    { id: 'dola', title: 'For DOLA: SB24-174 check', tab: 'For DOLA' }
  ];

  // What each chapter answers, in one line, shown above its figures.
  var ASKS = {
    overview: 'The headline figures, and where the gap is widest.',
    people: 'Who the households are, what they earn, and who commutes in to work.',
    housing: 'How many homes there are, what kind, and how many sit empty.',
    afford: 'Which households cannot find a home they can afford, and how far short they fall.',
    future: 'How many people and homes the next 20 years bring.',
    action: 'How many homes are needed, what state law asks of the local government, and where to start.',
    dola: 'What SB24-174 asks of this government, and DOLA\u2019s four need tables built from this HNA\u2019s data.'
  };

  // A long chapter folds its later sections: the title and a one-line answer show, the section opens on tap
  // (templates.js LabTpl.fold). take is plain text; the section's own markup is unchanged inside the fold.
  function fold(html, take, o) {
    var T = global.LabTpl;
    if (!html || !T || !T.foldHtml) return html || '';
    return T.foldHtml(html, take ? esc(take) : '', o);
  }

  // Labels for ACS profile fields, as the HNA's own charts label them (js/hna/hna-renderers.js).
  var INCOME = [['<$10k', 'DP03_0052E'], ['$10–15k', 'DP03_0053E'], ['$15–25k', 'DP03_0054E'], ['$25–35k', 'DP03_0055E'], ['$35–50k', 'DP03_0056E'],
    ['$50–75k', 'DP03_0057E'], ['$75–100k', 'DP03_0058E'], ['$100–150k', 'DP03_0059E'], ['$150–200k', 'DP03_0060E'], ['>$200k', 'DP03_0061E']];
  var STRUCTURE = [['1-unit detached', 'DP04_0007E'], ['1-unit attached', 'DP04_0008E'], ['2 units', 'DP04_0009E'], ['3-4 units', 'DP04_0010E'],
    ['5-9 units', 'DP04_0011E'], ['10-19 units', 'DP04_0012E'], ['20+ units', 'DP04_0013E'], ['Mobile home', 'DP04_0014E']];
  var RENT_BURDEN = [['<15%', 'DP04_0137PE'], ['15–20%', 'DP04_0138PE'], ['20–25%', 'DP04_0139PE'], ['25–30%', 'DP04_0140PE'], ['30–35%', 'DP04_0141PE'], ['35%+', 'DP04_0142PE']];
  // ACS DP04 bedrooms, "No bedroom" through "5 or more".
  var BEDROOMS = [['No bedroom', 'DP04_0039E'], ['1 bedroom', 'DP04_0040E'], ['2 bedrooms', 'DP04_0041E'], ['3 bedrooms', 'DP04_0042E'], ['4 bedrooms', 'DP04_0043E'], ['5 or more', 'DP04_0044E']];
  var BURDEN_TIERS = [['At or below 30% AMI', 'pct_burdened_lte30'], ['31–50% AMI', 'pct_burdened_31to50'], ['51–80% AMI', 'pct_burdened_51to80'], ['81–100% AMI', 'pct_burdened_81to100'], ['Above 100% AMI', 'pct_burdened_100plus']];

  var cache = {};
  function loadPlace(geoid) {
    if (cache[geoid]) return cache[geoid];
    var c = cache[geoid] = { digest: null, summary: null, error: null };
    // A failure is shown with a Try again button and is not kept as the answer (round-three review, 11-10:
    // one 503 stayed on screen until a full reload). c is checked on arrival so a slow old reply cannot
    // overwrite a newer try.
    var get = function (f) { return fetch(VENDOR + f).then(function (r) { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); }); };
    // A host can supply its own loader (the hosted preview packs the per-place files into a few bundles).
    var files = global.LAB_HNA_LOAD ? global.LAB_HNA_LOAD(geoid)
      : Promise.all([get('data/hna/jurisdiction-metrics-digest/' + geoid + '.json'), get('data/hna/summary/' + geoid + '.json')]);
    files
      .then(function (r) { if (cache[geoid] !== c) return; c.digest = r[0]; c.summary = r[1]; Shell.render(); })
      .catch(function (e) { if (cache[geoid] !== c) return; c.error = 'The files for this place did not load (' + e.message + '). This is a loading problem, not missing data.'; Shell.render(); });
    return c;
  }

  // The State Demography Office forecast's base year at the pin (data/hna/projections/*.json baseYear;
  // qa/hna.test.js fails if a re-pin changes it).
  var DOLA_BASE = 2024;

  // Where a digest value came from, as a public source name and year. The digest carries some internal
  // labels ("latest committed vintage", "projection cache"); each is mapped to the public source and the
  // year in the pinned files. ctx: { lodes: year read from the digest's own workforce label, chfa: feed date }.
  function sourceOf(m, ctx) {
    if (!m) return '';
    ctx = ctx || {};
    var asOf = String(m.as_of || ''), id = String(m.source_id || '');
    var built = /^\d{4}-\d{2}-\d{2}T/.test(asOf) ? asOf.slice(0, 10) : null;
    var lodes = 'LEHD LODES ' + (ctx.lodes || '(year not stated in source)');
    var chfa = 'CHFA tax credit property list' + (ctx.chfa ? ', ' + ctx.chfa : '');
    var dola = 'Colorado State Demography Office forecast, base year ' + DOLA_BASE;
    var src = {
      'hna-ranking-index-derived': 'HNA need index, built ' + built,
      'hna-affordable-ownership-need': 'HNA ownership reading, built ' + built,
      'economic-housing-bridge': 'HNA wage comparison, built ' + built + ', with county wages from ' + lodes,
      'lehd-lodes-county': lodes + ', county',
      'lehd-lodes-place-apportioned': lodes + ', shared out to the place',
      'lehd-lodes-wac-county': lodes + ' workplace jobs, county',
      'lehd-lodes-wac-place': lodes + ' workplace jobs',
      'lehd-lodes-county-earnings-bin-estimate': 'Estimated from ' + lodes + ' earnings bands, county',
      'dola-demographic-projections': dola,
      'dola-projections-plus-lodes-incommuters': dola + '; ' + asOf.split('; ')[1],
      'chfa-lihtc-properties': chfa,
      'chfa-lihtc-and-2026-r1-awards': chfa + ', and CHFA 2026 Round One awards',
      'county-housing-cost-trends-acs-cohorts': 'Census ACS county estimates, 2009, 2014 and 2024',
      'zillow-zhvi-city-index': 'Zillow home value index, ' + asOf
    }[id] || asOf;
    return src + (/^(medium|low)$/.test(m.confidence) ? ' · ' + m.confidence + ' confidence' : '');
  }

  // What geography a digest value is, read from the digest's own geography_level, source_id and
  // measure_type. ctx: { geoid, county: county name, tracts: tracts under the place's CHAS apportionment }.
  var ESTIMATED_FROM = {
    'lehd-lodes-place-apportioned': 'county LEHD LODES job and commute counts shared out to the place',
    'lodes-incommuters-acs-pums': 'county commute flows and Census PUMS incomes',
    'workforce-gap-renters-incommuters-vs-ami-gap': 'local renters plus an in-commuter estimate',
    'economic-housing-bridge': 'local rents and home values against the county median wage'
  };
  // Modeled values (closeout ledger P06): Zillow's index is a model of home values, not a count, and the county
  // wage is read off LEHD's job counts by earnings band. Checked before the county shortcut, because the
  // county-adjusted home value is this place's own Census value scaled by the county index, not the county's figure.
  var MODELED_FROM = {
    'zillow-zhvi-city-index': 'Zillow\u2019s home value index, a model of typical home values for the city',
    'zillow-zhvi-county-adjusted': 'its Census home value, scaled by the county\u2019s Zillow home value index',
    'lehd-lodes-county-earnings-bin-estimate': 'LEHD job counts by earnings band in the county, read as a median wage'
  };
  var CALCULATED_FROM = {
    'ami-gap-place-acs': 'Census household incomes and rents against HUD income limits',
    'ami-gap-county-acs': 'Census household incomes and rents against HUD income limits',
    'hna-affordable-ownership-need': 'Census and HUD counts combined by COHO',
    'acs-b25075': 'Census home-value counts against what each income can afford'
  };
  var CALCULATED_KEYS = {
    home_value_to_income: 'the typical home value divided by the median household income',
    rent_to_income: 'a year of the median rent divided by the median household income'
  };
  // Projections and modeled values are checked before the county shortcut: a county's forecast-based
  // "homes needed" is COHO's estimate, not the county's own published figure.
  function scopeOf(m, key, ctx) {
    if (!m) return null;
    var id = String(m.source_id || '');
    if (m.measure_type === 'derived') return { level: 'index' };
    if (/^regional_/.test(key)) return { level: 'area', area: 'the area within ' + (ctx.radius || 25) + ' miles' };
    if (m.measure_type === 'projection') return { level: 'estimate', from: 'the State Demography Office forecast for ' + (ctx.county || 'the county') + (id === 'dola-projections-plus-lodes-incommuters' ? ', plus an in-commuter estimate' : '') };
    if (MODELED_FROM[id] && !CALCULATED_KEYS[key]) return { level: 'estimate', where: String(ctx.geoid).length === 5 ? 'this county' : 'this place', from: MODELED_FROM[id] };
    if (String(ctx.geoid).length !== 5 && m.geography_level === 'county_context') return { level: 'county-proxy', countyName: ctx.county };
    if (ESTIMATED_FROM[id]) return { level: 'estimate', from: ESTIMATED_FROM[id] };
    // Worked out from published inputs: never "measured directly" or the county's "own published figure".
    var where = String(ctx.geoid).length === 5 ? 'this county' : 'this place';
    if (CALCULATED_FROM[id]) return { level: 'calculated', where: where, from: CALCULATED_FROM[id] };
    if (CALCULATED_KEYS[key]) return { level: 'calculated', where: where, from: CALCULATED_KEYS[key] };
    if (m.measure_type === 'trend') return { level: 'calculated', where: where, from: 'the change between two published survey periods' };
    if (String(ctx.geoid).length === 5) return { level: 'county' };
    if (id === 'hud-chas-place-apportioned') return { level: 'apportioned', tractCount: ctx.tracts };
    return { level: 'place' };
  }

  // Tracts under each place's CHAS apportionment, from the file the live HNA's chip reads.
  var tracts = { places: null, loading: false };
  function tractCount(geoid) {
    if (!tracts.places && !tracts.loading) {
      tracts.loading = true;
      fetch(VENDOR + 'data/hna/place-chas.json').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { tracts.places = (j && j.places) || {}; Shell.render(); })
        .catch(function () { tracts.places = {}; });
    }
    var rec = tracts.places && tracts.places[geoid];
    return rec ? rec.tract_count : null;
  }

  // Extra HNA files for the chapter graphics, each loaded once: commute flows, building permits, the
  // record of past forecast misses, and each county's State Demography Office forecast.
  // A file that fails to load is marked failed, not cached as an empty file: a chapter that counts or
  // designates from it (extraFailed) says it did not load, and the next look after RETRY_MS asks again.
  var extra = {}, failed = {}, RETRY_MS = 20000;
  function extraFile(f) {
    if (failed[f] && Date.now() - failed[f] > RETRY_MS) { delete failed[f]; delete extra[f]; }
    if (!(f in extra)) {
      extra[f] = null;
      fetch(VENDOR + f).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { extra[f] = j || {}; Shell.render(); })
        .catch(function () { failed[f] = Date.now(); extra[f] = {}; Shell.render(); });
    }
    return extra[f];
  }
  function extraFailed() { return Array.prototype.some.call(arguments, function (f) { return !!failed[f]; }); }
  // A public-site module a chapter needs only when it opens, loaded once from the pinned copy.
  var scripts = {};
  function needScript(f) {
    if (scripts[f] || !global.document) return;
    scripts[f] = global.document.createElement('script');
    scripts[f].src = VENDOR + f;
    scripts[f].onload = scripts[f].onerror = function () { Shell.render(); };
    global.document.body.appendChild(scripts[f]);
  }
  // The ownership strategy screen's files, as js/hna/hna-renderers.js _ownershipStrategyDocs loads them.
  var OWN_FILES = { developerFunding: 'data/policy/developer-ownership-funding.json', buyerAssistance: 'data/policy/buyer-assistance-programs.json',
    stewardshipProviders: 'data/policy/stewardship-providers.json', countyOwnership: 'data/policy/county-ownership.json',
    progress: 'data/policy/jurisdiction-housing-progress.json', localResources: 'data/hna/local-resources.json', resaleConventions: 'data/policy/resale-conventions.json' };
  // The live screen's AMI price ceiling choices (js/hna/hna-ownership-strategy.js CEILING_OPTIONS).
  var OWN_CEILINGS = [0.80, 1.00, 1.10, 1.20, 1.30, 1.40, 1.50, 1.60];
  // The reader's picks on the screen, per place, for this visit only.
  var ownCtl = {};
  var OWN_NUM = { householdSize: 1, amiCeilingPct: 1 };
  if (global.document) global.document.addEventListener('change', function (ev) {
    var el = ev.target, k = el.getAttribute && el.getAttribute('data-own');
    if (!k) return;
    var g = el.getAttribute('data-own-g'), c = ownCtl[g] = ownCtl[g] || {};
    c[k] = OWN_NUM[k] ? Number(el.value) : el.value;
    Shell.render();
    var back = global.document.querySelector('select[data-own="' + k + '"]');
    if (back) back.focus();
  });
  if (global.document) global.document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-hna-retry]');
    if (!b) return;
    delete cache[b.getAttribute('data-hna-retry')];
    Shell.render();
  });
  // Downloads of the assessment: the place's own HNA files as JSON, and every figure with its source as CSV.
  if (global.document) global.document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-hna-dl]');
    if (!b) return;
    if (b.getAttribute('data-hna-dl') === 'print') { global.print(); return; }
    var g = b.getAttribute('data-hna-g'), c = cache[g];
    if (!c || !c.digest) return;
    var kind = b.getAttribute('data-hna-dl'), name = 'coho-hna-' + g + '-' + kind, body, type;
    if (kind === 'json') {
      body = JSON.stringify({ geoid: g, pinnedCommit: global.LAB_PIN || null, digest: c.digest, summary: c.summary, unavailableReasons: missingReasons(c.digest), hudAffordableAvailable: hudFor(g) }, null, 1); type = 'application/json'; name += '.json';
    } else {
      body = '﻿' + csvOf(c.digest, g); type = 'text/csv'; name += '.csv';
    }
    var url = URL.createObjectURL(new Blob([body], { type: type })), a = global.document.createElement('a');
    a.href = url; a.download = name; global.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  // Why a figure has no value: the digest's own reason when it carries one (the rent gap and rent burden do),
  // otherwise that the source publishes none for this place. Shown on the card and carried into the downloads.
  function whyMissing(m) {
    if (!m || m.value != null) return null;
    if (m.unavailable_reason) return m.unavailable_reason;
    return /^acs/i.test(m.source_id || '') ? 'The Census publishes no figure for this place in this survey.' : 'The source publishes no figure for this place.';
  }
  function missingReasons(digest) {
    var ms = (digest && digest.metrics) || {}, out = {};
    Object.keys(ms).sort().forEach(function (k) { var w = whyMissing(ms[k]); if (w) out[k] = w; });
    return out;
  }
  // One row per published figure: its key, value, source, vintage and the geography it is measured for.
  function csvOf(digest, geoid) {
    var q = function (x) { x = x == null ? '' : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var ms = (digest && digest.metrics) || {};
    var rows = [['geoid', 'figure', 'value', 'source', 'source id', 'vintage', 'geography', 'confidence', 'why no value']].concat(Object.keys(ms).sort().map(function (k) {
      var m = ms[k] || {};
      return [geoid, k, m.value, sourceOf(m), m.source_id || '', m.as_of || '', m.geography_level || '', m.confidence || '', whyMissing(m) || ''];
    }));
    // HUD's affordable-and-available count, the page's headline, under its own keys and source.
    var h = hudFor(geoid);
    if (h) ['30', '50', '80'].forEach(function (k) {
      var x = h.tiers[k] || {};
      [['hud_homes_short_lte' + k, x.homes_short], ['hud_renter_households_lte' + k, x.renter_households], ['hud_affordable_available_homes_lte' + k, x.affordable_available_homes]].forEach(function (r) {
        rows.push([geoid, r[0], r[1] == null ? '' : r[1], 'HUD CHAS, affordable and available (calculated by COHO from HUD counts)', 'hud-chas-affordable-available', h.vintage, String(geoid).length === 5 ? 'county' : 'place', r[1] == null ? 'not published' : '', r[1] == null ? 'HUD publishes no count for this place.' : '']);
      });
    });
    return rows.map(function (r) { return r.map(q).join(','); }).join('\n') + '\n';
  }
  function hudFor(geoid) {
    var aa = (Pl.data().data || {}).aa; if (!aa) return null;
    var rec = String(geoid).length === 5 ? (aa.counties || {})[geoid] : (aa.places || {})[geoid];
    return rec && rec.tiers ? { tiers: rec.tiers, vintage: (aa.meta && aa.meta.vintage) || '', source: 'HUD CHAS, affordable and available', url: 'https://www.huduser.gov/portal/datasets/cp.html' } : null;
  }
  var EXTRA = { homeValues: 'data/hna/home-value-cascade.json', econ: 'data/co-county-economic-indicators.json', chasGap: 'data/hna/chas_affordability_gap.json', ranking: 'data/hna/ranking-index.json', demog: 'data/co-county-demographics.json', renterSize: 'data/market/acs_renter_household_size_co.json', renterBeds: 'data/market/acs_renter_bedrooms_co.json', flows: 'data/hna/place-od-flows.json', lehdPlace: 'data/hna/place-lehd.json', lehd: function (fips) { return 'data/hna/lehd/' + fips + '.json'; },
    nlihc: 'data/affordable-housing/nlihc-out-of-reach-co.json', ura: 'data/market/co-urban-renewal-authorities.json', oz: 'data/market/opportunity_zones_co.geojson', stops: 'data/amenities/transit_stops_statewide_co.geojson', placeShapes: 'data/co-place-boundaries.geojson', countyShapes: 'data/boundaries/counties_co.geojson',
    placeCounty: 'data/hna/derived/place_county_lookup.json', reuse: 'data/market/co-adaptive-reuse-references.json', direction: 'data/market/market-direction.json', permits: 'data/hna/permits.json', forecastError: 'data/hna/forecast-error.json',
    projection: function (fips) { return 'data/hna/projections/' + fips + '.json'; },
    sya: function (fips) { return 'data/hna/dola_sya/' + fips + '.json'; },
    lihtc: 'data/chfa-lihtc.json', qct: 'data/qct-colorado.json', dda: 'data/dda-colorado.json', tracts: 'data/hna/place-tract-membership.json',
    second: 'data/hna/second-homes-str.json', context: 'data/core/neighborhood-context.json',
    chfaLimits: 'data/chfa-income-rent-limits-2026.json', decade: 'data/hna/place-decade-trends.json', placeChas: 'data/hna/place-chas.json',
    deals: 'data/deals/index.json', crossCounty: 'data/hna/cross-county-places.json', transit: 'data/hna/transit-zone-by-geography.json',
    thiz: 'data/policy/thiz-map-status.json', prop123: 'data/policy/prop123_jurisdictions.json',
    laws: 'data/policy/state-housing-laws.json', vacancy: 'data/hna/vacancy-status.json' };
  // Prop 123's steps, as the live chapter's compliance checklist sets them out, with the statute for each.
  var P123_STEPS = [
    ['Set the baseline (2024–2026)', 'Homes affordable to renters at or below 60% AMI and to buyers at or below 100% AMI, counted from 2017–2021 ACS, HUD CHAS or DOLA’s baseline tool (C.R.S. 29-32-101(2), 29-32-105(1)(c)). From 2027 the baseline no longer sets the goal (HB26-1313).'],
    ['Commit to a unit goal', '2024–2026: 3% of the baseline a year, 9% over three years, counted as new or newly affordable homes. 2027–2029: average yearly permits over the past three years × years committed × 10%, 15% or 20% by county job growth, at least one home a year (§ 29-32-105(1)(a), (1)(d), as amended by HB26-1313). Without one, projects here cannot draw on the OEDIT and CHFA Affordable Housing Financing Fund or DOLA’s Affordable Housing Support Fund; DOLA’s homelessness programs are the exception.'],
    ['Adopt fast-track review', 'From January 1, 2027, decide qualifying applications within 90 calendar days (§ 29-32-105(2)(a), (3)(a)). It covers development permits, not subdivisions or rezonings; a developer may ask for a 90-day extension or opt out (§ 29-32-105(2)(b), (d)). There is no population threshold.'],
    ['File with DOLA by November 1', 'One filing covers the three-year cycle: November 1, 2026 for 2027–2029, or November 1, 2027 or 2028 to join part-way. A government that does not file is ineligible the next calendar year (§ 29-32-105(1)(d), (3)(b)(III), (V)). File at the <a href="https://cdola.colorado.gov/commitment-filings" target="_blank" rel="noopener">DOLA commitment filings portal</a>.'],
    ['Report progress by the end of the cycle', 'Homes counted toward the goal are documented by December 31 of the cycle’s last year (2026 for 2024–2026). Missing the goal without a waiver makes the government ineligible for the first year of the next cycle; money already received is not paid back (§ 29-32-105(3)(b)(IV), (VII)).']
  ];
  var P123_LINKS = [
    ['DOLA Proposition 123', 'https://cdola.colorado.gov/prop123', 'guidance, FAQ and forms'],
    ['DOLA commitment filings', 'https://cdola.colorado.gov/commitment-filings', 'the filing portal and every filing'],
    ['DOLA fast-track guidance', 'https://cdola.colorado.gov/prop123fasttrack', null],
    ['HB26-1313', 'https://leg.colorado.gov/bills/hb26-1313', 'the 2027–2029 goal formula'],
    ['CHFA housing affordability gap map', 'https://www.chfainfo.com/community-partnerships/the-housing-affordability-gap', 'county gaps, set beside the Prop 123 baseline'],
    ['Funding sources', '#/places/deep-dive', 'every Colorado program that funds affordable housing']
  ];
  // The live chapter's eight actions (hna-what-to-do.html #housing-action-plan), in its two groups.
  var ACTIONS = [
    ['Housing supply', [
      ['action_zoning', 'Update zoning for housing diversity', 'allow ADUs, duplexes and missing-middle homes.'],
      ['action_fasttrack', 'Fast-track permitting for affordable housing', 'streamline approvals for qualifying projects.'],
      ['action_landbank', 'Set up a land bank or land trust', 'secure sites for long-term affordable housing.'],
      ['action_iz', 'Adopt inclusionary zoning', 'require affordable homes in new market-rate developments.']]],
    ['Affordability and demand', [
      ['action_lihtc', 'Support tax credit applications', 'work with developers to win Low Income Housing Tax Credits for new affordable homes.'],
      ['action_vouchers', 'Expand rental assistance', 'work with housing authorities on more Housing Choice Vouchers and rent subsidies.'],
      ['action_senior', 'Plan for the senior housing gap', 'aging in place, assisted living and senior affordable homes.'],
      ['action_homeless', 'Homelessness prevention', 'rapid rehousing, prevention funds and supportive services.', ['How supportive services keep people housed', '#/guide/resident-services']]]]
  ];
  // Ticks on the action plan, per place, in this browser only (as the live page keeps them).
  var PLAN_KEY = 'coho-lab-hna-plan:';
  function planTicks(geoid) {
    try { return JSON.parse(global.localStorage.getItem(PLAN_KEY + geoid) || '{}') || {}; } catch (e) { return {}; }
  }
  var ftInputs = {};
  // The page's own listeners; the unit tests load this file with no document.
  if (global.document) global.document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.matches || !el.matches('input[data-plan]')) return;
    var g = el.getAttribute('data-plan'), t = planTicks(g);
    if (el.checked) t[el.value] = new Date().toISOString().slice(0, 10); else delete t[el.value];
    try { global.localStorage.setItem(PLAN_KEY + g, JSON.stringify(t)); } catch (e) { /* storage off: the tick lasts until the page redraws */ }
    Shell.render();
  });
  if (global.document) global.document.addEventListener('input', function (ev) {
    var form = ev.target.form;
    if (!form || !form.dataset.ft) return;
    ftInputs[form.dataset.ft] = { units: form.elements.units.value, affordable: form.elements.affordable.value };
    var at = ev.target.name, pos = ev.target.selectionStart;
    Shell.render();
    var back = document.querySelector('form[data-ft] input[name="' + at + '"]');
    if (back) { back.focus(); try { back.setSelectionRange(pos, pos); } catch (e) { /* number inputs have no selection */ } }
  });


  // The public page behind each digest source. ACS values link to the Census table for this place and
  // survey; values the HNA computes link to the live site's methods page.
  var HUD_CHAS_URL = 'https://www.huduser.gov/portal/datasets/cp.html';
  var LINKS = {
    lodes: 'https://lehd.ces.census.gov/data/',
    fmr: 'https://www.huduser.gov/portal/datasets/fmr.html',
    il: 'https://www.huduser.gov/portal/datasets/il.html',
    dola: 'https://demography.dola.colorado.gov/',
    chas: 'https://www.huduser.gov/portal/datasets/cp.html',
    qct: 'https://www.huduser.gov/portal/datasets/qct.html',
    roundOne: 'https://www.chfainfo.com/rental-housing/housing-credit/2026-round-one-award-descriptions',
    zillow: 'https://www.zillow.com/research/data/',
    acs: 'https://www.census.gov/programs-surveys/acs/data.html',
    methods: 'https://cohoanalytics.com/methods.html'
  };
  function census(geoid) { return (String(geoid).length === 5 ? '050XX00US' : '160XX00US') + geoid; }
  function acsTable(table, asOf, geoid) {
    var y = /(\d{4}) 1-year/.exec(asOf), f = /\d{4}-(\d{4}) 5-year/.exec(asOf);
    var survey = y ? '1Y' + y[1] : f ? '5Y' + f[1] : null;
    if (!survey) return LINKS.acs;
    return 'https://data.census.gov/table/ACS' + (/^DP/.test(table) ? 'DP' : /^S\d/.test(table) ? 'ST' : 'DT') + survey + '.' + table + '?g=' + census(geoid);
  }
  function sourceUrl(m, ctx) {
    if (!m) return null;
    ctx = ctx || {};
    var id = String(m.source_id || ''), asOf = String(m.as_of || ''), g = ctx.geoid;
    var table = /^acs-profile-(dp0\d)/.exec(id);
    if (table) return acsTable(table[1].toUpperCase(), asOf, g);
    if (id === 'acs-profile') return 'https://data.census.gov/profile?g=' + census(g);
    if (id === 'acs-b25075' || id === 'acs-b25003') return acsTable(id.slice(4).toUpperCase(), asOf, g);
    if (/^ami-gap-/.test(id)) return acsTable('B25118', asOf, g);
    if (/^hud-chas|grapi-and-hud-chas/.test(id)) return LINKS.chas;
    if (id === 'hud-qct-dda') return LINKS.qct;
    if (/^dola-/.test(id)) return LINKS.dola;
    if (/^(lehd-|lodes-)/.test(id)) return LINKS.lodes;
    if (id === 'chfa-2026-r1-awards') return LINKS.roundOne;
    if (/^chfa-/.test(id)) return ctx.lihtc || null;
    if (/^zillow-zhvi-city/.test(id)) return LINKS.zillow;
    if (id === 'county-housing-cost-trends-acs-cohorts' || id === 'zillow-zhvi-county-adjusted') return LINKS.acs;
    return LINKS.methods;
  }

  // A table wider than the screen scrolls inside its wrapper, so the wrapper must take keyboard focus
  // (arrow keys scroll it) and carry a name. The name is the table's own caption, tags removed.
  function focusTables(html) {
    return html.replace(/<div class="table-scroll"><table><caption>([\s\S]*?)<\/caption>/g, function (all, cap) {
      // Strip tags until none are left, then escape what remains, since it goes into an attribute.
      var name = cap, prev;
      do { prev = name; name = name.replace(/<[^>]*>/g, ''); } while (name !== prev);
      name = name.replace(/[<>"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).trim();
      return '<div class="table-scroll" role="region" tabindex="0" aria-label="' + name + '"><table><caption>' + cap + '</caption>';
    });
  }
  function view(c, geoid, tab, entry, place) {
    var d = c.digest.metrics;
    var p = c.summary.acsProfile || {};
    var m = function (k) { return d[k] && d[k].value != null ? d[k] : null; };
    var v = function (k) { var x = m(k); return x ? x.value : null; };
    var pct = function (x, dp) { return x == null ? null : Number(x).toFixed(dp == null ? 1 : dp).replace(/\.0$/, '') + '%'; };
    // The stored profile is the 1-year survey for Colorado's largest counties and places, the 5-year for the rest.
    var acs = !p._acsYear ? 'Census ACS' : p._acsSeries === 'acs1' ? 'ACS ' + p._acsYear + ' 1-year' : 'ACS ' + (p._acsYear - 4) + '-' + p._acsYear + ' 5-year';
    var acsUrl = function (t) { return acsTable(t, acs, geoid); };
    var shared = Pl.data().data;
    var ctx = {
      lodes: ((String((d.workforce_gap_units || {}).as_of || '')).match(/LEHD LODES (\d{4})/) || [])[1],
      chfa: shared && shared.lihtc.fetchedAt ? String(shared.lihtc.fetchedAt).slice(0, 10) : null,
      lihtc: shared ? shared.lihtc.source : null,
      geoid: geoid
    };
    var countyName = place && place.county.county ? place.county.county.county_name : '';
    var isCounty = String(geoid).length === 5;
    // Figures a chapter's sections hand to its closing "What you have now" list, as [value, words, source].
    var kept = {}, keep = function (k, val, words, src) { if (val != null && /\d/.test(String(val))) kept[k] = [val, words, src || null]; };
    var sctx = { geoid: geoid, county: countyName, tracts: isCounty ? null : tractCount(geoid), radius: v('regional_pma_miles') };
    var here = isCounty ? Pl.AT.county : Pl.AT.place;
    var signed = function (x, f) { return (x > 0 ? '+' : x < 0 ? '\u2212' : '') + f(Math.abs(x)); };
    // One card from one digest metric, with its own source line.
    var mc = function (title, key, fmt, detail) {
      var x = m(key);
      var at = scopeOf(d[key], key, sctx);
      if (at) at.metric = title;
      return x ? Pl.card(title, fmt(x.value), detail || null, sourceOf(x, ctx), sourceUrl(x, ctx), at)
        : Pl.card(title, null, [whyMissing(d[key]), detail].filter(Boolean).join(' ') || null, sourceOf(d[key], ctx) || 'Not in the HNA files for this place', d[key] ? sourceUrl(d[key], ctx) : null, at);
    };
    var word = function (title, key, detail) { return mc(title, key, String, detail).replace('<div class="metric">', '<div class="metric word">'); };
    var pv = function (k) { return p[k] == null || p[k] === '' ? null : Number(p[k]); };

    // A single-series bar list: one row per bin, the value at the bar's tip.
    function bars(title, note, rows, fmt, cls, src, at) {
      var vals = rows.map(function (r) { return r[1]; });
      if (vals.every(function (x) { return x == null; })) return '<p class="note">' + esc(title) + ': not published for this place.</p>';
      var max = Math.max.apply(null, vals.map(function (x) { return x || 0; })) || 1;
      return '<figure class="gap-chart"><figcaption><strong>' + esc(title) + '</strong>' + Pl.scope(at || here) + (note ? '<span class="note">' + esc(note) + '</span>' : '') + '</figcaption>' +
        '<div class="gap-rows">' + rows.map(function (r) {
          var w = r[1] == null ? 0 : r[1] / max * 100;
          return '<div class="gap-row"><p class="gap-band">' + esc(r[0]) + '</p><div class="bar-row">' +
            '<span class="bar ' + (cls || 'households') + '" style="width:calc((100% - 7rem) * ' + (w / 100).toFixed(4) + ')" title="' + esc(r[0] + ': ' + (r[1] == null ? 'not published' : fmt(r[1]))) + '"></span>' +
            '<span class="bar-value">' + esc(r[1] == null ? 'Not published' : fmt(r[1])) + '</span></div></div>';
        }).join('') + '</div>' + (src ? '<p class="metric-source">' + Pl.srcLine(src[0], src[1]) + '</p>' : '') + '</figure>';
    }

    var Viz = global.LabViz;
    var placeShort = String(entry.label || '').replace(/ (town|city|CDP)$/, '');
    var fips = place && place.rec ? place.rec.containing_county_fips : null;
    // Under 250 households a town has no forecast of its own (Housing-Analytics
    // build_place_projections.py, too_small): the live page says so and points to the county.
    var smallRec = function () {
      var pp = isCounty ? null : extraFile(EXTRA.projection('places')), r = pp && pp.places ? pp.places[geoid] : null;
      return r && r.too_small ? r : null;
    };
    var tooSmallNote = function () {
      var r = smallRec(); if (!r) return '';
      var hh = (r.household_inputs || {}).place_households, cn = countyName || 'the county';
      return '<div class="callout">Too small for a reliable town forecast' + (hh != null ? ' (' + num(Math.round(hh)) + ' households; the cut-off is 250)' : '') +
        '. See ' + (fips && fips !== geoid ? '<a href="#/place/' + esc(fips) + '/future">' + esc(cn) + '</a>' : esc(cn)) + ' for the county forecast.</div>';
    };
    // A town's share of a county forecast is an estimate, so its headline is rounded to the
    // nearest ten, as on the live page (js/hna/hna-controller.js formatIncrementalUnitsDisplay).
    // A negative 20-year figure is a forecast with fewer households, not homes to build. The signed value stays;
    // the words say what it is (round-three review: Hinsdale County shows -9).
    var DECLINE = 'A net decrease: the forecast has fewer households here in 20 years. It does not show that no homes need replacing, preserving or making affordable.';
    var needWhy = function (usual) { var x = v('future_units_needed_20yr'); return x != null && x < 0 ? DECLINE : usual; };
    var needNum = function (x) { return x == null || isCounty ? num(x) : num(Math.round(x / 10) * 10); };
    // The 20-year need as one bar (Gemini round 16, page 03; paul 11-06 "fix the gaps"). The solid parts are the
    // figure used, resident growth plus in-commuters who would move closer, as the live HNA adds them. Today's
    // shortfall and homes lost to age sit on the same scale, hatched, because the live model counts them apart;
    // adding them here would change the HNA's number.
    function needStrip() {
      var used = v('future_units_needed_20yr'), grow = v('future_units_growth_20yr'), inc = v('incommuter_need_units');
      if (smallRec() || used == null || grow == null || !(used > 0)) return '';
      var here0 = String(entry.label || '').replace(/ \((city|town|CDP)\)$/, '') || 'This place';
      var end = DOLA_BASE + 20, rest = inc != null ? Math.max(0, used - grow) : 0;
      var now = v('housing_gap_units'), lost = null;
      var cf = isCounty ? geoid : fips, pj = cf ? extraFile(EXTRA.projection(cf)) : null, pp = isCounty ? {} : extraFile(EXTRA.projection('places'));
      if (pj && pp) {
        var at = function (ys, xs) { var i = (ys || []).indexOf(end); return i > -1 && xs ? xs[i] : null; };
        var rec = isCounty ? null : (pp.places || {})[geoid] || null, hn = pj.housing_need || {};
        lost = isCounty ? at(pj.years, (hn.replacement || {}).cumulative_units) : rec ? at(rec.years, rec.replacement_cumulative) : null;
        if (lost != null) lost = Math.round(lost);
      }
      var whole = used + (now > 0 ? now : 0) + (lost > 0 ? lost : 0);
      var finding = here0 + ' needs about ' + needNum(used) + ' more homes by ' + end + (inc != null ? ': resident growth plus in-commuters who would move closer' : ' for resident growth');
      var apart = [now > 0 ? num(now) + ' short today at or below 30% AMI' : null, lost > 0 ? num(lost) + ' lost to age by ' + end : null].filter(Boolean);
      var seg = function (val, cls) { return val > 0 ? '<span class="ns-seg ' + cls + '" style="width:' + (val / whole * 100).toFixed(1) + '%"></span>' : ''; };
      var key = function (cls, label, val) { return '<li><i class="' + cls + '"></i>' + esc(label) + ' <b>' + esc(num(val)) + '</b></li>'; };
      return '<figure class="ladder need-strip" aria-label="' + esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(here0 + ' needs about ' + needNum(used) + ' more homes by ' + end, 'State Demography Office, Census')) + '">' +
        '<figcaption><strong data-role="need-finding">' + esc(finding) + '</strong>' + (apart.length ? '<span class="ns-apart">Counted apart: ' + esc(apart.join('; ')) + '.</span>' : '') + '</figcaption>' +
        '<div class="ns-bar" aria-hidden="true">' + seg(grow, 'ns-grow') + seg(rest, 'ns-inc') + seg(now, 'ns-now') + seg(lost, 'ns-lost') + '</div>' +
        '<ul class="ns-key" aria-hidden="true">' + key('ns-grow', 'Resident growth', grow) + (inc != null ? key('ns-inc', 'In-commuters who would move closer', rest) : '') +
        (now > 0 ? key('ns-now', 'Short today, at or below 30% AMI (apart)', now) : '') + (lost > 0 ? key('ns-lost', 'Lost to age and demolition (apart)', lost) : '') + '</ul>' +
        '<p class="note">Solid parts add to the figure used. Hatched parts are counted apart, as the HNA does, and are explained under Housing need over 20 years.</p><p class="metric-source">' + Pl.srcLine(dolaName(), LINKS.dola) + '</p></figure>';
    }

    // Renter households at or below each income level, as the gap file publishes them (running totals).
    function runningTotals() {
      if (!Viz || !place || !place.bands) return '';
      var first = place.bands[0];
      return Viz.cumulative({
        title: 'Renter households at or below each income level',
        scope: Pl.scope(here),
        answer: first && first.households != null ? num(first.households) + ' renter households earn 30% of area income or less.' : null,
        rows: place.bands.map(function (b) { return ['\u2264' + b.band + '% AMI', b.households]; }),
        tiles: tilesFor(place.rec.renter_households_total, first && first.households),
        note: 'Running totals: each level includes the ones below it.',
        source: Pl.srcLine([['Census ACS 2020\u20132024', 'https://data.census.gov/table/ACSDT5Y2024.B25118'], ['HUD FY2026 income limits', 'https://www.huduser.gov/portal/datasets/il.html']])
      });
    }

    // The three key figures the drawing puts above the chart; the share is worked from the two published counts.
    function tilesFor(total, low) {
      if (total == null || low == null || !total) return null;
      return [[num(total), 'Renter households'], [num(low), 'At or below 30% AMI'], [Math.round(low / total * 100) + '%', 'Share at or below 30% AMI']];
    }

    // Household types, as the live HNA groups them (js/hna/hna-renderers.js): the four named groups are
    // non-overlapping parts of all households, and "Other" is what is left.
    function householdTypes() {
      var tot = pv('DP02_0001E');
      if (!Viz) return '';
      var src = Pl.srcLine(acs + ', DP02', acsUrl('DP02')), base = { title: 'Household type mix', scope: Pl.scope(here), color: Viz.COLORS.households, source: src };
      // No household total: the shares have nothing to be shares of, so the chart says so instead of disappearing.
      if (tot == null || !isFinite(tot)) return Viz.unavailable(Object.assign(base, { empty: 'The Census table has no published count of all households for this place, so the household type mix can\u2019t be shown.' }));
      // Each group from its DP02 counts. A count the Census table does not publish stays missing: it is never read
      // as 0, the "Other" remainder is not worked out from the groups that are there, and no group is named the
      // largest. A published 0 is a real count and is kept.
      var groups = [['Married couple', ['DP02_0002E'], 'married couples'], ['Cohabiting couple', ['DP02_0004E'], 'cohabiting couples'],
        ['Single parent', ['DP02_0007E', 'DP02_0011E'], 'single parents'], ['Living alone', ['DP02_0008E', 'DP02_0012E'], 'people living alone']];
      var missing = [];
      var rows = groups.map(function (gr) {
        var sum = 0, known = true;
        gr[1].forEach(function (k) { var v = pv(k); if (v == null || !isFinite(v)) known = false; else sum += v; });
        if (!known) missing.push(gr[2]);
        return [gr[0], known ? sum : null];
      });
      if (missing.length === groups.length) return Viz.unavailable(Object.assign(base, { empty: 'The Census table has no published counts for any household type here, so the mix can\u2019t be shown. All ' + num(tot) + ' households are counted in the total above.' }));
      if (missing.length) {
        var names = missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] : missing[0];
        return Viz.sortedBars({ title: 'Household type mix', scope: Pl.scope(here), color: Viz.COLORS.households, total: tot,
          answer: 'The largest group can\u2019t be named: the Census table has no published count for ' + names + '.',
          note: 'Shares are of all ' + num(tot) + ' households. \u201cOther (shared, etc.)\u201d is what is left after the groups above, so it is left out until every group has a published count.',
          rows: rows, source: src });
      }
      var known4 = rows.reduce(function (t, r) { return t + r[1]; }, 0);
      rows.push(['Other (shared, etc.)', Math.max(0, tot - known4)]);
      var top = rows.slice().sort(function (a, b) { return b[1] - a[1]; })[0];
      return Viz.sortedBars({ title: 'Household type mix', scope: Pl.scope(here), color: Viz.COLORS.households,
        answer: top[0] + ' is the largest group: ' + num(top[1]) + ' of ' + num(tot) + ' households.',
        rows: rows, source: src });
    }

    // Household composition, occupation and labor force, as the live chapter sets them out.
    // A chart from the house chart set, or nothing where the page has not loaded it (the unit tests).
    var draw = function (fn, o) { return Viz ? Viz[fn](o) : ''; };
    var pf = peopleFigures(p), cnt = function (x) { return x == null ? null : num(x); };
    var acsCard = function (title, value, detail, table) { return Pl.card(title, value, detail || null, acs, acsUrl(table), here); };
    // The groups a chart can't count, named in a sentence ("service and sales").
    var missingNames = function (rows) {
      var m = rows.filter(function (r) { return r[1] == null; }).map(function (r) { return r[0].charAt(0).toLowerCase() + r[0].slice(1); });
      return m.length > 1 ? m.slice(0, -1).join(', ') + ' and ' + m[m.length - 1] : m[0] || '';
    };
    var known = function (x) { return x != null; };
    function occupationMix() {
      var src = Pl.srcLine(acs + ', DP03', acsUrl('DP03')), base = { title: 'Occupation mix', scope: Pl.scope(here), color: Viz && Viz.COLORS.blue, source: src,
        empty: 'The Census table has no published occupation counts for this place, so the mix can’t be shown.' };
      var gone = missingNames(pf.occupations);
      if (gone && pf.occupations.some(function (r) { return known(r[1]); })) {
        // Some groups are missing: the counts that are published are shown, with no shares and no largest group,
        // because the missing groups could change both.
        return draw('sortedBars', Object.assign(base, { rows: pf.occupations, noShare: true,
          answer: 'The largest group can’t be named: the Census table has no published count for ' + gone + '.',
          note: 'Counts only. Shares are left out because they would leave out ' + gone + '.' }));
      }
      return draw('sortedBars', Object.assign(base, { rows: pf.occupations,
        answer: gone ? null : (function () { var t = pf.occupations.slice().sort(function (a, b) { return b[1] - a[1]; })[0]; return t[0] + ' is the largest group of employed residents 16 and older.'; })(),
        note: gone ? null : 'Service, production and construction jobs usually line up with the lower income tiers a workforce housing project serves.' }));
    }
    function composition() {
      if (pf.households == null && !pf.occupations.some(function (r) { return known(r[1]); }) && pf.laborForce == null && pf.notInLf == null) return '';
      var lf = pf.retirees != null && pf.notInLf > 0;
      var why = function (v, need) { return v == null ? 'Not shown: it needs ' + need + ', and one of them is not published' : null; };
      return '<h2>Household composition, occupation and labor force</h2><p>How big households are, what people do for work, and how many are retired. Single-parent and living-alone households drive demand for one- and two-bedroom homes.</p>' +
        '<div class="metrics">' + acsCard('Households', cnt(pf.households), null, 'DP02') + acsCard('Family households', cnt(pf.family), pf.family == null ? why(null, 'the married-couple and single-householder counts') : 'Married couples plus householders living with relatives', 'DP02') +
        acsCard('Average household size', pf.size == null ? null : pf.size.toFixed(2), null, 'DP02') + acsCard('Average family size', pf.famSize == null ? null : pf.famSize.toFixed(2), null, 'DP02') +
        acsCard('Households with children under 18', cnt(pf.withKids), null, 'DP02') + acsCard('Households with someone 65 or older', cnt(pf.withSeniors), null, 'DP02') +
        acsCard('Residents with a disability', cnt(pf.disability), 'Civilian residents not in group quarters', 'DP02') + '</div>' +
        householdTypes() + occupationMix() +
        '<h3>Labor force status and retiree share</h3><div class="metrics">' + acsCard('Employed', cnt(pf.employed), why(pf.employed, 'the labor force and unemployed counts') || 'Residents 16 and older', 'DP03') + acsCard('Unemployed', cnt(pf.unemployed), null, 'DP03') +
        acsCard('Likely retired', cnt(pf.retirees), why(pf.retirees, 'the counts of residents 65 and older and of residents not in the labor force') || 'Estimated: 85% of residents 65 and older', 'DP05') + acsCard('Not in the labor force, under 65', cnt(pf.notInLfUnder65), why(pf.notInLfUnder65, 'the same two counts') || 'Students, caregivers, people with a disability, people not looking for work', 'DP03') + '</div>' +
        (lf ? '<p class="note">Of the ' + num(pf.notInLf) + ' residents not in the labor force, about ' + num(pf.retirees) + ' (' + Math.round(pf.retirees / pf.notInLf * 100) + '%) are 65 or older and most likely retired, and ' + num(pf.notInLfUnder65) + ' (' + Math.round(pf.notInLfUnder65 / pf.notInLf * 100) + '%) are 16 to 64. The retiree share assumes about 85% of people 65 and older are out of the workforce (about 19% of Americans 65 and older work, per the Bureau of Labor Statistics).</p>' : '');
    }
    function raceEthnicity() {
      var any = pf.races.some(function (r) { return r[1] > 0; });
      if (!any && pf.pop == null && pf.races.every(function (r) { return r[1] == null; })) return '';
      var share = function (x) { return x == null ? null : pf.pop ? pct(x / pf.pop * 100) : num(x); };
      var gone = missingNames(pf.races);
      return '<h2>Race and ethnicity</h2><p>Population by race (each single-race group, plus two or more races), with Hispanic or Latino of any race counted apart.</p>' +
        '<div class="metrics">' + acsCard('Total population', cnt(pf.pop), null, 'DP05') + acsCard('Hispanic or Latino, any race', share(pf.hispanic), null, 'DP05') +
        acsCard('White alone, not Hispanic', share(pf.nhWhite), null, 'DP05') + '</div>' +
        // A missing group is left out, never drawn as 0; shares are then of all residents, so the rest don't grow to fill the gap.
        draw('sortedBars', { title: 'Residents by race', scope: Pl.scope(here), color: Viz && Viz.COLORS.purple, rows: pf.races.filter(function (r) { return r[1] == null || r[1] > 0; }),
          total: gone ? pf.pop : null, noShare: !!gone && !pf.pop, note: gone ? 'No published count for ' + gone + (pf.pop ? '. Shares are of all ' + num(pf.pop) + ' residents.' : '. Counts only.') : null,
          empty: 'The Census table has no published counts by race for this place.', source: Pl.srcLine(acs + ', DP05', acsUrl('DP05')) }) +
        '<p class="note">Hispanic or Latino is an ethnicity that cuts across race: a person can be Hispanic and any race, so it is not one of the bars. ' +
        (pf.pop && pf.nhWhite != null ? 'The not-Hispanic white share (' + pct(pf.nhWhite / pf.pop * 100) + ') is the benchmark fair housing analysis most often uses.' : '') + '</p>';
    }
    function education() {
      if (!pf.pop25) return '';
      var gone = missingNames(pf.schooling);
      return '<h2>Educational attainment</h2><p>Highest schooling finished, for residents 25 and older.</p>' +
        '<div class="metrics">' + acsCard('Residents 25 and older', num(pf.pop25), null, 'DP02') + acsCard('High school graduate or more', pct(pf.hsPlus), null, 'DP02') +
        acsCard('Bachelor\u2019s degree or more', pct(pf.baPlus), null, 'DP02') + acsCard('Graduate or professional degree', pct(pf.grad), null, 'DP02') + '</div>' +
        draw('orderedBars', { title: 'Highest schooling finished', scope: Pl.scope(here), color: Viz && Viz.COLORS.blue, rows: pf.schooling, total: pf.pop25,
          note: gone ? 'No published count for ' + gone + '. Shares are of all ' + num(pf.pop25) + ' residents 25 and older.' : null,
          empty: 'The Census table has no published schooling counts for this place.', source: Pl.srcLine(acs + ', DP02', acsUrl('DP02')) });
    }
    // Ages: the county's State Demography Office figures, which the live page also shows for a town (it loads no town age table).
    function ages() {
      var cf = isCounty ? geoid : fips;
      if (!Viz || !cf) return '';
      var sya = extraFile(EXTRA.sya(cf)), g = ageGroups(sya);
      if (!g) return '';
      var cname = isCounty ? entry.label : countyName, sp = sya.seniorPressure, seniors = g.slice(13);
      var scope = isCounty ? Pl.scope(here) : Pl.scope({ level: 'county-proxy', countyName: countyName });
      var src = Pl.srcLine('Colorado State Demography Office, county single year of age, ' + sya.pyramidYear, LINKS.dola);
      var last = sp && sp.years ? sp.years.length - 1 : -1, i0 = sp && sp.years ? sp.years.indexOf(sya.pyramidYear) : -1;
      return '<h2>Demographic projections: age pyramid and senior pressure</h2>' +
        (isCounty ? '' : '<p class="note">Ages shown are for ' + esc(cname) + ', from the State Demography Office\u2019s county figures for ' + sya.pyramidYear + '. The live page does not load the Census age table for ' + esc(placeShort) + ', so the county stands in here too.</p>') +
        '<h3>Age pyramid</h3>' +
        Viz.pyramid({ title: 'Residents by age, ' + cname + ', ' + sya.pyramidYear, scope: scope, rows: g,
          answer: num(g.reduce(function (t, r) { return t + r[1] + r[2]; }, 0)) + ' residents; ' + num(seniors.reduce(function (t, r) { return t + r[1] + r[2]; }, 0)) + ' are 65 or older.', source: src }) +
        '<h3>Senior growth pressure</h3>' +
        Viz.orderedBars({ title: 'Residents 65 and older by age, ' + cname + ', ' + sya.pyramidYear, scope: scope, color: Viz.COLORS.purple, rows: seniors.map(function (r) { return [r[0], r[1] + r[2]]; }),
          answer: last > 0 && i0 > -1 ? 'The forecast has ' + num(sp.pop65plus[last]) + ' residents 65 and older in ' + sp.years[last] + ' (' + pct(sp.share65plus[last]) + ' of everyone), up from ' + num(sp.pop65plus[i0]) + ' (' + pct(sp.share65plus[i0]) + ') in ' + sp.years[i0] + '.' : null,
          note: 'Shares are of residents 65 and older. Older residents need more accessible, smaller homes and services nearby.', source: src });
    }

    // Commuting: residents who work elsewhere and workers who come in, from the LEHD origin-destination flows
    // (the place file for a town, the county's own LEHD file for a county).
    function commuting(title) {
      var f, yr, url = LINKS.lodes;
      if (isCounty) {
        f = extraFile(EXTRA.lehd(geoid));
        if (!f || f.within == null) return '';
        yr = f.year; url = (f.source && f.source.url) || url;
      } else {
        var fl = extraFile(EXTRA.flows);
        if (!fl || !fl.places || !fl.places[geoid]) return '';
        f = fl.places[geoid]; yr = fl.meta && fl.meta.year;
      }
      if (!Viz) return '';
      var res = f.within + f.outflow;
      keep('outflow', num(f.outflow), 'working residents who work somewhere else', ['LEHD LODES ' + (yr ? yr + ' ' : '') + 'origin-destination flows', url]);
      return Viz.commute({ title: title || 'Who commutes in and out', scope: Pl.scope(here), flows: f,
        answer: res > 0 ? num(f.outflow) + ' of ' + num(res) + ' working residents work outside ' + (isCounty ? entry.label : placeShort) + '; ' + num(f.inflow) + ' workers come in.' : null,
        source: Pl.srcLine('LEHD LODES ' + (yr ? yr + ' ' : '') + 'origin-destination flows', url) });
    }

    // The place against its county on six measures, each marked better, worse or similar in words.
    function versusCounty() {
      var CC = global.HNACountyComparison;
      if (!Viz || !CC || isCounty || !fips || fips === geoid) return '';
      var cc = loadPlace(fips);
      if (!cc.digest) return '<p role="status" class="note">Loading the county figures…</p>';
      // The live page's comparison engine (js/hna/county-comparison.js) decides which rates may honestly be compared.
      var res = CC.compare(c.digest, cc.digest);
      if (!res.available) return res.reason ? '<h2>How this place compares to its county</h2><p class="note">Not compared: ' + esc(res.reason) + '.</p>' : '';
      var WORD = { 'worse than the county': 'Worse', 'better than the county': 'Better', 'the same as the county': 'Similar' };
      var rows = res.rows.map(function (r) { return [r.label, r.place.value, r.county.value, WORD[CC.describeDelta(r)] || 'Not ranked', r]; });
      var list = function (xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
      var named = function (w) { return rows.filter(function (r) { return r[3] === w; }).map(function (r) { return r[0].charAt(0).toLowerCase() + r[0].slice(1) + ' (' + CC.formatDelta(r[4].delta) + ')'; }); };
      var better = named('Better'), worse = named('Worse');
      var ans = better.length || worse.length ? placeShort + (better.length ? ' does better on ' + list(better) : '') + (better.length && worse.length ? '; it does worse on ' : worse.length ? ' does worse on ' : '') + list(worse) + '.' : null;
      var srcs = [];
      res.rows.forEach(function (r) { [[m(r.key), d], [cc.digest.metrics[r.key], cc.digest.metrics]].forEach(function (x) {
        var t = String(sourceOf(x[0], ctx) || '').replace(/ \u00b7 \w+ confidence$/, ''), u = sourceUrl(x[0], ctx);
        if (t && !srcs.some(function (y) { return y[0] === t; })) srcs.push([t, u]);
      }); });
      return '<h2>How this place compares to its county</h2><p>A county average hides its own spread. These are the same rates, worked the same way, for ' + esc(placeShort) + ' and ' + esc(countyName) + '.</p>' +
        Viz.dotPairs({ title: placeShort + ' against ' + countyName, scope: '', answer: ans, rows: rows.map(function (r) { return r.slice(0, 4); }), placeName: placeShort, placeShort: placeShort, countyName: countyName,
          note: 'Rates only: a town usually has fewer households than its county, so counts compare little. A consolidated city and county, such as Denver or Broomfield, is the same land seen twice. Differences are in percentage points. Renter share and multifamily share describe the market and are not ranked.' +
            (res.skipped.length ? ' Not compared: ' + res.skipped.map(function (k) { return k.label.charAt(0).toLowerCase() + k.label.slice(1) + ' (' + k.reason + ')'; }).join('; ') + '.' : ''),
          source: Pl.srcLine(srcs) }) +
        '<div class="table-scroll"><table><caption>The same rates as a table</caption><thead><tr><th scope="col">Measure</th><th scope="col">' + esc(placeShort) + '</th><th scope="col">' + esc(countyName) + '</th><th scope="col" title="Place minus county, in percentage points">Difference</th><th scope="col">Reading</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><th scope="row"' + (r[4].tip ? ' title="' + esc(r[4].tip) + '"' : '') + '>' + esc(r[0]) + '</th><td>' + pct(r[1]) + '</td><td>' + pct(r[2]) + '</td><td>' + esc(CC.formatDelta(r[4].delta)) + '</td><td>' + esc(r[3]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="metric-source">' + Pl.srcLine(srcs) + '</p>';
    }

    // Three rents on one dollar scale: HUD's 2-bedroom Fair Market Rent for the county, the median rent
    // households pay here, and Zillow's typical asking rent for the town or county.
    function threeRents() {
      if (!Viz || !shared) return '';
      var hud = shared.hud.counties.filter(function (c) { return c.fips === (isCounty ? geoid : fips); })[0];
      var fmr = hud && hud.fmr ? hud.fmr.two_br : null;
      var paid = v('gross_rent_median');
      var z = extraFile('data/market/zori_rents_co.json'), zr = null, zwhere = '';
      if (z && z.cities) {
        var c = z.cities[placeShort.toLowerCase()];
        if (c && !isCounty) { zr = c.rent; zwhere = placeShort; }
        else if (z.counties && z.counties[isCounty ? geoid : fips]) { zr = z.counties[isCounty ? geoid : fips].rent; zwhere = countyName; }
      }
      var rents = [['Median rent paid here, all sizes', paid, Viz.COLORS.muted], ['HUD Fair Market Rent, 2-bedroom', fmr, Viz.COLORS.ink], ['Typical asking rent' + (zwhere ? ', ' + zwhere : ''), zr, Viz.COLORS.homes]];
      var gap = zr != null && fmr != null ? [1, 2, '$' + num(Math.abs(zr - fmr)) + (zr > fmr ? ' above' : ' below') + ' the Fair Market Rent'] : null;
      return Viz.rentScale({ title: 'Three rents on one scale', scope: '', rents: rents, gap: gap,
        answer: gap ? 'Typical asking rent is ' + gap[2].replace('the Fair Market Rent', 'HUD\u2019s 2-bedroom Fair Market Rent') + '.' : null,
        note: 'The Fair Market Rent is for a 2-bedroom home in the county\u2019s HUD area; the other two cover all sizes. The Fair Market Rent and the Census median include utilities; Zillow\u2019s asking rent is the listed rent, so the dollar difference is not like for like. Asking rents are listings, not what current tenants pay.',
        source: Pl.srcLine([[sourceOf(m('gross_rent_median'), ctx) || acs, sourceUrl(m('gross_rent_median'), ctx)], ['HUD Fair Market Rents' + (shared.hud.meta ? ', FY' + shared.hud.meta.fiscal_year : ''), LINKS.fmr], ['Zillow Observed Rent Index' + (z && z.meta ? ', ' + String(z.meta.vintage_month).slice(0, 7) : ''), LINKS.zillow]]) });
    }

    // Owners and renters as one split bar, and homes by type of building with counts and shares.
    function tenure() {
      var r = v('pct_renters');
      if (!Viz || r == null) return '';
      return Viz.splitBar({ title: 'Who owns, who rents', scope: Pl.scope(scopeOf(d.pct_renters, 'pct_renters', sctx) || here), parts: [['Owners', 100 - r, Viz.COLORS.homes], ['Renters', r, Viz.COLORS.households]],
        source: Pl.srcLine(sourceOf(m('pct_renters'), ctx), sourceUrl(m('pct_renters'), ctx)) });
    }
    function buildingTypes() {
      var rows = STRUCTURE.map(function (b) { return [b[0], pv(b[1])]; });
      if (!Viz || rows.every(function (r) { return r[1] == null; })) return '';
      var tot = rows.reduce(function (t, r) { return t + (r[1] || 0); }, 0), top = rows.slice().sort(function (a, b) { return (b[1] || 0) - (a[1] || 0); })[0];
      return Viz.sortedBars({ title: 'Homes by type of building', scope: Pl.scope(here),
        answer: top[0] + ' homes are ' + Math.round(top[1] / (tot || 1) * 100) + '% of ' + num(tot) + '.',
        rows: rows, note: 'Every bar carries its count and share, so the small types stay readable.', source: Pl.srcLine(acs + ', DP04', acsUrl('DP04')) });
    }

    // The State Demography Office's population forecast for the county, its trend alternative, and the
    // range two in three past forecasts for counties of this size stayed within (data/hna/forecast-error.json,
    // applied to the forecast as the live projection page does).
    // The live chapter's scenario detail: the forecast and its two growth sensitivities (growth scaled by 0.85
    // and 1.15 from the start year, as js/hna/hna-renderers.js draws them), read off at 5, 10 and 20 years.
    function scenarioTable() {
      var cf = isCounty ? geoid : fips;
      var pj = cf ? extraFile(EXTRA.projection(cf)) : null;
      if (!pj || !pj.years || !pj.population_dola || !pj.population_dola.length) return '';
      var base = Number(pj.population_dola[0]), y0 = pj.years[0];
      var at = [0, 5, 10, 20].filter(function (k) { return pj.years.indexOf(y0 + k) >= 0; }).map(function (k) { return pj.years.indexOf(y0 + k); });
      if (at.length < 2 || !isFinite(base)) return '';
      var lines = [['State forecast', 1], ['Growth 15% slower', 0.85], ['Growth 15% faster', 1.15]];
      var cell = function (f, i) { var p = Number(pj.population_dola[i]); return isFinite(p) ? base + f * (p - base) : null; };
      var last = at[at.length - 1];
      var rows = lines.map(function (l, n) {
        var end = cell(l[1], last), ch = end == null ? null : Math.round(end - base);
        return '<tr' + (n === 0 ? ' class="row-strong"' : '') + '><th scope="row">' + esc(l[0]) + '</th>' + at.map(function (i) { var x = cell(l[1], i); return '<td>' + (x == null ? '—' : num(Math.round(x))) + '</td>'; }).join('') +
          '<td>' + (ch == null ? '—' : (ch > 0 ? '+' : ch < 0 ? '−' : '') + num(Math.abs(ch))) + '</td></tr>';
      }).join('');
      return '<h3>Each scenario, year by year</h3>' +
        '<p>The slower and faster lines scale the forecast’s growth from ' + y0 + ', not its starting population, so all three start at ' + num(base) + '. They show how much the need moves if growth runs 15% off the forecast.' + (isCounty ? '' : ' County figures: the office forecasts counties.') + '</p>' +
        '<div class="table-scroll"><table><caption>Residents of ' + esc(isCounty ? entry.label : countyName) + ' by scenario</caption><thead><tr><th scope="col">Scenario</th>' +
        at.map(function (i) { return '<th scope="col">' + pj.years[i] + '</th>'; }).join('') + '<th scope="col">Change by ' + pj.years[last] + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="metric-source">' + Pl.srcLine('Colorado State Demography Office forecast, base year ' + pj.baseYear, LINKS.dola) + '</p>';
    }
    function projectionRange() {
      var cf = isCounty ? geoid : fips;
      if (!Viz || !cf) return '';
      var pj = extraFile(EXTRA.projection(cf)), fe = extraFile(EXTRA.forecastError);
      if (!pj || !fe || !pj.years || !pj.population_dola) return '';
      var pop0 = pj.population_dola[0], low = null, high = null;
      if (fe.errorPct && fe.sizeClasses) {
        var k = fe.sizeClasses.map(function (sc) { return pop0 >= sc.min && (sc.max == null || pop0 < sc.max); }).indexOf(true), errs = fe.errorPct[k];
        if (errs) {
          low = pj.population_dola.map(function (p, i) { var e = i === 0 ? 0 : errs[i - 1]; return e == null ? null : p * (1 - e / 100); });
          high = pj.population_dola.map(function (p, i) { var e = i === 0 ? 0 : errs[i - 1]; return e == null ? null : p * (1 + e / 100); });
        }
      }
      var cname = isCounty ? entry.label : countyName, last = pj.years.length - 1;
      return Viz.projection({ title: 'Population forecast for ' + cname + ', ' + pj.years[0] + ' to ' + pj.years[last], scope: isCounty ? '' : Pl.scope({ level: 'county-proxy', countyName: countyName }),
        series: { years: pj.years, main: pj.population_dola, alt: pj.population_trend, low: low, high: high },
        labels: { main: 'State forecast', alt: 'Past trend', band: 'Where 2 in 3 past forecasts landed' },
        answer: 'The State Demography Office expects ' + num(pj.population_dola[last]) + ' residents in ' + pj.years[last] + ', up from ' + num(pop0) + '.',
        note: 'Years on a true time scale. The range comes from how far past trend forecasts for Colorado counties of this size missed, years out.',
        source: Pl.srcLine([['Colorado State Demography Office forecast, base year ' + pj.baseYear, LINKS.dola], [fe.source || 'Past forecast record', LINKS.dola]]) });
    }

    // The 20-year need as the parts that add up to it, and the yearly pace against recent permits.
    function outlook() {
      var g = v('future_units_growth_20yr'), inc = v('incommuter_need_units');
      if (smallRec()) return tooSmallNote();
      if (!Viz || g == null) return '';
      // A shrinking forecast has no parts to stack: say so in words, with the published figures.
      if (g <= 0) return '<div class="callout">The forecast has fewer households here in 20 years: resident growth needs ' + signed(g, num) + ' homes' +
        (inc != null ? ', in-commuters add ' + num(inc) + ', for a net of ' + signed(g + inc, num) : '') + '. There is no added need to draw.</div>';
      var pm = extraFile(EXTRA.permits), pr = pm && (isCounty ? (pm.counties || {})[geoid] : (pm.places || {})[geoid]);
      var pvn = pr && pr.production_vs_need, pace = null;
      if (pvn && pvn.annual_need_10yr_dola > 0 && pvn.permits_avg_annual_5yr != null) {
        pace = { need: pvn.annual_need_10yr_dola, permits: pvn.permits_avg_annual_5yr, sf: pr.avg_annual_sf_5yr ? pr.avg_annual_sf_5yr.value : null, mf: pr.avg_annual_mf_5yr ? pr.avg_annual_mf_5yr.value : null };
      }
      var used = pr && pr.avg_annual_total_5yr ? pr.avg_annual_total_5yr : null;
      var ans = pace ? 'Recent permits, ' + num(pace.permits) + ' a year, run ' + (pace.permits >= pace.need ? 'above' : 'below') + ' the ' + num(pace.need) + ' a year the forecast needs.' : null;
      return Viz.outlook({ title: 'Homes needed over 20 years', scope: Pl.scope(scopeOf(d.future_units_needed_20yr, 'future_units_needed_20yr', sctx) || here), years: 20,
        parts: [['Resident growth', g, Viz.COLORS.homes], ['In-commuters who would live here', inc, Viz.COLORS.blue]], pace: pace, answer: ans,
        note: used ? 'Permits are the yearly average of ' + used.years_used + ' year' + (used.years_used === 1 ? '' : 's') + ' with data, ' + used.window + '. Need a year is the forecast\u2019s first 10 years.' : null,
        source: Pl.srcLine([[sourceOf(m('future_units_needed_20yr'), ctx), sourceUrl(m('future_units_needed_20yr'), ctx)], ['Census Building Permits Survey', 'https://www.census.gov/construction/bps/']]) });
    }

    // How workers who live here get to work. A town's file carries the ACS counts (B08301); a county's
    // carries the subject table's shares (S0801), and any mode missing from it is named.
    function modeShare() {
      var s = c.summary || {}, b = s.acsB08301, s8 = s.acsS0801 || {};
      if (!Viz) return '';
      var sy = s8._acsYear, one = s8._acsSeries === 'acs1';
      var sLabel = sy ? 'ACS ' + (one ? sy + ' 1-year' : (sy - 4) + '-' + sy + ' 5-year') + ', S0801' : null;
      var sUrl = sy ? 'https://data.census.gov/table/ACSST' + (one ? '1Y' : '5Y') + sy + '.S0801?g=' + census(geoid) : null;
      var tiles = s8.S0801_C01_046E != null ? [[Number(s8.S0801_C01_046E).toFixed(1) + ' minutes', 'average trip to work']] : null;
      // A county draws its S0801 shares, as the public page does, even now its file also carries B08301 counts.
      if (b && b.total > 0 && (!isCounty || s8.S0801_C01_003E == null)) {
        var rows = [['Drove alone', b.drive], ['Carpooled', b.carpool], ['Worked from home', b.work_from_home], ['Walked', b.walk], ['Bicycle', b.bike], ['Public transit', b.transit], ['Other', b.other]]
          .sort(function (x, y) { return (y[1] || 0) - (x[1] || 0); });
        // A measured zero is "none reported"; a missing count is unknown and is never read as zero.
        var known = function (v) { return v != null && v !== '' && isFinite(Number(v)); };
        var none = rows.filter(function (r) { return known(r[1]) && Number(r[1]) === 0; }).map(function (r) { return r[0].toLowerCase(); });
        var unknown = rows.filter(function (r) { return !known(r[1]); }).map(function (r) { return r[0].toLowerCase(); });
        rows = rows.filter(function (r) { return known(r[1]) && Number(r[1]) > 0; });
        var said = [];
        if (known(b.drive)) said.push(pct(b.drive / b.total * 100) + ' of ' + num(b.total) + ' workers who live here drive alone');
        if (known(b.work_from_home)) said.push(pct(b.work_from_home / b.total * 100) + (said.length ? '' : ' of ' + num(b.total) + ' workers who live here') + ' work from home');
        var answer = said.length ? said.join('; ') + '.' : 'The Census count for driving alone and working from home is not available for ' + num(b.total) + ' workers who live here.';
        if (said.length === 1) answer = said[0] + '; ' + (known(b.drive) ? 'the work-from-home count' : 'the drive-alone count') + ' is not available.';
        return Viz.orderedBars({ title: 'Commuting mode share', scope: Pl.scope(here), total: b.total, tiles: tiles, rows: rows,
          answer: answer,
          note: 'Workers 16 and older who live here, by how they usually get to work.' + (none.length ? ' None reported: ' + none.join(', ') + '.' : '') +
            (unknown.length ? ' Not available in the Census count: ' + unknown.join(', ') + '.' : ''),
          source: Pl.srcLine([[acs + ', B08301', acsUrl('B08301')]].concat(tiles ? [[sLabel + ' (travel time)', sUrl]] : [])) });
      }
      if (s8.S0801_C01_003E == null) return '';
      // The county file's S0801 shares: every mode the public HNA page draws (hna-renderers.js), in the same
      // fields. 005E to 008E are carpool sizes inside 004E, so they are left out.
      var S = [['Drove alone', '003'], ['Carpooled', '004'], ['Worked from home', '013'], ['Walked', '010'], ['Bicycle', '011'], ['Public transit', '009'], ['Other', '012']];
      var have = S.map(function (x) { var val = s8['S0801_C01_' + x[1] + 'E']; return [x[0], val == null || val === '' ? null : Number(val)]; });
      var missing = have.filter(function (r) { return r[1] == null; }).map(function (r) { return r[0].toLowerCase(); });
      var srows = have.filter(function (r) { return r[1] != null; }).sort(function (x, y) { return y[1] - x[1]; });
      var wfh = have[2][1];
      return Viz.orderedBars({ title: 'Commuting mode share', scope: Pl.scope(here), tiles: tiles, noShare: true, fmt: function (x) { return pct(x); },
        rows: srows,
        answer: pct(s8.S0801_C01_003E) + ' of workers who live here drive alone' + (wfh != null ? ', and ' + pct(wfh) + ' work from home.' : '.'),
        note: 'Shares of workers 16 and older who live here, by how they usually get to work' + (sy ? ', ACS ' + (one ? sy + ' 1-year' : (sy - 4) + '-' + sy + ' 5-year') : '') + '.' +
          (missing.length ? ' Not in the county file: ' + missing.join(', ') + '.' : ''),
        source: Pl.srcLine(sLabel, sUrl) });
    }

    // Jobs located here, from LEHD's workplace file. A town's job count and pay mix are its own (blocks and
    // tracts); its industries and its yearly trend are the county's, shared out by population and scaled to
    // the town's latest count, so they move with the county.
    var PAY = [['$15,000 a year or less', 'CE01', 'low'], ['$15,000 to $40,000', 'CE02', 'medium'], ['Over $40,000', 'CE03', 'high']];
    function lehdRec() {
      if (isCounty) { var cl = extraFile(EXTRA.lehd(geoid)); return cl && cl.C000 != null ? { L: cl, year: cl.wacYear || cl.year } : null; }
      var pl = extraFile(EXTRA.lehdPlace), r = pl && pl.places ? pl.places[geoid] : null;
      return r && r.lehd && r.lehd.C000 != null ? { L: r.lehd, year: r.lehd.year, town: true } : null;
    }
    function lehdScope(x, what) {
      if (!x.town) return Pl.scope(here);
      return Pl.scope({ level: 'estimate', metric: what, from: what === 'Jobs by pay' ? 'its census tracts’ pay mix, applied to its own job count'
        : countyName + '’s totals, shared out by population and scaled to the town’s ' + x.year + ' job count' });
    }
    function lehdSrc(x) { return Pl.srcLine('LEHD LODES8 workplace jobs, ' + x.year, LINKS.lodes); }
    function payBands() {
      var x = lehdRec();
      if (!Viz || !x) return '';
      var L = x.L, tot = PAY.reduce(function (t, p) { return t + (L[p[1]] || 0); }, 0);
      return Viz.orderedBars({ title: 'Wage distribution: jobs by pay', scope: lehdScope(x, 'Jobs by pay'), color: Viz.COLORS.blue, rows: PAY.map(function (p) { return [p[0], L[p[1]]]; }),
        answer: tot ? num(L.CE03) + ' of ' + num(tot) + ' jobs located here (' + Math.round(L.CE03 / tot * 100) + '%) pay over $40,000 a year.' : null,
        note: 'LEHD sorts jobs into three monthly pay bands: $1,250 or less, $1,251 to $3,333, and more. A job counts where the work is, not where the worker lives.', source: lehdSrc(x) });
    }
    function industries() {
      var x = lehdRec();
      if (!Viz || !x || !x.L.industries || !x.L.industries.length) return '';
      var top = x.L.industries.slice(0, 8), t0 = top[0];
      return Viz.orderedBars({ title: 'Top industries by employment', scope: lehdScope(x, 'Jobs by industry'), total: x.L.C000, rows: top.map(function (r) { return [r.label, r.count]; }),
        answer: t0.label + ' is the largest, with ' + num(t0.count) + ' of ' + num(x.L.C000) + ' jobs.',
        note: 'The eight largest of 20 sectors (NAICS two-digit). Shares are of all jobs located here.', source: lehdSrc(x) });
    }
    // Largest employers (site/employers.js): a dated list where one is printed, plainly "none" where not.
    function employers() {
      var E = global.LabEmployers;
      if (!E) return '';
      var files = { audit: extraFile(E.PATHS.audit), local: extraFile(E.PATHS.local), public: extraFile(E.PATHS.public), cbp: extraFile(E.PATHS.cbp), jobs: extraFile(E.PATHS.jobs) };
      var label = String(entry.label || '').replace(/ \((city|town|CDP)\)$/, '');
      return E.block(files, { geoid: geoid, name: entry.label, here: label, searchName: label, countyFips: isCounty ? geoid : fips, countyName: isCounty ? entry.label : countyName, industries: !!industries() });
    }
    function jobTrend() {
      var x = lehdRec(), ae = x && x.L.annualEmployment;
      if (!Viz || !ae) return '';
      var ys = Object.keys(ae).sort(), a = ae[ys[0]], b = ae[ys[ys.length - 1]];
      keep('jobs', num(b), 'jobs located here in ' + ys[ys.length - 1]); keep('jobsGrowth', signed((b - a) / a * 100, function (z) { return z.toFixed(1) + '%'; }), 'change in jobs, ' + ys[0] + '\u2013' + ys[ys.length - 1]);
      return Viz.timeLines({ title: 'Employment trend', scope: lehdScope(x, 'The job trend'), series: [{ label: 'Jobs located here', color: Viz.COLORS.blue, points: ys.map(function (y) { return [+y, ae[y]]; }) }],
        answer: 'Jobs went from ' + num(a) + ' in ' + ys[0] + ' to ' + num(b) + ' in ' + ys[ys.length - 1] + ' (' + signed((b - a) / a * 100, function (z) { return z.toFixed(1) + '%'; }) + ').',
        source: lehdSrc(x) });
    }
    function payTrend() {
      var x = lehdRec(), aw = x && x.L.annualWages;
      if (!Viz || !aw) return '';
      var ys = Object.keys(aw).sort(), cols = [Viz.COLORS.households, Viz.COLORS.purple, Viz.COLORS.blue];
      var first = aw[ys[0]], last = aw[ys[ys.length - 1]], ch = function (k) { return first[k] ? (last[k] - first[k]) / first[k] * 100 : null; };
      return Viz.timeLines({ title: 'Wage-band job trend', scope: lehdScope(x, 'The pay-band trend'),
        series: PAY.map(function (p, i) { return { label: p[0], color: cols[i], points: ys.map(function (y) { return [+y, aw[y][p[2]]]; }) }; }),
        answer: 'From ' + ys[0] + ' to ' + ys[ys.length - 1] + ', jobs paying over $40,000 changed ' + signed(ch('high'), function (z) { return z.toFixed(1) + '%'; }) + ' and jobs paying $15,000 or less ' + signed(ch('low'), function (z) { return z.toFixed(1) + '%'; }) + '.',
        source: lehdSrc(x) });
    }

    // What it takes to rent or buy here, in yearly income and hourly pay, beside HUD's 60% AMI limit.
    function wagesVsHousing() {
      var rent = v('gross_rent_median'), hm = m('median_home_value'), inc = v('median_hh_income');
      var hud = shared && shared.hud ? shared.hud.counties.filter(function (r) { return r.fips === (isCounty ? geoid : fips); })[0] : null;
      var il60 = hud && hud.income_limits ? hud.income_limits.il60_4person : null, buy = hm ? buyIncome(hm.value) : null;
      var rows = [];
      if (rent != null) rows.push(['Rent the median home', money(rent) + ' a month', rent * 12 / 0.3]);
      if (buy != null) rows.push(['Buy the typical home', money(hm.value), buy]);
      if (il60 != null) rows.push(['Qualify for a tax credit home at 60% AMI, family of four', 'HUD limit', il60, true]);
      if (!rows.length) return '';
      var hr = function (y) { return '$' + (y / 2080).toFixed(2); };
      var x = lehdRec(), share = x && x.L.CE03 != null && x.L.C000 ? Math.round(x.L.CE03 / x.L.C000 * 100) : null;
      return '<h3>Wages vs housing affordability</h3>' +
        '<p>' + (rent != null && buy != null ? 'Renting the median home takes ' + hr(rent * 12 / 0.3) + ' an hour, full time; buying the typical home takes ' + hr(buy) + '.' : '') + '</p>' +
        '<div class="table-scroll"><table><caption>Income to rent or buy, at 30% of income</caption><thead><tr><th scope="col">Housing</th><th scope="col">Cost</th><th scope="col">Yearly income</th><th scope="col">Hourly, full time</th><th scope="col">Against the median household</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td><td>' + (r[3] ? 'Up to ' : '') + money(r[2]) + '</td><td>' + hr(r[2]) + '</td><td>' + (inc ? Math.round(r[2] / inc * 100) + '%' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        '<p class="note">Full time is 2,080 hours a year. Buying uses the same loan terms as the chart in the afford chapter.' + (share != null ? ' ' + share + '% of jobs located here pay over $40,000 a year, the top LEHD pay band; it starts below all three incomes, so the job data cannot say how many workers reach them.' : '') + '</p>' +
        '<p class="metric-source">' + Pl.srcLine([[sourceOf(m('gross_rent_median'), ctx) || acs, sourceUrl(m('gross_rent_median'), ctx)], [sourceOf(hm, ctx), sourceUrl(hm, ctx)], ['HUD income limits' + (shared && shared.hud && shared.hud.meta ? ', FY' + shared.hud.meta.income_limits_fiscal_year : ''), LINKS.il]]) + '</p>';
    }
    // NLIHC's housing wage: the full-time hourly pay HUD's Fair Market Rent takes at 30% of income.
    function housingWage() {
      var n = extraFile(EXTRA.nlihc), r = n && n.by_county ? n.by_county[isCounty ? geoid : fips] : null;
      if (!r) return '';
      var nm = n.meta || {}, src = (nm.report_name || 'NLIHC Out of Reach') + ', released ' + longDate(nm.released), at = isCounty ? Pl.AT.county : Pl.AT.countyProxy(countyName);
      var hr = function (x) { return x == null ? null : '$' + Number(x).toFixed(2) + ' an hour'; };
      return '<h3>Colorado labor market affordability: the housing wage</h3><div class="metrics">' +
        Pl.card('Housing wage, 2-bedroom', hr(r.two_br_housing_wage), 'To pay the ' + money(r.fmr_2br) + ' Fair Market Rent', src, nm.source_url, at) +
        Pl.card('Housing wage, 1-bedroom', hr(r.one_br_housing_wage), 'To pay the ' + money(r.fmr_1br) + ' Fair Market Rent', src, nm.source_url, at) +
        Pl.card('Average renter wage', hr(r.renter_mean_wage), r.county_name + ' County renters', src, nm.source_url, at) +
        Pl.card('Short of the 2-bedroom wage', hr(r.gap_2br), r.hours_per_week_at_min_wage_2br ? r.hours_per_week_at_min_wage_2br + ' hours a week at the $' + Number(r.minimum_wage_used).toFixed(2) + ' minimum wage' : null, src, nm.source_url, at) +
        '</div><p class="note">Rents and housing wages are for HUD’s ' + esc(r.nlihc_area || 'rent area') + '; the renter wage is the county’s own.</p>';
    }

    // Downtown infill: the urban renewal or downtown authority on file, the county's Opportunity Zone
    // tracts, and four reuse patterns with typical cost and time from published case studies.
    var TOOLS = [['EPA Brownfields', 'https://www.epa.gov/brownfields'], ['Colorado Voluntary Cleanup Program', 'https://cdphe.colorado.gov/hm/voluntary-cleanup'],
      ['Colorado Brownfields Revolving Loan Fund', 'https://cdphe.colorado.gov/hm/brownfields'], ['Federal Historic Tax Credit', 'https://www.nps.gov/subjects/taxincentives/index.htm']];
    function downtown() {
      var ura = extraFile(EXTRA.ura), oz = extraFile(EXTRA.oz), reuse = extraFile(EXTRA.reuse);
      if (!ura || !oz || !reuse) return '';
      var cf = isCounty ? geoid : fips, norm = function (x) { return String(x || '').toLowerCase().replace(/^(city and county of|city of|town of)\s+/, '').trim(); };
      var names = [norm(isCounty ? String(entry.label).replace(/ County$/, '') : placeShort)];
      if (isCounty && shared && shared.gapPlace) Object.keys(shared.gapPlace.places).forEach(function (k) { var r = shared.gapPlace.places[k]; if (r.containing_county_fips === geoid) names.push(norm(r.place_name)); });
      var hits = (ura.uras || []).filter(function (u) { return names.indexOf(norm(u.jurisdiction)) > -1; });
      var ozn = (oz.features || []).filter(function (f) { return f.properties && f.properties.county_fips === cf && f.properties.designated !== false; }).length;
      var um = ura.meta || {}, cname = isCounty ? entry.label : countyName;
      var range = function (x) { return /^\d+-\d+$/.test(String(x)) ? '$' + String(x).replace('-', 'k–$') + 'k' : String(x || '').replace(/(\d)-(\d)/g, '$1–$2').replace(/(\d)K\b/g, '$1k').replace(/ \(write-down or low FMV\)/, ''); };
      var P = { hotel_motel_to_residential: 'Hotel or motel to housing', office_to_residential: 'Office to housing', surface_parking_infill: 'Building on a surface parking lot', underutilized_commercial_parcel: 'Underused commercial site' };
      return '<h2>Downtown redevelopment opportunities</h2><p>Old hotels, empty offices, parking lots and underused commercial sites can draw on tools a greenfield site cannot: tax increment from an urban renewal authority, Opportunity Zone equity, historic tax credits and brownfield cleanup money.</p>' +
        '<div class="metrics">' +
        Pl.card('Urban renewal or downtown authority', hits.length ? hits.map(function (u) { return u.name; }).join('; ') : 'None on file', hits.length ? 'Plans and tax increment change often; confirm with the authority.' : 'Ask the town; some run a downtown development authority instead.', 'Colorado URA registry, ' + longDate(um.as_of), hits.length && hits[0].url ? hits[0].url : null, here).replace('<div class="metric">', '<div class="metric word">') +
        Pl.card('Opportunity Zone tracts in ' + cname, num(ozn), 'Capital gains invested through a Qualified Opportunity Fund can be deferred.', 'CDFI Fund, Qualified Opportunity Zones designated in 2018', (oz.meta || {}).url || 'https://www.cdfifund.gov/opportunity-zones', isCounty ? Pl.AT.county : Pl.AT.countyProxy(countyName)) +
        '</div>' +
        '<div class="table-scroll"><table><caption>Reuse patterns to evaluate</caption><thead><tr><th scope="col">Pattern</th><th scope="col">Typical cost a home</th><th scope="col">Typical time</th></tr></thead><tbody>' +
        Object.keys(reuse.patterns || {}).map(function (k) { var q = reuse.patterns[k]; return '<tr><th scope="row">' + esc(P[k] || k) + '</th><td>' + esc(range(q.typical_cost_per_unit_K)) + '</td><td>' + esc(String(q.typical_timeline_months || '').replace('-', '–')) + ' months</td></tr>'; }).join('') +
        '</tbody></table></div><p class="note">Typical ranges from CHFA and Novogradac case studies, not quotes; costs swing 30–50% with the building’s age, systems, asbestos or lead, and local code.</p>' +
        '<p class="metric-source">Ranges: COHO adaptive reuse reference guide, ' + esc(longDate((reuse.meta || {}).as_of) || 'no date in the source') + '. Cleanup and credit programs: ' + TOOLS.map(function (t) { return '<a href="' + esc(t[1]) + '" target="_blank" rel="noopener">' + esc(t[0]) + '</a>'; }).join(' · ') + '</p>';
    }

    // The market call for this place: the rule's verdict, then each signal with its own source.
    function marketCall() {
      var md = extraFile(EXTRA.direction), r = md && (isCounty ? (md.counties || {})[geoid] : (md.places || {})[geoid]);
      if (!r || !r.call) return '';
      var S = (md.meta || {}).sources || {}, g = r.signals || {}, sg = function (x) { return signed(x, function (z) { return z.toFixed(1) + '%'; }); };
      var mon = function (x) { var t = Date.parse(x); return isNaN(t) ? x : new Date(t).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
      var ROWS = [
        ['Homes permitted', g.permits, S.permits, function (s) { return s.period_a ? sg(s.value) + ': ' + num(s.units_a) + ' homes in ' + s.period_a + ', ' + num(s.units_b) + ' in ' + s.period_b : sg(s.value); }],
        ['Home prices', g.price, S.price, function (s) { return sg(s.value) + (s.from_year ? ', ' + s.from_year + '–' + s.to_year : ' in the year to ' + s.to_year); }],
        ['Rents', g.rent, S.rent, function (s) { return sg(s.value) + ' in the year to ' + mon(s.month); }],
        ['People in households', g.population, S.population, function (s) { return sg(s.value) + ' a year, ' + s.from_year + '–' + s.to_year; }],
        ['Jobs', g.jobs, S.jobs, function (s) { return sg(s.value) + ', ' + s.from_year + '–' + s.to_year; }]
      ].filter(function (x) { return x[1]; });
      var call = String(r.call).replace(/_/g, ' '), def = ((md.meta || {}).calls || {})[r.call];
      return '<h3>Market direction</h3><p><strong>' + esc(call.charAt(0).toUpperCase() + call.slice(1)) + '.</strong> ' + esc(def || '') +
        (r.county_call && !isCounty ? ' ' + esc(countyName) + ' is ' + esc(String(r.county_call).replace(/_/g, ' ')) + '.' : '') + '</p>' +
        '<div class="table-scroll"><table><caption>The signals behind the call</caption><thead><tr><th scope="col">Signal</th><th scope="col">Change</th><th scope="col">Reading</th><th scope="col">Source</th></tr></thead><tbody>' +
        ROWS.map(function (x) { var s = x[1], ok = s.value != null; return '<tr><th scope="row">' + x[0] + '</th><td>' + esc(ok ? x[3](s) : 'Not available' + (s.unavailable_reason ? ': ' + s.unavailable_reason : '')) + '</td><td>' + esc(s.reading || '') + '</td><td>' + (x[2] ? '<a href="' + esc(x[2].url) + '" target="_blank" rel="noopener">' + esc(String(x[2].source).split(/[,(—]/)[0].trim()) + '</a>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }

    // Households and homes needed year by year. A county reads its own State Demography Office series; a town
    // reads its own stored projection (the county's growth times the town's blended share of households and
    // recent permits), the one the 20-year figure uses.
    function homesByYear() {
      if (!Viz) return '';
      if (isCounty) {
        var pj = extraFile(EXTRA.projection(geoid)), hn = pj && pj.housing_need;
        if (!hn || !hn.households_dola) return '';
        var yrs = pj.years, last = yrs.length - 1, hh = hn.households_dola, un = hn.units_needed_dola;
        return Viz.timeLines({ title: 'Projected households over time', scope: '', series: [{ label: 'Households', color: Viz.COLORS.households, points: yrs.map(function (y, i) { return [y, hh[i]]; }) }]
          .concat(un ? [{ label: 'Homes needed for them', color: Viz.COLORS.homes, dash: true, points: yrs.map(function (y, i) { return [y, un[i]]; }) }] : []),
          answer: 'The forecast has ' + num(hh[last]) + ' households in ' + yrs[last] + ', ' + num(hh[last] - hh[0]) + ' more than in ' + yrs[0] + '.',
          note: 'Homes needed adds a ' + Math.round((hn.target_vacancy || 0) * 100) + '% vacancy cushion so people can move.',
          source: Pl.srcLine('Colorado State Demography Office forecast, base year ' + pj.baseYear, LINKS.dola) });
      }
      var pp = extraFile(EXTRA.projection('places')), r = pp && pp.places ? pp.places[geoid] : null;
      if (!r || !r.incremental_units_needed || r.too_small) return '';
      var ys = r.years, n = ys.length - 1, inc = r.incremental_units_needed, rep = r.replacement_cumulative;
      return Viz.timeLines({ title: 'Homes needed as projected households grow over time', scope: Pl.scope({ level: 'estimate', metric: 'Homes needed', from: 'the ' + countyName + ' forecast, at ' + placeShort + '’s ' + (r.shares.blended * 100).toFixed(1) + '% blended share' }),
        series: [{ label: 'For new households', color: Viz.COLORS.homes, points: ys.map(function (y, i) { return [y, inc[i]]; }) }]
          .concat(rep ? [{ label: 'To replace homes lost', color: Viz.COLORS.muted, dash: true, points: ys.map(function (y, i) { return [y, rep[i]]; }) }] : []),
        answer: 'Growth here needs about ' + needNum(inc[n]) + ' more homes by ' + ys[n] + (rep ? ', plus ' + num(rep[n]) + ' to replace homes lost.' : '.'),
        note: 'The share blends ' + placeShort + '’s ' + (r.shares.household * 100).toFixed(1) + '% of county households with its ' + (r.shares.permit == null ? 'permits' : (r.shares.permit * 100).toFixed(1) + '% of county permits, ' + r.shares.permit_window) + '. Replacement is not in the 20-year figure above.',
        source: Pl.srcLine('Colorado State Demography Office forecast, base year ' + DOLA_BASE + ', shared out to the town', LINKS.dola) });
    }

    // The 20-year growth in homes split by today's income mix of all households (renters and owners, HUD CHAS).
    function demandByIncome() {
      var g = v('future_units_growth_20yr'), cr = chasRec();
      if (!Viz || g == null || g <= 0 || !cr || !cr.src || !cr.src.renter_hh_by_ami || !cr.src.owner_hh_by_ami) return '';
      var a = cr.src.renter_hh_by_ami, o = cr.src.owner_hh_by_ami;
      var hh = T5.map(function (t) { return ((a[t[0]] || {}).total || 0) + ((o[t[0]] || {}).total || 0); }), all = hh.reduce(function (s, x) { return s + x; }, 0);
      if (!all) return '';
      var rows = T5.map(function (t, i) { return [t[1], Math.round(g * hh[i] / all)]; });
      return Viz.orderedBars({ title: 'Projected housing demand by affordability tier', scope: Pl.scope(scopeOf(d.future_units_growth_20yr, 'future_units_growth_20yr', sctx) || here), total: g, color: Viz.COLORS.homes, rows: rows,
        answer: 'If new households earn like today’s, about ' + num(rows[0][1] + rows[1][1]) + ' of the ' + num(g) + ' added homes are for households at or below 50% AMI.',
        note: 'Today’s renters and owners together, by HUD income tier, applied to the 20-year growth in homes. A planning split, not a forecast of incomes.',
        source: Pl.srcLine([[sourceOf(m('future_units_growth_20yr'), ctx), sourceUrl(m('future_units_growth_20yr'), ctx)], [cr.label, LINKS.chas]]) });
    }

    // ── What to do about it ──────────────────────────────────────────────────────────────────────────
    // The live chapter's need summary at its default reading: 20 years, the forecast's target vacancy and
    // DOLA's household forecast (js/hna/hna-controller.js applyAssumptions and buildNeedReconciliation).
    // The 20-year figures are the digest's own; the rest are read from the files the live page reads.
    function needSummary() {
      var used = v('future_units_needed_20yr'), grow = v('future_units_growth_20yr');
      if (smallRec()) return '<h2>Housing need over 20 years</h2>' + tooSmallNote();
      if (used == null || grow == null) return '';
      var cf = isCounty ? geoid : fips, pj = cf ? extraFile(EXTRA.projection(cf)) : null;
      var pp = isCounty ? {} : extraFile(EXTRA.projection('places')), pm = extraFile(EXTRA.permits);
      if (!pj || !pp || !pm) return '<p role="status" class="note">Loading the forecast and permit files…</p>';
      var pr = (isCounty ? pm.counties : pm.places) || {}, prm = pr[geoid] || null, rec = isCounty ? null : (pp.places || {})[geoid] || null;
      var hn = pj.housing_need || {}, end = (pj.baseYear || DOLA_BASE) + 20, pop, now, at = function (ys, xs) { var i = (ys || []).indexOf(end); return i > -1 && xs ? xs[i] : null; };
      var units = isCounty ? (pj.base || {}).housing_units : pv('DP04_0001E');
      keep('base', num(units), 'homes today to build from', isCounty ? [dolaName(), LINKS.dola] : [acs + ', DP04', acsUrl('DP04')]);
      var share = rec && rec.shares && rec.shares.blended != null ? Math.min(1, Math.max(0, rec.shares.blended)) : null;
      var mig = pj.net_migration_20y == null ? null : isCounty ? pj.net_migration_20y : share != null ? pj.net_migration_20y * share : null;
      var lost = isCounty ? at(pj.years, (hn.replacement || {}).cumulative_units) : rec ? at(rec.years, rec.replacement_cumulative) : null;
      var permits = prm && prm.avg_annual_total_5yr ? prm.avg_annual_total_5yr : null, perYear = used / 20;
      // The digest's 20-year figure is rounded. The live page adds the homes lost to age to the unrounded
      // total (resident growth from the projection file plus the in-commuter count), so the lab carries the
      // same unrounded growth and rounds only for display. Used only when it rounds to the digest's growth.
      var growRaw = isCounty ? at(pj.years, hn.incremental_units_needed_dola) : rec ? at(rec.years, rec.incremental_units_needed) : null;
      var usedRaw = growRaw != null && Math.round(growRaw) === grow ? used - grow + growRaw : used;
      var ratio = permits && perYear > 0 ? permits.value / perYear : null;
      if (permits) keep('permits', num(permits.value), 'homes permitted a year at the recent pace (' + permits.window + ')', ['Census Building Permits Survey', 'https://www.census.gov/construction/bps/']);
      var inc = v('incommuter_need_units'), incHi = v('incommuter_need_units_high'), gap30 = v('ami_gap_30pct'), gap50 = v('ami_gap_50pct');
      pop = v('population_projection_20yr'); now = pv('DP05_0001E'); var size = pv('DP02_0016E');
      var vac = hn.target_vacancy != null ? hn.target_vacancy * 100 : null;
      // The live page's projection assumptions (js/hna/hna-controller.js applyAssumptions): a horizon, and for a
      // county a target vacancy. A county's resident growth is the rise in forecast households over the horizon
      // divided by one minus the vacancy target, the arithmetic behind the stored 20-year figure; a town reads
      // its stored projection at the horizon year, which the vacancy control does not move on the live page
      // either. The in-commuter count is today's and is added whole at every horizon, as the live page adds it.
      // With nothing picked, every figure below is the stored 20-year reading, unchanged.
      var Q = new URLSearchParams(((global.location && global.location.hash) || '').split('?')[1] || '');
      var base0 = pj.baseYear || DOLA_BASE, hzPick = Number(Q.get('f.hz')), vacPick = parseFloat(Q.get('f.vac'));
      var hz = [5, 10, 15].indexOf(hzPick) > -1 && (pj.years || []).indexOf(base0 + hzPick) > -1 ? hzPick : 20;
      var vacOn = isCounty && isFinite(vacPick) && vacPick >= 3 && vacPick <= 8 && Math.abs(vacPick - vac) > 0.001;
      var custom = hz !== 20 || vacOn, customFail = false;
      if (custom) {
        end = base0 + hz;
        var growC = null, hh = hn.households_dola, hi = (pj.years || []).indexOf(end);
        if (isCounty) {
          if (vacOn) vac = vacPick;
          if (hh && hi > -1 && hh[hi] > 0 && hh[0] > 0 && vac != null) growC = (hh[hi] - hh[0]) / (1 - vac / 100);
        } else if (rec) growC = at(rec.years, rec.incremental_units_needed);
        if (growC == null || !isFinite(growC)) { customFail = true; custom = false; end = base0 + 20; hz = 20; vac = hn.target_vacancy != null ? hn.target_vacancy * 100 : null; }
        else {
          grow = Math.round(growC); usedRaw = growC + (inc || 0); used = Math.round(usedRaw);
          lost = isCounty ? at(pj.years, (hn.replacement || {}).cumulative_units) : rec ? at(rec.years, rec.replacement_cumulative) : null;
          perYear = used / hz; ratio = permits && perYear > 0 ? permits.value / perYear : null;
          pop = isCounty && hi > -1 ? pj.population_dola[hi] : null; now = isCounty ? pj.population_dola[0] : null;
        }
      }
      var assume = (function () {
        var sel = function (key, label, cur, dflt, opts) {
          return '<label class="opp-menu"><span>' + esc(label) + '</span> <select data-opp-menu="' + key + '" data-default="' + esc(dflt) + '">' + opts.map(function (o) {
            return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
        };
        var hzOpts = [5, 10, 15, 20].filter(function (k) { return (pj.years || []).indexOf(base0 + k) > -1; }).map(function (k) { return [String(k), k + ' years' + (k === 20 ? ' (as published)' : '')]; });
        var tv = hn.target_vacancy != null ? hn.target_vacancy * 100 : null, vacOpts = [['', (tv == null ? 'Published' : pct(tv)) + ' (as published)']];
        for (var x = 3; x <= 8; x += 0.5) if (tv == null || Math.abs(x - tv) > 0.001) vacOpts.push([x.toFixed(1), x.toFixed(1) + '%']);
        return '<div class="need-assume"><h3>Projection assumptions</h3><div class="opp-menus" role="group" aria-label="Projection assumptions">' + sel('hz', 'Horizon', hz, '20', hzOpts) +
          (isCounty ? sel('vac', 'Target vacancy', vacOn ? vacPick.toFixed(1) : '', '', vacOpts) : '') + '</div>' +
          '<p class="note">' + (isCounty ? 'These change the figures in this part only; the charts further down stay at 20 years and the published vacancy target. '
            : 'A town reads its stored projection at the year picked. Its vacancy target is the county’s and is set in that projection, so it has no control here. The charts further down stay at 20 years. ') +
          'The forecast file ends in ' + (pj.years || [])[(pj.years || []).length - 1] + ', so 20 years is the longest horizon. Households follow the State Demography Office’s forecast; the live page can also hold or trend the headship rate.' +
          (customFail ? ' The forecast has no figure for that pick here, so the published 20-year reading is shown.' : '') + '</p></div>';
      })();
      var dolaSrc = [dolaName(), LINKS.dola], bps = ['Census Building Permits Survey' + (permits ? ', ' + permits.window : ''), 'https://www.census.gov/construction/bps/'];
      var growWord = isCounty ? 'the State Demography Office’s county household forecast' : 'this town’s share of the ' + (countyName || 'county') + ' forecast';
      var lead = pop != null && now ? 'The forecast adds ' + num(pop - now) + ' residents over ' + hz + ' years (' + pct((pop - now) / now * 100) + ')' +
        (size ? ', about ' + num((pop - now) / size) + ' households at today’s household size.' : '.') : null;
      var steps = [
        ['Renters at or below 30% AMI without a home they can afford, today', v('housing_gap_units'), false, 'A shortfall now, not a projection, so it is counted apart.', [sourceOf(m('housing_gap_units'), ctx), sourceUrl(m('housing_gap_units'), ctx)]],
        ['Resident growth by ' + end, grow, true, 'Homes for the growth in households, from ' + growWord + ', at a ' + (vac == null ? 'healthy' : pct(vac)) + ' vacancy.', dolaSrc],
        ['In-commuters who would move closer', inc, true, 'A quarter of today’s in-commuter households at or below 120% AMI' + (incHi != null ? '; ' + num(incHi) + ' if half moved' : '') + '. No source measures how many would move, so the quarter is an assumption.', [sourceOf(m('incommuter_need_units'), ctx), sourceUrl(m('incommuter_need_units'), ctx)]],
        ['Renters and in-commuters at or below 60% AMI, less rentals they can afford', v('workforce_gap_units'), false, 'Counts every in-commuter and is a shortfall today, so it is not added. The HNA’s need ranking uses it.', [sourceOf(m('workforce_gap_units'), ctx), sourceUrl(m('workforce_gap_units'), ctx)]],
        ['Homes lost to age and demolition by ' + end, lost, false, 'Yearly loss rates by building age, from 0.02% for homes built since 2010 to 0.6% for homes built before 1940, applied to the ACS year-built count' + (isCounty ? '.' : ', shared out to the town like its projection.'), [acs + ', DP04 year built', acsUrl('DP04')]]
      ];
      var rows = steps.map(function (s) {
        return '<li class="need-step' + (s[2] ? ' need-step-used' : '') + '"><p class="need-step-v">' + (s[1] == null ? 'Not published' : num(s[1]) + ' homes') + '</p>' +
          '<p class="need-step-l"><strong>' + esc(s[0]) + '</strong> <span class="need-tag">' + (s[2] ? 'In the figure used' : 'Shown apart') + '</span></p>' +
          '<p class="note">' + esc(s[3]) + '</p><p class="metric-source">' + Pl.srcLine(s[4][0], s[4][1]) + '</p></li>';
      }).join('');
      var dp = function (x) { return x == null ? null : x.toFixed(2) + '×'; };
      return '<h2>Housing need over ' + hz + ' years</h2>' +
        '<p>The State Demography Office’s forecast turned into homes: households divided by one minus a healthy vacancy rate, less the homes needed today.' + (isCounty ? '' : ' The office forecasts counties only, so a town reads its share of the county.') + '</p>' +
        (lead ? '<p class="callout">' + esc(lead) + '</p>' : '') + assume +
        '<div class="metrics">' +
        Pl.card('Homes today', units == null ? null : num(units), null, isCounty ? dolaName() : acs + ', DP04', isCounty ? LINKS.dola : acsUrl('DP04'), here) +
        Pl.card('Target vacancy', vac == null ? null : pct(vac), 'The HNA’s planning default, between HUD’s 5% healthy-market mark and a 7% cap', 'COHO methods', LINKS.methods, { level: 'index', metric: 'Target vacancy', title: 'A planning assumption the HNA sets, not a measurement.' }) +
        (custom ? Pl.card('Homes needed by ' + end, needNum(used), used < 0 ? 'A net decrease: the forecast has fewer households here by ' + end + '.' : 'Resident growth plus in-commuters who would move closer, at the assumptions picked', dolaName(), LINKS.dola, { level: 'estimate', metric: 'Homes needed by ' + end, from: 'the ' + (isCounty ? entry.label : countyName) + ' forecast' })
          : mc('Homes needed by ' + end, 'future_units_needed_20yr', needNum, needWhy('Resident growth plus in-commuters who would move closer'))) +
        Pl.card('Net migration over 20 years', mig == null ? null : num(mig), isCounty ? null : 'The county’s, times the town’s blended share (' + pct(share * 100) + ')', dolaName(), LINKS.dola, isCounty ? here : { level: 'estimate', metric: 'Net migration', from: 'the ' + countyName + ' forecast' }) +
        Pl.card('Homes permitted a year', permits ? num(permits.value) : null, permits && prm.avg_annual_sf_5yr && prm.avg_annual_mf_5yr ? num(prm.avg_annual_sf_5yr.value) + ' single-family, ' + num(prm.avg_annual_mf_5yr.value) + ' multifamily' : null, bps[0], bps[1], here) +
        Pl.card('Permits against need', dp(ratio), num(perYear) + ' homes a year reach the ' + end + ' figure', bps[0], bps[1], here) +
        '</div>' +
        (gap30 != null ? '<p>Homes short today for renters with the lowest incomes: ' + num(gap30) + ' at or below 30% AMI' + (gap50 != null ? ', ' + num(gap50) + ' at or below 50%' : '') + '. These are the counts a project, a voucher allocation or a preservation deal sizes against.</p>' : '') +
        '<h3>How the need figures fit together</h3><ol class="need-steps">' + rows + '</ol>' +
        '<p><strong>Figure used for ' + end + ': ' + needNum(used) + ' homes.</strong>' + (!isCounty && needNum(used) !== num(used) ? ' The parts above add to ' + num(used) + '; a town estimate is not precise to the single home.' : '') + (incHi != null ? ' If half the in-commuters moved closer it would be ' + num(grow + incHi) + '.' : '') +
        (lost != null ? ' Adding the homes lost to age gives ' + num(usedRaw + lost) + '; the figure used assumes every home standing today still stands.' : '') + '</p>' +
        (ratio != null ? '<p>Permits run ' + num(permits.value) + ' homes a year (' + permits.window + ', all prices) against the ' + num(perYear) + ' a year the figure needs, ' + (ratio >= 1 ? dp(ratio) + ' the pace needed.' : 'about ' + Math.round(ratio * 100) + '% of it. Existing shortfalls are on top.') + '</p>' : '') +
        '<p class="note">The forecast by scenario is in <a href="#/place/' + esc(geoid) + '/future">Where it’s heading</a>.</p>';
    }
    function dolaName() { return 'Colorado State Demography Office forecast, base year ' + DOLA_BASE; }

    // Awarded deals with a sourced write-up in this place's county (or counties), newest first.
    function countyDeals() {
      var idx = extraFile(EXTRA.deals), cross = extraFile(EXTRA.crossCounty);
      if (!idx || !cross) return '';
      var cc = !isCounty && cross.places && cross.places[geoid] ? cross.places[geoid] : null;
      var names = isCounty ? [String(entry.label).replace(/ County$/, '')]
        : cc && cc.all_counties ? cc.all_counties.map(function (k) { return String(k.name || '').replace(/ County( \(part\))?$/, ''); }).filter(Boolean)
        : [String(countyName).replace(/ County$/, '')];
      var where = names.join(' and ') + (names.length > 1 ? ' counties' : ' County');
      var rows = (idx.deals || []).filter(function (r) { return names.indexOf(r.county) > -1; })
        .sort(function (a, b) { return (b.year || 0) - (a.year || 0) || String(a.name).localeCompare(String(b.name)); });
      // Each write-up's own file adds its income levels and where the deal stands.
      var body = rows.length ? '<ul class="route-list">' + rows.map(function (r) {
        var full = extraFile('data/deals/' + r.slug + '.json') || {}, lv = (full.income_mix || []).map(function (x) { return parseInt(x.level, 10); }).filter(function (x) { return x > 0; });
        var ami = lv.length ? (Math.min.apply(null, lv) === Math.max.apply(null, lv) ? lv[0] : Math.min.apply(null, lv) + '–' + Math.max.apply(null, lv)) + '% AMI' : null;
        return '<li><a href="#/deals/' + esc(r.slug) + '">' + esc(r.name) + '</a><span class="note">' + esc([r.city, r.award, r.units ? num(r.units) + ' homes' : null, ami].filter(Boolean).join(' · ')) +
          (full.status && full.status.label ? '<br><strong>Status:</strong> ' + esc(full.status.label) : '') + '</span></li>';
      }).join('') + '</ul>' : '<p>None of the awards written up so far is in ' + esc(where) + '. <a href="#/deals">All written-up deals</a>.</p>';
      return fold('<h2>Awarded tax credit deals in ' + esc(where) + '</h2>' +
        '<p>CHFA awards here with a sourced write-up: what was built or planned, for whom, and where it stands.' + (isCounty ? '' : ' The list covers the whole county.') + '</p>' + body +
        '<p class="metric-source">' + Pl.srcLine('COHO deal write-ups from public records, each with its sources' + (rows.length ? ', last checked ' + rows.reduce(function (t, r) { return r.researched_on > t ? r.researched_on : t; }, '') : ''), '#/deals') + '</p>',
        rows.length ? num(rows.length) + (rows.length === 1 ? ' award' : ' awards') + ' written up, the latest ' + rows[0].name + (rows[0].year ? ' (' + rows[0].year + ')' : '') + '.' : 'None written up yet.');
    }

    // Seniors and residents with a disability, as the live panel counts them (ACS DP05 and DP02).
    function specialNeeds() {
      var old = pv('DP05_0024E') != null ? pv('DP05_0024E') : pv('DP05_0029E'), dis = pv('DP02_0072E'), pop = pv('DP05_0001E');
      if (old == null && dis == null) return '';
      return fold('<h2>Special needs housing</h2><p>Seniors, people with a disability, families with children and single parents need particular kinds of homes, and are more often cost-burdened.</p>' +
        '<div class="metrics">' + acsCard('Residents 65 and older', old == null ? null : num(old), pop ? pct(old / pop * 100) + ' of residents' : null, 'DP05') +
        acsCard('Residents with a disability', dis == null ? null : num(dis), pop && dis != null ? pct(dis / pop * 100) + ' of residents' : null, 'DP02') +
        acsCard('Households with children under 18', pv('DP02_0014E') == null ? null : num(pv('DP02_0014E')), null, 'DP02') +
        acsCard('Single-parent households', pv('DP02_0007E') == null && pv('DP02_0011E') == null ? null : num((pv('DP02_0007E') || 0) + (pv('DP02_0011E') || 0)), 'Father or mother with children under 18, no spouse or partner', 'DP02') + '</div>',
        [old != null ? num(old) + ' residents 65 or older' : null, dis != null ? num(dis) + ' with a disability' : null].filter(Boolean).join(', ') + '.');
    }

    // How much of the place passes the HB26-1065 two-mile screen, from the public site's own transit zone
    // module (js/transit-zone.js areaSummary), so the lab and the live page read the same file the same way.
    function transitZone() {
      var TZ = global.TransitZone, tz = extraFile(EXTRA.transit), st = extraFile(EXTRA.thiz);
      if (!TZ || !tz || !st) return '';
      var r = TZ.areaSummary(tz, geoid, st, new Date()), law = st.statute_text || {}, tod = st.qap_tod_distance || {};
      var intro = '<h2>Potential location: transit zone (HB26-1065)</h2><p>Colorado’s Transit and Housing Investment Zones give a state tax credit to affordable housing within two miles of a transit station on OEDIT’s zone map.</p>';
      if (r.status !== 'ok') return fold(intro + '<p class="callout">' + esc(r.unavailableReason) + '</p>', 'Not screened: ' + r.unavailableReason);
      var near = r.nearestConfirmedStop;
      return fold(intro + '<div class="metrics">' +
        Pl.card('Within 2 miles of a transit stop', r.shareLabel, 'Share of ' + placeShort + ' that passes the screen', 'CDOT Statewide Transit Points and transit agency schedules, stops as of ' + String(r.stopsGenerated || '').slice(0, 10), 'https://data-cdot.opendata.arcgis.com/', here) +
        (r.halfMileLabel ? Pl.card('Within ½ mile of a stop', r.halfMileLabel, 'CHFA’s transit-oriented distance. CHFA scores walking distance; this is straight-line, so check the walk.', tod.qap_citation ? 'CHFA ' + tod.qap_citation : 'CHFA QAP', tod.qap_source_url || null, here) : '') +
        (near ? Pl.card('Nearest stop to the centre', near.distance_miles + ' mi', near.name + (near.agency ? ' (' + near.agency + ')' : ''), 'CDOT Statewide Transit Points and transit agency schedules', 'https://data-cdot.opendata.arcgis.com/', here) : '') +
        '</div>' + transitMap(r) +
        '<p>The law draws the zone around “' + esc((law.facility || {}).quote || 'a transit station or passenger rail station') + '” (' + esc((law.facility || {}).cite || 'C.R.S. 24-48.5-136(3)(e)') + ') and sets no service-frequency test. This screen draws two miles around every published bus or rail stop. OEDIT counts only stations, so most real zones will be smaller.</p>' +
        '<p class="callout">' + esc(r.designationNote) + '</p>' +
        '<p class="metric-source">' + Pl.srcLine(law.source || 'Session Laws of Colorado 2026, ch. 157', law.source_url) + '</p>',
        r.shareLabel + ' of ' + placeShort + ' lies within two miles of a transit stop' + (near ? '; the nearest to the centre is ' + near.distance_miles + ' mi away' : '') + '.');
    }

    // The 2-mile screen drawn: the boundary, every published stop near it, and a 2-mile ring round each
    // confirmed stop, from the same stop file and stop rule the screen uses (TransitZone.countsAsConfirmedStop).
    function transitMap(r) {
      if (!global.TransitZone.countsAsConfirmedStop) return '';
      var TZ = global.TransitZone, sf = extraFile(EXTRA.stops), bf = extraFile(isCounty ? EXTRA.countyShapes : EXTRA.placeShapes);
      if (!sf || !bf) return '<p role="status" class="note">Loading the stop map…</p>';
      var shape = (bf.features || []).filter(function (f) { var q = f.properties || {}; return String(q.geoid || q.GEOID) === String(geoid); })[0];
      if (!shape || !sf.features) return '';
      var polys = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates;
      var w = 180, e = -180, so = 90, n = -90;
      polys.forEach(function (pg) { pg[0].forEach(function (c) { w = Math.min(w, c[0]); e = Math.max(e, c[0]); so = Math.min(so, c[1]); n = Math.max(n, c[1]); }); });
      var R = 2, lat0 = (so + n) / 2, k = Math.cos(lat0 * Math.PI / 180), dLat = R / 69.0, dLon = R / (69.0 * k);
      w -= dLon; e += dLon; so -= dLat; n += dLat;
      var W = 720, H = Math.max(260, Math.min(720, Math.round(W * (n - so) / ((e - w) * k))));
      var sx = W / ((e - w) * k), sy = H / (n - so), sc = Math.min(sx, sy), ox = (W - (e - w) * k * sc) / 2, oy = (H - (n - so) * sc) / 2;
      var X = function (lon) { return (ox + (lon - w) * k * sc).toFixed(1); }, Y = function (lat) { return (oy + (n - lat) * sc).toFixed(1); };
      var near = sf.features.filter(function (f) { var c = f.geometry && f.geometry.coordinates; return c && c[0] >= w && c[0] <= e && c[1] >= so && c[1] <= n; });
      var counted = near.filter(function (f) { return TZ.countsAsConfirmedStop(f.properties); }), other = near.length - counted.length;
      var rr = (dLat * sc).toFixed(1), rings = counted.length <= 400, dot = near.length > 600 ? 3 : near.length > 150 ? 5 : 8;
      var path = polys.map(function (pg) { return pg.map(function (ring) { return 'M' + ring.map(function (c) { return X(c[0]) + ' ' + Y(c[1]); }).join('L') + 'Z'; }).join(''); }).join('');
      var label = 'Map of ' + entry.label + ' with ' + num(counted.length) + ' confirmed transit stops within two miles of it' + (rings ? ' and a 2-mile ring round each' : '');
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' +
        '<path d="' + path + '" fill="var(--map-1)" fill-opacity="0.55" stroke="none"/>' +
        (rings ? '<g fill="var(--c-blue)" opacity="0.16" stroke="none">' + counted.map(function (f) { var c = f.geometry.coordinates; return '<circle cx="' + X(c[0]) + '" cy="' + Y(c[1]) + '" r="' + rr + '"/>'; }).join('') + '</g>' : '') +
        '<g fill="var(--muted)">' + near.filter(function (f) { return !TZ.countsAsConfirmedStop(f.properties); }).map(function (f) { var c = f.geometry.coordinates; return '<circle cx="' + X(c[0]) + '" cy="' + Y(c[1]) + '" r="' + Math.max(2, dot / 2) + '"/>'; }).join('') + '</g>' +
        '<g fill="var(--c-blue)" stroke="var(--card)" stroke-width="0.7">' + counted.map(function (f) { var c = f.geometry.coordinates; return '<circle cx="' + X(c[0]) + '" cy="' + Y(c[1]) + '" r="' + dot + '"><title>' + esc((f.properties.name || 'Stop') + (f.properties.agency ? ', ' + f.properties.agency : '')) + '</title></circle>'; }).join('') + '</g>' +
        '<path d="' + path + '" fill="none" stroke="var(--ink)" stroke-width="2"/>' +
        // Map kit part 2: the town's name on the map, above its north edge, in the halo style of the anchor labels.
        '<text x="' + X((w + e) / 2) + '" y="' + (+Y(n - dLat) - 10).toFixed(1) + '" font-size="26" font-weight="700" fill="var(--ink)" text-anchor="middle" stroke="var(--halo)" stroke-width="6" stroke-linejoin="round" paint-order="stroke" aria-hidden="true">' + esc(placeShort) + '</text>' +
        '<g><line x1="12" y1="' + (H - 14) + '" x2="' + (12 + dLat * sc / 2).toFixed(1) + '" y2="' + (H - 14) + '" stroke="var(--ink)" stroke-width="3"/><text x="12" y="' + (H - 22) + '" font-size="14" fill="var(--ink)">1 mile</text></g></svg>';
      var gen = String(((sf.meta || {}).generated) || '').slice(0, 10);
      return '<figure class="pres-map tz-map"><figcaption><span class="cc-kicker">Transit stops and the 2-mile screen</span><strong>' + esc(r.shareLabel + ' of ' + placeShort + ' lies within two miles of a confirmed stop; ' + num(counted.length) + ' confirmed stops sit within two miles of the boundary') + '</strong>' + Pl.scope(here) + '</figcaption>' +
        '<div class="pm-frame">' + svg + '</div>' +
        '<p class="money-key" aria-hidden="true"><i style="background:var(--c-blue)"></i><span>Confirmed stop (CDOT or an agency feed)</span>' + (other ? '<i style="background:var(--muted)"></i><span>Not counted: OpenStreetMap only, private shuttle or on demand (' + num(other) + ')</span>' : '') +
        (rings ? '<i style="background:var(--c-blue);opacity:.25"></i><span>Within 2 miles of a confirmed stop</span>' : '') + '</p>' +
        (rings ? '' : '<p class="note">With this many stops the 2-mile rings cover the map, so they are not drawn.</p>') +
        '<p class="note">Straight-line distance, as the screen uses. A zone is official only once OEDIT maps it.</p>' +
        '<p class="metric-source">' + Pl.srcLine([['CDOT Statewide Transit Points and agency GTFS feeds, stops as of ' + gen, 'https://data-cdot.opendata.arcgis.com/'], ['Census TIGER 2024 boundaries', 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html']]) + '</p>' +
        (global.LabVizData ? global.LabVizData.block('Transit stops within two miles of ' + placeShort, ['Stop', 'Agency', 'Counted as a confirmed stop'],
          near.map(function (f) { return [f.properties.name || 'Stop', f.properties.agency || '', TZ.countsAsConfirmedStop(f.properties) ? 'Yes' : 'No']; })
            .sort(function (a, b) { return a[2] === b[2] ? (a[0] < b[0] ? -1 : 1) : a[2] === 'Yes' ? -1 : 1; })) : '') + '</figure>';
    }

    // Proposition 123 (C.R.S. 29-32): where this government stands with DOLA, from DOLA's own lists.
    // How this assessment lines up with what SB24-174 asks a local housing needs assessment to cover
    // (C.R.S. 24-32-3702(1)(d) and (1)(e)). Honest about the items this page does not have yet.
    var SB174 = [
      ['Existing housing stock', 'yes', 'housing', 'Homes by type, age, tenure and vacancy.'],
      ['Need by income level and home type, including accessible, visitable, supportive, for-sale and rental homes', 'part', 'action', 'Need by income, bedrooms, building type, and owning or renting. No split for accessible, visitable or supportive homes yet.'],
      ['Number of households', 'yes', 'people', 'Households by size, income and tenure.'],
      ['Jobs by annual pay', 'yes', 'people', 'Jobs by pay band, from LEHD.'],
      ['A share of state and regional need, from jobs and commuting', 'part', 'future', 'In-commuters are added to the 20-year need. No regional share is assigned.'],
      ['Areas at elevated risk of displacement', 'no', null, 'Not here yet. DOLA’s displacement risk guidance sets out how to map it.'],
      ['Water supply needed for those homes', 'no', null, 'Not here yet. The law uses per-person water rates set with the Department of Natural Resources.'],
      ['Market limits on building housing', 'part', 'action', 'Building-type fit and costs. No section on local barriers yet.'],
      ['Policy responses and housing action plan guidance', 'part', 'action', 'An action plan checklist and Prop 123 status, below.']
    ];
    function sb174() {
      var WORD = { yes: 'Covered here', part: 'Partly', no: 'Not here yet' };
      var n = { yes: 0, part: 0, no: 0 };
      SB174.slice(0, 8).forEach(function (r) { n[r[1]]++; });
      var who = isCounty ? esc(entry.label)
        : /\bCDP\b/i.test(entry.label) ? esc(placeShort) + ' is not a town government, so the assessment is ' + esc(countyName || 'the county') + '’s to do. '
        : esc(placeShort);
      var pop = v('population');
      var lead = /\bCDP\b/i.test(entry.label) && !isCounty ? who
        : pop == null ? 'If ' + who + ' has more than 1,000 residents, it must publish an assessment. '
        : pop > 1000 ? who + ', with about ' + num(pop) + ' residents, must publish an assessment unless that exemption applies. '
        : who + ' has about ' + num(pop) + ' residents, under the 1,000 the law sets, so it does not have to publish an assessment. ';
      return fold('<h2 id="sb174-h">How this lines up with SB24-174</h2><section class="sb174" aria-labelledby="sb174-h">' +
        '<p>Colorado’s SB24-174 asks every county and town with more than 1,000 residents to publish a housing needs assessment by <strong>31 December 2026</strong>, and again at least every six years. ' +
        'Places that lost 1% or more of their people in the last census are exempt. A housing action plan follows by 1 January 2028, but only for places of 5,000 or more people, places of 1,000 or more that join a regional assessment, and rural resort communities. ' + lead + '</p>' +
        '<p class="chapter-finding">Of the eight things the law lists, this page covers <strong>' + n.yes + '</strong>, covers <strong>' + n.part + '</strong> in part, and does not have <strong>' + n.no + '</strong> yet. It is not a DOLA-approved assessment, but it can be the data start of one.</p>' +
        // The eight at a glance (Gemini round 13; big visual pass 11-06): one mark per item, filled, half or open, so
        // it reads without colour, each a link to the chapter that covers it. "Not here yet" is our gap, not the town's,
        // so it is drawn open and grey, never as a warning.
        '<ol class="sb174-marks" aria-label="The eight items at a glance">' + SB174.slice(0, 8).map(function (r) {
          var short = r[0].replace(/, including.*$/, '').replace(/^A share of state and regional need.*$/, 'Share of regional need').replace(/ for those homes$/, '').replace(/^Areas at elevated risk of displacement$/, 'Displacement risk');
          var to = r[2] && r[2] !== 'action' ? '#/place/' + esc(geoid) + '/' + r[2] : r[2] === 'action' ? '#/place/' + esc(geoid) + '/action' : null;
          var body = '<i class="sbm sbm-' + r[1] + '" aria-hidden="true"></i><span class="sbm-t">' + esc(short) + '</span><span class="visually-hidden">: ' + WORD[r[1]] + '</span>';
          return '<li>' + (to ? '<a href="' + to + '">' + body + '</a>' : '<span class="sbm-row">' + body + '</span>') + '</li>';
        }).join('') + '</ol>' +
        '<p class="sb174-key" aria-hidden="true"><span><i class="sbm sbm-yes"></i>Covered here</span><span><i class="sbm sbm-part"></i>Partly</span><span><i class="sbm sbm-no"></i>Not here yet</span></p>' +
        '<div class="table-scroll" role="region" aria-label="SB24-174 items" tabindex="0"><table class="sb174-table"><thead><tr><th scope="col">What the law asks for</th><th scope="col">Here</th><th scope="col">What this page has</th></tr></thead><tbody>' +
        SB174.map(function (r, i) {
          var where = r[2] && r[2] !== 'action' ? ' <a href="#/place/' + esc(geoid) + (r[2] === 'overview' ? '' : '/' + r[2]) + '">' + esc((TABS.filter(function (x) { return x.id === r[2]; })[0] || {}).title || '') + '</a>' : '';
          return '<tr><th scope="row">' + esc(r[0]) + (i >= 8 ? '<br><span class="note">Not one of the eight: DOLA’s guidance for the action plan that follows</span>' : '') + '</th><td><span class="sb174-' + r[1] + '">' + WORD[r[1]] + '</span></td><td>' + esc(r[3]) + where + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p><a href="#/place/' + esc(geoid) + '/dola">The full SB24-174 check, with DOLA\u2019s four need tables</a></p>' +
        '<p class="metric-source">Sources: <a href="https://leg.colorado.gov/bills/sb24-174" rel="noopener">SB24-174</a> (C.R.S. 24-32-3702(1)(d) and (e)); ' +
        '<a href="https://dlg.colorado.gov/housing-plans" rel="noopener">DOLA, Housing Plans</a> (due dates, exemption, method, compliance checklist); ' +
        '<a href="https://dlg.colorado.gov/news-article/final-housing-needs-assessment-methodology-and-displacement-risk-assessment-guidance" rel="noopener">DOLA final HNA method and displacement risk guidance</a>, December 2024. Read 4 November 2026.</p></section>',
        'Covers ' + n.yes + ' of the eight items the law lists and ' + n.part + ' in part; ' + n.no + ' are not here yet. Not a DOLA-approved assessment.');
    }
    function prop123() {
      var pj = extraFile(EXTRA.prop123), U = global.HNAUtils;
      if (!pj) return '';
      var norm = function (x) { return String(x || '').toLowerCase().replace(/^(city and county of|city of|town of|county of)\s+/, '').replace(/ (county|city|town|cdp)$/, '').replace(/\s*\((city|town|cdp)\)$/, '').trim(); };
      var unincorporated = !isCounty && /\bCDP\b/i.test(entry.label);
      var me = isCounty ? norm(entry.label) : norm(placeShort);
      var kind = isCounty || unincorporated ? 'county' : 'municipality';
      var cn = norm(countyName);
      var j = (pj.jurisdictions || []).filter(function (x) { return x.kind === kind && norm(x.name) === (unincorporated ? cn : me); })[0] || null;
      var who = unincorporated ? countyName + ' (the county files for unincorporated areas)' : entry.label;
      var at = { level: isCounty || unincorporated ? 'county' : 'place', title: 'DOLA’s record for ' + (unincorporated ? countyName : entry.label) + '.' };
      var nx = j && j.next_cycle, src = (pj.sources || {}), units = isCounty ? (pv('DP04_0001E')) : pv('DP04_0001E');
      var base = units ? Math.round(units * 0.06) : null, goal = U && base ? U.calculateGrowthTarget(base, 3) : null;
      var ft = U ? U.checkFastTrackEligibility(null, unincorporated ? 'cdp' : isCounty ? 'county' : 'place') : null;
      // A "Commitment Met" status carries DOLA's verification date, not the 2023 filing date.
      var verified = j && j.compliance_verified && j.compliance_verified.unit_commitment;
      // DOLA's own count of the homes the commitment required, where it verified one. It, not COHO's proxy below, is the commitment.
      var required = j && j.compliance_verified && j.compliance_verified.required_units_met != null ? j.compliance_verified.required_units_met : null;
      var cards = j ? Pl.card('2024–2026 commitment', j.status, (verified ? 'DOLA verified the commitment as met on ' + verified + (required != null ? ': ' + num(required) + ' homes required' : '') + '. ' : '') + (j.proposed_units != null ? 'The filing projects ' + num(j.proposed_units) + ' homes over the cycle. Filed ' + j.filing_date + '.' : 'Filed ' + j.filing_date + '.'), 'DOLA commitment filings', j.source_url, at) +
        Pl.card('Fast-track review', j.fast_track ? 'Adopted' : 'Not adopted yet', j.fast_track ? [j.fast_track_adopted, j.fast_track_instrument].filter(Boolean).join(', ') : 'Required from January 1, 2027 to stay eligible', 'DOLA fast-track list', (src.fast_track || {}).page || 'https://cdola.colorado.gov/prop123fasttrack', at) +
        Pl.card('2027–2029 commitment', nx ? 'Filed ' + nx.submitted : 'No filing yet', nx ? (nx.unit_goal != null ? 'Goal: ' + num(nx.unit_goal) + ' homes' : null) : 'Due November 1, 2026', 'DOLA commitment filings', (src.next_cycle_filings || {}).page || 'https://cdola.colorado.gov/commitment-filings', at)
        : Pl.card('2024–2026 commitment', 'No filing on DOLA’s list', null, 'DOLA commitment filings', 'https://cdola.colorado.gov/commitment-filings', at);
      return fold('<h2>Proposition 123 commitment</h2>' +
        '<p>Prop 123 (<a href="https://cdola.colorado.gov/about-proposition-123" target="_blank" rel="noopener">C.R.S. 29-32-101 to -106</a>) funds affordable housing only where the city, town or county has filed a commitment with DOLA’s Division of Housing (§ 29-32-105(1)). From 2027 it must also run fast-track review.</p>' +
        '<p class="note">' + esc(who) + ': filing status only, not a ranking. DOLA’s lists read ' + esc(pj.updated || '') + '.</p>' +
        '<div class="metrics">' + cards + '</div>' +
        (base != null ? '<p><strong>The 2024–2026 goal.</strong> 3% of a baseline count of affordable homes a year, 9% over the cycle. ' +
          (required != null ? 'DOLA counts ' + num(required) + ' homes as the required commitment, verified ' + esc(verified || '') + '. That is the commitment; the estimate below is not. ' : '') +
          (j && j.proposed_units != null ? 'The filing projects ' + num(j.proposed_units) + ' homes. ' : '') +
          'COHO\u2019s rough estimate, for places without a DOLA figure, takes 6% of all ' + num(units) + ' homes as the baseline: ' + num(base) + ' affordable homes, rising to ' + num(goal) + ' by the end of 2026' + (required != null ? ', or ' + num(goal - base) + ' added against DOLA\u2019s ' + num(required) : '') + '. It can run high or low; check it against the <a href="https://www.chfainfo.com/community-partnerships/the-housing-affordability-gap" target="_blank" rel="noopener">CHFA gap map</a>. From 2027 the goal comes from building permits instead (<a href="https://leg.colorado.gov/bills/hb26-1313" target="_blank" rel="noopener">HB26-1313</a>).</p>' : '') +
        (ft && ft.reason ? '<p><strong>Fast-track review.</strong> ' + esc(ft.reason) + '. It covers projects where at least half the homes are affordable, which get a final decision within 90 calendar days of a complete application (§ 29-32-105(2)(a), (3)(a)).</p>' : '') +
        fastTrackCheck() +
        (base != null && U ? '<h3>The goal year by year</h3><p>The 2024–2026 goal adds 3% of the baseline each year, simple, not compounded (C.R.S. § 29-32-105(1)(a)). No yearly counts of new affordable homes are on file for ' + esc(unincorporated ? countyName : entry.label) + ' yet, so only the goal shows. From 2027, HB26-1313 sets the goal from building permits instead.</p>' +
          (!Viz ? '' : Viz.cumulative({
            title: 'COHO\u2019s estimate of the affordable homes the 2024–2026 goal calls for, by year', scope: Pl.scope({ level: 'estimate', metric: 'Prop 123 goal', from: '6% of all homes, a COHO proxy' }), color: Viz.COLORS.homes,
            colorOf: function (r, i) { return i === 0 ? Viz.COLORS.muted : Viz.COLORS.homes; },
            rows: [2023, 2024, 2025, 2026].map(function (y, i) { return [y + (i === 0 ? ' base' : ''), U.calculateGrowthTarget(base, i)]; }),
            ref: j && j.proposed_units != null ? { value: base + j.proposed_units, label: 'Baseline plus the filing’s homes' } : null,
            answer: 'The goal rises from ' + num(base) + ' to ' + num(goal) + ' affordable homes by the end of 2026. DOLA publishes no yearly count of homes added for ' + (unincorporated ? countyName : entry.label) + ', so there is nothing yet to set against it.',
            note: 'Grey is the rough baseline, 6% of all homes; green is the goal at 3% of the baseline a year, simple, not compounded.',
            source: Pl.srcLine([[acs + ', DP04 (all homes)', acsUrl('DP04')], ['C.R.S. 29-32-105(1)(a)', 'https://cdola.colorado.gov/about-proposition-123']])
          })) +
          '<div class="table-scroll"><table><caption>COHO\u2019s estimate of the affordable homes the goal calls for (not DOLA\u2019s figure)</caption><thead><tr><th scope="col">Year</th><th scope="col">Goal</th><th scope="col">Added over the baseline</th><th scope="col">Counted</th></tr></thead><tbody>' +
          [2023, 2024, 2025, 2026].map(function (y, i) { var g = U.calculateGrowthTarget(base, i); return '<tr' + (i === 3 ? ' class="row-strong"' : '') + '><th scope="row">' + y + (i === 0 ? ' (baseline)' : '') + '</th><td>' + num(g) + '</td><td>' + (i ? '+' + num(g - base) : '—') + '</td><td>' + (i ? 'Not on file' : 'Baseline proxy') + '</td></tr>'; }).join('') +
          '</tbody></table></div><p class="metric-source">' + Pl.srcLine([[acs + ', DP04 (all homes)', acsUrl('DP04')], ['C.R.S. 29-32-105(1)(a)', 'https://cdola.colorado.gov/about-proposition-123']]) + '</p>' : '') +
        '<h3>Steps to stay eligible</h3><ol class="steps">' + P123_STEPS.map(function (s) { return '<li><strong>' + esc(s[0]) + '.</strong> ' + s[1] + '</li>'; }).join('') + '</ol>' +
        '<h3>Resources</h3><ul>' + P123_LINKS.map(function (l) { return '<li><a href="' + esc(l[1]) + '"' + (/^https?:/.test(l[1]) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l[0]) + '</a>' + (l[2] ? ': ' + esc(l[2]) : '') + '</li>'; }).join('') + '</ul>' +
        '<p class="metric-source">' + Pl.srcLine([['DOLA commitment filings, read ' + (pj.updated || 'date not recorded'), (src.cycle1_filings || {}).page || 'https://cdola.colorado.gov/commitment-filings'], ['DOLA fast-track list' + ((src.fast_track || {}).sheet_last_updated ? ', updated ' + src.fast_track.sheet_last_updated : ''), (src.fast_track || {}).page || 'https://cdola.colorado.gov/prop123fasttrack']]) + '</p>',
        j ? '2024–2026 commitment: ' + j.status + '. Fast-track review: ' + (j.fast_track ? 'adopted' : 'not adopted yet') + '. 2027–2029: ' + (nx ? 'filed ' + nx.submitted : 'no filing yet') + '.'
          : 'No commitment on DOLA’s list for ' + who + '.');
    }

    // The fast-track project test, worked by the public site's own rule (HNAUtils.calculateFastTrackTimeline).
    function fastTrackCheck() {
      var U = global.HNAUtils;
      if (!U || !U.calculateFastTrackTimeline) return '';
      var f = ftInputs[geoid] || { units: '20', affordable: '10' };
      var r = U.calculateFastTrackTimeline(f.units, f.affordable, /\bCDP\b/i.test(entry.label) ? 'cdp' : isCounty ? 'county' : 'place');
      var head = r.eligible === true ? 'Meets the fast-track test: a final decision within ' + r.fastTrackDays + ' calendar days of a complete application, where a commitment is filed.'
        : r.eligible === false ? 'Does not meet the fast-track test.' : 'Enter the project to check.';
      return '<form class="ft-check" data-ft="' + esc(geoid) + '" aria-label="Fast-track check"><h3>Does a project qualify for fast-track review?</h3><div class="ft-inputs">' +
        '<label>Homes in the project <input type="number" min="1" inputmode="numeric" name="units" value="' + esc(f.units) + '"></label>' +
        '<label>Affordable homes <input type="number" min="0" inputmode="numeric" name="affordable" value="' + esc(f.affordable) + '"></label></div>' +
        '<div role="status" aria-live="polite"><p><strong>' + esc(head) + '</strong></p><ul>' + r.conditions.map(function (c) { return '<li>' + esc(c.replace(/^✅\s*/, '')) + '</li>'; }).join('') + '</ul></div>' +
        '<p class="metric-source">' + Pl.srcLine('DOLA fast-track guidance', 'https://cdola.colorado.gov/prop123fasttrack') + '</p></form>';
    }

    // The live page's market area tools moved to its Market Analysis page; the lab's is the Market check.
    function pmaLink() {
      return '<h2>Primary market area and CHFA requirements</h2><p>Drawing the market area, CHFA’s market study requirements and the PMA checklist sit with the market check, where a site is tested.</p>' +
        '<div class="actions"><a class="button-link" href="#/market?g=' + esc(geoid) + '">Market check for ' + esc(placeShort) + '</a>' +
        '<a class="button-link secondary" href="' + esc(Pl.LIVE) + 'market-analysis.html#maChfaRequirements">CHFA checklist on the live site ↗</a></div>';
    }

    // The live chapter's projection table, AMI mix and rent test (js/housing-need-projector.js, js/mix-check.js and
    // js/mix-check-inputs.js), read from the same county row of data/co-county-demographics.json. County figures for a town.
    var cname = String(isCounty ? entry.label : countyName).replace(/ County$/, '');
    var cscope = isCounty ? here : { level: 'county-proxy', countyName: countyName };
    function countyRow() {
      var dm = extraFile(EXTRA.demog);
      return dm ? (dm.counties || {})[cname] || {} : null;
    }
    function projectedNeed() {
      var HNP = global.HousingNeedProjector, cf = isCounty ? geoid : fips;
      if (!HNP || !cf) return '';
      var cd = countyRow(), pj = extraFile(EXTRA.projection(cf));
      if (!cd || !pj) return '<p role="status" class="note">Loading the county projection…</p>';
      var r = HNP.project(cf, cd, { dolaProj: Object.keys(pj).length ? pj : null, geoType: isCounty ? 'county' : 'place', countyName: cname + ' County' });
      var s = r.scenarios, row = function (label, x, k, base) {
        return '<tr' + (base ? ' class="row-strong"' : '') + '><th scope="row">' + esc(label) + '</th><td>' + num(x.yr5) + '</td><td>' + num(x.yr10) + '</td><td>' + num(x.yr20) + '</td><td>' + num(Math.round(r.annualGap * k)) + ' a year</td></tr>';
      };
      return '<h2>Projected housing need by scenario</h2>' +
        '<p>Homes needed in ' + esc(cname) + ' County to house projected new households at 5, 10 and 20 years. ' +
        (r.needSource === 'dola' ? 'The baseline turns the State Demography Office’s household growth into homes at a healthy vacancy (5% to 7%, from local vacancy). It is COHO’s estimate built on the office’s households, not a figure the office publishes, so it can differ from the 20-year figure above, which adds in-commuters.' : 'From household growth at the rate in the method notes.') +
        (isCounty ? '' : ' The office forecasts counties, so this table is the county’s.') + '</p>' +
        '<p>' + Pl.scope(cscope) + '</p><div class="table-scroll"><table><caption>Homes needed, cumulative from ' + r.baseYear + '</caption><thead><tr><th scope="col">Scenario</th><th scope="col">5 years</th><th scope="col">10 years</th><th scope="col">20 years</th><th scope="col" title="The larger of the 20-year need over 20 and the current deep gap over 15 years">Homes a year</th></tr></thead><tbody>' +
        row('Low (40% of baseline, illustrative)', s.low, 0.4) + row('Baseline', s.baseline, 1, true) + row('High (170% of baseline, illustrative)', s.high, 1.7) + '</tbody></table></div>' +
        (r.noGrowthNeed ? '<p><strong>No added homes needed for growth.</strong> Households are forecast to stay flat or shrink over 20 years.</p>' : '') +
        (r.currentGap != null ? '<p>Deep affordability gap today: about <strong>' + num(r.currentGap) + '</strong> renter households in the county pay 50% or more of income on rent.</p>' : '') +
        '<details><summary>Method and assumptions</summary><ul>' + r.methodology.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' +
        '<p class="metric-source">' + Pl.srcLine(dolaName() + '; ACS 2020-2024 5-year, B25070, B25003', LINKS.dola) + '</p>';
    }
    function amiMix() {
      var HNP = global.HousingNeedProjector, MC = global.MixCheck, MI = global.MixCheckInputs, cf = isCounty ? geoid : fips;
      if (!HNP || !cf) return '';
      var cd = countyRow();
      if (!cd) return '';
      var rec = HNP.recommendAmiMix(cd), group = { pct30: 0, pct40: 1, pct60: 2, pct80: 3 };
      var rows = ['pct30', 'pct40', 'pct50', 'pct60', 'pct70', 'pct80', 'pct100'].filter(function (k) { return rec.recommended[k] != null; })
        .map(function (k) { return [k.slice(3) + '% AMI', rec.recommended[k]]; });
      var why = Object.keys(group).map(function (k) { return rec.rationale[group[k]]; }).filter(Boolean);
      var check = '';
      if (MC && MI) {
        var files = {};
        Object.keys(MI.PATHS).forEach(function (k) { files[k] = extraFile(MI.PATHS[k]); });
        if (Object.keys(files).some(function (k) { return files[k] === null; })) check = '<p role="status" class="note">Loading the rent test…</p>';
        else {
          Object.keys(files).forEach(function (k) { if (!Object.keys(files[k]).length) files[k] = null; });
          var inputs = MI.build(files, { countyFips: cf, placeGeoid: isCounty ? undefined : geoid, placeName: isCounty ? undefined : String(entry.label) }, MC);
          var mc = HNP.mixCheckFor(rec, inputs, MC, MI), res = mc.result, b = inputs.burden || {};
          check = fold('<h3>Need beyond the homes-short counts, and does this mix pay its way?</h3>' +
            (Object.keys(b).length ? bars('Renters paying more than 30% of income, by income band', inputs.chasScope === 'place' ? 'HUD’s place estimate for ' + placeShort : null,
              Object.keys(b).map(function (k) { return [b[k].label, b[k].pct]; }), function (x) { return Math.round(x) + '%'; }, 'homes', null,
              inputs.chasScope === 'place' ? here : cscope) +
              '<p class="note">' + Object.keys(b).map(function (k) { return esc(b[k].label) + ': ' + num(b[k].burdened) + ' of ' + num(b[k].households); }).join(' · ') + '</p>' : '') +
            (res.notes.length ? '<ul>' + res.notes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
            (res.pencil && res.pencil.ok ? '<p class="callout">' + esc(mc.lead + ' ' + (res.mixSentence || '')) + '</p>' +
              '<p>' + Pl.scope(cscope) + '</p><div class="table-scroll"><table><caption>Each rent level on its own, per home</caption><thead><tr><th scope="col">Rent level</th><th scope="col">Two-bedroom rent</th><th scope="col">Net year 1</th><th scope="col">Net year 15</th><th scope="col">Debt it carries a year</th></tr></thead><tbody>' +
              res.pencil.tiers.map(function (x) { return '<tr><th scope="row">' + esc(x.tier) + '% AMI</th><td>' + money(x.rent) + '</td><td>' + money(x.noi1) + '</td><td>' + money(x.noi15) + '</td><td>' + (x.firstShortYear ? 'Short from year ' + x.firstShortYear + '; needs subsidy' : money(x.debtServiceCapacity)) + '</td></tr>'; }).join('') +
              '</tbody></table></div><p class="note">' + esc(res.assumptions) + '</p>'
              : res.reason ? '<p class="note">Whether the mix pays its way is not shown: ' + esc(res.reason) + '</p>' : '') +
            '<p class="metric-source">' + esc(MI.sourceLine(inputs)) + '</p>',
            res.pencil && res.pencil.ok ? mc.lead : 'Renter cost burden by income band, and whether each rent level covers its costs.');
        }
      }
      return '<h2>Recommended income mix for a tax credit project</h2>' +
        '<p><strong>' + esc(rec.label) + '.</strong> Picked from the county’s median income, renter cost burden and vacancy.' +
        (rec.totalUnitsNeeded != null ? ' ' + num(rec.totalUnitsNeeded) + ' renter households pay 30% or more of income on rent (ACS 2020-2024 5-year), a count of households under strain, not a production target.' : '') + '</p>' +
        bars('Share of homes by income limit', null, rows, function (x) { return x + '%'; }, 'households', ['Colorado county demographics, ACS 2020-2024 5-year', LINKS.methods], cscope) +
        (why.length ? '<details class="type-more"><summary>Why this mix, band by band</summary><ul>' + why.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' : '') + check +
        '<details><summary>What this does not tell you</summary><ul><li>Unit sizes or bedroom mix: see renter need by bedroom below.</li><li>Site control, zoning or local politics.</li><li>CHFA scoring. It is a screening estimate; the QAP and a local needs study set final income targets.</li></ul></details>';
    }
    // Housing chapter: the same pairing, from the renter size file when it has loaded.
    function bedroomMix() {
      var f = extraFile(EXTRA.renterSize), row = f && ((isCounty ? f.counties : f.places) || {})[geoid];
      var src = f ? [(f.meta || {}).source || 'ACS 2020-2024 5-year, B25009', 'https://data.census.gov/table/ACSDT5Y2024.B25009'] : null;
      return bedroomPair(row && row.by_size ? needBins(row.by_size) : null, src);
    }
    // Renter households by size (ACS B25009) turned into bedrooms at two people a bedroom, as the live chart bins them.
    function bedroomNeed() {
      var f = extraFile(EXTRA.renterSize);
      if (!f) return '';
      var row = ((isCounty ? f.counties : f.places) || {})[geoid], s = row && row.by_size;
      var src = [(f.meta || {}).source || 'ACS 2020-2024 5-year, B25009', 'https://data.census.gov/table/ACSDT5Y2024.B25009'];
      if (!s) return '<h2>Renter need by bedroom count</h2><p class="note">Renter household sizes are not published for this place.</p>';
      var bins = needBins(s), tot = bins.reduce(function (a, x) { return a + x[1]; }, 0);
      return '<h2>Renter need by bedroom count</h2>' +
        '<p>' + num(row.renter_households) + ' renter households, sized at no more than two people a bedroom (HUD’s occupancy rule): ' +
        bins.map(function (x) { return x[0].toLowerCase() + ' ' + (tot ? Math.round(x[1] / tot * 100) : 0) + '%'; }).join(' · ') + '. A unit mix that follows local renters, not a default for the building type.</p>' +
        bedroomPair(bins, src);
    }
    // Renter sizes to bedrooms as the live chart bins them: half of one-person households in a studio.
    function needBins(s) {
      var half = Math.floor((s[1] || 0) / 2);
      return [['Studio', half], ['1 bedroom', (s[1] || 0) - half + (s[2] || 0)], ['2 bedrooms', (s[3] || 0) + (s[4] || 0)], ['3 bedrooms', (s[5] || 0) + (s[6] || 0)], ['4 or more', s['7+'] || 0]];
    }
    // Rented homes by bedrooms (B25042) against the renter households by the bedrooms they need (B25009), as
    // shares, so stock and need cover the same people. Where the renter bedroom file has no row, it falls back
    // to all homes (DP04, owned and rented) and states no comparison, since most of those homes are owned.
    function bedroomPair(need, needSrc) {
      var rb = extraFile(EXTRA.renterBeds), rrow = rb && ((isCounty ? rb.counties : rb.places) || {})[geoid];
      var rented = rrow && rrow.bedrooms && !rrow.unavailable_reason ? rrow.bedrooms : null;
      var hb, stockLabel, stockSrc;
      if (rented) {
        hb = [rented.studio, rented['1br'], rented['2br'], rented['3br'], rented['4br'] == null && rented['5plus'] == null ? null : (rented['4br'] || 0) + (rented['5plus'] || 0)];
        stockLabel = 'Rented homes'; stockSrc = [((rb.meta || {}).source) || 'ACS 2020-2024 5-year, B25042', 'https://data.census.gov/table/ACSDT5Y2024.B25042'];
      } else {
        var homes = BEDROOMS.map(function (b) { return pv(b[1]); });
        hb = [homes[0], homes[1], homes[2], homes[3], homes[4] == null && homes[5] == null ? null : (homes[4] || 0) + (homes[5] || 0)];
        stockLabel = 'All homes, owned and rented'; stockSrc = [acs + ', DP04', acsUrl('DP04')];
      }
      var ht = hb.reduce(function (a, x) { return a + (x || 0); }, 0), nt = need ? need.reduce(function (a, x) { return a + x[1]; }, 0) : 0;
      var sh = function (x, t) { return x == null || !t ? null : Math.round(x / t * 1000) / 10; };
      var labels = ['Studio', '1 bedroom', '2 bedrooms', '3 bedrooms', '4 or more'];
      var rows = labels.map(function (l, i) { return [l, sh(hb[i], ht), need ? sh(need[i][1], nt) : null]; });
      if (!ht && !nt) return '<p class="note">Bedroom counts are not published for this place.</p>';
      if (!Viz) return bars(stockLabel + ' by number of bedrooms', null, labels.map(function (l, i) { return [l, hb[i]]; }), num, 'homes', stockSrc) + (need ? bars('Renter households by the bedrooms they need', null, need, num, 'households', needSrc, here) : '');
      var small = rows.slice(0, 3), hs = small.reduce(function (a, r) { return a + (r[1] || 0); }, 0), ns = small.reduce(function (a, r) { return a + (r[2] || 0); }, 0);
      var answer = need && ht && rented ? pct(Math.round(hs * 10) / 10) + ' of rented homes have two bedrooms or fewer; ' + pct(Math.round(ns * 10) / 10) + ' of renter households need one that size.' : null;
      return Viz.pairedBars({
        title: (rented ? 'Rented homes' : 'Homes') + ' by bedrooms against renter need by bedrooms', scope: Pl.scope(here), answer: answer, rows: rows,
        series: [[stockLabel + ' (' + num(ht) + ')', Viz.COLORS.homes], ['Renter households, bedrooms needed (' + num(nt) + ')', Viz.COLORS.households]],
        note: (rented ? 'Rented homes are occupied rentals by bedrooms; vacant rentals are not counted. '
          : 'The renter bedroom table has no figure here, so the bars show all homes, mostly owned. They do not compare with renter need and are shown for the mix only. ') +
          'Need is sized at two people a bedroom (HUD’s occupancy rule).',
        source: Pl.srcLine([stockSrc].concat(needSrc ? [needSrc] : []))
      });
    }

    // Which kinds of homes the data supports, ranked by the live page's own scoring (js/components/housing-type-need.js),
    // from the same inputs: this place's ACS profile, its CHAS rows (the town's, or the county's) and the ranking index.
    function housingTypes() {
      var H = global.HousingTypeNeed, MC = global.MixCheck, MI = global.MixCheckInputs, cf = isCounty ? geoid : fips;
      if (!H) return '';
      var chas = extraFile(isCounty ? EXTRA.chasGap : 'data/hna/place-chas.json'), rk = extraFile(EXTRA.ranking);
      var lim = MI ? extraFile(MI.PATHS.limits) : {}, rules = MI ? extraFile(MI.PATHS.rules) : {}, guide = MI ? extraFile(MI.PATHS.guide) : {};
      if (!chas || !rk || !lim || !rules || !guide) return '<p role="status" class="note">Loading the housing-type ranking…</p>';
      var rec = ((isCounty ? chas.counties : chas.places) || {})[geoid] || null;
      var re = (rk.rankings || []).filter(function (x) { return x.geoid === geoid; })[0];
      var prof = Object.assign({}, p, { _geoid: geoid, _geoType: isCounty ? 'county' : 'place' });
      // The ranking index drops an ACS renter-burden share that CHAS contradicts; the live ranking then leaves it out too.
      if (re && re.metrics && re.metrics.pct_cost_burdened === null) { prof.DP04_0141PE = null; prof.DP04_0142PE = null; }
      var input = { acsProfile: prof, chasRows: rec, hudIncomeLimits: null, lihtcInventory: [], jurisdictionName: String(entry.label) };
      if (MC && MI && cf) {
        var mi = MI.build({ limits: Object.keys(lim).length ? lim : null, rules: Object.keys(rules).length ? rules : null, guide: Object.keys(guide).length ? guide : null }, { countyFips: cf }, MC);
        input.mixCheck = { inputs: mi, result: MI.check(MC, mi, {}) };
      }
      var res;
      try { res = H.compute(input); } catch (e) { if (global.console) console.warn(e); return '<p class="note">The housing-type ranking could not be computed for this place.</p>'; }
      var lvl = function (l) { return l === 'VeryHigh' ? 'Very high' : l; };
      var fmtSig = function (s) {
        var x = s.value, n = String(s.name).toLowerCase();
        if (x == null || !isFinite(x)) return 'not published';
        if (/ratio| vs /.test(n)) return Number(x).toFixed(2) + '×';
        if (/count|population|scale/.test(n)) return num(x);
        if (/size/.test(n)) return Number(x).toFixed(2);
        return Math.abs(x) <= 1 ? (x * 100).toFixed(1) + '%' : Number(x).toFixed(1) + '%';
      };
      return '<h2>What types of housing does the data support?</h2>' +
        '<p>Which kinds of homes ' + esc(placeShort) + ' is shortest on, scored 0 to 100 from the figures in this assessment. The income mix above sets who the homes serve; this ranking suggests what to build.</p>' +
        '<ol class="type-rank">' + res.map(function (r) {
          return '<li class="type-card lvl-' + esc(String(r.level).toLowerCase()) + '"><div class="type-head"><strong>' + esc(r.label) + '</strong><span class="type-score">' + esc(lvl(r.level)) + ' · ' + r.score + '</span></div>' +
            '<p class="note">' + esc(r.meta) + ' · ' + esc(r.confidence === 'high' ? 'High' : r.confidence === 'med' ? 'Medium' : 'Low') + ' confidence, ' + esc(r.confidenceReason || '') + '</p>' +
            '<p>' + esc(r.plainEnglish || '') + '</p>' +
            '<details class="type-more"><summary>Tax credit fit, rent test and the signals behind the score</summary>' +
            '<p class="note"><strong>Tax credit fit:</strong> ' + esc(r.lihtcRelevance || '') + '</p>' +
            (r.laneNotes || []).map(function (x) { return '<p class="note">' + esc(x) + '</p>'; }).join('') +
            (r.pencilLines && r.pencilLines.length ? '<p class="note"><strong>Does a home at this rent pay its way for 15 years?</strong></p><ul class="note">' + r.pencilLines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
            (r.signals.length ? '<p class="note"><strong>Signals behind the score:</strong> ' + r.signals.map(function (s) { return esc(s.name) + ' ' + esc(fmtSig(s)) + (s.normalised != null ? ' (' + s.normalised + ')' : ''); }).join(' · ') + '</p>' : '') +
            '</details></li>';
        }).join('') + '</ol>' +
        '<details><summary>How each type is scored</summary><ul>' + res.map(function (r) { return '<li><strong>' + esc(r.label) + ':</strong> ' + esc(r.methodology || '') + '</li>'; }).join('') + '</ul>' +
        '<p class="note">Each signal is turned into a 0–100 score and weighted within its type; missing signals are skipped and the rest reweighted. Low under 30, Moderate 30–49, High 50–69, Very high 70 or more.</p></details>' +
        '<p class="metric-source">' + Pl.srcLine(acs + ' profiles DP02–DP05; HUD CHAS ' + ((chas.meta || {}).vintage || (chas.meta || {}).vintage_chas || '2018-2022') + (isCounty ? '' : ', place estimate'), acsUrl('DP04')) + '</p>';
    }

    // The live HNA's need scorecard (site/need-scorecard.js): four measures, each ranked against Colorado's places
    // (or counties), and their mean. A town with too few renters is scored on its county.
    function scorecard() {
      var S = global.LabNeedScorecard, cf = isCounty ? geoid : fips;
      if (!S || !cf) return '';
      if (S.unavailable) return '<h2>Housing needs scorecard</h2><p role="status" class="note">' + esc(S.unavailable) + '</p>';
      var chas = extraFile(EXTRA.chasGap), pc = extraFile('data/hna/place-chas.json'), econ = extraFile(EXTRA.econ);
      if (!chas || !pc || !econ) return '<p role="status" class="note">Loading the need scorecard…</p>';
      var crec = (chas.counties || {})[cf];
      if (!crec || !crec.summary) return '';
      var prec = isCounty ? null : (pc.places || {})[String(geoid).padStart(7, '0')] || null;
      var cn = crec.name || '', ec = econ.counties || {}, erec = ec[cn] || ec[cn.replace(/\s+County$/i, '')] || ec[cn + ' County'] || null;
      var dist = S.distributions(chas, econ, pc), r = S.score(prec, crec, erec, dist, !isCounty);
      var peers = r.usePlace ? dist.place.blendedBurden.length + ' Colorado places' : dist.county.blendedBurden.length + ' Colorado counties';
      var cPeers = dist.county.affordPressure.length + ' Colorado counties';
      var share = function (x) { return x == null ? 'Not published' : (x * 100).toFixed(1) + '%'; };
      var card = function (title, value, p, peer, detail, at) {
        var p100 = p == null ? null : Math.round(p * 100);
        return '<div class="score-part' + (p100 == null ? '' : ' band-' + S.band(p100).split(' ')[0].toLowerCase()) + '"><p class="score-part-t">' + esc(title) + ' ' + Pl.scope(at) + '</p><p class="score-part-v">' + esc(value) + '</p>' +
          '<p class="note">' + (p100 == null ? 'No peer data' : 'Higher than ' + p100 + '% of ' + esc(peer)) + '</p><p class="note">' + esc(detail) + '</p></div>';
      };
      if (r.composite == null) return '<h2>Housing needs scorecard</h2><p class="note">Not scored: only ' + r.present + ' of 4 need measures are published here.</p>';
      var who = r.usePlace ? here : isCounty ? here : { level: 'county-proxy', countyName: countyName };
      var why = r.usePlace ? null : isCounty ? null : r.placeParts ? 'It has fewer than ' + S.MIN_RENTER_HH + ' renter households, too few for its own shares to be stable, so ' + cn + '’s figures stand in.' : 'HUD’s place estimates do not cover it, so ' + cn + '’s figures stand in.';
      return fold('<h2>Housing needs scorecard</h2>' +
        '<p>Four measures of need, each ranked against ' + esc(peers) + ', and their average. 100 would be the highest in Colorado on every measure.' + (why ? ' ' + esc(why) : '') + '</p>' +
        '<div class="score-head"><p class="score-big">' + r.composite + '<span>/100</span></p><p><strong>' + esc(S.band(r.composite)) + '</strong><br><span class="note">Average rank across ' + r.present + ' of 4 measures, against ' + esc(peers) + '</span></p></div>' +
        '<div class="score-parts">' +
        card('Cost burden, renters and owners', share(r.parts && r.parts.blendedBurden), r.pctA, peers, 'Renters ' + share(r.parts && r.parts.cb30Renter) + ', owners ' + share(r.parts && r.parts.cb30Owner) + ', weighted by household counts', who) +
        card('Deepest need share', share(r.parts && r.parts.deepNeed), r.pctB, peers, 'Renters at or below 30% AMI, as a share of renters at or below 100% AMI', who) +
        card('Home price to income', r.affordPressure == null ? 'Not published' : r.affordPressure.toFixed(1) + '×', r.pctC, cPeers, 'Median home price over median household income', isCounty ? here : { level: 'county-proxy', countyName: countyName }) +
        card('Severely rent-burdened', share(r.parts && r.parts.worstCase), r.pctD, peers, 'Renters paying more than half their income for housing (part of HUD’s worst-case needs, which also counts income and housing condition)', who) +
        '</div>' +
        '<details><summary>How the score works</summary><p>Each measure is ranked against the same kind of geography: a town against towns with at least ' + S.MIN_RENTER_HH + ' renter households, a county against counties. The score is the average of the ranks that are published, and needs at least three. Home price to income is published for counties only, so a town uses its county’s. Bands: Highest need 70 or more, Elevated 50 to 69, Moderate 30 to 49, Lower under 30.</p>' +
        '<p class="note">A screening composite for early tax credit and needs assessment work. Check it against HUD CHAS and Census ACS before citing it in a formal needs assessment.</p></details>' +
        '<p class="metric-source">' + Pl.srcLine('HUD CHAS ' + ((chas.meta || {}).vintage || '2018-2022') + (r.usePlace ? ', place estimates' : '') + '; ' + 'ACS 2020-2024 5-year median home price and household income, by county', 'https://www.huduser.gov/portal/datasets/cp.html') + '</p>',
        r.composite + ' of 100: ' + S.band(r.composite) + ', the average rank on ' + r.present + ' of 4 need measures against ' + peers + '.');
    }

    // Affordable ownership need, screened by the live page's own module (js/hna/hna-ownership-need.js) from the same
    // inputs: the place's CHAS (the town's estimate or the county's), its AMI gap row, and its home value.
    // The live chapter's developer decision chain, as far as it goes on that page: the price context (shown above) and
    // demand by price band, from the same screen (js/hna/hna-ownership-need.js priceBandDemandScreen). The per-home
    // subsidy gap and resale steps are worked in the Deal Calculator and the for-sale page.
    function takeFurther(r, src) {
      var rows = (r.priceBandScreen && r.priceBandScreen.rows) || [];
      var NAME = { lte80: '80% AMI or less', '81to100': '81–100% AMI', '101to120': '101–120% AMI' };
      var gapNote = false;
      var table = rows.length ? '<div class="table-scroll"><table><caption>Possible buyers and homes, by price band</caption><thead><tr><th scope="col">Price band</th><th scope="col">Top price</th><th scope="col" title="Renter households earning in the band: a possible buyer pool, not committed demand">Renter households in the band</th><th scope="col">Homes valued in the band</th><th scope="col">Buyers beyond homes</th></tr></thead><tbody>' +
        rows.map(function (x) {
          var na = x.potentialBuyerPoolHouseholds == null; if (na) gapNote = true;
          return '<tr><th scope="row">' + esc(NAME[x.key] || x.label) + '</th><td>' + money(x.maxAffordablePrice) + '</td><td>' + (na ? 'Not counted' : num(Math.round(x.potentialBuyerPoolHouseholds))) + '</td><td>' + (x.ownerValueSupplyUnits == null ? '—' : num(Math.round(x.ownerValueSupplyUnits))) + '</td><td>' + (x.currentGapHouseholds == null ? '—' : num(Math.round(x.currentGapHouseholds))) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (gapNote ? '<p class="note">HUD’s CHAS income bands stop at 100% AMI, so renters above it are not counted.</p>' : '') +
        (src ? '<p class="metric-source">' + src + '</p>' : '')
        : '<p class="note">No price bands here: there is no four-person AMI to set them.</p>';
      return '<h3>If you are taking this further</h3>' +
        '<p>Renter households who could afford to buy in each price band, against owner homes valued in that band. A buyer pool to test, not buyers ready to purchase.</p>' + table +
        '<p>Next, for a for-sale project: the per-home subsidy gap is worked in the <a href="' + Pl.LIVE + 'deal-calculator.html?geoid=' + esc(geoid) + '" target="_blank" rel="noopener">Deal Calculator’s for-sale mode on the live site ↗</a>, and how deed-restricted resale formulas play out is on <a href="#/for-sale?g=' + esc(geoid) + '">For-sale and ownership</a>.</p>';
    }
    function ownershipNeed() {
      var O = global.HNAOwnershipNeed, U = global.HNAUtils;
      if (!O) return '';
      var chas = extraFile(isCounty ? EXTRA.chasGap : 'data/hna/place-chas.json'), cg = extraFile(EXTRA.chasGap);
      var gap = extraFile(isCounty ? 'data/co_ami_gap_by_county.json' : 'data/co_ami_gap_by_place.json'), gapC = extraFile('data/co_ami_gap_by_county.json'), hv = extraFile(EXTRA.homeValues);
      if (!chas || !cg || !gap || !gapC || !hv) return '<p role="status" class="note">Loading the ownership screen…</p>';
      var rec = ((isCounty ? chas.counties : chas.places) || {})[geoid] || null, fallback = false;
      if (!rec && !isCounty && fips) { rec = (cg.counties || {})[fips] || null; fallback = !!rec; }
      var findC = function (d, f) { var c = d.counties || d, r = Array.isArray(c) ? c.filter(function (x) { return String(x.fips) === String(f); })[0] : c[f]; return r ? Object.assign({ gapSource: 'county' }, r) : null; };
      var g = isCounty ? findC(gap, geoid) : (gap.places || {})[geoid] ? Object.assign({ gapSource: 'place' }, gap.places[geoid]) : null;
      if (!g && fips) g = findC(gapC, fips);
      // As the live page picks it: the county's or the town's published value; none for a town flagged for review;
      // otherwise the ACS figure in the profile.
      var home = null, flagged = {};
      Object.keys(hv.review_flags || {}).forEach(function (k) { (Array.isArray(hv.review_flags[k]) ? hv.review_flags[k] : []).forEach(function (r) { if (r && r.geoid) flagged[String(r.geoid)] = true; }); });
      if (isCounty && (hv.counties || {})[geoid]) home = Object.assign({ geography_level: 'county' }, hv.counties[geoid]);
      else if (!isCounty && hv.places && flagged[geoid]) home = false;
      else if (!isCounty && (hv.places || {})[geoid]) home = Object.assign({ geography_level: 'place' }, hv.places[geoid]);
      if (home === null && U && U.homeValueInfo) {
        var hi = U.homeValueInfo(p);
        if (hi && hi.value) home = { value: hi.value, source: hi.sourceLabel, as_of: hi.asOf, confidence: hi.confidence || 'profile' };
      }
      home = home || null;
      var A = U && U.AFFORD, lvl = isCounty ? 'county' : 'place';
      var r = O.computeOwnershipNeed({
        placeChasEntry: lvl === 'place' ? rec : null, countyChasEntry: lvl === 'county' ? rec : null, chasEntry: null,
        geographyId: geoid, geographyName: String(entry.label), geoLevel: lvl, countyFallback: fallback,
        amiGapEntry: g, homeValueEntry: home, ownerValueSupplyProfile: p,
        assumptions: A ? { termYears: A.termYears, downPaymentRate: A.downPaymentPct, propertyTaxRate: A.propertyTaxPctAnnual, insuranceRate: A.insurancePctAnnual, pmiRate: A.pmiPctAnnual, frontEndRatio: A.paymentToIncome, source: 'HNAUtils.AFFORD' } : null
      });
      if (!r || r.dataQuality === 'Unavailable') return '<h2>Affordable ownership need</h2><p class="note">Not published for this place.</p>';
      var PLAIN = { 'Rental + ownership mix': 'Both rental and ownership tools look worth screening here.', 'Rental priority': 'Rental is where the need concentrates here.',
        'Ownership-supportive strategy': 'Ownership tools look worth screening here.', 'Deep affordability priority': 'The need here concentrates at the deepest income levels.',
        'Verify locally': 'No clear signal either way. This one needs local judgement.' };
      var at = fallback ? { level: 'county-proxy', countyName: countyName } : here, t = r.affordabilityTest;
      var ownSrc = Pl.srcLine('HUD CHAS ' + (((chas.meta || {}).vintage || (chas.meta || {}).vintage_chas) || '2018-2022') + (t ? '; home value: ' + ({ zhvi: 'Zillow Home Value Index', county_zhvi_adjusted: 'Zillow index adjusted to the county ACS', fhfa_county_hpi_anchor: 'ACS median carried forward by the FHFA county price index', acs_raw: 'ACS median' }[t.source] || t.source || 'ACS') + (home && home.as_of ? ', ' + home.as_of : '') : ''), 'https://www.huduser.gov/portal/datasets/cp.html');
      var CLS = { 'market-attainable': 'within reach at 80% AMI', stretch: 'between what 80% and 100% AMI can buy', 'priced-out': 'above what 100% AMI can buy' };
      var tile = function (title, value, tier, detail) { return '<div class="score-part"><p class="score-part-t">' + esc(title) + '</p><p class="score-part-v">' + esc(value) + '</p><p><strong>' + esc(tier) + '</strong></p><p class="note">' + esc(detail) + '</p></div>'; };
      return fold('<h2>Affordable ownership need</h2>' +
        '<div class="callout"><p><strong>' + esc(PLAIN[r.tenureMixRecommendation] || 'Not enough local data to answer this yet.') + '</strong></p><p>' + esc(r.recommendationDetail || '') + '</p>' +
        '<p class="note">Screening estimate · ' + esc(r.tenureMixRecommendation) + ' · ' + esc(r.dataQuality) + ' data quality</p></div>' +
        '<p>' + Pl.scope(at) + '</p><div class="score-parts">' +
        tile('Rental pressure', num(r.renterCostBurdened) + ' renter households', r.rentalPressure.tier, 'paying more than 30% of income; with severe burden and the renter share') +
        tile('Ownership pressure', num(r.ownerCostBurdened) + ' owner households', r.ownershipPressure.tier, 'paying more than 30% of income; with severe and moderate-income owner burden') +
        tile('Shared-equity fit', num(r.moderateIncomeRenterHouseholds) + ' renter households', r.ownershipFit.tier, 'earning 51–100% of area median income: a possible buyer base, not buyers ready to purchase') +
        '</div>' +
        (t ? '<p>The typical home, ' + money(t.medianHomeValue) + ', is ' + esc(CLS[t.classification] || t.classification) + ': a four-person household at 80% AMI can buy up to ' + money(t.maxPriceAt80Ami) + ', at 100% AMI up to ' + money(t.maxPriceAt100Ami) + '.</p>' : '') +
        takeFurther(r, ownSrc) + ownStrategy(r, home) +
        '<details><summary>Caveats</summary><ul>' + (r.caveats || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></details>' +
        '<div class="actions"><a class="button-link secondary" href="#/for-sale?g=' + esc(geoid) + '">For-sale and ownership in ' + esc(placeShort) + '</a></div>' +
        '<p class="metric-source">' + ownSrc + '</p>',
        (PLAIN[r.tenureMixRecommendation] || 'Not enough local data to answer this yet.') + (t ? ' The typical home, ' + money(t.medianHomeValue) + ', is ' + (CLS[t.classification] || t.classification) + '.' : ''));
    }

    // The live page's ownership strategy screen (js/hna/hna-ownership-strategy.js buildViewModel at the pin):
    // the reader picks the buyer model, household size and AMI price ceiling; the engine prices each income tier,
    // the income the typical home takes, and how each resale formula plays out. The lab only draws its answers.
    function ownStrategy(r, home) {
      var S = global.HNAOwnershipStrategy, OF = global.OwnershipFinance, OR = global.OwnershipResale;
      if (!OF) return '';
      if (!S) { needScript('js/hna/hna-ownership-strategy.js'); return '<p role="status" class="note">Loading the ownership strategy screen…</p>'; }
      if (!OF.getRegistry()) { if (OF.registryReady) OF.registryReady.then(function () { Shell.render(); }); return '<p role="status" class="note">Loading the buyer models…</p>'; }
      var docs = {}, waiting = false;
      Object.keys(OWN_FILES).forEach(function (k) { docs[k] = extraFile(OWN_FILES[k]); if (!docs[k]) waiting = true; });
      if (waiting) return '<p role="status" class="note">Loading the ownership strategy screen…</p>';
      var cf = isCounty ? geoid : fips;
      var hud = shared && shared.hud ? shared.hud.counties.filter(function (c) { return c.fips === cf; })[0] : null;
      var ami = Number(hud && hud.income_limits && hud.income_limits.ami_4person), amiYear = shared && shared.hud && shared.hud.meta ? shared.hud.meta.income_limits_fiscal_year : null;
      var ctl = ownCtl[geoid] || {}, vm;
      // The same typical home the screen above prices; a town flagged for review has none, so no price is drawn.
      var price = home && home.value ? { value: home.value, source: home.source, asOf: home.as_of, scope: home.geography_level || (isCounty ? 'county' : 'place'), label: isCounty ? 'County value' : home.geography_level === 'county' ? 'County value' : 'Place value' } : null;
      try {
        vm = S.buildViewModel({
          geo: { type: isCounty ? 'county' : /\bCDP\b/i.test(entry.label) ? 'cdp' : 'place', geoid: String(geoid), countyGeoid: String(cf || geoid), name: entry.label },
          ami4Person: ami > 0 ? ami : null, amiYear: amiYear, ownershipNeedResult: r, engine: OF, resaleEngine: OR,
          price: price, homeValueCascade: {}, datasets: docs,
          modelId: ctl.modelId, householdSize: ctl.householdSize, amiCeilingPct: ctl.amiCeilingPct,
          resaleSubsidyType: ctl.resaleSubsidyType, resaleConventionId: ctl.resaleConventionId
        });
      } catch (e) { return '<p class="note">The ownership strategy screen did not run here: ' + esc(e.message) + '</p>'; }
      var g = esc(geoid), sel = function (k, label, opts) {
        return '<label class="own-ctl">' + esc(label) + '<select data-own="' + k + '" data-own-g="' + g + '">' + opts.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (o[2] ? ' selected' : '') + (o[3] ? ' disabled' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
      };
      var models = (vm.registry && vm.registry.models || []).filter(function (x) { return x.id !== 'custom'; });
      var ceilings = OWN_CEILINGS.concat([vm.amiCeilingPct]).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
      var controls = '<div class="own-ctls">' +
        sel('modelId', 'Buyer model', models.map(function (x) { return [x.id, x.label, x.id === vm.modelId]; })) +
        sel('householdSize', 'Household size', [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return [n, n + (n === 1 ? ' person' : ' people'), n === vm.householdSize]; })) +
        sel('amiCeilingPct', 'Highest income tier', ceilings.map(function (x) { return [x, Math.round(x * 100) + '% AMI', x === vm.amiCeilingPct]; })) + '</div>';
      var target = vm.price ? vm.price.value : null, rows = vm.ladder.filter(function (x) { return x.maxPrice != null; });
      var first = rows.filter(function (x) { return x.clearsMedian; })[0];
      var answer = !rows.length ? '' : target == null ? 'No typical home value is published here, so the tiers are not set against one.'
        : first ? 'A ' + vm.householdSize + '-person household at ' + Math.round(first.tier * 100) + '% AMI can buy the typical home here, ' + money(target) + '.'
        : 'Even at ' + Math.round(rows[rows.length - 1].tier * 100) + '% AMI a ' + vm.householdSize + '-person household falls ' + money(rows[rows.length - 1].shortfall) + ' short of the typical home, ' + money(target) + '.';
      var V = global.LabViz;
      var chart = !rows.length ? '<p class="note">No four-person AMI is published for ' + esc(countyName || 'this county') + ', so no prices can be set.</p>'
        : V ? V.orderedBars({
          title: 'The most each income tier can pay for a home', rows: rows.map(function (x) { return [Math.round(x.tier * 100) + '% AMI', x.maxPrice]; }),
          noShare: true, fmt: function (x) { return money(x); }, answer: answer,
          keys: target == null ? null : [['Can buy the typical home', 'var(--c-green)'], ['Short of it', 'var(--rust)']],
          colorOf: function (row, i) { return target == null ? 'var(--slate)' : rows[i].clearsMedian ? 'var(--c-green)' : 'var(--rust)'; },
          note: 'Model: ' + (vm.model ? vm.model.label : vm.modelId) + '. ' + (vm.model && vm.model.implications && vm.model.implications.who_it_fits || ''),
          source: Pl.srcLine([['HUD FY' + (amiYear || '') + ' income limits, ' + (countyName || 'county'), LINKS.il], ['COHO ownership engine', Pl.LIVE + 'methods.html']])
        }) : '';
      var table = rows.length ? '<div class="table-scroll"><table><caption>Income tiers against the typical home</caption><thead><tr><th scope="col">Tier</th><th scope="col">Household income</th><th scope="col">Most it can pay</th><th scope="col">Against the typical home</th></tr></thead><tbody>' +
        vm.ladder.map(function (x) {
          return '<tr><th scope="row">' + Math.round(x.tier * 100) + '% AMI</th><td>' + money(x.income) + '</td><td>' + money(x.maxPrice) + '</td><td>' +
            (x.clearsMedian == null ? 'No typical home value' : x.clearsMedian ? 'Can buy it' : money(x.shortfall) + ' short') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '';
      var R0 = vm.mortgageRate;
      var need = vm.requiredIncome != null ? '<p>Buying the typical home takes about <strong>' + money(vm.requiredIncome) + '</strong> a year' +
        (vm.requiredIncomeAmiRatio != null ? ', ' + vm.requiredIncomeAmiRatio.toFixed(2) + ' times the four-person AMI' : '') + '.' +
        (vm.requiredIncomeLower != null ? ' At a rate one point lower, ' + (vm.lowerRate * 100).toFixed(2) + '%, it takes ' + money(vm.requiredIncomeLower) + '.' : '') + '</p>' : '';
      var rate = R0 ? '<p class="note">Mortgage rate in these figures: ' + (R0.rateAnnual * 100).toFixed(2) + '%, ' + esc(R0.source || '') + '. A national average, not a quote.</p>' : '';
      var risk = vm.comparison && vm.comparison.riskDisclosureRequired ? '<p class="callout"><strong>Buyer risk:</strong> ' + esc(vm.comparison.riskDisclosure) + '</p>' : '';
      // How each resale formula plays out after ten years, under the engine's market scenarios.
      var rc = vm.resaleComparison, resale = '';
      if (rc && rc.rows && rc.rows.length) {
        resale = '<h4>How each resale formula plays out after ten years</h4>' +
          '<p class="note">The home is bought at the typical value and resold ten years later. Each formula protects something different: the next buyer, the owner’s gain or the public’s money. They are not ranked.</p>' +
          '<div class="own-ctls">' + sel('resaleSubsidyType', 'Public money in the home', (OR.SUBSIDY_TYPES || []).map(function (x) { return [x.id, x.label, x.id === rc.subsidyType]; })) +
          sel('resaleConventionId', 'Formula to mark', rc.options.map(function (o) { return [o.id, o.label + (o.disabled ? ' (not allowed with this money)' : ''), o.id === rc.selectedConventionId, o.disabled]; })) + '</div>' +
          rc.options.filter(function (o) { return o.disabledReason; }).map(function (o) { return '<p class="note"><strong>' + esc(o.label) + ':</strong> ' + esc(o.disabledReason) + '</p>'; }).join('') +
          '<div class="table-scroll"><table><caption>Resale after ten years, by market scenario</caption><thead><tr><th scope="col">Formula</th>' + rc.scenarios.map(function (s) { return '<th scope="col">' + esc(s.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rc.rows.map(function (row) {
            var on = row.conventionId === rc.selectedConventionId;
            return '<tr' + (on ? ' class="own-on"' : '') + '><th scope="row">' + (on ? '<span class="own-mark">Marked</span> ' : '') + esc(row.label) + (row.sourceUrl ? ' <a href="' + esc(row.sourceUrl) + '" rel="noopener">' + esc(row.sourceProgram || 'source') + '</a>' : '') + '</th>' +
              row.outcomes.map(function (o) {
                return '<td>' + (o.maxResalePrice == null ? 'Not available' : 'Next buyer pays <strong>' + money(o.maxResalePrice) + '</strong><br>Owner keeps ' + money(o.ownerGrossEquity) + '<br>Public gets back ' + money(o.publicSubsidyRecaptured)) + '</td>';
              }).join('') + '</tr>';
          }).join('') + '</tbody></table></div><p class="note">' + esc(rc.caveat || '') + '</p>';
      }
      // What else the screen lists for this place: programs, stewards, public land and the HNA and Prop 123 record.
      var progs = vm.developerPrograms.concat(vm.buyerPrograms), auth = vm.local && vm.local.housingAuthority || [];
      var more = '<details><summary>Programs, stewards and public land for ownership here</summary>' +
        '<h4>Programs that can help (' + num(progs.length) + ')</h4>' + (progs.length ? '<ul>' + progs.map(function (x) { return '<li>' + (x.url || x.source_url ? '<a href="' + esc(x.url || x.source_url) + '" rel="noopener">' + esc(x.name || x.provider || x.id) + '</a>' : esc(x.name || x.provider || x.id)) + '</li>'; }).join('') + '</ul><p class="note">A program that could apply is not money committed.</p>' : '<p class="note">None tracked for this place.</p>') +
        '<h4>Who could hold the resale terms</h4>' + (vm.providers.length || auth.length ? '<ul>' + auth.map(function (x) { return '<li>' + esc(x.name) + '</li>'; }).join('') + vm.providers.map(function (x) { return '<li>' + esc(x.name) + '</li>'; }).join('') + '</ul>' : '<p class="note">' + esc(vm.noStewardshipFlag) + '.</p>') +
        '<h4>Public land</h4>' + (vm.publicLandRecords.status === 'verified' ? '<p>' + num(vm.publicParcels.length) + ' verified public parcels in the county file.</p><ul>' + vm.publicParcels.map(function (x) { return '<li>' + esc(x.owner) + ' · ' + esc(x.address || 'no address') + '</li>'; }).join('') + '</ul>' : '<p class="note">' + esc(vm.publicLandRecords.unavailableReason) + '</p>') +
        '<h4>Record on file</h4><ul><li>Current needs assessment: ' + esc(vm.progress && vm.progress.hna && vm.progress.hna.status || 'not tracked') + '</li><li>Proposition 123: ' + esc(vm.prop123 && vm.prop123.status || 'not tracked') + '</li></ul></details>';
      return '<section class="own-strategy" aria-labelledby="own-h-' + g + '"><h3 id="own-h-' + g + '">Ownership strategy screen</h3>' +
        '<p>Choose the buyer, the household and the highest income tier to test. The prices, the income needed and the resale table below follow your choices.</p>' +
        controls + '<p class="note">The highest tier changes prices only. Colorado’s default ceiling for Prop 123 ownership is 120% AMI (SB26-040, from July 1, 2026); rural resort communities can ask DOLA for another (HB23-1304).</p>' +
        risk + chart + table + need + rate + resale + more +
        '<p class="note">A screening estimate, not a market study for a project. Check with lenders, appraisers, the program administrator and the local government before relying on it.</p></section>';
    }

    // What each small building type fits on an acre, against the two HB24-1313 marks, as the live diagram draws it.
    // The town's own stock by structure type and age is in What housing exists.
    function densityTypes() {
      var TYPES = [['Side-by-side duplex', 8, 19, 'Two homes that read as one house.'], ['Townhouses', 11, 25, '2 to 16 multi-story homes side by side, each with its own door.'],
        ['Fourplex', 18, 35, 'Four homes, two up and two down, on a typical house lot.'], ['Courtyard apartments', 26, 70, 'Homes around a shared courtyard, up to about three stories.']];
      // The live diagram's four photos (hna-what-to-do.html, assets/building-types), with its alt text and credits.
      var CC2 = '<a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>, via Wikimedia Commons';
      var PHOTOS = [
        ['duplex-denver.jpg', 320, 'A two-story modern duplex in Denver with two wooden front doors side by side and a front walk to each.', 'A duplex in Denver. Photo: <a href="https://commons.wikimedia.org/wiki/File:Modern_Denver_Duplex_%2832079466241%29.jpg">Paul Sableman</a>, ' + CC2 + '.'],
        ['townhouses-fruita.jpg', 320, 'Two rows of white two-story townhomes with dark gabled roofs in Fruita, each home with its own front door.', 'The Fruita Mews, Fruita. Photo: indiBuild LLC.'],
        ['multiplex-denver.jpg', 260, 'A two-story corner apartment building in Denver with several homes behind separate entries.', 'A small apartment building on Lipan Street, Denver. Photo: <a href="https://commons.wikimedia.org/wiki/File:Lipan_Street_Apartments_%2831387578503%29.jpg">Paul Sableman</a>, ' + CC2 + ', cropped.'],
        ['courtyard-denver.jpg', 320, 'A three-story apartment building in Denver with two wings around a planted entry court.', 'Montgomery Court, Denver. Photo: <a href="https://commons.wikimedia.org/wiki/File:Montgomery_Court.JPG">Jeffrey Beall</a>, <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>, via Wikimedia Commons, cropped.']];
      var photo = function (i) { var p = PHOTOS[i];
        return '<figure class="density-photo"><img src="' + esc(VENDOR + 'assets/building-types/' + p[0]) + '" width="480" height="' + p[1] + '" loading="lazy" decoding="async" alt="' + esc(p[2]) + '"><figcaption>' + p[3] + '</figcaption></figure>'; };
      var x = function (n) { return (n / 70 * 100).toFixed(2) + '%'; };
      return fold('<h2>Housing type feasibility: what each building type fits on an acre</h2>' +
        '<p>Net density for missing-middle building types, with the two marks Colorado’s transit-area law sets. Local zoning decides what any one site allows. The stock already built here, by type and age, is in <a href="#/place/' + esc(geoid) + '/housing">What housing exists</a>.</p>' +
        '<figure class="density"><figcaption><strong>Homes per acre, 0 to 70</strong></figcaption><ul class="density-rows">' + TYPES.map(function (t, i) {
          return '<li>' + photo(i) + '<p><strong>' + esc(t[0]) + '</strong> <span class="note">' + t[1] + '–' + t[2] + ' homes per acre. ' + esc(t[3]) + '</span></p>' +
            '<div class="density-track"><span class="density-bar" style="left:' + x(t[1]) + ';width:calc(' + x(t[2]) + ' - ' + x(t[1]) + ')" title="' + esc(t[0] + ': ' + t[1] + '–' + t[2] + ' homes per acre') + '"></span>' +
            '<span class="density-mark" style="left:' + x(15) + '"></span><span class="density-mark" style="left:' + x(40) + '"></span></div></li>';
        }).join('') + '</ul>' +
        '<ul class="density-key"><li><span class="density-mark-key"></span>15 homes per acre: the least net density a transit center’s zoning must allow (HB24-1313, C.R.S. 29-37-205)</li>' +
        '<li><span class="density-mark-key"></span>40 homes per acre: the average zoned density HB24-1313 sets as the goal in transit areas</li></ul>' +
        '<p class="metric-source">' + Pl.srcLine('Opticos Design, Missing Middle Housing types (net density, lots with and without alleys); Colorado HB24-1313 (2024)', 'https://missingmiddlehousing.com/types') + '</p></figure>',
        'Duplexes 8–19 homes an acre, townhouses 11–25, fourplexes 18–35, courtyard apartments 26–70, against the 15 and 40 a transit area must allow.');
    }

    // Actions commonly used to meet documented need, as the live checklist lists them. Ticks are kept in
    // this browser, for this place, like the live page; they record what the reader marked, nothing more.
    function actionPlan() {
      var done = planTicks(geoid), n = ACTIONS.reduce(function (t, g) { return t + g[1].filter(function (a) { return done[a[0]]; }).length; }, 0), all = ACTIONS.reduce(function (t, g) { return t + g[1].length; }, 0);
      return fold('<h2>Housing action plan checklist</h2><p>Actions commonly used to meet documented housing need. Ticks stay in this browser, for this place.</p>' +
        '<div class="plan-cols">' + ACTIONS.map(function (g) {
          return '<fieldset class="plan-group"><legend>' + esc(g[0]) + '</legend>' + g[1].map(function (a) {
            return '<label class="plan-item"><input type="checkbox" data-plan="' + esc(geoid) + '" value="' + esc(a[0]) + '"' + (done[a[0]] ? ' checked' : '') + '><span><strong>' + esc(a[1]) + '</strong>: ' + esc(a[2]) +
              (a[3] ? ' <a href="' + esc(a[3][1]) + '">' + esc(a[3][0]) + '</a>' : '') + '</span></label>';
          }).join('') + '</fieldset>';
        }).join('') + '</div>' +
        '<p role="status" aria-live="polite"><strong>' + n + ' of ' + all + '</strong> actions marked as started.</p>' +
        '<p class="note">Drawn from Colorado housing needs assessments, including the <a href="https://cdola.colorado.gov/housing" target="_blank" rel="noopener">Colorado Division of Housing</a>’s and CHFA’s.</p>',
        all + ' actions in ' + ACTIONS.length + ' groups; ' + n + ' marked as started in this browser.');
    }

    var t = {};

    t.overview = function () {
      // The live Executive Snapshot's eight figures: the four above, renter share, income to buy, rent burden and commute.
      var hm = m('median_home_value'), inc = v('median_hh_income'), need = hm ? buyIncome(hm.value) : null, OF = global.OwnershipFinance;
      var s8 = c.summary.acsS0801 || {}, commute = s8.S0801_C01_046E == null || s8.S0801_C01_046E === '' ? null : Number(s8.S0801_C01_046E);
      var gapNote = need != null && inc != null ? (need > inc ? 'The median household earns ' + money(need - inc) + ' less.' : 'The median household earns enough.') : null;
      // Gemini round 10, picks A and B (paul 11-05): the ladder strip leads; the band-by-band chart folds under it.
      var Tf = global.LabTpl;
      var gapPart = place ? (Tf && Tf.fold && Pl.ladder && Pl.ladder(place) ? Tf.fold('Show the numbers: renters and homes in every income band', '', Pl.gapChart(place), { level: 3 }) : Pl.gapChart(place)) : '';
      return gapPart + '<h2>Executive snapshot</h2><div class="metrics">' +
        Pl.card('Population', num(pv('DP05_0001E')), null, acs, acsUrl('DP05'), here) +
        mc('Median household income', 'median_hh_income', money) +
        mc('Median gross rent', 'gross_rent_median', money) +
        mc('Typical home value', 'median_home_value', money) +
        mc('Renter-occupied homes', 'pct_renters', function (x) { return pct(x); }) +
        (need == null ? '' : Pl.card('Income needed to buy', money(need), gapNote, sourceOf(hm, ctx) + '; ' + (OF.MORTGAGE_RATE.rateAnnual * 100).toFixed(2) + '% rate, ' + OF.MORTGAGE_RATE.source, sourceUrl(hm, ctx), buyScope())) +
        Pl.card('Mean commute', commute == null ? null : Math.round(commute) + ' min', 'One way, for workers who live here', acs + ', S0801', acsUrl('S0801'), here) +
        '</div>' + versusCounty() + '<h2>Need at a glance</h2><div class="metrics">' +
        mc('Renters minus homes priced for them, at or below 30% AMI', 'ami_gap_30pct', num, 'Some of those homes are rented by higher-income households. AMI is area median income, set by HUD for the county.') +
        mc('Renters minus homes priced for them, at or below 60% AMI', 'ami_gap_60pct', num) +
        mc('Renters paying over 30% of income', 'pct_cost_burdened', function (x) { return pct(x); }) +
        mc('Homes needed over 20 years', 'future_units_needed_20yr', needNum, smallRec() ? 'Fewer than 250 households: see the county' : needWhy('Resident growth plus in-commuters, from the State Demography Office forecast')) +
        '</div>' +
        '<div class="metrics">' +
        mc('HNA priority score (need and opportunity)', 'overall_need_score', function (x) { return Number(x).toFixed(1); }, 'From 0 to 100: 55% need, 45% opportunity, so not need alone') +
        mc('Statewide need ranking', 'rank', function (x) { return '#' + x; }, 'Among Colorado counties, places and CDPs') +
        '</div>';
    };

    t.people = function () {
      var hh = pv('DP02_0001E');
      return '<div class="metrics">' +
        Pl.card('Population', num(pv('DP05_0001E')), null, acs, acsUrl('DP05'), here) +
        Pl.card('Households', num(hh), pv('DP02_0016E') != null ? pv('DP02_0016E') + ' people per household' : null, acs, acsUrl('DP02'), here) +
        mc('Residents 65 and older', 'pct_age_65_plus', function (x) { return pct(x); }) +
        mc('Renters', 'pct_renters', function (x) { return pct(x); }, 'Share of households') +
        mc('Median household income', 'median_hh_income', money) +
        mc('Residents of color', 'pct_bipoc_population', function (x) { return pct(x); }) +
        mc('Single-parent households', 'pct_single_parent_households', function (x) { return pct(x); }) +
        mc('Adults 25+ without a high school diploma', 'pct_no_hs_degree_25plus', function (x) { return pct(x); }) +
        '</div>' +
        runningTotals() +
        composition() +
        '<h2>Household income distribution</h2>' +
        bars('Households by income', 'Number of households in each income bracket, the starting point for sizing need by AMI tier', INCOME.map(function (b) { return [b[0], pv(b[1])]; }), num, null, [acs + ', DP03', acsUrl('DP03')]) +
        raceEthnicity() + education() + ages() +
        '<h2>Work and commuting</h2>' + commuting() + '<div class="metrics">' +
        mc('Low-wage jobs located here', 'local_low_wage_jobs', num) +
        mc('Workers commuting in', 'in_commuters', num) +
        mc('Local jobs held by in-commuters', 'commute_ratio', function (x) { return pct(x, 0); }) +
        mc('County service-sector share of jobs', 'county_service_sector_share_pct', function (x) { return pct(x); }, countyName) +
        '</div>';
    };

    // ---- What housing exists: the live chapter's sections, redrawn ----
    var YEAR_BUILT = [['2020 or later', 'DP04_0017E'], ['2010s', 'DP04_0018E'], ['2000s', 'DP04_0019E'], ['1990s', 'DP04_0020E'], ['1980s', 'DP04_0021E'],
      ['1970s', 'DP04_0022E'], ['1960s', 'DP04_0023E'], ['1950s', 'DP04_0024E'], ['1940s', 'DP04_0025E'], ['Before 1940', 'DP04_0026E']];
    var HOME_VALUE = [['Under $50K', 'DP04_0081E'], ['$50K\u2013$100K', 'DP04_0082E'], ['$100K\u2013$150K', 'DP04_0083E'], ['$150K\u2013$200K', 'DP04_0084E'],
      ['$200K\u2013$300K', 'DP04_0085E'], ['$300K\u2013$500K', 'DP04_0086E'], ['$500K\u2013$1M', 'DP04_0087E'], ['$1M or more', 'DP04_0088E']];
    var share = function (part, all) { return all ? part / all * 100 : null; };
    function yearBuilt() {
      var rows = YEAR_BUILT.map(function (b) { return [b[0], pv(b[1])]; });
      if (rows.every(function (r) { return r[1] == null; })) return '';
      var tot = rows.reduce(function (t, r) { return t + (r[1] || 0); }, 0), pre60 = (pv('DP04_0024E') || 0) + (pv('DP04_0025E') || 0) + (pv('DP04_0026E') || 0), since10 = (pv('DP04_0017E') || 0) + (pv('DP04_0018E') || 0);
      return '<h2>Age of housing stock</h2><p>When the homes were built. Older homes may need repairs; newer ones show how much the place has been building lately.</p>' +
        draw('orderedBars', { title: 'Homes by year built', scope: Pl.scope(here), color: Viz && Viz.COLORS.homes, rows: rows, total: tot,
          answer: pct(share(pre60, tot)) + ' of homes were built before 1960; ' + pct(share(since10, tot)) + ' since 2010.',
          note: 'Year built is reported by the household and grouped by decade; the survey does not record condition or renovation.', source: Pl.srcLine(acs + ', DP04', acsUrl('DP04')) });
    }
    function homeValues() {
      var rows = HOME_VALUE.map(function (b) { return [b[0], pv(b[1])]; });
      if (rows.every(function (r) { return r[1] == null; })) return '';
      var mv = m('median_home_value');
      return '<h2>Home value distribution</h2><p>Owner-occupied homes by the value their owners report. The median alone hides whether the market is thin at lower prices or heavy at the top.</p>' +
        draw('orderedBars', { title: 'Owner homes by value', scope: Pl.scope(here), color: Viz && Viz.COLORS.homes, rows: rows, total: pv('DP04_0080E'),
          answer: pv('DP04_0089E') != null ? 'The survey median is ' + money(pv('DP04_0089E')) + '.' : null,
          note: mv ? 'The headline typical value on the Overview (' + money(mv.value) + ') is Zillow\u2019s current index for all homes; these bars are the 2020\u20132024 survey of owners, a different measure and period, so they sit lower.' : null,
          source: Pl.srcLine(acs + ', DP04', acsUrl('DP04')) });
    }
    // New homes permitted each year, single-family and apartments, against what the forecast needs a year.
    function permitPace() {
      var pm = extraFile(EXTRA.permits), pr = pm && (isCounty ? (pm.counties || {})[geoid] : (pm.places || {})[geoid]);
      if (!pr || !pm.years || !pr.units_total) return '';
      var yrs = pm.years.map(function (y, i) { return [String(y), pr.units_total[i], pr.units_sf ? pr.units_sf[i] : null, pr.units_mf ? pr.units_mf[i] : null]; }).filter(function (r) { return r[1] != null; });
      if (!yrs.length) return '';
      var tot = yrs.reduce(function (t, r) { return t + r[1]; }, 0), last = yrs[yrs.length - 1], first = yrs[0], pvn = pr.production_vs_need;
      return '<h2>Pace and scale of new housing permits</h2><p>How many new homes ' + esc(placeShort || entry.label) + ' has permitted each year, against the yearly need the forecast sets.</p>' +
        '<div class="metrics">' + Pl.card('Homes permitted, ' + first[0] + '\u2013' + last[0], num(tot), 'Across ' + yrs.length + ' year' + (yrs.length === 1 ? '' : 's') + ' with data', 'Census Building Permits Survey', 'https://www.census.gov/construction/bps/', here) +
        Pl.card('Average a year', num(tot / yrs.length), null, 'Census Building Permits Survey', 'https://www.census.gov/construction/bps/', here) +
        Pl.card('Most recent year (' + last[0] + ')', num(last[1]), yrs.length > 1 ? 'Against ' + num(first[1]) + ' in ' + first[0] : null, 'Census Building Permits Survey', 'https://www.census.gov/construction/bps/', here) +
        (pvn && pvn.annual_need_10yr_dola ? Pl.card('Homes needed a year', num(pvn.annual_need_10yr_dola), 'First 10 years of the State Demography Office forecast; recent permits run ' + Number(pvn.ratio_recent_production_to_10yr_need).toFixed(2) + ' times that', 'State Demography Office forecast', LINKS.dola, scopeOf(d.future_units_needed_20yr, 'future_units_needed_20yr', sctx) || here) : '') + '</div>' +
        (!Viz ? '' : Viz.cumulative({
          title: 'Homes permitted each year, ' + first[0] + '\u2013' + last[0], scope: Pl.scope(here), color: Viz.COLORS.homes,
          rows: yrs.map(function (r) { return [r[0], r[1]]; }),
          ref: pvn && pvn.annual_need_10yr_dola ? { value: pvn.annual_need_10yr_dola, label: 'Needed a year' } : null,
          answer: pvn && pvn.annual_need_10yr_dola ? 'An average of ' + num(tot / yrs.length) + ' homes a year, against ' + num(pvn.annual_need_10yr_dola) + ' a year the forecast needs.' : 'An average of ' + num(tot / yrs.length) + ' homes a year.',
          note: pvn && pvn.annual_need_10yr_dola ? 'The dashed line is the yearly need over the first 10 years of the State Demography Office forecast.' : null,
          source: Pl.srcLine('Census Building Permits Survey, ' + first[0] + '\u2013' + last[0], 'https://www.census.gov/construction/bps/')
        })) +
        '<details class="type-more"><summary>Year by year, single-family and apartments</summary><div class="table-scroll"><table><caption>Homes permitted by year</caption><thead><tr><th scope="col">Year</th><th scope="col">All homes</th><th scope="col">Single-family</th><th scope="col">Apartments and other</th></tr></thead><tbody>' +
        yrs.map(function (r) { return '<tr><th scope="row">' + r[0] + '</th><td>' + num(r[1]) + '</td><td>' + (r[2] == null ? '' : num(r[2])) + '</td><td>' + (r[3] == null ? '' : num(r[3])) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' +
        '<p class="metric-source">' + Pl.srcLine('Census Building Permits Survey, ' + first[0] + '\u2013' + last[0], 'https://www.census.gov/construction/bps/') + '</p>';
    }
    // Seasonal homes from the Census vacancy count, with its margin, then short-term rental licences and lodging taxes.
    function secondHomes() {
      var sf = extraFile(EXTRA.second), g = sf && sf.geographies && sf.geographies[geoid];
      if (!g) return '';
      var sh = g.seasonal_homes, rel = { reliable: 'Reliable', caution: 'Use with caution', unreliable: 'Use with caution: the margin is about half the estimate or more, so read it as a rough order of magnitude' };
      var taxes = g.lodging_taxes || [];
      return '<h2>Second homes, short-term rentals and lodging taxes</h2><p>Where second homes and short-term rentals take a large share of homes, workers compete with visitors for the same homes. This puts the size of that pressure next to what the town or county taxes to answer it.</p>' +
        '<h3>Second homes</h3>' + (sh ? '<div class="metrics">' + Pl.card('Homes held for seasonal or occasional use', pct(sh.share_of_housing_units * 100) + ' \u00b1' + Number(sh.share_moe * 100).toFixed(1), num(sh.units) + ' (\u00b1' + num(sh.moe) + ') of ' + num(sh.housing_units) + ' homes. ' + (rel[sh.reliability] || ''), 'ACS 2020\u20132024, B25004 and B25001', 'https://data.census.gov/table/ACSDT5Y2024.B25004', here) + '</div>' +
          '<p class="note">Homes nobody lives in for most of the year: how the Census counts second homes and many short-term rentals.</p>' : '<p class="note">' + esc(g.seasonal_homes_unavailable_reason || 'Not published for this place.') + '</p>') +
        '<h3>Short-term rentals</h3>' + (g.str_licenses && g.str_licenses.count != null ? '<p>' + num(g.str_licenses.count) + ' licensed short-term rentals' + (g.str_licenses.as_of ? ', as of ' + esc(g.str_licenses.as_of) : '') + (g.str_licenses.source_url ? ' (<a href="' + esc(g.str_licenses.source_url) + '">' + esc(g.str_licenses.source_label || 'source') + '</a>)' : '') + '.</p>'
          : '<p class="note">No official short-term rental licence count has been found here yet. This is not a count of zero.</p>') +
        '<h3>Lodging and short-term rental taxes for housing</h3>' + (taxes.length ? '<ul class="li-items">' + taxes.map(function (x) {
          return '<li class="li-item"><p class="li-what"><strong>' + esc(x.jurisdiction) + '</strong> \u00b7 ' + esc(x.rate_text) + ' <span class="scope-tag">' + esc(x.status === 'adopted' ? 'In effect' : x.status) + '</span></p><p>' + esc(x.summary) + '</p>' +
            '<p class="note"><a href="' + esc(x.source_url) + '">' + esc(x.source_label) + '</a>, checked ' + esc(x.checked) + '</p></li>';
        }).join('') + '</ul>' : '<p class="note">No lodging or short-term rental tax for housing is on record here. A place with no record has not been shown to have none.</p>') +
        '<p class="note">How resort towns house workers without tax credits: <a href="#/research/brief/workforce-housing-without-tax-credits-2026">Local workforce housing without tax credits</a>.</p>';
    }
    // Tax credit properties in the place and county, Qualified Census Tracts among the place's own tracts, and DDA status.
    function creditOverlays() {
      var lf = extraFile(EXTRA.lihtc), qf = extraFile(EXTRA.qct), df = extraFile(EXTRA.dda), tf = isCounty ? {} : extraFile(EXTRA.tracts);
      // A county has no ZIP of its own: a Small Area (ZIP) DDA counts for it when one of the ZIP's places is in the county.
      var pcl = isCounty ? extraFile(EXTRA.placeCounty) : {};
      if (!lf || !qf || !df || !tf || !pcl) return '';
      // A list that did not load is not zero properties, zero tracts or "Not in a DDA".
      if (extraFailed(EXTRA.lihtc, EXTRA.qct, EXTRA.dda) || (!isCounty && extraFailed(EXTRA.tracts)) || (isCounty && extraFailed(EXTRA.placeCounty))) {
        return '<h2>LIHTC, QCT and DDA</h2><p class="note">The tax credit property, Qualified Census Tract or Difficult Development Area list did not load, so no counts or designation are shown here. Open this chapter again in a moment to retry.</p>';
      }
      var cf = isCounty ? geoid : fips, props = (lf.features || []).map(function (f) { return f.properties || f; });
      var inCounty = props.filter(function (x) { return x.CNTY_FIPS === cf; });
      var nm = String(placeShort || '').toLowerCase(), inPlace = isCounty ? inCounty : inCounty.filter(function (x) { return String(x.PROJ_CTY || '').toLowerCase() === nm; });
      var units = function (a) { return a.reduce(function (t, x) { return t + (x.LI_UNITS || 0); }, 0); };
      var qcts = (qf.features || []).map(function (f) { return f.properties.GEOID; });
      var countyQ = qcts.filter(function (g) { return g.indexOf(cf) === 0; });
      var mine = isCounty ? null : (((tf.places || tf)[geoid] || {}).tracts || []).filter(function (t) { return (+t.share_of_place_area || 0) > 0.05 || (+t.share_of_tract_area || 0) > 0.20; }).map(function (t) { return t.tract_geoid; });
      var myQ = mine ? mine.filter(function (t) { return qcts.indexOf(t) > -1; }) : null;
      var dd = (df.features || []).map(function (f) { return f.properties; });
      var countyDda = dd.some(function (x) { return x.DDA_KIND === 'county' && x.GEOID === cf; });
      var pclMap = (pcl && pcl.places) || {};
      var zipDda = dd.filter(function (x) {
        if (x.DDA_KIND !== 'zip') return false;
        return isCounty ? (x.PLACE_GEOIDS || []).some(function (g) { return pclMap[g] === geoid; }) : (x.PLACE_GEOIDS || []).indexOf(geoid) > -1;
      });
      var ddaWord = countyDda ? 'In a DDA' : zipDda.length ? 'Partly in a DDA' : 'Not in a DDA';
      var ddaDetail = countyDda ? 'The whole county is a HUD Difficult Development Area for ' + (df.designationYear || '') + '.' : zipDda.length ? 'ZIP code' + (zipDda.length > 1 ? 's ' : ' ') + zipDda.map(function (x) { return x.ZCTA5; }).join(', ') + ' (' + esc(zipDda[0].DDA_NAME) + ') ' + (zipDda.length > 1 ? 'are Small Area Difficult Development Areas' : 'is a Small Area Difficult Development Area') + ' for ' + (df.designationYear || '') + '. Only a site inside ' + (zipDda.length > 1 ? 'one of those ZIP codes' : 'that ZIP code') + ' gets the boost.' : 'No HUD ' + (df.designationYear || '') + ' Difficult Development Area covers ' + (isCounty ? 'the county' : placeShort) + '.';
      var hud = 'https://www.huduser.gov/portal/datasets/qct.html';
      keep('lihtc', num(inPlace.length), 'tax credit properties on record here', ['CHFA tax credit properties', 'https://www.chfainfo.com/rental-housing/housing-credit']);
      keep('qct', isCounty ? num(countyQ.length) : num(myQ.length) + ' of ' + num(mine.length), 'Qualified Census Tracts' + (isCounty ? '' : ' among the tracts here') + ', where a tax credit deal can take a 30% basis boost', ['HUD QCT list', hud]);
      var list = inPlace.slice().sort(function (a, b) { return (b.AwardYear || 0) - (a.AwardYear || 0); });
      return '<h2>LIHTC, QCT and DDA</h2><p>Tax credit properties on record, Qualified Census Tracts (low-income tracts, where a 9% or 4% deal can take a 30% basis boost) and Difficult Development Areas (high-cost areas, the same boost).</p>' +
        '<div class="metrics">' + Pl.card('Tax credit properties', num(inPlace.length), isCounty ? null : num(inCounty.length) + ' in ' + countyName, 'CHFA tax credit properties', 'https://www.chfainfo.com/rental-housing/housing-credit', here) +
        Pl.card('Income-restricted homes in them', num(units(inPlace)), isCounty ? null : num(units(inCounty)) + ' county-wide', 'CHFA tax credit properties', 'https://www.chfainfo.com/rental-housing/housing-credit', here) +
        (isCounty ? Pl.card('Qualified Census Tracts', num(countyQ.length), null, 'HUD QCT list', hud, here)
          : Pl.card('Qualified Census Tracts here', num(myQ.length) + ' of ' + num(mine.length), 'Tracts that overlap ' + placeShort + '; ' + countyName + ' has ' + num(countyQ.length), 'HUD QCT list', hud, here)) +
        Pl.card('Difficult Development Area', ddaWord, ddaDetail, 'HUD DDA list, ' + (df.designationYear || ''), hud, here).replace('<div class="metric">', '<div class="metric word">') + '</div>' +
        (list.length ? '<div class="table-scroll"><table><caption>Tax credit properties in ' + esc(isCounty ? entry.label : placeShort) + '</caption><thead><tr><th scope="col">Property</th><th scope="col">Credit</th><th scope="col">Awarded</th><th scope="col">Income-restricted homes</th><th scope="col">All homes</th></tr></thead><tbody>' +
          list.map(function (x) { return '<tr><th scope="row">' + esc(x.PROJECT) + '</th><td>' + esc(x.CREDIT || x.TypeOfCredits || '') + '</td><td>' + esc(x.AwardYear || x.YR_ALLOC || '') + '</td><td>' + num(x.LI_UNITS) + '</td><td>' + num(x.N_UNITS) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        '<p class="metric-source">' + Pl.srcLine([['CHFA tax credit properties', 'https://www.chfainfo.com/rental-housing/housing-credit'], ['HUD QCT and DDA lists, ' + (df.designationYear || ''), hud]]) + '</p>' +
        '<p class="note">See every property on the <a href="#/opportunity/preservation">preservation inventory</a> and the QCT layer on the <a href="#/data/map?layer=qct">data map</a>.</p>';
    }
    // The live chapter's affordable property map (js/hna/hna-renderers.js with js/components/affordable-housing-layer.js):
    // every tax credit, HUD, USDA and local voucher property in the county, or within 30 miles of a town, as the live
    // panel scopes it. The live layer's twelve program labels are grouped into five colours; each row keeps its label.
    var PROP_GROUPS = [
      ['9% tax credit', 'var(--rust)', function (pt) { return pt.indexOf('lihtc-9pct') > -1; }],
      ['4% tax credit', 'var(--c-blue)', function (pt) { return pt.indexOf('lihtc-4pct') > -1; }],
      ['HUD multifamily', 'var(--c-purple)', function (pt) { return pt.indexOf('hud-multifamily') > -1; }],
      ['USDA Rural Development', 'var(--c-green)', function (pt) { return pt.indexOf('usda-rural-development') > -1; }],
      ['Other: middle-income credit, local vouchers, preservation list', 'var(--grey)', function () { return true; }]
    ];
    function propertyMap() {
      var A = global.AffordableHousingLayer;
      if (!A) needScript('js/components/affordable-housing-layer.js');
      var pf = extraFile('data/affordable-housing/properties.json'), bf = extraFile(isCounty ? EXTRA.countyShapes : EXTRA.placeShapes);
      var br = extraFile('data/affordable-housing/chfa-awards/2026-round-one.json');
      // HUD's two basis-boost designations, drawn under the dots as the live map's QCT and DDA layers do.
      var qf = extraFile(EXTRA.qct), df = extraFile(EXTRA.dda);
      if (!pf || !bf || !br || !qf || !df) return '<p role="status" class="note">Loading the property map…</p>';
      var shape = (bf.features || []).filter(function (f) { var q = f.properties || {}; return String(q.geoid || q.GEOID) === String(geoid); })[0];
      if (!shape || !pf.properties) return '';
      // CHFA's 2026 round-one awards join the list until CHFA's feed carries them, as the live layer merges them.
      var props = pf.properties.concat(((br && br.awards) || []).filter(function (a) { return isFinite(parseFloat(a.lat)) && isFinite(parseFloat(a.lon)); }).map(function (a) {
        var pt = ['chfa-2026-r1-bridge'];
        if (a.federal_9pct_credit) pt.push('lihtc-9pct'); if (a.federal_4pct_credit) pt.push('lihtc-4pct'); if (a.state_credit) pt.push('lihtc-state-paired'); if (a.mihtc_credit) pt.push('lihtc-mihtc');
        return { property_name: a.name, city: a.city, county_fips: a.county_fips, lat: +a.lat, lng: +a.lon, program_type: pt, total_units: a.total_units, award_year: 2026 };
      }));
      var polys = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates;
      var w = 180, e = -180, so = 90, n = -90;
      polys.forEach(function (pg) { pg[0].forEach(function (c) { w = Math.min(w, c[0]); e = Math.max(e, c[0]); so = Math.min(so, c[1]); n = Math.max(n, c[1]); }); });
      var lat0 = (so + n) / 2, lon0 = (w + e) / 2, k = Math.cos(lat0 * Math.PI / 180), MI = 30;
      var dist = function (lat, lon) { var dy = (lat - lat0) * 69.0, dx = (lon - lon0) * 69.0 * k; return Math.sqrt(dx * dx + dy * dy); };
      // Miles from the centre to the nearest point of the edge p-q ([lon, lat] pairs), on the same flat projection as dist().
      var segDist = function (p, q) {
        var ax = (p[0] - lon0) * 69.0 * k, ay = (p[1] - lat0) * 69.0, bx = (q[0] - lon0) * 69.0 * k, by = (q[1] - lat0) * 69.0;
        var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, s = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
        var x = ax + s * dx, y = ay + s * dy;
        return Math.sqrt(x * x + y * y);
      };
      // A record with no county code is placed by its point inside the county's boundary (outer rings, holes ignored).
      var inside = function (lon, lat) {
        return polys.some(function (pg) {
          var ring = pg[0], on = false;
          for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            if ((ring[i][1] > lat) !== (ring[j][1] > lat) && lon < (ring[j][0] - ring[i][0]) * (lat - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) on = !on;
          }
          return on;
        });
      };
      var inScope = props.filter(function (x) {
        if (!isFinite(x.lat) || !isFinite(x.lng)) return false;
        return isCounty ? (x.county_fips ? String(x.county_fips) === String(geoid) : inside(x.lng, x.lat)) : dist(x.lat, x.lng) <= MI;
      });
      if (!isCounty) { so = lat0 - MI / 69.0; n = lat0 + MI / 69.0; w = lon0 - MI / (69.0 * k); e = lon0 + MI / (69.0 * k); }
      else { var pad = 2 / 69.0; so -= pad; n += pad; w -= pad / k; e += pad / k; }
      var W = 720, H = Math.max(300, Math.min(720, Math.round(W * (n - so) / ((e - w) * k))));
      var sc = Math.min(W / ((e - w) * k), H / (n - so)), ox = (W - (e - w) * k * sc) / 2, oy = (H - (n - so) * sc) / 2;
      var X = function (lon) { return (ox + (lon - w) * k * sc).toFixed(1); }, Y = function (lat) { return (oy + (n - lat) * sc).toFixed(1); };
      var rings = function (g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; };
      var inView = function (g) {
        var a = 180, b = -180, c = 90, d = -90;
        rings(g).forEach(function (pg) { pg[0].forEach(function (q) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); c = Math.min(c, q[1]); d = Math.max(d, q[1]); }); });
        if (!(a <= e && b >= w && c <= n && d >= so)) return false;
        // A town's view is the 30-mile ring. A shape is in it when any edge comes within 30 miles of the centre
        // (which also covers a corner inside the ring), or when the centre lies inside the shape. Testing only the
        // corners missed a large tract whose edge crosses the ring with every corner outside it (closeout ledger P05:
        // Cokedale and QCT 08023972700, Stratmoor and QCT 08093000500).
        return isCounty || rings(g).some(function (pg) {
          var ring = pg[0], on = false;
          for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            if (segDist(ring[j], ring[i]) <= MI) return true;
            if ((ring[i][1] > lat0) !== (ring[j][1] > lat0) && lon0 < (ring[j][0] - ring[i][0]) * (lat0 - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) on = !on;
          }
          return on;
        });
      };
      var draw = function (g) { return rings(g).map(function (pg) { return pg.map(function (ring) { return 'M' + ring.map(function (q) { return X(q[0]) + ' ' + Y(q[1]); }).join('L') + 'Z'; }).join(''); }).join(''); };
      // A county map shows the county's own tracts; a town map shows every tract its 30-mile view reaches.
      var qcts = (qf.features || []).filter(function (f) { return isCounty ? String(f.properties.GEOID).indexOf(String(geoid)) === 0 : inView(f.geometry); });
      var ddas = (df.features || []).filter(function (f) { return isCounty && f.properties.DDA_KIND === 'county' ? f.properties.GEOID === String(geoid) : inView(f.geometry); });
      var hudYear = df.designationYear || '';
      var groupOf = function (x) { var pt = x.program_type || []; for (var i = 0; i < PROP_GROUPS.length; i++) if (PROP_GROUPS[i][2](pt)) return i; return PROP_GROUPS.length - 1; };
      var label = function (x) { var c = A && A.categorize ? A.categorize(x) : null; return c ? c.label : PROP_GROUPS[groupOf(x)][0]; };
      var counts = PROP_GROUPS.map(function () { return 0; }), units = 0;
      inScope.forEach(function (x) { counts[groupOf(x)]++; units += +x.total_units || 0; });
      var path = polys.map(function (pg) { return pg.map(function (ring) { return 'M' + ring.map(function (c) { return X(c[0]) + ' ' + Y(c[1]); }).join('L') + 'Z'; }).join(''); }).join('');
      var r = function (x) { return Math.min(9, 3 + Math.sqrt(+x.total_units || 0) / 3).toFixed(1); };
      // Larger properties first, so a small one is never hidden under a large one.
      var dots = inScope.slice().sort(function (a, b) { return (+b.total_units || 0) - (+a.total_units || 0); });
      var where = isCounty ? 'in ' + entry.label : 'within 30 miles of ' + placeShort;
      var mapLabel = 'Map of ' + num(inScope.length) + ' affordable properties ' + where + ', coloured by program';
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(mapLabel) + '">' +
        (isCounty ? '' : '<circle cx="' + X(lon0) + '" cy="' + Y(lat0) + '" r="' + (MI / 69.0 * sc).toFixed(1) + '" fill="var(--map-empty)" stroke="var(--grey-line)" stroke-width="0.7" stroke-dasharray="4,4"/>') +
        '<path d="' + path + '" fill="var(--map-1)" fill-opacity="0.55" stroke="var(--ink)" stroke-width="1.5"/>' +
        (isCounty ? '' : '<defs><clipPath id="pm-ring"><circle cx="' + X(lon0) + '" cy="' + Y(lat0) + '" r="' + (MI / 69.0 * sc).toFixed(1) + '"/></clipPath></defs>') +
        '<g' + (isCounty ? '' : ' clip-path="url(#pm-ring)"') + '>' +
        (ddas.length ? '<defs><pattern id="pm-dda" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="var(--rust)" stroke-width="1.6"/></pattern></defs>' +
          '<g class="pm-dda" fill="url(#pm-dda)" stroke="var(--rust)" stroke-width="1">' + ddas.map(function (f) { return '<path d="' + draw(f.geometry) + '"><title>' + esc('Difficult Development Area: ' + (f.properties.DDA_NAME || f.properties.NAME || '') + (f.properties.ZCTA5 ? ', ZIP code ' + f.properties.ZCTA5 : '')) + '</title></path>'; }).join('') + '</g>' : '') +
        (qcts.length ? '<g class="pm-qct" fill="var(--layer-qct)" fill-opacity="0.3" stroke="var(--layer-qct)" stroke-width="1">' + qcts.map(function (f) { return '<path d="' + draw(f.geometry) + '"><title>' + esc('Qualified Census Tract ' + f.properties.GEOID) + '</title></path>'; }).join('') + '</g>' : '') + '</g>' +
        '<g stroke="var(--card)" stroke-width="0.7">' + dots.map(function (x) {
          return '<circle cx="' + X(x.lng) + '" cy="' + Y(x.lat) + '" r="' + r(x) + '" fill="' + PROP_GROUPS[groupOf(x)][1] + '"><title>' + esc((x.property_name || 'Property') + ', ' + (x.city || '') + ': ' + label(x) + (x.total_units ? ', ' + num(x.total_units) + ' homes' : '')) + '</title></circle>';
        }).join('') + '</g>' +
        '<g><line x1="12" y1="' + (H - 14) + '" x2="' + (12 + 5 / 69.0 * sc).toFixed(1) + '" y2="' + (H - 14) + '" stroke="var(--ink)" stroke-width="3"/><text x="12" y="' + (H - 22) + '" font-size="14" fill="var(--ink)">5 miles</text></g></svg>';
      var gen = String(((pf.metadata || {}).generated) || '').slice(0, 10);
      var credit = counts[0] + counts[1];
      return fold('<h2>Affordable properties on the map</h2><figure class="pres-map prop-map"><figcaption><strong>Affordable properties ' + esc(where) + '</strong>' +
        '<span class="viz-answer">' + esc(num(inScope.length) + ' properties with ' + num(units) + ' homes; ' + num(credit) + ' of them are tax credit properties.') + '</span></figcaption>' +
        '<div class="pm-frame">' + svg + '</div>' +
        '<p class="money-key" aria-hidden="true">' + PROP_GROUPS.map(function (gp, i) { return counts[i] ? '<span class="pm-pair"><i style="background:' + gp[1] + '"></i><span>' + esc(gp[0]) + ' (' + num(counts[i]) + ')</span></span>' : ''; }).join('') +
          (qcts.length ? '<span class="pm-pair"><i class="pm-key-qct"></i><span>Qualified Census Tract (' + num(qcts.length) + ')</span></span>' : '') +
          (ddas.length ? '<span class="pm-pair"><i class="pm-key-dda"></i><span>Difficult Development Area (' + num(ddas.length) + ')</span></span>' : '') + '</p>' +
        '<p class="note pm-boost">' + (qcts.length || ddas.length ? 'Shaded tracts are Qualified Census Tracts and hatched areas are Difficult Development Areas on HUD’s ' + esc(hudYear) + ' lists, where a tax credit deal can take a 30% basis boost.'
          : 'No Qualified Census Tract or Difficult Development Area on HUD’s ' + esc(hudYear) + ' lists falls ' + (isCounty ? 'in this county.' : 'inside this view.')) + '</p>' +
        '<p class="note">Larger dots are larger properties. ' + (isCounty ? 'Every property on record in the county.' : 'The dashed ring is 30 miles from the centre of ' + esc(placeShort) + ', the live map’s reach for a town; it crosses county lines.') + ' A property on the preservation list is tracked there, not found at risk.</p>' +
        '<p class="metric-source">' + Pl.srcLine([['CHFA tax credit and preservation lists, HUD Multifamily Assisted, USDA Rural Housing, as merged ' + gen, Pl.LIVE + 'preservation.html'], ['HUD QCT and DDA lists, ' + hudYear, 'https://www.huduser.gov/portal/datasets/qct.html'], ['Census TIGER 2024 boundaries', 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html']]) + '</p>' +
        (global.LabVizData ? global.LabVizData.block('Affordable properties ' + where, ['Property', 'City', 'Program', 'Homes', 'Awarded'],
          dots.map(function (x) { return [x.property_name || '', x.city || '', label(x), +x.total_units || '', String(x.award_year || x.latest_year || '')]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; })) : '') + '</figure>',
        num(inScope.length) + ' affordable properties ' + where + ', ' + num(units) + ' homes.');
    }
    // The county's built form and history, as the live page describes it (county scope for a town).
    function contextPanel() {
      var cf = isCounty ? geoid : fips, cx = extraFile(EXTRA.context), c = cx && cx.counties && cx.counties[cf];
      if (!c) return '';
      var cap = function (s) { return String(s || '').replace(/_/g, ' ').replace(/^./, function (x) { return x.toUpperCase(); }); };
      return '<h2>Neighborhood and architectural context</h2>' + (isCounty ? '' : '<p class="note">For ' + esc(countyName) + ' as a whole; differences inside the county, such as downtown against the valley, are not shown. Use it as a regional baseline, then look at the site.</p>') +
        '<ul class="tag-list"><li>' + esc(cap(c.form)) + '</li><li>' + esc(cap(c.era)) + '</li><li>' + esc(cap(c.density)) + ' density</li><li>' + esc(cap(c.pressureLevel)) + ' housing pressure</li>' +
        (c.yearBuiltMedian ? '<li>Median home built about ' + esc(c.yearBuiltMedian) + '</li>' : '') +
        (c.housingMix ? '<li>' + esc(c.housingMix.singleFamily) + '% single-family, ' + esc(c.housingMix.multifamily) + '% multifamily, ' + esc(c.housingMix.mobile) + '% mobile</li>' : '') + '</ul>' +
        '<h3>Community character</h3><p>' + esc(c.character) + '</p><h3>Design context</h3><p>' + esc(c.designContext) + '</p><h3>Housing history</h3><p>' + esc(c.housingHistory) + '</p>' +
        '<p class="metric-source">COHO county profiles, written from public sources, ' + esc(String(cx.generated || '').slice(0, 10)) + '</p>';
    }

    t.housing = function () {
      return '<div class="metrics">' +
        Pl.card('Homes', num(pv('DP04_0001E')), num(pv('DP04_0002E')) + ' occupied, ' + num(pv('DP04_0003E')) + ' vacant', acs, acsUrl('DP04'), here) +
        mc('Vacancy available to rent or buy', 'active_market_vacancy_rate_pct', function (x) { return pct(x); }, 'Excludes seasonal and other off-market vacancy') +
        mc('Seasonal homes', 'seasonal_vacancy_rate_pct', function (x) { return pct(x); }, 'Share of all homes') +
        mc('Built before 1970', 'pct_housing_built_pre1970', function (x) { return pct(x); }) +
        mc('Single-family detached', 'pct_sf_detached', function (x) { return pct(x); }) +
        mc('Apartments (5+ units)', 'pct_multifamily', function (x) { return pct(x); }) +
        mc('Tax credit properties in town', 'lihtc_in_boundary', num, v('lihtc_in_boundary_year') ? 'Most recent ' + v('lihtc_in_boundary_year') : null) +
        mc('Overcrowded homes', 'overcrowding_rate_pct', function (x) { return pct(x); }, 'More than one person per room') +
        '</div>' + tenure() +
        '<h2>Housing stock by structure type</h2>' + buildingTypes() +
        '<h2>Bedroom mix</h2>' + bedroomMix() +
        yearBuilt() + homeValues() + permitPace() + secondHomes() + creditOverlays() + propertyMap() + contextPanel() +
        '<h2>Homes for sale within reach</h2><div class="metrics">' +
        mc('Owner homes affordable at 80% AMI', 'pct_owner_stock_affordable_80ami', function (x) { return pct(x); }) +
        mc('At 100% AMI', 'pct_owner_stock_affordable_100ami', function (x) { return pct(x); }) +
        mc('At 120% AMI', 'pct_owner_stock_affordable_120ami', function (x) { return pct(x); }) +
        '</div>';
    };

    // HUD's Fair Market Rents and income limits for the county, then CHFA's 2026 tax credit rent and income limits.
    function longDate(x) { var t = Date.parse(x); return isNaN(t) ? x : new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
    function limitsTables() {
      var cf = isCounty ? geoid : fips, out = '';
      var hud = shared && shared.hud ? shared.hud.counties.filter(function (c) { return c.fips === cf; })[0] : null;
      var whose = isCounty ? '' : ', which ' + esc(placeShort) + ' uses';
      if (hud) {
        var hm = shared.hud.meta || {}, il = hud.income_limits || {}, F = hud.fmr || {};
        out += fold('<h2>HUD Fair Market Rents and income limits</h2><p>The rents HUD sets for housing vouchers in ' + esc(hud.fmr_area_name || countyName) + whose + ', and the income limits that decide who qualifies for tax credit, HOME and other programs. Area median income for a family of four: <strong>' + money(il.ami_4person) + '</strong>.</p>' +
          '<div class="table-scroll"><table><caption>Fair Market Rents, FY' + esc(hm.fiscal_year) + ', per month</caption><thead><tr><th scope="col">Size</th><th scope="col">Fair Market Rent</th></tr></thead><tbody>' +
          [['Studio', F.efficiency], ['1 bedroom', F.one_br], ['2 bedrooms', F.two_br], ['3 bedrooms', F.three_br], ['4 bedrooms', F.four_br]].map(function (r) { return '<tr><th scope="row">' + r[0] + '</th><td>' + (money(r[1]) || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          '<div class="table-scroll"><table><caption>Income limits, FY' + esc(hm.income_limits_fiscal_year) + ', per year</caption><thead><tr><th scope="col">Income</th>' + [1, 2, 3, 4].map(function (n) { return '<th scope="col">' + n + ' ' + (n === 1 ? 'person' : 'people') + '</th>'; }).join('') + '</tr></thead><tbody>' +
          [30, 50, 60, 80].filter(function (t) { return il['il' + t + '_1person'] != null; }).map(function (t) { return '<tr><th scope="row">' + t + '% AMI</th>' + [1, 2, 3, 4].map(function (n) { return '<td>' + (money(il['il' + t + '_' + n + 'person']) || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
          '<p class="note">A Fair Market Rent is the most a voucher will pay toward rent and utilities for that size of home.</p>' +
          '<p class="metric-source">' + Pl.srcLine([['HUD Fair Market Rents, FY' + hm.fiscal_year, hm.url_fmr || LINKS.fmr], ['HUD income limits, FY' + hm.income_limits_fiscal_year, hm.url_il || LINKS.il]]) + '</p>',
          'Area median income for a family of four: ' + money(il.ami_4person) + '. Two-bedroom Fair Market Rent: ' + money(F.two_br) + ' a month.');
      }
      var lf = extraFile(EXTRA.chfaLimits), lc = lf && (lf.counties || []).filter(function (c) { return c.fips === cf; })[0];
      if (lc) {
        var lm = lf.meta || {}, tiers = Object.keys(lc.regular_tiers).map(Number).sort(function (x, y) { return x - y; }).map(function (k) { return lc.regular_tiers[k]; });
        var BR = [['0br', 'Studio'], ['1br', '1 BR'], ['2br', '2 BR'], ['3br', '3 BR'], ['4br', '4 BR']];
        var t60 = tiers.filter(function (t) { return +t.tier === 60; })[0];
        out += fold('<h2>CHFA 2026 rent and income limits</h2><p>The most a tax credit or CHFA-financed rental in ' + esc(lc.county_name) + ' County' + whose + ' can charge and the most its tenants can earn, at each income tier. In effect from ' + esc(longDate(lm.effective_date)) + '; projects must use them by ' + esc(longDate(lm.implementation_cutoff)) + '.</p>' +
          '<div class="table-scroll"><table><caption>Maximum monthly rent by bedroom size</caption><thead><tr><th scope="col">AMI</th>' + BR.map(function (b) { return '<th scope="col">' + b[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
          tiers.map(function (t) { return '<tr><th scope="row">' + t.tier + '%</th>' + BR.map(function (b) { return '<td>' + (money(t.max_rents[b[0]]) || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
          '<div class="table-scroll"><table><caption>Income limits by household size, per year</caption><thead><tr><th scope="col">AMI</th>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<th scope="col">' + n + '</th>'; }).join('') + '</tr></thead><tbody>' +
          tiers.map(function (t) { return '<tr><th scope="row">' + t.tier + '%</th>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<td>' + (money(t.income_limits[n + 'p']) || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
          '<p class="note">Rents are gross rents, before any utility allowance.' + (lc.hera_special ? ' This county also has HERA Special limits, which apply only to tax credit projects placed in service by December 31, 2008; they are in CHFA’s PDF and not shown here.' : '') + (lc.rural_resort ? ' As a rural resort county under Proposition 123, it also has tiers up to 160% AMI.' : '') + ' CHFA’s published table is the binding reference for an application.</p>' +
          '<p class="metric-source">' + Pl.srcLine('CHFA, 2026 Income Limit and Maximum Rent Tables for All Colorado Counties', lm.source_url) + '</p>',
          t60 ? 'At 60% AMI: a two-bedroom rents for at most ' + money(t60.max_rents['2br']) + ' a month, and a household of four earns at most ' + money(t60.income_limits['4p']) + ' a year.' : 'Rent and income caps at each income tier, by bedroom and household size.');
      }
      return out;
    }

    // Income needed to buy the typical home with the public site's ownership engine, against the median household income.
    // Yearly income to buy a home at this price: 30-year fixed at the dated rate, 10% down, with the payment,
    // property tax, insurance and mortgage insurance held to 30% of income (the live HNA's assumptions).
    function buyIncome(price) {
      var OF = global.OwnershipFinance;
      if (!OF || !OF.incomeRequiredForPrice || price == null) return null;
      var r = OF.incomeRequiredForPrice(price, { rateAnnual: OF.MORTGAGE_RATE.rateAnnual, termYears: 30, downPaymentRate: 0.10, propertyTaxRate: 0.0065, insuranceRate: 0.0035, pmiRate: 0.005, frontEndRatio: 0.30, pmiLtvGate: true });
      return r ? r.annualIncome : null;
    }
    // "Income needed to buy" is calculated, not measured: it is the ownership engine run on the typical home value.
    // Its badge says so, rather than borrowing the home value's own "measured directly" badge (Codex round 2, finding A).
    function buyScope() {
      var hs = scopeOf(d.median_home_value, 'median_home_value', sctx);
      var where = hs && hs.level === 'county-proxy' ? 'the county\u2019s typical home value' : 'the typical home value';
      return { level: 'estimate', metric: 'Income needed to buy', from: where + ' and a 30-year loan at the dated mortgage rate, with the public site\u2019s ownership engine' };
    }
    function buyReach() {
      var OF = global.OwnershipFinance, hm = m('median_home_value'), inc = v('median_hh_income');
      if (!Viz || !OF || !OF.incomeRequiredForPrice || !hm || inc == null) return '';
      var rate = OF.MORTGAGE_RATE, need = buyIncome(hm.value);
      if (need == null) return '';
      var gap = need - inc;
      return '<h2>Buying a home</h2>' + Viz.orderedBars({ title: 'Income to buy the typical home', scope: Pl.scope(buyScope()), noShare: true, fmt: money,
        answer: gap > 0 ? 'Buying the typical ' + money(hm.value) + ' home takes about ' + money(need) + ' a year, ' + money(gap) + ' more than the median household earns.' : 'The median household earns enough to buy the typical ' + money(hm.value) + ' home.',
        rows: [['Median household income', inc], ['Income needed to buy', need]],
        note: 'A 30-year fixed loan at ' + (rate.rateAnnual * 100).toFixed(2) + '% (' + rate.source + '), 10% down, with the payment, property tax, insurance and mortgage insurance held to 30% of income.',
        source: Pl.srcLine([[sourceOf(hm, ctx), sourceUrl(hm, ctx)], [sourceOf(m('median_hh_income'), ctx), sourceUrl(m('median_hh_income'), ctx)]]) });
    }

    // Renter households in each income tier by cost burden, as counts (HUD CHAS).
    // The CHAS record for this place or county, with its source label: the county file, or the place's
    // figures shared out from its tracts.
    function chasRec() {
      if (isCounty) return { src: shared && shared.chas ? (shared.chas.records || []).filter(function (c) { return c.fips === geoid; })[0] : null, label: 'HUD CHAS ' + (shared && shared.chas ? shared.chas.meta.vintage : '') };
      var pc = extraFile(EXTRA.placeChas);
      if (!pc) return null;
      var src = (pc.places || {})[geoid];
      return { src: src, label: 'HUD CHAS ' + ((pc.meta || {}).vintage || '2018–2022') + ', apportioned from ' + (src ? src.tract_count + ' tracts' : 'tracts') };
    }
    var T5 = [['lte30', '30% AMI or less'], ['31to50', '31–50% AMI'], ['51to80', '51–80% AMI'], ['81to100', '81–100% AMI'], ['100plus', 'Above 100% AMI']];
    function chasTiers() {
      var cr = chasRec();
      if (!cr) return '';
      var src = cr.src, label = cr.label;
      var a = src && src.renter_hh_by_ami;
      if (!Viz || !a) return '';
      var rows = T5.filter(function (t) { return a[t[0]]; }).map(function (t) { var x = a[t[0]], sev = x.cost_burdened_50pct || 0, cb = x.cost_burdened_30pct || 0; return [t[1], [sev, cb - sev, Math.max(0, (x.total || 0) - cb)], x]; });
      var lo = a.lte30, lo50 = (a.lte30 ? a.lte30.cost_burdened_30pct : 0) + (a['31to50'] ? a['31to50'].cost_burdened_30pct : 0);
      return Viz.stackedBars({ title: 'Renter households by income and cost burden', scope: Pl.scope(scopeOf(d.pct_burdened_lte30, 'pct_burdened_lte30', sctx) || here),
        parts: [['Pay over half their income', Viz.COLORS.households], ['Pay 30–50%', 'var(--households-light)'], ['Not burdened', 'var(--grey-line)']], rows: rows,
        end: function (r) { var x = r[2]; return num(x.cost_burdened_30pct) + ' of ' + num(x.total) + ' burdened'; },
        answer: lo ? Math.round(lo.pct_cost_burdened_30 * 100) + '% of renters at 30% AMI or less pay over 30% of income; ' + num(lo50) + ' renter households at or below 50% AMI do, the group tax credit rents at 60% AMI serve most directly.' : null,
        note: 'HUD publishes these four income tiers plus the group above 100% AMI; finer tiers are not in the source.' + (isCounty ? '' : ' This panel shares the town’s figures out from its census tracts by population, so they are estimates. HUD also publishes CHAS for places; the homes-short count above uses that.'),
        source: Pl.srcLine(label, LINKS.chas) });
    }

    // Owners with a mortgage by the share of income their housing costs take (ACS SMOCAPI).
    function ownerBurden() {
      var rows = [['Under 20%', 'DP04_0111PE'], ['20–25%', 'DP04_0112PE'], ['25–30%', 'DP04_0113PE'], ['30–35%', 'DP04_0114PE'], ['35% or more', 'DP04_0115PE']].map(function (b) { return [b[0], pv(b[1])]; });
      if (rows.every(function (r) { return r[1] == null; })) return '';
      var over = (pv('DP04_0114PE') || 0) + (pv('DP04_0115PE') || 0);
      return bars('Owners with a mortgage by share of income spent on housing', pct(over) + ' pay 30% or more. Owners without a mortgage are not in this chart.', rows, function (x) { return pct(x); }, 'homes', [acs + ', DP04', acsUrl('DP04')]);
    }

    // Rent, income and rent burden in 2009, 2014 and the latest survey, for the place itself.
    function fifteenYears() {
      if (isCounty) return '';
      var df = extraFile(EXTRA.decade), rec = df && (df.places || {})[geoid];
      var ok = function (c) { return c && Number(c.median_gross_rent) >= 200 && Number(c.median_hh_income) >= 5000; };
      if (!rec || !rec.acs_cohorts || rec.acs_cohorts.length < 2 || !rec.acs_cohorts.every(ok)) return '';
      var cs = rec.acs_cohorts.slice().sort(function (x, y) { return x.year - y.year; }), a = cs[0], z = cs[cs.length - 1];
      var ch = function (x, y) { var c = Math.round((y - x) / x * 100); return (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c) + '%'; };
      var vint = function (c) { return 'ACS ' + (c.year - 4) + '–' + c.year; };
      return '<h2>How affordable has housing become since ' + a.year + '?</h2><p>Rent and income in ' + esc(placeShort) + ' across three Census surveys: whether rents kept pace with incomes, or outran them.</p><div class="metrics">' +
        Pl.card('Median rent change', ch(a.median_gross_rent, z.median_gross_rent), money(a.median_gross_rent) + ' → ' + money(z.median_gross_rent) + ' a month (' + a.year + '–' + z.year + ')', vint(a) + ' to ' + vint(z) + ', DP04', acsUrl('DP04'), here) +
        Pl.card('Median income change', ch(a.median_hh_income, z.median_hh_income), money(a.median_hh_income) + ' → ' + money(z.median_hh_income), vint(a) + ' to ' + vint(z) + ', DP03', acsUrl('DP03'), here) +
        (a.rent_burden_30_plus != null && z.rent_burden_30_plus != null ? Pl.card('Renters paying 30% or more', Math.round(a.rent_burden_30_plus * 100) + '% → ' + Math.round(z.rent_burden_30_plus * 100) + '%', 'Change ' + ch(a.rent_burden_30_plus, z.rent_burden_30_plus), vint(a) + ' to ' + vint(z) + ', DP04', acsUrl('DP04'), here) : '') + '</div>' +
        (!Viz ? '' : Viz.timeLines({
          title: 'Rent against income, ' + a.year + ' to ' + z.year, scope: Pl.scope(here), zero: true, fmt: function (x) { return Math.round(x) + '%'; },
          answer: 'A year of median rent took ' + (a.median_gross_rent * 12 / a.median_hh_income * 100).toFixed(1) + '% of the median household income in ' + a.year + ' and ' + (z.median_gross_rent * 12 / z.median_hh_income * 100).toFixed(1) + '% in ' + z.year + '.',
          series: [{ label: 'Rent as a share of median income', color: Viz.COLORS.households, points: cs.map(function (c) { return [c.year, c.median_gross_rent * 12 / c.median_hh_income * 100]; }) }]
            .concat(cs.every(function (c) { return c.rent_burden_30_plus != null; }) ? [{ label: 'Renters paying 30% or more', color: Viz.COLORS.blue, dash: true, points: cs.map(function (c) { return [c.year, c.rent_burden_30_plus * 100]; }) }] : []),
          note: 'Each point is a five-year survey, dated by its last year.',
          source: Pl.srcLine('Census ACS 5-year profiles, DP03 and DP04, ' + cs.map(function (c) { return c.year; }).join(', '), LINKS.acs)
        })) +
        '<div class="table-scroll"><table><caption>Rent against income by survey</caption><thead><tr><th scope="col">Survey</th><th scope="col">Median rent</th><th scope="col">Median household income</th><th scope="col">Rent as share of income</th><th scope="col">Renters paying 30% or more</th></tr></thead><tbody>' +
        cs.map(function (c) { return '<tr><th scope="row">' + vint(c) + '</th><td>' + money(c.median_gross_rent) + '/mo</td><td>' + money(c.median_hh_income) + '</td><td>' + (c.median_gross_rent * 12 / c.median_hh_income * 100).toFixed(1) + '%</td><td>' + (c.rent_burden_30_plus == null ? '' : (c.rent_burden_30_plus * 100).toFixed(1) + '%') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="note">Rent as a share of income is a year of median rent over the median income of all households, owners and renters together. It tracks rent against incomes over time; it is not the share a typical renter pays, which the burden figures above measure. The survey home values behind this table are separate from the Zillow index quoted elsewhere on this page.</p>' +
        '<p class="metric-source">' + Pl.srcLine('Census ACS 5-year profiles, DP03 and DP04, ' + cs.map(function (c) { return c.year; }).join(', '), LINKS.acs) + '</p>';
    }

    // The live chapter's rent burden bins (DP04 GRAPI) as one chart: the two bins at 30% or more in rust.
    function rentBurdenChart() {
      var rows = RENT_BURDEN.map(function (b) { return [b[0], pv(b[1])]; });
      if (rows.every(function (r) { return r[1] == null; })) return '<h2>Rent burden distribution</h2><p class="note">Rent as a share of income is not published for this place.</p>';
      if (!Viz) return '<h2>Rent burden distribution</h2>' + bars('Renters by share of income spent on rent', 'Percent of renter households. Rent here includes utilities the renter pays.', rows, function (x) { return pct(x); }, null, [acs + ', DP04', acsUrl('DP04')]);
      var over = (rows[4][1] || 0) + (rows[5][1] || 0);
      return '<h2>Rent burden distribution</h2>' + Viz.orderedBars({
        title: 'Renters by share of income spent on rent', scope: Pl.scope(here), noShare: true, fmt: function (x) { return pct(x); },
        answer: pct(Math.round(over * 10) / 10) + ' of renter households pay 30% or more of income on rent' + (rows[5][1] != null ? '; ' + pct(rows[5][1]) + ' pay 35% or more.' : '.'),
        keys: [['Under 30% of income', Viz.COLORS.homes], ['30% or more: cost-burdened', Viz.COLORS.households]],
        colorOf: function (r, i) { return i >= 4 ? Viz.COLORS.households : Viz.COLORS.homes; },
        rows: rows, note: 'Percent of renter households that pay rent. Rent here includes utilities the renter pays.',
        source: Pl.srcLine(acs + ', DP04', acsUrl('DP04'))
      });
    }

    // Today's rental gap in plain sentences, from the same figures the cards show.
    function rentalGap() {
      var cb = m('pct_cost_burdened'), rent = v('gross_rent_median'), inc = v('median_hh_income'), r35 = pv('DP04_0142PE'), out = [];
      // The share's denominator is renters whose rent-to-income ratio Census measured
      // (B25070_001E minus B25070_011E), not all renters. Multiplying it by all renters
      // printed "about 463 households" for Fruita, where the count is 366 of 840.
      // The count is read from B25070 itself; without it the share stands alone.
      var b = ['B25070_001E', 'B25070_007E', 'B25070_008E', 'B25070_009E', 'B25070_010E', 'B25070_011E'].map(pv);
      var measured = b.every(function (x) { return x != null && x >= 0; }) ? b[0] - b[5] : null;
      var burdened = measured > 0 ? b[1] + b[2] + b[3] + b[4] : null;
      if (cb && burdened != null && Math.abs(burdened / measured * 100 - cb.value) > 0.6) burdened = null;
      if (cb) out.push('<strong>' + pct(cb.value) + '</strong> of renter households pay 30% or more of income on rent' +
        (burdened != null ? ': <strong>' + num(burdened) + '</strong> of the ' + num(measured) + ' renter households whose rent was measured' : '') +
        (r35 != null ? '; ' + pct(r35) + ' pay 35% or more.' : '.'));
      if (rent != null && inc != null) { var need = rent * 12 / 0.3; out.push('The median rent of <strong>' + money(rent) + '</strong> a month takes <strong>' + money(need) + '</strong> a year at 30% of income, ' + (need > inc ? money(need - inc) + ' more than the median household, owners and renters together, earns (' + money(inc) + ').' : 'which the median household (' + money(inc) + ') earns. That median covers owners and renters together, so it does not show what renters can pay; the burden figures above do.')); }
      var rr = v('pct_renters');
      if (rr != null) out.push('Renters are <strong>' + pct(rr) + '</strong> of households here.');
      if (!out.length) return '';
      return '<h2>Today’s rental gap</h2><ul class="plain-list">' + out.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
        '<p class="metric-source">' + Pl.srcLine(acs + ', DP03 and DP04', acsUrl('DP04')) + '</p>';
    }

    // HUD's affordable-and-available count, the headline the public HNA quotes since HA #2769. A different
    // question from the Census cards under it, so the two are never merged: this one removes homes rented
    // by higher-income households; the Census cards count every home priced for the band.
    function hudRecord() {
      var aa = shared && shared.aa; if (!aa) return null;
      var rec = isCounty ? (aa.counties || {})[geoid] : (aa.places || {})[geoid];
      return rec && rec.tiers ? { tiers: rec.tiers, vintage: (aa.meta && aa.meta.vintage) || '' } : null;
    }
    function hudShort() {
      var h = hudRecord(), ok = function (x) { return typeof x === 'number' && isFinite(x) && x >= 0; };
      if (!h || !['30', '50', '80'].some(function (k) { return h.tiers[k] && ok(h.tiers[k].homes_short); })) return '';
      var at = { level: 'calculated', where: isCounty ? 'this county' : 'this place', from: 'HUD CHAS counts of renter households and of homes affordable and available to them' };
      return '<h2>Homes short: HUD’s count</h2><div class="metrics">' + ['30', '50', '80'].map(function (k) {
        var x = h.tiers[k] || {};
        return Pl.card('Homes short for renters at or below ' + k + '% of area median income', ok(x.homes_short) ? num(x.homes_short) : null,
          ok(x.renter_households) && ok(x.affordable_available_homes) ? num(x.affordable_available_homes) + ' homes affordable and available for ' + num(x.renter_households) + ' renter households' : 'HUD does not publish this tier here.',
          'HUD CHAS ' + h.vintage, HUD_CHAS_URL, at);
      }).join('') + '</div><p class="note">Counts renters living here today. A home counts only when it is affordable to the group and is vacant or rented by a household in that group. ' +
        'COHO works the shortfall out from HUD’s rounded estimates; it is the figure to quote. The Census cards below answer a different question: they count every rental priced for the band, whoever rents it, so they read lower.</p>';
    }
    t.afford = function () {
      return hudShort() + (place ? '<div class="metrics">' + Pl.gapCard(place.bands[0]) + Pl.gapCard(place.bands[2]) + Pl.gapCard(place.bands[3]) + '</div>' + Pl.gapChart(place) : '') +
        rentalGap() + rentBurdenChart() +
        '<h2>Who is paying too much</h2><p class="note">These come from two surveys with different years, the Census ACS and HUD’s CHAS. Each card names its own.</p><div class="metrics">' +
        mc('Renters paying over 30% of income', 'pct_cost_burdened', function (x) { return pct(x); }) +
        mc('Renters paying over 50% of income', 'pct_renter_severe_burdened', function (x) { return pct(x); }) +
        mc('Owners paying over 30% of income', 'pct_owner_burdened_30plus', function (x) { return pct(x); }) +
        mc('Rent as a share of median income', 'rent_to_income', function (x) { return pct(x); }) +
        '</div>' + chasTiers() +
        bars('Renters paying over 30% of income, by income tier', 'Share of renter households in each tier', BURDEN_TIERS.map(function (b) { return [b[0], v(b[1])]; }), function (x) { return pct(x); }, null, m('pct_burdened_lte30') ? [sourceOf(m('pct_burdened_lte30'), ctx), sourceUrl(m('pct_burdened_lte30'), ctx)] : null, scopeOf(d.pct_burdened_lte30, 'pct_burdened_lte30', sctx)) +
        '<h2>Owner housing cost burden</h2>' + ownerBurden() +
        '<h2>Wages and prices</h2>' + threeRents() + '<div class="metrics">' +
        mc('Home value to income', 'home_value_to_income', function (x) { return Number(x).toFixed(1) + '×'; }) +
        mc('Yearly income short of renting the median home', 'wage_affordability_rent_gap_dollars', money, 'Income needed at 30% of pay, minus the county median wage') +
        mc('Yearly income short of buying the median home', 'wage_affordability_ownership_gap_dollars', money, 'Same test for the typical home value') +
        mc('County median wage (estimate)', 'county_median_annual_wage_estimate', money, countyName) +
        '</div>' + buyReach() + fifteenYears() + limitsTables();
    };

    t.future = function () {
      return '<div class="metrics">' +
        Pl.card('Population today', num(pv('DP05_0001E')), null, acs, acsUrl('DP05'), here) +
        mc('Population in 20 years', 'population_projection_20yr', num) +
        mc('Homes needed over 20 years', 'future_units_needed_20yr', needNum, smallRec() ? 'Fewer than 250 households: see the county' : needWhy(num(v('future_units_growth_20yr')) + ' for resident growth, ' + num(v('incommuter_need_units')) + ' for in-commuters')) +
        mc('Change in the 65+ share', 'senior_share_growth_pp', function (x) { return signed(x, function (y) { return y.toFixed(1); }) + ' points'; }) +
        '</div>' + outlook() +
        '<h2>Population projection by scenario</h2>' + projectionRange() + homesByYear() + demandByIncome() + scenarioTable() +
        '<h2>Labor market context</h2>' + payBands() + industries() + employers() + wagesVsHousing() + housingWage() +
        '<h2>Commuting</h2>' + modeShare() + commuting('Commuting inflow and outflow') +
        '<h2>Economic indicators</h2>' + jobTrend() + payTrend() + marketCall() +
        downtown();
    };

    t.action = function () {
      return needSummary() + projectedNeed() + amiMix() + bedroomNeed() + housingTypes() + ownershipNeed() + densityTypes() + scorecard() + countyDeals() + specialNeeds() + transitZone() + sb174() + prop123() + pmaLink() +
        fold('<h2>The HNA\u2019s reading and the tax credit record</h2><div class="metrics">' +
        word('What the HNA suggests', 'ownership_need_recommendation', v('ownership_need_affordability_classification') ? 'Classed as ' + v('ownership_need_affordability_classification') : null) +
        word('Rental pressure', 'ownership_need_rental_pressure_tier') +
        word('Ownership pressure', 'ownership_need_ownership_pressure_tier') +
        mc('Latest tax credit award in town', 'latest_lihtc_year', String) +
        mc('Years since that award', 'drought_years', num) +
        mc('9% awards in town', 'lihtc_9pct_count', num) +
        mc('Latest award within ' + (v('regional_pma_miles') || 25) + ' miles', 'regional_latest_lihtc_year', String) +
        '</div>', [v('ownership_need_recommendation'), v('latest_lihtc_year') ? 'last tax credit award in town ' + v('latest_lihtc_year') : 'no tax credit award in town on file'].filter(Boolean).join('; ') + '.') + actionPlan() +
        '<div class="callout">These are the HNA\u2019s own readings, not a recommendation for a site. To test a site, start a project from this place.</div>';
    };

    // SB24-174 chapter (site/hna-dola.js): DOLA's tables 1-4 from the HNA's own projection, CHAS and vacancy files.
    var dolaInputs = function () {
      var cf = isCounty ? geoid : fips;
      var cpj = cf ? extraFile(EXTRA.projection(cf)) : null, ts = cpj && cpj.housing_need ? cpj.housing_need.tenure_split : null;
      var pp = isCounty ? null : extraFile(EXTRA.projection('places')), pr = pp && pp.places ? pp.places[geoid] : null;
      var cgRaw = extraFile(isCounty ? EXTRA.chasGap : EXTRA.placeChas), vfRaw = extraFile(EXTRA.vacancy), lawsRaw = extraFile(EXTRA.laws);
      var cg = cgRaw || {}, chas = (isCounty ? cg.counties : cg.places) || {};
      var vf = vfRaw || {}, vac = (vf.geographies || {})[geoid];
      chas = chas[geoid];
      return { geoid: geoid, name: entry.label, isCounty: isCounty, countyFips: cf, countyName: countyName, profile: p, vac: vac, chas: chas,
        series: isCounty ? (ts && ts.incremental_units_needed_tenure_adjusted) : (pr && pr.incremental_tenure_adjusted),
        ownerShare: ts ? ts.owner_share : null, tooSmall: !!(pr && pr.too_small), laws: lawsRaw || {},
        loading: !cgRaw || !vfRaw || !lawsRaw || !cpj || (!isCounty && !pp),
        baseYear: isCounty ? (cpj && cpj.baseYear) : (pr && pr.years ? pr.years[0] : null), acsLabel: acs };
    };
    t.dola = function () {
      return global.LabHnaDola ? global.LabHnaDola.chapter(dolaInputs()) : '<p class="callout">The SB24-174 check did not load.</p>';
    };

    var name = entry.label;
    var finding = {
      overview: function () {
        // Lead with where the gap is widest and what kind of homes meet it. The need rank stays in the scorecard.
        var bs = place && place.bands ? place.bands.filter(function (x) { return x.shortfall != null; }) : [];
        if (!bs.length) return null;
        var short = bs.filter(function (x) { return x.shortfall > 0; });
        if (!short.length) return name + ' has as many homes priced for renters as renters at every income up to ' + bs[bs.length - 1].band + '% AMI.';
        var wide = short.reduce(function (a, x) { return x.shortfall > a.shortfall ? x : a; }), top = short[short.length - 1], b30 = bs[0];
        var reach = top === bs[bs.length - 1] ? 'at every income up to ' + top.band + '% AMI' : 'up to ' + top.band + '% AMI';
        var fit = +wide.band <= 30 ? ' Closing it takes homes at 30% AMI rents, which need deep subsidy such as project-based vouchers on top of tax credits.'
          : +wide.band <= 60 ? ' Tax credit rentals set at or below ' + wide.band + '% AMI meet it.'
          : ' That is above the usual 60% AMI tax credit limit, where workforce rentals and ownership fit.';
        return name + ' is short of homes renters can afford ' + reach + '. The gap is widest at or below ' + wide.band + '% AMI: ' + num(wide.households) + ' renter households and ' + num(wide.homes) +
          ' homes at ' + money(wide.rent) + ' a month or less, ' + num(wide.shortfall) + ' short.' + fit +
          (b30 !== wide && b30.shortfall > 0 ? ' At 30% AMI, ' + num(b30.households) + ' households have ' + num(b30.homes) + ' homes priced for them.' : '');
      },
      people: function () {
        var inc = v('median_hh_income'), cr = v('commute_ratio');
        if (inc == null) return null;
        return 'The median household earns ' + money(inc) + ' a year.' + (cr != null ? ' In-commuters hold ' + pct(cr, 0) + ' of the jobs here.' : '');
      },
      housing: function () {
        var sf = v('pct_sf_detached'), vac = v('active_market_vacancy_rate_pct');
        if (sf == null) return null;
        return pct(sf) + ' of homes are single-family detached.' + (vac != null ? ' ' + pct(vac) + ' are vacant and for rent or sale.' : '');
      },
      afford: function () {
        var b = place && place.bands[0], cb = v('pct_cost_burdened');
        var first = b && b.shortfall != null ? (b.shortfall > 0 ? 'There are ' + num(b.households) + ' renter households at or below 30% AMI and ' + num(b.homes) + ' homes priced for them: ' + num(b.shortfall) + ' more renters than homes.' : b.net < 0 ? 'Homes priced at or below 30% AMI outnumber the renters at that income.' : 'Homes priced at or below 30% AMI match the renters at that income.') : '';
        return (first + (cb != null ? ' ' + pct(cb) + ' of renters pay more than 30% of income for housing.' : '')).trim() || null;
      },
      future: function () {
        var pop = v('population_projection_20yr'), need = v('future_units_needed_20yr');
        if (pop == null || need == null) return null;
        if (isCounty || (d.population_projection_20yr || {}).geography_level !== 'county_context') return 'The State Demography Office expects ' + num(pop) + ' residents in 20 years. That takes ' + num(need) + ' more homes.';
        return 'Applying the State Demography Office forecast for ' + (countyName || 'the county') + ' to ' + name + ' gives about ' + num(pop) + ' residents in 20 years and ' + num(need) + ' more homes. The office does not forecast towns.';
      },
      action: function () {
        var rec = v('ownership_need_recommendation'), yr = v('latest_lihtc_year');
        if (!rec) return null;
        return 'The HNA\u2019s reading for this market: ' + rec + '.' + (yr ? ' The last tax credit award in town was in ' + yr + '.' : '');
      },
      // The chapter carries its own finding under the need picture.
      dola: function () { return null; }
    }[tab]();
    // Gemini round 10, pick A (paul 11-05): a strip under 200 px right after the chapter's question, so a phone's
    // first screen carries a graphic. Overview: the affordability ladder. What to do: the 20-year need, by part.
    var strip = tab === 'overview' && place && Pl.ladder ? Pl.ladder(place) : tab === 'action' ? needStrip() : '';
    // The page lifts the strip to just under its head (see the place view below), so it shows on the first screen.
    var intro = (strip ? '<!--first-strip-->' + strip + '<!--/first-strip-->' : '') + '<div class="chapter-intro"><p class="chapter-ask">' + esc(ASKS[tab]) + '</p>' +
      (finding ? '<p class="chapter-finding">' + esc(finding) + '</p>' : '') + '</div>';
    var body = t[tab]();
    // Rent against income for the county (a town uses its county's: the ACS series is county-level here).
    var rentCard = tab === 'afford' && global.LabRentIncome ? global.LabRentIncome.card(isCounty ? geoid : place && place.rec && place.rec.containing_county_fips, isCounty ? null : name) : '';
    return intro + (tab === 'afford' ? amiLine() : '') + rentCard + body + recap(tab) + (tab === 'overview' ? sourcesMethod() : '');

    // What area median income means here (Gemini round 5, question 18; big visual pass 11-06): HUD's income limits for
    // a family of four as ticks on one line, and the typical household's income as a dot on the same line.
    function amiLine() {
      var hud = shared && shared.hud ? shared.hud.counties.filter(function (r) { return r.fips === (isCounty ? geoid : fips); })[0] : null;
      var il = hud && hud.income_limits, inc = v('median_hh_income');
      if (!il || !il.ami_4person) return '';
      var T = [['30%', il.il30_4person], ['50%', il.il50_4person], ['60%', il.il60_4person], ['80%', il.il80_4person], ['100%', il.ami_4person]].filter(function (t) { return t[1]; });
      var top = Math.max(il.ami_4person * 1.2, inc ? inc * 1.08 : 0), x = function (n) { return (n / top * 100).toFixed(2) + '%'; };
      var share = inc ? Math.round(inc / il.ami_4person * 100) : null;
      var finding = 'Area median income here is ' + money(il.ami_4person) + ' for a family of four' + (share != null ? '; the typical household earns ' + money(inc) + ', about ' + share + '% of it' : '');
      var yr = shared.hud.meta && shared.hud.meta.income_limits_fiscal_year;
      return '<figure class="ami-line" aria-label="' + esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(finding, 'HUD income limits, Census ACS')) + '">' +
        '<figcaption><strong>' + esc(finding) + '</strong></figcaption>' +
        '<div class="al-track" aria-hidden="true">' + T.map(function (t) { return '<span class="al-tick' + (t[0] === '100%' ? ' is-ami' : '') + '" style="left:' + x(t[1]) + '"><b>' + t[0] + '</b></span>'; }).join('') +
        (inc ? '<span class="al-dot" style="left:' + x(inc) + '"><span>Typical household</span></span>' : '') + '</div>' +
        '<ul class="al-key">' + T.map(function (t) { return '<li><b>' + t[0] + ' AMI</b> ' + money(t[1]) + '</li>'; }).join('') + '</ul>' +
        '<p class="metric-source">HUD sets the limits for the whole county, by household size; these are for four people. The typical household is the median of all sizes, so the comparison is rough. ' +
        Pl.srcLine([['HUD income limits' + (yr ? ', FY' + yr : ''), LINKS.il], [sourceOf(m('median_hh_income'), ctx), sourceUrl(m('median_hh_income'), ctx)]]) + '</p></figure>';
    }

    // The live chapters close on three figures to carry forward; each is the one the chapter itself shows.
    function recap(tab) {
      var hm = m('median_home_value'), need = hm ? buyIncome(hm.value) : null, D = [acs + ', DP02', acsUrl('DP02')];
      var items = {
        people: [[num(pv('DP02_0001E')), 'households', D], [num(pv('DP02_0015E')), 'households with someone 65 or older', D],
          [pct(v('pct_cost_burdened')), 'of renters spend 30% or more of their income on rent', [sourceOf(m('pct_cost_burdened'), ctx), sourceUrl(m('pct_cost_burdened'), ctx)]]],
        housing: [kept.lihtc, kept.qct, hm ? [money(hm.value), 'typical home value', [sourceOf(hm, ctx), sourceUrl(hm, ctx)]] : null],
        afford: (function () {
          // HUD's count where HUD has one; otherwise the Census difference under its own name, never as "homes short".
          var h = hudRecord(), hs = function (k) { var x = h && h.tiers[k]; return x && typeof x.homes_short === 'number' ? x.homes_short : null; };
          var S = h ? ['HUD CHAS ' + h.vintage, HUD_CHAS_URL] : null;
          if (h && hs('30') != null) return [[num(hs('30')), 'homes short for renter households at or below 30% of area median income (HUD’s count)', S],
            hs('50') != null ? [num(hs('50')), 'homes short at or below 50% (HUD’s count)', S] : null];
          return [[num(v('ami_gap_30pct')), 'more renter households at or below 30% of area median income than rentals priced for them (Census estimate)', [sourceOf(m('ami_gap_30pct'), ctx), sourceUrl(m('ami_gap_30pct'), ctx)]],
            [num(v('ami_gap_60pct')), 'the same at or below 60%, the band most tax credit rentals serve (Census estimate)', [sourceOf(m('ami_gap_60pct'), ctx), sourceUrl(m('ami_gap_60pct'), ctx)]]];
        })().concat([
          need == null ? null : [money(need), 'income needed to buy the typical home', [sourceOf(hm, ctx), sourceUrl(hm, ctx)]]]),
        future: [kept.jobs, kept.jobsGrowth, kept.outflow],
        action: [[needNum(v('future_units_needed_20yr')), v('future_units_needed_20yr') < 0 ? 'net change in homes needed over 20 years (a forecast decline, not homes to remove)' : 'homes needed over 20 years', [sourceOf(m('future_units_needed_20yr'), ctx), sourceUrl(m('future_units_needed_20yr'), ctx)]], kept.base, kept.permits]
      }[tab] || [];
      var rows = items.filter(function (x) { return x && x[0] != null && /\d/.test(String(x[0])); });
      if (!rows.length) return '';
      return '<section class="recap" aria-labelledby="recap-h"><h2 id="recap-h">What you have now</h2><ul class="recap-list">' + rows.map(function (x) {
        return '<li><strong class="recap-n">' + esc(x[0]) + '</strong> <span>' + esc(x[1]) + '</span>' + (x[2] && x[2][0] ? ' <small class="metric-source">' + Pl.srcLine(x[2][0], x[2][1]) + '</small>' : '') + '</li>';
      }).join('') + '</ul></section>';
    }

    // The live HNA's sources panel and method notes, for the whole assessment.
    function sourcesMethod() {
      var SRCS = [['ACS 5-year and 1-year estimates', 'Census Bureau', 'https://www.census.gov/programs-surveys/acs'], ['HUD CHAS', 'cost burden by income level', LINKS.chas],
        ['LEHD LODES', 'commuting flows and jobs', LINKS.lodes], ['State Demography Office', 'population forecasts', LINKS.dola],
        ['HUD LIHTC', 'tax credit database', 'https://lihtc.huduser.gov/'], ['HUD QCT and DDA', 'Qualified Census Tracts and Difficult Development Areas', LINKS.qct],
        ['HUD Fair Market Rents', 'rents by county', LINKS.fmr], ['CHFA', 'Colorado Housing and Finance Authority', 'https://www.chfainfo.com/'],
        ['Prop 123', 'DOLA commitment filings', 'https://cdola.colorado.gov/commitment-filings'], ['TIGERweb', 'Census geographic boundaries', 'https://www.census.gov/data/developers/data-sets/TIGERweb-map-service.html']];
      return '<section class="sources-method" aria-labelledby="sm-h"><h2 id="sm-h">Methodology and data sources</h2>' +
        '<p>Every figure names its agency, dataset and year, and links to the publisher. A label on each says whether it is measured for this place, shared out from census tracts, modeled, or the county’s own figure.</p>' +
        '<ul class="method-notes">' +
        '<li><strong>Margins of error.</strong> Census figures are survey estimates. Colorado, its counties and places of 65,000 people or more use the ACS 1-year figure; smaller places use the 5-year figure, which covers five years at once. <a href="' + esc(Pl.LIVE) + 'methods.html#m-sampling-error" rel="noopener">How reliability is judged</a>.</li>' +
        '<li><strong>Forecasts.</strong> County figures come from the State Demography Office’s cohort-component forecast. A town’s forecast is its share of the county’s, blended from its share of households (ACS) and of building permits (Census Building Permits Survey). The vacancy target is a planning minimum for a healthy market.</li>' +
        '<li><strong>Tax credit overlays.</strong> Properties come from CHFA’s current monitoring list. The backup file the site keeps holds the same CHFA records, not a separate HUD count. QCT and DDA status come from HUD’s yearly lists.</li>' +
        '<li><strong>This geography.</strong> ' + esc(entry.label) + (isCounty ? ', a county.' : ', a place in ' + esc(countyName || 'its county') + '. HUD publishes income limits for counties only, so the town uses the county’s.') + '</li>' +
        '</ul><h3>Primary data sources</h3><ul class="source-grid">' + SRCS.map(function (x) { return '<li><strong>' + esc(x[0]) + '</strong> <a href="' + esc(x[2]) + '" rel="noopener">' + esc(x[1]) + '</a></li>'; }).join('') + '</ul>' +
        '<p class="note"><a href="' + esc(Pl.LIVE) + 'dashboard-data-sources-ui.html" rel="noopener">Full data sources inventory</a> · <a href="' + esc(Pl.LIVE) + 'data-status.html" rel="noopener">Data freshness</a> on cohoanalytics.com</p></section>';
    }
  }

  function placeView(params, parts) {
    var catalog = Shell.catalog();
    var geoid = parts[1];
    var tab = TABS.some(function (x) { return x.id === parts[2]; }) ? parts[2] : 'overview';
    var entry = Pl.entryFor(geoid);
    var back = '<a class="back-link" href="#/places">← Places and need</a>';
    if (!entry && String(geoid).length === 5 && !Pl.data().data && !Pl.data().error) return back + '<h1>Loading…</h1><p role="status" class="note">Loading the Housing Needs Assessment…</p>';
    if (!entry) return back + '<h1>Place not found</h1><p class="lede">No Colorado place profile has the ID ' + esc(geoid) + '.</p>';
    setWorking(geoid, entry.label); // every chapter of a place's assessment makes it the working place
    var shared = Pl.data();
    var c = loadPlace(geoid);
    var title = '<h1>' + esc(entry.label) + '</h1>';
    if (shared.error || c.error) return back + title + '<div class="callout" role="alert"><p>' + esc(shared.error || c.error) + '</p>' +
      (c.error ? '<p><button type="button" class="button-link secondary" data-hna-retry="' + esc(geoid) + '">Try again</button></p>' : '<p>Reload the page to try again.</p>') + '</div>';
    if (!shared.data || !c.digest) return back + title + '<p role="status" class="note">Loading the Housing Needs Assessment…</p>';
    // Every chart on this page describes this place; its CSV says so (viz-data.js).
    global.LAB_VIZ_CONTEXT = { geography: entry.label, geoid: geoid };
    var place = Pl.placeFacts(geoid, shared.data);
    var county = place && place.county.county ? place.county.county.county_name : '';
    var current = TABS.filter(function (x) { return x.id === tab; })[0];
    var nav = '<nav class="tabs" aria-label="Housing Needs Assessment chapters"><ul>' + TABS.map(function (x) {
      return '<li><a href="#/place/' + esc(geoid) + (x.id === 'overview' ? '' : '/' + x.id) + '"' + (x.id === tab ? ' aria-current="page"' : '') + '>' + esc(x.tab || x.title) + '</a></li>';
    }).join('') + '</ul></nav>';
    // The county's own page is in the lab too.
    var fips = place && place.rec.containing_county_fips;
    var strength = global.LabStrength ? global.LabStrength.line({
      geoid: geoid, name: entry.label, tracts: String(geoid).length === 5 ? null : tractCount(geoid),
      county: fips && fips !== geoid ? { name: county || 'the county', href: '#/place/' + fips } : null
    }) : '';
    var lifted = (function (html) {
      var m = /<!--first-strip-->([\s\S]*?)<!--\/first-strip-->/.exec(html);
      return m ? { strip: '<div class="first-strip">' + m[1] + '</div>', body: html.replace(m[0], '') } : { strip: '', body: html };
    })(view(c, geoid, tab, entry, place));
    return global.LabTpl.head({
      kind: 'place', crumbs: global.LabTpl.trail('places', entry.label, [{ label: 'Find a place', href: '#/places' }]), title: entry.label,
      visual: locator(geoid, entry.label, fips, county, shared.data.counties),
      answer: 'Housing Needs Assessment' + (county && county !== entry.label ? ' \u00b7 ' + esc(county) : ''),
      aside: '<div class="place-tools">' + strength + geoKey(String(geoid).length === 5, county) +
        '<div class="actions"><a class="button-link" href="' + esc(Pl.useHref(entry)) + '">Use in project</a></div></div>'
    }) +
      lifted.strip + stepPath(false, null, geoid) + nav + '<h2 class="tab-title">' + esc(current.title) + '</h2>' + focusTables(lifted.body) + downloads(geoid, entry) + (tab === 'overview' ? shareCard(entry, place, county, locator(geoid, entry.label, fips, county, shared.data.counties)) : '') + nextStep(geoid, tab, entry) +
      (global.LabStrength ? global.LabStrength.footnote() : '') +
      '<p class="note">Census figures are survey estimates with margins of error, which are wide for small places. Each figure names its agency, dataset and year. ' +
      '<a href="' + esc(current.live ? Pl.LIVE + current.live + '?geoid=' + geoid : entry.href) + '">This chapter in full on cohoanalytics.com</a>.</p>';
  }

  // Share card for one place (Gemini round 7, q25; big visual pass 11-06): the 1200 x 630 picture a shared link
  // would carry, filled from the figures this page already shows: homes per 100 and homes short at or below
  // 30% AMI (the ladder) and HUD's area median income, with the locator map. Nothing new is computed.
  function shareCard(entry, place, county, loc) {
    var b = place && (place.bands || []).filter(function (x) { return String(x.band) === '30' && x.households > 0 && x.homes != null; })[0];
    var ami = place && place.rec && place.rec.ami_4person;
    if (!b) return '';
    var per = Math.round(b.homes / b.households * 100), short = b.households - b.homes;
    var name = entry.label.replace(/ \((city|town)\)$/, '');
    var F = [[String(per), 'homes for every 100 renter households at or below 30% AMI', 'Census ACS 2020\u20132024'],
      [short > 0 ? num(short) : '0', short > 0 ? 'more of those renter households than rentals priced for them' : 'as many rentals priced for those renters as households', 'Census ACS 2020\u20132024']];
    if (ami) F.push([money(ami), 'income the rent bands are set from, family of four (twice HUD\u2019s 50% limit)', 'HUD FY2026 income limits']);
    var alt = (global.LabTpl && global.LabTpl.alt || function (f) { return f; })(name + ': ' + per + ' homes per 100 renter households at or below 30% AMI', 'Census ACS');
    return '<section class="share-place" aria-labelledby="sp-h"><h2 id="sp-h">Share card</h2><p class="note">The picture a shared link to this page would carry, drawn at 1200 \u00d7 630.</p>' +
      '<figure class="pc-card" data-no-source="each figure names its source on the card" role="img" aria-label="' + esc(alt) + '"><div class="pc-text"><p class="pc-brand">COHO Analytics</p>' +
      '<p class="pc-name">' + esc(name) + '</p><p class="pc-where">' + esc(county && county !== entry.label ? county + ', Colorado' : 'Colorado') + '</p>' +
      '<ul class="pc-figs">' + F.map(function (f) { return '<li><b>' + esc(f[0]) + '</b><span>' + esc(f[1]) + '</span><small>' + esc(f[2]) + '</small></li>'; }).join('') + '</ul>' +
      '<p class="pc-foot">cohoanalytics.com \u00b7 Housing Needs Assessment</p></div>' +
      (loc ? '<div class="pc-map" aria-hidden="true">' + loc + '</div>' : '') + '</figure></section>';
  }

  // Where the place is: Colorado's counties, its county filled, a town marked by a dot at its Census Gazetteer
  // centroid (data/co-place-centroids.json, the file the Finder map uses). Big visual pass (paul 11-06).
  var CENTROIDS = { cen: 'data/co-place-centroids.json' };
  function locator(geoid, name, fips, county, shapes) {
    var M = global.LabMap, feats = (shapes && shapes.features) || [];
    if (!M || !feats.length) return '';
    var isCounty = String(geoid).length === 5, cfips = isCounty ? geoid : fips;
    var dot = '';
    if (!isCounty) {
      var c = global.LabUI.load(CENTROIDS), p = c.data && c.data.cen && c.data.cen.byGeoid && c.data.cen.byGeoid[geoid];
      if (p && p.lng != null) {
        var q = M.pt([p.lng, p.lat]);
        dot = '<circle class="lc-ring" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="26"/><circle class="lc-dot" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="13"/>';
      }
    }
    var where = isCounty ? name + ' in Colorado' : name + (county ? ' in ' + county : '') + ', Colorado';
    return '<svg class="locator" viewBox="-6 -6 ' + (M.W + 12) + ' ' + (M.H + 12) + '" role="img" aria-label="' + esc('Map: ' + where) + '">' +
      feats.map(function (f) { return '<path class="' + (f.properties.GEOID === cfips ? 'lc-home' : 'lc-co') + '" d="' + M.path(f.geometry) + '"/>'; }).join('') +
      dot + '</svg>' + (county || isCounty ? '<p class="lc-cap">' + esc(isCounty ? name : county) + '</p>' : '');
  }

  // The live chapters' download buttons (PDF, CSV, JSON; js/hna/hna-export.js). The lab's CSV and JSON carry the
  // place's own HNA files at the pin with every figure's source; PDF is the browser's print. The live Excel workbook
  // is not repeated: the CSV opens in Excel.
  function downloads(geoid, entry) {
    var g = esc(geoid);
    return '<section class="hna-dl" aria-labelledby="hna-dl-h"><h2 id="hna-dl-h">Download this assessment</h2>' +
      '<p class="note">Figures for ' + esc(entry.label) + ' with their sources, as the public site publishes them.</p><div class="actions">' +
      '<button type="button" class="button-link secondary" data-hna-dl="print">Print or save as PDF</button>' +
      '<button type="button" class="button-link secondary" data-hna-dl="csv" data-hna-g="' + g + '">Download CSV (opens in Excel)</button>' +
      '<button type="button" class="button-link secondary" data-hna-dl="json" data-hna-g="' + g + '">Download JSON</button>' +
      // The live banner's "Export IC summary" link, to the lab's Investor summary for the same place.
      '<a class="button-link secondary" href="#/ic-summary?g=' + g + '">Investor summary for this place →</a>' +
      '<a class="button-link secondary" href="#/places/compare?g=' + g + '&view=blend">Combine with other places →</a></div></section>';
  }

  // 5.1: where the needs assessment sits in the live site's seven steps from a town to a deal recommendation
  // (js/components/workflow-progress.js keeps the same order and names). Only "you are here" is marked:
  // the lab records no progress, because visiting a page is not evidence that a step is done.
  var PATH = [
    ['Jurisdiction', 'Pick a town or county', '#/places'], ['Opportunity Finder', 'Places that fit 4% or 9% deals', '#/finder'],
    ['Needs Assessment', 'Need by income level', 'here'], ['Market Analysis', 'Demand and rents for a site', null, 'market-analysis.html'],
    ['Scenarios', 'Change the forecast', null, 'hna-scenario-builder.html'], ['Deal Calculator', 'Sources, uses and the gap', '#/deal-calculator'],
    ['Recommendation', 'What the data says, and how sure', '#/recommendation']];
  // The working place (paul 11-11: the bar has the menu he wants, but the pick must carry from page to page, and
  // you should always know which place you are on). The last place a page opened on is kept in this browser; a
  // place in the address always wins and becomes the working place.
  var WORK_KEY = 'coho-lab-working';
  function working() {
    try { var w = JSON.parse(global.localStorage.getItem(WORK_KEY) || 'null'); return w && /^08\d{3}(\d{2})?$/.test(w.geoid) ? w : null; } catch (e) { return null; }
  }
  function setWorking(geoid, label) {
    if (!/^08\d{3}(\d{2})?$/.test(String(geoid || ''))) return null;
    var cat = global.LabShell && global.LabShell.catalog && global.LabShell.catalog();
    var e = cat && cat.entries.filter(function (x) { return x.geoid === geoid; })[0];
    if (!e && !label && global.LabPlaces && global.LabPlaces.entryFor) { var pe = global.LabPlaces.entryFor(geoid); label = pe && pe.label; }
    var w = { geoid: geoid, label: label || (e ? e.label : geoid) };
    try { global.localStorage.setItem(WORK_KEY, JSON.stringify(w)); } catch (err) { /* storage off: the address still carries it */ }
    return w;
  }
  // away: drawn off the HNA, so the HNA step links to its picker; at: the lab route that is "you are here" instead;
  // geoid: the place this page is on (it becomes the working place). Without one, the bar uses the working place,
  // and offers Clear; a page that is about one place offers only Change.
  function stepPath(away, at, geoid) {
    var w = geoid ? setWorking(geoid) || { geoid: geoid, label: geoid } : working();
    var g = w ? encodeURIComponent(w.geoid) : '';
    // The live-site steps carry the place (?geoid=), so the full tool opens on it, not on a place saved earlier in the browser.
    var q = w ? '?geoid=' + g : '';
    var hereAt = -1;
    var items = PATH.map(function (s, i) {
      if (away && s[2] === 'here') s = [s[0], s[1], w ? '#/place/' + g : '#/places'];
      if (at && s[2] === at) s = [s[0], s[1], 'here'];
      // Every lab step opens on the working place.
      // The place goes as g on every lab step, so a page that forwards to the live site opens on it (QA/QC F01,
      // 12 Nov: the Deal Calculator step opened on a county saved earlier in the browser).
      if (w && s[2] === '#/finder') s = [s[0], s[1], '#/finder?q=' + encodeURIComponent(w.label) + '&g=' + g];
      if (w && s[2] === '#/recommendation') s = [s[0], s[1], '#/recommendation?g=' + g];
      if (w && s[2] === '#/deal-calculator') s = [s[0], s[1], '#/deal-calculator?g=' + g];
      var here = s[2] === 'here', live = !s[2];
      if (here) hereAt = i;
      var label = '<span class="sp-n" aria-hidden="true">' + (i + 1) + '</span><span class="sp-title">' + esc(s[0]) + (live ? ' <span class="live-tag">live site ↗</span>' : '') + '</span>' +
        '<span class="sp-text">' + esc(s[1]) + '</span>' + (here ? '<span class="sp-here">You are here</span>' : '');
      return '<li class="' + (here ? 'sp-current' : '') + '"' + (here ? ' aria-current="step"' : '') + '>' +
        (here ? '<span class="sp-box">' + label + '</span>' : '<a class="sp-box" href="' + esc(live ? Pl.LIVE + s[3] + q : s[2]) + '">' + label + '</a>') + '</li>';
    });
    // One line says where you are: the step, and the place, with a way to change or clear it. The same line rides
    // at the top of the screen once the bar scrolls away (bindStepBar).
    var step = hereAt > -1 ? '<span class="sp-of">Step ' + (hereAt + 1) + ' of ' + PATH.length + ': <strong>' + esc(PATH[hereAt][0]) + '</strong></span>' : '';
    var place = '<span class="sp-place">' + (w ? 'Working on: <strong>' + esc(w.label) + '</strong> <a href="#/places">Change</a>' + (geoid ? '' : ' <button type="button" class="sp-clear" data-sp-clear="1">Clear</button>')
      : 'No place picked yet. <a href="#/places">Pick a town or county</a>') + '</span>';
    var where = step + place;
    return '<nav class="step-path" aria-label="From a town to a deal, seven steps"><p class="sp-where">' + where +
      '<button type="button" class="sp-all" data-sp-all="1" aria-expanded="false">All 7 steps</button></p><ol>' + items.join('') + '</ol></nav>' +
      '<div class="sp-sticky" data-sp-sticky="1" hidden><p class="sp-where">' + where + '<a class="sp-up" href="#" data-sp-up="1">Steps</a>' +
      '<button type="button" class="sp-toggle" data-sp-fold="1" aria-expanded="' + (spFolded() ? 'false' : 'true') + '">' + (spFolded() ? 'Show steps' : 'Hide') + '</button></p></div>';
  }
  // Once per page load: Clear, All 7 steps, and the slim bar that shows while the step bar is scrolled out of view.
  // On a phone the slim line and the tab row can be folded away (paul, 12 Nov); the choice holds for the visit.
  function spFolded() { return !!(global.document && global.document.documentElement.classList.contains('sp-folded')); }
  function bindStepBar() {
    if (bindStepBar.done || !global.document) return;
    bindStepBar.done = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-sp-clear], [data-sp-all], [data-sp-up], [data-sp-fold]');
      if (!t) return;
      if (t.hasAttribute('data-sp-fold')) {
        var fold = !spFolded();
        document.documentElement.classList.toggle('sp-folded', fold);
        t.setAttribute('aria-expanded', fold ? 'false' : 'true'); t.textContent = fold ? 'Show steps' : 'Hide';
        check(); return;
      }
      if (t.hasAttribute('data-sp-clear')) { try { global.localStorage.removeItem(WORK_KEY); } catch (e) { /* nothing kept */ } if (global.LabShell) global.LabShell.render(); }
      else if (t.hasAttribute('data-sp-all')) { var nav = t.closest('.step-path'), on = !nav.classList.contains('sp-open'); nav.classList.toggle('sp-open', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); t.textContent = on ? 'Fewer steps' : 'All 7 steps'; }
      else { ev.preventDefault(); var bar = document.querySelector('.step-path'); if (bar) bar.scrollIntoView({ block: 'start' }); }
    });
    // On scroll (one check a frame): the slim bar shows once the step bar's bottom has passed the top of the screen.
    var queued = false;
    function check() {
      queued = false;
      var root = document.documentElement, head = document.querySelector('.site-header');
      // The main navigation sticks at the top; everything else that sticks sits under it.
      var hdr = head && global.getComputedStyle(head).position === 'sticky' ? Math.ceil(head.getBoundingClientRect().height) : 0;
      root.style.setProperty('--hdr-h', hdr + 'px');
      var bar = document.querySelector('.step-path'), slim = document.querySelector('[data-sp-sticky]');
      if (slim) slim.hidden = !bar || bar.getBoundingClientRect().bottom > hdr;
      // Anything else that sticks to the top (the calculator's result strip, the tab row) sits under the slim bar, never behind it.
      var sp = slim && !slim.hidden ? Math.ceil(slim.getBoundingClientRect().height) : 0;
      root.style.setProperty('--sp-top', sp + 'px');
      // The tab row's height counts toward where a jump lands only while it is stuck under the bars.
      var tabs = document.querySelector('#main .tabs'), tr = tabs && global.getComputedStyle(tabs).position === 'sticky' ? tabs.getBoundingClientRect() : null;
      root.style.setProperty('--tabs-h', tr && tr.top <= hdr + sp + 1 ? Math.ceil(tr.height) + 'px' : '0px');
      // The calculator's result strip sticks under the bars too; a field moved into view by keyboard clears it as well.
      var live = global.document.querySelector('.quick-live'), lr = live && live.getClientRects().length ? live.getBoundingClientRect() : null;
      root.style.setProperty('--live-h', lr && lr.top <= hdr + sp + 1 ? Math.ceil(lr.height) + 'px' : '0px');
    }
    // Keyboard focus never lands under the sticky header, step line, tabs or result strip (WCAG 2.4.11): a field the
    // browser leaves half-covered is scrolled down to just below them.
    global.document.addEventListener('focusin', function (ev) {
      var t = ev.target;
      if (!t || !t.getBoundingClientRect || (t.closest && t.closest('.site-header, [data-sp-sticky], .step-path, #main .tabs, .quick-live'))) return;
      var cs = global.getComputedStyle(global.document.documentElement), px = function (n) { return parseFloat(cs.getPropertyValue(n)) || 0; };
      var cover = px('--hdr-h') + px('--sp-top') + px('--tabs-h') + px('--live-h');
      var r = t.getBoundingClientRect();
      if (cover && r.top < cover + 4) global.scrollBy({ top: r.top - cover - 8, behavior: 'instant' });
    });
    global.addEventListener('scroll', function () { if (!queued) { queued = true; global.requestAnimationFrame(check); } }, { passive: true });
    global.addEventListener('resize', function () { if (!queued) { queued = true; global.requestAnimationFrame(check); } }, { passive: true });
    global.addEventListener('hashchange', function () { global.setTimeout(check, 0); });
    global.setTimeout(check, 0);
  }
  bindStepBar();

  // The way on from each chapter: the next chapter, or a project once the reader reaches the end.
  // What the labels on a figure mean, once per page.
  function geoKey(isCounty, county) {
    var rows = isCounty
      ? [[{ level: 'county' }, 'The county\u2019s own figure.'], [{ level: 'index' }, 'A score or tier the HNA builds. Not a count.']]
      : [[{ level: 'place' }, 'Measured for this place.'], [{ level: 'apportioned' }, 'Shared out to this place from census tracts.'],
        [{ level: 'estimate' }, 'Modeled for this place from wider data, such as the county forecast.'],
        [{ level: 'county-proxy', countyName: county }, 'The whole county\u2019s figure. Not published for the place.'],
        [{ level: 'index' }, 'A score or tier the HNA builds. Not a count.']];
    return '<details class="counted geo-legend"><summary>What the labels mean</summary><ul class="geo-key">' + rows.map(function (r) {
      return '<li>' + Pl.scope(r[0]).replace(/<span class="visually-hidden">[^<]*<\/span>/, '') + '<span>' + esc(r[1]) + '</span></li>';
    }).join('') + '</ul></details>';
  }

  function nextStep(geoid, tab, entry) {
    var i = TABS.map(function (x) { return x.id; }).indexOf(tab), next = TABS[i + 1];
    return '<div class="next-step"><p><strong>Next</strong></p><div class="actions">' +
      (next ? '<a class="button-link" href="#/place/' + esc(geoid) + '/' + next.id + '">' + esc(next.title) + ' \u2192</a><a class="button-link secondary" href="' + esc(Pl.useHref(entry)) + '">Use in project</a>'
        : '<a class="button-link" href="' + esc(Pl.useHref(entry)) + '">Test a site here: use in project</a><a class="button-link secondary" href="#/places">Compare another place</a>') +
      '<a class="button-link secondary" href="#/report?g=' + esc(geoid) + '">Free report</a>' +
      '</div></div>';
  }

  Shell.views.place = placeView;
  // The live HNA's Who lives here figures (js/hna/hna-renderers.js, panels F169 and F170), worked the same way
  // from the same ACS profile fields, so the lab shows the numbers the live page shows.
  var OCCUPATIONS = [['Management, business, science, arts', 'DP03_0027E'], ['Service', 'DP03_0028E'], ['Sales and office', 'DP03_0029E'],
    ['Natural resources, construction, maintenance', 'DP03_0030E'], ['Production, transportation, material moving', 'DP03_0031E']];
  var RACES = [['White alone', 'DP05_0037E'], ['Black or African American alone', 'DP05_0045E'], ['Asian alone', 'DP05_0061E'], ['Two or more races', 'DP05_0035E'],
    ['American Indian or Alaska Native alone', 'DP05_0053E'], ['Some other race alone', 'DP05_0074E'], ['Native Hawaiian or Pacific Islander alone', 'DP05_0069E']];
  var SCHOOLING = [['Less than 9th grade', 'DP02_0060E'], ['9th to 12th, no diploma', 'DP02_0061E'], ['High school graduate', 'DP02_0062E'], ['Some college, no degree', 'DP02_0063E'],
    ['Associate\u2019s degree', 'DP02_0064E'], ['Bachelor\u2019s degree', 'DP02_0065E'], ['Graduate or professional degree', 'DP02_0066E']];
  var COHORTS = [[0, 4], [5, 9], [10, 14], [15, 19], [20, 24], [25, 29], [30, 34], [35, 39], [40, 44], [45, 49], [50, 54], [55, 59], [60, 64], [65, 69], [70, 74], [75, 79], [80, 84], [85, 200]];
  function peopleFigures(p) {
    var raw = function (k) { return p[k] == null || p[k] === '' || isNaN(Number(p[k])) ? null : Number(p[k]); };
    // A count the Census table does not publish stays missing (null), and so does every figure worked out from it.
    // A published 0 is a real count and is kept. `all` is null unless every count it needs is published.
    var all = function (keys, fn) { var v = keys.map(raw); return v.some(function (x) { return x == null; }) ? null : fn.apply(null, v); };
    // Family households: married couples plus householders without a spouse who live with relatives (not alone).
    var fam = all(['DP02_0002E', 'DP02_0006E', 'DP02_0008E', 'DP02_0010E', 'DP02_0012E'], function (m, mh, ma, fh, fa) { return m + Math.max(0, mh - ma) + Math.max(0, fh - fa); });
    // The live page's retiree estimate: 85% of residents 65 and older, capped at everyone not in the labor force.
    var notInLf = raw('DP03_0007E'), over65 = raw('DP05_0024E') != null ? raw('DP05_0024E') : raw('DP05_0029E');
    var retirees = over65 == null || notInLf == null ? null : Math.min(notInLf, Math.round(over65 * 0.85));
    var pop = raw('DP05_0033E'), pop25 = raw('DP02_0059E');
    var share = function (k) { var v = raw(k); return pop25 && v != null ? v / pop25 * 100 : null; };
    return {
      households: raw('DP02_0001E'), family: fam, size: raw('DP02_0016E'), famSize: raw('DP02_0017E'),
      withKids: raw('DP02_0014E'), withSeniors: raw('DP02_0015E'), disability: raw('DP02_0072E'),
      occupations: OCCUPATIONS.map(function (o) { return [o[0], raw(o[1])]; }),
      employed: all(['DP03_0002E', 'DP03_0005E'], function (lf, u) { return lf - u; }), unemployed: raw('DP03_0005E'), laborForce: raw('DP03_0002E'),
      notInLf: notInLf, retirees: retirees,
      notInLfUnder65: retirees == null ? null : Math.max(0, notInLf - retirees),
      pop: pop, races: RACES.map(function (r) { return [r[0], raw(r[1])]; }), hispanic: raw('DP05_0090E'), nhWhite: raw('DP05_0096E'),
      pop25: pop25 || null, schooling: SCHOOLING.map(function (r) { return [r[0], raw(r[1])]; }),
      hsPlus: share('DP02_0067E'), baPlus: share('DP02_0068E'), grad: share('DP02_0066E')
    };
  }
  // The State Demography Office's single-year ages for a county, in five-year groups, as the live page bins them.
  function ageGroups(sya) {
    if (!sya || !sya.male || !sya.female) return null;
    var sum = function (a, f, t) { var x = 0; for (var i = f; i <= t && i < a.length; i++) x += Number(a[i]) || 0; return x; };
    return COHORTS.map(function (c) { return [c[1] >= 200 ? '85+' : c[0] + '\u2013' + c[1], sum(sya.male, c[0], c[1]), sum(sya.female, c[0], c[1])]; });
  }

  global.LabHna = { peopleFigures: peopleFigures, ageGroups: ageGroups, TABS: TABS, chapter: function (c, geoid, tab, entry, place) { return focusTables(view(c, geoid, tab, entry, place)); }, stepPath: stepPath, PATH: PATH, working: working, setWorking: setWorking, loadPlace: loadPlace, sourceOf: sourceOf, sourceUrl: sourceUrl, scopeOf: scopeOf, INCOME: INCOME, STRUCTURE: STRUCTURE, BEDROOMS: BEDROOMS, RENT_BURDEN: RENT_BURDEN, BURDEN_TIERS: BURDEN_TIERS };
})(window);
