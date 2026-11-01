/** Deal Calculator panel for the lender schedules (js/deal-lender-schedules.js):
 * CHFA minimums, construction draws and conversion, the 15-year budget with its
 * stress cases and reserves, and the exit paths. It adds its own inputs inside
 * the calculator mount, so they are read, saved and shared like every other
 * input, and it redraws from the engine result after each recalculation.
 */
(function () {
  'use strict';
  var PANEL_ID = 'dc-ls-panel';
  var INPUT = 'display:block;width:100%;box-sizing:border-box;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;';
  var GRID = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:.5rem;margin:.4rem 0;';
  var HINT = 'display:block;font-size:var(--tiny);color:var(--muted);margin-top:.2rem;line-height:1.35;';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function known(v) { return typeof v === 'number' && isFinite(v); }
  function money(v) { return known(v) ? (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US') : '—'; }
  function pct(v, d) { return known(v) ? (v * 100).toFixed(d == null ? 1 : d) + '%' : '—'; }
  function x(v) { return known(v) ? v.toFixed(2) + 'x' : '—'; }

  // [id, label, hint, kind, options/attrs, starting value]
  function field(f) {
    var id = f[0], label = f[1], hint = f[2], kind = f[3] || 'number', attrs = f[4] || '', value = f[5];
    var control;
    if (kind === 'select') {
      control = '<select id="' + id + '" style="' + INPUT + '">' + attrs.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else {
      control = '<input id="' + id + '" type="' + kind + '" ' + attrs + (value != null ? ' value="' + esc(value) + '"' : '') + ' placeholder="not entered" style="' + INPUT + '">';
    }
    return '<label style="display:block;font-size:var(--small);color:var(--muted);">' + esc(label) + control
      + (hint ? '<span style="' + HINT + '">' + esc(hint) + '</span>' : '') + '</label>';
  }
  function section(id, title, intro, inner, open) {
    return '<details id="' + id + '"' + (open ? ' open' : '') + ' style="margin-top:var(--sp2);border-top:1px solid var(--border);padding-top:.35rem;">'
      + '<summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;font-size:var(--small);">' + esc(title) + '</summary>'
      + (intro ? '<p style="font-size:var(--tiny);color:var(--muted);margin:.1rem 0 .4rem;line-height:1.5;">' + esc(intro) + '</p>' : '') + inner + '</details>';
  }

  function panelHtml() {
    var curves = [['scurve', 'S-curve'], ['straight', 'Straight line'], ['front', 'Front-loaded']];
    return '<fieldset id="' + PANEL_ID + '" data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);min-width:0;">'
      + '<legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Lender schedules: construction to year 30</legend>'
      + '<p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);line-height:1.5;">What a construction lender, a permanent lender and CHFA check: month-by-month draws, the payoff at conversion, 15 years of coverage under stress, the reserves, and what the property could do after year 15. Change any input and every figure redraws. Screening figures, not a lender\'s or investor\'s underwriting.</p>'
      + section('dc-ls-minimums', 'CHFA minimum assumptions', 'CHFA\'s Qualified Allocation Plan sets floors for the pro forma (Section 4.B and 4.C). Each line shows what this deal uses against the floor.',
        '<div style="' + GRID + '">'
        + field(['dc-chfa-sec8-full', 'Project-based Section 8 on every home?', 'Lowers the vacancy floor to 5% and raises the cost floor to $5,000.', 'select', [['', 'Not answered'], ['no', 'No'], ['yes', 'Yes']], ''])
        + field(['dc-chfa-senior', 'Senior housing?', 'Senior projects use a $300 reserve floor instead of $350.', 'select', [['', 'Not answered'], ['no', 'No'], ['yes', 'Yes']], ''])
        + '</div><div id="dc-ls-minimums-out" role="status" aria-live="polite"></div>', true)
      + section('dc-ls-draw', 'Construction draws and conversion', 'Uses the construction loan, rate, loan months and equity pay-in entered above. The loan funds only what equity and other sources in hand do not, and its interest is added to the loan each month.',
        '<div style="' + GRID + '">'
        + field(['dc-draw-curve', 'How construction spending runs', 'An S-curve is typical: slow site work, a fast middle, a slow finish.', 'select', curves, 'scurve'])
        + field(['dc-draw-convert-months', 'Months from completion to conversion', 'Lease-up and stabilization before the permanent loan funds.', 'number', 'min="0" max="36" step="1"', '6'])
        + field(['dc-draw-retainage', 'Retainage (%)', 'Held from each contractor draw until completion; 5% to 10% is common.', 'number', 'min="0" max="15" step="0.5"', '10'])
        + field(['dc-draw-fee-closing', 'Paid developer fee at closing (%)', 'The rest of the paid fee comes at conversion.', 'number', 'min="0" max="100" step="5"', '25'])
        + field(['dc-draw-soft-closing', 'Soft costs paid at closing (%)', 'Design, permits and fees often come due at closing; the rest is spread over the build.', 'number', 'min="0" max="100" step="5"', '40'])
        + field(['dc-draw-soft-sources', 'Soft loans and grants fund', 'Some public lenders fund at closing, others only at conversion.', 'select', [['closing', 'At closing'], ['conversion', 'At conversion']], 'closing'])
        + '</div><div id="dc-ls-draw-out" role="status" aria-live="polite"></div>'
        + '<h4 style="font-size:var(--small);margin:var(--sp2) 0 .2rem;">What could go wrong at conversion</h4>'
        + '<div style="' + GRID + '">'
        + field(['dc-conv-rate-bp', 'Permanent rate rise (basis points)', 'If the rate is not locked, a higher rate sizes a smaller loan.', 'number', 'min="0" max="300" step="5"', '50'])
        + field(['dc-conv-noi-cut', 'Income below plan (%)', 'Lower rents or higher costs at stabilization.', 'number', 'min="0" max="30" step="1"', '5'])
        + field(['dc-conv-credit-delivered', 'Credits delivered (%)', 'Below 100% triggers the investor\'s downward adjuster.', 'number', 'min="50" max="100" step="1"', '100'])
        + '</div><div id="dc-ls-conv-out" role="status" aria-live="polite"></div>')
      + section('dc-ls-budget', '15-year operating budget and stress tests', 'Year 1 matches the operating budget above; each line then grows at its own rate. CHFA asks for 1.15x coverage on all amortizing debt in every one of the 15 years.',
        '<div style="' + GRID + '">'
        + field(['dc-pf-mgmt-pct', 'Management fee (% of collected income)', 'Split out of the operating budget so it follows income, as management contracts do. Blank keeps it in operating costs.', 'number', 'min="0" max="15" step="0.5"', ''])
        + field(['dc-pf-tax-growth', 'Property tax growth (%/yr)', 'Blank uses the expense growth rate.', 'number', 'min="0" max="10" step="0.5"', ''])
        + field(['dc-pf-reserve-growth', 'Replacement reserve growth (%/yr)', 'Blank uses the expense growth rate.', 'number', 'min="0" max="10" step="0.5"', ''])
        + '</div><div id="dc-ls-budget-out" role="status" aria-live="polite"></div>')
      + section('dc-ls-reserves', 'Reserve accounts', 'The replacement reserve starts with the Replacement reserve cost line, takes the yearly deposits and pays for the capital needs you list. The operating reserve covers any year the property cannot pay its bills.',
        '<div style="' + GRID + '">'
        + field(['dc-pf-capital-needs', 'Capital needs (year:amount; …)', 'From a capital needs assessment, such as 12:180000; 15:95000.', 'text', 'inputmode="text" autocomplete="off"', ''])
        + field(['dc-pf-reserve-yield', 'Interest on the reserve (%/yr)', 'Blank earns nothing.', 'number', 'min="0" max="8" step="0.25"', ''])
        + '</div><div id="dc-ls-reserves-out" role="status" aria-live="polite"></div>')
      + section('dc-ls-exit', 'After year 15: exit paths', 'Uses the exit year and cap rate entered in the exit analysis above. Each path is a screen to compare options, not an offer or an appraisal.',
        '<div style="' + GRID + '">'
        + field(['dc-after-taxes', 'Exit taxes for the minimum price ($)', 'The investor\'s taxes on the sale. Member tools can estimate them.', 'number', 'min="0" step="1000"', ''])
        + field(['dc-after-refi-rate', 'Refinance rate (%)', '', 'number', 'min="0" max="15" step="0.05"', ''])
        + field(['dc-after-refi-term', 'Refinance amortization (years)', '', 'number', 'min="5" max="40" step="1"', '35'])
        + field(['dc-after-refi-dcr', 'Refinance coverage (x)', '', 'number', 'min="1" max="2" step="0.05"', '1.20'])
        + field(['dc-after-refi-cost', 'Refinance costs (% of loan)', '', 'number', 'min="0" max="10" step="0.25"', '2'])
        + field(['dc-after-land-pct', 'Land share of the price (%)', 'Land earns no acquisition credit.', 'number', 'min="0" max="60" step="1"', '10'])
        + field(['dc-after-rehab-per-home', 'Rehabilitation per home ($)', 'For a resyndication.', 'number', 'min="0" max="400000" step="1000"', ''])
        + field(['dc-after-rehab-rate', 'Rehabilitation credit rate (%)', 'About 4% with bonds.', 'number', 'min="3" max="10" step="0.05"', '4'])
        + field(['dc-after-resyn-price', 'Credit price, resyndication ($ per $1)', '', 'number', 'min="0.5" max="1.2" step="0.01"', ''])
        + '</div><div id="dc-ls-exit-out" role="status" aria-live="polite"></div>')
      + '</fieldset>';
  }

  function dl(pairs) {
    return '<dl style="display:grid;grid-template-columns:1fr auto;gap:.25rem .75rem;margin:.3rem 0;font-size:var(--small);">' + pairs.map(function (p) {
      return '<dt style="color:var(--muted);">' + esc(p[0]) + '</dt><dd style="margin:0;text-align:right;font-weight:700;' + (p[2] || '') + '">' + esc(p[1]) + '</dd>';
    }).join('') + '</dl>';
  }
  function note(text, warn) {
    return text ? '<p style="margin:.25rem 0;font-size:var(--tiny);line-height:1.45;color:' + (warn ? 'var(--warn,#b45309)' : 'var(--muted)') + ';">' + esc(text) + '</p>' : '';
  }
  function table(head, rows, caption) {
    return '<div style="overflow-x:auto;"><table data-no-sort style="border-collapse:collapse;font-size:var(--tiny);white-space:nowrap;width:100%;">'
      + (caption ? '<caption style="text-align:left;font-size:var(--tiny);color:var(--muted);padding:.2rem 0;">' + esc(caption) + '</caption>' : '')
      + '<thead><tr>' + head.map(function (h, i) { return '<th scope="col" style="text-align:' + (i ? 'right' : 'left') + ';padding:.25rem .4rem;border-bottom:1px solid var(--border);">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td style="text-align:' + (i ? 'right' : 'left') + ';padding:.2rem .4rem;border-bottom:1px solid var(--border);">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('')
      + '</tbody></table></div>';
  }
  // Short lists read as stacked cards, so nothing is cut off on a phone.
  function cards(items) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:.4rem;margin:.3rem 0;">' + items.map(function (it) {
      return '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:.35rem .5rem;background:var(--card);' + (it.flag ? 'border-left:4px solid ' + it.flag + ';' : '') + '">'
        + '<p style="margin:0 0 .15rem;font-weight:700;font-size:var(--small);">' + esc(it.title) + '</p>'
        + it.pairs.map(function (p) { return '<p style="margin:0;display:flex;justify-content:space-between;gap:.5rem;font-size:var(--tiny);"><span style="color:var(--muted);">' + esc(p[0]) + '</span><span style="font-weight:600;text-align:right;">' + esc(p[1]) + '</span></p>'; }).join('')
        + (it.note ? '<p style="margin:.15rem 0 0;font-size:var(--tiny);color:var(--muted);line-height:1.35;">' + esc(it.note) + '</p>' : '') + '</div>';
    }).join('') + '</div>';
  }
  var BAD = 'var(--bad,#b91c1c)', GOOD = 'var(--good,#047857)';
  function more(summary, inner) {
    return '<details style="margin-top:.3rem;"><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:var(--small);">' + esc(summary) + '</summary>' + inner + '</details>';
  }
  function reason(r) { return '<p style="margin:.3rem 0;font-size:var(--small);color:var(--muted);">' + esc(r) + '</p>'; }

  // Loan balance by month as bars, so the peak and the payoff read at a glance.
  function balanceChart(d) {
    var w = 320, h = 90, n = d.rows.length, max = Math.max(d.peakBalance, d.loan, 1), bw = w / n;
    var bars = d.rows.map(function (r, i) {
      var high = r.balance + r.loanRepaid, bh = high / max * (h - 12);
      return '<rect x="' + (i * bw + 0.5).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (r.month >= d.months ? 'var(--accent,#0f766e)' : 'var(--muted,#64748b)') + '"><title>Month ' + r.month + ': ' + money(high) + '</title></rect>';
    }).join('');
    var ly = (h - d.loan / max * (h - 12)).toFixed(1);
    return '<figure style="margin:.4rem 0;"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Construction loan balance by month, peaking at ' + money(d.peakBalance) + ' in month ' + d.peakMonth + '" style="width:100%;max-width:520px;height:auto;display:block;">'
      + bars + '<line x1="0" x2="' + w + '" y1="' + ly + '" y2="' + ly + '" stroke="var(--warn,#b45309)" stroke-dasharray="4 3"/></svg>'
      + '<figcaption style="font-size:var(--tiny);color:var(--muted);">Loan balance each month (grey: building; green: lease-up and conversion). Dashed line: the construction loan entered.</figcaption></figure>';
  }

  function renderMinimums(cbr) {
    var m = cbr && cbr.chfaMinimums;
    if (!m) return reason('Load the CHFA rules to check the minimums.');
    if (m.reason) return reason(m.reason);
    var fmtVal = function (i, v) { return v == null ? '—' : /growth|Vacancy/.test(i.label) ? pct(v) : money(v); };
    return cards(m.items.map(function (i) {
      return { title: (i.passes === true ? '✓ ' : i.passes === false ? '✗ ' : '') + i.label, flag: i.passes === true ? GOOD : i.passes === false ? BAD : null,
        pairs: [['This deal', fmtVal(i, i.entered)], ['CHFA', (i.direction === 'at most' ? 'at most ' : 'at least ') + fmtVal(i, i.minimum)]],
        note: i.passes == null ? i.reason : null };
    })) + m.notes.map(function (n) { return note(n); }).join('') + note(m.items[0] && m.items[0].citation ? 'Source: ' + m.items[0].citation.replace(/, Section.*$/, '') + ', Section 4.' : '');
  }

  function renderDraw(d) {
    if (d.reason) return reason(d.reason) + (d.reasons && d.reasons.length > 1 ? note('Also needed: ' + d.reasons.slice(1, 4).join(' ')) : '');
    var c = d.conversion;
    return dl([
      ['Construction', d.months + ' months, then ' + d.convertMonths + ' to conversion'],
      ['Peak construction loan', money(d.peakBalance) + ' in month ' + d.peakMonth, d.loanEnough ? '' : 'color:var(--bad,#b91c1c);'],
      ['Loan entered', money(d.loan)],
      ['Interest on this schedule', money(d.totalInterest)],
      ['Construction interest budget line', money(d.interestBudget), d.interestVsBudget < -0.5 ? 'color:var(--bad,#b91c1c);' : ''],
      ['Simple estimate (loan x rate x months x share drawn)', d.simpleEstimate == null ? 'not entered' : money(d.simpleEstimate)],
      ['Retainage held to completion', money(d.retainageHeld)],
      ['At conversion', c.paidOff ? 'Loan repaid' : money(c.shortfall) + ' unpaid', c.paidOff ? 'color:var(--good,#047857);' : 'color:var(--bad,#b91c1c);']
    ]) + balanceChart(d) + note(c.note, !c.paidOff) + d.notes.map(function (n) { return note(n, true); }).join('')
      + note(d.tie.ties ? 'Check: uses on the schedule tie to total cost, less the deferred fee, with this interest in place of the budget line.' : 'Check failed: the schedule does not tie to total cost.', !d.tie.ties)
      + more('Month-by-month draws (' + d.rows.length + ' months)', table(['Month', 'Stage', 'Costs paid', 'Interest', 'Equity in', 'Other sources in', 'Loan drawn', 'Loan repaid', 'Loan balance'],
        d.rows.map(function (r) {
          return [String(r.month), r.phase, money(r.acquisition + r.hard + r.retainageReleased + r.soft + r.fee + r.conversionCosts), money(r.interest), money(r.equity),
            money(r.softSources + r.permanent), money(r.loanDraw), money(r.loanRepaid), money(r.balance)];
        })));
  }

  function renderConversion(cv) {
    if (cv.reason) return reason(cv.reason);
    return cards(cv.cases.map(function (c) {
      var shortText = c.reason ? c.reason : c.netShort ? money(c.netShort) + ' short' : (c.netSpare ? money(c.netSpare) + ' spare' : 'Ties exactly');
      return { title: c.label, flag: c.reason ? null : c.netShort ? BAD : GOOD, note: c.explain,
        pairs: [['Permanent loan', money(c.permanent)], ['Loan change', money(c.loanChange)], ['Equity adjuster', money(c.equityAdjuster)], ['At conversion', shortText]] };
    })) + note('Coverage at conversion ' + x(cv.dscrAtConversion) + ' against the ' + x(cv.requiredDscr) + ' the loan is sized on. A shortfall is usually closed with more deferred fee, a soft loan or a smaller loan request.');
  }

  function renderBudget(b, s) {
    var out = '';
    if (b.reason) out += reason(b.reason);
    else {
      out += (b.coverageReason ? reason(b.coverageReason) : dl([
        ['Lowest coverage, years 1-15', x(b.lowestDscr) + ' in year ' + b.lowestYear, b.firstBelowMinimum ? 'color:var(--bad,#b91c1c);' : ''],
        ['First year below 1.15x', b.firstBelowMinimum ? 'Year ' + b.firstBelowMinimum : 'None', b.firstBelowMinimum ? 'color:var(--bad,#b91c1c);' : 'color:var(--good,#047857);'],
        ['Rent cushion to 1.15x (lowest year)', known(b.lowestCushion) ? money(b.lowestCushion) + ' a home a month' : '—']
      ])) + note('The rent cushion is how far rent could fall, per home per month, before coverage drops to 1.15x. CHFA\'s stress sheet asks the same question.')
        + b.notes.map(function (n) { return note(n); }).join('')
        + more('Year-by-year budget (' + b.rows.length + ' years)', table(['Year', 'Rents', 'Vacancy', 'Management', 'Other operating', 'Property tax', 'Reserve', 'NOI', 'Debt service', 'Coverage', 'Break-even vacancy'],
          b.rows.map(function (r) {
            return [String(r.year), money(r.grossRents + r.otherIncome), money(r.vacancyLoss), r.managementFee == null ? 'in operating' : money(r.managementFee), money(r.otherOpex),
              money(r.propTax), money(r.repReserve), money(r.noi), money(r.debtService), x(r.dscr), pct(r.breakEvenVacancy)];
          })));
    }
    if (s.reason) return out + reason(s.reason);
    return out + '<h4 style="font-size:var(--small);margin:var(--sp2) 0 .2rem;">Stress tests over 15 years</h4>'
      + cards(s.cases.map(function (c) {
        return { title: c.label, flag: c.reason ? null : c.firstBelowMinimum ? BAD : GOOD, note: c.reason || c.explain,
          pairs: c.reason ? [] : [['Lowest coverage', x(c.lowestDscr) + ' in year ' + c.lowestYear], ['First year below 1.15x', c.firstBelowMinimum ? 'Year ' + c.firstBelowMinimum : 'None']] };
      })) + note('Each case runs the same calculation again with one input changed; the permanent loan stays at the planned amount.');
  }

  function renderReserves(rs) {
    if (rs.reason) return reason(rs.reason);
    var rep = rs.replacement, op = rs.operating, out = '';
    if (rep.reason) out += reason(rep.reason);
    else {
      var last = rep.rows[rep.rows.length - 1];
      out += dl([['Replacement reserve at year ' + last.year, money(last.balance) + (known(last.perHome) ? ' (' + money(last.perHome) + ' a home)' : ''), last.balance < 0 ? 'color:var(--bad,#b91c1c);' : ''],
        ['First year the account runs out', rep.firstShort ? 'Year ' + rep.firstShort : 'None', rep.firstShort ? 'color:var(--bad,#b91c1c);' : '']])
        + note(rep.note) + more('Replacement reserve by year', table(['Year', 'Deposit', 'Interest', 'Capital needs', 'Balance'],
          rep.rows.map(function (r) { return [String(r.year), money(r.deposit), money(r.interest), money(r.capitalNeeds), money(r.balance)]; })));
    }
    if (op.reason) out += reason(op.reason);
    else out += dl([['Operating reserve drawn over ' + op.rows.length + ' years', money(op.totalDrawn)],
      ['Operating reserve left', money(op.rows[op.rows.length - 1].balance), op.firstShort ? 'color:var(--bad,#b91c1c);' : '']]);
    return out;
  }

  function renderExit(e) {
    if (e.reason) return reason(e.reason);
    var out = '<h4 style="font-size:var(--small);margin:.3rem 0 .2rem;">Value at year ' + e.holdYear + ' across cap rates</h4>'
      + cards((e.capRange || []).map(function (c) {
        return { title: pct(c.cap, 2) + ' cap', note: c.reason, pairs: [['Value', money(c.value)], ['Per home', money(c.perHome)], ['After paying all debt', money(c.afterDebt)]] };
      }));
    var mp = e.minimumPrice;
    out += '<h4 style="font-size:var(--small);margin:var(--sp2) 0 .2rem;">Nonprofit or tenant purchase at the minimum price</h4>'
      + (mp.reason ? reason(mp.reason) : dl([['Debt outstanding', money(mp.debt)], ['Exit taxes', money(mp.exitTaxes)], ['Minimum price', money(mp.price)], ['Market value at the planned cap', money(mp.marketValue)]]))
      + note(mp.citation);
    var rf = e.refinance;
    out += '<h4 style="font-size:var(--small);margin:var(--sp2) 0 .2rem;">Refinance and hold</h4>'
      + (rf.reason ? reason(rf.reason) : dl([['New loan', money(rf.newLoan)], ['Pays off', money(rf.payoff)], ['Costs', money(rf.costs)],
        ['Cash out', money(rf.cashOut), rf.cashOut < 0 ? 'color:var(--bad,#b91c1c);' : 'color:var(--good,#047857);'], ['New annual payment', money(rf.annualPayment)]]) + note(rf.note));
    var rs = e.resyndication;
    out += '<h4 style="font-size:var(--small);margin:var(--sp2) 0 .2rem;">Resyndication with new credits</h4>'
      + (rs.reason ? reason(rs.reason) : dl([['Purchase price', money(rs.purchasePrice)], ['Acquisition basis (less land)', money(rs.acquisitionBasis)],
        ['Rehabilitation basis', money(rs.rehabBasis)], ['Annual credit', money(rs.annualCredit)], ['Credit equity', money(rs.equity)],
        ['Equity left after rehabilitation', money(rs.equityLessRehab)]]) + note(rs.note) + note(rs.citation));
    var hd = e.hold;
    out += '<h4 style="font-size:var(--small);margin:var(--sp2) 0 .2rem;">Keep owning it</h4>'
      + (hd.reason ? reason(hd.reason) : dl([['Cash flow, years ' + hd.fromYear + '-' + hd.toYear, money(hd.cumulativeCashFlow)], ['Lowest coverage in those years', x(hd.lowestDscr)]]));
    return out;
  }

  function set(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

  function render(result) {
    var s = result && result.schedules;
    if (!s) return;
    set('dc-ls-minimums-out', renderMinimums(result.costBasis));
    set('dc-ls-draw-out', renderDraw(s.draw));
    set('dc-ls-conv-out', renderConversion(s.conversion));
    set('dc-ls-budget-out', renderBudget(s.budget, s.stress));
    set('dc-ls-reserves-out', renderReserves(s.reserves));
    set('dc-ls-exit-out', renderExit(s.exit));
  }

  // The calculator template places the panel (panelHtml) after the exit
  // analysis, so saved and shared deals restore these inputs like any other.
  // If a page mounts without it, add it after the exit analysis here.
  function mount() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) {
      var exit = document.getElementById('dc-exit-summary');
      var anchor = exit && exit.closest('fieldset');
      if (!anchor) return false;
      anchor.insertAdjacentHTML('afterend', panelHtml());
      panel = document.getElementById(PANEL_ID);
      setTimeout(recalc, 0);
    }
    if (!panel.dataset.bound) {
      panel.dataset.bound = '1';
      panel.addEventListener('input', recalc);
      panel.addEventListener('change', function (e) { if (e.target && e.target.tagName === 'SELECT') recalc(); });
    }
    return true;
  }
  function recalc() { if (window.__DealCalc && window.__DealCalc.recalculate) window.__DealCalc.recalculate(); }

  document.addEventListener('deal-calc:updated', function (event) {
    if (!mount()) return;
    render(event.detail && event.detail.result);
  });
  if (typeof window !== 'undefined') window.DealLenderSchedulesView = { render: render, mount: mount, panelHtml: panelHtml };
}());
