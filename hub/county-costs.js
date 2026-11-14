// Wave 2, ticket 2C: two Places pages rebuilt from the files the live pages read.
//   #/places/county-costs?m=&county=   Housing costs by county (live: article-co-housing-costs.html). The article's
//                                      county table (assets/co-housing-costs/snapshots/co_county_indicators_full.csv),
//                                      its driver ranking (drivers_ranking.csv), FRED for the state price index and
//                                      the construction price series, BLS QCEW for statewide construction pay,
//                                      NLIHC Out of Reach for the rent snapshot, and the needs assessment's ranking.
//   #/places/multifamily?g=            Multifamily lens (live: census-dashboard.html). The live page's own files:
//                                      data/census-multifamily-co.json, data/multifamily-inventory-co.json, and each
//                                      place's stored ACS profile (data/hna/summary/{geoid}.json) labelled with the
//                                      series in data/hna/acs-reliability.json, as js/census-multifamily.js reads them.
// places-state.js routes both pages here and lends its county map.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI, Viz = global.LabViz;
  var esc = Shell.esc, num = UI.num, money = UI.money;
  var LIVE = 'https://cohoanalytics.com/';
  var VENDOR = function () { return global.LAB_VENDOR; };
  var C = Viz.COLORS;

  // ---------- loading: JSON and CSV, one load per set of files ----------
  function csv(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    var head = rows.shift() || [];
    return rows.filter(function (r) { return r.length > 1 || r[0] !== ''; }).map(function (r) {
      var o = {}; head.forEach(function (h, j) { o[h] = r[j] == null ? '' : r[j]; }); return o;
    });
  }
  var sets = {};
  function load(files) {
    var keys = Object.keys(files), id = keys.map(function (k) { return files[k]; }).join('|'), s = sets[id];
    if (s) return s;
    s = sets[id] = { data: null, error: null };
    Promise.all(keys.map(function (k) {
      return fetch(VENDOR() + files[k]).then(function (r) {
        if (!r.ok) throw new Error(files[k] + ' ' + r.status);
        return /\.csv$/.test(files[k]) ? r.text().then(csv) : /\.html$/.test(files[k]) ? r.text() : r.json();
      });
    })).then(function (all) { s.data = {}; keys.forEach(function (k, i) { s.data[k] = all[i]; }); Shell.render(); })
      .catch(function (e) { s.error = 'The data did not load (' + e.message + ').'; Shell.render(); });
    return s;
  }
  function waiting(title, s) {
    return T.head({ kind: 'data', crumbs: T.trail('places', title), title: title }) +
      (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading the data…</p>');
  }

  var n = function (v) { if (v == null || v === '') return null; var x = Number(v); return isFinite(x) && x > -1e8 ? x : null; };
  var pct1 = function (v) { return v == null ? null : (Math.round(v * 10) / 10).toFixed(1) + '%'; };
  var pct0 = function (v) { return v == null ? null : Math.round(v) + '%'; };
  var signed = function (v) { return v == null ? null : (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1) + '%'; };
  var cleanName = function (s) { return String(s || '').replace(/,\s*Colorado$/, '').replace(/ \((city|town|CDP)\)$/i, ''); };
  var countyOnly = function (s) { return cleanName(s).replace(/ County$/, ''); };
  function link(text, href) { return '<a href="' + esc(href) + '">' + esc(text) + '</a>'; }
  function list(items) { return '<ul>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
  function section(id, title, body, level) {
    var h = level || 2;
    return '<section class="cc-sec" aria-labelledby="' + id + '"><h' + h + ' id="' + id + '" tabindex="-1">' + esc(title) + '</h' + h + '>' + body + '</section>';
  }
  // A part folded on the long page: its title and one-line answer show, the full part opens on tap (LabTpl.fold).
  function foldSec(id, title, take, body, level) {
    return T && T.fold ? T.fold(esc(title), esc(take), body, { id: id, level: level || 2 }) : section(id, title, body, level);
  }
  // The answer line for one measure's folded part: the highest and lowest county.
  function endsTake(rows, M) {
    var have = rows.filter(function (r) { return M[3](r) != null; }).sort(function (a, b) { return M[3](b) - M[3](a); });
    if (!have.length) return 'No county has a figure.';
    var hi = have[0], lo = have[have.length - 1], unit = M[0] === 'permits' ? ' a year per 1,000 people' : '';
    return 'Highest in ' + hi.county + ' County (' + M[4](M[3](hi)) + unit + '), lowest in ' + lo.county + ' County (' + M[4](M[3](lo)) + unit + ').';
  }
  function card(label, value, detail, src) {
    return '<div class="metric"><p class="metric-label">' + esc(label) + '</p><p class="metric-value">' + esc(value == null ? '—' : value) + '</p>' +
      (detail ? '<p class="metric-detail">' + esc(detail) + '</p>' : '') + (src ? '<p class="metric-source">' + src + '</p>' : '') + '</div>';
  }
  function chips(label, items, on, hrefOf) {
    return '<nav class="dm-chips" aria-label="' + esc(label) + '"><p class="cc-chip-label">' + esc(label) + '</p><ul>' + items.map(function (c) {
      return '<li><a href="' + esc(hrefOf(c[0])) + '"' + (c[0] === on ? ' class="is-on" aria-current="true"' : '') + '>' + esc(c[1]) + '</a></li>';
    }).join('') + '</ul></nav>';
  }
  function q(route, params, sets) {
    var p = new URLSearchParams(params);
    Object.keys(sets).forEach(function (k) { if (sets[k] == null || sets[k] === '') p.delete(k); else p.set(k, sets[k]); });
    p.delete('at');
    var x = p.toString(); return '#/places/' + route + (x ? '?' + x : '');
  }
  function quarter(d) { var p = String(d).split('-'); return 'Q' + (Math.floor((+p[1] - 1) / 3) + 1) + ' ' + p[0]; }

  // ====================================================================================================
  // Housing costs by county
  // ====================================================================================================
  var CC_SRC = LIVE + 'article-co-housing-costs.html';
  var SNAP = 'assets/co-housing-costs/snapshots/';
  var CC_FILES = {
    ind: SNAP + 'co_county_indicators_full.csv', drivers: SNAP + 'drivers_ranking.csv', status: SNAP + 'pipeline-status.json',
    qcew: 'data/co-housing-costs/qcew_construction_state.json', fred: 'data/fred-data.json', oor: 'data/affordable-housing/nlihc-out-of-reach-co.json',
    w10: 'assets/co-housing-costs/maps/co_county_rent_change_10y_win.html', w15: 'assets/co-housing-costs/maps/co_county_rent_change_15y_win.html',
    acs: 'data/census-acs-state.json', ranking: 'data/hna/ranking-index.json', permits: 'data/hna/permits.json', b: 'data/boundaries/counties_co.geojson',
    cdemo: 'data/co-county-demographics.json', // homes per county, for the map kit's thin-data mark
    ct: 'data/co-housing-costs/county-trends.json' // ACS cohorts and FHFA index per county, for the change map
  };
  var SRC = {
    acs: ['Census ACS 2020–2024 five-year', 'https://data.census.gov/table/ACSDT5Y2024.B25064?g=040XX00US08$0500000'],
    b25070: ['Census ACS B25070', 'https://data.census.gov/table/ACSDT5Y2024.B25070?g=040XX00US08$0500000'],
    b25002: ['Census ACS B25002', 'https://data.census.gov/table/ACSDT5Y2024.B25002?g=040XX00US08$0500000'],
    fhfa: ['FHFA House Price Index', 'https://www.fhfa.gov/data/hpi'],
    costhpi: ['FHFA via FRED, COSTHPI', 'https://fred.stlouisfed.org/series/COSTHPI'],
    qcew: ['BLS QCEW, NAICS 23', 'https://www.bls.gov/cew/'],
    bps: ['Census Building Permits Survey', 'https://www.census.gov/construction/bps/'],
    ppi: ['BLS Producer Price Index', 'https://www.bls.gov/ppi/'],
    oor: ['NLIHC Out of Reach 2026, Colorado', 'https://nlihc.org/oor/state/co']
  };
  var srcLink = function (k) { return link(SRC[k][0], SRC[k][1]); };

  // The measures the map can show. Live: the article's eight maps (rent, burden, vacancy, 10- and 15-year rent change,
  // FHFA 10-year, construction pay, permits per person). Kept from the earlier lab page: income, home value, value to
  // income, homes for rent or sale, apartments in permits. Each: [id, label, group, value(row), format, what it is].
  var MEASURES = [
    ['rent', 'Median rent', 'now', function (r) { return r.rent; }, money, 'Median gross rent (rent plus utilities), ACS 2020–2024 five-year, table B25064'],
    ['burden', 'Renters paying 30%+', 'now', function (r) { return r.burden; }, pct1, 'Renter households paying 30% or more of income on rent (B25070). Renters with no cash rent or no income are left out, as Census and HUD do.'],
    ['vacancy', 'Vacancy rate', 'now', function (r) { return r.vacancy; }, pct1, 'Vacant homes of all homes (B25002), seasonal and second homes included'],
    ['forsale', 'Homes for rent or sale', 'now', function (r) { return r.forsale; }, pct1, 'Vacant homes for rent or for sale only, of all homes (B25004); seasonal homes left out'],
    ['income', 'Median income', 'now', function (r) { return r.income; }, money, 'Median household income, ACS 2020–2024 five-year (B19013)'],
    ['value', 'Median home value', 'now', function (r) { return r.value; }, money, 'Median value of owner-occupied homes, ACS five-year, as the needs assessment reads it'],
    ['ratio', 'Home value to income', 'now', function (r) { return r.ratio; }, function (v) { return v.toFixed(1) + '×'; }, 'Median home value divided by median household income'],
    ['hpi10', 'Home prices, 10 years', 'change', function (r) { return r.hpi10; }, signed, 'Change in the FHFA all-transactions house price index, 2015 to 2025. FHFA publishes no index for the smallest counties.'],
    ['wages', 'Construction pay', 'build', function (r) { return r.wages; }, money, 'Average annual pay in construction (NAICS 23), BLS QCEW 2025. BLS withholds it where a county has too few employers.'],
    ['permits', 'Permits per 1,000 people', 'build', function (r) { return r.permits; }, function (v) { return v.toFixed(1); }, 'Homes permitted a year, five-year average 2021–2025, per 1,000 residents (Census Building Permits Survey)'],
    ['mf', 'Apartments in permits', 'build', function (r) { return r.mf; }, pct1, 'Share of homes permitted in the last five years in buildings of two or more']
  ];
  var GROUPS = [['now', 'Costs today'], ['change', 'Change over time'], ['build', 'Building and construction']];

  function ccRows(d) {
    var rank = {}, rl = Array.isArray(d.ranking.rankings) ? d.ranking.rankings : Object.keys(d.ranking.rankings).map(function (k) { return d.ranking.rankings[k]; });
    rl.forEach(function (x) { if (x.type === 'county') rank[x.geoid] = x; });
    return d.ind.map(function (c) {
      var k = c.county_fips, m = (rank[k] || {}).metrics || {}, p = d.permits.counties[k];
      var mf = null;
      if (p && p.units_total) {
        var t = p.units_total.slice(-5), f = (p.units_mf || []).slice(-5), tt = t.reduce(function (a, b) { return a + (b || 0); }, 0);
        mf = tt ? f.reduce(function (a, b) { return a + (b || 0); }, 0) / tt * 100 : null;
      }
      var burdenU = n(c.rent_burden_universe), burdened = n(c.renters_burdened_30_plus);
      return {
        key: k, county: countyOnly(c.county_name), pop: n(c.population),
        rent: n(c.median_gross_rent), income: n(c.median_hh_income),
        burden: n(c.rent_burden_30_plus) == null ? null : n(c.rent_burden_30_plus) * 100,
        burdenU: burdenU, burdened: burdened,
        vacancy: n(c.vacancy_rate) == null ? null : n(c.vacancy_rate) * 100,
        forsale: n(m.vacancy_rate_pct), value: n(m.median_home_value), ratio: n(m.home_value_to_income),
        hnaRent: n(m.gross_rent_median), acsYear: n(c.acs_year),
        hpi10: n(c.fhfa_hpi_change_10y) == null ? null : n(c.fhfa_hpi_change_10y) * 100, hpiFrom: c.fhfa_base_year, hpiTo: c.fhfa_latest_year,
        wages: n(c.qcew_avg_annual_wage), wageYear: c.qcew_year,
        permits: n(c.bps_permits_per_1k_5yr_avg), permitsAvg: n(c.bps_permits_5yr_avg_units), bpsFrom: c.bps_first_year, bpsTo: c.bps_last_year,
        mf: mf
      };
    });
  }

  function fredObs(fred, id) {
    var s = fred.series[id];
    return s ? (s.observations || []).filter(function (o) { return o.value !== '.' && o.value != null && o.value !== ''; }).map(function (o) { return { date: o.date, v: +o.value }; }) : [];
  }
  function at(obs, date) { var x = obs.filter(function (o) { return o.date === date; })[0]; return x ? x.v : null; }
  function yearBack(date, k) { var p = date.split('-'); return (+p[0] - k) + '-' + p[1] + '-' + p[2]; }

  // Highest and lowest counties for one measure, as two short bar lists side by side. Both lists use one neutral
  // slate (7.6:1 on white): a high rent or a high cost burden is never drawn in green, which reads as good
  // (graphics checklist C4). The list titles say which end is which.
  var ENDS = 'var(--slate)';
  function ends(rows, M, k, built) {
    var have = rows.filter(function (r) { return M[3](r) != null; }).sort(function (a, b) { return M[3](b) - M[3](a); });
    if (!have.length) return '';
    var top = have.slice(0, k), low = have.slice(-k).reverse();
    var bars = function (title, xs, color) {
      return Viz.orderedBars({ title: title, rows: xs.map(function (r) { return [r.county, M[3](r)]; }), noShare: true, fmt: M[4], color: color });
    };
    return '<div class="cc-ends">' + bars('Highest ' + k + ': ' + M[1].toLowerCase(), top, ENDS) + bars('Lowest ' + k + ': ' + M[1].toLowerCase(), low, ENDS) + '</div>' +
      '<p class="note">' + esc(have.length + ' of 64 counties have a figure. ' + M[5].replace(/\.$/, '') + '.') + ' ' + link('Map it →', '#/places/county-costs?m=' + M[0] + '&at=cc-map') + '</p>' +
      '<p class="metric-source">' + measureSource(M, rows, built) + '</p>';
  }
  var byId = function (id) { return MEASURES.filter(function (m) { return m[0] === id; })[0]; };
  // Each measure's own source line, dated (format rule, 12 Nov: a dated source on every figure). The years come
  // from the indicator file's own columns, and "built" is when the costs pipeline last ran (pipeline-status.json).
  var MSRC = { rent: ['acs', 'B25064'], burden: ['b25070', ''], vacancy: ['b25002', ''], forsale: ['acs', 'B25004, as the needs assessment reads it'],
    income: ['acs', 'B19013'], value: ['acs', 'median home value, as the needs assessment reads it'], ratio: ['acs', 'home value over household income, as the needs assessment reads it'],
    hpi10: ['fhfa', ''], wages: ['qcew', ''], permits: ['bps', ''], mf: ['bps', 'buildings of two or more homes'] };
  function measureSource(M, rows, built) {
    var x = MSRC[M[0]] || ['acs', ''], r = rows.filter(function (y) { return M[3](y) != null; })[0] || rows[0] || {};
    var years = x[0] === 'fhfa' ? (r.hpiFrom && r.hpiTo ? r.hpiFrom + ' to ' + r.hpiTo : '') : x[0] === 'qcew' ? (r.wageYear ? String(r.wageYear) : '') :
      x[0] === 'bps' ? (r.bpsFrom && r.bpsTo ? r.bpsFrom + '\u2013' + r.bpsTo : '') : (r.acsYear ? 'ACS ' + (r.acsYear - 4) + '\u2013' + r.acsYear + ' five-year' : '');
    var what = [years, x[1]].filter(Boolean).join(', ');
    return 'Source: ' + link(SRC[x[0]][0], SRC[x[0]][1]) + (what ? ', ' + esc(what) : '') + (built ? '. Built ' + esc(built) : '') + '.';
  }

  // The driver ranking as a two-sided bar: right pushes price growth up, left pulls it down.
  function driverBars(rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.c); })) || 1;
    return '<figure class="viz cc-drivers"><figcaption><strong>How strongly each factor tracks 10-year home price growth</strong>' +
      '<span class="viz-answer">' + esc(rows[0].f + ' carries the most weight; ' + rows.filter(function (r) { return r.c < 0; }).map(function (r) { return r.f.toLowerCase(); }).join(' and ') + (rows.some(function (r) { return r.c < 0; }) ? ' points the other way.' : '.')) + '</span></figcaption>' +
      '<ol class="cc-dv">' + rows.map(function (r, i) {
        var w = Math.abs(r.c) / max * 100;
        return '<li><span class="cc-dv-n">' + (i + 1) + '</span><span class="cc-dv-f">' + esc(r.f) + '</span>' +
          '<span class="cc-dv-track"><span class="cc-dv-bar ' + (r.c < 0 ? 'is-neg' : 'is-pos') + '" style="width:' + (w / 2).toFixed(1) + '%"></span></span>' +
          '<span class="cc-dv-v">' + (r.c > 0 ? '+' : '') + r.c.toFixed(4) + '</span></li>';
      }).join('') + '</ol><p class="note">Bars to the right: counties with more of this saw faster price growth. To the left: slower. Coefficients are on a unit-free scale.</p></figure>';
  }

  function countyCosts(params) {
    var title = 'Housing costs by county', s = load(CC_FILES);
    if (!s.data) return waiting(title, s);
    var d = s.data, rows = ccRows(d), PS = global.LabPlacesState;
    var M = byId(params.get('m') || 'rent') || MEASURES[0], picked = params.get('county');
    var built = String(d.status.generated || '').slice(0, 10);
    var have = rows.filter(function (r) { return M[3](r) != null; }).sort(function (a, b) { return M[3](b) - M[3](a); });

    // State figures for the snapshot and key findings.
    var hpi = fredObs(d.fred, 'COSTHPI'), last = hpi[hpi.length - 1], prevQ = hpi[hpi.length - 2];
    var yoy = function (o) { var b = o && at(hpi, yearBack(o.date, 1)); return b ? (o.v / b - 1) * 100 : null; };
    var y1 = yoy(last), y0 = yoy(prevQ), q4 = hpi.filter(function (o) { return /-10-01$/.test(o.date); }).pop();
    var q4b = q4 && at(hpi, yearBack(q4.date, 10)), hpi10 = q4 && q4b ? (q4.v / q4b - 1) * 100 : null;
    var oor = d.oor.state_summary || {}, co = (d.acs.data || []).filter(function (r) { return r.state_fips === '08'; })[0] || {};
    var bU = rows.reduce(function (t, r) { return t + (r.burdenU || 0); }, 0), bB = rows.reduce(function (t, r) { return t + (r.burdened || 0); }, 0);
    var qw = d.qcew.avg_annual_pay || {}, qy = Object.keys(qw).sort(), qa = qw[qy[0]], qb = qw[qy[qy.length - 1]];
    // Plain names for the model's factor labels (paul 11-06: no column names on a public page).
    var PLAIN = { 'Vacancy rate': 'Vacancy rate', 'Rent burden \u226530% share': 'Share of renters paying 30%+', 'Permits per capita (5yr avg)': 'Homes permitted per resident, 5-year average',
      'Median income growth (10y)': 'Household income growth, 10 years', 'Avg construction wages': 'Construction pay' };
    var drivers = d.drivers.map(function (r) { return { f: PLAIN[r.feature] || r.feature, c: +r.coefficient, src: r.source }; }).filter(function (r) { return isFinite(r.c); });
    var flat = y1 != null && Math.abs(y1) < 1 && y0 != null && Math.abs(y0) < 1;
    var snapYear = last ? last.date.slice(0, 4) : '';

    var snapshot = section('cc-snap', snapYear + ' snapshot: ' + (flat ? 'prices flat, rents still out of reach' : 'prices and rents'),
      '<p>The Federal Housing Finance Agency’s quarterly price index for Colorado was ' + esc(signed(y1)) + ' year over year in ' + esc(quarter(last.date)) + ' (' + esc(last.v.toFixed(2)) + ' against ' + esc((at(hpi, yearBack(last.date, 1)) || 0).toFixed(2)) + ' a year earlier) and ' + esc(signed(y0)) + ' in ' + esc(quarter(prevQ.date)) + (flat ? ', so statewide prices have been about flat for a year.' : '.') +
      ' Rents have not followed. A two-bedroom at Fair Market Rent costs ' + esc(money(oor.fmr_2br)) + ' a month in Colorado, which takes ' + esc('$' + (oor.two_br_housing_wage || 0).toFixed(2)) + ' an hour full time to afford: well above minimum wage (' + esc('$' + (oor.minimum_wage_used || 0).toFixed(2)) + ') and the average renter’s wage (' + esc('$' + (oor.renter_mean_hourly_wage || 0).toFixed(2)) + ').</p>' +
      '<div class="metrics">' + card('Colorado home prices, one year', signed(y1), quarter(last.date), srcLink('costhpi')) +
      card('Two-bedroom Fair Market Rent', money(oor.fmr_2br), 'A month, 2026', srcLink('oor')) +
      card('Wage needed for a two-bedroom', '$' + (oor.two_br_housing_wage || 0).toFixed(2), 'An hour, 40 hours a week', srcLink('oor')) + '</div>');

    // Median rent and the 30%+ share are in the page head; they are not repeated here (paul 10-20: remove duplicates).
    // The old lead said costs rose faster than incomes, with no income figure on the page; it now says only what the cards show.
    var findings = section('cc-key', 'Ten years of change',
      '<p>Statewide, home prices and construction pay have both climbed over ten years. Median rent is ' + esc(money(co.median_gross_rent)) + ' a month (ACS ' + (co.year - 4) + '\u2013' + co.year + ', B25064), and ' + esc(num(bB)) + ' of ' + esc(num(bU)) + ' renter households whose burden Census computes pay 30% or more of income.</p>' +
      '<div class="metrics">' +
      card('Home prices, 10 years', hpi10 == null ? null : '+' + hpi10.toFixed(1) + '%', quarter(yearBack(q4.date, 10)) + ' to ' + quarter(q4.date) + ': ' + q4b.toFixed(2) + ' to ' + q4.v.toFixed(2), srcLink('costhpi')) +
      card('Construction pay', qa && qb ? '+' + ((qb / qa - 1) * 100).toFixed(1) + '%' : null, qy[0] + ' to ' + qy[qy.length - 1] + ': ' + money(qa) + ' to ' + money(qb) + ' a year', srcLink('qcew')) +
      card('Strongest predictor of price growth', drivers[0] && drivers[0].f, drivers.length ? 'Then ' + drivers.slice(1).map(function (r) { return r.f.toLowerCase() + (r.c < 0 ? ' (negative)' : ''); }).join(', ') : '', link('Driver ranking below', '#/places/county-costs?at=cc-model')) +
      '</div><p class="callout"><strong>Small counties: read with care.</strong> ACS five-year figures carry margins of error that can be large in counties under 5,000 people. The maps do not show those margins.</p>');

    // The map, with the measure chips grouped, and the picked county's figures.
    var map = PS.countyMap({
      features: d.b.features, picked: picked,
      value: function (k) { var r = rows.filter(function (x) { return x.key === k; })[0]; return r ? M[3](r) : null; },
      label: function (k, v) { return v == null ? 'not published' : M[4](v); },
      href: function (k) { return q('county-costs', params, { county: k }); },
      thin: K.thinSet(d.cdemo, d.b.features), fmt: M[4],
      kicker: M[1] + ', by county', title: have.length ? M[1] + ' is highest in ' + have[0].county + ' County (' + M[4](M[3](have[0])) + ') and lowest in ' + have[have.length - 1].county + ' County (' + M[4](M[3](have[have.length - 1])) + ')' : M[1] + ', by county',
      note: M[5] + '. Select a county for its figures.', source: measureSource(M, rows, built)
    });
    var pr = picked && rows.filter(function (r) { return r.key === picked; })[0], pp = picked && d.permits.counties[picked], py = d.permits.years || [];
    var detail = !pr ? '' : '<section class="cc-detail" aria-labelledby="cc-h"><h3 id="cc-h">' + esc(pr.county) + ' County</h3><div class="metrics">' +
      MEASURES.map(function (m) { return card(m[1], m[3](pr) == null ? '—' : m[4](m[3](pr))); }).join('') + '</div>' +
      (pr.hnaRent != null && pr.hnaRent !== pr.rent ? '<p class="note">The needs assessment shows ' + esc(money(pr.hnaRent)) + ' for median rent: for counties of 65,000 people or more it reads the one-year survey, which is newer. This page uses the five-year survey for every county, so all 64 compare on the same years.</p>' : '') +
      (pp ? UI.bars('Homes permitted each year', 'Census Building Permits Survey; ' + py[0] + ' to ' + py[py.length - 1], py.map(function (y, i) { return [String(y), pp.units_total[i]]; }), num, 'homes') : '') +
      '<p><a href="' + esc(q('county-costs', params, { county: null })) + '">← All counties</a> · <a href="#/place/' + esc(picked) + '">Needs assessment for ' + esc(pr.county) + ' County →</a></p></section>';
    var mapSec = section('cc-map', 'Interactive county maps',
      '<p>Pick a measure, then a county. The figures are rebuilt each month from the sources below.</p>' +
      GROUPS.map(function (g) {
        return chips(g[1], MEASURES.filter(function (m) { return m[2] === g[0]; }).map(function (m) { return [m[0], m[1]]; }), M[0], function (k) { return q('county-costs', params, { m: k === 'rent' ? null : k }); });
      }).join('') +
      UI.intro('Where is ' + M[1].toLowerCase() + ' highest?', have.length ? M[1] + ' is highest in ' + have[0].county + ' County (' + M[4](M[3](have[0])) + ') and lowest in ' + have[have.length - 1].county + ' County (' + M[4](M[3](have[have.length - 1])) + '). ' + have.length + ' of 64 counties have a figure.' : 'No county has a figure for this measure.') +
      map + detail + (picked ? '' : ends(rows, M, 5, built)));

    var current = section('cc-now', 'Current housing cost indicators (2020–2024 ACS)',
      '<p>Rent, the share of renters stretched by it, and how many homes sit empty. Low vacancy in Front Range and resort counties keeps pressure on rents.</p>' +
      foldSec('cc-rent', 'Median gross rent by county', endsTake(rows, byId('rent')), '<p>Resort counties such as Pitkin, Eagle and Summit have the highest rents.</p>' + ends(rows, byId('rent'), 5, built), 3) +
      foldSec('cc-burden', 'Rent burden (share of renters paying 30% or more of income)', endsTake(rows, byId('burden')), '<p>Higher shares mean more renters stretched by housing costs.</p>' + ends(rows, byId('burden'), 5, built), 3) +
      foldSec('cc-vac', 'Vacancy rate by county', endsTake(rows, byId('vacancy')), '<p>This counts every vacant home, second homes included, so resort counties run high. For homes actually on the market, map <a href="#/places/county-costs?m=forsale&amp;at=cc-map">homes for rent or sale</a>.</p>' + ends(rows, byId('vacancy'), 5, built), 3));

    var windows = section('cc-win', '10-year and 15-year windowed change',
      '<p>Rent change between survey windows that do not overlap: 2020–2024 (now), 2010–2014 (10 years back) and 2005–2009 (15 years back). Change is the later median divided by the earlier one, less one.</p>' +
      foldSec('cc-win10', 'Rent change: 10-year window (2014 to 2024 cohorts)', 'County map of median rent, 2010–2014 against 2020–2024.', rentWindow(d.w10, d.b, 10, '2010–2014', K.thinSet(d.cdemo, d.b.features)), 3) +
      foldSec('cc-win15', 'Rent change: 15-year window (2009 to 2024 cohorts)', 'County map of median rent, 2005–2009 against 2020–2024.', rentWindow(d.w15, d.b, 15, '2005–2009', K.thinSet(d.cdemo, d.b.features)), 3));

    var changeSec = section('cc-change', 'Where it is getting worse', changeMap(d, params));

    var hpiSec = section('cc-hpi', 'FHFA House Price Index appreciation',
      '<p>FHFA’s index follows the same homes as they resell, so it measures price change without relying on the survey. It covers only counties with enough sales.</p>' +
      foldSec('cc-hpi10', 'FHFA HPI 10-year change by county', endsTake(rows, byId('hpi10')), '<p>Front Range and mountain resort counties lead.</p>' + ends(rows, byId('hpi10'), 5, built), 3));

    // Construction input prices: the five series the article charts, from the site's FRED file, each set to 100 in
    // January 2015 so they share one axis.
    var PPI = [['WPUIP231120', 'Inputs to multifamily construction', C.homes], ['WPUIP2312001', 'Inputs to nonresidential construction, goods', C.pine],
      ['PCU331110331110', 'Iron and steel mills', C.households], ['PCU327310327310', 'Cement manufacturing', C.blue], ['PCU331315331315', 'Aluminum sheet, plate and foil', C.purple]];
    var series = PPI.map(function (p) {
      var o = fredObs(d.fred, p[0]).filter(function (x) { return x.date >= '2015-01-01'; }), base = o.length ? o[0].v : null;
      return { id: p[0], label: p[1], color: p[2], status: (d.fred.series[p[0]] || {}).status, last: o[o.length - 1], points: base ? o.map(function (x) { var y = x.date.split('-'); return [new Date(+y[0], +y[1] - 1, 1), x.v / base * 100]; }) : [] };
    }).filter(function (x) { return x.points.length > 1; });
    var mfS = series[0], gone = series.filter(function (x) { return x.status === 'discontinued'; });
    var whenOf = function (x) { var y = x.last.date.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+y[1] - 1] + ' ' + y[0]; };
    var ppiChart = Viz.timeLines({
      title: 'Construction input prices since 2015', scope: '<span class="note">Index, January 2015 = 100</span>', zero: false,
      answer: mfS ? 'Materials for apartment buildings cost ' + Math.round(mfS.points[mfS.points.length - 1][1] - 100) + '% more in ' + whenOf(mfS) + ' than in January 2015.' : '',
      label: 'Line chart of five producer price indexes for construction inputs, January 2015 = 100',
      series: series, fmt: function (v) { return String(Math.round(v)); },
      note: gone.length ? gone.map(function (x) { return x.label + ' ends ' + whenOf(x) + ': BLS discontinued the series.'; }).join(' ') : '',
      source: 'Source: ' + srcLink('ppi') + ' via FRED (' + series.map(function (x) { return link(x.id, 'https://fred.stlouisfed.org/series/' + x.id); }).join(', ') + '), monthly. Each series set to 100 in January 2015.'
    });
    var stateWage = qb ? '<p>Statewide, average pay in private construction was ' + esc(money(qb)) + ' in ' + esc(qy[qy.length - 1]) + ', up from ' + esc(money(qa)) + ' in ' + esc(qy[0]) + '.</p>' : '';
    var costSec = section('cc-cost', 'Construction and development cost pressure',
      '<p>Demand is not the only cause of rising housing costs. Rising material prices and wages, and slow permitting, push costs up too.</p>' +
      foldSec('cc-ppi', 'BLS Producer Price Index: construction inputs', mfS ? 'Materials for apartment buildings cost ' + Math.round(mfS.points[mfS.points.length - 1][1] - 100) + '% more in ' + whenOf(mfS) + ' than in January 2015.' : 'Five construction input price series since 2015.', '<p>When these prices rise quickly, the cost of each new home rises with them.</p>' + ppiChart + '<p>' + link('Construction costs since 2020, with policy events →', '#/places/costs') + '</p>', 3) +
      foldSec('cc-wage', 'QCEW construction wages by county', endsTake(rows, byId('wages')), '<p>Average construction pay is the labor part of what new housing costs to build. Pay runs higher on the Front Range and in resort counties.</p>' + stateWage + ends(rows, byId('wages'), 5, built), 3) +
      foldSec('cc-permit', 'Building permits per capita', endsTake(rows, byId('permits')), '<p>Homes permitted each year per 1,000 residents shows how quickly a county is adding housing. Counties that permit little while demand grows usually see rents rise fastest.</p>' + ends(rows, byId('permits'), 5, built), 3));

    var model = section('cc-model', 'What best predicts home-price growth? A driver-ranking model across all 64 Colorado counties',
      '<p>Home prices grew at very different rates across Colorado’s counties over the past decade. The model tests five county factors (income growth, vacancy, the share of renters paying 30% or more, permits per person and construction pay) and ranks them by how well they explain the gap. It splits credit between factors that move together, such as income growth and construction pay, and re-checks itself on counties it has not seen, so the ranking is not just a pattern in one set of counties.</p>' +
      (drivers.length ? driverBars(drivers) : Viz.unavailable({ title: 'Driver ranking', empty: 'The driver ranking file is empty.' })) +
      UI.table('cc-drv', 'Driver ranking: FHFA HPI 10-year change', [
        { key: 'rank', label: 'Rank', num: true, tip: 'Strongest predictor first' },
        { key: 'f', label: 'Factor', tip: 'The county measure tested' },
        { key: 'c', label: 'Coefficient', num: true, fmt: function (v) { return (v > 0 ? '+' : '') + v.toFixed(4); }, tip: 'Standardized coefficient: size is relative weight; the sign is the direction of the link to 10-year price change' },
        { key: 'src', label: 'Source', tip: 'Where the county figures come from' }
      ], drivers.map(function (r, i) { return { rank: i + 1, f: r.f, c: r.c, src: r.src }; }), { noun: 'factors', placeholder: 'Factor' }) +
      '<p class="note">' + link('Download the driver ranking (CSV)', VENDOR() + CC_FILES.drivers) + '. Rebuilt each month' + (built ? '; last built ' + esc(built) : '') + '.</p>' +
      '<p class="metric-source">Source: COHO driver-ranking model (scikit-learn ElasticNetCV) on ' + link(SRC.fhfa[0], SRC.fhfa[1]) + ', ' + link('Census ACS', SRC.acs[1]) + ', ' + link(SRC.qcew[0], SRC.qcew[1]) + ' and ' + link(SRC.bps[0], SRC.bps[1]) + (rows[0] && rows[0].hpiFrom ? ', ' + esc(rows[0].hpiFrom + ' to ' + rows[0].hpiTo) : '') + (built ? '. Built ' + esc(built) : '') + '.</p>' +
      '<details class="fold"><summary><span class="fold-title">What is an ElasticNetCV model? (plain English)</span><span class="fold-take">A regression that shrinks weak factors toward zero and tunes itself on counties it has not seen.</span></summary><div class="panel">' +
      '<p><strong>The question:</strong> across Colorado’s counties, which housing factors best predict how much home prices grew over the past decade?</p>' +
      '<p>The model gets five factors per county and estimates each one’s weight in predicting the 10-year change in the FHFA price index. It returns one standardized coefficient per factor: a bigger number means more predictive weight, and the sign gives the direction (positive means prices grew faster where that factor was higher).</p>' +
      '<p><strong>“ElasticNet”</strong> is a penalty that shrinks weak factors toward zero, so a factor that explains little gets a weight near zero instead of a made-up one. It also splits credit between factors that move together.</p>' +
      '<p><strong>“CV”</strong> is cross-validation: the model refits on rotating groups of counties (five folds) and keeps the version that predicts best on counties it did not see.</p>' +
      '<p><strong>Reading the ranking:</strong> the top row is the strongest predictor. The scale has no units, so rows compare directly, and the sign matters. A negative coefficient on permits per person means counties that permitted more homes saw less price growth, other factors held equal.</p>' +
      '<p><strong>What it is not:</strong> a forecast. It describes how counties differed over one 10-year window. Use it to see which conditions go with rising prices, not to time a market.</p></div></details>' +
      foldSec('cc-spec', 'Model specification (plain English)', 'What it predicts, what it tests, how it is fit and which counties it uses.', '<dl class="cc-dl">' +
        '<dt>What it predicts</dt><dd>How much home prices grew or fell in each county over 10 years, by the FHFA House Price Index.</dd>' +
        '<dt>What it tests</dt><dd>' + list(['Income growth over 10 years (ACS B19013): are incomes keeping up?', 'Vacancy rate, 2024 (ACS B25002): a tight market or a loose one?', 'Renters paying 30% or more, 2024 (ACS B25070): how stretched are renters?', 'Permits per person, five-year average (Census Building Permits Survey): how fast is the county adding homes?', 'Average construction pay, latest year (BLS QCEW): what does it cost to build here?']) + '</dd>' +
        '<dt>How it is fit</dt><dd>ElasticNetCV with five-fold cross-validation. The penalty strength is the value with the lowest prediction error on held-out counties. Inputs are standardized (z-scores) first.</dd>' +
        '<dt>Which counties</dt><dd>Counties with a value for every input; in practice 52 to 58 of the 64. The smallest rural counties drop out where FHFA or BLS withholds their figures.</dd>' +
        '<dt>For reproducing it</dt><dd>Target: FHFA HPI 10-year % change. Features: ACS B19013 (income growth), ACS B25002 (vacancy), ACS B25070 (rent burden), Census BPS (permits per capita), BLS QCEW NAICS 23 (wages). Method: scikit-learn ElasticNetCV, α by 5-fold cross-validation (lowest mean squared error), z-scored inputs.</dd></dl>', 3));

    var methods = foldSec('cc-methods', 'Methodology notes', 'Survey windows, the price index, and the price, wage and permit series behind each map.',
      section('cc-m-acs', 'ACS window definitions', '<p>Change over time uses ACS five-year survey windows that do not overlap:</p>' +
        list(['<strong>2024 window:</strong> 2020–2024, the latest five-year estimates', '<strong>2014 window:</strong> 2010–2014, the 10-year baseline', '<strong>2009 window:</strong> 2005–2009, the 15-year baseline', '<strong>Change:</strong> (later estimate ÷ earlier estimate) − 1']) +
        '<p>Windows that overlap (2014–2018 against 2019–2023, say) share up to four survey years and blur real change.</p>', 3) +
      section('cc-m-fhfa', 'FHFA HPI', '<p>The FHFA All-Transactions House Price Index is a repeat-sales index covering owner-occupied homes with conforming mortgages. FHFA publishes county figures only where there are enough sales, so not all 64 counties have one; those without are left out of the price analysis.</p>', 3) +
      section('cc-m-ppi', 'BLS PPI series used', list(PPI.map(function (p) { var s = d.fred.series[p[0]] || {}; return '<strong>' + esc(p[0]) + ':</strong> ' + esc(s.title || p[1]) + (s.status === 'discontinued' ? ' (discontinued)' : ''); })), 3) +
      section('cc-m-qcew', 'QCEW construction wages', '<p>The BLS Quarterly Census of Employment and Wages gives county employment and pay by industry. The maps use construction (NAICS 23), average annual pay over the latest four quarters. BLS withholds a county’s figure where there are too few employers to keep them anonymous.</p>', 3) +
      section('cc-m-bps', 'Census Building Permits Survey', '<p>The survey reports homes authorized by permit each month for each county and place. The maps add them up by year and take a five-year average per person, using ACS population.</p>', 3));

    var table = section('cc-all', 'Every county', UI.table('cc', 'Housing costs by county', [
      { key: 'county', label: 'County', href: function (r) { return q('county-costs', params, { county: r.key }); } }
    ].concat(MEASURES.map(function (m) { return { key: m[0], label: m[1], num: true, fmt: m[4], tip: m[5] }; })), rows, { noun: 'counties', placeholder: 'County' }) +
      '<p class="metric-source">Source: ' + link('Census ACS', SRC.acs[1]) + (rows[0] && rows[0].acsYear ? ' ' + esc((rows[0].acsYear - 4) + '\u2013' + rows[0].acsYear) + ' five-year' : '') + ', ' + link(SRC.fhfa[0], SRC.fhfa[1]) + ', ' + link(SRC.qcew[0], SRC.qcew[1]) + ' and ' + link(SRC.bps[0], SRC.bps[1]) + '; each column\u2019s years are in its header tip' + (built ? '. Built ' + esc(built) : '') + '.</p>');

    var sources = foldSec('cc-src', 'Data sources and methodology', 'Census ACS, FHFA, BLS, Census permits and NLIHC, each linked to its publisher.', list([
      '<strong>U.S. Census Bureau, American Community Survey five-year estimates:</strong> median gross rent (B25064), median household income (B19013), vacancy (B25002), rent burden (B25070). ' + link('census.gov/acs', 'https://www.census.gov/programs-surveys/acs'),
      '<strong>Federal Housing Finance Agency, All-Transactions House Price Index:</strong> county repeat-sales index, yearly; state index, quarterly. ' + link('fhfa.gov, House Price Index', 'https://www.fhfa.gov/data/hpi'),
      '<strong>U.S. Bureau of Labor Statistics, Producer Price Index:</strong> construction input series. ' + link('bls.gov/ppi', 'https://www.bls.gov/ppi/'),
      '<strong>U.S. Bureau of Labor Statistics, Quarterly Census of Employment and Wages:</strong> county construction pay, NAICS 23. ' + link('bls.gov/cew', 'https://www.bls.gov/cew/'),
      '<strong>U.S. Census Bureau, Building Permits Survey:</strong> monthly residential permits by county. ' + link('census.gov/construction/bps', 'https://www.census.gov/construction/bps/'),
      '<strong>National Low Income Housing Coalition, Out of Reach 2026:</strong> Fair Market Rent and housing wage, Colorado. ' + link('nlihc.org/oor/state/co', 'https://nlihc.org/oor/state/co')
    ]) + '<p class="note">This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau. All figures are published public estimates and can be revised; ACS figures for small counties carry wide margins. For information only, not investment, legal or financial advice.</p>');

    // The page story (paul 11-06): the finding first, then the map, then the figures behind it.
    var answer = flat ? 'Colorado home prices have been about flat for a year (' + esc(signed(y1)) + ' in ' + esc(quarter(last.date)) + '), but ' + esc(pct1(bB / bU * 100)) + ' of renters pay 30% or more of income, and a two-bedroom at Fair Market Rent takes ' + esc('$' + (oor.two_br_housing_wage || 0).toFixed(2)) + ' an hour.' :
      'Colorado home prices were ' + esc(signed(y1)) + ' on a year in ' + esc(quarter(last.date)) + ', and ' + esc(pct1(bB / bU * 100)) + ' of renters pay 30% or more of income. Rents, prices, pay and permits for all 64 counties are mapped below.';
    var means = T.means([
      { text: 'Prices have stopped climbing, but rents and the wage needed to pay them have not come down, so renters get no relief from a cooler sales market.' }
    ]);
    return T.head({
      kind: 'data', crumbs: T.trail('places', title), title: title,
      answer: answer,
      meta: '<span class="scope-tag">Scope: Colorado counties</span> Small counties carry wide survey margins.' + (built ? ' Maps and model last built ' + esc(built) + '.' : ''),
      facts: [
        { value: money(co.median_gross_rent), label: 'Median rent, Colorado', source: 'Census ACS', href: SRC.acs[1] },
        { value: pct1(bB / bU * 100), label: 'Renters paying 30%+', source: 'Census ACS B25070', href: SRC.b25070[1] },
        { value: signed(y1), label: 'Home prices, ' + quarter(last.date) + ' vs a year earlier', source: 'FHFA via FRED', href: SRC.costhpi[1] }
      ]
    }) + T.onThisPage([{ id: 'cc-map', title: 'Maps' }, { id: 'cc-snap', title: 'Snapshot' }, { id: 'cc-key', title: 'Ten years of change' }, { id: 'cc-win', title: 'Rent change' }, { id: 'cc-change', title: 'Getting worse' },
      { id: 'cc-hpi', title: 'Home prices' }, { id: 'cc-cost', title: 'Construction costs' }, { id: 'cc-model', title: 'What predicts price growth' }, { id: 'cc-methods', title: 'Methods' }, { id: 'cc-all', title: 'Every county' }], true) +
      mapSec + snapshot + means + findings + current + windows + changeSec + hpiSec + costSec + model + methods + table + sources +
      T.source('Census ACS, FHFA, BLS and Census Building Permits Survey, as the county housing costs article reads them', CC_SRC, built) +
      T.next('What to do next', [{ href: picked ? '#/place/' + picked : '#/places', label: picked ? 'Open this county\u2019s needs assessment \u2192' : 'Open your county\u2019s needs assessment \u2192' }, { href: '#/market', label: 'Run a market check', secondary: true }, { href: '#/places/costs', label: 'See construction costs since 2020', secondary: true }]);
  }

  // The 10- and 15-year rent change maps. The article draws them as folium maps that carry each county's class (one
  // of six even bands between the legend's ticks) and the band edges, not the county values, so this reads the same
  // two pinned map files and redraws the bands. The bands match ACS B25064 for 2005–2009, 2010–2014 and 2020–2024.
  function parseBands(html) {
    try {
      var ticks = JSON.parse(/tickValues\((\[[^\]]*\])\)/.exec(html)[1]);
      var cols = [];
      JSON.parse(/\.range\((\[[^\]]*\])\)/.exec(html)[1].replace(/'/g, '"')).forEach(function (c) { c = c.slice(0, 7); if (cols.indexOf(c) < 0) cols.push(c); });
      var re = /_styler\(feature\) \{\s*switch\(feature\.properties\.NAME\) \{([\s\S]*?)\n\s*\}\s*\n\s*\}/g, m, body = null;
      while ((m = re.exec(html))) if (m[1].indexOf('case') > -1) { body = m[1]; break; }
      if (!body || ticks.length !== cols.length + 1) return null;
      var by = {}, cre = /((?:case "[^"]+":\s*)+)\s*return \{[^}]*"fillColor": "(#\w+)"/g;
      while ((m = cre.exec(body))) { var k = cols.indexOf(m[2]); (m[1].match(/case "([^"]+)"/g) || []).forEach(function (x) { by[x.slice(6, -1)] = k; }); }
      var dm = /default:\s*return \{[^}]*"fillColor": "(#\w+)"/.exec(body);
      return { ticks: ticks, cols: cols, by: by, dflt: dm ? cols.indexOf(dm[1]) : null };
    } catch (e) { return null; }
  }
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MW = K.W, MH = K.H, ring = K.ring;
  function shape(g) { return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(function (p) { return p.map(ring).join(''); }).join(''); }
  // Six bands, light to dark in one hue, as the lab's other county maps.
  var BANDS = ['var(--map-0)', 'var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)'];
  // ---- Map kit part 4: change mode (cartography review, "maps of change") ----
  // One arrow per county, from site/change-arrows.js: tilt and colour for direction, length for size, thickness for
  // homes. A measure switch and a period switch; the period always shows in the title. Every figure is read from
  // Housing-Analytics data/co-housing-costs/county-trends.json (ACS five-year cohorts 2005-09, 2010-14, 2020-24 and the
  // FHFA county index); nothing is modelled here.
  var CHANGE = {
    burden: { label: 'Renters paying 30% or more', unit: 'points', flat: 1, per: 1.1,
      worse: ['More renters stretched', 'a larger share pays 30% or more'], better: ['Fewer renters stretched', 'a smaller share pays 30% or more'], flatT: ['About the same', 'within 1 point'],
      value: function (c, base) { var a = cohort(c, base), b = cohort(c, 2024); return a && b && a.rent_burden_30_plus != null && b.rent_burden_30_plus != null ? (b.rent_burden_30_plus - a.rent_burden_30_plus) * 100 : null; },
      src: 'Census ACS five-year (B25070), as the county trends file holds it' },
    price: { label: 'Home prices against income', unit: 'points', flat: 5, per: 0.22,
      worse: ['Prices pulling ahead', 'home prices grew faster than income'], better: ['Income catching up', 'income grew faster than home prices'], flatT: ['About the same', 'within 5 points'],
      value: function (c, base) {
        var a = cohort(c, base), b = cohort(c, 2024), h = c.hpi || {}, hp = base === 2009 ? h.change_15y_pct : h.change_10y_pct;
        return a && b && a.median_hh_income && b.median_hh_income && hp != null ? (hp - (b.median_hh_income / a.median_hh_income - 1)) * 100 : null;
      },
      src: 'FHFA county House Price Index (10 and 15 years to ' + '2025) against Census ACS five-year median household income' }
  };
  function cohort(c, year) { return (c.acs_cohorts || []).filter(function (x) { return x.year === year; })[0]; }
  function changeMap(d, params) {
    var CA = global.LabChangeArrows, ct = d.ct && d.ct.counties;
    if (!CA || !ct) return '<p class="note">The change map did not load.</p>';
    var mk = params.get('cm') === 'price' ? 'price' : 'burden', base = params.get('cp') === '10' ? 2014 : 2009, M = CHANGE[mk];
    var since = base === 2009 ? '2005–09' : '2010–14';
    var change = {}, weight = {}, names = {};
    d.b.features.forEach(function (f) {
      var k = f.properties.GEOID, c = ct[k]; names[k] = f.properties.NAME;
      if (!c) return;
      var v = M.value(c, base), now = cohort(c, 2024);
      if (v != null && isFinite(v)) { change[k] = v; weight[k] = now && now.total_housing_units || 0; }
    });
    var ks = Object.keys(change), worse = ks.filter(function (k) { return change[k] >= M.flat; }), better = ks.filter(function (k) { return change[k] <= -M.flat; });
    // The headline names the biggest change among counties of 5,000 homes or more: small counties' survey margins are wide.
    var top = ks.filter(function (k) { return weight[k] >= K.THIN; }).sort(function (a, b) { return change[b] - change[a]; })[0];
    var r1 = function (v) { return (v > 0 ? '+' : '') + Math.round(v) + ' points'; };
    var title = mk === 'burden'
      ? 'Since ' + since + ', the share of renters paying 30% or more rose in ' + worse.length + ' of ' + ks.length + ' counties and fell in ' + better.length + (top ? '; among counties of 5,000 homes or more, most in ' + names[top] + ' (' + r1(change[top]) + ')' : '')
      : 'Since ' + since + ', home prices outgrew income in ' + worse.length + ' of ' + ks.length + ' counties; income kept ahead in ' + better.length;
    var centres = CA.centres(d.b.features, K.pt);
    var outline = d.b.features.map(function (f) { return '<path d="' + shape(f.geometry) + '"><title>' + esc(f.properties.NAME + ' County: ' + (change[f.properties.GEOID] == null ? 'not published' : r1(change[f.properties.GEOID]))) + '</title></path>'; }).join('');
    var arrows = CA.layer({ points: centres, change: change, weight: weight, weightCuts: [5000, 50000], flat: M.flat, per: M.per * 6, maxLen: 56, widths: [2.6, 4, 5.6] });
    var chip = function (key, val, label, on) { return '<li><a href="' + esc(q('county-costs', params, (function () { var o = {}; o[key] = val; o.at = 'cc-change'; return o; })())) + '"' + (on ? ' class="is-on" aria-current="true"' : '') + '>' + esc(label) + '</a></li>'; };
    return '<nav class="dm-chips" aria-label="What changed"><ul>' + chip('cm', null, CHANGE.burden.label, mk === 'burden') + chip('cm', 'price', CHANGE.price.label, mk === 'price') + '</ul></nav>' +
      '<nav class="dm-chips" aria-label="Since when"><ul>' + chip('cp', null, 'Since 2005–09', base === 2009) + chip('cp', '10', 'Last 10 years (since 2010–14)', base === 2014) + '</ul></nav>' +
      '<figure class="pres-map money-map cc-change"><figcaption><span class="cc-kicker">' + esc(M.label + ', ' + since + ' to 2020–24') + '</span><strong>' + esc(title) + '</strong>' +
      '<span class="note">One arrow per county, at its centre. Tap or point to a county for its change.</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MW + ' ' + MH + '" role="img" aria-label="' + esc(title + '. Source: ' + M.src + '.') + '"><g class="pm-counties cc-change-counties">' + outline + '</g>' + arrows + K.cities() + '</svg></div>' +
      CA.legend({ worse: M.worse, better: M.better, flat: M.flatT, size: 'Longer arrow: bigger change. Thicker arrow: more homes in the county (5,000 and 50,000 are the steps).' }) +
      '<p class="metric-source">Source: ' + esc(M.src) + '. Change is 2020–24 less ' + since + ', in percentage points.</p>' +
      (global.LabVizData ? global.LabVizData.block(M.label + ', change since ' + since, ['County', 'Change (points)'], ks.map(function (k) { return [names[k] + ' County', Math.round(change[k] * 10) / 10]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; })) : '') + '</figure>';
  }

  function rentWindow(html, bounds, years, from, thin) {
    var b = html && parseBands(html), title = 'Rent change by county, ' + years + ' years';
    var src = 'Census ACS five-year B25064, ' + from + ' to 2020–2024, as ' + link('the county housing costs article', CC_SRC) + ' maps it';
    if (!b) return Viz.unavailable({ title: title, empty: 'The rent change map did not load.', source: src });
    var band = function (name) { return b.by[name] != null ? b.by[name] : b.dflt; };
    var lab = function (i) { return Math.round(b.ticks[i] * 100) + '% to ' + Math.round(b.ticks[i + 1] * 100) + '%'; };
    var paths = bounds.features.map(function (f) {
      var nm = f.properties.NAME, i = band(nm), t = nm + ' County: rent up ' + lab(i);
      return '<a href="#/places/county-costs?county=' + esc(f.properties.GEOID) + '&amp;at=cc-map" aria-label="' + esc(t) + '"><path d="' + shape(f.geometry) + '" fill="' + BANDS[i] + '"><title>' + esc(t) + '</title></path></a>';
    }).join('');
    var groups = BANDS.map(function (c, i) { return bounds.features.filter(function (f) { return band(f.properties.NAME) === i; }).map(function (f) { return f.properties.NAME; }).sort(); });
    var top = groups.map(function (g, i) { return [g, i]; }).filter(function (x) { return x[0].length; }).pop();
    // Map kit part 2: the finding is the title, and the bands with their numbers and counts sit directly under the map.
    var mk = K.marks(), thinN = bounds.features.filter(function (f) { return thin && thin[f.properties.GEOID]; }).length;
    var finding = 'Rents rose most (' + lab(top[1]) + ') in ' + top[0].join(', ') + (top[0].every(function (nm) { return bounds.features.some(function (f) { return f.properties.NAME === nm && thin && thin[f.properties.GEOID]; }); }) ? ', a small county with a wide survey margin' : '') + (b.ticks[0] > 0 ? '; median rent rose in every county' : '');
    var legend = '<ul class="cc-bands">' + groups.map(function (g, i) {
        return '<li><i style="background:' + BANDS[i] + '"></i><span class="cc-band-h">' + esc(lab(i)) + ' <span class="note">' + g.length + (g.length === 1 ? ' county' : ' counties') + '</span></span>' +
          '<span class="cc-band-l">' + esc(g.length ? g.join(', ') : 'None') + '</span></li>';
      }).reverse().join('') + (thinN ? '<li class="cc-band-thin">' + K.KEY_THIN + '<span class="cc-band-h">Under ' + K.THIN.toLocaleString('en-US') + ' homes: wide survey margin <span class="note">' + thinN + ' counties</span></span></li>' : '') + '</ul>';
    return '<figure class="pres-map money-map"><figcaption><span class="cc-kicker">' + esc(title) + '</span><strong>' + esc(finding) + '</strong>' +
      '<span class="note">Median gross rent, ' + esc(from) + ' against 2020–2024. Each county is shown in one of six even bands. Select a county for its figures today.</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MW + ' ' + MH + '" role="group" aria-label="' + esc(finding + '. Source: Census ACS five-year, ' + from + ' to 2020–2024.') + '">' + mk.defs + paths + (thinN ? K.thinLayer(bounds.features, thin, mk) : '') + K.cities() + '</svg></div>' +
      legend + '<p class="metric-source">Source: ' + src + '.</p>' +
      (global.LabVizData ? global.LabVizData.block(title, ['County', 'Rent change band'], bounds.features.map(function (f) { return [f.properties.NAME + ' County', lab(band(f.properties.NAME))]; })
        .sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }), { note: 'The source map publishes a band per county, not an exact figure.' }) : '') + '</figure>';
  }

  // ====================================================================================================
  // Multifamily lens
  // ====================================================================================================
  var MF_SRC = LIVE + 'census-dashboard.html';
  var MF_FILES = { snap: 'data/census-multifamily-co.json', inv: 'data/multifamily-inventory-co.json', rel: 'data/hna/acs-reliability.json', ranking: 'data/hna/ranking-index.json' };
  var STRUCT = [['1_detached', 'Single-family, detached'], ['1_attached', 'Single-family, attached'], ['2_units', '2 homes'], ['3_4_units', '3 or 4 homes'],
    ['5_9', '5 to 9 homes'], ['10_19', '10 to 19 homes'], ['20p', '20 or more homes'], ['mobile', 'Mobile homes']];
  var YB = [['built_2020_later', '2020 or later'], ['built_2010_2019', '2010 to 2019'], ['built_2000_2009', '2000 to 2009'], ['built_1990_1999', '1990 to 1999'], ['built_1980_1989', '1980 to 1989'],
    ['built_1970_1979', '1970 to 1979'], ['built_1960_1969', '1960 to 1969'], ['built_1950_1959', '1950 to 1959'], ['built_1940_1949', '1940 to 1949'], ['built_1939_earlier', '1939 or earlier']];
  var BURDEN = [['less_15', 'Under 15%'], ['15_19', '15 to 19%'], ['20_24', '20 to 24%'], ['25_29', '25 to 29%'], ['30_34', '30 to 34%'], ['35_plus', '35% or more']];

  // A place's stored ACS profile. The hosted preview packs these per-place files into bundles (LAB_HNA_LOAD).
  var profiles = {};
  function profileFor(g) {
    var st = profiles[g];
    if (st) return st;
    st = profiles[g] = { data: null, error: null };
    (global.LAB_HNA_LOAD ? global.LAB_HNA_LOAD(g).then(function (r) { return r[1]; })
      : fetch(VENDOR() + 'data/hna/summary/' + g + '.json').then(function (r) { if (!r.ok) throw new Error('summary ' + r.status); return r.json(); }))
      .then(function (sum) { st.data = (sum && sum.acsProfile) || {}; st.updated = sum && sum.updated; Shell.render(); })
      .catch(function () { st.data = {}; st.missing = true; Shell.render(); });
    return st;
  }
  function acsLabel(series, year) { var y = Number(year); return !isFinite(y) ? 'ACS' : series === 'acs1' ? 'ACS ' + y + ' one-year' : 'ACS ' + (y - 4) + '–' + y + ' five-year'; }

  // The live page's enrich(): the snapshot record with the place's stored profile laid over it.
  function enrich(rec, p, rel) {
    var total = n(p.DP04_0001E), count = {}, share = {};
    STRUCT.forEach(function (s, i) {
      var c = n(p['DP04_00' + String(7 + i).padStart(2, '0') + 'E']);
      count[s[0]] = c; share[s[0]] = c != null && total ? Math.round(c / total * 1000) / 10 : null;
    });
    var mf = ['5_9', '10_19', '20p'].map(function (k) { return count[k]; }), yb = {}, ybAny = false;
    YB.forEach(function (y, i) { var v = n(p['DP04_00' + String(17 + i) + 'E']); if (v != null) { yb[y[0]] = v; ybAny = true; } });
    var g = [137, 138, 139, 140, 141, 142].map(function (k) { return n(p['DP04_0' + k + 'PE']); }), dist = {};
    if (g.every(function (v) { return v != null; })) BURDEN.forEach(function (b, i) { dist[b[0]] = g[i]; });
    var r = rel && rel.geos && rel.geos[rec.geoid], hu = r && r.DP04_0001E;
    var series = hu && hu.e != null && total != null && Math.abs(hu.e - total) < 0.5 ? hu.s : null, year = (hu && hu.y) || Number(p._acsYear) || 2024;
    var all = mf.every(function (v) { return v != null; });
    return {
      geoid: rec.geoid, level: rec.level, name: cleanName(rec.name).replace(/ (city|town|CDP)$/, ''),
      totalHU: total != null ? total : rec.totalHU, count: count, share: share,
      pct_mf: all && total ? Math.round((share['5_9'] + share['10_19'] + share['20p']) * 10) / 10 : rec.pct_mf,
      mf_units: all ? mf.reduce(function (a, b) { return a + b; }, 0) : null,
      owner: n(p.DP04_0046PE), renter: n(p.DP04_0047PE), renters: n(p.DP04_0047E), rent: n(p.DP04_0134E), value: n(p.DP04_0089E),
      burdened: g[4] != null && g[5] != null ? Math.round((g[4] + g[5]) * 10) / 10 : null, dist: dist, yb: ybAny ? yb : {},
      vintage: series ? acsLabel(series, year) : 'ACS ' + year, series: series || p._acsSeries, year: year
    };
  }

  function placePicker(snap, g) {
    // Counties, towns, cities and CDPs in one A to Z list, each labelled with its type (LabPlaceList).
    var items = snap.counties.map(function (r) { return { value: r.geoid, name: r.name, kind: 'county' }; })
      .concat(snap.places.map(function (r) { return { value: r.geoid, name: r.name, kind: '' }; }));
    return '<form class="search sc-pick" onsubmit="return false"><label for="mf-g">State, county or town</label><select id="mf-g" data-place-pick="mf-g">' +
      '<option value="08"' + (g === '08' ? ' selected' : '') + '>Colorado (the whole state)</option>' +
      global.LabPlaceList.options(items, g) + '</select></form>';
  }

  function multifamily(params) {
    var title = 'Multifamily lens', s = load(MF_FILES);
    if (!s.data) return waiting(title, s);
    var d = s.data, g = params.get('g') || '08';
    var rec = g === '08' ? d.snap.state[0] : d.snap.counties.concat(d.snap.places).filter(function (x) { return x.geoid === g; })[0];
    // The page story (paul 11-06): with a place loaded, the snapshot's finding is the lede.
    var head = function (scope, finding) {
      return T.head({
        kind: 'data', crumbs: T.trail('places', title), title: title,
        answer: finding || 'Apartments and other multifamily housing: building types, owners and renters, rents and cost burden, tax credit buildings, and when homes were built.',
        meta: '<span class="scope-tag">Scope: ' + esc(scope) + '</span> Colorado, any of 64 counties, or any of ' + d.snap.places.length + ' towns and CDPs.',
        dated: d
      });
    };
    var geo = section('mf-geo', 'Geography', '<p>Pick the whole state, a county or a town. Figures come from the Census survey profile the needs assessment uses; the label under each card says which survey.</p>' + placePicker(d.snap, g));
    if (!rec) return head('pick a place') + geo + '<p class="callout">No place with that code. Pick one above.</p>';
    var pf = profileFor(g);
    if (!pf.data) return head(cleanName(rec.name)) + geo + '<p role="status" class="note">Loading the survey figures…</p>';
    var r = enrich(rec, pf.data, d.rel), name = r.name;
    var inv = r.level === 'state' ? d.inv.state : r.level === 'county' ? d.inv.counties[g] : d.inv.places[g];
    var lihtc = inv && inv.lihtc, yr = r.vintage;
    var geoParam = g.length === 2 ? '040XX00US08' : g.length === 5 ? '050XX00US' + g : '160XX00US' + g;
    var acsHref = 'https://data.census.gov/table/ACSDP' + (r.series === 'acs1' ? '1Y' : '5Y') + r.year + '.DP04?g=' + geoParam;
    var acs = link('Census ' + yr + ', DP04', acsHref);
    var invDate = String((d.inv.meta || {}).generated_at_utc || '').slice(0, 10);
    var CHFA = link('CHFA, HUD and USDA property records', 'https://www.chfainfo.com/rental-housing/housing-credit/awards') + (invDate ? ', compiled ' + esc(invDate) : '');

    var snapshot = section('mf-snap', 'Snapshot', UI.intro('How much of ' + name + '’s housing is apartments, and how stretched are its renters?',
      (r.pct_mf != null ? r.pct_mf.toFixed(1) + '% of homes are in buildings of five or more. ' : '') + (r.renter != null ? pct1(r.renter) + ' of households rent' : '') +
      (r.rent ? ', at a median of ' + money(r.rent) + ' a month' : '') + (r.burdened != null ? ', and ' + pct1(r.burdened) + ' of renters pay 30% or more of income.' : '.')) +
      '<div class="metrics">' +
      card('Total homes', num(r.totalHU), yr, acs) +
      card('Homes in buildings of 5+', r.pct_mf == null ? null : pct1(r.pct_mf), r.mf_units != null ? num(r.mf_units) + ' homes' : '', acs) +
      card('Renter households', r.renters == null ? (r.renter == null ? null : pct1(r.renter)) : num(r.renters), r.renter != null ? pct1(r.renter) + ' of households; ' + pct1(r.owner) + ' own' : '', acs) +
      card('Median gross rent', r.rent ? money(r.rent) : null, r.value ? 'A month. Median home value ' + money(r.value) : 'A month', acs) +
      card('Renters paying 30%+', r.burdened == null ? null : pct1(r.burdened), 'Of income on rent', acs) +
      card('Tax credit (LIHTC) properties', lihtc ? num(lihtc.properties) : null, lihtc ? num(lihtc.units) + ' affordable homes' : 'None on record', CHFA) + '</div>');

    var counts = STRUCT.map(function (x) { return r.count[x[0]]; });
    var structTable = counts.every(function (v) { return v == null; }) ? '<p class="note">Building-type counts are not published for ' + esc(name) + '.</p>' :
      UI.table('mf-struct', 'Homes by building type, ' + name, [
        { key: 'type', label: 'Building type', tip: 'Number of homes in the building (ACS units in structure)' },
        { key: 'share', label: 'Share', num: true, fmt: pct1, tip: 'Share of all homes in this building type' },
        { key: 'units', label: 'Homes', num: true, fmt: num, tip: 'Homes in this building type' }
      ], STRUCT.map(function (x) { return { type: x[1], share: r.share[x[0]], units: r.count[x[0]] }; }).concat([{
        type: 'Multifamily total (5+ homes)', share: ['5_9', '10_19', '20p'].reduce(function (t, k) { return t + (r.share[k] || 0); }, 0), units: ['5_9', '10_19', '20p'].reduce(function (t, k) { return t + (r.count[k] || 0); }, 0)
      }]), { noun: 'building types', placeholder: 'Type' }) + '<p class="metric-source">Source: ' + acs + '.</p>';
    var structure = section('mf-struct-h', 'Housing structure mix',
      '<p>Share of homes by the size of building they are in. Buildings of five or more homes are where tax credit and market-rate apartment development happens.</p>' +
      Viz.orderedBars({ title: 'Homes by type of building', answer: r.pct_mf != null ? pct1(r.pct_mf) + ' of ' + num(r.totalHU) + ' homes are in buildings of five or more.' : '',
        rows: STRUCT.map(function (x) { return [x[1], r.count[x[0]]]; }), total: r.totalHU, source: acs, empty: true }) +
      '<details class="fold"><summary><span class="fold-title">Show the table</span><span class="fold-take">Share and count for each building type, with the multifamily total.</span></summary><div class="panel">' + structTable + '</div></details>');

    // Tax credit and other affordable properties on record.
    var invBody;
    if (!inv) invBody = '<p class="note">No affordable-housing properties on record for ' + esc(name) + '.</p>';
    else {
      var st = d.inv.state || {}, lt = (lihtc && lihtc.properties) || 0;
      var flags = [['qct', 'In a Qualified Census Tract'], ['dda', 'In a Difficult Development Area'], ['nonprofit', 'Nonprofit sponsor']];
      var filled = flags.filter(function (f) { return st[f[0]]; }), empty = flags.filter(function (f) { return !st[f[0]]; });
      var siting = [].concat(filled.map(function (f) { return { c: f[1], n: inv[f[0]] || 0 }; }),
        [{ c: 'Paired with a state tax credit', n: (lihtc && lihtc.state_paired) || 0 }, { c: 'Paired with a transit-oriented community credit', n: (lihtc && lihtc.toc_paired) || 0 }]).map(function (x) { x.s = lt ? x.n / lt * 100 : null; return x; });
      var yrs = inv.yr_pis_distribution || {}, dec = Object.keys(yrs).sort();
      invBody = '<div class="metrics">' +
        card('Affordable properties on record', num(inv.total_records), num(inv.total_units) + ' homes', CHFA) +
        card('Tax credit (LIHTC) properties', num(lt), num((lihtc && lihtc.units) || 0) + ' homes', CHFA) +
        card('9% tax credit', num((lihtc && lihtc.pct_9) || 0), 'Competitive credits', CHFA) +
        card('4% tax credit', num((lihtc && lihtc.pct_4) || 0), 'With private activity bonds', CHFA) +
        card('Preservation candidates', num(inv.preservation_candidates), 'CHFA portfolio', CHFA) +
        card('HUD multifamily', num(inv.hud_multifamily), 'Project-based rent help', link('HUD', 'https://hudgis-hud.opendata.arcgis.com/datasets/HUD::multifamily-properties-assisted/')) +
        card('USDA Rural Development', num(inv.usda_rural), 'Section 515 rentals and Section 514 farm worker housing', link('USDA', 'https://www.rd.usda.gov/data-sets/multi-family-housing-rentals')) + '</div>' +
        (r.level !== 'state' ? '<p class="note">Preservation records often lack a county, so county and town counts can miss some that the state total includes.</p>' : '') +
        // Shown only once the property list carries an award year (paul 11-06: no empty sections on a public page).
        (dec.length ? section('mf-award', 'CHFA award year (LIHTC, by decade)',
          Viz.orderedBars({ title: 'Tax credit projects by CHFA award decade', rows: dec.map(function (k) { return [k + 's', yrs[k]]; }), noShare: true, source: CHFA }), 3) : '') +
        section('mf-siting', 'LIHTC siting characteristics', '<p>How the tax credit properties here are financed and where they sit.</p>' +
          UI.table('mf-site', 'Tax credit property characteristics, ' + name, [
            { key: 'c', label: 'Characteristic', tip: 'A feature of the tax credit properties in this area' },
            { key: 'n', label: 'Properties', num: true, fmt: num, tip: 'Tax credit properties with this feature (CHFA)' },
            { key: 's', label: 'Share', num: true, fmt: pct1, tip: 'Share of all tax credit properties in this area' }
          ], siting, { noun: 'rows', placeholder: 'Characteristic' }) + '<p class="metric-source">Source: ' + CHFA + '.</p>' +
          (empty.length ? '<p class="note">' + esc(empty.map(function (f) { return f[1]; }).join(', ')) + ': not filled in the property list (zero statewide), so left out rather than shown as 0.</p>' : ''), 3);
    }
    var inventory = section('mf-inv', 'LIHTC and other affordable inventory',
      '<p>LIHTC is the federal Low-Income Housing Tax Credit, the main source of money for affordable rentals. These counts combine CHFA tax credit and preservation records, HUD-assisted multifamily properties and USDA Rural Development properties into one list.</p>' + invBody);

    var tenure = section('mf-ten', 'Tenure, rent and cost burden',
      section('mf-tenure', 'Tenure split', r.renter != null && r.owner != null ? Viz.splitBar({ title: 'Households that rent and own', parts: [['Rent', r.renter, C.households], ['Own', r.owner, C.blue]], source: acs }) : '<p class="note">Not published for ' + esc(name) + '.</p>', 3) +
      section('mf-burden', 'Renter cost-burden distribution (share of household income on rent)', Object.keys(r.dist).length ?
        UI.bars('What renters pay, as a share of income', 'Renter households paying rent, ' + yr, BURDEN.map(function (b) { return [b[1], r.dist[b[0]]]; }), pct1, 'households') +
        '<p>' + esc(pct1(r.burdened) + ' of renter households pay 30% or more of income on rent.') + '</p><p class="metric-source">Source: ' + acs + '.</p>' :
        '<p class="note">Rent burden is not published for ' + esc(name) + ' (too few survey responses).</p>', 3));

    var ybSec = section('mf-yb', 'Year-built distribution', Object.keys(r.yb).length ?
      '<p>When homes were built. Older stock usually needs more repair and preservation money; newer stock shows recent building.</p>' +
      Viz.orderedBars({ title: 'Homes by decade built', rows: YB.map(function (y) { return [y[1], r.yb[y[0]]]; }), total: r.totalHU, source: acs,
        answer: (function () { var t = YB.reduce(function (a, y) { return a + (r.yb[y[0]] || 0); }, 0), old = ['built_1970_1979', 'built_1960_1969', 'built_1950_1959', 'built_1940_1949', 'built_1939_earlier'].reduce(function (a, k) { return a + (r.yb[k] || 0); }, 0); return t ? Math.round(old / t * 100) + '% of homes were built before 1980.' : ''; })() }) :
      '<p class="note">Year built is not published for ' + esc(name) + '.</p>');

    var cn = {}; d.snap.counties.forEach(function (c) { cn[c.geoid] = countyOnly(c.name); });
    var topMf = d.snap.counties.filter(function (c) { return isFinite(Number(c.pct_mf)); }).sort(function (a, b) { return b.pct_mf - a.pct_mf; }).slice(0, 10);
    var topL = Object.keys(d.inv.counties).map(function (k) { return { k: k, l: d.inv.counties[k].lihtc }; }).filter(function (x) { return x.l && x.l.units > 0; }).sort(function (a, b) { return b.l.units - a.l.units; }).slice(0, 10);
    var snapYr = d.snap.meta.acs_year;
    var boards = section('mf-lead', 'Statewide leaderboards', '<p>The same for every place you pick: Colorado’s top ten counties.</p><div class="cc-ends">' +
      section('mf-top-mf', 'Top counties by multifamily share', Viz.orderedBars({ title: 'Share of homes in buildings of 5+', rows: topMf.map(function (c) { return [countyOnly(c.name), c.pct_mf]; }), noShare: true, fmt: pct1,
        source: link('Census ACS ' + (snapYr - 4) + '–' + snapYr + ' five-year, DP04', 'https://data.census.gov/table/ACSDP5Y' + snapYr + '.DP04?g=040XX00US08$0500000') }) +
        '<p class="note">' + esc(topMf.map(function (c) { return countyOnly(c.name) + ' ' + num(c.totalHU) + ' homes'; }).join('; ')) + '.</p>', 3) +
      section('mf-top-l', 'Top counties by LIHTC units', Viz.orderedBars({ title: 'Homes in tax credit properties', rows: topL.map(function (x) { return [cn[x.k] || x.k, x.l.units]; }), noShare: true, source: CHFA }) +
        '<p class="note">' + esc(topL.map(function (x) { return (cn[x.k] || x.k) + ' ' + num(x.l.properties) + ' properties'; }).join('; ')) + '.</p>', 3) + '</div>');

    var rl = Array.isArray(d.ranking.rankings) ? d.ranking.rankings : Object.keys(d.ranking.rankings).map(function (k) { return d.ranking.rankings[k]; });
    var counties = rl.filter(function (x) { return x.type === 'county'; }).map(function (x) {
      var m = x.metrics || {};
      return { geoid: x.geoid, county: cleanName(x.name), renters: m.pct_renters, rent: m.gross_rent_median, severe: m.pct_renter_severe_burdened, lihtc: m.lihtc_project_count, gap: m.housing_gap_units };
    });
    var every = section('mf-all', 'Every county', UI.table('mf-counties', 'Renters, rent and tax credit buildings by county', [
      { key: 'county', label: 'County', href: function (x) { return '#/places/multifamily?g=' + x.geoid; } },
      { key: 'renters', label: 'Households renting', num: true, fmt: pct1 },
      { key: 'rent', label: 'Median rent', num: true, fmt: money },
      { key: 'severe', label: 'Renters paying 50%+', num: true, fmt: pct1, tip: 'Renter households paying half or more of income on housing' },
      { key: 'lihtc', label: 'Tax credit buildings', num: true, fmt: num },
      { key: 'gap', label: 'Homes short at 30% AMI', num: true, fmt: num, tip: 'Renter households at or below 30% of area median income, less homes priced for them (HUD CHAS)' }
    ], counties, { noun: 'counties', placeholder: 'County' }) + '<p class="note">From the needs assessment ranking, which uses the one-year survey for counties of 65,000 people or more.</p>' +
      '<p class="metric-source">Source: COHO needs assessment ranking (Census ACS, HUD CHAS and CHFA records), built ' + esc(String(((d.ranking.metadata || {}).generatedAt) || '').slice(0, 10)) + '.</p>');

    var helps = section('mf-help', 'What to look for', list([
      '<strong>Supply.</strong> A higher share of homes in buildings of five or more usually means a deeper apartment market that can absorb new units.',
      '<strong>Site selection.</strong> Compare counties and towns on apartment share, renter share and cost burden before you draw a market area.',
      '<strong>Tax credit context.</strong> Put the building mix next to the tax credit and preservation inventory to size the affordable pipeline.',
      '<strong>Age of stock.</strong> Where most homes are old, preservation and rehab money may go further than new construction.'
    ]));
    var dataSec = section('mf-data', 'Data sources and variables',
      '<p>Figures for the place you pick come from the Census Bureau’s American Community Survey ' + esc(String(r.year)) + ' data profile DP04: five-year estimates for most places, and one-year estimates for places of 65,000 or more people. The label under each card says which. The statewide multifamily leaderboard uses the ' + esc((snapYr - 4) + '–' + snapYr) + ' five-year estimates. Affordable-housing counts come from CHFA, HUD and USDA Rural Development property records, totalled by county and town.</p>' +
      section('mf-vars', 'Census variables surfaced', list([
        '<strong>DP04_0001E:</strong> total homes', '<strong>DP04_0007E to DP04_0014E:</strong> homes by building type (single-family detached, attached, 2, 3 or 4, 5 to 9, 10 to 19, 20 or more, mobile)',
        '<strong>DP04_0017E to DP04_0026E:</strong> year built, ten periods', '<strong>DP04_0046PE / DP04_0047PE:</strong> owner and renter shares',
        '<strong>DP04_0089E:</strong> median home value', '<strong>DP04_0134E:</strong> median gross rent', '<strong>DP04_0137PE to DP04_0142PE:</strong> rent as a share of income, six bands'
      ]), 3));

    var finding = (r.pct_mf != null ? 'In ' + name + ', ' + r.pct_mf.toFixed(1) + '% of homes are in buildings of five or more' : '') +
      (r.renter != null ? (r.pct_mf != null ? ', ' : '') + pct1(r.renter) + ' of households rent' : '') +
      (r.burdened != null ? ', and ' + pct1(r.burdened) + ' of renters pay 30% or more of income.' : '.');
    var means = T.means([
      { text: 'Buildings of five or more homes are where tax credit and market-rate apartments get built, so their share shows how deep a place\u2019s rental market is.' },
      r.level === 'state' ? { text: 'This page reads the newest one-year survey, ' + esc(String(yr)) + ', for the state. Housing costs by county reads the five-year survey so all 64 counties compare on the same years, so its figures differ slightly.' } : null
    ]);
    return head(name, (r.pct_mf != null || r.renter != null) ? esc(finding) : null) + T.onThisPage([{ id: 'mf-snap', title: 'Snapshot' }, { id: 'mf-struct-h', title: 'Building types' }, { id: 'mf-inv', title: 'Affordable inventory' }, { id: 'mf-ten', title: 'Renters' }, { id: 'mf-yb', title: 'Year built' }, { id: 'mf-lead', title: 'Leaderboards' }, { id: 'mf-all', title: 'Every county' }, { id: 'mf-help', title: 'What to look for' }], true) +
      geo + structure + snapshot + means + inventory + tenure + ybSec + boards + every + helps + dataSec +
      T.source('Census ACS data profile DP04, and CHFA, HUD and USDA property records', MF_SRC, String(d.snap.meta.pulled_at_utc || '').slice(0, 10)) +
      T.next('What to do next', [{ href: g === '08' ? '#/places' : '#/place/' + g, label: g === '08' ? 'Open a place’s needs assessment →' : 'Open the full needs assessment →' }, { href: '#/market', label: 'Run a market check', secondary: true }, { href: '#/opportunity/portfolio', label: 'See every tax credit property', secondary: true }]);
  }

  global.LabCountyCosts = { countyCosts: countyCosts, multifamily: multifamily, csv: csv, MEASURES: MEASURES, enrich: enrich };
})(window);
