/**
 * submittal-tieout.js — the application tie-out on the gated Submittal review page
 * (developer-submittal-review.html): each figure typed from the CHFA application
 * sits beside the same figure from the Deal Calculator export, with a flag.
 *
 *   green   matches within the figure's tolerance
 *   yellow  differs: fix the application or re-run the model before it goes in
 *   red     the application figure breaks a rule (QAP 3.M.1 credit amount, 3.M.3
 *           developer fee limit, 3.D debt coverage minimum, sources not equal to uses)
 *
 * Limits come from the round's rules file (data/policy/chfa-2027-r*-scoring.json,
 * "tie_out" and "underwriting"), each with its QAP quote and page. The model
 * figures are the export's own; js/deal-engine.js is not run or changed here.
 * Application figures are saved with the version through /api/deals (coho-backend).
 *
 * window.SubmittalTieOut in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubmittalTieOut = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) { return v == null ? '—' : (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  var FMT = {
    money: money,
    count: function (v) { return v == null ? '—' : String(Math.round(v)); },
    price: function (v) { return v == null ? '—' : '$' + v.toFixed(2); },
    ratio: function (v) { return v == null ? '—' : v.toFixed(2) + 'x'; }
  };

  // One row per figure the application states. model: the key in the version's engine results (from the
  // calculator export), or null for figures only the application has (they feed the developer fee limit).
  // tol: within pct of the model, or within abs, the two match.
  var ROWS = [
    { id: 'homes', label: 'Total homes', kind: 'count', model: 'units', tol: { abs: 0 } },
    { id: 'tdc', label: 'Total development cost', kind: 'money', model: 'totalDevelopmentCost', tol: { pct: 0.01 } },
    { id: 'basis', label: 'Eligible basis', kind: 'money', model: 'eligibleBasis', tol: { pct: 0.01 } },
    { id: 'credit', label: 'Annual federal credit requested', kind: 'money', model: 'annualCredits', tol: { pct: 0.01 }, rule: 'credit' },
    { id: 'price', label: 'Equity price per credit dollar', kind: 'price', model: 'equityPrice', tol: { abs: 0.01 } },
    { id: 'equity', label: 'Federal credit equity', kind: 'money', model: 'creditEquity', tol: { pct: 0.01 } },
    { id: 'stateEquity', label: 'State credit equity', kind: 'money', model: 'stateCreditEquity', tol: { pct: 0.01 } },
    { id: 'mortgage', label: 'First mortgage', kind: 'money', model: 'firstMortgage', tol: { pct: 0.01 } },
    { id: 'debtService', label: 'First mortgage annual debt service', kind: 'money', model: 'annualDebtService', tol: { pct: 0.01 } },
    { id: 'dscr', label: 'Lowest must-pay debt coverage, years 1 to 15', kind: 'ratio', model: 'dscr', tol: { abs: 0.02 }, rule: 'dscr' },
    { id: 'fee', label: 'Developer fee', kind: 'money', model: 'developerFee', tol: { pct: 0.01 }, rule: 'fee' },
    { id: 'consultant', label: 'Consultant fee (0 if none)', kind: 'money', model: null, feeInput: true },
    { id: 'deferred', label: 'Deferred developer fee', kind: 'money', model: 'deferredDeveloperFee', tol: { pct: 0.01, abs: 1000 } },
    { id: 'land', label: 'Land', kind: 'money', model: null, feeInput: true },
    { id: 'acquisition', label: 'Building acquisition (0 if none)', kind: 'money', model: null, feeInput: true },
    { id: 'reserves', label: 'Reserves paid from development sources (operating, lease-up and others)', kind: 'money', model: null, feeInput: true },
    { id: 'rents', label: 'Year-one rents, before vacancy', kind: 'money', model: 'annualRents', tol: { pct: 0.02 } },
    { id: 'opex', label: 'Year-one operating expenses, before taxes and replacement reserve', kind: 'money', model: 'annualOperatingExpenses', tol: { pct: 0.02 } },
    { id: 'repReserve', label: 'Annual replacement reserve', kind: 'money', model: 'annualReserves', tol: { pct: 0.02 } },
    { id: 'gap', label: 'Funding gap: uses minus sources', kind: 'money', model: 'fundingGap', rule: 'balance' }
  ];

  function within(app, model, tol) {
    var room = Math.max(tol.abs || 0, (tol.pct || 0) * Math.abs(model));
    return Math.abs(app - model) <= room + 1e-9;
  }
  function differs(row, app, model) {
    var d = app - model, f = FMT[row.kind];
    var pct = model ? ' (' + Math.abs(d / model * 100).toFixed(1) + '%)' : '';
    return 'The application is ' + (row.kind === 'count' ? Math.abs(d) + ' ' + (Math.abs(d) === 1 ? 'home' : 'homes') : f(Math.abs(d)) + pct) + ' ' + (d > 0 ? 'higher' : 'lower') +
      ' than the model. Fix the application or re-run the Deal Calculator before it goes in.';
  }

  // QAP 3.M.3: developer plus consultant fee, against a percentage of total cost less land, half of acquisition
  // (none off for projects serving people experiencing homelessness or special populations), the fees and reserves.
  function feeLimit(rules, app, units, deal) {
    var r = rules.tie_out && rules.tie_out.developer_fee;
    if (!r) return { status: 'none' };
    var need = ['tdc', 'fee', 'land', 'reserves'].filter(function (k) { return app[k] == null; });
    if (need.length) return { status: 'open', need: need };
    if (deal.rehab && app.acquisition == null) return { status: 'open', need: ['acquisition'] };
    if (units == null || units <= 0) return { status: 'open', need: ['homes'] };
    var fee = app.fee + (app.consultant || 0);
    var acqOff = deal.supportive ? 0 : 0.5 * (app.acquisition || 0);
    var base = app.tdc - app.land - acqOff - fee - app.reserves;
    var tier = r.tiers.filter(function (t) { return units >= t.min_units && (t.max_units == null || units <= t.max_units); })[0];
    if (!(base > 0) || !tier) return { status: 'open', need: [] };
    var limit = base * tier.pct, boosted = base * (tier.pct + (r.boost_max_pct || 0));
    var status = fee <= limit + 0.5 ? 'ok' : deal.supportive && fee <= boosted + 0.5 ? 'boost' : 'over';
    return { status: status, fee: fee, base: base, pct: tier.pct, limit: limit, boosted: boosted, acquisitionOff: acqOff };
  }

  // v: a saved version (deal, tieout, calculator); eng: its model results, {} when the export is stale or absent.
  function check(rules, v, eng) {
    var t = v.tieout || {}, entered = t.app || {}, refs = t.ref || {}, deal = v.deal || {};
    var app = {};
    ROWS.forEach(function (row) { app[row.id] = num(entered[row.id]); });
    var calcMix = v.calculator && v.calculator.mix, mix = calcMix || deal.mix || {};
    var units = Object.keys(mix).reduce(function (s, k) { return s + (num(mix[k]) || 0); }, 0);
    var model = function (key) {
      if (key === 'units') return units > 0 ? units : null;
      return num(eng && eng[key]);
    };
    var dcr = rules.underwriting, credit = rules.tie_out && rules.tie_out.credit_amount, feeRule = rules.tie_out && rules.tie_out.developer_fee;
    var fl = feeLimit(rules, app, app.homes != null ? app.homes : model('units'), deal);
    var rows = ROWS.map(function (row) {
      var a = app[row.id], m = row.model ? model(row.model) : null;
      var out = { id: row.id, label: row.label, kind: row.kind, app: a, model: m, ref: refs[row.id] || '', flag: 'open', notes: [], feeInput: !!row.feeInput };
      if (row.feeInput) {
        out.flag = a == null ? 'open' : 'info';
        return out;
      }
      if (a == null) { out.notes.push('Not entered.'); return out; }
      if (m == null) {
        out.flag = 'info';
        out.notes.push(row.model && eng && eng[row.model + 'Reason'] ? 'No model figure: ' + eng[row.model + 'Reason'] : 'No model figure: load a Deal Calculator export that has it.');
      } else if (row.tol) {
        out.flag = within(a, m, row.tol) ? 'green' : 'yellow';
        out.notes.push(out.flag === 'green' ? 'Matches the model.' : differs(row, a, m));
      }
      if (row.rule === 'credit' && m != null && a > m && !within(a, m, row.tol)) {
        out.flag = 'red';
        out.notes = ['The application asks for ' + money(a - m) + ' a year more than the model supports. CHFA reserves the smallest of its three credit calculations (QAP ' + credit.section.split(',')[0] + ', p. ' + credit.page + '), so plan on the lower amount and close the rest of the gap another way.'];
      }
      if (row.rule === 'dscr' && dcr && a < dcr.dcr_min) {
        out.flag = 'red';
        out.notes.unshift('Under CHFA\'s ' + dcr.dcr_min.toFixed(2) + ' minimum (QAP ' + dcr.section.split(',')[0] + ', p. ' + dcr.page + ').');
      }
      if (row.rule === 'fee' && feeRule) {
        var where = ' (QAP ' + feeRule.section.split(',')[0] + ', p. ' + feeRule.page + ')';
        if (fl.status === 'over') { out.flag = 'red'; out.notes.unshift('Developer and consultant fee ' + money(fl.fee) + ' is over the ' + Math.round(fl.pct * 100) + '% limit of ' + money(fl.limit) + where + '. CHFA cuts eligible basis by the excess.'); }
        else if (fl.status === 'boost') { if (out.flag !== 'red') out.flag = 'yellow'; out.notes.unshift('Developer and consultant fee ' + money(fl.fee) + ' is over the ' + Math.round(fl.pct * 100) + '% limit of ' + money(fl.limit) + ' and within the ' + money(fl.boosted) + ' allowed only with the supportive housing increase, which is pro-rated by the share of homes serving people experiencing homelessness or special populations and must be committed to services or rental subsidy' + where + '.'); }
        else if (fl.status === 'ok') out.notes.push('Within the ' + Math.round(fl.pct * 100) + '% fee limit of ' + money(fl.limit) + where + '.');
        else if (fl.status === 'open') out.notes.push('Enter ' + (fl.need.length ? fl.need.map(function (k) { return ROWS.filter(function (r) { return r.id === k; })[0].label.replace(/ \(.*\)$/, '').toLowerCase(); }).join(', ') : 'total development cost above the fees, land and reserves') + ' to test the fee limit' + where + '.');
      }
      if (row.rule === 'balance') {
        if (Math.abs(a) > 1) { out.flag = 'red'; out.notes = ['Sources do not equal uses in the application: ' + money(Math.abs(a)) + ' ' + (a > 0 ? 'short' : 'over') + '. CHFA needs a balanced sources and uses.']; }
        else if (m != null && m > 1000) { out.flag = 'yellow'; out.notes = ['The application balances, but the model still shows a ' + money(m) + ' gap. Put the sources that close it into the Deal Calculator.']; }
        else { out.flag = 'green'; out.notes = ['Sources equal uses.']; }
      }
      return out;
    });
    var counts = { red: 0, yellow: 0, green: 0, entered: 0 };
    rows.forEach(function (r) { if (r.flag in counts) counts[r.flag]++; if (r.app != null) counts.entered++; });
    return { rows: rows, counts: counts, fee: fl };
  }

  // What the review's "What to decide" list gets: each red row, and one line for the yellow ones.
  function risks(res) {
    var out = [];
    res.rows.forEach(function (r) { if (r.flag === 'red') out.push({ level: 'red', text: 'Tie-out, ' + r.label.toLowerCase() + ': ' + r.notes[0] }); });
    var y = res.rows.filter(function (r) { return r.flag === 'yellow'; });
    if (y.length) out.push({ level: 'yellow', text: y.length + ' application figure' + (y.length > 1 ? 's differ' : ' differs') + ' from the model: ' + y.map(function (r) { return r.label.toLowerCase(); }).join(', ') + '. See the tie-out.' });
    return out;
  }

  function countsText(res) {
    var c = res.counts;
    if (!c.entered) return 'not entered';
    return c.red + ' red, ' + c.yellow + ' yellow, ' + c.green + ' green';
  }

  var FLAG_LABEL = { red: 'Deal breaker', yellow: 'Differs', green: 'Matches', info: 'Noted', open: 'Not entered' };

  // The inputs, built once from ROWS; draw() fills the model figure and flag beside each.
  function formHtml() {
    return ROWS.map(function (row) {
      return '<div class="sr-tie" id="sr-tie-row-' + row.id + '">' +
        '<label for="sr-tie-' + row.id + '">' + esc(row.label) + '</label>' +
        '<input type="number" step="any" inputmode="decimal" id="sr-tie-' + row.id + '" data-tie="' + row.id + '" aria-describedby="sr-tie-out-' + row.id + '">' +
        '<input type="text" class="sr-ref" data-tieref="' + row.id + '" maxlength="200" placeholder="Tab and cell, or page" aria-label="Where in the application: ' + esc(row.label) + '">' +
        '<p class="sr-tie-out" id="sr-tie-out-' + row.id + '"></p></div>';
    }).join('');
  }

  function outHtml(r) {
    var f = FMT[r.kind];
    // A missing model figure is explained in the note, so "Model: —" is not repeated beside it.
    var model = r.feeInput ? 'Application only; used for the developer fee limit.' : r.model == null && r.app != null ? '' : 'Model: ' + f(r.model) + '.';
    return '<span class="sr-tie-flag sr-tie-' + r.flag + '">' + esc(FLAG_LABEL[r.flag]) + '</span>' + (model ? ' ' + esc(model) : '') +
      (r.notes.length && r.flag !== 'open' ? ' ' + esc(r.notes.join(' ')) : '');
  }

  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    var t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function csv(res) {
    var head = ['Figure', 'Application', 'Where in the application', 'Model', 'Flag', 'Note'];
    return [head].concat(res.rows.map(function (r) {
      return [r.label, r.app, r.ref, r.model, FLAG_LABEL[r.flag], r.notes.join(' ')];
    })).map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  return { ROWS: ROWS, FLAG_LABEL: FLAG_LABEL, check: check, feeLimit: feeLimit, risks: risks, countsText: countsText, formHtml: formHtml, outHtml: outHtml, csv: csv };
});
