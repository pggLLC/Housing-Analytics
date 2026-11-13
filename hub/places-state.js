// The rest of Places and need, rebuilt from the data the live pages read:
//   #/places/scenario?g=&b=&d=&m=   Scenario builder: the live page's own model (js/projections/scenario-builder.js on
//                                   js/projections/cohort-component-model.js), so every figure matches it at the same inputs
//   #/places/economy                Economic dashboard: rates, jobs, prices and permits from the site's FRED file
//   #/places/county-costs?m=        Housing costs by county: rent, income, burden, home values, vacancy and permits, mapped
//   #/places/multifamily?g=         Multifamily lens: building types, tenure, rent and burden from the stored ACS profile
//   #/places/deep-dive              Colorado deep dive: renters against homes they can afford, and funding against need
// Live market odds, the Census API calls and the live page's interactive maps stay on cohoanalytics.com.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI, Viz = global.LabViz;
  var esc = Shell.esc, num = UI.num, money = UI.money;
  // A port into the public site sets LAB_LIVE to its own root, so these links stay on that site.
  var LIVE = global.LAB_LIVE != null ? global.LAB_LIVE : 'https://cohoanalytics.com/';
  var C = Viz.COLORS;

  function waiting(title, s) {
    return T.head({ kind: 'data', crumbs: T.trail('places', title), title: title }) +
      (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading the data…</p>');
  }
  function pct1(v) { return v == null ? null : (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  function q(route, params, k, v) {
    var p = new URLSearchParams(params); if (v == null || v === '') p.delete(k); else p.set(k, v);
    var x = p.toString(); return '#/places/' + route + (x ? '?' + x : '');
  }
  function chips(label, list, on, hrefOf) {
    return '<nav class="dm-chips" aria-label="' + esc(label) + '"><ul>' + list.map(function (c) {
      return '<li><a href="' + esc(hrefOf(c[0])) + '"' + (c[0] === on ? ' class="is-on" aria-current="true"' : '') + '>' + esc(c[1]) + '</a></li>';
    }).join('') + '</ul></nav>';
  }
  function cleanName(n) { return String(n || '').replace(/ \((city|town|CDP)\)$/i, '').replace(/, Colorado$/, ''); }
  // A place picker over the HNA ranking list: counties, then towns, then CDPs.
  function placeSelect(id, ranking, picked, withState) {
    var list = Array.isArray(ranking.rankings) ? ranking.rankings : Object.keys(ranking.rankings).map(function (k) { return ranking.rankings[k]; });
    var groups = [['county', 'Counties'], ['place', 'Towns and cities'], ['cdp', 'Unincorporated places (CDPs)']];
    return '<form class="search sc-pick" onsubmit="return false"><label for="' + id + '">Pick a place</label><select id="' + id + '" data-place-pick="' + id + '">' +
      (withState ? '<option value="08"' + (picked === '08' ? ' selected' : '') + '>Colorado (the whole state)</option>' : '<option value="">Choose a county, town or CDP</option>') +
      groups.map(function (g) {
        return '<optgroup label="' + g[1] + '">' + list.filter(function (r) { return r.type === g[0]; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }).map(function (r) {
          return '<option value="' + esc(r.geoid) + '"' + (r.geoid === picked ? ' selected' : '') + '>' + esc(cleanName(r.name)) + '</option>';
        }).join('') + '</optgroup>';
      }).join('') + '</select></form>';
  }
  function rankList(ranking) {
    return Array.isArray(ranking.rankings) ? ranking.rankings : Object.keys(ranking.rankings).map(function (k) { return ranking.rankings[k]; });
  }

  // County map, one hue light to dark (the money page's projection and ramp).
  var RAMP = ['var(--map-0)', 'var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)'], NONE = 'var(--map-empty)';
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  var ring = K.ring;
  function shape(g) { return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(function (p) { return p.map(ring).join(''); }).join(''); }
  // o: { features, value(fips), label(fips, v), href(fips), picked, title (the finding), kicker (the topic), note,
  //      fmt(v) for the legend numbers, thin: { fips: true } }. Shades by value within the range shown, in five
  //      even steps, so a few large counties do not wash out the rest. Map kit part 2: the legend gives each step's
  //      range and count, "not published" is the hatch, and thin-data counties carry the dotted mark.
  function countyMap(o) {
    var mk = K.marks(), fmt = o.fmt || function (v) { return o.label(null, v); };
    var vals = o.features.map(function (f) { return o.value(f.properties.GEOID); }).filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var cls = function (v) { return Math.min(4, Math.floor((v - lo) / ((hi - lo) || 1) * 5)); };
    var none = 0;
    var paths = o.features.map(function (f) {
      var k = f.properties.GEOID, v = o.value(k);
      if (v == null) none++;
      var fill = v == null ? mk.none : RAMP[1 + cls(v)];
      var label = f.properties.NAME + ' County: ' + o.label(k, v);
      return '<a href="' + esc(o.href(k)) + '" aria-label="' + esc(label) + '"><path d="' + shape(f.geometry) + '" fill="' + fill + '"' + (k === o.picked ? ' class="is-picked"' : '') + '><title>' + esc(label) + '</title></path></a>';
    }).join('');
    var thinN = o.thin ? o.features.filter(function (f) { return o.thin[f.properties.GEOID]; }).length : 0;
    var steps = K.classes(vals, 5, cls).map(function (c, i) {
      return c.count ? '<li><i style="background:' + RAMP[1 + i] + '"></i>' + esc((c.lo === c.hi ? fmt(c.lo) : fmt(c.lo) + ' to ' + fmt(c.hi)) + ' (' + c.count + ')') + '</li>' : '';
    }).reverse().join('');
    return '<figure class="pres-map money-map"><figcaption>' + (o.kicker ? '<span class="cc-kicker">' + esc(o.kicker) + '</span>' : '') + '<strong>' + esc(o.title) + '</strong><span class="note">' + esc(o.note) + '</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="' + esc(o.title) + '">' + mk.defs + paths + (thinN ? K.thinLayer(o.features, o.thin, mk) : '') + K.cities() + '</svg></div>' +
      '<ul class="mk-legend">' + steps + (none ? '<li>' + K.KEY_NONE + 'Not published (' + none + ')</li>' : '') +
      (thinN ? '<li>' + K.KEY_THIN + 'Under ' + K.THIN.toLocaleString('en-US') + ' homes: wide survey margin (' + thinN + ')</li>' : '') + '</ul>' +
      (global.LabVizData ? global.LabVizData.block(o.kicker || o.title, ['County', o.valueName || 'Value', 'Detail'], o.features.map(function (f) {
        var k = f.properties.GEOID, v = o.value(k); return [f.properties.NAME + ' County', v, o.label(k, v)];
      }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; })) : '') + (o.source ? '<p class="metric-source">' + o.source + '</p>' : '') + '</figure>';
  }

  // ---------- Scenario builder ----------
  var SB_SRC = LIVE + 'hna-scenario-builder.html';
  var SDO = 'https://demography.dola.colorado.gov/assets/html/population.html';
  var SLIDE = [
    { k: 'm', key: 'migration_pct', label: 'People moving in, minus people moving out', min: 0, max: 200, step: 5 },
    { k: 'b', key: 'births_pct', label: 'Births', min: 50, max: 150, step: 1 },
    { k: 'd', key: 'deaths_pct', label: 'Deaths', min: 80, max: 120, step: 1 }
  ];
  function sbParams(params) {
    var out = {};
    SLIDE.forEach(function (s) { var v = Number(params.get(s.k)); out[s.key] = params.get(s.k) != null && isFinite(v) ? Math.max(s.min, Math.min(s.max, v)) : 100; });
    if (params.get('from') === 'past') out.migration_from = 'past';
    if (params.get('hs') === 'held') out.headship = 'held';
    if (params.get('ts') === 'age') out.town_share = 'hamilton_perry';
    return out;
  }
  function sbFiles(geo, extra) {
    var f = {};
    if (geo.type !== 'county') { f.ledger = 'data/hna/projections/places.json'; f.cross = 'data/hna/cross-county-places.json'; f.hp = 'data/hna/place-hamilton-perry.json'; }
    (extra || []).forEach(function (fips) { f['b' + fips] = 'data/hna/scenario-baseline/' + fips + '.json'; f['p' + fips] = 'data/hna/projections/' + fips + '.json'; });
    return f;
  }
  function scenario(params) {
    var s = UI.load({ ranking: 'data/hna/ranking-index.json', fe: 'data/hna/forecast-error.json' });
    var title = 'Scenario builder';
    if (!s.data) return waiting(title, s);
    var SB = global.ScenarioBuilder, CCM = global.CohortComponentModel;
    var head = T.head({
      kind: 'tool', crumbs: T.trail('places', title), title: title,
      answer: 'Change the State Demography Office forecast for any Colorado county, town or CDP and see how many homes it would need.',
      meta: 'The State Demography Office’s cohort model. At 100% on every setting the figures match the needs assessment.'
    });
    if (!SB || !CCM) return head + '<p class="callout">The forecast model did not load.</p>';
    var g = params.get('g') || '08077';
    var r = rankList(s.data.ranking).filter(function (x) { return x.geoid === g; })[0];
    if (!r) return head + placeSelect('sc-g', s.data.ranking, '') + '<p class="callout">No place with that code. Pick one above.</p>';
    var m = r.metrics || {};
    var geo = { geoid: r.geoid, name: cleanName(r.name), type: r.type, containingCounty: r.containingCounty, population: m.population, inCommuters: m.incommuter_need_units, inCommutersHigh: m.incommuter_need_units_high };
    // Town files first (they say which counties it sits in), then each county's forecast.
    var pf = geo.type === 'county' ? { data: {} } : UI.load(sbFiles(geo));
    if (!pf.data) return head + (pf.error ? '<p class="callout">' + esc(pf.error) + '</p>' : '<p role="status" class="note">Loading the forecast…</p>');
    var pd = { ledger: (pf.data.ledger || {}).places || {}, cross: (pf.data.cross || {}).places || {}, hamiltonPerry: pf.data.hp || null };
    var fipsList = SB.countiesFor(geo, pd);
    var cf = UI.load(sbFiles({ type: 'county' }, fipsList));
    if (!cf.data) return head + (cf.error ? '<p class="callout">' + esc(cf.error) + '</p>' : '<p role="status" class="note">Loading the forecast…</p>');
    var data = { baselines: {}, projections: {}, ledger: pd.ledger, cross: pd.cross, hamiltonPerry: pd.hamiltonPerry };
    fipsList.forEach(function (f) { data.baselines[f] = cf.data['b' + f]; data.projections[f] = cf.data['p' + f]; });
    var ctx = SB.contextFor(geo, data);
    if (ctx.unavailableReason) return head + placeSelect('sc-g', s.data.ranking, g) + '<p class="callout">' + esc(ctx.unavailableReason) + '</p>';

    var p = sbParams(params);
    var past = null, avg = 0, span = null;
    ctx.counties.forEach(function (c) {
      var a = CCM.averageAnnualMigration(c.baseline, SB.HORIZON_YEARS); avg += a == null ? 0 : a;
      var pm = CCM.pastMigration(c.baseline); if (pm) { past = (past || 0) + pm.annual; span = pm.from + '–' + pm.to; } else past = null;
    });
    avg *= ctx.share; if (past != null) past *= ctx.share;
    if (past == null) delete p.migration_from;
    if (!ctx.townShares) delete p.town_share;
    var sdoRows = SB.homesSeries(ctx, CCM.DEFAULT_PARAMS), rows = SB.homesSeries(ctx, p);
    var isDefault = Object.keys(p).length === 3 && Object.keys(CCM.DEFAULT_PARAMS).every(function (k) { return p[k] === CCM.DEFAULT_PARAMS[k]; });
    if (!rows.length) return head + '<p class="callout">This setting cannot run for ' + esc(geo.name) + ': ' + (p.migration_from ? 'its files have no estimate of past migration.' : 'the forecast is incomplete.') + '</p>';
    var fig = SB.twentyYearFigure(rows, ctx), figSdo = SB.twentyYearFigure(sdoRows, ctx);
    var band = SB.bandSeries(sdoRows, ctx, s.data.fe);
    var horizon = rows.filter(function (x) { return x.year <= rows[0].year + SB.HORIZON_YEARS; });
    var years = horizon.map(function (x) { return x.year; });
    var pick = function (arr, k) { return arr.slice(0, years.length).map(function (x) { return x && x[k] != null ? x[k] : null; }); };
    var chart = Viz.projection({
      title: 'Homes needed for growth in ' + geo.name + ', ' + years[0] + ' to ' + years[years.length - 1],
      series: { years: years, main: pick(rows, 'homesNeeded'), alt: isDefault ? null : pick(sdoRows, 'homesNeeded'), low: band.length ? pick(band, 'low') : null, high: band.length ? pick(band, 'high') : null },
      labels: { main: isDefault ? 'State forecast' : 'Your scenario', alt: 'State forecast', band: 'Where 2 in 3 past forecasts landed' },
      answer: fig ? (isDefault ? 'The state forecast' : 'Your scenario') + ' needs ' + num(fig.growth) + ' more homes for residents by ' + fig.year + (isDefault || !figSdo ? '.' : ', against ' + num(figSdo.growth) + ' in the state forecast.') : '',
      note: 'Homes are the rise in households divided by one minus the county’s target vacancy' + (ctx.counties.length === 1 && ctx.counties[0].vacancy != null ? ' (' + (Math.round(ctx.counties[0].vacancy * 1000) / 10) + '% here)' : '') + ', as on the needs assessment; this tool holds it fixed, and the full Scenario Builder shows it. The shaded range is how far past forecasts for places this size missed.',
      source: '<a href="' + SDO + '">Colorado State Demography Office forecast</a>, ' + esc(String(ctx.counties[0].baseline.vintage || '').replace(/\s+Prepared\s+/i, ', prepared '))
    });
    var end = horizon[horizon.length - 1];
    var presets = (global.ScenarioPresets && global.ScenarioPresets.list || []).map(function (pr) {
      var x = new URLSearchParams(); x.set('g', g); x.set('m', pr.params.migration_pct); x.set('b', pr.params.births_pct); x.set('d', pr.params.deaths_pct);
      var on = p.migration_pct === pr.params.migration_pct && p.births_pct === pr.params.births_pct && p.deaths_pct === pr.params.deaths_pct && !p.migration_from && !p.headship && !p.town_share;
      return ['#/places/scenario?' + x, pr.label + ' (' + pr.short + ')', on];
    });
    var count = function (v, was) { return 'about ' + num(Math.abs(v)) + (v >= 0 ? (was ? ' more people arrived than left' : ' more people arrive than leave') : (was ? ' more people left than arrived' : ' more people leave than arrive')) + ' each year'; };
    var radio = function (name, val, label, on, disabled) {
      return '<label><input type="radio" name="' + name + '" value="' + val + '" data-sc="' + name + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '> <span>' + esc(label) + '</span></label>';
    };
    var form = '<form class="lv-form sc-form" data-sc-form="1" onsubmit="return false"><input type="hidden" data-sc="g" value="' + esc(g) + '">' +
      '<fieldset><legend>Presets</legend><ul class="sc-presets">' + presets.map(function (x) { return '<li><a href="' + esc(x[0]) + '"' + (x[2] ? ' class="is-on" aria-current="true"' : '') + '>' + esc(x[1]) + '</a></li>'; }).join('') + '</ul></fieldset>' +
      '<fieldset><legend>Your settings, as a share of their starting point</legend>' + SLIDE.map(function (sl) {
        var v = p[sl.key];
        return '<label class="sc-slider"><span>' + esc(sl.label) + ' <output id="sc-' + sl.k + '-v">' + v + '%</output></span>' +
          '<input type="range" min="' + sl.min + '" max="' + sl.max + '" step="' + sl.step + '" value="' + v + '" data-sc="' + sl.k + '" aria-label="' + esc(sl.label) + '" aria-describedby="sc-' + sl.k + '-help"></label>' +
          '<p class="note" id="sc-' + sl.k + '-help">' + esc(sl.k === 'm' ? (p.migration_from ? '100% is the ' + span + ' average.' : '100% is the state forecast: ' + count(avg) + '.') + (past != null && !p.migration_from ? ' In ' + span + ', ' + count(past, true) + '.' : '')
            : sl.k === 'b' ? '110% means one more baby for every ten the state expects.' : 'Below 100% means people live longer.') + '</p>';
      }).join('') + '</fieldset>' +
      '<fieldset><legend>Starting point for migration (100%)</legend>' + radio('from', 'sdo', 'The state forecast', !p.migration_from) + radio('from', 'past', past != null ? 'What happened, ' + span + ' average' : 'What happened before (not on file here)', !!p.migration_from, past == null) +
        '<p class="note">The state forecast is the State Demography Office projection. Births and deaths always start from it.</p></fieldset>' +
      '<fieldset><legend>Households per person, by age</legend>' + radio('hs', 'sdo', 'Change as the state forecast expects', !p.headship) + radio('hs', 'held', 'Stay at ' + (ctx.counties[0].baseline.baseYear || 'today') + ' levels', !!p.headship) +
        '<p class="note">How many households each age group forms. Staying at ' + esc(ctx.counties[0].baseline.baseYear || 'today') + ' levels shows growth from population change alone.</p></fieldset>' +
      (ctx.isCounty ? '' : '<fieldset><legend>' + esc(geo.name) + '’s share of the county</legend>' + radio('ts', 'hna', 'One share at every age, as the needs assessment uses', !p.town_share) +
        radio('ts', 'age', ctx.townShares ? 'By age, from the 2010 and 2020 Census' : 'By age (not available here)', !!p.town_share, !ctx.townShares) +
        (ctx.townShares ? '' : '<p class="note">' + esc(ctx.townSharesReason || '') + '</p>') + '</fieldset>') +
      '</form>';
    var tableRows = horizon.filter(function (x, i) { return i % 5 === 0 || i === horizon.length - 1; }).map(function (x) {
      var b = sdoRows.filter(function (y) { return y.year === x.year; })[0];
      return { year: x.year, pop: x.population, hh: x.householdsAdded, homes: x.homesNeeded, sdo: b && b.homesNeeded };
    });
    return head + placeSelect('sc-g', s.data.ranking, g) +
      '<p class="note">' + esc(SB.describeContext(ctx)) + '</p>' +
      UI.intro('How many homes would ' + geo.name + ' need if growth ran faster or slower?',
        fig ? (isDefault ? 'On the state forecast, ' : 'In your scenario, ') + num(fig.growth) + ' homes for new residents by ' + fig.year +
          (fig.inCommuters != null ? ', plus ' + num(fig.inCommuters) + ' for people who commute in today: ' + num(fig.total) + ' in all.' : '.') : '') +
      '<div class="lv-layout sc-layout">' + form + '<section class="lv-out" aria-live="polite"><h2>Result</h2>' +
      '<div class="metrics">' +
      '<div class="metric"><p class="metric-label">Homes needed by ' + esc(fig ? fig.year : '') + '</p><p class="metric-value">' + esc(fig ? num(fig.total) : '—') + '</p><p class="metric-detail">' + esc(fig && fig.inCommuters != null ? num(fig.growth) + ' for growth, ' + num(fig.inCommuters) + ' for in-commuters' : 'For growth') + '</p></div>' +
      '<div class="metric"><p class="metric-label">People in ' + esc(end.year) + '</p><p class="metric-value">' + esc(end.population == null ? '—' : num(end.population)) + '</p><p class="metric-detail">From ' + esc(rows[0].population == null ? '—' : num(rows[0].population)) + ' in ' + esc(rows[0].year) + '</p></div>' +
      '<div class="metric"><p class="metric-label">Households added</p><p class="metric-value">' + esc(num(end.householdsAdded)) + '</p><p class="metric-detail">' + esc(rows[0].year + ' to ' + end.year) + '</p></div></div>' +
      chart + '<p class="note">This page keeps your settings in its link, so you can copy the address to share it. Saved scenarios are a member feature.</p></section></div>' +
      '<h2>Year by year</h2>' + UI.table('sc-years', 'Every fifth year of the scenario', [
        { key: 'year', label: 'Year' },
        { key: 'pop', label: 'People', num: true, fmt: num },
        { key: 'hh', label: 'Households added', num: true, fmt: num },
        { key: 'homes', label: isDefault ? 'Homes needed' : 'Homes needed, your scenario', num: true, fmt: num },
        { key: 'sdo', label: 'Homes needed, state forecast', num: true, fmt: num }
      ], tableRows, { noun: 'years', placeholder: 'Year' }) +
      '<p class="metric-source">Source: <a href="' + SDO + '">Colorado State Demography Office forecast</a>, ' + esc(String(ctx.counties[0].baseline.vintage || '').replace(/\s+Prepared\s+/i, ', prepared ')) + (isDefault ? '' : ', with your changes') + '.</p>' +
      (global.LabVizData ? '<p class="viz-data-csv"><a class="button-link secondary" download="' + esc('coho-scenario-' + g + (isDefault ? '-state-forecast' : '-your-scenario')) + '.csv" href="data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + global.LabVizData.csvText(
        ['Year', 'People', 'Households added', isDefault ? 'Homes needed' : 'Homes needed, your scenario', 'Homes needed, state forecast'],
        horizon.map(function (x) { var b = sdoRows.filter(function (y) { return y.year === x.year; })[0]; return [x.year, x.population, x.householdsAdded, x.homesNeeded, b ? b.homesNeeded : null]; }))) + '">Download every year as CSV</a></p>' : '') +
      T.source('COHO Scenario Builder', SB_SRC + '?geoid=' + g) +
      T.next('Next', [{ href: '#/place/' + g, label: 'Full needs assessment for ' + geo.name + ' →' }, { href: '#/places/ranking', label: 'HNA ranking', secondary: true }]);
  }
  // Settings write into the address and redraw; the field being moved keeps focus. A slider shows its
  // value as it moves and redraws when let go.
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.type === 'range' && el.dataset && el.dataset.sc) { var o = document.getElementById('sc-' + el.dataset.sc + '-v'); if (o) o.textContent = el.value + '%'; }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.placePick) {
      var route = el.dataset.placePick === 'sc-g' ? 'scenario' : 'multifamily';
      location.hash = '#/places/' + route + '?g=' + encodeURIComponent(el.value);
      return;
    }
    if (!el.dataset || !el.dataset.sc) return;
    var form = el.closest('form'), p = new URLSearchParams();
    form.querySelectorAll('[data-sc]').forEach(function (f) {
      if (f.type === 'radio') { if (f.checked && f.value !== 'sdo' && f.value !== 'hna') p.set(f.dataset.sc, f.value); }
      else if (f.type === 'range') { if (f.value !== '100') p.set(f.dataset.sc, f.value); }
      else p.set(f.dataset.sc, f.value);
    });
    var key = el.dataset.sc, val = el.value;
    history.replaceState(null, '', '#/places/scenario?' + p);
    Shell.render();
    var again = document.querySelector('[data-sc="' + key + '"]' + (el.type === 'radio' ? '[value="' + val + '"]' : ''));
    if (again) again.focus();
  });

  // ---------- Economic dashboard ----------
  var ECON_SRC = LIVE + 'economic-dashboard.html';
  function fredSeries(fred, id, since) {
    var ser = fred.series[id];
    return (ser && ser.observations || []).filter(function (o) { return o.value !== '.' && o.value != null && o.value !== '' && (!since || o.date >= since); })
      .map(function (o) { var d = String(o.date).split('-'); return [new Date(+d[0], +d[1] - 1, +(d[2] || 1)), +o.value, o.date]; });
  }
  // Daily and weekly series drawn as each month's last reading, so a five-year line stays light.
  function monthly(pts) {
    var out = [], seen = {};
    for (var i = pts.length - 1; i >= 0; i--) { var k = pts[i][0].getFullYear() * 12 + pts[i][0].getMonth(); if (!seen[k]) { seen[k] = 1; out.unshift(pts[i]); } }
    return out;
  }
  function yoy(pts) {
    return pts.map(function (p, i) {
      var prev = pts.filter(function (x) { return x[0].getFullYear() === p[0].getFullYear() - 1 && x[0].getMonth() === p[0].getMonth(); })[0];
      return prev ? [p[0], (p[1] / prev[1] - 1) * 100, p[2]] : null;
    }).filter(Boolean);
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(p) { return MON[p[0].getMonth()] + ' ' + (p[2].length > 7 && p[2].slice(8, 10) !== '01' ? +p[2].slice(8, 10) + ', ' : '') + p[0].getFullYear(); }
  function fredLink(id) { return 'https://fred.stlouisfed.org/series/{id}'.replace('{id}', id); }
  var pctFmt = function (v) { return (Math.round(v * 100) / 100).toFixed(Math.abs(v) >= 10 ? 0 : 1) + '%'; };
  var ECON = [
    ['MORTGAGE30US', '30-year mortgage rate', 'Freddie Mac weekly average, United States', pctFmt],
    ['DGS10', '10-year Treasury yield', 'Bond buyers price tax-exempt and taxable debt off it', pctFmt],
    ['SOFR', 'SOFR', 'The overnight rate most construction loans float on', pctFmt],
    ['DFF', 'Federal funds rate', 'The Federal Reserve’s policy rate, daily effective', pctFmt],
    ['COUR', 'Colorado unemployment', 'Seasonally adjusted', pctFmt],
    ['UNRATE', 'U.S. unemployment', 'Seasonally adjusted', pctFmt],
    ['COCONS', 'Colorado construction jobs', 'Thousands of jobs', function (v) { return num(v * 1000); }],
    ['COBPPRIV', 'Colorado homes permitted', 'Each month, all building types', num],
    ['COSTHPI', 'Colorado house price index', 'FHFA all-transactions, quarterly', function (v) { return v.toFixed(1); }],
    ['RRVRUSQ156N', 'U.S. rental vacancy', 'Quarterly', pctFmt],
    ['HOUST5F', 'U.S. apartment starts', 'Buildings of 5 or more homes, thousands a year', function (v) { return num(v * 1000); }],
    ['WPUIP231120', 'Apartment building inputs', 'Producer price index', function (v) { return v.toFixed(1); }]
  ];
  function economy() {
    var s = UI.load({ fred: 'data/fred-data.json' });
    var title = 'Economic dashboard';
    if (!s.data) return waiting(title, s);
    var fred = s.data.fred, since = (new Date().getFullYear() - 6) + '-01-01';
    var last = function (id) { var a = fredSeries(fred, id); return a[a.length - 1]; };
    var mort = last('MORTGAGE30US'), t10 = last('DGS10'), sofr = last('SOFR'), cour = last('COUR');
    if (!mort || !t10) return T.head({ kind: 'data', crumbs: T.trail('places', title), title: title }) + '<p class="callout">The rate series are not in the data yet.</p>';
    var mortY = fredSeries(fred, 'MORTGAGE30US').filter(function (p) { return p[0] <= new Date(mort[0].getFullYear() - 1, mort[0].getMonth(), mort[0].getDate() + 3); }).pop();
    var rates = Viz.timeLines({
      title: 'Borrowing costs since ' + since.slice(0, 4),
      answer: 'The 30-year mortgage rate is ' + pctFmt(mort[1]) + (mortY ? ', against ' + pctFmt(mortY[1]) + ' a year earlier.' : '.'),
      series: [
        { label: '30-year mortgage', color: C.households, points: monthly(fredSeries(fred, 'MORTGAGE30US', since)) },
        { label: '10-year Treasury', color: C.blue, points: monthly(fredSeries(fred, 'DGS10', since)) },
        { label: 'SOFR', color: C.homes, dash: true, points: monthly(fredSeries(fred, 'SOFR', since)) }
      ], fmt: pctFmt,
      note: 'Each line is the last reading of each month. Permanent loans on tax credit deals usually price off the 10-year Treasury; construction loans off SOFR.',
      source: '<a href="' + fredLink('MORTGAGE30US') + '">Freddie Mac</a>, <a href="' + fredLink('DGS10') + '">U.S. Treasury</a> and <a href="' + fredLink('SOFR') + '">New York Fed</a>, via FRED'
    });
    var jobs = Viz.timeLines({
      title: 'Unemployment, Colorado and the United States',
      answer: 'Colorado’s unemployment rate is ' + pctFmt(cour[1]) + ' (' + when(cour) + ').',
      series: [
        { label: 'Colorado', color: C.pine, points: fredSeries(fred, 'COUR', since) },
        { label: 'United States', color: C.muted, dash: true, points: fredSeries(fred, 'UNRATE', since) }
      ], fmt: pctFmt, source: '<a href="' + fredLink('COUR') + '">BLS, via FRED</a>'
    });
    var cpi = yoy(fredSeries(fred, 'CPIAUCSL', (+since.slice(0, 4) - 1) + '-01-01')).filter(function (p) { return p[2] >= since; });
    var shelter = yoy(fredSeries(fred, 'CUUR0000SAH1', (+since.slice(0, 4) - 1) + '-01-01')).filter(function (p) { return p[2] >= since; });
    var prices = Viz.timeLines({
      title: 'Prices, change from a year earlier',
      answer: shelter.length ? 'Shelter costs are up ' + pctFmt(shelter[shelter.length - 1][1]) + ' on a year earlier; all prices ' + pctFmt(cpi[cpi.length - 1][1]) + '.' : '',
      series: [{ label: 'Shelter', color: C.households, points: shelter }, { label: 'All items', color: C.blue, dash: true, points: cpi }], fmt: pctFmt,
      note: 'Consumer prices for the United States; there is no monthly Colorado series.', source: '<a href="' + fredLink('CUUR0000SAH1') + '">BLS consumer price index, via FRED</a>'
    });
    var permits = fredSeries(fred, 'COBPPRIV', since), pYear = {};
    permits.forEach(function (p) { var y = p[0].getFullYear(); pYear[y] = (pYear[y] || 0) + p[1]; });
    var lastP = permits[permits.length - 1], ytdNow = 0, ytdPrev = 0;
    permits.forEach(function (p) { if (p[0].getMonth() <= lastP[0].getMonth()) { if (p[0].getFullYear() === lastP[0].getFullYear()) ytdNow += p[1]; if (p[0].getFullYear() === lastP[0].getFullYear() - 1) ytdPrev += p[1]; } });
    var permitChart = Viz.timeLines({
      title: 'Homes permitted in Colorado each month',
      answer: num(ytdNow) + ' homes permitted through ' + MON[lastP[0].getMonth()] + ' ' + lastP[0].getFullYear() + ', against ' + num(ytdPrev) + ' by the same month a year earlier.',
      series: [{ label: 'Homes permitted', color: C.homes, points: permits }], fmt: num,
      source: '<a href="' + fredLink('COBPPRIV') + '">Census Building Permits Survey, via FRED</a>'
    });
    var rows = ECON.map(function (e) {
      var a = fredSeries(fred, e[0]); if (!a.length) return null;
      var l = a[a.length - 1], y = a.filter(function (p) { return p[0] <= new Date(l[0].getFullYear() - 1, l[0].getMonth(), l[0].getDate() + 3); }).pop();
      return { what: e[1], note: e[2], now: l[1], nowText: e[3](l[1]), when: when(l), year: y ? e[3](y[1]) : '', id: e[0] };
    }).filter(Boolean);
    return T.head({
      kind: 'data', crumbs: T.trail('places', title), title: title,
      answer: 'The rates, jobs, prices and permits that move Colorado housing deals, at their latest readings.',
      meta: '<span class="scope-tag">Scope: Colorado where a state series exists, otherwise the United States</span> Updated ' + esc(String(fred.updated || '').slice(0, 10)) + '.',
      facts: [
        { value: pctFmt(mort[1]), label: '30-year mortgage, ' + when(mort), source: 'Freddie Mac via FRED', href: fredLink('MORTGAGE30US') },
        { value: pctFmt(t10[1]), label: '10-year Treasury, ' + when(t10), source: 'Treasury via FRED', href: fredLink('DGS10') },
        { value: sofr ? pctFmt(sofr[1]) : '—', label: 'SOFR, ' + (sofr ? when(sofr) : ''), source: 'New York Fed via FRED', href: fredLink('SOFR') },
        { value: pctFmt(cour[1]), label: 'Colorado unemployment, ' + when(cour), source: 'BLS via FRED', href: fredLink('COUR') }
      ]
    }) + rates + permitChart + prices + jobs +
      '<h2>Every reading</h2>' + UI.table('econ', 'Latest reading of each series, with a year earlier', [
        { key: 'what', label: 'Measure', href: function (r) { return fredLink(r.id); } },
        { key: 'nowText', label: 'Latest', num: true },
        { key: 'when', label: 'As of' },
        { key: 'year', label: 'A year earlier', num: true },
        { key: 'note', label: 'What it is' }
      ], rows, { noun: 'measures', placeholder: 'Measure' }) +
      '<p>Market odds on rates and the economy, and multifamily rent benchmarks, stay on <a href="' + ECON_SRC + '">the full Economic Dashboard ↗</a>.</p>' +
      T.source('Federal Reserve Bank of St. Louis (FRED), as gathered by COHO', 'https://fred.stlouisfed.org/', String(fred.updated || '').slice(0, 10)) +
      T.next('Next', [{ href: '#/places/costs', label: 'Construction costs →' }, { href: '#/equity-pricing', label: 'Tax credit prices', secondary: true }]);
  }

  // ---------- Housing costs by county ----------
  // From the HNA ranking's county rows (ACS five-year) and the Census permit file the needs assessment uses.
  // The live article's county series (data/co-housing-costs/county-trends.json) was placeholder data until HA #2631
  // (2026-11-01) rebuilt it from the ACS caches; site/rent-income.js now draws rent against income from it.
  var HC_SRC = LIVE + 'article-co-housing-costs.html';
  var signed = function (v) { return (v >= 0 ? '+' : '') + Math.round(v) + '%'; };
  var HC = [
    ['rent', 'Median rent', function (m) { return m.gross_rent_median; }, money, 'Median gross rent (rent plus utilities), ACS five-year'],
    ['income', 'Median income', function (m) { return m.median_hh_income; }, money, 'Median household income, ACS five-year'],
    ['burden', 'Renters paying 30%+', function (m) { return m.pct_cost_burdened; }, pct1, 'Renter households paying 30% or more of income on housing'],
    ['value', 'Median home value', function (m) { return m.median_home_value; }, money, 'Median value of owner-occupied homes, ACS five-year'],
    ['ratio', 'Home value to income', function (m) { return m.home_value_to_income; }, function (v) { return v.toFixed(1) + '×'; }, 'Median home value divided by median household income'],
    ['vacancy', 'Homes for rent or sale', function (m) { return m.vacancy_rate_pct; }, pct1, 'Vacant homes for rent or for sale only, of all homes (ACS B25004); seasonal homes left out'],
    ['permits', 'Permits per 1,000 people', function (m, p) { var a = p && p.avg_annual_total_5yr; return a && a.value != null && m.population ? a.value / m.population * 1000 : null; }, function (v) { return v.toFixed(1); }, 'Homes permitted a year, last five years, per 1,000 residents (Census Building Permits Survey)'],
    ['mf', 'Apartments in permits', function (m, p) { if (!p || !p.units_total) return null; var t = p.units_total.slice(-5), f = (p.units_mf || []).slice(-5), tt = t.reduce(function (a, b) { return a + (b || 0); }, 0); return tt ? f.reduce(function (a, b) { return a + (b || 0); }, 0) / tt * 100 : null; }, pct1, 'Share of homes permitted in the last five years in buildings of two or more']
  ];
  function countyCosts(params) {
    var s = UI.load({ ranking: 'data/hna/ranking-index.json', permits: 'data/hna/permits.json', b: 'data/boundaries/counties_co.geojson' });
    var title = 'Housing costs by county';
    if (!s.data) return waiting(title, s);
    var mId = params.get('m') || 'rent', M = HC.filter(function (x) { return x[0] === mId; })[0] || HC[0];
    var picked = params.get('county'), pyears = s.data.permits.years || [];
    var rows = rankList(s.data.ranking).filter(function (x) { return x.type === 'county'; }).map(function (x) {
      var m = x.metrics || {}, p = s.data.permits.counties[x.geoid], r = { key: x.geoid, county: cleanName(x.name).replace(/ County$/, ''), pop: m.population };
      HC.forEach(function (h) { r[h[0]] = h[2](m, p); });
      return r;
    });
    var have = rows.filter(function (r) { return r[M[0]] != null; }).sort(function (a, b) { return b[M[0]] - a[M[0]]; });
    var over = rows.filter(function (r) { return r.burden != null && r.burden >= 50; }).length;
    var finding = M[1] + ' is highest in ' + have[0].county + ' County (' + M[3](have[0][M[0]]) + ') and lowest in ' + have[have.length - 1].county + ' County (' + M[3](have[have.length - 1][M[0]]) + ').' +
      ' In ' + over + ' of 64 counties, half or more of renters pay 30% or more of income on housing.';
    var map = countyMap({
      features: s.data.b.features, picked: picked,
      value: function (k) { var r = rows.filter(function (x) { return x.key === k; })[0]; return r ? r[M[0]] : null; },
      label: function (k, v) { return v == null ? 'not published' : M[3](v); },
      href: function (k) { return q('county-costs', params, 'county', k); },
      fmt: M[3], kicker: M[1] + ', by county', title: finding.split('.')[0],
      note: M[4] + '. Select a county for its figures.'
    });
    var detail = '', pr = picked && rows.filter(function (r) { return r.key === picked; })[0], pp = picked && s.data.permits.counties[picked];
    if (pr) {
      detail = '<section class="cc-detail" aria-labelledby="cc-h"><h2 id="cc-h">' + esc(pr.county) + ' County</h2><div class="metrics">' + HC.slice(0, 6).map(function (h) {
        return '<div class="metric"><p class="metric-label">' + esc(h[1]) + '</p><p class="metric-value">' + esc(pr[h[0]] == null ? '—' : h[3](pr[h[0]])) + '</p></div>';
      }).join('') + '</div>' +
        (pp ? UI.bars('Homes permitted each year', 'Census Building Permits Survey; ' + pyears[0] + ' to ' + pyears[pyears.length - 1], pyears.map(function (y, i) { return [String(y), pp.units_total[i]]; }), num, 'homes') : '') +
        '<p><a href="' + esc(q('county-costs', params, 'county', null)) + '">← All counties</a> · <a href="#/place/' + esc(picked) + '">Needs assessment for ' + esc(pr.county) + ' County →</a></p></section>';
    }
    return T.head({
      kind: 'data', crumbs: T.trail('places', title), title: title,
      answer: 'Rents, incomes, home values, burden, vacancy and building in all 64 Colorado counties.',
      meta: '<span class="scope-tag">Scope: Colorado counties</span> Small counties carry wide survey margins; read their figures with care.'
    }) + chips('Which measure', HC.map(function (h) { return [h[0], h[1]]; }), M[0], function (k) { return q('county-costs', params, 'm', k === 'rent' ? null : k); }) +
      UI.intro('Where are housing costs highest against what people earn?', finding) + map + detail +
      '<h2>Every county</h2>' + UI.table('cc', 'Housing costs by county', [
        { key: 'county', label: 'County', href: function (r) { return q('county-costs', params, 'county', r.key); } }
      ].concat(HC.map(function (h) { return { key: h[0], label: h[1], num: true, fmt: h[3], tip: h[4] }; })), rows, { noun: 'counties', placeholder: 'County' }) +
      '<p>How each county changed over ten years, and the article’s construction wage maps, stay on <a href="' + HC_SRC + '">the full article ↗</a>. Ten-year trends for towns are in each place’s needs assessment.</p>' +
      T.source('Census ACS five-year estimates and Building Permits Survey, as the needs assessment reads them', HC_SRC, String(s.data.ranking.metadata.generatedAt).slice(0, 10)) +
      T.next('Next', [{ href: '#/places/ranking', label: 'HNA ranking →' }, { href: '#/places/economy', label: 'Economic dashboard', secondary: true }]);
  }

  // ---------- Multifamily lens ----------
  var MF_SRC = LIVE + 'census-dashboard.html';
  var STRUCT = [['DP04_0007E', 'Single-family, detached'], ['DP04_0008E', 'Single-family, attached'], ['DP04_0009E', '2 homes'], ['DP04_0010E', '3 or 4 homes'],
    ['DP04_0011E', '5 to 9 homes'], ['DP04_0012E', '10 to 19 homes'], ['DP04_0013E', '20 or more homes'], ['DP04_0014E', 'Mobile homes']];
  var GRAPI = [['DP04_0137PE', 'Under 15%'], ['DP04_0138PE', '15 to 20%'], ['DP04_0139PE', '20 to 25%'], ['DP04_0140PE', '25 to 30%'], ['DP04_0141PE', '30 to 35%'], ['DP04_0142PE', '35% or more']];
  // A place's ACS profile file. The hosted preview packs these per-place files into bundles (LAB_HNA_LOAD).
  var sums = {};
  function summaryFor(g) {
    var st = sums[g];
    if (st) return st;
    st = sums[g] = { data: null, error: null };
    var VENDOR = global.LAB_VENDOR;
    (global.LAB_HNA_LOAD ? global.LAB_HNA_LOAD(g).then(function (r) { return r[1]; })
      : fetch(VENDOR + 'data/hna/summary/' + g + '.json').then(function (r) { if (!r.ok) throw new Error('summary ' + r.status); return r.json(); }))
      .then(function (sum) { st.data = { sum: sum }; Shell.render(); })
      .catch(function (e) { st.error = 'The survey figures did not load (' + e.message + ').'; Shell.render(); });
    return st;
  }
  function multifamily(params) {
    var s = UI.load({ ranking: 'data/hna/ranking-index.json' });
    var title = 'Multifamily lens';
    if (!s.data) return waiting(title, s);
    var g = params.get('g') || '08';
    var list = rankList(s.data.ranking), r = list.filter(function (x) { return x.geoid === g; })[0];
    var name = g === '08' ? 'Colorado' : r ? cleanName(r.name) + (r.type === 'county' ? '' : '') : null;
    var head = T.head({
      kind: 'data', crumbs: T.trail('places', title), title: title,
      answer: 'Apartment stock, renters, rents and cost burden for Colorado and any county, town or CDP.',
      meta: '<span class="scope-tag">Scope: ' + esc(name || 'pick a place') + '</span> From the Census survey profile the needs assessment uses.'
    });
    if (!name) return head + placeSelect('mf-g', s.data.ranking, '', true) + '<p class="callout">No place with that code. Pick one above.</p>';
    var f = summaryFor(g);
    if (!f.data) return head + placeSelect('mf-g', s.data.ranking, g, true) + (f.error ? '<p class="callout">' + esc(f.error) + '</p>' : '<p role="status" class="note">Loading the survey figures…</p>');
    // The profile the needs assessment shows: one-year where the Census publishes it (counties over 65,000 and the
    // state), five-year otherwise.
    var a = f.data.sum.acsProfile || {}, one = a._acsSeries === 'acs1';
    var total = a.DP04_0001E, mf = ['DP04_0011E', 'DP04_0012E', 'DP04_0013E'].reduce(function (t, k) { return t + (a[k] || 0); }, 0);
    var burden = a.DP04_0141PE != null && a.DP04_0142PE != null ? a.DP04_0141PE + a.DP04_0142PE : null;
    var yr = !a._acsYear ? '' : one ? a._acsYear + ' (one-year)' : (a._acsYear - 4) + '–' + a._acsYear;
    var acsLink = 'https://data.census.gov/table/ACSDP' + (one ? '1Y' : '5Y') + (a._acsYear || 2024) + '.DP04?g=' + (g.length === 2 ? '040XX00US08' : g.length === 5 ? '050XX00US' + g : '160XX00US' + g);
    var src = '<a href="' + esc(acsLink) + '">Census ACS ' + esc(yr) + ', DP04</a>';
    var struct = Viz.sortedBars({ title: 'Homes by type of building', answer: total ? Math.round(mf / total * 100) + '% of ' + num(total) + ' homes are in buildings of five or more.' : '',
      rows: STRUCT.map(function (x) { return [x[1], a[x[0]]]; }), source: src });
    var bur = UI.bars('What renters pay, as a share of income', 'Renter households paying rent, ACS ' + yr, GRAPI.map(function (x) { return [x[1], a[x[0]]]; }), pct1, 'households');
    var counties = list.filter(function (x) { return x.type === 'county'; }).map(function (x) {
      var m = x.metrics || {};
      return { geoid: x.geoid, county: cleanName(x.name), renters: m.pct_renters, rent: m.gross_rent_median, severe: m.pct_renter_severe_burdened, lihtc: m.lihtc_project_count, gap: m.housing_gap_units };
    });
    return head + placeSelect('mf-g', s.data.ranking, g, true) +
      UI.intro('How much of ' + name + '’s housing is apartments, and how stretched are its renters?',
        (total ? Math.round(mf / total * 100) + '% of homes are in buildings of five or more. ' : '') + (a.DP04_0047PE != null ? Math.round(a.DP04_0047PE) + '% of households rent' : '') +
        (a.DP04_0134E ? ', at a median of ' + money(a.DP04_0134E) + ' a month' : '') + (burden != null ? ', and ' + Math.round(burden) + '% of renters pay 30% or more of income.' : '.')) +
      '<div class="metrics">' +
      '<div class="metric"><p class="metric-label">Homes in buildings of 5+</p><p class="metric-value">' + esc(num(mf)) + '</p><p class="metric-detail">' + esc(total ? Math.round(mf / total * 100) + '% of ' + num(total) : '') + '</p></div>' +
      '<div class="metric"><p class="metric-label">Renter households</p><p class="metric-value">' + esc(a.DP04_0047E == null ? '—' : num(a.DP04_0047E)) + '</p><p class="metric-detail">' + esc(a.DP04_0047PE == null ? '' : Math.round(a.DP04_0047PE) + '% of households') + '</p></div>' +
      '<div class="metric"><p class="metric-label">Median rent</p><p class="metric-value">' + esc(a.DP04_0134E ? money(a.DP04_0134E) : '—') + '</p><p class="metric-detail">Gross rent, a month</p></div>' +
      '<div class="metric"><p class="metric-label">Renters paying 30%+</p><p class="metric-value">' + esc(burden == null ? '—' : Math.round(burden) + '%') + '</p><p class="metric-detail">Of renters paying rent</p></div></div>' +
      struct + bur +
      '<h2>Every county</h2>' + UI.table('mf-counties', 'Renters, rent and tax credit buildings by county', [
        { key: 'county', label: 'County', href: function (x) { return '#/places/multifamily?g=' + x.geoid; } },
        { key: 'renters', label: 'Households renting', num: true, fmt: pct1 },
        { key: 'rent', label: 'Median rent', num: true, fmt: money },
        { key: 'severe', label: 'Renters paying 50%+', num: true, fmt: pct1, tip: 'Renter households paying half or more of income on housing' },
        { key: 'lihtc', label: 'Tax credit buildings', num: true, fmt: num },
        { key: 'gap', label: 'Homes short at 30% AMI', num: true, fmt: num, tip: 'Renter households at or below 30% of area median income, less homes priced for them (ACS 5-year with HUD income limits)' }
      ], counties, { noun: 'counties', placeholder: 'County' }) +
      '<p>Year built, statewide leaderboards read straight from the Census and tax credit maps stay on <a href="' + MF_SRC + '">the full Multifamily lens ↗</a>.</p>' +
      T.source('Census ACS 5-year profile (DP04) and the HNA ranking', MF_SRC, String(f.data.sum.updated || '').slice(0, 10)) +
      T.next('Next', [{ href: g === '08' ? '#/places' : '#/place/' + g, label: g === '08' ? 'Find a place →' : 'Full needs assessment →' }, { href: '#/places/county-costs', label: 'Housing costs by county', secondary: true }]);
  }

  // ---------- Colorado deep dive ----------
  var DD_SRC = LIVE + 'colorado-deep-dive.html';
  var QUAD = {
    underserved: ['High need, little funding', 'Need above the middle county, tax credit homes below it.'],
    aligned: ['High need, funded', 'Need and tax credit homes both above the middle county.'],
    'funded-above-need': ['Funded beyond need', 'Tax credit homes above the middle county, need below it.'],
    'low-need-low-funding': ['Low need, little funding', 'Need and tax credit homes both below the middle county.'],
    'not-computable': ['Not computable', 'Too few renters at 30% AMI to compare.']
  };
  function deepDive(params) {
    if (global.LabDeepDive) return global.LabDeepDive.view(params); // the full rebuild (site/deep-dive.js); this view stays as its fallback
    var s = UI.load({ fvn: 'data/derived/funding-vs-need.json', ami: 'data/co_ami_gap_by_county.json' });
    var title = 'Colorado deep dive';
    if (!s.data) return waiting(title, s);
    var fvn = s.data.fvn, ami = s.data.ami, st = ami.statewide, sw = fvn.statewide;
    var bands = ami.bands.filter(function (b) { return b <= 80; });
    var quadOn = params.get('quad');
    var amiRows = bands.map(function (b) {
      return { band: b + '% AMI', rent: st.affordable_rent_monthly[b], hh: st.households_le_ami_pct[b], units: st.units_priced_affordable_le_ami_pct[b], gap: st.gap_units_minus_households_le_ami_pct[b] };
    });
    var gap30 = -st.gap_units_minus_households_le_ami_pct[30];
    var counties = fvn.counties.map(function (c) {
      return { fips: c.fips, county: c.name.replace(/ County$/, ''), region: c.region, gap: c.need.gap_units_30ami, per1000: c.need.gap_per_1000_residents, units: c.funding.lihtc_units,
        per100: c.funding.lihtc_units_per_100_gap, p123: c.funding.prop123_dollars, quad: c.quadrant, quadText: (QUAD[c.quadrant] || [c.quadrant])[0], flags: (c.flags || []).join(', ') };
    });
    var shown = quadOn ? counties.filter(function (c) { return c.quad === quadOn; }) : counties;
    var w = fvn.meta.window;
    var byYear = Viz.timeLines({
      title: 'Tax credit homes awarded each year, ' + w.first_year + ' to ' + w.last_year,
      answer: num(sw.lihtc_units) + ' tax credit homes across ' + num(sw.tax_credit_awards) + ' round awards' + (typeof sw.bond_deals_outside_rounds === 'number' ? ' and ' + num(sw.bond_deals_outside_rounds) + ' 4% bond deals' : '') + '; Prop 123 added ' + money(sw.prop123_dollars) + ' across ' + num(sw.prop123_awards) + ' awards since 2023.',
      series: [{ label: 'Tax credit homes', color: C.homes, points: sw.by_year.map(function (y) { return [y.year, y.lihtc_units]; }) }], fmt: num,
      note: w.last_year + ' counts only the awards made so far this year.', source: '<a href="#/money">CHFA, OEDIT and DOLA award lists</a>'
    });
    return T.head({
      kind: 'data', crumbs: T.trail('places', title), title: title,
      answer: 'Colorado’s renters against the homes they can afford, and where tax credit and Prop 123 money has gone against need.',
      meta: '<span class="scope-tag">Scope: Colorado and its counties</span> Renter households and rents from the Census five-year survey; income limits from HUD.',
      facts: [
        { value: num(gap30), label: 'Renter households at 30% AMI without a home priced for them', source: 'ACS ' + ami.meta.acs_year + ' with HUD limits', href: ami.sources[2].url },
        { value: money(st.ami_4person), label: 'Colorado median income, family of four, ' + ami.meta.hud_income_limits_year, source: 'HUD', href: ami.sources[1].url },
        { value: num(sw.lihtc_units), label: 'Tax credit homes awarded, ' + w.first_year + '–' + w.last_year, source: 'CHFA award reports', href: '#/money?agency=CHFA' }
      ]
    }) +
      UI.intro('Do Colorado’s renters have homes they can afford?', 'At 30% of area median income, ' + num(st.households_le_ami_pct[30]) + ' renter households compete for ' + num(st.units_priced_affordable_le_ami_pct[30]) +
        ' homes priced for them. The shortfall shrinks with income and turns to a surplus near 70% AMI.') +
      '<h2>Renters and the homes priced for them, statewide</h2>' +
      UI.bars('Renter households at or below each income', 'Cumulative: each band includes the ones below it', amiRows.map(function (r) { return [r.band, r.hh]; }), num, 'households') +
      UI.bars('Homes renting at a price each band can pay', 'Rent at or below 30% of the band’s income', amiRows.map(function (r) { return [r.band + ' (' + money(r.rent) + ' a month)', r.units]; }), num, 'homes') +
      UI.table('dd-ami', 'Renters against homes priced for them, by income', [
        { key: 'band', label: 'Income' }, { key: 'rent', label: 'Rent they can pay', num: true, fmt: money },
        { key: 'hh', label: 'Renter households', num: true, fmt: num }, { key: 'units', label: 'Homes priced for them', num: true, fmt: num },
        { key: 'gap', label: 'Homes minus households', num: true, fmt: function (v) { return (v > 0 ? '+' : '') + num(v); }, tip: 'Negative means more households than homes' }
      ], amiRows, { noun: 'income bands', placeholder: 'Income' }) +
      '<p class="note">A home priced for a band can be rented by a household above it, so the real shortfall for the lowest incomes is larger than the count alone shows.</p>' +
      '<h2>Funding against need, by county</h2>' +
      '<p>Counties are split at the middle county on two measures: homes short at 30% AMI per 1,000 residents (' + esc(fvn.meta.quadrant_split.gap_per_1000_residents) + '), and tax credit homes awarded per 100 homes short (' + esc(fvn.meta.quadrant_split.lihtc_units_per_100_gap) + '). Select a group to list its counties.</p>' +
      '<div class="agency-cards">' + ['underserved', 'aligned', 'funded-above-need', 'low-need-low-funding'].map(function (k) {
        return '<a class="agency-card' + (quadOn === k ? ' is-on' : '') + '" href="' + esc(q('deep-dive', params, 'quad', quadOn === k ? null : k)) + '"><p class="lever-title">' + esc(QUAD[k][0]) + '</p><p class="metric-value">' + num(sw.quadrants[k]) + ' counties</p><p class="dq-what">' + esc(QUAD[k][1]) + '</p></a>';
      }).join('') + '</div>' +
      UI.table('dd-fvn', quadOn ? QUAD[quadOn][0] + ' counties' : 'Every county, need against tax credit homes and Prop 123 dollars', [
        { key: 'county', label: 'County', href: function (r) { return '#/place/' + r.fips; } },
        { key: 'region', label: 'Region' },
        { key: 'gap', label: 'Homes short at 30% AMI', num: true, fmt: num },
        { key: 'per1000', label: 'Short per 1,000 residents', num: true, fmt: function (v) { return v.toFixed(1); } },
        { key: 'units', label: 'Tax credit homes', num: true, fmt: num, tip: 'Awarded ' + w.first_year + '–' + w.last_year },
        { key: 'per100', label: 'Per 100 short', num: true, fmt: function (v) { return v.toFixed(1); }, tip: 'Tax credit homes per 100 households in the 30% AMI shortfall' },
        { key: 'p123', label: 'Prop 123 dollars', num: true, fmt: money },
        { key: 'quadText', label: 'Group' },
        { key: 'flags', label: 'Market notes', tip: 'high-vacancy: vacancy in the top quarter of counties. building-ahead: permits at least twice projected household growth.' }
      ], shown, { noun: 'counties', placeholder: 'County or region' }) +
      '<p class="note">' + esc(fvn.meta.coverage_measure) + ' ' + esc(fvn.meta.flag_method) + '</p>' + byYear +
      '<h2>More of the state picture</h2><div class="research-cards">' + [
        ['#/places/county-costs', 'Housing costs by county', 'Rents, incomes, prices and permits in all 64 counties.'],
        ['#/money', 'Where the money goes', 'Every CHFA, OEDIT and DOLA award, mapped.'],
        ['#/equity-pricing', 'Tax credit prices', 'What investors pay for credits now.'],
        ['#/places/costs', 'Construction costs', 'Apartment building prices since 2020.'],
        ['#/data/map?layer=qct', 'Data map', 'Qualified census tracts, difficult development areas and tax credit buildings.'],
        ['#/opportunity/preservation', 'Preservation inventory', 'Affordable homes that could be lost, and when.']
      ].map(function (c) { return '<a class="hub-card research-card" href="' + c[0] + '"><span class="hub-card-title">' + esc(c[1]) + '</span><span class="hub-card-desc">' + esc(c[2]) + '</span></a>'; }).join('') + '</div>' +
      '<p>Concessions, foreclosure, lender volume and market confidence stay on <a href="' + DD_SRC + '">the full Colorado Deep Dive ↗</a>.</p>' +
      T.source('HUD income limits, Census ACS B25118 and B25063, CHFA and OEDIT award lists', DD_SRC, String(fvn.meta.generatedAt).slice(0, 10)) +
      T.next('Next', [{ href: '#/places/ranking', label: 'HNA ranking →' }, { href: '#/money', label: 'Where the money goes', secondary: true }]);
  }

  // The economic dashboard's rebuild lives in economy.js (wave ticket 2A); this view stays as its fallback.
  var SUB = { scenario: scenario, economy: function (p, parts) { return global.LabEconomy ? global.LabEconomy.view(p, parts) : economy(p, parts); }, 'county-costs': function (p, x) { return global.LabCountyCosts.countyCosts(p, x); }, multifamily: function (p, x) { return global.LabCountyCosts.multifamily(p, x); }, 'deep-dive': deepDive };
  var hub = Shell.views.places;
  Shell.views.places = function (params, parts) {
    var f = parts && SUB[parts[1]];
    return f ? f(params, parts) : hub(params, parts);
  };
  global.LabPlacesState = { scenario: scenario, economy: economy, countyCosts: countyCosts, multifamily: multifamily, deepDive: deepDive, sbParams: sbParams, HC: HC, countyMap: countyMap };
})(window);
