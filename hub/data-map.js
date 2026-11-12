// Data map (#/data/map). The site's own map files, up to three at once, drawn from their own coordinates over
// the Census county outlines with no map tiles, so the page stays light. Areas draw see-through, so where
// two designations overlap shows. One search box finds a county or town from the site's own files, or an
// address through the free US Census Geocoder (only when the visitor presses Enter). A tap or a search opens
// "What's here": the county, whether the spot is inside a Qualified Census Tract, a Difficult Development Area
// or an Opportunity Zone, and the nearest place from each point layer that is on. Every answer is read from
// the same files the map draws; nothing here makes a figure of its own.
//
// Address: ?layers=lihtc,qct (up to three, oldest drops first) &at=c:<county GEOID> | p:<place GEOID> |
// pt:<lng>,<lat> &label=<what was searched>. The old ?layer=<id> still opens that one layer.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;
  var VENDOR = global.LAB_VENDOR;
  var LIVE = 'https://cohoanalytics.com/';
  var MAX_ON = 3;

  // shape: 'fill' (see-through fill), 'hatch' (diagonal lines), 'outline' (dashed edge), 'dot' (points).
  var LAYERS = [
    { id: 'lihtc', glyph: 'circle', group: 'Affordable housing', label: 'Tax credit properties', file: 'data/chfa-lihtc.json', kind: 'point', shape: 'dot', color: 'var(--layer-lihtc)', src: 'CHFA', name: function (p) { return p.PROJECT + ', ' + p.PROJ_CTY + (p.N_UNITS ? ': ' + num(p.N_UNITS) + ' homes' : ''); }, short: function (p) { return p.PROJECT + ', ' + p.PROJ_CTY; } },
    { id: 'qct', group: 'Tax credit designations', label: 'Qualified Census Tracts', file: 'data/qct-colorado.json', kind: 'area', shape: 'fill', color: 'var(--layer-qct)', src: 'HUD, 2026 list', county: function (p) { return p.STATE && p.COUNTY ? p.STATE + p.COUNTY : null; }, name: function (p) { return (p.NAME || 'Census tract') + ' (' + p.GEOID + ')'; } },
    { id: 'dda', group: 'Tax credit designations', label: 'Difficult Development Areas', file: 'data/dda-colorado.json', kind: 'area', shape: 'hatch', color: 'var(--rust)', src: 'HUD, 2026 list', county: function (p) { return p.DDA_KIND === 'county' ? p.GEOID : null; }, name: function (p) { return p.DDA_NAME || p.NAME || 'Difficult Development Area'; } },
    { id: 'oz', group: 'Tax credit designations', label: 'Opportunity Zones (2018)', file: 'data/market/opportunity_zones_co.geojson', kind: 'area', shape: 'outline', color: 'var(--layer-oz)', src: 'US Treasury', county: function (p) { return p.county_fips || null; }, name: function (p) { return 'Tract ' + p.geoid; } },
    { id: 'jobs', glyph: 'square', group: 'Jobs and services', label: 'Job centers', file: 'data/market/employment_centers_co.geojson', kind: 'point', shape: 'dot', color: 'var(--layer-jobs)', src: 'Census LEHD', min: function (p) { return p.totalJobs >= 2000; }, name: function (p) { return p.name; } },
    { id: 'schools', glyph: 'diamond', group: 'Jobs and services', label: 'Schools', file: 'data/market/schools_co.geojson', kind: 'point', shape: 'dot', color: 'var(--layer-schools)', src: 'NCES 2021–22', name: function (p) { return p.school_name; } },
    { id: 'hospitals', glyph: 'cross', group: 'Jobs and services', label: 'Hospitals', file: 'data/market/hospitals_co.geojson', kind: 'point', shape: 'dot', color: 'var(--layer-hospitals)', src: 'HIFLD and CDPHE', name: function (p) { return p.name; } },
    { id: 'clinics', glyph: 'tdown', group: 'Jobs and services', label: 'Community health centers', file: 'data/market/health_centers_co.geojson', kind: 'point', shape: 'dot', color: 'var(--layer-clinics)', src: 'HRSA', name: function (p) { return p.name; } },
    { id: 'grocery', glyph: 'triangle', group: 'Jobs and services', label: 'Grocery stores', file: 'data/amenities/grocery_co.geojson', kind: 'point', shape: 'dot', color: 'var(--layer-grocery)', src: 'OpenStreetMap', name: function (p) { return p.name || 'Grocery store'; } },
    { id: 'parks', glyph: 'ring', group: 'Jobs and services', label: 'Parks', file: 'data/amenities/parks_co.geojson', kind: 'point', shape: 'dot', color: 'var(--layer-parks)', src: 'OpenStreetMap', name: function (p) { return p.name || 'Park'; } }
  ];
  var BY_ID = {};
  LAYERS.forEach(function (l) { BY_ID[l.id] = l; });
  // "What's here" always answers these three for a searched or tapped spot, drawn or not.
  var DESIGNATIONS = ['qct', 'dda', 'oz'];
  var COUNTIES = 'data/boundaries/counties_co.geojson', PLACES = 'data/co-place-centroids.json';
  var LIVE_ONLY = ['Place boundaries', 'Census tracts', 'Transit stops', 'Retail centers', 'Flood zones', 'Natural and road barriers', 'Commute flows', 'Environmental burden', 'FEMA floodplain (live service)'];

  // ---------- projection (plain equirectangular at Colorado's latitude) ----------
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  var BOX = K.BOX, xy = K.pt;
  function lnglat(p) { return [BOX.w + p[0] / MAP_W * (BOX.e - BOX.w), BOX.n - p[1] / MAP_H * (BOX.n - BOX.s)]; }
  // Rings are drawn at map scale: points closer than a tenth of a unit to the last kept one add nothing
  // visible, even zoomed in.
  function ringPath(ring) {
    var out = [], last = null;
    ring.forEach(function (c) {
      var p = xy(c);
      if (last && Math.abs(p[0] - last[0]) < 0.1 && Math.abs(p[1] - last[1]) < 0.1) return;
      out.push(p[0].toFixed(2) + ' ' + p[1].toFixed(2)); last = p;
    });
    return out.length > 2 ? 'M' + out.join('L') + 'Z' : '';
  }
  function polys(g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function pathOf(g) { return polys(g).map(function (p) { return p.map(ringPath).join(''); }).join(''); }
  function inColorado(c) { return c && c[0] <= -100 && c[0] >= -110 && c[1] >= 36 && c[1] <= 42; }
  function pointOf(f) { return f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null; }

  // ---------- geometry ----------
  function inRing(pt, ring) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Even-odd across a polygon's rings, so holes count as outside.
  function inGeom(pt, g) {
    return polys(g).some(function (poly) {
      var n = 0;
      poly.forEach(function (ring) { if (inRing(pt, ring)) n++; });
      return n % 2 === 1;
    });
  }
  function bboxOf(g) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    polys(g).forEach(function (poly) { poly[0].forEach(function (c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }); });
    return b;
  }
  // Average of the outer ring's vertices: where an area sits, for counting it in a county.
  function middleOf(g) {
    var ring = (polys(g)[0] || [])[0] || [], x = 0, y = 0;
    ring.forEach(function (c) { x += c[0]; y += c[1]; });
    return ring.length ? [x / ring.length, y / ring.length] : null;
  }
  function miles(a, b) {
    var R = 3958.8, rad = Math.PI / 180;
    var dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- files: each loads once, when first needed ----------
  var files = {};
  function need(path) {
    var f = files[path];
    if (!f) {
      f = files[path] = { data: null, error: null };
      fetch(VENDOR + path).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); })
        .then(function (d) { f.data = d; Shell.render(); })
        .catch(function (e) { f.error = e.message; Shell.render(); });
    }
    return f;
  }
  function feats(L) {
    var f = files[L.file];
    if (!f || !f.data) return null;
    if (!f.list) f.list = (f.data.features || []).filter(function (x) { return x.geometry && (!L.min || L.min(x.properties || {})); });
    return f.list;
  }

  // ---------- address state ----------
  function onIds(params) {
    var raw = params.get('layers');
    if (raw == null) raw = params.get('layer') || 'lihtc';
    var seen = {};
    return raw.split(',').filter(function (id) { if (!BY_ID[id] || seen[id]) return false; seen[id] = 1; return true; }).slice(-MAX_ON);
  }
  function href(ids, at, label) {
    var q = 'layers=' + ids.join(',');
    if (at) q += '&at=' + encodeURIComponent(at);
    if (at && label) q += '&label=' + encodeURIComponent(label);
    return '#/data/map?' + q;
  }
  function toggled(ids, id) {
    if (ids.indexOf(id) >= 0) return ids.filter(function (x) { return x !== id; });
    return ids.concat([id]).slice(-MAX_ON);
  }

  function placeName(raw) { return String(raw || '').replace(/ (city|town|CDP|city and county)$/i, ''); }
  function placeKind(raw) {
    var m = /(city and county|city|town|CDP)$/i.exec(String(raw || ''));
    return !m ? 'place' : /CDP/i.test(m[1]) ? 'census place' : m[1].toLowerCase();
  }

  // Where the map should show, and the spot "What's here" describes, for an `at` value.
  function target(at, label, counties, places) {
    if (!at) return null;
    var m;
    if ((m = /^c:(\d{5})$/.exec(at)) && counties) {
      var c = counties.features.filter(function (f) { return f.properties.GEOID === m[1]; })[0];
      if (!c) return null;
      return { kind: 'county', geoid: m[1], label: c.properties.NAMELSAD, feature: c, box: bboxOf(c.geometry) };
    }
    if ((m = /^p:(\d{7})$/.exec(at)) && places) {
      var p = (places.byGeoid || {})[m[1]];
      if (!p) return null;
      var pt = [p.lng, p.lat];
      return { kind: 'place', geoid: m[1], label: placeName(p.name), sub: placeKind(p.name), pt: pt, box: [pt[0] - 0.12, pt[1] - 0.08, pt[0] + 0.12, pt[1] + 0.08] };
    }
    if ((m = /^pt:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(at))) {
      var q = [Number(m[1]), Number(m[2])];
      if (!inColorado(q)) return null;
      return { kind: 'point', label: label || null, pt: q, box: [q[0] - 0.05, q[1] - 0.035, q[0] + 0.05, q[1] + 0.035] };
    }
    return null;
  }
  // The svg viewBox that frames a lng/lat box at the map's own shape, with a margin.
  function frame(b) {
    var a = xy([b[0], b[3]]), z = xy([b[2], b[1]]);
    var w = (z[0] - a[0]) * 1.25, h = (z[1] - a[1]) * 1.25;
    w = Math.max(w, h * MAP_W / MAP_H, 6);
    h = w * MAP_H / MAP_W;
    var cx = (a[0] + z[0]) / 2, cy = (a[1] + z[1]) / 2;
    return [cx - w / 2, cy - h / 2, w, h];
  }

  // ---------- "What's here" ----------
  function hereRows(t, ids, counties) {
    var rows = [];
    if (t.kind === 'county') {
      var cf = t.feature;
      LAYERS.forEach(function (L) {
        if (ids.indexOf(L.id) < 0 && DESIGNATIONS.indexOf(L.id) < 0) return;
        var list = feats(L);
        if (!list) { rows.push({ L: L, text: 'Loading…' }); return; }
        var n = list.filter(function (f) {
          if (L.kind === 'point') { var c = pointOf(f); return c && inGeom(c, cf.geometry); }
          var code = L.county && L.county(f.properties || {});
          if (code) return code === t.geoid;
          var mid = middleOf(f.geometry);
          return mid && inGeom(mid, cf.geometry);
        }).length;
        var noun = L.kind === 'point' ? L.label.toLowerCase() : L.id === 'dda' ? (n === 1 ? 'area' : 'areas') : (n === 1 ? 'tract' : 'tracts');
        rows.push({ L: L, text: n ? num(n) + ' ' + noun : 'None', yes: n > 0 });
      });
      return rows;
    }
    var pt = t.pt;
    var county = counties && counties.features.filter(function (f) { return inGeom(pt, f.geometry); })[0];
    rows.push({ head: 'County', text: county ? county.properties.NAMELSAD : 'Outside Colorado’s counties' });
    LAYERS.forEach(function (L) {
      if (L.kind !== 'area' || (ids.indexOf(L.id) < 0 && DESIGNATIONS.indexOf(L.id) < 0)) return;
      var list = feats(L);
      if (!list) { rows.push({ L: L, text: 'Loading…' }); return; }
      var hit = list.filter(function (f) { return inGeom(pt, f.geometry); })[0];
      rows.push({ L: L, text: hit ? 'Yes: ' + L.name(hit.properties || {}) : 'No', yes: !!hit });
    });
    LAYERS.forEach(function (L) {
      if (L.kind !== 'point' || ids.indexOf(L.id) < 0) return;
      var list = feats(L);
      if (!list) { rows.push({ L: L, text: 'Loading…' }); return; }
      var best = null, bestD = Infinity;
      list.forEach(function (f) { var c = pointOf(f); if (!c) return; var d = miles(pt, c); if (d < bestD) { bestD = d; best = f; } });
      rows.push({ L: L, text: best ? 'Nearest: ' + (L.short || L.name)(best.properties || {}) + ', ' + (bestD < 0.1 ? 'under 0.1' : bestD.toFixed(1)) + ' mi' : 'None in the file' });
    });
    return rows;
  }
  function herePanel(t, ids, counties) {
    if (!t) return '<aside class="dm-here" aria-live="polite"><h2>What’s here</h2><p class="note">Tap the map, or find an address, town or county, to see what is true at that spot.</p></aside>';
    var title = t.kind === 'point' ? (t.label || 'This spot') : t.label;
    var sub = t.kind === 'county' ? 'County' : t.kind === 'place' ? 'Town center (' + t.sub + ')' : (t.label ? 'Address' : 'Tapped spot');
    var rows = hereRows(t, ids, counties);
    return '<aside class="dm-here" aria-live="polite"><h2>What’s here</h2>' +
      '<p class="dm-here-place"><strong>' + esc(title) + '</strong> <span class="note">' + esc(sub) + '</span></p>' +
      '<dl>' + rows.map(function (r) {
        var name = r.head || r.L.label;
        return '<div class="dm-row' + (r.yes ? ' is-yes' : '') + '"><dt>' + (r.L ? swatch(r.L) : '') + esc(name) + '</dt><dd>' + esc(r.text) + '</dd></div>';
      }).join('') + '</dl>' +
      (t.kind === 'county' ? '<p class="note">Counts are what the map files place in the county. An area that crosses a county line counts where its middle falls.</p>'
        : '<p class="note">Read from the same files the map draws. Distances are straight-line.</p>') +
      '<p><a href="' + esc(href(ids)) + '">Clear</a></p></aside>';
  }

  // A ring (hollow circle) is drawn as a thick-edged circle; every other shape comes from the map kit.
  function glyphD(g, x, y, r) { return K.glyph(g, x, y, r); }
  function swatch(L) {
    var s = L.shape, c = L.color;
    var inner = s === 'dot' ? (L.glyph && L.glyph !== 'circle' ? '<path d="' + glyphD(L.glyph, 7, 7, 4.4) + '" fill="' + c + '" fill-rule="evenodd" stroke="var(--halo)" stroke-width="1"/>' : '<circle cx="7" cy="7" r="4" fill="' + c + '" stroke="var(--halo)" stroke-width="1"/>')
      : s === 'fill' ? '<rect x="1" y="1" width="12" height="12" rx="2" fill="' + c + '" fill-opacity=".35" stroke="' + c + '"/>'
      : s === 'hatch' ? '<rect x="1" y="1" width="12" height="12" rx="2" fill="none" stroke="' + c + '"/><path d="M1 9L9 1M5 13L13 5M1 13L13 1" stroke="' + c + '" stroke-width="1.4"/>'
      : '<rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="' + c + '" fill-opacity=".08" stroke="' + c + '" stroke-width="1.6" stroke-dasharray="3 2"/>';
    return '<svg class="dm-swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' + inner + '</svg>';
  }

  // ---------- the page ----------
  var lastAt = null, pickerOpen = null;
  function view(params) {
    var ids = onIds(params), at = params.get('at'), label = params.get('label');
    var on = ids.map(function (id) { return BY_ID[id]; });
    var cs = need(COUNTIES), ps = need(PLACES);
    on.forEach(function (L) { need(L.file); });
    if (at) DESIGNATIONS.forEach(function (id) { need(BY_ID[id].file); });

    // Keep the reader's zoom across re-renders (a layer switched, a tap, a file arriving); a new search
    // target zooms to it instead.
    var old = global.document && global.document.querySelector('.data-map .pm-frame > svg');
    var keep = old && old.getAttribute('viewBox');
    var t = target(at, label, cs.data, ps.data);
    var zoom = null;
    if (t && at !== lastAt && (t.kind !== 'point' || label)) zoom = frame(t.box).map(function (n) { return +n.toFixed(2); }).join(' ');
    else if (keep) zoom = keep;

    if (pickerOpen == null) pickerOpen = !(global.innerWidth && global.innerWidth < 640);
    var picker = '<details class="dm-picker"' + (pickerOpen ? ' open' : '') + '><summary>Layers <span class="dm-count">' + ids.length + ' of ' + MAX_ON + ' on</span></summary>' +
      '<p class="note">Turn on up to three. A fourth turns the first one off.</p>' +
      '<nav class="dm-chips" aria-label="Map layers">' + ['Affordable housing', 'Tax credit designations', 'Jobs and services'].map(function (g) {
        return '<div class="dm-group"><p class="dm-group-h">' + esc(g) + '</p><ul>' + LAYERS.filter(function (x) { return x.group === g; }).map(function (x) {
          var isOn = ids.indexOf(x.id) >= 0;
          return '<li><a class="chip' + (isOn ? ' is-on' : '') + '" href="' + esc(href(toggled(ids, x.id), at, label)) + '" aria-pressed="' + isOn + '" data-layer="' + x.id + '">' + swatch(x) + esc(x.label) + '</a></li>';
        }).join('') + '</ul></div>';
      }).join('') + '</nav></details>';
    var search = '<form class="dm-search" data-dm-search role="search" autocomplete="off">' +
      '<label for="dm-q">Find an address, town or county</label>' +
      '<div class="dm-search-row"><input id="dm-q" name="dmq" type="search" placeholder="e.g. Pueblo, Eagle County, 1313 Sherman St Denver" value="' + esc(label || (t && t.kind !== 'point' ? t.label : '')) + '" aria-describedby="dm-q-help" aria-autocomplete="list" aria-controls="dm-suggest">' +
      '<button type="submit">Find</button></div>' +
      '<ul class="dm-suggest" id="dm-suggest" role="listbox" hidden></ul>' +
      '<p class="note" id="dm-q-help">Towns and counties come from the site’s own files. Addresses go to the free <a href="https://geocoding.geo.census.gov/geocoder/" rel="noopener">US Census Geocoder</a> when you press Find, and to <a href="https://nominatim.openstreetmap.org/" rel="noopener">OpenStreetMap</a> if Census has no match.</p>' +
      '<p class="dm-status" role="status"></p></form>';
    var head = T.head({
      kind: 'data', crumbs: T.trail('data', 'Data map'), title: 'Data map',
      answer: 'The site’s map files over Colorado’s 64 counties. Turn on up to three layers to see where they overlap, find a place, or tap the map to see what is true at that spot.'
    }) + search;

    if (cs.error) return head + picker + '<p class="callout">The county outlines did not load (' + esc(cs.error) + ').</p>';
    var waiting = on.filter(function (L) { return !files[L.file].data && !files[L.file].error; });
    if (!cs.data || waiting.length) return head + picker + '<p role="status" class="note">Loading ' + esc((waiting.length ? waiting.map(function (L) { return L.label.toLowerCase(); }).join(', ') : 'county outlines')) + '…</p>';

    var outline = cs.data.features.map(function (f) {
      return '<path d="' + pathOf(f.geometry) + '"' + (t && t.kind === 'county' && f.properties.GEOID === t.geoid ? ' class="is-picked"' : '') + '><title>' + esc(f.properties.NAMELSAD) + '</title></path>';
    }).join('');
    // Areas under points; within areas, outlines over fills so both read.
    var order = on.slice().sort(function (a, b) { return rank(a) - rank(b); });
    function rank(L) { return L.kind === 'point' ? 3 : L.shape === 'outline' ? 2 : L.shape === 'hatch' ? 1 : 0; }
    var legend = [], insetGroups = [];
    var layers = order.map(function (L) {
      var st = files[L.file];
      if (st.error) { legend.push({ L: L, text: 'did not load (' + st.error + ')' }); return ''; }
      var list = feats(L), shapes = [], drawn = 0, near = [];
      list.forEach(function (f) {
        var tip = '<title>' + esc(L.name(f.properties || {})) + '</title>';
        if (L.kind === 'area') { var d = pathOf(f.geometry); if (d) { shapes.push('<path d="' + d + '">' + tip + '</path>'); drawn++; } return; }
        var c = pointOf(f);
        if (!c || c[0] > -100 || c[0] < -110) return;
        var p = xy(c);
        if (K.inMetro(c[0], c[1])) near.push({ lon: c[0], lat: c[1], r: 5, shape: L.glyph, label: esc(L.name(f.properties || {})) });
        // Map kit part 2 (Gemini round 15, pick 3): each point layer has its own shape, so jobs and parks, which
        // look alike to red-blind readers, stay apart. The zoom handler below redraws the shapes at screen size.
        shapes.push(L.glyph && L.glyph !== 'circle' ? '<path class="dm-g" data-g="' + L.glyph + '" data-x="' + p[0].toFixed(2) + '" data-y="' + p[1].toFixed(2) + '" d="' + glyphD(L.glyph, p[0], p[1], 2.6) + '">' + tip + '</path>'
          : '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="2.6">' + tip + '</circle>');
        drawn++;
      });
      var meta = st.data.meta || {};
      var asOf = day(st.data.fetchedAt || meta.generated || meta.generated_at) || (st.data.designationYear ? String(st.data.designationYear) : null);
      legend.push({ L: L, n: drawn, asOf: asOf });
      if (L.kind === 'point' && near.length) insetGroups.push({ cls: 'dm-point dm-inset-' + L.id, style: '--c:' + L.color, dots: near });
      return '<g class="dm-layer dm-' + L.kind + ' dm-' + L.shape + '" data-layer="' + L.id + '" style="--c:' + L.color + '"' + (L.shape === 'hatch' ? ' fill="url(#dm-hatch-' + L.id + ')"' : '') + '>' + shapes.join('') + '</g>';
    }).join('');
    var defs = '<defs>' + on.filter(function (L) { return L.shape === 'hatch'; }).map(function (L) {
      return '<pattern id="dm-hatch-' + L.id + '" class="dm-pattern" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="' + L.color + '" fill-opacity=".10"/><line x1="0" y1="0" x2="0" y2="5" stroke="' + L.color + '" stroke-width="1.6" stroke-opacity=".75"/></pattern>';
    }).join('') + '</defs>';
    var pin = t && t.pt ? (function () { var p = xy(t.pt); return '<g class="dm-pin"><circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="5"><title>' + esc(t.label || 'Tapped spot') + '</title></circle></g>'; })() : '';
    legend.sort(function (a, b) { return ids.indexOf(a.L.id) - ids.indexOf(b.L.id); });
    var legendHtml = legend.length ? '<ul class="dm-legend" aria-label="Layers on the map">' + legend.map(function (r) {
      var L = r.L;
      return '<li>' + swatch(L) + '<span class="dm-legend-name"><strong>' + esc(L.label) + '</strong> <span class="note">' +
        (r.text ? esc(r.text) : esc(num(r.n) + (L.kind === 'area' ? ' areas' : ' places') + (L.id === 'jobs' ? ' (tracts with 2,000 or more jobs)' : '') + '. ' + L.src + (r.asOf ? ', ' + r.asOf : '') + '.')) +
        ' <a href="' + esc('#/data/explorer?file=' + encodeURIComponent(L.file.replace(/^data\//, ''))) + '">File</a></span></span>' +
        '<a class="dm-off" href="' + esc(href(toggled(ids, L.id), at, label)) + '" aria-label="' + esc('Turn off ' + L.label) + '">Off</a></li>';
    }).join('') + '</ul>' : '<p class="note dm-legend-empty">No layers on. Pick one above.</p>';
    // Map kit part 2: a visible title that says what is drawn, with the counts, not alt text.
    var drawnL = legend.filter(function (r) { return !r.text; });
    var mapTitle = drawnL.length ? drawnL.map(function (r) { return num(r.n) + ' ' + r.L.label.replace(/^./, function (c) { return c.toLowerCase(); }); }).join(', ').replace(/, ([^,]*)$/, ' and $1') + ' across Colorado' + (t ? ', around ' + (t.label || 'the tapped spot') : '') : 'Colorado, with no layers on';
    var aria = 'Map of Colorado' + (on.length ? ' showing ' + on.map(function (L) { return L.label; }).join(', ') : '') + (t ? ', centered on ' + (t.label || 'a tapped spot') : '');

    lastAt = at;
    return head +
      '<div class="dm-layout">' + picker + '<figure class="pres-map data-map"><figcaption><strong>' + esc(mapTitle) + '</strong></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" data-map="data" data-zoom-max="40"' + (zoom ? ' data-zoom="' + esc(zoom) + '"' : '') + ' role="img" aria-label="' + esc(aria) + '">' + defs +
      '<g class="pm-counties">' + outline + '</g>' + layers + pin + (insetGroups.length && !zoom ? K.metroBox() : '') + K.cities() + '</svg></div>' +
      legendHtml +
      // Map kit part 3: the Denver metro close-up of the point layers, when the map is not zoomed in already.
      (insetGroups.length && !zoom ? K.inset({ features: cs.data ? cs.data.features : [], groups: insetGroups }) : '') +
      '<p class="note metric-source">Each layer’s source and date are in the key above. County outlines: US Census TIGER. Town centers: 2024 Census Gazetteer.</p></figure>' +
      herePanel(t, ids, cs.data) + '</div>' +
      '<p class="note">Larger layers stay on the <a href="' + LIVE + 'data-map-browser.html">live data map ↗</a>: ' + esc(LIVE_ONLY.join(', ')) + '.</p>' +
      T.next('Next', [{ href: '#/opportunities', label: 'Where homes can be built or kept →' }, { href: '#/data/explorer', label: 'Every data file', secondary: true }]);
  }
  function day(iso) { return iso ? String(iso).slice(0, 10) : null; }

  // ---------- search ----------
  function suggestions(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    var out = [], cs = files[COUNTIES] && files[COUNTIES].data, ps = files[PLACES] && files[PLACES].data;
    function score(name) { var n = name.toLowerCase(); return n.indexOf(q) === 0 ? 0 : n.indexOf(' ' + q) >= 0 ? 1 : n.indexOf(q) >= 0 ? 2 : -1; }
    if (cs) cs.features.forEach(function (f) { var s = score(f.properties.NAMELSAD); if (s >= 0) out.push({ at: 'c:' + f.properties.GEOID, name: f.properties.NAMELSAD, sub: 'county', s: s }); });
    if (ps) Object.keys(ps.byGeoid || {}).forEach(function (g) { var p = ps.byGeoid[g], n = placeName(p.name), s = score(n); if (s >= 0) out.push({ at: 'p:' + g, name: n, sub: placeKind(p.name), s: s + 0.5 }); });
    out.sort(function (a, b) { return a.s - b.s || a.name.localeCompare(b.name); });
    return out.slice(0, 6);
  }
  function currentIds() { return onIds(new URLSearchParams((location.hash.split('?')[1]) || '')); }
  function go(at, label) { location.hash = href(currentIds(), at, label); }
  function status(form, text) { var s = form.querySelector('.dm-status'); if (s) s.textContent = text; }

  // Addresses: the US Census Geocoder first, OpenStreetMap when Census has no match (site/geocode.js).
  function findAddress(form, q) {
    status(form, 'Looking up the address…');
    global.CohoGeocode.find(q).then(function (hit) {
      if (!hit) { status(form, 'No Colorado match from the US Census Geocoder or OpenStreetMap. Check the street name and town, or tap the map.'); return; }
      if (!inColorado([hit.lon, hit.lat])) { status(form, 'That address is outside Colorado.'); return; }
      go('pt:' + hit.lon.toFixed(5) + ',' + hit.lat.toFixed(5), hit.label);
      status(form, global.CohoGeocode.note(hit));
    }, function () {
      status(form, 'The address lookup did not answer. Try a town or county name, or try again.');
    });
  }

  function renderSuggest(form) {
    var input = form.querySelector('input[name="dmq"]'), box = form.querySelector('.dm-suggest');
    var list = suggestions(input.value);
    box.innerHTML = list.map(function (s, i) {
      return '<li role="option" id="dm-opt-' + i + '"><button type="button" data-at="' + esc(s.at) + '" data-name="' + esc(s.name) + '">' + esc(s.name) + ' <span class="note">' + esc(s.sub) + '</span></button></li>';
    }).join('');
    box.hidden = !list.length;
    input.setAttribute('aria-expanded', String(!!list.length));
  }

  if (global.document) {
    var doc = global.document, tapTimer = null;
    doc.addEventListener('input', function (ev) {
      var form = ev.target.form;
      if (form && form.hasAttribute('data-dm-search')) { status(form, ''); renderSuggest(form); }
    });
    doc.addEventListener('submit', function (ev) {
      var form = ev.target;
      if (!form.hasAttribute || !form.hasAttribute('data-dm-search')) return;
      ev.preventDefault();
      var q = form.querySelector('input[name="dmq"]').value.trim();
      if (!q) return;
      var list = suggestions(q);
      var exact = list.filter(function (s) { return s.name.toLowerCase() === q.toLowerCase() || s.name.toLowerCase() === q.toLowerCase().replace(/,? ?(co|colorado)$/, ''); })[0];
      if (exact) return go(exact.at);
      if (!/\d/.test(q) && list.length) return go(list[0].at);
      if (/\d/.test(q)) return findAddress(form, q);
      status(form, 'No Colorado town or county by that name. For a street address, include the number.');
    });
    doc.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.dm-suggest button');
      if (b) { ev.preventDefault(); go(b.getAttribute('data-at')); return; }
      // A tap on the map (not a pan, not a pinch) opens "What's here" for that spot.
      var svg = ev.target.closest && ev.target.closest('svg[data-map="data"]');
      if (!svg) return;
      clearTimeout(tapTimer);
      // A double-click zooms; wait a moment so it is not taken as two taps.
      if (ev.defaultPrevented || ev.detail > 1) return;
      var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      var c = lnglat([vb.x + (ev.clientX - r.left) / r.width * vb.width, vb.y + (ev.clientY - r.top) / r.height * vb.height]);
      if (!inColorado(c)) return;
      tapTimer = setTimeout(function () { location.hash = href(currentIds(), 'pt:' + c[0].toFixed(5) + ',' + c[1].toFixed(5)); }, 260);
    });
    doc.addEventListener('keydown', function (ev) {
      var form = ev.target.form || (ev.target.closest && ev.target.closest('form[data-dm-search]'));
      if (!form || !form.hasAttribute || !form.hasAttribute('data-dm-search')) return;
      var btns = Array.prototype.slice.call(form.querySelectorAll('.dm-suggest button'));
      if (!btns.length) return;
      var i = btns.indexOf(doc.activeElement);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); btns[Math.min(btns.length - 1, i + 1)].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (i <= 0) form.querySelector('input').focus(); else btns[i - 1].focus(); }
      else if (ev.key === 'Escape') { form.querySelector('.dm-suggest').hidden = true; form.querySelector('input').focus(); }
    });
    doc.addEventListener('toggle', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('dm-picker')) pickerOpen = ev.target.open;
    }, true);
    // Dots and hatching keep their size on screen as the map zooms.
    doc.addEventListener('mapzoom', function (ev) {
      var svg = ev.target;
      if (!svg.getAttribute || svg.getAttribute('data-map') !== 'data') return;
      // Screen pixels per map unit at this zoom, so sizes are set in screen pixels.
      var s = ev.detail.scale, ppu = (svg.getBoundingClientRect().width || MAP_W) / (MAP_W / s);
      var dot = (2.2 + 2.3 * Math.min(1, Math.log(s) / Math.log(8))) / ppu, pin = 7 / ppu;
      Array.prototype.forEach.call(svg.querySelectorAll('.dm-point circle'), function (c) { c.setAttribute('r', dot.toFixed(3)); });
      Array.prototype.forEach.call(svg.querySelectorAll('.dm-point path.dm-g'), function (g) { g.setAttribute('d', glyphD(g.getAttribute('data-g'), +g.getAttribute('data-x'), +g.getAttribute('data-y'), dot)); });
      Array.prototype.forEach.call(svg.querySelectorAll('.dm-pin circle'), function (c) { c.setAttribute('r', pin.toFixed(3)); });
      Array.prototype.forEach.call(svg.querySelectorAll('.dm-pattern'), function (p) { p.setAttribute('patternTransform', 'rotate(45) scale(' + (1 / s).toFixed(4) + ')'); });
    });
  }

  global.LabDataMap = { view: view, LAYERS: LAYERS, target: target, frame: frame, inGeom: inGeom, suggestions: suggestions, onIds: onIds, toggled: toggled, xy: xy, lnglat: lnglat, hereRows: hereRows, files: files, MAX_ON: MAX_ON };
})(window);
