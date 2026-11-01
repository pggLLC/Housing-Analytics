// data/co-housing-costs/county-trends.json must agree with the site's Census API
// county file for the ACS vintage they share.
//
// Until 2026-11 county-trends.json held placeholder cohorts from June 2026
// (Mesa 2024 rent $990 and income $52,000 against ACS $1,182 and $73,658), and
// those values reached every jurisdiction digest as "high confidence" county
// trends. scripts/build_county_trends_json.py now rebuilds it from the parquet
// caches that update-co-housing-costs.yml refreshes. This guard compares the
// latest cohort with data/co-county-demographics.json (the Census API county
// file) county by county, on median gross rent, median household income and
// total housing units, whenever both files are on the same ACS year. When the
// years differ (one refresh has landed before the other) it says so and checks
// nothing, rather than comparing two vintages.
//
// Sabotage cases, built from the current files, show a single changed county
// fails and a matching change in both files passes.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const load = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const FIELDS = [['median_gross_rent', 'median_gross_rent'], ['median_hh_income', 'median_hh_income'], ['total_housing_units', 'total_housing_units']];

function problems(trends, demo) {
  const out = [];
  const byName = {};
  for (const [fips, rec] of Object.entries(trends.counties)) byName[String(rec.county_name).replace(/( County)?, Colorado$/, '')] = fips;
  let compared = 0, skipped = 0;
  for (const [name, d] of Object.entries(demo.counties)) {
    const fips = byName[name];
    if (!fips) { out.push(`${name}: in the Census API county file but not in county-trends.json`); continue; }
    const cohorts = trends.counties[fips].acs_cohorts || [];
    const latest = cohorts[cohorts.length - 1];
    if (!latest) { out.push(`${name}: no ACS cohorts in county-trends.json`); continue; }
    if (Number(latest.year) !== Number(d.acs_year)) { skipped++; continue; }
    for (const [tk, dk] of FIELDS) {
      if (Number(latest[tk]) !== Number(d[dk])) out.push(`${name} ${latest.year} ${tk}: county-trends ${latest[tk]}, Census API ${d[dk]}`);
    }
    compared++;
  }
  return { out, compared, skipped };
}

const trends = load('data/co-housing-costs/county-trends.json');
const demo = load('data/co-county-demographics.json');
const live = problems(trends, demo);
assert.deepEqual(live.out, [], 'county-trends.json disagrees with the Census API county file:\n' + live.out.join('\n'));
if (live.skipped) console.warn(`county-trends ACS agreement: ${live.skipped} counties on a different ACS year from the Census API file; not compared`);
else assert.ok(live.compared >= 64, `expected to compare all 64 counties, compared ${live.compared}`);

const clone = o => JSON.parse(JSON.stringify(o));
let sabotage = 0;
{
  const t = clone(trends); const f = Object.keys(t.counties)[0]; const c = t.counties[f].acs_cohorts; c[c.length - 1].median_gross_rent += 100;
  assert.ok(problems(t, demo).out.length > 0, 'sabotage not caught: one county rent changed in county-trends only'); sabotage++;
}
{
  const t = clone(trends), d = clone(demo); const f = Object.keys(t.counties)[0]; const c = t.counties[f].acs_cohorts;
  const name = String(t.counties[f].county_name).replace(/( County)?, Colorado$/, '');
  assert.ok(d.counties[name], 'sabotage setup: county name did not map');
  c[c.length - 1].median_hh_income += 1000; d.counties[name].median_hh_income += 1000;
  assert.deepEqual(problems(t, d).out, [], 'sabotage wrongly failed: matching change in both files'); sabotage++;
}

console.log(`county-trends ACS agreement: PASS (${live.compared} counties compared, ${sabotage} sabotage checks)`);
