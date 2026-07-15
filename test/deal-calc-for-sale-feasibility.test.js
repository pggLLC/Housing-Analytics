'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'deal-calculator.html'), 'utf8');
const dcSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
const shareSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator-share.js'), 'utf8');

function assertIncludes(haystack, needle, message) {
  assert(haystack.includes(needle), message + ' - missing "' + needle + '"');
}

console.log('\nDeal Calculator for-sale ownership feasibility tests');
console.log('='.repeat(62));

const hnaIdx = html.indexOf('js/hna/hna-ownership-need.js');
const dcIdx = html.indexOf('js/deal-calculator.js');
assert(hnaIdx >= 0, 'deal-calculator.html loads HNA ownership need module');
assert(dcIdx >= 0, 'deal-calculator.html loads deal-calculator.js');
assert(hnaIdx < dcIdx, 'HNA ownership need module loads before deal-calculator.js');

assertIncludes(dcSrc, 'For-Sale Ownership Feasibility', 'ownership feasibility panel label is present');
assertIncludes(dcSrc, 'dc-sale-target-ami', 'ownership AMI target selector is present');
assertIncludes(dcSrc, 'HNAOwnershipNeed && window.HNAOwnershipNeed.maxAffordablePrice', 'helper uses shared HNA maxAffordablePrice path');
assertIncludes(dcSrc, 'data-dc-mode="rental"', 'rental-only sections are marked for mode switching');
assertIncludes(dcSrc, 'data-dc-mode="ownership"', 'ownership-only sections are marked for mode switching');
assertIncludes(shareSrc, "'dc-sale-target-ami'", 'ownership AMI target round-trips through share/export keys');
assertIncludes(shareSrc, "'dc-mode-rental'", 'deal mode radio round-trips through share/export keys');

const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
  url: 'http://localhost/deal-calculator.html'
});
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;

window.DealCalculatorMath = require('../js/deal-calculator-math.js');
require('../js/hna/hna-ownership-need.js');
require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

const dc = window.__DealCalc;
assert(dc && typeof dc.computeForSaleFeasibility === 'function', 'computeForSaleFeasibility exported');
assert(window.HNAOwnershipNeed && typeof window.HNAOwnershipNeed.maxAffordablePrice === 'function', 'shared HNA maxAffordablePrice loaded');

const ownershipPanel = document.getElementById('dc-ownership-feasibility');
const rentalAmiMix = document.getElementById('dc-rental-ami-mix');
const capitalStack = document.getElementById('dc-capital-stack-col');
const saleTargetWrap = document.getElementById('dc-sale-target-wrap');
const unitsInput = document.getElementById('dc-units');
assert(ownershipPanel && rentalAmiMix && capitalStack && saleTargetWrap && unitsInput, 'mode-controlled panels render');
assert.strictEqual(ownershipPanel.hidden, true, 'ownership panel is hidden in default rental mode');
assert.strictEqual(rentalAmiMix.hidden, false, 'rental AMI mix is visible in default rental mode');
assert.strictEqual(saleTargetWrap.hidden, true, 'ownership sale target is hidden in default rental mode');
assert.strictEqual(unitsInput.closest('label').hidden, false, 'total units stays visible in default rental mode');

const ownershipMode = document.getElementById('dc-mode-ownership');
ownershipMode.checked = true;
ownershipMode.dispatchEvent(new Event('change', { bubbles: true }));
assert.strictEqual(ownershipPanel.hidden, false, 'ownership mode reveals ownership feasibility panel');
assert.strictEqual(rentalAmiMix.hidden, true, 'ownership mode hides rental AMI mix');
assert.strictEqual(capitalStack.hidden, true, 'ownership mode hides rental capital stack outputs');
assert.strictEqual(saleTargetWrap.hidden, false, 'ownership mode reveals ownership sale target');
assert.strictEqual(unitsInput.closest('label').hidden, false, 'total units stays visible in ownership mode');

// Every rental-scoped section (mortgage sizing, DSCR, rent achievability,
// peer deals, adjust-guidance, headings) must leave ownership mode.
document.querySelectorAll('[data-dc-mode="rental"]').forEach(el => {
  assert.strictEqual(el.hidden, true, 'rental-scoped element hidden in ownership mode: ' + (el.id || el.tagName));
});
assert.strictEqual(document.getElementById('dc-adjust-guidance').hidden, true, 'rental adjust-guidance box is hidden in ownership mode');
document.querySelectorAll('[data-dc-mode="ownership"]').forEach(el => {
  assert.strictEqual(el.hidden, false, 'ownership-scoped element visible in ownership mode: ' + (el.id || el.tagName));
});

const expectedPrice80 = window.HNAOwnershipNeed.maxAffordablePrice(100000, 0.80);
const result = dc.computeForSaleFeasibility({
  tdc: 20000000,
  units: 40,
  ami4Person: 100000,
  targetAmiPct: 0.80
});
assert.strictEqual(result.status, 'ok', 'valid ownership inputs compute');
assert.strictEqual(result.maxAffordableSalePrice, expectedPrice80, 'max sale price matches HNA ownership helper');
assert.strictEqual(result.tdcPerUnit, 500000, 'development cost per unit is TDC / units');
assert.strictEqual(result.subsidyGapPerUnit, Math.max(0, 500000 - expectedPrice80), 'subsidy gap per unit is cost less max sale price');
assert.strictEqual(result.totalSubsidyGap, result.subsidyGapPerUnit * 40, 'total gap multiplies per-unit gap by units');

let spyCalls = 0;
const spyResult = dc.computeForSaleFeasibility({
  tdc: 600000,
  units: 2,
  ami4Person: 90000,
  targetAmiPct: 1.00,
  maxAffordablePrice: function (ami, pct) {
    spyCalls += 1;
    assert.strictEqual(ami, 90000, 'AMI passed through to maxAffordablePrice');
    assert.strictEqual(pct, 1.00, 'target AMI passed through to maxAffordablePrice');
    return 275000;
  }
});
assert.strictEqual(spyCalls, 1, 'computeForSaleFeasibility calls the injected maxAffordablePrice exactly once');
assert.strictEqual(spyResult.subsidyGapPerUnit, 25000, 'spy proves gap uses maxAffordablePrice return value');

const missingAmi = dc.computeForSaleFeasibility({ tdc: 1000000, units: 4, targetAmiPct: 0.80 });
assert.strictEqual(missingAmi.status, 'missing-ami', 'missing AMI does not fabricate a sale price');

console.log('All Deal Calculator for-sale ownership feasibility tests passed.');
