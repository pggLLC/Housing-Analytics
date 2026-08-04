/**
 * Shared-equity lifecycle scenario engine.
 *
 * Pure computation for the Tier-2 project layer. All time-varying values are
 * modeled scenario paths, not predictions. Resale-formula restrictions,
 * public subsidy treatment, subordinate debt, and land/tenure terms remain
 * separate inputs; this module does not bundle them into product rankings.
 *
 * Annual conventions: market, AMI, CPI, HOA, and ground-rent growth compound
 * once per year. Mortgage and amortizing-debt payments compound monthly.
 * Deferred subordinate interest is simple annual interest. Improvement cash
 * flows occur at their stated integer year for the owner-return calculation.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../hna/ownership-finance.js'));
    if (typeof window !== 'undefined') window.SharedEquityLifecycle = module.exports;
  } else {
    root.SharedEquityLifecycle = factory(root.OwnershipFinance);
  }
}(typeof window !== 'undefined' ? window : this, function (OwnershipFinance) {
  'use strict';

  var CLASSIFICATION = 'modeled';
  var DEFAULT_HORIZONS = [5, 10, 20, 30];
  var FORMULA_TYPES = [
    'fixed_simple', 'fixed_compound', 'ami_indexed', 'cpi_indexed',
    'lesser_of', 'shared_appreciation',
  ];
  var LESSER_LEGS = ['fixed', 'cpi', 'ami', 'appraisal'];
  var SUBORDINATE_STRUCTURES = ['deferred', 'amortizing', 'forgivable'];

  function scenario(name, marketGrowth) {
    var label = name + ' market (' + Math.round(marketGrowth * 100) + '%/yr) — scenario, not a prediction';
    return Object.freeze({
      label: label,
      scenarioLabel: label,
      marketGrowth: marketGrowth,
      amiGrowth: marketGrowth,
      cpiGrowth: marketGrowth,
      classification: CLASSIFICATION,
    });
  }

  var SCENARIOS = Object.freeze({
    low: scenario('low', 0.01),
    base: scenario('base', 0.03),
    high: scenario('high', 0.06),
    flat: scenario('flat', 0.00),
    declining: scenario('declining', -0.02),
  });

  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function requiredPositive(value, label) {
    var n = number(value, null);
    if (n == null || n <= 0) throw new Error('SharedEquityLifecycle: ' + label + ' must be a positive number');
    return n;
  }

  function nonnegative(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0) throw new Error('SharedEquityLifecycle: ' + label + ' must be a nonnegative number');
    return n;
  }

  function decimalRate(value, label, fallback, allowNegative) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n >= 1 || (!allowNegative && n < 0) || (allowNegative && n <= -1)) {
      throw new Error('SharedEquityLifecycle: ' + label + ' must be a decimal rate' +
        (allowNegative ? ' greater than -1 and less than 1' : ' from 0 through less than 1'));
    }
    return n;
  }

  function unitFraction(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0 || n > 1) {
      throw new Error('SharedEquityLifecycle: ' + label + ' must be a decimal fraction from 0 through 1');
    }
    return n;
  }

  function roundDollar(value) {
    var n = number(value, null);
    if (n == null) throw new Error('SharedEquityLifecycle: non-finite dollar result');
    return Math.round(n);
  }

  function metadata(scenarioLabel) {
    return { classification: CLASSIFICATION, scenarioLabel: scenarioLabel };
  }

  function normalizeScenario(input) {
    input = input || SCENARIOS.base;
    var label = String(input.scenarioLabel || input.label || 'custom market');
    if (label.toLowerCase().indexOf('scenario') === -1) label += ' — scenario, not a prediction';
    return {
      label: label,
      scenarioLabel: label,
      marketGrowth: decimalRate(input.marketGrowth, 'scenario.marketGrowth', 0.03, true),
      amiGrowth: decimalRate(input.amiGrowth, 'scenario.amiGrowth', 0.03, true),
      cpiGrowth: decimalRate(input.cpiGrowth, 'scenario.cpiGrowth', 0.03, true),
      classification: CLASSIFICATION,
    };
  }

  function normalizeFormula(formula) {
    formula = formula || {};
    if (FORMULA_TYPES.indexOf(formula.type) === -1) {
      throw new Error('SharedEquityLifecycle: unsupported formula.type "' + formula.type + '"');
    }
    var out = {
      type: formula.type,
      appraisalCap: !!formula.appraisalCap,
      classification: CLASSIFICATION,
    };
    if (formula.type === 'fixed_simple' || formula.type === 'fixed_compound') {
      out.annualRate = decimalRate(formula.annualRate, 'formula.annualRate', null, false);
    }
    if (formula.type === 'shared_appreciation') {
      out.appreciationShare = unitFraction(formula.appreciationShare, 'formula.appreciationShare', null);
    }
    if (formula.type === 'lesser_of') {
      if (!Array.isArray(formula.legs) || !formula.legs.length) {
        throw new Error('SharedEquityLifecycle: lesser_of requires at least one leg');
      }
      out.legs = formula.legs.map(function (leg) {
        if (LESSER_LEGS.indexOf(leg) === -1) throw new Error('SharedEquityLifecycle: unsupported lesser_of leg "' + leg + '"');
        return leg;
      });
      if (out.legs.indexOf('fixed') !== -1) {
        out.annualRate = decimalRate(formula.annualRate, 'formula.annualRate', null, false);
      }
    }
    return out;
  }

  function normalizeHorizons(horizons) {
    var values = horizons == null ? DEFAULT_HORIZONS.slice() : horizons;
    if (!Array.isArray(values) || !values.length) throw new Error('SharedEquityLifecycle: horizons must be a non-empty array');
    return values.map(function (value) {
      var year = number(value, null);
      if (year == null || year < 0 || Math.floor(year) !== year) {
        throw new Error('SharedEquityLifecycle: each horizon must be a nonnegative integer');
      }
      return year;
    });
  }

  function normalizeSubordinate(items, scenarioLabel) {
    if (items == null) return [];
    if (!Array.isArray(items)) throw new Error('SharedEquityLifecycle: subordinateDebt must be an array');
    return items.map(function (item, index) {
      item = item || {};
      if (SUBORDINATE_STRUCTURES.indexOf(item.structure) === -1) {
        throw new Error('SharedEquityLifecycle: subordinateDebt[' + index + '] has an unsupported structure');
      }
      var termYears = item.termYears == null ? null : requiredPositive(item.termYears, 'subordinateDebt[' + index + '].termYears');
      if ((item.structure === 'forgivable' || item.structure === 'amortizing') && termYears == null) {
        throw new Error('SharedEquityLifecycle: ' + item.structure + ' subordinate debt requires termYears');
      }
      return {
        label: String(item.label || 'Subordinate debt ' + (index + 1)),
        principal: nonnegative(item.principal, 'subordinateDebt[' + index + '].principal', 0),
        interestRate: decimalRate(item.interestRate, 'subordinateDebt[' + index + '].interestRate', 0, false),
        structure: item.structure,
        termYears: termYears,
        classification: CLASSIFICATION,
        scenarioLabel: scenarioLabel,
      };
    });
  }

  function normalizeImprovements(items, scenarioLabel) {
    if (items == null) return [];
    if (!Array.isArray(items)) throw new Error('SharedEquityLifecycle: capitalImprovements must be an array');
    return items.map(function (item, index) {
      item = item || {};
      var year = nonnegative(item.year, 'capitalImprovements[' + index + '].year', 0);
      if (Math.floor(year) !== year) throw new Error('SharedEquityLifecycle: improvement year must be an integer');
      var creditShare = unitFraction(item.creditShare, 'capitalImprovements[' + index + '].creditShare', 1);
      return {
        year: year,
        amount: nonnegative(item.amount, 'capitalImprovements[' + index + '].amount', 0),
        creditShare: creditShare,
        classification: CLASSIFICATION,
        scenarioLabel: scenarioLabel,
      };
    });
  }

  function normalizeInput(input) {
    if (!input || typeof input !== 'object') throw new Error('SharedEquityLifecycle.project: input object required');
    if (!OwnershipFinance || typeof OwnershipFinance.maxAffordablePrice !== 'function' ||
        typeof OwnershipFinance.incomeNeededForHomeValue !== 'function') {
      throw new Error('SharedEquityLifecycle: OwnershipFinance dependency required');
    }
    var modeledScenario = normalizeScenario(input.scenario);
    var scenarioLabel = modeledScenario.scenarioLabel;
    var restrictedPrice = requiredPositive(input.restrictedPrice, 'restrictedPrice');
    var downPayment = nonnegative(input.downPayment, 'downPayment', 0);
    if (downPayment > restrictedPrice) throw new Error('SharedEquityLifecycle: downPayment cannot exceed restrictedPrice');
    var subordinateDebt = normalizeSubordinate(input.subordinateDebt, scenarioLabel);
    var subordinateAtClosing = subordinateDebt.reduce(function (sum, item) { return sum + item.principal; }, 0);
    var firstMortgagePrincipal = restrictedPrice - downPayment - subordinateAtClosing;
    if (firstMortgagePrincipal < -0.005) {
      throw new Error('SharedEquityLifecycle: closing sources exceed restrictedPrice');
    }
    return {
      unrestrictedValue: requiredPositive(input.unrestrictedValue, 'unrestrictedValue'),
      restrictedPrice: restrictedPrice,
      downPayment: downPayment,
      subordinateDebt: subordinateDebt,
      subordinateAtClosing: subordinateAtClosing,
      firstMortgagePrincipal: Math.max(0, firstMortgagePrincipal),
      firstMortgage: {
        rateAnnual: decimalRate(input.firstMortgage && input.firstMortgage.rateAnnual,
          'firstMortgage.rateAnnual', 0, false),
        termYears: requiredPositive(input.firstMortgage && input.firstMortgage.termYears,
          'firstMortgage.termYears'),
        classification: CLASSIFICATION,
        scenarioLabel: scenarioLabel,
      },
      hoaMonthly: nonnegative(input.hoaMonthly, 'hoaMonthly', 0),
      hoaEscalationRate: decimalRate(input.hoaEscalationRate, 'hoaEscalationRate', 0, true),
      groundRentMonthly: nonnegative(input.groundRentMonthly, 'groundRentMonthly', 0),
      groundRentEscalationRate: decimalRate(input.groundRentEscalationRate, 'groundRentEscalationRate', 0, true),
      propertyTaxRate: decimalRate(input.propertyTaxRate, 'propertyTaxRate', 0, false),
      insuranceRate: decimalRate(input.insuranceRate, 'insuranceRate', 0, false),
      pmiRate: decimalRate(input.pmiRate, 'pmiRate', 0, false),
      formula: normalizeFormula(input.formula),
      scenario: modeledScenario,
      ami4Person: requiredPositive(input.ami4Person, 'ami4Person'),
      amiPct: requiredPositive(input.amiPct, 'amiPct'),
      householdSize: input.householdSize == null ? 4 : requiredPositive(input.householdSize, 'householdSize'),
      sellingCostRate: decimalRate(input.sellingCostRate, 'sellingCostRate', 0, false),
      capitalImprovements: normalizeImprovements(input.capitalImprovements, scenarioLabel),
      publicSubsidyAtClosing: nonnegative(input.publicSubsidyAtClosing, 'publicSubsidyAtClosing', 0),
      horizons: normalizeHorizons(input.horizons),
      classification: CLASSIFICATION,
      scenarioLabel: scenarioLabel,
    };
  }

  function compound(value, rate, years) {
    return value * Math.pow(1 + rate, years);
  }

  function monthlyPayment(principal, annualRate, termYears) {
    if (!(principal > 0)) return 0;
    var months = termYears * 12;
    var monthlyRate = annualRate / 12;
    if (!monthlyRate) return principal / months;
    return principal * monthlyRate * Math.pow(1 + monthlyRate, months) /
      (Math.pow(1 + monthlyRate, months) - 1);
  }

  function remainingPrincipal(principal, annualRate, termYears, yearsElapsed) {
    if (!(principal > 0)) return 0;
    var totalMonths = termYears * 12;
    var elapsedMonths = Math.min(yearsElapsed * 12, totalMonths);
    if (elapsedMonths >= totalMonths) return 0;
    var payment = monthlyPayment(principal, annualRate, termYears);
    var monthlyRate = annualRate / 12;
    if (!monthlyRate) return Math.max(0, principal - payment * elapsedMonths);
    return Math.max(0, principal * Math.pow(1 + monthlyRate, elapsedMonths) -
      payment * (Math.pow(1 + monthlyRate, elapsedMonths) - 1) / monthlyRate);
  }

  function formulaValues(input, years, marketValue) {
    var formula = input.formula;
    var base = input.restrictedPrice;
    var values = {};
    values.fixed = base * (1 + (formula.annualRate || 0) * years);
    values.cpi = compound(base, input.scenario.cpiGrowth, years);
    values.ami = compound(base, input.scenario.amiGrowth, years);
    values.appraisal = marketValue;
    if (formula.type === 'fixed_simple') return { price: values.fixed, legs: values };
    if (formula.type === 'fixed_compound') {
      values.fixed = compound(base, formula.annualRate, years);
      return { price: values.fixed, legs: values };
    }
    if (formula.type === 'ami_indexed') return { price: values.ami, legs: values };
    if (formula.type === 'cpi_indexed') return { price: values.cpi, legs: values };
    if (formula.type === 'lesser_of') {
      var chosen = formula.legs.reduce(function (minimum, leg) { return Math.min(minimum, values[leg]); }, Infinity);
      return { price: chosen, legs: values };
    }
    // Selling costs are excluded from this price cap. The HNA screen adds
    // costs as a screening artifact; this lifecycle formula follows the
    // stated owner-share definition directly.
    var appreciation = Math.max(0, marketValue - base);
    return { price: base + formula.appreciationShare * appreciation, legs: values };
  }

  function subordinateAtYear(item, years, scenarioLabel) {
    var balance;
    var payment = 0;
    if (item.structure === 'deferred') {
      balance = item.principal * (1 + item.interestRate * years);
    } else if (item.structure === 'forgivable') {
      balance = item.principal * Math.max(0, 1 - years / item.termYears);
    } else {
      balance = remainingPrincipal(item.principal, item.interestRate, item.termYears, years);
      payment = years < item.termYears ? monthlyPayment(item.principal, item.interestRate, item.termYears) : 0;
    }
    return {
      label: item.label,
      structure: item.structure,
      balance: roundDollar(balance),
      monthlyPayment: roundDollar(payment),
      classification: CLASSIFICATION,
      scenarioLabel: scenarioLabel,
    };
  }

  function improvementValues(items, years) {
    var eligible = items.filter(function (item) { return item.year <= years; });
    return {
      credit: eligible.reduce(function (sum, item) { return sum + item.amount * item.creditShare; }, 0),
      cashFlows: eligible.map(function (item) { return { year: item.year, amount: item.amount }; }),
    };
  }

  function ownerReturn(downPayment, improvements, proceeds, years) {
    if (!(proceeds > 0)) return { value: null, note: 'Owner proceeds are nonpositive; no annualized return is reported.' };
    var invested = downPayment + improvements.reduce(function (sum, item) { return sum + item.amount; }, 0);
    if (!(invested > 0)) return { value: null, note: 'No positive owner cash investment is available for an annualized return.' };
    function npv(rate) {
      var total = -downPayment;
      improvements.forEach(function (item) { total -= item.amount / Math.pow(1 + rate, item.year); });
      total += proceeds / Math.pow(1 + rate, years);
      return total;
    }
    var low = -0.9999;
    var high = 10;
    var lowValue = npv(low);
    var highValue = npv(high);
    if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
      return { value: null, note: 'Owner cash flows do not yield a stable annualized return in the supported range.' };
    }
    for (var i = 0; i < 100; i += 1) {
      var mid = (low + high) / 2;
      var value = npv(mid);
      if (Math.abs(value) < 0.000001) {
        low = mid;
        high = mid;
        break;
      }
      if (lowValue * value <= 0) {
        high = mid;
      } else {
        low = mid;
        lowValue = value;
      }
    }
    return { value: Math.round(((low + high) / 2) * 1000000) / 1000000, note: null };
  }

  function financeAssumptions(input, hoaMonthly, groundRentMonthly) {
    return {
      rateAnnual: input.firstMortgage.rateAnnual,
      termYears: input.firstMortgage.termYears,
      downPaymentRate: input.downPayment / input.restrictedPrice,
      propertyTaxRate: input.propertyTaxRate,
      insuranceRate: input.insuranceRate,
      pmiRate: input.pmiRate,
      pmiLtvGate: true,
      frontEndRatio: 0.30,
      hoaMonthly: hoaMonthly,
      groundRentMonthly: groundRentMonthly,
      householdSize: input.householdSize,
    };
  }

  function resultAtYear(input, years) {
    var scenarioLabel = input.scenarioLabel;
    var marketValue = compound(input.unrestrictedValue, input.scenario.marketGrowth, years);
    var formula = formulaValues(input, years, marketValue);
    var formulaPrice = formula.price;
    var resalePrice = input.formula.appraisalCap ? Math.min(formulaPrice, marketValue) : formulaPrice;
    var appraisalBinding = !!input.formula.appraisalCap && marketValue < formulaPrice;
    var firstBalance = remainingPrincipal(input.firstMortgagePrincipal,
      input.firstMortgage.rateAnnual, input.firstMortgage.termYears, years);
    var firstPayment = years < input.firstMortgage.termYears
      ? monthlyPayment(input.firstMortgagePrincipal, input.firstMortgage.rateAnnual, input.firstMortgage.termYears) : 0;
    var subordinateBalances = input.subordinateDebt.map(function (item) {
      return subordinateAtYear(item, years, scenarioLabel);
    });
    var subordinatePayoff = subordinateBalances.reduce(function (sum, item) { return sum + item.balance; }, 0);
    var subordinatePayment = subordinateBalances.reduce(function (sum, item) { return sum + item.monthlyPayment; }, 0);
    var sellingCosts = resalePrice * input.sellingCostRate;
    var ownerGrossEquity = resalePrice - firstBalance - sellingCosts;
    var improvements = improvementValues(input.capitalImprovements, years);
    var ownerNetProceeds = ownerGrossEquity - subordinatePayoff + improvements.credit;
    var ownerRate = ownerReturn(input.downPayment, improvements.cashFlows, ownerNetProceeds, years);
    var hoaMonthly = compound(input.hoaMonthly, input.hoaEscalationRate, years);
    var groundRentMonthly = compound(input.groundRentMonthly, input.groundRentEscalationRate, years);
    var ltv = marketValue > 0 ? firstBalance / marketValue : Infinity;
    var pmiMonthly = ltv > 0.80 ? firstBalance * input.pmiRate / 12 : 0;
    var monthlyHousingCost = firstPayment + subordinatePayment + hoaMonthly + groundRentMonthly +
      marketValue * (input.propertyTaxRate + input.insuranceRate) / 12 + pmiMonthly;
    var grownAmi = compound(input.ami4Person, input.scenario.amiGrowth, years);
    var assumptions = financeAssumptions(input, hoaMonthly, groundRentMonthly);
    var futureBuyerIncomeNeeded = OwnershipFinance.incomeNeededForHomeValue(resalePrice, assumptions);
    var nextBuyerMaxPrice = OwnershipFinance.maxAffordablePrice(grownAmi, input.amiPct, assumptions);
    var futureAffordabilityGap = resalePrice - nextBuyerMaxPrice;
    var preservesAffordability = resalePrice <= nextBuyerMaxPrice;
    var formulaLegs = {
      fixed: roundDollar(formula.legs.fixed),
      cpi: roundDollar(formula.legs.cpi),
      ami: roundDollar(formula.legs.ami),
      appraisal: roundDollar(formula.legs.appraisal),
      classification: CLASSIFICATION,
      scenarioLabel: scenarioLabel,
    };
    var publicSubsidyOutstanding = roundDollar(input.publicSubsidyAtClosing);
    return {
      year: years,
      formulaResalePrice: roundDollar(formulaPrice),
      formulaLegs: formulaLegs,
      unrestrictedMarketValue: roundDollar(marketValue),
      appraisalConstrainedPrice: roundDollar(resalePrice),
      appraisalBinding: appraisalBinding,
      remainingFirstMortgagePrincipal: roundDollar(firstBalance),
      subordinateBalances: subordinateBalances,
      subordinatePayoff: roundDollar(subordinatePayoff),
      sellingCosts: roundDollar(sellingCosts),
      ownerGrossEquity: roundDollar(ownerGrossEquity),
      capitalImprovementCredit: roundDollar(improvements.credit),
      ownerNetProceeds: roundDollar(ownerNetProceeds),
      effectiveAnnualOwnerReturn: ownerRate.value,
      effectiveAnnualOwnerReturnNote: ownerRate.note,
      monthlyHousingCost: roundDollar(monthlyHousingCost),
      futureBuyerIncomeNeeded: futureBuyerIncomeNeeded,
      futureBuyerAmiRatio: futureBuyerIncomeNeeded == null ? null :
        Math.round((futureBuyerIncomeNeeded / grownAmi) * 1000000) / 1000000,
      futureAffordabilityGap: roundDollar(futureAffordabilityGap),
      additionalSubsidyRequiredForNextBuyer: roundDollar(Math.max(0, futureAffordabilityGap)),
      nextBuyerMaxAffordablePrice: nextBuyerMaxPrice,
      publicSubsidyOutstanding: publicSubsidyOutstanding,
      publicSubsidyRetainedInHome: publicSubsidyOutstanding,
      publicSubsidyRecapturedAtSale: 0,
      publicSubsidyTreatmentLabel: 'Retained in the home; no separate recapture instruction was supplied.',
      preservesAffordability: preservesAffordability,
      preservesAffordabilityLabel: preservesAffordability
        ? 'Resale price is within the next buyer modeled capacity.'
        : 'Resale price exceeds the next buyer modeled capacity.',
      negativeEquity: ownerNetProceeds < 0,
      classification: CLASSIFICATION,
      scenarioLabel: scenarioLabel,
    };
  }

  function project(input) {
    var normalized = normalizeInput(input);
    var results = {};
    normalized.horizons.forEach(function (year) { results[year] = resultAtYear(normalized, year); });
    return {
      results: results,
      horizons: normalized.horizons.slice(),
      firstMortgagePrincipal: roundDollar(normalized.firstMortgagePrincipal),
      subordinateAppliedAtClosing: roundDollar(normalized.subordinateAtClosing),
      formulaType: normalized.formula.type,
      classification: CLASSIFICATION,
      scenarioLabel: normalized.scenarioLabel,
      verifyParameter: !!input.verifyParameter,
      parameterCaveat: input.parameterCaveat || null,
    };
  }

  function scenarioList(scenarios) {
    if (scenarios == null) return Object.keys(SCENARIOS).map(function (key) { return SCENARIOS[key]; });
    if (Array.isArray(scenarios)) return scenarios;
    if (typeof scenarios === 'object') return Object.keys(scenarios).map(function (key) { return scenarios[key]; });
    throw new Error('SharedEquityLifecycle.runMatrix: scenarios must be an array or object');
  }

  function runMatrix(input, scenarios) {
    var paths = scenarioList(scenarios);
    var results = paths.map(function (path) { return project(Object.assign({}, input, { scenario: path })); });
    return {
      scenarios: results,
      classification: CLASSIFICATION,
      scenarioLabel: 'five market paths — scenarios, not predictions',
    };
  }

  function fromConvention(conventionDoc, conventionId, input) {
    if (!conventionDoc || !Array.isArray(conventionDoc.conventions)) {
      throw new Error('SharedEquityLifecycle.fromConvention: conventions array required');
    }
    var convention = conventionDoc.conventions.find(function (item) { return item && item.id === conventionId; });
    if (!convention) throw new Error('SharedEquityLifecycle.fromConvention: unknown convention "' + conventionId + '"');
    var formula;
    if (convention.type === 'fixed_simple') {
      formula = { type: 'fixed_simple', annualRate: convention.annual_rate, appraisalCap: true };
    } else if (convention.type === 'lesser_of_fixed_cpi') {
      formula = {
        type: 'lesser_of',
        annualRate: convention.fixed_rate_upper_bound,
        legs: ['fixed', 'cpi'],
        appraisalCap: true,
      };
    } else if (convention.type === 'shared_appreciation') {
      formula = {
        type: 'shared_appreciation',
        appreciationShare: convention.appreciation_share,
        appraisalCap: true,
      };
    } else {
      throw new Error('SharedEquityLifecycle.fromConvention: unsupported convention type "' + convention.type + '"');
    }
    var verify = String(convention.parameter_status || '').toLowerCase() !== 'verified';
    var result = project(Object.assign({}, input, {
      formula: formula,
      verifyParameter: verify,
      parameterCaveat: verify ? String(convention.screening_note || convention.rate_label || 'Verify convention parameters.') : null,
    }));
    result.conventionId = convention.id;
    result.conventionLabel = convention.label;
    result.parameterStatus = convention.parameter_status || null;
    result.sourceUrl = convention.source_url || null;
    return result;
  }

  return {
    SCENARIOS: SCENARIOS,
    DEFAULT_HORIZONS: DEFAULT_HORIZONS.slice(),
    project: project,
    runMatrix: runMatrix,
    fromConvention: fromConvention,
  };
}));
