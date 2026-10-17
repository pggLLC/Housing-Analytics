'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const PLACES_PATH = path.join(ROOT, 'data/hna/projections/places.json');
const HNA_HTML = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');

function freshRequire(relPath) {
  const abs = path.join(ROOT, relPath);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function closeEnough(actual, expected, label) {
  assert(Math.abs(actual - expected) < 0.000001, `${label}: got ${actual}, expected ${expected}`);
}

function assertProjectionData() {
  assert(HNA_HTML.includes('id="projectionCalculationTrace"'), 'HNA includes expandable projection trace');
  assert(HNA_HTML.includes('id="projectionCalculationTraceBody"'), 'HNA includes projection trace output region');
  assert(HNA_HTML.includes('County housing units needed over the 20-year horizon: the stored SDO county household series (the SDO household forecast where it is published, otherwise the components-of-change population forecast × constant base-year headship rate), divided by (1 − target vacancy); Hold recomputes households as population × the base-year headship rate, and Trend as population × a trended rate.'), 'HNA quotes the documented projection method');
  assert(HNA_HTML.includes('County source series: SDO components-change-county.csv (population) and, where published, household-county.csv (households). Place source series: data/hna/projections/places.json'), 'HNA quotes the documented county and place sources');
  assert(HNA_HTML.includes('Cross-county municipalities use combined-county denominators before applying the blended share.'), 'HNA quotes cross-county place provenance');
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

// The headship radio group exactly as the shipped page names and defaults
// it, so the fixtures exercise the control getAssumptions() reads rather
// than an invented one, and the calculator's default is the page's default.
const HEADSHIP_RADIO_RE = /<input type="radio" name="([^"]+)" value="(forecast|hold|trend)"( checked)?>\s*<span>([^<]+)<\/span>/g;
const readHeadshipRadios = (html) => [...html.matchAll(HEADSHIP_RADIO_RE)]
  .map((m) => ({ name: m[1], value: m[2], checked: !!m[3], label: m[4].trim() }));
const HEADSHIP_RADIOS = readHeadshipRadios(HNA_HTML);
assert(HEADSHIP_RADIOS.length === 3, `HNA page ships forecast, hold and trend headship radios (found ${HEADSHIP_RADIOS.length})`);
assert(new Set(HEADSHIP_RADIOS.map((r) => r.name)).size === 1, 'the three headship radios share one group name');
const HEADSHIP_RADIO_NAME = HEADSHIP_RADIOS[0].name;
const HEADSHIP_DEFAULT = (HEADSHIP_RADIOS.find((r) => r.checked) || {}).value;
const HEADSHIP_LABELS = Object.fromEntries(HEADSHIP_RADIOS.map((r) => [r.value, r.label]));
// hna-what-to-do.html renders the same calculator from the same controller, so
// its control must offer the same options with the same default.
assert.deepEqual(
  readHeadshipRadios(fs.readFileSync(path.join(ROOT, 'hna-what-to-do.html'), 'utf8')),
  HEADSHIP_RADIOS,
  'hna-what-to-do.html ships the same headship control (options, labels, default) as the HNA page'
);

function makeHtml() {
  return `<!doctype html>
    <html>
      <body>
        <select id="geoType"><option value="county" selected>County</option></select>
        <select id="geoSelect"><option value="08077" selected>Mesa County</option></select>
        <input id="assumpHorizon" value="20">
        <input id="assumpVacancy" value="5">
        ${HEADSHIP_RADIOS.map((r) => `<input type="radio" name="${r.name}" value="${r.value}"${r.checked ? ' checked' : ''}>`).join('\n        ')}
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
        <details id="projectionCalculationTrace"><summary>Show projection calculation trace</summary>
          <div id="projectionCalculationTraceBody"></div>
        </details>
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

/**
 * Under the default ("current") headship assumption the county and statewide
 * calculator reads the projection file's stored household series
 * (housing_need.households_dola) instead of recomputing population × the
 * base-year headship rate, and the trace names which series it read from the
 * file's own per-year label (housing_need.household_method) (#2260). Pinned as
 * agreement: a fixture per label, and the committed La Plata file against its
 * own label.
 */
async function assertCountyCalculatorReadsStoredHouseholds() {
  const FORECAST_WORDS = 'SDO county household forecast';
  const CONSTANT_WORDS = 'Constant base-year headship rate';
  const mesa = { geoType: 'county', geoid: '08077', label: 'Mesa County' };
  const render = async (proj, selection, headshipMode) => {
    const dom = new JSDOM(makeHtml(), { url: 'about:blank' });
    installBrowserStubs(dom, { places: {} });
    if (headshipMode) document.querySelector(`input[name="${HEADSHIP_RADIO_NAME}"][value="${headshipMode}"]`).checked = true;
    loadHnaModules();
    window.HNAState.state.currentSelection = selection;
    await window.HNAController.applyAssumptions(proj, selection);
    return {
      trace: document.getElementById('projectionCalculationTraceBody').textContent,
      headline: document.getElementById('statUnitsNeed').textContent,
    };
  };
  const withSeries = (households, method) => {
    const p = projectionFixture();
    p.housing_need.households_dola = households;
    if (method) p.housing_need.household_method = method;
    return p;
  };

  // The control's labels must agree with what the calculation does under each
  // option: the default option reads the stored series, which carries the SDO
  // household forecast, so its label has to name the forecast; the option that
  // holds the base-year rate has to say so.
  assert.equal(HEADSHIP_DEFAULT, 'forecast', 'the page defaults the headship control to the stored-series mode');
  assert(/forecast/i.test(HEADSHIP_LABELS[HEADSHIP_DEFAULT] || ''), `the default headship option is labelled as the forecast it reads (label: ${HEADSHIP_LABELS[HEADSHIP_DEFAULT]})`);
  assert(/hold/i.test(HEADSHIP_LABELS.hold || ''), `the constant base-year-rate option is labelled as holding the rate (label: ${HEADSHIP_LABELS.hold})`);
  // The math sentence under the control describes the options by name, so it
  // has to use the labels the control shows, on both pages.
  for (const [name, html] of [['housing-needs-assessment.html', HNA_HTML], ['hna-what-to-do.html', fs.readFileSync(path.join(ROOT, 'hna-what-to-do.html'), 'utf8')]]) {
    const sentence = html.match(/Transparent HNA math:[^<]*/);
    assert(sentence, `${name} carries the math sentence under the headship control`);
    for (const r of HEADSHIP_RADIOS) assert(sentence[0].includes(r.label), `${name}: the math sentence names the "${r.label}" option it describes: ${sentence[0].trim()}`);
  }

  // Forecast-labelled series under the page's default: the stored households drive the figure, not population × headship.
  let r = await render(withSeries([65000, 90000], ['sdo_household_forecast', 'sdo_household_forecast']), mesa);
  assert(r.trace.includes('90,000.0'), `trace shows the stored households (90,000.0): ${r.trace}`);
  assert(!r.trace.includes('77,187.5'), 'trace no longer shows population × base-year headship (77,187.5)');
  assert(r.trace.includes('47.368%'), 'trace shows the headship the stored series implies (90,000 ÷ 190,000)');
  assert(r.trace.includes('94,736.8'), 'trace shows stored households ÷ (1 − 5% vacancy)');
  assert.equal(r.headline, '24,737', 'headline is stored households ÷ 0.95 − 70,000 existing units');
  assert(r.trace.includes(FORECAST_WORDS) && !r.trace.includes(CONSTANT_WORDS), `trace names the household forecast when the file says so: ${r.trace}`);
  assert(r.trace.includes('household-county.csv'), 'trace names the household forecast source file');

  // Constant-headship-labelled series: same arithmetic, labelled as the fallback, never as the forecast.
  r = await render(withSeries([65000, 77187.5], ['constant_headship', 'constant_headship']), mesa);
  assert(r.trace.includes('77,187.5') && r.trace.includes(CONSTANT_WORDS) && !r.trace.includes(FORECAST_WORDS), 'trace names the constant-headship fallback when the file says so');
  assert.equal(r.headline, '11,250', 'constant-headship series reproduces the population × headship headline');

  // Unlabelled series (files built before the label existed) is used but never called a forecast.
  r = await render(withSeries([65000, 77187.5]), mesa);
  assert(r.trace.includes(CONSTANT_WORDS) && !r.trace.includes(FORECAST_WORDS), 'unlabelled series is not called a forecast');

  // No value at the horizon: population × headship, never 0, and no forecast claim.
  r = await render(withSeries([65000, null], ['sdo_household_forecast', null]), mesa);
  assert(r.trace.includes('77,187.5') && !r.trace.includes(FORECAST_WORDS), 'null at the horizon falls back to population × headship without claiming the forecast');
  assert.equal(r.headline, '11,250', 'fallback headline is population × headship ÷ 0.95 − existing units');

  // Hold: the control's name is a promise that the base-year rate is held, whatever the stored series says.
  r = await render(withSeries([65000, 90000], ['sdo_household_forecast', 'sdo_household_forecast']), mesa, 'hold');
  assert(r.trace.includes('77,187.5') && r.trace.includes('40.625%') && !r.trace.includes(FORECAST_WORDS), `Hold keeps population × the base-year rate and does not claim the forecast: ${r.trace}`);
  assert.equal(r.headline, '11,250', 'Hold headline is the base-year-rate figure');

  // Trend headship: the user asked for population × a trended headship rate; the stored series is not used.
  r = await render(withSeries([65000, 90000], ['sdo_household_forecast', 'sdo_household_forecast']), mesa, 'trend');
  assert(r.trace.includes('77,187.5') && r.trace.includes('Trend headship') && !r.trace.includes(FORECAST_WORDS), 'trend mode keeps population × trended headship and does not claim the forecast');

  // Statewide: a 'mixed' or forecast year draws households from household-county.csv too, so the trace names both sources.
  const colorado = { geoType: 'state', geoid: '08', label: 'Colorado (statewide)' };
  const stateWith = (method) => Object.assign(withSeries([65000, 90000], method), { countyFips: '08', stateFips: '08' });
  r = await render(stateWith(['mixed', 'mixed']), colorado);
  assert(r.trace.includes('90,000.0') && r.trace.includes('household-county.csv') && r.trace.includes('where published'), `mixed statewide trace names the household forecast source: ${r.trace}`);
  assert(r.trace.includes('a constant headship rate elsewhere') && !r.trace.includes(FORECAST_WORDS), 'mixed statewide trace says which counties are which, without calling the whole series the forecast');
  r = await render(stateWith(['sdo_household_forecast', 'sdo_household_forecast']), colorado);
  assert(r.trace.includes('household-county.csv') && r.trace.includes('SDO statewide household forecast'), 'forecast statewide trace names the household forecast and its source');
  r = await render(stateWith(['constant_headship', 'constant_headship']), colorado);
  assert(!r.trace.includes('household-county.csv') && r.trace.includes(CONSTANT_WORDS), 'constant-headship statewide trace does not name the household forecast source');

  // Committed La Plata file: the households row is the stored 2044 value, and the words match the file's own label.
  const laPlata = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/projections/08067.json'), 'utf8'));
  const idx = laPlata.years.indexOf(2044);
  const stored = laPlata.housing_need.households_dola[idx];
  assert(Number.isFinite(stored) && stored > 0, 'La Plata carries a stored 2044 household value (the check below is not vacuous)');
  const fmt = (v, d) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  r = await render(laPlata, { geoType: 'county', geoid: '08067', label: 'La Plata County' });
  assert(r.trace.includes(fmt(stored, 1)), `La Plata trace shows the stored 2044 households ${fmt(stored, 1)}: ${r.trace}`);
  assert(r.trace.includes(fmt(stored / 0.95, 1)), 'La Plata trace shows stored households ÷ (1 − 5% vacancy)');
  const label = Array.isArray(laPlata.housing_need.household_method) ? laPlata.housing_need.household_method[idx] : null;
  if (label === 'sdo_household_forecast') {
    assert(r.trace.includes(FORECAST_WORDS) && !r.trace.includes(CONSTANT_WORDS), `La Plata trace names the forecast its file carries: ${r.trace}`);
  } else {
    assert(r.trace.includes(CONSTANT_WORDS) && !r.trace.includes(FORECAST_WORDS), `La Plata trace names the constant-headship series its file carries: ${r.trace}`);
  }
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
  const trace = document.getElementById('projectionCalculationTraceBody').textContent;
  assert(trace.includes('190,000'), 'County trace shows the exact projected population used');
  assert(trace.includes('Direct county DOLA/SDO components-of-change projection'), 'County trace labels direct county provenance');
  assert(trace.includes('40.625%'), 'County trace shows the base-year headship rate used to three decimals');
  assert(trace.includes('77,187.5'), 'County trace shows projected households used');
  assert(trace.includes('81,250.0'), 'County trace shows vacancy-adjusted housing units used');
  assert(trace.includes('70,000'), 'County trace shows existing stock used');
  assert(trace.includes('11,250'), 'County trace reconciles to the headline incremental units');
  assert(trace.includes('Screening-grade estimate'), 'County trace carries screening-grade framing');
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
  const trace = document.getElementById('projectionCalculationTraceBody').textContent;
  assert(trace.includes('224'), 'Place trace uses the same stored result as the headline');
  assert(trace.includes('39.768%'), 'Place trace shows the stored ACS household share to three decimals');
  assert(trace.includes('no 50/50 blend is applied'), 'Household-only place trace labels the fallback method');
}

async function assertBlendedPlaceTrace() {
  const placeDoc = { places: { '0850480': {
    years: [2044], incremental_units_needed: [246], cross_county: true,
    shares: { household: 0.024246, permit: 0.014352, blended: 0.019299, permit_window: '2020-2024' },
  } } };
  const dom = new JSDOM(makeHtml(), { url: 'about:blank' });
  installBrowserStubs(dom, placeDoc);
  loadHnaModules();
  const selection = { geoType: 'place', geoid: '0850480', label: 'Milliken', contextCounty: '08123',
    profile: { DP02_0001E: 3000, DP04_0001E: 3200, DP05_0001E: 8000 } };
  window.HNAState.state.currentSelection = selection;
  await window.HNAController.applyAssumptions(projectionFixture(), selection);
  const trace = document.getElementById('projectionCalculationTraceBody').textContent;
  assert(trace.includes('246'), 'Blended place trace uses the exact stored headline result');
  assert(trace.includes('2.425%') && trace.includes('1.435%'), 'Blended place trace shows both stored shares to three decimals');
  assert(trace.includes('50% ACS household share + 50% BPS permit share'), 'Blended place trace labels the 50/50 allocation');
  assert(trace.includes('Combined-county denominators'), 'Cross-county place trace discloses combined-county provenance');
}

async function assertRealDataReconciliation() {
  const countyProjection = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/projections/08077.json'), 'utf8'));
  const millikenCountyProjection = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/projections/08123.json'), 'utf8'));
  const placeDoc = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));

  let dom = new JSDOM(makeHtml(), { url: 'about:blank' });
  installBrowserStubs(dom, placeDoc);
  loadHnaModules();
  let selection = { geoType: 'county', geoid: '08077', label: 'Mesa County' };
  window.HNAState.state.currentSelection = selection;
  await window.HNAController.applyAssumptions(countyProjection, selection);
  const countyHeadline = document.getElementById('statUnitsNeed').textContent;
  const countyTrace = document.getElementById('projectionCalculationTraceBody').textContent;
  assert(countyTrace.includes(countyHeadline), 'Real county trace reconciles to the displayed headline');
  assert(countyTrace.includes('190,165'), 'Real county trace pins the projected population used');
  assert(countyTrace.includes('41.738%'), 'Real county trace pins the base-year headship rate used to reproducible precision');
  assert(countyTrace.includes('79,371.1'), 'Real county trace pins the projected households used');
  assert(countyTrace.includes('5.000%'), 'Real county trace pins the target vacancy used to three decimals');
  assert(countyTrace.includes('83,548.5'), 'Real county trace pins the vacancy-adjusted units used');
  assert(countyTrace.includes('71,829'), 'Real county trace pins the existing housing stock used');

  dom = new JSDOM(makeHtml(), { url: 'about:blank' });
  installBrowserStubs(dom, placeDoc);
  loadHnaModules();
  selection = { geoType: 'place', geoid: '0850480', label: 'Milliken', contextCounty: '08123',
    profile: { DP02_0001E: 3000, DP04_0001E: 3200, DP05_0001E: 8000 } };
  window.HNAState.state.currentSelection = selection;
  await window.HNAController.applyAssumptions(millikenCountyProjection, selection);
  const placeHeadline = document.getElementById('statUnitsNeed').textContent;
  const placeTrace = document.getElementById('projectionCalculationTraceBody').textContent;
  assert(placeTrace.includes(placeHeadline), 'Real place trace reconciles to the displayed headline');
  assert(placeTrace.includes('2.425%') && placeTrace.includes('1.435%'), 'Real place trace displays both stored allocation shares to three decimals');
  assert(placeTrace.includes('50% ACS household share + 50% BPS permit share'), 'Real place trace labels the 50/50 allocation');
  assert(placeTrace.includes('Stored blended share used: 1.930%'), 'Real place trace displays the stored blended share to three decimals');
  return { countyHeadline, placeHeadline };
}

/**
 * The page and the score quote the same 20-year figure.
 *
 * They did not. data/hna/projections/places.json splits each county's DOLA
 * projection by a documented blend — 0.5 x household share + 0.5 x permit
 * share — and js/hna/hna-renderers.js has read it all along, so that is the
 * number on screen. build_ranking_index.py never opened the file: it
 * apportioned the same county projection by CURRENT POPULATION SHARE, which
 * assumes twenty years of growth distribute exactly like today's population.
 *
 * Longmont's page said 9,387 and its rank was computed from 3,693. Across the
 * 367 places where both methods produced a positive figure, 188 differed by
 * more than 25%. future_units_needed_20yr feeds future_pressure, which is 15%
 * of community_need_core.
 */
function assertRankingUsesTheSameLedgerAsThePage() {
  const ledger = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8')).places || {};
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/ranking-index.json'), 'utf8')).rankings || [];
  assert(Object.keys(ledger).length >= 400, 'the place ledger has shrunk; this check would pass on almost nothing');

  const mismatched = [];
  let compared = 0;
  for (const row of rows) {
    const entry = ledger[row.geoid];
    if (!entry || !Array.isArray(entry.incremental_units_needed) || !entry.incremental_units_needed.length) continue;
    const expected = Math.round(Number(entry.incremental_units_needed[entry.incremental_units_needed.length - 1]));
    // future_units_needed_20yr is now max(resident growth, workforce), so it
    // is no longer the same quantity the ledger produces. The ledger IS the
    // resident-growth producer, so it is compared against the growth component
    // — and the max is asserted separately below, which is strictly more than
    // this check covered before.
    const actual = row.metrics && (row.metrics.future_units_growth_20yr !== undefined
      ? row.metrics.future_units_growth_20yr
      : row.metrics.future_units_needed_20yr);
    compared += 1;
    if (actual !== expected) mismatched.push(`${row.name}: ranking ${actual}, ledger ${expected}`);
  }
  assert(compared >= 400, `only ${compared} places compared against the ledger`);

  // The published figure must never fall below the growth component it is a
  // max of. Without this, dropping the workforce half entirely would satisfy
  // the equality check above and this guard would go quiet about it.
  const belowGrowth = [];
  for (const row of rows) {
    const m = row.metrics || {};
    if (typeof m.future_units_growth_20yr !== 'number' || typeof m.future_units_needed_20yr !== 'number') continue;
    if (m.future_units_needed_20yr < m.future_units_growth_20yr) {
      belowGrowth.push(`${row.name}: published ${m.future_units_needed_20yr} below growth ${m.future_units_growth_20yr}`);
    }
  }
  assert.deepStrictEqual(belowGrowth, [],
    `the published 20-year figure is a max and must not be under its own growth component: ${belowGrowth.join('; ')}`);
  assert.deepStrictEqual(mismatched.slice(0, 5), [],
    `the ranking index and the page disagree about the 20-year figure for ` +
    `${mismatched.length} places: ${mismatched.slice(0, 3).join('; ')}`);

  // Every figure says which apportionment produced it, and every row without a
  // figure says nothing rather than implying one.
  const basisMissing = rows.filter((r) => r.metrics
    && r.metrics.future_units_needed_20yr !== null
    && r.metrics.future_units_needed_20yr !== undefined
    && !r.metrics.future_units_basis);
  assert.deepStrictEqual(basisMissing.map((r) => r.name).slice(0, 5), [],
    `${basisMissing.length} rows carry a 20-year figure with no stated basis`);
  const basisWithoutFigure = rows.filter((r) => r.metrics && r.metrics.future_units_basis
    && (r.metrics.future_units_needed_20yr === null || r.metrics.future_units_needed_20yr === undefined));
  assert.deepStrictEqual(basisWithoutFigure.map((r) => r.name).slice(0, 5), [],
    'a row names an apportionment method but carries no figure it could have produced');

  // The population-share fallback stays reachable for places the ledger misses,
  // rather than being deleted on the assumption that coverage is total.
  const builder = fs.readFileSync(path.join(ROOT, 'scripts/hna/build_ranking_index.py'), 'utf8');
  assert(/county_population_share/.test(builder),
    'the population-share fallback is gone; the ten unpopulated CDPs the ledger ' +
    'does not cover would silently lose their path');
  // Anchored on the CALL, not on the filename appearing somewhere in the file.
  // The first version of this line was `A || /places\.json/` and passed after
  // the loader was repointed, because the docstring above names the file while
  // explaining the fix. An `||` that broad turns an assertion into a search for
  // the word.
  assert(/_load_json\(os\.path\.join\([^)]*"projections",\s*"places\.json"\)\)/.test(builder),
    'build_ranking_index.py no longer loads data/hna/projections/places.json, so ' +
    'the page and the score are free to disagree again');
}

(async function main() {
  assertProjectionData();
  assertRankingUsesTheSameLedgerAsThePage();
  await assertCountyReconciliationNote();
  await assertHouseholdOnlyPlaceNote();
  await assertBlendedPlaceTrace();
  const reconciled = await assertRealDataReconciliation();
  await assertCountyCalculatorReadsStoredHouseholds();
  console.log(`HNA projection integrity tests passed (Mesa County ${reconciled.countyHeadline}; Milliken ${reconciled.placeHeadline})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
