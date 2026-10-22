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
  function build(snap, rules) {
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
        sources.push({ label: m.source === 'senior' ? 'First mortgage' : (m.label || 'Mortgage') + (m.program ? ' (' + (labels[m.program] || m.program) + ')' : ''), amount: num(m.principal) });
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
      if (num(tc.state)) sources.push({ label: 'Colorado state credit equity', amount: num(tc.state) });
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
          if (k === 'unclassified' && s.reason) name += ': not yet grouped, ' + s.reason;
          sources.push({ label: name, amount: num(s.amount != null ? s.amount : s.principal) }); });
      });
      if (num(pf.deferredDevFee)) sources.push({ label: 'Deferred developer fee', amount: num(pf.deferredDevFee) });
      else if (pf.deferredDevFee == null && un.deferredDevFee) sources.push({ label: 'Deferred developer fee: not known, ' + un.deferredDevFee, amount: null });
      model.sources = { rows: sources, total: num(pf.totals.totalSources), gap: num(pf.totals.gap), tdc: num(pf.totals.tdc) };
    } else model.sources = { rows: [], reason: (pf && pf.reasons && pf.reasons[0]) || un.fundingGap || 'The calculator could not build the sources for this deal.' };

    // Uses: the itemized budget by group.
    // A budget line the engine could not read leaves partial groups behind; its reason wins over them.
    var bg = r.budget && !r.budget.reason && r.budget.groups;
    model.uses = bg ? {
      rows: USE_GROUPS.map(function (g) { return { label: g[1], amount: num(bg[g[0]]) }; }).filter(function (x) { return x.amount; }),
      notItemized: num(r.budget.notItemized), tdc: num(r.tdc)
    } : { rows: [], tdc: num(r.tdc), reason: (r.budget && r.budget.reason) || 'No itemized budget.' };

    // Basis and credits.
    var b = r.costBasis && r.costBasis.basis;
    if (b) {
      var rate = num(b.qualifiedBasis) && num(b.calculatedCredit) != null ? num(b.calculatedCredit) / num(b.qualifiedBasis) : null;
      model.basis = {
        eligible: num(b.eligibleBasis), grantReduction: num(b.grantReduction), boost: b.boost || {}, boosted: num(b.boostedBasis),
        applicableFraction: num(b.applicableFraction), qualified: num(b.qualifiedBasis), rate: rate, calculated: num(b.calculatedCredit),
        cap: b.cap || {}, gapMethod: b.gapMethod || {}, credit: num(r.annualCredits), creditReason: un.annualCredits || null,
        price: num(r.equityPrice), equity: num(r.equity)
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
          bridge: num(y.bridgeDebtService), assetMgmt: num(y.assetMgmtFee), contingent: num(y.contingentPaid),
          cashFlow: num(y.cashFlow), dscr: num(y.dscr), seniorDscr: num(y.seniorDscr), feePaid: paid, feeOwed: owed, reason: y.unavailableReason || null };
      })
    };
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
    model.findings = findings(model, r);
    return model;
  }

  // ── Checks, written as findings ───────────────────────────────────────────
  // Each: { level: 'bad' | 'warn' | 'ok', text, source? }. Only what the figures show; nothing guessed.
  function findings(m, r) {
    var out = [], min = m.operating.min;
    if (m.rulesMissing) out.push({ level: 'warn', text: 'CHFA\'s underwriting rules did not load, so operating cost, reserve, vacancy, growth and debt coverage were not checked against its minimums. Reload the page to check them.' });
    var thisYear = new Date().getFullYear();
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
      ['operating cost plus property tax', min.opex, o.opexPerUnit == null || o.opexPerUnit < (min.opex ? min.opex.value : 0) ? 0 : o.taxPerUnit, rs.tax],
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
    var y1 = m.cashFlow.rows[0];
    if (y1 && y1.dscr != null && min.high && y1.dscr > min.high.value) out.push({ level: 'warn', text: 'Year-one coverage of ' + ratio(y1.dscr) + ' is above ' + ratio(min.high.value) + ', so CHFA may award less credit. A larger loan or lower rents would bring it down.', source: min.high });

    m.loans.forEach(function (l) {
      if (!l.amount) return;
      if (l.type === 'interest_only' || l.type === 'io_then_amortizing') out.push({ level: 'warn', text: l.label + ' is modeled ' + (l.type === 'interest_only' ? 'interest-only to maturity' : 'interest-only for ' + l.ioYears + ' years') + '. Get that term in the lender\'s letter; an amortizing loan would cost more each year.' });
      if (l.balloon != null && l.balloon > 0.5) out.push({ level: 'warn', text: l.label + ' matures in year ' + l.maturity + ' with ' + money(l.balloon) + ' due. The calculator assumes no refinancing, so years after that are not projected.' });
    });

    var cap = m.basis.cap || {};
    if (cap.binding) out.push({ level: 'warn', text: 'CHFA\'s per-project credit limit (' + money(num(cap.amount)) + ') holds the credit below what the basis supports.', source: cap.citation ? { where: cap.citation } : null });
    var gm = m.basis.gapMethod || {};
    if (gm.binding) out.push({ level: 'warn', text: 'CHFA\'s gap method limits the credit: the deal needs only ' + money(num(gm.credit)) + ' a year to fill its gap.', source: gm.citation ? { where: gm.citation } : null });
    if (m.basis.boost && m.basis.boost.applied === false && m.basis.boost.reason) out.push({ level: 'ok', text: 'No basis boost: ' + m.basis.boost.reason });

    var df = m.deferredFee;
    // Unknown is not the same as none: the engine says why it could not size the fee.
    if (df.amount == null) out.push({ level: 'warn', text: 'The deferred developer fee is not known: ' + (df.reason || 'the calculator did not size it') + '.' });
    else if (df.amount) {
      if (df.paybackYear != null) out.push({ level: 'ok', text: 'The deferred fee of ' + money(df.amount) + ' is paid off from cash flow in year ' + df.paybackYear + '.' });
      else if (df.owedAt15 == null) out.push({ level: 'warn', text: 'Whether the deferred fee is paid off in 15 years is not known: ' + (df.payoffReason || 'the cash flow is incomplete') + '.' });
      else out.push({ level: 'bad', text: 'The deferred fee is not paid off in 15 years: ' + money(df.owedAt15) + ' of ' + money(df.amount) + ' is still owed' + (df.paidLater ? ' (paid off in year ' + df.paidLater + ')' : '') + '.' });
    }
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
      var br = [['Eligible basis', money(b.eligible)]];
      if (b.grantReduction) br.push(['Less federal grants', money(-b.grantReduction)]);
      br.push(['Basis boost', b.boost && b.boost.applied ? '×' + num(b.boost.multiplier) : 'None']);
      br.push(['Applicable fraction', pct(b.applicableFraction, 1)]);
      br.push(['Qualified basis', money(b.qualified)]);
      br.push(['Credit rate', b.rate == null ? '—' : pct(b.rate, 2)]);
      br.push(['Credit the basis supports', money(b.calculated)]);
      if (b.cap && b.cap.applied) br.push(['CHFA per-project limit', money(num(b.cap.amount))]);
      if (b.gapMethod && b.gapMethod.applied) br.push(['Credit to fill the gap (CHFA gap method)', money(num(b.gapMethod.credit))]);
      br.push(['Yearly credit used', b.credit == null ? '— ' + (b.creditReason || '') : money(b.credit)]);
      br.push(['Equity price', b.price == null ? '—' : '$' + b.price.toFixed(3)]);
      br.push(['Credit equity (10 years of credit × price)', money(b.equity)]);
      h += table(['Line', 'Amount'], br.map(function (x) { return { cells: [esc(x[0]), esc(x[1])] }; }), { num: [1], fixed: true });
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
    h += '<section class="dv-card" aria-labelledby="wbCF"><h2 id="wbCF">15-year cash flow</h2>';
    if (cf.rows.length) {
      var lines = [
        ['Gross rent', 'grossRents'], ['Other income', 'otherIncome'], ['Less vacancy', 'vacancy', -1], ['Effective gross income', 'egi', 1, true],
        ['Operating costs', 'opex', -1], ['Replacement reserve', 'reserve', -1], ['Property tax', 'tax', -1], ['Net operating income', 'noi', 1, true],
        ['Must-pay debt service', 'debtService', -1], ['Bridge loan payments', 'bridge', -1], ['Asset management fee paid', 'assetMgmt', -1],
        ['Cash-flow loan payments', 'contingent', -1], ['Cash flow', 'cashFlow', 1, true], ['Coverage, all must-pay debt', 'dscr', 'x'], ['Coverage, first mortgage', 'seniorDscr', 'x'],
        ['Deferred fee paid', 'feePaid'], ['Deferred fee still owed', 'feeOwed']
      ];
      // Every deduction between NOI and cash flow is shown when the deal has it, so the rows reconcile.
      var optional = ['bridge', 'assetMgmt', 'contingent'];
      lines = lines.filter(function (ln) { return optional.indexOf(ln[1]) < 0 || cf.rows.some(function (y) { return y[ln[1]] == null || Math.abs(y[ln[1]]) > 0.5; }); });
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

  // ── Browser ───────────────────────────────────────────────────────────────
  function loadFrame(doc, query, timeoutMs, pollMs) {
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
      doc.body.appendChild(f);
    });
  }
  // The calculator's own wording for why no allowance was applied, e.g. 'allowance_bedroom_missing:2BR'.
  function uaWithText(ua, limits) {
    if (!ua || ua.applied || !ua.reason || !limits || !limits.unavailableMessage) return ua;
    var parts = String(ua.reason).split(':'), text = ua.reason === 'shared_allowance_invalid' ? 'Shared utility allowance record is invalid' : limits.unavailableMessage(parts[0]);
    return Object.assign({}, ua, { reasonText: text ? text + (parts[1] ? ' (' + parts[1] + ')' : '') : null });
  }
  function readCalc(w) {
    var dc = w.__DealCalc;
    return { result: dc.getResult(), permanentFinancing: dc.getPermanentFinancing ? dc.getPermanentFinancing() : null,
      rentLimits: dc.getRentLimitsMetadata ? dc.getRentLimitsMetadata() : null, rentSchedule: dc.getRentScheduleMetadata ? dc.getRentScheduleMetadata() : null, utilityAllowance: dc.getUtilityAllowanceMetadata ? uaWithText(dc.getUtilityAllowanceMetadata(), w.ChfaRentLimits) : null,
      amiByBr: dc.getAmiLimitsByBr ? dc.getAmiLimitsByBr() : null,
      mode: (function () { var c = w.document.querySelector('input[name="dc-deal-mode"]:checked'); return c ? c.value : null; })(), labels: (w.DealPermanentFinancing && w.DealPermanentFinancing.PROGRAM_LABELS) || {} };
  }
  // The calculator settings carried by a share link, an export file's url, or a saved version.
  function queryFrom(x) {
    if (!x) return null;
    if (typeof x === 'string') {
      var s = x.trim(), q = s.indexOf('?');
      if (q !== -1) return s.slice(q + 1).replace(/#.*$/, '') || null;
      return /=/.test(s) ? s : null;
    }
    if (x.url) return queryFrom(String(x.url));
    if (x.calculator && x.calculator.query) return x.calculator.query;
    if (x.data && x.data.calculator && x.data.calculator.query) return x.data.calculator.query;
    return null;
  }

  // A request that stalls settles as null after ms, so the workbook builds without it rather than waiting forever.
  function settleWithin(p, ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(null); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
    });
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
    function take() {
      $('wbOut').innerHTML = ''; $('wbPrint').hidden = true; $('wbOpenCalc').hidden = true;
      return ++tok;
    }
    function open(query, title, reserved) {
      var my = reserved != null ? reserved : take();
      if (my !== tok) return;
      if (!query) { status('That has no Deal Calculator settings in it. Use a share link or an Export JSON file from the Deal Calculator.'); return; }
      status('Running the Deal Calculator for this deal…');
      $('wbOpenCalc').href = calcUrl(query, doc.baseURI); $('wbOpenCalc').hidden = false;
      Promise.all([loadFrame(doc, query), rulesReady]).then(function (got) {
        var f = got[0], rules = got[1];
        if (my !== tok) { f.remove(); return; }
        var snap = readCalc(f.contentWindow); f.remove();
        $('wbOut').innerHTML = render(build(snap, rules), title);
        status(''); $('wbPrint').hidden = false;
        if ($('wbOut').scrollIntoView) $('wbOut').scrollIntoView({ block: 'start' });
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
    $('wbDeals').addEventListener('change', function () {
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
        open(q, name, gen);
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

  return { build: build, render: render, findings: findings, chfaMinimums: chfaMinimums, queryFrom: queryFrom, calcUrl: calcUrl, loadFrame: loadFrame, settleWithin: settleWithin, start: start, money: money, RULES_URL: RULES_URL, API: API };
});
