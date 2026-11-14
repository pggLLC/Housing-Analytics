// The Deal Calculator's Colorado Division of Housing (DOH) views on the Financials page (calculator move, piece C,
// 14 Nov 2026): where each soft source counts in DOH's layout, what it pays for, its status and whether it is a
// state request; the first mortgage's DOH loan type and the maximum loan by value; DOH's Permanent Financing
// Sources table, its Sources and uses by activity table and its 15-year operating pro forma; and the Export CSV of
// the result. Every figure comes from the public site's own modules at the pin, js/deal-permanent-financing.js and
// js/deal-doh-schedules.js, fed the engine's result the way js/deal-calculator.js feeds them (renderPermanentFinancing,
// renderDohSchedules, getOutputRecords). This file does no deal arithmetic of its own. qa/calc-doh.test.js checks it.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  function PF() { return global.DealPermanentFinancing; }
  function DS() { return global.DealDohSchedules; }

  // ---------- inputs ----------
  // The first mortgage's DOH loan type and DOH's quick maximum-loan check, under the live page's ids.
  var LENDER_TYPE_OPTIONS = [['C', 'Conventional (C)'], ['T', 'Tax-exempt (T)'], ['F', 'Federal financing (F)']];
  var INPUTS = [
    { id: 'dc-senior-lender-type', group: 'senior', label: 'First mortgage loan type (DOH)', options: LENDER_TYPE_OPTIONS, value: 'C',
      note: 'Where the first mortgage sits in the Division of Housing’s sources table. It changes no figure.' },
    { id: 'dc-pf-cap-rate', group: 'dohmax', label: 'Cap rate (%)', value: '', step: '0.05', min: '0', max: '20', placeholder: 'not entered' },
    { id: 'dc-pf-cap-lvr', group: 'dohmax', label: 'Loan-to-value on cap-rate value (%)', value: '', step: '1', min: '0', max: '100', placeholder: 'not entered' },
    { id: 'dc-pf-appraised', group: 'dohmax', label: 'Appraised value ($)', value: '', step: '10000', min: '0', placeholder: 'not entered', note: 'From your appraisal.' },
    { id: 'dc-pf-appraised-lvr', group: 'dohmax', label: 'Loan-to-value on appraised value (%)', value: '', step: '1', min: '0', max: '100', placeholder: 'not entered' }
  ];

  // What each soft source carries for DOH, as the live rows do: doh (its group), activity (what it pays for),
  // status, and stateRequest. In the draft every value is a string; stateRequest is 'yes' or 'no'.
  var KEYS = ['doh', 'activity', 'status', 'stateRequest'];
  function defaults(program) {
    var pf = PF(), ds = DS();
    return { doh: pf ? pf.defaultGroup(program) : '', activity: '', status: 'pending', stateRequest: ds && ds.defaultStateRequest(program) ? 'yes' : 'no' };
  }
  // A source saved before these answers existed starts at the live page's defaults for its program.
  function fill(t) {
    var d = defaults(t.program);
    KEYS.forEach(function (k) { if (t[k] == null) t[k] = d[k]; });
    return t;
  }
  // As on the live page, picking another program resets the DOH group and the state-request answer to that program's.
  function programChanged(t) { var d = defaults(t.program); t.doh = d.doh; t.stateRequest = d.stateRequest; return t; }
  // The four values as the live rows hand them to the engine.
  function engine(t) {
    fill(t);
    return { doh: t.doh, stateRequest: t.stateRequest === 'yes', status: t.status === 'committed' ? 'committed' : 'pending', activity: t.activity || '' };
  }
  function select(name, label, options, value, note) {
    return '<label class="field"><span>' + esc(label) + '</span><select name="' + esc(name) + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>' + (note ? '<small class="note">' + esc(note) + '</small>' : '') + '</label>';
  }
  // The four selects on a soft source's row, in the live page's words.
  function trancheFields(t, i) {
    var pf = PF(), ds = DS();
    if (!pf || !ds) return '';
    fill(t);
    var historic = t.program === pf.HISTORIC_PROGRAM && t.mode !== 'loan';
    // A federal historic credit entered as equity has one place in DOH's layout; its saved answer is kept for a loan.
    var groups = historic ? [[t.doh || '', 'Tax credit equity: federal historic credit']]
      : [['', 'Not answered']].concat(pf.GROUPS.map(function (g) { return [g.id, g.label]; }));
    var name = function (k) { return 'tr:' + i + ':' + k; };
    return '<div class="field-grid doh-fields">' +
      select(name('doh'), 'Counts in DOH’s sources as', groups, t.doh || '') +
      select(name('activity'), 'Pays for', [['', 'The whole project']].concat(ds.ACTIVITIES.map(function (a) { return [a.id, a.label]; })), t.activity || '') +
      select(name('status'), 'Status', ds.STATUSES.map(function (s) { return [s.id, s.label]; }), t.status === 'committed' ? 'committed' : 'pending') +
      select(name('stateRequest'), 'State funds request?', [['yes', 'Yes'], ['no', 'No']], t.stateRequest === 'yes' ? 'yes' : 'no') +
      '</div>';
  }
  function read(fd, t, i) { KEYS.forEach(function (k) { var v = fd.get('tr:' + i + ':' + k); if (v != null) t[k] = String(v); }); }

  // ---------- the three DOH views ----------
  function money(v) { return v === null || v === undefined ? '—' : (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function field(fields, id) { var v = fields && fields[id]; return v == null ? '' : String(v).trim(); }
  // The Permanent Financing Sources summary, as renderPermanentFinancing asks for it.
  function financing(r, fields) {
    var pf = PF();
    if (!pf || !r) return null;
    return pf.summarize({ result: r, tranches: r.tranches || [], seniorLenderType: field(fields, 'dc-senior-lender-type'),
      capRatePct: field(fields, 'dc-pf-cap-rate'), capLvrPct: field(fields, 'dc-pf-cap-lvr'),
      appraisedValue: field(fields, 'dc-pf-appraised'), appraisedLvrPct: field(fields, 'dc-pf-appraised-lvr') });
  }
  // Sources by activity and the 15-year rows, as renderDohSchedules asks for them.
  function schedules(r, s) {
    var ds = DS(), pf = PF();
    if (!ds || !pf || !r) return null;
    return { sourcesByActivity: ds.sourcesByActivity({ costSummary: r.costBasis && r.costBasis.summary, financing: s, tranches: r.tranches || [], labels: pf.PROGRAM_LABELS }),
      fifteenYear: ds.fifteenYear(r) };
  }
  var NO_SOURCE = ' data-no-source="calculator output: regroups the inputs and sources above"';
  function dl(pairs, role) {
    return '<dl class="doh-dl" data-role="' + role + '">' + pairs.map(function (p) {
      return '<div><dt>' + esc(p[0]) + '</dt><dd data-doh="' + p[2] + '">' + p[1] + '</dd></div>';
    }).join('') + '</dl>';
  }
  function reasons(list, role) {
    var seen = list.filter(function (x, i, all) { return x && all.indexOf(x) === i; });
    return seen.length ? '<p class="note doh-reason" role="status" data-role="' + role + '">' + esc(seen.join(' ')) + '</p>' : '';
  }

  function financingSection(s) {
    var pf = PF(), t = s.totals, tc = s.taxCredit;
    function pct(v) { var p = s.pctOfTdc(v); return p === null ? '—' : (p * 100).toFixed(1) + '%'; }
    function row(key, label, v, opts) {
      opts = opts || {};
      return '<tr data-pf-row="' + key + '"' + (opts.strong ? ' class="row-strong"' : opts.indent ? ' class="doh-indent"' : '') + '><th scope="row">' + esc(label) + '</th>' +
        '<td class="num" data-pf-amount>' + money(v) + '</td><td class="num">' + (opts.noPct ? '' : pct(v)) + '</td></tr>';
    }
    var rows = row('conventional', 'Conventional', t.conventional) + row('tax_exempt', 'Tax-exempt', t.taxExempt) +
      row('federal_financing', 'Federal financing', t.federalFinancing) + row('tax_credits', 'Tax credit equity', t.taxCredits) +
      row('nine', '9% LIHTC proceeds', tc.nine, { indent: true }) + row('four', '4% LIHTC proceeds', tc.four, { indent: true }) +
      row('historic', 'Federal historic credit', tc.historic, { indent: true }) +
      (tc.state === 0 ? '' : row('state', 'Colorado state credit (not a DOH row)', tc.state, { indent: true })) +
      (!tc.added ? '' : row('added', (tc.addedLabel || 'Added credit') + ' (not a DOH row)', tc.added, { indent: true })) +
      row('government', 'Government grants and soft debt', t.government) + row('other_grants', 'Other grants (non-governmental)', t.otherGrants) +
      row('owner', 'Owner equity', t.ownerEquity) + row('deferred_fee', 'Deferred developer fee', s.deferredDevFee, { indent: true }) +
      (s.unclassified.length ? row('unclassified', 'Not yet grouped', t.unclassified) : '') +
      row('total_sources', 'Total sources', t.totalSources, { strong: true }) + row('gap', 'Gap (surplus)', t.gap) +
      row('tdc', 'Total development cost', t.tdc, { strong: true });
    var typeLabel = {};
    pf.LENDER_TYPES.forEach(function (lt) { typeLabel[lt.id] = lt.label; });
    var mortgages = s.hardMortgages.map(function (m, i) {
      var name = m.source === 'senior' ? 'First mortgage' : m.label + ' (' + (pf.PROGRAM_LABELS[m.program] || m.program) + ')';
      return '<p data-pf-mortgage="' + i + '">' + esc(name) + ': ' + esc(m.lenderType ? typeLabel[m.lenderType] : 'loan type not chosen') + ', ' +
        money(m.principal) + ' principal, ' + money(m.annualPayment) + ' a year, coverage ' + (m.cumulativeDcr === null ? '—' : m.cumulativeDcr.toFixed(2)) + '</p>';
    }).join('');
    var c = s.maxLoan.byCap, a = s.maxLoan.byAppraisal;
    return '<section class="fin-section doh" aria-labelledby="fin-doh-pf"' + NO_SOURCE + '><h2 id="fin-doh-pf">Permanent financing, Colorado DOH layout</h2>' +
      '<p>The same sources as above, grouped the way the Colorado Division of Housing (DOH) application’s Permanent Financing Sources tab groups them. ' +
      'Set where each soft source counts on its row under Loans, credits and terms. Nothing here changes a result.</p>' +
      reasons(s.reasons, 'pf-reason') +
      '<div class="table-scroll" role="region" aria-label="Permanent financing in the DOH layout" tabindex="0"><table data-role="doh-pf"><thead><tr><th scope="col">Financing source</th><th scope="col" class="num">Total</th><th scope="col" class="num">Share of total cost</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<h3>Hard mortgages and coverage</h3><div data-role="pf-mortgages">' + (mortgages || '<p class="note">No hard mortgage.</p>') + '</div>' +
      dl([['Coverage on all hard debt', s.dcr === null ? '—' : s.dcr.toFixed(2), 'dcr'],
        ['Break-even occupancy', s.breakEven === null ? '—' : (s.breakEven * 100).toFixed(1) + '%', 'bep'],
        ['Possible debt service at ' + pf.DOH_DCR.toFixed(2) + ' coverage', money(s.possibleDebtService), 'possible-ds']], 'pf-coverage') +
      '<h3>Maximum loan by value (DOH quick calculation)</h3><p class="note">Beside sizing by coverage: value at a cap rate, or an appraised value, times a loan-to-value ratio. Enter them under Loans, credits and terms; blank skips the check.</p>' +
      dl([['Value at cap rate', c.reason ? esc(c.reason) : money(c.value), 'cap-value'],
        ['Maximum loan by cap-rate value', c.reason ? '—' : money(c.maxLoan), 'cap-max'],
        ['Maximum loan by appraised value', a.reason ? esc(a.reason) : money(a.maxLoan), 'appraised-max'],
        ['Hard debt above the lower maximum', s.overMaxLoan === null ? '—' : money(s.overMaxLoan), 'over-max']], 'pf-maxloan') +
      '</section>';
  }

  function activitySection(su) {
    function names(list) { return list.map(function (e) { return esc(e.name) + (e.status ? ' (' + (e.status === 'committed' ? 'committed' : 'pending') + ')' : ''); }).join(', '); }
    // A dash is an unknown amount; a category with no state or other dollars shows $0.
    function tr(key, label, cost, state, other, sources, strong) {
      return '<tr data-su-row="' + key + '"' + (strong ? ' class="row-strong"' : '') + '><th scope="row">' + esc(label) +
        (sources ? '<span class="doh-sources" data-su="sources">' + sources + '</span>' : '') + '</th>' +
        '<td class="num" data-su="cost">' + cost + '</td><td class="num" data-su="state">' + state + '</td><td class="num" data-su="other">' + other + '</td></tr>';
    }
    var html = su.rows.map(function (r) { return tr(r.id, r.label, money(r.cost), money(r.state), money(r.other), names(r.sources)); }).join('');
    if (su.notItemized) html += tr('not_itemized', 'Not itemized', money(su.notItemized), '—', '—', '');
    if (su.general) html += tr('general', 'Whole project', '', money(su.general.state), money(su.general.other), names(su.general.sources));
    var t = su.totals;
    if (t) html += tr('total', 'Total', money(t.cost), money(t.state), money(t.other), '', true) + tr('gap', 'Gap (surplus)', '', '', money(t.gap), '');
    return '<section class="fin-section doh" aria-labelledby="fin-doh-act"' + NO_SOURCE + '><h2 id="fin-doh-act">Sources and uses by activity, DOH layout</h2>' +
      '<p>Each cost category’s cost and the soft sources that pay for it. Choose what a source pays for, its status and whether it is a state request on its row under Loans, credits and terms. ' +
      'Tax credit equity, the first mortgage and the deferred fee pay for the project as a whole.</p>' + reasons(su.reasons, 'act-reason') +
      '<div class="table-scroll" role="region" aria-label="Sources and uses by activity in the DOH layout" tabindex="0"><table data-role="doh-act"><thead><tr><th scope="col">Activity and sources</th><th scope="col" class="num">Total cost</th><th scope="col" class="num">State funds</th><th scope="col" class="num">Other funds</th></tr></thead><tbody>' + html + '</tbody></table></div></section>';
  }

  function fifteenSection(f) {
    var pf = PF();
    var head = '<section class="fin-section doh" aria-labelledby="fin-doh-15"' + NO_SOURCE + '><h2 id="fin-doh-15">15-year operating pro forma, DOH layout</h2>' +
      '<p>Cash left after the mortgages and any bridge loan pays the asset management fee first, then the deferred developer fee, then cash-flow loans share what is left ' +
      '(the DOH Proforma order in CHFA’s 2027 Common Application). Rent and expense growth are the projection’s. The asset management fee and the bridge loan are under Loans, credits and terms.</p>';
    var notice = f.reason ? 'Unavailable: ' + f.reason : f.notice ? 'Some years are unavailable: ' + f.notice : '';
    if (!f.rows) return head + reasons([notice], 'doh15-reason') + '</section>';
    var df = f.deferredFee, y15 = f.rows[f.rows.length - 1];
    var summary = dl([['Year-15 cash after payments', money(y15.availableAfterPayments), 'cash15'],
      ['Deferred developer fee repaid', df.paybackYear ? 'Year ' + df.paybackYear : df.amount === 0 ? 'No deferred fee' : esc(df.reason || '—'), 'payback'],
      ['Deferred fee unpaid after year 15', money(df.unpaidAfter), 'unpaid']]
      .concat(f.assetMgmt.unpaidAfter !== 0 ? [['Asset management fee owed after year 15', money(f.assetMgmt.unpaidAfter), 'asset-unpaid']] : []), 'doh15-summary');
    function line(key, label, values, strong) {
      return '<tr data-doh15-row="' + key + '"' + (strong ? ' class="row-strong"' : '') + '><th scope="row">' + esc(label) + '</th>' + values.map(function (v) { return '<td class="num">' + v + '</td>'; }).join('') + '</tr>';
    }
    function col(key, fmt) { return f.rows.map(function (x) { return (fmt || money)(x[key]); }); }
    var body = line('rent', 'Rent income', col('rentIncome')) + line('vacancy', 'Less vacancy', col('vacancy')) + line('other_income', 'Other income', col('otherIncome')) +
      line('egi', 'Effective gross income', col('egi')) + line('expenses', 'Total annual expenses', col('expenses')) + line('noi', 'Net operating income', col('noi'), true) +
      line('debt_service', 'Total debt service', col('debtService')) + line('bridge', 'Bridge loan debt service', col('bridge')) +
      line('cf_available', 'Cash flow available', col('cashFlowAvailable'), true) +
      line('dcr', 'Debt coverage ratio', col('dcr', function (v) { return v === null || v === undefined ? '—' : v.toFixed(2); })) +
      // Must-pay debt service that income could not cover is added to the loan balance, not paid from cash.
      (f.rows.some(function (x) { return x.mustPayUnpaid > 0; }) ? line('unpaid_ds', 'Debt service left unpaid (added to the loan balance)', col('mustPayUnpaid')) : '') +
      line('asset_fee', 'Asset management fees', col('assetMgmtFee')) +
      f.loans.map(function (l, n) { return line('cf_loan_' + (n + 1), l.label + ' (' + (pf.PROGRAM_LABELS[l.program] || l.program) + ')', f.rows.map(function (x) { return money(x.cashFlowLoans[n]); })); }).join('') +
      line('deferred_fee', 'Deferred developer fees', col('deferredFee')) +
      (f.rows.some(function (x) { return x.deficitRecovered > 0; }) ? line('deficit', 'Repays earlier deficits', col('deficitRecovered')) : '') +
      line('after', 'Available cash after payments', col('availableAfterPayments'), true);
    function total(key, label, w) {
      return '<tr data-doh15-total="' + key + '"><th scope="row">' + esc(label) + '</th><td class="num">' + money(w.first10) + '</td><td class="num">' + money(w.last5) + '</td><td class="num">' + money(w.total) + '</td></tr>';
    }
    return head + reasons([notice], 'doh15-reason') + summary +
      '<details class="doh-years"><summary>Year-by-year rows and totals</summary>' +
      '<div class="table-scroll" role="region" aria-label="DOH 15-year pro forma, year by year" tabindex="0"><table data-role="doh-15" class="doh-wide"><thead><tr><th scope="col">Year</th>' +
      f.rows.map(function (x) { return '<th scope="col" class="num">' + x.year + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="table-scroll" role="region" aria-label="Paid from cash flow over 15 years" tabindex="0"><table data-role="doh-15-totals"><thead><tr><th scope="col">Paid from cash flow</th><th scope="col" class="num">Years 1 to 10</th><th scope="col" class="num">Years 11 to 15</th><th scope="col" class="num">15 years</th></tr></thead><tbody>' +
      total('deferred_fee', 'Deferred developer fee', df.totals) +
      f.loans.map(function (l) { return total(l.label.replace(/\W+/g, '_').toLowerCase(), l.label, l.totals); }).join('') +
      total('asset_fee', 'Asset management fees', f.assetMgmt) + total('bridge', 'Bridge loan debt service', f.bridge) +
      '</tbody></table></div></details></section>';
  }

  // The three views for one result, and what they were drawn from (for the checks).
  var last = null;
  function sections(r, fields) {
    var s = financing(r, fields);
    if (!s) return '';
    var d = schedules(r, s);
    last = { result: r, financing: s, schedules: d };
    return financingSection(s) + activitySection(d.sourcesByActivity) + fifteenSection(d.fifteenYear) + exportButton();
  }

  // ---------- Export CSV ----------
  // The live page's getOutputRecords for a rental deal: the figures a reader acts on, each with its unrounded value,
  // the text the page shows, and the reason when it is unavailable. Read from the engine's result, never the page.
  var NO_LIHTC_CREDITS = 'No LIHTC credits — CHFA allocates all Colorado housing tax credits; this rent setting is not a CHFA LIHTC deal';
  var OUTPUT_PATHS = {
    eligibleBasis: ['eligibleBasis'], annualCredits: ['annualCredits'], creditEquity: ['equity'],
    stateCreditEquity: ['stateEquity'],
    annualRents: ['annualRents'], developerFee: ['devFeeTotal'], deferredDeveloperFee: ['deferredDevFee'],
    stabilizedNoi: ['noi'], mortgageConstant: ['mc', 'percent4'], firstMortgage: ['mortgage'],
    annualDebtService: ['annualDebtService'], dscr: ['baseDSCR', 'ratio'],
    allMustPayDebtService: ['allMustPayDebtService'], allMustPayDscr: ['allMustPayDSCR', 'ratio'],
    breakEvenOccupancy: ['breakEvenOcc', 'percent1'], totalDevelopmentCost: ['tdc'], fundingGap: ['gap'],
    annualOperatingExpenses: ['annualOpex'], annualReserves: ['annualRepReserve'], annualPropertyTax: ['netPropTax'],
    annualSoftDebtService: ['impactDebtService'], exitNoi: ['exit.nNoi'], resaleValue: ['exit.resale'],
    firstMortgageAtExit: ['exit.firstMortBal'], softDebtAtExit: ['exit.softBal'], netExitProceeds: ['exit.netProceeds']
  };
  function outputRecords(result) {
    var records = {};
    Object.keys(OUTPUT_PATHS).forEach(function (key) {
      var path = OUTPUT_PATHS[key][0], style = OUTPUT_PATHS[key][1];
      var value = path.split('.').reduce(function (obj, part) { return obj == null ? null : obj[part]; }, result);
      var reason = result && result.unavailable[path];
      if (typeof value !== 'number' || !isFinite(value)) { value = null; reason = reason || 'The deal calculation is unavailable.'; }
      var display = value == null ? 'Unavailable — ' + reason : style === 'ratio' ? value.toFixed(2) + 'x'
        : style === 'percent4' ? (value * 100).toFixed(4) + '%'
        : style === 'percent1' ? (value * 100).toFixed(1) + '%' : '$' + Math.round(value).toLocaleString('en-US');
      if (value != null && key === 'stabilizedNoi' && !result.dscrAutoMode && value > 0) display += ' (manual)';
      if (result && !result.chfaRegime && ['eligibleBasis', 'annualCredits', 'creditEquity', 'stateCreditEquity'].indexOf(key) !== -1) {
        display = key === 'eligibleBasis' ? 'Not applicable' : NO_LIHTC_CREDITS;
      }
      records[key] = { value: value, display: display, unavailableReason: reason || null };
    });
    // An added credit's results travel with the deal only when one is entered.
    var ac = result && result.costBasis && result.costBasis.addedCredit;
    if (ac) [['addedCreditGrossEquity', ac.gross], ['addedCreditNetNewEquity', ac.net], ['fundingGapWithAddedCredit', ac.gapAfter]].forEach(function (p) {
      var v = Number.isFinite(p[1]) ? p[1] : null;
      var why = v === null ? (ac.reason || 'The funding gap before the added credit is unavailable.') : null;
      records[p[0]] = { value: v, display: v === null ? 'Unavailable — ' + why : (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'), unavailableReason: why };
    });
    return records;
  }
  // The live page's buildCsv: metric, value, display, unavailable_reason.
  function csv(result) {
    function cell(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
    var out = outputRecords(result);
    var rows = [['metric', 'value', 'display', 'unavailable_reason']];
    Object.keys(out).forEach(function (key) { rows.push([key, out[key].value, out[key].display, out[key].unavailableReason]); });
    return rows.map(function (row) { return row.map(cell).join(','); }).join('\r\n') + '\r\n';
  }
  function exportButton() {
    return '<div class="actions doh-export"><button type="button" class="button-link secondary" data-action="outputs-csv">Export the results (CSV)</button>' +
      '<p class="note">The figures above as a table: each result’s unrounded value, the text shown here, and the reason when one is unavailable.</p></div>';
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('button[data-action="outputs-csv"]');
    if (!b || !last) return;
    var url = URL.createObjectURL(new Blob([csv(last.result)], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'deal-calculator-outputs.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  });

  global.LabCalcDoh = { INPUTS: INPUTS, KEYS: KEYS, LENDER_TYPE_OPTIONS: LENDER_TYPE_OPTIONS, defaults: defaults, fill: fill, programChanged: programChanged, engine: engine,
    trancheFields: trancheFields, read: read, financing: financing, schedules: schedules, sections: sections, outputRecords: outputRecords, csv: csv,
    last: function () { return last; } };
})(typeof window !== 'undefined' ? window : globalThis);
