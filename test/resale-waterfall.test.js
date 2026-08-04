'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const waterfall = require(path.join(ROOT, 'js/project-market-study/resale-waterfall.js'));
const lifecycle = require(path.join(ROOT, 'js/project-market-study/shared-equity-lifecycle.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✅ ' + name); }
  catch (err) { failed += 1; console.error('  ❌ ' + name); console.error('     ' + err.message); }
}

function yearResult(overrides) {
  return Object.assign({
    year: 10,
    appraisalConstrainedPrice: 520000,
    remainingFirstMortgagePrincipal: 206667,
    subordinateBalances: [{ label: 'Public deferred assistance', balance: 50000, publicSource: true }],
    unrestrictedMarketValue: 600000,
    capitalImprovementCredit: 5000,
    nextBuyerMaxAffordablePrice: 480000,
    negativeEquity: false,
    scenarioLabel: 'base scenario',
  }, overrides || {});
}

function config(overrides) {
  return Object.assign({
    sellingCostRate: 0.06,
    returnOwnerDownPayment: true,
    ownerDownPayment: 40000,
    originalRestrictedPrice: 400000,
    publicAppreciationShare: 0.25,
    subsidyRecovery: { countSubordinatePublicSources: true, countAppreciationShare: true },
    publicSubsidyAtClosing: 100000,
    nextBuyerPricing: 'formula',
    totalOwnerCashInvested: 50000,
  }, overrides || {});
}

function reconcile(result) {
  assert.equal(
    result.sellingCosts + result.firstMortgagePayoff + result.ownerDownPaymentReturned +
      result.improvementCreditPaid + result.subordinatePaid + result.publicAppreciationSharePaid +
      result.ownerResidual,
    result.resalePrice
  );
  assert.equal(result.totalDistributions, result.resalePrice);
  assert.equal(result.publicSubsidyRetainedInHome + result.publicSubsidyRecapturedAtSale,
    result.publicSubsidyAtClosing);
}

console.log('\nResale waterfall (Phase 2b)');
console.log('='.repeat(52));

test('worked year-10 reference reconciles to the dollar', () => {
  // Hand derivation:
  // Pool 520,000 − selling (520,000×.06=31,200) = 488,800.
  // 488,800 − first mortgage 206,667 = 282,133.
  // 282,133 − returned down payment 40,000 = 242,133.
  // 242,133 − improvement credit 5,000 = 237,133.
  // 237,133 − public subordinate 50,000 = 187,133.
  // Appreciation share = .25×(520,000−400,000) = 30,000; pool = 157,133.
  // Owner net = 40,000+5,000+157,133 = 202,133.
  // Public recovery = 50,000+30,000 = 80,000; retained = 100,000−80,000 = 20,000.
  // Distribution check: 31,200+206,667+40,000+5,000+50,000+30,000+157,133 = 520,000.
  const result = waterfall.settle(yearResult(), config());
  assert.equal(result.sellingCosts, 31200);
  assert.equal(result.firstMortgagePayoff, 206667);
  assert.equal(result.ownerDownPaymentReturned, 40000);
  assert.equal(result.improvementCreditPaid, 5000);
  assert.equal(result.subordinatePaid, 50000);
  assert.equal(result.publicAppreciationSharePaid, 30000);
  assert.equal(result.ownerResidual, 157133);
  assert.equal(result.ownerNetProceeds, 202133);
  assert.equal(result.publicRecovery, 80000);
  assert.equal(result.publicSubsidyRecapturedAtSale, 80000);
  assert.equal(result.publicSubsidyRetainedInHome, 20000);
  assert.equal(result.publicAppreciationGain, 0);
  reconcile(result);
});

test('closing snapshot pins lien order, combined LTV, cash, and monthly cost', () => {
  // Hand derivation: combined LTV = (300,000+50,000)/400,000 = .875.
  // At 0%, first payment = 300,000/360 = 833.333; subordinate = 50,000/120 = 416.667.
  // Carrying = 100+50+200+100+0 = 450; total = 1,700 rounded.
  const result = waterfall.closingSnapshot({
    restrictedPrice: 400000,
    downPayment: 50000,
    firstMortgage: { principal: 300000, rateAnnual: 0, termYears: 30 },
    subordinateDebt: [{ label: 'Second', principal: 50000, interestRate: 0, structure: 'amortizing', termYears: 10, publicSource: true, repaymentTrigger: 'sale' }],
    publicSubsidyAtClosing: 50000,
    monthlyCarrying: { hoaMonthly: 100, groundRentMonthly: 50, taxMonthly: 200, insuranceMonthly: 100, pmiMonthly: 0 },
  });
  assert.equal(result.combinedLtv, 0.875);
  assert.equal(result.buyerCashAtClosing, 50000);
  assert.equal(result.recurringMonthlyCost, 1700);
  assert.deepEqual(result.lienPriority.map((item) => item.label), ['First mortgage', 'Second']);
});

test('shortfall is explicit and later steps receive zero', () => {
  // Hand derivation: pool 100,000 − selling 6,000 = 94,000.
  // First mortgage owed 120,000 receives 94,000, shortfall 26,000; all later payments are 0.
  // Subsidy 50,000 has no recovery, so retained is 50,000 and recaptured is 0.
  const result = waterfall.settle(yearResult({
    appraisalConstrainedPrice: 100000,
    remainingFirstMortgagePrincipal: 120000,
    unrestrictedMarketValue: 90000,
    subordinateBalances: [{ label: 'Public second', balance: 50000, publicSource: true }],
    capitalImprovementCredit: 5000,
  }), config({ publicSubsidyAtClosing: 50000 }));
  const first = result.steps.find((step) => step.key === 'first_mortgage');
  const subordinate = result.steps.find((step) => step.key === 'subordinate_debt');
  assert.equal(first.paid, 94000);
  assert.equal(first.shortfall, 26000);
  assert.equal(subordinate.paid, 0);
  assert.equal(subordinate.shortfall, 50000);
  assert.equal(result.ownerResidual, 0);
  assert.equal(result.proceedsShortfall, true);
  assert.equal(result.publicSubsidyRetainedInHome, 50000);
  assert.equal(result.publicSubsidyRecapturedAtSale, 0);
  reconcile(result);
});

test('loanExceedsValue is separate from lifecycle negative-equity framing', () => {
  const result = waterfall.settle(yearResult({
    appraisalConstrainedPrice: 150000, remainingFirstMortgagePrincipal: 140000,
    unrestrictedMarketValue: 130000, negativeEquity: false, subordinateBalances: [], capitalImprovementCredit: 0,
  }), config({ returnOwnerDownPayment: false, publicAppreciationShare: 0, publicSubsidyAtClosing: 0 }));
  assert.equal(result.loanExceedsValue, true);
});

test('transparency warning fires only with full recovery and a share', () => {
  // Hand derivation: pool 200,000; fixed selling cost 0; public subordinate receives 100,000;
  // public share is owed .5×(200,000−100,000)=50,000 and receives 50,000; residual is 50,000.
  // Recovery 150,000 recaptures the full 100,000 subsidy; owner net 50,000 < cash-in 80,000.
  const baseYear = yearResult({ appraisalConstrainedPrice: 200000, remainingFirstMortgagePrincipal: 0,
    subordinateBalances: [{ label: 'Public second', balance: 100000, publicSource: true }], capitalImprovementCredit: 0 });
  const both = waterfall.settle(baseYear, config({ sellingCosts: 0, sellingCostRate: undefined,
    returnOwnerDownPayment: false, ownerDownPayment: 0, originalRestrictedPrice: 100000,
    publicAppreciationShare: 0.5, totalOwnerCashInvested: 80000 }));
  const recoveryOnly = waterfall.settle(baseYear, config({ sellingCosts: 0, sellingCostRate: undefined,
    returnOwnerDownPayment: false, ownerDownPayment: 0, publicAppreciationShare: 0, totalOwnerCashInvested: 80000 }));
  const shareOnly = waterfall.settle(baseYear, config({ sellingCosts: 0, sellingCostRate: undefined,
    returnOwnerDownPayment: false, ownerDownPayment: 0, publicAppreciationShare: 0.5,
    subsidyRecovery: { countSubordinatePublicSources: false, countAppreciationShare: true },
    publicSubsidyAtClosing: 100000, totalOwnerCashInvested: 80000 }));
  assert.equal(both.publicSubsidyRecapturedAtSale, 100000);
  assert.equal(both.ownerNetProceeds, 50000);
  assert.equal(both.ownerNetTransparencyWarning, true);
  assert.equal(recoveryOnly.ownerNetTransparencyWarning, false);
  assert.equal(shareOnly.ownerNetTransparencyWarning, false);
  const omittedShareStep = waterfall.settle(baseYear, config({ sellingCosts: 0, sellingCostRate: undefined,
    returnOwnerDownPayment: false, ownerDownPayment: 0, publicAppreciationShare: 0.5,
    order: ['selling_costs', 'subordinate_debt'], totalOwnerCashInvested: 80000 }));
  assert.equal(omittedShareStep.ownerNetTransparencyWarning, false);
});

test('reordering changes which recipient absorbs a limited-pool shortfall', () => {
  // Hand derivation with pool 100,000 and no selling cost: default pays first mortgage 80,000,
  // then subordinate receives 20,000 of 50,000. Reordered pays subordinate 50,000 first,
  // leaving 50,000 for the first mortgage and a 30,000 first-mortgage shortfall.
  const y = yearResult({ appraisalConstrainedPrice: 100000, remainingFirstMortgagePrincipal: 80000,
    subordinateBalances: [{ label: 'Second', balance: 50000, publicSource: true }], capitalImprovementCredit: 0 });
  const common = { sellingCosts: 0, sellingCostRate: undefined, returnOwnerDownPayment: false,
    publicAppreciationShare: 0, publicSubsidyAtClosing: 50000 };
  const normal = waterfall.settle(y, config(common));
  const reordered = waterfall.settle(y, config(Object.assign({}, common, {
    order: ['selling_costs', 'subordinate_debt', 'first_mortgage'],
  })));
  assert.equal(normal.subordinatePaid, 20000);
  assert.equal(reordered.subordinatePaid, 50000);
  assert.equal(reordered.firstMortgagePayoff, 50000);
  reconcile(normal);
  reconcile(reordered);
});

test('duplicate step key throws', () => {
  assert.throws(() => waterfall.settle(yearResult(), config({ order: ['selling_costs', 'selling_costs'] })), /duplicate/);
});

test('returnOwnerDownPayment false removes the distribution step', () => {
  const result = waterfall.settle(yearResult(), config({ returnOwnerDownPayment: false }));
  assert.equal(result.steps.some((step) => step.key === 'owner_down_payment_return'), false);
  assert.equal(result.ownerDownPaymentReturned, 0);
});

test('AMI-anchored next-buyer price needs no additional subsidy', () => {
  const result = waterfall.settle(yearResult(), config({ nextBuyerPricing: 'ami_anchored' }));
  assert.equal(result.nextBuyerRestrictedPrice, 480000);
  assert.equal(result.additionalSubsidyRequiredForNextBuyer, 0);
});

test('reconciliation holds across 24 deterministic adversarial cases', () => {
  const prices = [0, 25000, 70000, 125000, 240000, 500000];
  const firsts = [0, 50000, 150000, 400000];
  prices.forEach((price, i) => firsts.forEach((first, j) => {
    const result = waterfall.settle(yearResult({
      appraisalConstrainedPrice: price,
      remainingFirstMortgagePrincipal: first,
      unrestrictedMarketValue: Math.max(0, price - (i % 2) * 10000),
      subordinateBalances: [{ label: 'Public', balance: (i + j) * 11000, publicSource: true }],
      capitalImprovementCredit: i * 777,
      nextBuyerMaxAffordablePrice: Math.max(0, price - 15000),
    }), config({
      ownerDownPayment: j * 9000,
      originalRestrictedPrice: 100000,
      publicAppreciationShare: [0, 0.25, 0.5, 1][j],
      publicSubsidyAtClosing: i * 19000,
      totalOwnerCashInvested: j * 9000 + i * 1000,
    }));
    reconcile(result);
  }));
});

test('settle consumes a real lifecycle year result', () => {
  const projected = lifecycle.project({
    unrestrictedValue: 500000, restrictedPrice: 400000, downPayment: 40000,
    subordinateDebt: [{ label: 'Deferred', principal: 50000, interestRate: 0, structure: 'deferred' }],
    firstMortgage: { rateAnnual: 0, termYears: 30 }, hoaMonthly: 0, hoaEscalationRate: 0,
    groundRentMonthly: 0, groundRentEscalationRate: 0, propertyTaxRate: 0.006,
    insuranceRate: 0.003, pmiRate: 0, formula: { type: 'fixed_simple', annualRate: 0.03, appraisalCap: false },
    scenario: { label: 'integration scenario', marketGrowth: 0.03, amiGrowth: 0.03, cpiGrowth: 0.02 },
    ami4Person: 100000, amiPct: 0.8, householdSize: 4, sellingCostRate: 0.06,
    capitalImprovements: [], publicSubsidyAtClosing: 50000, horizons: [10],
  });
  const result = waterfall.settle(projected.results[10], config({ publicSubsidyAtClosing: 50000 }));
  assert.equal(result.resalePrice, projected.results[10].appraisalConstrainedPrice);
  assert.equal(result.firstMortgagePayoff, projected.results[10].remainingFirstMortgagePrincipal);
  reconcile(result);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
