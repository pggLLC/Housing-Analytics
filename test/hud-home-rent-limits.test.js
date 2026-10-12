#!/usr/bin/env node
'use strict';
// HUD HOME rent limits (#2041): every value is copied from HUD's workbook, so
// the guards below check the copy against HUD's own published rules and
// against the county list the rest of the site uses, not against itself.
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const home = require(path.join(ROOT, 'data', 'hud-home-rent-limits-co-2026.json'));
const geo = require(path.join(ROOT, 'data', 'hna', 'geo-config.json'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ': ' + err.message); }
}

const counties = Object.entries(home.counties);
const bedrooms = home.meta.bedrooms;

test('covers exactly the 64 counties in geo-config, keyed by 5-digit FIPS with matching names', () => {
  const expected = new Map(geo.counties.map((c) => [c.geoid, c.label]));
  assert.equal(expected.size, 64);
  assert.deepEqual(counties.map(([fips]) => fips).sort(), [...expected.keys()].sort());
  for (const [fips, c] of counties) {
    assert.match(fips, /^08\d{3}$/);
    assert.equal(c.county, expected.get(fips), fips);
  }
});

test('every limit is a positive whole-dollar number for bedrooms 0-6', () => {
  assert.deepEqual(bedrooms, ['0', '1', '2', '3', '4', '5', '6']);
  let checked = 0;
  for (const [fips, c] of counties) {
    for (const series of ['high_home', 'low_home', 'fmr', 'rent_65_ami', 'rent_50_ami']) {
      for (const br of bedrooms) {
        const v = c[series][br];
        assert(Number.isInteger(v) && v > 0, `${fips} ${series}[${br}] = ${v}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 64 * 5 * 7);
});

test('High HOME is the lesser of the FMR and the 65% rent (NAHA section 215)', () => {
  for (const [fips, c] of counties) {
    for (const br of bedrooms) {
      assert.equal(c.high_home[br], Math.min(c.fmr[br], c.rent_65_ami[br]), `${fips} ${br}BR`);
    }
  }
});

test('Low HOME is the 50% rent capped by High HOME', () => {
  for (const [fips, c] of counties) {
    for (const br of bedrooms) {
      assert.equal(c.low_home[br], Math.min(c.rent_50_ami[br], c.high_home[br]), `${fips} ${br}BR`);
    }
  }
});

test('counties sharing a HUD area carry identical limits', () => {
  const byArea = new Map();
  for (const [fips, c] of counties) {
    const key = c.hud_area_code;
    const limits = JSON.stringify([c.high_home, c.low_home]);
    if (!byArea.has(key)) byArea.set(key, limits);
    assert.equal(limits, byArea.get(key), `${fips} differs from its HUD area ${key}`);
  }
  assert(byArea.size < 64, 'some counties must share a metro area');
});

test('meta names the source, the effective date and that limits are gross rents', () => {
  assert.equal(home.meta.fiscal_year, 2026);
  assert.equal(home.meta.effective_date, '2026-06-01');
  assert.match(home.meta.source_file, /HOME_Limits_Rents_2026\.xlsx$/);
  assert.match(home.meta.source_memo, /2026-HOME-RentLimits-Memo\.pdf$/);
  assert.match(home.meta.rent_basis, /^Gross rent/);
  assert.match(home.meta.rent_basis, /utility allowance/);
});

console.log(`\nhud-home-rent-limits: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
