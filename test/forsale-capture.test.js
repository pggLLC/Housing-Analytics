'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ProjectScenario = require('../js/project-market-study/project-scenario.js');
const EffectiveDemand = require('../js/project-market-study/effective-demand.js');
const ForsaleCapture = require('../js/project-market-study/forsale-capture.js');
const scenario = require('../data/fixtures/fruita-commons.scenario.json');

function ownershipNeed() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8'), context);
  const module = context.window.HNAOwnershipNeed;
  const chas = require('../data/hna/place-chas.json').places['0828745'];
  const profile = require('../data/hna/summary/0828745.json').acsProfile;
  return module.computeOwnershipNeed({
    geographyId: '0828745', geoLevel: 'place', placeChasEntry: chas,
    amiGapEntry: { ami_4person: scenario.local_baseline.ami_4person.value },
    homeValueEntry: scenario.local_baseline.home_value,
    ownerValueSupply: module.ownerValueSupplySeries(profile)
  });
}

function assumptions() {
  const out = {};
  EffectiveDemand.STAGE_IDS.forEach((id) => {
    out[id] = {
      share: id === 'contract_fallout' ? 0.1 : 1,
      classification: 'user_entered', basis: 'Test-only illustrative evidence.', verify: true,
      sensitivity: id === 'contract_fallout'
        ? { low: 0.05, base: 0.1, high: 0.15 }
        : { low: 1, base: 1, high: 1 }
    };
  });
  return out;
}

function realFunnel(overrides) {
  assert.strictEqual(ProjectScenario.validate(scenario), true);
  const observed = EffectiveDemand.fromOwnershipNeed(scenario, ownershipNeed());
  return EffectiveDemand.run(scenario, observed, overrides || assumptions());
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
}
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function scenarioAt(result, months) { return result.scenarios.find((item) => item.selloutMonths === months); }

const funnel = realFunnel();
// Hand derivation from real ProjectScenario + EffectiveDemand calls:
// observed pool = 343; ten pass-through stages leave 343; the funnel's
// contract_fallout share is 0.10, so effective demand = 343 * .10 = 34.3.
close(funnel.effectiveDemand, 34.3, 'real funnel pool');
const result = ForsaleCapture.run(scenario, funnel, { selloutMonths: 30, distribution: 'even' });
assert.deepStrictEqual(ForsaleCapture.SELLOUT_SCENARIOS, [24, 30, 36, 48]);
assert.deepStrictEqual(result.scenarios.map((item) => item.selloutMonths), [24, 30, 36, 48]);

const thirty = scenarioAt(result, 30);
// Hand derivation: 50 / 30 = 1.6666666666666667 for months 1-29; month
// 30 absorbs 50 - sum(months 1-29). The first 12 months total 20 and the
// full schedule totals exactly 50. Penetration = 50 / 34.3.
close(thirty.monthlyClosings[0], 50 / 30, 'month one');
close(sum(thirty.monthlyClosings.slice(0, 12)), 20, 'year-one closings');
assert.strictEqual(sum(thirty.monthlyClosings), 50);
close(thirty.annualClosings[0], 20, 'annual closings');
close(thirty.annualCaptureRate[0].value, 20 / 34.3, 'year-one capture');
close(thirty.totalProjectPenetration.value, 50 / 34.3, 'penetration');
assert.deepStrictEqual(thirty.totalProjectPenetration.denominator, {
  value: funnel.effectiveDemand, basis: 'Phase-6 modeled effective demand', classification: 'modeled'
});
assert.strictEqual(thirty.poolGrowthAnnual.share, null);
assert.strictEqual(thirty.poolDepletionModeled, true);
assert.strictEqual(thirty.annualCaptureRate[2].value, 'not_available');
assert.strictEqual(thirty.annualCaptureRate[2].reason, 'pool_zero_see_data_limitations');

const survivalAssumptions = assumptions();
survivalAssumptions.contract_fallout.share = 0.85;
survivalAssumptions.contract_fallout.sensitivity = { low: 0.8, base: 0.85, high: 0.9 };
const survivalFunnel = realFunnel(survivalAssumptions);
const survivalResult = ForsaleCapture.run(scenario, survivalFunnel, { selloutMonths: 30 });
// Hand derivation from the real funnel stage: the 0.85 share is the fraction
// of contracts that survive to closing, so 50 / 0.85 = 58.8235294117647.
close(scenarioAt(survivalResult, 30).grossContractsNeeded.value, 50 / 0.85, 'gross contracts');
assert.deepStrictEqual(scenarioAt(survivalResult, 30).grossContractsNeeded.denominator, {
  value: 0.85, basis: 'the Phase-6 contract_fallout survival share', classification: 'modeled'
});

const zeroSurvival = clone(survivalFunnel);
zeroSurvival.stages.find((stage) => stage.id === 'contract_fallout').share = 0;
assert.strictEqual(
  scenarioAt(ForsaleCapture.run(scenario, zeroSurvival, { selloutMonths: 30 }), 30).grossContractsNeeded.value,
  'not_available'
);

// Hand derivation with 10% annual replenishment: year two starts with
// 34.3 * 1.10 - 20 prior closings = 17.73 available households.
const growing = ForsaleCapture.run(scenario, funnel, {
  selloutMonths: 30, distribution: 'even',
  poolGrowthAnnual: { share: 0.1, classification: 'user_entered', basis: 'Test-only annual replenishment.', verify: true }
});
close(scenarioAt(growing, 30).annualCaptureRate[1].denominator.value, 17.73, 'year-two growing pool');
assert.strictEqual(scenarioAt(growing, 30).poolDepletionModeled, false);

const custom = Array(10).fill(5);
const tenMonth = ForsaleCapture.run(scenario, funnel, { selloutMonths: 10, distribution: custom });
assert.deepStrictEqual(tenMonth.scenarios.map((item) => item.selloutMonths), [24, 30, 36, 48, 10]);
assert.deepStrictEqual(scenarioAt(tenMonth, 10).monthlyClosings, custom);
assert.throws(() => ForsaleCapture.run(scenario, funnel, { selloutMonths: 10, distribution: Array(10).fill(4) }), /sum to total_units/);
assert.throws(() => ForsaleCapture.run(scenario, funnel, { fallout: 0.2 }), /unsupported pacing key: fallout/);
result.scenarios.forEach((item) => assert.strictEqual(sum(item.monthlyClosings), 50));

// The real HNA input has no observed pool in the fixture's 100-120 AMI band.
// EffectiveDemand therefore allocates 0 there; 10 scenario units / 0 is
// unavailable with the explicit data-limitation reason, never a numeric value.
assert.strictEqual(funnel.byAmiBand['100-120'].value, 0);
assert.strictEqual(result.captureByAmiBand['100-120'].value, 'not_available');
assert.strictEqual(result.captureByAmiBand['100-120'].reason, 'pool_zero_see_data_limitations');
assert.strictEqual(result.captureByAmiBand['100-120'].numerator, 10);
assert.strictEqual(sum(Object.values(result.captureByAmiBand).map((row) => row.numerator)), 50);
assert.strictEqual(sum(Object.values(result.captureByUnitType).map((row) => row.numerator)), 50);
assert.strictEqual(sum(Object.values(result.captureByBedroom).map((row) => row.numerator)), 50);
assert.strictEqual(result.captureByAmiBand['90-100'].gapVsLocalPrice, funnel.byAmiBand['90-100'].gapVsLocalPrice);
assert.strictEqual(result.captureByAmiBand['90-100'].assistanceRangeCheck, funnel.byAmiBand['90-100'].assistanceRangeCheck);

const falloutUnresolved = clone(funnel);
falloutUnresolved.stages.find((stage) => stage.id === 'contract_fallout').share = null;
const falloutResult = ForsaleCapture.run(scenario, falloutUnresolved, { selloutMonths: 30 });
assert.strictEqual(scenarioAt(falloutResult, 30).grossContractsNeeded.value, 'not_available');
assert.strictEqual(
  scenarioAt(falloutResult, 30).grossContractsNeeded.denominator.basis,
  'the Phase-6 contract_fallout survival share'
);
assert.strictEqual(sum(scenarioAt(falloutResult, 30).monthlyClosings), 50);

const unresolvedAssumptions = assumptions();
unresolvedAssumptions.location_preference.share = null;
const unresolved = ForsaleCapture.run(scenario, realFunnel(unresolvedAssumptions), { selloutMonths: 30 });
unresolved.scenarios.forEach((item) => {
  assert.strictEqual(item.monthlyClosings, 'not_available');
  assert.strictEqual(item.annualClosings, 'not_available');
  assert.strictEqual(item.annualCaptureRate, 'not_available');
  assert.strictEqual(item.grossContractsNeeded.value, 'not_available');
  assert.strictEqual(item.totalProjectPenetration.value, 'not_available');
  assert.strictEqual(item.totalProjectPenetration.denominator.value, 'not_available');
  assert.strictEqual(item.captureSensitivity, 'not_available');
});
[unresolved.captureByAmiBand, unresolved.captureByUnitType, unresolved.captureByBedroom].forEach((tab) => {
  Object.values(tab).forEach((row) => {
    assert.strictEqual(row.value, 'not_available');
    assert.strictEqual(row.denominator.value, 'not_available');
    assert.strictEqual(row.numerator, 'not_available');
  });
});

function walkFigures(value, parentKey) {
  if (!value || typeof value !== 'object') return;
  if (parentKey !== 'denominator' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    assert.ok(value.denominator && Object.prototype.hasOwnProperty.call(value.denominator, 'value'), 'figure denominator required');
    assert.strictEqual(value.classification, 'modeled');
  }
  Object.keys(value).forEach((key) => walkFigures(value[key], key));
}
walkFigures(result);
assert.ok(result.captureHumilityCaveat.includes('44%'));
assert.ok(result.captureHumilityCaveat.includes('screening arithmetic'));
assert.ok(result.competitiveSupplyNote.includes('no supply data source exists yet'));
assert.ok(result.scenarios.every((item) => item.scenarioLabel.endsWith('scenario, not a prediction')));
assert.strictEqual(result.phasingSource, 'user_pacing — scenario phasing is an owner input pending');

const source = fs.readFileSync(path.join(ROOT, 'js/project-market-study/forsale-capture.js'), 'utf8').toLowerCase();
['fore' + 'cast', 'fund' + 'able', 'satur' + 'ation', 'border' + 'line', 'heal' + 'thy', 'red ' + 'flag', 'acceptable-' + 'capture'].forEach((term) => {
  assert.ok(!source.includes(term), `banned module language: ${term}`);
});
assert.ok(!source.includes('subject-capture-stack'));
assert.ok(!source.includes('calculateabsorptionrisk'));

const pkg = require('../package.json');
assert.strictEqual(pkg.scripts['test:forsale-capture'], 'node test/forsale-capture.test.js');
assert.ok(pkg.scripts['test:ci'].indexOf('test:forsale-capture') > pkg.scripts['test:ci'].indexOf('test:effective-demand'));

console.log('forsale-capture tests passed');
