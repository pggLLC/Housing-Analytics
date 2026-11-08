#!/usr/bin/env node
/**
 * data/market/public-jobs.json (scripts/market/build_public_jobs.py): government jobs as a share of all jobs for
 * every Colorado county and town, from LEHD LODES WAC.
 * Pins: all 64 counties and every ranking-index place are keys or listed as missing; the source, year and limits
 * are stated; government = jobs - private, federal <= government, state_local = government - federal; a share is
 * published only above the minimum job count and matches the parts; a county's parts are at least the sum of its
 * towns'; and spot values match the LODES 2023 files.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const P = read('data/market/public-jobs.json');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const m = P.meta;
ok(Number.isInteger(m.year) && m.year >= 2020, 'LODES year named');
ok(/LEHD/.test(m.source.label) && /^https:\/\/lehd\.ces\.census\.gov\//.test(m.source.url) && m.source.files.length === 4, 'source, page and files named');
ok(Array.isArray(m.limits) && m.limits.length >= 3 && m.limits.some((l) => /administrative address/.test(l)), 'limits stated, including state-employee addressing');
ok(Number.isInteger(m.min_jobs) && m.min_jobs > 0, 'minimum job count stated');

const rank = read('data/hna/ranking-index.json').rankings;
const counties = rank.filter((g) => g.type === 'county').map((g) => g.geoid).sort();
const places = rank.filter((g) => g.type === 'place').map((g) => g.geoid).sort();
ok(counties.length === 64 && JSON.stringify(Object.keys(P.counties).sort()) === JSON.stringify(counties), 'all 64 counties are keys');
const have = Object.keys(P.places).concat(Object.keys(m.missing)).sort();
ok(JSON.stringify(have) === JSON.stringify(places), 'every place is a key or listed as missing');
ok(Object.keys(m.missing).every((g) => !(g in P.places) && !(g in P.counties)), 'missing areas are not also keys');

function check(f, r) {
  ok(r.name && Number.isInteger(r.jobs) && r.jobs >= 0, f + ' has a name and a job count');
  ok(Number.isInteger(r.government) && r.government <= r.jobs && r.state_local === r.government - r.federal, f + ' parts add up');
  ok(r.private_large_firms >= 0 && r.private_large_firms <= r.jobs - r.government, f + ' large-firm private jobs fit inside private jobs');
  if (r.shown) {
    ok(r.jobs >= m.min_jobs && r.government >= 0 && r.federal >= 0 && r.federal <= r.government, f + ' shown only when the parts are consistent');
    ok(Math.abs(r.government_share - r.government / r.jobs) < 0.001, f + ' share matches the parts');
    ok(r.why_not === null, f + ' shown has no why_not');
  } else {
    ok(r.government_share === null && typeof r.why_not === 'string' && r.why_not.length > 10, f + ' not shown says why');
  }
}
for (const [f, r] of Object.entries(P.counties)) check(f, r);
for (const [f, r] of Object.entries(P.places)) check(f, r);

// A town's jobs sit inside its county's, so the county total is at least the sum over its towns (towns that cross
// a county line count to both, so this is a floor only where every town is inside one county: use the state total).
const stateJobs = Object.values(P.counties).reduce((a, r) => a + r.jobs, 0);
const placeJobs = Object.values(P.places).reduce((a, r) => a + r.jobs, 0);
ok(placeJobs <= stateJobs, 'towns hold no more jobs than the counties');
ok(stateJobs > 2000000, 'statewide job count is in range (LODES Colorado > 2 million)');

if (m.year === 2023) {
  ok(P.counties['08009'].jobs === 1256 && P.counties['08009'].government === 662 && P.counties['08009'].federal === 16, 'Baca: 662 of 1,256 government, 16 federal');
  ok(P.counties['08103'].state_local === 1105 && P.counties['08103'].government_share === 0.408, 'Rio Blanco: 1,105 state and local, 40.8%');
  ok(P.counties['08081'].private_large_firms === 887, 'Moffat: 887 private jobs at 500+ firms');
  ok(P.places['0833640'].jobs === 3922 && P.places['0833640'].government === 1521, 'Gunnison: 1,521 of 3,922 government');
  ok(P.counties['08031'].jobs === 557853 && P.places['0820000'].jobs === 557853, 'Denver city and county agree');
  ok(m.missing['0834740'] && m.missing['0879270'], 'Haswell and Two Buttes have no LODES block and are listed as missing');
}
console.log(`public-jobs: PASS (${checks} checks)`);
