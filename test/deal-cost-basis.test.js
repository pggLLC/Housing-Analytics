#!/usr/bin/env node
'use strict';
// #2160: itemized costs, eligible basis, fee tests and CHFA credit limits.
// Every figure here is INVENTED (test/fixtures/deal-cost-basis/invented-cases.json).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const cb = require(path.join(ROOT, 'js', 'deal-cost-basis.js'));
const rules = require(path.join(ROOT, 'data', 'policy', 'lihtc-underwriting-rules.json'));
const cases = require(path.join(__dirname, 'fixtures', 'deal-cost-basis', 'invented-cases.json'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ': ' + err.message); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const round = (n) => Math.round(n * 100) / 100;

function runBasisCase(c, ruleFile, overrides) {
  c = Object.assign(clone(c), overrides || {});
  const summary = cb.summarizeCosts(c.lines, c.tdc);
  const grants = cb.grantBasisReduction(c.tranches, ruleFile);
  return { summary, grants, result: cb.basisAndCredit({
    eligibleCost: summary.eligible, costReason: summary.reason, acquisitionEligible: summary.acquisitionEligible, acquisitionQualifies: c.acquisitionQualifies !== false,
    grantReduction: grants.reduction, grantReason: grants.reason, designation: c.designation, evidence: c.evidence,
    creditType: c.creditType, creditRate: c.creditRate, units: c.units, lowIncomeUnits: c.lowIncomeUnits,
    residentialSf: c.residentialSf, lowIncomeSf: c.lowIncomeSf, requested: c.requested, awarded: c.awarded,
    grantOnAcquisition: c.grantOnAcquisition, rules: ruleFile }) };
}

test('fixtures are marked invented', () => {
  assert.equal(cases.invented, true);
  assert.match(cases.note, /INVENTED/);
});

test('acceptance 1: eligible basis, grant, boost, qualified basis and credit', () => {
  const { summary, result } = runBasisCase(cases.basisCase, rules);
  const e = cases.basisCase.expected;
  assert.equal(summary.reason, null);
  assert.equal(round(result.eligibleBasis), e.eligibleBasis);
  assert.equal(round(result.afterGrant), e.afterGrant);
  assert.equal(round(result.boostedBasis), e.boostedBasis);
  assert.equal(round(result.qualifiedBasis), e.qualifiedBasis);
  assert.equal(round(result.calculatedCredit), e.calculatedCredit);
  assert.equal(result.applicableFraction, 0.88, 'floor fraction (88%) is lower than the unit fraction (90%)');
  assert.equal(result.unitFraction, 0.9);
});

test('acceptance 2: the adopted CHFA cap limits capacity and says why', () => {
  const { result } = runBasisCase(cases.basisCase, rules);
  assert.equal(result.cap.binding, true);
  assert.equal(result.capacity, rules.rules.credit_cap_federal_9pct.annual_cap);
  assert.match(result.cap.reason, /Capped at \$1,800,000/);
  assert.match(result.cap.reason, /Qualified Allocation Plan/);
});

test('acceptance 2: a fixture cap below the credit caps it and says why', () => {
  const r = clone(rules);
  r.rules.credit_cap_federal_9pct.annual_cap = 1500000;
  const { result } = runBasisCase(cases.basisCase, r);
  assert.equal(result.capacity, 1500000);
  assert.match(result.cap.reason, /Capped at \$1,500,000/);
});

test('acceptance 2: a fixture rule with no source is not applied and says "rule not sourced"', () => {
  const r = clone(rules);
  r.rules.credit_cap_federal_9pct.annual_cap = 1500000;
  delete r.rules.credit_cap_federal_9pct.source;
  const { result } = runBasisCase(cases.basisCase, r);
  assert.equal(result.cap.applied, false);
  assert.equal(result.cap.reason, 'rule not sourced');
  assert.equal(round(result.calculatedCredit), cases.basisCase.expected.calculatedCredit, 'non-vacuous: Method One still has a value');
  // The 9% limit is required, so without it the capacity is unknown, not uncapped Method One.
  assert.equal(result.capacity, null);
  assert.equal(result.creditForEquity, null);
  assert.match(result.reasons.capacity, /federal 9% limit.*rule not sourced/);
  const unknownSource = clone(rules);
  unknownSource.rules.credit_cap_federal_9pct.source = 'S99';
  assert.equal(cb.ruleStatus(unknownSource, 'credit_cap_federal_9pct').reason, 'rule not sourced');
});

test('a draft rule is shown separately and not applied', () => {
  const r = clone(rules);
  r.drafts.credit_cap_federal_9pct = { status: 'draft', source: 'S1', location: 'invented draft', annual_cap: 100 };
  const adopted = cb.ruleStatus(r, 'credit_cap_federal_9pct');
  assert.equal(adopted.applied, true);
  assert.equal(adopted.draft.annual_cap, 100, 'the draft travels with the rule for display');
  assert.equal(runBasisCase(cases.basisCase, r).result.capacity, 1800000, 'the draft value is never applied');
  r.rules.credit_cap_federal_9pct.status = 'draft';
  const draftOnly = cb.ruleStatus(r, 'credit_cap_federal_9pct');
  assert.equal(draftOnly.applied, false);
  assert.match(draftOnly.reason, /Draft rule/);
});

test('acceptance 3: QCT off means no boost', () => {
  const { result } = runBasisCase(cases.basisCase, rules, { designation: 'none' });
  assert.equal(result.boost.applied, false);
  assert.equal(round(result.boostedBasis), cases.basisCase.expected.afterGrant);
  assert.equal(round(result.qualifiedBasis), round(17700000 * 0.88));
});

test('a designation without evidence, or CHFA boost on a 4% deal, gives no boost', () => {
  const noEvidence = runBasisCase(cases.basisCase, rules, { evidence: '   ' }).result;
  assert.equal(noEvidence.boost.applied, false);
  assert.match(noEvidence.boost.reason, /evidence/);
  const chfa4 = runBasisCase(cases.basisCase, rules, { designation: 'chfa', creditType: '4', creditRate: 0.04 }).result;
  assert.equal(chfa4.boost.applied, false);
  assert.match(chfa4.boost.reason, /only to 9% credits/);
  const unsourced = clone(rules);
  delete unsourced.rules.basis_boost.source;
  assert.match(runBasisCase(cases.basisCase, unsourced).result.boost.reason, /rule not sourced/);
});

test('the boost applies once, never to acquisition basis, and never above eligible cost x 130%', () => {
  const lines = clone(cases.basisCase.lines).concat([{ id: 'building_acquisition', label: 'Building', group: 'acquisition', basis: 'eligible', amount: 1000000 }]);
  // The case's $500,000 federal grant paid only for the rehabilitation (entered: $0 against the purchase).
  const { result } = runBasisCase(cases.basisCase, rules, { lines, tdc: 21600000, grantOnAcquisition: 0 });
  assert.equal(round(result.boostedBasis), round((18200000 - 500000) * 1.3 + 1000000));
  for (const designation of ['qct', 'dda', 'sadda']) {
    const r = runBasisCase(cases.basisCase, rules, { designation, tranches: [] }).result;
    assert(r.boostedBasis <= r.eligibleBasis * 1.3 + 0.01, designation + ' stays within 130%');
    assert.equal(r.boost.multiplier, 1.3);
  }
  // CHFA awards "up to" 30%: its boost is the percentage in CHFA's letter.
  const chfa = (pct) => cb.basisAndCredit({ eligibleCost: 1000000, grantReduction: 0, designation: 'chfa', evidence: 'Invented CHFA letter',
    awardedBoostPct: pct, creditType: '9', creditRate: 0.09, units: 10, lowIncomeUnits: 10, rules });
  assert.equal(chfa(undefined).boost.applied, false);
  assert.match(chfa(undefined).boost.reason, /percentage in CHFA's letter/);
  assert.equal(Math.round(chfa(20).boostedBasis), 1200000);
  assert.equal(chfa(30).boost.multiplier, 1.3);
  assert.equal(chfa(35).boost.applied, false);
  assert.match(chfa(35).boost.reason, /up to 30%/);
  assert(rules.rules.basis_boost.designations.chfa.up_to_quote.includes('up to a 30-percent'));
});

test('grants are treated by source type; an unknown type is null with a reason', () => {
  const base = cases.basisCase;
  const loan = runBasisCase(base, rules, { tranches: [{ id: 1, mode: 'loan', amount: 500000, fundSource: 'federal' }] }).result;
  assert.equal(loan.afterGrant, 18200000, 'federal money lent to the project does not reduce basis');
  const state = runBasisCase(base, rules, { tranches: [{ id: 1, mode: 'grant', amount: 500000, fundSource: 'nonfederal' }] }).result;
  assert.equal(state.afterGrant, 18200000, 'a grant with no federal money does not reduce basis');
  const unknown = runBasisCase(base, rules, { tranches: [{ id: 1, mode: 'grant', amount: 500000 }] });
  assert.equal(unknown.grants.reduction, null);
  assert.match(unknown.grants.reason, /federal money/);
  assert.equal(unknown.result.afterGrant, null);
  assert.match(unknown.result.reasons.afterGrant, /federal money/);
  const negative = runBasisCase(base, rules, { tranches: [{ id: 1, mode: 'grant', amount: -500000, fundSource: 'federal' }] });
  assert.equal(negative.grants.reduction, null, 'a negative grant never raises basis');
  assert.equal(negative.result.afterGrant, null);
  assert.match(negative.grants.reason, /\$0 or more/);
});

test('applicable fraction needs floor space when some units are unrestricted', () => {
  const missing = runBasisCase(cases.basisCase, rules, { residentialSf: null }).result;
  assert.equal(missing.applicableFraction, null);
  assert.equal(missing.qualifiedBasis, null);
  assert.match(missing.reasons.applicableFraction, /floor space/);
  const allRestricted = runBasisCase(cases.basisCase, rules, { lowIncomeUnits: 60, residentialSf: null }).result;
  assert.equal(allRestricted.applicableFraction, 1);
  const unitLower = runBasisCase(cases.basisCase, rules, { lowIncomeSf: 47000 }).result;
  assert.equal(unitLower.applicableFraction, 0.9, 'the lower fraction wins either way');
});

test('acceptance 4: aggregate developer plus consultant fee fails a 15% limit, deferral or not', () => {
  const f = cases.feeCase;
  const fixture = clone(rules);
  fixture.rules.developer_fee_limit.tiers = [{ min_units: 1, max_units: null, pct: 0.15 }];
  const run = (deferred) => cb.developerFeeTest({ developerFee: f.developerFee, consultantFee: f.consultantFee,
    deferred, base: f.base, units: f.units, rules: fixture });
  const r = run(0);
  assert.equal(r.fee, f.expected.fee);
  assert.equal(round(r.limit), f.expected.limit);
  assert.equal(r.passes, f.expected.passes);
  assert.equal(r.testedBeforeDeferral, true);
  assert.deepEqual(run(f.deferred), r, 'deferring part of the fee does not change the test');
  const strip = (x) => Object.assign({}, x, { status: undefined });
  assert.deepEqual(strip(cb.developerFeeTest({ developerFee: f.developerFee, consultantFee: f.consultantFee, base: f.base, units: f.units, rules })), strip(r),
    'the adopted rule gives 15% for 50 units or fewer too');
  const unsourced = clone(fixture);
  delete unsourced.rules.developer_fee_limit.source;
  const u = cb.developerFeeTest({ developerFee: f.developerFee, consultantFee: f.consultantFee, base: f.base, units: f.units, rules: unsourced });
  assert.equal(u.passes, null);
  assert.equal(u.reason, 'rule not sourced');
});

test('an in-basis fee whose limit rule is unsourced leaves the basis reduction unknown, not $0', () => {
  const summary = cb.summarizeCosts(cb.exampleLines(), 20000000);
  assert(summary.eligibleById.developer_fee > 0 && summary.eligibleById.overhead_profit > 0, 'non-vacuous: both fees sit in basis');
  const contractor = cb.contractorFeeTest({ byId: summary.byId, units: 60, rules });
  const base = cb.developerFeeBase(summary, contractor);
  const developer = cb.developerFeeTest({ developerFee: summary.byId.developer_fee, base: base.base, units: 60, rules });
  assert.equal(cb.feeExcessInBasis(summary, contractor, developer).total, 0, 'both tested: a measured $0');
  for (const key of ['contractor_fee_limit', 'developer_fee_limit']) {
    const r = clone(rules); delete r.rules[key].source;
    const c = cb.contractorFeeTest({ byId: summary.byId, units: 60, rules: r });
    const b = cb.developerFeeBase(summary, c);
    const d = cb.developerFeeTest({ developerFee: summary.byId.developer_fee, base: b.base, baseReason: b.reason, units: 60, rules: r });
    const ex = cb.feeExcessInBasis(summary, c, d);
    assert.equal(ex.total, null, key);
    assert.match(ex.reason, /could not be tested.*rule not sourced/, key);
  }
});

test('an over-limit fee split across basis treatments reduces basis only when the split settles it', () => {
  // DOH carries overhead and profit on one line; part of it in basis is the mixed case.
  const run = (basis, eligibleAmount) => {
    const lines = cb.exampleLines().map(l => l.id === 'overhead_profit' ? Object.assign({}, l, { basis, eligibleAmount }) : l);
    const summary = cb.summarizeCosts(lines, 20000000);
    // Identity of interest at 80 units: a 6% limit on $11,900,000, so $36,000 of the $750,000 fee is over.
    const c = cb.contractorFeeTest({ byId: summary.byId, units: 80, identityOfInterest: true, rules });
    assert.equal(Math.round(c.excess), 36000, 'non-vacuous: the fee is over the limit');
    return cb.feeExcessInBasis(summary, c, null);
  };
  assert.equal(Math.round(run('eligible').contractor), 36000, 'all in basis: the whole excess comes off');
  // $250,000 of the $750,000 in basis, $500,000 outside: the $36,000 could fall on either.
  const mixed = run('partial', 250000);
  assert.equal(mixed.total, null);
  assert.match(mixed.reason, /somewhere from \$0 to \$36,000/);
});

test('developer fee base follows QAP 3.M.3 and the contractor fee test uses its tier', () => {
  const lines = cb.exampleLines();
  const summary = cb.summarizeCosts(lines, 20000000);
  const contractor = cb.contractorFeeTest({ byId: summary.byId, units: 60, identityOfInterest: false, rules });
  assert.equal(contractor.limitPct, 0.10);
  assert.equal(contractor.fee, 750000);
  assert.equal(contractor.passes, true);
  const base = cb.developerFeeBase(summary, contractor);
  assert.equal(base.base, 20000000 - 1000000 - 1900000 - 500000);
  const ioi = cb.contractorFeeTest({ byId: summary.byId, units: 80, identityOfInterest: true, rules });
  assert.equal(ioi.limitPct, 0.06);
  assert.equal(ioi.passes, false);
  assert.equal(round(ioi.excess), round(750000 - 11900000 * 0.06));
  const lumped = cb.contractorFeeTest({ byId: { structures: 14000000 }, units: 60, rules });
  assert.equal(lumped.passes, null);
  assert.match(cb.developerFeeBase(cb.summarizeCosts(cases.basisCase.lines, 20600000), lumped).note, /not tested/);
});

test('acceptance 5: cost per gross and residential SF for the contract and the total', () => {
  const s = cases.sfCase;
  const r = cb.costPerSf(s);
  for (const key of Object.keys(s.expected)) assert.equal(r[key].value.toFixed(2), s.expected[key], key);
  assert.equal(r.contractPerGrossSf.scope, 'contract');
  assert.equal(r.totalPerResidentialSf.area, 'residential');
  const blank = cb.costPerSf({ contract: 10000000, total: 16000000, grossSf: 40000, residentialSf: '' });
  assert.equal(blank.totalPerResidentialSf.value, null);
  assert.match(blank.totalPerResidentialSf.reason, /residential square feet/);
});

test('contract lines are a subset of uses, never added twice; unitemized cost is ineligible', () => {
  const lines = cb.exampleLines();
  const s = cb.summarizeCosts(lines, 21000000);
  const sum = lines.reduce((a, l) => a + (l.amount || 0), 0);
  assert.equal(s.itemized, sum);
  assert.equal(s.contract, cb.sumIds(s.byId, cb.CONTRACT_IDS), 'the contract is its lines, counted once inside the uses');
  assert(s.contract < s.itemized);
  assert.equal(Object.values(s.groups).reduce((a, b) => a + b, 0), s.itemized, 'groups partition the uses');
  assert.equal(s.notItemized, 1000000);
  assert.equal(s.eligible + s.ineligible, 21000000);
  const over = cb.summarizeCosts(lines, 19000000);
  assert.equal(over.eligible, null);
  assert.match(over.reason, /more than Total Development Cost/);
  assert.match(cb.summarizeCosts([], 20000000).reason, /Itemize/);
  const partial = clone(lines); partial.find((l) => l.id === 'construction_interest').eligibleAmount = null;
  assert.match(cb.summarizeCosts(partial, 20000000).reason, /eligible part of Construction interest/);
});

test('each contingency keeps its original amount, proposed use and remaining', () => {
  const lines = cb.exampleLines();
  lines.find((l) => l.id === 'escalation').used = 50000;
  lines.find((l) => l.id === 'soft_contingency').used = '';
  const s = cb.summarizeCosts(lines, 20000000);
  assert.deepEqual(s.contingencies.map((c) => c.id).sort(), ['contractor_contingency', 'escalation', 'owner_contingency', 'soft_contingency']);
  const esc = s.contingencies.find((c) => c.id === 'escalation');
  assert.deepEqual([esc.original, esc.used, esc.remaining], [200000, 50000, 150000]);
  const soft = s.contingencies.find((c) => c.id === 'soft_contingency');
  assert.equal(soft.remaining, null);
  assert.match(soft.reason, /proposed for use/);
});

test('capacity, request and award are three figures; equity follows award, then request, then capacity', () => {
  const none = runBasisCase(cases.basisCase, rules).result;
  assert.equal(none.creditForEquityBasis, 'capacity');
  assert.equal(none.requested, null);
  assert.match(none.reasons.requested, /No request/);
  const req = runBasisCase(cases.basisCase, rules, { requested: 1700000 }).result;
  assert.deepEqual([req.capacity, req.requested, req.awarded, req.creditForEquity], [1800000, 1700000, null, 1700000]);
  const over = runBasisCase(cases.basisCase, rules, { requested: 1900000 }).result;
  assert.equal(over.creditForEquity, 1800000);
  assert(over.flags.some((f) => /more than the credit capacity/.test(f)));
  const award = runBasisCase(cases.basisCase, rules, { requested: 1700000, awarded: 1600000 }).result;
  assert.deepEqual([award.creditForEquity, award.creditForEquityBasis], [1600000, 'awarded']);
});

test('underwriting thresholds use the rule\'s forecast years', () => {
  const years = Array.from({ length: 15 }, (_, i) => ({ year: i + 1, allMustPayCoverage: 1.35 - i * 0.01 }));
  const ok = cb.underwritingCheck({ years, rules });
  assert.equal(round(ok.minimum.lowest), 1.21);
  assert.equal(ok.minimum.passes, true);
  assert.equal(ok.high.exceeds, true, '1.35 at application is above 1.3');
  const short = cb.underwritingCheck({ years: years.slice(0, 10), rules });
  assert.equal(short.minimum.passes, null);
  assert.match(short.minimum.reason, /CHFA tests 15/);
  const low = cb.underwritingCheck({ years: years.map((y) => ({ year: y.year, allMustPayCoverage: y.year === 12 ? 1.1 : 1.2 })), rules });
  assert.equal(low.minimum.passes, false);
});

test('state credits stay a separate source with CHFA\'s limit; pay-in schedules need all three stages', () => {
  const s = cb.stateCredit({ annual: 500000, price: 0.8, creditType: '9', units: 60, awarded: true, rules });
  assert.equal(s.allowedAnnual, rules.rules.credit_cap_state_with_9pct.fixed_annual);
  assert.equal(s.equity, 500000 * 6 * 0.8);
  // The 9% pairing is a fixed amount, so any other amount is unknown, above or below it.
  for (const other of [100000, 600000]) {
    const o = cb.stateCredit({ annual: other, price: 0.8, creditType: '9', units: 60, awarded: true, rules });
    assert.equal(o.equity, null, other + ' is not the fixed pairing');
    assert.match(o.reason, /fixed \$500,000 of standard state credit/);
  }
  assert.equal(s.years, rules.rules.state_credit_term.years, 'six-year allocation from the rules file');
  // A 4% deal must say which CHFA application it is: each path has its own limit (QAP 3.L).
  const four = (path, units, extra) => cb.stateCredit(Object.assign({ annual: 2000000, price: 0.8, creditType: '4', units, path, awarded: true, rules }, extra));
  assert.equal(four(undefined, 50).equity, null);
  assert.match(four(undefined, 50).reason, /which CHFA state credit application/);
  assert.equal(four('bond_fall', 50).allowedAnnual, 500000, '$10,000 per unit for 50 units');
  assert.equal(four('bond_fall', 90).allowedAnnual, rules.rules.credit_cap_state_with_4pct.annual_cap);
  const acc = rules.rules.credit_cap_state_round_two_accelerated.annual_cap, std = rules.rules.credit_cap_state_round_two_standard.annual_cap;
  assert.equal(four('round_two', 50).allowedAnnual, acc);
  // Round Two takes the accelerated credit AND a paired standard credit, each with its own cap.
  const both = four('round_two', 50, { standardAnnual: 900000 });
  assert.equal(both.allowedAnnual, acc + std);
  assert.equal(both.equity, (acc + std) * 6 * 0.8);
  const alone = four('round_two', 50, { annual: null, standardAnnual: 400000 });
  assert.equal(alone.equity, null, 'the paired standard credit never stands alone');
  assert.match(alone.reason, /enter the accelerated amount/);
  assert.match(four('round_two', 50, { annual: 0, standardAnnual: 400000 }).reason, /enter the accelerated amount/, 'a $0 accelerated award is no award');
  assert.match(four('bond_fall', 50, { standardAnnual: 100000 }).reason, /Only Round Two/);
  // A path belongs to one federal credit type.
  assert.match(four('with_9pct', 50).reason, /federal 9% credits/);
  assert.equal(four('with_9pct', 50).equity, null);
  const nine = cb.stateCredit({ annual: 600000, price: 0.8, creditType: '9', units: 60, path: 'round_two', rules });
  assert.equal(nine.equity, null);
  assert.match(nine.reason, /federal 4% credits/);
  const noTerm = JSON.parse(JSON.stringify(rules)); delete noTerm.rules.state_credit_term;
  assert.match(cb.stateCredit({ annual: 400000, price: 0.8, creditType: '9', rules: noTerm }).reason, /rule not sourced/);
  // An awarded amount with no sourced limit has no enforceable cap: no equity, not the entered amount.
  assert(four('bond_fall', 60).equity > 0, 'non-vacuous: with its limit the stream has equity');
  const noCap = clone(rules); delete noCap.rules.credit_cap_state_with_4pct.source;
  const uncapped = four('bond_fall', 60, { rules: noCap });
  assert.equal(uncapped.equity, null);
  assert.match(uncapped.reason, /State credit limit: rule not sourced/);
  // Unknown units are not zero units.
  for (const units of [undefined, null, '', 0]) {
    const s0 = four('bond_fall', units);
    assert.equal(s0.equity, null, 'units ' + units);
    assert.equal(s0.allowedAnnual, null);
    assert.match(s0.reason, /number of units/);
  }
  assert.equal(cb.stateCredit({ annual: 400000, price: '', creditType: '9', rules }).equity, null);
  assert.equal(cb.stateCredit({ annual: null, rules }).entered, false);
  // The state three-test is not modeled, so a proposed amount within the limit is still not a source.
  const proposed = cb.stateCredit({ annual: 500000, price: 0.8, creditType: '9', units: 60, rules });
  assert.equal(proposed.allowedAnnual, 500000, 'non-vacuous: the amount passes the application limit');
  assert.equal(proposed.equity, null, 'a proposed state credit is not equity');
  assert.match(proposed.reason, /three-test/);
  const p = cb.payIn(1000000, { closing: 20, completion: 40, stabilization: 40 });
  assert.deepEqual(p.installments.map((i) => i.amount), [200000, 400000, 400000]);
  assert.match(cb.payIn(1000000, { closing: 20, completion: 40, stabilization: 30 }).reason, /90%/);
  assert.match(cb.payIn(1000000, {}).reason, /not entered/);
});

// Codex review of #2251: CHFA's reservation rules that Method One alone missed.
const base9 = (extra) => cb.basisAndCredit(Object.assign({ eligibleCost: 2000000, grantReduction: 0, designation: 'none',
  creditType: '9', creditRate: 0.09, units: 10, lowIncomeUnits: 10, acquisitionQualifies: true, rules }, extra));

test('on a 9% deal, acquisition basis earns the 4% acquisition rate and rehabilitation the 9% rate', () => {
  const r = base9({ acquisitionEligible: 1000000 });
  assert.equal(r.acquisitionRate, rules.rules.acquisition_credit_rate.floor);
  assert.equal(base9({ acquisitionEligible: 1000000, acquisitionApr: 0.045 }).acquisitionRate, 0.045, 'a floor, not a fixed rate');
  assert.equal(base9({ acquisitionEligible: 1000000, acquisitionApr: 0.03 }).acquisitionRate, 0.04);
  assert.equal(Math.round(r.calculatedCredit), 40000 + 90000);
  const four = cb.basisAndCredit({ eligibleCost: 2000000, grantReduction: 0, designation: 'none', creditType: '4', creditRate: 0.04,
    units: 10, lowIncomeUnits: 10, acquisitionEligible: 1000000, acquisitionQualifies: true, rules });
  assert.equal(Math.round(four.calculatedCredit), 80000);
  const unsourced = JSON.parse(JSON.stringify(rules)); delete unsourced.rules.acquisition_credit_rate;
  const u = base9({ acquisitionEligible: 1000000, rules: unsourced });
  assert.equal(u.calculatedCredit, null);
  assert.match(u.reasons.acquisitionRate, /rule not sourced/);
  assert.equal(Math.round(base9({ rules: unsourced }).calculatedCredit), 180000, 'no acquisition, no acquisition rate needed');
  // On a 9% deal the rates differ, so where a federal grant went changes the credit:
  // the split must be entered, never assumed.
  const unsplit = base9({ acquisitionEligible: 1000000, grantReduction: 1000000 });
  assert.equal(unsplit.calculatedCredit, null);
  assert.match(unsplit.reasons.afterGrant, /paid for the building purchase/);
  const onRehab = base9({ acquisitionEligible: 1000000, grantReduction: 1000000, grantOnAcquisition: 0 });
  assert.equal(Math.round(onRehab.calculatedCredit), 1000000 * 0.04, 'Codex example scaled: grant all on rehab');
  const onAcq = base9({ acquisitionEligible: 1000000, grantReduction: 1000000, grantOnAcquisition: 1000000 });
  assert.equal(Math.round(onAcq.calculatedCredit), 1000000 * 0.09);
  assert.match(base9({ acquisitionEligible: 1000000, grantReduction: 1000000, grantOnAcquisition: 1500000 }).reasons.afterGrant, /between \$0 and \$1,000,000/);
  // On a 4% deal both earn the same rate, so the proportional spread cannot change the credit.
  const fourSplit = cb.basisAndCredit({ eligibleCost: 2000000, grantReduction: 1000000, designation: 'none', creditType: '4', creditRate: 0.04,
    units: 10, lowIncomeUnits: 10, acquisitionEligible: 1000000, acquisitionQualifies: true, rules });
  assert.equal(Math.round(fourSplit.calculatedCredit), 1000000 * 0.04);
  assert.equal(Math.round(fourSplit.grantOnAcquisition), 500000);
  // A boost skips acquisition basis, so on a boosted 4% deal the split changes the credit too
  // (Codex's example: $10M purchase, $10M rehab, $10M grant all on the purchase -> $13M boosted).
  const boosted4 = (extra) => cb.basisAndCredit(Object.assign({ eligibleCost: 20000000, grantReduction: 10000000, designation: 'qct',
    evidence: 'HUD QCT list', creditType: '4', creditRate: 0.04, units: 10, lowIncomeUnits: 10, acquisitionEligible: 10000000,
    acquisitionQualifies: true, rules }, extra));
  assert.equal(boosted4({ designation: 'none' }).calculatedCredit > 0, true, 'no boost: proportional spread still stands');
  const unsplit4 = boosted4({});
  assert.equal(unsplit4.boost.applied, true, 'non-vacuous: the boost applies');
  assert.equal(unsplit4.calculatedCredit, null);
  assert.match(unsplit4.reasons.afterGrant, /boost does not apply to acquisition basis/);
  const onAcq4 = boosted4({ grantOnAcquisition: 10000000 });
  assert.equal(Math.round(onAcq4.boostedBasis), 13000000);
  assert.equal(Math.round(onAcq4.calculatedCredit), 13000000 * 0.04);
});

test('a federal grant reduces basis only by what it paid for in basis', () => {
  // Codex's example: a $2M federal grant spent on land must not reduce building basis.
  const withLand = (extra) => base9(Object.assign({ grantReduction: 2000000, ineligibleCost: 3000000 }, extra));
  const asked = withLand({});
  assert.equal(asked.calculatedCredit, null);
  assert.match(asked.reasons.afterGrant, /costs outside eligible basis/);
  assert.equal(Math.round(withLand({ grantOutsideBasis: 2000000 }).afterGrant), 2000000, 'all on land: basis untouched');
  assert.equal(Math.round(withLand({ grantOutsideBasis: 500000 }).afterGrant), 500000, 'part on land: only the rest reduces basis');
  assert.match(withLand({ grantOutsideBasis: 2500000 }).reasons.afterGrant, /between \$0 and \$2,000,000/);
  assert.equal(Math.round(base9({ grantReduction: 500000, ineligibleCost: 0 }).afterGrant), 1500000, 'nothing outside basis, nothing to ask');
  // Codex's overlap example: $1M basis, $500k fee excess, a $500k grant spent on that excess.
  const overlap = (extra) => base9(Object.assign({ eligibleCost: 1000000, feeExcess: 500000, grantReduction: 500000, ineligibleCost: 0 }, extra));
  assert.match(overlap({}).reasons.afterGrant, /fees above CHFA's limits/, 'a fee excess alone is a cost outside basis to ask about');
  assert.equal(Math.round(overlap({ grantOutsideBasis: 500000 }).afterGrant), 500000, 'the fee dollars come out once, not twice');
  assert.equal(Math.round(overlap({ grantOutsideBasis: 0 }).afterGrant), 0);
});

test('the applicable fraction is withheld when its rule is unsourced', () => {
  const unsourced = JSON.parse(JSON.stringify(rules)); delete unsourced.rules.applicable_fraction;
  const r = base9({ rules: unsourced });
  assert.equal(r.applicableFraction, null);
  assert.equal(r.qualifiedBasis, null);
  assert.equal(r.calculatedCredit, null);
  assert.equal(r.capacity, null);
  assert.match(r.reasons.applicableFraction, /Applicable fraction: rule not sourced/);
  assert(base9({}).calculatedCredit > 0, 'non-vacuous: sourced, it calculates');
});

test('a purchase a federal grant paid for in full needs no 42(d)(2) confirmation', () => {
  const covered = base9({ acquisitionEligible: 1000000, acquisitionQualifies: false, grantReduction: 1000000, grantOnAcquisition: 1000000 });
  assert.equal(Math.round(covered.calculatedCredit), 1000000 * 0.09, 'credit on the rehabilitation basis alone');
  const partly = base9({ acquisitionEligible: 1000000, acquisitionQualifies: false, grantReduction: 1000000, grantOnAcquisition: 400000 });
  assert.equal(partly.calculatedCredit, null, 'acquisition basis remains, so it still needs the confirmation');
  assert.match(partly.reasons.eligibleBasis, /42\(d\)\(2\)/);
  // On a 4% unboosted deal the split is optional, but an entry still decides what is left to confirm.
  const four = (extra) => cb.basisAndCredit(Object.assign({ eligibleCost: 2000000, grantReduction: 1000000, designation: 'none', creditType: '4',
    creditRate: 0.04, units: 10, lowIncomeUnits: 10, acquisitionEligible: 1000000, acquisitionQualifies: false, rules }, extra));
  assert.equal(Math.round(four({ grantOnAcquisition: 1000000 }).calculatedCredit), 1000000 * 0.04);
  assert.match(four({}).reasons.eligibleBasis, /grant that paid for it/);
});

test('capacity is the smaller of Method One and the gap calculation, and Method Three says it is not checked', () => {
  const gap = cb.gapCredit({ tdc: 2000000, otherSources: 1100000, price: 0.9, rules });
  assert.equal(gap.gap, 900000);
  assert.equal(Math.round(gap.credit), 100000, '$900,000 / 0.90 / 10 years');
  const r = base9({ gapCredit: gap });
  assert.equal(Math.round(r.calculatedCredit), 180000);
  assert.equal(Math.round(r.capacity), 100000);
  assert.equal(r.gapMethod.binding, true);
  assert.match(r.gapMethod.reason, /gap calculation/);
  assert.equal(Math.round(r.creditForEquity), 100000, 'equity uses the capacity when nothing is requested');
  assert.equal(Math.round(base9({ gapCredit: gap, requested: 150000 }).creditForEquity), 100000);
  assert.equal(base9({ gapCredit: gap, awarded: 150000 }).creditForEquity, 150000, 'an award is the award');
  assert.equal(base9({ gapCredit: cb.gapCredit({ tdc: 2000000, otherSources: 2500000, price: 0.9, rules }) }).capacity, 0);
  const big = base9({ gapCredit: cb.gapCredit({ tdc: 2000000, otherSources: 0, price: 0.9, rules }) });
  assert.equal(Math.round(big.capacity), 180000, 'a gap that needs more than Method One does not raise it');
  const unknown = cb.gapCredit({ tdc: 2000000, otherSources: NaN, otherReason: 'Mortgage unknown.', price: 0.9, rules });
  assert.equal(unknown.credit, null);
  // Method Two could be below Method One, so while it cannot run the capacity is unknown, not Method One.
  const keep = base9({ gapCredit: unknown });
  assert(keep.calculatedCredit > 0, 'non-vacuous: Method One alone has a value');
  assert.equal(keep.capacity, null);
  assert.equal(keep.creditForEquity, null, 'no equity from an unbounded capacity');
  assert.match(keep.reasons.capacity, /gap calculation.*Mortgage unknown\./);
  assert.equal(keep.gapMethod.reason, 'Mortgage unknown.');
  assert.equal(base9({ gapCredit: unknown, requested: 150000 }).creditForEquity, null, 'a request is limited by a capacity we cannot know');
  assert.equal(base9({ gapCredit: unknown, awarded: 150000 }).creditForEquity, 150000, 'an entered award is still the award');
  assert.match(r.costLimitMethod.reason, /Excel application/);
  assert.equal(r.costLimitMethod.checked, false);
  // Without the sourced reservation rule, Method Two is unknown too: no capacity, no equity.
  const noMethods = clone(rules); delete noMethods.rules.credit_reservation_methods;
  const nm = base9({ gapCredit: gap, rules: noMethods });
  assert(nm.calculatedCredit > 0, 'non-vacuous: Method One alone has a value');
  assert.equal(nm.capacity, null);
  assert.equal(nm.creditForEquity, null);
  assert.match(nm.reasons.capacity, /reservation rule.*rule not sourced/);
  assert.equal(base9({ gapCredit: gap, rules: noMethods, awarded: 150000 }).creditForEquity, 150000, 'an entered award is still the award');
});

test('an entered award survives a stopped basis calculation; an invalid mix stops it with its reason', () => {
  // Basis cannot be calculated (unconfirmed acquisition), but the award does not depend on it.
  const stopped = base9({ acquisitionEligible: 1000000, acquisitionQualifies: false, awarded: 150000 });
  assert.equal(stopped.calculatedCredit, null, 'non-vacuous: the calculation stopped');
  assert.match(stopped.reasons.eligibleBasis, /42\(d\)\(2\)/);
  assert.equal(stopped.creditForEquity, 150000);
  assert.equal(stopped.creditForEquityBasis, 'awarded');
  assert.equal(base9({ eligibleCost: null, costReason: 'Costs do not reconcile.', awarded: 150000 }).creditForEquity, 150000);
  assert.equal(base9({ eligibleCost: null, costReason: 'Costs do not reconcile.' }).creditForEquity, null, 'no award, no credit');
  assert.equal(base9({ eligibleCost: null, awarded: -5 }).creditForEquity, null, 'an invalid award is not an award');
  const invalid = base9({ invalidReason: 'Fix the unit mix.' });
  assert.equal(invalid.reasons.eligibleBasis, 'Fix the unit mix.');
  for (const k of ['qualifiedBasis', 'calculatedCredit', 'capacity', 'applicableFraction']) assert.equal(invalid[k], null, k);
  assert.equal(invalid.gapMethod.credit, null);
});

test('a fee above CHFA’s limit comes out of eligible basis, but only the part that was in basis', () => {
  const summary = cb.summarizeCosts(cb.exampleLines(), 20000000);
  const dev = cb.developerFeeTest({ developerFee: 2000000, consultantFee: 200000, base: 13000000, units: 40, rules });
  const ex = cb.feeExcessInBasis(summary, { excess: 0 }, dev);
  assert.equal(ex.developer, 250000);
  const r = base9({ feeExcess: ex.total });
  assert.equal(r.afterGrant, 2000000 - 250000);
  const contractor = cb.feeExcessInBasis(summary, { excess: 5000000 }, null);
  assert.equal(contractor.contractor, summary.eligibleById.overhead_profit, 'never more than the fee lines in basis');
  const lines = cb.exampleLines().map((l) => l.id === 'developer_fee' ? Object.assign({}, l, { basis: 'ineligible' }) : l);
  assert.equal(cb.feeExcessInBasis(cb.summarizeCosts(lines, 20000000), null, dev).developer, 0, 'a fee kept out of basis reduces nothing');
});

test('projects serving people experiencing homelessness keep acquisition in the developer-fee base', () => {
  const lines = cb.exampleLines().map((l) => l.id === 'building_acquisition' ? Object.assign({}, l, { amount: 2000000 }) :
    l.id === 'structures' ? Object.assign({}, l, { amount: 8400000 }) : l);
  const summary = cb.summarizeCosts(lines, 20000000);
  const ordinary = cb.developerFeeBase(summary, { excess: 0 }, false);
  const special = cb.developerFeeBase(summary, { excess: 0 }, true);
  assert.equal(special.base - ordinary.base, 1000000);
  assert.equal(special.acquisitionSubtracted, 0);
});

// The rules file: every applied value must agree with its own quote.
test('every rule cites a source that exists, with a location and a quote that states its value', () => {
  const HTTPS = 'https:' + '//';
  for (const [id, s] of Object.entries(rules.sources)) {
    assert(s.url.startsWith(HTTPS) && s.title && s.version, id);
  }
  let checked = 0;
  for (const [key, r] of Object.entries(rules.rules)) {
    assert(rules.sources[r.source], key + ' cites an unknown source');
    assert.equal(r.status, 'adopted', key);
    assert(r.location && r.quote && r.quote.length >= 20, key + ' needs a location and quote');
    checked++;
  }
  assert(checked >= 9, 'rules scanned');
  const R = rules.rules;
  const fmt = (n) => n.toLocaleString('en-US');
  assert(R.credit_cap_federal_9pct.quote.includes('$' + fmt(R.credit_cap_federal_9pct.annual_cap)));
  assert(R.credit_cap_state_with_9pct.quote.includes('a fixed amount of $' + fmt(R.credit_cap_state_with_9pct.fixed_annual)));
  assert(R.credit_cap_state_with_4pct.quote.includes('$' + fmt(R.credit_cap_state_with_4pct.annual_cap)));
  assert(R.credit_cap_state_with_4pct.quote.includes('$' + fmt(R.credit_cap_state_with_4pct.annual_cap_per_unit) + ' per unit'));
  assert(R.credit_cap_state_with_4pct.quote.includes('Private Activity Bonds') && R.credit_cap_state_with_4pct.quote.includes('September, October, and November'));
  assert(R.credit_cap_state_round_two_accelerated.quote.includes('$' + fmt(R.credit_cap_state_round_two_accelerated.annual_cap) + ' of accelerated'));
  assert(R.credit_cap_state_round_two_standard.quote.includes('$' + fmt(R.credit_cap_state_round_two_standard.annual_cap) + ' of standard'));
  assert(R.acquisition_credit_rate.quote.includes('floor is set at ' + R.acquisition_credit_rate.floor * 100 + ' percent'));
  assert(R.state_credit_term.quote.includes('total six-year allocation') && R.state_credit_term.years === 6);
  for (const k of ['credit_cap_state_round_two_accelerated', 'credit_cap_state_round_two_standard', 'credit_cap_state_with_4pct']) {
    assert.equal(R[k].federal_credit_type, '4', k);
    assert(R[k].quote.includes('4 percent') || R[k].quote.includes('Round Two'), k);
  }
  assert.equal(R.credit_cap_state_with_9pct.federal_credit_type, '9');
  assert(R.credit_reservation_methods.quote.includes('smallest'));
  assert(R.credit_reservation_methods.gap_quote.includes(R.credit_reservation_methods.gap_years + ' years'));
  assert(R.developer_fee_limit.acquisition_exception_quote.startsWith('Fifty percent of Acquisition cost (excluding projects serving'));
  assert(R.min_debt_coverage.quote.includes(R.min_debt_coverage.min_coverage + ' to 1.0'));
  assert(R.min_debt_coverage.quote.includes(R.min_debt_coverage.forecast_years + '-year'));
  assert(R.high_coverage_credit_reduction.quote.includes(R.high_coverage_credit_reduction.threshold + ' to 1.0'));
  assert(R.basis_boost.quote.includes(Math.round((R.basis_boost.multiplier - 1) * 100) + ' percent'));
  const top = R.contractor_fee_limit.tiers[0];
  assert.equal(R.contractor_fee_limit.tier_quote, top.min_units + ' units + ' + top.with_identity_of_interest * 100 + '% ' + top.without_identity_of_interest * 100 + '%');
  const dev = R.developer_fee_limit.tiers[0];
  assert.equal(R.developer_fee_limit.tier_quote, dev.min_units + ' units or more ' + dev.pct * 100 + '%');
  for (const type of ['federal_grant', 'federal_loan', 'nonfederal_grant']) assert.equal(typeof R.grant_basis_treatment.by_source_type[type].reduces_basis, 'boolean');
});

test('the developer-fee base is unknown while part of Total Development Cost is not itemized', () => {
  const lines = cb.exampleLines().map((l) => l.id === 'land' ? Object.assign({}, l, { amount: null }) : l);
  const summary = cb.summarizeCosts(lines, 20000000);
  assert(summary.notItemized > 0, 'non-vacuous: $1,000,000 is left unitemized');
  const base = cb.developerFeeBase(summary, { excess: 0 }, false);
  assert.equal(base.base, null);
  assert.match(base.reason, /Itemize the remaining \$1,000,000/);
  const test = cb.developerFeeTest({ developerFee: 1900000, consultantFee: 0, base: base.base, baseReason: base.reason, units: 60, rules });
  assert.equal(test.passes, null, 'an unknown base gives no pass or fail');
  assert.equal(test.reason, base.reason);
});

test('land is never in eligible basis, whatever its line says', () => {
  const base = cb.summarizeCosts(cb.exampleLines(), 20000000);
  const lines = cb.exampleLines().map((l) => l.id === 'land' ? Object.assign({}, l, { basis: 'eligible' }) : l);
  const summary = cb.summarizeCosts(lines, 20000000);
  assert(summary.byId.land > 0, 'non-vacuous: the example has land');
  assert.equal(summary.eligible, base.eligible);
  assert.equal(summary.eligibleById.land || 0, 0);
});

test('an untested developer fee in basis leaves the fee reduction, and so basis, unknown', () => {
  const lines = cb.exampleLines().map((l) => l.id === 'land' ? Object.assign({}, l, { amount: null }) : l);
  const summary = cb.summarizeCosts(lines, 20000000);
  const base = cb.developerFeeBase(summary, { excess: 0 }, false);
  const dev = cb.developerFeeTest({ developerFee: 1900000, consultantFee: 0, base: base.base, baseReason: base.reason, units: 60, rules });
  const excess = cb.feeExcessInBasis(summary, { excess: 0 }, dev);
  assert.equal(excess.total, null);
  assert.match(excess.reason, /could not be tested/);
  const b = cb.basisAndCredit({ eligibleCost: summary.eligible, grantReduction: 0, feeExcess: excess.total, feeReason: excess.reason,
    creditType: '9', units: 60, restrictedUnits: 60, rules });
  assert.equal(b.afterGrant, null);
  assert.equal(b.reasons.afterGrant, excess.reason);
  const tested = cb.feeExcessInBasis(cb.summarizeCosts(cb.exampleLines(), 20000000), { excess: 0 },
    cb.developerFeeTest({ developerFee: 1900000, consultantFee: 0, base: 17500000, units: 60, rules }));
  assert.equal(tested.total, 0, 'a fee within the limit takes nothing out');
});

test('an untested contractor fee in basis leaves the developer fee base and the basis reduction unknown', () => {
  const lines = cb.exampleLines().map((l) => ['structures', 'site_work', 'contractor_contingency'].includes(l.id) ? Object.assign({}, l, { amount: null })
    : l.id === 'general_requirements' ? Object.assign({}, l, { amount: l.amount + 11900000 }) : l);
  const summary = cb.summarizeCosts(lines, 20000000);
  const con = cb.contractorFeeTest({ byId: summary.byId, units: 60, rules });
  assert(con.fee > 0 && con.excess === null, 'non-vacuous: overhead and profit are entered but untestable');
  const base = cb.developerFeeBase(summary, con, false);
  assert.equal(base.base, null);
  assert.match(base.reason, /contractor fee could not be tested/);
  const excess = cb.feeExcessInBasis(summary, con, { status: { applied: true }, fee: 0, excess: 0 });
  assert.equal(excess.total, null);
  assert.match(excess.reason, /contractor fee could not be tested/);
});

test('a building purchase counts in basis only once the 42(d)(2) conditions are confirmed', () => {
  const unconfirmed = base9({ acquisitionEligible: 1000000, acquisitionQualifies: false });
  assert.equal(unconfirmed.calculatedCredit, null);
  assert.match(unconfirmed.reasons.eligibleBasis, /42\(d\)\(2\)/);
  // 42(d)(2)(B)(iv): the purchase also needs a rehabilitation that earns its own 42(e) credit.
  // The reason and the box the user ticks must ask for the same conditions.
  const page = require('node:fs').readFileSync(require('node:path').join(__dirname, '../js/deal-calculator.js'), 'utf8');
  const box = /id="dc-acq-42d2"[^>]*>\s*<span>([^<]+)<\/span>/.exec(page);
  assert(box, 'non-vacuous: the confirmation box is on the page');
  for (const [name, words] of [['reason', unconfirmed.reasons.eligibleBasis], ['checkbox', box[1]]]) {
    assert.match(words, /unrelated party/, name + ' names the related-party test');
    assert.match(words, /ten years/, name + ' names the ten-year test');
    assert.match(words, /42\(e\)/, name + ' names the rehabilitation test');
  }
  assert(base9({ acquisitionEligible: 1000000 }).calculatedCredit > 0, 'confirmed, it counts');
  assert(base9({ acquisitionEligible: 0, acquisitionQualifies: false }).calculatedCredit > 0, 'no purchase in basis, nothing to confirm');
});

test('reserves are never in eligible basis, whatever their line says', () => {
  const base = cb.summarizeCosts(cb.exampleLines(), 20000000);
  const summary = cb.summarizeCosts(cb.exampleLines().map((l) => l.id === 'reserves' ? Object.assign({}, l, { basis: 'eligible' }) : l), 20000000);
  assert(summary.byId.reserves > 0, 'non-vacuous: the example has reserves');
  assert.equal(summary.eligible, base.eligible);
});

test('zero LIHTC floor space with LIHTC units is not a measurement', () => {
  const r = base9({ units: 10, lowIncomeUnits: 6, residentialSf: 8000, lowIncomeSf: 0 });
  assert.equal(r.applicableFraction, null);
  assert.match(r.reasons.applicableFraction, /floor space/);
});

test('an unknown unit count gives no applicable fraction, even with zero LIHTC units', () => {
  for (const units of [null, 0]) {
    const r = base9({ units, lowIncomeUnits: 0 });
    assert.equal(r.applicableFraction, null);
    assert.match(r.reasons.applicableFraction, /number of units/);
  }
  assert.equal(base9({ units: 10, lowIncomeUnits: 0 }).applicableFraction, 0, 'a known project with no LIHTC units is 0%');
});

test('the invented example budget totals the calculator\'s default Total Development Cost', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'deal-calculator.js'), 'utf8');
  const m = src.match(/id="dc-tdc"[^>]*value="(\d+)"/);
  assert(m, 'found the default Total Development Cost');
  const total = cb.exampleLines().reduce((a, l) => a + (l.amount || 0), 0);
  assert.equal(total, Number(m[1]));
  assert.match(fs.readFileSync(path.join(ROOT, 'js', 'deal-cost-basis.js'), 'utf8'), /INVENTED example budget/);
});


// DOH layout (Housing Development Analysis spreadsheet, Development Costs tab).
test('the cost lines are DOH\'s nine categories, in its order, and every line sits in one of them', () => {
  assert.deepEqual(cb.GROUPS.map((g) => g.label), ['Acquisition', 'Site improvements', 'Construction', 'Professional fees',
    'Construction finance', 'Permanent finance and syndication', 'Soft costs', 'Developer fee', 'Reserves']);
  const ids = new Set(cb.GROUPS.map((g) => g.id));
  for (const l of cb.LINE_TEMPLATE) assert(ids.has(l.group), l.id + ' sits in a DOH category');
  assert.equal(new Set(cb.LINE_TEMPLATE.map((l) => l.id)).size, cb.LINE_TEMPLATE.length, 'no line id repeats');
  // The lists the CHFA rules read name only lines that exist.
  const lineIds = new Set(cb.LINE_TEMPLATE.map((l) => l.id));
  for (const list of ['CONTRACTOR_FEE_IDS', 'CONTRACTOR_BASE_IDS', 'DEVELOPER_FEE_IDS', 'RESERVE_IDS', 'CONTRACT_IDS', 'HARD_COST_IDS']) {
    for (const id of cb[list]) assert(lineIds.has(id), list + ': ' + id + ' is a line');
  }
  for (const id of cb.RESERVE_IDS) assert(cb.NEVER_IN_BASIS[id], id + ' is never in basis');
  // DOH stars the lines in its hard-cost evaluation; its "Other" lines, where escalation sits, are not starred.
  for (const id of ['escalation', 'construction_other', 'ffe']) assert(!cb.HARD_COST_IDS.includes(id), id + ' is not a DOH hard cost');
  assert.equal(cb.HARD_COST_IDS.length, 11, 'DOH stars 11 hard-cost lines (Tap Fees / Impact Fees is one line)');
  for (const target of Object.values(cb.LEGACY_LINES)) assert(lineIds.has(target), 'old lines load into a real line: ' + target);
});

test('the DOH example keeps the earlier example\'s total, basis and fee tests', () => {
  const s = cb.summarizeCosts(cb.exampleLines(), 20000000);
  assert.equal(s.itemized, 20000000);
  assert.equal(s.eligible, 18200000);
  const c = cb.contractorFeeTest({ byId: s.byId, units: 60, rules });
  assert.equal(c.fee, 750000);
  assert.equal(c.base, 10400000 + 1000000 + 500000, 'construction, on-site work and the contractor contingency (QAP 3.M.3)');
});

test('CHFA\'s fee limit counts the developer and consultant fees; DOH\'s share adds the administration fee', () => {
  const lines = cb.exampleLines().map((l) => l.id === 'admin_fee' ? Object.assign({}, l, { amount: 100000 })
    : l.id === 'lease_up_reserve' ? Object.assign({}, l, { amount: 200000 })
    : l.id === 'structures' ? Object.assign({}, l, { amount: 10100000 }) : l);
  const s = cb.summarizeCosts(lines, 20000000);
  assert.equal(s.itemized, 20000000, 'non-vacuous: the budget still balances');
  const c = cb.contractorFeeTest({ byId: s.byId, units: 60, rules });
  // lihtc-underwriting-rules.json: the limit is tested on the developer fee plus the consultant fee.
  assert.match(rules.rules.developer_fee_limit.tested_on, /Developer fee plus consultant fee/);
  assert.equal(cb.developerFeeBase(s, c).base, 20000000 - 1000000 - 1900000 - (500000 + 200000));
  const share = cb.dohDeveloperFeeShare(s);
  assert.equal(share.fee, 2000000);
  assert.equal(share.base, 20000000 - 2000000 - 700000 - 1000000, 'DOH: total less fee, reserves and acquisition');
  // Existing structures are acquisition too.
  const bought = cb.summarizeCosts(lines.map((l) => l.id === 'building_acquisition' ? Object.assign({}, l, { amount: 300000 })
    : l.id === 'structures' ? Object.assign({}, l, { amount: 9800000 }) : l), 20000000);
  assert.equal(bought.itemized, 20000000, 'non-vacuous: the budget still balances');
  assert.equal(cb.dohDeveloperFeeShare(bought).base, 20000000 - 2000000 - 700000 - 1000000 - 300000);
});

test('DOH\'s hard, land and soft cost per unit and per square foot add up to the total', () => {
  const s = cb.summarizeCosts(cb.exampleLines(), 20000000);
  const p = cb.costPerSf({ units: 80, residentialSf: 64000, byId: s.byId, total: 20000000, contract: s.contract });
  const hard = cb.sumIds(s.byId, cb.HARD_COST_IDS);
  assert.equal(p.hardPerUnit.value, hard / 80);
  assert.equal(p.landPerUnit.value, 1000000 / 80);
  assert(Math.abs((p.hardPerUnit.value + p.landPerUnit.value + p.softPerUnit.value) * 80 - 20000000) < 0.01, 'the three parts are the whole');
  assert.equal(p.softPerSf.value, (20000000 - hard - 1000000) / 64000);
  const none = cb.costPerSf({ byId: s.byId, total: 20000000 });
  assert.equal(none.hardPerUnit.value, null);
  assert.match(none.hardPerUnit.reason, /number of units/);
  assert.equal(cb.costPerSf({ units: 80, byId: null, total: 20000000, costReason: 'Costs do not reconcile.' }).hardPerUnit.reason, 'Costs do not reconcile.');
  // A budget itemized below the total cannot be split: the rest could be hard, land or soft.
  const short = cb.summarizeCosts(cb.exampleLines().map((l) => l.id === 'structures' ? Object.assign({}, l, { amount: 9400000 }) : l), 20000000);
  assert.equal(short.notItemized, 1000000, 'non-vacuous: $1M is not itemized');
  const split = cb.costPerSf({ units: 80, residentialSf: 64000, byId: short.byId, total: 20000000, notItemized: short.notItemized });
  for (const k of ['hardPerUnit', 'landPerUnit', 'softPerUnit', 'hardPerSf', 'landPerSf', 'softPerSf']) {
    assert.equal(split[k].value, null, k);
    assert.match(split[k].reason, /Itemize all of Total Development Cost/);
  }
});

test('cost lines saved before the DOH layout load into the DOH lines with the same basis', () => {
  const saved = { 'cost-overhead': '250000', 'cost-overhead-basis': 'eligible', 'cost-profit': '500000', 'cost-profit-basis': 'eligible',
    'cost-financing': '1200000', 'cost-financing-basis': 'partial', 'cost-financing-eligible': '900000' };
  const read = (k) => (k in saved ? saved[k] : null);
  const m = cb.legacyCostFields(read);
  assert.equal(m['cost-overhead_profit'], '750000');
  assert.equal(m['cost-overhead_profit-basis'], 'eligible', 'the same choice on both stays that choice');
  assert.equal(m['cost-soft_other'], '1200000');
  assert.equal(m['cost-soft_other-eligible'], '900000');
  // Different choices: partly in basis, with the sum of the in-basis parts.
  const mixed = cb.legacyCostFields((k) => ({ 'cost-overhead': '250000', 'cost-overhead-basis': 'eligible', 'cost-profit': '500000', 'cost-profit-basis': 'ineligible' })[k] ?? null);
  assert.equal(mixed['cost-overhead_profit-basis'], 'partial');
  assert.equal(mixed['cost-overhead_profit-eligible'], '250000');
  // A line saved under its new name wins, and nothing is invented for lines never saved.
  assert.deepEqual(cb.legacyCostFields((k) => ({ 'cost-overhead_profit': '1', 'cost-overhead': '250000' })[k] ?? null), {});
  assert.deepEqual(cb.legacyCostFields(() => null), {});
  // An old link empties the DOH lines it could not name, and only those.
  const cleared = cb.legacyCostFields((k) => ({ 'cost-financing': '1200000', 'cost-bonds': '120000' })[k] ?? null);
  for (const id of ['construction_interest', 'perm_loan_fees', 'tax_credit_fees', 'marketing']) assert.equal(cleared['cost-' + id], '', id);
  for (const id of cb.PRE_DOH_IDS) assert(!('cost-' + id in cleared), id + ' keeps what the link saved');
  assert.equal(cleared['cost-soft_other'], '1200000');
  // The migrated budget gives the same basis as the old one.
  const lines = cb.exampleLines().map((l) => ({ ...l, amount: null }));
  const set = (id, amount, basis, eligibleAmount) => Object.assign(lines.find((l) => l.id === id), { amount, basis, eligibleAmount });
  set('overhead_profit', +m['cost-overhead_profit'], m['cost-overhead_profit-basis']);
  set('soft_other', +m['cost-soft_other'], m['cost-soft_other-basis'], +m['cost-soft_other-eligible']);
  const s = cb.summarizeCosts(lines, 1950000);
  assert.equal(s.eligible, 750000 + 900000);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
