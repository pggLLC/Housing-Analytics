#!/usr/bin/env node
'use strict';
// Workbook pieces 4 and 5: the operating budget filled from a per-home total, and the hard-cost lines built from
// your own cost per home. Every figure here is INVENTED.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ob = require('../js/deal-operating-budget.js');
const cb = require('../js/deal-cost-basis.js');

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('the typical shares cover every operating line and add to 100%', () => {
  const ids = ob.LINE_TEMPLATE.map((l) => l.id).concat(['real_estate_taxes']);
  assert.deepEqual(Object.keys(ob.WORKBOOK_SHARES).sort(), ids.sort());
  assert.ok(Math.abs(sum(ob.WORKBOOK_SHARES) - 1) < 1e-9);
});

test('a total fills every untyped line, and the lines add to the total', () => {
  const r = ob.fillFromTotal(5000, {});
  assert.equal(r.reason, null);
  assert.equal(sum(r.fills), 5000);
  assert.equal(r.fills.management_fee, 600);
  assert.equal(r.fills.real_estate_taxes, 650);
});

test('typed lines are kept and come off the total first', () => {
  const r = ob.fillFromTotal(5000, { insurance: 600, real_estate_taxes: 0 });
  assert.ok(!('insurance' in r.fills) && !('real_estate_taxes' in r.fills));
  assert.equal(r.keptTotal, 600);
  assert.equal(sum(r.fills) + 600, 5000);
});

test('a total below the typed lines, or no total, fills nothing', () => {
  assert.ok(ob.fillFromTotal(500, { insurance: 600 }).reason);
  assert.deepEqual(ob.fillFromTotal(500, { insurance: 600 }).fills, {});
  assert.ok(ob.fillFromTotal('', {}).reason);
});

test('hard costs: no cost without a per-home figure; the contract splits back to itself', () => {
  assert.ok(cb.buildHardCosts({ homes: 40 }).reason, 'the page supplies no cost');
  const r = cb.buildHardCosts({ perHome: 300000, homes: 40, escalation: 1.05, premium: 1.1 });
  assert.equal(r.contract, Math.round(300000 * 40 * 1.05 * 1.1));
  const f = r.fills;
  assert.equal(f.site_work + f.structures + f.general_requirements + f.overhead_profit, r.contract);
  const base = r.contract / 1.14;
  assert.ok(Math.abs(f.general_requirements - base * 0.06) <= 1);
  assert.ok(Math.abs(f.overhead_profit - base * 0.08) <= 2);
  assert.equal(f.owner_contingency, Math.round(r.contract * 0.05));
});

test('the page has both controls and marks filled lines as assumptions', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'deal-calculator.js'), 'utf8');
  for (const id of ['dc-op-fill-total', 'dc-op-fill-apply', 'dc-op-fill-note', 'dc-cb-build-per-home', 'dc-cb-build-apply', 'dc-cb-build-note']) {
    assert.ok(src.includes('id="' + id + '"'), id);
  }
  assert.ok(/fillCostLine\(id, r.fills\[id\], 'Unconfirmed/.test(src), 'built cost lines are labelled unconfirmed');
  assert.ok(!/id="dc-cb-build-per-home"[^>]*value="\d/.test(src), 'no cost is written into the page itself');
  assert.ok(/markData\(perEl/.test(src) && /markData\(escEl/.test(src), 'the public-data defaults carry their sources');
});

test('cost per home starts at the county permit value, or the state figure when the county is thin', () => {
  const permits = { counties: {
    '08001': { name: 'Big County', declared_value_per_unit_mf_5yr: { value: 200000, units: 900, declared_value: 180000000, window: '2021-2025' } },
    '08003': { name: 'Small County', declared_value_per_unit_mf_5yr: { value: 400000, units: 10, declared_value: 4000000, window: '2021-2025' } },
    '08005': { name: 'No County', declared_value_per_unit_mf_5yr: { value: null, units: 0, window: '2021-2025' } } } };
  const big = cb.permitCostPerHome(permits, '08001');
  assert.equal(big.geography, 'county'); assert.equal(big.value, 200000); assert.equal(big.reason, null);
  const small = cb.permitCostPerHome(permits, '08003');
  assert.equal(small.geography, 'state');
  assert.equal(small.value, 184000000 / 910, 'all counties pooled');
  assert.ok(/too few/.test(small.reason));
  assert.equal(cb.permitCostPerHome(permits, '08005').geography, 'state');
  assert.ok(cb.permitCostPerHome(null, '08001').reason, 'no data, no figure');
});

test('escalation runs from the permit years average to the latest month, skipping blanks', () => {
  const obs = [{ date: '2020-12-01', value: '90' }, { date: '2021-01-01', value: '100' }, { date: '2022-06-01', value: '110' },
    { date: '2026-09-01', value: '.' }, { date: '2026-10-01', value: '126' }];
  const e = cb.indexEscalation(obs, '2021-2022');
  assert.equal(e.from, 105); assert.equal(e.to, 126); assert.equal(e.toDate, '2026-10-01'); assert.equal(e.factor, 1.2);
  assert.ok(cb.indexEscalation(obs, '2010-2011').reason, 'no months in the window');
  assert.ok(cb.indexEscalation(null, '2021-2022').reason);
});
