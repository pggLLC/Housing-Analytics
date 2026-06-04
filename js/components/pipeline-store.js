/**
 * js/components/pipeline-store.js — F161
 * ===============================================================
 * In-browser CRUD layer for IndiBuild Pipeline jurisdictions, now
 * built on top of a generic `createIbStore` factory so the same
 * draft / edit / delete / export machinery can back additional
 * stores (signals, anti-targets, network) without copy-paste.
 *
 * Two surfaces are exposed:
 *   1. window.IbCsvStore  — the generic factory:
 *        createIbStore({ csvUrl, storageNamespace, headers, enumLists })
 *      Future stores can call this directly with their own csvUrl,
 *      namespace and headers; `enumLists` is optional.
 *   2. window.PipelineStore — the pipeline-specific instance,
 *      preserving its original public API exactly:
 *        loadCanonical, getDrafts, addDraft, updateDraft,
 *        removeDraft, editCanonical, clearCanonicalEdit,
 *        getCanonicalEdits, queueDelete, unqueueDelete,
 *        getQueuedDeletes, merge, exportCsv, clearAll, counts,
 *        HEADERS, STAGES, CONFIDENCES, CLASSIFICATIONS,
 *        CSV_URL, parseCsvText.
 *
 * The canonical source for the pipeline is
 * docs/indibuild-pipeline-prototype/02-pipeline.csv (read-only via
 * fetch). The local layer adds a localStorage cache of:
 *   - DRAFTS: new rows (added in-app, not yet in the canonical CSV)
 *   - EDITS:  field-level overrides on canonical rows
 *   - DELETES: queued removals of canonical rows
 *
 * Row shape for the pipeline store (matches 02-pipeline.csv header):
 *   {
 *     jurisdiction, geoid, stage, ioi_score, confidence, classification,
 *     product_type, last_update, next_action, next_action_due, notes,
 *     _isDraft? boolean, _hasLocalEdits? boolean, _queuedForDelete? boolean
 *   }
 *
 * Storage keys are versioned (KEY_V = "v1") so a future schema
 * change can migrate. A console.info fires if any legacy-shaped key
 * (without the version suffix) is detected for the configured
 * namespace — scaffolding for a future migration helper, no
 * auto-migrate today.
 */
(function (global) {
  'use strict';

  // ────────────────────────────────────────────────────────────────
  // Generic CSV helpers (shared across all stores)
  // ────────────────────────────────────────────────────────────────

  // Walk char-by-char tracking inQuotes; only end a row when we hit
  // \n outside quotes. Handles quoted cells that contain commas AND
  // embedded newlines (the pipeline `notes` column commonly has
  // multi-line text). Treats \r\n and lone \n identically.
  function parseCsvText(text) {
    if (!text) return [];
    var rows = [];
    var row = [];
    var cur = '';
    var inQ = false;
    var i = 0;
    var n = text.length;

    while (i < n) {
      var c = text.charAt(i);

      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { cur += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cur += c; i++; continue;
      }

      // Not inside quotes
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(cur); cur = ''; i++; continue; }
      if (c === '\r') {
        // Treat \r or \r\n as end of row
        row.push(cur); cur = '';
        rows.push(row); row = [];
        if (text.charAt(i + 1) === '\n') i += 2; else i++;
        continue;
      }
      if (c === '\n') {
        row.push(cur); cur = '';
        rows.push(row); row = [];
        i++; continue;
      }
      cur += c; i++;
    }
    // Flush trailing cell/row
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }

    // Drop a trailing empty row (file ends with \n)
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
      rows.pop();
    }
    if (!rows.length) return [];

    var hdr = rows[0];
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      var obj = {};
      for (var j = 0; j < hdr.length; j++) obj[hdr[j]] = (cells[j] != null ? cells[j] : '');
      out.push(obj);
    }
    return out;
  }

  // Back-compat helper: parse a single physical line (no embedded
  // newlines). Kept because external code may have referenced it via
  // the module scope; the row-aware parser above is the real engine.
  function parseCsvLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (inQ) {
        if (c === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
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
  // Tiny inline round-trip self-test. Parses a known string with
  // embedded newlines + commas, then re-serializes the single row
  // and confirms cell-for-cell equality. Warns on mismatch — never
  // throws, so a failure can't break consumer pages.
  // ────────────────────────────────────────────────────────────────
  (function _selfTest() {
    try {
      var sample =
        'a,b,c\r\n' +
        '1,"hello, world","line1\nline2"\r\n' +
        '2,"quote ""inside""","plain"\r\n';
      var parsed = parseCsvText(sample);
      var expected = [
        { a: '1', b: 'hello, world', c: 'line1\nline2' },
        { a: '2', b: 'quote "inside"', c: 'plain' }
      ];
      var ok = parsed.length === expected.length;
      if (ok) {
        for (var i = 0; i < expected.length && ok; i++) {
          ['a','b','c'].forEach(function (k) {
            if (parsed[i][k] !== expected[i][k]) ok = false;
          });
        }
      }
      if (!ok) {
        console.warn('[IbCsvStore] CSV round-trip self-test FAILED', { parsed: parsed, expected: expected });
        return;
      }
      // Re-serialize and re-parse to confirm round-trip
      var headers = ['a','b','c'];
      var lines = [headers.join(',')];
      parsed.forEach(function (row) {
        lines.push(headers.map(function (k) { return escapeCsvCell(row[k]); }).join(','));
      });
      var roundTrip = parseCsvText(lines.join('\n') + '\n');
      var rtOk = roundTrip.length === expected.length;
      if (rtOk) {
        for (var j = 0; j < expected.length && rtOk; j++) {
          ['a','b','c'].forEach(function (k) {
            if (roundTrip[j][k] !== expected[j][k]) rtOk = false;
          });
        }
      }
      if (!rtOk) {
        console.warn('[IbCsvStore] CSV re-serialize round-trip FAILED', { roundTrip: roundTrip, expected: expected });
      }
    } catch (e) {
      console.warn('[IbCsvStore] CSV self-test errored:', e && e.message);
    }
  })();

  // ────────────────────────────────────────────────────────────────
  // Generic store factory. Returns an object with the full CRUD +
  // merge + export surface. The pipeline store wraps an instance of
  // this; future stores can call createIbStore directly.
  // ────────────────────────────────────────────────────────────────
  var KEY_V = 'v1';

  function createIbStore(config) {
    config = config || {};
    var csvUrl  = config.csvUrl;
    var ns      = config.storageNamespace;
    var headers = (config.headers || []).slice();
    var enums   = config.enumLists || {};

    if (!csvUrl)  throw new Error('createIbStore: csvUrl is required');
    if (!ns)      throw new Error('createIbStore: storageNamespace is required');
    if (!headers.length) throw new Error('createIbStore: headers must be a non-empty array');

    var KEY_DRAFTS  = ns + '_drafts_'  + KEY_V;
    var KEY_EDITS   = ns + '_edits_'   + KEY_V;
    var KEY_DELETES = ns + '_deletes_' + KEY_V;

    // Future-proof scaffolding: surface (but don't migrate) any
    // legacy-shaped keys with the same namespace but no version.
    (function _detectLegacy() {
      if (typeof localStorage === 'undefined') return;
      var legacyCandidates = [
        ns + '_drafts',
        ns + '_edits',
        ns + '_deletes'
      ];
      legacyCandidates.forEach(function (k) {
        try {
          if (localStorage.getItem(k) != null) {
            console.info('[IbCsvStore] legacy storage key detected (not auto-migrated):', k);
          }
        } catch (_) { /* ignore */ }
      });
    })();

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
      catch (e) { console.warn('[IbCsvStore] write failed for ' + key + ':', e && e.message); }
    }

    function _normalizeRow(input) {
      var row = {};
      headers.forEach(function (k) { row[k] = (input && input[k] != null) ? String(input[k]) : ''; });
      return row;
    }

    // ── Loading + CRUD ────────────────────────────────────────────
    var _canonicalCache = null;
    function loadCanonical(opts) {
      opts = opts || {};
      if (_canonicalCache && !opts.force) return Promise.resolve(_canonicalCache);
      return fetch(csvUrl, { cache: 'no-cache' })
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

    function addDraft(row) {
      var n = _normalizeRow(row);
      if (!n.jurisdiction && !n.geoid) return false;
      var drafts = getDrafts();
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
        var nx = Object.assign({}, d, { _isDraft: true });
        out.push(nx);
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

      var out = [headers.join(',')];
      canonical.forEach(function (row) {
        if (deletes.has(row.geoid)) return;
        var merged = Object.assign({}, row, edits[row.geoid] || {});
        out.push(headers.map(function (k) { return escapeCsvCell(merged[k]); }).join(','));
      });
      drafts.forEach(function (d) {
        out.push(headers.map(function (k) { return escapeCsvCell(d[k]); }).join(','));
      });
      return out.join('\n') + '\n';
    }

    function clearAll() {
      try {
        localStorage.removeItem(KEY_DRAFTS);
        localStorage.removeItem(KEY_EDITS);
        localStorage.removeItem(KEY_DELETES);
      } catch (_) { /* ignore */ }
    }

    function counts() {
      return {
        drafts:  getDrafts().length,
        edits:   Object.keys(getCanonicalEdits()).length,
        deletes: getQueuedDeletes().size
      };
    }

    var api = {
      HEADERS:            headers,
      CSV_URL:            csvUrl,
      parseCsvText:       parseCsvText,
      loadCanonical:      loadCanonical,
      getDrafts:          getDrafts,
      addDraft:           addDraft,
      updateDraft:        updateDraft,
      removeDraft:        removeDraft,
      editCanonical:      editCanonical,
      clearCanonicalEdit: clearCanonicalEdit,
      getCanonicalEdits:  getCanonicalEdits,
      queueDelete:        queueDelete,
      unqueueDelete:      unqueueDelete,
      getQueuedDeletes:   getQueuedDeletes,
      merge:              merge,
      exportCsv:          exportCsv,
      clearAll:           clearAll,
      counts:             counts
    };

    // Splice in any enum lists the caller provided (pipeline store
    // exposes STAGES/CONFIDENCES/CLASSIFICATIONS today; other stores
    // can pass whatever they need or skip this entirely).
    Object.keys(enums).forEach(function (k) { api[k] = enums[k]; });

    return api;
  }

  // Expose the generic factory for future stores.
  global.IbCsvStore = createIbStore;

  // ────────────────────────────────────────────────────────────────
  // Pipeline-specific instance — exact same public surface as before.
  // ────────────────────────────────────────────────────────────────
  if (global.PipelineStore) return;

  var PIPELINE_CSV_URL = 'docs/indibuild-pipeline-prototype/02-pipeline.csv';
  var PIPELINE_NS      = 'coho_indibuild_pipeline';

  var PIPELINE_HEADERS = [
    'jurisdiction','geoid','stage','ioi_score','confidence','classification',
    'product_type','last_update','next_action','next_action_due','notes'
  ];
  var STAGES = [
    'Signal','Screen','Outreach','Brief','PreApp','Active','Closed','Anti'
  ];
  var CONFIDENCES = ['low','medium','high'];
  var CLASSIFICATIONS = ['A','B','C','D'];

  global.PipelineStore = createIbStore({
    csvUrl:           PIPELINE_CSV_URL,
    storageNamespace: PIPELINE_NS,
    headers:          PIPELINE_HEADERS,
    enumLists: {
      STAGES:          STAGES,
      CONFIDENCES:     CONFIDENCES,
      CLASSIFICATIONS: CLASSIFICATIONS
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
