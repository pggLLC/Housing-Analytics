'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const benchmark = require(path.join(root, 'data', 'market', 'novogradac-equity-pricing.json'));
const dcSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');

console.log('\nDeal Calculator equity-pricing benchmark tests');
console.log('='.repeat(56));

assert.strictEqual(benchmark.pricing.national_avg.credit_9pct, 0.86, 'benchmark 9% price is Q2 2026 value');
assert.strictEqual(benchmark.pricing.national_avg.credit_4pct, 0.84, 'benchmark 4% price is Q2 2026 value');

const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
  url: 'http://localhost/deal-calculator.html'
});
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;

window.COHO_DEFAULTS = {
  creditRate9Pct: 0.09,
  creditRate4Pct: 0.04,
  equityPrice9Pct: 0.91,
  equityPrice4Pct: 0.83
};
window.DealCalculatorMath = require('../js/deal-calculator-math.js');
window.fetch = () => Promise.reject(new Error('fixture fetch disabled'));

require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

const dc = window.__DealCalc;
assert(dc && typeof dc.applyNovogradacPricingDefaults === 'function', 'benchmark application helper exported');

const input = document.getElementById('dc-equity-price');
const rate9 = document.getElementById('dc-rate-9');
const rate4 = document.getElementById('dc-rate-4');
assert(input && rate9 && rate4, 'pricing input and rate toggles render');
assert.strictEqual(input.value, '0.90', 'markup starts from legacy static value before benchmark helper');

const applied = dc.applyNovogradacPricingDefaults(benchmark, { force: true, dispatch: false });
assert.strictEqual(applied, true, 'valid benchmark data applies');
assert.strictEqual(input.value, '0.86', '9% input prefers benchmark over fallback constant');

rate4.checked = true;
rate4.dispatchEvent(new Event('change', { bubbles: true }));
assert.strictEqual(input.value, '0.84', '4% toggle uses benchmark 4% value');

const before = input.value;
const missing = dc.applyNovogradacPricingDefaults({ pricing: { national_avg: { credit_9pct: null } } }, { force: true, dispatch: false });
assert.strictEqual(missing, false, 'incomplete benchmark data is rejected');
assert.strictEqual(input.value, before, 'rejected benchmark leaves current value untouched');

console.log('All Deal Calculator equity-pricing benchmark tests passed.');
