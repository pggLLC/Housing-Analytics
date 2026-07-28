const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const dolaSource = read('scripts/market/fetch_dola.py');
assert.match(dolaSource, /^import time$/m, 'fetch_dola.py imports time for fallback sleeps');

const guardIndex = dolaSource.indexOf('DOLA fetch produced only _noData stubs');
const writeIndex = dolaSource.indexOf('with open(OUT_FILE, "w")');
assert.ok(guardIndex > 0, 'fetch_dola.py has the all-stub overwrite guard');
assert.ok(writeIndex > guardIndex, 'fetch_dola.py checks all-stub output before writing OUT_FILE');
assert.ok(
  dolaSource.includes('_noData') && dolaSource.includes('sys.exit(1)'),
  'fetch_dola.py guard references _noData and exits before corrupting prior data',
);

const fmrSource = read('scripts/fetch_fmr_api.py');
assert.match(
  fmrSource,
  /_MAX_STATEWIDE_DEFAULT_AMI_COUNTIES\s*=\s*5/,
  'fetch_fmr_api.py defines the statewide default AMI cap',
);
assert.ok(
  fmrSource.includes('at_default > _MAX_STATEWIDE_DEFAULT_AMI_COUNTIES'),
  'fetch_fmr_api.py rejects excessive statewide-default AMI flattening',
);

const rentBuilderSource = read('scripts/build_acs_rent_co.py');
assert.ok(
  rentBuilderSource.includes('entry.get("tract_geoid") or entry.get("geoid")'),
  'build_acs_rent_co.py derives place county_fips from tract_geoid before legacy geoid',
);
assert.ok(
  !rentBuilderSource.includes('tid = entry.get("geoid") if isinstance(entry, dict) else entry'),
  'build_acs_rent_co.py no longer uses the geoid-only derivation for place county_fips',
);

const acsRent = JSON.parse(read('data/market/acs_median_rent_co.json'));
const places = Object.values(acsRent.places || {});
const populated = places.filter((place) => place && place.county_fips).length;
assert.ok(places.length >= 460, `expected at least 460 ACS rent place records, found ${places.length}`);
assert.ok(
  populated > 400,
  `expected a strong majority of ACS rent places to have county_fips; found ${populated}/${places.length}`,
);

console.log(`pipeline-guards-a1: PASS (${populated}/${places.length} place county_fips populated)`);
