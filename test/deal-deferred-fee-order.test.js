'use strict';
// The deferred developer fee in the Deal Calculator engine, against two rules:
// 1. Payment order: after must-pay debt, the bridge loan and the asset management fee,
//    cash pays the deferred fee, then cash-flow loans share what is left. This is the
//    DOH Proforma tab of CHFA's 2027 Common Application (V9), and the member workbooks.
// 2. Optional limit (dc-deferred-repay-cap): defer no more than cash flow repays in
//    years 1 to 15. CHFA weighs "ability to pay deferred developer fees from cash
//    flows" over the 15-year pro forma (2027-2028 QAP section 2.B, Criteria for Approval,
//    PDF page 15, adopted 25 September 2026). It is a review item, not a numeric limit.
// Invented inputs only.
const assert = require('node:assert/strict');
const { computeDeal, loanObligations } = require('../js/deal-engine');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  PASS ' + name); }
const close = (a, b, msg) => assert(Math.abs(a - b) < 0.01, msg + ': ' + a + ' vs ' + b);

function deal(fields, tranches) {
  const i = inputsFor('A');
  i.fields['dc-grant-outside'] = '0';
  Object.assign(i.fields, fields || {});
  i.tranches = (tranches || []).map((t, n) => Object.assign({ id: n + 1, rate: 0, term: 30, maturity: 30, ioYears: 0,
    loanType: 'cash_flow', cashflowPayPct: 50, priority: 5 + n, fundSource: 'nonfederal' }, t));
  return i;
}
const doh = [{ program: 'doh_htf', amount: 1000000, mode: 'loan' }];

console.log('Deferred developer fee: payment order and 15-year limit');

test('loanObligations pays the deferred fee before a cash-flow loan takes its share', () => {
  const o = loanObligations([{ id: 'doh', loanType: 'cash_flow', amount: 1000000, rate: 0, term: 30, maturity: 30, priority: 5, cashflowPayPct: 50 }],
    Array(50).fill(100000), Array(50).fill({ bridge: 0, assetFee: 0 }), 250000);
  close(o.years[0].deferredFeePaid, 100000, 'year 1: all cash goes to the fee');
  close(o.loans[0].rows[0].paid, 0, 'year 1: nothing left for the cash-flow loan');
  close(o.years[2].deferredFeePaid, 50000, 'year 3 pays off the fee');
  close(o.loans[0].rows[2].paid, 25000, 'and the loan takes 50% of the rest');
  assert.equal(o.years[2].deferredFeeOwed, 0, 'fee paid off in year 3');
  close(o.years[0].cashBeforeFee, 100000, 'cash before the fee is reported');
});

test('without a fee the cash-flow loan is paid as before', () => {
  const o = loanObligations([{ id: 'doh', loanType: 'cash_flow', amount: 1000000, rate: 0, term: 30, maturity: 30, priority: 5, cashflowPayPct: 50 }],
    Array(50).fill(100000), Array(50).fill({ bridge: 0, assetFee: 0 }));
  close(o.loans[0].rows[0].paid, 50000, 'half of the cash');
  close(o.years[0].deferredFeePaid, 0, 'no fee');
});

test('computeDeal: the fee comes first, so the DOH loan is paid less while the fee is owed', () => {
  const r = computeDeal(deal({}, doh));
  assert(r.deferredDevFee > 0, 'a fee is deferred');
  const y1 = r.obligations.years[0], loan = r.obligations.loans[1].rows[0];
  close(y1.deferredFeePaid, Math.min(y1.cashBeforeFee, r.deferredDevFee), 'year 1 fee takes the cash first');
  close(loan.paid, Math.max(0, y1.cashBeforeFee - y1.deferredFeePaid) * 0.5, 'the DOH loan takes 50% of what is left');
  close(r.projection.rows[0].deferredFeePaid, y1.deferredFeePaid, 'the projection shows the same fee payment');
  if (r.exit.dfYr) assert.equal(r.obligations.years[r.exit.dfYr - 1].deferredFeeOwed, 0, 'payback year is the year the fee is paid off');
});

test('the 15-year limit is off unless asked for, and on it defers no more than years 1 to 15 repay', () => {
  const off = computeDeal(deal({ 'dc-deferred-pct': '100' }, doh));
  const on = computeDeal(deal({ 'dc-deferred-pct': '100', 'dc-deferred-repay-cap': true }, doh));
  assert.equal(off.deferredRepayCap.on, false);
  assert.equal(on.deferredRepayCap.on, true);
  assert(on.deferredRepayCap.repayable > 0, 'repayable cash is measured');
  assert(on.deferredDevFee <= on.deferredRepayCap.repayable + 0.01, 'deferral within what 15 years repay');
  assert(on.deferredDevFee <= off.deferredDevFee + 0.01, 'never more than without the limit');
  if (on.deferredDevFee > 0) {
    const owed15 = on.obligations.years[14].deferredFeeOwed;
    close(owed15, 0, 'the fee is repaid by year 15');
  }
  if (on.deferredRepayCap.binds) {
    close(on.gap - off.gap, off.deferredDevFee - on.deferredDevFee, 'the fee that cannot be repaid becomes gap');
  }
});

test('a limit that binds moves the fee it cuts into credit equity or gap, never lost', () => {
  // A large asset management fee keeps repayable cash below a 100% deferral.
  const base = { 'dc-deferred-pct': '100', 'dc-asset-mgmt-fee': '60000' };
  const off = computeDeal(deal(base));
  const on = computeDeal(deal(Object.assign({ 'dc-deferred-repay-cap': true }, base)));
  assert(on.deferredRepayCap.binds, 'the limit binds: repayable ' + on.deferredRepayCap.repayable + ' vs slider ' + on.deferredRepayCap.bySlider);
  close(on.deferredDevFee, on.deferredRepayCap.repayable, 'defers exactly what 15 years repay');
  const cut = off.deferredDevFee - on.deferredDevFee;
  assert(cut > 0, 'less fee deferred');
  close((on.gap - off.gap) + (on.equity - off.equity), cut, 'the cut is made up by more credit equity (Method Two) or more gap');
  close(on.obligations.years[14].deferredFeeOwed, 0, 'repaid by year 15');
  assert(off.obligations.years[14].deferredFeeOwed > 0, 'without the limit, fee is still owed after year 15');
});

test('manual NOI has no yearly projection, so the limit says why it cannot apply', () => {
  const r = computeDeal(deal({ 'dc-deferred-repay-cap': true, 'dc-auto-noi': false, 'dc-noi': '150000' }));
  assert.equal(r.deferredRepayCap.repayable, null);
  assert(/unknown/.test(r.deferredRepayCap.reason), r.deferredRepayCap.reason);
  close(r.deferredRepayCap.bySlider, r.deferredCap, 'the slider cap stands');
});

test('a cash-flow loan that matures inside 15 years: repayment is checked on the final schedule, not assumed', () => {
  const r = computeDeal(deal({ 'dc-deferred-pct': '100', 'dc-asset-mgmt-fee': '60000', 'dc-deferred-repay-cap': true },
    [{ program: 'doh_htf', amount: 10000, mode: 'loan', cashflowPayPct: 100, term: 5, maturity: 5 }]));
  assert(r.deferredRepayCap.binds, 'the limit binds');
  assert.equal(r.deferredRepayCap.owedAfter, null, 'the final schedule cannot reach year 15');
  assert(/not confirmed/.test(r.deferredRepayCap.reason), 'and says so: ' + r.deferredRepayCap.reason);
  const ok = computeDeal(deal({ 'dc-deferred-pct': '100', 'dc-asset-mgmt-fee': '60000', 'dc-deferred-repay-cap': true }));
  assert.equal(ok.deferredRepayCap.owedAfter, 0, 'without that loan, repayment by year 15 is confirmed');
  assert.equal(ok.deferredRepayCap.reason, null);
});

console.log('deal-deferred-fee-order: ' + passed + ' checks passed');
