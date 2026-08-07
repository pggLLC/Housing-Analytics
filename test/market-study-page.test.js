'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const Page = require('../js/project-market-study/market-study-page.js');
const ProjectScenario = require('../js/project-market-study/project-scenario.js');
const OwnershipFinance = require('../js/hna/ownership-finance.js');
const LandDisposition = require('../js/project-market-study/land-disposition.js');
const Lifecycle = require('../js/project-market-study/shared-equity-lifecycle.js');
const Waterfall = require('../js/project-market-study/resale-waterfall.js');
const EffectiveDemand = require('../js/project-market-study/effective-demand.js');
const ForsaleCapture = require('../js/project-market-study/forsale-capture.js');
const conventions = require('../data/policy/resale-conventions.json');
const landDataset = require('../data/policy/land-disposition-models.json');

const scenarioNames = [
  'fruita-commons.scenario.json', 'fruita-commons-compact.scenario.json',
  'fruita-commons-family.scenario.json', 'fruita-commons-broad-income.scenario.json'
];
const scenarios = scenarioNames.map((name) => require(path.join(ROOT, 'data/fixtures', name)));

function ownershipNeedModule() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8'), context);
  return context.window.HNAOwnershipNeed;
}
function observed(scenario) {
  const module = ownershipNeedModule();
  const chas = require('../data/hna/place-chas.json').places['0828745'];
  const profile = require('../data/hna/summary/0828745.json').acsProfile;
  const need = module.computeOwnershipNeed({
    geographyId: '0828745', geoLevel: 'place', placeChasEntry: chas,
    amiGapEntry: { ami_4person: scenario.local_baseline.ami_4person.value },
    homeValueEntry: scenario.local_baseline.home_value,
    ownerValueSupply: module.ownerValueSupplySeries(profile)
  });
  return EffectiveDemand.fromOwnershipNeed(scenario, need);
}
const data = { scenarios, conventions, observed: observed(scenarios[0]) };
function dom() {
  const instance = new JSDOM('<main><div id="mount"></div></main>', { url: 'https://cohoanalytics.com/for-sale-market-study.html' });
  return { window: instance.window, mount: instance.window.document.getElementById('mount') };
}
function money(value) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function text(node) { return node.textContent.replace(/\s+/g, ' ').trim(); }

const base = Page.buildModel(data, {});
const defaultDom = dom();
Page.render(defaultDom.mount, base, data);

// Six house-card sections render from the real baseline fixture.
assert.deepStrictEqual(
  Array.from(defaultDom.mount.querySelectorAll(':scope > section')).map((node) => node.id),
  ['ms-s1', 'ms-s2', 'ms-s3', 'ms-s4', 'ms-s5', 'ms-s6']
);

// S1: direct ProjectScenario output, explicit TDC degradation, pending inputs,
// and candidate-only partner language are all visible.
const directDerived = ProjectScenario.derive(scenarios[0], OwnershipFinance);
directDerived.bands.forEach((band) => {
  assert(text(defaultDom.mount.querySelector('#ms-s1')).includes(band.assistanceRangeCheck));
  assert(text(defaultDom.mount.querySelector('#ms-s1')).includes(money(band.maxAffordablePrice)));
});
assert(text(defaultDom.mount.querySelector('#ms-s1')).includes('not_available — owner input required'));
assert(text(defaultDom.mount.querySelector('#ms-s1')).includes(scenarios[0].meta.owner_inputs_pending.join(', ')));
assert(text(defaultDom.mount.querySelector('#ms-s1')).includes('candidate — no commitment'));
assert(!text(defaultDom.mount.querySelector('#ms-s1')).includes('TDC per unit: 0'));

// S2: policy dataset order is preserved and lifecycle dollars equal direct calls.
const landNodes = Array.from(defaultDom.mount.querySelectorAll('[data-land-model]'));
assert.deepStrictEqual(landNodes.map((node) => node.dataset.landModel), landDataset.models.map((row) => row.id));
const directLand = LandDisposition.compare(Page.LAND_INPUTS);
directLand.forEach((row, index) => {
  const direct = Lifecycle.project(Object.assign({}, Page.lifecycleInput(Lifecycle.SCENARIOS.base, row.engineInputs), {
    formula: { type: 'fixed_simple', annualRate: 0.03, appraisalCap: false }
  }));
  assert(text(landNodes[index]).includes(money(direct.results[5].monthlyHousingCost)));
  assert.strictEqual(Object.keys(row.assessments).length, 15);
});
assert(text(landNodes[0]).includes('hypothesis_to_test'));

// S3: every convention/horizon cell is a direct fromConvention result.
const directConvention = Lifecycle.fromConvention(
  conventions, 'fixed_simple', Page.lifecycleInput(Lifecycle.SCENARIOS.base, directLand[0].engineInputs)
);
const fixedCard = defaultDom.mount.querySelector('[data-convention="fixed_simple"]');
[5, 10, 20, 30].forEach((year) => {
  assert(text(fixedCard).includes(money(directConvention.results[year].ownerNetProceeds)));
  assert(text(fixedCard).includes(money(directConvention.results[year].nextBuyerMaxAffordablePrice)));
});
assert(text(defaultDom.mount.querySelector('#ms-s3')).includes('scenario, not a prediction'));
assert(text(defaultDom.mount.querySelector('#ms-s3')).includes('VERIFY parameter'));

// S4 default uses a real lifecycle year-result; public-source recovery must
// survive that interface and render the Phase-2b worked-reference totals.
const defaultSettlement = Waterfall.settle(base.selectedConvention.results[base.selectedYear], Page.WATERFALL_INPUTS);
assert.equal(defaultSettlement.publicSubsidyRetainedInHome, 20000);
assert.equal(defaultSettlement.publicSubsidyRecapturedAtSale, 80000);
assert(text(defaultDom.mount.querySelector('#ms-s4')).includes('$20,000'));
assert(text(defaultDom.mount.querySelector('#ms-s4')).includes('$80,000'));

// S4: inject the documented worked example, still produced by the real engine,
// and pin its settlement outputs in the rendered DOM.
const workedYear = {
  year: 10, appraisalConstrainedPrice: 520000, remainingFirstMortgagePrincipal: 206667,
  subordinateBalances: [{ label: 'Public deferred assistance', balance: 50000, publicSource: true }],
  unrestrictedMarketValue: 600000, capitalImprovementCredit: 5000,
  nextBuyerMaxAffordablePrice: 480000, scenarioLabel: 'worked example — scenario, not a prediction'
};
const worked = Waterfall.settle(workedYear, Page.WATERFALL_INPUTS);
const workedModel = Object.assign({}, base, { settlement: worked });
const workedDom = dom();
Page.render(workedDom.mount, workedModel, data);
assert(text(workedDom.mount.querySelector('#ms-s4')).includes('$202,133'));
assert(text(workedDom.mount.querySelector('#ms-s4')).includes('$80,000'));
assert(text(workedDom.mount.querySelector('#ms-s4')).includes('$20,000'));

// A real settlement that raises the transparency warning must make a visible,
// non-hidden alert block in the DOM.
const warningYear = Object.assign({}, workedYear, {
  appraisalConstrainedPrice: 200000, remainingFirstMortgagePrincipal: 0,
  subordinateBalances: [{ label: 'Public second', balance: 100000, publicSource: true }],
  capitalImprovementCredit: 0
});
const warning = Waterfall.settle(warningYear, Object.assign({}, Page.WATERFALL_INPUTS, {
  sellingCosts: 0, sellingCostRate: undefined, returnOwnerDownPayment: false,
  ownerDownPayment: 0, originalRestrictedPrice: 100000,
  publicAppreciationShare: 0.5, totalOwnerCashInvested: 80000
}));
assert.strictEqual(warning.ownerNetTransparencyWarning, true);
const warningDom = dom();
Page.render(warningDom.mount, Object.assign({}, base, { settlement: warning }), data);
const warningBlock = warningDom.mount.querySelector('[data-transparency-warning="visible"]');
assert(warningBlock && !warningBlock.hidden);
assert.strictEqual(warningBlock.getAttribute('role'), 'alert');
assert(text(warningBlock).includes(warning.ownerNetTransparencyNote));

// S5 default: real all-null funnel is unavailable, every basis is present,
// and the observed protected label is verbatim.
assert.strictEqual(base.funnel.effectiveDemand, 'not_available');
EffectiveDemand.STAGE_IDS.forEach((id) => {
  assert(text(defaultDom.mount.querySelector('#ms-s5')).includes(EffectiveDemand.DEFAULT_ASSUMPTIONS[id].basis));
});
assert(text(defaultDom.mount.querySelector('#ms-s5')).includes(EffectiveDemand.PROTECTED_LABEL));
assert(text(defaultDom.mount.querySelector('#ms-s5')).includes('not_available — owner input required'));

// S6 default propagates unavailability and retains exact protected caveats.
assert(text(defaultDom.mount.querySelector('#ms-s6')).includes(base.capture.competitiveSupplyNote));
assert(text(defaultDom.mount.querySelector('#ms-s6')).includes(base.capture.captureHumilityCaveat));
assert(text(defaultDom.mount.querySelector('#ms-s6')).includes('denominator: not_available'));
assert(!text(defaultDom.mount.querySelector('#ms-s6')).includes('not_available: 0'));

// Entering a complete real assumption set recomputes S5/S6 through the engines.
const interactive = dom();
Page.start(interactive.mount, data);
const typed = interactive.mount.querySelector('[data-stage-id="household_size_compatibility"]');
typed.focus();
typed.value = '0';
typed.dispatchEvent(new interactive.window.Event('input', { bubbles: true }));
typed.value = '0.8';
typed.dispatchEvent(new interactive.window.Event('input', { bubbles: true }));
assert.strictEqual(typed.isConnected, true);
assert.strictEqual(interactive.window.document.activeElement, typed);
assert.strictEqual(typed.value, '0.8');
typed.dispatchEvent(new interactive.window.Event('change', { bubbles: true }));
assert.strictEqual(interactive.mount.querySelector('[data-stage-id="household_size_compatibility"]').value, '0.8');
assert.strictEqual(interactive.mount.querySelector('[data-stage-id="household_size_compatibility"]').placeholder, '0–1');
assert(text(interactive.mount.querySelector('#ms-s5')).includes('(decimal share, e.g. 0.8 = 80%)'));
const shares = {};
EffectiveDemand.STAGE_IDS.forEach((id) => { shares[id] = id === 'contract_fallout' ? 0.85 : 0.8; });
EffectiveDemand.STAGE_IDS.forEach((id) => {
  const input = interactive.mount.querySelector(`[data-stage-id="${id}"]`);
  input.value = '0';
  input.dispatchEvent(new interactive.window.Event('input', { bubbles: true }));
  input.value = String(shares[id]);
  input.dispatchEvent(new interactive.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new interactive.window.Event('change', { bubbles: true }));
});
const directResolved = Page.buildModel(data, { assumptions: shares });
assert.strictEqual(typeof directResolved.funnel.effectiveDemand, 'number');
assert(text(interactive.mount.querySelector('#ms-s5')).includes(directResolved.funnel.effectiveDemand.toLocaleString('en-US', { maximumFractionDigits: 3 })));
const directThirty = directResolved.capture.scenarios.find((item) => item.selloutMonths === 30);
assert(text(interactive.mount.querySelector('#ms-s6')).includes(
  directThirty.totalProjectPenetration.denominator.value.toLocaleString('en-US', { maximumFractionDigits: 3 })
));
assert(interactive.mount.querySelectorAll('#ms-s6 .ms-denominator').length > 0);

// A fresh render is session-clean: no assumption survives and no persistence API exists.
const fresh = dom();
Page.start(fresh.mount, data);
assert.strictEqual(fresh.mount.querySelector('[data-stage-id="contract_fallout"]').value, '');
assert(text(fresh.mount.querySelector('#ms-s5')).includes('not_available — owner input required'));

const source = fs.readFileSync(path.join(ROOT, 'js/project-market-study/market-study-page.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'for-sale-market-study.html'), 'utf8');
function productionGuard(moduleSource) {
  const lower = moduleSource.toLowerCase();
  ['recom' + 'mended', 'pref' + 'erred', 'win' + 'ner', 'best option', 'merit score'].forEach((term) => {
    assert(!lower.includes(term), `prohibited merit language: ${term}`);
  });
  assert(!/\.sort\s*\(/.test(moduleSource), 'no ordering transform');
  assert(!/localStorage|sessionStorage/.test(moduleSource), 'no browser persistence');
  assert(!/(model|result|row|item|stage|funnel|capture)\.[A-Za-z0-9_.]+\s*[+*\/-]\s*/.test(moduleSource), 'no arithmetic on engine outputs');
  assert(moduleSource.includes('data-transparency-warning="visible"'), 'visible transparency warning contract');
  assert(!/data-transparency-warning="visible"[^>]*hidden/.test(moduleSource), 'warning cannot be hidden');
  assert(moduleSource.includes('class="ms-denominator"'), 'denominator rendering contract');
  assert(moduleSource.includes('not_available — owner input required'), 'labeled unavailability contract');
}
productionGuard(source);
assert(!source.includes('localStorage'));
assert(html.includes('Screening estimate, not a completed market study') || html.includes('screening estimate, not a completed market study'));

// QA sabotage contracts: each prohibited mutation must trip the same guard.
assert.throws(() => productionGuard(source.replace('data-transparency-warning="visible"', 'data-transparency-warning="visible" hidden')), /warning cannot be hidden/);
assert.throws(() => productionGuard(`${source}\n/* recommended badge */`), /prohibited merit language/);
assert.throws(() => productionGuard(source.replace('class="ms-denominator"', 'class="ms-denominator-removed"')), /denominator rendering contract/);
assert.throws(() => productionGuard(source.replace('not_available — owner input required', '0')), /labeled unavailability contract/);

const pkg = require('../package.json');
assert.strictEqual(pkg.scripts['test:market-study-page'], 'node test/market-study-page.test.js');
assert(pkg.scripts['test:ci'].indexOf('test:market-study-page') > pkg.scripts['test:ci'].indexOf('test:forsale-capture'));

console.log('market-study-page tests passed');
