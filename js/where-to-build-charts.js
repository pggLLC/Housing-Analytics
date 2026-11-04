/* Where Should I Build? graphics (developer-where.html).
   Five plain-SVG charts drawn from the same scorer and the same weights and filters as the tiers below them,
   so a slider move redraws them. Data marks use only the approved --chart-1..7 tokens; "not tiered" is
   the muted text colour. Every chart has an aria-label and a source line.
   The summaries (group split, rank range, coverage) are pure functions so the test can check them in node. */
(function (root) {
  'use strict';

  // ---- Pure summaries ----------------------------------------------------------------------------------

  /** Points each slider group earns toward a place's score (sums to the base score before signals and flags). */
  function groupSplit(s) {
    var out = {};
    s.parts.forEach(function (p) { out[p.group] = (out[p.group] || 0) + (p.contribution || 0); });
    return out;
  }

  /** For each of the top places, its best and worst rank when any one weighted group is set to 0,
      ranked as the page ranks (whole-number score, then name). */
  function rankRange(W, places, weights, topGeoids) {
    var ranks = {};
    W.GROUPS.forEach(function (g) {
      if (!(Number(weights[g.id]) > 0)) return;
      var w2 = {}; Object.keys(weights).forEach(function (k) { w2[k] = weights[k]; }); w2[g.id] = 0;
      places.map(function (p) { return { g: p.geoid, s: W.score(p, w2).score, n: p.name }; })
        .sort(function (a, b) { return b.s - a.s || a.n.localeCompare(b.n); })
        .forEach(function (x, i) { (ranks[x.g] = ranks[x.g] || []).push(i + 1); });
    });
    return topGeoids.map(function (g) {
      var r = ranks[g] || [];
      return { geoid: g, best: r.length ? Math.min.apply(0, r) : null, worst: r.length ? Math.max.apply(0, r) : null, runs: r.length };
    });
  }

  /** Rows with a recorded value (points not null), per factor, across the places given. */
  function coverage(W, places) {
    var out = [];
    W.GROUPS.forEach(function (g) {
      g.factors.forEach(function (id) {
        var n = places.filter(function (p) { return p.factors[id] && p.factors[id].points != null; }).length;
        out.push({ id: id, group: g.id, label: (W.FACTORS && W.FACTORS[id] && W.FACTORS[id].label) || id, checked: n, of: places.length });
      });
    });
    return out.sort(function (a, b) { return b.checked - a.checked; });
  }

  // ---- Drawing -----------------------------------------------------------------------------------------

  var NS = 'http://www.w3.org/2000/svg';
  // Data marks use only the approved WCAG AA chart tokens (--chart-1 to --chart-7, css/site-theme.css; Rule 10).
  var C = {
    target: 'var(--chart-3)', promising: 'var(--chart-1)', monitor: 'var(--chart-4)', none: 'var(--muted)',
    full: 'var(--chart-3)', partial: 'var(--chart-4)', range: 'var(--chart-1)', now: 'var(--chart-6)',
    line: 'var(--border)', text: 'var(--text)', muted: 'var(--muted)', paper: 'var(--card)'
  };
  var TIER = { 1: C.target, 2: C.promising, 3: C.monitor };
  var CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)'];
  // Past seven groups the tokens repeat at half opacity, so up to 14 groups stay apart.
  function groupFill(j) { return { fill: CHART[j % 7], opacity: j >= 7 ? 0.5 : 1 }; }

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(id, w, h, label) {
    var host = document.getElementById(id); host.innerHTML = '';
    var s = el('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img', 'aria-label': label, class: 'wtb-svg' });
    host.appendChild(s); return s;
  }
  function text(p, x, y, t, o) {
    o = o || {};
    p.appendChild(el('text', { x: x, y: y, 'font-size': o.size || 11.5, 'text-anchor': o.anchor, 'font-weight': o.bold ? 700 : null,
      fill: o.muted ? C.muted : C.text, stroke: o.halo ? C.paper : null, 'stroke-width': o.halo ? 3 : null, 'paint-order': o.halo ? 'stroke' : null,
      transform: o.rotate ? 'rotate(' + o.rotate + ' ' + x + ' ' + y + ')' : null }, t));
  }
  function dot(p, x, y, r, fill, hollow) {
    p.appendChild(el('circle', { cx: x, cy: y, r: r, fill: hollow ? C.paper : fill, stroke: hollow ? fill : C.paper, 'stroke-width': hollow ? 1.6 : 0.6 }));
  }
  function line(p, x1, y1, x2, y2, o) { o = o || {}; p.appendChild(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: o.color || C.line, 'stroke-width': o.width || 1, 'stroke-dasharray': o.dash, 'stroke-linecap': o.cap })); }
  function rect(p, x, y, w, h, fill, o) { o = o || {}; p.appendChild(el('rect', { x: x, y: y, width: Math.max(0, w), height: Math.max(0, h), fill: fill, 'fill-opacity': o.opacity, stroke: o.stroke, 'stroke-width': o.strokeWidth })); }
  function legend(p, x, y, items) {
    var cx = x;
    items.forEach(function (it) {
      if (it[0] === 'box') rect(p, cx, y - 5, 12, 10, it[1]); else dot(p, cx + 6, y, 5, it[1], it[0] === 'hollow');
      text(p, cx + 17, y + 4, it[2], { size: 11 });
      cx += 26 + it[2].length * 6.2;
    });
  }
  function noOverlap(s, items) {
    var boxes = [];
    items.forEach(function (it) {
      var w = it.t.length * 6.4, x = it.anchor === 'end' ? it.x - w : it.x;
      if (boxes.some(function (b) { return x < b[0] + b[2] + 3 && b[0] < x + w + 3 && Math.abs(it.y - b[1]) < 14; })) return;
      boxes.push([x, it.y, w]); text(s, it.x, it.y, it.t, { anchor: it.anchor, bold: true, halo: true });
    });
  }
  function short(n) { return String(n || '').replace(/ \((city|town|CDP)\)$/, function (m, t) { return t === 'CDP' ? ' CDP' : ''; }); }
  function src(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }

  function tierMap(rows, cen, geo) {
    var pts = rows.filter(function (x) { return x.p.type !== 'county' && cen[x.p.geoid]; });
    var W = 820, H = 590, x0 = -109.06, y1 = 41.0, k = Math.cos(39 * Math.PI / 180), sc = Math.min((W - 20) / (7.02 * k), (H - 50) / 4.01);
    var X = function (lon) { return 10 + (lon - x0) * k * sc; }, Y = function (lat) { return 10 + (y1 - lat) * sc; };
    var s = svg('wtbMap', W, H, 'Map of ' + pts.length + ' towns and Census communities coloured by tier; solid dots are High confidence, hollow rings Medium or Low');
    ((geo && geo.features) || []).forEach(function (f) {
      (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).forEach(function (poly) {
        var ring = poly[0], step = Math.max(1, Math.floor(ring.length / 80));
        s.appendChild(el('path', { d: 'M' + ring.filter(function (_, i) { return i % step === 0; }).map(function (q) { return X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1); }).join('L') + 'Z', fill: 'none', stroke: C.line, 'stroke-width': 0.9 }));
      });
    });
    pts.slice().sort(function (a, b) { return a.s.score - b.s.score; }).forEach(function (x) {
      var c = cen[x.p.geoid], t = x.s.tier;
      dot(s, X(c.lng), Y(c.lat), t === 1 ? 5.5 : t === 2 ? 4 : 3, t ? TIER[t] : C.none, x.s.confidence !== 'High');
    });
    noOverlap(s, pts.filter(function (x) { return x.s.tier === 1; }).slice(0, 14).map(function (x) { var c = cen[x.p.geoid]; return { x: X(c.lng) + 8, y: Y(c.lat) + 4, t: short(x.p.name) + ' ' + x.s.score }; }));
    legend(s, 14, H - 16, [['dot', C.target, 'Target'], ['dot', C.promising, 'Promising'], ['dot', C.monitor, 'Monitor'], ['dot', C.none, 'Not tiered'], ['hollow', C.target, 'Hollow: Medium or Low confidence']]);
  }

  function scoreVsChecked(rows) {
    var pts = rows.filter(function (x) { return x.p.type !== 'county'; });
    var W = 820, H = 420, L = 50, R = 20, T = 16, B = 44, lo = Math.min(0.4, Math.floor(Math.min.apply(1, pts.map(function (x) { return x.s.checkedShare; }).concat([1])) * 10) / 10);
    var X = function (v) { return L + (v - lo) / (1 - lo) * (W - L - R); }, Y = function (v) { return T + (1 - v / 100) * (H - T - B); };
    var s = svg('wtbChecked', W, H, 'Score against the share of weight on checked factors for ' + pts.length + ' places; top right is ready to pursue, top left needs local records read first');
    rect(s, X(0.8), Y(100), X(1) - X(0.8), Y(70) - Y(100), C.full, { opacity: 0.12 });
    rect(s, X(lo), Y(100), X(0.8) - X(lo), Y(70) - Y(100), C.partial, { opacity: 0.1 });
    text(s, X(1) - 6, Y(100) + 14, 'Ready to pursue', { anchor: 'end', bold: true });
    text(s, X(lo) + 6, Y(100) + 14, 'Strong, but check local records first', { bold: true });
    [0, 35, 50, 70, 100].forEach(function (v) { line(s, L, Y(v), W - R, Y(v)); text(s, L - 6, Y(v) + 4, String(v), { anchor: 'end', size: 11, muted: true }); });
    for (var v = Math.ceil(lo * 10) / 10; v <= 1.001; v += 0.1) text(s, X(v), H - B + 16, Math.round(v * 100) + '%', { anchor: 'middle', size: 11, muted: true });
    line(s, X(0.8), T, X(0.8), H - B, { color: C.muted, dash: '3 3' });
    text(s, (L + W) / 2, H - 6, 'Share of your weight resting on checked factors (80%+ is High confidence)', { anchor: 'middle', size: 12 });
    text(s, 14, (T + H - B) / 2, 'Score', { anchor: 'middle', size: 12, rotate: -90 });
    pts.forEach(function (x) { var j = (parseInt(String(x.p.geoid).slice(-3), 10) % 7 - 3) * 0.003; dot(s, X(Math.max(lo, x.s.checkedShare + j)), Y(x.s.score), 3, x.s.tier ? TIER[x.s.tier] : C.none); });
    noOverlap(s, pts.slice(0, 10).map(function (x) { var right = X(x.s.checkedShare) > W - 160; return { x: X(x.s.checkedShare) + (right ? -7 : 7), y: Y(x.s.score) + 4, t: short(x.p.name), anchor: right ? 'end' : 'start' }; }));
  }

  function groupBars(W, rows, weights) {
    var G = W.GROUPS.filter(function (g) { return Number(weights[g.id]) > 0; }), top = rows.slice(0, 15);
    if (!top.length) { document.getElementById('wtbGroups').innerHTML = ''; return; }
    var Wd = 820, rh = 24, L = 190, legendRows = Math.ceil(G.length / 4), H = top.length * rh + 18 + legendRows * 18, sc = (Wd - L - 50) / 100;
    var s = svg('wtbGroups', Wd, H, 'Score of the top ' + top.length + ' places split by the groups the sliders control');
    top.forEach(function (x, i) {
      var y = 4 + i * rh, cx = L, sp = groupSplit(x.s);
      text(s, L - 8, y + 15, short(x.p.name) + ' ' + x.s.score, { anchor: 'end' });
      G.forEach(function (g, j) { var v = sp[g.id] || 0; if (v <= 0) return; var gf = groupFill(j); rect(s, cx, y + 3, v * sc, 16, gf.fill, { opacity: gf.opacity, stroke: C.paper, strokeWidth: 0.8 }); cx += v * sc; });
    });
    G.forEach(function (g, j) {
      var gx = 10 + (j % 4) * 200, gy = top.length * rh + 18 + Math.floor(j / 4) * 18;
      var gf = groupFill(j); rect(s, gx, gy - 9, 11, 11, gf.fill, { opacity: gf.opacity }); text(s, gx + 16, gy, g.label, { size: 10.5 });
    });
  }

  function rankLines(W, rows, model, weights) {
    var top = rows.slice(0, 20); if (!top.length) { document.getElementById('wtbRange').innerHTML = ''; return; }
    var pool = rows.map(function (x) { return x.p; });
    var rr = rankRange(W, pool, weights, top.map(function (x) { return x.p.geoid; }));
    var mx = Math.max.apply(0, rr.map(function (r) { return r.worst || 1; }).concat([20]));
    var Wd = 820, rh = 20, L = 190, H = top.length * rh + 36;
    var X = function (v) { return L + (v - 1) / (mx - 1) * (Wd - L - 30); };
    var s = svg('wtbRange', Wd, H, 'Best and worst rank of the top ' + top.length + ' places when any one group is set to 0: ' + top.map(function (x, i) { return x.p.name + ' ' + rr[i].best + ' to ' + rr[i].worst; }).join(', '));
    var ticks = [1, 5, 10, 20, 40, 60, 80, 100, 150, 200].filter(function (v) { return v <= mx; });
    ticks.forEach(function (v) { line(s, X(v), 4, X(v), H - 28); text(s, X(v), H - 12, String(v), { anchor: 'middle', size: 11, muted: true }); });
    top.forEach(function (x, i) {
      var y = 14 + i * rh, r = rr[i];
      text(s, L - 8, y + 4, (i + 1) + '. ' + short(x.p.name), { anchor: 'end', size: 11 });
      if (r.best != null) line(s, X(r.best), y, X(r.worst), y, { color: C.range, width: 5, cap: 'round' });
      s.appendChild(el('circle', { cx: X(i + 1), cy: y, r: 4, fill: C.now }));
    });
    text(s, Wd - 10, H - 26, 'rank (dot = under your weights, line = range)', { anchor: 'end', size: 11, muted: true });
  }

  function coverageBars(W, model) {
    var rows = coverage(W, model.places), n = model.places.length;
    var Wd = 820, rh = 20, L = 230, H = rows.length * rh + 10, sc = (Wd - L - 90) / n;
    var s = svg('wtbCoverage', Wd, H, 'Rows with a recorded value, by factor, out of ' + n + ': ' + rows.map(function (r) { return r.label + ' ' + r.checked; }).join(', '));
    rows.forEach(function (r, i) {
      var y = 4 + i * rh;
      text(s, L - 8, y + 13, r.label, { anchor: 'end' });
      rect(s, L, y + 2, r.checked * sc, 14, r.checked < n ? C.partial : C.full);
      text(s, L + r.checked * sc + 6, y + 13, r.checked + ' of ' + n, { size: 11 });
    });
  }

  /** Redraw all five from the rows the page is showing ({p, s} sorted by score) and the full model. */
  function draw(W, rows, model, weights, cen, geo, today) {
    if (typeof document === 'undefined' || !document.getElementById('wtbMap')) return;
    tierMap(rows, cen || {}, geo);
    scoreVsChecked(rows);
    groupBars(W, rows, weights);
    rankLines(W, rows, model, weights);
    coverageBars(W, model);
    var stamp = 'COHO Where Should I Build? scorer, your current weights and filters, ' + today + '.';
    src('wtbMapSrc', 'Source: ' + stamp + ' Census 2024 Gazetteer place centroids; county outlines from data/co-county-boundaries.json. Counties are left off the map.');
    src('wtbCheckedSrc', 'Source: ' + stamp + ' Checked share is the weight on factors with a recorded value; "not yet checked" is never a zero.');
    src('wtbGroupsSrc', 'Source: ' + stamp + ' Each segment is the points a group earns; signals and red flags are left out, so a bar can differ from the score by a few points.');
    src('wtbRangeSrc', 'Source: ' + stamp + ' One run per weighted group with that group set to 0, ranked among the places shown.');
    src('wtbCoverageSrc', 'Source: ' + stamp + ' All ' + model.places.length + ' rows, whatever the filters. Short bars are where reading local records would change the ranking most.');
  }

  var api = { short: short, groupSplit: groupSplit, rankRange: rankRange, coverage: coverage, draw: draw };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhereToBuildCharts = api;
})(typeof window !== 'undefined' ? window : this);
