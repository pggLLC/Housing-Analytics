const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const doc = readJson('data/market/redfin_place_market_tracker_co.json');
const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'market', 'build_redfin_place_market_tracker.py'), 'utf8');

assert(doc && typeof doc === 'object', 'Redfin artifact is a JSON object');
assert(doc.meta && typeof doc.meta === 'object', 'Redfin artifact exposes meta');
assert(doc.places && typeof doc.places === 'object', 'Redfin artifact exposes places');

assert.strictEqual(doc.meta.source, 'Redfin Data Center ZIP-code Market Tracker');
assert.strictEqual(doc.meta.source_url, 'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz');
assert.strictEqual(doc.meta.source_page_url, 'https://www.redfin.com/news/data-center/');
assert.strictEqual(doc.meta.methodology_url, 'https://www.redfin.com/news/data-center/methodology/');
assert.strictEqual(doc.meta.terms_url, 'https://www.redfin.com/about/terms-of-use');
assert.strictEqual(doc.meta.crosswalk_file, 'data/market/hud_zip_tract_crosswalk_co.json');
assert.strictEqual(doc.meta.place_membership_file, 'data/hna/place-tract-membership.json');
assert.strictEqual(doc.meta.state_fips, '08');
assert.strictEqual(doc.meta.period_duration_days, 90);
assert.strictEqual(doc.meta.months_retained, 24);
assert(/^\d{4}-\d{2}-\d{2}$/.test(doc.meta.as_of), 'as_of is an ISO date');
assert(/^\d{4}-\d{2}-\d{2}$/.test(doc.meta.last_verified), 'last_verified is an ISO date');
assert(/^\d{4}-\d{2}-\d{2}$/.test(doc.meta.review_by), 'review_by is an ISO date');
assert(doc.meta.attribution.includes('Redfin'), 'attribution names Redfin');
assert(doc.meta.attribution.includes('does not redistribute raw Redfin rows'), 'attribution discloses no raw redistribution');
assert(doc.meta.methodology.includes('HUD-USPS ZIP-to-tract residential ratios'), 'methodology documents ZIP-to-tract allocation');
assert(doc.meta.methodology.includes('TIGER 2024 tract/place overlaps'), 'methodology documents tract/place allocation');
assert(doc.meta.limitations.some((line) => /rolling three-month windows/i.test(line)), 'limitations disclose Redfin rolling-window methodology');
assert(doc.meta.limitations.some((line) => /Thin ZIP-month rows/i.test(line)), 'limitations disclose thin-sample suppression');

assert.strictEqual(doc.meta.place_count, Object.keys(doc.places).length, 'place_count matches places');
assert(doc.meta.place_count >= 100, `place coverage is non-vacuous (${doc.meta.place_count})`);
assert(doc.meta.months_available_in_source >= 100, 'source month count is non-vacuous');
assert(doc.meta.source_zip_month_rows_used > 10000, 'source ZIP-month rows used is non-vacuous');
assert(doc.meta.source_zip_month_rows_skipped_thin > 0, 'thin ZIP suppression is non-vacuous');
assert(doc.meta.suppressed_place_months_below_floor > 0, 'place-month suppression is non-vacuous');

assert.strictEqual(doc.zip5, undefined, 'artifact does not expose raw or ZIP-level Redfin rows');
assert.strictEqual(doc.zips, undefined, 'artifact does not expose ZIP-level Redfin rows');

for (const [geoid, place] of Object.entries(doc.places)) {
  assert(/^\d{7}$/.test(geoid), `place GEOID is seven digits: ${geoid}`);
  assert.strictEqual(place.geoid, geoid, `${geoid} geoid matches key`);
  assert.strictEqual(place.source_level, 'redfin_zip_to_place_modeled', `${geoid} source level is modeled`);
  assert(Array.isArray(place.monthly), `${geoid} monthly series is an array`);
  assert(place.monthly.length > 0 && place.monthly.length <= doc.meta.months_retained, `${geoid} monthly rows are retained window only`);
  assert(place.latest && typeof place.latest === 'object', `${geoid} exposes latest values`);
  for (const row of place.monthly) {
    assert(/^\d{4}-\d{2}$/.test(row.period), `${geoid} row period is YYYY-MM`);
    assert.strictEqual(row.source_period_duration_days, 90, `${geoid} row uses 90-day Redfin period`);
    assert(row.homes_sold_allocated >= 5, `${geoid} row clears allocated homes-sold floor`);
    assert(row.source_zip_count >= 1, `${geoid} row has at least one source ZIP`);
    assert(Array.isArray(row.source_zips), `${geoid} source_zips is an array of identifiers only`);
    assert(Number.isFinite(row.median_sale_price) || row.median_sale_price === null, `${geoid} median sale price is numeric/null`);
    assert(Number.isFinite(row.inventory_allocated), `${geoid} inventory is allocated numeric`);
    assert(row.sale_to_list_ratio === null || (row.sale_to_list_ratio > 0.5 && row.sale_to_list_ratio < 1.5), `${geoid} sale-to-list ratio is plausible`);
  }
}

const denver = doc.places['0820000'];
assert(denver, 'Denver fixture exists');
assert(denver.latest.source_zip_count >= 20, 'Denver latest row aggregates many ZIPs');
assert(denver.latest.homes_sold_allocated > 1000, 'Denver latest row is non-vacuous');
assert(Number.isFinite(denver.latest.median_sale_price), 'Denver latest median sale price is present');
assert(Number.isFinite(denver.latest.inventory), 'Denver latest inventory is present');
assert(Number.isFinite(denver.latest.median_days_on_market), 'Denver latest days on market is present');
assert(Number.isFinite(denver.latest.sale_to_list_ratio), 'Denver latest sale-to-list ratio is present');

const committedFiles = fs.readdirSync(path.join(ROOT, 'data', 'market'));
assert(!committedFiles.some((name) => /^redfin.*\.(tsv|csv|gz)$/i.test(name)), 'raw Redfin TSV/CSV/GZ files are not committed in data/market');

assert(builder.includes('REDFIN_MARKET_TRACKER_PATH'), 'builder supports a local source override for QA');
assert(builder.includes('MIN_ALLOCATED_HOMES_SOLD'), 'builder has an explicit thin-sample floor');
assert(builder.includes('PROPERTY_TYPE') && builder.includes('All Residential'), 'builder filters to All Residential rows');
assert(builder.includes('PERIOD_DURATION') && builder.includes('ROLLING_MONTHLY_DURATION'), 'builder filters Redfin monthly rolling windows');

console.log(`redfin-place-market-tracker: PASS (${doc.meta.place_count} places, ${doc.meta.months_retained} retained months)`);
