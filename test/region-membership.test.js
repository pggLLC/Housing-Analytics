'use strict';
// The Opportunity Finder and HNA ranking filter by region, so a misfiled
// county hides every place in it from the search a reader runs. Until
// 2026-10-14 twelve counties were misfiled: Cortez (Montezuma) never appeared
// beside Durango, Washington County sat under Western Slope and Baca under
// Mountains.
//
// What is pinned is agreement with DOLA's planning and management regions
// (Colorado Department of Local Affairs), which the six labels
// fold together, and agreement between the builder and the ranking index the
// pages read. The DOLA region lists below are the source, not a choice.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REGIONS = JSON.parse(execFileSync('python3', ['-c', `
import ast, json
tree = ast.parse(open('scripts/hna/build_ranking_index.py').read())
for node in tree.body:
    if isinstance(node, ast.AnnAssign) and getattr(node.target, 'id', '') == 'REGIONS':
        print(json.dumps(ast.literal_eval(node.value)))
`], { encoding: 'utf8' }));

const regionOf = {};
for (const [region, list] of Object.entries(REGIONS)) {
  for (const fips of list) {
    assert(!(fips in regionOf), `${fips} is filed under both ${regionOf[fips]} and ${region}`);
    regionOf[fips] = region;
  }
}

// Every Colorado county, exactly once (the county list comes from the AMI
// gap file, which must carry all 64 under Rule 4).
const counties = JSON.parse(fs.readFileSync('data/co_ami_gap_by_county.json', 'utf8')).counties;
assert.equal(counties.length, 64);
const names = Object.fromEntries(counties.map((c) => [c.fips, c.county_name]));
assert.deepEqual(Object.keys(regionOf).sort(), Object.keys(names).sort(), 'REGIONS covers each of the 64 counties exactly once');

// DOLA planning regions that map whole onto one label.
const DOLA = {
  'Region 8 (San Luis Valley)': [['08003', '08021', '08023', '08079', '08105', '08109'], 'San Luis Valley'],
  'Region 9 (Southwest)': [['08007', '08033', '08067', '08083', '08111'], 'Southwest'],
  'Region 10': [['08029', '08051', '08053', '08085', '08091', '08113'], 'Western Slope'],
  'Region 12': [['08037', '08049', '08057', '08097', '08117'], 'Mountains'],
  'Region 13': [['08015', '08027', '08043', '08065'], 'Mountains'],
  'Region 1': [['08075', '08087', '08095', '08115', '08121', '08125'], 'Eastern Plains'],
  'Region 5': [['08017', '08039', '08063', '08073'], 'Eastern Plains'],
  'Region 6': [['08009', '08011', '08025', '08061', '08089', '08099'], 'Eastern Plains'],
  'Region 14': [['08055', '08071'], 'Eastern Plains'],
};
let checked = 0;
for (const [dola, [list, label]] of Object.entries(DOLA)) {
  for (const fips of list) {
    assert.equal(regionOf[fips], label, `${names[fips]} (${fips}) is in DOLA ${dola}, so it files under ${label}`);
    checked++;
  }
}
// Region 11 is Western Slope except Routt, kept with the resort Mountains.
for (const fips of ['08045', '08077', '08081', '08103']) {
  assert.equal(regionOf[fips], 'Western Slope', `${names[fips]} (${fips}) is in DOLA Region 11, so it files under Western Slope`);
  checked++;
}
assert(checked >= 45, 'the DOLA scan checked most counties');

// The pages read regions from the ranking index, so the committed index must
// agree with the builder for every row that names its county.
const rows = JSON.parse(fs.readFileSync('data/hna/ranking-index.json', 'utf8')).rankings;
let compared = 0;
for (const row of rows) {
  const county = row.type === 'county' ? row.geoid : row.containingCounty;
  if (!county || !(county in regionOf)) continue;
  assert.equal(row.region, regionOf[county], `${row.name} (${row.geoid}) shows ${row.region}; its county files under ${regionOf[county]}`);
  compared++;
}
assert(compared > 500, `compared ${compared} ranking rows with their county's region`);

// Where to build filters its shortlist by the same six regions, from its own copy.
const where = fs.readFileSync('developer-where.html', 'utf8');
const whereRegions = JSON.parse(where.slice(where.indexOf('const REGIONS = {') + 'const REGIONS = '.length, where.indexOf('};', where.indexOf('const REGIONS = {')) + 1)
  .replace(/'/g, '"').replace(/\s+/g, ' ').replace(/,\s*}/, '}'));
assert.deepEqual(whereRegions, REGIONS, 'developer-where.html files each county under the same region as the builder');
for (const r of Object.keys(REGIONS)) assert(where.includes(`<option value="${r}">${r}</option>`), `Where to build offers ${r}`);

console.log(`region-membership: PASS (${checked} counties against DOLA, ${compared} ranking rows)`);
