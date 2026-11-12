// The lab's one map kit. Every statewide Colorado map draws through it, so the outline, the anchor city
// labels and the legend standard are set once here, the way site/palette.css sets the colours once.
//
//   LabMap.BOX, .W, .H      the statewide frame: Colorado's bounding box at 720 map units wide, plain
//                           equirectangular at 39° N (the state is a near-rectangle, so this reads true)
//   LabMap.x(lon), .y(lat)  map units, unrounded; .pt([lon, lat]) gives both
//   LabMap.ring(r), .path(geometry)   SVG path data, one decimal, for a GeoJSON ring or (Multi)Polygon
//   LabMap.cities(o)        the anchor city labels as one SVG group, drawn on top and never tappable.
//                           o.project([lon, lat]) -> [x, y] for a map in another frame; o.only: names to keep
//   LabMap.CITIES           [name, lon, lat], the 2024 Census Gazetteer centroids that Housing-Analytics
//                           keeps in data/co-place-centroids.json (place GEOIDs in the comment below)
//
// City labels hold one size on screen (12px) whatever the map's width or zoom: each label is drawn in screen
// pixels inside a group that CSS scales by --mk-k, map units per screen pixel. fit() sets --mk-k on each map on draw, on resize and on every zoom step from site/map-zoom.js.
(function (global) {
  'use strict';

  var BOX = { w: -109.06, e: -102.04, s: 36.99, n: 41.01 };
  var W = 720, H = Math.round(W * (BOX.n - BOX.s) / ((BOX.e - BOX.w) * Math.cos(39 * Math.PI / 180)));
  function x(lon) { return (lon - BOX.w) / (BOX.e - BOX.w) * W; }
  function y(lat) { return (BOX.n - lat) / (BOX.n - BOX.s) * H; }
  function pt(c) { return [x(c[0]), y(c[1])]; }
  function ring(r) { return 'M' + r.map(function (c) { return x(c[0]).toFixed(1) + ' ' + y(c[1]).toFixed(1); }).join('L') + 'Z'; }
  function polys(g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function path(g) { return polys(g).map(function (p) { return p.map(ring).join(''); }).join(''); }

  // Denver 0820000, Colorado Springs 0816000, Fort Collins 0827425, Pueblo 0862000, Grand Junction 0831660,
  // Durango 0822035, Glenwood Springs 0830780, Alamosa 0801090. qa/map-kit.test.js checks them against the file.
  var CITIES = [['Denver', -104.881105, 39.76185], ['Colorado Springs', -104.760749, 38.867255], ['Fort Collins', -105.064833, 40.548216],
    ['Pueblo', -104.610816, 38.269228], ['Grand Junction', -108.567452, 39.089062], ['Durango', -107.874124, 37.264534],
    ['Glenwood Springs', -107.342556, 39.547132], ['Alamosa', -105.876956, 37.474528]];

  // Each label sits east of its dot, over open ground: the Front Range cities face the plains, and the
  // western ones have room before the next label. The spacing holds down to a 300px-wide map.
  function cities(o) {
    o = o || {};
    var project = o.project || pt, f = function (v) { return v.toFixed(1); };
    var keep = o.only ? CITIES.filter(function (c) { return o.only.indexOf(c[0]) !== -1; }) : CITIES;
    return '<g class="mk-cities" aria-hidden="true" pointer-events="none">' + keep.map(function (c) {
      var q = project([c[1], c[2]]);
      return '<g transform="translate(' + f(q[0]) + ' ' + f(q[1]) + ')"><g class="mk-city"><circle r="3" class="mk-city-dot"></circle>' +
        '<text class="mk-city-name" x="6" y="4">' + c[0] + '</text></g></g>';
    }).join('') + '</g>';
  }

  // ---- keeping the labels one size on screen ----
  var doc = global.document;
  function fit(svg) {
    if (!svg || !svg.viewBox || !svg.getBoundingClientRect) return;
    var w = svg.getBoundingClientRect().width, vb = svg.viewBox.baseVal;
    if (!w || !vb || !vb.width) return;
    svg.style.setProperty('--mk-k', (vb.width / w).toFixed(3));
  }
  function fitAll(root) {
    if (!doc) return;
    Array.prototype.forEach.call((root || doc).querySelectorAll('svg'), function (s) { if (s.querySelector('.mk-cities')) fit(s); });
  }
  if (doc && doc.addEventListener) {
    doc.addEventListener('mapzoom', function (ev) { fit(ev.target && ev.target.closest ? ev.target.closest('svg') : null); });
    var queued = false, later = function () {
      if (queued) return; queued = true;
      (global.requestAnimationFrame || setTimeout)(function () { queued = false; fitAll(); });
    };
    global.addEventListener('resize', later);
    if (typeof MutationObserver !== 'undefined' && doc.body) new MutationObserver(later).observe(doc.body, { childList: true, subtree: true });
    else doc.addEventListener('DOMContentLoaded', function () {
      if (typeof MutationObserver !== 'undefined') new MutationObserver(later).observe(doc.body, { childList: true, subtree: true });
      later();
    });
  }

  // ---- map kit part 2: the marks every map shares (cartography review steps 2 to 4; Gemini rounds 10 C, 15 pick 3) ----
  // Thin data: a county with fewer than 5,000 homes (ACS total housing units, Housing-Analytics
  // data/co-county-demographics.json) carries wide survey margins, so it gets a dotted overlay, never a different colour.
  var THIN = 5000;
  // The file is keyed by county name ("Adams"), so features (county GeoJSON with GEOID and NAME) map it to FIPS.
  function thinSet(cdemo, features) {
    var c = (cdemo && cdemo.counties) || {}, out = {};
    (features || []).forEach(function (f) {
      var p = f.properties || {}, row = c[String(p.NAME || '').replace(/ County$/, '')], u = row && row.total_housing_units;
      if (u != null && isFinite(u) && u < THIN) out[p.GEOID] = true;
    });
    return out;
  }
  // Pattern fills for "not published" (a hatch, never a pale grey that reads as the lowest class) and thin data
  // (dots over the class colour). Ids are unique to each drawing so a folded map never borrows another's.
  var uid = 0;
  function marks() {
    var id = 'mk' + (++uid);
    return {
      defs: '<defs><pattern id="' + id + '-none" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">' +
        '<rect width="7" height="7" fill="var(--map-empty)"/><path d="M0 0V7" stroke="var(--grey-line)" stroke-width="2.4"/></pattern>' +
        '<pattern id="' + id + '-thin" patternUnits="userSpaceOnUse" width="8" height="8"><circle cx="4" cy="4" r="1.3" fill="var(--ink)" fill-opacity=".6"/></pattern></defs>',
      none: 'url(#' + id + '-none)', thin: 'url(#' + id + '-thin)'
    };
  }
  // Legend swatches for the two marks, to sit with any map's own swatches (styles in templates.css).
  var KEY_NONE = '<span class="mk-sw mk-sw-none" aria-hidden="true"></span>', KEY_THIN = '<span class="mk-sw mk-sw-thin" aria-hidden="true"></span>';
  // Classes with numbers: for a shaded map, each class's lowest and highest value and how many places it holds,
  // so a legend never says only "Less" and "More". cls(v) must give the class index the map itself used.
  function classes(vals, n, cls) {
    var out = []; for (var i = 0; i < n; i++) out.push({ lo: null, hi: null, count: 0 });
    vals.forEach(function (v) {
      if (v == null || !isFinite(v)) return;
      var c = out[cls(v)]; if (!c) return;
      c.count++; c.lo = c.lo == null ? v : Math.min(c.lo, v); c.hi = c.hi == null ? v : Math.max(c.hi, v);
    });
    return out;
  }
  // Point marks by shape as well as colour, so layers that look alike to red-blind readers stay apart.
  // glyph(shape, x, y, r): SVG path data centred on x, y, about r across the middle.
  function glyph(shape, x, y, r) {
    var f = function (v) { return v.toFixed(2); }, k;
    if (shape === 'square') { k = r * 0.9; return 'M' + f(x - k) + ' ' + f(y - k) + 'h' + f(2 * k) + 'v' + f(2 * k) + 'h' + f(-2 * k) + 'Z'; }
    if (shape === 'diamond') { k = r * 1.25; return 'M' + f(x) + ' ' + f(y - k) + 'L' + f(x + k) + ' ' + f(y) + 'L' + f(x) + ' ' + f(y + k) + 'L' + f(x - k) + ' ' + f(y) + 'Z'; }
    if (shape === 'triangle') { k = r * 1.3; return 'M' + f(x) + ' ' + f(y - k) + 'L' + f(x + k * 0.95) + ' ' + f(y + k * 0.7) + 'L' + f(x - k * 0.95) + ' ' + f(y + k * 0.7) + 'Z'; }
    if (shape === 'tdown') { k = r * 1.3; return 'M' + f(x) + ' ' + f(y + k) + 'L' + f(x + k * 0.95) + ' ' + f(y - k * 0.7) + 'L' + f(x - k * 0.95) + ' ' + f(y - k * 0.7) + 'Z'; }
    if (shape === 'cross') { k = r * 1.15; var t = k * 0.38; return 'M' + f(x - t) + ' ' + f(y - k) + 'h' + f(2 * t) + 'v' + f(k - t) + 'h' + f(k - t) + 'v' + f(2 * t) + 'h' + f(t - k) + 'v' + f(k - t) + 'h' + f(-2 * t) + 'v' + f(t - k) + 'h' + f(t - k) + 'v' + f(-2 * t) + 'h' + f(k - t) + 'Z'; }
    if (shape === 'ring') return glyph('circle', x, y, r * 1.1) + glyph('circle', x, y, r * 0.5); // draw with fill-rule evenodd
    return 'M' + f(x - r) + ' ' + f(y) + 'a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(2 * r) + ' 0a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(-2 * r) + ' 0Z';
  }
  // The thin-data overlay for a statewide county map: the counties in thin (from thinSet), in the dotted pattern.
  // o.d(feature) gives the path data when the map draws in its own frame.
  function thinLayer(features, thin, mk, o) {
    var d = (o && o.d) || function (f) { return path(f.geometry); };
    return '<g class="mk-thin-layer" aria-hidden="true">' + (features || []).filter(function (f) { return thin[f.properties.GEOID]; })
      .map(function (f) { return '<path d="' + d(f) + '" fill="' + mk.thin + '"/>'; }).join('') + '</g>';
  }
  // A 14px legend swatch in the same shape.
  function glyphKey(shape, color) {
    return '<svg class="mk-glyph-key" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="' + glyph(shape, 7, 7, 4.6) + '" fill="' + color + '" stroke="var(--halo)" stroke-width="1"/></svg>';
  }

  // ---- map kit part 3: the Denver metro close-up (cartography review, step 3) ----
  // At 390px the Front Range's dots merge into one blob, so the five statewide dot maps add a boxed close-up of the
  // metro beside (desktop) or under (phone) the state map. The box on the state map marks the same ground.
  // Metro cities: 2024 Census Gazetteer centroids, Housing-Analytics data/co-place-centroids.json
  // (Boulder 0807850, Aurora 0804000, Lakewood 0843000, Thornton 0877290, Littleton 0845255).
  var METRO = { w: -105.32, e: -104.66, s: 39.48, n: 40.10 };
  var METRO_CITIES = [['Denver', -104.881105, 39.76185], ['Boulder', -105.251251, 40.024431], ['Aurora', -104.720509, 39.709537, 'w'],
    ['Lakewood', -105.117573, 39.698939], ['Thornton', -104.941413, 39.920433], ['Littleton', -105.020084, 39.590375]];
  var MW = 720, MH = Math.round(MW * (METRO.n - METRO.s) / ((METRO.e - METRO.w) * Math.cos(39.79 * Math.PI / 180)));
  function mx(lon) { return (lon - METRO.w) / (METRO.e - METRO.w) * MW; }
  function my(lat) { return (METRO.n - lat) / (METRO.n - METRO.s) * MH; }
  function mpt(c) { return [mx(c[0]), my(c[1])]; }
  function mring(r) { return 'M' + r.map(function (c) { return mx(c[0]).toFixed(1) + ' ' + my(c[1]).toFixed(1); }).join('L') + 'Z'; }
  function inMetro(lon, lat) { return lon >= METRO.w && lon <= METRO.e && lat >= METRO.s && lat <= METRO.n; }
  // The box drawn on the state map, in state map units.
  function metroBox() {
    var x0 = x(METRO.w), y0 = y(METRO.n), w = x(METRO.e) - x0, h = y(METRO.s) - y0;
    return '<rect class="mk-metro-box" x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" aria-hidden="true" pointer-events="none"/>';
  }
  // o: { features: county GeoJSON, dots: [{ lon, lat, r, fill, cls, label, href, shape, attrs }], title, note }
  // r is in the close-up's own units (about 3 to 12 reads well); dots outside the box are left out.
  function inset(o) {
    var outline = (o.features || []).map(function (f) {
      return '<path d="' + polys(f.geometry).map(function (pg) { return pg.map(mring).join(''); }).join('') + '"/>';
    }).join('');
    var n = 0;
    // o.groups: [{ cls, layer, dots }] keeps each layer in its own group, so a page's layer switches reach the close-up too.
    var one = function (list) { return (list || []).filter(function (d) { return d.lon != null && inMetro(d.lon, d.lat); }).map(function (d) {
      n++;
      var p = mpt([d.lon, d.lat]), t = d.label ? '<title>' + d.label + '</title>' : '', a = ' fill="' + (d.fill || 'var(--rust)') + '"' + (d.attrs || '');
      var m = d.shape && d.shape !== 'circle' ? '<path class="mk-g" d="' + glyph(d.shape, p[0], p[1], d.r || 5) + '"' + a + '>' + t + '</path>'
        : '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (d.r || 5).toFixed(1) + '"' + a + '>' + t + '</circle>';
      return d.href ? '<a href="' + d.href + '">' + m + '</a>' : m;
    }).join(''); };
    var dots = o.groups ? o.groups.map(function (g) { return '<g class="pm-layer ' + (g.cls || '') + '"' + (g.layer ? ' data-layer="' + g.layer + '"' : '') + (g.style ? ' style="' + g.style + '"' : '') + '>' + one(g.dots) + '</g>'; }).join('') : one(o.dots);
    var labels = '<g class="mk-cities" aria-hidden="true" pointer-events="none">' + METRO_CITIES.map(function (c) {
      var q = mpt([c[1], c[2]]);
      // A city near the box's east edge ('w') is labelled to the west of its dot, so the label stays in the box.
      return '<g transform="translate(' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ')"><g class="mk-city"><circle r="3" class="mk-city-dot"></circle><text class="mk-city-name" ' + (c[3] === 'w' ? 'x="-6" text-anchor="end"' : 'x="6"') + ' y="4">' + c[0] + '</text></g></g>';
    }).join('') + '</g>';
    return '<div class="mk-inset"><p class="mk-inset-h"><strong>' + (o.title || 'Denver metro close-up') + '</strong> <span class="note">' + n.toLocaleString('en-US') + ' marks inside the box drawn on the state map' + (o.note ? '. ' + o.note : '') + '</span></p>' +
      '<svg class="mk-inset-svg" viewBox="0 0 ' + MW + ' ' + MH + '" role="img" aria-label="' + (o.title || 'Denver metro close-up') + ': ' + n.toLocaleString('en-US') + ' marks">' +
      '<g class="mk-inset-counties">' + outline + '</g>' + dots + labels + '</svg></div>';
  }

  global.LabMap = { METRO: METRO, METRO_CITIES: METRO_CITIES, metroBox: metroBox, inset: inset, inMetro: inMetro, THIN: THIN, thinSet: thinSet, marks: marks, KEY_NONE: KEY_NONE, KEY_THIN: KEY_THIN, classes: classes, glyph: glyph, glyphKey: glyphKey, thinLayer: thinLayer, BOX: BOX, W: W, H: H, x: x, y: y, pt: pt, ring: ring, path: path, polys: polys, CITIES: CITIES, cities: cities, fit: fit, fitAll: fitAll };
})(typeof window !== 'undefined' ? window : this);
