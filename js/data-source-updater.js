// js/data-source-updater.js
// Handles reading discovery reports and generating DATA-MANIFEST.json-compatible
// entries. In browser context this produces downloadable JSON; in CI/Node context
// (data-source-monitoring.yml) the workflow script calls scripts/discovery-node.mjs.
// Exposed as window.DataSourceUpdater.

(function () {
  'use strict';

  var MANIFEST_PATH = 'DATA-MANIFEST.json';

  function resolvePath(p) {
    return (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl(p)
      : p;
  }

  // ── Format an ISO date string ───────────────────────────────────────────

  function nowISO() { return new Date().toISOString(); }

  // ── Build a new manifest entry from a discovery probe result ────────────

  /**
   * Convert a discovered-source probe object into a DATA-MANIFEST.json entry.
   * @param {object} discovered  — object from DataSourceDiscovery.newSources[]
   * @param {object} [overrides] — optional manual overrides from admin form
   * @returns {object} manifest entry
   */
  function buildEntry(discovered, overrides) {
    var o = overrides || {};
    return {
      file_path:    discovered.path,
      source_name:  o.source_name  || discovered.suggestedName || discovered.path,
      source_url:   o.source_url   || null,
      update_method: o.update_method || 'cached',
      status:        o.status       || 'seed',
      fallback_rule: o.fallback_rule || 'Log warning and skip layer.',
      last_update:   o.last_update  || nowISO().slice(0, 10) + 'T00:00:00Z',
      description:   o.description  || discovered.suggestedDesc || '',
      discovery: {
        auto_discovered:   true,
        discovery_ts:      discovered.hash ? nowISO() : null,
        file_hash:         discovered.hash || null,
        suggested_freq:    discovered.suggestedFreq || 'Unknown',
        pending_review:    !o._approved,
        approved_by:       o.approved_by  || null,
        approved_ts:       o.approved_ts  || null
      }
    };
  }

  // ── Merge new entries into a manifest object ────────────────────────────

  /**
   * Take existing manifest JSON and merge in new entries.
   * @param {object}   manifest  — parsed DATA-MANIFEST.json
   * @param {object[]} newEntries — array of buildEntry() results
   * @returns {object} updated manifest
   */
  function mergeEntries(manifest, newEntries) {
    var existing = manifest.sources || [];
    var existingPaths = {};
    for (var i = 0; i < existing.length; i++) {
      existingPaths[existing[i].file_path] = true;
    }
    var added = [];
    for (var j = 0; j < newEntries.length; j++) {
      if (!existingPaths[newEntries[j].file_path]) {
        added.push(newEntries[j]);
      }
    }
    return Object.assign({}, manifest, {
      sources:  existing.concat(added),
      discovery_updated: nowISO()
    });
  }

  // ── Generate downloadable manifest patch ────────────────────────────────

  /**
   * Fetch the current manifest, apply new entries, and return the patched object.
   * @param {object[]} newEntries
   * @returns {Promise<object>}
   */
  function generatePatch(newEntries) {
    return fetch(resolvePath(MANIFEST_PATH))
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (manifest) {
        return mergeEntries(manifest, newEntries);
      })
      .catch(function () {
        return mergeEntries({ manifest_version: '1.0', sources: [] }, newEntries);
      });
  }

  /**
   * Trigger a browser download of the patched manifest JSON.
   * @param {object} patchedManifest
   */
  function downloadPatch(patchedManifest) {
    var blob = new Blob(
      [JSON.stringify(patchedManifest, null, 2)],
      { type: 'application/json' }
    );
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href   = url;
    a.download = 'DATA-MANIFEST-patched.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Approve a single pending source ────────────────────────────────────

  /**
   * Mark a pending source as approved, update sessionStorage list.
   * @param {string}  filePath
   * @param {string}  approvedBy — identifier for the reviewer
   * @returns {object} updated entry
   */
  function approvePendingSource(filePath, approvedBy) {
    var PENDING_KEY = 'drh_pending_approvals';
    var list = [];
    try {
      list = JSON.parse(sessionStorage.getItem(PENDING_KEY) || '[]');
    } catch (_) { list = []; }

    var now = nowISO();
    var updated = list.map(function (entry) {
      if (entry.file_path === filePath) {
        var e = Object.assign({}, entry);
        e.discovery = Object.assign({}, e.discovery, {
          pending_review: false,
          approved_by:    approvedBy || 'admin',
          approved_ts:    now,
          _approved:      true
        });
        return e;
      }
      return entry;
    });

    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(updated));
    } catch (_) { /* quota */ }

    return updated.find(function (e) { return e.file_path === filePath; }) || null;
  }

  // ── "Where Used" scanner (browser-side, limited) ────────────────────────

  /**
   * Produce a rough "where used" list by checking if a file path string appears
   * in the DataSourceInventory registry or the discovery probe results.
   * Full cross-file code scanning happens in the GitHub Actions Node script.
   * @param {string} filePath
   * @returns {string[]} list of page names / descriptions
   */
  function whereUsed(filePath) {
    var uses = [];
    if (window.DataSourceInventory) {
      var sources = window.DataSourceInventory.getSources();
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.localFile === filePath || (s.url && s.url.indexOf(filePath) !== -1)) {
          uses.push(s.name + ' (' + (s.tags || []).join(', ') + ')');
        }
      }
    }
    return uses;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  window.DataSourceUpdater = {
    buildEntry:             buildEntry,
    mergeEntries:           mergeEntries,
    generatePatch:          generatePatch,
    downloadPatch:          downloadPatch,
    approvePendingSource:   approvePendingSource,
    whereUsed:              whereUsed
  };

}());
