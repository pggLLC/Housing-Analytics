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
// With the people-by-road file (data/market/tract_drive_bands_co.json; paul approved 18 Nov 2026 as "only
// justification for the [tract] method, to capture the right [tracts] for CHFA"), rule 2's drive test asks whether most
// of a tract's 2020 Census population lives within 20 minutes' drive of the site (15 in a city), and rule 4's crossing
// gives way where it does, since roads cross. Each tract also shows its school district share, job tie and movers.
// The comparison then holds drive-time areas too, scores every area with CHFA's own rate (comparable family tax credit
// homes already there + the new homes, over renter households who qualify, at each AMI level and across all), and
// picks the best fit for CHFA by a stated rule (BEST), the default pick carried to the project and the full Market
// Analysis.
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
    drive: 'data/market/tract_drive_times_co.json',
    // The reasons for each tract (paul approved 18 Nov 2026): people by road, school district, movers; and the HUD
    // Section 8 contracts, to say where a comparable tax credit property may also carry project-based rent help.
    bands: 'data/market/tract_drive_bands_co.json',
    schools: 'data/market/tract_school_districts_co.json',
    movers: 'data/market/acs_tract_movers_co.json',
    s8: 'data/market/hud_s8_contracts_co.json',
    // "Who could rent here" (paul, 15 Nov 2026): the town's own renters, by the needs assessment's own apportionment,
    // and the workers who commute in, from its workforce file.
    membership: 'data/hna/place-tract-membership.json',
    placePop: 'data/hna/place-lehd.json',
    placeRenters: 'data/hna/place-chas.json',
    workforce: 'data/hna/workforce-need.json'
  };
  var ENGINES = { barriers: 'js/pma-barriers.js', supply: 'js/market-analysis-supply.js' };
  var RULES = { core: 4, cityCore: 2, cityTest: 3, cityCount: 25, reach: 12, cityReach: 6, tie: 0.25, tieMin: 50, minTracts: 3, maxCandidates: 150, drive: 30, cityDrive: 20, smallDrive: 45, band: 20, cityBand: 15 };
  // The best-fit rule (paul approved 18 Nov 2026, from the 17 Nov proposal): of the areas that hold at least half the
  // people within the drive band of the site (20 minutes, 15 in a city) and stay at or under CHFA's 85% line at the
  // project's level and across all levels, the lowest CHFA rate; then the fewest tracts within 5 points of it.
  var BEST = { draw: 0.5, within: 0.05, quarter: 0.25 };
  var BAND_AT = { 10: 0, 15: 1, 20: 2 };
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
    var siteGeoid = o.siteGeoid || (rows[0] && rows[0].geoid);
    // Where each tract's people live, by road (paul, 18 Nov 2026: drive time is "only justification for the [tract]
    // method, to capture the right [tracts] for CHFA"). The share of each tract's 2020 Census population within 10, 15
    // and 20 minutes' drive of the 2020 population centre nearest the site (data/market/tract_drive_bands_co.json).
    var anchorIdx = -1;
    if (o.drive && Array.isArray(o.drive.tracts) && Array.isArray(o.drive.points) && o.drive.points.length === o.drive.tracts.length) {
      var near0 = Infinity;
      o.drive.points.forEach(function (p, k) { var m = miles(site, { lat: p[0], lon: p[1] }); if (m < near0) { near0 = m; anchorIdx = k; } });
    } else if (o.drive && Array.isArray(o.drive.tracts) && siteGeoid) anchorIdx = o.drive.tracts.indexOf(siteGeoid);
    var anchor0 = anchorIdx > -1 ? o.drive.tracts[anchorIdx] : null;
    var shares = null, bandPop = null, drawTotal = null, band = city ? RULES.cityBand : RULES.band;
    var bf = o.bands, bandFrom = anchor0, bandFromName = null;
    // The file's own origins: each tract's population centre and each town's or CDP's internal point. A site in
    // town takes the town's point, since a rural tract's centre can sit miles out of town.
    if (bf && Array.isArray(bf.points) && Array.isArray(bf.tracts) && bf.points.length === bf.tracts.length) {
      var nb = Infinity;
      bf.points.forEach(function (p, k) { var m = miles(site, { lat: p[0], lon: p[1] }); if (m < nb && bf.from[bf.tracts[k]]) { nb = m; bandFrom = bf.tracts[k]; bandFromName = null; } });
      (bf.places || []).forEach(function (p) { var m = miles(site, { lat: p[2], lon: p[3] }); if (m < nb && bf.from[p[0]]) { nb = m; bandFrom = p[0]; bandFromName = p[1]; } });
    }
    if (bf && bf.from && Array.isArray(bf.tracts) && Array.isArray(bf.pop) && bandFrom && Array.isArray(bf.from[bandFrom])) {
      shares = {}; bandPop = {}; drawTotal = [0, 0, 0];
      bf.from[bandFrom].forEach(function (r) {
        var g = bf.tracts[r[0]], pop = +bf.pop[r[0]] || 0;
        if (!g) return;
        shares[g] = [r[1] / 100, r[2] / 100, r[3] / 100]; bandPop[g] = pop;
        for (var k = 0; k < 3; k++) drawTotal[k] += shares[g][k] * pop;
      });
    }
    var shareOf = function (g, m) { return shares ? (shares[g] ? shares[g][BAND_AT[m]] : 0) : undefined; };
    var cands = rows.filter(function (r) { return r.miles <= reach; }).slice(0, RULES.maxCandidates);
    // A tract where a quarter or more of its people live within 20 minutes' drive is looked at too, however far its
    // centre: the drive-time areas in the comparison take such tracts in.
    if (shares) {
      var inC = {}; cands.forEach(function (r) { inC[r.geoid] = true; });
      rows.forEach(function (r) { if (!inC[r.geoid] && shareOf(r.geoid, 20) >= BEST.quarter) { cands.push(r); inC[r.geoid] = true; } });
    }
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
    if (o.drive && o.drive.from && Array.isArray(o.drive.tracts) && siteGeoid && anchorIdx > -1) {
      var si = anchorIdx;
      anchor = anchor0;
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
    // With the people-by-road file, a tract is near by road when most of its people live within the band (20 minutes,
    // 15 in a city): CHFA's market area is where a project draws "the majority of its residents" (2027-28 QAP,
    // Appendix A). Without it, the centre-to-centre drive as before.
    var most = function (g) { return shares ? shareOf(g, band) >= BEST.draw : null; };
    var longDrive = function (g) { if (shares) return !most(g); var m = driveOf(g); return m != null && m > maxDrive; };
    var peopleWords = function (g) { return Math.round(shareOf(g, band) * 100) + '% of its people within ' + band + ' minutes\u2019 drive'; };
    var driveWords = function (g) { if (shares) return peopleWords(g); var m = driveOf(g); return m === undefined ? '' : m == null ? 'no drive time on file' : Math.round(m) + ' minutes\u2019 drive'; };
    // The other reasons a reviewer reads, for every tract: the site's school district (the district holding most of
    // the site tract's people) and renters who moved in from another county, state or abroad (context only).
    var sch = o.schools && o.schools.tracts && Array.isArray(o.schools.districts) ? o.schools : null;
    var siteDist = sch && siteGeoid && sch.tracts[siteGeoid] && sch.tracts[siteGeoid][0] ? sch.tracts[siteGeoid][0][0] : null;
    var schoolOf = function (g) {
      if (!sch || siteDist == null) return null;
      var rs = sch.tracts[g] || [];
      for (var k = 0; k < rs.length; k++) if (rs[k][0] === siteDist) return rs[k][1] / 100;
      return 0;
    };
    var mv = o.movers && o.movers.tracts ? o.movers.tracts : null;
    var moversOf = function (g) {
      var m = mv && mv[g];
      if (!m || m[0] == null) return null;
      var out = (m[2] || 0) + (m[3] || 0) + (m[4] || 0);
      return { renters: m[0], outside: out, moe: m[5], share: m[0] > 0 ? out / m[0] : null };
    };
    var coreWords = 'within ' + coreMiles + ' miles of the site';
    var tied = function (g) { return tie && tie[g] && tie[g].share >= RULES.tie && tie[g].toCore >= RULES.tieMin; };
    var tieWords = function (g) {
      var x = tie && tie[g];
      return x && x.workers ? Math.round(x.share * 100) + '% of the people who live here and work have a job ' + coreWords + ' (' + num(x.toCore) + ' of ' + num(x.workers) + ')' : null;
    };
    var list = cands.map(function (r) {
      var g = r.geoid, x = across && across[g], d = mi(r.miles) + ((mins || shares) && g !== siteGeoid ? ' (' + driveWords(g) + ')' : ''), it = { drive: driveOf(g) === undefined ? null : driveOf(g), geoid: g, name: tractName(r.t), county: r.t.county_name ? r.t.county_name + ' County' : '', countyFips: String(r.t.county_fips || g.slice(0, 5)), miles: r.miles, lat: r.t.lat, lon: r.t.lon, across: x || null, tie: tie ? tie[g] : null,
        bands: shares ? [shareOf(g, 10), shareOf(g, 15), shareOf(g, 20)] : null, school: schoolOf(g), movers: moversOf(g) };
      if (g === siteGeoid) return Object.assign(it, { suggested: true, why: 'site', reason: 'The site is in this tract.' });
      if (core[g]) {
        if (longDrive(g) && !tied(g)) return Object.assign(it, { suggested: false, why: 'drive', reason: shares
          ? d + ' from the site: fewer than half its people live within ' + band + ' minutes by road, so near on the map but not in practice (a range, a river or a long way round).'
          : d + ' from the site: more than ' + maxDrive + ' minutes by road, so near on the map but not in practice (a range, a river or a long way round).' });
        // Roads cross the river or interstate when most of the tract's people are within the band by road.
        if (x && !tied(g) && most(g)) return Object.assign(it, { suggested: true, why: 'near', reason: d + ' from the site. It is across ' + x + ', but roads cross it: most of its people are within ' + band + ' minutes’ drive.' });
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
        t.reason = mi(t.miles) + (mins || shares ? ' (' + driveWords(t.geoid) + ')' : '') + ' from the site. Added so the area is more than the town itself: the next-nearest tract in ' + (t.county || 'the county') + '.' +
          (t.across ? ' It is across ' + t.across + ', but no tract on the site\u2019s side is nearer.' : '');
        count++;
      });
    });
    // The site's tract first, then the other suggested tracts nearest first, then the rest nearest first.
    var rank = function (t) { return t.why === 'site' ? 0 : t.suggested ? 1 : 2; };
    var order = list.slice().sort(function (a, c) { return rank(a) - rank(c) || a.miles - c.miles; }).map(function (t) { return t.geoid; });
    return { city: city, coreMiles: coreMiles, reach: reach, maxDrive: maxDrive, siteGeoid: siteGeoid, tracts: list, order: order, withCommutes: !!tie, withCrossings: !!across, withDrive: !!mins, driveFrom: anchor, rules: RULES,
      core: Object.keys(core), band: band, withBands: !!shares, bandFrom: shares ? bandFrom : null, bandFromName: shares ? bandFromName : null, shares: shares, bandPop: bandPop, drawTotal: drawTotal,
      siteDistrict: siteDist != null ? { geoid: sch.districts[siteDist][0], name: sch.districts[siteDist][1] } : null, withSchools: siteDist != null, withMovers: !!mv };
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
      '<section class="tc-views" aria-labelledby="tc-views-h"><h3 id="tc-views-h">Who could rent here</h3><div class="tc-views-body"><p class="note">Working out the six views\u2026</p></div></section>' +
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
      var t = ev.target.closest && ev.target.closest('[data-tc-toggle],[data-tc-reset],[data-tc-show],[data-tc-use],[data-tc-usepick],[data-tc-vmode]');
      if (!t) return;
      if (t.hasAttribute('data-tc-vmode')) { ev.preventDefault(); b.vmode = t.getAttribute('data-tc-vmode'); drawViews(b); return; }
      if (t.hasAttribute('data-tc-usepick')) { ev.preventDefault(); if (!t.disabled) useThese(b); return; }
      ev.preventDefault();
      if (t.hasAttribute('data-tc-use')) {
        b.pickId = b.picked ? 'map' : (headArea(b) ? headArea(b).id : 'suggested');
        save(b);
        // An area other than the local or regional one needs a reason first, asked for under the comparison.
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
      if (t && t.name === 'tc-area') { b.pickId = t.value; b.pickWhy = ''; save(b); drawHead(b); drawCompare(b); }
    });
    // The reason for picking an area other than the local or regional one; the button waits for it.
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
    // The town and workforce files feed only "Who could rent here"; the rest of the box never waits for them.
    b.placeFiles = Promise.all([get(FILES.membership), get(FILES.placePop), get(FILES.placeRenters), get(FILES.workforce)])
      .then(function (r) { return { memb: r[0], pop: r[1], renters: r[2], wf: r[3] }; }, function () { return null; });
    var heavy = Promise.all([
      get(FILES.od).catch(function () { return null; }),
      get(FILES.drive).catch(function () { return null; }),
      Promise.all([get(FILES.barriers), script(ENGINES.barriers, 'PMABarriers')]).catch(function () { return [null, null]; }),
      get(FILES.bands).catch(function () { return null; }),
      get(FILES.schools).catch(function () { return null; }),
      get(FILES.movers).catch(function () { return null; }),
      get(FILES.s8).catch(function () { return null; })
    ]);
    light.then(function (a) {
      say('Checking commutes, rivers and interstates round the site…');
      return heavy.then(function (h) {
        var cent = a[0], geom = a[1], lihtc = a[2];
        var shapes = {}; (geom.features || []).forEach(function (f) { shapes[String(f.properties.GEOID)] = f; });
        var site = ctx.site, siteGeoid = null;
        Object.keys(shapes).some(function (g) { if (inGeom(site.lon, site.lat, shapes[g].geometry)) { siteGeoid = g; return true; } return false; });
        var bf = h[2] && h[2][0] ? h[2][0].features : null;
        b.sug = suggest({ site: site, cent: cent, siteGeoid: siteGeoid, od: h[0], drive: h[1], barrierFeatures: bf, B: h[2] ? h[2][1] : null, bands: h[3], schools: h[4], movers: h[5] });
        b.files = { schools: h[4], movers: h[5] };
        b.s8 = s8Index(h[6]);
        b.byId = {}; b.sug.tracts.forEach(function (t) { b.byId[t.geoid] = t; });
        b.od = h[0];
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
        b.data = { cent: cent, shapes: shapes, sources: { od: h[0] && h[0].meta, drive: h[1] && h[1].meta, barriers: h[2] && h[2][0] && h[2][0].meta, cent: cent.meta, places: b.places && b.places.meta,
          bands: h[3] && h[3].meta, schools: h[4] && h[4].meta, movers: h[5] && h[5].meta, s8: h[6] && h[6].meta } };
        b.pickId = ctx.ta || null;
        b.single = {};
        b.picked = (ctx.edited && ctx.edited.length) ? set(ctx.edited.filter(function (g) { return b.byId[g]; })) : null;
        draw(b);
        drawMap(b);
        b.placeFiles.then(function (pf) { b.pf = pf; b.pfDone = true; if (b.sug) drawViews(b); });
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
    var c = compIn(b, list), compT = c.by[b.ctx.tier] || 0;
    return { qualified: q.value, pool: pool.value, existing: existing, projects: sup.lihtcCount || 0, supplyNotes: supplyNotes(sup),
      capture: q.value > 0 ? units / q.value : null, pen: pool.value > 0 ? (existing + units) / pool.value : null, reason: q.reason,
      comparable: compT, chfa: q.value > 0 ? (units + compT) / q.value : null, compNotes: compNotes(c) };
  }
  // The supply engine's own caveats: a property counted at all its units because it reports no income-restricted
  // count (may overstate), or one with no unit count at all (left out, so understates). The full Market Analysis shows
  // them beside its figures; so does every penetration here, and the saved comparison keeps them.
  function supplyNotes(sup) { return [sup.unitsFallbackReason, sup.unitsUnavailableReason].filter(Boolean); }

  // ---- CHFA's capture rate (paul approved 18 Nov 2026) ----
  // CHFA's Market Study Guide (2027-28 QAP, Appendix A): at each AMI level, (comparable existing and planned tax credit
  // homes + the proposed homes) ÷ renter households who qualify, reviewed against 85%. Comparable means family homes
  // for a family project: each property on CHFA's list counts its homes at each AMI level times its family share
  // (senior, homeless, veteran, supportive and special-needs homes are left out). A property with no population split
  // counts as family. A property with no AMI split cannot be placed at a level and is left out, said so. Every property
  // on the list counts, whatever its compliance status, so one under construction counts as planned.
  var COMP_KEYS = { 30: ['lte20', 'ami30'], 40: ['ami40'], 50: ['ami50'], 60: ['ami60'], 70: ['ami70'], 80: ['ami80'] };
  function compOf(f) {
    if (f._tcComp) return f._tcComp;
    var p = f.properties || {}, a = p.AMIUnits || {}, pu = p.PopulationUnits || {}, tot = 0, all = 0, by = {};
    Object.keys(pu).forEach(function (k) { tot += +pu[k] || 0; });
    var fam = tot > 0 ? (+pu.family || 0) / tot : 1;
    CAP_TIERS.forEach(function (t) { var n = 0; COMP_KEYS[t].forEach(function (k) { n += +a[k] || 0; }); all += n; by[t] = n * fam; });
    return (f._tcComp = { by: by, fam: fam, none: all > 0 ? 0 : (+p.LI_UNITS || +p.N_UNITS || 0) * fam, name: p.PROJECT || p.PROJECT_NAME || '' });
  }
  // HUD's Section 8 contract list has no map point, so a property is matched to it by street address and city. CHFA
  // leaves project-based Section 8 homes out of the comparable count; the CHFA list does not flag them, so a match is
  // shown as a caveat (the rate may be overstated), never taken out.
  function addrKey(addr, city) {
    var w = { AVENUE: 'AVE', STREET: 'ST', ROAD: 'RD', DRIVE: 'DR', BOULEVARD: 'BLVD', COURT: 'CT', PLACE: 'PL', LANE: 'LN', CIRCLE: 'CIR', PARKWAY: 'PKWY', HIGHWAY: 'HWY', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
    var a = String(addr || '').toUpperCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean).map(function (x) { return w[x] || x; }).join(' ');
    var c = String(city || '').toUpperCase().replace(/[^A-Z ]/g, '').trim();
    return a && c ? a + '|' + c : null;
  }
  function s8Index(file) {
    if (!file || !Array.isArray(file.contracts)) return null;
    var idx = {};
    file.contracts.forEach(function (c) {
      if (/expired|terminated/i.test(String(c.status || ''))) return;
      var k = addrKey(c.address, c.city);
      if (k) idx[k] = (idx[k] || 0) + (+c.assisted_units || 0);
    });
    return idx;
  }
  function compIn(b, list) {
    var by = {}, none = { n: 0, units: 0 }, s8 = { n: 0, units: 0, by: {} }, props = 0;
    CAP_TIERS.forEach(function (t) { by[t] = 0; s8.by[t] = 0; });
    list.forEach(function (g) {
      (b.lihtc[g] || []).forEach(function (f) {
        var c = compOf(f), low = 0;
        CAP_TIERS.forEach(function (t) { by[t] += c.by[t]; if (t <= 60) low += c.by[t]; });
        if (c.none > 0) { none.n++; none.units += c.none; }
        if (low > 0 || c.none > 0) props++;
        var p = f.properties || {}, k = b.s8 && addrKey(p.PROJ_ADD, p.PROJ_CTY);
        // Up to the contract's homes could be assisted, at each level no more than the property has there.
        if (k && b.s8[k] && low > 0) { s8.n++; s8.units += Math.min(low, b.s8[k]); CAP_TIERS.forEach(function (t) { s8.by[t] += Math.min(c.by[t], b.s8[k]); }); }
      });
    });
    return { by: by, none: none, s8: s8, props: props };
  }
  // The project's level and every level up to it (20 to 60% AMI at least), counted once each.
  function chfaTiers(tier) { var top = Math.max(60, tier); return { top: top, tiers: PEN_TIERS.filter(function (t) { return t <= top; }) }; }
  // The CHFA rate for a list of tracts: at the project's level, and across every level up to 60% AMI (or the project's
  // level, if higher). qualifiedAll and comparableAll are the parts of the all-levels rate.
  function chfaRate(b, list) {
    var units = b.ctx.units, tier = b.ctx.tier, ct = chfaTiers(tier);
    var c = compIn(b, list), qT = qual(b, list, [tier]), qAll = qual(b, list, ct.tiers);
    var compAll = 0; CAP_TIERS.forEach(function (t) { if (t <= ct.top) compAll += c.by[t]; });
    return { comp: c, qT: qT, existingT: c.by[tier] || 0, rateT: qT > 0 ? (units + (c.by[tier] || 0)) / qT : null,
      qAll: qAll, existingAll: compAll, rateAll: qAll > 0 ? (units + compAll) / qAll : null, top: ct.top };
  }
  function compNotes(c) {
    var out = [];
    if (c.none.n) out.push(c.none.n + (c.none.n === 1 ? ' property' : ' properties') + ' (' + num(c.none.units) + ' family homes) on CHFA’s list give no AMI split, so ' + (c.none.n === 1 ? 'it is' : 'they are') + ' left out; the rate may be understated.');
    if (c.s8.n) out.push(c.s8.n + (c.s8.n === 1 ? ' comparable property shares its address' : ' comparable properties share their address') + ' with a HUD Section 8 contract (up to ' + num(c.s8.units) + ' homes). CHFA leaves project-based Section 8 homes out, so the rate may be overstated.');
    return out;
  }
  // The reasons for an area, in the people they cover: its share of everyone within the drive band of the site; the
  // share of its people in the site's school district; the share of the jobs near the site held by its residents
  // (LODES); and renters who moved in from another county, state or abroad last year (ACS; context only).
  function evidence(b, list) {
    var s = b.sug, r = { draw: null, school: null, jobs: null, movers: null, moversMoe: null };
    if (s.withBands) {
      var k = BAND_AT[s.band], n = 0;
      list.forEach(function (g) { var sh = s.shares[g]; if (sh) n += sh[k] * (s.bandPop[g] || 0); });
      r.draw = s.drawTotal[k] > 0 ? n / s.drawTotal[k] : null;
    }
    var idx = engineOpts(b.ctx.s.x).acsIdx || {}, sch = b.files && b.files.schools, dist = s.siteDistrict;
    if (sch && dist) {
      var di = -1; sch.districts.forEach(function (d, i) { if (d[0] === dist.geoid) di = i; });
      var pIn = 0, pAll = 0;
      list.forEach(function (g) {
        var pop = (s.bandPop && s.bandPop[g]) || (idx[g] && +idx[g].pop) || 0, rs = sch.tracts[g] || [], sh = 0;
        rs.forEach(function (x) { if (x[0] === di) sh = x[1] / 100; });
        pAll += pop; pIn += pop * sh;
      });
      r.school = pAll > 0 ? pIn / pAll : null;
    }
    var jt = coreJobs(b);
    if (jt && jt.total > 0) { var h = 0; list.forEach(function (g) { h += jt.byHome[g] || 0; }); r.jobs = h / jt.total; r.jobsTotal = jt.total; }
    var mv = b.files && b.files.movers && b.files.movers.tracts;
    if (mv) {
      var rp = 0, out = 0, moe2 = 0;
      list.forEach(function (g) { var m = mv[g]; if (!m || m[0] == null) return; rp += m[0]; out += (m[2] || 0) + (m[3] || 0) + (m[4] || 0); moe2 += (m[5] || 0) * (m[5] || 0); });
      if (rp > 0) { r.movers = out / rp; r.moversPeople = out; r.moversMoe = Math.sqrt(moe2); }
    }
    return r;
  }
  // Jobs in the core tracts (the site's tract and those within the core miles), by the tract their workers live in.
  function coreJobs(b) {
    if (b.coreJobs !== undefined) return b.coreJobs;
    if (!b.od || !Array.isArray(b.od.pairs)) return (b.coreJobs = null);
    var core = set(b.sug.core), byHome = {}, total = 0;
    b.od.pairs.forEach(function (p) { if (!core[p[1]]) return; var j = +p[2] || 0; byHome[p[0]] = (byHome[p[0]] || 0) + j; total += j; });
    return (b.coreJobs = { byHome: byHome, total: total });
  }
  function single(b, g) {
    var k = g + '|' + b.ctx.tier;
    if (!(k in b.single)) { var m = measure(b, [g]); b.single[k] = m ? m.qualified : null; }
    return b.single[k];
  }

  // ---- compare market areas, let the reader pick (paul, 14 Nov 2026: "compare several market areas ... include their
  // capture rates for each ami and allow the user to pick") ----
  // The areas: the town's own tracts, the suggestion, the suggestion plus the next ring, the commute-shed, the whole
  // county, and the reader's own map edit. Each is held to four tests. The thresholds marked COHO are screening
  // judgments, not CHFA rules.
  // No area is recommended (paul, 15 Nov 2026, "build the six views"). Two are named instead: the suggestion is the
  // local market area, a town's own feasibility view, and the suggestion plus the next ring is the regional market
  // area, the wider view a CHFA reviewer reads. Until 15 Nov the smallest area passing all four tests was recommended,
  // which in a small town was the town alone. The local area is picked by default; any area but those two asks why.
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
    // The town's own tracts always hold the site's tract, even where it has under 10% of the town's homes, so no area
    // offered for this site leaves the site out.
    if (town) {
      var own = (town.rec.tracts || []).filter(function (r) { return town.rec.housing_units > 0 && r.housing_units / town.rec.housing_units >= TEST.townShare; }).map(function (r) { return r.tract_geoid; });
      var addSite = !!sug.siteGeoid && own.indexOf(sug.siteGeoid) < 0;
      add('town', 'Town’s own tracts', 'Tracts holding at least 10% of ' + town.name + '’s homes (2020 Census)' + (addSite ? ', plus the site’s own tract' : '') + '.',
        addSite ? own.concat([sug.siteGeoid]) : own, 'town-tracts');
    }
    var inSug = sug.tracts.filter(function (t) { return t.suggested; }).map(function (t) { return t.geoid; });
    add('suggested', 'Local market area', 'COHO’s suggested tracts: each tract’s reason is in the table below.', inSug, 'suggested-tracts');
    add('ring', 'Regional market area', 'The suggested tracts plus every tract whose centre is within ' + (core * 2) + ' miles of the site, across rivers and interstates.',
      inSug.concat(sug.tracts.filter(function (t) { return t.miles <= core * 2; }).map(function (t) { return t.geoid; })), 'suggested-plus-ring');
    if (sug.withCommutes) add('shed', 'Commute-shed', 'Adds every tract within ' + sug.reach + ' miles where at least 10% of working residents (and 50 or more) have a job within ' + core + ' miles of the site (LODES 2024).',
      inSug.concat(sug.tracts.filter(function (t) { return t.miles <= sug.reach && t.tie && t.tie.share >= TEST.shedTie && t.tie.toCore >= 50; }).map(function (t) { return t.geoid; })), 'commute-shed');
    // Drive-time areas: whole tracts by where their people live (2020 Census blocks, OpenStreetMap roads).
    if (sug.withBands) {
      var byShare = function (m, th) { return [sug.siteGeoid].concat(Object.keys(sug.shares).filter(function (g) { return sug.shares[g][BAND_AT[m]] >= th; })).filter(Boolean); };
      [10, 15, 20].forEach(function (m) {
        add('d' + m, 'Most people within ' + m + ' minutes', 'Every tract where at least half the people live within ' + m + ' minutes’ drive of the site, plus the site’s tract.', byShare(m, BEST.draw), 'drive-' + m);
      });
      add('q20', 'A quarter within 20 minutes', 'Every tract where at least a quarter of the people live within 20 minutes’ drive of the site, plus the site’s tract.', byShare(20, BEST.quarter), 'drive-20-quarter');
    }
    var cf = sug.siteGeoid ? sug.siteGeoid.slice(0, 5) : null, cName = (sug.tracts.filter(function (t) { return t.geoid === sug.siteGeoid; })[0] || {}).county || 'the county';
    if (cf) add('county', 'Whole county', 'Every tract in ' + cName + '.', Object.keys(b.ctx.s.x.demand.tracts || {}).filter(function (g) { return g.slice(0, 5) === cf; }), 'county');
    if (b.picked) add('map', 'Your area on the map', 'The tracts as you set them on the map above.', chosen(b), 'suggested-tracts-edited');
    out.forEach(function (a) { a.eval = evaluate(b, a, town); });
    recommend(out);
    var bf = bestFit(b, out);
    out.forEach(function (a) { a.best = a === bf; });
    b.areas = out; b.areasKey = key; b.best = bf;
    return out;
  }
  // The best fit for CHFA, by the stated rule (BEST); null without the people-by-road file or when no area qualifies.
  // The reader's own map edit is never the best fit: it is theirs to argue.
  function bestFit(b, list) {
    if (!b.sug.withBands) return null;
    var E = global.PMAMarketScoring, line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85;
    var ok = list.filter(function (x) {
      var c = x.eval.chfa, d = x.eval.ev.draw;
      return x.id !== 'map' && d != null && d >= BEST.draw && c.rateT != null && c.rateAll != null && c.rateT <= line && c.rateAll <= line;
    });
    if (!ok.length) return null;
    var low = Math.min.apply(null, ok.map(function (x) { return x.eval.chfa.rateAll; }));
    return ok.filter(function (x) { return x.eval.chfa.rateAll <= low + BEST.within + 1e-9; })
      .sort(function (x, y) { return x.list.length - y.list.length || x.eval.chfa.rateAll - y.eval.chfa.rateAll; })[0];
  }
  function areaById(b, id) { return areasFor(b).filter(function (x) { return x.ids.indexOf(id) > -1; })[0] || null; }
  // What is picked: the reader's choice; else the map's tracts once edited; else the best fit for CHFA (paul, 18 Nov
  // 2026); else, with no best fit, the local market area.
  function effectivePick(b) {
    if (b.pickId && areaById(b, b.pickId)) return areaById(b, b.pickId);
    if (b.picked) return areaById(b, 'map');
    var list = areasFor(b);
    return b.best && list.indexOf(b.best) > -1 ? b.best : areaById(b, 'suggested');
  }
  // The best fit and the local and regional market areas need no reason; they can be the same tracts.
  function isView(x) { return !!x && (!!x.best || x.ids.indexOf('suggested') > -1 || x.ids.indexOf('ring') > -1); }
  function viewTag(x) {
    var l = x.ids.indexOf('suggested') > -1, r = x.ids.indexOf('ring') > -1;
    return (x.best ? '<span class="tc-badge tc-badge-best">Best fit for CHFA</span>' : '') + (l ? '<span class="tc-badge">Local</span>' : '') + (r ? '<span class="tc-badge tc-badge-reg">Regional</span>' : '');
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
    // CHFA's own rate, with the comparable family tax credit homes already there, at each level and across all.
    var cr = chfaRate(b, area.list);
    CAP_TIERS.forEach(function (t) { var q = byTier[t].qualified; byTier[t].existing = cr.comp.by[t]; byTier[t].chfa = q > 0 ? (units + cr.comp.by[t]) / q : null; });
    var ev = evidence(b, area.list), withB = b.sug.withBands, band = b.sug.band;
    var mostOf = function (g) { var sh = b.sug.shares && b.sug.shares[g]; return !!sh && sh[BAND_AT[band]] >= BEST.draw; };
    // Test 2: every tract is near the site on its side, tied to it by jobs, or (with the people-by-road file) home to
    // people most of whom live within the drive band of the site.
    var loose = area.list.filter(function (g) {
      var t = b.byId[g];
      if (withB && mostOf(g)) return false;
      if (!t) return true;
      if (t.why === 'site' || t.why === 'near' || t.why === 'tied' || t.why === 'small') return false;
      return !(t.tie && t.tie.share >= TEST.shedTie && t.tie.toCore >= 50);
    });
    var farOut = loose.filter(function (g) { return !b.byId[g]; }).length, across = loose.filter(function (g) { return b.byId[g] && b.byId[g].across; }).length;
    var longD = withB ? loose.filter(function (g) { return !mostOf(g); }).length
      : b.sug.withDrive ? loose.filter(function (g) { var t = b.byId[g]; return t && t.drive != null && t.drive > b.sug.maxDrive; }).length : 0;
    // Test 3: no tract where another town holds most homes and has tax credit homes of its own.
    var others = {};
    area.list.forEach(function (g) {
      var tw = b.townOf[g];
      if (!tw || tw.share < TEST.otherTown || (town && tw.geoid === town.geoid) || !b.lihtc[g]) return;
      (others[tw.name] = others[tw.name] || []).push.apply(others[tw.name], b.lihtc[g]);
    });
    var otherNames = Object.keys(others).sort(function (x, y) { return others[y].length - others[x].length; });
    var tier = b.ctx.tier, cap = byTier[tier] ? byTier[tier].capture : null;
    var line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85, rT = cr.rateT, rA = cr.rateAll, lvl = 'all levels to ' + cr.top + '% AMI';
    var under = rT != null && rA != null && rT <= line && rA <= line;
    var tests = [
      { id: 'whole', pass: true, text: 'Whole census tracts, as CHFA’s Market Study Guide asks; no radius.' },
      { id: 'origin', pass: !loose.length, text: !loose.length
        ? 'Tenants could come from every tract: ' + (withB ? 'most of its people live within ' + band + ' minutes’ drive, or it is ' : 'each is ') + 'within ' + b.sug.coreMiles + ' miles' + (!withB && b.sug.withDrive ? ' and ' + b.sug.maxDrive + ' minutes’ drive' : '') + ' on the site’s side, tied to it by jobs, or one of the nearest tracts in a small town’s county.'
        : loose.length + ' of ' + area.list.length + ' tracts have little tie to the site' + (farOut || across || longD ? ' (' + [farOut ? farOut + ' beyond ' + b.sug.reach + ' miles' : '', longD ? longD + (withB ? ' where fewer than half the people live within ' + band + ' minutes’ drive' : ' more than ' + b.sug.maxDrive + ' minutes’ drive') : '', across ? across + ' across a river or interstate' : ''].filter(Boolean).join(', ') + ')' : '') + ': under 10% of their working residents have a job near it.' },
      { id: 'town', pass: !otherNames.length, text: !otherNames.length
        ? 'Takes in no other town’s tax credit market.'
        : 'Takes in the tax credit market of ' + otherNames.slice(0, 3).map(function (n) { return n + ' (' + others[n].length + (others[n].length === 1 ? ' property)' : ' properties)'); }).join(', ') + (otherNames.length > 3 ? ' and ' + (otherNames.length - 3) + ' more' : '') + '.' },
      // Test 4 is CHFA's own: its rate, with the comparable homes already there, at the project's level and across all
      // levels, at or under 85%. Within 10 points of the line is said, not failed.
      { id: 'capture', pass: under, text: rT == null
        ? 'No renter here qualifies for a ' + tier + '% AMI home, so there is no CHFA rate.'
        : (under ? 'CHFA’s rate is ' + p1(rT) + ' at ' + tier + '% AMI and ' + p1(rA) + ' across ' + lvl + ', with the ' + num(cr.existingAll) + ' comparable tax credit homes already there' + (rT > TEST.room || rA > TEST.room ? '; under CHFA’s 85% line, but within 10 points of it.' : '; both at least 10 points under CHFA’s 85% line.')
          : 'Over CHFA’s 85% line: ' + p1(rT) + ' at ' + tier + '% AMI, ' + p1(rA) + ' across ' + lvl + ', with the ' + num(cr.existingAll) + ' comparable tax credit homes already there.') }
    ];
    // An uncertain comparable count never decides the test silently: the caveat goes with the test, and where the count
    // could turn the result (homes left out behind a pass, Section 8 homes counted behind a fail) the test says so.
    var notes = compNotes(cr.comp), t4 = tests[3];
    if (notes.length && rT != null && rA != null) {
      var qa = cr.qAll, upAll = qa > 0 ? (units + cr.existingAll + cr.comp.none.units) / qa : null, downAll = qa > 0 ? (units + cr.existingAll - cr.comp.s8.units) / qa : null;
      t4.caveat = notes.join(' ');
      var downT = cr.qT > 0 ? (units + Math.max(0, cr.existingT - (cr.comp.s8.by[tier] || 0))) / cr.qT : null;
      var upT = cr.qT > 0 ? (units + cr.existingT + cr.comp.none.units) / cr.qT : null;
      // Homes with no AMI split could sit at any level, so a pass is uncertain if they could lift either rate over the line.
      t4.uncertain = under ? (cr.comp.none.units > 0 && (upAll > line || upT > line)) : (cr.comp.s8.units > 0 && downT <= line && downAll <= line);
      t4.text += ' Note: ' + t4.caveat + (t4.uncertain ? (under ? ' So this pass is not certain.' : ' So this fail is not certain.') : '');
    }
    return { byTier: byTier, pool: pool, existing: existing, projects: sup.lihtcCount || 0, pen: pen, supplyNotes: supplyNotes(sup), compNotes: notes, chfa: cr, ev: ev, tests: tests, passes: tests.filter(function (t) { return t.pass; }).length };
  }
  // Each area's one line: its first failed test, or that it passes all four. None is marked recommended.
  function recommend(list) {
    list.forEach(function (x) {
      x.recommended = false;
      var fail = x.eval.tests.filter(function (t) { return !t.pass; })[0];
      x.line = fail ? fail.text : 'Passes all four tests.';
    });
    return null;
  }

  function pc(x) { return x == null || !isFinite(x) ? '—' : Math.round(x * 100) + '%'; }
  // The best fit's card: its CHFA rate at the project's level and across all levels, the four reasons for its tracts,
  // and how the rule got there.
  function bestCard(b, list) {
    var s = b.sug, x = b.best, tier = b.ctx.tier, E = global.PMAMarketScoring, line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85;
    if (!s.withBands) return '<div class="tc-best tc-best-none"><p><strong>No best fit yet.</strong> The file of where each tract’s people live by road did not load, so the areas below are not ranked. The local market area is picked.</p></div>';
    var held = list.filter(function (a) { return a.id !== 'map' && a.eval.ev.draw != null && a.eval.ev.draw >= BEST.draw; });
    var okL = held.filter(function (a) { var c = a.eval.chfa; return c.rateT != null && c.rateAll != null && c.rateT <= line && c.rateAll <= line; });
    if (!x) return '<div class="tc-best tc-best-none"><p><strong>No best fit.</strong> ' + (held.length ? held.length + (held.length === 1 ? ' area holds' : ' areas hold') + ' most of the people within ' + s.band + ' minutes’ drive of the site, but none stays at or under CHFA’s 85% line at ' + tier + '% AMI and across all levels.' : 'No area below holds most of the people within ' + s.band + ' minutes’ drive of the site.') +
      ' The local market area is picked; an analyst would need more demand evidence, a smaller project, or another level.</p></div>';
    var c = x.eval.chfa, ev = x.eval.ev, low = okL.slice().sort(function (a, y) { return a.eval.chfa.rateAll - y.eval.chfa.rateAll; })[0];
    var why = [];
    if (ev.draw != null) why.push('<li><strong>Where people live.</strong> Holds ' + pc(ev.draw) + ' of everyone living within ' + s.band + ' minutes’ drive of the site (2020 Census blocks, OpenStreetMap roads). CHFA asks for the area the project draws most of its tenants from.</li>');
    if (ev.school != null && s.siteDistrict) why.push('<li><strong>School district.</strong> ' + pc(ev.school) + ' of its people live in the site’s district, ' + esc(s.siteDistrict.name) + '.</li>');
    if (ev.jobs != null) why.push('<li><strong>Jobs.</strong> Its residents hold ' + pc(ev.jobs) + ' of the ' + num(ev.jobsTotal) + ' jobs within ' + s.coreMiles + ' miles of the site (LODES 2024).</li>');
    if (ev.movers != null) why.push('<li><strong>Movers, for context.</strong> ' + p1(ev.movers) + ' of people in its rented homes moved in from another county, state or abroad last year (about ' + num(ev.moversPeople) + ', give or take ' + num(ev.moversMoe) + '; ACS 2020–2024). Not in the rate: CHFA counts in-migration only when comparable properties show it.</li>');
    return '<div class="tc-best"><p class="tc-best-head"><span class="tc-badge tc-badge-best">Best fit for CHFA</span> <strong>' + esc(x.label) + '</strong>, ' + x.list.length + (x.list.length === 1 ? ' whole tract' : ' whole tracts') + '</p>' +
      '<div class="tc-best-rates"><p><strong class="' + (c.rateT > line ? 'tc-over' : '') + '">' + p1(c.rateT) + '</strong><span class="note">CHFA rate at ' + tier + '% AMI</span></p>' +
      '<p><strong class="' + (c.rateAll > line ? 'tc-over' : '') + '">' + p1(c.rateAll) + '</strong><span class="note">all levels to ' + c.top + '% AMI</span></p></div>' +
      '<p class="note">(' + num(b.ctx.units) + ' new homes + ' + num(c.existingT) + ' comparable tax credit homes already at ' + tier + '% AMI) ÷ ' + num(c.qT) + ' renter households who qualify; across all levels, (' + num(b.ctx.units) + ' + ' + num(c.existingAll) + ') ÷ ' + num(c.qAll) + '. CHFA’s line is 85%.</p>' +
      '<p><strong>Why these tracts</strong></p><ul class="tc-best-why">' + why.join('') + '</ul>' +
      '<p class="note"><strong>How the pick was made.</strong> ' + held.length + ' of the ' + list.length + ' areas below hold at least half the people within ' + s.band + ' minutes’ drive; ' + okL.length + ' of those stay at or under 85% at ' + tier + '% AMI and across all levels. The lowest rate is ' + p1(low.eval.chfa.rateAll) + ' (' + esc(low.label) + '); the best fit is the area with the fewest tracts within 5 points of it. COHO’s screening rule, approved for this use; a CHFA-approved analyst draws the market area a study uses.</p>' +
      (x.eval.compNotes.length ? '<p class="note">Note: ' + esc(x.eval.compNotes.join(' ')) + '</p>' : '') + '</div>';
  }
  function drawCompare(b) {
    var host = b.el.querySelector('.tc-compare-body');
    var list = areasFor(b), tier = b.ctx.tier, s = b.sug;
    var E = global.PMAMarketScoring, line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85;
    var pa0 = effectivePick(b), pick = pa0 ? pa0.id : null;
    var cell = function (v, isTier, label) {
      if (v == null) return '<td class="num" data-label="' + esc(label) + '">—</td>';
      return '<td data-label="' + esc(label) + '" class="num' + (isTier ? ' tc-tier' : '') + (v > line ? ' tc-over' : '') + '">' + p1(v) + (v > line ? ' <span class="tc-flag">over</span>' : '') + '</td>';
    };
    var rows = list.map(function (x) {
      var ev = x.eval;
      return '<tr' + (isView(x) ? ' class="tc-rec"' : '') + '><th scope="row"><label class="tc-check"><input type="radio" name="tc-area" value="' + esc(x.id) + '"' + (x.id === pick ? ' checked' : '') + '> ' + esc(x.label) + '</label>' +
        viewTag(x) + '<span class="note tc-sub">' + x.list.length + (x.list.length === 1 ? ' tract. ' : ' tracts. ') + esc(x.note) + (x.alias.length ? ' Same tracts as: ' + esc(x.alias.join(', ')) + '.' : '') + '</span></th>' +
        (s.withBands ? '<td class="num" data-label="Holds of ' + s.band + '-minute draw">' + pc(ev.ev.draw) + '</td>' : '') +
        CAP_TIERS.map(function (t) { return cell(ev.byTier[t].chfa, t === tier, t + '% AMI'); }).join('') +
        cell(ev.chfa.rateAll, false, 'All levels to ' + ev.chfa.top + '%').replace('</td>', ev.compNotes.length ? ' <span class="tc-flag tc-flag-note">note</span></td>' : '</td>') +
        cell(ev.pen, false, 'Penetration').replace('</td>', ev.supplyNotes.length && ev.pen != null ? ' <span class="tc-flag tc-flag-note">supply note</span></td>' : '</td>') +
        '<td data-label="Tests" class="tc-tests">' + ev.tests.map(function (t) { return '<span class="' + (t.pass ? 'tc-pass' : 'tc-fail') + '" title="' + esc(t.text) + '">' + (t.pass ? '✓' : '✗') + ' ' + ({ whole: 'Whole tracts', origin: 'Tenants could come from here', town: 'No other town’s market', capture: 'At or under 85%, CHFA rate' })[t.id] + (t.uncertain ? ', not certain' : '') + '</span>'; }).join('') + '</td></tr>';
    }).join('');
    var loc = areaById(b, 'suggested'), reg = areaById(b, 'ring');
    var why = loc ? '<div class="tc-why"><p><strong>Three readings.</strong> The <strong>best fit for CHFA</strong>, when there is one, is picked by the rule above. The <strong>local market area</strong> (' + loc.list.length + (loc.list.length === 1 ? ' tract' : ' tracts') + ') reads the site the way a town reads its own need: tight, near, on the site’s side of rivers and interstates. ' +
      (reg && reg !== loc ? 'The <strong>regional market area</strong> (' + reg.list.length + ' tracts) takes every tract within ' + (s.coreMiles * 2) + ' miles, across rivers and interstates.' : 'Here the regional market area is the same tracts: no tract centre lies between ' + s.coreMiles + ' and ' + (s.coreMiles * 2) + ' miles that the local area leaves out.') +
      ' None is a CHFA market area until an analyst draws one.</p>' +
      '<p><strong>How each area does on the four tests:</strong></p><ul>' + list.map(function (x) { return '<li><strong>' + esc(x.label) + ':</strong> ' + esc(x.line) + (x.eval.tests[3].uncertain ? ' The rate test rests on a count of comparable homes that may be off.' : '') + '</li>'; }).join('') + '</ul></div>' : '';
    var noted = list.filter(function (x) { return (x.eval.supplyNotes.length && x.eval.pen != null) || x.eval.compNotes.length; });
    var notesList = noted.length ? '<div class="tc-supply-note"><p><strong>Notes on the counts.</strong> CHFA’s rate counts comparable family tax credit homes at each level; penetration counts every tax credit home, as the full Market Analysis does. Some counts are uncertain:</p><ul>' +
      noted.map(function (x) { return '<li><strong>' + esc(x.label) + ':</strong> ' + esc(x.eval.compNotes.concat(x.eval.pen != null ? x.eval.supplyNotes : []).join(' ')) + '</li>'; }).join('') + '</ul></div>' : '';
    var diff = !!pa0 && !isView(pa0);
    var form = '<div class="tc-pickform"><p class="tc-picked" aria-live="polite">' + (pick ? 'Picked: <strong>' + esc((areaById(b, pick) || {}).label || '') + '</strong>.' : '') + '</p>' +
      (diff ? '<label for="tc-why">Why this area instead of the best fit, local or regional one? <span class="note">(saved with the pick; needed to use it)</span></label><textarea id="tc-why" name="tc-why" rows="3" data-tc-why>' + esc(b.pickWhy || '') + '</textarea>' : '') +
      '<div class="actions"><button type="button" class="button-link" data-tc-usepick' + (diff && !(b.pickWhy || '').trim() ? ' disabled' : '') + '>Use the picked area in a project</button></div></div>';
    host.innerHTML = bestCard(b, list) +
      '<p>CHFA’s rate for a ' + num(b.ctx.units) + '-home project with every home at each AMI level: (the new homes + comparable tax credit homes already there at that level) ÷ renter households who qualify. The project’s level, ' + tier + '% AMI, and all levels together are the ones the tests use. Cells over CHFA’s 85% line are marked.</p>' +
      '<div class="tc-compare-wrap"><table class="data-table tc-compare-table"><caption>Market areas round the site, smallest first</caption><thead><tr><th scope="col">Area</th>' +
      (s.withBands ? '<th scope="col" class="num">Holds of ' + s.band + '-min draw</th>' : '') +
      CAP_TIERS.map(function (t) { return '<th scope="col" class="num' + (t === tier ? ' tc-tier' : '') + '">' + t + '% AMI</th>'; }).join('') + '<th scope="col" class="num">All levels</th><th scope="col" class="num">Penetration</th><th scope="col">Tests</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      notesList + why + form +
      '<p class="note">The four tests: 1. whole census tracts, as CHFA’s Market Study Guide asks (Appendix A to the <a href="' + MSG + '" rel="noopener">2027–28 QAP</a>); 2. tenants could plausibly come from every tract (' + (s.withBands ? 'most of its people within ' + s.band + ' minutes’ drive, or ' : '') + 'near the site on its side' + (!s.withBands && s.withDrive ? ' and within ' + s.maxDrive + ' minutes’ drive' : '') + ', or at least 10% of working residents with a job near it, LODES 2024); 3. no tract where another town holds most homes and has tax credit homes of its own (2020 Census homes by town and tract); 4. CHFA’s rate at the project’s level and across all levels at or under 85%. Tests 2 and 3 and their thresholds are COHO’s screening judgments, not CHFA rules. ' +
      (s.withBands ? 'Drive shares count 2020 Census block population, grouped in cells of about 2 km and routed by road (free-flow OpenStreetMap times) from the 2020 population centre nearest the site. ' : s.withDrive ? 'Drive times are free-flow OpenStreetMap times from each tract’s 2020 population centre to the one nearest the site. ' : 'The drive-time files did not load, so drive times are not checked. ') +
      'Comparable homes: CHFA’s property list, each property’s homes at each level times its share of family homes. Penetration: every tax credit home, ' + 'over renter households who qualify at 20 to 80% AMI.</p>';
  }
  // True when the reader picked an area other than the local or regional one and has not said why.
  function needsReason(site) {
    var b = site && boxes[keyOf(site)], pa = pickedArea(site);
    if (!b || !pa) return false;
    return !isView(pa) && !(b.pickWhy || '').trim();
  }
  // The picked area, for the project form and the saved record.
  function pickedArea(site) {
    var b = site && boxes[keyOf(site)];
    if (!b || !b.sug) return null;
    return effectivePick(b);
  }

  // ---- who could rent here: six views, from the town's own renters out to the county (paul, 15 Nov 2026: "a
  // conservative study that looks at refined feasibility, local demand more ... capture of residents only too, to give
  // jurisdictions a clear view of their individual needs ... plus incommuters gives a local demand"; "we need regional
  // plus in commuters too"; "build the six views") ----
  // 1. Town residents only: each tract's renter households who qualify (the capture engine), times the share of the tract
  //    in the town, scaled to the town's ACS renter count. The share and the scaling are the needs assessment's own
  //    (data/hna/place-chas.json: the larger of the tract's area share and its population share, data/hna/
  //    place-tract-membership.json and place-lehd.json).
  // 2. Plus in-commuters: the needs assessment's own count of in-commuting workers' households by AMI band who would
  //    move closer to work (data/hna/workforce-need.json, LODES 2024, the 25% move-closer share; 50% is shown as the
  //    high case). Their tenure is not known, so they are counted as workers' households, never as renters.
  // 3. Local market area: the suggested tracts (or the map's), as the box's own figures.
  // 4. Regional market area: the suggested tracts plus every tract within twice the core distance, across rivers and
  //    interstates; the wider view a CHFA reviewer reads.
  // 5. Regional plus in-commuters: workers whose job is in the regional tracts and whose home is outside them and more
  //    than 15 miles from the site (LODES 2024 tract flows, in-state homes only), at the town's own households-per-
  //    in-commuter rate for each band and the same 25% share. Anyone already living in the regional tracts is left
  //    out, so nobody is counted twice; so is a short cross-town commute, which gives little reason to move.
  // 6. The whole county.
  // The bars show capture for all homes at the project's level (the default) or at any level from 30 to 80% AMI.
  var VIEW = { move: 0.25, high: 0.5, farMiles: 15 };
  var ANY_BANDS = ['30_50', '50_60', '60_80'];
  // The workforce file counts in-commuters in pay bands that end at 30, 50, 60 and 80% AMI. A level that is not a band's
  // top (40 or 70% AMI) has no band of its own, so the in-commuter views give no figure there rather than count
  // households above the ceiling (Codex, 15 Nov 2026).
  function bandOf(t) { return { 30: 'le30', 50: '30_50', 60: '50_60', 80: '60_80' }[t] || null; }
  // The engine's own count, or null with its reason (no usable CHFA limits, or tracts without CHAS or PUMS cover):
  // a missing count stays missing, never a measured zero, as measure() keeps it (Codex, 15 Nov 2026).
  function qual(b, list, tiers) {
    var E = global.PMAMarketScoring, s = b.ctx.s;
    if (!E || !list.length) return null;
    var r = E.chfaQualifiedRenters(s.x.demand, limitsOf(s), list.map(function (g) { return { geoid: g }; }), tiers, undefined, engineOpts(s.x));
    if (r.value == null) { if (r.reason && b.viewWhy && b.viewWhy.indexOf(r.reason) < 0) b.viewWhy.push(r.reason); return null; }
    return r.value;
  }
  // A sum that stays null when either part is unknown.
  function plusN(x, y) { return x == null || y == null ? null : x + y; }
  // Tax credit homes already in some tracts, with the supply engine's own caveats (a property counted at all its units,
  // or one left out for no count), as measure() and evaluate() keep them (Codex, 15 Nov 2026).
  function supplyIn(b, list) {
    var S = global.PMAAffordableSupply, feats = [];
    list.forEach(function (g) { if (b.lihtc[g]) feats = feats.concat(b.lihtc[g]); });
    if (!feats.length || !S) return { units: 0, notes: [] };
    var sup = S.summarizeAffordableSupply(feats, []);
    return { units: sup.lihtcUnits || 0, notes: supplyNotes(sup) };
  }
  function addNotes(into, notes) { notes.forEach(function (n) { if (into.indexOf(n) < 0) into.push(n); }); return into; }
  // The town's renters who qualify, apportioned the needs assessment's way. Null when the site is not in a town the
  // files cover.
  function residents(b, town) {
    var pf = b.pf, g = town && town.geoid, tier = b.ctx.tier;
    if (!pf || !g) return null;
    var m = pf.memb && pf.memb.places && pf.memb.places[g], pl = pf.pop && pf.pop.places && pf.pop.places[g], pc = pf.renters && pf.renters.places && pf.renters.places[g];
    if (!m || !pl || !pc || !pc.summary || !(pc.summary.total_renter_hh > 0) || !(pl.place_pop > 0)) return null;
    var idx = engineOpts(b.ctx.s.x).acsIdx || {}, rent = 0, qT = 0, qA = 0, qP = 0, ex = 0, seen = 0, notes = [];
    (m.tracts || []).forEach(function (t) {
      var a = idx[t.tract_geoid];
      if (!a) return;
      var ps = a.pop > 0 ? pl.place_pop * (t.share_of_place_area || 0) / a.pop : 0;
      var w = Math.min(1, Math.max(t.share_of_tract_area || 0, ps));
      if (!(w > 0)) return;
      var sup = supplyIn(b, [t.tract_geoid]);
      ex += w * sup.units; addNotes(notes, sup.notes);
      // A tract the engine has no count for (no CHAS or PUMS cover) is left out of both sides of the scaling, as the
      // engine leaves it out of an area; when no tract has a count, the town's count is unknown, not zero.
      var x = qual(b, [t.tract_geoid], [tier]), y = qual(b, [t.tract_geoid], CAP_TIERS), z = qual(b, [t.tract_geoid], PEN_TIERS);
      seen++;
      if (x == null || y == null || z == null) return;
      rent += w * (a.renter_hh || 0);
      qT += w * x; qA += w * y; qP += w * z;
    });
    if (seen && !(rent > 0)) return { renters: pc.summary.total_renter_hh, qT: null, qA: null, pool: null, existing: ex, supplyNotes: notes };
    if (!(rent > 0)) return null;
    var k = pc.summary.total_renter_hh / rent;
    return { renters: pc.summary.total_renter_hh, qT: qT * k, qA: qA * k, pool: qP * k, existing: ex, supplyNotes: notes };
  }
  // In-commuters by band, from the town's record (or the county's, for a site outside a town).
  function workforce(b, town) {
    var wf = b.pf && b.pf.wf;
    if (!wf) return null;
    var r = town && wf.places && wf.places[town.geoid], cf = b.sug.siteGeoid ? b.sug.siteGeoid.slice(0, 5) : null;
    var from = r ? 'town' : 'county';
    if (!r && cf && wf.counties) r = wf.counties[cf];
    var by = r && r.present_incommuter_need_by_ami;
    if (!by || !(r.incommuters > 0)) return null;
    return { by: by, incommuters: r.incommuters, from: from, name: r.name || '' };
  }
  // Workers with a job in the area and a home outside it, more than 15 miles from the site (LODES tract flows).
  function farWorkers(b, list) {
    var key = list.join('.');
    if (b.farKey === key) return b.far;
    var inA = set(list), C = {}, site = b.ctx.site, n = 0, all = 0;
    ((b.data.cent && b.data.cent.tracts) || []).forEach(function (t) { C[String(t.geoid)] = t; });
    if (!b.od || !Array.isArray(b.od.pairs)) return null;
    b.od.pairs.forEach(function (p) {
      if (!inA[p[1]] || inA[p[0]]) return;
      var j = +p[2] || 0, h = C[p[0]];
      all += j;
      if (h && h.lat != null && miles(site, h) > VIEW.farMiles) n += j;
    });
    b.farKey = key; b.far = { far: n, outside: all };
    return b.far;
  }
  function views(b) {
    var ctx = b.ctx, units = ctx.units, tier = ctx.tier, town = siteTown(b), out = [];
    b.viewWhy = [];
    var area = function (list) {
      var sup = supplyIn(b, list);
      return { qT: qual(b, list, [tier]), qA: qual(b, list, CAP_TIERS), pool: qual(b, list, PEN_TIERS), existing: sup.units, supplyNotes: sup.notes };
    };
    var wf = workforce(b, town), band = bandOf(tier);
    // t is null where the project's level has no band of its own.
    var add = function (scale) { return wf ? { t: band ? (wf.by[band] || 0) * scale : null, a: ANY_BANDS.reduce(function (s, k) { return s + (wf.by[k] || 0); }, 0) * scale } : null; };
    var plus = plusN;
    var noBand = function () { return 'In-commuters are counted in pay bands that end at 30, 50, 60 and 80% AMI, so there is no figure for ' + tier + '% AMI homes. Switch to any level, 30\u201380% AMI'; };
    var r = residents(b, town);
    if (r) {
      out.push({ id: 'residents', label: 'Town residents only', tag: 'local', who: function (q) { return num(q) + ' ' + town.name + ' renter households qualify'; }, qT: r.qT, qA: r.qA, pool: r.pool, existing: r.existing, supplyNotes: r.supplyNotes });
      if (wf && wf.from === 'town') {
        var a = add(1), hi = add(VIEW.high / VIEW.move);
        out.push({ id: 'residents-ic', label: 'Residents plus in-commuters', tag: 'local', ic: true,
          who: function (q, mode) { return mode !== 'any' && a.t == null ? noBand() : num(mode === 'any' ? r.qA : r.qT) + ' renter households + ' + num(mode === 'any' ? a.a : a.t) + ' workers’ households who could move in'; },
          rT: r.qT, rA: r.qA, qT: plus(r.qT, a.t), qA: plus(r.qA, a.a), pool: plus(r.pool, a.a), existing: r.existing, supplyNotes: r.supplyNotes,
          high: { qT: plus(r.qT, hi.t), qA: plus(r.qA, hi.a) } });
      }
    }
    var loc = chosen(b), L = area(loc);
    out.push({ id: 'local', label: b.picked ? 'Your market area' : 'Local market area', tag: 'local', picked: true, who: function (q) { return num(q) + ' renter households in ' + loc.length + (loc.length === 1 ? ' tract' : ' tracts') + (b.picked ? ', as set on the map' : ' round the site'); }, qT: L.qT, qA: L.qA, pool: L.pool, existing: L.existing, supplyNotes: L.supplyNotes });
    var ring = areaById(b, 'ring'), R = ring ? area(ring.list) : null;
    if (ring) {
      out.push({ id: 'regional', label: 'Regional market area', tag: 'regional', who: function (q) { return num(q) + ' renter households in ' + ring.list.length + ' tracts within ' + (b.sug.coreMiles * 2) + ' miles' + (ring === areaById(b, 'suggested') ? ', the same tracts as the local area' : ''); }, qT: R.qT, qA: R.qA, pool: R.pool, existing: R.existing, supplyNotes: R.supplyNotes });
      var fw = wf && farWorkers(b, ring.list);
      if (fw) {
        var per = function (k) { return (wf.by[k] || 0) / wf.incommuters; };
        var rt = band ? fw.far * per(band) : null, ra = fw.far * ANY_BANDS.reduce(function (s, k) { return s + per(k); }, 0);
        out.push({ id: 'regional-ic', label: 'Regional plus in-commuters', tag: 'regional', ic: true, far: fw,
          who: function (q, mode) { return mode !== 'any' && rt == null ? noBand() : num(mode === 'any' ? R.qA : R.qT) + ' renter households + ' + num(mode === 'any' ? ra : rt) + ' workers’ households from 15+ miles away who could move in'; },
          rT: R.qT, rA: R.qA, qT: plus(R.qT, rt), qA: plus(R.qA, ra), pool: plus(R.pool, ra), existing: R.existing, supplyNotes: R.supplyNotes });
      }
    }
    var cty = areaById(b, 'county');
    if (cty) { var K = area(cty.list); out.push({ id: 'county', label: 'Whole county', tag: null, who: function (q) { return num(q) + ' renter households in ' + cty.list.length + ' tracts'; }, qT: K.qT, qA: K.qA, pool: K.pool, existing: K.existing, supplyNotes: K.supplyNotes }); }
    out.forEach(function (v) {
      v.capT = v.qT > 0 ? units / v.qT : null; v.capA = v.qA > 0 ? units / v.qA : null;
      v.pen = v.pool > 0 ? (v.existing + units) / v.pool : null;
      if (v.high) { v.high.capT = v.high.qT > 0 ? units / v.high.qT : null; v.high.capA = v.high.qA > 0 ? units / v.high.qA : null; }
    });
    return { list: out, town: town, wf: wf, residents: !!r, why: b.viewWhy.slice() };
  }
  function drawViews(b) {
    var host = b.el.querySelector('.tc-views-body');
    if (!host || !b.sug) return;
    var E = global.PMAMarketScoring, line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85, ctx = b.ctx, mode = b.vmode === 'any' ? 'any' : 'tier';
    var V = views(b);
    b.views = V;
    var lw = (line / 1.2 * 100).toFixed(1);
    var cards = V.list.map(function (v) {
      var cap = mode === 'any' ? v.capA : v.capT, q = mode === 'any' ? v.qA : v.qT;
      var w = cap == null ? 0 : Math.min(cap / 1.2, 1) * 100, over = cap != null && cap > line;
      var hi = v.high ? (mode === 'any' ? v.high.capA : v.high.capT) : null;
      return '<li class="tc-v' + (v.picked ? ' tc-v-pick' : '') + '" data-view="' + v.id + '"><div class="tc-v-head"><p class="tc-v-name"><strong>' + esc(v.label) + '</strong>' +
        (v.tag === 'local' ? ' <span class="tc-vtag">Local</span>' : v.tag === 'regional' ? ' <span class="tc-vtag tc-vtag-reg">Regional</span>' : '') + '</p>' +
        '<p class="tc-v-num"><strong' + (over ? ' class="tc-over"' : '') + '>' + (cap == null ? '—' : p1(cap)) + '</strong> <span class="note">capture' + (v.pen != null ? ' · penetration ' + p1(v.pen) + (v.supplyNotes.length ? ' <span class="tc-flag tc-flag-note">supply note</span>' : '') : '') + '</span></p></div>' +
        '<p class="note tc-v-who">' + esc(((mode === 'any' ? ('rA' in v ? v.rA : v.qA) : ('rT' in v ? v.rT : v.qT)) == null ? 'No count of renter households who qualify here' + (V.why.length ? ': ' + V.why.join(' ') : '') : v.who(q, mode))) + (hi != null ? '. If half of in-commuters would move: ' + p1(hi) + ' capture' : '') + '.' +
        (v.supplyNotes.length && v.pen != null ? ' Supply note on penetration: ' + esc(v.supplyNotes.join(' ')) : '') + '</p>' +
        '<div class="cap-track tc-v-track" role="img" aria-label="' + esc(v.label + ': capture ' + (cap == null ? 'not available' : p1(cap)) + ', against CHFA’s 85% line') + '"><span class="cap-fill' + (over ? ' cap-over' : '') + '" style="width:' + w.toFixed(1) + '%"></span><span class="cap-line tc-v-line" style="left:' + lw + '%"></span></div></li>';
    }).join('');
    var lead = 'Six ways to draw the market for these ' + num(ctx.units) + ' homes, from the town’s own renters out to the county. A town reading its own need starts at the top; for a CHFA application, see the best fit under Compare market areas. Every count is renter households who qualify under CHFA’s rules, except in-commuters, whose tenure is not known.';
    if (!V.residents) lead += b.pfDone ? (V.town ? ' The town files did not cover ' + V.town.name + ', so the two town views are left out.' : ' The site is not in a town, so the two town views are left out.') : ' The town views are still loading.';
    var src = b.data.sources;
    host.innerHTML = '<p>' + esc(lead) + '</p>' +
      '<div class="tc-vmode" role="group" aria-label="Which homes the capture counts"><button type="button" class="button-link' + (mode === 'tier' ? '' : ' secondary') + '" data-tc-vmode="tier" aria-pressed="' + (mode === 'tier') + '">All ' + num(ctx.units) + ' at ' + ctx.tier + '% AMI</button>' +
        '<button type="button" class="button-link' + (mode === 'any' ? '' : ' secondary') + '" data-tc-vmode="any" aria-pressed="' + (mode === 'any') + '">Any level, 30–80% AMI</button></div>' +
      '<ul class="tc-vlist">' + cards + '</ul>' +
      '<p class="note">Black mark: CHFA’s 85% line (<a href="' + MSG + '" rel="noopener">2027–28 QAP</a>). Capture = homes ÷ households who qualify. Penetration = (tax credit homes already there + these) ÷ renter households who qualify at 20 to 80% AMI, plus in-commuters’ households at 30 to 80%. ' +
        'In-commuters: ' + (V.wf ? 'a quarter of the people who work in ' + (V.wf.from === 'town' && V.town ? V.town.name : 'the county') + ' but live elsewhere, as households, by pay (LEHD LODES 2024; the needs assessment’s move-closer share)' : 'the workforce file did not load') +
        '; for the regional view, a quarter of those whose job is in its tracts and who live more than ' + VIEW.farMiles + ' miles from the site, at the same rate per worker. Out-of-state homes are not in the tract flows. ' +
        'Town residents: the needs assessment’s share of each tract in the town, scaled to the town’s ACS renter count (HUD CHAS 2018–2022, Census ACS 5-year). The local and regional areas are COHO screening views, not CHFA market areas.</p>' +
      '<p class="metric-source">' + [
        '<a href="https://lehd.ces.census.gov/data/" rel="noopener">LEHD LODES ' + esc((src.od && src.od.vintage) || '2024') + '</a>',
        '<a href="https://www.huduser.gov/portal/datasets/cp.html" rel="noopener">HUD CHAS 2018–2022</a>',
        '<a href="https://www.census.gov/programs-surveys/acs" rel="noopener">Census ACS 5-year</a>',
        '<a href="https://www.chfainfo.com/rental-housing/housing-credit" rel="noopener">CHFA Housing Tax Credit property list</a>'
      ].join(' · ') + '</p>';
  }

  // ---- drawing ----
  function meter(label, v, note, line) {
    var w = Math.min(v / 1.2, 1) * 100, lw = line / 1.2 * 100;
    return '<div class="cap-row"><p class="cap-label">' + esc(label) + ' <strong>' + p1(v) + '</strong></p>' +
      '<div class="cap-track" role="img" aria-label="' + esc(label + ' ' + p1(v) + ', against the 85% line') + '"><span class="cap-fill' + (v > line ? ' cap-over' : '') + '" style="width:' + w.toFixed(1) + '%"></span><span class="cap-line" style="left:' + lw.toFixed(1) + '%"></span></div>' +
      '<p class="note">' + esc(note) + '</p></div>';
  }
  // The head's figures follow the area that is picked, so what the page shows is what a project or the full Market
  // Analysis gets: the map's tracts once edited, else the picked area (by default the best fit for CHFA).
  function headArea(b) {
    if (b.picked) return null;
    var pa = effectivePick(b);
    return pa && pa.ids.indexOf('suggested') < 0 && pa.ids.indexOf('map') < 0 ? pa : null;
  }
  function draw(b) {
    drawHead(b);
    drawPanel(b);
    drawViews(b);
    drawCompare(b);
    drawTable(b);
    drawHow(b);
    paint(b);
    curve(b);
  }
  function drawHead(b) {
    var ctx = b.ctx, pa = headArea(b), list = pa ? pa.list.slice() : chosen(b), m = measure(b, list), E = global.PMAMarketScoring;
    var line = (E && E.CHFA_CAPTURE_LIMIT) || 0.85;
    b.now = m; b.count = list.length; b.nowLabel = pa ? (pa.best ? 'the best fit for CHFA (' + pa.label + ')' : 'the picked area (' + pa.label + ')') : null;
    var nSug = b.sug.tracts.filter(function (t) { return t.suggested; }).length;
    var head = b.picked ? 'Your market area: ' + list.length + (list.length === 1 ? ' tract' : ' tracts') + ' (the suggestion had ' + nSug + ').'
      : pa ? (pa.best ? 'Best fit for CHFA: ' : 'Picked area: ') + pa.label + ', ' + list.length + (list.length === 1 ? ' whole census tract' : ' whole census tracts') + '. The map shows the local market area (' + nSug + (nSug === 1 ? ' tract' : ' tracts') + '); the comparison below has every area.'
      : 'Suggested market area: ' + list.length + (list.length === 1 ? ' whole census tract' : ' whole census tracts') + ' round the site.';
    var ans = !list.length ? head + ' Add a tract on the map to see a capture rate.'
      : !m || m.capture == null ? head + ' No capture rate: ' + ((m && m.reason) || 'no renter household here qualifies under CHFA’s rules') + '.'
      : head + ' A ' + num(ctx.units) + '-home project at ' + ctx.tier + '% AMI would need ' + p1(m.capture) + ' of the ' + num(m.qualified) + ' renter households there who qualify; with the ' + num(m.comparable) + ' comparable tax credit homes already there, CHFA’s rate is ' + p1(m.chfa) + '.';
    b.el.querySelector('.tc-answer').textContent = ans;
    b.el.querySelector('.tc-meters').innerHTML = m && m.capture != null
      ? meter('CHFA rate, ' + ctx.tier + '% AMI', m.chfa, '(' + num(ctx.units) + ' new homes + ' + num(m.comparable) + ' comparable family tax credit homes already at ' + ctx.tier + '% AMI) ÷ ' + num(m.qualified) + ' renter households in these tracts who qualify, as CHFA’s Market Study Guide counts it.' + (m.compNotes.length ? ' Note: ' + m.compNotes.join(' ') : ''), line) +
        meter('Capture rate, the new homes alone', m.capture, num(ctx.units) + ' homes ÷ ' + num(m.qualified) + ' renter households in these tracts who qualify for a ' + ctx.tier + '% AMI home.', line) +
        (m.pen != null ? meter('Penetration, all tax credit homes', m.pen, '(' + num(m.existing) + ' existing in ' + num(m.projects) + (m.projects === 1 ? ' property' : ' properties') + ' + ' + num(ctx.units) + ' proposed) ÷ ' + num(m.pool) + ' renter households who qualify at 20 to 80% AMI.' + (m.supplyNotes.length ? ' Supply note: ' + m.supplyNotes.join(' ') : ''), line) : '')
      : '';
    b.el.querySelector('[data-tc-reset]').hidden = !b.picked;
    // The Market check's head shows these same counts (site/market.js, siteFacts): tell it they changed.
    try { doc.dispatchEvent(new global.CustomEvent('tc:drawn', { detail: { key: b.key } })); } catch (e) { /* no CustomEvent: the head keeps its last figures */ }
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
      (reasonsOf(b, t) ? '<p class="note">' + esc(reasonsOf(b, t)) + '</p>' : '') +
      '<p>' + num(q) + ' renter households here qualify for a ' + b.ctx.tier + '% AMI home' + (b.lihtc[g] ? '; ' + b.lihtc[g].length + (b.lihtc[g].length === 1 ? ' tax credit property' : ' tax credit properties') + ' here.' : '.') + '</p>' +
      '<p class="tc-panel-what">' + (inNow ? 'Taking it out:' : 'Adding it:') + '</p><ul class="tc-panel-change">' +
        change('Capture rate', a && a.capture, z && z.capture) + change('Penetration', a && a.pen, z && z.pen) + '</ul>' +
      '<div class="actions"><button type="button" class="button-link" data-tc-toggle="' + esc(g) + '">' + (inNow ? 'Take it out' : 'Add it') + '</button></div>';
  }

  // One tract's reasons in a line: people by road, school district, job tie, movers.
  function reasonsOf(b, t) {
    var s = b.sug, out = [];
    if (t.bands) out.push('People within 10, 15 and 20 minutes’ drive of the site: ' + t.bands.map(pc).join(', ') + '.');
    if (t.school != null && s.siteDistrict) out.push(pc(t.school) + ' in the site’s school district (' + s.siteDistrict.name + ').');
    if (t.tie && t.tie.workers) out.push(pc(t.tie.share) + ' of working residents have a job within ' + s.coreMiles + ' miles of the site.');
    if (t.movers && t.movers.share != null) out.push(p1(t.movers.share) + ' of people in rented homes moved in from another county, state or abroad last year (about ' + num(t.movers.outside) + ', give or take ' + num(t.movers.moe) + ').');
    return out.join(' ');
  }
  function drawTable(b) {
    var s = b.sug;
    var rows = s.order.map(function (g) {
      var t = b.byId[g], on = isIn(b, g);
      return '<tr' + (g === b.focus ? ' class="tc-focus"' : '') + '><td><label class="tc-check"><input type="checkbox" name="tc-in" value="' + esc(g) + '"' + (on ? ' checked' : '') + '> ' + esc(t.name) + '</label><span class="note"> ' + esc(t.county) + '</span></td>' +
        '<td data-label="Suggested">' + (t.suggested ? 'In' : 'Out') + '</td><td data-label="Why">' + esc(t.reason) + '</td>' +
        (s.withBands ? '<td class="num" data-label="People within ' + s.band + ' min">' + pc(t.bands[BAND_AT[s.band]]) + '</td>' : '') +
        (s.withSchools ? '<td class="num" data-label="In the site’s school district">' + pc(t.school) + '</td>' : '') +
        (s.withCommutes ? '<td class="num" data-label="Job near the site">' + (t.tie && t.tie.workers ? pc(t.tie.share) : '—') + '</td>' : '') +
        (s.withMovers ? '<td class="num" data-label="Renters who moved in">' + (t.movers && t.movers.share != null ? p1(t.movers.share) : '—') + '</td>' : '') +
        '<td class="num" data-label="Renters who qualify">' + num(single(b, g)) + '</td></tr>';
    }).join('');
    b.el.querySelector('.tc-table-body').innerHTML = '<div class="tc-table-wrap"><table class="data-table"><caption>Every tract within ' + s.reach + ' miles of the site' + (s.withBands ? ', or with a quarter of its people within 20 minutes’ drive' : '') + '. Tick a tract to put it in the market area.</caption>' +
      '<thead><tr><th scope="col">Tract</th><th scope="col">Suggested</th><th scope="col">Why</th>' +
      (s.withBands ? '<th scope="col" class="num">People within ' + s.band + ' min drive</th>' : '') +
      (s.withSchools ? '<th scope="col" class="num">In ' + esc(s.siteDistrict.name) + '</th>' : '') +
      (s.withCommutes ? '<th scope="col" class="num">Working residents with a job within ' + s.coreMiles + ' mi</th>' : '') +
      (s.withMovers ? '<th scope="col" class="num">Renters who moved in last year</th>' : '') +
      '<th scope="col" class="num">Renters who qualify, ' + b.ctx.tier + '% AMI</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">People by road: 2020 Census block population, routed by OpenStreetMap roads. School districts: Census TIGER 2024. Jobs: LEHD LODES 2024. Movers: Census ACS 2020–2024 table B07013, people (not households) in rented homes who lived in another county, state or abroad a year earlier; tract margins are wide, and CHFA counts in-migration only when comparable properties show it.</p>';
  }

  function drawHow(b) {
    var s = b.sug, src = b.data.sources;
    var line = function (t, u) { return u ? '<a href="' + esc(u) + '" rel="noopener">' + esc(t) + '</a>' : esc(t); };
    b.el.querySelector('.tc-how').innerHTML =
      '<p class="note"><strong>How COHO suggests the tracts.</strong> The tract the site is in; tracts whose centre is within ' + s.coreMiles + ' miles' + (s.city ? ' (2 in a city, where 25 or more tract centres sit within 3 miles)' : ' (the full Market Analysis pre-selects the same 4 miles)') +
      (s.withBands ? ', unless fewer than half its people live within ' + s.band + ' minutes’ drive' : s.withDrive ? ', unless the drive is longer than ' + s.maxDrive + ' minutes' : '') + '; farther tracts, out to ' + s.reach + ' miles, where at least a quarter of the working residents, and at least 50 of them, have a job within ' + s.coreMiles + ' miles of the site; nothing across an interstate, a river or a named lake unless that jobs tie holds' + (s.withBands ? ' or roads cross it (most of its people within ' + s.band + ' minutes’ drive)' : '') + '; and at least 3 tracts' + (s.withDrive ? ', adding the nearest in the county within ' + RULES.smallDrive + ' minutes\u2019 drive' : '') + '. ' +
      'These are COHO’s screening rules, not CHFA’s. CHFA asks for whole tracts and a written reason for the edge, and a CHFA-approved analyst draws the area a study uses.' +
      (s.withCommutes ? '' : ' The commuting file did not load, so this suggestion uses distance only.') + (s.withCrossings ? '' : ' The rivers and interstates file did not load, so no crossing was checked.') + '</p>' +
      '<p class="metric-source">' + [
        line('LEHD LODES ' + ((src.od && src.od.vintage) || '2024') + ' home-to-work flows', src.od && src.od.source_url),
        s.withDrive && line('Drive times: OpenStreetMap contributors, routed by OSRM' + (src.drive && src.drive.as_of ? ', ' + src.drive.as_of : ''), 'https://www.openstreetmap.org/copyright'),
        s.withDrive && line('Tract population centres: U.S. Census Bureau, 2020 Centers of Population', 'https://www.census.gov/geographies/reference-files/time-series/geo/centers-population.html'),
        s.withBands && line('People by road: 2020 Census blocks (TIGER/Line), routed on OpenStreetMap by OSRM' + (src.bands && src.bands.as_of ? ', ' + src.bands.as_of : ''), (src.bands && src.bands.blocks_source_url) || 'https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/'),
        s.withSchools && line('School districts: Census TIGER 2024', (src.schools && src.schools.districts_source_url) || 'https://www2.census.gov/geo/tiger/TIGER2024/UNSD/'),
        s.withMovers && line('Movers: Census ACS 2020–2024, table B07013', 'https://data.census.gov/table/ACSDT5Y2024.B07013'),
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

  // The counts the box last drew for a site: { m (measure's result, or null with no tract), tracts, edited }, or null
  // before the box has worked out its suggestion. The Market check's head reads these, so it never counts on its own.
  function now(site) {
    var b = site && boxes[keyOf(site)];
    return b && b.sug && b.count != null ? { m: b.now || null, tracts: b.count, edited: !!b.picked, key: b.key, label: b.nowLabel || null } : null;
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
    var pa = pickedArea(site), inSet = set(current(site, edited) || []), src = b.data.sources, areas = areasFor(b);
    return {
      tracts: b.sug.order.map(function (g) {
        var t = b.byId[g];
        return { geoid: g, name: t.name, county: t.county, miles: Math.round(t.miles * 10) / 10, inArea: !!inSet[g], suggested: t.suggested, why: t.why, reason: t.reason,
          peopleWithin: t.bands ? { m10: t.bands[0], m15: t.bands[1], m20: t.bands[2] } : null, siteSchoolDistrictShare: t.school, jobTie: t.tie && t.tie.workers ? Math.round(t.tie.share * 1000) / 1000 : null,
          renterMovers: t.movers ? { people: t.movers.outside, of: t.movers.renters, moe: t.movers.moe } : null };
      }),
      comparison: {
        areas: areas.map(function (x) {
          var c = x.eval.chfa, ev = x.eval.ev;
          return { id: x.id, ids: x.ids.slice(), label: x.label, method: x.method, note: x.note, tracts: x.list.slice(), recommended: !!x.recommended, bestFit: !!x.best, tests: x.eval.tests.map(function (t) { return { id: t.id, pass: t.pass, text: t.text, caveat: t.caveat || null, uncertain: !!t.uncertain }; }), supplyNotes: x.eval.supplyNotes.slice(), line: x.line || null,
            chfa: { tier: b.ctx.tier, rate: c.rateT, comparable: c.existingT, qualified: c.qT, allLevelsTo: c.top, rateAll: c.rateAll, comparableAll: c.existingAll, qualifiedAll: c.qAll, notes: x.eval.compNotes.slice() },
            reasons: { drawShare: ev.draw, drawMinutes: b.sug.withBands ? b.sug.band : null, schoolDistrictShare: ev.school, jobsHeld: ev.jobs, renterMoverShare: ev.movers } };
        }),
        bestFit: b.best ? b.best.id : null,
        bestFitRule: b.sug.withBands ? 'Approved by paul 18 Nov 2026: of the areas holding at least half the people within ' + b.sug.band + ' minutes’ drive of the site and at or under 85% (CHFA rate, comparable family tax credit homes counted) at the project level and across all levels, the lowest rate, then the fewest tracts within 5 points.' : null,
        schoolDistrict: b.sug.siteDistrict ? b.sug.siteDistrict.name : null,
        // Since 15 Nov 2026 no area is recommended: the local and regional areas are named instead.
        recommended: null,
        recommendedWhy: null,
        views: { local: (areaById(b, 'suggested') || {}).id || null, regional: (areaById(b, 'ring') || {}).id || null, bestFit: b.best ? b.best.id : null },
        picked: pa ? pa.id : null,
        pickedWhy: pa && !isView(pa) ? (b.pickWhy || '').trim() || null : null,
        tests: 'COHO screening tests, 18 Nov 2026: 1 whole tracts (CHFA Market Study Guide); 2 every tract with most of its people within ' + (b.sug.withBands ? b.sug.band + ' minutes by road, or ' : '') + 'near the site on its side' + (!b.sug.withBands && b.sug.withDrive ? ' and within ' + b.sug.maxDrive + ' minutes by road (OpenStreetMap)' : '') + ', or with 10%+ of working residents employed near it (LODES 2024); 3 no tract where another town holds most homes and has tax credit homes; 4 CHFA rate (comparable family tax credit homes + the project, over renter households who qualify) at or under 85% at the project level and across all levels. Tests 2-3 are not CHFA rules.'
      },
      edited: !!(edited && edited.length), city: b.sug.city, coreMiles: b.sug.coreMiles, reachMiles: b.sug.reach,
      withCommutes: b.sug.withCommutes, withCrossings: b.sug.withCrossings,
      rules: 'COHO screening rules, 18 Nov 2026: the site tract; tracts within ' + b.sug.coreMiles + ' miles' + (b.sug.withBands ? ' unless fewer than half their people live within ' + b.sug.band + ' minutes by road' : '') + '; farther tracts to ' + b.sug.reach + ' miles where 25% or more (and 50 or more) of working residents have a job within ' + b.sug.coreMiles + ' miles' + (!b.sug.withBands && b.sug.withDrive ? ' unless more than ' + b.sug.maxDrive + ' minutes by road' : '') + '; nothing across an interstate, river or named lake unless that jobs tie holds' + (b.sug.withBands ? ' or most of its people are within ' + b.sug.band + ' minutes by road' : '') + '; at least 3 tracts' + (b.sug.withDrive ? ', the added ones within ' + RULES.smallDrive + ' minutes by road' : '') + '. Not CHFA rules.',
      sourceDates: {
        lodesOd: src.od ? (src.od.vintage ? 'LODES ' + src.od.vintage : null) : null, lodesOdBuilt: src.od ? src.od.generated_at || src.od.as_of || null : null,
        barriers: src.barriers ? src.barriers.generated || null : null,
        driveTimes: src.drive ? src.drive.generated || null : null,
        driveBands: src.bands ? src.bands.generated || null : null,
        schoolDistricts: src.schools ? src.schools.generated || null : null,
        renterMovers: src.movers ? 'ACS ' + (src.movers.vintage || '') + ' 5-year' : null,
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

  global.LabTractCapture = { section: section, suggest: suggest, current: current, now: now, keyOf: keyOf, record: record, pickedArea: pickedArea, needsReason: needsReason, parseList: parseList, RULES: RULES, FILES: FILES, mountAll: mountAll };
})(window);
