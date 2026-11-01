'use strict';
// CHFA Method Three from the 2027 Common Application workbook's limits
// (data/policy/chfa-common-app-tables.json; scripts/policy/build_chfa_common_app_tables.py).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cbm = require('../js/deal-cost-basis.js');

const ROOT = path.join(__dirname, '..');
const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/policy/chfa-common-app-tables.json'), 'utf8'));

test('the tables are the workbook\'s, labeled draft', () => {
  assert.equal(tables.status, 'draft');
  assert.match(tables.source.url, /^https:\/\/www\.chfainfo\.com\/getattachment\/.+Common-Application.+\.xlsx$/);
  assert.match(tables.source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(tables.counties).length, 64);
  for (const [fips, c] of Object.entries(tables.counties)) {
    assert.match(fips, /^08\d{3}$/);
    assert.ok([1, 2, 3].includes(c.zone), `${c.name} zone`);
    assert.ok([0, 20].includes(c.lowest_ami_points), `${c.name} lowest-AMI points`);
  }
  // V9 values as read from the Admin tab (Basis_Limit_Test_Table, Zone_Factor_Table).
  assert.deepEqual(tables.basis_limit_per_unit_base['2 bedroom'], { elevator: 131722.932, walk_up: 120485.684 });
  assert.deepEqual(tables.zone_factor, { 1: 3.6, 2: 4, 3: 3.6 });
  assert.equal(tables.counties['08077'].name, 'Mesa');
  assert.equal(tables.counties['08077'].zone, 3);
});

const mesa = { tables, countyFips: '08077', buildingType: 'walk_up', units: 30, applicableFraction: 1, creditRate: 0.09,
  rows: [{ bedrooms: '1BR', units: 10 }, { bedrooms: '2BR', units: 20 }] };

test('Method Three follows the workbook: TRUNC(zone factor x base) per unit, summed, x fraction x rate', () => {
  const r = cbm.costBasisLimitCheck(Object.assign({}, mesa, { capacity: 1e9 }));
  assert.equal(r.checked, true);
  assert.equal(r.draft, true);
  assert.deepEqual(r.perUnit, { '1 bedroom': Math.trunc(3.6 * 99710.336), '2 bedroom': Math.trunc(3.6 * 120485.684) });
  assert.equal(r.adjustedEligibleBasis, 10 * 358957 + 20 * 433748);
  assert.equal(Math.round(r.credit), Math.round((10 * 358957 + 20 * 433748) * 0.09));
  assert.equal(r.lower, true);
  assert.match(r.reason, /Mesa County is CHFA zone 3 \(factor 3\.6\)/);
  assert.match(r.reason, /shown as a check, it does not change the capacity here/);
});

test('a QCT or DDA multiplies the limit basis by 1.3; elevator uses the elevator column', () => {
  const plain = cbm.costBasisLimitCheck(Object.assign({}, mesa, { buildingType: 'elevator' }));
  const boosted = cbm.costBasisLimitCheck(Object.assign({}, mesa, { buildingType: 'elevator', hudBoost: true }));
  assert.equal(plain.perUnit['2 bedroom'], Math.trunc(3.6 * 131722.932));
  assert.ok(Math.abs(boosted.credit - plain.credit * 1.3) < 1e-6);
});

test('a missing input leaves Method Three unchecked with no credit, never a guess', () => {
  for (const missing of [{ buildingType: '' }, { countyFips: null }, { countyFips: '08999' }, { units: 31 }, { tables: null }, { rows: [] }]) {
    const r = cbm.costBasisLimitCheck(Object.assign({}, mesa, missing));
    assert.equal(r.checked, false, JSON.stringify(missing));
    assert.equal(r.credit, null, JSON.stringify(missing));
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'it gives a reason');
  }
});

test('the engine shows Method Three beside the capacity and never changes the credit', () => {
  const { computeDeal } = require('../js/deal-engine.js');
  const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');
  const base = computeDeal(inputsFor('A'));
  const withTables = inputsFor('A');
  withTables.chfaCommonAppTables = tables;
  withTables.fields['dc-building-type'] = 'walk_up';
  const r = computeDeal(withTables);
  assert.equal(r.annualCredits, base.annualCredits, 'credit unchanged by a draft-QAP check');
  assert.equal(r.equity, base.equity);
  const m3 = r.costBasis.basis.costLimitMethod;
  assert.ok(m3, 'Method Three result travels with the basis');
  assert.equal(m3.draft, true);
  assert.equal(m3.checked, true, m3.reason);
  assert.ok(Number.isFinite(m3.credit) && m3.credit > 0);
});
