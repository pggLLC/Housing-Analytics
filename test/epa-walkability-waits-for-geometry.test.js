// test/epa-walkability-waits-for-geometry.test.js
//
// A market analysis must not score walkability before the EPA files arrive.
//
// data/market/epa_sld_bg_geometry_co.geojson is 2.5 MB and loads in the
// background. market-analysis.html auto-runs a deep-linked site at 1.5 s, once,
// and MAController read EpaWalkability synchronously: on a slow connection the
// site was reported "Unavailable" for good, and scoreAccess fell back to
// amenity distances alone — which scores HIGHER (Fruita 95 vs 62), so a slow
// load made a site look better, not blank (Codex review of #2001).
//
// This runs the real controller, scorer and connector in a vm with the real
// data files, holds the boundary file back, and checks what reaches
// renderNeighborhoodAccess. What the rendered walkability has to agree with is
// the connector's own answer for the site once both files are in.
//
// Run: node test/epa-walkability-waits-for-geometry.test.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CONNECTOR = process.env.EPA_WALK_SRC || 'js/data-connectors/epa-walkability.js';
const CONTROLLER = process.env.MA_CONTROLLER_SRC || 'js/market-analysis/market-analysis-controller.js';
const read = (rel) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
const SLD = JSON.parse(read('data/market/epa_sld_co.json'));
const GEOM = JSON.parse(read('data/market/epa_sld_bg_geometry_co.geojson'));
const DENVER = { lat: 39.7392, lon: -104.9903, bg: '080310020001' };

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅ PASS: ' + msg); }
  else { failed++; console.log('  ❌ FAIL: ' + msg); }
}

/** geometry: 'hold' (released by the test), 'fail', or 'never'. */
function page(geometry) {
  const zeroTimers = [];
  const longTimers = [];
  const rendered = { access: [], scores: [] };
  const win = {
    APP_CONFIG: {},
    console: { log() {}, warn() {}, info() {}, error() {} },
    setTimeout: (fn, ms) => { (ms ? longTimers : zeroTimers).push(fn); return zeroTimers.length + longTimers.length; },
  };
  win.window = win;
  win.CustomEvent = function (t, o) { this.type = t; this.detail = o && o.detail; };
  win.document = { readyState: 'complete', getElementById: () => null, addEventListener() {}, dispatchEvent() {},
    querySelector: () => null, querySelectorAll: () => [] };
  let release;
  const gate = new Promise((r) => { release = r; });
  win.safeFetchJSON = (url) => {
    if (url.endsWith('epa_sld_co.json')) return Promise.resolve(SLD);
    if (url.endsWith('epa_sld_bg_geometry_co.geojson')) {
      if (geometry === 'fail') return Promise.reject(new Error('HTTP 503'));
      if (geometry === 'never') return new Promise(() => {});
      return gate.then(() => GEOM);
    }
    return Promise.reject(new Error('not in fixture: ' + url));
  };
  win.OsmAmenities = { isLoaded: () => true, getAccessScore: () => ({
    grocery: { distanceMiles: 0.4 }, transit: { distanceMiles: 0.2 }, transit_rail: null, transit_bus: { distanceMiles: 0.2 },
    parks: { distanceMiles: 0.2 }, healthcare: { distanceMiles: 0.9 }, schools: { distanceMiles: 0.4 } }) };
  win.MAState = { setState() {}, getState: () => ({}) };
  win.MARenderers = new Proxy({}, { get: (t, k) => {
    if (k === 'renderNeighborhoodAccess') return (d) => rendered.access.push(d);
    if (k === 'renderExecutiveSummary') return (s) => rendered.scores.push(s);
    return () => {};
  } });
  const ctx = vm.createContext(win);
  for (const m of [CONNECTOR, 'js/market-analysis/site-selection-score.js', CONTROLLER]) {
    vm.runInContext(read(m), ctx, { filename: m });
  }
  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      while (zeroTimers.length) zeroTimers.shift()();
      await new Promise((r) => setImmediate(r));
    }
  };
  const fireLongTimers = async () => { while (longTimers.length) longTimers.shift()(); await flush(); };
  return { win, rendered, flush, fireLongTimers, release };
}

(async () => {
  console.log('\n[test] boundary file still in flight: the analysis waits, then scores the site');
  {
    const p = page('hold');
    await p.flush();
    p.win.MAController.runAnalysis(DENVER.lat, DENVER.lon, 3);
    await p.flush();
    assert(p.rendered.access.length === 0, 'nothing rendered while the boundary file is in flight');
    assert(p.rendered.scores.length === 0, 'no score rendered while the boundary file is in flight');
    p.release();
    await p.flush();
    const a = p.rendered.access[0];
    assert(!!a, 'Neighborhood Access rendered once the file arrived');
    const expected = p.win.EpaWalkability.getScores(DENVER.lat, DENVER.lon);
    assert(expected && p.win.EpaWalkability.resolveSite(DENVER.lat, DENVER.lon).blockGroups[0] === DENVER.bg,
      'connector locates Denver in ' + DENVER.bg + ' (non-vacuous)');
    assert(a && a.walkability && JSON.stringify(a.walkability) === JSON.stringify(expected),
      'rendered walkability equals the connector\'s answer for the site (walk ' + (a && a.walkability && a.walkability.walkScore) + ')');
    assert(a && a.walkabilityUnavailableReason == null, 'no unavailable reason once the site is scored');
    const withWalk = p.win.SiteSelectionScore.scoreAccess(
      { grocery: 0.4, transit: 0.2, transit_bus: 0.2, parks: 0.2, healthcare: 0.9, schools: 0.4 }, expected).score;
    assert(a && a.access_score === withWalk, 'the access score is the one blended with walkability (' + withWalk + ')');
  }

  console.log('\n[test] boundary file fails: rendered promptly as unavailable, with the reason');
  {
    const p = page('fail');
    await p.flush();
    p.win.MAController.runAnalysis(DENVER.lat, DENVER.lon, 3);
    await p.flush();
    const a = p.rendered.access[0];
    assert(!!a, 'rendered without waiting for the timeout');
    assert(a && a.walkability === null, 'walkability is null, not another place\'s values');
    const why = p.win.EpaWalkability.getUnavailableReason(DENVER.lat, DENVER.lon);
    assert(a && typeof why === 'string' && why.length > 0 && a.walkabilityUnavailableReason === why,
      'the rendered reason is the connector\'s (' + why + ')');
  }

  console.log('\n[test] boundary file never settles: the wait is bounded');
  {
    const p = page('never');
    await p.flush();
    p.win.MAController.runAnalysis(DENVER.lat, DENVER.lon, 3);
    await p.flush();
    assert(p.rendered.access.length === 0, 'still waiting before the timeout');
    await p.fireLongTimers();
    const a = p.rendered.access[0];
    assert(!!a, 'rendered after the timeout rather than hanging');
    assert(a && a.walkability === null && typeof a.walkabilityUnavailableReason === 'string' &&
      a.walkabilityUnavailableReason.length > 0, 'reported unavailable with a reason');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
