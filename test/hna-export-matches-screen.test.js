'use strict';
/*
 * The same figure for the same place shows the same value, label, source and
 * year on the page, in the PDF and in the Excel workbook (finish line PC-1),
 * and a missing figure is never written as 0 or dropped (PC-3).
 *
 * Built on the real page (housing-needs-assessment.html), the real page
 * renderer (hna-renderers.js renderSnapshot, renderQctLayer, renderDdaLayer),
 * the real need reconciliation (hna-controller.js buildNeedReconciliation) and
 * the real data files, for Mesa County (08077) and Fruita (0828745). Each
 * export value is asserted equal to what the page shows, read from the same
 * source object, not to a copied string.
 *
 * Defects this pins (all on main before this test):
 *   - the workbook Summary read snapshot fields that do not exist
 *     (medianRent, rentBurdened30Plus, meanCommuteMin), so rent, rent burden
 *     and commute were missing from Excel while the page and PDF showed them;
 *   - `m.ami_gap_60pct || null` turned a real 0 gap into a blank (Mesa);
 *   - the PDF/CSV called the <=30% AMI rental shortfall a "Total housing gap";
 *   - the sources table printed a literal "LEHD WAC 2021" against 2023 data;
 *   - chart sheet names carried the methodology popover's info glyph;
 *   - the workbook had no AMI gap, LIHTC, QCT or DDA rows at all.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function freshRequire(relPath) {
  const abs = path.join(ROOT, relPath);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

let failures = 0;
let checks = 0;
async function test(name, fn) {
  try { await fn(); checks += 1; console.log('  ok  ' + name); } catch (e) {
    failures += 1;
    console.error('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e));
  }
}

// ── Browser environment on the real page ─────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/housing-needs-assessment.html' });
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.URLSearchParams = dom.window.URLSearchParams;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const origAdd = dom.window.document.addEventListener.bind(dom.window.document);
dom.window.document.addEventListener = function (type, l, o) {
  if (type === 'DOMContentLoaded') return undefined;
  return origAdd(type, l, o);
};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.requestAnimationFrame = window.requestAnimationFrame;
window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
window.HTMLAnchorElement.prototype.click = function () {};
window.APP_CONFIG = { DATA_VERSION: 'test' };
window.fetch = async function (url) {
  const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '').split('?')[0];
  const abs = path.join(ROOT, rel);
  if (rel.startsWith('data/') && fs.existsSync(abs)) {
    const text = fs.readFileSync(abs, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  }
  return { ok: false, status: 404, json: async () => null, text: async () => '' };
};
global.fetch = window.fetch;
window.fetchWithTimeout = (u) => window.fetch(u);
global.fetchWithTimeout = window.fetchWithTimeout;

let capturedBlob = null;
window.URL.createObjectURL = (b) => { capturedBlob = b; return 'blob:test'; };
window.URL.revokeObjectURL = () => {};
global.URL = window.URL;
global.Blob = window.Blob;

// One chart on the page, under a heading that carries the real methodology
// popover (js/components/methodology-popover.js), which puts "ℹ️ Methodology"
// and its whole body inside the <h2>.
const chartCanvas = document.getElementById('chartTenure');
global.Chart = window.Chart = class { constructor() {} destroy() {} };
window.Chart.instances = {
  0: { canvas: chartCanvas, data: { labels: ['Owner', 'Renter'], datasets: [{ label: 'Share', data: [70, 30] }] }, config: { type: 'bar' } },
};

// jsPDF stub: every string printed is kept, in order.
const pdfText = [];
class PdfStub {
  constructor() {
    this.internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 }, getNumberOfPages: () => 1 };
  }
  splitTextToSize(v) { return Array.isArray(v) ? v.map(String) : [String(v == null ? '' : v)]; }
  text(v) { (Array.isArray(v) ? v : [v]).forEach((x) => pdfText.push(String(x == null ? '' : x))); }
}
['addImage', 'addPage', 'line', 'rect', 'roundedRect', 'save', 'setDrawColor', 'setFillColor', 'setFont',
  'setFontSize', 'setLineWidth', 'setPage', 'setTextColor'].forEach((m) => { PdfStub.prototype[m] = function () {}; });
window.jspdf = { jsPDF: PdfStub };

// ExcelJS stub: sheets by name, rows as the objects passed to addRow.
let sheets = {};
window.ExcelJS = global.ExcelJS = { Workbook: class {
  addWorksheet(name) {
    const rows = [];
    const ws = { name, rows, columns: [], addRow: (o) => { rows.push(o); return { font: {} }; },
      getRow: () => ({ font: {}, fill: {}, values: [] }), getColumn: () => ({}), getCell: () => ({ font: {} }), addChart: () => {} };
    sheets[name] = ws;
    return ws;
  }
  get xlsx() { return { writeBuffer: async () => new ArrayBuffer(0) }; }
} };

freshRequire('js/hna/hna-utils.js');
freshRequire('js/hna/hna-renderers.js');
freshRequire('js/components/methodology-popover.js');
freshRequire('js/hna/hna-export.js');
freshRequire('js/hna/hna-controller.js');

window.MethodologyPopover.attach('#hnaH2Tenure', { what: 'Share of occupied housing units that are owner- vs renter-occupied.', source: 'ACS DP04' });

const warned = [];
const realWarn = console.warn;
console.warn = (...a) => warned.push(a.map(String).join(' '));

// ── Data ───────────────────────────────────────────────────────────────
const rankingIndex = readJson('data/hna/ranking-index.json');
const rankRows = Array.isArray(rankingIndex.rankings) ? rankingIndex.rankings : Object.values(rankingIndex.rankings);
const rankOf = (g) => rankRows.find((r) => r.geoid === g);
const countyLehd = readJson('data/hna/lehd/08077.json');
const placeLehd = readJson('data/hna/place-lehd.json').places;

const CASES = [
  { geoid: '08077', geoType: 'county', county: '08077', lehd: () => countyLehd, qct: { features: [{}, {}] }, dda: null },
  { geoid: '0828745', geoType: 'place', county: '08077', lehd: () => placeLehd['0828745'].lehd,
    qct: { features: [], unavailableReason: 'data/qct-colorado.json and the HUD QCT service both failed to load' },
    dda: { features: [], unavailableReason: 'data/dda-colorado.json and the HUD DDA service both failed to load' } },
];

function pageText(id) { return document.getElementById(id).textContent.trim(); }
function isBlank(t) { return t === '' || t === '—'; }
function pdfPlain(t) {
  return String(t).replace(/≤/g, '<=').replace(/×/g, 'x').replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-').replace(/−/g, '-');
}
function summaryRow(label) { return sheets.Summary.rows.find((r) => r.k === label); }

async function exportAll(c) {
  const summary = readJson(`data/hna/summary/${c.geoid}.json`);
  const R = window.HNARenderers;
  const S = window.HNAState;
  R.clearStats();
  S.state.contextCounty = c.county;
  S.state.current = { geoid: c.geoid, geoType: c.geoType };
  const geoType = document.getElementById('geoType');
  const geoSelect = document.getElementById('geoSelect');
  geoType.innerHTML = `<option value="${c.geoType}" selected>${c.geoType}</option>`;
  geoSelect.innerHTML = `<option value="${c.geoid}" selected>${summary.geo.label}</option>`;
  geoType.value = c.geoType;
  geoSelect.value = c.geoid;

  // What the page renders, by the page's own renderers.
  R.renderSnapshot(summary.acsProfile, summary.acsS0801 || null, summary.geo.label, null);
  R.renderQctLayer(c.qct);
  if (c.dda) R.renderDdaLayer(c.county, c.dda, { type: c.geoType, name: summary.geo.label });
  // The controller caches the LEHD blob it rendered under this key (hna-controller.js).
  window.__HNA_LEHD_CACHE = { [c.geoid]: c.lehd() };

  // What the page's need reconciliation shows for the existing gap: it reads
  // housing_gap_units from the jurisdiction digest.
  const digest = readJson(`data/hna/jurisdiction-metrics-digest/${c.geoid}.json`);
  const g = digest.metrics.housing_gap_units;
  const rec = window.HNAController.buildNeedReconciliation({
    endYear: 2044, usedUnits: null, basis: null, growthUnits: null, workforceUnits: null,
    existingGapUnits: g && typeof g === 'object' ? g.value : g,
  });

  sheets = {};
  pdfText.length = 0;
  await window.HNAExport.exportPdf('t.pdf');
  const data = window.__HNA_buildReportData();
  await window.__HNA_exportExcel(data, 't.xlsx');
  window.__HNA_exportCsv(data, 't.csv');
  const csv = await capturedBlob.text();
  const csvRows = csv.split('\r\n').map((line) => (line.match(/"((?:[^"]|"")*)"/g) || []).map((f) => f.slice(1, -1).replace(/""/g, '"')));
  return { summary, data, rec, csvRows, pdf: pdfText.slice() };
}

(async function main() {

  for (const c of CASES) await exportAll(c);

  await test('the exports completed without falling back', async () => {
    const bad = warned.filter((w) => /export failed|falling back/i.test(w));
    assert.deepStrictEqual(bad, [], 'an export fell back: ' + bad.join(' | '));
  });

  for (const c of CASES) {
    const label = `${c.geoType} ${c.geoid}`;

    await test(`${label}: every page stat card is a Summary row, with the page's label and value`, async () => {
      const r = await exportAll(c);
      const cards = [
        ['statPop'], ['statMhi'], ['statHomeValue'], ['statRent'], ['statTenure'],
        ['statRentBurden'], ['statIncomeNeed'], ['statCommute'], ['statBaseUnits'],
      ];
      let shown = 0;
      for (const [id] of cards) {
        const card = document.getElementById(id).closest('.stat');
        const pageLabel = card.querySelector('.k').textContent.trim();
        const row = summaryRow(pageLabel);
        assert(row, `the Summary has no row labelled "${pageLabel}" (the page's card label)`);
        const onPage = pageText(id);
        if (isBlank(onPage)) {
          assert.strictEqual(row.v, 'Unavailable', `"${pageLabel}" is blank on the page but ${JSON.stringify(row.v)} in Excel`);
          assert(row.n && row.n.length > 10, `"${pageLabel}" is Unavailable with no reason`);
        } else {
          shown += 1;
          assert.strictEqual(row.v, onPage, `"${pageLabel}": page ${JSON.stringify(onPage)}, Excel ${JSON.stringify(row.v)}`);
          assert(r.pdf.includes(pdfPlain(onPage)) || pageLabel === 'Current housing units' || pageLabel.startsWith('Rent burdened'),
            `"${pageLabel}": the PDF does not print the page's ${JSON.stringify(onPage)}`);
        }
      }
      assert(shown >= 6, `only ${shown} stat cards rendered — the fixture did not exercise the renderer`);
    });

    await test(`${label}: rent, rent burden and commute reach Excel when the source field exists`, async () => {
      const r = await exportAll(c);
      const p = r.summary.acsProfile;
      const s = r.summary.acsS0801 || {};
      const need = [
        ['statRent', p.DP04_0134E],
        ['statRentBurden', p.DP04_0141PE != null ? p.DP04_0141PE : p.DP04_0142PE],
        ['statCommute', s.S0801_C01_046E],
      ];
      for (const [id, src] of need) {
        if (src == null) continue;
        const pageLabel = document.getElementById(id).closest('.stat').querySelector('.k').textContent.trim();
        const row = summaryRow(pageLabel);
        assert(row && row.v !== 'Unavailable' && row.v != null && row.v !== '',
          `"${pageLabel}" has source data (${src}) but Excel shows ${row ? JSON.stringify(row.v) : 'no row'}`);
      }
    });

    await test(`${label}: the AMI gap in every export equals the ranking index, and a 0 stays 0`, async () => {
      const r = await exportAll(c);
      const m = rankOf(c.geoid).metrics;
      const pairs = [
        ['30% AMI gap', m.ami_gap_30pct], ['50% AMI gap', m.ami_gap_50pct], ['60% AMI gap', m.ami_gap_60pct],
      ];
      for (const [lab, want] of pairs) {
        const row = summaryRow(lab);
        assert(row, `the workbook has no "${lab}" row`);
        if (want == null) {
          assert.strictEqual(row.v, 'Unavailable', `${lab}: absent in the data but ${JSON.stringify(row.v)} in Excel`);
          assert(row.n, `${lab}: Unavailable without a reason`);
          continue;
        }
        assert.strictEqual(row.v, want, `${lab}: data ${want}, Excel ${JSON.stringify(row.v)}`);
        const disp = Number(want).toLocaleString('en-US');
        const csvRow = r.csvRows.find((x) => x[0] === lab);
        assert(csvRow && csvRow[1] === disp, `${lab}: data ${want}, CSV ${csvRow ? JSON.stringify(csvRow[1]) : 'no row'}`);
        const i = r.pdf.indexOf(lab);
        assert(i !== -1 && r.pdf[i + 1] === disp, `${lab}: data ${want}, PDF ${i === -1 ? 'no row' : JSON.stringify(r.pdf[i + 1])}`);
      }
    });

    await test(`${label}: the <=30% AMI shortfall carries the page's name and the page's number`, async () => {
      const r = await exportAll(c);
      const existing = r.rec.rows.find((x) => x.key === 'existing');
      assert(/≤30% AMI/.test(existing.counts), 'the page no longer defines its existing-shortfall row as <=30% AMI; update the export label with it');
      const row = sheets.Summary.rows.find((x) => typeof x.k === 'string' && x.k.startsWith(existing.label));
      assert(row, `the workbook has no row named for the page's "${existing.label}"`);
      assert(/≤30% AMI/.test(row.k), `the export label "${row.k}" does not say <=30% AMI, as the page does`);
      assert(!/total housing gap/i.test(row.k), 'the <=30% AMI rental gap is still called a total housing gap');
      const want = existing.units === null ? 'Unavailable' : existing.units;
      assert.strictEqual(row.v, want, `page shows ${want}, Excel ${JSON.stringify(row.v)}`);
      const pdfLabel = pdfPlain(row.k);
      const i = r.pdf.indexOf(pdfLabel);
      assert(i !== -1, `the PDF has no "${pdfLabel}" row`);
      assert(!r.pdf.some((t) => /total housing gap/i.test(t)), 'the PDF still says "Total housing gap"');
      assert(!r.csvRows.some((x) => /total housing gap/i.test(x[0] || '')), 'the CSV still says "Total Housing Gap"');
    });

    await test(`${label}: the LODES year is the data's wacYear in the PDF, CSV and workbook`, async () => {
      const r = await exportAll(c);
      const year = String(countyLehd.wacYear);
      assert(/^\d{4}$/.test(year), 'the county LEHD file has no wacYear');
      const lehdRow = summaryRow('LEHD workplace');
      assert(lehdRow && String(lehdRow.v).includes(year), `Excel LEHD source ${lehdRow ? JSON.stringify(lehdRow.v) : 'missing'}; data wacYear ${year}`);
      const i = r.pdf.indexOf('LEHD workplace');
      assert(i !== -1 && r.pdf[i + 1].includes(year), `PDF LEHD source ${i === -1 ? 'missing' : JSON.stringify(r.pdf[i + 1])}; data wacYear ${year}`);
      const csvRow = r.csvRows.find((x) => x[0] === 'LEHD WAC');
      assert(csvRow && csvRow[1].includes(year), `CSV LEHD ${csvRow ? JSON.stringify(csvRow[1]) : 'missing'}; data wacYear ${year}`);
      assert(!r.pdf.some((t) => /LEHD WAC 2021/.test(t)), 'the PDF still prints the literal LEHD WAC 2021');
    });

    await test(`${label}: LIHTC, QCT and DDA rows match the page, with the page's reason when unavailable`, async () => {
      const r = await exportAll(c);
      const cards = [['LIHTC projects', 'statLihtcCount'], ['LIHTC units', 'statLihtcUnits'], ['QCT tracts', 'statQctCount'], ['DDA status', 'statDdaStatus']];
      for (const [lab, id] of cards) {
        const row = summaryRow(lab);
        assert(row, `the workbook has no "${lab}" row`);
        const onPage = pageText(id);
        if (isBlank(onPage) || /^(unavailable|not available)$/i.test(onPage)) {
          assert.strictEqual(row.v, 'Unavailable', `${lab}: page ${JSON.stringify(onPage)}, Excel ${JSON.stringify(row.v)}`);
          assert(row.n && row.n.length > 10, `${lab}: Unavailable with no reason`);
        } else {
          const n = Number(onPage.replace(/,/g, ''));
          assert.strictEqual(row.v, Number.isFinite(n) ? n : onPage, `${lab}: page ${JSON.stringify(onPage)}, Excel ${JSON.stringify(row.v)}`);
        }
      }
      if (c.qct.unavailableReason) {
        assert.strictEqual(pageText('statQctCount'), 'Unavailable', 'fixture: the page did not render QCT as unavailable');
        assert(summaryRow('QCT tracts').n.includes(c.qct.unavailableReason), 'the workbook does not carry the QCT unavailable reason the page gives');
        assert(r.pdf.some((t) => t.includes(pdfPlain(c.qct.unavailableReason))), 'the PDF does not carry the QCT unavailable reason');
      } else {
        assert.strictEqual(summaryRow('QCT tracts').v, c.qct.features.length, 'the QCT count differs from the page');
      }
      if (c.dda && c.dda.unavailableReason) {
        assert.strictEqual(summaryRow('DDA status').n, pageText('statDdaNote'), 'the DDA reason is not the page\'s own note');
      }
    });

    await test(`${label}: no sheet name carries an info glyph or popover text`, async () => {
      const r = await exportAll(c);
      const names = Object.keys(sheets);
      assert(names.length >= 3, 'too few sheets to check: ' + names.join(', '));
      assert(document.getElementById('hnaH2Tenure').textContent.includes('ℹ'), 'fixture: the popover glyph is not in the heading');
      for (const n of names) {
        assert(!/[ℹⓘ️]/.test(n), `sheet name ${JSON.stringify(n)} carries an info glyph`);
        assert(!/Methodolo/.test(n), `sheet name ${JSON.stringify(n)} carries popover text`);
      }
      assert(names.includes('Owner renter shares'), 'the chart sheet is not named after its heading: ' + names.join(', '));
    });
  }

  await test('a 0 AMI gap is exercised: Mesa\'s 60% AMI gap is 0 in the data', async () => {
    assert.strictEqual(rankOf('08077').metrics.ami_gap_60pct, 0, 'fixture changed: pick another zero-gap jurisdiction');
  });

  console.warn = realWarn;
  console.log(`\n${checks} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.warn = realWarn; console.error(e); process.exit(1); });
