/** Pure rental calculation extracted for #2118. Legacy formulas/defaults are intentional.
 * inputs.fields contains raw control values (including blank strings); the other
 * keys contain already-loaded source records. No fetching or mutable deal state.
 * Numeric absence is null at the result boundary, with a dotted-path reason in
 * unavailable. Internal NaN propagation preserves the existing blocking behavior.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./deal-calculator-math.js'), require('./chfa-rent-limits.js'));
  } else {
    // Late binding preserves the PMA page's existing script order.
    root.DealEngine = factory(root.DealCalculatorMath, {
      maxContractRent: function (input) { return root.ChfaRentLimits.maxContractRent(input); },
      unavailableMessage: function (reason) { return root.ChfaRentLimits.unavailableMessage(reason); }
    });
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (math, rentLimits) {
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
    // NOT `|| 0`: annualRents is NaN when the unit mix is broken, and `NaN || 0`
    // is 0 — which would resurrect the exact deal this is meant to refuse.
    var annualRents      = +inputs.annualRents;
    var vacancyPct       = +inputs.vacancyPct  || 0;
    var annualOpex       = +inputs.annualOpex       || 0;
    var annualRepReserve = +inputs.annualRepReserve || 0;
    var netPropTax       = +inputs.netPropTax       || 0;
    var annualDebtService = +inputs.annualDebtService || 0;
    // `NaN <= 0` is false, so a bare `<= 0` lets NaN through. Inverting the
    // comparison catches missing, zero, negative and NaN in one test.
    if (!(annualDebtService > 0) || !(annualRents > 0)) return null;

    var rentS = +constants.rentStressPct;
    var vacS  = +constants.vacStressPp;
    var opexS = +constants.opexStressPct;
    var cR    = +constants.combinedRentPct;
    var cV    = +constants.combinedVacPp;
    var cO    = +constants.combinedOpexPct;

    function _noiFor(rentMult, vacDelta, opexMult) {
      var effVac = Math.min(1, Math.max(0, vacancyPct + vacDelta));
      var eff    = annualRents * rentMult * (1 - effVac);
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
  // A not-yet-mounted optional control uses its visible UI default. Clearing an
  // existing control is absence, and must not silently reapply that default.
  function fieldNumber(fields, id, initial) {
    return fields[id] === undefined ? initial : parseFloat(fields[id]);
  }
  function operatingProjection(result, fields) {
    if (!result.dscrAutoMode || ![result.annualRents, result.noi, result.annualOpex,
        result.annualRepReserve, result.netPropTax, result.annualDebtService,
        result.totalSoftDebtService, result.exit.rentGrowth, result.exit.expGrowth].every(known)) return null;
    var years = fieldNumber(fields, 'pf-years', 15);
    if (!known(years)) return null;
    var debtService = result.annualDebtService + result.totalSoftDebtService;
    var rows = [], cumCF = 0;
    for (var y = 1; y <= 30; y++) {
      var rm = Math.pow(1 + result.exit.rentGrowth, y - 1);
      var em = Math.pow(1 + result.exit.expGrowth, y - 1);
      var rents = result.annualRents * rm, vacancyLoss = rents * result.vacancyRate;
      var egi = rents - vacancyLoss, opex = result.annualOpex * em;
      var reserve = result.annualRepReserve * em, tax = result.netPropTax * em;
      var noi = y === 1 ? result.noi : egi - opex - reserve - tax;
      var cashFlow = noi - debtService;
      cumCF += cashFlow;
      rows.push({ year: y, grossRents: rents, vacancyLoss: vacancyLoss, egi: egi,
        opex: opex, repReserve: reserve, propTax: tax, noi: noi, debtService: debtService,
        cashFlow: cashFlow, dscr: debtService > 0 ? noi / debtService : null, cumCF: cumCF });
    }
    return { years: Math.min(30, Math.max(5, Math.round(years))), rows: rows };
  }
  function sliderImpacts(result, fields) {
    var price = fieldNumber(fields, 'dc-stress-equity-price', 0.90);
    var overrun = fieldNumber(fields, 'dc-stress-tdc-overrun', 0) / 100;
    var leaseup = fieldNumber(fields, 'dc-stress-leaseup', 0);
    var equity = known(price) && known(result.annualCredits) ? result.annualCredits * CREDIT_YEARS * price : null;
    var cost = known(overrun) && known(result.tdc) ? result.tdc * (1 + overrun) : null;
    return { baseEquity: result.equity, equity: equity,
      equityDelta: known(equity) && known(result.equity) ? equity - result.equity : null,
      baseTdc: result.tdc, tdc: cost, overrun: known(cost) ? cost - result.tdc : null,
      baseNoi: result.noi, year1Loss: known(result.noi) && known(leaseup) ? result.noi * 0.5 * Math.min(1, leaseup / 12) : null };
  }
  function capitalWaterfall(result, fields) {
    if (!result.projection || ![result.exit.resale, result.exit.firstMortBal, result.exit.softBal,
        result.equity, result.deferredDevFee].every(known)) return null;
    var exit = { resale: result.exit.resale, mortBal: result.exit.firstMortBal, softBal: result.exit.softBal,
      hold: result.exit.holdYears, defFeeRemaining: result.exit.dfYr == null ? result.deferredDevFee : 0 };
    var lpEquityOverride = fieldNumber(fields, 'dc-wf-lp-equity', 0);
    var lpEquity = lpEquityOverride > 0 ? lpEquityOverride : result.equity;
    var prefRate = fieldNumber(fields, 'dc-wf-pref', 8) / 100;
    var gpResidualPct = fieldNumber(fields, 'dc-wf-gp-residual', 30) / 100;
    if (![lpEquityOverride, prefRate, gpResidualPct].every(known)) return null;
    var lpResidualPct = 1 - gpResidualPct;
    var catchupMode = fields['dc-wf-catchup'] || 'none';
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

    // Tier 3: Deferred dev fee remaining balance
    var tier3 = Math.min(remaining, exit.defFeeRemaining);
    tiers.push({ name: '3. Deferred developer fee', amount: tier3, recipient: 'Developer (GP)' });
    remaining -= tier3;

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
    var gpTotal = tier3 + tier5 + tier6gp;  // dev fee + catch-up + residual

    // LP IRR — simplified: LP put in lpEquity at year 0, got back lpTotal at year hold
    // (ignoring tax credits — those are the LP's primary return, not modeled here)
    var lpCashIrr = lpEquity > 0 ? Math.pow(lpTotal / lpEquity, 1 / hold) - 1 : NaN;
    var lpMultiple = lpEquity > 0 ? lpTotal / lpEquity : NaN;
    var gpMultiple = exit.defFeeRemaining > 0 ? gpTotal / exit.defFeeRemaining : NaN;

    return {
      tiers: tiers, grossProceeds: grossProceeds, remaining: remaining,
      lpEquity: lpEquity, lpTotal: lpTotal, gpTotal: gpTotal,
      lpCashIrr: lpCashIrr, lpMultiple: lpMultiple, gpMultiple: gpMultiple,
      prefRate: prefRate, hold: hold, gpResidualPct: gpResidualPct,
      autoLpEquity: result.equity, annualCredits: result.annualCredits,
      inputs: exit
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
    var basisPct = (safeVal('dc-basis-pct') || 80) / 100;
    var equityPrice = safeVal('dc-equity-price');
    if (!isFinite(equityPrice) || equityPrice <= 0) equityPrice = inputs.equityPriceDefault;
    // G — Multi-tranche soft debt. Aggregate across the tranche list:
    //   grants  → subtract from basis (§42(d)(5)(A)) AND fill gap at closing
    //   loans   → contribute to gap close at closing AND amortize as annual debt service
    // Tranches read from the renderSoftTranches() state (passed in by the caller).
    var tranches = inputs.tranches;
    var totalGrant = 0;
    var totalLoanPrincipal = 0;
    var totalSoftDebtService = 0;
    var trancheBreakdown = [];   // for sources/uses rendering
    tranches.forEach(function (t) {
      var amt = Math.max(0, t.amount || 0);
      if (amt <= 0) return;
      if (t.mode === 'grant') {
        totalGrant += amt;
        trancheBreakdown.push({ id: t.id, program: t.program, mode: 'grant', amount: amt, debtService: 0 });
      } else {
        totalLoanPrincipal += amt;
        var rPct = Math.max(0, t.rate || 0);
        var trm = Math.max(1, t.term || 30);
        var mcT = mortgageConstant(rPct / 100, trm);
        // Zero-interest public loans amortize straight-line principal.
        var ds = rPct > 0 ? (amt * mcT) : (amt / trm);
        totalSoftDebtService += ds;
        trancheBreakdown.push({ id: t.id, program: t.program, mode: 'loan', amount: amt, debtService: ds, rate: rPct, term: trm });
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

    var minimumSetAsideResult = evaluateMinimumSetAside(minimumSetAsideElection, units, designatedUnitsByPct);
    var lihtcUnits = minimumSetAsideResult.countedLihtcUnits;
    // Applicable fraction (IRC §42(c)(1)(B)): for mixed-income deals
    // qualified basis = eligible basis × min(unit fraction, floor-area fraction).
    // We don't track floor area separately, so use the unit fraction.
    // For pure-LIHTC deals (no market units), this is 1.0.
    var applicableFraction = lihtcUnits > 0
      ? math.computeApplicableFraction(lihtcUnits, units) : 0;

    // LIHTC credit calculations — grants reduce eligible basis per
    // §42(d)(5)(A); applicable fraction prorates basis when market-rate
    // units are present.
    var eligibleBasisRaw = Math.max(0, (tdc * basisPct) - impactGrant);
    var eligibleBasis    = eligibleBasisRaw * applicableFraction;
    var annualCredits    = eligibleBasis * _creditRate;
    var equity           = annualCredits * CREDIT_YEARS * equityPrice;

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

    // Developer fee
    var devfeePct = (safeVal('dc-devfee-pct') || 15) / 100;
    var devFeeTotal = tdc * devfeePct;
    var deferredPctSlider = (safeVal('dc-deferred-pct') || 40) / 100;

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
    if (autoNoi) {
      var vacancyPct = vacFrac();
      // Entered zero is valid; a cleared operating line is unmeasured.
      var opexPerUnitMonth = safeVal('dc-opex');
      var repReservePerUnit = safeVal('dc-rep-reserve');
      var propTaxPerUnit = safeVal('dc-prop-tax');
      if (!known(opexPerUnitMonth) || opexPerUnitMonth < 0) {
        opexPerUnitMonth = NaN;
        operatingInputsReason = 'Enter operating cost per unit per month.';
      } else if (!known(repReservePerUnit) || repReservePerUnit < 0) {
        repReservePerUnit = NaN;
        operatingInputsReason = 'Enter the annual replacement reserve per unit.';
      } else if (!known(propTaxPerUnit) || propTaxPerUnit < 0) {
        propTaxPerUnit = NaN;
        operatingInputsReason = 'Enter the annual property tax per unit.';
      }
      var effectiveGrossIncome = annualRents * (1 - vacancyPct);
      annualOpex = opexPerUnitMonth * 12 * (units || 60);
      annualRepReserve = repReservePerUnit * (units || 60);
      var taxExemptPct = (safeVal('dc-tax-exempt') || 0) / 100;
      var annualPropTax = propTaxPerUnit * (units || 60);
      taxSavings = annualPropTax * taxExemptPct;
      netPropTax = annualPropTax - taxSavings;
      noi = effectiveGrossIncome - annualOpex - annualRepReserve - netPropTax;
    } else {
      // A blank NOI field is an unknown NOI, not $0 of it.
      noi = safeVal('dc-noi');
    }

    // Supportable first mortgage
    var dcr = safeVal('dc-dcr');
    if (!isFinite(dcr) || dcr < 1.05) dcr = 1.20;
    if (dcr > 2.0) dcr = 2.0;
    var interestRate = safeVal('dc-rate');
    if (!isFinite(interestRate) || interestRate < 3.0) interestRate = 6.5;
    if (interestRate > 12.0) interestRate = 12.0;
    var term = safeVal('dc-term');
    if (!isFinite(term) || term <= 0) term = 35;

    var mc = mortgageConstant(interestRate / 100, term);
    // A known NOI of zero or less supports no mortgage: that $0 is computed.
    // An unknown NOI supports an unknown one, and must stay unknown — `NaN > 0`
    // is false, so without the first test it fell through to the same $0.
    var mortgage = !isFinite(noi) ? NaN
      : (mc > 0 && noi > 0) ? (noi / dcr) / mc : 0;

    // Why NOI or the rent roll is unknown, carried with it so each message
    // names the fix that applies rather than assuming there is no county.
    var rentDataReason = manualMarket.message || (allowanceRevenueReason ? rentLimits.unavailableMessage(allowanceRevenueReason)
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
    var annualDebtService = mc > 0 ? mortgage * mc : 0;
    var breakEvenOcc = annualRents > 0
      ? (annualOpex != null && annualRepReserve != null
          ? Math.min((annualOpex + annualRepReserve + (netPropTax || 0) + annualDebtService) / annualRents, 1)
          : null)
      : null;

    // ── DSCR + stress scenarios ──────────────────────────────────────
    //
    // By construction, baseDSCR === target DCR (mortgage was sized at
    // noi/dcr). The real value is in the stress table: recompute NOI
    // under {rent -10%, vacancy +5pts, opex +10%, combined -5/+3/+5}
    // and divide by the CURRENT debt service (loan is already sized
    // at stabilization). A banker/syndicator reads this to answer:
    // "does the deal still cover debt if the market goes sideways?"
    //
    // Only computable when auto-NOI is on — manual NOI mode doesn't
    // give us rent/vac/opex components to perturb.
    var dscrAutoMode = !!(autoNoi);
    var baseDSCR = annualDebtService > 0 ? noi / annualDebtService : null;
    var stress = null;
    if (dscrAutoMode) {
      stress = computeDscrStressScenarios({
        annualRents:      annualRents,
        vacancyPct:       vacFrac(),
        annualOpex:       annualOpex       || 0,
        annualRepReserve: annualRepReserve || 0,
        netPropTax:       netPropTax       || 0,
        annualDebtService: annualDebtService
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
    var gapBeforeDeferred = tdc - equity - mortgage - impactGrant - totalLoanPrincipal;
    if (autoBalance) {
      // Defer the smaller of (gap, cap) — never more than needed, never above cap.
      deferredDevFee = Math.max(0, Math.min(deferredCap, gapBeforeDeferred));
    } else {
      deferredDevFee = deferredCap;
    }
    var devFeeAtClosing = devFeeTotal - deferredDevFee;
    var gap = gapBeforeDeferred - deferredDevFee;

    var exit = (function () {
      var holdYears = Math.max(5, Math.min(30, parseInt(fields['dc-exit-hold'], 10) || 15));
      var exitCap   = (parseFloat(fields['dc-exit-cap']) || 6.5) / 100;

      // Read growth rates from the pro forma inputs if present (defaults: 2% / 3%).
      var rentGrowth = fieldNumber(fields, 'pf-rent-growth', 2) / 100;
      var expGrowth  = fieldNumber(fields, 'pf-exp-growth', 3) / 100;

      // Year-N NOI projection. annualRents and annualOpex/repReserve/netPropTax
      // are local closures from earlier in recalculate(). Defensive guards.
      var nNoi = NaN;
      if (annualRents > 0 && tdc > 0 && known(noi) && autoNoi) {
        var rentMult = Math.pow(1 + rentGrowth, holdYears - 1);
        var expMult  = Math.pow(1 + expGrowth,  holdYears - 1);
        var vacPct   = vacFrac();
        var grossN   = annualRents * rentMult;
        var egiN     = grossN * (1 - vacPct);
        var opexN    = (annualOpex || 0) * expMult;
        var rrN      = (annualRepReserve || 0) * expMult;
        var ptN      = (netPropTax || 0) * expMult;
        nNoi = egiN - opexN - rrN - ptN;
      }
      var resale = (isFinite(nNoi) && nNoi > 0 && exitCap > 0) ? nNoi / exitCap : NaN;

      // Remaining 1st mortgage balance at year N (level-pay annuity).
      // bal = P * [(1+r)^n − (1+r)^k] / [(1+r)^n − 1]
      // where r = monthly rate, n = total months, k = months elapsed.
      function remainingBalance(principal, ratePct, termYears, elapsedYears) {
        if (principal <= 0 || termYears <= 0) return 0;
        if (ratePct <= 0) {
          // Straight-line amortization
          var paid = principal * (elapsedYears / termYears);
          return Math.max(0, principal - paid);
        }
        var r = ratePct / 100 / 12;
        var n = termYears * 12;
        var k = Math.min(n, elapsedYears * 12);
        var num = Math.pow(1 + r, n) - Math.pow(1 + r, k);
        var den = Math.pow(1 + r, n) - 1;
        return den > 0 ? principal * (num / den) : 0;
      }
      var firstMortBal = remainingBalance(mortgage, interestRate || 6.5, term || 35, holdYears);
      var softBal = 0;
      trancheBreakdown.forEach(function (t) {
        if (t.mode !== 'loan') return;
        softBal += remainingBalance(t.amount, t.rate || 0, t.term || 30, holdYears);
      });

      var netProceeds = (isFinite(resale)) ? resale - firstMortBal - softBal : NaN;

      // Deferred fee payback timing. Walk the pro forma yearly, accumulating
      // cash flow (NOI − total debt service). Find the first year where
      // cumCF ≥ deferredDevFee. (We use the constant year-1 debt service +
      // growing NOI; consistent with the 30-yr projection's "fixed DS".)
      var dfYr = null;
      if (deferredDevFee > 0 && annualDebtService > 0 && annualRents > 0) {
        var totalDS = annualDebtService + totalSoftDebtService;
        var cumCF = 0;
        for (var y = 1; y <= holdYears; y++) {
          var rm = Math.pow(1 + rentGrowth, y - 1);
          var em = Math.pow(1 + expGrowth,  y - 1);
          var vp = vacFrac();
          var noiY = annualRents * rm * (1 - vp) -
                     (annualOpex || 0) * em -
                     (annualRepReserve || 0) * em -
                     (netPropTax || 0) * em;
          cumCF += (noiY - totalDS);
          if (cumCF >= deferredDevFee) { dfYr = y; break; }
        }
      }

      // Sponsor IRR — Newton's method on the NPV polynomial.
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
        var totalDS2 = annualDebtService + totalSoftDebtService;
        var flows = [-deferredDevFee];
        for (var yr = 1; yr <= holdYears; yr++) {
          var rmY = Math.pow(1 + rentGrowth, yr - 1);
          var emY = Math.pow(1 + expGrowth,  yr - 1);
          var vpY = vacFrac();
          var noiY2 = annualRents * rmY * (1 - vpY) -
                      (annualOpex || 0) * emY -
                      (annualRepReserve || 0) * emY -
                      (netPropTax || 0) * emY;
          var cf = noiY2 - totalDS2;
          if (yr === holdYears) cf += netProceeds;
          flows.push(cf);
        }
        irr = computeIRR(flows);
      }

      return { holdYears: holdYears, exitCap: exitCap, rentGrowth: rentGrowth, expGrowth: expGrowth,
        nNoi: nNoi, resale: resale, firstMortBal: firstMortBal, softBal: softBal,
        netProceeds: netProceeds, dfYr: dfYr, irr: irr };
    })();
    // Sensitivity needs known NOI and rents. Without them every swing below
    // would be computed from 0 and published as a real figure, so report
    // the whole block as unavailable instead (its reason comes from reasonFor).
    var sensitivityKnown = isFinite(noi) && annualRents > 0;
    var tornado = !sensitivityKnown ? null : (function () {
        var eqP = equityPrice || 0.90;
        var ir  = interestRate || 6.5;
        var vu  = vacFrac() * 100;
        var ou  = safeVal('dc-opex') || 450;
        var u   = units || 60;
        var acr = annualCredits || 0;

        // Equity pricing: ±$0.03
        var eqLo  = acr * CREDIT_YEARS * Math.max(0.70, eqP - 0.03);
        var eqHi  = acr * CREDIT_YEARS * Math.min(1.05, eqP + 0.03);

        // Interest rate: ±1% (lower rate = higher mortgage, higher rate = lower)
        var mcLo  = mortgageConstant(Math.min(0.12, (ir + 1)) / 100, term || 35);
        var mcHi  = mortgageConstant(Math.max(0.03, (ir - 1)) / 100, term || 35);
        var mortLo = (mcLo > 0 && noi > 0) ? (noi / dcr) / mcLo : 0;
        var mortHi = (mcHi > 0 && noi > 0) ? (noi / dcr) / mcHi : 0;

        // Compute EGI from available scope variables
        var _egi = (annualRents || 0) * (1 - (vu / 100));
        var _repRes = (safeVal('dc-rep-reserve') || 350) * u;

        // OpEx: ±$50/unit/month
        var noiLo = _egi - ((ou + 50) * 12 * u) - _repRes - (netPropTax || 0);
        var noiHi = _egi - (Math.max(200, ou - 50) * 12 * u) - _repRes - (netPropTax || 0);

        // Vacancy: ±2%
        var vacLoEgi = (annualRents || 0) * (1 - Math.min(0.15, (vu + 2) / 100));
        var vacHiEgi = (annualRents || 0) * (1 - Math.max(0.01, (vu - 2) / 100));

        return { eqP: eqP, ir: ir, vu: vu, ou: ou, eqLo: eqLo, eqHi: eqHi,
          mortLo: mortLo, mortHi: mortHi, noiLo: noiLo, noiHi: noiHi,
          vacLoEgi: vacLoEgi, vacHiEgi: vacHiEgi };
    })();
    var budget = { acq: tdc * 0.10, hard: tdc * 0.62, soft: tdc * 0.14, cont: tdc * 0.05, fee: tdc * 0.09 };
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
      basisPct: basisPct,
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
      capRate: capRate,
      annualDebtService: annualDebtService,
      breakEvenOcc: breakEvenOcc,
      dscrAutoMode: dscrAutoMode,
      baseDSCR: baseDSCR,
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
    var projectionInputsReason = !known(exit.rentGrowth) ? 'Enter annual rent growth.'
      : !known(exit.expGrowth) ? 'Enter annual expense growth.'
      : !known(fieldNumber(fields, 'pf-years', 15)) ? 'Enter the projection horizon.' : null;
    result.projection = operatingProjection(result, fields);
    result.stressBase = known(noi) && known(baseDSCR) ? { noi: noi, dscr: baseDSCR, margin: baseDSCR - dcr } : null;
    result.sliderImpacts = sliderImpacts(result, fields);
    result.waterfall = capitalWaterfall(result, fields);
    if (result.waterfall) {
      var cumLp = -result.waterfall.lpEquity, cumGp = 0;
      result.waterfall.annual = result.projection.rows.slice(0, exit.holdYears).map(function (row) {
        var surplus = Math.max(0, row.cashFlow);
        var lp = surplus * 0.9999, gp = surplus * 0.0001;
        if (row.year === exit.holdYears) { lp += result.waterfall.lpTotal; gp += result.waterfall.gpTotal; }
        cumLp += lp; cumGp += gp;
        return { year: row.year, noi: row.noi, debtService: row.debtService, lp: lp, gp: gp, cumLp: cumLp, cumGp: cumGp };
      });
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
      if (operatingInputsReason && /^(noi|annualOpex|opexPerUnitMonth|annualRepReserve|repReservePerUnit|netPropTax|propTaxPerUnit|mortgage|annualDebtService|gap|deferred|devFeeAtClosing|fundingGap|capRate|baseDSCR|breakEvenOcc|stress|exit|tornado|projection|waterfall|sliderImpacts)/.test(path)) return operatingInputsReason;
      if (/^(projection|waterfall|exit)/.test(path) && projectionInputsReason) return projectionInputsReason;
      if (/^projection\.rows\.\d+\.dscr$/.test(path)) return 'DSCR requires positive annual debt service.';
      if (/^waterfall\.(lpCashIrr|lpMultiple)$/.test(path)) return 'LP cash returns require a positive equity contribution.';
      if (/^(projection|waterfall)/.test(path)) return noiUnknownReason || rentsUnknownReason || (!autoNoi
        ? 'Operating detail is unavailable in manual NOI mode.' : 'Enter projection growth rates and waterfall assumptions.');
      if (/^(stressBase|sliderImpacts)/.test(path)) return noiUnknownReason || rentsUnknownReason || 'Enter the stress assumptions.';
      if (path === 'exit.dfYr' && !rentsUnknownReason) return deferredDevFee > 0
        ? 'Deferred fee is not recovered within the hold period.' : 'No deferred developer fee to recover.';
      if (path === 'exit.irr' && !rentsUnknownReason) return 'Sponsor IRR requires a positive deferred fee and known positive net sale proceeds.';
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

  return { computeDeal: computeDeal, costPerGrossSf: costPerGrossSf,
    computeForSaleFeasibility: computeForSaleFeasibility, computeDeveloperOwnershipFundingStack: computeDeveloperOwnershipFundingStack, computeDscrStressScenarios: computeDscrStressScenarios,
    computeRentAchievability: computeRentAchievability, evaluateMinimumSetAside: evaluateMinimumSetAside,
    isLihtcCreditEligiblePct: isLihtcCreditEligiblePct };
}));
