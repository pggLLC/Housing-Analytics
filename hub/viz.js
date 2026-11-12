// House charts drawn as SVG, in the style guide's palette and type sizes (style guide v2, decided 29 Oct).
// Each chart is drawn twice, at desktop width (760) and phone width (340), and CSS shows one: SVG text
// scales with its box, so one drawing cannot keep 13 px labels at both widths. Every number is drawn to
// scale from the values passed in; nothing is computed here beyond positions.
(function (global) {
  'use strict';

  var INK = 'var(--ink)', MUT = 'var(--muted)', LINE = 'var(--line)', PINE = 'var(--pine)', RUST = 'var(--rust)', GRN = 'var(--c-green)',
    BLU = 'var(--c-blue)', PUR = 'var(--c-purple)', TRACK = 'var(--track)', BAND = 'var(--c-band)', BAND_INK = 'var(--c-blue)',
    ON = 'var(--on-fill)', CARD = 'var(--card)', HALO = 'var(--halo)';
  var DW = 760, PW = 340;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f1(n) { return Math.round(n * 10) / 10; }
  function T(x, y, s, o) {
    o = o || {};
    return '<text x="' + f1(x) + '" y="' + f1(y) + '" font-size="' + (o.size || 13) + '" fill="' + (o.fill || INK) + '"' +
      (o.w ? ' font-weight="' + o.w + '"' : '') + (o.a ? ' text-anchor="' + o.a + '"' : '') + '>' + esc(s) + '</text>';
  }
  function R(x, y, w, h, fill, o) {
    o = o || {};
    return '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(Math.max(w, 0)) + '" height="' + f1(h) + '" rx="' + (o.rx == null ? 2 : o.rx) + '" fill="' + fill + '"' +
      (o.stroke ? ' stroke="' + o.stroke + '"' : '') + (o.extra || '') + '><title>' + esc(o.title || '') + '</title></rect>';
  }
  function L(x1, y1, x2, y2, stroke, extra) {
    return '<line x1="' + f1(x1) + '" y1="' + f1(y1) + '" x2="' + f1(x2) + '" y2="' + f1(y2) + '" stroke="' + (stroke || LINE) + '"' + (extra || '') + '/>';
  }
  function C(cx, cy, r, fill, stroke, extra) {
    return '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + r + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '"' : '') + (extra || '') + '/>';
  }
  // An unseen target over one data point, carrying its exact value for the pointer, a tap or the arrow keys
  // (site/viz-tip.js). near: the gap to the next point, so targets on a dense line do not overlap.
  function HIT(x, y, title, near) {
    var r = Math.max(3, Math.min(11, (near == null ? 22 : near) / 2));
    return '<circle class="viz-hit" cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + f1(r) + '" fill="transparent"><title>' + esc(title) + '</title></circle>';
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(x) { return x instanceof Date ? MON[x.getMonth()] + ' ' + x.getFullYear() : String(x); }
  // Rough text width at 13 px in the system sans, for laying out labels; kept generous.
  function tw(s, size) { return String(s).length * (size || 13) * 0.56; }
  var num = function (n) { return n == null ? '' : Math.round(n).toLocaleString('en-US'); };
  var pct = function (n) { return n == null ? '' : (Math.round(n * 10) / 10) + '%'; };

  function svg(w, h, label, body, cls) {
    return '<svg class="viz-' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' + body + '</svg>';
  }
  // A figure with both drawings, a title, an answer line and a source line (HTML, so links work).
  function figure(o) {
    return '<figure class="viz">' + '<figcaption><strong>' + esc(o.title) + '</strong>' + (o.scope || '') +
      (o.answer ? '<span class="viz-answer">' + esc(o.answer) + '</span>' : '') + '</figcaption>' +
      // Key figures above the chart, as the drawings set them: value first, then what it counts.
      (o.tiles && o.tiles.length ? '<ul class="viz-tiles">' + o.tiles.map(function (t) { return '<li><span class="viz-tile-v">' + esc(t[0]) + '</span><span class="viz-tile-l">' + esc(t[1]) + '</span></li>'; }).join('') + '</ul>' : '') +
      svg(DW, o.dh, o.label || o.title, o.desk, 'd') + svg(PW, o.ph, o.label || o.title, o.phone, 'p') +
      (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') + (o.source ? '<p class="metric-source">' + o.source + '</p>' : '') + '</figure>';
  }
  function key(x, y, color, label, o) {
    o = o || {};
    return (o.line ? L(x, y + 6, x + 22, y + 6, color, ' stroke-width="3"' + (o.dash ? ' stroke-dasharray="6,4"' : '')) : R(x, y, 12, 12, color)) +
      T(x + (o.line ? 28 : 18), y + 11, label);
  }

  // A chart with nothing published to draw keeps its title, scope and source, and says why there is no drawing,
  // so a missing table is never mistaken for a section that does not exist.
  function unavailable(o) {
    return '<figure class="viz viz-unavailable"><figcaption><strong>' + esc(o.title) + '</strong>' + (o.scope || '') + '</figcaption>' +
      '<p class="viz-empty">' + esc(o.empty || 'Not published.') + '</p>' + (o.source ? '<p class="metric-source">' + o.source + '</p>' : '') + '</figure>';
  }

  // B3/B10: one bar per group, sorted largest first, count at the bar's tip and share at the right.
  function sortedBars(o) {
    var rows = o.rows.filter(function (r) { return r[1] != null; }).slice().sort(function (a, b) { return b[1] - a[1]; });
    if (!rows.length) return o.empty ? unavailable(o) : '';
    // o.total: the whole the shares are of, when some rows are missing and the shown rows do not add up to it.
    var total = o.total || rows.reduce(function (t, r) { return t + r[1]; }, 0) || 1, max = rows[0][1] || 1;
    var color = o.color || GRN, d = '', p = '';
    var lw = Math.min(340, Math.max.apply(null, rows.map(function (r) { return tw(r[0], 14); })) + 16);
    var dw = DW - lw - 120;
    // o.noShare: counts only, when the whole the shares would be of is not known.
    var share = function (v) { if (o.noShare) return ''; var x = Math.round(v / total * 100); return x === 0 && v > 0 ? '<1%' : x + '%'; };
    rows.forEach(function (r, i) {
      var y = 8 + i * 34, w = Math.max(r[1] / max * dw, r[1] > 0 ? 3 : 0);
      d += T(0, y + 16, r[0], { size: 14 }) + R(lw, y + 3, w, 18, color, { title: r[0] + ': ' + num(r[1]) }) +
        T(lw + w + 8, y + 17, num(r[1]), { size: 14, w: 700 }) + T(DW, y + 17, share(r[1]), { size: 14, fill: MUT, a: 'end' });
      var py = 6 + i * 50, pw = Math.max(r[1] / max * (PW - 70), r[1] > 0 ? 3 : 0);
      p += T(0, py + 14, r[0], { size: 14 }) + T(PW, py + 14, share(r[1]), { fill: MUT, a: 'end' }) +
        R(0, py + 22, pw, 14, color, { title: r[0] + ': ' + num(r[1]) }) + T(pw + 8, py + 34, num(r[1]), { w: 700 });
    });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, dh: 8 + rows.length * 34 + 4, ph: 6 + rows.length * 50, desk: d, phone: p });
  }

  // B3: a split bar of two shares that add to 100.
  function splitBar(o) {
    var a = o.parts[0], b = o.parts[1];
    if (a[1] == null || b[1] == null) return '';
    var d = R(0, 4, DW * a[1] / 100, 32, a[2], { title: a[0] + ' ' + pct(a[1]) }) + R(DW * a[1] / 100, 4, DW * b[1] / 100, 32, b[2], { title: b[0] + ' ' + pct(b[1]) });
    var la = a[0] + ' ' + pct(a[1]), lb = b[0] + ' ' + pct(b[1]);
    d += DW * a[1] / 100 > tw(la, 14) + 20 ? T(12, 25, la, { size: 14, fill: ON, w: 700 }) : T(0, 56, la, { size: 14, fill: a[2], w: 700 });
    d += DW * b[1] / 100 > tw(lb, 14) + 20 ? T(DW - 12, 25, lb, { size: 14, fill: ON, w: 700, a: 'end' }) : T(DW, 56, lb, { size: 14, fill: b[2], w: 700, a: 'end' });
    var p = R(0, 4, PW * a[1] / 100, 28, a[2], { title: a[0] + ' ' + pct(a[1]) }) + R(PW * a[1] / 100, 4, PW * b[1] / 100, 28, b[2], { title: b[0] + ' ' + pct(b[1]) }) +
      T(0, 54, la, { size: 14, fill: a[2], w: 700 }) + T(PW, 54, lb, { size: 14, fill: b[2], w: 700, a: 'end' });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, source: o.source, dh: 62, ph: 62, desk: d, phone: p });
  }

  // B2: the place and its county on one scale per row, with a verdict word on every row.
  // rows: [label, place, county, verdict, detail]; verdict is one of Better, Worse, Similar, Not ranked, Not comparable.
  var VERDICT = { Better: GRN, Worse: RUST, Similar: MUT, 'Not ranked': MUT, 'Not comparable': MUT };
  function vchip(x, y, v) {
    var c = VERDICT[v] || MUT, w = Math.max(96, tw(v) + 24);
    return R(x - w, y, w, 22, CARD, { rx: 11, stroke: c, extra: v === 'Worse' || v === 'Not comparable' ? ' stroke-dasharray="3,2"' : '' }) +
      T(x - w / 2, y + 16, v, { fill: v === 'Better' || v === 'Worse' ? c : INK, w: 700, a: 'middle' });
  }
  function dotPairs(o) {
    var rows = o.rows.filter(function (r) { return r[1] != null && r[2] != null; });
    if (!rows.length) return '';
    var top = Math.max(10, Math.ceil(Math.max.apply(null, rows.map(function (r) { return Math.max(r[1], r[2]); })) / 10) * 10);
    var lw = 230, x0 = lw, w = DW - lw - 150, X = function (v) { return x0 + w * v / top; };
    var d = C(6, 10, 6, INK) + T(18, 15, o.placeName) + C(18 + tw(o.placeName) + 22, 10, 6, CARD, INK, ' stroke-width="2"') + T(30 + tw(o.placeName) + 22, 15, o.countyName);
    var steps = [0, top / 2, top];
    steps.forEach(function (v) { d += L(X(v), 32, X(v), 40 + rows.length * 44) + T(X(v), 56 + rows.length * 44, v + '%', { fill: MUT, a: 'middle' }); });
    rows.forEach(function (r, i) {
      var y = 52 + i * 44, t = r[1], c = r[2];
      d += T(0, y + 5, r[0], { size: 14 }) + L(X(Math.min(t, c)), y, X(Math.max(t, c)), y, MUT, ' stroke-width="2"') +
        C(X(c), y, 6, CARD, INK, ' stroke-width="2"') + C(X(t), y, 6, INK) +
        T(t <= c ? X(t) - 10 : X(t) + 10, y - 9, pct(t), { w: 700, a: t <= c ? 'end' : null }) +
        (Math.abs(X(t) - X(c)) > 4 ? T(t <= c ? X(c) + 10 : X(c) - 10, y - 9, pct(c), { fill: MUT, a: t <= c ? null : 'end' }) : '') + vchip(DW, y - 11, r[3]) +
        HIT(X(c), y, r[0] + ', ' + o.countyName + ': ' + pct(c), Math.abs(X(t) - X(c))) + HIT(X(t), y, r[0] + ', ' + o.placeName + ': ' + pct(t), Math.abs(X(t) - X(c)));
    });
    var p = C(6, 10, 6, INK) + T(18, 15, 'Place') + C(80, 10, 6, CARD, INK, ' stroke-width="2"') + T(92, 15, 'County');
    rows.forEach(function (r, i) {
      var y = 30 + i * 78, PX = function (v) { return 6 + (PW - 12) * v / top; };
      p += L(0, y, PW, y) + T(0, y + 24, r[0], { size: 14, w: 600 }) + vchip(PW, y + 9, r[3]) +
        T(0, y + 48, o.placeShort + ' ' + pct(r[1]), { size: 14, w: 700 }) + T(PW, y + 48, 'County ' + pct(r[2]), { size: 14, fill: MUT, a: 'end' }) +
        R(0, y + 56, PW, 6, TRACK, { rx: 3 }) + C(PX(r[2]), y + 59, 5, CARD, INK, ' stroke-width="2"') + C(PX(r[1]), y + 59, 5, INK) +
        HIT(PX(r[2]), y + 59, r[0] + ', ' + o.countyName + ': ' + pct(r[2]), Math.abs(PX(r[1]) - PX(r[2]))) + HIT(PX(r[1]), y + 59, r[0] + ', ' + o.placeName + ': ' + pct(r[1]), Math.abs(PX(r[1]) - PX(r[2])));
    });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, dh: 64 + rows.length * 44, ph: 34 + rows.length * 78, desk: d, phone: p });
  }

  // B4: working residents and local jobs as two stacked bars on one scale.
  function commute(o) {
    var f = o.flows;
    if (!f || f.within == null || f.outflow == null || f.inflow == null) return '';
    var res = f.within + f.outflow, jobs = f.within + f.inflow, max = Math.max(res, jobs) || 1;
    function stack(x, y, W, h, parts, total) {
      var s = '', xx = x;
      parts.forEach(function (q) {
        var w = W * q[1] / total;
        s += R(xx, y, w, h, q[2], { title: q[0] + ': ' + num(q[1]) });
        if (w > tw(num(q[1]), 14) + 16) s += T(xx + 8, y + h / 2 + 5, num(q[1]), { size: 14, fill: ON, w: 700 });
        xx += w;
      });
      return s;
    }
    var dw = DW, dres = dw * res / max, djobs = dw * jobs / max;
    var d = T(0, 14, 'Working residents, ' + num(res), { size: 14, w: 700 }) + stack(0, 22, dres, 36, [['Live and work here', f.within, GRN], ['Commute out', f.outflow, PUR]], res) +
      T(0, 76, 'Live and work here ' + num(f.within), { fill: GRN, w: 700 }) + T(Math.max(dres, 300), 76, 'Commute out ' + num(f.outflow), { fill: PUR, w: 700, a: 'end' }) +
      T(0, 112, 'Jobs located here, ' + num(jobs), { size: 14, w: 700 }) + stack(0, 120, djobs, 36, [['Live and work here', f.within, GRN], ['Commute in', f.inflow, BLU]], jobs) +
      T(0, 174, 'Live and work here ' + num(f.within), { fill: GRN, w: 700 }) + T(Math.max(djobs, 300), 174, 'Commute in ' + num(f.inflow), { fill: BLU, w: 700, a: 'end' });
    var pres = PW * res / max, pjobs = PW * jobs / max;
    var p = T(0, 14, 'Working residents, ' + num(res), { size: 14, w: 700 }) + stack(0, 22, pres, 32, [['Live and work here', f.within, GRN], ['Commute out', f.outflow, PUR]], res) +
      T(0, 72, 'Live and work here ' + num(f.within), { fill: GRN, w: 700 }) + T(0, 90, 'Commute out ' + num(f.outflow), { fill: PUR, w: 700 }) +
      T(0, 126, 'Jobs located here, ' + num(jobs), { size: 14, w: 700 }) + stack(0, 134, pjobs, 32, [['Live and work here', f.within, GRN], ['Commute in', f.inflow, BLU]], jobs) +
      T(0, 184, 'Live and work here ' + num(f.within), { fill: GRN, w: 700 }) + T(0, 202, 'Commute in ' + num(f.inflow), { fill: BLU, w: 700 });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: 'Both bars use the same scale.', source: o.source, dh: 182, ph: 210, desk: d, phone: p });
  }

  // B5: a forecast line, an alternative line and the range two in three past forecasts stayed within.
  // series: { years, main, alt, low, high }, each an array by year; labels: { main, alt, band }.
  function projection(o) {
    var s = o.series;
    if (!s || !s.years || !s.main) return '';
    var vals = s.main.concat(s.alt || [], s.high || [], s.low || []).filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var step = Math.pow(10, Math.floor(Math.log10((hi - lo) || 1))), y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
    if ((y1 - y0) / step < 3) step /= 2;
    var endM = s.main[s.main.length - 1], endA = s.alt ? s.alt[s.alt.length - 1] : null;
    var yw = tw(num(y1)) + 12;
    function draw(W, H, px, lx, short) {
      px = Math.max(px, yw);
      var right = Math.max(tw((short ? '' : o.labels.main + ' ') + num(endM)), endA == null ? 0 : tw((short ? '' : o.labels.alt + ' ') + num(endA))) + 14;
      var pw = W - px - right, ph = H - 40, a = s.years[0], b = s.years[s.years.length - 1];
      var X = function (t) { return px + pw * (t - a) / (b - a); }, Y = function (v) { return 8 + ph - (v - y0) / (y1 - y0) * ph; };
      var g = '';
      for (var v = y0; v <= y1 + 1e-9; v += step) g += L(px, Y(v), px + pw, Y(v)) + T(px - 8, Y(v) + 5, num(v), { fill: MUT, a: 'end' });
      var ticks = short ? [a, Math.round((a + b) / 2), b] : [a].concat(s.years.filter(function (t) { return t % 5 === 0 && t > a + 2 && t < b - 2; })).concat([b]);
      ticks.forEach(function (t) { g += T(X(t), H - 10, t, { fill: MUT, a: 'middle' }); });
      if (s.low && s.high) {
        var top = [], bot = [];
        s.years.forEach(function (t, i) { if (s.high[i] != null) { top.push(f1(X(t)) + ',' + f1(Y(s.high[i]))); bot.unshift(f1(X(t)) + ',' + f1(Y(s.low[i]))); } });
        g += '<polygon points="' + top.concat(bot).join(' ') + '" fill="' + BAND + '" fill-opacity="0.7"><title>' + esc(o.labels.band) + '</title></polygon>';
      }
      var line = function (arr, color, dash, wdt) {
        var pts = []; s.years.forEach(function (t, i) { if (arr[i] != null) pts.push(f1(X(t)) + ',' + f1(Y(arr[i]))); });
        return '<polyline fill="none" stroke="' + color + '" stroke-width="' + wdt + '"' + (dash ? ' stroke-dasharray="6,4"' : '') + ' points="' + pts.join(' ') + '"/>';
      };
      if (s.alt) g += line(s.alt, PUR, true, 2.5);
      g += line(s.main, GRN, false, 3.5);
      var gapX = pw / Math.max(1, s.years.length - 1);
      [[s.alt, o.labels.alt], [s.main, o.labels.main]].forEach(function (q) {
        if (q[0]) s.years.forEach(function (t, i) { if (q[0][i] != null) g += HIT(X(t), Y(q[0][i]), q[1] + ', ' + t + ': ' + num(q[0][i]), gapX); });
      });
      var ym = Y(endM), ya = endA == null ? null : Y(endA);
      if (ya != null && Math.abs(ya - ym) < 18) { if (ya < ym) ya = ym - 18; else ya = ym + 18; }
      g += T(px + pw + 8, ym + 5, (short ? '' : o.labels.main + ' ') + num(endM), { fill: GRN, w: 700 });
      if (ya != null) g += T(px + pw + 8, ya + 5, (short ? '' : o.labels.alt + ' ') + num(endA), { fill: PUR, w: 700 });
      return g;
    }
    var d = draw(DW, 280, 70, 0, false);
    var p = draw(PW, 300, 64, 0, true) + key(0, 316, GRN, o.labels.main, { line: true }) + (s.alt ? key(0, 338, PUR, o.labels.alt, { line: true, dash: true }) : '') +
      (s.low ? R(0, 358, 22, 12, BAND, { rx: 2 }) + T(28, 369, o.labels.band, { fill: BAND_INK, w: 700 }) : '');
    var dk = key(0, 292, GRN, o.labels.main, { line: true }) + (s.alt ? key(tw(o.labels.main) + 60, 292, PUR, o.labels.alt, { line: true, dash: true }) : '') +
      (s.low ? R(tw(o.labels.main) + tw(o.labels.alt) + 130, 292, 22, 12, BAND, { rx: 2 }) + T(tw(o.labels.main) + tw(o.labels.alt) + 158, 303, o.labels.band, { fill: BAND_INK, w: 700 }) : '');
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, dh: 312, ph: 378, desk: d + dk, phone: p });
  }

  // B9: the 20-year need as parts that add up, and the yearly pace against recent permits.
  // parts: [[label, value, color]]; pace: { need, permits, sf, mf, window }
  function outlook(o) {
    var parts = o.parts.filter(function (q) { return q[1] != null && q[1] > 0; });
    if (!parts.length) return '';
    var total = parts.reduce(function (t, q) { return t + q[1]; }, 0);
    var d = T(0, 30, num(total) + ' homes', { size: 28, w: 700 }) + T(tw(num(total) + ' homes', 28) + 16, 30, 'in ' + o.years + ' years, from ' + parts.length + ' parts', { size: 15, fill: MUT });
    var x = 0;
    parts.forEach(function (q) { var w = DW * q[1] / total; d += R(x, 44, w, 40, q[2], { title: q[0] + ': ' + num(q[1]) }); if (w > tw(num(q[1]), 15) + 16) d += T(x + 8, 70, num(q[1]), { size: 15, fill: ON, w: 700 }); x += w; });
    var kx = 0;
    parts.forEach(function (q) { d += key(kx, 96, q[2], q[0] + ': ' + num(q[1])); kx += tw(q[0] + ': ' + num(q[1])) + 48; });
    var p = T(0, 30, num(total), { size: 28, w: 700 }) + T(tw(num(total), 28) + 12, 30, 'homes in ' + o.years + ' years', { size: 14, fill: MUT });
    x = 0;
    parts.forEach(function (q) { var w = PW * q[1] / total; p += R(x, 42, w, 30, q[2], { title: q[0] + ': ' + num(q[1]) }); x += w; });
    parts.forEach(function (q, i) { p += key(0, 86 + i * 24, q[2], q[0] + ': ' + num(q[1])); });
    var dh = 124, ph = 90 + parts.length * 24;
    var pc = o.pace;
    if (pc && pc.need != null && pc.permits != null) {
      var mx = Math.max(pc.need, pc.permits) || 1, y = dh + 20;
      var sc = (DW - 260) / mx;
      d += L(0, y - 14, DW, y - 14) + T(0, y + 12, 'Pace: homes needed a year vs homes permitted a year', { size: 15, fill: PINE, w: 700 }) +
        T(0, y + 50, 'Needed each year', { size: 14 }) + R(170, y + 34, pc.need * sc, 24, INK, { title: 'Needed each year: ' + num(pc.need) }) + T(170 + pc.need * sc + 8, y + 52, num(pc.need), { size: 15, w: 700 }) +
        T(0, y + 92, 'Permitted each year', { size: 14 });
      if (pc.sf != null && pc.mf != null) {
        d += R(170, y + 76, pc.sf * sc, 24, GRN, { title: 'Single-family: ' + num(pc.sf) }) + R(170 + pc.sf * sc, y + 76, pc.mf * sc, 24, BLU, { title: 'Multifamily: ' + num(pc.mf) });
        d += key(170, y + 112, GRN, 'Single-family ' + num(pc.sf)) + key(170 + tw('Single-family ' + num(pc.sf)) + 50, y + 112, BLU, 'Multifamily ' + num(pc.mf));
      } else d += R(170, y + 76, pc.permits * sc, 24, GRN);
      d += T(170 + pc.permits * sc + 8, y + 94, num(pc.permits), { size: 15, w: 700 });
      dh = y + 134;
      var py = ph + 20, ps = (PW - 60) / mx;
      p += L(0, py - 14, PW, py - 14) + T(0, py + 10, 'Pace, a year', { size: 15, fill: PINE, w: 700 }) +
        T(0, py + 38, 'Needed each year') + R(0, py + 46, pc.need * ps, 20, INK) + T(pc.need * ps + 8, py + 61, num(pc.need), { size: 14, w: 700 }) +
        T(0, py + 92, 'Permitted each year');
      if (pc.sf != null && pc.mf != null) p += R(0, py + 100, pc.sf * ps, 20, GRN) + R(pc.sf * ps, py + 100, pc.mf * ps, 20, BLU) +
        key(0, py + 132, GRN, 'Single-family ' + num(pc.sf)) + key(0, py + 154, BLU, 'Multifamily ' + num(pc.mf));
      else p += R(0, py + 100, pc.permits * ps, 20, GRN);
      p += T(pc.permits * ps + 8, py + 115, num(pc.permits), { size: 14, w: 700 });
      ph = py + 172;
    }
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, dh: dh, ph: ph, desk: d, phone: p });
  }

  // B11: rents on one true dollar scale, with the gap between two of them named in words.
  // rents: [[label, value, color]]; gap: [fromIndex, toIndex, words]
  function rentScale(o) {
    var rs = o.rents.filter(function (r) { return r[1] != null; });
    if (rs.length < 2) return '';
    var vals = rs.map(function (r) { return r[1]; }), lo = Math.floor((Math.min.apply(null, vals) - 100) / 100) * 100, hi = Math.ceil((Math.max.apply(null, vals) + 100) / 100) * 100;
    var stepv = hi - lo > 1200 ? 200 : 100;
    function scale(W, pad, y, short) {
      var X = function (v) { return pad + (W - 2 * pad) * (v - lo) / (hi - lo); }, g = L(pad, y, W - pad, y, MUT, ' stroke-width="2"');
      for (var v = lo; v <= hi; v += stepv) g += L(X(v), y - 5, X(v), y + 5, MUT) + ((v - lo) % (short ? stepv * 2 : stepv) === 0 ? T(X(v), y + 24, '$' + num(v), { fill: MUT, a: 'middle' }) : '');
      if (o.gap) {
        var a = o.rents[o.gap[0]][1], b = o.rents[o.gap[1]][1];
        if (a != null && b != null && b !== a) {
          var x1 = X(Math.min(a, b)), x2 = X(Math.max(a, b));
          g += R(x1, y - 44, x2 - x1, 8, RUST, { title: o.gap[2] }) + T(Math.min(Math.max((x1 + x2) / 2, tw(o.gap[2]) / 2 + 2), W - tw(o.gap[2]) / 2 - 2), y - 54, o.gap[2], { fill: RUST, w: 700, a: 'middle' });
        }
      }
      rs.forEach(function (r) { g += C(X(r[1]), y, 9, r[2], HALO, ' stroke-width="2"'); });
      rs.forEach(function (r) { g += HIT(X(r[1]), y, r[0] + ': $' + num(r[1]), 18); });
      return { g: g, X: X };
    }
    var ds = scale(DW, 40, 70, false), d = ds.g;
    var placed = [];
    rs.slice().sort(function (a, b) { return a[1] - b[1]; }).forEach(function (r) {
      var x = ds.X(r[1]), row = 0;
      while (placed.some(function (q) { return q.row === row && Math.abs(q.x - x) < (tw(r[0]) + tw(q.label)) / 2 + 16; })) row++;
      placed.push({ x: x, row: row, label: r[0] });
      var y = 128 + row * 44;
      d += T(x, y, '$' + num(r[1]), { size: 15, w: 700, a: 'middle' }) + T(x, y + 19, r[0], { fill: MUT, a: 'middle' });
    });
    var dh = 128 + (Math.max.apply(null, placed.map(function (q) { return q.row; })) + 1) * 44;
    var ps = scale(PW, 24, 70, true), p = ps.g;
    rs.forEach(function (r, i) { var y = 130 + i * 50; p += C(10, y - 5, 9, r[2], HALO, ' stroke-width="2"') + T(28, y, '$' + num(r[1]), { size: 16, w: 700 }) + T(28, y + 20, r[0], { fill: MUT }); });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, dh: dh, ph: 110 + rs.length * 50, desk: d, phone: p });
  }

  // B8: running totals by income level as small bars, drawn to scale.
  function cumulative(o) {
    var rows = o.rows.filter(function (r) { return r[1] != null; });
    if (!rows.length) return '';
    var ref = o.ref && o.ref.value != null ? o.ref : null;
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat(ref ? [ref.value] : [])) || 1, cw = DW / rows.length, d = '', p = '';
    var pt = ref ? 26 : 0;
    rows.forEach(function (r, i) {
      var c = o.colorOf ? o.colorOf(r, i) : o.color || RUST;
      var h = 120 * r[1] / max, x = i * cw + cw / 2;
      d += R(x - Math.min(30, cw * 0.32), 150 - h, Math.min(60, cw * 0.64), h, c, { title: r[0] + ': ' + num(r[1]) }) +
        T(x, 142 - h, num(r[1]), { w: 700, a: 'middle' }) + T(x, 170, r[0], { fill: MUT, a: 'middle' });
      var y = pt + 6 + i * 36, w = (PW - 150) * r[1] / max;
      p += T(0, y + 17, r[0]) + R(96, y + 5, Math.max(w, 2), 16, c, { title: r[0] + ': ' + num(r[1]) }) + T(96 + Math.max(w, 2) + 8, y + 18, num(r[1]), { w: 700 });
    });
    // The reference level (a yearly need, say) as a dashed line across the bars, labelled once.
    if (ref) {
      var ry = 150 - 120 * ref.value / max, rx = 96 + (PW - 150) * ref.value / max;
      d += L(0, ry, DW, ry, INK, ' stroke-dasharray="5,4" stroke-width="1.5"') + T(DW, ry - 6, ref.label + ' ' + num(ref.value), { w: 700, a: 'end' });
      p += T(0, 14, ref.label + ' ' + num(ref.value), { w: 700 }) + L(rx, 20, rx, pt + rows.length * 36, INK, ' stroke-dasharray="4,3" stroke-width="1.5"');
    }
    return figure({ title: o.title, scope: o.scope, answer: o.answer, tiles: o.tiles, note: o.note, source: o.source, label: o.label, dh: 178, ph: pt + 10 + rows.length * 36, desk: d, phone: p });
  }

  // 2.4: a monthly index as one line, with numbered event markers on it. The numbers key to a list under the
  // chart (HTML, so each event keeps its link), which stays readable on a phone where labels on the line would not.
  // o: { points: [[Date, value]], events: [{ n, date: Date }], base, unit }
  function indexLine(o) {
    var pts = o.points; if (pts.length < 2) return '';
    var t0 = +pts[0][0], t1 = +pts[pts.length - 1][0];
    var vals = pts.map(function (p) { return p[1]; });
    var lo = Math.floor(Math.min.apply(null, vals.concat([o.base])) / 10) * 10, hi = Math.ceil(Math.max.apply(null, vals) / 10) * 10;
    var step = hi - lo > 60 ? 20 : 10;
    function draw(W, H, phone) {
      var yw = 40, top = 30, bot = H - 26, xw = W - yw - (phone ? 30 : 46);
      var X = function (t) { return yw + (t - t0) / (t1 - t0) * xw; }, Y = function (v) { return bot - (v - lo) / (hi - lo) * (bot - top); };
      var g = '';
      for (var v = lo; v <= hi; v += step) g += L(yw, Y(v), yw + xw, Y(v), v === o.base ? 'var(--grey)' : LINE, v === o.base ? ' stroke-dasharray="4,3"' : '') + T(yw - 6, Y(v) + 4, String(v), { fill: MUT, a: 'end' });
      var y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
      for (var y = y0; y <= y1; y++) {
        var t = +new Date(y, 0, 1); if (t < t0) continue;
        var lab = phone && y !== y0 && y !== y1 && (y - y0) % 2 ? '’' + String(y).slice(2) : String(y);
        g += L(X(t), bot, X(t), bot + 4, MUT) + T(X(t), bot + 18, lab, { fill: MUT, a: 'middle' });
      }
      var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + f1(X(+p[0])) + ' ' + f1(Y(p[1])); }).join('');
      g += '<path d="' + path + '" fill="none" stroke="' + GRN + '" stroke-width="3" stroke-linejoin="round"/>';
      // Each marker sits on the line at its month; where two fall close, the later one lifts above the earlier.
      var lastX = -99, lift = 0;
      o.events.forEach(function (e) {
        var t = +e.date; if (t < t0 || t > t1) return;
        var near = pts.reduce(function (b, p) { return Math.abs(+p[0] - t) < Math.abs(+b[0] - t) ? p : b; }, pts[0]);
        var x = X(t), y = Y(near[1]);
        lift = x - lastX < 22 ? lift + 1 : 0; lastX = x;
        var my = y - 20 - lift * 22;
        g += L(x, y, x, my + 9, PINE) + C(x, my, 10, PINE, HALO, ' stroke-width="1.5"') +
          '<text x="' + f1(x) + '" y="' + f1(my + 4.5) + '" font-size="13" font-weight="700" fill="' + ON + '" text-anchor="middle">' + e.n + '</text>';
      });
      var gapX = xw / Math.max(1, pts.length - 1);
      pts.forEach(function (q) { g += HIT(X(+q[0]), Y(q[1]), when(q[0]) + ': ' + f1(q[1]) + (o.unit ? ' ' + o.unit : ''), gapX); });
      var last = pts[pts.length - 1];
      // The end value sits just under the line's end, clear of an event marker above it.
      g += C(X(+last[0]), Y(last[1]), 4, GRN) + T(X(+last[0]) + 4, Y(last[1]) + 20, String(Math.round(last[1])), { w: 700, fill: GRN });
      return g;
    }
    return figure({ title: o.title, scope: o.scope, answer: o.answer, source: o.source, note: o.note, label: o.label, dh: 300, ph: 260, desk: draw(DW, 300, false), phone: draw(PW, 260, true) });
  }

  // 3.2: what each income band can pay for a home against one target price. The green bar is what the band can
  // pay; the rust part is the gap to the target, labelled with its size. o: { rows: [[label, canPay]], target, targetLabel }
  function reachBars(o) {
    var rows = o.rows.filter(function (r) { return r[1] != null; });
    if (!rows.length || o.target == null) return '';
    var max = Math.max(o.target, Math.max.apply(null, rows.map(function (r) { return r[1]; }))) * 1.02;
    var money = function (v) { return '$' + num(v); };
    function draw(W, phone) {
      var lw = phone ? 0 : 150, bw = W - lw - (phone ? 4 : 130), g = '', y0 = phone ? 26 : 30, rowH = phone ? 76 : 46;
      var X = function (v) { return lw + bw * v / max; };
      g += L(X(o.target), 4, X(o.target), y0 + rows.length * rowH - 8, INK, ' stroke-dasharray="4,3"') +
        T(Math.min(X(o.target), W - 2), 16, o.targetLabel + ' ' + money(o.target), { w: 700, a: X(o.target) > W - 160 ? 'end' : 'middle' });
      rows.forEach(function (r, i) {
        var y = y0 + i * rowH + (phone ? 20 : 0), pay = Math.min(r[1], o.target), gap = o.target - r[1];
        if (phone) g += T(0, y - 6, r[0], { w: 700 });
        else g += T(0, y + 18, r[0], { w: 700 });
        g += R(lw, y + 2, X(pay) - lw, 24, GRN, { title: r[0] + ' can pay ' + money(r[1]) });
        var inside = money(r[1]);
        if (X(pay) - lw > tw(inside, 14) + 14) g += T(lw + 8, y + 19, inside, { size: 14, w: 700, fill: ON });
        if (gap > 0) {
          g += R(X(pay), y + 2, X(o.target) - X(pay), 24, RUST, { title: 'Gap ' + money(gap) });
          var lab = money(gap) + ' short';
          g += X(o.target) - X(pay) > tw(lab, 14) + 14 ? T(X(o.target) - 8, y + 19, lab, { size: 14, w: 700, fill: ON, a: 'end' })
            : phone ? T(X(o.target), y + 44, lab, { size: 14, w: 700, fill: RUST, a: 'end' }) : T(X(o.target) + 6, y + 19, lab, { size: 14, w: 700, fill: RUST });
        } else {
          g += T(Math.min(X(r[1]), W) + (X(r[1]) > W - 120 ? -6 : 6), y + 19, 'Can afford it', { size: 14, w: 700, fill: GRN, a: X(r[1]) > W - 120 ? 'end' : 'start' });
        }
      });
      return g;
    }
    var dh = 30 + rows.length * 46, ph = 26 + rows.length * 76 + 20;
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, label: o.label, dh: dh, ph: ph, desk: draw(DW, false), phone: draw(PW, true) });
  }

  // 3.3: several lines over the same years, each labelled at its end; a dashed reference level across.
  // o: { series: [{ label, color, dash, points: [[x, y]] }], ref: { y, label }, xUnit }
  function multiLine(o) {
    var ss = o.series.filter(function (s) { return s.points.length > 1; });
    if (!ss.length) return '';
    var xs = ss[0].points.map(function (p) { return p[0]; }), x0 = xs[0], x1 = xs[xs.length - 1];
    var ys = []; ss.forEach(function (s) { s.points.forEach(function (p) { ys.push(p[1]); }); }); if (o.ref) ys.push(o.ref.y);
    var lo = 0, hi = Math.max.apply(null, ys) * 1.08, step = Math.pow(10, Math.floor(Math.log10(hi / 4)));
    while (hi / step > 6) step *= 2;
    function draw(W, H, phone) {
      var yw = 64, rw = 0, top = 16, bot = H - 30, X = function (v) { return yw + (v - x0) / (x1 - x0) * (W - yw - rw - 10); }, Y = function (v) { return bot - (v - lo) / (hi - lo) * (bot - top); };
      var g = '';
      for (var v = 0; v <= hi; v += step) g += L(yw, Y(v), W - rw - 10, Y(v), LINE) + T(yw - 6, Y(v) + 4, '$' + (v >= 1000 ? num(v / 1000) + 'k' : num(v)), { fill: MUT, a: 'end' });
      xs.forEach(function (x) { if ((x - x0) % 5 === 0) g += T(X(x), bot + 18, String(x), { fill: MUT, a: x === x1 ? 'end' : 'middle' }); });
      if (o.ref) g += L(yw, Y(o.ref.y), W - rw - 10, Y(o.ref.y), INK, ' stroke-dasharray="5,4" stroke-width="1.5"');
      ss.forEach(function (s) {
        g += '<path d="' + s.points.map(function (p, i) { return (i ? 'L' : 'M') + f1(X(p[0])) + ' ' + f1(Y(p[1])); }).join('') + '" fill="none" stroke="' + s.color + '" stroke-width="3"' + (s.dash ? ' stroke-dasharray="7,4"' : '') + '/>';
      });
      ss.forEach(function (s) {
        var gapX = (W - yw - rw - 10) / Math.max(1, s.points.length - 1);
        s.points.forEach(function (q) { g += HIT(X(q[0]), Y(q[1]), s.label + ', ' + q[0] + ': $' + num(q[1]), gapX); });
      });
      return g;
    }
    var keyRows = ss.map(function (s) { return { label: s.label, color: s.color, dash: s.dash, v: s.points[s.points.length - 1][1] }; });
    if (o.ref) keyRows.push({ label: o.ref.label, color: INK, dash: true, v: o.ref.y });
    // The key sits under the chart at both widths, each line with its value at the last year, so no label crowds the lines.
    function keyed(W, H, phone) {
      var g = draw(W, H, phone), cols = phone ? 1 : 2, cw = W / cols;
      // On a phone the value and the name take a line each, so long formula names fit.
      var rh = phone ? 42 : 24;
      keyRows.forEach(function (k, i) {
        var x = (i % cols) * cw, y = H + 18 + Math.floor(i / cols) * rh;
        g += L(x, y - 4, x + 22, y - 4, k.color, ' stroke-width="3"' + (k.dash ? ' stroke-dasharray="6,4"' : ''));
        g += phone ? T(x + 28, y, '$' + num(k.v), { fill: k.color, w: 700 }) + T(x + 28, y + 18, k.label, { fill: k.color })
          : T(x + 28, y, '$' + num(k.v) + '  ' + k.label, { fill: k.color, w: 700 });
      });
      return { g: g, h: H + 18 + Math.ceil(keyRows.length / cols) * rh };
    }
    var dk = keyed(DW, 280, false), pk = keyed(PW, 240, true);
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, label: o.label, dh: dk.h, ph: pk.h, desk: dk.g, phone: pk.g });
  }

  // Lines over time on one axis, each in its own unit format: rates, indexes, homes. x is a Date or a year.
  // o: { series: [{ label, color, dash, points: [[x, y]] }], fmt: function (y) → text, zero: start the axis at 0 }
  function timeLines(o) {
    var ss = o.series.filter(function (s) { return s.points.length > 1; });
    if (!ss.length) return '';
    var t = function (x) { return x instanceof Date ? x.getTime() : +x; }, yr = function (x) { return x instanceof Date ? x.getFullYear() : +x; };
    var xs = [], ys = [];
    ss.forEach(function (s) { s.points.forEach(function (p) { xs.push(t(p[0])); ys.push(p[1]); }); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var lo = o.zero === false ? Math.min.apply(null, ys) : Math.min(0, Math.min.apply(null, ys)), hi = Math.max.apply(null, ys);
    // A round step (1, 2 or 5 times a power of ten) giving about five gridlines.
    var raw = ((hi - lo) || 1) / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 5, 10].map(function (k) { return k * mag; }).filter(function (v) { return v >= raw; })[0];
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var fmt = o.fmt || num, y0 = yr(new Date(x0)), y1 = yr(new Date(x1));
    if (!(ss[0].points[0][0] instanceof Date)) { y0 = x0; y1 = x1; }
    function draw(W, H, phone) {
      var yw = Math.max.apply(null, [lo, hi].map(function (v) { return tw(fmt(v)); })) + 14, top = 12, bot = H - 30;
      var X = function (v) { return yw + (v - x0) / ((x1 - x0) || 1) * (W - yw - 10); }, Y = function (v) { return bot - (v - lo) / ((hi - lo) || 1) * (bot - top); };
      var g = '';
      for (var v = lo; v <= hi + step / 1e6; v += step) g += L(yw, Y(v), W - 10, Y(v), LINE) + T(yw - 6, Y(v) + 4, fmt(v), { fill: MUT, a: 'end' });
      var every = phone ? Math.max(1, Math.ceil((y1 - y0) / 3)) : Math.max(1, Math.ceil((y1 - y0) / 7));
      for (var y = y0; y <= y1; y += every) {
        var at = ss[0].points[0][0] instanceof Date ? new Date(y, 0, 1).getTime() : y;
        if (at >= x0 && at <= x1) g += L(X(at), bot, X(at), bot + 4, MUT) + T(X(at), bot + 18, String(y), { fill: MUT, a: 'middle' });
      }
      ss.forEach(function (s) {
        g += '<path d="' + s.points.map(function (p, i) { return (i ? 'L' : 'M') + f1(X(t(p[0]))) + ' ' + f1(Y(p[1])); }).join('') + '" fill="none" stroke="' + s.color + '" stroke-width="2.5"' + (s.dash ? ' stroke-dasharray="7,4"' : '') + '/>';
      });
      ss.forEach(function (s) {
        var gapX = (W - yw - 10) / Math.max(1, s.points.length - 1);
        s.points.forEach(function (q) { g += HIT(X(t(q[0])), Y(q[1]), s.label + ', ' + when(q[0]) + ': ' + fmt(q[1]), gapX); });
      });
      // The key sits under the chart, each line with its latest value.
      var cols = phone ? 1 : 2, cw = W / cols, rh = 24;
      ss.forEach(function (s, i) {
        var x = (i % cols) * cw, ky = H + 18 + Math.floor(i / cols) * rh, last = s.points[s.points.length - 1][1];
        g += L(x, ky - 4, x + 22, ky - 4, s.color, ' stroke-width="3"' + (s.dash ? ' stroke-dasharray="6,4"' : '')) + T(x + 28, ky, fmt(last) + '  ' + s.label, { fill: INK, w: 600 });
      });
      return { g: g, h: H + 18 + Math.ceil(ss.length / cols) * rh };
    }
    var dk = draw(DW, 260, false), pk = draw(PW, 220, true);
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, label: o.label, tiles: o.tiles, dh: dk.h, ph: pk.h, desk: dk.g, phone: pk.g });
  }

  // An age pyramid: one row per age group, youngest at the bottom; men to the left of the centre line,
  // women to the right, both on one scale. rows: [label, men, women].
  function pyramid(o) {
    var rows = o.rows.slice().reverse();
    if (!rows.length) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r[1] || 0, r[2] || 0); })) || 1;
    var colors = [BLU, PUR], d = '', p = '';
    var mid = DW / 2, lab = 62, half = mid - lab / 2 - 70;
    d += T(mid - lab / 2 - 4, 14, 'Men', { size: 13, fill: MUT, a: 'end', w: 700 }) + T(mid + lab / 2 + 4, 14, 'Women', { size: 13, fill: MUT, w: 700 });
    var pm = PW / 2, pl = 50, ph = pm - pl / 2 - 4;
    p += T(pm - pl / 2 - 2, 14, 'Men', { fill: MUT, a: 'end', w: 700 }) + T(pm + pl / 2 + 2, 14, 'Women', { fill: MUT, w: 700 });
    rows.forEach(function (r, i) {
      var y = 24 + i * 22, wm = (r[1] || 0) / max * half, wf = (r[2] || 0) / max * half;
      d += R(mid - lab / 2 - wm, y, wm, 16, colors[0], { title: r[0] + ', men: ' + num(r[1]) }) + T(mid - lab / 2 - wm - 6, y + 13, num(r[1]), { size: 13, fill: MUT, a: 'end' }) +
        T(mid, y + 13, r[0], { size: 13, a: 'middle' }) +
        R(mid + lab / 2, y, wf, 16, colors[1], { title: r[0] + ', women: ' + num(r[2]) }) + T(mid + lab / 2 + wf + 6, y + 13, num(r[2]), { size: 13, fill: MUT });
      var py = 24 + i * 22, pwm = (r[1] || 0) / max * ph, pwf = (r[2] || 0) / max * ph;
      p += R(pm - pl / 2 - pwm, py, pwm, 14, colors[0], { title: r[0] + ', men: ' + num(r[1]) }) + T(pm, py + 12, r[0], { size: 13, a: 'middle' }) +
        R(pm + pl / 2, py, pwf, 14, colors[1], { title: r[0] + ', women: ' + num(r[2]) });
    });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, tiles: o.tiles, dh: 28 + rows.length * 22, ph: 28 + rows.length * 22, desk: d, phone: p });
  }

  // Bars in the order given (age groups, school levels), count at the tip and share of the total at the right.
  function orderedBars(o) {
    var rows = o.rows.filter(function (r) { return r[1] != null; });
    if (!rows.length) return o.empty ? unavailable(o) : '';
    var total = o.total || rows.reduce(function (t, r) { return t + r[1]; }, 0) || 1, max = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
    var d = '', p = '', top = 0;
    // o.keys: [[label, color]] drawn above the bars; o.colorOf(row, i) colours one bar.
    if (o.keys) { var kx = 0, pky = 0; o.keys.forEach(function (k) { d += key(kx, 0, k[1], k[0]); kx += tw(k[0]) + 48; p += key(0, pky, k[1], k[0]); pky += 22; }); top = 1; }
    var dt = top ? 30 : 0, pt = top ? o.keys.length * 22 + 8 : 0;
    var lw = Math.min(300, Math.max.apply(null, rows.map(function (r) { return tw(r[0], 14); })) + 16), dw = DW - lw - 120;
    rows.forEach(function (r, i) {
      var color = o.colorOf ? o.colorOf(r, i) : o.color || GRN;
      var y = dt + 8 + i * 34, w = Math.max(r[1] / max * dw, r[1] > 0 ? 3 : 0), share = o.noShare ? '' : Math.round(r[1] / total * 1000) / 10 + '%';
      var fmt = o.fmt || num;
      d += T(0, y + 16, r[0], { size: 14 }) + R(lw, y + 3, w, 18, color, { title: r[0] + ': ' + num(r[1]) }) +
        T(lw + w + 8, y + 17, fmt(r[1]), { size: 14, w: 700 }) + T(DW, y + 17, share, { size: 14, fill: MUT, a: 'end' });
      var py = pt + 6 + i * 50, pw = Math.max(r[1] / max * (PW - 70), r[1] > 0 ? 3 : 0);
      p += T(0, py + 14, r[0], { size: 14 }) + T(PW, py + 14, share, { fill: MUT, a: 'end' }) +
        R(0, py + 22, pw, 14, color, { title: r[0] + ': ' + num(r[1]) }) + T(pw + 8, py + 34, fmt(r[1]), { w: 700 });
    });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, tiles: o.tiles, label: o.label, dh: dt + 8 + rows.length * 34 + 4, ph: pt + 6 + rows.length * 50, desk: d, phone: p });
  }

  // Two shares side by side for each row, on one 0-to-top scale: what there is against what is needed.
  // rows: [[label, a, b]] in percent; series: [[name, color], [name, color]].
  function pairedBars(o) {
    var rows = o.rows.filter(function (r) { return r[1] != null || r[2] != null; });
    if (!rows.length) return o.empty ? unavailable(o) : '';
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r[1] || 0, r[2] || 0); })) || 1;
    var S = o.series, d = '', p = '', kx = 0;
    S.forEach(function (k) { d += key(kx, 0, k[1], k[0]); kx += tw(k[0]) + 48; p += key(0, S.indexOf(k) * 22, k[1], k[0]); });
    var lw = Math.min(200, Math.max.apply(null, rows.map(function (r) { return tw(r[0], 14); })) + 16), dw = DW - lw - 70;
    var lab = function (v) { return v == null ? 'n/a' : pct(v); };
    rows.forEach(function (r, i) {
      var y = 34 + i * 52, py = S.length * 22 + 8 + i * 70;
      d += T(0, y + 26, r[0], { size: 14 });
      p += T(0, py + 14, r[0], { size: 14, w: 600 });
      [1, 2].forEach(function (j) {
        var v = r[j], w = v == null ? 0 : Math.max(v / max * dw, v > 0 ? 3 : 0), pw = v == null ? 0 : Math.max(v / max * (PW - 60), v > 0 ? 3 : 0);
        var t = r[0] + ', ' + S[j - 1][0] + ': ' + lab(v);
        d += R(lw, y + 4 + (j - 1) * 22, w, 18, S[j - 1][1], { title: t }) + T(lw + w + 8, y + 18 + (j - 1) * 22, lab(v), { size: 14, w: 700 });
        p += R(0, py + 22 + (j - 1) * 20, pw, 14, S[j - 1][1], { title: t }) + T(pw + 6, py + 34 + (j - 1) * 20, lab(v), { w: 700 });
      });
    });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, label: o.label, dh: 34 + rows.length * 52, ph: S.length * 22 + 8 + rows.length * 70, desk: d, phone: p });
  }

  // One bar per group, split into parts that add to the group's total; the key sits above and each row ends
  // with o.end(row). rows: [[label, [part values]]]; parts: [[name, color]].
  function stackedBars(o) {
    var rows = o.rows.filter(function (r) { return r[1].some(function (x) { return x != null; }); });
    if (!rows.length) return '';
    var sum = function (r) { return r[1].reduce(function (t, x) { return t + (x || 0); }, 0); };
    var max = Math.max.apply(null, rows.map(sum)) || 1, d = '', p = '', ky = 0, kx = 0, pky = 0, pkx = 0;
    o.parts.forEach(function (pt) {
      var w = tw(pt[0]) + 34;
      if (kx + w > DW) { kx = 0; ky += 22; }
      d += key(kx, ky, pt[1], pt[0]); kx += w;
      if (pkx + w > PW) { pkx = 0; pky += 22; }
      p += key(pkx, pky, pt[1], pt[0]); pkx += w;
    });
    var dt = ky + 34, pt0 = pky + 34;
    var lw = Math.min(220, Math.max.apply(null, rows.map(function (r) { return tw(r[0], 14); })) + 16), dw = DW - lw - 190;
    rows.forEach(function (r, i) {
      var y = dt + i * 34, x = lw, py = pt0 + i * 52, px = 0, end = o.end ? o.end(r) : num(sum(r));
      d += T(0, y + 16, r[0], { size: 14 });
      p += T(0, py + 14, r[0], { size: 14 });
      r[1].forEach(function (v, j) {
        if (!v) return;
        var w = v / max * dw, pw = v / max * (PW - 10), t = r[0] + ', ' + o.parts[j][0] + ': ' + num(v);
        d += R(x, y + 3, w, 18, o.parts[j][1], { title: t }); x += w;
        p += R(px, py + 22, pw, 14, o.parts[j][1], { title: t }); px += pw;
      });
      d += T(x + 8, y + 17, end, { size: 14, w: 700 });
      p += T(PW, py + 14, end, { fill: MUT, a: 'end' });
    });
    return figure({ title: o.title, scope: o.scope, answer: o.answer, note: o.note, source: o.source, dh: dt + rows.length * 34 + 4, ph: pt0 + rows.length * 52, desk: d, phone: p });
  }

  global.LabViz = { unavailable: unavailable, pairedBars: pairedBars, stackedBars: stackedBars, pyramid: pyramid, orderedBars: orderedBars, timeLines: timeLines, reachBars: reachBars, multiLine: multiLine, indexLine: indexLine, sortedBars: sortedBars, splitBar: splitBar, dotPairs: dotPairs, commute: commute, projection: projection, outlook: outlook, rentScale: rentScale, cumulative: cumulative,
    COLORS: { ink: INK, muted: MUT, pine: PINE, households: RUST, homes: GRN, blue: BLU, purple: PUR, band: BAND } };
})(window);
