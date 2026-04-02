/**
 * export-panel.js — COHO Analytics
 * Reusable per-stage export panel component.
 *
 * Injects a panel of export buttons appropriate for the given workflow stage
 * and wires each button to the matching export function.
 *
 * Usage:
 *   ExportPanel.render('myContainerId', 'hsa', { projectName: 'Boulder Analysis', countyName: 'Boulder' });
 *   ExportPanel.exportCsv(data, 'my-data.csv');
 *
 * Requires: workflow-state.js (optional, used by exportFull)
 */
(function (global) {
  'use strict';

  /* ── CSS injection (once) ────────────────────────────────────────────────── */

  function ensureStyles() {
    if (document.getElementById('export-panel-styles')) { return; }
    var s = document.createElement('style');
    s.id = 'export-panel-styles';
    s.textContent = [
      '.ep-panel{',
        'background:var(--card);',
        'border:1px solid var(--border);',
        'border-radius:10px;',
        'padding:20px 24px;',
      '}',
      '.ep-panel h4{',
        'margin:0 0 12px;',
        'font-size:.9rem;',
        'color:var(--muted);',
        'text-transform:uppercase;',
        'letter-spacing:.05em;',
      '}',
      '.ep-btn-group{',
        'display:flex;',
        'gap:8px;',
        'flex-wrap:wrap;',
      '}',
      '.ep-btn{',
        'padding:9px 16px;',
        'border:1px solid var(--border);',
        'border-radius:6px;',
        'background:var(--bg2);',
        'cursor:pointer;',
        'font-size:.85rem;',
        'font-weight:600;',
        'color:var(--text);',
        'display:inline-flex;',
        'align-items:center;',
        'gap:6px;',
      '}',
      '.ep-btn:hover{',
        'border-color:var(--accent);',
        'color:var(--accent);',
      '}',
      '.ep-btn--primary{',
        'background:var(--accent);',
        'color:#fff;',
        'border-color:var(--accent);',
      '}',
      '.ep-btn--primary:hover{',
        'opacity:.9;',
      '}',
      '.ep-status{',
        'font-size:.8rem;',
        'color:var(--muted);',
        'margin-top:8px;',
      '}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── Date stamp helper ───────────────────────────────────────────────────── */

  function _dateStamp() {
    var d  = new Date();
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    return d.getFullYear() + '-' +
      (mm < 10 ? '0' + mm : String(mm)) + '-' +
      (dd < 10 ? '0' + dd : String(dd));
  }

  /* ── Slug helper for filenames ───────────────────────────────────────────── */

  function _slug(str) {
    return (str || 'unknown')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  /* ── Trigger a file download from a Blob ─────────────────────────────────── */

  function _triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) { a.parentNode.removeChild(a); }
    }, 1500);
  }

  /* ── Show a brief status message inside the panel ────────────────────────── */

  function _setStatus(statusEl, msg) {
    if (!statusEl) { return; }
    statusEl.textContent = msg;
    setTimeout(function () {
      if (statusEl.textContent === msg) { statusEl.textContent = ''; }
    }, 4000);
  }

  /* ── CSV helpers ─────────────────────────────────────────────────────────── */

  function _csvField(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /**
   * Convert a plain object or array of objects to a CSV string.
   * Plain object  → two-column rows: key, value
   * Array         → header row derived from first object keys, then data rows
   *
   * @param {Object|Array} data
   * @returns {string}
   */
  function _toCsv(data) {
    var rows = [];
    var i, key, keys;

    if (Array.isArray(data)) {
      if (data.length === 0) { return ''; }
      keys = Object.keys(data[0]);
      rows.push(keys.map(_csvField).join(','));
      for (i = 0; i < data.length; i++) {
        var row = [];
        var j;
        for (j = 0; j < keys.length; j++) {
          row.push(_csvField(data[i][keys[j]]));
        }
        rows.push(row.join(','));
      }
    } else {
      rows.push([_csvField('key'), _csvField('value')].join(','));
      for (key in data) {
        if (data.hasOwnProperty(key)) {
          rows.push([_csvField(key), _csvField(data[key])].join(','));
        }
      }
    }
    return rows.join('\r\n');
  }

  /* ── Button definitions per stage ───────────────────────────────────────── */

  var STAGE_BUTTONS = {
    hsa: [
      { label: 'Download HNA Summary (PDF)', icon: '\uD83D\uDCC4', primary: true,  action: 'pdf'  },
      { label: 'Export Data (CSV)',           icon: '\uD83D\uDCCA', primary: false, action: 'csv'  },
      { label: 'Export Snapshot (JSON)',      icon: '\uD83D\uDCBE', primary: false, action: 'json' }
    ],
    market: [
      { label: 'Download PMA Report (PDF)', icon: '\uD83D\uDCC4', primary: true,  action: 'pdf' },
      { label: 'Export Score Data (CSV)',   icon: '\uD83D\uDCCA', primary: false, action: 'csv' }
    ],
    scenario: [
      { label: 'Download Scenario Report (PDF)', icon: '\uD83D\uDCC4', primary: true,  action: 'pdf'  },
      { label: 'Export Scenario Data (CSV)',      icon: '\uD83D\uDCCA', primary: false, action: 'csv'  },
      { label: 'Export Scenario (JSON)',           icon: '\uD83D\uDCBE', primary: false, action: 'json' }
    ],
    deal: [
      { label: 'Download Pro Forma (PDF)',   icon: '\uD83D\uDCC4', primary: true,  action: 'pdf'  },
      { label: 'Export Deal Model (JSON)',   icon: '\uD83D\uDCBE', primary: false, action: 'json' }
    ],
    full: [
      { label: 'Export Full Project (JSON)', icon: '\uD83D\uDCBE', primary: true,  action: 'full' }
    ]
  };

  /* ── Wire a button click to the appropriate export function ─────────────── */

  function _wireButton(btn, action, stage, options, statusEl) {
    btn.addEventListener('click', function () {
      try {
        switch (action) {
          case 'pdf':
            ExportPanel['export' + stage.charAt(0).toUpperCase() + stage.slice(1)](options);
            break;
          case 'csv':
            var csvData = (options && options.extraData) ? options.extraData : {};
            var countySlug = _slug(options && options.countyName);
            ExportPanel.exportCsv(csvData, 'coho-' + stage + '-' + countySlug + '-' + _dateStamp() + '.csv');
            break;
          case 'json':
            var jsonData = (options && options.extraData) ? options.extraData : {};
            ExportPanel._exportJson(jsonData, stage, options);
            break;
          case 'full':
            ExportPanel.exportFull(options);
            break;
          default:
            console.warn('[ExportPanel] Unknown action: ' + action);
            return;
        }
        _setStatus(statusEl, 'Export started \u2713');
      } catch (e) {
        console.warn('[ExportPanel] Export action "' + action + '" failed:', e);
        _setStatus(statusEl, 'Export failed — see console for details.');
      }
    });
  }

  /* ── Internal JSON export helper ─────────────────────────────────────────── */

  function _exportJson(data, stage, options) {
    var countySlug = _slug(options && options.countyName);
    var filename   = 'coho-' + stage + '-' + countySlug + '-' + _dateStamp() + '.json';
    var blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: 'application/json' }
    );
    _triggerDownload(blob, filename);
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * Public API — window.ExportPanel
   * ══════════════════════════════════════════════════════════════════════════ */

  var ExportPanel = {

    /**
     * Render the export panel into a DOM container.
     *
     * @param {string} containerId  ID of the element to inject into.
     * @param {string} stage        'hsa' | 'market' | 'scenario' | 'deal' | 'full'
     * @param {Object} [options]
     * @param {string} [options.projectName]  Used in panel heading.
     * @param {string} [options.countyName]   Used in filenames.
     * @param {*}      [options.extraData]    Data passed to CSV / JSON exports.
     */
    render: function (containerId, stage, options) {
      ensureStyles();

      var container = document.getElementById(containerId);
      if (!container) {
        console.warn('[ExportPanel] Container not found: #' + containerId);
        return;
      }

      var buttons = STAGE_BUTTONS[stage];
      if (!buttons) {
        console.warn('[ExportPanel] Unknown stage: ' + stage);
        return;
      }

      var opts = options || {};

      // Build panel HTML
      var heading   = opts.projectName ? 'Export — ' + opts.projectName : 'Export';
      var statusId  = 'ep-status-' + containerId;
      var btnGroupId = 'ep-btngroup-' + containerId;

      var btnHtml = '';
      var i;
      for (i = 0; i < buttons.length; i++) {
        var b      = buttons[i];
        var cls    = 'ep-btn' + (b.primary ? ' ep-btn--primary' : '');
        var dataAct = ' data-ep-action="' + b.action + '"';
        btnHtml += '<button type="button" class="' + cls + '"' + dataAct + '>' +
                     '<span aria-hidden="true">' + b.icon + '</span>' +
                     b.label +
                   '</button>';
      }

      container.innerHTML =
        '<div class="ep-panel">' +
          '<h4>' + heading + '</h4>' +
          '<div class="ep-btn-group" id="' + btnGroupId + '">' +
            btnHtml +
          '</div>' +
          '<div class="ep-status" id="' + statusId + '" aria-live="polite"></div>' +
        '</div>';

      // Wire buttons
      var statusEl  = document.getElementById(statusId);
      var btnGroup  = document.getElementById(btnGroupId);
      var btnEls    = btnGroup ? btnGroup.querySelectorAll('.ep-btn') : [];

      for (i = 0; i < btnEls.length; i++) {
        var action = btnEls[i].getAttribute('data-ep-action');
        _wireButton(btnEls[i], action, stage, opts, statusEl);
      }
    },

    /* ── Stage-specific PDF exports ─────────────────────────────────────── */

    /**
     * Export HNA summary as PDF (html2canvas + jsPDF, falls back to print).
     * @param {Object} [options]
     */
    exportHsa: function (options) {
      ExportPanel._exportPdf('coho-hna-summary-' + _dateStamp() + '.pdf', options);
    },

    /**
     * Export PMA/market report as PDF.
     * @param {Object} [options]
     */
    exportMarket: function (options) {
      ExportPanel._exportPdf('coho-pma-report-' + _dateStamp() + '.pdf', options);
    },

    /**
     * Export scenario report as PDF.
     * @param {Object} [options]
     */
    exportScenario: function (options) {
      ExportPanel._exportPdf('coho-scenario-report-' + _dateStamp() + '.pdf', options);
    },

    /**
     * Export deal pro forma as PDF.
     * @param {Object} [options]
     */
    exportDeal: function (options) {
      ExportPanel._exportPdf('coho-pro-forma-' + _dateStamp() + '.pdf', options);
    },

    /**
     * Export full project JSON from WorkflowState.exportProjectJSON().
     * @param {Object} [options]
     */
    exportFull: function (options) {
      if (global.WorkflowState && typeof global.WorkflowState.exportProjectJSON === 'function') {
        global.WorkflowState.exportProjectJSON();
      } else {
        // Fallback: export whatever extraData was supplied
        var data     = (options && options.extraData) ? options.extraData : {};
        var filename = 'coho-full-project-' + _dateStamp() + '.json';
        var blob = new Blob(
          [JSON.stringify(data, null, 2)],
          { type: 'application/json' }
        );
        _triggerDownload(blob, filename);
        console.warn('[ExportPanel] WorkflowState not available; exported extraData instead.');
      }
    },

    /**
     * Export an arbitrary data object as CSV.
     *
     * @param {Object|Array} data      Data to serialize (plain object or array of objects).
     * @param {string}       filename  Output filename.
     */
    exportCsv: function (data, filename) {
      var csv  = _toCsv(data);
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      _triggerDownload(blob, filename || 'coho-export-' + _dateStamp() + '.csv');
    },

    /* ── Internal PDF helper (not intended for direct use) ──────────────── */

    /**
     * PDF export via html2canvas + jsPDF, with window.print() fallback.
     * @param {string} filename
     * @param {Object} [options]  Unused today; reserved for caller-supplied node.
     */
    _exportPdf: function (filename, options) {
      if (!global.html2canvas || !global.jspdf) {
        console.warn('[ExportPanel] html2canvas/jsPDF not loaded; falling back to print().');
        global.print();
        return;
      }

      var jsPDF = global.jspdf.jsPDF;
      var node  = document.querySelector('main') || document.body;
      var bg    = '';
      try {
        bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
      } catch (_) {
        bg = '#ffffff';
      }

      global.html2canvas(node, { scale: 2, useCORS: true, backgroundColor: bg })
        .then(function (canvas) {
          var imgData = canvas.toDataURL('image/png');
          var pdf     = new jsPDF({ orientation: 'p', unit: 'pt', format: 'letter' });
          var pageW   = pdf.internal.pageSize.getWidth();
          var pageH   = pdf.internal.pageSize.getHeight();
          var imgW    = pageW;
          var imgH    = canvas.height * (pageW / canvas.width);

          pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);

          var remaining = imgH - pageH;
          var offset    = 0;
          while (remaining > 0) {
            pdf.addPage();
            offset    += pageH;
            pdf.addImage(imgData, 'PNG', 0, -offset, imgW, imgH);
            remaining -= pageH;
          }

          pdf.save(filename);
        })
        ['catch'](function (e) {
          console.warn('[ExportPanel] PDF export failed; falling back to print()', e);
          global.print();
        });
    },

    /**
     * Internal JSON export (exposed for _wireButton; prefer exportFull for
     * whole-project exports).
     * @private
     */
    _exportJson: _exportJson
  };

  /* ── Expose globally ────────────────────────────────────────────────────── */
  global.ExportPanel = ExportPanel;

}(typeof window !== 'undefined' ? window : this));
