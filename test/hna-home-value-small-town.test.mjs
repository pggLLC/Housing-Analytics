#!/usr/bin/env node
// Owner's rule (2026-11-27, revised 2026-11-28): a town under 1,000 people matching
// Zillow for the first time, where Zillow is outside the ACS margin of error or
// cannot be checked, shows Zillow's value marked "unconfirmed, small town" (low
// confidence, visible note). These pin the rule and the committed result.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smallTownZhviCheck, SMALL_TOWN_POPULATION } from '../scripts/hna/build_home_value_cascade.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

assert.strictEqual(SMALL_TOWN_POPULATION, 1000);
// Aguilar: 401 people, ACS $96,400 ± $3,973, Zillow $255,690.
assert.strictEqual(smallTownZhviCheck({ isNewMatch: true, population: 401, zhviValue: 255690, acsValue: 96400, acsMoe: 3973 }), 'zillow_outside_acs_margin');
// Inside the margin: Zillow is used.
assert.strictEqual(smallTownZhviCheck({ isNewMatch: true, population: 308, zhviValue: 908864, acsValue: 837000, acsMoe: 189690 }), null);
// No ACS value to check against.
assert.strictEqual(smallTownZhviCheck({ isNewMatch: true, population: 53, zhviValue: 246681, acsValue: NaN, acsMoe: NaN }), 'no_acs_value_to_check');
// A place matched before keeps its match, whatever its size.
assert.strictEqual(smallTownZhviCheck({ isNewMatch: false, population: 200, zhviValue: 500000, acsValue: 100000, acsMoe: 1000 }), null);
// 1,000 people or more: Zillow is used.
assert.strictEqual(smallTownZhviCheck({ isNewMatch: true, population: 1384, zhviValue: 103527, acsValue: 134100, acsMoe: 19872 }), null);

// The committed cascade: every flagged town shows Zillow with low confidence and a visible note.
const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
const flags = cascade.review_flags || {};
// Non-vacuous: the list must exist, and must be derived independently of itself.
assert.ok(Array.isArray(flags.zhvi_small_town_unconfirmed), 'review_flags.zhvi_small_town_unconfirmed must be an array');
const flagged = flags.zhvi_small_town_unconfirmed;
// Every place row carrying the unconfirmed note must be flagged, and every flag must carry it.
const UNCONFIRMED = 'zhvi_small_town_unconfirmed';
const noted = Object.entries(cascade.places)
  .filter(([, r]) => r && r.review_flag && r.review_flag.reason === UNCONFIRMED).map(([g]) => g).sort();
assert.deepStrictEqual(flagged.map((f) => f.geoid).sort(), noted, 'unconfirmed-town flags and notes disagree');
// Unconfirmed towns stay out of the crosswalk, so they are rechecked until reviewed.
const crosswalk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/zhvi-place-crosswalk.json'), 'utf8')).places || {};
// Pinned for the October 2026 Zillow vintage the owner reviewed (27-28 Nov 2026). A later
// vintage rechecks unconfirmed towns monthly, so this pin applies only to that month.
const OCT_2026_HELD = ['0800760', '0802850', '0803235', '0806530', '0829680', '0833310', '0850920', '0868930', '0885760'];
if ((cascade.meta || {}).latest_zhvi_month === '2026-10-31') {
  assert.deepStrictEqual(flagged.map((f) => f.geoid).sort(), OCT_2026_HELD, 'October 2026 unconfirmed towns changed');
}
let checked = 0;
for (const f of flagged) {
  const row = cascade.places[f.geoid];
  assert.ok(row, `${f.place_name} missing from places`);
  assert.strictEqual(row.source, 'zhvi', `${f.place_name} is flagged but does not show Zillow`);
  assert.strictEqual(row.value, f.zhvi_value, `${f.place_name} shows a value other than Zillow's`);
  assert.strictEqual(row.confidence, 'low', `${f.place_name} is unconfirmed but not low confidence`);
  assert.match(row.review_flag.note, /^Unconfirmed, small town:/, `${f.place_name} note is not the visible unconfirmed note`);
  assert.ok(!crosswalk[f.geoid], `${f.place_name} is unconfirmed but was written to the crosswalk`);
  assert.ok(f.population < SMALL_TOWN_POPULATION, `${f.place_name} is flagged but has ${f.population} people`);
  // The page reads the place summary, so the value and the note must reach it too.
  const summaryPath = path.join(ROOT, 'data/hna/summary', `${f.geoid}.json`);
  if (fs.existsSync(summaryPath)) {
    const shown = ((JSON.parse(fs.readFileSync(summaryPath, 'utf8')).acsProfile) || {}).median_home_value || {};
    assert.strictEqual(shown.value, row.value, `${f.place_name} summary value differs from the cascade`);
    assert.deepStrictEqual(shown.review_flag, row.review_flag, `${f.place_name} summary lost its unconfirmed note`);
  }
  // A missing ACS margin stays null, never a zero-width margin.
  if (f.reason !== 'zillow_outside_acs_margin') assert.notStrictEqual(f.acs_moe, 0, `${f.place_name} margin read as 0`);
  checked += 1;
}
assert.strictEqual(checked, flagged.length);

console.log(`hna-home-value-small-town: ok (${flagged.length} flagged)`);
