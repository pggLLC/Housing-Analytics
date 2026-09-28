'use strict';
// The AMI-gap field `gap_units_minus_households_le_ami_pct` has a different
// sign in each file (#2013). This guard pins each file's convention to its own
// household and unit counts, record by record, and checks that the one
// consumer that reads the stored field under either convention
// (HNAOwnershipNeed.rentalGap) agrees with those counts for every geography —
// including a record it cannot tag, which it must recompute rather than guess.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const county = read('data/co_ami_gap_by_county.json');
const place = read('data/co_ami_gap_by_place.json');

const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'hna-ownership-need.js' });
const rentalGap = sandbox.window.HNAOwnershipNeed.rentalGap;
assert.strictEqual(typeof rentalGap, 'function', 'HNAOwnershipNeed.rentalGap must be exposed');

const counties = Array.isArray(county.counties) ? county.counties : Object.values(county.counties || {});
const places = Array.isArray(place.places) ? place.places : Object.values(place.places || {});
assert(counties.length === 64, `county file must carry all 64 counties, found ${counties.length}`);
assert(places.length > 400, `place file looks truncated: ${places.length} places`);

// 1. Each file's stored gap agrees with its own counts in its own direction.
let checked = 0;
const wrong = [];
function checkFile(records, label, expected) {
  for (const r of records) {
    const g = r.gap_units_minus_households_le_ami_pct || {};
    const hh = r.households_le_ami_pct || {};
    const un = r.units_priced_affordable_le_ami_pct || {};
    for (const band of Object.keys(g)) {
      if (g[band] == null || hh[band] == null || un[band] == null) continue;
      checked++;
      const want = expected(hh[band], un[band]);
      if (Math.abs(g[band] - want) > 1) wrong.push(`${label} ${r.fips || r.geoid} ≤${band}%: stored ${g[band]}, counts give ${want}`);
    }
  }
}
checkFile(counties, 'county', (hh, un) => un - hh);   // units − households: negative = shortfall
checkFile(places, 'place', (hh, un) => hh - un);      // households − units: positive = shortfall
assert(checked >= 3000, `expected to check at least 3000 band values, checked ${checked}`);
assert.deepStrictEqual(wrong.slice(0, 10), [], `stored gap disagrees with the file's own counts (${wrong.length}):`);

// 2. rentalGap = max(0, households − units) at ≤80% AMI for every geography,
//    whichever file it came from — tagged, and untagged.
const expected80 = (r) => {
  const hh = r.households_le_ami_pct && r.households_le_ami_pct['80'];
  const un = r.units_priced_affordable_le_ami_pct && r.units_priced_affordable_le_ami_pct['80'];
  return hh == null || un == null ? null : Math.max(0, hh - un);
};
let consumerChecked = 0;
const consumerWrong = [];
for (const [records, tag] of [[counties, 'county'], [places, 'place']]) {
  for (const r of records) {
    const want = expected80(r);
    if (want == null) continue;
    for (const entry of [Object.assign({ gapSource: tag }, r), Object.assign({}, r)]) {
      consumerChecked++;
      const got = rentalGap(entry);
      if (got == null || Math.abs(got - want) > 1) {
        consumerWrong.push(`${tag} ${r.fips || r.geoid} (${entry.gapSource ? 'tagged' : 'untagged'}): rentalGap ${got}, counts give ${want}`);
      }
    }
  }
}
assert(consumerChecked >= 1000, `expected to check rentalGap on at least 1000 records, checked ${consumerChecked}`);
assert.deepStrictEqual(consumerWrong.slice(0, 10), [], `rentalGap disagrees with the counts (${consumerWrong.length}):`);

// 3. No counts and no tag: unknown, never a guessed sign.
assert.strictEqual(rentalGap({ gap_units_minus_households_le_ami_pct: { 80: -500 } }), null,
  'an untagged record without counts must be null, not a sign guess');
assert.strictEqual(rentalGap(null), null);
// An explicitly null band is absent, not 0 (Number(null) === 0).
assert.strictEqual(rentalGap({ households_le_ami_pct: { 80: null }, units_priced_affordable_le_ami_pct: { 80: 100 } }), null,
  'null households must not become a 0 gap');
assert.strictEqual(rentalGap({ households_le_ami_pct: { 80: 500 }, units_priced_affordable_le_ami_pct: { 80: null } }), null,
  'null units must not become a 500 gap');
assert.strictEqual(rentalGap({ gapSource: 'county', gap_units_minus_households_le_ami_pct: { 80: null },
  households_le_ami_pct: { 80: 5 }, units_priced_affordable_le_ami_pct: { 80: 2 } }), 3,
  'a null stored gap falls back to the counts, not to 0');

console.log(`AMI gap sign convention: PASS (${checked} stored band values agree with their file's counts; rentalGap matches households − units on ${consumerChecked} tagged and untagged records)`);
