/**
 * js/hna/ownership-finance.js
 * Authoritative homeownership affordability engine (Phase 1 of the
 * for-sale market-study plan — docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md).
 *
 * Pure functions: no DOM, no fetch. Dual export (window.OwnershipFinance +
 * module.exports), mirroring js/deal-calculator-math.js.
 *
 * Backward-compatibility contract (hard):
 *   maxAffordablePrice(100000, 0.80) === 289983
 * i.e. a call with no model/options reproduces the existing
 * HNAOwnershipNeed kernel (rate 6.5%, 30yr, 10% down, 30% front-end,
 * tax 0.65%, ins 0.35%, PMI 0.5% unconditional) bit-for-bit.
 *
 * Model selection guardrail: "best outcome" means best-matched to the
 * actual buyer, product, and lender — NOT the model that shrinks the gap.
 * recommendedModel() only ever returns the registry default; permissive
 * models carry a mandatory buyer-risk disclosure in compareModels output.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    if (typeof window !== 'undefined') window.OwnershipFinance = module.exports;
  } else {
    root.OwnershipFinance = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // Identical to hna-ownership-need.js CONSTANTS.affordabilityAssumptions.
  var DEFAULTS = {
    rateAnnual: 0.065,
    termYears: 30,
    downPaymentRate: 0.10,
    propertyTaxRate: 0.0065,
    insuranceRate: 0.0035,
    pmiRate: 0.0050,
    frontEndRatio: 0.30,
    // Phase 1 additions — every default preserves legacy behavior.
    housingRatioType: 'front',      // 'front' | 'back'
    backEndRatio: null,             // used only when housingRatioType === 'back'
    borrowerMonthlyDebt: 0,         // back-end DTI input
    hoaMonthly: 0,
    groundRentMonthly: 0,
    closingCostRate: 0,             // share of price, cash-to-close only
    pmiLtvGate: false,              // true → PMI only when down payment < 20%
    mipAnnualPct: 0,                // FHA-style annual MIP on the loan
    householdSize: 4,               // HUD income-limit size adjustment
  };

  // Standard HUD family-size adjustment factors relative to the 4-person
  // limit (10%/person below 4, 8%/person above 4). VERIFY against the
  // published HUD income-limit table for the county when precision matters —
  // published limits are authoritative; these factors are the standard
  // derivation used when only ami_4person is available.
  var HH_SIZE_FACTORS = { 1: 0.70, 2: 0.80, 3: 0.90, 4: 1.00, 5: 1.08, 6: 1.16, 7: 1.24, 8: 1.32 };

  var RATE_KEYS = [
    'rateAnnual', 'pmms30YearRate', 'downPaymentRate', 'downPaymentPct',
    'propertyTaxRate', 'propertyTaxPctAnnual', 'insuranceRate', 'insurancePctAnnual',
    'pmiRate', 'pmiPctAnnual', 'frontEndRatio', 'paymentToIncome', 'backEndRatio',
    'closingCostRate', 'mipAnnualPct',
  ];

  var _registry = null; // set via setRegistry(doc) — data/policy/affordability-models.json

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function round0(value) {
    var n = num(value);
    return n == null ? null : Math.round(n);
  }

  // Percent/decimal mixing guard: every rate/ratio must be a decimal (< 1).
  // Passing 6.5 for 6.5% is a silent 100x error — fail loudly instead.
  function assertDecimalRates(assumptions) {
    RATE_KEYS.forEach(function (key) {
      var v = assumptions[key];
      if (v != null && Number.isFinite(Number(v)) && Number(v) >= 1) {
        throw new Error('OwnershipFinance: "' + key + '" must be a decimal rate (got ' + v +
          '). Use 0.065 for 6.5% — percent and decimal forms must not be mixed.');
      }
    });
  }

  // Merge caller assumptions over defaults, honoring the legacy alias keys
  // the HNA kernel accepts (pmms30YearRate, paymentToIncome, downPaymentPct,
  // propertyTaxPctAnnual, insurancePctAnnual, pmiPctAnnual).
  function resolveAssumptions(assumptions) {
    var a = Object.assign({}, DEFAULTS, assumptions || {});
    assertDecimalRates(a);
    return {
      rateAnnual: a.pmms30YearRate != null ? a.pmms30YearRate : a.rateAnnual,
      termYears: a.termYears,
      downPaymentRate: a.downPaymentRate != null ? a.downPaymentRate : (a.downPaymentPct != null ? a.downPaymentPct : DEFAULTS.downPaymentRate),
      propertyTaxRate: a.propertyTaxRate != null ? a.propertyTaxRate : (a.propertyTaxPctAnnual != null ? a.propertyTaxPctAnnual : DEFAULTS.propertyTaxRate),
      insuranceRate: a.insuranceRate != null ? a.insuranceRate : (a.insurancePctAnnual != null ? a.insurancePctAnnual : DEFAULTS.insuranceRate),
      pmiRate: a.pmiRate != null ? a.pmiRate : (a.pmiPctAnnual != null ? a.pmiPctAnnual : DEFAULTS.pmiRate),
      frontEndRatio: a.frontEndRatio != null ? a.frontEndRatio : (a.paymentToIncome != null ? a.paymentToIncome : DEFAULTS.frontEndRatio),
      housingRatioType: a.housingRatioType || 'front',
      backEndRatio: a.backEndRatio,
      borrowerMonthlyDebt: num(a.borrowerMonthlyDebt) || 0,
      hoaMonthly: num(a.hoaMonthly) || 0,
      groundRentMonthly: num(a.groundRentMonthly) || 0,
      closingCostRate: num(a.closingCostRate) || 0,
      pmiLtvGate: !!a.pmiLtvGate,
      mipAnnualPct: num(a.mipAnnualPct) || 0,
      householdSize: a.householdSize != null ? a.householdSize : 4,
    };
  }

  function householdSizeFactor(size) {
    var s = num(size);
    if (s == null) return 1.0;
    s = Math.max(1, Math.min(8, Math.round(s)));
    return HH_SIZE_FACTORS[s];
  }

  function monthlyMortgageFactor(annualRate, years) {
    var r = annualRate / 12;
    var n = years * 12;
    if (!r) return 1 / n; // zero-interest handling (matches HNA kernel)
    return r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  }

  /**
   * Full computation: max price + loan + buyer cash under one model.
   * Returns null when income is unusable; price 0 when fixed monthly costs
   * consume the entire budget (explicit negative-capacity handling).
   */
  function computeBuyerCapacity(ami4Person, amiPct, assumptions) {
    var a = resolveAssumptions(assumptions);
    var income = (num(ami4Person) || 0) * (num(amiPct) || 0) * householdSizeFactor(a.householdSize);
    if (!income) return null;

    var ratio = a.housingRatioType === 'back' && a.backEndRatio != null ? a.backEndRatio : a.frontEndRatio;
    var monthlyBudget = income * ratio / 12;
    if (a.housingRatioType === 'back' && a.backEndRatio != null) {
      monthlyBudget -= a.borrowerMonthlyDebt; // back-end DTI covers all debt
    }
    monthlyBudget -= (a.hoaMonthly + a.groundRentMonthly); // fixed $ costs don't scale with price

    var loanShare = 1 - a.downPaymentRate;
    var pmiEffective = (a.pmiLtvGate && a.downPaymentRate >= 0.20) ? 0 : a.pmiRate;
    var mortgageFactor = monthlyMortgageFactor(a.rateAnnual, a.termYears);
    var monthlyCostPerDollar = (loanShare * mortgageFactor) +
      ((a.propertyTaxRate + a.insuranceRate) / 12) +
      (loanShare * pmiEffective / 12) +
      (loanShare * a.mipAnnualPct / 12);

    var price = monthlyBudget <= 0 ? 0 : monthlyBudget / monthlyCostPerDollar;
    var rounded = round0(price);
    return {
      maxPrice: rounded,
      maxLoan: round0(price * loanShare),
      buyerCashRequired: round0(price * (a.downPaymentRate + a.closingCostRate)),
      qualifyingIncome: round0(income),
      monthlyBudget: round0(monthlyBudget),
      assumptions: a,
    };
  }

  /** Back-compat surface: identical signature + output to the HNA kernel. */
  function maxAffordablePrice(ami4Person, amiPct, assumptions) {
    var out = computeBuyerCapacity(ami4Person, amiPct, assumptions);
    return out == null ? null : out.maxPrice;
  }

  /** Binary-search inversion at 100% of the supplied income (same as kernel). */
  function incomeNeededForHomeValue(homeValue, assumptions) {
    var target = num(homeValue);
    if (!target || target <= 0) return null;
    var lo = 1;
    var hi = 250000;
    while (maxAffordablePrice(hi, 1.00, assumptions) < target && hi < 5000000) hi *= 2;
    if (hi >= 5000000 && maxAffordablePrice(hi, 1.00, assumptions) < target) return null;
    for (var i = 0; i < 32; i++) {
      var mid = (lo + hi) / 2;
      if (maxAffordablePrice(mid, 1.00, assumptions) >= target) hi = mid;
      else lo = mid;
    }
    return round0(hi);
  }

  // ---- Model registry (data/policy/affordability-models.json) ----

  function setRegistry(doc) {
    if (!doc || !Array.isArray(doc.models)) throw new Error('OwnershipFinance.setRegistry: doc.models array required');
    _registry = doc;
  }

  function getRegistry() { return _registry; }

  function getModel(modelId) {
    if (!_registry) return null;
    return _registry.models.find(function (m) { return m && m.id === modelId; }) || null;
  }

  /**
   * Guardrail: the recommended model is ALWAYS the registry default
   * (conservative screening). The engine never auto-selects a more
   * permissive model; users must choose one explicitly and see its
   * implications.
   */
  function recommendedModel() {
    if (!_registry) return null;
    return _registry.models.find(function (m) { return m && m.default; }) || _registry.models[0] || null;
  }

  /**
   * Translate registry param naming to the engine's canonical keys.
   * The registry path is new (no legacy-parity constraint), so aliases are
   * FULLY honored here — unlike resolveAssumptions, whose alias shadowing
   * deliberately mirrors the legacy kernel. Upfront fees
   * (mipUpfrontPct/guaranteeFeeUpfrontPct) and frontEndRatioCap are not yet
   * modeled in the price computation — they are cash-side / secondary-cap
   * refinements deferred with a VERIFY note in the registry.
   */
  function modelParams(model) {
    var p = Object.assign({}, model && model.params);
    delete p.rate_as_of;
    delete p.income_limit_note;
    if (p.household_size_default != null) {
      p.householdSize = p.household_size_default;
      delete p.household_size_default;
    }
    if (p.downPaymentPct != null) {
      p.downPaymentRate = p.downPaymentPct;
      delete p.downPaymentPct;
    }
    if (p.guaranteeFeeAnnualPct != null) {
      // USDA annual guarantee fee is economically equivalent to an annual
      // MIP on the loan balance for capacity purposes.
      p.mipAnnualPct = p.guaranteeFeeAnnualPct;
      delete p.guaranteeFeeAnnualPct;
    }
    delete p.guaranteeFeeUpfrontPct;
    delete p.mipUpfrontPct;
    delete p.frontEndRatioCap;
    if (p.housingRatio != null) {
      if (p.housingRatioType === 'back') p.backEndRatio = p.housingRatio;
      else p.frontEndRatio = p.housingRatio;
      delete p.housingRatio;
    }
    return p;
  }

  /**
   * Rank permissiveness so the UI can order results and attach the
   * risk-transfer disclosure. Higher rank = more permissive (more buying
   * power claimed from the same income).
   */
  function permissivenessRank(model) {
    var p = (model && model.params) || {};
    var ratio = num(p.housingRatio) || 0.30;
    var down = num(p.downPaymentPct) != null ? num(p.downPaymentPct) : 0.10;
    return ratio * 2 + (0.20 - Math.min(down, 0.20)); // ratio dominates; low down adds
  }

  /**
   * Compare models side-by-side. Every result more permissive than the
   * default carries riskDisclosureRequired: true and the model's buyer_risk
   * text — consumers MUST render it (test-enforced downstream).
   */
  function compareModels(ami4Person, amiPct, modelIds, overrides) {
    if (!_registry) throw new Error('OwnershipFinance.compareModels: call setRegistry first');
    var base = recommendedModel();
    var baseRank = permissivenessRank(base);
    var ids = modelIds && modelIds.length ? modelIds : _registry.models.map(function (m) { return m.id; });
    return ids.map(function (id) {
      var model = getModel(id);
      if (!model) return { modelId: id, error: 'unknown model' };
      var capacity = computeBuyerCapacity(ami4Person, amiPct, Object.assign({}, modelParams(model), overrides || {}));
      var rank = permissivenessRank(model);
      return {
        modelId: model.id,
        label: model.label,
        isDefault: !!model.default,
        maxPrice: capacity ? capacity.maxPrice : null,
        maxLoan: capacity ? capacity.maxLoan : null,
        buyerCashRequired: capacity ? capacity.buyerCashRequired : null,
        qualifyingIncome: capacity ? capacity.qualifyingIncome : null,
        implications: model.implications || null,
        classification: model.classification || 'modeled',
        verify: !!model.verify,
        permissivenessRank: rank,
        riskDisclosureRequired: rank > baseRank,
        riskDisclosure: rank > baseRank
          ? ((model.implications && model.implications.buyer_risk) ||
             'More permissive underwriting transfers risk to the buyer; verify with a lender.')
          : null,
      };
    });
  }

  return {
    DEFAULTS: DEFAULTS,
    HH_SIZE_FACTORS: HH_SIZE_FACTORS,
    householdSizeFactor: householdSizeFactor,
    monthlyMortgageFactor: monthlyMortgageFactor,
    computeBuyerCapacity: computeBuyerCapacity,
    maxAffordablePrice: maxAffordablePrice,
    incomeNeededForHomeValue: incomeNeededForHomeValue,
    setRegistry: setRegistry,
    getRegistry: getRegistry,
    getModel: getModel,
    recommendedModel: recommendedModel,
    compareModels: compareModels,
  };
}));
