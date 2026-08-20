'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const data = JSON.parse(read('data/policy/resale-conventions.json'));
const hnaSrc = read('js/hna/hna-ownership-need.js');
const resaleSrc = read('js/hna/ownership-resale.js');
const strategySrc = read('js/hna/hna-ownership-strategy.js');
const renderersSrc = read('js/hna/hna-renderers.js');
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
assert.equal(data.schema, 'ownership-resale-conventions/v2', 'resale convention schema is versioned');
assert.equal(data.meta.owner_decision, 'D-4 resolved: compare all mechanisms in declared order and let the user select; no ranking.');
assert.equal(homeownership.schema, 'homeownership-programs/v1', 'consumer homeownership dataset still exists separately');
assert(!resaleSrc.includes('homeownership-programs.json'), 'resale module does not consume consumer homebuyer cards');

assert(dealHtml.indexOf('js/hna/hna-ownership-need.js') < dealHtml.indexOf('js/hna/ownership-resale.js'), 'Deal Calculator loads ownership math before resale module');
assert(dealHtml.indexOf('js/hna/ownership-resale.js') < dealHtml.indexOf('js/deal-calculator.js'), 'Deal Calculator loads resale module before deal calculator');
assert(hnaHtml.includes('js/hna/ownership-resale.js'), 'HNA ownership path loads resale module');
assert(dealSrc.includes('data/policy/resale-conventions.json'), 'Deal Calculator fetches resale convention data');
assert(dealSrc.includes('computeOwnershipResale'), 'Deal Calculator wires resale computation into for-sale feasibility');

assert.equal(data.conventions.length, 4, 'four peer resale mechanisms are present');
['fixed_simple', 'lesser_of_fixed_cpi', 'shared_appreciation', 'recapture'].forEach((id) => {
  const convention = byId(id);
  assert(convention, `${id} convention exists`);
  assert(convention.source_program, `${id} has source_program`);
  assert(convention.source_url && /^https:\/\//.test(convention.source_url), `${id} has verified HTTPS source_url`);
  assert(!/example\./.test(new URL(convention.source_url).hostname), `${id} source_url is not a placeholder`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(convention.last_verified), `${id} has ISO last_verified`);
  assert(convention.source, `${id} has source classification text`);
  assert(convention.source_note, `${id} has a source note`);
  assert.equal(convention.classification, 'modeled', `${id} is classified as modeled`);
  assert.equal(typeof convention.verify, 'boolean', `${id} carries an explicit verify flag`);
});
assert.equal(byId('fixed_simple').default, true, 'WMRHC fixed_simple is the default convention');
assert.equal(byId('fixed_simple').annual_rate, 0.03, 'WMRHC simple rate is pinned at 3%');
assert.equal(byId('lesser_of_fixed_cpi').annual_rate, 'VERIFY', 'APCHA exact rate remains VERIFY until primary-source confirmed');
assert.equal(byId('shared_appreciation').parameter_status, 'VERIFY_PRIMARY_DOC', 'Elevation share remains primary-doc VERIFY');
assert.equal(byId('recapture').default_recapture_amount, 90000, 'recapture comparison carries the $90,000 screening default');

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
assert.equal(screen.length, 4, 'evaluateAll returns every convention');
assert.equal(screen[0].conventionId, 'fixed_simple', 'default convention remains first');

const comparisonInput = {
  purchasePrice: 400000,
  holdingPeriodYears: 10,
  remainingPrincipal: 250000,
  sellingCosts: 20000,
  cpiRateAnnual: 0.02,
  recaptureAmount: 90000,
  subsidyType: 'none',
  scenarios: [{ id: 'high', label: 'High (6% annually)', appreciationRateAnnual: 0.06 }],
};
const comparison = Resale.compareConventions(data, comparisonInput);
assert.deepEqual(
  comparison.rows.map((row) => row.conventionId),
  data.conventions.map((row) => row.id),
  'comparison preserves declared dataset order instead of outcome ordering'
);
const highPrices = comparison.rows.map((row) => row.outcomes[0].maxResalePrice);
assert.equal(new Set(highPrices).size, 4, 'all four mechanisms produce distinct next-buyer prices under the same 6% scenario');
assert.deepEqual(highPrices, [520000, 480000, 499085, 716339], 'same-scenario comparison pins each mechanism without ranking');
assert.equal(comparison.rows.find((row) => row.conventionId === 'recapture').outcomes[0].publicSubsidyRecaptured, 90000, 'recapture returns the fixed screening amount when net proceeds permit');

const homeDevelopment = Resale.compareConventions(data, Object.assign({}, comparisonInput, {
  subsidyType: 'home_development_subsidy',
  selectedConventionId: 'recapture',
}));
const gatedRecapture = homeDevelopment.options.find((option) => option.id === 'recapture');
assert.equal(gatedRecapture.disabled, true, 'recapture is disabled for HOME development subsidy');
assert(gatedRecapture.disabledReason.includes('24 CFR 92.254(a)(5)(ii)(A)(5)'), 'disabled reason travels with the option and contains the citation');
assert.notEqual(homeDevelopment.selectedConventionId, 'recapture', 'an illegal requested selection falls back to an available mechanism');
Resale.SUBSIDY_TYPES.filter((type) => type.id !== 'home_development_subsidy').forEach((type) => {
  const option = Resale.compareConventions(data, Object.assign({}, comparisonInput, { subsidyType: type.id }))
    .options.find((candidate) => candidate.id === 'recapture');
  assert.equal(option.disabled, false, `recapture remains selectable for ${type.id}`);
});

const dom = new JSDOM('<!doctype html><div id="comparison"></div>', {
  url: 'http://127.0.0.1/ownership-resale-comparison',
});
const mount = dom.window.document.getElementById('comparison');
mount.innerHTML = Resale.renderComparisonHtml(homeDevelopment);
assert.equal(mount.querySelector('option[value="recapture"]').disabled, true, 'rendered selector enforces the HOME development gate');
assert(mount.textContent.includes('24 CFR 92.254(a)(5)(ii)(A)(5)'), 'rendered disabled state shows the legal citation');
assert.deepEqual(
  Array.from(mount.querySelectorAll('[data-resale-row]')).map((row) => row.getAttribute('data-resale-row')),
  data.conventions.map((row) => row.id),
  'rendered comparison order is the declared order'
);
assert(!mount.querySelector('[data-recommended], .recommended'), 'comparison renders no recommended badge');
assert(!resaleSrc.includes('.sort('), 'comparison engine applies no outcome sort');
assert(strategySrc.includes('renderComparisonHtml'), 'HNA ownership strategy uses the shared comparison renderer');
assert(renderersSrc.includes("'data/policy/resale-conventions.json'"), 'HNA extends its existing dataset load path for the comparison');
assert(dealSrc.includes('renderComparisonHtml'), 'Deal Calculator uses the same shared comparison renderer');
dom.window.close();

const guardedText = [resaleSrc, JSON.stringify(data)].join('\n').toLowerCase();
['forecast', 'projected', 'will appreciate'].forEach((term) => {
  assert(!guardedText.includes(term), `resale lane avoids banned language: ${term}`);
});
assert(resaleSrc.includes('SCREENING_CAVEAT'), 'screening-only caveat is carried in module');

assert.equal(packageJson.scripts['test:ownership-resale'], 'node test/ownership-resale.test.js', 'package exposes test:ownership-resale');
assert(packageJson.scripts['test:ci'].includes('npm run test:ownership-resale'), 'test:ci includes resale convention guard');

console.log('Ownership resale convention tests passed.');
