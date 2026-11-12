// "Show the numbers" under every house chart: a plain table of the values the chart was drawn from, and a CSV of
// the same rows. Loaded right after viz.js. It wraps each LabViz chart, so a chart added later (or changed on another
// branch) gets its table without touching viz.js. The table reads only the chart's own inputs; nothing is computed
// here beyond the share column the bar charts already print. Hand-drawn charts and maps call LabVizData.block()
// with their own rows.
(function (global) {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function slug(s) { return String(s || 'chart').toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chart'; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  // Shown in the table: whole numbers get thousands commas, others keep up to two decimals. The CSV keeps the raw value.
  function show(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return iso(v);
    if (!isNum(v)) return String(v);
    var r = Math.round(v * 100) / 100;
    return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function iso(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function raw(v) { return v == null ? '' : v instanceof Date ? iso(v) : isNum(v) ? String(Math.round(v * 10000) / 10000) : String(v); }
  function csvText(cols, rows) {
    var q = function (v) { v = raw(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [cols].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }
  function plain(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim(); }

  // A row with no value says so. The cell reads "No value", never a blank or a 0, and the CSV carries a Status
  // column, so the numbers stay numbers. The words do not guess why: the source may not publish it, or it may
  // not have loaded; a chart that knows passes o.missing.
  var NO_VALUE = 'No value';
  function gone(v) { return v == null || v === ''; }
  // What the file is about once it has left the page: the place, the chart and its source, on every row.
  function context(title, o) {
    var c = global.LAB_VIZ_CONTEXT || {};
    return { geography: o.geography || c.geography || '', geoid: o.geoid || c.geoid || '', chart: plain(title), source: plain(o.source || '').replace(/\s+/g, ' ').replace(/^Sources?:\s*/i, '') };
  }
  // The block itself. title names the CSV file; cols and rows are what the reader sees and downloads.
  function block(title, cols, rows, o) {
    o = o || {};
    if (!cols || !rows || !rows.length) return '';
    var why = o.missing || 'no value in the source for this row';
    var anyGone = rows.some(function (r) { return r.slice(1).some(gone); });
    var cx = context(title, o);
    var extraCols = (anyGone ? ['Status'] : []).concat(['Chart'], cx.geography ? ['Geography'] : [], cx.geoid ? ['GEOID'] : [], cx.source ? ['Source'] : []);
    var csvRows = rows.map(function (r) {
      return r.concat(anyGone ? [r.slice(1).some(gone) ? why : ''] : [], [cx.chart], cx.geography ? [cx.geography] : [], cx.geoid ? [cx.geoid] : [], cx.source ? [cx.source] : []);
    });
    var href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + csvText(cols.concat(extraCols), csvRows));
    var file = slug(title) + (cx.geoid ? '-' + cx.geoid : '');
    return '<details class="viz-data"><summary>Show the numbers</summary>' +
      '<div class="viz-data-scroll table-scroll"><table class="viz-data-table"><caption class="sr-only">' + esc(plain(title)) + '</caption>' +
      '<thead><tr>' + cols.map(function (c, i) { return '<th scope="col"' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return i ? (gone(v) ? '<td class="num viz-na" title="' + esc(why.charAt(0).toUpperCase() + why.slice(1)) + '">' + NO_VALUE + '</td>' : '<td class="num">' + esc(o.fmt && o.fmt[i] && isNum(v) ? o.fmt[i](v) : show(v)) + '</td>') : '<th scope="row">' + esc(show(v)) + '</th>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' +
      (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') +
      '<p class="viz-data-csv"><a class="button-link secondary" href="' + href + '" download="' + esc(file) + '.csv">Download CSV</a></p></details>';
  }

  // Lines over time: one row per x value, one column per line. x is a Date, a year or a number.
  function seriesTable(series, xName) {
    var key = function (x) { return x instanceof Date ? x.getTime() : x; };
    var xs = {}, order = [];
    series.forEach(function (s) { (s.points || []).forEach(function (p) { var k = key(p[0]); if (!(k in xs)) { xs[k] = p[0]; order.push(k); } }); });
    order.sort(function (a, b) { return a - b; });
    var maps = series.map(function (s) { var m = {}; (s.points || []).forEach(function (p) { m[key(p[0])] = p[1]; }); return m; });
    return { cols: [xName || 'When'].concat(series.map(function (s) { return plain(s.label) || 'Value'; })),
      rows: order.map(function (k) { return [xs[k]].concat(maps.map(function (m) { return m[k]; })); }) };
  }

  // Reads a chart's inputs by their shape, so any chart that takes rows, parts, series or points gets a table.
  function tableFor(name, o) {
    if (!o) return null;
    var val = o.valueLabel || 'Value';
    if (name === 'commute' && o.flows) {
      var f = o.flows;
      return { cols: ['Group', 'Workers'], rows: [['Live and work here', f.within], ['Commute out', f.outflow], ['Commute in', f.inflow],
        ['Working residents', f.within != null && f.outflow != null ? f.within + f.outflow : null], ['Jobs located here', f.within != null && f.inflow != null ? f.within + f.inflow : null]] };
    }
    if (name === 'projection' && o.series && o.series.years) {
      var s = o.series, L = o.labels || {};
      var cols = ['Year', plain(L.main) || 'Forecast'], have = [s.main];
      if (s.alt) { cols.push(plain(L.alt) || 'Alternative'); have.push(s.alt); }
      if (s.low) { cols.push((plain(L.band) || 'Range') + ', low'); have.push(s.low); }
      if (s.high) { cols.push((plain(L.band) || 'Range') + ', high'); have.push(s.high); }
      return { cols: cols, rows: s.years.map(function (y, i) { return [y].concat(have.map(function (a) { return a[i]; })); }) };
    }
    if (name === 'dotPairs' && o.rows) {
      return { cols: ['Measure', plain(o.placeName) || 'Place', plain(o.countyName) || 'County', 'Verdict'], rows: o.rows.map(function (r) { return r.slice(0, 4); }) };
    }
    if (name === 'pyramid' && o.rows) return { cols: ['Age', 'Men', 'Women'], rows: o.rows.map(function (r) { return r.slice(0, 3); }) };
    if (name === 'indexLine' && o.points) return { cols: ['Month', plain(o.unit) || 'Index'], rows: o.points.map(function (p) { return [p[0], p[1]]; }) };
    if (name === 'rentScale' && o.rents) return { cols: ['Rent', 'Dollars a month'], rows: o.rents.filter(function (r) { return r[1] != null; }).map(function (r) { return [r[0], r[1]]; }) };
    if (name === 'reachBars' && o.rows) {
      var rr = o.rows.filter(function (r) { return r[1] != null; }).map(function (r) { return [r[0], r[1], o.target != null ? Math.max(o.target - r[1], 0) : null]; });
      return { cols: ['Income', 'Can pay', 'Short of ' + (plain(o.targetLabel) || 'target') + (o.target != null ? ' ($' + Math.round(o.target).toLocaleString('en-US') + ')' : '')], rows: rr };
    }
    if (name === 'outlook' && o.parts) {
      var orows = o.parts.filter(function (q) { return q[1] != null; }).map(function (q) { return [q[0], q[1]]; });
      var pc = o.pace;
      if (pc && pc.need != null) orows.push(['Needed each year', pc.need]);
      if (pc && pc.permits != null) orows.push(['Permitted each year', pc.permits]);
      if (pc && pc.sf != null) orows.push(['Permitted each year, single-family', pc.sf]);
      if (pc && pc.mf != null) orows.push(['Permitted each year, multifamily', pc.mf]);
      return { cols: ['Part', 'Homes'], rows: orows };
    }
    if (name === 'splitBar' && o.parts) return { cols: ['Group', 'Share (%)'], rows: o.parts.map(function (q) { return [q[0], q[1]]; }) };
    if (name === 'pairedBars' && o.rows && Array.isArray(o.series)) {
      return { cols: ['Group'].concat(o.series.map(function (k) { return plain(k[0]) + ' (%)'; })), rows: o.rows.filter(function (r) { return r[1] != null || r[2] != null; }).map(function (r) { return [r[0], r[1], r[2]]; }) };
    }
    if (Array.isArray(o.series) && o.series.length && o.series[0] && o.series[0].points) {
      var ss = o.series.filter(function (x) { return x.points && x.points.length; });
      var anyDate = ss.some(function (x) { return x.points.some(function (p) { return p[0] instanceof Date; }); });
      return seriesTable(ss, o.xLabel || (anyDate ? 'Date' : o.xUnit === 'year' || !o.xUnit ? 'Year' : plain(o.xUnit)));
    }
    if (Array.isArray(o.rows) && o.rows.length) {
      // Stacked rows: [label, [part values]] with part names in o.parts.
      if (Array.isArray(o.rows[0][1])) {
        var parts = (o.parts || []).map(function (p) { return plain(p[0]); });
        var n = o.rows[0][1].length;
        var heads = []; for (var j = 0; j < n; j++) heads.push(parts[j] || 'Part ' + (j + 1));
        return { cols: ['Group'].concat(heads, ['Total']), rows: o.rows.map(function (r) {
          var t = r[1].reduce(function (a, x) { return a + (x || 0); }, 0);
          return [r[0]].concat(r[1], [r[1].some(function (x) { return x != null; }) ? t : null]); }) };
      }
      // A group with no value stays in the table, marked as such; it is left out of the share's total only.
      var shown = o.rows;
      var withShare = (name === 'sortedBars' || name === 'orderedBars') && !o.noShare;
      var total = o.total || shown.reduce(function (t, r) { return t + (isNum(r[1]) ? r[1] : 0); }, 0);
      return { cols: ['Group', val].concat(withShare ? ['Share (%)'] : []), rows: shown.map(function (r) {
        var row = [r[0], r[1]];
        if (withShare) row.push(total && r[1] != null ? Math.round(r[1] / total * 1000) / 10 : null);
        return row; }), fmt: o.fmt ? { 1: o.fmt } : null };
    }
    return null;
  }

  // Puts the block inside the chart's own figure, after its source line.
  function attach(html, name, o) {
    // o.noData: the page already prints this chart's numbers right beside it.
    if (o && o.noData) return html;
    if (typeof html !== 'string' || html.indexOf('<figure class="viz"') !== 0 || html.indexOf('viz-data') !== -1 || html.indexOf('<table') !== -1) return html; // a chart that already prints its table keeps that one
    var t;
    try { t = tableFor(name, o); } catch (e) { t = null; }
    if (!t || !t.rows.length) return html;
    var b = block(o.title, t.cols, t.rows, { note: o.tableNote, fmt: t.fmt, source: o.source, missing: o.missing });
    var at = html.lastIndexOf('</figure>');
    return at < 0 ? html : html.slice(0, at) + b + html.slice(at);
  }

  function wrap(V) {
    if (!V || V.__dataTables) return;
    Object.keys(V).forEach(function (k) {
      if (typeof V[k] !== 'function' || k === 'unavailable') return;
      var fn = V[k];
      V[k] = function (o) { return attach(fn.apply(this, arguments), k, o); };
    });
    V.__dataTables = true;
  }
  wrap(global.LabViz);

  global.LabVizData = { block: block, tableFor: tableFor, attach: attach, csvText: csvText, wrap: wrap };
})(window);
