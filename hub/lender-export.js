// Lender download: the lender schedules on Financials as a CSV and a print view, for a lender or investor to take away.
// Every figure comes from the shared Deal Engine result already on the page (sources and uses through
// LabFinancials.sourcesUsesRows, the schedules from js/deal-lender-schedules.js). Nothing here computes a figure;
// it only lays the same numbers out as rows. A figure the engine could not produce is left blank with its reason.
(function (global) {
  'use strict';
  var last = null;

  function known(v) { return typeof v === 'number' && isFinite(v); }
  function dollars(v) { return known(v) ? Math.round(v) : ''; }
  function ratio(v) { return known(v) ? Number(v.toFixed(2)) : ''; }
  function share(v) { return known(v) ? Number((v * 100).toFixed(1)) : ''; }
  function cell(v) {
    var t = String(v == null ? '' : v);
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  // The tables, as [title, header, rows, notes]. Shared by the CSV and the print view so both carry the same rows.
  function tables(r) {
    var F = global.LabFinancials, out = [];
    var su = F && F.sourcesUsesRows ? F.sourcesUsesRows(r) : null;
    if (su) {
      out.push(['Sources', ['Source', 'Amount ($)', 'Note'], su.sources.map(function (x) {
        return [x[0], dollars(x[1]), x[1] == null ? 'Unavailable: ' + (x[4] || F.unavailable(r, x[2])) : ''];
      }).concat([['Total development cost', dollars(su.tdc), '']]), []]);
      out.push(['Uses (Division of Housing cost categories)', ['Use', 'Amount ($)'], su.uses.map(function (x) { return [x[0], dollars(x[1])]; })
        .concat([['Total development cost', dollars(su.tdc)]]), []]);
    } else out.push(['Sources and uses', ['Note'], [['Unavailable: ' + (F ? F.unavailable(r, 'budget.groups') : 'the engine did not price the budget')]], []]);

    var tb = r.trancheBreakdown || [];
    if (tb.length) out.push(['Soft loans and grants', ['Source', 'Type', 'Amount ($)'], tb.map(function (t) {
      var label = F && F.SOFT_PROGRAMS ? (F.SOFT_PROGRAMS.filter(function (o) { return o[0] === t.program; })[0] || [0, t.program])[1] : t.program;
      return [label, t.mode === 'grant' ? 'Grant' : 'Loan', dollars(t.amount)];
    }), []]);
    out.push(['First mortgage', ['Item', 'Value'], [['Supportable first mortgage ($)', dollars(r.mortgage)], ['Interest rate (%)', known(r.interestRate) ? r.interestRate : ''],
      ['Term (years)', known(r.term) ? r.term : ''], ['Debt coverage used', ratio(r.dcr)], ['Net operating income, year 1 ($)', dollars(r.noi)]], []]);

    var s = r.schedules || {};
    var dr = s.draw;
    if (dr && dr.rows) {
      var c = dr.conversion || {};
      out.push(['Construction draws and conversion', ['Item', 'Value'], [['Construction months', dr.months], ['Months to conversion', dr.convertMonths],
        ['Peak construction loan ($)', dollars(dr.peakBalance)], ['Peak month', dr.peakMonth], ['Loan entered ($)', dollars(dr.loan)],
        ['Interest on this schedule ($)', dollars(dr.totalInterest)], ['Construction interest budget line ($)', dollars(dr.interestBudget)],
        ['Retainage held to completion ($)', dollars(dr.retainageHeld)], ['Unpaid at conversion ($)', c.paidOff ? 0 : dollars(c.shortfall)],
        ['Ties to total cost, less the deferred fee', dr.tie && dr.tie.ties ? 'Yes' : 'No']], (dr.notes || []).concat(c.note ? [c.note] : [])]);
      out.push(['Construction draws by month (equity in = investor pay-in)', ['Month', 'Stage', 'Costs paid ($)', 'Interest ($)', 'Equity in ($)', 'Other sources in ($)', 'Loan drawn ($)', 'Loan repaid ($)', 'Loan balance ($)'],
        dr.rows.map(function (x) {
          return [x.month, x.phase, dollars(x.acquisition + x.hard + x.retainageReleased + x.soft + x.fee + x.conversionCosts), dollars(x.interest), dollars(x.equity),
            dollars(x.softSources + x.permanent), dollars(x.loanDraw), dollars(x.loanRepaid), dollars(x.balance)];
        }), []]);
    } else out.push(['Construction draws and conversion', ['Note'], [['Unavailable: ' + ((dr && dr.reason) || 'the draw schedule did not run for these inputs')]], []]);

    var b = s.budget;
    if (b && b.rows) out.push(['Operating budget by year', ['Year', 'Gross rents ($)', 'Other income ($)', 'Vacancy loss ($)', 'Effective gross income ($)', 'Operating costs ($)', 'Net operating income ($)', 'Debt service ($)', 'Cash flow ($)', 'Debt coverage', 'Break-even vacancy (%)'],
      b.rows.map(function (x) {
        var opex = [x.managementFee, x.otherOpex, x.propTax, x.repReserve].every(known) ? x.managementFee + x.otherOpex + x.propTax + x.repReserve : null;
        return [x.year, dollars(x.grossRents), dollars(x.otherIncome), dollars(x.vacancyLoss), dollars(x.egi), dollars(opex), dollars(x.noi), dollars(x.debtService), dollars(x.cashFlow), ratio(x.dscr), share(x.breakEvenVacancy)];
      }), b.notes || []]);
    else out.push(['Operating budget by year', ['Note'], [['Unavailable: ' + ((b && b.reason) || 'the budget did not run for these inputs')]], []]);

    var rs = s.reserves, rep = rs && rs.replacement;
    if (rep && rep.rows) out.push(['Replacement reserve', ['Year', 'Deposit ($)', 'Interest ($)', 'Capital needs ($)', 'Balance ($)'],
      rep.rows.map(function (x) { return [x.year, dollars(x.deposit), dollars(x.interest), dollars(x.capitalNeeds), dollars(x.balance)]; }), []]);
    return out;
  }

  function header(meta) {
    return [['COHO Analytics lender schedules'], ['Deal', meta.name || ''], ['Made', meta.date], ['Engine', 'cohoanalytics.com Deal Calculator, public code ' + (global.LAB_PIN || '')],
      ['Screening figures, not a lender’s or investor’s underwriting.']];
  }

  function csv(r, meta) {
    var lines = header(meta).map(function (row) { return row.map(cell).join(','); });
    tables(r).forEach(function (t) {
      lines.push('', cell(t[0]), t[1].map(cell).join(','));
      t[2].forEach(function (row) { lines.push(row.map(cell).join(',')); });
      t[3].forEach(function (n) { lines.push(cell('Note: ' + n)); });
    });
    return lines.join('\r\n') + '\r\n';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(v, head) { return v === '' ? '—' : typeof v === 'number' && /\(\$\)/.test(head) ? '$' + v.toLocaleString('en-US') : String(v); }
  function printHtml(r, meta) {
    return '<h1>Lender schedules: ' + esc(meta.name || 'deal') + '</h1><p>' + esc(meta.date) + '. Calculated by the cohoanalytics.com Deal Calculator (public code ' + esc(global.LAB_PIN || '') +
      '). Screening figures, not a lender’s or investor’s underwriting.</p>' +
      tables(r).map(function (t) {
        return '<section><h2>' + esc(t[0]) + '</h2><table><thead><tr>' + t[1].map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          t[2].map(function (row) { return '<tr>' + row.map(function (v, i) { return '<td>' + esc(show(v, t[1][i] || '')) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' +
          t[3].map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + '</section>';
      }).join('');
  }

  function fileName(meta) {
    var slug = String(meta.name || 'deal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deal';
    return 'lender-schedules-' + slug + '-' + meta.date + '.csv';
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  // Financials calls this as it renders, so the buttons act on the figures on screen.
  function remember(r, name) { last = { r: r, name: name }; return ''; }
  function buttons() {
    return '<div class="actions ls-export"><button type="button" class="button-link secondary" data-action="lender-csv">Download lender schedules (CSV)</button>' +
      '<button type="button" class="button-link secondary" data-action="lender-print">Print or save as PDF</button></div>';
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('button[data-action="lender-csv"], button[data-action="lender-print"]');
    if (!b || !last) return;
    var meta = { name: last.name, date: today() };
    if (b.dataset.action === 'lender-csv') {
      var url = URL.createObjectURL(new Blob([csv(last.r, meta)], { type: 'text/csv;charset=utf-8' }));
      var a = document.createElement('a'); a.href = url; a.download = fileName(meta);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return;
    }
    var box = document.getElementById('lender-print');
    if (!box) { box = document.createElement('div'); box.id = 'lender-print'; document.body.appendChild(box); }
    box.innerHTML = printHtml(last.r, meta);
    document.body.classList.add('print-lender');
    var done = function () { document.body.classList.remove('print-lender'); global.removeEventListener('afterprint', done); };
    global.addEventListener('afterprint', done);
    global.print();
  });

  global.LabLenderExport = { remember: remember, buttons: buttons, csv: csv, tables: tables, printHtml: printHtml, fileName: fileName };
}(typeof window !== 'undefined' ? window : globalThis));
