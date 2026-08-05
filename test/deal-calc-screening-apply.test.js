'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const funding = require(path.join(ROOT, 'data/policy/developer-ownership-funding.json'));
const source = fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
  url: 'http://localhost/deal-calculator.html',
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;

window.DealCalculatorMath = require('../js/deal-calculator-math.js');
require('../js/hna/hna-ownership-need.js');
require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

const dc = window.__DealCalc;
assert(dc && typeof dc.computeDeveloperOwnershipFundingStack === 'function');

// $500,000 TDC/unit × 30% WMRHC cap = $150,000; CHFA then contributes its
// $25,000 cap. The $300,000 fixture gap is large enough that neither is clipped.
const realStack = dc.computeDeveloperOwnershipFundingStack({
  tdcPerUnit: 500000,
  maxAffordableSalePrice: 200000,
  subsidyGapPerUnit: 300000,
}, { units: 1, programs: funding });
assert.equal(realStack.appliedAmountPerUnit, 175000);
assert.deepEqual(realStack.appliedSources.map((item) => [item.id, item.appliedAmountPerUnit]), [
  ['wmrhc-good-deeds-buydown', 150000],
  ['chfa-dpa-layering', 25000],
]);
assert(realStack.appliedSources.every((item) => item.screeningOnly === true));

const nullAmountStack = dc.computeDeveloperOwnershipFundingStack({
  tdcPerUnit: 500000,
  subsidyGapPerUnit: 100000,
}, { units: 1, programs: [{
  id: 'null-screening-source',
  name: 'Null screening source',
  status: 'active',
  screening_apply: true,
  apply_to_gap: false,
  amount_type: 'fixed_dollar_cap',
  max_amount: null,
}] });
assert.equal(nullAmountStack.appliedAmountPerUnit, 0);
assert.equal(nullAmountStack.appliedSources.length, 0);

const committedStack = dc.computeDeveloperOwnershipFundingStack({
  subsidyGapPerUnit: 100000,
}, { units: 1, programs: [{
  id: 'committed-source',
  name: 'Committed source',
  status: 'active',
  screening_apply: false,
  apply_to_gap: true,
  amount_type: 'fixed_dollar_cap',
  max_amount: 40000,
}] });
assert.equal(committedStack.appliedAmountPerUnit, 40000);
assert.equal(committedStack.appliedSources[0].screeningOnly, false);
assert(source.includes("program.apply_to_gap !== true && program.screening_apply !== true"));

window.HudFmr = {
  getIncomeLimitsByFips: function () { return { ami_4person: 100000 }; },
  getFmrByFips: function () { return { studio: 900, '1br': 1100, '2br': 1300, '3br': 1700, '4br': 2000 }; },
  getGrossRentLimit: function (_fips, pct) { return { '2br': Math.round(100000 * (pct / 100) * 0.30 / 12) }; },
  isLoaded: function () { return true; },
  getAllCounties: function () { return [{ fips: '08031', name: 'Denver County' }]; },
};
dc._setDeveloperOwnershipFundingForTest(funding);
dc._setAmiLimitsForTest(null, null, '08031');
document.getElementById('dc-tdc').value = '20000000';
document.getElementById('dc-units').value = '40';
document.getElementById('dc-sale-target-ami').value = '80';
dc.recalculate();
const rendered = document.getElementById('dc-own-funding-stack').textContent;
realStack.appliedSources.forEach((item) => {
  assert(rendered.includes(item.name + ' (potential — not committed)'));
});
assert(rendered.includes('no unverified amount is counted'));

console.log('deal-calc-screening-apply: PASS');
