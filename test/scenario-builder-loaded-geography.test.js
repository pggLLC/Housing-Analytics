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

console.log(`scenario-builder-loaded-geography: PASS (Mesa base ${expectedBase.toLocaleString()})`);
