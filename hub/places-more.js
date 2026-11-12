// The rest of the Places and need menu, rebuilt from the pinned data the live pages read:
//   #/places/ranking                 the HNA ranking (data/hna/ranking-index.json), as published
//   #/places/compare?g=a,b           two to six places side by side, from the same file
//   #/places/costs                   multifamily construction prices since 2020, with policy events
//   #/places/incentives[/<geoid>]    local housing tools, through the live page's own logic module
//                                    (js/local-incentives-data.js), which keeps "no record" apart from "none"
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, Pl = global.LabPlaces;
  var esc = Shell.esc, num = Pl.num;
  var LIVE = Pl.LIVE;

  var RANK_FILES = { ranking: 'data/hna/ranking-index.json' };
  var LI_FILES = {
    geoConfig: 'data/hna/geo-config.json', fees: 'data/policy/fee-reductions.json', funds: 'data/policy/local-housing-funds.json',
    coverage: 'data/policy/incentive-coverage.json', prop123: 'data/policy/prop123_jurisdictions.json', alternatives: 'data/policy/incentive-alternatives.json',
    // Places like this one (the live page's "What similar places use"; QA 11-09: the lab built the model without it).
    peerProfiles: 'data/policy/incentive-peer-profiles.json'
  };
  var RANK_SRC = LIVE + 'hna-comparative-analysis.html';
  var LI_SRC = LIVE + 'local-incentives.html';

  function load(files) { return global.LabUI.load(files); }
  function waiting(title, s) {
    return '<h1>' + esc(title) + '</h1>' + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading the data…</p>');
  }
  function crumbs(page) { return T.trail('places', page); }
  var TYPE = { county: 'County', place: 'Town or city', cdp: 'CDP' };
  function cleanName(n) { return String(n || '').replace(/ \((city|town|CDP)\)$/i, ''); }
  function pct(v) { return v == null ? null : Number(v).toFixed(1) + '%'; }
  function placeHref(g) { return '#/place/' + g; }

  // ---- HNA ranking ----------------------------------------------------------------------------
  function metricTip(d, id) {
    var m = d.ranking.metrics.filter(function (x) { return x.id === id; })[0];
    return m ? m.description : null;
  }
  // The top ten, each with its data strength in words. A thin-data place keeps its rank and bar (the HNA's own
  // order is never changed) but the bar is faded and the chip says why, so a small town with a wide survey
  // margin does not read as certain.
  var STRENGTH_WORD = { strong: 'Strong data', mixed: 'Mixed data', thin: 'Thin data' };
  function topTen(top, max, total) {
    var S = global.LabStrength, st = S ? S.load() : null, ready = st && st.file;
    var anyThin = false;
    var items = top.map(function (r) {
      var g = ready ? S.grade(S.tally(r.geoid)) : '';
      if (g === 'thin') anyThin = true;
      var chip = g ? '<span class="rank-chip strength-chip-' + g + '">' + STRENGTH_WORD[g] + '</span>' : '';
      return '<li class="' + (g === 'thin' ? 'rank-thin' : '') + '"><span class="rank-n">' + esc(String(r.rank)) + '</span><a href="' + esc(placeHref(r.geoid)) + '">' + esc(r.name) + '</a>' + chip +
        '<span class="rank-bar"><span class="bar households" style="width:' + (r.score / max * 100).toFixed(2) + '%" title="' + esc(r.name + ': priority score ' + Number(r.score).toFixed(1)) + '"></span></span><span class="bar-value">' + esc(Number(r.score).toFixed(1)) + '</span></li>';
    }).join('');
    return '<ol class="rank rank-chips">' + items + '</ol>' +
      (st && st.error ? '<p class="note">Data strength did not load (' + esc(st.error) + ').</p>' : !ready ? '<p class="note" role="status">Reading the survey margins…</p>' : '') +
      (anyThin ? '<p class="note">A faded bar marks thin survey data: the Census sample is small enough that three or more of the place\u2019s figures need caution. The rank is the HNA\u2019s, unchanged.</p>' : '') +
      '<p><a href="' + esc(location.hash.split('?')[0]) + '" data-jump="every-place">Show all ' + num(total) + ' places \u2193</a></p>';
  }

  // The live ranking page's exploratory lenses: the same index re-weighted by the HNA's own generated preset files
  // (data/hna/ranking-scenarios). Descriptions are the live page's. The official rank always stays in view.
  var LENSES = [
    { id: 'balanced', label: 'Balanced', note: 'Even gap count/rate blend with standard commuter pressure.' },
    { id: 'rate-sensitive', label: 'Rate-sensitive', note: 'Emphasizes jurisdictions where the affordable-unit gap is large relative to low-income households.' },
    { id: 'large-gap', label: 'Large gap', note: 'Emphasizes the largest absolute affordable-unit deficits.' },
    { id: 'commuter-pressure', label: 'Commuter pressure', note: 'Increases the lift for jurisdictions importing a large share of their workforce.' },
    { id: 'rural-lens', label: 'Rural and small towns', note: 'Emphasizes gap rates and relaxes the denominator floor to surface smaller communities.' }
  ];
  var SCORECARD_FILE = 'data/policy/housing-policy-scorecard.json';
  var RANKING_VIEW_FILES = { ranking: RANK_FILES.ranking, scorecard: SCORECARD_FILE };
  // Dimensions in the live page's order, with its own labels in plain words.
  var COMMIT_DIMS = [
    { id: 'prop123_committed', label: 'Prop 123 commitment' },
    { id: 'has_housing_authority', label: 'Housing authority' },
    { id: 'has_housing_nonprofits', label: 'Housing nonprofits' },
    { id: 'has_hna', label: 'Housing needs assessment' },
    { id: 'has_comp_plan', label: 'Comprehensive plan' },
    { id: 'has_iz_ordinance', label: 'Inclusionary zoning ordinance' },
    { id: 'has_local_funding', label: 'Local housing funding' }
  ];
  // Share of places with a confirmed yes or no for each dimension, as the live page counts it.
  function commitCoverage(sc) {
    var scores = (sc && sc.scores) || {}, ids = Object.keys(scores), total = ids.length;
    if (!total) return '<p class="note">The housing commitment file did not load.</p>';
    var items = COMMIT_DIMS.map(function (d) {
      var known = ids.filter(function (g) { var v = (scores[g].dimensions || {})[d.id]; return v !== null && v !== undefined; }).length;
      return { label: d.label, known: known, pct: Math.round(known / total * 100) };
    });
    return '<p class="note">Out of ' + num(total) + ' places, the share with a confirmed answer, yes or no, for each local housing commitment. The rest have no record yet, which is not the same as no.</p>' +
      '<ol class="rank">' + items.map(function (x) {
        return '<li><span class="rank-label">' + esc(x.label) + '</span><span class="rank-bar"><span class="bar homes" style="width:' + x.pct + '%" title="' + esc(x.label + ': ' + num(x.known) + ' of ' + num(total) + ' places confirmed') + '"></span></span><span class="bar-value">' + x.pct + '%</span></li>';
      }).join('') + '</ol>' +
      '<p class="note">Know your place’s housing authority, plan or inclusionary zoning rule? Send it to <a href="mailto:info@cohoanalytics.com?subject=Housing%20policy%20data%20submission">info@cohoanalytics.com</a>.</p>' +
      T.source('Housing policy scorecard (DOLA Prop 123 filings, local resources, inclusionary zoning, local funds)', RANK_SRC, String(((sc.metadata || {}).generatedAt) || '').slice(0, 10));
  }

  // The live page's Export CSV: the places in view, in view order, with every column the table shows.
  function rankCsv(cols, rows, region, lens) {
    var V = global.LabVizData;
    if (!V || !rows.length) return '';
    var name = 'coho-hna-ranking' + (region ? '-' + region.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + (lens ? '-' + lens.id : '') + '.csv';
    var text = V.csvText(['GEOID'].concat(cols.map(function (c) { return c.label; })), rows.map(function (r) { return [r.geoid].concat(cols.map(function (c) { return r[c.key]; })); }));
    return '<p class="viz-data-csv"><a class="button-link secondary" href="data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + text) + '" download="' + esc(name) + '">Download these ' + num(rows.length) + ' places as CSV</a></p>';
  }

  function ranking(params) {
    var s = load(RANKING_VIEW_FILES);
    if (!s.data) return waiting('HNA ranking', s);
    var d = s.data, meta = d.ranking.metadata;
    var lensId = params && params.get ? params.get('lens') : null;
    var lens = LENSES.filter(function (x) { return x.id === lensId; })[0] || null;
    var ls = lens ? load({ lens: 'data/hna/ranking-scenarios/' + lens.id + '.json' }) : null;
    var byLens = {};
    if (ls && ls.data) ls.data.lens.rankings.forEach(function (r) { byLens[r.geoid] = r; });
    var lensOn = !!(ls && ls.data);
    var rows = d.ranking.rankings.map(function (r) {
      var m = r.metrics || {}, L = byLens[r.geoid];
      return {
        geoid: r.geoid, name: cleanName(r.name), type: TYPE[r.type] || r.type, region: r.region, rank: r.rank,
        lensRank: L ? L.rank : null, lensScore: L ? L.overall_need_score : null,
        score: m.overall_need_score, need: m.community_need_score, opp: m.opportunity_score,
        gap30: m.ami_gap_30pct, burden: m.pct_cost_burdened, future: m.future_units_needed_20yr, pop: m.population,
        flag: r.hasIncompleteData ? 'Some inputs missing' : ''
      };
    }).sort(function (a, b) { return (a.rank || 1e9) - (b.rank || 1e9); });
    // With a lens on, the table opens in the lens's order, as the live page does; the top ten above stays official.
    var tableRows = lensOn ? rows.slice().sort(function (a, b) { return (a.lensRank || 1e9) - (b.lensRank || 1e9); }) : rows;
    // The live page's region filter (hna-comparative-analysis.html #hcaFilterRegion): the regions the ranking file names.
    var regions = rows.map(function (r) { return r.region; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    var regionId = params && params.get ? params.get('region') : null, region = regions.indexOf(regionId) > -1 ? regionId : null;
    if (region) tableRows = tableRows.filter(function (r) { return r.region === region; });
    var lensCols = lensOn ? [
      { key: 'lensRank', label: lens.label + ' rank', num: true, tip: 'Rank under the ' + lens.label + ' lens. Exploratory, not the official ranking.' },
      { key: 'lensScore', label: lens.label + ' score', num: true, fmt: function (v) { return v == null ? '—' : Number(v).toFixed(1); }, tip: 'Priority score under the ' + lens.label + ' lens.' }
    ] : [];
    var base = location.hash.split('?')[0];
    var linkFor = function (o) {
      var q = [], l = 'lens' in o ? o.lens : lens && lens.id, rg = 'region' in o ? o.region : region;
      if (l) q.push('lens=' + encodeURIComponent(l)); if (rg) q.push('region=' + encodeURIComponent(rg));
      return base + (q.length ? '?' + q.join('&') : '');
    };
    var regionNav = '<nav class="region-nav" aria-label="Region">' + ['<a href="' + esc(linkFor({ region: null })) + '"' + (!region ? ' aria-current="true"' : '') + '>All regions</a>'].concat(regions.map(function (x) {
      return '<a href="' + esc(linkFor({ region: x })) + '"' + (region === x ? ' aria-current="true"' : '') + '>' + esc(x) + '</a>';
    })).join('') + '</nav>';
    var lensPanel = '<h2>Ranking scenario lens</h2>' +
      '<p class="note">The official ranking is shown by default. A lens re-weights the same figures to ask a narrower question. It is exploratory: the official rank and score stay in the table beside it.</p>' +
      '<nav class="region-nav" aria-label="Ranking lens">' + ['<a href="' + esc(linkFor({ lens: null })) + '"' + (!lens ? ' aria-current="true"' : '') + '>Official ranking</a>'].concat(LENSES.map(function (x) {
        return '<a href="' + esc(linkFor({ lens: x.id })) + '"' + (lens && lens.id === x.id ? ' aria-current="true"' : '') + '>' + esc(x.label) + '</a>';
      })).join('') + '</nav>' +
      (lens ? '<p class="callout">' + esc(lens.label) + ' lens: ' + esc(lens.note) +
        (lensOn && ls.data.lens.metadata && ls.data.lens.metadata.based_on ? ' Based on the official index of ' + esc(String(ls.data.lens.metadata.based_on).slice(0, 10)) + '.' : '') +
        ' This is not the official ranking.</p>' + (ls.error ? '<p class="callout">' + esc(ls.error) + '</p>' : !lensOn ? '<p role="status" class="note">Loading the lens…</p>' : '') : '');
    var cols = [
      { key: 'rank', label: 'Rank', num: true, tip: 'The HNA’s own order by priority score, which is 55% need and 45% opportunity. Sort by Community need for need alone.' }
    ].concat(lensCols).concat([
      { key: 'name', label: 'Place', href: function (r) { return placeHref(r.geoid); } },
      { key: 'type', label: 'Type' },
      { key: 'region', label: 'Region' },
      { key: 'score', label: 'Priority score (need and opportunity)', num: true, fmt: function (v) { return Number(v).toFixed(1); }, tip: metricTip(d, 'overall_need_score') },
      { key: 'need', label: 'Community need', num: true, fmt: function (v) { return Number(v).toFixed(1); }, tip: metricTip(d, 'community_need_score') },
      { key: 'opp', label: 'Opportunity', num: true, fmt: function (v) { return Number(v).toFixed(1); }, tip: metricTip(d, 'opportunity_score') },
      { key: 'gap30', label: 'Homes short, 30% AMI', num: true, fmt: num, tip: 'Renter households at or below 30% AMI minus homes priced for them.' },
      { key: 'burden', label: 'Renters cost burdened', num: true, fmt: pct, tip: 'Renters paying more than 30% of income.' },
      { key: 'future', label: 'Homes needed, 20 years', num: true, fmt: num, tip: 'Resident growth plus in-commuters, from the State Demography Office forecast.' },
      { key: 'pop', label: 'Population', num: true, fmt: num },
      { key: 'flag', label: 'Data note' }
    ]);
    var top = rows.slice(0, 10), max = top.length ? top[0].score : 100;
    // The page story (paul 11-06): name who leads, and who leads on need alone, so the 55/45 split shows in one line.
    var needLead = rows.filter(function (r) { return r.need != null; }).sort(function (a, b) { return b.need - a.need; })[0];
    var lead = rows[0];
    var answer = lead ? esc(lead.name) + ' ranks first of ' + num(rows.length) + ' Colorado places on the HNA\u2019s priority score' +
      (needLead && needLead !== lead ? '. On need alone, ' + esc(needLead.name) + ' ranks first' : '') +
      '. The score is 55% need and 45% opportunity, so places with more services rank higher.' :
      'Every Colorado county, town and CDP in the HNA’s priority order. The priority score is 55% need and 45% opportunity (mobility, walkability, services, QCT and DDA areas), so places with more amenities rank higher. The Community need column is need alone.';
    return T.head({
      kind: 'data', crumbs: crumbs('HNA ranking'), title: 'HNA ranking',
      answer: answer,
      meta: '<span class="scope-tag">Scope: ' + num(meta.totalEntries) + ' places</span> Census ACS 5-year, DOLA forecasts, HUD CHAS, LEHD LODES and EPA Smart Location; built ' + esc(String(meta.generatedAt).slice(0, 10)) + '. Opportunity means mobility, walkability, services, and QCT and DDA areas.',
      aside: T.terms((global.LabPlaces && global.LabPlaces.TERMS) || ''),
      facts: [
        { value: num(meta.totalCounties), label: 'Counties', source: 'HNA ranking', href: RANK_SRC },
        { value: num(meta.totalPlaces), label: 'Towns and cities', source: 'HNA ranking', href: RANK_SRC },
        { value: num(meta.totalCDPs), label: 'CDPs', source: 'HNA ranking', href: RANK_SRC },
        { value: num(meta.medianHousingGap), label: 'Median homes short', source: 'HNA ranking', href: RANK_SRC }
      ]
    }) +
      '<h2>The ten places ranked highest' + (lensOn ? ' (official ranking)' : '') + '</h2>' + topTen(top, max, rows.length) +
      '<details class="counted"><summary>How the score is built</summary><p>' + esc(meta.note) + '</p><p>The score is the HNA’s own screening index. The lab shows it as published and adds no score of its own. The figures beside it are each place’s published counts, so a place can be read without the score.</p>' +
        // The live page's "what this page is not" note (QA 11-09), word for word.
        '<p><strong>What the ranking does not tell you.</strong> Rankings use percentile scoring across all 546 geographies, mixing large cities with small CDPs. A high percentile rank for a 500-person CDP may reflect noise, not signal. The 55% community-need / 45% opportunity weighting is defensible but not the only valid weighting. A place with its own published ACS and CHAS data is scored on that data; a place without it uses its county\u2019s figure, scaled by population share. <a href="' + RANK_SRC + '">From the live HNA ranking page</a>.</p></details>' +
      T.means([
        { text: 'The score weighs need together with access to jobs and services, so it favors places where new homes would also be near what residents use. A place with high need but few services ranks lower; its Community need score shows need alone.' }
      ]) +
      lensPanel +
      '<h2 id="every-place" tabindex="-1">Every place' + (region ? ' in the ' + esc(region) + ' region' : '') + '</h2>' + regionNav +
      global.LabUI.table('ranking', 'HNA ranking, ' + (region ? 'the ' + region + ' region' : 'every Colorado county, town and CDP') + (lensOn ? ', in ' + lens.label + ' lens order' : ''), cols, tableRows, { noun: 'places', placeholder: 'Name, type or region' }) +
      rankCsv(cols, tableRows, region, lensOn ? lens : null) +
      T.source('HNA comparative ranking (Census ACS, DOLA, HUD CHAS, LEHD LODES, EPA Smart Location)', RANK_SRC, String(meta.generatedAt).slice(0, 10)) +
      '<h2>Housing commitment data coverage</h2>' + commitCoverage(d.scorecard) +
      T.next('What to do next', [{ href: '#/places', label: 'Open a place’s needs assessment →' }, { href: '#/places/compare', label: 'Compare up to six places', secondary: true }, { href: '#/finder', label: 'See where tax credit deals fit', secondary: true }]);
  }

  // ---- Compare places -----------------------------------------------------------------------
  // Each row names where its figure comes from (src), so the page can say the survey, period and geography per place.
  var CMP_ROWS = [
    { label: 'Population', key: 'population', fmt: num, src: 'acs' },
    { label: 'Median household income', key: 'median_hh_income', fmt: function (v) { return Pl.money(v); }, src: 'acs' },
    { label: 'Median gross rent', key: 'gross_rent_median', fmt: function (v) { return Pl.money(v); }, src: 'acs' },
    { label: 'Share who rent', key: 'pct_renters', fmt: pct, src: 'acs' },
    { label: 'Renters at or below 30% AMI', key: 'low_income_households_lte30', fmt: num, src: 'gap' },
    { label: 'Homes short at 30% AMI', key: 'ami_gap_30pct', fmt: num, src: 'gap' },
    { label: 'Homes short at 60% AMI', key: 'ami_gap_60pct', fmt: num, src: 'gap' },
    { label: 'Renters cost burdened', key: 'pct_cost_burdened', fmt: pct, src: 'acs' },
    { label: 'Homes needed over 20 years', key: 'future_units_needed_20yr', fmt: num, src: 'dola' },
    { label: 'Tax credit properties', key: 'lihtc_project_count', fmt: num, src: 'chfa' },
    { label: 'HNA need rank', key: '_rank', fmt: function (v) { return '#' + v; }, src: 'rank' }
  ];

  // The deal types the full comparison on cohoanalytics.com ranks by (its ?target= values and labels, js/compare.js).
  var CMP_TARGETS = [['9pct', '9% Competitive'], ['4pct', '4% Bond'], ['preservation', 'Preservation'], ['workforce_resort', 'Workforce / Resort'], ['prop123_local', 'Prop 123 / Local'], ['any', 'Balanced (any)']];
  // The full comparison's own link: towns and CDPs only (7-digit codes), up to six, and the deal type.
  function fullCompareHref(geoids, target) {
    var towns = geoids.filter(function (g) { return /^\d{7}$/.test(g); }).slice(0, 6);
    return towns.length ? LIVE + 'compare.html?jurisdictions=' + towns.join(',') + '&target=' + encodeURIComponent(target) : null;
  }

  // Where one place's figure in one row comes from: survey, period and geography, from the files the figure is read from.
  // sum: the place's HNA summary (its stored ACS profile names its own series and year), or null while it loads.
  function cmpSource(row, r, sum, meta) {
    var m = r.metrics || {}, county = r.type === 'county';
    if (row.src === 'acs') {
      var a = sum && sum.acsProfile;
      if (!a) return { text: 'Census ACS profile (series loading)', geo: county ? 'county' : 'place' };
      var y = Number(a._acsYear), one = a._acsSeries === 'acs1';
      return { text: y ? 'Census ACS ' + (one ? y + ' 1-year' : (y - 4) + '\u2013' + y + ' 5-year') : 'Census ACS (year not stated in the file)', geo: county ? 'county' : 'place', series: y ? (one ? 'acs1-' + y : 'acs5-' + y) : 'acs' };
    }
    if (row.src === 'gap') {
      var direct = m._ami_gap_source === 'place_acs_direct' || m._ami_gap_source === 'county_direct';
      return { text: 'Census ACS 2020\u20132024 5-year, scored against HUD FY2026 income limits' + (direct ? '' : ' (estimated from the county)'), geo: direct ? (county ? 'county' : 'place') : 'county share', series: 'acs5-2024' };
    }
    if (row.src === 'dola') {
      var basis = String(m.future_units_basis || '');
      return { text: 'State Demography Office forecast, 2024\u20132044' + (/county_direct/.test(basis) ? '' : ', county forecast shared out to the place'), geo: /county_direct/.test(basis) ? 'county' : 'county share' };
    }
    if (row.src === 'chfa') return { text: 'CHFA tax credit property list, matched by place name', geo: county ? 'county' : 'place' };
    return { text: 'HNA ranking, built ' + String(meta.generatedAt).slice(0, 10), geo: county ? 'county' : 'place' };
  }

  // ---- Compare: the deal rows the public Compare shows (site/compare-records.js builds them the way js/compare.js does) ----
  var R = global.LabCompareRecords;
  var CMP_DEAL_FILES = {};
  if (R) { Object.keys(R.FILES).forEach(function (k) { CMP_DEAL_FILES[k] = R.FILES[k]; }); CMP_DEAL_FILES.cross = 'data/processed/rent_burden_crosscheck.json'; }
  var mut = function (s) { return '<span class="muted">' + esc(s) + '</span>'; };
  var money0 = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
  // Each row: label, how a cell reads, the plain definition, and where the figure comes from (src(d, rec) → text).
  var dateOf = function (s) { return String(s || '').slice(0, 10); };
  var DEAL_GROUPS = [
    ['Designations and local readiness', [
      { label: 'QCT', key: 'qct', cell: function (r) { return r.hasQct ? 'Yes (' + r.qctCount + ' tract' + (r.qctCount === 1 ? '' : 's') + ')' : 'No'; },
        def: 'Qualified Census Tract: a tract where half or more of households earn under 60% of area median income, or a quarter or more live in poverty. A tax credit deal there can take a 30% basis boost. For a town, tracts that cover more than 5% of the town or have more than 20% of their area in it.',
        src: function (d, r) { return 'HUD Qualified Census Tracts 2026, fetched ' + dateOf(d.qct.fetchedAt) + (r.county ? ', all tracts in the county' : ', tracts in the town') ; }, url: 'https://www.huduser.gov/portal/datasets/qct.html' },
      { label: 'DDA county', key: 'dda', cell: function (r) { return r.hasDda ? 'Yes' : 'No'; },
        def: 'Whether the county is a county-wide Difficult Development Area, where building costs are high next to incomes; the same 30% basis boost. HUD also names 31 metro ZIP areas, which this row does not check.',
        src: function (d) { return 'HUD Difficult Development Areas ' + (d.dda.designationYear || '') + ', fetched ' + dateOf(d.dda.fetchedAt) + ', county'; }, url: 'https://www.huduser.gov/portal/datasets/qct.html' },
      { label: 'Civic readiness on record', key: 'civic', cell: function (r) { return r.civicRawScore == null ? mut('Not researched') : esc(r.civicRawScore + ' of 7') + (r.civicIsCounty ? ' <span class="scope-tag">county</span>' : ''); }, html: true,
        def: 'How many of seven local readiness items are on record: Prop 123 commitment, a housing needs assessment, a comprehensive plan, inclusionary zoning, local funding, a housing authority and local nonprofits. "county" means the town has no scorecard of its own, so this is its county’s.',
        src: function (d, r) { return 'COHO housing policy scorecard, built ' + dateOf(d.scorecard.metadata && d.scorecard.metadata.generatedAt) + (r.civicIsCounty ? ', county' : ''); }, url: LIVE + 'policy-briefs.html' }
    ]],
    ['Tax credit pipeline', [
      { label: 'Last tax credit award year', key: 'lastYear', cell: function (r) { return r.lastYear || mut('None on record'); }, html: true,
        def: 'The most recent year CHFA reserved housing tax credits for a project here. Award years run two to three years ahead of opening. A town is matched by city name, a county by county code.',
        src: function (d, r) { return 'CHFA housing tax credit property list, fetched ' + dateOf(d.lihtc.fetchedAt) + (r.county ? ', by county' : ', by city name') + (r.r1Count ? ', with CHFA 2026 Round One awards (announced 2026-05-21)' : ''); }, url: 'https://www.chfainfo.com/rental-housing/housing-credit' },
      { label: 'Years since the last award', key: 'drought', cell: function (r) { var v = r.droughtYears; return v == null ? mut('No award on record') : v === 0 ? 'Awarded this year' : esc(v + (v === 1 ? ' year' : ' years')) + (v >= 8 ? ' <span class="scope-tag">long gap</span>' : ''); }, html: true,
        def: 'This year minus the last award year. A long gap can mean a town CHFA has not funded lately, or one without a sponsor ready to apply.',
        src: function (d, r) { return r.county ? 'From the CHFA property list, by county' : 'CHFA watch list where the town is on it (' + dateOf(d.watch.meta && d.watch.meta.generated) + '), otherwise the CHFA property list'; }, url: 'https://www.chfainfo.com/rental-housing/housing-credit' },
      { label: 'CHFA watch list signal', key: 'watch', cell: function (r) { return r.watchTracked ? (r.watchSignal ? esc(r.watchSignal) : mut('Not on the list')) : mut('Towns only'); }, html: true,
        def: 'High, medium or low: COHO’s reading of which communities are likely to return to CHFA soon, from years since the last award, documented need, Prop 123 readiness and multi-phase projects in CHFA’s records. About 50 towns are on the list; it is not a CHFA ranking.',
        src: function (d) { return 'COHO CHFA watch list, ' + dateOf(d.watch.meta && d.watch.meta.generated) + ', from CHFA public records'; }, url: 'https://www.chfainfo.com/rental-housing/housing-credit' },
      { label: 'Recent CHFA activity', key: 'recent', cell: function (r) {
          var parts = [];
          if (r.r1Count > 0) parts.push(esc('2026 Round One: ' + r.r1Count + ' award' + (r.r1Count === 1 ? '' : 's') + ', ' + r.r1Units + ' homes'));
          if (r.lastAwardYear) parts.push(esc('Property list: ' + r.lastAwardYear));
          return parts.length ? parts.join('<br>') : mut('None on record');
        }, html: true,
        def: 'The latest award year in CHFA’s property list, plus any 2026 Round One awards CHFA announced on 2026-05-21 that the list does not carry yet. A county shows the property list only.',
        src: function (d, r) { return 'CHFA property list (fetched ' + dateOf(d.lihtc.fetchedAt) + ')' + (r.county ? '' : ' and CHFA 2026 Round One award list'); }, url: 'https://www.chfainfo.com/rental-housing/housing-credit/2026-round-one-award-descriptions' },
      { label: 'Tax credit projects on record', key: 'projects', cell: function (r) { return num(r.projectCount); },
        def: 'How many CHFA tax credit projects are on record here. Fewer can mean more room for a competitive 9% application.',
        src: function (d, r) { return 'CHFA housing tax credit property list, fetched ' + dateOf(d.lihtc.fetchedAt) + (r.county ? ', by county code' : ', by city name'); }, url: 'https://www.chfainfo.com/rental-housing/housing-credit' },
      { label: 'Local private activity bond allocation', key: 'pab', cell: function (r, d) {
          if (r.pabDirect == null) return Object.keys(d.pab.allocations || {}).length ? mut('$0, uses the statewide pool') : mut('Not available');
          return esc(money0(r.pabDirect)) + (r.pabIsCounty ? ' <span class="scope-tag">county</span>' : '');
        }, html: true,
        def: 'The town’s or county’s own bond allocation from the state. Most 4% deals in Colorado draw bonds from CHFA’s statewide pool instead; the local share mostly funds single-family bonds. "$0" means below the minimum for a local allocation, which is expected. "county" means the county holds the allocation and the town would issue through it.',
        src: function (d) { var m = d.pab.metadata || {}; return 'Colorado DOLA Division of Housing, ' + (m.year || '') + ' direct allocations, fetched ' + (m.fetched || ''); }, url: 'https://doh.colorado.gov/private-activity-bond-direct-allocations-2026' }
    ]],
    ['Preservation pipeline', [
      { label: 'Subsidized homes to preserve', key: 'pres', cell: function (r) { return num(r.preservationCount); },
        def: 'Properties with a subsidy that could end: CHFA preservation, HUD assisted, USDA rural and local voucher records. The universe for preservation outreach, not a count of homes at risk.',
        src: function (d, r) { return 'COHO affordable housing inventory, built ' + dateOf(d.props.metadata && d.props.metadata.generated) + (r.county ? ', by county code' : ', by city name'); }, url: LIVE + 'preservation.html' },
      { label: '…with restrictions ending within 5 years', key: 'pres5', cell: function (r) { return num(r.preservationUrgent5y); },
        def: 'Of those, properties whose affordability restriction ends within five years: the near-term risk.',
        src: function (d, r) { return 'COHO affordable housing inventory, built ' + dateOf(d.props.metadata && d.props.metadata.generated) + (r.county ? ', by county code' : ', by city name'); }, url: LIVE + 'preservation.html' }
    ]],
    ['Jobs and commuting', [
      { label: 'Commuting pattern', key: 'labor', cell: function (r) {
          if (!r.labor) return mut('Towns only');
          var c = r.labor.character; if (!c) return mut('Not published');
          return esc((c === 'bedroom' ? 'Bedroom community' : c === 'mixed' ? 'Mixed' : 'Self-contained') + (r.labor.outflowPct != null ? ', ' + r.labor.outflowPct + '% work elsewhere' : ''));
        }, html: true,
        def: 'From the share of working residents who work outside the town: 70% or more is a bedroom community, 40 to 70% mixed, under 40% self-contained.',
        src: function (d, r) { return r.county ? 'Not in this file for counties' : (r.labor && r.labor.source === 'block-od' ? 'Census LEHD LODES ' + (d.od.meta && d.od.meta.year) + ' origin-destination, by block' : 'Census LEHD LODES, tract-based'); }, url: 'https://lehd.ces.census.gov/data/' },
      { label: 'Jobs located here', key: 'jobs', cell: function (r) { return r.labor ? (r.labor.jobs ? num(r.labor.jobs) : '—') : mut('Towns only'); }, html: true,
        def: 'Primary jobs located in the town.', src: function (d, r) { return r.county ? 'Not in this file for counties' : 'Census LEHD LODES ' + (d.od.meta && d.od.meta.year); }, url: 'https://lehd.ces.census.gov/data/' },
      { label: 'Workers commuting in', key: 'inflow', cell: function (r) { return r.labor ? (r.labor.inflow ? num(r.labor.inflow) : '—') : mut('Towns only'); }, html: true,
        def: 'People who work here and live elsewhere. Many in-commuters means workers compete for the same homes.', src: function (d, r) { return r.county ? 'Not in this file for counties' : 'Census LEHD LODES ' + (d.od.meta && d.od.meta.year); }, url: 'https://lehd.ces.census.gov/data/' },
      { label: 'Residents commuting out', key: 'outflow', cell: function (r) { return r.labor ? (r.labor.outflow ? num(r.labor.outflow) : '—') : mut('Towns only'); }, html: true,
        def: 'Working residents whose jobs are elsewhere.', src: function (d, r) { return r.county ? 'Not in this file for counties' : 'Census LEHD LODES ' + (d.od.meta && d.od.meta.year); }, url: 'https://lehd.ces.census.gov/data/' }
    ]],
    ['Funding and data checks', [
      { label: 'Funding programs that fit', key: 'funding', cell: function (r) { return r.fundingProgramsFit == null ? mut('Not available') : esc(r.fundingProgramsFit + ' programs'); }, html: true,
        def: 'Programs in COHO’s funding guide that fit the deal type picked above here and are open or have a published next round. Statewide programs count everywhere; a city fund only in that city. Screens eligibility from published terms; it does not predict an award.',
        src: function (d) { return 'COHO developer funding guide, as of ' + (d.guide.meta && d.guide.meta.as_of) + ', checked ' + (d.guide.meta && d.guide.meta.last_checked); }, url: LIVE + 'colorado-deep-dive.html#tab-funding' },
      { label: 'Rent burden data check', key: 'rbr', cell: function (r) { var x = rbr(r.geoid); return x === undefined ? mut('Checking…') : x ? '<span title="' + esc(x.title) + '">' + esc(x.label) + '</span>' : mut('No check for this place'); }, html: true,
        def: 'Checks the HUD CHAS 2018–2022 share of renters paying 30% or more against the same-period Census ACS 5-year and the newer ACS 1-year. High confidence means both agree; low means they differ enough to look closer.',
        src: function (d) { return 'HUD CHAS 2018–2022 with Census ACS ' + ((d.cross && d.cross.meta && d.cross.meta.acs5_vintage) || '') + ' 5-year and ' + ((d.cross && d.cross.meta && d.cross.meta.acs1_vintage) || '') + ' 1-year, built ' + ((d.cross && d.cross.meta && d.cross.meta.generated_at) || ''); }, url: 'https://www.huduser.gov/portal/datasets/cp.html' },
      { label: 'Population (ACS)', key: 'acspop', cell: function (r) { return r.acsPopulation == null ? '—' : num(r.acsPopulation); },
        def: 'Total population from the Census American Community Survey, table DP05. Large places use the 1-year survey, the rest the 5-year survey.',
        src: function (d, r) { return r.acsPopulationVintage ? 'Census ' + r.acsPopulationVintage + ', DP05' : 'Census ACS, DP05'; }, url: 'https://data.census.gov/table/ACSDP5Y2024.DP05' }
    ]]
  ];
  // The rent burden check runs through the public site's own js/rent-burden-reliability.js; its two files are pinned here.
  var RBR = {}, rbrAsked = {};
  var RBR_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', insufficient: 'CHAS only' };
  function rbr(g) {
    var M = global.RentBurdenReliability;
    if (!M) return null;
    if (!rbrAsked[g]) {
      rbrAsked[g] = true;
      M.computeReliability({ geoid: g, geoType: String(g).length === 5 ? 'county' : 'place', metric: 'renter_cb30' }).then(function (rel) {
        RBR[g] = rel && rel.data_source !== 'chas_only' ? { label: RBR_LABEL[rel.combined] || RBR_LABEL.insufficient, title: (rel.notes || []).join(' ') } : null;
        Shell.render();
      }).catch(function () { RBR[g] = null; Shell.render(); });
    }
    return RBR[g];
  }
  // One table per group, a source per figure and place, then what each row means.
  function dealRows(d, recs, names) {
    var heads = '<thead><tr><th scope="col">Figure</th>' + names.map(function (n) { return '<th scope="col" class="num">' + esc(n) + '</th>'; }).join('') + '</tr></thead>';
    var tables = DEAL_GROUPS.map(function (gr) {
      return '<h3>' + esc(gr[0]) + '</h3><div class="table-scroll" role="region" aria-label="' + esc(gr[0]) + '" tabindex="0"><table class="cmp-table" data-deal-group="' + esc(gr[0]) + '"><caption class="visually-hidden">' + esc(gr[0]) + '</caption>' + heads + '<tbody>' +
        gr[1].map(function (row) {
          return '<tr><th scope="row">' + esc(row.label) + '</th>' + recs.map(function (r) { var v = row.cell(r, d); return '<td class="num" data-deal="' + esc(row.key) + '">' + (row.html ? v : esc(v == null ? '—' : v)) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
    var sources = '<details class="counted cmp-sources"><summary>Where each of these figures comes from</summary><div class="table-scroll" role="region" aria-label="Sources for the deal rows" tabindex="0"><table class="cmp-table"><caption>Source and geography for each figure</caption>' +
      heads + '<tbody>' + DEAL_GROUPS.map(function (gr) { return gr[1].map(function (row) {
        return '<tr><th scope="row">' + esc(row.label) + '</th>' + recs.map(function (r) { return '<td data-deal-src="' + esc(row.key) + '"><a href="' + esc(row.url) + '" rel="noopener">' + esc(row.src(d, r)) + '</a></td>'; }).join('') + '</tr>';
      }).join(''); }).join('') + '</tbody></table></div></details>';
    var defs = '<details class="counted cmp-defs"><summary>What each row means</summary><dl class="defs">' + DEAL_GROUPS.map(function (gr) {
      return gr[1].map(function (row) { return '<dt>' + esc(row.label) + '</dt><dd>' + esc(row.def) + '</dd>'; }).join('');
    }).join('') + '</dl></details>';
    return tables + sources + defs;
  }
  function fundingList(d, st, t, picked) {
    var F = global.FundingFit, p = R.fundingPanel(st, t, picked);
    if (!p) return '<p class="note">The funding guide did not load.</p>';
    var item = function (r, where) {
      return '<li><a href="' + esc(LIVE + F.guideUrl({ program: r.program.id })) + '" rel="noopener">' + esc(r.program.name) + '</a> <span class="note">' + esc(F.AVAILABILITY_LABELS[r.availability] + (where ? ', ' + where : '')) + '</span></li>';
    };
    return '<h3>Funding programs that fit' + (p.execution ? ' a ' + esc(F.executionLabel(p.execution)) + ' deal' : '') + '</h3>' +
      '<p class="note">Open, or with a published round, from COHO’s funding guide (as of ' + esc(d.guide.meta && d.guide.meta.as_of) + '). This screens eligibility from published terms; it does not predict an award. <a href="' + esc(LIVE + F.guideUrl({ execution: p.execution, openOnly: true })) + '" rel="noopener">Compare their terms ↗</a></p>' +
      '<details class="counted"><summary>' + p.statewide.length + ' statewide or regional programs</summary><ul class="li-items">' + p.statewide.map(function (r) { return item(r); }).join('') + '</ul></details>' +
      (p.local.length ? '<p><strong>City funds for the places picked</strong></p><ul class="li-items">' + p.local.map(function (x) { return item(x.r, x.where); }).join('') + '</ul>' : '');
  }

  function compare(params) {
    var s = load(RANK_FILES);
    if (!s.data) return waiting('Compare places', s);
    var all = s.data.ranking.rankings, by = {};
    all.forEach(function (r) { by[r.geoid] = r; });
    var picked = (params.get('g') || '').split(',').filter(function (g) { return by[g]; }).slice(0, 6);
    var q = params.get('q') || '';
    var t = CMP_TARGETS.some(function (x) { return x[0] === params.get('t'); }) ? params.get('t') : '9pct';
    // view=blend adds the picked places up as one area (site/places-combine.js); the default is side by side.
    var blend = params.get('view') === 'blend';
    var href = function (list, tt, bl) { tt = tt || t; if (bl == null) bl = blend; var qs = [list.length ? 'g=' + list.join(',') : null, tt !== '9pct' ? 't=' + tt : null, bl ? 'view=blend' : null].filter(Boolean).join('&'); return '#/places/compare' + (qs ? '?' + qs : ''); };
    var hits = q ? all.filter(function (r) { return picked.indexOf(r.geoid) < 0 && (r.name + ' ' + r.geoid).toLowerCase().indexOf(q.toLowerCase()) > -1; }).slice(0, 8) : [];
    var chips = picked.map(function (g) {
      return '<li><a href="' + esc(placeHref(g)) + '">' + esc(cleanName(by[g].name)) + '</a> <a class="chip-remove" href="' + esc(href(picked.filter(function (x) { return x !== g; }))) + '" aria-label="Remove ' + esc(cleanName(by[g].name)) + '">Remove</a></li>';
    }).join('');
    var add = picked.length < 6 ? '<div class="search cmp-add"><label for="cmp-q">Add a place</label><input id="cmp-q" name="q" type="search" autocomplete="off" data-cmp="' + esc(picked.join(',')) + '" data-cmp-t="' + esc(t) + '" value="' + esc(q) + '" placeholder="For example Fruita or Mesa County"></div>' +
      (hits.length ? '<ul class="route-list">' + hits.map(function (r) { return '<li><a href="' + esc(href(picked.concat([r.geoid]))) + '">Add ' + esc(cleanName(r.name)) + '</a><p class="note">' + esc((TYPE[r.type] || r.type) + ', ' + r.region) + '</p></li>'; }).join('') + '</ul>' : q ? '<p class="count" role="status">No matches.</p>' : '') : '<p class="note">Six places is the most this table shows.</p>';
    var table = '';
    if (picked.length) {
      var val = function (g, k) { return k === '_rank' ? by[g].rank : (by[g].metrics || {})[k]; };
      // Two shares that compare fairly across places of any size, drawn before the full table.
      var Viz = global.LabViz, shareBars = function (title, key, color) {
        return Viz && Viz.orderedBars ? Viz.orderedBars({ title: title, rows: picked.map(function (g) { return [cleanName(by[g].name), val(g, key)]; }), fmt: pct, noShare: true, color: color }) : '';
      };
      table = (picked.length > 1 ? '<div class="cmp-charts">' + shareBars('Renters paying over 30% of income on housing', 'pct_cost_burdened', 'var(--rust)') + shareBars('Share of households who rent', 'pct_renters', 'var(--c-blue)') + '</div>' : '') +
        '<div class="table-scroll" role="region" aria-label="Places compared" tabindex="0"><table class="cmp-table"><caption>Published figures for the places you picked</caption><thead><tr><th scope="col">Figure</th>' +
        picked.map(function (g) { return '<th scope="col" class="num">' + esc(cleanName(by[g].name)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        CMP_ROWS.map(function (row) {
          return '<tr><th scope="row">' + esc(row.label) + '</th>' + picked.map(function (g) { var v = val(g, row.key); return '<td class="num">' + esc(v == null ? '—' : row.fmt(v)) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (global.LabVizData ? '<p class="viz-data-csv"><a class="button-link secondary" download="coho-compare-places.csv" href="data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + global.LabVizData.csvText(['Figure'].concat(picked.map(function (g) { return cleanName(by[g].name) + ' (' + g + ')'; })),
          CMP_ROWS.map(function (row) { return [row.label].concat(picked.map(function (g) { return val(g, row.key); })); }))) + '">Download this comparison as CSV</a></p>' : '') +
        '<p class="note">Counties and places are counted the same way, so a county’s figures include its towns. A dash means the figure is not published for that place.</p>';
      // Homes per 10 renters at or below 30% AMI, the measure on the Places map.
      var per = picked.map(function (g) {
        var m = by[g].metrics || {}, h = m.low_income_households_lte30, gap = m.ami_gap_30pct;
        return { g: g, v: h > 0 && gap != null ? (h - gap) / h * 10 : null };
      });
      table += '<h2>Homes priced for the lowest-income renters</h2><p class="note">Homes priced for renters at or below 30% AMI, for every 10 such renter households.</p><ol class="rank">' + per.map(function (x) {
        return '<li><a href="' + esc(placeHref(x.g)) + '">' + esc(cleanName(by[x.g].name)) + '</a><span class="rank-bar"><span class="bar homes" style="width:' + (x.v == null ? 0 : Math.min(x.v, 10) * 10).toFixed(1) + '%" title="' + esc(cleanName(by[x.g].name) + ': ' + (x.v == null ? 'not published' : x.v.toFixed(1) + ' homes per 10 renters')) + '"></span></span><span class="bar-value">' + esc(x.v == null ? '—' : x.v.toFixed(1)) + '</span></li>';
      }).join('') + '</ol>';
    }
    // Where each figure comes from, per place. Build dates stay apart from survey periods.
    var H = global.LabHna, sums = {};
    picked.forEach(function (g) { var c = H && H.loadPlace ? H.loadPlace(g) : null; sums[g] = c && c.summary; });
    var provenance = '';
    if (picked.length) {
      var acsSeries = picked.map(function (g) { return cmpSource(CMP_ROWS[0], by[g], sums[g], s.data.ranking.metadata).series; });
      var mixed = acsSeries.filter(function (x, i) { return x && acsSeries.indexOf(x) === i; }).length > 1;
      provenance = (mixed ? '<p class="note cmp-mixed">The Census figures here are not all from the same survey: ' + picked.map(function (g) { return esc(cleanName(by[g].name)) + ' uses ' + esc(cmpSource(CMP_ROWS[0], by[g], sums[g], s.data.ranking.metadata).text); }).join('; ') + '. Large counties and places use the one-year survey, small ones the five-year survey.</p>' : '') +
        '<details class="counted cmp-sources"><summary>Where each figure comes from</summary><div class="table-scroll" role="region" aria-label="Sources by figure and place" tabindex="0"><table class="cmp-table"><caption>Survey, period and geography for each figure</caption><thead><tr><th scope="col">Figure</th>' +
        picked.map(function (g) { return '<th scope="col">' + esc(cleanName(by[g].name)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        CMP_ROWS.map(function (row) {
          return '<tr><th scope="row">' + esc(row.label) + '</th>' + picked.map(function (g) {
            var x = cmpSource(row, by[g], sums[g], s.data.ranking.metadata);
            return '<td data-src="' + esc(row.key) + '">' + esc(x.text) + ' <span class="scope-tag">' + esc(x.geo) + '</span></td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="note">The HNA ranking file these figures are read from was built ' + esc(String(s.data.ranking.metadata.generatedAt).slice(0, 10)) + '. That is when it was put together, not when the surveys were taken.</p></details>';
    }

    // The rows the public Compare adds for tax credit work, built here the same way, for every place picked (counties
    // counted by their own code). The deal type sets which funding programs fit. The deal-type scores, the overall
    // winner and the deal tracker stay with the member tools (paul 2026-11-01); qa/compare-capability-map.json lists each.
    var towns = picked.filter(function (g) { return /^\d{7}$/.test(g); }), counties = picked.filter(function (g) { return g.length === 5; });
    var modeNav = picked.length > 1 ? '<nav class="region-nav cmp-mode" aria-label="How to read the places picked"><a href="' + esc(href(picked, t, false)) + '"' + (blend ? '' : ' aria-current="true"') + '>Side by side</a>' +
      '<a href="' + esc(href(picked, t, true)) + '"' + (blend ? ' aria-current="true"' : '') + '>Blended total</a></nav>' : '';
    var full = fullCompareHref(picked, t), tLabel = CMP_TARGETS.filter(function (x) { return x[0] === t; })[0][1];
    var dealPanel = '<h2>For tax credit work: designations, pipelines, commuting and funding</h2>' +
      '<p>Pick the deal type. It sets which funding programs fit.</p>' +
      '<nav class="region-nav" aria-label="Deal type">' + CMP_TARGETS.map(function (x) {
        return '<a href="' + esc(href(picked, x[0])) + '"' + (x[0] === t ? ' aria-current="true"' : '') + '>' + esc(x[1]) + '</a>';
      }).join('') + '</nav>';
    if (picked.length) {
      var ds = load(CMP_DEAL_FILES);
      if (!ds.data) dealPanel += ds.error ? '<p class="callout">' + esc(ds.error) + '</p>' : '<p role="status" class="note">Loading the tax credit rows…</p>';
      else {
        if (!ds.st) ds.st = R.index(ds.data);
        var recs = picked.map(function (g) { return R.record(ds.st, g, t) || { geoid: g, county: g.length === 5, labor: null }; });
        dealPanel += dealRows(ds.data, recs, picked.map(function (g) { return cleanName(by[g].name); })) +
          (counties.length ? '<p class="note" data-county-note>' + esc(counties.map(function (g) { return cleanName(by[g].name); }).join(' and ')) + (counties.length > 1 ? ' are counties' : ' is a county') + ': each row counts the county’s own tracts and records by county code. Commuting and the watch list are kept for towns only, so they show “Towns only”.</p>' : '') +
          fundingList(ds.data, ds.st, t, picked);
      }
    }
    dealPanel += '<h3>Deal-type scores</h3><p class="note" data-member-scores>The 0–100 scores for each deal type, their parts and the overall winner are member tools.' +
      (full ? ' Until they move behind the member sign-in they stay on <a data-full-compare href="' + esc(full) + '" rel="noopener">the full comparison for ' + esc(towns.map(function (g) { return cleanName(by[g].name); }).join(', ')) + ', ' + esc(tLabel) + ' ↗</a>' + (counties.length ? ', which takes towns only' : '') + '.' : picked.length ? ' The full comparison takes towns and CDPs only.' : '') + '</p>';

    return T.head({
      kind: 'tool', crumbs: crumbs('Compare places'), title: 'Compare places',
      answer: 'Put up to six Colorado counties, towns or CDPs side by side on the figures the needs assessment publishes.',
      meta: '<span class="scope-tag">Scope: each place’s own figures</span> From the HNA ranking file, built ' + esc(String(s.data.ranking.metadata.generatedAt).slice(0, 10)) + '.'
    }) +
      (picked.length ? '<ul class="cmp-chips">' + chips + (picked.length > 1 ? '<li class="chip-clear"><a href="' + esc(href([])) + '">Clear all</a></li>' : '') + '</ul>' : '<p class="lede">Pick a place to start. For example <a href="' + esc(href(['0828745', '08077'])) + '">Fruita and Mesa County</a>.</p>') +
      add + modeNav + (blend && global.LabCombine ? global.LabCombine.section(picked, function (g) { return cleanName(by[g].name); }, function (g) { return by[g].type; }) : '') + table + provenance + dealPanel +
      T.source('HNA comparative ranking (Census ACS, DOLA, HUD CHAS, LEHD LODES, EPA Smart Location)', RANK_SRC, String(s.data.ranking.metadata.generatedAt).slice(0, 10)) +
      T.next('Next', [{ href: '#/places/ranking', label: 'See the full ranking →' }, { href: '#/places', label: 'Find a place', secondary: true }]);
  }
  // Typing in the add box keeps the picked places in the hash.
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el.dataset || el.dataset.cmp == null) return;
    var p = new URLSearchParams();
    if (el.dataset.cmp) p.set('g', el.dataset.cmp);
    if (el.dataset.cmpT && el.dataset.cmpT !== '9pct') p.set('t', el.dataset.cmpT);
    if (/[?&]view=blend/.test(location.hash)) p.set('view', 'blend');
    if (el.value) p.set('q', el.value);
    history.replaceState(null, '', '#/places/compare' + (String(p) ? '?' + String(p).replace(/%2C/g, ',') : ''));
    Shell.render();
  });

  // ---- Local incentives ---------------------------------------------------------------------
  var STATE = {
    records: { label: 'Verified records', tone: 'good' },
    none_found: { label: 'Checked, none found', tone: 'fair' },
    unreadable: { label: 'Source could not be read', tone: 'caution' },
    not_checked: { label: 'Not checked yet', tone: 'none' }
  };
  var SCOPE_LABEL = { fees: 'Fee relief', land_use: 'Land-use incentives', funds: 'Local funding and ownership tools' };
  // The live page's words for what Colorado law says about each tool, and its tool families.
  var LAW_STATUS = {
    authorized: 'Authorized', authorized_with_voter_approval: 'Needs voter approval', restricted: 'Restricted',
    prohibited_for_new: 'Closed to new adoption', not_usable_for_housing: 'Revenue cannot fund housing', unclear: 'Legal basis unclear',
    required_for_subject_jurisdictions: 'Required by state law in subject jurisdictions'
  };
  var FAMILY = { fee_relief: 'Fee relief', land_use: 'Land use', local_revenue: 'Local revenue', land_and_ownership: 'Land and ownership', tax_relief: 'Tax relief' };
  function requiredText(t) {
    return t.id === 'adu_by_right' ? 'HB24-1152 has required this since June 30, 2025 of every municipality with 1,000 or more people within a metropolitan planning organization, and of county areas within such an organization that lie in a census designated place of 40,000 or more.' : t.status_reason || '';
  }
  function liLink(m, id) { var g = m.geo.get(id); return '<a href="#/places/incentives/' + esc(id) + '">' + esc(g ? cleanName(g.name) : id) + '</a>'; }
  // How many places have each tool, grouped by family, then every kind of local fund counted from the records.
  function toolkit(m) {
    var D = global.LocalIncentivesData, fam = {};
    m.adoption.forEach(function (a) { (fam[a.tool.family || 'other'] = fam[a.tool.family || 'other'] || []).push(a); });
    var head = '<thead><tr><th scope="col">Tool</th><th scope="col" title="Counties and municipalities with a verified record of using the tool.">Places on record</th><th scope="col">Colorado law</th><th scope="col">Examples</th></tr></thead>';
    var out = Object.keys(FAMILY).filter(function (f) { return fam[f]; }).map(function (f) {
      return '<h3>' + esc(FAMILY[f]) + '</h3><div class="table-scroll"><table>' + head + '<tbody>' + fam[f].slice().sort(function (x, y) { return y.adopters.length - x.adopters.length; }).map(function (a) {
        var req = a.tool.colorado_status === 'required_for_subject_jurisdictions';
        return '<tr><th scope="row">' + esc(a.tool.label) + '</th><td>' + (req ? 'Required where state law applies' : num(a.adopters.length)) + '</td><td>' + esc(LAW_STATUS[a.tool.colorado_status] || a.tool.colorado_status) + '</td><td>' +
          (req ? esc(requiredText(a.tool)) : a.adopters.length ? a.adopters.slice(0, 5).map(function (id) { return liLink(m, id); }).join(', ') + (a.adopters.length > 5 ? ', and others' : '') : 'No verified record yet') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }).join('');
    var by = {};
    m.records.forEach(function (items, geoid) { items.forEach(function (i) { if (i.scope === 'funds' && D.inUse(i)) (by[i.record.tool] = by[i.record.tool] || new Set()).add(geoid); }); });
    var kinds = Object.keys(by).sort(function (a, b) { return by[b].size - by[a].size; });
    return out + (kinds.length ? '<h3>Local funding on record, by kind</h3><div class="table-scroll"><table><thead><tr><th scope="col">Kind of fund or tool</th><th scope="col">Places</th><th scope="col">Examples</th></tr></thead><tbody>' + kinds.map(function (k) {
      return '<tr><th scope="row">' + esc(D.FUND_TOOL_LABELS[k] || k) + '</th><td>' + num(by[k].size) + '</td><td>' + Array.from(by[k]).sort().slice(0, 5).map(function (id) { return liLink(m, id); }).join(', ') + (by[k].size > 5 ? ', and others' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '');
  }
  // Every tool in the catalog with its Colorado legal basis, linked to the statute or bill.
  function catalog(doc, fees) {
    var shared = {};
    (((fees || {}).meta || {}).legal_basis || []).forEach(function (b) { shared[b.id] = b; });
    return '<div class="li-catalog">' + (doc.tools || []).map(function (t) {
      var all = (t.legal_basis || []).concat((t.reuse_legal_basis_ids || []).map(function (id) { return shared[id]; }).filter(Boolean));
      var basis = all.map(function (b) { var u = /^https?:/.test((b.source || {}).url || '') ? b.source.url : ''; return u ? '<a href="' + esc(u) + '">' + esc(b.citation) + '</a>' : esc(b.citation); });
      return '<details class="counted"><summary><strong>' + esc(t.label) + '</strong> <span class="scope-tag">' + esc(LAW_STATUS[t.colorado_status] || t.colorado_status) + '</span></summary>' +
        '<p>' + esc(t.what_it_is || '') + '</p>' + (t.status_reason ? '<p>' + esc(t.status_reason) + '</p>' : '') + (t.considerations ? '<p class="note">' + esc(t.considerations) + '</p>' : '') +
        (basis.length ? '<p class="note">Colorado legal basis: ' + basis.join('; ') + '</p>' : '') + '</details>';
    }).join('') + '</div>';
  }
  var model = null;
  function liModel() {
    var s = load(LI_FILES);
    if (!s.data || !global.LocalIncentivesData) return { s: s, m: null };
    if (!model) model = global.LocalIncentivesData.build(s.data);
    return { s: s, m: model };
  }
  function pill(state) { var st = STATE[state] || STATE.not_checked; return '<span class="tier tier-' + st.tone + '">' + esc(st.label) + '</span>'; }

  // Paying impact fees over time: waive, defer or finance, and where a fee loan sits in the yearly cash flow.
  // Every claim is cited beside it; the dollar line is an illustration with its assumptions stated.
  var WATERFALL = [
    ['Operating costs and taxes', 'Management, utilities, repairs, insurance'],
    ['Replacement reserves', 'Required by the first lender and the investor'],
    ['First mortgage', 'Must-pay debt. CHFA tests it at 1.15 times coverage'],
    ['Asset management fees', 'Set in the partnership agreement'],
    ['Deferred developer fee and fee loans', 'Paid only from cash left over. A short year rolls forward, with no default', true],
    ['What is left', 'Split between the sponsor and the investor']
  ];
  var FEE_WAYS = [
    { name: 'Waive', what: 'The town never collects.', law: 'Allowed for low- and moderate-income housing (C.R.S. 29-20-104.5(5)).', credit: 'The fee leaves the building’s cost, so it earns no credit.', back: 'No.' },
    { name: 'Defer', what: 'The town collects later, on a set date.', law: 'Allowed to building permit or occupancy (C.R.S. 29-20-104.5(6)); longer by agreement.', credit: 'The fee stays a building cost.', back: 'Yes, on the date set.' },
    { name: 'Finance', what: 'The fee is paid with a loan, or turned into a note the project repays from leftover cash.', law: 'A local loan, or a council agreement to pay the fee from other funds.', credit: 'The fee stays a building cost and earns credit.', back: 'Some or all, as cash allows; often at sale or refinance.', key: true }
  ];
  function feeFinancing() {
    var QAP = 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf';
    var body = '<p>Three ways to handle an impact fee on an affordable rental:</p><div class="fee-ways">' + FEE_WAYS.map(function (w) {
      return '<section class="fee-way' + (w.key ? ' fee-way-key' : '') + '"><h3>' + esc(w.name) + '</h3><dl>' +
        '<dt>What happens</dt><dd>' + esc(w.what) + '</dd><dt>Colorado law</dt><dd>' + esc(w.law) + '</dd>' +
        '<dt>Tax credits</dt><dd>' + esc(w.credit) + '</dd><dt>Town gets its money back</dt><dd>' + esc(w.back) + '</dd></dl></section>';
    }).join('') + '</div>' +
      '<h3>Where a fee loan is paid each year</h3><p>Each year’s rent is spent in a fixed order. A fee loan sits low in it.</p>' +
      '<ol class="fee-waterfall">' + WATERFALL.map(function (w, i) {
        return '<li class="fw-step' + (w[2] ? ' fw-loan' : '') + '" style="width:' + (100 - i * 9) + '%"><strong>' + esc(w[0]) + '</strong><span>' + esc(w[1]) + '</span></li>';
      }).join('') + '</ol>' +
      '<p class="note">The order is set by the loan papers and the partnership agreement. CHFA weighs “the ability to pay deferred developer fees from cash flows” and tests “all amortized debt” at 1.15 (<a href="' + QAP + '">2027-28 QAP</a>, pp. 30 and 40).</p>' +
      '<h3>Why financing can beat a waiver</h3><p>The IRS counts impact fees as part of a building’s cost for the low-income housing tax credit (<a href="https://www.novoco.com/news/irs-releases-ruling-state-local-impact-fees-can-be-included-lihtc-eligible-basis">Rev. Rul. 2002-9</a>). A financed fee keeps earning credit; a waived fee does not. On a 4% bond deal, every $100,000 of fees kept in the building’s cost earns $40,000 of credit over ten years, about $34,000 of equity at an assumed $0.85 a credit. On a 9% deal, CHFA’s cap of $1.7 million a year often sets the credit (<a href="' + QAP + '">QAP 3.L</a>), so a waiver is usually simpler.</p>' +
      '<h3>Colorado examples</h3><ul>' +
      '<li><strong>Crested Butte, 2024.</strong> The town let Gunnison County defer $7.5 million of tap fees for the 252-home Whetstone project until 2030, then collect ten yearly payments of $751,000 (<a href="https://crestedbuttenews.com/?p=43857">Crested Butte News, 21 Aug 2024</a>).</li>' +
      '<li><strong>Fort Collins Urban Renewal Authority, 2025.</strong> A draft loan for a 76-home income-restricted rental: 3% simple interest, paid from cash flow before investors, a short year added to the balance rather than a default, and a lien behind CHFA (<a href="https://mccmeetingspublic.blob.core.usgovcloudapi.net/fortcollco-meet-35af536bad2c4504b80e91bef7aaae1b/ITEM-Attachment-002-a008a3c7fa5d4612ad5c2375bdfe8e08.pdf">term sheet</a>).</li></ul>' +
      '<p class="note">Informational only. Tax counsel and the investor decide how a fee loan is treated in a real deal.</p>';
    return T.fold('Paying fees over time', 'A town can waive, defer or finance a fee. Financing keeps the tax credits.', body, { id: 'fee-financing' });
  }

  function incentives(params, parts) {
    if (parts[2]) return jurisdiction(parts[2]);
    var x = liModel();
    if (!x.m) return waiting('Local incentives', x.s);
    var m = x.m, cov = m.coverageSummary(), meta = x.s.data.fees.meta;
    var seen = {}, rows = [];
    m.geo.forEach(function (g) {
      if (g.kind === 'cdp') return;
      var p = m.profile(g.geoid);
      if (seen[p.canonicalGeoid]) return;
      seen[p.canonicalGeoid] = true;
      rows.push({ geoid: g.geoid, name: cleanName(g.name), kind: g.kind === 'county' ? 'County' : 'Town or city', fees: STATE[p.states.fees].label, land_use: STATE[p.states.land_use].label, funds: STATE[p.states.funds].label, n: p.items.filter(global.LocalIncentivesData.inUse).length, p123: p.prop123 ? p.prop123.status : '' });
    });
    rows.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
    var adopt = m.adoption.filter(function (a) { return a.adopters.length; }).sort(function (a, b) { return b.adopters.length - a.adopters.length; });
    var amax = adopt.length ? adopt[0].adopters.length : 1;
    var cols = [
      { key: 'name', label: 'Jurisdiction', href: function (r) { return '#/places/incentives/' + r.geoid; } },
      { key: 'kind', label: 'Type' },
      { key: 'n', label: 'Tools on record', num: true, fmt: num },
      { key: 'fees', label: 'Fee relief' }, { key: 'land_use', label: 'Land use' }, { key: 'funds', label: 'Funds and taxes' },
      { key: 'p123', label: 'Prop 123 filing', tip: 'DOLA commitment filing status.' }
    ];
    // The page story (paul 11-06): what is on record so far, and the tool most places use, in one line.
    var answer = num(cov.any_records) + ' of Colorado\u2019s ' + num(cov.jurisdictions) + ' counties and towns have a verified housing tool on record so far' +
      (adopt.length ? '. The most common is ' + esc(adopt[0].tool.label.charAt(0).toLowerCase() + adopt[0].tool.label.slice(1)) + ', on record in ' + num(adopt[0].adopters.length) + ' places' : '') + '. Each record is read from the place\u2019s own code or fee schedule.';
    return T.head({
      kind: 'data', crumbs: crumbs('Local incentives'), title: 'Local incentives',
      answer: answer,
      meta: '<span class="scope-tag">Scope: counties and municipalities</span> Records as of ' + esc(meta.as_of) + '. A place with no record has not been shown to have none.',
      facts: [
        { value: num(cov.any_records), label: 'Jurisdictions with a record', source: 'Local incentives, ' + meta.as_of, href: LI_SRC },
        { value: num(cov.jurisdictions), label: 'Counties and municipalities', source: 'HNA geography list', href: LI_SRC },
        { value: num(cov.by_scope.fees.records), label: 'With fee relief on record', source: 'Local incentives, ' + meta.as_of, href: LI_SRC },
        { value: num(cov.by_scope.fees.not_checked), label: 'Not checked yet for fees', source: 'Local incentives, ' + meta.as_of, href: LI_SRC }
      ]
    }) +
      '<h2>The tools Colorado places use most</h2><ol class="rank">' + adopt.slice(0, 10).map(function (a) {
        return '<li><span>' + esc(a.tool.label) + '</span><span class="rank-bar"><span class="bar homes" style="width:' + (a.adopters.length / amax * 100).toFixed(2) + '%" title="' + esc(a.tool.label + ': ' + a.adopters.length + ' jurisdictions on record') + '"></span></span><span class="bar-value">' + esc(num(a.adopters.length)) + '</span></li>';
      }).join('') + '</ol><p class="note">Jurisdictions with a verified record in use. Many places have not been checked, so these are floors.</p>' +
      T.means([
        { text: 'Fee relief, land and local money lower what a project costs or add funds to it, and both CHFA and Prop 123 look for something local in a project.' }
      ]) +
      '<details class="fold"><summary><span class="fold-title">How to read this page</span><span class="fold-take">Where each record comes from, and what a blank means.</span></summary><div class="fold-body"><p>Each record was read from the jurisdiction’s own code, ordinance, fee schedule, ballot result or program page. A figure the source does not publish is left blank rather than estimated.</p>' +
      '<p>A jurisdiction with no record has <strong>not</strong> been shown to have no program. Every jurisdiction is marked verified records, checked and none found, source could not be read, or not checked yet.</p>' +
      '<p>Resort towns pay for workforce housing mostly with lodging and short-term rental taxes: <a href="#/research/brief/workforce-housing-without-tax-credits-2026">read the brief on local workforce housing without tax credits</a>.</p></div></details>' +
      '<h2>Coverage so far</h2><p>' + num(cov.any_records) + ' of Colorado’s ' + num(cov.jurisdictions) + ' counties and municipalities have at least one verified record so far. Coverage grows in batches, starting with the largest jurisdictions and the Prop 123 filers.</p><div class="li-coverage">' + global.LocalIncentivesData.SCOPES.map(function (sc) {
        var b = cov.by_scope[sc], tot = cov.jurisdictions;
        return '<div class="li-cov-row"><p class="li-cov-label">' + esc(SCOPE_LABEL[sc]) + '</p><div class="li-stack" role="img" aria-label="' + esc(SCOPE_LABEL[sc] + ': ' + b.records + ' with records, ' + b.none_found + ' checked with none found, ' + b.unreadable + ' unreadable, ' + b.not_checked + ' not checked') + '">' +
          ['records', 'none_found', 'unreadable', 'not_checked'].map(function (k) { return b[k] ? '<span class="li-seg li-' + k + '" style="width:' + (b[k] / tot * 100).toFixed(2) + '%" title="' + esc(STATE[k].label + ': ' + b[k]) + '"></span>' : ''; }).join('') + '</div></div>';
      }).join('') + '<ul class="legend">' + ['records', 'none_found', 'unreadable', 'not_checked'].map(function (k) { return '<li><span class="key li-' + k + '"></span>' + esc(STATE[k].label) + '</li>'; }).join('') + '</ul></div>' +
      feeFinancing() +
      '<h2>Statewide toolkit</h2><p>How many Colorado jurisdictions have a verified record of each tool. These counts cover only the jurisdictions checked so far, so they are a floor, not a census.</p>' + toolkit(m) +
      '<h2>Jurisdiction deep dive</h2><p>Open any county, city or town for its records, what state law requires of it, and tools to consider. Unincorporated communities show their county’s tools.</p>' + global.LabUI.table('incentives', 'Local housing tools on record, by jurisdiction', cols, rows, { noun: 'jurisdictions', placeholder: 'Name or type' }) +
      '<h2>Tools and what Colorado law allows</h2><p>The catalog behind the “Tools to consider” suggestions. Each tool carries its Colorado legal basis, including tools that state law closes to new local use or whose revenue cannot go to housing.</p>' + catalog(x.s.data.alternatives, x.s.data.fees) +
      '<details class="review-rules"><summary>Data sources and review rules</summary><ul>' +
      '<li>Each record names and links its source, usually the jurisdiction’s own code, ordinance, budget or program page. A record not read from the primary document is marked as reported. Jurisdictions checked and found to have none are recorded as such, not left blank.</li>' +
      '<li>Each tool’s Colorado legal basis is quoted from the statute, constitution or bill text, linked beside it.</li>' +
      '<li>Prop 123 status is built from the <a href="https://cdola.colorado.gov/commitment-filings">DOLA commitment filings</a>, verified fast-track policies and the fully compliant list; its date is shown beside every status.</li>' +
      '<li>Every record carries a re-check date. State and federal programs are in the <a href="#/money">funding pages</a>.</li>' +
      '<li>Informational only. Local codes change; the jurisdiction’s current adopted text controls.</li></ul></details>' +
      T.source('Local Housing Incentives: fee-reductions, local-housing-funds, incentive-coverage and DOLA Prop 123 filings', LI_SRC, meta.as_of) +
      T.next('What to do next', [{ href: '#/places/attract-housing', label: 'What a town can adopt first →' }, { href: '#/places/incentives/0828745', label: 'See one place: Fruita', secondary: true }, { href: '#/places', label: 'Find a place', secondary: true }]);
  }

  function itemLine(it) {
    var r = it.record, D = global.LocalIncentivesData;
    var key = String(it.tool).split(':')[1] || r.measure || r.tool;
    var what = it.scope === 'funds' ? (D.FUND_TOOL_LABELS[key] || key) : it.scope === 'land_use' ? (D.LAND_USE_LABELS[key] || key) : (D.FEE_MEASURE_LABELS[key] || key);
    var src = r.source && r.source.url ? '<a href="' + esc(r.source.url) + '">' + esc(r.source.label || 'Source') + '</a>' : '';
    return '<li class="li-item"><p class="li-what"><strong>' + esc(what) + '</strong>' + (r.provider ? ' · ' + esc(r.provider) : '') + (D.inUse(it) ? '' : ' <span class="tier tier-none">Not in use</span>') + '</p>' +
      '<p>' + esc(r.summary || r.detail || '') + '</p><p class="note">' + src + (r.last_verified ? (src ? ', ' : '') + 'checked ' + esc(r.last_verified) : '') + '</p></li>';
  }
  // What similar places use: the live page's peer block (js/local-incentives.js renderPeers), from the model's peers().
  function peerBlock(m, geoid, subject) {
    var r = m.peers ? m.peers(geoid) : null;
    if (!r || !r.basis) return '';
    var b = r.basis, nm = function (id) { var g = m.geo.get(id); return g ? cleanName(g.name) : id; };
    var how = 'Compared with up to five ' + (b.level === 'county' ? 'counties' : 'cities and towns') + ' whose sources have been read' +
      (b.typeLabel ? ', with the same market pattern (' + esc(b.typeLabel) + ')' : '') + ', within four times ' + esc(subject) + '’s population' + (b.region ? ', ' + esc(b.region) + ' first' : '') + '.';
    var out = '<section id="li-peers"><h2>What similar places use</h2><p class="note">' + how + '</p>';
    if (!r.peers.length) return out + '<p class="note">No researched place is similar enough yet. Coverage grows in batches.</p></section>';
    out += '<ul class="li-items">' + r.peers.map(function (c) {
      var n = c.tools.length;
      return '<li><a href="#/places/incentives/' + esc(c.geoid) + '">' + esc(nm(c.geoid)) + '</a> <span class="note">· ' + num(c.population) + ' people · ' +
        (n ? n + ' tool' + (n === 1 ? '' : 's') + ' on record' : 'no listed tools on record') + (c.sameRegion ? '' : ' · other region') + '</span></li>';
    }).join('') + '</ul>';
    out += r.tools.length ? '<p><strong>Used by similar places, with no record for ' + esc(subject) + ':</strong></p><ul class="li-items">' + r.tools.map(function (t) {
      return '<li><strong>' + esc(t.tool.label) + '</strong>: ' + t.peers.length + ' of ' + r.peers.length + ' (' + t.peers.map(function (id) { return '<a href="#/places/incentives/' + esc(id) + '">' + esc(nm(id)) + '</a>'; }).join(', ') + ')</li>';
    }).join('') + '</ul>' : '<p>Every tool these places have on record is already on record for ' + esc(subject) + ' too.</p>';
    return out + '<p class="note">A place’s pattern and size are a starting point, not proof that a tool fits. “No record” is not “does not have”.</p></section>';
  }
  function jurisdiction(geoid) {
    var x = liModel();
    if (!x.m) return waiting('Local incentives', x.s);
    var a = x.m.alternatives(geoid);
    if (!a) return T.head({ kind: 'data', crumbs: crumbs('Local incentives'), title: 'Not found', answer: 'No Colorado jurisdiction has the ID ' + esc(geoid) + '.' });
    var p = a.profile, name = cleanName(p.name);
    var heir = p.inheritsFrom ? x.m.geo.get(p.inheritsFrom) : null;
    var byScope = global.LocalIncentivesData.SCOPES.map(function (sc) {
      var items = p.items.filter(function (i) { return i.scope === sc; });
      return '<section class="li-scope" id="li-' + sc + '"><h2>' + esc(SCOPE_LABEL[sc]) + ' ' + pill(p.states[sc]) + '</h2>' +
        (items.length ? '<ul class="li-items">' + items.map(itemLine).join('') + '</ul>' :
          '<p class="note">' + esc(p.states[sc] === 'none_found' ? 'The official source was read and has no such measure' + (p.ledger && p.ledger.checked ? ' (checked ' + p.ledger.checked + ')' : '') + '.' : p.states[sc] === 'unreadable' ? 'The official source could not be read, so this is unknown.' : 'Nobody has checked yet. This does not mean there are none.') + '</p>') + '</section>';
    }).join('');
    var p123 = p.prop123 ? '<section id="li-p123"><h2>Prop 123 commitment</h2><p>' + esc(p.prop123.status + (p.prop123.compliance_verified && p.prop123.compliance_verified.unit_commitment ? ', verified by DOLA ' + p.prop123.compliance_verified.unit_commitment + (p.prop123.compliance_verified.required_units_met != null ? ' (' + num(p.prop123.compliance_verified.required_units_met) + ' homes required)' : '') : '') + (p.prop123.proposed_units != null ? ', ' + num(p.prop123.proposed_units) + ' homes proposed' : '') + (p.prop123.commitment_length ? ', ' + p.prop123.commitment_length : '') + (p.prop123.fast_track ? '. Fast-track review adopted' + (p.prop123.fast_track_adopted ? ' ' + p.prop123.fast_track_adopted : '') + '.' : '.')) + '</p>' + T.source('DOLA commitment filings', p.prop123.source_url, 'filed ' + p.prop123.filing_date) + '</section>' : '';
    var sugg = a.suggestions.slice(0, 8);
    var subject = heir ? cleanName(heir.name) : name, subjectId = global.LocalIncentivesData.canonicalGeoid(p.inheritsFrom || p.geoid);
    // State-required tools: covered for certain when the place is on the tool's known list, otherwise "where it applies".
    var allKnown = a.required.every(function (r) { return (r.tool.known_subject_jurisdictions || []).some(function (k) { return k.geoid === subjectId; }); });
    var required = a.required.length ? '<section id="li-required"><h2>' + (allKnown ? 'Required by state law' : 'Required by state law where it applies') + '</h2><ul class="li-items">' + a.required.map(function (r) {
      var t = r.tool, basis = (t.legal_basis || [])[0], u = basis && /^https?:/.test((basis.source || {}).url || '') ? basis.source.url : '';
      var known = (t.known_subject_jurisdictions || []).filter(function (k) { return k.geoid === subjectId; })[0];
      return '<li class="li-item"><p class="li-what"><strong>' + esc(t.label) + '</strong> <span class="scope-tag">' + esc(LAW_STATUS[t.colorado_status]) + '</span></p><p>' + esc(requiredText(t)) + ' ' +
        (known ? esc(subject) + ' is covered: ' + esc(known.basis) + (known.source && /^https:/.test(known.source.url || '') ? ' Source: <a href="' + esc(known.source.url) + '">' + esc(known.source.label || 'source') + '</a>.' : '') + ' It must already allow this; it is not a local option.' : 'If ' + esc(subject) + ' meets that definition, it must already allow this. If not, it remains a local choice.') + '</p>' +
        (u ? '<p class="note"><a href="' + esc(u) + '">' + esc(basis.citation || 'Signed act') + '</a></p>' : '') + '</li>';
    }).join('') + '</ul></section>' : '';
    var ideas = sugg.length ? '<section id="li-ideas"><h2>Tools to consider</h2><p class="note">Tools ' + esc(subject) + ' has no verified record of, ranked by use nearby and then statewide. Suggestions to investigate, not a forecast; where it has not been checked yet, it may already use them.</p><ul class="li-items">' + sugg.map(function (sg) {
      return '<li class="li-item"><p class="li-what"><strong>' + esc(sg.tool.label) + '</strong> <span class="scope-tag">' + esc(LAW_STATUS[sg.tool.colorado_status] || sg.tool.colorado_status) + '</span> · ' + esc(num(sg.adopters.length)) + ' jurisdictions' + (sg.nearby.length ? ', ' + num(sg.nearby.length) + ' nearby' : '') + '</p><p>' + esc(sg.tool.what_it_is) + '</p><p class="note">' + esc(sg.tool.status_reason || '') + '</p></li>';
    }).join('') + '</ul>' + (a.ruledOut.length ? '<p class="note">Not suggested, because of Colorado law: ' + esc(a.ruledOut.map(function (r) { return r.tool.label + ' (' + LAW_STATUS[r.tool.colorado_status] + ')'; }).join('; ')) + '. See <a href="#/places/incentives">the catalog</a>.</p>' : '') + '</section>' : '';
    var place = x.m.geo.get(geoid);
    return T.head({
      kind: 'data', crumbs: T.trail('places', name, [{ label: 'Local incentives', href: '#/places/incentives' }]), title: name,
      answer: 'Housing tools on record for ' + esc(name) + (heir ? ', a CDP, so ' + esc(cleanName(heir.name)) + '’s tools apply' : '') + '.',
      meta: global.LocalIncentivesData.SCOPES.map(function (sc) { return esc(SCOPE_LABEL[sc]) + ': ' + pill(p.states[sc]); }).join(' · ')
    }) + byScope + p123 + required + peerBlock(x.m, geoid, subject) + ideas +
      T.source('Local Housing Incentives on cohoanalytics.com', LI_SRC + '?geoid=' + geoid, x.s.data.fees.meta.as_of) +
      T.next('Next', [{ href: placeHref(place && place.kind === 'cdp' ? geoid : geoid), label: 'Housing need in ' + name + ' →' }, { href: '#/places/incentives', label: 'Every jurisdiction', secondary: true }]);
  }

  // ---- Construction costs --------------------------------------------------------------------
  // The live page's FRED series for multifamily construction inputs, rebased to January 2020, with the policy
  // timeline's dated events numbered on the line, then the live page's material cards and four charts.
  var COST_FILES = { fred: 'data/fred-data.json', timeline: 'data/policy/policy-timeline.json' };
  var COST_SERIES = 'WPUIP231120';
  var COST_SRC = LIVE + 'construction-commodities.html';
  function month(d) { var p = String(d).split('-'); return new Date(+p[0], +p[1] - 1, +(p[2] || 1)); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // ---- Material prices: the live page's cards and four charts -----------------------------------
  // Read through the site's own js/fred-commodities.js (its series list, year-on-year change and 15-month stale
  // rule), from the same data/fred-data.json. Like the live page: the latest 12 months, index values as BLS
  // publishes them (each series has its own base year), and a discontinued series shown as unavailable.
  // Its path must be in index.html's LAB_LAZY_VENDOR list, or the hosted preview does not carry it.
  var scripts = {};
  function scriptFailed(path) { return scripts[path] === 'failed'; }
  function needScript(path, test) {
    if (test()) return true;
    if (!scripts[path] && typeof document.createElement === 'function') {
      scripts[path] = 1;
      var el = document.createElement('script');
      el.src = (global.LAB_VENDOR) + path;
      el.onload = function () { Shell.render(); };
      el.onerror = function () { scripts[path] = 'failed'; Shell.render(); };
      document.body.appendChild(el);
    }
    return false;
  }
  function fredModule() { return typeof FREDCommodities !== 'undefined' ? FREDCommodities : null; } // eslint-disable-line no-undef
  // The same steps as FREDCommodities.getAllCommodities, run on the file already loaded.
  function commodities(fred) {
    var F = fredModule(), out = {};
    Object.keys(F.series).forEach(function (key) {
      var sr = F.series[key], e = fred.series && fred.series[sr.id];
      if (!e) return;
      if (e.status && e.status !== 'ok') { out[key] = Object.assign({}, sr, { status: e.status, unavailableReason: e.unavailable_reason }); return; }
      var obs = (e.observations || []).slice().reverse();
      if (!obs.length || F._isSeriesStale(obs, fred.updated)) return;
      out[key] = Object.assign({}, sr, { current: parseFloat(obs[0].value), date: obs[0].date, yoyChange: F.calculateYoYChange(obs), history: obs.slice(0, 12).reverse() });
    });
    return out;
  }
  var MAT_CARDS = ['steelMillProducts', 'softwoodLumber', 'concreteProducts', 'gypsumDrywall', 'copperWireCable', 'aluminumProducts'];
  var MAT_CHARTS = [
    ['Steel and metal products', ['steelMillProducts', 'steelRebar', 'copperWireCable']],
    ['Lumber and wood products', ['softwoodLumber', 'framingLumber', 'plywoodSheathing']],
    ['Concrete and cement', ['concreteProducts', 'portlandCement', 'readyMixConcrete']],
    ['Construction materials input PPI (composite)', ['constructionMaterialsInput']]
  ];
  var MAT_INK = ['var(--text-rust)', 'var(--text-red)', 'var(--text-blue)'];
  function fredLink(c) { return '<a href="https://fred.stlouisfed.org/series/' + esc(c.id) + '">' + esc(c.id) + '</a>'; }
  function materials(fred) {
    var ok = needScript('js/fred-commodities.js', function () { return !!fredModule(); });
    if (!ok) return scriptFailed('js/fred-commodities.js') ? '<p class="callout">The material price module did not load. The prices are on <a href="' + esc(COST_SRC) + '">the live construction costs page ↗</a>.</p>' : '<p class="note">Loading material prices…</p>';
    var d = commodities(fred);
    var cards = '<ul class="mat-cards">' + MAT_CARDS.filter(function (k) { return d[k]; }).map(function (k) {
      var c = d[k];
      if (c.status && c.status !== 'ok') return '<li class="mat-card is-off"><p class="mat-name">' + esc(c.name) + '</p><p class="mat-value">Unavailable</p><p class="note">' + esc(c.unavailableReason || c.status) + '</p><p class="metric-source">' + fredLink(c) + '</p></li>';
      var y = c.yoyChange == null ? null : parseFloat(c.yoyChange);
      return '<li class="mat-card"><p class="mat-name">' + esc(c.name) + '</p><p class="mat-value">' + esc(c.current.toFixed(2)) + '</p>' +
        '<p class="mat-yoy ' + (y > 0 ? 'up' : 'down') + '">' + (y == null ? 'Year-on-year change unavailable' : (y > 0 ? '↑ ' : y < 0 ? '↓ ' : '') + Math.abs(y).toFixed(1) + '% from a year before') + '</p>' +
        '<p class="note">Used in: ' + esc(c.impact.toLowerCase()) + '</p><p class="metric-source">Index, ' + esc(MONTHS[month(c.date).getMonth()] + ' ' + month(c.date).getFullYear()) + ' · ' + fredLink(c) + '</p></li>';
    }).join('') + '</ul>';
    var charts = MAT_CHARTS.map(function (ch) {
      var list = ch[1].map(function (k) { return d[k]; }).filter(function (c) { return c && (!c.status || c.status === 'ok') && c.history && c.history.length > 1; });
      var body = !list.length ? '<p class="callout">No current series in the data file for this group.</p>' : global.LabViz.timeLines({
        title: ch[0] + ', latest 12 months', noData: true,
        scope: '<span class="note">Producer price index values as BLS publishes them; each series has its own base year, so compare directions, not levels.</span>',
        label: 'Line chart of ' + list.map(function (c) { return c.name; }).join(', ') + ', monthly, ' + list[0].history[0].date.slice(0, 7) + ' to ' + list[0].history[list[0].history.length - 1].date.slice(0, 7) + '.',
        series: list.map(function (c, i) { return { label: c.name, color: MAT_INK[i % MAT_INK.length], points: c.history.filter(function (h) { return h.value != null && h.value !== '.'; }).map(function (h) { return [month(h.date), +h.value]; }) }; }),
        fmt: function (v) { return Number(v).toFixed(0); }, zero: false,
        source: 'Source: U.S. Bureau of Labor Statistics via FRED: ' + list.map(fredLink).join(', ') + '.'
      });
      var tbl = list.length ? '<details class="fold"><summary>Show the numbers</summary><div class="table-scroll" role="region" aria-label="' + esc(ch[0]) + ' values" tabindex="0"><table class="mat-table"><thead><tr><th scope="col">Month</th>' + list.map(function (c) { return '<th scope="col" class="num">' + esc(c.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        list[0].history.map(function (h, i) { return '<tr><th scope="row">' + esc(h.date.slice(0, 7)) + '</th>' + list.map(function (c) { var x = c.history[i]; return '<td class="num">' + esc(x && x.value != null ? (+x.value).toFixed(1) : '—') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>' : '';
      return '<section class="mat-chart"><h2>' + esc(ch[0]) + '</h2>' + body + tbl + '</section>';
    }).join('');
    var srcs = '<details class="fold"><summary>Data sources</summary><ul class="mat-sources">' + Object.keys(fredModule().series).map(function (k) {
      var c = fredModule().series[k];
      return '<li>' + esc(c.category) + ': ' + esc(c.name) + ' (' + fredLink(c) + ')' + (d[k] && d[k].status && d[k].status !== 'ok' ? ', unavailable' : '') + '</li>';
    }).join('') + '</ul><p class="note">All series from Federal Reserve Economic Data (FRED), Federal Reserve Bank of St. Louis; monthly. File updated ' + esc(String(fred.updated || '').slice(0, 10)) + '.</p></details>';
    return '<h2>Prices by material</h2><p class="note">The latest index value for six materials, and its change from a year before.</p>' + cards + charts + srcs;
  }

  // The note under the list already says every event is historical, so the per-event "this is historical" asides
  // are dropped here (paul 11-06: no defensive asides). Anything that limits what an event did stays.
  function plainDetail(t) {
    return String(t || '').replace(/\s*(This is a historical [^.]*|These are historical [^.]*|The rate is historical[^.]*)\./g, '').trim();
  }

  function costs() {
    var s = load(COST_FILES);
    if (!s.data) return waiting('Construction costs', s);
    var ser = s.data.fred.series[COST_SERIES], tl = s.data.timeline;
    var obs = (ser && ser.observations || []).filter(function (o) { return o.date >= '2020-01-01' && o.value !== '.' && o.value != null; });
    if (!obs.length) return T.head({ kind: 'data', crumbs: crumbs('Construction costs'), title: 'Construction costs' }) + '<p class="callout">The cost series is not in this copy of the data.</p>';
    var base = +obs[0].value;
    var pts = obs.map(function (o) { return [month(o.date), +o.value / base * 100]; });
    var last = obs[obs.length - 1], lastD = month(last.date), rise = (+last.value / base - 1) * 100;
    var events = tl.events.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (e, i) { return { n: i + 1, date: month(e.date), e: e }; });
    var when = MONTHS[lastD.getMonth()] + ' ' + lastD.getFullYear();
    var fredUrl = 'https://fred.stlouisfed.org/series/' + COST_SERIES;
    var chart = global.LabViz.indexLine({
      title: 'Multifamily construction prices since 2020',
      scope: '<span class="note">Index, January 2020 = 100. Numbers mark the events listed below.</span>',
      answer: 'Building materials for apartments cost ' + Math.round(rise) + '% more in ' + when + ' than in January 2020.',
      label: 'Line chart of the producer price index for multifamily construction inputs, January 2020 to ' + when + ', rising to ' + Math.round(pts[pts.length - 1][1]) + ', with ' + events.length + ' numbered policy events.',
      points: pts, events: events, base: 100,
      source: 'Source: <a href="' + esc(fredUrl) + '">U.S. Bureau of Labor Statistics via FRED, ' + esc(ser.name) + '</a>, monthly, through ' + esc(when) + '. Rebased so January 2020 = 100.'
    });
    var list = '<ol class="event-list">' + events.map(function (x) {
      var e = x.e;
      return '<li><span class="event-n" aria-hidden="true">' + x.n + '</span><div><p><strong>' + esc(e.title) + '</strong> <span class="note">' + esc(MONTHS[x.date.getMonth()] + ' ' + x.date.getDate() + ', ' + x.date.getFullYear()) + '</span></p>' +
        '<p>' + esc(plainDetail(e.detail)) + ' <a href="' + esc(e.source_url) + '">Source</a></p></div></li>';
    }).join('') + '</ol>';
    // The page story (paul 11-06): the rise since 2020 and the last year, in one line.
    var ago = obs.filter(function (o) { return o.date <= (+last.date.slice(0, 4) - 1) + last.date.slice(4); }).pop();
    var y1 = ago ? (+last.value / +ago.value - 1) * 100 : null;
    var answer = 'Apartment building materials cost ' + Math.round(rise) + '% more in ' + when + ' than in January 2020' +
      (y1 != null ? ', and ' + Math.abs(y1).toFixed(1) + '% ' + (y1 >= 0 ? 'more' : 'less') + ' than a year earlier' : '') + '.';
    var means = T.means([
      { text: 'Higher material prices raise what each home costs to build, and every added dollar has to be covered by a loan, investor equity or public money.' }
    ]);
    return T.head({
      kind: 'data', crumbs: crumbs('Construction costs'), title: 'Construction costs',
      answer: answer,
      meta: '<span class="scope-tag">Scope: United States</span> One national price index; Colorado has no state series for construction inputs.',
      facts: [
        { value: '+' + Math.round(rise) + '%', label: 'Since January 2020', source: 'BLS via FRED', href: fredUrl },
        { value: String(Math.round(pts[pts.length - 1][1])), label: 'Index, ' + when, source: 'BLS via FRED', href: fredUrl },
        { value: String(events.length), label: 'Events marked', source: 'Policy timeline', href: COST_SRC }
      ]
    }) + chart + means +
      '<h2>What happened along the way</h2>' + list +
      '<p class="note">' + esc(tl.meta.note) + ' Events checked ' + esc(tl.meta.as_of) + '. A marker shows when an event happened, not that it moved prices.</p>' +
      materials(s.data.fred) +
      T.next('What to do next', [{ href: '#/deal-calculator', label: 'Test costs in the Deal Calculator →' }, { href: '#/places/incentives', label: 'See which towns offer fee relief', secondary: true }, { href: '#/places/economy', label: 'Rates, permits and jobs', secondary: true }]);
  }

  var SUB = { ranking: ranking, compare: compare, incentives: incentives, costs: costs };
  var hub = Shell.views.places;
  Shell.views.places = function (params, parts) {
    var f = parts && SUB[parts[1]];
    return f ? f(params, parts) : hub(params, parts);
  };
  global.LabPlacesMore = { CMP_DEAL_FILES: CMP_DEAL_FILES, DEAL_GROUPS: DEAL_GROUPS, CMP_TARGETS: CMP_TARGETS, fullCompareHref: fullCompareHref, cmpSource: cmpSource, RANK_FILES: RANK_FILES, RANKING_VIEW_FILES: RANKING_VIEW_FILES, LENSES: LENSES, COMMIT_DIMS: COMMIT_DIMS, COST_FILES: COST_FILES, LI_FILES: LI_FILES, ranking: ranking, compare: compare, incentives: incentives, jurisdiction: jurisdiction, CMP_ROWS: CMP_ROWS };
})(window);
