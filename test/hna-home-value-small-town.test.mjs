#!/usr/bin/env node
// Owner's rule (2026-11-27): a town under 1,000 people matching Zillow for the
// first time keeps its ACS value when Zillow is outside the ACS margin of error
// or cannot be checked. These pin the rule and the committed result.
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

// The committed cascade: every flagged town shows an ACS value or blank, never Zillow, with a note.
const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
const flagged = (cascade.review_flags || {}).zhvi_small_town_unconfirmed || [];
for (const f of flagged) {
  const row = cascade.places[f.geoid];
  assert.ok(row, `${f.place_name} missing from places`);
  assert.notStrictEqual(row.source, 'zhvi', `${f.place_name} is flagged but shows Zillow`);
  assert.ok(row.review_note, `${f.place_name} is flagged but carries no review note`);
  assert.ok(f.population < SMALL_TOWN_POPULATION, `${f.place_name} is flagged but has ${f.population} people`);
  // The page reads the place summary, so the note and the non-Zillow value must reach it too.
  const summaryPath = path.join(ROOT, 'data/hna/summary', `${f.geoid}.json`);
  if (fs.existsSync(summaryPath)) {
    const shown = ((JSON.parse(fs.readFileSync(summaryPath, 'utf8')).acsProfile) || {}).median_home_value || {};
    assert.notStrictEqual(shown.source, 'zhvi', `${f.place_name} summary shows Zillow`);
    assert.strictEqual(shown.review_note, row.review_note, `${f.place_name} summary lost its review note`);
  }
  // A missing ACS margin stays null, never a zero-width margin.
  if (f.reason !== 'zillow_outside_acs_margin') assert.notStrictEqual(f.acs_moe, 0, `${f.place_name} margin read as 0`);
}
console.log(`hna-home-value-small-town: ok (${flagged.length} flagged)`);
