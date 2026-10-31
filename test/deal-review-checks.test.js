#!/usr/bin/env node
'use strict';
// Bond test, construction interest, operating reserve, deferred fee and expense target checks.
// Every figure here is INVENTED; expected values were worked by hand (see each comment).
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const cb = require(path.join(ROOT, 'js', 'deal-cost-basis.js'));
const ob = require(path.join(ROOT, 'js', 'deal-operating-budget.js'));
const rules = require(path.join(ROOT, 'data', 'policy', 'lihtc-underwriting-rules.json'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ': ' + err.message); }
}
const near = (a, b, msg) => assert(Math.abs(a - b) < 0.01, (msg || '') + ' expected ' + b + ', got ' + a);
// INVENTED deal: $18,000,000 in eligible basis and $2,000,000 of land, so $20,000,000 of aggregate basis.
const base = { creditType: '4', eligibleCost: 18000000, land: 2000000, constructionLoan: 15000000, rules };

test('the rules are sourced and adopted, with the statute\'s thresholds', () => {
  const r = rules.rules.bond_aggregate_basis_test;
  assert.equal(cb.ruleStatus(rules, 'bond_aggregate_basis_test').applied, true);
  assert.equal(r.threshold_pct, 50); assert.equal(r.post_2025_threshold_pct, 25); assert.equal(r.post_2025_issue_min_pct, 5);
  assert.match(r.quote, /25 percent or more of the aggregate basis/);
  assert.equal(cb.ruleStatus(rules, 'operating_reserve_minimum').applied, true);
  assert.equal(cb.ruleStatus(rules, 'deferred_fee_repayment_review').applied, true);
  assert(!/bond aggregate basis test/.test(rules.meta.not_included), 'the bond test is no longer listed as not included');
});

test('bond test: post-2025 bonds at 30% meet the 25% route, with the cushion', () => {
  const r = cb.bondTest({ ...base, bondAmount: 6000000, issuedAfter2025: 'yes' });
  near(r.ratio, 0.30); assert.equal(r.threshold, 0.25); assert.equal(r.passes, true);
  near(r.minimumBonds, 5000000);           // 25% x $20M
  near(r.basisCushion, 4000000);           // $6M / 25% - $20M
  assert.deepEqual(r.flags, []);
});

test('bond test: pre-2026 bonds at 30% fail the 50% test and show the shortfall', () => {
  const r = cb.bondTest({ ...base, bondAmount: 6000000, issuedAfter2025: 'no' });
  assert.equal(r.threshold, 0.5); assert.equal(r.passes, false);
  near(r.minimumBonds, 10000000); near(r.basisCushion, -8000000); // $6M / 50% - $20M
});

test('bond test: an unknown issue date passes only on the 50% route', () => {
  const unknown = cb.bondTest({ ...base, bondAmount: 6000000, issuedAfter2025: '' });
  assert.equal(unknown.passes, null);
  assert.match(unknown.reason, /pass only the 25% route/);
  const high = cb.bondTest({ ...base, bondAmount: 11000000, issuedAfter2025: '' });
  assert.equal(high.passes, true); assert.equal(high.threshold, 0.5);
});

test('bond test: post-2025 bonds under 5% of basis cannot use the 25% route', () => {
  const r = cb.bondTest({ ...base, bondAmount: 900000, issuedAfter2025: 'yes' }); // 4.5%
  assert.equal(r.threshold, 0.5); assert.equal(r.passes, false);
});

test('bond test: bonds above the construction loan, or no loan, are flagged', () => {
  assert.match(cb.bondTest({ ...base, bondAmount: 6000000, issuedAfter2025: 'yes', constructionLoan: 5000000 }).flags.join(' '), /more than the construction loan/);
  assert.match(cb.bondTest({ ...base, bondAmount: 6000000, issuedAfter2025: 'yes', constructionLoan: null }).flags.join(' '), /Enter the construction loan/);
});

test('bond test: no bonds entered keeps the old note; a 9% deal has no test; unknowns are null', () => {
  assert.equal(cb.bondTest({ ...base, bondAmount: '' }).reason, cb.BOND_TEST_NOTE);
  assert.equal(cb.bondTest({ ...base, creditType: '9', bondAmount: 6000000 }).applies, false);
  // Unknown land is not $0: $9M on $18M would pass with land at $0 and fail with $2M (Codex, #2614).
  const noLand = cb.bondTest({ ...base, bondAmount: 9000000, issuedAfter2025: 'no', land: null });
  assert.equal(noLand.passes, null); assert.equal(noLand.ratio, null); assert.match(noLand.reason, /Land line/);
  assert.equal(cb.bondTest({ ...base, bondAmount: 9000000, issuedAfter2025: 'no', land: 0 }).passes, true, 'an entered $0 counts');
  const r = cb.bondTest({ ...base, bondAmount: 6000000, eligibleCost: null });
  assert.equal(r.ratio, null); assert.match(r.reason, /Itemize/);
  const noRule = cb.bondTest({ ...base, bondAmount: 6000000, rules: { ...rules, rules: {} } });
  assert.equal(noRule.passes, null); assert.match(noRule.reason, /rule not sourced/);
});

test('construction interest: estimate is loan x rate x months x share drawn', () => {
  const args = { loan: 10000000, ratePct: 7, months: 24, drawPct: 50 };
  const low = cb.constructionInterestCheck({ ...args, budget: 600000 });
  near(low.estimate, 700000);              // $10M x 7% x 2 years x 50%
  assert.equal(low.passes, false); near(low.shortfall, 100000);
  assert.equal(cb.constructionInterestCheck({ ...args, budget: 750000 }).passes, true);
  assert.match(cb.constructionInterestCheck({ ...args, months: 0, budget: 1 }).reason, /months/);
  const noBudget = cb.constructionInterestCheck({ ...args, budget: null });
  near(noBudget.estimate, 700000); assert.equal(noBudget.passes, null);
  assert.equal(cb.constructionInterestCheck({}).estimate, null);
});

test('operating reserve: four months of expenses plus four of debt service', () => {
  const ok = cb.operatingReserveCheck({ reserve: 300000, annualExpenses: 600000, annualDebtService: 300000, rules });
  near(ok.minimum, 300000); near(ok.months, 4); assert.equal(ok.passes, true);
  assert.equal(cb.operatingReserveCheck({ reserve: 250000, annualExpenses: 600000, annualDebtService: 300000, rules }).passes, false);
  assert.equal(cb.operatingReserveCheck({ reserve: null, annualExpenses: 600000, annualDebtService: 300000, rules }).passes, null);
});

test('deferred fee: repaid year, amount still owed at year 15, unknown years', () => {
  const rows = (paid) => Array.from({ length: 15 }, (_, i) => ({ deferredFeePaid: paid(i + 1) }));
  const repaid = cb.deferredFeeRepayment({ deferredFee: 100, rows: rows((y) => y <= 10 ? 10 : 0), rules });
  assert.equal(repaid.yearRepaid, 10); assert.equal(repaid.owed, 0); assert.equal(repaid.passes, true);
  const owed = cb.deferredFeeRepayment({ deferredFee: 100, rows: rows(() => 5), rules });
  assert.equal(owed.owed, 25); assert.equal(owed.passes, false); assert.equal(owed.yearRepaid, null);
  assert.match(cb.deferredFeeRepayment({ deferredFee: 100, rows: rows(() => 5).slice(0, 14), rules }).reason, /14 years/);
  assert.match(cb.deferredFeeRepayment({ deferredFee: 100, rows: rows((y) => y === 3 ? NaN : 5), rules }).reason, /year 3/);
  assert.equal(cb.deferredFeeRepayment({ deferredFee: 0, rows: [], rules }).passes, true);
});

test('expense target: a target below the expenses is its own line, with coverage at both', () => {
  const r = ob.expenseTargetCheck({ targetPerUnitYear: '6000', usedAnnual: 700000, units: 100, noi: 500000, mustPayDebtService: 450000 });
  assert.equal(r.below, true); near(r.difference, 1000);
  near(r.coverageUsed, 500000 / 450000); near(r.coverageAtTarget, 600000 / 450000); // +$1,000 x 100 units of NOI
  assert.equal(ob.expenseTargetCheck({ targetPerUnitYear: '7500', usedAnnual: 700000, units: 100 }).below, false);
  assert.equal(ob.expenseTargetCheck({ targetPerUnitYear: '' }).entered, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
