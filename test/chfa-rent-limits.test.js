#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const limits = require('../js/chfa-rent-limits.js');
const table = require('../data/chfa-income-rent-limits-2026.json');
const source = fs.readFileSync('js/components/subject-project.js', 'utf8');
const browser = { window: { ChfaRentLimits: limits } };
vm.runInNewContext(source, browser);
const SP = browser.window.SubjectProject;
const plain = (v) => JSON.parse(JSON.stringify(v));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ': ' + err.message); }
}
// The oracle is the committed CHFA file, never the implementation's key map.
const bedrooms = [['efficiency', '0br', 1], ['1BR', '1br', 1.5], ['2BR', '2br', 3], ['3BR', '3br', 4.5], ['4BR', '4br', 6]];
const standard = table.counties.filter((c) => !c.hera_special && !c.rural_resort).slice(0, 3);
const hera = table.counties.find((c) => c.hera_special && c.hera_tiers && c.hera_tiers['60']);
const rural = table.counties.find((c) => c.rural_resort && c.regular_tiers['160']);
assert(standard.length === 3 && hera && rural, 'real standard, HERA and rural-resort data must be present');
const samples = standard.flatMap((county) => [30, 60, 120].map((tier) => ({ county, tier, useHera: false, bucket: 'regular_tiers' })))
  .concat([{ county: hera, tier: 60, useHera: true, bucket: 'hera_tiers' },
    { county: hera, tier: 60, useHera: false, bucket: 'regular_tiers' },
    { county: rural, tier: 160, useHera: false, bucket: 'regular_tiers' }]);

test('agreement: gross rents equal the data across counties, tiers, bedrooms, HERA and rural-resort', () => {
  let checked = 0;
  for (const {county, tier, useHera, bucket} of samples) {
    for (const [bedroom, key, size] of bedrooms) {
      const expected = county[bucket][tier].max_rents[key];
      assert(Number.isFinite(expected), 'the independent table value must be a number');
      const actual = limits.maxGrossRent(table, county.fips, tier, bedroom, { useHera });
      assert.equal(actual.grossRent, expected, `${county.fips}/${tier}/${bedroom}/${bucket}`);
      assert.equal(actual.familySize, size);
      assert.equal(actual.hera, bucket === 'hera_tiers');
      assert.equal(actual.tableYear, table.meta.fiscal_year);
      assert.equal(actual.effectiveDate, table.meta.effective_date);
      assert.equal(actual.sourceUrl, table.meta.source_url);
      checked++;
    }
  }
  assert.equal(checked, 60);
});

test('delegation: SubjectProject gross rent agrees with both the data and the module', () => {
  for (const {county, tier, useHera, bucket} of samples) {
    for (const [bedroom, key, size] of bedrooms) {
      const expected = county[bucket][tier].max_rents[key];
      const actual = SP.computeLihtcMaxRent(table, county.fips, tier, bedroom, { useHera });
      assert.equal(actual.gross_rent, expected, `${county.fips}/${tier}/${bedroom}: delegated table answer`);
      assert.equal(actual.gross_rent, limits.maxGrossRent(table, county.fips, tier, bedroom, { useHera }).grossRent);
      assert.deepEqual(plain(actual), { gross_rent: expected, source: 'CHFA published', hera: bucket === 'hera_tiers', family_size: size });
    }
  }
});

test('income limits and legacy numeric adapter agree with the data and metadata', () => {
  for (const {county, tier, useHera, bucket} of samples) {
    for (let size = 1; size <= 8; size++) {
      const actual = limits.incomeLimit(table, county.fips, tier, size, { useHera });
      assert.equal(actual.incomeLimit, county[bucket][tier].income_limits[size + 'p']);
      assert.equal(actual.familySize, size);
      assert.equal(actual.hera, bucket === 'hera_tiers');
      assert.equal(actual.tableYear, table.meta.fiscal_year);
      assert.equal(actual.effectiveDate, table.meta.effective_date);
      assert.equal(actual.sourceUrl, table.meta.source_url);
      assert.equal(SP.computeIncomeLimit(table, county.fips, tier, size, { useHera }), actual.incomeLimit);
    }
  }
  const fallbackTier = Object.keys(hera.regular_tiers).find((tier) => !hera.hera_tiers[tier]);
  assert(fallbackTier, 'real HERA county needs a regular-only tier for fallback coverage');
  assert.equal(limits.maxGrossRent(table, hera.fips, fallbackTier, '2BR', { useHera: true }).hera, false);
  assert.equal(limits.incomeLimit(table, hera.fips, fallbackTier, 2, { useHera: true }).incomeLimit, hera.regular_tiers[fallbackTier].income_limits['2p']);
});

test('arithmetic: owner-paid utilities, resident-paid utilities and fees', () => {
  const gross = standard[0].regular_tiers['60'].max_rents['2br'];
  for (const [ua, fees] of [[0, undefined], [150, undefined], [150, 40], [0, 0], [gross, 0]]) {
    const actual = limits.maxContractRent({ grossRent: gross, utilityAllowance: ua, fees });
    assert.equal(actual.contractRent, gross - ua - (fees == null ? 0 : fees));
    assert.equal(actual.feesEntered, fees != null);
    assert.equal(SP.maxNetRent(gross, ua, fees), actual.contractRent);
  }
  for (const fees of [undefined, null, '', ' ']) {
    assert.deepEqual(limits.maxContractRent({ grossRent: gross, utilityAllowance: 0, fees }), { contractRent: gross, feesEntered: false });
  }
  assert.deepEqual(limits.maxContractRent({ grossRent: String(gross), utilityAllowance: '0', fees: '25' }), { contractRent: gross - 25, feesEntered: true });
});

test('over-deduction: module and legacy wrapper return unknown, never a clamped zero', () => {
  const gross = standard[0].regular_tiers['60'].max_rents['2br'];
  for (const [ua, fees] of [[gross + 1, undefined], [gross - 10, 11]]) {
    const actual = limits.maxContractRent({ grossRent: gross, utilityAllowance: ua, fees });
    assert.equal(actual.contractRent, null);
    assert.equal(actual.unavailableReason, 'deductions_exceed_gross_rent');
    assert.equal(SP.maxNetRent(gross, ua, fees), null);
  }
});

test('absence: missing county, tier, bedroom or household size names the missing input', () => {
  for (const [fips, tier, bedroom, reason] of [['99999', 60, '2BR', 'county'], [standard[0].fips, 999, '2BR', 'tier'], [standard[0].fips, 60, '9BR', 'bedroom']]) {
    const result = limits.maxGrossRent(table, fips, tier, bedroom, {});
    assert.equal(result.grossRent, null);
    assert(result.unavailableReason.includes(reason));
    assert.equal(SP.computeLihtcMaxRent(table, fips, tier, bedroom, {}), null);
  }
  for (const [fips, tier, size, reason] of [['99999', 60, 2, 'county'], [standard[0].fips, 999, 2, 'tier'], [standard[0].fips, 60, 99, 'household_size']]) {
    const result = limits.incomeLimit(table, fips, tier, size, {});
    assert.equal(result.incomeLimit, null);
    assert(result.unavailableReason.includes(reason));
    assert.equal(SP.computeIncomeLimit(table, fips, tier, size, {}), null);
  }
  const missing = structuredClone(table);
  delete missing.counties.find((c) => c.fips === standard[0].fips).regular_tiers['60'].max_rents['2br'];
  assert.equal(limits.maxGrossRent(missing, standard[0].fips, 60, '2BR').unavailableReason, 'bedroom_size_missing');
});

test('absence: missing or invalid arithmetic inputs never become numeric rents', () => {
  for (const ua of [null, undefined, '', ' ', -1, NaN, Infinity, 'unknown', false]) {
    const result = limits.maxContractRent({ grossRent: 1000, utilityAllowance: ua });
    assert.equal(result.contractRent, null);
    assert.equal(result.unavailableReason, 'utility_allowance_missing');
  }
  for (const gross of [null, undefined, '', ' ', NaN, Infinity, -1]) {
    assert.equal(limits.maxContractRent({ grossRent: gross, utilityAllowance: 0 }).contractRent, null);
  }
  for (const fees of [-1, NaN, Infinity, 'unknown']) {
    assert.equal(limits.maxContractRent({ grossRent: 1000, utilityAllowance: 0, fees }).unavailableReason, 'fees_invalid');
  }
});

test('one implementation: adapters call the module and retain legacy shapes', () => {
  const originals = { ...limits };
  const calls = [];
  try {
    limits.maxGrossRent = (...args) => { calls.push(args); return { grossRent: 123, hera: true, familySize: 3 }; };
    limits.incomeLimit = (...args) => { calls.push(args); return { incomeLimit: 456 }; };
    limits.maxContractRent = (...args) => { calls.push(args); return { contractRent: 78 }; };
    const opts = { useHera: true };
    assert.deepEqual(plain(SP.computeLihtcMaxRent(table, '08077', 60, '2BR', opts)), { gross_rent: 123, source: 'CHFA published', hera: true, family_size: 3 });
    assert.deepEqual(calls.pop(), [table, '08077', 60, '2BR', opts]);
    assert.equal(SP.computeIncomeLimit(table, '08077', 60, 2, opts), 456);
    assert.deepEqual(calls.pop(), [table, '08077', 60, 2, opts]);
    assert.equal(SP.maxNetRent(100, 20, 2), 78);
    assert.deepEqual(plain(calls.pop()), [{ grossRent: 100, utilityAllowance: 20, fees: 2 }]);
  } finally { Object.assign(limits, originals); }
  for (const name of ['_countyRow', '_tiersBucket', '_findTier', '_allowance', 'BR_TO_CHFA_KEY']) {
    assert(!new RegExp('(?:function|var|const|let)\\s+' + name + '\\b').test(source), 'component must not define ' + name);
  }
  assert.strictEqual(SP.BR_HH_SIZE, limits.BR_HH_SIZE);
});

test('UMD browser export works without a DOM and loads immediately before SubjectProject', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('js/chfa-rent-limits.js', 'utf8'), context);
  assert.equal(typeof context.window.ChfaRentLimits.maxGrossRent, 'function');
  const html = fs.readFileSync('market-analysis.html', 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
  assert.equal(scripts[scripts.indexOf('js/components/subject-project.js') - 1], 'js/chfa-rent-limits.js');
  const pkg = require('../package.json');
  assert.equal(pkg.scripts['test:chfa-rent-limits'], 'node test/chfa-rent-limits.test.js');
  assert(Object.entries(pkg.scripts).some(([name, command]) => /^ci:part-/.test(name) && command.split(' && ').includes('npm run test:chfa-rent-limits')));
});
console.log(`CHFA rent limits: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
