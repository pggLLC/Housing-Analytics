/**
 * table-export.js — "Download Excel" and "Download CSV" for any table marked
 * with data-export="<registry id>".
 *
 * Every download carries its own metadata, so a table that leaves the site
 * still says what it is and where it came from:
 *
 *   Data        the rows as the page shows them, numbers as numbers
 *   Indicators  each column's definition, unit and source
 *   Sources     each source's provider, link, maintenance mode and freshness
 *   About       the page, the export time, the selection, how to cite it
 *
 * Excel gets those four sheets. CSV gets a .zip holding the data CSV, an
 * indicators CSV, a sources CSV and a README.txt, so the data file itself
 * stays clean for Excel, R or pandas.
 *
 * Where the metadata comes from — nothing here is typed twice:
 *   - Column definitions are the header's own on-page definition (the "?"
 *     popover from table-header-tips.js: data-tip, title, or the shared
 *     data/table-header-tips.json entry). The download says exactly what the
 *     page says.
 *   - Sources are ids into js/data-source-inventory.js, the same registry the
 *     data sources dashboard reads, so maintenance mode and last-changed date
 *     are the inventory's, not a copy.
 *   - Table title, description, sources and selection controls live in
 *     js/config/table-export-registry.js.
 *
 * An unmeasurable value is never exported as 0. A cell that reads "—" or
 * "Value unavailable…" is written as a blank, and the row's last column
 * records what the page showed and why.
 *
 * Under each table a source line names the table's sources and offers the
 * table's download plus each source's full dataset (every record in its file
 * on this site, written by js/components/dataset-export.js, loaded on the
 * first click).
 *
 * Usage:
 *   <table data-export="dd-funding-vs-need">…</table>
 *   TableExport.decorateAll();          // runs on load and on DOM changes
 *   TableExport.collect(tableEl);       // the model both formats are built from
 */
(function (global) {
  'use strict';

  var EXCELJS_SRC = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  var NOTES_HEADER = 'Notes from the page (unavailable values and caveats)';
  // A lone dash is an absence; "-11,234" is a number, so dashes match whole.
  var UNAVAILABLE_RE = /^(?:[—–-]|n\/a)$|^(?:value unavailable|unavailable|not available|not published|no data)\b/i;
  var NUMBER_RE = /^([+\-−]?)(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|×|x|bp|\/mo|\/hr|\/yr|M|K|B)?$/;
  var SCALE = { M: 1e6, K: 1e3, B: 1e9 };

  var UNIT_LABELS = {
    dollars: 'US dollars',
    percent: 'Percent (12.5 means 12.5%)',
    ratio: 'Ratio (×)',
    bp: 'Basis points (1 bp = 0.01 percentage point)',
    dollarsPerMonth: 'US dollars per month',
    dollarsPerHour: 'US dollars per hour',
    dollarsPerYear: 'US dollars per year',
    number: 'Number'
  };

  // Resolve site-relative paths from this script's own location, so a page
  // in a subdirectory still finds js/data-source-inventory.js.
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (s && /js\/components\/table-export\.js/.test(s)) return s.replace(/js\/components\/table-export\.js.*$/, '');
    return '';
  })();

  /* ── Reading the table ─────────────────────────────────────────────── */

  // Text a reader sees: drops the "?" header controls, glossary popovers and
  // anything aria-hidden, which all live inside the cell's DOM.
  // A cell's caveat (an element marked data-export-note) is not part of
  // its value; it moves to the row's notes column instead.
  function visibleText(cell, keepNotes) {
    var clone = cell.cloneNode(true);
    // Sort buttons stay: their text is the header's label.
    var drop = clone.querySelectorAll('[aria-hidden="true"], .th-sort, .th-tip__pop, .gl-tooltip-popup, .tx-bar, script, style' + (keepNotes ? '' : ', [data-export-note]'));
    for (var i = 0; i < drop.length; i++) drop[i].parentNode.removeChild(drop[i]);
    // A cell whose display text is a control ("Map ↗") names the value a file
    // should carry instead (the address it opens) in data-export-text.
    var subs = clone.querySelectorAll('[data-export-text]');
    for (var k = 0; k < subs.length; k++) subs[k].parentNode.replaceChild(document.createTextNode(subs[k].getAttribute('data-export-text')), subs[k]);
    var brs = clone.querySelectorAll('br');
    for (var j = 0; j < brs.length; j++) brs[j].parentNode.replaceChild(document.createTextNode(' '), brs[j]);
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function headerLabel(th) {
    // Sort arrows and trailing footnote marks (†, *) are page furniture.
    return visibleText(th).replace(/\s*[▲▼↑↓⇅↕]+/g, '').replace(/\s*[†‡§*]+$/, '').trim();
  }

  // The definition the page itself shows for this header.
  function headerDefinition(th) {
    var own = th.getAttribute('data-tip') || th.getAttribute('title');
    if (own) return own.trim();
    var pop = th.querySelector('.th-tip__pop');
    if (pop && pop.textContent.trim()) return pop.textContent.trim();
    return null;
  }

  function headerCells(table) {
    var head = table.tHead;
    if (head && head.rows.length) return Array.prototype.slice.call(head.rows[head.rows.length - 1].cells);
    return [];
  }

  // A paginated table shows one page but downloads every row its filters
  // match: the page sets table.txRowsHtml to a function returning the <tr>
  // markup for all of them, built by the same code that draws the page.
  function bodySections(table) {
    if (typeof table.txRowsHtml !== 'function') return table.tBodies;
    var t = document.createElement('table');
    var tb = document.createElement('tbody');
    tb.innerHTML = table.txRowsHtml();
    t.appendChild(tb);
    return t.tBodies;
  }

  function bodyRows(table, columnCount) {
    var out = [];
    var bodies = bodySections(table);
    for (var b = 0; b < bodies.length; b++) {
      var rows = bodies[b].rows;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        if (row.hidden) continue;
        if (global.getComputedStyle && global.getComputedStyle(row).display === 'none') continue;
        // A lone cell in a wider table is a placeholder ("Loading…",
        // "Select a county…"), not data.
        if (row.cells.length === 1 && (row.cells[0].colSpan > 1 || columnCount > 1)) continue;
        out.push(Array.prototype.slice.call(row.cells).map(function (cell) {
          var notes = Array.prototype.slice.call(cell.querySelectorAll('[data-export-note]')).map(function (n) { return visibleText(n, true); }).filter(Boolean);
          return { text: visibleText(cell), notes: notes };
        }));
      }
    }
    return out;
  }

  /**
   * Parse one displayed value. Returns
   *   { kind: 'empty' }                         blank cell
   *   { kind: 'unavailable', text }             "—", "Value unavailable (…)"
   *   { kind: 'number', value, unit }           "$1,234", "12.5%", "+109 bp"
   *   { kind: 'text', text }                    anything else, kept verbatim
   */
  function parseValue(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return { kind: 'empty' };
    if (UNAVAILABLE_RE.test(t)) return { kind: 'unavailable', text: t };
    var m = NUMBER_RE.exec(t);
    if (!m) return { kind: 'text', text: t };
    var digits = m[3].replace(/,/g, '');
    // "08001" is an identifier, not eight thousand and one.
    if (digits.length > 1 && digits.charAt(0) === '0' && !m[4] && m[3].indexOf(',') === -1) return { kind: 'text', text: t };
    var value = parseFloat(digits + (m[4] || ''));
    if (m[1] === '-' || m[1] === '−') value = -value;
    var suffix = m[5] || '';
    var unit;
    if (SCALE[suffix]) {
      value = value * SCALE[suffix];
      unit = m[2] ? 'dollars' : 'number';
    } else if (suffix === '%') unit = 'percent';
    else if (suffix === '×' || suffix === 'x') unit = 'ratio';
    else if (suffix === 'bp') unit = 'bp';
    else if (suffix === '/mo') unit = 'dollarsPerMonth';
    else if (suffix === '/hr') unit = 'dollarsPerHour';
    else if (suffix === '/yr') unit = 'dollarsPerYear';
    else unit = m[2] ? 'dollars' : 'number';
    // Keep float noise from scaling out of the export.
    value = Math.round(value * 1e6) / 1e6;
    return { kind: 'number', value: value, unit: unit };
  }

  function registryEntry(id) {
    var reg = global.TableExportRegistry;
    return reg && reg.tables && Object.prototype.hasOwnProperty.call(reg.tables, id) ? reg.tables[id] : null;
  }

  function inventorySources(ids) {
    var inv = global.DataSourceInventory;
    var all = inv && typeof inv.getSources === 'function' ? inv.getSources() : [];
    return (ids || []).map(function (id) {
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return { id: id, name: id, missing: true };
    });
  }

  // The sources a download cites. An entry whose rows come from a different
  // dataset depending on a control (the allocations year picker reads one
  // file for 2026 and another for 2010–2023) names them in
  // sourcesBySelection: { control, values: { value: [ids] }, otherwise: [ids] }.
  function entrySources(entry) {
    var by = entry && entry.sourcesBySelection;
    if (by && by.control) {
      var el = document.querySelector(by.control);
      if (el) return (by.values && by.values[el.value]) || by.otherwise || entry.sources;
    }
    return entry && entry.sources;
  }

  function maintenanceText(s) {
    var inv = global.DataSourceInventory;
    var mode = s.maintenance || 'automated';
    var modes = (inv && inv.MAINTENANCE_MODES) || {};
    var label = mode.charAt(0).toUpperCase() + mode.slice(1);
    var note = s.maintenanceNote || modes[mode] || '';
    return note ? label + ': ' + note : label;
  }

  function selectionText(entry) {
    var out = [];
    var sel = (entry && entry.selection) || {};
    Object.keys(sel).forEach(function (label) {
      var el = document.querySelector(sel[label]);
      if (!el) return;
      var v = '';
      if (el.type === 'checkbox') v = el.checked ? 'Yes' : 'No';
      else if (el.tagName === 'SELECT') v = el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : '';
      else if ('value' in el && el.tagName !== 'BUTTON') v = el.value;
      else v = visibleText(el);
      v = String(v || '').replace(/\s+/g, ' ').trim();
      if (v) out.push([label, v]);
    });
    return out;
  }

  /**
   * The model both formats are written from. Pure DOM read, no network.
   */
  function collect(table) {
    var id = table.getAttribute('data-export');
    var entry = registryEntry(id);
    var ths = headerCells(table);
    var labels = ths.map(headerLabel);
    var raw = bodyRows(table, labels.length);
    var width = Math.max(labels.length, raw.reduce(function (w, r) { return Math.max(w, r.length); }, 0));
    for (var c = labels.length; c < width; c++) labels.push('Column ' + (c + 1));

    var parsed = raw.map(function (r) {
      var cells = [];
      for (var i = 0; i < width; i++) cells.push(parseValue(r[i] ? r[i].text : ''));
      return cells;
    });

    // A column is numeric only if every value it shows is a number or a
    // marked absence; one stray word keeps the whole column as text, so a
    // column is never half-converted.
    var columns = labels.map(function (label, i) {
      var units = {};
      var numeric = 0;
      var text = 0;
      parsed.forEach(function (row) {
        var v = row[i];
        if (v.kind === 'number') { numeric++; units[v.unit] = (units[v.unit] || 0) + 1; }
        else if (v.kind === 'text') text++;
      });
      var unitKeys = Object.keys(units);
      var isNumeric = numeric > 0 && text === 0;
      var unit = !isNumeric ? 'Text' : unitKeys.length === 1 ? UNIT_LABELS[unitKeys[0]] : 'Mixed: ' + unitKeys.map(function (k) { return UNIT_LABELS[k]; }).join('; ');
      return {
        label: label,
        definition: ths[i] ? headerDefinition(ths[i]) : null,
        numeric: isNumeric,
        unitKey: isNumeric && unitKeys.length === 1 ? unitKeys[0] : null,
        integers: parsed.every(function (row) { return row[i].kind !== 'number' || Math.round(row[i].value) === row[i].value; }),
        unit: unit
      };
    });

    var anyUnavailable = false;
    var rows = parsed.map(function (row, ri) {
      var notes = [];
      var values = row.map(function (v, i) {
        var cellNotes = raw[ri][i] ? raw[ri][i].notes : [];
        cellNotes.forEach(function (n) { notes.push(labels[i] + ': ' + n); });
        if (v.kind === 'unavailable') { notes.push(labels[i] + ': ' + v.text); return null; }
        if (v.kind === 'empty') return null;
        if (columns[i].numeric) return v.kind === 'number' ? v.value : null;
        return v.kind === 'number' ? raw[ri][i].text : v.text;
      });
      if (notes.length) anyUnavailable = true;
      return { values: values, notes: notes.join('; ') };
    });

    return {
      id: id,
      entry: entry,
      title: (entry && entry.title) || (table.caption && visibleText(table.caption)) || id,
      columns: columns,
      rows: rows,
      hasNotes: anyUnavailable,
      sources: inventorySources(entrySources(entry)),
      selection: selectionText(entry),
      page: String(global.location && global.location.href || '').split('#')[0],
      exportedAt: new Date().toISOString()
    };
  }

  /* ── Metadata tables (shared by both formats) ──────────────────────── */

  function dataTable(model) {
    var head = model.columns.map(function (c) { return c.label; });
    if (model.hasNotes) head.push(NOTES_HEADER);
    var body = model.rows.map(function (r) {
      var v = r.values.slice();
      if (model.hasNotes) v.push(r.notes || null);
      return v;
    });
    return [head].concat(body);
  }

  function indicatorsTable(model) {
    var srcNames = model.sources.map(function (s) { return s.name; }).join('; ');
    var rows = [['Column', 'Definition (as shown on the page)', 'Unit', 'Source']];
    model.columns.forEach(function (c) {
      rows.push([c.label, c.definition || 'No definition published on the page', c.unit, srcNames]);
    });
    if (model.hasNotes) rows.push([NOTES_HEADER, 'Caveats the page prints beside a value, and what it showed for a value that is unavailable and why. An unavailable value\u2019s cell is blank, never zero.', 'Text', 'COHO Analytics']);
    return rows;
  }

  // The copy this site serves, as a full link a reader of the file can open.
  function fileUrl(localFile) {
    if (!localFile) return '';
    try { return new URL(localFile, BASE || global.location.href).href; } catch (e) { return localFile; }
  }

  function sourcesTable(model) {
    var rows = [['Source', 'Provider', 'Link', 'File on this site', 'How it is maintained', 'Update frequency', 'Last changed on this site', 'Freshness status', 'Description']];
    model.sources.forEach(function (s) {
      if (s.missing) { rows.push([s.id, 'Not found in the source inventory', '', '', '', '', '', '', '']); return; }
      rows.push([
        s.name, s.provider || '', s.url || '', fileUrl(s.localFile), maintenanceText(s),
        s.updateFrequency || '', s.lastUpdated || '', s.status || '', s.description || ''
      ]);
    });
    return rows;
  }

  function aboutTable(model) {
    var e = model.entry || {};
    var day = model.exportedAt.slice(0, 10);
    var rows = [['Field', 'Value']];
    rows.push([model.report ? 'Report' : 'Table', model.title]);
    if (e.description) rows.push(['What the rows show', e.description]);
    rows.push(['Page', model.page]);
    rows.push(['Downloaded', model.exportedAt]);
    model.selection.forEach(function (s) { rows.push(['Selection: ' + s[0], s[1]]); });
    if (model.report) {
      rows.push(['Blank values', 'A blank value, or one marked unavailable, means the figure could not be measured for this selection. It never means zero.']);
    } else {
      rows.push(['Rows', String(model.rows.length)]);
      rows.push(['Blank cells', 'A blank cell means the value is unavailable. It never means zero.' + (model.hasNotes ? ' The last column of the data says what the page showed and why, along with any caveat printed beside a value.' : '')]);
      rows.push(['Rounding', 'Values are taken from the table as displayed, so they carry the page’s rounding (for example $24.2M is exported as 24200000).']);
    }
    if (e.notes) rows.push(['Notes', e.notes]);
    rows.push(['Sources', model.report ? 'Listed with their maintenance mode and freshness under Sources in this file.' : 'Listed with their maintenance mode and freshness on the Sources sheet (sources.csv in the CSV download).']);
    rows.push(['Suggested citation', 'COHO Analytics, “' + model.title + '”, ' + model.page + ', downloaded ' + day + '. Original data: ' + model.sources.map(function (s) { return s.provider || s.name; }).join('; ') + '.']);
    return rows;
  }

  /* ── CSV + zip ─────────────────────────────────────────────────────── */

  function csvField(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    // BOM so Excel opens UTF-8 (≤, —, ×) correctly.
    return '﻿' + rows.map(function (r) { return r.map(csvField).join(','); }).join('\r\n') + '\r\n';
  }

  function readme(model) {
    var lines = [model.title, new Array(Math.min(model.title.length, 72) + 1).join('='), ''];
    aboutTable(model).slice(1).forEach(function (r) { lines.push(r[0] + ': ' + r[1]); });
    lines.push('', 'Files', '-----',
      fileBase(model) + '.csv             the data',
      fileBase(model) + '-indicators.csv  what each column means, its unit and source',
      fileBase(model) + '-sources.csv     where the data comes from and how it is maintained', '');
    lines.push('Columns', '-------');
    model.columns.forEach(function (c) { lines.push('- ' + c.label + ' (' + c.unit + '): ' + (c.definition || 'No definition published on the page')); });
    return lines.join('\r\n') + '\r\n';
  }

  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * A stored (uncompressed) zip. Small tables, no dependency to load, and
   * every unzip tool reads it.
   */
  function zip(files) {
    var enc = new TextEncoder();
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var chunks = [];
    var central = [];
    var offset = 0;
    function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
    function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = enc.encode(f.content);
      var crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), common));
      chunks.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
  }

  function fileBase(model) {
    return 'coho-' + model.id + '-' + model.exportedAt.slice(0, 10);
  }

  function csvBundle(model) {
    var base = fileBase(model);
    return {
      name: base + '.zip',
      blob: zip([
        { name: base + '.csv', content: toCsv(dataTable(model)) },
        { name: base + '-indicators.csv', content: toCsv(indicatorsTable(model)) },
        { name: base + '-sources.csv', content: toCsv(sourcesTable(model)) },
        { name: 'README.txt', content: readme(model) }
      ])
    };
  }

  /* ── Excel ─────────────────────────────────────────────────────────── */

  // Plain numbers keep Excel's General format, so a year stays 2026.
  var NUM_FMT = {
    dollars: ['"$"#,##0', '"$"#,##0.00'],
    dollarsPerMonth: ['"$"#,##0', '"$"#,##0.00'],
    dollarsPerHour: ['"$"#,##0', '"$"#,##0.00'],
    dollarsPerYear: ['"$"#,##0', '"$"#,##0.00'],
    percent: ['0"%"', '0.0#"%"'],
    ratio: ['0"×"', '0.00"×"'],
    bp: ['0" bp"', '0.0" bp"']
  };

  function addSheet(wb, name, rows, opts) {
    var ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    rows.forEach(function (r) { ws.addRow(r); });
    ws.getRow(1).font = { bold: true };
    var widths = [];
    rows.forEach(function (r) {
      r.forEach(function (v, i) {
        var len = v === null || v === undefined ? 0 : String(v).length;
        var prev = widths[i] === undefined ? 8 : widths[i];
        widths[i] = Math.max(prev, Math.min(len + 2, (opts && opts.maxWidth) || 60));
      });
    });
    widths.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    if (opts && opts.wrap) ws.eachRow(function (row) { row.alignment = { wrapText: true, vertical: 'top' }; });
    return ws;
  }

  function xlsxBlob(model) {
    var ExcelJS = global.ExcelJS;
    var wb = new ExcelJS.Workbook();
    wb.creator = 'COHO Analytics';
    wb.created = new Date(model.exportedAt);
    wb.title = model.title;
    var ws = addSheet(wb, 'Data', dataTable(model), { maxWidth: 48 });
    model.columns.forEach(function (c, i) {
      if (c.numeric && c.unitKey && NUM_FMT[c.unitKey]) ws.getColumn(i + 1).numFmt = NUM_FMT[c.unitKey][c.integers ? 0 : 1];
    });
    addSheet(wb, 'Indicators', indicatorsTable(model), { maxWidth: 80, wrap: true });
    addSheet(wb, 'Sources', sourcesTable(model), { maxWidth: 60, wrap: true });
    addSheet(wb, 'About', aboutTable(model), { maxWidth: 100, wrap: true });
    return wb.xlsx.writeBuffer().then(function (buf) {
      return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    });
  }

  /* ── Loading what a download needs ─────────────────────────────────── */

  var loading = {};
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { ready() ? resolve() : reject(new Error('loaded but not ready: ' + src)); };
      s.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
    loading[src].catch(function () { delete loading[src]; });
    return loading[src];
  }

  function ensureInventory() {
    return loadScript(BASE + 'js/data-source-inventory.js', function () {
      return !!(global.DataSourceInventory && global.DataSourceInventory.getSources);
    });
  }

  function ensureExcel() {
    return loadScript(EXCELJS_SRC, function () { return !!(global.ExcelJS && global.ExcelJS.Workbook); });
  }

  /**
   * The same Sources and About metadata, for a download that is a report
   * rather than one table (the HNA workbook, the PMA site CSV).
   *   spec = { title, description, sources: [inventory ids], selection:
   *            [[label, value]], notes }
   * Resolves to { model, sources: [[header], ...rows], about: [[header], ...],
   * fieldRows: Field/Value rows for a two-column CSV }.
   */
  function describe(spec) {
    spec = spec || {};
    return ensureInventory().catch(function () { /* missing sources are listed as missing */ }).then(function () {
      var model = {
        report: true,
        entry: { description: spec.description, notes: spec.notes },
        title: spec.title || 'COHO Analytics download',
        rows: [],
        hasNotes: false,
        sources: inventorySources(spec.sources),
        selection: (spec.selection || []).filter(function (p) { return p && p[1] !== null && p[1] !== undefined && String(p[1]).trim() !== ''; })
          .map(function (p) { return [String(p[0]), String(p[1])]; }),
        page: String(global.location && global.location.href || '').split('#')[0],
        exportedAt: new Date().toISOString()
      };
      var src = sourcesTable(model);
      var about = aboutTable(model);
      var fields = [['SECTION', 'Sources']];
      src.slice(1).forEach(function (r) {
        var parts = [];
        for (var i = 1; i < src[0].length; i++) if (r[i]) parts.push(src[0][i] + ': ' + r[i]);
        fields.push([r[0], parts.join('; ')]);
      });
      fields.push(['', ''], ['SECTION', 'About this file']);
      about.slice(1).forEach(function (r) { fields.push(r); });
      return { model: model, sources: src, about: about, fieldRows: fields };
    });
  }

  function save(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /**
   * Build a download. Resolves to { name, blob, format } without saving, so
   * tests can read the file a click would produce.
   */
  function build(table, format) {
    return ensureInventory().catch(function () { /* sources sheet notes the gap */ }).then(function () {
      var model = collect(table);
      if (!model.rows.length) throw new Error('This table has no rows to download yet.');
      if (format !== 'xlsx') {
        var b = csvBundle(model);
        return { name: b.name, blob: b.blob, format: 'csv', model: model };
      }
      return ensureExcel().then(function () {
        return xlsxBlob(model).then(function (blob) {
          return { name: fileBase(model) + '.xlsx', blob: blob, format: 'xlsx', model: model };
        });
      }, function () {
        var b = csvBundle(model);
        return { name: b.name, blob: b.blob, format: 'csv', model: model, fellBack: true };
      });
    });
  }

  /* ── Buttons ───────────────────────────────────────────────────────── */

  function ensureStyles() {
    if (document.getElementById('table-export-styles')) return;
    var s = document.createElement('style');
    s.id = 'table-export-styles';
    s.textContent =
      '.tx-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px;margin:0 0 6px;}' +
      '.tx-btn{font:inherit;font-size:.8125rem;font-weight:600;min-height:44px;min-width:44px;padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text);cursor:pointer;line-height:1.4;}' +
      '.tx-btn:hover,.tx-btn:focus-visible{border-color:var(--accent);color:var(--accent);}' +
      '.tx-btn[disabled]{opacity:.6;cursor:progress;}' +
      '.tx-status{font-size:.8125rem;color:var(--muted);}' +
      '.tx-source{margin:6px 0 12px;font-size:.8125rem;color:var(--muted);}' +
      '.tx-source__names{margin:0 0 4px;}' +
      '.tx-source__downloads{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;}' +
      '.tx-source__group{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}' +
      '.tx-source__label{font-weight:600;color:var(--text);}';
    document.head.appendChild(s);
  }

  function makeButton(label, format, table, status, run, ariaLabel) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tx-btn';
    btn.setAttribute('data-format', format);
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      status.textContent = 'Preparing…';
      (run ? run(format) : build(table, format)).then(function (out) {
        save(out.blob, out.name);
        status.textContent = out.fellBack ? 'Excel could not load, so a CSV zip was downloaded.' : 'Downloaded.';
      }).catch(function (err) {
        status.textContent = (err && err.message) || 'Download failed.';
      }).then(function () {
        btn.disabled = false;
        setTimeout(function () { if (status.textContent === 'Downloaded.') status.textContent = ''; }, 4000);
      });
    });
    return btn;
  }

  function decorate(table) {
    if (table.__txBar && table.__txBar.isConnected) return;
    var id = table.getAttribute('data-export');
    if (!id) return;
    ensureStyles();
    var title = (registryEntry(id) && registryEntry(id).title) || 'this table';
    var bar = document.createElement('div');
    bar.className = 'tx-bar no-print';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Download ' + title);
    var status = document.createElement('span');
    status.className = 'tx-status';
    status.setAttribute('aria-live', 'polite');
    bar.appendChild(status);
    bar.appendChild(makeButton('Download Excel', 'xlsx', table, status));
    bar.appendChild(makeButton('Download CSV', 'csv', table, status));
    // Sit above the scroll wrapper, not inside it, so the buttons stay put
    // when a wide table scrolls sideways.
    var anchor = table;
    var parent = table.parentElement;
    if (parent && parent.children.length === 1 && parent.tagName === 'DIV') anchor = parent;
    anchor.parentNode.insertBefore(bar, anchor);
    table.__txBar = bar;
    sourceLine(table, anchor);
  }

  /* ── Source line under the table ───────────────────────────────────── */

  function ensureDatasets() {
    return loadScript(BASE + 'js/components/dataset-export.js', function () {
      return !!(global.DatasetExport && global.DatasetExport.build);
    });
  }

  function buildDataset(source, format) {
    return ensureDatasets().then(function () { return global.DatasetExport.build(source, format); });
  }

  // Under every exported table: its sources, named from the inventory the
  // download's Sources sheet reads, and buttons for the table and for each
  // source's full dataset. One list feeds both, so the line and the file
  // cannot name different sources.
  function sourceLine(table, anchor) {
    if (table.__txSource && table.__txSource.isConnected) return;
    var entry = registryEntry(table.getAttribute('data-export'));
    if (!entry) return;
    var box = document.createElement('div');
    box.className = 'tx-source no-print';
    box.setAttribute('data-export-source-for', table.getAttribute('data-export'));
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    table.__txSource = box;
    var fill = function () { fillSourceLine(box, table, entry); };
    ensureInventory().catch(function () { /* names fall back to ids */ }).then(fill);
    var by = entry.sourcesBySelection;
    var control = by && by.control && document.querySelector(by.control);
    if (control) control.addEventListener('change', function () { setTimeout(fill, 0); });
  }

  function fillSourceLine(box, table, entry) {
    var title = entry.title || 'this table';
    var sources = inventorySources(entrySources(entry));
    box.textContent = '';
    var p = document.createElement('p');
    p.className = 'tx-source__names';
    p.appendChild(document.createTextNode(sources.length > 1 ? 'Sources: ' : 'Source: '));
    sources.forEach(function (s, i) {
      if (i) p.appendChild(document.createTextNode('; '));
      if (s.url) {
        var a = document.createElement('a');
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = s.name;
        p.appendChild(a);
      } else {
        p.appendChild(document.createTextNode(s.name));
      }
      if (s.provider && s.provider !== s.name) p.appendChild(document.createTextNode(' (' + s.provider + ')'));
    });
    p.appendChild(document.createTextNode('.'));
    box.appendChild(p);

    var status = document.createElement('span');
    status.className = 'tx-status';
    status.setAttribute('aria-live', 'polite');

    var groups = document.createElement('div');
    groups.className = 'tx-source__downloads';
    function group(label, kind, run, name) {
      var g = document.createElement('div');
      g.className = 'tx-source__group';
      g.setAttribute('role', 'group');
      g.setAttribute('data-download', kind);
      g.setAttribute('aria-label', 'Download ' + name);
      var span = document.createElement('span');
      span.className = 'tx-source__label';
      span.textContent = label;
      g.appendChild(span);
      g.appendChild(makeButton('Excel', 'xlsx', table, status, run, 'Download ' + name + ' as Excel'));
      g.appendChild(makeButton('CSV', 'csv', table, status, run, 'Download ' + name + ' as CSV'));
      groups.appendChild(g);
      return g;
    }
    group('This table:', 'table', null, title);
    sources.forEach(function (s) {
      if (s.missing || !s.localFile) return;
      var g = group('Full dataset, ' + s.name + ':', 'dataset', function (format) { return buildDataset(s, format); }, 'full dataset ' + s.name);
      g.setAttribute('data-source-id', s.id);
    });
    groups.appendChild(status);
    box.appendChild(groups);
  }

  function decorateAll(root) {
    var tables = (root || document).querySelectorAll('table[data-export]');
    for (var i = 0; i < tables.length; i++) decorate(tables[i]);
  }

  function observe() {
    if (!global.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; decorateAll(); }, 100);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function init() { decorateAll(); observe(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.TableExport = {
    decorateAll: decorateAll,
    collect: collect,
    build: build,
    describe: describe,
    parseValue: parseValue,
    tables: { data: dataTable, indicators: indicatorsTable, sources: sourcesTable, about: aboutTable },
    // For js/components/dataset-export.js, which writes full datasets with
    // the same CSV, zip, sheet and Sources code.
    _internal: {
      zip: zip, toCsv: toCsv, addSheet: addSheet, sourcesTable: sourcesTable,
      fileUrl: fileUrl, ensureExcel: ensureExcel, inventorySources: inventorySources
    },
    buildDataset: buildDataset,
    _zip: zip,
    _crc32: crc32
  };
})(window);
