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
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

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

function page() {
  const dom = new JSDOM(
    '<!doctype html><body>' +
    '<div class="pma-card" data-pma-keep><div id="pmaScoreWrap"><div id="pmaScoreCircle"></div>' +
    '<div id="pmaScoreTier"></div><div id="pmaScoreBoundary"></div></div></div>' +
    '<button id="pmaExportJsonBtn"></button><button id="pmaExportCsvBtn"></button>' +
    '<button id="pmaExplainScoreBtn" hidden></button>' +
    '<div class="pma-card" id="pmaJustificationCard" hidden><p id="pmaJustificationNarrative"></p></div>' +
    '<div id="lihtcConceptCard" hidden></div>' +
    '<input id="pmaProposedUnits" value="60"></body>',
    { url: 'http://localhost/market-analysis.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
  w.alert = () => {};
  w.PMADataCache = {
    has: (k) => k === 'tractCentroids' || k === 'acsMetrics',
    get: (k) => (k === 'tractCentroids' ? CENTROIDS : ACS)
  };
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

if (failures) {
  console.log('\n' + failures + ' failing');
  process.exit(1);
}
console.log('\nall passing');
