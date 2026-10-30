#!/usr/bin/env node
/**
 * Commuting and Jobs page (commuting.html, js/commuting.js) and its two data files:
 *   data/market/commute-strength.json   built by scripts/market/build_commute_strength.py (LODES 2023)
 *   data/market/principal-employers.json curated from audit filings (Office of the State Auditor)
 *
 * Pins:
 *   1. every place and county adds up: far + long <= in-commuters <= jobs, low-paid <= its total,
 *      out-commuters <= residents, the far median sits in the 20-60 mile band, places meet the
 *      job floor, and every location is inside Colorado;
 *   2. the page's headline sentence costs the drive the way its source line says
 *      (2 trips x median miles x 240 days x IRS 76 cents) and never costs the 60+ mile group;
 *   3. every employer table names a filer, a PDF in the state audit library and a year, ranks run
 *      1..n with no gaps, and counts are copied as printed text;
 *   4. the page loads the script, both data files exist at the paths the script reads, and
 *      the public page names no person (contacts belong on the member site).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const C = JSON.parse(read('data/market/commute-strength.json'));
const E = JSON.parse(read('data/market/principal-employers.json'));
const CJ = require(join(ROOT, 'js/commuting.js'));

// 1. Commute records add up.
const [FAR, LONG] = C.meta.far_miles;
ok(FAR === 20 && LONG === 60, 'far band is 20 to 60 miles');
ok(C.meta.lodes_year === 2023 && /JT01_2023/.test(C.meta.source), 'LODES 2023 primary jobs');
const places = Object.entries(C.places);
const counties = Object.entries(C.counties);
ok(places.length > 200, `places found (${places.length})`);
ok(counties.length === 64, `all 64 counties (${counties.length})`);
for (const [k, p] of [...places, ...counties]) {
  const tag = `${k} ${p.name}`;
  ok(/^08\d{3}(\d{5})?$/.test(k) || /^08\d{5}$/.test(k), `${tag}: Colorado geoid`);
  ok(p.jobs >= C.meta.min_jobs, `${tag}: meets the job floor`);
  ok(p.in_commuters <= p.jobs, `${tag}: in-commuters <= jobs`);
  ok(p.far + p.long <= p.in_commuters, `${tag}: far + long <= in-commuters`);
  ok(p.far_low <= p.far && p.in_low <= p.in_commuters, `${tag}: low-paid within totals`);
  ok(p.out_commuters <= p.residents, `${tag}: out-commuters <= residents`);
  ok(p.lat > 36.9 && p.lat < 41.1 && p.lon > -109.1 && p.lon < -102.0, `${tag}: inside Colorado`);
  if (p.far) ok(p.median_far_miles >= FAR && p.median_far_miles < LONG, `${tag}: far median in band`);
  else ok(p.median_far_miles == null, `${tag}: no median without far commuters`);
  ok(p.from.length <= 5 && p.to.length <= 5, `${tag}: top five flows`);
  for (let i = 1; i < p.from.length; i++) ok(p.from[i - 1][1] >= p.from[i][1], `${tag}: origins sorted`);
}

// 2. The headline sentence.
const bay = places.map(([, p]) => p).find((p) => /^Bayfield/.test(p.name));
ok(bay, 'Bayfield is in the file');
const s = CJ.answer(bay);
const cost = Math.round(2 * bay.median_far_miles * CJ.WORKDAYS * CJ.IRS_RATE / 10) * 10;
ok(s.includes('$' + cost.toLocaleString('en-US')), `answer costs ${bay.median_far_miles} miles at the IRS rate: ${s}`);
ok(!s.includes(String(bay.long)) || bay.long === bay.far, 'answer does not cost the 60+ mile group');
ok(CJ.IRS_RATE === 0.76 && CJ.WORKDAYS === 240, 'rate and days match the page source line');
ok(/76 cents a mile/.test(read('commuting.html')), 'page states the rate it uses');
ok(CJ.binFor(0.02).label === 'Under 5%' && CJ.binFor(0.3).label === '25% or more', 'legend bins');

// 3. Employer tables.
ok(E.areas.length >= 15, `employer areas (${E.areas.length})`);
const ids = new Set();
for (const a of E.areas) {
  ok(!ids.has(a.id), `${a.id}: unique`); ids.add(a.id);
  ok(/^20\d\d$/.test(a.as_of), `${a.id}: year`);
  ok(a.source && a.source.filer && /^https:\/\/s3\.us-east-2\.amazonaws\.com\/lg\.colorado\.gov\/published_audits\/.+\.pdf$/.test(a.source.url), `${a.id}: state audit library PDF`);
  ok(a.stated_source, `${a.id}: stated source`);
  ok(a.rows.length >= 5, `${a.id}: rows`);
  const ranked = a.rows.filter((r) => r.rank != null);
  ranked.forEach((r, i) => ok(r.rank === i + 1, `${a.id}: rank ${i + 1}`));
  for (const r of a.rows) ok(typeof r.employees === 'string' && r.employer, `${a.id}: ${r.employer} copied as printed`);
}

// 4. Page wiring and public-page rules.
const html = read('commuting.html');
const js = read('js/commuting.js');
ok(html.includes('src="js/commuting.js"'), 'page loads its script');
ok(js.includes("'data/market/commute-strength.json'") && js.includes("'data/market/principal-employers.json'"), 'script reads both files');
ok(!/@[a-z0-9-]+\.[a-z]{2,}|\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/i.test(html + JSON.stringify(E)), 'no emails or phone numbers on the public page or its employer file');

console.log(`commuting: PASS (${checks} checks)`);
