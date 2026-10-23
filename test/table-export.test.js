'use strict';
// Table downloads (js/components/table-export.js) must say what the page says.
//
// Pinned agreements, not copy:
//   - every data-export table names a registry entry, and every entry is used
//   - every registry source is a real js/data-source-inventory.js entry, so the
//     Sources sheet is the inventory's record of that source
//   - a column's definition in the download IS the header's on-page definition
//   - a cell the page shows as unavailable is blank in the file, never 0, and
//     the file records what the page showed
//   - both formats carry all four parts (data, indicators, sources, about)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { Blob } = require('node:buffer');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
// Values built inside the jsdom window are from another realm; compare copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

/* ── 1. Registry ↔ pages ↔ inventory ─────────────────────────────────── */

function loadRegistry() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('js/config/table-export-registry.js'), sandbox);
  return sandbox.window.TableExportRegistry;
}
function loadInventory() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(read('js/data-source-inventory.js'), sandbox);
  return sandbox.window.DataSourceInventory.getSources();
}

const registryAll = loadRegistry();
const registry = registryAll.tables;
const reports = registryAll.reports || {};
const inventory = loadInventory();
const inventoryIds = new Set(inventory.map((s) => s.id));
const inventoryById = Object.fromEntries(inventory.map((s) => [s.id, s]));
const ids = Object.keys(registry);
assert.ok(ids.length >= 20, `expected the registry to hold the exported tables, saw ${ids.length}`);

const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const jsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(rel); }
    else if (e.name.endsWith('.js') && rel !== path.join('js', 'config', 'table-export-registry.js')) jsFiles.push(rel);
  }
})('js');
const sources = Object.fromEntries([...htmlFiles, ...jsFiles].map((f) => [f, read(f)]));

// Every literal data-export="…" names an entry.
let literals = 0;
for (const [file, src] of Object.entries(sources)) {
  for (const m of src.matchAll(/data-export="([a-z0-9-]+)"/g)) {
    literals++;
    check(Object.hasOwn(registry, m[1]), `${file}: data-export="${m[1]}" has no entry in js/config/table-export-registry.js`);
  }
}
assert.ok(literals >= 15, `expected to find the data-export attributes, saw ${literals}`);

// Every entry is used by some page or renderer, and every page using one loads
// the registry before the component.
const pagesUsing = new Set();
for (const id of ids) {
  const users = Object.entries(sources).filter(([, src]) => src.includes(`"${id}"`) || src.includes(`'${id}'`)).map(([f]) => f);
  check(users.length > 0, `registry entry ${id} is not used by any page or renderer`);
  const e = registry[id];
  check(typeof e.title === 'string' && e.title.length > 3, `${id}: needs a title`);
  check(typeof e.description === 'string' && e.description.length > 20, `${id}: needs a description of what a row is`);
  check(Array.isArray(e.sources) && e.sources.length > 0, `${id}: needs at least one source`);
  for (const s of e.sources || []) check(inventoryIds.has(s), `${id}: source "${s}" is not in js/data-source-inventory.js`);
  if (e.sourcesBySelection) {
    const by = e.sourcesBySelection;
    const m = /^#([A-Za-z][\w-]*)$/.exec(by.control || '');
    check(m && Object.values(sources).some((src) => src.includes(`id="${m[1]}"`)), `${id}: sourcesBySelection control ${by.control} does not exist on any page`);
    check(Array.isArray(by.otherwise) && by.otherwise.length > 0, `${id}: sourcesBySelection needs an otherwise list`);
    for (const list of [...Object.values(by.values || {}), by.otherwise || []]) {
      for (const s of list) check(inventoryIds.has(s), `${id}: source "${s}" is not in js/data-source-inventory.js`);
    }
  }
  for (const [label, sel] of Object.entries(e.selection || {})) {
    const m = /^#([A-Za-z][\w-]*)$/.exec(sel);
    check(m, `${id}: selection "${label}" must be an #id selector, saw ${sel}`);
    if (m) check(Object.values(sources).some((src) => src.includes(`id="${m[1]}"`)), `${id}: selection control ${sel} does not exist on any page`);
  }
}
for (const id of ids) {
  // The page that renders it: either the attribute is in the page, or a script
  // the page loads renders it.
  for (const page of htmlFiles) {
    const html = sources[page];
    const direct = html.includes(`data-export="${id}"`);
    const viaScript = jsFiles.some((js) => (sources[js].includes(`'${id}'`) || sources[js].includes(`"${id}"`)) && html.includes(`src="${js.split(path.sep).join('/')}"`));
    if (direct || viaScript) pagesUsing.add(page);
  }
}
// Report downloads (the HNA workbook and CSV, the PMA site CSV) carry the
// same Sources and About: each report entry names inventory sources, is used
// by the script that writes the report, and every page loading that script
// loads the component.
const REPORT_WRITERS = { 'hna-report': 'js/hna/hna-export.js', 'pma-site-analysis': 'js/market-analysis.js' };
assert.deepEqual(Object.keys(reports).sort(), Object.keys(REPORT_WRITERS).sort(), 'every report entry has a known writer, and every writer an entry');
for (const [id, writer] of Object.entries(REPORT_WRITERS)) {
  const e = reports[id];
  check(sources[writer].includes(`'${id}'`), `${writer} does not read its report entry ${id}`);
  check(Array.isArray(e.sources) && e.sources.length > 0, `${id}: needs at least one source`);
  for (const sid of e.sources || []) check(inventoryIds.has(sid), `${id}: source "${sid}" is not in js/data-source-inventory.js`);
  for (const page of htmlFiles) if (sources[page].includes(`src="${writer}"`)) pagesUsing.add(page);
}

for (const page of pagesUsing) {
  const html = sources[page];
  const reg = html.indexOf('js/config/table-export-registry.js');
  const comp = html.indexOf('js/components/table-export.js');
  check(reg !== -1 && comp !== -1, `${page}: has downloadable tables but does not load both table-export scripts`);
  check(reg < comp, `${page}: must load the registry before js/components/table-export.js`);
}
assert.ok(pagesUsing.size >= 3, `expected at least three pages with downloadable tables, saw ${pagesUsing.size}`);

/* ── 1b. Full datasets: every record the inventory counts ───────────── */

// The source line under each table offers each source's full dataset. Its
// rows are the collection the inventory's feature count is taken from, so
// the download and the inventory must agree on the number of records, and
// the record paths must be the drift gate's own.
const { JSON_COUNT_PATHS } = require('../scripts/audit/inventory-count-paths.cjs');
function loadDatasetExport() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('js/components/dataset-export.js'), sandbox);
  return sandbox.window.DatasetExport;
}
const DX = loadDatasetExport();
const tableSourceIds = new Set();
for (const e of Object.values(registry)) {
  for (const sid of e.sources || []) tableSourceIds.add(sid);
  const by = e.sourcesBySelection;
  if (by) for (const list of [...Object.values(by.values || {}), by.otherwise || []]) for (const sid of list) tableSourceIds.add(sid);
}
let datasets = 0;
for (const sid of tableSourceIds) {
  const s = inventoryById[sid];
  if (!s || !s.localFile) continue;
  datasets++;
  if (Object.hasOwn(DX.RECORD_PATHS, sid) || Object.hasOwn(JSON_COUNT_PATHS, sid)) {
    check(JSON.stringify(DX.RECORD_PATHS[sid]) === JSON.stringify(JSON_COUNT_PATHS[sid]),
      `${sid}: dataset-export.js RECORD_PATHS (${JSON.stringify(DX.RECORD_PATHS[sid])}) must equal inventory-count-paths.cjs (${JSON.stringify(JSON_COUNT_PATHS[sid])})`);
  }
  const tab = DX.tabulate(sid, JSON.parse(read(s.localFile)));
  check(tab && tab.recordCount > 0, `${sid}: the full-dataset download finds no records in ${s.localFile}`);
  if (tab && typeof s.features === 'number') {
    check(tab.recordCount === s.features, `${sid}: the full-dataset download holds ${tab.recordCount} records but the inventory counts ${s.features}`);
  }
}
for (const sid of Object.keys(DX.RECORD_PATHS)) check(tableSourceIds.has(sid), `dataset-export.js RECORD_PATHS lists ${sid}, which no exported table cites`);
assert.ok(datasets >= 10, `expected the table sources to offer full datasets, saw ${datasets}`);

/* ── 2. The download model, in a DOM ─────────────────────────────────── */

function stubExcel(log) {
  function Worksheet(name) { this.name = name; this.rows = []; this.cols = {}; }
  Worksheet.prototype.addRow = function (r) { this.rows.push(r); };
  Worksheet.prototype.getRow = function () { return {}; };
  Worksheet.prototype.getColumn = function (i) { return (this.cols[i] = this.cols[i] || {}); };
  Worksheet.prototype.eachRow = function (fn) { this.rows.forEach((r) => fn({})); };
  function Workbook() { this.sheets = []; log.push(this); this.xlsx = { writeBuffer: () => Promise.resolve(new Uint8Array([80, 75])) }; }
  Workbook.prototype.addWorksheet = function (name) { const ws = new Worksheet(name); this.sheets.push(ws); return ws; };
  return { Workbook };
}

// Reads a stored (method 0) zip: what the component writes.
function unzip(buf) {
  const files = {};
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const size = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extra = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8');
    const start = off + 30 + nameLen + extra;
    files[name] = buf.slice(start, start + size).toString('utf8');
    off = start + size;
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, 'zip has an end-of-central-directory record');
  return files;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  return rows;
}

async function modelChecks() {
  const dom = new JSDOM(`<!doctype html><body>
    <select id="pick"><option>Alpha County</option></select><input type="checkbox" id="opt" checked>
    <select id="vintage"><option value="new" selected>New</option><option value="old">Old</option></select>
    <div><table data-export="fixture-table">
      <thead><tr>
        <th data-tip="Where the row is.">Place</th>
        <th title="Homes short of need.">Gap</th>
        <th><span class="th-tip__label">Rent</span><span class="th-tip__pop">Monthly rent, from the page tip.</span><button class="th-sort" aria-label="Sort by Rent"><span aria-hidden="true"></span></button></th>
        <th data-tip="FIPS code.">FIPS</th>
        <th data-tip="Share of the state."><button class="sort">Share ▼</button></th>
      </tr></thead>
      <tbody>
        <tr><td>Alpha <abbr>AMI<span class="gl-tooltip-popup" aria-hidden="true">Area Median Income</span></abbr></td><td>-1,204</td><td>$1,123/mo<p data-export-note>Upper estimate.</p></td><td>08001</td><td>12.5%</td></tr>
        <tr><td>Beta</td><td>—</td><td>Value unavailable (not published)</td><td>08003</td><td>0%</td></tr>
        <tr><td colspan="5">Loading…</td></tr>
      </tbody>
    </table></div></body>`, { url: 'https://example.org/page.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  w.Blob = Blob;
  w.TableExportRegistry = { tables: { 'fixture-table': { title: 'Fixture table', description: 'One row per fixture place.', sources: ['fred-data', 'not-a-source'], selection: { County: '#pick', 'Fixture option': '#opt' }, notes: 'Fixture note.' } } };
  const fredName = inventoryById['fred-data'].name;
  w.eval(read('js/data-source-inventory.js'));
  w.eval(read('js/components/table-export.js'));
  const TX = w.TableExport;
  const table = w.document.querySelector('table');

  // Buttons appear above the scroll wrapper, once.
  TX.decorateAll(); TX.decorateAll();
  check(w.document.querySelectorAll('.tx-bar').length === 1, 'decorateAll must add exactly one button bar per table');
  check(table.parentElement.previousElementSibling && table.parentElement.previousElementSibling.classList.contains('tx-bar'), 'button bar sits before the table wrapper');

  // The source line under the table names the same sources the download
  // cites, and offers the table plus each source that has a file here.
  await new Promise((r) => setTimeout(r, 0));
  const line = w.document.querySelectorAll('.tx-source');
  check(line.length === 1, 'decorateAll must add exactly one source line per table');
  check(table.parentElement.nextElementSibling === line[0], 'the source line sits right after the table wrapper');
  const lineText = line[0].querySelector('.tx-source__names').textContent;
  check(lineText.includes(fredName) && lineText.includes('not-a-source'), `the source line names every cited source, saw: ${lineText}`);
  check(/updated \d{4}-\d{2}-\d{2}\)/.test(lineText) && /not-a-source \(date unconfirmed\)/.test(lineText), `each named source carries a date (or says it has none), saw: ${lineText}`);
  const groups = [...line[0].querySelectorAll('[data-download]')].map((g) => g.getAttribute('data-download') + ':' + (g.getAttribute('data-source-id') || ''));
  assert.deepEqual(groups, ['table:', 'dataset:fred-data'], 'the table download, then one full dataset per source with a file here');
  for (const b of line[0].querySelectorAll('button')) check(/^Download .+ as (Excel|CSV)$/.test(b.getAttribute('aria-label') || ''), 'each source-line button names what it downloads');

  // The full dataset: every record, nested lists on their own sheet.
  w.eval(read('js/components/dataset-export.js'));
  const fred = JSON.parse(read('data/fred-data.json'));
  const fredSource = inventoryById['fred-data'];
  const ds = await w.DatasetExport.build(fredSource, 'csv', fred);
  const dsFiles = unzip(Buffer.from(await ds.blob.arrayBuffer()));
  const dsBase = ds.name.replace(/\.zip$/, '');
  assert.ok(dsFiles[dsBase + '-series.csv'] && dsFiles[dsBase + '-series-observations.csv'], `the series and, on their own file, their observations; saw ${Object.keys(dsFiles).join(', ')}`);
  const seriesCsv = parseCsv(dsFiles[dsBase + '-series.csv']);
  assert.equal(seriesCsv.length - 1, Object.keys(fred.series).length, 'one row per series');
  assert.equal(seriesCsv[0][0], 'key', 'an object collection gets its key as the first column');
  const obsCsv = parseCsv(dsFiles[dsBase + '-series-observations.csv']);
  const obsTotal = Object.values(fred.series).reduce((n, x) => n + (x.observations || []).length, 0);
  assert.equal(obsCsv.length - 1, obsTotal, 'every observation, joined back by the series key');
  assert.equal(obsCsv[0][0], 'series key');
  assert.ok(dsFiles[dsBase + '-sources.csv'].includes(fredName), 'the dataset carries the inventory source record');
  assert.match(dsFiles['README.txt'], /Blank cells: .*never means zero/);
  assert.match(dsFiles['README.txt'], new RegExp('Records: ' + Object.keys(fred.series).length));
  // A null stays blank and a FIPS code stays text.
  const nulls = w.DatasetExport.tabulate('x', [{ fips: '08001', v: null, nested: { a: 0 } }]);
  assert.deepEqual(plain(nulls.sheets[0].table()), [['fips', 'v', 'nested.a'], ['08001', null, 0]]);

  const m = plain(TX.collect(table));
  const labels = m.columns.map((c) => c.label);
  assert.deepEqual(labels, ['Place', 'Gap', 'Rent', 'FIPS', 'Share'], 'header labels drop tip controls and sort glyphs');
  // Agreement: the file's definition is the page's definition, from each of
  // the three places a header can carry one.
  assert.deepEqual(m.columns.map((c) => c.definition), ['Where the row is.', 'Homes short of need.', 'Monthly rent, from the page tip.', 'FIPS code.', 'Share of the state.']);
  assert.equal(m.rows.length, 2, 'the colspan placeholder row is not data');
  assert.equal(m.rows[0].values[0], 'Alpha AMI', 'glossary popover text is not part of the value');
  assert.equal(m.rows[0].values[1], -1204);
  assert.equal(m.rows[0].values[2], 1123);
  assert.equal(m.rows[0].values[3], '08001', 'a FIPS code stays text');
  assert.equal(m.rows[0].values[4], 12.5);
  assert.equal(m.rows[1].values[4], 0, 'a real 0% stays 0');
  // Absence is not zero.
  assert.equal(m.rows[1].values[1], null, '"—" exports as blank');
  assert.equal(m.rows[1].values[2], null, '"Value unavailable" exports as blank');
  assert.match(m.rows[1].notes, /Gap: —/);
  assert.match(m.rows[1].notes, /Rent: Value unavailable \(not published\)/);
  assert.match(m.rows[0].notes, /Rent: Upper estimate\./, 'a cell caveat moves to the notes column');
  assert.equal(m.columns[2].unit, 'US dollars per month');
  assert.equal(m.columns[3].unit, 'Text');
  assert.deepEqual(m.selection, [['County', 'Alpha County'], ['Fixture option', 'Yes']], 'a ticked box is recorded as Yes, not its form value');
  w.document.getElementById('opt').checked = false;
  assert.deepEqual(plain(TX.collect(table)).selection, [['County', 'Alpha County'], ['Fixture option', 'No']], 'an unticked box is recorded as No');
  w.document.getElementById('opt').checked = true;
  assert.equal(m.sources[0].name, fredName, 'sources resolve from the inventory');
  assert.equal(m.sources[1].missing, true, 'an unknown source id is reported, not dropped');

  // CSV zip: four files, data header = labels + notes, indicators = page tips.
  const csv = await TX.build(table, 'csv');
  assert.equal(csv.format, 'csv');
  const files = unzip(Buffer.from(await csv.blob.arrayBuffer()));
  const base = csv.name.replace(/\.zip$/, '');
  assert.deepEqual(Object.keys(files).sort(), [base + '-indicators.csv', base + '-sources.csv', base + '.csv', 'README.txt'].sort());
  const data = parseCsv(files[base + '.csv']);
  assert.deepEqual(data[0], [...labels, 'Notes from the page (unavailable values and caveats)']);
  assert.deepEqual(data[2].slice(0, 5), ['Beta', '', '', '08003', '0'], 'blank, not 0, in the CSV');
  const ind = parseCsv(files[base + '-indicators.csv']);
  for (const c of m.columns) {
    const row = ind.find((r) => r[0] === c.label);
    assert.ok(row, `indicators.csv lists ${c.label}`);
    assert.equal(row[1], c.definition, `indicators.csv definition for ${c.label} is the page's`);
  }
  const src = parseCsv(files[base + '-sources.csv']);
  assert.equal(src[1][0], fredName, 'sources.csv names the inventory record');
  assert.equal(src[1][3], 'https://example.org/data/fred-data.json', 'file link is absolute');
  assert.match(files['README.txt'], /Blank cells: A blank cell means the value is unavailable\. It never means zero\./);
  assert.match(files['README.txt'], /Selection: County: Alpha County/);

  // Excel: four sheets, built from the same tables.
  const log = [];
  w.ExcelJS = stubExcel(log);
  const x = await TX.build(table, 'xlsx');
  assert.equal(x.format, 'xlsx');
  assert.deepEqual(plain(log[0].sheets.map((s) => s.name)), ['Data', 'Indicators', 'Sources', 'About']);
  const sheet = (n) => log[0].sheets.find((s) => s.name === n).rows;
  assert.deepEqual(plain(sheet('Data')), plain(TX.tables.data(m)));
  assert.equal(sheet('Data')[2][1], null, 'blank, not 0, in Excel');
  assert.deepEqual(plain(sheet('Indicators').slice(1, 6).map((r) => r[1])), m.columns.map((c) => c.definition));
  assert.ok(sheet('About').some((r) => r[0] === 'Notes' && r[1] === 'Fixture note.'));
  assert.equal(log[0].sheets[0].cols[3].numFmt, '"$"#,##0', 'whole-dollar column gets a dollar format');

  // A paginated table downloads every row its filters match, drawn by the
  // page's own row function; a control in a cell exports the value it names.
  table.txRowsHtml = () => ['Alpha', 'Beta', 'Gamma'].map((n, i) => `<tr><td>${n}</td><td>${i}</td><td><a href="#" data-export-text="${n} address">Map ↗</a></td><td>0800${i}</td><td>${i}%</td></tr>`).join('');
  const all = plain(TX.collect(table));
  assert.equal(all.rows.length, 3, 'txRowsHtml rows, not the page on screen, are downloaded');
  assert.equal(all.rows[2].values[2], 'Gamma address', 'data-export-text replaces the control text');
  delete table.txRowsHtml;

  // A table whose dataset follows a control cites the source for the current
  // value of that control, not a fixed one.
  const entry = w.TableExportRegistry.tables['fixture-table'];
  entry.sourcesBySelection = { control: '#vintage', values: { new: ['fred-data'] }, otherwise: ['bls-laus'] };
  assert.deepEqual(plain(TX.collect(table).sources.map((x) => x.id)), ['fred-data'], 'the selected vintage picks its source');
  w.document.querySelector('#vintage').value = 'old';
  assert.deepEqual(plain(TX.collect(table).sources.map((x) => x.id)), ['bls-laus'], 'another vintage falls to otherwise');
  delete entry.sourcesBySelection;

  // With Excel unavailable the click still downloads something: the CSV zip.
  delete w.ExcelJS;
  const realHead = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = (el) => { setTimeout(() => el.onerror && el.onerror()); return el; };
  const fb = await TX.build(table, 'xlsx');
  w.document.head.appendChild = realHead;
  assert.equal(fb.format, 'csv');
  assert.equal(fb.fellBack, true);
}

// The HNA and PMA writers append the registry's report metadata, read from
// the inventory: every source by its inventory name, and the selection.
async function reportChecks() {
  const inventoryById = Object.fromEntries(loadInventory().map((x) => [x.id, x]));
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.org/housing-needs-assessment.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  w.Blob = Blob;
  const saved = [];
  w.URL.createObjectURL = (b) => { saved.push(b); return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  w.eval(read('js/data-source-inventory.js'));
  w.eval(read('js/config/table-export-registry.js'));
  w.eval(read('js/components/table-export.js'));
  w.eval(read('js/hna/hna-export.js'));
  const d = {
    geography: { label: 'Mesa County', type: 'county', geoid: '08077' },
    snapshot: {}, housingStock: {}, chasCostBurden: {}, amiGap: {}, employment: {}, dataQuality: {},
    vintages: { acs: 'ACS 5-Year 2020-2024' }, lihtc: {}, transitZone: {}
  };
  await w.__HNA_exportCsv(d, 't.csv');
  const csv = await saved.pop().text();
  const rows = parseCsv(csv.replace(/^\uFEFF/, '') + '\n');
  const at = rows.findIndex((r) => r[0] === 'SECTION' && r[1] === 'Sources');
  assert.ok(at > 0, 'the HNA CSV has a Sources section');
  const names = reports['hna-report'].sources.filter((sid) => inventoryById[sid]).map((sid) => inventoryById[sid].name);
  for (const n of names) assert.ok(rows.slice(at).some((r) => r[0] === n), `the HNA CSV's Sources section names ${n}`);
  assert.ok(rows.some((r) => r[0] === 'Selection: GEOID' && r[1] === '08077'), 'the HNA CSV records the geography');
  assert.ok(rows.some((r) => r[0] === 'Blank values' && /never means zero/.test(r[1])), 'the HNA CSV says a blank is not zero');

  const log = [];
  w.ExcelJS = (function () {
    function Ws(name) { this.name = name; this.rows = []; this.columns = []; }
    Ws.prototype.addRow = function (r) { this.rows.push(r); return { font: {} }; };
    Ws.prototype.getRow = function () { return { font: {}, fill: {}, values: [] }; };
    Ws.prototype.getColumn = function () { return {}; };
    Ws.prototype.getCell = function () { return { font: {} }; };
    Ws.prototype.addChart = function () {};
    function Wb() { this.sheets = []; log.push(this); this.xlsx = { writeBuffer: () => Promise.resolve(new Uint8Array([80, 75])) }; }
    Wb.prototype.addWorksheet = function (n) { const ws = new Ws(n); this.sheets.push(ws); return ws; };
    return { Workbook: Wb };
  })();
  await w.__HNA_exportExcel(d, 't.xlsx');
  const wb = log[0];
  assert.ok(wb, 'the HNA workbook was built');
  const sheetNames = wb.sheets.map((x) => x.name);
  assert.ok(sheetNames.includes('Sources') && sheetNames.includes('About'), `the HNA workbook has Sources and About sheets, saw ${sheetNames.join(', ')}`);
  assert.ok(!sheetNames.includes('Notes & sources'), 'the typed notes sheet is replaced');
  const srcSheet = wb.sheets.find((x) => x.name === 'Sources').rows.map((r) => r[0]);
  for (const n of names) assert.ok(srcSheet.includes(n), `the HNA workbook's Sources sheet names ${n}`);
  w.close();
}

modelChecks().then(reportChecks).then(() => {
  if (failures.length) {
    console.error('table-export: ' + failures.length + ' failure(s)\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log(`table-export: ${ids.length} registry entries, ${literals} data-export attributes, ${pagesUsing.size} pages, ${datasets} full datasets, model and both formats OK`);
}).catch((e) => { console.error(e); process.exit(1); });
