/** Pure rental calculation extracted for #2118, with explicit L1 loan obligations.
 * inputs.fields contains raw control values (including blank strings); the other
 * keys contain already-loaded source records. No fetching or mutable deal state.
 * Numeric absence is null at the result boundary, with a dotted-path reason in
 * unavailable. Internal NaN propagation preserves the existing blocking behavior.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./deal-calculator-math.js'), require('./chfa-rent-limits.js'),
      function () { return require('./deal-cost-basis.js'); },
      function () { return require('./deal-operating-budget.js'); });
  } else {
    // Late binding preserves the PMA page's existing script order.
    root.DealEngine = factory(root.DealCalculatorMath, {
      maxContractRent: function (input) { return root.ChfaRentLimits.maxContractRent(input); },
      unavailableMessage: function (reason) { return root.ChfaRentLimits.unavailableMessage(reason); },
      prop123ProjectAverage: function (input) { return root.ChfaRentLimits.prop123ProjectAverage(input); }
    }, function () { return root.DealCostBasis; }, function () { return root.DealOperatingBudget; });
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (math, rentLimits, costBasisModule, operatingBudgetModule) {
  'use strict';
  var DEAL_AMI_BANDS = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
  var DEFAULT_MINIMUM_SET_ASIDE_ELECTION = '40-60';
  var MINIMUM_SET_ASIDE_ELECTIONS = {
    '20-50': { minimumShare: 0.20, setAsideCeiling: 50, creditCeiling: 60 },
    '40-60': { minimumShare: 0.40, setAsideCeiling: 60, creditCeiling: 60 },
    'average-income': { minimumShare: 0.40, setAsideCeiling: 80, creditCeiling: 80 }
  };
  // Bedroom types offered in the per-tier unit split. Studio was historically
  // absent here while being present in the tier <select>, in _amiLimitsByBr,
  // and in getZoriPerBrRent -- so a studio rent limit was displayed but studio
  // units could not be entered. Kept as one constant because the previous
  // duplicate literal appeared at six call sites and drifted.
  var SPLIT_BR_TYPES = ['studio', '1br', '2br', '3br', '4br'];
  var RENT_BEDROOMS = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var DEFAULT_CONSTANTS = {
    rentBurdenPct:   0.30,   // HUD-standard share of income spent on rent
    rentStressPct:   0.10,   // single-variable: -10% to gross rent
    vacStressPp:     0.05,   // single-variable: +5 pp to vacancy
    opexStressPct:   0.10,   // single-variable: +10% to operating expenses
    combinedRentPct: 0.05,   // combined-scenario: -5% to gross rent
    combinedVacPp:   0.03,   // combined-scenario: +3 pp to vacancy
    combinedOpexPct: 0.05    // combined-scenario: +5% to operating expenses
  };
  var CREDIT_YEARS = 10;
  var mortgageConstant = math.mortgageConstant;

  function computeRentAchievability(inputs) {
    if (!inputs || !inputs.amiLimits || !inputs.fmr) return null;
    var fmr = inputs.fmr;
    if (typeof fmr.two_br !== 'number' || fmr.two_br <= 0) return null;
    var fmr2br = fmr.two_br;

    function _status(gap) {
      if (gap <= 0)   return 'clear';
      if (gap <= 50)  return 'tight';
      if (gap <= 200) return 'concerning';
      return 'misaligned';
    }

    var tiers = DEAL_AMI_BANDS
      .filter(function (p) { return typeof inputs.amiLimits[p] === 'number' && inputs.amiLimits[p] > 0; })
      .map(function (pct) {
        var ceiling = inputs.amiLimits[pct];
        var gap = ceiling - fmr2br;
        return {
          pct:     pct,
          ceiling: ceiling,
          fmr2br:  fmr2br,
          gap:     gap,
          status:  _status(gap)
        };
      });

    if (tiers.length === 0) return null;
    return { tiers: tiers, fmr: fmr };
  }

  function normalizeMinimumSetAsideElection(election) {
    return Object.prototype.hasOwnProperty.call(MINIMUM_SET_ASIDE_ELECTIONS, election)
      ? election
      : DEFAULT_MINIMUM_SET_ASIDE_ELECTION;
  }

  function isLihtcCreditEligiblePct(pct, election) {
    var n = Number(pct);
    var config = MINIMUM_SET_ASIDE_ELECTIONS[normalizeMinimumSetAsideElection(election)];
    return n >= 20 && n <= config.creditCeiling;
  }

  function evaluateMinimumSetAside(election, totalUnits, designatedUnitsByPct) {
    var normalized = normalizeMinimumSetAsideElection(election);
    var config = MINIMUM_SET_ASIDE_ELECTIONS[normalized];
    var total = Number(totalUnits);
    if (!isFinite(total) || total < 0) total = 0;
    var eligibleUnits = 0;
    var setAsideUnits = 0;
    var weightedAmi = 0;
    Object.keys(designatedUnitsByPct || {}).forEach(function (rawPct) {
      var pct = Number(rawPct);
      var count = Number(designatedUnitsByPct[rawPct]);
      if (!isFinite(count) || count <= 0) return;
      if (pct <= config.setAsideCeiling) setAsideUnits += count;
      if (isLihtcCreditEligiblePct(pct, normalized)) {
        eligibleUnits += count;
        weightedAmi += pct * count;
      }
    });
    var minimumSharePct = total > 0 ? (setAsideUnits / total) * 100 : null;
    var minimumShareMet = total > 0 && setAsideUnits / total >= config.minimumShare;
    var averageAmiPct = normalized === 'average-income' && eligibleUnits > 0
      ? weightedAmi / eligibleUnits
      : null;
    var averageMet = normalized !== 'average-income' || (averageAmiPct !== null && averageAmiPct <= 60);
    // CHFA's October 2025 AIT compliance policy permits this election only
    // when 100% of residential units are designated low-income units.
    var chfaAllUnitsMet = normalized !== 'average-income' || (total > 0 && eligibleUnits === total);
    var qualifies = minimumShareMet && averageMet && chfaAllUnitsMet;
    var reasons = [];
    if (!minimumShareMet) {
      reasons.push('the designated set-aside is below ' + Math.round(config.minimumShare * 100) + '% of residential units');
    }
    if (!averageMet) reasons.push('the designated average exceeds 60% AMI');
    if (!chfaAllUnitsMet) reasons.push('CHFA requires all residential units to be designated low-income under this election');
    return {
      election: normalized,
      totalUnits: total,
      eligibleUnits: eligibleUnits,
      setAsideUnits: setAsideUnits,
      minimumSharePct: minimumSharePct,
      averageAmiPct: averageAmiPct,
      minimumShareMet: minimumShareMet,
      averageMet: averageMet,
      chfaAllUnitsMet: chfaAllUnitsMet,
      qualifies: qualifies,
      countedLihtcUnits: qualifies ? eligibleUnits : 0,
      reason: reasons.join('; ')
    };
  }

  function computeDscrStressScenarios(inputs, constants) {
    if (!inputs) return null;
    constants = constants || DEFAULT_CONSTANTS;
    var annualRents = inputs.annualRents, vacancyPct = inputs.vacancyPct,
      annualOpex = inputs.annualOpex, annualRepReserve = inputs.annualRepReserve,
      netPropTax = inputs.netPropTax, annualDebtService = inputs.annualDebtService;
    // Other income (DOH's parking, laundry and fees) is not stressed with rent.
    // Callers without other income pass none; a null one is unknown, not $0.
    var otherIncome = inputs.annualOtherIncome === undefined ? 0 : inputs.annualOtherIncome;
    if (![annualRents, otherIncome, vacancyPct, annualOpex, annualRepReserve, netPropTax, annualDebtService].every(known)
        || annualDebtService <= 0 || annualRents <= 0) return null;

    var rentS = +constants.rentStressPct;
    var vacS  = +constants.vacStressPp;
    var opexS = +constants.opexStressPct;
    var cR    = +constants.combinedRentPct;
    var cV    = +constants.combinedVacPp;
    var cO    = +constants.combinedOpexPct;

    function _noiFor(rentMult, vacDelta, opexMult) {
      var effVac = Math.min(1, Math.max(0, vacancyPct + vacDelta));
      var eff    = (annualRents * rentMult + otherIncome) * (1 - effVac);
      return eff - annualOpex * opexMult - annualRepReserve - netPropTax;
    }
    var baseNoi = _noiFor(1.00, 0, 1.00);
    return {
      base:     { noi: baseNoi,                       dscr: baseNoi / annualDebtService },
      rent10:   { noi: _noiFor(1 - rentS, 0,    1.00), dscr: _noiFor(1 - rentS, 0,    1.00) / annualDebtService },
      vac5:     { noi: _noiFor(1.00,  vacS, 1.00),     dscr: _noiFor(1.00,  vacS, 1.00) / annualDebtService },
      opex10:   { noi: _noiFor(1.00,  0,    1 + opexS),dscr: _noiFor(1.00,  0,    1 + opexS) / annualDebtService },
      combined: { noi: _noiFor(1 - cR, cV,   1 + cO),  dscr: _noiFor(1 - cR, cV,   1 + cO) / annualDebtService }
    };
  }

  function manualMarketSplit(units, bedroomCounts, fallbackBedroom) {
    var total = SPLIT_BR_TYPES.reduce(function (sum, br) { return sum + bedroomCounts[br]; }, 0);
    var rows = SPLIT_BR_TYPES.map(function (br) {
      var exact = total > 0 ? units * bedroomCounts[br] / total : (br === fallbackBedroom ? units : 0);
      return { br: br, units: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    var remaining = units - rows.reduce(function (sum, row) { return sum + row.units; }, 0);
    rows.slice().sort(function (a, b) { return b.remainder - a.remainder; }).forEach(function (row) {
      if (remaining > 0) { row.units++; remaining--; }
    });
    return rows.filter(function (row) { return row.units > 0; });
  }

  function priceManualMarket(units, bedroomCounts, input) {
    var override = input.mode === 'override';
    var note = input.note;
    var zori = input.zori;
    var source = input.source;
    var allocation = manualMarketSplit(units, bedroomCounts, input.fallbackBedroom);
    var reason = null;
    var rows = allocation.map(function (row) {
      var entered = input.rents[row.br];
      var value = override ? (entered.trim() ? Number(entered) : null) : zori && zori[row.br];
      var rent = typeof value === 'number' && isFinite(value) && value > 0 ? value : null;
      if (override && !note) { reason = 'market_rent_source_missing'; rent = null; }
      else if (rent == null) reason = 'market_rent_missing';
      return { tier: 'market', bedrooms: RENT_BEDROOMS[row.br], units: row.units, rent: rent,
        source: override ? note || null : source.source || null,
        vintage: override ? null : source.vintage, sourceUrl: override ? null : source.sourceUrl };
    });
    var message = reason ? 'market rent for ' + units + ' unrestricted units needs a source' +
      (reason === 'market_rent_source_missing' ? ' — add the override source note' : '') : null;
    return { rows: rows, unavailableReason: reason, message: message,
      source: override ? note : [source.source, source.vintage, source.geography].filter(Boolean).join(' · ') };
  }

  function costPerGrossSf(tdc, grossSf) {
    var sf = +grossSf;
    if (!isFinite(sf) || sf <= 0) return null;
    if (!isFinite(tdc) || tdc <= 0) return null;
    return tdc / sf;
  }

  function computeForSaleFeasibility(input) {
    input = input || {};
    var tdc = +input.tdc;
    var units = +input.units;
    var ami4Person = +input.ami4Person;
    var targetAmiPct = +input.targetAmiPct;
    if (!isFinite(targetAmiPct) || targetAmiPct <= 0) targetAmiPct = 0.80;
    if (!isFinite(tdc) || tdc <= 0 || !isFinite(units) || units <= 0) {
      return { status: 'missing-costs', targetAmiPct: targetAmiPct,
               tdcPerSf: costPerGrossSf(tdc, input.grossSf) };
    }
    if (!isFinite(ami4Person) || ami4Person <= 0) {
      return { status: 'missing-ami', targetAmiPct: targetAmiPct, tdcPerUnit: tdc / units,
               tdcPerSf: costPerGrossSf(tdc, input.grossSf) };
    }
    if (!input.hasAffordablePriceHelper) {
      return { status: 'missing-helper', targetAmiPct: targetAmiPct, tdcPerUnit: tdc / units,
               tdcPerSf: costPerGrossSf(tdc, input.grossSf) };
    }
    var tdcPerUnit = tdc / units;
    var maxSalePrice = input.maxAffordableSalePrice;
    var rawGapPerUnit = tdcPerUnit - maxSalePrice;
    var subsidyGapPerUnit = Math.max(0, rawGapPerUnit);
    var result = {
      status: 'ok',
      targetAmiPct: targetAmiPct,
      ami4Person: ami4Person,
      tdcPerUnit: tdcPerUnit,
      tdcPerSf: costPerGrossSf(tdc, input.grossSf),
      grossSf: (isFinite(+input.grossSf) && +input.grossSf > 0) ? +input.grossSf : null,
      maxAffordableSalePrice: maxSalePrice,
      rawGapPerUnit: rawGapPerUnit,
      subsidyGapPerUnit: subsidyGapPerUnit,
      totalSubsidyGap: subsidyGapPerUnit * units,
      surplusPerUnit: Math.max(0, -rawGapPerUnit)
    };
    result.developerFundingStack = computeDeveloperOwnershipFundingStack(result, {
      units: units,
      programs: input.developerFundingPrograms
    });
    result.ownershipResale = input.ownershipResale || null;
    return result;
  }

  function _developerFundingPrograms(programs) {
    if (Array.isArray(programs)) return programs;
    if (programs && Array.isArray(programs.programs)) return programs.programs;
    return [];
  }

  function _developerFundingAmountPerUnit(program, feasibility) {
    if (!program || (program.apply_to_gap !== true && program.screening_apply !== true)) return null;
    var amountType = String(program.amount_type || '');
    if (amountType === 'fixed_dollar_cap') {
      var maxAmount = +program.max_amount;
      return isFinite(maxAmount) && maxAmount > 0 ? maxAmount : null;
    }
    if (amountType === 'percent_purchase_price') {
      var pct = +program.max_percent;
      var basis = String(program.basis || '');
      var basisValue = basis === 'max_affordable_sale_price'
        ? +feasibility.maxAffordableSalePrice
        : +feasibility.tdcPerUnit;
      if (isFinite(pct) && pct > 0 && isFinite(basisValue) && basisValue > 0) {
        return pct * basisValue;
      }
    }
    return null;
  }

  function computeDeveloperOwnershipFundingStack(feasibility, options) {
    var opts = options || {};
    var units = +opts.units;
    if (!isFinite(units) || units <= 0) units = 0;
    var gap = Math.max(0, +((feasibility || {}).subsidyGapPerUnit) || 0);
    var remaining = gap;
    var appliedTotal = 0;
    var programs = _developerFundingPrograms(opts.programs);
    var appliedSources = [];
    var verifySources = [];

    programs.forEach(function (program) {
      if (!program || String(program.status || '').toLowerCase() !== 'active') return;
      var amount = _developerFundingAmountPerUnit(program, feasibility || {});
      if (!isFinite(amount) || amount <= 0) {
        verifySources.push({
          id: program.id || '',
          name: program.name || program.id || 'Program',
          programType: program.program_type || '',
          displayAmount: program.render_value || 'VERIFY',
          sourceUrl: program.source_url || '',
          note: program.screening_note || '',
          classification: program.classification,
          observationClass: program.observation_class,
          evidenceBasis: program.evidence_basis,
          sourceNote: program.source_note,
          lastVerified: program.last_verified
        });
        return;
      }
      var applied = Math.min(remaining, amount);
      remaining = Math.max(0, remaining - applied);
      appliedTotal += applied;
      appliedSources.push({
        id: program.id || '',
        name: program.name || program.id || 'Program',
        programType: program.program_type || '',
        availableAmountPerUnit: amount,
        appliedAmountPerUnit: applied,
        screeningOnly: program.apply_to_gap !== true,
        sourceUrl: program.source_url || '',
        note: program.screening_note || '',
        classification: program.classification,
        observationClass: program.observation_class,
        evidenceBasis: program.evidence_basis,
        sourceNote: program.source_note,
        lastVerified: program.last_verified
      });
    });

    return {
      label: 'Developer ownership funding stack - screening only',
      ownerDecision: 'C3 starter set - owner confirmation needed',
      appliedAmountPerUnit: appliedTotal,
      appliedTotal: appliedTotal * units,
      residualGapPerUnit: remaining,
      residualTotalGap: remaining * units,
      appliedSources: appliedSources,
      verifySources: verifySources,
      sourceCount: programs.length
    };
  }

  function known(value) { return typeof value === 'number' && Number.isFinite(value); }
  // Must-pay debt service NOI could not cover stays in the loan balance; it is
  // not cash that left the project (DOH PR 4).
  function mustPayUnpaidFor(obligation) {
    return obligation && [obligation.mustPayDebtService, obligation.paid, obligation.contingentPaid].every(known)
      ? Math.max(0, obligation.mustPayDebtService - (obligation.paid - obligation.contingentPaid)) : null;
  }
  // A not-yet-mounted optional control uses its visible UI default. Clearing an
  // existing control is absence, and must not silently reapply that default.
  function fieldNumber(fields, id, initial) {
    return fields[id] === undefined ? initial : parseFloat(fields[id]);
  }
  // Projection growth inputs advertise these ranges; a typed value outside
  // them is unknown, not clamped, so no projection is built from it. Rent may
  // fall (down to -3% a year) so a flat-or-falling market can be tested;
  // expenses are not modelled as falling.
  var GROWTH_LIMITS = { 'pf-rent-growth': { min: -3, max: 5 }, 'pf-exp-growth': { min: 0, max: 6 } };
  // The exit panel's own boxes: whole years from 5 to 30 and a cap rate from
  // 3% to 12%. A caller that sends neither field keeps the 15-year, 6.5% sale.
  var EXIT_LIMITS = { hold: { min: 5, max: 30, initial: 15 }, cap: { min: 3, max: 12, initial: 6.5 } };
  function exitHoldYears(fields) {
    var h = fieldNumber(fields, 'dc-exit-hold', EXIT_LIMITS.hold.initial);
    return known(h) && h === Math.round(h) && h >= EXIT_LIMITS.hold.min && h <= EXIT_LIMITS.hold.max ? h : NaN;
  }
  function exitCapRate(fields) {
    var c = fieldNumber(fields, 'dc-exit-cap', EXIT_LIMITS.cap.initial);
    return known(c) && c >= EXIT_LIMITS.cap.min && c <= EXIT_LIMITS.cap.max ? c / 100 : NaN;
  }
  function exitInputsReasonFor(fields) {
    if (!known(exitHoldYears(fields))) return 'Enter a hold period of ' + EXIT_LIMITS.hold.min + ' to ' + EXIT_LIMITS.hold.max + ' whole years.';
    if (!known(exitCapRate(fields))) return 'Enter an exit cap rate from ' + EXIT_LIMITS.cap.min + '% to ' + EXIT_LIMITS.cap.max + '%.';
    return null;
  }
  function growthRate(fields, id, initial) {
    var pct = fieldNumber(fields, id, initial);
    var limit = GROWTH_LIMITS[id];
    return known(pct) && pct >= limit.min && pct <= limit.max ? pct / 100 : NaN;
  }
  var LOAN_TYPES = Object.freeze({
    amortizing: 'Must-pay amortizing', io_then_amortizing: 'Interest-only then amortizing',
    interest_only: 'Interest-only to maturity', cash_flow: 'Cash-flow contingent',
    accrue_defer: 'Accrue and defer', forgivable: 'Forgivable'
  });
  function loanNumber(value) {
    return value === null || value === undefined || String(value).trim() === '' ? null : Number(value);
  }
  function loanTerms(input) {
    // Old links had no loanType/maturity: retain their stated amortization,
    // and interpret the previously ignored accrue / cash-flow controls.
    var type = input.loanType === undefined
      ? (input.accrueMode === 'accrued' ? 'accrue_defer'
        : input.cashflowPayPct !== undefined && input.cashflowPayPct < 100 ? 'cash_flow' : 'amortizing')
      : input.loanType;
    var term = loanNumber(input.term);
    var loan = { id: input.id, program: input.program, senior: !!input.senior, type: type,
      amount: loanNumber(input.amount), rate: loanNumber(input.rate), amortization: term,
      maturity: input.maturity === undefined ? term : loanNumber(input.maturity),
      priority: input.priority === undefined ? (input.senior ? 1 : 5) : loanNumber(input.priority),
      ioYears: type === 'io_then_amortizing' ? loanNumber(input.ioYears) : 0,
      cashflowPayPct: type === 'cash_flow' ? loanNumber(input.cashflowPayPct) : 0 };
    var reason = !Object.prototype.hasOwnProperty.call(LOAN_TYPES, type) ? 'Choose a loan repayment type.'
      : !known(loan.amount) || loan.amount < 0 ? 'Enter a non-negative loan amount.'
      : !known(loan.rate) || loan.rate < 0 || loan.rate > 20 ? 'Enter a loan rate from 0% to 20%.'
      : !Number.isInteger(term) || term < 1 || term > 50 ? 'Enter loan amortization from 1 to 50 whole years.'
      : !Number.isInteger(loan.maturity) || loan.maturity < 1 || loan.maturity > 50 ? 'Enter loan maturity from 1 to 50 whole years.'
      : !Number.isInteger(loan.priority) || loan.priority < 1 || loan.priority > 12 ? 'Enter loan priority from 1 to 12.'
      : !Number.isInteger(loan.ioYears) || loan.ioYears < 0 || loan.ioYears >= loan.maturity ? 'Enter interest-only years below maturity.'
      : !known(loan.cashflowPayPct) || loan.cashflowPayPct < 0 || loan.cashflowPayPct > 100 ? 'Enter a residual cash-flow share from 0% to 100%.' : null;
    return { loan: loan, unavailableReason: reason };
  }
  function regularLoanPayment(loan, year) {
    if (year > loan.maturity || loan.amount === 0) return 0;
    if (loan.type === 'interest_only' || (loan.type === 'io_then_amortizing' && year <= loan.ioYears)) return loan.amount * loan.rate / 100;
    if (loan.type !== 'amortizing' && loan.type !== 'io_then_amortizing') return 0;
    if (year - loan.ioYears > loan.amortization) return 0;
    return loan.rate === 0 ? loan.amount / loan.amortization : loan.amount * mortgageConstant(loan.rate / 100, loan.amortization);
  }
  function coverageRatio(noi, debtService) {
    return known(noi) && known(debtService) && debtService > 0 ? noi / debtService : null;
  }
  /** Annual operating payments, in priority order; balloon cash is NOT assumed.
   * Must-pay loans use monthly interest/amortization. Deferred and contingent
   * interest compounds annually. Forgiveness occurs at stated maturity.
   * After an unpaid maturity, subsequent years need a refinancing assumption.
   */
  function loanObligations(inputs, annualNoi, deductions) {
    var parsed = inputs.map(loanTerms);
    var invalid = parsed.find(function (p) { return p.unavailableReason; });
    if (invalid) return { loans: null, years: null, unavailableReason: invalid.unavailableReason };
    var loans = parsed.map(function (p) { return Object.assign({}, p.loan, { rows: [] }); });
    var order = loans.slice().sort(function (a, b) { return a.priority - b.priority; });
    var balances = loans.map(function (loan) { return loan.amount; });
    var years = [];
    // An asset management fee that cash cannot cover accrues and is paid first
    // from later years' cash, never dropped (DOH PR 4).
    var assetOwed = 0;
    annualNoi.forEach(function (noi, index) {
      var year = index + 1;
      var available = known(noi) ? Math.max(0, noi) : null;
      var seniorDue = 0, mustPayDue = 0, paid = 0, contingentPaid = 0, maturityDue = 0;
      var bridgeDue = 0, assetDue = 0, assetPaid = 0;
      var reason = !known(noi) ? 'NOI is unavailable for this year.' : null;
      // Required payments are allocated before contingent payments. Priority
      // orders lenders within each class; it never makes a residual loan senior.
      [false, true].forEach(function (contingent) {
        // DOH PR 4: bridge-loan debt service, then the asset management fee,
        // come out of cash after the must-pay loans and before cash-flow loans.
        var d = contingent && deductions ? deductions[index] : null;
        if (d && (!known(d.bridge) || !known(d.assetFee))) {
          assetOwed = null;
          reason = reason || 'The bridge-loan or asset management payment for this year is unknown.';
        } else if (d && known(available) && known(assetOwed)) {
          bridgeDue = d.bridge;
          available = Math.max(0, available - bridgeDue);
          assetDue = d.assetFee + assetOwed;
          assetPaid = Math.min(available, assetDue);
          available -= assetPaid;
          assetOwed = assetDue - assetPaid;
        } else if (d) {
          assetOwed = null;
          reason = reason || 'The asset management fee owed from earlier years is unknown.';
        }
        order.forEach(function (loan) {
          if ((loan.type === 'cash_flow') !== contingent) return;
          var i = loans.indexOf(loan), opening = balances[i];
          var row = { year: year, due: null, paid: null, unpaid: null, accrued: null,
            balance: null, maturityDue: null, forgiven: null, unavailableReason: null };
          var operatingPayment = ['amortizing', 'io_then_amortizing', 'interest_only', 'cash_flow'].indexOf(loan.type) !== -1;
          if (!known(opening) || (!known(noi) && opening > 0 && operatingPayment) || (year > loan.maturity && opening > 0.01)) {
            row.unavailableReason = year > loan.maturity ? 'Loan maturity requires a repayment or refinancing assumption.' : 'NOI is unavailable for loan payments.';
            reason = row.unavailableReason; balances[i] = null; loan.rows.push(row); return;
          }
          var due = regularLoanPayment(loan, year), interest = 0, ending = opening;
          var payment = opening === 0 || due === 0 ? 0 : Math.min(available, due);
          var accrued = 0, forgiven = 0;
          if (loan.type === 'cash_flow' || loan.type === 'accrue_defer' || loan.type === 'forgivable') {
            interest = opening * loan.rate / 100;
            if (contingent) {
              due = Math.min(opening + interest, available * loan.cashflowPayPct / 100);
              payment = due;
            }
            ending = Math.max(0, opening + interest - payment);
            accrued = Math.max(0, interest - payment);
            if (loan.type === 'forgivable' && year === loan.maturity) { forgiven = ending; ending = 0; }
          } else {
            // Allocate this year's operating payment equally across months.
            for (var m = 0; m < 12; m++) {
              var monthlyInterest = ending * loan.rate / 100 / 12;
              interest += monthlyInterest;
              ending = Math.max(0, ending + monthlyInterest - payment / 12);
            }
            accrued = Math.max(0, interest - payment);
          }
          if (ending < 0.00001) ending = 0;
          var balloon = year === loan.maturity ? ending : 0;
          row.due = due; row.paid = payment; row.unpaid = Math.max(0, due - payment);
          row.accrued = accrued; row.balance = ending; row.maturityDue = balloon; row.forgiven = forgiven;
          loan.rows.push(row); balances[i] = ending;
          available = known(available) ? Math.max(0, available - payment) : null;
          paid += payment; maturityDue += balloon;
          if (contingent) contingentPaid += payment;
          else { mustPayDue += due; if (loan.senior) seniorDue += due; }
        });
      });
      years.push({ year: year, noi: known(noi) ? noi : null,
        seniorDebtService: reason ? null : seniorDue, mustPayDebtService: reason ? null : mustPayDue,
        paid: reason ? null : paid, contingentPaid: reason ? null : contingentPaid,
        maturityDue: reason ? null : maturityDue,
        seniorCoverage: reason ? null : coverageRatio(noi, seniorDue),
        allMustPayCoverage: reason ? null : coverageRatio(noi, mustPayDue),
        bridgeDebtService: reason ? null : bridgeDue,
        // Owed at year end, carried into next year's fee.
        assetMgmtFee: reason ? null : assetPaid, assetMgmtUnpaid: reason ? null : assetDue - assetPaid,
        cashFlow: reason ? null : noi - mustPayDue - bridgeDue - assetPaid - contingentPaid,
        unavailableReason: reason });
    });
    return { loans: loans, years: years, unavailableReason: null };
  }
  function weakestCoverage(rows, key) {
    var measured = rows.filter(function (row) { return known(row[key]); });
    if (!measured.length) return null;
    var weakest = measured.reduce(function (a, b) { return b[key] < a[key] ? b : a; });
    return { year: weakest.year, ratio: weakest[key] };
  }

  function operatingProjection(result, fields) {
    var otherIncomeBase = result.annualOtherIncome === undefined ? 0 : result.annualOtherIncome;
    if (!result.dscrAutoMode || ![result.annualRents, otherIncomeBase, result.noi, result.annualOpex,
        result.annualRepReserve, result.netPropTax, result.annualDebtService,
        result.totalSoftDebtService, result.exit.rentGrowth, result.exit.expGrowth].every(known) || !result.obligations.years) return null;
    var years = fieldNumber(fields, 'pf-years', 15);
    if (!known(years)) return null;
    var rows = [], cumCF = 0, cumCash = 0;
    // DOH PR 4: the deferred fee is paid from cumulative cash flow. A deficit
    // year pays nothing and is made up first, so the fee is fully paid in the
    // first year cumulative cash reaches it (the exit panel's payback year).
    // Once fully paid, later payments are $0 even where a year is unknown.
    var fee = known(result.deferredDevFee) ? Math.max(0, result.deferredDevFee) : null, feePaid = 0;
    // Cash after the fee first makes up deficits from earlier years (funded by
    // the sponsor); only what is left is distributable.
    var deficit = 0;
    for (var y = 1; y <= 50; y++) {
      var rm = Math.pow(1 + result.exit.rentGrowth, y - 1);
      var em = Math.pow(1 + result.exit.expGrowth, y - 1);
      var rents = result.annualRents * rm, otherIncome = otherIncomeBase * rm;
      var vacancyLoss = (rents + otherIncome) * result.vacancyRate;
      var egi = rents + otherIncome - vacancyLoss, opex = result.annualOpex * em;
      var reserve = result.annualRepReserve * em, tax = result.netPropTax * em;
      var noi = y === 1 ? result.noi : egi - opex - reserve - tax;
      var obligation = result.obligations.years[y - 1];
      var debtService = obligation.mustPayDebtService;
      var cashFlow = obligation.cashFlow;
      cumCF = known(cumCF) && known(cashFlow) ? cumCF + cashFlow : null;
      var mustPayUnpaid = mustPayUnpaidFor(obligation);
      // The fee is paid from cash actually left after the payments made.
      cumCash = known(cumCash) && known(cashFlow) && known(mustPayUnpaid) ? cumCash + cashFlow + mustPayUnpaid : null;
      var feeNow = fee === null ? null : feePaid !== null && feePaid >= fee ? fee
        : known(feePaid) && known(cumCash) ? Math.min(fee, Math.max(feePaid, cumCash)) : null;
      var deferredFeePaid = known(feeNow) && known(feePaid) ? feeNow - feePaid : null;
      feePaid = feeNow;
      // Unpaid must-pay debt service is not a shortfall the sponsor funded.
      var afterFee = known(cashFlow) && known(deferredFeePaid) && known(mustPayUnpaid) ? cashFlow - deferredFeePaid + mustPayUnpaid : null;
      var deficitRecovered = known(afterFee) && known(deficit) ? Math.min(deficit, Math.max(0, afterFee)) : null;
      // A year whose cash cannot cover its payments is funded by the sponsor.
      var deficitFunded = known(afterFee) ? Math.max(0, -afterFee) : null;
      deficit = known(afterFee) && known(deficit) ? Math.max(0, deficit - afterFee) : null;
      var distributable = known(afterFee) && known(deficitRecovered) ? Math.max(0, afterFee - deficitRecovered) : null;
      rows.push({ year: y, grossRents: rents, otherIncome: otherIncome, vacancyLoss: vacancyLoss, egi: egi,
        opex: opex, repReserve: reserve, propTax: tax, noi: noi, debtService: debtService,
        cashFlow: cashFlow, dscr: obligation.allMustPayCoverage, cumCF: cumCF,
        seniorDscr: obligation.seniorCoverage, seniorDebtService: obligation.seniorDebtService,
        maturityDue: obligation.maturityDue, contingentPaid: obligation.contingentPaid,
        bridgeDebtService: obligation.bridgeDebtService, assetMgmtFee: obligation.assetMgmtFee, assetMgmtUnpaid: obligation.assetMgmtUnpaid,
        deferredFeePaid: deferredFeePaid, mustPayUnpaid: mustPayUnpaid, deficitFunded: deficitFunded, deficitRecovered: deficitRecovered, deficitOwed: deficit, distributable: distributable,
        unavailableReason: obligation.unavailableReason });
    }
    return { years: Math.min(50, Math.max(5, Math.round(years))), rows: rows };
  }
  function sliderImpacts(result, fields) {
    var price = fieldNumber(fields, 'dc-stress-equity-price', 0.82);
    var overrun = fieldNumber(fields, 'dc-stress-tdc-overrun', 0) / 100;
    var leaseup = fieldNumber(fields, 'dc-stress-leaseup', 0);
    var equity = known(price) && known(result.annualCredits) ? result.annualCredits * CREDIT_YEARS * price : null;
    var cost = known(overrun) && known(result.tdc) ? result.tdc * (1 + overrun) : null;
    return { baseEquity: result.equity, equity: equity,
      equityDelta: known(equity) && known(result.equity) ? equity - result.equity : null,
      baseTdc: result.tdc, tdc: cost, overrun: known(cost) ? cost - result.tdc : null,
      baseNoi: result.noi, year1Loss: known(result.noi) && known(leaseup) ? result.noi * 0.5 * Math.min(1, leaseup / 12) : null };
  }
  // Federal, state and any counted added credit equity, as the sources count them.
  function creditStackTotal(result) {
    var cs = result.creditStack || { federal: result.equity, state: result.stateEquity, added: 0 };
    return known(cs.federal) && known(cs.state) && known(cs.added) ? cs.federal + cs.state + cs.added : null;
  }
  // What the investor pays in for those credits: their equity plus the investor fees taken from it.
  function investorCapital(result) {
    var total = creditStackTotal(result), fees = result.creditStack ? result.creditStack.investorFees : 0;
    return known(total) && known(fees) ? total + fees : null;
  }
  // The partnership's deal terms, as the waterfall panel enters them. A blank
  // investor equity box means the automatic amount; any other blank or
  // out-of-range term is unknown, so no split is built from it.
  var PARTNERSHIP_LIMITS = { pref: { min: 0, max: 15 }, gpResidual: { min: 0, max: 100 }, lpOpsShare: { min: 0, max: 100 } };
  function partnershipTerms(fields) {
    var raw = fields['dc-wf-lp-equity'];
    var lpEquityOverride = raw === undefined || raw === null || String(raw).trim() === '' ? 0 : parseFloat(raw);
    var pref = fieldNumber(fields, 'dc-wf-pref', 8);
    var gpResidual = fieldNumber(fields, 'dc-wf-gp-residual', 30);
    var lpOpsShare = fieldNumber(fields, 'dc-wf-lp-ops-share', 99.99);
    // An omitted choice takes its default; an explicitly blank one is unknown.
    var catchup = fields['dc-wf-catchup'] === undefined ? 'none' : fields['dc-wf-catchup'];
    var exit = fields['dc-wf-exit'] === undefined ? 'sale' : fields['dc-wf-exit'];
    var buyoutRaw = fields['dc-wf-buyout'];
    var buyoutPrice = buyoutRaw === undefined || buyoutRaw === null || String(buyoutRaw).trim() === '' ? NaN : parseFloat(buyoutRaw);
    var within = function (v, l) { return known(v) && v >= l.min && v <= l.max; };
    var reason = !known(lpEquityOverride) || lpEquityOverride < 0 ? 'Enter the investor equity as a positive amount, or leave it blank for the automatic amount.'
      : !within(pref, PARTNERSHIP_LIMITS.pref) ? 'Enter an investor preferred return from 0% to 15%.'
      : !within(gpResidual, PARTNERSHIP_LIMITS.gpResidual) ? 'Enter a sponsor residual share from 0% to 100%.'
      : !within(lpOpsShare, PARTNERSHIP_LIMITS.lpOpsShare) ? 'Enter the investor\'s share of operating cash from 0% to 100%.'
      : catchup !== 'none' && catchup !== 'full' ? 'Choose whether the sponsor gets a catch-up.'
      : exit !== 'sale' && exit !== 'buyout' ? 'Choose how the investor exits.'
      : exit === 'buyout' && (!known(buyoutPrice) || buyoutPrice < 0) ? 'Enter the price the sponsor pays for the investor\'s interest.'
      : null;
    // A rejected term is published as unknown, never as the number typed.
    var okEquity = known(lpEquityOverride) && lpEquityOverride >= 0;
    var okExit = exit === 'sale' || exit === 'buyout';
    return { lpEquityOverride: okEquity ? lpEquityOverride : null,
      prefRate: within(pref, PARTNERSHIP_LIMITS.pref) ? pref / 100 : null,
      gpResidualPct: within(gpResidual, PARTNERSHIP_LIMITS.gpResidual) ? gpResidual / 100 : null,
      lpOpsShare: within(lpOpsShare, PARTNERSHIP_LIMITS.lpOpsShare) ? lpOpsShare / 100 : null,
      catchup: catchup === 'none' || catchup === 'full' ? catchup : null, exit: okExit ? exit : null,
      buyoutPrice: exit === 'buyout' && known(buyoutPrice) && buyoutPrice >= 0 ? buyoutPrice : null, reason: reason };
  }
  // Internal rate of return by Newton's method on the NPV polynomial; NaN when
  // the flows never change sign or the search does not settle.
  function irrOf(flows) {
    if (!flows.every(known) || !flows.some(function (f) { return f > 0; }) || !flows.some(function (f) { return f < 0; })) return NaN;
    var r = 0.10;
    for (var iter = 0; iter < 100; iter++) {
      var npv = 0, dnpv = 0;
      for (var t = 0; t < flows.length; t++) {
        npv += flows[t] / Math.pow(1 + r, t);
        if (t > 0) dnpv -= t * flows[t] / Math.pow(1 + r, t + 1);
      }
      if (Math.abs(dnpv) < 1e-10) break;
      var step = npv / dnpv;
      r -= step;
      if (r < -0.99) r = -0.99;
      if (r > 5) r = 5;
      if (Math.abs(step) < 1e-9) break;
    }
    var check = flows.reduce(function (a, f, t) { return a + f / Math.pow(1 + r, t); }, 0);
    return Math.abs(check) < 1 ? r : NaN;
  }
  function capitalWaterfall(result, fields) {
    // The investor buys the credits, so the automatic LP amount is what it pays in for them.
    var autoLpEquity = investorCapital(result);
    if (!result.projection || ![result.exit.resale, result.exit.firstMortBal, result.exit.softBal,
        result.exit.assetMgmtOwed, autoLpEquity, result.deferredDevFee].every(known)) return null;
    var exit = { resale: result.exit.resale, mortBal: result.exit.firstMortBal, softBal: result.exit.softBal,
      hold: result.exit.holdYears, defFeeRemaining: null };
    // The sale pays only the deferred fee operations left unpaid by the exit year.
    var feePaidInHold = result.projection.rows.slice(0, exit.hold).reduce(function (a, row) {
      return known(a) && known(row.deferredFeePaid) ? a + row.deferredFeePaid : null; }, 0);
    if (!known(feePaidInHold)) return null;
    exit.defFeeRemaining = Math.max(0, result.deferredDevFee - feePaidInHold);
    var terms = partnershipTerms(fields);
    if (terms.reason) return null;
    var lpEquityOverride = terms.lpEquityOverride;
    var lpEquity = lpEquityOverride > 0 ? lpEquityOverride : autoLpEquity;
    var prefRate = terms.prefRate;
    var gpResidualPct = terms.gpResidualPct;
    var lpResidualPct = 1 - gpResidualPct;
    var catchupMode = terms.catchup;
    var hold = exit.hold;

    var tiers = [];
    var grossProceeds = exit.resale;
    var remaining = grossProceeds;

    // Tier 1: Hard debt payoff (1st mortgage)
    var tier1 = Math.min(remaining, exit.mortBal);
    tiers.push({ name: '1. Hard debt payoff (1st mortgage)', amount: tier1, recipient: 'Lender' });
    remaining -= tier1;

    // Tier 2: Soft debt payoff (by F194 priority order)
    var tier2 = Math.min(remaining, exit.softBal);
    tiers.push({ name: '2. Soft debt payoff (priority order)', amount: tier2, recipient: 'Soft lenders' });
    remaining -= tier2;

    // An asset management fee operations could not pay is settled before the
    // developer and the investors are paid (shown only when one is owed).
    if (result.exit.assetMgmtOwed > 0) {
      var tierAsset = Math.min(remaining, result.exit.assetMgmtOwed);
      tiers.push({ name: '2b. Accrued asset management fee', amount: tierAsset, recipient: 'Asset manager' });
      remaining -= tierAsset;
    }

    // Operating deficits the sponsor funded and cash flow has not yet made up
    // are repaid next (shown only when one is outstanding at the sale).
    var deficitOwed = result.projection.rows[hold - 1] ? result.projection.rows[hold - 1].deficitOwed : null;
    if (!known(deficitOwed)) return null;
    var tierDeficit = 0;
    if (deficitOwed > 0) {
      tierDeficit = Math.min(remaining, deficitOwed);
      tiers.push({ name: '2c. Operating deficits funded by the sponsor', amount: tierDeficit, recipient: 'Sponsor (GP)' });
      remaining -= tierDeficit;
    }

    // Tier 3: Deferred dev fee remaining balance
    var tier3 = Math.min(remaining, exit.defFeeRemaining);
    tiers.push({ name: '3. Deferred developer fee', amount: tier3, recipient: 'Developer (GP)' });
    remaining -= tier3;

    // Investor buyout: the sponsor buys the investor's interest for the price
    // the partnership agreement sets (often near the investor's exit taxes under
    // a section 42(i)(7) right of first refusal) and keeps the rest of the value.
    // The preferred return, catch-up and residual split do not apply.
    if (terms.exit === 'buyout') {
      // The investor gets the full agreed price; when the value left is less,
      // the sponsor pays the difference from its own funds.
      var buyoutPaid = terms.buyoutPrice;
      tiers.push({ name: '4. Investor buyout price', amount: buyoutPaid, recipient: 'LP investor' });
      var kept = remaining - buyoutPaid;
      tiers.push(kept >= 0
        ? { name: '5. Value the sponsor keeps after the buyout', amount: kept, recipient: 'GP sponsor' }
        : { name: '5. Sponsor pays the buyout shortfall from its own funds', amount: kept, recipient: 'GP sponsor' });
      remaining = 0;
      return {
        tiers: tiers, grossProceeds: grossProceeds, remaining: remaining,
        lpEquity: lpEquity, lpTotal: buyoutPaid, gpTotal: tierDeficit + tier3 + kept,
        lpCashIrr: lpEquity > 0 ? Math.pow(buyoutPaid / lpEquity, 1 / hold) - 1 : NaN,
        lpMultiple: lpEquity > 0 ? buyoutPaid / lpEquity : NaN,
        gpMultiple: exit.defFeeRemaining > 0 ? (tier3 + kept) / exit.defFeeRemaining : NaN,
        prefRate: prefRate, hold: hold, gpResidualPct: gpResidualPct,
        autoLpEquity: autoLpEquity, annualCredits: result.annualCredits,
        terms: terms, inputs: exit
      };
    }

    // Tier 4: LP return of capital + cumulative preferred return
    // Pref accrues compound annually on outstanding LP capital. If
    // ops distributions paid the pref each year, accrued = 0 at exit
    // (we model that as ops-CF-paid pref since waterfall sees gross resale).
    // Conservative: model UNPAID pref as compound on full LP capital
    // across the hold period (zero ops distributions to LP for pref).
    // This is the standard "accrued-pref" assumption in LIHTC closings.
    var lpAccruedPref = lpEquity * (Math.pow(1 + prefRate, hold) - 1);
    var tier4a = Math.min(remaining, lpEquity);         // return of capital
    remaining -= tier4a;
    var tier4b = Math.min(remaining, lpAccruedPref);    // cumulative pref
    remaining -= tier4b;
    tiers.push({ name: '4a. LP return of capital', amount: tier4a, recipient: 'LP investor' });
    tiers.push({ name: '4b. LP preferred return (' + (prefRate * 100).toFixed(1) + '% accrued × ' + hold + 'y)', amount: tier4b, recipient: 'LP investor' });

    // Tier 5: GP catch-up (if enabled)
    // Catch-up math: solve for X such that GP cumulative (catch-up + post-residual)
    // equals gpResidualPct of (LP pref paid + catch-up + post-residual).
    // Simplified: GP catch-up = gpResidualPct / lpResidualPct * (LP pref paid).
    // This makes GP whole on the agreed split for the cumulative pref tier.
    var tier5 = 0;
    if (catchupMode === 'full' && tier4b > 0 && lpResidualPct > 0) {
      var catchupTarget = (gpResidualPct / lpResidualPct) * tier4b;
      tier5 = Math.min(remaining, catchupTarget);
      remaining -= tier5;
    }
    tiers.push({ name: '5. GP catch-up' + (catchupMode === 'full' ? ' (100% until balanced)' : ' (none — LP keeps gross pref)'), amount: tier5, recipient: 'GP sponsor' });

    // Tier 6: Residual split per gpResidualPct / lpResidualPct
    var tier6gp = remaining * gpResidualPct;
    var tier6lp = remaining * lpResidualPct;
    tiers.push({ name: '6a. Residual split — GP (' + (gpResidualPct * 100).toFixed(0) + '%)', amount: tier6gp, recipient: 'GP sponsor' });
    tiers.push({ name: '6b. Residual split — LP (' + (lpResidualPct * 100).toFixed(0) + '%)', amount: tier6lp, recipient: 'LP investor' });

    // Totals by party
    var lpTotal = tier4a + tier4b + tier6lp;
    var gpTotal = tierDeficit + tier3 + tier5 + tier6gp;  // deficits + dev fee + catch-up + residual

    // LP IRR — simplified: LP put in lpEquity at year 0, got back lpTotal at year hold
    // (ignoring tax credits — those are the LP's primary return, not modeled here)
    var lpCashIrr = lpEquity > 0 ? Math.pow(lpTotal / lpEquity, 1 / hold) - 1 : NaN;
    var lpMultiple = lpEquity > 0 ? lpTotal / lpEquity : NaN;
    // A repaid operating deficit returns the sponsor's own advance; it is not
    // return on the deferred fee, so the multiple leaves it out.
    var gpMultiple = exit.defFeeRemaining > 0 ? (gpTotal - tierDeficit) / exit.defFeeRemaining : NaN;

    return {
      tiers: tiers, grossProceeds: grossProceeds, remaining: remaining,
      lpEquity: lpEquity, lpTotal: lpTotal, gpTotal: gpTotal,
      lpCashIrr: lpCashIrr, lpMultiple: lpMultiple, gpMultiple: gpMultiple,
      prefRate: prefRate, hold: hold, gpResidualPct: gpResidualPct,
      autoLpEquity: autoLpEquity, annualCredits: result.annualCredits,
      terms: terms, inputs: exit
    };
  }

  function computeDeal(inputs) {
    var fields = inputs.fields;
    function safeVal(id) { return parseFloat(fields[id]); }
    var _resolvedDealMix = inputs.resolvedDealMix;
    var scheduleMode = _resolvedDealMix.available;
    var _amiLimits = inputs.amiLimits;
    var _amiLimitsByBr = inputs.amiLimitsByBr;
    var _countyFips = inputs.countyFips;
    var _creditRate = inputs.creditRate;
    var _constants = inputs.constants;
    var _utilityAllowance = inputs.utilityAllowance;
    function vacFrac() {
      if (scheduleMode) return _resolvedDealMix.vacancyRate;
      var v = safeVal('dc-vacancy');
      return (Number.isFinite(v) ? v : 7) / 100;
    }
    var tdc = safeVal('dc-tdc') || 0;
    var units = scheduleMode ? _resolvedDealMix.totalUnits : safeVal('dc-units') || 0;
    var equityPrice = safeVal('dc-equity-price');
    if (!isFinite(equityPrice) || equityPrice <= 0) equityPrice = inputs.equityPriceDefault;
    // G — Multi-tranche soft debt. Aggregate across the tranche list:
    //   grants  → subtract from basis (§42(d)(5)(A)) AND fill gap at closing
    //   loans   → contribute at closing; repayment follows their stated obligation
    // Tranches read from the renderSoftTranches() state (passed in by the caller).
    var tranches = inputs.tranches;
    var totalGrant = 0;
    var totalLoanPrincipal = 0;
    var totalSoftDebtService = 0;
    var trancheBreakdown = [];   // for sources/uses rendering
    var loanInputs = [], loanInputsReason = null;
    tranches.forEach(function (t) {
      var amt = loanNumber(t.amount);
      if (amt === 0) return; // An explicitly empty source contributes no dollars.
      if (!known(amt) || amt < 0) { loanInputsReason = 'Enter a non-negative soft-funding amount.'; totalLoanPrincipal = NaN; return; }
      if (t.mode === 'grant') {
        totalGrant += amt;
        trancheBreakdown.push({ id: t.id, program: t.program, mode: 'grant', amount: amt, debtService: 0 });
      } else {
        totalLoanPrincipal += amt;
        loanInputs.push(t);
        var parsed = loanTerms(t);
        if (parsed.unavailableReason) loanInputsReason = parsed.unavailableReason;
        var ds = parsed.unavailableReason ? NaN : regularLoanPayment(parsed.loan, 1);
        totalSoftDebtService += ds;
        trancheBreakdown.push({ id: t.id, program: t.program, mode: 'loan', amount: amt,
          debtService: ds, rate: parsed.loan.rate, term: parsed.loan.amortization,
          loanType: parsed.loan.type, maturity: parsed.loan.maturity, priority: parsed.loan.priority });
      }
    });
    // Backward-compat aliases for the rest of the calc path.
    var impactGrant = totalGrant;
    var impactDebtService = totalSoftDebtService;
    var impactMode = totalGrant > 0 ? 'grant' : 'loan';

    // Rent income — sum checked AMI-tier units. Track designated units by
    // tier so the elected minimum set-aside can determine qualified units.
    // The default 40-60 election preserves the pre-election applicable-
    // fraction calculation for mixed-income deals.
    var annualRents = 0;
    var amiUnitSum = 0;
    var minimumSetAsideElection = inputs.minimumSetAsideElection;
    var designatedUnitsByPct = {};
    // Missing ceilings block revenue; market mode uses the existing ZORI/FMR
    // bedroom estimates rather than inventing an income-based restriction.
    var marketRegime = inputs.regime === 'market';
    var chfaRegime = inputs.regime === 'chfa_lihtc';
    var allowanceRevenueReason = null;
    var rentInputsMissing = false;
    var capOn = !scheduleMode && !marketRegime && !!fields['dc-achievable-cap'];
    var perBrMarket = ((capOn || marketRegime) && _countyFips) ? inputs.perBrMarket : null;
    function tierRent(tier, br) {
      var value = marketRegime ? perBrMarket && perBrMarket[br]
        : _amiLimitsByBr ? _amiLimitsByBr[tier] && _amiLimitsByBr[tier][br]
        : _amiLimits && _amiLimits[tier];
      if (typeof value !== 'number' || !isFinite(value)) { rentInputsMissing = true; return NaN; }
      if (_utilityAllowance.applied) {
        var bedrooms = RENT_BEDROOMS[br];
        var contract = rentLimits.maxContractRent({ grossRent: value,
          utilityAllowance: _utilityAllowance.perBedroom[bedrooms], fees: _utilityAllowance.feesPerBedroom[bedrooms],
          basisStatus: { complete: _utilityAllowance.applied, unavailableReason: _utilityAllowance.reason } });
        if (contract.contractRent == null) {
          allowanceRevenueReason = contract.unavailableReason;
          rentInputsMissing = true;
          return NaN;
        }
        value = contract.contractRent;
      }
      return value;
    }
    var pricedRows = [];
    var gridBedrooms = { studio: 0, '1br': 0, '2br': 0, '3br': 0, '4br': 0 };
    var manualMarket = { rows: [], unavailableReason: null, message: null, source: null };
    var capBindings = [];   // tiers where the cap actually reduced revenue
    function _nonNegInt(v) {
      var n = parseInt(v, 10);
      return isFinite(n) && n > 0 ? n : 0;
    }
    function _tierSplitCounts(pct) {
      var out = { total: 0 };
      SPLIT_BR_TYPES.forEach(function (b) { out[b] = 0; });
      SPLIT_BR_TYPES.forEach(function (br) {
        var n = _nonNegInt(fields['dc-units-' + pct + '-' + br]);
        out[br] = n;
        out.total += n;
      });
      return out;
    }
    if (scheduleMode) {
      _resolvedDealMix.restrictedRows.forEach(function (r) {
        annualRents += r.contractRent * r.units * 12;
        amiUnitSum += r.units;
        if (isLihtcCreditEligiblePct(r.tier, minimumSetAsideElection)) {
          designatedUnitsByPct[r.tier] = (designatedUnitsByPct[r.tier] || 0) + r.units;
        }
        pricedRows.push(Object.assign({}, r));
      });
      _resolvedDealMix.marketRows.forEach(function (r) {
        annualRents += r.rent * r.units * 12;
        amiUnitSum += r.units;
        pricedRows.push(Object.assign({ tier: 'market' }, r));
      });
    } else DEAL_AMI_BANDS.forEach(function (pct) {
      if (Object.prototype.hasOwnProperty.call(fields, 'dc-chk-' + pct) &&
          Object.prototype.hasOwnProperty.call(fields, 'dc-units-' + pct)) {
        var split = _tierSplitCounts(pct);
        var hasSplit = split.total > 0;
        var u = hasSplit ? split.total : _nonNegInt(fields['dc-units-' + pct]);
        var br = fields['dc-br-' + pct] || '2br';
        if (hasSplit) SPLIT_BR_TYPES.forEach(function (key) { gridBedrooms[key] += split[key]; });
        else gridBedrooms[br] += u;
        if (fields['dc-chk-' + pct]) {
          if (hasSplit) {
            SPLIT_BR_TYPES.forEach(function (splitBr) {
              var splitUnits = split[splitBr];
              if (!splitUnits) return;
              var splitRent = tierRent(pct, splitBr);
              if (capOn && perBrMarket && pct >= 70) {
                var splitMkt = perBrMarket[splitBr];
                if (typeof splitMkt === 'number' && splitMkt > 0 && splitMkt < splitRent) {
                  capBindings.push({ pct: pct, br: splitBr, ceiling: splitRent, market: splitMkt, units: splitUnits });
                  splitRent = splitMkt;
                }
              }
              annualRents += splitUnits * splitRent * 12;
              pricedRows.push({ tier: pct, bedrooms: RENT_BEDROOMS[splitBr], units: splitUnits,
                contractRent: isFinite(splitRent) ? splitRent : null });
            });
          } else {
            var perUnitRent = u > 0 ? tierRent(pct, br) : 0;
            // Q5: apply market-rent cap only to workforce tiers (pct ≥ 70)
            if (capOn && perBrMarket && pct >= 70) {
              var mkt = perBrMarket[br];
              if (typeof mkt === 'number' && mkt > 0 && mkt < perUnitRent) {
                capBindings.push({ pct: pct, br: br, ceiling: perUnitRent, market: mkt, units: u });
                perUnitRent = mkt;
              }
            }
            annualRents += u * perUnitRent * 12;
            if (u > 0) pricedRows.push({ tier: pct, bedrooms: RENT_BEDROOMS[br], units: u,
              contractRent: isFinite(perUnitRent) ? perUnitRent : null });
          }
        }
        amiUnitSum += u; // count all tier units regardless of checkbox
        if (fields['dc-chk-' + pct] && chfaRegime) {
          designatedUnitsByPct[pct] = u;
        }
      }
    });

    if (!scheduleMode) {
      manualMarket = priceManualMarket(Math.max(0, units - amiUnitSum), gridBedrooms, inputs.manualMarket);
      manualMarket.rows.forEach(function (row) {
        if (row.rent == null) { rentInputsMissing = true; annualRents = NaN; }
        else annualRents += row.rent * row.units * 12;
        pricedRows.push(row);
      });
    }

    // Prop 123 programs that limit the project average set no per-unit cap, so
    // every tier prices; the restricted mix as a whole must still qualify.
    var prop123Average = null;
    if (inputs.regime === 'prop123' && inputs.prop123) {
      prop123Average = rentLimits.prop123ProjectAverage(Object.assign({}, inputs.prop123, { fips: _countyFips,
        units: pricedRows.filter(function (r) { return typeof r.tier === 'number'; })
          .map(function (r) { return { tier: r.tier, units: r.units }; }) }));
      if (prop123Average.exceeds) { rentInputsMissing = true; annualRents = NaN; }
    }

    var minimumSetAsideResult = evaluateMinimumSetAside(minimumSetAsideElection, units, designatedUnitsByPct);
    var lihtcUnits = minimumSetAsideResult.countedLihtcUnits;
    // Applicable fraction (IRC §42(c)(1)(B)): for mixed-income deals
    // qualified basis = eligible basis × min(unit fraction, floor-area fraction).
    // We don't track floor area separately, so use the unit fraction.
    // For pure-LIHTC deals (no market units), this is 1.0.
    // #2160: itemized costs set eligible basis. Federally funded grants reduce
    // it (§42(d)(5)(A)), the 30% boost needs a designation and its evidence,
    // the applicable fraction is the lower of the unit and floor-space
    // fractions, and CHFA's per-project limit caps the credit capacity.
    var cbm = costBasisModule();
    var costRules = inputs.costRules || null;
    var creditType = _creditRate < 0.05 ? '4' : '9';
    var costSummary = cbm.summarizeCosts(inputs.costLines || [], tdc);
    var grantTreatment = cbm.grantBasisReduction(tranches, costRules);
    // CHFA's fee limits apply in calculating credit: the part of an over-limit
    // fee that sits in basis comes out of eligible basis (QAP 3.M.3).
    var contractorFee = cbm.contractorFeeTest({ byId: costSummary.byId, units: units,
      identityOfInterest: !!fields['dc-ioi'], rules: costRules });
    var feeBase = cbm.developerFeeBase(costSummary, contractorFee, !!fields['dc-special-pop']);
    var developerFee = cbm.developerFeeTest({ developerFee: costSummary.reason ? null : costSummary.byId.developer_fee,
      consultantFee: costSummary.reason ? null : costSummary.byId.consultant_fee, base: feeBase.base,
      baseReason: feeBase.reason, units: units, rules: costRules });
    var feeExcess = cbm.feeExcessInBasis(costSummary, contractorFee, developerFee);
    var basisArgs = { eligibleCost: costSummary.eligible, costReason: costSummary.reason,
      acquisitionEligible: costSummary.acquisitionEligible, acquisitionQualifies: !!fields['dc-acq-42d2'], grantReduction: grantTreatment.reduction,
      grantOnAcquisition: fields['dc-grant-acq'], grantOutsideBasis: fields['dc-grant-outside'], ineligibleCost: costSummary.ineligible,
      grantReason: grantTreatment.reason, designation: fields['dc-boost-designation'], evidence: fields['dc-boost-evidence'],
      awardedBoostPct: fields['dc-boost-pct'],
      creditType: creditType, creditRate: _creditRate, units: units, lowIncomeUnits: lihtcUnits,
      residentialSf: fields['dc-res-sf'], lowIncomeSf: fields['dc-restricted-sf'],
      requested: fields['dc-credit-requested'], awarded: fields['dc-credit-awarded'], feeExcess: feeExcess.total, feeReason: feeExcess.reason, rules: costRules };
    var basis = cbm.basisAndCredit(basisArgs);
    var basisUnknownReason = null;
    // Outside CHFA LIHTC there is no basis or credit, so nothing about them is unknown.
    if (chfaRegime) ['eligibleBasis', 'afterGrant', 'applicableFraction', 'acquisitionRate', 'requested', 'awarded'].forEach(function (key) {
      if (!basisUnknownReason && basis.reasons[key] && (key !== 'requested' && key !== 'awarded' || basis.creditForEquity === null)) basisUnknownReason = basis.reasons[key];
    });
    var applicableFraction = basis.applicableFraction === null ? NaN : basis.applicableFraction;
    var eligibleBasisRaw = basis.boostedBasis === null ? NaN : basis.boostedBasis;
    var eligibleBasis    = basis.qualifiedBasis === null ? NaN : basis.qualifiedBasis;
    var annualCredits    = !chfaRegime ? 0 : basis.creditForEquity === null ? NaN : basis.creditForEquity;
    var equity           = annualCredits * CREDIT_YEARS * equityPrice;
    var stateCredit = cbm.stateCredit({ annual: fields['dc-state-annual'], standardAnnual: fields['dc-state-standard-annual'],
      price: fields['dc-state-price'], fees: fields['dc-state-fees'], awarded: !!fields['dc-state-awarded'], creditType: creditType, path: fields['dc-state-path'] || null, units: units, rules: costRules });
    // No state credit entered is no source; an incomplete one is unknown.
    // The state credit pairs with the federal credit, so outside CHFA LIHTC it is no source either.
    var stateCreditApplies = chfaRegime && stateCredit.entered;
    var stateEquity = !stateCreditApplies ? 0 : stateCredit.equity === null ? NaN : stateCredit.equity;
    if (stateCreditApplies && stateCredit.equity === null && !basisUnknownReason) basisUnknownReason = stateCredit.reason;

    // The applicable-fraction note was rendered before the legacy block.
    // Retain that value separately so even the invalid-mix display is unchanged.
    var basisForApplicableFractionNote = eligibleBasis;
    var unitMixError = false;
    if (inputs.hasUnitMixWarning && units > 0 && amiUnitSum > units) unitMixError = true;
    if (unitMixError) {
      annualRents = NaN;
      eligibleBasis = NaN;
      annualCredits = NaN;
      equity = NaN;
    }
    if (!scheduleMode && !_amiLimits && !_amiLimitsByBr) {
      annualRents = NaN;
    }

    // Developer fee comes from the itemized developer-fee line (#2160).
    var devFeeTotal = costSummary.reason ? NaN : (costSummary.byId.developer_fee || 0);
    var devfeePct = tdc > 0 ? devFeeTotal / tdc : NaN;
    // An entered 0% is a real choice; only a blank slider falls back to its 40% starting value.
    var deferredPctRaw = safeVal('dc-deferred-pct');
    var deferredPctSlider = (known(deferredPctRaw) && deferredPctRaw >= 0 ? deferredPctRaw : 40) / 100;

    // H — Auto-balance deferred developer fee. When the user toggles
    // "Auto-balance gap with deferred dev fee," any remaining gap after
    // equity + mortgage + grants + soft-loan principal gets backfilled by
    // deferring up to the slider cap of the developer fee. Mirrors the
    // Anthracite $185k pattern where deferred fee is the last-resort
    // balancing source.
    var autoBalance = !!fields['dc-deferred-auto-balance'];
    var deferredDevFeeManual = devFeeTotal * deferredPctSlider;
    var deferredDevFee = deferredDevFeeManual;

    // Auto-NOI or manual NOI
    var autoNoi = !!fields['dc-auto-noi'];
    var noi;
    var annualOpex = null;
    var annualRepReserve = null;
    var netPropTax = null;
    var taxSavings = 0;
    var operatingInputsReason = null;
    // DOH's operating budget lines (js/deal-operating-budget.js), per unit per
    // year. Callers that pass no lines use the single dc-opex figure, per unit
    // per month, as before.
    var operatingSummary = null;
    var otherIncomePerUnitYear = 0;
    var annualOtherIncome = 0;
    if (inputs.operatingLines) {
      var obm = operatingBudgetModule();
      operatingSummary = obm.summarizeOperating(inputs.operatingLines, inputs.otherIncomeLines || []);
      // Other income is resolved in both NOI modes, so the sensitivity and the
      // export carry it even when NOI itself is entered by hand.
      // A budget with a reason has no measured other income: null, never $0.
      otherIncomePerUnitYear = operatingSummary.reason ? null : operatingSummary.otherIncomePerUnitYear;
    }
    // No units means no operating budget: unknown, never 60 units' worth.
    var opUnits = units > 0 ? units : NaN;
    annualOtherIncome = otherIncomePerUnitYear == null ? null : otherIncomePerUnitYear * opUnits;
    // Arithmetic reads NaN for an unknown, so nothing built on it is a number.
    var otherIncomeForMath = annualOtherIncome == null ? NaN : annualOtherIncome;
    if (autoNoi) {
      var vacancyPct = vacFrac();
      // Entered zero is valid; a cleared operating line is unmeasured.
      var opexPerUnitMonth = operatingSummary ? (operatingSummary.reason ? NaN : operatingSummary.perUnitMonth) : safeVal('dc-opex');
      var repReservePerUnit = safeVal('dc-rep-reserve');
      var propTaxPerUnit = safeVal('dc-prop-tax');
      if (!known(opexPerUnitMonth) || opexPerUnitMonth < 0) {
        opexPerUnitMonth = NaN;
        operatingInputsReason = operatingSummary && operatingSummary.reason ? operatingSummary.reason : 'Enter operating cost per unit per month.';
      } else if (!known(repReservePerUnit) || repReservePerUnit < 0) {
        repReservePerUnit = NaN;
        operatingInputsReason = 'Enter the annual replacement reserve per unit.';
      } else if (!known(propTaxPerUnit) || propTaxPerUnit < 0) {
        propTaxPerUnit = NaN;
        operatingInputsReason = 'Enter the annual property tax per unit.';
      }
      // DOH applies vacancy to rent plus other income.
      var effectiveGrossIncome = (annualRents + otherIncomeForMath) * (1 - vacancyPct);
      annualOpex = opexPerUnitMonth * 12 * opUnits;
      annualRepReserve = repReservePerUnit * opUnits;
      var taxExemptPct = (safeVal('dc-tax-exempt') || 0) / 100;
      var annualPropTax = propTaxPerUnit * opUnits;
      taxSavings = annualPropTax * taxExemptPct;
      netPropTax = annualPropTax - taxSavings;
      noi = effectiveGrossIncome - annualOpex - annualRepReserve - netPropTax;
    } else {
      // A blank NOI field is an unknown NOI, not $0 of it.
      noi = safeVal('dc-noi');
    }

    // Senior sizing reserves the target coverage capacity for must-pay soft debt.
    // Entered mode keeps the entered principal and reports the resulting coverage.
    var dcr = safeVal('dc-dcr'), interestRate = safeVal('dc-rate'), term = safeVal('dc-term');
    var debtInputsReason = !known(dcr) || dcr < 1.05 || dcr > 2
      ? 'DSCR target is out of range; enter 1.05 to 2.00.'
      : !known(interestRate) || interestRate < 3 || interestRate > 12
        ? 'Senior interest rate is out of range; enter 3% to 12%.'
        : !Number.isInteger(term) || term < 1 || term > 50 ? 'Enter senior amortization from 1 to 50 whole years.' : loanInputsReason;
    var seniorMode = fields['dc-senior-mode'] === undefined ? 'sized' : fields['dc-senior-mode'];
    var seniorInput = { id: 'senior', program: 'Senior mortgage', senior: true, amount: 1,
      rate: interestRate, term: term,
      loanType: fields['dc-senior-type'] === undefined ? 'amortizing' : fields['dc-senior-type'],
      maturity: fields['dc-senior-maturity'] === undefined ? term : loanNumber(fields['dc-senior-maturity']),
      ioYears: fields['dc-senior-io-years'] === undefined ? 0 : loanNumber(fields['dc-senior-io-years']),
      priority: fields['dc-senior-priority'] === undefined ? 1 : loanNumber(fields['dc-senior-priority']),
      cashflowPayPct: fields['dc-senior-cfpay'] === undefined ? 100 : loanNumber(fields['dc-senior-cfpay']) };
    var seniorTerms = loanTerms(seniorInput);
    debtInputsReason = debtInputsReason || seniorTerms.unavailableReason;
    var mc = debtInputsReason ? NaN : mortgageConstant(interestRate / 100, term);
    // Annual payment per $1 of senior principal at a given rate, under the
    // selected repayment type. Sizing and the rate stress both use it, so a
    // stressed interest-only loan stays interest-only.
    function seniorPaymentConstant(ratePct) {
      var unit = Object.assign({}, seniorTerms.loan, { amount: 1, rate: ratePct });
      return Math.max(regularLoanPayment(unit, 1), regularLoanPayment(unit, unit.ioYears + 1));
    }
    var sizingConstant = debtInputsReason ? NaN : seniorPaymentConstant(interestRate);
    var enteredPrincipal = loanNumber(fields['dc-senior-amount']);
    if (seniorMode !== 'sized' && seniorMode !== 'entered') debtInputsReason = 'Choose senior sizing or entered amount.';
    if (seniorMode === 'entered' && (!known(enteredPrincipal) || enteredPrincipal < 0)) debtInputsReason = 'Enter a non-negative senior loan amount.';
    if (seniorMode === 'sized' && !(sizingConstant > 0)) debtInputsReason = debtInputsReason || 'This senior repayment type requires an entered amount.';
    var mortgage = debtInputsReason ? NaN : seniorMode === 'entered' ? enteredPrincipal
      : !known(noi) ? NaN : Math.max(0, noi / dcr - totalSoftDebtService) / sizingConstant;
    seniorInput.amount = mortgage;
    var rentGrowthForLoans = growthRate(fields, 'pf-rent-growth', 2);
    var expenseGrowthForLoans = growthRate(fields, 'pf-exp-growth', 3);
    var loanNoi = Array.from({ length: 50 }, function (_, index) {
      if (index === 0) return noi;
      return autoNoi && [annualRents, annualOpex, annualRepReserve, netPropTax, rentGrowthForLoans, expenseGrowthForLoans].every(known)
        ? (annualRents + otherIncomeForMath) * Math.pow(1 + rentGrowthForLoans, index) * (1 - vacFrac())
          - (annualOpex + annualRepReserve + netPropTax) * Math.pow(1 + expenseGrowthForLoans, index) : null;
    });
    // DOH PR 4: payments from cash flow that are not loans in the stack. Both
    // default to $0; a blank or out-of-range entry is unknown, not $0.
    var cashPayments = (function () {
      var fee = fieldNumber(fields, 'dc-asset-mgmt-fee', 0), growth = fieldNumber(fields, 'dc-asset-mgmt-growth', 3);
      var bridge = fieldNumber(fields, 'dc-bridge-ds', 0), bridgeYears = fieldNumber(fields, 'dc-bridge-years', 0);
      var reason = !known(fee) || fee < 0 ? 'Enter the asset management fee as $0 or more a year.'
        : !known(growth) || growth < 0 || growth > 10 ? 'Enter the asset management fee increase from 0% to 10% a year.'
        : !known(bridge) || bridge < 0 ? 'Enter bridge-loan debt service as $0 or more a year.'
        : !Number.isInteger(bridgeYears) || bridgeYears < 0 || bridgeYears > 50 ? 'Enter the years of bridge-loan payments as a whole number from 0 to 50.' : null;
      return { reason: reason, years: reason ? null : loanNoi.map(function (_, index) {
        return { assetFee: fee * Math.pow(1 + growth / 100, index), bridge: index < bridgeYears ? bridge : 0 };
      }) };
    })();
    var obligations = debtInputsReason ? { loans: null, years: null, unavailableReason: debtInputsReason }
      : cashPayments.reason ? { loans: null, years: null, unavailableReason: cashPayments.reason }
      : loanObligations([seniorInput].concat(loanInputs), loanNoi, cashPayments.years);
    var firstLoanYear = obligations.years && obligations.years[0];
    var allMustPayDebtService = firstLoanYear ? firstLoanYear.mustPayDebtService : null;
    // Why NOI or the rent roll is unknown, carried with it so each message
    // names the fix that applies rather than assuming there is no county.
    var rentDataReason = (prop123Average && prop123Average.exceeds
      ? 'The income-restricted units average ' + prop123Average.averageAmiPct + '% AMI; ' + prop123Average.programName +
        ' allows a project average of at most ' + prop123Average.maxAmiPct + '% AMI. Move units to lower tiers to price this mix.'
      : null) || manualMarket.message || (allowanceRevenueReason ? rentLimits.unavailableMessage(allowanceRevenueReason)
      : !_countyFips ? 'Select a county to load AMI rent limits.'
      : marketRegime ? 'Market rent data is unavailable for the selected bedrooms.'
      : 'Rent limits are unavailable for one or more selected tiers or bedrooms.');
    var noiUnknownReason = null;
    if (operatingInputsReason) {
      noiUnknownReason = operatingInputsReason;
    } else if (!(autoNoi) && !isFinite(noi)) {
      noiUnknownReason = 'Enter NOI, or turn on auto-compute.';
    } else if (unitMixError) {
      noiUnknownReason = 'Fix the unit mix: the AMI-tier units do not add up to Total Units.';
    } else if ((!scheduleMode && !_amiLimits && !_amiLimitsByBr) || rentInputsMissing) {
      noiUnknownReason = rentDataReason;
    }
    var rentsUnknownReason = unitMixError
      ? 'Fix the unit mix: the AMI-tier units do not add up to Total Units.'
      : ((!scheduleMode && !_amiLimits && !_amiLimitsByBr) || rentInputsMissing) ? rentDataReason
      : !(annualRents > 0) ? 'Add units to at least one AMI tier.'
      : null;

    // Cap rate and break-even occupancy
    var capRate = (noi > 0 && tdc > 0) ? (noi / tdc) : null;
    var annualDebtService = firstLoanYear ? firstLoanYear.seniorDebtService : null;
    // Year-1 bridge-loan debt service is a required payment too (DOH PR 4).
    var firstYearBridge = firstLoanYear ? firstLoanYear.bridgeDebtService : null;
    var breakEvenOcc = known(allMustPayDebtService) && known(firstYearBridge) && annualRents > 0
      ? (annualOpex != null && annualRepReserve != null
          ? Math.min((annualOpex + annualRepReserve + (netPropTax || 0) + allMustPayDebtService + firstYearBridge) / (annualRents + otherIncomeForMath), 1)
          : null)
      : null;

    // ── DSCR + stress scenarios ──────────────────────────────────────
    //
    // Stress holds the resolved principal and all must-pay service fixed: recompute NOI
    // under {rent -10%, vacancy +5pts, opex +10%, combined -5/+3/+5}
    // and divide by the CURRENT debt service (loan is already sized
    // at stabilization). A banker/syndicator reads this to answer:
    // "does the deal still cover debt if the market goes sideways?"
    //
    // Only computable when auto-NOI is on — manual NOI mode doesn't
    // give us rent/vac/opex components to perturb.
    var dscrAutoMode = !!(autoNoi);
    var baseDSCR = coverageRatio(noi, annualDebtService);
    var allMustPayDSCR = coverageRatio(noi, allMustPayDebtService);
    var stress = null;
    if (dscrAutoMode) {
      stress = computeDscrStressScenarios({
        annualRents:      annualRents,
        annualOtherIncome: annualOtherIncome,
        vacancyPct:       vacFrac(),
        annualOpex:       annualOpex,
        annualRepReserve: annualRepReserve,
        netPropTax:       netPropTax,
        annualDebtService: allMustPayDebtService
      }, _constants);
    }

    if (stress) Object.keys(stress).forEach(function (key) {
      stress[key].margin = stress[key].dscr - dcr;
    });

    // Sources & uses — equity + mortgage + grants + soft-loan principal
    // close the gap at closing. (Soft loans contribute principal to the
    // sources stack AND show up as annual debt service in the pro forma.)
    //
    // H — Deferred dev fee behavior controlled by the auto-balance checkbox:
    //   • ON  → defer JUST ENOUGH to fill remaining gap, capped at slider %
    //           (mirrors Anthracite $185k pattern: last-resort balancing)
    //   • OFF → defer EXACTLY the slider % of total dev fee, regardless of gap
    //           (legacy behavior — manual deferral)
    var deferredCap = devFeeTotal * deferredPctSlider;
    // CHFA Method Two (QAP 3.M.1): credit is reserved for no more than the gap
    // left after every source but equity from the sale of Housing Tax Credits,
    // which the QAP uses for federal and state credit alike, so state credit
    // equity is left out here too. A deferred fee is a source however its
    // amount is set. Auto-balance counts the full deferral it may use, so the
    // credit is the least that closes the gap (26 U.S.C. 42(m)(2)(A)); when
    // that binds, the gap left for deferral is exactly that amount.
    var otherSources = mortgage + impactGrant + totalLoanPrincipal + deferredCap;
    var gapMethodCredit = cbm.gapCredit({ tdc: tdc, otherSources: otherSources, price: equityPrice, rules: costRules,
      otherReason: Number.isFinite(mortgage) ? 'Sources other than credit equity are not available.' : 'The first mortgage is not available, so the gap calculation cannot run.' });
    // An invalid unit mix leaves no basis figure to show, only its reason.
    basis = cbm.basisAndCredit(Object.assign({}, basisArgs, { gapCredit: gapMethodCredit,
      invalidReason: unitMixError ? 'Fix the unit mix: the AMI-tier units do not add up to Total Units.' : null }));
    // CHFA Method Three from the 2027 workbook's limits: a draft-QAP check beside
    // the capacity, never a change to it (deal-cost-basis.js costBasisLimitCheck).
    if (cbm.costBasisLimitCheck && inputs.chfaCommonAppTables !== undefined) {
      basis.costLimitMethod = Object.assign({}, basis.costLimitMethod, cbm.costBasisLimitCheck({
        tables: inputs.chfaCommonAppTables, countyFips: _countyFips, buildingType: fields['dc-building-type'],
        rows: pricedRows, units: units, applicableFraction: basis.applicableFraction, creditRate: _creditRate,
        hudBoost: !!(basis.boost && basis.boost.applied && ['qct', 'dda', 'sadda'].indexOf(fields['dc-boost-designation']) !== -1),
        capacity: basis.capacity }));
    }
    // An entered award is known even while the unit mix is invalid.
    if (chfaRegime && (!unitMixError || basis.creditForEquityBasis === 'awarded')) {
      annualCredits = basis.creditForEquity === null ? NaN : basis.creditForEquity;
      equity = annualCredits * CREDIT_YEARS * equityPrice;
      // Without the gap calculation the capacity is unknown (QAP 3.M.1), and so is the credit.
      if (basis.creditForEquity === null && !basisUnknownReason) basisUnknownReason = basis.reasons.capacity || null;
    }
    var gapBeforeDeferred = tdc - equity - stateEquity - mortgage - impactGrant - totalLoanPrincipal;
    // Equity sized to the gap closes it to within floating-point error; show $0, not $-0.
    if (Math.abs(gapBeforeDeferred) < 0.005) gapBeforeDeferred = 0;
    // #2161: a credit added on top of the federal and state credits, with the net new
    // equity it brings. Once every figure it needs is known and its eligibility is
    // shown, it is counted in the sources: its equity after its own investor fees is
    // a source, and the equity of any credit it replaces or cuts comes off that
    // credit's line. Federal and state equity above stay the amounts awarded.
    var addedCredit = null;
    var creditStack = { federal: equity, state: stateEquity, added: 0, label: null, counted: false, reason: null };
    if (chfaRegime && fields['dc-add-kind']) {
      var displacedChoice = fields['dc-add-displaces'] || null, displaced = null;
      if (displacedChoice === 'state') {
        // State equity in the stack is net of its investor fees, so the replaced share is too.
        displaced = { label: 'Colorado state credit', annual: fields['dc-add-displaced-annual'], years: stateCredit.years, price: stateCredit.price,
          netShare: stateCredit.equity === null || !stateCredit.grossEquity ? 1 : stateCredit.equity / stateCredit.grossEquity,
          maxAnnual: stateCredit.equity === null ? null : stateCredit.allowedAnnual,
          reason: !stateCredit.entered ? 'no state credit is entered.' : stateCredit.equity === null ? stateCredit.reason : null };
      } else if (displacedChoice === 'federal') {
        displaced = { label: 'Federal credit', federal: true, annual: fields['dc-add-displaced-annual'], years: CREDIT_YEARS, price: equityPrice,
          maxAnnual: Number.isFinite(annualCredits) ? annualCredits : null,
          reason: Number.isFinite(annualCredits) ? null : (basisUnknownReason || 'the federal credit is not available.') };
      }
      addedCredit = cbm.addedCredit({ kind: fields['dc-add-kind'], annual: fields['dc-add-annual'], years: fields['dc-add-years'],
        price: fields['dc-add-price'], fees: fields['dc-add-fees'], programYear: fields['dc-add-program-year'], mode: fields['dc-add-mode'] || null,
        evidence: fields['dc-add-evidence'], inZone: fields['dc-tz-in-zone'] === 'yes' ? true : fields['dc-tz-in-zone'] === 'no' ? false : null,
        displaced: displaced, rules: costRules,
        federalCut: { annual: fields['dc-add-fed-cut'], years: CREDIT_YEARS, price: equityPrice, maxAnnual: Number.isFinite(annualCredits) ? annualCredits : null } });
      addedCredit.gapBefore = Number.isFinite(gapBeforeDeferred) ? gapBeforeDeferred : null;
      creditStack.label = addedCredit.label;
      if (addedCredit.net !== null) {
        var replacedFederal = displacedChoice === 'federal' && addedCredit.mode === 'substitute' ? addedCredit.displaced : 0;
        var replacedState = displacedChoice === 'state' && addedCredit.mode === 'substitute' ? addedCredit.displaced : 0;
        creditStack.federal = equity - replacedFederal - addedCredit.resizedFederal;
        creditStack.state = stateEquity - replacedState;
        creditStack.added = addedCredit.gross - addedCredit.fees;
        creditStack.counted = true;
        gapBeforeDeferred = tdc - creditStack.federal - creditStack.state - creditStack.added - mortgage - impactGrant - totalLoanPrincipal;
        if (Math.abs(gapBeforeDeferred) < 0.005) gapBeforeDeferred = 0;
      } else {
        creditStack.reason = addedCredit.label + ' is not counted in the sources: ' + addedCredit.reason;
      }
      addedCredit.gapAfter = creditStack.counted && Number.isFinite(gapBeforeDeferred) ? gapBeforeDeferred : null;
    }
    // Investors pay in the gross equity; their fees come out before the project gets it.
    // The state credit's fees follow the share of its annual credit still in the sources.
    var stateFees = stateCreditApplies && stateCredit.equity !== null ? stateCredit.fees || 0 : 0;
    var stateShare = creditStack.counted && displacedChoice === 'state' && addedCredit.mode === 'substitute' && stateCredit.allowedAnnual > 0
      ? 1 - parseFloat(fields['dc-add-displaced-annual']) / stateCredit.allowedAnnual : 1;
    creditStack.investorFees = stateFees * stateShare + (creditStack.counted ? addedCredit.fees : 0);
    if (autoBalance) {
      // Defer the smaller of (gap, cap) — never more than needed, never above cap.
      deferredDevFee = Math.max(0, Math.min(deferredCap, gapBeforeDeferred));
    } else {
      deferredDevFee = deferredCap;
    }
    var devFeeAtClosing = devFeeTotal - deferredDevFee;
    var gap = gapBeforeDeferred - deferredDevFee;

    var exit = (function () {
      // A blank or out-of-range hold or cap is unknown, not a default: no sale
      // figures are built from it (exitInputsReason says what to enter).
      var holdYears = exitHoldYears(fields);
      var exitCap   = exitCapRate(fields);

      // Read growth rates from the pro forma inputs if present (defaults: 2% / 3%).
      var rentGrowth = growthRate(fields, 'pf-rent-growth', 2);
      var expGrowth  = growthRate(fields, 'pf-exp-growth', 3);

      // Same projected NOI used to allocate annual loan payments.
      var nNoi = annualRents > 0 && tdc > 0 && known(noi) && autoNoi && known(holdYears) ? loanNoi[holdYears - 1] : NaN;
      var resale = (isFinite(nNoi) && nNoi > 0 && exitCap > 0) ? nNoi / exitCap : NaN;

      // Exit uses these same annual loan records, including accrued interest.
      // Maturity balloons remain outstanding here; no refinance is presumed.
      var firstMortBal = obligations.loans && known(holdYears) ? obligations.loans[0].rows[holdYears - 1].balance : NaN;
      var softBal = obligations.loans && known(holdYears) ? 0 : NaN;
      if (obligations.loans && known(holdYears)) obligations.loans.slice(1).forEach(function (loan) {
        var balance = loan.rows[holdYears - 1].balance;
        softBal = known(balance) ? softBal + balance : NaN;
      });
      if (!known(firstMortBal)) firstMortBal = NaN;
      // DOH PR 4: an asset management fee still owed at the sale is paid from it.
      var exitYear = obligations.years && known(holdYears) ? obligations.years[holdYears - 1] : null;
      var assetMgmtOwed = exitYear && known(exitYear.assetMgmtUnpaid) ? exitYear.assetMgmtUnpaid : NaN;
      var netProceeds = (known(resale) && known(firstMortBal) && known(softBal) && known(assetMgmtOwed)) ? resale - firstMortBal - softBal - assetMgmtOwed : NaN;

      // Deferred fee payback timing. Walk the pro forma yearly, accumulating
      // cash flow (NOI − total debt service). Find the first year where
      // cumCF ≥ deferredDevFee, after the loan payments actually made (debt
      // service NOI could not cover stays in the loan balance, DOH PR 4).
      var dfYr = null;
      if (deferredDevFee > 0 && obligations.years && annualRents > 0) {
        var cumCF = 0;
        for (var y = 1; y <= holdYears; y++) {
          var paymentYear = obligations.years && obligations.years[y - 1];
          var unpaidNow = mustPayUnpaidFor(paymentYear);
          cumCF += paymentYear && known(paymentYear.cashFlow) && known(unpaidNow) ? paymentYear.cashFlow + unpaidNow : NaN;
          if (cumCF >= deferredDevFee) { dfYr = y; break; }
        }
      }

      // Return on the deferred fee (a stand-in for sponsor IRR) — Newton's method on the NPV polynomial.
      // Flows: yr 0 = −sponsorEquity; yrs 1..N = cashFlow; yr N also = +netProceeds.
      function computeIRR(flows) {
        var r = 0.10;
        for (var iter = 0; iter < 60; iter++) {
          var npv = 0, dnpv = 0;
          for (var t = 0; t < flows.length; t++) {
            var df = Math.pow(1 + r, t);
            npv  += flows[t] / df;
            if (t > 0) dnpv -= t * flows[t] / Math.pow(1 + r, t + 1);
          }
          if (Math.abs(dnpv) < 1e-10) break;
          var step = npv / dnpv;
          r -= step;
          if (r < -0.99) r = -0.99;
          if (r > 5)    r = 5;
          if (Math.abs(step) < 1e-7) break;
        }
        return r;
      }
      var irr = NaN;
      if (deferredDevFee > 0 && isFinite(netProceeds) && netProceeds > 0) {
        var flows = [-deferredDevFee];
        for (var yr = 1; yr <= holdYears; yr++) {
          var cashYear = obligations.years && obligations.years[yr - 1];
          var cf = cashYear && known(cashYear.cashFlow) ? cashYear.cashFlow : NaN;
          if (yr === holdYears) cf += netProceeds;
          flows.push(cf);
        }
        irr = computeIRR(flows);
      }

      var loanUnavailableReason = debtInputsReason || cashPayments.reason || (!known(firstMortBal) || !known(softBal) ? 'Loan payments or a maturity refinancing assumption are unavailable at exit.' : null);
      return { loanUnavailableReason: loanUnavailableReason, holdYears: holdYears, exitCap: exitCap, rentGrowth: rentGrowth, expGrowth: expGrowth,
        nNoi: nNoi, resale: resale, firstMortBal: firstMortBal, softBal: softBal,
        assetMgmtOwed: assetMgmtOwed, netProceeds: netProceeds, dfYr: dfYr, irr: irr };
    })();
    // Sensitivity needs known NOI and rents. Without them every swing below
    // would be computed from 0 and published as a real figure, so report
    // the whole block as unavailable instead (its reason comes from reasonFor).
    // The equity bars need known credits too (0 outside CHFA LIHTC is measured).
    // Manual NOI mode never resolves opexPerUnitMonth, so the OpEx swing reads the
    // budget (or the single old figure) directly; an unknown budget has no swing.
    var sensitivityOpex = known(opexPerUnitMonth) ? opexPerUnitMonth
      : operatingSummary ? (operatingSummary.reason ? NaN : operatingSummary.perUnitMonth) : safeVal('dc-opex');
    var sensitivityRepReserve = safeVal('dc-rep-reserve');
    // Every input the swings start from must be known; no stand-in values.
    var sensitivityKnown = !debtInputsReason && isFinite(noi) && annualRents > 0 && isFinite(annualCredits) && known(sensitivityOpex)
      && known(equityPrice) && equityPrice > 0 && known(interestRate) && interestRate > 0
      && known(sensitivityRepReserve) && sensitivityRepReserve >= 0 && units > 0;
    var tornado = !sensitivityKnown ? null : (function () {
        var eqP = equityPrice;
        var ir  = interestRate;
        var vu  = vacFrac() * 100;
        var ou  = sensitivityOpex;
        var u   = units;
        var acr = annualCredits;

        // Equity pricing: ±$0.03
        var eqLo  = acr * CREDIT_YEARS * Math.max(0.70, eqP - 0.03);
        var eqHi  = acr * CREDIT_YEARS * Math.min(1.05, eqP + 0.03);

        // Interest rate: ±1% (lower rate = higher mortgage, higher rate = lower)
        // Stressed rates stay inside the 3%-12% range the rate input accepts.
        var mcLo  = seniorPaymentConstant(Math.min(12, ir + 1));
        var mcHi  = seniorPaymentConstant(Math.max(3, ir - 1));
        var mortLo = seniorMode === 'entered' ? mortgage : (mcLo > 0 && noi > 0) ? Math.max(0, noi / dcr - totalSoftDebtService) / mcLo : 0;
        var mortHi = seniorMode === 'entered' ? mortgage : (mcHi > 0 && noi > 0) ? Math.max(0, noi / dcr - totalSoftDebtService) / mcHi : 0;

        // Compute EGI from available scope variables
        var _egi = ((annualRents || 0) + otherIncomeForMath) * (1 - (vu / 100));
        var _repRes = sensitivityRepReserve * u;

        // OpEx: ±$50/unit/month
        var noiLo = _egi - ((ou + 50) * 12 * u) - _repRes - (netPropTax || 0);
        var noiHi = _egi - (Math.max(200, ou - 50) * 12 * u) - _repRes - (netPropTax || 0);

        // Vacancy: ±2%
        var vacLoEgi = ((annualRents || 0) + otherIncomeForMath) * (1 - Math.min(0.15, (vu + 2) / 100));
        var vacHiEgi = ((annualRents || 0) + otherIncomeForMath) * (1 - Math.max(0.01, (vu - 2) / 100));

        return { eqP: eqP, ir: ir, vu: vu, ou: ou, eqLo: eqLo, eqHi: eqHi,
          mortLo: mortLo, mortHi: mortHi, noiLo: noiLo, noiHi: noiHi,
          vacLoEgi: vacLoEgi, vacHiEgi: vacHiEgi };
    })();
    var budget = { groups: costSummary.reason ? null : costSummary.groups, itemized: costSummary.reason ? null : costSummary.itemized,
      notItemized: costSummary.notItemized, contract: costSummary.reason ? null : costSummary.contract, reason: costSummary.reason };
    var fundingGap = Math.max(0, gap);
    var gapPct = tdc > 0 ? fundingGap / tdc : 0;
    var hasWorkforceUnits = false;
    DEAL_AMI_BANDS.filter(function (pct) { return pct > 60; }).forEach(function (pct) {
      var split = _tierSplitCounts(pct);
      var tierUnits = split.total > 0 ? split.total : _nonNegInt(fields['dc-units-' + pct]);
      if (tierUnits > 0) hasWorkforceUnits = true;
    });
    var achResult = (_amiLimits && inputs.fmrData) ? computeRentAchievability({ amiLimits: _amiLimits, fmr: inputs.fmrData }) : null;
    var simpleGap = tdc - equity;
    var totalSoftSourceAmt = totalGrant + totalLoanPrincipal;
    var forSale = inputs.ownership ? computeForSaleFeasibility(Object.assign({}, inputs.ownership, {
      tdc: tdc, units: units, grossSf: safeVal('dc-gross-sf')
    })) : null;
    var result = {
      forSale: forSale,
      tdc: tdc,
      units: units,
      creditType: creditType,
      basisUnknownReason: basisUnknownReason,
      stateEquity: stateEquity,
      creditStack: creditStack,
      equityPrice: equityPrice,
      totalGrant: totalGrant,
      totalLoanPrincipal: totalLoanPrincipal,
      totalSoftDebtService: totalSoftDebtService,
      trancheBreakdown: trancheBreakdown,
      tranches: tranches,
      impactGrant: impactGrant,
      impactDebtService: impactDebtService,
      impactMode: impactMode,
      annualRents: annualRents,
      annualOtherIncome: annualOtherIncome,
      otherIncomePerUnitYear: otherIncomePerUnitYear,
      operatingSummary: operatingSummary,
      amiUnitSum: amiUnitSum,
      minimumSetAsideElection: minimumSetAsideElection,
      designatedUnitsByPct: designatedUnitsByPct,
      marketRegime: marketRegime,
      chfaRegime: chfaRegime,
      allowanceRevenueReason: allowanceRevenueReason,
      rentInputsMissing: rentInputsMissing,
      capOn: capOn,
      perBrMarket: perBrMarket,
      pricedRows: pricedRows,
      gridBedrooms: gridBedrooms,
      manualMarket: manualMarket,
      capBindings: capBindings,
      minimumSetAsideResult: minimumSetAsideResult,
      lihtcUnits: lihtcUnits,
      applicableFraction: applicableFraction,
      eligibleBasisRaw: eligibleBasisRaw,
      basisForApplicableFractionNote: basisForApplicableFractionNote,
      eligibleBasis: eligibleBasis,
      annualCredits: annualCredits,
      equity: equity,
      unitMixError: unitMixError,
      devfeePct: devfeePct,
      devFeeTotal: devFeeTotal,
      deferredPctSlider: deferredPctSlider,
      autoBalance: autoBalance,
      deferredDevFeeManual: deferredDevFeeManual,
      deferredDevFee: deferredDevFee,
      noi: noi,
      annualOpex: annualOpex,
      annualRepReserve: annualRepReserve,
      netPropTax: netPropTax,
      taxSavings: taxSavings,
      effectiveGrossIncome: effectiveGrossIncome,
      annualPropTax: annualPropTax,
      taxExemptPct: taxExemptPct,
      opexPerUnitMonth: opexPerUnitMonth,
      repReservePerUnit: repReservePerUnit,
      propTaxPerUnit: propTaxPerUnit,
      dcr: dcr,
      interestRate: interestRate,
      term: term,
      mc: mc,
      mortgage: mortgage,
      rentDataReason: rentDataReason,
      noiUnknownReason: noiUnknownReason,
      rentsUnknownReason: rentsUnknownReason,
      prop123Average: prop123Average,
      capRate: capRate,
      annualDebtService: annualDebtService,
      breakEvenOcc: breakEvenOcc,
      dscrAutoMode: dscrAutoMode,
      baseDSCR: baseDSCR,
      allMustPayDSCR: allMustPayDSCR, allMustPayDebtService: allMustPayDebtService,
      seniorMode: seniorMode, obligations: obligations,
      stress: stress,
      deferredCap: deferredCap,
      gapBeforeDeferred: gapBeforeDeferred,
      devFeeAtClosing: devFeeAtClosing,
      gap: gap,
      exit: exit,
      tornado: tornado,
      budget: budget,
      fundingGap: fundingGap,
      gapPct: gapPct,
      hasWorkforceUnits: hasWorkforceUnits,
      achResult: achResult,
      simpleGap: simpleGap,
      totalSoftSourceAmt: totalSoftSourceAmt,
      sensitivityKnown: sensitivityKnown,
      vacancyRate: vacFrac(), scheduleMode: scheduleMode
    };
    var exitInputsReason = exitInputsReasonFor(fields), exitHoldKnown = known(exit.holdYears);
    var partnershipReason = partnershipTerms(fields).reason;
    var projectionInputsReason = !known(exit.rentGrowth) ? 'Enter annual rent growth from ' + GROWTH_LIMITS['pf-rent-growth'].min + '% to ' + GROWTH_LIMITS['pf-rent-growth'].max + '%.'
      : !known(exit.expGrowth) ? 'Enter annual expense growth from ' + GROWTH_LIMITS['pf-exp-growth'].min + '% to ' + GROWTH_LIMITS['pf-exp-growth'].max + '%.'
      : !known(fieldNumber(fields, 'pf-years', 15)) ? 'Enter the projection horizon.' : null;
    result.projection = operatingProjection(result, fields);
    result.stressBase = known(noi) && known(allMustPayDSCR) ? { noi: noi, dscr: allMustPayDSCR, margin: allMustPayDSCR - dcr } : null;
    var forecastYears = fieldNumber(fields, 'pf-years', 15);
    result.coverage = obligations.years && known(forecastYears) ? {
      years: obligations.years.slice(0, Math.min(50, Math.max(5, Math.round(forecastYears))))
    } : null;
    if (result.coverage) {
      result.coverage.measuredYears = result.coverage.years.filter(function (row) { return !row.unavailableReason; }).length;
      result.coverage.weakestSenior = weakestCoverage(result.coverage.years, 'seniorCoverage');
      result.coverage.weakestAllMustPay = weakestCoverage(result.coverage.years, 'allMustPayCoverage');
    }
    var ruleKeys = ['grant_basis_treatment', 'applicable_fraction', 'basis_boost', 'contractor_fee_limit', 'developer_fee_limit',
      'credit_cap_federal_9pct', 'credit_cap_state_with_9pct', 'credit_cap_state_round_two_accelerated', 'credit_cap_state_round_two_standard',
        'credit_cap_state_with_4pct', 'acquisition_credit_rate', 'credit_reservation_methods', 'min_debt_coverage', 'high_coverage_credit_reduction',
        'bond_aggregate_basis_test', 'operating_reserve_minimum', 'deferred_fee_repayment_review'];
    var federalEquity = basis.creditForEquity === null ? null : creditStack.federal;
    result.costBasis = {
      summary: costSummary, grants: grantTreatment, basis: basis, contractorFee: contractorFee,
      feeBase: feeBase, developerFee: developerFee, feeExcess: feeExcess, stateCredit: stateCredit, addedCredit: addedCredit,
      underwriting: cbm.underwritingCheck({ years: result.coverage ? result.coverage.years : [], rules: costRules }),
      payIn: {
        federal: cbm.payIn(federalEquity, { closing: fields['dc-fed-payin-closing'], completion: fields['dc-fed-payin-completion'], stabilization: fields['dc-fed-payin-stabilization'] }),
        state: stateCredit.entered ? cbm.payIn(stateCredit.equity === null ? null : creditStack.state, { closing: fields['dc-state-payin-closing'], completion: fields['dc-state-payin-completion'], stabilization: fields['dc-state-payin-stabilization'] }) : null,
        added: addedCredit ? cbm.payIn(addedCredit.gross, { closing: fields['dc-add-payin-closing'], completion: fields['dc-add-payin-completion'], stabilization: fields['dc-add-payin-stabilization'] }) : null
      },
      // Checks from a review of an outside pro forma (#2160 follow-up): the bond test,
      // the construction interest budget, CHFA's operating reserve and deferred fee review.
      bondTest: cbm.bondTest({ creditType: result.creditType, bondAmount: fields['dc-bond-amount'], issuedAfter2025: fields['dc-bond-post2025'],
        eligibleCost: costSummary.reason ? null : costSummary.eligible, land: costSummary.reason || !Object.prototype.hasOwnProperty.call(costSummary.byId, 'land') ? null : costSummary.byId.land,
        // Unitemized cost could be eligible basis, so a pass on a partial denominator is withheld.
        costReason: costSummary.reason || (costSummary.notItemized > 0.5 ? 'Itemize the remaining $' + Math.round(costSummary.notItemized).toLocaleString('en-US')
          + ' of Total Development Cost; the bond test is measured on all of building plus land.' : null),
        constructionLoan: fields['dc-constr-loan'], rules: costRules }),
      constructionInterest: cbm.constructionInterestCheck({ loan: fields['dc-constr-loan'], ratePct: fields['dc-constr-rate'],
        months: fields['dc-constr-months'], drawPct: fields['dc-constr-draw'],
        budget: costSummary.reason || !Object.prototype.hasOwnProperty.call(costSummary.byId, 'construction_interest') ? null : costSummary.byId.construction_interest }),
      operatingReserve: cbm.operatingReserveCheck({ reserve: costSummary.reason || !Object.prototype.hasOwnProperty.call(costSummary.byId, 'reserves') ? null : costSummary.byId.reserves,
        annualExpenses: known(result.annualOpex) && known(result.netPropTax) ? result.annualOpex + result.netPropTax : null,
        annualDebtService: result.coverage && result.coverage.years[0] ? result.coverage.years[0].mustPayDebtService : null, rules: costRules }),
      deferredFee: cbm.deferredFeeRepayment({ deferredFee: result.deferredDevFee, rows: result.projection ? result.projection.rows : [], rules: costRules }),
      costPerSf: cbm.costPerSf({ contract: costSummary.reason ? null : costSummary.contract, total: tdc,
        grossSf: fields['dc-gross-sf'], residentialSf: fields['dc-res-sf'], units: units,
        byId: costSummary.reason ? null : costSummary.byId, notItemized: costSummary.notItemized, costReason: costSummary.reason }),
      dohFeeShare: cbm.dohDeveloperFeeShare(costSummary),
      rules: ruleKeys.map(function (key) {
        var st = cbm.ruleStatus(costRules, key);
        return { key: key, applied: st.applied, reason: costRules ? st.reason : 'Rules file not loaded.', citation: st.citation || null,
          draft: st.draft };
      }),
      rulesVersion: costRules ? costRules.version : null
    };
    var obmT = operatingBudgetModule();
    result.expenseTarget = obmT && obmT.expenseTargetCheck ? obmT.expenseTargetCheck({ targetPerUnitYear: fields['dc-opex-target'],
      usedAnnual: result.annualOpex, units: units, noi: result.noi,
      mustPayDebtService: result.coverage && result.coverage.years[0] ? result.coverage.years[0].mustPayDebtService : null }) : null;
    result.sliderImpacts = sliderImpacts(result, fields);
    result.partnershipTerms = partnershipTerms(fields);
    result.waterfall = capitalWaterfall(result, fields);
    if (result.waterfall) {
      var cumLp = -result.waterfall.lpEquity, cumGp = 0;
      result.waterfall.annual = result.projection.rows.slice(0, exit.holdYears).map(function (row) {
        // Cash that repays the deferred fee goes to the developer, not to
        // distributions, and a deficit from earlier years is made up first.
        var surplus = row.distributable;
        // The developer receives the deferred fee paid from this year's cash and
        // any earlier operating deficit it funded that this year's cash repays;
        // a deficit it funds this year is cash it puts in.
        var share = result.waterfall.terms.lpOpsShare;
        var lp = surplus * share, gp = surplus * (1 - share) + row.deferredFeePaid + row.deficitRecovered - row.deficitFunded;
        if (row.year === exit.holdYears) { lp += result.waterfall.lpTotal; gp += result.waterfall.gpTotal; }
        cumLp += lp; cumGp += gp;
        return { year: row.year, noi: row.noi, debtService: row.debtService, lp: lp, gp: gp, cumLp: cumLp, cumGp: cumGp };
      });
      // The sponsor's own return on the deferred fee: the fee it left in at
      // closing against what the split above pays it each year and at the exit.
      var sponsorFlows = [-result.deferredDevFee].concat(result.waterfall.annual.map(function (a) { return a.gp; }));
      result.waterfall.sponsorIn = result.deferredDevFee;
      result.waterfall.sponsorCash = cumGp;
      result.waterfall.sponsorIrr = result.deferredDevFee > 0 ? irrOf(sponsorFlows) : NaN;
    }
    // A reason accompanies every absent numeric result; metadata nulls remain
    // absence too. Copy while normalizing, so neither input records nor their
    // nested rows can be changed through the returned object.
    var unavailable = {};
    function clean(value, path) {
      if (value == null || (typeof value === 'number' && !Number.isFinite(value))) {
        unavailable[path] = reasonFor(path);
        return null;
      }
      if (typeof value !== 'object') return value;
      var copy = Array.isArray(value) ? [] : {};
      Object.keys(value).forEach(function (key) { copy[key] = clean(value[key], path ? path + '.' + key : key); });
      return copy;
    }
    function reasonFor(path) {
      if (/^costBasis/.test(path)) return 'Not available; each cost and basis figure carries its own reason.';
      // A hold the exit cannot use stops every sale figure; a cap it cannot use stops the price and what follows from it.
      if (path === 'partnershipTerms.buyoutPrice') return 'Only a buyout has a price.';
      if (path === 'partnershipTerms.reason') return 'Every deal term is entered.';
      if (/^partnershipTerms\./.test(path)) return partnershipReason || 'Not entered.';
      if (partnershipReason && /^waterfall/.test(path) && !exitInputsReason) return partnershipReason;
      if (path === 'waterfall.sponsorIrr') return deferredDevFee > 0
        ? 'The sponsor\'s return needs a known split in every year of the hold, with cash coming back.' : 'No developer fee is deferred, so there is no sponsor return on it to measure.';
      if (exitInputsReason && (exitHoldKnown ? /^(exit\.(exitCap|resale|netProceeds|irr)$|waterfall)/ : /^(exit|waterfall)/).test(path)) return exitInputsReason;
      if (debtInputsReason && /^(dcr|interestRate|term|mc|mortgage|annualDebtService|allMustPay|baseDSCR|stress|gap|deferred|devFeeAtClosing|fundingGap|breakEvenOcc|exit|tornado|projection|waterfall|coverage|obligations|totalSoftDebtService)/.test(path)) return debtInputsReason;
      if (cashPayments.reason && /^(coverage|obligations|allMustPay|annualDebtService|baseDSCR|stress|breakEvenOcc|projection|waterfall|exit\.(firstMortBal|softBal|assetMgmtOwed|netProceeds|dfYr|irr)$)/.test(path)) return cashPayments.reason;
      if (/^(coverage|obligations)/.test(path)) return noiUnknownReason || 'Coverage needs positive scheduled payments and known NOI; years after an unpaid maturity require refinancing assumptions.';
      if (/^allMustPay/.test(path)) return noiUnknownReason || 'Coverage requires positive must-pay debt service.';
      // #2160: basis and credit depend on the itemized costs; figures that also
      // depend on NOI name the operating reason first.
      if (basisUnknownReason && /^(applicableFraction|eligibleBasis|annualCredits|equity|stateEquity|simpleGap)/.test(path)) return basisUnknownReason;
      if (costSummary.reason && /^(devFeeTotal|devfeePct|budget)/.test(path)) return costSummary.reason;
      var costReason = basisUnknownReason || costSummary.reason;
      if (costReason && /^(gap|deferred|devFeeAtClosing|fundingGap|exit\.(dfYr|irr)|waterfall|tornado|sliderImpacts)/.test(path)) return noiUnknownReason || rentsUnknownReason || costReason;
      if (operatingInputsReason && /^(noi|annualOpex|opexPerUnitMonth|annualRepReserve|repReservePerUnit|netPropTax|propTaxPerUnit|mortgage|annualDebtService|gap|deferred|devFeeAtClosing|fundingGap|capRate|baseDSCR|breakEvenOcc|stress|exit|tornado|projection|waterfall|sliderImpacts)/.test(path)) return operatingInputsReason;
      if (/^(projection|waterfall|exit)/.test(path) && projectionInputsReason) return projectionInputsReason;
      // Falling rents (or rising costs) can push exit-year NOI to zero or below: no resale value, nothing to divide.
      if (known(exit.nNoi) && exit.nNoi <= 0 && /^(exit\.(resale|netProceeds|irr)$|waterfall)/.test(path))
        return 'Exit-year NOI is zero or negative, so the model sets no resale value and there are no sale proceeds to divide.';
      if (/^exit\.(firstMortBal|softBal|assetMgmtOwed|netProceeds|dfYr|irr)$/.test(path) && exit.loanUnavailableReason) return noiUnknownReason || rentsUnknownReason || exit.loanUnavailableReason;
      if (/^projection\.rows\.\d+\.dscr$/.test(path)) return 'DSCR requires positive annual debt service.';
      if (/^waterfall\.(lpCashIrr|lpMultiple)$/.test(path)) return 'LP cash returns require a positive equity contribution.';
      if (/^(projection|waterfall)/.test(path)) return noiUnknownReason || rentsUnknownReason || (!autoNoi
        ? 'Operating detail is unavailable in manual NOI mode.' : 'Enter projection growth rates and waterfall assumptions.');
      if (/^(stressBase|sliderImpacts)/.test(path)) return noiUnknownReason || rentsUnknownReason || 'Enter the stress assumptions.';
      if (path === 'exit.dfYr' && !rentsUnknownReason) return deferredDevFee > 0
        ? 'Deferred fee is not recovered within the hold period.' : 'No deferred developer fee to recover.';
      if (path === 'exit.irr' && !rentsUnknownReason) return 'The return on the deferred fee requires a positive deferred fee and known positive net sale proceeds.';
      if (path === 'capRate') return noiUnknownReason || 'Cap rate requires positive NOI and total development cost.';
      if (path === 'baseDSCR') return noiUnknownReason || 'DSCR requires positive senior debt service.';
      if (path === 'breakEvenOcc' && !autoNoi) return 'Break-even occupancy requires auto-computed operating lines.';
      if (/^forSale/.test(path)) return forSale && forSale.status !== 'ok'
        ? 'Ownership screen: ' + forSale.status : 'Ownership input or source is unavailable.';
      if (/^(exit|pricedRows|annualRents|breakEvenOcc)/.test(path)) return rentsUnknownReason || 'Not available for these inputs.';
      if (/^(noi|mortgage|annualDebtService|gap|deferredDevFee|devFeeAtClosing|fundingGap|tornado)/.test(path)) return noiUnknownReason || rentsUnknownReason || 'Not available for these inputs.';
      if (unitMixError) return 'Fix the unit mix: the AMI-tier units do not add up to Total Units.';
      if (path === 'stress') return dscrAutoMode ? 'Stress scenarios need positive rents and debt service.' : 'Stress scenarios need auto-computed NOI.';
      if (!autoNoi && /^(annualOpex|annualRepReserve|netPropTax|effectiveGrossIncome|annualPropTax|taxExemptPct|opexPerUnitMonth|repReservePerUnit|propTaxPerUnit)/.test(path)) return 'Operating detail is unavailable in manual NOI mode.';
      return 'Not available for these inputs.';
    }
    var cleaned = clean(result, '');
    cleaned.unavailable = unavailable;
    return cleaned;
  }

  return { computeDeal: computeDeal, creditStackTotal: creditStackTotal, investorCapital: investorCapital, costPerGrossSf: costPerGrossSf,
    computeForSaleFeasibility: computeForSaleFeasibility, computeDeveloperOwnershipFundingStack: computeDeveloperOwnershipFundingStack, computeDscrStressScenarios: computeDscrStressScenarios,
    computeRentAchievability: computeRentAchievability, evaluateMinimumSetAside: evaluateMinimumSetAside,
    isLihtcCreditEligiblePct: isLihtcCreditEligiblePct, loanObligations: loanObligations, loanTerms: loanTerms, LOAN_TYPES: LOAN_TYPES };
}));
