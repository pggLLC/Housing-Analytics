'use strict';
// Renderer consumes an invented engine result; it never reads base-year figures from the DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { computeDeal } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');
const dom = new JSDOM('<!doctype html><div id="pf-container"></div><span id="dc-r-rents">$1</span><span id="dc-r-mortgage">$2</span>', { runScripts: 'outside-only' });
const w = dom.window, d = w.document, input = inputsFor('B');
let result = computeDeal(input), calls = 0;
w.Chart = function ChartStub(canvas, options) { this.data = options.data; this.destroy = this.update = () => {}; };
w.__DealCalc = { getResult: () => structuredClone(result), recalculate() {
  calls++;
  for (const el of d.querySelectorAll('[id^=pf-]')) if ('value' in el) input.fields[el.id] = el.value;
  result = computeDeal(input);
  d.dispatchEvent(new w.CustomEvent('deal-calc:updated', { detail: { result } }));
} };
w.eval(fs.readFileSync('js/pro-forma.js', 'utf8'));
assert.equal(typeof w.ProForma.render, 'function'); assert.equal(typeof w.ProForma.update, 'function');
w.ProForma.render('pf-container');
const rows = () => d.querySelectorAll('#pf-table-wrap tbody tr');
assert.equal(rows().length, 15);
assert.equal(rows()[0].cells[7].textContent, '$672,360', 'year-one NOI is the invented engine golden, not rebuilt');
assert.equal(rows()[0].cells[8].textContent, '$' + Math.round(result.annualDebtService + result.totalSoftDebtService).toLocaleString('en-US'), 'both debt services included');
assert.equal(d.getElementById('pf-chart').getAttribute('role'), 'img');
assert(d.getElementById('pf-chart').getAttribute('aria-label'));
for (const [entered, expected] of [['10', 10], ['2', 5], ['99', 30]]) {
  d.getElementById('pf-years').value = entered;
  d.getElementById('pf-years').dispatchEvent(new w.Event('input'));
  assert.equal(rows().length, expected);
}
assert.equal(calls, 3, 'control changes request an engine calculation');
input.fields['dc-opex'] = '';
w.__DealCalc.recalculate();
assert.equal(rows().length, 0, 'old projection removed');
assert.equal(d.getElementById('pf-table-wrap').dataset.unavailableReason, result.unavailable.projection);
assert(d.getElementById('pf-table-wrap').textContent.includes(result.unavailable.noi));
assert(!d.getElementById('pf-table-wrap').textContent.includes('$0'));
input.fields['dc-opex'] = '450'; w.__DealCalc.recalculate();
assert.equal(rows().length, 30, 'known input restores the projection');
assert.equal(d.getElementById('pf-table-wrap').dataset.unavailableReason, undefined);
dom.window.close();
console.log('pro-forma: PASS (engine handoff, year-one NOI and total debt service, horizon, absence and recovery)');
