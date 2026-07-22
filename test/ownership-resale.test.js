'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const data = JSON.parse(read('data/policy/resale-conventions.json'));
const hnaSrc = read('js/hna/hna-ownership-need.js');
const resaleSrc = read('js/hna/ownership-resale.js');
const dealSrc = read('js/deal-calculator.js');
const dealHtml = read('deal-calculator.html');
const hnaHtml = read('housing-needs-assessment.html');
const packageJson = JSON.parse(read('package.json'));
const homeownership = JSON.parse(read('data/policy/homeownership-programs.json'));

const sandbox = {
  window: {},
  console,
  Math,
  Number,
  Date,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(hnaSrc, sandbox, { filename: 'js/hna/hna-ownership-need.js' });
vm.runInContext(resaleSrc, sandbox, { filename: 'js/hna/ownership-resale.js' });

const Ownership = sandbox.window.HNAOwnershipNeed;
const Resale = sandbox.window.OwnershipResale;

function byId(id) {
  return data.conventions.find((row) => row.id === id);
}

console.log('\nOwnership resale convention tests');
console.log('='.repeat(58));

assert(Resale && typeof Resale.evaluateConvention === 'function', 'OwnershipResale module exports evaluateConvention');
assert.equal(data.schema, 'ownership-resale-conventions/v1', 'resale convention schema is versioned');
assert.equal(data.meta.owner_decision, 'C4 resolved: pluggable resaleConvention, WMRHC default, owner confirms convention set.');
assert.equal(homeownership.schema, 'homeownership-programs/v1', 'consumer homeownership dataset still exists separately');
assert(!resaleSrc.includes('homeownership-programs.json'), 'resale module does not consume consumer homebuyer cards');

assert(dealHtml.indexOf('js/hna/hna-ownership-need.js') < dealHtml.indexOf('js/hna/ownership-resale.js'), 'Deal Calculator loads ownership math before resale module');
assert(dealHtml.indexOf('js/hna/ownership-resale.js') < dealHtml.indexOf('js/deal-calculator.js'), 'Deal Calculator loads resale module before deal calculator');
assert(hnaHtml.includes('js/hna/ownership-resale.js'), 'HNA ownership path loads resale module');
assert(dealSrc.includes('data/policy/resale-conventions.json'), 'Deal Calculator fetches resale convention data');
assert(dealSrc.includes('computeOwnershipResale'), 'Deal Calculator wires resale computation into for-sale feasibility');

assert.equal(data.conventions.length, 3, 'three Colorado resale conventions are present');
['fixed_simple', 'lesser_of_fixed_cpi', 'shared_appreciation'].forEach((id) => {
  const convention = byId(id);
  assert(convention, `${id} convention exists`);
  assert(convention.source_program, `${id} has source_program`);
  assert(convention.source_url && /^https:\/\//.test(convention.source_url), `${id} has verified HTTPS source_url`);
  assert(!/example\./.test(new URL(convention.source_url).hostname), `${id} source_url is not a placeholder`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(convention.last_verified), `${id} has ISO last_verified`);
});
assert.equal(byId('fixed_simple').default, true, 'WMRHC fixed_simple is the default convention');
assert.equal(byId('fixed_simple').annual_rate, 0.03, 'WMRHC simple rate is pinned at 3%');
assert.equal(byId('lesser_of_fixed_cpi').annual_rate, 'VERIFY', 'APCHA exact rate remains VERIFY until primary-source confirmed');
assert.equal(byId('shared_appreciation').parameter_status, 'VERIFY_PRIMARY_DOC', 'Elevation share remains primary-doc VERIFY');

const wmrhc = Resale.evaluateConvention(byId('fixed_simple'), {
  purchasePrice: 400000,
  holdingPeriodYears: 5,
  remainingPrincipal: 300000,
  sellingCosts: 20000,
  ami4Person: 150000,
  targetAmiPct: 1.20,
  maxAffordablePrice: Ownership.maxAffordablePrice
});
assert.equal(wmrhc.maxResalePrice, 460000, 'WMRHC 3% simple math: 400,000 held 5 years -> 460,000');
assert.equal(wmrhc.ownerGrossEquity, 140000, 'owner gross equity subtracts remaining principal and selling costs');
assert.equal(wmrhc.preservesAffordability, true, 'WMRHC example remains below the current AMI-affordable benchmark');

const apcha = Resale.evaluateConvention(byId('lesser_of_fixed_cpi'), {
  purchasePrice: 400000,
  holdingPeriodYears: 5,
  remainingPrincipal: 300000,
  sellingCosts: 20000,
  ami4Person: 150000,
  targetAmiPct: 1.20,
  maxAffordablePrice: Ownership.maxAffordablePrice
});
assert.equal(apcha.maxResalePrice, 460000, 'APCHA upper-bound screen uses the fixed leg only');
assert.equal(apcha.verifyParameter, true, 'APCHA rate is visibly VERIFY');

const elevation = Resale.evaluateConvention(byId('shared_appreciation'), {
  purchasePrice: 400000,
  holdingPeriodYears: 5,
  marketAppreciation: 100000,
  remainingPrincipal: 300000,
  sellingCosts: 20000,
  ami4Person: 150000,
  targetAmiPct: 1.20,
  maxAffordablePrice: Ownership.maxAffordablePrice
});
assert.equal(elevation.maxResalePrice, 445000, 'Elevation shared-appreciation math uses base + 25% x appreciation + selling costs');
assert.equal(elevation.ownerGrossEquity, 125000, 'Elevation equity subtracts principal and selling costs');
assert.equal(elevation.verifyParameter, true, 'Elevation share is visibly VERIFY pending primary-doc confirmation');

const preserves = Resale.evaluateConvention(byId('fixed_simple'), {
  purchasePrice: 250000,
  holdingPeriodYears: 1,
  ami4Person: 100000,
  targetAmiPct: 0.80,
  maxAffordablePrice: Ownership.maxAffordablePrice
});
const drifts = Resale.evaluateConvention(byId('fixed_simple'), {
  purchasePrice: 500000,
  holdingPeriodYears: 5,
  ami4Person: 100000,
  targetAmiPct: 0.80,
  maxAffordablePrice: Ownership.maxAffordablePrice
});
assert.equal(preserves.preservesAffordability, true, 'preservation flag is true when cap is below current AMI-affordable price');
assert.equal(drifts.preservesAffordability, false, 'preservation flag flips when cap exceeds current AMI-affordable price');
assert(drifts.preservationLabel.includes("today's AMI-affordable price"), 'preservation label states current benchmark');

const screen = Resale.evaluateAll(data, {
  purchasePrice: 400000,
  holdingPeriodYears: 5,
  marketAppreciation: 100000,
  remainingPrincipal: 300000,
  sellingCosts: 20000,
  ami4Person: 100000,
  targetAmiPct: 1.20,
  maxAffordablePrice: Ownership.maxAffordablePrice
});
assert.equal(screen.length, 3, 'evaluateAll returns every convention');
assert.equal(screen[0].conventionId, 'fixed_simple', 'default convention remains first');

const guardedText = [resaleSrc, JSON.stringify(data)].join('\n').toLowerCase();
['forecast', 'projected', 'will appreciate'].forEach((term) => {
  assert(!guardedText.includes(term), `resale lane avoids banned language: ${term}`);
});
assert(resaleSrc.includes('SCREENING_CAVEAT'), 'screening-only caveat is carried in module');

assert.equal(packageJson.scripts['test:ownership-resale'], 'node test/ownership-resale.test.js', 'package exposes test:ownership-resale');
assert(packageJson.scripts['test:ci'].includes('npm run test:ownership-resale'), 'test:ci includes resale convention guard');

console.log('Ownership resale convention tests passed.');
