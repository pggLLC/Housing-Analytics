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

test('hard costs: no cost without your per-home figure; the contract splits back to itself', () => {
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
  assert.ok(/status: 'assumption', why: 'Unconfirmed/.test(src), 'built cost lines are labelled unconfirmed');
  assert.ok(!/id="dc-cb-build-per-home"[^>]*value="\d/.test(src), 'no cost is pre-filled');
});
