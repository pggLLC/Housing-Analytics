#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function freshRequire(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  return require(absolutePath);
}

function installDom(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  global.URL = dom.window.URL;
  global.URLSearchParams = dom.window.URLSearchParams;
  global.Blob = dom.window.Blob;
  global.Event = dom.window.Event;
  global.requestAnimationFrame = function (callback) { callback(); };
  window.requestAnimationFrame = global.requestAnimationFrame;
}

function suppressAutomaticInit(document) {
  const addEventListener = document.addEventListener.bind(document);
  document.addEventListener = function (type, listener, options) {
    if (type === 'DOMContentLoaded') return undefined;
    return addEventListener(type, listener, options);
  };
}

function testGeographyOptionsAndUrl() {
  const dom = new JSDOM(`<!doctype html><body>
    <select id="geoType">
      <option value="state">State</option>
      <option value="county">County</option>
      <option value="place" selected>Place / CDP</option>
    </select>
    <select id="geoSelect"></select>
    <span id="geoSelectHint"></span>
    <input id="combineGeosToggle" type="checkbox">
  </body>`, {
    url: 'http://127.0.0.1/housing-needs-assessment.html?fips=08031&keep=1',
  });
  installDom(dom);
  suppressAutomaticInit(document);
  window.HNAUtils = {
    DEFAULTS: { geoId: '08031', geoType: 'county' },
    FEATURED: [],
    PROJECTION_SCENARIOS: {},
  };
  window.HNARenderers = {};
  window.__HNA_GEO_CONFIG = require('../data/hna/geo-config.json');
  freshRequire('js/hna/hna-controller.js');

  window.HNAController.buildSelectForTest();
  const options = Array.from(document.getElementById('geoSelect').options);
  const cdpOptions = options.filter((option) => option.getAttribute('data-subtype') === 'cdp');
  assert.equal(cdpOptions.length, 210, 'the real option list includes all 210 Colorado CDPs');
  cdpOptions.forEach((option) => {
    assert.match(option.textContent, /\(CDP\)$/i, `${option.value} ends with the CDP designation`);
    assert.equal(
      (option.textContent.match(/\(CDP\)/gi) || []).length,
      1,
      `${option.value} contains exactly one parenthetical CDP designation`,
    );
    assert.doesNotMatch(option.textContent, /\(CDP\)\s*\(CDP\)/i);
  });
  assert.equal(
    options.find((option) => option.value === '0879100').textContent,
    'Twin Lakes CDP (Adams County) (CDP)',
    'a source label without the suffix receives exactly one suffix',
  );

  const select = document.getElementById('geoSelect');
  select.value = '0828745';
  window.HNAController.syncJurisdictionToUrlForTest();
  let written = new URL(window.location.href);
  assert.equal(written.searchParams.get('geoid'), '0828745', 'Fruita selection is written to the URL');
  assert.equal(written.searchParams.get('geoType'), 'place', 'municipality type is written for the existing URL reader');
  assert.equal(written.searchParams.get('auto'), '1', 'shareable URL uses the existing explicit-URL precedence path');
  assert.equal(written.searchParams.get('fips'), null, 'stale legacy fips is removed');
  assert.equal(written.searchParams.get('keep'), '1', 'unrelated query parameters are preserved');

  select.value = '0800320';
  window.HNAController.syncJurisdictionToUrlForTest();
  written = new URL(window.location.href);
  assert.equal(written.searchParams.get('geoid'), '0800320', 'Acres Green selection replaces the prior geoid');
  assert.equal(written.searchParams.get('geoType'), 'cdp', 'CDP subtype survives in the shareable URL');

  const controllerSource = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  assert.match(
    controllerSource,
    /geoSelect\.addEventListener\('change',[\s\S]{0,180}_syncJurisdictionToUrl\(\)/,
    'the real geoSelect change path invokes the behavior-tested URL synchronizer',
  );
}

function makePdfStub(savedFilenames) {
  return class PdfStub {
    constructor() {
      this.internal = {
        pageSize: { getWidth: () => 612, getHeight: () => 792 },
        getNumberOfPages: () => 1,
      };
    }
    addImage() {}
    addPage() {}
    line() {}
    rect() {}
    roundedRect() {}
    save(filename) { savedFilenames.push(filename); }
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
    text() {}
  };
}

async function testPdfFilenames() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="btnPdf"></button>
    <div id="hnaLiveRegion"></div>
    <div id="geoContextPill"></div>
    <select id="geoType"><option value="county">County</option><option value="place">Place</option></select>
    <select id="geoSelect"></select>
  </body>`, { url: 'http://127.0.0.1/housing-needs-assessment.html' });
  installDom(dom);
  window.HNAState = { state: { current: null } };
  window.fetch = async function () {
    return { ok: false, status: 404, json: async function () { return null; } };
  };
  global.fetch = window.fetch;
  const savedFilenames = [];
  window.jspdf = { jsPDF: makePdfStub(savedFilenames) };

  const realSetTimeout = global.setTimeout;
  global.setTimeout = function (callback) { callback(); return 0; };
  try {
    freshRequire('js/hna/hna-export.js');

    function setGeography(label, geoType, geoid) {
      document.getElementById('geoContextPill').textContent = label;
      document.getElementById('geoType').value = geoType;
      const select = document.getElementById('geoSelect');
      select.innerHTML = '';
      const option = document.createElement('option');
      option.value = geoid;
      option.textContent = label;
      option.selected = true;
      select.appendChild(option);
    }

    setGeography('Denver County', 'county', '08031');
    await window.__HNA_exportPdf();
    setGeography('Acres Green (CDP)', 'place', '0800320');
    await window.__HNA_exportPdf();
  } finally {
    global.setTimeout = realSetTimeout;
  }

  assert.deepEqual(savedFilenames, [
    'housing-needs-assessment-denver-county-08031.pdf',
    'housing-needs-assessment-acres-green-cdp-0800320.pdf',
  ], 'structured exports use distinct, filesystem-safe jurisdiction filenames');
}

function testAnnualNoiLabels() {
  const dom = new JSDOM('<!doctype html><body><div id="dealCalcMount"></div></body>', {
    url: 'http://127.0.0.1/deal-calculator.html',
  });
  installDom(dom);
  suppressAutomaticInit(document);
  window.DealCalculatorMath = freshRequire('js/deal-calculator-math.js');
  freshRequire('js/deal-calculator.js');
  const mount = document.getElementById('dealCalcMount');
  window.__DealCalc.renderForTest(mount);

  const computed = document.getElementById('dc-noi-computed-display').textContent.replace(/\s+/g, ' ').trim();
  assert.match(computed, /^Computed Annual NOI:/, 'computed NOI states its annual basis');

  const stressIds = [
    'dc-r-stress-rent10-noi',
    'dc-r-stress-vac5-noi',
    'dc-r-stress-opex10-noi',
    'dc-r-stress-combined-noi',
  ];
  const stressTable = document.getElementById(stressIds[0]).closest('table');
  const headers = Array.from(stressTable.querySelectorAll('th')).map((header) => header.textContent.trim());
  assert(headers.includes('Annual Stressed NOI'), 'the shared header gives all four stress NOI values an annual basis');
  stressIds.forEach((id) => assert(stressTable.contains(document.getElementById(id)), `${id} remains in the annual stress column`));

  assert(mount.textContent.includes('Total Development Cost (TDC)'), 'one-time TDC label remains present');
  assert(!mount.textContent.includes('Annual Total Development Cost'), 'one-time TDC does not gain an annual label');
}

(async function main() {
  testGeographyOptionsAndUrl();
  await testPdfFilenames();
  testAnnualNoiLabels();
  console.log('package-4 user-visible defects: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
