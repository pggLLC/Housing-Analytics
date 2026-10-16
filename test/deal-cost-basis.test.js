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
    residentialSf: c.residentialSf, lowIncomeSf: c.lowIncomeSf, requested: c.requested, awarded: c.awarded, rules: ruleFile }) };
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
  assert.equal(round(result.capacity), cases.basisCase.expected.calculatedCredit);
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
  const { result } = runBasisCase(cases.basisCase, rules, { lines, tdc: 21600000 });
  // The case's $500,000 federal grant is spread over $1,000,000 acquisition and $18,200,000 other basis.
  const grantOnAcq = 500000 * 1000000 / 19200000;
  assert.equal(round(result.boostedBasis), round((18200000 - (500000 - grantOnAcq)) * 1.3 + (1000000 - grantOnAcq)));
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
  assert.equal(s.contract, s.groups.contract);
  assert(s.contract < s.itemized);
  assert.equal(Object.values(s.groups).reduce((a, b) => a + b, 0), s.itemized, 'groups partition the uses');
  assert.equal(s.notItemized, 1000000);
  assert.equal(s.eligible + s.ineligible, 21000000);
  const over = cb.summarizeCosts(lines, 19000000);
  assert.equal(over.eligible, null);
  assert.match(over.reason, /more than Total Development Cost/);
  assert.match(cb.summarizeCosts([], 20000000).reason, /Itemize/);
  const partial = clone(lines); partial.find((l) => l.id === 'financing').eligibleAmount = null;
  assert.match(cb.summarizeCosts(partial, 20000000).reason, /eligible part of Financing/);
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
  const s = cb.stateCredit({ annual: 600000, price: 0.8, creditType: '9', units: 60, rules });
  assert.equal(s.allowedAnnual, 500000);
  assert.equal(s.equity, 500000 * 6 * 0.8);
  assert.match(s.capReason, /capped at \$500,000/);
  assert.equal(s.years, rules.rules.state_credit_term.years, 'six-year allocation from the rules file');
  // A 4% deal must say which CHFA application it is: each path has its own limit (QAP 3.L).
  const four = (path, units, extra) => cb.stateCredit(Object.assign({ annual: 2000000, price: 0.8, creditType: '4', units, path, rules }, extra));
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
  // Unknown units are not zero units.
  for (const units of [undefined, null, '', 0]) {
    const s0 = four('bond_fall', units);
    assert.equal(s0.equity, null, 'units ' + units);
    assert.equal(s0.allowedAnnual, null);
    assert.match(s0.reason, /number of units/);
  }
  assert.equal(cb.stateCredit({ annual: 400000, price: '', creditType: '9', rules }).equity, null);
  assert.equal(cb.stateCredit({ annual: null, rules }).entered, false);
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
  // A federal grant is spread over acquisition and other basis, not charged to one first.
  const g = base9({ acquisitionEligible: 1000000, grantReduction: 1000000 });
  assert.equal(Math.round(g.grantOnAcquisition), 500000);
  assert.equal(Math.round(g.calculatedCredit), 500000 * 0.04 + 500000 * 0.09);
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
  const keep = base9({ gapCredit: unknown });
  assert.equal(Math.round(keep.capacity), 180000);
  assert.equal(keep.gapMethod.reason, 'Mortgage unknown.');
  assert.match(r.costLimitMethod.reason, /Excel application/);
  assert.equal(r.costLimitMethod.checked, false);
});

test('a fee above CHFA’s limit comes out of eligible basis, but only the part that was in basis', () => {
  const summary = cb.summarizeCosts(cb.exampleLines(), 20000000);
  const dev = cb.developerFeeTest({ developerFee: 2000000, consultantFee: 200000, base: 13000000, units: 40, rules });
  const ex = cb.feeExcessInBasis(summary, { excess: 0 }, dev);
  assert.equal(ex.developer, 250000);
  const r = base9({ feeExcess: ex.total });
  assert.equal(r.afterGrant, 2000000 - 250000);
  const contractor = cb.feeExcessInBasis(summary, { excess: 5000000 }, null);
  assert.equal(contractor.contractor, summary.eligibleById.overhead + summary.eligibleById.profit, 'never more than the fee lines in basis');
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
  assert(R.credit_cap_state_with_9pct.quote.includes('$' + fmt(R.credit_cap_state_with_9pct.annual_cap)));
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
