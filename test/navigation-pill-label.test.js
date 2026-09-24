#!/usr/bin/env node
// test/navigation-pill-label.test.js
//
// The nav's jurisdiction pill is "<county> · <place>" for a place and
// "<county>" for a county. Found on production 2026-09-23: every page showed
// "Fruita (city) · Fruita" — the pill read `name` as the county, but the
// selector and the URL context write name = the place and countyName = the
// county. Older saved projects wrote name = county, displayName = place; both
// shapes must render the same label.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js', 'navigation.js'), 'utf8');

function pillFor(jurisdiction) {
  const dom = new JSDOM('<main id="main-content"></main>', { runScripts: 'outside-only', url: 'http://127.0.0.1/index.html' });
  dom.window.WorkflowState = {
    getActiveProject: () => ({ id: 'p', jurisdiction }),
    listProjects: () => [],
    loadProject: () => {},
  };
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const el = dom.window.document.querySelector('.jurisdiction-pill__name');
  return el ? el.textContent : null;
}

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('navigation-pill-label');

run('the shape the selector and URL context write: name = place, countyName = county', () => {
  assert.equal(pillFor({ name: 'Fruita (city)', type: 'city', fips: '08077', geoid: '0828745', countyName: 'Mesa County', countyFips: '08077' }), 'Mesa County · Fruita');
  assert.equal(pillFor({ name: 'Nathrop (CDP)', type: 'cdp', countyName: 'Chaffee County' }), 'Chaffee County · Nathrop');
});

run('the older saved-project shape: name = county, displayName = place', () => {
  assert.equal(pillFor({ name: 'Mesa County', type: 'city', displayName: 'Grand Junction (city)' }), 'Mesa County · Grand Junction');
});

run('a county selection is just the county', () => {
  assert.equal(pillFor({ name: 'Mesa County', type: 'county', fips: '08077', countyName: 'Mesa County' }), 'Mesa County');
  assert.equal(pillFor({ name: 'Mesa County', type: 'county' }), 'Mesa County');
});

run('the place is never repeated as its own county', () => {
  const text = pillFor({ name: 'Fruita (city)', type: 'city', countyName: 'Mesa County' });
  assert.ok(!/Fruita.*Fruita/.test(text), text);
});

if (failures) { console.error('navigation-pill-label: FAIL'); process.exitCode = 1; }
else console.log('navigation-pill-label: PASS');
