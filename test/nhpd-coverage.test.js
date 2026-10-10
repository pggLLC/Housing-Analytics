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

async function dashboard({ data = snapshot, cached = false, fail = false } = {}) {
  const dom = new JSDOM(read('preservation.html'), { url: 'https://cohoanalytics.com/preservation.html', runScripts: 'outside-only' });
  const win = dom.window;
  win.requestAnimationFrame = fn => fn();
  let csv, filename, chart;
  win.CacheManager = class { get() { return cached ? data : null; } set() {} };
  win.DataService = { baseData: p => p, getGeoJSON: () => fail ? Promise.reject(new Error('offline')) : Promise.resolve(data) };
  win.HTMLCanvasElement.prototype.getContext = () => ({});
  win.Chart = class { constructor(_, config) { chart = config; } destroy() {} };
  win.Blob = class { constructor(parts) { csv = parts.join(''); } };
  win.URL.createObjectURL = () => 'blob:test';
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  for (const p of ['js/data-connectors/nhpd.js', 'js/preservation.js']) win.eval(read(p));
  await tick();
  return { dom, win, chart, csv: () => csv, filename: () => filename };
}

test('dashboard numbers, labels, chart and timestamp agree with the loaded subset', async () => {
  for (const cached of [false, true]) {
    const d = await dashboard({ cached });
    const doc = d.win.document;
    assert.equal(Number(doc.getElementById('presKpiTotal').textContent), snapshot.features.length);
    assert.equal(Number(doc.getElementById('presKpiUnits').textContent.replaceAll(',', '')),
      snapshot.features.reduce((n, f) => n + f.properties.assisted_units, 0));
    assert.match(doc.getElementById('presCoverage').textContent, new RegExp(snapshot.features.length + ' snapshot records'));
    assert.ok(doc.getElementById('presDataTimestamp').textContent.includes(snapshot.meta.generated.slice(0, 10)));
    assert.equal(doc.querySelector('[data-page-update-key="manifest"], .data-timestamp'), null,
      'site manifest must not claim an NHPD refresh');
    const labels = [...doc.querySelectorAll('.pres-kpi-label')];
    assert.equal(labels.length, 4);
    for (const label of labels) assert.match(label.textContent, /snapshot/i, 'each numeric card needs subset context');
    for (const ds of d.chart.data.datasets) assert.match(ds.label, /snapshot/i);
    const year = new Date().getFullYear();
    d.chart.data.labels.forEach((y, i) => {
      const records = snapshot.features.filter(f => d.win.PreservationDashboard._parseExpiryYear(f.properties.subsidy_expiration) === Number(y));
      assert.equal(d.chart.data.datasets[1].data[i], records.length);
      assert.equal(d.chart.data.datasets[0].data[i], records.reduce((n, f) => n + f.properties.assisted_units, 0));
    });
    assert.equal(Number(d.chart.data.labels[0]), year);
    d.dom.window.close();
  }
});

test('filtered CSV retains original records and source coverage on every exported row', async () => {
  const d = await dashboard();
  const doc = d.win.document;
  doc.getElementById('presFilterCounty').value = 'Denver';
  doc.getElementById('presFilterCounty').dispatchEvent(new d.win.Event('change'));
  const expected = snapshot.features.filter(f => f.properties.county === 'Denver');
  assert.equal(Number(doc.getElementById('presKpiTotal').textContent), expected.length);
  doc.getElementById('presExportBtn').click();
  const lines = d.csv().split('\n');
  assert.equal(lines.length, expected.length + 1);
  for (const f of expected) assert.ok(d.csv().includes(f.properties.nhpd_id + ','));
  for (const line of lines.slice(1)) {
    assert.ok(line.includes(snapshot.meta.generated));
    assert.ok(line.includes(',stub,' + snapshot.features.length + ','));
    assert.match(line, /totals are unknown/);
    assert.match(line, /does not mean no preservation risk/);
  }
  assert.ok(d.filename().includes(snapshot.meta.generated.slice(0, 10)));
  assert.match(d.filename(), /limited-snapshot/);
  doc.getElementById('presFilterCounty').value = '';
  doc.getElementById('presFilterType').value = 'HOME';
  doc.getElementById('presFilterHorizon').value = '3';
  doc.getElementById('presFilterHorizon').dispatchEvent(new d.win.Event('change'));
  const now = Date.now();
  const cutoff = new Date(new Date().getFullYear() + 3, 11, 31).getTime();
  const homeExpiring = snapshot.features.filter(f => {
    const p = f.properties, date = new Date(p.subsidy_expiration).getTime();
    return p.subsidy_type === 'HOME' && date >= now && date <= cutoff;
  });
  assert.equal(Number(doc.getElementById('presKpiTotal').textContent), homeExpiring.length);
  assert.equal(Number(doc.getElementById('presKpiExpiring').textContent), homeExpiring.length);
  doc.getElementById('presSearch').value = 'no-such-property';
  doc.getElementById('presSearch').dispatchEvent(new d.win.Event('input'));
  assert.equal(doc.getElementById('presKpiTotal').textContent, '0', 'zero matching sample records is valid');
  assert.match(doc.getElementById('presTableBody').textContent, /risk remains unknown/);
  assert.ok(doc.getElementById('presExportBtn').disabled, 'empty export cannot lose its coverage disclosure');
  d.dom.window.close();
});

test('failed or invalid load gives unavailable cards, disabled export and null API totals', async () => {
  for (const opts of [{ fail: true }, { data: {} }]) {
    const d = await dashboard(opts);
    d.win.PreservationDashboard.refresh();
    assert.equal(d.win.PreservationDashboard.getKpis().total, null);
    assert.match(d.win.document.getElementById('presKpiTotal').textContent, /Unavailable/);
    assert.ok(d.win.document.getElementById('presExportBtn').disabled);
    assert.equal(d.chart, undefined);
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

test('page loader and runner wait for loading; keep coordinates, expirations and coverage in JSON', async () => {
  const w = context(marketModules);
  w.PMAEngine = { _lihtcFeatures: [] };
  let release;
  const load = new Promise(resolve => { release = () => resolve(snapshot); });
  w.DS = { baseData: p => p, getJSON: () => load };
  // Execute the actual page's narrow source-loading block, not a duplicate
  // loader in the fixture. This catches losing the promise or source metadata.
  const page = read('js/market-analysis.js');
  const start = page.indexOf('// Load NHPD preservation data');
  const end = page.indexOf('// Load DOLA county demographics', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(page.slice(start, end), w);
  assert.ok(w.__nhpdLoadPromise);
  let completed = false;
  const pending = run(w).then(r => { completed = true; return r; });
  await tick();
  assert.equal(completed, false, 'competitive analysis must wait for its in-flight source load');
  release();
  const result = await pending;
  const nearby = w.Nhpd.getPropertiesNear(39.7392, -104.9903, 5);
  assert.ok(nearby.length > 0);
  assert.equal(result.competitiveSet.nhpdAssisted, nearby.length, 'flattening must not drop geometry');
  assert.ok(result.competitiveSet.subsidyExpiryRisk.length > 0, 'known expirations must survive');
  assert.equal(result.absorptionRisk.risk, null, 'stub cannot establish absorption risk');
  const observedUnits = nearby.reduce((sum, p) => sum + p.total_units, 0);
  assert.equal(result.absorptionRisk.totalCompetitiveUnits, observedUnits);
  assert.equal(result.absorptionRisk.captureRate, Math.round(100 / (observedUnits + 100) * 100) / 100);
  assert.equal(result.competitiveSet.preservationRiskTotal, null);
  assert.equal(result.pma_data_coverage.capture_risk, 'partial');
  assert.equal(result.pmaSupportSummary.sources.nhpd, 'stub');
  assert.equal(result.competitiveSet.nhpdCoverage.generated, snapshot.meta.generated);
  const exported = JSON.parse(w.PMAJustification.exportToJSON(result));
  assert.equal(exported.competitiveSet.nhpdCoverage.recordCount, snapshot.features.length);
  assert.match(exported.auditTrail.narrative, /preservation totals are unknown/);
  assert.equal(exported.absorptionRisk.risk, null);
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
  const legacy = { competitiveSet: { subsidyExpiryRisk: [] }, absorptionRisk: {
    risk: 'low', captureRate: 0, totalCompetitiveUnits: 0
  }, _analysisResults: { competitiveSet: {}, absorptionRisk: { risk: 'low', captureRate: 0 } } };
  const exported = JSON.parse(w.PMAJustification.exportToJSON(legacy));
  assert.equal(exported.absorptionRisk.risk, null);
  assert.equal(exported.absorptionRisk.captureRate, null);
  assert.equal(exported._analysisResults.absorptionRisk.risk, null);
  assert.equal(exported.competitiveSet.nhpdCoverage.complete, false);
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
