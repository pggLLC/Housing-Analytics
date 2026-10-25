'use strict';
// Runtime contract: the source file's subset/vintage survives through the
// dashboard, CSV, PMA runner, restored UI, narrative and audit JSON. Sample
// zeros are legitimate; total preservation risk is never inferred from them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const snapshot = JSON.parse(read('data/market/nhpd_co.geojson'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

function context(modules) {
  const win = { console, Date, setTimeout, clearTimeout };
  win.window = win;
  vm.createContext(win);
  for (const p of modules) vm.runInContext(read(p), win, { filename: p });
  return win;
}
const marketModules = ['js/data-connectors/nhpd.js', 'js/pma-competitive-set.js',
  'js/pma-justification.js', 'js/pma-analysis-runner.js'];
function run(win, lat = 39.7392, lon = -104.9903) {
  return new Promise((resolve, reject) => win.PMAAnalysisRunner.run(lat, lon,
    { method: 'buffer', bufferMiles: 5, proposedUnits: 100 }).on('complete', resolve).on('error', reject));
}

// preservation.html shows CHFA's preservation-map inventory, not the NHPD
// stub. These tests drive the real page and module in jsdom.
const chfa = JSON.parse(read('data/affordable-housing/preservation/chfa-preservation.json'));
async function dashboard({ data = chfa, cached = false, fail = false, counties = true } = {}) {
  const dom = new JSDOM(read('preservation.html'), { url: 'https://cohoanalytics.com/preservation.html', runScripts: 'outside-only' });
  const win = dom.window;
  win.requestAnimationFrame = fn => fn();
  let csv, filename, chart;
  win.CacheManager = class { get() { return cached ? data : null; } set() {} };
  win.DataService = { baseData: p => p, getGeoJSON: () => fail ? Promise.reject(new Error('offline')) : Promise.resolve(data),
    getJSON: () => Promise.resolve(JSON.parse(read('data/co-county-boundaries.json'))) };
  win.HTMLCanvasElement.prototype.getContext = () => ({});
  win.Chart = class { constructor(_, config) { chart = config; } destroy() {} };
  win.Blob = class { constructor(parts) { csv = parts.join(''); } };
  win.URL.createObjectURL = () => 'blob:test';
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  const mods = counties ? ['js/county-from-coords.js', 'js/preservation.js'] : ['js/preservation.js'];
  for (const p of mods) win.eval(read(p));
  for (let i = 0; i < 5; i++) await tick();
  return { dom, win, chart: () => chart, csv: () => csv, filename: () => filename };
}

test('preservation dashboard cards, chart and table agree with the CHFA inventory', async () => {
  for (const cached of [false, true]) {
    const d = await dashboard({ cached });
    const doc = d.win.document;
    const n = chfa.features.length;
    const units = chfa.features.reduce((s, f) => s + (f.properties.N_UNITS > 0 ? f.properties.N_UNITS : 0), 0);
    const unknown = chfa.features.filter(f => !(f.properties.N_UNITS > 0)).length;
    assert.equal(Number(doc.getElementById('presKpiTotal').textContent.replaceAll(',', '')), n);
    assert.equal(Number(doc.getElementById('presKpiUnits').textContent.replaceAll(',', '')), units);
    assert.equal(Number(doc.getElementById('presKpiUnknownUnits').textContent.replaceAll(',', '')), unknown);
    assert.ok(Number(doc.getElementById('presKpiCounties').textContent) > 40, 'statewide coverage across counties');
    assert.match(doc.getElementById('presCoverage').textContent, new RegExp(n.toLocaleString() + ' properties listed on the CHFA preservation map'));
    assert.equal(doc.querySelectorAll('#presTableBody tr').length, n);
    const chart = d.chart();
    assert.equal(chart.data.labels.length, 12);
    assert.equal(chart.data.labels[0], 'Denver');
    assert.doesNotMatch(doc.body.textContent, /stub|snapshot|Pueblo Downtown Affordable/i);
    d.dom.window.close();
  }
});

test('filtered CSV carries the CHFA source and limitation on every row', async () => {
  const d = await dashboard();
  const doc = d.win.document;
  const sel = doc.getElementById('presFilterCounty');
  sel.value = 'Mesa';
  sel.dispatchEvent(new d.win.Event('change'));
  const shown = Number(doc.getElementById('presKpiTotal').textContent);
  assert.ok(shown > 0);
  const rows = d.win.PreservationDashboard.getRows().filter(r => r.county === 'Mesa');
  assert.equal(shown, rows.length);
  doc.getElementById('presExportBtn').click();
  const lines = d.csv().split('\n');
  assert.equal(lines.length, rows.length + 1);
  for (const line of lines.slice(1)) {
    assert.match(line, /Colorado Housing and Finance Authority \(CHFA\) preservation map/);
    assert.match(line, /no subsidy type or expiration date/);
  }
  assert.equal(d.filename(), 'chfa-preservation-inventory.csv');
  doc.getElementById('presSearch').value = 'no-such-property';
  doc.getElementById('presSearch').dispatchEvent(new d.win.Event('input'));
  assert.equal(doc.getElementById('presKpiTotal').textContent, '0');
  assert.match(doc.getElementById('presTableBody').textContent, /may still carry affordability restrictions/);
  assert.ok(doc.getElementById('presExportBtn').disabled);
  d.dom.window.close();
});

test('missing county boundaries leave counties unassigned, not wrong', async () => {
  const d = await dashboard({ counties: false });
  const rows = d.win.PreservationDashboard.getRows();
  assert.equal(rows.length, chfa.features.length);
  assert.ok(rows.every(r => r.county === ''));
  assert.match(d.win.document.getElementById('presCoverage').textContent, /Not assigned/);
  d.dom.window.close();
});

test('failed or invalid load gives unavailable cards, disabled export and null API totals', async () => {
  for (const opts of [{ fail: true }, { data: {} }]) {
    const d = await dashboard(opts);
    d.win.PreservationDashboard.refresh();
    assert.equal(d.win.PreservationDashboard.getKpis().total, null);
    assert.match(d.win.document.getElementById('presKpiTotal').textContent, /Unavailable/);
    assert.ok(d.win.document.getElementById('presExportBtn').disabled);
    assert.equal(d.chart(), undefined);
    d.dom.window.close();
  }
});

test('unknown source metadata cannot promote a non-stub file to complete coverage', () => {
  const w = context(['js/data-connectors/nhpd.js']);
  w.Nhpd.loadFromGeoJSON({ type: 'FeatureCollection', features: snapshot.features });
  assert.equal(w.Nhpd.getCoverage().status, 'partial');
  assert.equal(w.Nhpd.getCoverage().complete, false);
  assert.equal(w.Nhpd.getCoverage().generated, null);
  assert.match(w.Nhpd.getCoverage().unavailableReason, /unverified vintage/);
});

test('DataService snapshot responses retain coverage even when there are no matches', async () => {
  const w = context(['js/data-connectors/nhpd.js', 'js/data-service-portable.js']);
  const bbox = { minLat: 40.4, maxLat: 40.6, minLon: -108.6, maxLon: -108.4 };
  let result = await w.DataService.fetchHudNhpd(bbox);
  assert.equal(result.coverage.recordCount, null);
  w.Nhpd.loadFromGeoJSON(snapshot);
  result = await w.DataService.fetchHudNhpd(bbox);
  assert.equal(result.properties.length, 0);
  assert.equal(result.coverage.recordCount, snapshot.features.length);
  assert.equal(result.coverage.complete, false);
});

test('page does not load the unverified NHPD stub; runner reports unavailable coverage, no stub names', async () => {
  const w = context(marketModules);
  w.PMAEngine = { _lihtcFeatures: [] };
  let fetched = 0;
  w.DS = { baseData: p => p, getJSON: () => { fetched++; return Promise.resolve(snapshot); } };
  // Execute the actual page's NHPD block. The stub's records (names that
  // match no CHFA, HUD or USDA record) must never reach the competitive set.
  const page = read('js/market-analysis.js');
  const start = page.indexOf('// Load NHPD preservation data');
  const end = page.indexOf('// Load DOLA county demographics', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(page.slice(start, end), /getJSON/);
  vm.runInContext(page.slice(start, end), w);
  assert.ok(w.__nhpdLoadPromise);
  assert.equal(fetched, 0, 'the stub file is not fetched');
  const result = await run(w);
  assert.equal(w.Nhpd.getPropertiesNear(39.7392, -104.9903, 5).length, 0);
  assert.equal(result.competitiveSet.nhpdAssisted, null);
  assert.equal(result.competitiveSet.nhpdCoverage.status, 'unavailable');
  assert.equal(result.absorptionRisk.risk, null);
  assert.equal(result.pmaSupportSummary.sources.nhpd, 'unavailable');
  const names = snapshot.features.map(f => f.properties.property_name);
  const exported = w.PMAJustification.exportToJSON(result);
  for (const n of names) assert.ok(!exported.includes(n), 'stub name not exported: ' + n);
});

test('page load failure clears coverage and runner completes with unknown risk', async () => {
  const w = context(marketModules);
  w.Nhpd.loadFromGeoJSON(snapshot);
  w.DS = { baseData: p => p, getJSON: () => Promise.reject(new Error('offline')) };
  const page = read('js/market-analysis.js');
  const start = page.indexOf('// Load NHPD preservation data');
  const end = page.indexOf('// Load DOLA county demographics', start);
  vm.runInContext(page.slice(start, end), w);
  const result = await run(w);
  assert.equal(result.competitiveSet.nhpdAssisted, null);
  assert.equal(result.absorptionRisk.risk, null);
  assert.equal(result.competitiveSet.nhpdCoverage.status, 'unavailable');
});

test('no nearby matches, unloaded source, empty source and legacy runs never establish no risk', async () => {
  for (const source of [snapshot, null, { type: 'FeatureCollection', features: [] }]) {
    const w = context(marketModules);
    if (source) w.Nhpd.loadFromGeoJSON(source);
    const r = await run(w, 40.5, -108.5);
    assert.equal(r.absorptionRisk.captureRate, null);
    assert.equal(r.absorptionRisk.risk, null);
    assert.equal(r.competitiveSet.preservationRiskTotal, null);
    assert.equal(r.competitiveSet.subsidyExpiryRisk.length, 0);
    assert.match(r.justification.narrative, /unknown/);
    assert.equal(r.competitiveSet.nhpdAssisted, source ? 0 : null);
  }
  const w = context(marketModules);
  assert.match(w.PMAJustification.generateNarrative({ competitiveSet: { subsidyExpiryRisk: [] } }), /risk are unknown/);
  const legacy = { competitiveSet: { subsidyExpiryRisk: [], nhpdAssisted: 0 }, absorptionRisk: {
    risk: 'low', captureRate: 0, totalCompetitiveUnits: 0
  }, _analysisResults: { competitiveSet: {}, absorptionRisk: { risk: 'low', captureRate: 0 } } };
  const exported = JSON.parse(w.PMAJustification.exportToJSON(legacy));
  assert.equal(exported.absorptionRisk.risk, null);
  assert.equal(exported.absorptionRisk.captureRate, null);
  assert.equal(exported._analysisResults.absorptionRisk.risk, null);
  assert.equal(exported.competitiveSet.nhpdCoverage.complete, false);
  assert.equal(exported.competitiveSet.nhpdAssisted, null, 'unknown legacy source count must not survive as zero');
  const internalOnly = JSON.parse(w.PMAJustification.exportToJSON({ competitiveSet: {}, _analysisResults: {
    absorptionRisk: { risk: 'low', captureRate: 0.05, totalCompetitiveUnits: 1900, proposedUnits: 100 }
  } }));
  assert.equal(internalOnly.absorptionRisk.captureRate, 0.05, 'legacy observed ratio must survive');
  assert.equal(internalOnly._analysisResults.absorptionRisk.risk, null);
  const layer = w.PMACompetitiveSet.getCompetitiveSetLayer([{ lat: 39.7, lon: -105, units: 10, atExpiryRisk: null }]);
  assert.equal(layer.features[0].properties.atExpiryRisk, null, 'map layer must not turn unknown expiry into false');
  assert.equal(layer.nhpdCoverage.complete, false);
  w.Nhpd.loadFromGeoJSON(snapshot);
  w.Nhpd.loadFromGeoJSON({});
  assert.equal(w.Nhpd.getCoverage().recordCount, null, 'invalid retry must clear stale source state');
});

test('restored legacy UI exposes unknown coverage instead of hiding risk or claiming low absorption', async () => {
  const dom = new JSDOM(read('market-analysis.html'), { url: 'https://cohoanalytics.com/market-analysis.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(read('js/pma-justification.js'));
  w.eval(read('js/pma-ui-controller.js'));
  const jurisdiction = { geoid: '08031', countyFips: '08031', name: 'Denver' };
  w.WorkflowState = { getJurisdiction: () => jurisdiction };
  w.PMADataCache = { loadLastResult: () => ({ jurisdiction, lat: 39.7392, lon: -104.9903,
    options: { method: 'buffer' }, scoreRun: { competitiveSet: { subsidyExpiryRisk: [] },
      absorptionRisk: { risk: 'low', captureRate: 0, totalCompetitiveUnits: 0, proposedUnits: 100 } } }) };
  await tick();
  w.PMAUIController.restoreLastRun();
  assert.equal(w.document.getElementById('pmaSubsidyRiskWrap').hidden, false);
  assert.match(w.document.getElementById('pmaSubsidyRiskList').textContent, /risk remains unknown/);
  assert.match(w.document.getElementById('pmaAbsorptionRiskBody').textContent, /risk not assessed/);
  assert.doesNotMatch(w.document.getElementById('pmaAbsorptionRiskBody').textContent, /well-absorbed|Low supply/);
  assert.doesNotMatch(w.document.getElementById('pmaAbsorptionRiskBody').textContent, /0\.0%/);
  dom.window.close();
});

(async () => {
  let failed = 0;
  for (const [name, fn] of queue) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
  }
  console.log(`NHPD coverage: ${queue.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
