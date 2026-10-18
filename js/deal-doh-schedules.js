/** Sources and uses by activity, and the 15-year operating pro forma, in the
 * Division of Housing layout (DOH PR 4). Pure functions, no DOM.
 *
 * Sources by activity: DOH's Permanent Sources & Uses Budget lists, for each
 * of the nine cost categories, its total cost, the state funds requested, the
 * other funds, each source and whether it is pending or committed. Here each
 * soft source says what it pays for; tax credit equity, the mortgages, the
 * deferred fee and any source not tied to one category pay for the project as
 * a whole and sit in one row. Every dollar is the engine's, through the DOH
 * permanent financing summary, so the table adds back to its total sources.
 *
 * 15-year pro forma: the engine's projection and loan schedule in DOH's rows.
 * Cash after the must-pay loans and the bridge loan pays the asset management
 * fee (any part cash cannot cover accrues to later years), then cash-flow loans, then the deferred developer fee. The engine
 * allocates all three; the deferred fee is paid from cumulative cash flow, so
 * its payback year is the exit panel's.
 * An unknown figure is null with a reason, never 0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealDohSchedules = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // DOH's nine categories, in its order (the same ids as deal-cost-basis.js).
  var ACTIVITIES = Object.freeze([
    ['acquisition', 'Acquisition'], ['site', 'Site improvements'], ['construction', 'Construction'],
    ['professional', 'Professional fees'], ['construction_finance', 'Construction finance'],
    ['permanent_finance', 'Permanent finance and syndication'], ['soft', 'Soft costs'],
    ['fees', 'Developer fee'], ['reserves', 'Reserves']
  ].map(function (a) { return Object.freeze({ id: a[0], label: a[1] }); }));
  var STATUSES = Object.freeze([
    Object.freeze({ id: 'pending', label: 'Pending' }),
    Object.freeze({ id: 'committed', label: 'Committed' })
  ]);
  // Programs whose money is a request to the state by default: the Division of
  // Housing's own Housing Development Grant/Loan fund (DOLA HTF) and Prop 123.
  // Any other source is a state request only if the user says so.
  var STATE_PROGRAMS = Object.freeze(['dola_htf', 'prop123']);
  var YEARS = 15;

  function known(v) { return typeof v === 'number' && Number.isFinite(v); }
  function sum(values) {
    return values.reduce(function (a, v) { return known(a) && known(v) ? a + v : null; }, 0);
  }
  function isActivity(id) { return ACTIVITIES.some(function (a) { return a.id === id; }); }
  function defaultStateRequest(program) { return STATE_PROGRAMS.indexOf(program) !== -1; }
  function stateRequest(t) {
    return t.stateRequest === undefined || t.stateRequest === null ? defaultStateRequest(t.program) : !!t.stateRequest;
  }
  function statusOf(t) { return t.status === 'committed' ? 'committed' : 'pending'; }

  /** Sources and uses by activity.
   * opts.costSummary: the engine's costBasis.summary (groups, notItemized, reason)
   * opts.financing: DealPermanentFinancing.summarize() output
   * opts.tranches: the soft sources with activity, status and stateRequest
   * opts.labels: program id → short name
   */
  function sourcesByActivity(opts) {
    var cs = opts.costSummary || {}, fin = opts.financing, labels = opts.labels || {};
    var byId = {};
    (opts.tranches || []).forEach(function (t) { byId[t.id] = t; });
    var costReason = cs.reason || null;
    var rows = ACTIVITIES.map(function (a) {
      return { id: a.id, label: a.label, cost: costReason ? null : (known(cs.groups && cs.groups[a.id]) ? cs.groups[a.id] : null),
        state: 0, other: 0, sources: [], reason: costReason };
    });
    var general = { sources: [], amount: 0, state: 0, other: 0 };
    var reasons = costReason ? [costReason] : [];
    if (!fin) return { rows: rows, notItemized: null, general: null, totals: null, reasons: reasons.concat('Permanent financing is unavailable.') };

    // Each soft source the financing summary counted, in whatever DOH group.
    var items = [].concat(fin.hardMortgages.filter(function (m) { return m.source !== 'senior'; }),
      fin.government, fin.other, fin.owner, fin.historic, fin.unclassified.filter(function (u) { return u.source !== 'senior'; }));
    items.forEach(function (item) {
      var t = byId[item.id] || {};
      var entry = { id: item.id, name: labels[item.program] || item.program, amount: item.amount,
        status: statusOf(t), state: stateRequest(t) };
      var row = isActivity(t.activity) ? rows.filter(function (r) { return r.id === t.activity; })[0] : null;
      if (!row) {
        general.sources.push(entry);
        general.amount = sum([general.amount, item.amount]);
        if (entry.state) general.state = sum([general.state, item.amount]);
        else general.other = sum([general.other, item.amount]);
        return;
      }
      row.sources.push(entry);
      if (entry.state) row.state = sum([row.state, item.amount]);
      else row.other = sum([row.other, item.amount]);
    });
    rows.forEach(function (r) {
      r.subtotal = sum([r.state, r.other]);
      if (known(r.cost) && known(r.subtotal) && r.subtotal > r.cost + 0.5) {
        r.reason = 'The sources assigned to ' + r.label.toLowerCase() + ' are more than its cost.';
        reasons.push(r.reason);
      }
    });

    // Sources that pay for the whole project: the first mortgage, tax credit
    // equity and the deferred fee, beside the soft sources tied to no category.
    var senior = fin.hardMortgages.filter(function (m) { return m.source === 'senior'; })[0]
      || fin.unclassified.filter(function (u) { return u.source === 'senior'; })[0];
    var tc = fin.taxCredit;
    var whole = [
      senior ? { id: 'senior', name: 'First mortgage', amount: senior.principal === undefined ? senior.amount : senior.principal } : null,
      // Only an explicit $0 is left out; unknown equity (null) stays and makes the total unknown.
      tc.nine === 0 ? null : { id: 'lihtc9', name: '9% LIHTC proceeds', amount: tc.nine },
      tc.four === 0 ? null : { id: 'lihtc4', name: '4% LIHTC proceeds', amount: tc.four },
      tc.state === 0 ? null : { id: 'state_credit', name: 'Colorado state credit proceeds', amount: tc.state },
      fin.deferredDevFee === 0 ? null : { id: 'deferred_fee', name: 'Deferred developer fee', amount: fin.deferredDevFee }
    ].filter(Boolean);
    whole.forEach(function (w) {
      general.amount = sum([general.amount, w.amount]);
      general.other = sum([general.other, w.amount]);
    });
    general.sources = whole.concat(general.sources);

    var notItemized = costReason ? null : known(cs.notItemized) && cs.notItemized > 0 ? cs.notItemized : 0;
    var t = {
      cost: costReason ? null : sum(rows.map(function (r) { return r.cost; }).concat(notItemized)),
      state: sum(rows.map(function (r) { return r.state; }).concat(general.state)),
      other: sum(rows.map(function (r) { return r.other; }).concat(general.other))
    };
    t.general = general.amount;
    t.sources = sum([t.state, t.other]);
    // DOH's gap is total costs less total sources: the engine's gap.
    t.gap = fin.totals && known(fin.totals.gap) ? fin.totals.gap : null;
    return { rows: rows, notItemized: notItemized, general: general, totals: t,
      reasons: reasons.filter(function (r, i, all) { return all.indexOf(r) === i; }) };
  }

  function window3(values) {
    return { first10: sum(values.slice(0, 10)), last5: sum(values.slice(10, YEARS)), total: sum(values.slice(0, YEARS)) };
  }

  /** The 15-year operating pro forma in DOH's rows, from an engine result. */
  function fifteenYear(result) {
    var r = result || {};
    var unavailable = r.unavailable || {};
    if (!r.projection || !r.projection.rows) {
      return { rows: null, reason: unavailable.projection || unavailable.obligations || 'The operating projection is unavailable.' };
    }
    var loans = r.obligations && r.obligations.loans ? r.obligations.loans.filter(function (l) { return l.type === 'cash_flow'; }) : [];
    var fee = known(r.deferredDevFee) ? r.deferredDevFee : null;
    var hold = r.exit && known(r.exit.holdYears) ? r.exit.holdYears : YEARS;
    var rows = r.projection.rows.slice(0, YEARS).map(function (p, i) {
      var reason = p.unavailableReason || null;
      var ds = p.debtService, bridge = p.bridgeDebtService;
      var cfAvailable = known(ds) && known(bridge) ? p.noi - ds - bridge : null;
      var loanPaid = loans.map(function (l) { var row = l.rows[i]; return row && known(row.paid) ? row.paid : null; });
      // The engine pays the deferred fee from cumulative cash flow (see its projection).
      var deferred = fee === null ? null : known(p.deferredFeePaid) ? p.deferredFeePaid : null;
      return {
        year: p.year, rentIncome: p.grossRents, vacancy: p.vacancyLoss, otherIncome: p.otherIncome, egi: p.egi,
        expenses: sum([p.opex, p.repReserve, p.propTax]), noi: p.noi, debtService: ds, bridge: bridge,
        cashFlowAvailable: cfAvailable,
        dcr: known(ds) && known(bridge) && ds + bridge > 0 ? p.noi / (ds + bridge) : null,
        deferredFee: deferred, assetMgmtFee: p.assetMgmtFee, assetMgmtUnpaid: p.assetMgmtUnpaid, cashFlowLoans: loanPaid,
        // The engine's cash flow is after the asset fee and cash-flow loans.
        availableAfterPayments: known(p.cashFlow) && known(deferred) ? p.cashFlow - deferred : null,
        reason: reason
      };
    });
    var feeRows = rows.map(function (x) { return x.deferredFee; });
    var paidOffYear = null;
    if (fee !== null && fee > 0) rows.some(function (x, i) {
      var toDate = sum(feeRows.slice(0, i + 1));
      if (known(toDate) && toDate >= fee - 0.005) { paidOffYear = x.year; return true; }
      return false;
    });
    // The payback year is the exit panel's: operations repay the fee within the
    // hold (which can run past year 15); after the sale its proceeds pay the rest.
    var paybackYear = r.exit && known(r.exit.dfYr) ? r.exit.dfYr : null;
    var feeTotal = sum(feeRows);
    // Years the engine could not schedule (an unpaid maturity, say) keep their
    // reason; the notice names them while the known years still show.
    var notice = rows.map(function (x) { return x.reason; }).filter(function (v, i, all) { return v && all.indexOf(v) === i; });
    return {
      notice: notice.length ? notice.join(' ') : null,
      rows: rows,
      loans: loans.map(function (l, n) {
        return { id: l.id, label: 'Cash flow loan #' + (n + 1), program: l.program,
          totals: window3(rows.map(function (x) { return x.cashFlowLoans[n]; })),
          balanceAfter: l.rows[YEARS - 1] && known(l.rows[YEARS - 1].balance) ? l.rows[YEARS - 1].balance : null };
      }),
      deferredFee: { amount: fee, totals: window3(feeRows), paybackYear: paybackYear,
        unpaidAfter: fee !== null && known(feeTotal) ? Math.max(0, fee - feeTotal) : null,
        reason: fee === null ? (unavailable.deferredDevFee || 'The deferred developer fee is unavailable.')
          : fee > 0 && paybackYear === null && paidOffYear !== null ? 'Cash flow does not repay the deferred fee before the year-' + hold + ' sale; the sale proceeds pay the rest.'
          : fee > 0 && paybackYear === null && hold > YEARS ? 'Cash flow does not repay the deferred fee before the year-' + hold + ' sale.'
          : fee > 0 && paybackYear === null && known(feeTotal) ? 'Cash flow does not repay the deferred fee within 15 years.' : null },
      // An asset fee cash could not cover accrues; what is still owed after year 15 is disclosed.
      assetMgmt: Object.assign(window3(rows.map(function (x) { return x.assetMgmtFee; })), {
        unpaidAfter: known(rows[rows.length - 1].assetMgmtUnpaid) ? rows[rows.length - 1].assetMgmtUnpaid : null }),
      bridge: window3(rows.map(function (x) { return x.bridge; })),
      reason: null
    };
  }

  return { ACTIVITIES: ACTIVITIES, STATUSES: STATUSES, STATE_PROGRAMS: STATE_PROGRAMS, YEARS: YEARS,
    defaultStateRequest: defaultStateRequest, stateRequest: stateRequest, isActivity: isActivity,
    sourcesByActivity: sourcesByActivity, fifteenYear: fifteenYear };
});
