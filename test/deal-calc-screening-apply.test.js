'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const funding = require(path.join(ROOT, 'data/policy/developer-ownership-funding.json'));
const source = fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(ROOT, 'js/deal-engine.js'), 'utf8');

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
// WMRHC covers Garfield and Pitkin counties only, so the fixture sits in Garfield (08045).
const fixtureGap = { tdcPerUnit: 500000, maxAffordableSalePrice: 200000, subsidyGapPerUnit: 300000 };
const realStack = dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding, countyFips: '08045' });
assert.equal(realStack.appliedAmountPerUnit, 175000);
assert.deepEqual(realStack.appliedSources.map((item) => [item.id, item.appliedAmountPerUnit]), [
  ['wmrhc-good-deeds-buydown', 150000],
  ['chfa-dpa-layering', 25000],
]);
assert(realStack.appliedSources.every((item) => item.screeningOnly === true));
assert.equal(dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding, countyFips: '08097' }).appliedAmountPerUnit, 175000,
  'Pitkin County gets the WMRHC buy-down too');

// Outside its counties (Mesa, 08077) the buy-down is named, not counted; CHFA's statewide cap still applies.
const mesaStack = dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding, countyFips: '08077' });
assert.deepEqual(mesaStack.appliedSources.map((item) => [item.id, item.appliedAmountPerUnit]), [['chfa-dpa-layering', 25000]]);
assert.equal(mesaStack.residualGapPerUnit, 275000);
assert.deepEqual(mesaStack.outsideSources.map((item) => [item.id, item.reason]), [['wmrhc-good-deeds-buydown', 'Not available in this county']]);

// With no county the buy-down's area cannot be confirmed, so it is not counted either.
const noCountyStack = dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding });
assert.equal(noCountyStack.appliedAmountPerUnit, 25000);
assert.equal(noCountyStack.outsideSources.length, 1);

// The county reaches the stack through the Deal Engine's for-sale screen.
const engine = window.DealEngine || require('../js/deal-engine.js');
const viaEngine = (fips) => engine.computeForSaleFeasibility({ tdc: 500000, units: 1, ami4Person: 100000, targetAmiPct: 0.8,
  hasAffordablePriceHelper: true, maxAffordableSalePrice: 200000, developerFundingPrograms: funding, countyFips: fips }).developerFundingStack;
assert.equal(viaEngine('08045').appliedAmountPerUnit, 175000);
assert.equal(viaEngine('08077').appliedAmountPerUnit, 25000);

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
// The page's county is Denver (08031): CHFA's statewide layer is counted, the Garfield/Pitkin buy-down is named only.
mesaStack.appliedSources.forEach((item) => {
  assert(rendered.includes(item.name + ' (potential — not committed)'));
});
assert(rendered.includes('WMRHC Good Deeds buy-down: Not available in this county (Garfield and Pitkin counties only); not counted'), rendered);
assert(!rendered.includes('WMRHC Good Deeds buy-down (potential'), 'the buy-down is not counted in Denver');
assert(rendered.includes('no unconfirmed amount is counted'));

console.log('deal-calc-screening-apply: PASS');
