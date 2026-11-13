// Change arrows: one arrow per county, for any measure where "up" is worse (the "cartography of change" style).
// Tilt and colour say which way the county moved, length says how far, thickness says how many people it touches.
//   LabChangeArrows.layer(opts)  SVG markup (a <g>) to drop into a map's own <svg>
//   LabChangeArrows.legend(opts) a large three-row legend, as HTML
// opts for layer:
//   points   { geoid: [x, y] } arrow tails in the map's own coordinates (usually county centres)
//   change   { geoid: number } the change; positive = worse
//   weight   { geoid: number } optional, sizes the stroke in three steps (weightCuts)
//   flat     number, |change| below this draws a dot ("about the same"); default 1
//   per      pixels of arrow per unit of change; default 3.2. maxLen caps it; default 34
//   pick     geoid to ring, optional
//   centred  false to start the arrow at the point instead of centring it there
//   context  optional, from context(): state line and labelled towns, kept clear of the arrows
// Colours are palette names (--div-rose-strong worse, --c-blue better, --muted flat), so a palette change
// reaches every map that uses this. Written for the shared map kit to adopt; nothing here is rent-specific.
(function (global) {
  'use strict';

  var WORSE = 'var(--div-rose-strong)', BETTER = 'var(--c-blue)', FLAT = 'var(--muted)';

  function arrow(x, y, len, up, w, cls, mid) {
    var a = (up ? -55 : -125) * Math.PI / 180;
    // Centred on the point, so an arrow in a border county stays on the map.
    if (mid) { x -= len / 2 * Math.cos(a); y -= len / 2 * Math.sin(a); }
    var ex = x + len * Math.cos(a), ey = y + len * Math.sin(a), h = Math.min(3.5 + w * 1.1, 9);
    var h1 = [ex - h * Math.cos(a - 0.5), ey - h * Math.sin(a - 0.5)], h2 = [ex - h * Math.cos(a + 0.5), ey - h * Math.sin(a + 0.5)];
    var c = up ? WORSE : BETTER, f = function (v) { return v.toFixed(1); };
    // Inline style, not attributes: map stylesheets often set a stroke on every path (.need-map path).
    var st = ' style="stroke:' + c + ';stroke-width:' + w + 'px;fill:none;stroke-linecap:round;stroke-linejoin:round"';
    return '<g class="ca-a ' + cls + '">' +
      '<line x1="' + f(x) + '" y1="' + f(y) + '" x2="' + f(ex) + '" y2="' + f(ey) + '"' + st + '/>' +
      '<path d="M' + f(h1[0]) + ',' + f(h1[1]) + 'L' + f(ex) + ',' + f(ey) + 'L' + f(h2[0]) + ',' + f(h2[1]) + '"' + st + '/></g>';
  }

  function layer(o) {
    var flat = o.flat == null ? 1 : o.flat, per = o.per || 3.2, max = o.maxLen || 34, cuts = o.weightCuts || [10000, 50000];
    var widths = o.widths || [1.6, 2.6, 3.8], ctx = o.context, mid = o.centred !== false;
    var marks = Object.keys(o.change).filter(function (g) { return o.points[g] && o.change[g] != null; }).sort(function (a, b) {
      return (o.weight ? (o.weight[a] || 0) - (o.weight[b] || 0) : 0); // heavy arrows on top
    }).map(function (g) {
      var p = o.points[g], v = o.change[g], wt = o.weight ? o.weight[g] || 0 : cuts[0];
      var w = wt < cuts[0] ? widths[0] : wt < cuts[1] ? widths[1] : widths[2];
      var m = { g: g, w: w, dot: Math.abs(v) < flat, up: v > 0, len: Math.min(4 + Math.abs(v) * per, max), x: p[0], y: p[1] };
      if (!m.dot && mid) { var an = ang(m.up); m.x -= m.len / 2 * Math.cos(an); m.y -= m.len / 2 * Math.sin(an); }
      return m;
    });
    // Town labels are placed first; any arrow a label still touches is slid just clear of it.
    var labels = ctx ? towns(ctx, marks) : '';
    var out = marks.map(function (m) {
      var pick = m.g === o.pick ? ' ca-pick' : '';
      if (m.dot) return '<circle class="ca-dot' + pick + '" cx="' + m.x.toFixed(1) + '" cy="' + m.y.toFixed(1) + '" r="' + (m.w + 0.8).toFixed(1) + '" style="fill:' + FLAT + ';stroke:none"/>';
      return arrow(m.x, m.y, m.len, m.up, m.w, pick, false);
    });
    return (ctx ? ctx.under + ctx.state : '') + '<g class="ca-layer" aria-hidden="true" pointer-events="none">' + out.join('') + '</g>' + labels;
  }

  function ang(up) { return (up ? -55 : -125) * Math.PI / 180; }
  function seg(m) {
    if (m.dot) return [m.x, m.y, m.x, m.y];
    var an = ang(m.up); return [m.x, m.y, m.x + m.len * Math.cos(an), m.y + m.len * Math.sin(an)];
  }
  // Town labels: try right, left, above, below, and take the first that touches no arrow, grey dot or other label.
  function towns(ctx, marks) {
    var z = ctx.z, f = function (v) { return v.toFixed(1); }, taken = [];
    var hits = function (bx) {
      var n = 0, pad = z * 0.15;
      marks.forEach(function (m) {
        var s = seg(m), r = m.dot ? m.w + 0.8 : m.w / 2;
        for (var i = 0; i <= 8; i++) {
          var x = s[0] + (s[2] - s[0]) * i / 8, y = s[1] + (s[3] - s[1]) * i / 8;
          if (x + r > bx[0] - pad && x - r < bx[2] + pad && y + r > bx[1] - pad && y - r < bx[3] + pad) { n++; break; }
        }
      });
      taken.forEach(function (o) { if (o[0] < bx[2] && o[2] > bx[0] && o[1] < bx[3] && o[3] > bx[1]) n += 2; });
      if (bx[0] < ctx.box[0] || bx[2] > ctx.box[2] || bx[1] < ctx.box[1] || bx[3] > ctx.box[3]) n += 3;
      (ctx.keepOut || []).forEach(function (o) { if (o[0] < bx[2] && o[2] > bx[0] && o[1] < bx[3] && o[3] > bx[1]) n += 5; });
      return n;
    };
    var labels = '';
    ctx.towns.forEach(function (t) {
      var wd = t.name.length * z * 0.5, gap = z * 0.5, best = null;
      var opts = [
        { a: 'start', x: t.x + gap, y: t.y + z * 0.35, bx: [t.x + gap, t.y - z * 0.5, t.x + gap + wd, t.y + z * 0.5] },
        { a: 'end', x: t.x - gap, y: t.y + z * 0.35, bx: [t.x - gap - wd, t.y - z * 0.5, t.x - gap, t.y + z * 0.5] },
        { a: 'middle', x: t.x, y: t.y - gap - z * 0.2, bx: [t.x - wd / 2, t.y - gap - z * 1.05, t.x + wd / 2, t.y - gap + z * 0.05] },
        { a: 'middle', x: t.x, y: t.y + gap + z * 0.8, bx: [t.x - wd / 2, t.y + gap - z * 0.05, t.x + wd / 2, t.y + gap + z * 1.05] }
      ];
      if (t.left) opts.unshift(opts.splice(1, 1)[0]);
      opts.forEach(function (c) { c.n = hits(c.bx); if (!best || c.n < best.n) best = c; });
      taken.push(best.bx);
      labels += '<rect x="' + f(best.bx[0] - z * 0.2) + '" y="' + f(best.bx[1] - z * 0.05) + '" width="' + f(best.bx[2] - best.bx[0] + z * 0.4) + '" height="' + f(best.bx[3] - best.bx[1] + z * 0.1) + '" rx="' + f(z * 0.25) + '" style="fill:var(--card);fill-opacity:.72;stroke:var(--line-strong);stroke-width:' + f(z * 0.05) + 'px"/>' +
        '<text x="' + f(best.x) + '" y="' + f(best.y) + '" text-anchor="' + best.a + '" class="ca-city" style="font-size:' + z + 'px">' + t.name + '</text>';
    });
    // Slide any arrow or dot that a label box touches out of it, the shortest way, a few passes so it does not land on another.
    var pad = z * 0.25;
    for (var pass = 0; pass < 4; pass++) taken.forEach(function (bx) {
      marks.forEach(function (m) {
        var s = seg(m), r = (m.dot ? m.w + 0.8 : m.w / 2 + 1.5) + pad;
        var x0 = Math.min(s[0], s[2]) - r, x1 = Math.max(s[0], s[2]) + r, y0 = Math.min(s[1], s[3]) - r, y1 = Math.max(s[1], s[3]) + r;
        if (!touches(s, m.dot ? m.w + 0.8 : m.w / 2 + 1.5, bx, pad)) return;
        var mv = [[bx[0] - x1, 0], [bx[2] - x0, 0], [0, bx[1] - y1], [0, bx[3] - y0]].sort(function (a, b) { return Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]); })[0];
        m.x += mv[0]; m.y += mv[1];
      });
    });
    return '<g class="ca-cities" aria-hidden="true" pointer-events="none">' + labels + '</g>';
  }
  function touches(s, r, bx, pad) {
    for (var i = 0; i <= 10; i++) {
      var x = s[0] + (s[2] - s[0]) * i / 10, y = s[1] + (s[3] - s[1]) * i / 10;
      if (x + r > bx[0] - pad && x - r < bx[2] + pad && y + r > bx[1] - pad && y - r < bx[3] + pad) return true;
    }
    return false;
  }

  // opts: worse, better, flat (the three row labels, each [title, line]), none (optional row for places not
  // compared, drawn with the map kit's hatch swatch), size (one sentence on length/thickness)
  function legend(o) {
    var icon = function (up) {
      return '<svg class="ca-lg-i" viewBox="0 0 44 30" aria-hidden="true">' + arrow(up ? 10 : 34, 26, 26, up, 3.5, '') + '</svg>';
    };
    var row = function (i, t) { return '<li>' + i + '<span><b>' + t[0] + '</b>' + (t[1] ? '<br>' + t[1] : '') + '</span></li>'; };
    return '<ul class="ca-legend">' + row(icon(true), o.worse) + row(icon(false), o.better) +
      row('<svg class="ca-lg-i" viewBox="0 0 44 30" aria-hidden="true"><circle cx="22" cy="15" r="4.5" fill="' + FLAT + '"/></svg>', o.flat) +
      (o.none ? row('<span class="mk-sw mk-sw-none ca-lg-none" aria-hidden="true"></span>', o.none) : '') + '</ul>' +
      (o.size ? '<p class="ca-size">' + o.size + '</p>' : '');
  }

  // Centre of a county's largest ring, in the map's coordinates; project(lonlat) -> [x, y].
  function centres(features, project, idKey) {
    var out = {};
    features.forEach(function (f) {
      var polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates], best = null;
      polys.forEach(function (p) { if (!best || p[0].length > best.length) best = p[0]; });
      var sx = 0, sy = 0;
      best.forEach(function (c) { var q = project(c); sx += q[0]; sy += q[1]; });
      out[f.properties[idKey || 'GEOID']] = [sx / best.length, sy / best.length];
    });
    return out;
  }

  // Bearings for a map with no fill: the state line and a few labelled cities, so the arrows have a place.
  // project(lonlat) -> [x, y]; o.size is the label size in the map's own units (pick it so it renders ~12px).
  // The anchor cities are the map kit's (site/map-kit.js), so every map names the same places.
  var CITIES = global.LabMap.CITIES;
  var STATE = [[-109.05, 41.0], [-102.04, 41.0], [-102.04, 37.0], [-109.05, 37.0]];
  // Pass the result to layer() as o.context: it draws the state line under the arrows and the towns on top,
  // and puts each town label on a see-through box where it covers the fewest arrows. Nothing is moved.
  // o.places: GeoJSON features of incorporated towns, drawn as a light grey shape under the county lines and arrows.
  // o.keepOut: boxes [x0, y0, x1, y1] labels must stay out of, such as a map's own zoom buttons.
  // o.town(props, name, d, style): optional, returns the markup for one town shape (to make it a link or a button).
  // o.lines: county outlines (one path d) redrawn above the town shapes, so county lines stay on top.
  function context(project, o) {
    o = o || {};
    var z = o.size || 13, f = function (v) { return v.toFixed(1); }, xs = [], ys = [];
    var ring = function (r) {
      var last = '', out = [];
      r.forEach(function (c) { var q = project(c), k = f(q[0]) + ',' + f(q[1]); if (k !== last) out.push(k); last = k; });
      return out.length > 2 ? 'M' + out.join('L') + 'Z' : '';
    };
    // One shape per town, so each can be tapped. o.town(props, pathHtml) may wrap it (a link) or add attributes.
    var style = ' style="fill:var(--ink-soft);fill-opacity:.28;stroke:var(--ink-soft);stroke-opacity:.45;stroke-width:' + f(z * 0.04) + 'px"';
    var towns = (o.places || []).map(function (ft) {
      var g = ft.geometry; if (!g) return '';
      var d = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(function (p) { return p.map(ring).join(''); }).join('');
      if (!d) return '';
      var name = String(ft.properties.name || '').replace(/ (city|town|CDP)$/i, '').replace(/[&<>"]/g, '');
      return o.town ? o.town(ft.properties, name, d, style) : '<path class="ca-town" d="' + d + '"' + style + '><title>' + name + '</title></path>';
    }).join('');
    var under = (towns ? '<g class="ca-towns">' + towns + '</g>' : '') +
      (o.lines ? '<path class="ca-lines" d="' + o.lines + '" style="fill:none;stroke:var(--muted);stroke-width:' + f(z * (o.lineW || 0.075)) + 'px" aria-hidden="true" pointer-events="none"/>' : '');
    var line = 'M' + STATE.map(function (c) { var q = project(c); xs.push(q[0]); ys.push(q[1]); return f(q[0]) + ',' + f(q[1]); }).join('L') + 'Z';
    return {
      z: z, under: under, keepOut: o.keepOut || [], box: [Math.min.apply(0, xs), Math.min.apply(0, ys), Math.max.apply(0, xs), Math.max.apply(0, ys)],
      towns: CITIES.map(function (c) { var q = project([c[1], c[2]]); return { name: c[0], x: q[0], y: q[1], left: c[0] === 'Fort Collins' || c[0] === 'Denver' }; }),
      state: '<path class="ca-state" d="' + line + '" style="fill:none;stroke:var(--ink);stroke-width:' + f(z * 0.16) + 'px;stroke-linejoin:round" aria-hidden="true"/>'
    };
  }

  // Incorporated towns (not Census-designated places) of at least min people (default 20,000), using the
  // population reading in data/market/market-types.json. Places it has no population for are left off.
  function bigTowns(shapes, types, min) {
    var by = (types && types.places) || {}, cut = min || 20000;
    return shapes.features.filter(function (f) {
      var t = by[f.properties.geoid], pop = t && t.readings && t.readings.population;
      return f.properties.type === 'place' && pop >= cut;
    });
  }

  global.LabChangeArrows = { bigTowns: bigTowns, layer: layer, legend: legend, centres: centres, context: context };
})(window);
