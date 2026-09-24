#!/usr/bin/env node
/**
 * BPS declared construction value: published, bounded, and never a cost benchmark.
 *
 * The Building Permits Survey files this repo already downloads carry a Value
 * column beside every Units column, and the builder threw it away. It is now
 * extracted (#1842) — with the constraint that makes it safe to publish.
 *
 * WHAT IT IS NOT. Measured across 2021-2025, Pitkin County reports about
 * $1.78M of declared construction value per permitted multifamily unit and
 * Mesa County about $100k. That ~18x spread is real and it is MIX, not price:
 * Pitkin permits luxury condominiums, Mesa does not. The figure answers "what
 * is going up here", never "what would my project cost here". An Aspen reader
 * who took $1.78M/unit into an affordable-housing pro forma would be wrong by
 * more than an order of magnitude — the same face-validity failure as a resort
 * town reading as low housing need.
 *
 * So this guard pins three things: the numbers are present, thin windows are
 * ABSENT rather than zero, and every published figure carries the disclosure
 * that keeps it from being read as a cost.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const permits = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/permits.json'), 'utf8'));
const BUILDER = fs.readFileSync(path.join(ROOT, 'scripts/hna/build_permits.py'), 'utf8');
const counties = Object.entries(permits.counties || {});
const years = permits.years || [];

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('permit-declared-value');

test('the value series is published for every county, aligned to the years', () => {
  assert.ok(counties.length >= 60, `only ${counties.length} counties read`);
  for (const [geoid, c] of counties) {
    for (const field of ['value_sf', 'value_mf']) {
      assert.ok(Array.isArray(c[field]), `${geoid} (${c.name}) carries no ${field}`);
      assert.strictEqual(c[field].length, years.length,
        `${geoid} ${field} has ${c[field].length} entries against ${years.length} years`);
    }
    assert.strictEqual(c.value_mf.length, c.units_mf.length,
      `${geoid} value and unit series are different lengths`);
  }
});

test('a window too thin to mean anything is ABSENT, not zero', () => {
  // The defect this repo keeps finding: an unmeasured value published as 0.
  // A county with 22 multifamily units over five years has no meaningful
  // per-unit figure, and must say so rather than show one.
  let suppressed = 0;
  for (const [geoid, c] of counties) {
    const d = c.declared_value_per_unit_mf_5yr;
    assert.ok(d && typeof d === 'object', `${geoid} publishes no per-unit record`);
    if (d.value === null) {
      suppressed += 1;
      assert.ok(typeof d.basis === 'string' && /fewer than/.test(d.basis),
        `${geoid} (${c.name}) suppresses the figure without saying why`);
      continue;
    }
    assert.ok(typeof d.value === 'number' && d.value > 0,
      `${geoid} (${c.name}) publishes a non-positive per-unit value: ${d.value}`);
  }
  assert.ok(suppressed >= 1,
    'no county is suppressed, so the floor is not doing anything — either the rule is '
    + 'gone or every county now clears it, and the second needs checking');
});

test('the floor is derived and written down, not picked', () => {
  const m = /MIN_MF_UNITS_FOR_PER_UNIT = (\d+)/.exec(BUILDER);
  assert.ok(m, 'the unit floor constant is gone');
  const floor = Number(m[1]);
  assert.ok(/MEASURED, not chosen/.test(BUILDER),
    'the floor no longer records that it was measured');
  assert.ok(/inter-quartile|IQR/i.test(BUILDER),
    'the measurement behind the floor is no longer stated, so nobody can re-derive it');
  // And it is actually applied.
  for (const [geoid, c] of counties) {
    const d = c.declared_value_per_unit_mf_5yr;
    if (d.value === null) continue;
    assert.ok(d.units >= floor,
      `${geoid} (${c.name}) publishes a figure on ${d.units} units, below the floor of ${floor}`);
  }
});

test('every published figure discloses that it is not a cost benchmark', () => {
  const published = counties.filter(([, c]) => c.declared_value_per_unit_mf_5yr.value !== null);
  assert.ok(published.length >= 5,
    `only ${published.length} counties publish a figure; too few for this check to mean anything`);
  for (const [geoid, c] of published) {
    const basis = c.declared_value_per_unit_mf_5yr.basis || '';
    assert.ok(/excludes land/i.test(basis),
      `${geoid} does not disclose that land is excluded: "${basis}"`);
    assert.ok(/what was built, not what building costs/i.test(basis),
      `${geoid} does not disclose that this reflects the mix, not the price: "${basis}"`);
  }
});

test('the mix spread is real, and the builder says so', () => {
  // If this ever narrows to something a reader could mistake for a price, the
  // disclosure above stops being the important part and this should be
  // re-derived. Recorded as a fact about the data, not an assumption.
  const withValue = counties
    .filter(([, c]) => c.declared_value_per_unit_mf_5yr.value !== null)
    .map(([, c]) => c.declared_value_per_unit_mf_5yr.value);
  const spread = Math.max(...withValue) / Math.min(...withValue);
  assert.ok(spread > 5,
    `the county spread has fallen to ${spread.toFixed(1)}x. That is good news about the data, `
    + 'but the "mix not price" framing in build_permits.py was derived from a much wider '
    + 'spread — re-derive it before relying on the disclosure');
  assert.ok(/mix, not price|MIX, not price/i.test(BUILDER),
    'the builder no longer explains that the spread is mix rather than price');
});

console.log(failures === 0
  ? '  permit-declared-value: PASS'
  : `  permit-declared-value: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
