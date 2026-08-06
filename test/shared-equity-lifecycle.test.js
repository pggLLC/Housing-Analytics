'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lifecycle = require(path.join(ROOT, 'js/project-market-study/shared-equity-lifecycle.js'));
const finance = require(path.join(ROOT, 'js/hna/ownership-finance.js'));
const waterfall = require(path.join(ROOT, 'js/project-market-study/resale-waterfall.js'));
const conventions = require(path.join(ROOT, 'data/policy/resale-conventions.json'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed += 1;
    console.error('  ❌ ' + name);
    console.error('     ' + err.message);
  }
}

function input(overrides) {
  const base = {
    unrestrictedValue: 500000,
    restrictedPrice: 400000,
    downPayment: 40000,
    subordinateDebt: [],
    firstMortgage: { rateAnnual: 0.06, termYears: 30 },
    hoaMonthly: 175,
    hoaEscalationRate: 0.03,
    groundRentMonthly: 0,
    groundRentEscalationRate: 0,
    propertyTaxRate: 0.0065,
    insuranceRate: 0.0035,
    pmiRate: 0.005,
    formula: { type: 'fixed_simple', annualRate: 0.03, appraisalCap: false },
    scenario: { label: 'base market', marketGrowth: 0.03, amiGrowth: 0.03, cpiGrowth: 0.025 },
    ami4Person: 100000,
    amiPct: 0.80,
    householdSize: 4,
    sellingCostRate: 0.06,
    capitalImprovements: [],
    publicSubsidyAtClosing: 100000,
    horizons: [5, 10, 20, 30],
  };
  return Object.assign(base, overrides || {});
}

function year(result, horizon) {
  return result.results[horizon];
}

function assertNoNonFiniteOrUndefined(value, trail) {
  trail = trail || 'root';
  if (value === undefined) assert.fail(trail + ' is undefined');
  if (typeof value === 'number') assert(Number.isFinite(value), trail + ' is non-finite');
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach((key) => assertNoNonFiniteOrUndefined(value[key], trail + '.' + key));
}

console.log('\nShared-equity lifecycle engine (Phase 2a)');
console.log('='.repeat(58));

// ---- Formula correctness: hand-derived pinned values ----

test('fixed_simple: $400,000 at 3% simple for 10 years = $520,000', () => {
  // Hand derivation: 400,000 × (1 + 0.03 × 10)
  //                = 400,000 × 1.30 = 520,000.
  const result = lifecycle.project(input({ horizons: [10] }));
  assert.equal(year(result, 10).formulaResalePrice, 520000);
});

test('fixed_compound: $400,000 at 3% annually for 10 years = $537,567 rounded', () => {
  // Hand derivation: 400,000 × 1.03^10
  //                = 400,000 × 1.3439163793
  //                = 537,566.5517 → Math.round = 537,567.
  const result = lifecycle.project(input({
    formula: { type: 'fixed_compound', annualRate: 0.03, appraisalCap: false },
    horizons: [10],
  }));
  assert.equal(year(result, 10).formulaResalePrice, 537567);
});

test('ami_indexed: $400,000 with 2% annual AMI growth for 10 years = $487,598', () => {
  // Hand derivation: AMI ratio = (100,000 × 1.02^10) / 100,000 = 1.2189944199.
  //                 400,000 × 1.2189944199 = 487,597.7680 → 487,598.
  const result = lifecycle.project(input({
    formula: { type: 'ami_indexed', appraisalCap: false },
    scenario: { label: 'AMI case', marketGrowth: 0.03, amiGrowth: 0.02, cpiGrowth: 0.025 },
    horizons: [10],
  }));
  assert.equal(year(result, 10).formulaResalePrice, 487598);
});

test('cpi_indexed: $400,000 with 2.5% annual CPI growth for 10 years = $512,034', () => {
  // Hand derivation: 400,000 × 1.025^10
  //                = 400,000 × 1.2800845442
  //                = 512,033.8177 → 512,034.
  const result = lifecycle.project(input({
    formula: { type: 'cpi_indexed', appraisalCap: false },
    horizons: [10],
  }));
  assert.equal(year(result, 10).formulaResalePrice, 512034);
});

test('lesser_of: fixed/CPI/AMI legs select the $487,598 AMI leg', () => {
  // Hand derivation at year 10:
  // fixed = 400,000 × (1 + .03 × 10) = 520,000;
  // CPI   = 400,000 × 1.025^10       = 512,034 rounded;
  // AMI   = 400,000 × 1.02^10        = 487,598 rounded;
  // minimum = 487,598.
  const result = lifecycle.project(input({
    formula: { type: 'lesser_of', annualRate: 0.03, legs: ['fixed', 'cpi', 'ami'], appraisalCap: false },
    scenario: { label: 'lesser case', marketGrowth: 0.04, amiGrowth: 0.02, cpiGrowth: 0.025 },
    horizons: [10],
  }));
  assert.equal(year(result, 10).formulaResalePrice, 487598);
});

test('shared_appreciation: 25% owner share produces $467,990 at year 10', () => {
  // Hand derivation:
  // market value = 500,000 × 1.03^10 = 671,958.1897;
  // appreciation over restricted price = 671,958.1897 − 400,000 = 271,958.1897;
  // owner share = .25 × 271,958.1897 = 67,989.5474;
  // resale price = 400,000 + 67,989.5474 = 467,989.5474 → 467,990.
  const result = lifecycle.project(input({
    formula: { type: 'shared_appreciation', appreciationShare: 0.25, appraisalCap: false },
    horizons: [10],
  }));
  assert.equal(year(result, 10).formulaResalePrice, 467990);
});

// ---- Amortization ----

test('remaining first-mortgage principal matches closed-form month-60/120/360 balances', () => {
  // Principal = 400,000 − 100,000 down = 300,000.
  // Monthly payment = 300,000 × (.06/12) × 1.005^360 / (1.005^360 − 1)
  //                 = 1,798.651575.
  // B_k = 300,000×1.005^k − 1,798.651575×(1.005^k−1)/.005.
  // k=60 → 279,163.0705 → 279,163; k=120 → 251,057.1749 → 251,057;
  // k=360 is the contractual payoff point → 0.
  const result = lifecycle.project(input({
    downPayment: 100000,
    hoaMonthly: 0,
    firstMortgage: { rateAnnual: 0.06, termYears: 30 },
    horizons: [5, 10, 30],
  }));
  assert.equal(result.firstMortgagePrincipal, 300000);
  assert.equal(year(result, 5).remainingFirstMortgagePrincipal, 279163);
  assert.equal(year(result, 10).remainingFirstMortgagePrincipal, 251057);
  assert.equal(year(result, 30).remainingFirstMortgagePrincipal, 0);
});

// ---- Lesser-of and appraisal constraints ----

test('each lesser_of leg can bind', () => {
  const fixed = lifecycle.project(input({
    formula: { type: 'lesser_of', annualRate: 0.01, legs: ['fixed', 'cpi'], appraisalCap: false },
    scenario: { label: 'fixed binding', marketGrowth: 0.06, amiGrowth: 0.05, cpiGrowth: 0.03 }, horizons: [10],
  }));
  assert.equal(year(fixed, 10).formulaResalePrice, 440000);

  const cpi = lifecycle.project(input({
    formula: { type: 'lesser_of', annualRate: 0.06, legs: ['fixed', 'cpi'], appraisalCap: false },
    scenario: { label: 'CPI binding', marketGrowth: 0.06, amiGrowth: 0.05, cpiGrowth: 0.01 }, horizons: [10],
  }));
  assert.equal(year(cpi, 10).formulaResalePrice, 441849);

  const ami = lifecycle.project(input({
    formula: { type: 'lesser_of', annualRate: 0.06, legs: ['fixed', 'cpi', 'ami'], appraisalCap: false },
    scenario: { label: 'AMI binding', marketGrowth: 0.06, amiGrowth: 0.005, cpiGrowth: 0.04 }, horizons: [10],
  }));
  assert.equal(year(ami, 10).formulaResalePrice, 420456);

  const appraisal = lifecycle.project(input({
    formula: { type: 'lesser_of', annualRate: 0.03, legs: ['fixed', 'cpi', 'ami', 'appraisal'], appraisalCap: false },
    scenario: { label: 'appraisal binding', marketGrowth: -0.02, amiGrowth: 0.03, cpiGrowth: 0.025 }, horizons: [10],
  }));
  assert.equal(year(appraisal, 10).formulaResalePrice, year(appraisal, 10).unrestrictedMarketValue);
});

test('appraisal cap binds under a declining market and reports the flag', () => {
  // Hand derivation: market = 400,000 × .98^5 = 361,568.3187 → 361,568,
  // while the fixed-simple formula = 400,000 × 1.15 = 460,000.
  const result = lifecycle.project(input({
    unrestrictedValue: 400000,
    formula: { type: 'fixed_simple', annualRate: 0.03, appraisalCap: true },
    scenario: lifecycle.SCENARIOS.declining,
    horizons: [5],
  }));
  assert.equal(year(result, 5).formulaResalePrice, 460000);
  assert.equal(year(result, 5).appraisalConstrainedPrice, 361568);
  assert.equal(year(result, 5).appraisalBinding, true);
});

// ---- Owner outcome ----

test('owner net-proceeds waterfall matches hand arithmetic', () => {
  // Closing: 400,000 price − 40,000 down − 50,000 subordinate = 310,000 first mortgage.
  // At 0% after 10 of 30 years: first balance = 310,000 × (20/30) = 206,666.6667.
  // Resale = 520,000; selling costs = 5% × 520,000 = 26,000.
  // Gross equity = 520,000 − 206,666.6667 − 26,000 = 287,333.3333.
  // Net = gross − 50,000 subordinate + (10,000 × 50% credit) = 242,333.3333 → 242,333.
  const result = lifecycle.project(input({
    downPayment: 40000,
    subordinateDebt: [{ label: 'Deferred assistance', principal: 50000, interestRate: 0, structure: 'deferred' }],
    firstMortgage: { rateAnnual: 0, termYears: 30 },
    sellingCostRate: 0.05,
    capitalImprovements: [{ year: 4, amount: 10000, creditShare: 0.5 }],
    horizons: [10],
  }));
  const out = year(result, 10);
  assert.equal(result.firstMortgagePrincipal, 310000);
  assert.equal(out.remainingFirstMortgagePrincipal, 206667);
  assert.equal(out.sellingCosts, 26000);
  assert.equal(out.ownerGrossEquity, 287333);
  assert.equal(out.subordinatePayoff, 50000);
  assert.equal(out.capitalImprovementCredit, 5000);
  assert.equal(out.ownerNetProceeds, 242333);
});

test('forgivable subordinate debt is $0 owed at its term', () => {
  const result = lifecycle.project(input({
    subordinateDebt: [{ label: 'Forgivable assistance', principal: 60000, interestRate: 0, structure: 'forgivable', termYears: 10 }],
    horizons: [5, 10],
  }));
  assert.equal(year(result, 5).subordinateBalances[0].balance, 30000);
  assert.equal(year(result, 10).subordinateBalances[0].balance, 0);
});

test('public-source flag survives normalization into the year result', () => {
  const result = lifecycle.project(input({
    subordinateDebt: [{
      label: 'Public deferred assistance', principal: 50000, interestRate: 0,
      structure: 'deferred', publicSource: true,
    }],
    horizons: [10],
  }));
  assert.strictEqual(year(result, 10).subordinateBalances[0].publicSource, true);
});

test('settle on real lifecycle output pins $20,000 retained and $80,000 recaptured', () => {
  const result = lifecycle.project(input({
    subordinateDebt: [{
      label: 'Public deferred assistance', principal: 50000, interestRate: 0,
      structure: 'deferred', publicSource: true,
    }],
    horizons: [10],
  }));
  const settlement = waterfall.settle(year(result, 10), {
    sellingCostRate: 0.06,
    returnOwnerDownPayment: true,
    ownerDownPayment: 40000,
    originalRestrictedPrice: 400000,
    publicAppreciationShare: 0.25,
    subsidyRecovery: { countSubordinatePublicSources: true, countAppreciationShare: true },
    publicSubsidyAtClosing: 100000,
    nextBuyerPricing: 'formula',
    totalOwnerCashInvested: 50000,
  });
  // Public recovery = $50,000 subordinate payoff + 25% × ($520,000 − $400,000)
  //                 = $50,000 + $30,000 = $80,000; retained = $100,000 − $80,000.
  assert.equal(settlement.publicSubsidyRetainedInHome, 20000);
  assert.equal(settlement.publicSubsidyRecapturedAtSale, 80000);
});

test('declining case flags negative equity and reports null owner return when proceeds are nonpositive', () => {
  const result = lifecycle.project(input({
    unrestrictedValue: 400000,
    downPayment: 0,
    firstMortgage: { rateAnnual: 0.065, termYears: 30 },
    formula: { type: 'fixed_simple', annualRate: 0.03, appraisalCap: true },
    scenario: lifecycle.SCENARIOS.declining,
    sellingCostRate: 0.08,
    horizons: [5],
  }));
  const out = year(result, 5);
  assert.equal(out.negativeEquity, true);
  assert(out.ownerNetProceeds <= 0);
  assert.equal(out.effectiveAnnualOwnerReturn, null);
  assert(/nonpositive/i.test(out.effectiveAnnualOwnerReturnNote));
});

// ---- Future buyer ----

function capacityInput(formula, scenario, horizons) {
  const price = finance.maxAffordablePrice(100000, 0.80);
  return input({
    unrestrictedValue: price,
    restrictedPrice: price,
    downPayment: price * 0.10,
    firstMortgage: { rateAnnual: 0.065, termYears: 30 },
    hoaMonthly: 0,
    hoaEscalationRate: 0,
    propertyTaxRate: 0.0065,
    insuranceRate: 0.0035,
    pmiRate: 0.005,
    sellingCostRate: 0,
    publicSubsidyAtClosing: 0,
    formula: formula,
    scenario: scenario,
    horizons: horizons || [5, 10, 20, 30],
  });
}

test('AMI-indexed price with equal AMI/market growth keeps affordability status stable', () => {
  const result = lifecycle.project(capacityInput(
    { type: 'ami_indexed', appraisalCap: false },
    { label: 'equal growth', marketGrowth: 0.03, amiGrowth: 0.03, cpiGrowth: 0.02 }
  ));
  result.horizons.forEach((horizon) => assert.equal(year(result, horizon).preservesAffordability, true));
});

test('fixed 3% simple path with 6% AMI growth remains affordable', () => {
  const result = lifecycle.project(capacityInput(
    { type: 'fixed_simple', annualRate: 0.03, appraisalCap: false },
    { label: 'faster AMI growth', marketGrowth: 0.06, amiGrowth: 0.06, cpiGrowth: 0.025 }
  ));
  assert.equal(year(result, 30).preservesAffordability, true);
  assert(year(result, 30).futureAffordabilityGap <= 0);
});

test('fixed 3% simple path with 1% AMI growth becomes unaffordable', () => {
  const result = lifecycle.project(capacityInput(
    { type: 'fixed_simple', annualRate: 0.03, appraisalCap: false },
    { label: 'slower AMI growth', marketGrowth: 0.06, amiGrowth: 0.01, cpiGrowth: 0.025 },
    [10, 20, 30]
  ));
  assert.equal(year(result, 10).preservesAffordability, false);
  assert(year(result, 30).additionalSubsidyRequiredForNextBuyer > 0);
});

test('future buyer income matches OwnershipFinance direct calculation', () => {
  const result = lifecycle.project(input({ hoaEscalationRate: 0, horizons: [10] }));
  const out = year(result, 10);
  const direct = finance.incomeNeededForHomeValue(out.appraisalConstrainedPrice, {
    rateAnnual: 0.06,
    termYears: 30,
    downPaymentRate: 0.10,
    propertyTaxRate: 0.0065,
    insuranceRate: 0.0035,
    pmiRate: 0.005,
    pmiLtvGate: true,
    frontEndRatio: 0.30,
    hoaMonthly: 175,
    groundRentMonthly: 0,
    householdSize: 4,
  });
  assert.equal(out.futureBuyerIncomeNeeded, direct);
});

// ---- Matrix, guardrails, integration ----

test('canonical scenario set is exactly five named paths', () => {
  assert.deepEqual(Object.keys(lifecycle.SCENARIOS).sort(), ['base', 'declining', 'flat', 'high', 'low']);
});

test('five scenarios by four horizons contain no NaN or undefined', () => {
  const matrix = lifecycle.runMatrix(input({ horizons: [5, 10, 20, 30] }));
  assert.equal(matrix.scenarios.length, 5);
  matrix.scenarios.forEach((result) => assert.equal(Object.keys(result.results).length, 4));
  assertNoNonFiniteOrUndefined(matrix);
});

test('hostile zero-rate, zero-down, 100%-subordinate matrix is finite', () => {
  const hostile = input({
    unrestrictedValue: 400000,
    downPayment: 0,
    subordinateDebt: [{ label: 'Full subordinate', principal: 400000, interestRate: 0, structure: 'deferred' }],
    firstMortgage: { rateAnnual: 0, termYears: 30 },
    hoaMonthly: 0,
    hoaEscalationRate: 0,
    groundRentMonthly: 0,
    groundRentEscalationRate: 0,
    propertyTaxRate: 0,
    insuranceRate: 0,
    pmiRate: 0,
    formula: { type: 'shared_appreciation', appreciationShare: 0.25, appraisalCap: true },
    sellingCostRate: 0,
    capitalImprovements: [],
    horizons: [5, 10, 20, 30],
  });
  assertNoNonFiniteOrUndefined(lifecycle.runMatrix(hostile));
});

test('every lifecycle result carries modeled classification and scenario label', () => {
  const matrix = lifecycle.runMatrix(input());
  assert.equal(matrix.classification, 'modeled');
  assert(matrix.scenarioLabel);
  matrix.scenarios.forEach((result) => {
    assert.equal(result.classification, 'modeled');
    assert(result.scenarioLabel);
    result.horizons.forEach((horizon) => {
      const out = year(result, horizon);
      assert.equal(out.classification, 'modeled');
      assert(out.scenarioLabel);
      assert(Number.isFinite(out.publicSubsidyOutstanding));
    });
  });
});

test('module source contains no banned language and no ranking claim', () => {
  const source = fs.readFileSync(path.join(ROOT, 'js/project-market-study/shared-equity-lifecycle.js'), 'utf8');
  [
    /fore(?:cast)/i,
    /will\s+appreciate/i,
    /projec(?:ted)/i,
    /capture\s+rate/i,
    /absorption/i,
    /sellout/i,
    /time-phasing/i,
  ].forEach((pattern) => assert(!pattern.test(source), 'source must not contain ' + pattern));
  assert(!/shared equity[^\n]{0,40}\bbetter\b/i.test(source));
});

test('fromConvention integrates all real conventions and preserves VERIFY discipline', () => {
  conventions.conventions.forEach((convention) => {
    const result = lifecycle.fromConvention(conventions, convention.id, input({ horizons: [10] }));
    assert(Number.isFinite(year(result, 10).formulaResalePrice), convention.id);
    assert.equal(result.conventionId, convention.id);
  });
  const apcha = lifecycle.fromConvention(conventions, 'lesser_of_fixed_cpi', input({ horizons: [10] }));
  const elevation = lifecycle.fromConvention(conventions, 'shared_appreciation', input({ horizons: [10] }));
  assert.equal(apcha.verifyParameter, true);
  assert(apcha.parameterCaveat);
  assert.equal(elevation.verifyParameter, true);
  assert(elevation.parameterCaveat);
});

test('public subsidy retention and recapture are reported separately', () => {
  const subsidy = year(lifecycle.project(input({ horizons: [10], publicSubsidyAtClosing: 123456 })), 10);
  assert.equal(subsidy.publicSubsidyOutstanding, 123456);
  assert.equal(subsidy.publicSubsidyRetainedInHome, 123456);
  assert.equal(subsidy.publicSubsidyRecapturedAtSale, 0);
});

test('percent/decimal guard rejects whole-percent rate input', () => {
  assert.throws(() => lifecycle.project(input({
    firstMortgage: { rateAnnual: 6.5, termYears: 30 },
  })), /decimal rate/);
});

test('package.json wires the lifecycle suite after ownership finance and before ownership resale', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.scripts['test:shared-equity-lifecycle']);
  const chain = pkg.scripts['test:ci'];
  // Ordering, not adjacency: later phases legitimately insert their suites
  // (resale-waterfall, land-disposition, Phase-3 datasets) between the
  // lifecycle and ownership-resale. The original exact-adjacency assertion
  // could only be satisfied together with the Phase-2b ordering test by
  // duplicating the trio at the end of test:ci, running three suites twice
  // per CI pass.
  assert(chain.indexOf('test:ownership-finance') !== -1, 'ownership-finance wired');
  assert(chain.indexOf('test:shared-equity-lifecycle') !== -1, 'lifecycle wired');
  assert(chain.indexOf('test:ownership-finance') < chain.indexOf('test:shared-equity-lifecycle'),
    'lifecycle runs after ownership finance');
  assert(chain.indexOf('test:shared-equity-lifecycle') < chain.indexOf('test:ownership-resale'),
    'lifecycle runs before ownership resale');
});

console.log('\nShared-equity lifecycle: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(58));
if (failed > 0) process.exit(1);
