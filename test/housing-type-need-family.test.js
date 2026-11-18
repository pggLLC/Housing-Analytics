'use strict';

/**
 * The family-rental lane in housing-type-need reads family households from
 * ACS table B11001.
 *
 * Until 18 Nov 2026 it read DP02_0003, which since ACS 2019 means
 * "married-couple household with children under 18", and no stored summary
 * carried it. The lane's two heaviest signals (60% of its weight) were missing
 * for every place, so the score rested on household size, overcrowding and
 * renter count. Fruita read Moderate 38 with a 70.8% family share.
 *
 * Held here:
 *   1. The family share comes from B11001_002E / B11001_001E, never DP02_0003.
 *   2. Every county and place summary carries both B11001 fields, stamped acs5.
 *   3. With the real summaries, the family and renter-family signals score for
 *      Fruita and Mesa County (6 of 6 signals).
 *   4. Each lane's methodology text lists the weights the score uses, in order.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SUMMARY_DIR = path.join(ROOT, 'data/hna/summary');

function load() {
  const dom = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' });
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'js/components/housing-type-need.js'), 'utf8'));
  return dom.window.HousingTypeNeed;
}
const summary = (g) => JSON.parse(fs.readFileSync(path.join(SUMMARY_DIR, g + '.json'), 'utf8'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nHousing-type need: family households from B11001');
console.log('='.repeat(62));

const HTN = load();

test('family share is B11001_002E over B11001_001E', () => {
  const acs = HTN._extractAcs({ B11001_001E: 5273, B11001_002E: 3735 });
  assert.ok(Math.abs(acs.familyHHPct - 3735 / 5273 * 100) < 1e-9, String(acs.familyHHPct));
});

test('DP02_0003 (married couples with children) is never read as family households', () => {
  const acs = HTN._extractAcs({ DP02_0001E: 5273, DP02_0003E: 1200, DP02_0003PE: 22.8 });
  assert.strictEqual(acs.familyHHPct, null);
});

test('every county and place summary carries B11001 households and family households, ACS 5-year', () => {
  // The state summary (08.json) is refreshed by its own ACS 1-year fetch and may
  // hold only fields that fetch covers (tests/test_build_hna_data_series_stamp.py),
  // so the 5-year backfill skips it.
  const bad = [];
  for (const f of fs.readdirSync(SUMMARY_DIR).filter((x) => x.endsWith('.json') && x !== '08.json')) {
    const p = (JSON.parse(fs.readFileSync(path.join(SUMMARY_DIR, f), 'utf8')).acsProfile) || {};
    if (!(p.B11001_001E >= 0) || !(p.B11001_002E >= 0) || p.B11001_002E > p.B11001_001E || p._b11001Series !== 'acs5') bad.push(f);
  }
  assert.deepStrictEqual(bad, [], 'summaries without B11001: ' + bad.slice(0, 10).join(', '));
});

for (const [g, name] of [['0828745', 'Fruita'], ['08077', 'Mesa County']]) {
  test(name + ': family-rental lane scores on all 6 signals', () => {
    const res = HTN.compute({ acsProfile: summary(g).acsProfile, chasRows: null, jurisdictionName: name });
    const fam = res.filter((r) => r.type === 'familyRental')[0];
    assert.ok(fam, 'no family lane');
    assert.ok(/^6 of 6/.test(fam.confidenceReason), fam.confidenceReason);
  });
}

test('each lane\'s methodology lists the weights the score uses, in order', () => {
  const res = HTN.compute({ acsProfile: summary('0828745').acsProfile, chasRows: null, jurisdictionName: 'Fruita' });
  const off = [];
  for (const r of res) {
    const stated = (String(r.methodology).match(/(\d+)%[,)]/g) || []).map((x) => Number(x.replace(/\D/g, '')));
    if (JSON.stringify(stated) !== JSON.stringify(r.weights)) off.push(r.type + ': text ' + stated + ' vs code ' + r.weights);
  }
  assert.deepStrictEqual(off, []);
});

console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
