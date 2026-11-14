// Suggested market area round a site, and how capture moves as tracts go in or out (paul, 14 Nov 2026: "pick a site,
// then suggests the tracts that should be in and why and gives an interactive map that displays how capture rates
// change with tract inclusion").
//
// On the Market check, once a site is placed, COHO suggests whole census tracts for the market area and says why
// for each one, in plain words. The rules are written out on the page and below; each is a screening judgment, not a
// CHFA rule. A CHFA-approved analyst draws the real primary market area.
//   1. The tract the site is in.
//   2. Tracts whose centre is within 4 miles of the site (the full Market Analysis pre-selects the same 4 miles;
//      js/pma-tract-picker.js AUTOSELECT_RADIUS_MI). Where 25 or more tract centres sit within 3 miles (a city),
//      2 miles instead.
//   3. Farther tracts, out to 12 miles (6 in a city), where at least a quarter of the people who live there, and at
//      least 50 of them, work in the tracts of rules 1 and 2 (LODES 2024 home-to-work flows,
//      data/market/lodes_tract_od_co.json, the same file the full Market Analysis's commute-shaped option reads).
//   4. A tract across an interstate, a river or a named lake from the site is suggested out, unless rule 3's jobs
//      tie holds for it. The crossing test is the public site's own (PMABarriers.proposeTractExclusions,
//      js/pma-barriers.js, on data/market/natural_barriers_co.geojson).
//   5. If that leaves fewer than 3 tracts, the next-nearest tracts in the site's county are added up to 3, so a small
//      town's area is more than the town.
// The map shows every candidate tract. A tap shows what adding or dropping that tract does to the capture rate and
// to penetration, and a button makes the change. A chart shows capture as tracts are added in the suggested order.
// Every count comes from the public site's engines: renters who qualify from PMAMarketScoring.chfaQualifiedRenters
// (js/market-analysis-scoring.js, as on the Market check and the full Market Analysis), existing tax credit homes
// from PMAAffordableSupply.summarizeAffordableSupply (js/market-analysis-supply.js) on data/market/hud_lihtc_co.geojson.
// Tract shapes: data/market/pma_tract_display_geometry.geojson. Nothing leaves the browser.
//
// The edited tract list rides in the address (tr=, tract numbers without the leading 08), so a link keeps it.
(function (global) {
  'use strict';

  var doc = global.document;
  var VENDOR = function () { return global.LAB_VENDOR; };
  var FILES = {
    cent: 'data/market/tract_centroids_co.json',
    geom: 'data/market/pma_tract_display_geometry.geojson',
    od: 'data/market/lodes_tract_od_co.json',
    barriers: 'data/market/natural_barriers_co.geojson',
    lihtc: 'data/market/hud_lihtc_co.geojson',
    places: 'data/market/census2020-place-tract-housing-co.json',
    drive: 'data/market/tract_drive_times_co.json'
  };
  var ENGINES = { barriers: 'js/pma-barriers.js', supply: 'js/market-analysis-supply.js' };
  var RULES = { core: 4, cityCore: 2, cityTest: 3, cityCount: 25, reach: 12, cityReach: 6, tie: 0.25, tieMin: 50, minTracts: 3, maxCandidates: 150, drive: 30, cityDrive: 20, smallDrive: 45 };
  var PEN_TIERS = [20, 30, 40, 45, 50, 55, 60, 70, 80];
  var OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 };
  var SAT = { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics', maxZoom: 19 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'); }
  function p1(x) { return x == null || !isFinite(x) ? '—' : (Math.round(x * 1000) / 10).toFixed(1) + '%'; }
  function mi(x) { return (x < 10 ? (Math.round(x * 10) / 10).toFixed(1) : String(Math.round(x))) + ' miles'; }
  function miles(a, b) {
    var R = 3958.8, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function polys(g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function inGeom(lon, lat, g) {
    return polys(g).some(function (p) { return p.length && inRing(lon, lat, p[0]) && !p.slice(1).some(function (h) { return inRing(lon, lat, h); }); });
  }
  // "Census Tract 14.02" → "Tract 14.02"
  function tractName(t) { return String(t.tract_name || ('Tract ' + String(t.geoid).slice(5))).replace(/^Census\s+/, ''); }
  var short = function (g) { return String(g).replace(/^08/, ''); };
  var full = function (g) { return /^\d{9}$/.test(g) ? '08' + g : String(g); };

  // ---- the suggestion: a pure function of the site and the files, so a test can run it without a page ----
  // o: { site: {lat, lon}, cent, siteGeoid, od (or null), barrierFeatures (or null), B (PMABarriers or null) }
  function suggest(o) {
    var site = o.site, cent = o.cent || {};
    var rows = (cent.tracts || []).filter(function (t) { return t.lat != null && t.lon != null; })
      .map(function (t) { return { t: t, geoid: String(t.geoid), miles: miles(site, t) }; })
      .sort(function (a, b) { return a.miles - b.miles; });
    var city = rows.filter(function (r) { return r.miles <= RULES.cityTest; }).length >= RULES.cityCount;
    var coreMiles = city ? RULES.cityCore : RULES.core, reach = city ? RULES.cityReach : RULES.reach;
    var cands = rows.filter(function (r) { return r.miles <= reach; }).slice(0, RULES.maxCandidates);
    var siteGeoid = o.siteGeoid || (rows[0] && rows[0].geoid);
    if (siteGeoid && !cands.some(function (r) { return r.geoid === siteGeoid; })) {
      var sr = rows.filter(function (r) { return r.geoid === siteGeoid; })[0];
      if (sr) cands.unshift(sr);
    }
    var core = {};
    cands.forEach(function (r) { if (r.miles <= coreMiles || r.geoid === siteGeoid) core[r.geoid] = true; });

    // Rule 3: of the people who live in a tract and work, the share whose job is in the core tracts.
    var tie = null;
    if (o.od && Array.isArray(o.od.pairs)) {
      var want = {}; cands.forEach(function (r) { want[r.geoid] = true; });
      var to = {}, out = {};
      o.od.pairs.forEach(function (p) {
        var h = p[0], j = +p[2] || 0;
        if (!want[h] || j <= 0) return;
        out[h] = (out[h] || 0) + j;
        if (core[p[1]]) to[h] = (to[h] || 0) + j;
      });
      tie = {}; cands.forEach(function (r) { tie[r.geoid] = { workers: out[r.geoid] || 0, toCore: to[r.geoid] || 0, share: out[r.geoid] ? (to[r.geoid] || 0) / out[r.geoid] : 0 }; });
    }
    // Rule 4: the public site's crossing test, run on every candidate but the site's own tract.
    var across = null;
    if (o.B && o.B.proposeTractExclusions && o.barrierFeatures) {
      var res = o.B.proposeTractExclusions(site.lat, site.lon, cands.map(function (r) { return { geoid: r.geoid, lat: r.t.lat, lon: r.t.lon }; }), o.barrierFeatures, siteGeoid);
      if (res && (res.status === 'proposed' || res.status === 'no_features')) {
        across = {}; (res.exclusions || []).forEach(function (e) { across[e.geoid] = e.feature; });
      }
    }
    // Drive minutes from each tract's 2020 population centre to the one nearest the site (OpenStreetMap,
    // data/market/tract_drive_times_co.json). Nearest the site, not the site tract's own: a big rural tract's people
    // can live miles from a site at its edge. A range or a long way round shows as a long drive even when near on the map.
    var mins = null, maxDrive = city ? RULES.cityDrive : RULES.drive, anchor = null;
    if (o.drive && o.drive.from && Array.isArray(o.drive.tracts) && siteGeoid) {
      var si = o.drive.tracts.indexOf(siteGeoid);
      if (Array.isArray(o.drive.points) && o.drive.points.length === o.drive.tracts.length) {
        var best = Infinity;
        o.drive.points.forEach(function (p, k) { var m = miles(o.site, { lat: p[0], lon: p[1] }); if (m < best) { best = m; si = k; } });
      }
      anchor = o.drive.tracts[si] || null;
      mins = {};
      cands.forEach(function (r) {
        if (r.geoid === anchor) { mins[r.geoid] = 0; return; }
        var row = o.drive.from[r.geoid] || [];
        for (var k = 0; k < row.length; k++) if (row[k][0] === si) { mins[r.geoid] = row[k][1]; return; }
        mins[r.geoid] = null;
      });
    }
    var driveOf = function (g) { return mins ? mins[g] : undefined; };
    // A pair not on file (centres more than 15 miles apart, or no route) is unknown, not long: a big rural site tract's centre can be far from the site.
    var longDrive = function (g) { var m = driveOf(g); return m != null && m > maxDrive; };
    var driveWords = function (g) { var m = driveOf(g); return m === undefined ? '' : m == null ? 'no drive time on file' : Math.round(m) + ' minutes\u2019 drive'; };
    var coreWords = 'within ' + coreMiles + ' miles of the site';
    var tied = function (g) { return tie && tie[g] && tie[g].share >= RULES.tie && tie[g].toCore >= RULES.tieMin; };
    var tieWords = function (g) {
      var x = tie && tie[g];
      return x && x.workers ? Math.round(x.share * 100) + '% of the people who live here and work have a job ' + coreWords + ' (' + num(x.toCore) + ' of ' + num(x.workers) + ')' : null;
    };
    var list = cands.map(function (r) {
      var g = r.geoid, x = across && across[g], d = mi(r.miles) + (mins && g !== siteGeoid ? ' (' + driveWords(g) + ')' : ''), it = { drive: driveOf(g) === undefined ? null : driveOf(g), geoid: g, name: tractName(r.t), county: r.t.county_name ? r.t.county_name + ' County' : '', countyFips: String(r.t.county_fips || g.slice(0, 5)), miles: r.miles, lat: r.t.lat, lon: r.t.lon, across: x || null, tie: tie ? tie[g] : null };
      if (g === siteGeoid) return Object.assign(it, { suggested: true, why: 'site', reason: 'The site is in this tract.' });
      if (core[g]) {
        if (longDrive(g) && !tied(g)) return Object.assign(it, { suggested: false, why: 'drive', reason: d + ' from the site: more than ' + maxDrive + ' minutes by road, so near on the map but not in practice (a range, a river or a long way round).' });
        if (x && !tied(g)) return Object.assign(it, { suggested: false, why: 'across', reason: d + ' from the site, but across ' + x + '. A market area’s edge usually follows a river or an interstate.' });
        if (x) return Object.assign(it, { suggested: true, why: 'tied', reason: d + ' from the site, across ' + x + ', but ' + tieWords(g) + ', so it is tied to the site.' });
        var tw = tieWords(g);
        return Object.assign(it, { suggested: true, why: 'near', reason: d + ' from the site.' + (tw ? ' ' + tw.charAt(0).toUpperCase() + tw.slice(1) + '.' : '') });
      }
      if (tied(g)) return Object.assign(it, { suggested: true, why: 'tied', reason: d + ' from the site, but ' + tieWords(g) + '.' + (x ? ' It is across ' + x + '; the jobs tie outweighs that.' : '') });
      return Object.assign(it, { suggested: false, why: 'far', reason: d + ' from the site' + (tie ? (tieWords(g) ? ', and only ' + tieWords(g) + '.' : ', and no commuting record ties it to the site.') : ', beyond the ' + coreMiles + ' miles round the site.') + (x ? ' It is also across ' + x + '.' : '') });
    });
    // Rule 5: a small town's area is more than the town.
    var siteCounty = siteGeoid ? siteGeoid.slice(0, 5) : null;
    var count = list.filter(function (t) { return t.suggested; }).length;
    // Tracts on the site's side first; if that is still short, the nearest ones across a crossing, said so.
    [false, true].forEach(function (crossing) {
      list.forEach(function (t) {
        if (count >= RULES.minTracts || t.suggested || !!t.across !== crossing || t.countyFips !== siteCounty || (driveOf(t.geoid) != null && driveOf(t.geoid) > RULES.smallDrive)) return;
        t.suggested = true; t.why = 'small';
        t.reason = mi(t.miles) + (mins ? ' (' + driveWords(t.geoid) + ')' : '') + ' from the site. Added so the area is more than the town itself: the next-nearest tract in ' + (t.county || 'the county') + '.' +
          (t.across ? ' It is across ' + t.across + ', but no tract on the site\u2019s side is nearer.' : '');
        count++;
      });
    });
    // The site's tract first, then the other suggested tracts nearest first, then the rest nearest first.
    var rank = function (t) { return t.why === 'site' ? 0 : t.suggested ? 1 : 2; };
    var order = list.slice().sort(function (a, c) { return rank(a) - rank(c) || a.miles - c.miles; }).map(function (t) { return t.geoid; });
    return { city: city, coreMiles: coreMiles, reach: reach, maxDrive: maxDrive, siteGeoid: siteGeoid, tracts: list, order: order, withCommutes: !!tie, withCrossings: !!across, withDrive: !!mins, driveFrom: anchor, rules: RULES };
  }

  // ---- files and engines, fetched once ----
  var cache = {};
  function get(path) {
    if (!cache[path]) {
      cache[path] = fetch(VENDOR() + path).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
      cache[path].catch(function () { delete cache[path]; });
    }
    return cache[path];
  }
  var scripts = {};
  function script(path, name) {
    if (global[name]) return Promise.resolve(global[name]);
    if (!scripts[path]) {
      scripts[path] = new Promise(function (resolve, reject) {
        var s = doc.createElement('script');
        s.src = VENDOR() + path;
        s.onload = function () { global[name] ? resolve(global[name]) : reject(new Error(path)); };
        s.onerror = function () { delete scripts[path]; reject(new Error(path)); };
        doc.body.appendChild(s);
      });
    }
    return scripts[path];
  }
  var leaflet = null;
  function needLeaflet() {
    if (global.L && global.L.map) return Promise.resolve(global.L);
    if (leaflet) return leaflet;
    leaflet = new Promise(function (resolve, reject) {
      if (!doc.querySelector('link[data-ps-leaflet]')) {
        var css = doc.createElement('link');
        css.rel = 'stylesheet'; css.href = VENDOR() + 'js/vendor/leaflet.css'; css.setAttribute('data-ps-leaflet', '');
        doc.head.appendChild(css);
      }
      var js = doc.createElement('script');
      js.src = VENDOR() + 'js/vendor/leaflet.js';
      js.onload = function () { global.L && global.L.map ? resolve(global.L) : reject(new Error('map code')); };
      js.onerror = function () { leaflet = null; reject(new Error('map code')); };
      doc.body.appendChild(js);
    });
    return leaflet;
  }
  function css(name) { return (global.getComputedStyle(doc.documentElement).getPropertyValue(name) || '').trim(); }

  // ---- one builder per site; a page redraw moves the same box (and its map) into the new page ----
  var boxes = {};
  var pending = {};
  function keyOf(site) { return (+site.lat).toFixed(5) + ',' + (+site.lon).toFixed(5); }

  // The page calls this while it draws. ctx: { s (the Market check's place), site, units, tier, edited (tract list or null) }
  function section(ctx) {
    var key = keyOf(ctx.site);
    pending[key] = ctx;
    sync(boxes[key], ctx);
    return '<div class="tc-mount" data-tc="' + esc(key) + '"><p class="note" role="status">Loading the census tracts round the site…</p></div>';
  }

  // The address is the record: the picked area (ta=) and the map edit (tr=) follow it on every draw, before the
  // page reads them for its project form.
  function sync(b, ctx) {
    if (!b) return;
    b.ctx = ctx;
    if (!b.sug) return;
    b.pickId = ctx.ta || null;
    var ed = (ctx.edited || []).filter(function (g) { return b.byId[g]; });
    b.picked = ed.length ? set(ed) : null;
  }
  function mountAll() {
    var spots = doc.querySelectorAll('.tc-mount[data-tc]');
    Array.prototype.forEach.call(spots, function (spot) {
      if (spot.querySelector('.tc-box')) return;
      var key = spot.getAttribute('data-tc'), ctx = pending[key];
      if (!ctx) return;
      var b = boxes[key] || (boxes[key] = make(key));
      sync(b, ctx);
      spot.innerHTML = '';
      spot.appendChild(b.el);
      b.start();
      b.refresh();
      if (b.map) setTimeout(function () { b.map.invalidateSize(); }, 0);
    });
  }

  function make(key) {
    var b = { key: key, el: doc.createElement('div'), ctx: null, data: null, sug: null, picked: null, focus: null, map: null, layers: {}, curve: null, curveFor: null, started: false };
    b.el.className = 'tc-box';
    b.el.innerHTML =
      '<p class="viz-answer tc-answer" aria-live="polite">Loading the census tracts round the site…</p>' +
      '<div class="tc-meters"></div>' +
      '<div class="tc-map-wrap"><div class="tc-map" role="application" aria-label="Map of the census tracts round the site. Tap a tract to see what adding or dropping it does to the capture rate."></div>' +
      '<ul class="tc-key">' +
        '<li><span class="tc-sw tc-sw-in"></span>In the market area</li>' +
        '<li><span class="tc-sw tc-sw-out"></span>Out</li>' +
        '<li><span class="tc-sw tc-sw-across"></span>Suggested out: across a river or interstate, or a long drive</li>' +
        '<li><span class="tc-sw tc-sw-pin"></span>The site</li></ul>' +
      '<p class="note">Darker green tracts hold more renters who qualify for the project. Streets: OpenStreetMap. Satellite: Esri.</p></div>' +
      '<div class="tc-panel" aria-live="polite"><p class="note">Tap a tract on the map, or pick one in the table below, to see what it adds.</p></div>' +
      '<div class="actions tc-actions"><button type="button" class="button-link secondary" data-tc-reset>Back to the suggestion</button>' +
      '<a class="button-link" href="#mk-use" data-tc-use>Use these tracts in a project</a></div>' +
      '<figure class="viz tc-curve"><figcaption><strong>Capture as tracts are added</strong></figcaption><div class="tc-curve-body"><p class="note">Working out the curve…</p></div></figure>' +
      '<section class="tc-compare" aria-labelledby="tc-compare-h"><h3 id="tc-compare-h">Compare market areas, then pick one</h3><div class="tc-compare-body"><p class="note">Working out the comparison\u2026</p></div></section>' +
      '<details class="tc-table"><summary>Every tract and why</summary><div class="tc-table-body"></div></details>' +
      '<div class="tc-how"></div>';
    b.start = function () { if (!b.started) { b.started = true; load(b); } };
    b.refresh = function () { if (b.sug) draw(b); };
    b.el.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-tc-toggle],[data-tc-reset],[data-tc-show],[data-tc-use],[data-tc-usepick]');
      if (!t) return;
      if (t.hasAttribute('data-tc-usepick')) { ev.preventDefault(); if (!t.disabled) useThese(b); return; }
      ev.preventDefault();
      if (t.hasAttribute('data-tc-use')) {
        b.pickId = b.picked ? 'map' : 'suggested';
        save(b);
        // Another area than the recommended one needs a reason first, asked for under the comparison.
        if (needsReason(b.ctx.site)) { drawCompare(b); var w = b.el.querySelector('[data-tc-why]'); if (w) { w.scrollIntoView({ block: 'center' }); w.focus(); } return; }
        useThese(b); return;
      }
      if (t.hasAttribute('data-tc-reset')) { b.picked = null; save(b); b.focus = null; draw(b); return; }
      if (t.hasAttribute('data-tc-show')) { b.focus = t.getAttribute('data-tc-show'); draw(b); if (b.map && b.layers[b.focus]) b.map.fitBounds(b.layers[b.focus].getBounds(), { maxZoom: 13 }); return; }
      toggle(b, t.getAttribute('data-tc-toggle'));
    });
    b.el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.name === 'tc-in') { b.focus = t.value; toggle(b, t.value); }
      if (t && t.name === 'tc-area') { b.pickId = t.value; b.pickWhy = ''; save(b); drawCompare(b); }
    });
    // The reason for picking another area than the recommended one; the button waits for it.
    b.el.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.hasAttribute || !t.hasAttribute('data-tc-why')) return;
      b.pickWhy = t.value;
      var btn = b.el.querySelector('[data-tc-usepick]');
      if (btn) btn.disabled = !t.value.trim();
    });
    return b;
  }

  function load(b) {
    var ctx = b.ctx, say = function (t) { var a = b.el.querySelector('.tc-answer'); if (a) a.textContent = t; };
    var light = Promise.all([get(FILES.cent), get(FILES.geom), get(FILES.lihtc), script(ENGINES.supply, 'PMAAffordableSupply'), get(FILES.places).catch(function () { return null; })]);
    // The commuting and crossing files are large; the suggestion waits for them, and says so if they fail.
    var heavy = Promise.all([
      get(FILES.od).catch(function () { return null; }),
      get(FILES.drive).catch(function () { return null; }),
      Promise.all([get(FILES.barriers), script(ENGINES.barriers, 'PMABarriers')]).catch(function () { return [null, null]; })
    ]);
    light.then(function (a) {
      say('Checking commutes, rivers and interstates round the site…');
      return heavy.then(function (h) {
        var cent = a[0], geom = a[1], lihtc = a[2];
        var shapes = {}; (geom.features || []).forEach(function (f) { shapes[String(f.properties.GEOID)] = f; });
        var site = ctx.site, siteGeoid = null;
        Object.keys(shapes).some(function (g) { if (inGeom(site.lon, site.lat, shapes[g].geometry)) { siteGeoid = g; return true; } return false; });
        var bf = h[2] && h[2][0] ? h[2][0].features : null;
        b.sug = suggest({ site: site, cent: cent, siteGeoid: siteGeoid, od: h[0], drive: h[1], barrierFeatures: bf, B: h[2] ? h[2][1] : null });
        b.byId = {}; b.sug.tracts.forEach(function (t) { b.byId[t.geoid] = t; });
        // Existing tax credit homes, by tract: each property's point falls in one tract shape.
        b.lihtc = {};
        var boxesOf = {};
        Object.keys(shapes).forEach(function (g) {
          var f = shapes[g];
          var x0 = 180, y0 = 90, x1 = -180, y1 = -90;
          polys(f.geometry).forEach(function (p) { p[0].forEach(function (c) { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }); });
          boxesOf[g] = [x0, y0, x1, y1];
        });
        (lihtc.features || []).forEach(function (f) {
          var c = f.geometry && f.geometry.coordinates; if (!c) return;
          var x = +c[0], y = +c[1];
          Object.keys(boxesOf).some(function (g) {
            var bx = boxesOf[g];
            if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3] || !inGeom(x, y, shapes[g].geometry)) return false;
            (b.lihtc[g] = b.lihtc[g] || []).push(f);
            return true;
          });
        });
        // The town that holds most of each tract's homes (2020 Census), for test 3 of the comparison.
        b.places = a[4] && a[4].places ? a[4] : null;
        b.townOf = {};
        if (b.places) Object.keys(b.places.places).forEach(function (pg) {
          var pl = b.places.places[pg];
          (pl.tracts || []).forEach(function (r) {
            var sh = r.tract_housing_units > 0 ? r.housing_units / r.tract_housing_units : 0, cur = b.townOf[r.tract_geoid];
            if (!cur || sh > cur.share) b.townOf[r.tract_geoid] = { geoid: pg, name: String(pl.name || '').replace(/ \((city|town|CDP)\)$/, '').replace(/ CDP \((.+ County)\)$/, ' ($1)'), share: sh };
          });
        });
        b.data = { cent: cent, shapes: shapes, sources: { od: h[0] && h[0].meta, drive: h[1] && h[1].meta, barriers: h[2] && h[2][0] && h[2][0].meta, cent: cent.meta, places: b.places && b.places.meta } };
        b.pickId = ctx.ta || null;
        b.single = {};
        b.picked = (ctx.edited && ctx.edited.length) ? set(ctx.edited.filter(function (g) { return b.byId[g]; })) : null;
        draw(b);
        drawMap(b);
        // The project form below was drawn before the tracts were worked out; draw the page again (the box and its
        // map move into the new page).
        if (global.LabShell && global.LabShell.render && doc.contains(b.el)) global.LabShell.render();
      });
    }).catch(function (e) {
      say('The census tract files did not load (' + (e && e.message ? e.message : 'unknown error') + '). Try again in a moment, or use the radius choices below.');
    });
  }

  function set(list) { var o = {}; (list || []).forEach(function (g) { o[g] = true; }); return o; }
  function chosen(b) {
    if (b.picked) return b.sug.order.filter(function (g) { return b.picked[g]; });
    return b.sug.order.filter(function (g) { return b.byId[g].suggested; });
  }
  function isIn(b, g) { return b.picked ? !!b.picked[g] : !!(b.byId[g] && b.byId[g].suggested); }
  function toggle(b, g) {
    if (!b.byId[g]) return;
    if (!b.picked) b.picked = set(chosen(b));
    if (b.picked[g]) delete b.picked[g]; else b.picked[g] = true;
    // The same set as the suggestion is the suggestion again.
    var now = chosen(b), sug = b.sug.order.filter(function (x) { return b.byId[x].suggested; });
    if (now.length === sug.length && now.every(function (x, i) { return x === sug[i]; })) b.picked = null;
    b.focus = g;
    if (b.pickId && b.pickId !== 'map') b.pickId = null;
    save(b);
    draw(b);
  }
  // The edited list goes in the address without a redraw of the page (the map stays where it is).
  function save(b) {
    var h = location.hash, i = h.indexOf('?'), q = new URLSearchParams(i > -1 ? h.slice(i + 1) : '');
    if (b.picked) q.set('tr', chosen(b).map(short).join('.')); else q.delete('tr');
    if (b.pickId) q.set('ta', b.pickId); else q.delete('ta');
    history.replaceState(null, '', (i > -1 ? h.slice(0, i) : h) + '?' + q.toString());
    var c = doc.querySelector('[data-tc-count]'), pa = b.pickId && areaById(b, b.pickId);
    if (c) c.textContent = String(pa ? pa.list.length : chosen(b).length);
  }
  function useThese(b) {
    var h = location.hash, i = h.indexOf('?'), q = new URLSearchParams(i > -1 ? h.slice(i + 1) : '');
    q.set('r', 't'); q.set('at', 'mk-use');
    if (b.picked) q.set('tr', chosen(b).map(short).join('.'));
    if (b.pickId) q.set('ta', b.pickId); else q.delete('ta');
    history.replaceState(null, '', (i > -1 ? h.slice(0, i) : h) + '?' + q.toString());
    if (global.LabShell && global.LabShell.render) global.LabShell.render();
    setTimeout(function () { var t = doc.getElementById('mk-use'); if (t) t.scrollIntoView(); }, 0);
  }

  // ---- the counts: the public site's engines on the chosen tracts ----
  function engineOpts(x) {
    if (x._tcOpts) return x._tcOpts;
    var idx = {}; ((x.acs && x.acs.tracts) || []).forEach(function (m) { idx[m.geoid] = m; });
    x._tcOpts = { acsIdx: Object.keys(idx).length ? idx : null, sizeIdx: x.sizes && x.sizes.tracts ? x.sizes.tracts : null };
    return x._tcOpts;
  }
  function limitsOf(s) {
    if (s.d._tcLimits) return s.d._tcLimits;
    var l = {}; ((s.d.chfa && s.d.chfa.counties) || []).forEach(function (c) { l[c.fips] = c; });
    return (s.d._tcLimits = l);
  }
  function measure(b, list) {
    var E = global.PMAMarketScoring, S = global.PMAAffordableSupply, s = b.ctx.s;
    if (!E || !E.chfaQualifiedRenters || !list.length) return null;
    var tr = list.map(function (g) { return { geoid: g }; }), lim = limitsOf(s), o = engineOpts(s.x);
    var q = E.chfaQualifiedRenters(s.x.demand, lim, tr, [b.ctx.tier], undefined, o);
    var pool = E.chfaQualifiedRenters(s.x.demand, lim, tr, PEN_TIERS, undefined, o);
    var feats = []; list.forEach(function (g) { if (b.lihtc[g]) feats = feats.concat(b.lihtc[g]); });
    var sup = S ? S.summarizeAffordableSupply(feats, []) : { lihtcUnits: null, lihtcCount: feats.length };
    var existing = sup.lihtcUnits || 0, units = b.ctx.units;
    return { qualified: q.value, pool: pool.value, existing: existing, projects: sup.lihtcCount || 0,
      capture: q.value > 0 ? units / q.value : null, pen: pool.value > 0 ? (existing + units) / pool.value : null, reason: q.reason };
  }
  function single(b, g) {
    var k = g + '|' + b.ctx.tier;
    if (!(k in b.single)) { var m = measure(b, [g]); b.single[k] = m ? m.qualified : null; }
    return b.single[k];
  }

  // ---- compare market areas, recommend one, let the reader pick (paul, 14 Nov 2026: "compare several market areas
  // ... include their capture rates for each ami and allow the user to pick"; "the comparison should justify why one
  // is recommended") ----
  // The areas: the town's own tracts, the suggestion, the suggestion plus the next ring, the commute-shed, the whole
  // county, and the reader's own map edit. Each is held to four tests; the smallest area that passes all four is
  // recommended. The thresholds marked COHO are screening judgments, not CHFA rules.
  var CAP_TIERS = [30, 40, 50, 60, 70, 80];
  var TEST = { townShare: 0.10, shedTie: 0.10, otherTown: 0.5, room: 0.75 };
  var MSG = 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf';
  function sorted(list) { var o = {}; list.forEach(function (g) { o[g] = true; }); return Object.keys(o).sort(); }
  function siteTown(b) {
    var g = b.ctx.s && b.ctx.s.entry ? String(b.ctx.s.entry.geoid || '') : '';
    if (/^\d{7}$/.test(g) && b.places && b.places.places[g]) return { geoid: g, name: String(b.places.places[g].name || '').replace(/ \((city|town|CDP)\)$/, ''), rec: b.places.places[g] };
    return null;
  }
  function areasFor(b) {
    var key = (b.picked ? chosen(b).join('.') : '') + '|' + b.ctx.units + '|' + b.ctx.tier;
    if (b.areas && b.areasKey === key) return b.areas;
    var sug = b.sug, out = [], seen = {}, core = sug.coreMiles;
    var add = function (id, label, note, list, method) {
      list = sorted(list);
      if (!list.length) return;
      var k = list.join('.');
      if (seen[k]) { seen[k].alias.push(label); seen[k].ids.push(id); return; }
      var a = { id: id, ids: [id], label: label, note: note, list: list, method: method, alias: [] };
      seen[k] = a; out.push(a);
    };
    var town = siteTown(b);
    if (town) add('town', 'Town’s own tracts', 'Tracts holding at least 10% of ' + town.name + '’s homes (2020 Census).',
      (town.rec.tracts || []).filter(function (r) { return town.rec.housing_units > 0 && r.housing_units / town.rec.housing_units >= TEST.townShare; }).map(function (r) { return r.tract_geoid; }), 'town-tracts');
    var inSug = sug.tracts.filter(function (t) { return t.suggested; }).map(function (t) { return t.geoid; });
    add('suggested', 'Suggested tracts', 'COHO’s suggestion: each tract’s reason is in the table below.', inSug, 'suggested-tracts');
    add('ring', 'Suggested plus the next ring', 'Adds every tract whose centre is within ' + (core * 2) + ' miles of the site.',
      inSug.concat(sug.tracts.filter(function (t) { return t.miles <= core * 2; }).map(function (t) { return t.geoid; })), 'suggested-plus-ring');
    if (sug.withCommutes) add('shed', 'Commute-shed', 'Adds every tract within ' + sug.reach + ' miles where at least 10% of working residents (and 50 or more) have a job within ' + core + ' miles of the site (LODES 2024).',
      inSug.concat(sug.tracts.filter(function (t) { return t.tie && t.tie.share >= TEST.shedTie && t.tie.toCore >= 50; }).map(function (t) { return t.geoid; })), 'commute-shed');
    var cf = sug.siteGeoid ? sug.siteGeoid.slice(0, 5) : null, cName = (sug.tracts.filter(function (t) { return t.geoid === sug.siteGeoid; })[0] || {}).county || 'the county';
    if (cf) add('county', 'Whole county', 'Every tract in ' + cName + '.', Object.keys(b.ctx.s.x.demand.tracts || {}).filter(function (g) { return g.slice(0, 5) === cf; }), 'county');
    if (b.picked) add('map', 'Your area on the map', 'The tracts as you set them on the map above.', chosen(b), 'suggested-tracts-edited');
    out.forEach(function (a) { a.eval = evaluate(b, a, town); });
    recommend(out);
    b.areas = out; b.areasKey = key;
    return out;
  }
  function areaById(b, id) { return (b.areas || areasFor(b)).filter(function (x) { return x.ids.indexOf(id) > -1; })[0] || null; }
  // What is picked: the reader's choice; else the map's tracts once edited; else the recommended area.
  function effectivePick(b) {
    if (b.pickId && areaById(b, b.pickId)) return areaById(b, b.pickId);
    if (b.picked) return areaById(b, 'map');
    return (b.areas || areasFor(b)).filter(function (x) { return x.recommended; })[0] || areaById(b, 'suggested');
  }

  function evaluate(b, area, town) {
    var E = global.PMAMarketScoring, S = global.PMAAffordableSupply, s = b.ctx.s, units = b.ctx.units;
    var tr = area.list.map(function (g) { return { geoid: g }; }), lim = limitsOf(s), o = engineOpts(s.x);
    var byTier = {};
    CAP_TIERS.forEach(function (t) { var q = E.chfaQualifiedRenters(s.x.demand, lim, tr, [t], undefined, o).value; byTier[t] = { qualified: q, capture: q > 0 ? units / q : null }; });
    var pool = E.chfaQualifiedRenters(s.x.demand, lim, tr, PEN_TIERS, undefined, o).value;
    var feats = []; area.list.forEach(function (g) { if (b.lihtc[g]) feats = feats.concat(b.lihtc[g]); });
    var sup = S ? S.summarizeAffordableSupply(feats, []) : { lihtcUnits: 0, lihtcCount: feats.length };
    var existing = sup.lihtcUnits || 0, pen = pool > 0 ? (existing + units) / pool : null;
    // Test 2: every tract is near the site on its side, or tied to it by jobs.
    var loose = area.list.filter(function (g) {
      var t = b.byId[g];
      if (!t) return true;
      if (t.why === 'site' || t.why === 'near' || t.why === 'tied' || t.why === 'small') return false;
      return !(t.tie && t.tie.share >= TEST.shedTie && t.tie.toCore >= 50);
    });
    var farOut = loose.filter(function (g) { return !b.byId[g]; }).length, across = loose.filter(function (g) { return b.byId[g] && b.byId[g].across; }).length;
    var longD = b.sug.withDrive ? loose.filter(function (g) { var t = b.byId[g]; return t && t.drive != null && t.drive > b.sug.maxDrive; }).length : 0;
    // Test 3: no tract where another town holds most homes and has tax credit homes of its own.
    var others = {};
    area.list.forEach(function (g) {
      var tw = b.townOf[g];
      if (!tw || tw.share < TEST.otherTown || (town && tw.geoid === town.geoid) || !b.lihtc[g]) return;
      (others[tw.name] = others[tw.name] || []).push.apply(others[tw.name], b.lihtc[g]);
    });
    var otherNames = Object.keys(others).sort(function (x, y) { return others[y].length - others[x].length; });
    var tier = b.ctx.tier, cap = byTier[tier] ? byTier[tier].capture : null;
    var line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85;
    var tests = [
      { id: 'whole', pass: true, text: 'Whole census tracts, as CHFA’s Market Study Guide asks; no radius.' },
      { id: 'origin', pass: !loose.length, text: !loose.length
        ? 'Tenants could come from every tract: each is within ' + b.sug.coreMiles + ' miles' + (b.sug.withDrive ? ' and ' + b.sug.maxDrive + ' minutes’ drive' : '') + ' on the site’s side, tied to it by jobs, or one of the nearest tracts in a small town’s county.'
        : loose.length + ' of ' + area.list.length + ' tracts have little tie to the site' + (farOut || across || longD ? ' (' + [farOut ? farOut + ' beyond ' + b.sug.reach + ' miles' : '', longD ? longD + ' more than ' + b.sug.maxDrive + ' minutes’ drive' : '', across ? across + ' across a river or interstate' : ''].filter(Boolean).join(', ') + ')' : '') + ': under 10% of their working residents have a job near it.' },
      { id: 'town', pass: !otherNames.length, text: !otherNames.length
        ? 'Takes in no other town’s tax credit market.'
        : 'Takes in the tax credit market of ' + otherNames.slice(0, 3).map(function (n) { return n + ' (' + others[n].length + (others[n].length === 1 ? ' property)' : ' properties)'); }).join(', ') + (otherNames.length > 3 ? ' and ' + (otherNames.length - 3) + ' more' : '') + '.' },
      { id: 'capture', pass: cap != null && cap <= TEST.room && pen != null && pen <= TEST.room, text: cap == null
        ? 'No renter here qualifies for a ' + tier + '% AMI home, so there is no capture rate.'
        : (cap <= TEST.room && pen <= TEST.room ? 'Capture at ' + tier + '% AMI is ' + p1(cap) + ' and penetration ' + p1(pen) + ', both at least 10 points under CHFA’s 85% line.'
          : (cap > line || pen > line ? 'Over CHFA’s 85% line: ' : 'Within 10 points of CHFA’s 85% line: ') + 'capture at ' + tier + '% AMI ' + p1(cap) + ', penetration ' + p1(pen) + '.') }
    ];
    return { byTier: byTier, pool: pool, existing: existing, projects: sup.lihtcCount || 0, pen: pen, tests: tests, passes: tests.filter(function (t) { return t.pass; }).length };
  }
  // The smallest area that passes all four; if none does, the one that passes most, then the smallest.
  function recommend(list) {
    list.forEach(function (x) { x.recommended = false; });
    var pool = list.filter(function (x) { return x.id !== 'map'; });
    var best = pool.slice().sort(function (x, y) { return (y.eval.passes === 4) - (x.eval.passes === 4) || y.eval.passes - x.eval.passes || x.list.length - y.list.length; })[0];
    if (!best) return null;
    best.recommended = true;
    list.forEach(function (x) {
      if (x === best) { x.line = null; return; }
      var fail = x.eval.tests.filter(function (t) { return !t.pass; })[0];
      x.line = fail ? fail.text : 'Passes all four tests, but holds ' + x.list.length + ' tracts against ' + best.list.length + ', so it counts renters from farther away than it needs to.';
    });
    return best;
  }

  function drawCompare(b) {
    var host = b.el.querySelector('.tc-compare-body');
    var list = areasFor(b), rec = list.filter(function (x) { return x.recommended; })[0], tier = b.ctx.tier;
    var E = global.PMAMarketScoring, line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85;
    var pa0 = effectivePick(b), pick = pa0 ? pa0.id : null;
    var cell = function (v, isTier) {
      if (v == null) return '<td class="num" data-label="">—</td>';
      return '<td class="num' + (isTier ? ' tc-tier' : '') + (v > line ? ' tc-over' : '') + '">' + p1(v) + (v > line ? ' <span class="tc-flag">over</span>' : '') + '</td>';
    };
    var rows = list.map(function (x) {
      var ev = x.eval;
      return '<tr' + (x.recommended ? ' class="tc-rec"' : '') + '><th scope="row"><label class="tc-check"><input type="radio" name="tc-area" value="' + esc(x.id) + '"' + (x.id === pick ? ' checked' : '') + '> ' + esc(x.label) + '</label>' +
        (x.recommended ? ' <span class="tc-badge">Recommended</span>' : '') + '<span class="note tc-sub">' + x.list.length + (x.list.length === 1 ? ' tract. ' : ' tracts. ') + esc(x.note) + (x.alias.length ? ' Same tracts as: ' + esc(x.alias.join(', ')) + '.' : '') + '</span></th>' +
        CAP_TIERS.map(function (t) { return cell(ev.byTier[t].capture, t === tier).replace('<td class="num', '<td data-label="' + t + '% AMI" class="num'); }).join('') +
        cell(ev.pen, false).replace('<td class="num', '<td data-label="Penetration" class="num') +
        '<td data-label="Tests" class="tc-tests">' + ev.tests.map(function (t) { return '<span class="' + (t.pass ? 'tc-pass' : 'tc-fail') + '" title="' + esc(t.text) + '">' + (t.pass ? '✓' : '✗') + ' ' + ({ whole: 'Whole tracts', origin: 'Tenants could come from here', town: 'No other town’s market', capture: 'Room under the line' })[t.id] + '</span>'; }).join('') + '</td></tr>';
    }).join('');
    var why = rec ? '<div class="tc-why"><p><strong>Recommended: ' + esc(rec.label) + ' (' + rec.list.length + (rec.list.length === 1 ? ' tract' : ' tracts') + ').</strong> ' +
      (rec.eval.passes === 4 ? 'It is the smallest area that passes all four tests.' : 'No area passes all four tests; this one passes ' + rec.eval.passes + ', the most, and is the smallest that does.') + '</p>' +
      '<ol class="tc-tests-list">' + rec.eval.tests.map(function (t) { return '<li class="' + (t.pass ? 'tc-pass' : 'tc-fail') + '">' + (t.pass ? 'Passes. ' : 'Fails. ') + esc(t.text) + '</li>'; }).join('') + '</ol>' +
      '<p><strong>The other areas:</strong></p><ul>' + list.filter(function (x) { return !x.recommended; }).map(function (x) { return '<li><strong>' + esc(x.label) + ':</strong> ' + esc(x.line) + '</li>'; }).join('') + '</ul></div>' : '';
    var diff = rec && pick && pick !== rec.id;
    var form = '<div class="tc-pickform"><p class="tc-picked" aria-live="polite">' + (pick ? 'Picked: <strong>' + esc((areaById(b, pick) || {}).label || '') + '</strong>.' : '') + '</p>' +
      (diff ? '<label for="tc-why">Why this area instead of the recommended one? <span class="note">(saved with the pick; needed to use it)</span></label><textarea id="tc-why" name="tc-why" rows="3" data-tc-why>' + esc(b.pickWhy || '') + '</textarea>' : '') +
      '<div class="actions"><button type="button" class="button-link" data-tc-usepick' + (diff && !(b.pickWhy || '').trim() ? ' disabled' : '') + '>Use the picked area in a project</button></div></div>';
    host.innerHTML = '<p>Capture for a ' + num(b.ctx.units) + '-home project with every home at each AMI level, and penetration with the tax credit homes already there. The project’s level, ' + tier + '% AMI, is the one the tests use. Cells over CHFA’s 85% line are marked.</p>' +
      '<div class="tc-compare-wrap"><table class="data-table tc-compare-table"><caption>Market areas round the site, smallest first</caption><thead><tr><th scope="col">Area</th>' +
      CAP_TIERS.map(function (t) { return '<th scope="col" class="num' + (t === tier ? ' tc-tier' : '') + '">' + t + '% AMI</th>'; }).join('') + '<th scope="col" class="num">Penetration</th><th scope="col">Tests</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      why + form +
      '<p class="note">The four tests: 1. whole census tracts, as CHFA’s Market Study Guide asks (Appendix A to the <a href="' + MSG + '" rel="noopener">2027–28 QAP</a>); 2. tenants could plausibly come from every tract (near the site on its side' + (b.sug.withDrive ? ' and within ' + b.sug.maxDrive + ' minutes\u2019 drive' : '') + ', or at least 10% of working residents with a job near it, LODES 2024); 3. no tract where another town holds most homes and has tax credit homes of its own (2020 Census homes by town and tract); 4. capture at the project’s level and penetration at least 10 points under CHFA’s 85% line. Tests 2 to 4 and their thresholds are COHO’s screening judgments, not CHFA rules. ' + (b.sug.withDrive ? 'Drive times are free-flow OpenStreetMap times from each tract\u2019s 2020 population centre to the one nearest the site, so a range or a long way round shows as a long drive. ' : 'The drive-time file did not load, so drive times are not checked. ') + 'School districts are not checked here; an analyst weighs them.</p>';
  }
  // True when the reader picked another area than the recommended one and has not said why.
  function needsReason(site) {
    var b = site && boxes[keyOf(site)], pa = pickedArea(site);
    if (!b || !pa) return false;
    var rec = (b.areas || []).filter(function (x) { return x.recommended; })[0];
    return !!(rec && pa.id !== rec.id && !(b.pickWhy || '').trim());
  }
  // The picked area, for the project form and the saved record.
  function pickedArea(site) {
    var b = site && boxes[keyOf(site)];
    if (!b || !b.sug) return null;
    return effectivePick(b);
  }

  // ---- drawing ----
  function meter(label, v, note, line) {
    var w = Math.min(v / 1.2, 1) * 100, lw = line / 1.2 * 100;
    return '<div class="cap-row"><p class="cap-label">' + esc(label) + ' <strong>' + p1(v) + '</strong></p>' +
      '<div class="cap-track" role="img" aria-label="' + esc(label + ' ' + p1(v) + ', against the 85% line') + '"><span class="cap-fill' + (v > line ? ' cap-over' : '') + '" style="width:' + w.toFixed(1) + '%"></span><span class="cap-line" style="left:' + lw.toFixed(1) + '%"></span></div>' +
      '<p class="note">' + esc(note) + '</p></div>';
  }
  function draw(b) {
    var ctx = b.ctx, list = chosen(b), m = measure(b, list), E = global.PMAMarketScoring;
    var line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85;
    b.now = m;
    var nSug = b.sug.tracts.filter(function (t) { return t.suggested; }).length;
    var head = b.picked ? 'Your market area: ' + list.length + (list.length === 1 ? ' tract' : ' tracts') + ' (the suggestion had ' + nSug + ').'
      : 'Suggested market area: ' + list.length + (list.length === 1 ? ' whole census tract' : ' whole census tracts') + ' round the site.';
    var ans = !list.length ? head + ' Add a tract on the map to see a capture rate.'
      : !m || m.capture == null ? head + ' No capture rate: ' + ((m && m.reason) || 'no renter household here qualifies under CHFA’s rules') + '.'
      : head + ' A ' + num(ctx.units) + '-home project at ' + ctx.tier + '% AMI would need ' + p1(m.capture) + ' of the ' + num(m.qualified) + ' renter households there who qualify.';
    b.el.querySelector('.tc-answer').textContent = ans;
    b.el.querySelector('.tc-meters').innerHTML = m && m.capture != null
      ? meter('Capture rate, this project', m.capture, num(ctx.units) + ' homes ÷ ' + num(m.qualified) + ' renter households in these tracts who qualify for a ' + ctx.tier + '% AMI home.', line) +
        (m.pen != null ? meter('Penetration, all tax credit homes', m.pen, '(' + num(m.existing) + ' existing in ' + num(m.projects) + (m.projects === 1 ? ' property' : ' properties') + ' + ' + num(ctx.units) + ' proposed) ÷ ' + num(m.pool) + ' renter households who qualify at 20 to 80% AMI.', line) : '')
      : '';
    b.el.querySelector('[data-tc-reset]').hidden = !b.picked;
    drawPanel(b);
    drawCompare(b);
    drawTable(b);
    drawHow(b);
    paint(b);
    curve(b);
  }

  // What one tract does: the area with it and without it, counted by the same engine.
  function drawPanel(b) {
    var p = b.el.querySelector('.tc-panel'), g = b.focus, t = g && b.byId[g];
    if (!t) { p.innerHTML = '<p class="note">Tap a tract on the map, or pick one in the table below, to see what it adds.</p>'; return; }
    var inNow = isIn(b, g), list = chosen(b);
    var other = inNow ? list.filter(function (x) { return x !== g; }) : list.concat([g]);
    var a = b.now, z = measure(b, other);
    var q = single(b, g);
    var change = function (label, x, y) {
      if (x == null && y == null) return '';
      return '<li>' + esc(label) + ': <strong>' + p1(x) + ' → ' + p1(y) + '</strong></li>';
    };
    p.innerHTML = '<h3 class="tc-panel-title">' + esc(t.name + ', ' + t.county) + '</h3>' +
      '<p><strong>' + (t.suggested ? 'Suggested in.' : 'Suggested out.') + '</strong> ' + esc(t.reason) + '</p>' +
      '<p>' + num(q) + ' renter households here qualify for a ' + b.ctx.tier + '% AMI home' + (b.lihtc[g] ? '; ' + b.lihtc[g].length + (b.lihtc[g].length === 1 ? ' tax credit property' : ' tax credit properties') + ' here.' : '.') + '</p>' +
      '<p class="tc-panel-what">' + (inNow ? 'Taking it out:' : 'Adding it:') + '</p><ul class="tc-panel-change">' +
        change('Capture rate', a && a.capture, z && z.capture) + change('Penetration', a && a.pen, z && z.pen) + '</ul>' +
      '<div class="actions"><button type="button" class="button-link" data-tc-toggle="' + esc(g) + '">' + (inNow ? 'Take it out' : 'Add it') + '</button></div>';
  }

  function drawTable(b) {
    var rows = b.sug.order.map(function (g) {
      var t = b.byId[g], on = isIn(b, g);
      return '<tr' + (g === b.focus ? ' class="tc-focus"' : '') + '><td><label class="tc-check"><input type="checkbox" name="tc-in" value="' + esc(g) + '"' + (on ? ' checked' : '') + '> ' + esc(t.name) + '</label><span class="note"> ' + esc(t.county) + '</span></td>' +
        '<td data-label="Suggested">' + (t.suggested ? 'In' : 'Out') + '</td><td data-label="Why">' + esc(t.reason) + '</td><td class="num" data-label="Renters who qualify">' + num(single(b, g)) + '</td></tr>';
    }).join('');
    b.el.querySelector('.tc-table-body').innerHTML = '<div class="tc-table-wrap"><table class="data-table"><caption>Every tract within ' + b.sug.reach + ' miles of the site. Tick a tract to put it in the market area.</caption>' +
      '<thead><tr><th scope="col">Tract</th><th scope="col">Suggested</th><th scope="col">Why</th><th scope="col" class="num">Renters who qualify, ' + b.ctx.tier + '% AMI</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function drawHow(b) {
    var s = b.sug, src = b.data.sources, P = global.LabPlaces;
    var line = function (t, u) { return u ? '<a href="' + esc(u) + '" rel="noopener">' + esc(t) + '</a>' : esc(t); };
    b.el.querySelector('.tc-how').innerHTML =
      '<p class="note"><strong>How COHO suggests the tracts.</strong> The tract the site is in; tracts whose centre is within ' + s.coreMiles + ' miles' + (s.city ? ' (2 in a city, where 25 or more tract centres sit within 3 miles)' : ' (the full Market Analysis pre-selects the same 4 miles)') +
      (s.withDrive ? ', unless the drive is longer than ' + s.maxDrive + ' minutes' : '') + '; farther tracts, out to ' + s.reach + ' miles, where at least a quarter of the working residents, and at least 50 of them, have a job within ' + s.coreMiles + ' miles of the site; nothing across an interstate, a river or a named lake unless that jobs tie holds; and at least 3 tracts' + (s.withDrive ? ', adding the nearest in the county within ' + RULES.smallDrive + ' minutes\u2019 drive' : '') + '. ' +
      'These are COHO’s screening rules, not CHFA’s. CHFA asks for whole tracts and a written reason for the edge, and a CHFA-approved analyst draws the area a study uses.' +
      (s.withCommutes ? '' : ' The commuting file did not load, so this suggestion uses distance only.') + (s.withCrossings ? '' : ' The rivers and interstates file did not load, so no crossing was checked.') + '</p>' +
      '<p class="metric-source">' + [
        line('LEHD LODES ' + ((src.od && src.od.vintage) || '2024') + ' home-to-work flows', src.od && src.od.source_url),
        s.withDrive && line('Drive times: OpenStreetMap contributors, routed by OSRM' + (src.drive && src.drive.as_of ? ', ' + src.drive.as_of : ''), 'https://www.openstreetmap.org/copyright'),
        s.withDrive && line('Tract population centres: U.S. Census Bureau, 2020 Centers of Population', 'https://www.census.gov/geographies/reference-files/time-series/geo/centers-population.html'),
        line('CDOT highways and Census TIGERweb water', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Hydro/MapServer'),
        line('Census TIGER 2020 tracts', 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html'),
        line('CHFA Housing Tax Credit property list', 'https://www.chfainfo.com/rental-housing/housing-credit'),
        line('Renters who qualify: HUD CHAS 2018–2022 and Census ACS, counted the CHFA Market Study Guide way', 'https://www.huduser.gov/portal/datasets/cp.html')
      ].filter(Boolean).join(' · ') + '</p>';
  }

  // Capture as tracts are added in the suggested order: worked out a few steps at a time so the page stays free.
  function curve(b) {
    var forKey = b.sug.order.join(',') + '|' + b.ctx.units + '|' + b.ctx.tier;
    if (b.curveFor === forKey && b.curve && b.curve.done) { drawCurve(b); return; }
    if (b.curveFor !== forKey) { b.curveFor = forKey; b.curve = { pts: [], done: false }; }
    var c = b.curve, order = b.sug.order;
    (function step() {
      if (b.curveFor !== forKey) return;
      var until = Math.min(order.length, c.pts.length + 6);
      for (var k = c.pts.length + 1; k <= until; k++) {
        var m = measure(b, order.slice(0, k));
        c.pts.push({ n: k, capture: m ? m.capture : null, pen: m ? m.pen : null });
      }
      if (c.pts.length >= order.length) c.done = true;
      drawCurve(b);
      if (!c.done) setTimeout(step, 0);
    })();
  }
  function drawCurve(b) {
    var c = b.curve, el = b.el.querySelector('.tc-curve-body');
    if (!c || !c.pts.length) return;
    var W = 400, H = 250, L = 44, R = 8, T = 16, B = 40;
    var pts = c.pts.filter(function (p) { return p.capture != null; });
    if (!pts.length) { el.innerHTML = '<p class="note">No capture rate for these tracts.</p>'; return; }
    var nMax = b.sug.order.length, yMax = Math.max.apply(null, pts.map(function (p) { return p.capture; }).concat(pts.map(function (p) { return p.pen || 0; })));
    yMax = Math.min(Math.max(yMax * 1.05, 0.05), 3);
    // Round steps (5, 10, 20, 25, 50 or 100 points) so the axis reads 0%, 25%, 50%...
    var stepV = [0.05, 0.1, 0.2, 0.25, 0.5, 1].filter(function (v) { return yMax / v <= 5; })[0] || 1;
    yMax = Math.ceil(yMax / stepV) * stepV;
    var x = function (n) { return L + (n - 1) / Math.max(1, nMax - 1) * (W - L - R); };
    var y = function (v) { return T + (1 - Math.min(v, yMax) / yMax) * (H - T - B); };
    var path = function (k) { return pts.filter(function (p) { return p[k] != null; }).map(function (p, i) { return (i ? 'L' : 'M') + x(p.n).toFixed(1) + ' ' + y(p[k]).toFixed(1); }).join(''); };
    var nSug = b.sug.tracts.filter(function (t) { return t.suggested; }).length, nNow = chosen(b).length;
    var ticks = []; for (var tv = 0; tv <= yMax + 1e-9; tv += stepV) ticks.push(tv);
    var at = pts.filter(function (p) { return p.n === nSug; })[0];
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="tc-svg" role="img" aria-label="' + esc('Capture rate as tracts are added in the suggested order: ' + (at ? p1(at.capture) + ' at the suggested ' + nSug + ' tracts, ' : '') + p1(pts[pts.length - 1].capture) + ' with all ' + pts[pts.length - 1].n + '.') + '">' +
      ticks.map(function (v) { return '<line class="tc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="tc-tick" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(v * 100) + '%</text>'; }).join('') +
      (0.85 <= yMax ? '<line class="tc-limit" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0.85).toFixed(1) + '" y2="' + y(0.85).toFixed(1) + '"/><text class="tc-tick" x="' + (W - R) + '" y="' + (y(0.85) - 4).toFixed(1) + '" text-anchor="end">85% line</text>' : '') +
      '<line class="tc-mark" x1="' + x(nSug).toFixed(1) + '" x2="' + x(nSug).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
      '<text class="tc-tick" x="' + (x(nSug) + 4).toFixed(1) + '" y="' + (T + 10) + '">Suggested: ' + nSug + '</text>' +
      '<path class="tc-pen" d="' + path('pen') + '"/><path class="tc-cap" d="' + path('capture') + '"/>' +
      (b.now && b.now.capture != null && nNow ? '<circle class="tc-now" cx="' + x(Math.min(nNow, nMax)).toFixed(1) + '" cy="' + y(b.now.capture).toFixed(1) + '" r="6"/>' : '') +
      '<text class="tc-tick" x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Tracts in the area, in the suggested order</text>' +
      '<text class="tc-tick" x="' + L + '" y="' + (H - 24) + '" text-anchor="middle">1</text><text class="tc-tick" x="' + (W - R) + '" y="' + (H - 24) + '" text-anchor="end">' + nMax + '</text></svg>';
    var last = pts[pts.length - 1];
    el.innerHTML = '<p class="viz-answer">' + (at ? 'At the suggested ' + nSug + (nSug === 1 ? ' tract' : ' tracts') + ' the project needs ' + p1(at.capture) + ' of renters who qualify. ' : '') +
      (c.done ? 'With all ' + last.n + ' tracts within ' + b.sug.reach + ' miles it would need ' + p1(last.capture) + '. Where the line flattens, more tracts add little.' : 'Working out the rest…') + '</p>' + svg +
      '<ul class="tc-key"><li><span class="tc-sw tc-sw-cap"></span>Capture rate, this project</li><li><span class="tc-sw tc-sw-pen"></span>Penetration, all tax credit homes</li><li><span class="tc-sw tc-sw-now"></span>Your area now (' + nNow + ' tracts)</li></ul>';
  }

  // ---- the map ----
  function drawMap(b) {
    var host = b.el.querySelector('.tc-map');
    needLeaflet().then(function (L) {
      if (b.map) return;
      var map = b.map = L.map(host, { zoomControl: true, attributionControl: true, tap: true });
      var streets = L.tileLayer(OSM.url, { attribution: OSM.attribution, maxZoom: OSM.maxZoom, referrerPolicy: 'origin' }).addTo(map);
      var sat = L.tileLayer(SAT.url, { attribution: SAT.attribution, maxZoom: SAT.maxZoom });
      L.control.layers({ Streets: streets, Satellite: sat }, null, { collapsed: false, position: 'topright' }).addTo(map);
      L.control.scale({ imperial: true, metric: false }).addTo(map);
      var group = L.featureGroup().addTo(map);
      b.sug.tracts.forEach(function (t) {
        var f = b.data.shapes[t.geoid]; if (!f) return;
        var lay = L.geoJSON(f, { style: function () { return style(b, t.geoid); } });
        lay.on('click', function () { b.focus = t.geoid; draw(b); });
        lay.bindTooltip(t.name, { sticky: true });
        lay.addTo(group);
        b.layers[t.geoid] = lay;
      });
      L.marker([b.ctx.site.lat, b.ctx.site.lon], { icon: L.divIcon({ className: 'ps-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22] }), keyboard: false, interactive: false }).addTo(map);
      var inB = L.latLngBounds([]);
      chosen(b).forEach(function (g) { if (b.layers[g]) inB.extend(b.layers[g].getBounds()); });
      map.fitBounds(inB.isValid() ? inB.pad(0.25) : group.getBounds(), { maxZoom: 13 });
      paint(b);
    }).catch(function () {
      host.innerHTML = '<p class="note">The map did not load. The table below lists every tract, and the ticks there work the same way.</p>';
    });
  }
  var shadeCut = null;
  function style(b, g) {
    var on = isIn(b, g), t = b.byId[g], q = single(b, g) || 0;
    if (!shadeCut) {
      var vals = b.sug.tracts.map(function (x) { return single(b, x.geoid) || 0; }).sort(function (a, c) { return a - c; });
      shadeCut = [vals[Math.floor(vals.length / 3)], vals[Math.floor(vals.length * 2 / 3)]];
    }
    var lvl = q > shadeCut[1] ? 0.55 : q > shadeCut[0] ? 0.4 : 0.25;
    var focus = g === b.focus;
    if (on) return { color: css('--pine-deep') || css('--pine'), weight: focus ? 4 : 2, fillColor: css('--pine'), fillOpacity: lvl, dashArray: null };
    if (t && (t.why === 'across' || t.why === 'drive')) return { color: css('--rust'), weight: focus ? 4 : 2, fillColor: css('--rust'), fillOpacity: 0.08, dashArray: '6 4' };
    return { color: css('--slate') || css('--grey'), weight: focus ? 4 : 1.5, fillColor: css('--grey'), fillOpacity: 0.08, dashArray: '4 3' };
  }
  function paint(b) {
    if (!b.map) return;
    shadeCut = null;
    Object.keys(b.layers).forEach(function (g) { b.layers[g].setStyle(style(b, g)); });
  }

  // The tract list the "Use in project" form stores: the edited list from the address, else the suggestion once
  // it has been worked out; null while it is still loading.
  function current(site, edited) {
    var pa = pickedArea(site);
    if (pa) return pa.list.slice();
    if (edited && edited.length) return edited.slice();
    var b = site && boxes[keyOf(site)];
    return b && b.sug ? chosen(b) : null;
  }
  // What a saved market area keeps, so a later page can read it without working anything out again: every tract
  // looked at, whether it is in the area, and the reason; the rules; and the dates of the files used.
  function record(site, edited) {
    var b = site && boxes[keyOf(site)];
    if (!b || !b.sug) return null;
    var pa = pickedArea(site), inSet = set(current(site, edited) || []), src = b.data.sources, areas = areasFor(b), rec = areas.filter(function (x) { return x.recommended; })[0];
    return {
      tracts: b.sug.order.map(function (g) {
        var t = b.byId[g];
        return { geoid: g, name: t.name, county: t.county, miles: Math.round(t.miles * 10) / 10, inArea: !!inSet[g], suggested: t.suggested, why: t.why, reason: t.reason };
      }),
      comparison: {
        areas: areas.map(function (x) { return { id: x.id, label: x.label, method: x.method, note: x.note, tracts: x.list.slice(), recommended: !!x.recommended, tests: x.eval.tests.map(function (t) { return { id: t.id, pass: t.pass, text: t.text }; }), line: x.line || null }; }),
        recommended: rec ? rec.id : null,
        recommendedWhy: rec ? rec.eval.tests.map(function (t) { return (t.pass ? 'Passes: ' : 'Fails: ') + t.text; }) : null,
        picked: pa ? pa.id : null,
        pickedWhy: pa && rec && pa.id !== rec.id ? (b.pickWhy || '').trim() || null : null,
        tests: 'COHO screening tests, 14 Nov 2026: 1 whole tracts (CHFA Market Study Guide); 2 every tract near the site on its side' + (b && b.sug && b.sug.withDrive ? ' and within ' + b.sug.maxDrive + ' minutes by road (OpenStreetMap)' : '') + ', or with 10%+ of working residents employed near it (LODES 2024); 3 no tract where another town holds most homes and has tax credit homes; 4 capture at the project level and penetration at least 10 points under the 85% line. Tests 2-4 are not CHFA rules.'
      },
      edited: !!(edited && edited.length), city: b.sug.city, coreMiles: b.sug.coreMiles, reachMiles: b.sug.reach,
      withCommutes: b.sug.withCommutes, withCrossings: b.sug.withCrossings,
      rules: 'COHO screening rules, 14 Nov 2026: the site tract; tracts within ' + b.sug.coreMiles + ' miles; farther tracts to ' + b.sug.reach + ' miles where 25% or more (and 50 or more) of working residents have a job within ' + b.sug.coreMiles + ' miles' + (b.sug.withDrive ? ' unless more than ' + b.sug.maxDrive + ' minutes by road' : '') + '; nothing across an interstate, river or named lake unless that jobs tie holds; at least 3 tracts' + (b.sug.withDrive ? ', the added ones within ' + RULES.smallDrive + ' minutes by road' : '') + '. Not CHFA rules.',
      sourceDates: {
        lodesOd: src.od ? (src.od.vintage ? 'LODES ' + src.od.vintage : null) : null, lodesOdBuilt: src.od ? src.od.generated_at || src.od.as_of || null : null,
        barriers: src.barriers ? src.barriers.generated || null : null,
        driveTimes: src.drive ? src.drive.generated || null : null,
        placeTracts: src.places ? 'Census ' + (src.places.vintage || 2020) : null,
        tractCentroids: src.cent ? src.cent.generated || null : null
      }
    };
  }
  function parseList(text) {
    return String(text || '').split('.').filter(function (g) { return /^\d{9}$/.test(g); }).map(full);
  }

  if (global.MutationObserver && doc.getElementById) {
    var start = function () {
      var main = doc.querySelector('main') || doc.body;
      new global.MutationObserver(function () { mountAll(); }).observe(main, { childList: true, subtree: true });
      mountAll();
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  }

  global.LabTractCapture = { section: section, suggest: suggest, current: current, record: record, pickedArea: pickedArea, needsReason: needsReason, parseList: parseList, RULES: RULES, FILES: FILES, mountAll: mountAll };
})(window);
