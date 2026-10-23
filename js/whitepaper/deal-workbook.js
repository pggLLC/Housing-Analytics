/**
 * deal-workbook.js — the gated "Deal workbook" page: one deal's pro forma laid out
 * the way a lender or partner reads it. Executive view first, then sources and
 * uses, basis and credits, rents by AMI tier against the limits, operating costs
 * against CHFA's minimums, the 15-year cash flow with debt coverage, deferred fee
 * payback, and checks written as findings.
 *
 * Every figure is the Deal Calculator's own. The page opens deal-calculator.html in
 * a hidden frame with the deal's settings and reads its result, so there is one
 * engine (js/deal-engine.js) and no second model to disagree with it.
 *
 * Reads:
 *   /api/deals                                  saved deals and versions (coho-backend,
 *                                               per login). Deal figures never go to
 *                                               this repository.
 *   data/policy/lihtc-underwriting-rules.json   CHFA minimum pro forma assumptions,
 *                                               each quoted from the QAP
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.DealWorkbook in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealWorkbook = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RULES_URL = 'data/policy/lihtc-underwriting-rules.json';
  var API = '/api/deals';
  var YEARS = 15;
  // js/deal-cost-basis.js GROUPS, in the order a development budget reads.
  var USE_GROUPS = [['acquisition', 'Acquisition'], ['site', 'Site improvements'], ['construction', 'Construction'],
    ['professional', 'Professional fees'], ['construction_finance', 'Construction finance'],
    ['permanent_finance', 'Permanent finance and syndication'], ['soft', 'Soft costs'], ['fees', 'Developer fee'], ['reserves', 'Reserves']];
  // js/deal-engine.js LOAN_TYPES.
  var LOAN_TYPES = { amortizing: 'Must-pay, amortizing', io_then_amortizing: 'Interest-only, then amortizing',
    interest_only: 'Interest-only to maturity', cash_flow: 'Paid from cash flow', accrue_defer: 'Accrues, paid later', forgivable: 'Forgivable' };
  // getUtilityAllowanceMetadata().perBedroom keys (js/deal-calculator.js RENT_BEDROOMS).
  var UA_KEY = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var BR_KEY = { STUDIO: 'studio', EFFICIENCY: 'studio', '0BR': 'studio', '1BR': '1br', '2BR': '2br', '3BR': '3br', '4BR': '4br' };

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function money(v) { return v == null ? '—' : (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function pct(v, d) { return v == null ? '—' : (v * 100).toFixed(d == null ? 0 : d) + '%'; }
  function ratio(v) { return v == null ? '—' : v.toFixed(2) + 'x'; }

  // The CHFA minimum pro forma assumptions on file, or null for each one missing.
  function chfaMinimums(rules) {
    var r = (rules && rules.rules) || {}, src = (rules && rules.sources) || {};
    function rule(id, field) {
      var x = r[id];
      if (!x || x.status !== 'adopted' || num(x[field]) == null) return null;
      return { value: num(x[field]), quote: x.quote, where: ((src[x.source] || {}).title || x.source) + ', ' + x.location };
    }
    return {
      vacancy: rule('pro_forma_vacancy', 'rate'), vacancySection8: rule('pro_forma_vacancy', 'rate_full_section8'), rentGrowth: rule('pro_forma_rent_growth', 'rate'),
      expGrowth: rule('pro_forma_expense_growth', 'rate'), opex: rule('pupa_minimum', 'per_unit_annual'), opexSection8: rule('pupa_minimum', 'per_unit_annual_section8'),
      reserve: rule('replacement_reserve_minimum', 'family_per_unit_annual'), reserveSenior: rule('replacement_reserve_minimum', 'senior_per_unit_annual'),
      dscr: rule('min_debt_coverage', 'min_coverage'), high: rule('high_coverage_credit_reduction', 'threshold')
    };
  }

  // ── The workbook model (pure) ─────────────────────────────────────────────
  // snap: { result, permanentFinancing, rentLimits, utilityAllowance, amiByBr, labels } read from the calculator.
  // The engine's notes on two CHFA tests it does not run (js/deal-cost-basis.js); a test keeps these in step.
  var BOND_TEST_NOTE = 'Assumes the tax-exempt bonds meet the aggregate basis test. Otherwise CHFA allows 4% credit only on the share of eligible basis the bonds finance (CHFA 2025-2026 QAP, PDF page 54). Not checked here.';
  var APPLICANT_LIMIT_NOTE = 'CHFA\'s limits apply per project and per applicant, with its affiliates, so credit requested in their other active CHFA applications leaves less for this one. These figures assume there are none.';
  var REHAB_MINIMUM_NOTE = 'CHFA also requires rehabilitation hard costs, not counting acquisition or soft costs, above the greater of 20% of the building\'s adjusted basis or $20,000 per unit (CHFA 2025-2026 QAP, PDF page 35). Not checked here.';

  // ctx carries what a saved Submittal version knows and the calculator does not: whether the deal is supportive housing.
  function build(snap, rules, ctx) {
    var r = snap && snap.result;
    if (!r) return { error: 'The Deal Calculator gave no result for this deal.' };
    if (r.chfaRegime === false) return { error: 'This deal uses ' + ((snap.rentLimits && snap.rentLimits.regime) || 'non-tax-credit') + ' rent limits, so it has no tax credits to lay out. The workbook covers rental tax credit deals; switch the Deal Calculator to CHFA tax credit limits.' };
    if (snap.mode === 'ownership' || (r.forSale && r.forSale.status && !r.pricedRows)) return { error: 'This is a for-sale deal. The workbook covers rental tax credit deals.' };
    var un = r.unavailable || {};
    var units = num(r.units);
    var min = chfaMinimums(rules);
    var labels = (snap && snap.labels) || {};
    var model = { units: units, creditType: r.creditType, findings: [], rulesMissing: !rules };

    // Sources: DOH's permanent financing view, which the calculator already classifies.
    var pf = snap.permanentFinancing;
    var sources = [];
    if (pf && pf.totals) {
      (pf.hardMortgages || []).forEach(function (m) {
        var name = m.source === 'senior' ? 'First mortgage' : (m.label || 'Mortgage') + (m.program ? ' (' + (labels[m.program] || m.program) + ')' : '');
        // A loan the engine could not size says why, and one with no DOH loan type keeps that note too, so
        // neither reads as resolved.
        var amt = num(m.principal), notes = [];
        if (amt == null) notes.push('not known, ' + ((m.source === 'senior' ? un.mortgage : null) || 'enter the loan amount').replace(/\.$/, ''));
        if (m.reason) notes.push(m.reason);
        sources.push({ label: notes.length ? name + ': ' + notes.join('; ') : name, amount: amt });
      });
      var tc = pf.taxCredit || {};
      // The deal's own federal credit stays in the list when it could not be sized: unknown is not none.
      var fedKey = String(r.creditType) === '4' ? 'four' : 'nine';
      ['nine', 'four'].forEach(function (k) {
        var label = 'Federal ' + (k === 'four' ? '4%' : '9%') + ' credit equity';
        if (num(tc[k])) sources.push({ label: label, amount: num(tc[k]) });
        else if (k === fedKey && num(tc[k]) == null) sources.push({ label: label + ': not known, ' + (un.annualCredits || 'the credit was not calculated'), amount: null });
      });
      var sc = (r.costBasis && r.costBasis.stateCredit) || {};
      // A capped award shows the reduced equity and says why, so it never reads as the amount entered.
      if (num(tc.state)) sources.push({ label: 'Colorado state credit equity' + (sc.capReason ? ': ' + String(sc.capReason).replace(/\.$/, '') : ''), amount: num(tc.state) });
      else if (sc.entered && num(tc.state) == null) sources.push({ label: 'Colorado state credit equity: not known, ' + (sc.reason || 'its terms are incomplete'), amount: null });
      var cs = r.creditStack || {};
      if (num(tc.added)) sources.push({ label: tc.addedLabel || 'Other credit equity', amount: num(tc.added) });
      // An added credit the engine left out keeps its row so the stack does not read as complete.
      else if (cs.reason && !cs.counted) sources.push({ label: (cs.label || 'Added credit') + ': not counted, ' + cs.reason, amount: null });
      // Each historic tranche keeps its row; one entered without a usable amount is shown as unknown.
      (pf.historic || []).forEach(function (h) {
        var amt = num(h.amount);
        sources.push(amt != null ? { label: 'Historic credit equity', amount: amt } : { label: 'Historic credit equity: not known, enter the tranche amount', amount: null });
      });
      ['government', 'other', 'owner', 'unclassified'].forEach(function (k) {
        (pf[k] || []).forEach(function (s) { var prog = s.program ? (labels[s.program] || s.program) : null;
          var name = s.label && prog ? s.label + ' (' + prog + ')' : (s.label || prog || 'Other source');
          // A source with no DOH group keeps the engine's reason, so it never reads as classified.
          var amt = num(s.amount != null ? s.amount : s.principal);
          // A source entered without a usable amount makes the total unknown; say which one. A source with no
          // DOH group says so too, and a row can need both.
          var notes = [];
          if (amt == null) notes.push('not known, ' + ((s.source === 'senior' ? un.mortgage : null) || 'enter the amount').replace(/\.$/, ''));
          if (k === 'unclassified' && s.reason) notes.push('not yet grouped, ' + s.reason);
          if (notes.length) name += ': ' + notes.join('; ');
          sources.push({ label: name, amount: amt }); });
      });
      if (num(pf.deferredDevFee)) sources.push({ label: 'Deferred developer fee', amount: num(pf.deferredDevFee) });
      else if (pf.deferredDevFee == null && un.deferredDevFee) sources.push({ label: 'Deferred developer fee: not known, ' + un.deferredDevFee, amount: null });
      // Hard debt above the lower of the cap-rate and appraisal loan limits, as the calculator shows it.
      var ml = pf.maxLoan || {}, limits = [ml.byCap && num(ml.byCap.maxLoan), ml.byAppraisal && num(ml.byAppraisal.maxLoan)].filter(function (x) { return x != null; });
      model.sources = { rows: sources, total: num(pf.totals.totalSources), gap: num(pf.totals.gap), tdc: num(pf.totals.tdc),
        hardDebt: num(pf.hardDebt), maxLoan: limits.length ? Math.min.apply(null, limits) : null, overMaxLoan: num(pf.overMaxLoan) };
    } else model.sources = { rows: [], reason: (pf && pf.reasons && pf.reasons[0]) || un.fundingGap || 'The calculator could not build the sources for this deal.' };

    // Uses: the itemized budget by group.
    // A budget line the engine could not read leaves partial groups behind; its reason wins over them.
    var bg = r.budget && !r.budget.reason && r.budget.groups;
    model.uses = bg ? {
      rows: USE_GROUPS.map(function (g) { return { label: g[1], amount: num(bg[g[0]]) }; }).filter(function (x) { return x.amount; }),
      notItemized: num(r.budget.notItemized), tdc: num(r.tdc)
    } : { rows: [], tdc: num(r.tdc), reason: (r.budget && r.budget.reason) || 'No itemized budget.' };

    // The federal minimum set-aside: an entered award still shows in the credits when the deal fails it.
    var msa = r.minimumSetAsideResult;
    model.setAside = msa ? { election: msa.election || null, qualifies: msa.qualifies === true, known: typeof msa.qualifies === 'boolean', reason: msa.reason || null } : null;

    // Basis and credits.
    var b = r.costBasis && r.costBasis.basis;
    if (b) {
      var rate = num(b.qualifiedBasis) && num(b.calculatedCredit) != null ? num(b.calculatedCredit) / num(b.qualifiedBasis) : null;
      model.basis = {
        eligible: num(b.eligibleBasis), grantReduction: num(b.grantReduction), boost: b.boost || {}, boosted: num(b.boostedBasis),
        applicableFraction: num(b.applicableFraction), qualified: num(b.qualifiedBasis), rate: rate, calculated: num(b.calculatedCredit),
        cap: b.cap || {}, gapMethod: b.gapMethod || {}, credit: num(r.annualCredits), creditReason: un.annualCredits || null,
        price: num(r.equityPrice), equity: num(r.equity),
        requested: num(b.requested), awarded: num(b.awarded), flags: (b.flags || []).slice(),
        requestedReason: (b.reasons || {}).requested || null, awardedReason: (b.reasons || {}).awarded || null,
        // Credit capacity can fail after the basis is done (no first mortgage, no CHFA rule); an entered award
        // then carries the credit without that test.
        capacityReason: (b.reasons || {}).capacity || null,
        acquisitionQualified: num(b.acquisitionQualified),
        // Fees above CHFA's limits come out of eligible basis before the boost (QAP 3.M.3); the tests say why.
        feeReduction: num(b.feeReduction), afterGrant: num(b.afterGrant),
        feeTests: { developer: r.costBasis.developerFee || null, contractor: r.costBasis.contractorFee || null, excess: r.costBasis.feeExcess || null },
        // Two CHFA tests the calculator leaves unchecked: the bond test on every 4% deal, and the rehab minimum
        // whenever acquisition basis earns credit.
        unchecked: [String(r.creditType) === '4' ? BOND_TEST_NOTE : null, num(b.acquisitionQualified) > 0 ? REHAB_MINIMUM_NOTE : null,
          // As in the calculator, the per-applicant caveat rides with an applied CHFA cap.
          b.cap && b.cap.applied ? APPLICANT_LIMIT_NOTE : null].filter(Boolean),
        // CHFA's third reservation test is published only in its Excel application, so the engine never runs it.
        costLimit: b.costLimitMethod && !b.costLimitMethod.checked ? (b.costLimitMethod.reason || 'CHFA\'s cost basis limits were not checked.') : null,
        // Where the basis calculation stopped; an entered award can still carry the credit past it.
        stopReason: ['eligibleBasis', 'afterGrant', 'applicableFraction', 'acquisitionRate'].map(function (k) { return (b.reasons || {})[k]; }).filter(Boolean)[0] || null
      };
    } else model.basis = { reason: 'The calculator gave no basis figures.' };

    // Rent roll: each priced row against its CHFA gross limit and the utility allowance.
    var ami = snap.amiByBr || {};
    var ua = snap.utilityAllowance || {};
    var rl = snap.rentLimits || {};
    model.utilityAllowanceApplied = !!ua.applied;
    // Owner-pays-all comes back applied with $0 allowances; not applied means the allowance is unknown.
    model.utilityAllowanceReason = ua.applied ? null : ua.reasonText || ua.reason || 'no allowance set';
    // A Market Analysis rent schedule prices each rent net of its allowance and fees and checks it against the
    // limit there; the calculator keeps only the net rent, so the workbook cannot repeat that check. Its rents
    // carry the limit table they were priced from, which can be older than the one the calculator just loaded.
    model.rentsFromSchedule = ua.reason === 'included_in_schedule_rents';
    var sm = model.rentsFromSchedule && snap.rentSchedule && snap.rentSchedule.sourceMeta;
    model.rentLimits = sm ? { source: 'CHFA rent limits used by the Market Analysis rent schedule', year: num(sm.tableYear), effective: sm.effectiveDate || null, regime: rl.regime || null }
      : { source: rl.source || null, year: num(rl.tableYear), effective: rl.effectiveDate || null, regime: rl.regime || null };
    var rentRows = (r.pricedRows || []).map(function (p) {
      var brKey = BR_KEY[String(p.bedrooms || '').toUpperCase()] || null;
      var limit = !model.rentsFromSchedule && brKey && ami[p.tier] ? num(ami[p.tier][brKey]) : null;
      var allowance = model.rentsFromSchedule ? null : ua.applied && ua.perBedroom && brKey ? num(ua.perBedroom[UA_KEY[brKey]]) : null;
      var fees = ua.applied && ua.feesPerBedroom && brKey ? (num(ua.feesPerBedroom[UA_KEY[brKey]]) || 0) : 0;
      // Market-rate rows carry their price in rent, restricted rows in contractRent.
      var rent = num(p.contractRent != null ? p.contractRent : p.rent);
      var maxNet = limit != null && allowance != null ? limit - allowance - fees : null;
      return { tier: p.tier, bedrooms: p.bedrooms, units: num(p.units), rent: rent, limit: limit, allowance: allowance, fees: fees || null,
        headroom: maxNet != null && rent != null ? maxNet - rent : null,
        // With the allowance unknown, a rent over the gross limit is still over by at least this much.
        overGross: maxNet == null && limit != null && rent != null && rent - limit > 0.5 ? rent - limit : null, annual: rent != null && num(p.units) != null ? rent * num(p.units) * 12 : null };
    });
    model.rents = { rows: rentRows, annual: num(r.annualRents), reason: un.annualRents || null };

    // Operating costs per unit, against CHFA's minimums.
    var os = r.operatingSummary || {};
    model.operating = {
      opexPerUnit: num(os.perUnitYear), reservePerUnit: num(r.repReservePerUnit), taxPerUnit: num(r.netPropTax) != null && units ? num(r.netPropTax) / units : num(r.propTaxPerUnit),
      vacancy: num(r.vacancyRate), rentGrowth: r.exit ? num(r.exit.rentGrowth) : null, expGrowth: r.exit ? num(r.exit.expGrowth) : null,
      groups: os.groups || null, min: min,
      // The engine's reason for each figure it could not give, so a skipped CHFA check says why.
      reasons: { opex: os.reason || un['operatingSummary.perUnitYear'] || null, reserve: un.repReservePerUnit || null, tax: un.netPropTax || un.propTaxPerUnit || null,
        vacancy: un.vacancyRate || null, rentGrowth: un['exit.rentGrowth'] || null, expGrowth: un['exit.expGrowth'] || null }
    };

    // 15-year cash flow, with the deferred fee balance carried down.
    var rows = (r.projection && r.projection.rows) || [];
    var dfee = num(r.deferredDevFee);
    var owed = dfee;
    // The engine keeps 50 internal rows; its forecast is the first projection.years of them.
    var horizon = num(r.projection && r.projection.years), lastYear = horizon != null ? Math.min(YEARS, horizon) : YEARS;
    model.cashFlow = {
      reason: rows.length ? null : (un.projection || 'The calculator gave no year-by-year pro forma.'),
      rows: rows.filter(function (y) { return num(y.year) != null && num(y.year) <= lastYear; }).map(function (y) {
        var paid = num(y.deferredFeePaid);
        if (owed != null && paid != null) owed = Math.max(0, owed - paid); else owed = null;
        return { year: num(y.year), grossRents: num(y.grossRents), otherIncome: num(y.otherIncome), vacancy: num(y.vacancyLoss), egi: num(y.egi),
          opex: num(y.opex), reserve: num(y.repReserve), tax: num(y.propTax), noi: num(y.noi), debtService: num(y.debtService),
          bridge: num(y.bridgeDebtService), assetMgmt: num(y.assetMgmtFee), assetMgmtOwed: num(y.assetMgmtUnpaid), contingent: num(y.contingentPaid),
          // Must-pay debt NOI could not cover stays in the loan balance, so it comes back before cash flow.
          mustPayUnpaid: num(y.mustPayUnpaid),
          cashFlow: num(y.cashFlow), dscr: num(y.dscr), seniorDscr: num(y.seniorDscr), feePaid: paid, feeOwed: owed, reason: y.unavailableReason || null };
      })
    };
    model.cashFlow.rows.forEach(function (y) { y.cashAfterAddback = y.mustPayUnpaid > 0.5 && y.cashFlow != null ? y.cashFlow + y.mustPayUnpaid : y.cashFlow; });
    // Must-pay debt left unpaid, by year. With no projection rows the engine still pays year one from current NOI.
    var obYears = ((r.obligations && r.obligations.years) || []).slice(0, lastYear);
    model.mustPayShort = (model.cashFlow.rows.length ? model.cashFlow.rows.map(function (y) { return { year: y.year, amount: y.mustPayUnpaid }; })
      : obYears.map(function (o, i) {
        var due = num(o.mustPayDebtService), paidAll = num(o.paid), cont = num(o.contingentPaid);
        return { year: num(o.year) != null ? num(o.year) : i + 1, amount: o.unavailableReason || due == null || paidAll == null || cont == null ? null : Math.max(0, due - (paidAll - cont)) };
      })).filter(function (y) { return y.amount > 0.5; });
    // With no projection rows, the last loan-schedule year with known payments still shows an accrued fee.
    var obKnown = obYears.filter(function (o) { return !o.unavailableReason && num(o.assetMgmtUnpaid) != null; });
    model.assetMgmtFallback = obKnown.length ? { year: num(obKnown[obKnown.length - 1].year), assetMgmtOwed: num(obKnown[obKnown.length - 1].assetMgmtUnpaid) } : null;
    var cov = r.coverage || {};
    // CHFA's minimum runs through year 15, so a ratio counts only when all 15 years were measured.
    var first15 = (cov.years || []).slice(0, YEARS);
    // A row counts as measured only with a ratio: with no must-pay debt the engine leaves it null without a row reason.
    function covReason(y) { return y.unavailableReason || (num(y.allMustPayCoverage) != null ? null : un.allMustPayDSCR || 'Coverage requires positive must-pay debt service.'); }
    var known15 = first15.filter(function (y) { return !covReason(y); }).length, gapReason = first15.map(covReason).filter(Boolean)[0] || null;
    // The engine's weakest year spans its whole horizon; the workbook's test is the first 15 years only.
    function weakest15(key) {
      var known = first15.filter(function (y) { return num(y[key]) != null; });
      if (!known.length) return null;
      var w = known.reduce(function (a, b) { return num(b[key]) < num(a[key]) ? b : a; });
      return { year: num(w.year), ratio: num(w[key]) };
    }
    model.coverage = { weakest: cov.years ? weakest15('allMustPayCoverage') : null, weakestSenior: cov.years ? weakest15('seniorCoverage') : null, measured: num(cov.measuredYears),
      known15: known15, full: known15 === YEARS, rows15: first15.length,
      gapReason: gapReason,
      // With no measurable year the engine's reason sits on the rows, not on un.coverage.
      reason: un.coverage || (first15.length && !known15 ? gapReason : null) };

    // Loans.
    var loans = (r.obligations && r.obligations.loans) || [];
    model.loans = loans.map(function (l) {
      // Balances and balloons stop where the calculator's forecast does, like the cash flow.
      var at15 = l.rows && l.rows[lastYear - 1] ? num(l.rows[lastYear - 1].balance) : null;
      return { label: l.senior ? 'First mortgage' : (labels[l.program] || l.program || 'Loan'), amount: num(l.amount), rate: num(l.rate),
        type: l.type, typeLabel: LOAN_TYPES[l.type] || l.type, ioYears: num(l.ioYears), amortization: num(l.amortization), maturity: num(l.maturity),
        year1: l.rows && l.rows[0] ? num(l.rows[0].due) : null, balance15: at15,
        // A loan maturing inside the workbook carries its balloon on the maturity-year row; later rows are blank.
        balloon: num(l.maturity) != null && num(l.maturity) <= lastYear ? num(((l.rows || []).filter(function (x) { return num(x.year) === num(l.maturity); })[0] || {}).maturityDue) : null };
    });
    model.loansYear = lastYear;
    model.loansReason = loans.length ? null : ((r.obligations && r.obligations.unavailableReason) || null);

    // Deferred fee.
    var feeRows = model.cashFlow.rows;
    // Payments are floating-point differences, so a balance under half a dollar is paid.
    var paidOff = dfee > 0 ? feeRows.filter(function (y) { return y.feeOwed != null && y.feeOwed < 0.5; })[0] : null;
    var gapRow = feeRows.filter(function (y) { return y.feePaid == null; })[0];
    var feePaid15 = feeRows.length < YEARS ? null : feeRows.reduce(function (s, y) { return s == null || y.feePaid == null ? null : s + y.feePaid; }, 0);
    model.deferredFee = { amount: dfee, reason: un.deferredDevFee || null, developerFee: num(r.devFeeTotal),
      share: dfee != null && num(r.devFeeTotal) ? dfee / num(r.devFeeTotal) : null,
      // A payoff after year 15 is outside this workbook: it counts as unpaid here, with the year noted.
      // The calculator looks for the payoff only within its exit hold, which can be shorter than 15 years, so
      // the year the carried balance first reaches zero counts too.
      paybackYear: paidOff ? paidOff.year : r.exit && num(r.exit.dfYr) != null && num(r.exit.dfYr) <= lastYear ? num(r.exit.dfYr) : null,
      paidLater: r.exit && num(r.exit.dfYr) > YEARS ? num(r.exit.dfYr) : null,
      payoffReason: gapRow ? 'year ' + gapRow.year + ' is not projected' + (gapRow.reason ? ' (' + gapRow.reason + ')' : '') : feeRows.length < YEARS ? 'the projection runs ' + feeRows.length + ' years, not ' + YEARS : null, owedAt15: dfee != null && feePaid15 != null ? Math.max(0, dfee - feePaid15) : null };

    // fundingGap is floored at zero; the signed gap shows a surplus when sources exceed costs.
    model.gap = { amount: num(r.gap) != null ? num(r.gap) : num(r.fundingGap), reason: un.fundingGap || null };
    model.exec = {
      credit: model.basis.credit, creditReason: model.basis.creditReason, gap: model.gap.amount, gapReason: model.gap.reason,
      weakest: model.coverage.weakest, coverageFull: model.coverage.full, coverageReason: model.coverage.reason,
      paybackYear: model.deferredFee.paybackYear, deferredFee: dfee, deferredFeeReason: model.deferredFee.reason, owedAt15: model.deferredFee.owedAt15, payoffReason: model.deferredFee.payoffReason
    };
    model.supportive = ctx && typeof ctx.supportive === 'boolean' ? ctx.supportive : null;
    model.findings = findings(model, r);
    return model;
  }

  // ── Checks, written as findings ───────────────────────────────────────────
  // Each: { level: 'bad' | 'warn' | 'ok', text, source? }. Only what the figures show; nothing guessed.
  function findings(m, r) {
    var out = [], min = m.operating.min;
    if (m.rulesMissing) out.push({ level: 'warn', text: 'CHFA\'s underwriting rules did not load, so operating cost, reserve, vacancy, growth and debt coverage were not checked against its minimums. Reload the page to check them.' });
    var thisYear = new Date().getFullYear();
    if (m.setAside && m.setAside.known && !m.setAside.qualifies) out.push({ level: 'bad', text: 'The deal does not meet its federal minimum set-aside' + (m.setAside.election ? ' (' + m.setAside.election + ' election)' : '') + ': ' + (m.setAside.reason || 'the calculator found it short') + '. No unit counts toward the credit, so the credit and equity shown are not supported.' });
    if (m.rentLimits.regime && m.rentLimits.regime !== 'chfa_lihtc') out.push({ level: 'warn', text: 'Rents use ' + m.rentLimits.regime + ' limits, not CHFA tax credit limits.' });
    if (m.rentLimits.year != null && m.rentLimits.year < thisYear) out.push({ level: 'warn', text: 'Rent limits are the ' + m.rentLimits.year + ' tables. Check for newer CHFA tables before relying on these rents.' });
    if (m.rentLimits.year != null) out.push({ level: 'ok', text: 'Rent limits: ' + (m.rentLimits.source || 'CHFA') + (m.rentLimits.effective ? ', effective ' + m.rentLimits.effective : '') + '.' });
    var over = m.rents.rows.filter(function (x) { return x.headroom != null && x.headroom < -0.5; });
    over.forEach(function (x) { out.push({ level: 'bad', text: x.tier + '% AMI ' + x.bedrooms + ' rent of ' + money(x.rent) + ' is ' + money(-x.headroom) + ' over the most it can charge (' + money(x.limit) + ' gross limit' + (x.allowance ? ' less ' + money(x.allowance) + ' utility allowance' : '') + (x.fees ? ' less ' + money(x.fees) + ' in resident-paid fees' : '') + ').' }); });
    m.rents.rows.filter(function (x) { return x.overGross != null; }).forEach(function (x) { out.push({ level: 'bad', text: x.tier + '% AMI ' + x.bedrooms + ' rent of ' + money(x.rent) + ' is over its ' + money(x.limit) + ' gross limit before any utility allowance, by at least ' + money(x.overGross) + '.' }); });
    if (m.rentsFromSchedule && m.rents.rows.length) out.push({ level: 'ok', text: 'Rents come from the Market Analysis rent schedule, which takes out each utility allowance and fee and checks the rent against its limit. Check the limits there.' });
    else if (!m.utilityAllowanceApplied && m.rents.rows.length) out.push({ level: 'warn', text: 'The Deal Calculator did not apply a utility allowance (' + m.utilityAllowanceReason + '), so each rent is an upper bound and was not checked against its limit. Set the allowance in Market Analysis, Subject project.' });

    var o = m.operating;
    // CHFA's minimum excludes only the reserve, so property tax counts toward it.
    var opexAll = o.opexPerUnit != null && o.taxPerUnit != null ? o.opexPerUnit + o.taxPerUnit : null;
    var opexLabel = 'Operating cost plus property tax of ' + money(opexAll) + ' a unit';
    if (min.opex && o.opexPerUnit != null && opexAll == null && o.opexPerUnit < min.opex.value) out.push({ level: 'warn', text: 'Operating cost of ' + money(o.opexPerUnit) + ' a unit is under CHFA\'s ' + money(min.opex.value) + ' minimum before property tax, which is not known. Enter the property tax to check it.', source: min.opex });
    else if (min.opex && opexAll != null && opexAll < min.opex.value) out.push({ level: 'bad', text: opexAll === o.opexPerUnit ? 'Operating cost of ' + money(o.opexPerUnit) + ' a unit is under CHFA\'s ' + money(min.opex.value) + ' minimum.' : opexLabel + ' is under CHFA\'s ' + money(min.opex.value) + ' minimum.', source: min.opex });
    // The calculator does not record project-based Section 8, so a cost between the two minimums is flagged, not passed.
    else if (min.opex && min.opexSection8 && opexAll != null && opexAll < min.opexSection8.value) out.push({ level: 'warn', text: (opexAll === o.opexPerUnit ? 'Operating cost of ' + money(o.opexPerUnit) + ' a unit' : opexLabel) + ' meets CHFA\'s ' + money(min.opex.value) + ' minimum but not the ' + money(min.opexSection8.value) + ' it requires for project-based Section 8. Confirm the deal has no project-based Section 8.', source: min.opexSection8 });
    var sr = m.sources || {};
    if (sr.overMaxLoan > 0.5) out.push({ level: 'bad', text: 'Hard debt of ' + money(sr.hardDebt) + ' is ' + money(sr.overMaxLoan) + ' above the lower maximum loan (' + money(sr.maxLoan) + ') that the cap rate or appraisal supports.' });
    // CHFA's minimum is higher for projects that provide additional services, with no figure published. A supportive
    // deal that clears the base minimum is not settled by it; a deal not known either way says what was measured.
    // Only a cost known to meet the base minimum gets these notes; one still waiting on the tax has its own warning.
    if (min.opex && o.opexPerUnit != null && (opexAll != null ? opexAll : o.opexPerUnit) >= min.opex.value) {
      if (m.supportive === true) out.push({ level: 'warn', text: 'This is a supportive housing deal. CHFA requires a higher operating cost minimum for projects that provide additional services and publishes no figure, so the ' + money(min.opex.value) + ' check does not settle it. Confirm the budget with CHFA.', source: min.opex });
      else if (m.supportive == null) out.push({ level: 'ok', text: 'Operating cost was checked against CHFA\'s ' + money(min.opex.value) + ' minimum. CHFA requires more, with no figure published, for projects that provide additional services; if this deal does, confirm the budget with CHFA.', source: min.opex });
    }
    var resMin = min.reserve;
    // The calculator does not record whether a deal is senior housing. Under the senior minimum is a failure either
    // way; between the two minimums it depends on the deal type, so it is a question, as with Section 8.
    if (resMin && o.reservePerUnit != null && o.reservePerUnit < resMin.value) {
      var seniorOk = min.reserveSenior && o.reservePerUnit >= min.reserveSenior.value;
      out.push({ level: seniorOk ? 'warn' : 'bad', text: 'Replacement reserve of ' + money(o.reservePerUnit) + ' a unit is under CHFA\'s ' + money(resMin.value) + ' family minimum' +
        (seniorOk ? ' (it meets the ' + money(min.reserveSenior.value) + ' senior minimum, so it holds only if this is senior housing). Confirm the deal type.' : '.'), source: resMin });
    }
    // Under the Section 8 floor no deal type passes; between the two it holds only with Section 8 on every unit.
    if (min.vacancy && o.vacancy != null && o.vacancy < min.vacancy.value - 1e-9) {
      var v8 = min.vacancySection8, underAll = !v8 || o.vacancy < v8.value - 1e-9;
      out.push({ level: underAll ? 'bad' : 'warn', text: 'Vacancy of ' + pct(o.vacancy, 1) + ' is under CHFA\'s ' + pct(min.vacancy.value) + ' minimum' +
        (v8 ? (underAll ? ' and under the ' + pct(v8.value) + ' it allows with project-based Section 8 on every unit.' : '; ' + pct(v8.value) + ' holds only with project-based Section 8 on every unit. Confirm the deal has it.') : '.'), source: underAll && v8 ? v8 : min.vacancy });
    }
    if (min.rentGrowth && o.rentGrowth != null && o.rentGrowth > min.rentGrowth.value + 1e-9) out.push({ level: 'warn', text: 'Rents grow ' + pct(o.rentGrowth, 1) + ' a year; CHFA underwrites ' + pct(min.rentGrowth.value) + '.', source: min.rentGrowth });
    if (min.expGrowth && o.expGrowth != null && o.expGrowth < min.expGrowth.value - 1e-9) out.push({ level: 'warn', text: 'Costs grow ' + pct(o.expGrowth, 1) + ' a year; CHFA underwrites ' + pct(min.expGrowth.value) + '.', source: min.expGrowth });
    // A check with no figure did not run: say so, rather than leave a dash that reads as a pass.
    var rs = o.reasons || {};
    [['operating cost', min.opex, o.opexPerUnit, rs.opex],
      // A low cost with no tax is already flagged above; otherwise the missing tax still stops the full check.
      // Tax is never negative, so a cost that alone meets the highest minimum passes whatever the tax.
      ['operating cost plus property tax', min.opex, o.opexPerUnit == null || o.opexPerUnit < (min.opex ? min.opex.value : 0) ||
        o.opexPerUnit >= Math.max(min.opex ? min.opex.value : 0, min.opexSection8 ? min.opexSection8.value : 0) ? 0 : o.taxPerUnit, rs.tax],
      ['replacement reserve', resMin, o.reservePerUnit, rs.reserve], ['vacancy', min.vacancy, o.vacancy, rs.vacancy],
      ['rent growth', min.rentGrowth, o.rentGrowth, rs.rentGrowth], ['cost growth', min.expGrowth, o.expGrowth, rs.expGrowth]
    ].forEach(function (c) {
      if (c[1] && c[2] == null) out.push({ level: 'warn', text: 'CHFA\'s ' + c[0] + ' check did not run: ' + (c[3] || 'the calculator gave no figure') + '.', source: c[1] });
    });

    var w = m.coverage.weakest;
    if (w && min.dscr && num(w.ratio) != null) {
      if (w.ratio < min.dscr.value) out.push({ level: 'bad', text: 'Debt coverage on all must-pay debt falls to ' + ratio(w.ratio) + ' in year ' + w.year + ', under CHFA\'s ' + ratio(min.dscr.value) + ' minimum.', source: min.dscr });
      else if (!m.coverage.full) out.push({ level: 'warn', text: 'Debt coverage was measured for ' + m.coverage.known15 + ' of the first ' + YEARS + ' years (weakest ' + ratio(w.ratio) + ' in year ' + w.year + '). CHFA\'s ' + ratio(min.dscr.value) + ' minimum runs through year ' + YEARS + '; ' +
        // A row's own reason (an unpaid maturity, say) is the remedy; the horizon only matters when rows are missing.
        [m.coverage.gapReason ? 'later years are not measured: ' + m.coverage.gapReason.replace(/\.$/, '') : null,
          m.coverage.rows15 < YEARS ? 'set the calculator to project ' + YEARS + ' years' : null].filter(Boolean).join('; ') + '.', source: min.dscr });
      else out.push({ level: 'ok', text: 'Debt coverage on all must-pay debt stays at or above ' + ratio(w.ratio) + ' (weakest: year ' + w.year + '); CHFA\'s minimum is ' + ratio(min.dscr.value) + '.', source: min.dscr });
    } else if (m.coverage.reason) out.push({ level: 'warn', text: 'Debt coverage is not available: ' + m.coverage.reason });
    // Year-one coverage can be known without projection rows (bad growth inputs), so fall back to the engine's check.
    var y1 = m.cashFlow.rows[0], hc = (r && r.costBasis && r.costBasis.underwriting && r.costBasis.underwriting.high) || {};
    var y1dscr = y1 && y1.dscr != null ? y1.dscr : num(hc.firstYear);
    if (y1dscr != null && min.high && y1dscr > min.high.value) out.push({ level: 'warn', text: 'Year-one coverage of ' + ratio(y1dscr) + ' is above ' + ratio(min.high.value) + ', so CHFA may award less credit. A larger loan or lower rents would bring it down.', source: min.high });

    m.loans.forEach(function (l) {
      if (!l.amount) return;
      if (l.type === 'interest_only' || l.type === 'io_then_amortizing') out.push({ level: 'warn', text: l.label + ' is modeled ' + (l.type === 'interest_only' ? 'interest-only to maturity' : 'interest-only for ' + l.ioYears + ' years') + '. Get that term in the lender\'s letter; an amortizing loan would cost more each year.' });
      if (l.balloon != null && l.balloon > 0.5) out.push({ level: 'warn', text: l.label + ' matures in year ' + l.maturity + ' with ' + money(l.balloon) + ' due. The calculator assumes no refinancing, so years after that are not projected.' });
    });

    var cap = m.basis.cap || {};
    if (cap.binding) out.push({ level: 'warn', text: 'CHFA\'s per-project credit limit (' + money(num(cap.amount)) + ') holds the credit below what the basis supports.', source: cap.citation ? { where: cap.citation } : null });
    var gm = m.basis.gapMethod || {};
    if (gm.binding) out.push({ level: 'warn', text: 'CHFA\'s gap method limits the credit: the deal needs only ' + money(num(gm.credit)) + ' a year to fill its gap.', source: gm.citation ? { where: gm.citation } : null });
    if (m.basis.stopReason) out.push({ level: 'warn', text: 'Eligible and qualified basis were not fully calculated: ' + m.basis.stopReason.replace(/\.$/, '') + '.' + (m.basis.credit != null ? ' The yearly credit shown is the entered award, not one the basis supports.' : '') });
    if (m.basis.capacityReason) out.push({ level: 'warn', text: 'The credit capacity CHFA allows was not established: ' + m.basis.capacityReason.replace(/\.$/, '') + '.' + (m.basis.credit != null ? ' The yearly credit shown is not tested against it.' : '') });
    var ft = m.basis.feeTests || {}, fx = ft.excess || {};
    [['Developer plus consultant fee', 'Developer fee', ft.developer, fx.developer], ['Contractor overhead and profit', 'Contractor fee', ft.contractor, fx.contractor]].forEach(function (t) {
      var f = t[2]; if (!f) return;
      if (f.passes == null) out.push({ level: 'warn', text: 'CHFA\'s ' + t[1].toLowerCase() + ' limit was not checked: ' + String(f.reason || 'the test could not run').replace(/\.$/, '') + '.' });
      else if (f.passes) out.push({ level: 'ok', text: t[0] + ' of ' + money(num(f.fee)) + ' is within CHFA\'s ' + Math.round(num(f.limitPct) * 100) + '% limit of ' + money(num(f.limit)) + '.' });
      else { var inBasis = num(t[3]);
        // A fee split between basis and outside it leaves the reduction unresolved; the engine says why rather than a number.
        out.push({ level: 'bad', text: t[0] + ' of ' + money(num(f.fee)) + ' is above CHFA\'s ' + Math.round(num(f.limitPct) * 100) + '% limit of ' + money(num(f.limit)) + '. '
          + (inBasis != null ? money(inBasis) + ' of the excess comes out of eligible basis (QAP 3.M.3).' : String(fx.reason || 'How much of the excess comes out of eligible basis was not established.').replace(/\.?$/, '.') + ' (QAP 3.M.3)') }); }
    });
    (m.basis.unchecked || []).forEach(function (n) { if (m.basis.calculated != null || m.basis.credit != null) out.push({ level: 'warn', text: 'Not checked: ' + n }); });
    (m.basis.flags || []).forEach(function (f) { out.push({ level: 'warn', text: 'Credit: ' + f }); });
    if (m.basis.costLimit && m.basis.calculated != null) out.push({ level: 'warn', text: 'CHFA\'s cost basis limit (Method Three) was not checked: ' + m.basis.costLimit.replace(/\.$/, '') + '. Check the credit against it in CHFA\'s application.' });
    // No designation, or one that does not apply to this credit type, is a settled answer; a designation left
    // without its evidence, award or rule is an open input that took the boost out of the credit.
    var bst = m.basis.boost;
    if (bst && bst.applied === false && bst.reason) {
      var settled = /^No QCT, DDA, SADDA or CHFA designation selected|applies only to \d/.test(bst.reason);
      out.push({ level: settled ? 'ok' : 'warn', text: (settled ? 'No basis boost: ' : 'The basis boost was left out of the credit: ') + bst.reason });
    }

    var df = m.deferredFee;
    // Unknown is not the same as none: the engine says why it could not size the fee.
    if (df.amount == null) out.push({ level: 'warn', text: 'The deferred developer fee is not known: ' + (df.reason || 'the calculator did not size it') + '.' });
    else if (df.amount) {
      if (df.paybackYear != null) out.push({ level: 'ok', text: 'The deferred fee of ' + money(df.amount) + ' is paid off from cash flow in year ' + df.paybackYear + '.' });
      else if (df.owedAt15 == null) out.push({ level: 'warn', text: 'Whether the deferred fee is paid off in 15 years is not known: ' + (df.payoffReason || 'the cash flow is incomplete') + '.' });
      else out.push({ level: 'bad', text: 'The deferred fee is not paid off in 15 years: ' + money(df.owedAt15) + ' of ' + money(df.amount) + ' is still owed' + (df.paidLater ? ' (paid off in year ' + df.paidLater + ')' : '') + '.' });
    }
    var cfRows = m.cashFlow.rows || [];
    var shortYears = m.mustPayShort || [];
    if (shortYears.length) out.push({ level: 'bad', text: 'Net operating income does not cover must-pay debt service in ' + shortYears.length + (shortYears.length === 1 ? ' year' : ' years') + ' (first in year ' + shortYears[0].year + '): ' + money(shortYears.reduce(function (a, y) { return a + y.amount; }, 0)) + ' is left unpaid and added to the loan balance.' });
    var amLast = cfRows.length ? cfRows[cfRows.length - 1] : (m.assetMgmtFallback || null);
    if (amLast && amLast.assetMgmtOwed > 0.5) out.push({ level: 'warn', text: 'Asset management fees of ' + money(amLast.assetMgmtOwed) + ' are still owed at the end of year ' + amLast.year + '; cash flow did not cover them.' });
    if (m.gap.amount != null) {
      if (m.gap.amount > 0.5) out.push({ level: 'bad', text: 'The deal is ' + money(m.gap.amount) + ' short after every source modeled.' });
      else if (m.gap.amount < -0.5) out.push({ level: 'ok', text: 'Sources exceed costs by ' + money(-m.gap.amount) + '.' });
      else out.push({ level: 'ok', text: 'Sources cover costs.' });
    } else if (m.gap.reason) out.push({ level: 'warn', text: 'Funding gap is not available: ' + m.gap.reason });
    var rank = { bad: 0, warn: 1, ok: 2 };
    return out.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
  }

  // ── HTML (pure) ───────────────────────────────────────────────────────────
  function table(head, rows, opts) {
    var numCols = (opts && opts.num) || [];
    // Statements (sources, uses, operating lines, the cash flow) keep their accounting order; lists can sort.
    return '<div class="sr-scroll"><table class="sr-table"' + (opts && opts.fixed ? ' data-no-sort' : '') + '><thead><tr>' + head.map(function (h, i) {
      return '<th scope="col"' + (numCols.indexOf(i) !== -1 ? ' class="sr-num"' : '') + '>' + esc(h) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
      var cls = r.cls ? ' class="' + r.cls + '"' : '';
      return '<tr' + cls + '>' + r.cells.map(function (c, i) { return '<td' + (numCols.indexOf(i) !== -1 ? ' class="sr-num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  function tile(v, label, cls) { return '<div class="rw-stat ' + (cls || '') + '"><div class="rw-stat-v">' + v + '</div>' + label + '</div>'; }
  function quote(src) { return src && (src.quote || src.where) ? '<div class="rw-quote">' + (src.quote ? '"' + esc(src.quote) + '" ' : '') + (src.where ? esc(src.where) : '') + '</div>' : ''; }

  function render(m, title) {
    if (!m || m.error) return '<p class="sr-flag">' + esc((m && m.error) || 'Nothing to show.') + '</p>';
    var e = m.exec, h = '';
    var w = e.weakest;
    var minDscr = m.operating.min.dscr ? m.operating.min.dscr.value : null;
    h += '<section class="dv-card rw-decide" aria-labelledby="wbExec"><h2 id="wbExec">Executive view' + (title ? ': ' + esc(title) : '') + '</h2><div class="rw-stats">' +
      tile(e.credit == null ? '—' : esc(money(e.credit)), e.credit == null ? 'Yearly credit: ' + esc(e.creditReason || 'not available') : 'Yearly federal credit (' + esc(m.creditType === '4' ? '4%' : '9%') + ')') +
      tile(e.gap == null ? '—' : esc(money(e.gap < -0.5 ? -e.gap : e.gap)), e.gap == null ? 'Funding gap: ' + esc(e.gapReason || 'not available') : e.gap < -0.5 ? 'Surplus: sources exceed costs' : 'Funding gap after every modeled source', e.gap == null ? '' : e.gap > 0.5 ? 'sr-bad' : 'sr-ok') +
      tile(w ? esc(ratio(w.ratio)) : '—', w ? 'Weakest debt coverage, all must-pay debt (year ' + w.year + ')' : 'Debt coverage: ' + esc(e.coverageReason || 'not available'), w && minDscr != null ? (w.ratio < minDscr ? 'sr-bad' : e.coverageFull ? 'sr-ok' : '') : '') +
      tile(e.paybackYear != null ? 'Year ' + e.paybackYear : (e.deferredFee && e.owedAt15 != null ? 'Not in 15 yrs' : '—'),
        e.deferredFee == null ? 'Deferred fee: not known, ' + esc(e.deferredFeeReason || 'not available') :
          !e.deferredFee ? 'No deferred developer fee' : e.paybackYear != null ? 'Deferred fee of ' + esc(money(e.deferredFee)) + ' paid off' :
          e.owedAt15 != null ? 'Deferred fee of ' + esc(money(e.deferredFee)) + ': ' + esc(money(e.owedAt15)) + ' still owed at year 15' :
          'Deferred fee payoff: not known, ' + esc(e.payoffReason || 'cash flow incomplete'),
        e.deferredFee && e.paybackYear == null && e.owedAt15 != null ? 'sr-bad' : '') +
      '</div>';
    var top = m.findings.filter(function (f) { return f.level !== 'ok'; });
    h += top.length ? '<h3>What to check</h3><ul>' + top.map(function (f) { return '<li class="' + (f.level === 'bad' ? 'sr-red' : 'sr-yellow') + '">' + esc(f.text) + quote(f.source) + '</li>'; }).join('') + '</ul>'
      : '<p>Nothing in the figures needs a second look.</p>';
    var oks = m.findings.filter(function (f) { return f.level === 'ok'; });
    if (oks.length) h += '<details><summary>Already right (' + oks.length + ')</summary><ul>' + oks.map(function (f) { return '<li>' + esc(f.text) + quote(f.source) + '</li>'; }).join('') + '</ul></details>';
    h += '</section>';

    // Sources and uses
    var s = m.sources, u = m.uses;
    h += '<section class="dv-card" aria-labelledby="wbSU"><h2 id="wbSU">Sources and uses</h2><div class="wb-two"><div><h3>Sources</h3>';
    h += s.rows.length ? table(['Source', 'Amount', 'Share'], s.rows.map(function (x) {
      return { cells: [esc(x.label), esc(money(x.amount)), esc(s.tdc && x.amount != null ? pct(x.amount / s.tdc) : '—')] };
    }).concat([{ cls: 'sr-total', cells: ['Total sources', esc(money(s.total)), esc(s.tdc && s.total != null ? pct(s.total / s.tdc) : '—')] }])
      .concat(s.gap != null && Math.abs(s.gap) > 0.5 ? [{ cls: 'sr-total', cells: [s.gap > 0 ? 'Gap' : 'Surplus', esc(money(Math.abs(s.gap))), esc(s.tdc ? pct(Math.abs(s.gap) / s.tdc) : '—')] }] : []), { num: [1, 2], fixed: true })
      : '<p class="sr-muted">' + esc(s.reason) + '</p>';
    if (s.overMaxLoan > 0.5) h += '<p class="sr-muted">Hard debt is ' + esc(money(s.overMaxLoan)) + ' above the lower maximum loan of ' + esc(money(s.maxLoan)) + '.</p>';
    h += '</div><div><h3>Uses</h3>';
    // A budget with nothing itemized still shows its one "Not itemized" line rather than a bare total.
    h += u.rows.length || u.notItemized > 0.5 ? table(['Use', 'Amount', 'Per home'], u.rows.map(function (x) {
      return { cells: [esc(x.label), esc(money(x.amount)), esc(m.units ? money(x.amount / m.units) : '—')] };
    }).concat(u.notItemized > 0.5 ? [{ cells: ['Not itemized', esc(money(u.notItemized)), esc(m.units ? money(u.notItemized / m.units) : '—')] }] : [])
      .concat([{ cls: 'sr-total', cells: ['Total development cost', esc(money(u.tdc)), esc(m.units ? money(u.tdc / m.units) : '—')] }]), { num: [1, 2], fixed: true })
      : '<p class="sr-muted">' + esc(u.reason) + ' Total development cost: ' + esc(money(u.tdc)) + '.</p>';
    h += '</div></div></section>';

    // Basis and credits
    var b = m.basis;
    h += '<section class="dv-card" aria-labelledby="wbBasis"><h2 id="wbBasis">Eligible basis and credits</h2>';
    if (b.reason) h += '<p class="sr-muted">' + esc(b.reason) + '</p>';
    else {
      if (b.stopReason) h += '<p class="sr-muted">Basis not fully calculated: ' + esc(b.stopReason) + '</p>';
      var br = [['Eligible basis', money(b.eligible)]];
      if (b.feeReduction > 0.5) br.push(['Less fees above CHFA\'s limits', money(-b.feeReduction)]);
      if (b.grantReduction) br.push(['Less federal grants', money(-b.grantReduction)]);
      if (b.feeReduction > 0.5 || b.grantReduction) br.push(['Basis after fees and grants', money(b.afterGrant)]);
      br.push(['Basis boost', b.boost && b.boost.applied ? '×' + num(b.boost.multiplier) : 'None']);
      // The boost skips acquisition basis, so the boosted total is shown rather than left to the multiplier.
      if (b.boost && b.boost.applied) {
        var acqBasis = b.acquisitionQualified > 0 && b.applicableFraction > 0 ? b.acquisitionQualified / b.applicableFraction : 0;
        br.push([acqBasis > 0.5 ? 'Basis after boost (the boost skips ' + money(acqBasis) + ' of acquisition basis)' : 'Basis after boost', money(b.boosted)]);
      }
      br.push(['Applicable fraction', pct(b.applicableFraction, 1)]);
      br.push(['Qualified basis', money(b.qualified)]);
      br.push(['Credit rate', b.rate == null ? '—' : pct(b.rate, 2)]);
      br.push(['Credit the basis supports', money(b.calculated)]);
      if (b.cap && b.cap.applied) br.push(['CHFA per-project limit', money(num(b.cap.amount))]);
      if (b.gapMethod && b.gapMethod.applied) br.push(['Credit to fill the gap (CHFA gap method)', money(num(b.gapMethod.credit))]);
      br.push(['Credit requested', b.requested == null ? '— ' + (b.requestedReason || '') : money(b.requested)]);
      br.push(['Credit awarded', b.awarded == null ? '— ' + (b.awardedReason || '') : money(b.awarded)]);
      if (b.capacityReason) br.push(['Credit capacity', '— ' + b.capacityReason]);
      br.push(['Yearly credit used', b.credit == null ? '— ' + (b.creditReason || '') : money(b.credit)]);
      br.push(['Equity price', b.price == null ? '—' : '$' + b.price.toFixed(3)]);
      br.push(['Credit equity (10 years of credit × price)', money(b.equity)]);
      h += table(['Line', 'Amount'], br.map(function (x) { return { cells: [esc(x[0]), esc(x[1])] }; }), { num: [1], fixed: true });
      if (b.costLimit) h += '<p class="sr-muted">Not checked: ' + esc(b.costLimit) + '</p>';
      (b.unchecked || []).forEach(function (n) { h += '<p class="sr-muted">' + esc(n) + '</p>'; });
    }
    h += '</section>';

    // Rents
    var rr = m.rents;
    h += '<section class="dv-card" aria-labelledby="wbRents"><h2 id="wbRents">Rents by AMI tier</h2>';
    h += rr.rows.length ? table(['AMI', 'Size', 'Homes', 'Rent', 'Gross limit', 'Utility allowance', 'Room under limit', 'Rent a year'], rr.rows.map(function (x) {
      return { cls: x.headroom != null && x.headroom < -0.5 ? 'sr-diff' : '', cells: [esc(typeof x.tier === 'number' ? x.tier + '%' : 'Market rate'), esc(x.bedrooms), esc(x.units), esc(money(x.rent)), esc(m.rentsFromSchedule ? 'In schedule' : money(x.limit)),
        esc(m.rentsFromSchedule ? 'In schedule' : x.allowance == null ? '—' : money(x.allowance + (x.fees || 0))), esc(x.headroom == null ? '—' : money(x.headroom)), esc(money(x.annual))] };
    }).concat([{ cls: 'sr-total', cells: ['Total', '', esc(rr.rows.reduce(function (a, x) { return a + (x.units || 0); }, 0)), '', '', '', '', esc(money(rr.annual))] }]), { num: [2, 3, 4, 5, 6, 7] })
      : '';
    if (rr.reason || !rr.rows.length) h += '<p class="sr-muted">' + esc(rr.reason || 'No rents.') + '</p>';
    if (m.rentLimits.source) h += '<p class="sr-muted">Limits: ' + esc(m.rentLimits.source) + (m.rentLimits.effective ? ', effective ' + esc(m.rentLimits.effective) : '') + '.' + (m.rentsFromSchedule ? ' Rents are net of the allowances and fees set in the Market Analysis rent schedule.' : m.utilityAllowanceApplied ? ' Allowance column includes any tenant-paid fees.' : ' No utility allowance applied (' + esc(m.utilityAllowanceReason) + ').') + '</p>';
    h += '</section>';

    // Operating
    var o = m.operating, mn = o.min;
    var opRows = [
      ['Operating cost a home a year (before reserves and tax)', money(o.opexPerUnit), '—'],
      ['Operating cost plus property tax (what CHFA\'s minimum counts)', money(o.opexPerUnit != null && o.taxPerUnit != null ? o.opexPerUnit + o.taxPerUnit : null), mn.opex ? money(mn.opex.value) + ' minimum' + (mn.opexSection8 ? ' (' + money(mn.opexSection8.value) + ' with project-based Section 8)' : '') : '—'],
      ['Replacement reserve a home a year', money(o.reservePerUnit), mn.reserve ? money(mn.reserve.value) + ' family, ' + (mn.reserveSenior ? money(mn.reserveSenior.value) + ' senior' : '') : '—'],
      ['Property tax a home a year', money(o.taxPerUnit), ''],
      ['Vacancy', pct(o.vacancy, 1), mn.vacancy ? pct(mn.vacancy.value) + ' minimum' : '—'],
      ['Rent growth a year', pct(o.rentGrowth, 1), mn.rentGrowth ? pct(mn.rentGrowth.value) : '—'],
      ['Cost growth a year', pct(o.expGrowth, 1), mn.expGrowth ? pct(mn.expGrowth.value) : '—']
    ];
    h += '<section class="dv-card" aria-labelledby="wbOp"><h2 id="wbOp">Operating costs and assumptions</h2>' +
      table(['Line', 'This deal', 'CHFA underwriting'], opRows.map(function (x) { return { cells: [esc(x[0]), esc(x[1]), esc(x[2])] }; }), { num: [1], fixed: true }) +
      '<p class="sr-muted">CHFA figures: ' + esc(mn.opex ? mn.opex.where.replace(/, Section.*$/, '') : 'not on file') + ', Section 4.B and 4.C.</p></section>';

    // Loans
    if (!m.loans.length && m.loansReason) h += '<section class="dv-card" aria-labelledby="wbLoans"><h2 id="wbLoans">Loans</h2><p class="sr-muted">' + esc('Loan details are not available: ' + m.loansReason) + '</p></section>';
    if (m.loans.length) {
      h += '<section class="dv-card" aria-labelledby="wbLoans"><h2 id="wbLoans">Loans</h2>' + table(['Loan', 'Amount', 'Rate', 'Repayment', 'Amortization', 'Maturity', 'Year-1 payment', 'Owed after year ' + m.loansYear], m.loans.map(function (l) {
        return { cells: [esc(l.label), esc(money(l.amount)), esc(l.rate == null ? '—' : l.rate + '%'), esc(l.typeLabel + (l.type === 'io_then_amortizing' ? ' (' + l.ioYears + ' yrs)' : '')),
          esc(l.amortization == null ? '—' : l.amortization + ' yrs'), esc(l.maturity == null ? '—' : 'Year ' + l.maturity), esc(money(l.year1)), esc(money(l.balance15))] };
      }), { num: [1, 2, 6, 7] }) + '</section>';
    }

    // Cash flow
    var cf = m.cashFlow;
    h += '<section class="dv-card" aria-labelledby="wbCF"><h2 id="wbCF">' + ((cf.rows && cf.rows.length) || 15) + '-year cash flow</h2>';
    if (cf.rows.length) {
      var lines = [
        ['Gross rent', 'grossRents'], ['Other income', 'otherIncome'], ['Less vacancy', 'vacancy', -1], ['Effective gross income', 'egi', 1, true],
        ['Operating costs', 'opex', -1], ['Replacement reserve', 'reserve', -1], ['Property tax', 'tax', -1], ['Net operating income', 'noi', 1, true],
        ['Must-pay debt service', 'debtService', -1], ['Bridge loan payments', 'bridge', -1], ['Asset management fee paid', 'assetMgmt', -1],
        ['Cash-flow loan payments', 'contingent', -1], ['Cash flow', 'cashFlow', 1, true],
        // Unpaid must-pay debt was subtracted above in full; it stays in the loan balance, so it comes back as cash.
        ['Add back debt service left unpaid (added to the loan balance)', 'mustPayUnpaid'], ['Cash left after the add-back', 'cashAfterAddback', 1, true], ['Coverage, all must-pay debt', 'dscr', 'x'], ['Coverage, first mortgage', 'seniorDscr', 'x'],
        ['Deferred fee paid', 'feePaid'], ['Deferred fee still owed', 'feeOwed'], ['Asset management fee still owed', 'assetMgmtOwed']
      ];
      // Every deduction between NOI and cash flow is shown when the deal has it, so the rows reconcile.
      var optional = ['bridge', 'assetMgmt', 'contingent', 'mustPayUnpaid', 'assetMgmtOwed'];
      var addback = cf.rows.some(function (y) { return y.mustPayUnpaid > 0.5; });
      lines = lines.filter(function (ln) { return ln[1] === 'cashAfterAddback' ? addback : optional.indexOf(ln[1]) < 0 || cf.rows.some(function (y) { return y[ln[1]] == null || Math.abs(y[ln[1]]) > 0.5; }); });
      var head = ['Year'].concat(cf.rows.map(function (y) { return String(y.year); }));
      var body = lines.map(function (ln) {
        return { cls: ln[3] ? 'sr-total' : '', cells: [esc(ln[0])].concat(cf.rows.map(function (y) {
          var v = y[ln[1]];
          if (ln[2] === 'x') return esc(ratio(v));
          if (v == null) return '—';
          return esc(money(ln[2] === -1 ? -v : v));
        })) };
      });
      h += '<div class="wb-cf">' + table(head, body, { num: cf.rows.map(function (_, i) { return i + 1; }), fixed: true }) + '</div>';
    } else h += '<p class="sr-muted">' + esc(cf.reason) + '</p>';
    h += '</section>';
    return h;
  }

  // A pasted link or file is untrusted text. Rebuild it as parsed name/value pairs
  // on a same-folder deal-calculator.html URL, so nothing else can ride along.
  function calcUrl(query, base) {
    var u = new URL('deal-calculator.html', base);
    var clean = new URLSearchParams();
    new URLSearchParams(String(query || '')).forEach(function (v, k) { clean.append(k, v); });
    u.search = clean.toString();
    return u.href;
  }

  // ── Market (pure) ─────────────────────────────────────────────────────────
  // Figures the site already holds, for the deal's county. A screen, not a market study: a study measures a
  // primary market area drawn around the site; these are county figures.
  var MARKET_URLS = {
    renters: 'data/co_ami_gap_by_county.json',        // ACS B25118 renter households by income, against HUD AMI
    zori: 'data/market/zori_rents_co.json',           // Zillow ZORI by county, latest month and year-over-year
    zoriMetro: 'data/zillow/zori_metro.csv',          // Zillow ZORI by metro, monthly history
    acsRent: 'data/market/acs_median_rent_co.json',   // ACS B25064 median gross rent
    bedroomMix: 'data/market/acs_renter_bedrooms_co.json',
    deals: 'data/deals/index.json'                    // hand-researched CHFA award summaries, 2022 on
  };
  // Rent at the tier's limit is 30% of the tier's income ceiling. A household paying it at no more than 40% of
  // income earns at least 30/40 = 75% of that ceiling. A home priced under its limit lowers that floor in step:
  // gross cost at half the limit lets households from 37.5% of the tier rent it.
  var MAX_RENT_SHARE = 0.40;
  var FLOOR_SHARE = 0.30 / MAX_RENT_SHARE;
  var TREND_YEARS = 5;
  var PIPELINE_YEARS = 5;

  // Renter households at or below pct% AMI, read straight between the published points (0, 30, 40 ... 100).
  function rentersAtOrBelow(le, pct) {
    var pts = [[0, 0]];
    Object.keys(le || {}).forEach(function (k) { var x = num(k), y = num(le[k]); if (x != null && y != null) pts.push([x, y]); });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    if (pts.length < 2 || pct > pts[pts.length - 1][0]) return null;
    for (var i = 1; i < pts.length; i++) {
      if (pct <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        return a[1] + (b[1] - a[1]) * (pct - a[0]) / (b[0] - a[0]);
      }
    }
    return null;
  }

  // One CSV row by its RegionName, without loading every metro into objects.
  // The county file can carry a metro's longer name ("Denver-Aurora-Lakewood, CO") where the metro CSV
  // uses its first city ("Denver, CO"), so the short form is tried when the full name is not there.
  function zoriMetroSeries(csv, metro) {
    if (!csv || !metro) return null;
    var short = String(metro).replace(/^([^,-]+)-[^,]+(, [A-Z]{2})$/, '$1$2');
    var lines = String(csv).split(/\r?\n/), head = splitCsv(lines[0]);
    var nameCol = head.indexOf('RegionName');
    var found = null;
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].indexOf(metro) === -1 && lines[i].indexOf(short) === -1) continue;
      var row = splitCsv(lines[i]);
      if (row[nameCol] === metro) { found = row; break; }
      if (row[nameCol] === short && !found) found = row;
    }
    if (!found) return null;
    var out = [];
    head.forEach(function (h, j) { if (/^\d{4}-\d{2}-\d{2}$/.test(h) && num(found[j]) != null) out.push({ month: h, rent: num(found[j]) }); });
    return out;
  }
  function splitCsv(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') q = !q;
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  // snap.countyFips, snap.perBrMarket (Deal Calculator ZORI-by-bedroom), m = build() result, data = MARKET_URLS loaded.
  function market(m, snap, data) {
    var fips = snap && snap.countyFips;
    if (!m || m.error) return { error: 'No deal to compare.' };
    if (!/^08\d{3}$/.test(fips || '')) return { error: 'The deal has no Colorado county set, so there is no market to compare. Choose the county in the Deal Calculator.' };
    data = data || {};
    var mk = { fips: fips };
    var zc = data.zori && data.zori.counties && data.zori.counties[fips];
    var acs = data.acsRent && data.acsRent.counties && data.acsRent.counties[fips];
    var rc = ((data.renters && data.renters.counties) || []).filter(function (c) { return c.fips === fips; })[0] || null;
    mk.county = (zc && zc.name) || (acs && acs.name) || (rc && rc.county_name) || fips;

    // Rents against the market.
    var per = snap.perBrMarket || null;
    mk.marketSource = per && per._meta ? per._meta.source : null;
    mk.zori = zc ? { rent: num(zc.rent), yoy: num(zc.yoy_change_pct), month: zc.vintage_month, metro: zc.metro || null,
      source: (data.zori.meta && data.zori.meta.source) || 'Zillow ZORI' } : null;
    mk.acs = acs && num(acs.median_gross_rent) != null ? { rent: num(acs.median_gross_rent), vintage: data.acsRent.meta && data.acsRent.meta.vintage, source: data.acsRent.meta && data.acsRent.meta.source } : null;
    // Restricted rows only: a market-rate row is the market, so there is nothing to compare.
    mk.rents = m.rents.rows.filter(function (x) { return typeof x.tier === 'number'; }).map(function (x) {
      var br = BR_KEY[String(x.bedrooms || '').toUpperCase()];
      var mkt = per && br ? num(per[br]) : null;
      return { tier: x.tier, bedrooms: x.bedrooms, units: x.units, rent: x.rent, market: mkt, discount: mkt && x.rent != null ? 1 - x.rent / mkt : null };
    });

    // Who can pay, and the share of them the deal must lease to (capture), tier by tier.
    if (rc && rc.households_le_ami_pct) {
      var le = rc.households_le_ami_pct;
      var unitsBy = {}, ratioBy = {};
      m.rents.rows.forEach(function (x) {
        var t = num(x.tier); if (t == null || !x.units) return;
        unitsBy[t] = (unitsBy[t] || 0) + x.units;
        // The tier's floor follows its lowest-priced home against the gross limit; with no limit known, the limit itself.
        var gross = x.rent != null ? x.rent + (x.allowance || 0) + (x.fees || 0) : null;
        var r = x.limit > 0 && gross != null ? Math.min(1, Math.max(0, gross / x.limit)) : 1;
        ratioBy[t] = ratioBy[t] == null ? r : Math.min(ratioBy[t], r);
      });
      mk.capture = Object.keys(unitsBy).map(Number).sort(function (a, b) { return a - b; }).map(function (t) {
        var lo = t * FLOOR_SHARE * ratioBy[t], hi = rentersAtOrBelow(le, t), base = rentersAtOrBelow(le, lo);
        var q = hi != null && base != null ? hi - base : null;
        return { tier: t, units: unitsBy[t], low: lo, high: t, qualified: q, capture: q > 0 ? unitsBy[t] / q : null,
          reason: q == null ? 'No renter count published at ' + t + '% AMI for this county.' : q <= 0 ? 'None counted in this range' : null };
      });
      // All tiers together: the union of the tiers' income ranges, so a gap between tiers (say 30% and 60%)
      // does not count renters who fit neither.
      var segs = [];
      // Sorted by floor: a discounted higher tier can reach below a lower tier's floor.
      mk.capture.slice().sort(function (a, b) { return a.low - b.low; }).forEach(function (c) {
        var last = segs[segs.length - 1];
        if (last && c.low <= last[1]) last[1] = Math.max(last[1], c.high); else segs.push([c.low, c.high]);
      });
      var qAll = segs.reduce(function (s, g) {
        var hi = rentersAtOrBelow(le, g[1]), lo = rentersAtOrBelow(le, g[0]);
        return s == null || hi == null || lo == null ? null : s + hi - lo;
      }, 0);
      var uAll = mk.capture.reduce(function (s, c) { return s + c.units; }, 0);
      if (!segs.length) { mk.capture = null; mk.noTiers = true; mk.captureReason = 'The deal has no income-restricted homes, so there are no tiers to screen.'; }
      else mk.captureAll = { units: uAll, low: segs[0][0], high: segs[segs.length - 1][1], ranges: segs.map(function (g) { return Math.round(g[0]) + '–' + g[1] + '%'; }).join(', ') + ' AMI',
        qualified: qAll, capture: qAll > 0 ? uAll / qAll : null };
      mk.renters = { total: num(rc.renter_households_total), ami: num(rc.ami_4person), year: data.renters.meta && data.renters.meta.acs_year,
        amiYear: data.renters.meta && data.renters.meta.hud_income_limits_year };
    } else mk.captureReason = 'No renter income counts on file for this county.';

    // Rent trend: Zillow by metro, the same month each year.
    var series = mk.zori && mk.zori.metro ? zoriMetroSeries(data.zoriMetroCsv, mk.zori.metro) : null;
    if (series && series.length) {
      var last = series[series.length - 1], mm = last.month.slice(5, 7), yr = Number(last.month.slice(0, 4));
      mk.trend = [];
      for (var y = yr - TREND_YEARS; y <= yr; y++) {
        var hit = series.filter(function (p) { return p.month.slice(0, 4) === String(y) && p.month.slice(5, 7) === mm; })[0];
        if (hit) mk.trend.push(hit);
      }
      mk.trend.forEach(function (p, i) { p.change = i ? p.rent / mk.trend[i - 1].rent - 1 : null; });
      var peak = series.reduce(function (a, b) { return b.rent > a.rent ? b : a; });
      mk.trendPeak = peak;
      mk.trendMetro = mk.zori.metro;
    } else mk.trendReason = mk.zori ? 'Zillow publishes no metro history for ' + (mk.zori.metro || 'this county') + '.' : 'Zillow publishes no rent index for this county.';

    // Pipeline: CHFA awards in the county from the deal summaries.
    var deals = (data.deals && data.deals.deals) || [];
    var countyName = String(mk.county).replace(/ County$/, '');
    var thisYear = new Date().getFullYear();
    mk.pipelineLoaded = !!(data.deals && data.deals.deals);
    mk.pipeline = deals.filter(function (d) { return d.county === countyName && num(d.year) != null && d.year >= thisYear - PIPELINE_YEARS + 1; })
      .sort(function (a, b) { return b.year - a.year; })
      .map(function (d) { var got = data.dealDetail && data.dealDetail[d.slug], x = got || {};
        return { slug: d.slug, name: d.name, city: d.city, year: d.year, units: num(d.units), award: d.award,
          status: x.status && x.status.label || null, mix: (x.income_mix || []).map(function (i) { return i.units + ' at ' + i.level; }).join(', ') || null, detailLoaded: !!got }; });

    mk.findings = marketFindings(mk);
    // A check whose figures did not load or are not published is listed, so an empty list never reads as a pass.
    mk.unchecked = [];
    if (!mk.noTiers && (!mk.rents.length || mk.rents.every(function (x) { return x.discount == null; }))) mk.unchecked.push('rents against the market');
    if (!mk.capture) { if (!mk.noTiers) mk.unchecked.push('renters who can pay each tier'); }
    else mk.capture.filter(function (c) { return c.qualified == null; }).forEach(function (c) { mk.unchecked.push('renters who can pay ' + c.tier + '% AMI rents (no county count published that high)'); });
    // One same-month reading has no change to show, so it is not a checked trend.
    if (!(mk.trend && mk.trend.length >= 2)) mk.unchecked.push('the rent trend');
    if (!(data.deals && data.deals.deals)) mk.unchecked.push('other tax credit awards in the county');
    else { var noDetail = mk.pipeline.filter(function (p) { return !p.detailLoaded; }).length;
      if (noDetail) mk.unchecked.push('the status and income mix of ' + noDetail + ' award' + (noDetail === 1 ? '' : 's') + ' (its summary did not load)'); }
    return mk;
  }

  function marketFindings(mk) {
    var out = [];
    mk.rents.forEach(function (x) {
      if (x.discount == null) return;
      if (x.discount < 0) out.push({ level: 'bad', text: x.tier + '% AMI ' + x.bedrooms + ' rent of ' + money(x.rent) + ' is above the market estimate of ' + money(x.market) + '. Price it below the limit or expect slow leasing.' });
      else if (x.discount < 0.10) out.push({ level: 'warn', text: x.tier + '% AMI ' + x.bedrooms + ' rent is only ' + pct(x.discount) + ' under the market estimate (' + money(x.market) + '). Renters who qualify have little reason to choose it over market housing.' });
    });
    (mk.capture || []).forEach(function (c) {
      if (c.qualified != null && c.qualified <= 0) { out.push({ level: 'bad', text: c.tier + '% AMI: ' + c.units + ' homes, but the county counts show no renter households with incomes from ' + Math.round(c.low) + '% to ' + c.high + '% AMI. Check who can rent these homes before relying on them.' }); return; }
      if (c.capture == null) return;
      if (c.capture >= 0.25) out.push({ level: 'warn', text: c.tier + '% AMI: ' + c.units + ' homes against about ' + Math.round(c.qualified).toLocaleString('en-US') + ' renter households who qualify in the county (' + pct(c.capture, 1) + '). The deal needs a large share of them.' });
    });
    if (mk.zori && mk.zori.yoy != null && mk.zori.yoy < 0) out.push({ level: 'warn', text: 'Zillow rents in ' + mk.county + ' are down ' + Math.abs(mk.zori.yoy).toFixed(1) + '% from a year ago. Hold rent growth at CHFA\'s 2% and do not count on market rents rising.' });
    var recent = (mk.pipeline || []).filter(function (p) { return p.year >= new Date().getFullYear() - 2; });
    if (recent.length) out.push({ level: 'warn', text: recent.length + ' tax credit award' + (recent.length === 1 ? '' : 's') + ' in ' + mk.county + ' since ' + (new Date().getFullYear() - 2) + ' (' + recent.reduce(function (s, p) { return s + (p.units || 0); }, 0) + ' homes) may lease to the same renters. Check their income mix below.' });
    var rank = { bad: 0, warn: 1, ok: 2 };
    return out.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
  }

  function renderMarket(mk) {
    if (!mk || mk.error) return '<section class="dv-card"><h2>Market</h2><p class="sr-muted">' + esc((mk && mk.error) || 'No market figures.') + '</p></section>';
    var h = '<section class="dv-card rw-decide" aria-labelledby="wbMkt"><h2 id="wbMkt">Market: ' + esc(mk.county) + '</h2>';
    h += '<p class="sr-muted">County figures the site already holds. A market study measures the area drawn around the site; use these to see whether a study is likely to raise questions.</p>';
    h += mk.findings.length ? '<h3>What to check</h3><ul>' + mk.findings.map(function (f) { return '<li class="' + (f.level === 'bad' ? 'sr-red' : 'sr-yellow') + '">' + esc(f.text) + '</li>'; }).join('') + '</ul><p class="sr-muted">The 10%-under-market and 25%-of-renters lines are our screens, not CHFA rules.</p>' : (mk.unchecked && mk.unchecked.length ? '' : '<p>Nothing in the county figures needs a second look.</p>');
    if (mk.unchecked && mk.unchecked.length) h += '<p class="sr-yellow">Not checked, because the figures did not load or are not published for this county: ' + esc(mk.unchecked.join('; ')) + '.</p>';
    h += '</section>';

    // Rents vs market
    h += '<section class="dv-card" aria-labelledby="wbMktRent"><h2 id="wbMktRent">Rents against the market</h2>';
    h += table(['AMI', 'Size', 'Homes', 'Rent', 'Market estimate', 'Under market'], mk.rents.map(function (x) {
      return { cls: x.discount != null && x.discount < 0.10 ? 'sr-diff' : '', cells: [esc(x.tier + '%'), esc(x.bedrooms), esc(x.units), esc(money(x.rent)), esc(money(x.market)), esc(x.discount == null ? '—' : pct(x.discount))] };
    }), { num: [2, 3, 4, 5] });
    var notes = [];
    if (mk.marketSource) notes.push('Market estimate: ' + mk.marketSource + '.');
    else notes.push('No market estimate by bedroom size for this county' + (mk.zori ? '; the all-homes figure is below.' : '.'));
    if (mk.zori) notes.push('Zillow, all homes, ' + mk.county + ': ' + money(mk.zori.rent) + ' (' + mk.zori.month + ', ' + (mk.zori.yoy == null ? 'change from a year earlier not published' : (mk.zori.yoy >= 0 ? '+' : '') + mk.zori.yoy + '% from a year earlier') + ').');
    if (mk.acs) notes.push('Census median gross rent, ' + mk.county + ': ' + money(mk.acs.rent) + ' (ACS ' + (mk.acs.vintage || '') + '; includes older and subsidized homes).');
    h += '<p class="sr-muted">' + esc(notes.join(' ')) + '</p></section>';

    // Capture
    h += '<section class="dv-card" aria-labelledby="wbMktCap"><h2 id="wbMktCap">Who can pay, and how many the deal needs</h2>';
    if (mk.capture) {
      h += table(['AMI', 'Homes', 'Renter incomes that fit', 'Renter households in that range', 'Share the deal needs'], mk.capture.map(function (c) {
        return { cells: [esc(c.tier + '%'), esc(c.units), esc(Math.round(c.low) + '–' + c.high + '% AMI'), esc(c.qualified == null ? '—' : Math.round(c.qualified).toLocaleString('en-US')), esc(c.capture == null ? (c.reason || '—') : pct(c.capture, 1))] };
      }).concat(mk.captureAll && mk.captureAll.capture != null ? [{ cls: 'sr-total', cells: ['All', esc(mk.captureAll.units), esc(mk.captureAll.ranges), esc(Math.round(mk.captureAll.qualified).toLocaleString('en-US')), esc(pct(mk.captureAll.capture, 1))] }] : []), { num: [1, 3, 4] });
      h += '<p class="sr-muted">' + esc('A household fits a tier when its income is under the tier\'s limit and the rent is no more than 40% of its income, so from three-quarters of the limit up to the limit, or lower where a home is priced under its limit. Renter households by income: Census ACS ' + (mk.renters.year || '') + ' (table B25118), ' +
        (mk.renters.total != null ? Math.round(mk.renters.total).toLocaleString('en-US') + ' renter households in the county, ' : '') + 'measured against HUD ' + (mk.renters.amiYear || '') + ' area median income for four people (' + money(mk.renters.ami) + '). Household size is not matched to unit size, and existing homes already serving these renters are not subtracted, so this is a first screen.') + '</p>';
    } else h += '<p class="sr-muted">' + esc(mk.captureReason) + '</p>';
    h += '</section>';

    // Trend
    h += '<section class="dv-card" aria-labelledby="wbMktTrend"><h2 id="wbMktTrend">Rent trend</h2>';
    if (mk.trend && mk.trend.length) {
      h += table(['Month', 'Typical rent', 'Change from a year earlier'], mk.trend.map(function (p) { return { cells: [esc(p.month.slice(0, 7)), esc(money(p.rent)), esc(p.change == null ? '—' : (p.change >= 0 ? '+' : '') + (p.change * 100).toFixed(1) + '%')] }; }), { num: [0, 1, 2] });
      h += '<p class="sr-muted">' + esc('Zillow Observed Rent Index, ' + mk.trendMetro + ' metro, all homes. Highest month: ' + money(mk.trendPeak.rent) + ' in ' + mk.trendPeak.month.slice(0, 7) + '.') + '</p>';
    } else h += '<p class="sr-muted">' + esc(mk.trendReason) + '</p>';
    h += '</section>';

    // Pipeline
    h += '<section class="dv-card" aria-labelledby="wbMktPipe"><h2 id="wbMktPipe">Tax credit awards in ' + esc(mk.county) + ' since ' + (new Date().getFullYear() - PIPELINE_YEARS + 1) + '</h2>';
    h += mk.pipeline.length ? table(['Project', 'Town', 'Award', 'Homes', 'Income mix', 'Status'], mk.pipeline.map(function (p) {
      return { cells: ['<a href="deal-summary.html?d=' + esc(p.slug) + '">' + esc(p.name) + '</a>', esc(p.city), esc(p.award), esc(p.units == null ? '—' : p.units), esc(p.detailLoaded ? (p.mix || '—') : 'Not loaded'), esc(p.detailLoaded ? (p.status || '—') : 'Not loaded')] };
    }), { num: [3] }) : (mk.pipelineLoaded ? '<p>No CHFA tax credit awards in this county in that time.</p>' : '<p class="sr-yellow">The deal summaries did not load, so awards in this county were not checked. Reload the page to try again.</p>');
    h += '<p class="sr-muted">From the site\'s deal summaries, one researched record per CHFA award with its sources. Other projects without tax credits are not listed.</p></section>';
    return h;
  }

  // ── The team's own research (pure) ────────────────────────────────────────
  // Typed on this page and kept per deal by the private backend (/api/deal-market): the site's location,
  // comparable properties with a source link each, waitlist counts (never names) and the CHFA/DOLA survey.
  var MARKET_API = '/api/deal-market';
  var LIHTC_URL = 'data/chfa-lihtc.json';
  var NEARBY_MILES = 10;
  var STALE_DAYS = 365;
  var WAIT_BANDS = [['30', '30% AMI or less'], ['50', '31–50% AMI'], ['60', '51–60% AMI'], ['80', '61–80% AMI'], ['over80', 'Over 80% AMI'], ['unknown', 'Income not recorded']];
  var WAIT_SIZES = ['1', '2', '3', '4', '5+', 'any'];
  var COMP_BEDS = [['studio', 'Studio'], ['1br', '1BR'], ['2br', '2BR'], ['3br', '3BR'], ['4br', '4BR']];

  function miles(a, b) {
    if (!a || !b || num(a.lat) == null || num(a.lon) == null || num(b.lat) == null || num(b.lon) == null) return null;
    var R = 3958.8, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // rec: the saved research { site, comps, waitlist, survey }; lihtc: data/chfa-lihtc.json; today: 'YYYY-MM-DD'.
  function research(m, rec, lihtc, today) {
    rec = rec || {};
    var site = rec.site && num(rec.site.lat) != null && num(rec.site.lon) != null ? rec.site : null;
    var v = { site: rec.site || null, findings: [] };
    v.comps = (rec.comps || []).map(function (c, at) { return Object.assign({}, c, { miles: site ? miles(site, c) : null, at: at }); })
      .sort(function (a, b) { return (a.miles == null ? 1e9 : a.miles) - (b.miles == null ? 1e9 : b.miles); });
    // Average comparable rent by size, market-rate comparables only.
    v.compAvg = {};
    COMP_BEDS.forEach(function (bd) {
      var xs = v.comps.filter(function (c) { return c.kind === 'market' && c.rents && num(c.rents[bd[0]]) > 0; }).map(function (c) { return num(c.rents[bd[0]]); });
      v.compAvg[bd[0]] = xs.length ? { rent: xs.reduce(function (s, x) { return s + x; }, 0) / xs.length, n: xs.length } : null;
    });
    v.rentVsComps = (m && m.rents ? m.rents.rows : []).filter(function (x) { return typeof x.tier === 'number'; }).map(function (x) {
      var br = BR_KEY[String(x.bedrooms || '').toUpperCase()], avg = br ? v.compAvg[br] : null;
      return { tier: x.tier, bedrooms: x.bedrooms, rent: x.rent, comp: avg ? avg.rent : null, n: avg ? avg.n : 0, discount: avg && x.rent != null ? 1 - x.rent / avg.rent : null };
    });
    // Tax credit properties near the site, from CHFA's property list.
    var feats = (lihtc && lihtc.features) || [];
    v.nearbyUnchecked = !!site && !(lihtc && lihtc.features);
    v.nearby = site ? feats.map(function (f) {
      var c = f.geometry && f.geometry.coordinates, p = f.properties || {};
      var d = c ? miles(site, { lat: c[1], lon: c[0] }) : null;
      var mix = p.AMIUnits ? Object.keys(p.AMIUnits).filter(function (k) { return num(p.AMIUnits[k]) > 0; }).map(function (k) { return p.AMIUnits[k] + ' at ' + k.replace(/^ami/, '').replace(/^lte/, '≤') + '%'; }).join(', ') : '';
      return { name: p.PROJECT || p.ReportedName, city: p.PROJ_CTY, units: num(p.N_UNITS), li: num(p.LI_UNITS), year: num(p.AwardYear || p.YR_ALLOC), credit: p.CREDIT || p.TypeOfCredits || '', mix: mix, lat: c && c[1], lon: c && c[0], miles: d };
    }).filter(function (x) { return x.miles != null && x.miles <= NEARBY_MILES; }).sort(function (a, b) { return a.miles - b.miles; }) : [];
    v.waitlist = rec.waitlist || null;
    v.survey = rec.survey || null;

    var f = v.findings;
    if (!v.comps.length) f.push({ level: 'warn', text: 'No comparables yet. Add the market-rate and tax credit properties a renter here would also consider, each with the page or call it came from.' });
    else if (!v.comps.some(function (c) { return c.kind === 'market'; })) f.push({ level: 'warn', text: 'No market-rate comparables, so the rents cannot be checked against what renters pay now.' });
    v.rentVsComps.forEach(function (x) {
      if (x.discount == null) return;
      if (x.discount < 0) f.push({ level: 'bad', text: x.tier + '% AMI ' + x.bedrooms + ' rent of ' + money(x.rent) + ' is above the average market comparable (' + money(x.comp) + ', ' + x.n + ' propert' + (x.n === 1 ? 'y' : 'ies') + ').' });
      else if (x.discount < 0.10) f.push({ level: 'warn', text: x.tier + '% AMI ' + x.bedrooms + ' rent is only ' + pct(x.discount) + ' under the average market comparable (' + money(x.comp) + ').' });
    });
    var t = today ? Date.parse(today) : null;
    v.comps.forEach(function (c) {
      if (t != null && c.checked && (t - Date.parse(c.checked)) / 864e5 > STALE_DAYS) f.push({ level: 'warn', text: c.name + ' was last checked ' + c.checked + '. Check its rents again before relying on them.' });
    });
    if (v.survey) {
      if (num(v.survey.vacancy) != null && v.survey.vacancy >= 0.05) f.push({ level: 'warn', text: 'The rent survey shows ' + pct(v.survey.vacancy, 1) + ' vacancy in ' + (v.survey.region || 'the region') + ' (' + (v.survey.period || 'latest') + '), so renters have choices.' });
      (v.survey.byType || []).forEach(function (r) { if (num(r.vacancy) != null && r.vacancy >= 0.05) f.push({ level: 'warn', text: r.type + ' vacancy is ' + pct(r.vacancy, 1) + ' in the rent survey' + (num(r.rent) != null ? ', at ' + money(r.rent) + ' average rent' : '') + '. Units of this type may lease slower.' }); });
    }
    if (v.waitlist && num(v.waitlist.total) != null && m && m.units) f.push({ level: 'ok', text: v.waitlist.total.toLocaleString('en-US') + ' households on the waitlist' + (v.waitlist.keeper ? ' kept by ' + v.waitlist.keeper : '') + (v.waitlist.asOf ? ' (' + v.waitlist.asOf + ')' : '') + ' for ' + m.units + ' homes.' });
    if (v.nearby.length) f.push({ level: 'ok', text: v.nearby.length + ' tax credit propert' + (v.nearby.length === 1 ? 'y' : 'ies') + ' within ' + NEARBY_MILES + ' miles of the site (' + v.nearby.reduce(function (s, x) { return s + (x.li || 0); }, 0).toLocaleString('en-US') + ' income-restricted homes).' });
    var rank = { bad: 0, warn: 1, ok: 2 };
    f.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    return v;
  }

  // The summary tables (pure). The form and map are drawn by the browser part.
  // Team-entered source links show only as web links; anything else becomes a dead link.
  function webLink(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#'; }

  function renderResearch(v) {
    var h = '<h3>What the research shows</h3>';
    h += v.findings.length ? '<ul>' + v.findings.map(function (f) { return '<li class="' + (f.level === 'bad' ? 'sr-red' : f.level === 'warn' ? 'sr-yellow' : '') + '">' + esc(f.text) + '</li>'; }).join('') + '</ul>' : '';
    h += '<p class="sr-muted">The 10%-under-market and 5%-vacancy lines are our screens, not CHFA rules.</p>';
    if (v.comps.length) {
      h += '<h3>Comparables</h3>' + table(['Property', 'Type', 'Miles', 'Built', 'Homes', 'Studio', '1BR', '2BR', '3BR', '4BR', 'Vacancy', 'Checked', 'Source', ''], v.comps.map(function (c, i) {
        return { cells: [esc(c.name) + (c.concessions ? '<div class="sr-muted">' + esc(c.concessions) + '</div>' : ''), esc(c.kind), esc(c.miles == null ? '—' : c.miles.toFixed(1)), esc(c.yearBuilt || '—'), esc(c.units || '—')]
          .concat(COMP_BEDS.map(function (bd) { return esc(c.rents && num(c.rents[bd[0]]) != null ? money(c.rents[bd[0]]) : '—'); }))
          .concat([esc(c.vacancy == null ? '—' : pct(c.vacancy, 1)), esc(c.checked), '<a class="wb-src" href="' + esc(webLink(c.source)) + '" rel="noopener noreferrer" target="_blank" aria-label="Source for ' + esc(c.name) + '">Link</a>', '<button type="button" class="sr-btn" data-del-comp="' + i + '" aria-label="Remove ' + esc(c.name) + '">Remove</button>']) };
      }), { num: [2, 3, 4, 5, 6, 7, 8, 9, 10] });
      var cmp = v.rentVsComps.filter(function (x) { return x.comp != null; });
      if (cmp.length) h += table(['AMI', 'Size', 'Rent', 'Average market comparable', 'Under'], cmp.map(function (x) {
        return { cls: x.discount < 0.10 ? 'sr-diff' : '', cells: [esc(x.tier + '%'), esc(x.bedrooms), esc(money(x.rent)), esc(money(x.comp) + ' (' + x.n + ')'), esc(pct(x.discount))] };
      }), { num: [2, 3, 4] });
    }
    if (v.nearbyUnchecked) h += '<p class="sr-yellow">CHFA\'s property list did not load, so tax credit properties near the site were not checked. Reload the page to try again.</p>';
    if (v.nearby.length) h += '<details class="wb-near"><summary>Tax credit properties within ' + NEARBY_MILES + ' miles (' + v.nearby.length + ')</summary>' + table(['Property', 'Town', 'Miles', 'Homes', 'Income-restricted', 'Award', 'Income mix'], v.nearby.map(function (x) {
      return { cells: [esc(x.name), esc(x.city || ''), esc(x.miles.toFixed(1)), esc(x.units == null ? '—' : x.units), esc(x.li == null ? '—' : x.li), esc((x.year || '') + ' ' + x.credit), esc(x.mix || '—')] };
    }), { num: [2, 3, 4] }) + '<p class="sr-muted">From CHFA\'s housing tax credit property list (data/chfa-lihtc.json).</p></details>';
    if (v.waitlist && v.waitlist.rows && v.waitlist.rows.length) {
      h += '<h3>Waitlist</h3>' + table(['Income', 'Household size', 'Households'], v.waitlist.rows.map(function (r) {
        var b = WAIT_BANDS.filter(function (x) { return x[0] === r.band; })[0];
        return { cells: [esc(b ? b[1] : r.band), esc(r.size === 'any' ? 'Any' : r.size + (r.size === '1' ? ' person' : ' people')), esc(r.count)] };
      }), { num: [2] }) + '<p class="sr-muted">Counts only' + esc((v.waitlist.keeper ? ', kept by ' + v.waitlist.keeper : '') + (v.waitlist.asOf ? ', as of ' + v.waitlist.asOf : '')) + '. No names or applicant details are kept.</p>';
    }
    if (v.survey) {
      h += '<h3>Rent and vacancy survey</h3><p>' + esc((v.survey.region || 'Region') + ', ' + (v.survey.period || '') + ': average rent ' + money(num(v.survey.avgRent)) + ', vacancy ' + pct(num(v.survey.vacancy), 1) + '.') + ' <a class="wb-src" href="' + esc(webLink(v.survey.source)) + '" rel="noopener noreferrer" target="_blank">Source</a></p>';
      if ((v.survey.byType || []).length) h += table(['Unit type', 'Average rent', 'Vacancy'], v.survey.byType.map(function (r) { return { cells: [esc(r.type), esc(money(num(r.rent))), esc(pct(num(r.vacancy), 1))] }; }), { num: [1, 2] });
    }
    return h;
  }

  // ── Browser ───────────────────────────────────────────────────────────────
  // onStart receives a cancel function, so a newer request can stop this calculator instead of letting it load on.
  function loadFrame(doc, query, timeoutMs, pollMs, onStart) {
    return new Promise(function (resolve, reject) {
      var f = doc.createElement('iframe');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:absolute;width:1200px;height:900px;left:-10000px;top:0;border:0;visibility:hidden';
      f.src = calcUrl(query, doc.baseURI);
      var last = '', same = 0, done = false;
      // A calculator left running would keep loading in the background, and each retry would add another.
      function fail(err) { if (done) return; done = true; clearTimeout(timer); f.remove(); reject(err); }
      // The clock starts when the frame is added, so a page that never fires load still times out.
      var timer = setTimeout(function () { fail(new Error('The Deal Calculator did not finish loading.')); }, timeoutMs || 45000);
      function poll() {
        if (done) return;
        try {
          var w = f.contentWindow, dc = w && w.__DealCalc;
          if (dc && dc.getResult && dc.getResult()) {
            // Settled means no data request in flight and the same output for four polls in a row.
            var busy = typeof w.__dealCalcPendingFetches === 'function' && w.__dealCalcPendingFetches() > 0;
            var o = JSON.stringify(dc.getOutputRecords());
            same = o === last && !busy ? same + 1 : 0; last = o;
            if (same >= 4) { done = true; clearTimeout(timer); return resolve(f); }
          }
        } catch (e) { return fail(e); }
        setTimeout(poll, pollMs || 400);
      }
      f.addEventListener('load', function () { setTimeout(poll, pollMs || 400); });
      if (onStart) onStart(fail);
      doc.body.appendChild(f);
    });
  }
  // The calculator's own wording for why no allowance was applied, e.g. 'allowance_bedroom_missing:2BR'.
  function uaWithText(ua, limits) {
    if (!ua || ua.applied || !ua.reason || !limits || !limits.unavailableMessage) return ua;
    var parts = String(ua.reason).split(':'), text = ua.reason === 'shared_allowance_invalid' ? 'Shared utility allowance record is invalid' : limits.unavailableMessage(parts[0]);
    return Object.assign({}, ua, { reasonText: text ? text + (parts[1] ? ' (' + parts[1] + ')' : '') : null });
  }
  function readCalc(w, mkt) {
    var dc = w.__DealCalc;
    var rs = dc.getRentScheduleMetadata ? dc.getRentScheduleMetadata() : null;
    var fips = (rs && rs.countyFips) || null;
    // The calculator's own ZORI-by-bedroom estimate (js/components/zori-rent-utils.js), from the frame's loaded HUD FMRs.
    var per = null;
    try {
      // The same place the calculator uses: a linked geoid first, else the saved jurisdiction in this county.
      var geoid = w.location ? new URLSearchParams(w.location.search).get('geoid') : null;
      if (!/^08\d{5}$/.test(geoid || '')) {
        var j = w.WorkflowState && w.WorkflowState.getJurisdiction ? w.WorkflowState.getJurisdiction() : null;
        geoid = j && String(j.countyFips) === String(fips) ? j.geoid : null;
      }
      if (fips && mkt && mkt.zori && w.ZoriRentUtils && w.HudFmr) per = w.ZoriRentUtils.getPerBedroomRent(mkt.zori, fips, w.HudFmr, { bedroomMix: mkt.bedroomMix, geoid: geoid });
    } catch (e) { per = null; }
    return { result: dc.getResult(), permanentFinancing: dc.getPermanentFinancing ? dc.getPermanentFinancing() : null,
      rentLimits: dc.getRentLimitsMetadata ? dc.getRentLimitsMetadata() : null, rentSchedule: dc.getRentScheduleMetadata ? dc.getRentScheduleMetadata() : null, utilityAllowance: dc.getUtilityAllowanceMetadata ? uaWithText(dc.getUtilityAllowanceMetadata(), w.ChfaRentLimits) : null,
      amiByBr: dc.getAmiLimitsByBr ? dc.getAmiLimitsByBr() : null,
      mode: (function () { var c = w.document.querySelector('input[name="dc-deal-mode"]:checked'); return c ? c.value : null; })(), labels: (w.DealPermanentFinancing && w.DealPermanentFinancing.PROGRAM_LABELS) || {},
      countyFips: fips, perBrMarket: per };
  }
  // The market files, loaded once. A file that fails stays null and its section says so.
  var _mkt = null;
  function loadMarket() {
    if (_mkt) return _mkt;
    var get = function (u, text) { return settleWithin(fetch(u).then(function (r) { return r.ok ? (text ? r.text() : r.json()) : null; }), 20000); };
    var keys = Object.keys(MARKET_URLS);
    _mkt = Promise.all(keys.map(function (k) { return get(MARKET_URLS[k], k === 'zoriMetro'); })).then(function (res) {
      var o = {}; keys.forEach(function (k, i) { o[k === 'zoriMetro' ? 'zoriMetroCsv' : k] = res[i]; }); return o;
    });
    return _mkt;
  }
  // Each award record in the county, for its status and income mix.
  function loadDealDetails(mkt, mk) {
    var get = function (slug) { return settleWithin(fetch('data/deals/' + slug + '.json').then(function (r) { return r.ok ? r.json() : null; }), 20000); };
    var slugs = (mk.pipeline || []).map(function (p) { return p.slug; });
    return Promise.all(slugs.map(get)).then(function (res) { var o = {}; slugs.forEach(function (s, i) { if (res[i]) o[s] = res[i]; }); return o; });
  }

  // The calculator settings carried by a share link, an export file's url, or a saved version.
  // Every Deal Calculator export carries its unit count or county; a query with neither (q=housing) would only
  // open the calculator's default deal under another name.
  function calcQuery(q) {
    if (!q) return null;
    var keys = []; new URLSearchParams(q).forEach(function (v, k) { keys.push(k); });
    return keys.some(function (k) { return k === 'units' || k === 'county-select' || /^pf-/.test(k); }) ? q : null;
  }
  function queryFrom(x) {
    if (!x) return null;
    if (typeof x === 'string') {
      var s = x.trim(), q = s.indexOf('?');
      // A link counts only when it points at the Deal Calculator; a bare query string from an export still works.
      if (q > 0 && !/(^|\/)deal-calculator(\.html)?$/i.test(s.slice(0, q))) return null;
      if (q !== -1) return calcQuery(s.slice(q + 1).replace(/#.*$/, ''));
      return /=/.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s) ? calcQuery(s) : null;
    }
    if (x.url) return queryFrom(String(x.url));
    if (x.calculator && x.calculator.query) return calcQuery(x.calculator.query);
    if (x.data && x.data.calculator && x.data.calculator.query) return calcQuery(x.data.calculator.query);
    return null;
  }

  // A request that stalls settles as null after ms, so the workbook builds without it rather than waiting forever.
  var SAVE_WAIT_MS = 30000;
  function settleWithin(p, ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(null); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
    });
  }

  // The research editor: forms, map and save, for a deal saved in Submittal review.
  // isLive says whether this deal is still the one on screen. The form is found by id, so a load or save that
  // finishes after another deal opens must not write this deal's research into that deal's form.
  function researchEditor(doc, deal, model, onError, isLive) {
    var $ = function (id) { return doc.getElementById(id); };
    var box = $('wbResearch');
    var live = function () { return (!isLive || isLive()) && box.isConnected !== false && $('wbResearch') === box; };
    var rec = { site: null, comps: [], waitlist: null, survey: null };
    var lihtc = null, map = null, layer = null;
    var today = new Date().toISOString().slice(0, 10);
    var field = function (id, label, type, extra) { return '<label class="sr-field" for="' + id + '">' + label + '<input type="' + (type || 'text') + '" id="' + id + '"' + (extra || '') + '></label>'; };
    var numIn = function (id, label, extra) { return field(id, label, 'number', ' inputmode="decimal"' + (extra || '')); };
    box.innerHTML = '<section class="dv-card" aria-labelledby="wbResH"><h2 id="wbResH">Your market research</h2>' +
      '<p class="sr-muted">Typed here and kept with this deal on the team site only, under your sign-in. Every comparable needs the date you checked it and a link to where the figures came from.</p>' +
      '<div id="wbResMap" class="wb-map" role="region" aria-label="Map of the site, comparables and nearby tax credit properties"></div><div id="wbResView"></div>' +
      '<details class="wb-form"><summary>Site location</summary><div class="sr-row">' + field('wbSiteAddr', 'Address') + numIn('wbSiteLat', 'Latitude', ' step="any"') + numIn('wbSiteLon', 'Longitude', ' step="any"') + '</div>' +
      '<p class="sr-muted">Latitude and longitude: right-click the site on most web maps to copy them.</p></details>' +
      '<details class="wb-form"><summary>Add a comparable</summary><div class="sr-row">' + field('wbCName', 'Property name') +
      '<label class="sr-field" for="wbCKind">Type<select id="wbCKind"><option value="market">Market rate</option><option value="tax credit">Tax credit</option><option value="other">Other</option></select></label>' +
      field('wbCAddr', 'Address') + numIn('wbCLat', 'Latitude', ' step="any"') + numIn('wbCLon', 'Longitude', ' step="any"') + numIn('wbCYear', 'Year built', ' step="1"') + numIn('wbCUnits', 'Homes', ' step="1"') + '</div><div class="sr-row">' +
      COMP_BEDS.map(function (bd) { return numIn('wbCR' + bd[0], bd[1] + ' rent', ' step="1" class="sr-small"'); }).join('') + numIn('wbCVac', 'Vacancy %', ' step="any" class="sr-small"') + '</div><div class="sr-row">' +
      field('wbCConc', 'Concessions') + field('wbCChecked', 'Date checked', 'date', ' value="' + today + '"') + field('wbCSrc', 'Source link', 'url', ' placeholder="Web address"') + '</div>' +
      '<button type="button" class="sr-btn" id="wbCAdd">Add comparable</button></details>' +
      '<details class="wb-form"><summary>Waitlist counts</summary><p class="sr-muted">Totals only. Do not type names or any applicant details.</p><div class="sr-row">' +
      field('wbWKeeper', 'Who keeps the list') + field('wbWAsOf', 'As of', 'date') + numIn('wbWTotal', 'Households on the list', ' step="1"') + '</div>' +
      '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col">Income</th>' + WAIT_SIZES.map(function (z) { return '<th scope="col" class="sr-num">' + (z === 'any' ? 'Any size' : z + (z === '1' ? ' person' : ' people')) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      WAIT_BANDS.map(function (b) { return '<tr><th scope="row">' + esc(b[1]) + '</th>' + WAIT_SIZES.map(function (z) { return '<td><input type="number" min="0" step="1" class="sr-small" data-wait="' + b[0] + '|' + z + '" aria-label="' + esc(b[1] + ', ' + z) + '"></td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div></details>' +
      '<details class="wb-form"><summary>Rent and vacancy survey</summary><div class="sr-row">' + field('wbSRegion', 'Survey region') + field('wbSPeriod', 'Quarter', 'text', ' placeholder="2026 Q1"') + numIn('wbSRent', 'Average rent', ' step="1"') + numIn('wbSVac', 'Vacancy %', ' step="any"') + '</div>' +
      [0, 1, 2].map(function (i) { return '<div class="sr-row">' + field('wbST' + i, 'Unit type') + numIn('wbSTR' + i, 'Rent', ' step="1"') + numIn('wbSTV' + i, 'Vacancy %', ' step="any"') + '</div>'; }).join('') +
      '<div class="sr-row">' + field('wbSSrc', 'Source link', 'url', ' placeholder="Web address"') + '</div></details>' +
      '<p><button type="button" class="sr-primary" id="wbResSave">Save research</button> <span id="wbResStatus" role="status"></span></p></section>';

    var val = function (id) { var el = $(id); return el ? el.value.trim() : ''; };
    var nOrNull = function (x) { return x === '' ? null : num(x); };
    var pctIn = function (x) { var n = nOrNull(x); return n == null ? null : n / 100; };
    var badVac = function (v) { return v != null && !(v >= 0 && v <= 1); };
    var surveyLoose = 0, waitNeg = 0;
    function fill() {
      var s = rec.site || {};
      $('wbSiteAddr').value = s.address || ''; $('wbSiteLat').value = s.lat == null ? '' : s.lat; $('wbSiteLon').value = s.lon == null ? '' : s.lon;
      var w = rec.waitlist || {};
      $('wbWKeeper').value = w.keeper || ''; $('wbWAsOf').value = w.asOf || ''; $('wbWTotal').value = w.total == null ? '' : w.total;
      Array.prototype.forEach.call(box.querySelectorAll('[data-wait]'), function (el) {
        var k = el.getAttribute('data-wait').split('|'), hit = (w.rows || []).filter(function (r) { return r.band === k[0] && r.size === k[1]; })[0];
        el.value = hit ? hit.count : '';
      });
      var v = rec.survey || {};
      $('wbSRegion').value = v.region || ''; $('wbSPeriod').value = v.period || ''; $('wbSRent').value = v.avgRent == null ? '' : v.avgRent;
      $('wbSVac').value = v.vacancy == null ? '' : +(v.vacancy * 100).toFixed(2); $('wbSSrc').value = v.source || '';
      [0, 1, 2].forEach(function (i) { var r = (v.byType || [])[i] || {}; $('wbST' + i).value = r.type || ''; $('wbSTR' + i).value = r.rent == null ? '' : r.rent; $('wbSTV' + i).value = r.vacancy == null ? '' : +(r.vacancy * 100).toFixed(2); });
    }
    function read() {
      var lat = nOrNull(val('wbSiteLat')), lon = nOrNull(val('wbSiteLon'));
      rec.site = val('wbSiteAddr') || lat != null ? { address: val('wbSiteAddr'), lat: lat, lon: lon } : null;
      var rows = []; waitNeg = 0;
      Array.prototype.forEach.call(box.querySelectorAll('[data-wait]'), function (el) {
        var n = nOrNull(el.value); if (n == null) return;
        if (n < 0) { waitNeg++; return; }
        var k = el.getAttribute('data-wait').split('|'); rows.push({ band: k[0], size: k[1], count: Math.round(n) });
      });
      var total = nOrNull(val('wbWTotal')); if (total != null && total < 0) { waitNeg++; total = null; }
      rec.waitlist = rows.length || total != null ? { keeper: val('wbWKeeper'), asOf: val('wbWAsOf'), total: total == null ? null : Math.round(total), rows: rows } : null;
      var typed = [0, 1, 2].map(function (i) { return { type: val('wbST' + i), rent: nOrNull(val('wbSTR' + i)), vacancy: pctIn(val('wbSTV' + i)) }; });
      // A row with figures but no unit type is counted, so the save can stop instead of dropping it.
      surveyLoose = typed.filter(function (r) { return !r.type && (r.rent != null || r.vacancy != null); }).length;
      var byType = typed.filter(function (r) { return r.type; });
      var sv = { region: val('wbSRegion'), period: val('wbSPeriod'), avgRent: nOrNull(val('wbSRent')), vacancy: pctIn(val('wbSVac')), byType: byType, source: val('wbSSrc') };
      rec.survey = sv.avgRent != null || sv.vacancy != null || byType.length ? sv : null;
    }
    // Checked before a save, so the user fixes the survey instead of losing it to the backend's filter.
    function surveyProblem() {
      if (waitNeg) return 'Waitlist counts cannot be below zero.';
      if (surveyLoose) return 'A survey row has figures but no unit type. Add the type or clear the row.';
      var sv = rec.survey;
      if (!sv) return null;
      if ([sv.vacancy].concat(sv.byType.map(function (r) { return r.vacancy; })).some(badVac)) return 'Survey vacancy must be between 0% and 100%.';
      var rents = [sv.avgRent].concat(sv.byType.map(function (r) { return r.rent; })).filter(function (x) { return x != null; });
      if (rents.some(function (x) { return !(x > 0); })) return 'Survey rents must be more than $0. Leave a rent blank if the survey does not report it.';
      if (!/^https?:\/\//i.test(sv.source || '')) return 'Survey figures need a source link starting with http.';
      return null;
    }
    function draw() {
      var v = research(model, rec, lihtc, today);
      $('wbResView').innerHTML = renderResearch(v);
      drawMap(v);
    }
    function drawMap(v) {
      var L = doc.defaultView && doc.defaultView.L;
      var el = $('wbResMap');
      var pts = [];
      if (v.site && num(v.site.lat) != null && num(v.site.lon) != null) pts.push({ lat: v.site.lat, lon: v.site.lon, kind: 'site', label: 'Site' + (v.site.address ? ': ' + v.site.address : '') });
      v.comps.forEach(function (c) { if (c.lat != null && c.lon != null) pts.push({ lat: c.lat, lon: c.lon, kind: c.kind === 'market' ? 'market' : 'credit', label: c.name }); });
      v.nearby.forEach(function (x) { if (x.lat != null) pts.push({ lat: x.lat, lon: x.lon, kind: 'chfa', label: x.name + ' (tax credit, ' + (x.li == null ? '?' : x.li) + ' restricted homes)' }); });
      if (!L || !pts.length) { el.hidden = true; return; }
      el.hidden = false;
      if (!map) {
        map = L.map(el, { scrollWheelZoom: false });
        var dv = doc.defaultView;
        (dv.COHOBasemaps ? dv.COHOBasemaps.light() : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' })).addTo(map);
      }
      if (layer) layer.remove();
      var COLORS = { site: '#b42318', market: '#1d4ed8', credit: '#0f766e', chfa: '#6b7280' };
      layer = L.layerGroup(pts.map(function (p) {
        return L.circleMarker([p.lat, p.lon], { radius: p.kind === 'site' ? 9 : 6, color: COLORS[p.kind], fillColor: COLORS[p.kind], fillOpacity: 0.8, weight: 2 }).bindTooltip(esc(p.label));
      })).addTo(map);
      map.fitBounds(L.latLngBounds(pts.map(function (p) { return [p.lat, p.lon]; })).pad(0.2), { maxZoom: 14 });
      setTimeout(function () { map.invalidateSize(); }, 50);
    }
    function say(t) { $('wbResStatus').textContent = t; }
    // Every field stays shut until the saved research has loaded, so an edit is never replaced by it
    // and an empty form never overwrites it.
    var ready = false;
    function setReady(on) { ready = on; $('wbResSave').disabled = !on; $('wbCAdd').disabled = !on; }
    // While a save is out, every field is shut too, so nothing typed then is replaced by the saved copy.
    function lock(on) {
      Array.prototype.forEach.call(box.querySelectorAll('input, select, textarea, button'), function (el) { el.disabled = on; });
      setReady(!on);
    }
    lock(true); say('Loading saved research…');

    $('wbCAdd').addEventListener('click', function () {
      var c = { name: val('wbCName'), kind: val('wbCKind'), address: val('wbCAddr'), lat: nOrNull(val('wbCLat')), lon: nOrNull(val('wbCLon')),
        yearBuilt: nOrNull(val('wbCYear')), units: nOrNull(val('wbCUnits')), rents: {}, vacancy: pctIn(val('wbCVac')),
        concessions: val('wbCConc'), checked: val('wbCChecked'), source: val('wbCSrc') };
      COMP_BEDS.forEach(function (bd) { c.rents[bd[0]] = nOrNull(val('wbCR' + bd[0])); });
      if (!ready) return;
      if (!c.name || !c.checked || !/^https?:\/\//i.test(c.source)) { say('A comparable needs a name, the date you checked it and a source link starting with http.'); return; }
      if (COMP_BEDS.some(function (bd) { return c.rents[bd[0]] != null && !(c.rents[bd[0]] > 0); })) { say('Comparable rents must be more than $0. Leave a size blank if the property does not report it.'); return; }
      if (badVac(c.vacancy)) { say('Comparable vacancy must be between 0% and 100%.'); return; }
      rec.comps.push(c);
      ['wbCName', 'wbCAddr', 'wbCLat', 'wbCLon', 'wbCYear', 'wbCUnits', 'wbCVac', 'wbCConc', 'wbCSrc'].concat(COMP_BEDS.map(function (bd) { return 'wbCR' + bd[0]; })).forEach(function (id) { $(id).value = ''; });
      say('Added. Save to keep it.'); draw();
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-del-comp]');
      if (!b || !ready) return;
      var v = research(model, rec, lihtc, today), gone = v.comps[Number(b.getAttribute('data-del-comp'))];
      if (gone) rec.comps.splice(gone.at, 1);
      say('Removed. Save to keep the change.'); draw();
    });
    box.addEventListener('change', function (e) { if (ready && e.target.closest && e.target.closest('.wb-form') && !/^wbC/.test(e.target.id || '')) { read(); draw(); } });
    $('wbResSave').addEventListener('click', function () {
      if (!ready) return;
      read();
      var bad = surveyProblem();
      if (bad) { say(bad + ' Nothing was saved yet.'); return; }
      lock(true); say('Saving…');
      // A save that stalls is cut off, so the form never stays shut until a reload.
      var ac = typeof AbortController === 'function' ? new AbortController() : null;
      var cut = setTimeout(function () { if (ac) ac.abort(); }, SAVE_WAIT_MS);
      fetch(MARKET_API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deal: deal, data: rec }), signal: ac ? ac.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || String(r.status)); }); })
        .then(function (j) {
          if (!live()) return;
          rec = j.data; fill(); draw();
          say('Saved ' + new Date(j.at).toLocaleString() + (j.dropped ? '. ' + j.dropped + ' item' + (j.dropped === 1 ? ' was' : 's were') + ' not kept: each comparable needs a name, a date and a source link, and survey figures need a source link.' : '.'));
        }, function (err) {
          if (live()) say(err && err.name === 'AbortError' ? 'The save did not answer in time, so it may not have been kept. Your entries are still here: save again.' : 'Not saved: ' + err.message);
        })
        .then(function () { clearTimeout(cut); if (live()) lock(false); });
    });

    var getJson = function (u) { return settleWithin(fetch(u, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }), 20000); };
    Promise.all([getJson(MARKET_API + '?deal=' + encodeURIComponent(deal)), getJson(LIHTC_URL)]).then(function (res) {
      if (!live()) return;
      lihtc = res[1];
      // A failed load leaves the editor shut: saving an empty form would overwrite research that is there.
      if (!res[0]) { draw(); say('Saved research did not load. Reload the page to add or change it.'); return; }
      say('');
      if (res[0].data) rec = res[0].data;
      fill(); draw(); lock(false);
    }, function (err) { if (live()) onError(err); });
  }

  function start(doc, waitMs) {
    var $ = function (id) { return doc.getElementById(id); };
    var tok = 0, wait = waitMs || 20000;
    // Every workbook waits for the rules request to settle, so a fast calculator never builds without them.
    var rulesReady = settleWithin(fetch(RULES_URL).then(function (r) { return r.ok ? r.json() : null; }), wait);
    function status(t) { $('wbStatus').textContent = t; }
    function api(path) {
      return fetch(API + path, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    }
    // Each user action takes the next generation when it starts, so the latest action wins even if an earlier
    // one finishes loading after it. A slow saved version or file read passes the generation it took.
    // Every action clears the last deal when it takes its generation, so a failed one never leaves the old
    // workbook on screen or printable.
    // A newer action stops the calculator an older one is still loading, so retries never run side by side.
    var stopFrame = null;
    function supersede() {
      if (stopFrame) { var c = stopFrame; stopFrame = null; c(new Error('A newer request replaced this one.')); }
      return ++tok;
    }
    function take() {
      $('wbOut').innerHTML = ''; $('wbPrint').hidden = true; $('wbOpenCalc').hidden = true;
      return supersede();
    }
    function open(query, title, reserved, ctx) {
      var my = reserved != null ? reserved : take();
      if (my !== tok) return;
      if (!query) { status('That has no Deal Calculator settings in it. Use a share link or an Export JSON file from the Deal Calculator.'); return; }
      status('Running the Deal Calculator for this deal…');
      $('wbOpenCalc').href = calcUrl(query, doc.baseURI); $('wbOpenCalc').hidden = false;
      Promise.all([loadFrame(doc, query, null, null, function (c) { stopFrame = c; }), loadMarket(), rulesReady]).then(function (got) {
        var f = got[0], mkt = got[1], rules = got[2];
        if (my !== tok) { f.remove(); return; }
        var snap = readCalc(f.contentWindow, mkt); f.remove();
        var model = build(snap, rules, ctx);
        $('wbOut').innerHTML = render(model, title) + '<div id="wbMarket"><p class="sr-muted">Loading market figures…</p></div><div id="wbResearch"></div>';
        status(''); $('wbPrint').hidden = false;
        if ($('wbOut').scrollIntoView) $('wbOut').scrollIntoView({ block: 'start' });
        if (model.error) { $('wbMarket').innerHTML = ''; return; }
        var deal = ctx && ctx.deal;
        // The editor stays live while its form is on screen: opening another deal clears the form first, and
        // changing a picker without opening leaves this deal on screen and editable.
        if (deal) researchEditor(doc, deal, model, function () { status('Your market research did not load.'); });
        else $('wbResearch').innerHTML = '<p class="sr-muted">To add comparables, waitlist counts and the rent survey, save this deal in <a href="developer-submittal-review.html">Submittal review</a> and open it from the saved deals here.</p>';
        var first = market(model, snap, mkt), mEl = $('wbMarket');
        // The market fills in while its own section is on screen; only opening another deal replaces it.
        (first.error ? Promise.resolve({}) : loadDealDetails(mkt, first)).then(function (detail) {
          if (mEl.isConnected === false || $('wbMarket') !== mEl) return;
          mEl.innerHTML = renderMarket(first.error ? first : market(model, snap, Object.assign({}, mkt, { dealDetail: detail })));
        });
      }, function (err) { if (my === tok) status(err.message); });
    }
    // Saved deals: the team's, from the private backend. Without it, the picker says so and the other routes still work.
    // A list request that stalls says so instead of leaving the picker on Loading.
    settleWithin(api('').then(null, function () { return { offline: true }; }), wait).then(function (j) {
      if (j == null) { $('wbDeals').innerHTML = '<option value="">Saved deals did not load. Reload the page to try again.</option>'; $('wbDeals').disabled = true; return; }
      if (j.offline) { $('wbDeals').innerHTML = '<option value="">Saved deals are on the team site only</option>'; $('wbDeals').disabled = true; return; }
      var deals = j.deals || [];
      if (!deals.length) { $('wbDeals').innerHTML = '<option value="">No saved deals yet</option>'; return; }
      $('wbDeals').innerHTML = '<option value="">Choose a deal</option>' + deals.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name || d.id) + '</option>'; }).join('');
    });
    // Changing the saved deal or version abandons a saved version still loading, so it never renders under the new choice.
    $('wbVersions').addEventListener('change', function () { supersede(); });
    $('wbDeals').addEventListener('change', function () {
      supersede();
      var deal = $('wbDeals').value; $('wbVersions').innerHTML = ''; if (!deal) return;
      settleWithin(api('?deal=' + encodeURIComponent(deal)), wait).then(function (j) {
        if ($('wbDeals').value !== deal) return;
        if (j == null) { status('That deal\'s versions did not load.'); return; }
        var vs = (j && j.versions) || [], hidden = (j && j.hidden) || [];
        vs = vs.filter(function (v) { return hidden.indexOf(v.v) === -1; });
        $('wbVersions').innerHTML = vs.map(function (v) { return '<option value="' + esc(v.v) + '">' + esc((v.label || 'Version') + ' · ' + String(v.at || '').slice(0, 10) + (v.by ? ' · ' + v.by : '')) + '</option>'; }).join('');
      });
    });
    $('wbOpenSaved').addEventListener('click', function () {
      var deal = $('wbDeals').value, v = $('wbVersions').value;
      if (!deal || !v) { status('Choose a deal and a version.'); return; }
      var gen = take(), name = $('wbDeals').selectedOptions[0].textContent;
      status('Loading that saved version…');
      // A stalled or failed request settles as null, so the page says so instead of staying blank.
      settleWithin(api('?deal=' + encodeURIComponent(deal) + '&v=' + encodeURIComponent(v)), wait).then(function (x) {
        // Another deal was opened, or the choice changed, while this one loaded.
        if (gen !== tok || $('wbDeals').value !== deal || $('wbVersions').value !== v) return;
        if (x == null) { status('That version did not load. Try again, or use a share link or Export JSON file.'); return; }
        var q = queryFrom(x);
        if (!q) { status('That version was saved without a Deal Calculator export. Open it in Submittal review, load an export, and save again.'); return; }
        var dl = (x.data && x.data.deal) || x.deal || {};
        open(q, name, gen, { supportive: typeof dl.supportive === 'boolean' ? dl.supportive : null, deal: deal });
      });
    });
    $('wbOpenLink').addEventListener('click', function () { open(queryFrom($('wbLink').value), null); });
    $('wbFile').addEventListener('change', function () {
      var file = $('wbFile').files[0]; if (!file) return;
      var gen = take();
      file.text().then(function (t) {
        // Another file was picked, or another deal opened, while this one was read.
        if ($('wbFile').files[0] !== file || gen !== tok) return;
        var j; try { j = JSON.parse(t); } catch (e) { status('That file is not a Deal Calculator export.'); return; }
        if (j && j.dealMode === 'ownership') { status('That export is a for-sale deal. The workbook covers rental tax credit deals.'); return; }
        open(queryFrom(j), file.name.replace(/\.json$/i, ''), gen);
      });
    });
    $('wbPrint').addEventListener('click', function () { window.print(); });
    // A closed <details> prints empty, so open every one for printing and put them back after.
    var shut = [];
    window.addEventListener('beforeprint', function () { shut = Array.prototype.filter.call(doc.querySelectorAll('details'), function (d) { return !d.open; }); shut.forEach(function (d) { d.open = true; }); });
    window.addEventListener('afterprint', function () { shut.forEach(function (d) { d.open = false; }); shut = []; });
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && !(typeof module === 'object' && module.exports)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(document); });
    else start(document);
  }

  return { build: build, render: render, research: research, renderResearch: renderResearch, researchEditor: researchEditor, miles: miles, MARKET_API: MARKET_API, WAIT_BANDS: WAIT_BANDS, market: market, renderMarket: renderMarket, rentersAtOrBelow: rentersAtOrBelow, zoriMetroSeries: zoriMetroSeries, MARKET_URLS: MARKET_URLS, findings: findings, chfaMinimums: chfaMinimums, queryFrom: queryFrom, calcUrl: calcUrl, loadFrame: loadFrame, settleWithin: settleWithin, start: start, webLink: webLink, money: money, RULES_URL: RULES_URL, API: API };
});
