'use strict';

// A saved Scenario Builder scenario draws the same change on the HNA page as
// the Scenario Builder shows for the same place.
//
// The HNA page's custom line is its own population line plus the change the
// saved births, deaths and migration percentages make to SDO's forecast. The
// builder shows that change on its own population line. Both take the place's
// share of every county it sits in (CohortComponentModel.countiesFor), so for
// a county, a town in one county and a town across several (Arvada, Aurora,
// ...) the two changes must be equal year by year. Found by the Codex review
// of #2407: the HNA page read only the place's primary county, so a
// cross-county town's line moved by a different amount on each page.
//
// Held as agreement: the HNA side is the controller's own overlay builder
// (window.__HNA_buildScenarioBuilderOverlayForTest), fed by the committed
// files; the builder side is ScenarioBuilder.homesSeries on contextFor.
// Statewide, which the builder does not model, the page draws no line and
// says why rather than drawing nothing silently. A saved scenario whose files
// finish loading after the reader has moved on draws nothing (Codex, #2407).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

function freshRequire(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

const dom = new JSDOM(`<!doctype html><html><body>
  <select id="geoType"><option value="county" selected>county</option></select>
  <select id="geoSelect"><option value="08077" selected>Mesa County</option></select>
  <select id="projScenario"><option value="baseline">SDO forecast</option></select>
  <p id="customScenarioDisclosure" hidden></p>
</body></html>`, { url: 'http://127.0.0.1/housing-needs-assessment.html' });
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.localStorage = dom.window.localStorage;
global.URLSearchParams = dom.window.URLSearchParams;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.Blob = dom.window.Blob;
global.CustomEvent = dom.window.CustomEvent;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
const add = dom.window.document.addEventListener.bind(dom.window.document);
dom.window.document.addEventListener = (type, l, o) => (type === 'DOMContentLoaded' ? undefined : add(type, l, o));
global.Chart = class { constructor(ctx, config) { this.config = config; } destroy() {} };
window.Chart = global.Chart;
dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
window.APP_CONFIG = { DATA_VERSION: 'test' };
const requested = [];
let unreachable = null; // a path the test makes fail to load
window.fetch = async (url) => {
  const rel = String(url).replace(/^\.?\//, '').split('?')[0];
  const abs = path.join(ROOT, rel);
  requested.push(rel);
  if (rel === unreachable || !rel.startsWith('data/') || !fs.existsSync(abs)) return { ok: false, status: 404, text: async () => '', json: async () => null };
  const body = fs.readFileSync(abs, 'utf8');
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
};
global.fetch = window.fetch;
window.fetchWithTimeout = (u) => window.fetch(u);
global.fetchWithTimeout = window.fetchWithTimeout;

freshRequire('js/projections/cohort-component-model.js');
freshRequire('js/projections/scenario-presets.js');
freshRequire('js/projections/scenario-storage.js');
freshRequire('js/projections/scenario-builder.js');
freshRequire('js/hna/hna-utils.js');
freshRequire('js/hna/hna-renderers.js');
freshRequire('js/hna/hna-controller.js');

const M = window.CohortComponentModel;
const SB = window.ScenarioBuilder;
const overlay = window.__HNA_buildScenarioBuilderOverlayForTest;
assert.strictEqual(typeof overlay, 'function', 'the controller exposes its saved-scenario overlay for this test');

const params = { births_pct: 103, deaths_pct: 99, migration_pct: 150 };
window.ScenarioStorage.save({ id: 'custom-agreement', name: 'Agreement', parameters: params });
const key = 'builder:custom-agreement';

const index = readJson('data/hna/ranking-index.json');
const rows = Array.isArray(index.rankings) ? index.rankings : Object.values(index.rankings);
const ledger = readJson('data/hna/projections/places.json').places;
const cross = readJson('data/hna/cross-county-places.json').places;
const data = { baselines: {}, projections: {}, ledger, cross };
for (const r of rows.filter((x) => x.type === 'county')) {
  data.baselines[r.geoid] = readJson(`data/hna/scenario-baseline/${r.geoid}.json`);
  data.projections[r.geoid] = readJson(`data/hna/projections/${r.geoid}.json`);
}
const years = Array.from({ length: 21 }, (_, i) => 2024 + i);
const zeroLine = years.map(() => 0);

function builderChange(r) {
  const m = r.metrics || {};
  const ctx = SB.contextFor({
    geoid: r.geoid, name: r.name, type: r.type, containingCounty: r.containingCounty,
    population: m.population, inCommuters: m.incommuter_need_units, inCommutersHigh: m.incommuter_need_units_high,
  }, data);
  if (ctx.unavailableReason) return null;
  const run = SB.homesSeries(ctx, params);
  const def = SB.homesSeries(ctx, M.DEFAULT_PARAMS);
  const byYear = {};
  run.forEach((row, i) => { byYear[row.year] = { change: row.population - def[i].population, counties: ctx.counties.length }; });
  return byYear;
}

(async () => {
  // Every cross-county town, plus a county and a town in one county.
  const picked = rows.filter((r) => r.type !== 'county' && cross[r.geoid] && ledger[r.geoid]);
  const crossCount = picked.length;
  picked.push(rows.find((r) => r.geoid === '08077'), rows.find((r) => r.geoid === '0828745'));
  let compared = 0;
  let multiCounty = 0;
  for (const r of picked) {
    const want = builderChange(r);
    assert(want, `${r.name}: the builder has a projection`);
    const countyFips5 = r.type === 'county' ? r.geoid : (ledger[r.geoid] && ledger[r.geoid].containing_county) || r.containingCounty;
    const share = r.type === 'county' ? null : ledger[r.geoid].shares.blended;
    const selection = { geoType: r.type, geoid: r.geoid, label: r.name };
    const got = await overlay(key, readJson(`data/hna/projections/${countyFips5}.json`), zeroLine, years, 2024, countyFips5, selection, share);
    assert(got && got.series && got.series.length === years.length, `${r.name}: the HNA page draws the saved scenario for all ${years.length} years`);
    for (const row of got.series) {
      const w = want[row.year];
      assert(Math.abs(row.population - w.change) < 0.01,
        `${r.name} ${row.year}: the HNA page moves the line by ${row.population.toFixed(2)}, the builder by ${w.change.toFixed(2)}`);
    }
    if (want[2044].counties > 1) multiCounty += 1;
    compared += 1;
  }
  assert(crossCount >= 20, `checked ${crossCount} cross-county towns (expected the 26 in cross-county-places.json)`);
  assert(multiCounty >= 20, `${multiCounty} of them ran on more than one county`);

  // Statewide: no line, no request for a statewide file that does not exist,
  // and the page says why.
  const disclosure = document.getElementById('customScenarioDisclosure');
  const says = () => !disclosure.hidden && disclosure.textContent.trim() && !/custom line is/.test(disclosure.textContent);
  requested.length = 0;
  const state = await overlay(key, readJson('data/hna/projections/08077.json'), zeroLine, years, 2024, '08',
    { geoType: 'state', geoid: '08', label: 'Colorado' }, null);
  assert.strictEqual(state, null, 'statewide draws no saved-scenario line');
  assert(!requested.some((u) => /scenario-baseline\/08\.json$/.test(u)), 'statewide asks for no statewide baseline file');
  assert(says(), 'statewide: the page says why there is no line, instead of describing one');
  const statewideReason = disclosure.textContent;

  // A county file that fails to load: no line, and a reason of its own.
  window.HNAState.state.scenarioBaselines = {};
  unreachable = 'data/hna/scenario-baseline/08059.json';
  const arvada = rows.find((r) => r.geoid === '0803455');
  const failed = await overlay(key, readJson('data/hna/projections/08059.json'), zeroLine, years, 2024, '08059',
    { geoType: 'place', geoid: arvada.geoid, label: arvada.name }, ledger[arvada.geoid].shares.blended);
  unreachable = null;
  assert.strictEqual(failed, null, 'a missing county file draws no partial line');
  assert(says() && disclosure.textContent !== statewideReason, 'and the page says the files did not load');

  // A saved scenario's files still loading when the reader switches back to a
  // built-in scenario: the later render stands, and the earlier one, resuming,
  // draws no saved line, shows no disclosure and exports no saved series.
  // Run through the page's own applyAssumptions.
  const sel = document.getElementById('projScenario');
  const opt = document.createElement('option');
  opt.value = key; opt.textContent = 'Agreement';
  sel.appendChild(opt);
  const R = window.HNARenderers;
  const renderScenario = R._renderScenarioSection;
  const drawn = [];
  R._renderScenarioSection = function (...a) {
    drawn.push((a[6] && a[6].customScenario && a[6].customScenario.key) || null);
    return renderScenario.apply(this, a);
  };
  window.HNAState.state.scenarioBaselines = {};
  const plainFetch = window.fetch;
  let release;
  let reached;
  const held = new Promise((res) => { release = res; });
  const atLoad = new Promise((res) => { reached = res; });
  window.fetch = async (u) => (/scenario-baseline\/08077\.json$/.test(String(u).split('?')[0]) ? (reached(), held.then(() => plainFetch(u))) : plainFetch(u));
  global.fetch = window.fetch;
  const mesa = { geoType: 'county', geoid: '08077', label: 'Mesa County', profile: { DP02_0001E: 64000, DP04_0001E: 70000, DP05_0001E: 160000 } };
  const mesaProj = readJson('data/hna/projections/08077.json');
  window.HNAState.state.currentSelection = mesa;
  sel.value = key;
  const earlier = window.HNAController.applyAssumptions(mesaProj, mesa);
  await Promise.race([atLoad, earlier.then(() => { throw new Error('the saved-scenario render finished without loading its county file'); })]);
  sel.value = 'baseline';
  await window.HNAController.applyAssumptions(mesaProj, mesa);
  assert.deepStrictEqual(drawn, [null], 'the later, built-in render drew the scenario chart once, with no saved line');
  release();
  await earlier;
  window.fetch = plainFetch; global.fetch = plainFetch;
  assert.deepStrictEqual(drawn, [null], 'a saved-scenario render that resumed after the reader switched back redrew the chart');
  assert(document.getElementById('customScenarioDisclosure').hidden, 'and must not show the saved scenario\'s disclosure');
  assert(!Object.keys(window.HNAState.state.lastScenarioSeries || {}).includes(key), 'or export its series');
  assert(Object.keys(window.HNAState.state.lastScenarioSeries || {}).includes('baseline'), 'the later render exported the built-in series');

  console.log(`hna-saved-scenario-matches-builder: PASS (${compared} places, ${multiCounty} across more than one county, equal year by year on both pages; a stale saved-scenario load draws nothing)`);
})().catch((e) => { console.error(e); process.exit(1); });
