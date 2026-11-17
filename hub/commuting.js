// Commuting and jobs (#/opportunity/commuting): the live commuting page rebuilt in the lab style. Reads the
// same two files the live page reads, LEHD LODES commute counts by town (data/market/commute-strength.json)
// and the principal-employer tables from local audit filings (data/market/principal-employers.json), and
// computes only what the live page computes: shares, and a yearly drive cost at the IRS rate.
(function (global) {
  'use strict';

  var Shell = global.LabShell, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;

  var FILES = {
    commute: 'data/market/commute-strength.json',
    employers: 'data/market/principal-employers.json',
    counties: 'data/boundaries/counties_co.geojson'
  };
  // IRS standard mileage rate from 1 July 2026 (Announcement 2026-11). It covers the full cost of a car, so a
  // cost built on it is the high end per mile; distances are straight-line, so the miles are a floor.
  var IRS_RATE = 0.76, WORKDAYS = 240;
  // Share of a town's jobs held by people driving 20 to 60 miles in, light to strong (Okabe-Ito, as live).
  var BINS = [
    { max: 0.05, color: 'var(--share-0)', label: 'Under 5%' },
    { max: 0.15, color: 'var(--cat-6)', label: '5 to 15%' },
    { max: 0.25, color: 'var(--cat-2)', label: '15 to 25%' },
    { max: Infinity, color: 'var(--cat-5)', label: '25% or more' }
  ];
  var IRS_URL = 'https://www.journalofaccountancy.com/news/2026/jul/irs-raises-standard-mileage-rates-for-remainder-of-2026/';
  // Time and cost (paul, 17 Nov 2026: "commute times would be better than distance... and the cost associated with
  // commuting and low paid jobs... causing economic stress"). Travel times are the Census Bureau's own (ACS); drive
  // minutes and road miles per home town come from data/market/commute-time-cost.json. The drive is priced two ways:
  // gas and upkeep only, AAA Your Driving Costs (September 2025): fuel 13 cents + maintenance, repair and tires
  // 11.04 cents a mile; and the full cost of a car, the IRS rate above. Pay is a full-time year at Colorado's 2026
  // minimum wage, $15.16 an hour (COMPS Order #40, Rule 3), 2,080 hours.
  var TIME_FILES = { tc: 'data/market/commute-time-cost.json' };
  var RUN_RATE = 0.2404, MIN_WAGE = 15.16, YEAR_HOURS = 2080, MIN_YEAR = MIN_WAGE * YEAR_HOURS;
  var AAA_URL = 'https://newsroom.aaa.com/wp-content/uploads/2025/09/UPDATE-AAA-Fact-Sheet-Your-Driving-Cost-9.2025-1.pdf';
  var WAGE_URL = 'https://cdle.colorado.gov/sites/cdle/files/2026_comps_order_poster_english_%5Baccessible%5D.pdf';
  // A drive longer than this is not costed as a daily commute (LODES places some workers at a main office).
  var DAILY_MAX_MIN = 90;
  var TIME_COLORS = ['var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)'];

  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; }
  function cost(miles) { return miles ? '$' + (Math.round(2 * miles * WORKDAYS * IRS_RATE / 10) * 10).toLocaleString('en-US') : null; }
  function farShare(p) { return p.jobs ? p.far / p.jobs : 0; }
  function binFor(share) { for (var i = 0; i < BINS.length; i++) if (share < BINS[i].max) return BINS[i]; return BINS[BINS.length - 1]; }
  // "Silverthorne (town)" reads as "Silverthorne" in the list and the sentence.
  function bare(name) { return String(name).replace(/\s*\([^)]*\)$/, ''); }

  // The first useful answer for a town, worded as the live page words it.
  function answer(p) {
    var c = cost(p.median_far_miles);
    return p.name + ': ' + num(p.in_commuters) + ' of its ' + num(p.jobs) + ' jobs (' + pct(p.in_commuters, p.jobs) + ') are held by people who live somewhere else. ' +
      num(p.far) + ' of them live 20 to 60 miles away' + (c ? ', a drive that costs about ' + c + ' a year at the typical distance' : '') + '.';
  }

  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  function xy(lon, lat) { return [K.x(lon).toFixed(1), K.y(lat).toFixed(1)]; }

  function townHref(geoid) { return '#/opportunity/commuting?town=' + encodeURIComponent(geoid) + '&at=cj-town'; }

  function map(d, list, byName, sel) {
    var outline = d.counties.features.map(function (f) {
      var rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return '<path d="' + rings.map(function (poly) { return poly.map(function (ring) { return 'M' + ring.map(function (c) { return xy(c[0], c[1]).join(' '); }).join('L') + 'Z'; }).join(''); }).join('') + '"></path>';
    }).join('');
    var flows = '';
    if (sel) {
      var max = sel.from.length ? sel.from[0][1] : 1, to = xy(sel.lon, sel.lat);
      flows = '<g class="cj-flows-lines">' + sel.from.map(function (f) {
        // Homes in another state are named by county ("San Juan County, NM") and drawn from that county's point.
        var pt = (d.commute.other_state_points || {})[f[0]];
        var o = byName[String(f[0]).toLowerCase()] || (pt ? { lat: pt[0], lon: pt[1] } : null);
        if (!o) return '';
        var a = xy(o.lon, o.lat);
        return '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + to[0] + '" y2="' + to[1] + '" stroke-width="' + (1.5 + 6 * f[1] / max).toFixed(1) + '"><title>' + esc(bare(f[0]) + ' to ' + bare(sel.name) + ': ' + num(f[1]) + ' workers') + '</title></line>';
      }).join('') + '</g>';
    }
    var dots = list.slice().sort(function (a, b) { return b.jobs - a.jobs; }).map(function (p) {
      var c = xy(p.lon, p.lat), r = Math.max(3, Math.min(13, 1.5 + Math.sqrt(p.jobs) / 24)).toFixed(1);
      var t = bare(p.name) + ': ' + pct(p.far, p.jobs) + ' of ' + num(p.jobs) + ' jobs held by people driving 20 to 60 miles in';
      return '<a href="' + esc(townHref(p.geoid)) + '"' + (sel && sel.geoid === p.geoid ? ' class="is-picked"' : '') + '><circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + r + '" style="fill:' + binFor(farShare(p)).color + '"><title>' + esc(t) + '</title></circle></a>';
    }).join('');
    return '<figure class="pres-map cj-map">' +
      '<figcaption><span class="cc-kicker">Share of each town’s jobs held by people driving 20 to 60 miles in</span><strong>' + esc((function () {
        var t = list.slice().sort(function (a, b) { return farShare(b) - farShare(a); });
        return t.length > 1 ? 'Statewide, people driving 20 to 60 miles in hold the most jobs in ' + bare(t[0].name) + ' (' + pct(t[0].far, t[0].jobs) + ') and ' + bare(t[1].name) + ' (' + pct(t[1].far, t[1].jobs) + ')' : 'Share of each town’s jobs held by people driving 20 to 60 miles in';
      })()) + '</strong><span class="note">' + (sel ? 'This headline is for all of Colorado. ' + esc(bare(sel.name)) + ' is outlined, with lines from the towns that send it the most workers; its own numbers are above. ' : '') + 'One dot per town with 200 or more jobs, sized by its jobs. Select a dot, or pick a town above, to see its numbers and the towns that send it the most workers.</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="Colorado towns shaded by the share of jobs held by people driving 20 to 60 miles in">' +
      '<g class="pm-counties is-quiet">' + outline + '</g>' + flows + '<g class="pm-layer cj-dots">' + dots + '</g>' + K.metroBox() + K.cities() + '</svg></div>' +
      '<ul class="lb-key">' + BINS.map(function (b) { return '<li><span class="pm-key" style="background:' + b.color + '" aria-hidden="true"></span>' + esc(b.label) + ' <b>' + num(list.filter(function (p) { return binFor(farShare(p)) === b; }).length) + '</b></li>'; }).join('') + '</ul>' +
      // Map kit part 3: the Denver metro close-up, the same towns and shares.
      K.inset({ features: d.counties.features, groups: [{ cls: 'cj-dots', dots: list.slice().sort(function (a, b) { return b.jobs - a.jobs; }).map(function (p) {
        return { lon: p.lon, lat: p.lat, r: Math.max(4, Math.min(16, 2 + Math.sqrt(p.jobs) / 18)), fill: binFor(farShare(p)).color, href: esc(townHref(p.geoid)), label: esc(bare(p.name) + ': ' + pct(p.far, p.jobs) + ' of ' + num(p.jobs) + ' jobs held by people driving 20 to 60 miles in') };
      }) }] }) +
      '<p class="note">County outlines: US Census TIGER. Towns are placed at the point the commute file gives.</p>' +
      (global.LabVizData ? global.LabVizData.block('Share of each town’s jobs held by people driving 20 to 60 miles in', ['Town', 'Jobs', 'Held by people driving 20 to 60 miles in', 'Share (%)'],
        list.slice().sort(function (a, b) { return b.jobs - a.jobs; }).map(function (p) { return [bare(p.name), p.jobs, p.far, p.jobs ? Math.round(p.far / p.jobs * 1000) / 10 : null]; })) : '') + '</figure>';
  }

  // ---------- time, cost and the town map (17 Nov 2026) ----------
  function round10(v) { return Math.round(v / 10) * 10; }
  function dollars(v) { return '$' + round10(v).toLocaleString('en-US'); }
  function yearCost(miles, rate) { return 2 * miles * WORKDAYS * rate; }
  function share(v) { return Math.round(100 * v / MIN_YEAR) + '%'; }
  // The new file is newer than the lab's pinned data copy: the public site (LAB_PORT) and the preview (which takes
  // data from Housing-Analytics main, LAB_DATA_AS_OF) read it; the bare lab at the pin shows the page without it.
  function timeData() {
    if (!global.LAB_PORT && !global.LAB_DATA_AS_OF) return null;
    var s = UI.load(TIME_FILES);
    return s.data ? s.data.tc : (s.error ? { error: s.error } : { loading: true });
  }
  function moeOf(list) { return Math.round(Math.sqrt(list.reduce(function (t, b) { return t + (b[2] || 0) * (b[2] || 0); }, 0))); }
  function longShare(side) { return side.bands.slice(2).reduce(function (t, b) { return t + b[1]; }, 0) / side.total[0]; }

  function timeCard(tc, p) {
    var e = tc.places[p.geoid] || {}, w = e.work, h = e.home, nm = bare(p.name), A = tc.meta.acs;
    if (!w && !h) return '<div class="cj-card"><p class="cc-kicker">How long the trip to work takes</p><p class="note">The Census Bureau does not publish travel times for ' + esc(nm) + '.</p></div>';
    var labels = A.bands.map(function (b) { return b[1]; });
    var bar = function (side, title) {
      if (!side) return '<p class="cj-bar-title">' + esc(title) + '</p><p class="note">Not published for this town.</p>';
      return '<p class="cj-bar-title">' + esc(title) + ' <span>' + num(side.total[0]) + ' workers</span></p><div class="cj-bar" role="img" aria-label="' + esc(title + ': ' + side.bands.map(function (b, i) { return labels[i] + ' ' + Math.round(100 * b[1] / side.total[0]) + '%'; }).join(', ')) + '">' +
        side.bands.map(function (b, i) { return b[1] ? '<span style="width:' + (100 * b[1] / side.total[0]).toFixed(2) + '%;background:' + TIME_COLORS[i] + '" data-tip="' + esc(title + ', ' + labels[i].toLowerCase() + ': ' + num(b[1]) + ' (±' + num(b[2]) + ')') + '"></span>' : ''; }).join('') + '</div>';
    };
    var pc = function (side, i) { return side ? Math.round(100 * side.bands[i][1] / side.total[0]) + '%' : '–'; };
    var head;
    if (w && h) head = Math.round(100 * longShare(w)) + '% of people who work in ' + nm + ' travel 30 minutes or more each way. Of people who live there, ' + Math.round(100 * longShare(h)) + '% do.';
    else if (w) head = Math.round(100 * longShare(w)) + '% of people who work in ' + nm + ' travel 30 minutes or more each way.';
    else head = Math.round(100 * longShare(h)) + '% of people who live in ' + nm + ' travel 30 minutes or more each way to work.';
    // A rough estimate says so: the 30-minute-plus share's margin is more than a third of the estimate.
    var rough = [w, h].some(function (s) { if (!s) return false; var b = s.bands.slice(2), est = b.reduce(function (t, x) { return t + x[1]; }, 0); return est && moeOf(b) > est / 3; });
    return '<div class="cj-card"><p class="cc-kicker">How long the trip to work takes</p><p class="cj-head">' + esc(head) + '</p>' +
      bar(w, 'Work in ' + nm) + bar(h, 'Live in ' + nm) +
      '<ul class="cj-key"><li class="cj-key-head"><span>One way</span><b>Work · Live</b></li>' + labels.map(function (l, i) {
        return '<li><i style="background:' + TIME_COLORS[i] + '" aria-hidden="true"></i><span>' + esc(l) + '</span><b>' + pc(w, i) + ' · ' + pc(h, i) + '</b></li>';
      }).join('') + '</ul>' +
      (rough ? '<p class="note">Small survey samples here: treat these shares as rough. Tap a bar for each count and its margin of error.</p>' : '') +
      '<p class="note metric-source">Source: U.S. Census Bureau, ' + esc(A.label) + ', <a href="' + esc(A.work.url) + '">table ' + esc(A.work.table) + '</a> (by where people work) and <a href="' + esc(A.home.url) + '">table ' + esc(A.home.table) + '</a> (by where they live). Workers who do not work from home, every way of getting there, one way.</p>' +
      (global.LabVizData ? global.LabVizData.block('How long the trip to work takes, ' + nm, ['Minutes, one way', 'Work here', 'Margin (±)', 'Live here', 'Margin (±)'],
        labels.map(function (l, i) { return [l, w ? w.bands[i][1] : null, w ? w.bands[i][2] : null, h ? h.bands[i][1] : null, h ? h.bands[i][2] : null]; })) : '') + '</div>';
  }

  function costRows(tc, p) {
    var e = tc.places[p.geoid];
    return ((e && e.from) || []).filter(function (r) { return r[2] != null && r[3] != null && r[2] <= DAILY_MAX_MIN; });
  }
  function costCard(tc, p) {
    var rows = costRows(tc, p), nm = bare(p.name);
    if (!rows.length) return '';
    var top = rows.slice().sort(function (a, b) { return b[1] - a[1]; })[0];
    var scale = Math.max(0.5, Math.max.apply(null, rows.map(function (r) { return yearCost(r[3], IRS_RATE) / MIN_YEAR; })));
    var hours = function (r) { return Math.round(2 * r[2] * WORKDAYS / 60); };
    var head = 'A full-time worker on Colorado’s $' + MIN_WAGE.toFixed(2) + ' minimum wage who drives in from ' + bare(top[0]) + ' spends ' + share(yearCost(top[3], RUN_RATE)).replace('%', '') + ' to ' + share(yearCost(top[3], IRS_RATE)) + ' of their pay on the drive, and ' + num(hours(top)) + ' hours a year in the car.';
    return '<div class="cj-card"><p class="cc-kicker">What the drive costs a lower-paid worker</p><p class="cj-head">' + esc(head) + '</p>' +
      '<p>' + num(p.in_low) + ' of the ' + num(p.in_commuters) + ' people who drive in to ' + esc(nm) + ' earn $3,333 a month or less.</p>' +
      '<ul class="cj-costs">' + rows.map(function (r) {
        var lo = yearCost(r[3], RUN_RATE), hi = yearCost(r[3], IRS_RATE);
        return '<li><p class="cj-cost-top"><b>' + esc(bare(r[0])) + '</b><span>' + num(r[1]) + ' workers · ' + Math.round(r[2]) + ' min · ' + Math.round(r[3]) + ' road miles</span></p>' +
          '<div class="cj-cost-bar" aria-hidden="true"><span class="lo" style="width:' + (100 * lo / MIN_YEAR / scale).toFixed(1) + '%"></span><span class="hi" style="width:' + (100 * (hi - lo) / MIN_YEAR / scale).toFixed(1) + '%"></span></div>' +
          '<p class="cj-cost-text">' + dollars(lo) + ' to ' + dollars(hi) + ' a year, <b>' + share(lo).replace('%', '') + ' to ' + share(hi) + '</b> of a minimum-wage year · ' + num(hours(r)) + ' hours in the car</p></li>';
      }).join('') + '</ul>' +
      '<p class="cj-cost-key" aria-hidden="true"><span><i class="lo"></i>Gas and upkeep only</span><span><i class="hi"></i>Full cost of the car</span></p>' +
      '<p class="note">Each bar is a share of a full-time minimum-wage year ($' + MIN_WAGE.toFixed(2) + ' × 2,080 hours = ' + dollars(MIN_YEAR) + '). Round trip, ' + WORKDAYS + ' workdays. Drives over ' + DAILY_MAX_MIN + ' minutes are not costed. The minimum wage is an example worker, not what these commuters earn.</p>' +
      '<p class="note metric-source">Sources: gas and upkeep 24 cents a mile (<a href="' + AAA_URL + '">AAA Your Driving Costs, September 2025</a>: fuel 13 cents, maintenance, repair and tires 11 cents); full cost 76 cents a mile (IRS rate from 1 July 2026, <a href="' + IRS_URL + '">Journal of Accountancy</a>); minimum wage (<a href="' + WAGE_URL + '">Colorado COMPS Order #40, 2026</a>); drive minutes and road miles routed over <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (OSRM, no traffic), from each home town to where the jobs are, built ' + esc(tc.meta.generated) + '; workers and pay band: LEHD LODES ' + esc(tc.meta.lodes_year) + '.</p>' +
      (global.LabVizData ? global.LabVizData.block('What the drive into ' + nm + ' costs', ['Home town', 'Workers', 'Drive (min)', 'Road miles', 'Gas and upkeep a year ($)', 'Full cost a year ($)', 'Share of a minimum-wage year (%)', 'Hours in the car a year'],
        rows.map(function (r) { return [bare(r[0]), r[1], r[2], r[3], round10(yearCost(r[3], RUN_RATE)), round10(yearCost(r[3], IRS_RATE)), Math.round(100 * yearCost(r[3], RUN_RATE) / MIN_YEAR) + ' to ' + Math.round(100 * yearCost(r[3], IRS_RATE) / MIN_YEAR), Math.round(2 * r[2] * WORKDAYS / 60)]; })) : '') + '</div>';
  }

  // The town's own commute map: its home towns (or its residents' work towns) with an arrow each, sized by workers,
  // on the street map (site/map-base.js reads data-geo). Places beyond the daily drive are listed under the map.
  function townMap(tc, p, dir) {
    var e = tc.places[p.geoid], out = dir === 'out', nm = bare(p.name);
    var all = ((e && (out ? e.to : e.from)) || []);
    var near = all.filter(function (r) { return r[4] != null && r[2] != null && r[2] <= DAILY_MAX_MIN; });
    var far = all.filter(function (r) { return near.indexOf(r) < 0; });
    var toggle = '<p class="cj-dir" role="group" aria-label="Which way">' + [['in', 'Coming in'], ['out', 'Going out']].map(function (o) {
      return '<a href="' + esc('#/opportunity/commuting?town=' + encodeURIComponent(p.geoid) + (o[0] === 'out' ? '&dir=out' : '') + '&at=cj-town-map') + '"' + ((o[0] === 'out') === out ? ' aria-current="true" class="is-on"' : '') + '>' + o[1] + '</a>';
    }).join('') + '</p>';
    var title = out ? 'Where ' + nm + '’s residents work' : 'Where ' + nm + '’s in-commuters live';
    var shown = all.reduce(function (t, r) { return t + r[1]; }, 0), total = out ? p.out_commuters : p.in_commuters;
    var listOf = function (rows, numbered) { return rows.map(function (r, i) { return '<li>' + (numbered ? '<i aria-hidden="true">' + (i + 1) + '</i>' : '') + '<b>' + esc(bare(r[0])) + '</b><span>' + num(r[1]) + ' workers' + (r[2] != null ? ' · ' + Math.round(r[2]) + ' min' : '') + '</span></li>'; }).join(''); };
    var svg = '';
    if (near.length) {
      // The town's own end: where its jobs are for people coming in, where its residents live for people going out.
      var end = (out ? e.homes_at : e.jobs_at) || [p.lat, p.lon];
      var pts = [end].concat(near.map(function (r) { return [r[4], r[5]]; }));
      var w = 180, ea = -180, so = 90, no = -90;
      pts.forEach(function (q) { w = Math.min(w, q[1]); ea = Math.max(ea, q[1]); so = Math.min(so, q[0]); no = Math.max(no, q[0]); });
      var lat0 = (so + no) / 2, k = Math.cos(lat0 * Math.PI / 180);
      // At least 25 miles across, then a margin so arrows and numbers stay inside.
      var minLat = 25 / 69, minLon = 25 / (69 * k);
      if (no - so < minLat) { var c1 = (no + so) / 2; so = c1 - minLat / 2; no = c1 + minLat / 2; }
      if (ea - w < minLon) { var c2 = (ea + w) / 2; w = c2 - minLon / 2; ea = c2 + minLon / 2; }
      var padLat = (no - so) * 0.14, padLon = (ea - w) * 0.14;
      w -= padLon; ea += padLon; so -= padLat; no += padLat;
      var W = 720, H = Math.max(420, Math.min(720, Math.round(W * (no - so) / ((ea - w) * k))));
      var sc = Math.min(W / ((ea - w) * k), H / (no - so)), ox = (W - (ea - w) * k * sc) / 2, oy = (H - (no - so) * sc) / 2;
      var X = function (lon) { return ox + (lon - w) * k * sc; }, Y = function (lat) { return oy + (no - lat) * sc; };
      var geo = [w - ox / (k * sc), no - (H - oy) / sc, w + (W - ox) / (k * sc), no + oy / sc].map(function (v) { return v.toFixed(5); }).join(' ');
      var hx = X(end[1]), hy = Y(end[0]), max = Math.max.apply(null, near.map(function (r) { return r[1]; }));
      var arrows = near.map(function (r) {
        var a = [X(r[5]), Y(r[4])], b = [hx, hy];
        if (out) { var t = a; a = b; b = t; }
        var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1, bend = 0.18 * L;
        var cx = (a[0] + b[0]) / 2 - dy / L * bend, cy = (a[1] + b[1]) / 2 + dx / L * bend;
        // Stop short of the end marker so the arrowhead shows.
        var ex = b[0] - cx, ey = b[1] - cy, el = Math.sqrt(ex * ex + ey * ey) || 1, stop = out ? 32 : 26;
        var bx = b[0] - ex / el * stop, by = b[1] - ey / el * stop;
        return '<path d="M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1) + '" stroke-width="' + (5 + 18 * r[1] / max).toFixed(1) + '" marker-end="url(#cj-head-' + (out ? 'out' : 'in') + ')" data-tip="' + esc((out ? nm + ' to ' + bare(r[0]) : bare(r[0]) + ' to ' + nm) + ': ' + num(r[1]) + ' workers, ' + Math.round(r[2]) + ' minutes') + '"></path>';
      }).join('');
      var marks = near.map(function (r, i) {
        var x = X(r[5]).toFixed(1), y = Y(r[4]).toFixed(1);
        return '<g data-tip="' + esc(bare(r[0]) + ': ' + num(r[1]) + ' workers, ' + Math.round(r[2]) + ' minutes') + '"><circle cx="' + x + '" cy="' + y + '" r="28"></circle><text x="' + x + '" y="' + (+y + 11).toFixed(1) + '">' + (i + 1) + '</text></g>';
      }).join('');
      svg = '<div class="pm-frame"><svg viewBox="0 0 ' + W + ' ' + H + '" data-geo="' + geo + '" role="img" aria-label="' + esc(title + ': ' + near.map(function (r) { return bare(r[0]) + ' ' + num(r[1]) + ' workers'; }).join(', ')) + '">' +
        '<defs><marker id="cj-head-' + (out ? 'out' : 'in') + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="30" markerHeight="30" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z"></path></marker></defs>' +
        '<g class="cj-arrows' + (out ? ' is-out' : '') + '">' + arrows + '</g><g class="cj-marks' + (out ? ' is-out' : '') + '">' + marks + '</g>' +
        '<g class="cj-home" data-geo-size="1"><circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="18"></circle><text x="' + hx.toFixed(1) + '" y="' + (hy + 56).toFixed(1) + '"' + (hx > W * 0.7 ? ' style="text-anchor:end"' : hx < W * 0.3 ? ' style="text-anchor:start"' : '') + '>' + esc(nm) + '</text></g></svg></div>';
    }
    return '<figure class="pres-map cj-town-map" id="cj-town-map" tabindex="-1"><figcaption><span class="cc-kicker">Commute map</span><strong>' + esc(title) + '</strong></figcaption>' + toggle + svg +
      (near.length ? '<ol class="cj-places' + (out ? ' is-out' : '') + '">' + listOf(near, true) + '</ol>' : '<p class="note">None of the largest ' + (out ? 'work towns' : 'home towns') + ' is a daily drive away.</p>') +
      (far.length ? '<p class="cj-far"><b>Farther than a daily drive:</b></p><ul class="cj-places cj-far-list">' + listOf(far, false) + '</ul><p class="note">Trips this long are often a main-office address, not a daily drive.</p>' : '') +
      '<p class="note">Arrow width shows workers. These are the five places that send ' + (out ? 'it' : 'it') + ' the most workers' + (out ? ' (its residents’ five largest work towns)' : '') + ': ' + num(shown) + ' of its ' + num(total) + (out ? ' residents who work in another town' : ' in-commuters') + '. Minutes are the drive with no traffic.</p>' +
      '<p class="note metric-source">Source: LEHD LODES ' + esc(tc.meta.lodes_year) + ', primary jobs; drive times over OpenStreetMap (OSRM), built ' + esc(tc.meta.generated) + '.</p></figure>';
  }

  // Jobs against the people who live here (option C, paul "build c", 17 Nov 2026): two bars on one scale, the
  // jobs in town and the town's working residents, each split by who stays. Every number is in the commute file.
  function balanceCard(p) {
    var nm = bare(p.name), J = p.jobs, R = p.residents, both = J - p.in_commuters, mx = Math.max(J, R);
    if (!J || !R) return '';
    var r = J / R;
    var head = r >= 1.15 ? nm + ' has about ' + r.toFixed(1) + ' jobs for every working resident, so most of its workers have to come from somewhere else.'
      : r <= 0.87 ? nm + ' has about ' + (1 / r).toFixed(1) + ' working residents for every job, so many of its residents work somewhere else.'
      : nm + ' has about one job for every working resident.';
    var row = function (label, total, parts) {
      return '<p class="cj-bar-title">' + esc(label) + ' <span>' + num(total) + '</span></p><div class="cj-bar cj-bal" style="width:' + (100 * total / mx).toFixed(1) + '%">' +
        parts.map(function (x) { return '<span style="width:' + (100 * x[0] / total).toFixed(2) + '%;background:' + x[1] + '" data-tip="' + esc(x[2] + ': ' + num(x[0])) + '"></span>'; }).join('') + '</div>';
    };
    return '<div class="cj-card"><p class="cc-kicker">Jobs and the people who live here</p><p class="cj-head">' + esc(head) + '</p>' +
      row('Jobs in ' + nm, J, [[both, 'var(--map-5)', 'Held by people who live in town'], [p.in_commuters, 'var(--map-1)', 'Held by people who live somewhere else']]) +
      row('Working residents', R, [[both, 'var(--map-5)', 'Work in town'], [p.out_commuters, 'var(--gold)', 'Work in another town']]) +
      '<ul class="cj-key"><li><i style="background:var(--map-5)" aria-hidden="true"></i><span>Live and work in ' + esc(nm) + '</span><b>' + num(both) + '</b></li>' +
      '<li><i style="background:var(--map-1)" aria-hidden="true"></i><span>Jobs held by people who live somewhere else</span><b>' + num(p.in_commuters) + '</b></li>' +
      '<li><i style="background:var(--gold)" aria-hidden="true"></i><span>Residents who work in another town</span><b>' + num(p.out_commuters) + '</b></li></ul>' +
      '<p class="note metric-source">Source: LEHD LODES ' + esc(lodesYear) + ', primary jobs, so each worker counts once.</p></div>';
  }
  var lodesYear = '';

  function timeAndCost(p, dir) {
    var tc = timeData();
    if (!tc) return balanceCard(p);
    if (tc.loading) return balanceCard(p) + '<p role="status" class="note">Loading travel times…</p>';
    if (tc.error) return balanceCard(p) + '<p class="note">' + esc(tc.error) + '</p>';
    return timeCard(tc, p) + balanceCard(p) + costCard(tc, p) + townMap(tc, p, dir);
  }

  function detail(p, dir) {
    var c = cost(p.median_far_miles);
    var stat = function (v, t) { return '<li><b>' + esc(v) + '</b><span>' + esc(t) + '</span></li>'; };
    var flow = function (title, rows) { return UI.bars(title, 'The five largest, workers', rows.map(function (f) { return [bare(f[0]), f[1]]; }), num); };
    return '<div class="cj-detail"><h3>' + esc(bare(p.name)) + '</h3><p class="chapter-finding">' + esc(answer(p)) + '</p>' + timeAndCost(p, dir) + '<ul class="cj-stats">' +
      stat(num(p.jobs), 'jobs in town (primary jobs)') +
      stat(pct(p.in_commuters, p.jobs), 'held by people who live elsewhere (' + num(p.in_commuters) +
        (p.in_other_state ? ', of whom ' + num(p.in_other_state) + ' live in another state' : '') + ')') +
      stat(num(p.far), 'drive in from 20 to 60 miles; ' + num(p.far_low) + ' of them earn $3,333 a month or less') +
      (c ? stat(c, 'a year for a typical 20 to 60 mile commuter (' + p.median_far_miles + ' miles each way, straight line, 240 days, IRS rate)') : '') +
      stat(num(p.long), 'recorded 60+ miles away; many are not daily trips, so they are not costed') +
      stat(pct(p.out_commuters, p.residents), 'of working residents work in another town (' + num(p.out_commuters) + ' of ' + num(p.residents) +
        (p.out_other_state ? '; ' + num(p.out_other_state) + ' of them in another state' : '') + ')') +
      '</ul><div class="chart-pair">' + flow('Where its in-commuters live', p.from) + flow('Where its residents work', p.to) + '</div>' +
      (UI.placeFor(bare(p.name)) ? '<p><a class="button-link secondary" href="' + esc(UI.placeFor(bare(p.name))) + '">Housing need in ' + esc(bare(p.name)) + '</a></p>' : '') + '</div>';
  }

  function sourceLine(meta) {
    return '<p class="note metric-source">Source: U.S. Census Bureau, LEHD LODES ' + esc(meta.lodes_year) + ' origin-destination file, primary jobs (<a href="' + esc(meta.source) + '">co_od_main_JT01_' + esc(meta.lodes_year) + '</a>), home block to work block; built ' + esc(meta.generated) +
      '. Straight-line miles. Cost at the IRS rate of 76 cents a mile from 1 July 2026, 240 workdays.</p>';
  }

  function picker(name, label, options, cur) {
    return '<label class="opp-menu"><span>' + esc(label) + '</span><select data-cj-pick="' + esc(name) + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function params() { var h = location.hash || '', q = h.indexOf('?'); return new URLSearchParams(q > -1 ? h.slice(q + 1) : ''); }
  document.addEventListener('change', function (ev) {
    var k = ev.target.dataset && ev.target.dataset.cjPick;
    if (!k) return;
    var p = params();
    p.delete('at');
    if (k === 'town') p.delete('dir');
    if (ev.target.value) p.set(k, ev.target.value); else p.delete(k);
    history.replaceState(null, '', '#/opportunity/commuting' + (p.toString() ? '?' + p.toString() : ''));
    Shell.render();
    var again = document.querySelector('[data-cj-pick="' + k + '"]');
    if (again) again.focus();
  });

  function employers(doc, cur) {
    var areas = doc.areas || [], i = Math.max(0, Math.min(areas.length - 1, Number(cur) || 0)), a = areas[i], s = a.source;
    return '<section id="cj-employers" tabindex="-1"><h2>Largest employers</h2>' +
      '<p>As each county or city printed them in its audited annual financial report. A filer that reprints another government’s table says so in its source line.</p>' +
      picker('area', 'Area', areas.map(function (x, n) { return [n, x.area + ' (' + x.as_of + ')']; }).sort(function (x, y) { return x[1].localeCompare(y[1], 'en', { sensitivity: 'base' }); }), i) +
      '<div class="table-scroll" role="region" tabindex="0" aria-label="Largest employers"><table><caption>Largest employers, ' + esc(a.area) + ', ' + esc(a.as_of) + '</caption><thead><tr><th scope="col" class="num">Rank</th><th scope="col">Employer</th><th scope="col" class="num">Employees</th></tr></thead><tbody>' +
      a.rows.map(function (r) { return '<tr><td class="num">' + esc(r.rank == null ? '' : r.rank) + '</td><td>' + esc(r.employer) + '</td><td class="num">' + esc(r.employees) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="note metric-source">Source: ' + esc(s.filer) + ', annual financial report filed with the Office of the State Auditor (<a href="' + esc(s.url) + '">PDF</a>' + (s.pdf_page ? ', PDF page ' + esc(s.pdf_page) : '') + '), “Principal Employers”, ' + esc(a.as_of) + '. Its source: ' + esc(a.stated_source) + '.</p></section>';
  }

  function view() {
    var T = global.LabTpl, title = 'Commuting and jobs';
    var head = function (extra) { return T.head(Object.assign({ kind: 'data', crumbs: T.trail('opportunities', title), title: title }, extra || {})); };
    var s = UI.load(FILES);
    if (s.error) return head() + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return head() + '<p role="status" class="note">Loading the public records…</p>';
    var d = s.data, meta = d.commute.meta, places = d.commute.places;
    lodesYear = meta.lodes_year;
    var list = Object.keys(places).map(function (k) { var p = places[k]; p.geoid = k; return p; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var byName = {};
    list.forEach(function (p) { byName[p.name.toLowerCase()] = p; });
    var q = params(), sel = places[q.get('town')] || null;
    if (sel) sel.geoid = q.get('town');
    var jobs = list.reduce(function (t, p) { return t + p.jobs; }, 0), far = list.reduce(function (t, p) { return t + p.far; }, 0);
    var top = list.slice().sort(function (a, b) { return farShare(b) - farShare(a); }).slice(0, 12);
    var rows = list.map(function (p) {
      return { geoid: p.geoid, name: bare(p.name), jobs: p.jobs, inShare: p.jobs ? Math.round(100 * p.in_commuters / p.jobs) : null, far: p.far, farShare: p.jobs ? Math.round(100 * p.far / p.jobs) : null, farLow: p.far_low, miles: p.median_far_miles, cost: p.median_far_miles ? Math.round(2 * p.median_far_miles * WORKDAYS * IRS_RATE / 10) * 10 : null, out: p.residents ? Math.round(100 * p.out_commuters / p.residents) : null };
    });
    return head({
      answer: 'Where a town’s workers live tells you whether its housing fits its jobs. Pick a town to see how many of its jobs are held by people who drive in, how far, and what the drive costs them.',
      meta: '<span class="scope-tag">Scope: Colorado towns with 200 or more jobs</span> LEHD LODES ' + esc(meta.lodes_year) + ', primary jobs, home block to work block.',
      facts: [
        { value: num(list.length), label: 'Towns with 200 or more primary jobs', source: 'LEHD LODES ' + meta.lodes_year, href: meta.source },
        { value: num(far), label: 'Jobs in those towns held by people driving 20 to 60 miles in, of ' + num(jobs), source: 'LEHD LODES ' + meta.lodes_year, href: meta.source },
        { value: cost(25), label: 'A year to drive 25 miles each way, 240 days, at the IRS rate', source: 'IRS rate via Journal of Accountancy, July 2026', href: IRS_URL },
        { value: num((d.employers.areas || []).length), label: 'Areas with a largest-employer table from audit filings', source: 'Office of the State Auditor filings', href: d.employers.meta.library }
      ]
    }) +
      T.onThisPage([{ id: 'cj-town', title: 'Who drives in to work' }, { id: 'cj-employers', title: 'Largest employers' }, { id: 'cj-why', title: 'Why it matters for housing' }, { id: 'cj-tools', title: 'Run it yourself' }, { id: 'cj-about', title: 'About this data' }], true) +
      '<section id="cj-town" tabindex="-1"><h2>Who drives in to work</h2>' +
      picker('town', 'Find a town', [['', 'Pick one of ' + list.length + ' towns']].concat(list.map(function (p) { return [p.geoid, bare(p.name) + (p.name !== bare(p.name) ? ' ' + p.name.slice(bare(p.name).length).trim() : '')]; })), sel ? sel.geoid : '') +
      (sel ? detail(sel, q.get('dir')) : '<p class="chapter-finding">Pick a town, or select one on the map. ' + num(list.length) + ' towns with 200 or more jobs are shown.</p>') +
      map(d, list, byName, sel) +
      sourceLine(meta) +
      UI.bars('Towns where the most jobs are held by 20 to 60 mile commuters', 'Share of each town’s primary jobs; the 12 highest', top.map(function (p) { return [bare(p.name), Math.round(1000 * farShare(p)) / 10]; }), function (v) { return v.toFixed(1) + '%'; }) +
      sourceLine(meta) +
      UI.table('cj', 'Every town', [
        { key: 'name', label: 'Town', href: function (r) { return townHref(r.geoid); } },
        { key: 'jobs', label: 'Jobs', num: true, fmt: num, tip: 'Primary jobs in town (LODES JT01), so each worker counts once' },
        { key: 'inShare', label: 'Held by in-commuters', num: true, fmt: function (v) { return v + '%'; }, tip: 'Share of the town’s jobs held by people who live somewhere else' },
        { key: 'far', label: '20–60 mile commuters', num: true, fmt: num, tip: 'Jobs held by people who live 20 to 60 straight-line miles away' },
        { key: 'farShare', label: 'Share driving 20–60 mi', num: true, fmt: function (v) { return v + '%'; } },
        { key: 'farLow', label: 'Of them lower-paid', num: true, fmt: num, tip: '$3,333 a month or less, LODES’s lower two pay bands' },
        { key: 'miles', label: 'Typical miles', num: true, tip: 'Median one-way straight-line miles for the 20 to 60 mile commuters' },
        { key: 'cost', label: 'Yearly drive cost', num: true, fmt: UI.money, tip: 'Typical miles, both ways, 240 days, at the IRS rate of 76 cents a mile' },
        { key: 'out', label: 'Residents working elsewhere', num: true, fmt: function (v) { return v + '%'; }, tip: 'Share of working residents whose job is in another town, in Colorado or another state' }
      ], rows, { noun: 'towns', placeholder: 'Town name' }) + sourceLine(meta) + '</section>' +
      employers(d.employers, q.get('area')) +
      '<section id="cj-why" tabindex="-1"><h2>Why it matters for housing</h2><ul class="opp-points">' +
      '<li><strong>The drive costs real money.</strong> At the IRS rate of 76 cents a mile (from 1 July 2026, IRS Announcement 2026-11, <a href="' + IRS_URL + '">reported by the Journal of Accountancy</a>), a 25-mile commute driven 240 days a year is ' + cost(25) + '. That rate covers the full cost of a car, so it is the high end.</li>' +
      '<li><strong>Long drives push workers to other jobs.</strong> In one urban school district, each 5 more minutes of commute raised a teacher’s chance of moving schools by about 1 point, and 40-minute commuters were more likely to leave (<a href="https://doi.org/10.1177/23328584241287792">Santelli and Grissom, AERA Open, October 2024</a>).</li>' +
      '<li><strong>Many would move closer.</strong> 61% of Summit County in-commuters would make a trade-off to live in the county (<a href="https://www.friscogov.com/wp-content/uploads/2026/04/Attachment-1_2023-Summit-County-Housing-Needs-Assessment.pdf">Summit County Housing Needs Assessment, September 2023</a>, p. 59), and 70% of Eagle County in-commuters said they would prefer to live there (<a href="https://web.archive.org/web/20230126180915/https://files.vailvalleypartnership.com/sites/2/2016/07/2016-Housing-Needs-Assessment-upated_FINAL.pdf">Eagle County update, June 2016</a>, citing the 2007 survey).</li>' +
      '<li><strong>New homes do fill with them.</strong> For Smith Ranch Apartments in Silverthorne, managers at six tax-credit and mixed-income properties reported 10% to 50% of tenants from outside Summit County (<a href="https://www.chfainfo.com/getattachment/4a09630b-e9f1-4117-8e2d-18628f014462/2022-round2-narratives.pdf">CHFA 2022 Round Two application narratives</a>). CHFA counts that kind of move as demand only when comparable properties document it.</li>' +
      '</ul></section>' +
      '<section id="cj-tools" tabindex="-1"><h2>Run it yourself with Census tools</h2><ul class="opp-points">' +
      '<li><a href="https://onthemap.ces.census.gov/">OnTheMap</a>: draw any area and see where its workers live and where its residents work.</li>' +
      '<li><a href="https://ledextract.ces.census.gov/">LED Extraction Tool</a>: download the same commute and job counts for counties and towns.</li>' +
      '<li><a href="https://qwiexplorer.ces.census.gov/">QWI Explorer</a>: hiring, turnover and earnings by county and industry, every quarter.</li>' +
      '<li><a href="https://j2jexplorer.ces.census.gov/">Job-to-Job Explorer</a>: how many workers change jobs, and between which states and metros.</li>' +
      '</ul></section>' +
      '<section id="cj-about" tabindex="-1"><h2>About this data</h2>' +
      '<p>Commute counts are from the Census Bureau’s LEHD LODES ' + esc(meta.lodes_year) + ' origin-destination file (primary jobs, so each worker counts once), home block to work block, matched to towns with the <a href="' + esc(meta.crosswalk) + '">LEHD crosswalk</a>. It counts Colorado jobs held by people who live in another state, and Colorado residents whose job is in another state, naming each home or job by its county. LODES lags two to three years.</p>' +
      '<p>Distances are straight lines between blocks. Roads are longer, so every cost on this page is a floor. LODES places some workers at an employer’s main office, so trips recorded at 60 miles or more include people who do not drive that far every day. The page counts them apart and never costs them.</p>' +
      '<p>Travel times are the Census Bureau’s American Community Survey: how long people say the trip to work takes, one way, by any means, for people who work in a town (table B08603) and people who live in it (table B08303). They cover every job, not only the primary jobs LODES counts, so the two sets of numbers do not add up to each other. Drive minutes and road miles for each home town are routed over OpenStreetMap with no traffic, from a Colorado town’s Census point (a county’s 2020 centre of population for homes in another state) to where the town’s jobs are.</p>' +
      '<p>Lower-paid means $3,333 a month or less, LODES’s lower two pay bands. Towns with fewer than ' + num(meta.min_jobs) + ' primary jobs are left out.</p>' +
      '<p>Employer tables are copied from the “Principal Employers” schedules that counties, cities and school districts print in their annual comprehensive financial reports, filed with the <a href="' + esc(d.employers.meta.library) + '">Office of the State Auditor</a>. Most filings do not include the schedule, so ' + num((d.employers.areas || []).length) + ' areas are covered so far.</p>' +
      '<p>The market study’s capture stack adds a second line, capture with relocation. It grows the county renter pool only by the share of tenants from outside the county documented at a comparable Colorado property, uses the low end of that range, and caps the added households at the county’s lower-paid workers who drive 20 to 60 miles in. CHFA allows in-migration only when comparable projects show it, so a county with no such comparable gets no relocation number. Comparables measured from outside a project’s market area are listed but not applied, because a market area is smaller than a county. The comparables are in <a href="https://cohoanalytics.com/data/market/relocation-comparables.json">relocation-comparables.json</a>, each with its quote and page.</p>' +
      '<p class="note">A public-data reference. Check a figure against its source before relying on it.</p></section>' +
      T.source('U.S. Census Bureau, LEHD LODES ' + meta.lodes_year + ' origin-destination file', meta.source, 'built ' + meta.generated) +
      T.source('Principal employers from local government audit filings', d.employers.meta.library, 'checked ' + d.employers.meta.as_of) +
      T.next('Next', [{ href: '#/market', label: 'Check a market →' }, { href: '#/guide/commuters-capture', label: 'Commuters and capture rates', secondary: true }, { href: '#/places', label: 'Find a place', secondary: true }, { href: '#/opportunities', label: 'Back to Opportunities', secondary: true }]);
  }

  global.LabCommuting = { view: view, balanceCard: balanceCard, FILES: FILES, TIME_FILES: TIME_FILES, RUN_RATE: RUN_RATE, MIN_WAGE: MIN_WAGE, MIN_YEAR: MIN_YEAR, DAILY_MAX_MIN: DAILY_MAX_MIN, yearCost: yearCost, answer: answer, cost: cost, binFor: binFor, BINS: BINS, IRS_RATE: IRS_RATE, WORKDAYS: WORKDAYS };
})(window);
