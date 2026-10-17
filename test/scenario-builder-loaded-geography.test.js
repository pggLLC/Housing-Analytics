#!/usr/bin/env node
'use strict';
// The Scenario Builder must never show a projection that is not built from
// the selected geography's own population. Until 2026-10-17 it ran on a
// placeholder of 18 male + 18 female cohorts of 1,000 people (36,000) before
// any geography loaded and after a failed load, under the selected place's
// name, and a later failed load left the previous place's data in use.
//
// Every expected figure here comes from the DOLA file the page would load,
// run through the same cohort model, not from pinned numbers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const dom = new JSDOM(`<!doctype html><body>
  <table><tbody id="sbResultsBody"></tbody></table>
  <button id="sbSaveScenario"></button><input id="sbScenarioName">
  <button id="sbClearResults"></button><div id="sbSavedScenarios"></div>
</body>`, { runScripts: 'outside-only', url: 'http://localhost/hna-scenario-builder.html' });
const w = dom.window;
for (const f of ['js/projections/cohort-component-model.js', 'js/projections/scenario-presets.js',
  'js/projections/scenario-storage.js', 'js/projections/scenario-builder.js']) w.eval(read(f));
const SB = w.ScenarioBuilder;
const body = () => w.document.getElementById('sbResultsBody');
const firstRowPop = () => {
  const tr = body().querySelector('tr');
  const cells = tr ? [...tr.children].map((td) => td.textContent) : [];
  return cells.length >= 2 ? Number(cells[1].replace(/,/g, '')) : null;
};
const states = [];
w.document.addEventListener('scenario-builder:state', (e) => states.push(e.detail));

// 1. First arrival: no geography, so no projection and no population figure.
SB.init({});
assert.equal(SB.hasProjection(), false, 'first arrival shows no projection');
assert.equal(SB.loadedGeography(), null, 'first arrival has no loaded geography');
assert.equal(body().querySelectorAll('tr').length, 1, 'one explanatory row, not a year table');
assert(!/\d{1,3},\d{3}/.test(body().textContent), `no population figure before a geography loads: "${body().textContent}"`);
assert.equal(states.at(-1).geography, null, 'the page is told nothing is loaded (save stays off)');

// 2. A geography loads: the table's base population is that file's own total.
const mesa = JSON.parse(read('data/hna/dola_sya/08077.json'));
const expectedBase = Math.round(new w.CohortComponentModel({
  basePopulation: w.CohortComponentModel.buildBasePopFromDola(mesa), baseYear: 2024, targetYear: 2050,
  scenario: w.ScenarioPresets.list[0].params, headshipRate: 0.38, vacancyTarget: 0.05, baseUnits: 0,
}).project()[0].totalPopulation);
SB.init({ dolaData: mesa, geoid: '08077', displayName: 'Mesa County' });
assert.equal(SB.hasProjection(), true, 'a loaded geography shows a projection');
assert.equal(firstRowPop(), expectedBase, 'first-year population equals the loaded DOLA file run through the model');
assert.notEqual(firstRowPop(), 36000, 'not the placeholder population');
assert.deepEqual(JSON.parse(JSON.stringify(states.at(-1).geography)), { geoid: '08077', displayName: 'Mesa County' }, 'the page is told which geography is loaded');

// 3. A later load fails: the earlier geography's data is cleared, not reused
//    under the new name, and the reason is shown.
const reason = 'Population data could not be loaded for Fruita, so no projection is shown.';
SB.init({ unavailableReason: reason });
assert.equal(SB.hasProjection(), false, 'failed load shows no projection');
assert.equal(SB.loadedGeography(), null, 'failed load clears the earlier geography');
assert.equal(body().textContent.trim(), reason, 'failed load shows its reason');

// 4. Save before any load records no geography, and repeated init() calls do
//    not bind a control twice (one click, one saved scenario).
w.localStorage.clear();
w.document.getElementById('sbSaveScenario').click();
const saved = w.ScenarioStorage.list();
assert.equal(saved.length, 1, 'one click saves once after several init() calls');
assert.equal(saved[0].geography, null, 'a scenario saved before loading names no place');
SB.init({ dolaData: mesa, geoid: '08077', displayName: 'Mesa County' });
w.document.getElementById('sbScenarioName').value = 'Mesa test';
w.document.getElementById('sbSaveScenario').click();
assert.deepEqual(JSON.parse(JSON.stringify(w.ScenarioStorage.get(w.ScenarioStorage.list()[0].id).geography)), { geoid: '08077', name: 'Mesa County' },
  'a scenario saved after loading names the loaded place');

// 5. The page wiring: save is enabled by the loaded-state event, never by a
//    timer, and the failed-load path no longer claims "statewide defaults".
const html = read('hna-scenario-builder.html');
assert(html.includes("'scenario-builder:state'"), 'the page listens for the loaded-geography state');
assert(!/setTimeout\([^)]*sbSaveBtn/.test(html.replace(/\s+/g, ' ')), 'save is not enabled on a timer');
assert(!/statewide defaults/i.test(html), 'the failed-load path does not claim statewide defaults');

// 6. The page's loader: changing the selection clears a loaded projection,
//    and a reply for a superseded load (success or failure, in any order)
//    never replaces what belongs to the current selection.
(async () => {
  // Read inline scripts through the DOM parser, not a regex over the markup.
  const loader = [...new JSDOM(html).window.document.querySelectorAll('script:not([src])')].map((s) => s.textContent)
    .find((src) => src.includes("data/hna/ranking-index.json") && src.includes('sbLoadCounty'));
  assert(loader, 'found the page geography loader script');
  const pg = new JSDOM(`<!doctype html><body>
    <select id="sbGeoSelect"></select><button id="sbLoadCounty"></button><div id="sbGeoStatus"></div>
    <table><tbody id="sbResultsBody"></tbody></table>
  </body>`, { runScripts: 'outside-only', url: 'http://localhost/hna-scenario-builder.html' });
  const pw = pg.window;
  for (const f of ['js/projections/cohort-component-model.js', 'js/projections/scenario-presets.js',
    'js/projections/scenario-storage.js', 'js/projections/scenario-builder.js']) pw.eval(read(f));
  const index = JSON.parse(read('data/hna/ranking-index.json'));
  const rows = Array.isArray(index.rankings) ? index.rankings : Object.values(index.rankings);
  const counties = rows.filter((r) => r.type === 'county').slice(0, 2);
  assert.equal(counties.length, 2, 'two counties to switch between');
  const pending = {};
  pw.safeFetchJSON = (url) => {
    if (url.includes('ranking-index')) return Promise.resolve(index);
    return new Promise((resolve, reject) => { pending[url] = { resolve, reject }; });
  };
  pw.eval(loader);
  pw.document.dispatchEvent(new pw.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 0));
  const sel = pw.document.getElementById('sbGeoSelect');
  const load = (geoid) => {
    sel.value = geoid; sel.dispatchEvent(new pw.Event('change'));
    pw.document.getElementById('sbLoadCounty').click();
    return `data/hna/dola_sya/${geoid}.json`;
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const fileFor = (g) => JSON.parse(read(`data/hna/dola_sya/${g}.json`));
  const [a, b] = counties.map((c) => c.geoid);

  // A loads, then the selection changes to B: A's projection is cleared.
  const urlA = load(a); pending[urlA].resolve(fileFor(a)); await tick();
  assert.equal(pw.ScenarioBuilder.loadedGeography().geoid, a, 'A loaded');
  sel.value = b; sel.dispatchEvent(new pw.Event('change'));
  assert.equal(pw.ScenarioBuilder.loadedGeography(), null, 'changing the selection clears the earlier projection');
  assert.equal(pw.ScenarioBuilder.hasProjection(), false, 'no projection shown for an unloaded selection');

  // Out of order: start A, then B; B succeeds, then the stale A fails or succeeds.
  const urlA2 = load(a); const urlB = load(b);
  pending[urlB].resolve(fileFor(b)); await tick();
  assert.equal(pw.ScenarioBuilder.loadedGeography().geoid, b, 'B loaded');
  pending[urlA2].reject(new Error('late failure')); await tick();
  assert.equal(pw.ScenarioBuilder.loadedGeography().geoid, b, 'a late failure for A does not clear B');
  const urlA3 = load(a); const urlB2 = load(b);
  pending[urlB2].resolve(fileFor(b)); await tick();
  pending[urlA3].resolve(fileFor(a)); await tick();
  assert.equal(pw.ScenarioBuilder.loadedGeography().geoid, b, 'a late success for A does not replace B');

  console.log(`scenario-builder-loaded-geography: PASS (Mesa base ${expectedBase.toLocaleString()})`);
})().catch((e) => { console.error(e); process.exit(1); });
