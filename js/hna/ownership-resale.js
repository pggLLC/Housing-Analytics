(function () {
  'use strict';

  var SCREENING_CAVEAT = 'Screening estimate only; confirm the controlling deed restriction, ground lease, and program administrator terms before underwriting.';

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function money(value) {
    var n = num(value);
    return n == null ? null : Math.round(n);
  }

  function conventionList(doc) {
    if (Array.isArray(doc)) return doc;
    return doc && Array.isArray(doc.conventions) ? doc.conventions : [];
  }

  function defaultConvention(doc) {
    var list = conventionList(doc);
    return list.find(function (item) { return item && item.default; }) || list[0] || null;
  }

  function fixedSimpleCap(purchasePrice, years, rate) {
    var price = num(purchasePrice);
    var hold = num(years);
    var r = num(rate);
    if (price == null || hold == null || r == null || price < 0 || hold < 0 || r < 0) return null;
    return price * (1 + (r * hold));
  }

  function sharedAppreciationCap(purchasePrice, marketAppreciation, share, sellingCosts) {
    var price = num(purchasePrice);
    var appreciation = num(marketAppreciation);
    var pct = num(share);
    var costs = num(sellingCosts) || 0;
    if (price == null || appreciation == null || pct == null || price < 0 || pct < 0) return null;
    return price + (pct * appreciation) + costs;
  }

  function affordabilityBenchmark(input) {
    input = input || {};
    if (typeof input.maxAffordablePrice === 'function') {
      return money(input.maxAffordablePrice(input.ami4Person, input.targetAmiPct || 0.80, input.assumptions));
    }
    var own = window.HNAOwnershipNeed;
    if (own && typeof own.maxAffordablePrice === 'function') {
      return money(own.maxAffordablePrice(input.ami4Person, input.targetAmiPct || 0.80, input.assumptions));
    }
    return null;
  }

  function evaluateConvention(convention, input) {
    input = input || {};
    convention = convention || {};
    var purchasePrice = num(input.purchasePrice);
    var years = num(input.holdingPeriodYears);
    if (years == null) years = 5;
    var sellingCosts = num(input.sellingCosts) || 0;
    var remainingPrincipal = num(input.remainingPrincipal) || 0;
    var resaleCap = null;
    var calculationBasis = '';
    var verifyParameter = convention.parameter_status && convention.parameter_status !== 'verified';

    if (convention.type === 'fixed_simple') {
      resaleCap = fixedSimpleCap(purchasePrice, years, convention.annual_rate);
      calculationBasis = convention.rate_label || 'Fixed simple appreciation';
    } else if (convention.type === 'lesser_of_fixed_cpi') {
      resaleCap = fixedSimpleCap(purchasePrice, years, convention.fixed_rate_upper_bound);
      calculationBasis = 'Fixed-leg upper bound; CPI leg requires verification';
      verifyParameter = true;
    } else if (convention.type === 'shared_appreciation') {
      resaleCap = sharedAppreciationCap(purchasePrice, input.marketAppreciation || 0, convention.appreciation_share, sellingCosts);
      calculationBasis = convention.share_label || 'Shared appreciation';
      verifyParameter = true;
    }

    var cap = money(resaleCap);
    var equity = cap == null ? null : money(cap - remainingPrincipal - sellingCosts);
    var affordablePrice = affordabilityBenchmark(input);
    var preserves = cap != null && affordablePrice != null ? cap <= affordablePrice : null;

    return {
      conventionId: convention.id || '',
      label: convention.label || convention.id || 'Resale convention',
      type: convention.type || '',
      sourceProgram: convention.source_program || '',
      sourceUrl: convention.source_url || '',
      lastVerified: convention.last_verified || '',
      parameterStatus: convention.parameter_status || 'VERIFY',
      verifyParameter: !!verifyParameter,
      holdingPeriodYears: years,
      purchasePrice: money(purchasePrice),
      maxResalePrice: cap,
      ownerGrossEquity: equity,
      estimatedRemainingPrincipal: money(remainingPrincipal),
      sellingCosts: money(sellingCosts),
      currentAmiAffordablePrice: affordablePrice,
      preservesAffordability: preserves,
      preservationLabel: preserves == null
        ? 'Affordability preservation unavailable'
        : (preserves ? "Keeps price at or below today's AMI-affordable price" : "Drifts above today's AMI-affordable price"),
      calculationBasis: calculationBasis,
      caveat: SCREENING_CAVEAT
    };
  }

  function evaluateAll(doc, input) {
    return conventionList(doc).map(function (convention) {
      return evaluateConvention(convention, input);
    });
  }

  window.OwnershipResale = {
    SCREENING_CAVEAT: SCREENING_CAVEAT,
    conventionList: conventionList,
    defaultConvention: defaultConvention,
    fixedSimpleCap: fixedSimpleCap,
    sharedAppreciationCap: sharedAppreciationCap,
    evaluateConvention: evaluateConvention,
    evaluateAll: evaluateAll
  };
})();
