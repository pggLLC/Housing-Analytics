'use strict';

// A custom PMA draws no conclusion until it is bound (#1932).
//
// A custom primary market area on market-analysis.html is the tract picker:
// the analyst places a site and picks whole census tracts. Its conclusions —
// the PMA score, tier, capture rate and competitive density on the score
// card, and the justification narrative and concept-card recommendation the
// PMA runner builds — are about that area only when three things are bound:
//
//   1. a site anchor (the placed site's coordinates);
//   2. a mapped boundary covering every selected tract;
//   3. a tract record (centroid + ACS row) for every selected tract.
//
// Before this guard, runAnalysis() scored a tract PMA whose boundary was null
// by counting LIHTC and other assisted supply in a RADIUS around the site
// (lihtcInBuffer), while the card said "PMA: N whole census tracts you
// selected"; and a selected tract with no ACS row was dropped from the demand
// pool without a word. Both produced a confident score.
//
// This runs the production engine (js/market-analysis.js) and UI controller
// (js/pma-ui-controller.js) in jsdom against the real tract and ACS files.
// What the blocked state must agree with: the score card shows no score, the
// engine holds no result (every export refuses without one), the export
// buttons are disabled, and the runner that writes the narrative is never
// called. The complete case must still produce a score, or the blocked
// assertions prove nothing.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CENTROIDS = JSON.parse(read('data/market/tract_centroids_co.json'));
const ACS = JSON.parse(read('data/market/acs_tract_metrics_co.json'));
const TRACTS = CENTROIDS.tracts || CENTROIDS;
const ACS_IDS = new Set(ACS.tracts.map((t) => t.geoid));

// Fruita. The site sits in 08077001504; its PMA is it and two neighbours.
const SITE = { lat: 39.1589, lon: -108.7290 };
const PICKED = ['08077001504', '08077001503', '08077001402'];

let failures = 0;
const tests = [];
const windows = [];
function test(name, fn) { tests.push([name, fn]); }

function tract(geoid) {
  const t = TRACTS.find((x) => x.geoid === geoid);
  assert(t && Array.isArray(t.bbox), geoid + ' has no centroid/bbox record; re-point the fixture');
  return t;
}
function feature(geoid) {
  const [w, s, e, n] = tract(geoid).bbox;
  return { type: 'Feature', properties: { GEOID: geoid },
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
}
function boundaryFor(geoids) {
  return { type: 'FeatureCollection', properties: { source: 'pma-tract-picker', tract_count: geoids.length },
    features: geoids.map(feature) };
}

function page({ acs = ACS, cold = false, dataService } = {}) {
  const dom = new JSDOM(
    '<!doctype html><body>' +
    '<div class="pma-card" data-pma-keep><div id="pmaScoreWrap"><div id="pmaScoreCircle"></div>' +
    '<div id="pmaScoreTier"></div><div id="pmaScoreBoundary"></div></div></div>' +
    '<button id="pmaExportJsonBtn"></button><button id="pmaExportCsvBtn"></button>' +
    '<button id="pmaExplainScoreBtn" hidden></button><button id="pmaExportAuditJson"></button>' +
    '<div class="pma-card" id="pmaJustificationCard" hidden><p id="pmaJustificationNarrative"></p></div>' +
    '<div id="lihtcConceptCard" hidden></div>' +
    '<input id="pmaProposedUnits" value="60"></body>',
    { url: 'http://localhost/market-analysis.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
  w.alert = () => {};
  windows.push(w);
  w.WorkflowState = { getJurisdiction: () => ({ geoid: '0828745', countyFips: '08077', name: 'Fruita' }) };
  w.eval(read('js/market-analysis-cache-fix.js'));
  if (!cold) {
    w.PMADataCache.set('tractCentroids', CENTROIDS);
    w.PMADataCache.set('acsMetrics', acs);
  }
  if (dataService) w.DataService = dataService;
  const quiet = { warn: console.warn, error: console.error };
  console.warn = console.error = () => {};
  try {
    [
      'js/utils/format-money.js',
      'js/market-analysis/market-analysis-utils.js',
      'js/market-analysis/market-report-renderers.js',
      'js/market-analysis-scoring.js',
      'js/market-analysis-supply.js',
      'js/market-analysis.js',
      'js/pma-justification.js',
      'js/lihtc-deal-predictor.js',
      'js/pma-ui-controller.js'
    ].forEach((rel) => w.eval(read(rel)));
  } finally { Object.assign(console, quiet); }
  assert(w.PMAEngine && typeof w.PMAEngine.runAnalysis === 'function', 'PMAEngine did not load');
  assert(w.PMAUIController && typeof w.PMAUIController.runEnhanced === 'function', 'PMAUIController did not load');
  return w;
}

function run(w, lat, lon, geoids, boundary) {
  const quiet = { warn: console.warn, error: console.error, log: console.log };
  console.warn = console.error = console.log = () => {};
  try { w.PMAEngine.runAnalysis(lat, lon, { method: 'tract', tractGeoids: geoids, tractBoundary: boundary }); }
  finally { Object.assign(console, quiet); }
  return screen(w);
}

function screen(w) {
  const doc = w.document;
  const circle = doc.getElementById('pmaScoreCircle');
  const blocked = doc.querySelector('[data-custom-pma-blocked]');
  return {
    result: w.PMAEngine._state.getLastResult(),
    score: circle ? circle.textContent.trim() : null,
    blocked: blocked ? blocked.textContent : null,
    exportsDisabled: ['pmaExportJsonBtn', 'pmaExportCsvBtn'].map((id) => doc.getElementById(id).disabled),
    state: doc.body.getAttribute('data-pma-result-state')
  };
}

// The card's reason must be the engine's own reason for the same inputs
// (customPmaReadiness, which the PMA runner gate also reads), not a wording
// pinned here. What IS pinned are claims: the tracts a reason names.
function assertBlocked(out, reason, label) {
  assert.strictEqual(out.result, null, label + ': the engine still holds a result, so it can be exported');
  assert.strictEqual(out.score, null, label + ': a PMA score is still on the card (' + out.score + ')');
  assert.ok(out.blocked, label + ': no blocked state was rendered on the score card');
  assert.ok(typeof reason === 'string' && reason.length > 0, label + ': the engine gave no reason');
  assert.ok(out.blocked.includes(reason), label + ': the card does not give the engine\'s reason ("' + reason + '"): ' + out.blocked);
  assert.ok(!/\b0\b/.test(out.blocked.replace(/\d{5,}/g, '')), label + ': the blocked state shows a zero');
  assert.deepStrictEqual(out.exportsDisabled, [true, true], label + ': the exports are still enabled');
  assert.strictEqual(out.state, 'pending', label + ': the result cards are not hidden');
}

console.log('\ncustom-pma-conclusions-blocked');

test('the fixture tracts are real and bound, so the complete case is a real case', () => {
  PICKED.forEach((g) => { tract(g); assert(ACS_IDS.has(g), g + ' has no ACS row; re-point the fixture'); });
});

test('a fully bound custom PMA is scored (non-vacuity for every block below)', () => {
  const w = page();
  const out = run(w, SITE.lat, SITE.lon, PICKED, boundaryFor(PICKED));
  assert.ok(out.result, 'a complete custom PMA produced no result');
  assert.strictEqual(out.result.boundaryMethod, 'tract-picker');
  assert.deepStrictEqual(out.result._tractIds.slice().sort(), PICKED.slice().sort(),
    'the scored tracts are not the ones selected');
  assert.ok(/^\d+$/.test(out.score), 'no score on the card for a complete custom PMA: ' + out.score);
  assert.strictEqual(out.blocked, null);
  const ready = w.PMAEngine.customPmaReadiness(SITE.lat, SITE.lon, { tractGeoids: PICKED, tractBoundary: boundaryFor(PICKED) });
  assert.deepStrictEqual({ ready: ready.ready, reason: ready.reason }, { ready: true, reason: null });
});

// [label, lat, lon, geoids, boundary, tracts the reason must name]
const UNBOUND = '08077999999';
const CASES = [
  ['no mapped boundary', SITE.lat, SITE.lon, PICKED, null, []],
  ['a boundary missing one selected tract', SITE.lat, SITE.lon, PICKED, boundaryFor(PICKED.slice(0, 2)), [PICKED[2]]],
  ['a selected tract with no tract record', SITE.lat, SITE.lon, PICKED.concat(UNBOUND),
    { type: 'FeatureCollection', features: boundaryFor(PICKED).features
      .concat(Object.assign(feature(PICKED[0]), { properties: { GEOID: UNBOUND } })) }, [UNBOUND]],
  ['no site anchor', NaN, NaN, PICKED, boundaryFor(PICKED), []],
  ['no tracts selected', SITE.lat, SITE.lon, [], null, []]
];

const reasons = [];
CASES.forEach(([label, lat, lon, geoids, boundary, names]) => {
  test('blocked with its reason: ' + label, () => {
    const w = page();
    const ready = w.PMAEngine.customPmaReadiness(lat, lon, { tractGeoids: geoids, tractBoundary: boundary });
    assert.strictEqual(ready.ready, false, 'customPmaReadiness calls this custom PMA bound');
    assertBlocked(run(w, lat, lon, geoids, boundary), ready.reason, label);
    names.forEach((g) => assert.ok(ready.reason.includes(g), 'the reason does not name ' + g + ': ' + ready.reason));
    geoids.filter((g) => !names.includes(g)).forEach((g) =>
      assert.ok(!ready.reason.includes(g), 'the reason blames ' + g + ', which is bound: ' + ready.reason));
    reasons.push(ready.reason);
  });
});

test('each missing binding is told apart from the others', () => {
  assert.strictEqual(reasons.length, CASES.length, 'not every blocked case produced a reason');
  assert.strictEqual(new Set(reasons).size, reasons.length,
    'two different missing bindings give the same reason:\n    ' + reasons.join('\n    '));
});

test("a blocked run takes down the previous run's conclusions", () => {
  const w = page();
  const first = run(w, SITE.lat, SITE.lon, PICKED, boundaryFor(PICKED));
  assert.ok(first.result && /^\d+$/.test(first.score), 'the first, complete run was not scored');
  const second = run(w, SITE.lat, SITE.lon, PICKED, null);
  const ready = w.PMAEngine.customPmaReadiness(SITE.lat, SITE.lon, { tractGeoids: PICKED, tractBoundary: null });
  assertBlocked(second, ready.reason, 'after a complete run');
});

test('the narrative and recommendation runner is not called for an unbound custom PMA', () => {
  const w = page();
  const calls = [];
  const emitter = { on() { return emitter; } };
  w.PMAAnalysisRunner = { run: (lat, lon, opts) => { calls.push(opts); return emitter; } };
  let boundary = null;
  w.PMATractPicker = { getSelectedGeoids: () => PICKED.slice(), getBoundary: () => boundary };
  assert.strictEqual(w.PMAUIController.getMethod(), 'tract', 'the page no longer defaults to the tract picker');
  const card = w.document.getElementById('pmaJustificationCard');
  card.hidden = false; // a previous run's narrative is on screen

  w.PMAUIController.runEnhanced(SITE.lat, SITE.lon);
  assert.strictEqual(calls.length, 0, 'the PMA runner was started for a custom PMA with no boundary');
  assert.strictEqual(card.hidden, true, "the previous run's justification narrative is still shown");
  assert.strictEqual(w.PMAUIController.getLastScoreRun(), null);

  boundary = boundaryFor(PICKED);
  w.PMAUIController.runEnhanced(SITE.lat, SITE.lon);
  assert.strictEqual(calls.length, 1, 'the runner did not start once the custom PMA was bound');
  assert.strictEqual(calls[0].tractBoundary, boundary);
  assert.deepStrictEqual(calls[0].tractGeoids, PICKED);
});

// Use the actual cache serialization and narrative renderer. The score stored
// here came from the real engine above, not a second implementation of it.
function savedRun() {
  const w = page();
  const result = run(w, SITE.lat, SITE.lon, PICKED, boundaryFor(PICKED)).result;
  const scoreRun = w.PMAJustification.synthesizePMA({
    commuting: { method: 'tract-picker', captureRate: null, lodesWorkplaces: 0 }
  });
  scoreRun.pma = result;
  scoreRun.pmaTractSelection = { selected: PICKED.slice(), curated: true };
  w.PMADataCache.saveLastResult(SITE.lat, SITE.lon,
    { method: 'tract', tractGeoids: PICKED, tractBoundary: boundaryFor(PICKED), proposedUnits: 60 }, scoreRun);
  return JSON.parse(w.localStorage.getItem('pma_last_result_v1'));
}
function store(w, saved) { w.localStorage.setItem('pma_last_result_v1', JSON.stringify(saved)); }
function assertRestored(w, saved) {
  const restored = w.PMAUIController.getLastScoreRun();
  assert.ok(restored, 'the valid saved result was not restored');
  assert.strictEqual(restored.run_id, saved.scoreRun.run_id);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(restored.pma)), saved.scoreRun.pma);
  assert.strictEqual(w.document.getElementById('pmaJustificationCard').hidden, false);
  assert.strictEqual(w.document.getElementById('pmaJustificationNarrative').textContent,
    w.PMAJustification.generateNarrative(restored), 'restored narrative must describe this saved run');
  assert.strictEqual(w.document.getElementById('lihtcConceptCard').hidden, false);
  assert.ok(w.document.getElementById('lihtcExportConceptBtn'), 'valid saved concept has no export');
  assert.strictEqual(w.document.getElementById('pmaExplainScoreBtn').hidden, false);
  assert.strictEqual(w.document.getElementById('pmaExportAuditJson').disabled, false);
}

test('a valid saved custom PMA restores its narrative, explanation and audit export', () => {
  const w = page();
  const saved = savedRun();
  store(w, saved);
  w.PMAUIController.restoreLastRun();
  assertRestored(w, saved);
});

const RESTORE_CASES = [
  ['missing site', s => { s.lat = null; s.lon = null; }],
  ['missing selected tracts', s => { s.options.tractGeoids = []; }],
  ['missing boundary', s => { s.options.tractBoundary = null; }],
  ['partially mapped boundary', s => { s.options.tractBoundary = boundaryFor(PICKED.slice(1)); }],
  ['missing tract source binding', s => { s.options.tractGeoids.push(UNBOUND);
    s.options.tractBoundary.features.push(Object.assign(feature(PICKED[0]), { properties: { GEOID: UNBOUND } })); }],
  ['missing current ACS row', () => {}, { tracts: ACS.tracts.filter(t => t.geoid !== PICKED[0]) }]
];
RESTORE_CASES.forEach(([label, corrupt, acs]) => {
  test('restoring ' + label + ' clears prior conclusions and disables all exports', () => {
    const w = page({ acs });
    const saved = savedRun();
    // Seed a prior conclusion, including an earlier enhanced run where current
    // bindings permit one, then corrupt only the persisted context.
    if (!acs) { store(w, saved); w.PMAUIController.restoreLastRun(); assertRestored(w, saved); }
    w.PMAEngine._setLastResultForTest(saved.scoreRun.pma);
    const doc = w.document;
    doc.getElementById('pmaScoreCircle').textContent = saved.scoreRun.pma.pma_score;
    doc.getElementById('pmaJustificationNarrative').textContent = 'PRIOR CONCLUSION';
    doc.getElementById('pmaJustificationCard').hidden = false;
    doc.getElementById('lihtcConceptCard').innerHTML = '<button id="lihtcExportConceptBtn">PRIOR CONCEPT</button>';
    doc.getElementById('lihtcConceptCard').hidden = false;
    doc.getElementById('pmaExplainScoreBtn').hidden = false;
    corrupt(saved);
    store(w, saved);
    const ready = w.PMAEngine.customPmaReadiness(saved.lat, saved.lon, saved.options);
    assert.strictEqual(ready.ready, false);
    let conceptCalls = 0;
    w.LIHTCDealPredictor = { predictConcept() { conceptCalls++; return {}; } };
    w.PMAUIController.restoreLastRun();
    assertBlocked(screen(w), ready.reason, label);
    assert.strictEqual(w.PMAUIController.getLastScoreRun(), null);
    assert.strictEqual(doc.getElementById('pmaJustificationNarrative').textContent, '');
    assert.strictEqual(doc.getElementById('pmaJustificationCard').hidden, true);
    assert.strictEqual(doc.getElementById('lihtcConceptCard').textContent, '');
    assert.strictEqual(doc.getElementById('lihtcConceptCard').hidden, true);
    assert.strictEqual(conceptCalls, 0, 'the saved concept was regenerated before readiness');
    assert.strictEqual(doc.getElementById('pmaExplainScoreBtn').hidden, true);
    assert.strictEqual(doc.getElementById('pmaExportAuditJson').disabled, true);
    assert.strictEqual(doc.getElementById('lihtcExportConceptBtn'), null);
  });
});

for (const method of ['buffer', 'commuting', 'hybrid']) {
  test('saved ' + method + ' session keeps its existing restore behavior', () => {
    const w = page();
    const saved = savedRun();
    saved.options = { method, bufferMiles: 3, proposedUnits: 60 };
    delete saved.scoreRun.pmaTractSelection;
    store(w, saved);
    w.PMAUIController.restoreLastRun();
    assertRestored(w, saved);
  });
  test('saved ' + method + ' session refuses a different jurisdiction', () => {
    const w = page();
    const saved = savedRun();
    saved.options = { method, bufferMiles: 3, proposedUnits: 60 };
    delete saved.scoreRun.pmaTractSelection;
    store(w, saved);
    w.PMAUIController.restoreLastRun();
    assertRestored(w, saved);
    w.WorkflowState.getJurisdiction = () => ({ geoid: '0845970', countyFips: '08013', name: 'Longmont' });
    w.PMAUIController.restoreLastRun();
    assert.strictEqual(w.PMAUIController.getLastScoreRun(), null);
    assert.strictEqual(w.PMAEngine._state.getLastResult(), null);
    assert.strictEqual(w.document.getElementById('pmaScoreWrap').dataset.unavailableReason, 'saved_jurisdiction_mismatch');
    assert(w.document.getElementById('pmaScoreWrap').textContent.includes('Fruita'));
    assert(w.document.getElementById('pmaScoreWrap').textContent.includes('Longmont'));
    assert.strictEqual(w.document.getElementById('pmaJustificationNarrative').textContent, '');
    assert.strictEqual(w.document.getElementById('pmaExportAuditJson').disabled, true);
  });
}

test('buffer polygon output does not claim measured commuting capture', async () => {
  const w = page();
  const polygon = await w.PMAEngine.generatePmaPolygon(SITE.lat, SITE.lon, 'buffer', 3);
  assert.strictEqual(polygon.captureRate, null);
  assert.ok(polygon.captureUnavailableReason);
});

test('blocked restore cannot export the justification module’s earlier run or revive an in-flight run', async () => {
  const w = page();
  await tick(); // install the production click handlers
  const saved = savedRun();
  store(w, saved);
  w.PMAUIController.restoreLastRun();
  w.PMAJustification.synthesizePMA(saved.scoreRun); // module-level fallback exists
  let complete;
  const emitter = { on(event, fn) { if (event === 'complete') complete = fn; return emitter; } };
  w.PMAAnalysisRunner = { run: () => emitter };
  w.PMATractPicker = { getSelectedGeoids: () => PICKED.slice(), getBoundary: () => boundaryFor(PICKED) };
  w.PMAUIController.runEnhanced(SITE.lat, SITE.lon);
  assert.ok(complete, 'a prior enhanced run must be in flight');
  saved.options.tractBoundary = null;
  store(w, saved);
  w.PMAUIController.restoreLastRun();
  let exports = 0;
  w.PMAJustification.exportToJSON = () => { exports++; return '{}'; };
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  // Dispatch bypasses the browser's disabled-button click suppression.
  w.document.getElementById('pmaExportAuditJson').dispatchEvent(new w.Event('click'));
  assert.strictEqual(exports, 0, 'audit handler fell back to a previous module result');
  complete(saved.scoreRun);
  assert.strictEqual(w.PMAUIController.getLastScoreRun(), null, 'late completion revived the invalid result');
  assert.strictEqual(w.document.getElementById('pmaJustificationNarrative').textContent, '');
});

// Real DOMContentLoaded/data-load ordering, with a deliberately delayed ACS
// response: a warm-cache-only test would miss this valid-session regression.
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('startup waits for current ACS bindings before restoring a valid saved session', async () => {
  let release;
  const acs = new Promise(resolve => { release = resolve; });
  const w = page({ cold: true, dataService: { baseData: p => p, getJSON(p) {
    if (p.includes('acs_tract_metrics')) return acs;
    if (p.includes('tract_centroids')) return Promise.resolve(CENTROIDS);
    return Promise.resolve({ features: [] });
  } } });
  const saved = savedRun();
  store(w, saved);
  await tick();
  assert.strictEqual(w.PMAUIController.getLastScoreRun(), null, 'restored before ACS loaded');
  release(ACS);
  await w.PMAEngine.whenDataReady();
  await tick();
  assertRestored(w, saved);
});

[
  ['tract-picker site change', w => w.PMAUIController.beginTractPma(40, -105)],
  ['direct site placement', w => {
    w.fetch = () => Promise.reject(new Error('network disabled in fixture'));
    w.PMAEngine.placeSiteMarker(40, -105);
  }],
  ['jurisdiction deep link', w => {
    w.fetch = () => Promise.reject(new Error('network disabled in fixture'));
    w.PMAEngine.placeSiteMarker(40, -105, { jurisdictionCentroid: true });
    w.PMAEngine.runAnalysis(40, -105);
  }],
  ['direct engine analysis', w => w.PMAEngine.runAnalysis(SITE.lat, SITE.lon)]
].forEach(([label, start]) => test(label + ' cancels startup restoration while sources are loading', async () => {
  let release;
  const acs = new Promise(resolve => { release = resolve; });
  const w = page({ cold: true, dataService: { baseData: p => p, getJSON(p) {
    if (p.includes('acs_tract_metrics')) return acs;
    if (p.includes('tract_centroids')) return Promise.resolve(CENTROIDS);
    return Promise.resolve({ features: [] });
  } } });
  store(w, savedRun());
  await tick();
  start(w);
  release(ACS);
  await w.PMAEngine.whenDataReady();
  await tick();
  assert.strictEqual(w.PMAUIController.getLastScoreRun(), null);
  assert.strictEqual(w.document.getElementById('pmaJustificationNarrative').textContent, '');
}));

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.log('  ✗ ' + name + ' — ' + e.message); }
    finally { windows.splice(0).forEach(w => w.close()); }
  }
  if (failures) { console.log('\n' + failures + ' failing'); process.exitCode = 1; }
  else console.log('\nall passing');
})();
