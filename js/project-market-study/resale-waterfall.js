/**
 * Shared-equity closing snapshot and limited-pool resale distribution.
 * Consumes a SharedEquityLifecycle year result without recalculating it.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    if (typeof window !== 'undefined') window.ResaleWaterfall = module.exports;
  } else {
    root.ResaleWaterfall = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var CLASSIFICATION = 'modeled';
  var DEFAULT_ORDER = [
    'selling_costs', 'first_mortgage', 'owner_down_payment_return',
    'improvement_credit', 'subordinate_debt', 'public_appreciation_share',
  ];

  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function nonnegative(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0) throw new Error('ResaleWaterfall: ' + label + ' must be nonnegative');
    return n;
  }

  function positive(value, label) {
    var n = number(value, null);
    if (n == null || n <= 0) throw new Error('ResaleWaterfall: ' + label + ' must be positive');
    return n;
  }

  function decimalRate(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0 || n >= 1) {
      throw new Error('ResaleWaterfall: ' + label + ' must be a decimal rate from 0 through less than 1');
    }
    return n;
  }

  function fraction(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0 || n > 1) throw new Error('ResaleWaterfall: ' + label + ' must be from 0 through 1');
    return n;
  }

  function dollars(value) {
    var n = number(value, null);
    if (n == null) throw new Error('ResaleWaterfall: non-finite dollar result');
    return Math.round(n);
  }

  function monthlyPayment(principal, rateAnnual, termYears) {
    if (!principal) return 0;
    var months = positive(termYears, 'termYears') * 12;
    var rate = decimalRate(rateAnnual, 'rateAnnual', 0) / 12;
    if (!rate) return principal / months;
    var factor = Math.pow(1 + rate, months);
    return principal * rate * factor / (factor - 1);
  }

  function normalizeSubordinates(items) {
    if (items == null) return [];
    if (!Array.isArray(items)) throw new Error('ResaleWaterfall: subordinateDebt must be an array');
    return items.map(function (item, index) {
      item = item || {};
      var structure = String(item.structure || 'deferred');
      if (['deferred', 'amortizing', 'forgivable'].indexOf(structure) === -1) {
        throw new Error('ResaleWaterfall: unsupported subordinate structure at index ' + index);
      }
      return {
        label: String(item.label || 'Subordinate debt ' + (index + 1)),
        principal: nonnegative(item.principal, 'subordinateDebt[' + index + '].principal', 0),
        interestRate: decimalRate(item.interestRate, 'subordinateDebt[' + index + '].interestRate', 0),
        structure: structure,
        termYears: item.termYears == null ? null : positive(item.termYears, 'subordinateDebt[' + index + '].termYears'),
        publicSource: !!item.publicSource,
        repaymentTrigger: String(item.repaymentTrigger || 'sale'),
        classification: 'user_entered',
      };
    });
  }

  function closingSnapshot(input) {
    input = input || {};
    var price = positive(input.restrictedPrice, 'restrictedPrice');
    var down = nonnegative(input.downPayment, 'downPayment', 0);
    var first = input.firstMortgage || {};
    var firstPrincipal = nonnegative(first.principal, 'firstMortgage.principal', 0);
    var firstRate = decimalRate(first.rateAnnual, 'firstMortgage.rateAnnual', 0);
    var firstTerm = positive(first.termYears, 'firstMortgage.termYears');
    var subs = normalizeSubordinates(input.subordinateDebt);
    var carrying = input.monthlyCarrying || {};
    var carryingTotal = ['hoaMonthly', 'groundRentMonthly', 'taxMonthly', 'insuranceMonthly', 'pmiMonthly']
      .reduce(function (sum, key) { return sum + nonnegative(carrying[key], 'monthlyCarrying.' + key, 0); }, 0);
    var subordinatePayments = subs.reduce(function (sum, item) {
      return sum + (item.structure === 'amortizing'
        ? monthlyPayment(item.principal, item.interestRate, positive(item.termYears, item.label + '.termYears')) : 0);
    }, 0);
    var liens = [{
      label: 'First mortgage', principal: dollars(firstPrincipal), publicSource: false,
      repaymentTrigger: 'maturity', classification: CLASSIFICATION,
    }].concat(subs.map(function (item) {
      return {
        label: item.label, principal: dollars(item.principal), publicSource: item.publicSource,
        repaymentTrigger: item.repaymentTrigger, classification: CLASSIFICATION,
      };
    }));
    return {
      lienPriority: liens,
      combinedLtv: Math.round(((firstPrincipal + subs.reduce(function (sum, item) { return sum + item.principal; }, 0)) / price) * 1000000) / 1000000,
      buyerCashAtClosing: dollars(down),
      publicSubsidyAtClosing: dollars(nonnegative(input.publicSubsidyAtClosing, 'publicSubsidyAtClosing', 0)),
      recurringMonthlyCost: dollars(monthlyPayment(firstPrincipal, firstRate, firstTerm) + subordinatePayments + carryingTotal),
      repaymentConditions: liens.map(function (lien) {
        return { label: lien.label, repaymentTrigger: lien.repaymentTrigger, classification: CLASSIFICATION };
      }),
      classification: CLASSIFICATION,
    };
  }

  function validateOrder(order, returnDown) {
    var actual = order == null ? DEFAULT_ORDER.slice() : order.slice();
    if (!Array.isArray(order) && order != null) throw new Error('ResaleWaterfall: order must be an array');
    var allowed = DEFAULT_ORDER.slice();
    var seen = {};
    actual.forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Error('ResaleWaterfall: unsupported order step "' + key + '"');
      if (seen[key]) throw new Error('ResaleWaterfall: duplicate order step "' + key + '"');
      seen[key] = true;
    });
    if (!returnDown) actual = actual.filter(function (key) { return key !== 'owner_down_payment_return'; });
    return actual;
  }

  function settle(yearResult, config) {
    yearResult = yearResult || {};
    config = config || {};
    var scenarioLabel = String(yearResult.scenarioLabel || 'unspecified scenario');
    var resalePrice = dollars(nonnegative(yearResult.appraisalConstrainedPrice, 'appraisalConstrainedPrice', 0));
    var firstOwed = dollars(nonnegative(yearResult.remainingFirstMortgagePrincipal, 'remainingFirstMortgagePrincipal', 0));
    var subordinates = Array.isArray(yearResult.subordinateBalances) ? yearResult.subordinateBalances : [];
    var improvement = dollars(nonnegative(yearResult.capitalImprovementCredit, 'capitalImprovementCredit', 0));
    var down = dollars(nonnegative(config.ownerDownPayment, 'ownerDownPayment', 0));
    var originalPrice = nonnegative(config.originalRestrictedPrice, 'originalRestrictedPrice', 0);
    var shareRate = fraction(config.publicAppreciationShare, 'publicAppreciationShare', 0);
    var subsidy = dollars(nonnegative(config.publicSubsidyAtClosing, 'publicSubsidyAtClosing', 0));
    var ownerCash = dollars(nonnegative(config.totalOwnerCashInvested, 'totalOwnerCashInvested', down));
    var returnDown = !!config.returnOwnerDownPayment;
    var order = validateOrder(config.order, returnDown);
    if (config.sellingCosts != null && config.sellingCostRate != null) {
      throw new Error('ResaleWaterfall: supply sellingCosts or sellingCostRate, not both');
    }
    var sellingOwed = config.sellingCosts != null
      ? dollars(nonnegative(config.sellingCosts, 'sellingCosts', 0))
      : dollars(resalePrice * decimalRate(config.sellingCostRate, 'sellingCostRate', 0.06));
    var appreciationOwed = dollars(Math.max(0, resalePrice - originalPrice) * shareRate);
    var recovery = config.subsidyRecovery || {};
    var pool = resalePrice;
    var steps = [];

    function distribute(key, label, owed, extra) {
      owed = dollars(owed);
      var paid = Math.min(owed, pool);
      pool -= paid;
      var step = Object.assign({
        key: key, label: label, owed: owed, paid: paid, shortfall: owed - paid,
        classification: CLASSIFICATION, scenarioLabel: scenarioLabel,
      }, extra || {});
      steps.push(step);
      return paid;
    }

    var paid = {
      selling_costs: 0, first_mortgage: 0, owner_down_payment_return: 0,
      improvement_credit: 0, subordinate_debt: 0, public_appreciation_share: 0,
    };
    order.forEach(function (key) {
      if (key === 'selling_costs') paid[key] = distribute(key, 'Selling costs', sellingOwed);
      if (key === 'first_mortgage') paid[key] = distribute(key, 'First mortgage', firstOwed);
      if (key === 'owner_down_payment_return') paid[key] = distribute(key, 'Owner down payment return', down);
      if (key === 'improvement_credit') paid[key] = distribute(key, 'Capital improvement credit', improvement);
      if (key === 'subordinate_debt') {
        subordinates.forEach(function (item, index) {
          var amount = dollars(nonnegative(item && item.balance, 'subordinateBalances[' + index + '].balance', 0));
          paid.subordinate_debt += distribute(key, String(item.label || 'Subordinate debt ' + (index + 1)), amount, {
            publicSource: !!item.publicSource,
          });
        });
      }
      if (key === 'public_appreciation_share') paid[key] = distribute(key, 'Public appreciation share', appreciationOwed);
    });

    var ownerResidual = pool;
    var publicRecovery = 0;
    if (recovery.countSubordinatePublicSources) {
      publicRecovery += steps.filter(function (step) { return step.key === 'subordinate_debt' && step.publicSource; })
        .reduce(function (sum, step) { return sum + step.paid; }, 0);
    }
    if (recovery.countAppreciationShare) publicRecovery += paid.public_appreciation_share;
    var recaptured = Math.min(publicRecovery, subsidy);
    var retained = subsidy - recaptured;
    var appreciationGain = Math.max(0, publicRecovery - subsidy);
    var ownerNet = paid.owner_down_payment_return + paid.improvement_credit + ownerResidual;
    var warning = subsidy > 0 && recaptured === subsidy && paid.public_appreciation_share > 0 && ownerNet < ownerCash;
    var pricing = config.nextBuyerPricing || 'formula';
    if (['formula', 'ami_anchored'].indexOf(pricing) === -1) throw new Error('ResaleWaterfall: unsupported nextBuyerPricing');
    var capacity = dollars(nonnegative(yearResult.nextBuyerMaxAffordablePrice, 'nextBuyerMaxAffordablePrice', 0));
    var nextPrice = pricing === 'ami_anchored' ? capacity : resalePrice;
    var totalDistributions = steps.reduce(function (sum, step) { return sum + step.paid; }, 0) + ownerResidual;
    if (totalDistributions !== resalePrice) throw new Error('ResaleWaterfall: distribution reconciliation failed');

    return {
      year: yearResult.year == null ? null : yearResult.year,
      resalePrice: resalePrice,
      steps: steps,
      order: order,
      sellingCosts: paid.selling_costs,
      firstMortgagePayoff: paid.first_mortgage,
      ownerDownPaymentReturned: paid.owner_down_payment_return,
      improvementCreditPaid: paid.improvement_credit,
      subordinatePaid: paid.subordinate_debt,
      publicAppreciationSharePaid: paid.public_appreciation_share,
      ownerResidual: ownerResidual,
      ownerNetProceeds: ownerNet,
      totalOwnerCashInvested: ownerCash,
      totalDistributions: totalDistributions,
      proceedsShortfall: steps.some(function (step) { return step.shortfall > 0; }),
      loanExceedsValue: firstOwed > nonnegative(yearResult.unrestrictedMarketValue, 'unrestrictedMarketValue', resalePrice),
      publicRecovery: publicRecovery,
      publicSubsidyAtClosing: subsidy,
      publicSubsidyRecapturedAtSale: recaptured,
      publicSubsidyRetainedInHome: retained,
      publicAppreciationGain: appreciationGain,
      ownerNetTransparencyWarning: warning,
      ownerNetTransparencyNote: warning
        ? 'The owner receives less cash than the total owner cash invested after full subsidy recovery and a public appreciation share.'
        : null,
      nextBuyerPricing: pricing,
      nextBuyerRestrictedPrice: nextPrice,
      additionalSubsidyRequiredForNextBuyer: Math.max(0, nextPrice - capacity),
      classification: CLASSIFICATION,
      scenarioLabel: scenarioLabel,
    };
  }

  return {
    DEFAULT_ORDER: DEFAULT_ORDER.slice(),
    closingSnapshot: closingSnapshot,
    settle: settle,
  };
}));
