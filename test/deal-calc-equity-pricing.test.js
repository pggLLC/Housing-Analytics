'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const benchmark = require(path.join(root, 'data', 'market', 'novogradac-equity-pricing.json'));
const assumptions = require(path.join(root, 'data', 'policy', 'lihtc-assumptions.json'));
const Predictor = require(path.join(root, 'js', 'lihtc-deal-predictor.js'));
const dcSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
const constantsSrc = fs.readFileSync(path.join(root, 'js', 'config', 'financial-constants.js'), 'utf8');

function constantValue(key) {
  const match = constantsSrc.match(new RegExp(`${key}:\\s*([0-9.]+)`));
  assert(match, `financial constant found: ${key}`);
  return Number(match[1]);
}

const constants = {
  credit_9pct: constantValue('equityPrice9Pct'),
  credit_4pct: constantValue('equityPrice4Pct')
};

console.log('\nDeal Calculator equity-pricing benchmark tests');
console.log('='.repeat(56));

assert.strictEqual(benchmark.pricing.national_avg.credit_9pct, 0.86, 'benchmark 9% price is Q2 2026 value');
assert.strictEqual(benchmark.pricing.national_avg.credit_4pct, 0.84, 'benchmark 4% price is Q2 2026 value');
assert.strictEqual(constants.credit_9pct, 0.86, 'financial constants 9% fallback matches Q2 2026 benchmark');
assert.strictEqual(constants.credit_4pct, 0.84, 'financial constants 4% fallback matches Q2 2026 benchmark');
assert.strictEqual(assumptions.equityPricing.default9Pct, constants.credit_9pct, 'assumptions 9% fallback is synced to financial constants');
assert.strictEqual(assumptions.equityPricing.default4Pct, constants.credit_4pct, 'assumptions 4% fallback is synced to financial constants');
assert(fs.readFileSync(path.join(root, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8').includes('data/policy/lihtc-assumptions.json'), 'freshness audit includes LIHTC assumptions');

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
  equityPrice9Pct: constants.credit_9pct,
  equityPrice4Pct: constants.credit_4pct
};
window.DealCalculatorMath = require('../js/deal-calculator-math.js');
window.fetch = () => Promise.reject(new Error('fixture fetch disabled'));

require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

const dc = window.__DealCalc;
assert(dc && typeof dc.applyNovogradacPricingDefaults === 'function', 'benchmark application helper exported');
assert(dc && typeof dc.getEquityPricingDefaults === 'function', 'deal calculator pricing default getter exported');
assert(Predictor && typeof Predictor._applyNovogradacPricingDefaults === 'function', 'predictor benchmark application helper exported');
assert(Predictor && typeof Predictor._getEquityPricingDefaults === 'function', 'predictor pricing default getter exported');

const input = document.getElementById('dc-equity-price');
const rate9 = document.getElementById('dc-rate-9');
const rate4 = document.getElementById('dc-rate-4');
assert(input && rate9 && rate4, 'pricing input and rate toggles render');
assert.strictEqual(input.value, '0.90', 'markup starts from legacy static value before benchmark helper');

Predictor._resetPricingDefaultsForTest();
assert.deepStrictEqual(dc.getEquityPricingDefaults(), constants, 'calculator fallback defaults match financial constants without benchmark');
assert.deepStrictEqual(Predictor._getEquityPricingDefaults(), constants, 'predictor fallback defaults match calculator constants without benchmark');

const applied = dc.applyNovogradacPricingDefaults(benchmark, { force: true, dispatch: false });
assert.strictEqual(applied, true, 'valid benchmark data applies');
assert.strictEqual(input.value, '0.86', '9% input prefers benchmark over fallback constant');
assert.strictEqual(Predictor._applyNovogradacPricingDefaults(benchmark), true, 'predictor accepts valid Novogradac benchmark');
assert.deepStrictEqual(Predictor._getEquityPricingDefaults(), dc.getEquityPricingDefaults(), 'calculator and predictor benchmark defaults match');

rate4.checked = true;
rate4.dispatchEvent(new Event('change', { bubbles: true }));
assert.strictEqual(input.value, '0.84', '4% toggle uses benchmark 4% value');

const before = input.value;
const missing = dc.applyNovogradacPricingDefaults({ pricing: { national_avg: { credit_9pct: null } } }, { force: true, dispatch: false });
assert.strictEqual(missing, false, 'incomplete benchmark data is rejected');
assert.strictEqual(input.value, before, 'rejected benchmark leaves current value untouched');
const predictorBefore = Predictor._getEquityPricingDefaults();
assert.strictEqual(Predictor._applyNovogradacPricingDefaults({ pricing: { national_avg: { credit_9pct: null } } }), false, 'predictor rejects incomplete benchmark data');
assert.deepStrictEqual(Predictor._getEquityPricingDefaults(), predictorBefore, 'predictor rejected benchmark leaves current defaults untouched');

console.log('All Deal Calculator equity-pricing benchmark tests passed.');
