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

function loadMethodologyRegistry() {
  const dom = new JSDOM('<main></main>', { url: 'http://127.0.0.1/', runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'js/methodology-explainer.js'), 'utf8'));
  const explainer = dom.window.MethodologyExplainer;
  if (explainer && typeof explainer.attach === 'function') { try { explainer.attach(); } catch (_) { /* registry only */ } }
  return explainer ? explainer.REGISTRY : null;
}

function closeEnough(actual, expected, label) {
  assert(Math.abs(actual - expected) < 0.000001, `${label}: got ${actual}, expected ${expected}`);
}

function assertProjectionData() {
  assert(HNA_HTML.includes('id="projectionCalculationTrace"'), 'HNA includes expandable projection trace');
  assert(HNA_HTML.includes('id="projectionCalculationTraceBody"'), 'HNA includes projection trace output region');
  const data = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  const places = data.places || {};

  // The method line and the sources line under the calculator are copy, so
  // they are not pinned to a phrasing. They are held to what they must agree
  // with: the same two lines on hna-what-to-do.html, the methodology
  // registry's 'dola-projection' entry (the explainer every page opens for
  // them), the options the control ships, the source files the controller
  // names, and the cross-county records the place file carries. Reword all
  // the surfaces together and this stays green; reword one and it fails.
  const lineText = (html, id) => {
    const found = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
    return found ? found[1].replace(/\s+/g, ' ').trim() : '';
  };
  const WTD_HTML = fs.readFileSync(path.join(ROOT, 'hna-what-to-do.html'), 'utf8');
  const method = lineText(HNA_HTML, 'projectionCalculationMethod');
  const sources = lineText(HNA_HTML, 'projectionCalculationSources');
  assert(method.length > 40 && sources.length > 40, 'the HNA page carries a method line and a sources line under the calculator');
  assert.strictEqual(lineText(WTD_HTML, 'projectionCalculationMethod'), method, 'hna-what-to-do.html states the same method as the HNA page');
  assert.strictEqual(lineText(WTD_HTML, 'projectionCalculationSources'), sources, 'hna-what-to-do.html states the same sources as the HNA page');
  const registry = loadMethodologyRegistry();
  const entry = registry && registry['dola-projection'];
  assert(entry && entry.what && entry.how, "the methodology registry explains the DOLA projection ('dola-projection')");
  assert.strictEqual(entry.what.replace(/\s+/g, ' ').trim(), method, "the methodology registry's 'what' is the page's method line");
  assert.strictEqual(entry.how.replace(/\s+/g, ' ').trim(), sources, "the methodology registry's 'how' is the page's sources line");
  // The method line names every headship option by the label the control
  // ships, and both household methods the stored series can carry.
  for (const r of HEADSHIP_RADIOS) assert(method.includes(r.label), `the method line names the ${r.label} option as the control labels it`);
  assert(/household forecast/i.test(method) && /headship rate/i.test(method), 'the method line names the household forecast and the headship-rate fallback the per-year method labels distinguish');
  // The sources line and the calculator's code (controller, utils, renderers)
  // agree on which source files are read.
  const calculatorSrc = ['js/hna/hna-controller.js', 'js/hna/hna-utils.js', 'js/hna/hna-renderers.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  for (const file of ['components-change-county.csv', 'household-county.csv', 'projections/places.json']) {
    assert(calculatorSrc.includes(file), `${file} is a source the calculator names, so the check is not vacuous`);
    assert.strictEqual(sources.includes(file), calculatorSrc.includes(file), `${file}: the sources line and the calculator agree on whether it is a source`);
  }
  // The cross-county sentence exists because the place file carries
  // cross-county records and the trace discloses their combined-county
  // denominators.
  const crossCounty = Object.values(places).filter((p) => p.cross_county === true).length;
  assert(crossCounty > 0, 'places.json carries cross-county records, so the disclosure has something to disclose');
  assert(calculatorSrc.includes('Combined-county denominators'), 'the trace discloses combined-county denominators for cross-county places');
  assert(/cross-county/i.test(sources) && /combined-county/i.test(sources), `the sources line discloses the combined-county denominators the trace reports (${sources})`);

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
        <div class="headship-buttons" role="radiogroup" aria-label="Headship assumption">${HEADSHIP_RADIOS.map((r) => `<label class="headship-label"><input type="radio" name="${r.name}" value="${r.value}"${r.checked ? ' checked' : ''}><span>${r.label}</span></label>`).join('\n        ')}</div>
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
  assert.equal(r.headline, '26,316', 'headline is the rise in homes needed: stored households ÷ 0.95, less the base year\'s 65,000 ÷ 0.95');
  assert(r.trace.includes(FORECAST_WORDS) && !r.trace.includes(CONSTANT_WORDS), `trace names the household forecast when the file says so: ${r.trace}`);
  assert(r.trace.includes('household-county.csv'), 'trace names the household forecast source file');

  // Constant-headship-labelled series: same arithmetic, labelled as the fallback, never as the forecast.
  r = await render(withSeries([65000, 77187.5], ['constant_headship', 'constant_headship']), mesa);
  assert(r.trace.includes('77,187.5') && r.trace.includes(CONSTANT_WORDS) && !r.trace.includes(FORECAST_WORDS), 'trace names the constant-headship fallback when the file says so');
  assert.equal(r.headline, '12,829', 'constant-headship series reproduces the population × headship headline');

  // Unlabelled series (files built before the label existed) is used but never called a forecast.
  r = await render(withSeries([65000, 77187.5]), mesa);
  assert(r.trace.includes(CONSTANT_WORDS) && !r.trace.includes(FORECAST_WORDS), 'unlabelled series is not called a forecast');

  // No value at the horizon: population × headship, never 0, and no forecast claim.
  r = await render(withSeries([65000, null], ['sdo_household_forecast', null]), mesa);
  assert(r.trace.includes('77,187.5') && !r.trace.includes(FORECAST_WORDS), 'null at the horizon falls back to population × headship without claiming the forecast');
  assert.equal(r.headline, '12,829', 'fallback headline is the rise in population × headship ÷ 0.95 from the base year');

  // Hold: the control's name is a promise that the base-year rate is held, whatever the stored series says.
  r = await render(withSeries([65000, 90000], ['sdo_household_forecast', 'sdo_household_forecast']), mesa, 'hold');
  assert(r.trace.includes('77,187.5') && r.trace.includes('40.625%') && !r.trace.includes(FORECAST_WORDS), `Hold keeps population × the base-year rate and does not claim the forecast: ${r.trace}`);
  assert.equal(r.headline, '12,829', 'Hold headline is the base-year-rate figure');

  // Trend headship: the user asked for population × a trended headship rate; the stored series is not used.
  r = await render(withSeries([65000, 90000], ['sdo_household_forecast', 'sdo_household_forecast']), mesa, 'trend');
  assert(r.trace.includes('77,187.5') && r.trace.includes('no ACS headship trend is available') && !r.trace.includes(FORECAST_WORDS),
    'trend mode without a slope on file holds the rate, says the trend is unavailable and does not claim the forecast');

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

/**
 * The household formation chart, the AMI-tier demand chart and the
 * reconciliation's households line quote the series the calculator reads, so
 * the headship option moves them with the headline rather than leaving them on
 * the stored series. Pinned as agreement: under each option the chart's horizon
 * value is the households the trace shows, the demand tiers sum to the chart,
 * and the reconciliation's delta is the chart's own change; under Hold and
 * Trend the chart's label and the reconciliation sentence describe the rate
 * arithmetic and the chart's note names the option as the page labels it;
 * under the default option the chart still draws the stored series.
 */
/**
 * A headship change moves the need figures, the trace and both household
 * charts, so the completed update is announced to screen readers through the
 * page's live region (Rule 11), naming the option as the control labels it. A
 * programmatic render does not announce: the page load has its own.
 */
async function assertHeadshipChangeIsAnnounced() {
  const dom = new JSDOM(makeHtml(), { url: 'about:blank' });
  installBrowserStubs(dom, { places: {} });
  loadHnaModules();
  const announcements = [];
  window.__announceUpdate = (m) => announcements.push(String(m));
  const selection = { geoType: 'county', geoid: '08077', label: 'Mesa County' };
  window.HNAState.state.currentSelection = selection;
  window.HNAState.state.derived = { geos: { '08077': { derived: { headship_slope_per_year: 0.001 } } } };
  const proj = projectionFixture();
  await window.HNAController.applyAssumptions(proj, selection);
  assert.strictEqual(announcements.length, 0, 'a programmatic render does not announce; the page load announces itself');
  window.HNAState.state.lastProj = proj;
  window.HNAState.state.current = selection;
  window.HNAController.wireAssumptionControlsForTest();
  const change = async (value) => {
    const before = announcements.length;
    const radio = document.querySelector(`input[name="${HEADSHIP_RADIO_NAME}"][value="${value}"]`);
    radio.checked = true;
    radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const started = Date.now();
    while (announcements.length === before && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(announcements.length, before + 1, `choosing ${value} announces the update once`);
    return announcements[announcements.length - 1];
  };
  let said = await change('hold');
  assert(said.includes(HEADSHIP_LABELS.hold) && /household charts/i.test(said) && /20-year/.test(said) && /5\.0%/.test(said),
    `the announcement names the option as labelled, the charts, the horizon and the vacancy (${said})`);
  said = await change('trend');
  assert(said.includes(HEADSHIP_LABELS.trend) && !/held/i.test(said), `with a slope on file the announcement names Trend without a held-rate caveat (${said})`);
  window.HNAState.state.derived = { geos: {} };
  said = await change('trend');
  assert(said.includes(HEADSHIP_LABELS.trend) && /no ACS headship trend/.test(said) && /held/.test(said),
    `without a slope the announcement says the rate is held (${said})`);
  said = await change(HEADSHIP_DEFAULT);
  assert(said.includes(HEADSHIP_LABELS[HEADSHIP_DEFAULT]), `returning to the default names it as labelled (${said})`);
}

async function assertHouseholdChartsFollowHeadshipOption() {
  const render = async (headshipMode, storedSeries = [65000, 80000], withSlope = true, geo = null) => {
    const html = makeHtml().replace('</body>', `
        <div><div class="chart-box"><canvas id="chartProjectedHH"></canvas></div></div>
        <div><div class="chart-box"><canvas id="chartHouseholdDemand"></canvas></div></div>
        <p id="householdDemandScopeCaption" hidden></p>
      </body>`);
    const dom = new JSDOM(html, { url: 'about:blank' });
    installBrowserStubs(dom, geo ? geo.placeDoc : { places: {} });
    // Keep each chart's config, so the charts can be read back.
    global.Chart = class { constructor(ctx, config) { this.config = config; this.data = config && config.data; } destroy() {} };
    window.Chart = global.Chart;
    dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
    if (headshipMode) document.querySelector(`input[name="${HEADSHIP_RADIO_NAME}"][value="${headshipMode}"]`).checked = true;
    loadHnaModules();
    const selection = geo ? geo.selection : { geoType: 'county', geoid: '08077', label: 'Mesa County' };
    if (geo) {
      const geoTypeEl = document.getElementById('geoType');
      geoTypeEl.innerHTML = '<option value="county">County</option><option value="place">Place</option><option value="cdp">CDP</option>';
      geoTypeEl.value = selection.geoType;
      document.getElementById('geoSelect').innerHTML = `<option value="${selection.geoid}" selected>${selection.label}</option>`;
    }
    window.HNAState.state.currentSelection = selection;
    // A county headship trend, so Trend differs from Hold; without it the
    // geography has no trend to offer.
    window.HNAState.state.derived = withSlope ? { geos: { '08077': { derived: { headship_slope_per_year: 0.001 } } } } : { geos: {} };
    const proj = geo ? geo.proj : projectionFixture();
    if (!geo) {
      proj.housing_need.households_dola = storedSeries;
      proj.housing_need.household_method = ['sdo_household_forecast', 'sdo_household_forecast'];
    }
    await window.HNAController.applyAssumptions(proj, selection);
    const charts = window.HNAState.charts || {};
    const note = (id) => {
      const box = document.getElementById(id).closest('.chart-box');
      const el = box.parentElement.querySelector(`[data-hna-chart-scope-note="${id}"]`);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    };
    return {
      formation: charts.chartProjectedHH,
      demand: charts.chartHouseholdDemand,
      formationNote: note('chartProjectedHH'),
      demandNote: note('chartHouseholdDemand'),
      demandScope: document.getElementById('chartHouseholdDemand').dataset.householdScope,
      rec: window.HNAState.state.needReconciliation,
      trace: document.getElementById('projectionCalculationTraceBody').textContent,
      trendRadio: (() => {
        const el = document.querySelector(`input[name="${HEADSHIP_RADIO_NAME}"][value="trend"]`);
        const group = el.closest('.headship-buttons');
        const note = document.getElementById('headshipTrendNote');
        return {
          disabled: el.disabled,
          title: el.closest('label').getAttribute('title') || '',
          note: note ? note.textContent.replace(/\s+/g, ' ').trim() : null,
          noteVisible: !!(note && !note.hidden && note.closest('body')),
          describedBy: (group.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
        };
      })(),
    };
  };
  const oneDecimal = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const tenths = (v) => Math.round(v * 10) / 10;
  const check = (r, expected, what) => {
    assert(r.formation && r.formation.data, `${what}: the households chart was not drawn`);
    assert(r.demand && r.demand.data, `${what}: the household demand chart was not drawn`);
    const drawn = r.formation.data.datasets[0].data;
    const last = drawn.length - 1;
    assert.deepStrictEqual(drawn.map(tenths), expected.map(tenths),
      `${what}: the households chart draws ${JSON.stringify(drawn)}; the option implies ${JSON.stringify(expected)}`);
    assert(r.trace.includes(oneDecimal(drawn[last])),
      `${what}: the trace's projected households are not the chart's horizon value ${oneDecimal(drawn[last])}`);
    const tiers = r.demand.data.datasets.length;
    assert(tiers > 1, `${what}: the demand chart has no AMI tiers to sum`);
    r.demand.data.labels.forEach((year, k) => {
      const sum = r.demand.data.datasets.reduce((acc, ds) => acc + ds.data[k], 0);
      assert(Math.abs(sum - drawn[k]) <= tiers, `${what}: demand tiers sum to ${sum} in ${year}; the households chart shows ${drawn[k]}`);
    });
    assert(r.rec && r.rec.households, `${what}: the reconciliation has no households line`);
    assert(Math.abs(r.rec.households.delta - (drawn[last] - drawn[0])) < 0.000001,
      `${what}: the reconciliation says ${r.rec.households.delta} households; the chart moves ${drawn[last] - drawn[0]}`);
  };
  const STORED_WORDS = 'DOLA\u2019s household series';

  // The default option: the stored series, as before, with no option note.
  let r = await render(null);
  check(r, [65000, 80000], 'default option');
  assert(!/held|trend/i.test(r.formation.data.datasets[0].label),
    `the default option's chart is not labelled as a rate assumption (label: ${r.formation.data.datasets[0].label})`);
  assert(r.rec.households.text.includes(STORED_WORDS), `the default option's reconciliation attributes the chart to the stored series (${r.rec.households.text})`);
  assert.strictEqual(r.rec.households.basis, 'stored');
  assert.strictEqual(r.formationNote, '', `the default county chart carries no option note (note: ${r.formationNote})`);
  const defaultLabel = r.formation.data.datasets[0].label;

  // Forecast with a year the stored series does not value (null, or a
  // non-positive value, which means unknown): the headline falls back to
  // population × the base-year rate for that year, so the charts and the
  // reconciliation must show the same filled value rather than a gap or 0.
  for (const gap of [null, 0]) {
    const what = `Forecast with ${gap === null ? 'a null' : 'a zero'} horizon year`;
    r = await render(null, [65000, gap]);
    check(r, [65000, 190000 * 0.40625], what);
    assert.notStrictEqual(r.formation.data.datasets[0].label, defaultLabel,
      `${what}: a filled series is not labelled as the plain stored series (label: ${r.formation.data.datasets[0].label})`);
    assert(/population × the base-year headship/.test(r.formationNote) && /1 of 2/.test(r.formationNote),
      `${what}: the chart's note names the fallback arithmetic and how many years it filled (note: ${r.formationNote})`);
    assert.strictEqual(r.rec.households.basis, 'forecast-filled', `${what}: reconciliation basis`);
    assert(r.rec.households.text.includes(STORED_WORDS) && /base-year headship/.test(r.rec.households.text),
      `${what}: the reconciliation names the stored series and the fallback (${r.rec.households.text})`);
    assert.strictEqual(r.demandScope, 'forecast-filled', `${what}: demand chart scope`);
  }

  // Hold: population × the base-year rate (65,000 / 160,000 = 40.625%).
  r = await render('hold');
  check(r, [160000 * 0.40625, 190000 * 0.40625], 'Hold');
  assert(/held/i.test(r.formation.data.datasets[0].label), `Hold's chart label says the rate is held (label: ${r.formation.data.datasets[0].label})`);
  assert(/held/i.test(r.rec.households.text) && !r.rec.households.text.includes(STORED_WORDS),
    `Hold's reconciliation describes the held rate, not the stored series (${r.rec.households.text})`);
  assert.strictEqual(r.rec.households.basis, 'hold');
  assert(r.formationNote.includes(HEADSHIP_LABELS.hold) && r.formationNote.includes(HEADSHIP_LABELS[HEADSHIP_DEFAULT]),
    `Hold's chart note names the option as the page labels it and the option that shows the stored series (note: ${r.formationNote})`);
  assert(r.demandNote.includes(HEADSHIP_LABELS.hold), `Hold's demand chart note names the option (note: ${r.demandNote})`);
  assert.strictEqual(r.demandScope, 'selected-headship', `Hold's demand chart declares its households as the selected option's`);

  // Trend: the rate moves by the county slope per step (40.625% + 0.1 point).
  r = await render('trend');
  check(r, [160000 * 0.40625, 190000 * (0.40625 + 0.001)], 'Trend');
  assert(/trend/i.test(r.formation.data.datasets[0].label), `Trend's chart label says the rate is trended (label: ${r.formation.data.datasets[0].label})`);
  assert(/trend/i.test(r.rec.households.text) && !r.rec.households.text.includes(STORED_WORDS),
    `Trend's reconciliation describes the trended rate, not the stored series (${r.rec.households.text})`);
  assert.strictEqual(r.rec.households.basis, 'trend');
  assert(r.formationNote.includes(HEADSHIP_LABELS.trend), `Trend's chart note names the option as the page labels it (note: ${r.formationNote})`);
  assert.strictEqual(r.trendRadio.disabled, false, 'with a slope on file the Trend option is offered');
  assert(r.trace.includes('Trend headship assumption used'), 'with a slope on file the trace says the trend was used');
  assert.strictEqual(r.trendRadio.note, null, 'with a slope on file no unavailable-Trend note is shown');
  assert(!r.trendRadio.describedBy.includes('headshipTrendNote'), 'with a slope on file the control is not described by a removed note');

  // Trend where the geography has no ACS headship trend on file (63 of 64
  // counties and the state today): a missing slope is unavailable, never 0, so
  // the option is disabled with the reason, the rate is held, and the chart,
  // its note, the trace and the reconciliation all say so instead of
  // presenting Hold's number as a trend.
  r = await render('trend', [65000, 80000], false);
  check(r, [160000 * 0.40625, 190000 * 0.40625], 'Trend without a slope');
  assert.strictEqual(r.trendRadio.disabled, true, 'without a slope the Trend option is disabled');
  assert(/no ACS headship trend/i.test(r.trendRadio.title), `the disabled option carries the reason (title: ${r.trendRadio.title})`);
  // A disabled radio takes no focus and a phone has no hover, so the reason
  // must also stand as visible text tied to the control, naming the option
  // as the page labels it.
  assert(r.trendRadio.noteVisible && /no ACS headship trend/.test(r.trendRadio.note) && r.trendRadio.note.includes(HEADSHIP_LABELS.trend),
    `the reason is visible text under the control (note: ${r.trendRadio.note})`);
  assert(r.trendRadio.describedBy.includes('headshipTrendNote'), `the radiogroup is described by that note (aria-describedby: ${r.trendRadio.describedBy.join(' ')})`);
  assert(/held/i.test(r.formation.data.datasets[0].label) && /no trend/i.test(r.formation.data.datasets[0].label),
    `the chart label says the rate is held and no trend exists (label: ${r.formation.data.datasets[0].label})`);
  assert(/no ACS headship trend is available/.test(r.formationNote) && r.formationNote.includes(HEADSHIP_LABELS.trend),
    `the chart note says no trend is available and names the option (note: ${r.formationNote})`);
  assert(r.trace.includes('no ACS headship trend is available') && !r.trace.includes('Trend headship assumption used'),
    'the trace says the trend is unavailable rather than claiming one was used');
  assert.strictEqual(r.rec.households.basis, 'trend-unavailable');
  assert(/no ACS headship trend/.test(r.rec.households.text) && !r.rec.households.text.includes(STORED_WORDS),
    `the reconciliation says why the rate is held (${r.rec.households.text})`);
  // Switching back to a geography with a slope re-enables the option.
  r = await render('hold');
  assert.strictEqual(r.trendRadio.disabled, false, 'a geography with a slope offers Trend again');
  assert.strictEqual(r.trendRadio.note, null, 'and the unavailable-Trend note is removed');

  // A place or CDP with no stored place projection (Carbonate and nine CDPs
  // in the committed places.json) is calculated like a county, so the control
  // must move it too: under Forecast the headline reads the county's stored
  // series scaled by the place's share of county population, the series the
  // households chart draws; under Hold both are population × the base-year
  // rate. Before, Forecast quietly gave Hold's headline beside a chart of the
  // stored series. The case uses a geography the page offers and the file
  // does not cover; if every one is covered some day, the branch still
  // exists, so it falls back to a geoid the file does not carry.
  const geoConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/geo-config.json'), 'utf8'));
  const realPlaceDoc = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  const uncovered = [
    ...(geoConfig.places || []).map((g) => ({ ...g, geoType: 'place' })),
    ...(geoConfig.cdps || []).map((g) => ({ ...g, geoType: 'cdp' })),
  ].find((g) => g.geoid && g.containingCounty && !realPlaceDoc.places[g.geoid]);
  const geo = uncovered || { geoid: '0899999', label: 'Uncovered (CDP)', containingCounty: '08045', geoType: 'cdp' };
  assert(!realPlaceDoc.places[geo.geoid], `${geo.label} has no stored place projection, so the case is the uncovered path`);
  const countyProj = JSON.parse(fs.readFileSync(path.join(ROOT, `data/hna/projections/${geo.containingCounty}.json`), 'utf8'));
  const countyHh = countyProj.housing_need.households_dola;
  const countyPop = countyProj.population_dola;
  assert(Array.isArray(countyHh) && countyHh.length === countyProj.years.length && countyHh.every((h) => typeof h === 'number' && h > 0),
    `${geo.containingCounty}'s stored household series is complete, so this is not a gap-fill case`);
  const profile = { DP05_0001E: 2000, DP02_0001E: 800, DP04_0001E: 1000 };
  const share0 = Math.min(0.98, Math.max(0.02, profile.DP05_0001E / countyProj.base.population));
  assert(share0 > 0.02 && share0 < 0.98, 'the place share is inside the clamp, so the expected series is the plain share');
  const placeGeo = {
    selection: { geoType: geo.geoType, geoid: geo.geoid, label: geo.label, contextCounty: geo.containingCounty, profile },
    proj: countyProj,
    placeDoc: realPlaceDoc,
  };
  const expectedForecast = countyHh.map((h) => h * share0);
  const expectedHold = countyPop.map((p) => p * share0 * (profile.DP02_0001E / profile.DP05_0001E));
  const horizonIdx = expectedForecast.length - 1;
  assert(Math.abs(expectedForecast[horizonIdx] - expectedHold[horizonIdx]) > 1,
    `${geo.containingCounty}'s forecast and the held rate differ at the horizon, so the two options are distinguishable`);
  r = await render(null, undefined, false, placeGeo);
  check(r, expectedForecast, `${geo.label} under the default option`);
  assert(/scaled to this place by its share of county population/.test(r.trace) && !/Constant base-year headship rate/.test(r.trace),
    `${geo.label}'s trace reads the county series scaled to the place, not a held rate`);
  assert.strictEqual(r.rec.households.basis, 'stored');
  assert(r.rec.households.text.includes('scaled to this place'), `${geo.label}'s reconciliation names the scaling (${r.rec.households.text})`);
  assert.strictEqual(r.demandScope, 'place-scaled');
  r = await render('hold', undefined, false, placeGeo);
  check(r, expectedHold, `${geo.label} under Hold`);
  assert(/held, as selected/.test(r.trace), `${geo.label}'s Hold trace says the rate is held`);
  assert.strictEqual(r.rec.households.basis, 'hold');
  assert.strictEqual(r.demandScope, 'selected-headship');
  assert(r.formationNote.includes(HEADSHIP_LABELS.hold) && r.formationNote.includes('scaled to this place'),
    `${geo.label}'s Hold chart note names the option and where Forecast's series comes from (note: ${r.formationNote})`);

  // The same geography with no ACS population on file (Hartsel CDP live): the
  // page falls back to county-level figures, the chart draws the county
  // series unscaled and says so, and the calculator keeps population × rate.
  // The reconciliation must then say the series is at county level, not
  // claim a scaling that did not happen.
  const unscaledGeo = { ...placeGeo, selection: { ...placeGeo.selection, profile: {} } };
  r = await render(null, undefined, false, unscaledGeo);
  assert.deepStrictEqual(r.formation.data.datasets[0].data.map(tenths), countyHh.map(tenths),
    `${geo.label} with no population share: the chart draws the county series unscaled`);
  assert.strictEqual(r.demandScope, 'county-unscaled');
  assert(r.trace.includes('could not be scaled to this place'), `${geo.label} with no population share: the trace says why the stored series is not read`);
  assert.strictEqual(r.rec.households.basis, 'stored');
  assert(r.rec.households.text.includes('at county level') && !r.rec.households.text.includes('scaled to this place by its share'),
    `${geo.label} with no population share: the reconciliation says the series is at county level (${r.rec.households.text})`);
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
  // Resident growth is the rise in homes needed from the base year (65,000
  // households ÷ 0.95), not homes needed less today's stock: no stock count
  // enters it since 2026-10-20.
  assert(trace.includes('68,421.1') && trace.includes('65,000'), 'County trace shows the homes required in the base year and the households they house');
  assert(!trace.includes('70,000'), 'County trace still subtracts the existing stock');
  assert(trace.includes('12,829'), 'County trace reconciles to the headline incremental units');
  assert(trace.includes('Screening-grade estimate'), 'County trace carries screening-grade framing');
}

/**
 * The reconciliation note names the series its figure comes from, read from
 * the projection file's own per-year label (housing_need.household_method),
 * so the wording and the data cannot drift apart (#2260). Held as agreement
 * on the committed La Plata file and on fixtures for each label.
 */
async function assertCountyNoteNamesTheStoredSeries() {
  const FORECAST_WORDS = "State Demography Office's county household forecast";
  const HEADSHIP_WORDS = 'constant base-year headship rate';
  const renderNote = async (proj, selection) => {
    const dom = new JSDOM(makeHtml(), { url: 'about:blank' });
    installBrowserStubs(dom, { places: {} });
    loadHnaModules();
    window.HNAState.state.currentSelection = selection;
    await window.HNAController.applyAssumptions(proj, selection);
    return document.getElementById('needNote').textContent;
  };

  // Committed data: La Plata, the county the method change was measured on.
  const laPlata = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/projections/08067.json'), 'utf8'));
  const methods = laPlata.housing_need.household_method;
  assert(Array.isArray(methods) && methods.length === laPlata.years.length, 'La Plata projection labels every year with household_method (the check below is not vacuous)');
  const endIdx = laPlata.years.indexOf(2044);
  const realNote = await renderNote(laPlata, { geoType: 'county', geoid: '08067', label: 'La Plata County' });
  const realFigure = window.HNAUtils.fmtNum(Math.round(laPlata.housing_need.incremental_units_needed_dola[endIdx]));
  assert(realNote.includes(`DOLA's county forecast projects about ${realFigure} additional units by 2044`), `County note quotes the stored 2044 figure ${realFigure}`);
  if (methods[endIdx] === 'sdo_household_forecast') {
    assert(realNote.includes(FORECAST_WORDS) && !realNote.includes(HEADSHIP_WORDS), `County note names the household forecast when the file says so: "${realNote}"`);
  } else if (methods[endIdx] === 'constant_headship') {
    assert(realNote.includes(HEADSHIP_WORDS) && !realNote.includes(FORECAST_WORDS), `County note names the headship fallback when the file says so: "${realNote}"`);
  } else {
    assert.fail(`La Plata 2044 household_method is ${methods[endIdx]}; expected the forecast or the headship fallback`);
  }

  // Fixtures: each label gets its own words, and a file without the label gets neither claim.
  const withMethod = (m) => Object.assign(projectionFixture(), { housing_need: { incremental_units_needed_dola: [0, 12727.456473387749], household_method: m } });
  const mesa = { geoType: 'county', geoid: '08077', label: 'Mesa County' };
  const headshipNote = await renderNote(withMethod(['constant_headship', 'constant_headship']), mesa);
  assert(headshipNote.includes(HEADSHIP_WORDS) && !headshipNote.includes(FORECAST_WORDS), 'constant_headship file: note names the headship rate, not the household forecast');
  const forecastNote = await renderNote(withMethod(['sdo_household_forecast', 'sdo_household_forecast']), mesa);
  assert(forecastNote.includes(FORECAST_WORDS) && !forecastNote.includes(HEADSHIP_WORDS), 'sdo_household_forecast file: note names the household forecast, not the headship rate');
  const unlabelledNote = await renderNote(projectionFixture(), mesa);
  assert(!unlabelledNote.includes(FORECAST_WORDS) && !unlabelledNote.includes(HEADSHIP_WORDS) && unlabelledNote.includes('published county series'), 'unlabelled file: note claims neither method');
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
  // Under the default option the county calculator reads the committed file's
  // stored household series, so the households, the rate they imply and the
  // vacancy-adjusted units are pinned to that file rather than to constants:
  // once the Mesa file carried the SDO household forecast (#2298) the
  // constant-headship pins (41.738%, 79,371.1, 83,548.5) no longer described
  // what the page shows.
  const mesaIdx = countyProjection.years.indexOf(countyProjection.baseYear + 20);
  const mesaStoredHh = countyProjection.housing_need.households_dola[mesaIdx];
  const mesaPop = countyProjection.population_dola[mesaIdx];
  assert(typeof mesaStoredHh === 'number' && mesaStoredHh > 0 && typeof mesaPop === 'number' && mesaPop > 0,
    'the committed Mesa County file carries a stored household value and a population for 2044');
  assert.equal(countyProjection.housing_need.household_method[mesaIdx], 'sdo_household_forecast',
    'the committed Mesa County file labels its 2044 households as the SDO household forecast');
  const oneDecimal = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const mesaRate = (mesaStoredHh / mesaPop * 100).toFixed(3) + '%';
  assert(countyTrace.includes(mesaRate), `Real county trace pins the headship rate the stored series implies (${mesaRate})`);
  assert(countyTrace.includes(oneDecimal(mesaStoredHh)), `Real county trace pins the stored projected households (${oneDecimal(mesaStoredHh)})`);
  assert(countyTrace.includes('5.000%'), 'Real county trace pins the target vacancy used to three decimals');
  assert(countyTrace.includes(oneDecimal(mesaStoredHh / 0.95)), `Real county trace pins the vacancy-adjusted units from the stored households (${oneDecimal(mesaStoredHh / 0.95)})`);
  const mesaBaseHh = countyProjection.housing_need.households_dola[countyProjection.years.indexOf(countyProjection.baseYear)];
  assert(typeof mesaBaseHh === 'number' && mesaBaseHh > 0, 'the committed Mesa County file carries stored households for its base year');
  assert(countyTrace.includes(oneDecimal(mesaBaseHh / 0.95)), `Real county trace pins the homes required in the base year from the stored households (${oneDecimal(mesaBaseHh / 0.95)})`);

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
  await assertCountyNoteNamesTheStoredSeries();
  await assertHouseholdOnlyPlaceNote();
  await assertBlendedPlaceTrace();
  const reconciled = await assertRealDataReconciliation();
  await assertCountyCalculatorReadsStoredHouseholds();
  await assertHouseholdChartsFollowHeadshipOption();
  await assertHeadshipChangeIsAnnounced();
  console.log(`HNA projection integrity tests passed (Mesa County ${reconciled.countyHeadline}; Milliken ${reconciled.placeHeadline})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
