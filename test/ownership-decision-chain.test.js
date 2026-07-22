'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div><div id="chain"></div></body>', {
    url: 'http://127.0.0.1/housing-needs-assessment.html',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  window.DealCalculatorMath = require('../js/deal-calculator-math.js');
  require('../js/hna/hna-ownership-need.js');
  require('../js/hna/ownership-resale.js');
  require('../js/deal-calculator.js');
  require('../js/hna/ownership-decision-chain.js');
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  return dom;
}

function garfieldOwnershipResult() {
  const countyChas = readJson('data/hna/chas_affordability_gap.json').counties;
  const gaps = readJson('data/co_ami_gap_by_county.json').counties;
  const cascade = readJson('data/hna/home-value-cascade.json');
  const profile = readJson('data/hna/summary/08045.json').acsProfile;
  const gap = gaps.find((row) => row.fips === '08045');
  return window.HNAOwnershipNeed.computeOwnershipNeed({
    geographyId: '08045',
    geographyName: 'Garfield County',
    geoLevel: 'county',
    countyChasEntry: countyChas['08045'],
    amiGapEntry: gap,
    homeValueEntry: cascade.counties['08045'],
    ownerValueSupplyProfile: profile,
  });
}

console.log('\nOwnership decision chain tests');
console.log('='.repeat(48));

setupDom();

const developerFundingPath = path.join(ROOT, 'data/policy/developer-ownership-funding.json');
const consumerHomeownershipPath = path.join(ROOT, 'data/policy/homeownership-programs.json');
const developerFunding = readJson('data/policy/developer-ownership-funding.json');
const resaleConventions = readJson('data/policy/resale-conventions.json');
const consumerBefore = fs.readFileSync(consumerHomeownershipPath, 'utf8');
const result = garfieldOwnershipResult();

assert(result.priceBandScreen, 'ownership result carries the OWN-2 demand-by-price-band screen');
assert(result.affordabilityTest, 'ownership result carries the OWN-1 county price anchor classification');
assert(window.__DealCalc && typeof window.__DealCalc.computeForSaleFeasibility === 'function', 'real Deal Calculator feasibility export is loaded');

const mount = document.getElementById('chain');
const chain = window.OwnershipDecisionChain.render(mount, result, {
  dealCalculator: window.__DealCalc,
  developerFundingDoc: developerFunding,
  resaleConventionsDoc: resaleConventions,
  units: 1,
  tdcPerUnit: result.affordabilityTest.medianHomeValue,
  targetAmiPct: 0.80,
  resaleRemainingPrincipal: 320000,
  resaleSellingCosts: 0,
});

assert(chain, 'decision chain render returns computed state');
assert.equal(chain.feasibility.source, 'DealCalculator.computeForSaleFeasibility', 'chain uses the real Deal Calculator feasibility function');
assert.equal(chain.stages.length, 5, 'all five ownership stages are assembled');
assert(chain.feasibility.developerFundingStack, 'developer funding stack is mapped from the feasibility result');
assert(chain.feasibility.ownershipResale, 'resale convention screen is mapped from the feasibility result');
assert(chain.feasibility.developerFundingStack.appliedAmountPerUnit <= chain.feasibility.subsidyGapPerUnit, 'applied stack never exceeds the computed gap');
assert.equal(
  chain.feasibility.developerFundingStack.residualGapPerUnit,
  Math.max(0, chain.feasibility.subsidyGapPerUnit - chain.feasibility.developerFundingStack.appliedAmountPerUnit),
  'residual equals gap minus applied stack'
);

const text = mount.textContent;
[
  'Developer ownership decision chain',
  'Site / price context',
  'Demand by price band',
  'Per-unit subsidy gap',
  'Developer funding stack',
  'Resale / deed-restriction tradeoff',
  'potential buyer pool (moderate-income renter households) - not committed demand',
  'Residual after mapped stack',
  'Fixed simple appreciation',
].forEach((needle) => {
  assert(text.includes(needle), 'rendered chain includes "' + needle + '"');
});

const stageEls = Array.from(document.querySelectorAll('[data-own-chain-stage]'));
assert.equal(stageEls.length, 5, 'rendered DOM has one stage per decision step');
stageEls.forEach((stage) => {
  assert(stage.textContent.includes('DEVELOPER SCREEN'), stage.getAttribute('data-own-chain-stage') + ' carries developer scope label');
  assert(stage.textContent.includes(window.OwnershipDecisionChain.SCREENING_CAVEAT), stage.getAttribute('data-own-chain-stage') + ' carries the screening caveat');
});

assert.equal(fs.readFileSync(consumerHomeownershipPath, 'utf8'), consumerBefore, 'consumer Help for Homebuyers dataset stays byte-identical');
const chainSrc = fs.readFileSync(path.join(ROOT, 'js/hna/ownership-decision-chain.js'), 'utf8');
const dealSrc = fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8');
assert(!chainSrc.includes('data/policy/homeownership-programs.json'), 'decision chain does not consume consumer homebuyer data');
assert(!dealSrc.includes('data/policy/homeownership-programs.json'), 'Deal Calculator developer path remains separate from consumer homebuyer data');
assert(fs.existsSync(developerFundingPath), 'developer ownership funding dataset is the chain funding source');

const lowerChainSrc = chainSrc.toLowerCase();
[
  'fore' + 'cast',
  'time-' + 'phasing',
  'time ' + 'phasing',
  'capture ' + 'rate',
  'capture ' + 'rates',
].forEach((phrase) => {
  assert.equal(lowerChainSrc.includes(phrase), false, phrase + ' language must stay out of the ownership decision chain');
});

console.log('  ✅ ownership decision chain renders from real ownership, deal-calculator, funding, and resale modules');
