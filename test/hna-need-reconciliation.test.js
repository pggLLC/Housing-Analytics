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
// Since 2026-10-20 the figure used is resident growth plus homes for a quarter
// of today's lower- and middle-wage in-commuters, so two rows make it up and
// the jobs reading is shown beside it, never in it.
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

  await test('the rows marked as the figure used are the parts its basis names, and they add up to it', async () => {
    const marked = [...r.host.querySelectorAll('[data-recon-key][data-in-figure="true"]')];
    const want = r.rec.used.basis === 'resident_growth_plus_incommuters' ? ['growth', 'incommuter']
      : r.rec.used.basis === 'resident_growth' ? ['growth'] : [];
    assert(want.length, `basis ${r.rec.used.basis}: Fruita has a figure, so this test has nothing to check`);
    assert.deepStrictEqual(marked.map((x) => x.dataset.reconKey), want, `basis ${r.rec.used.basis}`);
    const sum = marked.reduce((t, x) => t + Number(x.dataset.units), 0);
    const used = Number(r.host.querySelector('.hna-recon-used').dataset.units);
    assert(Math.abs(sum - used) <= 1, `the marked rows add to ${sum}; the figure used is ${used}`);
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
    assert.strictEqual(onScreen.length, 5, `expected 5 measures on screen, found ${onScreen.length}`);
    for (const tr of onScreen) {
      const label = tr.querySelector('.hna-recon-label').textContent;
      const x = ws.rows.find((o) => o.m === label);
      assert(x, `the sheet has no row for "${label}"`);
      const want = tr.dataset.units === '' ? null : Number(tr.dataset.units);
      assert.strictEqual(x.h, want, `"${label}": sheet ${JSON.stringify(x.h)}, screen ${want}`);
      assert.strictEqual(x.u, tr.dataset.inFigure === 'true' ? 'Yes' : 'No', `"${label}": figure-used flag differs`);
    }
    const wr = ws.rows.find((o) => /^Figure used plus homes lost/.test(o.m || ''));
    assert(wr && wr.h === Math.round(r.rec.withReplacement.units), 'the sheet\'s figure-plus-replacement differs from the screen');
    const used = ws.rows.find((o) => /^Figure used( \(|$)/.test(o.m || ''));
    assert(used && used.h === Math.round(r.rec.used.units), 'the sheet\'s figure used differs from the screen');
  });

  await test('homes lost to age equal the projection the growth reading came from, and are kept out of the figure used', async () => {
    const places = JSON.parse(read('data/hna/projections/places.json'));
    const ledger = (places.places || places)[FRUITA];
    const endYear = Number(r.rec.endYear);
    const fromLedger = r.rec.rows.find((x) => x.key === 'growth').counts.includes('place projection');
    const src = fromLedger
      ? ledger.replacement_cumulative[ledger.years.indexOf(endYear)]
      : r.proj.housing_need.replacement.cumulative_units[r.proj.years.indexOf(endYear)];
    assert(Number.isFinite(src) && src > 0, `the source has no positive replacement figure for ${endYear}; nothing to check`);
    const row = r.row('replacement');
    assert(row, 'the block has no replacement row');
    assert.strictEqual(Number(row.dataset.units), Math.round(src), `row ${row.dataset.units} ≠ source ${src}`);
    assert.notStrictEqual(row.dataset.inFigure, 'true', 'replacement is marked as part of the figure used');
    const tile = intOf(document.getElementById('statUnitsNeed').textContent);
    assert.strictEqual(tile, Math.round(r.rec.used.units), 'adding the replacement row moved the headline tile');
    const wr = r.host.querySelector('.hna-recon-with-replacement');
    assert(wr, 'no line adds replacement to the figure used');
    assert.strictEqual(Number(wr.dataset.units), Math.round(r.rec.used.units + src), 'figure used + replacement does not add up');
  });

  await test('a county reads its own projection file; a place without a ledger gets a reason, not a scaled county figure', async () => {
    const county = await render({ geoType: 'county', geoid: '08077', label: 'Mesa County',
      profile: { DP02_0001E: 64000, DP04_0001E: 70000, DP05_0001E: 160000 } }, '08077');
    const endYear = Number(county.rec.endYear);
    const want = county.proj.housing_need.replacement.cumulative_units[county.proj.years.indexOf(endYear)];
    assert.strictEqual(Number(county.row('replacement').dataset.units), Math.round(want), 'county replacement row ≠ its projection file');
    const build = window.HNAController.buildNeedReconciliation;
    const none = build({ endYear: 2044, usedUnits: 500, basis: 'resident_growth', growthUnits: 500, replacementUnits: null, replacementUnavailable: 'why' });
    const row = none.rows.find((x) => x.key === 'replacement');
    assert.strictEqual(row.units, null, `an absent replacement became ${row.units}`);
    assert.strictEqual(row.unavailable, 'why', 'the absent replacement does not carry its reason');
    assert.strictEqual(none.withReplacement, null, 'a total was formed with an unknown replacement');
  });

  await test('Colorado\'s replacement row is the sum of the 64 county projections, not unavailable', async () => {
    const co = await render({ geoType: 'state', geoid: '08', label: 'Colorado',
      profile: { DP02_0001E: 2300000, DP04_0001E: 2600000, DP05_0001E: 5900000 } }, '08');
    const endYear = Number(co.rec.endYear);
    const files = fs.readdirSync(path.join(ROOT, 'data/hna/projections')).filter((f) => /^08\d{3}\.json$/.test(f));
    assert.strictEqual(files.length, 64, `${files.length} county projection files; the sum needs all 64`);
    const want = files.reduce((s, f) => {
      const p = JSON.parse(read('data/hna/projections/' + f));
      return s + p.housing_need.replacement.cumulative_units[p.years.indexOf(endYear)];
    }, 0);
    assert(want > 0, `the counties sum to ${want} for ${endYear}; nothing to check`);
    const row = co.row('replacement');
    assert(row, 'Colorado has no replacement row');
    assert.strictEqual(Number(row.dataset.units), Math.round(want), `Colorado row ${row.dataset.units} ≠ county sum ${Math.round(want)}`);
  });

  await test('Colorado\'s in-commuter row counts only out-of-state commuters, summed over the 64 counties', async () => {
    const co = await render({ geoType: 'state', geoid: '08', label: 'Colorado',
      profile: { DP02_0001E: 2300000, DP04_0001E: 2600000, DP05_0001E: 5900000 } }, '08');
    const wn = JSON.parse(read('data/hna/workforce-need.json'));
    const ids = Object.keys(wn.counties).filter((k) => /^08\d{3}$/.test(k));
    assert.strictEqual(ids.length, 64, `${ids.length} county records; the sum needs all 64`);
    const homes = ids.reduce((s, k) => s + wn.counties[k].out_of_state_low_middle_wage / wn.counties[k].workers_per_working_household, 0);
    const all = ids.reduce((s, k) => s + wn.counties[k].present_incommuter_need.move_closer_25, 0);
    assert(homes > 0, 'no out-of-state commuters in the county records; nothing to check');
    const row = co.row('incommuter');
    assert(row, 'Colorado has no in-commuter row');
    assert.strictEqual(Number(row.dataset.units), Math.round(homes * 0.25), `Colorado row ${row.dataset.units} ≠ out-of-state 25% ${Math.round(homes * 0.25)}`);
    assert(Number(row.dataset.units) < all, 'Colorado counts commuters between its own counties as needing extra homes');
    assert(row.textContent.includes(Math.round(homes * 0.5).toLocaleString('en-US')), 'the 50% scenario is not stated');
  });

  await test('a Colorado load that finishes after a later county selection does not overwrite it', async () => {
    const dom = new JSDOM(page(), { url: 'http://127.0.0.1/housing-needs-assessment.html' });
    install(dom);
    const f = window.fetch;
    // Hold the 64 county projection reads the Colorado call waits on.
    let release;
    const held = new Promise((res) => { release = res; });
    window.fetch = async (u) => (/projections\/08\d{3}\.json/.test(String(u)) ? held.then(() => f(u)) : f(u));
    global.fetch = window.fetch;
    const co = { geoType: 'state', geoid: '08', label: 'Colorado', profile: { DP02_0001E: 2300000, DP04_0001E: 2600000, DP05_0001E: 5900000 } };
    const mesa = { geoType: 'county', geoid: '08077', label: 'Mesa County', profile: { DP02_0001E: 64000, DP04_0001E: 70000, DP05_0001E: 160000 } };
    const first = window.HNAController.applyAssumptions(JSON.parse(read('data/hna/projections/08.json')), co);
    await window.HNAController.applyAssumptions(JSON.parse(read('data/hna/projections/08077.json')), mesa);
    const mesaRec = window.HNAState.state.needReconciliation;
    assert(mesaRec, 'Mesa built no reconciliation');
    release();
    await first;
    assert.strictEqual(window.HNAState.state.needReconciliation, mesaRec, 'the earlier Colorado call overwrote the Mesa reconciliation');
  });

  await test('a Colorado load that finishes after a combined-area selection leaves the block cleared', async () => {
    const dom = new JSDOM(page(), { url: 'http://127.0.0.1/housing-needs-assessment.html' });
    install(dom);
    const f = window.fetch;
    let release;
    const held = new Promise((res) => { release = res; });
    window.fetch = async (u) => (/projections\/08\d{3}\.json/.test(String(u)) ? held.then(() => f(u)) : f(u));
    global.fetch = window.fetch;
    const co = { geoType: 'state', geoid: '08', label: 'Colorado', profile: { DP02_0001E: 2300000, DP04_0001E: 2600000, DP05_0001E: 5900000 } };
    const first = window.HNAController.applyAssumptions(JSON.parse(read('data/hna/projections/08.json')), co);
    await window.HNAController.applyAssumptions(JSON.parse(read('data/hna/projections/08077.json')),
      { geoType: 'combined', geoid: 'combined', label: 'Two places', members: [] });
    assert.strictEqual(window.HNAState.state.needReconciliation, null, 'the combined-area call did not clear the block');
    release();
    await first;
    assert.strictEqual(window.HNAState.state.needReconciliation, null, 'the earlier Colorado call refilled the block for a combined area');
  });

  await test('a horizon past the projection reads replacement at the year the page actually shows', async () => {
    const dom = new JSDOM(page(), { url: 'http://127.0.0.1/housing-needs-assessment.html' });
    install(dom);
    const ga = window.HNARenderers.getAssumptions;
    window.HNARenderers.getAssumptions = () => Object.assign({}, ga(), { horizon: 30 });
    window.HNAState.state.currentSelection = { geoType: 'county', geoid: '08077', label: 'Mesa County',
      profile: { DP02_0001E: 64000, DP04_0001E: 70000, DP05_0001E: 160000 } };
    const proj = JSON.parse(read('data/hna/projections/08077.json'));
    assert(proj.years.at(-1) < proj.baseYear + 30, 'the projection reaches 30 years; this test has nothing to check');
    await window.HNAController.applyAssumptions(proj, window.HNAState.state.currentSelection);
    const rec = window.HNAState.state.needReconciliation;
    const endYear = Number(rec.endYear);
    assert.strictEqual(endYear, proj.years.at(-1), `the page shows ${endYear}, not the projection's last year`);
    const row = document.querySelector('#hnaNeedReconciliation [data-recon-key="replacement"]');
    const want = proj.housing_need.replacement.cumulative_units[proj.years.indexOf(endYear)];
    assert.strictEqual(Number(row.dataset.units), Math.round(want), `replacement row ${row.dataset.units} at a 30-year horizon; want ${Math.round(want)} for ${endYear}`);
  });

  await test('the in-commuter line equals workforce-need.json and is in the figure used as its quarter', async () => {
    const wn = JSON.parse(read('data/hna/workforce-need.json'));
    const rec = wn.places[FRUITA];
    assert(rec && rec.present_incommuter_need, 'Fruita has no in-commuter record; nothing to check');
    const row = r.row('incommuter');
    assert(row, 'the block has no in-commuter row');
    assert.strictEqual(Number(row.dataset.units), rec.present_incommuter_need.move_closer_25, 'row ≠ the 25% scenario');
    assert(row.textContent.includes(rec.present_incommuter_need.move_closer_50.toLocaleString('en-US')), 'the 50% scenario is not stated');
    assert.strictEqual(r.rec.used.basis, 'resident_growth_plus_incommuters', `Fruita has an in-commuter record but basis ${r.rec.used.basis}`);
    assert.strictEqual(row.dataset.inFigure, 'true', 'the in-commuter quarter is not marked as part of the figure used');
    assert.notStrictEqual(r.row('workforce').dataset.inFigure, 'true', 'the jobs reading is marked as part of the figure used');
    assert(r.rec.used.why.includes(Math.round(metric(d, 'future_units_growth_20yr') + rec.present_incommuter_need.move_closer_50).toLocaleString('en-US')),
      'the explanation does not give the figure if half moved closer');
    // Households, not jobs: the line must be smaller than in-commuters x wage share.
    const per = rec.incommuters * rec.low_middle_wage_share;
    assert(rec.present_incommuter_need.move_closer_50 < per, 'the 50% line is not below the in-commuting low/middle-wage workers it divides');
    const none = window.HNAController.buildNeedReconciliation({ endYear: 2044, usedUnits: 5, basis: 'resident_growth', growthUnits: 5,
      incommuter: { low: null, high: null, reason: 'why' } });
    const nr = none.rows.find((x) => x.key === 'incommuter');
    assert.strictEqual(nr.units, null, 'an absent in-commuter need became a number');
    assert.strictEqual(nr.unavailable, 'why', 'the absent in-commuter need does not carry its reason');
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

  await test('a missing part is never described as part of the figure used', async () => {
    // Codex review of #1890: an explanation must not lean on a value that does
    // not exist. Held as structure: with no in-commuter record the figure is
    // growth alone and says so; with no growth there is no figure, and neither
    // part is marked as in it. The retired jobs basis is not accepted.
    const build = window.HNAController.buildNeedReconciliation;
    const inc = { low: 600, high: 1200 };
    const plus = build({ endYear: 2044, usedUnits: 900, basis: 'resident_growth_plus_incommuters', growthUnits: 300, incommuter: inc, workforceUnits: 2000 });
    const gOnly = build({ endYear: 2044, usedUnits: 300, basis: 'resident_growth', growthUnits: 300, incommuter: { low: null, high: null, reason: 'why' }, workforceUnits: 2000 });
    const none = build({ endYear: 2044, usedUnits: null, basis: null, growthUnits: null, incommuter: inc, workforceUnits: 2000 });
    const inFig = (rec) => rec.rows.filter((x) => x.inFigure).map((x) => x.key);
    assert.deepStrictEqual(inFig(plus), ['growth', 'incommuter']);
    assert.deepStrictEqual(inFig(gOnly), ['growth'], 'with no in-commuter record, the in-commuter row is still marked');
    assert.notStrictEqual(gOnly.used.why, plus.used.why, 'with no in-commuter record, the explanation still adds them');
    assert(!/\bplus\b/i.test(gOnly.used.why), `"${gOnly.used.why}" adds a part that does not exist`);
    assert.deepStrictEqual(inFig(none), [], 'with no growth reading, a part is still marked as in a figure that does not exist');
    assert(none.rows.find((x) => x.key === 'growth').unavailable, 'the missing growth reading does not say it is unavailable');
    assert.strictEqual(build({ endYear: 2044, usedUnits: 2000, basis: 'workforce', growthUnits: 300, workforceUnits: 2000 }).used.basis, null,
      'the retired jobs reading is still accepted as a basis');
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
