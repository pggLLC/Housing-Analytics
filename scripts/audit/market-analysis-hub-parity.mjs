#!/usr/bin/env node
// Side by side: market-analysis.html against deal-market-analysis.html, same site, same inputs.
//
// The new page runs the old page's own scripts, so every figure should be the same. This opens both pages in
// one browser, gives each the same invented site and the same inputs, and compares everything a visitor can
// read or take away:
//   - the analysis result the engine holds (PMAEngine._state.getLastResult())
//   - every word and number drawn inside <main> (less the trail the new page adds, and with glossary
//     pop-ups set aside: they attach at a moment that varies from load to load on either page)
//   - the value of every field, the rows of every table, the data behind every chart
//   - the CSV and JSON downloads, byte for byte (less their time stamp)
//   - the count of controls, tables, charts and maps
//   - which elements of <main> are drawn and which are not (market-analysis-hub-drawn.mjs), so a result that is
//     in the page but hidden on one of the two does not pass
// Requests that leave the machine are blocked for both pages, so a slow outside service cannot make the two
// differ; the parts that wait on one say "unavailable" on both.
//
//   node scripts/audit/market-analysis-hub-parity.mjs [--base http://127.0.0.1:8080] [--out report.json] [--width 390]
// Exits 1 on any difference. Not part of ci-checks (it needs a browser); run it before each piece is merged.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { readNotDrawn, drawnDiff } from './market-analysis-hub-drawn.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = (arg('--base') || 'http://127.0.0.1:8080').replace(/\/$/, '');
const OUT = arg('--out');
// --control compares the old page with itself: what differs there is the page's own run-to-run noise.
const OLD = 'market-analysis.html', NEW = process.argv.includes('--control') ? OLD : 'deal-market-analysis.html';
const ONLY = arg('--site');
// --width 390 runs both pages at a phone's width, so the rules the new page has for a phone are compared too.
const WIDTH = Number(arg('--width')) || 1280;

// Invented sites: a point in six Colorado places, none of them a project. Two sets of inputs each.
const SITES = [
  { name: 'Salida', lat: 38.5347, lon: -105.9989 },
  { name: 'Greeley', lat: 40.4233, lon: -104.7091 },
  { name: 'Alamosa', lat: 37.4695, lon: -105.87 },
  { name: 'Craig', lat: 40.5152, lon: -107.5465 },
  { name: 'Sterling', lat: 40.6255, lon: -103.2077 },
  { name: 'Denver, Capitol Hill', lat: 39.7312, lon: -104.9787 }
];
const INPUTS = [
  { label: 'defaults', buffer: null, fields: {} },
  { label: '5-mile buffer, 64 homes across four income levels, no three-bedrooms', buffer: '5',
    fields: { pmaProposedUnits: 64, pmaAmi30: 8, pmaAmi50: 16, pmaAmi60: 30, pmaAmi80: 10 }, uncheck: ['pmaBr3'] }
];

const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?|\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)/g;
const clean = s => String(s).replace(STAMP, '<time>').replace(/\(\d+ ?ms\)/g, '(<ms>)').replace(/\s+/g, ' ').trim();

async function runPage(browser, file, site, input) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  await page.route('**/*', route => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  await page.goto(BASE + '/' + file, { waitUntil: 'load' });
  await page.waitForFunction(() => window.PMAEngine && window.PMAEngine.whenDataReady, null, { timeout: 60000 });
  await page.evaluate(() => window.PMAEngine.whenDataReady());
  if (input.buffer) await page.selectOption('#pmaBufferSelect', input.buffer);
  for (const [id, v] of Object.entries(input.fields || {})) {
    await page.fill('#' + id, String(v));
    await page.dispatchEvent('#' + id, 'change');
  }
  for (const id of input.uncheck || []) await page.uncheck('#' + id);
  await page.evaluate(({ lat, lon }) => { window.PMAEngine.placeSiteMarker(lat, lon); return window.PMAEngine.runAnalysis(lat, lon); }, site);
  await page.waitForFunction(() => window.PMAEngine._state.getLastResult(), null, { timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  // Let every card that follows the result settle: no change to the page's words for two seconds.
  await page.evaluate(() => new Promise(resolve => {
    const main = document.getElementById('main-content');
    let last = main.innerText, still = 0;
    const t = setInterval(() => { const now = main.innerText; if (now === last) { if (++still >= 4) { clearInterval(t); resolve(); } } else { still = 0; last = now; } }, 500);
    setTimeout(() => { clearInterval(t); resolve(); }, 45000);
  }));

  const snap = await page.evaluate(() => {
    const main = document.getElementById('main-content').cloneNode(true);
    // The trail the new page adds.
    main.querySelectorAll('nav.crumbs').forEach(n => n.remove());
    const live = document.getElementById('main-content');
    // Glossary pop-ups attach when js/glossary.js arrives, which varies from load to load on either page, and each
    // one splits the sentence it sits in. So the pop-up text is set aside (and counted), and the words are read
    // as whole blocks, not as the pieces the pop-ups cut them into.
    const glossary = main.querySelectorAll('.gl-tooltip-trigger, abbr[data-glossary]').length;
    main.querySelectorAll('.gl-tooltip-popup, script, style, noscript, template').forEach(n => n.remove());
    const text = [];
    const BLOCK = 'p, li, td, th, dt, dd, h1, h2, h3, h4, h5, summary, label, button, option, caption, figcaption, legend';
    main.querySelectorAll(BLOCK).forEach(b => {
      if (b.querySelector(BLOCK)) return;
      const t = b.textContent.replace(/\s+/g, ' ').trim();
      if (t) text.push(t);
    });
    const whole = main.textContent.replace(/\s+/g, ' ').trim();
    const fields = [...live.querySelectorAll('input, select, textarea')].map(e => (e.id || e.name || e.getAttribute('aria-label') || e.type) + '=' + (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value));
    const tables = [...live.querySelectorAll('table')].map(t => [...t.rows].map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
    const charts = window.Chart && window.Chart.instances ? Object.values(window.Chart.instances).map(c => ({ id: c.canvas && c.canvas.id, type: c.config.type, labels: c.data.labels, data: c.data.datasets.map(d => ({ label: d.label, data: d.data })) })) : [];
    return {
      result: JSON.stringify(window.PMAEngine._state.getLastResult()),
      scenarios: JSON.stringify(window.PMAEngine._state.getLastScenarios()),
      benchmark: JSON.stringify(window.PMAEngine._state.getLastBenchmark()),
      text, whole, glossary, fields, tables, charts: JSON.parse(JSON.stringify(charts)),
      counts: {
        controls: live.querySelectorAll('input, select, textarea, button').length,
        tables: tables.length, charts: charts.length, canvases: live.querySelectorAll('canvas').length,
        maps: live.querySelectorAll('.leaflet-container').length, ids: live.querySelectorAll('[id]').length,
        links: main.querySelectorAll('a[href]').length, details: live.querySelectorAll('details').length
      }
    };
  });

  const drawn = await readNotDrawn(page);

  const downloads = {};
  for (const id of ['pmaExportCsvBtn', 'pmaExportJsonBtn', 'pmaExportJson', 'pmaExportCsv', 'pmaExportMeta']) {
    try {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.evaluate(i => document.getElementById(i).click(), id)]);
      // A download names the page it came from; that one address is expected to differ.
      downloads[id] = clean(fs.readFileSync(await dl.path(), 'utf8')).split(BASE + '/' + file).join('<this page>');
    } catch (e) { downloads[id] = 'NO DOWNLOAD'; }
  }
  await ctx.close();
  return { ...snap, drawn, downloads, errors };
}

function diffList(a, b, what, out) {
  const A = a.map(clean), B = b.map(clean);
  if (A.length !== B.length) out.push(what + ': ' + A.length + ' on the old page, ' + B.length + ' on the new');
  for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) { out.push(what + ' #' + i + ': old "' + A[i].slice(0, 120) + '" new "' + B[i].slice(0, 120) + '"'); if (out.length > 40) return; }
}

const browser = await chromium.launch();
const report = { base: BASE, ran: new Date().toISOString(), runs: [] };
let failed = 0;
for (const site of SITES) {
  for (const input of INPUTS) {
    if (ONLY && site.name.indexOf(ONLY) < 0) continue;
    const o = await runPage(browser, OLD, site, input), n = await runPage(browser, NEW, site, input);
    const diffs = [];
    ['result', 'scenarios', 'benchmark'].forEach(k => { if (clean(o[k]) !== clean(n[k])) diffs.push('engine ' + k + ' differs'); });
    diffList(o.text, n.text, 'words in main', diffs);
    if (clean(o.whole) !== clean(n.whole)) {
      const a = clean(o.whole), b = clean(n.whole); let i = 0; while (i < a.length && a[i] === b[i]) i++;
      diffs.push('all words in main differ at: old "' + a.slice(Math.max(0, i - 40), i + 80) + '" new "' + b.slice(Math.max(0, i - 40), i + 80) + '"');
    }
    if (o.glossary > 0 && n.glossary === 0) diffs.push('glossary pop-ups: ' + o.glossary + ' on the old page, none on the new');
    diffList(o.fields, n.fields, 'field', diffs);
    diffList(o.tables.map(t => t.join(' // ')), n.tables.map(t => t.join(' // ')), 'table', diffs);
    if (JSON.stringify(o.charts) !== JSON.stringify(n.charts)) diffs.push('chart data differs');
    { const d = drawnDiff(o.drawn, n.drawn); if (d) diffs.push(d); }
    Object.keys(o.downloads).forEach(k => {
      if (o.downloads[k] === n.downloads[k]) return;
      const a = o.downloads[k].split(/(?<=,|\n|\})/), b = n.downloads[k].split(/(?<=,|\n|\})/);
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      diffs.push('download ' + k + ' differs at "' + String(a[i]).slice(0, 80) + '" / "' + String(b[i]).slice(0, 80) + '"');
    });
    Object.keys(o.counts).forEach(k => { if (o.counts[k] !== n.counts[k]) diffs.push('count of ' + k + ': old ' + o.counts[k] + ', new ' + n.counts[k]); });
    if (n.errors.length) diffs.push('page errors on the new page: ' + n.errors.join(' ; '));
    const numbers = o.whole.match(/\d[\d,.]*/g) || [];
    const row = { site: site.name, inputs: input.label, score: JSON.parse(o.result).pma_score ?? JSON.parse(o.result).score ?? null,
      compared: { words: o.whole.split(' ').length, blocks: o.text.length, glossaryOld: o.glossary, glossaryNew: n.glossary, numbers: numbers.length, fields: o.fields.length, elements: o.drawn.elements, notDrawn: o.drawn.hidden.reduce((t, x) => t + Number(x.split(' x').pop()), 0), tables: o.tables.length, tableRows: o.tables.reduce((s, t) => s + t.length, 0), charts: o.charts.length,
        downloads: Object.values(o.downloads).filter(d => d !== 'NO DOWNLOAD').length, ...o.counts }, diffs };
    report.runs.push(row);
    failed += diffs.length ? 1 : 0;
    console.log((diffs.length ? 'DIFFERS ' : 'same    ') + site.name + ' · ' + input.label + ' · ' + row.compared.words + ' words, ' + row.compared.numbers + ' numbers, ' + row.compared.fields + ' fields, ' + row.compared.tableRows + ' table rows, ' + row.compared.charts + ' charts, ' + row.compared.downloads + ' downloads, ' + row.compared.elements + ' elements (' + row.compared.notDrawn + ' not drawn)');
    diffs.slice(0, 12).forEach(d => console.log('   ' + d));
  }
}
await browser.close();
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(failed ? failed + ' of ' + report.runs.length + ' runs differ' : 'all ' + report.runs.length + ' runs match');
process.exit(failed ? 1 : 0);
