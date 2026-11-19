// Older-adult renters for CHFA's older-adult capture rate (paul approved 18 Nov 2026): data/market/
// chfa_older_renter_demand_co.json, built offline by scripts/market/build_chfa_older_renter_demand.py from HUD CHAS
// 2018-2022 Table 7 (elderly family + elderly non-family renters by tier) and ACS 2020-2024 PUMS (renters with a
// householder 62+, one or two people). Checks: CHFA's rules quoted with pages; the family file's shape, tracts and
// scales; only one- and two-person PUMS rows; margins for every tract; older renters a small part of all renters; the
// public site's engine counts fewer older-adult than family renters for one- and two-bedroom homes; the freshness
// check watches the file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const fam = readJson('data/market/chfa_renter_demand_co.json');
const old = readJson('data/market/chfa_older_renter_demand_co.json');
const m = old.meta;

assert.equal(m.generator, 'scripts/market/build_chfa_older_renter_demand.py');
assert.match(m.rules_source, /2027-2028/);
assert.match(m.rules[0], /householder 62 or older.*page 85/);
assert.match(m.rules[2], /no more than two occupants/);
assert.match(m.rules[3], /age-restricted/);
assert.match(m.rules[4], /comparable projects.*page 86/);
assert.match(m.reading, /not a quoted rule/, '55+ use is labelled a reading');
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(m.review_by), 'review_by is a date');
assert.ok(m.sources.chas.url && m.sources.pums.url, 'sources linked');

// Same shape and scales as the family file, so the same engine counts it.
assert.deepEqual(Object.keys(old.tracts).sort(), Object.keys(fam.tracts).sort(), 'every family tract');
assert.deepEqual(old.puma_lim50_2024, fam.puma_lim50_2024);
assert.deepEqual(old.county_lim50_2024, fam.county_lim50_2024);
Object.entries(old.tracts).forEach(([g, r]) => {
  assert.equal(r.length, 6, g);
  assert.equal(r[0], fam.tracts[g][0], 'same PUMA: ' + g);
  assert.ok(r.slice(1).every(v => Number.isInteger(v) && v >= 0), 'whole counts: ' + g);
  assert.ok(Array.isArray(old.tracts_moe[g]) && old.tracts_moe[g].length === 5, 'margins: ' + g);
});
Object.entries(old.pumas).forEach(([p, rows]) => {
  assert.equal(rows.length, 6, p);
  rows.slice(2).forEach(r => assert.ok(r.every(v => v === 0), 'three or more people counted in ' + p));
  assert.ok(rows[0].reduce((s, v) => s + v, 0) > 0, 'no one-person older renters in ' + p);
});
const sum = t => Object.values(t).reduce((s, r) => s + r.slice(1).reduce((a, v) => a + (v > 0 ? v : 0), 0), 0);
const share = sum(old.tracts) / sum(fam.tracts);
assert.ok(share > 0.1 && share < 0.25, 'older renters are ' + (share * 100).toFixed(1) + '% of renters');

// The engine: fewer qualify as older adults than as families, and some do.
const E = require(path.join(ROOT, 'js/market-analysis-scoring.js'));
const chfa = readJson('data/chfa-income-rent-limits-2026.json'), lim = {};
chfa.counties.forEach(c => { lim[c.fips] = c; });
const mesa = Object.keys(fam.tracts).filter(g => g.startsWith('08077')).map(g => ({ geoid: g }));
const qf = E.chfaQualifiedRenters(fam, lim, mesa, [60], ['1br', '2br']).value;
const qo = E.chfaQualifiedRenters(old, lim, mesa, [60], ['1br', '2br']).value;
assert.ok(qo > 0 && qo < qf, 'Mesa County at 60% AMI: older ' + qo + ', family ' + qf);

const freshness = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8');
assert.match(freshness, /data\/market\/chfa_older_renter_demand_co\.json/);
console.log('chfa older renter demand: PASS');
