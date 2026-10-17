/** Permanent financing in the Division of Housing layout (DOH PR 3).
 * Pure functions, no DOM. The engine's sources are regrouped the way DOH's
 * Housing Development Analysis spreadsheet, Permanent Financing Sources tab,
 * groups them: hard mortgages typed Conventional, Tax-exempt or Federal
 * financing; tax credit equity; government grants and soft debt; other
 * (non-governmental) grants; owner equity. Nothing here changes a result:
 * every dollar is the engine's, and the groups add back to its total sources.
 * An unknown figure is null with a reason, never 0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealPermanentFinancing = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // DOH's "Types of Loans" key: C, T and F.
  var LENDER_TYPES = Object.freeze([
    Object.freeze({ id: 'C', label: 'Conventional' }),
    Object.freeze({ id: 'T', label: 'Tax-exempt' }),
    Object.freeze({ id: 'F', label: 'Federal financing' })
  ]);

  // Where a soft-funding tranche sits in DOH's sources. A hard mortgage carries
  // its DOH loan type in the value.
  var GROUPS = Object.freeze([
    Object.freeze({ id: 'hard_C', label: 'Hard mortgage: Conventional' }),
    Object.freeze({ id: 'hard_T', label: 'Hard mortgage: Tax-exempt' }),
    Object.freeze({ id: 'hard_F', label: 'Hard mortgage: Federal financing' }),
    Object.freeze({ id: 'government', label: 'Government grant or soft debt' }),
    Object.freeze({ id: 'other', label: 'Other grant (non-governmental)' }),
    Object.freeze({ id: 'owner', label: 'Owner equity' })
  ]);

  // Public programs are government money; a sponsor or affiliate loan is the
  // owner's money; a seller note and NMTC proceeds are neither. "Other / custom"
  // is left for the user to answer. Historic credit equity always sits with
  // DOH's tax credit equity, whatever the row says.
  var PROGRAM_GROUP = Object.freeze({
    chfa_htf: 'government', prop123: 'government', local_pha: 'government', chfa_cmf: 'government',
    dola_htf: 'government', home: 'government', cdbg: 'government', nhtf: 'government',
    impact_fee_loan: 'government', sponsor_loan: 'owner', seller_carry: 'other', nmtc: 'other'
  });
  var HISTORIC_PROGRAM = 'historic_tc';
  // Short program names for the mortgage list, as the Sources & Uses detail shows them.
  var PROGRAM_LABELS = Object.freeze({
    chfa_htf: 'CHFA HTF', prop123: 'Prop 123', local_pha: 'Local PHA / Housing Trust', chfa_cmf: 'CHFA CMF',
    dola_htf: 'DOLA HTF', home: 'HOME', cdbg: 'CDBG', nhtf: 'NHTF', impact_fee_loan: 'Impact Fee',
    sponsor_loan: 'Sponsor Loan', historic_tc: 'Historic TC', nmtc: 'NMTC', seller_carry: 'Seller-carry', other: 'Other'
  });
  // DOH's sheet shows possible debt service at this coverage ratio.
  var DOH_DCR = 1.15;
  // Repayment types with a payment due whatever the cash flow.
  var MUST_PAY = ['amortizing', 'interest_only', 'io_then_amortizing'];

  function defaultGroup(program) { return PROGRAM_GROUP[program] || ''; }
  function known(v) { return typeof v === 'number' && Number.isFinite(v); }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  function isGroup(id) { return GROUPS.some(function (g) { return g.id === id; }); }

  /** The DOH group a tranche counts in, with the reason when it has none. */
  function trancheGroup(t) {
    // Historic credit proceeds are equity; entered as a loan, the row is a loan
    // like any other and takes the group the user chooses.
    if (t.program === HISTORIC_PROGRAM && t.mode !== 'loan') return { group: 'historic', reason: null };
    var g = t.doh === undefined || t.doh === null ? defaultGroup(t.program) : t.doh;
    if (!g) return { group: null, reason: 'Choose where this source counts in DOH\'s layout.' };
    if (!isGroup(g)) return { group: null, reason: 'Unknown DOH source group.' };
    if (/^hard_/.test(g) && t.mode === 'grant') return { group: null, reason: 'A grant is not a hard mortgage; choose another DOH group.' };
    return { group: g, reason: null };
  }

  // Sum known parts; any unknown part makes the sum unknown.
  function sum(values) {
    var total = 0;
    for (var i = 0; i < values.length; i++) { if (!known(values[i])) return null; total += values[i]; }
    return total;
  }

  /** Maximum loan by value × LVR, as DOH's quick calculation of mortgage
   * principal does: by NOI over a cap rate, and by an appraised value. */
  function maxLoanChecks(opts) {
    var noi = opts.noi, cap = num(opts.capRatePct), capLvr = num(opts.capLvrPct);
    var appraised = num(opts.appraisedValue), appLvr = num(opts.appraisedLvrPct);
    var byCap = { value: null, maxLoan: null, reason: null };
    if (cap === null || capLvr === null) byCap.reason = 'Enter a cap rate and a loan-to-value ratio.';
    else if (!(cap > 0) || !(capLvr > 0) || capLvr > 100) byCap.reason = 'Enter a cap rate above 0% and a loan-to-value ratio from 1% to 100%.';
    else if (!known(noi)) byCap.reason = 'NOI is not available.';
    else if (!(noi > 0)) byCap.reason = 'NOI is $0 or less, so there is no income value to lend against.';
    else { byCap.value = noi / (cap / 100); byCap.maxLoan = byCap.value * capLvr / 100; }
    var byAppraisal = { value: null, maxLoan: null, reason: null };
    if (appraised === null || appLvr === null) byAppraisal.reason = 'Enter an appraised value and a loan-to-value ratio.';
    else if (!(appraised > 0) || !(appLvr > 0) || appLvr > 100) byAppraisal.reason = 'Enter an appraised value above $0 and a loan-to-value ratio from 1% to 100%.';
    else { byAppraisal.value = appraised; byAppraisal.maxLoan = appraised * appLvr / 100; }
    return { byCap: byCap, byAppraisal: byAppraisal };
  }

  /** DOH's Permanent Financing Sources from an engine result. */
  function summarize(opts) {
    var r = opts.result || {};
    var tranches = opts.tranches || [];
    var breakdown = {};
    (r.trancheBreakdown || []).forEach(function (b) { breakdown[b.id] = b; });
    var seniorType = LENDER_TYPES.some(function (t) { return t.id === opts.seniorLenderType; }) ? opts.seniorLenderType : null;
    var out = { hardMortgages: [], government: [], other: [], owner: [], historic: [], unclassified: [], reasons: [] };

    var seniorPrincipal = known(r.mortgage) ? r.mortgage : null;
    var seniorHeld = false;
    var seniorLoan = r.obligations && r.obligations.loans ? r.obligations.loans.filter(function (l) { return l.senior; })[0] : null;
    if (seniorLoan && MUST_PAY.indexOf(seniorLoan.type) < 0) {
      // Same rule as a tranche: a deferred, cash-flow or forgivable senior loan
      // has no fixed payment, so it is not one of DOH's hard mortgages.
      var seniorReason = 'The senior loan is cash-flow, deferred or forgivable, so it is not a hard mortgage; it is held apart.';
      out.unclassified.push({ id: 'senior', source: 'senior', program: 'senior', mode: 'loan', amount: seniorPrincipal, annualPayment: null, reason: seniorReason });
      out.reasons.push(seniorReason);
      seniorHeld = true;
    } else {
      out.hardMortgages.push({ label: 'First mortgage', source: 'senior', lenderType: seniorType,
        principal: seniorPrincipal,
        // The engine's first-year senior payment for the chosen repayment type:
        // interest only pays interest.
        annualPayment: seniorPrincipal !== null && known(r.annualDebtService) ? r.annualDebtService : null,
        reason: seniorType ? null : 'Choose the first mortgage\'s DOH loan type.' });
      if (!seniorType) out.reasons.push('Choose the first mortgage\'s DOH loan type.');
    }

    tranches.forEach(function (t) {
      var amount = num(t.amount);
      if (amount === 0) return; // an explicitly empty source contributes no dollars, as in the engine
      var item = { id: t.id, program: t.program, mode: t.mode, amount: known(amount) && amount > 0 ? amount : null };
      var b = breakdown[t.id];
      item.annualPayment = t.mode === 'grant' ? 0 : b && known(b.debtService) ? b.debtService : null;
      var g = trancheGroup(t);
      // DOH's hard mortgages are paid whatever the cash flow; a contingent,
      // deferred or forgivable loan has no fixed payment to cover.
      if (g.group && /^hard_/.test(g.group) && b && b.loanType && MUST_PAY.indexOf(b.loanType) < 0) {
        g = { group: null, reason: 'A cash-flow, deferred or forgivable loan is not a hard mortgage; choose another DOH group.' };
      }
      if (!g.group) { item.reason = g.reason; out.unclassified.push(item); out.reasons.push(g.reason); return; }
      if (/^hard_/.test(g.group)) {
        var ordinal = ['First', 'Second', 'Third'][out.hardMortgages.length];
        item.label = ordinal ? ordinal + ' mortgage' : 'Additional hard mortgage';
        item.lenderType = g.group.slice(5);
        item.principal = item.amount;
        out.hardMortgages.push(item);
      } else out[g.group].push(item);
    });
    if (out.hardMortgages.length > 3) out.reasons.push('DOH\'s sheet holds three hard mortgages; this deal has ' + out.hardMortgages.length + '.');

    // DOH's DCR on each mortgage is cumulative: NOI over the payments down to it.
    var noi = known(r.noi) ? r.noi : null, paid = 0;
    out.hardMortgages.forEach(function (m) {
      paid = known(paid) && known(m.annualPayment) ? paid + m.annualPayment : NaN;
      m.cumulativeDcr = noi !== null && known(paid) && paid > 0 ? noi / paid : null;
    });

    function principals(type) {
      return sum(out.hardMortgages.filter(function (m) { return m.lenderType === type; }).map(function (m) { return m.principal; }));
    }
    function amounts(list) { return sum(list.map(function (i) { return i.amount; })); }
    var creditType = r.creditType === '4' ? '4' : '9';
    var federal = known(r.equity) ? r.equity : null;
    out.taxCredit = {
      nine: creditType === '9' ? federal : 0,
      four: creditType === '4' ? federal : 0,
      historic: amounts(out.historic),
      state: known(r.stateEquity) ? r.stateEquity : null
    };
    var deferred = known(r.deferredDevFee) ? r.deferredDevFee : null;
    out.deferredDevFee = deferred;
    var t = {
      conventional: principals('C'), taxExempt: principals('T'), federalFinancing: principals('F'),
      taxCredits: sum([out.taxCredit.nine, out.taxCredit.four, out.taxCredit.historic, out.taxCredit.state]),
      government: amounts(out.government), otherGrants: amounts(out.other),
      ownerEquity: sum([deferred].concat(out.owner.map(function (i) { return i.amount; }))),
      unclassified: amounts(out.unclassified)
    };
    // A senior loan without a DOH type still counts in total sources.
    // A senior loan held apart is already in the unclassified total.
    var untypedSenior = seniorHeld || seniorType ? 0 : seniorPrincipal;
    t.totalSources = sum([t.conventional, t.taxExempt, t.federalFinancing, t.taxCredits, t.government,
      t.otherGrants, t.ownerEquity, t.unclassified, untypedSenior]);
    t.gap = known(r.gap) ? r.gap : null;
    t.tdc = known(r.tdc) && r.tdc > 0 ? r.tdc : null;
    out.totals = t;
    out.pctOfTdc = function (v) { return known(v) && t.tdc ? v / t.tdc : null; };

    var hardPayments = sum(out.hardMortgages.map(function (m) { return m.annualPayment; }));
    out.dcr = noi !== null && known(hardPayments) && hardPayments > 0 ? noi / hardPayments : null;
    // A negative NOI supports no borrowing; it is not a negative debt service.
    out.possibleDebtService = noi !== null && noi > 0 ? noi / DOH_DCR : null;
    if (noi !== null && !(noi > 0)) out.reasons.push('NOI is $0 or less, so it supports no debt service.');
    out.breakEven = known(r.breakEvenOcc) ? r.breakEvenOcc : null;
    out.maxLoan = maxLoanChecks({ noi: noi, capRatePct: opts.capRatePct, capLvrPct: opts.capLvrPct,
      appraisedValue: opts.appraisedValue, appraisedLvrPct: opts.appraisedLvrPct });
    var hardTotal = sum(out.hardMortgages.map(function (m) { return m.principal; }));
    var limits = [out.maxLoan.byCap.maxLoan, out.maxLoan.byAppraisal.maxLoan].filter(known);
    out.hardDebt = hardTotal;
    out.overMaxLoan = known(hardTotal) && limits.length ? Math.max(0, hardTotal - Math.min.apply(null, limits)) : null;
    return out;
  }

  /** The summary without its helper function, for the JSON export. */
  function exportView(s) {
    if (!s) return null;
    var t = s.totals;
    return { totals: t, taxCredit: s.taxCredit, deferredDevFee: s.deferredDevFee,
      shareOfTdc: Object.keys(t).reduce(function (o, k) { o[k] = s.pctOfTdc(t[k]); return o; }, {}),
      hardMortgages: s.hardMortgages, government: s.government, other: s.other, owner: s.owner,
      historic: s.historic, unclassified: s.unclassified, dcr: s.dcr, possibleDebtService: s.possibleDebtService,
      dohDcr: DOH_DCR, breakEven: s.breakEven, maxLoan: s.maxLoan, hardDebt: s.hardDebt, overMaxLoan: s.overMaxLoan,
      reasons: s.reasons.filter(function (r, i, all) { return all.indexOf(r) === i; }) };
  }

  return {
    exportView: exportView,
    LENDER_TYPES: LENDER_TYPES, GROUPS: GROUPS, PROGRAM_LABELS: PROGRAM_LABELS, PROGRAM_GROUP: PROGRAM_GROUP, HISTORIC_PROGRAM: HISTORIC_PROGRAM, DOH_DCR: DOH_DCR,
    defaultGroup: defaultGroup, trancheGroup: trancheGroup, maxLoanChecks: maxLoanChecks, summarize: summarize
  };
});
