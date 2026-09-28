'use strict';

// Run the production controller, scorer, HUD lookup and comparison UI together.
// Completion must arrive through the controller's event: the test never calls
// SiteComparison.render() or dispatches a scoring event itself.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const A = { lat: 39.712345678, lon: -105.012345678, bufferMiles: 3 };
const B = { lat: 39.732345678, lon: -104.992345678, bufferMiles: 5 };
const fc = (site) => ({ type: 'FeatureCollection', features: [{
  type: 'Feature', properties: {}, geometry: {
    type: 'Polygon', coordinates: [[
      [site.lon - 0.005, site.lat - 0.005], [site.lon + 0.005, site.lat - 0.005],
      [site.lon + 0.005, site.lat + 0.005], [site.lon - 0.005, site.lat + 0.005],
      [site.lon - 0.005, site.lat - 0.005]
    ]]
  }
}] });

async function page(t, { hud = true } = {}) {
  const dom = new JSDOM(`
    <div id="scSaveButtons" style="display:none"><button id="scSaveSiteBtn">Save Current Site</button></div>
    <div id="siteCompTable"></div><div id="siteCompActions" style="display:none"></div>`,
  { runScripts: 'outside-only', url: 'https://example.test/market-analysis.html' });
  t.after(() => dom.window.close());
  const win = dom.window;
  const timers = [], errors = [], completed = [], rendered = [];
  // Bootstrap once, and control only the controller's next-tick work. The
  // 20-second timeout must not resolve a deliberately pending transit lookup.
  Object.defineProperty(win.document, 'readyState', { value: 'complete' });
  win.setTimeout = (fn, ms) => { if (!ms || ms <= 100) timers.push(fn); };
  win.console = { log() {}, info() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) };
  win.MARenderers = Object.fromEntries([
    'showSectionLoading', 'showSectionError',
    'renderExecutiveSummary', 'renderMarketDemand', 'renderAffordableSupply',
    'renderSubsidyOpportunities', 'renderSiteFeasibility', 'renderNeighborhoodAccess',
    'renderPolicyOverlays', 'renderOpportunities'
  ].map((name) => [name, () => rendered.push(name)]));
  for (const file of ['js/workflow-state-core.js', 'js/workflow-state-api.js',
    'js/site-state.js', 'js/market-analysis/market-analysis-state.js',
    'js/data-connectors/hud-egis.js', 'js/market-analysis/site-selection-score.js',
    'js/market-analysis/market-analysis-controller.js', 'js/market-analysis/site-comparison.js']) {
    vm.runInContext(read(file), dom.getInternalVMContext(), { filename: file });
  }
  if (hud) {
    win.HudEgis.loadLocalQct(fc(A));
    win.HudEgis.loadLocalDda(fc(B));
  }
  win.document.addEventListener('ma:analysis-complete', (event) => {
    completed.push({ site: win.MAController.getCurrentSite(), rendered: rendered.slice(),
      isCustomEvent: event instanceof win.CustomEvent });
  });
  const p = {
    win, completed,
    run: (site) => win.MAController.runAnalysis(site.lat, site.lon, site.bufferMiles),
    save: () => win.document.getElementById('scSaveSiteBtn').click(),
    sites: () => plain(win.SiteComparison.getSites()),
    rows: () => Array.from(win.document.querySelectorAll('#siteCompTable tbody tr')),
    display: () => win.document.getElementById('scSaveButtons').style.display,
    async flush() {
      for (let i = 0; i < 4; i++) {
        while (timers.length) timers.shift()();
        await new Promise(setImmediate);
      }
      assert.deepEqual(errors, [], 'production errors must not be swallowed by the fixture');
    }
  };
  await p.flush();
  return p;
}

function assertSaved(p, index) {
  const site = p.win.MAController.getCurrentSite();
  const scores = p.win.MAState.getState().scores;
  const saved = p.sites()[index];
  assert.deepEqual([saved.lat, saved.lon, saved.bufferMiles], [site.lat, site.lon, site.bufferMiles]);
  assert.equal(saved.finalScore, scores.final_score);
  assert.equal(saved.band, scores.opportunity_band);
  for (const dimension of ['demand', 'subsidy', 'feasibility', 'access', 'policy', 'market']) {
    assert.equal(saved[dimension], scores[dimension + '_score'], dimension + ' must agree with the scorer');
  }
  const row = p.rows().find((r) => r.dataset.siteId === saved.id);
  assert.ok(row, 'the clicked save must produce a table row');
  assert.equal(row.cells[2].textContent, String(Math.round(scores.final_score)));
  assert.ok(row.querySelector('.sc-site-coords').textContent.includes(
    site.lat.toFixed(4) + ', ' + site.lon.toFixed(4)));
  return row;
}

test('a completed site can be saved; pending B cannot save A scores at B coordinates', async (t) => {
  const p = await page(t);
  assert.equal(p.display(), 'none', 'save is hidden before a run');
  assert.equal(p.win.SiteComparison.capture(), null);
  p.save();
  assert.equal(p.sites().length, 0);

  p.run(A);
  await p.flush();
  assert.equal(p.display(), 'flex', 'the completion event must reveal Save Current Site');
  assert.equal(p.completed.length, 1);
  assert.equal(p.completed[0].isCustomEvent, true);
  assert.ok(p.completed[0].rendered.includes('renderOpportunities'), 'completion follows the section render calls');
  p.save();
  assert.equal(p.rows().length, 1);
  const aRow = assertSaved(p, 0);
  assert.deepEqual([p.sites()[0].qct, p.sites()[0].dda], [true, false]);
  assert.deepEqual([aRow.cells[10].textContent, aRow.cells[11].textContent], ['Yes', 'No']);
  assert.equal(p.win.MAState.getState().scores.demand_score, null, 'the real scorer could not measure demand');
  assert.equal(p.sites()[0].demand, null);
  assert.equal(aRow.cells[4].dataset.unavailable, 'true');
  assert.equal(p.win.document.getElementById('siteCompActions').style.display, 'block');

  let release;
  p.win.PMATransit = { scoreSite: () => new Promise((resolve) => { release = resolve; }) };
  p.run(B);
  assert.equal(p.win.MAController.getCurrentSite().lat, B.lat);
  assert.equal(p.win.MAState.getState().scores, null);
  assert.equal(p.win.SiteComparison.capture(), null);
  assert.equal(p.display(), 'none', 'save hides immediately while the next run is pending');
  p.save();
  await p.flush();
  assert.equal(typeof release, 'function', 'B must actually be waiting for its lookup');
  assert.equal(p.win.SiteComparison.capture(), null);
  p.save();
  assert.equal(p.sites().length, 1, 'even a click on the hidden button cannot save stale scores');
  assert.equal(p.completed.length, 1, 'B has not announced completion');

  release({ transitAccessibilityScore: 23 });
  await p.flush();
  assert.equal(p.display(), 'flex');
  p.save();
  assert.equal(p.rows().length, 2);
  const bRow = assertSaved(p, 1);
  assert.notDeepEqual([p.sites()[0].lat, p.sites()[0].lon], [p.sites()[1].lat, p.sites()[1].lon]);
  assert.deepEqual([bRow.cells[10].textContent, bRow.cells[11].textContent], ['No', 'Yes']);
  assert.deepEqual(plain(p.win.SiteState.get('savedSites')), p.sites(), 'both snapshots persist');
});

test('unavailable HUD lookup remains unknown and the scorer null retains its reason', async (t) => {
  const p = await page(t, { hud: false });
  p.run(A);
  await p.flush();
  assert.equal(p.display(), 'flex');
  p.save();
  const row = assertSaved(p, 0);
  const saved = p.sites()[0];
  assert.deepEqual([saved.qct, saved.dda, saved.subsidy], [null, null, null]);
  assert.deepEqual([row.cells[10].textContent, row.cells[11].textContent], ['Unknown', 'Unknown']);
  const reason = p.win.MAState.getState().scores.subsidyUnavailableReason;
  assert.ok(reason, 'the real HUD resolver and scorer must explain the missing designation');
  assert.equal(saved.subsidyUnavailableReason, reason);
  assert.equal(row.cells[5].dataset.unavailable, 'true');
  assert.ok(row.cells[5].textContent.includes(reason));
});

test('superseded runs cannot dispatch completion or expose a snapshot; reset hides saving', async (t) => {
  const p = await page(t);
  const releases = [];
  p.win.PMATransit = { scoreSite: () => new Promise((resolve) => releases.push(resolve)) };
  for (const site of [A, B, A]) {
    p.run(site);
    await p.flush();
  }
  assert.equal(releases.length, 3);
  releases[0]({ transitAccessibilityScore: 99 });
  releases[1]({ transitAccessibilityScore: 99 });
  await p.flush();
  assert.equal(p.completed.length, 0);
  assert.equal(p.win.SiteComparison.capture(), null);
  assert.equal(p.display(), 'none');
  releases[2]({ transitAccessibilityScore: 12 });
  await p.flush();
  assert.equal(p.completed.length, 1);
  assert.equal(p.display(), 'flex');
  p.win.MAController.resetAll();
  assert.equal(p.win.SiteComparison.capture(), null);
  assert.equal(p.display(), 'none');
  p.save();
  assert.equal(p.sites().length, 0);
});
