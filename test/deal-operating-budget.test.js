#!/usr/bin/env node
'use strict';
// DOH PR 2: the operating budget in the Division of Housing's four expense groups,
// its other income lines, and old links that carried one monthly figure. All
// amounts are INVENTED. Engine figures are compared with the engine's own
// single-figure path, not with numbers copied here.
const assert = require('node:assert/strict');
const ob = require('../js/deal-operating-budget.js');
const { computeDeal } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}
function withBudget(scenario, lines, income) {
  const i = inputsFor(scenario);
  delete i.fields['dc-opex'];
  i.operatingLines = lines || ob.exampleLines();
  i.otherIncomeLines = income || ob.exampleIncome();
  return i;
}
const close = (a, b, msg) => assert(Math.abs(a - b) < 0.01, msg + ': ' + a + ' vs ' + b);

console.log('Deal Calculator operating budget (DOH PR 2)');

test('the four DOH expense groups are in DOH order, with DOH\'s lines', () => {
  assert.deepEqual(ob.GROUPS.map(g => g.label), ['Administrative expenses', 'Operating expenses', 'Maintenance expenses', 'Other expenses']);
  const counts = ob.GROUPS.map(g => ob.LINE_TEMPLATE.filter(l => l.group === g.id).length
    + ob.SEPARATE_LINES.filter(l => l.group === g.id).length);
  assert.deepEqual(counts, [8, 3, 5, 4], 'DOH: 8 administrative, 3 operating, 5 maintenance, 4 other');
  assert.deepEqual(ob.SEPARATE_LINES.map(l => l.input), ['dc-prop-tax', 'dc-rep-reserve']);
  assert.deepEqual(ob.INCOME_TEMPLATE.map(l => l.id), ['parking', 'laundry', 'fees']);
  assert.equal(new Set(ob.LINE_TEMPLATE.map(l => l.id)).size, ob.LINE_TEMPLATE.length);
});

test('the invented example totals the old $450 a month and has no other income', () => {
  const s = ob.summarizeOperating(ob.exampleLines(), ob.exampleIncome());
  assert.equal(s.reason, null);
  assert.equal(s.perUnitYear, 5400);
  assert.equal(s.perUnitMonth, 450);
  assert.equal(s.otherIncomePerUnitYear, 0);
  assert.equal(Object.values(s.groups).reduce((a, b) => a + b, 0), 5400, 'group subtotals add to the total');
  assert.deepEqual(ob.pupaExpenses(s, '900', '350'), { value: 6650, reason: null }, 'DOH per unit per year adds taxes and the reserve');
});

test('a blank line is nothing budgeted, but a blank budget is unknown, never $0', () => {
  const lines = ob.exampleLines();
  lines[0].amount = null;
  assert.equal(ob.summarizeOperating(lines, []).perUnitYear, 5400 - ob.EXAMPLE_BUDGET.management_fee);
  const blank = ob.summarizeOperating(ob.exampleLines().map(l => Object.assign(l, { amount: '' })), ob.exampleIncome());
  assert.equal(blank.perUnitYear, null);
  assert.match(blank.reason, /Enter the operating budget/);
  const negative = ob.exampleLines(); negative[3].amount = '-5';
  assert.match(ob.summarizeOperating(negative, []).reason, /Advertising/);
  assert.equal(ob.pupaExpenses(blank, '900', '350').value, null);
  assert.match(ob.pupaExpenses(ob.summarizeOperating(ob.exampleLines(), []), '', '350').reason, /property tax/);
});

test('the example budget leaves every engine result as the single $450 figure did', () => {
  for (const scenario of ['A', 'B']) {
    const old = computeDeal(inputsFor(scenario));
    const doh = computeDeal(withBudget(scenario));
    assert(Number.isFinite(old.noi) && old.noi > 0, 'non-vacuous NOI');
    for (const key of ['noi', 'annualOpex', 'mortgage', 'gap', 'breakEvenOcc', 'baseDSCR', 'allMustPayDSCR']) {
      assert.deepEqual(doh[key], old[key], scenario + ' ' + key);
    }
    assert.deepEqual(doh.stress, old.stress, scenario + ' stress');
    assert.deepEqual(doh.projection.rows.map(r => r.noi), old.projection.rows.map(r => r.noi), scenario + ' projection');
  }
});

test('other income is added before vacancy and is not cut by the rent stress', () => {
  const base = computeDeal(withBudget('A'));
  const income = ob.exampleIncome(); income[0].amount = 120; income[1].amount = 60;
  const r = computeDeal(withBudget('A', null, income));
  const units = +inputsFor('A').fields['dc-units'];
  const extra = 180 * units;
  assert.equal(r.annualOtherIncome, extra);
  close(r.noi - base.noi, extra * (1 - r.vacancyRate), 'NOI rises by other income after vacancy');
  close(r.stress.rent10.noi - base.stress.rent10.noi, extra * (1 - r.vacancyRate), 'rent stress leaves other income whole');
  close(r.projection.rows[1].otherIncome, extra * (1 + r.exit.rentGrowth), 'other income grows with rent');
  const total = r.annualRents + extra;
  close(r.breakEvenOcc, Math.min((r.annualOpex + r.annualRepReserve + r.netPropTax + r.allMustPayDebtService) / total, 1), 'break-even counts all income');
});

test('a blank budget makes NOI unknown with the budget\'s reason', () => {
  const r = computeDeal(withBudget('A', ob.exampleLines().map(l => Object.assign(l, { amount: null }))));
  assert.equal(r.noi, null);
  assert.match(r.unavailable.noi, /Enter the operating budget/);
  assert.equal(r.projection, null);
});

test('old links: the monthly figure loads, times 12, into Other expenses, Other', () => {
  const read = obj => key => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null);
  const out = ob.legacyOperatingFields(read({ opex: '500' }));
  assert.equal(out['op-other_other'], '6000');
  ob.LINE_TEMPLATE.filter(t => t.id !== 'other_other').forEach(t => assert.equal(out['op-' + t.id], '', t.id + ' emptied'));
  ob.INCOME_TEMPLATE.forEach(t => assert.equal(out['op-income-' + t.id], '', t.id + ' emptied'));
  assert.equal(ob.legacyOperatingFields(read({ opex: '' }))['op-other_other'], '', 'a blank old figure stays unknown');
  assert.deepEqual(ob.legacyOperatingFields(read({ opex: '500', 'op-utilities': '900' })), {}, 'a DOH-era link is left alone');
  assert.deepEqual(ob.legacyOperatingFields(read({})), {}, 'no old figure, nothing to map');
  // The mapped budget gives the engine the same NOI as the old figure did.
  const i = inputsFor('A'); i.fields['dc-opex'] = '500';
  const old = computeDeal(i);
  const lines = ob.LINE_TEMPLATE.map(t => ({ id: t.id, label: t.label, group: t.group, amount: out['op-' + t.id] === '' ? null : out['op-' + t.id] }));
  const mapped = computeDeal(withBudget('A', lines, []));
  assert.equal(mapped.noi, old.noi);
});

test('manual NOI keeps a finite OpEx sensitivity read from the budget', () => {
  const i = withBudget('A');
  const auto = computeDeal(i);
  i.fields['dc-auto-noi'] = false; i.fields['dc-noi'] = String(auto.noi);
  const r = computeDeal(i);
  assert(r.tornado && Number.isFinite(r.tornado.noiLo) && Number.isFinite(r.tornado.noiHi), 'tornado OpEx row is finite');
  assert.equal(r.tornado.ou, 450, 'the swing starts from the budget\'s $450 a month');
  const blank = withBudget('A', ob.exampleLines().map(l => Object.assign(l, { amount: null })));
  blank.fields['dc-auto-noi'] = false; blank.fields['dc-noi'] = String(auto.noi);
  assert.equal(computeDeal(blank).tornado, null, 'no budget, no OpEx swing');
  // Other income entered on the budget still reaches the swing and the result in manual mode.
  const income = ob.exampleIncome(); income[1].amount = 120;
  const withIncome = withBudget('A', null, income);
  withIncome.fields['dc-auto-noi'] = false; withIncome.fields['dc-noi'] = String(auto.noi);
  const m = computeDeal(withIncome);
  assert.equal(m.annualOtherIncome, 120 * +withIncome.fields['dc-units']);
  close(m.tornado.vacHiEgi - r.tornado.vacHiEgi, m.annualOtherIncome * (1 - Math.max(0.01, (r.tornado.vu - 2) / 100)), 'vacancy swing counts other income');
});

test('the example is labelled invented in the module', () => {
  assert.match(require('node:fs').readFileSync(require.resolve('../js/deal-operating-budget.js'), 'utf8'), /INVENTED example/);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
