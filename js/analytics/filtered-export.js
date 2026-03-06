/**
 * js/analytics/filtered-export.js
 * Query-based filtered data export dialog.
 *
 * Responsibilities:
 *  - FilteredExportDialog class
 *  - Query-based export functionality
 *  - CSV and JSON export options
 *  - Metadata inclusion (filters, source data info)
 *
 * Exposed on window.FilteredExportDialog.
 */
(function () {
  'use strict';

  /* ── FilteredExportDialog class ─────────────────────────────────── */

  /**
   * @class FilteredExportDialog
   * @param {object} [options]
   * @param {string} [options.title]          - Dialog title.
   * @param {boolean} [options.includeMetadata] - Whether to include filter/source metadata.
   */
  function FilteredExportDialog(options) {
    this._options = options || {};
    this._dialog  = null;
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Open the export dialog.
   * @param {Array}  data    - Full dataset (already filtered or raw).
   * @param {Array}  filters - Applied filter descriptors (for metadata).
   * @param {object} [meta]  - Optional source metadata { source, asOf }.
   */
  FilteredExportDialog.prototype.open = function (data, filters, meta) {
    this._data    = Array.isArray(data)    ? data    : [];
    this._filters = Array.isArray(filters) ? filters : [];
    this._meta    = meta || {};
    this._buildDialog();
    document.body.appendChild(this._dialog);
    this._dialog.setAttribute('open', '');
    this._dialog.focus();
  };

  /**
   * Close and remove the dialog from the DOM.
   */
  FilteredExportDialog.prototype.close = function () {
    if (this._dialog && this._dialog.parentNode) {
      this._dialog.parentNode.removeChild(this._dialog);
    }
    this._dialog = null;
  };

  /**
   * Export filtered data as a CSV string.
   * @param {Array}  data
   * @param {Array}  filters
   * @param {object} [meta]
   * @returns {string}
   */
  FilteredExportDialog.toCSV = function (data, filters, meta) {
    if (!Array.isArray(data) || data.length === 0) return '';
    var headers = Object.keys(data[0]);
    var rows = [headers.join(',')];
    data.forEach(function (row) {
      var cells = headers.map(function (h) {
        var v = row[h];
        if (v === null || v === undefined) return '';
        var s = String(v);
        if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
          s = '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      });
      rows.push(cells.join(','));
    });
    if (meta && (meta.source || meta.asOf)) {
      rows.push('');
      rows.push('# Source: ' + (meta.source || 'unknown'));
      rows.push('# As of: ' + (meta.asOf || 'unknown'));
    }
    if (filters && filters.length > 0) {
      rows.push('# Filters applied: ' + filters.length);
    }
    return rows.join('\n');
  };

  /**
   * Export filtered data as a JSON string.
   * @param {Array}  data
   * @param {Array}  filters
   * @param {object} [meta]
   * @returns {string}
   */
  FilteredExportDialog.toJSON = function (data, filters, meta) {
    var out = {
      data:       data || [],
      count:      (data || []).length,
      exported:   new Date().toISOString(),
    };
    if (filters && filters.length > 0) {
      out.filters_applied = filters.map(function (f) {
        return { dimension: f.dimension, operator: f.operator, values: f.values };
      });
    }
    if (meta) {
      out.metadata = meta;
    }
    return JSON.stringify(out, null, 2);
  };

  /**
   * Trigger a file download in the browser.
   * @param {string} content
   * @param {string} filename
   * @param {string} mimeType
   */
  FilteredExportDialog.download = function (content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ── Internal ───────────────────────────────────────────────────── */

  FilteredExportDialog.prototype._buildDialog = function () {
    var self    = this;
    var data    = this._data;
    var filters = this._filters;
    var meta    = this._meta;

    var overlay = document.createElement('div');
    overlay.className = 'fed-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', this._options.title || 'Export Data');
    overlay.tabIndex = -1;

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) self.close();
    });

    var modal = document.createElement('div');
    modal.className = 'fed-modal';

    // Header
    var header = document.createElement('div');
    header.className = 'fed-header';
    var h3 = document.createElement('h3');
    h3.className = 'fed-title';
    h3.textContent = this._options.title || 'Export Filtered Data';
    header.appendChild(h3);
    var closeBtn = document.createElement('button');
    closeBtn.className = 'fed-close-btn';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close export dialog');
    closeBtn.addEventListener('click', function () { self.close(); });
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Summary
    var summary = document.createElement('div');
    summary.className = 'fed-summary';
    summary.textContent = data.length.toLocaleString() + ' record' + (data.length !== 1 ? 's' : '') + ' to export';
    if (filters.length > 0) {
      summary.textContent += ' · ' + filters.length + ' filter' + (filters.length !== 1 ? 's' : '') + ' applied';
    }
    modal.appendChild(summary);

    // Metadata section
    if (this._options.includeMetadata !== false && (meta.source || meta.asOf)) {
      var metaSec = document.createElement('div');
      metaSec.className = 'fed-meta';
      if (meta.source) {
        var srcP = document.createElement('p');
        srcP.textContent = 'Source: ' + meta.source;
        metaSec.appendChild(srcP);
      }
      if (meta.asOf) {
        var asOfP = document.createElement('p');
        asOfP.textContent = 'As of: ' + meta.asOf;
        metaSec.appendChild(asOfP);
      }
      modal.appendChild(metaSec);
    }

    // Action buttons
    var actions = document.createElement('div');
    actions.className = 'fed-actions';

    var csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'fed-export-btn fed-export-btn--csv';
    csvBtn.textContent = 'Download CSV';
    csvBtn.addEventListener('click', function () {
      var csv = FilteredExportDialog.toCSV(data, filters, meta);
      FilteredExportDialog.download(csv, 'export-' + Date.now() + '.csv', 'text/csv');
      self.close();
    });
    actions.appendChild(csvBtn);

    var jsonBtn = document.createElement('button');
    jsonBtn.type = 'button';
    jsonBtn.className = 'fed-export-btn fed-export-btn--json';
    jsonBtn.textContent = 'Download JSON';
    jsonBtn.addEventListener('click', function () {
      var json = FilteredExportDialog.toJSON(data, filters, meta);
      FilteredExportDialog.download(json, 'export-' + Date.now() + '.json', 'application/json');
      self.close();
    });
    actions.appendChild(jsonBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'fed-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () { self.close(); });
    actions.appendChild(cancelBtn);

    modal.appendChild(actions);
    overlay.appendChild(modal);
    this._dialog = overlay;
  };

  /* ── Expose on window ───────────────────────────────────────────── */

  window.FilteredExportDialog = FilteredExportDialog;

}());
