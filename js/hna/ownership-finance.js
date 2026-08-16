/**
 * js/hna/ownership-finance.js
 * Authoritative homeownership affordability engine (Phase 1 of the
 * for-sale market-study plan — internal/docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md).
 *
 * Pure computation: no DOM. Dual export (window.OwnershipFinance +
 * module.exports), mirroring js/deal-calculator-math.js. The model registry
 * (data/policy/affordability-models.json) is loaded lazily: synchronously via
 * require() in Node, and via a fire-and-forget fetch in the browser
 * (`OwnershipFinance.registryReady` resolves when models are available).
 *
 * Backward-compatibility contract (hard):
 *   maxAffordablePrice(100000, 0.80) === 289983
 * i.e. a call with no model/options reproduces the existing
 * HNAOwnershipNeed kernel (rate 6.5%, 30yr, 10% down, 30% front-end,
 * tax 0.65%, ins 0.35%, PMI 0.5% unconditional) bit-for-bit.
 *
 * Model selection: the third argument of maxAffordablePrice /
 * computeBuyerCapacity accepts (a) a legacy assumptions object, (b) a
 * registry model id string ('conventional_dti'), or (c) an options object
 * { modelId, ...overrides } — overrides win over model params.
 *
 * Model selection guardrail: "best outcome" means best-matched to the
 * actual buyer, product, and lender — NOT the model that shrinks the gap.
 * recommendedModel() only ever returns the registry default; results more
 * permissive than the default — judged on RESOLVED assumptions, including
 * custom overrides — carry a mandatory buyer-risk disclosure.
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

  var REGISTRY_PATH = 'data/policy/affordability-models.json';

  // Identical to hna-ownership-need.js CONSTANTS.affordabilityAssumptions
  // (drift is guarded by an explicit field-by-field test).
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
    frontEndRatioCap: null,         // binding housing-only cap alongside a back-end ratio (USDA 29/41)
    borrowerMonthlyDebt: 0,         // back-end DTI input
    hoaMonthly: 0,
    groundRentMonthly: 0,
    closingCostRate: 0,             // share of price, cash-to-close only
    pmiLtvGate: false,              // true → PMI only when down payment < 20%
    mipAnnualPct: 0,                // FHA-style annual MIP on the loan
    mipUpfrontPct: 0,               // FHA upfront MIP — financed into the loan
    guaranteeFeeUpfrontPct: 0,      // USDA upfront guarantee fee — financed into the loan
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
    'frontEndRatioCap', 'closingCostRate', 'mipAnnualPct', 'mipUpfrontPct',
    'guaranteeFeeAnnualPct', 'guaranteeFeeUpfrontPct',
  ];

  var _registry = null;
  var _registryReady = null;

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
  // the HNA kernel accepts. Alias precedence deliberately mirrors the legacy
  // kernel (canonical defaults shadow alias inputs) for parity; the NEW
  // registry path canonicalizes fully in modelParams() before reaching here.
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
      // NOTE: Number(null) === 0, so nullish must be checked BEFORE num() —
      // a 0 cap would zero out every back-end model (caught by C1/C7 tests).
      frontEndRatioCap: a.frontEndRatioCap == null ? null : num(a.frontEndRatioCap),
      borrowerMonthlyDebt: num(a.borrowerMonthlyDebt) || 0,
      hoaMonthly: num(a.hoaMonthly) || 0,
      groundRentMonthly: num(a.groundRentMonthly) || 0,
      closingCostRate: num(a.closingCostRate) || 0,
      pmiLtvGate: !!a.pmiLtvGate,
      mipAnnualPct: num(a.mipAnnualPct) || 0,
      mipUpfrontPct: num(a.mipUpfrontPct) || 0,
      guaranteeFeeUpfrontPct: num(a.guaranteeFeeUpfrontPct) || 0,
      householdSize: a.householdSize != null ? a.householdSize : 4,
    };
  }

  /**
   * Resolve the third argument of maxAffordablePrice/computeBuyerCapacity:
   * legacy assumptions object, a model id string, or { modelId, ...overrides }.
   */
  function resolveInput(third) {
    if (typeof third === 'string') {
      return modelParams(getModelOrThrow(third));
    }
    if (third && typeof third === 'object' && third.modelId) {
      var overrides = Object.assign({}, third);
      delete overrides.modelId;
      return Object.assign({}, modelParams(getModelOrThrow(third.modelId)), overrides);
    }
    return third || {};
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

  function effectivePmiRate(a) {
    return (a.pmiLtvGate && a.downPaymentRate >= 0.20) ? 0 : a.pmiRate;
  }

  // Upfront MIP / guarantee fees are financed into the loan (the standard
  // FHA/USDA treatment): the borrower's loan per price dollar grows by
  // (1 + upfront), raising P&I and annual loan-based fees without raising
  // cash to close.
  function financedLoanShare(a) {
    return (1 - a.downPaymentRate) * (1 + a.mipUpfrontPct + a.guaranteeFeeUpfrontPct);
  }

  function monthlyCostPerPriceDollar(a) {
    var loanShareFin = financedLoanShare(a);
    return (loanShareFin * monthlyMortgageFactor(a.rateAnnual, a.termYears)) +
      ((a.propertyTaxRate + a.insuranceRate) / 12) +
      (loanShareFin * effectivePmiRate(a) / 12) +
      (loanShareFin * a.mipAnnualPct / 12);
  }

  /**
   * Full computation: max price + loan + buyer cash under one model.
   * Returns null when income is unusable (missing, zero, or NEGATIVE ami /
   * amiPct — bad income is null, never 0); price 0 when fixed monthly costs
   * consume the entire budget (explicit negative-capacity handling).
   */
  function computeBuyerCapacity(ami4Person, amiPct, optionsOrModelId) {
    var a = resolveAssumptions(resolveInput(optionsOrModelId));
    var ami = num(ami4Person);
    var pct = num(amiPct);
    if (ami == null || pct == null || ami <= 0 || pct <= 0) return null;
    var income = ami * pct * householdSizeFactor(a.householdSize);
    if (!(income > 0)) return null;

    var monthlyBudget;
    if (a.housingRatioType === 'back' && a.backEndRatio != null) {
      monthlyBudget = income * a.backEndRatio / 12 - a.borrowerMonthlyDebt;
      if (a.frontEndRatioCap != null) {
        // USDA-style 29/41: housing payment may not exceed the front cap
        // even when the back-end ratio would allow more.
        monthlyBudget = Math.min(monthlyBudget, income * a.frontEndRatioCap / 12);
      }
    } else {
      monthlyBudget = income * a.frontEndRatio / 12;
    }
    monthlyBudget -= (a.hoaMonthly + a.groundRentMonthly); // fixed $ costs don't scale with price

    var costPerDollar = monthlyCostPerPriceDollar(a);
    var price = monthlyBudget <= 0 ? 0 : monthlyBudget / costPerDollar;
    return {
      maxPrice: round0(price),
      maxLoan: round0(price * financedLoanShare(a)),
      buyerCashRequired: round0(price * (a.downPaymentRate + a.closingCostRate)),
      qualifyingIncome: round0(income),
      monthlyBudget: round0(monthlyBudget),
      assumptions: a,
    };
  }

  /** Back-compat surface: identical signature + output to the HNA kernel. */
  function maxAffordablePrice(ami4Person, amiPct, optionsOrModelId) {
    var out = computeBuyerCapacity(ami4Person, amiPct, optionsOrModelId);
    return out == null ? null : out.maxPrice;
  }

  /** Binary-search inversion at 100% of the supplied income (same as kernel). */
  function incomeNeededForHomeValue(homeValue, optionsOrModelId) {
    var target = num(homeValue);
    if (!target || target <= 0) return null;
    var lo = 1;
    var hi = 250000;
    while (maxAffordablePrice(hi, 1.00, optionsOrModelId) < target && hi < 5000000) hi *= 2;
    if (hi >= 5000000 && maxAffordablePrice(hi, 1.00, optionsOrModelId) < target) return null;
    for (var i = 0; i < 32; i++) {
      var mid = (lo + hi) / 2;
      if (maxAffordablePrice(mid, 1.00, optionsOrModelId) >= target) hi = mid;
      else lo = mid;
    }
    return round0(hi);
  }

  /**
   * Closed-form monthly carrying cost + required income for a KNOWN price.
   * Exact algebraic counterpart of computeBuyerCapacity (no search), used by
   * HNAUtils.computeIncomeNeeded and the affordability metrics panel so all
   * surfaces share one formula. Returns raw floats (callers format).
   */
  function incomeRequiredForPrice(price, optionsOrModelId) {
    var V = num(price);
    if (V == null || V <= 0) return null;
    var a = resolveAssumptions(resolveInput(optionsOrModelId));
    var down = V * a.downPaymentRate;
    var loan = (V - down) * (1 + a.mipUpfrontPct + a.guaranteeFeeUpfrontPct);
    var pAndI = loan * monthlyMortgageFactor(a.rateAnnual, a.termYears);
    var tax = (V * a.propertyTaxRate) / 12;
    var ins = (V * a.insuranceRate) / 12;
    var pmi = (loan * effectivePmiRate(a)) / 12;
    var mip = (loan * a.mipAnnualPct) / 12;
    var payment = pAndI + tax + ins + pmi + mip + a.hoaMonthly + a.groundRentMonthly;
    var ratio = (a.housingRatioType === 'back' && a.backEndRatio != null) ? a.backEndRatio : a.frontEndRatio;
    var monthlyIncome = payment / ratio;
    if (a.housingRatioType === 'back' && a.backEndRatio != null) {
      monthlyIncome = (payment + a.borrowerMonthlyDebt) / a.backEndRatio;
      if (a.frontEndRatioCap != null) {
        monthlyIncome = Math.max(monthlyIncome, payment / a.frontEndRatioCap);
      }
    }
    return {
      homeValue: V,
      down: down,
      loan: loan,
      payment: payment,
      annualIncome: monthlyIncome * 12,
      components: { pAndI: pAndI, tax: tax, ins: ins, pmi: pmi, mip: mip, hoa: a.hoaMonthly, groundRent: a.groundRentMonthly },
      assumptions: a,
    };
  }

  // ---- Model registry (data/policy/affordability-models.json) ----

  function setRegistry(doc) {
    if (!doc || !Array.isArray(doc.models)) throw new Error('OwnershipFinance.setRegistry: doc.models array required');
    _registry = doc;
  }

  function getRegistry() { return _registry; }

  // Node: load the registry synchronously on first model use.
  function ensureRegistry() {
    if (_registry) return _registry;
    if (typeof require === 'function' && typeof __dirname === 'string') {
      try {
        setRegistry(require(__dirname + '/../../' + REGISTRY_PATH));
        return _registry;
      } catch (err) { /* fall through to the explicit error below */ }
    }
    return null;
  }

  function getModel(modelId) {
    if (!ensureRegistry()) return null;
    return _registry.models.find(function (m) { return m && m.id === modelId; }) || null;
  }

  function getModelOrThrow(modelId) {
    if (!ensureRegistry()) {
      throw new Error('OwnershipFinance: model registry not loaded — await OwnershipFinance.registryReady ' +
        '(browser) or call setRegistry(doc) before using model ids.');
    }
    var model = getModel(modelId);
    if (!model) {
      throw new Error('OwnershipFinance: unknown model "' + modelId + '". Available: ' +
        _registry.models.map(function (m) { return m.id; }).join(', '));
    }
    return model;
  }

  /**
   * Guardrail: the recommended model is ALWAYS the registry default
   * (conservative screening). The engine never auto-selects a more
   * permissive model; users must choose one explicitly and see its
   * implications.
   */
  function recommendedModel() {
    if (!ensureRegistry()) return null;
    return _registry.models.find(function (m) { return m && m.default; }) || _registry.models[0] || null;
  }

  /**
   * Translate registry param naming to the engine's canonical keys.
   * The registry path is new (no legacy-parity constraint), so aliases are
   * FULLY honored here — unlike resolveAssumptions, whose alias shadowing
   * deliberately mirrors the legacy kernel.
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
    if (p.housingRatio != null) {
      if (p.housingRatioType === 'back') p.backEndRatio = p.housingRatio;
      else p.frontEndRatio = p.housingRatio;
      delete p.housingRatio;
    }
    return p;
  }

  /**
   * Permissiveness is judged on RESOLVED assumptions (model params merged
   * with any overrides) — a "custom" model with aggressive entered ratios
   * ranks permissive and gets the risk disclosure just like a named
   * permissive model. Higher rank = more buying power claimed from the same
   * income. The effective housing ratio honors a binding front-end cap.
   */
  function permissivenessRankResolved(a) {
    var ratio;
    if (a.housingRatioType === 'back' && a.backEndRatio != null) {
      ratio = a.frontEndRatioCap != null ? Math.min(a.backEndRatio, a.frontEndRatioCap) : a.backEndRatio;
    } else {
      ratio = a.frontEndRatio;
    }
    return ratio * 2 + (0.20 - Math.min(a.downPaymentRate, 0.20));
  }

  /**
   * Compare models side-by-side.
   * opts: { overrides?: object, targetPrice?: number }
   * Every result more permissive than the default (on resolved assumptions)
   * carries riskDisclosureRequired: true and the model's buyer_risk text —
   * consumers MUST render it. When targetPrice is supplied each result
   * carries the signed gap:
   *   gapVsTargetPrice = maxPrice − targetPrice  (negative ⇒ buyer falls
   *   short of the target; positive ⇒ headroom), and
   *   subsidyNeededPerUnit = max(0, targetPrice − maxPrice).
   */
  function compareModels(ami4Person, amiPct, modelIds, opts) {
    if (!ensureRegistry()) throw new Error('OwnershipFinance.compareModels: registry not loaded — call setRegistry first');
    opts = opts || {};
    var overrides = opts.overrides || null;
    var targetPrice = num(opts.targetPrice);
    var base = recommendedModel();
    var baseRank = permissivenessRankResolved(resolveAssumptions(modelParams(base)));
    var ids = modelIds && modelIds.length ? modelIds : _registry.models.map(function (m) { return m.id; });
    return ids.map(function (id) {
      var model = getModel(id);
      if (!model) return { modelId: id, error: 'unknown model' };
      var params = Object.assign({}, modelParams(model), overrides || {});
      var resolved = resolveAssumptions(params);
      var capacity = computeBuyerCapacity(ami4Person, amiPct, params);
      var rank = permissivenessRankResolved(resolved);
      var maxPrice = capacity ? capacity.maxPrice : null;
      return {
        modelId: model.id,
        label: model.label,
        isDefault: !!model.default,
        maxPrice: maxPrice,
        maxLoan: capacity ? capacity.maxLoan : null,
        buyerCashRequired: capacity ? capacity.buyerCashRequired : null,
        qualifyingIncome: capacity ? capacity.qualifyingIncome : null,
        targetPrice: targetPrice,
        gapVsTargetPrice: (targetPrice != null && maxPrice != null) ? maxPrice - targetPrice : null,
        subsidyNeededPerUnit: (targetPrice != null && maxPrice != null) ? Math.max(0, targetPrice - maxPrice) : null,
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

  var api = {
    DEFAULTS: DEFAULTS,
    HH_SIZE_FACTORS: HH_SIZE_FACTORS,
    REGISTRY_PATH: REGISTRY_PATH,
    householdSizeFactor: householdSizeFactor,
    monthlyMortgageFactor: monthlyMortgageFactor,
    computeBuyerCapacity: computeBuyerCapacity,
    maxAffordablePrice: maxAffordablePrice,
    incomeNeededForHomeValue: incomeNeededForHomeValue,
    incomeRequiredForPrice: incomeRequiredForPrice,
    setRegistry: setRegistry,
    getRegistry: getRegistry,
    getModel: getModel,
    recommendedModel: recommendedModel,
    compareModels: compareModels,
    registryReady: null,
  };

  // Browser: begin loading the production registry immediately so model ids
  // work as soon as registryReady resolves. Fire-and-forget; sync model-id
  // calls before load throw a clear "registry not loaded" error.
  if (typeof window !== 'undefined' && typeof window.fetch === 'function' && typeof document !== 'undefined') {
    var url = (typeof window.resolveAssetUrl === 'function') ? window.resolveAssetUrl(REGISTRY_PATH) : REGISTRY_PATH;
    _registryReady = window.fetch(url, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (doc) { setRegistry(doc); return doc; })
      .catch(function () { return null; });
    api.registryReady = _registryReady;
  }

  return api;
}));
