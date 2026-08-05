const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EffectiveDemand = require('../js/project-market-study/effective-demand.js');
const scenarios = [
  'fruita-commons.scenario.json',
  'fruita-commons-compact.scenario.json',
  'fruita-commons-family.scenario.json',
  'fruita-commons-broad-income.scenario.json'
].map((name) => require(path.join(ROOT, 'data/fixtures', name)));

function loadOwnershipNeed() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8'), context);
  return context.window.HNAOwnershipNeed;
}

function realObserved(scenario) {
  const module = loadOwnershipNeed();
  const chas = require('../data/hna/place-chas.json').places['0828745'];
  const profile = require('../data/hna/summary/0828745.json').acsProfile;
  const ownershipNeed = module.computeOwnershipNeed({
    geographyId: '0828745',
    geoLevel: 'place',
    placeChasEntry: chas,
    amiGapEntry: { ami_4person: scenario.local_baseline.ami_4person.value },
    homeValueEntry: scenario.local_baseline.home_value,
    ownerValueSupply: module.ownerValueSupplySeries(profile)
  });
  return EffectiveDemand.fromOwnershipNeed(scenario, ownershipNeed);
}

const SHARES = [0.8, 0.75, 0.9, 0.8, 0.9, 0.85, 0.8, 0.9, 0.75, 0.8, 0.95];
function illustrative() {
  const assumptions = {};
  EffectiveDemand.STAGE_IDS.forEach((id, i) => {
    assumptions[id] = {
      share: SHARES[i], classification: 'user_entered', basis: 'Test-only illustrative evidence.', verify: true,
      sensitivity: { low: Math.max(0, SHARES[i] - 0.05), base: SHARES[i], high: Math.min(1, SHARES[i] + 0.05) }
    };
  });
  assumptions.in_migration = {
    share: 1.2, classification: 'user_entered', basis: 'Test-only value within the documented 9-56% range.', verify: true,
    allowIncrease: true, sensitivity: { low: 1.09, base: 1.2, high: 1.3 }
  };
  return assumptions;
}

function close(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`); }
function sum(tab) { return Object.values(tab).reduce((n, row) => n + row.value, 0); }

const scenario = scenarios[0];
const observed = realObserved(scenario);
assert.strictEqual(observed.total, 343);
assert.strictEqual(observed.label, EffectiveDemand.PROTECTED_LABEL);

// Hand derivation from the real HNA call:
// observed = CHAS 51-80 renters 244.4 + 81-100 renters 98.6 = 343.0.
// The optional outside-area multiplier gives 343 * 1.20 = 411.6.
// Reductions then multiply successively by
// .80, .75, .90, .80, .90, .85, .80, .90, .75, .80, .95:
// 411.6, 329.28, 246.96, 222.264, 177.8112, 160.03008,
// 136.025568, 108.8204544, 97.93840896, 73.45380672,
// 58.763045376, 55.8248931072 households.
const result = EffectiveDemand.run(scenario, observed, illustrative());
const pinned = [343, 411.6, 329.28, 246.96, 222.264, 177.8112, 160.03008, 136.025568, 108.8204544, 97.93840896, 73.45380672, 58.763045376, 55.8248931072];
result.stages.forEach((stage, i) => close(stage.outputCount, pinned[i], stage.id));
close(result.effectiveDemand, 55.8248931072, 'effective demand');

assert.deepStrictEqual(result.stages.map((stage) => stage.id), ['observed_base', 'in_migration'].concat(EffectiveDemand.STAGE_IDS));
assert.ok(result.stages.slice(2).every((stage) => stage.classification === 'modeled'));
for (let i = 2; i < result.stages.length; i += 1) assert.ok(result.stages[i].outputCount <= result.stages[i].inputCount);
close(sum(result.byAmiBand), result.effectiveDemand, 'AMI conservation');
close(sum(result.byUnitType), result.effectiveDemand, 'unit conservation');
close(sum(result.byBedroom), result.effectiveDemand, 'bedroom conservation');
assert.ok(result.sensitivity.low <= result.sensitivity.base && result.sensitivity.base <= result.sensitivity.high);
assert.strictEqual(result.byAmiBand['70-80'].householdSize, 2);
assert.strictEqual(result.byAmiBand['90-100'].householdSize, 4);

assert.ok(EffectiveDemand.STAGE_IDS.every((id) => EffectiveDemand.DEFAULT_ASSUMPTIONS[id].share === null));
const unresolvedAssumptions = illustrative();
unresolvedAssumptions.debt_credit_readiness.share = null;
const unresolved = EffectiveDemand.run(scenario, observed, unresolvedAssumptions);
assert.strictEqual(unresolved.effectiveDemand, 'not_available');
assert.ok(unresolved.unresolvedStages.includes('debt_credit_readiness'));
assert.strictEqual(unresolved.stages.find((stage) => stage.id === 'debt_credit_readiness').outputCount, 'not_available');
assert.strictEqual(unresolved.stages.find((stage) => stage.id === 'mortgage_readiness').inputCount, 'not_available');
[unresolved.byAmiBand, unresolved.byUnitType, unresolved.byBedroom].forEach((tab) => {
  assert.ok(Object.values(tab).every((row) => row.value === 'not_available'));
});

const badReduction = illustrative();
badReduction.location_preference.share = 1.01;
assert.throws(() => EffectiveDemand.run(scenario, observed, badReduction), /0\.\.1/);
const missingFlag = illustrative();
delete missingFlag.in_migration.allowIncrease;
assert.throws(() => EffectiveDemand.run(scenario, observed, missingFlag), /allowIncrease/);
const outOfRange = illustrative();
outOfRange.in_migration.share = 1.57;
assert.throws(() => EffectiveDemand.run(scenario, observed, outOfRange), /1\.09-1\.56/);

scenarios.forEach((doc) => {
  const adapted = realObserved(doc);
  const output = EffectiveDemand.run(doc, adapted, illustrative());
  assert.strictEqual(output.stages.length, 13);
  close(sum(output.byAmiBand), output.effectiveDemand, 'four-fixture AMI conservation');
});

const source = fs.readFileSync(path.join(ROOT, 'js/project-market-study/effective-demand.js'), 'utf8');
const banned = ['capture rate', 'capture rates', 'absorption', 'sellout', 'time-phasing', 'forecast', 'will buy', 'qualified buyer', 'mortgage-ready buyers'];
banned.forEach((term) => assert.ok(!source.toLowerCase().includes(term), `banned module language: ${term}`));
['Fruita Commons', 'fruita-commons', '486295', '500000'].forEach((term) => assert.ok(!source.includes(term), `fixture value leaked: ${term}`));

const pkg = require('../package.json');
assert.strictEqual(pkg.scripts['test:effective-demand'], 'node test/effective-demand.test.js');
assert.ok(pkg.scripts['test:ci'].includes('test:project-scenario && npm run test:effective-demand && npm run test:buyer-assistance-programs'));

console.log('effective-demand tests passed');
