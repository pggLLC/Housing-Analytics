'use strict';
// A download names one place and carries that place's figures, even when the
// place changes while the page is still loading (evening practitioner QA,
// 3 Nov 2026: a JSON named Mesa carried Hinsdale's GEOID and figures in 3 of
// 3 trials).
//
// Real page, real controller, real export module, real data files. The
// summary file of the place being switched to is held back, so each Download
// button is pressed while that load is still running. Both directions, every
// format. jsPDF and ExcelJS come from a CDN on the live page; here they are
// small stand-ins that record what would be written, so the test needs no
// network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
const ORIGIN = 'http://example.org';
const DELAY_MS = 2500;

const MESA = { geoid: '08077', label: 'Mesa County' };
const HINSDALE = { geoid: '08053', label: 'Hinsdale County' };

// Records each saved file as { name, text } on window.__saved.
const PDF_STUB = `
  window.__saved = window.__saved || [];
  window.jspdf = { jsPDF: function () {
    var lines = [];
    var api = {
      internal: { pageSize: { getWidth: function () { return 612; }, getHeight: function () { return 792; } }, getNumberOfPages: function () { return 1; } },
      text: function (t) { lines.push(Array.isArray(t) ? t.join(' ') : String(t)); return api; },
      splitTextToSize: function (t) { return [String(t)]; },
      getTextWidth: function (t) { return String(t).length * 5; },
      save: function (name) { window.__saved.push({ name: name, text: lines.join('\\n') }); },
    };
    return new Proxy(api, { get: function (o, k) { return k in o ? o[k] : function () { return api; }; } });
  } };`;
const EXCEL_STUB = `
  window.__saved = window.__saved || [];
  window.ExcelJS = { Workbook: function () {
    var sheets = [];
    function ws(name) {
      var rows = [];
      var cell = { font: {}, fill: {}, alignment: {}, border: {} };
      var row = { font: {}, fill: {}, values: [], eachCell: function () {}, getCell: function () { return cell; } };
      var s = { name: name, rows: rows, columns: [], views: [],
        addRow: function (o) { rows.push(o); return row; }, addRows: function (a) { a.forEach(function (o) { rows.push(o); }); },
        getRow: function () { return row; }, getColumn: function () { return { width: 10 }; }, getCell: function () { return cell; },
        mergeCells: function () {}, addImage: function () {}, addChart: function () {} };
      sheets.push(s); return s;
    }
    this.addWorksheet = ws;
    this.addImage = function () { return 0; };
    this.xlsx = { writeBuffer: async function () {
      window.__writing = true;
      if (window.__slowWrite) await new Promise(function (r) { setTimeout(r, window.__slowWrite); });
      window.__writing = false;
      return new TextEncoder().encode(JSON.stringify(sheets.map(function (s) { return { name: s.name, rows: s.rows }; })));
    } };
  } };`;

async function open(browser) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const hold = { geoid: null };
  page.on('pageerror', (e) => { page.__errors = (page.__errors || []).concat(String(e)); });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net' && /jspdf/.test(u.pathname)) return route.fulfill({ body: PDF_STUB, contentType: 'text/javascript' });
    if (u.hostname === 'cdn.jsdelivr.net' && /exceljs/.test(u.pathname)) return route.fulfill({ body: EXCEL_STUB, contentType: 'text/javascript' });
    if (u.origin !== ORIGIN) return route.abort();
    const rel = decodeURIComponent(u.pathname.slice(1)) || 'index.html';
    if (hold.geoid && rel === `data/hna/summary/${hold.geoid}.json`) await new Promise((r) => setTimeout(r, DELAY_MS));
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto(`${ORIGIN}/housing-needs-assessment.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HNAController && window.HNAController.whenSettled && window.__HNA_exportJson
    && document.getElementById('geoSelect').options.length > 0);
  await page.waitForLoadState('load');
  await page.evaluate(() => window.HNAController.whenSettled());
  return { page, hold };
}

async function show(page, place) {
  await page.selectOption('#geoType', 'county');
  await page.waitForFunction((g) => [...document.querySelectorAll('#geoSelect option')].some((o) => o.value === g), place.geoid);
  await page.selectOption('#geoSelect', place.geoid);
  await page.evaluate(() => window.HNAController.whenSettled());
  await page.waitForFunction((g) => window.HNAState.state.current && window.HNAState.state.current.geoid === g, place.geoid);
}

// Switch to `to` with its data held back, press `button` at once, and return
// the file the page saves.
async function switchAndDownload(page, hold, from, to, button) {
  await show(page, from);
  hold.geoid = to.geoid;
  await page.evaluate(() => { window.__saved = []; });
  const isDownload = button !== 'btnPdf';
  const waitDownload = isDownload ? page.waitForEvent('download', { timeout: 30000 }) : null;
  await page.selectOption('#geoSelect', to.geoid);
  assert.equal(await page.evaluate(() => window.HNAController.isUpdating()), true, 'the switch should still be loading when the button is pressed');
  await page.click('#' + button);
  let out;
  if (isDownload) {
    const dl = await waitDownload;
    const p = await dl.path();
    out = { name: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
  } else {
    await page.waitForFunction(() => window.__saved && window.__saved.length > 0, null, { timeout: 30000 });
    out = await page.evaluate(() => window.__saved[0]);
  }
  hold.geoid = null;
  await page.evaluate(() => window.HNAController.whenSettled());
  const saved = await page.evaluate(() => (window.__saved || []).length);
  if (!isDownload) assert.equal(saved, 1, `${button}: exactly one file should be written`);
  return out;
}

function assertBound(button, out, to, from) {
  const t = out.text;
  if (button === 'btnJson') {
    const d = JSON.parse(t);
    assert.equal(d.geography.geoid, to.geoid, `JSON GEOID should be ${to.label}`);
    assert.match(d.geography.label, new RegExp(to.label.split(' ')[0]), `JSON label should name ${to.label}`);
    const sum = JSON.parse(fs.readFileSync(path.join(root, `data/hna/summary/${to.geoid}.json`), 'utf8'));
    // The population the file carries is the selected place's own (DP05_0001E).
    const pop = Number(sum.acsProfile && sum.acsProfile.DP05_0001E);
    assert.ok(pop > 0, `${to.label} summary has a population`);
    assert.equal(String(d.snapshot.population).replace(/[^0-9]/g, ''), String(pop), `JSON population should be ${to.label}'s (${pop})`);
  } else {
    assert.ok(t.includes(to.label.split(' ')[0]), `${button} should name ${to.label}: ${t.slice(0, 300)}`);
  }
  assert.ok(!t.includes(from.label), `${button} should not mention ${from.label}`);
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  let checks = 0;
  try {
    const { page, hold } = await open(browser);
    for (const [from, to] of [[MESA, HINSDALE], [HINSDALE, MESA]]) {
      for (const button of ['btnJson', 'btnCsv', 'btnExcel', 'btnPdf']) {
        const out = await switchAndDownload(page, hold, from, to, button);
        assertBound(button, out, to, from);
        checks += 1;
        console.log(`  ok  ${button}: ${from.label} -> ${to.label} while loading gives one ${to.label} file (${out.name})`);
      }
    }
    // A slow file build: the place changes after a workbook has started but
    // before it is written. The half-built file is dropped and rebuilt for
    // the place now shown.
    await show(page, MESA);
    await page.evaluate(() => { window.__saved = []; window.__slowWrite = 1500; });
    const downloads = [];
    const onDl = (d) => downloads.push(d);
    page.on('download', onDl);
    const started = page.evaluate(() => window.__HNA_exportExcel());
    await page.waitForFunction(() => window.__writing === true);
    hold.geoid = HINSDALE.geoid;
    await page.selectOption('#geoSelect', HINSDALE.geoid);
    await started;
    hold.geoid = null;
    await page.evaluate(() => { window.__slowWrite = 0; return window.HNAController.whenSettled(); });
    await page.waitForTimeout(500);
    page.off('download', onDl);
    const files = [];
    for (const d of downloads) files.push({ name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), 'utf8') });
    assert.equal(files.length, 1, 'one workbook, not one per place');
    assert.ok(files[0].text.includes('Hinsdale') && !files[0].text.includes('Mesa County'), 'the workbook that was written is for the place now shown');
    checks += 1;
    console.log('  ok  a place change during a workbook build drops the half-built file and writes one for the place now shown');
    assert.deepEqual(page.__errors || [], [], 'no page errors');
    console.log(`\n${checks} checks passed`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('  FAIL ' + (e && e.stack || e)); process.exit(1); });
