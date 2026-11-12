'use strict';
const { createJsPdfMock } = require('./helpers/jspdf-mock.cjs');
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
const CENSUS_GAP_NOTE = 'renter households minus rentals priced for them (Census; counts every cheap rental as available; 0 = none short)';
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
// A test may stand a modified data file in for the real one (by path).
const FETCH_OVERRIDES = {};
window.fetch = async function (url) {
  const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '').split('?')[0];
  if (FETCH_OVERRIDES[rel] !== undefined) {
    const text = JSON.stringify(FETCH_OVERRIDES[rel]);
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  }
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

// Shared strict jsPDF mock: every printed string is kept in order.
const pdf = createJsPdfMock();
const pdfText = pdf.text;
window.jspdf = { jsPDF: pdf.jsPDF };

// ExcelJS stub: sheets by name, rows as the objects passed to addRow.
let sheets = {};
window.ExcelJS = global.ExcelJS = { Workbook: class {
  addWorksheet(name) {
    const rows = [];
    const ws = { name, rows, columns: [], addRow: (o) => { rows.push(o); return { font: {} }; },
      getRow: () => ({ font: {}, fill: {}, values: [] }), getColumn: () => ({}), getCell: () => ({ font: {} }) };
    sheets[name] = ws;
    return ws;
  }
  get xlsx() { return { writeBuffer: async () => new ArrayBuffer(0) }; }
} };

freshRequire('js/transit-zone.js');
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

// The stop file is dated; judge it the day after its build so the panel
// renders figures, not "stale", whatever day the suite runs.
const tzByGeo = readJson('data/hna/transit-zone-by-geography.json');
const tzMapStatus = readJson('data/policy/thiz-map-status.json');
const TZ_FRESH = new Date(Date.parse(tzByGeo.meta.stops_generated) + 86400e3);
const Contract = require(path.join(ROOT, 'js/workflow/recommendation-contract.js'));

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
  S.state.current = { geoid: c.geoid, geoType: c.geoType, profile: summary.acsProfile };
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
  await R.renderTransitZonePanel(c.geoid, c.tzNow || TZ_FRESH);
  // An invented page state, set after the page's own renderers have run.
  if (c.afterRender) c.afterRender();
  // HUD's count of homes short, by the page's own renderer (the controller
  // passes the same file).
  R.renderChasAvailableShortfall(readJson('data/hna/chas_affordable_available.json'), { type: c.geoType, geoid: c.geoid });
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
  pdf.assertSupported();
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
        ['80% AMI gap', m.ami_gap_80pct],
      ].map(([t, v]) => [t + ': ' + CENSUS_GAP_NOTE, v]);
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

    await test(`${label}: the ACS period is the loaded profile's, in the JSON, CSV, PDF and workbook`, async () => {
      // Evening practitioner QA, 3 Nov 2026: the label must follow the loaded
      // profile. Since the 4 Nov 2026 decision every county and town loads the
      // 5-year, so Mesa and Fruita both pin the 2020-2024 5-year.
      const r = await exportAll(c);
      const p = r.summary.acsProfile;
      const want = p._acsSeries === 'acs1' ? 'ACS 1-Year ' + p._acsYear : 'ACS 5-Year ' + (p._acsYear - 4) + '-' + p._acsYear;
      if (c.geoid === '08077') assert.strictEqual(want, 'ACS 5-Year 2020-2024', 'Mesa\'s summary is no longer the 2020-2024 5-year; update this pin');
      if (c.geoid === '0828745') assert.strictEqual(want, 'ACS 5-Year 2020-2024', 'Fruita\'s summary is no longer the 2020-2024 5-year; update this pin');
      assert.strictEqual(r.data.vintages.acs, want, 'JSON vintages.acs');
      assert.strictEqual(r.data.vintages.acsSeries, p._acsSeries);
      const csvRow = r.csvRows.find((x) => x[0] === 'ACS');
      assert(csvRow && csvRow[1] === want, `CSV ACS ${csvRow ? JSON.stringify(csvRow[1]) : 'missing'}`);
      assert(r.pdf.some((t) => t === 'Vintage: ' + want), 'PDF cover vintage');
      assert(r.pdf.some((t) => t.includes('drawn from the ' + want + ' profile')), 'PDF section 1 names the period');
      const xl = summaryRow('ACS profile');
      assert(xl && xl.v === want, `Excel ACS profile ${xl ? JSON.stringify(xl.v) : 'missing'}`);
      const other = p._acsSeries === 'acs1' ? '2020-2024' : '1-Year';
      assert(!r.pdf.some((t) => /ACS/.test(t) && t.includes(other) && /Vintage|profile/.test(t)), `the PDF still names ${other} for the profile`);
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

    await test(`${label}: the transit zone figures are the panel's, in the PDF, CSV, workbook and recommendation (PC-1)`, async () => {
      const r = await exportAll(c);
      const panel = document.getElementById('hnaTransitZoneContent');
      assert.strictEqual(panel.getAttribute('data-tz-state'), 'ok', 'fixture: the transit panel did not render');
      const tile = (k) => panel.querySelector(`[data-tz="${k}"]`).children[0].textContent.trim();
      const note = panel.querySelector('[data-tz-designation]').textContent.trim();
      const radius = tzByGeo.meta.radius_miles;
      const shareLabel = `Share within ${radius} miles of a confirmed transit stop`;
      // The half-mile row's distance and disclosure are the data's, through
      // TransitZone.qapTodDistance (#1961) — never a copied string.
      const tod = window.TransitZone.qapTodDistance(tzMapStatus);
      assert(tod, 'fixture: the zone-map status file has no readable TOD distance');
      const halfLabel = `Share within ${tod.plainLabel} of a confirmed stop`;
      for (const [lab, shown, disclosure] of [[shareLabel, tile('share')], [halfLabel, tile('half'), tod.disclosure],
        ['Nearest confirmed stop from the centre', tile('nearest')], ['Zone designation', note]]) {
        const row = summaryRow(lab);
        assert(row, `the workbook has no "${lab}" row`);
        assert.strictEqual(row.v, shown, `${lab}: page ${JSON.stringify(shown)}, Excel ${JSON.stringify(row.v)}`);
        const csvRow = r.csvRows.find((x) => x[0] === lab);
        const csvWant = disclosure ? `${shown} (${disclosure})` : shown;
        assert(csvRow && csvRow[1] === csvWant, `${lab}: CSV ${csvRow ? JSON.stringify(csvRow[1]) : 'missing'}`);
        assert(r.pdf.some((t) => t === pdfPlain(shown)), `${lab}: the PDF does not print ${JSON.stringify(shown)}`);
        if (disclosure) {
          assert(row.n && row.n.includes(disclosure), `${lab}: the workbook drops the disclosure (${JSON.stringify(row.n)})`);
          assert(r.pdf.some((t) => t.includes(pdfPlain(disclosure))), `${lab}: the PDF drops the disclosure`);
        }
      }
      assert(panel.querySelector('[data-tz="half"]').textContent.includes(tod.disclosure), 'the page tile drops the disclosure');
      // The recommendation (step 7) shows the same share for the same place.
      const tz = window.TransitZone.areaSummary(tzByGeo, c.geoid, tzMapStatus, TZ_FRESH);
      const rec = Contract.build({ digest: readJson(`data/hna/jurisdiction-metrics-digest/${c.geoid}.json`), project: null,
        generatedAt: 'x', transitZone: tz }).conclusions.find((x) => x.id === 'transit');
      assert.strictEqual(rec.evidence[0].label, shareLabel, 'the recommendation labels the share differently');
      assert.strictEqual(rec.evidence[0].value, tile('share'), 'the recommendation shows a different share from the panel');
      assert.strictEqual(rec.evidence[1].value, tile('half'), 'the recommendation shows a different half-mile share');
      assert(rec.plain.endsWith(note), 'the recommendation does not carry the panel\'s designation note');
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

  await test('a DDA note fits the status: Non-DDA is never told "130% basis boost" (closeout ledger P07)', async () => {
    // The old exporter printed "130% basis boost" under every DDA status, so a
    // place outside a DDA read as if it earned the boost. Invented statuses on
    // Fruita's page; the three words are the ones renderDdaLayer writes.
    const setDda = (status, note) => () => {
      document.getElementById('statDdaStatus').textContent = status;
      document.getElementById('statDdaNote').textContent = note;
    };
    const base = CASES[1];
    const non = await exportAll(Object.assign({}, base, { dda: null, afterRender: setDda('Non-DDA', 'Fruita is not in a HUD Difficult Development Area.') }));
    let row = summaryRow('DDA status');
    assert.strictEqual(row.v, 'Non-DDA');
    assert(/^Not designated: no DDA basis boost here/.test(row.n), 'Non-DDA note: ' + row.n);
    assert(!/130%/.test(row.n), 'a Non-DDA place is still told about a 130% boost in the workbook');
    const csvDda = non.csvRows.find((x) => x[0] === 'DDA status');
    assert(csvDda && /^Non-DDA \(Not designated/.test(csvDda[1]) && !/130%/.test(csvDda[1]), 'CSV DDA row: ' + (csvDda && csvDda[1]));
    assert(non.pdf.some((s) => /Not designated: no DDA basis boost/.test(String(s).replace(/\s+/g, ' ')))
      || non.pdf.join(' ').replace(/\s+/g, ' ').includes('Not designated: no DDA basis'), 'the PDF card has no Non-DDA note');
    assert(!non.pdf.some((s) => /^130% basis boost$/.test(String(s).trim())), 'the PDF still prints the bare "130% basis boost" note');
    // The PDF heading says what a designation does, and does not call it pricing.
    assert(!non.pdf.join(' ').includes('improve credit pricing'), 'the PDF heading still says a designation improves credit pricing');
    assert(non.pdf.join(' ').replace(/\s+/g, ' ').includes('does not change the price an investor pays per credit'));

    await exportAll(Object.assign({}, base, { dda: null, afterRender: setDda('DDA', 'Mesa County is a HUD Non-Metropolitan DDA.') }));
    row = summaryRow('DDA status');
    assert.strictEqual(row.v, 'DDA');
    assert(/^Designated: .*130% of eligible basis\. Confirm the site/.test(row.n), 'DDA note: ' + row.n);

    // Unknown: the page's own reason, and no claim either way.
    await exportAll(base);
    row = summaryRow('DDA status');
    assert.strictEqual(row.v, 'Unavailable');
    assert(!/130%/.test(row.n) && !/Not designated/.test(row.n), 'an unknown DDA status makes a claim: ' + row.n);
  });

  await test('reader-facing outputs name the AMI gap method in words; the JSON keeps the code (closeout ledger P09)', async () => {
    const r = await exportAll(CASES[1]);
    const code = r.data.amiGap.source;
    assert.strictEqual(code, rankOf('0828745').metrics._ami_gap_source, 'fixture: the JSON no longer carries the stable code');
    assert.strictEqual(code, 'place_acs_direct', 'fixture: Fruita\'s gap basis changed; pick a place whose code is place_acs_direct');
    const words = r.data.amiGap.sourceLabel;
    assert(/^Calculated for this place from Census ACS/.test(words), 'no plain words for ' + code);
    const head = summaryRow('AMI gap & affordability');
    assert.strictEqual(head.n, 'Source: ' + words, 'workbook: ' + head.n);
    assert(!sheets.Summary.rows.some((x) => [x.k, x.v, x.n].some((c) => /place_acs_direct/.test(String(c)))), 'the workbook Summary still shows the code');
    assert(!r.pdf.some((s) => /place_acs_direct/.test(String(s))), 'the PDF still shows the code');
    assert(r.pdf.join(' ').replace(/\s+/g, ' ').includes(pdfPlain(words).slice(0, 40)), 'the PDF does not show the plain words');
    // The CSV shows both, on separate rows, so the words and the code can be matched.
    const csvWords = r.csvRows.find((x) => x[0] === 'AMI Gap Source');
    const csvCode = r.csvRows.find((x) => x[0] === 'AMI Gap Source (code)');
    assert(csvWords && csvWords[1] === words && csvCode && csvCode[1] === code, 'CSV rows: ' + JSON.stringify([csvWords, csvCode]));
    // The transit designation row carries words, not its status code.
    const tz = summaryRow('Zone designation');
    assert(tz && !/^(provisional|official_in|official_out|official_map_available)$/.test(String(tz.n || '').trim()),
      'the transit designation note is the bare status code: ' + (tz && tz.n));
  });

  await test('an unavailable transit panel exports its reason, never a share', async () => {
    const stale = new Date(Date.parse(tzByGeo.meta.stops_generated) + 40 * 86400e3);
    const r = await exportAll(Object.assign({}, CASES[0], { tzNow: stale }));
    const panel = document.getElementById('hnaTransitZoneContent');
    assert.strictEqual(panel.getAttribute('data-tz-state'), 'unavailable', 'fixture: stale data did not make the panel unavailable');
    const reason = panel.textContent.replace(/^\s*Unavailable\.\s*/, '').trim();
    const rows = sheets.Summary.rows.filter((x) => /confirmed (transit )?stop|Zone designation/.test(x.k || ''));
    assert.strictEqual(rows.length, 4, 'the workbook dropped transit rows instead of marking them unavailable');
    for (const row of rows) {
      assert.strictEqual(row.v, 'Unavailable', `${row.k}: ${JSON.stringify(row.v)}`);
      assert.strictEqual(row.n, reason, `${row.k}: the reason is not the panel's`);
    }
    assert(!r.csvRows.some((x) => /confirmed (transit )?stop/.test(x[0] || '') && /\d%/.test(x[1] || '')), 'the CSV printed a share for an unavailable panel');
    assert(r.pdf.some((t) => t.includes(pdfPlain(reason))), 'the PDF does not carry the reason');
  });

  await test('a transit panel for another geography, or still loading, is never exported as this one\'s', async () => {
    const tzRows = () => sheets.Summary.rows.filter((x) => /confirmed (transit )?stop|Zone designation/.test(x.k || ''));
    // Panel rendered for Mesa, then the page switches to Fruita before the
    // panel re-renders (the controller does not await it).
    await exportAll(CASES[0]);
    assert.strictEqual(document.getElementById('hnaTransitZoneContent').getAttribute('data-tz-geoid'), '08077');
    const geoSelect = document.getElementById('geoSelect');
    geoSelect.innerHTML = '<option value="0828745" selected>Fruita</option>';
    geoSelect.value = '0828745';
    let data = window.__HNA_buildReportData();
    assert.strictEqual(data.transitZone.state, 'other_geography');
    sheets = {};
    await window.__HNA_exportExcel(data, 't.xlsx');
    assert.strictEqual(tzRows().length, 4);
    for (const row of tzRows()) {
      assert.strictEqual(row.v, 'Unavailable', `${row.k}: Mesa's figure exported under Fruita (${JSON.stringify(row.v)})`);
      assert.match(row.n, /had not loaded for this geography/);
    }
    // The re-render has started but not finished.
    const pending = window.HNARenderers.renderTransitZonePanel('0828745', TZ_FRESH);
    data = window.__HNA_buildReportData();
    assert.strictEqual(data.transitZone.state, 'loading');
    sheets = {};
    await window.__HNA_exportExcel(data, 't.xlsx');
    for (const row of tzRows()) {
      assert.strictEqual(row.v, 'Unavailable', `${row.k}: exported mid-load as ${JSON.stringify(row.v)}`);
      assert.match(row.n, /still loading/);
    }
    await pending;
    assert.strictEqual(window.__HNA_buildReportData().transitZone.state, 'ok', 'fixture: the panel never finished for Fruita');
  });

  // #1961: the straight-line / walking disclosure is the data's. Change the
  // measure in the status file and every export must say the new thing, not
  // the old; remove the distance and no export prints a half-mile share.
  await test('the half-mile disclosure in the PDF, CSV and workbook follows the status file\'s method fields', async () => {
    const STATUS = 'data/policy/thiz-map-status.json';
    const before = window.TransitZone.qapTodDistance(tzMapStatus);
    const walked = JSON.parse(JSON.stringify(tzMapStatus));
    walked.qap_tod_distance.method = 'walking';
    const after = window.TransitZone.qapTodDistance(walked);
    assert(after && after.disclosure !== before.disclosure, 'fixture: changing the method did not change the disclosure');
    FETCH_OVERRIDES[STATUS] = walked;
    try {
      const r = await exportAll(CASES[1]);
      const row = sheets.Summary.rows.find((x) => x.k === `Share within ${after.plainLabel} of a confirmed stop`);
      assert(row && row.n.includes(after.disclosure) && !row.n.includes(before.disclosure), `workbook: ${row && JSON.stringify(row.n)}`);
      const csvRow = r.csvRows.find((x) => x[0] === row.k);
      assert(csvRow && csvRow[1].includes(after.disclosure) && !csvRow[1].includes(before.disclosure), `CSV: ${csvRow && csvRow[1]}`);
      assert(r.pdf.some((t) => t.includes(pdfPlain(after.disclosure))), 'the PDF does not print the new disclosure');
      assert(!r.pdf.some((t) => t.includes(pdfPlain(before.disclosure))), 'the PDF still prints the old disclosure');

      const gone = JSON.parse(JSON.stringify(tzMapStatus));
      delete gone.qap_tod_distance;
      FETCH_OVERRIDES[STATUS] = gone;
      const g = await exportAll(CASES[1]);
      const rows = sheets.Summary.rows.filter((x) => /transit-oriented distance of a confirmed stop/.test(x.k || ''));
      assert.strictEqual(rows.length, 1, 'with no TOD distance the workbook lost or duplicated the half-mile row');
      assert.strictEqual(rows[0].v, 'Unavailable');
      assert.match(rows[0].n, /could not be read/);
      const halfCsv = g.csvRows.find((x) => x[0] === rows[0].k);
      assert(halfCsv && !/\d%/.test(halfCsv[1]), `the CSV printed a half-mile share with no distance: ${halfCsv && halfCsv[1]}`);
      assert(summaryRow(`Share within ${tzByGeo.meta.radius_miles} miles of a confirmed transit stop`).v !== 'Unavailable',
        'a missing TOD distance withdrew the zone-radius share too');
    } finally {
      delete FETCH_OVERRIDES[STATUS];
    }
  });

  await test('a projection figure missing from a view prints Unavailable with the reason, in the CSV, PDF and workbook', async () => {
    // Evening practitioner QA, 3 Nov 2026: on views without the projection
    // chapter the CSV left baseline units and target vacancy blank.
    const ids = ['statBaseUnits', 'statTargetVac'];
    const parked = ids.map((id) => { const el = document.getElementById(id); const ph = document.createComment(id); el.replaceWith(ph); return [el, ph]; });
    window.HNA_VIEW = { id: 'who-lives-here', nav: 'Who lives here' };
    try {
      const r = await exportAll(CASES[0]);
      const why = /Not part of the .Who lives here. view\. The full Housing Needs Assessment page shows it\./;
      for (const label of ['Baseline Housing Units', 'Target Vacancy Rate']) {
        const row = r.csvRows.find((x) => x[0] === label);
        assert(row && /^Unavailable: /.test(row[1]) && why.test(row[1]), `CSV ${label}: ${row ? JSON.stringify(row[1]) : 'missing'}`);
      }
      assert(why.test(r.data.housingStock.unavailableReasons.baselineUnits), 'JSON names the reason');
      const i = r.pdf.indexOf('Baseline housing units');
      assert(i !== -1 && r.pdf.slice(i, i + 4).some((t) => why.test(t)), 'PDF gives the reason under the Unavailable card');
      const xl = summaryRow('Current housing units');
      assert(xl && xl.v === 'Unavailable' && why.test(xl.n), `Excel: ${xl ? JSON.stringify(xl) : 'missing'}`);
    } finally {
      delete window.HNA_VIEW;
      parked.forEach(([el, ph]) => ph.replaceWith(el));
    }
  });

  await test('the workbook does not claim drawn charts it cannot write', async () => {
    // ExcelJS 4.4 has no addChart. The stub above has none either, so a call
    // would fail here instead of being swallowed as it was before 3 Nov 2026.
    const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-export.js'), 'utf8');
    assert(!/\.addChart\(/.test(src), 'hna-export.js still calls addChart');
    assert(!/re-draws the chart/i.test(src), 'the workbook still says Excel re-draws the chart');
    const btn = document.getElementById('btnExcel').getAttribute('title');
    assert(!/native Excel chart/i.test(btn), 'the Download Excel button still promises native charts: ' + btn);
  });

  await test('every workbook sheet keeps its header in view and on each printed page; long text wraps (closeout ledger P08)', async () => {
    await exportAll(CASES[0]);
    const names = Object.keys(sheets);
    assert(names.length >= 3, 'only ' + names.length + ' sheets'); // Summary, Sources, About; chart sheets need drawn charts, which jsdom has none of
    for (const n of names) {
      const ws = sheets[n], head = ws.pageSetup && ws.pageSetup.printTitlesRow;
      assert(ws.views && ws.views[0] && ws.views[0].state === 'frozen', n + ': header not frozen');
      assert(/^(\d+):\1$/.test(head || '') && Number(head.split(':')[0]) === ws.views[0].ySplit, n + ': print titles ' + head + ' do not match the frozen header');
      assert.strictEqual(ws.pageSetup.fitToWidth, 1, n + ': does not print one page across');
    }
    assert.strictEqual(sheets.Summary.views[0].ySplit, 1, 'Summary header is not row 1');
    const chart = names.find((n) => !['Summary', 'Need reconciliation', 'Sources', 'About', 'Notes & sources'].includes(n));
    if (chart) assert.strictEqual(sheets[chart].views[0].ySplit, 4, chart + ': chart sheet header is not row 4');
    // A worksheet with real rows: text wraps and the row grows, numbers and values are untouched.
    const rows = [[1, ['Metric', 'Value', 'Note']], [2, ['Short', 5455, 'ok']], [3, ['A label long enough to need three lines in a narrow column', 210, 'x'.repeat(130)]]]
      .map(([n, vals]) => ({ n, height: undefined, cells: vals.map((value) => ({ value })) }));
    const before = JSON.stringify(rows.map((r) => r.cells.map((c) => c.value)));
    const fake = { rowCount: 3, getColumn: (c) => ({ width: [20, 12, 40][c - 1] }),
      eachRow: (o, fn) => rows.forEach((r) => fn({ set height(h) { r.height = h; }, eachCell: (o2, f) => r.cells.forEach((c, i) => f(c, i + 1)) }, r.n)) };
    window.__HNA_readableSheet(fake, { filter: true });
    assert.strictEqual(JSON.stringify(rows.map((r) => r.cells.map((c) => c.value))), before, 'a value changed');
    assert(rows[2].cells[0].alignment.wrapText && rows[2].cells[2].alignment.wrapText, 'long text does not wrap');
    assert(!rows[2].cells[1].alignment.wrapText, 'a number was set to wrap');
    assert(rows[2].height >= 45, 'the long row did not grow: ' + rows[2].height);
    assert.strictEqual(rows[1].height, undefined, 'a short row was given a height');
    assert.deepStrictEqual(fake.autoFilter, { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } }, 'no filter on the header');
  });

  await test('Fruita\'s 80% AMI gap reaches the export from the place gap file (Codex round 2, finding B)', async () => {
    // The place file stores households minus units; the export must carry it, not null.
    const placeFile = readJson('data/co_ami_gap_by_place.json');
    const fr = Array.isArray(placeFile.places) ? placeFile.places.find((p) => p.fips === '0828745') : placeFile.places['0828745'];
    const want = Math.max(0, Math.trunc(Number(fr.gap_units_minus_households_le_ami_pct['80'])));
    assert.strictEqual(rankOf('0828745').metrics.ami_gap_80pct, want, 'ranking index lacks the 80% gap');
    const r = await exportAll(CASES.find((c) => c.geoid === '0828745'));
    const find = (o) => {
      if (!o || typeof o !== 'object') return undefined;
      if (Object.prototype.hasOwnProperty.call(o, 'gap80pctUnits')) return o.gap80pctUnits;
      for (const v of Object.values(o)) { const x = find(v); if (x !== undefined) return x; }
      return undefined;
    };
    assert.strictEqual(find(r.data), want, 'export gap80pctUnits is ' + JSON.stringify(find(r.data)));
  });

  await test('HUD\'s count of homes short leads the AMI gap rows and matches CHAS (fix audit 2026-11-10)', async () => {
    // Fruita: HUD CHAS 2018-2022 affordable and available, 210 / 235 / 65.
    const chas = readJson('data/hna/chas_affordable_available.json');
    const tiers = chas.places['0828745'].tiers;
    const r = await exportAll(CASES.find((c) => c.geoid === '0828745'));
    for (const t of ['30', '50', '80']) {
      const want = tiers[t].homes_short;
      const row = sheets.Summary.rows.find((x) => typeof x.k === 'string' && x.k.startsWith('Homes short, ≤' + t + '% AMI (HUD CHAS'));
      assert(row, `the workbook has no HUD homes-short row at ${t}%`);
      assert.strictEqual(row.v, want, `HUD ${t}%: CHAS ${want}, Excel ${JSON.stringify(row.v)}`);
      const csvRow = r.csvRows.find((x) => typeof x[0] === 'string' && x[0].startsWith('Homes short, ≤' + t + '% AMI'));
      assert(csvRow && csvRow[1] === Number(want).toLocaleString('en-US'), `HUD ${t}%: CSV ${csvRow ? csvRow[1] : 'no row'}`);
    }
    const first = r.csvRows.findIndex((x) => typeof x[0] === 'string' && x[0].startsWith('Homes short, ≤30%'));
    const census = r.csvRows.findIndex((x) => typeof x[0] === 'string' && x[0].startsWith('30% AMI gap'));
    assert(first !== -1 && census !== -1 && first < census, 'HUD rows come before the Census rows');
    const pdfText = r.pdf.join(' ');
    assert(!/METHODOLOGY-GAPS/.test(pdfText), 'the PDF still names an internal docs file');
  });

  await test('HUD counts survive a browser that groups digits without commas (Codex P2, PR 2769)', async () => {
    // Still on Fruita from the test above. A German or French browser prints
    // 119735 as "119.735" or "119 735"; the export must not read the text.
    const chas = readJson('data/hna/chas_affordable_available.json');
    const tiers = chas.places['0828745'].tiers;
    const el = document.getElementById('statChasShort30');
    const was = el.textContent;
    try {
      el.textContent = '1.210';
      const d = window.__HNA_buildReportData();
      assert.strictEqual(d.amiGap.hudShort['30'], tiers['30'].homes_short,
        'hudShort 30 is ' + JSON.stringify(d.amiGap.hudShort['30']));
    } finally { el.textContent = was; }
  });

  await test('the home value row names the source the page shows for it, in the workbook and the CSV (round-three review)', async () => {
    // Fruita's home value is a Zillow index, not ACS DP04. Mesa County is checked too, so a fixed label cannot pass.
    for (const geoid of ['0828745', '08077']) {
      const r = await exportAll(CASES.find((c) => c.geoid === geoid));
      const shown = document.getElementById('statHomeValueSrc').textContent.replace(/\s+/g, ' ').trim();
      assert(shown && shown !== '\u2014', geoid + ': the page shows no home value source to compare with');
      const row = sheets.Summary.rows.find((x) => typeof x.k === 'string' && /home value/i.test(x.k));
      assert(row, geoid + ': no home value row in the workbook');
      const rowText = JSON.stringify(row);
      assert(rowText.includes(shown.slice(0, 20)), geoid + ': workbook home value row does not carry the page source "' + shown.slice(0, 40) + '": ' + rowText.slice(0, 200));
      if (/zillow/i.test(shown)) assert(!/DP04/.test(rowText), geoid + ': a Zillow value is labelled DP04');
      const csvRow = r.csvRows.find((x) => x[0] === 'Median Home Value source');
      assert(csvRow && csvRow.join(' ').includes(shown.slice(0, 20)), geoid + ': CSV home value row lacks the page source: ' + JSON.stringify(csvRow) + ' vs ' + shown);
    }
  });

  await test('the CHAS disclosure agrees with how the place figures were made: shared out from tracts is an estimate, a county is measured (round-three review)', async () => {
    // What it must agree with: data/hna/place-chas.json records, per place, how its CHAS figures were built.
    const placeChas = readJson('data/hna/place-chas.json');
    const rec = placeChas.places['0828745'];
    assert(rec && /apportion/i.test(rec.source + ' ' + placeChas.meta.method),
      'fixture changed: Fruita\'s place CHAS is no longer recorded as apportioned from tracts (' + JSON.stringify(rec && rec.source) + ')');
    const disclosures = async (geoid) => {
      const r = await exportAll(CASES.find((c) => c.geoid === geoid));
      const csv = r.csvRows.filter((x) => x[0] === 'CHAS Data Source').map((x) => x[1]);
      const pdf = r.pdf.filter((t) => /^CHAS data source:/i.test(t));
      // Non-vacuity on the scan: both downloads must carry the disclosure at all.
      assert(csv.length === 1 && csv[0], geoid + ': the CSV carries no CHAS Data Source row');
      assert(pdf.length === 1, geoid + ': the PDF carries no "CHAS data source" line (' + pdf.length + ')');
      return csv.concat(pdf);
    };
    for (const text of await disclosures('0828745')) {
      assert(!/\bmeasured\b/i.test(text), 'apportioned place CHAS is called measured: ' + text);
      assert(/\bestimate/i.test(text), 'apportioned place CHAS is not disclosed as an estimate: ' + text);
    }
    // A county's CHAS is HUD's own published record, so the same wording there would be the opposite error.
    for (const text of await disclosures('08077')) {
      assert(!/\bestimate/i.test(text), 'a county\'s published CHAS is called an estimate: ' + text);
    }
  });

  await test('a snapshot card grows with a long source line, so no card or text is drawn over another (round-three review)', async () => {
    // The real disclosure a county-adjusted place (Aetna Estates, 0800620) shows under its home value.
    const LONG = 'County-adjusted Zillow/ACS estimate \u00b7 ACS 2020-2024 5-year \u00b7 low \u00b7 low confidence: no current city index';
    await exportAll(CASES.find((c) => c.geoid === '0828745'));
    const el = document.getElementById('statHomeValueSrc');
    const was = el.textContent, realPdf = window.jspdf;
    const wrap = createJsPdfMock({ wrapText: true });
    try {
      el.textContent = LONG;
      window.jspdf = { jsPDF: wrap.jsPDF };
      await window.HNAExport.exportPdf('t.pdf');
      wrap.assertSupported();
    } finally { el.textContent = was; window.jspdf = realPdf; }
    const cards = wrap.calls.filter((c) => c.method === 'roundedRect').map((c) => ({ page: c.page, x: c.args[0], y: c.args[1], w: c.args[2], h: c.args[3] }));
    const texts = wrap.calls.filter((c) => c.method === 'text').map((c) => ({ page: c.page, lines: Array.isArray(c.args[0]) ? c.args[0] : [c.args[0]], x: c.args[1], y: c.args[2], size: c.fontSize, lh: (c.args[3] && c.args[3].lineHeightFactor) || 1.15 }));
    assert(cards.length >= 9, 'the scan found only ' + cards.length + ' cards');
    const long = texts.find((t) => t.lines.join(' ').replace(/\s+/g, '') === LONG.replace(/\s+/g, ''));
    assert(long && long.lines.length >= 3, 'the long source line was not exported wrapped over three lines or more: ' + JSON.stringify(long && long.lines));
    const inCard = (t, c) => t.page === c.page && t.x >= c.x && t.x < c.x + c.w && t.y >= c.y && t.y < c.y + c.h + 40;
    const home = cards.find((c) => inCard(long, c) && long.y <= c.y + c.h);
    assert(home, 'the long source line is not inside any card');
    const lastBaseline = long.y + (long.lines.length - 1) * long.size * long.lh;
    assert(lastBaseline <= home.y + home.h - 2, 'the source line runs past its card: last line at ' + lastBaseline + ', card ends at ' + (home.y + home.h));
    // No card overlaps another, and no card is drawn over the text of the card above it.
    for (const a of cards) for (const b of cards) {
      if (a === b || a.page !== b.page) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert(!overlap, 'two cards overlap: ' + JSON.stringify([a, b]));
    }
  });

  await test('a 0 AMI gap is exercised: Mesa\'s 60% AMI gap is 0 in the data', async () => {
    assert.strictEqual(rankOf('08077').metrics.ami_gap_60pct, 0, 'fixture changed: pick another zero-gap jurisdiction');
  });

  console.warn = realWarn;
  console.log(`\n${checks} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.warn = realWarn; console.error(e); process.exit(1); });
