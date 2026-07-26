'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const PLACES_PATH = path.join(ROOT, 'data/hna/projections/places.json');

function freshRequire(relPath) {
  const abs = path.join(ROOT, relPath);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function closeEnough(actual, expected, label) {
  assert(Math.abs(actual - expected) < 0.000001, `${label}: got ${actual}, expected ${expected}`);
}

function assertProjectionData() {
  const data = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  const places = data.places || {};
  const leadville = places['0844320'];
  assert(leadville, 'Leadville projection row should exist');
  assert.equal(leadville.shares.permit, null, 'Leadville zero-permit row should use household-only allocation');
  assert.equal(leadville.shares.blended, leadville.shares.household, 'Leadville blended share should equal household share');
  closeEnough(leadville.shares.household, 0.397682, 'Leadville household share');

  const milliken = places['0850480'];
  assert(milliken, 'Milliken positive-permit row should exist');
  closeEnough(milliken.shares.household, 0.024246, 'Milliken household share remains pinned');
  closeEnough(milliken.shares.permit, 0.014352, 'Milliken permit share remains pinned');
  closeEnough(milliken.shares.blended, 0.019299, 'Milliken blended share remains pinned');

  const exactZeroPermitCount = Object.values(places).filter((row) => row && row.shares && row.shares.permit === 0).length;
  assert.equal(exactZeroPermitCount, 0, 'No place projection row should retain shares.permit === 0');
}

function makeHtml() {
  return `<!doctype html>
    <html>
      <body>
        <select id="geoType"><option value="county" selected>County</option></select>
        <select id="geoSelect"><option value="08077" selected>Mesa County</option></select>
        <input id="assumpHorizon" value="20">
        <input id="assumpVacancy" value="5">
        <input type="radio" name="headship" value="current" checked>
        <div id="projectionScopeBadge" hidden></div>
        <nav id="hnaDecisionStrip" hidden>
          <a data-decision-key="need"><span id="decisionNeedValue"></span><span id="decisionNeedRead"></span></a>
          <a data-decision-key="pressure"><span id="decisionPressureValue"></span><span id="decisionPressureRead"></span></a>
          <a data-decision-key="production"><span id="decisionProductionValue"></span><span id="decisionProductionRead"></span></a>
          <a data-decision-key="ownership"><span id="decisionOwnershipValue"></span><span id="decisionOwnershipRead"></span></a>
          <a data-decision-key="land"><span id="decisionLandValue"></span><span id="decisionLandRead"></span></a>
          <a data-decision-key="confidence"><span id="decisionConfidenceValue"></span><span id="decisionConfidenceRead"></span></a>
        </nav>
        <div id="statBaseUnits"></div>
        <div id="statBaseUnitsSrc"></div>
        <div id="statTargetVac"></div>
        <div id="statUnitsNeed"></div>
        <div id="statNetMig"></div>
        <div id="needNote"></div>
      </body>
    </html>`;
}

function installBrowserStubs(dom, placeDoc) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.URLSearchParams = dom.window.URLSearchParams;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  const originalAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = function (type, listener, options) {
    if (type === 'DOMContentLoaded') return;
    return originalAddEventListener(type, listener, options);
  };
  global.Chart = class {
    constructor() {}
    destroy() {}
  };
  window.Chart = global.Chart;
  window.APP_CONFIG = { DATA_VERSION: 'test' };
  window.fetch = async function (url) {
    const raw = String(url);
    if (raw.includes('data/hna/projections/places.json')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(placeDoc),
      };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  global.fetch = window.fetch;
  window.fetchWithTimeout = (url) => window.fetch(url);
  global.fetchWithTimeout = window.fetchWithTimeout;
}

function loadHnaModules() {
  freshRequire('js/hna/hna-utils.js');
  freshRequire('js/hna/hna-renderers.js');
  freshRequire('js/hna/hna-controller.js');
}

function projectionFixture() {
  return {
    countyFips: '08077',
    baseYear: 2024,
    years: [2024, 2044],
    population_dola: [160000, 190000],
    population_trend: [160000, 190000],
    net_migration_20y: 8000,
    base: {
      population: 160000,
      households: 65000,
      housing_units: 70000,
    },
    housing_need: {
      incremental_units_needed_dola: [0, 12727.456473387749],
    },
    scenarios: {},
  };
}

async function assertCountyReconciliationNote() {
  const dom = new JSDOM(makeHtml(), { url: 'about:blank' });
  installBrowserStubs(dom, { places: {} });
  loadHnaModules();
  const selection = { geoType: 'county', geoid: '08077', label: 'Mesa County' };
  window.HNAState.state.currentSelection = selection;
  await window.HNAController.applyAssumptions(projectionFixture(), selection);
  const note = document.getElementById('needNote').textContent;
  assert(note.includes("DOLA's county forecast projects about 12,727 additional units by 2044"), 'County note should include DOLA reconciliation figure');
  assert(note.includes('the figure above is modeled from your selected horizon and target-vacancy assumptions and may differ'), 'County note should explain why the figures may differ');
}

async function assertHouseholdOnlyPlaceNote() {
  const placeDoc = {
    places: {
      '0844320': {
        years: [2044],
        incremental_units_needed: [224],
        shares: { household: 0.397682, permit: null, permit_window: '2020-2024' },
      },
    },
  };
  const dom = new JSDOM(makeHtml(), { url: 'about:blank' });
  installBrowserStubs(dom, placeDoc);
  loadHnaModules();
  const selection = {
    geoType: 'place',
    geoid: '0844320',
    label: 'Leadville',
    contextCounty: '08065',
    profile: {
      DP02_0001E: 1200,
      DP04_0001E: 1500,
      DP05_0001E: 2600,
    },
  };
  document.getElementById('geoType').value = 'place';
  document.getElementById('geoSelect').innerHTML = '<option value="0844320" selected>Leadville</option>';
  window.HNAState.state.currentSelection = selection;
  await window.HNAController.applyAssumptions(projectionFixture(), selection);
  const note = document.getElementById('needNote').textContent;
  assert(note.includes('Place-level projection uses ACS household share only (39.8%); Census BPS permit data unavailable for this place.'), 'Place note should use household-only wording when permit share is null');
  assert(!note.includes('50/50 blend'), 'Household-only place note should not mention a 50/50 blend');
}

(async function main() {
  assertProjectionData();
  await assertCountyReconciliationNote();
  await assertHouseholdOnlyPlaceNote();
  console.log('HNA projection integrity tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
