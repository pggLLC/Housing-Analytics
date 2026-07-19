const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function approx(actual, expected, tolerance, label) {
  assert(Number.isFinite(actual), `${label}: actual must be finite`);
  assert(Number.isFinite(expected), `${label}: expected must be finite`);
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function weightedAverage(rows, weightKey, metricKey) {
  let num = 0;
  let den = 0;
  for (const row of rows) {
    if (row[metricKey] == null || row[weightKey] == null) continue;
    const value = Number(row[metricKey]);
    const weight = Number(row[weightKey]);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    num += value * weight;
    den += weight;
  }
  return { value: num / den, weight: den };
}

const hpi = readJson('data/market/fhfa_hpi_subcounty_co.json');
const membership = readJson('data/hna/place-tract-membership.json');

assert(hpi.meta, 'artifact exposes meta');
assert.strictEqual(hpi.meta.source, 'FHFA annual Census-tract House Price Index');
assert.strictEqual(hpi.meta.source_url, 'https://www.fhfa.gov/hpi/download/annual/hpi_at_tract.csv');
assert.strictEqual(hpi.meta.source_page_url, 'https://www.fhfa.gov/house-price-index');
assert.strictEqual(hpi.meta.place_membership_file, 'data/hna/place-tract-membership.json');
assert.strictEqual(hpi.meta.state_fips, '08');
assert.strictEqual(hpi.meta.as_of, '2025-12-31');
assert(/^\d{4}-\d{2}-\d{2}$/.test(hpi.meta.last_verified), 'last_verified is ISO date');
assert(/^\d{4}-\d{2}-\d{2}$/.test(hpi.meta.review_by), 'review_by is ISO date');
assert(hpi.meta.methodology.includes('FHFA annual tract HPI rows are filtered to Colorado Census tracts'), 'methodology documents direct tract source');
assert(hpi.meta.methodology.includes('area-weighted from direct FHFA tract indicators'), 'methodology documents place aggregation');

const countyRows = Object.values(hpi.counties || {});
const tractRows = Object.values(hpi.tracts || {});
const placeRows = Object.values(hpi.places || {});

assert.strictEqual(hpi.zip5, undefined, 'artifact does not carry ZIP-modeled intermediate rows');
assert.strictEqual(hpi.meta.crosswalk_file, undefined, 'artifact does not use the HUD ZIP crosswalk for FHFA HPI');
assert.strictEqual(countyRows.length, 64, 'county direct anchors cover all Colorado counties');
assert(tractRows.length > 900, `direct FHFA tract coverage is non-vacuous (${tractRows.length})`);
assert(placeRows.length > 300, `place coverage is non-vacuous (${placeRows.length})`);
assert.strictEqual(hpi.meta.county_count, countyRows.length, 'county_count matches counties');
assert.strictEqual(hpi.meta.tract_count, tractRows.length, 'tract_count matches tracts');
assert.strictEqual(hpi.meta.place_count, placeRows.length, 'place_count matches places');

for (const row of countyRows) {
  assert.strictEqual(row.source_level, 'fhfa_county_direct', `${row.county_fips} is direct county source`);
  assert(/^08\d{3}$/.test(row.county_fips), `county FIPS is Colorado: ${row.county_fips}`);
  assert(Number.isFinite(row.change_10y), `${row.county_fips} has 10y county change`);
}

for (const row of tractRows) {
  assert.strictEqual(row.source_level, 'fhfa_tract_direct', `${row.tract} is direct tract source`);
  assert(/^08\d{9}$/.test(row.tract), `tract GEOID is Colorado: ${row.tract}`);
  assert.strictEqual(row.res_ratio_weight_sum, undefined, `${row.tract} does not expose ZIP crosswalk weights`);
  assert.strictEqual(row.zip_count, undefined, `${row.tract} does not expose source ZIP counts`);
  assert.strictEqual(row.latest_year, 2025, `${row.tract} latest year is 2025`);
  assert(row.year_count >= 1, `${row.tract} has at least one FHFA tract-year`);
  assert(
    ['hpi_2000_base_latest', 'annual_change_latest', 'change_5y', 'change_10y'].some((key) => Number.isFinite(row[key])),
    `${row.tract} has at least one modeled FHFA metric`,
  );
  if (row.hpi_2000_base_latest != null) {
    assert(row.hpi_2000_base_latest > 0, `${row.tract} latest HPI is positive`);
  }
  if (row.annual_change_latest != null) {
    assert(row.annual_change_latest > -0.5 && row.annual_change_latest < 0.5, `${row.tract} annual change is plausible`);
  }
  if (row.change_10y != null) {
    assert(row.change_10y > -1 && row.change_10y < 5, `${row.tract} 10y change is plausible`);
  }
}

for (const row of placeRows) {
  assert.strictEqual(row.source_level, 'modeled_fhfa_tract_to_place', `${row.geoid} is modeled place source`);
  assert(/^\d{7}$/.test(row.geoid), `place GEOID is seven digits: ${row.geoid}`);
  assert(row.tract_count >= 1, `${row.geoid} has source tracts`);
  assert(row.coverage_share_of_place_area > 0, `${row.geoid} has positive place coverage`);
  assert(row.coverage_share_of_place_area <= 1.01, `${row.geoid} coverage is bounded`);
}

const modeledSourceLevels = new Set([...tractRows, ...placeRows].map((row) => row.source_level));
assert(!modeledSourceLevels.has('fhfa_county_direct'), 'modeled tract/place rows never fall back to county direct HPI');
assert(modeledSourceLevels.has('fhfa_tract_direct'), 'direct FHFA tract source rows are present');

const denver = membership.places['0820000'];
assert(denver, 'Denver place membership fixture exists');
const denverRows = denver.tracts
  .map((row) => ({
    ...hpi.tracts[row.tract_geoid],
    place_area_weight: Number(row.share_of_place_area),
  }))
  .filter((row) => row && Number.isFinite(row.place_area_weight) && row.place_area_weight > 0);
assert(denverRows.length > 100, 'Denver place fixture is non-vacuous');
const denverExpected = weightedAverage(denverRows, 'place_area_weight', 'change_10y');
approx(hpi.places['0820000'].change_10y, denverExpected.value, 0.000001, 'Denver place 10y HPI recompute');
approx(hpi.places['0820000'].metric_weight_sum.change_10y, denverExpected.weight, 0.000001, 'Denver place weight sum recompute');

const lowCoverage = placeRows.filter((row) => row.coverage_share_of_place_area < 0.8);
assert(lowCoverage.length > 0, 'coverage guard is non-vacuous: at least one place is flagged below 80% modeled coverage');

const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'market', 'build_fhfa_hpi_subcounty.py'), 'utf8');
assert(builder.includes('FHFA_TRACT_HPI_PATH'), 'builder supports a local source CSV override for reproducible QA');
assert(!builder.includes('ZIP_TRACT_PATH'), 'builder does not use HUD ZIP crosswalk for FHFA tract HPI');
assert(!builder.includes('res_ratio'), 'builder does not use ZIP residential ratios for direct FHFA tract HPI');
assert(builder.includes('share_of_place_area'), 'builder uses place-area shares for place aggregation');

console.log(`fhfa-hpi-subcounty: PASS (${tractRows.length} direct FHFA tracts, ${placeRows.length} places)`);
