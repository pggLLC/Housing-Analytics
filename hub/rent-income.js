// Rent against income, from 1980 to today. Opens on Colorado; pick a county or a town.
// Files (all Housing-Analytics paths, read from the pinned copy):
//   data/co-housing-costs/rent-income-history.json  Census long form 1980, 1990, 2000 (Colorado and counties),
//       Colorado's ACS points, towns in 2000, CPI-U, renter homes per county (scripts/build_rent_income_history.py)
//   data/co-housing-costs/county-trends.json        county ACS five-year cohorts 2005-09, 2010-14, 2020-24
//   data/hna/place-decade-trends.json               town ACS cohorts (loaded when a town is picked)
//   data/hna/projections/places.json                the "too small" rule (under 250 households), same file
//                                                    the town forecasts use
// Measures, each worked here from those medians and nothing else:
//   rent's share of income  = median gross rent x 12 / median household income
//   kept pace               = rent then x (income now / income then): the rent today if it had grown only as
//                             fast as income
// Long-form income is for the year before the census, so the file moves it to the rent year with CPI-U
// (median_hh_income_rent_year). Rent and income are then in the same dollars at every point, so comparing
// their growth needs no inflation adjustment. "After inflation" uses CPI-U to 2024. No score.
//   card(fips, place)  one county's card (used on the HNA afford chapter)
//   widget(id, sel)    picker, period buttons, the card with its line, the change map and the county chart
(function (global) {
  'use strict';

  var Shell = global.LabShell, UI = global.LabUI, T = global.LabTpl, CA = global.LabChangeArrows;
  var esc = Shell.esc;
  var FILES = { t: 'data/co-housing-costs/county-trends.json', h: 'data/co-housing-costs/rent-income-history.json' };
  var TOWN_FILES = { p: 'data/hna/place-decade-trends.json', s: 'data/hna/projections/places.json' };
  var REPO = 'https://github.com/pggLLC/Housing-Analytics/blob/main/data/co-housing-costs/rent-income-history.json';
  var ACS = 'https://data.census.gov/table/ACSDT5Y2024.B25064';
  var LONG = 'https://www2.census.gov/library/publications/2011/compendia/usa-counties/excel/';
  var COMPARE = 'https://www.census.gov/programs-surveys/acs/guidance/comparing-acs-data.html';
  var BIG = 11, CO = '08';
  var PERIODS = [{ id: '1980', label: 'Since 1980' }, { id: '2000', label: 'Since 2000' }, { id: '2010-14', label: 'Last 10 years' }];
  var END = '2020-24';

  var m = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
  var num = function (v) { return Math.round(v).toLocaleString('en-US'); };
  var pct = function (v) { return Math.round(v * 100) + '%'; };
  var spct = function (v) { return (v < 0 ? '−' : '+') + Math.abs(Math.round(v * 100)) + '%'; };
  var sgn = function (v) { return (v < 0 ? '−' : '+') + m(Math.abs(v)); };
  // Shares to one decimal, the same rounding as the change in points, so 16.4% → 20.6% reads with +4.2 points.
  var sp = function (p) { return (Math.round(share(p) * 1000) / 10).toFixed(1) + '%'; };
  var pts = function (v) { var r = Math.round(v * 10) / 10; return (r < 0 ? '−' : '+') + Math.abs(r).toFixed(1) + ' points'; };
  var nice = function (p) { return String(p).replace('-', '–'); };
  var share = function (x) { return x.r * 12 / x.i; };

  // ---------- data ----------
  var built = null;
  function cohortPoints(list) {
    var lab = { 2009: '2005-09', 2014: '2010-14', 2024: '2020-24' };
    return (list || []).filter(function (c) { return lab[c.year] && c.median_gross_rent > 0 && c.median_hh_income > 0; })
      .map(function (c) { return { p: lab[c.year], y: c.year, r: c.median_gross_rent, i: c.median_hh_income }; });
  }
  function rows() {
    var s = UI.load(FILES);
    if (s.error) return { error: s.error };
    if (!s.data) return null;
    if (built) return built;
    var t = s.data.t, h = s.data.h, geo = {};
    geo[CO] = { g: CO, n: 'Colorado', kind: 'state',
      pts: h.colorado.map(function (x) { return { p: x.period, y: x.rent_year, r: x.median_gross_rent, i: x.median_hh_income_rent_year }; }) };
    Object.keys(t.counties).forEach(function (g) {
      var c = t.counties[g], hc = (h.counties || {})[g] || {};
      var dec = (hc.decennial || []).map(function (x) { return { p: x.period, y: x.rent_year, r: x.median_gross_rent, i: x.median_hh_income_rent_year }; });
      var co = c.acs_cohorts || [];
      geo[g] = { g: g, n: String(c.county_name).replace(/ County, Colorado$/, '').replace(/, Colorado$/, ''), kind: 'county',
        pts: dec.concat(cohortPoints(co)), hu: (co[co.length - 1] || {}).total_housing_units || 0, renters: hc.renter_homes_2020_24 || 0,
        missing: hc.decennial_missing_reason || '' };
    });
    var counties = Object.keys(geo).filter(function (g) { return g !== CO; });
    var big = counties.slice().sort(function (a, b) { return geo[b].hu - geo[a].hu; }).slice(0, BIG);
    built = { geo: geo, counties: counties, big: big, h: h, cpi: h.meta.cpi_u_annual, date: String(h.meta.generated || '').slice(0, 10) };
    return built;
  }
  // Towns: loaded on first pick. Too small (under 250 households) gets a note and the county, not a line.
  var towns = null;
  function townRows(d) {
    var s = UI.load(TOWN_FILES);
    if (s.error) return { error: s.error };
    if (!s.data) return null;
    if (towns) return towns;
    towns = {};
    var p2000 = d.h.places_2000 || {}, proj = (s.data.s || {}).places || {};
    Object.keys(s.data.p.places || {}).forEach(function (g) {
      var p = s.data.p.places[g], pr = proj[g] || {}, y0 = (p2000[g] || {}).y2000 || {};
      var list = (y0.median_gross_rent > 0 && y0.median_hh_income_rent_year > 0 ? [{ p: '2000', y: 2000, r: y0.median_gross_rent, i: y0.median_hh_income_rent_year }] : [])
        .concat(cohortPoints(p.acs_cohorts));
      towns[g] = { g: g, n: p.place_name, kind: 'town', pts: list, county: pr.containing_county || null,
        small: !!pr.too_small, hh: (pr.household_inputs || {}).place_households };
    });
    return towns;
  }
  function find(d, g) {
    if (d.geo[g]) return d.geo[g];
    var tw = towns || {};
    return tw[g] || null;
  }

  // One geography over one period: base point, end point and every figure the card shows.
  function over(d, x, period) {
    var by = {}; x.pts.forEach(function (p) { by[p.p] = p; });
    var b = by[END];
    if (!b) return null;
    var a = by[period], fell = false;
    if (!a) { a = x.pts[0]; fell = true; }
    if (!a || a === b) return null;
    var kept = a.r * b.i / a.i, cpi = d.cpi, inf = cpi[String(b.y)] / cpi[String(a.y)];
    return { a: a, b: b, fell: fell, kept: kept, extra: b.r - kept, rp: b.r / a.r - 1, ip: b.i / a.i - 1,
      rReal: inf ? b.r / (a.r * inf) - 1 : null, iReal: inf ? b.i / (a.i * inf) - 1 : null, ds: share(b) - share(a) };
  }

  function sourceLine(d) {
    return T.source('U.S. Census Bureau: 1980, 1990 and 2000 Census long form (USA Counties); 2000 Census SF3 for towns; American Community Survey 5-year medians 2005–09, 2010–14 and 2020–24 (B25064 rent, B19013 income), as gathered by COHO', REPO, d.date) +
      '<p class="note ri-note">Long-form income is for the year before the census; we move it to the rent year with the BLS consumer price index (CPI-U), and “after inflation” uses the same index to 2024. ' +
      'Census says long-form and survey figures can be compared with care (<a href="' + COMPARE + '" rel="noopener">how</a>). Small places have wide survey margins. ' +
      '<a href="' + LONG + '" rel="noopener">Long-form county file</a> · <a href="' + ACS + '" rel="noopener">ACS table</a>.</p>';
  }

  // ---------- line: rent's share of income at every point ----------
  function line(x, o) {
    var P = x.pts, W = 340, H = 176, L = 34, R = 16, top = 26, bot = 136;
    var y0 = 1978, y1 = 2026, vals = P.map(share);
    var lo = Math.floor(Math.min.apply(null, vals) * 20) / 20, hi = Math.ceil(Math.max.apply(null, vals) * 20) / 20;
    if (hi - lo < 0.1) hi = lo + 0.1;
    var X = function (y) { return L + (y - y0) / (y1 - y0) * (W - L - R); }, Y = function (v) { return bot - (v - lo) / (hi - lo) * (bot - top); };
    var grid = '';
    for (var v = lo; v <= hi + 1e-9; v += 0.05) grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="ri-ln-grid"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" class="ri-ln-y">' + Math.round(v * 100) + '%</text>';
    var path = 'M' + P.map(function (p) { return X(p.y - (p.p.length > 4 ? 2 : 0)).toFixed(1) + ',' + Y(share(p)).toFixed(1); }).join('L');
    var lastX = -99, row = 0;
    var dots = P.map(function (p, k) {
      var cx = X(p.y - (p.p.length > 4 ? 2 : 0)), cy = Y(share(p)), on = o && (p.p === o.a.p || p.p === o.b.p);
      var lbl = P.length <= 6 || on || k === P.length - 1;
      row = cx - lastX < 40 ? 1 - row : 0; lastX = cx;
      var xl = p.p.length > 4 ? '’' + p.p.slice(2, 4) + '–' + p.p.slice(5) : p.p;
      return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (on ? 6 : 4) + '" class="ri-ln-dot' + (on ? ' ri-ln-on' : '') + '"/>' +
        (lbl ? '<text x="' + cx.toFixed(1) + '" y="' + (cy - 10).toFixed(1) + '" class="ri-ln-v' + (on ? ' ri-ln-von' : '') + '">' + Math.round(share(p) * 100) + '%</text>' : '') +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 18 + row * 13) + '" class="ri-ln-x">' + xl + '</text>';
    }).join('');
    var alt = 'Rent as a share of income in ' + (x.kind === 'state' ? 'Colorado' : x.n + (x.kind === 'county' ? ' County' : '')) + ': ' +
      P.map(function (p) { return nice(p.p) + ' ' + Math.round(share(p) * 100) + '%'; }).join(', ') + '.';
    return '<svg class="ri-line" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(alt) + '">' + grid +
      '<path d="' + path + '" class="ri-ln-path"/>' + dots + '</svg>';
  }

  // ---------- one place ----------
  function title(x) { return x.kind === 'state' ? 'Colorado' : x.kind === 'county' ? x.n + ' County' : x.n; }
  function cardBody(d, x, period, place) {
    if (x.small) {
      var cn = x.county && d.geo[x.county] ? d.geo[x.county] : null;
      return '<div class="ri-text"><p class="ri-kick">' + esc(x.n) + '</p><h3 class="ri-h">Too small for a reliable trend</h3>' +
        '<p>' + esc(x.n) + ' has ' + (x.hh != null ? 'about ' + num(x.hh) + ' households' : 'fewer than 250 households') + '. Under 250, the survey’s margins are too wide to read a trend (the same cut-off the town forecasts use).</p>' +
        (cn ? '<p><button type="button" class="ri-all" data-ri-go="' + cn.g + '">Show ' + esc(cn.n) + ' County instead</button></p>' : '') + '</div>';
    }
    var o = over(d, x, period);
    if (!o) return '<div class="ri-text"><p class="ri-kick">' + esc(title(x)) + '</p><p>Not enough survey years to show a trend here.</p></div>';
    var up = o.extra >= 0, mx = Math.max(o.rp, o.ip, 0.0001), w = function (v) { return Math.max(0, v / mx * 100).toFixed(0); };
    var yrs = nice(o.a.p) + ' to ' + nice(o.b.p);
    var note = o.fell ? '<p class="note">' + esc(title(x)) + '’s figures start in ' + nice(o.a.p) + (x.missing ? ' (' + esc(x.missing.split(';')[0]) + ')' : x.kind === 'town' ? ' (town figures start in 2000, and only for incorporated towns)' : '') + '.</p>' : '';
    return '<div class="ri-text"><p class="ri-kick">' + esc(title(x)) + (place ? ' · the county ' + esc(place) + ' is in' : '') + '</p>' +
      '<h3 class="ri-h">' + (up ? 'Rent has grown faster than income' : 'Income has grown faster than rent') + '</h3>' +
      '<p>Since ' + nice(o.a.p) + ', the typical rent went up <strong>' + pct(o.rp) + '</strong> and the typical household’s income went up <strong>' + pct(o.ip) + '</strong>.' +
      (o.rReal != null ? ' After inflation: rent <strong>' + spct(o.rReal) + '</strong>, income <strong>' + spct(o.iReal) + '</strong>.' : '') + '</p>' + note +
      '<div class="ri-take"><p class="ri-big' + (up ? '' : ' ri-down') + '">' + sgn(o.extra) + '</p><p>a month: today’s rent of <strong>' + m(o.b.r) + '</strong> against <strong>' + m(o.kept) +
      '</strong> if rent had only kept pace with income.</p></div></div>' +
      '<div class="ri-viz"><p class="ri-vt">Median rent against median income, every Census count we have</p>' + line(x, o) +
      '<p class="ri-lnote">A year of median rent came to <strong>' + sp(o.a) + '</strong> of median household income in ' + nice(o.a.p) + ' and <strong>' + sp(o.b) + '</strong> in ' + nice(o.b.p) + ' (' + pts(o.ds * 100) + '). This compares two medians; it is not the share of income any renter pays.</p>' +
      '<div class="ri-cmp-wrap" role="img" aria-label="' + esc(title(x) + ', ' + yrs + ': median rent up ' + pct(o.rp) + ', from ' + m(o.a.r) + ' to ' + m(o.b.r) + ' a month; median household income up ' + pct(o.ip) + ', from ' + m(o.a.i) + ' to ' + m(o.b.i) + ' a year.') + '">' +
      '<p class="ri-vt">How much each grew, ' + yrs + '</p>' +
      '<div class="ri-cmp"><span class="ri-t">Typical rent</span><b>+' + pct(o.rp) + '</b><span class="ri-bar ri-rent" style="width:' + w(o.rp) + '%"></span><span class="ri-n">' + m(o.a.r) + ' → ' + m(o.b.r) + ' a month</span></div>' +
      '<div class="ri-cmp"><span class="ri-t">Typical household income</span><b>+' + pct(o.ip) + '</b><span class="ri-bar ri-inc" style="width:' + w(o.ip) + '%"></span><span class="ri-n">' + m(o.a.i) + ' → ' + m(o.b.i) + ' a year</span></div></div></div>';
  }
  function card(fips, place) {
    var d = rows();
    if (!d) return '<p role="status" class="note">Loading rent and income…</p>';
    if (d.error) return '<p class="note">Rent against income did not load (' + esc(d.error) + ').</p>';
    var x = d.geo[String(fips || '')];
    if (!x || x.kind !== 'county') return '';
    return '<section class="ri-card" aria-label="Rent against income in ' + esc(x.n) + ' County">' + cardBody(d, x, '2000', place) +
      '<div class="ri-foot">' + sourceLine(d) + '<p class="ri-more-link"><a href="#/places/deep-dive">Every county, 1980 to today, on the Colorado deep dive →</a></p></div></section>';
  }

  // ---------- counties: who outran whom, for the period ----------
  function countyStats(d, period) {
    var list = [];
    d.counties.forEach(function (g) {
      var x = d.geo[g], o = over(d, x, period);
      if (o && !o.fell) list.push({ g: g, n: x.n, o: o, hu: x.hu, renters: x.renters });
    });
    list.sort(function (a, b) { return b.o.extra - a.o.extra; });
    return { list: list, up: list.filter(function (c) { return c.o.extra > 0; }).length,
      worse: list.filter(function (c) { return c.o.ds * 100 >= 1; }).length, better: list.filter(function (c) { return c.o.ds * 100 <= -1; }).length };
  }
  function chart(d, st, cs) {
    var list = cs.list.filter(function (c) { return st.all || d.big.indexOf(c.g) > -1 || c.g === st.sel; });
    var lo = Math.floor(Math.min.apply(null, list.map(function (c) { return Math.min(c.o.kept, c.o.b.r); })) / 250) * 250;
    var hi = Math.ceil(Math.max.apply(null, list.map(function (c) { return Math.max(c.o.kept, c.o.b.r); })) / 250) * 250;
    var x = function (v) { return ((v - lo) / (hi - lo) * 100).toFixed(1); };
    var step = hi - lo > 1500 ? 500 : 250, ticks = '', i = 0;
    for (var v = lo; v <= hi; v += step, i++) ticks += '<span class="ri-tk' + (i % 2 ? ' ri-odd' : '') + '" style="left:' + x(v) + '%">' + m(v) + '</span>';
    var since = nice(st.period);
    return '<div class="ri-text"><p class="ri-kick">Colorado counties</p><h3 class="ri-h">Rent outran income in ' + cs.up + ' of ' + cs.list.length + ' counties ' + (st.period === '2010-14' ? 'over the last 10 years' : 'since ' + since) + '</h3>' +
      '<p>Each row is one county. The <span class="ri-kp">blue dot</span> is what the typical rent would be in 2020–24 if it had grown only as fast as household income since ' + since + '. The <span class="ri-kr">orange dot</span> is the typical rent in 2020–24.</p>' +
      '<p class="ri-take ri-take-plain">The shaded bar between the dots is what renters pay on top, every month. Rows are sorted by that gap, largest first. Tap a row to show that county above.</p></div>' +
      '<div class="ri-viz"><p class="ri-legend"><span><i class="ri-sw ri-sw-k"></i>If rent had kept pace with income since ' + since + '</span><span><i class="ri-sw ri-sw-r"></i>Rent in 2020–24</span><span><i class="ri-sw ri-sw-x"></i>Extra each month</span></p>' +
      '<div class="ri-g3 ri-head" aria-hidden="true"><span>County</span><span>Monthly rent, 2020–24</span><span>Extra</span></div>' +
      '<ul class="ri-dots">' + list.map(function (c) {
        var a = Math.min(c.o.kept, c.o.b.r), b = Math.max(c.o.kept, c.o.b.r);
        return '<li class="ri-g3' + (c.g === st.sel ? ' ri-sel' : '') + '"><button type="button" class="ri-row" data-ri-g="' + c.g + '" aria-pressed="' + (c.g === st.sel) + '" ' +
          'aria-label="' + esc(c.n) + ': rent in 2020–24 ' + m(c.o.b.r) + ', ' + m(c.o.kept) + ' if it had kept pace with income since ' + since + ', ' + sgn(c.o.extra) + ' a month" title="' + esc(c.n) + ': rent ' + m(c.o.b.r) + ' · kept pace ' + m(c.o.kept) + ' · ' + sgn(c.o.extra) + ' a month">' +
          '<span class="ri-cn">' + esc(c.n) + '</span><span class="ri-tr"><span class="ri-gap" style="left:' + x(a) + '%;width:' + (x(b) - x(a)).toFixed(1) + '%"></span>' +
          '<span class="ri-dt ri-dt-k" style="left:' + x(c.o.kept) + '%"></span><span class="ri-dt ri-dt-r" style="left:' + x(c.o.b.r) + '%"></span></span>' +
          '<span class="ri-ev">' + sgn(c.o.extra) + '</span></button></li>';
      }).join('') + '</ul>' +
      '<div class="ri-g3 ri-axis" aria-hidden="true"><span></span><span><span class="ri-ax">' + ticks + '</span><span class="ri-axt">Dollars a month</span></span><span></span></div>' +
      '<button type="button" class="ri-all" data-ri-all>' + (st.all ? 'Show the ' + BIG + ' largest counties' : 'Show all ' + cs.list.length + ' counties') + '</button></div>';
  }

  // ---------- change map: one arrow per county ----------
  var GEO = 'data/boundaries/counties_co.geojson';
  var PLACES = 'data/co-place-boundaries.geojson', MARKET_TYPES = 'data/market/market-types.json', shapes = null;
  // Incorporated towns of 20,000 people or more, as a gray underlay. Loads after the map; the map draws without it first.
  function townUnderlay(sh) {
    if (sh.withTowns) return;
    var p = UI.load({ pl: PLACES, mt: MARKET_TYPES });
    if (!p.data || !CA || !CA.context) return;
    var lines = Object.keys(sh.by).map(function (g) { return sh.by[g]; }).join('');
    sh.ctx = CA.context(sh.pr, { size: 13, town: function (pp, name, dd, style) {
      var lab = esc(name) + ': tap for its rent and income';
      return '<path class="ca-town" d="' + dd + '"' + style + ' data-ri-g="' + esc(pp.geoid) + '" data-ri-town tabindex="0" role="button" aria-label="' + lab + '"><title>' + lab + '</title></path>';
    }, places: CA.bigTowns(p.data.pl, p.data.mt), lines: lines });
    sh.withTowns = true;
  }
  function geo() {
    var s = UI.load({ geo: GEO });
    if (s.error || !s.data) return s.error ? { error: s.error } : null;
    if (shapes) return shapes;
    // Plain equirectangular at Colorado's middle latitude: the state is a near-rectangle, so this reads true.
    // The statewide box from site/map-kit.js, drawn 400 units wide.
    var B = global.LabMap.BOX, W = 400, x0 = B.w, x1 = B.e, y0 = B.s, y1 = B.n, k = Math.cos(39 * Math.PI / 180), sc = W / ((x1 - x0) * k), H = Math.round((y1 - y0) * sc);
    var pr = function (c) { return [(c[0] - x0) * k * sc, (y1 - c[1]) * sc]; };
    var pt = function (c) { var q = pr(c); return q[0].toFixed(1) + ',' + q[1].toFixed(1); };
    shapes = { W: W, H: H, pr: pr, by: {}, at: CA ? CA.centres(s.data.geo.features, pr) : {}, ctx: CA && CA.context ? CA.context(pr, { size: 13 }) : null };
    s.data.geo.features.forEach(function (f) {
      var polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      shapes.by[f.properties.GEOID] = polys.map(function (poly) { return poly.map(function (ring) { return 'M' + ring.map(pt).join('L') + 'Z'; }).join(''); }).join('');
    });
    return shapes;
  }
  var RENT_CUTS = [2000, 20000];
  function map(d, st, cs) {
    var sh = geo();
    if (!sh) return '<p role="status" class="note">Loading the county map…</p>';
    if (sh.error) return '<p class="note">The county map did not load (' + esc(sh.error) + ').</p>';
    townUnderlay(sh);
    if (!CA) return '';
    var change = {}, weight = {}, by = {};
    cs.list.forEach(function (c) { change[c.g] = c.o.ds * 100; weight[c.g] = c.renters; by[c.g] = c; });
    var since = st.period === '2010-14' ? '2010–14' : st.period, sel = by[st.sel];
    var flat = cs.list.length - cs.worse - cs.better;
    // A county with no start-year figure gets the kit's "not published" hatch, so it never reads as "about the same".
    var mk = global.LabMap && global.LabMap.marks ? global.LabMap.marks() : null;
    var alt = 'Map of Colorado counties with one arrow each for the change in rent’s share of income from ' + since + ' to 2020–24: ' +
      cs.worse + ' counties where median rent rose a point or more against median income, ' + cs.better + ' where income caught up, ' + flat + ' within a point. ' + cs.list.length + ' counties compared; Broomfield has no 2000 county figure.';
    return '<div class="ri-text"><p class="ri-kick">Where it is getting worse</p><h3 class="ri-h">Which way rent is moving against income, ' + esc(since) + ' to 2020–24</h3>' +
      // Said with its threshold, so it reads beside the chart's "outran income in N counties", which counts any gain (thread "Make analysis pages tell a story", 11-06).
      '<p class="ri-take">Median rent rose a point or more against median income in <strong>' + cs.worse + '</strong> counties. Income caught up in <strong>' + cs.better + '</strong>. ' + flat + ' moved less than a point either way.' +
      ' <span class="ri-count">' + cs.list.length + ' counties compared' + (cs.list.length < 64 ? '; Broomfield has no ' + (st.period === '2010-14' ? '2010–14' : st.period === '2000' ? '2000' : 'earlier') + ' county figure (it became a county in 2001)' : '') + '.</span>' +
      (st.period === '2010-14' ? ' Over the longer run the picture is much clearer: try “Since 1980”.' : '') + '</p>' +
'</div>' +
      '<div class="ri-viz"><svg class="ri-map ri-amap" viewBox="-6 -40 ' + (sh.W + 12) + ' ' + (sh.H + 46) + '" role="img" aria-label="' + esc(alt) + '">' + (mk ? mk.defs : '') +
      Object.keys(sh.by).map(function (g) {
        var c = by[g], label = c ? esc(c.n) + ' County: median rent against median income ' + sp(c.o.a) + ' in ' + nice(c.o.a.p) + ', ' + sp(c.o.b) + ' in 2020–24 (' + pts(c.o.ds * 100) + ')' :
          esc((d.geo[g] || {}).n || '') + ' County: no ' + esc(since) + ' figure, so not compared';
        return '<path class="ri-base' + (c ? '' : ' ri-none') + (g === st.sel ? ' ri-on' : '') + '"' + (!c && mk ? ' style="fill:' + mk.none + '"' : '') + ' d="' + sh.by[g] + '" data-ri-g="' + g + '" tabindex="0" role="button" aria-label="' + label + '"><title>' + label + '</title></path>';
      }).join('') +
      CA.layer({ points: sh.at, change: change, weight: weight, weightCuts: RENT_CUTS, per: 3.4, maxLen: 38, widths: [1.8, 3, 4.4], pick: st.sel, context: sh.ctx }) + '</svg>' +
      CA.legend({ worse: ['Rent pulling ahead', 'rent takes more of income'], better: ['Income catching up', 'rent takes less of income'], flat: ['About the same', 'within 1 point'], none: ['Not compared', 'no county figure for the start year'],
        size: 'Longer arrow: bigger change. Thicker arrow: more renter households. Gray shapes: cities and towns of 20,000 or more.' }) +
      (sel ? '<p class="ri-info"><b>' + esc(sel.n) + ' County</b>: a year of median rent came to ' + sp(sel.o.a) + ' of median household income in ' + nice(sel.o.a.p) + ' and ' + sp(sel.o.b) + ' in 2020–24 (' + pts(sel.o.ds * 100) + ').' + (sel.renters < RENT_CUTS[0] ? ' Few renters: wide survey margins.' : '') + ' Tap any county.</p>' :
        (d.geo[st.sel] && d.geo[st.sel].kind === 'county' ? '<p class="ri-info">' + esc(d.geo[st.sel].n) + ' County has no ' + esc(since) + ' figure, so it is not compared.' + (st.sel === '08014' ? ' Broomfield became a county in 2001.' : '') + '</p>' : '<p class="ri-info">Tap a county to see its numbers.</p>')) + '</div>';
  }

  // ---------- the widget ----------
  var state = {};
  function picker(d, st) {
    var opt = function (x) { return '<option value="' + x.g + '"' + (x.g === st.sel ? ' selected' : '') + '>' + esc(x.n) + '</option>'; };
    var cs = d.counties.slice().sort(function (a, b) { return d.geo[a].n.localeCompare(d.geo[b].n); }).map(function (g) { return opt(d.geo[g]); }).join('');
    var tw = towns ? Object.keys(towns).sort(function (a, b) { return towns[a].n.localeCompare(towns[b].n); }).map(function (g) { return opt(towns[g]); }).join('') : '';
    return '<div class="ri-pick"><label for="ri-sel-' + st.id + '">Show</label><select id="ri-sel-' + st.id + '" data-ri-pick>' + opt(d.geo[CO]) +
      '<optgroup label="Counties">' + cs + '</optgroup>' +
      (towns ? '<optgroup label="Towns and cities">' + tw + '</optgroup>' : '<option value="towns">A town or city…</option>') + '</select></div>';
  }
  function periods(st) {
    return '<div class="ri-periods" role="group" aria-label="Compare 2020–24 with">' + PERIODS.map(function (p) {
      return '<button type="button" class="ri-per" data-ri-per="' + p.id + '" aria-pressed="' + (p.id === st.period) + '">' + p.label + '</button>';
    }).join('') + '</div>';
  }
  function inner(id) {
    var d = rows(), st = state[id];
    if (st.wantTowns || (st.sel && !d.geo[st.sel])) {
      var tw = townRows(d);
      if (tw && !tw.error) st.wantTowns = false;
      if (tw && tw.error) { st.wantTowns = false; st.sel = CO; }
    }
    var x = find(d, st.sel) || d.geo[CO], cs = countyStats(d, st.period);
    var loadingTowns = st.wantTowns ? '<p role="status" class="note">Loading towns…</p>' : '';
    return picker(d, st) + periods(st) + loadingTowns +
      '<section class="ri-card" aria-live="polite" aria-label="Rent against income in ' + esc(title(x)) + '">' + cardBody(d, x, st.period) + '</section>' +
      foldMore(id, '<section class="ri-card ri-mapcard" aria-label="Which way rent is moving against income, by county">' + map(d, st, cs) + '<div class="ri-foot">' + sourceLine(d) + '<p class="note ri-note">County lines and town limits: U.S. Census Bureau TIGER/Line. Broomfield became a county in 2001, so it has no arrow before 2005–09.</p></div></section>' +
      '<section class="ri-card ri-wide" aria-label="Rent against income, Colorado counties">' + chart(d, st, cs) + dataBlock(d) + '<div class="ri-foot">' + sourceLine(d) + '</div></section>', cs);
  }
  // The county map and the ranked county chart fold shut under the place's own card (paul, 10 Nov: phone length).
  // A fold the reader opened stays open when a pick redraws the widget (LabTpl keeps fold state).
  function foldMore(id, html, cs) {
    var T = global.LabTpl;
    if (!T || !T.fold) return html;
    return T.fold('Every county, mapped and ranked', 'Rent outran income in ' + cs.up + ' of ' + cs.list.length + ' Colorado counties over this period.', html, { id: 'ri-more-' + id, level: 3 });
  }
  // "Show the numbers": every point behind the line, the map and the chart, as the files give them.
  function dataBlock(d) {
    var VD = global.LabVizData;
    if (!VD) return '';
    var head = ['Place', 'Period', 'Median gross rent ($/mo)', 'Median household income, rent-year dollars ($)', 'Rent as a share of income'];
    var out = [];
    [CO].concat(d.counties.slice().sort(function (a, b) { return d.geo[a].n.localeCompare(d.geo[b].n); })).forEach(function (g) {
      var x = d.geo[g];
      x.pts.forEach(function (p) { out.push([title(x), nice(p.p), p.r, Math.round(p.i), Math.round(share(p) * 1000) / 10 + '%']); });
    });
    return VD.block('Rent against income, Colorado and its counties, 1980 to 2020–24', head, out);
  }
  function widget(id, sel) {
    var d = rows();
    if (!d) return '<p role="status" class="note">Loading rent and income…</p>';
    if (d.error) return '<p class="note">Rent against income did not load (' + esc(d.error) + ').</p>';
    if (!state[id]) state[id] = { id: id, sel: sel && d.geo[sel] ? sel : CO, period: '2000', all: false };
    return '<div class="ri-wrap" id="ri-' + id + '" data-ri="' + id + '">' + inner(id) + '</div>';
  }
  function redraw(wrap, focusSel) {
    var id = wrap.getAttribute('data-ri');
    wrap.innerHTML = inner(id);
    if (focusSel) { var el = wrap.querySelector(focusSel); if (el) el.focus(); }
  }
  document.addEventListener('change', function (e) {
    var s = e.target.closest && e.target.closest('[data-ri-pick]'); if (!s) return;
    var w = s.closest('[data-ri]'), st = state[w.getAttribute('data-ri')];
    if (s.value === 'towns') { st.wantTowns = true; townRows(rows()); } else st.sel = s.value;
    redraw(w, '[data-ri-pick]');
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ri-g],[data-ri-all],[data-ri-per],[data-ri-go]'); if (!b) return;
    var w = b.closest('[data-ri]'); if (!w) return;
    var st = state[w.getAttribute('data-ri')];
    if (b.hasAttribute('data-ri-all')) { st.all = !st.all; redraw(w, '[data-ri-all]'); return; }
    if (b.hasAttribute('data-ri-per')) { st.period = b.getAttribute('data-ri-per'); redraw(w, '[data-ri-per="' + st.period + '"]'); return; }
    // A town shape on the map: load the towns (as the picker does) and show that town.
    if (b.hasAttribute('data-ri-town')) { st.wantTowns = true; townRows(rows()); }
    st.sel = b.getAttribute(b.hasAttribute('data-ri-go') ? 'data-ri-go' : 'data-ri-g');
    redraw(w, b.hasAttribute('data-ri-go') ? '[data-ri-pick]' : b.tagName.toLowerCase() + '[data-ri-g="' + st.sel + '"]');
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('path[data-ri-g]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  global.LabRentIncome = { card: card, widget: widget, rows: rows, over: over, countyStats: countyStats, share: share };
})(window);
