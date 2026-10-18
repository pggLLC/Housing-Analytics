#!/usr/bin/env node
'use strict';
// DOH PR 4: sources and uses by activity, and the 15-year pro forma rows. Both
// must agree with the engine's own result (sources add back to its total
// sources and gap; the deferred fee repays in its payback year), never with
// numbers copied here. All deal figures are the INVENTED A/B scenarios.
const assert = require('node:assert/strict');
const ds = require('../js/deal-doh-schedules.js');
const pf = require('../js/deal-permanent-financing.js');
const costBasis = require('../js/deal-cost-basis.js');
const { computeDeal, loanObligations } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}
const close = (a, b, msg) => assert(Math.abs(a - b) < 0.01, msg + ': ' + a + ' vs ' + b);
function withTranches(list, fields) {
  const i = inputsFor('A');
  i.fields['dc-grant-outside'] = '0';
  Object.assign(i.fields, fields || {});
  i.tranches = list.map((t, n) => Object.assign({ id: n + 1, rate: 3, term: 30, maturity: 30, ioYears: 0,
    loanType: 'amortizing', cashflowPayPct: 100, priority: 5 + n, fundSource: 'nonfederal' }, t));
  return i;
}
function views(inputs) {
  const r = computeDeal(inputs);
  const s = pf.summarize({ result: r, tranches: r.tranches || [], seniorLenderType: 'C' });
  return { r, s, su: ds.sourcesByActivity({ costSummary: r.costBasis.summary, financing: s, tranches: r.tranches, labels: pf.PROGRAM_LABELS }) };
}
const STACK = [
  { program: 'prop123', amount: 600000, mode: 'loan', loanType: 'accrue_defer', activity: 'construction', status: 'committed' },
  { program: 'chfa_htf', amount: 400000, mode: 'loan', activity: 'construction' },
  { program: 'dola_htf', amount: 250000, mode: 'grant' },
  { program: 'seller_carry', amount: 150000, mode: 'loan', loanType: 'accrue_defer', activity: 'acquisition', stateRequest: true }
];

console.log('Deal Calculator sources by activity and 15-year rows (DOH PR 4)');

test('the nine activities are the cost categories, and DOLA HTF and Prop 123 are state requests by default', () => {
  assert.deepEqual(ds.ACTIVITIES.map(a => a.id), costBasis.GROUPS.map(g => g.id));
  assert.equal(ds.stateRequest({ program: 'prop123' }), true);
  assert.equal(ds.stateRequest({ program: 'dola_htf' }), true);
  assert.equal(ds.stateRequest({ program: 'chfa_htf' }), false);
  assert.equal(ds.stateRequest({ program: 'chfa_htf', stateRequest: true }), true, 'the user can say otherwise');
  assert.equal(ds.stateRequest({ program: 'prop123', stateRequest: false }), false);
});

test('each source lands in the activity it pays for, and the table adds back to the engine\'s sources and gap', () => {
  const { r, s, su } = views(withTranches(STACK));
  const row = id => su.rows.find(x => x.id === id);
  close(row('construction').cost, r.costBasis.summary.groups.construction, 'cost is the category\'s cost');
  close(row('construction').state, 600000, 'Prop 123 is a state request');
  close(row('construction').other, 400000, 'CHFA HTF is other funds');
  assert.deepEqual(row('construction').sources.map(e => [e.name, e.status]), [['Prop 123', 'committed'], ['CHFA HTF', 'pending']]);
  close(row('acquisition').state, 150000, 'a source the user marks as a state request counts as state funds');
  close(su.general.state, 250000, 'an unassigned state request stays a state request');
  assert(su.general.sources.some(e => e.name === 'DOLA HTF'));
  assert.deepEqual(su.general.sources.slice(0, 3).map(e => e.id), ['senior', 'lihtc9', 'deferred_fee']);
  close(su.totals.state, 1000000, 'state funds in total');
  close(su.totals.sources, s.totals.totalSources, 'every source is counted once');
  close(su.totals.cost, r.tdc, 'the activities and the unitemized rest are TDC');
  close(su.totals.gap, r.gap, 'the gap is the engine\'s');
  close(su.totals.sources + su.totals.gap, r.tdc, 'sources plus gap is TDC');
  assert.deepEqual(su.reasons, []);
});

test('assigning more to an activity than it costs is flagged; an unknown cost stays null with its reason', () => {
  let { su } = views(withTranches([{ program: 'chfa_htf', amount: 900000, mode: 'loan', activity: 'reserves' }]));
  assert.match(su.rows.find(x => x.id === 'reserves').reason, /more than its cost/);
  const i = withTranches(STACK);
  i.costLines = i.costLines.map(l => l.id === 'land' ? Object.assign({}, l, { amount: '-5' }) : l);
  su = views(i).su;
  assert(su.rows.every(x => x.cost === null && x.reason), 'no category cost when the cost lines are invalid');
  assert.equal(su.totals.cost, null);
  assert.match(su.reasons[0], /Enter a cost of \$0 or more/);
});

test('the 15-year rows are the engine\'s projection, and cash after payments reconciles to its cash flow', () => {
  const r = computeDeal(withTranches([{ program: 'chfa_htf', amount: 500000, mode: 'loan', loanType: 'cash_flow', cashflowPayPct: 50 }]));
  const f = ds.fifteenYear(r);
  assert.equal(f.rows.length, 15);
  f.rows.forEach((x, n) => {
    const p = r.projection.rows[n];
    close(x.noi, p.noi, 'NOI year ' + x.year);
    close(x.egi, p.egi, 'EGI');
    close(x.expenses, p.opex + p.repReserve + p.propTax, 'expenses');
    close(x.cashFlowAvailable, p.noi - p.debtService, 'cash flow available');
    close(x.cashFlowLoans[0], r.obligations.loans.find(l => l.type === 'cash_flow').rows[n].paid, 'cash flow loan paid');
    close(x.availableAfterPayments + x.deferredFee, p.cashFlow, 'the deferred fee comes out of the engine\'s cash flow');
    close(x.cashFlowAvailable - x.assetMgmtFee - x.cashFlowLoans[0] - x.deferredFee, x.availableAfterPayments, 'payments add up');
  });
  assert(f.loans[0].totals.total > 0, 'the cash-flow loan is paid');
  close(f.loans[0].totals.first10 + f.loans[0].totals.last5, f.loans[0].totals.total, 'windows add to total');
  close(f.deferredFee.totals.first10 + f.deferredFee.totals.last5 + f.deferredFee.unpaidAfter, r.deferredDevFee, 'paid plus unpaid is the fee');
  assert.equal(f.deferredFee.paybackYear, r.exit.dfYr, 'the payback year is the engine\'s');
});

test('the asset management fee and bridge loan come out of cash flow: payback, IRR and distributions move, sizing does not', () => {
  const base = computeDeal(withTranches([]));
  const zero = computeDeal(withTranches([], { 'dc-asset-mgmt-fee': '0', 'dc-asset-mgmt-growth': '3', 'dc-bridge-ds': '0', 'dc-bridge-years': '0' }));
  assert.deepEqual(zero, base, 'entered zeros change nothing');
  const r = computeDeal(withTranches([], { 'dc-asset-mgmt-fee': '20000', 'dc-asset-mgmt-growth': '3', 'dc-bridge-ds': '40000', 'dc-bridge-years': '3' }));
  assert.equal(r.mortgage, base.mortgage, 'the first mortgage is still sized on NOI');
  assert.equal(r.allMustPayDSCR, base.allMustPayDSCR, 'coverage is unchanged');
  const y1 = r.obligations.years[0], y4 = r.obligations.years[3];
  close(y1.bridgeDebtService, 40000, 'bridge in year 1');
  assert.equal(y4.bridgeDebtService, 0, 'no bridge after year 3');
  close(y1.assetMgmtFee, 20000, 'asset fee year 1');
  close(r.obligations.years[1].assetMgmtFee, 20600, 'asset fee grows 3%');
  close(y1.cashFlow, base.obligations.years[0].cashFlow - 60000, 'cash flow is lower by both');
  assert(r.exit.dfYr > base.exit.dfYr, 'the deferred fee takes longer to repay: ' + base.exit.dfYr + ' → ' + r.exit.dfYr);
  assert(r.exit.irr < base.exit.irr, 'the sponsor return falls: ' + base.exit.irr + ' → ' + r.exit.irr);
  close(r.waterfall.annual[0].lp + r.waterfall.annual[0].gp, base.waterfall.annual[0].lp + base.waterfall.annual[0].gp - 60000, 'year-1 distributions fall by both');
  const f = ds.fifteenYear(r);
  assert.equal(f.deferredFee.paybackYear, r.exit.dfYr, 'and the DOH rows agree');
  close(f.rows[0].cashFlowAvailable, y1.noi - y1.mustPayDebtService - 40000, 'cash flow available is after the bridge');
  close(f.rows[0].dcr, y1.noi / (y1.mustPayDebtService + 40000), 'DOH coverage includes the bridge');
  close(f.bridge.total, 120000, 'three years of bridge payments');
  close(f.assetMgmt.first10 + f.assetMgmt.last5, f.assetMgmt.total, 'asset fee windows add up');
});

test('a deficit year pays no deferred fee and must be made up first, so the payback year still matches the engine', () => {
  const r = computeDeal(withTranches([], { 'dc-bridge-ds': '300000', 'dc-bridge-years': '2' }));
  assert(r.obligations.years[0].cashFlow < 0, 'a real deficit year: ' + r.obligations.years[0].cashFlow);
  assert(r.obligations.years[2].cashFlow > 0, 'year 3 has positive cash flow');
  const f = ds.fifteenYear(r);
  assert.equal(f.rows[0].deferredFee, 0);
  assert.equal(f.rows[1].deferredFee, 0);
  assert.equal(f.rows[2].deferredFee, 0, 'year 3\'s cash first makes up the deficit');
  assert(f.rows.every(x => x.deferredFee >= 0), 'never a negative payment');
  assert.equal(f.deferredFee.paybackYear, r.exit.dfYr);
});

test('an invalid payment entry is unknown, not $0: the schedule and everything after it say why', () => {
  const r = computeDeal(withTranches([], { 'dc-asset-mgmt-fee': '' }));
  assert.equal(r.obligations.years, null);
  assert.equal(r.projection, null);
  assert.equal(r.unavailable.projection, 'Enter the asset management fee as $0 or more a year.');
  assert.equal(r.unavailable['exit.dfYr'], 'Enter the asset management fee as $0 or more a year.');
  assert.equal(r.mortgage > 0, true, 'the mortgage does not depend on it');
  const f = ds.fifteenYear(r);
  assert.equal(f.rows, null);
  assert.equal(f.reason, 'Enter the asset management fee as $0 or more a year.');
  assert.match(computeDeal(withTranches([], { 'dc-bridge-years': '2.5' })).unavailable.projection, /whole number/);
  assert.match(computeDeal(withTranches([], { 'dc-asset-mgmt-growth': '12' })).unavailable.projection, /0% to 10%/);
});

test('loanObligations without payments is unchanged for callers that pass none', () => {
  const loans = [{ id: 'a', senior: true, loanType: 'amortizing', amount: 1000000, rate: 6, term: 30, maturity: 30 },
    { id: 'b', loanType: 'cash_flow', amount: 200000, rate: 2, term: 30, maturity: 30, cashflowPayPct: 50, priority: 6 }];
  const noi = Array.from({ length: 5 }, () => 120000);
  const none = loanObligations(loans, noi);
  const zeros = loanObligations(loans, noi, noi.map(() => ({ bridge: 0, assetFee: 0 })));
  assert.deepEqual(zeros.years, none.years);
  const paid = loanObligations(loans, noi, noi.map(() => ({ bridge: 10000, assetFee: 5000 })));
  assert(paid.loans[1].rows[0].paid < none.loans[1].rows[0].paid, 'the cash-flow loan gets less after the bridge and asset fee');
  close(paid.years[0].cashFlow, none.years[0].cashFlow - 15000 + (none.loans[1].rows[0].paid - paid.loans[1].rows[0].paid), 'cash flow reconciles');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
