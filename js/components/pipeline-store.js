/**
 * js/components/pipeline-store.js — F161
 * ===============================================================
 * In-browser CRUD layer for IndiBuild Pipeline jurisdictions.
 *
 * The canonical source is docs/indibuild-pipeline-prototype/02-pipeline.csv
 * (read-only via fetch). This layer adds a localStorage cache of:
 *   - DRAFTS: new pipeline rows (jurisdictions added in-app, not yet
 *     in the canonical CSV)
 *   - EDITS:  field-level overrides on canonical rows (so a stage
 *     change in the UI shows up without a CSV edit)
 *   - DELETES: queued removals of canonical rows (export marks them
 *     for deletion in the next CSV commit)
 *
 * Public surface:
 *   PipelineStore.loadCanonical() -> Promise<row[]>
 *   PipelineStore.getDrafts() -> row[]
 *   PipelineStore.addDraft(row)
 *   PipelineStore.updateDraft(geoid, updates)
 *   PipelineStore.removeDraft(geoid)
 *   PipelineStore.editCanonical(geoid, updates)
 *   PipelineStore.getCanonicalEdits() -> {geoid: updates}
 *   PipelineStore.queueDelete(geoid)
 *   PipelineStore.unqueueDelete(geoid)
 *   PipelineStore.getQueuedDeletes() -> Set<geoid>
 *   PipelineStore.merge(canonical[], drafts[], edits, deletes) -> row[]
 *   PipelineStore.exportCsv(canonical[]) -> string  (CSV text ready to download)
 *   PipelineStore.clearAll()
 *
 * Row shape (matches 02-pipeline.csv header):
 *   {
 *     jurisdiction, geoid, stage, ioi_score, confidence, classification,
 *     product_type, last_update, next_action, next_action_due, notes,
 *     _isDraft? boolean, _hasLocalEdits? boolean, _queuedForDelete? boolean
 *   }
 *
 * Storage keys are versioned so a future schema change can migrate.
 */
(function (global) {
  'use strict';
  if (global.PipelineStore) return;

  var CSV_URL  = 'docs/indibuild-pipeline-prototype/02-pipeline.csv';
  var KEY_V    = 'v1';
  var KEY_DRAFTS  = 'coho_indibuild_pipeline_drafts_' + KEY_V;
  var KEY_EDITS   = 'coho_indibuild_pipeline_edits_'  + KEY_V;
  var KEY_DELETES = 'coho_indibuild_pipeline_deletes_'+ KEY_V;

  var HEADERS = [
    'jurisdiction','geoid','stage','ioi_score','confidence','classification',
    'product_type','last_update','next_action','next_action_due','notes'
  ];

  var STAGES = [
    'Signal','Screen','Outreach','Brief','PreApp','Active','Closed','Anti'
  ];
  var CONFIDENCES = ['low','medium','high'];
  var CLASSIFICATIONS = ['A','B','C','D'];

  function _readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_) { return fallback; }
  }
  function _writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('[PipelineStore] write failed:', e.message); }
  }

  // ────────────────────────────────────────────────────────────────
  // Minimal CSV parser. The pipeline CSV is plain — header row + data
  // rows, double quotes for cells with commas. No multi-line cells.
  // ────────────────────────────────────────────────────────────────
  function parseCsvText(text) {
    if (!text) return [];
    var lines = text.split(/\r?\n/).filter(function (l) { return l.length > 0; });
    if (!lines.length) return [];
    var hdr = parseCsvLine(lines[0]);
    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = parseCsvLine(lines[i]);
      var row = {};
      for (var j = 0; j < hdr.length; j++) row[hdr[j]] = cells[j] || '';
      out.push(row);
    }
    return out;
  }
  function parseCsvLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else { cur += c; }
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }
  function escapeCsvCell(v) {
    var s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ────────────────────────────────────────────────────────────────
  // Loading + CRUD
  // ────────────────────────────────────────────────────────────────
  var _canonicalCache = null;
  function loadCanonical(opts) {
    opts = opts || {};
    if (_canonicalCache && !opts.force) return Promise.resolve(_canonicalCache);
    return fetch(CSV_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        _canonicalCache = parseCsvText(txt);
        return _canonicalCache;
      })
      .catch(function () { _canonicalCache = []; return _canonicalCache; });
  }

  function getDrafts() { return _readJson(KEY_DRAFTS, []); }
  function getCanonicalEdits() { return _readJson(KEY_EDITS, {}); }
  function getQueuedDeletes() {
    var arr = _readJson(KEY_DELETES, []);
    return new Set(arr);
  }

  function _normalizeRow(input) {
    var row = {};
    HEADERS.forEach(function (k) { row[k] = (input && input[k] != null) ? String(input[k]) : ''; });
    return row;
  }

  function addDraft(row) {
    var n = _normalizeRow(row);
    if (!n.jurisdiction && !n.geoid) return false;
    var drafts = getDrafts();
    // Don't duplicate: if a draft with same geoid already exists, update it
    var existingIdx = drafts.findIndex(function (d) { return d.geoid && d.geoid === n.geoid; });
    if (existingIdx >= 0) { drafts[existingIdx] = n; }
    else { drafts.push(n); }
    _writeJson(KEY_DRAFTS, drafts);
    return true;
  }

  function updateDraft(geoid, updates) {
    if (!geoid) return false;
    var drafts = getDrafts();
    var i = drafts.findIndex(function (d) { return d.geoid === geoid; });
    if (i < 0) return false;
    drafts[i] = _normalizeRow(Object.assign({}, drafts[i], updates));
    _writeJson(KEY_DRAFTS, drafts);
    return true;
  }

  function removeDraft(geoid) {
    if (!geoid) return false;
    var drafts = getDrafts();
    var filtered = drafts.filter(function (d) { return d.geoid !== geoid; });
    _writeJson(KEY_DRAFTS, filtered);
    return drafts.length !== filtered.length;
  }

  function editCanonical(geoid, updates) {
    if (!geoid || !updates) return false;
    var edits = getCanonicalEdits();
    edits[geoid] = Object.assign({}, edits[geoid] || {}, updates);
    _writeJson(KEY_EDITS, edits);
    return true;
  }

  function clearCanonicalEdit(geoid) {
    if (!geoid) return false;
    var edits = getCanonicalEdits();
    if (edits[geoid]) { delete edits[geoid]; _writeJson(KEY_EDITS, edits); return true; }
    return false;
  }

  function queueDelete(geoid) {
    if (!geoid) return false;
    var arr = _readJson(KEY_DELETES, []);
    if (arr.indexOf(geoid) < 0) { arr.push(geoid); _writeJson(KEY_DELETES, arr); return true; }
    return false;
  }
  function unqueueDelete(geoid) {
    var arr = _readJson(KEY_DELETES, []);
    var filtered = arr.filter(function (g) { return g !== geoid; });
    if (filtered.length !== arr.length) { _writeJson(KEY_DELETES, filtered); return true; }
    return false;
  }

  // Merge canonical + drafts + edits + deletes into the view shape
  function merge(canonical, drafts, edits, deletes) {
    canonical = canonical || [];
    drafts    = drafts    || getDrafts();
    edits     = edits     || getCanonicalEdits();
    deletes   = deletes   || getQueuedDeletes();

    var out = [];
    canonical.forEach(function (row) {
      var merged = Object.assign({}, row);
      var e = edits[row.geoid];
      if (e) {
        Object.assign(merged, e);
        merged._hasLocalEdits = true;
      }
      if (deletes.has(row.geoid)) merged._queuedForDelete = true;
      out.push(merged);
    });
    drafts.forEach(function (d) {
      var n = Object.assign({}, d, { _isDraft: true });
      out.push(n);
    });
    return out;
  }

  // Produce the new CSV text after applying drafts + edits + deletes.
  // Output respects header order; canonical rows queued for delete are
  // dropped; canonical rows with edits get the merged values; drafts are
  // appended at the bottom.
  function exportCsv(canonical) {
    canonical = canonical || _canonicalCache || [];
    var drafts  = getDrafts();
    var edits   = getCanonicalEdits();
    var deletes = getQueuedDeletes();

    var out = [HEADERS.join(',')];
    canonical.forEach(function (row) {
      if (deletes.has(row.geoid)) return;
      var merged = Object.assign({}, row, edits[row.geoid] || {});
      out.push(HEADERS.map(function (k) { return escapeCsvCell(merged[k]); }).join(','));
    });
    drafts.forEach(function (d) {
      out.push(HEADERS.map(function (k) { return escapeCsvCell(d[k]); }).join(','));
    });
    return out.join('\n') + '\n';
  }

  function clearAll() {
    localStorage.removeItem(KEY_DRAFTS);
    localStorage.removeItem(KEY_EDITS);
    localStorage.removeItem(KEY_DELETES);
  }

  // Summary counts for the UI badge
  function counts() {
    return {
      drafts:  getDrafts().length,
      edits:   Object.keys(getCanonicalEdits()).length,
      deletes: getQueuedDeletes().size
    };
  }

  global.PipelineStore = {
    HEADERS:         HEADERS,
    STAGES:          STAGES,
    CONFIDENCES:     CONFIDENCES,
    CLASSIFICATIONS: CLASSIFICATIONS,
    CSV_URL:         CSV_URL,
    parseCsvText:    parseCsvText,
    loadCanonical:   loadCanonical,
    getDrafts:       getDrafts,
    addDraft:        addDraft,
    updateDraft:     updateDraft,
    removeDraft:     removeDraft,
    editCanonical:   editCanonical,
    clearCanonicalEdit: clearCanonicalEdit,
    getCanonicalEdits: getCanonicalEdits,
    queueDelete:     queueDelete,
    unqueueDelete:   unqueueDelete,
    getQueuedDeletes: getQueuedDeletes,
    merge:           merge,
    exportCsv:       exportCsv,
    clearAll:        clearAll,
    counts:          counts
  };
})(typeof window !== 'undefined' ? window : globalThis);
