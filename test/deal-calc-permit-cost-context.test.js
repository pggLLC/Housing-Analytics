'use strict';

// #1842 — Census BPS permit-declared structure cost is CONTEXT under the TDC
// input: a relative county figure the reader can compare a typed TDC against.
// It must name its exclusions, stay absent where the builder suppressed it,
// and never write into any field — least of all gross SF.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const permits = JSON.parse(fs.readFileSync(path.join(root, 'data', 'hna', 'permits.json'), 'utf8'));

console.log('\nDeal Calculator: permit-declared structure cost as context (#1842)');
console.log('='.repeat(62));

const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', { url: 'http://127.0.0.1/deal-calculator.html' });
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
window.DealCalculatorMath = require('../js/deal-calculator-math.js');
require('../js/hna/hna-ownership-need.js');
require('../js/hna/ownership-resale.js');
require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
const dc = window.__DealCalc;

const note = document.getElementById('dc-tdc-permit-context');
const tdc = document.getElementById('dc-tdc');
const units = document.getElementById('dc-units');
const gsf = document.getElementById('dc-gross-sf');
assert(note && tdc && units && gsf, 'note, TDC, units and gross-SF fields render');
assert.strictEqual(note.hidden, true, 'note is hidden before any county or data');

const withValue = Object.entries(permits.counties).find(([, c]) => c.declared_value_per_unit_mf_5yr && c.declared_value_per_unit_mf_5yr.value > 0);
const suppressed = Object.entries(permits.counties).find(([, c]) => c.declared_value_per_unit_mf_5yr && c.declared_value_per_unit_mf_5yr.value == null);
assert(withValue && suppressed, 'fixture has both a published and a suppressed county');
const [fipsV, countyV] = withValue;
const [fipsS, countyS] = suppressed;

const tdcBefore = tdc.value, unitsBefore = units.value, gsfBefore = gsf.value;
dc.setPermitsData(permits);
assert.strictEqual(note.hidden, true, 'data alone (no county) shows nothing');

dc.renderPermitContext(fipsV);
assert.strictEqual(note.hidden, false, 'a county with a published figure shows the note');
const rec = countyV.declared_value_per_unit_mf_5yr;
const dollars = '$' + Math.round(rec.value).toLocaleString('en-US');
assert(note.textContent.includes(countyV.name) && note.textContent.includes(dollars), 'note names the county and the per-unit figure (' + dollars + ')');
assert(/excludes land, soft costs, fees and financing/.test(note.textContent), 'note names the exclusions');
assert(/not total development cost/.test(note.textContent), 'note says it is not TDC');
assert(/Census Building Permits Survey/.test(note.textContent), 'note cites the source');
const expectedPerUnit = Number(tdc.value) / Number(units.value);
assert(note.textContent.includes('$' + Math.round(expectedPerUnit).toLocaleString('en-US') + ' per unit'), 'note compares against the typed TDC per unit');
assert(note.textContent.includes((expectedPerUnit / rec.value).toFixed(1) + '×'), 'note states the ratio');

dc.renderPermitContext(fipsS);
assert.strictEqual(note.hidden, false, 'a suppressed county still explains itself');
assert(/not shown/.test(note.textContent) && /fewer than/.test(note.textContent), 'suppressed county shows the builder\'s basis, not a number');
assert(!/\$\d/.test(note.textContent), 'suppressed county shows no dollar figure');

dc.renderPermitContext(null);
assert.strictEqual(note.hidden, true, 'no county hides the note');

// The rule that matters most: context never becomes input.
assert.strictEqual(tdc.value, tdcBefore, 'TDC input untouched');
assert.strictEqual(units.value, unitsBefore, 'units input untouched');
assert.strictEqual(gsf.value, gsfBefore, 'gross SF input untouched (never populated from permits)');
assert(!gsf.hasAttribute('data-derived'), 'gross SF carries no derived marker');

console.log('  ✓ permit cost is context with its exclusions named; suppressed stays absent; no field is written');
console.log('\nAll tests passed');
