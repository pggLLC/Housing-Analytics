'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'deal-calculator.html'), 'utf8');
const dcSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
const shareSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator-share.js'), 'utf8');
const developerFundingPath = path.join(root, 'data', 'policy', 'developer-ownership-funding.json');
const consumerHomeownershipPath = path.join(root, 'data', 'policy', 'homeownership-programs.json');
const developerFunding = JSON.parse(fs.readFileSync(developerFundingPath, 'utf8'));
const consumerHomeownership = JSON.parse(fs.readFileSync(consumerHomeownershipPath, 'utf8'));

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
assertIncludes(dcSrc, 'data/policy/developer-ownership-funding.json', 'Deal Calculator loads developer ownership funding dataset');
assertIncludes(dcSrc, 'data-dc-mode="rental"', 'rental-only sections are marked for mode switching');
assertIncludes(dcSrc, 'data-dc-mode="ownership"', 'ownership-only sections are marked for mode switching');
assertIncludes(dcSrc, 'dc-own-funding-stack', 'ownership mode renders the developer funding stack surface');
assertIncludes(shareSrc, "'dc-sale-target-ami'", 'ownership AMI target round-trips through share/export keys');
assertIncludes(shareSrc, "'dc-mode-rental'", 'deal mode radio round-trips through share/export keys');

assert.strictEqual(developerFunding.schema, 'developer-ownership-funding/v1', 'developer funding stack schema is versioned');
assert.strictEqual(consumerHomeownership.schema, 'homeownership-programs/v1', 'consumer homeownership schema remains separate');
assert.strictEqual(developerFunding.meta.consumer_dataset, 'data/policy/homeownership-programs.json', 'developer dataset documents consumer-data separation');
assert(!dcSrc.includes('data/policy/homeownership-programs.json'), 'Deal Calculator ownership stack does not consume consumer homebuyer cards');
const developerPrograms = developerFunding.programs || [];
assert(developerPrograms.length >= 3, 'developer ownership funding starter set is non-vacuous');
['deed-restriction-buydown', 'inclusionary-requirement', 'dpa-layering'].forEach(type => {
  assert(developerPrograms.some(program => program.program_type === type), 'starter set includes ' + type);
});
developerPrograms.forEach(program => {
  assert(program.id && program.name, 'program has id and name');
  assert(program.source_url && /^https:\/\//.test(program.source_url), program.id + ' has verified HTTPS source_url');
  const host = new URL(program.source_url).hostname;
  assert(!/example\./.test(host), program.id + ' source_url is not a placeholder host');
  assert(program.last_verified && /^\d{4}-\d{2}-\d{2}$/.test(program.last_verified), program.id + ' has ISO last_verified');
  assert(program.review_by && /^\d{4}-\d{2}-\d{2}$/.test(program.review_by), program.id + ' has ISO review_by');
  const hasAmount = program.max_amount != null || program.max_percent != null;
  if (hasAmount) {
    assert(program.source_url && program.source_note && !/VERIFY amount/i.test(program.source_note), program.id + ' amount has a source note');
  } else {
    assert.strictEqual(program.render_value, 'VERIFY', program.id + ' with unknown amount renders VERIFY');
    assert.strictEqual(program.apply_to_gap, false, program.id + ' unknown amount is not counted toward the gap');
  }
});

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
  targetAmiPct: 0.80,
  developerFundingPrograms: developerFunding
});
assert.strictEqual(result.status, 'ok', 'valid ownership inputs compute');
assert.strictEqual(result.maxAffordableSalePrice, expectedPrice80, 'max sale price matches HNA ownership helper');
assert.strictEqual(result.tdcPerUnit, 500000, 'development cost per unit is TDC / units');
assert.strictEqual(result.subsidyGapPerUnit, Math.max(0, 500000 - expectedPrice80), 'subsidy gap per unit is cost less max sale price');
assert.strictEqual(result.totalSubsidyGap, result.subsidyGapPerUnit * 40, 'total gap multiplies per-unit gap by units');
assert(result.developerFundingStack, 'computeForSaleFeasibility maps a developer funding stack');
assert(result.developerFundingStack.appliedAmountPerUnit <= result.subsidyGapPerUnit, 'developer stack never applies more than the computed gap');
assert.strictEqual(
  result.developerFundingStack.residualGapPerUnit,
  Math.max(0, result.subsidyGapPerUnit - result.developerFundingStack.appliedAmountPerUnit),
  'developer stack residual equals gap minus applied sources'
);
assert(result.developerFundingStack.verifySources.some(source => source.displayAmount === 'VERIFY'), 'unknown program terms are disclosed as VERIFY');

const fixturePrograms = [
  {
    id: 'fixture-fixed',
    name: 'Fixture fixed source',
    status: 'active',
    program_type: 'dpa-layering',
    apply_to_gap: true,
    amount_type: 'fixed_dollar_cap',
    max_amount: 20000,
    source_url: 'https://www.chfainfo.com/homeownership/down-payment-assistance'
  },
  {
    id: 'fixture-buydown',
    name: 'Fixture buy-down source',
    status: 'active',
    program_type: 'deed-restriction-buydown',
    apply_to_gap: true,
    amount_type: 'percent_purchase_price',
    max_percent: 0.2,
    basis: 'development_cost_per_unit',
    source_url: 'https://www.wmrhousing.org/gooddeeds'
  },
  {
    id: 'fixture-verify',
    name: 'Fixture VERIFY source',
    status: 'active',
    program_type: 'inclusionary-requirement',
    apply_to_gap: false,
    render_value: 'VERIFY',
    source_url: 'https://aspen.gov/1384/2022-Residential-Building-Regulations-Up'
  }
];
const mappedResult = dc.computeForSaleFeasibility({
  tdc: 500000,
  units: 1,
  ami4Person: 90000,
  targetAmiPct: 0.80,
  maxAffordablePrice: function () { return 350000; },
  developerFundingPrograms: fixturePrograms
});
assert.strictEqual(mappedResult.subsidyGapPerUnit, 150000, 'fixture creates a known ownership gap');
assert.strictEqual(mappedResult.developerFundingStack.appliedAmountPerUnit, 120000, 'fixture applied sources sum in declared order');
assert.strictEqual(mappedResult.developerFundingStack.residualGapPerUnit, 30000, 'fixture residual is gap minus applied sources');
assert.strictEqual(mappedResult.developerFundingStack.appliedTotal, 120000, 'fixture total applied uses unit count');
assert.strictEqual(mappedResult.developerFundingStack.verifySources.length, 1, 'fixture VERIFY source is disclosed and not applied');

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

window.HudFmr = {
  getIncomeLimitsByFips: function () {
    return { ami_4person: 100000 };
  },
  getFmrByFips: function () {
    return { studio: 900, '1br': 1100, '2br': 1300, '3br': 1700, '4br': 2000 };
  },
  getGrossRentLimit: function (_fips, pct) {
    return { '2br': Math.round(100000 * (pct / 100) * 0.30 / 12) };
  },
  isLoaded: function () {
    return true;
  },
  getAllCounties: function () {
    return [{ fips: '08031', name: 'Denver County' }];
  }
};
dc._setDeveloperOwnershipFundingForTest(developerFunding);
dc._setAmiLimitsForTest(null, null, '08031');
document.getElementById('dc-tdc').value = '20000000';
document.getElementById('dc-units').value = '40';
document.getElementById('dc-sale-target-ami').value = '80';
dc.recalculate();
const stackText = document.getElementById('dc-own-funding-stack').textContent;
assert(stackText.includes('Developer ownership funding stack - screening only'), 'rendered stack is developer-facing and screening-only');
assert(stackText.includes('Residual after mapped stack'), 'rendered stack discloses residual after applied sources');
assert(stackText.includes('VERIFY before counting toward the gap'), 'rendered stack discloses unknown program terms as VERIFY');
assert(stackText.includes('C3 owner confirmation requested'), 'rendered stack flags C3 for owner confirmation');

console.log('All Deal Calculator for-sale ownership feasibility tests passed.');
