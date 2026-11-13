// The need map on Places and need: every county measure the cohoanalytics.com homepage map offers, plus the
// lab's own homes-per-10 measure, on one map. Select a county and a side panel names its figure on every
// measure, where it ranks and what that means; pick a measure there, or step with the arrows, and the map
// redraws with the county still picked. Figures come from the public site's files as published: the HNA
// ranking (need score) and js/county-measures.js (the six gap and cost measures, with its rules for counties
// too uncertain to rank). The only arithmetic here is the four equal-count groups the homepage map draws,
// and each county's place in the order.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  // A port into the public site sets LAB_LIVE to its own root, so these links stay on that site.
  var LIVE = global.LAB_LIVE != null ? global.LAB_LIVE : 'https://cohoanalytics.com/';
  var doc = global.document;

  var num = function (n) { return n == null ? null : Math.round(n).toLocaleString('en-US'); };
  var money = function (n) { return n == null ? null : '$' + Math.round(n).toLocaleString('en-US'); };

  // The lab's one map ramp for "more of something" (graphics checklist C3; the same teal steps as the money,
  // housing cost and deep dive maps), light to dark; darker always means more need, so stepping through the
  // measures reads the same way on each. (The homepage map draws subsidized homes and building pace the other
  // way round.) "Too uncertain to rank" is a warm grey, at least 13 CIE76 units from every ramp step and the paper.
  var RAMP4 = ['var(--map-1)', 'var(--map-2)', 'var(--map-4)', 'var(--map-5)'];
  var GREY = 'var(--map-none)', NONE = 'var(--paper)';

  var SRC = {
    acsGap: ['Census ACS 2020–2024 and HUD FY2026 income limits', 'https://data.census.gov/table/ACSDT5Y2024.B25118'],
    acs: ['Census ACS 2020–2024 five-year', 'https://data.census.gov/table/ACSDP5Y2024.DP04'],
    chas: ['HUD CHAS 2018–2022', 'https://www.huduser.gov/portal/datasets/cp.html'],
    bps: ['Census Building Permits Survey, 2021–2025', 'https://www.census.gov/construction/bps/'],
    sdo: ['State Demography Office forecast', 'https://demography.dola.colorado.gov/'],
    rank: ['COHO needs ranking', LIVE + 'hna-comparative-analysis.html']
  };

  // Need score bands: the homepage map's (js/components/home-need-map.js BANDS).
  var NEED_BANDS = [{ min: 70, label: 'Highest' }, { min: 50, label: 'Elevated' }, { min: 30, label: 'Moderate' }, { min: -Infinity, label: 'Lower' }];
  function needBand(v) { return NEED_BANDS.filter(function (b) { return v >= b.min; })[0]; }

  // worse: which end of the measure is more need. fmt: the homepage's own formats (CountyMeasures.format).
  var MEASURES = [
    { id: 'per10', label: 'Homes priced, lowest incomes', worse: 'low',
      what: 'Homes renting for what households at or below 30% of area median income (AMI) can pay, for every 10 such renter households. Under 10 means more of these renters than homes they can afford.',
      src: [SRC.acsGap] },
    { id: 'need', label: 'Priority score (need and opportunity)', worse: 'high',
      what: 'One score from 0 to 100. Just over half (55%) is need: homes short, households overpaying, prices against incomes, expected growth and crowding. The rest (45%) is opportunity: economic mobility, walkability, nearby services and federal tax credit target areas.',
      src: [SRC.rank] },
    { id: 'missing_per_100_lte30', label: 'Homes missing, lowest incomes', worse: 'high', fmt: 'num0',
      what: 'For every 100 renter households at or below 30% AMI, how many have no affordable home that a higher-income household is not already in.',
      grey: 'Fewer than 100 such households, or most of the homes counted as open are empty units (often seasonal), so a figure here would mislead.',
      src: [SRC.chas] },
    { id: 'short_per_100_lte50', label: 'Homes still short, low incomes', worse: 'high', fmt: 'num0',
      what: 'For every 100 renter households at or below 50% AMI, how many still have no affordable home once every affordable rental is counted, subsidized or market-rate.',
      grey: 'Fewer than 100 such households, or more vacant than occupied affordable rentals, so a figure here would mislead.',
      src: [SRC.chas] },
    { id: 'rent_to_income', label: 'Rent as a share of income', worse: 'high', fmt: 'pctWhole',
      what: 'Twelve months of median rent against median household income. A household paying more than 30% of income counts as cost burdened.',
      grey: 'The survey margins for this county are too wide to rank it.',
      src: [SRC.acs] },
    { id: 'home_value_to_income', label: 'Home price to income', worse: 'high', fmt: 'ratio',
      what: 'Median home value as a multiple of median household income. Lenders’ rule of thumb is about three times income.',
      grey: 'The survey margins for this county are too wide to rank it.',
      src: [SRC.acs] },
    { id: 'subsidized_per_100_lte80', label: 'Subsidized homes', worse: 'low', fmt: 'num0',
      what: 'Income-restricted homes on record (CHFA tax credit and preservation lists, HUD multifamily, USDA Rural Development and a local housing authority roster) for every 100 renter households at or below 80% AMI, the ceiling most of these programs serve. Read it as a rough share.',
      grey: 'Too few such households to compare, or more homes on record than households counted.',
      src: [['CHFA', 'https://www.chfainfo.com/rental-housing/housing-credit/awards'], ['HUD multifamily', 'https://hudgis-hud.opendata.arcgis.com/datasets/HUD::multifamily-properties-assisted/'], ['USDA Rural Development', 'https://www.rd.usda.gov/data-sets/multi-family-housing-rentals'], SRC.chas] },
    { id: 'build_pace_vs_need', label: 'Building pace against need', worse: 'low', fmt: 'ratio',
      what: 'Homes permitted each year (2021–2025 average) against the homes needed each year over the next ten years for household growth. Below 1× is falling behind. In resort counties many new homes are second homes, so a high figure there does not mean residents are housed.',
      grey: 'The forecast needs fewer than 10 new homes a year here, too few to compare: one project swings the figure tenfold.',
      blank: 'The forecast shows no new homes needed here for household growth.',
      src: [SRC.bps, SRC.sdo] }
  ];
  var BY_ID = {}; MEASURES.forEach(function (m) { BY_ID[m.id] = m; });

  // ---- data ----
  // One request per file: the measures module and this file both read permits.json and the boundaries.
  var cache = {};
  function getJson(p) {
    if (!cache[p]) cache[p] = fetch(VENDOR + p).then(function (r) { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
    return cache[p];
  }
  var CM_FIELDS = MEASURES.filter(function (m) { return m.fmt; }).map(function (m) { return m.id; });
  var ext = { need: null, cm: null, permits: null, failed: {} }, started = false;
  function start() {
    if (started) return;
    started = true;
    getJson('data/hna/ranking-index.json').then(function (r) {
      var by = {};
      (Array.isArray(r.rankings) ? r.rankings : []).forEach(function (x) {
        var v = x && x.type === 'county' && x.metrics ? Number(x.metrics.overall_need_score) : NaN;
        if (Number.isFinite(v)) by[x.geoid] = v;
      });
      ext.need = by;
      ext.needDate = String(r.metadata && r.metadata.generatedAt || '').slice(0, 10);
    }).catch(function () { ext.failed.need = true; }).then(refresh);
    getJson('data/hna/permits.json').then(function (p) { ext.permits = p.counties || {}; }).catch(function () {}).then(refresh);
    var CM = global.CountyMeasures;
    if (!CM) { CM_FIELDS.forEach(function (f) { ext.failed[f] = true; }); return; }
    // The subsidized measure needs the property list (about 1.5 MB); the rest share one load.
    CM.loadField('rent_to_income', getJson).then(function (res) { ext.cm = res; })
      .catch(function () { CM_FIELDS.forEach(function (f) { if (f !== 'subsidized_per_100_lte80') ext.failed[f] = true; }); })
      .then(refresh)
      .then(function () { return CM.loadField('subsidized_per_100_lte80', getJson); })
      .then(function (res) { ext.cm = res; ext.inventory = true; })
      .catch(function () { ext.failed.subsidized_per_100_lte80 = true; })
      .then(refresh);
  }

  // Values for one measure: { values: {geoid: n}, unreliable: {geoid: true}, ready, failed }.
  function series(id, d) {
    if (id === 'per10') {
      var v = {}, P = global.LabPlaces;
      d.gapCounty.counties.forEach(function (c) { var x = P.per10(c); if (x != null) v[c.fips] = x; });
      return { values: v, unreliable: {}, ready: true };
    }
    if (id === 'need') return { values: ext.need || {}, unreliable: {}, ready: !!ext.need, failed: ext.failed.need };
    var ready = !!ext.cm && (id !== 'subsidized_per_100_lte80' || ext.inventory);
    return { values: ready ? ext.cm.values[id] || {} : {}, unreliable: ready ? ext.cm.unreliable[id] || {} : {}, ready: ready, failed: ext.failed[id] };
  }

  function fmt(m, v) {
    if (v == null) return null;
    if (m.id === 'per10') return v.toFixed(1);
    if (m.id === 'need') return String(Math.round(v * 10) / 10);
    return global.CountyMeasures.format(v, m.fmt);
  }

  // Shading. Need score: its four bands. Homes per 10: the lab's five fixed steps. The rest: four equal-count
  // groups of the counties that can be ranked, cut where the homepage map cuts them (a value on a cut joins
  // the lower group), then turned so darker is more need.
  function scale(m, s) {
    if (m.id === 'need') {
      return { color: function (v) { var b = needBand(v); return RAMP4[3 - NEED_BANDS.indexOf(b)]; },
        key: NEED_BANDS.slice().reverse().map(function (b, i) { return [RAMP4[i], b.label + (b.min > -Infinity ? ' (' + b.min + '+)' : ' (under 30)')]; }) };
    }
    if (m.id === 'per10') {
      var B = global.LabPlaces.MAP_BINS;
      return { color: function (v) { return B.filter(function (b) { return v >= b.min; })[0].fill; }, key: B.map(function (b) { return [b.fill, b.label]; }) };
    }
    var vals = Object.keys(s.values).filter(function (g) { return !s.unreliable[g]; }).map(function (g) { return s.values[g]; }).sort(function (a, b) { return a - b; });
    if (!vals.length) return { color: function () { return NONE; }, key: [] };
    var q = function (f) { return vals[Math.min(vals.length - 1, Math.floor(f * vals.length))]; };
    var cuts = [q(0.25), q(0.5), q(0.75)], lo = vals[0], hi = vals[vals.length - 1];
    var group = function (v) { return v <= cuts[0] ? 0 : v <= cuts[1] ? 1 : v <= cuts[2] ? 2 : 3; };
    var turn = function (i) { return m.worse === 'low' ? 3 - i : i; };
    var f = function (v) { return fmt(m, v); };
    var range = function (a, b) { return f(a) === f(b) ? f(a) : f(a) + '–' + f(b); };
    var ranges = [range(lo, cuts[0]), range(cuts[0], cuts[1]), range(cuts[1], cuts[2]), range(cuts[2], hi)];
    var key = [0, 1, 2, 3].map(function (i) { return [RAMP4[turn(i)], ranges[i]]; });
    if (m.worse === 'low') key.reverse();
    return { color: function (v) { return RAMP4[turn(group(v))]; }, key: key };
  }

  // Place in the order, most need first, among counties that can be ranked. Ties share a place.
  function rankOf(m, s, geoid) {
    var v = s.values[geoid];
    if (v == null || s.unreliable[geoid]) return null;
    var ranked = Object.keys(s.values).filter(function (g) { return !s.unreliable[g]; });
    var worse = ranked.filter(function (g) { return m.worse === 'high' ? s.values[g] > v : s.values[g] < v; }).length;
    return { n: worse + 1, of: ranked.length };
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function rankText(r) {
    if (!r) return null;
    var share = (r.n - 1) / r.of;
    var where = share < 0.25 ? 'among the quarter of counties with the most need' : share >= 0.75 ? 'among the quarter with the least need' : share < 0.5 ? 'above the middle for need' : 'below the middle for need';
    return ordinal(r.n) + ' of ' + r.of + ' counties, ' + where + '.';
  }

  // The counts behind a 'homes per 10 renters' ratio, so a small or surprising county reads right
  // (Douglas: few renters at 30% AMI, and fewer homes at their rent). Other measures add nothing.
  function countsFor(m, d, geoid) {
    if (m.id !== 'per10' || !d.gapCounty) return '';
    var c = d.gapCounty.counties.filter(function (x) { return x.fips === geoid; })[0];
    if (!c) return '';
    return ': ' + num(c.units_priced_affordable_le_ami_pct['30']) + ' homes for ' + num(c.households_le_ami_pct['30']) + ' households';
  }
  // One plain sentence on what the figure means in this county.
  function sentence(m, d, geoid, v, name) {
    var f = fmt(m, v), cm = ext.cm, c;
    if (m.id === 'per10') {
      c = d.gapCounty.counties.filter(function (x) { return x.fips === geoid; })[0];
      return 'There are ' + f + ' homes priced for every 10 renter households at or below 30% AMI (' + num(c.units_priced_affordable_le_ami_pct['30']) + ' homes, ' + num(c.households_le_ami_pct['30']) + ' households).' +
        (v < 10 ? ' These renters outnumber the homes they can afford.' : ' There are as many such homes as renters, though higher-income households rent some of them.');
    }
    if (m.id === 'need') return name + ' scores ' + f + ' out of 100, in the ' + needBand(v).label.toLowerCase() + ' band.';
    if (m.id === 'missing_per_100_lte30') return 'Of every 100 renter households at or below 30% AMI, ' + f + ' have no affordable home open to them.';
    if (m.id === 'short_per_100_lte50') return 'Of every 100 renter households at or below 50% AMI, ' + f + ' still have no affordable home.';
    if (m.id === 'rent_to_income') return 'A year of median rent (' + money(cm.values.median_gross_rent[geoid]) + ' a month) comes to ' + f + ' of the median household income (' + money(cm.values.median_hh_income[geoid]) + ').';
    if (m.id === 'home_value_to_income') return 'The median home (' + money(cm.values.median_home_value[geoid]) + ') is worth ' + f + ' the median household income (' + money(cm.values.median_hh_income[geoid]) + ').';
    if (m.id === 'subsidized_per_100_lte80') {
      c = cm.detail[geoid];
      return 'There are ' + f + ' income-restricted homes on record for every 100 renter households at or below 80% AMI' + (c ? ' (' + num(c.subsidized) + ' homes, ' + num(c.renters_lte80) + ' households).' : '.');
    }
    if (m.id === 'build_pace_vs_need') {
      var pv = ext.permits && ext.permits[geoid] && ext.permits[geoid].production_vs_need;
      var counts = pv ? ' (' + num(pv.permits_avg_annual_5yr) + ' homes permitted a year against ' + num(pv.annual_need_10yr_dola) + ' needed)' : '';
      return 'Builders permit ' + f + ' the homes needed each year' + counts + (v < 1 ? ', so the county is falling behind.' : ', enough to keep up with forecast growth.');
    }
    return '';
  }

  function srcLine(m) {
    var list = m.src.slice();
    if (m.id === 'need' && ext.needDate) list = [[SRC.rank[0] + ', ' + ext.needDate, SRC.rank[1]], ['built from Census ACS, HUD CHAS, the State Demography Office and others', null]];
    return list.map(function (x) { return x[1] ? '<a href="' + esc(x[1]) + '" rel="noopener">' + esc(x[0]) + '</a>' : esc(x[0]); }).join(' · ');
  }

  // ---- state ----
  var state = { m: 'per10', county: null, trend: '' }, lastData = null;
  function fromParams(params) {
    var m = params && params.get('m'), c = params && params.get('county');
    state.m = BY_ID[m] ? m : 'per10';
    state.county = c && /^08\d{3}$/.test(c) ? c : null;
    var tr = params && params.get('trend');
    state.trend = tr === '1980' || tr === '2000' || tr === '2010-14' ? tr : '';
  }
  function hashFor() {
    var p = new URLSearchParams();
    if (state.m !== 'per10') p.set('m', state.m);
    if (state.county) p.set('county', state.county);
    if (state.trend && state.m === 'rent_to_income') p.set('trend', state.trend);
    var x = p.toString();
    // Home shows the same map; keep the reader on the page they are on.
    var at = String((global.location && global.location.hash) || '').split('?')[0];
    return (at === '#/' || at === '' ? '#/' : '#/places') + (x ? '?' + x : '');
  }

  // ---- drawing ----
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  function xy(c) { return K.x(c[0]).toFixed(1) + ' ' + K.y(c[1]).toFixed(1); }
  function shape(g) { return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(function (p) { return p.map(function (r) { return 'M' + r.map(xy).join('L') + 'Z'; }).join(''); }).join(''); }

  // Fill and tooltip of one county under the current measure.
  function paint(m, s, sc, geoid, name) {
    var v = s.values[geoid];
    if (trendOn(m)) return { fill: NONE, tip: name + (v != null ? ': ' + fmt(m, v) + ' today' : '') };
    if (!s.ready) return { fill: NONE, tip: name + ': loading' };
    if (v == null) return { fill: NONE, tip: name + ': ' + (m.blank || 'not published') };
    if (s.unreliable[geoid]) return { fill: GREY, tip: name + ': ' + fmt(m, v) + ', too uncertain to rank' };
    return { fill: sc.color(v), tip: name + ': ' + fmt(m, v) + ' · ' + m.label.toLowerCase() };
  }

  // ---- trend (rent as a share of income only: the one measure with Census history back to 1980) ----
  // Arrows from site/change-arrows.js; figures from site/rent-income.js, which reads
  // data/co-housing-costs/rent-income-history.json and county-trends.json. The colours under the arrows go flat.
  var TRENDS = [['', 'Today'], ['2000', 'Change since 2000'], ['2010-14', 'Last 10 years']];
  function trendOn(m) { return m.id === 'rent_to_income' && state.trend && global.LabRentIncome && global.LabChangeArrows; }
  function trendStats() {
    var RI = global.LabRentIncome, d = RI && RI.rows();
    if (!d || d.error) return null;
    var cs = RI.countyStats(d, state.trend), by = {};
    cs.list.forEach(function (c) { by[c.g] = c; });
    return { cs: cs, by: by };
  }
  function trendButtons(m) {
    if (m.id !== 'rent_to_income' || !global.LabRentIncome) return '';
    return '<div class="cn-trend" role="group" aria-label="Show today or the change">' + TRENDS.map(function (t) {
      return '<button type="button" class="ri-per" data-cn-trend="' + t[0] + '" aria-pressed="' + (state.trend === t[0]) + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }
  var centresCache = null, ctxCache = null;
  function trendLayer(m, d) {
    if (!trendOn(m)) return '';
    var t = trendStats();
    if (!t) return '';
    if (!centresCache) centresCache = global.LabChangeArrows.centres(d.counties.features, function (c) { return xy(c).split(' ').map(Number); });
    var change = {}, weight = {};
    t.cs.list.forEach(function (c) { change[c.g] = c.o.ds * 100; weight[c.g] = c.renters; });
    var ctx = null, CA = global.LabChangeArrows, pl = global.LabUI.load({ pl: 'data/co-place-boundaries.geojson', mt: 'data/market/market-types.json' });
    if (CA.context) {
      if (!ctxCache || (pl.data && !ctxCache.towns)) ctxCache = { towns: !!pl.data, c: CA.context(function (c) { return xy(c).split(' ').map(Number); }, { size: 21, lineW: 0.07, town: function (pp, name, dd, style) {
          return '<a href="#/place/' + esc(pp.geoid) + '" aria-label="' + esc(name) + ': housing needs assessment"><path class="ca-town" d="' + dd + '"' + style + '><title>' + esc(name) + ': open its needs assessment</title></path></a>';
        }, keepOut: [[MAP_W * 0.7, 0, MAP_W, MAP_H * 0.14]],
        places: pl.data ? CA.bigTowns(pl.data.pl, pl.data.mt) : [],
        lines: d.counties.features.map(function (f) { return shape(f.geometry); }).join('') }) };
      ctx = ctxCache.c;
    }
    return global.LabChangeArrows.layer({ points: centresCache, change: change, weight: weight, weightCuts: [2000, 20000], per: 6, maxLen: 56, widths: [2.6, 4, 5.6], pick: state.county, context: ctx });
  }
  // The trend view's arrows bring their own city labels (site/change-arrows.js); otherwise the kit's anchor cities.
  function arrowsOrCities(m, d) { var t = trendLayer(m, d); return '<g class="cn-arrows">' + t + '</g>' + (t ? '' : K.cities()); }
  function trendKey() {
    var t = trendStats();
    var since = state.trend === '2010-14' ? '2010–14' : state.trend;
    return '<li class="cn-trend-key">' + (t ? '<p>From ' + esc(since) + ' to 2020–24, rent’s share of income rose in <strong>' + t.cs.worse + '</strong> counties and fell in <strong>' + t.cs.better + '</strong>.</p>' : '<p class="note">Loading the history…</p>') +
      global.LabChangeArrows.legend({ worse: ['Rent pulling ahead', 'rent takes more of income'], better: ['Income catching up', 'rent takes less of income'], flat: ['About the same', 'within 1 point'],
        size: 'Longer arrow: bigger change. Thicker arrow: more renter households. Gray shapes: cities and towns of 20,000 or more.' }) + '</li>';
  }
  function trendLine(g, name) {
    var t = trendStats(), c = t && t.by[g];
    if (!c) return '';
    var r = function (v) { return Math.round(v * 100) + '%'; }, ds = Math.round(c.o.ds * 1000) / 10;
    return '<p class="cn-line">Trend: rent took ' + r(c.o.a.r * 12 / c.o.a.i) + ' of the typical household’s income in ' + c.o.a.p.replace('-', '–') + ' and ' + r(c.o.b.r * 12 / c.o.b.i) + ' in 2020–24 (' + (ds < 0 ? '−' : '+') + Math.abs(ds).toFixed(1) + ' points). <a href="#/places/deep-dive">1980 to today, every county →</a></p>';
  }

  function stepper(m) {
    var i = MEASURES.indexOf(m), n = MEASURES.length;
    return '<button type="button" class="cn-step" data-cn-step="-1" aria-label="Previous measure">‹</button>' +
      '<label class="cn-pick"><span class="cn-count">Measure ' + (i + 1) + ' of ' + n + '</span><select data-cn-pick>' + MEASURES.map(function (x) {
        return '<option value="' + x.id + '"' + (x === m ? ' selected' : '') + '>' + esc(x.label) + '</option>';
      }).join('') + '</select></label>' +
      '<button type="button" class="cn-step" data-cn-step="1" aria-label="Next measure">›</button>';
  }
  function keyHtml(m, s, sc) {
    if (trendOn(m)) return trendKey();
    if (!s.ready) return s.failed ? '' : '<li class="note">Loading this measure…</li>';
    return sc.key.map(function (k) { return '<li><span class="need-swatch" style="background:' + k[0] + '" aria-hidden="true"></span>' + esc(k[1]) + '</li>'; }).join('') +
      (Object.keys(s.unreliable).length ? '<li><span class="need-swatch" style="background:' + GREY + '" aria-hidden="true"></span>Too uncertain to rank</li>' : '') +
      (Object.keys(s.values).length < 64 ? '<li><span class="need-swatch cn-none" style="background:' + NONE + '" aria-hidden="true"></span>' + (m.blank ? 'No new homes needed for growth' : 'No figure') + '</li>' : '');
  }
  function aboutHtml(m, s) {
    if (s.failed) return '<p class="callout">This measure did not load. The others still work.</p>';
    if (trendOn(m)) return '<p class="cn-what">Each arrow shows which way rent’s share of income moved in that county, and how far. ' + esc(m.what.split('. ')[0]) + '.</p>';
    return '<p class="cn-what">' + esc(m.what) + (m.id === 'need' ? ' Darker means a higher priority score, not need alone.' : ' Darker means more need.') + '</p>';
  }

  function panelHtml(m, d, names) {
    var g = state.county;
    if (!g) {
      var s = series(m.id, d), ranked = Object.keys(s.values).filter(function (k) { return !s.unreliable[k]; });
      var most = null, least = null;
      ranked.forEach(function (k) {
        var v = s.values[k];
        var worse = function (a, b) { return m.worse === 'high' ? a > b : a < b; };
        if (most == null || worse(v, s.values[most])) most = k;
        if (least == null || worse(s.values[least], v)) least = k;
      });
      return '<h3 class="cn-title">Select a county</h3>' +
        '<p data-no-source>Tap or click any county to see all ' + MEASURES.length + ' measures for it, with a line on what each one means there.</p>' +
        countyList(names, null) +
        (s.ready && most ? '<p class="cn-line">On this measure, the most need is in ' + esc(names[most]) + ' (' + esc(fmt(m, s.values[most])) + countsFor(m, d, most) + ') and the least in ' + esc(names[least]) + ' (' + esc(fmt(m, s.values[least])) + countsFor(m, d, least) + ').</p>' : '') +
        '<p class="note cn-src metric-source">Source: ' + srcLine(m) + '</p>';
    }
    var name = names[g] || 'This county';
    var cur = series(m.id, d), v = cur.values[g];
    var now;
    if (!cur.ready) now = '<p class="note" role="status">' + (cur.failed ? 'This measure did not load.' : 'Loading this measure…') + '</p>';
    else if (v == null) now = '<p class="cn-line">' + esc(m.blank || 'No figure is published for this county.') + '</p>';
    else if (cur.unreliable[g]) now = '<p class="cn-big">' + esc(fmt(m, v)) + '</p><p class="cn-line">Too uncertain to rank. ' + esc(m.grey || '') + '</p>';
    else now = '<p class="cn-big">' + esc(fmt(m, v)) + '</p><p class="cn-line">' + esc(sentence(m, d, g, v, name)) + '</p><p class="note">' + esc(rankText(rankOf(m, cur, g))) + '</p>';
    var list = MEASURES.map(function (x) {
      var s = series(x.id, d), xv = s.values[g], r = s.ready ? rankOf(x, s, g) : null;
      var val = !s.ready ? (s.failed ? 'did not load' : '…') : xv == null ? 'none' : fmt(x, xv);
      var tag = !s.ready || xv == null ? '' : s.unreliable[g] ? 'too uncertain to rank' : ordinal(r.n) + ' of ' + r.of;
      return '<li><button type="button" data-cn-measure="' + x.id + '"' + (x === m ? ' aria-pressed="true" class="is-on"' : ' aria-pressed="false"') + '>' +
        '<span class="cn-m">' + esc(x.label) + '</span><span class="cn-v">' + esc(val) + '</span>' + (tag ? '<span class="cn-r">' + esc(tag) + '</span>' : '') + '</button></li>';
    }).join('');
    return '<h3 class="cn-title" tabindex="-1">' + esc(name) + '</h3>' +
      '<p class="cn-now-label">' + esc(m.label) + '</p>' + now +
      (m.id === 'rent_to_income' ? trendLine(g, name) : '') +
      '<p class="note cn-src metric-source">Source: ' + srcLine(m) + '</p>' +
      countyList(names, g) +
      '<h4>All measures for ' + esc(name) + '</h4><p class="note">Rank 1 is the most need. Pick one to map it.</p><ul class="cn-list">' + list + '</ul>' +
      '<div class="actions"><a class="button-link" href="#/place/' + esc(g) + '">Needs assessment for ' + esc(name) + '</a>' +
      '<button type="button" class="button-link secondary" data-cn-clear>Clear</button></div>';
  }

  // The same choice as tapping the map, as a list: small counties (Broomfield, Gilpin, Clear Creek) are only a few
  // pixels wide on a phone, so the map is not the only way to pick one.
  function countyList(names, picked) {
    var ids = Object.keys(names).sort(function (a, b) { return String(names[a]).localeCompare(String(names[b])); });
    return '<label class="cn-county"><span>Or pick a county from the list</span><select data-cn-county><option value="">Choose a county</option>' +
      ids.map(function (g) { return '<option value="' + esc(g) + '"' + (g === picked ? ' selected' : '') + '>' + esc(names[g]) + '</option>'; }).join('') + '</select></label>';
  }

  function namesOf(d) {
    var n = {};
    d.counties.features.forEach(function (f) { n[f.properties.GEOID] = f.properties.NAMELSAD; });
    return n;
  }

  // The whole figure, for the first draw of the page.
  function figure(d, params) {
    lastData = d;
    fromParams(params);
    start();
    var m = BY_ID[state.m], s = series(m.id, d), sc = scale(m, s), names = namesOf(d);
    var paths = d.counties.features.map(function (f) {
      var g = f.properties.GEOID, p = paint(m, s, sc, g, names[g]);
      return '<a href="#/place/' + esc(g) + '" data-county="' + esc(g) + '"><path d="' + shape(f.geometry) + '" fill="' + p.fill + '"' + (g === state.county ? ' class="is-picked"' : '') + '><title>' + esc(p.tip) + '</title></path></a>';
    }).join('');
    // Gemini round 16, pick 1 (paul 11-05): the Home map leads with its finding, counted from the same gap file.
    // Not "every county": 4 of the 64 have as many such homes as renters.
    var short = 0, counted = 0;
    ((d.gapCounty && d.gapCounty.counties) || []).forEach(function (c) {
      var h = c.households_le_ami_pct && c.households_le_ami_pct['30'], u = c.units_priced_affordable_le_ami_pct && c.units_priced_affordable_le_ami_pct['30'];
      if (h == null || u == null) return;
      counted++; if (h > u) short++;
    });
    var finding = counted ? num(short) + ' of Colorado\u2019s ' + num(counted) + ' counties have fewer homes priced for renters at or below 30% AMI than such renters' : 'Colorado counties, measure by measure';
    return '<figure class="need-map county-need' + (trendOn(m) ? ' cn-trending' : '') + '" data-cn>' +
      '<figcaption><strong data-role="cn-finding">' + esc(finding) + '</strong>' + (counted ? '<span class="cn-what">Colorado counties, measure by measure. Source for the first measure: <a href="' + esc(SRC.acsGap[1]) + '">' + esc(SRC.acsGap[0]) + '</a>.</span>' : '') + '<div class="cn-stepper">' + stepper(m) + '</div><div class="cn-about">' + aboutHtml(m, s) + '</div><div class="cn-trendbox">' + trendButtons(m) + '</div></figcaption>' +
      '<div class="cn-grid"><div class="cn-mapcol">' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="' + esc(counted ? (global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(num(short) + ' of ' + num(counted) + ' Colorado counties are short of homes for renters at or below 30% AMI', 'Census ACS, HUD') : 'Colorado counties. Select one to see every measure for it.') + '">' + paths + arrowsOrCities(m, d) + '</svg></div>' +
      '<ul class="need-key cn-key">' + keyHtml(m, s, sc) + '</ul></div>' +
      '<aside class="cn-panel" aria-live="polite">' + panelHtml(m, d, names) + '</aside></div>' +
      '<p class="note">County outlines: US Census TIGER. Small counties have few households and wide survey margins, so read their shades with care.</p>' +
      '<div class="cn-data">' + dataHtml(m, s, d, names) + '</div></figure>';
  }
  // "Show the numbers": every county's value for the measure on the map, in the map's own words.
  function dataHtml(m, s, d, names) {
    var VD = global.LabVizData;
    if (!VD || !s.ready) return '';
    var rows = d.counties.features.map(function (f) {
      var g = f.properties.GEOID, v = s.values[g];
      return [names[g], v == null ? null : v, v == null ? (m.blank || 'not published') : s.unreliable[g] ? 'too uncertain to rank' : ''];
    }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    // The Note column is for a county with something to flag. With nothing flagged it is left out: an empty
    // note cell read "No value" beside every figure (Home port check, 13 Nov 2026).
    var noted = rows.some(function (r) { return r[2]; });
    rows = rows.map(function (r) { return noted ? [r[0], r[1], r[2] || 'none'] : [r[0], r[1]]; });
    return VD.block('Colorado counties, ' + m.label, noted ? ['County', m.label, 'Note'] : ['County', m.label], rows, { fmt: { 1: function (v) { return fmt(m, v); } } });
  }

  // Redraw in place: colors, tooltips, key, words and panel. The page itself is not re-rendered, so the map
  // keeps its zoom and the reader keeps their place.
  function refresh(focusSel) {
    var fig = doc && doc.querySelector('[data-cn]');
    if (!fig || !lastData) return;
    var d = lastData, m = BY_ID[state.m], s = series(m.id, d), sc = scale(m, s), names = namesOf(d);
    Array.prototype.forEach.call(fig.querySelectorAll('a[data-county]'), function (a) {
      var g = a.getAttribute('data-county'), p = paint(m, s, sc, g, names[g]), path = a.querySelector('path');
      path.setAttribute('fill', p.fill);
      path.classList.toggle('is-picked', g === state.county);
      var t = path.querySelector('title');
      if (t) t.textContent = p.tip; else { path.setAttribute('data-tip', p.tip); a.setAttribute('aria-label', p.tip); }
    });
    fig.querySelector('.cn-stepper').innerHTML = stepper(m);
    fig.querySelector('.cn-about').innerHTML = aboutHtml(m, s);
    var tb = fig.querySelector('.cn-trendbox'); if (tb) tb.innerHTML = trendButtons(m);
    var ar = fig.querySelector('.cn-arrows'); if (ar) ar.innerHTML = trendLayer(m, d);
    fig.classList.toggle('cn-trending', !!trendOn(m));
    fig.querySelector('.cn-key').innerHTML = keyHtml(m, s, sc);
    fig.querySelector('.cn-panel').innerHTML = panelHtml(m, d, names);
    var cd = fig.querySelector('.cn-data');
    if (cd) { var wasOpen = cd.querySelector('details[open]'); cd.innerHTML = dataHtml(m, s, d, names); if (wasOpen && cd.querySelector('details')) cd.querySelector('details').open = true; }
    if (typeof focusSel === 'string') { var el = fig.querySelector(focusSel); if (el) el.focus({ preventScroll: true }); }
  }

  function update(next, focusSel) {
    if (next.m) state.m = next.m;
    if ('county' in next) state.county = next.county;
    if ('trend' in next) state.trend = next.trend;
    if (global.history && global.history.replaceState) global.history.replaceState(null, '', hashFor());
    refresh(focusSel);
  }

  if (doc && doc.addEventListener) {
    doc.addEventListener('click', function (ev) {
      var fig = ev.target.closest && ev.target.closest('[data-cn]');
      if (!fig) return;
      var a = ev.target.closest('a[data-county]');
      if (a) {
        // A drag to pan is dropped by the zoom script; anything else picks the county instead of leaving.
        if (ev.defaultPrevented) return;
        ev.preventDefault();
        update({ county: a.getAttribute('data-county') });
        var panel = fig.querySelector('.cn-panel');
        // On a phone the panel sits under the map: bring it into view.
        if (panel && panel.getBoundingClientRect && panel.getBoundingClientRect().top > global.innerHeight - 80) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-cn-step')) {
        var i = MEASURES.indexOf(BY_ID[state.m]) + Number(b.getAttribute('data-cn-step'));
        update({ m: MEASURES[(i + MEASURES.length) % MEASURES.length].id }, '[data-cn-step="' + b.getAttribute('data-cn-step') + '"]');
      } else if (b.hasAttribute('data-cn-measure')) {
        update({ m: b.getAttribute('data-cn-measure') }, '[data-cn-measure="' + b.getAttribute('data-cn-measure') + '"]');
      } else if (b.hasAttribute('data-cn-trend')) {
        update({ trend: b.getAttribute('data-cn-trend') }, '[data-cn-trend="' + b.getAttribute('data-cn-trend') + '"]');
      } else if (b.hasAttribute('data-cn-clear')) {
        update({ county: null }, '[data-cn-pick]');
      }
    });
    doc.addEventListener('change', function (ev) {
      if (ev.target.hasAttribute && ev.target.hasAttribute('data-cn-pick')) update({ m: ev.target.value }, '[data-cn-pick]');
      else if (ev.target.hasAttribute && ev.target.hasAttribute('data-cn-county')) update({ county: ev.target.value || null }, '[data-cn-county]');
    });
  }

  global.LabCountyNeed = { figure: figure, MEASURES: MEASURES, series: series, scale: scale, rankOf: rankOf, rankText: rankText, sentence: sentence, fmt: fmt, ext: ext, start: start, state: state };
})(window);
