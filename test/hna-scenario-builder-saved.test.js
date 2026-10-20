#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function freshRequire(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function makeDom() {
  return new JSDOM(`
    <select id="projScenario">
      <option value="baseline">Baseline</option>
      <option value="low_growth">Low growth</option>
      <option value="high_growth">High growth</option>
    </select>
    <p id="customScenarioDisclosure" hidden></p>
    <canvas id="chartScenarioComparison"></canvas>
    <canvas id="chartProjectionDetail"></canvas>
  `, { url: 'http://127.0.0.1/housing-needs-assessment.html' });
}

function installDomGlobals(dom, charts) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.Chart = function ChartStub(ctx, config) {
    charts.push(config);
    return { destroy() {} };
  };
  window.Chart = global.Chart;
  window.HNAState = {
    charts: {},
    els: {
      geoType: { value: 'county' },
      geoSelect: { value: '08045' },
    },
  };
  window.HNAUtils = {
    fmtNum(value) { return String(Math.round(Number(value) || 0)); },
    PROJECTION_SCENARIOS: {
      baseline: { label: 'Baseline', color: '#4a90d9' },
      low_growth: { label: 'Low growth', color: '#e07b39' },
      high_growth: { label: 'High growth', color: '#4caf50' },
    },
  };
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return { canvas: this };
  };
}

const hnaHtml = read('housing-needs-assessment.html');
const controllerSrc = read('js/hna/hna-controller.js');
const renderersSrc = read('js/hna/hna-renderers.js');
const pkg = JSON.parse(read('package.json'));

const order = [
  'js/projections/scenario-presets.js',
  'js/projections/scenario-storage.js',
  'js/projections/cohort-component-model.js',
  'js/hna/hna-utils.js',
  'js/hna/hna-controller.js',
];
for (let i = 0; i < order.length - 1; i += 1) {
  assert(
    hnaHtml.indexOf(order[i]) >= 0 && hnaHtml.indexOf(order[i]) < hnaHtml.indexOf(order[i + 1]),
    `HNA script order keeps ${order[i]} before ${order[i + 1]}`,
  );
}

assert(controllerSrc.includes('ScenarioStorage.list()'), 'controller reads saved Scenario Builder scenarios');
assert(controllerSrc.includes("(Scenario Builder)'"), 'controller labels saved select options with Scenario Builder suffix');
assert(controllerSrc.includes('SCENARIO_BUILDER_PREFIX'), 'controller namespaces saved scenario option values');
assert(controllerSrc.includes('Custom (Scenario Builder) · 20-yr cohort model'), 'custom legend/disclosure label is pinned');
assert(controllerSrc.includes('M.changeFromSdo(b, params)'), 'controller recomputes saved scenario series with CohortComponentModel on the SDO baselines');
assert(controllerSrc.includes('M.countiesFor('), 'controller runs a saved scenario on the counties the Scenario Builder uses (agreement held by hna-saved-scenario-matches-builder.test.js)');
assert(controllerSrc.includes('base + share * change.population'), 'the custom line is the page\'s own line plus the scenario\'s change from SDO');
assert(controllerSrc.includes("M.paramsFromSaved(rec.parameters || {}"), 'scenarios saved by the earlier model are converted, not run as-is');
assert(!controllerSrc.includes('localStorage.setItem') || controllerSrc.includes('ScenarioStorage'), 'controller does not persist computed projection series');
assert(renderersSrc.includes('borderDash: [8, 4]'), 'custom scenario renders as a dashed line');

let charts = [];
let dom = makeDom();
installDomGlobals(dom, charts);
freshRequire('js/projections/scenario-storage.js');
freshRequire('js/projections/cohort-component-model.js');
freshRequire('js/hna/hna-renderers.js');

window.ScenarioStorage.save({
  id: 'custom-workforce-growth',
  name: 'Workforce growth',
  parameters: { births_pct: 103, deaths_pct: 99, migration_pct: 160 },
});
assert.equal(window.ScenarioStorage.list().length, 1, 'seeded localStorage fixture produces one saved scenario');

// The custom line the controller draws: the page's own line plus the change
// the saved settings make to SDO's forecast, over the chart's years only.
const mesaBaseline = JSON.parse(read('data/hna/scenario-baseline/08077.json'));
const hnaYears = Array.from({ length: 21 }, (_, idx) => 2024 + idx);
const hnaLine = hnaYears.map((_, idx) => 20000 + idx * 100);
const hnaLastYear = hnaYears[hnaYears.length - 1];
const lineFor = (params) => {
  const byYear = {};
  window.CohortComponentModel.changeFromSdo(mesaBaseline, params).forEach(row => { byYear[row.year] = row; });
  return hnaYears.map((year, idx) => byYear[year] && {
    year, population: hnaLine[idx] + byYear[year].population, pop: hnaLine[idx] + byYear[year].population,
  }).filter(Boolean);
};
const customSeries = lineFor(window.ScenarioStorage.list()[0].parameters);
assert.equal(customSeries.at(-1).year, hnaLastYear, 'custom 2050 Builder series is truncated at the HNA chart last year');
assert(!customSeries.some(row => row.year > hnaLastYear), 'custom series has no padded or extrapolated tail past the HNA chart');
assert.deepEqual(lineFor(window.CohortComponentModel.DEFAULT_PARAMS).map(r => r.population), hnaLine,
  'a saved scenario at 100% draws exactly the page\'s own line');
assert(customSeries.at(-1).population > hnaLine.at(-1), 'more migration than SDO draws above the page\'s line in Mesa County');

const customOpt = document.createElement('option');
customOpt.value = 'builder:custom-workforce-growth';
customOpt.textContent = 'Workforce growth (Scenario Builder)';
customOpt.dataset.scenarioBuilderOption = 'true';
document.getElementById('projScenario').appendChild(customOpt);
document.getElementById('projScenario').value = 'builder:custom-workforce-growth';
window.HNARenderers._renderScenarioSection(
  {
    population_dola: hnaYears.map((_, idx) => 20000 + idx * 100),
    scenarios: {},
    housing_need: {},
  },
  hnaYears.map((_, idx) => 20000 + idx * 100),
  hnaYears,
  2024,
  '08045',
  {
    c1: '#4a90d9',
    c5: '#e07b39',
    c6: '#4caf50',
    text: '#111827',
    muted: '#6b7280',
    border: '#e5e7eb',
  },
  {
    customScenario: {
      active: true,
      key: 'builder:custom-workforce-growth',
      name: 'Workforce growth',
      label: 'Custom (Scenario Builder) · 20-yr cohort model',
      color: '#a855f7',
      series: customSeries,
    },
  },
);

assert.equal(charts.length, 2, 'scenario renderer produced comparison and detail charts');
const comparisonLabels = charts[0].data.datasets.map(ds => ds.label);
assert(comparisonLabels.includes('Custom (Scenario Builder) · 20-yr cohort model'), 'comparison chart renders custom scenario label');
const customDataset = charts[0].data.datasets.find(ds => ds.label === 'Custom (Scenario Builder) · 20-yr cohort model');
assert.deepEqual(customDataset.borderDash, [8, 4], 'comparison custom scenario is visually distinct');
assert.equal(customDataset.data.length, customSeries.length, 'comparison custom dataset uses the truncated series only');
assert.equal(charts[1].data.datasets[0].label, 'Custom (Scenario Builder) · 20-yr cohort model', 'detail chart uses custom disclosure label');

charts = [];
dom = makeDom();
installDomGlobals(dom, charts);
freshRequire('js/hna/hna-renderers.js');
window.HNARenderers._renderScenarioSection(
  {
    population_dola: hnaYears.map((_, idx) => 20000 + idx * 100),
    scenarios: {},
    housing_need: {},
  },
  hnaYears.map((_, idx) => 20000 + idx * 100),
  hnaYears,
  2024,
  '08045',
  {
    c1: '#4a90d9',
    c5: '#e07b39',
    c6: '#4caf50',
    text: '#111827',
    muted: '#6b7280',
    border: '#e5e7eb',
  },
  {}
);
assert(!charts[0].data.datasets.some(ds => /Scenario Builder/.test(ds.label)), 'empty storage/no active custom scenario leaves built-in comparison unchanged');

assert(pkg.scripts['test:hna'].includes('node test/hna-scenario-builder-saved.test.js'), 'test:hna runs the saved Scenario Builder HNA guard');

console.log('hna-scenario-builder-saved: PASS');
