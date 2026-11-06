#!/usr/bin/env node
/**
 * data/market/public-employers.json (scripts/build_public_employers.py): staff headcount of every school
 * district and BOCES, by the county of its office, from CDE's staff statistics.
 * Pins: a dated CDE source and the NCES county source; the plain "not a ranking" line and the reason CDLE's
 * licensed list is not used; every county key is a Colorado county; every row has a name, a CDE code and a
 * whole headcount; rows run largest first; and a few known rows match the CDE file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = JSON.parse(readFileSync(join(ROOT, 'data/market/public-employers.json'), 'utf8'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const m = P.meta;
ok(/^20\d\d-20\d\d$/.test(m.as_of) && /^20\d\d-20\d\d$/.test(m.prior), 'school years named');
ok(/Colorado Department of Education/.test(m.source.label) && /^https:\/\/ed\.cde\.state\.co\.us\//.test(m.source.url), 'CDE source and link');
ok(/NCES/.test(m.county_source.label) && /^https:\/\//.test(m.county_source.url), 'county source named');
ok(/not a list of the largest employers/i.test(m.not_a_ranking), 'says it is not a ranking');
ok(/Data Axle/.test(m.not_used) && /20\d\d-\d\d-\d\d/.test(m.not_used), 'says why CDLE is not used, dated');
const fips = Object.keys(P.counties);
ok(fips.length >= 60, `counties covered (${fips.length})`);
const odd = [];
for (const f of fips) {
  if (!/^08\d{3}$/.test(f) || Number(f.slice(2)) % 2 !== 1 || Number(f.slice(2)) > 125) odd.push(f);
  const rows = P.counties[f];
  ok(rows.length > 0, f + ' has rows');
  rows.forEach((r, i) => {
    ok(r.employer && /^\d{4}$/.test(r.lea_code) && Number.isInteger(r.headcount) && r.headcount > 0, `${f} row ${i} well formed`);
    if (i) ok(rows[i - 1].headcount >= r.headcount, `${f} rows run largest first`);
  });
}
ok(!odd.length, 'county keys are Colorado county FIPS: ' + odd.join(','));
ok(!Object.values(P.counties).flat().some(r => r.lea_code === '8001'), 'Charter School Institute left out');
// Spot rows copied from the CDE 2025-26 file (All Job Categories).
const find = (f, code) => (P.counties[f] || []).find(r => r.lea_code === code);
if (m.as_of === '2025-2026') {
  ok(find('08081', '2020')?.headcount === 373, 'Moffat County RE-1, 373');
  ok(find('08009', '0250')?.headcount === 72, 'Springfield RE-4 (Baca), 72');
  ok(find('08087', '2405')?.headcount === 563, 'Fort Morgan Re-3, 563');
}
console.log(`public-employers: PASS (${checks} checks)`);
