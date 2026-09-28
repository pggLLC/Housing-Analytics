'use strict';

// Exercise the real controller, exact-point HUD resolver, save handler and
// WorkflowState storage. Saved keys must agree with the live schema, not a
// second list of field names copied into this test.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const A = { lat: 39.712345678, lon: -105.012345678, bufferMiles: 3 };
const B = { ...A, lat: A.lat + 0.02 };
const square = (site) => ({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[
    [site.lon - 0.005, site.lat - 0.005], [site.lon + 0.005, site.lat - 0.005],
    [site.lon + 0.005, site.lat + 0.005], [site.lon - 0.005, site.lat + 0.005],
    [site.lon - 0.005, site.lat - 0.005]
  ]]
} });
const fc = (site) => ({ type: 'FeatureCollection', features: [square(site)] });

function page(storage = new Map()) {
  const timers = [];
  const errors = [];
  const win = {
    console: { log() {}, info() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) },
    document: {
      readyState: 'loading', addEventListener() {}, dispatchEvent() {},
      // A stale displayed score must never become this site's saved score.
      getElementById: (id) => id === 'pmaScoreCircle' ? { textContent: '99' } : null
    },
    CustomEvent: function () {},
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    setTimeout: (fn, ms) => { if (!ms) timers.push(fn); },
    SiteSelectionScore: { computeScore: () => ({ final_score: 88 }) }
  };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const file of ['js/workflow-state-core.js', 'js/workflow-state-api.js',
    'js/market-analysis/market-analysis-state.js', 'js/data-connectors/hud-egis.js',
    'js/market-analysis/market-analysis-controller.js']) {
    vm.runInContext(read(file), ctx, { filename: file });
  }
  const save = read('market-analysis.html').match(/  function savePmaToProject\(\) \{[\s\S]*?\n  \}/);
  assert.ok(save, 'the production save handler must be exercised');
  vm.runInContext(save[0], ctx, { filename: 'market-analysis.html:savePmaToProject' });
  win.HudEgis.loadLocalQct(fc(A));
  win.HudEgis.loadLocalDda(fc(B));
  if (!win.WorkflowState.getActiveProject()) win.WorkflowState.newProject('Exact rental site');
  let result = null;
  win.PMAEngine = { _state: { getLastResult: () => result } };
  return {
    win, storage,
    run: (site) => win.MAController.runAnalysis(site.lat, site.lon, site.bufferMiles),
    score: (site, overall = 67) => { result = { ...site, overall }; },
    market: () => plain(win.WorkflowState.getStep('market')),
    save: () => win.savePmaToProject(),
    async flush() {
      while (timers.length) timers.shift()();
      for (let i = 0; i < 4; i++) await new Promise(setImmediate);
      assert.deepEqual(errors, [], 'controller errors must not be swallowed by the fixture');
    }
  };
}

test('saved market keys agree with the schema and exact coordinates round-trip through storage', async () => {
  const p = page();
  assert.equal(p.save(), false, 'no selected point is not a saved site');
  p.score(A);
  p.run(A);
  await p.flush();
  // A fresh target ensures the save itself writes the coordinates; it cannot
  // accidentally rely on the controller's earlier invalidation write.
  p.win.WorkflowState.newProject('Save this selected point');
  assert.equal(p.save(), true);
  const saved = p.market();
  const schema = p.win._WorkflowInternal._defaultSteps().market;
  assert.deepEqual(Object.keys(saved).sort(), Object.keys(schema).sort(),
    'saved keys must equal _defaultSteps().market, without obsolete aliases');
  assert.equal(saved.pmaScore, 67, 'save the primary PMA score, not the DOM or site-selection index');
  assert.equal(saved.bufferMiles, A.bufferMiles);
  const flags = p.win.HudEgis.checkDesignation(A.lat, A.lon);
  assert.deepEqual([saved.qctFlag, saved.ddaFlag], [flags.in_qct, flags.in_dda]);
  assert.deepEqual([saved.qctFlag, saved.ddaFlag], [true, false]);
  const reopened = page(p.storage).market();
  assert.deepEqual([reopened.siteLat, reopened.siteLon], [A.lat, A.lon],
    'reopening the project must preserve full coordinate precision');
  assert.deepEqual(reopened, saved);
});

test('unknown, missing, failed and partial HUD designations preserve null', async () => {
  for (const [hud, expectedQct] of [
    [undefined, null],
    [{ checkDesignation() { throw new Error('HUD unavailable'); } }, null],
    [{ checkDesignation: () => ({}) }, null],
    [{ checkDesignation: () => ({ in_qct: null, in_dda: null }) }, null],
    [{ checkDesignation: () => ({ in_qct: true, in_dda: null }) }, true]
  ]) {
    const p = page();
    // Expected failures are logged by the production resolver, then return null.
    p.win.console.error = () => {};
    p.win.HudEgis = hud;
    p.run(A);
    await p.flush();
    assert.equal(p.save(), true);
    assert.equal(p.market().qctFlag, expectedQct, 'unknown QCT must never persist as false');
    assert.equal(p.market().ddaFlag, null, 'unknown DDA must never persist as false');
  }
});

test('moving the point clears saved and in-memory evidence before the new lookup completes', async () => {
  const p = page();
  p.win.PMATransit = { scoreSite: () => Promise.resolve({ transitAccessibilityScore: 72 }) };
  p.score(A);
  p.run(A);
  await p.flush();
  p.save();
  const access = p.win.MAState.getState().sections.access;
  assert.equal(access.transitMetrics.transitAccessibilityScore, 72);
  // The schema's dimensions field may contain a saved access/transit breakdown.
  p.win.WorkflowState.setStep('market', { dimensions: { access } });
  let release;
  p.win.PMATransit.scoreSite = () => new Promise((resolve) => { release = resolve; });
  p.run(B);
  for (const key of ['qctFlag', 'ddaFlag', 'pmaScore', 'dimensions', 'completedAt']) {
    assert.equal(p.market()[key], null, key + ' must clear immediately when the site moves');
  }
  const current = p.win.MAController.getCurrentSite();
  assert.deepEqual([current.qctFlag, current.ddaFlag, current.transitMetrics, current.pmaScore],
    [null, null, null, null]);
  assert.equal(p.win.MAState.getState().scores, null);
  assert.ok(!p.win.MAState.getState().sections.subsidy);
  assert.ok(!p.win.MAState.getState().sections.access);
  p.save();
  assert.equal(p.market().pmaScore, null, 'the old engine score must not be re-saved for the new site');
  assert.deepEqual([p.market().qctFlag, p.market().ddaFlag], [null, null]);
  await p.flush();
  assert.equal(typeof release, 'function', 'the new transit lookup must actually be pending');
  p.score(B, 41);
  release({ transitAccessibilityScore: 23 });
  await p.flush();
  p.save();
  assert.deepEqual([p.market().siteLat, p.market().siteLon], [B.lat, B.lon]);
  assert.deepEqual([p.market().qctFlag, p.market().ddaFlag, p.market().pmaScore], [false, true, 41]);
  assert.equal(p.win.MAController.getCurrentSite().transitMetrics.transitAccessibilityScore, 23);

  // A fresh controller must also invalidate evidence loaded from the project.
  const reopened = page(p.storage);
  reopened.run(A);
  assert.deepEqual([reopened.market().qctFlag, reopened.market().ddaFlag, reopened.market().pmaScore],
    [null, null, null]);
});

test('late results cannot restore evidence after A → B → A or a buffer change', async () => {
  const p = page();
  const releases = [];
  p.win.PMATransit = { scoreSite: () => new Promise((resolve) => releases.push(resolve)) };
  for (const site of [A, B, A, { ...A, bufferMiles: 5 }]) {
    p.run(site);
    await p.flush();
  }
  assert.equal(releases.length, 4);
  for (const release of releases.slice(0, 3)) release({ transitAccessibilityScore: 99 });
  await p.flush();
  const pending = p.win.MAController.getCurrentSite();
  assert.deepEqual([pending.qctFlag, pending.ddaFlag, pending.transitMetrics], [null, null, null]);
  const pendingState = p.win.MAState.getState();
  assert.equal(pendingState.loading, true, 'an older run must not finish the current run');
  assert.equal(pendingState.scores, null, 'an older run must not publish scores');
  assert.ok(!pendingState.sections.access, 'an older run must not restore transit evidence in MAState');
  p.score(A); // even the same point's score is stale if its buffer changed
  p.save();
  assert.equal(p.market().pmaScore, null);
  releases[3]({ transitAccessibilityScore: 12 });
  await p.flush();
  assert.equal(p.win.MAController.getCurrentSite().transitMetrics.transitAccessibilityScore, 12);
});

test('a genuine zero PMA score stays zero; resetting leaves no site to save', async () => {
  const p = page();
  p.score(A, 0);
  p.run(A);
  await p.flush();
  p.save();
  assert.equal(p.market().pmaScore, 0);
  p.win.MAController.resetAll();
  assert.equal(p.save(), false);
});

test('production code never reads window.PMAState and this test is reachable from CI', () => {
  const files = execFileSync('git', ['ls-files', '*.js', '*.html'], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter((f) => f.startsWith('js/') || !f.includes('/'));
  assert.ok(files.includes('market-analysis.html') && files.length > 100, 'production scan must not be empty');
  const reads = /window\s*(?:\.\s*PMAState\b|\[\s*['"]PMAState['"]\s*\])/;
  assert.deepEqual(files.filter((f) => reads.test(read(f))), [], 'no production reader of the undefined state');
  const scripts = JSON.parse(read('package.json')).scripts;
  const reachable = new Set();
  function visit(name) {
    if (reachable.has(name)) return;
    reachable.add(name);
    for (const match of (scripts[name] || '').matchAll(/\bnpm run ([\w:-]+)/g)) visit(match[1]);
  }
  visit('test');
  assert.ok([...reachable].some((name) => /^ci:part-/.test(name) &&
    scripts[name].includes('npm run test:market-site-point-persisted')));
  assert.equal(scripts['test:market-site-point-persisted'], 'node test/market-site-point-persisted.test.js');
});

test('a save made before the HUD lookup resolves receives the resolved flags', async () => {
  const p = page();
  p.score(A);
  p.run(A);
  // The Save button enables when the score renders, before the controller's waits end.
  assert.equal(p.save(), true);
  assert.deepEqual([p.market().qctFlag, p.market().ddaFlag], [null, null]);
  await p.flush();
  assert.deepEqual([p.market().qctFlag, p.market().ddaFlag], [true, false],
    'the resolved designation must reach the step saved for this same site');
  assert.equal(p.market().pmaScore, 67);
});

test('the controller runs on the radius the PMA result records', () => {
  const src = read('js/market-analysis.js');
  const recorded = src.match(/lastResult = Object\.assign\(\{\}, pma, \{\s*lat: lat, lon: lon, bufferMiles: (\w+)/);
  const passed = src.match(/MAC\.runAnalysis\(lat, lon, (\w+)[,)]/);
  assert.ok(recorded && passed, 'both the recorded radius and the controller call must be found');
  assert.equal(passed[1], recorded[1],
    'getCurrentSite() matches the PMA score on bufferMiles; a fallback radius must not null a visible score');
});
