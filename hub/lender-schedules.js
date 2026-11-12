// Lender schedules on Financials (wave 3L): the bond test and construction interest check, CHFA's minimum
// assumptions, the month-by-month construction draws and conversion, 15 years of coverage under stress, the reserve
// accounts and the exit paths after year 15. Every figure is the engine's own (result.costBasis and result.schedules,
// from the pinned js/deal-lender-schedules.js); this file only lays them out. A figure the engine cannot measure
// shows the engine's reason, never $0.
(function (global) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function known(v) { return typeof v === 'number' && isFinite(v); }
  function money(v) { return known(v) ? (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US') : '—'; }
  function pct(v, d) { return known(v) ? (v * 100).toFixed(d == null ? 1 : d) + '%' : '—'; }
  function x(v) { return known(v) ? v.toFixed(2) + 'x' : '—'; }

  function reason(t) { return '<p class="note ls-reason">' + esc(t) + '</p>'; }
  function note(t, warn) { return t ? '<p class="note' + (warn ? ' ls-warn' : '') + '">' + esc(t) + '</p>' : ''; }
  // Label and figure pairs; a third value marks the figure good or bad.
  function dl(pairs) {
    return '<dl class="ls-dl">' + pairs.map(function (p) {
      return '<div' + (p[2] ? ' class="is-' + p[2] + '"' : '') + '><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }
  function cards(items) {
    return '<div class="ls-cards">' + items.map(function (it) {
      return '<div class="ls-card' + (it.state ? ' is-' + it.state : '') + '"><p class="ls-card-title">' +
        (it.state === 'ok' ? '<span aria-hidden="true">✓ </span>' : it.state === 'bad' ? '<span aria-hidden="true">✗ </span>' : '') + esc(it.title) +
        (it.state ? '<span class="visually-hidden">' + (it.state === 'ok' ? ' (passes)' : ' (fails)') + '</span>' : '') + '</p>' +
        (it.pairs || []).map(function (p) { return '<p class="ls-pair"><span>' + esc(p[0]) + '</span><strong>' + esc(p[1]) + '</strong></p>'; }).join('') +
        (it.note ? '<p class="ls-card-note">' + esc(it.note) + '</p>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function table(label, head, rows) {
    return '<div class="table-scroll" role="region" aria-label="' + esc(label) + '" tabindex="0"><table class="ls-table"><thead><tr>' +
      head.map(function (h, i) { return '<th scope="col"' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return i ? '<td class="num">' + esc(c) + '</td>' : '<th scope="row">' + esc(c) + '</th>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function more(summary, inner) { return '<details class="ls-more"><summary>' + esc(summary) + '</summary>' + inner + '</details>'; }
  function sub(title) { return '<h4 class="ls-sub">' + esc(title) + '</h4>'; }

  // Construction loan balance by month: grey while building, green through lease-up and conversion, with the loan
  // entered as a dashed line, so the peak and the payoff read at a glance.
  function balanceChart(d) {
    var w = 320, h = 96, n = d.rows.length, max = Math.max(d.peakBalance, d.loan, 1), bw = w / n;
    var bars = d.rows.map(function (r, i) {
      var high = r.balance + r.loanRepaid, bh = Math.max(0, high / max * (h - 12));
      return '<rect x="' + (i * bw + 0.5).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1" class="' + (r.month >= d.months ? 'ls-bar-conv' : 'ls-bar-build') + '"><title>Month ' + r.month + ': ' + money(high) + '</title></rect>';
    }).join('');
    var ly = (h - d.loan / max * (h - 12)).toFixed(1);
    return '<figure class="ls-chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Construction loan balance by month, peaking at ' + esc(money(d.peakBalance)) + ' in month ' + d.peakMonth + '">' +
      bars + '<line x1="0" x2="' + w + '" y1="' + ly + '" y2="' + ly + '" class="ls-loan-line"/></svg>' +
      '<figcaption><span class="ls-key ls-bar-build"></span>Building <span class="ls-key ls-bar-conv"></span>Lease-up and conversion <span class="ls-key ls-key-line"></span>Loan entered</figcaption></figure>';
  }

  function bondAndInterest(r) {
    var cb = r.costBasis || {}, bt = cb.bondTest, ci = cb.constructionInterest, out = [];
    if (bt && bt.applies) {
      if (bt.ratio == null || bt.passes == null) out.push({ title: 'Bond test', note: bt.reason });
      else out.push({ title: 'Bond test', state: bt.passes ? 'ok' : 'bad',
        pairs: [['Bonds / (basis + land)', pct(bt.ratio)], ['Test', Math.round(bt.threshold * 100) + '%'], ['Bonds needed', money(bt.minimumBonds)],
          [bt.basisCushion >= 0 ? 'Basis could grow' : 'Basis short', money(Math.abs(bt.basisCushion))]],
        note: [bt.flags.join(' '), bt.citation].filter(Boolean).join(' ') });
    } else if (bt) out.push({ title: 'Bond test', note: bt.reason });
    if (ci) out.push(ci.passes == null ? { title: 'Construction interest budget', note: ci.reason }
      : { title: 'Construction interest budget', state: ci.passes ? 'ok' : 'bad',
        pairs: [['Budget line', money(ci.budget)], ['Estimate', money(ci.estimate)]].concat(ci.passes ? [] : [['Short by', money(ci.shortfall)]]),
        note: 'Estimate: loan × rate × months × average share drawn. The draw schedule below replaces it.' });
    return out.length ? cards(out) : '';
  }

  function minimums(r) {
    var m = r.costBasis && r.costBasis.chfaMinimums;
    if (!m) return reason('The CHFA rules did not load, so the minimums are not checked.');
    if (m.reason) return reason(m.reason);
    var fmtVal = function (i, v) { return v == null ? '—' : /growth|Vacancy/.test(i.label) ? pct(v) : money(v); };
    var cite = m.items[0] && m.items[0].citation;
    return cards(m.items.map(function (i) {
      return { title: i.label, state: i.passes === true ? 'ok' : i.passes === false ? 'bad' : null,
        pairs: [['This deal', fmtVal(i, i.entered)], ['CHFA', (i.direction === 'at most' ? 'at most ' : 'at least ') + fmtVal(i, i.minimum)]],
        note: i.passes == null ? i.reason : null };
    })) + m.notes.map(function (n) { return note(n); }).join('') + (cite ? '<p class="metric-source">' + esc(cite.replace(/, Section.*$/, '')) + ', Section 4</p>' : '');
  }

  function draw(dr) {
    if (dr.reason) return reason(dr.reason) + (dr.reasons && dr.reasons.length > 1 ? note('Also needed: ' + dr.reasons.slice(1, 4).join(' ')) : '');
    var c = dr.conversion;
    return dl([
      ['Construction', dr.months + ' months, then ' + dr.convertMonths + ' to conversion'],
      ['Peak construction loan', money(dr.peakBalance) + ' in month ' + dr.peakMonth, dr.loanEnough ? null : 'bad'],
      ['Loan entered', money(dr.loan)],
      ['Interest on this schedule', money(dr.totalInterest)],
      ['Construction interest budget line', money(dr.interestBudget), dr.interestVsBudget < -0.5 ? 'bad' : null],
      ['Retainage held to completion', money(dr.retainageHeld)],
      ['At conversion', c.paidOff ? 'Loan repaid' : money(c.shortfall) + ' unpaid', c.paidOff ? 'ok' : 'bad']
    ]) + balanceChart(dr) + note(c.note, !c.paidOff) + dr.notes.map(function (n) { return note(n, true); }).join('') +
      note(dr.tie.ties ? 'Check: the schedule ties to total cost, less the deferred fee, with this interest in place of the budget line.' : 'Check failed: the schedule does not tie to total cost.', !dr.tie.ties) +
      more('Month-by-month draws (' + dr.rows.length + ' months)', table('Construction draws by month', ['Month', 'Stage', 'Costs paid', 'Interest', 'Equity in', 'Other sources in', 'Loan drawn', 'Loan repaid', 'Loan balance'],
        dr.rows.map(function (r) {
          return [String(r.month), r.phase, money(r.acquisition + r.hard + r.retainageReleased + r.soft + r.fee + r.conversionCosts), money(r.interest), money(r.equity),
            money(r.softSources + r.permanent), money(r.loanDraw), money(r.loanRepaid), money(r.balance)];
        })));
  }

  function conversion(cv) {
    if (cv.reason) return reason(cv.reason);
    return cards(cv.cases.map(function (c) {
      return { title: c.label, state: c.reason ? null : c.netShort ? 'bad' : 'ok', note: c.reason || c.explain,
        pairs: c.reason ? [] : [['Permanent loan', money(c.permanent)], ['Loan change', money(c.loanChange)], ['Equity adjuster', money(c.equityAdjuster)],
          ['At conversion', c.netShort ? money(c.netShort) + ' short' : c.netSpare ? money(c.netSpare) + ' spare' : 'Ties exactly']] };
    })) + note('Coverage at conversion ' + x(cv.dscrAtConversion) + ' against the ' + x(cv.requiredDscr) + ' the loan is sized on. A shortfall is usually closed with more deferred fee, a soft loan or a smaller loan.');
  }

  function budget(b, s) {
    var out = '';
    if (b.reason) out += reason(b.reason);
    else {
      out += (b.coverageReason ? reason(b.coverageReason) : dl([
        ['Lowest coverage, years 1–15', x(b.lowestDscr) + ' in year ' + b.lowestYear, b.firstBelowMinimum ? 'bad' : null],
        ['First year below 1.15x', b.firstBelowMinimum ? 'Year ' + b.firstBelowMinimum : 'None', b.firstBelowMinimum ? 'bad' : 'ok'],
        ['Rent cushion to 1.15x (lowest year)', known(b.lowestCushion) ? money(b.lowestCushion) + ' a home a month' : '—']
      ])) + note('The rent cushion is how far rent could fall, per home per month, before coverage drops to 1.15x.') +
        b.notes.map(function (n) { return note(n); }).join('') +
        more('Year-by-year budget (' + b.rows.length + ' years)', table('15-year operating budget', ['Year', 'Rents', 'Vacancy', 'Management', 'Other operating', 'Property tax', 'Reserve', 'NOI', 'Debt service', 'Coverage', 'Break-even vacancy'],
          b.rows.map(function (r) {
            return [String(r.year), money(r.grossRents + r.otherIncome), money(r.vacancyLoss), r.managementFee == null ? 'in operating' : money(r.managementFee), money(r.otherOpex),
              money(r.propTax), money(r.repReserve), money(r.noi), money(r.debtService), x(r.dscr), pct(r.breakEvenVacancy)];
          })));
    }
    if (s.reason) return out + reason(s.reason);
    return out + sub('Stress tests over 15 years') + cards(s.cases.map(function (c) {
      return { title: c.label, state: c.reason ? null : c.firstBelowMinimum ? 'bad' : 'ok', note: c.reason || c.explain,
        pairs: c.reason ? [] : [['Lowest coverage', x(c.lowestDscr) + ' in year ' + c.lowestYear], ['First year below 1.15x', c.firstBelowMinimum ? 'Year ' + c.firstBelowMinimum : 'None']] };
    })) + note('Each case runs the same engine again with one input changed; the permanent loan stays at the planned amount.');
  }

  function reserves(rs) {
    if (rs.reason) return reason(rs.reason);
    var rep = rs.replacement, op = rs.operating, out = '';
    if (rep.reason) out += reason(rep.reason);
    else {
      var last = rep.rows[rep.rows.length - 1];
      out += dl([['Replacement reserve at year ' + last.year, money(last.balance) + (known(last.perHome) ? ' (' + money(last.perHome) + ' a home)' : ''), last.balance < 0 ? 'bad' : null],
        ['First year the account runs out', rep.firstShort ? 'Year ' + rep.firstShort : 'None', rep.firstShort ? 'bad' : 'ok']]) +
        note(rep.note) + more('Replacement reserve by year', table('Replacement reserve by year', ['Year', 'Deposit', 'Interest', 'Capital needs', 'Balance'],
          rep.rows.map(function (r) { return [String(r.year), money(r.deposit), money(r.interest), money(r.capitalNeeds), money(r.balance)]; })));
    }
    if (op.reason) out += reason(op.reason);
    else out += dl([['Operating reserve drawn over ' + op.rows.length + ' years', money(op.totalDrawn)],
      ['Operating reserve left', money(op.rows[op.rows.length - 1].balance), op.firstShort ? 'bad' : null]]);
    return out;
  }

  function exitPaths(e) {
    if (e.reason) return reason(e.reason);
    var out = sub('Value at year ' + e.holdYear + ' across cap rates') + (e.valueReason ? reason(e.valueReason) : cards((e.capRange || []).map(function (c) {
      return { title: pct(c.cap, 2) + ' cap', note: c.reason, pairs: [['Value', money(c.value)], ['Per home', money(c.perHome)], ['After paying all debt', money(c.afterDebt)]] };
    })));
    var mp = e.minimumPrice, rf = e.refinance, rs = e.resyndication, hd = e.hold;
    out += sub('Nonprofit or tenant purchase at the minimum price') +
      (mp.reason ? reason(mp.reason) : dl([['Debt outstanding', money(mp.debt)], ['Exit taxes', money(mp.exitTaxes)], ['Minimum price', money(mp.price)], ['Market value at the planned cap', money(mp.marketValue)]])) +
      (mp.citation ? '<p class="metric-source">' + esc(mp.citation) + '</p>' : '');
    out += sub('Refinance and hold') + (rf.reason ? reason(rf.reason) : dl([['New loan', money(rf.newLoan)], ['Pays off', money(rf.payoff)], ['Costs', money(rf.costs)],
      ['Cash out', money(rf.cashOut), rf.cashOut < 0 ? 'bad' : 'ok'], ['New annual payment', money(rf.annualPayment)]]) + note(rf.note));
    out += sub('Resyndication with new credits') + (rs.reason ? reason(rs.reason) : dl([['Purchase price', money(rs.purchasePrice)], ['Acquisition basis (less land)', money(rs.acquisitionBasis)],
      ['Rehabilitation basis', money(rs.rehabBasis)], ['Annual credit', money(rs.annualCredit)], ['Credit equity', money(rs.equity)], ['Equity left after rehabilitation', money(rs.equityLessRehab)]]) +
      note(rs.note) + (rs.citation ? '<p class="metric-source">' + esc(rs.citation) + '</p>' : ''));
    out += sub('Keep owning it') + (hd.reason ? reason(hd.reason) : dl([['Cash flow, years ' + hd.fromYear + '–' + hd.toYear, money(hd.cumulativeCashFlow)], ['Lowest coverage in those years', x(hd.lowestDscr)]]));
    return out;
  }

  // One part: its inputs, then what the engine returned for them.
  function part(id, title, intro, inputs, body, open) {
    return '<details class="ls-part" id="' + id + '"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary>' +
      (intro ? '<p class="note">' + esc(intro) + '</p>' : '') + inputs + '<div class="ls-out" role="status" aria-live="polite">' + body + '</div></details>';
  }

  function render(d, r, fieldGrid) {
    var s = r.schedules;
    var h = '<section class="fin-section ls" aria-labelledby="fin-ls"><h2 id="fin-ls">Lender schedules: construction to year 30</h2>' +
      '<p class="note">What a construction lender, a permanent lender and CHFA check. Change any input and every figure redraws. Screening figures, not a lender’s or investor’s underwriting.</p>' +
      (global.LabLenderExport ? global.LabLenderExport.buttons() : '') + bondAndInterest(r);
    if (!s) return h + reason('The lender schedules did not run for these inputs.') + '</section>';
    return h +
      part('ls-min', 'CHFA minimum assumptions', 'CHFA’s Qualified Allocation Plan sets floors for the pro forma (Section 4.B and 4.C). Each card shows what this deal uses against the floor.', fieldGrid(d, 'ls-min'), minimums(r), true) +
      part('ls-draw', 'Construction draws and conversion', 'Uses the construction loan, rate and months entered under Loans and other sources. The loan funds only what equity and other sources in hand do not, and its interest is added to the loan each month.',
        fieldGrid(d, 'ls-draw'), draw(s.draw) + sub('What could go wrong at conversion') + fieldGrid(d, 'ls-conv') + conversion(s.conversion)) +
      part('ls-budget', '15-year operating budget and stress tests', 'Year 1 matches the operating budget above; each line then grows at its own rate. CHFA asks for 1.15x coverage on all amortizing debt in each of the 15 years.', fieldGrid(d, 'ls-budget'), budget(s.budget, s.stress)) +
      part('ls-reserves', 'Reserve accounts', 'The replacement reserve starts with the Replacement reserve cost line, takes the yearly deposits and pays the capital needs you list. The operating reserve covers any year income falls short of the must-pay loan and bridge payments.', fieldGrid(d, 'ls-reserves'), reserves(s.reserves)) +
      part('ls-exit', 'After year 15: exit paths', 'Uses the exit year and cap rate under Exit and projection. Each path is a screen to compare options, not an offer or an appraisal.', fieldGrid(d, 'ls-exit'), exitPaths(s.exit)) +
      '</section>';
  }

  global.LabLenderSchedules = { render: render };
}(typeof window !== 'undefined' ? window : globalThis));
