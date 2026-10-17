#!/usr/bin/env node
'use strict';
// DOH PR 2 on the real Deal Calculator page (jsdom, page scripts in order). The
// page's figures must agree with js/deal-operating-budget.js and the engine, not
// with numbers copied here. The prefilled budget is the module's INVENTED example.
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const ob = require('../js/deal-operating-budget.js');

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const text = (p, id) => p.d.getElementById(id).textContent.trim();
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}

(async () => {
  console.log('Deal Calculator operating budget on the page (DOH PR 2)');
  await test('the default page shows the example budget by DOH group, with totals the module computes', async () => {
    const p = await openPage('');
    const s = ob.summarizeOperating(ob.exampleLines(), ob.exampleIncome());
    const units = +p.d.getElementById('dc-units').value;
    assert.equal(text(p, 'dc-op-total'), money(s.perUnitYear) + ' (' + money(s.perUnitMonth) + ' a month)');
    const pupa = ob.pupaExpenses(s, p.d.getElementById('dc-prop-tax').value, p.d.getElementById('dc-rep-reserve').value);
    assert.equal(text(p, 'dc-op-pupa'), money(pupa.value));
    assert.equal(text(p, 'dc-op-income-total'), money(0));
    const subtotals = [...p.d.querySelectorAll('[data-op-subtotal]')].map(e => e.getAttribute('data-op-subtotal'));
    assert.deepEqual(subtotals, ['administrative', 'operating', 'maintenance', 'other', 'income']);
    ob.GROUPS.filter(g => g.id !== 'other').forEach(g => assert.equal(p.d.querySelector('[data-op-subtotal="' + g.id + '"]').textContent, money(s.groups[g.id]) + ' per unit'));
    // DOH's Total Other counts real estate taxes and the replacement reserve.
    const tax = +p.d.getElementById('dc-prop-tax').value, reserve = +p.d.getElementById('dc-rep-reserve').value;
    assert.equal(p.d.querySelector('[data-op-subtotal="other"]').textContent, money(s.groups.other + tax + reserve) + ' per unit');
    const groupSum = ['administrative', 'operating', 'maintenance', 'other'].reduce((a, g) => a + +p.d.querySelector('[data-op-subtotal="' + g + '"]').textContent.replace(/[^0-9]/g, ''), 0);
    assert.equal(money(groupSum), text(p, 'dc-op-pupa'), 'the four group subtotals add to DOH per unit per year expenses');
    assert.equal(p.d.querySelector('[data-op-per="utilities"]').textContent, money(ob.EXAMPLE_BUDGET.utilities * units) + ' a year for ' + units + ' units');
    // Taxes and the reserve sit inside DOH's Other expenses group.
    const other = p.d.querySelector('[data-op-group="other"]');
    assert(other.querySelector('#dc-prop-tax') && other.querySelector('#dc-rep-reserve') && other.querySelector('#dc-tax-exempt'));
    assert.equal(p.w.__DealCalc.getResult().annualOpex, s.perUnitYear * units, 'the engine reads the lines');
    assert.match(text(p, 'dc-op-example-note'), /invented example/i);
    assert.match(text(p, 'dc-op-utilities-note'), /Market Analysis/);
    assert.deepEqual(p.errors, []);
  });

  await test('changing a line or adding other income moves expenses and income by the amount the module reports', async () => {
    const p = await openPage('');
    const units = +p.d.getElementById('dc-units').value;
    const r0 = p.w.__DealCalc.getResult();
    setField(p, 'dc-op-insurance', String(ob.EXAMPLE_BUDGET.insurance + 100));
    const r1 = p.w.__DealCalc.getResult();
    assert.equal(r1.annualOpex - r0.annualOpex, 100 * units, 'an extra $100 per unit per year adds $100 x units of expense');
    setField(p, 'dc-op-income-laundry', '120');
    const r2 = p.w.__DealCalc.getResult();
    assert.equal(r2.annualOtherIncome, 120 * units, 'the engine reads other income');
    assert.equal(text(p, 'dc-op-income-total'), money(120));
    assert.equal(p.d.querySelector('[data-op-subtotal="income"]').textContent, money(120) + ' per unit');
  });

  await test('a cleared budget is unknown with a reason, never $0 of expenses', async () => {
    const p = await openPage('');
    ob.LINE_TEMPLATE.forEach(t => { p.d.getElementById('dc-op-' + t.id).value = ''; });
    setField(p, 'dc-op-utilities', '');
    assert.match(text(p, 'dc-op-reason'), /Enter the operating budget/);
    assert.equal(text(p, 'dc-op-total'), '—');
    assert.match(text(p, 'dc-r-noi-stab'), /Enter the operating budget/);
    assert(!/\$0\b/.test(text(p, 'dc-r-noi-stab')));
  });

  await test('an old link with one monthly figure opens with the same expenses', async () => {
    const old = await openPage('?opex=500');
    const units = +old.d.getElementById('dc-units').value;
    assert.equal(old.d.getElementById('dc-op-other_other').value, '6000');
    assert.equal(old.d.getElementById('dc-op-utilities').value, '', 'the example lines the old figure never named are empty');
    assert.equal(old.w.__DealCalc.getResult().annualOpex, 500 * 12 * units);
    assert.equal(text(old, 'dc-op-total'), money(6000) + ' (' + money(500) + ' a month)');
    assert.deepEqual(old.errors, []);
  });

  close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
