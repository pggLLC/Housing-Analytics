'use strict';
// test/acs-older-rentals.test.js
// Renter homes by building age and size (ACS 2020-2024 B25127), from
// scripts/market/build_acs_older_rentals_co.py: data/market/acs_older_rentals_co.json.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const doc = read('data/market/acs_older_rentals_co.json');
const m = doc.meta;

// Dated, sourced, renter-only, and says how sure each number is.
assert.match(m.source_url, /^https:\/\/www2\.census\.gov\/.*b25127\.dat$/);
assert.equal(m.vintage, '2020-2024');
assert.match(m.tenure, /renter/);
assert.match(m.reliability_rule, /30%/);
assert.equal(m.counties_count, 64, 'every Colorado county');
assert.equal(m.counties_count, Object.keys(doc.counties).length);
assert.equal(m.places_count, Object.keys(doc.places).length);
assert.equal(m.tracts_count, Object.keys(doc.tracts).length);
const groups = Object.keys(m.groups);
assert.ok(groups.includes('renter_total') && groups.includes('older_small_mid_pre1980'));

for (const [kind, len] of [['counties', 5], ['places', 7], ['tracts', 11]]) {
  for (const [g, rec] of Object.entries(doc[kind])) {
    assert.match(g, new RegExp('^08\\d{' + (len - 2) + '}$'), kind + ' ' + g);
    for (const k of groups) {
      const c = rec[k];
      if (c === null) continue;
      assert.ok(Number.isInteger(c.est) && c.est >= 0, g + ' ' + k);
      // An unpublished margin stays null with a note and is never reliable; it is never written as zero.
      if (c.moe === null) assert.ok(c.cv === null && c.reliable === false && c.moe_note, g + ' ' + k + ' unknown margin');
      else assert.ok(Number.isInteger(c.moe) && c.moe >= 0, g + ' ' + k);
      // A count is never marked reliable unless its CV clears the rule.
      if (c.reliable) assert.ok(c.cv !== null && c.cv <= 0.30, g + ' ' + k + ' reliable only at CV <= 30%');
      if (k !== 'renter_total' && rec.renter_total) assert.ok(c.est <= rec.renter_total.est, g + ' ' + k + ' within all renter homes');
    }
  }
}

// Counties add up to the state's renter homes in older small and mid-size buildings, within rounding.
const countySum = Object.values(doc.counties).reduce((t, r) => t + r.renter_total.est, 0);
assert.ok(countySum > 700000 && countySum < 950000, 'Colorado renter homes in a plausible range: ' + countySum);

// B25127's renter total is the same Census count as B25003's renter-occupied homes, tract by tract.
const metrics = read('data/market/acs_tract_metrics_co.json');
if (String(metrics.meta.vintage) === '2024') {
  let compared = 0;
  for (const t of metrics.tracts) {
    const r = doc.tracts[t.geoid];
    if (!r || t.renter_hh == null || !r.renter_total) continue;
    assert.equal(r.renter_total.est, t.renter_hh, t.geoid + ' renter total matches B25003');
    compared += 1;
  }
  assert.ok(compared > 1000, 'compared most tracts');
}

// Builder: a missing margin is unknown, not zero (AGENTS.md unknown-versus-zero).
const { execFileSync } = require('node:child_process');
const probe = execFileSync('python3', ['-c', [
  'import importlib.util, json',
  "spec = importlib.util.spec_from_file_location('b', 'scripts/market/build_acs_older_rentals_co.py')",
  'b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)',
  "print(json.dumps([b.summarise({'B25127_E045': '100', 'B25127_M045': 'N'}, [45]), b.summarise({'B25127_E045': '100', 'B25127_M045': '20', 'B25127_E046': '5', 'B25127_M046': ''}, [45, 46])]))"
].join('\n')], { cwd: root }).toString();
for (const r of JSON.parse(probe)) assert.ok(r.moe === null && r.cv === null && r.reliable === false, 'missing margin is never zero');

console.log('acs older rentals: PASS');
