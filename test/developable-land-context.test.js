const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function approx(actual, expected, tolerance, label) {
  assert(Number.isFinite(actual), `${label}: actual must be finite`);
  assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

const doc = readJson('data/market/developable_land_context_co.json');
const tracts = Object.values(doc.tracts || {});
const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'market', 'build_developable_land_context.py'), 'utf8');
const scoringSource = fs.readFileSync(path.join(ROOT, 'js', 'market-analysis-scoring.js'), 'utf8');
const pmaSource = fs.readFileSync(path.join(ROOT, 'js', 'market-analysis.js'), 'utf8');

assert(doc.meta, 'artifact exposes meta');
assert.equal(doc.meta.source, 'Colorado tract developable-land context');
assert.equal(doc.meta.context_only, true, 'meta marks artifact context-only');
assert.equal(doc.meta.not_scoring_input, true, 'meta marks artifact as not scoring input');
assert.equal(doc.meta.generated_by, 'scripts/market/build_developable_land_context.py');
assert.equal(doc.meta.tract_boundaries_file, 'data/market/tract_boundaries_co.geojson');
assert.equal(doc.meta.padus_source_url, 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PADUS_Protection_Status_by_GAP_Status_Code/FeatureServer/0');
assert.equal(doc.meta.padus_item_url, 'https://www.arcgis.com/home/item.html?id=98fce3fb0c8241ce8847e9f7d0d212e9');
assert.equal(doc.meta.nlcd_source_url, 'https://www.mrlc.gov/data');
assert.equal(doc.meta.comap_terms_url, 'https://comap.cnhp.colostate.edu/terms-of-use/');
assert.match(doc.meta.as_of, /^\d{4}-\d{2}-\d{2}$/, 'as_of is ISO');
assert.match(doc.meta.last_verified, /^\d{4}-\d{2}-\d{2}$/, 'last_verified is ISO');
assert.match(doc.meta.review_by, /^\d{4}-\d{2}-\d{2}$/, 'review_by is ISO');

assert.equal(doc.meta.source_status.pad_us_4_1.status, 'included_public_domain_context');
assert.equal(doc.meta.source_status.nlcd.status, 'not_included_without_local_raster_summary');
assert.equal(doc.meta.source_status.comap.status, 'verified_excluded_restricted_redistribution');
assert(doc.meta.source_status.comap.license_note.includes('prohibit redistribution'), 'COMaP restriction is disclosed');
assert(doc.meta.limitations.some((line) => /#1238 disclosed-migration protocol/.test(line)), 'scoring migration limitation is pinned');
assert(doc.meta.limitations.some((line) => /understate protection by 50\+ points in alpine counties \(San Juan, Mineral\)/.test(line)),
  'quantified centroid-allocation limitation is pinned');

assert.equal(tracts.length, 1447, 'tract coverage matches Colorado tract boundary artifact');
assert.equal(doc.meta.tract_count, tracts.length, 'tract_count matches rows');
assert.equal(doc.meta.county_count, 64, 'all Colorado counties are represented');
assert(doc.meta.padus.source_feature_count > 10000, 'PAD-US source features are non-vacuous');
assert(doc.meta.padus.assigned_feature_count > 10000, 'PAD-US assigned features are non-vacuous');
assert(doc.meta.protected_tract_count > 1000, 'protected/open-space tract coverage is non-vacuous');
assert(doc.meta.constrained_tract_count_share_below_50pct > 50, 'low-developable-share guard is non-vacuous');
assert(Object.keys(doc.meta.padus.gap_status_counts).length >= 3, 'PAD-US GAP status diversity is non-vacuous');

for (const row of tracts) {
  assert.match(row.geoid, /^08\d{9}$/, `${row.geoid} is a Colorado tract GEOID`);
  assert.equal(row.context_only, true, `${row.geoid} is context-only`);
  assert.equal(row.not_scoring_input, true, `${row.geoid} is not a scoring input`);
  assert.equal(row.source_level, 'tract_context_modeled', `${row.geoid} has modeled context source level`);
  assert(row.total_acres > 0, `${row.geoid} total acres positive`);
  assert(row.census_land_acres >= 0, `${row.geoid} land acres nonnegative`);
  assert(row.census_water_acres >= 0, `${row.geoid} water acres nonnegative`);
  assert(row.developable_acres_context >= 0, `${row.geoid} developable acres nonnegative`);
  assert(row.developable_acres_context <= row.total_acres + 0.01, `${row.geoid} developable acres capped`);
  assert(row.developable_share_context >= 0 && row.developable_share_context <= 1, `${row.geoid} developable share bounded`);
  assert(row.padus_protected_open_space_acres <= row.census_land_acres + 0.01, `${row.geoid} PAD-US acres capped at land acres`);
  assert(Array.isArray(row.limitations) && row.limitations.some((line) => /centroid-allocated/.test(line)),
    `${row.geoid} carries centroid-allocation limitation`);
}

const urbanFixture = doc.tracts['08059011601'];
assert(urbanFixture, 'Jefferson County urban fixture exists');
assert(urbanFixture.padus_feature_count > 0, 'urban fixture has a PAD-US assignment');
const urbanExpected = (
  urbanFixture.total_acres -
  urbanFixture.census_water_acres -
  urbanFixture.padus_protected_open_space_acres
) / urbanFixture.total_acres;
approx(urbanFixture.developable_share_context, urbanExpected, 0.00001, 'urban fixture developable share recomputes');

const constrained = tracts.find((row) => row.developable_share_context === 0 && row.padus_protected_open_space_acres > 0);
assert(constrained, 'at least one tract is fully constrained after PAD-US cap');
assert(constrained.padus_protected_open_space_acres <= constrained.census_land_acres + 0.01,
  'fully constrained fixture still caps PAD-US acres at land acres');

const committedMarketFiles = fs.readdirSync(path.join(ROOT, 'data', 'market'));
assert(!committedMarketFiles.some((name) => /padus|comap|nlcd/i.test(name) && /\.(zip|tif|tiff|gpkg|gdb|geojson)$/i.test(name)),
  'raw PAD-US/COMaP/NLCD source files are not committed in data/market');
assert(builder.includes('PADUS_CHUNK_SIZE = 100'), 'builder uses small PAD-US chunks to avoid URI ceilings');
assert(builder.includes('returnCentroid'), 'builder uses PAD-US centroids rather than committing source polygons');
assert(builder.includes('verified_excluded_restricted_redistribution'), 'builder records COMaP redistribution restriction');

assert(!scoringSource.includes('developable_land_context_co.json'), 'developable-land context is not wired into scoring');
assert(!pmaSource.includes('developable_land_context_co.json'), 'developable-land context is not wired into shipped PMA runtime');

console.log(`developable-land-context: PASS (${tracts.length} tracts, ${doc.meta.padus.assigned_feature_count} assigned PAD-US features)`);
