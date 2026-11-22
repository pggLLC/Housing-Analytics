#!/usr/bin/env node
'use strict';
// The Deal Calculator's heading must name the county its inputs use. Codex
// content QA C01 (22 Nov 2026): with a Mesa County project saved in the
// browser, deal-calculator.html?geoid=08053 headed "Mesa County" while the
// county inputs were Hinsdale. The place named in the address wins over the
// saved project, and a county changed on the page wins over both.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const html = read('deal-calculator.html');
const script = [...new JSDOM(html).window.document.querySelectorAll('script:not([src])')]
  .map((el) => el.textContent).find((s) => s.includes('function updateJurisdictionBanner'));
assert.ok(script, 'deal-calculator.html carries the jurisdiction banner script');

const SAVED_MESA = { jurisdiction: { geoid: '08077', geoType: 'county', name: 'Mesa County', countyFips: '08077', countyName: 'Mesa County' } };

function page(query, urlCtx, selectValue) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="dcJurisdictionBanner"><span id="dcJurisdictionName"></span><span id="dcJurisdictionSub"></span></div>
    <select id="dc-county-select"><option value="">Select a county…</option>
      <option value="08053">Hinsdale County — Hinsdale County, CO</option>
      <option value="08077">Mesa County — Grand Junction, CO MSA</option></select></body>`,
  { url: 'http://127.0.0.1/deal-calculator.html' + query, runScripts: 'outside-only' });
  const w = dom.window;
  w.WorkflowState = { getActiveProject: () => SAVED_MESA };
  w.JurisdictionUrlContext = {
    isUrlContextPresent: () => !!urlCtx,
    resolveSync: () => urlCtx || { source: 'workflow', geoid: '08077', geoType: 'county', countyFips: '08077', countyName: 'Mesa County' },
  };
  w.document.getElementById('dc-county-select').value = selectValue;
  try { w.eval(script); } catch (_) { /* later page wiring needs the full page */ }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const name = () => w.document.getElementById('dcJurisdictionName').textContent;
  const sub = () => w.document.getElementById('dcJurisdictionSub').textContent;
  return { w, name, sub };
}

// 1. Address names Hinsdale, saved project is Mesa: the heading says Hinsdale.
const hinsdale = { source: 'url', geoid: '08053', geoType: 'county', countyFips: '08053', countyName: 'Hinsdale County', displayName: 'Hinsdale County' };
let p = page('?geoid=08053', hinsdale, '08053');
assert.equal(p.name(), 'Hinsdale County', 'the address-named county heads the page, not the saved project');

// 2. No place in the address: the saved project still names the page.
p = page('', null, '08077');
assert.equal(p.name(), 'Mesa County', 'without an address place the saved project names the page');

// 3. Reader changes the county on the page: the heading follows and says so.
p = page('?geoid=08053', hinsdale, '08053');
const sel = p.w.document.getElementById('dc-county-select');
sel.value = '08077';
sel.dispatchEvent(new p.w.Event('change', { bubbles: true }));
assert.equal(p.name(), 'Mesa County', 'a county changed on the page heads it');
assert.match(p.sub(), /County changed on this page/, 'the heading says the county was changed here');

// 3b. Address names Hinsdale but place names are not loaded yet (share link or
// quick-estimate handoff): the heading names the picked county, not "—".
p = page('?geoid=08053', { source: 'url', geoid: '08053', geoType: 'county', countyFips: '08053', countyName: null, displayName: null }, '08053');
assert.equal(p.name(), 'Hinsdale County', 'names the picked county while place names load');
assert.doesNotMatch(p.sub(), /changed/, 'the same county is not reported as changed');

// 4. The other saved-project readers put the address first too.
const share = read('js/deal-calculator-share.js');
const calc = read('js/deal-calculator.js');
const nav = read('js/navigation.js');
assert.match(share, /_serialize[\s\S]*isUrlContextPresent/, 'share link takes the address place first');
assert.match(share, /function openIcSummary\(\) \{[\s\S]{0,800}var ser = _serialize\(\);[\s\S]{0,300}ser\.get\('geoid'\)[\s\S]{0,120}picked/, 'IC summary opens the place the share link names, else the county the inputs use');
assert.match(calc, /__DealCalcSharedCounty && _selectCounty\(window\.__DealCalcSharedCounty\)\) \{ _loadNamesOnly\(\); return; \}/, 'a share link still loads place names for the heading and pill');
assert.match(calc, /if \(linkedSitePoint\(\)\) \{ _loadNamesOnly\(\); return; \}/, 'a linked site still loads place names');
assert.match(calc, /_dcGetJurisdictionGeoKey\(\) \{[\s\S]{0,400}isUrlContextPresent/, 'tax-abatement banner takes the address place first');
assert.match(nav, /_updateJurisdictionPill[\s\S]{0,1500}isUrlContextPresent/, 'header place pill takes the address place first');
assert.match(html, /_resolveJurisdiction\(\) \{[\s\S]{0,400}isUrlContextPresent/, 'pipeline button takes the address place first');

console.log('deal-calculator-banner-url-first: 5 checks passed');
