#!/usr/bin/env node
'use strict';
// Plan to the cost basis limit (CHFA 2027-28 QAP 3.M.1, least of three methods) and the market cap on
// restricted rents. Every deal figure here is INVENTED; the cost limit table is CHFA's, halved to make it bind.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeDeal } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');
const official = require('../data/policy/chfa-common-app-tables.json');

const halved = JSON.parse(JSON.stringify(official));
(function scale(o) { for (const k in o) { if (typeof o[k] === 'number') o[k] *= 0.5; else if (o[k] && typeof o[k] === 'object') scale(o[k]); } })(halved.basis_limit_per_unit_base);

function run(tables, edit) {
  const i = inputsFor('A');
  i.chfaCommonAppTables = tables;
  i.fields['dc-building-type'] = 'walk_up';
  if (edit) edit(i.fields);
  return computeDeal(i);
}

test('a lower cost basis limit sets the credit, and the gap shows what it costs', () => {
  const on = run(halved), off = run(halved, (f) => { f['dc-plan-cost-limit'] = false; });
  const m3 = on.costBasis.basis.costLimitMethod;
  assert.equal(m3.checked, true, m3.reason);
  assert.ok(m3.credit < off.annualCredits, 'the halved limit is below the capacity');
  assert.equal(on.annualCredits, m3.credit, 'Method Three sets the credit');
  assert.equal(on.costBasis.basis.creditForEquityBasis, 'cost basis limit');
  assert.deepEqual(on.costBasis.basis.costLimitPlan, { on: true, applied: true, before: off.annualCredits });
  assert.ok(on.equity < off.equity && on.gap > off.gap, 'less credit, less equity, a larger gap');
  assert.equal(off.costBasis.basis.costLimitPlan.applied, false, 'unticked: the limit is shown, not applied');
  // The Method Three note names the control that changes the credit, by its on-page label, in both states.
  const label = (fs.readFileSync(path.join(__dirname, '..', 'js', 'deal-calculator.js'), 'utf8')
    .match(/id="dc-plan-cost-limit"[\s\S]*?<strong>([^<]+)<\/strong>/) || [])[1];
  assert(label, 'found the plan control label');
  assert(m3.reason.includes(label) && off.costBasis.basis.costLimitMethod.reason.includes(label), 'note names "' + label + '"');
});

test('a cost basis limit above the capacity changes nothing', () => {
  const on = run(official), off = run(official, (f) => { f['dc-plan-cost-limit'] = false; });
  assert.ok(on.costBasis.basis.costLimitMethod.credit > on.annualCredits);
  assert.equal(on.annualCredits, off.annualCredits);
  assert.equal(on.gap, off.gap);
  assert.equal(on.costBasis.basis.costLimitPlan.applied, false);
});

test('an entered award is never lowered by the plan', () => {
  const award = run(halved, (f) => { f['dc-credit-awarded'] = '1400000'; });
  assert.equal(award.costBasis.basis.creditForEquityBasis, 'awarded');
  assert.equal(award.annualCredits, 1400000);
});

test('a market cap lowers a restricted rent above it, and only that rent', () => {
  const base = run(official), capped = run(official, (f) => { f['dc-rent-cap-2br'] = '1400'; });
  const rent = (r, tier) => r.pricedRows.find((p) => p.tier === tier && p.bedrooms === '2BR').contractRent;
  assert.equal(rent(capped, 30), rent(base, 30), 'a rent below the cap is kept');
  assert.equal(rent(capped, 40), 1400);
  assert.equal(rent(capped, 50), 1400);
  assert.ok(capped.annualRents < base.annualRents);
  assert.ok(capped.rentCapBindings.length >= 2 && capped.rentCapBindings.every((b) => b.cap === 1400 && b.limit > 1400));
  const blank = run(official, (f) => { f['dc-rent-cap-2br'] = ''; });
  assert.equal(blank.annualRents, base.annualRents, 'blank means no cap');
  assert.deepEqual(blank.rentCapBindings, []);
});
