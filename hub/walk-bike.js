// Walking and biking (#/places/walk-bike): how many homes in a Colorado town or county can walk or bike to
// everyday services and jobs, measured along streets and trails rather than in straight lines. Every figure
// is read from Housing-Analytics' own file data/market/walk_bike_access_co.json (built by
// scripts/market/build_walk_bike_access.py from Census streets, COTREX trails, 2020 Census homes, LODES jobs
// and the site's service files). The EPA National Walkability Index and the Census commute shares are shown
// beside it as published. Nothing on the page makes a figure of its own; the bands come from the file.
//
// Address: ?g=<place or county GEOID> | ?pt=<lng>,<lat>&label=<address>. Exports: CSV of every place,
// a PNG of the place card, and a print view (save as PDF from the browser's print dialog).
(function (global) {
  'use strict';

  var Shell = global.LabShell, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;
  var VENDOR = global.LAB_VENDOR;
  var ROUTE = '#/places/walk-bike';
  var FILES = { access: 'data/market/walk_bike_access_co.json' };
  var MAP_FILES = { layers: 'data/market/walk_bike_map_co.json', bg: 'data/market/epa_sld_bg_geometry_co.geojson', places: 'data/co-place-boundaries.geojson', counties: 'data/boundaries/counties_co.geojson' };
  var SERVICES = [['grocery', 'Grocery store'], ['school', 'School'], ['health', 'Health care'], ['park', 'Park'], ['transit', 'Transit stop']];
  var BAND_CLASS = { 'Strong': 'wb-b4', 'Fair': 'wb-b3', 'Limited': 'wb-b2', 'Very limited': 'wb-b1' };
  // The file's bands are quartiles of Colorado towns, not fixed standards, so the page says so.
  var BAND_SHOWN = { 'Strong': 'Top quarter', 'Fair': 'Upper middle', 'Limited': 'Lower middle', 'Very limited': 'Bottom quarter' };
  function shown(b) { return b ? BAND_SHOWN[b] || b : null; }
  var EPA_BANDS = [[15.26, 'Most walkable'], [10.51, 'Above average'], [5.76, 'Below average'], [-Infinity, 'Least walkable']];
  // Block-group shading on the map: share of homes that can walk to the four everyday services.
  var SHADE = [[75, 'var(--map-5)'], [50, 'var(--map-4)'], [25, 'var(--map-3)'], [10, 'var(--map-2)'], [0.0001, 'var(--map-1)'], [-1, 'var(--map-0)']];
  var LINKS = {
    epa: 'https://www.epa.gov/smartgrowth/smart-location-mapping',
    tiger: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
    cotrex: 'https://trails.colorado.gov/',
    lodes: 'https://lehd.ces.census.gov/data/',
    b08301: 'https://data.census.gov/table/ACSDT5Y2024.B08301',
    osm: 'https://www.openstreetmap.org/copyright'
  };
  // Which local inventory covers a place, as the file names them.
  var INVENTORY = { drcog: 'the Denver Regional Council of Governments (DRCOG) region', cos: 'Colorado Springs', gj: 'Grand Junction' };

  function params() { var h = location.hash || '', q = h.indexOf('?'); return new URLSearchParams(q > -1 ? h.slice(q + 1) : ''); }
  function href(p) { var s = new URLSearchParams(p).toString(); return ROUTE + (s ? '?' + s : ''); }
  function pct(v) { return v == null ? '–' : (Math.round(v) + '%'); }
  function bare(name) { return String(name || '').replace(/\s+(town|city|CDP|city and county)$/i, ''); }
  function epaBand(v) { if (v == null) return null; for (var i = 0; i < EPA_BANDS.length; i++) if (v >= EPA_BANDS[i][0]) return EPA_BANDS[i][1]; return null; }
  function shade(v) { if (v == null) return 'var(--map-empty)'; for (var i = 0; i < SHADE.length; i++) if (v >= SHADE[i][0]) return SHADE[i][1]; return 'var(--map-0)'; }

  // One record for whatever is picked: a town, a county, the state, or the block group an address is in.
  function record(doc, g) {
    if (!g || g === '08') return doc.state ? Object.assign({ name: 'Colorado', kind: 'state', geoid: '08' }, doc.state) : null;
    if (doc.places[g]) return Object.assign({ kind: 'place', geoid: g }, doc.places[g], { name: bare(doc.places[g].name) });
    if (doc.counties[g]) return Object.assign({ kind: 'county', geoid: g }, doc.counties[g]);
    return null;
  }
  // [homes, walk_reach, bike_reach, transit_reach, jobs_walk15, jobs_bike15, walk x5, bike x5, bike_calm_reach, walk_sidewalk_reach, thiz_pct, half_mile_walk_pct]
  function bgRecord(doc, bg) {
    var a = doc.blockGroups[bg];
    if (!a) return null;
    var walk = {}, bike = {};
    SERVICES.forEach(function (s, i) { walk[s[0]] = a[6 + i]; bike[s[0]] = a[11 + i]; });
    return { kind: 'bg', geoid: bg, homes: a[0], walk_reach: a[1], bike_reach: a[2], transit_reach: a[3], jobs_walk15: a[4], jobs_bike15: a[5], walk: walk, bike: bike,
      bike_calm_reach: a.length > 16 ? a[16] : null, walk_sidewalk_reach: a.length > 17 ? a[17] : null,
      thiz_pct: a.length > 18 ? a[18] : null, half_mile_pct: a.length > 19 ? a[19] : null };
  }
  function bandOf(doc, key, v) {
    var c = doc.meta.bands[key], L = doc.meta.bands.labels;
    if (v == null) return null;
    // As the file states its bands: Strong at or above the top-quarter cut, Fair at or above the median,
    // Limited above the bottom-quarter cut, Very limited at or below it.
    return v >= c[0] ? L[0] : v >= c[1] ? L[1] : v > c[2] ? L[2] : L[3];
  }

  // The first useful answer, in one sentence.
  function answer(r) {
    var where = r.kind === 'bg' ? 'Around this address' : 'In ' + r.name;
    return where + ', ' + pct(r.walk.grocery) + ' of homes are within a 10-minute walk of a grocery store and ' + pct(r.bike.grocery) +
      ' within a 15-minute bike ride, measured along streets and trails.';
  }

  function card(doc, key, title, v, sub, extra) {
    var b = bandOf(doc, key, v);
    return '<div class="wb-card ' + (BAND_CLASS[b] || '') + '"><p class="wb-card-k">' + esc(title) + '</p>' +
      '<p class="wb-card-band">' + esc(shown(b) || 'No data') + '</p>' + (b ? '<p class="wb-card-x">of Colorado towns</p>' : '') +
      '<div class="wb-meter" role="img" aria-label="' + esc(title + ': ' + pct(v)) + '"><span style="width:' + Math.max(0, Math.min(100, v || 0)).toFixed(0) + '%"></span></div>' +
      '<p class="wb-card-v"><strong>' + esc(pct(v)) + '</strong> ' + esc(sub) + '</p>' + (extra || '') + '</div>';
  }

  function cards(doc, r) {
    var epa = r.epa_walk_index != null ? '<p class="wb-card-x">EPA walkability index <strong>' + esc(r.epa_walk_index.toFixed(1)) + '</strong> of 20 (' + esc(epaBand(r.epa_walk_index)) + ')</p>' : '';
    return '<div class="wb-cards">' +
      card(doc, 'walk_reach', 'Walking', r.walk_reach, 'of homes, on average, within a 10-minute walk of a grocery store, school, health care and a park', epa) +
      card(doc, 'bike_reach', 'Biking', r.bike_reach, 'of homes, on average, within a 15-minute ride of the same four', '<p class="wb-card-x">Estimate: any street except interstates and highways CDOT closes to bikes; hills not counted</p>') +
      card(doc, 'transit_reach', 'Transit', r.transit_reach, 'of homes within a 10-minute walk of a fixed-route stop', '<p class="wb-card-x">How often buses come is not counted yet</p>') +
      '</div>';
  }

  // Paired bars per service: walk (green), and what a ride adds (blue).
  function reachChart(r) {
    var W = 360, rowH = 30, top = 6, left = 92, bw = W - left - 78, H = top + SERVICES.length * rowH + 8;
    var rows = SERVICES.map(function (s, i) {
      var y = top + i * rowH, w = r.walk[s[0]] || 0, b = Math.max(w, r.bike[s[0]] || 0);
      return '<text x="' + (left - 8) + '" y="' + (y + 17) + '" text-anchor="end" class="wb-t">' + esc(s[1]) + '</text>' +
        '<rect x="' + left + '" y="' + (y + 4) + '" width="' + bw + '" height="18" class="wb-track"></rect>' +
        '<rect x="' + left + '" y="' + (y + 4) + '" width="' + (bw * b / 100).toFixed(1) + '" height="18" class="wb-bike"><title>' + esc(s[1] + ': ' + pct(r.bike[s[0]]) + ' within a 15-minute ride') + '</title></rect>' +
        '<rect x="' + left + '" y="' + (y + 4) + '" width="' + (bw * w / 100).toFixed(1) + '" height="18" class="wb-walk"><title>' + esc(s[1] + ': ' + pct(w) + ' within a 10-minute walk') + '</title></rect>' +
        '<text x="' + (left + bw + 5) + '" y="' + (y + 17) + '" class="wb-t wb-num">' + esc(pct(w)) + ' · ' + esc(pct(r.bike[s[0]])) + '</text>';
    }).join('');
    return '<figure class="wb-fig wb-reach"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Share of homes within a 10-minute walk and a 15-minute ride of each service. ' + SERVICES.map(function (s) { return s[1] + ' ' + pct(r.walk[s[0]]) + ' walk, ' + pct(r.bike[s[0]]) + ' ride'; }).join('; ')) + '">' + rows + '</svg>' +
      '<figcaption><span class="wb-key wb-walk-k"></span> Green: within a 10-minute walk. <span class="wb-key wb-bike-k"></span> Blue: added by a 15-minute bike ride. Share of homes, by street and trail; figures read walk · ride.</figcaption></figure>';
  }

  // Straight line against route: the honest gap.
  function routeGap(r) {
    if (r.walk_reach_straight == null) return '';
    var s = r.walk_reach_straight, w = r.walk_reach, d = Math.round(s - w);
    return '<div class="wb-gap"><div><p class="wb-gap-v">' + esc(pct(s)) + '</p><p class="note">by straight-line distance</p></div><div class="wb-gap-arrow" aria-hidden="true">→</div>' +
      '<div><p class="wb-gap-v">' + esc(pct(w)) + '</p><p class="note">by streets and trails</p></div>' +
      '<p class="wb-gap-say">' + (d > 0 ? 'A straight line would overstate walking access here by ' + d + ' points. Streets bend, dead-end and stop at rivers and highways.' : 'Here the route and the straight line agree.') + '</p></div>';
  }

  function adds(r) {
    if (r.walk_reach_roads == null) return '';
    var tw = Math.round((r.walk_reach - r.walk_reach_roads) * 10) / 10, tb = Math.round((r.bike_reach - r.bike_reach_roads) * 10) / 10;
    return '<ul class="wb-adds"><li><strong>Trails add ' + esc(tw > 0 ? tw.toFixed(1) + ' points' : 'no measurable reach') + '</strong> to walking and <strong>' + esc(tb > 0 ? tb.toFixed(1) + ' points' : 'none') + '</strong> to biking here, against streets alone.</li>' +
      '<li><strong>Jobs within reach:</strong> ' + esc(r.jobs_walk15 == null ? '–' : num(r.jobs_walk15)) + ' in a 15-minute walk and ' + esc(r.jobs_bike15 == null ? '–' : num(r.jobs_bike15)) + ' in a 15-minute ride, for the typical home.</li>' +
      (r.off_network_pct ? '<li>' + esc(pct(r.off_network_pct)) + ' of homes are more than a quarter mile from any street, so they never count as within reach.</li>' : '') + '</ul>';
  }

  // Bike lanes and sidewalks from the state and local inventories: the calmer ride, and sidewalk walking where mapped.
  function pair(label, a, b, aSay, bSay) {
    var W = 360, left = 4, bw = W - 8;
    return '<figure class="wb-fig wb-reach"><svg viewBox="0 0 ' + W + ' 58" role="img" aria-label="' + esc(label + ': ' + pct(a) + ' ' + aSay + ', ' + pct(b) + ' ' + bSay) + '">' +
      '<rect x="' + left + '" y="4" width="' + bw + '" height="20" class="wb-track"></rect><rect x="' + left + '" y="4" width="' + (bw * Math.max(0, Math.min(100, a || 0)) / 100).toFixed(1) + '" height="20" class="wb-pale"></rect>' +
      '<rect x="' + left + '" y="32" width="' + bw + '" height="20" class="wb-track"></rect><rect x="' + left + '" y="32" width="' + (bw * Math.max(0, Math.min(100, b || 0)) / 100).toFixed(1) + '" height="20" class="wb-strong"></rect></svg>' +
      '<figcaption><strong>' + esc(pct(a)) + '</strong> ' + esc(aSay) + '. <strong>' + esc(pct(b)) + '</strong> ' + esc(bSay) + '.</figcaption></figure>';
  }
  function lanesAndSidewalks(r) {
    var out = '';
    if (r.bike_calm_reach != null) {
      out += '<h4>Biking off busy highways</h4>' + pair('Biking', r.bike_reach, r.bike_calm_reach, 'can ride to the four services on any allowed street', 'can get there on side streets, trails, paths and highways that have a bike lane or path beside them');
      if (r.kind === 'place' || r.kind === 'county') {
        out += '<p class="note">' + (r.bike_inventory ? 'Bike lanes and paths come from the ' + esc(r.bike_inventory === 'drcog' ? 'DRCOG regional inventory' : INVENTORY[r.bike_inventory] + ' city inventory') + (r.bike_facility_km != null ? ': ' + esc(num(Math.round(r.bike_facility_km))) + ' km mapped inside the ' + (r.kind === 'county' ? 'county' : 'town line') : '') + '.'
          : 'No local bike lane map covers this place yet, so a state or US highway never counts as a calm ride here, even where a lane exists.') + '</p>';
      }
    }
    if (r.walk_sidewalk_reach != null) {
      out += '<h4>Walking on sidewalks</h4>' + pair('Walking', r.walk_reach, r.walk_sidewalk_reach, 'can walk to the four services on any street', 'can do it on streets with a mapped sidewalk, walkways, trails and paths');
      if (r.sidewalk_pct != null) {
        out += '<p class="note"><strong>' + esc(pct(r.sidewalk_pct)) + '</strong> of street length here has a mapped sidewalk' + (r.missing_sidewalk_km ? '; DRCOG marks ' + esc(String(Math.round(r.missing_sidewalk_km * 10) / 10)) + ' km as possible missing sidewalk' : '') +
          '. Source: ' + esc(r.sidewalk_source === 'drcog' ? 'DRCOG sidewalk centerlines from 2024 aerial photos' : 'City of Colorado Springs sidewalk map') + '.</p>';
      }
    } else if (r.kind === 'bg' ? r.bike_calm_reach != null : (r.kind === 'place' || r.kind === 'county') && r.sidewalk_mapped_homes_pct != null) {
      // Only files built with the local layers say what is mapped; an older file says nothing here.
      out += '<p class="note">No sidewalk map covers ' + (r.kind === 'bg' ? 'this address' : 'most homes here') + ' yet. Sidewalks are mapped for the DRCOG region and Colorado Springs.</p>';
    }
    return out ? '<h3>Bike lanes and sidewalks</h3>' + out : '';
  }

  // Near transit: the official OEDIT Transit and Housing Investment Zone (two miles) and the CHFA QAP half-mile walk.
  function tile(v, say) { return '<div class="wb-tile"><p class="wb-tile-v">' + esc(pct(v)) + '</p><p class="wb-tile-k">' + esc(say) + '</p></div>'; }
  function nearTransit(doc, r) {
    var T = r.transit_areas, m = doc.meta.transit_areas;
    if (!m) return '';
    if (r.kind === 'bg') {
      if (r.thiz_pct == null) return '';
      return '<h3>Near transit</h3><div class="wb-tiles">' + tile(r.thiz_pct, 'of homes here are inside the state Transit and Housing Investment Zone') + tile(r.half_mile_pct, 'are within a half-mile walk of a transit stop or station') + '</div>';
    }
    if (!T) return '';
    var out = '<h3>Near transit</h3><div class="wb-tiles">' +
      tile(T.thiz_pct, 'of homes are inside the state Transit and Housing Investment Zone (two miles of a stop or station)') +
      tile(T.half_mile_walk_pct, 'are within a half-mile walk of a stop or station, the CHFA tax credit distance') +
      (T.half_mile_sidewalk_pct != null ? tile(T.half_mile_sidewalk_pct, 'of street length within a half mile of transit has a mapped sidewalk') : '') + '</div>';
    var H = T.half_mile;
    if (H && H.homes > 0 && r.walk_reach != null) {
      out += '<h4>Walking and biking for homes near transit</h4>' +
        pair('Walking', r.walk_reach, H.walk_reach, 'of all homes here can walk to the four everyday services', 'of the ' + num(H.homes) + ' homes within a half-mile walk of transit can') +
        (H.walk_sidewalk_reach != null ? pair('Sidewalks', r.walk_sidewalk_reach, H.walk_sidewalk_reach, 'of all homes can do it on sidewalks, walkways and paths', 'of homes near transit can') : '') +
        pair('Biking', r.bike_calm_reach, H.bike_calm_reach, 'of all homes can ride there off busy highways', 'of homes near transit can');
    } else if (T.half_mile_walk_pct === 0) {
      out += '<p class="note">No home here is within a half-mile walk of a transit stop or station on the state map.</p>';
    }
    var diff = T.stop_buffer_2mi_pct - T.thiz_pct;
    out += '<p class="note">The zone is the official OEDIT map (' + esc(m.thiz_vintage) + '), not our estimate. As a check, our own two-mile buffer around confirmed bus and rail stops covers ' + esc(pct(T.stop_buffer_2mi_pct)) + ' of homes here' +
      (Math.abs(diff) < 1 ? ', the same as the official zone.' : diff > 0 ? '. The official zone is smaller because it leaves out some dial-a-ride and shuttle stops.' : '. The official zone is larger because it adds planned stations and park-and-rides.') + '</p>';
    return out;
  }

  // How workers who live here get to work, from the place's HNA file (ACS 5-year).
  var modeCache = {};
  function modeShare(g) {
    if (!g || g === '08') return '';
    var m = modeCache[g];
    if (!m) {
      m = modeCache[g] = { state: 'loading' };
      // The hosted preview packs the per-place HNA files into bundles (LAB_HNA_LOAD), as hna.js reads them.
      (global.LAB_HNA_LOAD ? global.LAB_HNA_LOAD(g).then(function (x) { return x[1]; })
        : fetch(VENDOR + 'data/hna/summary/' + g + '.json').then(function (x) { if (!x.ok) throw new Error(x.status); return x.json(); }))
        .then(function (d) { m.state = 'ok'; m.d = d; Shell.render(); }, function () { m.state = 'none'; Shell.render(); });
    }
    if (m.state === 'loading') return '<p class="note" role="status">Loading the Census commute counts…</p>';
    if (m.state !== 'ok') return '<p class="note">The Census commute counts for this place did not load.</p>';
    var b = m.d.acsB08301, s8 = m.d.acsS0801 || {}, yr = s8._acsYear || 2024, walk, bike, total;
    if (b && b.total > 0 && b.walk != null && b.bike != null) { total = b.total; walk = 100 * b.walk / b.total; bike = 100 * b.bike / b.total; }
    else if (s8.S0801_C01_010E != null && s8.S0801_C01_011E != null) { walk = Number(s8.S0801_C01_010E); bike = Number(s8.S0801_C01_011E); }
    else return '<p class="note">The Census commute counts do not include walking and biking for this place.</p>';
    var W = 360, bw = W - 8, wx = bw * walk / 100, bx = bw * bike / 100;
    return '<figure class="wb-fig wb-reach"><svg viewBox="0 0 ' + W + ' 30" role="img" aria-label="' + esc('Walk ' + walk.toFixed(1) + '%, bike ' + bike.toFixed(1) + '% of workers who live here') + '">' +
      '<rect x="4" y="4" width="' + bw + '" height="22" class="wb-track"></rect><rect x="4" y="4" width="' + wx.toFixed(1) + '" height="22" class="wb-walk"></rect>' +
      '<rect x="' + (4 + wx).toFixed(1) + '" y="4" width="' + bx.toFixed(1) + '" height="22" class="wb-bike"></rect></svg>' +
      '<figcaption><strong>' + esc(walk.toFixed(1)) + '%</strong> walk and <strong>' + esc(bike.toFixed(1)) + '%</strong> bike to work' + (total ? ', of ' + esc(num(total)) + ' workers who live here' : '') +
      '. The rest drive, carpool, take transit or work from home. Small towns carry wide margins of error.</figcaption>' +
      '<p class="metric-source">Source: <a href="https://data.census.gov/">Census ACS ' + esc((yr - 4) + '\u2013' + yr) + ' five-year</a>, table ' + (total ? 'B08301' : 'S0801') + '.</p></figure>';
  }

  // Map: the place's block groups shaded by walking reach, trails, services, and the outline.
  var BOX_W = 640;
  function polys(g) { return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function bboxOf(g) { var b = [Infinity, Infinity, -Infinity, -Infinity]; polys(g).forEach(function (p) { p[0].forEach(function (c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }); }); return b; }
  function inRing(pt, ring) { var x = pt[0], y = pt[1], ins = false; for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) { var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
  function inGeom(pt, g) { return polys(g).some(function (p) { return inRing(pt, p[0]) && !p.slice(1).some(function (h) { return inRing(pt, h); }); }); }
  function projector(bx) {
    var k = Math.cos(((bx[1] + bx[3]) / 2) * Math.PI / 180), w = (bx[2] - bx[0]) * k, h = bx[3] - bx[1], H = Math.max(160, Math.round(BOX_W * h / w));
    if (H > 560) H = 560;
    var sc = Math.min(BOX_W / w, H / h), ox = (BOX_W - w * sc) / 2, oy = (H - h * sc) / 2;
    return { H: H, f: function (c) { return [(ox + (c[0] - bx[0]) * k * sc).toFixed(1), (oy + (bx[3] - c[1]) * sc).toFixed(1)]; } };
  }
  function pathOf(g, P) { return polys(g).map(function (p) { return p.map(function (r) { return 'M' + r.map(function (c) { return P.f(c).join(' '); }).join('L') + 'Z'; }).join(''); }).join(''); }
  function overlaps(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }

  // Map layers a visitor can switch off; the choice holds while they move between places.
  var LAYERS = [['shade', 'Walking shade'], ['towns', 'Towns'], ['thiz', 'Transit zone (2 mi)'], ['half', 'Half mile of transit'], ['bike', 'Trails and bike lanes'], ['dots', 'Services'], ['stops', 'Stations and park-and-rides']];
  // Stops crowd a city map, so they start off.
  var hidden = { stops: true };
  function ringsPath(rings, P) { return (rings || []).map(function (r) { return 'M' + r.map(function (c) { return P.f(c).join(' '); }).join('L') + 'Z'; }).join(''); }
  function bigRingBox(g) {
    var best = null, area = -1;
    polys(g).forEach(function (p) { var b = [Infinity, Infinity, -Infinity, -Infinity]; p[0].forEach(function (c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }); var a = (b[2] - b[0]) * (b[3] - b[1]); if (a > area) { area = a; best = b; } });
    return best;
  }
  // Town outlines and names in view: every town line, and the names of the largest towns (by homes) so they don't pile up.
  function townsLayer(doc, M, bx, P, self) {
    var lines = '', named = [];
    M.places.features.forEach(function (f) {
      if (!f.geometry) return;
      if (!f._bb) f._bb = bboxOf(f.geometry);
      if (!overlaps(f._bb, bx)) return;
      var g = f.properties.geoid;
      if (g !== self) lines += '<path d="' + pathOf(f.geometry, P) + '"></path>';
      var rec = doc.places[g], b = bigRingBox(f.geometry);
      var c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      if (rec && c[0] >= bx[0] && c[0] <= bx[2] && c[1] >= bx[1] && c[1] <= bx[3]) named.push({ g: g, name: bare(rec.name), homes: rec.homes, c: c });
    });
    named.sort(function (a, b) { return (b.g === self) - (a.g === self) || b.homes - a.homes; });
    var labels = named.slice(0, 12).map(function (t) {
      var q = P.f(t.c);
      // Names near an edge grow inward, so they stay on the map.
      var x = Number(q[0]), anchor = x > BOX_W * 0.78 ? 'end' : x < BOX_W * 0.22 ? 'start' : 'middle';
      return '<g transform="translate(' + q[0] + ' ' + q[1] + ')"><g class="mk-city"><text class="mk-city-name wb-town-name" text-anchor="' + anchor + '" y="4">' + esc(t.name) + '</text></g></g>';
    }).join('');
    return { lines: '<g class="wb-towns wb-l-towns">' + lines + '</g>', labels: '<g class="mk-cities wb-l-towns" aria-hidden="true" pointer-events="none">' + labels + '</g>' };
  }

  function mapFor(doc, r, M, pt) {
    var outline = null, bx = null, layer = null, zoneLayer = null, townLayers = [];
    if (r.kind === 'place') {
      outline = (M.places.features.filter(function (f) { return f.properties.geoid === r.geoid; })[0] || {}).geometry;
      layer = M.layers.places[r.geoid];
      bx = layer ? layer.bbox : outline ? bboxOf(outline) : null;
    } else if (r.kind === 'county') {
      outline = (M.counties.features.filter(function (f) { return f.properties.GEOID === r.geoid; })[0] || {}).geometry;
      bx = outline ? bboxOf(outline) : null;
      zoneLayer = M.layers.counties ? M.layers.counties[r.geoid] : null;
      // The county view draws the trails and bike lanes of every town in it.
      townLayers = Object.keys(M.layers.places).filter(function (g) { return doc.places[g] && doc.places[g].county === r.geoid; }).map(function (g) { return M.layers.places[g]; });
    } else if (r.kind === 'bg' && pt) {
      bx = [pt[0] - 0.015, pt[1] - 0.011, pt[0] + 0.015, pt[1] + 0.011];
      var near = Object.keys(M.layers.places).filter(function (g) { var b = M.layers.places[g].bbox; return pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3]; })[0];
      layer = near ? M.layers.places[near] : null;
    }
    if (!bx) return '<p class="note">No map outline for this area.</p>';
    if (layer) { zoneLayer = layer; townLayers = [layer]; }
    var P = projector(bx), cnt = 0;
    var bgs = M.bg.features.map(function (f) {
      if (!f._bb) f._bb = bboxOf(f.geometry);
      if (!overlaps(f._bb, bx)) return '';
      var g = f.properties.geoid || f.properties.GEOID10, a = doc.blockGroups[g];
      cnt++;
      return '<path d="' + pathOf(f.geometry, P) + '" fill="' + shade(a ? a[1] : null) + '"><title>' + esc('Block group ' + g + ': ' + (a ? pct(a[1]) + ' walking reach, ' + num(a[0]) + ' homes' : 'no homes counted')) + '</title></path>';
    }).join('');
    var inBox = function (t) { return t.slice(1).some(function (c) { return c[0] >= bx[0] && c[0] <= bx[2] && c[1] >= bx[1] && c[1] <= bx[3]; }); };
    var trails = townLayers.length ? [].concat.apply([], townLayers.map(function (l) { return l.trails; })).filter(function (t) { return (t[0] === 'b' || t[0] === 'w') && t.slice(1).some(function (c) { return c[0] >= bx[0] && c[0] <= bx[2] && c[1] >= bx[1] && c[1] <= bx[3]; }); }).map(function (t) {
      return '<polyline class="wb-trail-' + t[0] + '" points="' + t.slice(1).map(function (c) { return P.f(c).join(','); }).join(' ') + '"></polyline>';
    }).join('') : '';
    var bikeways = townLayers.length ? [].concat.apply([], townLayers.map(function (l) { return l.bikeways || []; })).filter(inBox).map(function (t) {
      return '<polyline class="wb-lane-' + (t[0] === 'l' ? 'l' : 'p') + '" points="' + t.slice(1).map(function (c) { return P.f(c).join(','); }).join(' ') + '"></polyline>';
    }).join('') : '';
    var dots = layer && r.kind !== 'county' ? SERVICES.map(function (s) {
      return (layer.services[s[0]] || []).filter(function (c) { return c[0] >= bx[0] && c[0] <= bx[2] && c[1] >= bx[1] && c[1] <= bx[3]; }).map(function (c) { var p = P.f(c); return '<circle class="wb-dot wb-dot-' + s[0] + '" cx="' + p[0] + '" cy="' + p[1] + '" r="3.6"><title>' + esc(s[1]) + '</title></circle>'; }).join('');
    }).join('') : '';
    var thiz = zoneLayer && zoneLayer.thiz ? ringsPath(zoneLayer.thiz, P) : '';
    var half = zoneLayer && zoneLayer.half_mile ? ringsPath(zoneLayer.half_mile, P) : '';
    var facs = layer && layer.facilities && r.kind !== 'county' ? layer.facilities.filter(function (c) { return c[0] >= bx[0] && c[0] <= bx[2] && c[1] >= bx[1] && c[1] <= bx[3]; }).map(function (c) {
      var p = P.f(c);
      return '<rect class="wb-fac" x="' + (p[0] - 3) + '" y="' + (p[1] - 3) + '" width="6" height="6"><title>' + esc(c[3] + ' (' + String(c[2]).replace(/_/g, ' ') + ', state transit map)') + '</title></rect>';
    }).join('') : '';
    var towns = townsLayer(doc, M, bx, P, r.kind === 'place' ? r.geoid : null);
    var you = pt ? (function () { var p = P.f(pt); return '<circle class="wb-you" cx="' + p[0] + '" cy="' + p[1] + '" r="7"></circle>'; })() : '';
    // Map kit part 2: a title that states the finding, above the map.
    var wbTitle = r.walk_reach != null ? pct(r.walk_reach) + ' of homes in ' + (r.name || 'this area') + ' are within a 10-minute walk of everyday services' : 'Walking reach around ' + (r.name || 'this address');
    var cls = LAYERS.filter(function (l) { return hidden[l[0]]; }).map(function (l) { return ' wb-hide-' + l[0]; }).join('');
    var toggles = '<fieldset class="pm-toggles wb-toggles no-print"><legend class="visually-hidden">Map layers</legend>' + LAYERS.filter(function (l) {
      return l[0] === 'shade' || l[0] === 'towns' || (l[0] === 'thiz' && thiz) || (l[0] === 'half' && half) || (l[0] === 'bike' && (trails || bikeways)) || (l[0] === 'dots' && dots) || (l[0] === 'stops' && facs);
    }).map(function (l) { return '<label class="pm-toggle"><input type="checkbox" data-wb-layer="' + l[0] + '"' + (hidden[l[0]] ? '' : ' checked') + '> ' + esc(l[1]) + '</label>'; }).join('') + '</fieldset>';
    return '<figure class="wb-fig wb-map' + cls + '"><p class="wb-title"><strong>' + esc(wbTitle) + '</strong></p>' + toggles + '<div class="pm-frame"><svg viewBox="0 0 ' + BOX_W + ' ' + P.H + '" role="img" aria-label="' + esc(wbTitle + '. Map of ' + (r.name || 'the area around this address') + ': ' + cnt + ' block groups shaded by the share of homes within a 10-minute walk of everyday services' + (trails ? ', with trails' : '') + (bikeways ? ', bike lanes and paths' : '') + (thiz ? ', the state transit zone' : '') + (half ? ', the half-mile transit area' : '') + (dots ? ' and service locations' : '') + ', with town limits.') + '">' +
      '<rect width="' + BOX_W + '" height="' + P.H + '" class="wb-map-bg"></rect><g class="wb-bgs wb-l-shade">' + bgs + '</g>' +
      (half ? '<path class="wb-half wb-l-half" fill-rule="evenodd" d="' + half + '"></path>' : '') + towns.lines +
      (thiz ? '<path class="wb-thiz wb-l-thiz" fill-rule="evenodd" d="' + thiz + '"></path>' : '') +
      '<g class="wb-trails wb-l-bike">' + trails + '</g><g class="wb-lanes wb-l-bike">' + bikeways + '</g>' +
      (outline ? '<path class="wb-outline" d="' + pathOf(outline, P) + '"></path>' : '') + '<g class="wb-l-dots">' + dots + '</g><g class="wb-l-stops">' + facs + '</g>' + you + towns.labels + '</svg></div>' +
      '<figcaption><span class="wb-legend">' + SHADE.slice(0, 5).map(function (s, i) { return '<span><i style="background:' + s[1] + '"></i>' + (i === 0 ? '75%+' : i === 4 ? 'Under 10%' : s[0] + '%+') + '</span>'; }).join('') + '<span><i style="background:var(--map-0)"></i>None</span></span>' +
      ' Shade: share of homes in each 2010 block group within a 10-minute walk of everyday services.' + (trails ? ' <span class="wb-key wb-trail-k"></span> Trail open to bikes <span class="wb-key wb-trail-wk"></span> walking only.' : '') +
      (bikeways ? ' <span class="wb-key wb-lane-k"></span> Bike lane <span class="wb-key wb-lane-pk"></span> local path.' : '') +
      (thiz ? ' <span class="wb-key wb-thiz-k"></span> State Transit and Housing Investment Zone (OEDIT map).' : '') +
      (half ? ' <span class="wb-key wb-half-k"></span> Within half a mile of a stop or station (straight line).' : '') +
      (facs ? ' <span class="wb-key wb-fac-k"></span> Station or park-and-ride on the state map (bus stops are the dark transit dots).' : '') +
      ' Grey lines: town limits. Use + and − or pinch to zoom; Reset shows the whole area.' +
      (dots ? ' Dots: ' + SERVICES.map(function (s) { return '<span class="wb-key-dot wb-dot-' + s[0] + '"></span>' + esc(s[1].toLowerCase()); }).join(' ') + '.' : '') + '</figcaption></figure>';
  }

  // Statewide: counties shaded by walking reach; tap one to open it.
  function stateMap(doc, M) {
    var B = global.LabMap.BOX, bx = [B.w, B.s, B.e, B.n], P = projector(bx);
    var paths = M.counties.features.map(function (f) {
      var g = f.properties.GEOID, c = doc.counties[g];
      return '<a href="' + esc(href({ g: g })) + '"><path d="' + pathOf(f.geometry, P) + '" fill="' + shade(c ? c.walk_reach : null) + '"><title>' + esc(f.properties.NAMELSAD + ': ' + (c ? pct(c.walk_reach) + ' walking reach (' + shown(c.bands.walk_reach) + ' of Colorado towns)' : 'no data')) + '</title></path></a>';
    }).join('');
    var top3 = Object.keys(doc.counties).map(function (g) { return doc.counties[g]; }).sort(function (a, b) { return b.walk_reach - a.walk_reach; }).slice(0, 3);
    var stTitle = top3.length ? top3[0].name + ' has the most walkable homes: ' + pct(top3[0].walk_reach) + ' within a 10-minute walk of everyday services, then ' + top3.slice(1).map(function (c) { return c.name + ' (' + pct(c.walk_reach) + ')'; }).join(' and ') : 'Walking reach by county';
    return '<figure class="wb-fig wb-map"><p class="wb-title"><span class="cc-kicker">Walking reach by county</span><strong>' + esc(stTitle) + '</strong></p><svg viewBox="0 0 ' + BOX_W + ' ' + P.H + '" role="img" aria-label="' + esc(stTitle + '. Colorado counties shaded by the share of homes within a 10-minute walk of everyday services. Highest: ' + top3.map(function (c) { return c.name + ' ' + pct(c.walk_reach); }).join(', ') + '.') + '"><g class="wb-bgs wb-counties">' + paths + '</g>' + global.LabMap.cities({ project: function (c) { return P.f(c).map(Number); } }) + '</svg>' +
      '<figcaption><span class="wb-legend">' + SHADE.slice(0, 5).map(function (s, i) { return '<span><i style="background:' + s[1] + '"></i>' + (i === 0 ? '75%+' : i === 4 ? 'Under 10%' : s[0] + '%+') + '</span>'; }).join('') + '</span> Share of each county\u2019s homes within a 10-minute walk of everyday services. Tap a county to open it.</figcaption></figure>';
  }

  // Table of every place, sortable.
  var sortKey = 'walk_reach', sortDir = -1, kindPick = 'place';
  function table(doc) {
    var coll = kindPick === 'county' ? doc.counties : doc.places;
    var rows = Object.keys(coll).map(function (g) { var x = coll[g]; return { g: g, name: kindPick === 'county' ? x.name : bare(x.name), homes: x.homes, walk_reach: x.walk_reach, bike_reach: x.bike_reach, bike_calm_reach: x.bike_calm_reach, sidewalk_pct: x.sidewalk_pct, transit_reach: x.transit_reach, thiz_pct: x.transit_areas ? x.transit_areas.thiz_pct : null, half_mile_pct: x.transit_areas ? x.transit_areas.half_mile_walk_pct : null, jobs_walk15: x.jobs_walk15, jobs_bike15: x.jobs_bike15, epa: x.epa_walk_index }; });
    rows.sort(function (a, b) { var x = a[sortKey], y = b[sortKey]; if (typeof x === 'string') return sortDir * x.localeCompare(y); return sortDir * (((x == null) ? -1 : x) - ((y == null) ? -1 : y)); });
    var cols = [['name', 'Place', 'Town, CDP or county'], ['homes', 'Homes', '2020 Census housing units'], ['walk_reach', 'Walking', 'Average share of homes within a 10-minute walk of grocery, school, health care and a park'], ['bike_reach', 'Biking', 'The same within a 15-minute ride'], ['bike_calm_reach', 'Calmer ride', 'The same ride avoiding state and US highways without a bike lane or path'], ['sidewalk_pct', 'Sidewalks', 'Share of street length with a mapped sidewalk (DRCOG region and Colorado Springs only)'], ['transit_reach', 'Transit', 'Share of homes within a 10-minute walk of a fixed-route stop'], ['thiz_pct', 'Transit zone', 'Share of homes inside the state Transit and Housing Investment Zone (OEDIT map)'], ['half_mile_pct', 'Half mile', 'Share of homes within a half-mile walk of a stop or station on the state map'], ['jobs_bike15', 'Jobs, 15-min ride', 'Jobs reachable in a 15-minute ride, typical home'], ['epa', 'EPA index', 'EPA National Walkability Index, 1 to 20']];
    return '<div class="actions wb-kind" role="group" aria-label="Show">' + [['place', 'Towns and CDPs'], ['county', 'Counties']].map(function (k) { return '<button type="button" class="button-link' + (kindPick === k[0] ? '' : ' secondary') + '" data-wb-kind="' + k[0] + '" aria-pressed="' + (kindPick === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>' +
      '<div class="table-scroll" role="region" tabindex="0" aria-label="Walking and biking by place"><table class="wb-table" data-no-sort><caption>' + esc(kindPick === 'county' ? 'All 64 counties' : rows.length + ' towns and CDPs') + '</caption><thead><tr>' +
      cols.map(function (c) { var on = sortKey === c[0]; return '<th scope="col" class="' + (c[0] === 'name' ? '' : 'num') + '" aria-sort="' + (on ? (sortDir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-wb-sort="' + c[0] + '" title="' + esc(c[2]) + '">' + esc(c[1]) + (on ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><td><a href="' + esc(href({ g: x.g })) + '">' + esc(x.name) + '</a></td><td class="num">' + esc(num(x.homes)) + '</td><td class="num">' + esc(pct(x.walk_reach)) + '</td><td class="num">' + esc(pct(x.bike_reach)) + '</td><td class="num">' + esc(pct(x.bike_calm_reach)) + '</td><td class="num">' + esc(pct(x.sidewalk_pct)) + '</td><td class="num">' + esc(pct(x.transit_reach)) + '</td><td class="num">' + esc(pct(x.thiz_pct)) + '</td><td class="num">' + esc(pct(x.half_mile_pct)) + '</td><td class="num">' + esc(x.jobs_bike15 == null ? '–' : num(x.jobs_bike15)) + '</td><td class="num">' + esc(x.epa == null ? '–' : x.epa.toFixed(1)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function sourcesBlock(doc) {
    var m = doc.meta, S = {};
    m.sources.forEach(function (s) { S[s.id] = s; });
    var tr = S['cotrex-trails'] || {};
    return '<section id="wb-about" tabindex="-1"><h2>How this is measured</h2>' +
      '<p>Each 2020 Census block with homes is joined to its nearest street. The route to the nearest service runs along <a href="' + LINKS.tiger + '">Census TIGER/Line 2025 streets</a> (interstates and ramps left out) and <a href="' + LINKS.cotrex + '">Colorado Parks and Wildlife COTREX trails</a> (' + esc(num(tr.segments)) + ' segments, last edited ' + esc(tr.data_last_edit || '–') + '). A home counts as within reach when that route is at most a 10-minute walk (half a mile at 3 mph) or a 15-minute ride (2.5 miles at 10 mph). Shares are of homes, so empty land does not count.</p>' +
      '<p>The ratings are relative, not fixed standards: they place a town among the Colorado towns with 200 or more homes. Top quarter, upper middle, lower middle and bottom quarter split those towns into four equal groups. A town at the bottom cut, such as one with no stop at all, is in the bottom quarter. An address is compared with the same towns. Cut points: walking ' + esc(m.bands.walk_reach.join('%, ')) + '%; biking ' + esc(m.bands.bike_reach.join('%, ')) + '%; transit ' + esc(m.bands.transit_reach.join('%, ')) + '%. Walking, biking and transit stay separate. There is no combined score.</p>' +
      '<p>State and local layers: highway stretches CDOT closes to bikes are left out of every biking figure. Off-street paths from local inventories join the network. The calmer ride uses side streets, trails and paths, and a state or US highway only where a bike lane, separated lane, bike boulevard or path runs beside it; shoulders and signed routes do not count. Sidewalk figures appear only where a sidewalk map covers at least 80% of homes. Local streets are classed by the Census, not by traffic, so a busy city street can still count as calm.</p>' +
      (localSources(m) ? '<ul class="wb-src">' + localSources(m) + '</ul>' : '') +
      '<p>Not counted yet: ' + esc(m.not_modelled.join(', ')) + '. Biking is labelled an estimate until hills are in. The EPA index (2021 data) is shown beside our route numbers as the national benchmark.</p>' +
      '<ul class="wb-src">' + Object.keys(m.services).map(function (k) { var s = m.services[k]; return '<li><strong>' + esc((SERVICES.filter(function (x) { return x[0] === k; })[0] || [k, k])[1]) + ':</strong> ' + esc(s.source) + ', ' + esc(String(s.generated || '').slice(0, 10)) + '. ' + esc(s.kept) + '.</li>'; }).join('') + '</ul>' +
      '<p class="note">' + esc(m.odbl_notice) + ' <a href="' + LINKS.osm + '">OpenStreetMap copyright</a>.</p></section>';
  }

  function localSources(m) {
    var ids = ['oedit-thiz', 'cdot-bike-prohibited', 'cdot-bike-paths', 'drcog-bike', 'drcog-sidewalks-2024', 'cos-bike', 'cos-sidewalks', 'cos-crosswalks', 'gj-bike'];
    return m.sources.filter(function (s) { return ids.indexOf(s.id) > -1; }).map(function (s) {
      return '<li><a href="' + esc(s.url) + '">' + esc(s.name) + '</a>: ' + esc(num(s.features)) + (s.id === 'oedit-thiz' ? ' stops and stations, map of ' + esc(s.vintage) + ', read ' : ' features, fetched ') + esc(s.fetched) + '.</li>';
    }).join('');
  }

  function csv(doc) {
    var head = ['geoid', 'name', 'kind', 'homes', 'walking_reach_pct', 'walking_band', 'biking_reach_pct', 'biking_band', 'transit_reach_pct', 'transit_band'].concat(
      SERVICES.map(function (s) { return 'walk_' + s[0] + '_pct'; }), SERVICES.map(function (s) { return 'bike_' + s[0] + '_pct'; }),
      ['walking_reach_straight_line_pct', 'walking_reach_streets_only_pct', 'biking_reach_streets_only_pct', 'jobs_15min_walk', 'jobs_15min_ride', 'epa_walkability_index', 'homes_off_network_pct',
       'biking_calmer_reach_pct', 'bike_inventory', 'bike_facility_km', 'walking_sidewalk_reach_pct', 'sidewalk_street_pct', 'sidewalk_source', 'sidewalk_mapped_homes_pct', 'possible_missing_sidewalk_km',
       'thiz_zone_homes_pct', 'stop_buffer_2mi_homes_pct', 'half_mile_walk_transit_homes_pct', 'half_mile_straight_transit_homes_pct', 'near_transit_homes', 'near_transit_walking_reach_pct', 'near_transit_biking_calmer_reach_pct', 'near_transit_sidewalk_walk_reach_pct', 'near_transit_sidewalk_street_pct']);
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [head.join(',')];
    [['place', doc.places], ['county', doc.counties]].forEach(function (pair) {
      Object.keys(pair[1]).forEach(function (g) {
        var x = pair[1][g];
        out.push([g, pair[0] === 'place' ? bare(x.name) : x.name, pair[0], x.homes, x.walk_reach, shown(x.bands.walk_reach), x.bike_reach, shown(x.bands.bike_reach), x.transit_reach, shown(x.bands.transit_reach)]
          .concat(SERVICES.map(function (s) { return x.walk[s[0]]; }), SERVICES.map(function (s) { return x.bike[s[0]]; }),
            [x.walk_reach_straight, x.walk_reach_roads, x.bike_reach_roads, x.jobs_walk15, x.jobs_bike15, x.epa_walk_index, x.off_network_pct,
             x.bike_calm_reach, x.bike_inventory, x.bike_facility_km, x.walk_sidewalk_reach, x.sidewalk_pct, x.sidewalk_source, x.sidewalk_mapped_homes_pct, x.missing_sidewalk_km],
            (function (T) { T = T || {}; var h = T.half_mile || {}; return [T.thiz_pct, T.stop_buffer_2mi_pct, T.half_mile_walk_pct, T.half_mile_straight_pct, h.homes, h.walk_reach, h.bike_calm_reach, h.walk_sidewalk_reach, T.half_mile_sidewalk_pct]; })(x.transit_areas)).map(q).join(','));
      });
    });
    out.push('');
    out.push('Sources');
    doc.meta.sources.forEach(function (s) { out.push(q(s.name) + ',' + q(s.url || s.file || '') + ',' + q(s.data_last_edit || s.vintage || s.fetched || '')); });
    Object.keys(doc.meta.services).forEach(function (k) { var s = doc.meta.services[k]; out.push(q(k + ': ' + s.source) + ',' + q(s.file) + ',' + q(s.generated)); });
    out.push(q('Built ' + doc.meta.generated + ' by ' + doc.meta.generated_by + ', Housing-Analytics'));
    out.push(q(doc.meta.method));
    out.push(q(doc.meta.odbl_notice));
    return out.join('\n') + '\n';
  }
  function save(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000); }

  // PNG: the export card (title, ratings, charts, map and sources) drawn to a canvas from its own SVGs.
  function pngOf(node, name) {
    var css = getComputedStyle(document.documentElement), tok = {};
    ['--pine', '--ink', '--muted', '--card', '--line', '--track', '--c-green', '--c-blue', '--rust', '--gold', '--map-0', '--map-1', '--map-2', '--map-3', '--map-4', '--map-5', '--map-empty', '--c-purple', '--c-amber', '--paper'].forEach(function (k) { tok[k] = css.getPropertyValue(k).trim(); });
    var W = 1200, pad = 40, y = pad, scale = 2;
    var c = document.createElement('canvas'), ctx = c.getContext('2d');
    var svgs = Array.prototype.slice.call(node.querySelectorAll('svg'));
    var title = node.getAttribute('data-title'), lines = (node.getAttribute('data-lines') || '').split('|');
    // Charts drawn at most 760 px wide so their text stays near its on-screen size; maps use the full width.
    var widths = svgs.map(function (s) { return s.closest('.wb-reach') ? Math.min(760, W - 2 * pad) : W - 2 * pad; });
    var heights = svgs.map(function (s, i) { var v = s.viewBox.baseVal; return widths[i] * v.height / v.width; });
    var caps = svgs.map(function (s) { var f = s.closest('figure'), c = f && f.querySelector('figcaption'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : ''; });
    ctx.font = '16px system-ui, sans-serif';
    function wrap(text, max) { var words = text.split(' '), out = [], line = ''; words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }); if (line) out.push(line); return out; }
    var capLines = caps.map(function (c) { return c ? wrap(c, W - 2 * pad) : []; });
    var H = pad + 60 + lines.length * 30 + 20 + heights.reduce(function (a, b, i) { return a + b + 16 + capLines[i].length * 22 + 20; }, 0) + 90;
    c.width = W * scale; c.height = H * scale; ctx.scale(scale, scale);
    ctx.fillStyle = tok['--card'] || 'white'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = tok['--pine']; ctx.font = '600 34px Georgia, serif'; ctx.fillText(title, pad, y + 34); y += 60;
    ctx.fillStyle = tok['--ink']; ctx.font = '20px system-ui, sans-serif';
    lines.forEach(function (l) { ctx.fillText(l, pad, y + 20); y += 30; });
    y += 20;
    function inline(svg) {
      var clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var all = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*'))), live = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')));
      all.forEach(function (el, i) {
        var cs = getComputedStyle(live[i]);
        ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight'].forEach(function (p) { var v = cs.getPropertyValue(p); if (v) el.style.setProperty(p, v); });
      });
      return new XMLSerializer().serializeToString(clone);
    }
    var jobs = svgs.map(function (s, i) {
      return new Promise(function (res) {
        var img = new Image(), u = URL.createObjectURL(new Blob([inline(s)], { type: 'image/svg+xml' }));
        img.onload = function () { res([img, i]); URL.revokeObjectURL(u); };
        img.onerror = function () { res([null, i]); };
        img.src = u;
      });
    });
    return Promise.all(jobs).then(function (imgs) {
      imgs.forEach(function (p) {
        var i = p[1];
        if (p[0]) ctx.drawImage(p[0], pad, y, widths[i], heights[i]);
        y += heights[i] + 16;
        ctx.fillStyle = tok['--ink']; ctx.font = '16px system-ui, sans-serif';
        capLines[i].forEach(function (l) { ctx.fillText(l, pad, y + 16); y += 22; });
        y += 20;
      });
      ctx.fillStyle = tok['--muted']; ctx.font = '15px system-ui, sans-serif';
      (node.getAttribute('data-source') || '').split('|').forEach(function (l) { ctx.fillText(l, pad, y + 16); y += 22; });
      return new Promise(function (res) { c.toBlob(function (b) { save(name, b); res(); }, 'image/png'); });
    });
  }

  function exportBar(r) {
    return '<div class="actions wb-export no-print"><button type="button" class="button-link" data-wb-export="pdf">Save as PDF</button>' +
      '<button type="button" class="button-link secondary" data-wb-export="png">Download image (PNG)</button>' +
      '<button type="button" class="button-link secondary" data-wb-export="csv">Download every place (CSV)</button><span class="note wb-export-status" role="status"></span></div>';
  }

  // Search: a town or county from the file, or an address through the Census Geocoder.
  function search(doc, q) {
    return '<form class="wb-search no-print" data-wb-search role="search"><label for="wb-q">Town, county or address</label>' +
      '<div class="wb-search-row"><input id="wb-q" name="wbq" list="wb-list" autocomplete="off" value="' + esc(q || '') + '" placeholder="Pueblo, Summit County, or 123 Main St, Salida">' +
      '<button type="submit" class="button-link">Show</button></div><datalist id="wb-list">' +
      Object.keys(doc.counties).map(function (g) { return '<option value="' + esc(doc.counties[g].name) + '"></option>'; }).join('') +
      Object.keys(doc.places).map(function (g) { return '<option value="' + esc(bare(doc.places[g].name)) + '"></option>'; }).join('') + '</datalist>' +
      '<p class="note wb-q-status" role="status">Addresses go to the free <a href="https://geocoding.geo.census.gov/geocoder/" rel="noopener">US Census Geocoder</a> when you press Show, and to <a href="https://nominatim.openstreetmap.org/" rel="noopener">OpenStreetMap</a> if Census has no match.</p></form>';
  }
  function findPick(doc, text) {
    var t = text.trim().toLowerCase();
    if (!t) return null;
    var hit = null;
    Object.keys(doc.counties).forEach(function (g) { var n = doc.counties[g].name.toLowerCase(); if (n === t || n === t + ' county') hit = hit || g; });
    Object.keys(doc.places).forEach(function (g) { if (bare(doc.places[g].name).toLowerCase() === t) hit = hit || g; });
    return hit;
  }

  function view() {
    var T = global.LabTpl, title = 'Walking and biking';
    var head = function (extra) { return T.head(Object.assign({ kind: 'data', crumbs: T.trail('places', title), title: title }, extra || {})); };
    var s = UI.load(FILES);
    if (s.error) return head() + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return head() + '<p role="status" class="note">Loading the walking and biking file…</p>';
    var doc = s.data.access, q = params(), pt = null, r = null, label = q.get('label');
    if (q.get('pt')) {
      pt = q.get('pt').split(',').map(Number);
      if (!(pt.length === 2 && isFinite(pt[0]) && isFinite(pt[1]))) pt = null;
    }
    var M = UI.load(MAP_FILES);
    if (pt && M.data) {
      var hitBg = M.data.bg.features.filter(function (f) { return inGeom(pt, f.geometry); })[0];
      r = hitBg ? bgRecord(doc, hitBg.properties.geoid || hitBg.properties.GEOID10) : null;
      if (r) r.name = label || 'This address';
    } else if (!pt) {
      r = record(doc, q.get('g'));
    }
    var picked = r && r.kind !== 'state';
    var st = doc.state;
    var answerText = picked ? esc(answer(r)) : 'Across Colorado, ' + esc(pct(st.walk.grocery)) + ' of homes are within a 10-minute walk of a grocery store by street and trail, and ' + esc(pct(st.bike.grocery)) + ' within a 15-minute bike ride. By straight line it would look like ' + esc(pct(st.walk_straight.grocery)) + '.';
    var out = head({ answer: answerText, meta: 'Built ' + esc(String(doc.meta.generated).slice(0, 10)) + ' from Census streets, state trails, 2020 Census homes and 2023 Census jobs data.' }) +
      search(doc, picked ? r.name : (label || ''));
    if (pt && !M.data) return out + '<p role="status" class="note">Loading the map files to place the address…</p>';
    if (pt && !r) return out + '<p class="callout">That point is not inside a Colorado block group with homes counted. Try a nearby street address or the town name.</p>';
    if (!r) r = record(doc, '08');
    var lines = [
      'Walking: ' + (shown(bandOf(doc, 'walk_reach', r.walk_reach)) || 'No data') + ', ' + pct(r.walk_reach) + ' of homes within a 10-minute walk of everyday services',
      'Biking: ' + (shown(bandOf(doc, 'bike_reach', r.bike_reach)) || 'No data') + ', ' + pct(r.bike_reach) + ' within a 15-minute ride (estimate)',
      'Transit: ' + (shown(bandOf(doc, 'transit_reach', r.transit_reach)) || 'No data') + ', ' + pct(r.transit_reach) + ' within a 10-minute walk of a fixed-route stop'];
    var srcLine = 'Sources: Census TIGER/Line 2025 streets; CPW COTREX trails; 2020 Census homes; LEHD LODES 2023 jobs; OpenStreetMap, HRSA and CDOT services.|Built ' + String(doc.meta.generated).slice(0, 10) + ' (Housing-Analytics, data/market/walk_bike_access_co.json). Routes by street and trail; hills not counted; sidewalks and bike lanes where local maps exist. Transit zone: OEDIT THIZ map.';
    var figSrc = '<p class="metric-source">Source: COHO walking and biking access, from Census TIGER/Line 2025 streets, CPW COTREX trails and 2020 Census homes; built ' + esc(String(doc.meta.generated).slice(0, 10)) + '.</p>';
    out += '<section class="wb-place" id="wb-card" data-title="' + esc('Walking and biking: ' + (r.name || '')) + '" data-lines="' + esc(lines.join('|')) + '" data-source="' + esc(srcLine) + '">' +
      '<p class="print-only wb-print-title">Walking and biking \u00b7 COHO Analytics \u00b7 ' + esc(String(doc.meta.generated).slice(0, 10)) + '</p>' + '<h2>' + esc(r.kind === 'bg' ? 'Around ' + r.name : r.name) + (r.homes ? ' <span class="note">' + esc(num(r.homes)) + ' homes</span>' : '') + '</h2>' +
      (r.kind === 'bg' ? '<p class="note">Readings for the 2010 block group this address sits in, the smallest area the file reports.</p>' : '') +
      cards(doc, r) +
      // A short dated source under each chart (format rule, 12 Nov); the full list stays at the foot of the card.
      ('<h3>What is within reach</h3>' + reachChart(r) + routeGap(r) + adds(r) + lanesAndSidewalks(r) + nearTransit(doc, r)).replace(/<\/figure>/g, '</figure>' + figSrc) +
      (r.kind === 'place' || r.kind === 'county' ? '<h3>How people here get to work</h3>' + modeShare(r.geoid) : '') +
      '<h3>Map</h3>' + (r.kind === 'state' ? (M.data ? stateMap(doc, M.data) : '<p class="note" role="status">Loading the map…</p>') : M.error ? '<p class="note">' + esc(M.error) + '</p>' : !M.data ? '<p class="note" role="status">Loading the map…</p>' : mapFor(doc, r, M.data, pt)) +
      '<p class="source-line">' + esc(srcLine.replace('|', ' ')) + '</p>' +
      '</section>' + exportBar(r) +
      '<section id="wb-all"><h2>Every place</h2><details class="wb-more"><summary>' + esc('Show all ' + Object.keys(doc.places).length + ' towns and 64 counties') + '</summary><p>Tap a column to sort. Tap a place to see its map and charts.</p>' + table(doc) + figSrc + '</details></section>' +
      sourcesBlock(doc) +
      T.source('Housing-Analytics, walking and biking access by route (data/market/walk_bike_access_co.json)', VENDOR + FILES.access, 'built ' + String(doc.meta.generated).slice(0, 10)) +
      T.source('EPA Smart Location Database v3.0, National Walkability Index', LINKS.epa, '2021 data') +
      T.source('U.S. Census Bureau, ACS 5-year, B08301 and S0801 (commute mode)', LINKS.b08301, '2020 to 2024') +
      T.next('Next', [{ href: '#/opportunity/commuting', label: 'Commuting and jobs →' }, { href: picked && r.kind !== 'bg' ? '#/place/' + r.geoid : '#/places', label: picked && r.kind !== 'bg' ? 'Needs assessment for ' + r.name : 'Find a place', secondary: true }, { href: '#/data/map', label: 'Data map', secondary: true }]);
    return out;
  }

  document.addEventListener('change', function (ev) {
    var c = ev.target.closest && ev.target.closest('[data-wb-layer]');
    if (!c) return;
    var k = c.getAttribute('data-wb-layer'), fig = c.closest('figure');
    hidden[k] = !c.checked;
    if (fig) fig.classList.toggle('wb-hide-' + k, !c.checked);
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest && ev.target.closest('form[data-wb-search]');
    if (!f) return;
    ev.preventDefault();
    var s = UI.load(FILES), doc = s.data && s.data.access, text = f.querySelector('input').value, st = f.querySelector('.wb-q-status');
    if (!doc) return;
    var g = findPick(doc, text);
    if (g) { location.hash = href({ g: g }); return; }
    if (!/\d/.test(text)) { st.textContent = 'No Colorado town or county by that name. Pick one from the list, or type a street address.'; return; }
    st.textContent = 'Looking up the address…';
    global.CohoGeocode.find(text).then(function (hit) {
      if (!hit) { st.textContent = 'No Colorado match from the US Census Geocoder or OpenStreetMap. Check the street name and town.'; return; }
      location.hash = href({ pt: hit.lon.toFixed(5) + ',' + hit.lat.toFixed(5), label: hit.label });
    }, function () { st.textContent = 'The address lookup did not answer. Try a town or county name, or try again.'; });
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-wb-sort],[data-wb-kind],[data-wb-export]');
    if (!b) return;
    if (b.dataset.wbSort) { var k = b.dataset.wbSort; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; } Shell.render(); return; }
    if (b.dataset.wbKind) { kindPick = b.dataset.wbKind; Shell.render(); return; }
    var s = UI.load(FILES), doc = s.data && s.data.access, st = document.querySelector('.wb-export-status');
    if (!doc) return;
    if (b.dataset.wbExport === 'csv') { save('colorado-walking-biking-by-place.csv', new Blob([csv(doc)], { type: 'text/csv;charset=utf-8' })); if (st) st.textContent = 'CSV saved, with a Sources block at the end.'; }
    if (b.dataset.wbExport === 'pdf') { global.print(); }
    if (b.dataset.wbExport === 'png') {
      var card = document.getElementById('wb-card');
      if (st) st.textContent = 'Drawing the image…';
      pngOf(card, 'walking-biking-' + String(card.getAttribute('data-title')).replace(/^.*: /, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png')
        .then(function () { if (st) st.textContent = 'Image saved.'; }, function () { if (st) st.textContent = 'The image could not be drawn in this browser. Use Save as PDF instead.'; });
    }
  });

  // Route: #/places/walk-bike, hooked in front of the Places hub the way places-state.js hooks its pages.
  var hub = Shell.views.places;
  Shell.views.places = function (p, parts) { return parts && parts[1] === 'walk-bike' ? view(p, parts) : hub(p, parts); };

  global.LabWalkBike = { view: view, FILES: FILES, MAP_FILES: MAP_FILES, record: record, bgRecord: bgRecord, bandOf: bandOf, shown: shown, answer: answer, csv: csv, findPick: findPick, inGeom: inGeom, SERVICES: SERVICES };
})(window);
