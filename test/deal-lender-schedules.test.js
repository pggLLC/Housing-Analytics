#!/usr/bin/env node
'use strict';
// Lender schedules: construction draws and conversion, CHFA minimums, the
// line-by-line 15-year budget, stress cases, reserve accounts and exit paths.
// Every figure here is INVENTED; the hand-worked cases are small enough to check on paper.
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ls = require(path.join(ROOT, 'js', 'deal-lender-schedules.js'));
const cb = require(path.join(ROOT, 'js', 'deal-cost-basis.js'));
const { computeDeal } = require(path.join(ROOT, 'js', 'deal-engine.js'));
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');
const rules = require(path.join(ROOT, 'data', 'policy', 'lihtc-underwriting-rules.json'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ': ' + err.message); }
}
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= (tol || 0.01), (msg || '') + ' expected ' + b + ', got ' + a);
const clone = (v) => JSON.parse(JSON.stringify(v));

// A $1,000,000 invented deal: $200k land, $600k construction, $100k soft, $100k fee (none deferred).
function tinyResult(over) {
  return Object.assign({
    tdc: 1000000, units: 10, mortgage: 0, deferredDevFee: 0, fundingGap: 0, totalGrant: 0, totalLoanPrincipal: 0,
    costBasis: {
      summary: { reason: null, notItemized: 0, byId: {}, groups: { acquisition: 200000, site: 0, construction: 600000, professional: 0,
        construction_finance: 0, permanent_finance: 0, soft: 100000, fees: 100000, reserves: 0 } },
      payIn: { federal: { total: 1000000, installments: [{ stage: 'closing', pct: 30, amount: 300000 },
        { stage: 'completion', pct: 0, amount: 0 }, { stage: 'stabilization', pct: 70, amount: 700000 }] } },
      constructionInterest: { estimate: null }
    }
  }, over || {});
}
const tinyFields = { 'dc-constr-loan': '2000000', 'dc-constr-rate': '12', 'dc-constr-months': '3', 'dc-draw-convert-months': '1',
  'dc-draw-curve': 'straight', 'dc-draw-retainage': '0', 'dc-draw-fee-closing': '0', 'dc-draw-soft-closing': '100', 'dc-draw-soft-sources': 'closing' };

test('S-curve, straight and front-loaded curves each spend exactly the whole cost', () => {
  for (const c of Object.keys(ls.CURVES)) {
    assert.equal(ls.curveShare(c, 0), 0); assert.equal(ls.curveShare(c, 1), 1);
    near(ls.curveShare(c, 0.5), c === 'straight' ? 0.5 : c === 'front' ? 0.75 : 0.5, 1e-12, c);
  }
  assert(ls.curveShare('scurve', 0.1) < 0.1, 'the S-curve starts slower than a straight line');
});

test('hand-worked draw: equity first, loan funds the rest, interest on the opening balance, payoff at conversion', () => {
  const d = ls.constructionDraw(tinyResult(), tinyFields);
  assert.equal(d.reason, null);
  // Month 0: $300k land and soft paid from $300k closing equity. Month 1: $300k hard from the loan.
  // Month 2: $3,000 interest (1% of $300k) + $300k hard. Month 3: $6,030 interest + $100k fee, $700k equity in.
  assert.deepEqual(d.rows.map(r => r.phase), ['closing', 'construction', 'completion', 'conversion']);
  near(d.rows[1].loanDraw, 300000); near(d.rows[2].interest, 3000); near(d.rows[2].loanDraw, 303000);
  near(d.rows[3].interest, 6030); near(d.totalInterest, 9030); near(d.peakBalance, 603000); assert.equal(d.peakMonth, 2);
  near(d.conversion.shortfall, 9030, 0.01, 'the interest nobody budgeted is what is left unpaid');
  assert.equal(d.conversion.paidOff, false);
  assert(d.tie.ties, 'uses tie to cost less deferred fee, with computed interest in place of the budget line');
  near(d.interestVsBudget, -9030);
});

test('budgeted interest that covers the schedule leaves the loan paid off', () => {
  const r = tinyResult();
  r.costBasis.summary.groups.construction_finance = 9030; r.costBasis.summary.byId.construction_interest = 9030;
  r.tdc = 1009030;
  r.costBasis.payIn.federal.installments[2].amount = 709030;
  const d = ls.constructionDraw(r, tinyFields);
  near(d.conversion.shortfall, 0); assert.equal(d.conversion.paidOff, true);
  near(d.interestVsBudget, 0);
});

test('retainage is held from each draw and released at completion', () => {
  const d = ls.constructionDraw(tinyResult(), Object.assign({}, tinyFields, { 'dc-draw-retainage': '10' }));
  near(d.rows[1].hard, 270000); near(d.rows[1].retainageHeld, 30000); near(d.rows[2].retainageReleased, 60000); near(d.retainageHeld, 60000);
});

test('a loan too small for the peak is named, never silently capped', () => {
  const d = ls.constructionDraw(tinyResult(), Object.assign({}, tinyFields, { 'dc-constr-loan': '500000' }));
  assert.equal(d.loanEnough, false); assert(d.notes[0].includes('$603,000'));
});

test('missing draw inputs give reasons, not a schedule built on zeros', () => {
  const d = ls.constructionDraw(tinyResult(), {});
  assert.equal(d.rows, null); assert(d.reason.includes('construction loan'));
  assert(d.reasons.length >= 5);
  const noPay = tinyResult(); noPay.costBasis.payIn.federal = { total: 1, installments: null, reason: 'Pay-in schedule not entered.' };
  assert(ls.constructionDraw(noPay, tinyFields).reason.includes('pay-in schedule'));
  const gap = tinyResult({ fundingGap: 5000 });
  assert(ls.constructionDraw(gap, tinyFields).reason.includes('short of uses'));
  const part = tinyResult(); part.costBasis.summary.notItemized = 1000;
  assert(ls.constructionDraw(part, tinyFields).reason.includes('Itemize'));
});

test('CHFA minimums: each line names its QAP section and flags what is short', () => {
  const ok = cb.chfaMinimumsCheck({ vacancyRate: 0.07, annualOpex: 40000, netPropTax: 5000, annualRepReserve: 3500, units: 10, rentGrowth: 0.02, expGrowth: 0.03, rules });
  assert.equal(ok.tested, 5); assert.equal(ok.below, 0);
  assert(ok.items.every(i => i.citation && i.citation.includes('Section 4')));
  const low = cb.chfaMinimumsCheck({ vacancyRate: 0.05, annualOpex: 38000, netPropTax: 2000, annualRepReserve: 3000, units: 10, rentGrowth: 0.03, expGrowth: 0.02, rules });
  assert.equal(low.below, 5, 'vacancy, $4,000 a home, $300 reserve, 3% rent growth and 2% cost growth all miss');
  const s8 = cb.chfaMinimumsCheck({ vacancyRate: 0.05, annualOpex: 45000, netPropTax: 0, annualRepReserve: 3000, units: 10, rentGrowth: 0.02, expGrowth: 0.03, fullSection8: 'yes', senior: 'yes', rules });
  assert.equal(s8.items[0].passes, true, '5% vacancy meets the full Section 8 minimum');
  assert.equal(s8.items[1].passes, false, '$4,500 is short of the $5,000 Section 8 floor');
  assert.equal(s8.items[2].passes, true, '$300 meets the senior reserve minimum');
  const unknown = cb.chfaMinimumsCheck({ vacancyRate: 0.07, annualOpex: null, netPropTax: null, annualRepReserve: null, units: 10, rentGrowth: 0.02, expGrowth: 0.03, rules });
  assert.equal(unknown.items[1].passes, null); assert(unknown.items[1].reason);
  const noRules = cb.chfaMinimumsCheck({ vacancyRate: 0.07, units: 10, rules: null });
  assert(noRules.items.every(i => i.passes === null && i.reason.includes('rule not sourced')));
});

test('capital needs text reads year:amount and refuses what it cannot read', () => {
  assert.deepEqual(ls.parseCapitalNeeds('10:300,000; year 14 = 200000').items, [{ year: 10, amount: 300000 }, { year: 14, amount: 200000 }]);
  assert(ls.parseCapitalNeeds('roof soon').reason.includes('roof soon'));
  assert.deepEqual(ls.parseCapitalNeeds('').items, []);
});

// The engine's own invented scenario A, with the new inputs filled in.
const extra = { 'dc-constr-loan': '12000000', 'dc-constr-rate': '7', 'dc-constr-months': '24', 'dc-draw-convert-months': '6', 'dc-draw-curve': 'scurve',
  'dc-draw-retainage': '10', 'dc-draw-fee-closing': '25', 'dc-draw-soft-closing': '40', 'dc-fed-payin-closing': '20', 'dc-fed-payin-completion': '40',
  'dc-fed-payin-stabilization': '40', 'dc-conv-rate-bp': '50', 'dc-conv-noi-cut': '5', 'dc-conv-credit-delivered': '95', 'dc-pf-mgmt-pct': '6',
  'dc-pf-capital-needs': '10:300000; 14:200000', 'dc-pf-reserve-yield': '2', 'dc-after-taxes': '500000', 'dc-after-refi-rate': '6', 'dc-after-refi-term': '35',
  'dc-after-refi-dcr': '1.20', 'dc-after-refi-cost': '2', 'dc-after-land-pct': '10', 'dc-after-rehab-per-home': '60000', 'dc-after-resyn-price': '0.85', 'dc-after-rehab-rate': '4' };
function full() { const i = inputsFor('A'); Object.assign(i.fields, extra); return i; }

test('engine: the new inputs leave every existing figure unchanged', () => {
  const base = computeDeal(inputsFor('A')), withNew = computeDeal(full());
  for (const k of ['annualRents', 'noi', 'mortgage', 'annualCredits', 'equity', 'deferredDevFee', 'gap']) assert.equal(withNew[k], base[k], k);
  assert.deepEqual(withNew.projection, base.projection);
  assert.deepEqual(withNew.exit, base.exit);
});

test('engine: draw schedule ties and conversion cases resize the loan', () => {
  const s = computeDeal(full()).schedules;
  assert.equal(s.draw.reason, null); assert(s.draw.tie.ties);
  assert.equal(s.draw.rows.length, 25);
  const c = s.conversion.cases;
  assert.equal(c.length, 5); assert.equal(c[0].loanChange, 0);
  assert(c[1].permanent < c[0].permanent, 'a higher rate sizes a smaller loan');
  near(c[2].permanent, c[0].permanent * 0.95, 0.01, 'with no soft debt, 5% less income sizes a 5% smaller loan');
  assert(c[3].equityAdjuster > 0 && c[3].permanent === c[0].permanent);
  assert(c[4].netShort > c[1].netShort && c[4].netShort > c[3].netShort, 'all three together is the worst case');
});

test('engine: line budget year 1 equals the engine; management fee follows income', () => {
  const r = computeDeal(full()), b = r.schedules.budget;
  assert.equal(b.reason, null);
  near(b.rows[0].noi, r.noi); near(b.rows[0].managementFee + b.rows[0].otherOpex, r.annualOpex);
  near(b.rows[1].managementFee, b.rows[0].managementFee * 1.02, 0.01);
  near(b.rows[1].otherOpex, b.rows[0].otherOpex * 1.03, 0.01);
  // Rent cushion to 1.15x: the cut in rent per home a month that brings year-1 coverage to 1.15x.
  const y1 = b.rows[0], ds = y1.debtService;
  near(y1.noi - y1.cushionTo115 * 12 * 60 * 0.93 * 0.94, 1.15 * ds, 0.5);
  assert.equal(b.rows.length, 15);
});

test('engine: 15-year stress holds the closed loan and finds the first year below 1.15x', () => {
  const s = computeDeal(full()).schedules.stress;
  assert.equal(s.cases[0].lowestDscr.toFixed(2), '1.20');
  const vac = s.cases.find(c => c.label.startsWith('Vacancy'));
  assert(vac.lowestDscr < 1.2, 'higher vacancy lowers coverage on the same loan');
  // Each case equals a full engine re-run with the loan held at the planned amount.
  const noMgmt = () => { const i = full(); delete i.fields['dc-pf-mgmt-pct']; return i; };
  const planned = computeDeal(noMgmt());
  const sPlain = planned.schedules.stress;
  for (const [label, change] of [['Rents grow 1 point slower', { 'pf-rent-growth': '1' }], ['Flat rents', { 'pf-rent-growth': '0', 'pf-exp-growth': '4' }], ['Vacancy 3 points higher', { 'dc-vacancy': '10' }]]) {
    const i = noMgmt(); Object.assign(i.fields, { 'dc-senior-mode': 'entered', 'dc-senior-amount': String(planned.mortgage) }, change);
    const ys = computeDeal(Object.assign(i, { skipSchedules: true })).coverage.years.slice(0, 15).map(y => y.allMustPayCoverage);
    near(sPlain.cases.find(c => c.label.startsWith(label)).lowestDscr, Math.min(...ys), 1e-9, label + ' matches a full re-run');
  }
  const flat = s.cases.find(c => c.label.startsWith('Flat'));
  assert(flat.firstBelowMinimum >= 1 && flat.firstBelowMinimum <= 15);
});

test('engine: a loan maturing before year 15 with no refinancing makes the 15-year test unknown, not a pass', () => {
  const i = full(); i.fields['dc-senior-maturity'] = '10';
  const s = computeDeal(i).schedules;
  assert.equal(s.stress.cases.length, 5);
  for (const c of s.stress.cases) {
    assert.equal(c.lowestDscr, null, c.label + ' reports no lowest coverage');
    assert.equal(c.firstBelowMinimum, null);
    assert.match(c.reason, /year 11.*maturity/i, c.label + ' carries the maturity reason');
  }
  assert.equal(s.budget.lowestDscr, null);
  assert.match(s.budget.coverageReason, /year 11.*maturity/i);
  assert.equal(s.budget.rows.length, 15, 'the year-by-year rows are still shown');
});

test('engine: a projection shorter than 15 years is named, not tested as if complete', () => {
  const i = full(); i.fields['pf-years'] = '10';
  const b = computeDeal(i).schedules.budget;
  assert.equal(b.lowestDscr, null);
  assert.match(b.coverageReason, /runs 10 years/);
});

test('engine: budget assumptions carry into the stress cases and the reserve account', () => {
  const i = full(); Object.assign(i.fields, { 'dc-pf-reserve-growth': '10', 'dc-pf-tax-growth': '10' });
  const s = computeDeal(i).schedules;
  near(s.reserves.replacement.rows[14].deposit, s.budget.rows[14].repReserve, 0.01, 'reserve deposits follow the budget');
  near(s.stress.cases[0].lowestDscr, s.budget.lowestDscr, 1e-9, 'as planned equals the budget');
  assert(s.budget.lowestDscr < 1.2, 'non-vacuous: faster tax and reserve growth lowers coverage');
});

test('engine: an income cut keeps the soft loan payment fixed when the loan is resized', () => {
  const i = full(); i.tranches = [{ id: 1, program: 'other', amount: 1000000, mode: 'loan', rate: 3, term: 30, cashflowPayPct: 100, accrueMode: 'current', priority: 5 }];
  const r = computeDeal(i);
  assert(r.totalSoftDebtService > 0, 'non-vacuous: the soft loan has a regular payment');
  const c = r.schedules.conversion.cases[2];
  const expected = Math.max(0, r.noi * 0.95 / r.dcr - r.totalSoftDebtService) / ((r.noi / r.dcr - r.totalSoftDebtService) / r.mortgage);
  near(c.permanent, expected, 0.01, 'sized on the lower income with the same soft payment');
  assert(c.permanent < r.mortgage * 0.95, 'shrinks by more than the income cut');
});

test('engine: reserve account follows deposits, interest and capital needs', () => {
  const rep = computeDeal(full()).schedules.reserves.replacement;
  assert.equal(rep.reason, null);
  assert.equal(rep.firstShort, 10, 'a $300,000 need in year 10 overdraws a 60-home reserve at $350 a home');
  const y = rep.rows[9];
  near(y.balance, rep.rows[8].balance + y.deposit + y.interest - 300000);
  assert(rep.rows.every(row => row.interest >= 0), 'an overdrawn account earns no interest');
});

test('engine: exit paths — cap range, minimum price, refinance, resyndication, hold', () => {
  const r = computeDeal(full()), e = r.schedules.exit;
  assert.equal(e.capRange.length, 5); near(e.capRange[2].value, r.exit.resale);
  near(e.minimumPrice.price, r.exit.firstMortBal + r.exit.softBal + 500000);
  const k = 0.06 / (1 - Math.pow(1.06, -35));
  near(e.refinance.newLoan, r.exit.nNoi / (1.2 * k), 0.01);
  near(e.resyndication.annualCredit, r.exit.resale * 0.9 * 0.04 + 60000 * 60 * 0.04, 0.01);
  near(e.resyndication.equity, e.resyndication.annualCredit * 10 * 0.85, 0.01);
  assert.equal(e.hold.fromYear, 16); assert.equal(e.hold.toYear, 30);
  const noTax = inputsFor('A'); Object.assign(noTax.fields, extra); delete noTax.fields['dc-after-taxes'];
  const m = computeDeal(noTax).schedules.exit.minimumPrice;
  assert.equal(m.price, null); assert(m.reason.includes('exit taxes'));
});

test('engine: a blank operating budget leaves every schedule with a reason, no NaN', () => {
  const c = inputsFor('C'); Object.assign(c.fields, extra);
  const s = computeDeal(c).schedules;
  assert(s.draw.reason && s.budget.reason && s.stress.reason && s.reserves.reason && s.exit.reason);
  assert(!JSON.stringify(s).includes('NaN'));
});

test('engine: pure — caller inputs unchanged and stress runs do not recurse', () => {
  const i = full(), before = clone(i);
  const r = computeDeal(i);
  assert.deepEqual(i, before);
  assert.equal(computeDeal(Object.assign({}, i, { skipSchedules: true })).schedules, undefined);
  assert(r.schedules);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
