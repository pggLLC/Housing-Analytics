/**
 * private-workspace.js — reads the developer's private working files on the
 * gated site and answers "what do I know about this place?".
 *
 * The five CSVs (network contacts, pipeline, signal log, anti-targets, outreach
 * templates) live in the owner's private workspace, never in this repository.
 * The gated deployment copies them to docs/developer-pipeline-prototype/; the
 * public build excludes that folder (scripts/build-public-site.mjs) and the
 * public-artifact guard fails on it. On any site without them every file reads
 * as unreachable and the pages say so, rather than showing an empty pipeline as
 * if it were a real one.
 *
 * Nothing here feeds the jurisdiction report: these rows are shown only on the
 * gated working-tools screens, which do not print.
 *
 * window.PrivateWorkspace in the browser; module.exports under Node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrivateWorkspace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'docs/developer-pipeline-prototype/';
  // Each file, and a column only the real file has: a 404 page or a site's
  // fallback HTML served with 200 has no such header and reads as unreachable.
  var FILES = {
    signals:   { file: '01-signal-log.csv',         column: 'signal_type' },
    pipeline:  { file: '02-pipeline.csv',           column: 'next_action_due' },
    anti:      { file: '03-anti-targets.csv',       column: 'date_dropped' },
    network:   { file: '04-network.csv',            column: 'relationship_tier' },
    templates: { file: '05-outreach-templates.csv', column: 'template_name' }
  };
  var GEOID = /^08\d{3}(\d{2})?$/;

  function parseCsv(text) {
    var rows = [], row = [], field = '', q = false;
    text = String(text || '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x && x.trim(); }); });
  }

  // Rows as objects, or null when the text is not the expected file. Rows in a
  // file with a geoid column keep only real Colorado GEOIDs, which drops the
  // instruction and notes rows kept at the foot of the network file.
  function toObjects(text, column) {
    var rows = parseCsv(text);
    if (!rows.length) return null;
    var head = rows[0].map(function (h) { return h.trim(); });
    if (head.indexOf(column) === -1) return null;
    var hasGeoid = head.indexOf('geoid') !== -1;
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = (r[i] || '').trim(); });
      return o;
    }).filter(function (o) { return !hasGeoid || GEOID.test(o.geoid); });
  }

  // fetchText(url) -> Promise<string|null>. Resolves to
  // { reachable, files: { name: rows|null } }; reachable is true when any file loaded.
  function load(fetchText) {
    var names = Object.keys(FILES);
    return Promise.all(names.map(function (n) {
      return Promise.resolve()
        .then(function () { return fetchText(BASE + FILES[n].file); })
        .then(function (t) { return t == null ? null : toObjects(t, FILES[n].column); })
        .catch(function () { return null; });
    })).then(function (vals) {
      var files = {};
      names.forEach(function (n, i) { files[n] = vals[i]; });
      return { reachable: vals.some(function (v) { return v !== null; }), files: files };
    });
  }

  function browserFetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.text() : null; });
  }

  // Pipeline rows: the private file merged with the in-app drafts and edits
  // (PipelineStore), so a stage changed on the site shows everywhere.
  function mergedPipeline(ws, store) {
    var canonical = (ws && ws.files.pipeline) || [];
    if (!store || typeof store.merge !== 'function') return canonical.slice();
    return store.merge(canonical).filter(function (r) { return r && !r._queuedForDelete && GEOID.test(r.geoid || ''); });
  }

  // Everything the files hold for one place, plus rows for related places (a
  // town's county, a county's towns), each labelled with the place it is for.
  function forPlace(ws, pipeline, geoid, related) {
    var f = (ws && ws.files) || {};
    function pick(list, g) { return (list || []).filter(function (r) { return r.geoid === g; }); }
    var own = {
      network: pick(f.network, geoid),
      signals: pick(f.signals, geoid).sort(byDateDesc('date')),
      pipeline: pick(pipeline, geoid)[0] || null,
      anti: pick(f.anti, geoid)[0] || null
    };
    var rel = (related || []).map(function (g) {
      var n = pick(f.network, g), s = pick(f.signals, g), p = pick(pipeline, g)[0] || null;
      var name = (n[0] || s[0] || p || {}).jurisdiction || g;
      return { geoid: g, name: name, network: n, signals: s.sort(byDateDesc('date')), pipeline: p };
    }).filter(function (r) { return r.network.length || r.signals.length || r.pipeline; });
    return { own: own, related: rel };
  }

  function byDateDesc(k) { return function (a, b) { return String(b[k] || '').localeCompare(String(a[k] || '')); }; }

  // Whole days from today to an ISO date; null for a blank or unreadable date.
  function daysUntil(dateStr, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
    var d = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10));
    var t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((d - t) / 86400000);
  }

  // Everything due in the next `days` days, overdue first: pipeline next actions,
  // signal follow-ups (next_review_date) and anti-target revisit dates.
  function dueWithin(ws, pipeline, today, days) {
    var out = [];
    (pipeline || []).forEach(function (p) {
      var d = daysUntil(p.next_action_due, today);
      if (d !== null && d <= days && p.next_action) out.push({ kind: 'Pipeline', geoid: p.geoid, jurisdiction: p.jurisdiction, what: p.next_action, date: p.next_action_due, days: d, stage: p.stage || null });
    });
    ((ws && ws.files.signals) || []).forEach(function (s) {
      var d = daysUntil(s.next_review_date, today);
      if (d !== null && d <= days && String(s.status || '').toLowerCase() !== 'closed') out.push({ kind: 'Signal review', geoid: s.geoid, jurisdiction: s.jurisdiction, what: s.follow_up_action || s.summary, date: s.next_review_date, days: d, stage: null });
    });
    ((ws && ws.files.anti) || []).forEach(function (a) {
      var d = daysUntil(a.revisit_date, today);
      if (d !== null && d <= days) out.push({ kind: 'Revisit', geoid: a.geoid, jurisdiction: a.jurisdiction, what: 'Set aside ' + (a.date_dropped || '') + (a.reason ? ': ' + a.reason : '') + '. Decide whether to reopen.', date: a.revisit_date, days: d, stage: null });
    });
    return out.sort(function (a, b) { return a.days - b.days; });
  }

  function strongSignals(ws, today, days) {
    return ((ws && ws.files.signals) || []).filter(function (s) {
      var d = daysUntil(s.date, today);
      return s.strength === 'strong' && d !== null && d <= 0 && -d <= days;
    }).sort(byDateDesc('date'));
  }

  // Kanban columns. The private file uses Screen/Signal/Outreach/IC/Active/Monitor;
  // the in-app stage list adds Brief, PreApp and Closed. Monitor folds into Screen,
  // as it did in June; an unknown stage gets its own column rather than vanishing.
  var COLUMNS = [
    { key: 'Screen', stages: ['Screen', 'Monitor'] },
    { key: 'Signal', stages: ['Signal'] },
    { key: 'Outreach', stages: ['Outreach'] },
    { key: 'IC / brief / pre-app', stages: ['IC', 'Brief', 'PreApp'] },
    { key: 'Active', stages: ['Active'] },
    { key: 'Closed', stages: ['Closed'] }
  ];
  function columns(pipeline) {
    var cols = COLUMNS.map(function (c) { return { key: c.key, stages: c.stages, rows: [] }; });
    var other = {};
    (pipeline || []).forEach(function (r) {
      if (r.stage === 'Anti') return;   // anti-targets have their own list
      var col = cols.find(function (c) { return c.stages.indexOf(r.stage) !== -1; });
      if (col) col.rows.push(r);
      else (other[r.stage || 'No stage'] = other[r.stage || 'No stage'] || []).push(r);
    });
    Object.keys(other).forEach(function (k) { cols.push({ key: k, stages: [k], rows: other[k] }); });
    return cols;
  }

  function stats(ws, pipeline, today) {
    var f = (ws && ws.files) || {};
    var inConversation = (pipeline || []).filter(function (p) { return ['Outreach', 'IC', 'Brief', 'PreApp', 'Active'].indexOf(p.stage) !== -1; }).length;
    return {
      pipeline: f.pipeline === null && !(pipeline || []).length ? null : (pipeline || []).filter(function (p) { return p.stage !== 'Anti'; }).length,
      inConversation: f.pipeline === null && !(pipeline || []).length ? null : inConversation,
      strong30: f.signals === null ? null : strongSignals(ws, today, 30).length,
      anti: f.anti === null ? null : f.anti.length,
      contacts: f.network === null ? null : f.network.length
    };
  }

  return {
    BASE: BASE,
    FILES: FILES,
    parseCsv: parseCsv,
    toObjects: toObjects,
    load: load,
    browserFetchText: browserFetchText,
    mergedPipeline: mergedPipeline,
    forPlace: forPlace,
    daysUntil: daysUntil,
    dueWithin: dueWithin,
    strongSignals: strongSignals,
    columns: columns,
    stats: stats
  };
});
