#!/usr/bin/env node
'use strict';
// #2161 (K1): a credit added to the stack reports gross and net new equity. The
// cases and expected values are INVENTED (test/fixtures/credit-stack/invented.json),
// computed independently of js/deal-cost-basis.js.
const assert = require('node:assert/strict');
const cb = require('../js/deal-cost-basis.js');
const rules = require('../data/policy/lihtc-underwriting-rules.json');
const fx = require('./fixtures/credit-stack/invented.json');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}

const stateYears = rules.rules.state_credit_term.years;
const fedCut = (annual) => ({ annual: annual == null ? null : annual, years: fx.federal.years, price: fx.federal.price, maxAnnual: fx.federal.annual });
const stateDisplaced = (annual) => ({ label: 'Colorado state credit', annual, years: stateYears, price: fx.state.price, maxAnnual: fx.state.annual });
function added(over) {
  return Object.assign({ kind: 'other', annual: fx.added.annual, years: fx.added.years, price: fx.added.price, fees: fx.added.fees,
    mode: 'supplement', federalCut: fedCut(null), rules }, over);
}

console.log('Deal Calculator credit stacking (#2161)');
assert.equal(fx.invented, true, 'the fixture is marked invented');

test('base: federal and state equity are each annual x years x price', () => {
  assert.equal(fx.federal.annual * fx.federal.years * fx.federal.price, fx.federal.expectedEquity);
  const st = cb.stateCredit({ annual: fx.state.annual, price: fx.state.price, awarded: true, creditType: fx.state.creditType, path: fx.state.path, rules });
  assert.equal(st.reason, null);
  assert.equal(stateYears, 6);
  assert.equal(st.equity, fx.state.expectedEquity);
});

test('supplement: gross equity less new fees', () => {
  const r = cb.addedCredit(added({ mode: fx.cases.supplement.mode }));
  assert.equal(r.reason, null);
  for (const [k, v] of Object.entries(fx.cases.supplement.expected)) assert.equal(r[k], v, k);
});

test('substitute: the replaced state credit\'s equity comes off, and net can be negative', () => {
  const c = fx.cases.substitute;
  const r = cb.addedCredit(added({ mode: c.mode, displaced: stateDisplaced(c.displacedStateAnnual) }));
  assert.equal(r.reason, null);
  for (const [k, v] of Object.entries(c.expected)) assert.equal(r[k], v, k);
  assert.equal(r.displaces, 'Colorado state credit');
});

test('a replaced credit counts only its equity after its own investor fees (netShare)', () => {
  const c = fx.cases.substitute;
  const r = cb.addedCredit(added({ mode: c.mode, displaced: Object.assign(stateDisplaced(c.displacedStateAnnual), { netShare: 0.5 }) }));
  assert.equal(r.displaced, c.expected.displaced / 2);
});

test('resized federal: a federal cut is priced at the federal years and price', () => {
  const c = fx.cases.resizedFederal;
  const r = cb.addedCredit(added({ mode: c.mode, federalCut: fedCut(c.federalCutAnnual) }));
  assert.equal(r.reason, null);
  for (const [k, v] of Object.entries(c.expected)) assert.equal(r[k], v, k);
});

test('a location- or designation-based credit is eligibility unknown until evidence is entered', () => {
  const none = cb.addedCredit(added({ kind: 'designation' }));
  assert.equal(none.eligibility, 'unknown');
  assert.equal(none.gross, null); assert.equal(none.net, null);
  assert.match(none.reason, /eligibility unknown/);
  const ok = cb.addedCredit(added({ kind: 'designation', evidence: 'Invented: designation letter' }));
  assert.equal(ok.eligibility, 'evidence entered');
  assert.equal(ok.net, fx.cases.supplement.expected.net);
});

test('a Transit Zone credit needs the site in a zone on the Market Analysis map and the evidence', () => {
  const ev = { kind: 'tz', evidence: 'Invented: OEDIT map printout' };
  const unknown = cb.addedCredit(added(Object.assign({}, ev, { inZone: null })));
  assert.equal(unknown.eligibility, 'unknown'); assert.equal(unknown.net, null);
  assert.match(unknown.reason, /^Transit Zone credit eligibility unknown/);
  const outside = cb.addedCredit(added(Object.assign({}, ev, { inZone: false })));
  assert.equal(outside.eligibility, 'not in a zone'); assert.equal(outside.net, null);
  const noEvidence = cb.addedCredit(added({ kind: 'tz', inZone: true }));
  assert.equal(noEvidence.eligibility, 'unknown'); assert.equal(noEvidence.net, null);
  const ok = cb.addedCredit(added(Object.assign({}, ev, { inZone: true })));
  assert.equal(ok.eligibility, 'evidence entered');
  assert.equal(ok.net, fx.cases.supplement.expected.net);
  assert.equal(ok.label, 'Transit Zone credit');
});

test('an award reduction is flagged only from a cited rule; otherwise "rule not sourced"', () => {
  assert.equal(rules.rules.added_credit_award_reduction, undefined, 'the rules file cites no such rule today');
  const r = cb.addedCredit(added());
  assert.deepEqual(r.awardReduction, { sourced: false, text: 'rule not sourced', citation: null });
  const cited = JSON.parse(JSON.stringify(rules));
  cited.rules.added_credit_award_reduction = { status: 'adopted', source: Object.keys(cited.sources)[0], location: 'Invented section', effect: 'CHFA may reduce the federal award' };
  const s = cb.addedCredit(added({ rules: cited }));
  assert.equal(s.awardReduction.sourced, true);
  assert.match(s.awardReduction.text, /^Possible: CHFA may reduce the federal award/);
  assert.match(s.awardReduction.citation, /Invented section/);
  cited.rules.added_credit_award_reduction.status = 'draft';
  assert.equal(cb.addedCredit(added({ rules: cited })).awardReduction.text, 'rule not sourced', 'a draft rule is not a cited effect');
});

test('missing inputs are unknown with a reason, never $0', () => {
  const cases = [
    [{ annual: '' }, /other credit/], [{ years: '' }, /years/], [{ years: 2.5 }, /whole number of years/], [{ price: '' }, /investor price/],
    [{ mode: null }, /adds to the other credits or replaces/], [{ fees: '' }, /investor fees.*\$0 if none/],
    [{ mode: 'substitute' }, /which credit/], [{ mode: 'substitute', displaced: stateDisplaced('') }, /annual colorado state credit it replaces/],
    [{ mode: 'substitute', displaced: stateDisplaced(500000) }, /cannot replace more/],
    [{ federalCut: fedCut(2000000) }, /more than the/], [{ federalCut: Object.assign(fedCut(5000), { maxAnnual: null }) }, /federal credit is not available/]
  ];
  for (const [over, re] of cases) {
    const r = cb.addedCredit(added(over));
    assert.equal(r.net, null, JSON.stringify(over));
    assert.match(r.reason, re, JSON.stringify(over));
  }
  assert.equal(cb.addedCredit({ kind: '' }).entered, false);
});

test('state credit investor fees come out of state equity; blank is none', () => {
  const base = { annual: fx.state.annual, price: fx.state.price, awarded: true, creditType: fx.state.creditType, path: fx.state.path, rules };
  assert.equal(cb.stateCredit(base).equity, fx.state.expectedEquity);
  const f = cb.stateCredit(Object.assign({}, base, { fees: 20000 }));
  assert.equal(f.grossEquity, fx.state.expectedEquity);
  assert.equal(f.equity, fx.state.expectedEquity - 20000);
  const bad = cb.stateCredit(Object.assign({}, base, { fees: -1 }));
  assert.equal(bad.equity, null); assert.match(bad.reason, /investor fees of \$0 or more/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
