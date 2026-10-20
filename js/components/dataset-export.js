/**
 * dataset-export.js — "Full dataset" downloads: every record in a source's
 * file on this site, as Excel or CSV, with the same Sources and About
 * metadata as the table downloads.
 *
 * table-export.js loads this file on the first full-dataset click; pages do
 * not load it themselves.
 *
 * A source's records are the collection its inventory feature count is taken
 * from (RECORD_PATHS below, which test/table-export.test.js holds equal to
 * scripts/audit/inventory-count-paths.cjs), so a download always has exactly
 * as many rows as the inventory says the source holds. A GeoJSON file's
 * records are its features.
 *
 * Values are written as the file stores them. Nested fields become dotted
 * column names (affordable_rent_monthly.30); a list of records inside a
 * record (a FRED series' observations) becomes its own sheet, joined back by
 * the parent's key. Nothing is rounded, renamed or filled in: a null stays a
 * blank cell, never a zero.
 */
(function (global) {
  'use strict';

  // Source id → dotted path(s) to its records. Must equal the entry in
  // scripts/audit/inventory-count-paths.cjs (test:table-export checks).
  var RECORD_PATHS = {
    'co-ami-gap-county': 'counties',
    'home-value-cascade': ['counties', 'places'],
    'bls-laus': 'counties',
    'fred-data': 'series',
    'hmda-co': 'counties',
    'prop123-jurisdictions': 'jurisdictions',
    'co-construction-labor-cost': 'monthly',
    'chfa-income-rent-limits': 'counties',
    'funding-vs-need': 'counties',
    'market-direction': ['counties', 'places'],
    'realtor-inventory': ['counties', 'zips'],
    'development-activity': 'projects',
    'lihtc-state-allocations': 'states',
    'novogradac-equity-pricing': 'pricing.by_state'
  };

  var MAX_SHEET = 31;

  function valueAt(obj, dotted) {
    return dotted.split('.').reduce(function (v, k) { return v && v[k]; }, obj);
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /**
   * The record collections in a parsed file: [{ name, records: [{ key, value }] }].
   * Returns null when the file's records cannot be located.
   */
  function collections(sourceId, data) {
    var spec = RECORD_PATHS[sourceId];
    if (!spec && data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      return [{ name: 'features', keyLabel: null, records: data.features.map(function (f) { return { key: null, value: featureRecord(f) }; }) }];
    }
    if (!spec && Array.isArray(data)) return [{ name: 'records', keyLabel: null, records: data.map(function (v) { return { key: null, value: v }; }) }];
    if (!spec) return null;
    var paths = Array.isArray(spec) ? spec : [spec];
    var out = [];
    for (var i = 0; i < paths.length; i++) {
      var v = valueAt(data, paths[i]);
      if (Array.isArray(v)) out.push({ name: paths[i], keyLabel: null, records: v.map(function (r) { return { key: null, value: r }; }) });
      else if (isPlainObject(v)) out.push({ name: paths[i], keyLabel: 'key', records: Object.keys(v).map(function (k) { return { key: k, value: v[k] }; }) });
      else return null;
    }
    return out;
  }

  // A GeoJSON feature as one flat record: its properties, then a point's
  // longitude and latitude. Other geometries are left out (a polygon is not
  // a spreadsheet value).
  function featureRecord(f) {
    var rec = {};
    var props = (f && f.properties) || {};
    Object.keys(props).forEach(function (k) { rec[k] = props[k]; });
    var g = f && f.geometry;
    if (g && g.type === 'Point' && Array.isArray(g.coordinates)) {
      rec.longitude = g.coordinates[0];
      rec.latitude = g.coordinates[1];
    }
    return rec;
  }

  function isRecordList(arr) {
    return arr.length > 0 && arr.every(isPlainObject);
  }

  /**
   * Flatten one record into `row` (column → value). Lists of records found
   * inside it are handed to `child(path, items)`.
   */
  function flatten(value, prefix, row, child) {
    if (Array.isArray(value)) {
      if (isRecordList(value)) { child(prefix, value); return; }
      row[prefix] = value.length ? value.map(function (v) { return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }).join('; ') : null;
      return;
    }
    if (isPlainObject(value)) {
      var keys = Object.keys(value);
      if (!keys.length) { if (prefix) row[prefix] = null; return; }
      keys.forEach(function (k) { flatten(value[k], prefix ? prefix + '.' + k : k, row, child); });
      return;
    }
    row[prefix || 'value'] = value === undefined ? null : value;
  }

  function Sheet(name) {
    this.name = name;
    this.columns = [];
    this.seen = {};
    this.rows = [];
  }
  Sheet.prototype.add = function (row) {
    var self = this;
    Object.keys(row).forEach(function (c) { if (!self.seen[c]) { self.seen[c] = true; self.columns.push(c); } });
    this.rows.push(row);
  };
  Sheet.prototype.table = function () {
    var cols = this.columns;
    return [cols.slice()].concat(this.rows.map(function (r) {
      return cols.map(function (c) { return Object.prototype.hasOwnProperty.call(r, c) ? r[c] : null; });
    }));
  };

  /**
   * Flatten a whole file into sheets. Pure; no DOM, no network.
   * Returns { sheets: [Sheet], recordCount } or null.
   */
  function tabulate(sourceId, data) {
    var cols = collections(sourceId, data);
    if (!cols) return null;
    var sheets = [];
    var byName = {};
    var recordCount = 0;
    function sheetFor(name) {
      if (!byName[name]) { byName[name] = new Sheet(name); sheets.push(byName[name]); }
      return byName[name];
    }
    cols.forEach(function (col) {
      var top = sheetFor(col.name);
      col.records.forEach(function (rec, i) {
        recordCount++;
        var row = {};
        var parentKey = col.keyLabel ? rec.key : null;
        if (col.keyLabel) row[col.keyLabel] = rec.key;
        var kids = [];
        flatten(rec.value, '', row, function (path, items) { kids.push([path, items]); });
        top.add(row);
        kids.forEach(function (k) {
          var sheet = sheetFor(col.name + '.' + k[0]);
          var parentLabel = col.name + (col.keyLabel ? ' key' : ' row');
          k[1].forEach(function (item) {
            var r = {};
            r[parentLabel] = parentKey !== null ? parentKey : i + 1;
            flatten(item, '', r, function (p, nested) { r[p] = JSON.stringify(nested); });
            sheet.add(r);
          });
        });
      });
    });
    return { sheets: sheets, recordCount: recordCount };
  }

  function sheetNames(sheets) {
    if (sheets.length === 1) return ['Data'];
    var used = {};
    return sheets.map(function (s) {
      var base = s.name.replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, MAX_SHEET - 3) || 'Data';
      var name = base;
      for (var n = 2; used[name.toLowerCase()] || /^(sources|about)$/i.test(name); n++) name = base + ' ' + n;
      used[name.toLowerCase()] = true;
      return name;
    });
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function aboutRows(source, tab, file, page, exportedAt, names) {
    var rows = [['Field', 'Value']];
    rows.push(['Dataset', source.name]);
    if (source.description) rows.push(['What it holds', source.description]);
    rows.push(['File on this site', file]);
    rows.push(['Records', String(tab.recordCount)]);
    rows.push(['Sheets', names.map(function (n, i) { return n + ' (' + tab.sheets[i].rows.length + ' rows)'; }).join('; ')]);
    rows.push(['How it was flattened', 'Every record in the file, with values exactly as the file stores them. Nested fields are dotted column names (for example affordable_rent_monthly.30). A list of records inside a record is on its own sheet, joined back by the key column.']);
    rows.push(['Blank cells', 'A blank cell means the file holds no value there. It never means zero.']);
    rows.push(['Downloaded from', page]);
    rows.push(['Downloaded', exportedAt]);
    rows.push(['Sources', 'Listed with their maintenance mode and freshness on the Sources sheet (sources.csv in the CSV download).']);
    rows.push(['Suggested citation', 'COHO Analytics, “' + source.name + '” (full dataset), ' + file + ', downloaded ' + exportedAt.slice(0, 10) + '. Original data: ' + (source.provider || source.name) + '.']);
    return rows;
  }

  /**
   * Build a full-dataset download. Resolves to { name, blob, format,
   * recordCount, sheets } without saving.
   *   source  an inventory entry (TableExport resolves the id)
   *   data    optional parsed file, for tests; otherwise fetched
   */
  function build(source, format, data) {
    var TX = global.TableExport && global.TableExport._internal;
    if (!TX) return Promise.reject(new Error('The table download component is not loaded.'));
    if (!source || !source.localFile) return Promise.reject(new Error('This source has no file on this site to download.'));
    var file = TX.fileUrl(source.localFile);
    var got = data !== undefined ? Promise.resolve(data) : fetch(file).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + source.localFile + ' (' + r.status + ').');
      return r.json();
    });
    return got.then(function (json) {
      var tab = tabulate(source.id, json);
      if (!tab || !tab.recordCount) throw new Error('This dataset cannot be laid out as a table.');
      var exportedAt = new Date().toISOString();
      var page = String(global.location && global.location.href || '').split('#')[0];
      var names = sheetNames(tab.sheets);
      var sources = TX.sourcesTable({ sources: [source] });
      var about = aboutRows(source, tab, file, page, exportedAt, names);
      var base = 'coho-dataset-' + slug(source.id) + '-' + exportedAt.slice(0, 10);
      function csvZip() {
        var files = tab.sheets.map(function (s, i) {
          return { name: base + (tab.sheets.length > 1 ? '-' + slug(names[i]) : '') + '.csv', content: TX.toCsv(s.table()) };
        });
        files.push({ name: base + '-sources.csv', content: TX.toCsv(sources) });
        files.push({ name: 'README.txt', content: about.slice(1).map(function (r) { return r[0] + ': ' + r[1]; }).join('\r\n') + '\r\n' });
        return { name: base + '.zip', blob: TX.zip(files), format: 'csv', recordCount: tab.recordCount, sheets: names };
      }
      if (format !== 'xlsx') return csvZip();
      return TX.ensureExcel().then(function () {
        var wb = new global.ExcelJS.Workbook();
        wb.creator = 'COHO Analytics';
        wb.created = new Date(exportedAt);
        wb.title = source.name;
        tab.sheets.forEach(function (s, i) { TX.addSheet(wb, names[i], s.table(), { maxWidth: 40 }); });
        TX.addSheet(wb, 'Sources', sources, { maxWidth: 60, wrap: true });
        TX.addSheet(wb, 'About', about, { maxWidth: 100, wrap: true });
        return wb.xlsx.writeBuffer().then(function (buf) {
          return {
            name: base + '.xlsx',
            blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
            format: 'xlsx', recordCount: tab.recordCount, sheets: names
          };
        });
      }, function () {
        var out = csvZip();
        out.fellBack = true;
        return out;
      });
    });
  }

  global.DatasetExport = {
    RECORD_PATHS: RECORD_PATHS,
    tabulate: tabulate,
    build: build
  };
})(window);
