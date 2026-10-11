#!/usr/bin/env node
'use strict';
/**
 * The dashboard and regional pages label their LIHTC allocation charts with
 * `s.abbr` and filter by region and state on it. The records in
 * js/state-allocations-2026.js are keyed by postal code, and until #2129
 * none carried an `abbr` field: every chart label was blank, and every region
 * filter on the dashboard matched no state.
 *
 * Agreement checked here: each record's `abbr` equals its key, and every
 * postal code the dashboard's REGIONS map names is a record in the data, so
 * each region filter selects the states it lists.
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

const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const m = html.match(/const REGIONS = (\{[\s\S]*?\});/);
assert.ok(m, 'dashboard.html REGIONS map not found');
const REGIONS = Function(`return (${m[1]});`)();
const regionNames = Object.keys(REGIONS);
assert.ok(regionNames.length >= 4, 'REGIONS map has no regions to check');

const byAbbr = new Set(Object.values(data.states).map((s) => s.abbr));
for (const [region, codes] of Object.entries(REGIONS)) {
  const matched = codes.filter((c) => byAbbr.has(c));
  assert.deepStrictEqual(matched, codes, `dashboard region "${region}" names codes absent from the data`);
}
console.log(`  ✅ every postal code in the dashboard's ${regionNames.length} regions matches a state record`);
