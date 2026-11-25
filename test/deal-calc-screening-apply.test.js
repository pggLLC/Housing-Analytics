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

// $500,000 TDC/unit × 30% WMRHC cap = $150,000. CHFA buyer assistance is not counted: its amount
// depends on the buyer's CHFA product and first mortgage (lesser of $25,000 or 3%/4%) and on eligibility,
// none of which the screen asks for (Codex launch audit B2, 24 Nov). It is listed with its rule instead.
// WMRHC covers Garfield and Pitkin counties only, so the fixture sits in Garfield (08045).
const fixtureGap = { tdcPerUnit: 500000, maxAffordableSalePrice: 200000, subsidyGapPerUnit: 300000 };
const realStack = dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding, countyFips: '08045' });
assert.equal(realStack.appliedAmountPerUnit, 150000);
assert.deepEqual(realStack.appliedSources.map((item) => [item.id, item.appliedAmountPerUnit]), [
  ['wmrhc-good-deeds-buydown', 150000],
]);
const chfaListed = realStack.verifySources.find((item) => item.id === 'chfa-dpa-layering');
assert(chfaListed, 'CHFA buyer assistance is listed, not counted');
assert.match(chfaListed.displayAmount, /Not counted.*\$25,000.*3%.*4%.*first mortgage/);
assert(realStack.appliedSources.every((item) => item.screeningOnly === true));
assert.equal(dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding, countyFips: '08097' }).appliedAmountPerUnit, 150000,
  'Pitkin County gets the WMRHC buy-down too');

// Outside its counties (Mesa, 08077) the buy-down is named, not counted, and nothing reduces the gap.
const mesaStack = dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding, countyFips: '08077' });
assert.deepEqual(mesaStack.appliedSources, []);
assert.equal(mesaStack.residualGapPerUnit, 300000);
const wmrhc = funding.programs.find((item) => item.id === 'wmrhc-good-deeds-buydown');
assert.deepEqual(mesaStack.outsideSources.map((item) => [item.id, item.jurisdictionScope]), [[wmrhc.id, wmrhc.jurisdiction_scope]]);

// With no county the buy-down's area cannot be confirmed, so it is not counted either.
const noCountyStack = dc.computeDeveloperOwnershipFundingStack(fixtureGap, { units: 1, programs: funding });
assert.equal(noCountyStack.appliedAmountPerUnit, 0);
assert.equal(noCountyStack.outsideSources.length, 1);

// The county reaches the stack through the Deal Engine's for-sale screen.
const engine = window.DealEngine || require('../js/deal-engine.js');
const viaEngine = (fips) => engine.computeForSaleFeasibility({ tdc: 500000, units: 1, ami4Person: 100000, targetAmiPct: 0.8,
  hasAffordablePriceHelper: true, maxAffordableSalePrice: 200000, developerFundingPrograms: funding, countyFips: fips }).developerFundingStack;
assert.equal(viaEngine('08045').appliedAmountPerUnit, 150000);
assert.equal(viaEngine('08077').appliedAmountPerUnit, 0);
assert.equal(viaEngine('08077').residualGapPerUnit, 300000);

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
// The page's county is Denver (08031): nothing is counted; CHFA buyer assistance is listed with its rule,
// the Garfield/Pitkin buy-down is named only.
const chfaRow = document.querySelector('#dc-own-funding-stack [data-not-counted="chfa-dpa-layering"]');
assert(chfaRow && /Not counted/.test(chfaRow.textContent) && /4%/.test(chfaRow.textContent), chfaRow && chfaRow.textContent);
assert(!rendered.includes('(potential — not committed)'), 'no program is counted in Denver');
// The buy-down is named in its own row with the area its funding record gives, and is not among the counted sources.
const outsideRow = document.querySelector('#dc-own-funding-stack [data-outside-county="' + wmrhc.id + '"]');
assert(outsideRow, 'the buy-down outside its counties is named');
assert(outsideRow.textContent.includes(wmrhc.name) && outsideRow.textContent.includes(wmrhc.jurisdiction_scope), outsideRow.textContent);
assert(!mesaStack.appliedSources.some((item) => item.id === wmrhc.id));
assert(rendered.includes('no unconfirmed amount is counted'));

console.log('deal-calc-screening-apply: PASS');
