#!/usr/bin/env node
'use strict';
/**
 * The dashboard and regional pages label their LIHTC allocation charts with
 * `s.abbr` and filter by region and state on it. The records in
 * js/state-allocations-2026.js are keyed by postal code, and until #2129
 * none carried an `abbr` field: every chart label was blank, and every region
 * filter on the dashboard matched no state.
 *
 * Agreement checked here: each record's `abbr` equals its key. (The
 * dashboard and regional pages came off the public site on 10-22.)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = require(path.join(ROOT, 'js/state-allocations-2026.js'));

const keys = Object.keys(data.states);
assert.ok(keys.length >= 50, `expected all states, found ${keys.length}`);
for (const key of keys) {
  assert.strictEqual(data.states[key].abbr, key, `states.${key}.abbr must be "${key}"`);
}
console.log(`  ✅ all ${keys.length} state records carry abbr equal to their key`);


// 2026 ceilings follow the IRS rule in every copy of the data: the greater of
// $3.416 x population or $3,953,600 (Rev. Proc. 2025-32, section 4.08), with
// the 2026 population figures from IRS Notice 2026-22.
const RATE = 3.416;
const SMALL_STATE_MINIMUM = 3953600;
const ceiling = (pop) => Math.max(Math.round(RATE * pop), SMALL_STATE_MINIMUM);
const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/allocations.json'), 'utf8'));
const actual = require(path.join(ROOT, 'js/state-allocations-2026-actual.js')).stateAllocations2026;
assert.strictEqual(Object.keys(json.states).length, 51, 'allocations.json covers the 50 states and DC');
let total = 0;
for (const [abbr, s] of Object.entries(json.states)) {
  assert.strictEqual(s.allocation, ceiling(s.population), `${abbr} allocation must follow the 2026 IRS rule`);
  assert.ok(s.allocation >= SMALL_STATE_MINIMUM, `${abbr} is below the small-state minimum`);
  assert.strictEqual(s.perCapita, Math.round((s.allocation / s.population) * 100) / 100, `${abbr} perCapita must equal allocation / population`);
  assert.strictEqual(s.status, 'confirmed', `${abbr} must not be left as an estimate`);
  const js = data.states[abbr];
  assert.deepStrictEqual([js.allocation, js.population, js.perCapita], [s.allocation, s.population, s.perCapita], `${abbr} differs between allocations.json and state-allocations-2026.js`);
  assert.deepStrictEqual([actual[abbr].credits9pct, actual[abbr].population], [s.allocation, s.population], `${abbr} differs between allocations.json and state-allocations-2026-actual.js`);
  total += s.allocation;
}
assert.strictEqual(json.totalAllocation, total, 'totalAllocation is the sum of the state ceilings');
// Colorado: 6,012,561 residents (Notice 2026-22) x $3.416.
assert.strictEqual(json.states.CO.population, 6012561);
assert.ok(Math.abs(json.states.CO.allocation - 20.5e6) < 0.1e6, 'Colorado 2026 ceiling is about $20.5 million');
assert.ok(!/\$2\.75|estimated pending/i.test(fs.readFileSync(path.join(ROOT, 'js/state-allocations-2026-actual.js'), 'utf8')), 'stale minimum wording removed');
console.log(`  ✅ all 51 2026 ceilings follow the IRS rule and agree across the three copies`);
