'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const geoConfig = require('../data/hna/geo-config.json');
const sampleCdp = geoConfig.cdps.find((row) => row.geoid === '0800320');
const sampleCounty = geoConfig.counties.find((row) => row.geoid === sampleCdp.containingCounty);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function execOnly(src) {
  return src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function assertNoCityGeoType(src, label) {
  const exec = execOnly(src);
  assert(!/geoType\s*:\s*['"]city['"]/.test(exec), `${label} must not write geoType:"city"`);
  assert(!/geoType\s*=\s*['"]city['"]/.test(exec), `${label} must not assign geoType="city"`);
}

function loadWorkflowDom() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://127.0.0.1/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.sessionStorage = dom.window.sessionStorage;
  global.CustomEvent = dom.window.CustomEvent;
  global.HTMLElement = dom.window.HTMLElement;
  global.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(geoConfig)
  });

  ['../js/workflow-state-core.js', '../js/workflow-state-api.js', '../js/components/jurisdiction-url-context.js']
    .forEach((mod) => {
      delete require.cache[require.resolve(mod)];
      require(mod);
    });
  return dom.window;
}

async function main() {
  assert(sampleCdp && sampleCdp.type === 'cdp', 'sample CDP fixture exists');
  assert(sampleCounty && sampleCounty.label === 'Douglas County', 'sample containing county fixture exists');

  const window = loadWorkflowDom();
  window.WorkflowState.setJurisdiction({
    geoType: 'cdp',
    geoid: sampleCdp.geoid,
    name: sampleCdp.label,
    countyFips: sampleCdp.containingCounty,
    countyName: sampleCounty.label,
    fips: sampleCdp.containingCounty,
    type: 'city',
    displayName: sampleCdp.label,
    placeGeoid: sampleCdp.geoid
  });

  const jx = window.WorkflowState.getJurisdiction();
  assert.equal(jx.geoType, 'cdp', 'WorkflowState preserves authoritative CDP geoType');
  assert.equal(jx.geoid, sampleCdp.geoid, 'WorkflowState preserves CDP geoid');
  assert.equal(jx.name, sampleCdp.label, 'WorkflowState preserves place/CDP name');
  assert.equal(jx.countyFips, sampleCdp.containingCounty, 'WorkflowState preserves containing county FIPS');
  assert.equal(jx.countyName, sampleCounty.label, 'WorkflowState preserves containing county name');
  assert.equal(jx.type, 'city', 'legacy type remains populated for back-compat');
  assert.equal(jx.placeGeoid, sampleCdp.geoid, 'legacy placeGeoid remains populated');

  const ctx = await window.JurisdictionUrlContext.resolve();
  assert.equal(ctx.geoType, 'cdp', 'shared resolver preserves CDP type');
  assert.equal(ctx.geoid, sampleCdp.geoid, 'shared resolver preserves CDP geoid');
  assert.equal(ctx.countyFips, sampleCdp.containingCounty, 'shared resolver exposes county context');
  assert.equal(ctx.countyName, sampleCounty.label, 'shared resolver exposes county name');
  assert.equal(ctx.placeGeoid, sampleCdp.geoid, 'shared resolver exposes placeGeoid for county-only tools');

  const writerFiles = [
    ['js/jurisdiction-selector.js', 'jurisdiction selector'],
    ['js/hna/hna-controller.js', 'HNA controller'],
    ['hna-comparative-analysis.html', 'comparative analysis']
  ];
  writerFiles.forEach(([file, label]) => {
    const src = read(file);
    assert(src.includes('setJurisdiction'), `${label} writes WorkflowState jurisdiction`);
    ['geoType', 'geoid', 'name', 'countyFips', 'countyName'].forEach((field) => {
      assert(src.includes(field), `${label} carries canonical ${field}`);
    });
    assertNoCityGeoType(src, label);
  });

  const selector = read('js/jurisdiction-selector.js');
  assert(selector.includes('findPlaceByGeoid'), 'selector resolves places/CDPs by registry geoid');
  assert(!/stripSuffix\(allP\[i\]\.label\)\s*===\s*target/.test(execOnly(selector)),
    'selector no longer relies on final label-string matching in handleContinue');

  const hna = read('js/hna/hna-controller.js');
  assert(hna.includes('function _workflowSelectionFromJurisdiction'), 'HNA restore uses WorkflowState tuple helper');
  assert(hna.includes('jx.geoType && jx.geoid'), 'HNA restore prioritizes geoType/geoid');
  assert(hna.includes("geoType === 'cdp' ? 'place'"), 'HNA restore maps CDP into shared place/CDP dropdown');
  assert(hna.includes("realGeoType = gt === 'place' ? (subtype || 'place') : gt"),
    'HNA writeback preserves option subtype for CDP versus place');
  assert(!hna.includes('SiteState.getGeography'), 'HNA restore no longer reads SiteState geography');

  const siteState = read('js/site-state.js');
  assert(!/setGeography|getGeography/.test(execOnly(siteState)), 'SiteState geography API is removed');

  const sbDom = new JSDOM(read('hna-scenario-builder.html'));
  const sbScripts = Array.from(sbDom.window.document.querySelectorAll('script:not([src])'))
    .map((script) => script.textContent)
    .join('\n');
  assert(sbScripts.includes('function preselectFromWorkflowState'), 'scenario builder has WorkflowState preselect helper');
  assert(sbScripts.includes('targetGeoid = _jx.geoid'), 'scenario builder prefers canonical geoid');
  assert(sbScripts.includes("_jx.geoType && _jx.geoid"), 'scenario builder prefers canonical geoType/geoid tuple');

  const dc = read('js/deal-calculator.js');
  assert(dc.includes('dc-jurisdiction-context'), 'deal calculator renders display-only jurisdiction context line');
  assert(dc.includes('workflowCtx.countyFips'), 'deal calculator preselects county from canonical countyFips');
  assert(dc.includes('Analyzing '), 'deal calculator labels place/CDP county context');

  console.log('canonical geography contract checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
