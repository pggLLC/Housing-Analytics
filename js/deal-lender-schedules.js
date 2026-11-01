/** Lender schedules built on a finished Deal Engine result: the construction
 * draw schedule and conversion test, the line-by-line 15-year budget with its
 * stress tests and reserve accounts, and the exit paths after the compliance
 * period. Pure: no fetching, no page state. Every figure that cannot be measured
 * is null with a reason in the same object, never $0.
 *
 * compute({ result, fields, rules, rerun }) — result is the cleaned engine
 * result; rerun(fields) returns a fresh engine result for changed fields, used
 * only for the stress cases so every case runs the same engine.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealLenderSchedules = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function num(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    var n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  function known(v) { return typeof v === 'number' && Number.isFinite(v); }
  function inRange(v, lo, hi) { return known(v) && v >= lo && v <= hi; }
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }

  var CURVES = Object.freeze({
    scurve: 'S-curve (slow start, fast middle, slow finish)',
    straight: 'Straight line (the same share each month)',
    front: 'Front-loaded (site work and structure early)'
  });
  // Share of the hard cost spent by the end of a fraction t of the build.
  function curveShare(curve, t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (curve === 'straight') return t;
    if (curve === 'front') return 1 - Math.pow(1 - t, 2);
    return 3 * t * t - 2 * t * t * t;
  }

  // Lines grouped by when the money goes out. Construction interest is not a
  // timed line: the schedule computes it month by month and compares it with the
  // budget line. The deferred developer fee is not paid during construction.
  var HARD_GROUPS = ['site', 'construction'];
  var SPREAD_GROUPS = ['professional', 'construction_finance', 'soft'];
  var CONVERSION_GROUPS = ['permanent_finance', 'reserves'];

  function pct(fields, id, lo, hi, label, reasons) {
    var v = num(fields[id]);
    if (!inRange(v, lo, hi)) { reasons.push('Enter ' + label + ' from ' + lo + '% to ' + hi + '%.'); return null; }
    return v / 100;
  }
  function whole(fields, id, lo, hi, label, reasons) {
    var v = num(fields[id]);
    if (!known(v) || !Number.isInteger(v) || v < lo || v > hi) { reasons.push('Enter ' + label + ' from ' + lo + ' to ' + hi + ' whole months.'); return null; }
    return v;
  }

  /** Month-by-month construction draws, equity pay-in, a construction loan that
   * funds only what the sources in hand do not (interest on the opening balance,
   * capitalized), and the loan payoff at conversion to the permanent loan. */
  function constructionDraw(result, fields) {
    var out = { rows: null, curve: null, curveLabel: null, months: null, convertMonths: null, loan: null, ratePct: null,
      totalUses: null, totalSources: null, peakBalance: null, peakMonth: null, loanEnough: null, totalInterest: null,
      interestBudget: null, interestVsBudget: null, simpleEstimate: null, retainageHeld: null,
      conversion: null, tie: null, reason: null, notes: [] };
    var reasons = [];
    var cb = result.costBasis || {}, summary = cb.summary || {};
    var loan = num(fields['dc-constr-loan']), rate = num(fields['dc-constr-rate']);
    if (!known(loan) || loan <= 0) reasons.push('Enter the construction loan amount.');
    if (!inRange(rate, 0, 20)) reasons.push('Enter a construction loan rate from 0% to 20%.');
    // The loan's months run from closing to payoff at conversion; the build is
    // those months less the months from completion to conversion.
    var loanMonths = whole(fields, 'dc-constr-months', 1, 60, 'construction loan months', reasons);
    var convert = whole(fields, 'dc-draw-convert-months', 0, 36, 'months from completion to conversion', reasons);
    var months = known(loanMonths) && known(convert) ? loanMonths - convert : null;
    if (known(loanMonths) && known(convert) && months < 1) reasons.push('Months from completion to conversion must be fewer than the construction loan months.');
    var curve = fields['dc-draw-curve'] || 'scurve';
    if (!CURVES[curve]) reasons.push('Choose a draw curve.');
    var retainage = pct(fields, 'dc-draw-retainage', 0, 15, 'retainage', reasons);
    var feeClosing = pct(fields, 'dc-draw-fee-closing', 0, 100, 'the share of the paid developer fee at closing', reasons);
    var softClosing = pct(fields, 'dc-draw-soft-closing', 0, 100, 'the share of soft costs paid at closing', reasons);
    var softTiming = fields['dc-draw-soft-sources'] || 'closing';
    if (softTiming !== 'closing' && softTiming !== 'conversion') reasons.push('Choose when the soft loans and grants fund.');
    if (summary.reason) reasons.push(summary.reason);
    else if (!summary.groups) reasons.push('Itemize development costs to time the draws.');
    else if (known(summary.notItemized) && summary.notItemized > 0.5) reasons.push('Itemize the remaining $' + Math.round(summary.notItemized).toLocaleString('en-US') + ' of Total Development Cost to time every draw.');
    var payIn = cb.payIn || {};
    var equityParts = [['Federal credit equity', payIn.federal], ['State credit equity', payIn.state], ['Added credit equity', payIn.added]]
      .filter(function (p) { return p[1]; });
    equityParts.forEach(function (p) {
      if (!p[1].installments) reasons.push(p[0] + ': ' + (p[1].reason === 'Pay-in schedule not entered.' ? 'enter the pay-in schedule (closing, completion, stabilization).' : p[1].reason));
    });
    if (!known(result.mortgage)) reasons.push('The permanent loan is not available, so conversion cannot be tested.');
    if (!known(result.deferredDevFee)) reasons.push('The deferred developer fee is not available.');
    if (known(result.fundingGap) && result.fundingGap > 0.5) reasons.push('Sources fall $' + Math.round(result.fundingGap).toLocaleString('en-US') + ' short of uses; close the gap before timing the draws.');
    if (reasons.length) { out.reason = reasons[0]; out.reasons = reasons; return out; }

    var by = summary.byId || {}, groups = summary.groups;
    var hard = sum(HARD_GROUPS.map(function (g) { return groups[g] || 0; }));
    var interestBudget = by.construction_interest || 0;
    var spread = sum(SPREAD_GROUPS.map(function (g) { return groups[g] || 0; })) - interestBudget;
    var atConversion = sum(CONVERSION_GROUPS.map(function (g) { return groups[g] || 0; }));
    var acquisition = groups.acquisition || 0;
    var cashFee = Math.max(0, (groups.fees || 0) - result.deferredDevFee);
    var last = months + convert;
    var rows = [];
    for (var m = 0; m <= last; m++) rows.push({ month: m, phase: m === 0 ? 'closing' : m < months ? 'construction' : m === months ? 'completion' : m < last ? 'lease-up' : 'conversion',
      hard: 0, retainageHeld: 0, retainageReleased: 0, soft: 0, acquisition: 0, fee: 0, conversionCosts: 0, interest: 0,
      equity: 0, softSources: 0, permanent: 0, loanDraw: 0, loanRepaid: 0, balance: 0, cash: 0 });
    if (months + convert === 0) rows[0].phase = 'conversion';
    rows[0].acquisition = acquisition;
    rows[0].soft = spread * softClosing;
    rows[0].fee = cashFee * feeClosing;
    var heldTotal = 0;
    for (var k = 1; k <= months; k++) {
      var draw = hard * (curveShare(curve, k / months) - curveShare(curve, (k - 1) / months));
      rows[k].hard = draw * (1 - retainage);
      rows[k].retainageHeld = draw * retainage;
      heldTotal += draw * retainage;
      rows[k].soft = spread * (1 - softClosing) / months;
    }
    rows[months].retainageReleased = heldTotal;
    rows[last].fee += cashFee * (1 - feeClosing);
    rows[last].conversionCosts = atConversion;
    // Equity installments at closing, completion and stabilization (conversion).
    var stageMonth = { closing: 0, completion: months, stabilization: last };
    equityParts.forEach(function (p) {
      p[1].installments.forEach(function (inst) { rows[stageMonth[inst.stage]].equity += inst.amount; });
    });
    var softTotal = (known(result.totalGrant) ? result.totalGrant : 0) + (known(result.totalLoanPrincipal) ? result.totalLoanPrincipal : 0);
    rows[softTiming === 'closing' ? 0 : last].softSources = softTotal;
    rows[last].permanent = result.mortgage;
    var balance = 0, cash = 0, peak = 0, peakMonth = 0, interestTotal = 0, monthly = rate / 100 / 12;
    rows.forEach(function (row) {
      row.interest = row.month === 0 ? 0 : balance * monthly;
      interestTotal += row.interest;
      var uses = row.acquisition + row.hard + row.retainageReleased + row.soft + row.fee + row.conversionCosts + row.interest;
      cash += row.equity + row.softSources + row.permanent;
      if (cash >= uses) cash -= uses;
      else { row.loanDraw = uses - cash; balance += row.loanDraw; cash = 0; }
      // Cash in hand beyond this month's bills pays the loan down (equity first, loan last).
      var repay = Math.min(balance, cash);
      row.loanRepaid = repay; balance -= repay; cash -= repay;
      row.balance = balance; row.cash = cash;
      var high = balance + repay; // the balance before any paydown this month
      if (high > peak) { peak = high; peakMonth = row.month; }
    });
    out.rows = rows; out.curve = curve; out.curveLabel = CURVES[curve]; out.months = months; out.convertMonths = convert;
    out.loan = loan; out.ratePct = rate; out.totalInterest = interestTotal; out.interestBudget = interestBudget;
    out.interestVsBudget = interestBudget - interestTotal;
    out.simpleEstimate = cb.constructionInterest && known(cb.constructionInterest.estimate) ? cb.constructionInterest.estimate : null;
    out.peakBalance = peak; out.peakMonth = peakMonth; out.loanEnough = peak <= loan + 0.5; out.retainageHeld = heldTotal;
    var usesTotal = sum(rows.map(function (r) { return r.acquisition + r.hard + r.retainageReleased + r.soft + r.fee + r.conversionCosts + r.interest; }));
    var sourcesTotal = sum(rows.map(function (r) { return r.equity + r.softSources + r.permanent; }));
    out.totalUses = usesTotal; out.totalSources = sourcesTotal;
    // Uses at cost plus interest less the budget line, against the cash sources: they tie to the cent.
    var expectedUses = result.tdc - result.deferredDevFee - interestBudget + interestTotal;
    out.tie = { uses: usesTotal, expectedUses: expectedUses, ties: Math.abs(usesTotal - expectedUses) < 0.01 };
    var conv = rows[last];
    out.conversion = { month: last, balanceBefore: conv.balance + conv.loanRepaid, permanent: conv.permanent,
      equityAtConversion: conv.equity, paidOff: balance <= 0.5, shortfall: balance > 0.5 ? balance : 0, surplus: cash,
      note: balance > 0.5 ? 'At conversion the permanent loan and the last equity leave $' + Math.round(balance).toLocaleString('en-US')
        + ' of the construction loan unpaid: more construction interest than the budget carried, or equity that comes in later than the loan must be repaid.'
        : cash > 0.5 ? 'Sources at conversion repay the construction loan with $' + Math.round(cash).toLocaleString('en-US') + ' left, which could pay more of the deferred fee.'
          : 'Sources at conversion repay the construction loan exactly.' };
    if (!out.loanEnough) out.notes.push('The loan needed peaks at $' + Math.round(peak).toLocaleString('en-US') + ' in month ' + peakMonth + ', above the $' + Math.round(loan).toLocaleString('en-US') + ' construction loan entered.');
    if (out.interestVsBudget < -0.5) out.notes.push('Interest on this schedule is $' + Math.round(-out.interestVsBudget).toLocaleString('en-US') + ' more than the Construction interest line.');
    return out;
  }

  /** What happens to conversion when the permanent rate moves, operating income
   * comes in lower, or fewer credits are delivered than were priced. */
  function conversionTest(result, fields, draw, rerun) {
    var out = { cases: null, dscrAtConversion: null, requiredDscr: null, reason: null };
    if (draw.reason) { out.reason = draw.reason; return out; }
    var reasons = [];
    var bp = num(fields['dc-conv-rate-bp']), noiCut = num(fields['dc-conv-noi-cut']), delivered = num(fields['dc-conv-credit-delivered']);
    if (!inRange(bp, 0, 300)) reasons.push('Enter the permanent rate change at conversion from 0 to 300 basis points.');
    if (!inRange(noiCut, 0, 30)) reasons.push('Enter how far operating income could come in below plan, from 0% to 30%.');
    if (!inRange(delivered, 50, 100)) reasons.push('Enter the share of priced credits delivered, from 50% to 100%.');
    if (reasons.length) { out.reason = reasons[0]; return out; }
    out.dscrAtConversion = result.baseDSCR; out.requiredDscr = result.dcr;
    var sized = result.seniorMode === 'sized';
    var base = draw.conversion.shortfall - draw.conversion.surplus; // positive: money short
    var equity = sum((['federal', 'state', 'added']).map(function (k) { var p = (result.costBasis.payIn || {})[k]; return p && known(p.total) ? p.total : 0; }));
    function permAfterRate() {
      if (!bp || !sized) return result.mortgage;
      var f = Object.assign({}, fields, { 'dc-rate': String(num(fields['dc-rate']) + bp / 100) });
      var r = rerun(f);
      return r && known(r.mortgage) ? r.mortgage : null;
    }
    var permRate = permAfterRate();
    // A sized loan moves in step with operating income; an entered loan does not resize.
    // The engine sizes principal from max(0, NOI / DCR - soft debt service) / loan constant,
    // so the soft payments stay fixed while income falls. Recover the constant from a
    // sized amount and size again on the lower income.
    var soft = known(result.totalSoftDebtService) ? result.totalSoftDebtService : 0;
    var room = known(result.noi) && known(result.dcr) ? result.noi / result.dcr - soft : null;
    function resize(perm) {
      if (!sized) return result.mortgage;
      if (!known(perm) || !known(room)) return null;
      if (perm <= 0 || room <= 0) return 0;
      return Math.max(0, result.noi * (1 - noiCut / 100) / result.dcr - soft) / (room / perm);
    }
    var permNoi = resize(result.mortgage);
    var adjuster = equity * (1 - delivered / 100);
    function row(label, perm, adj, explain) {
      if (!known(perm)) return { label: label, permanent: null, loanChange: null, equityAdjuster: adj, netShort: null, reason: 'The permanent loan could not be resized for this case.', explain: explain };
      var change = perm - result.mortgage;
      var net = base - change + adj;
      return { label: label, permanent: perm, loanChange: change, equityAdjuster: adj, netShort: net > 0.5 ? net : 0, netSpare: net < -0.5 ? -net : 0, explain: explain };
    }
    var permBoth = known(permRate) ? resize(permRate) : null;
    out.cases = [
      row('As planned', result.mortgage, 0, 'The schedule above.'),
      row('Rate up ' + bp + ' basis points', permRate, 0, sized ? 'The lender sizes a smaller loan at the higher rate.' : 'An entered loan amount does not resize; the payment rises instead.'),
      row('Income ' + noiCut + '% below plan', permNoi, 0, sized ? 'A loan sized on coverage shrinks as income falls; soft loan payments stay the same.' : 'An entered loan amount does not resize; coverage falls instead.'),
      row(delivered + '% of credits delivered', result.mortgage, adjuster, 'The investor pays less equity at stabilization (a downward adjuster).'),
      row('All three together', permBoth, adjuster, 'The rate, income and credit cases at once.')
    ];
    return out;
  }

  // "3:120000; 12:450000" -> [{ year, amount }], or a reason.
  function parseCapitalNeeds(text) {
    if (text === undefined || text === null || String(text).trim() === '') return { items: [], reason: null };
    var items = [], bad = null;
    String(text).split(/[;\n]+/).forEach(function (part) {
      if (!part.trim()) return;
      var m = part.match(/^\s*(?:year\s*)?(\d{1,2})\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)\s*$/i);
      if (!m || +m[1] < 1 || +m[1] > 50) { bad = bad || part.trim(); return; }
      items.push({ year: +m[1], amount: +m[2].replace(/,/g, '') });
    });
    return bad ? { items: null, reason: 'Write each capital need as year:amount, such as 12:450000; "' + bad + '" could not be read.' } : { items: items, reason: null };
  }

  /** The line-by-line 15-year budget. Year 1 equals the engine's year 1 exactly;
   * later years grow each line at its own rate. The management fee, when entered
   * as a share of income, follows income instead of expense growth. */
  function lineBudget(result, fields, change) {
    var out = { years: null, rows: null, growth: null, lowestDscr: null, lowestYear: null, firstBelowMinimum: null,
      firstBelowOne: null, lowestCushion: null, reason: null, notes: [] };
    var proj = result.projection;
    if (!proj || !proj.rows) { out.reason = (result.unavailable && result.unavailable.projection) || 'The operating projection is not available.'; return out; }
    var reasons = [];
    var g = {
      rent: result.exit.rentGrowth, other: result.exit.rentGrowth, opex: result.exit.expGrowth,
      tax: num(fields['dc-pf-tax-growth']), reserve: num(fields['dc-pf-reserve-growth'])
    };
    g.tax = g.tax === null ? result.exit.expGrowth : inRange(g.tax, 0, 10) ? g.tax / 100 : (reasons.push('Enter property tax growth from 0% to 10%.'), null);
    g.reserve = g.reserve === null ? result.exit.expGrowth : inRange(g.reserve, 0, 10) ? g.reserve / 100 : (reasons.push('Enter reserve growth from 0% to 10%.'), null);
    var mgmtPct = num(fields['dc-pf-mgmt-pct']);
    if (mgmtPct !== null && !inRange(mgmtPct, 0, 15)) reasons.push('Enter the management fee from 0% to 15% of collected income.');
    var units = result.units;
    if (!known(units) || units <= 0) reasons.push('Enter the number of homes.');
    if (reasons.length) { out.reason = reasons[0]; return out; }
    // A stress case changes rent growth, expense growth (every cost line moves by
    // the same points) or vacancy, and always runs 15 years.
    var expDelta = 0, vac = result.vacancyRate;
    if (change) {
      expDelta = change.exp - g.opex; g.rent = change.rent; g.other = change.rent;
      g.opex += expDelta; g.tax += expDelta; g.reserve += expDelta; vac = change.vac;
    }
    var y1 = proj.rows[0];
    var mgmt1 = mgmtPct === null ? null : y1.egi * mgmtPct / 100;
    if (mgmt1 !== null && mgmt1 > y1.opex + 0.5) { out.reason = 'A ' + mgmtPct + '% management fee is more than the whole operating budget; lower it or raise the operating cost.'; return out; }
    var dsSeries = result.obligations && result.obligations.years;
    var years = change ? Math.min(15, dsSeries ? dsSeries.length : 0) : proj.years, minDscr = 1.15;
    var unchanged = !change || (change.rent === result.exit.rentGrowth && expDelta === 0 && change.vac === result.vacancyRate);
    var rows = [];
    for (var y = 1; y <= years; y++) {
      var step = y - 1, ob = dsSeries ? dsSeries[y - 1] : null;
      var rents = result.annualRents * Math.pow(1 + g.rent, step);
      var other = (known(result.annualOtherIncome) ? result.annualOtherIncome : 0) * Math.pow(1 + g.other, step);
      var vacancy = (rents + other) * vac, egi = rents + other - vacancy;
      var mgmt = mgmt1 === null ? null : egi * mgmtPct / 100;
      var otherOpex = (mgmt1 === null ? result.annualOpex : result.annualOpex - mgmt1) * Math.pow(1 + g.opex, step);
      var tax = result.netPropTax * Math.pow(1 + g.tax, step), reserve = result.annualRepReserve * Math.pow(1 + g.reserve, step);
      var noi = y === 1 && unchanged ? result.noi : egi - (mgmt || 0) - otherOpex - tax - reserve;
      var ds = ob ? ob.mustPayDebtService : null, row = ob;
      var dscr = known(ds) && ds > 0 ? noi / ds : null;
      // Rent cushion: how far rent per home a month can fall before coverage drops to 1.15x, and to 1.00x.
      var perHomeMonth = function (target) { return known(ds) && ds > 0 ? (noi - target * ds) / (units * 12 * (1 - vac) * (1 - (mgmtPct || 0) / 100)) : null; };
      var gross = rents + other, breakEvenVac = known(ds) && gross > 0 ? Math.min(1, Math.max(0, 1 - ((mgmt || 0) + otherOpex + tax + reserve + ds) / gross)) : null;
      if (mgmt !== null) breakEvenVac = known(ds) && gross > 0 ? Math.min(1, Math.max(0, (gross * (1 - mgmtPct / 100) - otherOpex - tax - reserve - ds) / (gross * (1 - mgmtPct / 100)))) : null;
      rows.push({ year: y, grossRents: rents, otherIncome: other, vacancyLoss: vacancy, egi: egi, managementFee: mgmt,
        otherOpex: otherOpex, propTax: tax, repReserve: reserve, noi: noi, debtService: ds, cashFlow: known(ds) ? noi - ds : null,
        dscr: dscr, cushionTo115: perHomeMonth(minDscr), cushionTo100: perHomeMonth(1), breakEvenVacancy: breakEvenVac,
        unavailableReason: row ? row.unavailableReason : null });
    }
    out.years = years; out.rows = rows; out.growth = g; out.managementPct = mgmtPct;
    var tested = rows.slice(0, 15).filter(function (r) { return known(r.dscr); });
    if (tested.length) {
      var low = tested.reduce(function (a, b) { return b.dscr < a.dscr ? b : a; });
      out.lowestDscr = low.dscr; out.lowestYear = low.year;
      var below = tested.filter(function (r) { return r.dscr < minDscr - 0.00005; })[0];
      out.firstBelowMinimum = below ? below.year : null;
      var under = tested.filter(function (r) { return r.dscr < 1 - 0.00005; })[0];
      out.firstBelowOne = under ? under.year : null;
      out.lowestCushion = Math.min.apply(null, tested.map(function (r) { return r.cushionTo115; }));
    }
    if (mgmt1 === null) out.notes.push('Management fee not split out, so it grows with the other operating costs.');
    if (years < 15) out.notes.push('The projection runs ' + years + ' years; CHFA tests coverage over 15.');
    return out;
  }

  /** Each stress case changes one input over 15 years with the closed loan held,
   * so the coverage shows the year it would first fall below CHFA's 1.15x. */
  function fifteenYearStress(result, fields) {
    var out = { cases: null, reason: null };
    if (!result.projection) { out.reason = (result.unavailable && result.unavailable.projection) || 'The operating projection is not available.'; return out; }
    var rg = num(fields['pf-rent-growth']), eg = num(fields['pf-exp-growth']), vac = num(fields['dc-vacancy']);
    function lowest(r) {
      if (!r || !r.coverage || !r.coverage.years) return { lowest: null, year: null, firstBelow: null, reason: 'Coverage is not available for this case.' };
      var ys = r.coverage.years.slice(0, 15).filter(function (y) { return known(y.allMustPayCoverage); });
      if (!ys.length) return { lowest: null, year: null, firstBelow: null, reason: 'Coverage is not available for this case.' };
      var low = ys.reduce(function (a, b) { return b.allMustPayCoverage < a.allMustPayCoverage ? b : a; });
      var below = ys.filter(function (y) { return y.allMustPayCoverage < 1.15 - 0.00005; })[0];
      return { lowest: low.allMustPayCoverage, year: low.year, firstBelow: below ? below.year : null, reason: null };
    }
    // The permanent loan is already closed, so each case holds it, and its must-pay
    // payments, at the planned amounts; only income and costs change. Each case is
    // the line-by-line budget above (management fee, tax and reserve growth as
    // entered) with one input changed, over 15 years.
    function run(label, change, explain) {
      var b = lineBudget(result, fields, change);
      if (b.reason) return { label: label, explain: explain, lowestDscr: null, lowestYear: null, firstBelowMinimum: null, reason: b.reason };
      var l = lowest({ coverage: { years: b.rows.map(function (r) { return { year: r.year, allMustPayCoverage: r.dscr }; }) } });
      return { label: label, explain: explain, lowestDscr: l.lowest, lowestYear: l.year, firstBelowMinimum: l.firstBelow, reason: l.reason };
    }
    var g0 = result.exit.rentGrowth, e0 = result.exit.expGrowth, v0 = result.vacancyRate;
    var cases = [run('As planned', { rent: g0, exp: e0, vac: v0 }, 'The growth rates, vacancy and budget lines entered.')];
    if (known(rg) && known(eg)) {
      var rgLow = Math.max(-3, rg - 1), egHigh = Math.min(6, eg + 1);
      cases.push(run('Rents grow 1 point slower', { rent: rgLow / 100, exp: e0, vac: v0 }, 'Rent growth ' + rgLow + '% a year.'));
      cases.push(run('Costs grow 1 point faster', { rent: g0, exp: egHigh / 100, vac: v0 }, 'Expense growth ' + egHigh + '% a year.'));
      cases.push(run('Flat rents, costs 1 point above 3%', { rent: 0, exp: 0.04, vac: v0 }, 'No rent increases for 15 years while operating costs rise 4% a year and taxes and reserves 1 point faster than entered.'));
    }
    if (!result.scheduleMode && known(vac)) cases.push(run('Vacancy 3 points higher', { rent: g0, exp: e0, vac: Math.min(30, vac + 3) / 100 }, 'Vacancy ' + Math.min(30, vac + 3) + '% every year.'));
    else cases.push({ label: 'Vacancy 3 points higher', explain: 'Vacancy comes from the rent schedule here, so the case is not run.', lowestDscr: null, lowestYear: null, firstBelowMinimum: null, reason: 'Vacancy is set by the unit schedule.' });
    out.cases = cases;
    return out;
  }

  /** The replacement reserve account (deposits, interest, capital needs) and the
   * operating reserve covering any year the property runs short. */
  function reserveAccounts(result, fields, budget) {
    var out = { replacement: null, operating: null, reason: null };
    var proj = result.projection;
    if (!proj || !proj.rows) { out.reason = (result.unavailable && result.unavailable.projection) || 'The operating projection is not available.'; return out; }
    var by = (result.costBasis && result.costBasis.summary && result.costBasis.summary.byId) || {};
    var yieldPct = num(fields['dc-pf-reserve-yield']);
    var needs = parseCapitalNeeds(fields['dc-pf-capital-needs']);
    var units = result.units;
    var rep = { start: by.replacement_reserve || 0, yieldPct: null, rows: null, firstShort: null, lowestPerHome: null, reason: null };
    if (yieldPct !== null && !inRange(yieldPct, 0, 8)) rep.reason = 'Enter the reserve account interest from 0% to 8%.';
    else if (needs.reason) rep.reason = needs.reason;
    else {
      rep.yieldPct = yieldPct === null ? 0 : yieldPct;
      var bal = rep.start, rows = [];
      // Deposits follow the line-by-line budget, so a reserve growth entered there carries here.
      var deposits = budget && budget.rows ? budget.rows : proj.rows.slice(0, proj.years);
      deposits.forEach(function (r) {
        var interest = Math.max(0, bal) * rep.yieldPct / 100;
        var spend = sum(needs.items.filter(function (n) { return n.year === r.year; }).map(function (n) { return n.amount; }));
        bal = bal + r.repReserve + interest - spend;
        rows.push({ year: r.year, deposit: r.repReserve, interest: interest, capitalNeeds: spend, balance: bal, perHome: known(units) && units > 0 ? bal / units : null });
        if (bal < -0.5 && rep.firstShort === null) rep.firstShort = r.year;
      });
      rep.rows = rows;
      rep.lowestPerHome = known(units) && units > 0 ? Math.min.apply(null, rows.map(function (r) { return r.perHome; })) : null;
      if (!needs.items.length) rep.note = 'No capital needs entered. A capital needs assessment usually shows roofs, boilers and paving within 15 years.';
    }
    var op = { start: by.reserves || 0, rows: null, firstShort: null, totalDrawn: 0, reason: null };
    var obal = op.start, orows = [];
    proj.rows.slice(0, proj.years).forEach(function (r, i) {
      // The engine's shortfall, moved by any difference between the budget's NOI and the engine's.
      var b = budget && budget.rows ? budget.rows[i] : null;
      var shift = b && known(b.noi) && known(r.noi) ? b.noi - r.noi : 0;
      var draw = !known(r.deficitFunded) ? null : r.deficitFunded > 0 ? Math.max(0, r.deficitFunded - shift)
        : known(r.cashFlow) ? Math.max(0, -(r.cashFlow + (r.mustPayUnpaid || 0) + shift)) : null;
      if (draw === null) { op.reason = op.reason || 'A year of the projection is not measured, so the operating reserve is not followed.'; return; }
      obal -= draw; op.totalDrawn += draw;
      orows.push({ year: r.year, draw: draw, balance: obal });
      if (obal < -0.5 && op.firstShort === null) op.firstShort = r.year;
    });
    if (!op.reason) op.rows = orows;
    out.replacement = rep; out.operating = op;
    return out;
  }

  /** What each soft loan owes year by year, so the exit can see it. */
  function softLoanBalances(result) {
    var loans = result.obligations && result.obligations.loans;
    if (!loans) return { loans: null, reason: 'Loan schedules are not available.' };
    var years = result.projection ? result.projection.years : 15;
    return { loans: loans.filter(function (l) { return !l.senior; }).map(function (l) {
      return { id: l.id, program: l.program, type: l.type, amount: l.amount, rate: l.rate,
        rows: (l.rows || []).slice(0, years).map(function (r) { return { year: r.year, paid: r.paid, accrued: r.accrued, balance: r.balance }; }) };
    }), reason: null };
  }

  function loanConstant(ratePct, years) {
    var r = ratePct / 100;
    return r === 0 ? 1 / years : r / (1 - Math.pow(1 + r, -years));
  }

  /** After year 15: the value at a range of cap rates, the minimum purchase price
   * under 26 U.S.C. 42(i)(7)(B), a refinance, a resyndication and holding on. */
  function exitPaths(result, fields, rules) {
    var out = { holdYear: null, capRange: null, minimumPrice: null, refinance: null, resyndication: null, hold: null, reason: null };
    var ex = result.exit || {};
    if (!known(ex.nNoi)) { out.reason = (result.unavailable && result.unavailable['exit.nNoi']) || 'Exit-year income is not available.'; return out; }
    var hold = ex.holdYears, units = result.units;
    var debt = known(ex.firstMortBal) && known(ex.softBal) ? ex.firstMortBal + ex.softBal : null;
    out.holdYear = hold;
    var cap = ex.exitCap;
    out.capRange = known(cap) ? [-0.01, -0.005, 0, 0.005, 0.01].map(function (d) {
      var c = cap + d;
      if (c <= 0) return { cap: c, value: null, afterDebt: null, perHome: null, reason: 'A cap rate must be above 0%.' };
      var v = ex.nNoi / c;
      return { cap: c, value: v, afterDebt: known(debt) ? v - debt : null, perHome: known(units) && units > 0 ? v / units : null, reason: known(debt) ? null : 'Loan balances at the exit are not available.' };
    }) : null;
    var exitTaxes = num(fields['dc-after-taxes']);
    out.minimumPrice = {
      debt: debt, exitTaxes: exitTaxes === null || !Number.isFinite(exitTaxes) ? null : exitTaxes,
      price: known(debt) && known(exitTaxes) ? debt + exitTaxes : null,
      marketValue: known(ex.resale) ? ex.resale : null,
      citation: '26 U.S.C. 42(i)(7)(B): outstanding debt secured by the building (other than debt incurred within 5 years of the sale) plus the taxes attributable to the sale.',
      reason: !known(debt) ? 'Loan balances at the exit are not available.' : exitTaxes === null ? 'Enter the exit taxes the investor expects to complete the minimum price; the member tools can estimate them.' : !Number.isFinite(exitTaxes) || exitTaxes < 0 ? 'Enter exit taxes of $0 or more.' : null
    };
    var rRate = num(fields['dc-after-refi-rate']), rTerm = num(fields['dc-after-refi-term']), rDcr = num(fields['dc-after-refi-dcr']), rCost = num(fields['dc-after-refi-cost']);
    var refiReason = !inRange(rRate, 0, 15) ? 'Enter the refinance rate from 0% to 15%.' : !(Number.isInteger(rTerm) && rTerm >= 5 && rTerm <= 40) ? 'Enter the refinance amortization from 5 to 40 years.'
      : !inRange(rDcr, 1, 2) ? 'Enter the refinance coverage from 1.00 to 2.00.' : !inRange(rCost, 0, 10) ? 'Enter refinance costs from 0% to 10% of the new loan.' : !known(debt) ? 'Loan balances at the exit are not available.' : null;
    if (refiReason) out.refinance = { reason: refiReason };
    else {
      var newLoan = ex.nNoi / (rDcr * loanConstant(rRate, rTerm));
      var costs = newLoan * rCost / 100;
      out.refinance = { newLoan: newLoan, payoff: debt, costs: costs, cashOut: newLoan - debt - costs, annualPayment: newLoan * loanConstant(rRate, rTerm), reason: null,
        note: 'Sized on exit-year income at ' + rDcr.toFixed(2) + 'x. Soft loans counted as repaid; a lender may let some stay subordinate.' };
    }
    var acqRule = rules && rules.rules && rules.rules.acquisition_credit_rate;
    var landPct = num(fields['dc-after-land-pct']), rehab = num(fields['dc-after-rehab-per-home']), rPrice = num(fields['dc-after-resyn-price']), rehabRate = num(fields['dc-after-rehab-rate']);
    var resynReason = !acqRule || acqRule.status !== 'adopted' ? 'The acquisition credit rule is not loaded.' : !inRange(landPct, 0, 60) ? 'Enter the land share of the price from 0% to 60%.'
      : !(known(rehab) && rehab >= 0 && rehab <= 400000) ? 'Enter rehabilitation per home from $0 to $400,000.' : !inRange(rPrice, 0.5, 1.2) ? 'Enter the credit price from $0.50 to $1.20.'
        : !inRange(rehabRate, 3, 10) ? 'Enter the rehabilitation credit rate from 3% to 10%.' : !known(ex.resale) ? 'The exit value is not available.' : !known(units) || units <= 0 ? 'Enter the number of homes.' : null;
    if (resynReason) out.resyndication = { reason: resynReason };
    else {
      var acqBasis = ex.resale * (1 - landPct / 100), rehabBasis = rehab * units;
      var acqCredit = acqBasis * acqRule.floor, rehabCredit = rehabBasis * rehabRate / 100;
      var equity = (acqCredit + rehabCredit) * 10 * rPrice;
      out.resyndication = { purchasePrice: ex.resale, acquisitionBasis: acqBasis, rehabBasis: rehabBasis, acquisitionRate: acqRule.floor,
        annualCredit: acqCredit + rehabCredit, equity: equity, sellerDebtPaid: debt, equityLessRehab: equity - rehabBasis, reason: null,
        citation: 'CHFA QAP ' + acqRule.location + ': ' + acqRule.quote,
        note: 'A screen: assumes every home qualifies, credit at the acquisition floor, and the 10-year credit period of 26 U.S.C. 42(f)(1). A new compliance period and a new extended use agreement follow.' };
    }
    var proj = result.projection;
    if (!proj || proj.rows.length < 30) out.hold = { reason: 'The projection does not run to year 30.' };
    else {
      var after = proj.rows.slice(hold, 30);
      var cash = after.map(function (r) { return r.cashFlow; });
      out.hold = { fromYear: hold + 1, toYear: 30, cumulativeCashFlow: cash.every(known) ? sum(cash) : null,
        lowestDscr: Math.min.apply(null, after.map(function (r) { return known(r.dscr) ? r.dscr : Infinity; })),
        reason: cash.every(known) ? null : 'A year after the hold is not measured.' };
      if (out.hold.lowestDscr === Infinity) out.hold.lowestDscr = null;
    }
    return out;
  }

  function compute(args) {
    var result = args.result, fields = args.fields || {}, rerun = args.rerun || function () { return null; };
    var draw = constructionDraw(result, fields);
    var budget = lineBudget(result, fields);
    return {
      draw: draw,
      conversion: conversionTest(result, fields, draw, rerun),
      budget: budget,
      stress: fifteenYearStress(result, fields),
      reserves: reserveAccounts(result, fields, budget.reason ? null : budget),
      softLoans: softLoanBalances(result),
      exit: exitPaths(result, fields, args.rules)
    };
  }

  return { compute: compute, constructionDraw: constructionDraw, conversionTest: conversionTest, lineBudget: lineBudget,
    fifteenYearStress: fifteenYearStress, reserveAccounts: reserveAccounts, softLoanBalances: softLoanBalances,
    exitPaths: exitPaths, parseCapitalNeeds: parseCapitalNeeds, curveShare: curveShare, CURVES: CURVES };
}));
