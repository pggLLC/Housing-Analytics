'use strict';

const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SURPLUS_TEXT = 'Estimated surplus of 65 units (excess capacity)';

function freshRequire(relPath) {
  const abs = path.join(ROOT, relPath);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function makeProjectionFixture() {
  return {
    baseYear: 2024,
    countyFips: '08121',
    years: [2024, 2044],
    population_dola: [100000, 110000],
    population_trend: [100000, 110000],
    base: {
      population: 100000,
      housing_units: 48000,
      households: 44000,
    },
    net_migration_20y: 1200,
    scenarios: {},
  };
}

function makePlaceProjectionDoc() {
  return {
    places: {
      '0800925': {
        years: [2044],
        incremental_units_needed: [-65],
        shares: { household: 0.006, permit: 0.005, blended: 0.0055, permit_window: '2020-2024' },
      },
      '0828745': {
        years: [2044],
        incremental_units_needed: [819],
        shares: { household: 0.18, permit: 0.20, blended: 0.19, permit_window: '2020-2024' },
      },
    },
  };
}

function makeHtml() {
  return `<!doctype html>
    <html>
      <body>
        <select id="geoType"><option value="place" selected>Place</option></select>
        <select id="geoSelect"><option value="0800925" selected>Akron</option></select>
        <input id="assumpHorizon" value="20">
        <input id="assumpVacancy" value="5">
        <input type="radio" name="headship" value="current" checked>
        <div id="projectionScopeBadge" hidden></div>
        <div id="hnaLiveRegion"></div>
        <button id="btnPdf"></button>
        <button id="btnCsv"></button>
        <button id="btnXlsx"></button>
        <nav id="hnaDecisionStrip" hidden>
          <a data-decision-key="need"><span id="decisionNeedValue"></span><span id="decisionNeedRead"></span></a>
          <a data-decision-key="pressure"><span id="decisionPressureValue"></span><span id="decisionPressureRead"></span></a>
          <a data-decision-key="production"><span id="decisionProductionValue"></span><span id="decisionProductionRead"></span></a>
          <a data-decision-key="ownership"><span id="decisionOwnershipValue"></span><span id="decisionOwnershipRead"></span></a>
          <a data-decision-key="land"><span id="decisionLandValue"></span><span id="decisionLandRead"></span></a>
          <a data-decision-key="confidence"><span id="decisionConfidenceValue"></span><span id="decisionConfidenceRead"></span></a>
        </nav>
        <div class="stat"><div class="k">Current housing units</div><div id="statBaseUnits"></div><div id="statBaseUnitsSrc"></div></div>
        <div id="statTargetVac"></div>
        <div id="statUnitsNeed"></div>
        <div id="statNetMig"></div>
        <div id="needNote"></div>
        <div id="statPop"></div>
        <div id="statMhi"></div>
        <div id="statHomeValue"></div>
        <div id="statRent"></div>
        <div id="statTenure"></div>
        <div id="statRentBurden"></div>
        <div id="statIncomeNeed"></div>
        <div id="statCommute"></div>
        <div id="statLihtcCount"></div>
        <div id="statLihtcUnits"></div>
        <div id="statQctTracts"></div>
        <div id="statDdaStatus"></div>
      </body>
    </html>`;
}

function installBrowserStubs(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  global.URLSearchParams = dom.window.URLSearchParams;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
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
  window.fetchWithTimeout = (url) => window.fetch(url);
  global.fetchWithTimeout = window.fetchWithTimeout;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  global.requestAnimationFrame = window.requestAnimationFrame;
  window.HTMLCanvasElement.prototype.getContext = function () {
    return { canvas: this };
  };
  window.HTMLAnchorElement.prototype.click = function () {};

  const placeDoc = makePlaceProjectionDoc();
  window.__placeProjectionFetches = 0;
  window.fetch = async function (url) {
    const raw = String(url);
    if (raw.includes('data/hna/projections/places.json')) {
      window.__placeProjectionFetches += 1;
      return {
        ok: true,
        status: 200,
        json: async () => placeDoc,
        text: async () => JSON.stringify(placeDoc),
      };
    }
    return { ok: false, status: 404, json: async () => null };
  };
  global.fetch = window.fetch;

  let capturedBlob = null;
  window.URL.createObjectURL = function (blob) {
    capturedBlob = blob;
    return 'blob:hna-test';
  };
  window.URL.revokeObjectURL = function () {};
  global.URL = window.URL;
  global.Blob = window.Blob;
  Object.defineProperty(window, '__capturedExportBlob', {
    get() { return capturedBlob; },
  });

  const pdfText = [];
  class PdfStub {
    constructor() {
      this.internal = {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 792,
        },
        getNumberOfPages: () => 1,
      };
    }
    addImage() {}
    addPage() {}
    line() {}
    rect() {}
    roundedRect() {}
    save() {}
    setDrawColor() {}
    setFillColor() {}
    setFont() {}
    setFontSize() {}
    setLineWidth() {}
    setPage() {}
    setTextColor() {}
    splitTextToSize(value) {
      if (Array.isArray(value)) return value.map(String);
      return [String(value == null ? '' : value)];
    }
    text(value) {
      if (Array.isArray(value)) {
        value.forEach((v) => pdfText.push(String(v)));
      } else {
        pdfText.push(String(value == null ? '' : value));
      }
    }
  }
  window.jspdf = { jsPDF: PdfStub };
  window.__pdfText = pdfText;
}

function loadHnaModules() {
  freshRequire('js/hna/hna-utils.js');
  freshRequire('js/hna/hna-renderers.js');
  freshRequire('js/hna/hna-export.js');
  freshRequire('js/hna/hna-controller.js');
}

function setSelection(selection) {
  window.HNAState.state.currentSelection = selection;
  window.HNAState.state.currentProfile = selection.profile || {};
  const geoType = document.getElementById('geoType');
  const geoSelect = document.getElementById('geoSelect');
  geoType.value = selection.geoType;
  geoSelect.innerHTML = `<option value="${selection.geoid}" selected>${selection.label}</option>`;
  geoSelect.value = selection.geoid;
}

async function applyFixture(selection) {
  setSelection(selection);
  await window.HNAController.applyAssumptions(makeProjectionFixture(), selection);
}

function assertNoRawSurplusNegative(surfaceText) {
  assert(!surfaceText.includes('-65 net new total units'), 'surplus must not render as "-65 net new total units"');
  assert(!/Units needed[\s\S]{0,80}-65/.test(surfaceText), 'surplus must not render as a negative under "Units needed"');
  assert(!/Gap to target[\s\S]{0,80}-65/.test(surfaceText), 'surplus must not render as a negative under "Gap to target"');
}

async function main() {
  const dom = new JSDOM(makeHtml(), { url: 'about:blank' });
  installBrowserStubs(dom);
  loadHnaModules();

  const akron = {
    geoType: 'place',
    geoid: '0800925',
    label: 'Akron',
    contextCounty: '08121',
    profile: {
      DP02_0001E: 760,
      DP04_0001E: 810,
      DP05_0001E: 1720,
    },
  };
  await applyFixture(akron);

  assert.equal(window.__placeProjectionFetches, 1, 'place projection fixture should be fetched once');
  assert.equal(document.getElementById('statUnitsNeed').textContent, SURPLUS_TEXT, 'statUnitsNeed should render surplus wording');
  assert.equal(document.getElementById('decisionProductionValue').textContent, SURPLUS_TEXT, 'decision tile value should render surplus wording');
  assert.equal(document.getElementById('decisionProductionRead').textContent, 'Surplus', 'decision tile read should remain Surplus');
  assert(document.getElementById('needNote').textContent.includes(SURPLUS_TEXT), 'need note should render surplus wording');
  assert(document.getElementById('needNote').textContent.includes('after subtracting the current housing stock'), 'need note should describe current housing stock');
  assert(!document.getElementById('needNote').textContent.includes('after subtracting the current requirement'), 'need note should not describe a current requirement');
  assert(!document.getElementById('needNote').textContent.includes('net new total units'), 'surplus note should not reuse net-new wording');
  assert(!document.getElementById('statBaseUnitsSrc').textContent.toLowerCase().includes('requirement'), 'base-units label should not say requirement');
  assert(document.getElementById('statBaseUnitsSrc').textContent.includes('Current total housing units (DP04)'), 'base-units label should describe current housing stock');
  const statBaseUnitsTitle = document.getElementById('statBaseUnits').closest('.stat').querySelector('.k').textContent.trim();
  assert.equal(statBaseUnitsTitle, 'Current housing units', 'base-units card title should read Current housing units');
  assert(!statBaseUnitsTitle.toLowerCase().includes('requirement'), 'base-units card title should not say requirement');
  assertNoRawSurplusNegative(document.body.textContent);

  const report = window.__HNA_buildReportData();
  assert.equal(report.housingStock.unitsNeededLabel, 'Net new units needed (negative = surplus)', 'JSON report should carry neutral units-needed label');
  assert.equal(report.housingStock.unitsNeeded, SURPLUS_TEXT, 'JSON report should export surplus wording');

  window.__HNA_exportCsv(report, 'akron.csv');
  const csv = await window.__capturedExportBlob.text();
  assert(csv.includes('Net new units needed (negative = surplus)'), 'CSV should carry neutral label');
  assert(csv.includes(SURPLUS_TEXT), 'CSV should export surplus wording');
  assert(!csv.includes('Estimated Units Needed (20-year)'), 'CSV should not use old needed-only label');
  assertNoRawSurplusNegative(csv);

  await window.__HNA_exportPdf('akron.pdf');
  const pdf = window.__pdfText.join('\n');
  assert(pdf.includes('Net new units needed'), 'PDF should carry neutral label');
  assert(pdf.includes('Negative = surplus'), 'PDF should explain negative-surplus convention');
  assert(pdf.includes(SURPLUS_TEXT), 'PDF should export surplus wording');
  assert(!pdf.includes('Units needed'), 'PDF should not use old needed-only label');
  assert(!pdf.includes('Gap to target'), 'PDF should not use old gap-only sublabel');
  assertNoRawSurplusNegative(pdf);

  const fruita = {
    geoType: 'place',
    geoid: '0828745',
    label: 'Fruita',
    contextCounty: '08077',
    profile: {
      DP02_0001E: 5600,
      DP04_0001E: 6100,
      DP05_0001E: 13900,
    },
  };
  await applyFixture(fruita);
  assert.equal(document.getElementById('statUnitsNeed').textContent, '819', 'positive fixture should keep numeric stat card');
  assert.equal(document.getElementById('decisionProductionValue').textContent, '819', 'positive fixture should keep numeric decision value');
  assert(document.getElementById('needNote').textContent.includes('819 net new total units'), 'positive fixture should keep existing net-new wording');
  assert(!document.getElementById('needNote').textContent.includes('Estimated surplus of'), 'positive fixture should not show surplus wording');

  console.log('HNA surplus semantics tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
