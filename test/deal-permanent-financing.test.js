#!/usr/bin/env node
'use strict';
// DOH PR 3: permanent financing in the Division of Housing layout. The groups
// must add back to the engine's own sources (TDC = total sources + gap), never
// to numbers copied here. All deal figures are the INVENTED A/B scenarios.
const assert = require('node:assert/strict');
const pf = require('../js/deal-permanent-financing.js');
const { computeDeal } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}
const close = (a, b, msg) => assert(Math.abs(a - b) < 0.01, msg + ': ' + a + ' vs ' + b);
function withTranches(scenario, list) {
  const i = inputsFor(scenario);
  i.fields['dc-grant-outside'] = '0'; // the HOME grant paid only for basis costs
  i.tranches = list.map((t, n) => Object.assign({ id: n + 1, rate: 3, term: 30, maturity: 30, ioYears: 0,
    loanType: 'amortizing', cashflowPayPct: 100, priority: 5 + n, fundSource: t.program === 'home' ? 'federal' : 'nonfederal' }, t));
  return i;
}
const STACK = [
  { program: 'chfa_htf', amount: 1000000, mode: 'loan' },
  { program: 'home', amount: 500000, mode: 'grant' },
  { program: 'seller_carry', amount: 250000, mode: 'loan', loanType: 'accrue_defer' },
  { program: 'sponsor_loan', amount: 300000, mode: 'loan', loanType: 'accrue_defer' },
  { program: 'historic_tc', amount: 400000, mode: 'grant' }
];

console.log('Deal Calculator permanent financing (DOH PR 3)');

test('every program has a DOH group or is left for the user, and historic credit is tax credit equity', () => {
  assert.equal(pf.defaultGroup('prop123'), 'government');
  assert.equal(pf.defaultGroup('sponsor_loan'), 'owner');
  assert.equal(pf.defaultGroup('seller_carry'), 'other');
  assert.equal(pf.defaultGroup('other'), '', 'Other / custom is not guessed');
  assert.equal(pf.trancheGroup({ program: 'historic_tc', doh: 'government', mode: 'grant' }).group, 'historic');
  assert.match(pf.trancheGroup({ program: 'other', doh: '', mode: 'loan' }).reason, /Choose where/);
  assert.match(pf.trancheGroup({ program: 'other', doh: 'hard_T', mode: 'grant' }).reason, /not a hard mortgage/);
  assert.deepEqual(pf.LENDER_TYPES.map(t => t.id), ['C', 'T', 'F']);
});

test('the groups add back to the engine: total sources + gap = TDC, and no dollar is counted twice', () => {
  for (const scenario of ['A', 'B']) {
    const r = computeDeal(withTranches(scenario, STACK));
    assert(Number.isFinite(r.gap) && Number.isFinite(r.mortgage) && r.mortgage > 0, scenario + ': non-vacuous engine result');
    const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C' });
    const t = s.totals;
    close(t.totalSources + t.gap, r.tdc, scenario + ': total sources plus gap is TDC');
    close(t.totalSources, r.equity + r.stateEquity + r.mortgage + r.totalGrant + r.totalLoanPrincipal + r.deferredDevFee, scenario + ': the engine\'s own sources');
    close(t.conventional, r.mortgage, scenario + ': first mortgage is the conventional row');
    close(t.government, 1500000, scenario + ': CHFA HTF loan and HOME grant');
    close(t.otherGrants, 250000, scenario + ': seller note');
    close(t.ownerEquity, r.deferredDevFee + 300000, scenario + ': deferred fee and sponsor loan');
    close(t.taxCredits, r.equity + r.stateEquity + 400000, scenario + ': federal, state and historic credit equity');
    assert.equal(s.taxCredit.nine, r.equity, 'a 9% deal fills the 9% row');
    assert.equal(s.taxCredit.four, 0);
  }
});

test('a tranche marked a hard mortgage becomes the second mortgage, with its own type and cumulative DCR', () => {
  const list = STACK.slice(); list[0] = Object.assign({}, list[0], { doh: 'hard_T' });
  const r = computeDeal(withTranches('A', list));
  const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'F' });
  assert.equal(s.hardMortgages.length, 2);
  assert.equal(s.hardMortgages[1].label, 'Second mortgage');
  close(s.totals.taxExempt, 1000000, 'the tranche is the tax-exempt row');
  close(s.totals.federalFinancing, r.mortgage, 'the first mortgage is typed Federal');
  assert.equal(s.totals.conventional, 0);
  close(s.totals.government, 500000, 'only the HOME grant is left as government');
  close(s.totals.totalSources + s.totals.gap, r.tdc, 'still adds to TDC');
  const first = s.hardMortgages[0], second = s.hardMortgages[1];
  close(first.annualPayment, r.mortgage * r.mc, 'an amortizing first mortgage pays its rate and term');
  close(first.annualPayment, r.annualDebtService, 'the engine\'s own first-year senior payment');
  close(first.cumulativeDcr, r.noi / first.annualPayment, 'DCR on the first mortgage');
  close(second.cumulativeDcr, r.noi / (first.annualPayment + second.annualPayment), 'DCR through the second is cumulative');
  close(s.dcr, second.cumulativeDcr, 'all hard debt');
  close(s.possibleDebtService, r.noi / 1.15, 'DOH\'s possible debt service at 1.15');
});

test('the first mortgage payment follows its repayment type, not the amortizing constant', () => {
  const io = withTranches('A', STACK); io.fields['dc-senior-type'] = 'interest_only';
  const r = computeDeal(io);
  const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C' });
  assert(r.mortgage > 0 && Number.isFinite(r.annualDebtService), 'a real interest-only result');
  assert(Math.abs(r.annualDebtService - r.mortgage * r.mc) > 1, 'interest only differs from amortizing');
  close(s.hardMortgages[0].annualPayment, r.annualDebtService, 'interest-only payment');
  const deferred = withTranches('A', STACK); deferred.fields['dc-senior-type'] = 'accrue_defer';
  const d = computeDeal(deferred);
  const ds = pf.summarize({ result: d, tranches: d.tranches, seniorLenderType: 'C' });
  if (d.annualDebtService === null) assert.equal(ds.hardMortgages[0].annualPayment, null, 'unknown stays unknown');
  else { assert.equal(ds.hardMortgages[0].annualPayment, d.annualDebtService); assert.equal(ds.hardMortgages[0].cumulativeDcr, d.annualDebtService > 0 ? d.noi / d.annualDebtService : null); }
});

test('a cash-flow or deferred loan cannot be a hard mortgage: it is held apart with a reason', () => {
  for (const loanType of ['cash_flow', 'accrue_defer', 'forgivable']) {
    const list = STACK.slice(); list[0] = Object.assign({}, list[0], { doh: 'hard_C', loanType, cashflowPayPct: 50 });
    const r = computeDeal(withTranches('A', list));
    const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C' });
    assert.equal(s.hardMortgages.length, 1, loanType + ': only the first mortgage is hard');
    assert.equal(s.unclassified.length, 1, loanType);
    assert.match(s.unclassified[0].reason, /not a hard mortgage/);
    close(s.totals.totalSources + s.totals.gap, r.tdc, loanType + ': still counted in total sources');
  }
  const io = STACK.slice(); io[0] = Object.assign({}, io[0], { doh: 'hard_C', loanType: 'interest_only' });
  const r = computeDeal(withTranches('A', io));
  const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C' });
  assert.equal(s.hardMortgages.length, 2, 'an interest-only loan is must-pay');
  close(s.hardMortgages[1].annualPayment, 1000000 * 0.03, 'interest only at 3%');
});

test('a cash-flow, deferred or forgivable senior loan is held apart too, and still counted', () => {
  for (const type of ['cash_flow', 'accrue_defer', 'forgivable']) {
    const i = withTranches('A', STACK);
    Object.assign(i.fields, { 'dc-senior-mode': 'entered', 'dc-senior-amount': '3000000', 'dc-senior-type': type, 'dc-senior-cfpay': '50', 'dc-senior-maturity': '30' });
    const r = computeDeal(i);
    assert(r.obligations && r.obligations.loans, type + ': the engine built a schedule');
    const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C' });
    assert.equal(s.hardMortgages.length, 0, type + ': no hard mortgage');
    assert.equal(s.totals.conventional, 0, type + ': not in the conventional row');
    const held = s.unclassified.find(u => u.source === 'senior');
    assert(held && /not a hard mortgage/.test(held.reason), type);
    close(held.amount, r.mortgage, type + ': its principal is held apart');
    assert(Number.isFinite(s.totals.gap), type + ': a finite result');
    close(s.totals.totalSources + s.totals.gap, r.tdc, type + ': and still counted once');
    assert.equal(s.hardDebt, 0, type + ': no hard debt to compare with a maximum loan');
  }
  const list = STACK.slice(); list[0] = Object.assign({}, list[0], { doh: 'hard_T' });
  const i = withTranches('A', list);
  Object.assign(i.fields, { 'dc-senior-mode': 'entered', 'dc-senior-amount': '3000000', 'dc-senior-type': 'accrue_defer', 'dc-senior-maturity': '30' });
  const r = computeDeal(i);
  const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C' });
  assert.equal(s.hardMortgages[0].label, 'First mortgage', 'a must-pay tranche becomes the first hard mortgage');
});

test('an ungrouped or untyped source is unknown with a reason, and still counts in total sources', () => {
  const list = STACK.concat([{ program: 'other', amount: 50000, mode: 'grant' }]);
  const r = computeDeal(withTranches('A', list));
  const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: '' });
  assert.equal(s.unclassified.length, 1);
  close(s.totals.unclassified, 50000, 'held apart');
  close(s.totals.totalSources + s.totals.gap, r.tdc, 'and still counted');
  assert(s.reasons.some(x => /Choose where/.test(x)) && s.reasons.some(x => /first mortgage/.test(x)));
  assert.equal(s.totals.conventional, 0, 'an untyped first mortgage is not guessed into a type');
});

test('an unknown engine figure stays unknown, never $0', () => {
  const r = computeDeal(withTranches('A', [{ program: 'home', amount: '', mode: 'grant' }]));
  const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C' });
  assert.equal(s.totals.government, null, 'a blank amount is unknown');
  assert.equal(s.totals.totalSources, null);
  const blank = pf.summarize({ result: { mortgage: NaN, noi: null, gap: NaN, tdc: 0 }, tranches: [], seniorLenderType: 'C' });
  assert.equal(blank.totals.conventional, null);
  assert.equal(blank.totals.tdc, null);
  assert.equal(blank.dcr, null);
  assert.equal(blank.possibleDebtService, null);
});

test('maximum loan by value: NOI over a cap rate, or an appraised value, times LVR; blank is skipped with a reason', () => {
  const m = pf.maxLoanChecks({ noi: 650000, capRatePct: '6.5', capLvrPct: '80', appraisedValue: '9000000', appraisedLvrPct: '75' });
  close(m.byCap.value, 10000000, 'value at cap');
  close(m.byCap.maxLoan, 8000000, 'times LVR');
  close(m.byAppraisal.maxLoan, 6750000, 'appraised times LVR');
  const none = pf.maxLoanChecks({ noi: 650000, capRatePct: '', capLvrPct: '', appraisedValue: '', appraisedLvrPct: '' });
  assert.equal(none.byCap.maxLoan, null); assert.match(none.byCap.reason, /Enter a cap rate/);
  assert.equal(none.byAppraisal.maxLoan, null); assert.match(none.byAppraisal.reason, /Enter an appraised value/);
  assert.match(pf.maxLoanChecks({ noi: 650000, capRatePct: '0', capLvrPct: '80' }).byCap.reason, /above 0%/);
  assert.match(pf.maxLoanChecks({ noi: null, capRatePct: '6', capLvrPct: '80' }).byCap.reason, /NOI is not available/);
  const lossMaking = pf.summarize({ result: { mortgage: 0, mc: 0.07, annualDebtService: 0, noi: -5000, gap: 0, tdc: 1 }, tranches: [], seniorLenderType: 'C' });
  assert.equal(lossMaking.possibleDebtService, null, 'negative NOI supports no debt service');
  assert(lossMaking.reasons.some(x => /supports no debt service/.test(x)));
  const view = pf.exportView(lossMaking);
  assert.equal(JSON.parse(JSON.stringify(view)).possibleDebtService, null, 'the export view is JSON-safe');
  const negative = pf.maxLoanChecks({ noi: -5000, capRatePct: '6', capLvrPct: '80' }).byCap;
  assert.equal(negative.maxLoan, null); assert.match(negative.reason, /\$0 or less/);
  assert.equal(pf.summarize({ result: { mortgage: 0, mc: 0.07, annualDebtService: 0, noi: -5000, gap: 0, tdc: 1 }, tranches: [], seniorLenderType: 'C', capRatePct: '6', capLvrPct: '80' }).overMaxLoan, null,
    'no limit from a negative NOI, so nothing is reported above it');
  const r = computeDeal(withTranches('A', STACK));
  const s = pf.summarize({ result: r, tranches: r.tranches, seniorLenderType: 'C', capRatePct: '6.5', capLvrPct: '50', appraisedValue: '', appraisedLvrPct: '' });
  close(s.overMaxLoan, Math.max(0, r.mortgage - (r.noi / 0.065) * 0.5), 'hard debt above the lower maximum');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
