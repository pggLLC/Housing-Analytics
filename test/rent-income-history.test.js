// data/co-housing-costs/rent-income-history.json: rent against income back to the 1980 Census.
//
// scripts/build_rent_income_history.py reads three Census products (USA Counties for 1980-2000,
// the 2000 SF3 files for towns, the 2014 ACS summary file for Colorado) plus CPI-U. This guard
// checks the parts that can drift or be misread:
//   - every county's 2005-09 values in USA Counties equal county-trends.json's 2009 cohort, so the
//     long-form points join the ACS series they sit in front of;
//   - Colorado 2020-24 equals data/hna/summary/08.json;
//   - all 64 counties are present, Broomfield with no decennial points and a reason;
//   - income moved to the rent year equals income x CPI(rent year) / CPI(income year);
//   - towns are 7-digit Colorado place GEOIDs with no CDPs, and a missing 2000 value carries its reason.
// Sabotage: a changed 2005-09 value and a wrong CPI move both fail.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const load = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

function problems(h, trends, state) {
  const out = [];
  const cpi = h.meta.cpi_u_annual;
  const fips = Object.keys(h.counties);
  if (fips.length !== 64) out.push(`expected 64 counties, found ${fips.length}`);
  for (const g of fips) {
    const c = h.counties[g], t = trends.counties[g];
    if (!t) { out.push(`${g}: not in county-trends.json`); continue; }
    if (g === '08014') {
      if (c.decennial.length || !c.decennial_missing_reason) out.push('Broomfield must have no decennial points and a reason');
      continue;
    }
    if (c.decennial.length !== 3) out.push(`${g}: ${c.decennial.length} decennial points, expected 3`);
    const y09 = t.acs_cohorts.find(x => x.year === 2009);
    if (!y09 || y09.median_gross_rent !== c.check_2005_09.median_gross_rent || y09.median_hh_income !== c.check_2005_09.median_hh_income)
      out.push(`${g}: USA Counties 2005-09 (${c.check_2005_09.median_gross_rent}, ${c.check_2005_09.median_hh_income}) differs from county-trends 2009 (${y09 && y09.median_gross_rent}, ${y09 && y09.median_hh_income})`);
    if (!(c.renter_homes_2020_24 > 0)) out.push(`${g}: no renter homes`);
    for (const p of c.decennial.concat(h.colorado)) {
      const want = p.income_year === p.rent_year ? p.median_hh_income : Math.round(p.median_hh_income * cpi[p.rent_year] / cpi[p.income_year]);
      if (p.median_hh_income_rent_year !== want) out.push(`${g} ${p.period}: income in rent-year dollars ${p.median_hh_income_rent_year}, expected ${want}`);
      if (!(p.median_gross_rent > 0 && p.median_hh_income > 0)) out.push(`${g} ${p.period}: missing rent or income`);
    }
  }
  const last = h.colorado[h.colorado.length - 1];
  if (last.period !== '2020-24' || last.median_gross_rent !== state.acsProfile.DP04_0134E || last.median_hh_income !== state.acsProfile.DP03_0062E)
    out.push(`Colorado 2020-24 (${last.median_gross_rent}, ${last.median_hh_income}) differs from summary/08.json (${state.acsProfile.DP04_0134E}, ${state.acsProfile.DP03_0062E})`);
  if (h.colorado.map(p => p.period).join() !== '1980,1990,2000,2005-09,2010-14,2020-24') out.push('Colorado periods out of order');
  for (const [g, p] of Object.entries(h.places_2000)) {
    if (!/^08\d{5}$/.test(g)) out.push(`place ${g}: not a 7-digit Colorado GEOID`);
    if (/ CDP$/.test(p.name)) out.push(`place ${g}: CDPs are left out`);
    for (const f of ['median_gross_rent', 'median_hh_income_1999']) {
      if (p.y2000[f] == null && !((p.y2000.unavailable_reason || {})[f])) out.push(`place ${g}: ${f} is null with no unavailable_reason`);
      if (p.y2000[f] != null && !(p.y2000[f] > 0)) out.push(`place ${g}: ${f} must be positive or null`);
    }
  }
  return out;
}

const h = load('data/co-housing-costs/rent-income-history.json');
const trends = load('data/co-housing-costs/county-trends.json');
const state = load('data/hna/summary/08.json');

assert.deepEqual(problems(h, trends, state), [], 'rent-income-history.json problems');

// Sabotage: a changed 2005-09 value fails.
const bad1 = JSON.parse(JSON.stringify(h)); bad1.counties['08077'].check_2005_09.median_gross_rent += 1;
assert.ok(problems(bad1, trends, state).some(p => p.startsWith('08077: USA Counties 2005-09')), 'changed 2005-09 rent must fail');
// Sabotage: a null place rent without a reason fails.
const bad3 = JSON.parse(JSON.stringify(h)); delete bad3.places_2000['0807571'].y2000.unavailable_reason;
assert.ok(problems(bad3, trends, state).some(x => x.startsWith('place 0807571: median_gross_rent is null')), 'null rent with no reason must fail');
// Sabotage: income not moved with CPI fails.
const bad2 = JSON.parse(JSON.stringify(h)); const p = bad2.counties['08031'].decennial[0]; p.median_hh_income_rent_year = p.median_hh_income;
assert.ok(problems(bad2, trends, state).some(x => x.startsWith('08031 1980: income in rent-year dollars')), 'unadjusted 1979 income must fail');

// The headline the lab draws from these files: rent outran income in 58 of 63 counties, 2000 to 2020-24.
let up = 0, n = 0;
for (const [g, c] of Object.entries(h.counties)) {
  const p = c.decennial.find(x => x.period === '2000'); if (!p) continue;
  const y = trends.counties[g].acs_cohorts.find(x => x.year === 2024); n++;
  if (y.median_gross_rent / p.median_gross_rent > y.median_hh_income / p.median_hh_income_rent_year) up++;
}
console.log(`rent-income-history: ok (rent outran income in ${up} of ${n} counties, 2000 to 2020-24)`);
