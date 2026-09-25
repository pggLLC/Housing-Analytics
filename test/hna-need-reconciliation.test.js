'use strict';

// The HNA says how its need figures fit together (audit F4).
//
// Found 2026-09-24: Fruita's HNA showed 103, ~722, +635, 819 and 2,302 and
// reconciled none of them. 2,302 is the workforce reading, used because it is
// the larger of two readings; 819 is the resident-growth reading it beat; 103
// is today's rental shortfall at <=30% AMI; +635 is the households chart. The
// permit note compared 142 permits a year against 2,302 / 20 and called that
// "growth-driven need only".
//
// Held as agreement, not wording. Rendered by the real applyAssumptions:
//   - the block's figure used equals the tile, and its basis the tile's;
//   - each row equals the source the page reads it from (digest, permits.json);
//   - the households line equals the households chart's own series;
//   - the permit pace and ratio equal the production-vs-need cells;
//   - the permit note calls the need growth-driven only when it is;
//   - the Excel sheet carries the same numbers, as numbers;
//   - an absent input reads as unavailable, never 0.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const digest = (geoid) => JSON.parse(read(`data/hna/jurisdiction-metrics-digest/${geoid}.json`));
const metric = (d, k) => { const m = d.metrics && d.metrics[k]; return m && typeof m === 'object' ? m.value : m; };
const intOf = (text) => Number(String(text).replace(/[^0-9.-]/g, ''));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

function freshRequire(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function page() {
  // The housing-need summary as the page ships it, so every element the
  // controller writes is the page's own.
  const html = read('housing-needs-assessment.html');
  const card = html.match(/<h2>Housing need summary<\/h2>[\s\S]*?<div id="hnaNeedReconciliation"[^>]*><\/div>/);
  assert(card, 'the housing-need summary (through #hnaNeedReconciliation) could not be found in housing-needs-assessment.html');
  return `<!doctype html><html><body>
    <select id="geoType"><option value="place" selected>Place</option></select>
    <select id="geoSelect"><option value="0828745" selected>Fruita</option></select>
    <input type="radio" name="headship" value="current" checked>
    <div class="chart-box"><canvas id="chartProjectedHH"></canvas></div>
    ${card[0]}
  </body></html>`;
}

function install(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.URLSearchParams = dom.window.URLSearchParams;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.Blob = dom.window.Blob;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  const add = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = (type, l, o) => (type === 'DOMContentLoaded' ? undefined : add(type, l, o));
  // Keep each chart's config, so the households line can be held to the
  // chart's own series.
  global.Chart = class { constructor(ctx, config) { this.config = config; this.data = config && config.data; } destroy() {} };
  window.Chart = global.Chart;
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  window.APP_CONFIG = { DATA_VERSION: 'test' };
  window.fetch = async (url) => {
    const rel = String(url).replace(/^\.?\//, '').split('?')[0];
    const abs = path.join(ROOT, rel);
    if (!rel.startsWith('data/') || !fs.existsSync(abs)) return { ok: false, status: 404, text: async () => '', json: async () => null };
    const body = fs.readFileSync(abs, 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  global.fetch = window.fetch;
  window.fetchWithTimeout = (u) => window.fetch(u);
  global.fetchWithTimeout = window.fetchWithTimeout;
  freshRequire('js/hna/hna-utils.js');
  freshRequire('js/hna/hna-renderers.js');
  freshRequire('js/hna/hna-controller.js');
}

async function render(selection, countyFips) {
  const dom = new JSDOM(page(), { url: 'http://127.0.0.1/housing-needs-assessment.html' });
  install(dom);
  window.HNAState.state.currentSelection = selection;
  const proj = JSON.parse(read(`data/hna/projections/${countyFips}.json`));
  await window.HNAController.applyAssumptions(proj, selection);
  const host = document.getElementById('hnaNeedReconciliation');
  const row = (key) => host.querySelector(`[data-recon-key="${key}"]`);
  return { dom, proj, host, row, rec: window.HNAState.state.needReconciliation };
}

(async () => {
  console.log('\nThe HNA says how its need figures fit together');

  const FRUITA = '0828745';
  const d = digest(FRUITA);
  const permits = JSON.parse(read('data/hna/permits.json'));
  const sel = { geoType: 'place', geoid: FRUITA, label: 'Fruita', contextCounty: '08077',
    profile: { DP02_0001E: 5807, DP04_0001E: 6100, DP05_0001E: 14000 } };
  const r = await render(sel, '08077');

  await test('the block is rendered and names a figure used equal to the tile, with the tile\'s basis', async () => {
    assert(r.rec, 'no reconciliation was built');
    assert.strictEqual(r.host.hidden, false, 'the block is hidden');
    const used = r.host.querySelector('.hna-recon-used');
    assert(used, 'the block states no figure used');
    const tile = document.getElementById('statUnitsNeed').textContent;
    assert.strictEqual(Number(used.dataset.units), intOf(tile), `block uses ${used.dataset.units}; the tile shows ${tile}`);
    assert.strictEqual(used.dataset.basis, document.getElementById('statUnitsNeedBasis').dataset.basis,
      'the block and the tile declare different bases');
  });

  await test('the row marked as the figure used is the reading the tile shows, and only one is marked', async () => {
    const marked = [...r.host.querySelectorAll('[data-recon-key][data-in-figure="true"]')];
    assert.strictEqual(marked.length, 1, `${marked.length} rows are marked as the figure used`);
    const want = r.rec.used.basis === 'workforce' ? 'workforce' : 'growth';
    assert.strictEqual(marked[0].dataset.reconKey, want, `the ${marked[0].dataset.reconKey} row is marked; the basis is ${r.rec.used.basis}`);
    assert.strictEqual(marked[0].dataset.units, r.host.querySelector('.hna-recon-used').dataset.units,
      'the marked row and the figure used disagree');
  });

  await test('each row equals the source the page reads it from', async () => {
    assert.strictEqual(Number(r.row('existing').dataset.units), metric(d, 'housing_gap_units'), 'existing shortfall ≠ digest housing_gap_units');
    assert.strictEqual(Number(r.row('workforce').dataset.units), metric(d, 'workforce_gap_units'), 'workforce row ≠ digest workforce_gap_units');
    // The digest records the 20-year growth reading; the page's default horizon is 20.
    assert.strictEqual(Number(r.row('growth').dataset.units), metric(d, 'future_units_growth_20yr'), 'growth row ≠ digest future_units_growth_20yr');
  });

  await test('the households line is the households chart\'s own change over the same years', async () => {
    const chart = window.HNAState.charts && window.HNAState.charts.chartProjectedHH;
    assert(chart && chart.data, 'the households chart was not drawn');
    const labels = chart.data.labels.map(Number);
    const series = chart.data.datasets[0].data;
    const end = labels.indexOf(Number(r.rec.endYear));
    const base = labels.indexOf(Number(r.proj.baseYear));
    assert(base >= 0, `the chart has no base year ${r.proj.baseYear}`);
    assert(end >= 0, `the chart has no ${r.rec.endYear}`);
    const delta = Math.round(series[end] - series[base]);
    const line = r.host.querySelector('.hna-recon-households');
    assert(line, 'the block has no households line');
    assert.strictEqual(Number(line.dataset.delta), delta, `block says ${line.dataset.delta} households; the chart moves ${delta}`);
  });

  await test('the permit pace and ratio are the production-vs-need cells, and the pace is the BPS average', async () => {
    const rec = permits.places[FRUITA];
    assert(rec && rec.avg_annual_total_5yr, 'Fruita has no BPS record to compare against');
    const pace = r.host.querySelector('.hna-recon-permits');
    assert.strictEqual(Number(pace.dataset.perYear), Math.round(rec.avg_annual_total_5yr.value), 'block pace ≠ permits.json 5-yr average');
    assert.strictEqual(document.getElementById('statPermitsAvg').textContent.replace(/[^0-9]/g, ''), pace.dataset.perYear,
      'block pace ≠ the Recent production cell');
    const cell = document.getElementById('statProdNeedRatio').textContent;
    assert.strictEqual(cell, r.rec.permits.ratio.toFixed(2) + '×', `block ratio ${r.rec.permits.ratio} ≠ the Production ÷ need cell ${cell}`);
    const span = Number(r.rec.endYear) - Number(r.proj.baseYear);
    assert(Math.abs(r.rec.permits.neededPerYear * span - r.rec.used.units) < 1,
      'the needed-per-year figure is not the figure used spread over the horizon');
  });

  await test('the permit note calls the need growth-driven only when resident growth is the reading', async () => {
    const note = document.getElementById('permitsVsNeedNote').textContent;
    const saysGrowthOnly = /growth-driven need only/i.test(note);
    assert.strictEqual(saysGrowthOnly, r.rec.used.basis === 'resident_growth',
      `basis ${r.rec.used.basis}, and the note ${saysGrowthOnly ? 'says' : 'does not say'} growth-driven only`);
  });

  await test('the Excel workbook carries the block\'s numbers, as numbers', async () => {
    const sheets = {};
    global.ExcelJS = window.ExcelJS = { Workbook: class {
      addWorksheet(name) {
        const rows = [];
        const ws = { name, rows, columns: [], addRow: (o) => { rows.push(o); return { font: {} }; },
          getRow: () => ({ font: {}, fill: {}, values: [] }), getColumn: () => ({}), getCell: () => ({ font: {} }), addChart: () => {} };
        sheets[name] = ws; return ws;
      }
      get xlsx() { return { writeBuffer: async () => new ArrayBuffer(0) }; }
    } };
    const realURL = global.URL;
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    const warned = [];
    const realWarn = console.warn;
    console.warn = (...a) => warned.push(a.map(String).join(' '));
    try {
      freshRequire('js/hna/hna-export.js');
      await window.__HNA_exportExcel({ snapshot: {} }, 'x.xlsx');
    } finally { console.warn = realWarn; global.URL = realURL; }
    assert(!warned.some((w) => /export failed/i.test(w)), 'the export did not complete: ' + warned.join(' | '));
    const ws = sheets['Need reconciliation'];
    assert(ws, 'the workbook has no Need reconciliation sheet');
    const onScreen = [...r.host.querySelectorAll('[data-recon-key]')];
    assert.strictEqual(onScreen.length, 3, `expected 3 measures on screen, found ${onScreen.length}`);
    for (const tr of onScreen) {
      const label = tr.querySelector('.hna-recon-label').textContent;
      const x = ws.rows.find((o) => o.m === label);
      assert(x, `the sheet has no row for "${label}"`);
      const want = tr.dataset.units === '' ? null : Number(tr.dataset.units);
      assert.strictEqual(x.h, want, `"${label}": sheet ${JSON.stringify(x.h)}, screen ${want}`);
      assert.strictEqual(x.u, tr.dataset.inFigure === 'true' ? 'Yes' : 'No', `"${label}": figure-used flag differs`);
    }
    const used = ws.rows.find((o) => /^Figure used/.test(o.m || ''));
    assert(used && used.h === r.rec.used.units, 'the sheet\'s figure used differs from the screen');
  });

  await test('an absent input reads as unavailable, never 0', async () => {
    const rec = window.HNAController.buildNeedReconciliation({
      endYear: 2044, usedUnits: 500, basis: 'resident_growth', growthUnits: 500,
      workforceUnits: null, existingGapUnits: undefined, chartHouseholdsDelta: null, permits: null,
    });
    for (const k of ['existing', 'workforce']) {
      const row = rec.rows.find((x) => x.key === k);
      assert.strictEqual(row.units, null, `${k} became ${row.units}`);
      assert(row.unavailable, `${k} is absent but gives no reason`);
    }
    assert.strictEqual(rec.permits.perYear, null, 'an absent permit pace became a number');
    assert(rec.permits.unavailable, 'an absent permit pace gives no reason');
    assert.strictEqual(rec.households, null, 'an absent households delta was reported');
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
