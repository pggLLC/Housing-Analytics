'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const land = require(path.join(ROOT, 'js/project-market-study/land-disposition.js'));
const lifecycle = require(path.join(ROOT, 'js/project-market-study/shared-equity-lifecycle.js'));
const dataset = require(path.join(ROOT, 'data/policy/land-disposition-models.json'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✅ ' + name); }
  catch (err) { failed += 1; console.error('  ❌ ' + name); console.error('     ' + err.message); }
}

function params(overrides) {
  return Object.assign({
    landValuePerUnit: 100000,
    groundRentMonthly: 150,
    groundRentEscalationRate: 0.02,
    marketPropertyTaxRate: 0.006,
    restrictedValueAssessment: false,
    unitPrice: 400000,
    discountedLandShare: 0.4,
    landWriteDown: 25000,
  }, overrides || {});
}

function lifecycleInput(engine, groundRent) {
  return {
    unrestrictedValue: 400000, restrictedPrice: 350000, downPayment: 35000,
    subordinateDebt: [], firstMortgage: { rateAnnual: 0.06, termYears: 30 },
    hoaMonthly: 0, hoaEscalationRate: 0,
    groundRentMonthly: groundRent == null ? engine.groundRentMonthly : groundRent,
    groundRentEscalationRate: engine.groundRentEscalationRate,
    propertyTaxRate: engine.propertyTaxRate, insuranceRate: 0.003, pmiRate: 0,
    formula: { type: 'fixed_simple', annualRate: 0.03, appraisalCap: false },
    scenario: { label: 'land integration scenario', marketGrowth: 0.03, amiGrowth: 0.03, cpiGrowth: 0.02 },
    ami4Person: 100000, amiPct: 0.8, householdSize: 4, sellingCostRate: 0.06,
    capitalImprovements: [], publicSubsidyAtClosing: 0, horizons: [5],
  };
}

function containsKey(value, pattern) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some((key) => pattern.test(key) || containsKey(value[key], pattern));
}

console.log('\nLand disposition comparison (Phase 2b)');
console.log('='.repeat(58));

test('all four models expose exactly 15 validated assessment fields', () => {
  assert.equal(land.MODELS.length, 4);
  land.compare(params()).forEach((row) => {
    assert.equal(Object.keys(row.assessments).length, 15);
    Object.values(row.assessments).forEach((field) => {
      assert.equal(typeof field.value, 'string');
      assert.equal(field.verify, true);
      assert(['appraiser', 'lender', 'assessor', 'attorney', 'administrator'].includes(field.validator));
      assert.equal(field.classification, 'modeled');
    });
  });
});

test('initial per-unit benefits match each model basis', () => {
  // Hand derivation with land value 100,000:
  // A = all excluded land = 100,000.
  // B = 40% entered discount × 100,000 = 40,000.
  // C = entered write-down = 25,000.
  // D = all excluded land = 100,000.
  const rows = land.compare(params());
  assert.deepEqual(rows.map((row) => row.initialPerUnitAffordabilityBenefit), [100000, 40000, 25000, 100000]);
  assert.deepEqual(rows.map((row) => row.engineInputs.landBenefitPerUnit), [100000, 40000, 25000, 100000]);
});

test('Models A and D pass retained-land tax treatment and ground rent', () => {
  ['model_a_public_land_retention', 'model_d_master_ground_lease'].forEach((id) => {
    const engine = land.engineInputs(id, params());
    // Hand derivation: improvements share = (400,000−100,000)/400,000 = .75;
    // effective rate = .006×.75 = .0045. Ground rent and escalation pass through unchanged.
    assert.equal(engine.propertyTaxTreatment, 'exempt_while_authority_owns');
    assert.equal(engine.propertyTaxRate, 0.0045);
    assert.equal(engine.groundRentMonthly, 150);
    assert.equal(engine.groundRentEscalationRate, 0.02);
    assert.equal(engine.priceIncludesLand, false);
    assert.equal(engine.propertyTaxVerify, true);
    assert.match(engine.propertyTaxNote, /fee-simple sale/i);
  });
});

test('Model C passes the market property-tax rate', () => {
  const engine = land.engineInputs('model_c_full_sale_deed_restriction', params());
  // Hand derivation: fee-simple market-value treatment passes the entered .006 rate unchanged;
  // it has no ground lease, so the monthly ground-rent input is 0.
  assert.equal(engine.propertyTaxTreatment, 'fee_simple_market_value_assessment');
  assert.equal(engine.propertyTaxRate, 0.006);
  assert.equal(engine.groundRentMonthly, 0);
  assert.equal(engine.priceIncludesLand, true);
});

test('restricted-value flag changes Models B and C treatment', () => {
  ['model_b_discounted_lot_covenant', 'model_c_full_sale_deed_restriction'].forEach((id) => {
    const market = land.engineInputs(id, params({ restrictedValueAssessment: false }));
    const restricted = land.engineInputs(id, params({ restrictedValueAssessment: true }));
    assert.equal(market.propertyTaxTreatment, 'fee_simple_market_value_assessment');
    assert.equal(restricted.propertyTaxTreatment, 'restricted_value_assessment_verify');
    assert(restricted.propertyTaxRate <= market.propertyTaxRate);
    assert.equal(restricted.propertyTaxVerify, true);
  });
});

test('compare preserves dataset order and has no merit-order fields', () => {
  const rows = land.compare(params());
  assert.deepEqual(rows.map((row) => row.modelId), dataset.models.map((model) => model.id));
  assert.equal(containsKey(rows, /^(score|rank)$/i), false);
  assert.equal(containsKey(dataset, /^(score|rank)$/i), false);
});

test('new production files contain no restricted decision or market language', () => {
  const files = [
    'js/project-market-study/resale-waterfall.js',
    'js/project-market-study/land-disposition.js',
    'data/policy/land-disposition-models.json',
  ];
  const restricted = /forecast|will appreciate|projected|capture rate|absorption|sellout|time-phasing|recommended|best model|preferred model/i;
  files.forEach((file) => assert.equal(restricted.test(fs.readFileSync(path.join(ROOT, file), 'utf8')), false, file));
});

test('ground rent raises lifecycle monthly housing cost', () => {
  const engine = land.engineInputs('model_a_public_land_retention', params({
    groundRentMonthly: 0,
    groundRentEscalationRate: 0,
  }));
  const withoutRent = lifecycle.project(lifecycleInput(engine, 0)).results[5];
  const withRent = lifecycle.project(lifecycleInput(engine, 200)).results[5];
  // Hand derivation: with zero escalation, adding $200 monthly ground rent adds exactly $200.
  assert.equal(withRent.monthlyHousingCost - withoutRent.monthlyHousingCost, 200);
});

test('retained-land improvements basis lowers lifecycle property-tax cost', () => {
  const retained = land.engineInputs('model_a_public_land_retention', params({ groundRentMonthly: 0 }));
  const feeSimple = land.engineInputs('model_c_full_sale_deed_restriction', params({ groundRentMonthly: 0 }));
  const retainedResult = lifecycle.project(lifecycleInput(retained, 0)).results[5];
  const feeResult = lifecycle.project(lifecycleInput(feeSimple, 0)).results[5];
  // Hand derivation at year 5: market value = 400,000×1.03^5 = 463,709.63.
  // Rate difference = .006−.0045 = .0015; monthly difference = 463,709.63×.0015/12
  // = 57.96, which produces a $58 rounded-cost difference.
  assert.equal(feeResult.monthlyHousingCost - retainedResult.monthlyHousingCost, 58);
});

test('package wiring exposes both suites in the required order', () => {
  const pkg = require(path.join(ROOT, 'package.json'));
  assert.equal(pkg.scripts['test:resale-waterfall'], 'node test/resale-waterfall.test.js');
  assert.equal(pkg.scripts['test:land-disposition'], 'node test/land-disposition.test.js');
  const ci = pkg.scripts['test:ci'];
  assert(ci.indexOf('test:shared-equity-lifecycle') < ci.indexOf('test:resale-waterfall'));
  assert(ci.indexOf('test:resale-waterfall') < ci.indexOf('test:land-disposition'));
  assert(ci.indexOf('test:land-disposition') < ci.indexOf('test:ownership-resale'));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
